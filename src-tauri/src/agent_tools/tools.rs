//! The tools an agent can call, their JSON schemas, and the checks on
//! their arguments. Only shapes are checked here; what a folder or an agent
//! name means is decided later, with the webview and the store.

use serde_json::{json, Map, Value};

pub const TOOL_NAMES: [&str; 9] = [
    "list_agents",
    "delegate",
    "start_session",
    "read_session",
    "stop_session",
    "show_artifact",
    "artifact_guide",
    "browser",
    "browser_guide",
];
pub const MAX_TEXT_CHARS: usize = 20_000;
pub const MAX_TITLE_CHARS: usize = 60;
const MAX_NAME_CHARS: usize = 200;
const MAX_FOLDER_CHARS: usize = 4096;
const MAX_PATH_CHARS: usize = 4096;

/// The `tools` array for `tools/list`.
pub fn tool_list() -> Value {
    let mut tools = json!([
        {
            "name": "list_agents",
            "description": "List the coding agents you can hand work to, the sessions you have opened, and the folders a new session may be opened in.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }
        },
        {
            "name": "delegate",
            "description": "Hand a task to another agent. It works in the same folder as you and its answer arrives later as a message, so this call returns at once. Calling it again for the same agent continues the same session. Say what you need and what you already know: the agent starts with a summary of this conversation, not all of it.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "agent": { "type": "string", "description": "An agent id from list_agents." },
                    "task": { "type": "string", "maxLength": MAX_TEXT_CHARS, "description": "What the agent should do. Not a slash command." }
                },
                "required": ["agent", "task"],
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
                    "handle": { "type": "string", "description": "A handle returned by delegate, start_session or list_agents." },
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
                    "handle": { "type": "string", "description": "A handle returned by delegate, start_session or list_agents." }
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
    ]);
    tools.as_array_mut().unwrap().extend([
        json!({"name":"browser", "description":"Operate Zorvo's browser. Open a page with operation tabs.open and url. Scroll the current WebKit page with operation scroll and deltaY (positive is down), without listing tabs first. Omit tabID to use the active WebKit tab; Chromium requires tabID from tabs.open or tabs.list. WebKit is the native in-app view; engine chromium opens an isolated installed Chromium window for advanced diagnostics. Requires the user's session browser grant. File transfers need separate approval. Read browser_guide for advanced operation details.",
            "inputSchema":browser_input_schema()}),
        json!({"name":"browser_guide","description":"List browser operations, parameters, engine limits and permission rules.","inputSchema":{"type":"object","properties":{},"additionalProperties":false}}),
    ]);
    tools
}

/// Code-mode clients generate function signatures from named properties, not
/// `additionalProperties`. Publish every public parameter so they can pass a
/// URL, tab id or scroll distance without first fetching the whole guide.
fn browser_input_schema() -> Value {
    let catalog: Value =
        serde_json::from_str(include_str!("../../resources/browser-cdp/catalog.json"))
            .expect("bundled browser catalog");
    let mut properties = Map::new();
    for tool in catalog.as_object().expect("browser operations").values() {
        for (name, schema) in tool["inputSchema"]["properties"]
            .as_object()
            .expect("browser operation parameters")
        {
            properties
                .entry(name.clone())
                .or_insert_with(|| schema.clone());
        }
    }
    properties.insert(
        "operation".into(),
        json!({"type":"string", "enum":crate::browser_commands::OPERATIONS}),
    );
    properties.insert(
        "engine".into(),
        json!({"type":"string", "enum":["webkit","chromium"], "default":"webkit"}),
    );
    properties.insert(
        "title".into(),
        json!({"type":"string", "description":"Title when previewing a local HTML file."}),
    );
    // Some model adapters reject an array branch without an items schema.
    properties.get_mut("fields").expect("form fields")["items"]["properties"]["value"] = json!({
        "anyOf":[{"type":"string"},{"type":"boolean"},{"type":"array","items":{"type":"string"}}]
    });
    for (name, description) in [
        ("url", "HTTP or HTTPS URL for tabs.open or navigate."),
        ("tabID", "Tab id from tabs.open or tabs.list. Omit for the active WebKit tab; required for Chromium tab operations."),
        ("frameID", "Optional frame id returned by frames."),
        ("ref", "Element reference returned by snapshot."),
        ("deltaX", "Horizontal scroll distance in pixels."),
        ("deltaY", "Vertical scroll distance in pixels; positive scrolls down."),
    ] {
        properties.get_mut(name).expect("browser parameter")["description"] = json!(description);
    }
    json!({"type":"object", "properties":properties, "required":["operation"], "additionalProperties":false})
}

/// Checks `args` for `tool` and returns them cleaned (strings trimmed), or a
/// sentence for the agent. An error never repeats what the agent sent.
pub fn validate(tool: &str, args: &Value) -> Result<Value, String> {
    let object = args
        .as_object()
        .ok_or_else(|| "The arguments must be a JSON object.".to_string())?;
    if tool == "browser" {
        return crate::browser_commands::validate_args(args);
    }
    let allowed: &[&str] = match tool {
        "list_agents" | "artifact_guide" | "browser_guide" => &[],
        "show_artifact" => &["path", "title"],
        "delegate" => &["agent", "task"],
        "start_session" => &["agent", "brief", "title", "worktree", "folder"],
        "read_session" => &["handle", "max_chars"],
        "stop_session" => &["handle"],
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
        "delegate" => {
            put_name(&mut clean, object, "agent", true)?;
            put_text(&mut clean, object, "task", true)?;
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
    fn lists_exactly_the_registered_tools() {
        let list = tool_list();
        let tools = list.as_array().unwrap();
        let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(names, TOOL_NAMES);
        assert_eq!(
            names,
            [
                "list_agents",
                "delegate",
                "start_session",
                "read_session",
                "stop_session",
                "show_artifact",
                "artifact_guide",
                "browser",
                "browser_guide"
            ]
        );
        for tool in tools {
            assert_eq!(tool["inputSchema"]["type"], "object");
            assert_eq!(tool["inputSchema"]["additionalProperties"], false);
            assert!(!tool["description"].as_str().unwrap().is_empty());
        }
    }

    #[test]
    fn browser_signature_exposes_the_public_operation_parameters() {
        let schema = browser_input_schema();
        let properties = schema["properties"].as_object().unwrap();
        let catalog: Value =
            serde_json::from_str(include_str!("../../resources/browser-cdp/catalog.json")).unwrap();
        for (operation, tool) in catalog.as_object().unwrap() {
            for (name, source) in tool["inputSchema"]["properties"].as_object().unwrap() {
                let mut expected = source.clone();
                if name == "fields" {
                    expected["items"]["properties"]["value"] = json!({"anyOf":[
                        {"type":"string"}, {"type":"boolean"},
                        {"type":"array", "items":{"type":"string"}}
                    ]});
                }
                let mut actual = properties
                    .get(name)
                    .unwrap_or_else(|| panic!("missing {operation} parameter {name}"))
                    .clone();
                actual.as_object_mut().unwrap().remove("description");
                assert_eq!(actual, expected, "{operation} parameter {name}");
            }
        }
        assert_eq!(schema["required"], json!(["operation"]));
        assert_eq!(
            properties["operation"]["enum"],
            json!(crate::browser_commands::OPERATIONS)
        );
        assert_eq!(properties["engine"]["default"], "webkit");
        assert_eq!(properties["title"]["type"], "string");
        for internal in ["approval", "_zorvoCallId", "_zorvoGrant"] {
            assert!(!properties.contains_key(internal), "{internal}");
        }
    }

    #[test]
    fn browser_calls_keep_navigation_and_scroll_parameters() {
        for args in [
            json!({"operation":"tabs.open", "url":"https://example.com/", "focus":true}),
            json!({"operation":"scroll", "deltaY":800}),
            json!({"operation":"scroll", "tabID":"tab_1", "deltaX":0, "deltaY":640}),
        ] {
            assert_eq!(validate("browser", &args).unwrap(), args);
        }
    }

    #[test]
    fn accepts_a_delegate_call_and_trims_it() {
        let args = validate(
            "delegate",
            &json!({"agent": " qwen-code ", "task": " review it "}),
        )
        .unwrap();
        assert_eq!(args, json!({"agent": "qwen-code", "task": "review it"}));
    }

    #[test]
    fn refuses_an_empty_a_slash_and_an_overlong_task() {
        for task in ["".to_string(), "  ".to_string(), "/review".to_string()] {
            assert!(validate("delegate", &json!({"agent": "a", "task": task})).is_err());
        }
        let long = "x".repeat(MAX_TEXT_CHARS + 1);
        assert!(validate("delegate", &json!({"agent": "a", "task": long})).is_err());
        assert!(validate("delegate", &json!({"agent": "a"})).is_err());
    }

    #[test]
    fn counts_characters_not_bytes() {
        let ok = "é".repeat(MAX_TEXT_CHARS);
        assert!(validate("delegate", &json!({"agent": "a", "task": ok})).is_ok());
        let bad = "é".repeat(MAX_TEXT_CHARS + 1);
        assert!(validate("delegate", &json!({"agent": "a", "task": bad})).is_err());
    }

    #[test]
    fn refuses_unknown_tools_keys_and_wrong_types() {
        assert!(validate("run", &json!({})).is_err());
        assert!(validate("delegate", &json!({"agent": 1, "task": "t"})).is_err());
        assert!(validate("delegate", &json!({"agent": "a", "task": "t", "cwd": "/"})).is_err());
        assert!(validate("delegate", &json!("text")).is_err());
        assert!(validate("list_agents", &json!({"x": 1})).is_err());
        assert_eq!(validate("list_agents", &json!({})).unwrap(), json!({}));
    }

    #[test]
    fn an_error_never_repeats_the_task_text() {
        let task = format!("SECRET-{}", "y".repeat(MAX_TEXT_CHARS));
        let error = validate("delegate", &json!({"agent": "a", "task": task})).unwrap_err();
        assert!(!error.contains(&task[..50]));
        let error = validate(
            "delegate",
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
}
