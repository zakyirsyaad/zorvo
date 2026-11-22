import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueuedMessages, type QueuedMessagesProps } from "../components/composer/QueuedMessages";

const base: QueuedMessagesProps = {
  messages: [
    { id: "q1", text: "first **bold**\nsecond line", attachments: [] },
    { id: "q2", text: "with files‮evil", attachments: ["/a.png", "/b.png"] },
  ],
  agentName: "Qwen Code",
  hold: null,
  announcement: "",
  announcementKey: 0,
  onFocusComposer: vi.fn(),
  onSendNow: vi.fn(),
  onEdit: vi.fn(),
  onRemove: vi.fn(),
};

describe("QueuedMessages", () => {
  it("lists the messages oldest first with named controls", () => {
    render(<QueuedMessages {...base} />);
    const rows = within(screen.getByRole("list", { name: "Queued messages" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole("button", { name: /^Send now: first \*\*bold\*\* second line/ })).toBeInTheDocument();
    expect(within(rows[0]!).getByRole("button", { name: /^Edit: first/ })).toBeInTheDocument();
    expect(within(rows[0]!).getByRole("button", { name: /^Remove: first/ })).toBeInTheDocument();
  });

  it("shows text as plain text, escapes hidden characters, clamps two lines and keeps the full text", () => {
    render(<QueuedMessages {...base} />);
    const first = screen.getByText("first **bold** second line");
    expect(first).toHaveAttribute("title", "first **bold**\nsecond line");
    expect(first.className).toContain("line-clamp-2");
    expect(screen.getByText(/with files\\u202Eevil/)).toBeInTheDocument();
    expect(first.querySelector("strong")).toBeNull();
  });

  it("counts attachments", () => {
    render(<QueuedMessages {...base} />);
    expect(screen.getByText("2 attachments")).toBeInTheDocument();
  });

  it("calls back with the message's id", () => {
    const onSendNow = vi.fn();
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    render(<QueuedMessages {...base} onSendNow={onSendNow} onEdit={onEdit} onRemove={onRemove} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Send now/ })[1]!);
    fireEvent.click(screen.getAllByRole("button", { name: /^Edit/ })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: /^Remove/ })[0]!);
    expect(onSendNow).toHaveBeenCalledWith("q2");
    expect(onEdit).toHaveBeenCalledWith("q1");
    expect(onRemove).toHaveBeenCalledWith("q1");
  });

  it("says why a held queue did not send, and keeps a polite status mounted", () => {
    const { rerender } = render(<QueuedMessages {...base} messages={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.queryByRole("list")).toBeNull();
    rerender(<QueuedMessages {...base} hold="failed" announcement="Message queued. It is sent when Qwen Code finishes." />);
    expect(screen.getByText("Not sent: the last turn failed.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Message queued. It is sent when Qwen Code finishes.");
    rerender(<QueuedMessages {...base} hold="ended" />);
    expect(screen.getByText("Not sent: Qwen Code has ended.")).toBeInTheDocument();
  });

  it("says the queue waits for the user's answer", () => {
    render(<QueuedMessages {...base} hold="waiting" />);
    expect(screen.getByText("Waits for your answer in the chat.")).toBeInTheDocument();
  });

  it("gives a repeated announcement a new node, so it is spoken again", () => {
    const { rerender } = render(<QueuedMessages {...base} announcement="Message queued." announcementKey={1} />);
    const before = screen.getByText("Message queued.");
    rerender(<QueuedMessages {...base} announcement="Message queued." announcementKey={2} />);
    expect(screen.getByText("Message queued.")).not.toBe(before);
    expect(screen.getByRole("status")).toHaveTextContent("Message queued.");
  });

  it("disables Send now with the composer's reason when an ended session cannot continue", () => {
    render(<QueuedMessages {...base} sendNowBlockedReason="Qwen Code is not installed." />);
    const buttons = screen.getAllByRole("button", { name: /^Send now/ });
    for (const button of buttons) {
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription(/Qwen Code is not installed\./);
    }
  });
});

describe("QueuedMessages focus and long text", () => {
  afterEach(() => vi.restoreAllMocks());

  function Harness({ onFocusComposer = vi.fn(), initial = base.messages }: { onFocusComposer?: () => void; initial?: typeof base.messages }) {
    const [messages, setMessages] = useState(initial);
    const drop = (id: string) => setMessages((list) => list.filter((m) => m.id !== id));
    return (
      <QueuedMessages
        {...base}
        messages={messages}
        onRemove={drop}
        onSendNow={drop}
        onFocusComposer={onFocusComposer}
      />
    );
  }
  const three = [
    { id: "a", text: "alpha", attachments: [] },
    { id: "b", text: "bravo", attachments: [] },
    { id: "c", text: "charlie", attachments: [] },
  ];

  it("moves focus to the same control of the row that takes its place", () => {
    render(<Harness initial={three} />);
    const remove = screen.getByRole("button", { name: /^Remove: bravo/ });
    remove.focus();
    fireEvent.click(remove);
    expect(screen.getByRole("button", { name: /^Remove: charlie/ })).toHaveFocus();
  });

  it("falls back to the previous row, then to the composer", () => {
    const onFocusComposer = vi.fn();
    render(<Harness initial={three.slice(0, 2)} onFocusComposer={onFocusComposer} />);
    const last = screen.getByRole("button", { name: /^Send now: bravo/ });
    last.focus();
    fireEvent.click(last);
    expect(screen.getByRole("button", { name: /^Send now: alpha/ })).toHaveFocus();
    const only = screen.getByRole("button", { name: /^Remove: alpha/ });
    only.focus();
    fireEvent.click(only);
    expect(onFocusComposer).toHaveBeenCalledTimes(1);
  });

  it("offers Show all only on a clamped row, and unclamps it in place", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.textContent?.startsWith("long") ? 80 : 20;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(40);
    render(<QueuedMessages {...base} messages={[{ id: "l", text: "long text here", attachments: [] }, { id: "s", text: "short", attachments: [] }]} />);
    const toggles = screen.getAllByRole("button", { name: /^Show all/ });
    expect(toggles).toHaveLength(1);
    expect(toggles[0]).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggles[0]!);
    const less = screen.getByRole("button", { name: /^Show less/ });
    expect(less).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("long text here").className).not.toContain("line-clamp-2");
  });
});
