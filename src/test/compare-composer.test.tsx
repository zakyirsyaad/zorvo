import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent, renderHook } from "@testing-library/react";
import type { FakeTauriStore } from "./setup";
import { fakeProfiles, makeProfile } from "./fixtures/agents";
import App from "../App";
import { AgentMultiPicker } from "../components/composer/AgentMultiPicker";
import { useCompareDraft } from "../hooks/useCompareDraft";
import { compareAgentOptions } from "../lib/composer-controls";
import { composerNote } from "../lib/composer-state";
import type { SignInState } from "../lib/agent-sign-in";

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

const QUOTA_NOTE = "Runs in 2 worktrees. Each agent uses its own quota.";

async function renderDraft(options: { isRepository?: boolean } = {}) {
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
  vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
    if (cmd === "get_agent_profiles") return Promise.resolve(structuredClone(ALL));
    if (cmd === "workspace_details" && options.isRepository === false) {
      return Promise.resolve({ location: "~/developer", branch: null });
    }
    return original(cmd, args);
  });
  await act(async () => {
    render(<App />);
  });
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
    expect(screen.getByRole("button", { name: "Agent: 2 agents" })).toBeInTheDocument();
    await tick("Kimi CLI");
    expect(screen.getByText("Runs in 3 worktrees. Each agent uses its own quota.")).toBeInTheDocument();
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
      fireEvent.click(screen.getByRole("button", { name: /^Folder:/ }));
    });
    const worktree = await screen.findByRole("switch", { name: "Worktree" });
    expect(worktree).toHaveAttribute("aria-checked", "false");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Folder:/ }));
    });

    await openAgentMenu();
    await tick("Qwen Code");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Folder:/ }));
    });
    const locked = screen.getByRole("switch", { name: "Worktree" });
    expect(locked).toHaveAttribute("aria-checked", "true");
    expect(locked).toBeDisabled();
    await act(async () => {
      fireEvent.click(locked);
    });
    expect(screen.getByRole("switch", { name: "Worktree" })).toHaveAttribute("aria-checked", "true");
  });

  it("cannot tick a fifth agent", async () => {
    await renderDraft();
    await openAgentMenu();
    await tick("Qwen Code");
    await tick("Kimi CLI");
    await tick("Gemini CLI");

    const fifth = screen.getByRole("checkbox", { name: /^Compare Goose/ });
    expect(fifth).toBeDisabled();
    expect(screen.getByRole("button", { name: "Agent: 4 agents" })).toBeInTheDocument();
    expect(screen.getByText("Runs in 4 worktrees. Each agent uses its own quota.")).toBeInTheDocument();
  });

  it("an uninstalled agent cannot be ticked and says why", async () => {
    await renderDraft();
    await openAgentMenu();

    expect(screen.getByRole("checkbox", { name: /^Compare Codex/ })).toBeDisabled();
    expect(screen.getByText("You need to install it first.")).toBeInTheDocument();
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

    expect(codexOption).toEqual({ value: "codex-acp", label: "Codex (not installed)", disabledReason: "You need to install it first." });
  });
});

describe("AgentMultiPicker", () => {
  const options = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta", disabledReason: "You need to sign in first." },
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
        options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }]}
        selected={["a"]}
        isOpen
        onToggle={() => {}}
        onChange={() => {}}
        onPick={() => {}}
      />,
    );
    const first = screen.getByRole("option", { name: "Alpha" });
    first.focus();

    // Alpha is the only one ticked, so its own checkbox is disabled and skipped.
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Beta" }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: "Compare Beta" }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);
  });
});

describe("useCompareDraft", () => {
  it("starts with the primary agent and ticks more up to four", () => {
    const { result } = renderHook(() => useCompareDraft({ primaryAgentId: "a", isRepository: true }));
    expect(result.current).toMatchObject({ agentIds: ["a"], isCompare: false });

    for (const id of ["b", "c", "d", "e"]) act(() => result.current.toggle(id));

    expect(result.current.agentIds).toEqual(["a", "b", "c", "d"]);
    expect(result.current.isCompare).toBe(true);
  });

  it("never unticks the last agent, and reset goes back to the primary", () => {
    const { result } = renderHook(() => useCompareDraft({ primaryAgentId: "a", isRepository: true }));
    act(() => result.current.toggle("a"));
    expect(result.current.agentIds).toEqual(["a"]);

    act(() => result.current.toggle("b"));
    act(() => result.current.toggle("a"));
    expect(result.current.agentIds).toEqual(["b"]);

    act(() => result.current.reset());
    expect(result.current.agentIds).toEqual(["a"]);
  });

  it("stays single outside a repository", () => {
    const { result } = renderHook(() => useCompareDraft({ primaryAgentId: "a", isRepository: false }));
    act(() => result.current.toggle("b"));

    expect(result.current).toMatchObject({ agentIds: ["a"], isCompare: false });
  });
});

describe("composerNote with several agents", () => {
  it("says what a run costs, ahead of any other note", () => {
    expect(composerNote({ continuesSession: false, compareCount: 3, agentLoading: "Qwen Code" })).toBe(
      "Runs in 3 worktrees. Each agent uses its own quota.",
    );
    expect(composerNote({ continuesSession: false, compareCount: 1 })).toBeUndefined();
  });
});
