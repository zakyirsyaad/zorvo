import "@testing-library/jest-dom/vitest";
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
  render(<GithubSection {...props} />);
  return props;
}

afterEach(() => vi.restoreAllMocks());

describe("GithubSection", () => {
  it("says it is checking until the first answer", () => {
    renderSection(null);

    expect(screen.getByRole("status")).toHaveTextContent("Checking GitHub…");
    expect(screen.queryByRole("button")).toBeNull();
  });

  describe("when the GitHub CLI is not installed", () => {
    it("says so and shows the install command and a link to cli.github.com", () => {
      const props = renderSection({ state: "not-installed" });

      expect(screen.getByText("The GitHub CLI is not installed.")).toBeInTheDocument();
      expect(screen.getByText("brew install gh")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Get gh from cli.github.com" }));
      expect(props.onOpenUrl).toHaveBeenCalledWith("https://cli.github.com");
    });

    it("copies the install command", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      renderSection({ state: "not-installed" });

      fireEvent.click(screen.getByRole("button", { name: "Copy brew install gh" }));

      expect(writeText).toHaveBeenCalledWith("brew install gh");
      await waitFor(() => expect(screen.getByRole("button", { name: "Copy brew install gh" })).toHaveTextContent("Copied"));
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
      expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
    });

    it("shows @login alone when GitHub has no name", () => {
      renderSection({ state: "signed-in", login: "octocat" });

      expect(screen.getAllByText("@octocat")).toHaveLength(1);
      expect(screen.getByText("Connected to GitHub")).toBeInTheDocument();
    });

    it("checks again", () => {
      const props = renderSection({ state: "signed-in", login: "octocat" });

      fireEvent.click(screen.getByRole("button", { name: "Check again" }));

      expect(props.onCheck).toHaveBeenCalledTimes(1);
    });

    it("disables the button while a check is under way", () => {
      renderSection({ state: "signed-in", login: "octocat" }, { isChecking: true });

      expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
    });
  });

  describe("when the connection cannot be told", () => {
    it("shows why, and offers Check again and Connect", () => {
      const props = renderSection({
        state: "unknown",
        message: "Could not reach GitHub. Check your connection and try again.",
      });

      expect(screen.getByText(/Could not reach GitHub/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Check again" }));
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
      expect(props.onCheck).toHaveBeenCalledTimes(1);
      expect(props.onConnect).toHaveBeenCalledTimes(1);
    });
  });
});
