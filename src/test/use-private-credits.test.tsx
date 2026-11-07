import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("../lib/notify", () => ({ notifyIfAway: vi.fn(() => Promise.resolve()) }));

import { notifyIfAway } from "../lib/notify";
import { usePrivateCredits } from "../hooks/usePrivateCredits";
import type { FakePrivate } from "./fixtures/private-backend";
import type { PendingTopup } from "../lib/private-credits";

function fake(): FakePrivate {
  return (window as unknown as { __FAKE_PRIVATE__: FakePrivate }).__FAKE_PRIVATE__;
}

function callsTo(cmd: string) {
  return fake().calls.filter((call) => call.cmd === cmd);
}

const POLL_MS = 3_000;
const SLOW_POLL_MS = 15_000;

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mount() {
  const view = renderHook(() => usePrivateCredits());
  await advance(0);
  return view;
}

/** A device that holds credits already, so a fresh status shows a balance. */
function readyWith(credits: number, extra: Partial<FakePrivate["status"]> = {}) {
  fake().status = {
    ...fake().status,
    device: "ready",
    keyReady: true,
    balance: { credits, usedCredits: 0, keyReady: true, updatedAt: "2026-11-07T10:00:00Z" },
    ...extra,
  };
}

type Hook = Awaited<ReturnType<typeof mount>>;

async function buy(view: Hook, usd: number) {
  await act(async () => {
    await view.result.current.buy(usd);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(notifyIfAway).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usePrivateCredits: top-up flow", () => {
  it("goes from opening to waiting when a top-up is created and its checkout opened", async () => {
    const view = await mount();
    let hold!: () => void;
    fake().holds.private_create_topup = new Promise<void>((resolve) => {
      hold = resolve;
    });

    let pending!: Promise<void>;
    act(() => {
      pending = view.result.current.buy(5);
    });
    expect(view.result.current.flow).toEqual({ kind: "opening", usd: 5 });

    await act(async () => {
      hold();
      await pending;
    });
    expect(view.result.current.flow).toMatchObject({ kind: "waiting", topup: { credits: 500 } });
    expect(callsTo("private_create_topup")[0].args).toEqual({ packageUsd: 5 });
    const topupId = (view.result.current.flow as { topup: PendingTopup }).topup.topupId;
    expect(callsTo("private_open_checkout")[0].args).toEqual({ topupId });
    expect(view.result.current.flow).not.toHaveProperty("openFailed");
  });

  it("stays waiting with openFailed when the browser does not open, and openCheckout clears it", async () => {
    const view = await mount();
    fake().errors.private_open_checkout = "open_failed";
    await buy(view, 5);
    expect(view.result.current.flow).toMatchObject({ kind: "waiting", openFailed: true });

    // The hold still exists, so polling goes on.
    await advance(POLL_MS);
    expect(callsTo("private_topup_status")).toHaveLength(1);

    delete fake().errors.private_open_checkout;
    await act(async () => {
      await view.result.current.openCheckout();
    });
    expect(callsTo("private_open_checkout")).toHaveLength(2);
    expect(view.result.current.flow.kind).toBe("waiting");
    expect(view.result.current.flow).not.toHaveProperty("openFailed");
  });

  it("keeps openFailed set when opening the checkout again fails again", async () => {
    const view = await mount();
    fake().errors.private_open_checkout = "open_failed";
    await buy(view, 5);
    await act(async () => {
      await view.result.current.openCheckout();
    });
    expect(view.result.current.flow).toMatchObject({ kind: "waiting", openFailed: true });
  });

  it("follows paid, then credited with the package credits and reads the status fresh once", async () => {
    const view = await mount();
    fake().topupStatuses = ["created", "paid", "credited"];
    await buy(view, 5);

    await advance(POLL_MS);
    expect(view.result.current.flow.kind).toBe("waiting");
    await advance(POLL_MS);
    expect(view.result.current.flow.kind).toBe("paid");
    const freshBefore = callsTo("private_status").filter((call) => call.args?.fresh === true).length;
    expect(freshBefore).toBe(0);

    await advance(POLL_MS);
    expect(view.result.current.flow).toEqual({ kind: "credited", credits: 500 });
    const fresh = callsTo("private_status").filter((call) => call.args?.fresh === true);
    expect(fresh).toHaveLength(1);
    expect(view.result.current.status?.balance?.credits).toBe(500);

    // Polling ended with the credit.
    const polls = callsTo("private_topup_status").length;
    await advance(10_000);
    expect(callsTo("private_topup_status")).toHaveLength(polls);
  });

  it("uses the credits the server reports when it reports some", async () => {
    const view = await mount();
    fake().topupStatuses = ["credited"];
    fake().topupCredits = 650;
    await buy(view, 5);
    await advance(POLL_MS);
    expect(view.result.current.flow).toEqual({ kind: "credited", credits: 650 });
  });

  it.each(["failed", "expired"] as const)("ends polling when the top-up is %s", async (status) => {
    const view = await mount();
    fake().topupStatuses = [status];
    await buy(view, 5);
    const topupId = (view.result.current.flow as { topup: PendingTopup }).topup.topupId;

    await advance(POLL_MS);
    expect(view.result.current.flow).toEqual({ kind: status, topupId });
    const polls = callsTo("private_topup_status").length;
    await advance(10_000);
    expect(callsTo("private_topup_status")).toHaveLength(polls);
  });

  it("polls a top-up waiting for stock on the slower cadence", async () => {
    const view = await mount();
    fake().topupStatuses = ["paid_waiting_stock", "credited"];
    await buy(view, 5);
    await advance(POLL_MS);
    expect(view.result.current.flow.kind).toBe("waiting-stock");
    expect(callsTo("private_topup_status")).toHaveLength(1);

    await advance(SLOW_POLL_MS - 1);
    expect(callsTo("private_topup_status")).toHaveLength(1);
    await advance(1);
    expect(callsTo("private_topup_status")).toHaveLength(2);
    expect(view.result.current.flow.kind).toBe("credited");
  });

  it("never has two polls in flight", async () => {
    const view = await mount();
    await buy(view, 5);
    let release!: () => void;
    fake().holds.private_topup_status = new Promise<void>((resolve) => {
      release = resolve;
    });

    await advance(POLL_MS * 4);
    expect(callsTo("private_topup_status")).toHaveLength(1);

    await act(async () => {
      release();
    });
    await advance(POLL_MS);
    expect(callsTo("private_topup_status").length).toBeGreaterThan(1);
  });

  it("stops polling and drops its timer when it unmounts", async () => {
    const view = await mount();
    await buy(view, 5);
    await advance(POLL_MS);
    const polls = callsTo("private_topup_status").length;
    const calls = fake().calls.length;

    view.unmount();
    await advance(60_000);
    expect(callsTo("private_topup_status")).toHaveLength(polls);
    expect(fake().calls).toHaveLength(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a poll answer that arrives after unmount", async () => {
    const view = await mount();
    fake().topupStatuses = ["credited"];
    await buy(view, 5);
    let release!: () => void;
    fake().holds.private_topup_status = new Promise<void>((resolve) => {
      release = resolve;
    });
    await advance(POLL_MS);
    const calls = fake().calls.length;

    view.unmount();
    await act(async () => {
      release();
    });
    // No fresh status read and no notification for a hook that is gone.
    expect(fake().calls).toHaveLength(calls);
    expect(notifyIfAway).not.toHaveBeenCalled();
  });

  it("keeps polling through an unreachable or upstream error", async () => {
    const view = await mount();
    await buy(view, 5);
    fake().errors.private_topup_status = "unreachable";
    await advance(POLL_MS);
    fake().errors.private_topup_status = "upstream";
    await advance(POLL_MS);
    expect(view.result.current.flow.kind).toBe("waiting");

    delete fake().errors.private_topup_status;
    fake().topupStatuses = ["credited"];
    await advance(POLL_MS);
    expect(view.result.current.flow.kind).toBe("credited");
  });

  it("stops polling and refreshes the status when a poll says unauthorized", async () => {
    const view = await mount();
    await buy(view, 5);
    const reads = callsTo("private_status").length;
    fake().errors.private_topup_status = "unauthorized";
    await advance(POLL_MS);
    expect(view.result.current.flow).toEqual({ kind: "error", code: "unauthorized" });
    expect(callsTo("private_status")).toHaveLength(reads + 1);

    const polls = callsTo("private_topup_status").length;
    await advance(10_000);
    expect(callsTo("private_topup_status")).toHaveLength(polls);
  });

  it("resumes a saved top-up after a restart and finishes it without any buy", async () => {
    fake().status = {
      ...fake().status,
      device: "ready",
      pendingTopup: { topupId: "saved-1", expiresAt: "2026-11-07T11:00:00Z", credits: 1_000 },
    };
    fake().topupStatuses = ["credited"];
    const view = await mount();
    expect(view.result.current.flow).toMatchObject({ kind: "waiting", topup: { topupId: "saved-1" } });

    await advance(POLL_MS);
    expect(view.result.current.flow).toEqual({ kind: "credited", credits: 1_000 });
    expect(callsTo("private_create_topup")).toHaveLength(0);
    expect(callsTo("private_topup_status")[0].args).toEqual({ topupId: "saved-1" });
  });
});

describe("usePrivateCredits: errors and ending a flow", () => {
  it("shows the error code when creating the top-up fails with stock", async () => {
    const view = await mount();
    fake().errors.private_create_topup = "stock";
    await buy(view, 5);
    expect(view.result.current.flow).toEqual({ kind: "error", code: "stock" });
    expect(callsTo("private_open_checkout")).toHaveLength(0);
    await advance(10_000);
    expect(callsTo("private_topup_status")).toHaveLength(0);
  });

  it("refreshes the status when creating the top-up says unauthorized", async () => {
    const view = await mount();
    const reads = callsTo("private_status").length;
    fake().errors.private_create_topup = "unauthorized";
    await buy(view, 5);
    expect(view.result.current.flow).toEqual({ kind: "error", code: "unauthorized" });
    expect(callsTo("private_status")).toHaveLength(reads + 1);
  });

  it("cancels the hold and goes idle", async () => {
    const view = await mount();
    await buy(view, 5);
    const topupId = (view.result.current.flow as { topup: PendingTopup }).topup.topupId;
    let result: unknown;
    await act(async () => {
      result = await view.result.current.cancel();
    });
    expect(result).toEqual({ ok: true });
    expect(callsTo("private_cancel_topup")[0].args).toEqual({ topupId });
    expect(view.result.current.flow).toEqual({ kind: "idle" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the flow and returns the reason when a cancel fails", async () => {
    const view = await mount();
    await buy(view, 5);
    fake().errors.private_cancel_topup = "unreachable";
    let result: unknown;
    await act(async () => {
      result = await view.result.current.cancel();
    });
    expect(result).toEqual({ ok: false, text: "Couldn't reach the credits server." });
    expect(view.result.current.flow.kind).toBe("waiting");
  });

  it("dismiss returns to idle", async () => {
    const view = await mount();
    fake().errors.private_create_topup = "stock";
    await buy(view, 5);
    act(() => view.result.current.dismiss());
    expect(view.result.current.flow).toEqual({ kind: "idle" });
  });
});

describe("usePrivateCredits: promo, recovery and forgetting", () => {
  it("redeems a promo code into a paid flow that polls like a top-up", async () => {
    const view = await mount();
    fake().topupStatuses = ["credited"];
    let result: unknown;
    await act(async () => {
      result = await view.result.current.redeem("PROMO-1");
    });
    expect(result).toEqual({ ok: true, credits: 500 });
    expect(callsTo("private_redeem_promo")[0].args).toEqual({ code: "PROMO-1" });
    expect(view.result.current.flow).toMatchObject({ kind: "paid", topup: { topupId: "promo-1", credits: 500 } });

    await advance(POLL_MS);
    expect(view.result.current.flow).toEqual({ kind: "credited", credits: 500 });
  });

  it("returns plain words when a promo code is refused, and refreshes on unauthorized", async () => {
    const view = await mount();
    fake().errors.private_redeem_promo = "bad_code";
    let result: unknown;
    await act(async () => {
      result = await view.result.current.redeem("nope");
    });
    expect(result).toEqual({ ok: false, text: "That code didn't work. Check it and try again." });
    expect(view.result.current.flow.kind).toBe("idle");

    const reads = callsTo("private_status").length;
    fake().errors.private_redeem_promo = "unauthorized";
    await act(async () => {
      result = await view.result.current.redeem("nope");
    });
    expect(result).toEqual({ ok: false, text: "Your credits moved to another Mac." });
    expect(callsTo("private_status")).toHaveLength(reads + 1);
  });

  it("recovers with a code, hands back the new code and refreshes", async () => {
    const view = await mount();
    const reads = callsTo("private_status").length;
    let result: unknown;
    await act(async () => {
      result = await view.result.current.recover("OLD-CODE");
    });
    expect(result).toEqual({ ok: true, newCode: "ZRV-NEW-CODE" });
    expect(callsTo("private_recover")[0].args).toEqual({ code: "OLD-CODE" });
    expect(callsTo("private_status")).toHaveLength(reads + 1);
    // The hook keeps no copy of any code in what it returns.
    expect(JSON.stringify(view.result.current.status)).not.toContain("ZRV-NEW-CODE");
  });

  it("returns plain words when a recovery code is refused", async () => {
    const view = await mount();
    fake().errors.private_recover = "has_own_credits";
    let result: unknown;
    await act(async () => {
      result = await view.result.current.recover("X");
    });
    expect(result).toMatchObject({ ok: false });
    expect((result as { text: string }).text).toContain("credits of its own");
  });

  it("reveals the recovery code on request", async () => {
    const view = await mount();
    let code = "";
    await act(async () => {
      code = await view.result.current.revealCode();
    });
    expect(code).toBe("ZRV-FAKE-CODE");
  });

  it("forgets the device and refreshes", async () => {
    const view = await mount();
    const reads = callsTo("private_status").length;
    let result: unknown;
    await act(async () => {
      result = await view.result.current.forget();
    });
    expect(result).toEqual({ ok: true });
    expect(callsTo("private_forget_device")).toHaveLength(1);
    expect(callsTo("private_status")).toHaveLength(reads + 1);

    fake().errors.private_forget_device = "keychain";
    await act(async () => {
      result = await view.result.current.forget();
    });
    expect(result).toMatchObject({ ok: false });
  });
});

describe("usePrivateCredits: recovery dialog", () => {
  it("asks for the recovery code after a first credit, until it is marked", async () => {
    const view = await mount();
    expect(view.result.current.needsRecoveryDialog).toBe(false);

    fake().topupStatuses = ["credited"];
    await buy(view, 5);
    await advance(POLL_MS);
    expect(view.result.current.flow.kind).toBe("credited");
    expect(view.result.current.needsRecoveryDialog).toBe(true);

    await act(async () => {
      await view.result.current.markRecovery(true);
    });
    expect(callsTo("private_mark_recovery")[0].args).toEqual({ saved: true });
    expect(view.result.current.needsRecoveryDialog).toBe(false);
  });

  it("does not ask when the device has no credits, no key, or was already asked", async () => {
    const view = await mount();
    readyWith(0);
    await act(async () => view.result.current.refresh());
    expect(view.result.current.needsRecoveryDialog).toBe(false);

    readyWith(300, { keyReady: false });
    await act(async () => view.result.current.refresh());
    expect(view.result.current.needsRecoveryDialog).toBe(false);

    readyWith(300, { recoveryPrompted: true });
    await act(async () => view.result.current.refresh());
    expect(view.result.current.needsRecoveryDialog).toBe(false);

    readyWith(300, { recoveryPrompted: false });
    await act(async () => view.result.current.refresh());
    expect(view.result.current.needsRecoveryDialog).toBe(true);
  });

  it("counts the last known balance when no fresh balance came", async () => {
    fake().status = {
      ...fake().status,
      device: "ready",
      keyReady: true,
      lastBalance: { credits: 40, usedCredits: 0, at: "2026-11-07T09:00:00Z" },
    };
    const view = await mount();
    expect(view.result.current.needsRecoveryDialog).toBe(true);
  });
});

describe("usePrivateCredits: credits-out sessions", () => {
  it("drops an empty mark once a refreshed status shows credits", async () => {
    const view = await mount();
    act(() => view.result.current.markCreditsOut("s1", "empty"));
    expect(view.result.current.creditsOut).toEqual({ s1: "empty" });

    await act(async () => view.result.current.refresh());
    expect(view.result.current.creditsOut).toEqual({ s1: "empty" });

    readyWith(300);
    await act(async () => view.result.current.refresh());
    expect(view.result.current.creditsOut).toEqual({});
  });

  it("drops a key mark once the key is ready without an error, not before", async () => {
    const view = await mount();
    act(() => view.result.current.markCreditsOut("s2", "key"));

    readyWith(300, { keyReady: true, keyError: "key_lost" });
    await act(async () => view.result.current.refresh());
    expect(view.result.current.creditsOut).toEqual({ s2: "key" });

    readyWith(300, { keyReady: true, keyError: null });
    await act(async () => view.result.current.refresh());
    expect(view.result.current.creditsOut).toEqual({});
  });

  it("keeps a key mark when credits arrive but the key is not ready", async () => {
    const view = await mount();
    act(() => view.result.current.markCreditsOut("s3", "key"));
    readyWith(300, { keyReady: false });
    await act(async () => view.result.current.refresh());
    expect(view.result.current.creditsOut).toEqual({ s3: "key" });
  });
});

describe("usePrivateCredits: loading", () => {
  it("loads the status, the stock and the models, and passes fresh through", async () => {
    fake().models = [{ id: "qwen/qwen3-coder", inputPerM: 1, outputPerM: 2 }];
    const view = await mount();
    expect(view.result.current.status?.device).toBe("none");
    expect(view.result.current.stock?.availableCredits).toBe(100_000);
    expect(view.result.current.models).toEqual(fake().models);
    expect(view.result.current.modelsError).toBeUndefined();
    expect(callsTo("private_status")[0].args).toEqual({ fresh: false });

    await act(async () => view.result.current.refresh(true));
    expect(callsTo("private_status")[1].args).toEqual({ fresh: true });
  });

  it("keeps the status when the stock or the models fail, and words the models error", async () => {
    readyWith(300);
    fake().errors.private_stock = "unreachable";
    fake().errors.private_models = "upstream";
    const view = await mount();
    expect(view.result.current.status?.balance?.credits).toBe(300);
    expect(view.result.current.stock).toBeNull();
    expect(view.result.current.models).toBeNull();
    expect(view.result.current.modelsError).toBe("Couldn't open checkout. Nothing was held or charged.");
  });

  it("keeps the last status when a later read fails", async () => {
    readyWith(300);
    const view = await mount();
    fake().errors.private_status = "unreachable";
    await act(async () => view.result.current.refresh());
    expect(view.result.current.status?.balance?.credits).toBe(300);
  });
});

describe("usePrivateCredits: notification", () => {
  it("notifies once when the credit lands", async () => {
    const view = await mount();
    fake().topupStatuses = ["credited"];
    await buy(view, 5);
    await advance(POLL_MS);
    await advance(0);
    expect(notifyIfAway).toHaveBeenCalledTimes(1);
    expect(notifyIfAway).toHaveBeenCalledWith({
      title: "Zorvo",
      body: "+500 credits. Private sessions can use them now.",
    });
  });

  it("does not notify for a plain refresh that shows the same credits", async () => {
    readyWith(300);
    const view = await mount();
    await act(async () => view.result.current.refresh(true));
    expect(notifyIfAway).not.toHaveBeenCalled();
  });

  it("notifies when a refresh shows the credits rose", async () => {
    readyWith(300);
    const view = await mount();
    readyWith(800);
    await act(async () => view.result.current.refresh(true));
    expect(notifyIfAway).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyIfAway).mock.calls[0][0].body).toBe("+500 credits. Private sessions can use them now.");
  });

  it("does not break the flow when the notification fails", async () => {
    vi.mocked(notifyIfAway).mockRejectedValueOnce(new Error("denied"));
    const view = await mount();
    fake().topupStatuses = ["credited"];
    await buy(view, 5);
    await advance(POLL_MS);
    expect(view.result.current.flow).toEqual({ kind: "credited", credits: 500 });
  });
});
