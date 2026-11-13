import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { FilesPanel, type FilesPanelProps } from "../components/FilesPanel";
import type { DirEntryInfo } from "../lib/files";

const ROOT = "/Users/test/agent-desktop";
const dir = (relativePath: string): DirEntryInfo => ({ name: relativePath.split("/").pop()!, relativePath, isDir: true });
const file = (relativePath: string): DirEntryInfo => ({ name: relativePath.split("/").pop()!, relativePath, isDir: false });

const TREE: Record<string, DirEntryInfo[]> = {
  "": [dir("src"), file("CLAUDE.md")],
  src: [dir("src/components"), file("src/main.ts")],
  "src/components": [file("src/components/SessionList.tsx")],
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    Promise.resolve(cmd === "list_directory" ? structuredClone(TREE[String(args?.relative)] ?? []) : undefined),
}));

const markers = {
  files: new Map([["src/components/SessionList.tsx", "modified" as const]]),
  folders: new Set(["src", "src/components"]),
};

async function renderPanel(overrides: Partial<FilesPanelProps> = {}) {
  await act(async () => {
    render(<FilesPanel rootPath={ROOT} rootName="agent-desktop" onInsertPath={vi.fn()} onRevealRoot={vi.fn()} markers={markers} {...overrides} />);
  });
}

async function openTo(...folders: string[]) {
  for (const name of folders) {
    await act(async () => fireEvent.click(screen.getByRole("button", { name })));
  }
}

describe("the Files tab as drawn", () => {
  it("the header shows the folder name over its path", async () => {
    await renderPanel();
    expect(screen.getByText("agent-desktop", { selector: "span" })).toHaveClass("font-semibold");
    expect(screen.getByText(ROOT)).toHaveClass("font-mono", "text-caption", "text-fg-subtle");
    expect(screen.queryByRole("heading", { name: "Files" })).toBeNull();
  });

  it("header buttons are 28px and Reveal uses the external-arrow icon", async () => {
    await renderPanel();
    const reveal = screen.getByRole("button", { name: "Reveal in Finder" });
    expect(reveal).toHaveClass("h-7", "w-7");
    expect(reveal.querySelector("svg.lucide-external-link")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Refresh files" })).toHaveClass("h-7");
  });

  it("the filter field is 32px with a radius of 8 and a quiet edge", async () => {
    await renderPanel();
    expect(screen.getByRole("textbox", { name: "Filter files" }).parentElement).toHaveClass("h-8", "rounded-lg", "border-border");
  });

  it("rows are 26px and indent 16px a level", async () => {
    await renderPanel();
    await openTo("src", "components");
    const deep = within(screen.getByRole("treeitem", { name: /SessionList\.tsx/ })).getByRole("button", { name: /^SessionList\.tsx/ });
    expect(deep).toHaveClass("h-[26px]");
    expect(deep.style.paddingLeft).toBe("54px");
    const folder = within(screen.getByRole("treeitem", { name: /^components/ })).getAllByRole("button")[0];
    expect(folder.style.paddingLeft).toBe("20px");
    const top = within(screen.getByRole("treeitem", { name: /CLAUDE\.md/ })).getByRole("button", { name: /^CLAUDE\.md/ });
    expect(top.style.paddingLeft).toBe("22px");
  });

  it("an open folder keeps the closed icon", async () => {
    await renderPanel();
    await openTo("src");
    const src = within(screen.getByRole("treeitem", { name: /^src/ })).getAllByRole("button")[0];
    expect(src.querySelector("svg.lucide-folder")).not.toBeNull();
    expect(src.querySelector("svg.lucide-folder-open")).toBeNull();
  });

  it("markers are 10px semibold", async () => {
    await renderPanel();
    await openTo("src", "components");
    const row = screen.getByRole("treeitem", { name: /SessionList\.tsx/ });
    expect(within(row).getByText("M")).toHaveClass("text-micro", "font-semibold", "text-status-attention");
    expect(within(screen.getByRole("treeitem", { name: /^src/ })).getAllByRole("img", { name: "Contains changes" })[0]).toHaveTextContent("•");
  });

  it("Add to prompt is a pill with its words", async () => {
    await renderPanel();
    await openTo("src", "components");
    const add = screen.getByRole("button", { name: "Add SessionList.tsx to prompt" });
    expect(add).toHaveTextContent("Add to prompt");
    expect(add).toHaveClass("h-5", "border-border-strong");
  });

  it("the pill takes no room until its row is pointed at or focused", async () => {
    await renderPanel();
    await openTo("src", "components");
    const add = screen.getByRole("button", { name: "Add SessionList.tsx to prompt" });
    // Laid over the row's end rather than in its flow, and never display:none, so a screen reader's cursor and
    // Shift+Tab still reach it while it is not shown.
    expect(add).toHaveClass("absolute", "opacity-0", "group-hover:opacity-100", "group-focus-within:opacity-100");
    expect(add).not.toHaveClass("hidden");
    expect(add.parentElement).toHaveClass("relative");
  });
});
