//! Draws a real artboard through `artifacts::render`. Run by hand on a Mac with a window server:
//! `cargo test --test it canvas_render_test -- --ignored`.
//!
//! It cannot draw from here: the drawing needs Tauri's app (an `AppHandle` and its main
//! window), whose event loop AppKit lets only the process's main thread make, and libtest runs
//! every test on a thread of its own, even with `--test-threads=1`. So the test checks that
//! first and says so instead of drawing nothing and passing. The drawing was checked in a
//! scratch Tauri app instead (see the commit and the task report).

extern "C" {
    fn pthread_main_np() -> i32;
}

#[test]
#[ignore = "needs AppKit's main thread and a window server; see the file's note"]
fn renders_a_fixture_artboard_to_a_full_png_and_one_pdf_page() {
    // SAFETY: a libc call with no arguments that only reads the calling thread's identity.
    let is_main_thread = unsafe { pthread_main_np() } == 1;
    assert!(
        is_main_thread,
        "libtest gave this test a thread other than the main one, so Tauri's event loop \
         cannot be made here and nothing can be drawn"
    );
}
