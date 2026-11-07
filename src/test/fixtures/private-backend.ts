// A scriptable stand-in for the `private_*` commands (Zorvo Private). It follows the Rust service:
// a created top-up becomes the pending one, a credited answer clears it and adds to the balance.
import type { ModelPrice, PendingTopup, PrivateStatus, Stock } from "../../lib/private-credits";

export interface FakePrivateCall {
  cmd: string;
  args: Record<string, unknown> | undefined;
}

export interface FakePrivate {
  status: PrivateStatus;
  stock: Stock;
  models: ModelPrice[];
  /** Answers of `private_topup_status` in turn; the last one repeats. */
  topupStatuses: string[];
  /** The credits a `credited` answer reports (0 makes the hook fall back to the pending credits). */
  topupCredits: number;
  /** Command name to the plain error code it fails with. */
  errors: Record<string, string>;
  /** Command name to a promise its answer waits for, so a test can keep a call pending. */
  holds: Record<string, Promise<void>>;
  /** Every `private_*` call, in order, with its arguments. */
  calls: FakePrivateCall[];
  recoveryCode: string;
  newRecoveryCode: string;
  readTopupStatuses: number;
}

const CREDITS_PER_USD = 100;

export function emptyFakePrivate(): FakePrivate {
  return {
    status: {
      device: "none",
      keyReady: false,
      keyError: null,
      balance: null,
      balanceError: null,
      lastBalance: null,
      recoverySaved: false,
      recoveryPrompted: false,
      pendingTopup: null,
    },
    stock: { availableCredits: 100_000, yourRoomCredits: 5_000, packages: [], updatedAt: "2026-11-07T10:00:00Z" },
    models: [],
    topupStatuses: ["created"],
    topupCredits: 0,
    errors: {},
    holds: {},
    calls: [],
    recoveryCode: "ZRV-FAKE-CODE",
    newRecoveryCode: "ZRV-NEW-CODE",
    readTopupStatuses: 0,
  };
}

function fake(): FakePrivate {
  return (window as unknown as { __FAKE_PRIVATE__: FakePrivate }).__FAKE_PRIVATE__;
}

export function resetFakePrivate() {
  (window as unknown as { __FAKE_PRIVATE__: FakePrivate }).__FAKE_PRIVATE__ = emptyFakePrivate();
}

function creditedStatus(state: FakePrivate, credits: number): PrivateStatus {
  const before = state.status.balance?.credits ?? state.status.lastBalance?.credits ?? 0;
  return {
    ...state.status,
    device: "ready",
    keyReady: true,
    keyError: null,
    pendingTopup: null,
    balance: { credits: before + credits, usedCredits: 0, keyReady: true, updatedAt: "2026-11-07T10:05:00Z" },
  };
}

function answer(state: FakePrivate, cmd: string, args: Record<string, unknown> | undefined): unknown {
  switch (cmd) {
    case "private_status":
      return structuredClone(state.status);
    case "private_stock":
      return structuredClone(state.stock);
    case "private_models":
      return structuredClone(state.models);
    case "private_create_topup": {
      const usd = Number(args?.packageUsd);
      const pending: PendingTopup = {
        topupId: `topup-${state.calls.filter((call) => call.cmd === cmd).length}`,
        expiresAt: "2026-11-07T11:00:00Z",
        credits: usd * CREDITS_PER_USD,
      };
      state.status = { ...state.status, device: "ready", pendingTopup: pending };
      return pending;
    }
    case "private_topup_status": {
      const status = state.topupStatuses[Math.min(state.readTopupStatuses++, state.topupStatuses.length - 1)];
      if (status === "credited") {
        const credits = state.topupCredits || state.status.pendingTopup?.credits || 0;
        state.status = creditedStatus(state, credits);
        return { status, credits: state.topupCredits };
      }
      if (status === "failed" || status === "expired") state.status = { ...state.status, pendingTopup: null };
      return { status, credits: state.topupCredits };
    }
    case "private_cancel_topup":
      state.status = { ...state.status, pendingTopup: null };
      return undefined;
    case "private_redeem_promo": {
      const pending: PendingTopup = { topupId: "promo-1", expiresAt: "2026-11-07T10:30:00Z", credits: 500 };
      state.status = { ...state.status, device: "ready", pendingTopup: pending };
      return { topupId: pending.topupId, credits: pending.credits };
    }
    case "private_recovery_code":
      return state.recoveryCode;
    case "private_recover":
      return state.newRecoveryCode;
    default:
      // private_open_checkout, private_mark_recovery, private_forget_device
      return undefined;
  }
}

/** The fake `private_*` commands; null for any other command. */
export function handlePrivateCommand(cmd: string, args: unknown): Promise<unknown> | null {
  if (!cmd.startsWith("private_")) return null;
  const state = fake();
  const callArgs = args as Record<string, unknown> | undefined;
  state.calls.push({ cmd, args: callArgs });
  const run = async (): Promise<unknown> => {
    await state.holds[cmd];
    if (Object.hasOwn(state.errors, cmd)) throw state.errors[cmd];
    if (cmd === "private_mark_recovery") {
      state.status = { ...state.status, recoverySaved: callArgs?.saved === true, recoveryPrompted: true };
    }
    return answer(state, cmd, callArgs);
  };
  return run();
}
