import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDelegation } from "../hooks/useDelegation";
import { useOpenedSessions } from "../hooks/useOpenedSessions";
import { createStartPlaces } from "../lib/start-places";
import type { SessionSpec } from "../lib/session-start";
import type { ChatMessage, Session } from "../types";
import { makeProfile } from "./fixtures/agents";

const CLAUDE = makeProfile({ id: "claude-acp", name: "Claude Code", detected: true });
const CODEX = makeProfile({ id: "codex-acp", name: "Codex", detected: true });
const AGENTS = [CLAUDE, CODEX];

const COORDINATOR: Session = {
  id: "s-a",
  name: "Parser work",
  profileId: "claude-acp",
  cwd: "/Users/test/developer/zorvo",
  status: "idle",
  createdAt: 1,
  transport: "acp",
  worktree: null,
};

const MESSAGES: ChatMessage[] = [
  { id: "m-1", role: "user", content: "Refactor the parser", timestamp: 1 },
  { id: "m-2", role: "agent", content: "Plan: split it in two", timestamp: 2, isComplete: true },
];

afterEach(() => vi.restoreAllMocks());

describe("one set of start places for both ways an agent starts a session", () => {
  it("admits four of five starts, whichever hook they come from, and refuses the fifth", async () => {
    const places = createStartPlaces();
    const starts: SessionSpec[] = [];
    const startSession = (spec: SessionSpec) => {
      starts.push(spec);
    };
    const sessions = [COORDINATOR];
    const hooks = renderHook(() => ({
      opened: useOpenedSessions({
        sessions,
        agents: AGENTS,
        isBusy: () => false,
        isWaiting: () => false,
        places,
        startSession,
      }),
      delegation: useDelegation({
        sessions,
        agents: AGENTS,
        transcripts: { "s-a": MESSAGES },
        isBusy: () => false,
        places,
        canPrompt: () => true,
        isWaiting: () => false,
        send: async () => true,
        startSession,
        selectSession: () => undefined,
        updateLink: () => undefined,
        messagesOf: async () => null,
        giveBack: () => undefined,
        onNotice: () => undefined,
      }),
    }));

    const open = (brief: string) =>
      hooks.result.current.opened.open("s-a", { agentId: "codex-acp", brief, hasOwnWorktree: false });
    const work = (task: string) =>
      hooks.result.current.delegation.startWorker("s-a", { agentId: "codex-acp", task, byAgent: true });

    let results: { ok: boolean; reason?: string }[] = [];
    await act(async () => {
      results = await Promise.all([open("One"), open("Two"), work("Three"), work("Four"), work("Five")]);
    });

    expect(results.filter((result) => result.ok)).toHaveLength(4);
    const refused = results.filter((result) => !result.ok);
    expect(refused).toHaveLength(1);
    expect(refused[0].reason).toBe("4 are running. Start this one when one finishes.");
    expect(starts).toHaveLength(4);
  });
});
