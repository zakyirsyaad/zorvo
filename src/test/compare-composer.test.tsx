import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { FakeTauriStore } from "./setup";
import { fakeProfiles, makeProfile } from "./fixtures/agents";
import App from "../App";
import { AgentMultiPicker } from "../components/composer/AgentMultiPicker";
import { useCompareDraft } from "../hooks/useCompareDraft";
import { compareAgentOptions } from "../lib/composer-controls";
import { composerNote } from "../lib/composer-state";
import type { SignInState } from "../lib/agent-sign-in";
import { useDraftAgentCheck } from "../hooks/useDraftAgentCheck";
import type { AgentAuth } from "../hooks/useAgentAuth";
import type { AgentProfile } from "../types";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

function fakeStore(): FakeTauriStore {
  return (window as unknown as { __FAKE_TAURI_STORE__: FakeTauriStore }).__FAKE_TAURI_STORE__;
}

const kimi = makeProfile({ id: "kimi", name: "Kimi CLI", detected: true });
const gemini = makeProfile({ id: "gemini", name: "Gemini CLI", detected: true });
const goose = makeProfile({ id: "goose", name: "Goose", detected: true });
const codex = makeProfile({
  id: "codex-acp",
  name: "Codex",
  availability: "needs_runtime",
  detected: false,
  install_plan: [{ kind: "node", name: "Node.js", version: "24.11.1", download_bytes: null }],
});
const ALL = [...fakeProfiles, kimi, gemini, goose, codex];

const QUOTA_NOTE = "Each agent starts in its safest mode, in its own worktree.";

interface DraftOptions {
  /** Every folder is a plain folder. */
  isRepository?: boolean;
  /** Only this folder is a plain folder. */
  plainFolder?: string;
  /** Reading this folder's details never finishes. */
  loadingFolder?: string;
  profiles?: AgentProfile[];
  /** Answers `acp_probe_agent`; the default answers nothing. */
  probe?: (profileId: string) => Promise<unknown>;
}

const CLAUDE_AUTH_ERROR = `ACP_AUTH_REQUIRED:${JSON.stringify([{ id: "claude-ai-login", name: "Claude Subscription", type: "terminal" }])}`;

async function renderDraft(options: DraftOptions = {}) {
  const settings = fakeStore().state.settings as FakeTauriStore["state"]["settings"] & { enabledAgents?: string[] };
  settings.enabledAgents = ALL.map((a) => a.id);
  fakeStore().state.agentOptions = {
    "claude-acp": {
      modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }, { id: "plan", name: "Plan" }] },
      configOptions: [],
      commands: [{ name: "init", description: "Create a CLAUDE.md" }],
    },
  };
  const original = tauriInternals().invoke;
  const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
    if (cmd === "get_agent_profiles") return Promise.resolve(structuredClone(options.profiles ?? ALL));
    if (cmd === "workspace_details") {
      const path = (args as { path?: string } | undefined)?.path;
      if (path !== undefined && path === options.loadingFolder) return new Promise(() => {});
      if (options.isRepository === false || path === options.plainFolder) {
        return Promise.resolve({ location: "~/developer", branch: null });
      }
    }
    if (cmd === "acp_probe_agent" && options.probe) return options.probe(String(args?.profileId));
    return original(cmd, args);
  });
  await act(async () => {
    render(<App />);
  });
  return spy;
}

async function openAgentMenu() {
  await act(async () => {
    fireEvent.click(await screen.findByRole("button", { name: /^Agent: / }));
  });
}

async function tick(agentName: string) {
  await act(async () => {
    fireEvent.click(await screen.findByRole("checkbox", { name: new RegExp(`^Compare ${agentName}`) }));
  });
}

const probed = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter(([cmd]) => cmd === "acp_probe_agent").map(([, args]) => (args as { profileId: string }).profileId);

async function chooseFolder(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Folder:/ }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("option", { name }));
  });
}

function prompt(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement;
}

describe("comparing agents in the composer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("ticking a second agent shows the quota note", async () => {
    await renderDraft();
    await openAgentMenu();
    expect(screen.queryByText(QUOTA_NOTE)).toBeNull();

    await tick("Qwen Code");

    expect(screen.getByText(QUOTA_NOTE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Agent: .*, compare$/ })).toBeInTheDocument();
  });

  it("words the primary button by how many sessions it starts", async () => {
    await renderDraft();
    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();
    await openAgentMenu();

    await tick("Qwen Code");
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
    expect(screen.getByRole("button", { name: "Start 2 sessions" })).toBeInTheDocument();
    await tick("Kimi CLI");
    expect(screen.getByRole("button", { name: "Start 3 sessions" })).toBeInTheDocument();
  });

  it("hides the permission, model and effort chips and the slash menu, and brings them back at one agent", async () => {
    await renderDraft();
    expect(await screen.findByRole("button", { name: "Permission mode: Default" })).toBeInTheDocument();
    await openAgentMenu();

    await tick("Qwen Code");
    expect(screen.queryByRole("button", { name: /^Permission mode:/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Model:/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Effort:/ })).toBeNull();
    await act(async () => {
      fireEvent.change(prompt(), { target: { value: "/" } });
    });
    expect(screen.queryByRole("option", { name: /init/ })).toBeNull();

    // Qwen Code is not the only one: untick it again.
    await tick("Qwen Code");
    expect(screen.getByRole("button", { name: "Permission mode: Default" })).toBeInTheDocument();
    expect(screen.queryByText(QUOTA_NOTE)).toBeNull();
  });

  it("turns Worktree on and keeps it on while two are ticked", async () => {
    await renderDraft();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Branch:/ }));
    });
    const worktree = await screen.findByRole("switch", { name: "New worktree" });
    expect(worktree).toHaveAttribute("aria-checked", "false");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Branch:/ }));
    });

    await openAgentMenu();
    await tick("Qwen Code");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Branch:/ }));
    });
    const locked = screen.getByRole("switch", { name: "New worktree" });
    expect(locked).toHaveAttribute("aria-checked", "true");
    expect(locked).toBeDisabled();
    await act(async () => {
      fireEvent.click(locked);
    });
    expect(screen.getByRole("switch", { name: "New worktree" })).toHaveAttribute("aria-checked", "true");
  });

  it("cannot tick a fifth agent", async () => {
    await renderDraft();
    await openAgentMenu();
    await tick("Qwen Code");
    await tick("Kimi CLI");
    await tick("Gemini CLI");

    const fifth = screen.getByRole("checkbox", { name: /^Compare Goose/ });
    expect(fifth).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Agent: (.*, ){3}.*, compare$/ })).toBeInTheDocument();
    expect(screen.getByText("Each agent starts in its safest mode, in its own worktree.")).toBeInTheDocument();
  });

  it("an uninstalled agent cannot be ticked and says why", async () => {
    await renderDraft();
    await openAgentMenu();

    expect(screen.getByRole("checkbox", { name: /^Compare Codex/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /^Compare Codex/ })).toHaveAccessibleDescription("Not installed");
  });

  it("a Not checked agent can be ticked", async () => {
    await renderDraft();
    await openAgentMenu();

    expect(screen.getByRole("checkbox", { name: /^Compare Qwen Code/ })).toBeEnabled();
  });

  it("choosing an agent by its name still picks only that one", async () => {
    await renderDraft();
    await openAgentMenu();
    await tick("Qwen Code");

    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Kimi CLI" }));
    });

    expect(screen.getByRole("button", { name: "Agent: Kimi CLI" })).toBeInTheDocument();
    expect(screen.queryByText(QUOTA_NOTE)).toBeNull();
  });

  it("keeps the agent left after unticking the first when the folder stops being a repository", async () => {
    await renderDraft({ plainFolder: "/Users/test/developer/titan-investment" });
    await openAgentMenu();
    await tick("Qwen Code");
    await tick("Claude Code");
    expect(screen.getByRole("button", { name: "Agent: Qwen Code" })).toBeInTheDocument();

    await chooseFolder("titan-investment");

    expect(await screen.findByRole("button", { name: "Agent: Qwen Code" })).toBeInTheDocument();
    await openAgentMenu();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("drops two ticked agents on leaving a repository and does not bring compare back on return", async () => {
    await renderDraft({ plainFolder: "/Users/test/developer/titan-investment" });
    await openAgentMenu();
    await tick("Qwen Code");
    expect(screen.getByText(QUOTA_NOTE)).toBeInTheDocument();

    await chooseFolder("titan-investment");
    await waitFor(() => expect(screen.queryByText(QUOTA_NOTE)).toBeNull());
    await chooseFolder("zorvo");

    await waitFor(() => expect(screen.getByRole("button", { name: "Agent: Claude Code" })).toBeInTheDocument());
    expect(screen.queryByText(QUOTA_NOTE)).toBeNull();
  });

  it("asks no agent about its options while several are ticked, and asks again at one", async () => {
    const spy = await renderDraft();
    await waitFor(() => expect(probed(spy)).toEqual(["claude-acp"]));
    await openAgentMenu();
    await tick("Qwen Code");
    await tick("Kimi CLI");

    // Claude Code leaves the ticks: Qwen Code is now the first, but nothing is asked while two remain.
    await tick("Claude Code");
    await act(async () => {});
    expect(probed(spy)).toEqual(["claude-acp"]);

    await tick("Qwen Code");
    await waitFor(() => expect(probed(spy)).toEqual(["claude-acp", "kimi"]));
  });

  it("will not add a second agent while the only one is not installed, and keeps its install note", async () => {
    const uninstalledClaude = { ...ALL[0], availability: "needs_runtime" as const, detected: false, install_plan: codex.install_plan };
    await renderDraft({ profiles: [uninstalledClaude, ...ALL.slice(1)] });
    await openAgentMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Claude Code" }));
    });
    await openAgentMenu();

    expect(screen.getByRole("checkbox", { name: /^Compare Qwen Code/ })).toBeDisabled();
    // The reason names the blocked agent, so it is not read as Qwen Code's own.
    expect(screen.getByRole("checkbox", { name: /^Compare Qwen Code/ })).toHaveAccessibleDescription("Set up Claude Code first.");
    expect(screen.getByText("Install Claude Code to start a session.", { selector: "p" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.change(prompt(), { target: { value: "go" } });
    });
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    expect(screen.queryByText(QUOTA_NOTE)).toBeNull();
  });

  it("will not add a second agent while the only one asks for a sign-in", async () => {
    await renderDraft({
      probe: (profileId) => (profileId === "claude-acp" ? Promise.reject(CLAUDE_AUTH_ERROR) : Promise.resolve(undefined)),
    });
    await openAgentMenu();

    await waitFor(() => expect(screen.getByRole("checkbox", { name: /^Compare Qwen Code/ })).toBeDisabled());
    // The only agent's own row says it needs a sign-in.
    expect(screen.getByText("Needs sign-in")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /^Compare Qwen Code/ })).toHaveAccessibleDescription("Set up Claude Code first.");
    expect(screen.queryByText(QUOTA_NOTE)).toBeNull();
    // With something to send, Send still waits for the sign-in.
    await act(async () => {
      fireEvent.change(prompt(), { target: { value: "go" } });
    });
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("keeps the ticks when the folder changes to another repository", async () => {
    await renderDraft();
    await openAgentMenu();
    await tick("Qwen Code");
    expect(screen.getByText(QUOTA_NOTE)).toBeInTheDocument();

    await chooseFolder("titan-investment");

    await act(async () => {});
    expect(screen.getByText(QUOTA_NOTE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Agent: .*, compare$/ })).toBeInTheDocument();
  });

  it("Send is blocked while a compare draft's folder is loading", async () => {
    const spy = await renderDraft({ loadingFolder: "/Users/test/developer/titan-investment" });
    await openAgentMenu();
    await tick("Qwen Code");
    await chooseFolder("titan-investment");
    await act(async () => {
      fireEvent.change(prompt(), { target: { value: "go" } });
    });

    // The ticks and the note stay, but nothing may start outside a worktree.
    expect(screen.getByText(QUOTA_NOTE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start 2 sessions" })).toBeDisabled();
    await act(async () => {
      fireEvent.keyDown(prompt(), { key: "Enter" });
    });
    expect(spy.mock.calls.filter(([cmd]) => cmd === "acp_start_session")).toHaveLength(0);
  });

  it("outside a repository the chip stays single-choice", async () => {
    await renderDraft({ isRepository: false });
    await openAgentMenu();

    expect(screen.queryByRole("checkbox")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Qwen Code" }));
    });
    expect(screen.getByRole("button", { name: "Agent: Qwen Code" })).toBeInTheDocument();
  });
});

describe("compareAgentOptions", () => {
  const stateOf = (states: Record<string, SignInState>) => (id: string) => states[id] ?? "unchecked";

  it("an agent reading Sign in cannot be ticked and says why", () => {
    const options = compareAgentOptions(ALL, stateOf({ "qwen-code": "needed" }));

    expect(options.find((o) => o.value === "qwen-code")?.disabledReason).toBe("You need to sign in first.");
    expect(options.find((o) => o.value === "claude-acp")?.disabledReason).toBeUndefined();
    expect(options.find((o) => o.value === "kimi")?.disabledReason).toBeUndefined();
  });

  it("an uninstalled agent says to install it, and keeps its not-installed name", () => {
    const codexOption = compareAgentOptions(ALL, stateOf({})).find((o) => o.value === "codex-acp");

    expect(codexOption).toEqual({
      value: "codex-acp",
      label: "Codex (not installed)",
      name: "Codex",
      signIn: "unchecked",
      blockedBy: "install",
      disabledReason: "You need to install it first.",
    });
  });

  it("carries each agent's sign-in state, for the picker's readiness word", () => {
    const options = compareAgentOptions(ALL, stateOf({ "claude-acp": "ready", "qwen-code": "needed" }));

    expect(options.find((o) => o.value === "claude-acp")?.signIn).toBe("ready");
    expect(options.find((o) => o.value === "qwen-code")?.signIn).toBe("needed");
    expect(options.find((o) => o.value === "kimi")?.signIn).toBe("unchecked");
  });
});

describe("AgentMultiPicker", () => {
  const options = [
    { value: "a", label: "Alpha", name: "Alpha" },
    { value: "b", label: "Beta", name: "Beta", disabledReason: "You need to sign in first." },
  ];

  it("ticks with a checkbox, picks one with the name, and closes on a pick", () => {
    const onChange = vi.fn();
    const onPick = vi.fn();
    render(<AgentMultiPicker options={options} selected={["a"]} isOpen onToggle={() => {}} onChange={onChange} onPick={onPick} />);

    expect(screen.getByRole("checkbox", { name: "Compare Alpha" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Compare Beta" })).toBeDisabled();
    expect(screen.getByText("You need to sign in first.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Beta" }));
    expect(onPick).toHaveBeenCalledWith("b");
  });

  it("moves between its buttons with the arrow keys", () => {
    render(
      <AgentMultiPicker
        options={[{ value: "a", label: "Alpha", name: "Alpha" }, { value: "b", label: "Beta", name: "Beta" }]}
        selected={["a"]}
        isOpen
        onToggle={() => {}}
        onChange={() => {}}
        onPick={() => {}}
      />,
    );
    const first = screen.getByRole("option", { name: "Alpha" });
    first.focus();

    // Each row is checkbox then name; Alpha is the only one ticked, so its own checkbox is disabled and skipped.
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: "Compare Beta" }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Beta" }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);
  });
});

/** The hook as App wires it: a single agent left becomes the picked one. */
function useHarness(options: { isRepository: boolean; isTickable?: (id: string) => boolean }) {
  const [primary, setPrimary] = useState("a");
  const compare = useCompareDraft({ primaryAgentId: primary, onSingle: setPrimary, ...options });
  return { ...compare, primary };
}

describe("useCompareDraft", () => {
  it("starts with the primary agent and ticks more up to four", () => {
    const { result } = renderHook(() => useCompareDraft({ primaryAgentId: "a", isRepository: true }));
    expect(result.current).toMatchObject({ agentIds: ["a"], isCompare: false });

    for (const id of ["b", "c", "d", "e"]) act(() => result.current.toggle(id));

    expect(result.current.agentIds).toEqual(["a", "b", "c", "d"]);
    expect(result.current.isCompare).toBe(true);
  });

  it("never unticks the last agent; one left becomes the picked agent; reset goes back to it", () => {
    const { result } = renderHook(() => useHarness({ isRepository: true }));
    act(() => result.current.toggle("a"));
    expect(result.current.agentIds).toEqual(["a"]);

    act(() => result.current.toggle("b"));
    act(() => result.current.toggle("a"));
    expect(result.current).toMatchObject({ agentIds: ["b"], primary: "b" });

    act(() => result.current.reset());
    expect(result.current.agentIds).toEqual(["b"]);
  });

  it("stays single outside a repository", () => {
    const { result } = renderHook(() => useCompareDraft({ primaryAgentId: "a", isRepository: false }));
    act(() => result.current.toggle("b"));

    expect(result.current).toMatchObject({ agentIds: ["a"], isCompare: false });
  });

  it("drops the ticks on leaving a repository, keeps the first ticked as the picked agent, and does not bring them back", () => {
    const { result, rerender } = renderHook(({ isRepository }) => useHarness({ isRepository }), {
      initialProps: { isRepository: true },
    });
    act(() => result.current.toggle("b"));
    act(() => result.current.toggle("c"));
    act(() => result.current.toggle("a"));
    expect(result.current.agentIds).toEqual(["b", "c"]);

    rerender({ isRepository: false });
    expect(result.current).toMatchObject({ agentIds: ["b"], isCompare: false, primary: "b" });

    rerender({ isRepository: true });
    expect(result.current).toMatchObject({ agentIds: ["b"], isCompare: false });
  });

  it("ignores a ticked agent that stops being tickable", () => {
    let tickable = new Set(["a", "b", "c"]);
    const { result, rerender } = renderHook(() => useHarness({ isRepository: true, isTickable: (id) => tickable.has(id) }));
    act(() => result.current.toggle("b"));
    act(() => result.current.toggle("c"));
    expect(result.current.agentIds).toEqual(["a", "b", "c"]);

    tickable = new Set(["a", "c"]);
    rerender();

    expect(result.current.agentIds).toEqual(["a", "c"]);
    expect(result.current.isCompare).toBe(true);
  });

  it("adds no second agent while the only one cannot start, and ticks none that cannot", () => {
    const { result } = renderHook(() => useHarness({ isRepository: true, isTickable: (id) => id !== "a" && id !== "x" }));
    act(() => result.current.toggle("b"));
    expect(result.current.agentIds).toEqual(["a"]);

    const other = renderHook(() => useHarness({ isRepository: true, isTickable: (id) => id !== "x" }));
    act(() => other.result.current.toggle("x"));
    expect(other.result.current.agentIds).toEqual(["a"]);
  });
});

describe("the draft check while several agents are ticked", () => {
  const CWD = "/Users/test/developer/zorvo";
  const noAuth: AgentAuth = {
    authRequest: null,
    requestSignIn: vi.fn(() => true),
    signIn: () => {},
    recheck: () => {},
    dismiss: () => {},
  };

  it("drops an agent mid-probe cleanly: the answer lands, and ticking back asks again if it did not take", async () => {
    let fail: (reason: string) => void = () => {};
    const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation(
      () => new Promise((_resolve, reject) => { fail = reject; }),
    );
    const claude = ALL[0];
    const { rerender } = renderHook(
      ({ agent }: { agent: AgentProfile | undefined }) =>
        useDraftAgentCheck({ agent, cwd: CWD, agentOptions: undefined, rememberProbed: () => {}, auth: noAuth }),
      { initialProps: { agent: claude as AgentProfile | undefined } },
    );
    await waitFor(() => expect(probed(spy)).toEqual(["claude-acp"]));

    rerender({ agent: undefined });
    await act(async () => fail(CLAUDE_AUTH_ERROR));
    // The sign-in request was for an agent no longer picked: dropped, not raised.
    expect(noAuth.requestSignIn).not.toHaveBeenCalled();

    rerender({ agent: claude });
    await waitFor(() => expect(probed(spy)).toEqual(["claude-acp", "claude-acp"]));
    await act(async () => fail(CLAUDE_AUTH_ERROR));
    expect(noAuth.requestSignIn).toHaveBeenCalledTimes(1);
  });
});

describe("composerNote with several agents", () => {
  it("says what a run costs, ahead of any other note", () => {
    expect(composerNote({ continuesSession: false, compareCount: 3, agentToSignIn: "Qwen Code" })).toBe(
      "Each agent starts in its safest mode, in its own worktree.",
    );
    expect(composerNote({ continuesSession: false, compareCount: 1 })).toBeUndefined();
  });
});
