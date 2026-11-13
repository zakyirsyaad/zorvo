// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Both modes belong to an agent, not to the user: they must never open the app.
    // `args()` panics on an argument that is not UTF-8; an agent's shell can pass anything.
    let args: Vec<String> = std::env::args_os()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    match args.get(1).map(String::as_str) {
        Some("mcp-bridge") => std::process::exit(zorvo_lib::agent_tools::bridge::run()),
        Some("tools") => std::process::exit(zorvo_lib::agent_tools::cli::run(&args[2..])),
        // An agent that runs the program any other way (Pi tried `--help`) gets the
        // usage, never a second copy of the app.
        _ if zorvo_lib::agent_tools::cli::is_agent_environment() => {
            std::process::exit(zorvo_lib::agent_tools::cli::refuse_app_start())
        }
        _ => {}
    }
    zorvo_lib::run();
}
