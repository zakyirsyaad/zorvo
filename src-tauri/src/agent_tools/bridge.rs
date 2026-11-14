//! `zorvo mcp-bridge`: the stdio MCP server an agent starts. It only copies
//! bytes between its stdio and Zorvo's private socket; the MCP itself is
//! spoken by the backend behind the socket.

use std::io::{Read, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::thread;

pub const SOCKET_VARIABLE: &str = "ZORVO_MCP_SOCKET";
pub const TOKEN_VARIABLE: &str = "ZORVO_MCP_TOKEN";
/// The executable's own path, for an agent that runs `zorvo tools` from its shell.
pub const TOOLS_VARIABLE: &str = "ZORVO_TOOLS";

/// Returns the process exit code. Prints at most one plain line on stderr and
/// never the token.
pub fn run() -> i32 {
    let (Some(path), Some(token)) = (
        std::env::var_os(SOCKET_VARIABLE),
        std::env::var(TOKEN_VARIABLE).ok(),
    ) else {
        eprintln!("zorvo mcp-bridge: {SOCKET_VARIABLE} and {TOKEN_VARIABLE} must be set.");
        return 1;
    };
    let Ok(mut socket) = UnixStream::connect(&path) else {
        eprintln!("zorvo mcp-bridge: Zorvo is not reachable.");
        return 1;
    };
    let hello = serde_json::json!({ "token": token }).to_string();
    if socket.write_all(hello.as_bytes()).is_err() || socket.write_all(b"\n").is_err() {
        eprintln!("zorvo mcp-bridge: Zorvo closed the connection.");
        return 1;
    }
    let Ok(mut outgoing) = socket.try_clone() else {
        eprintln!("zorvo mcp-bridge: could not use the connection.");
        return 1;
    };
    // stdin -> socket on its own thread. When stdin ends, close the write side
    // so Zorvo sees the end and closes the other direction.
    thread::spawn(move || {
        let mut stdin = std::io::stdin().lock();
        let mut buffer = [0u8; 8192];
        loop {
            match stdin.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if outgoing.write_all(&buffer[..n]).is_err() {
                        break;
                    }
                }
            }
        }
        let _ = outgoing.shutdown(Shutdown::Write);
    });
    // socket -> stdout here; flush every chunk, an agent waits for each line.
    let mut stdout = std::io::stdout().lock();
    let mut buffer = [0u8; 8192];
    loop {
        match socket.read(&mut buffer) {
            Ok(0) => return 0,
            Ok(n) => {
                if stdout
                    .write_all(&buffer[..n])
                    .and_then(|_| stdout.flush())
                    .is_err()
                {
                    return 1;
                }
            }
            Err(_) => return 1,
        }
    }
}
