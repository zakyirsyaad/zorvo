import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePrivateVerification } from "../hooks/usePrivateVerification";
import type { VerificationRecord } from "../lib/private-verification";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

const CHECKING: VerificationRecord = { startedAt: 1_100, endedAt: 1_200, state: "checking" };
const VERIFIED: VerificationRecord = {
  ...CHECKING,
  state: "verified",
  kind: "provider_tee",
  signer: "0x1234567890abcdef1234567890abcdef12345678",
};

function mockAnswers(...answers: VerificationRecord[][]) {
  return vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd) => {
    if (cmd !== "private_verify") return Promise.resolve(undefined);
    return Promise.resolve(answers.shift() ?? []);
  });
}

function renderVerification(isKnownSession = vi.fn(() => true), onCheck?: (sessionId: string) => void) {
  const updateMessages = vi.fn();
  const saveSoon = vi.fn();
  const view = renderHook(() =>
    usePrivateVerification({ updateMessages, saveSoon, isKnownSession, onCheck }),
  );
  return { ...view, updateMessages, saveSoon, isKnownSession };
}

async function start(view: ReturnType<typeof renderVerification>) {
  await act(async () => {
    view.result.current.verifyTurn("s-1");
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("usePrivateVerification", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shares its turn-end checks with usage", async () => {
    mockAnswers([VERIFIED], []);
    const onCheck = vi.fn();
    const view = renderVerification(vi.fn(() => true), onCheck);

    await start(view);
    expect(onCheck).toHaveBeenCalledWith("s-1");

    await advance(2_000);
    expect(onCheck).toHaveBeenCalledTimes(2);
  });

  it("re-asks while checking and stops once the answer verifies", async () => {
    const invoke = mockAnswers([CHECKING], [VERIFIED]);
    const view = renderVerification();

    await start(view);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(view.updateMessages).toHaveBeenCalledTimes(1);
    expect(view.saveSoon).toHaveBeenCalledTimes(1);

    await advance(2_000);

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(view.updateMessages).toHaveBeenCalledTimes(2);
    expect(view.saveSoon).toHaveBeenCalledTimes(2);

    await advance(10_000);

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("asks once more two seconds later even when the first answer is final", async () => {
    const invoke = mockAnswers([VERIFIED], []);
    const view = renderVerification();

    await start(view);
    expect(invoke).toHaveBeenCalledTimes(1);

    await advance(2_000);

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("stops after three checking answers", async () => {
    const invoke = mockAnswers([CHECKING], [CHECKING], [CHECKING], [VERIFIED]);
    const view = renderVerification();

    await start(view);
    await advance(2_000);
    expect(invoke).toHaveBeenCalledTimes(2);

    await advance(10_000);
    expect(invoke).toHaveBeenCalledTimes(3);

    await advance(20_000);
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("stops when the session is gone", async () => {
    const invoke = mockAnswers([CHECKING], [VERIFIED]);
    const view = renderVerification();

    await start(view);
    expect(invoke).toHaveBeenCalledTimes(1);
    view.isKnownSession.mockReturnValue(false);

    await advance(2_000);

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("clears its timer when unmounted", async () => {
    const invoke = mockAnswers([CHECKING], [VERIFIED]);
    const view = renderVerification();

    await start(view);
    expect(invoke).toHaveBeenCalledTimes(1);

    act(() => view.unmount());
    await advance(10_000);

    expect(invoke).toHaveBeenCalledTimes(1);
  });
});