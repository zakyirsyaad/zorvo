import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ToolCallList } from "../components/chat/ToolCallList";
import type { ToolExecution } from "../types";

const editTool: ToolExecution = {
  id: "t-1",
  name: "Edit src/app.ts",
  status: "completed",
  kind: "edit",
  details: [{ kind: "diff", path: "/repo/src/app.ts", oldText: "keep\nconst a = 1;\n", newText: "keep\nconst a = 2;\n" }],
};

describe("ToolCallList", () => {
  it("shows a tool's diff with removed and added lines, open by default", () => {
    render(<ToolCallList tools={[editTool]} defaultOpenDiffs isTurnOver />);

    const diff = screen.getByRole("region", { name: "Changes to /repo/src/app.ts" });
    expect(within(diff).getByText("const a = 1;").closest("[data-line]")?.getAttribute("data-line")).toBe("removed");
    expect(within(diff).getByText("const a = 2;").closest("[data-line]")?.getAttribute("data-line")).toBe("added");
    expect(within(diff).getByText("keep").closest("[data-line]")?.getAttribute("data-line")).toBe("context");
    expect(screen.getByRole("button", { name: /Edit src\/app\.ts/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("labels a new file and counts its lines", () => {
    render(
      <ToolCallList
        tools={[{ ...editTool, details: [{ kind: "diff", path: "/repo/new.ts", oldText: null, newText: "a\nb\n" }] }]}
        defaultOpenDiffs
        isTurnOver
      />
    );

    const diff = within(screen.getByRole("region", { name: "Changes to /repo/new.ts" }));
    expect(diff.getByText("New file")).toBeDefined();
    // The row counts the lines too; the diff's own header says them again.
    expect(diff.getByText("+2")).toBeDefined();
  });

  it("mounts a tool's text output only after its row is opened", () => {
    render(
      <ToolCallList
        tools={[{ ...editTool, name: "Run npm test", kind: "execute", details: [{ kind: "text", text: "12 passed" }] }]}
        defaultOpenDiffs
        isTurnOver
      />
    );

    expect(screen.queryByText("12 passed")).toBeNull();
    const row = screen.getByRole("button", { name: /Run npm test/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(row);

    expect(screen.getByText("12 passed")).toBeDefined();
    expect(row.getAttribute("aria-expanded")).toBe("true");
  });

  it("draws the MCP credits check as Checked credits_balance with its result at the right", () => {
    render(
      <ToolCallList
        tools={[
          {
            id: "mcp-1",
            name: "credits_balance",
            status: "completed",
            kind: "fetch",
            details: [
              {
                kind: "text",
                text: "52 credits left · ≈ 130 turns\n{\"credits\":52,\"approxTurns\":130}",
              },
            ],
          },
        ]}
        defaultOpenDiffs={false}
        isTurnOver
      />,
    );

    const row = screen.getByRole("button", { name: /credits_balance/ });
    expect(within(row).getByText("Checked")).toBeTruthy();
    expect(within(row).getByText("credits_balance").closest("span")?.classList.contains("font-mono")).toBe(true);
    expect(within(row).getByText("52 credits left · ≈ 130 turns")).toBeTruthy();
    expect(row.querySelector(".lucide-clock")).not.toBeNull();
  });

  it("matches the credits row through the zorvo-credits server prefix only", () => {
    const tool = {
      id: "mcp-prefixed",
      status: "completed" as const,
      kind: "fetch" as const,
      details: [{ kind: "text" as const, text: "52 credits left" }],
    };
    render(
      <ToolCallList
        tools={[
          { ...tool, name: "zorvo-credits__credits_balance" },
          { ...tool, id: "mcp-foreign", name: "other-server__credits_balance" },
        ]}
        defaultOpenDiffs={false}
        isTurnOver
      />,
    );

    const ours = screen.getByRole("button", { name: /Checked/ });
    expect(within(ours).getByText("Checked")).toBeTruthy();
    const foreign = screen.getByRole("button", { name: /other-server__credits_balance/ });
    expect(within(foreign).queryByText("Checked")).toBeNull();
  });

  it("shows the verb, the target and the status word", () => {
    render(<ToolCallList tools={[{ ...editTool, locations: ["src/app.ts"] }]} defaultOpenDiffs={false} isTurnOver />);
    const row = screen.getByRole("button", { name: /Edited/ });
    expect(within(row).getByText("Edited")).toBeDefined();
    // The full path as one mono span, as the canvas draws it.
    expect(within(row).getByText("src/app.ts").parentElement?.className).toContain("font-mono");
    expect(within(row).getByText("Done")).toBeDefined();
  });

  it("keeps the file name of a long absolute path in sight, with every path on hover", () => {
    const path = "/Users/mac/Library/Application Support/xyz.zorvo.desktop/worktrees/agent-fix-the-parser/src/lib/parser.ts";
    render(
      <ToolCallList tools={[{ ...editTool, locations: [path, "/tmp/other.ts"] }]} defaultOpenDiffs={false} isTurnOver />,
    );
    const row = screen.getByRole("button", { name: /Edited/ });
    // One span with the whole path, cut at its start so the file's name stays in sight.
    const shown = within(row).getByText(path).parentElement as HTMLElement;
    expect(shown.className).toContain("font-mono");
    expect(shown.className).toContain("[direction:rtl]");
    const titles = [...row.querySelectorAll("[title]")].map((element) => element.getAttribute("title"));
    expect(titles).toContain(`${path}\n/tmp/other.ts`);
  });

  it("counts an edit's lines", () => {
    render(<ToolCallList tools={[{ ...editTool, locations: ["src/app.ts"] }]} defaultOpenDiffs={false} isTurnOver />);
    const row = screen.getByRole("button", { name: /Edited/ });
    expect(within(row).getByText("+1")).toBeDefined();
    expect(within(row).getByText("−1")).toBeDefined();
  });

  it("shows a command's output on the terminal ground", () => {
    render(
      <ToolCallList
        tools={[{ ...editTool, name: "Run npm test", kind: "execute", command: "npm test", details: [{ kind: "text", text: "12 passed" }] }]}
        defaultOpenDiffs
        isTurnOver
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Ran/ }));
    expect(screen.getByText("12 passed").closest("pre")?.className).toContain("bg-terminal-bg");
  });

  it("shows a plain row for a tool without details", () => {
    render(<ToolCallList tools={[{ ...editTool, details: undefined }]} defaultOpenDiffs isTurnOver />);

    expect(screen.getByText("Edit src/app.ts")).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
