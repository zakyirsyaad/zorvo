import "@testing-library/jest-dom/vitest";
import { createRef } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { GithubSection, type GithubSectionProps } from "../components/settings/GithubSection";
import type { GithubStatus } from "../lib/github";

function renderSection(status: GithubStatus | null, overrides: Partial<GithubSectionProps> = {}) {
  const props: GithubSectionProps = {
    status,
    isChecking: false,
    onCheck: vi.fn(),
    onConnect: vi.fn(),
    onOpenUrl: vi.fn(),
    ...overrides,
  };
  const view = render(<GithubSection {...props} />);
  return { ...props, ...view };
}

/** What a screen reader hears: the section's one live region. */
const announcement = () => screen.getAllByRole("status", { hidden: true })[0];
const group = () => screen.getByRole("region", { name: "Connection" });

afterEach(() => vi.restoreAllMocks());

describe("GithubSection", () => {
  it("has the canvas's title and sentence, 16px above the group", () => {
    renderSection({ state: "signed-out" });
    const title = screen.getByRole("heading", { level: 1, name: "GitHub" });
    expect(title.parentElement).toHaveTextContent("Optional. Zorvo reads pull requests through your own gh and keeps no token.");
    expect(screen.getByText("gh", { selector: "code" })).toHaveClass("font-mono", "text-ui-sm");
    expect(title.parentElement?.parentElement).toHaveClass("flex", "flex-col", "gap-4");
  });

  it("the group is labelled Connection and its row is tight", () => {
    renderSection({ state: "signed-out" });
    expect(group().querySelector("[data-settings-row]")).toHaveClass("gap-3");
  });

  it("says it is checking until the first answer", () => {
    renderSection(null);
    expect(within(group()).getByText("Checking your GitHub connection…")).toHaveClass("text-fg-subtle");
    expect(announcement()).toHaveTextContent("Checking your GitHub connection.");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("takes focus when asked to, so Settings can give it back after a sign-in", () => {
    const ref = createRef<HTMLDivElement>();
    renderSection({ state: "signed-in", login: "octocat" }, { ref });
    ref.current?.focus();
    expect(document.activeElement).toBe(ref.current);
  });

  describe("when signed in", () => {
    it("signed in shows initials, name and the connection line", () => {
      renderSection({ state: "signed-in", login: "zakyirsyaad", name: "Zaky Irsyad" });
      expect(within(group()).getByText("ZI")).toHaveClass("size-8", "rounded-full", "bg-surface-hover");
      expect(within(group()).getByText("Zaky Irsyad")).toBeInTheDocument();
      const line = within(group()).getByText("Connected as @zakyirsyaad on github.com");
      const dot = line.querySelector("[aria-hidden]") as HTMLElement;
      expect(dot).toHaveClass("bg-status-running");
      expect(dot.className).not.toContain("animate-pulse");
    });

    it("shows @login and its first letter when GitHub has no name", () => {
      renderSection({ state: "signed-in", login: "octocat" });
      expect(within(group()).getByText("@octocat")).toBeInTheDocument();
      expect(within(group()).getByText("O")).toBeInTheDocument();
    });

    it("checks again, and is off while a check runs", () => {
      const props = renderSection({ state: "signed-in", login: "octocat" });
      fireEvent.click(screen.getByRole("button", { name: "Check again" }));
      expect(props.onCheck).toHaveBeenCalledTimes(1);
      props.rerender(<GithubSection {...props} isChecking />);
      expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
      expect(announcement()).toHaveTextContent("Checking your GitHub connection.");
    });
  });

  describe("when signed out", () => {
    it("signed out offers only Connect", () => {
      const props = renderSection({ state: "signed-out" });
      expect(within(group()).getByText("Not connected")).toBeInTheDocument();
      expect(within(group()).getByText("Connect to see pull requests in the Changes tab and the top bar.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
      const connect = screen.getByRole("button", { name: "Connect" });
      expect(connect.className).toContain("bg-primary");
      fireEvent.click(connect);
      expect(props.onConnect).toHaveBeenCalledTimes(1);
      expect(announcement()).toHaveTextContent("Not connected to GitHub.");
    });
  });

  describe("when gh is not installed", () => {
    it("not installed shows the command as text and a link", () => {
      const props = renderSection({ state: "not-installed" });
      expect(within(group()).getByText("Install the GitHub CLI first")).toBeInTheDocument();
      expect(within(group()).getByText("brew install gh")).toHaveClass("font-mono", "select-text");
      const link = screen.getByRole("button", { name: "cli.github.com" });
      expect(link).toHaveClass("underline");
      fireEvent.click(link);
      expect(props.onOpenUrl).toHaveBeenCalledWith("https://cli.github.com");
      expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Check again" }));
      expect(props.onCheck).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the connection cannot be told", () => {
    it("shows why, and offers Connect and Check again", () => {
      const props = renderSection({ state: "unknown", message: "Could not reach GitHub. Check your connection and try again." });
      expect(within(group()).getByText("Could not check GitHub")).toBeInTheDocument();
      expect(within(group()).getByText(/Could not reach GitHub\./)).toBeInTheDocument();
      expect(announcement()).toHaveTextContent("Could not tell whether GitHub is connected.");
      fireEvent.click(screen.getByRole("button", { name: "Check again" }));
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
      expect(props.onCheck).toHaveBeenCalledTimes(1);
      expect(props.onConnect).toHaveBeenCalledTimes(1);
    });

    it("unknown hides Connect when canConnect is false", () => {
      renderSection({
        state: "unknown",
        message: "The token in GH_TOKEN was rejected by GitHub. Renew or remove it, then check again.",
        canConnect: false,
      });
      expect(within(group()).getByText("GitHub turned down your token")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
      expect(screen.getByRole("button", { name: "Check again" })).toBeInTheDocument();
    });
  });

  it("announces the answer that replaces the check", () => {
    const view = renderSection(null);
    view.rerender(
      <GithubSection
        status={{ state: "signed-in", login: "octocat", name: "The Octocat" }}
        isChecking={false}
        onCheck={vi.fn()}
        onConnect={vi.fn()}
        onOpenUrl={vi.fn()}
      />,
    );
    expect(announcement()).toHaveTextContent("Connected to GitHub as The Octocat.");
  });
});
