import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Globe, Plus, RefreshCw, X } from "lucide-react";
import type { BrowserTab } from "../../lib/browser";
import { IconButton } from "../ui/IconButton";

interface BrowserTabsProps {
  tabs: readonly BrowserTab[];
  activeId?: string;
  busy: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
  trailing?: ReactNode;
}

/** Closable page tabs keep their own strip above the address bar. */
export function BrowserTabs({ tabs, activeId, busy, onSelect, onClose, onNewTab, trailing }: BrowserTabsProps) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const newTab = useRef<HTMLButtonElement>(null);
  const closing = useRef<string | null>(null);
  const keyboardTarget = useRef<string | null>(null);
  useEffect(() => {
    if (busy || !closing.current || tabs.some(tab => tab.id === closing.current)) return;
    closing.current = null;
    if (activeId) buttons.current.get(activeId)?.focus();
    else newTab.current?.focus();
  }, [activeId, busy, tabs]);
  useEffect(() => {
    if (busy || !keyboardTarget.current) return;
    const target = keyboardTarget.current;
    keyboardTarget.current = null;
    const focused = document.activeElement;
    const stillInTabs = !focused || focused === document.body || [...buttons.current.values()].some(button => button === focused);
    if (activeId === target && stillInTabs) buttons.current.get(target)?.focus();
  }, [activeId, busy, tabs]);
  useEffect(() => {
    if (activeId) buttons.current.get(activeId)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeId]);
  const close = (id: string) => {
    keyboardTarget.current = null;
    if (id === activeId) closing.current = id;
    onClose(id);
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "tab" || busy || !tabs.length) return;
    const current = tabs.findIndex(tab => tab.id === activeId);
    const positions: Record<string, number> = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: tabs.length - 1 };
    if (event.key === "Delete") {
      if (activeId) close(activeId);
    } else if (event.key in positions) {
      const next = tabs[(positions[event.key] + tabs.length) % tabs.length];
      closing.current = null;
      keyboardTarget.current = next.id;
      onSelect(next.id);
    } else return;
    event.preventDefault();
  };
  return <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
      <div role="tablist" aria-label="Browser tabs" onKeyDown={keys} className="flex min-w-0 items-center gap-1">
        {tabs.map(tab => {
          const selected = tab.id === activeId;
          const label = tab.url === "about:blank" ? "New tab" : tab.title || "New tab";
          return <div key={tab.id} role="presentation" className={`flex h-7 shrink-0 items-center rounded-md ${selected ? "bg-surface-hover" : "hover:bg-surface-2"}`}>
            <button type="button" role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1} disabled={busy}
              ref={element => { if (element) buttons.current.set(tab.id, element); else buttons.current.delete(tab.id); }}
              title={tab.url === "about:blank" ? "New tab" : tab.url} onClick={() => { closing.current = null; keyboardTarget.current = null; onSelect(tab.id); }}
              className={`focus-ring flex h-7 min-w-0 max-w-52 items-center gap-1.5 rounded-md pr-1 pl-2 text-ui-sm disabled:cursor-not-allowed ${selected ? "text-fg" : "text-fg-muted enabled:hover:text-fg"}`}>
              {tab.loading ? <RefreshCw size={14} aria-hidden="true" className="shrink-0 motion-safe:animate-spin" /> : <Globe size={14} aria-hidden="true" className="shrink-0" />}
              <span className="truncate">{label}</span>
            </button>
            <IconButton label={`Close ${label} tab`} size="sm" disabled={busy} tabIndex={selected ? 0 : -1} onClick={() => close(tab.id)}><X size={12} /></IconButton>
          </div>;
        })}
      </div>
    </div>
    <IconButton ref={newTab} label="New tab" size="sm" disabled={busy} onClick={onNewTab}><Plus size={15} /></IconButton>
    <div className="ml-auto shrink-0">{trailing}</div>
  </div>;
}
