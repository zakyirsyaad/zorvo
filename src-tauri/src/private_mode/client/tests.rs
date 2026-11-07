use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread::{self, JoinHandle};

const SECRET: &str = "ZRV-ABCD-EFGH-JKMN-PQRS";
const HASH: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TOPUP_ID: &str = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

fn http(status: &str, body: &[u8]) -> Vec<u8> {
    let mut out = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    out.extend_from_slice(body);
    out
}

fn header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n").map(|i| i + 4)
}

fn content_length(head: &str) -> usize {
    head.lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse().ok())?
        })
        .unwrap_or(0)
}

/// Reads one whole request (head and body) off `stream` as text.
fn read_request(stream: &mut std::net::TcpStream) -> String {
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(5)))
        .expect("read timeout");
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        if let Some(end) = header_end(&buf) {
            let head = String::from_utf8_lossy(&buf[..end]).to_string();
            if buf.len() >= end + content_length(&head) {
                break;
            }
        }
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    }
    String::from_utf8_lossy(&buf).to_string()
}

/// A one-shot stub on 127.0.0.1: answers one request with `response`, then
/// returns the request it saw. The base URL is for `HttpCredits::new`.
fn serve_once(response: Vec<u8>) -> (String, JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let base = format!("http://{}", listener.local_addr().expect("addr"));
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let request = read_request(&mut stream);
        // The client may stop reading a body it refuses; that is fine.
        let _ = stream.write_all(&response);
        request
    });
    (base, handle)
}

fn client(base: &str) -> HttpCredits {
    HttpCredits::new(base).expect("a local base is accepted")
}

// --- error_from -------------------------------------------------------

#[test]
fn error_from_maps_every_server_code() {
    let cases = [
        (409, r#"{"error":"stock"}"#, PrivateError::Stock),
        (409, r#"{"error":"device_cap"}"#, PrivateError::DeviceCap),
        (
            429,
            r#"{"error":"rate_limited"}"#,
            PrivateError::RateLimited,
        ),
        (
            401,
            r#"{"error":"unauthorized"}"#,
            PrivateError::Unauthorized,
        ),
        (404, r#"{"error":"not_found"}"#, PrivateError::NotFound),
        (400, r#"{"error":"bad_request"}"#, PrivateError::BadRequest),
        (502, r#"{"error":"upstream"}"#, PrivateError::Upstream),
        (500, "", PrivateError::Upstream),
    ];
    for (status, body, expected) in cases {
        assert_eq!(error_from(status, body), expected, "{status} {body}");
    }
}

#[test]
fn error_from_falls_back_on_the_status() {
    assert_eq!(error_from(401, "nope"), PrivateError::Unauthorized);
    assert_eq!(error_from(404, "<html>"), PrivateError::NotFound);
    assert_eq!(error_from(429, ""), PrivateError::RateLimited);
    assert_eq!(error_from(502, "<html>"), PrivateError::Upstream);
    assert_eq!(error_from(409, "{}"), PrivateError::BadRequest);
    assert_eq!(error_from(302, ""), PrivateError::Upstream);
}

#[test]
fn a_server_error_status_wins_over_a_body_code() {
    assert_eq!(
        error_from(503, r#"{"error":"stock"}"#),
        PrivateError::Upstream
    );
}

// --- base URL ---------------------------------------------------------

#[test]
fn new_accepts_only_https_or_loopback_http() {
    assert!(HttpCredits::new("https://x.workers.dev").is_ok());
    assert!(HttpCredits::new("https://x.workers.dev/").is_ok());
    assert!(HttpCredits::new("http://127.0.0.1:8787").is_ok());
    assert!(HttpCredits::new("http://127.0.0.1").is_ok());
    for bad in [
        "http://example.com",
        "http://localhost:8787",
        "http://127.0.0.1.evil.com",
        "http://127.0.0.1@evil.com",
        "http://user@127.0.0.1:8787",
        "ftp://x.workers.dev",
        "x.workers.dev",
        "",
    ] {
        assert_eq!(
            HttpCredits::new(bad).err(),
            Some(PrivateError::BadRequest),
            "{bad}"
        );
    }
}

// --- response shapes --------------------------------------------------

#[test]
fn stock_reads_the_spec_example() {
    let json = r#"{
      "availableCredits": 12400,
      "yourRoomCredits": 4500,
      "packages": [
        { "usd": 5,  "credits": 500,  "available": true },
        { "usd": 25, "credits": 2500, "available": false, "reason": "device_cap" }
      ],
      "updatedAt": "2026-11-07T01:10:00Z"
    }"#;
    let stock: Stock = parse(json).expect("parses");
    assert_eq!(stock.available_credits, 12400);
    assert_eq!(stock.your_room_credits, 4500);
    assert_eq!(stock.packages.len(), 2);
    assert_eq!(stock.packages[0].reason, None);
    assert_eq!(stock.packages[1].reason.as_deref(), Some("device_cap"));
    assert!(!stock.packages[1].available);
}

#[test]
fn balance_reads_the_server_example_and_ignores_unknown_fields() {
    let json = r#"{"credits":1200,"usedCredits":300,"keyReady":true,
                   "updatedAt":"2026-11-07T01:10:00Z","extra":1}"#;
    let balance: Balance = parse(json).expect("parses");
    assert_eq!(balance.credits, 1200);
    assert_eq!(balance.used_credits, 300);
    assert!(balance.key_ready);
}

#[test]
fn a_missing_required_field_is_an_upstream_error() {
    assert_eq!(parse::<Balance>("{}").err(), Some(PrivateError::Upstream));
    assert_eq!(
        parse::<Balance>("<html>").err(),
        Some(PrivateError::Upstream)
    );
}

// --- requests against a stub -----------------------------------------

#[test]
fn balance_fresh_sends_the_query_and_the_bearer_secret() {
    let body = br#"{"credits":1200,"usedCredits":300,"keyReady":true,"updatedAt":"t"}"#;
    let (base, served) = serve_once(http("200 OK", body));

    let balance = client(&base).balance(SECRET, true).expect("balance");

    assert_eq!(balance.credits, 1200);
    let request = served.join().expect("stub");
    assert!(
        request.starts_with("GET /v1/balance?fresh=1 HTTP/1.1\r\n"),
        "{request}"
    );
    assert_eq!(
        header_value(&request, "authorization"),
        Some(format!("Bearer {SECRET}").as_str()),
        "{request}"
    );
}

#[test]
fn balance_without_fresh_has_no_query() {
    let body = br#"{"credits":0,"usedCredits":0,"keyReady":false,"updatedAt":"t"}"#;
    let (base, served) = serve_once(http("200 OK", body));

    client(&base).balance(SECRET, false).expect("balance");

    let request = served.join().expect("stub");
    assert!(
        request.starts_with("GET /v1/balance HTTP/1.1\r\n"),
        "{request}"
    );
}

#[test]
fn register_posts_the_hash_without_a_bearer() {
    let (base, served) = serve_once(http("201 Created", br#"{"deviceId":"d1"}"#));

    client(&base).register(HASH).expect("registered");

    let request = served.join().expect("stub");
    assert!(
        request.starts_with("POST /v1/devices HTTP/1.1\r\n"),
        "{request}"
    );
    assert!(!request.to_ascii_lowercase().contains("authorization"));
    assert!(
        request.ends_with(&format!(r#"{{"secretHash":"{HASH}"}}"#)),
        "{request}"
    );
}

#[test]
fn register_treats_a_duplicate_hash_as_registered() {
    let (base, _served) = serve_once(http("400 Bad Request", br#"{"error":"bad_request"}"#));
    assert_eq!(client(&base).register(HASH), Ok(()));
}

#[test]
fn register_counts_only_the_workers_own_400_as_already_registered() {
    // A 400 that is not the Worker's `{"error":"bad_request"}` (a proxy's
    // page, an empty body, another code) is a failed register.
    let cases: [&[u8]; 4] = [
        b"",
        b"<html>Bad Request</html>",
        br#"{"error":"rate_limited"}"#,
        br#"{"message":"bad_request"}"#,
    ];
    for body in cases {
        let (base, _served) = serve_once(http("400 Bad Request", body));
        assert!(
            client(&base).register(HASH).is_err(),
            "{}",
            String::from_utf8_lossy(body)
        );
    }
    let (base, _served) = serve_once(http("400 Bad Request", b"nope"));
    assert_eq!(client(&base).register(HASH), Err(PrivateError::BadRequest));
}

/// The value of the request's `name` header, the name read in any case
/// (HTTP header names are), the value exactly as sent.
fn header_value<'a>(request: &'a str, name: &str) -> Option<&'a str> {
    request.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.eq_ignore_ascii_case(name).then(|| value.trim())
    })
}

#[test]
fn the_bearer_header_carries_the_secret_exactly() {
    let body = br#"{"credits":0,"usedCredits":0,"keyReady":false,"updatedAt":"t"}"#;
    let (base, served) = serve_once(http("200 OK", body));

    client(&base).balance(SECRET, false).expect("balance");

    let request = served.join().expect("stub");
    assert_eq!(
        header_value(&request, "authorization"),
        Some(format!("Bearer {SECRET}").as_str()),
        "{request}"
    );
}

#[test]
fn register_reports_a_rate_limit() {
    let (base, _served) = serve_once(http(
        "429 Too Many Requests",
        br#"{"error":"rate_limited"}"#,
    ));
    assert_eq!(client(&base).register(HASH), Err(PrivateError::RateLimited));
}

#[test]
fn create_topup_posts_the_package_and_reads_the_checkout() {
    let body = br#"{"topupId":"t1","sessionUrl":"https://pay.pingpay.io/x","expiresAt":"e"}"#;
    let (base, served) = serve_once(http("201 Created", body));

    let created = client(&base).create_topup(SECRET, 10).expect("topup");

    assert_eq!(created.topup_id, "t1");
    assert_eq!(created.session_url, "https://pay.pingpay.io/x");
    let request = served.join().expect("stub");
    assert!(
        request.starts_with("POST /v1/topups HTTP/1.1\r\n"),
        "{request}"
    );
    assert_eq!(
        header_value(&request, "authorization"),
        Some(format!("Bearer {SECRET}").as_str()),
        "{request}"
    );
    assert!(request.ends_with(r#"{"packageUsd":10}"#), "{request}");
}

#[test]
fn create_topup_maps_a_stock_refusal() {
    let (base, _served) = serve_once(http("409 Conflict", br#"{"error":"stock"}"#));
    assert_eq!(
        client(&base).create_topup(SECRET, 10).err(),
        Some(PrivateError::Stock)
    );
}

#[test]
fn topup_and_cancel_use_the_topup_paths() {
    let (base, served) = serve_once(http("200 OK", br#"{"status":"credited","credits":500}"#));
    let state = client(&base).topup(SECRET, TOPUP_ID).expect("state");
    assert_eq!(state.status, "credited");
    assert_eq!(state.credits, 500);
    let request = served.join().expect("stub");
    assert!(
        request.starts_with(&format!("GET /v1/topups/{TOPUP_ID} HTTP/1.1\r\n")),
        "{request}"
    );

    let (base, served) = serve_once(http("200 OK", br#"{"ok":true}"#));
    client(&base)
        .cancel_topup(SECRET, TOPUP_ID)
        .expect("cancel");
    let request = served.join().expect("stub");
    assert!(
        request.starts_with(&format!("POST /v1/topups/{TOPUP_ID}/cancel HTTP/1.1\r\n")),
        "{request}"
    );
}

#[test]
fn a_topup_id_that_is_not_a_plain_token_never_reaches_the_network() {
    // Nothing listens on port 1: a request would be Unreachable.
    let api = client("http://127.0.0.1:1");
    for id in ["", "../balance", "a/b", "a?b=1", "a b", &"x".repeat(65)] {
        assert_eq!(
            api.topup(SECRET, id).err(),
            Some(PrivateError::BadRequest),
            "{id:?}"
        );
        assert_eq!(
            api.cancel_topup(SECRET, id).err(),
            Some(PrivateError::BadRequest),
            "{id:?}"
        );
    }
}

#[test]
fn take_key_returns_the_key_or_none() {
    let (base, served) = serve_once(http("200 OK", br#"{"key":"sk-live-1"}"#));
    assert_eq!(
        client(&base).take_key(SECRET),
        Ok(Some("sk-live-1".to_string()))
    );
    let request = served.join().expect("stub");
    assert!(request.starts_with("GET /v1/key HTTP/1.1\r\n"), "{request}");

    let (base, _served) = serve_once(http("404 Not Found", br#"{"error":"not_found"}"#));
    assert_eq!(client(&base).take_key(SECRET), Ok(None));
}

#[test]
fn redeem_promo_posts_the_code() {
    let (base, served) = serve_once(http("201 Created", br#"{"topupId":"p1","credits":500}"#));

    let result = client(&base)
        .redeem_promo(SECRET, "HELLO-2026")
        .expect("promo");

    assert_eq!(result.topup_id, "p1");
    assert_eq!(result.credits, 500);
    let request = served.join().expect("stub");
    assert!(
        request.starts_with("POST /v1/promo HTTP/1.1\r\n"),
        "{request}"
    );
    assert!(request.ends_with(r#"{"code":"HELLO-2026"}"#), "{request}");
}

#[test]
fn recover_posts_both_values_without_a_bearer() {
    let (base, served) = serve_once(http("200 OK", br#"{"ok":true}"#));

    client(&base).recover(SECRET, HASH).expect("recovered");

    let request = served.join().expect("stub");
    assert!(
        request.starts_with("POST /v1/recover HTTP/1.1\r\n"),
        "{request}"
    );
    assert!(!request.to_ascii_lowercase().contains("authorization"));
    let body: serde_json::Value =
        serde_json::from_str(request.split("\r\n\r\n").nth(1).expect("body")).expect("json");
    assert_eq!(body["recoveryCode"], SECRET);
    assert_eq!(body["newSecretHash"], HASH);
}

#[test]
fn stock_and_models_read_their_lists() {
    let stock = br#"{"availableCredits":100,"yourRoomCredits":50,"packages":[],"updatedAt":"t"}"#;
    let (base, served) = serve_once(http("200 OK", stock));
    client(&base).stock(SECRET).expect("stock");
    assert!(served
        .join()
        .expect("stub")
        .starts_with("GET /v1/stock HTTP/1.1\r\n"));

    let models = br#"{"models":[{"id":"qwen3-30b","inputPerM":0.15,"outputPerM":0.6}]}"#;
    let (base, served) = serve_once(http("200 OK", models));
    let list = client(&base).models(SECRET).expect("models");
    assert!(served
        .join()
        .expect("stub")
        .starts_with("GET /v1/models HTTP/1.1\r\n"));
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, "qwen3-30b");
    assert_eq!(list[0].input_per_m, 0.15);
}

#[test]
fn a_401_is_unauthorized() {
    let (base, _served) = serve_once(http("401 Unauthorized", br#"{"error":"unauthorized"}"#));
    assert_eq!(
        client(&base).balance(SECRET, false).err(),
        Some(PrivateError::Unauthorized)
    );
}

#[test]
fn a_body_over_the_cap_is_an_upstream_error() {
    let big = vec![b' '; 4 * 1024 * 1024];
    let (base, _served) = serve_once(http("200 OK", &big));
    assert_eq!(
        client(&base).balance(SECRET, false).err(),
        Some(PrivateError::Upstream)
    );
}

#[test]
fn a_closed_connection_is_unreachable() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let base = format!("http://{}", listener.local_addr().expect("addr"));
    let handle = thread::spawn(move || {
        let (stream, _) = listener.accept().expect("accept");
        drop(stream);
    });
    assert_eq!(
        client(&base).balance(SECRET, false).err(),
        Some(PrivateError::Unreachable)
    );
    handle.join().expect("stub");
}

#[test]
fn a_refused_connection_is_unreachable() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let base = format!("http://{}", listener.local_addr().expect("addr"));
    drop(listener);
    assert_eq!(
        client(&base).balance(SECRET, false).err(),
        Some(PrivateError::Unreachable)
    );
}

// --- fix round 1 -----------------------------------------------------

/// A raw response: status line and headers as given, the body as bytes.
fn raw(head: &str, body: &[u8]) -> Vec<u8> {
    let mut out = head.as_bytes().to_vec();
    out.extend_from_slice(body);
    out
}

fn json_padded_to(len: usize) -> Vec<u8> {
    let head = br#"{"credits":1,"usedCredits":0,"keyReady":false,"updatedAt":"t"}"#;
    let mut body = head.to_vec();
    body.resize(len, b' ');
    body
}

#[test]
fn a_body_of_exactly_the_cap_passes_and_one_more_byte_does_not() {
    let cap = MAX_BODY_BYTES as usize;
    let (base, _served) = serve_once(http("200 OK", &json_padded_to(cap)));
    assert_eq!(
        client(&base).balance(SECRET, false).map(|b| b.credits),
        Ok(1)
    );

    let (base, _served) = serve_once(http("200 OK", &json_padded_to(cap + 1)));
    assert_eq!(
        client(&base).balance(SECRET, false).err(),
        Some(PrivateError::Upstream)
    );
}

#[test]
fn an_unreadable_error_body_keeps_the_status() {
    let (base, _served) = serve_once(http("401 Unauthorized", &[0xff, 0xfe, 0xfd]));
    assert_eq!(
        client(&base).balance(SECRET, false).err(),
        Some(PrivateError::Unauthorized)
    );

    // Promises 100 bytes, sends 5, closes.
    let truncated = raw(
        "HTTP/1.1 429 Too Many Requests\r\nContent-Length: 100\r\nConnection: close\r\n\r\n",
        b"{\"err",
    );
    let (base, _served) = serve_once(truncated);
    assert_eq!(
        client(&base).balance(SECRET, false).err(),
        Some(PrivateError::RateLimited)
    );
}

#[test]
fn an_unreadable_success_body_is_upstream() {
    let (base, _served) = serve_once(http("200 OK", &[0xff, 0xfe, 0xfd]));
    assert_eq!(
        client(&base).balance(SECRET, false).err(),
        Some(PrivateError::Upstream)
    );
}

#[test]
fn an_empty_key_is_never_handed_over() {
    let (base, _served) = serve_once(http("200 OK", br#"{"key":""}"#));
    assert_eq!(
        client(&base).take_key(SECRET).err(),
        Some(PrivateError::Upstream)
    );
}

#[test]
fn new_rejects_more_odd_bases() {
    for bad in [
        "https://x@evil.com",
        "https://x?q=1",
        "https://x#f",
        "http://[::1]:8787",
    ] {
        assert_eq!(
            HttpCredits::new(bad).err(),
            Some(PrivateError::BadRequest),
            "{bad}"
        );
    }
}

#[test]
fn new_reads_an_upper_case_scheme_as_the_same_scheme() {
    assert!(HttpCredits::new("HTTP://127.0.0.1:8787").is_ok());
    assert!(HttpCredits::new("HTTPS://x.workers.dev").is_ok());
    assert_eq!(
        HttpCredits::new("HTTP://example.com").err(),
        Some(PrivateError::BadRequest)
    );
}

#[test]
fn a_base_with_a_path_joins_the_routes_without_a_double_slash() {
    let body = br#"{"credits":0,"usedCredits":0,"keyReady":false,"updatedAt":"t"}"#;
    let (base, served) = serve_once(http("200 OK", body));
    client(&format!("{base}/api/"))
        .balance(SECRET, false)
        .expect("balance");
    let request = served.join().expect("stub");
    assert!(
        request.starts_with("GET /api/v1/balance HTTP/1.1\r\n"),
        "{request}"
    );
}

#[test]
fn statuses_reach_error_from_through_the_stub() {
    let cases: [(&str, &[u8], PrivateError); 4] = [
        ("500 Internal Server Error", b"boom", PrivateError::Upstream),
        (
            "409 Conflict",
            br#"{"error":"device_cap"}"#,
            PrivateError::DeviceCap,
        ),
        ("400 Bad Request", b"", PrivateError::BadRequest),
        ("302 Found", b"", PrivateError::Upstream),
    ];
    for (status, body, expected) in cases {
        let (base, _served) = serve_once(http(status, body));
        assert_eq!(
            client(&base).balance(SECRET, false).err(),
            Some(expected),
            "{status}"
        );
    }
}

#[test]
fn a_success_body_that_is_not_json_is_upstream() {
    let (base, _served) = serve_once(http("200 OK", b"<html>hello</html>"));
    assert_eq!(
        client(&base).balance(SECRET, false).err(),
        Some(PrivateError::Upstream)
    );
}

#[test]
fn more_topup_id_injections_never_reach_the_network() {
    let api = client("http://127.0.0.1:1");
    for id in ["#", "%2f", "..", "a.b", "a%2Fb"] {
        assert_eq!(
            api.topup(SECRET, id).err(),
            Some(PrivateError::BadRequest),
            "{id}"
        );
        assert_eq!(
            api.cancel_topup(SECRET, id).err(),
            Some(PrivateError::BadRequest),
            "{id}"
        );
    }
}
