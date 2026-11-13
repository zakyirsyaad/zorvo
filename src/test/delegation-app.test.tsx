import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent, within, waitFor, configure } from "@testing-library/react";
import type { FakeTauriStore } from "./setup";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, cb);
    return Promise.resolve(() => listeners.delete(event));
  },
  emit: () => Promise.resolve(),
}));

import App from "../App";
import { fakeProfiles, makeProfile } from "./fixtures/agents";

// These tests render the whole app: on a loaded machine a query can take longer
// than Testing Library's 1s default, and a dialog flow longer than 20s.
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 60_000 });

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
type InvokeCall = [string, Record<string, unknown> | undefined, ...unknown[]];

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

function fakeStore(): FakeTauriStore {
  return (window as unknown as { __FAKE_TAURI_STORE__: FakeTauriStore }).__FAKE_TAURI_STORE__;
}

function callsTo(spy: { mock: { calls: unknown[][] } }, cmd: string) {
  return (spy.mock.calls as unknown as InvokeCall[]).filter(([name]) => name === cmd);
}

async function acpEvent(payload: Record<string, unknown>) {
  await act(async () => {
    listeners.get("acp-event")?.({ payload });
    // Stream updates apply once a frame; let that frame land inside act.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The fake backend itself, for mocks that change one command and pass the rest through. */
let realInvoke: TauriInternals["invoke"] = () => Promise.resolve();

/** A third agent, so a delegation can cross agents rather than only sessions. */
const CODEX = makeProfile({ id: "codex-acp", name: "Codex", detected: true });

function agentProfiles() {
  return [...structuredClone(fakeProfiles), structuredClone(CODEX)];
}

async function renderApp() {
  realInvoke = tauriInternals().invoke;
  const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) =>
    cmd === "get_agent_profiles" ? Promise.resolve(agentProfiles()) : realInvoke(cmd, args),
  );
  await act(async () => {
    render(<App />);
  });
  return spy;
}

function prompt(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement;
}

/** Delegates to Codex from A's ⋯ menu; resolves with B's session id once it is started. */
async function delegateToCodex(
  spy: { mock: { calls: unknown[][] } },
  task = "Implement step 2 of the plan",
): Promise<string> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitem", { name: /Delegate to another agent/ }));
  });
  const dialog = await screen.findByRole("dialog", { name: "Delegate to another agent" });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("radio", { name: /Codex/ }));
  });
  await act(async () => {
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Task" }), { target: { value: task } });
  });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Delegate" }));
  });
  await waitFor(() => expect(callsTo(spy, "acp_start_session")).toHaveLength(1));
  return String(callsTo(spy, "acp_start_session")[0][1]?.sessionId);
}

async function type(text: string) {
  await act(async () => {
    fireEvent.change(prompt(), { target: { value: text } });
  });
}

/** A session on screen with a conversation, whose agent is running and takes a prompt. */
function seedSourceSession() {
  fakeStore().state.sessions = [
    {
      id: "s-a",
      name: "Fix login bug",
      profileId: "qwen-code",
      cwd: "/Users/test/developer/ai-perpetual-trading",
      status: "running",
      createdAt: 2,
      transport: "acp",
    },
  ];
  fakeStore().transcripts["s-a"] = [
    { id: "m-a1", role: "user", content: "Refactor the parser", timestamp: 1 },
    { id: "m-a2", role: "agent", content: "Plan: split it in two", timestamp: 2, isComplete: true },
  ];
}

/** What Codex reports about its session, so the dialog's picks have something to reach. */
const CODEX_OPTIONS = {
  modes: {
    currentModeId: "auto",
    availableModes: [
      { id: "auto", name: "Auto review" },
      { id: "ask", name: "Ask before edits" },
      { id: "yolo", name: "YOLO" },
    ],
  },
  configOptions: [
    {
      id: "model",
      name: "Model",
      category: "model",
      currentValue: "gpt-5.5-codex",
      options: [
        { value: "gpt-5.5-codex", name: "gpt-5.5-codex" },
        { value: "gpt-5", name: "gpt-5" },
      ],
    },
    {
      id: "effort",
      name: "Effort",
      category: "thought_level",
      currentValue: "high",
      options: [
        { value: "high", name: "High" },
        { value: "low", name: "Low" },
      ],
    },
  ],
};

/** What Codex's session answers on start, so the picks the dialog made can be applied. */
function codexStartAnswer(args: Record<string, unknown> | undefined) {
  return {
    acpSessionId: `acp-${String(args?.sessionId)}`,
    agentCapabilities: {},
    modes: structuredClone(CODEX_OPTIONS.modes),
    models: null,
    configOptions: structuredClone(CODEX_OPTIONS.configOptions),
  };
}

/**
 * What Claude Code reports: its permission mode is a `mode` config option, not
 * `modes`, and the user configured it to bypass permissions elsewhere.
 */
const CLAUDE_CONFIG_OPTIONS = {
  modes: null,
  configOptions: [
    {
      id: "model",
      name: "Model",
      category: "model",
      currentValue: "opus",
      options: [
        { value: "opus", name: "Opus" },
        { value: "sonnet", name: "Sonnet" },
      ],
    },
    {
      id: "mode",
      name: "Mode",
      category: "mode",
      currentValue: "bypassPermissions",
      options: [
        { value: "default", name: "Default" },
        { value: "acceptEdits", name: "Accept edits" },
        { value: "bypassPermissions", name: "Bypass permissions" },
      ],
    },
  ],
};

/** What Claude Code's session answers on start, in the config-mode shape. */
function claudeStartAnswer(args: Record<string, unknown> | undefined) {
  return {
    acpSessionId: `acp-${String(args?.sessionId)}`,
    agentCapabilities: {},
    modes: null,
    models: null,
    configOptions: structuredClone(CLAUDE_CONFIG_OPTIONS.configOptions),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  listeners.clear();
});

describe("delegating from the app", () => {
  it("Change opens the dialog with the agent and task, and its picks reach B", async () => {
    seedSourceSession();
    fakeStore().state.agentOptions = { "codex-acp": structuredClone(CODEX_OPTIONS) };
    realInvoke = tauriInternals().invoke;
    const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) =>
      cmd === "get_agent_profiles"
        ? Promise.resolve(agentProfiles())
        : cmd === "acp_start_session"
          ? Promise.resolve(codexStartAnswer(args))
          : realInvoke(cmd, args),
    );
    await act(async () => {
      render(<App />);
    });
    await screen.findByText("Refactor the parser");

    await type("@Codex fix it");
    expect(
      await screen.findByText("Codex starts on gpt-5.5-codex · High · Auto review"),
    ).toBeDefined();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Change" }));
    });

    const dialog = screen.getByRole("dialog", { name: "Delegate to another agent" });
    expect(within(dialog).getByRole("radio", { name: /Codex/ })).toBeChecked();
    expect(within(dialog).getByRole("textbox", { name: "Task" })).toHaveValue("fix it");

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Effort: High" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Low" }));
    });
    // The effort comes before the model: another model's effort list is only known once the agent reported it.
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Model: gpt-5.5-codex" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "gpt-5" }));
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Permission mode: Auto review" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: /^YOLO/ }));
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delegate" }));
    });

    await waitFor(() => expect(callsTo(spy, "acp_start_session")).toHaveLength(1));
    const sessionId = String(callsTo(spy, "acp_start_session")[0][1]?.sessionId);
    await waitFor(() =>
      expect(callsTo(spy, "acp_set_config_option").map(([, args]) => args)).toContainEqual({
        sessionId,
        configId: "model",
        value: "gpt-5",
      }),
    );
    expect(callsTo(spy, "acp_set_config_option").map(([, args]) => args)).toContainEqual({
      sessionId,
      configId: "effort",
      value: "low",
    });
    expect(callsTo(spy, "acp_set_mode").map(([, args]) => args)).toContainEqual({
      sessionId,
      modeId: "yolo",
    });
    // The task left the composer with the dialog: it is B's now.
    expect(prompt().value).toBe("");
    expect(screen.queryByRole("dialog", { name: "Delegate to another agent" })).toBeNull();
  });

  it("typing @Codex and a task delegates instead of sending to A", async () => {
    seedSourceSession();
    const spy = await renderApp();
    await screen.findByText("Refactor the parser");

    await type("@Codex fix it");

    const send = await screen.findByRole("button", { name: "Delegate to Codex" });
    await act(async () => {
      fireEvent.click(send);
    });

    await waitFor(() => expect(callsTo(spy, "acp_prompt")).toHaveLength(1));
    const [, promptArgs] = callsTo(spy, "acp_prompt")[0];
    const sessionId = String(callsTo(spy, "acp_start_session")[0][1]?.sessionId);
    expect(promptArgs).toMatchObject({ sessionId });
    expect(String(promptArgs?.text)).toContain("fix it");
    expect(String(promptArgs?.text)).not.toContain("@Codex");
    // A's own session was sent nothing.
    expect(callsTo(spy, "acp_prompt").some(([, args]) => args?.sessionId === "s-a")).toBe(false);
  });

  it("delegating from a session starts the other agent and reports back", async () => {
    seedSourceSession();
    const spy = await renderApp();
    await screen.findByText("Refactor the parser");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "More options" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /Delegate to another agent/ }));
    });

    const dialog = await screen.findByRole("dialog", { name: "Delegate to another agent" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("radio", { name: /Codex/ }));
    });
    await act(async () => {
      fireEvent.change(within(dialog).getByRole("textbox", { name: "Task" }), {
        target: { value: "Implement step 2 of the plan" },
      });
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delegate" }));
    });

    await waitFor(() => expect(callsTo(spy, "acp_prompt")).toHaveLength(1));
    const sessionId = String(callsTo(spy, "acp_start_session")[0][1]?.sessionId);
    expect(callsTo(spy, "acp_prompt")[0][1]).toMatchObject({ sessionId });
    expect(String(callsTo(spy, "acp_prompt")[0][1]?.text)).toContain("Implement step 2 of the plan");

    // B is listed under A, with the quiet line that says where it came from.
    const sidebar = within(screen.getByRole("complementary"));
    expect(await sidebar.findByText("Codex: Implement step 2 of the plan")).toBeDefined();
    const sourceRow = sidebar.getByText("Fix login bug").closest("li") as HTMLElement;
    const delegateRow = sidebar.getByText("Codex: Implement step 2 of the plan").closest("li") as HTMLElement;
    expect(
      sourceRow.compareDocumentPosition(delegateRow) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole("note")).toHaveTextContent("Delegated from Fix login bug · Qwen Code");

    // B's finished turn comes back to A as a report.
    await acpEvent({
      sessionId,
      kind: "update",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Done. Tests pass." },
      },
    });
    await acpEvent({ sessionId, kind: "turn-end", stopReason: "end_turn" });

    await waitFor(() =>
      expect(callsTo(spy, "acp_prompt").filter(([, args]) => args?.sessionId === "s-a")).toHaveLength(1),
    );
    const report = callsTo(spy, "acp_prompt").find(([, args]) => args?.sessionId === "s-a");
    expect(String(report?.[1]?.text)).toMatch(/^Report from Codex/);
  });

  it("a config-mode agent starts in its safe mode when the dialog's mode is untouched", async () => {
    seedSourceSession();
    fakeStore().state.agentOptions = { "claude-acp": structuredClone(CLAUDE_CONFIG_OPTIONS) };
    realInvoke = tauriInternals().invoke;
    const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) =>
      cmd === "get_agent_profiles"
        ? Promise.resolve(agentProfiles())
        : cmd === "acp_start_session"
          ? Promise.resolve(claudeStartAnswer(args))
          : realInvoke(cmd, args),
    );
    await act(async () => {
      render(<App />);
    });
    await screen.findByText("Refactor the parser");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "More options" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /Delegate to another agent/ }));
    });

    const dialog = await screen.findByRole("dialog", { name: "Delegate to another agent" });
    // Claude Code is the first ready agent other than A's Qwen Code, and its mode is a config option.
    expect(within(dialog).getByRole("radio", { name: /Claude Code/ })).toBeChecked();
    // The chip shows the mode the session will start in, not the one configured outside Zorvo.
    expect(within(dialog).getByRole("button", { name: "Permission mode: Default" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.change(within(dialog).getByRole("textbox", { name: "Task" }), {
        target: { value: "Implement step 2 of the plan" },
      });
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delegate" }));
    });

    await waitFor(() => expect(callsTo(spy, "acp_start_session")).toHaveLength(1));
    const sessionId = String(callsTo(spy, "acp_start_session")[0][1]?.sessionId);
    // The safe mode reaches the agent through its mode config option; the configured risky mode does not.
    await waitFor(() =>
      expect(callsTo(spy, "acp_set_config_option").map(([, args]) => args)).toContainEqual({
        sessionId,
        configId: "mode",
        value: "default",
      }),
    );
    expect(callsTo(spy, "acp_set_config_option").map(([, args]) => args)).not.toContainEqual({
      sessionId,
      configId: "mode",
      value: "bypassPermissions",
    });
    expect(callsTo(spy, "acp_set_mode")).toHaveLength(0);
  });

  it("keeps the delegation status region mounted before its line appears", async () => {
    seedSourceSession();
    const spy = await renderApp();
    await screen.findByText("Refactor the parser");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "More options" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /Delegate to another agent/ }));
    });
    const dialog = await screen.findByRole("dialog", { name: "Delegate to another agent" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("radio", { name: /Codex/ }));
    });
    await act(async () => {
      fireEvent.change(within(dialog).getByRole("textbox", { name: "Task" }), {
        target: { value: "Implement step 2 of the plan" },
      });
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delegate" }));
    });
    await waitFor(() => expect(callsTo(spy, "acp_prompt")).toHaveLength(1));

    // B is on screen with no line of its own yet: the live region is mounted, empty and out of layout.
    const canvas = within(screen.getByTestId("chat-canvas-container"));
    // B's first turn also has the canvas's working indicator; the delegation region is the other status.
    const delegationRegion = () => {
      const region = canvas
        .getAllByRole("status")
        .find((element) => element.getAttribute("data-testid") !== "agent-working");
      expect(region).toBeDefined();
      return region as HTMLElement;
    };
    expect(delegationRegion()).toBeEmptyDOMElement();
    expect(delegationRegion()).toHaveClass("sr-only");

    // A, which delegated, has a line while B works: the same region now reads.
    const sidebar = within(screen.getByRole("complementary"));
    await act(async () => {
      fireEvent.click(sidebar.getByText("Fix login bug"));
    });
    await waitFor(() =>
      expect(delegationRegion()).toHaveTextContent("Codex is working on the task you delegated"),
    );
    expect(delegationRegion()).not.toHaveClass("sr-only");
  });

  it("a failed turn in A can be retried while the delegated task runs", async () => {
    seedSourceSession();
    const spy = await renderApp();
    await screen.findByText("Refactor the parser");

    await type("try the parser");
    await act(async () => {
      fireEvent.keyDown(prompt(), { key: "Enter" });
    });
    await waitFor(() => expect(callsTo(spy, "acp_prompt")).toHaveLength(1));
    await acpEvent({ sessionId: "s-a", kind: "turn-end", error: "network is down" });
    expect(await screen.findByRole("button", { name: "Try again" })).toBeDefined();

    // A is between turns, so the delegation starts. B's turn no longer holds A: the user steers it.
    await delegateToCodex(spy);

    const sidebar = within(screen.getByRole("complementary"));
    await act(async () => {
      fireEvent.click(sidebar.getByText("Fix login bug"));
    });
    const tryAgain = await screen.findByRole("button", { name: "Try again" });
    await act(async () => {
      fireEvent.click(tryAgain);
    });

    // The same prompt went to A again.
    await waitFor(() =>
      expect(callsTo(spy, "acp_prompt").filter(([, args]) => args?.sessionId === "s-a")).toHaveLength(2),
    );
  });

  it("an agent's delegate call shows a card, and Allow starts the delegate without leaving the session", async () => {
    seedSourceSession();
    const spy = await renderApp();
    await screen.findByText("Refactor the parser");
    // The agent is in the middle of a turn when it calls the tool.
    await type("then have Codex review it");
    await act(async () => {
      fireEvent.keyDown(prompt(), { key: "Enter" });
    });
    await waitFor(() => expect(callsTo(spy, "acp_prompt")).toHaveLength(1));

    await act(async () => {
      listeners.get("agent-tool-call")?.({
        payload: { callId: "c-1", sessionId: "s-a", tool: "delegate", args: { agent: "Codex", task: "Review the parser split." } },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const heading = await screen.findByRole("heading", { name: "Qwen Code wants to give Codex a task" });
    expect(heading).toBeDefined();
    expect(screen.getByTestId("zorvo-tool-task").textContent).toBe("Review the parser split.");
    expect(callsTo(spy, "agent_tool_respond")).toHaveLength(0);
    expect(callsTo(spy, "acp_start_session")).toHaveLength(0);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Allow for this session" }));
    });

    await waitFor(() => expect(callsTo(spy, "acp_start_session")).toHaveLength(1));
    expect(callsTo(spy, "acp_start_session")[0][1]).toMatchObject({ profileId: "codex-acp", agentTools: false });
    await waitFor(() => expect(callsTo(spy, "agent_tool_respond")).toHaveLength(1));
    const [, answer] = callsTo(spy, "agent_tool_respond")[0];
    expect(answer).toMatchObject({ callId: "c-1", ok: true });
    expect(JSON.parse(String(answer?.text))).toMatchObject({ started: true });
    // The card was Zorvo's: the agent's own permission channel was never used.
    expect(callsTo(spy, "acp_respond_permission")).toHaveLength(0);
    expect(await screen.findByText("Allowed for this session")).toBeDefined();
    // The user is still in A.
    expect(screen.getByText("Refactor the parser")).toBeDefined();

    // A second call in the same session runs with no card: the task goes to the same delegate or is refused while it works.
    await act(async () => {
      listeners.get("agent-tool-call")?.({
        payload: { callId: "c-2", sessionId: "s-a", tool: "delegate", args: { agent: "codex-acp", task: "Also check the tests." } },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(callsTo(spy, "agent_tool_respond")).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "Allow for this session" })).toBeNull();
    expect(callsTo(spy, "acp_start_session")).toHaveLength(1);
  });

  it("Change carries the composer's attachments to the delegated task", async () => {
    seedSourceSession();
    realInvoke = tauriInternals().invoke;
    const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) =>
      cmd === "get_agent_profiles"
        ? Promise.resolve(agentProfiles())
        : cmd === "plugin:dialog|open"
          ? Promise.resolve(["/tmp/spec.md"])
          : realInvoke(cmd, args),
    );
    await act(async () => {
      render(<App />);
    });
    await screen.findByText("Refactor the parser");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
    });
    await type("@Codex fix it");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Change" }));
    });
    const dialog = screen.getByRole("dialog", { name: "Delegate to another agent" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delegate" }));
    });

    await waitFor(() => expect(callsTo(spy, "acp_prompt")).toHaveLength(1));
    expect(callsTo(spy, "acp_prompt")[0][1]).toMatchObject({ attachments: ["/tmp/spec.md"] });
    expect(String(callsTo(spy, "acp_prompt")[0][1]?.text)).toContain("fix it");
    // The task left the composer with its attachment.
    expect(prompt().value).toBe("");
  });

  it("archiving a delegated session ends its link, and unarchiving keeps it ended", async () => {
    seedSourceSession();
    const spy = await renderApp();
    await screen.findByText("Refactor the parser");
    const sessionId = await delegateToCodex(spy);

    const sidebar = within(screen.getByRole("complementary"));
    expect(sidebar.getByText("Codex: Implement step 2 of the plan")).toBeDefined();

    // B's first turn ends, so its row offers Archive, and its one report reaches A.
    await acpEvent({
      sessionId,
      kind: "update",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "First answer." } },
    });
    await acpEvent({ sessionId, kind: "turn-end", stopReason: "end_turn" });
    await waitFor(() =>
      expect(callsTo(spy, "acp_prompt").filter(([, args]) => args?.sessionId === "s-a")).toHaveLength(1),
    );

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId(`session-row-${sessionId}`)).getByRole("button", { name: /More actions for/ }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    });

    const savedSession = () => {
      const sessions = fakeStore().state.sessions as Array<{
        id: string;
        archivedAt?: number | null;
        delegatedFrom?: { endedAt?: number | null };
      }>;
      return sessions.find((session) => session.id === sessionId);
    };
    await waitFor(() => {
      expect(savedSession()?.archivedAt).toEqual(expect.any(Number));
      // The archive ended the link in the same action.
      expect(savedSession()?.delegatedFrom?.endedAt).toEqual(expect.any(Number));
    });

    // A may delegate again: its only delegate's link is ended.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "More options" }));
    });
    expect(screen.getByRole("menuitem", { name: /Delegate to another agent/ })).toBeEnabled();

    // Unarchiving does not reopen the link.
    await act(async () => {
      fireEvent.click(sidebar.getByRole("button", { name: "Archived (1)" }));
    });
    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId(`session-row-${sessionId}`)).getByRole("button", { name: /More actions for/ }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Unarchive" }));
    });
    await waitFor(() => {
      expect(savedSession()?.archivedAt ?? null).toBeNull();
      expect(savedSession()?.delegatedFrom?.endedAt).toEqual(expect.any(Number));
    });

    await act(async () => {
      fireEvent.click(sidebar.getByText("Codex: Implement step 2 of the plan"));
    });
    expect(screen.getByRole("note")).toHaveTextContent("Delegated from Fix login bug · ended");

    // B's next finished turn is not reported: the ended link sends nothing more to A.
    await type("carry on");
    await act(async () => {
      fireEvent.keyDown(prompt(), { key: "Enter" });
    });
    await waitFor(() =>
      expect(callsTo(spy, "acp_prompt").some(([, args]) => args?.sessionId === sessionId)).toBe(true),
    );
    await acpEvent({
      sessionId,
      kind: "update",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Carried on." } },
    });
    await acpEvent({ sessionId, kind: "turn-end", stopReason: "end_turn" });

    // Only the report from before the archive reached A.
    expect(callsTo(spy, "acp_prompt").filter(([, args]) => args?.sessionId === "s-a")).toHaveLength(1);
  });
});