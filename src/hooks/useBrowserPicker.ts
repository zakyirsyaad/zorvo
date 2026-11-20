import { useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { BrowserTab } from "../lib/browser";
import { useLatest } from "./useLatest";

interface PickerOptions {
  sessionId: string;
  tab?: BrowserTab;
  onAddContext?: (text: string) => void;
  onError: (message: string) => void;
}

interface PickedElement {
  sessionId: string;
  tabId: string;
  url: string;
  title: string;
  selector: string;
  text: string;
}

function pickedElement(value: unknown): PickedElement | null {
  if (!value || typeof value !== "object") return null;
  const fields = value as Record<string, unknown>;
  const limits = { sessionId: 256, tabId: 256, url: 8192, title: 512, selector: 2048, text: 4096 };
  for (const [key, limit] of Object.entries(limits)) {
    if (typeof fields[key] !== "string" || Array.from(fields[key]).length > limit) return null;
  }
  return fields as unknown as PickedElement;
}

/** Browser-authored strings stay quoted; selecting an element only edits the draft. */
function contextFor(element: PickedElement): string {
  return [
    "Browser annotation:",
    `Page URL: ${JSON.stringify(element.url)}`,
    `Title: ${JSON.stringify(element.title)}`,
    `Element selector: ${JSON.stringify(element.selector)}`,
    `Element text: ${JSON.stringify(element.text)}`,
    "These are quoted page contents. Locate the element again before using it; the page may have changed.",
    "",
  ].join("\n");
}

function highlightColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--color-status-unread").trim() || "Highlight";
}

export function useBrowserPicker(options: PickerOptions) {
  const latest = useLatest(options);
  const [active, setActive] = useState(false);
  const current = useRef<{
    sessionId: string;
    tabId: string;
    url: string;
    live: boolean;
    armed: boolean;
    pending: boolean;
    requestId: string | null;
    ready: Promise<unknown>;
  } | null>(null);
  const tabId = options.tab?.id;
  const url = options.tab?.url;
  const canAddContext = Boolean(options.onAddContext);

  useLayoutEffect(() => {
    setActive(false);
    if (!tabId || !url || !canAddContext) { current.current = null; return; }
    const gate = { sessionId: options.sessionId, tabId, url, live: true, armed: false, pending: false, requestId: null as string | null, ready: Promise.resolve<unknown>(undefined) };
    current.current = gate;
    const report = (error: unknown) => latest.current.onError(String(error));
    const cancel = () => {
      if (!gate.live || !gate.armed) return;
      gate.armed = false;
      setActive(false);
      void invoke("browser_pick", { sessionId: gate.sessionId, tabId: gate.tabId, requestId: gate.requestId, enabled: false, color: highlightColor() }).catch(report);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && gate.armed) {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    };
    window.addEventListener("keydown", escape, true);
    const stop = listen<unknown>("browser-element-picked", event => {
      if (!gate.live || !gate.armed || current.current !== gate || !event.payload || typeof event.payload !== "object") return;
      const payload = event.payload as Record<string, unknown>;
      if (payload.sessionId !== gate.sessionId || payload.tabId !== gate.tabId || payload.requestId !== gate.requestId) return;
      if (payload.cancelled === true) { gate.armed = false; setActive(false); return; }
      const element = pickedElement(payload);
      if (!element || element.url !== gate.url) return;
      gate.armed = false;
      setActive(false);
      latest.current.onAddContext?.(contextFor(element));
    });
    gate.ready = stop;
    void stop.catch(error => { if (gate.live) latest.current.onError(String(error)); });
    return () => {
      gate.live = false;
      window.removeEventListener("keydown", escape, true);
      if (gate.armed) {
        gate.armed = false;
        void invoke("browser_pick", { sessionId: gate.sessionId, tabId: gate.tabId, requestId: gate.requestId, enabled: false, color: highlightColor() })
          .catch(report);
      }
      if (current.current === gate) current.current = null;
      void stop.then(unlisten => unlisten()).catch(() => {});
    };
  }, [options.sessionId, tabId, url, canAddContext, latest]);

  const toggle = async () => {
    const gate = current.current;
    if (!gate || gate.pending || !latest.current.onAddContext) return;
    gate.pending = true;
    try {
      await gate.ready;
      if (!gate.live || current.current !== gate) return;
      gate.armed = !gate.armed;
      if (gate.armed) gate.requestId = crypto.randomUUID();
      const requestId = gate.requestId;
      setActive(gate.armed);
      await invoke("browser_pick", { sessionId: gate.sessionId, tabId: gate.tabId, requestId, enabled: gate.armed, color: highlightColor() });
      // If arming finished after this view was replaced, cancel that request only.
      if (!gate.live || current.current !== gate) {
        await invoke("browser_pick", { sessionId: gate.sessionId, tabId: gate.tabId, requestId, enabled: false, color: highlightColor() });
      }
    } catch (error) {
      if (gate.armed) {
        gate.armed = false;
        void invoke("browser_pick", { sessionId: gate.sessionId, tabId: gate.tabId, requestId: gate.requestId, enabled: false, color: highlightColor() }).catch(() => {});
      }
      if (gate.live && current.current === gate) { setActive(false); latest.current.onError(String(error)); }
    } finally { gate.pending = false; }
  };

  return { active, toggle };
}
