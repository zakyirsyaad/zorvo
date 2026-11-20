import { StrictMode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useDelegation } from "../hooks/useDelegation";
import { NO_CHOICES, type AcpChoices } from "../lib/acp-draft";
import { buildDelegatePrompt } from "../lib/delegation";
import { createStartPlaces } from "../lib/start-places";
import { MAX_AT_WORK, withLinkChange } from "../lib/workers";
import { newSessionRecord, type SessionSpec, type StartSessionOptions } from "../lib/session-start";
import type { FirstMessage } from "../hooks/session-engine/useAcpEngine";
import type { AgentProfile, ChatMessage, DelegationLink, PersistedState, Session } from "../types";
import { makeProfile } from "./fixtures/agents";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
type InvokeCall = [string, Record<string, unknown> | undefined];

function internals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

function callsTo(spy: { mock: { calls: unknown[][] } }, cmd: string) {
  return (spy.mock.calls as unknown as InvokeCall[]).filter(([name]) => name === cmd);
}

const CLAUDE = makeProfile({ id: "claude-acp", name: "Claude Code", detected: true });
const CODEX = makeProfile({ id: "codex-acp", name: "Codex", detected: true });
const AGENTS: readonly AgentProfile[] = [CLAUDE, CODEX];

const HANDOFF_TITLE = "# Delegation handoff";
const HANDOFF_NOTE =
  "Another agent's session delegated a task to you and waits for your answer. The task is in the message that follows.";

function sourceSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s-a",
    name: "Parser work",
    profileId: "claude-acp",
    cwd: "/Users/test/developer/zorvo",
    status: "idle",
    createdAt: 1,
    transport: "acp",
    worktree: null,
    ...overrides,
  };
}

function link(overrides: Partial<DelegationLink> = {}): DelegationLink {
  return { sessionId: "s-a", task: "Fix the parser", startedAt: 5, endedAt: null, ...overrides };
}

function delegateSession(overrides: Partial<Session> = {}): Session {
  return sourceSession({
    id: "s-b",
    name: "Codex: Fix the parser",
    profileId: "codex-acp",
    createdAt: 10,
    delegatedFrom: link(),
    ...overrides,
  });
}

const A_MESSAGES: ChatMessage[] = [
  { id: "m-a1", role: "user", content: "Refactor the parser", timestamp: 1 },
  { id: "m-a2", role: "agent", content: "Plan: split it in two", timestamp: 2, isComplete: true },
];

function agentMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m-b2",
    role: "agent",
    content: "Done. Tests pass.",
    timestamp: 200,
    isComplete: true,
    ...overrides,
  };
}

function bMessages(answer: ChatMessage = agentMessage()): ChatMessage[] {
  return [
    { id: "m-b1", role: "user", content: "Fix the parser", timestamp: 100 },
    answer,
  ];
}

interface SendCall {
  sessionId: string;
  text: string;
  attachments: readonly string[];
  marks?: Pick<ChatMessage, "delegationReport" | "delegationTask" | "workerReport">;
}

interface StartCall {
  spec: SessionSpec;
  first?: FirstMessage;
  options?: StartSessionOptions;
}

interface HarnessInput {
  sessions: readonly Session[];
  transcripts?: Readonly<Record<string, ChatMessage[]>>;
  agents?: readonly AgentProfile[];
  busy?: readonly string[];
  waiting?: readonly string[];
  cannotPrompt?: readonly string[];
  sendResult?: boolean;
  strict?: boolean;
  messagesOf?: (sessionId: string) => Promise<ChatMessage[] | null>;
  giveBackThrows?: boolean;
}

function setup(input: HarnessInput) {
  const sends: SendCall[] = [];
  const givesBack: Array<{ sessionId: string; text: string }> = [];
  const starts: StartCall[] = [];
  const selections: string[] = [];
  const patches: Array<{ sessionId: string; patch: Partial<Session> }> = [];
  const notices: string[] = [];
  const busy = new Set(input.busy ?? []);
  const waiting = new Set(input.waiting ?? []);
  const cannotPrompt = new Set(input.cannotPrompt ?? []);
  const sendResult = input.sendResult ?? true;
  const places = createStartPlaces();
  const giveBackAttempts = { count: 0 };
  // What the state holds now: changes made in one tick compose, as the app's functional updater does.
  const owned: { current: readonly Session[] } = { current: input.sessions };

  const hook = renderHook(
    () => {
      const [sessions, setSessions] = useState<readonly Session[]>(input.sessions);
      owned.current = sessions;
      const [transcripts, setTranscripts] = useState<Readonly<Record<string, ChatMessage[]>>>(
        input.transcripts ?? {},
      );
      const delegation = useDelegation({
        sessions,
        agents: input.agents ?? AGENTS,
        transcripts,
        isBusy: (sessionId) => busy.has(sessionId),
        places,
        canPrompt: (sessionId) => !cannotPrompt.has(sessionId),
        isWaiting: (sessionId) => waiting.has(sessionId),
        send: async (sessionId, text, attachments = [], marks) => {
          sends.push({ sessionId, text, attachments, marks });
          return sendResult;
        },
        startSession: (spec, first, options) => {
          starts.push({ spec, first, options });
        },
        selectSession: (sessionId) => {
          selections.push(sessionId);
        },
        messagesOf: input.messagesOf ?? (async () => null),
        updateLink: (sessionId, change) => {
          const next = withLinkChange({ sessions: owned.current } as unknown as PersistedState, sessionId, change)
            .sessions as readonly Session[];
          if (next === owned.current) return;
          owned.current = next;
          const delegatedFrom = next.find((s) => s.id === sessionId)?.delegatedFrom;
          patches.push({ sessionId, patch: { delegatedFrom } });
          setSessions(next);
        },
        giveBack: (sessionId, text) => {
          if (input.giveBackThrows) {
            giveBackAttempts.count += 1;
            throw new Error("/secret/path");
          }
          givesBack.push({ sessionId, text });
        },
        onNotice: (message) => {
          notices.push(message);
        },
      });
      return { delegation, sessions, transcripts, setSessions, setTranscripts };
    },
    input.strict ? { wrapper: StrictMode } : undefined,
  );

  return {
    ...hook,
    sends,
    givesBack,
    starts,
    selections,
    patches,
    notices,
    busy,
    waiting,
    cannotPrompt,
    places,
    giveBackAttempts,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** A worker's turn ends: what is owed to its coordinator is read from the link this writes. */
async function settle(
  env: ReturnType<typeof setup>,
  id: string,
  end: { how: "finished" | "failed" | "cancelled" | "exited"; reason?: string } = { how: "finished" },
) {
  await act(async () => {
    env.result.current.delegation.onTurnSettled(id, end);
  });
}

describe("useDelegation start", () => {
  it("start writes the handoff and starts B linked to A in A's folder", async () => {
    const env = setup({ sessions: [sourceSession()], transcripts: { "s-a": A_MESSAGES } });
    const invokeSpy = vi.spyOn(internals(), "invoke");
    let isStarted = false;

    await act(async () => {
      isStarted = await env.result.current.delegation.start("s-a", "codex-acp", "Fix the parser");
    });

    expect(isStarted).toBe(true);
    const handoffs = callsTo(invokeSpy, "write_fork_handoff");
    expect(handoffs).toHaveLength(1);
    const [, handoffArgs] = handoffs[0];
    const handoffId = String(handoffArgs?.handoffId);
    const content = String(handoffArgs?.content);
    expect(content.startsWith(`${HANDOFF_TITLE}\n${HANDOFF_NOTE}`)).toBe(true);
    expect(content).toContain("### User");
    expect(content).toContain("Refactor the parser");
    expect(content).toContain("Plan: split it in two");
    expect(content).toContain("- Source session: Parser work");
    expect(content).toContain("- Agent: Claude Code");
    expect(content).toContain("- Folder: /Users/test/developer/zorvo");
    expect(content).not.toContain("# Session handoff");

    expect(env.starts).toHaveLength(1);
    const { spec, first, options } = env.starts[0];
    expect(spec).toMatchObject({
      id: handoffId,
      agent: { id: "codex-acp" },
      cwd: "/Users/test/developer/zorvo",
      worktree: null,
      name: "Codex: Fix the parser",
      delegatedFrom: {
        sessionId: "s-a",
        task: "Fix the parser",
        startedAt: expect.any(Number),
      },
    });
    expect(first).toEqual({
      text: "Fix the parser",
      context: buildDelegatePrompt(`/fake/app-data/handoffs/${handoffId}.md`),
    });
    expect(options).toEqual({ choices: NO_CHOICES });
    expect(env.selections).toEqual([handoffId]);
    expect(env.notices).toEqual([]);
  });

  it("start refuses while A is busy", async () => {
    const env = setup({
      sessions: [sourceSession()],
      transcripts: { "s-a": A_MESSAGES },
      busy: ["s-a"],
    });
    const invokeSpy = vi.spyOn(internals(), "invoke");
    let isStarted = true;

    await act(async () => {
      isStarted = await env.result.current.delegation.start("s-a", "codex-acp", "Fix the parser");
    });

    expect(isStarted).toBe(false);
    expect(callsTo(invokeSpy, "write_fork_handoff")).toHaveLength(0);
    expect(env.starts).toHaveLength(0);
    expect(env.notices).toEqual(["Could not delegate. Wait for Claude Code to finish."]);
  });

  it("start reports a failed handoff write", async () => {
    const env = setup({ sessions: [sourceSession()], transcripts: { "s-a": A_MESSAGES } });
    const realInvoke = internals().invoke;
    vi.spyOn(internals(), "invoke").mockImplementation((cmd, args) =>
      cmd === "write_fork_handoff" ? Promise.reject(new Error("disk full")) : realInvoke(cmd, args),
    );
    let isStarted = true;

    await act(async () => {
      isStarted = await env.result.current.delegation.start("s-a", "codex-acp", "Fix the parser");
    });

    expect(isStarted).toBe(false);
    expect(env.starts).toHaveLength(0);
    expect(env.notices).toEqual(["Could not delegate. Error: disk full"]);
  });

  it("start passes the dialog's choices to B's start", async () => {
    const choices: AcpChoices = { modeId: "plan", modelId: "gpt-5.5-codex", config: { effort: "high" } };
    const env = setup({ sessions: [sourceSession()], transcripts: { "s-a": A_MESSAGES } });

    await act(async () => {
      await env.result.current.delegation.start("s-a", "codex-acp", "Fix the parser", { choices });
    });

    expect(env.starts[0].options).toEqual({ choices });
  });

  it("start passes the attachments to B's first message", async () => {
    const attachments = ["/Users/test/developer/zorvo/a.ts", "/tmp/b.png"];
    const env = setup({ sessions: [sourceSession()], transcripts: { "s-a": A_MESSAGES } });

    await act(async () => {
      await env.result.current.delegation.start("s-a", "codex-acp", "Fix the parser", { attachments });
    });

    expect(env.starts[0].first?.attachments).toEqual(attachments);
    expect(env.starts[0].first?.text).toBe("Fix the parser");
  });
});

describe("useDelegation giveTask", () => {
  const STREAMING: ChatMessage[] = [
    ...A_MESSAGES,
    { id: "m-a3", role: "user", content: "Now have Codex fix it", timestamp: 3 },
    { id: "m-a4", role: "agent", content: "UNFINISHED-REPLY calling the tool", timestamp: 4 },
  ];

  it("starts a delegate from a busy source when its own agent asked", async () => {
    const spy = vi.spyOn(internals(), "invoke");
    const env = setup({
      sessions: [sourceSession()],
      transcripts: { "s-a": STREAMING },
      busy: ["s-a"],
      cannotPrompt: ["s-a"],
    });

    let result: unknown;
    await act(async () => {
      result = await env.result.current.delegation.giveTask("s-a", "codex-acp", "Fix the parser", { byAgent: true });
    });

    expect(result).toMatchObject({ ok: true, kind: "started", sessionName: "Codex: Fix the parser" });
    expect(env.starts).toHaveLength(1);
    expect(env.starts[0].spec.delegatedFrom).toMatchObject({ sessionId: "s-a", task: "Fix the parser" });
    // The user stays where they are: the agent started it, not them.
    expect(env.starts[0].options?.focus).toBe(false);
    expect(env.selections).toHaveLength(0);
    // The reply that holds the tool call is still streaming: it is not part of the handoff.
    const [, args] = callsTo(spy, "write_fork_handoff")[0];
    expect(String(args?.content)).toContain("Now have Codex fix it");
    expect(String(args?.content)).not.toContain("UNFINISHED-REPLY");
  });

  it("refuses a busy source when the user asked", async () => {
    const env = setup({ sessions: [sourceSession()], transcripts: { "s-a": A_MESSAGES }, busy: ["s-a"] });

    let result: unknown;
    await act(async () => {
      result = await env.result.current.delegation.giveTask("s-a", "codex-acp", "Fix the parser");
    });

    expect(result).toEqual({ ok: false, reason: "Wait for Claude Code to finish." });
    expect(env.starts).toHaveLength(0);
  });

  it("sends a further task to an idle delegate and marks who gave it", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
    });

    let result: unknown;
    await act(async () => {
      result = await env.result.current.delegation.giveTask("s-a", "codex-acp", "Now add tests", { byAgent: true });
    });

    expect(result).toEqual({ ok: true, kind: "sent", sessionId: "s-b", sessionName: "Codex: Fix the parser" });
    expect(env.starts).toHaveLength(0);
    expect(env.sends).toEqual([
      {
        sessionId: "s-b",
        text: "Now add tests",
        attachments: [],
        marks: { delegationTask: { agentName: "Claude Code", agentId: "claude-acp" } },
      },
    ]);
    // The next report quotes the task it answers.
    expect(env.patches).toEqual([
      { sessionId: "s-b", patch: { delegatedFrom: expect.objectContaining({ task: "Now add tests", startedAt: 5 }) } },
    ]);
  });

  it("makes the next report quote the further task", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
    });

    await act(async () => {
      await env.result.current.delegation.giveTask("s-a", "codex-acp", "Now add tests", { byAgent: true });
    });
    env.sends.length = 0;
    await settle(env, "s-b");

    await waitFor(() => expect(env.sends).toHaveLength(1));
    expect(env.sends[0].text).toContain('(Codex), "Now add tests"');
  });

  it("refuses a further task while the delegate works, and when it does not take it", async () => {
    const working = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
      busy: ["s-b"],
    });
    let result: unknown;
    await act(async () => {
      result = await working.result.current.delegation.giveTask("s-a", "codex-acp", "Now add tests", { byAgent: true });
    });
    expect(result).toEqual({ ok: false, reason: "Codex is still working on the previous task." });
    expect(working.sends).toHaveLength(0);

    const refusing = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
      sendResult: false,
    });
    await act(async () => {
      result = await refusing.result.current.delegation.giveTask("s-a", "codex-acp", "Now add tests", { byAgent: true });
    });
    expect(result).toEqual({ ok: false, reason: "Codex did not take the task." });
    expect(refusing.givesBack).toHaveLength(0);
    expect(refusing.patches).toHaveLength(0);
  });

  it("starts a second delegate for another agent", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
      busy: ["s-b"],
    });

    let result: unknown;
    await act(async () => {
      result = await env.result.current.delegation.giveTask("s-a", "claude-acp", "Check the docs", { byAgent: true });
    });

    expect(result).toMatchObject({ ok: true, kind: "started" });
    expect(env.starts[0].spec.agent.id).toBe("claude-acp");
  });

  it("start still selects the session and reports a refusal as a notice", async () => {
    const env = setup({ sessions: [sourceSession()], transcripts: { "s-a": A_MESSAGES } });
    await act(async () => {
      expect(await env.result.current.delegation.start("s-a", "codex-acp", "Fix the parser")).toBe(true);
    });
    expect(env.selections).toHaveLength(1);

    const busy = setup({ sessions: [sourceSession()], transcripts: { "s-a": A_MESSAGES }, busy: ["s-a"] });
    await act(async () => {
      expect(await busy.result.current.delegation.start("s-a", "codex-acp", "Fix the parser")).toBe(false);
    });
    expect(busy.notices).toEqual(["Could not delegate. Wait for Claude Code to finish."]);
  });
});

describe("useDelegation giveTask under pressure", () => {
  it("starts two workers when two tasks for the same agent arrive in the same tick", async () => {
    const env = setup({ sessions: [sourceSession()], transcripts: { "s-a": A_MESSAGES } });

    let results: unknown[] = [];
    await act(async () => {
      results = await Promise.all([
        env.result.current.delegation.giveTask("s-a", "codex-acp", "Fix the parser", { byAgent: true }),
        env.result.current.delegation.giveTask("s-a", "codex-acp", "Fix the lexer", { byAgent: true }),
      ]);
    });

    expect(env.starts).toHaveLength(2);
    expect(results[0]).toMatchObject({ ok: true, kind: "started" });
    expect(results[1]).toMatchObject({ ok: true, kind: "started" });
    expect(env.starts.map((start) => start.spec.delegatedFrom?.handle)).toEqual(["worker-1", "worker-2"]);
  });

  it("still starts a delegate for another agent in the same tick", async () => {
    const env = setup({ sessions: [sourceSession()], transcripts: { "s-a": A_MESSAGES } });

    await act(async () => {
      await Promise.all([
        env.result.current.delegation.giveTask("s-a", "codex-acp", "Fix the parser", { byAgent: true }),
        env.result.current.delegation.giveTask("s-a", "claude-acp", "Check the docs", { byAgent: true }),
      ]);
    });

    expect(env.starts.map((start) => start.spec.agent.id)).toEqual(["codex-acp", "claude-acp"]);
  });

  it("lets the agent be asked again when the start failed", async () => {
    vi.spyOn(internals(), "invoke").mockImplementationOnce(() => Promise.reject(new Error("disk full at /secret/path")));
    const env = setup({ sessions: [sourceSession()], transcripts: { "s-a": A_MESSAGES } });

    let first: unknown;
    let second: unknown;
    await act(async () => {
      first = await env.result.current.delegation.giveTask("s-a", "codex-acp", "Fix the parser", { byAgent: true });
    });
    await act(async () => {
      second = await env.result.current.delegation.giveTask("s-a", "codex-acp", "Fix the parser", { byAgent: true });
    });

    // The cause stays with Zorvo: it could hold a path, and the caller may be an agent.
    expect(first).toMatchObject({ ok: false, reason: "The task could not be handed over.", isInternal: true });
    expect(second).toMatchObject({ ok: true, kind: "started" });
  });

  it("refuses a further task while the delegate's last report has not reached the source", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
      busy: ["s-a"],
      cannotPrompt: ["s-a"],
    });
    await settle(env, "s-b");
    await act(async () => {});

    let result: unknown;
    await act(async () => {
      result = await env.result.current.delegation.giveTask("s-a", "codex-acp", "Now add tests", { byAgent: true });
    });

    expect(result).toEqual({
      ok: false,
      reason: "Codex's last answer has not reached this session yet. Give it the next task after its report arrives.",
    });
    // Nothing was sent to the delegate, so its answer is still the last message when the report goes out.
    expect(env.sends).toHaveLength(0);

    await act(async () => {
      env.busy.delete("s-a");
      env.cannotPrompt.delete("s-a");
      env.result.current.setTranscripts((prev) => ({ ...prev, "s-a": [...(prev["s-a"] ?? [])] }));
    });
    await waitFor(() => expect(env.sends).toHaveLength(1));
    expect(env.sends[0].text).toContain("> Done. Tests pass.");
  });

  it("sends one further task when two for the same idle delegate arrive in the same tick", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
    });

    let results: unknown[] = [];
    await act(async () => {
      results = await Promise.all([
        env.result.current.delegation.giveTask("s-a", "codex-acp", "Now add tests", { byAgent: true }),
        env.result.current.delegation.giveTask("s-a", "codex-acp", "And update the docs", { byAgent: true }),
      ]);
    });

    expect(env.sends.map((send) => send.text)).toEqual(["Now add tests"]);
    expect(results[0]).toMatchObject({ ok: true, kind: "sent" });
    expect(results[1]).toEqual({ ok: false, reason: "Codex is still working on the previous task." });

    // Once the delegate's turn is over it takes the next task again.
    await act(async () => {
      env.result.current.delegation.onTurnEnded("s-b", "failed");
    });
    let third: unknown;
    await act(async () => {
      third = await env.result.current.delegation.giveTask("s-a", "codex-acp", "And update the docs", { byAgent: true });
    });
    expect(third).toMatchObject({ ok: true, kind: "sent" });
  });

  it("frees the delegate when the further task was not taken", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
      sendResult: false,
    });
    let first: unknown;
    let second: unknown;
    await act(async () => {
      first = await env.result.current.delegation.giveTask("s-a", "codex-acp", "Now add tests", { byAgent: true });
    });
    await act(async () => {
      second = await env.result.current.delegation.giveTask("s-a", "codex-acp", "Now add tests", { byAgent: true });
    });
    expect(first).toEqual({ ok: false, reason: "Codex did not take the task." });
    expect(second).toEqual({ ok: false, reason: "Codex did not take the task." });
  });

  it("ends the link of a delegate whose session has ended and starts a new one", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession({ status: "terminated" })],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
    });

    let result: unknown;
    await act(async () => {
      result = await env.result.current.delegation.giveTask("s-a", "codex-acp", "Now add tests", { byAgent: true });
    });

    expect(result).toMatchObject({ ok: true, kind: "started" });
    expect(env.sends).toHaveLength(0);
    expect(env.patches[0]).toEqual({
      sessionId: "s-b",
      patch: { delegatedFrom: expect.objectContaining({ endedAt: expect.any(Number) }) },
    });
    expect(env.starts).toHaveLength(1);
    expect(env.starts[0].spec.delegatedFrom).toMatchObject({ sessionId: "s-a", task: "Now add tests" });
  });
});

const WORKTREE = { path: "/wt/a", cwd: "/wt/a", branch: "agent/a", startCommit: "abc" };

function withWorktreeMock(handler: (cmd: string) => Promise<unknown> | undefined) {
  const real = internals().invoke.bind(internals());
  return vi.spyOn(internals(), "invoke").mockImplementation((cmd, args) => handler(cmd) ?? real(cmd, args));
}

function worker(handle: string, id: string, overrides: Partial<Session> = {}): Session {
  return delegateSession({ id, delegatedFrom: link({ handle }), ...overrides });
}

describe("useDelegation workers", () => {
  const base = () => ({ sessions: [sourceSession()], transcripts: { "s-a": A_MESSAGES } });

  it("two workers of one agent start in one tick with two handles", async () => {
    const { result, starts } = setup(base());
    const [first, second] = await act(async () =>
      Promise.all([
        result.current.delegation.startWorker("s-a", { agentId: "codex-acp", task: "Part one", byAgent: true }),
        result.current.delegation.startWorker("s-a", { agentId: "codex-acp", task: "Part two", byAgent: true }),
      ]),
    );
    expect([first, second].map((r) => r.ok && r.handle)).toEqual(["worker-1", "worker-2"]);
    expect(starts).toHaveLength(2);
    expect(starts[0].spec.delegatedFrom?.handle).toBe("worker-1");
  });

  it("a worker with its own worktree starts in it", async () => {
    withWorktreeMock((cmd) => (cmd === "create_session_worktree" ? Promise.resolve(WORKTREE) : undefined));
    const { result, starts } = setup(base());
    const r = await act(async () =>
      result.current.delegation.startWorker("s-a", {
        agentId: "codex-acp",
        task: "Part one",
        hasOwnWorktree: true,
        byAgent: true,
      }),
    );
    expect(r).toMatchObject({ ok: true, folder: "/wt/a" });
    expect(starts[0].spec.worktree?.branch).toBe("agent/a");
    expect(starts[0].spec.cwd).toBe("/wt/a");
  });

  it("tells a worker with its own worktree where it works, and a worker without one nothing of the kind", async () => {
    const spy = withWorktreeMock((cmd) => (cmd === "create_session_worktree" ? Promise.resolve(WORKTREE) : undefined));
    const { result, starts } = setup(base());
    await act(async () =>
      result.current.delegation.startWorker("s-a", {
        agentId: "codex-acp",
        task: "Part one",
        hasOwnWorktree: true,
        byAgent: true,
      }),
    );
    const own = String(callsTo(spy, "write_fork_handoff")[0][1]?.content);
    const worktree = starts[0].spec.worktree;
    expect(own).toContain("- Folder: /wt/a");
    expect(own).not.toContain("- Folder: /Users/test/developer/zorvo");
    expect(own).toContain(
      `You work in /wt/a, a worktree of ${worktree?.repoPath}. Make your changes there, not in the folder of the session that gave you this task.`,
    );

    spy.mockClear();
    await act(async () =>
      result.current.delegation.startWorker("s-a", { agentId: "codex-acp", task: "Part two", byAgent: true }),
    );
    const shared = String(callsTo(spy, "write_fork_handoff")[0][1]?.content);
    expect(shared).toContain("- Folder: /Users/test/developer/zorvo");
    expect(shared).not.toContain("You work in");
  });

  it("names the worktree and the session by the title when given", async () => {
    const spy = withWorktreeMock((cmd) => (cmd === "create_session_worktree" ? Promise.resolve(WORKTREE) : undefined));
    const { result, starts } = setup(base());
    await act(async () =>
      result.current.delegation.startWorker("s-a", {
        agentId: "codex-acp",
        task: "Part one",
        title: "Lexer",
        hasOwnWorktree: true,
        byAgent: true,
      }),
    );
    expect(callsTo(spy, "create_session_worktree")[0][1]).toMatchObject({ title: "Lexer" });
    expect(starts[0].spec.name).toBe("Codex: Lexer");
  });

  it("a worktree that cannot be made starts nothing and frees its place", async () => {
    withWorktreeMock((cmd) =>
      cmd === "create_session_worktree" ? Promise.reject(new Error("fatal: /Users/x is locked")) : undefined,
    );
    const { result, starts, places } = setup(base());
    const r = await act(async () =>
      result.current.delegation.startWorker("s-a", {
        agentId: "codex-acp",
        task: "Part one",
        hasOwnWorktree: true,
        byAgent: true,
      }),
    );
    expect(r).toEqual({
      ok: false,
      reason: "A worktree could not be made for this worker.",
      isInternal: true,
      detail: expect.stringContaining("locked"),
    });
    expect(starts).toHaveLength(0);
    expect(places.underWay("s-a")).toBe(0);
  });

  it("a call that ended while git worked starts nothing and removes the worktree", async () => {
    const { result, starts, places } = setup(base());
    let isCancelled = false;
    const spy = withWorktreeMock((cmd) => {
      if (cmd !== "create_session_worktree") return undefined;
      isCancelled = true;
      return Promise.resolve(WORKTREE);
    });
    const r = await act(async () =>
      result.current.delegation.startWorker("s-a", {
        agentId: "codex-acp",
        task: "Part one",
        hasOwnWorktree: true,
        byAgent: true,
        isCancelled: () => isCancelled,
      }),
    );
    expect(r).toEqual({ ok: false, reason: "" });
    expect(starts).toHaveLength(0);
    expect(places.underWay("s-a")).toBe(0);
    expect(callsTo(spy, "remove_session_worktree")[0][1]).toEqual({
      repoPath: "/Users/test/developer/zorvo",
      path: "/wt/a",
    });
  });

  it("the fifth start is refused", async () => {
    const workers = ["w1", "w2", "w3", "w4"].map((id, index) => worker(`worker-${index + 1}`, id));
    const { result, starts } = setup({
      sessions: [sourceSession(), ...workers],
      transcripts: { "s-a": A_MESSAGES },
      busy: ["w1", "w2", "w3", "w4"],
    });
    const r = await act(async () =>
      result.current.delegation.startWorker("s-a", { agentId: "codex-acp", task: "One more", byAgent: true }),
    );
    expect(r).toEqual({ ok: false, reason: "4 are running. Start this one when one finishes." });
    expect(starts).toHaveLength(0);
  });

  it("never issues an ended worker's handle again", async () => {
    const { result, starts } = setup(base());
    const start = () =>
      act(async () => result.current.delegation.startWorker("s-a", { agentId: "codex-acp", task: "T", byAgent: true }));
    await start();
    await start();
    expect(starts.map((entry) => entry.spec.delegatedFrom?.handle)).toEqual(["worker-1", "worker-2"]);
    await act(async () => {
      result.current.setSessions((prev) => [
        ...prev,
        ...starts.map((entry, index) =>
          sourceSession({
            id: entry.spec.id,
            profileId: "codex-acp",
            createdAt: 10 + index,
            delegatedFrom: index === 1 ? { ...entry.spec.delegatedFrom!, endedAt: 99 } : entry.spec.delegatedFrom,
          }),
        ),
      ]);
    });
    await start();
    expect(starts).toHaveLength(3);
    expect(starts[2].spec.delegatedFrom?.handle).toBe("worker-3");
  });

  it("still reports a start that was recorded when selecting the session throws", async () => {
    const env = setup(base());
    const { result, starts, places } = env;
    // selectSession is the harness's own recorder: make the next call throw through the hook's deps.
    env.selections.push = () => {
      throw new Error("boom");
    };
    const r = await act(async () => result.current.delegation.startWorker("s-a", { agentId: "codex-acp", task: "T" }));
    expect(r).toMatchObject({ ok: true });
    expect(starts).toHaveLength(1);
    expect(places.underWay("s-a")).toBe(1);
    expect(env.notices).toEqual(["The worker started but could not be opened: Error: boom"]);
  });

  it("starts nothing when the coordinator is removed while the worktree is made", async () => {
    const env = setup(base());
    const spy = withWorktreeMock((cmd) => {
      if (cmd !== "create_session_worktree") return undefined;
      act(() => env.result.current.setSessions([]));
      return Promise.resolve(WORKTREE);
    });
    // Not wrapped in act: the mock's own state change must commit while the worktree is made.
    const running = env.result.current.delegation.startWorker("s-a", {
      agentId: "codex-acp",
      task: "Part one",
      hasOwnWorktree: true,
      byAgent: true,
    });
    const r = await act(async () => running);
    expect(r).toEqual({ ok: false, reason: "" });
    expect(env.starts).toHaveLength(0);
    expect(env.places.underWay("s-a")).toBe(0);
    expect(callsTo(spy, "remove_session_worktree")).toHaveLength(1);
  });

  it("starts nothing and removes the worktree when the call ends during the handoff write", async () => {
    let isCancelled = false;
    const spy = withWorktreeMock((cmd) => {
      if (cmd === "create_session_worktree") return Promise.resolve(WORKTREE);
      if (cmd !== "write_fork_handoff") return undefined;
      isCancelled = true;
      return Promise.resolve("/fake/handoff.md");
    });
    const { result, starts, places } = setup(base());
    const r = await act(async () =>
      result.current.delegation.startWorker("s-a", {
        agentId: "codex-acp",
        task: "Part one",
        hasOwnWorktree: true,
        byAgent: true,
        isCancelled: () => isCancelled,
      }),
    );
    expect(r).toEqual({ ok: false, reason: "" });
    expect(starts).toHaveLength(0);
    expect(places.underWay("s-a")).toBe(0);
    expect(callsTo(spy, "remove_session_worktree")).toHaveLength(1);
  });

  it("builds the handoff from the conversation as it is after the worktree is made", async () => {
    const env = setup(base());
    const spy = withWorktreeMock((cmd) => {
      if (cmd !== "create_session_worktree") return undefined;
      act(() =>
        env.result.current.setTranscripts({
          "s-a": [...A_MESSAGES, { id: "m-a3", role: "user", content: "LATE-MESSAGE", timestamp: 3 }],
        }),
      );
      return Promise.resolve(WORKTREE);
    });
    const running = env.result.current.delegation.startWorker("s-a", {
      agentId: "codex-acp",
      task: "T",
      hasOwnWorktree: true,
    });
    await act(async () => {
      await running;
    });
    expect(String(callsTo(spy, "write_fork_handoff")[0][1]?.content)).toContain("LATE-MESSAGE");
  });

  it("frees the place when startSession throws", async () => {
    const { result, starts, places } = setup(base());
    const original = starts.push.bind(starts);
    let failures = MAX_AT_WORK;
    starts.push = (...items) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("no start");
      }
      return original(...items);
    };
    for (let index = 0; index < MAX_AT_WORK; index += 1) {
      const r = await act(async () =>
        result.current.delegation.startWorker("s-a", { agentId: "codex-acp", task: "T", byAgent: true }),
      );
      expect(r).toMatchObject({ ok: false, reason: "The task could not be handed over.", isInternal: true });
    }
    expect(places.underWay("s-a")).toBe(0);
    const next = await act(async () =>
      result.current.delegation.startWorker("s-a", { agentId: "codex-acp", task: "T", byAgent: true }),
    );
    expect(next.ok).toBe(true);
  });

  it("admits four of five starts in one tick", async () => {
    const { result, starts } = setup(base());
    const results = await act(async () =>
      Promise.all(
        [1, 2, 3, 4, 5].map((n) =>
          result.current.delegation.startWorker("s-a", { agentId: "codex-acp", task: `T${n}`, byAgent: true }),
        ),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(4);
    expect(results[4]).toEqual({ ok: false, reason: "4 are running. Start this one when one finishes." });
    expect(starts).toHaveLength(4);
  });

  it("makes the worktree from the repository of a coordinator that works in one", async () => {
    const spy = withWorktreeMock((cmd) => (cmd === "create_session_worktree" ? Promise.resolve(WORKTREE) : undefined));
    const { result } = setup({
      sessions: [
        sourceSession({
          cwd: "/wt/source",
          worktree: { repoPath: "/repo/main", path: "/wt/source", branch: "agent/s", startCommit: "c0" },
        }),
      ],
      transcripts: { "s-a": A_MESSAGES },
    });
    await act(async () => {
      await result.current.delegation.startWorker("s-a", { agentId: "codex-acp", task: "T", hasOwnWorktree: true });
    });
    // From the coordinator's own branch: what it committed there is in the worker's worktree.
    expect(callsTo(spy, "create_session_worktree")[0][1]).toMatchObject({ repoPath: "/repo/main", baseBranch: "agent/s" });
  });

  it("makes the worktree from the folder's HEAD for a coordinator outside a worktree", async () => {
    const spy = withWorktreeMock((cmd) => (cmd === "create_session_worktree" ? Promise.resolve(WORKTREE) : undefined));
    const { result } = setup(base());
    await act(async () => {
      await result.current.delegation.startWorker("s-a", { agentId: "codex-acp", task: "T", hasOwnWorktree: true });
    });
    expect(callsTo(spy, "create_session_worktree")[0][1]).not.toHaveProperty("baseBranch");
  });

  it("removes the worktree it made when the handoff cannot be written", async () => {
    const spy = withWorktreeMock((cmd) => {
      if (cmd === "create_session_worktree") return Promise.resolve(WORKTREE);
      if (cmd === "write_fork_handoff") return Promise.reject(new Error("disk full"));
      if (cmd === "remove_session_worktree") return Promise.resolve(null);
      return undefined;
    });
    const { result, starts, places } = setup(base());
    const r = await act(async () =>
      result.current.delegation.startWorker("s-a", { agentId: "codex-acp", task: "T", hasOwnWorktree: true, byAgent: true }),
    );
    expect(r).toMatchObject({ ok: false, reason: "The task could not be handed over.", isInternal: true });
    expect(starts).toHaveLength(0);
    expect(places.underWay("s-a")).toBe(0);
    expect(callsTo(spy, "remove_session_worktree")).toHaveLength(1);
    expect(callsTo(spy, "remove_session_worktree")[0][1]).toEqual({ repoPath: sourceSession().cwd, path: WORKTREE.path });
  });

  it("frees the place when the handoff cannot be written", async () => {
    withWorktreeMock((cmd) => (cmd === "write_fork_handoff" ? Promise.reject(new Error("disk full")) : undefined));
    const { result, places } = setup(base());
    const r = await act(async () =>
      result.current.delegation.startWorker("s-a", { agentId: "codex-acp", task: "Part one", byAgent: true }),
    );
    expect(r).toMatchObject({ ok: false, reason: "The task could not be handed over.", isInternal: true });
    expect(places.underWay("s-a")).toBe(0);
  });

  it("frees the place once the new session is listed", async () => {
    const { result, starts, places } = setup(base());
    await act(async () => {
      await result.current.delegation.startWorker("s-a", { agentId: "codex-acp", task: "Part one", byAgent: true });
    });
    expect(places.underWay("s-a")).toBe(1);
    await act(async () => {
      const spec = starts[0].spec;
      result.current.setSessions((prev) => [
        ...prev,
        sourceSession({ id: spec.id, profileId: "codex-acp", createdAt: 10, delegatedFrom: spec.delegatedFrom }),
      ]);
    });
    expect(places.underWay("s-a")).toBe(0);
  });

  it("a further task goes to the worker and replaces its task and outcome", async () => {
    const w = worker("worker-1", "s-b", {
      delegatedFrom: link({ handle: "worker-1", outcome: { result: "succeeded", at: 50 } }),
    });
    const { result, patches, sends } = setup({
      sessions: [sourceSession(), w],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
    });
    const r = await act(async () =>
      result.current.delegation.sendToWorker("s-a", "s-b", "Also fix the tests"),
    );
    expect(r).toMatchObject({ ok: true, kind: "sent" });
    expect(sends[0].text).toBe("Also fix the tests");
    expect(patches.at(-1)).toEqual({
      sessionId: "s-b",
      patch: { delegatedFrom: expect.objectContaining({ task: "Also fix the tests", outcome: null, handle: "worker-1" }) },
    });
  });

  it("a worker in a turn refuses a further task", async () => {
    const { result } = setup({
      sessions: [sourceSession(), worker("worker-1", "s-b")],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
      busy: ["s-b"],
    });
    expect(await act(async () => result.current.delegation.sendToWorker("s-a", "s-b", "x"))).toEqual({
      ok: false,
      reason: "worker-1 is still working. Send this when it reports.",
    });
  });

  it("refuses a session that is not an open worker of the coordinator", async () => {
    const { result } = setup({
      sessions: [sourceSession(), worker("worker-1", "s-b")],
      transcripts: { "s-a": A_MESSAGES },
    });
    expect(await act(async () => result.current.delegation.sendToWorker("s-a", "s-zzz", "x"))).toEqual({
      ok: false,
      reason: "No session with that handle. Use list_agents to see yours.",
    });
  });

  it("a terminated worker ends its link and is told to start a new one", async () => {
    const { result, patches } = setup({
      sessions: [sourceSession(), worker("worker-1", "s-b", { status: "terminated" })],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
    });
    expect(await act(async () => result.current.delegation.sendToWorker("s-a", "s-b", "x"))).toEqual({
      ok: false,
      reason: "worker-1 can't take more work. Start a new worker.",
    });
    expect(patches[0].patch.delegatedFrom?.endedAt).toEqual(expect.any(Number));
  });

  it("a mention with two workers of that agent starts a third", async () => {
    const { result, starts } = setup({
      sessions: [sourceSession(), worker("worker-1", "w1"), worker("worker-2", "w2")],
      transcripts: { "s-a": A_MESSAGES },
    });
    const r = await act(async () => result.current.delegation.giveTask("s-a", "codex-acp", "Third", { byAgent: true }));
    expect(r).toMatchObject({ ok: true, kind: "started" });
    expect(starts[0].spec.delegatedFrom?.handle).toBe("worker-3");
  });
});

describe("useDelegation reports", () => {
  it("sends one marked report when B's turn finishes", async () => {
    const answer = agentMessage({
      tools: [
        { id: "t-1", name: "Edit", status: "completed", kind: "edit", locations: ["src/parser.ts"] },
        {
          id: "t-2",
          name: "Edit",
          status: "completed",
          kind: "edit",
          locations: ["/Users/test/developer/zorvo/src/a.ts"],
        },
        { id: "t-3", name: "Edit", status: "completed", kind: "edit", locations: ["/tmp/b.ts"] },
      ],
    });
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages(answer) },
      strict: true,
    });

    await settle(env, "s-b");

    await waitFor(() => expect(env.sends).toHaveLength(1));
    const [report] = env.sends;
    expect(report.sessionId).toBe("s-a");
    expect(report.text).toContain('(Codex), "Fix the parser": ended its turn without reporting. Its last answer:\n> Done. Tests pass.');
    // A tool's path inside the worker's folder is relative to it; one outside is left alone.
    expect(report.text).toContain("Files: src/parser.ts, src/a.ts, /tmp/b.ts");
    expect(report.attachments).toEqual([]);
    expect(report.marks).toEqual({
      workerReport: {
        workers: [{ agentName: "Codex", agentId: "codex-acp", handle: "codex-acp", state: "did-not-report" }],
      },
    });
    expect(env.givesBack).toHaveLength(0);
    expect(env.notices).toHaveLength(0);
    expect(env.result.current.delegation.viewFor("s-a")).toMatchObject({
      state: "reported",
      reportedAt: expect.any(Number),
    });
  });

  it("reports a turn that stopped on an error", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
    });

    await settle(env, "s-b", { how: "failed", reason: "It needs a sign-in." });

    await waitFor(() => expect(env.sends).toHaveLength(1));
    expect(env.sends[0].text).toContain("stopped on an error.\nIts error:\n> It needs a sign-in.");
    expect(env.notices).toHaveLength(0);
    expect(env.result.current.delegation.viewFor("s-a")).toMatchObject({ state: "failed", reportedAt: null });
  });

  it("reports a finished turn that wrote no answer, with the files it changed", async () => {
    const toolsOnly = agentMessage({
      content: "",
      tools: [{ id: "t-1", name: "Edit", status: "completed", kind: "edit", locations: ["src/a.ts"] }],
    });
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages(toolsOnly) },
    });

    await settle(env, "s-b");
    await act(async () => {});

    // The agent that delegated was told a report would arrive: it hears that the task ended.
    expect(env.sends).toHaveLength(1);
    expect(env.sends[0].text).toContain("ended its turn without reporting, and left no written answer.");
    expect(env.sends[0].text).toContain("Files: src/a.ts");
    expect(env.sends[0].text).not.toContain("\n> ");
  });

  it("reports a turn whose last reply is not whole without quoting it", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages(agentMessage({ content: "Still wri", isComplete: false })) },
    });
    await settle(env, "s-b");
    await act(async () => {});
    expect(env.sends).toHaveLength(1);
    expect(env.sends[0].text).toContain("left no written answer.");
    expect(env.sends[0].text).not.toContain("Still wri");
  });

  it("puts the report in A's composer with a notice when A cannot take a prompt", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
      cannotPrompt: ["s-a"],
    });

    await settle(env, "s-b");
    await act(async () => {});

    expect(env.sends).toHaveLength(0);
    expect(env.givesBack).toHaveLength(1);
    expect(env.givesBack[0].sessionId).toBe("s-a");
    expect(env.givesBack[0].text).toContain("(Codex)");
    expect(env.notices).toEqual(["Codex's report is in the composer of Parser work."]);
    // The report was delivered to A's composer, so A's line must not keep saying it is working.
    expect(env.result.current.delegation.viewFor("s-a")).toMatchObject({
      state: "reported",
      reportedAt: expect.any(Number),
    });
  });

  it("puts the report in A's composer when A's agent refuses the prompt", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
      sendResult: false,
    });

    await settle(env, "s-b");
    await act(async () => {});

    expect(env.sends).toHaveLength(1);
    expect(env.givesBack).toHaveLength(1);
    expect(env.givesBack[0].sessionId).toBe("s-a");
    expect(env.givesBack[0].text).toContain("(Codex)");
    expect(env.notices).toEqual(["Codex's report is in the composer of Parser work."]);
    expect(env.result.current.delegation.sendBlockedReason("s-b")).toBeNull();
    // Refused or not, the report reached A's composer: A's line reads delivered.
    expect(env.result.current.delegation.viewFor("s-a")).toMatchObject({
      state: "reported",
      reportedAt: expect.any(Number),
    });
  });

  it("sends nothing when the source is gone", async () => {
    const env = setup({
      sessions: [delegateSession()],
      transcripts: { "s-b": bMessages() },
    });

    await settle(env, "s-b");
    await act(async () => {});

    expect(env.sends).toHaveLength(0);
    expect(env.givesBack).toHaveLength(0);
    expect(env.notices).toHaveLength(0);
    expect(env.result.current.delegation.viewFor("s-b")).toMatchObject({
      role: "delegate",
      otherSessionId: null,
      state: "source-gone",
    });
    expect(env.result.current.delegation.sendBlockedReason("s-b")).toBeNull();
  });

  it("sends nothing after End delegation", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
    });

    act(() => {
      env.result.current.delegation.end("s-b");
    });
    await settle(env, "s-b");
    await act(async () => {});

    expect(env.sends).toHaveLength(0);
    expect(env.givesBack).toHaveLength(0);
    expect(env.patches).toHaveLength(1);
    expect(env.patches[0].patch.delegatedFrom).toMatchObject({
      sessionId: "s-a",
      task: "Fix the parser",
      endedAt: expect.any(Number),
    });
    expect(env.result.current.delegation.viewFor("s-a")).toBeNull();
  });

  it("sends nothing for a delegate that was archived", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession({ archivedAt: 20 })],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
    });

    await settle(env, "s-b");
    await act(async () => {});

    expect(env.sends).toHaveLength(0);
    expect(env.givesBack).toHaveLength(0);
    expect(env.notices).toHaveLength(0);
    // An archived delegate is not open: A has no line and may delegate again.
    expect(env.result.current.delegation.viewFor("s-a")).toBeNull();
  });

  it("refuses B's send while its report is owed", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
      busy: ["s-a"],
    });

    await settle(env, "s-b");
    await act(async () => {});

    expect(env.result.current.delegation.sendBlockedReason("s-b")).toBe(
      "Codex's report waits for Claude Code to finish.",
    );
  });

  it("does not hold A's send while B's report is owed", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
      busy: ["s-a"],
    });

    await settle(env, "s-b");
    await act(async () => {});

    // A message that takes A's turn only delays the report: it waits, it is not lost.
    expect(env.result.current.delegation.sendBlockedReason("s-a")).toBeNull();
  });

  it("does not blame B's report for a turn the user started in A", () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
      busy: ["s-a"],
    });

    expect(env.result.current.delegation.sendBlockedReason("s-b")).toBe("Wait for Claude Code to finish.");
  });
});

describe("useDelegation reports that wait", () => {
  const CLAUDE_DELEGATE = () =>
    delegateSession({ id: "s-c", name: "Claude Code: Check the docs", profileId: "claude-acp", createdAt: 20, delegatedFrom: link({ task: "Check the docs" }) });

  const finish = async (env: ReturnType<typeof setup>, delegateId: string) => {
    await settle(env, delegateId);
    await act(async () => {});
  };

  /** The source's turn ended: it can be prompted again, and its transcript changed. */
  const endSourceTurn = async (env: ReturnType<typeof setup>) => {
    await act(async () => {
      env.busy.delete("s-a");
      env.waiting.delete("s-a");
      env.cannotPrompt.delete("s-a");
      env.result.current.setTranscripts((prev) => ({ ...prev, "s-a": [...(prev["s-a"] ?? [])] }));
    });
    await act(async () => {});
  };

  it("holds a report while the source is in a turn and sends it when the turn ends", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
      busy: ["s-a"],
      cannotPrompt: ["s-a"],
    });

    await finish(env, "s-b");
    expect(env.sends).toHaveLength(0);
    expect(env.givesBack).toHaveLength(0);
    expect(env.notices).toHaveLength(0);

    await endSourceTurn(env);
    await waitFor(() => expect(env.sends).toHaveLength(1));
    expect(env.sends[0].sessionId).toBe("s-a");
    expect(env.sends[0].text).toContain("(Codex)");
    expect(env.givesBack).toHaveLength(0);
  });

  it("holds a report while the source waits on a permission card", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
      waiting: ["s-a"],
      cannotPrompt: ["s-a"],
    });

    await finish(env, "s-b");
    expect(env.sends).toHaveLength(0);
    expect(env.givesBack).toHaveLength(0);

    await endSourceTurn(env);
    await waitFor(() => expect(env.sends).toHaveLength(1));
  });

  it("sends two workers' reports in one message, oldest first", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession(), CLAUDE_DELEGATE()],
      transcripts: {
        "s-a": A_MESSAGES,
        "s-b": bMessages(),
        "s-c": bMessages(agentMessage({ id: "m-c2", content: "Docs are fine." })),
      },
      busy: ["s-a"],
      cannotPrompt: ["s-a"],
    });

    await finish(env, "s-b");
    await finish(env, "s-c");
    expect(env.sends).toHaveLength(0);

    await endSourceTurn(env);
    await waitFor(() => expect(env.sends).toHaveLength(1));
    const { text } = env.sends[0];
    expect(text.indexOf("(Codex)")).toBeGreaterThan(-1);
    expect(text.indexOf("(Codex)")).toBeLessThan(text.indexOf("(Claude Code)"));
    expect(env.givesBack).toHaveLength(0);
    await act(async () => {});
    expect(env.sends).toHaveLength(1);
  });

  it("gives the report back when the source runs but cannot be prompted", async () => {
    const env = setup({
      sessions: [sourceSession({ status: "running" }), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
      cannotPrompt: ["s-a"],
    });

    await finish(env, "s-b");
    expect(env.sends).toHaveLength(0);
    expect(env.givesBack).toHaveLength(1);
  });

  it("blocks Send in the delegate while its report is queued, and not in the source", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
      busy: ["s-a"],
      cannotPrompt: ["s-a"],
    });

    await finish(env, "s-b");
    expect(env.result.current.delegation.sendBlockedReason("s-b")).toBe(
      "Codex's report waits for Claude Code to finish.",
    );
    expect(env.result.current.delegation.sendBlockedReason("s-a")).toBeNull();
  });

  it("drops a queued report when the delegation ends", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
      busy: ["s-a"],
      cannotPrompt: ["s-a"],
    });

    await finish(env, "s-b");
    await act(async () => {
      env.result.current.delegation.end("s-b");
    });
    await endSourceTurn(env);

    expect(env.sends).toHaveLength(0);
    expect(env.givesBack).toHaveLength(0);
    expect(env.result.current.delegation.sendBlockedReason("s-b")).toBeNull();
  });

  it("lists one line per open delegate for the source, oldest first", () => {
    const env = setup({
      sessions: [sourceSession(), CLAUDE_DELEGATE(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages(), "s-c": bMessages() },
      busy: ["s-b", "s-c"],
    });

    const views = env.result.current.delegation.viewsFor("s-a");
    expect(views.map((view) => [view.otherSessionId, view.agentName, view.state])).toEqual([
      ["s-b", "Codex", "working"],
      ["s-c", "Claude Code", "working"],
    ]);
    expect(env.result.current.delegation.viewsFor("s-b")).toHaveLength(1);
    expect(env.result.current.delegation.viewsFor("s-b")[0].role).toBe("delegate");
  });
});

describe("useDelegation views", () => {
  it("view states follow reports and failures", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
      busy: ["s-b"],
    });

    expect(env.result.current.delegation.viewFor("s-a")).toMatchObject({
      state: "working",
      workingSince: 100,
    });

    env.busy.delete("s-b");
    // Between turns, with no turn ended yet, the delegate has nothing to report.
    expect(env.result.current.delegation.viewFor("s-a")).toBeNull();

    await settle(env, "s-b", { how: "failed", reason: "Boom" });
    await waitFor(() => expect(env.sends).toHaveLength(1));
    expect(env.result.current.delegation.viewFor("s-a")).toMatchObject({
      state: "failed",
      reportedAt: null,
    });

    env.waiting.add("s-b");
    expect(env.result.current.delegation.viewFor("s-a")).toMatchObject({
      state: "needs-answer",
      workingSince: null,
    });
  });

  it("A has no working line once the delegate is not running", () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession({ status: "terminated" })],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
    });

    expect(env.result.current.delegation.viewFor("s-a")).toBeNull();
  });

  it("after End delegation A has no view and B reads ended", () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
    });

    act(() => {
      env.result.current.delegation.end("s-b");
    });

    expect(env.result.current.delegation.viewFor("s-a")).toBeNull();
    expect(env.result.current.delegation.viewFor("s-b")).toMatchObject({
      role: "delegate",
      otherSessionId: "s-a",
      otherName: "Parser work",
      agentName: "Claude Code",
      task: "Fix the parser",
      state: "ended",
      workingSince: null,
    });
  });

  it("B reads source-working while A works on its report", () => {
    const report: ChatMessage = {
      id: "m-a-report",
      role: "user",
      content: "Report from Codex on the task you delegated: \"Fix the parser\"",
      timestamp: 777,
      delegationReport: { agentName: "Codex", agentId: "codex-acp" },
    };
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": [...A_MESSAGES, report], "s-b": bMessages() },
      busy: ["s-a"],
    });

    expect(env.result.current.delegation.viewFor("s-b")).toMatchObject({
      role: "delegate",
      otherSessionId: "s-a",
      otherName: "Parser work",
      agentName: "Claude Code",
      state: "source-working",
      workingSince: 777,
    });
  });

  it("A reads needs-answer while B waits on a permission", () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
      busy: ["s-b"],
      waiting: ["s-b"],
    });

    expect(env.result.current.delegation.viewFor("s-a")).toMatchObject({
      role: "source",
      otherSessionId: "s-b",
      otherName: "Codex: Fix the parser",
      agentName: "Codex",
      task: "Fix the parser",
      state: "needs-answer",
      workingSince: null,
    });
  });
});

describe("newSessionRecord with a delegation", () => {
  it("copies the spec's delegation link onto the record", () => {
    const delegation = link();

    const record = newSessionRecord(
      { agent: CODEX, cwd: "/Users/test/developer/zorvo", name: "Codex: Fix it", delegatedFrom: delegation },
      1,
    );

    expect(record.delegatedFrom).toEqual(delegation);
  });

  it("copies the spec's openedBy onto the record, and leaves it off otherwise", () => {
    const opened = newSessionRecord(
      { agent: CODEX, cwd: "/Users/test/developer/zorvo", name: "Codex: Port it", openedBy: { sessionId: "s-a", at: 5 } },
      1,
    );
    expect(opened.openedBy).toEqual({ sessionId: "s-a", at: 5 });

    const plain = newSessionRecord({ agent: CODEX, cwd: "/Users/test/developer/zorvo", name: "Plain" }, 1);
    expect(plain).not.toHaveProperty("openedBy");
  });
});
describe("useDelegation further tasks and the limit", () => {
  const LIMIT_SENTENCE = "4 are running. Start this one when one finishes.";
  const fiveWorkers = () => ["w1", "w2", "w3", "w4", "w5"].map((id, index) => worker(`worker-${index + 1}`, id));
  const withWorkers = (atWork: readonly string[], overrides: Partial<HarnessInput> = {}) =>
    setup({
      sessions: [sourceSession(), ...fiveWorkers()],
      transcripts: { "s-a": A_MESSAGES },
      busy: atWork,
      ...overrides,
    });

  it("refuses a further task when four others are at work", async () => {
    const { result, sends } = withWorkers(["w1", "w2", "w3", "w4"]);
    const r = await act(async () => result.current.delegation.sendToWorker("s-a", "w5", "More"));
    expect(r).toEqual({ ok: false, reason: LIMIT_SENTENCE });
    expect(sends).toHaveLength(0);
  });

  it("sends a further task when three others are at work", async () => {
    const { result, sends } = withWorkers(["w1", "w2", "w3"]);
    const r = await act(async () => result.current.delegation.sendToWorker("s-a", "w5", "More"));
    expect(r).toMatchObject({ ok: true, kind: "sent" });
    expect(sends).toHaveLength(1);
  });

  it("applies the limit to a mention's further task too", async () => {
    const { result, sends } = setup({
      sessions: [sourceSession(), worker("worker-1", "w1"), ...["w2", "w3", "w4", "w5"].map((id, i) => sourceSession({ id, createdAt: 20 + i, openedBy: { sessionId: "s-a", at: 1 } }))],
      transcripts: { "s-a": A_MESSAGES },
      busy: ["w2", "w3", "w4", "w5"],
    });
    const r = await act(async () => result.current.delegation.giveTask("s-a", "codex-acp", "More", { byAgent: true }));
    expect(r).toEqual({ ok: false, reason: LIMIT_SENTENCE });
    expect(sends).toHaveLength(0);
  });

  it("admits one of two further tasks for two idle workers in one tick while three others work", async () => {
    const { result, sends } = withWorkers(["w1", "w2", "w3"]);
    const [first, second] = await act(async () =>
      Promise.all([
        result.current.delegation.sendToWorker("s-a", "w4", "One"),
        result.current.delegation.sendToWorker("s-a", "w5", "Two"),
      ]),
    );
    expect(first).toMatchObject({ ok: true });
    expect(second).toEqual({ ok: false, reason: LIMIT_SENTENCE });
    expect(sends.map((entry) => entry.sessionId)).toEqual(["w4"]);
  });

  it("frees the place when the worker's turn ends", async () => {
    const { result, sends, places } = withWorkers(["w1", "w2", "w3"]);
    await act(async () => {
      await result.current.delegation.sendToWorker("s-a", "w4", "One");
    });
    expect(places.underWay("s-a")).toBe(1);
    expect(await act(async () => result.current.delegation.sendToWorker("s-a", "w5", "Two"))).toEqual({
      ok: false,
      reason: LIMIT_SENTENCE,
    });
    await act(async () => result.current.delegation.onTurnEnded("w4", "finished"));
    expect(places.underWay("s-a")).toBe(0);
    expect(await act(async () => result.current.delegation.sendToWorker("s-a", "w5", "Two"))).toMatchObject({ ok: true });
    expect(sends.map((entry) => entry.sessionId)).toEqual(["w4", "w5"]);
  });

  it("frees the place when the agent does not take the task", async () => {
    const { result, places } = withWorkers([], { sendResult: false });
    const r = await act(async () => result.current.delegation.sendToWorker("s-a", "w5", "More"));
    expect(r).toMatchObject({ ok: false });
    expect(places.underWay("s-a")).toBe(0);
  });

  it("frees the place once the worker is seen busy", async () => {
    const { result, places, busy } = withWorkers([]);
    await act(async () => {
      await result.current.delegation.sendToWorker("s-a", "w5", "More");
    });
    expect(places.underWay("s-a")).toBe(1);
    busy.add("w5");
    await act(async () => result.current.setSessions((prev) => [...prev]));
    expect(places.underWay("s-a")).toBe(0);
  });
});

describe("useDelegation handles after a restart", () => {
  const startOne = (hook: ReturnType<typeof setup>) =>
    act(async () => hook.result.current.delegation.startWorker("s-a", { agentId: "codex-acp", task: "T", byAgent: true }));

  it("does not reissue the handle of a worker whose link ended", async () => {
    const hook = setup({
      sessions: [
        sourceSession(),
        worker("worker-1", "w1"),
        worker("worker-2", "w2", { delegatedFrom: link({ handle: "worker-2", endedAt: 99 }) }),
      ],
      transcripts: { "s-a": A_MESSAGES },
    });
    expect(await startOne(hook)).toMatchObject({ ok: true, handle: "worker-3" });
  });

  it("does not reissue the handle of an archived worker", async () => {
    const hook = setup({
      sessions: [sourceSession(), worker("worker-1", "w1"), worker("worker-2", "w2", { archivedAt: 50 })],
      transcripts: { "s-a": A_MESSAGES },
    });
    expect(await startOne(hook)).toMatchObject({ ok: true, handle: "worker-3" });
  });
});

describe("useDelegation reports name their worker", () => {
  it("words and marks a new worker's report with its handle", async () => {
    const env = setup({
      sessions: [sourceSession(), worker("worker-2", "s-b")],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
      strict: true,
    });
    await settle(env, "s-b");
    await waitFor(() => expect(env.sends).toHaveLength(1));
    expect(env.sends[0].text).toContain('worker-2 (Codex), "Fix the parser"');
    expect(env.sends[0].marks).toEqual({
      workerReport: {
        workers: [{ agentName: "Codex", agentId: "codex-acp", handle: "worker-2", state: "did-not-report" }],
      },
    });
  });

  it("names an older link's worker by its agent", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
      strict: true,
    });
    await settle(env, "s-b");
    await waitFor(() => expect(env.sends).toHaveLength(1));
    expect(env.sends[0].text).toContain('codex-acp (Codex), "Fix the parser"');
    expect(env.sends[0].marks?.delegationReport).toBeUndefined();
  });

  const twoWorkers = (mark: NonNullable<ChatMessage["delegationReport"]>) =>
    setup({
      sessions: [sourceSession(), worker("worker-1", "w1"), worker("worker-2", "w2")],
      transcripts: {
        "s-a": [
          ...A_MESSAGES,
          { id: "m-a3", role: "user", content: "Report", timestamp: 3, delegationReport: mark },
        ],
      },
      busy: ["s-a"],
    });

  it("blocks only the worker whose report the coordinator reads", () => {
    const env = twoWorkers({ agentName: "Codex", agentId: "codex-acp", handle: "worker-1" });
    expect(env.result.current.delegation.sendBlockedReason("w1")).toBe("Claude Code is working on Codex's report.");
    expect(env.result.current.delegation.sendBlockedReason("w2")).toBe("Wait for Claude Code to finish.");
    expect(env.result.current.delegation.viewFor("w1")?.state).toBe("source-working");
    expect(env.result.current.delegation.viewFor("w2")?.state).not.toBe("source-working");
  });

  it("matches by agent for a report that names no worker", () => {
    const env = twoWorkers({ agentName: "Codex", agentId: "codex-acp" });
    expect(env.result.current.delegation.sendBlockedReason("w2")).toBe("Claude Code is working on Codex's report.");
  });
});

describe("useDelegation recordDone", () => {
  const worker2 = () => delegateSession({ id: "w-1", delegatedFrom: link({ handle: "worker-1" }) });
  const base = () => ({ sessions: [sourceSession(), worker2()] });
  const lastOutcome = (patches: Array<{ sessionId: string; patch: Partial<Session> }>) =>
    patches.at(-1)?.patch.delegatedFrom?.outcome;

  it("writes the outcome on the worker's link", () => {
    const { result, patches } = setup(base());
    let ok = false;
    act(() => {
      ok = result.current.delegation.recordDone("w-1", { result: "succeeded", summary: " Fixed it ", files: ["a.ts"] });
    });
    expect(ok).toBe(true);
    expect(patches).toHaveLength(1);
    expect(lastOutcome(patches)).toMatchObject({ result: "succeeded", summary: "Fixed it", files: ["a.ts"] });
  });

  it("a second done replaces the first", () => {
    const { result, patches } = setup(base());
    act(() => {
      result.current.delegation.recordDone("w-1", { result: "succeeded", summary: "One" });
    });
    act(() => {
      result.current.delegation.recordDone("w-1", { result: "failed", summary: "Two" });
    });
    expect(lastOutcome(patches)).toMatchObject({ result: "failed", summary: "Two" });
  });

  it("writes nothing and returns false for an ended link, an archived or a missing session", () => {
    const ended = delegateSession({ id: "w-1", delegatedFrom: link({ endedAt: 9 }) });
    const archived = delegateSession({ id: "w-2", archivedAt: 5, delegatedFrom: link({ handle: "worker-2" }) });
    const { result, patches } = setup({ sessions: [sourceSession(), ended, archived] });
    let results: boolean[] = [];
    act(() => {
      results = [
        result.current.delegation.recordDone("w-1", { result: "failed", summary: "x" }),
        result.current.delegation.recordDone("w-2", { result: "failed", summary: "x" }),
        result.current.delegation.recordDone("nope", { result: "failed", summary: "x" }),
      ];
    });
    expect(results).toEqual([false, false, false]);
    expect(patches).toEqual([]);
  });

  it("answers false when the summary is empty once cleaned", () => {
    const { result, patches } = setup(base());
    let ok = true;
    act(() => {
      ok = result.current.delegation.recordDone("w-1", { result: "failed", summary: " \n " });
    });
    expect(ok).toBe(false);
    expect(patches).toEqual([]);
  });

  it("End worker followed by done in one tick leaves the link ended with no outcome", () => {
    const env = setup(base());
    act(() => {
      env.result.current.delegation.end("w-1");
      env.result.current.delegation.recordDone("w-1", { result: "succeeded", summary: "late" });
    });
    const final = env.result.current.sessions.find((s) => s.id === "w-1")?.delegatedFrom;
    expect(final?.endedAt).toEqual(expect.any(Number));
    expect(final?.outcome ?? null).toBeNull();
  });

  it("two done calls in one tick leave the second outcome", () => {
    const env = setup(base());
    act(() => {
      env.result.current.delegation.recordDone("w-1", { result: "succeeded", summary: "One" });
      env.result.current.delegation.recordDone("w-1", { result: "failed", summary: "Two" });
    });
    const final = env.result.current.sessions.find((s) => s.id === "w-1")?.delegatedFrom;
    expect(final?.outcome).toMatchObject({ result: "failed", summary: "Two" });
  });

  it("done in the same tick as a further task keeps both the task and the outcome", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession({ id: "w-1", delegatedFrom: link({ handle: "worker-1" }) })],
      transcripts: { "s-a": [{ id: "m1", role: "user", content: "Do it" } as ChatMessage] },
    });
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    await act(async () => {
      const sent = env.result.current.delegation.sendToWorker("s-a", "w-1", "Next task");
      // A done is strictly after the task went out, as it is in real time.
      now.mockReturnValue(1_001);
      env.result.current.delegation.recordDone("w-1", { result: "succeeded", summary: "Fine" });
      await sent;
    });
    const final = env.result.current.sessions.find((s) => s.id === "w-1")?.delegatedFrom;
    expect(final?.task).toBe("Next task");
    expect(final?.outcome).toMatchObject({ summary: "Fine" });
  });

  it("is recorded even when the worker's turn is not running", () => {
    const { result, patches } = setup(base());
    act(() => {
      result.current.delegation.recordDone("w-1", { result: "failed", summary: "late" });
    });
    expect(lastOutcome(patches)).toMatchObject({ result: "failed" });
  });

  it("keeps a whole emoji when the cut falls inside one", () => {
    const { result, patches } = setup(base());
    act(() => {
      result.current.delegation.recordDone("w-1", { result: "succeeded", summary: "a".repeat(1999) + "\u{1F600}\u{1F600}" });
    });
    const summary = lastOutcome(patches)?.summary ?? "";
    expect([...summary]).toHaveLength(2000);
    expect([...summary].at(-1)).toBe("\u{1F600}");
  });

  it("stores a bidi control character raw", () => {
    const { result, patches } = setup(base());
    act(() => {
      result.current.delegation.recordDone("w-1", { result: "succeeded", summary: "x\u202Ey" });
    });
    const summary = lastOutcome(patches)?.summary ?? "";
    expect(summary).toBe("x\u202Ey");
  });

  it("cuts 60 files to 50, drops empty ones and omits an empty list", () => {
    const { result, patches } = setup(base());
    act(() => {
      result.current.delegation.recordDone("w-1", {
        result: "succeeded",
        summary: "s",
        files: Array.from({ length: 60 }, (_, i) => `f${i}.ts`),
      });
    });
    expect(lastOutcome(patches)?.files).toHaveLength(50);
    act(() => {
      result.current.delegation.recordDone("w-1", { result: "succeeded", summary: "s", files: [] });
    });
    expect(lastOutcome(patches)).not.toHaveProperty("files");
    act(() => {
      result.current.delegation.recordDone("w-1", { result: "succeeded", summary: "s", files: ["  ", ""] });
    });
    expect(lastOutcome(patches)).not.toHaveProperty("files");
  });
});

describe("useDelegation onTurnSettled", () => {
  const worker = () => delegateSession({ id: "w-1", delegatedFrom: link({ handle: "worker-1" }) });
  const base = () => ({ sessions: [sourceSession(), worker()] });
  const lastLink = (patches: Array<{ sessionId: string; patch: Partial<Session> }>) =>
    patches.at(-1)?.patch.delegatedFrom;

  it("writes each end on the worker's link", () => {
    const { result, patches } = setup(base());
    act(() => result.current.delegation.onTurnSettled("w-1", { how: "cancelled" }));
    expect(lastLink(patches)?.lastTurn).toMatchObject({ how: "cancelled" });
  });

  it("writes an exit as exited and keeps the link open", () => {
    const { result, patches } = setup(base());
    act(() => result.current.delegation.onTurnSettled("w-1", { how: "exited" }));
    expect(lastLink(patches)?.lastTurn).toMatchObject({ how: "exited" });
    expect(lastLink(patches)?.endedAt).toBeNull();
  });

  it("keeps the reason of a failed turn", () => {
    const { result, patches } = setup(base());
    act(() => result.current.delegation.onTurnSettled("w-1", { how: "failed", reason: "It needs a sign-in." }));
    expect(lastLink(patches)?.lastTurn).toMatchObject({ how: "failed", reason: "It needs a sign-in." });
  });

  it("writes nothing for a coordinator, an ended link, an archived or a missing session", () => {
    const ended = delegateSession({ id: "w-2", delegatedFrom: link({ endedAt: 9 }) });
    const archived = delegateSession({ id: "w-3", archivedAt: 5, delegatedFrom: link({ handle: "worker-3" }) });
    const { result, patches } = setup({ sessions: [sourceSession(), ended, archived] });
    act(() => {
      for (const id of ["s-a", "w-2", "w-3", "nope"]) {
        result.current.delegation.onTurnSettled(id, { how: "finished" });
      }
    });
    expect(patches).toEqual([]);
  });

  it("a done recorded just before a finished end keeps its outcome", () => {
    const { result, patches } = setup(base());
    act(() => {
      result.current.delegation.recordDone("w-1", { result: "succeeded", summary: "Fixed" });
      result.current.delegation.onTurnSettled("w-1", { how: "finished" });
    });
    expect(lastLink(patches)?.outcome).toMatchObject({ result: "succeeded", summary: "Fixed" });
    expect(lastLink(patches)?.lastTurn?.how).toBe("finished");
  });

  it("a done, a finished end and nothing more keeps the outcome", () => {
    const { result, patches } = setup(base());
    act(() => {
      result.current.delegation.recordDone("w-1", { result: "succeeded", summary: "Fixed" });
    });
    act(() => {
      result.current.delegation.onTurnSettled("w-1", { how: "finished" });
    });
    expect(lastLink(patches)?.outcome).toMatchObject({ summary: "Fixed" });
    expect(lastLink(patches)?.lastTurn?.how).toBe("finished");
  });

  it("a done followed by a cancelled end leaves no outcome", () => {
    const { result, patches } = setup(base());
    act(() => {
      result.current.delegation.recordDone("w-1", { result: "succeeded", summary: "Fixed" });
      result.current.delegation.onTurnSettled("w-1", { how: "cancelled" });
    });
    expect(lastLink(patches)?.outcome).toBeNull();
    expect(lastLink(patches)?.lastTurn?.how).toBe("cancelled");
  });
});

describe("useDelegation owed reports", () => {
  const owedWorker = (id: string, n: number, extra: Partial<DelegationLink> = {}) =>
    delegateSession({
      id,
      name: `Codex: ${id}`,
      createdAt: 10 + n,
      delegatedFrom: link({
        handle: `worker-${n}`,
        lastTurn: { endedAt: 300 + n, how: "finished" },
        outcome: { result: "succeeded", at: 290 + n, summary: `Done ${n}`, files: [] },
        ...extra,
      }),
    });
  const linkOf = (env: ReturnType<typeof setup>, id: string) =>
    env.result.current.sessions.find((session) => session.id === id)?.delegatedFrom;
  const bump = async (env: ReturnType<typeof setup>) => {
    await act(async () => {
      env.result.current.setTranscripts((prev) => ({ ...prev, "s-a": [...(prev["s-a"] ?? [])] }));
    });
  };

  it("three workers that ended while the coordinator worked arrive as one message", async () => {
    const env = setup({
      sessions: [sourceSession(), owedWorker("w1", 1), owedWorker("w2", 2), owedWorker("w3", 3)],
      transcripts: { "s-a": A_MESSAGES },
      busy: ["s-a"],
    });
    await act(async () => {});
    expect(env.sends).toHaveLength(0);
    env.busy.delete("s-a");
    await bump(env);
    await waitFor(() => expect(env.sends).toHaveLength(1));
    expect(env.sends[0].marks?.workerReport?.workers.map((worker) => worker.handle)).toEqual([
      "worker-1",
      "worker-2",
      "worker-3",
    ]);
    expect(env.sends[0].marks?.delegationReport).toBeUndefined();
  });

  it("each reported worker gets its report time and loses its summary", async () => {
    const env = setup({ sessions: [sourceSession(), owedWorker("w1", 1)], transcripts: { "s-a": A_MESSAGES } });
    await waitFor(() => expect(linkOf(env, "w1")).toMatchObject({ reportedAt: expect.any(Number) }));
    expect(linkOf(env, "w1")?.outcome).toEqual({ result: "succeeded", at: 291 });
  });

  it("a report owed before a reload goes out after it, from a transcript that was not loaded", async () => {
    const messagesOf = vi.fn().mockResolvedValue(bMessages(agentMessage({ content: "All done." })));
    const env = setup({
      sessions: [sourceSession(), owedWorker("w1", 1, { outcome: null })],
      transcripts: { "s-a": A_MESSAGES },
      messagesOf,
    });
    await waitFor(() => expect(env.sends).toHaveLength(1));
    expect(env.sends[0].text).toContain("ended its turn without reporting. Its last answer:\n> All done.");
  });

  it("an unreadable transcript is reported without its cause", async () => {
    const env = setup({
      sessions: [sourceSession(), owedWorker("w1", 1, { outcome: null })],
      transcripts: { "s-a": A_MESSAGES },
      messagesOf: async () => null,
    });
    await waitFor(() => expect(env.sends).toHaveLength(1));
    expect(env.sends[0].text).toContain("ended its turn without reporting. Its session could not be read.");
  });

  it("a stopped worker is reported and its Send unblocks afterwards", async () => {
    const env = setup({
      sessions: [sourceSession(), owedWorker("w1", 1, { lastTurn: { endedAt: 301, how: "cancelled" }, outcome: null })],
      transcripts: { "s-a": A_MESSAGES },
      busy: ["s-a"],
    });
    expect(env.result.current.delegation.sendBlockedReason("w1")).toBe(
      "Codex's report waits for Claude Code to finish.",
    );
    env.busy.delete("s-a");
    await bump(env);
    await waitFor(() => expect(env.sends).toHaveLength(1));
    expect(env.sends[0].text).toContain("stopped before it finished");
    await waitFor(() => expect(env.result.current.delegation.sendBlockedReason("w1")).toBeNull());
  });

  it("holds Send in a worker whose report waits for a busy coordinator, and frees it after delivery", async () => {
    const env = setup({
      sessions: [sourceSession(), owedWorker("w1", 1)],
      transcripts: { "s-a": A_MESSAGES },
      busy: ["s-a"],
    });
    await act(async () => {});
    expect(env.sends).toHaveLength(0);
    expect(env.result.current.delegation.sendBlockedReason("w1")).toBe(
      "Codex's report waits for Claude Code to finish.",
    );
    env.busy.delete("s-a");
    await bump(env);
    await waitFor(() => expect(env.sends).toHaveLength(1));
    await waitFor(() => expect(env.result.current.delegation.sendBlockedReason("w1")).toBeNull());
  });

  it("a worker that is gone is reported once and its link then ends", async () => {
    const env = setup({
      sessions: [sourceSession(), owedWorker("w1", 1, { lastTurn: { endedAt: 301, how: "exited" }, outcome: null })],
      transcripts: { "s-a": A_MESSAGES },
    });
    await waitFor(() => expect(linkOf(env, "w1")?.endedAt).toEqual(expect.any(Number)));
    expect(env.sends).toHaveLength(1);
    expect(env.sends[0].text).toContain("is gone");
    await act(async () => {});
    expect(env.sends).toHaveLength(1);
  });

  it("nothing is sent to an archived or deleted coordinator, and the links end", async () => {
    const archived = setup({
      sessions: [sourceSession({ archivedAt: 5 }), owedWorker("w1", 1)],
      transcripts: { "s-a": A_MESSAGES },
    });
    await waitFor(() => expect(linkOf(archived, "w1")?.endedAt).toEqual(expect.any(Number)));
    expect(archived.sends).toHaveLength(0);
    expect(archived.notices).toHaveLength(0);
    const gone = setup({ sessions: [owedWorker("w1", 1)], transcripts: {} });
    await waitFor(() => expect(linkOf(gone, "w1")?.endedAt).toEqual(expect.any(Number)));
    expect(gone.sends).toHaveLength(0);
    expect(gone.givesBack).toHaveLength(0);
    expect(gone.notices).toHaveLength(0);
  });

  it("a refused report waits in the coordinator's composer and still counts as reported", async () => {
    const env = setup({
      sessions: [sourceSession(), owedWorker("w1", 1)],
      transcripts: { "s-a": A_MESSAGES },
      sendResult: false,
    });
    await waitFor(() => expect(env.givesBack).toHaveLength(1));
    await waitFor(() => expect(linkOf(env, "w1")).toMatchObject({ reportedAt: expect.any(Number) }));
    expect(env.givesBack[0].text).toContain("Done 1");
    expect(env.givesBack).toHaveLength(1);
  });

  it("two renders in a row send one message", async () => {
    const env = setup({
      sessions: [sourceSession(), owedWorker("w1", 1)],
      transcripts: { "s-a": A_MESSAGES },
      strict: true,
    });
    await waitFor(() => expect(linkOf(env, "w1")).toMatchObject({ reportedAt: expect.any(Number) }));
    await act(async () => {});
    expect(env.sends).toHaveLength(1);
  });

  it("sends at most eight workers in a message and the rest in the next free pass", async () => {
    const workers = Array.from({ length: 9 }, (_, index) => owedWorker(`w${index + 1}`, index + 1));
    const env = setup({ sessions: [sourceSession(), ...workers], transcripts: { "s-a": A_MESSAGES } });
    await waitFor(() => expect(env.sends).toHaveLength(2));
    expect(env.sends[0].marks?.workerReport?.workers).toHaveLength(8);
    expect(env.sends[1].marks?.workerReport?.workers.map((worker) => worker.handle)).toEqual(["worker-9"]);
  });

  it("a worker whose report is owed takes no further task", async () => {
    const env = setup({
      sessions: [sourceSession(), owedWorker("w1", 1)],
      transcripts: { "s-a": A_MESSAGES },
      busy: ["s-a"],
    });
    let result: unknown;
    await act(async () => {
      result = await env.result.current.delegation.sendToWorker("s-a", "w1", "More");
    });
    expect(result).toEqual({
      ok: false,
      reason: "worker-1's last result has not reached this session yet. Give it the next task after its report arrives.",
    });
  });

  it("keeps a report owed while the coordinator is not running, then sends it once when it runs", async () => {
    const env = setup({
      sessions: [sourceSession({ status: "terminated" }), owedWorker("w1", 1, { outcome: null })],
      transcripts: {},
      cannotPrompt: ["s-a"],
      messagesOf: async () => bMessages(),
    });
    await act(async () => {});
    await act(async () => {});
    expect(env.sends).toHaveLength(0);
    expect(env.givesBack).toHaveLength(0);
    expect(env.notices).toHaveLength(0);
    expect(linkOf(env, "w1")?.reportedAt).toBeUndefined();

    await act(async () => {
      env.cannotPrompt.delete("s-a");
      env.result.current.setSessions((prev) =>
        prev.map((session) => (session.id === "s-a" ? { ...session, status: "running" } : session)),
      );
    });
    await waitFor(() => expect(env.sends).toHaveLength(1));
    await waitFor(() => expect(linkOf(env, "w1")).toMatchObject({ reportedAt: expect.any(Number) }));
    await act(async () => {});
    expect(env.sends).toHaveLength(1);
  });

  it("does not send to a coordinator that became busy while a transcript was read", async () => {
    let release: (messages: ChatMessage[]) => void = () => undefined;
    const messagesOf = vi
      .fn<(id: string) => Promise<ChatMessage[] | null>>()
      .mockImplementationOnce(() => new Promise<ChatMessage[]>((resolve) => (release = resolve)))
      .mockResolvedValue(bMessages());
    const env = setup({
      sessions: [sourceSession(), owedWorker("w1", 1, { outcome: null })],
      transcripts: { "s-a": A_MESSAGES },
      messagesOf,
    });
    await waitFor(() => expect(messagesOf).toHaveBeenCalled());
    env.busy.add("s-a");
    await act(async () => {
      release(bMessages());
    });
    await act(async () => {});
    expect(env.sends).toHaveLength(0);
    expect(env.givesBack).toHaveLength(0);
    expect(linkOf(env, "w1")?.reportedAt).toBeUndefined();

    env.busy.delete("s-a");
    await bump(env);
    await waitFor(() => expect(env.sends).toHaveLength(1));
  });

  it("does not let an older report cover a turn that ended while it was prepared", async () => {
    let release: (messages: ChatMessage[]) => void = () => undefined;
    const messagesOf = vi
      .fn<(id: string) => Promise<ChatMessage[] | null>>()
      .mockImplementationOnce(() => new Promise<ChatMessage[]>((resolve) => (release = resolve)))
      .mockResolvedValue(bMessages());
    const env = setup({
      sessions: [sourceSession(), owedWorker("w1", 1, { outcome: null })],
      transcripts: { "s-a": A_MESSAGES },
      messagesOf,
    });
    await waitFor(() => expect(messagesOf).toHaveBeenCalled());
    await act(async () => {
      env.result.current.setSessions((prev) =>
        prev.map((session) =>
          session.id === "w1" && session.delegatedFrom
            ? { ...session, delegatedFrom: { ...session.delegatedFrom, lastTurn: { endedAt: 999_999, how: "finished" as const } } }
            : session,
        ),
      );
    });
    await act(async () => {
      release(bMessages());
    });
    // The stale entry was dropped; the drain runs again for the newer turn end and sends it once.
    await waitFor(() => expect(env.sends).toHaveLength(1));
    await act(async () => {});
    expect(env.sends).toHaveLength(1);
  });

  it("refuses a further task in the tick a turn settled, before the link is rendered", async () => {
    const env = setup({
      sessions: [sourceSession(), owedWorker("w1", 1, { lastTurn: null, outcome: null, reportedAt: null })],
      transcripts: { "s-a": A_MESSAGES },
      busy: ["s-a"],
    });
    let result: unknown;
    await act(async () => {
      env.result.current.delegation.onTurnSettled("w1", { how: "finished" });
      result = await env.result.current.delegation.sendToWorker("s-a", "w1", "More");
    });
    expect(result).toEqual({
      ok: false,
      reason: "worker-1's last result has not reached this session yet. Give it the next task after its report arrives.",
    });
  });

  it("raises one plain notice when sending fails and does not retry on every render", async () => {
    const env = setup({
      sessions: [sourceSession({ status: "running" }), owedWorker("w1", 1)],
      transcripts: { "s-a": A_MESSAGES },
      cannotPrompt: ["s-a"],
      giveBackThrows: true,
    });
    await waitFor(() => expect(env.notices).toHaveLength(1));
    await bump(env);
    await bump(env);
    expect(env.giveBackAttempts.count).toBe(1);
    expect(env.notices).toEqual([
      "A worker's report could not be sent. Zorvo will try again when Parser work's next turn ends.",
    ]);
    expect(env.notices[0]).not.toContain("secret");
    // The coordinator's next turn end tries again.
    await act(async () => {
      env.result.current.delegation.onTurnEnded("s-a", "finished");
    });
    await waitFor(() => expect(env.giveBackAttempts.count).toBe(2));
  });
});
