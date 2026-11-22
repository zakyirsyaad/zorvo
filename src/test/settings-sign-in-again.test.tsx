import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { AgentCatalogRow } from "../components/agents/AgentCatalogRow";
import { useAgentSignInStatus } from "../hooks/useAgentSignInStatus";
import { useSettingsSignIn, type AgentCheck, type SettingsSignIn } from "../hooks/useSettingsSignIn";
import type { AuthRequest } from "../hooks/useAgentAuth";
import type { AuthMethod } from "../lib/acp-auth";
import type { SignInState } from "../lib/agent-sign-in";
import type { PersistedState, Settings } from "../types";
import { makeCatalogAgent } from "./fixtures/catalog";
import { fakeProfiles } from "./fixtures/agents";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

afterEach(() => vi.restoreAllMocks());

const CWD = "/Users/test/developer/zorvo";
const argsOf = (spy: { mock: { calls: unknown[][] } }, cmd: string) =>
  spy.mock.calls.filter(([name]) => name === cmd).map(([, args]) => args);

const claudeLogin: AuthMethod = { id: "claude-ai-login", name: "Claude Subscription", kind: "terminal" };
const apiKey: AuthMethod = { id: "api-key", name: "API Key", description: "Use an API key", kind: "explain" };

type Again = "closed" | "reading" | "open";

function fakeSignIn(overrides: Partial<SettingsSignIn> = {}): SettingsSignIn {
  return {
    cwd: CWD,
    stateOf: () => "ready" as SignInState,
    checkOf: () => ({ phase: "idle" }) as AgentCheck,
    reportsStatusOf: () => true,
    methodsOf: () => [],
    requestOf: () => null,
    busyAgentId: null,
    check: vi.fn(),
    signInWith: vi.fn(),
    sweep: vi.fn(),
    againOf: () => "closed" as Again,
    openAgain: vi.fn(),
    closeAgain: vi.fn(),
    terminal: { dialog: null } as unknown as SettingsSignIn["terminal"],
    cancelSignIn: vi.fn(),
    retrySignIn: vi.fn(),
    ...overrides,
  };
}

function rowFor(signIn: SettingsSignIn, status: "by_zorvo" | "not_installed" = "by_zorvo") {
  return (
    <ul>
      <AgentCatalogRow
        agent={makeCatalogAgent({ id: "codex-acp", name: "Codex", version: "1.0.0", status })}
        isInUse
        plan={null}
        runningSessionCount={0}
        removeError={null}
        signIn={signIn}
        onAdd={() => {}}
        onUpdate={() => {}}
        onRemove={() => {}}
      />
    </ul>
  );
}

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "More actions for Codex" }));

describe("the row's Sign in again", () => {
  it("is in the menu of a Ready agent that can start, and asks to open the list", () => {
    const signIn = fakeSignIn();
    render(rowFor(signIn));

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign in again" }));

    expect(signIn.openAgain).toHaveBeenCalledWith("codex-acp");
  });

  it("is not offered for an agent that cannot start", () => {
    render(rowFor(fakeSignIn(), "not_installed"));

    openMenu();

    expect(screen.queryByRole("menuitem", { name: /^Sign in again/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Remove" })).toBeInTheDocument();
  });

  it("is not offered while the agent already shows its sign-in methods", () => {
    render(rowFor(fakeSignIn({ stateOf: () => "needed", methodsOf: () => [claudeLogin] })));

    openMenu();

    expect(screen.queryByRole("menuitem", { name: /^Sign in again/ })).toBeNull();
  });

  it("lists the methods while the row still reads Ready", () => {
    render(rowFor(fakeSignIn({ againOf: () => "open", methodsOf: () => [claudeLogin, apiKey] })));

    expect(screen.getByText(/^Sign-in:/).parentElement).toHaveTextContent("Sign-in: Ready");
    expect(screen.getByRole("button", { name: "Sign in with Claude Subscription" })).toBeInTheDocument();
    expect(screen.getByText("Use an API key")).toBeInTheDocument();
  });

  it("runs a method from the list as a needed agent's list does", () => {
    const signIn = fakeSignIn({ againOf: () => "open", methodsOf: () => [claudeLogin] });
    render(rowFor(signIn));

    fireEvent.click(screen.getByRole("button", { name: "Sign in with Claude Subscription" }));

    expect(signIn.signInWith).toHaveBeenCalledWith("codex-acp", "claude-ai-login");
  });

  it("reads Hide sign-in options while the list is open, and puts it away", () => {
    const signIn = fakeSignIn({ againOf: () => "open", methodsOf: () => [claudeLogin] });
    render(rowFor(signIn));

    openMenu();
    expect(screen.queryByRole("menuitem", { name: "Sign in again" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide sign-in options" }));

    expect(signIn.closeAgain).toHaveBeenCalledWith("codex-acp");
    expect(signIn.openAgain).not.toHaveBeenCalled();
  });

  it("moves focus to the first control when the list opens, and back to the menu button when it closes", () => {
    let again: Again = "closed";
    const signIn = () => fakeSignIn({ againOf: () => again, methodsOf: () => [claudeLogin] });
    const { rerender } = render(rowFor(signIn()));

    again = "open";
    rerender(rowFor(signIn()));
    expect(screen.getByRole("button", { name: "Sign in with Claude Subscription" })).toHaveFocus();

    again = "closed";
    rerender(rowFor(signIn()));
    expect(screen.getByRole("button", { name: "More actions for Codex" })).toHaveFocus();
  });

  it("says in the live region that the options are being read", () => {
    render(rowFor(fakeSignIn({ againOf: () => "reading" })));

    expect(screen.getByRole("status")).toHaveTextContent("Reading Codex's sign-in options…");
  });

  it("says plainly when the agent offers no sign-in Zorvo can start", () => {
    render(rowFor(fakeSignIn({ againOf: () => "open", methodsOf: () => [] })));

    expect(screen.getByText("Codex offers no sign-in Zorvo can start. Set it up in a terminal.")).toBeInTheDocument();
  });

  it("is blocked, with the reason, while another agent's sign-in runs", () => {
    render(rowFor(fakeSignIn({ busyAgentId: "gemini-cli" })));

    openMenu();
    const item = screen.getByRole("menuitem", { name: /^Sign in again/ });

    expect(item).toBeDisabled();
    expect(item).toHaveAccessibleDescription("Another agent's sign-in is running. Finish it, then try again.");
  });
});

describe("an agent's own setup in the list", () => {
  const setup: AuthMethod = { id: "openai", name: "Use OpenAI API key", description: "Pick a provider", kind: "setup" };

  it("has a button that starts the setup with the agent and method ids only, and says what it opens", () => {
    const signIn = fakeSignIn({ againOf: () => "open", methodsOf: () => [setup] });
    render(rowFor(signIn));

    const button = screen.getByRole("button", { name: "Open setup in terminal" });
    expect(button).toHaveTextContent(/^Set up$/);
    expect(screen.getByText("Pick a provider")).toBeInTheDocument();
    expect(screen.getByText("Opens Codex's own setup in a terminal.")).toBeInTheDocument();
    fireEvent.click(button);

    expect(signIn.signInWith).toHaveBeenCalledWith("codex-acp", "openai");
    expect(screen.queryByText("Codex offers no sign-in Zorvo can start. Set it up in a terminal.")).toBeNull();
  });

  it("is blocked while another agent's sign-in runs", () => {
    render(rowFor(fakeSignIn({ againOf: () => "open", methodsOf: () => [setup], busyAgentId: "gemini-cli" })));

    expect(screen.getByRole("button", { name: "Open setup in terminal" })).toBeDisabled();
  });
});

const KNOWN_METHODS = [
  { id: "claude-ai-login", name: "Claude Subscription", type: "terminal" },
  { id: "api-key", name: "API Key", type: "env_var" },
];

function setupHook(authRequest?: AuthRequest, initialSigned: string[] = ["codex-acp"], cwd: string | null = CWD) {
  let state = { settings: { signedInAgents: initialSigned } as Settings } as PersistedState;
  const updateState = vi.fn((updater: (prev: PersistedState) => PersistedState) => {
    state = updater(state);
  });
  const dismiss = vi.fn();
  const startSignIn = vi.fn(() => true);
  const signIn = {
    auth: { authRequest: authRequest ?? null, dismiss },
    terminal: { dialog: null },
    cancel: vi.fn(),
    retryStart: vi.fn(),
    startSignIn,
  } as unknown as Parameters<typeof useSettingsSignIn>[0]["signIn"];
  const hook = renderHook(
    ({ settings, request }: { settings: Settings; request: AuthRequest | null }) => {
      const status = useAgentSignInStatus({ settings, updateState });
      const live = { ...signIn, auth: { ...signIn.auth, authRequest: request } } as typeof signIn;
      return useSettingsSignIn({ cwd: cwd ?? undefined, agents: fakeProfiles, agentOptions: undefined, rememberProbed: vi.fn(), status, signIn: live });
    },
    { initialProps: { settings: state.settings, request: authRequest ?? null } },
  );
  const rerender = (request: AuthRequest | null = authRequest ?? null) => hook.rerender({ settings: state.settings, request });
  return { hook, rerender, startSignIn, dismiss };
}

describe("useSettingsSignIn's Sign in again", () => {
  it("asks the agent without a session for methods it does not know, once, and lists them", async () => {
    const spy = vi
      .spyOn(internals(), "invoke")
      .mockResolvedValue({ reportsStatus: true, signInChecked: true, authMethods: KNOWN_METHODS });
    const { hook } = setupHook();

    act(() => hook.result.current.openAgain("codex-acp"));
    expect(hook.result.current.againOf("codex-acp")).toBe("reading");
    await waitFor(() => expect(hook.result.current.againOf("codex-acp")).toBe("open"));
    act(() => hook.result.current.closeAgain("codex-acp"));
    act(() => hook.result.current.openAgain("codex-acp"));

    expect(spy.mock.calls.map(([cmd]) => cmd)).toEqual(["acp_probe_sign_in"]);
    expect(argsOf(spy, "acp_probe_sign_in")).toEqual([{ profileId: "codex-acp", cwd: CWD }]);
    expect(hook.result.current.methodsOf("codex-acp").map((m) => [m.id, m.kind])).toEqual([
      ["claude-ai-login", "terminal"],
      ["api-key", "explain"],
    ]);
  });

  it("uses methods it already knows without asking the backend", async () => {
    const spy = vi.spyOn(internals(), "invoke").mockRejectedValue(`ACP_AUTH_REQUIRED:${JSON.stringify(KNOWN_METHODS)}`);
    const request = { profileId: "codex-acp", cwd: CWD, methods: [claudeLogin], status: "idle" } as AuthRequest;
    const { hook } = setupHook(request);

    act(() => hook.result.current.openAgain("codex-acp"));

    expect(hook.result.current.againOf("codex-acp")).toBe("open");
    expect(spy).not.toHaveBeenCalled();
  });

  it("opens with no methods when the agent offers none", async () => {
    vi.spyOn(internals(), "invoke").mockResolvedValue({ reportsStatus: false, signInChecked: false, authMethods: [] });
    const { hook } = setupHook();

    act(() => hook.result.current.openAgain("codex-acp"));
    await waitFor(() => expect(hook.result.current.againOf("codex-acp")).toBe("open"));

    expect(hook.result.current.methodsOf("codex-acp")).toEqual([]);
  });

  it("does not open while another agent's sign-in runs", () => {
    const spy = vi.spyOn(internals(), "invoke").mockResolvedValue({ authMethods: KNOWN_METHODS });
    const running = { profileId: "gemini-cli", cwd: CWD, methods: [], status: "signing-in" } as AuthRequest;
    const { hook } = setupHook(running);

    act(() => hook.result.current.openAgain("codex-acp"));

    expect(hook.result.current.againOf("codex-acp")).toBe("closed");
    expect(spy).not.toHaveBeenCalled();
  });

  it("puts the list away when the user hides it, even while it is still being read", async () => {
    let answer: (value: unknown) => void = () => {};
    vi.spyOn(internals(), "invoke").mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { hook } = setupHook();

    act(() => hook.result.current.openAgain("codex-acp"));
    act(() => hook.result.current.closeAgain("codex-acp"));
    await act(async () => answer({ reportsStatus: true, signInChecked: false, authMethods: KNOWN_METHODS }));

    expect(hook.result.current.againOf("codex-acp")).toBe("closed");
  });

  it("closes the list when a sign-in started from it ends with the agent Ready", async () => {
    vi.spyOn(internals(), "invoke").mockResolvedValue({ reportsStatus: true, signInChecked: false, authMethods: KNOWN_METHODS });
    const { hook, rerender } = setupHook();
    act(() => hook.result.current.openAgain("codex-acp"));
    await waitFor(() => expect(hook.result.current.againOf("codex-acp")).toBe("open"));

    act(() => hook.result.current.signInWith("codex-acp", "claude-ai-login"));
    rerender({ profileId: "codex-acp", cwd: CWD, methods: [claudeLogin], status: "signed-in" } as AuthRequest);

    await waitFor(() => expect(hook.result.current.againOf("codex-acp")).toBe("closed"));
  });

  it("keeps the list when the sign-in failed", async () => {
    vi.spyOn(internals(), "invoke").mockResolvedValue({ reportsStatus: true, signInChecked: false, authMethods: KNOWN_METHODS });
    const { hook, rerender } = setupHook();
    act(() => hook.result.current.openAgain("codex-acp"));
    await waitFor(() => expect(hook.result.current.againOf("codex-acp")).toBe("open"));

    act(() => hook.result.current.signInWith("codex-acp", "claude-ai-login"));
    rerender({ profileId: "codex-acp", cwd: CWD, methods: [claudeLogin], status: "failed", error: "No." } as AuthRequest);
    await act(async () => {});

    expect(hook.result.current.againOf("codex-acp")).toBe("open");
  });

  it("puts the list away once the agent asks for a sign-in, so it does not come back by itself", async () => {
    const spy = vi
      .spyOn(internals(), "invoke")
      .mockResolvedValue({ reportsStatus: true, signInChecked: false, authMethods: KNOWN_METHODS });
    const { hook } = setupHook();
    act(() => hook.result.current.openAgain("codex-acp"));
    await waitFor(() => expect(hook.result.current.againOf("codex-acp")).toBe("open"));

    spy.mockRejectedValue(`ACP_AUTH_REQUIRED:${JSON.stringify(KNOWN_METHODS)}`);
    act(() => hook.result.current.check("codex-acp"));
    await waitFor(() => expect(hook.result.current.stateOf("codex-acp")).toBe("needed"));

    await waitFor(() => expect(hook.result.current.againOf("codex-acp")).toBe("closed"));
  });

  it("does not open without a folder, where no method could run, and says why", () => {
    const spy = vi.spyOn(internals(), "invoke").mockResolvedValue({ authMethods: KNOWN_METHODS });
    const request = { profileId: "codex-acp", cwd: CWD, methods: [claudeLogin], status: "idle" } as AuthRequest;
    const { hook } = setupHook(request, ["codex-acp"], null);

    act(() => hook.result.current.openAgain("codex-acp"));

    expect(hook.result.current.againOf("codex-acp")).toBe("closed");
    expect(hook.result.current.checkOf("codex-acp")).toMatchObject({ phase: "done", isFailure: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not close a list opened later because of an older sign-in that is still in the slot", async () => {
    vi.spyOn(internals(), "invoke").mockResolvedValue({ reportsStatus: true, signInChecked: false, authMethods: KNOWN_METHODS });
    const done = { profileId: "codex-acp", cwd: CWD, methods: [claudeLogin], status: "signed-in" } as AuthRequest;
    const { hook } = setupHook(done);

    act(() => hook.result.current.openAgain("codex-acp"));
    await act(async () => {});

    expect(hook.result.current.againOf("codex-acp")).toBe("open");
  });
});
