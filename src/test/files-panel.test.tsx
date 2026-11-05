import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import { FilesPanel, type FilesPanelProps } from "../components/FilesPanel";
import type { DirEntryInfo } from "../lib/files";

const ROOT = "/Users/test/proj";

function dir(relativePath: string): DirEntryInfo {
  return { name: relativePath.split("/").pop() ?? relativePath, relativePath, isDir: true };
}

function file(relativePath: string): DirEntryInfo {
  return { name: relativePath.split("/").pop() ?? relativePath, relativePath, isDir: false };
}

/** Listing per folder, already in backend order (folders first, then files). */
const TREE: Record<string, DirEntryInfo[]> = {
  "": [dir(".claude"), dir("src"), file("README.md"), file("package.json")],
  ".claude": [file(".claude/settings.json")],
  src: [dir("src/components"), file("src/main.ts")],
  "src/components": [file("src/components/Button.tsx")],
};

let tree: Record<string, DirEntryInfo[] | Error> = TREE;
let openPathResult: () => Promise<void> = () => Promise.resolve();

const mockInvoke = vi.fn((cmd: string, args?: Record<string, unknown>) => {
  if (cmd === "list_directory") {
    const listing = tree[String(args?.relative)];
    if (listing instanceof Error) return Promise.reject(listing.message);
    return Promise.resolve(structuredClone(listing ?? []));
  }
  if (cmd === "open_path") return openPathResult();
  return Promise.resolve(undefined);
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

async function renderPanel(overrides: Partial<FilesPanelProps> = {}): Promise<FilesPanelProps> {
  const props: FilesPanelProps = {
    rootPath: ROOT,
    rootName: "proj",
    onClose: vi.fn(),
    onInsertPath: vi.fn(),
    onRevealRoot: vi.fn(),
    ...overrides,
  };
  await act(async () => {
    render(<FilesPanel {...props} />);
  });
  return props;
}

describe("FilesPanel inside the inspector", () => {
  it("has no close button of its own inside the inspector", async () => {
    await renderPanel({ onClose: undefined });
    expect(screen.queryByRole("button", { name: "Close files panel" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Files panel" }).className).not.toContain("w-72");
  });
});

function fileTree(): HTMLElement {
  return screen.getByRole("tree", { name: "Files in proj" });
}

function row(name: string): HTMLElement {
  return within(fileTree()).getByRole("treeitem", { name });
}

function queryRow(name: string): HTMLElement | null {
  return within(fileTree()).queryByRole("treeitem", { name });
}

function visibleNames(): string[] {
  return within(fileTree())
    .getAllByRole("treeitem")
    .map((item) => item.getAttribute("aria-label") ?? "");
}

async function clickRow(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(within(row(name)).getAllByRole("button")[0]);
  });
}

async function typeFilter(value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(screen.getByRole("textbox", { name: "Filter files" }), { target: { value } });
  });
}

function listCalls(): unknown[] {
  return mockInvoke.mock.calls.filter(([cmd]) => cmd === "list_directory").map(([, args]) => args);
}

beforeEach(() => {
  mockInvoke.mockClear();
  tree = TREE;
  openPathResult = () => Promise.resolve();
});

describe("FilesPanel — header", () => {
  it("shows the title, filter, refresh, reveal and close controls", async () => {
    const props = await renderPanel();

    expect(screen.getByRole("heading", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Filter files" })).toHaveAttribute(
      "placeholder",
      "Filter files"
    );
    expect(screen.getByRole("button", { name: "Refresh files" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reveal in Finder" }));
    expect(props.onRevealRoot).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Close files panel" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("hides Reveal in Finder when no handler is given", async () => {
    await renderPanel({ onRevealRoot: undefined });

    expect(screen.queryByRole("button", { name: "Reveal in Finder" })).toBeNull();
  });
});

describe("FilesPanel — tree", () => {
  it("lists the root folder with folders first and hidden entries included", async () => {
    await renderPanel();

    expect(mockInvoke).toHaveBeenCalledWith("list_directory", { root: ROOT, relative: "" });
    expect(visibleNames()).toEqual([".claude", "src", "README.md", "package.json"]);
    expect(row("src")).toHaveAttribute("aria-expanded", "false");
    expect(row("README.md")).not.toHaveAttribute("aria-expanded");
  });

  it("loads a folder's children when it is expanded and hides them when collapsed", async () => {
    await renderPanel();

    await clickRow("src");

    expect(mockInvoke).toHaveBeenCalledWith("list_directory", { root: ROOT, relative: "src" });
    expect(row("src")).toHaveAttribute("aria-expanded", "true");
    expect(visibleNames()).toEqual([".claude", "src", "components", "main.ts", "README.md", "package.json"]);

    await clickRow("src");

    expect(row("src")).toHaveAttribute("aria-expanded", "false");
    expect(queryRow("main.ts")).toBeNull();
  });

  it("reuses the cached listing when a folder is expanded again", async () => {
    await renderPanel();

    await clickRow("src");
    await clickRow("src");
    await clickRow("src");

    expect(listCalls()).toEqual([
      { root: ROOT, relative: "" },
      { root: ROOT, relative: "src" },
    ]);
    expect(queryRow("main.ts")).not.toBeNull();
  });

  it("opens a file with the default app when it is clicked", async () => {
    await renderPanel();

    await clickRow("README.md");

    expect(mockInvoke).toHaveBeenCalledWith("open_path", { root: ROOT, relative: "README.md" });
  });

  it("shows an inline error when a file cannot be opened", async () => {
    openPathResult = () => Promise.reject("open failed");
    await renderPanel();

    await clickRow("README.md");

    expect(await screen.findByRole("alert")).toHaveTextContent("open failed");
  });

  it("adds a file's absolute path to the prompt from its row", async () => {
    const props = await renderPanel();
    await clickRow("src");

    fireEvent.click(within(row("main.ts")).getByRole("button", { name: "Add main.ts to prompt" }));

    expect(props.onInsertPath).toHaveBeenCalledWith("/Users/test/proj/src/main.ts");
    // Folders have no add-to-prompt button; "components" is collapsed so its subtree is empty.
    expect(within(row("components")).queryByRole("button", { name: /to prompt/ })).toBeNull();
  });

  it("omits the add-to-prompt buttons when no handler is given", async () => {
    await renderPanel({ onInsertPath: undefined });

    expect(within(row("README.md")).queryByRole("button", { name: /to prompt/ })).toBeNull();
  });

  it("shows a folder's load error inline", async () => {
    tree = { ...TREE, src: new Error("Permission denied") };
    await renderPanel();

    await clickRow("src");

    expect(within(fileTree()).getByRole("alert")).toHaveTextContent("Permission denied");
    expect(queryRow("README.md")).not.toBeNull();
  });

  it("shows the root's load error inline", async () => {
    tree = { "": new Error("Workspace root is not accessible") };
    await renderPanel();

    expect(screen.getByRole("alert")).toHaveTextContent("Workspace root is not accessible");
  });

  it("reloads the root and expanded folders on refresh", async () => {
    await renderPanel();
    await clickRow("src");
    mockInvoke.mockClear();
    tree = { ...TREE, "": [...TREE[""], file("new-file.ts")], src: [file("src/renamed.ts")] };

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh files" }));
    });

    await waitFor(() => expect(queryRow("new-file.ts")).not.toBeNull());
    expect(queryRow("renamed.ts")).not.toBeNull();
    expect(queryRow("main.ts")).toBeNull();
    expect(listCalls()).toEqual(
      expect.arrayContaining([
        { root: ROOT, relative: "" },
        { root: ROOT, relative: "src" },
      ])
    );
  });
});

describe("FilesPanel — the file viewer", () => {
  it("opens a clicked file in the viewer instead of its app, when the viewer is wired", async () => {
    const onViewFile = vi.fn();
    await renderPanel({ onViewFile });

    fireEvent.click(screen.getByRole("button", { name: "src" }));
    fireEvent.click(await screen.findByRole("button", { name: /^main\.ts/ }));
    expect(onViewFile).toHaveBeenCalledWith("src/main.ts");
    expect(mockInvoke).not.toHaveBeenCalledWith("open_path", expect.anything());
  });

  it("shows the viewer in the tree's place while a file is open, and keeps the tree for the way back", async () => {
    const onCloseFile = vi.fn();
    const { rerender } = render(<FilesPanel rootPath={ROOT} rootName="proj" viewedFile="README.md" onCloseFile={onCloseFile} />);
    await act(async () => {});

    expect(screen.queryByRole("tree")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(onCloseFile).toHaveBeenCalled();

    rerender(<FilesPanel rootPath={ROOT} rootName="proj" viewedFile={null} onCloseFile={onCloseFile} />);
    expect(screen.getByRole("tree", { name: "Files in proj" })).toBeInTheDocument();
  });
});

describe("FilesPanel — git markers", () => {
  const markers = {
    files: new Map([
      ["src/main.ts", "modified" as const],
      ["README.md", "added" as const],
    ]),
    folders: new Set(["src"]),
  };

  it("marks a modified file M and an added one A, in words for a screen reader", async () => {
    await renderPanel({ markers });

    const readme = screen.getByRole("treeitem", { name: /README\.md/ });
    expect(within(readme).getByText("A")).toHaveClass("text-status-running");
    expect(within(readme).getByText("Added")).toHaveClass("sr-only");
    expect(within(screen.getByRole("treeitem", { name: /package\.json/ })).queryByText(/^[MA]$/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "src" }));
    const main = await screen.findByRole("treeitem", { name: /main\.ts/ });
    expect(within(main).getByText("M")).toHaveClass("text-status-attention");
    expect(within(main).getByText("Modified")).toHaveClass("sr-only");
  });

  it("puts a dot on a folder that holds changes", async () => {
    await renderPanel({ markers });

    const src = screen.getByRole("treeitem", { name: /^src/ });
    expect(within(src).getByRole("img", { name: "Contains changes" })).toBeInTheDocument();
    expect(within(screen.getByRole("treeitem", { name: /\.claude/ })).queryByRole("img", { name: "Contains changes" })).toBeNull();
  });

  it("writes the tree's names in mono", async () => {
    await renderPanel();

    expect(within(screen.getByRole("treeitem", { name: /README\.md/ })).getByText("README.md")).toHaveClass("font-mono");
  });
});

describe("FilesPanel — workspace switch", () => {
  it("loads the new root and drops the old tree when rootPath changes", async () => {
    const { rerender } = render(<FilesPanel rootPath={ROOT} rootName="proj" onClose={vi.fn()} />);
    await screen.findByRole("treeitem", { name: "README.md" });
    tree = { "": [file("other.txt")] };

    await act(async () => {
      rerender(<FilesPanel rootPath="/Users/test/other" rootName="proj" onClose={vi.fn()} />);
    });

    expect(mockInvoke).toHaveBeenCalledWith("list_directory", { root: "/Users/test/other", relative: "" });
    expect(visibleNames()).toEqual(["other.txt"]);
  });
});

describe("FilesPanel — filter", () => {
  it("shows matching loaded entries together with their parent folders", async () => {
    await renderPanel();
    await clickRow("src");
    await clickRow("components");
    await clickRow("src");

    await typeFilter("butt");

    expect(visibleNames()).toEqual(["src", "components", "Button.tsx"]);
  });

  it("matches folder names too, case-insensitively", async () => {
    await renderPanel();

    await typeFilter("CLAUDE");

    expect(visibleNames()).toEqual([".claude"]);
  });

  it("only searches entries that have been loaded", async () => {
    await renderPanel();

    await typeFilter("main");

    expect(screen.queryByRole("treeitem", { name: "main.ts" })).toBeNull();
    expect(screen.getByText(/No loaded files match/)).toBeInTheDocument();
  });

  it("restores the normal tree when the filter is cleared", async () => {
    await renderPanel();
    await typeFilter("readme");
    expect(visibleNames()).toEqual(["README.md"]);

    await typeFilter("");

    expect(visibleNames()).toEqual([".claude", "src", "README.md", "package.json"]);
  });
});
