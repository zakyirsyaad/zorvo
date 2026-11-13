import "@testing-library/jest-dom/vitest";
import { createRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SettingsNav } from "../components/settings/SettingsNav";
import { SettingsGroup, SettingsHeader, SettingsRow } from "../components/settings/SettingsGroup";
import { StatusLine } from "../components/ui/StatusLine";

function renderNav(overrides: Partial<Parameters<typeof SettingsNav>[0]> = {}) {
  const props = { current: "general" as const, onSelect: vi.fn(), onBack: vi.fn(), updateCount: 0, ...overrides };
  render(<SettingsNav {...props} />);
  return props;
}

describe("SettingsNav", () => {
  it("the nav marks the current section", () => {
    renderNav({ current: "appearance" });
    const nav = screen.getByRole("navigation", { name: "Settings" });
    const names = within(nav).getAllByRole("link").map((link) => link.textContent);
    expect(names).toEqual(["Back to sessions", "General", "Appearance", "Agents", "GitHub"]);
    const current = within(nav).getByRole("link", { name: "Appearance" });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current).toHaveClass("bg-surface-hover", "text-fg", "font-medium");
    // 30px items with radius 8, as the canvas draws them.
    expect(current).toHaveClass("h-7.5", "rounded-lg", "px-2.5", "gap-2.5");
    expect(within(nav).getByRole("link", { name: "General" })).not.toHaveAttribute("aria-current");
  });

  it("a nav click selects without changing the URL", () => {
    const props = renderNav();
    const before = window.location.hash;
    const link = screen.getByRole("link", { name: "Appearance" });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(props.onSelect).toHaveBeenCalledWith("appearance");
    expect(event.defaultPrevented).toBe(true);
    expect(window.location.hash).toBe(before);
    fireEvent.click(screen.getByRole("link", { name: "Back to sessions" }));
    expect(props.onBack).toHaveBeenCalled();
  });

  it("the Agents link counts updates in words", () => {
    const { unmount } = render(<SettingsNav current="general" onSelect={() => {}} onBack={() => {}} updateCount={2} />);
    expect(screen.getByRole("link", { name: "Agents, 2 updates" })).toBeInTheDocument();
    unmount();
    renderNav({ updateCount: 1 });
    expect(screen.getByRole("link", { name: "Agents, 1 update" })).toBeInTheDocument();
  });

  it("shows no badge without updates", () => {
    renderNav();
    expect(screen.getByRole("link", { name: "Agents" }).textContent).toBe("Agents");
  });

  it("MCP servers shows as coming soon", () => {
    renderNav();
    expect(screen.queryByRole("link", { name: /MCP servers/ })).toBeNull();
    const item = screen.getByText("MCP servers").closest("[data-soon]") as HTMLElement;
    expect(item).toHaveTextContent("MCP servers, coming soon");
    expect(within(item).getByText("Soon")).toHaveAttribute("aria-hidden", "true");
    expect(item).not.toHaveAttribute("tabindex");
    expect(item.querySelector("a, button, [tabindex]")).toBeNull();
    const all = Array.from(screen.getByRole("navigation").querySelectorAll("a, [data-soon]"));
    const agents = all.indexOf(screen.getByRole("link", { name: "Agents" }));
    expect(all.indexOf(item)).toBe(agents + 1);
    expect(all.indexOf(screen.getByRole("link", { name: "GitHub" }))).toBe(agents + 2);
  });

  it("the hand-drawn icons match the canvas", () => {
    renderNav();
    const appearance = screen.getByRole("link", { name: "Appearance" });
    expect(appearance.querySelector('path[d="M12 3a9 9 0 0 0 0 18z"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: "GitHub" }).querySelectorAll("circle")).toHaveLength(3);
  });

  it("sits on the ground, 240px wide, with no fill or edge of its own and room for the window's buttons", () => {
    renderNav();
    const nav = screen.getByRole("navigation", { name: "Settings" });
    expect(nav).toHaveClass("w-60", "px-2", "gap-0.5");
    expect(nav.className).not.toMatch(/\bbg-|\bborder/);
    expect(nav.firstElementChild).toHaveAttribute("data-tauri-drag-region");
    expect(nav.firstElementChild).toHaveClass("h-11");
  });

  it("the update count and the Soon tag are chip-filled", () => {
    renderNav({ updateCount: 2 });
    const nav = screen.getByRole("navigation", { name: "Settings" });
    expect(within(nav).getByText("2")).toHaveClass("bg-chip", "rounded-md", "text-caption", "text-fg");
    expect(within(nav).getByText("Soon")).toHaveClass("bg-chip", "text-fg-muted");
  });
});

describe("SettingsGroup and SettingsRow", () => {
  it("a group is a labelled card of rows", () => {
    render(
      <SettingsGroup heading="Recent folders">
        <SettingsRow label="agent-desktop" description="~/developer/agent-desktop" />
        <SettingsRow label="zorvo-site" />
      </SettingsGroup>,
    );
    const region = screen.getByRole("region", { name: "Recent folders" });
    const card = region.querySelector(".rounded-xl") as HTMLElement;
    expect(card).toHaveClass("bg-surface-2", "border", "border-border");
    // A row's popover must open past the card, so the card clips nothing.
    expect(card).not.toHaveClass("overflow-hidden");
    const row = within(region).getByText("agent-desktop").closest("[data-settings-row]") as HTMLElement;
    expect(row).toHaveClass("px-4", "py-3", "gap-4", "border-b", "last:border-b-0");
    expect(within(region).getByText("~/developer/agent-desktop")).toHaveClass("text-ui-sm", "text-fg-muted");
    expect(within(region).getByText("agent-desktop")).toHaveClass("text-ui", "text-fg");
  });

  it("a tight row has the narrower gap", () => {
    render(<SettingsRow label="Tight" isTight />);
    const row = screen.getByText("Tight").closest("[data-settings-row]");
    expect(row).toHaveClass("gap-3");
    expect(row).not.toHaveClass("gap-4");
  });

  it("a compact row is the welcome screen's: 10px by 14px, its lines 1px apart, 12px before each control", () => {
    render(<SettingsRow label="Compact" description="Second line" control={<button type="button">Go</button>} isCompact />);
    const row = screen.getByText("Compact").closest("[data-settings-row]") as HTMLElement;
    expect(row).toHaveClass("px-3.5", "py-2.5", "gap-3");
    expect(row).not.toHaveClass("px-4", "py-3", "gap-4");
    expect(screen.getByText("Compact").parentElement).toHaveClass("gap-px");
    expect(screen.getByRole("button", { name: "Go" }).parentElement).toHaveClass("gap-3");
  });

  it("the header's title can take focus", () => {
    const titleRef = createRef<HTMLHeadingElement>();
    render(<SettingsHeader title="General" titleRef={titleRef}>How new sessions start.</SettingsHeader>);
    expect(titleRef.current).toBe(screen.getByRole("heading", { level: 1, name: "General" }));
    expect(titleRef.current?.tabIndex).toBe(-1);
    expect(titleRef.current).toHaveClass("text-xl", "font-semibold", "text-fg");
    expect(screen.getByText("How new sessions start.")).toHaveClass("text-ui", "text-fg-muted");
  });
});

describe("StatusLine ready", () => {
  it("ready is a still green dot", () => {
    const { container } = render(<StatusLine status="ready">Up to date</StatusLine>);
    const dot = container.querySelector("[aria-hidden]") as HTMLElement;
    expect(dot).toHaveClass("bg-status-running");
    expect(dot.className).not.toContain("animate-pulse");
  });
});
