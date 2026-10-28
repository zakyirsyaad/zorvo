import "@testing-library/jest-dom/vitest";
import { createRef } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GithubSection, type GithubSectionProps } from "../components/GithubSection";
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

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
});

describe("GithubSection", () => {
  it("says it is checking until the first answer", () => {
    renderSection(null);

    expect(screen.getByText("Checking GitHub…")).toBeInTheDocument();
    expect(announcement()).toHaveTextContent("Checking your GitHub connection.");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("takes focus when asked to, so Settings can give it back after a sign-in", () => {
    const ref = createRef<HTMLDivElement>();
    renderSection({ state: "signed-in", login: "octocat" }, { ref });

    ref.current?.focus();

    expect(document.activeElement).toBe(ref.current);
  });

  describe("when the GitHub CLI is not installed", () => {
    it("says so and shows the install command and a link to cli.github.com", () => {
      const props = renderSection({ state: "not-installed" });

      expect(screen.getByText("The GitHub CLI is not installed.")).toBeInTheDocument();
      expect(screen.getByText("brew install gh")).toBeInTheDocument();
      expect(announcement()).toHaveTextContent("GitHub CLI not installed.");
      fireEvent.click(screen.getByRole("button", { name: "Get gh from cli.github.com" }));
      expect(props.onOpenUrl).toHaveBeenCalledWith("https://cli.github.com");
    });

    it("copies the install command and says it did, to the eye and to a screen reader", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      renderSection({ state: "not-installed" });

      fireEvent.click(screen.getByRole("button", { name: "Copy" }));

      expect(writeText).toHaveBeenCalledWith("brew install gh");
      expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
      expect(screen.getAllByRole("status", { hidden: true }).map((node) => node.textContent)).toContain(
        "Copied to the clipboard.",
      );
    });

    it("describes the Copy button by the command it copies", () => {
      renderSection({ state: "not-installed" });

      expect(screen.getByRole("button", { name: "Copy" })).toHaveAccessibleDescription("brew install gh");
    });

    it("says so when the clipboard refuses", async () => {
      const writeText = vi.fn().mockRejectedValue(new Error("denied"));
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      renderSection({ state: "not-installed" });

      fireEvent.click(screen.getByRole("button", { name: "Copy" }));

      expect(await screen.findByText("Could not copy. Select the command and copy it yourself.")).toBeVisible();
      expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    });

    it("says so when there is no clipboard to write to", async () => {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
      renderSection({ state: "not-installed" });

      fireEvent.click(screen.getByRole("button", { name: "Copy" }));

      await waitFor(() =>
        expect(screen.getByText("Could not copy. Select the command and copy it yourself.")).toBeVisible(),
      );
    });

    it("checks again, and offers no Connect before gh exists", () => {
      const props = renderSection({ state: "not-installed" });

      fireEvent.click(screen.getByRole("button", { name: "Check again" }));

      expect(props.onCheck).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
    });
  });

  describe("when the user is signed out", () => {
    it("offers Connect, and says Zorvo never sees a token", () => {
      const props = renderSection({ state: "signed-out" });

      expect(screen.getByText("You are not connected to GitHub.")).toBeInTheDocument();
      expect(screen.getByText(/never sees your password or token/)).toBeInTheDocument();
      expect(announcement()).toHaveTextContent("Not connected to GitHub.");
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
      expect(props.onConnect).toHaveBeenCalledTimes(1);
    });

    it("checks again", () => {
      const props = renderSection({ state: "signed-out" });

      fireEvent.click(screen.getByRole("button", { name: "Check again" }));

      expect(props.onCheck).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the user is signed in", () => {
    it("shows the GitHub name, the login and that they are connected", () => {
      renderSection({ state: "signed-in", login: "octocat", name: "The Octocat" });

      expect(screen.getByText("The Octocat")).toBeInTheDocument();
      expect(screen.getByText("@octocat")).toBeInTheDocument();
      expect(screen.getByText("Connected to GitHub")).toBeInTheDocument();
      expect(announcement()).toHaveTextContent("Connected to GitHub as The Octocat.");
      expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
    });

    it("shows @login alone when GitHub has no name", () => {
      renderSection({ state: "signed-in", login: "octocat" });

      expect(screen.getAllByText("@octocat")).toHaveLength(1);
      expect(screen.getByText("Connected to GitHub")).toBeInTheDocument();
      expect(announcement()).toHaveTextContent("Connected to GitHub as @octocat.");
    });

    it("checks again", () => {
      const props = renderSection({ state: "signed-in", login: "octocat" });

      fireEvent.click(screen.getByRole("button", { name: "Check again" }));

      expect(props.onCheck).toHaveBeenCalledTimes(1);
    });

    it("disables the button while a check is under way, and announces the check", () => {
      renderSection({ state: "signed-in", login: "octocat" }, { isChecking: true });

      expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
      expect(announcement()).toHaveTextContent("Checking your GitHub connection.");
    });
  });

  describe("when the connection cannot be told", () => {
    it("shows why, and offers Check again and Connect", () => {
      const props = renderSection({
        state: "unknown",
        message: "Could not reach GitHub. Check your connection and try again.",
      });

      expect(screen.getByText(/Could not reach GitHub/)).toBeInTheDocument();
      expect(announcement()).toHaveTextContent("Could not tell whether GitHub is connected.");
      fireEvent.click(screen.getByRole("button", { name: "Check again" }));
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
      expect(props.onCheck).toHaveBeenCalledTimes(1);
      expect(props.onConnect).toHaveBeenCalledTimes(1);
    });

    it("offers no Connect for a rejected token in an environment variable, which gh would refuse to replace", () => {
      const props = renderSection({
        state: "unknown",
        message: "The token in GH_TOKEN was rejected by GitHub. Renew or remove it, then check again.",
        canConnect: false,
      });

      expect(screen.getByText("GitHub turned down your token.")).toBeInTheDocument();
      expect(
        screen.getByText("The token in GH_TOKEN was rejected by GitHub. Renew or remove it, then check again."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Check again" }));
      expect(props.onCheck).toHaveBeenCalledTimes(1);
    });
  });

  it("announces the answer that replaces the check", () => {
    const view = renderSection(null);
    expect(announcement()).toHaveTextContent("Checking your GitHub connection.");

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
