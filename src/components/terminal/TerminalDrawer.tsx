import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { TerminalView, type TerminalViewHandle } from "../TerminalView";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { tabLabel } from "../../lib/terminal-labels";
import type { WorkspaceTerminals, WorkspaceTerminalTab } from "../../hooks/useWorkspaceTerminals";

export interface TerminalDrawerProps {
  folderPath: string;
  folderName: string;
  terminals: WorkspaceTerminals;
  /** The folder whose first shell is starting, if any: the drawer says so and focuses that shell once it is there. */
  startingFor: string | null;
  /** Starts a shell through the caller's guard against a second start in the same folder. */
  onStartShell: (folderPath: string) => Promise<string | null>;
  /** Shows a Hide terminal button; inside the inspector the inspector closes it. */
  onHide?: () => void;
}

/**
 * The shells of one folder, filling the inspector's Terminal tab. The caller keys
 * nothing on the folder: switching sessions only changes `folderPath`.
 */
export function TerminalDrawer({
  folderPath,
  folderName,
  terminals,
  startingFor,
  onStartShell,
  onHide,
}: TerminalDrawerProps) {
  const tabs = terminals.tabsFor(folderPath);
  const [activeByFolder, setActiveByFolder] = useState<Record<string, string>>({});
  // Each shell's size as xterm last fit it, for the strip's readout: none until a fit.
  const [sizes, setSizes] = useState<Record<string, { cols: number; rows: number }>>({});
  const activeTab = pickActive(tabs, activeByFolder[folderPath]);
  // The tab whose view takes keyboard focus when it mounts: set by an action in
  // the drawer (opening it, New terminal, picking a tab, Start a new shell),
  // never by a session switch. The view reads it only on mount.
  const [focusTabId, setFocusTabId] = useState<string | null>(() => pickActive(tabs, undefined)?.id ?? null);
  // The folder whose first shell was starting when the drawer last looked: that
  // shell is not in the list yet, so its tab takes focus when it appears.
  const isStarting = startingFor === folderPath && tabs.length === 0;
  const [awaitingFirst, setAwaitingFirst] = useState<string | null>(null);
  if (isStarting && awaitingFirst !== folderPath) setAwaitingFirst(folderPath);
  const focusFirst = awaitingFirst === folderPath && activeTab !== undefined;
  // After a close, focus has nowhere to stay: it goes to the tab strip, or to New terminal.
  const [restoreFocus, setRestoreFocus] = useState(false);
  const viewRef = useRef<TerminalViewHandle>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const emptyActionRef = useRef<HTMLButtonElement>(null);
  const folderRef = useRef(folderPath);
  useEffect(() => {
    folderRef.current = folderPath;
  }, [folderPath]);
  useEffect(() => {
    if (focusTabId && activeTab?.id === focusTabId) setFocusTabId(null);
  }, [focusTabId, activeTab?.id]);
  useEffect(() => {
    // Done once the tab is there, or when the start ended without one or you left the folder.
    if (awaitingFirst && (focusFirst || awaitingFirst !== folderPath || (!isStarting && tabs.length === 0))) {
      setAwaitingFirst(null);
    }
  }, [awaitingFirst, focusFirst, folderPath, isStarting, tabs.length]);
  useEffect(() => {
    if (!restoreFocus) return;
    const selected = tabListRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    (selected ?? emptyActionRef.current)?.focus();
    setRestoreFocus(false);
  }, [restoreFocus]);

  const labelOf = (tab: WorkspaceTerminalTab) => tabLabel(tab.shell, tab.number);
  const activeSize = activeTab ? sizes[activeTab.id] : undefined;

  const resizeTab = (id: string, cols: number, rows: number) => {
    setSizes((current) => (current[id]?.cols === cols && current[id]?.rows === rows ? current : { ...current, [id]: { cols, rows } }));
    terminals.resize(id, cols, rows);
  };

  const select = (id: string) => {
    setActiveByFolder((current) => ({ ...current, [folderPath]: id }));
    // The view in front is already mounted, so it is focused directly; another one mounts focused.
    if (id === activeTab?.id) viewRef.current?.focus();
    else setFocusTabId(id);
  };

  const closeTab = (id: string) => {
    terminals.close(id);
    const remaining = tabs.filter((tab) => tab.id !== id);
    const next = pickActive(remaining, undefined);
    if (id === activeTab?.id && next) setFocusTabId(next.id);
    else setRestoreFocus(true);
  };

  const openWith = async (open: (folderPath: string) => Promise<string | null>) => {
    const forFolder = folderPath;
    const id = await open(forFolder);
    if (!id) return;
    setActiveByFolder((current) => ({ ...current, [forFolder]: id }));
    // Opened for a folder you have left since: it shows without taking focus.
    if (folderRef.current === forFolder) setFocusTabId(id);
  };

  // New terminal beside the tabs may be pressed twice in a row for two shells; the
  // folder's first shell, and a restart, go through the caller's guard.
  const addShell = () => openWith(terminals.open);
  const startShell = () => openWith(onStartShell);

  // As drawn, the drawer is the terminal's own dark in both themes while it holds shells. The empty and starting
  // states are not a terminal: they keep the theme's surface, so their text and button read in light mode.
  const hasTabs = tabs.length > 0;
  return (
    <section aria-label="Terminal" className={`flex min-h-0 flex-1 flex-col ${hasTabs ? "bg-terminal-bg" : "bg-surface-1"}`}>
      {(hasTabs || onHide) && (
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-terminal-surface bg-terminal-bg pr-2 pl-3">
          <div ref={tabListRef} role="tablist" aria-label="Terminals" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <TabItem
                key={tab.id}
                label={labelOf(tab)}
                folderName={folderName}
                selected={tab.id === activeTab?.id}
                onSelect={() => select(tab.id)}
                onClose={() => closeTab(tab.id)}
              />
            ))}
            {activeTab && (
              <IconButton label="New terminal" variant="terminal" size="sm" onClick={addShell}>
                <Plus size={12} aria-hidden />
              </IconButton>
            )}
          </div>
          {activeSize && (
            <span className="shrink-0 text-caption tabular-nums text-terminal-fg-subtle">
              {activeSize.cols} × {activeSize.rows}
            </span>
          )}
          {onHide && (
            <IconButton label="Hide terminal" variant="terminal" size="sm" onClick={onHide}>
              <ChevronDown size={12} aria-hidden />
            </IconButton>
          )}
        </div>
      )}
      <div role="tabpanel" className="flex min-h-0 flex-1 flex-col">
        {activeTab ? (
          <>
            <TerminalView
              key={activeTab.id}
              ref={viewRef}
              sessionId={activeTab.id}
              output={terminals.output}
              isLive={activeTab.status === "live"}
              onInput={(data) => terminals.send(activeTab.id, data)}
              onResize={(cols, rows) => resizeTab(activeTab.id, cols, rows)}
              autoFocus={activeTab.id === focusTabId || focusFirst}
              label={`${labelOf(activeTab)} · ${folderName}`}
            />
            {activeTab.status === "exited" && (
              <div className="flex items-center gap-3 border-t border-border bg-surface-1 px-3 py-2 text-ui-sm text-fg-muted">
                <span>The shell exited.</span>
                <Button onClick={startShell}>Start a new shell</Button>
              </div>
            )}
          </>
        ) : isStarting ? (
          <div className="flex flex-1 items-center justify-center text-xs text-fg-muted">
            <p role="status">Starting a shell…</p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-xs text-fg-muted">
            <p>No terminal in {folderName}.</p>
            <Button ref={emptyActionRef} onClick={startShell}>
              New terminal
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

/** The tab you picked for the folder, else its newest one. */
function pickActive(tabs: WorkspaceTerminalTab[], pickedId: string | undefined): WorkspaceTerminalTab | undefined {
  return tabs.find((tab) => tab.id === pickedId) ?? tabs.at(-1);
}

interface TabItemProps {
  label: string;
  /** Shown on the selected tab, in mono, as drawn; every tab of the strip is in this folder. */
  folderName: string;
  selected: boolean;
  onSelect: () => void;
  onClose: () => void;
}

function TabItem({ label, folderName, selected, onSelect, onClose }: TabItemProps) {
  return (
    <div className="flex shrink-0 items-center">
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        onClick={onSelect}
        className={`focus-ring flex h-6 items-center gap-1.5 rounded-md px-2.5 text-ui-sm ${
          selected ? "bg-terminal-surface text-terminal-fg-strong" : "text-terminal-fg-muted hover:text-terminal-fg-strong"
        }`}
      >
        {label}
        {/* Seen, not read: the folder is the same for every tab here, and the terminal's own name says it. */}
        {selected && (
          <span aria-hidden="true" className="font-mono text-caption text-terminal-fg-subtle">
            {folderName}
          </span>
        )}
      </button>
      <IconButton label={`Close ${label}`} variant="terminal" size="xs" onClick={onClose}>
        <X size={12} aria-hidden />
      </IconButton>
    </div>
  );
}

