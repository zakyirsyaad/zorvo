//! Unit tests of `PrivateMode`, over the fakes in `testing.rs`.

use std::sync::Arc;
use std::time::Duration;

use super::*;
use crate::private_mode::device::{secret_hash, NEARAI_KEY};
use crate::private_mode::testing::{
    balance, model_list, Call, Harness, CHECKOUT_URL, CODE, OTHER_CODE, TOPUP_ID,
};

fn state_with_balance(credits: u64) -> LocalState {
    LocalState {
        last_balance: Some(LastBalance {
            credits,
            used_credits: 0,
            at: "2026-11-06T00:00:00Z".into(),
        }),
        ..LocalState::default()
    }
}

fn pending(id: &str) -> PendingTopup {
    PendingTopup {
        topup_id: id.into(),
        expires_at: "2026-11-07T02:00:00Z".into(),
        credits: 1000,
    }
}

fn is_register(call: &Call) -> bool {
    matches!(call, Call::Register { .. })
}

fn is_take_key(call: &Call) -> bool {
    matches!(call, Call::TakeKey { .. })
}

// ---- status: no device ----

#[test]
fn status_with_an_empty_store_makes_no_call_and_reports_no_device() {
    let h = Harness::new();
    let status = h.mode.status(false);
    assert_eq!(status.device, DeviceState::None);
    assert!(!status.key_ready);
    assert_eq!(status.balance, None);
    assert!(h.api.calls().is_empty());
}

// ---- ensure_device ----

#[test]
fn stock_with_an_empty_store_creates_and_registers_a_device_once() {
    let h = Harness::new();
    h.mode.stock().expect("stock");
    h.mode.stock().expect("stock again");
    let code = h.secret(DEVICE_SECRET).expect("a device secret");
    assert_eq!(normalize_recovery_code(&code), Some(code.clone()));
    assert_eq!(
        h.api.calls()[0],
        Call::Register {
            hash: secret_hash(&code)
        }
    );
    assert_eq!(h.api.count(is_register), 1);
    assert_eq!(
        h.api
            .count(|c| matches!(c, Call::Stock { secret } if *secret == code)),
        2
    );
    // and status still makes a call only now that a device exists
    assert_eq!(Harness::new().mode.status(false).device, DeviceState::None);
}

#[test]
fn a_failed_register_keeps_the_secret_and_registers_on_the_next_call() {
    let h = Harness::new();
    h.api.register.then(Err(PrivateError::Unreachable));
    assert_eq!(h.mode.stock(), Err(PrivateError::Unreachable));
    let code = h.secret(DEVICE_SECRET).expect("secret kept");
    assert_eq!(h.api.count(|c| matches!(c, Call::Stock { .. })), 0);

    h.mode.stock().expect("stock");
    assert_eq!(h.secret(DEVICE_SECRET), Some(code.clone()));
    assert_eq!(
        h.api.count(|c| *c
            == Call::Register {
                hash: secret_hash(&code)
            }),
        2
    );
}

#[test]
fn status_registers_an_existing_device_once_per_run() {
    let h = Harness::with_device(CODE);
    h.mode.status(false);
    h.mode.status(false);
    assert_eq!(h.api.count(is_register), 1);
}

#[test]
fn a_device_the_server_has_seen_is_not_registered_again() {
    // Registering a moved device's old hash would make a new empty device.
    let h = Harness::with_device(CODE);
    h.set_state(&state_with_balance(10));
    h.api.balance.always(Err(PrivateError::Unauthorized));
    h.api.stock.always(Err(PrivateError::Unauthorized));
    assert_eq!(h.mode.status(false).device, DeviceState::Moved);
    assert_eq!(h.mode.stock(), Err(PrivateError::Unauthorized));
    assert_eq!(h.api.count(is_register), 0);
}

#[test]
fn ensure_device_does_not_create_a_device_while_a_recovery_is_unresolved() {
    let h = Harness::new();
    h.store.set(DEVICE_SECRET_NEXT, OTHER_CODE).expect("seed");
    h.api.balance.then(Err(PrivateError::Unreachable));
    assert_eq!(h.mode.stock(), Err(PrivateError::Unreachable));
    assert_eq!(h.secret(DEVICE_SECRET), None);
    assert_eq!(h.secret(DEVICE_SECRET_NEXT).as_deref(), Some(OTHER_CODE));
}

// ---- status: balance ----

#[test]
fn unauthorized_balance_reads_moved() {
    let h = Harness::with_device(CODE);
    h.api.balance.always(Err(PrivateError::Unauthorized));
    let status = h.mode.status(true);
    assert_eq!(status.device, DeviceState::Moved);
    assert!(h.api.calls().contains(&Call::Balance {
        secret: CODE.into(),
        fresh: true
    }));
    assert_eq!(h.api.count(is_take_key), 0);
}

#[test]
fn unreachable_balance_keeps_the_last_balance() {
    let h = Harness::with_device(CODE);
    h.set_state(&state_with_balance(50));
    h.api.balance.always(Err(PrivateError::Unreachable));
    let status = h.mode.status(false);
    assert_eq!(status.device, DeviceState::Ready);
    assert_eq!(status.balance_error, Some(PrivateError::Unreachable));
    assert_eq!(status.balance, None);
    assert_eq!(status.last_balance, state_with_balance(50).last_balance);
}

#[test]
fn a_balance_is_remembered_as_the_last_balance() {
    let h = Harness::with_device(CODE);
    h.api.balance.always(Ok(balance(420, true)));
    h.store.set(NEARAI_KEY, "sk-test").expect("seed key");
    let status = h.mode.status(false);
    assert_eq!(status.balance, Some(balance(420, true)));
    let last = status.last_balance.expect("last balance");
    assert_eq!(
        (last.credits, last.at.as_str()),
        (420, "2026-11-07T01:00:00Z")
    );
    assert_eq!(h.state().last_balance, Some(last));
}

// ---- status: key handover ----

#[test]
fn status_collects_the_key_and_reports_it_ready() {
    let h = Harness::with_device(CODE);
    h.api.balance.always(Ok(balance(300, false)));
    h.api.take_key.then(Ok(Some("sk-test".into())));
    let status = h.mode.status(false);
    assert!(status.key_ready);
    assert_eq!(status.key_error, None);
    assert_eq!(h.secret(NEARAI_KEY).as_deref(), Some("sk-test"));
    assert_eq!(h.mode.launch_key().as_deref(), Ok("sk-test"));
    assert!(h.api.calls().contains(&Call::TakeKey {
        secret: CODE.into()
    }));
}

#[test]
fn a_key_the_keychain_cannot_save_reads_keychain() {
    let h = Harness::with_device(CODE);
    h.store.fail_writes_to(NEARAI_KEY);
    h.api.take_key.then(Ok(Some("sk-test".into())));
    let status = h.mode.status(false);
    assert_eq!(status.key_error, Some(PrivateError::Keychain));
    assert!(!status.key_ready);
    assert_eq!(h.mode.launch_key(), Err(PrivateError::NoKey));
}

#[test]
fn a_key_that_reads_back_different_reads_keychain() {
    let h = Harness::with_device(CODE);
    h.store.garble_reads_of(NEARAI_KEY);
    h.api.take_key.then(Ok(Some("sk-test".into())));
    let status = h.mode.status(false);
    assert_eq!(status.key_error, Some(PrivateError::Keychain));
    assert!(!status.key_ready);
}

#[test]
fn a_key_handed_over_but_not_here_reads_key_lost() {
    let h = Harness::with_device(CODE);
    h.api.balance.always(Ok(balance(300, true)));
    let status = h.mode.status(false);
    assert_eq!(status.key_error, Some(PrivateError::KeyLost));
    assert!(!status.key_ready);
}

#[test]
fn no_key_yet_is_not_an_error() {
    let h = Harness::with_device(CODE);
    let status = h.mode.status(false);
    assert_eq!(status.device, DeviceState::Ready);
    assert_eq!(status.key_error, None);
    assert!(!status.key_ready);
}

#[test]
fn a_key_already_on_this_mac_is_not_asked_for() {
    let h = Harness::with_device(CODE);
    h.store.set(NEARAI_KEY, "sk-test").expect("seed key");
    h.api.balance.always(Ok(balance(300, true)));
    assert!(h.mode.status(false).key_ready);
    assert_eq!(h.api.count(is_take_key), 0);
}

#[test]
fn two_status_calls_at_once_collect_the_key_once() {
    let h = Arc::new(Harness::with_device(CODE));
    h.api.balance.always(Ok(balance(300, false)));
    h.api.take_key.then(Ok(Some("sk-test".into())));
    h.api.slow_take_key(Duration::from_millis(100));
    let statuses: Vec<PrivateStatus> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..2)
            .map(|_| scope.spawn(|| h.mode.status(false)))
            .collect();
        handles
            .into_iter()
            .map(|t| t.join().expect("joins"))
            .collect()
    });
    assert_eq!(h.api.count(is_take_key), 1);
    assert!(statuses
        .iter()
        .all(|s| s.key_ready && s.key_error.is_none()));
    assert_eq!(h.secret(NEARAI_KEY).as_deref(), Some("sk-test"));
}

// ---- status: a recovery left in device-secret-next ----

#[test]
fn status_promotes_a_next_secret_whose_balance_succeeds() {
    let h = Harness::with_device(CODE);
    h.store.set(DEVICE_SECRET_NEXT, OTHER_CODE).expect("seed");
    h.store.set(NEARAI_KEY, "sk-old").expect("seed key");
    h.api.balance.always(Ok(balance(70, false)));
    let status = h.mode.status(false);
    assert_eq!(status.device, DeviceState::Ready);
    assert_eq!(status.balance, Some(balance(70, false)));
    assert_eq!(h.secret(DEVICE_SECRET).as_deref(), Some(OTHER_CODE));
    assert_eq!(h.secret(DEVICE_SECRET_NEXT), None);
    assert_eq!(h.secret(NEARAI_KEY), None);
    assert_eq!(
        h.api
            .count(|c| matches!(c, Call::Balance { secret, .. } if secret == CODE)),
        0
    );
}

#[test]
fn status_deletes_a_next_secret_the_server_refuses() {
    let h = Harness::with_device(CODE);
    h.store.set(DEVICE_SECRET_NEXT, OTHER_CODE).expect("seed");
    h.api.balance.then(Err(PrivateError::Unauthorized));
    let status = h.mode.status(false);
    assert_eq!(status.device, DeviceState::Ready);
    assert_eq!(h.secret(DEVICE_SECRET).as_deref(), Some(CODE));
    assert_eq!(h.secret(DEVICE_SECRET_NEXT), None);
}

#[test]
fn status_leaves_a_next_secret_it_cannot_check() {
    let h = Harness::with_device(CODE);
    h.store.set(DEVICE_SECRET_NEXT, OTHER_CODE).expect("seed");
    h.api.balance.then(Err(PrivateError::Unreachable));
    let status = h.mode.status(false);
    assert_eq!(status.balance_error, Some(PrivateError::Unreachable));
    assert_eq!(h.secret(DEVICE_SECRET_NEXT).as_deref(), Some(OTHER_CODE));
    // the old secret is not used while the recovery is unresolved
    assert_eq!(h.api.calls().len(), 1);
}

// ---- models ----

#[test]
fn models_are_cached_in_memory_and_saved_to_the_state_file() {
    let h = Harness::with_device(CODE);
    assert_eq!(h.mode.models(), Ok(model_list()));
    assert_eq!(h.mode.models(), Ok(model_list()));
    assert_eq!(h.api.count(|c| matches!(c, Call::Models { .. })), 1);
    assert_eq!(h.state().models.expect("saved").list, model_list());
}

#[test]
fn models_fall_back_to_the_state_file_when_the_worker_is_unreachable() {
    let h = Harness::with_device(CODE);
    h.set_state(&LocalState {
        models: Some(CachedModels {
            at: "2026-11-06T00:00:00Z".into(),
            list: model_list(),
        }),
        ..LocalState::default()
    });
    h.api.models.always(Err(PrivateError::Unreachable));
    assert_eq!(h.mode.models(), Ok(model_list()));
}

#[test]
fn models_without_a_saved_list_return_the_error() {
    let h = Harness::with_device(CODE);
    h.api.models.always(Err(PrivateError::Unreachable));
    assert_eq!(h.mode.models(), Err(PrivateError::Unreachable));
}

// ---- top-ups ----

#[test]
fn a_first_top_up_creates_the_device_saves_the_top_up_and_opens_checkout() {
    let h = Harness::new();
    let topup = h.mode.create_topup(10).expect("top-up");
    let code = h.secret(DEVICE_SECRET).expect("device created");
    assert_eq!(
        h.api.calls()[0],
        Call::Register {
            hash: secret_hash(&code)
        }
    );
    assert!(h.api.calls().contains(&Call::CreateTopup {
        secret: code,
        usd: 10
    }));
    assert_eq!(topup.credits, 1000);
    assert_eq!(topup.topup_id, TOPUP_ID);
    assert_eq!(h.state().pending_topup, Some(topup));
    assert_eq!(h.opened(), vec![CHECKOUT_URL.to_string()]);
    h.mode.open_checkout(TOPUP_ID).expect("opens again");
    assert_eq!(h.opened().len(), 2);
}

#[test]
fn a_checkout_url_off_pingpay_is_refused_and_never_opened() {
    for url in [
        "https://evil.example/pay",
        "https://pay.pingpay.io.evil.com/x",
        "http://pay.pingpay.io/x",
        "https://user@pay.pingpay.io/x",
        "https://pay.pingpay.io:8443/x",
        "not a url",
    ] {
        let h = Harness::with_device(CODE);
        h.api
            .create_topup
            .always(Ok(crate::private_mode::client::CreatedTopup {
                topup_id: TOPUP_ID.into(),
                session_url: url.into(),
                expires_at: "2026-11-07T02:00:00Z".into(),
            }));
        assert_eq!(
            h.mode.create_topup(10),
            Err(PrivateError::BadCheckoutUrl),
            "{url}"
        );
        assert!(h.opened().is_empty(), "{url}");
        assert_eq!(h.state().pending_topup, None, "{url}");
        assert_eq!(h.mode.open_checkout(TOPUP_ID), Err(PrivateError::NotFound));
    }
}

#[test]
fn open_checkout_opens_only_a_known_top_up() {
    let h = Harness::with_device(CODE);
    assert_eq!(h.mode.open_checkout("t9"), Err(PrivateError::NotFound));
    assert!(h.opened().is_empty());
}

#[test]
fn a_credited_top_up_is_cleared_and_its_key_collected() {
    let h = Harness::with_device(CODE);
    h.mode.create_topup(10).expect("top-up");
    h.api.topup.always(Ok(TopupState {
        status: "credited".into(),
        credits: 1000,
    }));
    h.api.take_key.then(Ok(Some("sk-test".into())));
    let state = h.mode.topup_status(TOPUP_ID).expect("status");
    assert_eq!(state.status, "credited");
    assert_eq!(h.state().pending_topup, None);
    assert_eq!(h.secret(NEARAI_KEY).as_deref(), Some("sk-test"));
    assert_eq!(h.mode.open_checkout(TOPUP_ID), Err(PrivateError::NotFound));
}

#[test]
fn failed_and_expired_top_ups_are_cleared_without_a_handover() {
    for status in ["failed", "expired"] {
        let h = Harness::with_device(CODE);
        h.mode.create_topup(10).expect("top-up");
        h.api.topup.always(Ok(TopupState {
            status: status.into(),
            credits: 0,
        }));
        h.mode.topup_status(TOPUP_ID).expect("status");
        assert_eq!(h.state().pending_topup, None, "{status}");
        assert_eq!(h.mode.open_checkout(TOPUP_ID), Err(PrivateError::NotFound));
        assert_eq!(h.api.count(is_take_key), 0, "{status}");
    }
}

#[test]
fn top_ups_still_on_their_way_are_kept() {
    for status in ["created", "paid", "paid_waiting_stock"] {
        let h = Harness::with_device(CODE);
        let topup = h.mode.create_topup(10).expect("top-up");
        h.api.topup.always(Ok(TopupState {
            status: status.into(),
            credits: 1000,
        }));
        h.mode.topup_status(TOPUP_ID).expect("status");
        assert_eq!(h.state().pending_topup, Some(topup), "{status}");
        assert!(h.mode.open_checkout(TOPUP_ID).is_ok(), "{status}");
    }
}

#[test]
fn topup_status_and_cancel_need_a_device_and_create_none() {
    let h = Harness::new();
    assert_eq!(h.mode.topup_status(TOPUP_ID), Err(PrivateError::NoDevice));
    assert_eq!(h.mode.cancel_topup(TOPUP_ID), Err(PrivateError::NoDevice));
    assert!(h.api.calls().is_empty());
}

#[test]
fn cancel_tells_the_worker_and_clears_the_top_up() {
    let h = Harness::with_device(CODE);
    h.mode.create_topup(10).expect("top-up");
    h.mode.cancel_topup(TOPUP_ID).expect("cancel");
    assert!(h.api.calls().contains(&Call::CancelTopup {
        secret: CODE.into(),
        id: TOPUP_ID.into()
    }));
    assert_eq!(h.state().pending_topup, None);
    assert_eq!(h.mode.open_checkout(TOPUP_ID), Err(PrivateError::NotFound));
}

// ---- promo ----

#[test]
fn a_promo_code_is_trimmed_redeemed_and_saved_as_the_pending_top_up() {
    let h = Harness::new();
    let result = h.mode.redeem_promo("  HACK300 ").expect("redeemed");
    assert_eq!(result.credits, 300);
    let code = h.secret(DEVICE_SECRET).expect("device created");
    assert!(h.api.calls().contains(&Call::RedeemPromo {
        secret: code,
        code: "HACK300".into()
    }));
    let saved = h.state().pending_topup.expect("pending");
    assert_eq!((saved.topup_id.as_str(), saved.credits), ("p1", 300));
}

#[test]
fn an_empty_or_long_promo_code_is_refused_without_a_call() {
    let h = Harness::new();
    assert_eq!(h.mode.redeem_promo("   "), Err(PrivateError::BadCode));
    assert_eq!(
        h.mode.redeem_promo(&"x".repeat(65)),
        Err(PrivateError::BadCode)
    );
    assert!(h.api.calls().is_empty());
    assert_eq!(h.secret(DEVICE_SECRET), None);
}

#[test]
fn a_promo_code_the_worker_refuses_reads_bad_code() {
    let h = Harness::with_device(CODE);
    h.api.redeem_promo.then(Err(PrivateError::BadRequest));
    assert_eq!(h.mode.redeem_promo("NOPE"), Err(PrivateError::BadCode));
    assert_eq!(h.state().pending_topup, None);
}

// ---- recovery code and flags ----

#[test]
fn recovery_code_is_the_secret_or_no_device() {
    assert_eq!(
        Harness::new().mode.recovery_code(),
        Err(PrivateError::NoDevice)
    );
    assert_eq!(
        Harness::with_device(CODE).mode.recovery_code().as_deref(),
        Ok(CODE)
    );
}

#[test]
fn mark_recovery_sets_prompted_and_saved() {
    let h = Harness::with_device(CODE);
    h.mode.mark_recovery(false).expect("marked");
    let status = h.mode.status(false);
    assert!(status.recovery_prompted && !status.recovery_saved);
    h.mode.mark_recovery(true).expect("marked");
    assert!(h.state().recovery_saved);
}

// ---- recover ----

#[test]
fn recover_sends_the_canonical_old_code_and_the_new_hash_and_replaces_the_secret() {
    let h = Harness::with_device(OTHER_CODE);
    h.store.set(NEARAI_KEY, "sk-old").expect("seed key");
    h.set_state(&LocalState {
        recovery_saved: true,
        recovery_prompted: true,
        ..LocalState::default()
    });
    let new = h
        .mode
        .recover("zrv 4k9p 2m7q 8hxd 7f2q")
        .expect("recovered");
    assert_eq!(normalize_recovery_code(&new), Some(new.clone()));
    assert_ne!(new, CODE);
    assert_eq!(
        h.api.calls(),
        vec![Call::Recover {
            code: CODE.into(),
            new_hash: secret_hash(&new)
        }]
    );
    assert_eq!(h.secret(DEVICE_SECRET), Some(new));
    assert_eq!(h.secret(DEVICE_SECRET_NEXT), None);
    assert_eq!(h.secret(NEARAI_KEY), None);
    let state = h.state();
    assert!(!state.recovery_saved && !state.recovery_prompted);
}

#[test]
fn recover_with_what_is_not_a_code_is_bad_code_without_a_call() {
    let h = Harness::new();
    assert_eq!(h.mode.recover("not a code"), Err(PrivateError::BadCode));
    assert!(h.api.calls().is_empty());
    assert_eq!(h.secret(DEVICE_SECRET_NEXT), None);
}

#[test]
fn a_code_the_server_refuses_reads_bad_code_and_leaves_the_store_unchanged() {
    let h = Harness::with_device(OTHER_CODE);
    h.store.set(NEARAI_KEY, "sk-old").expect("seed key");
    h.api.recover.then(Err(PrivateError::BadRequest));
    assert_eq!(h.mode.recover(CODE), Err(PrivateError::BadCode));
    assert_eq!(h.secret(DEVICE_SECRET).as_deref(), Some(OTHER_CODE));
    assert_eq!(h.secret(DEVICE_SECRET_NEXT), None);
    assert_eq!(h.secret(NEARAI_KEY).as_deref(), Some("sk-old"));
}

#[test]
fn recover_is_refused_while_this_mac_has_credits_of_its_own() {
    let h = Harness::with_device(OTHER_CODE);
    h.set_state(&state_with_balance(50));
    assert_eq!(h.mode.recover(CODE), Err(PrivateError::HasOwnCredits));
    assert!(h.api.calls().is_empty());

    let h = Harness::with_device(OTHER_CODE);
    h.set_state(&LocalState {
        pending_topup: Some(pending("t2")),
        ..LocalState::default()
    });
    assert_eq!(h.mode.recover(CODE), Err(PrivateError::HasOwnCredits));
    assert!(h.api.calls().is_empty());
}

#[test]
fn recover_with_this_macs_own_code_is_allowed_with_credits() {
    let h = Harness::with_device(CODE);
    h.set_state(&state_with_balance(50));
    let new = h
        .mode
        .recover(" zrv 4k9p-2m7q 8hxd 7f2q ")
        .expect("re-issued");
    assert_eq!(h.secret(DEVICE_SECRET), Some(new));
    assert_eq!(
        h.api
            .count(|c| matches!(c, Call::Recover { code, .. } if code == CODE)),
        1
    );
}

#[test]
fn an_unreachable_recovery_keeps_next_and_a_later_status_promotes_it() {
    let h = Harness::new();
    h.api.recover.then(Err(PrivateError::Unreachable));
    assert_eq!(h.mode.recover(CODE), Err(PrivateError::Unreachable));
    let next = h.secret(DEVICE_SECRET_NEXT).expect("next kept");
    assert_eq!(h.secret(DEVICE_SECRET), None);

    h.api.balance.then(Ok(balance(70, false)));
    let status = h.mode.status(false);
    assert_eq!(status.device, DeviceState::Ready);
    assert_eq!(h.secret(DEVICE_SECRET), Some(next));
    assert_eq!(h.secret(DEVICE_SECRET_NEXT), None);
}

#[test]
fn an_unreachable_recovery_the_server_never_saw_is_dropped_by_a_later_status() {
    let h = Harness::with_device(OTHER_CODE);
    h.api.recover.then(Err(PrivateError::Unreachable));
    assert_eq!(h.mode.recover(CODE), Err(PrivateError::Unreachable));
    assert!(h.secret(DEVICE_SECRET_NEXT).is_some());

    h.api.balance.then(Err(PrivateError::Unauthorized));
    h.mode.status(false);
    assert_eq!(h.secret(DEVICE_SECRET_NEXT), None);
    assert_eq!(h.secret(DEVICE_SECRET).as_deref(), Some(OTHER_CODE));
}

#[test]
fn a_retry_finishes_a_recovery_the_server_already_took_instead_of_replacing_next() {
    let h = Harness::new();
    h.api.recover.then(Err(PrivateError::Unreachable));
    assert_eq!(h.mode.recover(CODE), Err(PrivateError::Unreachable));
    let next = h.secret(DEVICE_SECRET_NEXT).expect("next kept");

    h.api.balance.then(Ok(balance(70, false)));
    assert_eq!(h.mode.recover(CODE), Ok(next.clone()));
    assert_eq!(h.secret(DEVICE_SECRET), Some(next));
    assert_eq!(h.api.count(|c| matches!(c, Call::Recover { .. })), 1);
}

#[test]
fn a_failed_promotion_keeps_next_and_reads_keychain() {
    let h = Harness::new();
    h.store.fail_writes_to(DEVICE_SECRET);
    assert_eq!(h.mode.recover(CODE), Err(PrivateError::Keychain));
    let next = h.secret(DEVICE_SECRET_NEXT).expect("next kept");
    assert_eq!(
        h.api.calls(),
        vec![Call::Recover {
            code: CODE.into(),
            new_hash: secret_hash(&next)
        }]
    );
}

#[test]
fn a_failed_write_of_next_stops_before_the_server() {
    let h = Harness::new();
    h.store.fail_writes_to(DEVICE_SECRET_NEXT);
    assert_eq!(h.mode.recover(CODE), Err(PrivateError::Keychain));
    assert!(h.api.calls().is_empty());
}

// ---- forget ----

#[test]
fn forget_device_deletes_every_item_and_resets_the_state_file() {
    let h = Harness::with_device(CODE);
    h.store.set(NEARAI_KEY, "sk-test").expect("seed");
    h.store.set(DEVICE_SECRET_NEXT, OTHER_CODE).expect("seed");
    h.mode.create_topup(10).expect("top-up");
    h.mode.forget_device().expect("forgotten");
    for account in [DEVICE_SECRET, DEVICE_SECRET_NEXT, NEARAI_KEY] {
        assert_eq!(h.secret(account), None, "{account}");
    }
    assert_eq!(h.state(), LocalState::default());
    assert_eq!(h.mode.open_checkout(TOPUP_ID), Err(PrivateError::NotFound));
    assert_eq!(h.mode.status(false).device, DeviceState::None);
}

// ---- the serialized status ----

#[test]
fn status_serializes_in_camel_case_with_snake_case_codes() {
    let h = Harness::with_device(CODE);
    h.api.balance.always(Err(PrivateError::Unauthorized));
    let json = serde_json::to_value(h.mode.status(false)).expect("serializes");
    assert_eq!(json["device"], "moved");
    assert_eq!(json["keyReady"], false);
    assert!(json.get("balanceError").is_some());
    assert!(!json.to_string().contains(CODE));
}

#[test]
fn iso_dates_are_utc_calendar_dates() {
    assert_eq!(iso_from_unix(0), "1970-01-01T00:00:00Z");
    assert_eq!(iso_from_unix(1_730_678_400), "2024-11-04T00:00:00Z");
    assert_eq!(iso_from_unix(951_782_400 + 3_661), "2000-02-29T01:01:01Z");
}
