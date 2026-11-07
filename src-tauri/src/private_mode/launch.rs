//! Turns a Qwen Code launch into a private one: NEAR AI Cloud as the endpoint,
//! the Zorvo key, endpoint and model in the process env and nothing else from
//! the user's `OPENAI_*` variables. This is the trust boundary for the key and the endpoint: the
//! webview only names a model, and only a model Zorvo's own list offers.

use super::client::ModelPrice;
use super::PrivateError;
use crate::acp::manager::AcpLaunch;
use crate::registry::resolve::canonical_agent_id;

/// The only endpoint a private session talks to.
pub const NEAR_AI_BASE_URL: &str = "https://cloud-api.near.ai/v1";

/// Longest model id Zorvo passes to an agent.
const MAX_MODEL_ID_LEN: usize = 100;

/// The registry id of the one agent that can run privately.
const QWEN_CODE_ID: &str = "qwen-code";

/// The prefix of every variable a private agent gets only from Zorvo.
const OPENAI_ENV_PREFIX: &str = "OPENAI_";

const KEY_VARIABLE: &str = "OPENAI_API_KEY";
const BASE_URL_VARIABLE: &str = "OPENAI_BASE_URL";
const MODEL_VARIABLE: &str = "OPENAI_MODEL";

/// Flags Zorvo sets itself; a base launch that already has one is refused, so
/// that "ours wins" never depends on how Qwen treats a repeated flag.
const OWN_FLAGS: [&str; 3] = ["--auth-type", "--openai-base-url", "--model"];
const OWN_SHORT_FLAG: &str = "-m";

/// Fails unless `profile_id` is Qwen Code (a legacy id counts).
pub fn ensure_qwen(profile_id: &str) -> Result<(), PrivateError> {
    if canonical_agent_id(profile_id) == QWEN_CODE_ID {
        Ok(())
    } else {
        Err(PrivateError::NotQwen)
    }
}

/// `^[A-Za-z0-9._/-]{1,100}$`, and not starting with `-`, so the id can never
/// read as a flag of its own.
fn is_model_id(id: &str) -> bool {
    (1..=MAX_MODEL_ID_LEN).contains(&id.len())
        && !id.starts_with('-')
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'/' | b'-'))
}

/// Whether `arg` is one of the flags [`private_launch`] sets, alone or as
/// `--flag=value`.
fn is_own_flag(arg: &str) -> bool {
    arg == OWN_SHORT_FLAG
        || OWN_FLAGS.iter().any(|flag| {
            arg == *flag
                || arg
                    .strip_prefix(flag)
                    .is_some_and(|rest| rest.starts_with('='))
        })
}

/// `launch` for a private session on `model_id`: the registry's own arguments
/// first (refused if they already pick an auth type, endpoint or model), then
/// the flags that point Qwen Code at NEAR AI Cloud (the user's
/// `~/.qwen/settings.json` would otherwise win over the env), and an env that
/// sets `OPENAI_API_KEY` to `key`, `OPENAI_BASE_URL` and `OPENAI_MODEL` too
/// (Qwen reads a workspace `.env` without overriding what is already set, so a
/// `.env` cannot point the session elsewhere) and has none of the user's other
/// `OPENAI_*` variables. The key goes in the env only, never in an argument.
pub fn private_launch(
    launch: AcpLaunch,
    profile_id: &str,
    model_id: &str,
    models: &[ModelPrice],
    key: &str,
) -> Result<AcpLaunch, PrivateError> {
    ensure_qwen(profile_id)?;
    if !is_model_id(model_id) || !models.iter().any(|model| model.id == model_id) {
        return Err(PrivateError::UnknownModel);
    }
    if launch.args.iter().any(|arg| is_own_flag(arg)) {
        return Err(PrivateError::BadRequest);
    }
    let mut args = launch.args;
    args.extend(
        [
            "--auth-type",
            "openai",
            "--openai-base-url",
            NEAR_AI_BASE_URL,
            "--model",
            model_id,
        ]
        .map(String::from),
    );
    let mut env: Vec<(String, String)> = launch
        .env
        .into_iter()
        .filter(|(name, _)| !name.starts_with(OPENAI_ENV_PREFIX))
        .collect();
    env.extend([
        (KEY_VARIABLE.to_string(), key.to_string()),
        (BASE_URL_VARIABLE.to_string(), NEAR_AI_BASE_URL.to_string()),
        (MODEL_VARIABLE.to_string(), model_id.to_string()),
    ]);
    Ok(AcpLaunch {
        program: launch.program,
        args,
        env,
        private: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const MODEL: &str = "Qwen/Qwen3.8-27B";
    const KEY: &str = "sk-test";

    fn models() -> Vec<ModelPrice> {
        super::super::testing::model_list()
    }

    fn base(env: &[(&str, &str)]) -> AcpLaunch {
        AcpLaunch {
            program: "npx".to_string(),
            args: vec![
                "-y".to_string(),
                "@qwen-code/qwen-code@0.26.1".to_string(),
                "--acp".to_string(),
            ],
            env: env
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            private: false,
        }
    }

    fn launch(env: &[(&str, &str)]) -> AcpLaunch {
        private_launch(base(env), "qwen-code", MODEL, &models(), KEY).expect("private launch")
    }

    fn value<'a>(launch: &'a AcpLaunch, name: &str) -> Option<&'a str> {
        launch
            .env
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    #[test]
    fn the_four_flags_follow_the_registrys_own_args() {
        let launched = launch(&[]);

        assert_eq!(
            launched.args,
            [
                "-y",
                "@qwen-code/qwen-code@0.26.1",
                "--acp",
                "--auth-type",
                "openai",
                "--openai-base-url",
                "https://cloud-api.near.ai/v1",
                "--model",
                MODEL,
            ]
        );
        assert_eq!(launched.program, "npx");
        assert!(launched.private);
    }

    #[test]
    fn the_zorvo_key_is_in_the_env_and_in_no_argument() {
        let launched = launch(&[("PATH", "/usr/bin")]);

        assert_eq!(value(&launched, "OPENAI_API_KEY"), Some(KEY));
        assert_eq!(value(&launched, "PATH"), Some("/usr/bin"));
        assert!(launched.args.iter().all(|arg| !arg.contains(KEY)));
    }

    #[test]
    fn the_users_own_openai_variables_never_reach_a_private_agent() {
        let launched = launch(&[
            ("OPENAI_API_KEY", "user"),
            ("OPENAI_BASE_URL", "http://localhost:11434"),
            ("OPENAI_MODEL", "llama"),
            ("OPENAI_ORGANIZATION", "o"),
            ("OPENAI_PROJECT", "p"),
            ("OPENAI_API_BASE", "http://elsewhere"),
            ("HOME", "/Users/me"),
        ]);

        let mut openai: Vec<_> = launched
            .env
            .iter()
            .filter(|(key, _)| key.starts_with("OPENAI_"))
            .cloned()
            .collect();
        openai.sort();
        assert_eq!(
            openai,
            [
                ("OPENAI_API_KEY".to_string(), KEY.to_string()),
                (
                    "OPENAI_BASE_URL".to_string(),
                    "https://cloud-api.near.ai/v1".to_string()
                ),
                ("OPENAI_MODEL".to_string(), MODEL.to_string()),
            ]
        );
        assert_eq!(value(&launched, "HOME"), Some("/Users/me"));
    }

    #[test]
    fn the_env_names_the_endpoint_and_model_so_a_workspace_env_file_cannot_move_them() {
        // Qwen loads `.env` without overriding variables that are already set.
        let launched = launch(&[]);

        assert_eq!(value(&launched, "OPENAI_BASE_URL"), Some(NEAR_AI_BASE_URL));
        assert_eq!(value(&launched, "OPENAI_MODEL"), Some(MODEL));
        assert_eq!(value(&launched, "OPENAI_API_KEY"), Some(KEY));
    }

    #[test]
    fn a_base_launch_that_already_picks_auth_endpoint_or_model_is_refused() {
        let flags = [
            vec!["--auth-type", "oauth"],
            vec!["--auth-type=openai"],
            vec!["--openai-base-url", "http://x"],
            vec!["--openai-base-url=http://x"],
            vec!["--model", "m"],
            vec!["--model=m"],
            vec!["-m", "m"],
        ];
        for extra in flags {
            let mut with_flags = base(&[]);
            with_flags
                .args
                .extend(extra.iter().map(|arg| arg.to_string()));

            let result = private_launch(with_flags, "qwen-code", MODEL, &models(), KEY);

            assert_eq!(result, Err(PrivateError::BadRequest), "{extra:?}");
        }
    }

    #[test]
    fn a_base_launch_with_unrelated_flags_is_fine() {
        let mut with_flags = base(&[]);
        with_flags
            .args
            .extend(["--experimental-skills", "--model-x", "-mx"].map(String::from));

        let launched = private_launch(with_flags, "qwen-code", MODEL, &models(), KEY);

        assert!(launched.is_ok());
    }

    #[test]
    fn only_qwen_code_gets_a_private_launch() {
        for id in [
            "claude-acp",
            "codex-acp",
            "claude-code",
            "no-such-agent",
            "",
        ] {
            let result = private_launch(base(&[]), id, MODEL, &models(), KEY);
            assert_eq!(result, Err(PrivateError::NotQwen), "{id}");
        }
    }

    #[test]
    fn the_legacy_qwen_id_is_qwen_code() {
        let launched = private_launch(base(&[]), "qwen", MODEL, &models(), KEY)
            .expect("qwen is the legacy id of qwen-code");

        assert!(launched.private);
    }

    #[test]
    fn a_model_id_outside_the_charset_is_refused_even_when_listed() {
        let hostile = [
            "Qwen/Qwen3.8-27B; rm -rf",
            "",
            "has space",
            "new\nline",
            "--model",
            &"a".repeat(101),
        ];
        for id in hostile {
            let listed = vec![ModelPrice {
                id: id.to_string(),
                input_per_m: 0.1,
                output_per_m: 0.1,
            }];
            let result = private_launch(base(&[]), "qwen-code", id, &listed, KEY);
            assert_eq!(result, Err(PrivateError::UnknownModel), "{id:?}");
        }
    }

    #[test]
    fn a_model_of_the_right_shape_that_is_not_offered_is_refused() {
        let result = private_launch(base(&[]), "qwen-code", "Other/Model-1", &models(), KEY);

        assert_eq!(result, Err(PrivateError::UnknownModel));
    }

    #[test]
    fn a_hundred_character_model_id_is_fine_when_offered() {
        let id = "a".repeat(100);
        let listed = vec![ModelPrice {
            id: id.clone(),
            input_per_m: 0.1,
            output_per_m: 0.1,
        }];

        let launched = private_launch(base(&[]), "qwen-code", &id, &listed, KEY).expect("ok");

        assert_eq!(launched.args.last(), Some(&id));
    }

    #[test]
    fn ensure_qwen_accepts_qwen_code_and_its_legacy_id_only() {
        assert_eq!(ensure_qwen("qwen-code"), Ok(()));
        assert_eq!(ensure_qwen("qwen"), Ok(()));
        assert_eq!(ensure_qwen("codex-acp"), Err(PrivateError::NotQwen));
    }
}
