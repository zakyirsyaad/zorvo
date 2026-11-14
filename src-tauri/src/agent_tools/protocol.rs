//! The subset of MCP (JSON-RPC 2.0, one message per line) Zorvo's tool server
//! speaks: `initialize`, `ping`, `tools/list` and `tools/call`, plus the
//! agent's `notifications/cancelled`. `handle_line` is pure: it decides what
//! to do with one line and the caller does it.
//!
//! Everything else is answered the way the spec says, so no client drops the
//! server over a method it merely probes: an unimplemented method with an id
//! gets error -32601 (Qwen Code asks `prompts/list` and `resources/list`,
//! Claude Code asks `server/discover`, and a 2026-07-28 stdio client falls
//! back to `initialize` on any error that is not a modern one); a message
//! without an id gets no reply.

use serde_json::{json, Value};

use super::tools::{tool_list, validate, TOOL_NAMES};

/// Newest first. 2025-11-25 and 2025-06-18 are what the tested agents send.
pub const SUPPORTED_VERSIONS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
pub const MAX_LINE_BYTES: usize = 1024 * 1024;

const PARSE_ERROR: i64 = -32700;
const INVALID_REQUEST: i64 = -32600;
const METHOD_NOT_FOUND: i64 = -32601;
const INVALID_PARAMS: i64 = -32602;

#[derive(Debug, PartialEq)]
pub enum Step {
    /// Write this line back.
    Reply(Value),
    /// Write nothing.
    Silent,
    /// A valid tool call to carry out; answer it with `tool_result`.
    Call {
        id: Value,
        tool: String,
        args: Value,
    },
    /// The agent gave up on the request with this id (`notifications/cancelled`).
    Cancel { request_id: Value },
}

pub fn handle_line(line: &str) -> Step {
    if line.len() > MAX_LINE_BYTES {
        return error_step(Value::Null, INVALID_REQUEST, "The message is too large.");
    }
    let message: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => return error_step(Value::Null, PARSE_ERROR, "Parse error."),
    };
    let Some(object) = message.as_object() else {
        let text = if message.is_array() {
            "Batches are not supported."
        } else {
            "Invalid request."
        };
        return error_step(Value::Null, INVALID_REQUEST, text);
    };
    let Some(method) = object.get("method").and_then(Value::as_str) else {
        // A response to a request Zorvo never sent is ignored; anything else
        // is not a message.
        if object.contains_key("result") || object.contains_key("error") {
            return Step::Silent;
        }
        return error_step(Value::Null, INVALID_REQUEST, "Invalid request.");
    };
    let params = object.get("params").unwrap_or(&Value::Null);
    let id = match object.get("id") {
        None => return notification(method, params),
        Some(id) if id.is_string() || id.is_number() => id.clone(),
        Some(_) => return error_step(Value::Null, INVALID_REQUEST, "Invalid request id."),
    };
    match method {
        "initialize" => Step::Reply(result_reply(&id, initialize_result(params))),
        "ping" => Step::Reply(result_reply(&id, json!({}))),
        "tools/list" => Step::Reply(result_reply(&id, json!({ "tools": tool_list() }))),
        "tools/call" => tools_call(id, params),
        _ => error_step(id, METHOD_NOT_FOUND, "Method not found."),
    }
}

fn notification(method: &str, params: &Value) -> Step {
    if method != "notifications/cancelled" {
        return Step::Silent;
    }
    match params.get("requestId") {
        Some(id) if id.is_string() || id.is_number() => Step::Cancel {
            request_id: id.clone(),
        },
        _ => Step::Silent,
    }
}

fn initialize_result(params: &Value) -> Value {
    let requested = params.get("protocolVersion").and_then(Value::as_str);
    let version = requested
        .filter(|v| SUPPORTED_VERSIONS.contains(v))
        .unwrap_or(SUPPORTED_VERSIONS[0]);
    json!({
        "protocolVersion": version,
        "capabilities": { "tools": {} },
        "serverInfo": { "name": "zorvo", "version": env!("CARGO_PKG_VERSION") }
    })
}

fn tools_call(id: Value, params: &Value) -> Step {
    let Some(name) = params.get("name").and_then(Value::as_str) else {
        return error_step(id, INVALID_PARAMS, "A tool name is required.");
    };
    if !TOOL_NAMES.contains(&name) {
        return error_step(id, INVALID_PARAMS, "Unknown tool.");
    }
    let args = match params.get("arguments") {
        None | Some(Value::Null) => json!({}),
        Some(args) => args.clone(),
    };
    match validate(name, &args) {
        Ok(args) => Step::Call {
            id,
            tool: name.to_string(),
            args,
        },
        Err(sentence) => Step::Reply(tool_result(&id, false, &sentence)),
    }
}

/// A `tools/call` answer: text content and the error flag.
pub fn tool_result(id: &Value, ok: bool, text: &str) -> Value {
    result_reply(
        id,
        json!({ "content": [{ "type": "text", "text": text }], "isError": !ok }),
    )
}

fn result_reply(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn error_step(id: Value, code: i64, message: &str) -> Step {
    Step::Reply(json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reply(line: &str) -> Value {
        match handle_line(line) {
            Step::Reply(value) => value,
            other => panic!("expected a reply, got {other:?}"),
        }
    }

    #[test]
    fn initialize_answers_a_supported_version_and_falls_back_to_the_newest() {
        for version in SUPPORTED_VERSIONS {
            let line = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":version}});
            let got = reply(&line.to_string());
            assert_eq!(got["result"]["protocolVersion"], version);
        }
        let line = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}"#;
        let got = reply(line);
        assert_eq!(got["result"]["protocolVersion"], "2025-11-25");
        assert_eq!(got["result"]["capabilities"], json!({"tools": {}}));
        assert_eq!(got["result"]["serverInfo"]["name"], "zorvo");
        assert_eq!(
            got["result"]["serverInfo"]["version"],
            env!("CARGO_PKG_VERSION")
        );
        let none = reply(r#"{"jsonrpc":"2.0","id":2,"method":"initialize"}"#);
        assert_eq!(none["result"]["protocolVersion"], "2025-11-25");
    }

    #[test]
    fn notifications_and_idless_messages_get_no_reply() {
        let lines = [
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
            r#"{"jsonrpc":"2.0","method":"tools/list"}"#,
            r#"{"jsonrpc":"2.0","method":"whatever","params":{}}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":{}}"#,
        ];
        for line in lines {
            assert_eq!(handle_line(line), Step::Silent, "{line}");
        }
    }

    #[test]
    fn a_cancelled_notification_names_the_request_to_end() {
        let line = r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":7,"reason":"x"}}"#;
        assert_eq!(
            handle_line(line),
            Step::Cancel {
                request_id: json!(7)
            }
        );
        let line =
            r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":"abc"}}"#;
        assert_eq!(
            handle_line(line),
            Step::Cancel {
                request_id: json!("abc")
            }
        );
        for bad in [
            r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{}}"#,
            r#"{"jsonrpc":"2.0","method":"notifications/cancelled"}"#,
            r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":{"a":1}}}"#,
        ] {
            assert_eq!(handle_line(bad), Step::Silent);
        }
    }

    #[test]
    fn tools_list_returns_the_five_tools() {
        let got = reply(r#"{"jsonrpc":"2.0","id":3,"method":"tools/list"}"#);
        assert_eq!(got["result"]["tools"].as_array().unwrap().len(), 5);
        assert_eq!(
            reply(r#"{"jsonrpc":"2.0","id":4,"method":"ping"}"#)["result"],
            json!({})
        );
    }

    #[test]
    fn a_valid_call_becomes_a_call_step_with_cleaned_arguments() {
        let line = r#"{"jsonrpc":"2.0","id":"c1","method":"tools/call","params":{"name":"delegate","arguments":{"agent":" pi ","task":" go "}}}"#;
        assert_eq!(
            handle_line(line),
            Step::Call {
                id: json!("c1"),
                tool: "delegate".to_string(),
                args: json!({"agent": "pi", "task": "go"}),
            }
        );
        let no_args =
            r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"list_agents"}}"#;
        assert!(matches!(handle_line(no_args), Step::Call { .. }));
    }

    #[test]
    fn an_invalid_call_is_a_tool_error_not_a_protocol_error() {
        let line = r#"{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"delegate","arguments":{"agent":"pi"}}}"#;
        let got = reply(line);
        assert!(got.get("error").is_none());
        assert_eq!(got["result"]["isError"], true);
        assert!(!got["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .is_empty());
        let unknown =
            reply(r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"run"}}"#);
        assert_eq!(unknown["error"]["code"], -32602);
    }

    #[test]
    fn unknown_methods_garbage_and_batches_get_json_rpc_errors() {
        for method in ["prompts/list", "resources/list", "server/discover", "nope"] {
            let line = json!({"jsonrpc":"2.0","id":9,"method":method}).to_string();
            let got = reply(&line);
            assert_eq!(got["error"]["code"], -32601, "{method}");
            assert_eq!(got["id"], 9);
        }
        assert_eq!(reply("not json")["error"]["code"], -32700);
        assert_eq!(reply("not json")["id"], Value::Null);
        assert_eq!(
            reply(r#"[{"jsonrpc":"2.0","id":1,"method":"ping"}]"#)["error"]["code"],
            -32600
        );
        assert_eq!(reply("42")["error"]["code"], -32600);
        assert_eq!(reply(r#"{"id":1}"#)["error"]["code"], -32600);
        assert_eq!(
            reply(r#"{"jsonrpc":"2.0","id":{},"method":"ping"}"#)["error"]["code"],
            -32600
        );
        let huge = format!(
            r#"{{"jsonrpc":"2.0","id":1,"method":"ping","params":"{}"}}"#,
            "x".repeat(MAX_LINE_BYTES)
        );
        assert_eq!(reply(&huge)["error"]["code"], -32600);
        // The connection stays usable afterwards.
        assert!(reply(r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#)["result"].is_object());
    }

    #[test]
    fn a_tool_result_carries_text_and_the_error_flag() {
        let ok = tool_result(&json!(1), true, "done");
        assert_eq!(
            ok["result"]["content"][0],
            json!({"type": "text", "text": "done"})
        );
        assert_eq!(ok["result"]["isError"], false);
        assert_eq!(ok["jsonrpc"], "2.0");
        assert_eq!(
            tool_result(&json!(1), false, "no")["result"]["isError"],
            true
        );
    }

    #[test]
    fn string_and_number_ids_come_back_unchanged() {
        for id in [json!("abc"), json!(0), json!(12345), json!(1.5)] {
            let line = json!({"jsonrpc":"2.0","id":id,"method":"ping"}).to_string();
            assert_eq!(reply(&line)["id"], id);
        }
    }
}
