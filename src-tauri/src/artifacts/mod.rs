//! Pages an agent makes and Zorvo shows: versioned copies kept per session.
//! Design: `docs/superpowers/specs/2026-11-16-artifacts-design.md`.

pub mod canvas;
pub mod canvas_export;
pub mod canvas_shell;
pub mod canvas_view;
pub mod motion;
pub mod motion_store;
pub mod page_script;
pub mod picks;
pub mod protocol;
pub mod render;
pub mod source;
pub mod store;
pub mod view;
pub mod visual_clean;
pub mod visual_commands;
pub mod visual_export;
pub mod visual_wrapper;
pub mod visuals;

#[cfg(test)]
pub(crate) mod test_support {
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    /// A temp folder removed when the test ends, even on panic.
    pub struct Temp(pub PathBuf);

    impl Temp {
        pub fn new(tag: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock is before the unix epoch")
                .as_nanos();
            // Tests run side by side and reuse tags, and the clock's nanoseconds repeat within a
            // microsecond on macOS: the counter is what makes two folders never the same.
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let n = NEXT.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "zorvo-artifacts-{tag}-{}-{nanos}-{n}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create temp folder");
            Self(fs::canonicalize(path).expect("canonical temp folder"))
        }
    }

    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}
pub mod commands;
