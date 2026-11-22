import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
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
});
