import { StrictMode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useDelegation } from "../hooks/useDelegation";
import { NO_CHOICES, type AcpChoices } from "../lib/acp-draft";
import { buildDelegatePrompt } from "../lib/delegation";
import { newSessionRecord, type SessionSpec, type StartSessionOptions } from "../lib/session-start";
import type { FirstMessage } from "../hooks/session-engine/useAcpEngine";
import type { AgentProfile, ChatMessage, DelegationLink, Session } from "../types";
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
  marks?: Pick<ChatMessage, "delegationReport">;
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

  const hook = renderHook(
    () => {
      const [sessions, setSessions] = useState<readonly Session[]>(input.sessions);
      const [transcripts, setTranscripts] = useState<Readonly<Record<string, ChatMessage[]>>>(
        input.transcripts ?? {},
      );
      const delegation = useDelegation({
        sessions,
        agents: input.agents ?? AGENTS,
        transcripts,
        isBusy: (sessionId) => busy.has(sessionId),
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
        patchSession: (sessionId, patch) => {
          patches.push({ sessionId, patch });
          setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, ...patch } : s)));
        },
        giveBack: (sessionId, text) => {
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
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

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
    expect(env.notices).toEqual(["Could not delegate: Wait for Claude Code to finish."]);
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
    expect(env.notices).toEqual(["Could not delegate: Error: disk full"]);
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

    await act(async () => {
      env.result.current.delegation.onTurnEnded("s-b", "finished");
    });

    await waitFor(() => expect(env.sends).toHaveLength(1));
    const [report] = env.sends;
    expect(report.sessionId).toBe("s-a");
    expect(report.text).toContain('Report from Codex on the task you delegated: "Fix the parser"');
    expect(report.text).toContain("> Done. Tests pass.");
    // A tool's path inside A's folder is relative to it; one outside is left alone.
    expect(report.text).toContain("Files Codex reported changing this turn: src/parser.ts, src/a.ts, /tmp/b.ts");
    expect(report.attachments).toEqual([]);
    expect(report.marks).toEqual({ delegationReport: { agentName: "Codex", agentId: "codex-acp" } });
    expect(env.givesBack).toHaveLength(0);
    expect(env.notices).toHaveLength(0);
    expect(env.result.current.delegation.viewFor("s-a")).toMatchObject({
      state: "reported",
      reportedAt: expect.any(Number),
    });
  });

  it("sends no report for a failed or cancelled turn", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
    });

    await act(async () => {
      env.result.current.delegation.onTurnEnded("s-b", "failed");
    });
    await act(async () => {
      env.result.current.delegation.onTurnEnded("s-b", "needs-answer");
    });

    expect(env.sends).toHaveLength(0);
    expect(env.givesBack).toHaveLength(0);
    expect(env.notices).toHaveLength(0);
    expect(env.result.current.delegation.viewFor("s-a")).toMatchObject({ state: "failed" });
  });

  it("sends no report for a turn with no answer text", async () => {
    const toolsOnly = agentMessage({
      content: "",
      tools: [{ id: "t-1", name: "Edit", status: "completed", kind: "edit", locations: ["src/a.ts"] }],
    });
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages(toolsOnly) },
    });

    await act(async () => {
      env.result.current.delegation.onTurnEnded("s-b", "finished");
    });
    await act(async () => {});

    expect(env.sends).toHaveLength(0);
    expect(env.givesBack).toHaveLength(0);
    expect(env.notices).toHaveLength(0);
    // Nothing was handed over and the delegate is not running: A has no line to show.
    expect(env.result.current.delegation.viewFor("s-a")).toBeNull();
    expect(env.result.current.delegation.sendBlockedReason("s-b")).toBeNull();
  });

  it("puts the report in A's composer with a notice when A cannot take a prompt", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
      cannotPrompt: ["s-a"],
    });

    await act(async () => {
      env.result.current.delegation.onTurnEnded("s-b", "finished");
    });
    await act(async () => {});

    expect(env.sends).toHaveLength(0);
    expect(env.givesBack).toHaveLength(1);
    expect(env.givesBack[0].sessionId).toBe("s-a");
    expect(env.givesBack[0].text).toContain("Report from Codex");
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

    await act(async () => {
      env.result.current.delegation.onTurnEnded("s-b", "finished");
    });
    await act(async () => {});

    expect(env.sends).toHaveLength(1);
    expect(env.givesBack).toHaveLength(1);
    expect(env.givesBack[0].sessionId).toBe("s-a");
    expect(env.givesBack[0].text).toContain("Report from Codex");
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

    await act(async () => {
      env.result.current.delegation.onTurnEnded("s-b", "finished");
    });
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
    await act(async () => {
      env.result.current.delegation.onTurnEnded("s-b", "finished");
    });
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

    await act(async () => {
      env.result.current.delegation.onTurnEnded("s-b", "finished");
    });
    await act(async () => {});

    expect(env.sends).toHaveLength(0);
    expect(env.givesBack).toHaveLength(0);
    expect(env.notices).toHaveLength(0);
    // An archived delegate is not open: A has no line and may delegate again.
    expect(env.result.current.delegation.viewFor("s-a")).toBeNull();
  });

  it("refuses B's send while a report is handing over", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
    });
    let reason: string | null = null;

    act(() => {
      env.result.current.delegation.onTurnEnded("s-b", "finished");
      // Same tick, before the effect can run: the hand-over already blocks B.
      reason = env.result.current.delegation.sendBlockedReason("s-b");
    });

    expect(reason).toBe("Claude Code is working on Codex's report.");
    await act(async () => {});
  });

  it("refuses A's send while B's report is handing over", async () => {
    const env = setup({
      sessions: [sourceSession(), delegateSession()],
      transcripts: { "s-a": A_MESSAGES, "s-b": bMessages() },
    });
    let reason: string | null = null;

    act(() => {
      env.result.current.delegation.onTurnEnded("s-b", "finished");
      // Same tick: a message to A now would take A's turn from the report.
      reason = env.result.current.delegation.sendBlockedReason("s-a");
    });

    expect(reason).toBe("Codex is working on the task you delegated.");
    await act(async () => {});
    // Once the report went out, A is no longer held by the hand-over.
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
    // Between turns, with no outcome yet, the delegate has no live turn to report.
    expect(env.result.current.delegation.viewFor("s-a")).toBeNull();

    await act(async () => {
      env.result.current.delegation.onTurnEnded("s-b", "failed");
    });
    expect(env.result.current.delegation.viewFor("s-a")).toMatchObject({
      state: "failed",
      reportedAt: null,
    });

    await act(async () => {
      env.result.current.delegation.onTurnEnded("s-b", "finished");
    });
    await waitFor(() => expect(env.sends).toHaveLength(1));
    expect(env.result.current.delegation.viewFor("s-a")).toMatchObject({
      state: "reported",
      reportedAt: expect.any(Number),
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
});