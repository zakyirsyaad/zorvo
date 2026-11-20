import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { BrowserVisit } from "../lib/browser";
import { useLatest } from "./useLatest";

function visitsOf(value: unknown): BrowserVisit[] {
  if (!Array.isArray(value) || value.length > 30 || !value.every(item => {
    if (!item || typeof item.url !== "string" || typeof item.title !== "string" || !Number.isSafeInteger(item.visitedAt) || item.visitedAt < 0) return false;
    try {
      const url = new URL(item.url);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
  })) throw new Error("Browser history is unavailable.");
  return value as BrowserVisit[];
}

/** One device-local list; a clear invalidates older reads before replacing it. */
export function useBrowserHistory(onError: (message: string) => void) {
  const [visits, setVisits] = useState<BrowserVisit[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const latest = useLatest(onError);
  const revision = useRef(0);
  const mounted = useRef(false);
  const clearing = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const counter = revision;
    let active = true;
    const read = async () => {
      if (!active) return;
      const request = ++revision.current;
      try {
        const value = await invoke("browser_history");
        if (active && revision.current === request) { setVisits(visitsOf(value)); setFailed(false); }
      } catch (error) { if (active && revision.current === request) { setFailed(true); latest.current(String(error)); } }
    };
    const unlisten = listen("browser-history-changed", () => { void read(); })
      .catch(error => { if (mounted.current) latest.current(String(error)); return () => {}; });
    void unlisten.then(read);
    return () => {
      active = false;
      mounted.current = false;
      counter.current++;
      void unlisten.then(stop => stop());
    };
  }, [latest]);
  const clear = async () => {
    if (clearing.current) return;
    clearing.current = true;
    setBusy(true);
    revision.current++;
    try {
      await invoke("browser_history_clear");
      if (mounted.current) {
        // Invalidate any read started by an older event while clear was pending.
        revision.current++;
        const request = revision.current;
        const value = await invoke("browser_history");
        if (mounted.current && revision.current === request) { setVisits(visitsOf(value)); setFailed(false); }
      }
    } catch (error) { if (mounted.current) { setFailed(true); latest.current(String(error)); } }
    finally {
      clearing.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { visits, busy, failed, clear };
}
