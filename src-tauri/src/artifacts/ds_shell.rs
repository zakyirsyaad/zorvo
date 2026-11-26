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

    const PINNED_SHA256: &str = "117457ad0f12ff402a508629b2bd690c5fcb632e020e4e10b2eb22cc923cd0dc";
}
