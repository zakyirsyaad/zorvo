//! Whether the key variables an agent names are set for it.
//!
//! An agent that cannot report who is signed in (no `_meta.authStatus`) may still open
//! a session without a key and refuse only the first prompt (GLM Agent does). Opening
//! a session then shows nothing, so a probe cannot call such an agent ready. When the
//! agent offers `env_var` sign-in methods, the one thing Zorvo can check is whether the
//! variables they name are set in the environment the agent is launched with. Only the
//! names are read and returned; a value is never looked at beyond being empty or not.

use serde_json::Value;

/// The longest variable name that is shown to the user.
const MAX_NAME_LENGTH: usize = 64;

/// The variables a signed-out agent is missing, for an agent that offers `env_var`
/// methods (`auth_methods`, from `initialize`). Empty when it is not known to be
/// missing any: the agent offers no such method, offers a terminal sign-in (whose
/// result is kept by the agent, not in the environment), or at least one `env_var`
/// method has all its required variables set in `env`.
pub fn missing_key_variables(auth_methods: &Value, env: &[(String, String)]) -> Vec<String> {
    let Some(methods) = auth_methods.as_array() else {
        return Vec::new();
    };
    if methods.iter().any(|method| method["type"] == "terminal") {
        return Vec::new();
    }
    let required: Vec<Vec<&str>> = methods
        .iter()
        .filter(|method| method["type"] == "env_var")
        .map(required_variables)
        .filter(|names| !names.is_empty())
        .collect();
    let is_set = |name: &str| {
        env.iter()
            .any(|(key, value)| key == name && !value.is_empty())
    };
    if required.is_empty() || required.iter().any(|names| names.iter().all(|n| is_set(n))) {
        return Vec::new();
    }
    let mut names: Vec<String> = required.into_iter().flatten().map(str::to_string).collect();
    names.sort();
    names.dedup();
    names
}

/// The names of the variables an `env_var` method requires (those not marked optional).
fn required_variables(method: &Value) -> Vec<&str> {
    method["vars"]
        .as_array()
        .map(|vars| {
            vars.iter()
                .filter(|var| var["optional"] != true)
                .filter_map(|var| var["name"].as_str())
                .filter(|name| is_variable_name(name))
                .collect()
        })
        .unwrap_or_default()
}

/// Whether `name` is a plain environment variable name (it is shown in the UI).
fn is_variable_name(name: &str) -> bool {
    let mut chars = name.chars();
    name.len() <= MAX_NAME_LENGTH
        && chars
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    /// GLM Agent's methods in `glm-acp-agent@1.15.0`: one with no type, one `env_var`.
    fn glm_methods() -> Value {
        json!([
            { "id": "z-ai-api-key", "name": "Z.AI API key" },
            {
                "type": "env_var",
                "id": "z_ai_api_key",
                "name": "Z.AI API key",
                "vars": [{ "name": "Z_AI_API_KEY", "label": "Z.AI API key", "secret": true, "optional": false }]
            }
        ])
    }

    fn env(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn names_the_variable_when_it_is_not_set() {
        let missing = missing_key_variables(&glm_methods(), &env(&[("PATH", "/usr/bin")]));

        assert_eq!(missing, vec!["Z_AI_API_KEY"]);
    }

    #[test]
    fn names_nothing_when_the_variable_is_set() {
        let missing = missing_key_variables(&glm_methods(), &env(&[("Z_AI_API_KEY", "x")]));

        assert!(missing.is_empty());
    }

    #[test]
    fn counts_an_empty_value_as_not_set() {
        let missing = missing_key_variables(&glm_methods(), &env(&[("Z_AI_API_KEY", "")]));

        assert_eq!(missing, vec!["Z_AI_API_KEY"]);
    }

    #[test]
    fn names_nothing_for_an_agent_with_no_env_var_method() {
        let methods = json!([{ "id": "api-key", "name": "API key" }]);

        assert!(missing_key_variables(&methods, &[]).is_empty());
        assert!(missing_key_variables(&json!([]), &[]).is_empty());
        assert!(missing_key_variables(&Value::Null, &[]).is_empty());
    }

    #[test]
    fn names_nothing_when_a_terminal_sign_in_is_offered_too() {
        let mut methods = glm_methods();
        methods
            .as_array_mut()
            .unwrap()
            .push(json!({ "type": "terminal", "id": "login", "name": "Log in" }));

        assert!(missing_key_variables(&methods, &[]).is_empty());
    }

    #[test]
    fn needs_only_one_method_to_have_all_its_variables() {
        let methods = json!([
            { "type": "env_var", "id": "a", "vars": [{ "name": "KEY_A" }, { "name": "KEY_B" }] },
            { "type": "env_var", "id": "b", "vars": [{ "name": "KEY_C" }] }
        ]);

        assert!(missing_key_variables(&methods, &env(&[("KEY_C", "x")])).is_empty());
        // One variable of the first method is not the whole method.
        assert_eq!(
            missing_key_variables(&methods, &env(&[("KEY_A", "x")])),
            vec!["KEY_A", "KEY_B", "KEY_C"]
        );
    }

    #[test]
    fn ignores_optional_variables_and_names_that_are_not_plain() {
        let methods = json!([{
            "type": "env_var",
            "id": "a",
            "vars": [
                { "name": "WANTED" },
                { "name": "EXTRA", "optional": true },
                { "name": "bad name; rm" },
                { "name": 7 }
            ]
        }]);

        assert_eq!(missing_key_variables(&methods, &[]), vec!["WANTED"]);
    }

    #[test]
    fn names_nothing_for_a_method_that_requires_no_variable() {
        let methods = json!([{ "type": "env_var", "id": "a", "vars": [{ "name": "EXTRA", "optional": true }] }]);

        assert!(missing_key_variables(&methods, &[]).is_empty());
    }
}
