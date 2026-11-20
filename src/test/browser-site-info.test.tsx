import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BrowserToolbar, type BrowserSiteInfo } from "../components/browser/BrowserToolbar";

const site: BrowserSiteInfo = {
  url: "https://www.google.com/", host: "www.google.com", security: "secure", cookieCount: 3, agentAccess: true,
};
const active = { id: "t1", url: site.url, title: "Google", loading: false, canGoBack: true, canGoForward: false };
function props(overrides: Partial<ComponentProps<typeof BrowserToolbar>> = {}): ComponentProps<typeof BrowserToolbar> {
  return {
    tabs: [active], active, engine: "webkit", panel: "page", busy: false, overlay: "site",
    onOverlay: vi.fn(), onNavigate: vi.fn(), onAction: vi.fn(), onEngine: vi.fn(), onPanel: vi.fn(), onRevoke: vi.fn(),
    onNewTab: vi.fn(), zoomFactor: 1, onZoom: vi.fn(), onCopyLink: vi.fn(), onOpenExternal: vi.fn(), onClearHistory: vi.fn(), hasHistory: false,
    site, siteBusy: false, onClearSite: vi.fn(), ...overrides,
  };
}
afterEach(cleanup);

describe("browser site information", () => {
  it("shows the real site, connection, cookie count, blocked permissions and granted agent access", () => {
    const onClearSite = vi.fn();
    const onNavigate = vi.fn();
    render(<BrowserToolbar {...props({ onClearSite, onNavigate })} />);
    const panel = within(screen.getByRole("dialog", { name: "Site information" }));
    expect(panel.getByRole("heading", { name: "www.google.com" })).not.toBeNull();
    expect(panel.queryByText("https://www.google.com")).toBeNull();
    for (const text of ["Connection is secure", "Cookies and site data", "3 cookies in use", "Permissions are blocked", "Agent can use this page"]) {
      expect(panel.getByText(text)).not.toBeNull();
    }
    expect(panel.getByText("Camera, microphone, location, and notifications don't work in this browser.")).not.toBeNull();
    expect(panel.getByText("It can read the page, run scripts, and fill in forms.")).not.toBeNull();
    fireEvent.click(panel.getByRole("button", { name: "Clear" }));
    expect(onClearSite).toHaveBeenCalledOnce();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown", "Connection details unavailable"],
    ["insecure", "Connection is not secure"],
    ["local", "Local server"],
  ] as const)("uses the authoritative %s state without inferring security from the HTTPS address", (security, label) => {
    render(<BrowserToolbar {...props({ site: { ...site, security, agentAccess: false } })} />);
    const panel = within(screen.getByRole("dialog", { name: "Site information" }));
    expect(panel.getByText(label)).not.toBeNull();
    expect(panel.queryByText("Connection is secure")).toBeNull();
    expect(panel.getByText("Agent access is off")).not.toBeNull();
    expect(panel.queryByText("Agent can use this page")).toBeNull();
    expect(panel.getByText("Browser access requires your approval for this session.")).not.toBeNull();
  });

  it("disables clearing while data is loading and avoids showing a cached count or access status for another URL", () => {
    const onClearSite = vi.fn();
    const { rerender } = render(<BrowserToolbar {...props({ siteBusy: true, onClearSite })} />);
    expect(screen.getByRole("button", { name: "Clear" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Loading…")).not.toBeNull();
    expect(screen.queryByText("3 cookies in use")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClearSite).not.toHaveBeenCalled();
    rerender(<BrowserToolbar {...props({ site: { ...site, url: "https://previous.example/" }, onClearSite })} />);
    expect(screen.getByRole("button", { name: "Clear" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("3 cookies in use")).toBeNull();
    expect(screen.queryByText("Agent can use this page")).toBeNull();
    expect(screen.getByText("Connection details unavailable")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "www.google.com" })).not.toBeNull();
  });

  it("shows partial-clear feedback and the refreshed authoritative cookie count", () => {
    render(<BrowserToolbar {...props({ site: { ...site, cookieCount: 0, clearWarning: "Cookies were cleared. Some site data could not be removed." } })} />);
    expect(screen.getByText("0 cookies in use")).not.toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Cookies were cleared. Some site data could not be removed.");
  });

  it("keeps unsupported site information disabled for the separate Chromium window", () => {
    render(<BrowserToolbar {...props({ engine: "chromium", overlay: null })} />);
    expect(screen.getByRole("button", { name: "Site information" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("dialog", { name: "Site information" })).toBeNull();
  });
});
