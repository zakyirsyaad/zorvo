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

describe("the tool card, as drawn", () => {
  it("is a surface-2 card with a 34px header naming the last touched file in mono", () => {
    render(<ToolsPart tools={[read, edit]} isCurrentTurn={false} isTurnOver />);
    const header = screen.getAllByRole("button")[0];
    const card = header.parentElement as HTMLElement;
    expect(card).toHaveClass("rounded-lg", "border-border", "bg-surface-2", "overflow-hidden");
    expect(header).toHaveClass("h-[34px]", "text-ui-sm", "text-fg-secondary");
    expect(header.className).not.toContain("border-b");
    expect(within(header).getByText("sidebar/SessionRow.tsx +1")).toHaveClass("font-mono", "text-caption", "text-fg-subtle");
  });

  it("says how many still run instead, in fg-subtle, and draws the header's bottom edge only while open", () => {
    const running = { ...edit, status: "running" as const };
    const { header } = openCard([read, running], false);
    expect(within(header).getByText("1 still running")).toHaveClass("text-caption", "text-fg-subtle");
    expect(header).toHaveClass("border-b", "border-border");
  });

  it("draws each row 30px with a 56px verb, the full path in mono, and Done in fg-subtle", () => {
    const { card } = openCard([read, edit]);
    const rows = card.querySelectorAll("[data-tool-row]");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveClass("h-7.5", "gap-2", "px-3", "text-ui-sm");
    expect(within(rows[0] as HTMLElement).getByText("Read")).toHaveClass("w-14", "shrink-0", "text-fg-muted");
    // The path is one mono span; the text sits in a bdi inside it.
    expect(within(rows[0] as HTMLElement).getByText("src/components/sidebar/SessionList.tsx").parentElement).toHaveClass(
      "font-mono",
      "text-caption",
      "truncate",
    );
    expect(within(rows[0] as HTMLElement).getByText("Done")).toHaveClass("text-caption", "text-fg-subtle");
    // No divider between rows.
    expect(card.querySelector(".h-px")).toBeNull();
  });

  it("says Running in words beside a turning arc", () => {
    const { card } = openCard([{ ...edit, status: "running" }], false);
    const word = within(card).getByText("Running");
    expect(word).toHaveClass("text-caption", "text-status-running");
    expect(word.parentElement?.querySelector("svg")?.getAttribute("class")).toContain("text-status-running");
  });

  it("keeps a row 30px with a very long path, cutting the path and never the status", () => {
    const long = { ...edit, status: "running" as const, locations: [`src/${"deeply/".repeat(25)}File.tsx`] };
    const { card } = openCard([long], false);
    const row = card.querySelector("[data-tool-row]") as HTMLElement;
    expect(row).toHaveClass("h-7.5");
    // Cut at its start, so the file's name stays in sight.
    expect(within(row).getByText(long.locations[0]).parentElement).toHaveClass("truncate", "min-w-0", "[direction:rtl]");
    expect(within(row).getByText("Running").parentElement).toHaveClass("shrink-0");
  });

  it("indents a command's output 76px on the terminal's ground, with no border", () => {
    const { card } = openCard([ran]);
    fireEvent.click(within(card).getByRole("button", { name: /pnpm vitest run session-list/ }));
    const output = within(card).getByText("Test Files 1 passed (1)");
    const panel = output.closest("[data-tool-output]") as HTMLElement;
    expect(panel).toHaveClass("ml-[76px]", "mr-3", "mb-2");
    expect(output).toHaveClass("bg-terminal-bg", "text-terminal-fg", "text-caption", "leading-[17px]", "px-2.5", "py-2");
    // No edge around the output (the card's own edge is further out).
    expect(panel.querySelector(".border")).toBeNull();
  });
});
