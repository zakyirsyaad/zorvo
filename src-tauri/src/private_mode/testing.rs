//! Test fakes for private mode: a scriptable Credits Worker that records every
//! call, a store whose writes can fail per account, and a `PrivateMode` built
//! over them with a recording opener. Shared by the unit tests of `service`
//! and `launch`.

use std::collections::{HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use super::billing::OfflineBilling;
use super::client::{
    Balance, CreatedTopup, CreditsApi, ModelPrice, PromoResult, Stock, TopupState,
};
use super::device::{MemoryStore, SecretStore, DEVICE_SECRET};
use super::local_state::LocalState;
use super::proxy::PrivateProxy;
use super::service::PrivateMode;
use super::verify::PrivateVerifier;
use super::PrivateError;

pub(crate) const CODE: &str = "ZRV-4K9P-2M7Q-8HXD-7F2Q";
pub(crate) const OTHER_CODE: &str = "ZRV-0000-1111-2222-3333";
pub(crate) const CHECKOUT_URL: &str = "https://pay.pingpay.io/checkout/cs_test_1";
pub(crate) const TOPUP_ID: &str = "t1";
pub(crate) const UPDATED_AT: &str = "2026-11-07T01:00:00Z";

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

pub(crate) fn balance(credits: u64, key_ready: bool) -> Balance {
    Balance {
        credits,
        used_credits: 0,
        key_ready,
        updated_at: UPDATED_AT.to_string(),
    }
}

pub(crate) fn model_list() -> Vec<ModelPrice> {
    vec![ModelPrice {
        id: "Qwen/Qwen3.8-27B".to_string(),
        input_per_m: 0.15,
        output_per_m: 0.6,
    }]
}

/// The answers of one method: queued ones first, then the default forever.
pub(crate) struct Script<T> {
    queue: Mutex<VecDeque<Result<T, PrivateError>>>,
    default: Mutex<Result<T, PrivateError>>,
}

impl<T: Clone> Script<T> {
    fn new(default: Result<T, PrivateError>) -> Self {
        Self {
            queue: Mutex::new(VecDeque::new()),
            default: Mutex::new(default),
        }
    }

    /// Answers the next call with `answer`.
    pub(crate) fn then(&self, answer: Result<T, PrivateError>) -> &Self {
        lock(&self.queue).push_back(answer);
        self
    }

    /// Answers every call after the queued ones with `answer`.
    pub(crate) fn always(&self, answer: Result<T, PrivateError>) {
        *lock(&self.default) = answer;
    }

    fn next(&self) -> Result<T, PrivateError> {
        lock(&self.queue)
            .pop_front()
            .unwrap_or_else(|| lock(&self.default).clone())
    }
}

/// One call the fake saw, with its arguments (secrets included: test only).
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Call {
    Register { hash: String },
    Balance { secret: String, fresh: bool },
    Stock { secret: String },
    Models { secret: String },
    CreateTopup { secret: String, usd: u32 },
    Topup { secret: String, id: String },
    CancelTopup { secret: String, id: String },
    TakeKey { secret: String },
    RedeemPromo { secret: String, code: String },
    Recover { code: String, new_hash: String },
}

/// A Credits Worker whose answers are scripted per method.
pub(crate) struct FakeCredits {
    pub(crate) register: Script<()>,
    pub(crate) balance: Script<Balance>,
    pub(crate) stock: Script<Stock>,
    pub(crate) models: Script<Vec<ModelPrice>>,
    pub(crate) create_topup: Script<CreatedTopup>,
    pub(crate) topup: Script<TopupState>,
    pub(crate) cancel_topup: Script<()>,
    pub(crate) take_key: Script<Option<String>>,
    pub(crate) redeem_promo: Script<PromoResult>,
    pub(crate) recover: Script<()>,
    take_key_delay: Mutex<Duration>,
    calls: Mutex<Vec<Call>>,
}

impl Default for FakeCredits {
    fn default() -> Self {
        Self {
            register: Script::new(Ok(())),
            balance: Script::new(Ok(balance(0, false))),
            stock: Script::new(Ok(Stock {
                available_credits: 10_000,
                your_room_credits: 5_000,
                packages: Vec::new(),
                updated_at: UPDATED_AT.to_string(),
            })),
            models: Script::new(Ok(model_list())),
            create_topup: Script::new(Ok(CreatedTopup {
                topup_id: TOPUP_ID.to_string(),
                session_url: CHECKOUT_URL.to_string(),
                expires_at: "2026-11-07T02:00:00Z".to_string(),
            })),
            topup: Script::new(Ok(TopupState {
                status: "created".to_string(),
                credits: 1000,
            })),
            cancel_topup: Script::new(Ok(())),
            take_key: Script::new(Ok(None)),
            redeem_promo: Script::new(Ok(PromoResult {
                topup_id: "p1".to_string(),
                credits: 300,
            })),
            recover: Script::new(Ok(())),
            take_key_delay: Mutex::new(Duration::ZERO),
            calls: Mutex::new(Vec::new()),
        }
    }
}

impl FakeCredits {
    pub(crate) fn calls(&self) -> Vec<Call> {
        lock(&self.calls).clone()
    }

    /// How many calls `matches` picks out.
    pub(crate) fn count(&self, matches: impl Fn(&Call) -> bool) -> usize {
        lock(&self.calls)
            .iter()
            .filter(|call| matches(call))
            .count()
    }

    /// Makes `take_key` take this long, so two callers overlap.
    pub(crate) fn slow_take_key(&self, delay: Duration) {
        *lock(&self.take_key_delay) = delay;
    }

    fn record(&self, call: Call) {
        lock(&self.calls).push(call);
    }
}

impl CreditsApi for FakeCredits {
    fn register(&self, secret_hash: &str) -> Result<(), PrivateError> {
        self.record(Call::Register {
            hash: secret_hash.to_string(),
        });
        self.register.next()
    }

    fn balance(&self, secret: &str, fresh: bool) -> Result<Balance, PrivateError> {
        self.record(Call::Balance {
            secret: secret.to_string(),
            fresh,
        });
        self.balance.next()
    }

    fn stock(&self, secret: &str) -> Result<Stock, PrivateError> {
        self.record(Call::Stock {
            secret: secret.to_string(),
        });
        self.stock.next()
    }

    fn models(&self, secret: &str) -> Result<Vec<ModelPrice>, PrivateError> {
        self.record(Call::Models {
            secret: secret.to_string(),
        });
        self.models.next()
    }

    fn create_topup(&self, secret: &str, package_usd: u32) -> Result<CreatedTopup, PrivateError> {
        self.record(Call::CreateTopup {
            secret: secret.to_string(),
            usd: package_usd,
        });
        self.create_topup.next()
    }

    fn topup(&self, secret: &str, id: &str) -> Result<TopupState, PrivateError> {
        self.record(Call::Topup {
            secret: secret.to_string(),
            id: id.to_string(),
        });
        self.topup.next()
    }

    fn cancel_topup(&self, secret: &str, id: &str) -> Result<(), PrivateError> {
        self.record(Call::CancelTopup {
            secret: secret.to_string(),
            id: id.to_string(),
        });
        self.cancel_topup.next()
    }

    fn take_key(&self, secret: &str) -> Result<Option<String>, PrivateError> {
        self.record(Call::TakeKey {
            secret: secret.to_string(),
        });
        let delay = *lock(&self.take_key_delay);
        std::thread::sleep(delay);
        self.take_key.next()
    }

    fn redeem_promo(&self, secret: &str, code: &str) -> Result<PromoResult, PrivateError> {
        self.record(Call::RedeemPromo {
            secret: secret.to_string(),
            code: code.to_string(),
        });
        self.redeem_promo.next()
    }

    fn recover(&self, code: &str, new_secret_hash: &str) -> Result<(), PrivateError> {
        self.record(Call::Recover {
            code: code.to_string(),
            new_hash: new_secret_hash.to_string(),
        });
        self.recover.next()
    }
}

impl<T: CreditsApi + ?Sized> CreditsApi for Arc<T> {
    fn register(&self, secret_hash: &str) -> Result<(), PrivateError> {
        (**self).register(secret_hash)
    }
    fn balance(&self, secret: &str, fresh: bool) -> Result<Balance, PrivateError> {
        (**self).balance(secret, fresh)
    }
    fn stock(&self, secret: &str) -> Result<Stock, PrivateError> {
        (**self).stock(secret)
    }
    fn models(&self, secret: &str) -> Result<Vec<ModelPrice>, PrivateError> {
        (**self).models(secret)
    }
    fn create_topup(&self, secret: &str, package_usd: u32) -> Result<CreatedTopup, PrivateError> {
        (**self).create_topup(secret, package_usd)
    }
    fn topup(&self, secret: &str, id: &str) -> Result<TopupState, PrivateError> {
        (**self).topup(secret, id)
    }
    fn cancel_topup(&self, secret: &str, id: &str) -> Result<(), PrivateError> {
        (**self).cancel_topup(secret, id)
    }
    fn take_key(&self, secret: &str) -> Result<Option<String>, PrivateError> {
        (**self).take_key(secret)
    }
    fn redeem_promo(&self, secret: &str, code: &str) -> Result<PromoResult, PrivateError> {
        (**self).redeem_promo(secret, code)
    }
    fn recover(&self, code: &str, new_secret_hash: &str) -> Result<(), PrivateError> {
        (**self).recover(code, new_secret_hash)
    }
}

/// A `MemoryStore` whose writes to chosen accounts fail and whose reads of
/// chosen accounts come back different from what was written.
#[derive(Default)]
pub(crate) struct TestStore {
    items: MemoryStore,
    failing: Mutex<HashSet<String>>,
    garbled: Mutex<HashSet<String>>,
}

impl TestStore {
    pub(crate) fn fail_writes_to(&self, account: &str) {
        lock(&self.failing).insert(account.to_string());
    }

    /// Lets writes to `account` succeed again.
    pub(crate) fn allow_writes_to(&self, account: &str) {
        lock(&self.failing).remove(account);
    }

    pub(crate) fn garble_reads_of(&self, account: &str) {
        lock(&self.garbled).insert(account.to_string());
    }
}

impl SecretStore for TestStore {
    fn get(&self, account: &str) -> Result<Option<String>, PrivateError> {
        let value = self.items.get(account)?;
        if lock(&self.garbled).contains(account) {
            return Ok(value.map(|_| "garbled".to_string()));
        }
        Ok(value)
    }

    fn set(&self, account: &str, value: &str) -> Result<(), PrivateError> {
        if lock(&self.failing).contains(account) {
            return Err(PrivateError::Keychain);
        }
        self.items.set(account, value)
    }

    fn delete(&self, account: &str) -> Result<(), PrivateError> {
        self.items.delete(account)
    }
}

impl<T: SecretStore + ?Sized> SecretStore for Arc<T> {
    fn get(&self, account: &str) -> Result<Option<String>, PrivateError> {
        (**self).get(account)
    }
    fn set(&self, account: &str, value: &str) -> Result<(), PrivateError> {
        (**self).set(account, value)
    }
    fn delete(&self, account: &str) -> Result<(), PrivateError> {
        (**self).delete(account)
    }
}

fn scratch_dir() -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    std::env::temp_dir().join(format!(
        "zorvo-private-mode-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ))
}

/// A `PrivateMode` over a `TestStore`, a `FakeCredits`, a scratch dir (removed
/// on drop) and an opener that records every URL it is given.
pub(crate) struct Harness {
    pub(crate) mode: PrivateMode,
    pub(crate) store: Arc<TestStore>,
    pub(crate) api: Arc<FakeCredits>,
    pub(crate) dir: PathBuf,
    opened: Arc<Mutex<Vec<String>>>,
    opens_fail: Arc<AtomicBool>,
}

impl Harness {
    pub(crate) fn new() -> Self {
        let store = Arc::new(TestStore::default());
        let api = Arc::new(FakeCredits::default());
        let opened = Arc::new(Mutex::new(Vec::new()));
        let dir = scratch_dir();
        let recorder = Arc::clone(&opened);
        let opens_fail = Arc::new(AtomicBool::new(false));
        let failing = Arc::clone(&opens_fail);
        let proxy = Arc::new(PrivateProxy::with_upstream("http://127.0.0.1:1/v1"));
        let mode = PrivateMode::new(
            Box::new(Arc::clone(&store)),
            Box::new(Arc::clone(&api)),
            dir.join("private"),
            Box::new(move |url: &str| {
                if failing.load(Ordering::SeqCst) {
                    return Err("open failed".to_string());
                }
                lock(&recorder).push(url.to_string());
                Ok(())
            }),
            Arc::clone(&proxy),
            PrivateVerifier::with_retry("http://127.0.0.1:1/v1", Duration::ZERO),
            Arc::new(OfflineBilling),
        );
        Self {
            mode,
            store,
            api,
            dir,
            opened,
            opens_fail,
        }
    }

    /// A harness whose store already holds `code` as this Mac's device secret.
    pub(crate) fn with_device(code: &str) -> Self {
        let harness = Self::new();
        harness.store.set(DEVICE_SECRET, code).expect("seed secret");
        harness
    }

    /// Makes the opener fail from now on.
    pub(crate) fn fail_opens(&self) {
        self.opens_fail.store(true, Ordering::SeqCst);
    }

    pub(crate) fn opened(&self) -> Vec<String> {
        lock(&self.opened).clone()
    }

    pub(crate) fn secret(&self, account: &str) -> Option<String> {
        self.store.get(account).expect("store reads")
    }

    pub(crate) fn state(&self) -> LocalState {
        LocalState::load(&self.dir.join("private"))
    }

    pub(crate) fn set_state(&self, state: &LocalState) {
        state.save(&self.dir.join("private")).expect("state saves");
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        // Best effort: a leftover scratch dir in the temp folder harms nothing.
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}
