//! The canvas wrapper page. Its script is the only thing in the canvas view that Zorvo wrote
//! for the page itself, so a change must be a visible one: the hash below is pinned.

pub const CANVAS_SHELL: &str = include_str!("canvas_shell.html");

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    #[test]
    fn canvas_shell_hash_is_pinned() {
        let digest = Sha256::digest(CANVAS_SHELL.as_bytes());
        let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
        assert_eq!(hex, PINNED_SHA256);
    }

    #[test]
    fn the_shell_loads_nothing_from_the_network() {
        assert!(!CANVAS_SHELL.contains("http://") && !CANVAS_SHELL.contains("https://"));
    }

    const PINNED_SHA256: &str = "19e8293d4408f38ebab660fc4c40b251066002172bb4cba7f5d1488972655b53";
}
