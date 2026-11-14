import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ToolsPart } from "../components/chat/ToolsPart";
import { lastTouchedLabel } from "../lib/tool-summary";
import type { ToolExecution } from "../types";

const read: ToolExecution = {
  id: "t-1",
  name: "Read List.tsx",
  status: "completed",
  kind: "read",
  locations: ["src/components/sidebar/SessionList.tsx"],
};
const edit: ToolExecution = {
  id: "t-2",
  name: "Edit Row.tsx",
  status: "completed",
  kind: "edit",
  locations: ["src/components/sidebar/SessionRow.tsx"],
};
const ran: ToolExecution = {
  id: "t-3",
  name: "pnpm test",
  status: "completed",
  kind: "execute",
  command: "pnpm vitest run session-list",
  details: [{ kind: "text", text: "Test Files 1 passed (1)" }],
};

function openCard(tools: ToolExecution[], isTurnOver = true) {
  render(<ToolsPart tools={tools} isCurrentTurn={false} isTurnOver={isTurnOver} />);
  const header = screen.getAllByRole("button")[0];
  fireEvent.click(header);
  return { header, card: header.parentElement as HTMLElement };
}

describe("lastTouchedLabel", () => {
  it("names the last touched file by its last two segments, and counts the others", () => {
    expect(lastTouchedLabel([read, edit])).toBe("sidebar/SessionRow.tsx +1");
    expect(lastTouchedLabel([edit])).toBe("sidebar/SessionRow.tsx");
    expect(lastTouchedLabel([ran])).toBeNull();
  });
});

describe("the tool calls, as drawn", () => {
  it("is a 28px ghost summary as wide as its words, with no card and no last touched file", () => {
    render(<ToolsPart tools={[read, edit]} isCurrentTurn={false} isTurnOver />);
    const header = screen.getAllByRole("button")[0];
    const part = header.parentElement as HTMLElement;
    expect(part.className).not.toContain("border");
    expect(part.className).not.toContain("bg-surface-2");
    expect(header).toHaveClass("h-7", "self-start", "-ml-1", "pl-1", "pr-2", "rounded-md", "text-ui-sm", "text-fg-secondary");
    expect(header.className.split(" ")).not.toContain("w-full");
    expect(within(header).queryByText("sidebar/SessionRow.tsx +1")).toBeNull();
  });

  it("says how many still run, in fg-subtle, and opens the steps on a rail", () => {
    const running = { ...edit, status: "running" as const };
    const { header, card } = openCard([read, running], false);
    expect(within(header).getByText("1 still running")).toHaveClass("text-caption", "text-fg-subtle");
    expect(header.className).not.toContain("border-b");
    expect(card.querySelector("[data-tool-rail]")).toHaveClass("ml-[7px]", "border-l", "border-border");
  });

  it("draws each step 28px with a 44px verb, the full path in mono, and Done in fg-subtle", () => {
    const { card } = openCard([read, edit]);
    const rows = card.querySelectorAll("[data-tool-row]");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveClass("h-7", "gap-2", "pl-3.5", "pr-2", "rounded-md", "text-ui-sm");
    expect(within(rows[0] as HTMLElement).getByText("Read")).toHaveClass("w-11", "shrink-0", "text-fg-muted");
    // The path is one mono span; the text sits in a bdi inside it.
    const readPath = within(rows[0] as HTMLElement).getByText("src/components/sidebar/SessionList.tsx").parentElement;
    expect(readPath).toHaveClass("font-mono", "text-caption", "truncate");
    expect(readPath).not.toHaveClass("text-fg");
    expect(within(rows[0] as HTMLElement).getByText("Done")).toHaveClass("text-caption", "text-fg-subtle");
    // No divider between rows.
    expect(card.querySelector(".h-px")).toBeNull();
  });

  it("keeps the chevron's slot at the end of every step, filled only on one that opens", () => {
    const { card } = openCard([read, ran]);
    const rows = [...card.querySelectorAll("[data-tool-row]")] as HTMLElement[];
    for (const row of rows) {
      expect(row.lastElementChild).toHaveAttribute("data-tool-chevron");
      expect(row.lastElementChild).toHaveClass("w-3", "shrink-0");
    }
    expect(rows[0].lastElementChild?.querySelector("svg")).toBeNull();
    expect(rows[1].lastElementChild?.querySelector("svg")).not.toBeNull();
  });

  it("says New before the counts of an edit that made a file, and nothing for one that changed a file", () => {
    const made = { ...edit, id: "made", details: [{ kind: "diff" as const, path: "src/new.ts", isNewFile: true, rows: [] }] };
    const changed = { ...edit, id: "changed", details: [{ kind: "diff" as const, path: "src/old.ts", isNewFile: false, rows: [] }] };
    const { card } = openCard([made, changed]);
    const rows = [...card.querySelectorAll("[data-tool-row]")] as HTMLElement[];
    const mark = within(rows[0]).getByText("New");
    expect(mark).toHaveClass("shrink-0", "text-caption", "text-fg-subtle");
    expect(mark.nextElementSibling).toHaveClass("font-mono", "tabular-nums");
    expect(within(rows[1]).queryByText("New")).toBeNull();
  });

  it("says Running in words, with a turning arc in the icon's place", () => {
    const { card } = openCard([{ ...edit, status: "running" }], false);
    const word = within(card).getByText("Running");
    expect(word).toHaveClass("shrink-0", "text-caption", "text-status-running");
    const row = word.closest("[data-tool-row]") as HTMLElement;
    expect(row.firstElementChild?.getAttribute("class")).toContain("text-status-running");
    expect(row.firstElementChild?.getAttribute("class")).toContain("animate-spin");
    expect(row.querySelectorAll("svg.text-status-running")).toHaveLength(1);
  });

  it("keeps a step 28px with a very long path, cutting the path and never the status", () => {
    const long = { ...edit, status: "running" as const, locations: [`src/${"deeply/".repeat(25)}File.tsx`] };
    const { card } = openCard([long], false);
    const row = card.querySelector("[data-tool-row]") as HTMLElement;
    expect(row).toHaveClass("h-7");
    // Cut at its start, so the file's name stays in sight; an edit's path is fg.
    expect(within(row).getByText(long.locations[0]).parentElement).toHaveClass("truncate", "min-w-0", "[direction:rtl]", "text-fg");
    expect(within(row).getByText("Running")).toHaveClass("shrink-0");
  });

  it("indents a command's output 36px on the terminal's ground, with no border", () => {
    const { card } = openCard([ran]);
    fireEvent.click(within(card).getByRole("button", { name: /pnpm vitest run session-list/ }));
    const output = within(card).getByText("Test Files 1 passed (1)");
    const panel = output.closest("[data-tool-output]") as HTMLElement;
    expect(panel).toHaveClass("ml-9", "mr-2", "mb-2");
    expect(output).toHaveClass("bg-terminal-bg", "text-terminal-fg", "text-caption", "leading-[17px]", "px-2.5", "py-2");
    expect(panel.querySelector(".border")).toBeNull();
  });
});
