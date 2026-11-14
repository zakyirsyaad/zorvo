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
use super::server::TokenEntry;
use super::topup::{
    TopupRefusal, TopupRequestEvent, TopupRequests, MAX_REASON_CHARS, OWN_KEY_MESSAGE,
};

const BALANCE_TTL: Duration = Duration::from_secs(30);
/// A failed balance read is kept briefly too, so a flapping Worker is not asked on every turn.
const BALANCE_ERROR_TTL: Duration = Duration::from_secs(5);
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
    topups: Arc<TopupRequests>,
    balance: Mutex<Option<(Instant, Result<Balance, PrivateError>)>>,
}

impl McpState {
    pub fn new(
        store: Arc<dyn SecretStore>,
        api: Arc<dyn CreditsApi>,
        models: SharedModels,
        topups: Arc<TopupRequests>,
    ) -> Self {
        Self {
            store,
            api,
            models,
            topups,
            balance: Mutex::new(None),
        }
    }

    /// Checks the agent's ask against the Worker's live packages and records it for the user. The
    /// package and its credit count come from the Worker, never from the agent. Nothing is sent to
    /// NEAR AI, and the human still pays through the existing PingPay checkout.
    pub(super) fn request_topup(
        &self,
        entry: &TokenEntry,
        usd: u32,
        reason: &str,
    ) -> Result<TopupRequestEvent, TopupRefusal> {
        if entry.own_key {
            return Err(TopupRefusal::new("own_key", OWN_KEY_MESSAGE));
        }
        if usd == 0 {
            return Err(TopupRefusal::new(
                "bad_request",
                "Pick a whole-dollar top-up package.",
            ));
        }
        if reason.trim().is_empty() || reason.chars().count() > MAX_REASON_CHARS {
            return Err(TopupRefusal::new(
                "bad_request",
                format!("The reason must be 1–{MAX_REASON_CHARS} characters of plain text."),
            ));
        }
        let secret = self
            .store
            .get(DEVICE_SECRET)
            .map_err(|_| {
                TopupRefusal::new("unavailable", "Zorvo couldn't read this Mac's private key.")
            })?
            .ok_or_else(|| {
                TopupRefusal::new(
                    "unavailable",
                    "This Mac has no private key yet. Top up in Settings first.",
                )
            })?;
        let stock = self.api.stock(&secret).map_err(|_| {
            TopupRefusal::new(
                "upstream",
                "Zorvo couldn't read the top-up packages. Try again.",
            )
        })?;
        let Some(package) = stock.packages.iter().find(|package| package.usd == usd) else {
            return Err(TopupRefusal::new(
                "bad_request",
                format!("Zorvo doesn't offer a ${usd} top-up."),
            ));
        };
        if !package.available {
            let message = match package.reason.as_deref() {
                Some("stock") => {
                    format!("The ${usd} package is sold out right now. Try a smaller one.")
                }
                Some("device_cap") => format!(
                    "This Mac's private key limit is in the way of the ${usd} package. Try a smaller one."
                ),
                _ => format!("The ${usd} package isn't available right now. Try a smaller one."),
            };
            return Err(TopupRefusal::new("unavailable", message));
        }
        self.topups
            .request(&entry.app_session_id, package.usd, package.credits, reason)
    }

    /// The balance, read from the credits server at most once per 30 seconds. A cache hit returns
    /// the same snapshot even if its `updatedAt` is older. One failed read is kept for five seconds,
    /// and the lock is held across the fetch so concurrent turns share one request.
    pub fn credits(&self, model: &str) -> Result<CreditsAnswer, PrivateError> {
        let mut cache = lock(&self.balance);
        let cached = cache
            .as_ref()
            .filter(|(at, result)| {
                at.elapsed()
                    < if result.is_ok() {
                        BALANCE_TTL
                    } else {
                        BALANCE_ERROR_TTL
                    }
            })
            .map(|(_, result)| result.clone());
        let balance = match cached {
            Some(Ok(balance)) => balance,
            Some(Err(error)) => return Err(error),
            None => {
                let read = (|| {
                    let secret = self
                        .store
                        .get(DEVICE_SECRET)?
                        .ok_or(PrivateError::NoDevice)?;
                    self.api.balance(&secret, false)
                })();
                *cache = Some((Instant::now(), read.clone()));
                read?
            }
        };
        drop(cache);
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
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

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
        fail: AtomicBool,
    }

    impl CreditsApi for Api {
        fn register(&self, _: &str) -> Result<(), PrivateError> {
            Ok(())
        }
        fn balance(&self, _: &str, _: bool) -> Result<Balance, PrivateError> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            if self.fail.load(Ordering::SeqCst) {
                return Err(PrivateError::Unreachable);
            }
            Ok(Balance {
                credits: 49,
                used_credits: 0,
                key_ready: true,
                updated_at: "2026-11-08T10:00:00Z".to_string(),
            })
        }
        fn stock(&self, _: &str) -> Result<crate::private_mode::client::Stock, PrivateError> {
            Ok(crate::private_mode::client::Stock {
                available_credits: 5_000,
                your_room_credits: 5_000,
                packages: vec![
                    crate::private_mode::client::StockPackage {
                        usd: 5,
                        credits: 500,
                        available: true,
                        reason: None,
                    },
                    crate::private_mode::client::StockPackage {
                        usd: 10,
                        credits: 1_000,
                        available: false,
                        reason: Some("stock".to_string()),
                    },
                ],
                updated_at: "2026-11-10T10:00:00Z".to_string(),
            })
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
        fn create_session(
            &self,
            _: &str,
            _: u64,
        ) -> Result<crate::private_mode::client::CreatedSession, PrivateError> {
            unimplemented!()
        }
        fn end_session(&self, _: &str, _: &str) -> Result<(), PrivateError> {
            unimplemented!()
        }
        fn seen_session(&self, _: &str, _: &str) -> Result<(), PrivateError> {
            unimplemented!()
        }
        fn raise_session(&self, _: &str, _: &str, _: u64) -> Result<u64, PrivateError> {
            unimplemented!()
        }
    }

    fn state() -> (McpState, Arc<Api>, Arc<TopupRequests>) {
        let api = Arc::new(Api {
            reads: AtomicUsize::new(0),
            fail: AtomicBool::new(false),
        });
        let topups = Arc::new(TopupRequests::default());
        let models = Arc::new(Mutex::new(Some((
            Instant::now(),
            vec![ModelPrice {
                id: "Qwen/Qwen3.8-27B".to_string(),
                input_per_m: 0.0,
                output_per_m: 100.0,
            }],
        ))));
        (
            McpState::new(Arc::new(Store), api.clone(), models, Arc::clone(&topups)),
            api,
            topups,
        )
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
        let (state, api, _) = state();
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
    fn a_failed_balance_read_is_kept_briefly() {
        let (state, api, _) = state();
        api.fail.store(true, Ordering::SeqCst);

        assert_eq!(
            state.credits("Qwen/Qwen3.8-27B"),
            Err(PrivateError::Unreachable)
        );
        assert_eq!(
            state.credits("Qwen/Qwen3.8-27B"),
            Err(PrivateError::Unreachable)
        );
        assert_eq!(api.reads.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn models_carry_the_canvas_labels_and_price_names() {
        let (state, _, _) = state();
        let models = state.models();

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].label, "Qwen 3.8 27B");
        let json = serde_json::to_value(&models[0]).expect("json");
        assert_eq!(json["inputUsdPer1M"], 0.0);
        assert_eq!(json["outputUsdPer1M"], 100.0);
        assert_eq!(json["approxCreditsPerTurn"], 12.0);
    }

    #[test]
    fn a_topup_request_uses_the_workers_package_and_refuses_an_own_key() {
        let (state, _, topups) = state();
        let own = TokenEntry::for_test("s-own", true);
        assert_eq!(
            state.request_topup(&own, 5, "The review needs credits."),
            Err(TopupRefusal::new("own_key", OWN_KEY_MESSAGE))
        );

        let entry = TokenEntry::for_test("s-1", false);
        let asked = state
            .request_topup(&entry, 5, "The review needs credits.")
            .expect("a request");
        assert_eq!(asked.usd, 5);
        assert_eq!(asked.credits, 500);
        assert_eq!(asked.session_id, "s-1");
        assert_eq!(topups.pending_for("s-1"), Some(asked));
        assert_eq!(
            state.request_topup(&entry, 5, "Again"),
            Err(TopupRefusal::new(
                "pending",
                super::super::topup::PENDING_MESSAGE
            ))
        );
    }

    #[test]
    fn a_topup_request_refuses_an_unknown_or_unavailable_package() {
        let (state, _, _) = state();
        let entry = TokenEntry::for_test("s-1", false);

        assert_eq!(
            state.request_topup(&entry, 7, "Why"),
            Err(TopupRefusal::new(
                "bad_request",
                "Zorvo doesn't offer a $7 top-up."
            ))
        );
        let refusal = state
            .request_topup(&entry, 10, "Why")
            .expect_err("sold out");
        assert_eq!(refusal.code, "unavailable");
        assert!(refusal.message.contains("sold out"));
    }

    #[test]
    fn a_topup_request_refuses_an_empty_or_overlong_reason() {
        let (state, _, _) = state();
        let entry = TokenEntry::for_test("s-1", false);

        assert_eq!(
            state.request_topup(&entry, 5, "   "),
            Err(TopupRefusal::new(
                "bad_request",
                format!("The reason must be 1–{MAX_REASON_CHARS} characters of plain text.")
            ))
        );
        assert_eq!(
            state.request_topup(&entry, 5, &"a".repeat(MAX_REASON_CHARS + 1)),
            Err(TopupRefusal::new(
                "bad_request",
                format!("The reason must be 1–{MAX_REASON_CHARS} characters of plain text.")
            ))
        );
    }
}
