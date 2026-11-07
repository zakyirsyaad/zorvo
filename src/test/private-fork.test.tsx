import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSessionFork } from "../hooks/useSessionFork";
import { newSessionRecord, type SessionSpec } from "../lib/session-start";
import { fakeProfiles } from "./fixtures/agents";
import type { ChatMessage, Session } from "../types";

const MODEL_ID = "Qwen/Qwen3.8-27B";

const SOURCE: Session = {
  id: "s-1",
  name: "Private review",
  profileId: "qwen-code",
  cwd: "/w",
  status: "terminated",
  createdAt: 1,
  transport: "acp",
  privateMode: { modelId: MODEL_ID },
};

const MESSAGES = [{ id: "m-1", role: "user", content: "hi", timestamp: 1 } as unknown as ChatMessage];

function renderFork(source: Session, canFork: boolean) {
  const startSession = vi.fn();
  const recordSession = vi.fn((spec: SessionSpec) => newSessionRecord(spec));
  const fork = vi.fn(() => Promise.resolve(true));
  const agents = fakeProfiles.map((agent) => (agent.id === "qwen-code" ? { ...agent, detected: true } : agent));
  const { result } = renderHook(() =>
    useSessionFork({
      source,
      agents,
      transcripts: { [source.id]: MESSAGES },
      acp: { canFork: () => canFork, fork },
      recordSession,
      startSession,
      onNotice: vi.fn(),
    }),
  );
  return { result, startSession, recordSession, fork };
}

describe("forking a private session", () => {
  it("a handoff fork starts a private record on the same model", async () => {
    const { result, startSession } = renderFork(SOURCE, false);

    await act(async () => result.current("m-1"));

    const spec = startSession.mock.calls[0][0] as SessionSpec;
    expect(spec.privateMode).toEqual({ modelId: MODEL_ID });
    expect(newSessionRecord(spec).privateMode).toEqual({ modelId: MODEL_ID });
  });

  it("a native fork records the fork as private too", async () => {
    const { result, recordSession, fork } = renderFork({ ...SOURCE, status: "running" }, true);

    await act(async () => result.current("m-1"));

    expect(fork).toHaveBeenCalledTimes(1);
    expect(recordSession.mock.results[0].value.privateMode).toEqual({ modelId: MODEL_ID });
  });

  it("an ordinary fork has no private mode", async () => {
    const { result, startSession } = renderFork({ ...SOURCE, privateMode: undefined }, false);

    await act(async () => result.current("m-1"));

    const spec = startSession.mock.calls[0][0] as SessionSpec;
    expect(spec).not.toHaveProperty("privateMode");
    expect(newSessionRecord(spec)).not.toHaveProperty("privateMode");
  });
});
