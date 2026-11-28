//! The agents Qwen Code runs in the background, as it reports them.
//!
//! Qwen Code sends the client nothing while such an agent works, but answers
//! `qwen/status/session/tasks` on a plain ACP launch (the empty answer is
//! recorded in `tests/fixtures/qwen-session-tasks.json`, the filled one is
//! written from its source). The answer is the agent's own, so only agent
//! tasks are kept, each field is checked and cut, and the agent's error text,
//! prompt and files never reach the webview.

use serde::Serialize;
use serde_json::Value;

pub const TASKS_METHOD: &str = "qwen/status/session/tasks";

pub const MAX_TASKS: usize = 50;
pub const MAX_ACTIVITIES: usize = 5;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTasks {
    /// The agent's clock when it answered, ms; the quiet times are measured against it.
    pub as_of: Option<u64>,
    /// The newest first, at most [`MAX_TASKS`]; past that, those at work are kept before those that ended.
    pub tasks: Vec<AgentTask>,
    /// How many were left out.
    pub more: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTask {
    pub id: String,
    pub label: String,
    pub description: String,
    pub status: &'static str,
    pub started_at: Option<u64>,
    pub ended_at: Option<u64>,
    /// The newest activity's time, else the start.
    pub last_activity_at: Option<u64>,
    pub agent_type: Option<String>,
    pub tool_use_id: Option<String>,
    pub is_background: bool,
    /// The newest last, at most [`MAX_ACTIVITIES`].
    pub activities: Vec<AgentActivity>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentActivity {
    pub name: String,
    pub description: String,
    pub at: Option<u64>,
}

const MAX_ID_CHARS: usize = 200;
const MAX_LABEL_CHARS: usize = 120;
const MAX_DESCRIPTION_CHARS: usize = 300;
const MAX_TYPE_CHARS: usize = 80;
const MAX_ACTIVITY_NAME_CHARS: usize = 80;
const MAX_ACTIVITY_DESCRIPTION_CHARS: usize = 200;

/// Reads Qwen Code's answer. An answer that is not an object with a `tasks`
/// list is refused whole; an entry that is not an agent task, or has no usable
/// id, is left out.
pub fn parse(answer: &Value) -> Result<AgentTasks, String> {
    let list = answer
        .get("tasks")
        .and_then(Value::as_array)
        .ok_or_else(|| "The agent's task answer was not readable.".to_string())?;
    let mut tasks: Vec<AgentTask> = list.iter().filter_map(task_of).collect();
    // Stable, so tasks that started together keep the agent's order.
    tasks.sort_by_key(|task| std::cmp::Reverse(task.started_at));
    let more = tasks.len().saturating_sub(MAX_TASKS);
    if more > 0 {
        // An agent still at work is never the one left out: the oldest that ended give way first.
        tasks.sort_by_key(|task| task.status != "working");
        tasks.truncate(MAX_TASKS);
        tasks.sort_by_key(|task| std::cmp::Reverse(task.started_at));
    }
    let as_of = answer.get("now").and_then(millis);
    Ok(AgentTasks { as_of, tasks, more })
}

fn task_of(entry: &Value) -> Option<AgentTask> {
    if entry.get("kind").and_then(Value::as_str) != Some("agent") {
        return None;
    }
    let id = entry.get("id").and_then(Value::as_str)?;
    let id_chars = id.chars().count();
    if id_chars == 0 || id_chars > MAX_ID_CHARS {
        return None;
    }
    let text = |key: &str, max: usize| entry.get(key).and_then(Value::as_str).map(|s| cut(s, max));
    let ended_at = entry.get("endTime").and_then(millis);
    let started_at = entry.get("startTime").and_then(millis);
    let activities = activities_of(entry.get("recentActivities"));
    let last_activity_at = activities.iter().filter_map(|a| a.at).max().or(started_at);
    Some(AgentTask {
        id: id.to_string(),
        label: text("label", MAX_LABEL_CHARS).unwrap_or_default(),
        description: text("description", MAX_DESCRIPTION_CHARS).unwrap_or_default(),
        status: status_of(entry),
        started_at,
        ended_at,
        last_activity_at,
        agent_type: text("subagentType", MAX_TYPE_CHARS).filter(|s| !s.is_empty()),
        tool_use_id: text("toolUseId", MAX_ID_CHARS).filter(|s| !s.is_empty()),
        is_background: entry.get("isBackgrounded") == Some(&Value::Bool(true)),
        activities,
    })
}

/// Qwen Code's registry says running, paused, completed, failed or cancelled
/// (read from its source). A resumed session turns every agent that was running
/// in its last run into `paused`, and a failed resume leaves it so, so paused
/// is not at work. The error text is never kept: its presence only says the task failed.
fn status_of(entry: &Value) -> &'static str {
    match entry.get("status").and_then(Value::as_str) {
        Some("running") => "working",
        Some("completed") => "done",
        Some("failed") => "failed",
        Some("paused" | "cancelled") => "stopped",
        _ if entry.get("error").is_some_and(|e| !e.is_null()) => "failed",
        _ => "unknown",
    }
}

fn activities_of(list: Option<&Value>) -> Vec<AgentActivity> {
    let Some(list) = list.and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut activities: Vec<AgentActivity> = list
        .iter()
        .filter_map(|item| {
            Some(AgentActivity {
                name: cut(item.get("name")?.as_str()?, MAX_ACTIVITY_NAME_CHARS),
                description: item
                    .get("description")
                    .and_then(Value::as_str)
                    .map(|s| cut(s, MAX_ACTIVITY_DESCRIPTION_CHARS))
                    .unwrap_or_default(),
                at: item.get("at").and_then(millis),
            })
        })
        .collect();
    activities.sort_by_key(|a| a.at);
    let skip = activities.len().saturating_sub(MAX_ACTIVITIES);
    activities.split_off(skip)
}

/// The largest integer a JavaScript number holds exactly.
const MAX_SAFE_MILLIS: f64 = 9_007_199_254_740_991.0;

/// A time in milliseconds: a finite, non-negative number the webview can hold.
fn millis(value: &Value) -> Option<u64> {
    let n = value.as_f64()?;
    if !n.is_finite() || !(0.0..=MAX_SAFE_MILLIS).contains(&n) {
        return None;
    }
    Some(n.round() as u64)
}

fn cut(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> Value {
        let text = include_str!("../../tests/fixtures/qwen-session-tasks.json");
        serde_json::from_str::<Value>(text).unwrap()["answer"].clone()
    }

    fn agent(id: &str, start: u64) -> Value {
        json!({ "kind": "agent", "id": id, "label": id, "status": "running", "startTime": start })
    }

    #[test]
    fn reads_the_agent_tasks_and_leaves_out_the_rest() {
        let parsed = parse(&fixture()).unwrap();
        let ids: Vec<_> = parsed.tasks.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, ["agent-aaa111", "agent-bbb222", "agent-ccc333"]);
        assert_eq!(parsed.more, 0);
        let working = &parsed.tasks[0];
        assert_eq!(working.label, "Explore the auth flow");
        assert_eq!(working.description, "Find where sessions are created");
        assert_eq!(working.status, "working");
        assert_eq!(working.started_at, Some(1795325300000));
        assert_eq!(working.ended_at, None);
        assert_eq!(working.agent_type.as_deref(), Some("Explore"));
        assert_eq!(working.tool_use_id.as_deref(), Some("call_1"));
        assert!(working.is_background);
        assert_eq!(working.activities.len(), 2);
        assert_eq!(working.activities[1].name, "grep");
        assert_eq!(parsed.tasks[1].status, "done");
        assert_eq!(parsed.tasks[1].ended_at, Some(1795325200000));
        assert_eq!(parsed.tasks[2].status, "failed");
    }

    #[test]
    fn reads_the_recorded_empty_answer() {
        let text = include_str!("../../tests/fixtures/qwen-session-tasks.json");
        let empty = serde_json::from_str::<Value>(text).unwrap()["empty"].clone();
        assert_eq!(
            parse(&empty).unwrap(),
            AgentTasks {
                as_of: Some(1795325390347),
                tasks: vec![],
                more: 0
            }
        );
    }

    #[test]
    fn never_passes_on_the_error_the_prompt_or_a_path() {
        let parsed = parse(&fixture()).unwrap();
        let text = serde_json::to_string(&parsed).unwrap();
        for secret in [
            "ENOENT",
            "SECRET PROMPT",
            "/tmp/qwen",
            "outputFile",
            "totalTokens",
            "secret/path",
        ] {
            assert!(!text.contains(secret), "{secret} leaked: {text}");
        }
    }

    #[test]
    fn refuses_an_answer_that_is_not_an_object_with_tasks() {
        for answer in [
            json!("x"),
            json!([]),
            json!(null),
            json!({}),
            json!({ "tasks": {} }),
        ] {
            let error = parse(&answer).unwrap_err();
            assert!(!error.is_empty());
            assert!(!error.contains("x\""), "{error}");
        }
    }

    #[test]
    fn drops_entries_without_a_usable_id() {
        let answer = json!({ "tasks": [
            agent("", 1),
            { "kind": "agent", "label": "no id" },
            { "kind": "agent", "id": 7 },
            agent(&"i".repeat(201), 1),
            agent("ok", 1),
        ] });
        let parsed = parse(&answer).unwrap();
        assert_eq!(parsed.tasks.len(), 1);
        assert_eq!(parsed.tasks[0].id, "ok");
    }

    #[test]
    fn cuts_by_characters_not_bytes() {
        let astral = "\u{1F600}";
        let answer = json!({ "tasks": [{
            "kind": "agent", "id": "a",
            "label": format!("{}{astral}tail", "x".repeat(119)),
            "description": astral.repeat(400),
            "subagentType": astral.repeat(100),
            "toolUseId": "t".repeat(300),
            "recentActivities": [{ "name": astral.repeat(100), "description": astral.repeat(300), "at": 5 }],
        }] });
        let task = &parse(&answer).unwrap().tasks[0];
        assert_eq!(task.label.chars().count(), 120);
        assert!(task.label.ends_with(astral));
        assert_eq!(task.description.chars().count(), 300);
        assert_eq!(task.agent_type.as_deref().unwrap().chars().count(), 80);
        assert_eq!(task.tool_use_id.as_deref().unwrap().chars().count(), 200);
        assert_eq!(task.activities[0].name.chars().count(), 80);
        assert_eq!(task.activities[0].description.chars().count(), 200);
    }

    #[test]
    fn keeps_the_newest_fifty_and_counts_the_rest() {
        let tasks: Vec<Value> = (0..60).map(|n| agent(&format!("a{n}"), n)).collect();
        let parsed = parse(&json!({ "tasks": tasks })).unwrap();
        assert_eq!(parsed.tasks.len(), 50);
        assert_eq!(parsed.more, 10);
        assert_eq!(parsed.tasks[0].id, "a59");
        assert_eq!(parsed.tasks[49].id, "a10");
    }

    #[test]
    fn keeps_an_old_agent_that_still_works_past_fifty_newer_ones() {
        let mut tasks: Vec<Value> = (1..=60).map(|n| agent(&format!("a{n}"), n)).collect();
        for task in &mut tasks {
            task["status"] = json!("completed");
        }
        tasks.insert(0, agent("old", 0));
        let parsed = parse(&json!({ "tasks": tasks })).unwrap();
        assert_eq!(parsed.tasks.len(), 50);
        assert_eq!(parsed.more, 11);
        // Still newest first, with the one at work in its place at the end.
        assert_eq!(parsed.tasks[0].id, "a60");
        assert_eq!(parsed.tasks[49].id, "old");
        assert_eq!(parsed.tasks[49].status, "working");
        assert_eq!(parsed.tasks[48].id, "a12");
    }

    #[test]
    fn drops_numbers_that_are_not_finite_and_non_negative() {
        let answer = json!({ "tasks": [{
            "kind": "agent", "id": "a", "startTime": -5, "endTime": "9",
            "recentActivities": [{ "name": "n", "description": "d", "at": -1 }],
        }, {
            "kind": "agent", "id": "b", "startTime": null, "endTime": 1.5e300,
        }] });
        let parsed = parse(&answer).unwrap();
        let a = parsed.tasks.iter().find(|t| t.id == "a").unwrap();
        assert_eq!((a.started_at, a.ended_at), (None, None));
        assert_eq!(a.activities[0].at, None);
        let b = parsed.tasks.iter().find(|t| t.id == "b").unwrap();
        assert_eq!((b.started_at, b.ended_at), (None, None));
    }

    #[test]
    fn maps_status_words_and_an_error_alone_to_failed() {
        let status = |value: Value, extra: Value| {
            let mut task = json!({ "kind": "agent", "id": "a" });
            task["status"] = value;
            if let Value::Object(map) = extra {
                for (k, v) in map {
                    task[k] = v;
                }
            }
            parse(&json!({ "tasks": [task] })).unwrap().tasks[0].status
        };
        assert_eq!(status(json!("running"), json!({})), "working");
        assert_eq!(status(json!("paused"), json!({})), "stopped");
        assert_eq!(status(json!("completed"), json!({})), "done");
        assert_eq!(status(json!("failed"), json!({})), "failed");
        assert_eq!(status(json!("cancelled"), json!({})), "stopped");
        assert_eq!(status(json!("weird"), json!({})), "unknown");
        assert_eq!(status(json!(3), json!({})), "unknown");
        assert_eq!(status(json!("weird"), json!({ "error": "boom" })), "failed");
    }

    #[test]
    fn keeps_the_newest_five_activities() {
        let activities: Vec<Value> = (0..8)
            .map(|n| json!({ "name": format!("t{n}"), "description": "", "at": n }))
            .collect();
        let answer =
            json!({ "tasks": [{ "kind": "agent", "id": "a", "recentActivities": activities }] });
        let task = &parse(&answer).unwrap().tasks[0];
        let names: Vec<_> = task.activities.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(names, ["t3", "t4", "t5", "t6", "t7"]);
    }

    #[test]
    fn refuses_a_time_above_the_largest_safe_integer() {
        let answer = json!({ "now": 9007199254740992u64, "tasks": [{
            "kind": "agent", "id": "a", "startTime": 18446744073709549568u64, "endTime": 9007199254740992u64,
            "recentActivities": [{ "name": "n", "description": "", "at": 9007199254740992u64 }],
        }, { "kind": "agent", "id": "b", "startTime": 9007199254740991u64 }] });
        let parsed = parse(&answer).unwrap();
        assert_eq!(parsed.as_of, None);
        let a = parsed.tasks.iter().find(|t| t.id == "a").unwrap();
        assert_eq!(
            (a.started_at, a.ended_at, a.activities[0].at),
            (None, None, None)
        );
        let b = parsed.tasks.iter().find(|t| t.id == "b").unwrap();
        assert_eq!(b.started_at, Some(9007199254740991));
    }

    #[test]
    fn keeps_the_answers_clock_and_each_tasks_last_activity() {
        let parsed = parse(&fixture()).unwrap();
        assert_eq!(parsed.as_of, Some(1795325400000));
        assert_eq!(parsed.tasks[0].last_activity_at, Some(1795325390000));
        // No activity: the start.
        assert_eq!(parsed.tasks[1].last_activity_at, Some(1795325100000));
        let unusable = parse(&json!({ "now": "soon", "tasks": [] })).unwrap();
        assert_eq!(unusable.as_of, None);
        let none = parse(&json!({ "tasks": [{ "kind": "agent", "id": "a" }] })).unwrap();
        assert_eq!(none.tasks[0].last_activity_at, None);
    }

    #[test]
    fn last_activity_falls_back_to_the_start_when_no_activity_has_a_usable_time() {
        let answer = json!({ "tasks": [{
            "kind": "agent", "id": "a", "startTime": 40,
            "recentActivities": [
                { "name": "x", "description": "" },
                { "name": "y", "description": "", "at": -3 },
                { "name": "z", "description": "", "at": "9" },
            ],
        }] });
        let task = &parse(&answer).unwrap().tasks[0];
        assert_eq!(task.activities.len(), 3);
        assert_eq!(task.last_activity_at, Some(40));
    }
}
