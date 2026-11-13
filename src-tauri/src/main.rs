// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Both modes belong to an agent, not to the user: they must never open the app.
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("mcp-bridge") => std::process::exit(zorvo_lib::agent_tools::bridge::run()),
        Some("tools") => std::process::exit(zorvo_lib::agent_tools::cli::run(&args[2..])),
        _ => {}
    }
    zorvo_lib::run();
}
