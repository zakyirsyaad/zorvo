import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSessionRewind, type SessionRewindDeps } from "../hooks/useSessionRewind";
import type { ChatMessage, Session } from "../types";

const session = { id: "s1", name: "S", profileId: "qwen-code", cwd: "/w", status: "running", createdAt: 1, transport: "acp" } as Session;
const transcripts: Record<string, ChatMessage[]> = {
  s1: [{ id: "m1", role: "user", content: "hello", timestamp: 1 } as ChatMessage],
};

function setup(stop: () => Promise<boolean>) {
  const onRewound = vi.fn();
  const deps = {
    agents: [],
    transcripts,
    acp: { info: {}, start: vi.fn(), stop },
    patchSession: vi.fn(),
    updateMessages: vi.fn(),
    onRestore: vi.fn(),
    onGiveBack: vi.fn(),
    onNotice: vi.fn(),
    onRewound,
  } as unknown as SessionRewindDeps;
  const hook = renderHook(() => useSessionRewind(deps));
  return { onRewound, ...hook };
}

describe("useSessionRewind's onRewound", () => {
  it("is told once the rewind is done", () => {
    const { result, onRewound } = setup(() => Promise.resolve(true));
    result.current.rewind(session, "m1");
    expect(onRewound).toHaveBeenCalledWith("s1");
  });

  it("is not told when the rewind fails", () => {
    const { result, onRewound } = setup(() => {
      throw new Error("stop failed");
    });
    expect(() => result.current.rewind(session, "m1")).toThrow("stop failed");
    expect(onRewound).not.toHaveBeenCalled();
  });

  it("is not told when the message is not the user's", () => {
    const { result, onRewound } = setup(() => Promise.resolve(true));
    result.current.rewind(session, "nope");
    expect(onRewound).not.toHaveBeenCalled();
  });
});
