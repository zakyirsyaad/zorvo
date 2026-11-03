import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChatCanvas, type ChatMessage } from "../components/ChatCanvas";
import { fakeTauriInvoke, type FakeTauriStore } from "./setup";
import { fakeProfiles, makeProfile } from "./fixtures/agents";
import type { Session, Settings } from "../types";
import App from "../App";

const reply = (id: string, content: string): ChatMessage => ({ id, role: "agent", content, timestamp: 1 });

/** Selects `text` inside the first element whose own text contains it, as a drag would, and lets go. */
function select(text: string, within: HTMLElement = document.body) {
  const walker = document.createTreeWalker(within, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node && !node.textContent?.includes(text)) node = walker.nextNode();
  if (!node) throw new Error(`No text node holds "${text}"`);
  const start = node.textContent!.indexOf(text);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + text.length);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent.mouseUp(node.parentElement!);
}

const replyButton = () => screen.queryByRole("button", { name: "Reply" });

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

describe("Selecting text in the chat", () => {
  it("offers Reply for text selected in a reply, and quotes it", () => {
    const onReply = vi.fn();
    render(<ChatCanvas conversationId="s-1" messages={[reply("m-1", "Hello there world")]} onReply={onReply} />);

    select("there");
    fireEvent.click(replyButton()!);

    expect(onReply).toHaveBeenCalledWith("> there\n\n");
    expect(replyButton()).toBeNull();
  });

  it("quotes a selection inside a code block as code", () => {
    const onReply = vi.fn();
    render(<ChatCanvas conversationId="s-1" messages={[reply("m-1", "```js\nconst a = 1;\n```")]} onReply={onReply} />);

    select("const a = 1;");
    fireEvent.click(replyButton()!);

    expect(onReply).toHaveBeenCalledWith("> ```\n> const a = 1;\n> ```\n\n");
  });

  it("offers nothing for a selection outside a message's text", () => {
    render(<ChatCanvas conversationId="s-1" messages={[reply("m-1", "Hello there")]} agentName="Qwen Code" onReply={vi.fn()} />);

    select("Qwen Code");

    expect(replyButton()).toBeNull();
  });

  it("offers nothing where there is no message box to reply in", () => {
    render(<ChatCanvas conversationId="s-1" messages={[reply("m-1", "Hello there")]} />);

    select("there");

    expect(replyButton()).toBeNull();
  });

  it("says why Reply is unavailable, and does nothing", () => {
    const onReply = vi.fn();
    render(
      <ChatCanvas
        conversationId="s-1"
        messages={[reply("m-1", "Hello there")]}
        onReply={onReply}
        replyBlockedReason="The message box is not available right now."
      />,
    );

    select("there");

    expect(replyButton()).toBeDisabled();
    expect(replyButton()).toHaveAccessibleDescription("The message box is not available right now.");
    fireEvent.click(replyButton()!);
    expect(onReply).not.toHaveBeenCalled();
  });

  it("keeps the selection when the toolbar is pressed", () => {
    render(<ChatCanvas conversationId="s-1" messages={[reply("m-1", "Hello there")]} onReply={vi.fn()} />);

    select("there");

    expect(fireEvent.mouseDown(replyButton()!)).toBe(false);
  });

  it("closes on Escape and leaves the selection", () => {
    render(<ChatCanvas conversationId="s-1" messages={[reply("m-1", "Hello there")]} onReply={vi.fn()} />);
    select("there");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(replyButton()).toBeNull();
    expect(window.getSelection()!.toString()).toBe("there");
  });

  it("closes when the selection goes away", () => {
    render(<ChatCanvas conversationId="s-1" messages={[reply("m-1", "Hello there")]} onReply={vi.fn()} />);
    select("there");

    act(() => {
      window.getSelection()!.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
    });

    expect(replyButton()).toBeNull();
  });

  it("stays with the selection while the chat scrolls, as it does when new output follows the bottom", () => {
    render(<ChatCanvas conversationId="s-1" messages={[reply("m-1", "Hello there")]} onReply={vi.fn()} />);
    select("there");

    fireEvent.scroll(screen.getByTestId("chat-canvas-container"));

    expect(replyButton()).not.toBeNull();
  });

  it("closes on a scroll once the selection is gone", () => {
    render(<ChatCanvas conversationId="s-1" messages={[reply("m-1", "Hello there")]} onReply={vi.fn()} />);
    select("there");
    window.getSelection()!.removeAllRanges();

    fireEvent.scroll(screen.getByTestId("chat-canvas-container"));

    expect(replyButton()).toBeNull();
  });

  it("lets a message's text be selected, but not its buttons", () => {
    render(<ChatCanvas conversationId="s-1" messages={[reply("m-1", "```js\nconst a = 1;\n```")]} />);

    const text = screen.getByText("const a = 1;").closest("[data-selectable-text]");
    expect(text).toHaveClass("select-text");
    expect(screen.getByRole("button", { name: "Copy code" }).parentElement).toHaveClass("select-none");
  });
});

const fakeStore = () => (window as unknown as { __FAKE_TAURI_STORE__: FakeTauriStore }).__FAKE_TAURI_STORE__;
type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const tauriInternals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

const savedSession = (profileId: string): Session => ({
  id: "s-1",
  name: "Earlier chat",
  profileId,
  cwd: "/Users/test/developer/zorvo",
  status: "terminated",
  createdAt: 1,
  transport: "acp",
});

async function openSaved(profileId: string) {
  fakeStore().state.sessions = [savedSession(profileId)];
  fakeStore().transcripts["s-1"] = [{ id: "m-1", role: "agent", content: "Earlier answer here", timestamp: 1 }];
  await act(async () => {
    render(<App />);
  });
  await waitFor(() => expect(screen.getAllByText("Earlier chat").length).toBeGreaterThan(0));
  await act(async () => {
    fireEvent.click(screen.getAllByText("Earlier chat")[0]);
  });
  await screen.findByText("Earlier answer here");
}

describe("Reply in the app", () => {
  it("adds the quote after what is typed in the message box", async () => {
    await openSaved("claude-acp");
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "My draft" } });

    select("answer", screen.getByTestId("chat-canvas-container"));
    await act(async () => {
      fireEvent.click(replyButton()!);
    });

    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue("My draft\n\n> answer\n\n");
  });

  it("cannot reply on a removed agent's session, whose message box is hidden", async () => {
    const gemini = makeProfile({ id: "gemini", name: "Gemini CLI", source: "registry", detected: true, availability: "ready" });
    const settings = fakeStore().state.settings as Partial<Settings>;
    settings.enabledAgents = ["claude-acp"];
    settings.removedAgents = ["gemini"];
    vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) =>
      cmd === "get_agent_profiles" ? Promise.resolve([...structuredClone(fakeProfiles), structuredClone(gemini)]) : fakeTauriInvoke(cmd, args),
    );
    await openSaved("gemini");

    select("answer", screen.getByTestId("chat-canvas-container"));

    expect(replyButton()).toHaveAccessibleDescription("There is no message box for this session.");
  });
});
