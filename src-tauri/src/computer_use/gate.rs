//! The gate between an agent's call and the driver.
//!
//! Zorvo never forwards what the agent sent. Each tool has a list of fields;
//! the arguments are rebuilt from that list and the copy goes out. A field
//! the list lacks refuses the call. The target of a call is then checked: the
//! process must be an app this session was allowed, and the window must be
//! that process's.

use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::{json, Map, Value};

use super::apps::AppIdentity;
use super::grants::Grants;
use super::requests::{MAX_APPS, MAX_REASON_CHARS};
use super::tiers::{self, Action, Tier};
use crate::agent_tools::peer::ProcessId;

/// How a field's value is checked before it is copied.
#[derive(Clone, Copy, Debug)]
pub enum Kind {
    Int {
        min: i64,
        max: i64,
    },
    Number,
    Bool,
    Text {
        max: usize,
    },
    Choice(&'static [&'static str]),
    /// `verify_state`'s predicates: one to eight objects, passed as they are.
    Predicates,
}

#[derive(Clone, Copy, Debug)]
pub struct Field {
    pub name: &'static str,
    pub kind: Kind,
    pub required: bool,
    pub about: &'static str,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Group {
    /// Needs nothing: answered from the driver's app list.
    Free,
    /// Zorvo's own: shows the user a card.
    Request,
    /// Reads a window of an allowed app.
    Observe,
}

#[derive(Clone, Copy, Debug)]
pub struct ToolSpec {
    pub name: &'static str,
    pub group: Group,
    pub about: &'static str,
    pub fields: &'static [Field],
}

const fn field(name: &'static str, kind: Kind, required: bool, about: &'static str) -> Field {
    Field {
        name,
        kind,
        required,
        about,
    }
}

const PID: Field = field(
    "pid",
    Kind::Int {
        min: 1,
        max: i32::MAX as i64,
    },
    true,
    "The app's process id, from list_apps.",
);
const WINDOW_ID: Field = field(
    "window_id",
    Kind::Int {
        min: 0,
        max: u32::MAX as i64,
    },
    true,
    "The window's id, from list_windows.",
);
const INCLUDE_SCREENSHOT: Field = field(
    "include_screenshot",
    Kind::Bool,
    false,
    "False returns text only.",
);
const PIXEL: Kind = Kind::Number;

/// The tools Zorvo lists and forwards. Every other tool of the driver is
/// refused by name.
pub const TOOLS: &[ToolSpec] = &[
    ToolSpec {
        name: "list_apps",
        group: Group::Free,
        about: "List the apps on this Mac with their bundle ids. Apps you were allowed also show their pid. Call request_access with bundle ids before anything else.",
        fields: &[],
    },
    ToolSpec {
        name: "request_access",
        group: Group::Request,
        about: "Ask the user to let you use apps on their Mac in this session. The user sees each app and ticks the ones you may use; the answer says which were allowed and how far (full use, click only, view only). Ask once for everything a task needs.",
        fields: &[],
    },
    ToolSpec {
        name: "list_windows",
        group: Group::Observe,
        about: "List the windows of an app you were allowed: window_id, title, bounds and whether each is on screen.",
        fields: &[
            PID,
            field(
                "on_screen_only",
                Kind::Bool,
                false,
                "Leave out windows that are not on the current Space.",
            ),
        ],
    },
    ToolSpec {
        name: "get_window_state",
        group: Group::Observe,
        about: "Read one window of an app you were allowed: its accessibility tree as text and a screenshot. A row [N] of the tree is named by the element token <snapshot_id>:N; the snapshot id is in the answer. Start narrow with query or max_depth, and re-read with since after something changed.",
        fields: &[
            PID,
            WINDOW_ID,
            INCLUDE_SCREENSHOT,
            field(
                "include_accessibility_tree",
                Kind::Bool,
                false,
                "False returns the screenshot only.",
            ),
            field(
                "max_depth",
                Kind::Int { min: 1, max: 100 },
                false,
                "How deep the tree is walked. Default 25.",
            ),
            field(
                "max_elements",
                Kind::Int { min: 1, max: 2000 },
                false,
                "How many elements are walked. Default 250.",
            ),
            field(
                "query",
                Kind::Text { max: 200 },
                false,
                "Only rows that contain this text (a|b for either), with their parents.",
            ),
            field(
                "since",
                Kind::Text { max: 100 },
                false,
                "A snapshot id from an earlier read of this window, or \"latest\": returns only what changed.",
            ),
            field(
                "tree_format",
                Kind::Choice(&["markdown", "elements", "both"]),
                false,
                "Default markdown.",
            ),
            field(
                "timeout_ms",
                Kind::Int {
                    min: 100,
                    max: 120_000,
                },
                false,
                "Time for the tree walk. Default 1000.",
            ),
        ],
    },
    ToolSpec {
        name: "zoom",
        group: Group::Observe,
        about: "A closer picture of a region of a window you read with get_window_state, given by its corners in that screenshot's pixels.",
        fields: &[
            PID,
            WINDOW_ID,
            field("x1", PIXEL, true, "Left edge."),
            field("y1", PIXEL, true, "Top edge."),
            field("x2", PIXEL, true, "Right edge."),
            field("y2", PIXEL, true, "Bottom edge."),
        ],
    },
    ToolSpec {
        name: "verify_state",
        group: Group::Observe,
        about: "Check a window against one to eight conditions, all of which must hold: {\"element\": {\"selector\": {\"role\", \"label_contains\"}, \"exists\", \"enabled\", \"selected\", \"value_equals\"}} or {\"window\": {\"exists\", \"bounds\"}}. Each comes back satisfied, unsatisfied or unknown; unknown is not success.",
        fields: &[
            PID,
            WINDOW_ID,
            field(
                "expect",
                Kind::Predicates,
                true,
                "One to eight conditions.",
            ),
            INCLUDE_SCREENSHOT,
            field(
                "stable_samples",
                Kind::Int { min: 1, max: 5 },
                false,
                "Reads in a row that must agree. Default 2.",
            ),
            field(
                "timeout_ms",
                Kind::Int {
                    min: 0,
                    max: 10_000,
                },
                false,
                "How long to wait for the conditions. Default 5000.",
            ),
        ],
    },
];

/// Fields an agent may send that are left out without a word: the driver
/// session is Zorvo's to choose, and so is the size of an image.
const DROPPED: &[&str] = &["session", "max_image_dimension"];
/// Fields that would make the driver write a file.
const OUT_FILES: &[&str] = &["screenshot_out_file", "debug_image_out"];
const MAX_PREDICATE_BYTES: usize = 8 * 1024;

pub fn spec_of(tool: &str) -> Option<&'static ToolSpec> {
    TOOLS.iter().find(|spec| spec.name == tool)
}

pub fn is_offered(tool: &str) -> bool {
    spec_of(tool).is_some()
}

/// What a caller is told about a tool Zorvo does not list. The name is the
/// agent's own text, so it is repeated only when it looks like a tool name.
pub fn not_offered(tool: &str) -> String {
    let is_name = !tool.is_empty()
        && tool.len() <= 40
        && tool.bytes().all(|b| b.is_ascii_lowercase() || b == b'_');
    if is_name {
        format!("Zorvo does not offer {tool}.")
    } else {
        "Zorvo does not offer that tool.".to_string()
    }
}

fn schema_of(kind: Kind) -> Value {
    match kind {
        Kind::Int { min, max } => json!({ "type": "integer", "minimum": min, "maximum": max }),
        Kind::Number => json!({ "type": "number" }),
        Kind::Bool => json!({ "type": "boolean" }),
        Kind::Text { max } => json!({ "type": "string", "maxLength": max }),
        Kind::Choice(choices) => json!({ "type": "string", "enum": choices }),
        Kind::Predicates => json!({
            "type": "array", "minItems": 1, "maxItems": 8, "items": { "type": "object" }
        }),
    }
}

fn input_schema(spec: &ToolSpec) -> Value {
    if spec.group == Group::Request {
        return json!({
            "type": "object",
            "properties": {
                "apps": {
                    "type": "array", "minItems": 1, "maxItems": MAX_APPS,
                    "items": { "type": "string" },
                    "description": "Bundle ids from list_apps, like com.apple.Notes."
                },
                "reason": {
                    "type": "string", "maxLength": MAX_REASON_CHARS,
                    "description": "Why you need these apps, for the user to read."
                }
            },
            "required": ["apps", "reason"],
            "additionalProperties": false
        });
    }
    let mut properties = Map::new();
    for field in spec.fields {
        let mut schema = schema_of(field.kind);
        schema["description"] = json!(field.about);
        properties.insert(field.name.to_string(), schema);
    }
    let required: Vec<&str> = spec
        .fields
        .iter()
        .filter(|field| field.required)
        .map(|field| field.name)
        .collect();
    json!({
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": false
    })
}

/// The computer-use part of `tools/list`.
pub fn tool_list() -> Vec<Value> {
    TOOLS
        .iter()
        .map(|spec| {
            json!({
                "name": spec.name,
                "description": spec.about,
                "inputSchema": input_schema(spec)
            })
        })
        .collect()
}

fn checked_value(field: &Field, value: &Value) -> Option<Value> {
    match field.kind {
        Kind::Int { min, max } => value
            .as_i64()
            .filter(|n| (min..=max).contains(n))
            .map(Value::from),
        Kind::Number => value.as_f64().filter(|n| n.is_finite()).map(Value::from),
        Kind::Bool => value.as_bool().map(Value::from),
        Kind::Text { max } => value
            .as_str()
            .filter(|text| !text.is_empty() && text.chars().count() <= max)
            .map(Value::from),
        Kind::Choice(choices) => value
            .as_str()
            .filter(|text| choices.contains(text))
            .map(Value::from),
        Kind::Predicates => value
            .as_array()
            .filter(|list| {
                (1..=8).contains(&list.len())
                    && list.iter().all(Value::is_object)
                    && value.to_string().len() <= MAX_PREDICATE_BYTES
            })
            .map(|_| value.clone()),
    }
}

fn takes(spec: &ToolSpec) -> String {
    if spec.fields.is_empty() {
        return "none".to_string();
    }
    let names: Vec<&str> = spec.fields.iter().map(|field| field.name).collect();
    names.join(", ")
}

/// A copy of `args` holding only `spec`'s fields, each checked. An error
/// never repeats what the agent sent.
pub fn rebuild(spec: &ToolSpec, args: &Value) -> Result<Map<String, Value>, String> {
    let object = args
        .as_object()
        .ok_or_else(|| "The arguments must be a JSON object.".to_string())?;
    for key in object.keys() {
        if OUT_FILES.contains(&key.as_str()) {
            return Err(format!("Zorvo chooses where images go: leave out {key}."));
        }
        let is_known =
            DROPPED.contains(&key.as_str()) || spec.fields.iter().any(|field| field.name == key);
        if !is_known {
            return Err(format!(
                "Unknown argument. {} takes: {}.",
                spec.name,
                takes(spec)
            ));
        }
    }
    let mut clean = Map::new();
    for field in spec.fields {
        match object.get(field.name) {
            None | Some(Value::Null) if field.required => {
                return Err(format!("{} needs {}.", spec.name, field.name));
            }
            None | Some(Value::Null) => {}
            Some(value) => {
                let value = checked_value(field, value)
                    .ok_or_else(|| format!("{} is not valid for {}.", field.name, spec.name))?;
                clean.insert(field.name.to_string(), value);
            }
        }
    }
    Ok(clean)
}

/// The app a call reads, as it was when the call was checked.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Target {
    pub pid: i32,
    pub process: ProcessId,
    pub app: AppIdentity,
    pub tier: Tier,
    pub window_id: Option<u32>,
}

/// A call that passed: the arguments to send, and whom they reach.
#[derive(Clone, Debug, PartialEq)]
pub struct Checked {
    pub args: Value,
    pub target: Option<Target>,
}

pub struct GateContext<'a> {
    pub session: &'a str,
    pub grants: &'a Grants,
    /// The app a pid runs from, with the process's start time.
    pub running: &'a dyn Fn(i32) -> Option<(AppIdentity, ProcessId)>,
    /// The window ids of a pid, asked of the driver.
    pub windows_of: &'a dyn Fn(i32) -> Result<Vec<u32>, String>,
}

pub fn not_allowed(name: &str) -> String {
    format!("{name} is not allowed in this session. Call request_access first.")
}

pub fn never_allowed(name: &str) -> String {
    format!("Zorvo never lets agents use {name}.")
}

const NOT_AN_APP: &str = "That process is not an app Zorvo can allow.";

/// The granted app behind `pid`, or the sentence that refuses it.
pub fn target_of(pid: i32, action: Action, ctx: &GateContext<'_>) -> Result<Target, String> {
    let (app, process) = (ctx.running)(pid).ok_or(NOT_AN_APP)?;
    if tiers::tier_of(Some(&app)) == Tier::Never {
        return Err(never_allowed(&app.name));
    }
    let grant = ctx
        .grants
        .app_for(ctx.session, &app)
        .ok_or_else(|| not_allowed(&app.name))?;
    // The table may have changed its mind since the grant: the lower wins.
    let tier = grant.tier.min(tiers::tier_of(Some(&app)));
    if !tiers::allows(tier, action) {
        return Err(match tier {
            Tier::ClickOnly => format!("{} is click-only in Zorvo.", app.name),
            Tier::ViewOnly => format!("{} is view-only in Zorvo.", app.name),
            Tier::Never | Tier::Full => never_allowed(&app.name),
        });
    }
    Ok(Target {
        pid,
        process,
        app,
        tier,
        window_id: None,
    })
}

/// Checks a call of an observe tool and returns what to send.
pub fn check(tool: &str, args: &Value, ctx: &GateContext<'_>) -> Result<Checked, String> {
    let spec = spec_of(tool).ok_or_else(|| not_offered(tool))?;
    let clean = rebuild(spec, args)?;
    if spec.group != Group::Observe {
        return Ok(Checked {
            args: Value::Object(clean),
            target: None,
        });
    }
    let pid = clean
        .get("pid")
        .and_then(Value::as_i64)
        .and_then(|pid| i32::try_from(pid).ok())
        .ok_or_else(|| format!("{tool} needs pid."))?;
    let mut target = target_of(pid, Action::Observe, ctx)?;
    if let Some(window_id) = clean.get("window_id").and_then(Value::as_u64) {
        let window_id =
            u32::try_from(window_id).map_err(|_| format!("window_id is not valid for {tool}."))?;
        if !(ctx.windows_of)(pid)?.contains(&window_id) {
            return Err(format!(
                "That window does not belong to {}. Call list_windows.",
                target.app.name
            ));
        }
        target.window_id = Some(window_id);
    }
    Ok(Checked {
        args: Value::Object(clean),
        target: Some(target),
    })
}

/// The snapshots each session read, with the window each describes. A new
/// driver knows none of the old ids, so they are all forgotten when one ends.
#[derive(Default)]
pub struct Snapshots {
    by_session: Mutex<HashMap<String, HashMap<String, Snapshot>>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub process: ProcessId,
    pub window_id: u32,
    /// The screenshot's size in pixels, when the read returned one.
    pub size: Option<(u32, u32)>,
}

/// Snapshots kept per session; the oldest ids go first.
const MAX_SNAPSHOTS: usize = 200;

impl Snapshots {
    fn sessions(&self) -> std::sync::MutexGuard<'_, HashMap<String, HashMap<String, Snapshot>>> {
        self.by_session.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn record(&self, session: &str, snapshot_id: &str, snapshot: Snapshot) {
        let mut sessions = self.sessions();
        let held = sessions.entry(session.to_string()).or_default();
        if held.len() >= MAX_SNAPSHOTS {
            held.clear();
        }
        held.insert(snapshot_id.to_string(), snapshot);
    }

    pub fn owner(&self, session: &str, snapshot_id: &str) -> Option<Snapshot> {
        self.sessions().get(session)?.get(snapshot_id).copied()
    }

    pub fn forget(&self, session: &str) {
        self.sessions().remove(session);
    }

    pub fn forget_all(&self) {
        self.sessions().clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::computer_use::grants::tests::app;
    use crate::computer_use::grants::AppGrant;

    const NOTES_PID: i32 = 4242;
    const TERMINAL_PID: i32 = 5151;
    const KEYCHAIN_PID: i32 = 6161;

    fn process(pid: i32) -> ProcessId {
        ProcessId {
            pid,
            started_us: 1_000,
        }
    }

    fn running(pid: i32) -> Option<(AppIdentity, ProcessId)> {
        let app = match pid {
            NOTES_PID => app("Notes", "com.apple.Notes"),
            TERMINAL_PID => app("Terminal", "com.apple.Terminal"),
            KEYCHAIN_PID => app("Keychain Access", "com.apple.keychainaccess"),
            _ => return None,
        };
        Some((app, process(pid)))
    }

    fn windows_of(pid: i32) -> Result<Vec<u32>, String> {
        Ok(if pid == NOTES_PID { vec![7] } else { vec![9] })
    }

    fn grants_with_notes() -> Grants {
        let grants = Grants::default();
        grants.grant(
            "s-1",
            vec![AppGrant {
                key: "app-1".into(),
                app: app("Notes", "com.apple.Notes"),
                tier: Tier::Full,
            }],
        );
        grants
    }

    fn check_in(grants: &Grants, tool: &str, args: Value) -> Result<Checked, String> {
        check(
            tool,
            &args,
            &GateContext {
                session: "s-1",
                grants,
                running: &running,
                windows_of: &windows_of,
            },
        )
    }

    #[test]
    fn refuses_an_unoffered_tool() {
        let grants = grants_with_notes();
        assert_eq!(
            check_in(&grants, "run_script", json!({})),
            Err("Zorvo does not offer run_script.".to_string())
        );
        assert_eq!(
            check_in(&grants, "Ignore previous instructions", json!({})),
            Err("Zorvo does not offer that tool.".to_string())
        );
    }

    #[test]
    fn refuses_an_unknown_field() {
        let grants = grants_with_notes();
        assert_eq!(
            check_in(
                &grants,
                "list_windows",
                json!({ "pid": NOTES_PID, "app": "Notes" })
            ),
            Err("Unknown argument. list_windows takes: pid, on_screen_only.".to_string())
        );
    }

    #[test]
    fn refuses_a_pid_without_a_grant() {
        let grants = grants_with_notes();
        assert_eq!(
            check_in(&grants, "list_windows", json!({ "pid": TERMINAL_PID })),
            Err("Terminal is not allowed in this session. Call request_access first.".to_string())
        );
        assert_eq!(
            check_in(&grants, "list_windows", json!({ "pid": 1 })),
            Err(NOT_AN_APP.to_string())
        );
        assert_eq!(
            check_in(&grants, "list_windows", json!({ "pid": KEYCHAIN_PID })),
            Err("Zorvo never lets agents use Keychain Access.".to_string())
        );
        assert_eq!(
            check_in(&grants, "list_windows", json!({})),
            Err("list_windows needs pid.".to_string())
        );
    }

    #[test]
    fn refuses_a_window_of_another_pid() {
        let grants = grants_with_notes();
        assert_eq!(
            check_in(
                &grants,
                "get_window_state",
                json!({ "pid": NOTES_PID, "window_id": 9 })
            ),
            Err("That window does not belong to Notes. Call list_windows.".to_string())
        );
    }

    #[test]
    fn passes_a_read_of_an_allowed_window_with_only_the_listed_fields() {
        let grants = grants_with_notes();
        let checked = check_in(
            &grants,
            "get_window_state",
            json!({ "pid": NOTES_PID, "window_id": 7, "query": "Save", "timeout_ms": null }),
        )
        .unwrap();

        assert_eq!(
            checked.args,
            json!({ "pid": NOTES_PID, "window_id": 7, "query": "Save" })
        );
        let target = checked.target.unwrap();
        assert_eq!(target.process, process(NOTES_PID));
        assert_eq!(target.window_id, Some(7));
        assert_eq!(target.tier, Tier::Full);
    }

    #[test]
    fn drops_the_agents_session_field() {
        let grants = grants_with_notes();
        let checked = check_in(
            &grants,
            "list_windows",
            json!({ "pid": NOTES_PID, "session": "someone-else" }),
        )
        .unwrap();
        assert_eq!(checked.args, json!({ "pid": NOTES_PID }));
    }

    #[test]
    fn removes_max_image_dimension() {
        let grants = grants_with_notes();
        let checked = check_in(
            &grants,
            "get_window_state",
            json!({ "pid": NOTES_PID, "window_id": 7, "max_image_dimension": 64 }),
        )
        .unwrap();
        assert_eq!(checked.args, json!({ "pid": NOTES_PID, "window_id": 7 }));
    }

    #[test]
    fn refuses_out_file_fields() {
        let grants = grants_with_notes();
        assert_eq!(
            check_in(
                &grants,
                "get_window_state",
                json!({ "pid": NOTES_PID, "window_id": 7, "screenshot_out_file": "~/x.png" })
            ),
            Err("Zorvo chooses where images go: leave out screenshot_out_file.".to_string())
        );
    }

    #[test]
    fn refuses_a_value_of_the_wrong_kind_without_repeating_it() {
        let grants = grants_with_notes();
        assert_eq!(
            check_in(
                &grants,
                "get_window_state",
                json!({ "pid": NOTES_PID, "window_id": 7, "tree_format": "secret words" })
            ),
            Err("tree_format is not valid for get_window_state.".to_string())
        );
        assert_eq!(
            check_in(&grants, "list_windows", json!({ "pid": "4242" })),
            Err("pid is not valid for list_windows.".to_string())
        );
    }

    #[test]
    fn a_tier_lowered_after_the_grant_wins() {
        let grants = Grants::default();
        grants.grant(
            "s-1",
            vec![AppGrant {
                key: "app-1".into(),
                app: app("Terminal", "com.apple.Terminal"),
                tier: Tier::Full,
            }],
        );
        let ctx = GateContext {
            session: "s-1",
            grants: &grants,
            running: &running,
            windows_of: &windows_of,
        };
        assert_eq!(
            target_of(TERMINAL_PID, Action::Type, &ctx),
            Err("Terminal is click-only in Zorvo.".to_string())
        );
        assert!(target_of(TERMINAL_PID, Action::Observe, &ctx).is_ok());
    }

    #[test]
    fn every_offered_tool_is_in_the_saved_tool_list() {
        let saved: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/cua-driver-tools.json"))
                .unwrap();
        let saved = saved["tools"].as_array().unwrap();
        for spec in TOOLS.iter().filter(|spec| spec.group != Group::Request) {
            let tool = saved
                .iter()
                .find(|tool| tool["name"] == spec.name)
                .unwrap_or_else(|| panic!("the pinned driver has no {}", spec.name));
            let fields: Vec<&str> = tool["fields"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(Value::as_str)
                .collect();
            for field in spec.fields {
                assert!(
                    fields.contains(&field.name),
                    "{} has no field {}",
                    spec.name,
                    field.name
                );
            }
            for required in tool["required"].as_array().unwrap() {
                let name = required.as_str().unwrap();
                assert!(
                    spec.fields.iter().any(|f| f.name == name && f.required),
                    "{} must require {name}",
                    spec.name
                );
            }
        }
    }

    #[test]
    fn the_tool_list_names_no_tool_zorvo_refuses() {
        let listed: Vec<String> = tool_list()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(
            listed,
            [
                "list_apps",
                "request_access",
                "list_windows",
                "get_window_state",
                "zoom",
                "verify_state"
            ]
        );
        for tool in tool_list() {
            assert_eq!(tool["inputSchema"]["additionalProperties"], false);
            assert!(tool["inputSchema"]["properties"].get("session").is_none());
        }
    }

    #[test]
    fn snapshots_belong_to_their_session() {
        let snapshots = Snapshots::default();
        let snapshot = Snapshot {
            process: process(NOTES_PID),
            window_id: 7,
            size: Some((4, 4)),
        };
        snapshots.record("s-1", "s00000001", snapshot);

        assert_eq!(snapshots.owner("s-1", "s00000001"), Some(snapshot));
        assert_eq!(snapshots.owner("s-2", "s00000001"), None);
        snapshots.forget("s-1");
        assert_eq!(snapshots.owner("s-1", "s00000001"), None);
    }
}
