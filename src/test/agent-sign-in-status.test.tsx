import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { AuthPanel } from "../components/AuthPanel";
import { Sidebar } from "../components/Sidebar";
import { useAgentSignInStatus } from "../hooks/useAgentSignInStatus";
import { parseAuthRequired } from "../lib/acp-auth";
import { signInPlaceholder, signInStateOf } from "../lib/agent-sign-in";
import { composerPlaceholder } from "../lib/composer-state";
import { normalizePersistedState } from "../lib/persistence";
import type { PersistedState, Settings } from "../types";
import { claudeProfile, qwenProfile } from "./fixtures/agents";

const geminiMethods = [
  { id: "oauth-personal", name: "Log in with Google", description: "Log in with your Google account" },
  { id: "gemini-api-key", name: "Gemini API key", _meta: { "api-key": { provider: "google" } } },
  { id: "vertex-ai", name: "Vertex AI", description: "Use an API key with Vertex AI GenAI API" },
  { id: "gateway", name: "AI API Gateway", _meta: { gateway: { protocol: "google" } } },
];

describe("Gemini CLI's sign-in methods", () => {
  it("runs the Google login and only explains the key, Vertex AI and gateway methods", () => {
    const methods = parseAuthRequired(`ACP_AUTH_REQUIRED:${JSON.stringify(geminiMethods)}`);

    expect(methods?.map((method) => [method.id, method.kind])).toEqual([
      ["oauth-personal", "agent"],
      ["gemini-api-key", "explain"],
      ["vertex-ai", "explain"],
      ["gateway", "explain"],
    ]);
  });
});

describe("signInStateOf", () => {
  it("is ready only for an agent seen signed in", () => {
    expect(signInStateOf("gemini", ["gemini"], new Set())).toBe("ready");
    expect(signInStateOf("gemini", [], new Set())).toBe("unchecked");
    expect(signInStateOf("gemini", undefined, new Set())).toBe("unchecked");
  });

  it("says needed when the agent asked for a sign-in, even if it was seen signed in before", () => {
    expect(signInStateOf("gemini", ["gemini"], new Set(["gemini"]))).toBe("needed");
  });
});

describe("composer placeholder while a sign-in is waiting", () => {
  const idle = { isRunning: false, isCreatingWorktree: false, isResumable: false, canStartSession: true };

  it("asks to sign in before sending", () => {
    expect(composerPlaceholder({ ...idle, agentToSignIn: "Gemini CLI" })).toBe(signInPlaceholder("Gemini CLI", false));
    expect(composerPlaceholder({ ...idle, agentToSignIn: "Gemini CLI" })).toBe("Sign in to Gemini CLI to send a message.");
  });

  it("says it continues the session when one is shown", () => {
    expect(composerPlaceholder({ ...idle, isResumable: true, agentToSignIn: "Gemini CLI" })).toBe(
      "Sign in to Gemini CLI to continue this session.",
    );
  });

  it("puts installing before signing in", () => {
    expect(composerPlaceholder({ ...idle, agentToInstall: "Gemini CLI", agentToSignIn: "Gemini CLI" })).toBe(
      "Install Gemini CLI to start a session.",
    );
  });
});

describe("persistence of signed-in agents", () => {
  it("keeps a list of agent ids and drops anything else", () => {
    expect(normalizePersistedState({ settings: { signedInAgents: ["claude-acp", "gemini"] } }).settings.signedInAgents).toEqual([
      "claude-acp",
      "gemini",
    ]);
    expect(normalizePersistedState({ settings: { signedInAgents: [1, "x"] } }).settings.signedInAgents).toEqual([]);
    expect(normalizePersistedState({ settings: {} }).settings.signedInAgents).toEqual([]);
  });
});

describe("useAgentSignInStatus", () => {
  function setup(signedInAgents: string[] = []) {
    let state = { settings: { signedInAgents } as Settings } as PersistedState;
    const updateState = vi.fn((updater: (prev: PersistedState) => PersistedState) => {
      state = updater(state);
    });
    const hook = renderHook(
      ({ settings }) => useAgentSignInStatus({ settings, updateState }),
      { initialProps: { settings: state.settings } },
    );
    const sync = () => hook.rerender({ settings: state.settings });
    return { hook, sync, saved: () => state.settings.signedInAgents };
  }

  it("remembers an agent seen signed in", () => {
    const { hook, sync, saved } = setup();

    act(() => hook.result.current.markSignedIn("gemini"));
    sync();

    expect(saved()).toEqual(["gemini"]);
    expect(hook.result.current.stateOf("gemini")).toBe("ready");
  });

  it("stops counting an agent as signed in when it asks for a sign-in, until it is seen signed in again", () => {
    const { hook, sync, saved } = setup(["gemini"]);

    act(() => hook.result.current.markNeeded("gemini"));
    sync();
    expect(saved()).toEqual([]);
    expect(hook.result.current.stateOf("gemini")).toBe("needed");

    act(() => hook.result.current.markSignedIn("gemini"));
    sync();
    expect(hook.result.current.stateOf("gemini")).toBe("ready");
  });

  it("does not write the state again for an agent already remembered", () => {
    const { hook } = setup(["gemini"]);
    const before = hook.result.current;

    act(() => before.markSignedIn("gemini"));

    expect(hook.result.current.stateOf("gemini")).toBe("ready");
  });
});

describe("AuthPanel for agents with several kinds of methods", () => {
  const methods = parseAuthRequired(`ACP_AUTH_REQUIRED:${JSON.stringify(geminiMethods)}`) ?? [];
  const renderPanel = (status: "idle" | "checking" = "idle") => {
    const onSignIn = vi.fn();
    const onCheckAgain = vi.fn();
    render(
      <AuthPanel agentName="Gemini CLI" methods={methods} status={status} onSignIn={onSignIn} onCheckAgain={onCheckAgain} onDismiss={vi.fn()} />,
    );
    return { onSignIn, onCheckAgain };
  };

  it("offers one sign-in button, for the method the app can run", () => {
    renderPanel();

    expect(screen.getAllByRole("button", { name: /^Sign in with / })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Sign in with Log in with Google" })).toBeInTheDocument();
  });

  it("says Zorvo never stores keys and offers Check again", () => {
    const { onCheckAgain } = renderPanel();

    expect(screen.getByText(/Zorvo never stores keys/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(onCheckAgain).toHaveBeenCalledTimes(1);
  });

  it("shows that it is checking and keeps the buttons from being pressed twice", () => {
    renderPanel("checking");

    expect(screen.getByText("Checking whether you are signed in…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check again" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sign in with Log in with Google" })).toBeDisabled();
  });
});

describe("Sidebar sign-in chips", () => {
  const agents = [claudeProfile, qwenProfile];
  const renderSidebar = (extra: Partial<React.ComponentProps<typeof Sidebar>> = {}) =>
    render(
      <Sidebar
        workspaces={[]}
        sessions={[]}
        agents={agents}
        onNewSession={vi.fn()}
        onSelectSession={vi.fn()}
        {...extra}
      />,
    );

  it("reads Ready for every agent when nothing says otherwise", () => {
    renderSidebar();

    expect(screen.getAllByText("Ready")).toHaveLength(2);
  });

  it("tells the three states apart and only the unready ones can be pressed", () => {
    const onSetUpAgent = vi.fn();
    renderSidebar({
      signInStateOf: (id) => (id === "claude-acp" ? "needed" : "unchecked"),
      onSetUpAgent,
    });

    fireEvent.click(screen.getByRole("button", { name: "Sign in to Claude Code" }));
    fireEvent.click(screen.getByRole("button", { name: "Check Qwen Code" }));

    expect(onSetUpAgent.mock.calls).toEqual([["claude-acp"], ["qwen-code"]]);
    expect(screen.getByText("Sign in")).toBeInTheDocument();
    expect(screen.getByText("Not checked")).toBeInTheDocument();
    expect(screen.queryByText("Ready")).toBeNull();
  });

  it("is not pressable once an agent is ready", () => {
    renderSidebar({ signInStateOf: () => "ready", onSetUpAgent: vi.fn() });

    expect(screen.queryByRole("button", { name: /^Check |^Sign in to / })).toBeNull();
  });
});
