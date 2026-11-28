import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { fakeTauriInvoke } from "./setup";
import { useSessionFork } from "../hooks/useSessionFork";
import { FORK_FIRST_MESSAGE, buildForkPrompt, buildRewindContext } from "../lib/fork-handoff";
import { newSessionRecord, type SessionSpec } from "../lib/session-start";
import { fakeProfiles } from "./fixtures/agents";
import type { FirstMessage } from "../hooks/session-engine/useAcpEngine";
import type { AgentProfile, ChatMessage, Session } from "../types";

const SOURCE: Session = {
  id: "s-1",
  name: "Fix login bug",
  profileId: "qwen-code",
  cwd: "/w",
  status: "terminated",
  createdAt: 1,
  transport: "acp",
};

const MESSAGES = [
  { id: "m-1", role: "user", content: "hi", timestamp: 1 },
  { id: "m-2", role: "agent", content: "stuck", timestamp: 2, isComplete: true },
] as unknown as ChatMessage[];

function renderFork(overrides: { agents?: AgentProfile[] } = {}) {
  const startSession = vi.fn();
  const onNotice = vi.fn();
  const recordSession = vi.fn((spec: SessionSpec) => newSessionRecord(spec));
  const agents =
    overrides.agents ??
    fakeProfiles.map((agent) => (agent.id === "qwen-code" || agent.id === "claude-acp" ? { ...agent, detected: true } : agent));
  const claude = agents.find((agent) => agent.id === "claude-acp") as AgentProfile;
  const { result } = renderHook(() =>
    useSessionFork({
      source: SOURCE,
      agents,
      transcripts: { [SOURCE.id]: MESSAGES },
      acp: { canFork: () => false, fork: vi.fn(() => Promise.resolve(true)) },
      recordSession,
      startSession,
      onNotice,
    }),
  );
  return { result, startSession, onNotice, claude };
}

const firstOf = (startSession: ReturnType<typeof vi.fn>) => startSession.mock.calls[0][1] as FirstMessage;

type TauriInternals = { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
const tauriInternals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("forking to another agent", () => {
  it("firstMessage replaces the shown text and keeps the handoff context", async () => {
    const { result, startSession, claude } = renderFork();

    await act(async () => {
      await result.current("m-2", { agent: claude, firstMessage: { text: "Fix it", attachments: ["/w/a.png"] } });
    });

    const first = firstOf(startSession);
    expect(first.text).toBe("Fix it");
    expect(first.attachments).toEqual(["/w/a.png"]);
    expect(first.context).toContain("/fake/app-data/handoffs/");
  });

  it("without firstMessage the fork starts with FORK_FIRST_MESSAGE", async () => {
    const { result, startSession, claude } = renderFork();

    await act(async () => {
      await result.current("m-2", { agent: claude });
    });

    expect(firstOf(startSession).text).toBe(FORK_FIRST_MESSAGE);
  });

  it("marks the first message continuedFrom only for another agent", async () => {
    const other = renderFork();
    await act(async () => {
      await other.result.current("m-2", { agent: other.claude });
    });
    expect(firstOf(other.startSession).marks?.continuedFrom).toMatchObject({ sessionId: "s-1", agentId: "qwen-code" });

    const same = renderFork();
    await act(async () => {
      await same.result.current("m-1");
    });
    expect(firstOf(same.startSession).marks?.continuedFrom).toBeUndefined();
  });

  it("resolves true once the session is started", async () => {
    const { result, claude } = renderFork();
    let isStarted: boolean | undefined;

    await act(async () => {
      isStarted = await result.current("m-2", { agent: claude });
    });

    expect(isStarted).toBe(true);
  });

  it("resolves false when the handoff cannot be written", async () => {
    vi.spyOn(tauriInternals(), "invoke").mockImplementation((command, args) =>
      command === "write_fork_handoff" ? Promise.reject(new Error("disk full")) : fakeTauriInvoke(command, args),
    );
    const { result, startSession, onNotice, claude } = renderFork();
    let isStarted: boolean | undefined;

    await act(async () => {
      isStarted = await result.current("m-2", { agent: claude });
    });

    expect(isStarted).toBe(false);
    expect(onNotice).toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  it("resolves false when the agent is not installed", async () => {
    const agents = fakeProfiles.map((agent) => (agent.id === "claude-acp" ? { ...agent, detected: false } : agent));
    const { result, startSession, claude } = renderFork({ agents });
    let isStarted: boolean | undefined;

    await act(async () => {
      isStarted = await result.current("m-2", { agent: claude });
    });

    expect(isStarted).toBe(false);
    expect(startSession).not.toHaveBeenCalled();
  });

  it("a typed first message is answered, not met with a ready reply", async () => {
    const { result, startSession, claude } = renderFork();

    await act(async () => {
      await result.current("m-2", { agent: claude, firstMessage: { text: "Fix it" } });
    });

    const first = firstOf(startSession);
    const path = /"([^"]+)"/.exec(first.context ?? "")?.[1] ?? "";
    expect(first.context).toBe(buildRewindContext(path));
  });

  it("the standard continue line keeps the ready-and-wait prompt", async () => {
    const { result, startSession, claude } = renderFork();

    await act(async () => {
      await result.current("m-2", { agent: claude });
    });

    const first = firstOf(startSession);
    const path = /"([^"]+)"/.exec(first.context ?? "")?.[1] ?? "";
    expect(first.context).toBe(buildForkPrompt(path));
  });

  it("the mark names the agent that took the conversation over", async () => {
    const { result, startSession, claude } = renderFork();

    await act(async () => {
      await result.current("m-2", { agent: claude });
    });

    expect(firstOf(startSession).marks?.continuedFrom).toEqual({ sessionId: "s-1", agentId: "qwen-code", toAgentId: "claude-acp" });
  });
});
