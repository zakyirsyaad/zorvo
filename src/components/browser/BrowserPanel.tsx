import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, Globe } from "lucide-react";
import { useBrowser } from "../../hooks/useBrowser";
import { useBrowserView } from "../../hooks/useBrowserView";
import { useBoxCovered } from "../../hooks/useArtifactView";
import { useBrowserPicker } from "../../hooks/useBrowserPicker";
import { useBrowserSiteInfo } from "../../hooks/useBrowserSiteInfo";
import { useBrowserHistory } from "../../hooks/useBrowserHistory";
import { useLatest } from "../../hooks/useLatest";
import { browserAddress } from "../../lib/browser";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { BrowserTools } from "./BrowserTools";
import { BrowserToolbar, BROWSER_PANELS, type BrowserPanelId, type BrowserOverlay } from "./BrowserToolbar";
import { invoke } from "@tauri-apps/api/core";

interface BrowserPanelProps {
  sessionId: string;
  onError: (message: string) => void;
  onAddContext?: (text: string) => void;
  /** The browser takes the whole stage, over the chat. */
  isExpanded?: boolean;
  /** Expands the browser over the chat, or shrinks it back. */
  onToggleExpanded?: () => void;
}

export function BrowserPanel({ sessionId, onError, onAddContext, isExpanded = false, onToggleExpanded }: BrowserPanelProps) {
  const [panel, setPanel] = useState<BrowserPanelId>("page");
  const [overlay, setOverlay] = useState<BrowserOverlay>(null);
  const browser = useBrowser(sessionId, "webkit");
  const history = useBrowserHistory(onError);
  const active = browser.state.tabs.find(tab => tab.id === browser.state.activeTabId);
  const blank = !active || active.url === "about:blank";
  const site = useBrowserSiteInfo(sessionId, active?.id, active?.url, overlay === "site", onError);
  const [preview, setPreview] = useState<{ key: string; source: string } | null>(null);
  const pageKey = JSON.stringify([sessionId, active?.id, active?.url]);
  const currentPage = useLatest(pageKey);
  useEffect(() => { setPreview(null); }, [pageKey]);
  useLayoutEffect(() => { setOverlay(null); }, [pageKey]);
  const picker = useBrowserPicker({ sessionId, tab: panel === "page" && !blank ? active : undefined, onAddContext, onError });
  const boxRef = useRef<HTMLDivElement>(null);
  const covered = useBoxCovered(boxRef, panel === "page" && !blank);
  useBrowserView(boxRef, sessionId, active?.id ?? null, panel === "page" && !blank && !covered && !overlay, onError, {
    key: `${pageKey}/${overlay}`,
    covered: panel === "page" && !blank && Boolean(overlay),
    onPreview: source => { if (currentPage.current === pageKey) setPreview(source ? { key: pageKey, source } : null); },
    onCaptureFailed: () => { if (currentPage.current === pageKey) setOverlay(null); },
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const run = (args: Record<string, unknown>) => {
    setLocalError(null);
    if (["tabs.focus", "tabs.close"].includes(String(args.operation))) setPanel("page");
    void browser.execute(args).catch(() => {});
  };
  const navigate = (input: string) => {
    try {
      const url = browserAddress(input);
      setPanel("page");
      run(active ? { operation: "navigate", tabId: active.id, url } : { operation: "tabs.open", url });
    } catch (error) { setLocalError(String(error)); }
  };
  const currentPanel = BROWSER_PANELS.find(item => item.id === panel)!;
  const copyLink = () => {
    if (blank) return;
    if (!navigator.clipboard?.writeText) {
      setLocalError("The link could not be copied. Select the address and copy it.");
      return;
    }
    void navigator.clipboard.writeText(active.url).catch(error => setLocalError(String(error)));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-label="Browser"
      // Escape shrinks an expanded browser; while one of the toolbar's menus is open, it closes only the menu.
      onKeyDown={event => { if (event.key === "Escape" && isExpanded && overlay === null && !event.defaultPrevented && onToggleExpanded) onToggleExpanded(); }}>
      <BrowserToolbar tabs={browser.state.tabs} active={active} engine="webkit" panel={panel} busy={browser.busy}
        zoomFactor={active?.zoomFactor ?? 1} hasHistory={(history.visits.length > 0 || history.failed) && !history.busy}
        onNewTab={() => {
          setLocalError(null);
          setPanel("page");
          void browser.newTab().catch(() => {});
        }}
        onZoom={action => { if (active) void browser.zoom(active.id, action).catch(() => {}); }}
        onCopyLink={copyLink}
        onOpenExternal={() => { if (!blank) void invoke("open_external_url", { url: active.url }).catch(error => setLocalError(String(error))); }}
        onClearHistory={() => { void history.clear(); }}
        isExpanded={isExpanded} onToggleExpanded={onToggleExpanded}
        site={site.site} siteBusy={site.busy} onClearSite={() => void site.clear()}
        overlay={overlay} onOverlay={setOverlay} onNavigate={navigate} onAction={run}
        onPanel={setPanel}
        onSelectElement={panel === "page" && active && onAddContext ? picker.toggle : undefined} selectingElement={picker.active}
        />
      {panel !== "page" && <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1">
        <IconButton label="Back to page" size="sm" onClick={() => setPanel("page")}><ArrowLeft size={14} /></IconButton>
        <h3 className="text-ui-sm text-fg-secondary">{currentPanel.label}</h3>
      </div>}
      {(localError || browser.error) && <p role="alert" className="shrink-0 border-b border-border px-3 py-2 text-ui-sm text-danger">{localError || browser.error}</p>}
      {panel === "page" && !blank && active.blockedPopup != null && (
        <p role="status" className="shrink-0 truncate border-b border-border bg-chip px-3 py-1 text-caption text-fg-muted">
          {active.blockedPopup
            ? `This page tried to open a new window (${active.blockedPopup}).`
            : "This page tried to open a new window."}
        </p>
      )}
      <div role="region" aria-label={currentPanel.label === "Page" ? "Browser page" : currentPanel.label} className="flex min-h-0 flex-1 flex-col">
          <div ref={boxRef} className={`relative min-h-0 flex-1 ${panel === "page" ? "" : "hidden"}`} data-browser-box="">
            {preview?.key === pageKey && <img alt="" aria-hidden="true" draggable={false} src={preview.source} className="pointer-events-none absolute inset-0 h-full w-full object-fill" />}
            {blank ? <div className="flex h-full flex-col items-center justify-center gap-3 overflow-y-auto px-5 py-5 text-center text-ui-sm text-fg-muted"><Globe size={24} /><p>Enter a web address to open a page.</p>
              {history.visits.length > 0 && <div aria-label="Recent pages" className="w-full max-w-sm space-y-1 text-left"><h3 className="px-2 py-1 text-caption text-fg-muted">Recent pages</h3>{history.visits.map(visit => <Button key={visit.url} variant="ghost" size="field" align="start" className="w-full text-left" onClick={() => navigate(visit.url)}><span className="min-w-0"><span className="block truncate text-fg-secondary">{visit.title || new URL(visit.url).host}</span><span className="block truncate text-caption text-fg-muted">{visit.url}</span></span></Button>)}</div>}
            </div> : null}
          </div>
        {panel !== "page" && <BrowserTools key={`${sessionId}/webkit/${panel}`} panel={panel} sessionId={sessionId} engine="webkit" tabId={active?.id} execute={browser.execute} />}
      </div>
    </div>
  );
}
