use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use zorvo_lib::agent_tools::socket::{socket_path, Listener, Tokens};

fn scratch(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("zt-{tag}-{}-{nanos}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// A listener whose connections are echoed line by line, and a channel with
/// the session id of every connection that got past the token.
fn serve(tag: &str) -> (PathBuf, Arc<Tokens>, mpsc::Receiver<String>) {
    let dir = scratch(tag);
    let path = socket_path(&dir);
    let listener = Listener::bind(&path).unwrap();
    let tokens = Arc::new(Tokens::new());
    let (tx, rx) = mpsc::channel();
    let accept_tokens = Arc::clone(&tokens);
    let tx = std::sync::Mutex::new(tx);
    thread::spawn(move || {
        listener.accept_loop(accept_tokens, move |session, stream| {
            tx.lock().unwrap().send(session).unwrap();
            let mut writer = stream.try_clone().unwrap();
            for line in BufReader::new(stream).lines() {
                let Ok(line) = line else { break };
                if writeln!(writer, "echo {line}").is_err() {
                    break;
                }
            }
        });
    });
    (path, tokens, rx)
}

fn token_line(token: &str) -> String {
    format!("{{\"token\":\"{token}\"}}\n")
}

#[test]
fn a_known_token_reaches_on_connection_with_its_session() {
    let (path, tokens, rx) = serve("known");
    let token = tokens.issue("s1");
    assert_eq!(token.len(), 64);
    assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
    let mut stream = UnixStream::connect(&path).unwrap();
    stream.write_all(token_line(&token).as_bytes()).unwrap();
    stream.write_all(b"{\"x\":1}\n").unwrap();
    assert_eq!(rx.recv_timeout(Duration::from_secs(3)).unwrap(), "s1");
    let mut reply = String::new();
    BufReader::new(stream).read_line(&mut reply).unwrap();
    assert_eq!(reply, "echo {\"x\":1}\n");
}

#[test]
fn issuing_again_replaces_the_token() {
    let tokens = Tokens::new();
    let first = tokens.issue("s1");
    let second = tokens.issue("s1");
    assert_ne!(first, second);
    assert_eq!(tokens.session_of(&first), None);
    assert_eq!(tokens.session_of(&second), Some("s1".to_string()));
}

#[test]
fn an_unknown_or_forgotten_token_is_closed_without_a_callback() {
    let (path, tokens, rx) = serve("unknown");
    let forgotten = tokens.issue("s1");
    tokens.forget("s1");
    for token in [forgotten, "ab".repeat(32)] {
        let mut stream = UnixStream::connect(&path).unwrap();
        stream.write_all(token_line(&token).as_bytes()).unwrap();
        let mut rest = Vec::new();
        assert_eq!(stream.read_to_end(&mut rest).unwrap(), 0);
    }
    assert!(rx.recv_timeout(Duration::from_millis(300)).is_err());
}

#[test]
fn garbage_or_silence_is_closed_within_three_seconds() {
    let (path, _tokens, rx) = serve("garbage");
    let cases: [Option<Vec<u8>>; 3] = [Some(b"hello\n".to_vec()), None, Some(vec![b'a'; 5000])];
    for case in cases {
        let started = Instant::now();
        let mut stream = UnixStream::connect(&path).unwrap();
        if let Some(bytes) = case {
            stream.write_all(&bytes).unwrap();
        }
        let mut rest = Vec::new();
        let _ = stream.read_to_end(&mut rest);
        assert!(rest.is_empty());
        assert!(started.elapsed() < Duration::from_secs(3));
    }
    assert!(rx.recv_timeout(Duration::from_millis(100)).is_err());
}

#[test]
fn the_socket_and_its_directory_are_private() {
    let dir = scratch("private");
    let path = socket_path(&dir);
    let _listener = Listener::bind(&path).unwrap();
    let file_mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    let dir_mode = fs::metadata(path.parent().unwrap())
        .unwrap()
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(file_mode, 0o600);
    assert_eq!(dir_mode, 0o700);
}

#[test]
fn a_folder_open_to_others_is_refused() {
    let dir = scratch("open");
    let sock_dir = dir.join("agent-tools");
    fs::create_dir_all(&sock_dir).unwrap();
    fs::set_permissions(&sock_dir, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(Listener::bind(&sock_dir.join("s.sock")).is_err());
}

#[test]
fn a_stale_socket_file_is_replaced_and_a_live_one_is_not() {
    let dir = scratch("stale");
    let path = socket_path(&dir);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::set_permissions(path.parent().unwrap(), fs::Permissions::from_mode(0o700)).unwrap();
    // std's listener leaves its file behind when dropped: a crashed Zorvo.
    drop(UnixListener::bind(&path).unwrap());
    assert!(path.exists());
    let first = Listener::bind(&path).expect("a stale file is replaced");
    assert!(Listener::bind(&path).is_err());
    drop(first);
}

#[test]
fn a_long_data_dir_falls_back_to_a_short_path() {
    let base = scratch("long");
    let long = base.join("x".repeat(120));
    let path = socket_path(&long);
    assert!(path.as_os_str().len() <= 100, "{path:?}");
    let other = socket_path(&base.join("y".repeat(120)));
    assert_ne!(path, other);
    let listener = Listener::bind(&path).unwrap();
    assert!(UnixStream::connect(&path).is_ok());
    drop(listener);
    let _ = fs::remove_dir(path.parent().unwrap());
}

#[test]
fn dropping_the_listener_removes_the_file() {
    let dir = scratch("drop");
    let path = socket_path(&dir);
    let listener = Listener::bind(&path).unwrap();
    assert!(path.exists());
    drop(listener);
    assert!(!path.exists());
}

#[test]
fn the_bridge_binary_copies_lines_both_ways() {
    let dir = scratch("bridge");
    let path = socket_path(&dir);
    let listener = Listener::bind(&path).unwrap();
    let tokens = Arc::new(Tokens::new());
    let token = tokens.issue("s1");
    let (tx, rx) = mpsc::channel::<UnixStream>();
    let tx = std::sync::Mutex::new(tx);
    let accept_tokens = Arc::clone(&tokens);
    thread::spawn(move || {
        listener.accept_loop(accept_tokens, move |_, stream| {
            tx.lock().unwrap().send(stream).unwrap();
        });
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_zorvo"))
        .arg("mcp-bridge")
        .env("ZORVO_MCP_SOCKET", &path)
        .env("ZORVO_MCP_TOKEN", &token)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    stdin.write_all(b"{\"from\":\"agent\"}\n").unwrap();
    let stream = rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let mut server_in = BufReader::new(stream.try_clone().unwrap());
    let mut line = String::new();
    server_in.read_line(&mut line).unwrap();
    assert_eq!(line, "{\"from\":\"agent\"}\n");
    let mut server_out = stream;
    server_out.write_all(b"{\"from\":\"zorvo\"}\n").unwrap();
    let mut back = String::new();
    stdout.read_line(&mut back).unwrap();
    assert_eq!(back, "{\"from\":\"zorvo\"}\n");
    drop(stdin);
    drop(server_out);
    drop(server_in);
    assert!(child.wait().unwrap().success());
}

#[test]
fn the_bridge_exits_non_zero_without_a_socket_and_prints_no_token() {
    let dir = scratch("nosock");
    let token = "ab".repeat(32);
    let out = Command::new(env!("CARGO_BIN_EXE_zorvo"))
        .arg("mcp-bridge")
        .env("ZORVO_MCP_SOCKET", dir.join("missing.sock"))
        .env("ZORVO_MCP_TOKEN", &token)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(!String::from_utf8_lossy(&out.stderr).contains(&token));
    assert!(out.stdout.is_empty());
    let none = Command::new(env!("CARGO_BIN_EXE_zorvo"))
        .arg("mcp-bridge")
        .env_remove("ZORVO_MCP_SOCKET")
        .env_remove("ZORVO_MCP_TOKEN")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(!none.status.success());
}
