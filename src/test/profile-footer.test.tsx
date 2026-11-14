import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProfileFooter } from "../components/ProfileFooter";

describe("ProfileFooter", () => {
  describe("avatar initials", () => {
    it("derives up to two initials from the profile name", () => {
      render(<ProfileFooter name="Iwang Nurhadi" />);

      expect(screen.getByText("IN")).toBeDefined();
    });

    it("uses a single initial for a one-word name", () => {
      render(<ProfileFooter name="iwang" />);

      expect(screen.getByText("I")).toBeDefined();
    });

    it("ignores extra words beyond the first two", () => {
      render(<ProfileFooter name="Iwang Nurhadi Pratama" />);

      expect(screen.getByText("IN")).toBeDefined();
    });

    it("falls back to the first letter of the email when there is no name", () => {
      render(<ProfileFooter email="iwang@example.com" />);

      expect(screen.getByText("I")).toBeDefined();
    });

    it("falls back to a neutral person icon when neither name nor email is known", () => {
      render(<ProfileFooter />);

      const avatar = screen.getByRole("img", { name: /local user avatar/i });
      expect(avatar.querySelector("svg")).not.toBeNull();
      expect(avatar.textContent).toBe("");
    });
  });

  describe("display name", () => {
    it("shows the profile name", () => {
      render(<ProfileFooter name="Iwang Nurhadi" email="iwang@example.com" />);

      expect(screen.getByText("Iwang Nurhadi")).toBeDefined();
    });

    it("falls back to the email when there is no name", () => {
      render(<ProfileFooter email="iwang@example.com" />);

      expect(screen.getByText("iwang@example.com")).toBeDefined();
    });

    it("falls back to a neutral label when nothing is known", () => {
      render(<ProfileFooter />);

      expect(screen.getByText("Local user")).toBeDefined();
    });

    it("treats a whitespace-only name as missing", () => {
      render(<ProfileFooter name="   " email="iwang@example.com" />);

      expect(screen.getByText("iwang@example.com")).toBeDefined();
    });
  });

  describe("as the canvas draws it", () => {
    it("sits on the window ground: no fill, no border, no version line", () => {
      const { container } = render(<ProfileFooter name="Iwang" onOpenSettings={() => {}} />);

      const footer = container.querySelector("footer") as HTMLElement;
      expect(footer.className).not.toContain("border-t");
      expect(footer.className).not.toContain("bg-surface-1");
      expect(footer.className).not.toContain("bg-bg");
      expect(screen.queryByText(/Zorvo v/)).toBeNull();
    });

    it("shows the name at weight 400, and Settings with the settings-2 glyph", () => {
      render(<ProfileFooter name="Iwang Nurhadi" onOpenSettings={() => {}} />);

      expect(screen.getByText("Iwang Nurhadi").className).not.toContain("font-medium");
      expect(screen.getByRole("button", { name: "Settings" }).querySelector(".lucide-settings-2")).not.toBeNull();
    });
  });

  describe("no invented account state", () => {
    it("renders no plan or tier badge", () => {
      render(<ProfileFooter name="Iwang Nurhadi" email="iwang@example.com" />);

      expect(screen.queryByText("Pro")).toBeNull();
      expect(screen.queryByText(/pro\b/i)).toBeNull();
    });
  });

  describe("GitHub connection", () => {
    const signedIn = { state: "signed-in", login: "octocat", name: "The Octocat" } as const;

    it("shows the GitHub name over git's, with its initials and a GitHub indicator", () => {
      render(<ProfileFooter name="Iwang Nurhadi" email="iwang@example.com" github={signedIn} />);

      expect(screen.getByText("The Octocat")).toBeDefined();
      expect(screen.queryByText("Iwang Nurhadi")).toBeNull();
      expect(screen.getByText("TO")).toBeDefined();
      expect(screen.getByRole("img", { name: "Connected to GitHub" })).toBeDefined();
    });

    it("shows @login, with the login's initial, when GitHub has no name", () => {
      render(<ProfileFooter name="Iwang Nurhadi" github={{ state: "signed-in", login: "octocat" }} />);

      expect(screen.getByText("@octocat")).toBeDefined();
      expect(screen.getByText("O")).toBeDefined();
      expect(screen.getByRole("img", { name: "Connected to GitHub" })).toBeDefined();
    });

    it("keeps git's name, email and the neutral label, and shows no indicator, when not signed in", () => {
      const { rerender } = render(<ProfileFooter name="Iwang Nurhadi" github={{ state: "signed-out" }} />);
      expect(screen.getByText("Iwang Nurhadi")).toBeDefined();
      expect(screen.queryByRole("img", { name: "Connected to GitHub" })).toBeNull();

      rerender(<ProfileFooter email="iwang@example.com" github={{ state: "unknown", message: "offline" }} />);
      expect(screen.getByText("iwang@example.com")).toBeDefined();

      rerender(<ProfileFooter github={{ state: "not-installed" }} />);
      expect(screen.getByText("Local user")).toBeDefined();
      expect(screen.queryByRole("img", { name: "Connected to GitHub" })).toBeNull();
    });

    it("behaves as before while the first check has not answered", () => {
      render(<ProfileFooter name="Iwang Nurhadi" github={null} />);

      expect(screen.getByText("Iwang Nurhadi")).toBeDefined();
      expect(screen.queryByRole("img", { name: "Connected to GitHub" })).toBeNull();
    });
  });

  describe("settings button", () => {
    it("calls onOpenSettings when clicked", () => {
      const onOpenSettings = vi.fn();
      render(<ProfileFooter name="Iwang" onOpenSettings={onOpenSettings} />);

      fireEvent.click(screen.getByRole("button", { name: /settings/i }));

      expect(onOpenSettings).toHaveBeenCalledTimes(1);
    });

    it("is hidden when no handler is given", () => {
      render(<ProfileFooter name="Iwang" />);

      expect(screen.queryByRole("button", { name: /settings/i })).toBeNull();
    });
  });
});
