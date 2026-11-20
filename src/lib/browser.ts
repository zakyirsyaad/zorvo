export type BrowserEngine = "webkit";

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  zoomFactor?: number;
}

export interface BrowserVisit {
  url: string;
  title: string;
  visitedAt: number;
}

export interface BrowserSessionState {
  sessionId: string;
  tabs: BrowserTab[];
  activeTabId: string | null;
}

/** Address-bar text must identify a web destination; it is never sent to a search provider. */
export function browserAddress(input: string): string {
  const text = input.trim();
  if (!text) throw new Error("Enter an HTTP or HTTPS address.");
  if (/^(?:\/|~\/|[a-z]:[\\/])/i.test(text)) throw new Error("Use the Files tab to open a local path.");
  // "TODO: fix login" starts like a scheme too; an address has no white space after it.
  const hasScheme = /^https?:\/\//i.test(text) || (/^[a-z][a-z\d+.-]*:/i.test(text) && !/\s/.test(text));
  if (hasScheme && !/^localhost:\d/i.test(text) && !/^[\w.-]+:\d+(?:\/|$)/.test(text)) {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS pages can open here.");
    if (url.username || url.password) throw new Error("Remove credentials from the address.");
    return url.href;
  }
  if (!/\s/.test(text) && (/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(?::\d+)?(?:\/|$)/i.test(text) || /^[\w-]+(?:\.[\w-]+)+(?::\d+)?(?:[/?#]|$)/.test(text))) {
    return new URL((/^(localhost|127\.|\[::1\])/i.test(text) ? "http://" : "https://") + text).href;
  }
  throw new Error("Enter a complete web address, such as example.com or http://localhost:3000. Search is not configured.");
}

export const BROWSER_OPEN = "zorvo:browser-open";

/** A direct link action handled by the window's active session, never by ACP. */
export function requestBrowserOpen(url: string): void {
  window.dispatchEvent(new CustomEvent(BROWSER_OPEN, { detail: { url } }));
}

export function readBrowserState(value: unknown, sessionId: string): BrowserSessionState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<BrowserSessionState>;
  if (state.sessionId !== sessionId || !Array.isArray(state.tabs) ||
    !(state.activeTabId === null || typeof state.activeTabId === "string")) return null;
  const valid = state.tabs.every(tab => tab && typeof tab.id === "string" && typeof tab.url === "string" &&
    typeof tab.title === "string" && typeof tab.loading === "boolean" &&
    typeof tab.canGoBack === "boolean" && typeof tab.canGoForward === "boolean" &&
    (tab.zoomFactor === undefined || (typeof tab.zoomFactor === "number" && Number.isFinite(tab.zoomFactor) && tab.zoomFactor > 0)));
  return valid ? state as BrowserSessionState : null;
}
