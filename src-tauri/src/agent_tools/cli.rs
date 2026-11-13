//! `zorvo tools <tool> [json]`: Zorvo's tools for an agent that ignores
//! `mcpServers` and so runs them from its shell. It sends one `tools/call`
//! over the private socket and prints the answer. Like the bridge it holds
//! no logic: validation, limits and answers are the backend's.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::time::Duration;

use serde_json::{json, Value};

use super::bridge::{SOCKET_VARIABLE, TOKEN_VARIABLE, TOOLS_VARIABLE};
use super::service::AgentTools;
use super::tools::tool_list;

const NOT_REACHABLE: &str = "Zorvo is not reachable from this shell.";
const NO_ANSWER: &str = "Zorvo did not answer.";
const QUOTING_HINT: &str = "Pass the arguments as one JSON object in single quotes, for example: \
     zorvo tools delegate '{\"agent\":\"qwen-code\",\"task\":\"…\"}'";
/// Zorvo answers or closes within its own call timeout; this is slack on top.
const ANSWER_SLACK: Duration = Duration::from_secs(15);
const WRITE_TIMEOUT: Duration = Duration::from_secs(2);

const EXIT_OK: i32 = 0;
const EXIT_FAILED: i32 = 1;
const EXIT_USAGE: i32 = 2;

/// Runs the command; `args` is everything after `tools`. Returns the exit
/// code. Never prints the token.
pub fn run(args: &[String]) -> i32 {
    let Some((tool, rest)) = args.split_first() else {
        println!("{}", usage());
        return EXIT_OK;
    };
    if matches!(tool.as_str(), "--help" | "-h" | "help") {
        println!("{}", usage());
        return EXIT_OK;
    }
    let Some(arguments) = parse_arguments(rest) else {
        eprintln!("{QUOTING_HINT}");
        return EXIT_USAGE;
    };
    match call(tool, arguments) {
        Ok(text) => {
            println!("{text}");
            EXIT_OK
        }
        Err(text) => {
            eprintln!("{text}");
            EXIT_FAILED
        }
    }
}

/// Whether this process was started from an agent's environment: one of the
/// variables Zorvo gives a command-path agent, or the bridge, is set.
pub fn is_agent_environment() -> bool {
    [SOCKET_VARIABLE, TOKEN_VARIABLE, TOOLS_VARIABLE]
        .iter()
        .any(|name| std::env::var_os(name).is_some())
}

/// For a start from an agent's environment that is neither `tools` nor
/// `mcp-bridge` (an agent trying `--help`, or the bare program): says how the
/// command is used and returns the exit code. The app must not open then: it
/// would be a second Zorvo window, started by an agent, that never exits.
pub fn refuse_app_start() -> i32 {
    eprintln!("{}", usage());
    eprintln!(
        "This shell belongs to an agent session, so the app itself does not start here. \
         To start it anyway, unset {SOCKET_VARIABLE}, {TOKEN_VARIABLE} and {TOOLS_VARIABLE} first."
    );
    EXIT_USAGE
}

/// The words after the tool, joined, as a JSON object; none means `{}`. An
/// agent that forgot the quotes gets its JSON split by the shell, so the
/// words are put back together before parsing.
fn parse_arguments(words: &[String]) -> Option<Value> {
    let joined = words.join(" ");
    if joined.trim().is_empty() {
        return Some(json!({}));
    }
    serde_json::from_str::<Value>(&joined)
        .ok()
        .filter(Value::is_object)
}

/// The tool names with one example each.
fn usage() -> String {
    let program = format!("\"${TOOLS_VARIABLE}\" tools");
    let lines: Vec<String> = tool_list()
        .as_array()
        .map(|tools| {
            tools
                .iter()
                .filter_map(|tool| tool["name"].as_str())
                .map(|name| format!("  {program} {name} {}", example_arguments(name)))
                .collect()
        })
        .unwrap_or_default();
    format!("Zorvo's tools:\n{}", lines.join("\n"))
}

fn example_arguments(tool: &str) -> &'static str {
    match tool {
        "delegate" => r#"'{"agent":"<id>","task":"<what to do>"}'"#,
        "start_session" => r#"'{"agent":"<id>","brief":"<everything the new session must know>"}'"#,
        "read_session" | "stop_session" => r#"'{"handle":"<handle>"}'"#,
        _ => "",
    }
}

/// Sends the call and returns the answer's text: `Ok` for a result that is
/// not an error, `Err` with what to tell the agent otherwise.
fn call(tool: &str, arguments: Value) -> Result<String, String> {
    let (Some(path), Ok(token)) = (
        std::env::var_os(SOCKET_VARIABLE),
        std::env::var(TOKEN_VARIABLE),
    ) else {
        return Err(NOT_REACHABLE.to_string());
    };
    let mut socket = UnixStream::connect(&path).map_err(|_| NOT_REACHABLE.to_string())?;
    socket
        .set_write_timeout(Some(WRITE_TIMEOUT))
        .and_then(|_| socket.set_read_timeout(Some(AgentTools::CALL_TIMEOUT + ANSWER_SLACK)))
        .map_err(|_| NOT_REACHABLE.to_string())?;
    let hello = json!({ "token": token });
    let request = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": { "name": tool, "arguments": arguments }
    });
    writeln!(socket, "{hello}")
        .and_then(|_| writeln!(socket, "{request}"))
        .map_err(|_| NOT_REACHABLE.to_string())?;

    let mut line = String::new();
    let read = BufReader::new(socket).read_line(&mut line);
    if !matches!(read, Ok(n) if n > 0) {
        return Err(NO_ANSWER.to_string());
    }
    let answer: Value = serde_json::from_str(&line).map_err(|_| NO_ANSWER.to_string())?;
    read_answer(&answer)
}

fn read_answer(answer: &Value) -> Result<String, String> {
    if let Some(message) = answer["error"]["message"].as_str() {
        return Err(message.to_string());
    }
    let result = &answer["result"];
    let text = result["content"]
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|block| block["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .ok_or_else(|| NO_ANSWER.to_string())?;
    if result["isError"].as_bool().unwrap_or(false) {
        Err(text)
    } else {
        Ok(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(list: &[&str]) -> Vec<String> {
        list.iter().map(ToString::to_string).collect()
    }

    #[test]
    fn no_words_and_blank_words_mean_an_empty_object() {
        assert_eq!(parse_arguments(&[]), Some(json!({})));
        assert_eq!(parse_arguments(&words(&["  "])), Some(json!({})));
    }

    #[test]
    fn split_json_is_joined_and_non_objects_are_refused() {
        assert_eq!(
            parse_arguments(&words(&["{\"a\":", "1}"])),
            Some(json!({"a": 1}))
        );
        assert_eq!(parse_arguments(&words(&["[1]"])), None);
        assert_eq!(parse_arguments(&words(&["review", "it"])), None);
    }

    #[test]
    fn an_answer_is_ok_or_err_by_its_error_flag() {
        let ok =
            json!({"result": {"content": [{"type": "text", "text": "started"}], "isError": false}});
        let refused =
            json!({"result": {"content": [{"type": "text", "text": "no"}], "isError": true}});
        let failed = json!({"error": {"code": -32601, "message": "Method not found"}});
        assert_eq!(read_answer(&ok), Ok("started".to_string()));
        assert_eq!(read_answer(&refused), Err("no".to_string()));
        assert_eq!(read_answer(&failed), Err("Method not found".to_string()));
        assert_eq!(read_answer(&json!({})), Err(NO_ANSWER.to_string()));
    }

    #[test]
    fn usage_names_every_tool_with_the_quoted_variable() {
        let text = usage();
        for tool in super::super::tools::TOOL_NAMES {
            assert!(text.contains(tool), "{tool}");
        }
        assert!(text.contains("\"$ZORVO_TOOLS\" tools delegate"));
    }
}
