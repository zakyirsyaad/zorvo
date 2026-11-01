import { describe, it, expect } from "vitest";
import {
  MAX_COMPARE_AGENTS,
  compareRuns,
  isRunSettled,
  othersToStop,
  pendingPermission,
  pickableAgentIds,
  rowStatus,
  runOf,
  statusLabel,
  type RowFacts,
  type RunRowStatus,
} from "../lib/compare-run";
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
    needsSignIn: false,
    failed: false,
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
    options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
    ...overrides,
  };
}

function message(id: string, actionCard?: ActionCard): ChatMessage {
  return { id, role: "agent", content: "", timestamp: 1, actionCard };
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
      done: "Done",
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
