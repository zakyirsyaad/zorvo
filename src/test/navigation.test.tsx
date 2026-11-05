import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { TopBar } from "../components/TopBar";
import { Sidebar } from "../components/Sidebar";
import App from "../App";
import type { AgentProfile, Session } from "../types";
import { fakeProfiles, makeProfile } from "./fixtures/agents";

describe("Navigation and Layout Components", () => {
  const mockProfiles: AgentProfile[] = fakeProfiles;

  const mockSessions: Session[] = [
    {
      id: "s-1",
      name: "New session (fork)",
      profileId: "claude-acp",
      cwd: "/Users/mac/ai-perpetual-trading",
      status: "running",
      createdAt: Date.now() - 3600000,
    },
    {
      id: "s-2",
      name: "Market analyzer refactor",
      profileId: "qwen-code",
      cwd: "/Users/mac/titan-investment",
      status: "idle",
      createdAt: Date.now() - 7200000,
    },
  ];

  describe("TopBar", () => {
    it("renders the session title without a folder badge", () => {
      render(<TopBar sessionName="New session (fork)" workspaceName="ai-perpetual-trading" />);

      expect(screen.getByText("New session (fork)")).toBeDefined();
      // The spec's top bar has no folder badge: the sidebar groups sessions by folder.
      expect(screen.queryByText("ai-perpetual-trading")).toBeNull();
    });
  });

  describe("Sidebar", () => {
    const workspaces = [
      { name: "ai-perpetual-trading", path: "/Users/mac/ai-perpetual-trading" },
      { name: "titan-investment", path: "/Users/mac/titan-investment" },
    ];

    it("groups sessions under their workspace, with the given footer", () => {
      const onNewSession = vi.fn();
      const onSelectSession = vi.fn();

      render(
        <Sidebar
          workspaces={workspaces}
          activeWorkspacePath="/Users/mac/ai-perpetual-trading"
          sessions={mockSessions}
          activeSessionId="s-1"
          agents={mockProfiles}
          onNewSession={onNewSession}
          onSelectSession={onSelectSession}
          footer={<span>footer content</span>}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "New session" }));
      expect(onNewSession).toHaveBeenCalledTimes(1);

      const workspaceList = within(screen.getByRole("list", { name: "Workspaces" }));
      expect(workspaceList.getAllByRole("button", { expanded: true }).map((b) => b.textContent)).toEqual([
        "ai-perpetual-trading",
        "titan-investment",
      ]);

      const titanSessions = within(screen.getByRole("list", { name: "Sessions in titan-investment" }));
      fireEvent.click(titanSessions.getByText("Market analyzer refactor"));
      expect(onSelectSession).toHaveBeenCalledWith("s-2");
      // Which agent runs a session is in its tooltip.
      expect(titanSessions.getByTitle(/^Market analyzer refactor · Qwen Code · /)).toBeDefined();

      expect(screen.getByText("footer content")).toBeDefined();
      expect(screen.queryByText(/iwang/i)).toBeNull();
    });

    it("names each session's agent on its second line", () => {
      render(
        <Sidebar
          workspaces={workspaces}
          sessions={[...mockSessions, { ...mockSessions[1], id: "s-3", name: "Logoless chat", profileId: "acme" }]}
          agents={[...mockProfiles, makeProfile({ id: "acme", name: "Acme Agent", detected: true })]}
          onNewSession={() => {}}
          onSelectSession={() => {}}
        />
      );

      const claudeRow = within(screen.getByText("New session (fork)").closest("li") as HTMLElement);
      expect(claudeRow.getByText("Claude Code")).toBeDefined();
      const acmeRow = within(screen.getByText("Logoless chat").closest("li") as HTMLElement);
      expect(acmeRow.getByText("Acme Agent")).toBeDefined();
    });

    it("shows a workspace without sessions, and its + asks which agent to start there", () => {
      const onNewSessionIn = vi.fn();
      render(
        <Sidebar
          workspaces={[...workspaces, { name: "empty-project", path: "/Users/mac/empty-project" }]}
          sessions={mockSessions}
          agents={[
            makeProfile({ id: "claude-acp", name: "Claude Code", detected: true }),
            makeProfile({ id: "codex-acp", name: "Codex", detected: false }),
            makeProfile({ id: "qwen-code", name: "Qwen Code", detected: true }),
          ]}
          defaultAgentId="qwen-code"
          onNewSession={() => {}}
          onSelectSession={() => {}}
          onNewSessionIn={onNewSessionIn}
        />
      );

      expect(screen.getByRole("button", { name: "empty-project" })).toBeDefined();
      expect(screen.queryByRole("list", { name: "Sessions in empty-project" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "New session in empty-project" }));
      const menu = within(screen.getByRole("menu"));
      // Installed agents only, the default first.
      expect(menu.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Qwen CodeDefault", "Claude Code"]);

      fireEvent.click(menu.getByRole("menuitem", { name: "Claude Code" }));
      expect(onNewSessionIn).toHaveBeenCalledWith("/Users/mac/empty-project", "claude-acp");
      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("closes the + menu with Escape without starting anything", () => {
      const onNewSessionIn = vi.fn();
      render(
        <Sidebar
          workspaces={workspaces}
          sessions={[]}
          agents={mockProfiles}
          onNewSession={() => {}}
          onSelectSession={() => {}}
          onNewSessionIn={onNewSessionIn}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "New session in titan-investment" }));
      fireEvent.keyDown(document, { key: "Escape" });

      expect(screen.queryByRole("menu")).toBeNull();
      expect(onNewSessionIn).not.toHaveBeenCalled();
    });

    it("folds a workspace's sessions away and back from its heading", () => {
      render(
        <Sidebar
          workspaces={workspaces}
          sessions={mockSessions}
          agents={mockProfiles}
          onNewSession={() => {}}
          onSelectSession={() => {}}
        />
      );
      const heading = screen.getByRole("button", { name: "titan-investment" });

      fireEvent.click(heading);
      expect(heading.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByText("Market analyzer refactor")).toBeNull();
      // Other workspaces stay open.
      expect(screen.getByRole("list", { name: "Sessions in ai-perpetual-trading" })).toBeDefined();

      fireEvent.click(heading);
      expect(heading.getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByText("Market analyzer refactor")).toBeDefined();
    });

    it("lays the sidebar out from New session down to Archived", () => {
      const base = mockSessions[1];
      render(
        <Sidebar
          workspaces={workspaces}
          sessions={[
            { ...base, id: "p", name: "Pinned work", pinned: true },
            { ...base, id: "a", name: "Old work", archivedAt: 10 },
            base,
          ]}
          agents={mockProfiles}
          onHide={() => {}}
          onNewSession={() => {}}
          onSelectSession={() => {}}
        />
      );
      const inOrder = [
        screen.getByRole("button", { name: "Hide sidebar" }),
        screen.getByRole("button", { name: "New session" }),
        screen.getByRole("textbox", { name: "Search sessions" }),
        screen.getByRole("list", { name: "Pinned sessions" }),
        screen.getByRole("list", { name: "Workspaces" }),
        screen.getByRole("button", { name: "Archived (1)" }),
      ];
      for (let i = 1; i < inOrder.length; i++) {
        expect(inOrder[i - 1].compareDocumentPosition(inOrder[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
      expect(screen.getByRole("textbox", { name: "Search sessions" }).getAttribute("placeholder")).toBe("Search sessions");
    });

    it("draws the top block, the search and the headings as the canvas does", () => {
      const base = mockSessions[1];
      render(
        <Sidebar
          workspaces={workspaces}
          sessions={[
            { ...base, id: "p", name: "Pinned work", pinned: true },
            { ...base, id: "a", name: "Old work", archivedAt: 10 },
            base,
          ]}
          agents={mockProfiles}
          onNewSession={() => {}}
          onSelectSession={() => {}}
        />
      );

      const newSession = screen.getByRole("button", { name: "New session" });
      expect(newSession.parentElement?.className).not.toContain("border-b");
      expect(newSession.className).toContain("h-8");
      expect(newSession.className).toContain("justify-start");
      expect(newSession.className).not.toContain("justify-center");

      const search = screen.getByRole("textbox", { name: "Search sessions" });
      expect(search.className).toContain("bg-surface-2");
      expect(search.className).not.toMatch(/(^|\s)border(\s|-)/);

      // No Workspaces heading and no folder button: a folder opens from the draft's folder chip.
      expect(screen.queryByText("Workspaces")).toBeNull();
      expect(screen.queryByRole("button", { name: "Open folder" })).toBeNull();

      const pinned = screen.getByText("Pinned");
      expect(pinned.closest("div")?.className).not.toContain("uppercase");
      expect(pinned.closest("div")?.querySelector(".lucide-pin")).not.toBeNull();

      const archived = screen.getByRole("button", { name: "Archived (1)" });
      expect(archived.className).not.toContain("uppercase");
      expect(within(archived).getByText("Archived")).toBeDefined();
      expect(within(archived).getByText("1").className).toContain("text-fg-subtle");
      const section = archived.closest("section")!;
      expect(section.nextElementSibling).toBeNull();
      expect(section.previousElementSibling?.className).toContain("flex-1");
    });

    it("shows a folded folder's summary in words", () => {
      render(
        <Sidebar
          workspaces={workspaces}
          sessions={mockSessions}
          agents={mockProfiles}
          isSessionWaiting={(id) => id === "s-2"}
          onNewSession={() => {}}
          onSelectSession={() => {}}
        />
      );
      const heading = screen.getByRole("button", { name: "titan-investment" });
      expect(screen.queryByText("1 waiting")).toBeNull();

      fireEvent.click(heading);
      expect(screen.getByText("1 waiting").className).toContain("text-status-attention");

      fireEvent.click(heading);
      expect(screen.queryByText("1 waiting")).toBeNull();
    });

    it("shows the folder's + on hover or focus, and its chevron while open", () => {
      render(
        <Sidebar
          workspaces={workspaces}
          sessions={mockSessions}
          agents={mockProfiles}
          onNewSessionIn={() => {}}
          onNewSession={() => {}}
          onSelectSession={() => {}}
        />
      );
      const plus = screen.getByRole("button", { name: "New session in titan-investment" });
      const actions = plus.closest("[data-testid='folder-actions']") as HTMLElement;
      expect(actions.className).toContain("group-hover:opacity-100");
      expect(actions.className).toContain("group-focus-within:opacity-100");
      // Its agent menu stays visible while it is open, wherever the pointer goes.
      expect(actions.className).toContain("has-[[role=menu]]:opacity-100");
      // Open, the fold chevron sits after the +, at the header's right end.
      const header = screen.getByRole("button", { name: "titan-investment" }).parentElement as HTMLElement;
      const chevron = header.querySelector("[data-chevron]") as Element;
      expect(chevron.getAttribute("class")).toContain("group-hover:opacity-100");
      expect(plus.compareDocumentPosition(chevron) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(header.querySelector(".lucide-folder")).not.toBeNull();
    });

    it("draws a folded folder with its chevron first and a dot before waiting or working", () => {
      const { rerender } = render(
        <Sidebar
          workspaces={workspaces}
          sessions={mockSessions}
          agents={mockProfiles}
          isSessionWaiting={(id) => id === "s-2"}
          onNewSession={() => {}}
          onSelectSession={() => {}}
        />
      );
      const heading = screen.getByRole("button", { name: "titan-investment" });
      fireEvent.click(heading);

      expect(heading.firstElementChild?.getAttribute("class")).toContain("lucide-chevron-right");
      expect(heading.querySelector(".lucide-folder")).toBeNull();
      expect(screen.getByText("1 waiting").parentElement?.querySelector(".bg-status-attention")).not.toBeNull();

      rerender(
        <Sidebar
          workspaces={workspaces}
          sessions={mockSessions}
          agents={mockProfiles}
          isSessionBusy={(id) => id === "s-2"}
          onNewSession={() => {}}
          onSelectSession={() => {}}
        />
      );
      expect(screen.getByText("1 working").parentElement?.querySelector(".bg-status-running")).not.toBeNull();

      rerender(
        <Sidebar
          workspaces={workspaces}
          sessions={mockSessions}
          agents={mockProfiles}
          onNewSession={() => {}}
          onSelectSession={() => {}}
        />
      );
      const idle = screen.getByText("1 session");
      expect(idle.parentElement?.querySelector("[class*='bg-status-']")).toBeNull();
      expect(idle.className).toContain("text-fg-subtle");
    });

    describe("organizing sessions", () => {
      const base = mockSessions[1];
      const organized: Session[] = [
        { ...base, id: "plain", name: "Plain work", createdAt: 3 },
        { ...base, id: "pinned", name: "Pinned work", createdAt: 2, pinned: true },
        { ...base, id: "archived", name: "Old work", createdAt: 1, archivedAt: 10 },
      ];
      function renderOrganized(handlers: Partial<Parameters<typeof Sidebar>[0]> = {}) {
        render(
          <Sidebar
            workspaces={workspaces}
            sessions={organized}
            agents={mockProfiles}
            onNewSession={() => {}}
            onSelectSession={() => {}}
            onRenameSession={() => {}}
            onPinSession={() => {}}
            onArchiveSession={() => {}}
            {...handlers}
          />
        );
      }
      function openMenu(sessionName: string) {
        const row = screen.getByText(sessionName).closest("li") as HTMLElement;
        fireEvent.click(within(row).getByRole("button", { name: `More actions for ${sessionName}` }));
        return within(screen.getByRole("menu", { name: `Actions for ${sessionName}` }));
      }

      it("lists pinned sessions on top and archived ones folded at the bottom, out of their workspace", () => {
        renderOrganized();

        const pinned = within(screen.getByRole("list", { name: "Pinned sessions" }));
        expect(pinned.getByText("Pinned work")).toBeDefined();
        const titan = within(screen.getByRole("list", { name: "Sessions in titan-investment" }));
        expect(titan.getByText("Plain work")).toBeDefined();
        expect(titan.queryByText("Pinned work")).toBeNull();
        expect(screen.queryByText("Old work")).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "Archived (1)" }));
        expect(within(screen.getByRole("list", { name: "Archived sessions" })).getByText("Old work")).toBeDefined();
      });

      it("pins, unpins, archives and unarchives from a session's menu", () => {
        const onPinSession = vi.fn();
        const onArchiveSession = vi.fn();
        renderOrganized({ onPinSession, onArchiveSession });

        fireEvent.click(openMenu("Plain work").getByRole("menuitem", { name: "Pin" }));
        expect(onPinSession).toHaveBeenCalledWith("plain", true);
        fireEvent.click(openMenu("Pinned work").getByRole("menuitem", { name: "Unpin" }));
        expect(onPinSession).toHaveBeenCalledWith("pinned", false);
        fireEvent.click(openMenu("Plain work").getByRole("menuitem", { name: "Archive" }));
        expect(onArchiveSession).toHaveBeenCalledWith("plain", true);

        fireEvent.click(screen.getByRole("button", { name: "Archived (1)" }));
        fireEvent.click(openMenu("Old work").getByRole("menuitem", { name: "Unarchive" }));
        expect(onArchiveSession).toHaveBeenCalledWith("archived", false);
      });

      it("renames a session in place: Enter saves, Escape keeps the old name", () => {
        const onRenameSession = vi.fn();
        renderOrganized({ onRenameSession });

        fireEvent.click(openMenu("Plain work").getByRole("menuitem", { name: "Rename" }));
        const input = screen.getByRole("textbox", { name: "Rename Plain work" });
        fireEvent.change(input, { target: { value: "  Parser rewrite  " } });
        fireEvent.keyDown(input, { key: "Enter" });
        expect(onRenameSession).toHaveBeenCalledWith("plain", "Parser rewrite");

        fireEvent.click(openMenu("Pinned work").getByRole("menuitem", { name: "Rename" }));
        const second = screen.getByRole("textbox", { name: "Rename Pinned work" });
        fireEvent.change(second, { target: { value: "Something else" } });
        fireEvent.keyDown(second, { key: "Escape" });
        expect(onRenameSession).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("textbox", { name: /^Rename/ })).toBeNull();
      });

      it("finds pinned and archived sessions by their project's name", () => {
        renderOrganized();

        fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "titan" } });

        expect(within(screen.getByRole("list", { name: "Pinned sessions" })).getByText("Pinned work")).toBeDefined();
        expect(within(screen.getByRole("list", { name: "Archived sessions" })).getByText("Old work")).toBeDefined();
      });

      it("offers no Archive while the session's agent is working", () => {
        renderOrganized({ isSessionBusy: (id) => id === "plain" });

        const menu = openMenu("Plain work");
        expect(menu.queryByRole("menuitem", { name: "Archive" })).toBeNull();
        expect(menu.getByRole("menuitem", { name: "Rename" })).toBeDefined();
      });

      it("keeps the Archived section's own state while a search shows it", () => {
        renderOrganized();
        fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "work" } });

        const toggle = screen.getByRole("button", { name: "Archived (1)" });
        expect((toggle as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(toggle);
        fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "" } });

        expect(screen.queryByRole("list", { name: "Archived sessions" })).toBeNull();
      });

      it("marks a session whose agent finished while another was open, unless it is working again", () => {
        const withUnread: Session[] = [{ ...base, id: "done", name: "Done work", createdAt: 5, hasUnread: true }, ...organized];
        const { rerender } = render(
          <Sidebar workspaces={workspaces} sessions={withUnread} agents={mockProfiles} onNewSession={() => {}} onSelectSession={() => {}} />
        );
        const row = () => screen.getByText("Done work").closest("li") as HTMLElement;
        expect(within(row()).getByText(/(^|· )Finished, unread$/)).toBeDefined();

        rerender(
          <Sidebar
            workspaces={workspaces}
            sessions={withUnread}
            agents={mockProfiles}
            onNewSession={() => {}}
            onSelectSession={() => {}}
            isSessionBusy={(id) => id === "done"}
          />
        );
        expect(within(row()).queryByText(/(^|· )Finished, unread$/)).toBeNull();
        expect(within(row()).getByText(/(^|· )Working$/)).toBeDefined();
      });

      it("finds pinned and archived sessions when searching", () => {
        renderOrganized();

        fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "work" } });

        expect(within(screen.getByRole("list", { name: "Pinned sessions" })).getByText("Pinned work")).toBeDefined();
        expect(within(screen.getByRole("list", { name: "Archived sessions" })).getByText("Old work")).toBeDefined();
      });
    });

    it("nests a fork under the session it came from", () => {
      const source: Session = { ...mockSessions[1], id: "src", name: "Refactor plan" };
      const forked: Session = { ...source, id: "fork", name: "Refactor plan (fork)", forkedFrom: "src", createdAt: source.createdAt + 1 };
      render(
        <Sidebar
          workspaces={workspaces}
          sessions={[source, forked]}
          agents={mockProfiles}
          onNewSession={() => {}}
          onSelectSession={() => {}}
        />
      );

      const top = within(screen.getByRole("list", { name: "Sessions in titan-investment" }));
      const forks = within(top.getByRole("list", { name: "Forks of Refactor plan" }));
      expect(forks.getByText("Refactor plan (fork)")).toBeDefined();
      // The fork is listed once, under its source, not again at the top level.
      expect(screen.getAllByText("Refactor plan (fork)")).toHaveLength(1);
    });

    it("filters sessions and workspaces when searching", () => {
      render(
        <Sidebar
          workspaces={workspaces}
          activeWorkspacePath="/Users/mac/ai-perpetual-trading"
          sessions={mockSessions}
          activeSessionId="s-1"
          agents={mockProfiles}
          onNewSession={() => {}}
          onSelectSession={() => {}}
        />
      );

      fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "titan" } });

      const workspaceList = within(screen.getByRole("list", { name: "Workspaces" }));
      expect(workspaceList.getByText("titan-investment")).toBeDefined();
      expect(workspaceList.queryByText("ai-perpetual-trading")).toBeNull();
      expect(screen.queryByRole("list", { name: "Sessions in ai-perpetual-trading" })).toBeNull();
    });

    it("finds a session by name in a workspace that does not match, and opens folded workspaces", () => {
      render(
        <Sidebar
          workspaces={workspaces}
          sessions={mockSessions}
          agents={mockProfiles}
          onNewSession={() => {}}
          onSelectSession={() => {}}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "titan-investment" }));

      fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "analyzer" } });

      const titan = within(screen.getByRole("list", { name: "Sessions in titan-investment" }));
      expect(titan.getByText("Market analyzer refactor")).toBeDefined();
      expect(screen.queryByRole("button", { name: "ai-perpetual-trading" })).toBeNull();
    });
  });

  describe("App Integration", () => {
    it("hides the sidebar and shows it again, keeping its folds and its search", async () => {
      await act(async () => {
        render(<App />);
      });
      const sidebar = () => within(screen.getByRole("complementary", { hidden: true }));
      const heading = () => sidebar().getByRole("button", { name: "ai-perpetual-trading", hidden: true });
      fireEvent.click(heading());
      expect(heading().getAttribute("aria-expanded")).toBe("false");

      fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
      expect(screen.getByRole("complementary", { hidden: true }).hasAttribute("hidden")).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
      expect(screen.getByRole("complementary").hasAttribute("hidden")).toBe(false);
      expect(heading().getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByRole("button", { name: "Show sidebar" })).toBeNull();

      fireEvent.change(sidebar().getByRole("textbox", { name: "Search sessions" }), { target: { value: "trading" } });
      fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
      fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
      expect((sidebar().getByRole("textbox", { name: "Search sessions" }) as HTMLInputElement).value).toBe("trading");
    });

    it("renders TopBar and Sidebar inside App, without the popout-only terminal drawer toggle", async () => {
      await act(async () => {
        render(<App />);
      });

      expect(screen.getAllByText(/ai-perpetual-trading/i).length).toBeGreaterThan(0);
      expect(screen.getByPlaceholderText(/search/i)).toBeDefined();
      expect(screen.queryByRole("button", { name: /toggle terminal/i })).toBeNull();
    });
  });
});
