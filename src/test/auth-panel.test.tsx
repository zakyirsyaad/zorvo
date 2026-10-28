import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

  it("says the refused message is back in the box only when it was put back", () => {
    const { rerender } = render(
      <AuthPanel agentName="Claude Code" methods={[terminal]} status="idle" onSignIn={vi.fn()} onCheckAgain={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(screen.queryByText(/Your message is back in the box below/)).toBeNull();

    rerender(
      <AuthPanel agentName="Claude Code" methods={[terminal]} status="idle" hasReturnedMessage onSignIn={vi.fn()} onCheckAgain={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(
      screen.getByText("Your message is back in the box below. Zorvo sends it again once you are signed in, unless you change it."),
    ).toBeTruthy();
  });
});
