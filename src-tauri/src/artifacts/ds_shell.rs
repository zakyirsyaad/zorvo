//! The design system shell. Its script is the only thing in the view that Zorvo wrote for the
//! page itself, so a change must be a visible one: the hash below is pinned.

pub const DS_SHELL: &str = include_str!("ds_shell.html");

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    #[test]
    fn the_shell_is_pinned() {
        let digest = Sha256::digest(DS_SHELL.as_bytes());
        let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
        assert_eq!(hex, PINNED_SHA256);
    }

    #[test]
    fn the_shell_loads_nothing_from_the_network() {
        assert!(!DS_SHELL.contains("http://") && !DS_SHELL.contains("https://"));
    }

    const PINNED_SHA256: &str = "148bfd23119b8d512fc0080dc5fcd5d4e4767c62b3bf59b5757a7d0cbfbedca1";
}
