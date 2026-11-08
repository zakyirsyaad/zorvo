//! The read-only data the local MCP server asks the loopback proxy for. It never holds or returns
//! the device secret: it uses the same background credit client the app already has, and the proxy
//! token is the only capability the agent's process sees.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::private_mode::client::{Balance, CreditsApi, ModelPrice};
use crate::private_mode::device::{SecretStore, DEVICE_SECRET};
use crate::private_mode::PrivateError;

use super::records::lock;

const BALANCE_TTL: Duration = Duration::from_secs(30);
const TURN_INPUT_TOKENS: f64 = 20_000.0;
const TURN_OUTPUT_TOKENS: f64 = 1_000.0;
const CREDITS_PER_USD_COST: f64 = 120.0;

/// The cached allowlisted catalog shared with `PrivateMode`.
pub type SharedModels = Arc<Mutex<Option<(Instant, Vec<ModelPrice>)>>>;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditsAnswer {
    pub credits: u64,
    pub updated_at: String,
    pub model: String,
    pub approx_turns: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelAnswer {
    pub id: String,
    pub label: String,
    #[serde(rename = "inputUsdPer1M")]
    pub input_usd_per1m: f64,
    #[serde(rename = "outputUsdPer1M")]
    pub output_usd_per1m: f64,
    pub approx_credits_per_turn: f64,
}

/// The shared read-only view behind `/zorvo/v1/credits` and `/zorvo/v1/models`.
pub struct McpState {
    store: Arc<dyn SecretStore>,
    api: Arc<dyn CreditsApi>,
    models: SharedModels,
    balance: Mutex<Option<(Instant, Balance)>>,
}

impl McpState {
    pub fn new(
        store: Arc<dyn SecretStore>,
        api: Arc<dyn CreditsApi>,
        models: SharedModels,
    ) -> Self {
        Self {
            store,
            api,
            models,
            balance: Mutex::new(None),
        }
    }

    /// The balance, read from the credits server at most once per 30 seconds. A cache hit returns
    /// the same snapshot even if its `updatedAt` is older.
    pub fn credits(&self, model: &str) -> Result<CreditsAnswer, PrivateError> {
        let cached = lock(&self.balance).clone();
        let balance = match cached {
            Some((at, balance)) if at.elapsed() < BALANCE_TTL => balance,
            _ => {
                let secret = self
                    .store
                    .get(DEVICE_SECRET)?
                    .ok_or(PrivateError::NoDevice)?;
                let balance = self.api.balance(&secret, false)?;
                *lock(&self.balance) = Some((Instant::now(), balance.clone()));
                balance
            }
        };
        Ok(CreditsAnswer {
            credits: balance.credits,
            updated_at: balance.updated_at,
            model: model.to_string(),
            approx_turns: self
                .model_price(model)
                .map(|price| turns_for(balance.credits, &price))
                .unwrap_or(0),
        })
    }

    /// The allowlisted models last read for Settings or a private draft. No upstream request: the
    /// proxy route is read-only.
    pub fn models(&self) -> Vec<ModelAnswer> {
        lock(&self.models)
            .as_ref()
            .map(|(_, models)| models.iter().map(model_answer).collect())
            .unwrap_or_default()
    }

    fn model_price(&self, id: &str) -> Option<ModelPrice> {
        lock(&self.models)
            .as_ref()
            .and_then(|(_, models)| models.iter().find(|model| model.id == id).cloned())
    }
}

fn model_answer(model: &ModelPrice) -> ModelAnswer {
    ModelAnswer {
        id: model.id.clone(),
        label: label(&model.id),
        input_usd_per1m: model.input_per_m,
        output_usd_per1m: model.output_per_m,
        approx_credits_per_turn: (credits_per_turn(model) * 10.0).round() / 10.0,
    }
}

fn credits_per_turn(model: &ModelPrice) -> f64 {
    let usd =
        (model.input_per_m * TURN_INPUT_TOKENS + model.output_per_m * TURN_OUTPUT_TOKENS) / 1e6;
    (usd * CREDITS_PER_USD_COST).max(0.0)
}

fn turns_for(credits: u64, model: &ModelPrice) -> u64 {
    let per_turn = credits_per_turn(model);
    if per_turn <= 0.0 {
        return 0;
    }
    (credits as f64 / per_turn + 1e-9).floor().max(0.0) as u64
}

/// The canvas's model label: the last path segment, hyphens as spaces, and a space before a
/// version's decimal (`Qwen3.8` → `Qwen 3.8`, `Kimi-K3` stays `Kimi K3`).
fn label(id: &str) -> String {
    let name = id.rsplit('/').next().unwrap_or(id).replace('-', " ");
    let chars: Vec<char> = name.chars().collect();
    let mut out = String::with_capacity(name.len() + 2);
    for (index, ch) in chars.iter().enumerate() {
        if index > 0
            && chars[index - 1].is_ascii_alphabetic()
            && ch.is_ascii_digit()
            && chars.get(index + 1) == Some(&'.')
        {
            out.push(' ');
        }
        out.push(*ch);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct Store;

    impl SecretStore for Store {
        fn get(&self, account: &str) -> Result<Option<String>, PrivateError> {
            Ok((account == DEVICE_SECRET).then(|| "device".to_string()))
        }
        fn set(&self, _: &str, _: &str) -> Result<(), PrivateError> {
            Ok(())
        }
        fn delete(&self, _: &str) -> Result<(), PrivateError> {
            Ok(())
        }
    }

    struct Api {
        reads: AtomicUsize,
    }

    impl CreditsApi for Api {
        fn register(&self, _: &str) -> Result<(), PrivateError> {
            Ok(())
        }
        fn balance(&self, _: &str, _: bool) -> Result<Balance, PrivateError> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            Ok(Balance {
                credits: 49,
                used_credits: 0,
                key_ready: true,
                updated_at: "2026-11-08T10:00:00Z".to_string(),
            })
        }
        fn stock(&self, _: &str) -> Result<crate::private_mode::client::Stock, PrivateError> {
            unimplemented!()
        }
        fn models(&self, _: &str) -> Result<Vec<ModelPrice>, PrivateError> {
            unimplemented!()
        }
        fn create_topup(
            &self,
            _: &str,
            _: u32,
        ) -> Result<crate::private_mode::client::CreatedTopup, PrivateError> {
            unimplemented!()
        }
        fn topup(
            &self,
            _: &str,
            _: &str,
        ) -> Result<crate::private_mode::client::TopupState, PrivateError> {
            unimplemented!()
        }
        fn cancel_topup(&self, _: &str, _: &str) -> Result<(), PrivateError> {
            unimplemented!()
        }
        fn take_key(&self, _: &str) -> Result<Option<String>, PrivateError> {
            unimplemented!()
        }
        fn redeem_promo(
            &self,
            _: &str,
            _: &str,
        ) -> Result<crate::private_mode::client::PromoResult, PrivateError> {
            unimplemented!()
        }
        fn recover(&self, _: &str, _: &str) -> Result<(), PrivateError> {
            unimplemented!()
        }
    }

    fn state() -> (McpState, Arc<Api>) {
        let api = Arc::new(Api {
            reads: AtomicUsize::new(0),
        });
        let models = Arc::new(Mutex::new(Some((
            Instant::now(),
            vec![ModelPrice {
                id: "Qwen/Qwen3.8-27B".to_string(),
                input_per_m: 0.0,
                output_per_m: 100.0,
            }],
        ))));
        (McpState::new(Arc::new(Store), api.clone(), models), api)
    }

    #[test]
    fn labels_versions_but_not_kimi() {
        assert_eq!(label("Qwen/Qwen3.8-27B"), "Qwen 3.8 27B");
        assert_eq!(label("moonshotai/Kimi-K3"), "Kimi K3");
    }

    #[test]
    fn a_priced_model_gets_a_turn_estimate() {
        let model = ModelPrice {
            id: "Qwen/Qwen3.8-27B".to_string(),
            input_per_m: 0.0,
            output_per_m: 100.0,
        };
        assert_eq!(turns_for(49, &model), 4);
        assert_eq!(model_answer(&model).approx_credits_per_turn, 12.0);
    }

    #[test]
    fn credits_read_the_server_once_and_keep_the_canvas_shape() {
        let (state, api) = state();
        let first = state.credits("Qwen/Qwen3.8-27B").expect("credits");
        let second = state.credits("Qwen/Qwen3.8-27B").expect("cached credits");

        assert_eq!(api.reads.load(Ordering::SeqCst), 1);
        assert_eq!(first, second);
        assert_eq!(first.credits, 49);
        assert_eq!(first.approx_turns, 4);
        assert_eq!(first.updated_at, "2026-11-08T10:00:00Z");
        let json = serde_json::to_value(&first).expect("json");
        assert_eq!(json["approxTurns"], 4);
        assert_eq!(json["model"], "Qwen/Qwen3.8-27B");
    }

    #[test]
    fn models_carry_the_canvas_labels_and_price_names() {
        let (state, _) = state();
        let models = state.models();

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].label, "Qwen 3.8 27B");
        let json = serde_json::to_value(&models[0]).expect("json");
        assert_eq!(json["inputUsdPer1M"], 0.0);
        assert_eq!(json["outputUsdPer1M"], 100.0);
        assert_eq!(json["approxCreditsPerTurn"], 12.0);
    }
}
