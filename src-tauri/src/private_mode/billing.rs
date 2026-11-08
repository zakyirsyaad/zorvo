//! What a private session spent, from NEAR AI's billing endpoint and from the token counts the
//! proxy keeps. The endpoint is deprecated, so a failed or lagging answer becomes an estimate after
//! three asks; the key is only ever passed to the request, never stored or logged.

use std::collections::{HashMap, HashSet};
use std::net::Ipv4Addr;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;
use ureq::http::{Method, Request};
use url::{Host, Url};

use super::client::ModelPrice;
use super::launch::NEAR_AI_BASE_URL;
use super::proxy::ProxyRecord;
use super::PrivateError;

/// `/v1/billing/costs` takes at most this many ids in one call.
pub const MAX_COST_IDS: usize = 100;
/// Three asks, then an estimate: the endpoint may lag right after a turn, and is deprecated.
pub const MAX_COST_ASKS: u8 = 3;
/// Credits charged per US dollar of model cost.
const CREDITS_PER_USD: f64 = 120.0;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_BODY_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub struct CostAnswer {
    /// Cost by request id. A missing id is not a zero-cost answer.
    pub costs: HashMap<String, u64>,
    /// NEAR AI's warning, usually that an id is not known yet.
    pub warning: Option<String>,
}

/// How NEAR AI answered a pasted key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum KeyCheck {
    Accepted,
    /// A valid key whose organization has no credits (HTTP 402).
    NoCredits,
}

/// The NEAR AI calls this module makes. A trait so tests can inject a fake.
pub trait BillingApi: Send + Sync {
    fn costs(&self, key: &str, ids: &[String]) -> Result<CostAnswer, PrivateError>;
    fn check_key(&self, key: &str) -> Result<KeyCheck, PrivateError>;
}

/// The answer the inspector and the persisted session total use.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateSessionUsage {
    pub credits: f64,
    pub estimated: bool,
    pub calls: u32,
}

#[derive(Debug, Clone)]
struct CachedCost {
    credits: f64,
    estimated: bool,
    attempts: u8,
    settled: bool,
}

/// Cost state survives for the app run, keyed by NEAR AI's request id. A settled final cost is
/// never asked again; a lagging one is retried on the next turn end.
#[derive(Default)]
pub struct UsageTracker {
    cache: Mutex<HashMap<String, CachedCost>>,
}

impl UsageTracker {
    /// Sums the session's records, asking NEAR AI only for records without a settled cost.
    pub fn usage(
        &self,
        records: &[ProxyRecord],
        models: &[ModelPrice],
        key: Option<&str>,
        billing: &dyn BillingApi,
    ) -> PrivateSessionUsage {
        let mut ids = Vec::new();
        let mut seen = HashSet::new();
        let mut pending = Vec::new();
        for record in records {
            let Some(id) = record.inference_id.as_deref() else {
                continue;
            };
            if !seen.insert(id.to_string()) {
                continue;
            }
            ids.push(id.to_string());
            match self.entry(id) {
                Some(entry) if entry.settled => {}
                Some(entry) if entry.attempts >= MAX_COST_ASKS => self.estimate(record, models),
                _ => pending.push(record),
            }
        }

        let mut calls = 0;
        if !pending.is_empty() {
            if let Some(key) = key {
                for batch in pending.chunks(MAX_COST_IDS) {
                    calls += 1;
                    let request_ids: Vec<String> = batch
                        .iter()
                        .filter_map(|record| record.inference_id.clone())
                        .collect();
                    match billing.costs(key, &request_ids) {
                        Ok(answer) => {
                            for record in batch {
                                let id = record.inference_id.as_deref().unwrap_or_default();
                                let cost = answer.costs.get(id).copied();
                                let is_final = match cost {
                                    Some(0) if answer.warning.is_some() => false,
                                    Some(_) => true,
                                    None => false,
                                };
                                if is_final {
                                    self.settle_cost(id, cost.unwrap_or(0));
                                } else {
                                    self.retry_or_estimate(record, models);
                                }
                            }
                        }
                        Err(_) => {
                            for record in batch {
                                self.retry_or_estimate(record, models);
                            }
                        }
                    }
                }
            } else {
                // The token is gone (a stopped process): no billing read is possible, so estimate.
                for record in pending {
                    self.estimate(record, models);
                }
            }
        }

        let mut credits = 0.0;
        let mut estimated = false;
        let cache = lock(&self.cache);
        for id in ids {
            if let Some(entry) = cache.get(&id).filter(|entry| entry.settled) {
                credits += entry.credits;
                estimated |= entry.estimated;
            }
        }
        PrivateSessionUsage {
            credits,
            estimated,
            calls,
        }
    }

    fn entry(&self, id: &str) -> Option<CachedCost> {
        lock(&self.cache).get(id).cloned()
    }

    fn retry_or_estimate(&self, record: &ProxyRecord, models: &[ModelPrice]) {
        let id = record.inference_id.as_deref().unwrap_or_default();
        let attempts = self
            .entry(id)
            .map_or(1, |entry| entry.attempts.saturating_add(1));
        if attempts >= MAX_COST_ASKS {
            self.estimate(record, models);
        } else {
            lock(&self.cache).insert(
                id.to_string(),
                CachedCost {
                    credits: 0.0,
                    estimated: false,
                    attempts,
                    settled: false,
                },
            );
        }
    }

    fn settle_cost(&self, id: &str, cost_nano_usd: u64) {
        lock(&self.cache).insert(
            id.to_string(),
            CachedCost {
                credits: cost_nano_usd as f64 / 1e9 * CREDITS_PER_USD,
                estimated: false,
                attempts: MAX_COST_ASKS,
                settled: true,
            },
        );
    }

    fn estimate(&self, record: &ProxyRecord, models: &[ModelPrice]) {
        let Some(id) = record.inference_id.as_deref() else {
            return;
        };
        let credits = record
            .usage
            .as_ref()
            .and_then(|usage| {
                models
                    .iter()
                    .find(|model| model.id == record.model)
                    .map(|model| {
                        (usage.prompt_tokens as f64 * model.input_per_m
                            + usage.completion_tokens as f64 * model.output_per_m)
                            / 1e6
                            * CREDITS_PER_USD
                    })
            })
            .unwrap_or(0.0);
        lock(&self.cache).insert(
            id.to_string(),
            CachedCost {
                credits,
                estimated: true,
                attempts: MAX_COST_ASKS,
                settled: true,
            },
        );
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CostsBody {
    #[serde(default)]
    requests: Vec<CostItem>,
    #[serde(default)]
    warning: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CostItem {
    request_id: String,
    #[serde(default)]
    cost_nano_usd: u64,
}

fn parse_costs(body: &str) -> Result<CostAnswer, PrivateError> {
    let parsed: CostsBody = serde_json::from_str(body).map_err(|_| PrivateError::Upstream)?;
    Ok(CostAnswer {
        costs: parsed
            .requests
            .into_iter()
            .map(|item| (item.request_id, item.cost_nano_usd))
            .collect(),
        warning: parsed.warning,
    })
}

pub struct HttpBilling {
    base: String,
    agent: ureq::Agent,
}

impl HttpBilling {
    /// `base` must be `https://…` or the literal `http://127.0.0.1…` used by tests.
    pub fn new(base: &str) -> Result<Self, PrivateError> {
        let url = Url::parse(base).map_err(|_| PrivateError::BadRequest)?;
        let host_ok = match url.scheme() {
            "https" => url.host().is_some(),
            "http" => url.host() == Some(Host::Ipv4(Ipv4Addr::LOCALHOST)),
            _ => false,
        };
        let plain = url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none();
        if !(host_ok && plain) {
            return Err(PrivateError::BadRequest);
        }
        let mut config = ureq::Agent::config_builder()
            .timeout_connect(Some(CONNECT_TIMEOUT))
            .timeout_global(Some(TOTAL_TIMEOUT))
            .max_redirects(0)
            .http_status_as_error(false);
        if url.scheme() == "http" {
            config = config.proxy(None);
        }
        Ok(Self {
            base: url.as_str().trim_end_matches('/').to_string(),
            agent: config.build().into(),
        })
    }
}

impl HttpBilling {
    fn check_key_request(&self, key: &str) -> Result<KeyCheck, PrivateError> {
        let request = Request::builder()
            .method(Method::POST)
            .uri(format!("{}/check_api_key", self.base))
            .header("Authorization", format!("Bearer {key}"))
            .body(String::new())
            .map_err(|_| PrivateError::BadRequest)?;
        let mut response = self
            .agent
            .run(request)
            .map_err(|_| PrivateError::Unreachable)?;
        let status = response.status().as_u16();
        let text = response
            .body_mut()
            .with_config()
            .limit(MAX_BODY_BYTES + 1)
            .read_to_string()
            .map_err(|_| PrivateError::Upstream)?;
        if text.len() as u64 > MAX_BODY_BYTES {
            return Err(PrivateError::Upstream);
        }
        check_answer(status, &text)
    }
}

fn check_answer(status: u16, text: &str) -> Result<KeyCheck, PrivateError> {
    match status {
        200 => {
            let valid = serde_json::from_str::<serde_json::Value>(text)
                .ok()
                .and_then(|value| value.get("valid").and_then(serde_json::Value::as_bool));
            if valid == Some(false) {
                Err(PrivateError::Unauthorized)
            } else {
                Ok(KeyCheck::Accepted)
            }
        }
        401 => Err(PrivateError::Unauthorized),
        402 => Ok(KeyCheck::NoCredits),
        400..=499 => Err(PrivateError::BadRequest),
        _ => Err(PrivateError::Upstream),
    }
}

impl BillingApi for HttpBilling {
    fn check_key(&self, key: &str) -> Result<KeyCheck, PrivateError> {
        self.check_key_request(key)
    }

    fn costs(&self, key: &str, ids: &[String]) -> Result<CostAnswer, PrivateError> {
        if ids.is_empty() || ids.len() > MAX_COST_IDS {
            return Err(PrivateError::BadRequest);
        }
        let request = Request::builder()
            .method(Method::POST)
            .uri(format!("{}/billing/costs", self.base))
            .header("Authorization", format!("Bearer {key}"))
            .header("Content-Type", "application/json")
            .body(json!({ "requestIds": ids }).to_string())
            .map_err(|_| PrivateError::BadRequest)?;
        let mut response = self
            .agent
            .run(request)
            .map_err(|_| PrivateError::Unreachable)?;
        let status = response.status().as_u16();
        let text = response
            .body_mut()
            .with_config()
            .limit(MAX_BODY_BYTES + 1)
            .read_to_string()
            .map_err(|_| PrivateError::Upstream)?;
        if text.len() as u64 > MAX_BODY_BYTES {
            return Err(PrivateError::Upstream);
        }
        if !(200..300).contains(&status) {
            return Err(match status {
                401 => PrivateError::Unauthorized,
                400..=499 => PrivateError::BadRequest,
                _ => PrivateError::Upstream,
            });
        }
        parse_costs(&text)
    }
}

/// A billing client that is never reachable, for a build whose NEAR AI address is unusable.
pub struct OfflineBilling;

impl BillingApi for OfflineBilling {
    fn costs(&self, _: &str, _: &[String]) -> Result<CostAnswer, PrivateError> {
        Err(PrivateError::Unreachable)
    }

    fn check_key(&self, _: &str) -> Result<KeyCheck, PrivateError> {
        Err(PrivateError::Unreachable)
    }
}

/// The app's one billing client, forwarding to NEAR AI Cloud.
pub fn default_billing() -> std::sync::Arc<dyn BillingApi> {
    match HttpBilling::new(NEAR_AI_BASE_URL) {
        Ok(billing) => std::sync::Arc::new(billing),
        Err(error) => {
            eprintln!(
                "private mode: the billing address is not usable ({}); usage falls back to estimates",
                error.code()
            );
            std::sync::Arc::new(OfflineBilling)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::private_mode::proxy::TokenUsage;

    const MODEL: &str = "Qwen/Qwen3.8-27B";
    const KEY: &str = "test-session-key";

    struct FakeBilling {
        calls: Mutex<Vec<(String, Vec<String>)>>,
        answer: Mutex<Result<CostAnswer, PrivateError>>,
    }

    impl FakeBilling {
        fn new(answer: Result<CostAnswer, PrivateError>) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                answer: Mutex::new(answer),
            }
        }
    }

    impl BillingApi for FakeBilling {
        fn costs(&self, key: &str, ids: &[String]) -> Result<CostAnswer, PrivateError> {
            lock(&self.calls).push((key.to_string(), ids.to_vec()));
            lock(&self.answer).clone()
        }

        fn check_key(&self, _: &str) -> Result<KeyCheck, PrivateError> {
            Err(PrivateError::Unreachable)
        }
    }

    fn models() -> Vec<ModelPrice> {
        vec![ModelPrice {
            id: MODEL.to_string(),
            input_per_m: 0.0,
            output_per_m: 100.0,
        }]
    }

    fn record(id: &str) -> ProxyRecord {
        ProxyRecord {
            chat_id: Some(format!("chat-{id}")),
            inference_id: Some(id.to_string()),
            usage: Some(TokenUsage {
                prompt_tokens: 0,
                completion_tokens: 1_000,
            }),
            model: MODEL.to_string(),
            request_sha256: "request".to_string(),
            response_sha256: "response".to_string(),
            started: 1,
            ended: 2,
            app_session_id: "session".to_string(),
            signed: true,
        }
    }

    #[test]
    fn final_costs_sum_and_batches_are_at_most_one_hundred_ids() {
        let records: Vec<_> = (0..150)
            .map(|index| record(&format!("00000000-0000-4000-8000-{index:012}")))
            .collect();
        let costs = records
            .iter()
            .map(|record| (record.inference_id.clone().unwrap(), 1_000_000_000))
            .collect();
        let fake = FakeBilling::new(Ok(CostAnswer {
            costs,
            warning: None,
        }));

        let usage = UsageTracker::default().usage(&records, &models(), Some(KEY), &fake);

        assert_eq!(usage.credits, 150.0 * 120.0);
        assert!(!usage.estimated);
        assert_eq!(usage.calls, 2);
        let calls = lock(&fake.calls);
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].1.len(), 100);
        assert_eq!(calls[1].1.len(), 50);
        assert_eq!(calls[0].0, KEY);
    }

    #[test]
    fn zero_with_a_warning_is_retried_three_times_then_estimated() {
        let records = vec![record("123e4567-e89b-12d3-a456-426614174000")];
        let fake = FakeBilling::new(Ok(CostAnswer {
            costs: HashMap::from([(records[0].inference_id.clone().unwrap(), 0)]),
            warning: Some("not ready".to_string()),
        }));
        let tracker = UsageTracker::default();

        let first = tracker.usage(&records, &models(), Some(KEY), &fake);
        let second = tracker.usage(&records, &models(), Some(KEY), &fake);
        let third = tracker.usage(&records, &models(), Some(KEY), &fake);
        let fourth = tracker.usage(&records, &models(), Some(KEY), &fake);

        assert_eq!(
            (first.credits, first.estimated, first.calls),
            (0.0, false, 1)
        );
        assert_eq!(
            (second.credits, second.estimated, second.calls),
            (0.0, false, 1)
        );
        assert_eq!(
            (third.credits, third.estimated, third.calls),
            (12.0, true, 1)
        );
        assert_eq!(
            (fourth.credits, fourth.estimated, fourth.calls),
            (12.0, true, 0)
        );
        assert_eq!(lock(&fake.calls).len(), 3);
    }

    #[test]
    fn a_failed_billing_call_is_estimated_after_three_asks() {
        let records = vec![record("123e4567-e89b-12d3-a456-426614174000")];
        let fake = FakeBilling::new(Err(PrivateError::Unreachable));
        let tracker = UsageTracker::default();

        assert_eq!(
            tracker.usage(&records, &models(), Some(KEY), &fake).credits,
            0.0
        );
        assert_eq!(
            tracker.usage(&records, &models(), Some(KEY), &fake).credits,
            0.0
        );
        let third = tracker.usage(&records, &models(), Some(KEY), &fake);
        assert_eq!(third.credits, 12.0);
        assert!(third.estimated);
        assert_eq!(lock(&fake.calls).len(), 3);
    }

    #[test]
    fn a_pasted_key_is_accepted_rejected_or_has_no_credits() {
        assert_eq!(
            check_answer(200, r#"{"valid":true}"#),
            Ok(KeyCheck::Accepted)
        );
        assert_eq!(check_answer(200, "{}"), Ok(KeyCheck::Accepted));
        assert_eq!(
            check_answer(200, r#"{"valid":false}"#),
            Err(PrivateError::Unauthorized)
        );
        assert_eq!(check_answer(401, "{}"), Err(PrivateError::Unauthorized));
        assert_eq!(check_answer(402, "{}"), Ok(KeyCheck::NoCredits));
        assert_eq!(check_answer(500, "{}"), Err(PrivateError::Upstream));
    }

    #[test]
    fn an_unreachable_near_ai_is_not_an_invalid_key() {
        let billing = HttpBilling::new("http://127.0.0.1:1/v1").expect("billing client");

        assert_eq!(
            billing.check_key("test-key"),
            Err(PrivateError::Unreachable)
        );
    }

    #[test]
    fn parse_costs_reads_requests_and_warning_without_echoing_them() {
        let answer = parse_costs(
            r#"{"requests":[{"requestId":"id-1","costNanoUsd":1000000000}],"warning":"lagging"}"#,
        )
        .expect("parsed");

        assert_eq!(answer.costs.get("id-1"), Some(&1_000_000_000));
        assert_eq!(answer.warning.as_deref(), Some("lagging"));
        assert!(parse_costs("not json").is_err());
    }
}
