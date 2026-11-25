import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Cookie, Globe, LockKeyhole, Maximize2, Minimize2, MoreHorizontal, PanelRight, RefreshCw, ShieldOff, SlidersHorizontal, SquareMousePointer, X } from "lucide-react";
import type { BrowserEngine, BrowserTab } from "../../lib/browser";
import { IconButton } from "../ui/IconButton";
import { Button } from "../ui/Button";
import { Popover, PopoverGroup, PopoverOption } from "../ui/Popover";
import { BrowserTabs } from "./BrowserTabs";

export const BROWSER_PANELS = [
  { id: "page", label: "Page" }, { id: "console", label: "Console" },
  { id: "network", label: "Network" }, { id: "files", label: "Files" },
  { id: "performance", label: "Performance" }, { id: "debug", label: "Debug" },
] as const;
export type BrowserPanelId = typeof BROWSER_PANELS[number]["id"];
export type BrowserOverlay = "options" | "site" | "tools" | null;

export interface BrowserSiteInfo {
  url: string;
  host: string;
  security: "secure" | "insecure" | "unknown" | "local";
  cookieCount: number;
  agentAccess: boolean;
  clearWarning?: string;
}

interface BrowserToolbarProps {
  tabs: BrowserTab[];
  active?: BrowserTab;
  engine: BrowserEngine;
  panel: BrowserPanelId;
  busy: boolean;
  overlay: BrowserOverlay;
  onOverlay: (overlay: BrowserOverlay) => void;
  onNavigate: (value: string) => void;
  onAction: (args: Record<string, unknown>) => void;
  onEngine: (engine: BrowserEngine) => void;
  onPanel: (panel: BrowserPanelId) => void;
  onRevoke: () => void;
  onSelectElement?: () => void;
  selectingElement?: boolean;
  site: BrowserSiteInfo | null;
  siteBusy: boolean;
  onClearSite: () => void;
  onNewTab: () => void;
  zoomFactor: number;
  onZoom: (direction: "in" | "out" | "reset") => void;
  onCopyLink: () => void;
  onOpenExternal: () => void;
  onClearHistory: () => void;
  hasHistory: boolean;
  /** The browser takes the whole stage, over the chat. */
  isExpanded?: boolean;
  /** Expands the browser over the chat, or shrinks it back; absent, there is no Expand. */
  onToggleExpanded?: () => void;
}

function menuKeys(event: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])'));
  if (!items.length) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
    : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
  event.preventDefault();
}

/** Page tabs sit above navigation; the page menu and diagnostic tools have separate controls. */
export function BrowserToolbar({ tabs, active, engine, panel, busy, overlay, onOverlay, onNavigate, onAction, onEngine, onPanel, onRevoke, onSelectElement, selectingElement, site, siteBusy, onClearSite, onNewTab, zoomFactor, onZoom, onCopyLink, onOpenExternal, onClearHistory, hasHistory, isExpanded = false, onToggleExpanded }: BrowserToolbarProps) {
  const menu = useRef<HTMLDivElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  const choose = (action: () => void) => { onOverlay(null); action(); };
  const pageSite = site?.url === active?.url ? site : null;
  const reachable = Boolean(active && /^https?:\/\//i.test(active.url));
  const canZoom = !busy && reachable && engine === "webkit";
  const zoomed = Math.abs(zoomFactor - 1) > 0.001;
  let hostname = "No page open";
  try { if (reachable && active) hostname = new URL(active.url).host; } catch { /* A loading tab may not have a web address yet. */ }
  const connection = pageSite?.security === "secure" ? "Connection is secure"
    : pageSite?.security === "insecure" ? "Connection is not secure"
    : pageSite?.security === "local" ? "Local server" : "Connection details unavailable";
  return <div className="shrink-0">
    <BrowserTabs tabs={tabs} activeId={active?.id} busy={busy}
      onSelect={id => onAction({ operation: "tabs.focus", tabId: id })}
      onClose={id => onAction({ operation: "tabs.close", tabId: id })}
      onNewTab={() => choose(onNewTab)}
      trailing={<div className="flex items-center gap-0.5">
        {onToggleExpanded && <IconButton label={isExpanded ? "Shrink browser" : "Expand browser"} size="sm" onClick={onToggleExpanded}>
          {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </IconButton>}
        <Popover isOpen={overlay === "tools"} onClose={() => onOverlay(null)} align="end" label="Browser tools" className="w-56"
        trigger={<IconButton label="Browser tools" size="sm" aria-haspopup="menu" aria-expanded={overlay === "tools"} onClick={() => onOverlay(overlay === "tools" ? null : "tools")}
          onKeyDown={event => {
            if (event.key !== "ArrowDown") return;
            event.preventDefault();
            onOverlay("tools");
            requestAnimationFrame(() => tools.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')?.focus());
          }}><PanelRight size={14} /></IconButton>}>
        <div ref={tools} onKeyDown={menuKeys}>
          <PopoverGroup heading="Tools">{BROWSER_PANELS.map(item => <PopoverOption key={item.id} isRadio selected={item.id === panel} onSelect={() => choose(() => onPanel(item.id))}>{item.label}</PopoverOption>)}</PopoverGroup>
          <PopoverGroup heading="Browser engine">
            <PopoverOption isRadio selected={engine === "webkit"} onSelect={() => choose(() => onEngine("webkit"))}>WebKit</PopoverOption>
            <PopoverOption isRadio selected={engine === "chromium"} onSelect={() => choose(() => onEngine("chromium"))}>Chromium debug</PopoverOption>
          </PopoverGroup>
          <div role="separator" className="my-1 border-t border-border" />
          <PopoverOption onSelect={() => choose(onRevoke)}>Revoke browser access</PopoverOption>
        </div>
      </Popover>
      </div>} />
    <div role="toolbar" aria-label="Browser navigation" className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3 [&_svg]:stroke-1">
    <div className="flex shrink-0 items-center">
      <IconButton label="Navigate back" size="md" disabled={busy || !active?.canGoBack} onClick={() => onAction({ operation: "back", tabId: active?.id })}><ArrowLeft size={16} /></IconButton>
      <IconButton label="Navigate forward" size="md" disabled={busy || !active?.canGoForward} onClick={() => onAction({ operation: "forward", tabId: active?.id })}><ArrowRight size={16} /></IconButton>
      <IconButton label={active?.loading ? "Stop loading" : "Reload page"} size="md" disabled={!active} onClick={() => onAction({ operation: active?.loading ? "stop" : "reload", tabId: active?.id })}>
        {active?.loading ? <X size={16} /> : <RefreshCw size={16} />}
      </IconButton>
    </div>
    <Address key={`${engine}/${active?.id ?? "new"}/${active?.url ?? ""}`} tab={active} onNavigate={onNavigate}
      zoom={zoomed && reachable ? <Button variant="ghost" size="sm" aria-label={`Reset page zoom (${Math.round(zoomFactor * 100)}%)`} disabled={!canZoom}
        onClick={() => onZoom("reset")} className="shrink-0">{Math.round(zoomFactor * 100)}%</Button> : null}
      siteButton={<Popover isOpen={overlay === "site"} onClose={() => onOverlay(null)} role="dialog" label="Site information" className="w-[261px]"
        trigger={<IconButton label="Site information" size="xs" disabled={!reachable || engine !== "webkit"} aria-haspopup="dialog" aria-expanded={overlay === "site"} onClick={() => onOverlay(overlay === "site" ? null : "site")}><SlidersHorizontal size={13} /></IconButton>}>
        <h2 className="flex items-center gap-2 px-2 py-1 text-ui font-normal text-fg"><Globe size={16} aria-hidden="true" className="shrink-0 text-fg-muted" /><span className="truncate">{pageSite?.host || hostname}</span></h2>
        <div role="separator" className="my-1 border-t border-border" />
        <div className="space-y-0.5 text-ui text-fg-secondary">
          <p className="flex items-center gap-2 px-2 py-1"><LockKeyhole size={16} aria-hidden="true" className="shrink-0 text-fg-muted" />{connection}</p>
          <div className="flex items-start gap-2 px-2 py-1"><Cookie size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-fg-muted" /><div className="min-w-0 flex-1">Cookies and site data
            <p className="mt-1 text-caption text-fg-muted">{pageSite && !siteBusy ? `${pageSite.cookieCount} cookies in use` : "Loading…"}</p></div>
            <Button size="sm" disabled={busy || siteBusy || !pageSite} onClick={onClearSite}>Clear</Button>
          </div>
          {pageSite?.clearWarning && <p role="status" className="px-2 py-1 text-caption text-fg-muted">{pageSite.clearWarning}</p>}
          <div className="flex items-start gap-2 px-2 py-1"><ShieldOff size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-fg-muted" /><div>Permissions are blocked<p className="mt-1 text-caption text-fg-muted">Camera, microphone, location, and notifications don&apos;t work in this browser.</p></div></div>
          <div className="flex items-start gap-2 px-2 py-1"><SquareMousePointer size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-fg-muted" /><div>{!pageSite ? "Checking agent access…" : pageSite.agentAccess ? "Agent can use this page" : "Agent access is off"}
            <p className="mt-1 text-caption text-fg-muted">{pageSite?.agentAccess ? "It can read the page, run scripts, and fill in forms." : "Browser access requires your approval for this session."}</p></div></div>
        </div>
      </Popover>} />
    <div className="flex shrink-0 items-center">
      <IconButton label="Select an element to comment on" size="md" disabled={busy || !active || !onSelectElement} aria-pressed={Boolean(selectingElement)} onClick={onSelectElement}><SquareMousePointer size={16} /></IconButton>
      <Popover isOpen={overlay === "options"} onClose={() => onOverlay(null)} align="end" label="Browser options" className="w-44"
        trigger={<IconButton label="Browser options" size="md" aria-haspopup="menu" aria-expanded={overlay === "options"} onClick={() => onOverlay(overlay === "options" ? null : "options")}
          onKeyDown={event => {
            if (event.key !== "ArrowDown") return;
            event.preventDefault();
            onOverlay("options");
            requestAnimationFrame(() => menu.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')?.focus());
          }}><MoreHorizontal size={16} /></IconButton>}>
        <div ref={menu} onKeyDown={menuKeys}>
          <PopoverOption disabled={!canZoom || zoomFactor >= 5} onSelect={() => choose(() => onZoom("in"))}>Zoom in</PopoverOption>
          <PopoverOption disabled={!canZoom || zoomFactor <= 0.25} onSelect={() => choose(() => onZoom("out"))}>Zoom out</PopoverOption>
          <PopoverOption disabled={!canZoom || !zoomed} onSelect={() => choose(() => onZoom("reset"))}>Reset zoom</PopoverOption>
          <div role="separator" className="my-1 border-t border-border" />
          <PopoverOption disabled={!reachable} onSelect={() => choose(onCopyLink)}>Copy link</PopoverOption>
          <PopoverOption disabled={!reachable} onSelect={() => choose(onOpenExternal)}>Open in browser</PopoverOption>
          <div role="separator" className="my-1 border-t border-border" />
          <PopoverOption disabled={!hasHistory} onSelect={() => choose(onClearHistory)}>Clear history</PopoverOption>
        </div>
      </Popover>
    </div>
    </div>
  </div>;
}

function Address({ tab, onNavigate, siteButton, zoom }: { tab: BrowserTab | undefined; onNavigate: (value: string) => void; siteButton: ReactNode; zoom: ReactNode }) {
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const url = tab?.url === "about:blank" ? "" : tab?.url ?? "";
  useEffect(() => { if (tab?.url === "about:blank") input.current?.focus(); }, [tab?.id, tab?.url]);
  const editing = draft !== null;
  const parts = /^([a-z][a-z\d+.-]*:\/\/)?([^/?#]*)(.*)$/is.exec(url);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onNavigate(draft ?? url);
    setDraft(null);
    input.current?.blur();
  };
  return <form onSubmit={submit} className="relative flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md bg-surface-2 pr-2 pl-1 focus-ring-within hover:bg-surface-hover">
    {siteButton}
    <div className="relative h-full min-w-0 flex-1">
      <input ref={input} aria-label="Address or search" value={draft ?? url} placeholder="Search or enter a URL"
        autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false}
        onFocus={event => { setDraft(url); event.currentTarget.select(); }} onBlur={() => setDraft(null)}
        onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Escape") input.current?.blur(); }}
        className={`absolute inset-0 h-full w-full min-w-0 bg-transparent text-ui outline-none ${editing || !url ? "text-fg" : "text-transparent"}`} />
      {!editing && url && <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre text-ui"><span className="truncate text-fg-muted">{parts?.[1]}<span className="text-fg">{parts?.[2]}</span>{parts?.[3]}</span></div>}
    </div>
    {zoom}
  </form>;
}
