//! The user's GitHub connection, read and set up through their own GitHub CLI.
//!
//! Zorvo never asks for or stores a token. Sign-in happens inside `gh`; this
//! module only asks `gh` who is signed in (the login and the display name, and
//! nothing else) and runs `gh auth login` in a terminal the user finishes. The
//! webview sends no command, arguments or environment, and no argument list
//! here contains `--show-token` or `gh auth token`. Only github.com is read.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::env_resolver::find_binary_in_user_path;
use crate::pty_session::PtySessionManager;
use crate::pull_requests::{capture_gh, is_timeout_error};

/// The one host Zorvo reads and signs in to.
pub const GITHUB_HOST: &str = "github.com";

/// The event a GitHub sign-in terminal's output and exit go out on.
pub const SIGN_IN_EVENT: &str = "github-sign-in-terminal";

const SIGN_IN_ID_PREFIX: &str = "ghlogin-";
const MAX_ID_SUFFIX: usize = 64;

/// The sign-in command, in full: the webview never supplies any part of it.
/// No `--git-protocol`: gh applies it to the whole host, so forcing https would
/// switch a user who works over SSH; gh asks them in the terminal instead.
const SIGN_IN_ARGS: [&str; 5] = ["auth", "login", "--hostname", GITHUB_HOST, "--web"];
/// Who is signed in and whether it still works. `--json hosts` names the login,
/// the state and where the token comes from; gh adds the token itself only for
/// `--show-token` (`-t`), which Zorvo never passes, and Zorvo reads none of it.
const STATUS_ARGS: [&str; 6] = [
    "auth",
    "status",
    "--hostname",
    GITHUB_HOST,
    "--json",
    "hosts",
];
/// The signed-in user's own login and name; `--jq` keeps everything else out.
const USER_ARGS: [&str; 6] = [
    "api",
    "user",
    "--hostname",
    GITHUB_HOST,
    "--jq",
    "{login: .login, name: .name}",
];

const STATUS_TIMEOUT: Duration = Duration::from_secs(20);
const USER_TIMEOUT: Duration = Duration::from_secs(15);

const MAX_LOGIN_LEN: usize = 39;
const MAX_NAME_CHARS: usize = 100;

const MESSAGE_UNREACHABLE: &str = "Could not reach GitHub. Check your connection and try again.";
const MESSAGE_TIMED_OUT: &str = "GitHub did not answer in time. Try again.";
const MESSAGE_OLD_GH: &str =
    "This version of gh cannot report its sign-in. Update it with brew upgrade gh.";
const MESSAGE_UNREADABLE: &str = "gh gave an answer Zorvo could not read.";
const MESSAGE_CHECK_FAILED: &str = "gh could not check your sign-in.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum GithubState {
    NotInstalled,
    SignedOut,
    SignedIn,
    /// gh is there, but whether anyone is signed in could not be told (no
    /// network, a stalled gh, a gh too old to answer).
    Unknown,
}

/// What the UI shows about the GitHub connection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubStatus {
    pub state: GithubState,
    pub login: Option<String>,
    pub name: Option<String>,
    /// Why the state is unknown; plain words for the UI.
    pub message: Option<String>,
    /// Whether Connect can put it right. False for a rejected token in an
    /// environment variable: gh refuses to log in while that variable is set.
    pub can_connect: bool,
}

impl GithubStatus {
    fn of(state: GithubState) -> Self {
        Self {
            state,
            login: None,
            name: None,
            message: None,
            can_connect: true,
        }
    }

    fn unknown(message: &str) -> Self {
        Self {
            message: Some(message.to_string()),
            ..Self::of(GithubState::Unknown)
        }
    }

    /// A token from an environment variable that GitHub turned down.
    fn rejected_env_token(variable: &str) -> Self {
        Self {
            can_connect: false,
            ..Self::unknown(&format!(
                "The token in {variable} was rejected by GitHub. Renew or remove it, then check again."
            ))
        }
    }
}

/// What `gh auth status --json hosts` says about github.com.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthReading {
    SignedOut,
    SignedIn {
        login: String,
    },
    /// An account exists but could not be checked; the text is for the UI.
    Unknown(&'static str),
    /// The token comes from this environment variable and GitHub rejected it.
    RejectedEnvToken {
        variable: &'static str,
    },
}

/// A GitHub login: letters, digits and hyphens, and an underscore for an
/// Enterprise Managed User on github.com (`octocat_acme`).
fn is_login(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= MAX_LOGIN_LEN
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// The environment variable gh took the token from, when it is one it reads
/// for github.com.
fn env_token_variable(token_source: &str) -> Option<&'static str> {
    match token_source {
        "GH_TOKEN" => Some("GH_TOKEN"),
        "GITHUB_TOKEN" => Some("GITHUB_TOKEN"),
        _ => None,
    }
}

fn unexpected(what: &str) -> String {
    format!("Unexpected answer from gh: {what}")
}

/// What `gh auth status --hostname github.com --json hosts` printed: the active
/// account's state. Several accounts are told apart by `active`. Only a
/// `hosts` object with no github.com entry, or an empty one, means signed out;
/// JSON of any other shape is an error, so a changed gh never reads as signed out.
pub fn parse_auth_status(json: &str) -> Result<AuthReading, String> {
    let parsed: Value = serde_json::from_str(json).map_err(|e| unexpected(&e.to_string()))?;
    let hosts = parsed
        .get("hosts")
        .and_then(Value::as_object)
        .ok_or_else(|| unexpected("no hosts object"))?;
    let accounts: &[Value] = match hosts.get(GITHUB_HOST) {
        None => &[],
        Some(list) => list
            .as_array()
            .ok_or_else(|| unexpected("the accounts are not a list"))?,
    };
    if accounts.iter().any(|account| !account.is_object()) {
        return Err(unexpected("an account is not an object"));
    }
    // gh marks one account per host active; with none marked, the first speaks.
    let Some(account) = accounts
        .iter()
        .find(|account| account.get("active").and_then(Value::as_bool) == Some(true))
        .or_else(|| accounts.first())
    else {
        return Ok(AuthReading::SignedOut);
    };
    let text = |name: &str| account.get(name).and_then(Value::as_str).unwrap_or("");
    Ok(match text("state") {
        "success" if is_login(text("login")) => AuthReading::SignedIn {
            login: text("login").to_string(),
        },
        "success" => AuthReading::Unknown(MESSAGE_UNREADABLE),
        "timeout" => AuthReading::Unknown(MESSAGE_TIMED_OUT),
        _ if is_rejected_token(text("error")) => match env_token_variable(text("tokenSource")) {
            Some(variable) => AuthReading::RejectedEnvToken { variable },
            None => AuthReading::SignedOut,
        },
        _ => AuthReading::Unknown(MESSAGE_UNREACHABLE),
    })
}

/// True for the error of a token GitHub itself turned down (expired, revoked),
/// as opposed to one that could not be tried at all. A bare "401" would also
/// match a proxy port such as 127.0.0.1:4010, so it is the status line that counts.
fn is_rejected_token(error: &str) -> bool {
    let error = error.to_ascii_lowercase();
    error.contains("401 unauthorized") || error.contains("bad credentials")
}

/// Drops control characters and cuts a name from GitHub to a length a footer holds.
fn clean_name(raw: &str) -> Option<String> {
    let name: String = raw
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_NAME_CHARS)
        .collect();
    let name = name.trim();
    (!name.is_empty()).then(|| name.to_string())
}

/// The display name in `gh api user --jq '{login, name}'` output; None when
/// the user set none (GitHub answers `null`) or the answer is not JSON.
pub fn parse_user_name(json: &str) -> Option<String> {
    let parsed: Value = serde_json::from_str(json).ok()?;
    clean_name(parsed.get("name")?.as_str()?)
}

fn owned(args: &[&str]) -> Vec<String> {
    args.iter().map(|arg| arg.to_string()).collect()
}

/// A failed run of gh, told in words the UI can show.
fn failure_message(error: &str) -> &'static str {
    if is_timeout_error(error) {
        MESSAGE_TIMED_OUT
    } else {
        MESSAGE_CHECK_FAILED
    }
}

fn read_name(gh: &Path, dir: &Path) -> Option<String> {
    let output = capture_gh(gh, dir, &owned(&USER_ARGS), USER_TIMEOUT).ok()?;
    if !output.success {
        return None;
    }
    parse_user_name(&output.stdout)
}

/// The GitHub connection as `gh` reports it: not installed (`gh` is None),
/// signed out, signed in (with the login and, when GitHub has one, the name),
/// or unknown.
pub fn status_of(gh: Option<&Path>, dir: &Path) -> GithubStatus {
    let Some(gh) = gh else {
        return GithubStatus::of(GithubState::NotInstalled);
    };
    let output = match capture_gh(gh, dir, &owned(&STATUS_ARGS), STATUS_TIMEOUT) {
        Ok(output) => output,
        Err(error) => return GithubStatus::unknown(failure_message(&error)),
    };
    if !output.success {
        return GithubStatus::unknown(if output.stderr.contains("unknown flag") {
            MESSAGE_OLD_GH
        } else {
            MESSAGE_CHECK_FAILED
        });
    }
    match parse_auth_status(&output.stdout) {
        Ok(AuthReading::SignedOut) => GithubStatus::of(GithubState::SignedOut),
        Ok(AuthReading::SignedIn { login }) => GithubStatus {
            name: read_name(gh, dir),
            login: Some(login),
            ..GithubStatus::of(GithubState::SignedIn)
        },
        Ok(AuthReading::Unknown(message)) => GithubStatus::unknown(message),
        Ok(AuthReading::RejectedEnvToken { variable }) => {
            GithubStatus::rejected_env_token(variable)
        }
        Err(_) => GithubStatus::unknown(MESSAGE_UNREADABLE),
    }
}

/// A folder gh runs in: it needs none, but a process needs a working directory.
fn work_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|home| home.is_absolute() && home.is_dir())
        .unwrap_or_else(std::env::temp_dir)
}

/// The user's GitHub connection, read with their `gh`: signed in with their
/// login and name, signed out, `gh` not installed, or unknown.
#[tauri::command(async)]
pub fn github_status() -> GithubStatus {
    status_of(find_binary_in_user_path("gh").as_deref(), &work_dir())
}

/// `^ghlogin-[a-z0-9-]{1,64}$`: distinct from an agent's `signin-` terminals,
/// so the two never share a listener.
pub fn is_github_sign_in_id(id: &str) -> bool {
    id.strip_prefix(SIGN_IN_ID_PREFIX).is_some_and(|suffix| {
        (1..=MAX_ID_SUFFIX).contains(&suffix.len())
            && suffix
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    })
}

/// Runs `gh auth login` in a PTY named `terminal_id`.
pub fn start_sign_in(
    pty: &PtySessionManager,
    terminal_id: &str,
    gh: Option<&Path>,
    dir: &Path,
) -> Result<(), String> {
    if !is_github_sign_in_id(terminal_id) {
        return Err("Not a GitHub sign-in terminal id".to_string());
    }
    let gh = gh.ok_or("The GitHub CLI (gh) is not installed")?;
    let program = gh.to_str().ok_or("The path to gh is not valid UTF-8")?;
    let dir = dir
        .to_str()
        .ok_or("The working folder is not valid UTF-8")?;
    if pty.has_session(terminal_id) {
        return Err("That sign-in is already running".to_string());
    }
    pty.start_session(terminal_id, dir, program, &owned(&SIGN_IN_ARGS), &[])
}

/// Starts the GitHub sign-in in a terminal named `terminal_id`; its output and
/// exit go out on `github-sign-in-terminal`. Input and resize reuse
/// `send_input` / `resize_session`, and `terminate_session` ends it.
#[tauri::command(async)]
pub fn github_start_sign_in(
    pty: State<'_, PtySessionManager>,
    terminal_id: String,
) -> Result<(), String> {
    start_sign_in(
        &pty,
        &terminal_id,
        find_binary_in_user_path("gh").as_deref(),
        &work_dir(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    // Shaped like `gh auth status --hostname github.com --json hosts` (gh 2.102):
    // a signed-in account. The login is a stand-in; the scopes are shortened.
    const SIGNED_IN: &str = r#"{"hosts":{"github.com":[{"active":true,"gitProtocol":"ssh","host":"github.com","login":"octocat","scopes":"gist, read:org, repo","state":"success","tokenSource":"keyring"}]}}"#;
    // Real output with an empty GH_CONFIG_DIR.
    const SIGNED_OUT: &str = r#"{"hosts":{}}"#;
    // Real output for a token GitHub answered 401 to; it came from GH_TOKEN.
    const REJECTED_TOKEN: &str = r#"{"hosts":{"github.com":[{"state":"error","error":"non-200 OK status code: 401 Unauthorized body: \"{\\r\\n  \\\"message\\\": \\\"Bad credentials\\\",\\r\\n  \\\"status\\\": \\\"401\\\"\\r\\n}\"","active":true,"host":"github.com","login":"","tokenSource":"GH_TOKEN","gitProtocol":"https"}]}}"#;
    // The same answer for a token stored by gh itself (an expired login).
    const REJECTED_KEYRING_TOKEN: &str = r#"{"hosts":{"github.com":[{"state":"error","error":"non-200 OK status code: 401 Unauthorized body: \"{\\r\\n  \\\"message\\\": \\\"Bad credentials\\\",\\r\\n  \\\"status\\\": \\\"401\\\"\\r\\n}\"","active":true,"host":"github.com","login":"octocat","tokenSource":"keyring","gitProtocol":"https"}]}}"#;
    // Real output with HTTPS_PROXY pointing at a closed port (no network).
    const NO_NETWORK: &str = r#"{"hosts":{"github.com":[{"active":true,"error":"Get \"https://api.github.com/\": proxyconnect tcp: dial tcp 127.0.0.1:1: connect: connection refused","gitProtocol":"ssh","host":"github.com","login":"octocat","state":"error","tokenSource":"keyring"}]}}"#;
    // The same shape with two accounts on github.com: the active one is second.
    const SEVERAL_ACCOUNTS: &str = r#"{"hosts":{"github.com":[
        {"active":false,"gitProtocol":"https","host":"github.com","login":"work-account","state":"success","tokenSource":"keyring"},
        {"active":true,"gitProtocol":"ssh","host":"github.com","login":"octocat","state":"success","tokenSource":"keyring"}]}}"#;
    // Only another host is signed in.
    const OTHER_HOST_ONLY: &str = r#"{"hosts":{"github.example.com":[{"active":true,"host":"github.example.com","login":"octocat","state":"success","tokenSource":"keyring"}]}}"#;

    #[test]
    fn reads_the_login_of_a_signed_in_account() {
        assert_eq!(
            parse_auth_status(SIGNED_IN),
            Ok(AuthReading::SignedIn {
                login: "octocat".to_string()
            })
        );
    }

    #[test]
    fn reads_no_account_as_signed_out() {
        assert_eq!(parse_auth_status(SIGNED_OUT), Ok(AuthReading::SignedOut));
        assert_eq!(
            parse_auth_status(OTHER_HOST_ONLY),
            Ok(AuthReading::SignedOut)
        );
        assert_eq!(
            parse_auth_status(r#"{"hosts":{"github.com":[]}}"#),
            Ok(AuthReading::SignedOut)
        );
    }

    #[test]
    fn reads_a_stored_token_github_rejected_as_signed_out() {
        assert_eq!(
            parse_auth_status(REJECTED_KEYRING_TOKEN),
            Ok(AuthReading::SignedOut)
        );
    }

    #[test]
    fn reads_a_rejected_token_from_an_environment_variable_as_its_own_case() {
        assert_eq!(
            parse_auth_status(REJECTED_TOKEN),
            Ok(AuthReading::RejectedEnvToken {
                variable: "GH_TOKEN"
            })
        );
        let github_token = REJECTED_TOKEN.replace("GH_TOKEN", "GITHUB_TOKEN");
        assert_eq!(
            parse_auth_status(&github_token),
            Ok(AuthReading::RejectedEnvToken {
                variable: "GITHUB_TOKEN"
            })
        );
    }

    #[test]
    fn says_which_variable_to_renew_and_offers_no_connect() {
        let status = GithubStatus::rejected_env_token("GH_TOKEN");

        assert_eq!(status.state, GithubState::Unknown);
        assert_eq!(
            status.message.as_deref(),
            Some("The token in GH_TOKEN was rejected by GitHub. Renew or remove it, then check again.")
        );
        assert!(!status.can_connect);
        assert!(GithubStatus::of(GithubState::SignedOut).can_connect);
    }

    #[test]
    fn reads_json_of_any_other_shape_as_an_error_not_as_signed_out() {
        for json in [
            "{}",
            "[]",
            "null",
            "0",
            r#"{"hosts":[]}"#,
            r#"{"hosts":null}"#,
            r#"{"hosts":"github.com"}"#,
            r#"{"hosts":{"github.com":null}}"#,
            r#"{"hosts":{"github.com":{"login":"octocat","state":"success"}}}"#,
            r#"{"hosts":{"github.com":["octocat"]}}"#,
            r#"{"accounts":{}}"#,
        ] {
            assert!(parse_auth_status(json).is_err(), "{json}");
        }
    }

    #[test]
    fn accepts_the_login_of_an_enterprise_managed_user() {
        let json = r#"{"hosts":{"github.com":[{"active":true,"state":"success","login":"octocat_acme"}]}}"#;

        assert_eq!(
            parse_auth_status(json),
            Ok(AuthReading::SignedIn {
                login: "octocat_acme".to_string()
            })
        );
    }

    #[test]
    fn does_not_mistake_a_proxy_port_for_a_rejected_token() {
        // Contains "401", but it is a refused connection, not a 401 from GitHub.
        let json = r#"{"hosts":{"github.com":[{"active":true,"state":"error","login":"octocat","error":"Get \"https://api.github.com/\": proxyconnect tcp: dial tcp 127.0.0.1:4010: connect: connection refused"}]}}"#;

        assert_eq!(
            parse_auth_status(json),
            Ok(AuthReading::Unknown(MESSAGE_UNREACHABLE))
        );
    }

    #[test]
    fn reads_an_account_that_could_not_be_checked_as_unknown() {
        assert_eq!(
            parse_auth_status(NO_NETWORK),
            Ok(AuthReading::Unknown(MESSAGE_UNREACHABLE))
        );
        let timeout =
            r#"{"hosts":{"github.com":[{"active":true,"state":"timeout","login":"octocat"}]}}"#;
        assert_eq!(
            parse_auth_status(timeout),
            Ok(AuthReading::Unknown(MESSAGE_TIMED_OUT))
        );
    }

    #[test]
    fn uses_the_active_account_when_there_are_several() {
        assert_eq!(
            parse_auth_status(SEVERAL_ACCOUNTS),
            Ok(AuthReading::SignedIn {
                login: "octocat".to_string()
            })
        );
    }

    #[test]
    fn uses_the_first_account_when_none_is_marked_active() {
        let json = r#"{"hosts":{"github.com":[{"login":"first","state":"success"},{"login":"second","state":"success"}]}}"#;

        assert_eq!(
            parse_auth_status(json),
            Ok(AuthReading::SignedIn {
                login: "first".to_string()
            })
        );
    }

    #[test]
    fn refuses_a_login_that_is_not_one() {
        for login in ["", "has space", "a/b", "a.b", "<b>x</b>", &"a".repeat(40)] {
            let json = format!(
                r#"{{"hosts":{{"github.com":[{{"active":true,"state":"success","login":{}}}]}}}}"#,
                serde_json::to_string(login).expect("quote login")
            );
            assert_eq!(
                parse_auth_status(&json),
                Ok(AuthReading::Unknown(MESSAGE_UNREADABLE)),
                "{login:?}"
            );
        }
    }

    #[test]
    fn reports_an_answer_that_is_not_json() {
        assert!(parse_auth_status("You are not logged into any GitHub hosts.").is_err());
        assert!(parse_auth_status("").is_err());
    }

    #[test]
    fn reads_the_display_name() {
        assert_eq!(
            parse_user_name(r#"{"login":"octocat","name":"The Octocat"}"#),
            Some("The Octocat".to_string())
        );
        assert_eq!(
            parse_user_name(r#"{"login":"octocat","name":"  Zaky\u0007 Irsyad  "}"#),
            Some("Zaky Irsyad".to_string())
        );
    }

    #[test]
    fn has_no_name_when_github_has_none() {
        assert_eq!(parse_user_name(r#"{"login":"octocat","name":null}"#), None);
        assert_eq!(parse_user_name(r#"{"login":"octocat","name":"  "}"#), None);
        assert_eq!(parse_user_name(r#"{"login":"octocat"}"#), None);
        assert_eq!(parse_user_name("not json"), None);
    }

    #[test]
    fn cuts_a_very_long_name() {
        let json = format!(r#"{{"name":"{}"}}"#, "n".repeat(500));

        assert_eq!(
            parse_user_name(&json).map(|name| name.chars().count()),
            Some(MAX_NAME_CHARS)
        );
    }

    #[test]
    fn serializes_with_the_names_the_ui_reads() {
        let json = serde_json::to_value(GithubStatus {
            name: Some("The Octocat".to_string()),
            login: Some("octocat".to_string()),
            ..GithubStatus::of(GithubState::SignedIn)
        })
        .expect("serialize");

        assert_eq!(
            json,
            serde_json::json!({
                "state": "signed-in", "login": "octocat", "name": "The Octocat",
                "message": null, "canConnect": true
            })
        );
        assert_eq!(
            serde_json::to_value(GithubState::NotInstalled).expect("serialize"),
            "not-installed"
        );
        assert_eq!(
            serde_json::to_value(GithubState::SignedOut).expect("serialize"),
            "signed-out"
        );
    }

    #[test]
    fn asks_gh_for_no_token() {
        for args in [&STATUS_ARGS[..], &USER_ARGS[..], &SIGN_IN_ARGS[..]] {
            for arg in args {
                // `--show-token` and its short form `-t`.
                assert!(!arg.contains("token") && *arg != "-t", "{arg}");
            }
        }
    }

    #[test]
    fn reads_the_connection_with_exactly_these_commands() {
        assert_eq!(
            owned(&STATUS_ARGS),
            [
                "auth",
                "status",
                "--hostname",
                "github.com",
                "--json",
                "hosts"
            ]
        );
        assert_eq!(
            owned(&USER_ARGS),
            [
                "api",
                "user",
                "--hostname",
                "github.com",
                "--jq",
                "{login: .login, name: .name}"
            ]
        );
    }

    #[test]
    fn signs_in_with_exactly_this_command() {
        assert_eq!(
            owned(&SIGN_IN_ARGS),
            ["auth", "login", "--hostname", "github.com", "--web"]
        );
    }

    #[test]
    fn a_github_sign_in_id_is_not_an_agent_sign_in_id() {
        use crate::acp::terminal_auth::is_sign_in_terminal_id;

        assert!(is_github_sign_in_id("ghlogin-1729150000000-k3x9a"));
        assert!(is_github_sign_in_id(&format!("ghlogin-{}", "a".repeat(64))));
        for bad in [
            "signin-1",
            "shell-1",
            "ghlogin-",
            "ghlogin-A",
            "ghlogin-../x",
        ] {
            assert!(!is_github_sign_in_id(bad), "{bad}");
        }
        assert!(!is_github_sign_in_id(&format!(
            "ghlogin-{}",
            "a".repeat(65)
        )));
        assert!(!is_sign_in_terminal_id("ghlogin-1"));
    }

    #[test]
    fn says_so_when_gh_is_not_installed() {
        assert_eq!(
            status_of(None, &std::env::temp_dir()),
            GithubStatus::of(GithubState::NotInstalled)
        );
        let pty = PtySessionManager::default_manager();

        let error = start_sign_in(&pty, "ghlogin-1", None, &std::env::temp_dir())
            .expect_err("gh is missing");

        assert!(error.contains("not installed"));
    }

    #[test]
    fn starts_no_sign_in_for_an_id_that_is_not_its_own() {
        let pty = PtySessionManager::default_manager();

        let error = start_sign_in(
            &pty,
            "signin-1",
            Some(Path::new("/bin/echo")),
            &std::env::temp_dir(),
        )
        .expect_err("a foreign id");

        assert!(error.contains("Not a GitHub sign-in terminal id"));
        assert!(!pty.has_session("signin-1"));
    }

    /// A stand-in for gh: a shell script with `body`, in a fresh folder.
    #[cfg(unix)]
    fn fake_gh(name: &str, body: &str) -> (PathBuf, PathBuf) {
        use std::os::unix::fs::PermissionsExt;
        let dir =
            std::env::temp_dir().join(format!("fake-gh-github-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create fake gh folder");
        let gh = dir.join("gh");
        std::fs::write(&gh, format!("#!/bin/sh\n{body}\n")).expect("write fake gh");
        std::fs::set_permissions(&gh, std::fs::Permissions::from_mode(0o755))
            .expect("make fake gh runnable");
        (gh, dir)
    }

    #[cfg(unix)]
    #[test]
    fn reads_the_login_and_the_name_through_gh() {
        let body = format!(
            "case \"$1\" in auth) echo '{SIGNED_IN}';; api) echo '{{\"login\":\"octocat\",\"name\":\"The Octocat\"}}';; esac"
        );
        let (gh, dir) = fake_gh("signed-in", &body);

        let status = status_of(Some(&gh), &dir);

        assert_eq!(
            status,
            GithubStatus {
                state: GithubState::SignedIn,
                login: Some("octocat".to_string()),
                name: Some("The Octocat".to_string()),
                message: None,
                can_connect: true,
            }
        );
    }

    #[cfg(unix)]
    #[test]
    fn stays_signed_in_without_a_name_when_the_name_cannot_be_read() {
        let body = format!(
            "case \"$1\" in auth) echo '{SIGNED_IN}';; api) echo 'offline' >&2; exit 1;; esac"
        );
        let (gh, dir) = fake_gh("no-name", &body);

        let status = status_of(Some(&gh), &dir);

        assert_eq!(status.state, GithubState::SignedIn);
        assert_eq!(status.login.as_deref(), Some("octocat"));
        assert_eq!(status.name, None);
    }

    #[cfg(unix)]
    #[test]
    fn reads_signed_out_through_gh_without_asking_for_a_name() {
        let calls = std::env::temp_dir().join(format!("gh-calls-{}.txt", std::process::id()));
        let _ = std::fs::remove_file(&calls);
        let body = format!(
            "echo \"$1\" >> '{}'\ncase \"$1\" in auth) echo '{SIGNED_OUT}';; api) exit 9;; esac",
            calls.display()
        );
        let (gh, dir) = fake_gh("signed-out", &body);

        assert_eq!(
            status_of(Some(&gh), &dir),
            GithubStatus::of(GithubState::SignedOut)
        );

        // Only `gh auth status` ran: `gh api` never did.
        let recorded = std::fs::read_to_string(&calls).expect("gh recorded its calls");
        assert_eq!(recorded.lines().collect::<Vec<_>>(), ["auth"]);
        let _ = std::fs::remove_file(&calls);
    }

    #[cfg(unix)]
    #[test]
    fn says_to_renew_a_rejected_token_from_the_environment_without_offering_connect() {
        // printf, not echo: the fixture holds backslash escapes that echo would interpret.
        let (gh, dir) = fake_gh("env-token", &format!("printf '%s\\n' '{REJECTED_TOKEN}'"));

        let status = status_of(Some(&gh), &dir);

        assert_eq!(status.state, GithubState::Unknown);
        assert_eq!(
            status.message.as_deref(),
            Some("The token in GH_TOKEN was rejected by GitHub. Renew or remove it, then check again.")
        );
        assert!(!status.can_connect);
    }

    #[cfg(unix)]
    #[test]
    fn reads_a_rejected_stored_token_as_signed_out_that_connect_can_fix() {
        let (gh, dir) = fake_gh(
            "keyring-token",
            &format!("printf '%s\\n' '{REJECTED_KEYRING_TOKEN}'"),
        );

        let status = status_of(Some(&gh), &dir);

        assert_eq!(status, GithubStatus::of(GithubState::SignedOut));
        assert!(status.can_connect);
    }

    #[cfg(unix)]
    #[test]
    fn says_when_the_network_is_down() {
        let (gh, dir) = fake_gh("offline", &format!("echo '{NO_NETWORK}'"));

        let status = status_of(Some(&gh), &dir);

        assert_eq!(status.state, GithubState::Unknown);
        assert_eq!(status.message.as_deref(), Some(MESSAGE_UNREACHABLE));
        assert_eq!(status.login, None);
    }

    #[cfg(unix)]
    #[test]
    fn says_when_gh_is_too_old_to_report_json() {
        let (gh, dir) = fake_gh("old", "echo 'unknown flag: --json' >&2; exit 1");

        let status = status_of(Some(&gh), &dir);

        assert_eq!(status.state, GithubState::Unknown);
        assert_eq!(status.message.as_deref(), Some(MESSAGE_OLD_GH));
    }

    #[cfg(unix)]
    #[test]
    fn says_when_gh_answers_nothing_it_can_read() {
        let (gh, dir) = fake_gh("garbled", "echo 'hello'");

        let status = status_of(Some(&gh), &dir);

        assert_eq!(status.state, GithubState::Unknown);
        assert_eq!(status.message.as_deref(), Some(MESSAGE_UNREADABLE));
    }

    /// The command that really runs: gh, with exactly the pinned arguments, one per line.
    #[cfg(unix)]
    #[test]
    fn runs_gh_with_exactly_the_sign_in_arguments_in_a_terminal() {
        let out = std::env::temp_dir().join(format!("gh-args-{}.txt", std::process::id()));
        let _ = std::fs::remove_file(&out);
        let (gh, dir) = fake_gh(
            "login",
            &format!("printf '%s\\n' \"$@\" > '{}'", out.display()),
        );
        let pty = PtySessionManager::default_manager();

        start_sign_in(&pty, "ghlogin-test-1", Some(&gh), &dir).expect("start");

        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        let recorded = loop {
            match std::fs::read_to_string(&out) {
                Ok(text) if text.lines().count() >= SIGN_IN_ARGS.len() => break text,
                _ if std::time::Instant::now() >= deadline => panic!("gh was never run"),
                _ => std::thread::sleep(Duration::from_millis(50)),
            }
        };
        assert_eq!(
            recorded.lines().collect::<Vec<_>>(),
            ["auth", "login", "--hostname", "github.com", "--web"]
        );
        let _ = std::fs::remove_file(&out);
    }
}
