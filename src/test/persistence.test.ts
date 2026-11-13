import { describe, it, expect } from "vitest";
import { canonicalAgentId, dropTerminalSessions, loadTranscript, normalizePersistedState, normalizeTranscript } from "../lib/persistence";

const base = { id: "s-1", name: "Fix login", profileId: "claude-code", cwd: "/w/api", status: "terminated", createdAt: 1 };

describe("normalizePersistedState", () => {
  it("keeps a session's worktree", () => {
    const worktree = { repoPath: "/w/api", path: "/data/worktrees/api/fix-login", branch: "agent/fix-login" };

    const state = normalizePersistedState({ sessions: [{ ...base, worktree }] });

    expect(state.sessions[0].worktree).toEqual(worktree);
  });

  it("drops a malformed worktree but keeps its session", () => {
    const state = normalizePersistedState({ sessions: [{ ...base, worktree: { path: 3 } }] });

    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].worktree).toBeUndefined();
  });

  it("drops malformed pin, archive and naming fields but keeps the session", () => {
    const state = normalizePersistedState({
      sessions: [{ ...base, pinned: "yes", archivedAt: "2026-10-17", namedByUser: 1, hasUnread: "no" }],
    });

    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).not.toHaveProperty("pinned");
    expect(state.sessions[0]).not.toHaveProperty("archivedAt");
    expect(state.sessions[0]).not.toHaveProperty("namedByUser");
    expect(state.sessions[0]).not.toHaveProperty("hasUnread");
  });

  it("keeps a session's review comments and drops the bad ones", () => {
    const good = {
      id: "c-1", file: "a.ts", side: "new", line: 3, lineHash: "deadbeef", quote: "x", target: "head", body: "Fix", createdAt: 1,
    };

    const state = normalizePersistedState({ sessions: [{ ...base, reviewComments: [good, { ...good, id: 2 }] }] });

    expect(state.sessions[0].reviewComments).toEqual([good]);
  });

  it("keeps a session whose review comments are malformed", () => {
    const state = normalizePersistedState({ sessions: [{ ...base, reviewComments: "oops" }] });

    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).not.toHaveProperty("reviewComments");
  });

  it("omits an empty review comments list", () => {
    const state = normalizePersistedState({ sessions: [{ ...base, reviewComments: [] }, { ...base, id: "s-2", reviewComments: [null] }] });

    expect(state.sessions[0]).not.toHaveProperty("reviewComments");
    expect(state.sessions[1]).not.toHaveProperty("reviewComments");
  });

  it("keeps a session's compareRunId and worktree startCommit", () => {
    const worktree = { repoPath: "/w/api", path: "/data/worktrees/api/fix", branch: "agent/fix", startCommit: "abc123" };

    const state = normalizePersistedState({ sessions: [{ ...base, compareRunId: "run-1", worktree }] });

    expect(state.sessions[0].compareRunId).toBe("run-1");
    expect(state.sessions[0].worktree).toEqual(worktree);
  });

  it("drops a compareRunId that is not a string", () => {
    const state = normalizePersistedState({ sessions: [{ ...base, compareRunId: 7 }] });

    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).not.toHaveProperty("compareRunId");
  });

  it("keeps a worktree whose startCommit is missing", () => {
    const worktree = { repoPath: "/w/api", path: "/data/worktrees/api/fix", branch: "agent/fix" };

    const state = normalizePersistedState({ sessions: [{ ...base, worktree }] });

    expect(state.sessions[0].worktree).toEqual(worktree);
  });

  it("drops a startCommit that is not a string and keeps the worktree", () => {
    const worktree = { repoPath: "/w/api", path: "/data/worktrees/api/fix", branch: "agent/fix" };

    const state = normalizePersistedState({ sessions: [{ ...base, worktree: { ...worktree, startCommit: 5 } }] });

    expect(state.sessions[0].worktree).toEqual(worktree);
    expect(state.sessions[0].worktree).not.toHaveProperty("startCommit");
  });

  it("keeps a true historyElsewhere flag", () => {
    const state = normalizePersistedState({ sessions: [{ ...base, historyElsewhere: true }] });

    expect(state.sessions[0].historyElsewhere).toBe(true);
  });

  it("drops a historyElsewhere that is not a boolean but keeps the session", () => {
    const state = normalizePersistedState({ sessions: [{ ...base, historyElsewhere: "yes" }] });

    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).not.toHaveProperty("historyElsewhere");
  });

  it("keeps the model picked last for each agent, dropping malformed picks", () => {
    const state = normalizePersistedState({
      agentOptions: {
        qwen: { modes: null, configOptions: [], preferredConfig: { model: "qwen3-max", bad: 3 } },
        codex: { modes: null, configOptions: [], preferredConfig: "nope" },
      },
    });

    expect(state.agentOptions?.["qwen-code"].preferredConfig).toEqual({ model: "qwen3-max" });
    expect(state.agentOptions?.["codex-acp"].preferredConfig).toBeUndefined();
  });
});

describe("normalizePersistedState - who opened a session", () => {
  const session = (openedBy: unknown) => ({
    id: "s-1",
    name: "Port it",
    profileId: "codex-acp",
    cwd: "/Users/test/developer/zorvo",
    status: "idle",
    createdAt: 1,
    transport: "acp",
    openedBy,
  });
  const load = (openedBy: unknown) =>
    normalizePersistedState({ version: 2, settings: {}, recentFolders: [], sessions: [session(openedBy)] }).sessions;

  it("keeps a well-formed handle and drops a malformed one alone", () => {
    expect(load({ sessionId: "s-a", at: 5, handle: "session-12" })[0].openedBy).toEqual({
      sessionId: "s-a",
      at: 5,
      handle: "session-12",
    });
    for (const handle of ["session-0", "session-x", "s-a", 3, "session-1234567", "Session-1"]) {
      expect(load({ sessionId: "s-a", at: 5, handle })[0].openedBy).toEqual({ sessionId: "s-a", at: 5 });
    }
  });

  it("keeps an openedBy link and drops a malformed one, keeping the session", () => {
    expect(load({ sessionId: "s-a", at: 5 })[0].openedBy).toEqual({ sessionId: "s-a", at: 5 });
    for (const bad of [{ sessionId: 3, at: 5 }, "s-a", { sessionId: "", at: 1 }, { sessionId: "s-a", at: "now" }]) {
      const sessions = load(bad);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).not.toHaveProperty("openedBy");
    }
  });
});

describe("normalizePersistedState - models", () => {
  it("keeps the models an agent reported and the model picked last, dropping malformed ones", () => {
    const models = { currentModelId: "auto", availableModels: [{ modelId: "auto", name: "Auto" }, { modelId: 3 }] };
    const state = normalizePersistedState({
      agentOptions: {
        "gemini-cli": { modes: null, configOptions: [], models, preferredModelId: "auto" },
        qwen: { modes: null, configOptions: [], models: "nope", preferredModelId: 4 },
      },
    });

    const gemini = state.agentOptions?.["gemini-cli"];
    expect(gemini?.models).toEqual({
      currentModelId: "auto",
      availableModels: [{ modelId: "auto", name: "Auto", description: undefined }],
    });
    expect(gemini?.preferredModelId).toBe("auto");
    const qwen = state.agentOptions?.["qwen-code"];
    expect(qwen).not.toHaveProperty("models");
    expect(qwen).not.toHaveProperty("preferredModelId");
  });

  it("keeps each model's effort list, dropping malformed ones", () => {
    const effort = {
      id: "reasoning_effort",
      name: "Reasoning effort",
      category: "thought_level",
      currentValue: "high",
      options: [{ value: "high", name: "High" }, { value: "max", name: "Max" }],
    };
    const state = normalizePersistedState({
      agentOptions: {
        "qwen-code": { modes: null, configOptions: [], effortsByModel: { deepseek: effort, kimi: "nope", glm: { id: 3 } } },
        "codex-acp": { modes: null, configOptions: [], effortsByModel: ["nope"] },
      },
    });

    expect(state.agentOptions?.["qwen-code"].effortsByModel).toEqual({
      deepseek: {
        ...effort,
        description: undefined,
        options: effort.options.map((choice) => ({ ...choice, description: undefined })),
      },
    });
    expect(state.agentOptions?.["codex-acp"]).not.toHaveProperty("effortsByModel");
  });
});

describe("normalizePersistedState - legacy agent ids", () => {
  it("rewrites legacy agent ids in sessions and the default agent", () => {
    const state = normalizePersistedState({
      settings: { defaultAgentId: "qwen" },
      sessions: [
        base,
        { ...base, id: "s-2", profileId: "qwen" },
        { ...base, id: "s-3", profileId: "codex" },
        { ...base, id: "s-4", profileId: "omp" },
      ],
    });

    expect(state.settings.defaultAgentId).toBe("qwen-code");
    expect(state.sessions.map((s) => s.profileId)).toEqual(["claude-acp", "qwen-code", "codex-acp", "omp"]);
  });

  it("moves legacy agentOptions keys, keeping the new key when both exist", () => {
    const options = (model: string) => ({ modes: null, configOptions: [], preferredConfig: { model } });

    const state = normalizePersistedState({
      agentOptions: { qwen: options("old"), "qwen-code": options("new"), "claude-code": options("claude") },
    });

    expect(Object.keys(state.agentOptions ?? {}).sort()).toEqual(["claude-acp", "qwen-code"]);
    expect(state.agentOptions?.["qwen-code"].preferredConfig).toEqual({ model: "new" });
    expect(state.agentOptions?.["claude-acp"].preferredConfig).toEqual({ model: "claude" });
  });

  it("canonicalAgentId leaves unknown and current ids alone", () => {
    expect(canonicalAgentId("claude-code")).toBe("claude-acp");
    expect(canonicalAgentId("claude-acp")).toBe("claude-acp");
    expect(canonicalAgentId("aider")).toBe("aider");
  });
});

describe("normalizePersistedState - catalog settings", () => {
  it("keeps the new settings fields and defaults them when missing", () => {
    const empty = normalizePersistedState({ settings: {} }).settings;
    expect(empty.enabledAgents).toBeUndefined();
    expect(empty.removedAgents).toEqual([]);
    expect(empty.agentVersions).toEqual({});

    const { settings } = normalizePersistedState({
      settings: { enabledAgents: ["gemini"], removedAgents: ["goose"], agentVersions: { "codex-acp": "1.2.0" } },
    });
    expect(settings.enabledAgents).toEqual(["gemini"]);
    expect(settings.removedAgents).toEqual(["goose"]);
    expect(settings.agentVersions).toEqual({ "codex-acp": "1.2.0" });
  });

  it("rewrites legacy ids inside the lists and version keys, deduplicating with the new key winning", () => {
    const { settings } = normalizePersistedState({
      settings: {
        enabledAgents: ["claude-code", "claude-acp", "qwen", "gemini"],
        removedAgents: ["codex", "codex-acp"],
        agentVersions: { qwen: "0.1.0", "qwen-code": "0.2.0", codex: "1.0.0" },
      },
    });

    expect(settings.enabledAgents).toEqual(["claude-acp", "qwen-code", "gemini"]);
    expect(settings.removedAgents).toEqual(["codex-acp"]);
    expect(settings.agentVersions).toEqual({ "qwen-code": "0.2.0", "codex-acp": "1.0.0" });
  });

  it("drops malformed settings values", () => {
    const { settings } = normalizePersistedState({
      settings: { enabledAgents: "omp", removedAgents: ["aider", 3], agentVersions: { a: "1", b: 2 } },
    });

    expect(settings.enabledAgents).toBeUndefined();
    expect(settings.removedAgents).toEqual([]);
    expect(settings.agentVersions).toEqual({});
  });
});

describe("normalizePersistedState - notified updates", () => {
  it("keeps string pairs and drops non-string values", () => {
    const { settings } = normalizePersistedState({
      settings: { notifiedUpdates: { "claude-code": "1.1.0", "codex-acp": 2 } },
    });
    expect(settings.notifiedUpdates).toEqual({ "claude-acp": "1.1.0" });
  });

  it("defaults to none when missing or malformed", () => {
    expect(normalizePersistedState({ settings: {} }).settings.notifiedUpdates).toEqual({});
    expect(normalizePersistedState({ settings: { notifiedUpdates: ["x"] } }).settings.notifiedUpdates).toEqual({});
  });
});

describe("normalizePersistedState — appearance", () => {
  it("defaults a missing appearance to system", () => {
    expect(normalizePersistedState({ settings: {} }).settings.appearance).toBe("system");
  });

  it.each(["light", "dark"])("keeps %s", (appearance) => {
    expect(normalizePersistedState({ settings: { appearance } }).settings.appearance).toBe(appearance);
  });

  it.each(["sepia", 42])("treats %j as system", (appearance) => {
    expect(normalizePersistedState({ settings: { appearance } }).settings.appearance).toBe("system");
  });
});

describe("dropTerminalSessions", () => {
  const session = (overrides: Record<string, unknown>) => ({ ...base, ...overrides });

  it("drops pty and transport-less sessions and keeps acp ones", () => {
    const state = normalizePersistedState({
      sessions: [
        session({ id: "a", transport: "acp" }),
        session({ id: "p", transport: "pty" }),
        session({ id: "old" }), // saved before ACP: no transport
      ],
    });

    const { state: cleaned, droppedSessionIds } = dropTerminalSessions(state);

    expect(cleaned.sessions.map((s) => s.id)).toEqual(["a"]);
    expect(droppedSessionIds).toEqual(["p", "old"]);
  });

  it("returns the same state when there is no terminal session", () => {
    const state = normalizePersistedState({ sessions: [session({ id: "a", transport: "acp" })] });

    expect(dropTerminalSessions(state)).toEqual({ state, droppedSessionIds: [] });
    expect(dropTerminalSessions(state).state).toBe(state);
  });
});

describe("normalizePersistedState - removed agents", () => {
  it("cleans omp and aider out of the settings and agent options", () => {
    const state = normalizePersistedState({
      version: 1,
      settings: {
        defaultAgentId: "omp",
        enabledAgents: ["omp", "claude-acp", "aider"],
        removedAgents: ["aider", "gemini"],
        agentVersions: { omp: "1.0.0", "claude-acp": "0.5.0" },
      },
      agentOptions: { omp: { preferredConfig: { model: "opus" } }, "claude-acp": {} },
    });

    expect(state.version).toBe(2);
    expect(state.settings.defaultAgentId).toBeNull();
    expect(state.settings.enabledAgents).toEqual(["claude-acp"]);
    expect(state.settings.removedAgents).toEqual(["gemini"]);
    expect(state.settings.agentVersions).toEqual({ "claude-acp": "0.5.0" });
    expect(Object.keys(state.agentOptions ?? {})).toEqual(["claude-acp"]);
  });
});

describe("loadTranscript", () => {
  const store = () =>
    (window as unknown as { __FAKE_TAURI_STORE__: { transcripts: Record<string, unknown[]> } }).__FAKE_TAURI_STORE__;

  it("keeps a valid parts list and loads a message saved without one", async () => {
    store().transcripts["s-1"] = [
      { id: "old", role: "agent", content: "one\n\ntwo", timestamp: 1 },
      {
        id: "new",
        role: "agent",
        content: "one\n\ntwo",
        timestamp: 2,
        tools: [{ id: "t-1", name: "Read src/app.ts", status: "completed", kind: "read" }],
        parts: [
          { kind: "text", text: "one" },
          { kind: "tools", toolIds: ["t-1"] },
          { kind: "text", text: "two" },
        ],
      },
    ];

    const messages = await loadTranscript("s-1");

    expect(messages[0].parts).toBeUndefined();
    expect(messages[0].content).toBe("one\n\ntwo");
    expect(messages[1].parts).toEqual([
      { kind: "text", text: "one" },
      { kind: "tools", toolIds: ["t-1"] },
      { kind: "text", text: "two" },
    ]);
    expect(messages[1].tools).toHaveLength(1);
  });

  it("drops a malformed parts list but keeps the rest of the message", async () => {
    store().transcripts["s-1"] = [
      { id: "a", role: "agent", content: "a", timestamp: 1, parts: "nope" },
      { id: "b", role: "agent", content: "b", timestamp: 2, parts: [{ kind: "text" }] },
      { id: "c", role: "agent", content: "c", timestamp: 3, parts: [{ kind: "tools", toolIds: [1] }] },
      { id: "d", role: "agent", content: "d", timestamp: 4, parts: [{ kind: "unknown" }] },
      { id: "e", role: "agent", content: "e", timestamp: 5, parts: [] },
    ];

    const messages = await loadTranscript("s-1");

    expect(messages.map((m) => m.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(messages.map((m) => m.parts)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(messages.map((m) => m.content)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("drops an entry that is not a message", async () => {
    store().transcripts["s-1"] = [
      null,
      { id: "a", role: "agent", content: "a", timestamp: 1 },
      { id: "b", role: "agent", content: "b" },
      { id: "c", role: "system", content: "c", timestamp: 3 },
      "nope",
    ];

    const messages = await loadTranscript("s-1");

    expect(messages.map((m) => m.id)).toEqual(["a"]);
  });

  it("settles a permission request that was waiting when the app closed", async () => {
    const options = [{ optionId: "allow", name: "Allow", kind: "allow_once" }];
    const card = { sessionId: "s-1", title: "Permission requested", prompt: "Run ls", timestamp: 1, options };
    store().transcripts["s-1"] = [
      { id: "a", role: "agent", content: "", timestamp: 1, actionCard: { ...card, id: "act-1", status: "pending", requestId: 4 } },
      { id: "b", role: "agent", content: "", timestamp: 2, actionCard: { ...card, id: "act-2", status: "approved", chosenOptionId: "allow", requestId: 5 } },
    ];

    const messages = await loadTranscript("s-1");

    expect(messages[0].actionCard).toMatchObject({ status: "rejected" });
    expect(messages[0].actionCard?.chosenOptionId).toBeUndefined();
    expect(messages[1].actionCard).toMatchObject({ status: "approved", chosenOptionId: "allow" });
  });

  it("settles open elicitations", async () => {
    const card = { sessionId: "s-1", message: "m", timestamp: 1, host: "example.com" };
    store().transcripts["s-1"] = [
      { id: "a", role: "agent", content: "", timestamp: 1, elicitation: { ...card, key: "k1", mode: "form", status: "pending", fields: [{ name: "x", required: false, kind: { type: "boolean" } }], errors: { x: "bad" } } },
      { id: "b", role: "agent", content: "", timestamp: 1, elicitation: { ...card, key: "k2", mode: "url", status: "opened", url: "https://example.com/auth" } },
    ];

    const messages = await loadTranscript("s-1");

    for (const message of messages) {
      expect(message.elicitation?.status).toBe("unanswered");
      expect(message.elicitation).not.toHaveProperty("fields");
      expect(message.elicitation).not.toHaveProperty("url");
      expect(message.elicitation).not.toHaveProperty("errors");
      expect(message.elicitation?.host).toBe("example.com");
    }
  });
});

describe("a saved turn-end time", () => {
  const reply = { id: "a", role: "agent", content: "Done.", timestamp: 1_000, isComplete: true };

  it("keeps a numeric completedAt", () => {
    expect(normalizeTranscript([{ ...reply, completedAt: 9_000 }])[0].completedAt).toBe(9_000);
  });

  it("drops a completedAt that is not a number", () => {
    const [message] = normalizeTranscript([{ ...reply, completedAt: "soon" }]);
    expect(message).toBeDefined();
    expect("completedAt" in message).toBe(false);
  });
});

describe("normalizePersistedState - delegation", () => {
  it("keeps a valid delegatedFrom link", () => {
    const delegatedFrom = { sessionId: "s-a", task: "Do it", startedAt: 5, endedAt: null };

    const state = normalizePersistedState({ sessions: [{ ...base, delegatedFrom }] });

    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].delegatedFrom).toEqual(delegatedFrom);
  });

  it("drops a malformed delegatedFrom and keeps the session", () => {
    const malformed = [
      5,
      { sessionId: "", task: "x", startedAt: 1 },
      { sessionId: "s-a", task: "", startedAt: 1 },
      { sessionId: "s-a", task: "x", startedAt: "now" },
      { sessionId: "s-a", task: "x", startedAt: 1, endedAt: "later" },
    ];

    for (const delegatedFrom of malformed) {
      const state = normalizePersistedState({ sessions: [{ ...base, delegatedFrom }] });

      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0]).not.toHaveProperty("delegatedFrom");
      expect(state.sessions[0]).toMatchObject({
        id: "s-1",
        name: "Fix login",
        cwd: "/w/api",
        status: "terminated",
        createdAt: 1,
      });
    }
  });
});

describe("normalizeTranscript - delegation report", () => {
  const reply = { id: "m-1", role: "agent", content: "Done.", timestamp: 7 };
  const withReport = (delegationReport: unknown) => [{ ...reply, delegationReport }];

  it("keeps a delegationReport mark and drops a malformed one", () => {
    const [kept] = normalizeTranscript(withReport({ agentName: "Codex" }));
    expect(kept.delegationReport).toEqual({ agentName: "Codex" });

    for (const delegationReport of [{ agentName: 3 }, "Codex"]) {
      const [message] = normalizeTranscript(withReport(delegationReport));
      expect(message).toBeDefined();
      expect(message).not.toHaveProperty("delegationReport");
      expect(message.content).toBe("Done.");
    }

    const [withId] = normalizeTranscript(withReport({ agentName: "Codex", agentId: "codex-acp" }));
    expect(withId.delegationReport).toEqual({ agentName: "Codex", agentId: "codex-acp" });

    const [withoutId] = normalizeTranscript(withReport({ agentName: "Codex", agentId: 3 }));
    expect(withoutId.delegationReport).toEqual({ agentName: "Codex" });
  });
});

describe("normalizeTranscript - delegation task", () => {
  const message = { id: "m-1", role: "user", content: "Review it.", timestamp: 7 };

  it("keeps a delegationTask mark and drops a malformed one", () => {
    const [kept] = normalizeTranscript([{ ...message, delegationTask: { agentName: "pi ACP", agentId: "pi-acp" } }]);
    expect(kept.delegationTask).toEqual({ agentName: "pi ACP", agentId: "pi-acp" });

    const [withoutId] = normalizeTranscript([{ ...message, delegationTask: { agentName: "pi ACP", agentId: 3 } }]);
    expect(withoutId.delegationTask).toEqual({ agentName: "pi ACP" });

    for (const delegationTask of [{ agentName: "" }, "pi", null]) {
      const [dropped] = normalizeTranscript([{ ...message, delegationTask }]);
      expect(dropped).not.toHaveProperty("delegationTask");
      expect(dropped.content).toBe("Review it.");
    }
  });
});

describe("normalizeTranscript - tool diffs", () => {
  const withDiff = (detail: unknown) => [
    { id: "m", role: "agent", content: "", timestamp: 1, tools: [{ id: "t", name: "Edit", status: "completed", details: [detail] }] },
  ];

  it("turns a diff saved with whole files into the rows it shows", () => {
    const [message] = normalizeTranscript(withDiff({ kind: "diff", path: "/r/a.ts", oldText: "a\n", newText: "b\n" }));

    expect(message.tools?.[0].details).toEqual([
      {
        kind: "diff",
        path: "/r/a.ts",
        isNewFile: false,
        rows: [
          { kind: "removed", text: "a" },
          { kind: "added", text: "b" },
        ],
      },
    ]);
  });

  it("marks an old diff with no oldText as a new file, and keeps a diff already saved as rows", () => {
    const rows = [{ kind: "added", text: "x" }];
    const [created] = normalizeTranscript(withDiff({ kind: "diff", path: "/r/n.ts", oldText: null, newText: "x\n" }));
    const [kept] = normalizeTranscript(withDiff({ kind: "diff", path: "/r/k.ts", isNewFile: true, rows }));

    expect(created.tools?.[0].details).toEqual([{ kind: "diff", path: "/r/n.ts", isNewFile: true, rows }]);
    expect(kept.tools?.[0].details).toEqual([{ kind: "diff", path: "/r/k.ts", isNewFile: true, rows }]);
  });

  it("drops a diff it cannot read, keeping the tool", () => {
    const [message] = normalizeTranscript(withDiff({ kind: "diff", path: "/r/x.ts", rows: "nope" }));

    expect(message.tools?.[0].details).toEqual([]);
  });
});
