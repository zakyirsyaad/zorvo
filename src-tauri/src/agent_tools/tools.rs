//! The eight tools an agent can call, their JSON schemas, and the checks on
//! their arguments. Only shapes are checked here; what a folder or an agent
//! name means is decided later, with the webview and the store.

use serde_json::{json, Map, Value};

pub const TOOL_NAMES: [&str; 8] = [
    "list_agents",
    "start_worker",
    "send",
    "start_session",
    "read_session",
    "stop_session",
    "show_artifact",
    "artifact_guide",
];
/// The only tool a worker's token lists or calls. Not in `TOOL_NAMES`: a coordinator never sees it.
pub const WORKER_TOOL_NAMES: [&str; 1] = ["done"];
pub const MAX_TEXT_CHARS: usize = 20_000;
pub const MAX_TITLE_CHARS: usize = 60;
pub const MAX_SUMMARY_CHARS: usize = 2_000;
pub const MAX_FILES: usize = 50;
const MAX_NAME_CHARS: usize = 200;
const MAX_FOLDER_CHARS: usize = 4096;
const MAX_PATH_CHARS: usize = 4096;

/// The `tools` array for `tools/list`.
pub fn tool_list() -> Value {
    json!([
        {
            "name": "list_agents",
            "description": "List the coding agents you can start as workers, the workers and sessions you have started, and the folders a new session may be opened in.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }
        },
        {
            "name": "start_worker",
            "description": "Start another agent as a worker on a task. It returns at once. End your turn after starting your workers: each result arrives later as a message. Use worktree new when workers would edit the same files; a new worktree starts from the last commit, so changes that are not committed are not in it.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "agent": { "type": "string", "description": "An agent id from list_agents." },
                    "task": { "type": "string", "maxLength": MAX_TEXT_CHARS, "description": "What the worker should do. Not a slash command." },
                    "title": { "type": "string", "maxLength": MAX_TITLE_CHARS, "description": "A short name for the session and its branch." },
                    "worktree": { "type": "string", "enum": ["current", "new"], "description": "current (the default) works in your folder; new gives the worker a worktree of its own on a new branch." }
                },
                "required": ["agent", "task"],
                "additionalProperties": false
            }
        },
        {
            "name": "send",
            "description": "Give a worker you started a further task. It continues in the same session with what it already knows. Its result arrives later as a message.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "handle": { "type": "string", "description": "A worker's handle, from start_worker or list_agents." },
                    "message": { "type": "string", "maxLength": MAX_TEXT_CHARS, "description": "The further task. Not a slash command." }
                },
                "required": ["handle", "message"],
                "additionalProperties": false
            }
        },
        {
            "name": "start_session",
            "description": "Open an independent session of an agent with a first message. The brief is all the new session knows, so make it self-contained. The user stays in their own session; read the result later with read_session.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "agent": { "type": "string", "description": "An agent id from list_agents." },
                    "brief": { "type": "string", "maxLength": MAX_TEXT_CHARS, "description": "The first message of the new session. Not a slash command." },
                    "title": { "type": "string", "maxLength": MAX_TITLE_CHARS, "description": "A short name for the session." },
                    "worktree": { "type": "boolean", "description": "Give the session a worktree of its own, on a new branch." },
                    "folder": { "type": "string", "description": "A path from the folders list_agents returned." }
                },
                "required": ["agent", "brief"],
                "additionalProperties": false
            }
        },
        {
            "name": "read_session",
            "description": "Read the newest finished answer of a session you opened, with its state and the files it reported changing.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "handle": { "type": "string", "description": "A handle returned by start_worker, start_session or list_agents." },
                    "max_chars": { "type": "integer", "minimum": 1, "maximum": MAX_TEXT_CHARS, "description": "Cut the answer to this many characters." }
                },
                "required": ["handle"],
                "additionalProperties": false
            }
        },
        {
            "name": "stop_session",
            "description": "Stop the running turn of a session you opened. It does not close the session or remove its work.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "handle": { "type": "string", "description": "A handle returned by start_worker, start_session or list_agents." }
                },
                "required": ["handle"],
                "additionalProperties": false
            }
        },
        {
            "name": "show_artifact",
            "description": "Show the user a web page you wrote, beside the chat. Use it without being asked whenever your answer is better seen than read: a report, a summary of what changed, a comparison, a chart, a diagram, a dashboard, a mockup of a screen, or something the user can click through. Do not use it for an answer that is short text or code. Write one self-contained .html file in this folder or the temporary folder, then call this with its path. Calling it again for the same path shows a new version. Scripts may come only from cdnjs.cloudflare.com, cdn.jsdelivr.net/npm/, unpkg.com, cdn.tailwindcss.com and code.jquery.com, with an exact version; fonts from Google Fonts; images as data URIs. The page cannot fetch anything or keep data. Call artifact_guide before your first page.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "maxLength": MAX_PATH_CHARS, "description": "The .html file, absolute or relative to this folder." },
                    "title": { "type": "string", "maxLength": MAX_TITLE_CHARS, "description": "A short name for the page. Needed the first time a path is shown; later it renames." }
                },
                "required": ["path"],
                "additionalProperties": false
            }
        },
        {
            "name": "artifact_guide",
            "description": "How to design a page for show_artifact: colours for light and dark, layout, charts. Read it once before your first page.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }
        }
    ])
}

/// The `tools` array for `tools/list` of a worker: `done` and nothing else.
pub fn worker_tool_list() -> Value {
    json!([
        {
            "name": "done",
            "description": "Report the result of your task to the session that gave it to you. Call it once when you finish: outcome succeeded or failed, and a short summary of what you did, what you found and what is left. Then end your turn.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "outcome": { "type": "string", "enum": ["succeeded", "failed"], "description": "succeeded when the task is done, failed when it is not." },
                    "summary": { "type": "string", "maxLength": MAX_SUMMARY_CHARS, "description": "What you did, what you found, what is left." },
                    "files": { "type": "array", "items": { "type": "string" }, "maxItems": MAX_FILES, "description": "Paths you changed, relative to your folder." }
                },
                "required": ["outcome", "summary"],
                "additionalProperties": false
            }
        }
    ])
}

/// Checks `args` for `tool` and returns them cleaned (strings trimmed), or a
/// sentence for the agent. An error never repeats what the agent sent.
pub fn validate(tool: &str, args: &Value) -> Result<Value, String> {
    let object = args
        .as_object()
        .ok_or_else(|| "The arguments must be a JSON object.".to_string())?;
    let allowed: &[&str] = match tool {
        "list_agents" | "artifact_guide" => &[],
        "show_artifact" => &["path", "title"],
        "start_worker" => &["agent", "task", "title", "worktree"],
        "send" => &["handle", "message"],
        "start_session" => &["agent", "brief", "title", "worktree", "folder"],
        "read_session" => &["handle", "max_chars"],
        "stop_session" => &["handle"],
        "done" => &["outcome", "summary", "files"],
        _ => return Err("That tool does not exist.".to_string()),
    };
    if object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(format!(
            "Unknown argument. {tool} takes: {}.",
            if allowed.is_empty() {
                "none".to_string()
            } else {
                allowed.join(", ")
            }
        ));
    }
    let mut clean = Map::new();
    match tool {
        "start_worker" => {
            put_name(&mut clean, object, "agent", true)?;
            put_text(&mut clean, object, "task", true)?;
            put_title(&mut clean, object)?;
            put_worker_worktree(&mut clean, object)?;
        }
        "send" => {
            put_name(&mut clean, object, "handle", true)?;
            put_text(&mut clean, object, "message", true)?;
        }
        "start_session" => {
            put_name(&mut clean, object, "agent", true)?;
            put_text(&mut clean, object, "brief", true)?;
            put_title(&mut clean, object)?;
            put_worktree(&mut clean, object)?;
            put_folder(&mut clean, object)?;
        }
        "read_session" => {
            put_name(&mut clean, object, "handle", true)?;
            put_max_chars(&mut clean, object)?;
        }
        "stop_session" => put_name(&mut clean, object, "handle", true)?,
        "done" => {
            put_outcome(&mut clean, object)?;
            put_summary(&mut clean, object)?;
            put_files(&mut clean, object)?;
        }
        "show_artifact" => {
            put_path(&mut clean, object)?;
            put_title(&mut clean, object)?;
        }
        _ => {}
    }
    Ok(Value::Object(clean))
}

fn string_of<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    required: bool,
) -> Result<Option<&'a str>, String> {
    match object.get(key) {
        None | Some(Value::Null) if !required => Ok(None),
        None | Some(Value::Null) => Err(format!("{key} is required.")),
        Some(Value::String(text)) => Ok(Some(text)),
        Some(_) => Err(format!("{key} must be a string.")),
    }
}

fn put_name(
    out: &mut Map<String, Value>,
    object: &Map<String, Value>,
    key: &str,
    required: bool,
) -> Result<(), String> {
    let Some(text) = string_of(object, key, required)? else {
        return Ok(());
    };
    let text = text.trim();
    if text.is_empty() {
        return Err(format!("{key} must not be empty."));
    }
    if text.chars().count() > MAX_NAME_CHARS {
        return Err(format!("{key} is too long."));
    }
    if text.chars().any(char::is_control) {
        return Err(format!("{key} must not contain control characters."));
    }
    out.insert(key.to_string(), json!(text));
    Ok(())
}

fn put_text(
    out: &mut Map<String, Value>,
    object: &Map<String, Value>,
    key: &str,
    required: bool,
) -> Result<(), String> {
    let Some(text) = string_of(object, key, required)? else {
        return Ok(());
    };
    let text = text.trim();
    if text.is_empty() {
        return Err(format!("{key} must not be empty."));
    }
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err(format!("{key} is over {MAX_TEXT_CHARS} characters."));
    }
    if text.starts_with('/') {
        return Err(format!(
            "{key} must not start with a slash: a slash command would not run in the other agent."
        ));
    }
    out.insert(key.to_string(), json!(text));
    Ok(())
}

fn put_title(out: &mut Map<String, Value>, object: &Map<String, Value>) -> Result<(), String> {
    let Some(text) = string_of(object, "title", false)? else {
        return Ok(());
    };
    let text = text.trim();
    if text.chars().count() > MAX_TITLE_CHARS {
        return Err(format!("title is over {MAX_TITLE_CHARS} characters."));
    }
    if text.chars().any(char::is_control) {
        return Err("title must not contain control characters.".to_string());
    }
    if !text.is_empty() {
        out.insert("title".to_string(), json!(text));
    }
    Ok(())
}

fn put_outcome(out: &mut Map<String, Value>, object: &Map<String, Value>) -> Result<(), String> {
    match string_of(object, "outcome", true)? {
        Some(choice @ ("succeeded" | "failed")) => {
            out.insert("outcome".to_string(), json!(choice));
            Ok(())
        }
        _ => Err("outcome must be succeeded or failed.".to_string()),
    }
}

fn put_summary(out: &mut Map<String, Value>, object: &Map<String, Value>) -> Result<(), String> {
    // `required` makes `string_of` fail on a missing value, so it is always `Some` here.
    let text = string_of(object, "summary", true)?.map_or("", str::trim);
    if text.is_empty() {
        return Err("summary must not be empty.".to_string());
    }
    if text.chars().count() > MAX_SUMMARY_CHARS {
        return Err(format!("summary is over {MAX_SUMMARY_CHARS} characters."));
    }
    out.insert("summary".to_string(), json!(text));
    Ok(())
}

fn put_files(out: &mut Map<String, Value>, object: &Map<String, Value>) -> Result<(), String> {
    let list = match object.get("files") {
        None | Some(Value::Null) => return Ok(()),
        Some(Value::Array(list)) => list,
        Some(_) => return Err("files must be a list of paths.".to_string()),
    };
    if list.len() > MAX_FILES {
        return Err(format!("files has more than {MAX_FILES} paths."));
    }
    let mut files = Vec::with_capacity(list.len());
    for entry in list {
        let Some(text) = entry.as_str().map(str::trim) else {
            return Err("every file must be a string.".to_string());
        };
        if text.is_empty() {
            return Err("a file path must not be empty.".to_string());
        }
        if text.chars().count() > MAX_PATH_CHARS {
            return Err("a file path is too long.".to_string());
        }
        // These paths are quoted in a report another agent reads: a line break could fake a line.
        if text.chars().any(char::is_control) {
            return Err("a file path must not contain control characters.".to_string());
        }
        files.push(json!(text));
    }
    out.insert("files".to_string(), Value::Array(files));
    Ok(())
}

fn put_worktree(out: &mut Map<String, Value>, object: &Map<String, Value>) -> Result<(), String> {
    match object.get("worktree") {
        None | Some(Value::Null) => Ok(()),
        Some(Value::Bool(flag)) => {
            out.insert("worktree".to_string(), json!(flag));
            Ok(())
        }
        Some(_) => Err("worktree must be true or false.".to_string()),
    }
}

fn put_worker_worktree(
    out: &mut Map<String, Value>,
    object: &Map<String, Value>,
) -> Result<(), String> {
    match string_of(object, "worktree", false)? {
        None => Ok(()),
        Some(choice @ ("current" | "new")) => {
            out.insert("worktree".to_string(), json!(choice));
            Ok(())
        }
        Some(_) => Err("worktree must be current or new.".to_string()),
    }
}

fn put_folder(out: &mut Map<String, Value>, object: &Map<String, Value>) -> Result<(), String> {
    let Some(text) = string_of(object, "folder", false)? else {
        return Ok(());
    };
    let text = text.trim();
    if text.chars().count() > MAX_FOLDER_CHARS {
        return Err("folder is too long.".to_string());
    }
    if !text.starts_with('/') || text.chars().any(char::is_control) {
        return Err("folder must be an absolute path from the list_agents folders.".to_string());
    }
    out.insert("folder".to_string(), json!(text));
    Ok(())
}

/// The file an agent wants shown. Only its shape is checked here; where it
/// may point is decided when it is read.
fn put_path(out: &mut Map<String, Value>, object: &Map<String, Value>) -> Result<(), String> {
    let Some(text) = string_of(object, "path", true)? else {
        return Ok(());
    };
    let text = text.trim();
    if text.is_empty() {
        return Err("path must not be empty.".to_string());
    }
    if text.chars().count() > MAX_PATH_CHARS {
        return Err("path is too long.".to_string());
    }
    if text.chars().any(char::is_control) {
        return Err("path must not contain control characters.".to_string());
    }
    out.insert("path".to_string(), json!(text));
    Ok(())
}

fn put_max_chars(out: &mut Map<String, Value>, object: &Map<String, Value>) -> Result<(), String> {
    let value = match object.get("max_chars") {
        None | Some(Value::Null) => return Ok(()),
        Some(value) => value,
    };
    let valid = value
        .as_u64()
        .filter(|n| (1..=MAX_TEXT_CHARS as u64).contains(n));
    match valid {
        Some(n) => {
            out.insert("max_chars".to_string(), json!(n));
            Ok(())
        }
        None => Err(format!(
            "max_chars must be a whole number from 1 to {MAX_TEXT_CHARS}."
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn description_of(name: &str) -> String {
        tool_list()
            .as_array()
            .and_then(|tools| tools.iter().find(|tool| tool["name"] == name))
            .and_then(|tool| tool["description"].as_str())
            .expect("a listed tool")
            .to_string()
    }

    #[test]
    fn show_artifact_says_when_to_use_it_unasked() {
        // An agent reads only this: with no word on when, it shows a page only when told to.
        let description = description_of("show_artifact");

        assert!(description.contains("without being asked"), "{description}");
        for kind in ["report", "chart", "diagram", "dashboard", "mockup"] {
            assert!(description.contains(kind), "{kind} in {description}");
        }
        assert!(description.contains("Do not use it"), "{description}");
    }

    #[test]
    fn show_artifact_takes_a_path_and_an_optional_title() {
        let args = validate(
            "show_artifact",
            &json!({"path": " out/report.html ", "title": " Report "}),
        )
        .unwrap();
        assert_eq!(args, json!({"path": "out/report.html", "title": "Report"}));
        let bare = validate("show_artifact", &json!({"path": "/tmp/a.html"})).unwrap();
        assert_eq!(bare, json!({"path": "/tmp/a.html"}));
    }

    #[test]
    fn show_artifact_needs_a_path() {
        assert!(validate("show_artifact", &json!({"title": "Report"})).is_err());
        assert!(validate("show_artifact", &json!({"path": "  "})).is_err());
        assert!(validate("show_artifact", &json!({"path": 3})).is_err());
    }

    #[test]
    fn show_artifact_refuses_an_unknown_argument() {
        let refused = validate("show_artifact", &json!({"path": "a.html", "html": "<p>"}));
        assert!(refused
            .unwrap_err()
            .contains("show_artifact takes: path, title"));
    }

    #[test]
    fn show_artifact_refuses_a_path_over_the_cap_without_repeating_it() {
        let long = format!("{}.html", "secret-name".repeat(400));
        let refused = validate("show_artifact", &json!({"path": long})).unwrap_err();
        assert!(!refused.contains("secret-name"));
        let control = validate("show_artifact", &json!({"path": "a\u{0}.html"})).unwrap_err();
        assert!(!control.contains("a\u{0}"));
    }

    #[test]
    fn show_artifact_caps_the_title() {
        let long = "x".repeat(MAX_TITLE_CHARS + 1);
        assert!(validate("show_artifact", &json!({"path": "a.html", "title": long})).is_err());
    }

    #[test]
    fn artifact_guide_takes_no_arguments() {
        assert_eq!(validate("artifact_guide", &json!({})).unwrap(), json!({}));
        assert!(validate("artifact_guide", &json!({"topic": "charts"})).is_err());
    }

    #[test]
    fn show_artifact_names_every_host_a_page_may_load_from() {
        let list = tool_list();
        let description = list
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["name"] == "show_artifact")
            .unwrap()["description"]
            .as_str()
            .unwrap()
            .to_string();
        for host in [
            "cdnjs.cloudflare.com",
            "cdn.jsdelivr.net/npm/",
            "unpkg.com",
            "cdn.tailwindcss.com",
            "code.jquery.com",
            "Google Fonts",
            "artifact_guide",
        ] {
            assert!(description.contains(host), "{host}");
        }
    }

    #[test]
    fn lists_exactly_the_eight_tools() {
        let list = tool_list();
        let tools = list.as_array().unwrap();
        let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(names, TOOL_NAMES);
        assert_eq!(
            names,
            [
                "list_agents",
                "start_worker",
                "send",
                "start_session",
                "read_session",
                "stop_session",
                "show_artifact",
                "artifact_guide"
            ]
        );
        for tool in tools {
            assert_eq!(tool["inputSchema"]["type"], "object");
            assert_eq!(tool["inputSchema"]["additionalProperties"], false);
            assert!(!tool["description"].as_str().unwrap().is_empty());
        }
    }

    #[test]
    fn accepts_a_start_worker_call_and_trims_it() {
        let args = validate(
            "start_worker",
            &json!({"agent": " qwen-code ", "task": " review it "}),
        )
        .unwrap();
        assert_eq!(args, json!({"agent": "qwen-code", "task": "review it"}));
    }

    #[test]
    fn refuses_an_empty_a_slash_and_an_overlong_task() {
        for task in ["".to_string(), "  ".to_string(), "/review".to_string()] {
            assert!(validate("start_worker", &json!({"agent": "a", "task": task})).is_err());
        }
        let long = "x".repeat(MAX_TEXT_CHARS + 1);
        assert!(validate("start_worker", &json!({"agent": "a", "task": long})).is_err());
        assert!(validate("start_worker", &json!({"agent": "a"})).is_err());
    }

    #[test]
    fn counts_characters_not_bytes() {
        let ok = "é".repeat(MAX_TEXT_CHARS);
        assert!(validate("start_worker", &json!({"agent": "a", "task": ok})).is_ok());
        let bad = "é".repeat(MAX_TEXT_CHARS + 1);
        assert!(validate("start_worker", &json!({"agent": "a", "task": bad})).is_err());
    }

    #[test]
    fn refuses_unknown_tools_keys_and_wrong_types() {
        assert!(validate("run", &json!({})).is_err());
        assert!(validate("start_worker", &json!({"agent": 1, "task": "t"})).is_err());
        assert!(validate(
            "start_worker",
            &json!({"agent": "a", "task": "t", "cwd": "/"})
        )
        .is_err());
        assert!(validate("start_worker", &json!("text")).is_err());
        assert!(validate("list_agents", &json!({"x": 1})).is_err());
        assert_eq!(validate("list_agents", &json!({})).unwrap(), json!({}));
    }

    #[test]
    fn an_error_never_repeats_the_task_text() {
        let task = format!("SECRET-{}", "y".repeat(MAX_TEXT_CHARS));
        let error = validate("start_worker", &json!({"agent": "a", "task": task})).unwrap_err();
        assert!(!error.contains(&task[..50]));
        let error = validate(
            "start_worker",
            &json!({"agent": "a", "task": "t", "SECRET-key": 1}),
        )
        .unwrap_err();
        assert!(!error.contains("SECRET"));
    }

    #[test]
    fn start_session_takes_its_optional_fields() {
        let ok = validate(
            "start_session",
            &json!({
                "agent": "pi", "brief": " go ", "title": "t".repeat(60),
                "worktree": true, "folder": "/Users/me/work"
            }),
        )
        .unwrap();
        assert_eq!(ok["brief"], "go");
        assert_eq!(ok["worktree"], true);
        let long = json!({"agent": "pi", "brief": "b", "title": "t".repeat(61)});
        assert!(validate("start_session", &long).is_err());
        let relative = json!({"agent": "pi", "brief": "b", "folder": "work"});
        assert!(validate("start_session", &relative).is_err());
        let flag = json!({"agent": "pi", "brief": "b", "worktree": "yes"});
        assert!(validate("start_session", &flag).is_err());
    }

    #[test]
    fn read_session_bounds_max_chars() {
        for bad in [json!(0), json!(20_001), json!(1.5), json!("5")] {
            assert!(validate("read_session", &json!({"handle": "h", "max_chars": bad})).is_err());
        }
        let ok = validate("read_session", &json!({"handle": "h", "max_chars": 20_000})).unwrap();
        assert_eq!(ok["max_chars"], 20_000);
        let none = validate("read_session", &json!({"handle": "h"})).unwrap();
        assert!(none.get("max_chars").is_none());
    }

    #[test]
    fn names_refuse_control_characters_and_overlength() {
        assert!(validate("stop_session", &json!({"handle": "a\nb"})).is_err());
        assert!(validate("stop_session", &json!({"handle": "a".repeat(201)})).is_err());
        assert!(validate("stop_session", &json!({"handle": "   "})).is_err());
    }

    #[test]
    fn start_worker_takes_an_agent_a_task_and_a_worktree_choice() {
        let ok = validate(
            "start_worker",
            &json!({"agent": "codex", "task": " Fix it ", "worktree": "new"}),
        )
        .unwrap();
        assert_eq!(ok["task"], "Fix it");
        assert_eq!(ok["worktree"], "new");
        let main = json!({"agent": "codex", "task": "x", "worktree": "main"});
        assert!(validate("start_worker", &main).is_err());
        assert!(validate("start_worker", &json!({"agent": "codex"})).is_err());
        assert!(validate("start_worker", &json!({"agent": "a", "task": "/review"})).is_err());
        let titled = json!({"agent": "a", "task": "t", "title": " Name "});
        assert_eq!(validate("start_worker", &titled).unwrap()["title"], "Name");
        let extra = json!({"agent": "a", "task": "t", "folder": "/"});
        assert!(validate("start_worker", &extra).is_err());
    }

    #[test]
    fn send_takes_a_handle_and_a_message() {
        let ok = validate(
            "send",
            &json!({"handle": "worker-1", "message": " Also fix the tests "}),
        );
        assert_eq!(ok.unwrap()["message"], "Also fix the tests");
        assert!(validate("send", &json!({"handle": "worker-1"})).is_err());
        let extra = json!({"handle": "worker-1", "message": "x", "extra": 1});
        assert!(validate("send", &extra).is_err());
        assert!(validate("send", &json!({"handle": "w", "message": "/compact"})).is_err());
    }

    #[test]
    fn delegate_is_no_longer_a_tool() {
        assert!(!TOOL_NAMES.contains(&"delegate"));
        let list = tool_list();
        assert!(list
            .as_array()
            .unwrap()
            .iter()
            .all(|tool| tool["name"] != "delegate"));
        assert!(validate("delegate", &json!({"agent": "a", "task": "t"})).is_err());
    }

    #[test]
    fn an_error_never_repeats_the_argument() {
        let args = json!({"agent": "codex", "task": "x", "worktree": "SECRET-VALUE"});
        let error = validate("start_worker", &args).unwrap_err();
        assert!(!error.contains("SECRET-VALUE"));
    }

    #[test]
    fn done_needs_an_outcome_and_a_summary() {
        let ok = validate(
            "done",
            &json!({"outcome": "succeeded", "summary": " Fixed it ", "files": [" a.ts "]}),
        )
        .unwrap();
        assert_eq!(
            ok,
            json!({"outcome": "succeeded", "summary": "Fixed it", "files": ["a.ts"]})
        );
        assert!(validate("done", &json!({"outcome": "failed", "summary": "x"})).is_ok());
        assert!(validate("done", &json!({"outcome": "maybe", "summary": "x"})).is_err());
        assert!(validate("done", &json!({"outcome": 1, "summary": "x"})).is_err());
        assert!(validate("done", &json!({"outcome": "failed"})).is_err());
        assert!(validate("done", &json!({"summary": "x"})).is_err());
        assert!(validate("done", &json!({"outcome": "failed", "summary": "  "})).is_err());
        let long = "é".repeat(MAX_SUMMARY_CHARS);
        assert!(validate("done", &json!({"outcome": "failed", "summary": long})).is_ok());
        let longer = "é".repeat(MAX_SUMMARY_CHARS + 1);
        assert!(validate("done", &json!({"outcome": "failed", "summary": longer})).is_err());
        let many = vec!["a"; MAX_FILES + 1];
        let fifty = vec!["a"; MAX_FILES];
        assert!(validate(
            "done",
            &json!({"outcome": "failed", "summary": "x", "files": many})
        )
        .is_err());
        assert!(validate(
            "done",
            &json!({"outcome": "failed", "summary": "x", "files": fifty})
        )
        .is_ok());
        assert!(validate(
            "done",
            &json!({"outcome": "failed", "summary": "x", "files": [" "]})
        )
        .is_err());
        assert!(validate(
            "done",
            &json!({"outcome": "failed", "summary": "x", "files": [1]})
        )
        .is_err());
        assert!(validate(
            "done",
            &json!({"outcome": "failed", "summary": "x", "files": "a"})
        )
        .is_err());
        let path = "p".repeat(MAX_PATH_CHARS + 1);
        assert!(validate(
            "done",
            &json!({"outcome": "failed", "summary": "x", "files": [path]})
        )
        .is_err());
        assert!(validate(
            "done",
            &json!({"outcome": "failed", "summary": "x", "extra": 1})
        )
        .is_err());
    }

    #[test]
    fn a_done_file_path_with_a_control_character_is_refused() {
        let args = json!({"outcome": "failed", "summary": "x", "files": ["SECRET\nfake line"]});
        let error = validate("done", &args).unwrap_err();
        assert!(!error.contains("SECRET"));
    }

    #[test]
    fn a_done_error_never_repeats_what_was_sent() {
        let args = json!({"outcome": "SECRET-OUTCOME", "summary": "x"});
        assert!(!validate("done", &args)
            .unwrap_err()
            .contains("SECRET-OUTCOME"));
        let args = json!({"outcome": "failed", "summary": "x", "files": ["SECRET-FILE", 1]});
        assert!(!validate("done", &args).unwrap_err().contains("SECRET-FILE"));
    }

    #[test]
    fn the_worker_list_holds_done_alone_and_the_coordinator_list_never_does() {
        assert_eq!(WORKER_TOOL_NAMES, ["done"]);
        let worker = worker_tool_list();
        let tools = worker.as_array().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], "done");
        assert_eq!(
            tools[0]["inputSchema"]["required"],
            json!(["outcome", "summary"])
        );
        assert_eq!(tools[0]["inputSchema"]["additionalProperties"], false);
        assert!(!TOOL_NAMES.contains(&"done"));
        assert!(tool_list()
            .as_array()
            .unwrap()
            .iter()
            .all(|tool| tool["name"] != "done"));
    }

    #[test]
    fn the_summary_limits_exist() {
        assert_eq!(MAX_SUMMARY_CHARS, 2_000);
        assert_eq!(MAX_FILES, 50);
    }
}
