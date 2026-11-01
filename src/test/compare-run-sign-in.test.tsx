import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, act, fireEvent, renderHook, waitFor, within } from "@testing-library/react";
import { fakeTauriInvoke, type FakeTauriStore } from "./setup";
import { makeProfile } from "./fixtures/agents";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, cb);
    return Promise.resolve(() => listeners.delete(event));
  },
  emit: () => Promise.resolve(),
}));

const notifications = vi.hoisted(() => ({ sent: [] as { title: string; body?: string }[] }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: () => Promise.resolve(true),
  requestPermission: () => Promise.resolve("granted"),
  sendNotification: (options: { title: string; body?: string }) => notifications.sent.push(options),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getAllWindows: () => Promise.resolve([{ isFocused: () => Promise.resolve(false) }]),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon() {}
    open() {}
    focus() {}
    write(_data: string, callback?: () => void) {
      callback?.();
    }
    onData() {
      return { dispose() {} };
    }
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import App from "../App";
import { useAgentSignIn } from "../hooks/useAgentSignIn";
import { useCompareRun, type CompareRunDeps } from "../hooks/useCompareRun";
import { SIGN_IN_RUNNING_NOTICE } from "../lib/agent-sign-in";
import { runFinishedBody } from "../lib/compare-run";
import type { AgentOptions } from "../lib/acp-draft";
import type { Session } from "../types";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
type Args = Record<string, unknown> | undefined;
type Override = (args: Args) => Promise<unknown> | undefined;

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

function fakeStore(): FakeTauriStore {
  return (window as unknown as { __FAKE_TAURI_STORE__: FakeTauriStore }).__FAKE_TAURI_STORE__;
}

const ALL = [
  makeProfile({ id: "claude-acp", name: "Claude Code", detected: true }),
  makeProfile({ id: "qwen-code", name: "Qwen Code", detected: true }),
  makeProfile({ id: "kimi", name: "Kimi CLI", detected: true }),
];

const AUTH_ERROR = `ACP_AUTH_REQUIRED:${JSON.stringify([{ id: "login", name: "Browser" }])}`;
const TERMINAL_AUTH_ERROR = `ACP_AUTH_REQUIRED:${JSON.stringify([{ id: "cli", name: "Terminal", type: "terminal" }])}`;
const TERMINAL_FLOW = { method: "Sign in with Terminal", error: TERMINAL_AUTH_ERROR };

interface Setup {
  /** Commands answered here first; one returning undefined falls through to the fake backend. */
  overrides?: Record<string, Override>;
  agentOptions?: Record<string, AgentOptions>;
  sessions?: Session[];
  defaultAgentId?: string;
}

async function renderApp(setup: Setup = {}) {
  const settings = fakeStore().state.settings as FakeTauriStore["state"]["settings"] & { enabledAgents?: string[] };
  settings.enabledAgents = ALL.map((a) => a.id);
  if (setup.defaultAgentId) settings.defaultAgentId = setup.defaultAgentId;
  if (setup.agentOptions) fakeStore().state.agentOptions = setup.agentOptions;
  if (setup.sessions) fakeStore().state.sessions = setup.sessions;
  let worktreeCalls = 0;
  const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
    const answer = setup.overrides?.[cmd]?.(args);
    if (answer) return answer;
    if (cmd === "get_agent_profiles") return Promise.resolve(structuredClone(ALL));
    if (cmd === "create_session_worktree") {
      worktreeCalls += 1;
      return Promise.resolve({
        path: `/data/worktrees/zorvo/fix-${worktreeCalls}`,
        cwd: `/data/worktrees/zorvo/fix-${worktreeCalls}`,
        branch: `agent/fix-${worktreeCalls}`,
        startCommit: String(worktreeCalls).repeat(40),
      });
    }
    return fakeTauriInvoke(cmd, args);
  });
  await act(async () => {
    render(<App />);
  });
  return spy;
}

type Spy = Awaited<ReturnType<typeof renderApp>>;

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

function prompt(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement;
}

const calls = (spy: Spy, command: string) =>
  spy.mock.calls.filter(([cmd]) => cmd === command).map(([, args]) => args as Record<string, unknown>);

/** The app's id of the session running `profileId`. */
const sessionOf = (spy: Spy, profileId: string) =>
  String(calls(spy, "acp_start_session").find((args) => args.profileId === profileId)?.sessionId);

/** What was sent to one session, in order. */
const promptsTo = (spy: Spy, sessionId: string) =>
  calls(spy, "acp_prompt")
    .filter((args) => args.sessionId === sessionId)
    .map((args) => String(args.text));

async function sendMessage(text: string) {
  await act(async () => {
    fireEvent.change(prompt(), { target: { value: text } });
  });
  await act(async () => {
    fireEvent.keyDown(prompt(), { key: "Enter" });
  });
}

/** Ticks the agents in the Agent chip's menu, on top of the default one, and sends one prompt to them. */
async function startRun(agentNames: string[] = ["Qwen Code"]) {
  await click(await screen.findByRole("button", { name: /^Agent: / }));
  for (const name of agentNames) {
    await click(await screen.findByRole("checkbox", { name: new RegExp(`^Compare ${name}`) }));
  }
  await sendMessage("fix the login");
  await screen.findByRole("region", { name: "Compare run" });
}

async function startedRun(setup: Setup = {}, agentNames?: string[]) {
  const spy = await renderApp(setup);
  await startRun(agentNames);
  await waitFor(() => expect(calls(spy, "acp_prompt")).toHaveLength((agentNames?.length ?? 1) + 1));
  return spy;
}

function acpEvent(payload: Record<string, unknown>) {
  listeners.get("acp-event")?.({ payload });
}

/** The agents refuse their prompts in one tick. */
async function refuse(spy: Spy, profileIds: string[], error = AUTH_ERROR) {
  await act(async () => {
    for (const id of profileIds) acpEvent({ sessionId: sessionOf(spy, id), kind: "turn-end", error });
  });
}

async function finish(spy: Spy, profileId: string) {
  await act(async () => {
    acpEvent({ sessionId: sessionOf(spy, profileId), kind: "turn-end", stopReason: "end_turn" });
  });
}

const rowOf = (name: string) => screen.getByRole("listitem", { name });

const openRow = (name: string) => click(screen.getByRole("button", { name: `Open ${name}` }));

/** The session's button in the sidebar: it changes the session without leaving the composer, as a run's panel does. */
const sidebarRow = (sessionId: string) => within(screen.getByTestId(`session-row-${sessionId}`)).getAllByRole("button")[0];

const signInPanel = (name: string) => screen.queryByRole("region", { name: `Sign in to ${name}` });

async function backToRun() {
  await click(within(screen.getByTestId(/^run-group-/)).getByRole("button"));
  await screen.findByRole("region", { name: "Compare run" });
}

async function pressSignIn(name: string, button = "Sign in with Browser") {
  await click(within(await screen.findByRole("region", { name: `Sign in to ${name}` })).getByRole("button", { name: button }));
}

/** A promise settled from outside, to hold a command open. */
function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets the app's own promises settle: the only way to show that nothing was sent. */
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 20)));

/** A login held open on its first press; the second one goes through at once. */
function heldLogin() {
  const held = deferred();
  let presses = 0;
  const overrides: Record<string, Override> = {
    acp_authenticate: () => {
      presses += 1;
      return presses === 1 ? held.promise : Promise.resolve(null);
    },
  };
  return { held, overrides };
}

describe("a sign-in inside a compare run", () => {
  beforeEach(() => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    listeners.clear();
    notifications.sent.length = 0;
  });

  it("a refused session in a run takes no sign-in slot and puts nothing in the composer", async () => {
    const spy = await startedRun();

    await refuse(spy, ["qwen-code"]);

    expect(signInPanel("Qwen Code")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Prompt" })).toBeNull();
    // The draft's panel shows the one request there is, had this refusal taken it.
    await click(screen.getByRole("button", { name: "+ New session" }));
    await click(await screen.findByRole("button", { name: "Agent: Claude Code" }));
    await click(screen.getByRole("option", { name: "Qwen Code" }));
    expect(prompt().value).toBe("");
    expect(signInPanel("Qwen Code")).toBeNull();
  });

  it("the row reads Needs sign-in", async () => {
    const spy = await startedRun();

    await refuse(spy, ["qwen-code"]);

    expect(within(rowOf("Qwen Code")).getByText("Needs sign-in")).toBeInTheDocument();
    expect(within(rowOf("Claude Code")).queryByText("Needs sign-in")).toBeNull();
  });

  it("two refusals in one tick give two rows", async () => {
    const spy = await startedRun();

    await refuse(spy, ["claude-acp", "qwen-code"]);

    expect(within(rowOf("Claude Code")).getByText("Needs sign-in")).toBeInTheDocument();
    expect(within(rowOf("Qwen Code")).getByText("Needs sign-in")).toBeInTheDocument();
    expect(signInPanel("Claude Code")).toBeNull();
    expect(signInPanel("Qwen Code")).toBeNull();
  });

  it("opening the row asks for that agent's sign-in, and a good sign-in sends its message", async () => {
    const spy = await startedRun();
    await refuse(spy, ["qwen-code"]);
    const sessionId = sessionOf(spy, "qwen-code");

    await openRow("Qwen Code");

    expect(await screen.findByRole("region", { name: "Sign in to Qwen Code" })).toBeInTheDocument();
    expect(prompt().value).toBe("fix the login");
    expect(screen.getByText(/Zorvo sends it again once you are signed in/)).toBeInTheDocument();
    await pressSignIn("Qwen Code");

    await waitFor(() => expect(promptsTo(spy, sessionId)).toHaveLength(2));
    expect(promptsTo(spy, sessionId)[1]).toContain("fix the login");
    expect(prompt().value).toBe("");
    expect(signInPanel("Qwen Code")).toBeNull();
    await backToRun();
    expect(within(rowOf("Qwen Code")).queryByText("Needs sign-in")).toBeNull();
    await settle();
    expect(promptsTo(spy, sessionId)).toHaveLength(2);
  });

  it("signs in a session whose agent refused to open it, with the message it kept", async () => {
    let starts = 0;
    const spy = await renderApp({
      overrides: {
        acp_start_session: (args) => (args?.profileId === "qwen-code" && starts++ === 0 ? Promise.reject(AUTH_ERROR) : undefined),
      },
    });
    await startRun();
    await waitFor(() => expect(within(rowOf("Qwen Code")).getByText("Needs sign-in")).toBeInTheDocument());

    await openRow("Qwen Code");
    await pressSignIn("Qwen Code");

    await waitFor(() => expect(promptsTo(spy, sessionOf(spy, "qwen-code"))).toEqual(["fix the login"]));
    expect(calls(spy, "acp_start_session").filter((args) => args.profileId === "qwen-code")).toHaveLength(2);
  });

  it("a session opened from the sidebar asks too: its message is not left on a row nobody sees", async () => {
    const spy = await startedRun();
    await refuse(spy, ["qwen-code"]);

    await click(within(screen.getByTestId(`session-row-${sessionOf(spy, "qwen-code")}`)).getAllByRole("button")[0]);

    expect(await screen.findByRole("region", { name: "Sign in to Qwen Code" })).toBeInTheDocument();
    expect(prompt().value).toBe("fix the login");
  });

  it("a session refused while it is open signs in where the user is", async () => {
    const spy = await startedRun();
    await openRow("Qwen Code");

    await refuse(spy, ["qwen-code"]);

    expect(await screen.findByRole("region", { name: "Sign in to Qwen Code" })).toBeInTheDocument();
    expect(prompt().value).toBe("fix the login");
  });

  it("a session refused again after its sign-in comes back the same way", async () => {
    const spy = await startedRun();
    await refuse(spy, ["qwen-code"]);
    const sessionId = sessionOf(spy, "qwen-code");
    await openRow("Qwen Code");
    await pressSignIn("Qwen Code");
    await waitFor(() => expect(promptsTo(spy, sessionId)).toHaveLength(2));

    await refuse(spy, ["qwen-code"]);

    expect(await screen.findByRole("region", { name: "Sign in to Qwen Code" })).toBeInTheDocument();
    expect(prompt().value).toBe("fix the login");
    await pressSignIn("Qwen Code");
    await waitFor(() => expect(promptsTo(spy, sessionId)).toHaveLength(3));
  });

  it("a draft's open sign-in is left alone when a run's session is refused", async () => {
    let probes = 0;
    const spy = await renderApp({
      defaultAgentId: "kimi",
      // Only the first answer asks for a sign-in: the panel at the end is that same request, not a new one.
      overrides: { acp_probe_agent: (args) => (args?.profileId === "kimi" && probes++ === 0 ? Promise.reject(AUTH_ERROR) : undefined) },
    });
    expect(await screen.findByRole("region", { name: "Sign in to Kimi CLI" })).toBeInTheDocument();
    await click(await screen.findByRole("button", { name: "Agent: Kimi CLI" }));
    await click(screen.getByRole("option", { name: "Claude Code" }));
    await startRun();
    await waitFor(() => expect(calls(spy, "acp_prompt")).toHaveLength(2));

    await refuse(spy, ["claude-acp", "qwen-code"]);

    await click(screen.getByRole("button", { name: "+ New session" }));
    expect(screen.getByRole("region", { name: "Sign in to Kimi CLI" })).toBeInTheDocument();
    expect(prompt().value).toBe("");
  });

  it("when another sign-in runs, opening the row says so", async () => {
    const { held, overrides } = heldLogin();
    const spy = await startedRun({ overrides });
    await refuse(spy, ["claude-acp", "qwen-code"]);
    await openRow("Claude Code");
    await pressSignIn("Claude Code");
    await backToRun();

    await openRow("Qwen Code");

    expect(await screen.findByText(SIGN_IN_RUNNING_NOTICE)).toBeInTheDocument();
    expect(signInPanel("Qwen Code")).toBeNull();

    // The row keeps its refusal, so the user can try again once the other sign-in is over.
    await backToRun();
    expect(within(rowOf("Qwen Code")).getByText("Needs sign-in")).toBeInTheDocument();
    await act(async () => held.resolve(null));
    await openRow("Qwen Code");
    await pressSignIn("Qwen Code");
    await waitFor(() => expect(promptsTo(spy, sessionOf(spy, "qwen-code"))).toHaveLength(2));
    expect(promptsTo(spy, sessionOf(spy, "qwen-code"))[1]).toContain("fix the login");
  });

  it("a sign-in that fails keeps the message, for the row to try again", async () => {
    let presses = 0;
    const spy = await startedRun({
      overrides: { acp_authenticate: () => (presses++ === 0 ? Promise.reject("the browser closed") : Promise.resolve(null)) },
    });
    await refuse(spy, ["qwen-code"]);
    const sessionId = sessionOf(spy, "qwen-code");
    await openRow("Qwen Code");

    await pressSignIn("Qwen Code");
    await screen.findByText("Sign-in failed: the browser closed");
    expect(promptsTo(spy, sessionId)).toHaveLength(1);

    await backToRun();
    expect(within(rowOf("Qwen Code")).getByText("Needs sign-in")).toBeInTheDocument();
    await openRow("Qwen Code");
    expect(prompt().value).toBe("fix the login");
    await pressSignIn("Qwen Code");
    await waitFor(() => expect(promptsTo(spy, sessionId)).toHaveLength(2));
  });

  it("a sign-in that is cancelled keeps the message, for the row to try again", async () => {
    const spy = await startedRun();
    await refuse(spy, ["qwen-code"], TERMINAL_FLOW.error);
    await openRow("Qwen Code");
    await pressSignIn("Qwen Code", TERMINAL_FLOW.method);
    await screen.findByRole("dialog", { name: "Sign in to Qwen Code" });

    await click(screen.getByRole("button", { name: "Cancel sign-in" }));

    expect(screen.queryByRole("dialog", { name: "Sign in to Qwen Code" })).toBeNull();
    expect(prompt().value).toBe("fix the login");
    await backToRun();
    expect(within(rowOf("Qwen Code")).getByText("Needs sign-in")).toBeInTheDocument();
    await openRow("Qwen Code");
    expect(prompt().value).toBe("fix the login");
    expect(promptsTo(spy, sessionOf(spy, "qwen-code"))).toHaveLength(1);
  });

  it("a panel dismissed keeps the message, and the row asks again", async () => {
    const spy = await startedRun();
    await refuse(spy, ["qwen-code"]);
    await openRow("Qwen Code");

    await click(screen.getByRole("button", { name: "Dismiss sign-in" }));
    await backToRun();

    expect(within(rowOf("Qwen Code")).getByText("Needs sign-in")).toBeInTheDocument();
    await openRow("Qwen Code");
    expect(screen.getByRole("region", { name: "Sign in to Qwen Code" })).toBeInTheDocument();
    expect(prompt().value).toBe("fix the login");
  });

  it("a message the user sends is not sent again by the sign-in", async () => {
    const spy = await startedRun();
    await refuse(spy, ["qwen-code"]);
    const sessionId = sessionOf(spy, "qwen-code");
    await openRow("Qwen Code");

    await act(async () => {
      fireEvent.keyDown(prompt(), { key: "Enter" });
    });
    await waitFor(() => expect(promptsTo(spy, sessionId)).toHaveLength(2));
    await pressSignIn("Qwen Code");
    await settle();

    expect(promptsTo(spy, sessionId)).toHaveLength(2);
    await backToRun();
    expect(within(rowOf("Qwen Code")).queryByText("Needs sign-in")).toBeNull();
  });

  it("a message sent to a session that could not open replaces what its row kept", async () => {
    let starts = 0;
    const spy = await renderApp({
      overrides: {
        acp_start_session: (args) => (args?.profileId === "qwen-code" && starts++ === 0 ? Promise.reject(AUTH_ERROR) : undefined),
      },
    });
    await startRun();
    await waitFor(() => expect(within(rowOf("Qwen Code")).getByText("Needs sign-in")).toBeInTheDocument());
    await openRow("Qwen Code");
    await click(screen.getByRole("button", { name: "Dismiss sign-in" }));

    await act(async () => {
      fireEvent.keyDown(prompt(), { key: "Enter" });
    });

    await waitFor(() => expect(promptsTo(spy, sessionOf(spy, "qwen-code"))).toEqual(["fix the login"]));
    await backToRun();
    expect(within(rowOf("Qwen Code")).queryByText("Needs sign-in")).toBeNull();
  });

  it("the agent counts as needing a sign-in, so the next draft cannot tick it", async () => {
    const spy = await startedRun();

    await refuse(spy, ["qwen-code"]);

    await click(screen.getByRole("button", { name: "+ New session" }));
    await click(await screen.findByRole("button", { name: /^Agent: / }));
    expect(await screen.findByRole("checkbox", { name: /^Compare Qwen Code/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /^Compare Kimi CLI/ })).toBeEnabled();
  });

  it("a message the user changed before the sign-in ended is not sent when its row opens again", async () => {
    const spy = await startedRun();
    await refuse(spy, ["qwen-code"]);
    await openRow("Qwen Code");
    await act(async () => {
      fireEvent.change(prompt(), { target: { value: "fix the logout" } });
    });
    await pressSignIn("Qwen Code");
    await settle();
    expect(promptsTo(spy, sessionOf(spy, "qwen-code"))).toHaveLength(1);

    await backToRun();
    await openRow("Qwen Code");
    await settle();

    expect(promptsTo(spy, sessionOf(spy, "qwen-code"))).toHaveLength(1);
  });

  it.each([
    ["changed", "fix the logout"],
    ["cleared", ""],
  ])("a message the user %s frees its row once the sign-in ends", async (_how, text) => {
    const spy = await startedRun();
    await refuse(spy, ["qwen-code"]);
    await openRow("Qwen Code");
    await act(async () => {
      fireEvent.change(prompt(), { target: { value: text } });
    });

    await pressSignIn("Qwen Code");
    await settle();

    await backToRun();
    expect(within(rowOf("Qwen Code")).queryByText("Needs sign-in")).toBeNull();
    await openRow("Qwen Code");
    await settle();
    expect(promptsTo(spy, sessionOf(spy, "qwen-code"))).toHaveLength(1);
  });

  it("a message sent on coming back leaves the composer empty, so Enter cannot send it again", async () => {
    const { held, overrides } = heldLogin();
    const spy = await startedRun({ overrides });
    await refuse(spy, ["qwen-code"]);
    const sessionId = sessionOf(spy, "qwen-code");
    await openRow("Qwen Code");
    await pressSignIn("Qwen Code");
    await click(sidebarRow(sessionOf(spy, "claude-acp")));
    await act(async () => held.resolve(null));
    await settle();

    await click(sidebarRow(sessionId));

    await waitFor(() => expect(promptsTo(spy, sessionId)).toHaveLength(2));
    expect(prompt().value).toBe("");
  });

  it("text typed in another session stays in the composer when the message goes out", async () => {
    const { held, overrides } = heldLogin();
    const spy = await startedRun({ overrides });
    await refuse(spy, ["qwen-code"]);
    const sessionId = sessionOf(spy, "qwen-code");
    await openRow("Qwen Code");
    await pressSignIn("Qwen Code");
    await click(sidebarRow(sessionOf(spy, "claude-acp")));
    await act(async () => {
      fireEvent.change(prompt(), { target: { value: "a note for Claude Code" } });
    });
    await act(async () => held.resolve(null));
    await settle();

    await click(sidebarRow(sessionId));

    await waitFor(() => expect(promptsTo(spy, sessionId)).toHaveLength(2));
    expect(prompt().value).toBe("a note for Claude Code");
  });

  it("another session's refused message stays in the composer when the row's goes out", async () => {
    const { held, overrides } = heldLogin();
    const spy = await startedRun({ overrides });
    await refuse(spy, ["qwen-code"]);
    const sessionId = sessionOf(spy, "qwen-code");
    await openRow("Qwen Code");
    await pressSignIn("Qwen Code");
    await click(screen.getByRole("button", { name: "+ New session" }));
    await click(await screen.findByRole("button", { name: /^Agent: / }));
    await click(screen.getByRole("option", { name: "Kimi CLI" }));
    await sendMessage("hello");
    await waitFor(() => expect(promptsTo(spy, sessionOf(spy, "kimi"))).toHaveLength(1));
    await refuse(spy, ["kimi"]);
    expect(prompt().value).toBe("hello");
    await act(async () => held.resolve(null));
    await settle();

    await click(sidebarRow(sessionId));

    await waitFor(() => expect(promptsTo(spy, sessionId)).toHaveLength(2));
    expect(prompt().value).toBe("hello");
  });

  it("a sign-in that belongs to another session of the agent is left in the slot when the row's message goes out", async () => {
    const { held, overrides } = heldLogin();
    const spy = await startedRun({ overrides });
    await refuse(spy, ["qwen-code"]);
    const rowSession = sessionOf(spy, "qwen-code");
    await click(screen.getByRole("button", { name: "+ New session" }));
    await click(await screen.findByRole("button", { name: /^Agent: / }));
    await click(screen.getByRole("option", { name: "Qwen Code" }));
    await sendMessage("hello");
    await waitFor(() => expect(calls(spy, "acp_prompt")).toHaveLength(3));
    const otherSession = String(calls(spy, "acp_start_session").at(-1)?.sessionId);
    await act(async () => {
      acpEvent({ sessionId: otherSession, kind: "turn-end", error: AUTH_ERROR });
    });
    await pressSignIn("Qwen Code");
    await backToRun();
    await act(async () => held.resolve(null));
    await settle();

    await openRow("Qwen Code");
    await waitFor(() => expect(promptsTo(spy, rowSession)).toHaveLength(2));

    await click(sidebarRow(otherSession));
    expect(await screen.findByRole("region", { name: "Sign in to Qwen Code" })).toBeInTheDocument();
    expect(screen.getByText("Signed in to Qwen Code. Send your message again.")).toBeInTheDocument();
  });

  it("a row refused again under another session's finished sign-in stops and asks", async () => {
    const { held, overrides } = heldLogin();
    const spy = await startedRun({ overrides });
    await refuse(spy, ["qwen-code"]);
    const rowSession = sessionOf(spy, "qwen-code");
    await click(screen.getByRole("button", { name: "+ New session" }));
    await click(await screen.findByRole("button", { name: /^Agent: / }));
    await click(screen.getByRole("option", { name: "Qwen Code" }));
    await sendMessage("hello");
    await waitFor(() => expect(calls(spy, "acp_prompt")).toHaveLength(3));
    const otherSession = String(calls(spy, "acp_start_session").at(-1)?.sessionId);
    await act(async () => {
      acpEvent({ sessionId: otherSession, kind: "turn-end", error: AUTH_ERROR });
    });
    await pressSignIn("Qwen Code");
    await backToRun();
    await act(async () => held.resolve(null));
    await settle();
    await openRow("Qwen Code");
    await waitFor(() => expect(promptsTo(spy, rowSession)).toHaveLength(2));

    await refuse(spy, ["qwen-code"]);
    await settle();

    expect(promptsTo(spy, rowSession)).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Sign in with Browser" })).toBeEnabled();
    // The other session's message stays too: the run's panel no longer wipes the composer.
    expect(prompt().value).toBe("fix the login\n\nhello");
  });

  it("a rewind replaces what the row kept: coming back does not restore the older message", async () => {
    const spy = await startedRun();
    const sessionId = sessionOf(spy, "qwen-code");
    await finish(spy, "qwen-code");
    await openRow("Qwen Code");
    await sendMessage("and the logout");
    await waitFor(() => expect(promptsTo(spy, sessionId)).toHaveLength(2));
    await refuse(spy, ["qwen-code"]);
    expect(prompt().value).toBe("and the logout");

    const first = screen.getByText("fix the login", { selector: "p" }).closest("[data-testid^='chat-message-']") as HTMLElement;
    await click(within(first).getByRole("button", { name: "Rewind to here" }));
    await click(within(first).getByRole("button", { name: "Confirm rewind" }));
    await waitFor(() => expect(prompt().value).toBe("fix the login"));

    await click(sidebarRow(sessionOf(spy, "claude-acp")));
    await click(sidebarRow(sessionId));
    await settle();

    expect(prompt().value).toBe("fix the login");
  });

  it.each([
    ["pressed after the rewind", false],
    ["already running at the rewind", true],
  ])("a sign-in %s sends no old message and leaves the rewound text", async (_when, isRunning) => {
    const { held, overrides } = heldLogin();
    const spy = await startedRun({ overrides });
    const sessionId = sessionOf(spy, "qwen-code");
    await finish(spy, "qwen-code");
    await openRow("Qwen Code");
    await sendMessage("and the logout");
    await waitFor(() => expect(promptsTo(spy, sessionId)).toHaveLength(2));
    await refuse(spy, ["qwen-code"]);
    expect(prompt().value).toBe("and the logout");
    if (isRunning) await pressSignIn("Qwen Code");

    const first = screen.getByText("fix the login", { selector: "p" }).closest("[data-testid^='chat-message-']") as HTMLElement;
    await click(within(first).getByRole("button", { name: "Rewind to here" }));
    await click(within(first).getByRole("button", { name: "Confirm rewind" }));
    await waitFor(() => expect(prompt().value).toBe("fix the login"));
    if (!isRunning) await pressSignIn("Qwen Code");
    await act(async () => held.resolve(null));
    await settle();

    expect(promptsTo(spy, sessionId)).toHaveLength(2);
    expect(prompt().value).toBe("fix the login");
  });

  it("a message the user changed is left as it is", async () => {
    const spy = await startedRun();
    await refuse(spy, ["qwen-code"]);
    await openRow("Qwen Code");

    await act(async () => {
      fireEvent.change(prompt(), { target: { value: "fix the logout" } });
    });
    await pressSignIn("Qwen Code");
    await settle();

    expect(promptsTo(spy, sessionOf(spy, "qwen-code"))).toHaveLength(1);
    expect(prompt().value).toBe("fix the logout");
  });

  it("opening the row again during its sign-in leaves that sign-in running, and sends once", async () => {
    const { held, overrides } = heldLogin();
    const spy = await startedRun({ overrides });
    await refuse(spy, ["qwen-code"]);
    const sessionId = sessionOf(spy, "qwen-code");
    await openRow("Qwen Code");
    await pressSignIn("Qwen Code");
    await backToRun();

    await openRow("Qwen Code");

    expect(prompt().value).toBe("fix the login");
    expect(within(screen.getByRole("region", { name: "Sign in to Qwen Code" })).getByRole("button", { name: "Sign in with Browser" })).toBeDisabled();
    await act(async () => held.resolve(null));
    await waitFor(() => expect(promptsTo(spy, sessionId)).toHaveLength(2));
    expect(calls(spy, "acp_authenticate")).toHaveLength(1);
    await settle();
    expect(promptsTo(spy, sessionId)).toHaveLength(2);
  });

  it("a sign-in that took while the user was on the panel sends the message when the row opens", async () => {
    const { held, overrides } = heldLogin();
    const spy = await startedRun({ overrides });
    await refuse(spy, ["qwen-code"]);
    const sessionId = sessionOf(spy, "qwen-code");
    await openRow("Qwen Code");
    await pressSignIn("Qwen Code");
    await backToRun();
    await act(async () => held.resolve(null));
    await settle();
    expect(promptsTo(spy, sessionId)).toHaveLength(1);
    expect(within(rowOf("Qwen Code")).getByText("Needs sign-in")).toBeInTheDocument();

    await openRow("Qwen Code");

    await waitFor(() => expect(promptsTo(spy, sessionId)).toHaveLength(2));
    expect(calls(spy, "acp_authenticate")).toHaveLength(1);
    expect(signInPanel("Qwen Code")).toBeNull();
  });

  it("a message that cannot go out waits for its session when the user is in the run's panel", async () => {
    const retry = deferred();
    let starts = 0;
    const spy = await startedRun({
      overrides: {
        acp_start_session: (args) => (args?.profileId === "qwen-code" && starts++ === 1 ? retry.promise : undefined),
      },
    });
    await refuse(spy, ["qwen-code"]);
    await openRow("Qwen Code");
    await pressSignIn("Qwen Code");
    await waitFor(() => expect(starts).toBe(2));
    await backToRun();

    await act(async () => retry.reject("spawn failed"));

    // The panel has no composer and the user is not pulled out of it: the message waits for its session.
    await settle();
    expect(screen.getByRole("region", { name: "Compare run" })).toBeInTheDocument();

    await openRow("Qwen Code");
    await waitFor(() => expect(prompt().value).toBe("fix the login"));
  });

  it("Settings' sweep during a run leaves the kept refusal and the message alone", async () => {
    const known = { modes: null, configOptions: [{ id: "x", name: "x", type: "select", currentValue: "a", options: [] }] };
    const spy = await startedRun({
      agentOptions: { "claude-acp": known, "qwen-code": known } as unknown as Record<string, AgentOptions>,
      overrides: { acp_probe_sign_in: () => Promise.resolve({ reportsStatus: true, signInChecked: true }) },
    });
    await refuse(spy, ["qwen-code"]);
    const sessionId = sessionOf(spy, "qwen-code");

    await click(screen.getByRole("button", { name: /^Settings/ }));
    await click(await screen.findByRole("tab", { name: /Agents/ }));
    await waitFor(() => expect(calls(spy, "acp_probe_sign_in").length).toBeGreaterThan(0));
    await settle();
    await click(screen.getByRole("button", { name: /^Close/ }));

    expect(within(rowOf("Qwen Code")).getByText("Needs sign-in")).toBeInTheDocument();
    expect(signInPanel("Qwen Code")).toBeNull();
    expect(promptsTo(spy, sessionId)).toHaveLength(1);
    await openRow("Qwen Code");
    await pressSignIn("Qwen Code");
    await waitFor(() => expect(promptsTo(spy, sessionId)).toHaveLength(2));
  });

  it("Pick keeps the winner's refusal: its chat opens with the sign-in and the message", async () => {
    const spy = await startedRun();
    await refuse(spy, ["claude-acp", "qwen-code"]);

    await click(screen.getByRole("button", { name: "Pick Qwen Code" }));

    expect(await screen.findByRole("region", { name: "Sign in to Qwen Code" })).toBeInTheDocument();
    expect(prompt().value).toBe("fix the login");
    expect(signInPanel("Claude Code")).toBeNull();
  });

  it("a session outside a run signs in as it did", async () => {
    const spy = await renderApp({ defaultAgentId: "qwen-code" });
    await sendMessage("hello");
    await waitFor(() => expect(calls(spy, "acp_prompt")).toHaveLength(1));
    const sessionId = sessionOf(spy, "qwen-code");

    await refuse(spy, ["qwen-code"]);

    expect(await screen.findByRole("region", { name: "Sign in to Qwen Code" })).toBeInTheDocument();
    expect(prompt().value).toBe("hello");
    await pressSignIn("Qwen Code");
    await waitFor(() => expect(promptsTo(spy, sessionId)).toHaveLength(2));
    expect(prompt().value).toBe("");
  });

  it("the winner of a run signs in as any other session once the run is gone", async () => {
    const spy = await startedRun();
    await finish(spy, "qwen-code");
    await finish(spy, "claude-acp");
    await click(await screen.findByRole("button", { name: "Pick Qwen Code" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Compare run" })).toBeNull());
    await sendMessage("and the logout");
    const sessionId = sessionOf(spy, "qwen-code");
    await waitFor(() => expect(promptsTo(spy, sessionId)).toHaveLength(2));

    await click(screen.getByRole("button", { name: "+ New session" }));
    await refuse(spy, ["qwen-code"]);

    // Not kept for a row that no longer exists: the agent's request waits in the one slot, as for any session.
    await click(screen.getByRole("button", { name: /^Agent: / }));
    await click(screen.getByRole("option", { name: "Qwen Code" }));
    expect(await screen.findByRole("region", { name: "Sign in to Qwen Code" })).toBeInTheDocument();
  });
});

describe("notifications of a compare run", () => {
  beforeEach(() => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    listeners.clear();
    notifications.sent.length = 0;
  });

  it("a run's session sends no finished notification", async () => {
    const spy = await startedRun();

    await finish(spy, "qwen-code");
    await settle();

    expect(notifications.sent).toEqual([]);
  });

  it("one notification when all have settled", async () => {
    const spy = await startedRun({}, ["Qwen Code", "Kimi CLI"]);

    await finish(spy, "qwen-code");
    await finish(spy, "kimi");
    await settle();
    expect(notifications.sent).toEqual([]);
    await finish(spy, "claude-acp");

    await waitFor(() => expect(notifications.sent).toHaveLength(1));
    expect(notifications.sent[0]).toEqual({ title: "fix the login", body: "Compare finished: 3 agents are done." });
    await settle();
    expect(notifications.sent).toHaveLength(1);
  });

  it("counts the rows that are done, and a row that needs a sign-in does not hold the notice back", async () => {
    const spy = await startedRun();

    await finish(spy, "claude-acp");
    await refuse(spy, ["qwen-code"]);

    await waitFor(() => expect(notifications.sent).toHaveLength(1));
    expect(notifications.sent[0].body).toBe("Compare finished: 1 agent is done.");
  });

  it("says each count in the words decided", () => {
    expect(runFinishedBody(0)).toBe("Compare finished: 0 agents are done.");
    expect(runFinishedBody(1)).toBe("Compare finished: 1 agent is done.");
    expect(runFinishedBody(2)).toBe("Compare finished: 2 agents are done.");
  });

  it("a needs-answer notification still comes one by one", async () => {
    const spy = await startedRun();
    const permission = (profileId: string) =>
      act(async () => {
        acpEvent({
          sessionId: sessionOf(spy, profileId),
          kind: "permission",
          requestId: 1,
          toolCall: { title: "Delete build" },
          options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
        });
      });

    await permission("claude-acp");
    await permission("qwen-code");

    await waitFor(() => expect(notifications.sent).toHaveLength(2));
    expect(notifications.sent.map((notice) => notice.body)).toEqual(["Claude Code needs your answer.", "Qwen Code needs your answer."]);
  });

  it("a run that was open when the app started never notifies", async () => {
    const saved = (n: number, profileId: string, status: Session["status"]): Session => ({
      id: `s-${n}`,
      name: "Fix the login",
      profileId,
      cwd: "/Users/test/developer/ai-perpetual-trading",
      status,
      createdAt: n,
      transport: "acp",
      compareRunId: "run-1",
      acpSessionId: `acp-${n}`,
      archivedAt: null,
    });
    await renderApp({ sessions: [saved(1, "claude-acp", "terminated"), saved(2, "qwen-code", "terminated")] });

    await backToRun();
    expect(within(rowOf("Qwen Code")).getByText("Stopped")).toBeInTheDocument();
    await settle();

    expect(notifications.sent).toEqual([]);
  });

  it("a later turn of a settled run notifies as any session does", async () => {
    const spy = await startedRun();
    await finish(spy, "claude-acp");
    await finish(spy, "qwen-code");
    await waitFor(() => expect(notifications.sent).toHaveLength(1));

    await openRow("Qwen Code");
    await sendMessage("and the logout");
    await waitFor(() => expect(promptsTo(spy, sessionOf(spy, "qwen-code"))).toHaveLength(2));
    await finish(spy, "qwen-code");

    await waitFor(() => expect(notifications.sent).toHaveLength(2));
    expect(notifications.sent[1].body).toBe("Qwen Code finished.");
  });

  it("the winner's later turns notify once the run is gone", async () => {
    const spy = await startedRun();
    await finish(spy, "claude-acp");
    await click(await screen.findByRole("button", { name: "Pick Claude Code" }));
    await click(await screen.findByRole("button", { name: "Stop and pick" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Compare run" })).toBeNull());
    await sendMessage("and the logout");
    await waitFor(() => expect(promptsTo(spy, sessionOf(spy, "claude-acp"))).toHaveLength(2));

    await finish(spy, "claude-acp");

    await waitFor(() => expect(notifications.sent.map((notice) => notice.body)).toEqual(["Claude Code finished."]));
  });
});

describe("handBackKept with the slot of another session", () => {
  const methods = [{ id: "login", name: "Browser", kind: "agent" as const }];
  const session = { id: "s-run", profileId: "qwen-code", cwd: "/wt/1" };

  async function signedInSlot(pending?: { sessionId: string; text: string }) {
    const retryAfterSignIn = vi.fn(() => Promise.resolve(true));
    const { result } = renderHook(() =>
      useAgentSignIn({
        agents: [],
        composerRef: { current: null },
        activeSessionIdRef: { current: "" },
        retryAfterSignIn,
        onRestore: () => {},
      }),
    );
    act(() => {
      result.current.auth.requestSignIn("qwen-code", "/wt/1", methods, pending);
    });
    await act(async () => result.current.auth.signIn("login"));
    await waitFor(() => expect(result.current.auth.authRequest?.status).toBe("signed-in"));
    return { result, retryAfterSignIn };
  }

  afterEach(() => vi.restoreAllMocks());

  it("sends the row's message and leaves the slot and its pending untouched", async () => {
    const pending = { sessionId: "s-other", text: "hello" };
    const { result, retryAfterSignIn } = await signedInSlot(pending);

    act(() => result.current.handBackKept(session, methods, { text: "fix the login" }));

    expect(retryAfterSignIn).toHaveBeenCalledWith("s-run", { text: "fix the login" });
    expect(result.current.auth.authRequest).toMatchObject({ status: "signed-in", pending });
  });

  it("a session refused again after that send asks for a sign-in instead of sending once more", async () => {
    const { result, retryAfterSignIn } = await signedInSlot({ sessionId: "s-other", text: "hello" });
    act(() => result.current.handBackKept(session, methods, { text: "fix the login" }));

    act(() => result.current.handBackKept(session, methods, { text: "fix the login" }));

    expect(retryAfterSignIn).toHaveBeenCalledTimes(1);
    expect(result.current.auth.authRequest?.status).toBe("idle");
  });

  it.each([
    ["holds no pending", undefined],
    ["holds this session's", { sessionId: "s-run", text: "fix the login" }],
  ])("closes the slot when it %s", async (_how, pending) => {
    const { result, retryAfterSignIn } = await signedInSlot(pending);

    act(() => result.current.handBackKept(session, methods, { text: "fix the login" }));

    expect(retryAfterSignIn).toHaveBeenCalledTimes(1);
    expect(result.current.auth.authRequest).toBeNull();
  });
});

describe("what useCompareRun keeps of a refusal", () => {
  const session = (n: number, overrides: Partial<Session> = {}): Session => ({
    id: `s-${n}`,
    name: "Fix the login",
    profileId: "qwen-code",
    cwd: `/wt/${n}`,
    status: "running",
    createdAt: n,
    transport: "acp",
    compareRunId: "run-1",
    ...overrides,
  });

  function setup(initial: Session[]) {
    const askSignIn = vi.fn();
    let sessions = initial;
    const deps = (): CompareRunDeps => ({
      repoPath: "/repo",
      baseBranch: undefined,
      agentOptions: undefined,
      startSession: vi.fn(),
      isOnDraft: () => true,
      openRun: vi.fn(),
      setIsBusy: vi.fn(),
      restoreMessage: vi.fn(),
      onStarted: vi.fn(),
      onNotice: vi.fn(),
      archiveSession: vi.fn(),
      readSessions: () => sessions,
      openSession: vi.fn(),
      agentName: (profileId) => profileId,
      sessions,
      sources: { isBusy: () => false, transcripts: {}, failedTurns: {} },
      askSignIn,
      notifyRun: vi.fn(),
    });
    const { result, rerender } = renderHook(() => useCompareRun(deps()));
    const update = (next: Session[]) => {
      sessions = next;
      rerender();
    };
    return { result, update, askSignIn };
  }
  const refused = { methods: [{ id: "login", name: "Browser", kind: "agent" as const }], unsent: { text: "fix the login" } };

  it("keeps two refusals made in one tick", () => {
    const { result } = setup([session(1), session(2)]);

    act(() => {
      result.current.keepSignIn("s-1", refused);
      result.current.keepSignIn("s-2", refused);
    });

    expect([...result.current.signInNeeded.keys()]).toEqual(["s-1", "s-2"]);
  });

  it("takeSignIn asks with what was kept, and keeps it until the message goes out", () => {
    const { result, askSignIn } = setup([session(1), session(2)]);
    act(() => result.current.keepSignIn("s-1", refused));

    act(() => result.current.takeSignIn("s-1"));

    expect(askSignIn).toHaveBeenCalledWith(expect.objectContaining({ id: "s-1" }), refused.methods, refused.unsent);
    expect(result.current.signInNeeded.get("s-1")).toEqual(refused);
    act(() => result.current.dropSignIn("s-1"));
    expect(result.current.signInNeeded.size).toBe(0);
  });

  it("takeSignIn asks nothing for a session that kept no refusal", () => {
    const { result, askSignIn } = setup([session(1), session(2)]);

    act(() => result.current.takeSignIn("s-1"));

    expect(askSignIn).not.toHaveBeenCalled();
  });

  it("an archived session drops its refusal", () => {
    const { result, update } = setup([session(1), session(2), session(3)]);
    act(() => result.current.keepSignIn("s-1", refused));

    update([session(1, { archivedAt: 5 }), session(2), session(3)]);

    expect(result.current.signInNeeded.size).toBe(0);
  });

  it("a deleted session drops its refusal", () => {
    const { result, update } = setup([session(1), session(2), session(3)]);
    act(() => result.current.keepSignIn("s-1", refused));

    update([session(2), session(3)]);

    expect(result.current.signInNeeded.size).toBe(0);
  });

  it("the last session of a run keeps its refusal: nothing else holds the message", () => {
    const { result, update } = setup([session(1), session(2)]);
    act(() => result.current.keepSignIn("s-1", refused));

    update([session(1), session(2, { archivedAt: 5 })]);

    expect(result.current.signInNeeded.has("s-1")).toBe(true);
  });

  it("Pick drops the refusals of the sessions it archives", async () => {
    const sessions = [session(1), session(2), session(3)];
    const { result, update } = setup(sessions);
    act(() => {
      result.current.keepSignIn("s-1", refused);
      result.current.keepSignIn("s-2", refused);
    });

    await act(async () => result.current.pick({ id: "run-1", name: "Fix the login", sessions }, "s-1"));
    update([session(1), session(2, { archivedAt: 5 }), session(3, { archivedAt: 5 })]);

    expect([...result.current.signInNeeded.keys()]).toEqual(["s-1"]);
  });
});
