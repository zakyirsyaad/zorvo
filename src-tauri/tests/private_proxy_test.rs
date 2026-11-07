//! The loopback dev base is never sent through the user's proxy. Its own test
//! binary, since proxy settings are process-wide environment variables.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use zorvo_lib::private_mode::client::{CreditsApi, HttpCredits};

const BODY: &str = r#"{"credits":7,"usedCredits":1,"keyReady":false,"updatedAt":"t"}"#;

#[test]
fn a_loopback_base_bypasses_the_proxy_environment() {
    let proxy = TcpListener::bind("127.0.0.1:0").expect("bind proxy");
    let proxy_url = format!("http://{}", proxy.local_addr().expect("proxy addr"));
    let proxy_hits = Arc::new(AtomicUsize::new(0));
    let hits = proxy_hits.clone();
    thread::spawn(move || {
        while let Ok((mut stream, _)) = proxy.accept() {
            hits.fetch_add(1, Ordering::SeqCst);
            let _ = stream.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
        }
    });

    let server = TcpListener::bind("127.0.0.1:0").expect("bind server");
    let base = format!("http://{}", server.local_addr().expect("server addr"));
    let served = thread::spawn(move || {
        let (mut stream, _) = server.accept().expect("accept");
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .expect("timeout");
        let mut buf = [0u8; 2048];
        let n = stream.read(&mut buf).expect("read");
        let request = String::from_utf8_lossy(&buf[..n]).to_string();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{BODY}",
            BODY.len()
        );
        stream.write_all(response.as_bytes()).expect("write");
        request
    });

    // Set before the client is built: ureq reads them when it makes its config.
    for name in ["ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy"] {
        // SAFETY: this binary has one test, so nothing else touches the environment.
        unsafe { std::env::set_var(name, &proxy_url) };
    }
    // An ambient NO_PROXY that covers 127.0.0.1 would bypass the proxy by
    // itself and let this test pass whatever the client does.
    for name in ["NO_PROXY", "no_proxy"] {
        // SAFETY: as above.
        unsafe { std::env::remove_var(name) };
    }

    let api = HttpCredits::new(&base).expect("loopback base");
    let balance = api
        .balance("ZRV-ABCD-EFGH-JKMN-PQRS", false)
        .expect("balance");

    assert_eq!(balance.credits, 7);
    let request = served.join().expect("server");
    assert!(
        request.starts_with("GET /v1/balance HTTP/1.1\r\n"),
        "{request}"
    );
    assert_eq!(
        proxy_hits.load(Ordering::SeqCst),
        0,
        "the proxy saw a request"
    );
}
