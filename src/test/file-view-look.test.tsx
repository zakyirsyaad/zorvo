import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { FileViewer, type FileViewerProps } from "../components/files/FileViewer";
import { TOKEN_STYLE } from "../lib/code-tokens";

const ROOT = "/Users/test/proj";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) =>
    Promise.resolve(
      cmd === "read_workspace_file"
        ? { kind: "text", text: "const a = 1;\nlet b;\nlet c;\nlet d;\nlet e;\n", size: 40 }
        : cmd === "session_file_diff"
          ? "@@ -1 +1 @@\n-const a = 0;\n+const a = 1;\n"
          : null,
    ),
}));

async function renderViewer(overrides: Partial<FileViewerProps> = {}) {
  await act(async () => {
    render(
      <FileViewer rootPath={ROOT} relativePath="src/sidebar/a.ts" marker="modified" version={0} onBack={vi.fn()} onInsertPath={vi.fn()} onInsertText={vi.fn()} {...overrides} />,
    );
  });
}

function selectLines(firstLine: number, lastLine: number) {
  const body = screen.getByRole("region", { name: "Contents of a.ts" });
  const codeOf = (line: number) => body.querySelector(`[data-line="${line}"]`)!.lastElementChild!;
  const range = document.createRange();
  range.setStart(codeOf(firstLine), 0);
  range.setEnd(codeOf(lastLine), codeOf(lastLine).childNodes.length);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent.mouseUp(body);
}

describe("the file view as drawn", () => {
  it("the path bar is 44px and the meta bar its own 32px row", async () => {
    await renderViewer();
    const back = screen.getByRole("button", { name: /Files/ });
    expect(back.parentElement).toHaveClass("h-11");
    const meta = screen.getByText(/· Read only/).parentElement!;
    expect(meta).toHaveClass("h-8");
    expect(meta).not.toBe(back.parentElement);
  });

  it("the back button is 26px and the header actions are 28px", async () => {
    await renderViewer();
    expect(screen.getByRole("button", { name: /Files/ })).toHaveClass("h-6.5", "text-fg-secondary");
    expect(screen.getByRole("button", { name: "Add a.ts to prompt" })).toHaveClass("h-7", "w-7");
    expect(screen.getByRole("button", { name: "Open in editor" })).toHaveClass("h-7", "w-7");
  });

  it("the breadcrumb is a subtle mono heading with the name in fg", async () => {
    await renderViewer();
    // A heading, as before: it names the open file for heading navigation; it holds no links to be a nav.
    const path = screen.getByRole("heading", { level: 3, name: /a\.ts/ });
    expect(path).toHaveClass("font-mono", "text-caption", "text-fg-subtle");
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByText("a.ts", { selector: "h3 span" })).toHaveClass("text-fg");
  });

  it("a long path cuts its folders, never the file name", async () => {
    await renderViewer();
    const path = screen.getByRole("heading", { level: 3, name: /a\.ts/ });
    expect(screen.getByText("a.ts", { selector: "h3 span" })).toHaveClass("shrink-0");
    expect(path.querySelector(".truncate")).toHaveTextContent("src/sidebar/");
  });

  it("the body is a 12/20 well on ground, its padding and line height from the card's own numbers", async () => {
    await renderViewer();
    const body = screen.getByRole("region", { name: "Contents of a.ts" });
    expect(body).toHaveClass("bg-ground", "text-ui-sm");
    expect(body.style.paddingTop).toBe("10px");
    expect(body.style.lineHeight).toBe("20px");
  });

  it("a selection made upward gets its card above its first line", async () => {
    await renderViewer();
    const body = screen.getByRole("region", { name: "Contents of a.ts" });
    const codeOf = (line: number) => body.querySelector(`[data-line="${line}"]`)!.lastElementChild!;
    // From the end of line 4 back to the start of line 3, as a drag upward makes it.
    window.getSelection()!.setBaseAndExtent(codeOf(4), codeOf(4).childNodes.length, codeOf(3), 0);
    fireEvent.mouseUp(body);
    const card = screen.getByRole("button", { name: "Add lines 3–4 to prompt" }).parentElement!;
    expect(card.style.top).toBe(`${10 + 2 * 20 - 4}px`);
    expect(card).toHaveClass("-translate-y-full");
  });

  it("selected lines are tinted", async () => {
    await renderViewer();
    selectLines(3, 4);
    const body = screen.getByRole("region", { name: "Contents of a.ts" });
    expect(body.querySelector('[data-line="3"]')).toHaveClass("bg-line-selected");
    expect(body.querySelector('[data-line="4"]')).toHaveClass("bg-line-selected");
    expect(body.querySelector('[data-line="2"]')).not.toHaveClass("bg-line-selected");
  });

  it("the add-lines popover sits under the last selected line", async () => {
    await renderViewer();
    selectLines(3, 4);
    const card = screen.getByRole("button", { name: "Add lines 3–4 to prompt" }).parentElement!;
    expect(card.style.top).toBe("94px");
    expect(card.style.left).toBe("56px");
    expect(card).toHaveClass("rounded-panel", "bg-surface-3", "p-1", "shadow-popover");
    expect(card).not.toHaveClass("-translate-y-full");
    expect(screen.getByRole("region", { name: "Contents of a.ts" }).contains(card)).toBe(true);
  });

  it("keywords are medium weight", () => {
    expect(TOKEN_STYLE.keyword).toContain("font-medium");
  });

  it("keeps the code rows when the window re-renders during a selection", async () => {
    function Harness() {
      const [, setTick] = useState(0);
      return (
        <>
          <button onClick={() => setTick((t) => t + 1)}>tick</button>
          {/* A new callback each render, as App passes one. */}
          <FileViewer rootPath={ROOT} relativePath="src/sidebar/a.ts" version={0} onBack={() => {}} onInsertPath={() => {}} onInsertText={() => {}} />
        </>
      );
    }
    await act(async () => {
      render(<Harness />);
    });
    selectLines(3, 4);

    // The rows read TOKEN_STYLE for every keyword they draw: a read means they were drawn again.
    const keyword = TOKEN_STYLE.keyword;
    let reads = 0;
    Object.defineProperty(TOKEN_STYLE, "keyword", { configurable: true, enumerable: true, get: () => (reads++, keyword) });
    try {
      act(() => screen.getByText("tick").click());
      selectLines(3, 4);
      expect(reads).toBe(0);
    } finally {
      Object.defineProperty(TOKEN_STYLE, "keyword", { configurable: true, enumerable: true, writable: true, value: keyword });
    }
  });
});
