import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

    it("reserves the inset the real traffic lights float in", () => {
      const { container } = renderTopBar();

      expect(TOP_BAR_TRAFFIC_LIGHT_INSET_PX).toBe(78);
      expect(headerOf(container).style.paddingLeft).toBe(
        `${TOP_BAR_TRAFFIC_LIGHT_INSET_PX}px`
      );
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
    it("shows the branch as a plain chip and no folder badge", () => {
      renderTopBar({ sessionName: "Market analyzer refactor", workspaceName: "titan-investment", branch: "main" });

      expect(screen.getByText("Market analyzer refactor")).toBeDefined();
      expect(screen.getByLabelText("Branch main")).toBeDefined();
      expect(screen.queryByText("titan-investment")).toBeNull();
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
