import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ActionCard } from "../components/ActionCard";
import { ALLOW_SESSION, DENY, settleToolCard, toolCard, withToolCard } from "../lib/agent-tool-card";
import { normalizeTranscript } from "../lib/persistence";
import { settlePermissionCards } from "../lib/acp-events";
import type { ChatMessage } from "../types";

const INPUT = {
  cardId: "act-1",
  sessionId: "s-1",
  callerName: "pi ACP",
  targetName: "Qwen Code",
  targetId: "qwen-code",
  folder: "/Users/test/developer/zorvo",
  task: "Review the parser change.",
  now: 100,
};

const ctx = { sessionId: "s-1", now: 100, createId: (prefix: string) => `${prefix}-new` };

describe("toolCard", () => {
  it("builds the card with the exact title and the two buttons", () => {
    const card = toolCard(INPUT);
    expect(card).toMatchObject({
      id: "act-1",
      sessionId: "s-1",
      title: "pi ACP wants to give Qwen Code a task",
      prompt: "Review the parser change.",
      status: "pending",
      timestamp: 100,
      zorvoTool: {
        tool: "delegate",
        callerName: "pi ACP",
        targetName: "Qwen Code",
        targetId: "qwen-code",
        folder: "/Users/test/developer/zorvo",
      },
    });
    expect(card.options).toEqual([
      { optionId: ALLOW_SESSION, name: "Allow for this session", kind: "allow_always" },
      { optionId: DENY, name: "Deny", kind: "reject_once" },
    ]);
    expect(card.requestId).toBeUndefined();
  });

  it("keeps line breaks and makes every other invisible character visible", () => {
    const card = toolCard({ ...INPUT, task: "one\u202Etwo\r\nthree\u0007" });
    expect(card.prompt).toBe("one\\u202Etwo\nthree\\u0007");
  });
});

describe("withToolCard and settleToolCard", () => {
  const user: ChatMessage = { id: "m-1", role: "user", content: "ask Qwen", timestamp: 1 };
  const openReply: ChatMessage = { id: "m-2", role: "agent", content: "On it", timestamp: 2 };

  it("places the card on the open reply, else on a new agent message", () => {
    const onReply = withToolCard([user, openReply], toolCard(INPUT), ctx);
    expect(onReply).toHaveLength(2);
    expect(onReply[1].actionCard?.id).toBe("act-1");

    const closed: ChatMessage = { ...openReply, isComplete: true };
    const onNew = withToolCard([user, closed], toolCard(INPUT), ctx);
    expect(onNew).toHaveLength(3);
    expect(onNew[2]).toMatchObject({ role: "agent", actionCard: { id: "act-1" } });
  });

  it("settles the card as approved, rejected or withdrawn", () => {
    const messages = withToolCard([user, openReply], toolCard(INPUT), ctx);
    expect(settleToolCard(messages, "act-1", "approved")[1].actionCard).toMatchObject({
      status: "approved",
      chosenOptionId: ALLOW_SESSION,
    });
    expect(settleToolCard(messages, "act-1", "rejected")[1].actionCard).toMatchObject({
      status: "rejected",
      chosenOptionId: DENY,
    });
    const withdrawn = settleToolCard(messages, "act-1", "withdrawn")[1].actionCard;
    expect(withdrawn?.status).toBe("rejected");
    expect(withdrawn?.chosenOptionId).toBeUndefined();
    // Another card's id changes nothing.
    expect(settleToolCard(messages, "act-9", "approved")).toEqual(messages);
  });

  it("is not pending after the transcript is loaded again", () => {
    const saved = JSON.parse(JSON.stringify(withToolCard([user, openReply], toolCard(INPUT), ctx)));
    const loaded = settlePermissionCards(normalizeTranscript(saved));
    expect(loaded[1].actionCard?.status).toBe("rejected");
    expect(loaded[1].actionCard?.chosenOptionId).toBeUndefined();
    expect(loaded[1].actionCard?.zorvoTool?.targetName).toBe("Qwen Code");
  });
});

describe("the card in the chat", () => {
  it("shows the title, the folder, the task as plain text and the session-wide line", () => {
    const task = "# Heading\n`code` [link](https://example.com)\nsecond line";
    render(<ActionCard card={toolCard({ ...INPUT, task })} agentName="pi ACP" onChoose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "pi ACP wants to give Qwen Code a task" })).toBeInTheDocument();
    expect(screen.getByText("In /Users/test/developer/zorvo")).toBeInTheDocument();
    const shown = screen.getByTestId("zorvo-tool-task");
    expect(shown.textContent).toBe(task);
    expect(shown.querySelector("a, h1, code")).toBeNull();
    expect(
      screen.getByText(
        "After you allow it, pi ACP can give tasks to other agents in this session without asking again.",
      ),
    ).toBeInTheDocument();
  });

  it("answers with the two buttons", () => {
    const onChoose = vi.fn();
    render(<ActionCard card={toolCard(INPUT)} agentName="pi ACP" onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("button", { name: "Allow for this session" }));
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(onChoose.mock.calls.map(([optionId]) => optionId)).toEqual([ALLOW_SESSION, DENY]);
  });

  it("reads what happened once settled, with no buttons", () => {
    const base = toolCard(INPUT);
    const cases: Array<[Partial<typeof base>, string]> = [
      [{ status: "approved", chosenOptionId: ALLOW_SESSION }, "Allowed for this session"],
      [{ status: "rejected", chosenOptionId: DENY }, "Denied"],
      [{ status: "rejected", chosenOptionId: undefined }, "Not answered"],
    ];
    for (const [patch, words] of cases) {
      const { unmount } = render(<ActionCard card={{ ...base, ...patch }} agentName="pi ACP" onChoose={vi.fn()} />);
      expect(screen.getByText(words)).toBeInTheDocument();
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByText(/without asking again/)).toBeNull();
      unmount();
    }
  });

  it("falls back to a plain card when the saved mark is malformed", () => {
    const card = { ...toolCard(INPUT), zorvoTool: { tool: "delegate", folder: 3 } as never };
    render(<ActionCard card={card} agentName="pi ACP" onChoose={vi.fn()} />);
    expect(screen.queryByTestId("zorvo-tool-task")).toBeNull();
  });
});
