use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use zorvo_lib::acp::prompt_blocks::{prompt_blocks, MAX_INLINE_IMAGE_BYTES};

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "acp-blocks-{}-{}-{}",
        tag,
        std::process::id(),
        nanos
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn sends_text_alone_when_nothing_is_attached() {
    let blocks = prompt_blocks("hello", &[], true, &std::env::temp_dir()).unwrap();

    assert_eq!(
        blocks,
        vec![serde_json::json!({ "type": "text", "text": "hello" })]
    );
}

#[test]
fn inlines_images_and_links_other_files() {
    let dir = temp_dir("mixed");
    let image = dir.join("shot one.png");
    let notes = dir.join("notes.md");
    fs::write(&image, [0x89, b'P', b'N', b'G']).unwrap();
    fs::write(&notes, "# notes").unwrap();
    let attachments = [
        image.to_string_lossy().to_string(),
        notes.to_string_lossy().to_string(),
    ];

    let blocks = prompt_blocks("look", &attachments, true, &dir).unwrap();

    assert_eq!(blocks[0]["type"], "text");
    assert_eq!(blocks[1]["type"], "image");
    assert_eq!(blocks[1]["mimeType"], "image/png");
    assert_eq!(blocks[1]["data"], "iVBORw==");
    assert_eq!(blocks[2]["type"], "resource_link");
    assert_eq!(blocks[2]["name"], "notes.md");
    assert!(blocks[2]["uri"].as_str().unwrap().starts_with("file:///"));
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn links_images_when_the_agent_cannot_take_them_or_they_are_too_big() {
    let dir = temp_dir("links");
    let small = dir.join("small.jpg");
    let big = dir.join("big.webp");
    fs::write(&small, [1, 2, 3]).unwrap();
    fs::write(&big, vec![0u8; MAX_INLINE_IMAGE_BYTES as usize + 1]).unwrap();

    let no_images =
        prompt_blocks("x", &[small.to_string_lossy().to_string()], false, &dir).unwrap();
    let too_big = prompt_blocks("x", &[big.to_string_lossy().to_string()], true, &dir).unwrap();

    assert_eq!(no_images[1]["type"], "resource_link");
    assert_eq!(too_big[1]["type"], "resource_link");
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn refuses_relative_paths_and_missing_files() {
    assert!(prompt_blocks(
        "x",
        &["relative.png".to_string()],
        true,
        &std::env::temp_dir()
    )
    .is_err());
    assert!(prompt_blocks(
        "x",
        &["/definitely/not/here.png".to_string()],
        true,
        &std::env::temp_dir()
    )
    .is_err());
}

#[test]
fn names_a_linked_file_outside_the_session_folder_in_a_last_text_block() {
    let dir = temp_dir("outside");
    let work = dir.join("work");
    let downloads = dir.join("Downloads");
    fs::create_dir_all(&work).unwrap();
    fs::create_dir_all(&downloads).unwrap();
    let report = downloads.join("Zaky's report.docx");
    fs::write(&report, "doc").unwrap();
    let attachments = [report.to_string_lossy().to_string()];

    let blocks = prompt_blocks("read this", &attachments, true, &work).unwrap();

    assert_eq!(blocks.len(), 3);
    assert_eq!(
        blocks[0],
        serde_json::json!({ "type": "text", "text": "read this" })
    );
    assert_eq!(blocks[1]["type"], "resource_link");
    let note = blocks[2]["text"].as_str().unwrap();
    assert_eq!(blocks[2]["type"], "text");
    assert!(note.contains("outside the working folder"), "{note}");
    assert!(note.contains(&format!("- {}", report.display())), "{note}");
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn adds_no_note_for_files_inside_the_session_folder() {
    let dir = temp_dir("inside");
    let notes = dir.join("docs").join("notes.md");
    fs::create_dir_all(notes.parent().unwrap()).unwrap();
    fs::write(&notes, "# notes").unwrap();

    let blocks = prompt_blocks("x", &[notes.to_string_lossy().to_string()], true, &dir).unwrap();

    assert_eq!(blocks.len(), 2);
    assert_eq!(blocks[1]["type"], "resource_link");
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn adds_no_note_for_an_image_sent_inline_from_outside() {
    let dir = temp_dir("inline-outside");
    let work = dir.join("work");
    fs::create_dir_all(&work).unwrap();
    let image = dir.join("shot.png");
    fs::write(&image, [0x89, b'P', b'N', b'G']).unwrap();

    let blocks = prompt_blocks("x", &[image.to_string_lossy().to_string()], true, &work).unwrap();

    assert_eq!(blocks.len(), 2);
    assert_eq!(blocks[1]["type"], "image");
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn escapes_control_characters_in_a_named_path() {
    let dir = temp_dir("control");
    let work = dir.join("work");
    fs::create_dir_all(&work).unwrap();
    let odd = dir.join("a\nb.txt");
    fs::write(&odd, "x").unwrap();

    let blocks = prompt_blocks("x", &[odd.to_string_lossy().to_string()], true, &work).unwrap();

    let note = blocks[2]["text"].as_str().unwrap();
    assert!(note.contains("a\\u{a}b.txt"), "{note}");
    assert_eq!(
        note.lines().filter(|line| line.starts_with("- ")).count(),
        1,
        "{note}"
    );
    fs::remove_dir_all(&dir).unwrap();
}
