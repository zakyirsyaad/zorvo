//! Which ACP sessions ran privately, and what that forbids.
//!
//! A private Qwen Code session lives in the same `~/.qwen` store as the user's
//! plain ones. Reopening it with a plain launch would bring its conversation
//! back and send the next prompt, code included, to the user's own provider,
//! outside the TEE. So the backend records every ACP session id it started
//! privately and, whatever the webview asks, refuses to open a recorded one
//! unless the open is private again, and never offers one for import.

use super::manager::{AcpLaunch, StartedSession};
use super::session_list::ListedSessions;
use crate::private_mode::service::{report_storage_failure, PrivateMode};
use crate::private_mode::PrivateError;

/// Records the ACP session `result` opened when `is_private`. A failed open
/// records nothing. A record that cannot be saved does not fail the session,
/// which already runs; it is reported on stderr with a fixed line.
pub fn note_if_private(
    private: &PrivateMode,
    is_private: bool,
    result: Result<StartedSession, String>,
) -> Result<StartedSession, String> {
    let started = result?;
    if is_private
        && private
            .note_private_session(&started.acp_session_id)
            .is_err()
    {
        report_storage_failure();
    }
    Ok(started)
}

/// Longest agent session id Zorvo opens.
const MAX_SESSION_ID_LEN: usize = 128;

/// Whether `id` can be opened at all. Agents name sessions as they like
/// (OpenCode's `ses_…` holds `_`, others `.` or `:`), so only an id that could
/// reach a recorded session by another spelling is refused: empty, over
/// `MAX_SESSION_ID_LEN`, anything but printable ASCII (whitespace, control
/// characters, NUL, non-ASCII), a path separator or `..`. Letter case is
/// handled by the lower-cased comparison with the record.
fn is_openable_session_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_SESSION_ID_LEN
        && id
            .bytes()
            .all(|b| b.is_ascii_graphic() && b != b'/' && b != b'\\')
        && !id.contains("..")
}

/// Opens the agent's session `acp_session_id` (a reopen, or an import with no
/// `private_model_id`). The id comes from the webview and the agent may build
/// file paths from it, so one that could defeat the record
/// (`is_openable_session_id`) is refused with `bad_request`. A recorded private session, in any
/// letter case, is refused with `private_session`. Both happen before `launch`
/// runs, let alone a process, unless `private_model_id` makes the open private
/// again (the `private_session` refusal only). `launch` builds the launch
/// and `open` starts it; a private open is recorded.
pub fn open_session(
    private: &PrivateMode,
    acp_session_id: &str,
    private_model_id: Option<&str>,
    launch: impl FnOnce() -> Result<AcpLaunch, String>,
    open: impl FnOnce(&AcpLaunch) -> Result<StartedSession, String>,
) -> Result<StartedSession, String> {
    if !is_openable_session_id(acp_session_id) {
        return Err(PrivateError::BadRequest.into());
    }
    if private_model_id.is_none() && private.is_private_acp_session(acp_session_id) {
        return Err(PrivateError::PrivateSession.into());
    }
    let launch = launch()?;
    note_if_private(private, private_model_id.is_some(), open(&launch))
}

/// `listed` without the sessions `is_hidden` names.
pub fn without_hidden(listed: ListedSessions, is_hidden: impl Fn(&str) -> bool) -> ListedSessions {
    ListedSessions {
        sessions: listed
            .sessions
            .into_iter()
            .filter(|session| !is_hidden(&session.acp_session_id))
            .collect(),
        ..listed
    }
}

/// `listed` without the recorded private sessions, which the draft must not
/// offer for import.
pub fn without_private(listed: ListedSessions, private: &PrivateMode) -> ListedSessions {
    let recorded = private.private_acp_sessions();
    without_hidden(listed, |id| recorded.contains(&id.to_ascii_lowercase()))
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use serde_json::Value;

    use super::*;
    use crate::acp::session_list::ListedSession;
    use crate::private_mode::testing::Harness;

    const MODEL: Option<&str> = Some("Qwen/Qwen3.8-27B");

    fn started(acp_session_id: &str) -> StartedSession {
        StartedSession {
            acp_session_id: acp_session_id.to_string(),
            agent_capabilities: Value::Null,
            modes: Value::Null,
            models: Value::Null,
            config_options: Value::Null,
            reopened_with: None,
            tools_path: None,
        }
    }

    fn launch() -> AcpLaunch {
        AcpLaunch {
            program: "npx".to_string(),
            args: Vec::new(),
            env: Vec::new(),
            private: false,
            mcp_servers: Vec::new(),
        }
    }

    fn listed(ids: &[&str]) -> ListedSessions {
        ListedSessions {
            sessions: ids
                .iter()
                .map(|id| ListedSession {
                    acp_session_id: id.to_string(),
                    title: Some(format!("title {id}")),
                    updated_at: None,
                })
                .collect(),
            truncated: true,
            incomplete: true,
        }
    }

    #[test]
    fn a_started_private_session_is_recorded() {
        let harness = Harness::new();

        let result = note_if_private(&harness.mode, true, Ok(started("acp-1")));

        assert_eq!(result.expect("started").acp_session_id, "acp-1");
        assert!(harness.mode.is_private_acp_session("acp-1"));
    }

    #[test]
    fn a_plain_session_and_a_failed_start_record_nothing() {
        let harness = Harness::new();

        let plain = note_if_private(&harness.mode, false, Ok(started("acp-1")));
        let failed = note_if_private(&harness.mode, true, Err("boom".to_string()));

        assert!(plain.is_ok());
        assert_eq!(failed.unwrap_err(), "boom");
        assert!(harness.state().private_sessions.is_empty());
    }

    #[test]
    fn a_session_that_started_stays_started_when_the_record_cannot_be_saved() {
        let harness = Harness::new();
        std::fs::create_dir_all(&harness.dir).expect("dir");
        std::fs::write(harness.dir.join("private"), "a file, not a folder").expect("blocker");

        let result = note_if_private(&harness.mode, true, Ok(started("acp-1")));

        assert_eq!(result.expect("still started").acp_session_id, "acp-1");
    }

    #[test]
    fn a_fork_of_a_private_session_is_recorded_and_a_plain_fork_is_not() {
        let harness = Harness::new();

        note_if_private(&harness.mode, true, Ok(started("fork-private"))).expect("fork");
        note_if_private(&harness.mode, false, Ok(started("fork-plain"))).expect("fork");

        assert!(harness.mode.is_private_acp_session("fork-private"));
        assert!(!harness.mode.is_private_acp_session("fork-plain"));
    }

    #[test]
    fn a_plain_open_of_a_recorded_session_is_refused_before_anything_is_launched() {
        let harness = Harness::new();
        harness.mode.note_private_session("acp-1").expect("noted");
        let launches = Cell::new(0);
        let opens = Cell::new(0);

        // Reopen and import both come through here with no private model.
        let result = open_session(
            &harness.mode,
            "acp-1",
            None,
            || {
                launches.set(launches.get() + 1);
                Ok(launch())
            },
            |_| {
                opens.set(opens.get() + 1);
                Ok(started("acp-1"))
            },
        );

        assert_eq!(result.unwrap_err(), "private_session");
        assert_eq!(launches.get(), 0);
        assert_eq!(opens.get(), 0);
    }

    #[test]
    fn a_plain_open_of_an_unrecorded_session_goes_ahead_and_records_nothing() {
        let harness = Harness::new();
        harness.mode.note_private_session("other").expect("noted");

        let result = open_session(
            &harness.mode,
            "acp-1",
            None,
            || Ok(launch()),
            |_| Ok(started("acp-1")),
        );

        assert_eq!(result.expect("opened").acp_session_id, "acp-1");
        assert!(!harness.mode.is_private_acp_session("acp-1"));
    }

    #[test]
    fn a_private_open_of_a_recorded_session_is_allowed() {
        let harness = Harness::new();
        harness.mode.note_private_session("acp-1").expect("noted");
        let opens = Cell::new(0);

        let result = open_session(
            &harness.mode,
            "acp-1",
            MODEL,
            || Ok(launch()),
            |_| {
                opens.set(opens.get() + 1);
                Ok(started("acp-1"))
            },
        );

        assert!(result.is_ok());
        assert_eq!(opens.get(), 1);
        assert!(harness.mode.is_private_acp_session("acp-1"));
    }

    #[test]
    fn a_private_open_of_an_unrecorded_session_records_what_the_agent_reports() {
        let harness = Harness::new();

        open_session(
            &harness.mode,
            "acp-1",
            MODEL,
            || Ok(launch()),
            |_| Ok(started("acp-1-reported")),
        )
        .expect("opened");

        assert!(harness.mode.is_private_acp_session("acp-1-reported"));
    }

    #[test]
    fn a_launch_error_or_a_failed_open_is_passed_on_and_records_nothing() {
        let harness = Harness::new();

        let no_launch = open_session(
            &harness.mode,
            "acp-1",
            MODEL,
            || Err("not installed".to_string()),
            |_| Ok(started("acp-1")),
        );
        let no_open = open_session(
            &harness.mode,
            "acp-1",
            MODEL,
            || Ok(launch()),
            |_| Err("refused".to_string()),
        );

        assert_eq!(no_launch.unwrap_err(), "not installed");
        assert_eq!(no_open.unwrap_err(), "refused");
        assert!(harness.state().private_sessions.is_empty());
    }

    #[test]
    fn recorded_private_sessions_are_left_out_of_a_listing() {
        let all = listed(&["a", "b", "c"]);

        let shown = without_hidden(all, |id| id == "b");

        let ids: Vec<&str> = shown
            .sessions
            .iter()
            .map(|session| session.acp_session_id.as_str())
            .collect();
        assert_eq!(ids, ["a", "c"]);
        assert_eq!(shown.sessions[0].title.as_deref(), Some("title a"));
        assert!(shown.truncated);
        assert!(shown.incomplete);
    }

    #[test]
    fn a_listing_without_private_sessions_is_unchanged() {
        let all = listed(&["a", "b"]);

        assert_eq!(without_hidden(all.clone(), |_| false), all);
    }

    #[test]
    fn a_listing_is_filtered_by_what_private_mode_recorded() {
        let harness = Harness::new();
        harness.mode.note_private_session("b").expect("noted");

        let shown = without_private(listed(&["a", "b"]), &harness.mode);

        assert_eq!(shown.sessions.len(), 1);
        assert_eq!(shown.sessions[0].acp_session_id, "a");
    }

    #[test]
    fn a_plain_open_of_a_recorded_id_in_another_letter_case_is_refused() {
        let harness = Harness::new();
        harness.mode.note_private_session("acp-1").expect("noted");
        let launches = Cell::new(0);
        let opens = Cell::new(0);

        let result = open_session(
            &harness.mode,
            "ACP-1",
            None,
            || {
                launches.set(launches.get() + 1);
                Ok(launch())
            },
            |_| {
                opens.set(opens.get() + 1);
                Ok(started("ACP-1"))
            },
        );

        assert_eq!(result.unwrap_err(), "private_session");
        assert_eq!(launches.get(), 0);
        assert_eq!(opens.get(), 0);
    }

    #[test]
    fn an_id_that_could_defeat_the_record_is_refused_before_any_launch_for_every_kind_of_open() {
        let harness = Harness::new();
        let too_long = "a".repeat(200);
        let odd = [
            "./acp-1",
            "../x",
            "..",
            "a..b",
            "acp-1 ",
            " acp-1",
            "acp/1",
            "acp\\1",
            "acp\u{0}1",
            "acp-1\n",
            "acp\u{7f}1",
            "",
            too_long.as_str(),
        ];
        for model in [None, MODEL] {
            for id in odd {
                let launches = Cell::new(0);
                let opens = Cell::new(0);

                let result = open_session(
                    &harness.mode,
                    id,
                    model,
                    || {
                        launches.set(launches.get() + 1);
                        Ok(launch())
                    },
                    |_| {
                        opens.set(opens.get() + 1);
                        Ok(started("acp-1"))
                    },
                );

                assert_eq!(result.unwrap_err(), "bad_request", "{id:?} {model:?}");
                assert_eq!(launches.get(), 0, "{id:?}");
                assert_eq!(opens.get(), 0, "{id:?}");
            }
        }
    }

    #[test]
    fn ids_with_underscores_dots_and_colons_open_normally_for_a_plain_session() {
        let harness = Harness::new();
        let at_limit = "a".repeat(128);
        for id in ["ses_abc.def:1", "ses_01JABC", "a.b", at_limit.as_str()] {
            let opens = Cell::new(0);

            let result = open_session(
                &harness.mode,
                id,
                None,
                || Ok(launch()),
                |_| {
                    opens.set(opens.get() + 1);
                    Ok(started(id))
                },
            );

            assert_eq!(result.expect("opened").acp_session_id, id);
            assert_eq!(opens.get(), 1, "{id:?}");
        }
        assert!(harness.state().private_sessions.is_empty());
    }

    #[test]
    fn a_recorded_private_id_with_underscores_and_dots_is_refused_in_any_letter_case() {
        let harness = Harness::new();
        harness
            .mode
            .note_private_session("ses_abc.def:1")
            .expect("noted");
        for id in ["ses_abc.def:1", "SES_ABC.DEF:1", "Ses_Abc.Def:1"] {
            let launches = Cell::new(0);

            let result = open_session(
                &harness.mode,
                id,
                None,
                || {
                    launches.set(launches.get() + 1);
                    Ok(launch())
                },
                |_| Ok(started(id)),
            );

            assert_eq!(result.unwrap_err(), "private_session", "{id:?}");
            assert_eq!(launches.get(), 0, "{id:?}");
        }
    }

    #[test]
    fn a_private_open_of_a_recorded_id_in_another_letter_case_is_allowed() {
        let harness = Harness::new();
        harness.mode.note_private_session("acp-1").expect("noted");
        let opens = Cell::new(0);

        let result = open_session(
            &harness.mode,
            "ACP-1",
            MODEL,
            || Ok(launch()),
            |_| {
                opens.set(opens.get() + 1);
                Ok(started("ACP-1"))
            },
        );

        assert!(result.is_ok());
        assert_eq!(opens.get(), 1);
    }

    #[test]
    fn the_listing_filter_removes_a_recorded_id_in_another_letter_case() {
        let harness = Harness::new();
        harness.mode.note_private_session("acp-1").expect("noted");

        let shown = without_private(listed(&["ACP-1", "b"]), &harness.mode);

        assert_eq!(shown.sessions.len(), 1);
        assert_eq!(shown.sessions[0].acp_session_id, "b");
    }
}
