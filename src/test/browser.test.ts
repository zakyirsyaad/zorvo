import { describe, expect, it } from "vitest";
import { browserAddress, readBrowserState } from "../lib/browser";
import { minInspectorWidth, offeredTabs } from "../lib/inspector";

describe("browser addresses", () => {
  it("accepts full addresses, domains and local development servers", () => {
    expect(browserAddress(" https://github.com/zakyirsyaad/zorvo ")).toBe("https://github.com/zakyirsyaad/zorvo");
    expect(browserAddress("github.com")).toBe("https://github.com/");
    expect(browserAddress("localhost:5173/docs")).toBe("http://localhost:5173/docs");
    expect(browserAddress("127.0.0.1:3000")).toBe("http://127.0.0.1:3000/");
  });
  it("rejects non-address text without sending it to a search provider", () => {
    for (const text of ["google", "react hooks", "TODO: fix login", "error: cannot find module", "python: list comprehension"]) {
      expect(() => browserAddress(text)).toThrow("Search is not configured");
    }
  });
  it("rejects local paths, non-web schemes and credentials", () => {
    for (const address of ["", "file:///etc/hosts", "javascript:alert(1)", "data:text/html,test", "https://user:pass@example.com", "/Users/me/private.txt", "~/private.txt"]) {
      expect(() => browserAddress(address)).toThrow();
    }
  });
});

it("keeps browser state within the requested session and rejects malformed tab metadata", () => {
  const state = { sessionId: "s1", tabs: [{ id: "t1", url: "https://example.com/", title: "Example", loading: false, canGoBack: false, canGoForward: false }], activeTabId: "t1" };
  expect(readBrowserState(state, "s1")).toEqual(state);
  expect(readBrowserState(state, "s2")).toBeNull();
  expect(readBrowserState({ ...state, tabs: [{ id: "t1" }] }, "s1")).toBeNull();
});

it("offers the wide Browser tab only for a session", () => {
  expect(offeredTabs({ hasFolder: true, isRepository: false, hasSession: true })).toContain("browser");
  expect(offeredTabs({ hasFolder: true, isRepository: false, hasSession: false })).not.toContain("browser");
  expect(minInspectorWidth("browser")).toBe(560);
});

it("gives colon-prefixed non-address text the local search-not-configured hint", () => {
  for (const text of ["TODO: fix login", "python: list comprehension", "error: cannot find module"]) {
    expect(() => browserAddress(text)).toThrow("Search is not configured");
  }
  expect(() => browserAddress("mailto:someone@example.com")).toThrow();
});
