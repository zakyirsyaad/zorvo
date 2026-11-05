import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { AgentCatalog } from "../components/agents/AgentCatalog";
import { AgentCatalogPanel } from "../components/agents/AgentCatalogPanel";
import { AgentSignIn, sessionWarning } from "../components/agents/AgentSignIn";
import { plainReason } from "../lib/agent-sign-in";
import { useAgentSignIn } from "../hooks/useAgentSignIn";
import { useAgentSignInStatus } from "../hooks/useAgentSignInStatus";
import { useSettingsSignIn, type AgentCheck, type SettingsSignIn } from "../hooks/useSettingsSignIn";
import type { AuthRequest } from "../hooks/useAgentAuth";
import type { AuthMethod } from "../lib/acp-auth";
import type { AgentOptions } from "../lib/acp-draft";
import type { SignInState } from "../lib/agent-sign-in";
import type { PersistedState, Settings } from "../types";
import { fakeCatalog } from "./fixtures/catalog";
import { fakeProfiles } from "./fixtures/agents";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

afterEach(() => vi.restoreAllMocks());

/** The arguments of the calls to `cmd` (invoke is also handed an options argument, which is not of interest). */
const argsOf = (spy: { mock: { calls: unknown[][] } }, cmd: string) =>
  spy.mock.calls.filter(([name]) => name === cmd).map(([, args]) => args);

const CWD = "/Users/test/developer/zorvo";

const claudeLogin: AuthMethod = { id: "claude-ai-login", name: "Claude Subscription", kind: "terminal" };
const googleLogin: AuthMethod = { id: "oauth-personal", name: "Log in with Google", kind: "agent" };
const apiKey: AuthMethod = { id: "api-key", name: "API Key", description: "Use an API key", kind: "explain" };

/** A SettingsSignIn the row can be drawn from, overriding only what a test cares about. */
function fakeSignIn(overrides: Partial<SettingsSignIn> = {}): SettingsSignIn {
  return {
    cwd: CWD,
    stateOf: () => "unchecked" as SignInState,
    checkOf: () => ({ phase: "idle" }) as AgentCheck,
    reportsStatusOf: () => undefined,
    methodsOf: () => [],
    requestOf: () => null,
    busyAgentId: null,
    check: vi.fn(),
    signInWith: vi.fn(),
    sweep: vi.fn(),
    terminal: { dialog: null } as unknown as SettingsSignIn["terminal"],
    cancelSignIn: vi.fn(),
    retrySignIn: vi.fn(),
    ...overrides,
  };
}

function renderRow(signIn: SettingsSignIn, agentName = "Claude Agent") {
  render(<AgentSignIn agentId="claude-acp" agentName={agentName} signIn={signIn} />);
}

describe("the sign-in of an agent row", () => {
  it("shows Ready for an agent seen signed in", () => {
    renderRow(fakeSignIn({ stateOf: () => "ready" }));

    expect(screen.getByRole("group", { name: "Claude Agent sign-in" })).toHaveTextContent("Ready");
    expect(screen.queryByRole("button", { name: /^Sign in with/ })).toBeNull();
  });

  it("shows Not checked, and Check sign-in asks for a check", () => {
    const signIn = fakeSignIn();
    renderRow(signIn);

    expect(screen.getByRole("group", { name: "Claude Agent sign-in" })).toHaveTextContent("Not checked");
    fireEvent.click(screen.getByRole("button", { name: "Check sign-in" }));

    expect(signIn.check).toHaveBeenCalledWith("claude-acp");
  });

  it("offers a button for a method Zorvo can run, and runs it", () => {
    const signIn = fakeSignIn({ stateOf: () => "needed", methodsOf: () => [claudeLogin, apiKey] });
    renderRow(signIn);

    expect(screen.getByRole("group", { name: "Claude Agent sign-in" })).toHaveTextContent("Sign in");
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Claude Subscription" }));

    expect(signIn.signInWith).toHaveBeenCalledWith("claude-acp", "claude-ai-login");
    // The key method is explained, with no button and no field to type a key in.
    expect(screen.getByText("Use an API key")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /API Key/ })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("uses a method's name whole when it starts with a verb", () => {
    renderRow(fakeSignIn({ stateOf: () => "needed", methodsOf: () => [googleLogin] }), "Gemini CLI");

    expect(screen.getByRole("button", { name: "Log in with Google" })).toBeInTheDocument();
  });

  it("only explains an agent whose methods all need a key, with no button and no sign-in request", () => {
    renderRow(fakeSignIn({ stateOf: () => "needed", methodsOf: () => [apiKey] }), "Qwen Code");

    expect(screen.getByText("Qwen Code needs an API key or another account setting before it can start.")).toBeInTheDocument();
    expect(screen.getByText(/^Zorvo never stores keys\./)).toBeInTheDocument();
    expect(screen.queryByText(/needs you to sign in/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^(Sign|Log) in/ })).toBeNull();
  });

  it("shows an agent's own setup as text only: Settings does not run it", () => {
    const setup: AuthMethod = { id: "openai", name: "Use OpenAI API key", kind: "setup" };
    renderRow(fakeSignIn({ stateOf: () => "needed", methodsOf: () => [setup] }), "Qwen Code");

    expect(screen.getByText("Use OpenAI API key")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Use OpenAI API key|Open setup/ })).toBeNull();
  });

  it("disables Check sign-in and the sign-in buttons while it works", () => {
    const request = { profileId: "claude-acp", cwd: CWD, methods: [claudeLogin], status: "signing-in" } as AuthRequest;
    renderRow(fakeSignIn({ stateOf: () => "needed", methodsOf: () => [claudeLogin], requestOf: () => request }));

    expect(screen.getByRole("button", { name: "Check sign-in" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sign in with Claude Subscription" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Finish signing in in the window that opened…");
  });

  it("announces a check in progress and its result in one live region", () => {
    const checking = fakeSignIn({ checkOf: () => ({ phase: "checking" }) });
    const { unmount } = render(<AgentSignIn agentId="claude-acp" agentName="Claude Agent" signIn={checking} />);
    expect(screen.getByRole("status")).toHaveTextContent("Checking Claude Agent…");
    expect(screen.getByRole("button", { name: "Check sign-in" })).toBeDisabled();
    unmount();

    renderRow(fakeSignIn({ checkOf: () => ({ phase: "done", message: "Could not check Claude Agent. Try again.", isFailure: true }) }));
    expect(screen.getByRole("status")).toHaveTextContent("Could not check Claude Agent. Try again.");
  });

  it("says a failed sign-in in the live region", () => {
    const request = { profileId: "claude-acp", cwd: CWD, methods: [claudeLogin], status: "failed", error: "Sign-in cancelled" } as AuthRequest;
    renderRow(fakeSignIn({ stateOf: () => "needed", methodsOf: () => [claudeLogin], requestOf: () => request }));

    expect(screen.getByRole("status")).toHaveTextContent("Sign-in failed: Sign-in cancelled");
  });
});

describe("the warning before a check", () => {
  it("says a session stays in the history of an agent that cannot report who is signed in", () => {
    renderRow(fakeSignIn({ reportsStatusOf: () => false }), "Gemini CLI");

    const warning =
      "Gemini CLI cannot say who is signed in, so Zorvo opens a session in the zorvo folder to find out. " +
      "That session may stay in Gemini CLI's history and may run your project's hooks. After you sign in, Zorvo checks the same way.";
    expect(screen.getByText(warning)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check sign-in" })).toHaveAccessibleDescription(warning);
  });

  it("says a session may open while it is not known whether the agent can report", () => {
    expect(sessionWarning("Claude Agent", undefined, CWD)).toBe(
      "If Claude Agent cannot say who is signed in, Zorvo opens a session in the zorvo folder to find out. " +
        "That session may stay in Claude Agent's history and may run your project's hooks. After you sign in, Zorvo checks the same way.",
    );
  });

  it("names the open folder in general words when there is no path", () => {
    expect(sessionWarning("Qwen Code", false)).toContain("a session in the open folder");
  });

  it("says nothing for an agent that reports its sign-in", () => {
    expect(sessionWarning("Codex", true)).toBeNull();
  });
});

const NO_ACTIONS = { addAgent: () => {}, updateAgent: () => {}, removeAgent: () => Promise.resolve(), runningSessionCount: () => 0 };

describe("the catalog", () => {
  it("shows the sign-in on agents in use that can start, not on the others or without controls", () => {
    const props = {
      catalog: { lastChecked: null, agents: fakeCatalog, unavailable: [] },
      error: null,
      agents: fakeProfiles,
      enabledIds: ["claude-acp", "gemini"],
      actions: NO_ACTIONS,
      onCheckAgain: () => Promise.resolve(),
      onRetryLoad: () => {},
    };
    const { rerender } = render(<AgentCatalog {...props} signIn={fakeSignIn()} />);

    // Gemini is in use but not installed: nothing to check yet.
    expect(screen.getAllByRole("group", { name: /sign-in$/ }).map((g) => g.getAttribute("aria-label"))).toEqual([
      "Claude Code sign-in",
    ]);

    rerender(<AgentCatalog {...props} />);
    expect(screen.queryByRole("group", { name: /sign-in$/ })).toBeNull();
  });

  it("asks the agents when the panel opens, once the catalog is loaded", () => {
    const signIn = fakeSignIn();
    const settings = { enabledAgents: ["claude-acp", "codex-acp", "gemini"] } as Settings;
    const handle = {
      catalog: { lastChecked: null, agents: fakeCatalog, unavailable: [] },
      error: null,
      reload: () => Promise.resolve(),
    } as unknown as Parameters<typeof AgentCatalogPanel>[0]["catalog"];

    render(
      <AgentCatalogPanel
        agents={fakeProfiles}
        settings={settings}
        refreshAgents={() => Promise.resolve()}
        catalog={handle}
        actions={NO_ACTIONS}
        signIn={signIn}
      />,
    );

    // Gemini is not installed, so only the two that can start are asked.
    expect(signIn.sweep).toHaveBeenCalledWith(["claude-acp", "codex-acp"]);
  });
});

const KNOWN_OPTIONS = { modes: null, configOptions: [], commands: [{ name: "review" }] } as unknown as AgentOptions;

/** The hook over the real sign-in store, so a check's effect on the sidebar's state can be read. */
function setupHook(
  overrides: {
    cwd?: string | undefined;
    agentOptions?: Record<string, AgentOptions>;
    authRequest?: AuthRequest;
  } = {},
) {
  let state = { settings: { signedInAgents: [] as string[] } as Settings } as PersistedState;
  const updateState = vi.fn((updater: (prev: PersistedState) => PersistedState) => {
    state = updater(state);
  });
  const rememberProbed = vi.fn();
  const startSignIn = vi.fn(() => true);
  const dismiss = vi.fn();
  const cancel = vi.fn();
  const signIn = {
    auth: { authRequest: overrides.authRequest ?? null, dismiss },
    terminal: { dialog: null },
    cancel,
    retryStart: vi.fn(),
    startSignIn,
  } as unknown as Parameters<typeof useSettingsSignIn>[0]["signIn"];
  const hook = renderHook(
    ({ settings }) => {
      const status = useAgentSignInStatus({ settings, updateState });
      const settingsSignIn = useSettingsSignIn({
        cwd: "cwd" in overrides ? overrides.cwd : CWD,
        agents: fakeProfiles,
        agentOptions: overrides.agentOptions,
        rememberProbed,
        status,
        signIn,
      });
      return { status, settingsSignIn };
    },
    { initialProps: { settings: state.settings } },
  );
  // The sidebar reads the same store: what it would show for `id`.
  const sidebarState = (id: string) => hook.result.current.status.stateOf(id);
  const sync = () => hook.rerender({ settings: state.settings });
  return { hook, sync, sidebarState, rememberProbed, startSignIn, dismiss, cancel, signIn };
}

const PROBED = { modes: null, models: null, configOptions: [], commands: [], signInChecked: true, canListSessions: false };
const authRequiredError = (methods: unknown[]) => `ACP_AUTH_REQUIRED:${JSON.stringify(methods)}`;
const claudeMethods = [{ id: "claude-ai-login", name: "Claude Subscription", type: "terminal" }];

describe("Check sign-in", () => {
  it("shows Ready in the row and the sidebar once the agent shows someone signed in", async () => {
    const spy = vi.spyOn(internals(), "invoke").mockResolvedValue(structuredClone(PROBED));
    const { hook, sync, sidebarState, rememberProbed } = setupHook();
    expect(hook.result.current.settingsSignIn.stateOf("claude-acp")).toBe("unchecked");

    act(() => hook.result.current.settingsSignIn.check("claude-acp"));
    expect(hook.result.current.settingsSignIn.checkOf("claude-acp").phase).toBe("checking");
    await waitFor(() => expect(hook.result.current.settingsSignIn.checkOf("claude-acp").phase).toBe("done"));
    sync();

    expect(argsOf(spy, "acp_probe_agent")).toEqual([{ profileId: "claude-acp", cwd: CWD, needsOptions: true }]);
    expect(hook.result.current.settingsSignIn.stateOf("claude-acp")).toBe("ready");
    expect(sidebarState("claude-acp")).toBe("ready");
    // It is not known whether Claude Code reports who is signed in, so nothing is said about who.
    expect(hook.result.current.settingsSignIn.checkOf("claude-acp").message).toBe("Claude Code looks ready.");
    expect(rememberProbed).toHaveBeenCalledTimes(1);
  });

  it("re-reads the login shell's environment, and only that, before it asks the agent", async () => {
    const order: string[] = [];
    vi.spyOn(internals(), "invoke").mockImplementation((cmd) => {
      order.push(cmd);
      return Promise.resolve(cmd === "acp_probe_agent" ? structuredClone(PROBED) : undefined);
    });
    const { hook } = setupHook();

    act(() => hook.result.current.settingsSignIn.check("claude-acp"));
    // The check shows as running from the click, through the re-read.
    expect(hook.result.current.settingsSignIn.checkOf("claude-acp").phase).toBe("checking");
    await waitFor(() => expect(hook.result.current.settingsSignIn.checkOf("claude-acp").phase).toBe("done"));

    // No registry fetch, no npm: get_agent_profiles is not called.
    expect(order).toEqual(["refresh_login_env", "acp_probe_agent"]);
  });

  it("still asks the agent when reading the environment fails", async () => {
    const spy = vi.spyOn(internals(), "invoke").mockImplementation((cmd) =>
      cmd === "refresh_login_env" ? Promise.reject("login shell timed out") : Promise.resolve(structuredClone(PROBED)),
    );
    const { hook } = setupHook();

    act(() => hook.result.current.settingsSignIn.check("claude-acp"));
    await waitFor(() => expect(hook.result.current.settingsSignIn.checkOf("claude-acp").phase).toBe("done"));

    expect(argsOf(spy, "acp_probe_agent")).toHaveLength(1);
    expect(hook.result.current.settingsSignIn.checkOf("claude-acp").message).toBe("Claude Code looks ready.");
  });

  it("does not re-read the environment for the check that runs when Settings opens", async () => {
    const spy = vi.spyOn(internals(), "invoke").mockResolvedValue({ reportsStatus: true, signInChecked: true });
    const { hook } = setupHook({ agentOptions: { "claude-acp": KNOWN_OPTIONS } });

    await act(async () => hook.result.current.settingsSignIn.sweep(["claude-acp"]));

    expect(argsOf(spy, "refresh_login_env")).toHaveLength(0);
  });

  it("only asks about the sign-in when the agent's options are known", async () => {
    const spy = vi.spyOn(internals(), "invoke").mockResolvedValue(structuredClone(PROBED));
    const { hook } = setupHook({ agentOptions: { "claude-acp": KNOWN_OPTIONS } });

    act(() => hook.result.current.settingsSignIn.check("claude-acp"));
    await waitFor(() => expect(hook.result.current.settingsSignIn.checkOf("claude-acp").phase).toBe("done"));

    expect(argsOf(spy, "acp_probe_agent")).toEqual([{ profileId: "claude-acp", cwd: CWD, needsOptions: false }]);
  });

  it("says so when the agent shows nobody and does not mark it ready", async () => {
    vi.spyOn(internals(), "invoke").mockResolvedValue({ ...PROBED, signInChecked: false });
    const { hook, sync } = setupHook();

    act(() => hook.result.current.settingsSignIn.check("claude-acp"));
    await waitFor(() => expect(hook.result.current.settingsSignIn.checkOf("claude-acp").phase).toBe("done"));
    sync();

    expect(hook.result.current.settingsSignIn.stateOf("claude-acp")).toBe("unchecked");
    expect(hook.result.current.settingsSignIn.checkOf("claude-acp").message).toBe(
      "Claude Code did not say whether you are signed in.",
    );
  });

  it("turns the row and the sidebar to Sign in and keeps the methods when the agent asks for a sign-in", async () => {
    vi.spyOn(internals(), "invoke").mockRejectedValue(authRequiredError(claudeMethods));
    const { hook, sync, sidebarState } = setupHook();

    act(() => hook.result.current.settingsSignIn.check("claude-acp"));
    await waitFor(() => expect(hook.result.current.settingsSignIn.checkOf("claude-acp").phase).toBe("done"));
    sync();

    expect(hook.result.current.settingsSignIn.stateOf("claude-acp")).toBe("needed");
    expect(sidebarState("claude-acp")).toBe("needed");
    expect(hook.result.current.settingsSignIn.methodsOf("claude-acp").map((m) => m.id)).toEqual(["claude-ai-login"]);
  });

  it("explains a failed probe in plain words, without the agent's own output", async () => {
    vi.spyOn(internals(), "invoke").mockRejectedValue("Claude Code exited with status 1: /Users/test/.npm/_npx/abc/bin: command not found");
    const { hook } = setupHook();

    act(() => hook.result.current.settingsSignIn.check("claude-acp"));
    await waitFor(() => expect(hook.result.current.settingsSignIn.checkOf("claude-acp").phase).toBe("done"));

    const check = hook.result.current.settingsSignIn.checkOf("claude-acp");
    expect(check.isFailure).toBe(true);
    expect(check.message).toBe("Could not check Claude Code. Make sure it is installed and starts, then try again.");
    expect(check.message).not.toMatch(/npx|exited|\//);
  });

  it("asks for a folder first when none is open, and runs nothing", () => {
    const spy = vi.spyOn(internals(), "invoke").mockResolvedValue(structuredClone(PROBED));
    const { hook } = setupHook({ cwd: undefined });

    act(() => hook.result.current.settingsSignIn.check("claude-acp"));

    expect(spy).not.toHaveBeenCalled();
    expect(hook.result.current.settingsSignIn.checkOf("claude-acp").message).toBe("Open a folder first, then check Claude Code.");
  });

  it("signs in with the methods it found, from the folder shown", async () => {
    vi.spyOn(internals(), "invoke").mockRejectedValue(authRequiredError(claudeMethods));
    const { hook, startSignIn } = setupHook();
    act(() => hook.result.current.settingsSignIn.check("claude-acp"));
    await waitFor(() => expect(hook.result.current.settingsSignIn.methodsOf("claude-acp")).toHaveLength(1));

    act(() => hook.result.current.settingsSignIn.signInWith("claude-acp", "claude-ai-login"));

    expect(startSignIn).toHaveBeenCalledWith(
      { profileId: "claude-acp", cwd: CWD, methods: [{ id: "claude-ai-login", name: "Claude Subscription", kind: "terminal" }] },
      "claude-ai-login",
    );
  });
});

describe("the sign-in check that runs when Settings opens (M6)", () => {
  it("uses the command that never opens a session, never acp_probe_agent", async () => {
    const spy = vi.spyOn(internals(), "invoke").mockResolvedValue({ reportsStatus: true, signInChecked: true });
    const { hook, sync, sidebarState } = setupHook({ agentOptions: { "claude-acp": KNOWN_OPTIONS } });

    act(() => hook.result.current.settingsSignIn.sweep(["claude-acp"]));
    await waitFor(() => expect(hook.result.current.settingsSignIn.reportsStatusOf("claude-acp")).toBe(true));
    await waitFor(() => expect(hook.result.current.settingsSignIn.checkOf("claude-acp").phase).toBe("idle"));
    sync();

    expect(spy.mock.calls.map(([cmd]) => cmd)).toEqual(["acp_probe_sign_in"]);
    expect(argsOf(spy, "acp_probe_sign_in")).toEqual([{ profileId: "claude-acp", cwd: CWD }]);
    expect(sidebarState("claude-acp")).toBe("ready");
  });

  it("marks an agent that says nobody is signed in as needing a sign-in, with its methods", async () => {
    vi.spyOn(internals(), "invoke").mockRejectedValue(authRequiredError(claudeMethods));
    const { hook, sync, sidebarState } = setupHook({ agentOptions: { "claude-acp": KNOWN_OPTIONS } });

    act(() => hook.result.current.settingsSignIn.sweep(["claude-acp"]));
    await waitFor(() => expect(hook.result.current.settingsSignIn.methodsOf("claude-acp")).toHaveLength(1));
    sync();

    expect(sidebarState("claude-acp")).toBe("needed");
  });

  it("remembers that an agent cannot report, and leaves its state alone", async () => {
    vi.spyOn(internals(), "invoke").mockResolvedValue({ reportsStatus: false, signInChecked: false });
    const { hook, sync, sidebarState } = setupHook({ agentOptions: { "qwen-code": KNOWN_OPTIONS } });

    act(() => hook.result.current.settingsSignIn.sweep(["qwen-code"]));
    await waitFor(() => expect(hook.result.current.settingsSignIn.reportsStatusOf("qwen-code")).toBe(false));
    sync();

    expect(sidebarState("qwen-code")).toBe("unchecked");
  });

  it("does not ask an agent whose options are not known, or when no folder is open", () => {
    const spy = vi.spyOn(internals(), "invoke").mockResolvedValue({});
    const unknown = setupHook({ agentOptions: {} });
    const noFolder = setupHook({ cwd: undefined, agentOptions: { "claude-acp": KNOWN_OPTIONS } });

    act(() => unknown.hook.result.current.settingsSignIn.sweep(["claude-acp"]));
    act(() => noFolder.hook.result.current.settingsSignIn.sweep(["claude-acp"]));

    expect(spy).not.toHaveBeenCalled();
  });

  it("does not ask the same agent again within a minute", async () => {
    const spy = vi.spyOn(internals(), "invoke").mockResolvedValue({ reportsStatus: true, signInChecked: true });
    const { hook } = setupHook({ agentOptions: { "claude-acp": KNOWN_OPTIONS } });

    act(() => hook.result.current.settingsSignIn.sweep(["claude-acp"]));
    await waitFor(() => expect(hook.result.current.settingsSignIn.checkOf("claude-acp").phase).toBe("idle"));
    act(() => hook.result.current.settingsSignIn.sweep(["claude-acp"]));

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the agent cannot be reached; the user's own check explains it", async () => {
    vi.spyOn(internals(), "invoke").mockRejectedValue("boom");
    const { hook } = setupHook({ agentOptions: { "claude-acp": KNOWN_OPTIONS } });

    act(() => hook.result.current.settingsSignIn.sweep(["claude-acp"]));
    await waitFor(() => expect(hook.result.current.settingsSignIn.checkOf("claude-acp").phase).toBe("idle"));

    expect(hook.result.current.settingsSignIn.checkOf("claude-acp").message).toBeUndefined();
  });
});

describe("overlaps and leftovers", () => {
  /** A probe that answers when the test says so. */
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }

  it("leaves an agent to the user's own check when the sweep reaches it", async () => {
    const manual = deferred<unknown>();
    const spy = vi.spyOn(internals(), "invoke").mockImplementation((cmd) =>
      cmd === "acp_probe_agent" ? (manual.promise as Promise<unknown>) : Promise.resolve({ reportsStatus: true, signInChecked: true }),
    );
    const { hook } = setupHook({ agentOptions: { "claude-acp": KNOWN_OPTIONS } });

    act(() => hook.result.current.settingsSignIn.check("claude-acp"));
    act(() => hook.result.current.settingsSignIn.sweep(["claude-acp"]));
    await act(async () => {});

    expect(argsOf(spy, "acp_probe_sign_in")).toEqual([]);
    expect(hook.result.current.settingsSignIn.checkOf("claude-acp").phase).toBe("checking");
    await act(async () => manual.resolve(structuredClone(PROBED)));
    await waitFor(() => expect(hook.result.current.settingsSignIn.checkOf("claude-acp").message).toBe("Claude Code looks ready."));
  });

  it("asks the agents a second sweep names once the running sweep ends", async () => {
    const first = deferred<unknown>();
    const spy = vi.spyOn(internals(), "invoke").mockImplementation((_cmd, args) =>
      args?.profileId === "claude-acp" ? (first.promise as Promise<unknown>) : Promise.resolve({ reportsStatus: true, signInChecked: true }),
    );
    const { hook } = setupHook({ agentOptions: { "claude-acp": KNOWN_OPTIONS, "codex-acp": KNOWN_OPTIONS } });

    act(() => hook.result.current.settingsSignIn.sweep(["claude-acp"]));
    act(() => hook.result.current.settingsSignIn.sweep(["claude-acp", "codex-acp"]));
    await act(async () => first.resolve({ reportsStatus: true, signInChecked: true }));

    await waitFor(() => expect(argsOf(spy, "acp_probe_sign_in")).toHaveLength(2));
    expect(argsOf(spy, "acp_probe_sign_in").map((a) => (a as { profileId: string }).profileId)).toEqual(["claude-acp", "codex-acp"]);
  });

  it("does not start an agent again that said it cannot report who is signed in", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const spy = vi.spyOn(internals(), "invoke").mockResolvedValue({ reportsStatus: false, signInChecked: false });
      const { hook } = setupHook({ agentOptions: { "qwen-code": KNOWN_OPTIONS } });
      act(() => hook.result.current.settingsSignIn.sweep(["qwen-code"]));
      await waitFor(() => expect(hook.result.current.settingsSignIn.reportsStatusOf("qwen-code")).toBe(false));
      await waitFor(() => expect(hook.result.current.settingsSignIn.checkOf("qwen-code").phase).toBe("idle"));

      vi.setSystemTime(Date.now() + 5 * 60_000);
      act(() => hook.result.current.settingsSignIn.sweep(["qwen-code"]));

      expect(argsOf(spy, "acp_probe_sign_in")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the result of an earlier sign-in when a new check starts", async () => {
    vi.spyOn(internals(), "invoke").mockResolvedValue(structuredClone(PROBED));
    const earlier = { profileId: "claude-acp", cwd: CWD, methods: [], status: "signed-in" } as AuthRequest;
    const { hook, dismiss } = setupHook({ authRequest: earlier });

    act(() => hook.result.current.settingsSignIn.check("claude-acp"));
    await waitFor(() => expect(hook.result.current.settingsSignIn.checkOf("claude-acp").phase).toBe("done"));

    expect(dismiss).toHaveBeenCalled();
  });

  it("keeps a sign-in that is running when another agent is checked", async () => {
    vi.spyOn(internals(), "invoke").mockResolvedValue(structuredClone(PROBED));
    const running = { profileId: "qwen-code", cwd: CWD, methods: [], status: "signing-in" } as AuthRequest;
    const { hook, dismiss } = setupHook({ authRequest: running });

    act(() => hook.result.current.settingsSignIn.check("claude-acp"));
    await waitFor(() => expect(hook.result.current.settingsSignIn.checkOf("claude-acp").phase).toBe("done"));

    expect(dismiss).not.toHaveBeenCalled();
    expect(hook.result.current.settingsSignIn.busyAgentId).toBe("qwen-code");
  });

  it("keeps a request that still waits, with the message it will send again, when its agent is checked", async () => {
    vi.spyOn(internals(), "invoke").mockResolvedValue(structuredClone(PROBED));
    const waiting = {
      profileId: "claude-acp",
      cwd: CWD,
      methods: [],
      status: "idle",
      pending: { sessionId: "s1", text: "hello" },
    } as AuthRequest;
    const { hook, dismiss } = setupHook({ authRequest: waiting });

    act(() => hook.result.current.settingsSignIn.check("claude-acp"));
    await waitFor(() => expect(hook.result.current.settingsSignIn.checkOf("claude-acp").phase).toBe("done"));

    expect(dismiss).not.toHaveBeenCalled();
  });

  it("clears a failed sign-in's result, but not one that carries a refused message", async () => {
    vi.spyOn(internals(), "invoke").mockResolvedValue(structuredClone(PROBED));
    const failed = { profileId: "claude-acp", cwd: CWD, methods: [], status: "failed", error: "x" } as AuthRequest;
    const plain = setupHook({ authRequest: failed });
    const withMessage = setupHook({ authRequest: { ...failed, pending: { sessionId: "s1", text: "hello" } } });

    act(() => plain.hook.result.current.settingsSignIn.check("claude-acp"));
    act(() => withMessage.hook.result.current.settingsSignIn.check("claude-acp"));
    await waitFor(() => expect(plain.hook.result.current.settingsSignIn.checkOf("claude-acp").phase).toBe("done"));

    expect(plain.dismiss).toHaveBeenCalled();
    expect(withMessage.dismiss).not.toHaveBeenCalled();
  });

  it("clears the request of a sign-in started here when its dialog is cancelled", async () => {
    vi.spyOn(internals(), "invoke").mockRejectedValue(authRequiredError(claudeMethods));
    const { hook, dismiss, cancel } = setupHook();
    act(() => hook.result.current.settingsSignIn.check("claude-acp"));
    await waitFor(() => expect(hook.result.current.settingsSignIn.methodsOf("claude-acp")).toHaveLength(1));
    act(() => hook.result.current.settingsSignIn.signInWith("claude-acp", "claude-ai-login"));

    act(() => hook.result.current.settingsSignIn.cancelSignIn());

    expect(cancel).toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalled();
  });

  it("leaves the draft's request alone when it cancels a login it did not start", () => {
    const { hook, dismiss, cancel } = setupHook();

    act(() => hook.result.current.settingsSignIn.cancelSignIn());

    expect(cancel).toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
  });
});

describe("what a check may and may not claim", () => {
  it("says who is signed in only for an agent known to report it", async () => {
    vi.spyOn(internals(), "invoke").mockImplementation((cmd) =>
      Promise.resolve(cmd === "acp_probe_sign_in" ? { reportsStatus: true, signInChecked: true } : structuredClone(PROBED)),
    );
    const { hook } = setupHook({ agentOptions: { "claude-acp": KNOWN_OPTIONS } });
    act(() => hook.result.current.settingsSignIn.sweep(["claude-acp"]));
    await waitFor(() => expect(hook.result.current.settingsSignIn.reportsStatusOf("claude-acp")).toBe(true));

    act(() => hook.result.current.settingsSignIn.check("claude-acp"));
    await waitFor(() => expect(hook.result.current.settingsSignIn.checkOf("claude-acp").phase).toBe("done"));

    expect(hook.result.current.settingsSignIn.checkOf("claude-acp").message).toBe("You are signed in to Claude Code.");
  });

  it("does not claim it for an agent that only opened a session", async () => {
    vi.spyOn(internals(), "invoke").mockImplementation((cmd) =>
      Promise.resolve(cmd === "acp_probe_sign_in" ? { reportsStatus: false, signInChecked: false } : structuredClone(PROBED)),
    );
    const { hook } = setupHook({ agentOptions: { "qwen-code": KNOWN_OPTIONS } });
    act(() => hook.result.current.settingsSignIn.sweep(["qwen-code"]));
    await waitFor(() => expect(hook.result.current.settingsSignIn.reportsStatusOf("qwen-code")).toBe(false));

    act(() => hook.result.current.settingsSignIn.check("qwen-code"));
    await waitFor(() => expect(hook.result.current.settingsSignIn.checkOf("qwen-code").phase).toBe("done"));

    expect(hook.result.current.settingsSignIn.checkOf("qwen-code").message).toBe(
      "Qwen Code opened a session, so it looks ready. It cannot confirm who is signed in.",
    );
  });
});

describe("a sweep against a sign-in", () => {
  const running = { profileId: "claude-acp", cwd: CWD, methods: [], status: "signing-in" } as AuthRequest;

  it("skips an agent whose sign-in is running", async () => {
    const spy = vi.spyOn(internals(), "invoke").mockResolvedValue({ reportsStatus: true, signInChecked: true });
    const { hook } = setupHook({ agentOptions: { "claude-acp": KNOWN_OPTIONS }, authRequest: running });

    act(() => hook.result.current.settingsSignIn.sweep(["claude-acp"]));
    await act(async () => {});

    expect(argsOf(spy, "acp_probe_sign_in")).toEqual([]);
  });

  /** Starts a sweep whose answer the test holds back, and returns the means to change the sign-in meanwhile. */
  function sweepHeldBack(answerWith: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => void) {
    let settle!: () => void;
    const held = new Promise((resolve, reject) => {
      settle = () => answerWith(resolve, reject);
    });
    vi.spyOn(internals(), "invoke").mockReturnValue(held);
    const setup = setupHook({ agentOptions: { "claude-acp": KNOWN_OPTIONS } });
    act(() => setup.hook.result.current.settingsSignIn.sweep(["claude-acp"]));
    const changeSignIn = (request: AuthRequest) => {
      (setup.signIn.auth as { authRequest: AuthRequest | null }).authRequest = request;
    };
    return { ...setup, changeSignIn, settle };
  }

  it("drops a signed-in answer when a sign-in began while the agent was asked", async () => {
    const { hook, sync, sidebarState, changeSignIn, settle } = sweepHeldBack((resolve) =>
      resolve({ reportsStatus: true, signInChecked: true }),
    );
    changeSignIn(running);

    await act(async () => settle());
    await waitFor(() => expect(hook.result.current.settingsSignIn.reportsStatusOf("claude-acp")).toBe(true));
    sync();

    // What the agent reported is still learned; only the sign-in state it would have set is dropped.
    expect(sidebarState("claude-acp")).toBe("unchecked");
  });

  it("drops a signed-out answer when a sign-in just ended while the agent was asked", async () => {
    const { hook, sync, sidebarState, changeSignIn, settle } = sweepHeldBack((_resolve, reject) =>
      reject(authRequiredError(claudeMethods)),
    );
    changeSignIn({ ...running, status: "signed-in" });

    await act(async () => settle());
    await waitFor(() => expect(hook.result.current.settingsSignIn.checkOf("claude-acp").phase).toBe("idle"));
    sync();

    expect(sidebarState("claude-acp")).toBe("unchecked");
  });
});

describe("the row while another agent signs in", () => {
  it("waits: no button works while another agent's login runs", () => {
    renderRow(fakeSignIn({ stateOf: () => "needed", methodsOf: () => [claudeLogin], busyAgentId: "qwen-code" }));

    expect(screen.getByRole("button", { name: "Check sign-in" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sign in with Claude Subscription" })).toBeDisabled();
  });

  it("shows a failure reason only when it reads as a sentence", () => {
    expect(plainReason("Claude Code still says you are signed out")).toBe("Claude Code still says you are signed out");
    for (const raw of ["spawn /Users/test/.npm/_npx/x/bin/claude ENOENT", "line one\nline two", "", undefined, "x".repeat(200)]) {
      expect(plainReason(raw)).toBe("Zorvo could not finish the sign-in. Try again.");
    }
  });

  it("takes the focus back when the login's dialog closes and the sign-in button is gone", () => {
    const request = { profileId: "claude-acp", cwd: CWD, methods: [claudeLogin], status: "signing-in" } as AuthRequest;
    const open = fakeSignIn({ requestOf: () => request, terminal: { dialog: {} } as unknown as SettingsSignIn["terminal"] });
    const { rerender } = render(<AgentSignIn agentId="claude-acp" agentName="Claude Agent" signIn={open} />);

    rerender(<AgentSignIn agentId="claude-acp" agentName="Claude Agent" signIn={fakeSignIn({ stateOf: () => "ready" })} />);

    expect(screen.getByRole("group", { name: "Claude Agent sign-in" })).toHaveFocus();
  });
});

describe("a sign-in started from Settings", () => {
  function setupSignIn() {
    const focus = vi.fn();
    const onSignedIn = vi.fn();
    const onSignInNeeded = vi.fn();
    const hook = renderHook(() =>
      useAgentSignIn({
        agents: fakeProfiles,
        composerRef: { current: { focus } as never },
        activeSessionIdRef: { current: undefined },
        retryAfterSignIn: () => Promise.resolve(true),
        onRestore: vi.fn(),
        isHeldFor: () => false,
        onSignInNeeded,
        onSignedIn,
      }),
    );
    return { hook, focus, onSignedIn, onSignInNeeded };
  }

  it("runs the method, marks the agent signed in, and leaves focus out of the composer", async () => {
    const spy = vi.spyOn(internals(), "invoke").mockImplementation((cmd) =>
      Promise.resolve(cmd === "acp_probe_agent" ? structuredClone(PROBED) : undefined),
    );
    const { hook, focus, onSignedIn } = setupSignIn();
    const googleMethods: AuthMethod[] = [googleLogin];

    act(() => hook.result.current.startSignIn({ profileId: "claude-acp", cwd: CWD, methods: googleMethods }, "oauth-personal"));
    await waitFor(() => expect(hook.result.current.auth.authRequest?.status).toBe("signed-in"));

    expect(argsOf(spy, "acp_authenticate")).toEqual([{ profileId: "claude-acp", cwd: CWD, methodId: "oauth-personal" }]);
    expect(onSignedIn).toHaveBeenCalledWith("claude-acp");
    expect(focus).not.toHaveBeenCalled();
  });

  it("shows a refused login as failed, with the agent still needing a sign-in", async () => {
    vi.spyOn(internals(), "invoke").mockImplementation((cmd) =>
      cmd === "acp_authenticate" ? Promise.reject("login refused") : Promise.resolve(undefined),
    );
    const { hook, onSignInNeeded, onSignedIn } = setupSignIn();

    act(() => hook.result.current.startSignIn({ profileId: "claude-acp", cwd: CWD, methods: [googleLogin] }, "oauth-personal"));
    await waitFor(() => expect(hook.result.current.auth.authRequest?.status).toBe("failed"));

    expect(onSignInNeeded).toHaveBeenCalledWith("claude-acp");
    expect(onSignedIn).not.toHaveBeenCalled();
  });
});

describe("a sign-in that is running is not cut off", () => {
  const qwenMethods: AuthMethod[] = [{ id: "qwen-oauth", name: "Qwen login", kind: "agent" }];

  /** A login of Claude Code that never ends, so its request stays `signing-in`. */
  async function claudeSigningIn() {
    const spy = vi.spyOn(internals(), "invoke").mockImplementation(() => new Promise(() => {}));
    const setup = setupSignIn();
    act(() => {
      setup.hook.result.current.startSignIn({ profileId: "claude-acp", cwd: CWD, methods: [googleLogin] }, "oauth-personal");
    });
    await waitFor(() => expect(setup.hook.result.current.auth.authRequest?.status).toBe("signing-in"));
    return { ...setup, spy };
  }

  function setupSignIn() {
    const onSignInNeeded = vi.fn();
    const onSignInBlocked = vi.fn();
    const giveBack = vi.fn();
    const hook = renderHook(() =>
      useAgentSignIn({
        agents: fakeProfiles,
        composerRef: { current: { focus: vi.fn(), giveBack } as never },
        activeSessionIdRef: { current: "s2" },
        retryAfterSignIn: () => Promise.resolve(true),
        onRestore: vi.fn(),
        isHeldFor: () => false,
        onSignInNeeded,
        onSignInBlocked,
        onSignedIn: vi.fn(),
      }),
    );
    return { hook, onSignInNeeded, onSignInBlocked, giveBack };
  }

  it("refuses another agent's request, but remembers that it needs a sign-in", async () => {
    const { hook, onSignInNeeded } = await claudeSigningIn();

    let opened = true;
    act(() => {
      opened = hook.result.current.auth.requestSignIn("qwen-code", CWD, qwenMethods);
    });

    expect(opened).toBe(false);
    expect(hook.result.current.auth.authRequest?.profileId).toBe("claude-acp");
    expect(hook.result.current.auth.authRequest?.status).toBe("signing-in");
    expect(onSignInNeeded).toHaveBeenCalledWith("qwen-code");
  });

  it("keeps the login when a session of another agent hands its refusal back, and tells the user why", async () => {
    const { hook, onSignInBlocked, giveBack } = await claudeSigningIn();

    act(() => hook.result.current.handBack({ id: "s2", profileId: "qwen-code", cwd: CWD }, qwenMethods, { text: "hello" }));

    expect(hook.result.current.auth.authRequest?.profileId).toBe("claude-acp");
    expect(onSignInBlocked).toHaveBeenCalledWith("Another agent's sign-in is running. Finish it, then try again.");
    // The message is not lost: it is back where the user wrote it.
    expect(giveBack).toHaveBeenCalledWith("hello", undefined);
  });

  it("does not start a Settings login for another agent, and runs no login for it", async () => {
    const { hook, spy } = await claudeSigningIn();
    const callsBefore = argsOf(spy, "acp_authenticate").length;

    let started = true;
    act(() => {
      started = hook.result.current.startSignIn({ profileId: "qwen-code", cwd: CWD, methods: qwenMethods }, "qwen-oauth");
    });

    expect(started).toBe(false);
    expect(argsOf(spy, "acp_authenticate")).toHaveLength(callsBefore);
    expect(hook.result.current.auth.authRequest?.profileId).toBe("claude-acp");
  });

  it("still replaces the request of the same agent, and any request that is not running", async () => {
    const { hook } = await claudeSigningIn();

    let sameAgent = false;
    act(() => {
      sameAgent = hook.result.current.auth.requestSignIn("claude-acp", CWD, [claudeLogin]);
    });
    expect(sameAgent).toBe(true);
    expect(hook.result.current.auth.authRequest?.status).toBe("idle");

    let otherAgent = false;
    act(() => {
      otherAgent = hook.result.current.auth.requestSignIn("qwen-code", CWD, qwenMethods);
    });
    expect(otherAgent).toBe(true);
    expect(hook.result.current.auth.authRequest?.profileId).toBe("qwen-code");
  });
});

describe("Try again after a failed login from Settings", () => {
  it("runs the same agent and the same method once more", async () => {
    let attempts = 0;
    const spy = vi.spyOn(internals(), "invoke").mockImplementation((cmd) => {
      if (cmd !== "acp_authenticate") return Promise.resolve(structuredClone(PROBED));
      attempts += 1;
      return attempts === 1 ? Promise.reject("login refused") : Promise.resolve(undefined);
    });
    const hook = renderHook(() =>
      useAgentSignIn({
        agents: fakeProfiles,
        composerRef: { current: { focus: vi.fn() } as never },
        activeSessionIdRef: { current: undefined },
        retryAfterSignIn: () => Promise.resolve(true),
        onRestore: vi.fn(),
        isHeldFor: () => false,
      }),
    );
    act(() => {
      hook.result.current.startSignIn({ profileId: "claude-acp", cwd: CWD, methods: [googleLogin] }, "oauth-personal");
    });
    await waitFor(() => expect(hook.result.current.auth.authRequest?.status).toBe("failed"));

    act(() => hook.result.current.retryStart());
    await waitFor(() => expect(hook.result.current.auth.authRequest?.status).toBe("signed-in"));

    const sent = { profileId: "claude-acp", cwd: CWD, methodId: "oauth-personal" };
    expect(argsOf(spy, "acp_authenticate")).toEqual([sent, sent]);
  });
});
