import { describe, it, expect } from "vitest";
import {
  MAX_COMPARE_AGENTS,
  compareRuns,
  isRunSettled,
  lastOfRun,
  othersToStop,
  pendingPermission,
  pickableAgentIds,
  elapsedWords,
  rowFactsOf,
  rowStatus,
  rowStatusWords,
  runOf,
  runStatusDot,
  statusLabel,
  stopsLine,
  type RowFacts,
  type RunRowStatus,
} from "../lib/compare-run";
import { applyAcpUpdate, closeTurn } from "../lib/acp-events";
import type { ActionCard, ChatMessage, Session } from "../types";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s-1",
    name: "Compare",
    profileId: "qwen",
    cwd: "/w",
    status: "idle",
    createdAt: 1,
    transport: "acp",
    ...overrides,
  };
}

function facts(overrides: Partial<RowFacts> = {}): RowFacts {
  return {
    session: session(),
    isBusy: false,
    hasStarted: true,
    pendingCard: null,
    hasOpenForm: false,
    lastMessage: null,
    openFormPrompt: null,
    needsSignIn: false,
    failed: false,
    turnStartedAt: 1,
    finishedAt: null,
    hasUnread: false,
    ...overrides,
  };
}

function card(overrides: Partial<ActionCard> = {}): ActionCard {
  return {
    id: "c-1",
    sessionId: "s-1",
    title: "Run a command",
    prompt: "Run ls?",
    status: "pending",
    timestamp: 1,
    requestId: 1,
    options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
    ...overrides,
  };
}

function message(id: string, actionCard?: ActionCard): ChatMessage {
  return { id, role: "agent", content: "", timestamp: 1, actionCard };
}

function userMessage(id: string): ChatMessage {
  return { id, role: "user", content: "Go on", timestamp: 1 };
}

describe("compareRuns", () => {
  it("groups listed sessions by run id, in createdAt order", () => {
    const runs = compareRuns([
      session({ id: "b", name: "Second", createdAt: 5, compareRunId: "run-1" }),
      session({ id: "a", name: "First", createdAt: 2, compareRunId: "run-1" }),
      session({ id: "c", createdAt: 3, compareRunId: "run-2" }),
      session({ id: "d", createdAt: 4, compareRunId: "run-2" }),
    ]);

    expect(runs.map((run) => run.id)).toEqual(["run-1", "run-2"]);
    expect(runs[0].sessions.map((s) => s.id)).toEqual(["a", "b"]);
    expect(runs[0].name).toBe("First");
  });

  it("is no run with one listed session", () => {
    expect(compareRuns([session({ compareRunId: "run-1" })])).toEqual([]);
  });

  it("leaves archived sessions out", () => {
    const runs = compareRuns([
      session({ id: "a", compareRunId: "run-1" }),
      session({ id: "b", compareRunId: "run-1", archivedAt: 9 }),
    ]);

    expect(runs).toEqual([]);
  });

  it("ignores sessions without a run id", () => {
    const runs = compareRuns([
      session({ id: "a" }),
      session({ id: "b", compareRunId: null }),
      session({ id: "c", compareRunId: "" }),
    ]);

    expect(runs).toEqual([]);
  });
});

describe("runOf", () => {
  it("finds a run by id and returns null otherwise", () => {
    const sessions = [
      session({ id: "a", compareRunId: "run-1" }),
      session({ id: "b", compareRunId: "run-1" }),
    ];

    expect(runOf(sessions, "run-1")?.sessions).toHaveLength(2);
    expect(runOf(sessions, "run-9")).toBeNull();
  });
});

describe("lastOfRun", () => {
  const member = (id: string, overrides: Partial<Session> = {}) => session({ id, compareRunId: "run-1", ...overrides });

  it("finds the one listed session a run leaves", () => {
    const sessions = [member("a", { archivedAt: 1 }), member("b"), session({ id: "other" })];
    expect(lastOfRun(sessions, "run-1")?.id).toBe("b");
  });

  it("is null when none is left, or when the run still has two", () => {
    expect(lastOfRun([member("a", { archivedAt: 1 })], "run-1")).toBeNull();
    expect(lastOfRun([member("a"), member("b")], "run-1")).toBeNull();
  });
});

describe("rowStatus", () => {
  it("puts sign-in before permission, permission before busy, failed before done", () => {
    const busy = { isBusy: true };
    expect(rowStatus(facts({ ...busy, needsSignIn: true, pendingCard: card(), failed: true }))).toBe("needs-sign-in");
    expect(rowStatus(facts({ ...busy, pendingCard: card(), failed: true }))).toBe("needs-you");
    expect(rowStatus(facts({ ...busy, hasOpenForm: true, failed: true }))).toBe("needs-you");
    expect(rowStatus(facts({ ...busy, failed: true }))).toBe("failed");
    expect(rowStatus(facts({ failed: true }))).toBe("failed");
    expect(rowStatus(facts(busy))).toBe("working");
    expect(rowStatus(facts())).toBe("done");
  });

  it("reads starting until the agent has begun, then working while it is busy", () => {
    expect(rowStatus(facts({ hasStarted: false, isBusy: true }))).toBe("starting");
    expect(rowStatus(facts({ hasStarted: false }))).toBe("starting");
    expect(rowStatus(facts({ hasStarted: true, isBusy: true }))).toBe("working");
  });

  it("reads stopped for an ended session that was not failed", () => {
    expect(rowStatus(facts({ session: session({ status: "terminated" }) }))).toBe("stopped");
    expect(rowStatus(facts({ session: session({ status: "terminated" }), failed: true }))).toBe("failed");
  });
});

describe("statusLabel", () => {
  it("returns the words shown for each status", () => {
    const labels: Record<RunRowStatus, string> = {
      starting: "Starting",
      working: "Working",
      "needs-you": "Needs you",
      "needs-sign-in": "Needs sign-in",
      failed: "Failed",
      done: "Finished",
      stopped: "Stopped",
    };
    for (const [status, label] of Object.entries(labels)) {
      expect(statusLabel(status as RunRowStatus)).toBe(label);
    }
  });
});

describe("isRunSettled", () => {
  it("is false while any row is starting, working or needs you", () => {
    expect(isRunSettled(["done", "starting"])).toBe(false);
    expect(isRunSettled(["done", "working"])).toBe(false);
    expect(isRunSettled(["done", "needs-you"])).toBe(false);
  });

  it("is true once every row is done, stopped, failed or waiting on a sign-in", () => {
    expect(isRunSettled(["done", "stopped", "failed", "needs-sign-in"])).toBe(true);
  });
});

describe("othersToStop", () => {
  const run = {
    id: "run-1",
    name: "Compare",
    sessions: [
      session({ id: "a" }),
      session({ id: "b" }),
      session({ id: "c", status: "terminated" }),
      session({ id: "d", status: "terminated" }),
    ],
  };

  it("leaves out the winner and sessions already stopped", () => {
    expect(othersToStop(run, "a", () => false).map((s) => s.id)).toEqual(["b"]);
  });

  it("keeps an ended session that is still busy", () => {
    expect(othersToStop(run, "a", (id) => id === "d").map((s) => s.id)).toEqual(["b", "d"]);
  });
});

describe("pendingPermission", () => {
  it("finds the last unanswered card and skips answered ones", () => {
    const first = card({ id: "first" });
    const answered = card({ id: "answered", status: "approved", chosenOptionId: "allow" });
    const messages = [message("1", first), message("2", answered), message("3")];

    expect(pendingPermission(messages)?.id).toBe("first");
    expect(pendingPermission([...messages, message("4", card({ id: "last" }))])?.id).toBe("last");
  });

  it("ignores a pending card without a request id, which nothing closes", () => {
    const { requestId: _requestId, ...withoutRequest } = card();

    expect(pendingPermission([message("1", withoutRequest)])).toBeNull();
  });

  it("ignores a pending card from before the last user message", () => {
    expect(pendingPermission([message("1", card()), userMessage("2")])).toBeNull();
  });

  it("is null when no card waits", () => {
    expect(pendingPermission([message("1"), message("2", card({ status: "rejected" }))])).toBeNull();
    expect(pendingPermission([])).toBeNull();
  });
});

describe("pickableAgentIds", () => {
  it("toggles an agent on and off without changing the input", () => {
    const selected = ["qwen"];

    expect(pickableAgentIds(selected, "codex")).toEqual(["qwen", "codex"]);
    expect(pickableAgentIds(selected, "qwen")).toEqual([]);
    expect(selected).toEqual(["qwen"]);
  });

  it("stops at MAX_COMPARE_AGENTS but still lets one be removed", () => {
    const full = Array.from({ length: MAX_COMPARE_AGENTS }, (_, i) => `agent-${i}`);

    expect(pickableAgentIds(full, "extra")).toEqual(full);
    expect(pickableAgentIds(full, "agent-0")).toHaveLength(MAX_COMPARE_AGENTS - 1);
  });
});

const MIN = 60_000;
const NOW = 1_000 * MIN;

const timed = (role: "user" | "agent", timestamp: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `${role}-${timestamp}`,
  role,
  content: "",
  timestamp,
  ...extra,
});

describe("how long a compare agent has worked", () => {
  it("words a span in minutes, then hours", () => {
    expect(elapsedWords(30_000)).toBe("1 min");
    expect(elapsedWords(12 * MIN)).toBe("12 min");
    expect(elapsedWords(65 * MIN)).toBe("1 h 5 min");
    expect(elapsedWords(120 * MIN)).toBe("2 h");
  });

  it("a working row counts from its prompt", () => {
    expect(rowStatusWords(facts({ turnStartedAt: NOW - 12 * MIN }), "working", NOW)).toBe("Working · 12 min");
  });

  it("other statuses read their word alone", () => {
    expect(rowStatusWords(facts(), "needs-sign-in", NOW)).toBe("Needs sign-in");
  });

  it("a later turn counts from its own prompt", () => {
    const run = { id: "r", name: "Compare", sessions: [session({ createdAt: NOW - 180 * MIN })] };
    const transcripts = { "s-1": [timed("user", NOW - 180 * MIN), timed("agent", NOW - 170 * MIN, { isComplete: true }), timed("user", NOW - 2 * MIN)] };
    const [row] = rowFactsOf(run, { isBusy: () => true, transcripts, failedTurns: {}, signInNeeded: new Map() });

    expect(rowStatusWords(row, "working", NOW)).toBe("Working · 2 min");
  });

  it("a replayed prompt with no known time counts from the session's start", () => {
    const run = { id: "r", name: "Compare", sessions: [session({ createdAt: NOW - 30 * MIN, hasUnread: true })] };
    const transcripts = { "s-1": [timed("user", NOW - 2 * MIN, { hasKnownTime: false })] };
    const [row] = rowFactsOf(run, { isBusy: () => true, transcripts, failedTurns: {}, signInNeeded: new Map() });

    expect(rowStatusWords(row, "working", NOW)).toBe("Working · 30 min");
    expect(row.hasUnread).toBe(true);
  });

  it("a finished unread row shows the unread dot", () => {
    expect(runStatusDot("done", true)).toBe("unread");
    expect(runStatusDot("done")).toBe("idle");
    expect(runStatusDot("working", true)).toBe("running");
  });

  it("says who Pick stops", () => {
    expect(stopsLine(["Qwen Code"])).toBe("Qwen Code is still working and will be stopped.");
    expect(stopsLine(["Qwen Code", "Kimi CLI"])).toBe("Qwen Code and Kimi CLI are still working and will be stopped.");
    expect(statusLabel("done")).toBe("Finished");
  });
});

describe("how long a finished turn took", () => {
  const folded = (startAt: number, chunkAt: number, endAt: number): ChatMessage[] => {
    let n = 0;
    const ctxAt = (now: number) => ({ sessionId: "s-1", now, createId: (prefix: string) => `${prefix}-${++n}` });
    const reply = applyAcpUpdate([timed("user", startAt)], { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "On it." } }, ctxAt(chunkAt));
    return closeTurn(reply, endAt);
  };
  const rowOf = (messages: ChatMessage[]) =>
    rowFactsOf({ id: "r", name: "Compare", sessions: [session({ createdAt: 0 })] }, {
      isBusy: () => false,
      transcripts: { "s-1": messages },
      failedTurns: {},
      signInNeeded: new Map(),
    })[0];

  it("runs from the prompt to the turn's end, not to the reply's first chunk", () => {
    const row = rowOf(folded(MIN, MIN + 20_000, 41 * MIN));
    expect(rowStatusWords(row, "done", 60 * MIN)).toBe("Finished · 40 min");
  });

  it("a reply with no end time reads Finished alone", () => {
    const transcripts = [timed("user", 1_000), timed("agent", 2_000, { isComplete: true })];
    expect(rowStatusWords(rowOf(transcripts), "done", 60 * MIN)).toBe("Finished");
  });

  it("a replayed prompt gives no duration", () => {
    const messages = folded(MIN, 2 * MIN, 10 * MIN).map((message) => (message.role === "user" ? { ...message, hasKnownTime: false } : message));
    expect(rowStatusWords(rowOf(messages), "done", 60 * MIN)).toBe("Finished");
  });
});
