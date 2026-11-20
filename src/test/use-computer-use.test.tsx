import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();
const invoke = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, cb);
    return Promise.resolve(() => listeners.delete(event));
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { useComputerUse } from "../hooks/useComputerUse";
import { COMPUTER_USE_ALLOW, COMPUTER_USE_DENY } from "../lib/computer-use-card";
import type { ChatMessage } from "../types";

const REQUEST = {
  callId: "7",
  sessionId: "s-1",
  kind: "apps",
  reason: "Read your notes.",
  apps: [
    { key: "app-1", name: "Notes", path: "/System/Applications/Notes.app", signer: "Apple", tier: "full", label: "Full use", installed: true },
    { key: "app-2", name: "Zorvo", path: "/Applications/Zorvo.app", signer: "Not signed", tier: "never", label: "Never allowed", installed: true },
  ],
};
const CARD_ID = "computer-use-7";

function rig(state: unknown = { grants: [], requests: [] }, answer: unknown = "echo") {
  const messages: Record<string, ChatMessage[]> = {};
  const onAttention = vi.fn();
  const onNotice = vi.fn();
  invoke.mockImplementation((command: string, args?: { allowed?: string[] }) => {
    if (command === "computer_use_state") return Promise.resolve(state);
    // The backend answers with the keys it granted.
    if (command === "computer_use_answer") return Promise.resolve(answer === "echo" ? args?.allowed : answer);
    return Promise.resolve(undefined);
  });
  const hook = renderHook(() =>
    useComputerUse({
      agentNameOf: () => "Qwen Code",
      updateMessages: (sessionId, update) => {
        messages[sessionId] = update(messages[sessionId] ?? []);
      },
      onAttention,
      onNotice,
    }),
  );
  const emit = (event: string, payload: unknown) => act(() => listeners.get(event)?.({ payload }));
  const cardOf = (sessionId: string) => messages[sessionId]?.find((message) => message.actionCard)?.actionCard;
  return { hook, emit, cardOf, messages, onAttention, onNotice };
}

const ready = () => waitFor(() => expect(listeners.has("computer-use-request")).toBe(true));

afterEach(() => {
  listeners.clear();
  invoke.mockReset();
});

describe("useComputerUse", () => {
  it("shows a card for a request and counts the session as waiting", async () => {
    const { hook, emit, cardOf, onAttention } = rig();
    await ready();
    emit("computer-use-request", REQUEST);

    expect(cardOf("s-1")).toMatchObject({ id: CARD_ID, status: "pending", title: "Qwen Code wants to use apps on your Mac" });
    expect(hook.result.current.isWaiting("s-1")).toBe(true);
    expect(hook.result.current.isWaiting("s-2")).toBe(false);
    expect(onAttention).toHaveBeenCalledWith("s-1", "needs-answer");
  });

  it("shows a request once when it arrives twice", async () => {
    const { emit, messages } = rig();
    await ready();
    emit("computer-use-request", REQUEST);
    emit("computer-use-request", REQUEST);
    expect(messages["s-1"].filter((message) => message.actionCard)).toHaveLength(1);
  });

  it("sends only the ticked keys the user could tick, and settles the card", async () => {
    const { hook, emit, cardOf } = rig();
    await ready();
    emit("computer-use-request", REQUEST);

    let taken = false;
    act(() => {
      taken = hook.result.current.chooseCard("s-1", CARD_ID, COMPUTER_USE_ALLOW, { "app-1": "on", "app-2": "on", "app-9": "on" });
    });

    expect(taken).toBe(true);
    expect(invoke).toHaveBeenCalledWith("computer_use_answer", { callId: "7", allowed: ["app-1"] });
    expect(hook.result.current.isWaiting("s-1")).toBe(false);
    await waitFor(() =>
      expect(cardOf("s-1")).toMatchObject({ status: "approved", computerUse: { allowed: ["Notes"] } }),
    );
    // Answered once: a second answer is not this hook's.
    expect(hook.result.current.chooseCard("s-1", CARD_ID, COMPUTER_USE_ALLOW, { "app-1": "on" })).toBe(false);
  });

  it("answers Deny with no keys", async () => {
    const { hook, emit, cardOf } = rig();
    await ready();
    emit("computer-use-request", REQUEST);
    act(() => void hook.result.current.chooseCard("s-1", CARD_ID, COMPUTER_USE_DENY));

    expect(invoke).toHaveBeenCalledWith("computer_use_answer", { callId: "7", allowed: [] });
    await waitFor(() =>
      expect(cardOf("s-1")).toMatchObject({ status: "rejected", chosenOptionId: COMPUTER_USE_DENY }),
    );
  });

  it("reads Not answered when the call had ended before the answer, whatever was ticked", async () => {
    const { hook, emit, cardOf } = rig(undefined, null);
    await ready();
    emit("computer-use-request", REQUEST);
    act(() => void hook.result.current.chooseCard("s-1", CARD_ID, COMPUTER_USE_ALLOW, { "app-1": "on" }));

    await waitFor(() => expect(cardOf("s-1")?.status).toBe("rejected"));
    expect(cardOf("s-1")?.chosenOptionId).toBeUndefined();
    expect(cardOf("s-1")?.computerUse?.allowed).toBeUndefined();
  });

  it("shows only what the backend granted", async () => {
    const { hook, emit, cardOf } = rig(undefined, []);
    await ready();
    emit("computer-use-request", REQUEST);
    act(() => void hook.result.current.chooseCard("s-1", CARD_ID, COMPUTER_USE_ALLOW, { "app-1": "on" }));

    await waitFor(() => expect(cardOf("s-1")?.status).toBe("rejected"));
    expect(cardOf("s-1")?.chosenOptionId).toBe(COMPUTER_USE_DENY);
  });

  it("leaves another session's card, and any other card, alone", async () => {
    const { hook, emit } = rig();
    await ready();
    emit("computer-use-request", REQUEST);
    expect(hook.result.current.chooseCard("s-2", CARD_ID, COMPUTER_USE_ALLOW, { "app-1": "on" })).toBe(false);
    expect(hook.result.current.chooseCard("s-1", "zorvo-card-1", "zorvo-allow-session")).toBe(false);
    expect(invoke).not.toHaveBeenCalledWith("computer_use_answer", expect.anything());
  });

  it("turns the card to Not answered when the request ends", async () => {
    const { hook, emit, cardOf } = rig();
    await ready();
    emit("computer-use-request", REQUEST);
    emit("computer-use-request-ended", { callId: "7" });

    expect(cardOf("s-1")).toMatchObject({ status: "rejected", chosenOptionId: undefined });
    expect(hook.result.current.isWaiting("s-1")).toBe(false);
  });

  it("reads the grants at start and again when they change, and stops by session id", async () => {
    const granted = { grants: [{ sessionId: "s-1", apps: [{ name: "Notes", tier: "full" }], fullScreen: false }], requests: [] };
    const { hook, emit } = rig(granted);
    await waitFor(() => expect(hook.result.current.grantOf("s-1")?.apps).toEqual([{ name: "Notes", tier: "full" }]));
    expect(hook.result.current.grantOf("s-2")).toBeUndefined();

    invoke.mockImplementation(() => Promise.resolve({ grants: [], requests: [] }));
    emit("computer-use-changed", null);
    await waitFor(() => expect(hook.result.current.grantOf("s-1")).toBeUndefined());

    act(() => hook.result.current.stop("s-1"));
    expect(invoke).toHaveBeenCalledWith("computer_use_revoke", { sessionId: "s-1" });
  });

  it("asks again on a card the transcript settled while its call still waits", async () => {
    const { hook, emit, cardOf, messages } = rig();
    await ready();
    emit("computer-use-request", REQUEST);
    // What a reload leaves: the saved card, settled on load, and no open entry.
    emit("computer-use-request-ended", { callId: "7" });
    expect(cardOf("s-1")?.status).toBe("rejected");

    emit("computer-use-request", REQUEST);
    expect(messages["s-1"].filter((message) => message.actionCard)).toHaveLength(1);
    expect(cardOf("s-1")?.status).toBe("pending");
    expect(hook.result.current.isWaiting("s-1")).toBe(true);
  });

  it("shows the cards that still wait after a reload", async () => {
    const { hook, cardOf } = rig({ grants: [], requests: [REQUEST] });
    await waitFor(() => expect(hook.result.current.isWaiting("s-1")).toBe(true));
    expect(cardOf("s-1")?.id).toBe(CARD_ID);
  });

  it("tells the user when computer use is not set up", async () => {
    const { emit, onNotice } = rig();
    await ready();
    emit("computer-use-notice", { sessionId: "s-1" });
    expect(onNotice).toHaveBeenCalledWith("Computer use is not set up on this Mac. Finish it in Settings, under Agents.");
  });
});
