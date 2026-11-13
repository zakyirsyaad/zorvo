import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ActionCard } from "../components/ActionCard";
import {
  ALLOW_ONCE,
  ALLOW_SESSION,
  DENY,
  folderCard,
  settleToolCard,
  toolCard,
  toolCardFor,
  withToolCard,
} from "../lib/agent-tool-card";
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

describe("cards for a session an agent wants to open", () => {
  const base = { cardId: "act-2", sessionId: "s-1", callerName: "pi ACP", folder: "/Users/test/developer/zorvo", now: 100 };
  const session = { kind: "start_session" as const, targetName: "Codex", targetId: "codex-acp", task: "Port the parser.\nKeep the tests." };
  const delegation = { kind: "delegate" as const, targetName: "Qwen Code", targetId: "qwen-code", task: "Review it." };

  it("titles a single session request and shows the brief as text", () => {
    const card = toolCardFor(base, [session]);
    expect(card.title).toBe("pi ACP wants to open a Codex session");
    expect(card.prompt).toBe("Port the parser.\nKeep the tests.");
    expect(card.zorvoTool).toMatchObject({ tool: "start_session", targetId: "codex-acp" });
    expect(card.options?.map((option) => option.optionId)).toEqual([ALLOW_SESSION, DENY]);
  });

  it("keeps the phase 2 title for several delegations and heads mixed tasks by kind", () => {
    expect(toolCardFor(base, [delegation, { ...delegation, targetName: "Codex", targetId: "codex-acp" }]).title).toBe(
      "pi ACP wants to give other agents 2 tasks",
    );
    const mixed = toolCardFor(base, [delegation, { ...session, hasOwnWorktree: true }, session]);
    expect(mixed.title).toBe("pi ACP asks for 3 things");
    expect(mixed.prompt).toBe(
      "For Qwen Code:\n> Review it.\n\nNew Codex session, in its own worktree:\n> Port the parser.\n> Keep the tests.\n\nNew Codex session:\n> Port the parser.\n> Keep the tests.",
    );
  });

  it("says when the session gets a worktree of its own", () => {
    const card = toolCardFor(base, [{ ...session, hasOwnWorktree: true }]);
    expect(card.zorvoTool?.hasOwnWorktree).toBe(true);
    render(<ActionCard card={card} agentName="pi ACP" onChoose={vi.fn()} />);
    expect(screen.getByText("It gets a worktree of its own, on a new branch.")).toBeInTheDocument();
  });

  it("builds the folder card with Allow once and Deny, and says it asks every time", () => {
    const card = folderCard({
      ...base,
      folder: "/Users/test/developer/titan",
      targetName: "Codex",
      targetId: "codex-acp",
      brief: "Port the parser.",
      hasOwnWorktree: false,
    });
    expect(card.title).toBe("pi ACP wants to open a Codex session in another folder");
    expect(card.options).toEqual([
      { optionId: ALLOW_ONCE, name: "Allow once", kind: "allow_once" },
      { optionId: DENY, name: "Deny", kind: "reject_once" },
    ]);
    expect(card.zorvoTool).toMatchObject({ tool: "start_session", isOtherFolder: true, folder: "/Users/test/developer/titan" });

    render(<ActionCard card={card} agentName="pi ACP" onChoose={vi.fn()} />);
    expect(screen.getByText("In /Users/test/developer/titan")).toBeInTheDocument();
    expect(
      screen.getByText("This asks every time: a session in another folder is never allowed in advance."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/without asking again/)).toBeNull();
    expect(screen.getByRole("button", { name: "Allow once" })).toBeInTheDocument();
  });

  it("settles with the card's own allowing option and reads Allowed once", () => {
    const card = folderCard({ ...base, targetName: "Codex", targetId: "codex-acp", brief: "Port it.", hasOwnWorktree: false });
    const messages: ChatMessage[] = [{ id: "m-1", role: "agent", content: "", timestamp: 1, actionCard: card }];
    const approved = settleToolCard(messages, "act-2", "approved")[0].actionCard;
    expect(approved).toMatchObject({ status: "approved", chosenOptionId: ALLOW_ONCE });

    render(<ActionCard card={approved!} agentName="pi ACP" onChoose={vi.fn()} />);
    expect(screen.getByText("Allowed once")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("still renders a delegate card saved before sessions could be opened", () => {
    const saved = JSON.parse(JSON.stringify(toolCard(INPUT)));
    render(<ActionCard card={saved} agentName="pi ACP" onChoose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "pi ACP wants to give Qwen Code a task" })).toBeInTheDocument();
    expect(screen.getByTestId("zorvo-tool-task").textContent).toBe("Review the parser change.");
  });
});
