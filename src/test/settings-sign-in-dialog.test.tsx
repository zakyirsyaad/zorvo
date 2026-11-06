import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
  emit: () => Promise.resolve(),
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

import { SettingsPage } from "../components/settings/SettingsPage";
import { idleAppUpdate, pageAt } from "./fixtures/settings-page";
import { SignInLayer } from "../components/SignInLayer";
import type { SettingsSignIn } from "../hooks/useSettingsSignIn";
import type { useAgentSignIn } from "../hooks/useAgentSignIn";
import { createPtyOutputStore } from "../lib/pty-output-store";
import { fakeCatalog } from "./fixtures/catalog";
import { fakeProfiles } from "./fixtures/agents";
import type { Settings } from "../types";

afterEach(() => vi.restoreAllMocks());

const dialog = { terminalId: "signin-1", agentName: "Claude Code", methodName: "Claude Subscription", phase: "running" as const };
const terminal = {
  dialog,
  output: createPtyOutputStore(),
  sendInput: vi.fn(),
  resize: vi.fn(),
} as unknown as SettingsSignIn["terminal"];

function agentSignIn(overrides: Partial<SettingsSignIn> = {}): SettingsSignIn {
  return {
    cwd: "/Users/test/developer/zorvo",
    stateOf: () => "needed",
    checkOf: () => ({ phase: "idle" }),
    reportsStatusOf: () => undefined,
    methodsOf: () => [],
    requestOf: () => null,
    busyAgentId: null,
    check: vi.fn(),
    signInWith: vi.fn(),
    sweep: vi.fn(),
    terminal,
    cancelSignIn: vi.fn(),
    retrySignIn: vi.fn(),
    ...overrides,
  };
}

function renderSettings(signIn: SettingsSignIn, isOpen = true) {
  const updateState = vi.fn();
  const state = { settings: { enabledAgents: ["claude-acp"], signedInAgents: [] } as unknown as Settings, sessions: [] };
  render(
    <SettingsPage
      page={pageAt(isOpen ? "agents" : null)}
      persisted={{ state: state as never, updateState }}
      agents={fakeProfiles}
      refreshAgents={() => Promise.resolve()}
      catalog={{ catalog: { lastChecked: null, agents: fakeCatalog, unavailable: [] }, error: null, reload: () => Promise.resolve() } as never}
      actions={{ addAgent: () => {}, updateAgent: () => {}, removeAgent: () => Promise.resolve(), runningSessionCount: () => 0 }}
      recentFolders={[]}
      onRemoveRecentFolder={() => {}}
      onRunOnboarding={() => {}}
      updateCount={0}
      appUpdate={idleAppUpdate}
      restartNote={null}
      agentSignIn={signIn}
    />,
  );
}

describe("an agent's login started in Settings", () => {
  it("is drawn by Settings, and Close stops it", () => {
    const signIn = agentSignIn();
    renderSettings(signIn);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(signIn.cancelSignIn).toHaveBeenCalled();
  });

  it("offers Try again after a failure, which runs the same login once more", () => {
    const failed = { ...terminal, dialog: { ...dialog, phase: "failed" as const, error: "Sign-in failed" } } as unknown as SettingsSignIn["terminal"];
    const signIn = agentSignIn({ terminal: failed });
    renderSettings(signIn);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(signIn.retrySignIn).toHaveBeenCalled();
  });

  it("is drawn by the app's layer instead while Settings is closed, and not twice while it is open", () => {
    const signIn = { terminal, cancel: vi.fn(), auth: { authRequest: null, signIn: vi.fn() } } as unknown as ReturnType<typeof useAgentSignIn>;
    const { rerender } = render(<SignInLayer signIn={signIn} agents={fakeProfiles} agentId={undefined} showTerminal={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(<SignInLayer signIn={signIn} agents={fakeProfiles} agentId={undefined} showTerminal />);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("shows nothing of it once Settings is closed", () => {
    renderSettings(agentSignIn(), false);

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
