//! The device identity: a recovery code that is also the device secret, and the
//! places it (and the NEAR AI key) are kept. The server stores only the hash of
//! the code. Nothing here logs or prints a secret, and no type that holds one
//! derives `Debug`.

use std::collections::HashMap;
use std::fmt;
use std::path::Path;
use std::sync::{Mutex, PoisonError};

use sha2::{Digest, Sha256};

use super::PrivateError;

/// Keychain account of the device secret (the recovery code).
pub const DEVICE_SECRET: &str = "device-secret";
/// Keychain account of a new code while a recovery is in flight.
pub const DEVICE_SECRET_NEXT: &str = "device-secret-next";
/// Keychain account of the NEAR AI key handed over by the Credits Worker.
pub const NEARAI_KEY: &str = "nearai-key";

const RELEASE_SERVICE: &str = "xyz.zorvo.desktop.private";
const SERVICE_SUFFIX_HEX_CHARS: usize = 8;

const CODE_PREFIX: &str = "ZRV";
/// Crockford base32: no I, L, O or U.
const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_GROUPS: usize = 4;
const GROUP_LEN: usize = 4;
const CODE_CHARS: usize = CODE_GROUPS * GROUP_LEN;
const BITS_PER_CHAR: usize = 5;
/// 16 characters of 5 bits each.
const CODE_RANDOM_BYTES: usize = CODE_CHARS * BITS_PER_CHAR / 8;

/// Keychain service name. Release builds share one; debug builds add a short
/// hash of the app data dir so scratch `HOME`s never share a device.
pub fn keychain_service(app_data_dir: &Path) -> String {
    if !cfg!(debug_assertions) {
        return RELEASE_SERVICE.to_string();
    }
    let digest = hex(&Sha256::digest(app_data_dir.to_string_lossy().as_bytes()));
    format!("{RELEASE_SERVICE}.{}", &digest[..SERVICE_SUFFIX_HEX_CHARS])
}

/// A fresh `ZRV-XXXX-XXXX-XXXX-XXXX` code with 80 random bits.
pub fn new_recovery_code() -> String {
    let mut bytes = [0u8; CODE_RANDOM_BYTES];
    // The OS random source failing is not recoverable and not something a
    // caller could act on, so stop here rather than mint a weak secret.
    getrandom::fill(&mut bytes).expect("the OS random source is unavailable");
    let bits = bytes
        .iter()
        .fold(0u128, |all, byte| (all << 8) | u128::from(*byte));
    let chars: Vec<char> = (0..CODE_CHARS)
        .map(|index| {
            let shift = BITS_PER_CHAR * (CODE_CHARS - 1 - index);
            let value = (bits >> shift) & 0x1f;
            char::from(ALPHABET[value as usize])
        })
        .collect();
    canonical(&chars)
}

/// The canonical form of a code the user typed, or `None` when it is not one.
/// Trims, uppercases, drops spaces and dashes after the `ZRV` prefix and reads
/// `O` as `0` and `I`/`L` as `1`.
pub fn normalize_recovery_code(input: &str) -> Option<String> {
    let upper = input.trim().to_ascii_uppercase();
    let body = upper.strip_prefix(CODE_PREFIX)?;
    let chars: Vec<char> = body
        .chars()
        .filter(|c| !matches!(c, ' ' | '-'))
        .map(|c| match c {
            'O' => '0',
            'I' | 'L' => '1',
            other => other,
        })
        .collect();
    let valid = chars.len() == CODE_CHARS && chars.iter().all(|c| is_in_alphabet(*c));
    valid.then(|| canonical(&chars))
}

/// Lowercase hex SHA-256 of the canonical code; this is all the server learns.
/// A string that is not a code is hashed as it is, so it can never match one.
pub fn secret_hash(code: &str) -> String {
    let canonical = normalize_recovery_code(code).unwrap_or_else(|| code.to_string());
    hex(&Sha256::digest(canonical.as_bytes()))
}

fn is_in_alphabet(c: char) -> bool {
    c.is_ascii() && ALPHABET.contains(&(c as u8))
}

fn canonical(chars: &[char]) -> String {
    let groups: Vec<String> = chars
        .chunks(GROUP_LEN)
        .map(|group| group.iter().collect())
        .collect();
    format!("{CODE_PREFIX}-{}", groups.join("-"))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Where secrets live. Values are UTF-8 text.
pub trait SecretStore: Send + Sync {
    /// `Ok(None)` when nothing is stored under `account`.
    fn get(&self, account: &str) -> Result<Option<String>, PrivateError>;
    /// Stores `value`, replacing what was there.
    fn set(&self, account: &str, value: &str) -> Result<(), PrivateError>;
    /// Removes `account`; removing a missing item is not an error.
    fn delete(&self, account: &str) -> Result<(), PrivateError>;
}

/// The macOS Keychain (generic passwords under one service). A thin mapping,
/// not unit-tested because it touches the real Keychain.
#[cfg(target_os = "macos")]
pub struct KeychainStore {
    service: String,
}

#[cfg(target_os = "macos")]
impl KeychainStore {
    pub fn new(service: String) -> Self {
        Self { service }
    }
}

/// `errSecItemNotFound`.
#[cfg(target_os = "macos")]
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

#[cfg(target_os = "macos")]
impl SecretStore for KeychainStore {
    fn get(&self, account: &str) -> Result<Option<String>, PrivateError> {
        use security_framework::passwords::get_generic_password;
        match get_generic_password(&self.service, account) {
            Ok(bytes) => String::from_utf8(bytes)
                .map(Some)
                .map_err(|_| PrivateError::Keychain),
            Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
            Err(_) => Err(PrivateError::Keychain),
        }
    }

    fn set(&self, account: &str, value: &str) -> Result<(), PrivateError> {
        security_framework::passwords::set_generic_password(
            &self.service,
            account,
            value.as_bytes(),
        )
        .map_err(|_| PrivateError::Keychain)
    }

    fn delete(&self, account: &str) -> Result<(), PrivateError> {
        match security_framework::passwords::delete_generic_password(&self.service, account) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
            Err(_) => Err(PrivateError::Keychain),
        }
    }
}

/// An in-memory store for tests of the code that uses a `SecretStore`.
#[derive(Default)]
pub struct MemoryStore {
    items: Mutex<HashMap<String, String>>,
    fail_writes: bool,
}

impl MemoryStore {
    /// A store whose every `set` fails with `PrivateError::Keychain`.
    pub fn failing_writes() -> Self {
        Self {
            fail_writes: true,
            ..Self::default()
        }
    }

    fn items(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
        self.items.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl fmt::Debug for MemoryStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MemoryStore")
            .field("items", &self.items().len())
            .field("fail_writes", &self.fail_writes)
            .finish()
    }
}

impl SecretStore for MemoryStore {
    fn get(&self, account: &str) -> Result<Option<String>, PrivateError> {
        Ok(self.items().get(account).cloned())
    }

    fn set(&self, account: &str, value: &str) -> Result<(), PrivateError> {
        if self.fail_writes {
            return Err(PrivateError::Keychain);
        }
        self.items().insert(account.to_string(), value.to_string());
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<(), PrivateError> {
        self.items().remove(account);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    const SHA256_OF_SAMPLE_CODE: &str =
        "af2d48449c82c6470eb476d9463cfc1dd97bc88c163c86074bd586189347e516";

    #[test]
    fn new_codes_have_the_canonical_shape_and_are_distinct() {
        let shape = regex::Regex::new(r"^ZRV-[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$")
            .expect("valid regex");
        let mut seen = std::collections::HashSet::new();
        for _ in 0..1000 {
            let code = new_recovery_code();
            assert!(shape.is_match(&code), "bad shape: {code}");
            assert!(seen.insert(code), "duplicate code");
        }
    }

    #[test]
    fn a_new_code_is_already_canonical() {
        let code = new_recovery_code();
        assert_eq!(normalize_recovery_code(&code), Some(code));
    }

    #[test]
    fn normalize_trims_uppercases_and_drops_spaces_and_dashes() {
        assert_eq!(
            normalize_recovery_code(" zrv 4k9p-2m7q 8hxd-7f2q ").as_deref(),
            Some("ZRV-4K9P-2M7Q-8HXD-7F2Q")
        );
    }

    #[test]
    fn normalize_maps_look_alike_letters() {
        assert_eq!(
            normalize_recovery_code("ZRV-4K9P-2M7Q-8HXD-7F2O").as_deref(),
            Some("ZRV-4K9P-2M7Q-8HXD-7F20")
        );
        assert_eq!(
            normalize_recovery_code("zrv-il00-ILil-0000-0000").as_deref(),
            Some("ZRV-1100-1111-0000-0000")
        );
    }

    #[test]
    fn normalize_rejects_what_is_not_a_code() {
        // wrong length, too short and too long
        assert_eq!(normalize_recovery_code("ZRV-4K9P-2M7Q-8HXD-7F2"), None);
        assert_eq!(normalize_recovery_code("ZRV-4K9P-2M7Q-8HXD-7F2QQ"), None);
        // missing or wrong prefix
        assert_eq!(normalize_recovery_code("4K9P-2M7Q-8HXD-7F2Q"), None);
        assert_eq!(normalize_recovery_code("ABC-4K9P-2M7Q-8HXD-7F2Q"), None);
        // U is not in the alphabet
        assert_eq!(normalize_recovery_code("ZRV-4K9P-2M7Q-8HXD-7F2U"), None);
        // other stray characters, including non-ASCII and tabs
        assert_eq!(normalize_recovery_code("ZRV-4K9P-2M7Q-8HXD-7F2!"), None);
        assert_eq!(
            normalize_recovery_code("ZRV-4K9P-2M7Q-8HXD-7F2\u{df}"),
            None
        );
        assert_eq!(normalize_recovery_code("ZRV-4K9P\t2M7Q-8HXD-7F2Q"), None);
        assert_eq!(normalize_recovery_code(""), None);
    }

    #[test]
    fn secret_hash_is_the_same_for_two_spellings_and_is_64_lowercase_hex() {
        let a = secret_hash(" zrv 4k9p-2m7q 8hxd-7f2q ");
        let b = secret_hash("ZRV-4K9P-2M7Q-8HXD-7F2Q");
        assert_eq!(a, b);
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')));
    }

    #[test]
    fn secret_hash_is_sha256_of_the_canonical_code() {
        // printf 'ZRV-4K9P-2M7Q-8HXD-7F2Q' | shasum -a 256
        assert_eq!(
            secret_hash("ZRV-4K9P-2M7Q-8HXD-7F2Q"),
            SHA256_OF_SAMPLE_CODE
        );
    }

    #[test]
    fn memory_store_sets_gets_and_deletes() {
        let store = MemoryStore::default();
        assert_eq!(store.get(DEVICE_SECRET), Ok(None));
        store.set(DEVICE_SECRET, "ZRV-AAAA").expect("set");
        assert_eq!(store.get(DEVICE_SECRET), Ok(Some("ZRV-AAAA".to_string())));
        store.set(DEVICE_SECRET, "ZRV-BBBB").expect("overwrite");
        assert_eq!(store.get(DEVICE_SECRET), Ok(Some("ZRV-BBBB".to_string())));
        store.delete(DEVICE_SECRET).expect("delete");
        assert_eq!(store.get(DEVICE_SECRET), Ok(None));
        store
            .delete(DEVICE_SECRET)
            .expect("deleting a missing item is a no-op");
    }

    #[test]
    fn memory_store_with_failing_writes_refuses_set_but_still_reads_and_deletes() {
        let store = MemoryStore::failing_writes();
        assert_eq!(store.set(NEARAI_KEY, "key"), Err(PrivateError::Keychain));
        assert_eq!(store.get(NEARAI_KEY), Ok(None));
        assert_eq!(store.delete(NEARAI_KEY), Ok(()));
    }

    #[test]
    fn memory_store_debug_does_not_print_values() {
        let store = MemoryStore::default();
        store.set(DEVICE_SECRET, "ZRV-SECRET-VALUE").expect("set");
        assert!(!format!("{store:?}").contains("ZRV-SECRET-VALUE"));
    }

    #[test]
    fn account_names_are_the_agreed_ones() {
        assert_eq!(DEVICE_SECRET, "device-secret");
        assert_eq!(DEVICE_SECRET_NEXT, "device-secret-next");
        assert_eq!(NEARAI_KEY, "nearai-key");
    }

    #[test]
    fn keychain_service_is_fixed_in_release_and_per_data_dir_in_debug() {
        let a = keychain_service(Path::new("/tmp/zorvo-a"));
        let b = keychain_service(Path::new("/tmp/zorvo-b"));
        if cfg!(debug_assertions) {
            let suffix = a
                .strip_prefix("xyz.zorvo.desktop.private.")
                .expect("debug builds append a suffix");
            assert_eq!(suffix.len(), 8);
            assert!(suffix.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')));
            assert_ne!(a, b);
            assert_eq!(a, keychain_service(Path::new("/tmp/zorvo-a")));
        } else {
            assert_eq!(a, "xyz.zorvo.desktop.private");
            assert_eq!(b, "xyz.zorvo.desktop.private");
        }
    }
}
