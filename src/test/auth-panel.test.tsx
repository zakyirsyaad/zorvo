import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AuthPanel, type AuthPanelProps } from "../components/AuthPanel";
import type { AuthMethod } from "../lib/acp-auth";

const terminal: AuthMethod = { id: "claude-ai-login", name: "Claude Subscription", kind: "terminal" };
const agent: AuthMethod = { id: "chat-gpt", name: "ChatGPT", kind: "agent" };
const explain: AuthMethod = { id: "api-key", name: "API Key", description: "Use an API key to authenticate", kind: "explain" };

function renderPanel(props: Partial<AuthPanelProps> = {}) {
  const onSignIn = vi.fn();
  render(
    <AuthPanel agentName="Claude Code" methods={[terminal]} status="idle" onSignIn={onSignIn} onCheckAgain={vi.fn()} onDismiss={vi.fn()} {...props} />,
  );
  return { onSignIn };
}

describe("AuthPanel", () => {
  it("offers a button for a terminal method that signs in with its id", () => {
    const { onSignIn } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Sign in with Claude Subscription" }));

    expect(onSignIn).toHaveBeenCalledWith("claude-ai-login");
  });

  it("only explains a method that needs an API key", () => {
    renderPanel({ methods: [explain] });

    expect(screen.queryByRole("button", { name: /Sign in with API Key/ })).toBeNull();
    expect(screen.getByText("Use an API key to authenticate")).toBeTruthy();
  });

  it("points to the command line tool when the agent listed no method", () => {
    renderPanel({ methods: [] });

    expect(screen.getByText("Sign in with Claude Code's own command line tool, then check again.")).toBeTruthy();
  });

  it("does not tell an agent whose only method is a key to sign in", () => {
    renderPanel({ methods: [explain] });

    expect(screen.queryByText(/needs you to sign in/)).toBeNull();
    expect(screen.getByText("Claude Code needs an API key or another account setting before it can start.")).toBeTruthy();
  });

  it("uses a method's name whole as its button when it starts with a verb", () => {
    renderPanel({ methods: [{ id: "oauth-personal", name: "Log in with Google", kind: "agent" }] });

    expect(screen.getByRole("button", { name: "Log in with Google" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Sign in with Log in/ })).toBeNull();
  });

  it("hides the command line hint when a method has a button", () => {
    renderPanel({ methods: [explain, terminal] });

    expect(screen.queryByText(/own command line tool/)).toBeNull();
  });

  it("disables every sign-in button while signing in", () => {
    renderPanel({ methods: [agent, terminal], status: "signing-in" });

    const buttons = screen.getAllByRole("button", { name: /^Sign in with/ });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps one live region mounted and puts each progress line and result in it", () => {
    const { rerender } = render(
      <AuthPanel agentName="Claude Code" methods={[terminal]} status="idle" onSignIn={vi.fn()} onCheckAgain={vi.fn()} onDismiss={vi.fn()} />,
    );
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();

    const props = { agentName: "Claude Code", methods: [terminal], onSignIn: vi.fn(), onCheckAgain: vi.fn(), onDismiss: vi.fn() };
    const lines: [AuthPanelProps["status"], string | undefined, string][] = [
      ["signing-in", undefined, "Finish signing in in the window that opened…"],
      ["checking", undefined, "Checking whether you are signed in…"],
      ["failed", "Claude Code still says you are signed out", "Sign-in failed: Claude Code still says you are signed out"],
      ["signed-in", undefined, "Signed in to Claude Code. Send your message again."],
    ];
    for (const [status, error, text] of lines) {
      rerender(<AuthPanel {...props} status={status} error={error} />);
      // The same element throughout: a region that is replaced is not announced.
      expect(screen.getByRole("status")).toBe(region);
      expect(region).toHaveTextContent(text);
    }
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("replaces a failure reason that is long or has a path with a plain sentence", () => {
    for (const error of ["spawn /Users/test/.npm/_npx/x/bin/claude ENOENT", "x".repeat(200), "line one\nline two", undefined]) {
      const { unmount } = render(
        <AuthPanel agentName="Claude Code" methods={[terminal]} status="failed" error={error} onSignIn={vi.fn()} onCheckAgain={vi.fn()} onDismiss={vi.fn()} />,
      );
      expect(screen.getByRole("status")).toHaveTextContent("Sign-in failed: Zorvo could not finish the sign-in. Try again.");
      expect(screen.queryByText(/ENOENT|xxxx/)).toBeNull();
      unmount();
    }
  });

  it("says in the status line that the returned message is sent again, only while idle", () => {
    const props = { agentName: "Claude Code", methods: [terminal], onSignIn: vi.fn(), onCheckAgain: vi.fn(), onDismiss: vi.fn() };
    const { rerender } = render(<AuthPanel {...props} status="idle" />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    rerender(<AuthPanel {...props} status="idle" hasReturnedMessage />);
    expect(screen.getByRole("status")).toHaveTextContent("Your message will be sent again after you sign in");

    rerender(<AuthPanel {...props} status="checking" hasReturnedMessage />);
    expect(screen.getByRole("status")).toHaveTextContent("Checking whether you are signed in…");

    rerender(<AuthPanel {...props} status="failed" error="Claude Code still says you are signed out" hasReturnedMessage />);
    expect(screen.getByRole("status")).toHaveTextContent("Sign-in failed: Claude Code still says you are signed out");
  });

  it("is a card named for the agent that lists every method", () => {
    renderPanel({ agentName: "Gemini CLI", methods: [agent, terminal, explain] });

    const card = within(screen.getByRole("region", { name: "Sign in to Gemini CLI" }));
    expect(card.getByRole("heading", { level: 2, name: "Sign in to Gemini CLI" })).toBeInTheDocument();
    expect(card.getAllByRole("listitem")).toHaveLength(3);
    expect(card.getByRole("button", { name: "Sign in with ChatGPT" })).toBeInTheDocument();
    expect(card.getByRole("button", { name: "Sign in with Claude Subscription" })).toBeInTheDocument();
  });

  it("shows a method Zorvo cannot run as its name, In your shell and its description, with no button or field", () => {
    renderPanel({ methods: [agent, explain] });

    const item = screen.getAllByRole("listitem").find((li) => li.textContent?.includes("API Key"))!;
    expect(item).toHaveTextContent("API Key");
    expect(item).toHaveTextContent("In your shell");
    expect(item).toHaveTextContent("Use an API key to authenticate");
    expect(within(item).queryByRole("button")).toBeNull();
    expect(within(item).queryByRole("textbox")).toBeNull();
  });

  it("puts the status line, Dismiss and Check again in the card's footer", () => {
    const onDismiss = vi.fn();
    const onCheckAgain = vi.fn();
    renderPanel({ onDismiss, onCheckAgain });

    const footer = screen.getByRole("status").closest<HTMLElement>(".border-t");
    expect(footer).not.toBeNull();
    fireEvent.click(within(footer!).getByRole("button", { name: "Dismiss sign-in" }));
    fireEvent.click(within(footer!).getByRole("button", { name: "Check again" }));

    expect(onDismiss).toHaveBeenCalled();
    expect(onCheckAgain).toHaveBeenCalled();
  });

  describe("an agent whose only way in is its own setup", () => {
    const setup: AuthMethod = { id: "openai", name: "Use OpenAI API key", kind: "setup" };

    it("is the setup card: Set up <Agent>, why, and Open setup in terminal", () => {
      const { onSignIn } = renderPanel({ agentName: "Qwen Code", methods: [setup] });

      const card = within(screen.getByRole("region", { name: "Set up Qwen Code" }));
      expect(card.getByRole("heading", { level: 2, name: "Set up Qwen Code" })).toBeInTheDocument();
      expect(card.getByText(/^Qwen Code connects to a provider you pick in its own setup/)).toBeInTheDocument();
      fireEvent.click(card.getByRole("button", { name: "Open setup in terminal" }));
      expect(onSignIn).toHaveBeenCalledWith("openai");
    });

    it("keeps Check again and Dismiss in the footer, with no field or sign-in button", () => {
      renderPanel({ agentName: "Qwen Code", methods: [setup] });

      const footer = screen.getByRole("status").closest<HTMLElement>(".border-t")!;
      expect(within(footer).getByRole("button", { name: "Check again" })).toBeInTheDocument();
      expect(within(footer).getByRole("button", { name: "Dismiss sign-in" })).toBeInTheDocument();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.queryByRole("button", { name: /^Sign in with/ })).toBeNull();
    });

    it("keeps one status line across idle, signing-in and checking", () => {
      const props = { agentName: "Qwen Code", methods: [setup], onSignIn: vi.fn(), onCheckAgain: vi.fn(), onDismiss: vi.fn() };
      const { rerender } = render(<AuthPanel {...props} status="idle" />);
      const region = screen.getByRole("status");

      rerender(<AuthPanel {...props} status="signing-in" />);
      expect(screen.getByRole("status")).toBe(region);
      rerender(<AuthPanel {...props} status="checking" />);
      expect(screen.getByRole("status")).toBe(region);
      expect(region).toHaveTextContent("Checking whether you are signed in…");
    });

    it("among other methods, is a row of the sign-in card with Open setup in terminal", () => {
      renderPanel({ agentName: "Qwen Code", methods: [setup, agent], status: "signing-in" });

      expect(screen.getByRole("region", { name: "Sign in to Qwen Code" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open setup in terminal" })).toBeDisabled();
    });
  });

  it("with only keys, leads with the keys sentence and offers only Dismiss and Check again", () => {
    renderPanel({ methods: [explain] });

    expect(screen.getByText("Claude Code needs an API key or another account setting before it can start.")).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual([
      "Dismiss sign-in",
      "Check again",
    ]);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  describe("as drawn", () => {
    const setup: AuthMethod = { id: "openai", name: "Use OpenAI API key", kind: "setup" };

    it("leads by asking how the agent signs in", () => {
      renderPanel();

      expect(screen.getByText("Pick how Claude Code signs in. It uses its own tool; Zorvo never sees your password or key.")).toBeInTheDocument();
    });

    it("methods are a bordered list with outline buttons", () => {
      renderPanel({ methods: [terminal, explain] });

      expect(screen.getByRole("list", { name: "Sign-in methods" })).toHaveClass("divide-y", "rounded-lg", "border");
      const button = screen.getByRole("button", { name: "Sign in with Claude Subscription" });
      expect(button.className).toContain("border-border-strong");
      expect(button.querySelector("svg")).toBeNull();
    });

    it("In your shell sits at the row's end", () => {
      renderPanel({ methods: [terminal, explain] });

      const item = screen.getAllByRole("listitem").find((li) => li.textContent?.includes("API Key"))!;
      expect(item.lastElementChild).toHaveTextContent("In your shell");
      expect(item.lastElementChild).toHaveClass("shrink-0");
    });

    it("the waiting line has an attention dot and ends with a period", () => {
      renderPanel({ hasReturnedMessage: true });

      const status = screen.getByRole("status");
      expect(status).toHaveTextContent(/^Your message will be sent again after you sign in\.$/);
      expect(status.querySelector(".bg-status-attention")).not.toBeNull();
    });

    it("the setup card opens the setup from its body", () => {
      renderPanel({ agentName: "Qwen Code", methods: [setup] });

      expect(
        screen.getByText("Qwen Code connects to a provider you pick in its own setup, and keeps the choice and the key in its settings."),
      ).toBeInTheDocument();
      const open = screen.getByRole("button", { name: "Open setup in terminal" });
      expect(open.className).toContain("border-border-strong");
      expect(open.closest(".border-t")).toBeNull();
      expect(open.parentElement).toHaveTextContent("Already set up in Qwen Code? Check again.");
      expect(screen.queryByText("Already set up?")).toBeNull();
    });

    it("a setup method in the sign-in list keeps its own label", () => {
      renderPanel({ agentName: "Qwen Code", methods: [setup, agent] });

      expect(screen.getByRole("region", { name: "Sign in to Qwen Code" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open setup in terminal" }).className).toContain("border-border-strong");
    });
  });

  describe("review fixes", () => {
    const setup: AuthMethod = { id: "openai", name: "Use OpenAI API key", kind: "setup" };

    it("an outline method button's label is in fg", () => {
      renderPanel();
      expect(screen.getByRole("button", { name: "Sign in with Claude Subscription" }).querySelector(".text-fg")).not.toBeNull();
    });

    it("an agent that lists no method is not asked to pick one", () => {
      renderPanel({ methods: [] });
      expect(screen.queryByText(/^Pick how/)).toBeNull();
      expect(screen.getByText("Claude Code needs you to sign in before it can start.")).toBeInTheDocument();
    });

    it("an idle setup card claims nothing about a check", () => {
      renderPanel({ agentName: "Qwen Code", methods: [setup] });
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
    });
  });
});
