import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import {
  TopBar,
  TOP_BAR_TRAFFIC_LIGHT_INSET_PX,
  type TopBarProps,
} from "../components/TopBar";

function renderTopBar(overrides: Partial<TopBarProps> = {}) {
  return render(<TopBar {...overrides} />);
}

function headerOf(container: HTMLElement): HTMLElement {
  const header = container.querySelector("header");
  expect(header).not.toBeNull();
  return header as HTMLElement;
}

describe("TopBar", () => {
  describe("native macOS traffic lights", () => {
    it("renders no fake traffic-light controls", () => {
      const { container } = renderTopBar();

      expect(screen.queryByLabelText(/window controls/i)).toBeNull();
      // The three fake circles were painted with the macOS button colours.
      expect(container.innerHTML).not.toContain("ff5f56");
      expect(container.innerHTML).not.toContain("ffbd2e");
      expect(container.innerHTML).not.toContain("27c93f");
    });

    it("reserves the inset the real traffic lights float in only while the sidebar is hidden", () => {
      const { container, rerender } = renderTopBar();
      // With the sidebar shown, the traffic lights sit in the sidebar's own header.
      expect(headerOf(container).style.paddingLeft).toBe("");

      rerender(<TopBar onShowSidebar={() => {}} hasTrafficLights />);

      expect(TOP_BAR_TRAFFIC_LIGHT_INSET_PX).toBe(78);
      expect(headerOf(container).style.paddingLeft).toBe(`${TOP_BAR_TRAFFIC_LIGHT_INSET_PX}px`);
    });

    it("keeps the inset for a window with no sidebar at all, such as a popout", () => {
      const { container } = render(<TopBar sessionName="Fix the login" hasTrafficLights />);
      expect(headerOf(container).style.paddingLeft).toBe(`${TOP_BAR_TRAFFIC_LIGHT_INSET_PX}px`);
    });

    it("keeps the title readable when the bar is crowded", () => {
      render(
        <TopBar
          sessionName="Fix the login"
          branch="agent/fix-the-login-flow-for-users-who-signed-up-with-email"
          pullRequest={{ branch: "agent/x", number: 134, title: "Fix", url: "https://github.com/o/r/pull/134", state: "open", isDraft: false, checks: { passing: 0, failing: 0, pending: 0 } }}
          onOpenPullRequest={() => {}}
        />,
      );
      const title = screen.getByText("Fix the login");
      // A floor for the title, a branch chip that gives way first, and a left group that cannot paint over the right.
      expect(title.className).toContain("min-w-12");
      const branch = screen.getByLabelText(/^Branch /);
      expect(branch.className).not.toContain("shrink-0");
      expect(branch.className).toContain("shrink-[4]");
      expect(branch.className).toContain("min-w-0");
      expect(title.closest(".overflow-hidden")).not.toBeNull();
    });

    it("is 48px tall with the session's title at weight 600 in the brightest text", () => {
      const { container } = renderTopBar({ sessionName: "Fix the login" });

      expect(headerOf(container)).toHaveClass("h-12");
      expect(screen.getByText("Fix the login")).toHaveClass("font-semibold", "text-fg");
    });

    it("lists the session's actions with an icon each, and a rule before Archive", () => {
      renderTopBar({ sessionName: "Fix the login", onPopout: vi.fn(), onReveal: vi.fn(), onRename: vi.fn(), onArchive: vi.fn() });

      fireEvent.click(screen.getByRole("button", { name: "More options" }));

      const menu = screen.getByRole("menu", { name: "More options" });
      const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
      expect(items.map((item) => item.textContent)).toEqual(["Open in new window", "Open in Finder", "Rename", "Archive"]);
      for (const item of items) expect(item.querySelector("svg")).not.toBeNull();
      const separator = menu.querySelector('[role="separator"]');
      expect(separator).not.toBeNull();
      expect(separator!.nextElementSibling?.textContent).toBe("Archive");
    });

    it("marks the header and its inert areas as the window drag region", () => {
      const { container } = renderTopBar({
        sessionName: "Market analyzer refactor",
      });

      const header = headerOf(container);
      expect(header.hasAttribute("data-tauri-drag-region")).toBe(true);

      // Dragging only starts on the element that carries the attribute, so the
      // breadcrumb area needs it too; the buttons must not swallow drags into clicks.
      const dragRegions = Array.from(
        container.querySelectorAll("[data-tauri-drag-region]")
      );
      expect(dragRegions.length).toBeGreaterThan(1);
      expect(
        dragRegions.some((el) => el.textContent?.includes("Market analyzer refactor"))
      ).toBe(true);
      for (const region of dragRegions) {
        expect(region.closest("button")).toBeNull();
      }
    });
  });

  describe("back / forward between sessions", () => {
    const hidden = { onShowSidebar: () => {} };

    it("shows Back and Forward only while the sidebar is hidden", () => {
      const { unmount } = renderTopBar({ sessionName: "Alpha" });
      expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Forward" })).toBeNull();
      unmount();

      renderTopBar({ sessionName: "Alpha", ...hidden });
      const order = ["Show sidebar", "Back", "Forward"].map((name) => screen.getByRole("button", { name }));
      const title = screen.getByText("Alpha");
      for (let i = 1; i < order.length; i++) {
        expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
      expect(order[2].compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("disables both buttons when there is nowhere to go", () => {
      renderTopBar({ ...hidden, canGoBack: false, canGoForward: false });
      expect(screen.getByRole("button", { name: "Back" }).hasAttribute("disabled")).toBe(true);
      expect(screen.getByRole("button", { name: "Forward" }).hasAttribute("disabled")).toBe(true);
    });

    it("enables and calls back and forward when the history allows it", () => {
      const onBack = vi.fn();
      const onForward = vi.fn();
      renderTopBar({ ...hidden, canGoBack: true, canGoForward: true, onBack, onForward });
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      fireEvent.click(screen.getByRole("button", { name: "Forward" }));
      expect(onBack).toHaveBeenCalledTimes(1);
      expect(onForward).toHaveBeenCalledTimes(1);
    });

    it("does not fire the handler of a disabled button", () => {
      const onBack = vi.fn();
      const onForward = vi.fn();
      renderTopBar({ ...hidden, onBack, onForward });
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      fireEvent.click(screen.getByRole("button", { name: "Forward" }));
      expect(onBack).not.toHaveBeenCalled();
      expect(onForward).not.toHaveBeenCalled();
    });
  });

  describe("more options menu", () => {
    it("hides the menu when no handlers are given", () => {
      renderTopBar();
      expect(screen.queryByRole("button", { name: "More options" })).toBeNull();
    });

    it("runs the more options menu", () => {
      const handlers = { onPopout: vi.fn(), onReveal: vi.fn(), onArchive: vi.fn(), onRename: vi.fn() };
      renderTopBar({ sessionId: "s1", sessionName: "Alpha", ...handlers });
      const open = () => fireEvent.click(screen.getByRole("button", { name: "More options" }));

      open();
      const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
      expect(items).toEqual(["Open in new window", "Open in Finder", "Rename", "Archive"]);

      for (const [label, spy] of [
        ["Open in new window", handlers.onPopout],
        ["Open in Finder", handlers.onReveal],
        ["Archive", handlers.onArchive],
      ] as const) {
        fireEvent.click(screen.getByRole("menuitem", { name: label }));
        expect(spy).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("menu", { name: "More options" })).toBeNull();
        open();
      }

      fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
      expect(screen.getByRole("textbox", { name: "Rename Alpha" })).toBeDefined();
    });

    it("leaves out menu items without a handler", () => {
      renderTopBar({ onPopout: () => {} });
      fireEvent.click(screen.getByRole("button", { name: "More options" }));
      expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Open in new window"]);
    });

    it("lists Delegate after Rename and before Archive", () => {
      const onRename = vi.fn();
      const onArchive = vi.fn();
      const onDelegate = vi.fn();
      renderTopBar({ sessionName: "Alpha", onRename, onArchive, onDelegate, delegateBlockedReason: null });

      fireEvent.click(screen.getByRole("button", { name: "More options" }));
      const menu = screen.getByRole("menu", { name: "More options" });
      const labels = screen.getAllByRole("menuitem").map((item) => item.textContent);
      expect(labels).toEqual(["Rename", "Delegate to another agent…", "Archive"]);

      // Delegate sits above the rule that sets Archive apart.
      const delegate = screen.getByRole("menuitem", { name: "Delegate to another agent…" });
      const separator = menu.querySelector('[role="separator"]');
      expect(separator).not.toBeNull();
      expect(delegate.compareDocumentPosition(separator!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(separator!.nextElementSibling?.textContent).toBe("Archive");

      fireEvent.click(delegate);
      expect(onDelegate).toHaveBeenCalledTimes(1);
      expect(onArchive).not.toHaveBeenCalled();
    });

    it("a blocked Delegate is disabled with its reason", () => {
      const onDelegate = vi.fn();
      const reason = "Codex already has a task from this session.";
      renderTopBar({ sessionName: "Alpha", onDelegate, delegateBlockedReason: reason });

      fireEvent.click(screen.getByRole("button", { name: "More options" }));
      const item = screen.getByRole("menuitem", { name: /Delegate to another agent…/ });
      expect(item).toBeDisabled();
      expect(item).toHaveClass("disabled:text-fg-subtle");

      const description = within(item).getByText(reason);
      expect(description).toHaveClass("text-caption", "text-fg-subtle");
      expect(item).toHaveAttribute("aria-describedby", description.id);

      fireEvent.click(item);
      expect(onDelegate).not.toHaveBeenCalled();
    });

    it("no Delegate for an empty reason", () => {
      const onDelegate = vi.fn();
      // Archive keeps the menu itself: only the Delegate item is left out.
      renderTopBar({ sessionName: "Alpha", onArchive: vi.fn(), onDelegate, delegateBlockedReason: "" });

      fireEvent.click(screen.getByRole("button", { name: "More options" }));
      expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Archive"]);
      expect(screen.queryByRole("menuitem", { name: /Delegate/ })).toBeNull();
    });

    it("End delegation shows when it applies", () => {
      const onDelegate = vi.fn();
      const onEndDelegation = vi.fn();
      renderTopBar({
        sessionName: "Alpha",
        onDelegate,
        delegateBlockedReason: null,
        onEndDelegation,
      });

      fireEvent.click(screen.getByRole("button", { name: "More options" }));
      const labels = screen.getAllByRole("menuitem").map((item) => item.textContent);
      expect(labels).toEqual(["Delegate to another agent…", "End delegation"]);

      fireEvent.click(screen.getByRole("menuitem", { name: "End delegation" }));
      expect(onEndDelegation).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("menu", { name: "More options" })).toBeNull();
    });

    it("offers End delegation per delegate when there are several", () => {
      const endCodex = vi.fn();
      const endQwen = vi.fn();
      renderTopBar({
        sessionName: "Alpha",
        delegationEnds: [
          { label: "End delegation to Codex", run: endCodex },
          { label: "End delegation to Qwen Code", run: endQwen },
        ],
      });

      fireEvent.click(screen.getByRole("button", { name: "More options" }));
      expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
        "End delegation to Codex",
        "End delegation to Qwen Code",
      ]);
      fireEvent.click(screen.getByRole("menuitem", { name: "End delegation to Qwen Code" }));
      expect(endQwen).toHaveBeenCalledTimes(1);
      expect(endCodex).not.toHaveBeenCalled();
    });

    it("offers Stop allowing delegation only while the session is allowed", () => {
      const onStopAllowingDelegation = vi.fn();
      renderTopBar({ sessionName: "Alpha", onArchive: vi.fn(), onStopAllowingDelegation });

      fireEvent.click(screen.getByRole("button", { name: "More options" }));
      expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
        "Stop allowing delegation",
        "Archive",
      ]);
      fireEvent.click(screen.getByRole("menuitem", { name: "Stop allowing delegation" }));
      expect(onStopAllowingDelegation).toHaveBeenCalledTimes(1);
    });
  });

  describe("inspector toggle", () => {
    it("shows one Inspector toggle when onToggleInspector is given, pressed while it is open", () => {
      const onToggleInspector = vi.fn();
      renderTopBar({ onToggleInspector, isInspectorOpen: true });

      const toggle = screen.getByRole("button", { name: "Inspector" });
      expect(toggle.getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(toggle);
      expect(onToggleInspector).toHaveBeenCalledTimes(1);
    });

    it("offers no Inspector toggle when there is nothing to inspect", () => {
      renderTopBar();
      expect(screen.queryByRole("button", { name: "Inspector" })).toBeNull();
    });
  });

  describe("diff-stat chip", () => {
    it("shows the totals, opens the diff from the chip only, and shows no count on the Inspector toggle", () => {
      const onOpenDiff = vi.fn();
      const onToggleInspector = vi.fn();
      renderTopBar({ diffStats: { added: 2847, removed: 35 }, onOpenDiff, onToggleInspector });

      const toggle = screen.getByRole("button", { name: "Inspector" });
      expect(toggle.textContent).toBe("");
      fireEvent.click(screen.getByRole("button", { name: /2,847 lines added, 35 removed/ }));
      expect(onOpenDiff).toHaveBeenCalledTimes(1);
      expect(onToggleInspector).not.toHaveBeenCalled();
      fireEvent.click(toggle);
      expect(onToggleInspector).toHaveBeenCalledTimes(1);
      expect(onOpenDiff).toHaveBeenCalledTimes(1);
    });

    it("shows no chip without totals or when nothing changed", () => {
      renderTopBar({ onToggleInspector: () => {}, onOpenDiff: () => {} });
      expect(screen.queryByRole("button", { name: /lines added/ })).toBeNull();
    });
  });

  describe("breadcrumb", () => {
    it("reads folder, a slash, then the title, with the folder giving way first", () => {
      renderTopBar({ sessionName: "Market analyzer refactor", folderName: "titan-investment", workspaceName: "titan-investment", branch: "main" });

      const folder = screen.getByText("titan-investment");
      const slash = screen.getByText("/");
      const title = screen.getByText("Market analyzer refactor");
      expect(folder).toHaveClass("text-fg-muted", "shrink-[3]", "truncate");
      expect(slash).toHaveAttribute("aria-hidden", "true");
      expect(slash).toHaveClass("text-fg-subtle");
      expect(title).toHaveClass("min-w-12", "font-semibold", "text-fg");
      expect(folder.compareDocumentPosition(slash) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(slash.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getByLabelText("Branch main")).toBeDefined();
    });

    it("shows the title alone without a folder", () => {
      renderTopBar({ sessionName: "Market analyzer refactor", workspaceName: "titan-investment", branch: "main" });

      expect(screen.getByText("Market analyzer refactor")).toBeDefined();
      expect(screen.queryByText("/")).toBeNull();
      expect(screen.queryByText("titan-investment")).toBeNull();
    });

    it("reads folder / New session for a draft, with no branch chip", () => {
      renderTopBar({ isDraft: true, folderName: "titan-investment", workspaceName: "titan-investment", branch: "main" });

      expect(screen.getByText("titan-investment")).toBeDefined();
      expect(screen.getByText("/")).toBeDefined();
      expect(screen.getByText("New session")).toHaveClass("font-semibold", "text-fg");
      expect(screen.queryByLabelText("Branch main")).toBeNull();
    });

    it("adds Compare and the agent count after a run's title", () => {
      renderTopBar({ sessionName: "Fix the login", folderName: "zorvo", runAgentCount: 3 });

      const compare = screen.getByText("Compare · 3 agents");
      expect(compare.compareDocumentPosition(screen.getByText("Fix the login")) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
      expect(compare.parentElement?.querySelector("svg.lucide-columns-3")).toHaveClass("text-fg-muted");
    });

    it("pads the bar 18px left and 10px right with a 10px gap", () => {
      const { container } = renderTopBar({ sessionName: "A" });
      expect(headerOf(container)).toHaveClass("pl-[18px]", "pr-2.5", "gap-2.5");
    });
  });

  describe("chips", () => {
    it("draws the Plan, background-task and diff chips 28px high, and leaves the branch chip plain", () => {
      renderTopBar({
        sessionName: "A",
        workspaceName: "w",
        branch: "main",
        plan: [{ content: "Step", status: "in_progress" }],
        backgroundTasks: {
          tasks: [{ id: "agent:s2", kind: "agent" as const, name: "Refactor", status: "Working" as const, startedAt: 0, sessionId: "s2" }],
          isOpen: false,
          onOpenChange: () => {},
          onOpenTask: () => {},
          onStopTask: async () => true,
        },
        diffStats: { added: 4, removed: 1 },
        onOpenDiff: () => {},
      });
      for (const chip of [
        screen.getByRole("button", { name: /^Plan,/ }),
        screen.getByRole("button", { name: /background task/ }),
        screen.getByRole("button", { name: /lines added/ }),
      ]) {
        expect(chip).toHaveClass("h-7", "text-ui-sm", "px-2.5", "rounded-md", "border-border");
        expect(chip).not.toHaveClass("h-6");
      }
      expect(screen.getByLabelText("Branch main")).toHaveClass("h-6");
    });
  });

  describe("title", () => {
    it("shows no made-up session or folder name when there is none", () => {
      render(<TopBar />);

      expect(screen.queryByText(/new session \(fork\)/i)).toBeNull();
      expect(screen.queryByText("ai-perpetual-trading")).toBeNull();
      expect(screen.getByText("Zorvo")).toBeDefined();
    });

    it("shows only the folder when no session is open", () => {
      render(<TopBar workspaceName="api" />);

      expect(screen.getByText("api")).toBeDefined();
      expect(screen.queryByText("/")).toBeNull();
    });

    it("puts the Private · TEE chip after a private session's title", () => {
      const { unmount } = render(<TopBar sessionName="Private review" isPrivate />);
      expect(screen.getByText("Private · TEE")).toBeDefined();
      expect(screen.getByText("Private · TEE")).toHaveClass("h-[22px]");
      unmount();
      render(<TopBar sessionName="Plain review" />);
      expect(screen.queryByText("Private · TEE")).toBeNull();
    });
  });

  describe("background tasks", () => {
    const backgroundTasks = {
      tasks: [{ id: "agent:s2", kind: "agent" as const, name: "Refactor auth", status: "Working" as const, startedAt: 0, sessionId: "s2" }],
      isOpen: false,
      onOpenChange: () => {},
      onOpenTask: () => {},
      onStopTask: async () => true,
    };

    it("renders the background tasks menu only when given", () => {
      const { unmount } = renderTopBar();
      expect(screen.queryByRole("button", { name: /background task/ })).toBeNull();
      unmount();

      renderTopBar({ backgroundTasks });
      expect(screen.getByRole("button", { name: "1 background task" })).toBeTruthy();
    });
  });

  describe("renaming from the title", () => {
    const typeAndPress = (value: string, key: string) => {
      const field = screen.getByRole("textbox", { name: "Rename Alpha" });
      fireEvent.change(field, { target: { value } });
      fireEvent.keyDown(field, { key });
    };

    it("renames the session from a double-click on its title", () => {
      const onRename = vi.fn();
      renderTopBar({ sessionId: "s1", sessionName: "Alpha", onRename });
      fireEvent.doubleClick(screen.getByText("Alpha"));
      expect(screen.getByRole("textbox", { name: "Rename Alpha" })).toHaveProperty("value", "Alpha");
      typeAndPress("Beta", "Enter");
      expect(onRename).toHaveBeenCalledTimes(1);
      expect(onRename).toHaveBeenCalledWith("Beta");
      expect(screen.queryByRole("textbox", { name: "Rename Alpha" })).toBeNull();
    });

    it("keeps the name on Escape, a blank name or the same name", () => {
      const onRename = vi.fn();
      renderTopBar({ sessionId: "s1", sessionName: "Alpha", onRename });
      for (const [value, key] of [["Beta", "Escape"], ["   ", "Enter"], [" Alpha ", "Enter"]]) {
        fireEvent.doubleClick(screen.getByText("Alpha"));
        typeAndPress(value, key);
      }
      expect(onRename).not.toHaveBeenCalled();
    });

    it("closes the field when another session shows", () => {
      const onRename = vi.fn();
      const view = renderTopBar({ sessionId: "s1", sessionName: "Alpha", onRename });
      fireEvent.doubleClick(screen.getByText("Alpha"));
      view.rerender(<TopBar sessionId="s2" sessionName="Other" onRename={onRename} />);
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(onRename).not.toHaveBeenCalled();
    });

    it("offers no rename without onRename", () => {
      renderTopBar({ sessionId: "s1", sessionName: "Alpha" });
      fireEvent.doubleClick(screen.getByText("Alpha"));
      expect(screen.queryByRole("textbox")).toBeNull();
    });
  });
});
