import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BrowserSiteInfo } from "../components/browser/BrowserToolbar";
import { useLatest } from "./useLatest";

function siteInfo(value: unknown, url: string): BrowserSiteInfo {
  if (!value || typeof value !== "object") throw new Error("Site information is unavailable.");
  const site = value as BrowserSiteInfo;
  if (site.url !== url || typeof site.host !== "string" || !["secure", "insecure", "unknown", "local"].includes(site.security) || !Number.isSafeInteger(site.cookieCount) || site.cookieCount < 0 || typeof site.agentAccess !== "boolean" || (site.clearWarning !== undefined && typeof site.clearWarning !== "string")) {
    throw new Error("The page changed. Open its site information again.");
  }
  return site;
}

export function useBrowserSiteInfo(sessionId: string, tabId: string | undefined, url: string | undefined, open: boolean, onError: (message: string) => void) {
  const [site, setSite] = useState<BrowserSiteInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const clearing = useRef(false);
  const latest = useLatest(onError);
  useEffect(() => {
    const epoch = ++generation.current;
    setSite(null);
    setBusy(false);
    if (!tabId || !url || !open) return;
    setBusy(true);
    void invoke("browser_site_info", { sessionId, tabId })
      .then(value => { if (generation.current === epoch) setSite(siteInfo(value, url)); })
      .catch(error => { if (generation.current === epoch) latest.current(String(error)); })
      .finally(() => { if (generation.current === epoch) setBusy(false); });
    return () => { generation.current = epoch + 1; };
  }, [sessionId, tabId, url, open, latest]);

  const clear = async () => {
    if (clearing.current || !open || !tabId || !url || !site || site.url !== url) return;
    const epoch = generation.current;
    clearing.current = true;
    setBusy(true);
    try {
      const value = await invoke("browser_site_clear", { sessionId, tabId, expectedUrl: url });
      if (generation.current === epoch) setSite(siteInfo(value, url));
    } catch (error) { if (generation.current === epoch) latest.current(String(error)); }
    finally {
      clearing.current = false;
      if (generation.current === epoch) setBusy(false);
    }
  };
  return { site, busy, clear };
}
