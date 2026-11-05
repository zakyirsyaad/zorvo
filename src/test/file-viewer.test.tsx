import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { FileViewer, type FileViewerProps } from "../components/files/FileViewer";

const ROOT = "/Users/test/proj";

let fileResult: () => Promise<unknown> = () => Promise.resolve({ kind: "text", text: "const a = 1;\nlet b;\n", size: 20 });

const mockInvoke = vi.fn((cmd: string, args?: Record<string, unknown>) => {
  if (cmd === "read_workspace_file") return fileResult();
  if (cmd === "open_path") return Promise.resolve(undefined);
  return Promise.resolve(args === undefined ? undefined : null);
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

async function renderViewer(overrides: Partial<FileViewerProps> = {}) {
  const props: FileViewerProps = {
    rootPath: ROOT,
    relativePath: "src/a.ts",
    version: 0,
    onBack: vi.fn(),
    onInsertPath: vi.fn(),
    ...overrides,
  };
  const view = await act(async () => render(<FileViewer {...props} />));
  return { props, ...view };
}

beforeEach(() => {
  mockInvoke.mockClear();
  fileResult = () => Promise.resolve({ kind: "text", text: "const a = 1;\nlet b;\n", size: 20 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("FileViewer — header", () => {
  it("goes back to the tree from its Files button", async () => {
    const { props } = await renderViewer();

    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(props.onBack).toHaveBeenCalled();
  });

  it("shows the path as a mono breadcrumb with its marker", async () => {
    await renderViewer({ marker: "modified" });

    const path = screen.getByRole("heading", { name: /src\/a\.ts/ });
    expect(path).toHaveClass("font-mono");
    expect(within(path).getByText("M")).toHaveClass("text-status-attention");
    expect(within(path).getByText("Modified")).toHaveClass("sr-only");
  });

  it("adds the file to the prompt, opens it in its app, and copies its path", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { props } = await renderViewer();

    fireEvent.click(screen.getByRole("button", { name: "Add to prompt" }));
    expect(props.onInsertPath).toHaveBeenCalledWith(`${ROOT}/src/a.ts`);

    fireEvent.click(screen.getByRole("button", { name: "Open in editor" }));
    expect(mockInvoke).toHaveBeenCalledWith("open_path", { root: ROOT, relative: "src/a.ts" });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    });
    expect(writeText).toHaveBeenCalledWith(`${ROOT}/src/a.ts`);
    expect(screen.getByRole("button", { name: "Path copied" })).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("button", { name: "Copy path" })).toBeInTheDocument();
  });
});

describe("FileViewer — contents", () => {
  it("says the language, the line count and that it is read only", async () => {
    await renderViewer();

    expect(screen.getByText("TypeScript · 2 lines · Read only")).toBeInTheDocument();
  });

  it("numbers each line", async () => {
    await renderViewer();

    const body = screen.getByRole("region", { name: "Contents of a.ts" });
    const rows = body.querySelectorAll("[data-line]");
    expect([...rows].map((row) => row.getAttribute("data-line"))).toEqual(["1", "2"]);
    expect(within(rows[0] as HTMLElement).getByText("1")).toHaveClass("select-none");
    expect(rows[1]).toHaveTextContent("let b;");
  });

  it("says one line in the singular", async () => {
    fileResult = () => Promise.resolve({ kind: "text", text: "x", size: 1 });
    await renderViewer();

    expect(screen.getByText("TypeScript · 1 line · Read only")).toBeInTheDocument();
  });

  it("says a binary file is not shown, and offers its app", async () => {
    fileResult = () => Promise.resolve({ kind: "binary", size: 2048 });
    await renderViewer({ relativePath: "logo.png" });

    expect(screen.getByText("This file is binary (2 KB), so it is not shown.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open in editor" })).toBeInTheDocument();
  });

  it("says a file is too large to show", async () => {
    fileResult = () => Promise.resolve({ kind: "tooLarge", size: 1_572_864, limit: 1_048_576 });
    await renderViewer();

    expect(screen.getByText("This file is too large to show (1.5 MB; the limit is 1 MB).")).toBeInTheDocument();
  });

  it("says a file that is gone is no longer here, and keeps the way back", async () => {
    fileResult = () => Promise.reject('Path "src/a.ts" is not accessible: No such file or directory');
    await renderViewer();

    expect(screen.getByText("This file is no longer here.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Files" })).toBeInTheDocument();
  });

  it("shows any other failure in words", async () => {
    fileResult = () => Promise.reject("src/a.ts is not one of your workspaces");
    await renderViewer();

    expect(screen.getByRole("alert")).toHaveTextContent("src/a.ts is not one of your workspaces");
  });

  it("reads the file again when its version moves", async () => {
    const { rerender, props } = await renderViewer();
    expect(mockInvoke.mock.calls.filter(([cmd]) => cmd === "read_workspace_file")).toHaveLength(1);

    fileResult = () => Promise.resolve({ kind: "text", text: "changed\n", size: 8 });
    await act(async () => {
      rerender(<FileViewer {...props} version={1} />);
    });
    expect(mockInvoke.mock.calls.filter(([cmd]) => cmd === "read_workspace_file")).toHaveLength(2);
    expect(screen.getByRole("region", { name: "Contents of a.ts" })).toHaveTextContent("changed");
  });
});
