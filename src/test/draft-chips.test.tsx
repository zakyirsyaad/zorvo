import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ComposerDock } from "../components/ComposerDock";
import type { BranchControl, FolderControl } from "../components/composer/FolderPicker";
import type { AgentChoice } from "../lib/composer-controls";

const folders = [
  { name: "agent-desktop", path: "/w/agent-desktop" },
  { name: "api", path: "/w/api" },
];

function branchControl(overrides: Partial<BranchControl> = {}): BranchControl {
  return { current: "main", checkedOut: "main", branches: ["feature/login", "main"], onOpen: vi.fn(), onPick: vi.fn(), ...overrides };
}

function folderControl(overrides: Partial<FolderControl> = {}): FolderControl {
  return { folders, selectedPath: "/w/agent-desktop", onSelect: vi.fn(), onOpenFolder: vi.fn(), ...overrides };
}

function renderDraft(folder: FolderControl, agents?: AgentChoice[]) {
  return render(
    <ComposerDock
      onSendMessage={() => {}}
      folder={folder}
      agents={agents ? { options: agents, selected: [agents[0].value], onChange: vi.fn(), onPick: vi.fn() } : undefined}
    />,
  );
}

describe("the draft's chips", () => {
  it("sit above the composer's card, outside its bottom row", () => {
    renderDraft(folderControl({ branch: branchControl() }));

    const chip = screen.getByRole("button", { name: "Folder: agent-desktop" });
    const prompt = screen.getByRole("textbox", { name: "Prompt" });
    expect(chip.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Branch: main" })).toHaveClass("h-7");
  });
});

describe("where the draft's menus open", () => {
  it("opens them downward, over the card, where there is room for a full list", () => {
    const agents: AgentChoice[] = [{ value: "claude-acp", label: "Claude Code", name: "Claude Code", signIn: "ready" }];
    renderDraft(folderControl({ branch: branchControl() }), agents);

    for (const [chip, panel] of [
      ["Folder: agent-desktop", "Choose a folder"],
      ["Branch: main", "Choose a branch"],
      ["Agent: Claude Code", "Choose agents"],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name: chip }));
      const dialog = screen.getByRole("dialog", { name: panel });
      expect(dialog).toHaveClass("top-full");
      expect(dialog).not.toHaveClass("bottom-full");
      fireEvent.mouseDown(document.body);
    }
  });
});

describe("the folder chip", () => {
  it("lists the recent folders with the chosen one checked, and opens another", () => {
    const folder = folderControl();
    renderDraft(folder);

    fireEvent.click(screen.getByRole("button", { name: "Folder: agent-desktop" }));
    const dialog = within(screen.getByRole("dialog", { name: "Choose a folder" }));
    expect(dialog.getByRole("textbox", { name: "Search folders" })).toBeInTheDocument();
    expect(dialog.getByText("Recent folders")).toBeInTheDocument();
    const list = within(dialog.getByRole("listbox", { name: "Recent folders" }));
    expect(list.getByRole("option", { name: "agent-desktop" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(dialog.getByRole("button", { name: "Open another folder…" }));
    expect(folder.onOpenFolder).toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Choose a folder" })).toBeNull();
  });
});

describe("the branch chip", () => {
  it("is not there outside a repository", () => {
    renderDraft(folderControl());
    expect(screen.queryByRole("button", { name: /^Branch/ })).toBeNull();
  });

  it("lists the local branches with the checked-out one marked", () => {
    const branch = branchControl();
    renderDraft(folderControl({ branch }));

    fireEvent.click(screen.getByRole("button", { name: "Branch: main" }));
    expect(branch.onOpen).toHaveBeenCalled();
    const dialog = within(screen.getByRole("dialog", { name: "Choose a branch" }));
    expect(dialog.getByRole("textbox", { name: "Search branches" })).toBeInTheDocument();
    expect(dialog.getByText("Local branches")).toBeInTheDocument();
    expect(dialog.getByRole("option", { name: /^main/ })).toHaveAttribute("aria-selected", "true");
  });

  it("picks nothing on Return while the search is empty, so a stray key cannot switch the checkout", () => {
    const branch = branchControl();
    renderDraft(folderControl({ branch }));

    fireEvent.click(screen.getByRole("button", { name: "Branch: main" }));
    const search = screen.getByRole("textbox", { name: "Search branches" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(branch.onPick).not.toHaveBeenCalled();

    fireEvent.change(search, { target: { value: "feat" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(branch.onPick).toHaveBeenCalledWith("feature/login");
  });

  it("offers a new worktree, says what it does, and says so on the chip once on", () => {
    const onChange = vi.fn();
    const { rerender } = renderDraft(folderControl({ branch: branchControl(), worktree: { isOn: false, onChange } }));

    fireEvent.click(screen.getByRole("button", { name: "Branch: main" }));
    const toggle = screen.getByRole("switch", { name: "New worktree" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Works on its own copy from main. Your checkout stays as it is.")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(
      <ComposerDock onSendMessage={() => {}} folder={folderControl({ branch: branchControl(), worktree: { isOn: true, onChange } })} />,
    );
    expect(screen.getByRole("button", { name: "Branch: main, in a new worktree" })).toHaveTextContent("main · new worktree");
  });

  it("keeps the worktree on, and says why, while it is locked", () => {
    renderDraft(
      folderControl({
        branch: branchControl(),
        worktree: { isOn: true, onChange: vi.fn(), lockedReason: "Each agent runs in its own worktree." },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /^Branch: main/ }));
    expect(screen.getByRole("switch", { name: "New worktree" })).toBeDisabled();
    expect(screen.getByText("Each agent runs in its own worktree.")).toBeInTheDocument();
  });

  it("truncates a long branch name on the chip and keeps it whole in the tooltip", () => {
    const long = `feature/${"x".repeat(72)}`;
    renderDraft(folderControl({ branch: branchControl({ current: long }) }));

    const chip = screen.getByRole("button", { name: `Branch: ${long}` });
    expect(chip).toHaveClass("max-w-full");
    expect(chip.getAttribute("title")).toBe(long);
    expect(within(chip).getByText(long)).toHaveClass("truncate");
  });
});

describe("the agent chip", () => {
  const agents: AgentChoice[] = [
    { value: "claude-acp", label: "Claude Code", name: "Claude Code", signIn: "ready" },
    { value: "codex-acp", label: "Codex", name: "Codex", signIn: "unchecked" },
    {
      value: "qwen-code",
      label: "Qwen Code",
      name: "Qwen Code",
      signIn: "needed",
      blockedBy: "sign-in",
      disabledReason: "You need to sign in first.",
    },
  ];

  it("lists each agent with its logo, name and readiness, and says how a compare run works", () => {
    renderDraft(folderControl({ branch: branchControl() }), agents);

    fireEvent.click(screen.getByRole("button", { name: "Agent: Claude Code" }));
    const dialog = within(screen.getByRole("dialog", { name: "Choose agents" }));
    expect(dialog.getByText("Pick more than one to compare")).toBeInTheDocument();
    expect(dialog.getByText("With two or more agents, each runs in its own worktree in its safest mode.")).toBeInTheDocument();
    expect(dialog.getByText("Ready")).toBeInTheDocument();
    expect(dialog.getByText("Not checked")).toBeInTheDocument();
    expect(dialog.getByRole("option", { name: "Codex" }).querySelector("img, [aria-hidden='true']")).not.toBeNull();
  });

  it("dims an agent that cannot join, and says why", () => {
    renderDraft(folderControl({ branch: branchControl() }), agents);

    fireEvent.click(screen.getByRole("button", { name: "Agent: Claude Code" }));
    const box = screen.getByRole("checkbox", { name: "Compare Qwen Code" });
    expect(box).toBeDisabled();
    // The row's status word says why, and the whole row is dimmed.
    expect(box).toHaveAccessibleDescription("Needs sign-in");
    expect(screen.getByRole("option", { name: "Qwen Code" }).closest("[data-agent-row]")).toHaveClass("opacity-55");
  });

  it("closes on Escape and gives focus back to the chip", () => {
    renderDraft(folderControl({ branch: branchControl() }), agents);

    const chip = screen.getByRole("button", { name: "Agent: Claude Code" });
    fireEvent.click(chip);
    const codex = screen.getByRole("option", { name: "Codex" });
    codex.focus();
    fireEvent.keyDown(codex, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Choose agents" })).toBeNull();
    expect(chip).toHaveFocus();
  });
});
