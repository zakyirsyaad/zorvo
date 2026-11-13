import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { applyPermissionRequest } from "../lib/acp-events";
import { ActionCard } from "../components/ActionCard";
import { ElicitationCard } from "../components/chat/ElicitationCard";
import type { ActionCard as ActionCardType, ElicitationCard as ElicitationCardData } from "../types";

let next = 0;
const ctx = () => ({ sessionId: "s-1", now: 1, createId: (prefix: string) => `${prefix}-${++next}` });

const options = [
  { optionId: "allow", name: "Allow once", kind: "allow_once" as const },
  { optionId: "always", name: "Always allow", kind: "allow_always" as const },
  { optionId: "deny", name: "Deny", kind: "reject_once" as const },
];

const editCard: ActionCardType = {
  id: "c-1",
  sessionId: "s-1",
  title: "Permission requested",
  prompt: "Edit 2 files",
  status: "pending",
  timestamp: 1,
  requestId: 1,
  options,
  edits: [
    { path: "src/components/sidebar/SessionRow.tsx", added: 14, removed: 0 },
    { path: "src/lib/session-status.ts", added: 0, removed: 5 },
  ],
};

describe("a permission request's edits", () => {
  it("lists each diffed file with its counts", () => {
    const request = {
      requestId: "p-1",
      toolCall: {
        title: "Edit 2 files",
        kind: "edit",
        content: [
          { type: "diff", path: "a.ts", oldText: "one\n", newText: "one\ntwo\n" },
          { type: "diff", path: "b.ts", oldText: "x\ny\n", newText: "x\n" },
        ],
      },
      options,
    };
    const card = applyPermissionRequest([], request, ctx())[0].actionCard!;
    expect(card.edits).toEqual([
      { path: "a.ts", added: 1, removed: 0 },
      { path: "b.ts", added: 0, removed: 1 },
    ]);
  });

  it("has no edits when the request carries no diff", () => {
    const request = { requestId: "p-2", toolCall: { title: "Run ls", kind: "execute", rawInput: { command: "ls" } }, options };
    const card = applyPermissionRequest([], request, ctx())[0].actionCard!;
    expect("edits" in card).toBe(false);
  });
});

describe("the permission card, as drawn", () => {
  it("is an attention card with a 600 title, the files it edits, and right-aligned plain buttons", () => {
    render(<ActionCard card={editCard} agentName="Claude Code" onChoose={vi.fn()} />);
    const card = screen.getByTestId("action-card-c-1");
    expect(card).toHaveClass("flex", "flex-col", "gap-3", "px-4", "py-3.5", "rounded-xl", "border-attention-border", "bg-attention-surface");
    expect(screen.getByRole("heading")).toHaveClass("text-ui", "font-semibold", "text-fg");

    const files = within(card).getByRole("list", { name: "Files to edit" });
    expect(files).toHaveClass("rounded-md", "border-border", "bg-ground");
    const [first, second] = within(files).getAllByRole("listitem");
    // The path text sits in a bdi inside the mono span that cuts it at its start.
    expect(within(first).getByText("src/components/sidebar/SessionRow.tsx").parentElement).toHaveClass(
      "font-mono",
      "text-ui-sm",
      "text-fg-secondary",
    );
    expect(within(first).getByText("+14")).toHaveClass("font-mono", "text-caption", "text-status-running");
    // Only what changed: no "−0" beside +14, no "+0" beside −5.
    expect(within(first).queryByText(/−0/)).toBeNull();
    expect(within(second).getByText("−5")).toHaveClass("font-mono", "text-caption", "text-danger");
    expect(within(second).queryByText("+0")).toBeNull();

    const buttons = within(card).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Deny", "Always allow", "Allow once"]);
    for (const button of buttons) {
      expect(button).toHaveClass("h-7");
      expect(button.querySelector("svg")).toBeNull();
    }
    const row = buttons[0].parentElement as HTMLElement;
    expect(row).toHaveClass("justify-end");
    expect(row.className).not.toContain("border-t");
  });

  it("says Waiting for you beside the title only while the request is open, and Deny reads in fg-secondary", () => {
    const { rerender } = render(<ActionCard card={editCard} agentName="Claude Code" onChoose={vi.fn()} />);
    const waiting = screen.getByText("Waiting for you");
    expect(waiting).toHaveClass("shrink-0", "text-caption", "text-fg-muted");
    expect(waiting.parentElement).toBe(screen.getByRole("heading").parentElement);
    expect(waiting.parentElement?.querySelector("svg")?.getAttribute("class")).toContain("size-3.5");
    expect(screen.getByRole("button", { name: "Deny" })).toHaveClass("text-fg-secondary");

    rerender(<ActionCard card={{ ...editCard, status: "approved" }} agentName="Claude Code" onChoose={vi.fn()} />);
    expect(screen.queryByText("Waiting for you")).toBeNull();
  });

  it("lists no files when the request has none", () => {
    render(<ActionCard card={{ ...editCard, edits: undefined, prompt: "Run ls" }} agentName="Claude Code" onChoose={vi.fn()} />);
    expect(screen.queryByRole("list", { name: "Files to edit" })).toBeNull();
  });
});

describe("the question card, as drawn", () => {
  const form: ElicitationCardData = {
    key: "e-1",
    sessionId: "s-1",
    mode: "form",
    message: "It will open the pull request with these settings.",
    status: "pending",
    timestamp: 1,
    fields: [{ name: "branch", title: "Target branch", required: true, kind: { type: "text" } }],
  };

  it("leads with the agent's logo and says it needs a few details, with plain fields and right-aligned answers", () => {
    render(<ElicitationCard card={form} agentName="Codex" agentProfileId="codex-acp" onAnswer={vi.fn()} />);
    const card = screen.getByTestId("elicitation-card-e-1");
    expect(card).toHaveClass("flex", "flex-col", "gap-3.5", "p-4", "rounded-xl", "border-border-strong", "bg-surface-2");
    const heading = screen.getByRole("heading", { name: "Codex needs a few details" });
    expect(heading).toHaveClass("text-ui", "font-semibold", "text-fg");
    expect(heading.parentElement?.querySelector("img, svg, [aria-hidden='true']")).not.toBeNull();
    expect(heading.previousElementSibling).toHaveClass("size-[22px]", "bg-chip");
    expect(within(card).getByText(form.message)).toHaveClass("text-ui", "text-fg-muted");

    expect(within(card).getByText("Target branch").closest("label")).toHaveClass("text-ui", "font-medium", "text-fg-secondary");
    expect(within(card).getByRole("textbox")).toHaveClass("h-8", "rounded-lg", "border-border-strong", "bg-ground", "px-2.5");

    const decline = within(card).getByRole("button", { name: "Decline" });
    const submit = within(card).getByRole("button", { name: "Submit" });
    expect(decline.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(submit.parentElement).toHaveClass("justify-end");
    expect(within(card).getByRole("button", { name: "Dismiss" })).toHaveClass("h-6", "w-6");
  });
});
