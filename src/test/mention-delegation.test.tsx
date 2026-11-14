import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ComposerDock, type ComposerDockProps } from "../components/ComposerDock";

const FILES = ["README.md", "src/App.tsx", "src/Cache.ts"];

/** The agents an @ at the start offers, in the order of the artboard. */
const AGENTS = [
  { id: "codex", name: "Codex", status: "ready" },
  { id: "claude-code", name: "Claude Code", status: "ready" },
  { id: "qwen-code", name: "Qwen Code", status: "not-checked" },
  { id: "gemini-cli", name: "Gemini CLI", status: "needs-sign-in" },
  { id: "kimi-cli", name: "Kimi CLI", status: "not-installed" },
] as const;

function prompt(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement;
}

/** Types as a user does: setting the value puts the caret after the text. */
async function type(text: string) {
  await act(async () => {
    fireEvent.change(prompt(), { target: { value: text } });
  });
}

function renderComposer(props: Partial<ComposerDockProps> = {}) {
  const loadFiles = vi.fn().mockResolvedValue(FILES);
  const onSendMessage = vi.fn();
  const view = render(
    <ComposerDock onSendMessage={onSendMessage} mentions={{ root: "/w/api", loadFiles }} {...props} />,
  );
  return { loadFiles, onSendMessage, ...view };
}

function agentRow(id: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-agent="${id}"]`);
  if (row === null) throw new Error(`no agent row for ${id}`);
  return row;
}

function fileRow(path: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-file="${path}"]`);
  if (row === null) throw new Error(`no file row for ${path}`);
  return row;
}

function selectedAgentId(): string | undefined {
  return AGENTS.find((agent) => agentRow(agent.id).getAttribute("aria-selected") === "true")?.id;
}

describe("the @ mention's delegation group", () => {
  it("an @ at the start lists agents above files", async () => {
    renderComposer({ delegationAgents: AGENTS });
    await type("@");

    const agents = screen.getByRole("listbox", { name: "Agents to delegate to" });
    expect(within(agents).getAllByRole("option").map((row) => row.getAttribute("data-agent"))).toEqual([
      "codex",
      "claude-code",
      "qwen-code",
      "gemini-cli",
      "kimi-cli",
    ]);
    const files = screen.getByRole("listbox", { name: "Files to mention" });
    expect(within(files).getAllByRole("option").map((row) => row.getAttribute("data-file"))).toEqual(FILES);
    expect(agents.compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Delegate to an agent")).toHaveClass("text-caption", "font-medium", "text-fg-muted");

    // A 28px row: a 16px tile around the logo, the name, and the status on the right.
    expect(agentRow("codex")).toHaveClass("min-h-7", "rounded-md", "px-2");
    expect(agentRow("codex").querySelector(".size-4.rounded.bg-chip img")).not.toBeNull();
    expect(within(agentRow("codex")).getByText("Codex")).toHaveClass("text-ui");
    expect(within(agentRow("codex")).getByText("Ready")).toHaveClass("text-caption", "text-fg-muted");
    expect(within(agentRow("qwen-code")).getByText("Not checked")).toHaveClass("text-fg-subtle");
    expect(within(agentRow("kimi-cli")).getByText("Not installed")).toHaveClass("text-fg-subtle");

    const signIn = within(agentRow("gemini-cli")).getByText("Needs sign-in");
    // The words are muted; the dot beside them carries the colour.
    expect(signIn).toHaveClass("text-caption", "text-fg-muted");
    expect(signIn).not.toHaveClass("text-status-attention");
    expect(signIn.querySelector("span")).toHaveClass("size-1.5", "bg-status-attention");

    // An agent that cannot start is dimmed and says so to assistive tech.
    for (const id of ["gemini-cli", "kimi-cli"]) {
      expect(agentRow(id)).toHaveAttribute("aria-disabled", "true");
      expect(agentRow(id)).toHaveClass("opacity-55");
    }
    expect(agentRow("codex")).not.toHaveAttribute("aria-disabled");
  });

  it("an @ after other text lists files only", async () => {
    renderComposer({ delegationAgents: AGENTS });
    // "C" matches Claude Code and Codex, but the @ does not start the message.
    await type("ask @C");

    expect(screen.queryByRole("listbox", { name: "Agents to delegate to" })).toBeNull();
    expect(screen.queryByText("Delegate to an agent")).toBeNull();
    const files = within(screen.getByRole("listbox", { name: "Files to mention" }));
    expect(files.getAllByRole("option").map((row) => row.getAttribute("data-file"))).toEqual([
      "src/Cache.ts",
      "src/App.tsx",
    ]);
  });

  it("no agents group without delegationAgents", async () => {
    renderComposer();
    await type("@");

    expect(screen.queryByRole("listbox", { name: "Agents to delegate to" })).toBeNull();
    expect(screen.queryByText("Delegate to an agent")).toBeNull();
    expect(screen.getByRole("listbox", { name: "Files to mention" })).toBeDefined();
  });

  it("arrow keys skip agents that cannot be picked", async () => {
    renderComposer({ delegationAgents: AGENTS });
    await type("@");

    expect(selectedAgentId()).toBe("codex");
    fireEvent.keyDown(prompt(), { key: "ArrowDown" });
    expect(selectedAgentId()).toBe("claude-code");
    fireEvent.keyDown(prompt(), { key: "ArrowDown" });
    expect(selectedAgentId()).toBe("qwen-code");

    // After the last pickable agent the list moves on to the files, not to Gemini CLI or Kimi CLI.
    fireEvent.keyDown(prompt(), { key: "ArrowDown" });
    expect(fileRow("README.md")).toHaveAttribute("aria-selected", "true");
    expect(agentRow("gemini-cli")).toHaveAttribute("aria-selected", "false");
    expect(agentRow("kimi-cli")).toHaveAttribute("aria-selected", "false");

    // ArrowUp wraps past the dimmed rows too: the last item is a file, not Kimi CLI.
    fireEvent.keyDown(prompt(), { key: "ArrowUp" });
    expect(selectedAgentId()).toBe("qwen-code");
    fireEvent.keyDown(prompt(), { key: "ArrowUp" });
    fireEvent.keyDown(prompt(), { key: "ArrowUp" });
    expect(selectedAgentId()).toBe("codex");
    fireEvent.keyDown(prompt(), { key: "ArrowUp" });
    expect(fileRow("src/Cache.ts")).toHaveAttribute("aria-selected", "true");
    expect(agentRow("kimi-cli")).toHaveAttribute("aria-selected", "false");

    // Return picks the highlighted agent, not a row it skipped.
    fireEvent.keyDown(prompt(), { key: "ArrowDown" });
    fireEvent.keyDown(prompt(), { key: "Enter" });
    expect(prompt().value).toBe("@Codex ");
  });

  it("keeps Return from sending while only unpickable agents match", async () => {
    const { onSendMessage } = renderComposer({ delegationAgents: AGENTS });
    await type("@Gemini");

    expect(screen.getByRole("listbox", { name: "Agents to delegate to" })).toBeInTheDocument();
    expect(agentRow("gemini-cli")).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(prompt(), { key: "Enter" });
    expect(onSendMessage).not.toHaveBeenCalled();
    expect(prompt().value).toBe("@Gemini");

    fireEvent.keyDown(prompt(), { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Agents to delegate to" })).toBeNull();
  });

  it("picking Claude Code inserts \"@Claude Code \" and keeps focus", async () => {
    renderComposer({ delegationAgents: AGENTS });
    prompt().focus();
    await type("@Cla");
    expect(agentRow("claude-code").querySelector("mark")).toHaveTextContent("Cla");

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("option", { name: /Claude Code/ }));
    });

    expect(prompt().value).toBe("@Claude Code ");
    expect(prompt()).toHaveFocus();
    expect(prompt().selectionStart).toBe("@Claude Code ".length);
    expect(screen.queryByRole("listbox", { name: "Agents to delegate to" })).toBeNull();
  });

  it("keeps A's chips and commands with a mention", async () => {
    renderComposer({
      delegationAgents: AGENTS,
      sessionAgent: { profileId: "qwen-code", name: "Qwen Code" },
      agentName: "Qwen Code",
      controls: {
        model: {
          options: [{ value: "qwen3-coder-plus", label: "qwen3-coder-plus" }],
          selected: "qwen3-coder-plus",
          onChange: vi.fn(),
        },
      },
      commands: [{ name: "review", description: "Review the changes on this branch" }],
    });

    await type("@Codex fix it");

    // A's agent label and chip, not Codex's.
    expect(screen.getByText("Qwen Code")).toBeInTheDocument();
    expect(screen.getByText("qwen3-coder-plus")).toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: "Agents to delegate to" })).toBeNull();

    // A's `/` commands still come from A's agent.
    await type("/");
    expect(screen.getByText("Commands from Qwen Code")).toBeInTheDocument();
    expect(screen.getByText("/review")).toBeInTheDocument();
  });
});

describe("the delegation summary", () => {
  it("shows the starts-on summary with Change, and a blocking note instead when there is one", () => {
    const onChange = vi.fn();
    const summary = { text: "Codex starts on gpt-5.5-codex · high · Auto review", onChange };
    const { rerender } = render(<ComposerDock onSendMessage={vi.fn()} delegationSummary={summary} />);

    expect(screen.getByText(summary.text).closest("p")).toHaveClass("text-caption", "text-fg-muted");
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(onChange).toHaveBeenCalledTimes(1);

    rerender(
      <ComposerDock
        onSendMessage={vi.fn()}
        delegationSummary={summary}
        note="Codex needs a sign-in first."
        sendDisabled
      />,
    );

    expect(screen.getByText("Codex needs a sign-in first.")).toBeInTheDocument();
    expect(screen.queryByText(summary.text)).toBeNull();
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
  });
});

describe("reporting the delegation", () => {
  it("reports the parsed mention as the text changes", async () => {
    const onDelegationMentionChange = vi.fn();
    const { onSendMessage } = renderComposer({ delegationAgents: AGENTS, onDelegationMentionChange });

    await type("@Codex fix it");
    expect(onDelegationMentionChange).toHaveBeenLastCalledWith({ agentId: "codex", task: "fix it" });

    // Deleting the @ makes it an ordinary message for A.
    await type("Codex fix it");
    expect(onDelegationMentionChange).toHaveBeenLastCalledWith(null);

    await type("@Codex fix it");
    expect(onDelegationMentionChange).toHaveBeenLastCalledWith({ agentId: "codex", task: "fix it" });

    // Sending clears the box, and the mention with it.
    fireEvent.keyDown(prompt(), { key: "Enter" });
    expect(onSendMessage).toHaveBeenCalledWith("@Codex fix it");
    expect(onDelegationMentionChange).toHaveBeenLastCalledWith(null);
  });
});