import { useState } from "react";
import { useSessionChanges, type SessionChanges } from "./useSessionChanges";
import { useDiffStats } from "./useDiffStats";
import { useInspectorWidth } from "./useInspectorWidth";
import { isCrowded, shownInspectorWidth, type InspectorTab } from "../lib/inspector";
import type { FileStat } from "../lib/diff-stats";

export interface InspectorState {
  /** The tab shown in the inspector; null while it is closed. */
  tab: InspectorTab | null;
  /** Shows a tab, opening the inspector if it is closed; unlike `toggle` it never closes it. */
  show: (tab: InspectorTab) => void;
  /**
   * Closes an inspector that shows one of `offered`, or opens it on the last tab
   * used while that is still offered, else on Changes, else on Files, else on the first offered tab.
   */
  toggle: (offered: readonly InspectorTab[]) => void;
  close: () => void;
  /** Whether the diff view shows; it takes the inspector's place, so opening one closes the other. */
  isDiffOpen: boolean;
  /** Whether the open diff view takes the chat's place, in the folder it was expanded in; it opens beside the chat each time. */
  isDiffExpanded: boolean;
  openDiff: () => void;
  closeDiff: () => void;
  toggleDiffExpanded: () => void;
  /** Brings the diff view back beside the chat, where the composer shows. */
  collapseDiff: () => void;
  /** The remembered width, clamped to its bounds. */
  width: number;
  setWidth: (px: number) => void;
  /** The uncommitted changes in the session's repository, for the Changes tab and its count. */
  changes: SessionChanges;
  /** Per-file line counts against HEAD, for the diff-stat chip; null until the first read. */
  headStats: FileStat[] | null;
  headStatsFailed: boolean;
}

/** Where the inspector opens the first time: the changes in a repository, else the files. */
const FIRST_TABS: readonly InspectorTab[] = ["changes", "files"];

export interface InspectorLayout {
  isSidebarShown: boolean;
  /** The tabs that apply now; a tab outside them does not show, though it stays the tab. */
  offered: readonly InspectorTab[];
  /** Called when the inspector shows wider than before in a window too narrow for the sidebar beside it. */
  onCrowded: () => void;
  /** Called whenever a tab shows, in the click that shows it (the Terminal tab starts its first shell there). */
  onShow?: (tab: InspectorTab) => void;
}

/**
 * The inspector beside the chat, its width, the full diff review, and the
 * changes they show, read again whenever `turnsEnded` changes.
 */
export function useInspector(
  folderPath: string | undefined,
  isRepository: boolean,
  turnsEnded: number,
  onError: (message: string) => void,
  layout: InspectorLayout,
): InspectorState {
  const [tab, setTab] = useState<InspectorTab | null>(null);
  const [lastTab, setLastTab] = useState<InspectorTab | null>(null);
  const [isDiffOpen, setDiffOpen] = useState(false);
  // The folder whose diff takes the chat's place, so another folder's diff opens beside its chat.
  const [expandedFolder, setExpandedFolder] = useState<string | null>(null);
  const [width, setWidth] = useInspectorWidth();
  const changes = useSessionChanges(folderPath, isRepository, turnsEnded, onError);
  const { stats: headStats, hasFailed: headStatsFailed } = useDiffStats(folderPath, isRepository, "head", changes.version, onError);

  const shownTab = tab !== null && layout.offered.includes(tab) ? tab : null;

  const closeDiff = () => {
    setDiffOpen(false);
    // It opens beside the chat again next time.
    setExpandedFolder(null);
  };

  const show = (next: InspectorTab) => {
    // The list may be stale while its tab is not shown (an agent mid-turn): showing it reads it afresh.
    if ((next === "changes" || next === "activity") && shownTab !== next) changes.reload();
    const nextWidth = shownInspectorWidth(next, width);
    if (nextWidth > shownInspectorWidth(shownTab, width) && isCrowded(window.innerWidth, nextWidth, layout.isSidebarShown)) {
      layout.onCrowded();
    }
    // The diff and the inspector share the room beside the chat: one shows at a time.
    closeDiff();
    setTab(next);
    setLastTab(next);
    layout.onShow?.(next);
  };

  const toggle = (offered: readonly InspectorTab[]) => {
    if (shownTab !== null && offered.includes(shownTab)) {
      setTab(null);
      return;
    }
    const next =
      (lastTab && offered.includes(lastTab) ? lastTab : undefined) ??
      FIRST_TABS.find((candidate) => offered.includes(candidate)) ??
      offered[0];
    if (next) show(next);
  };

  const openDiff = () => {
    // Asking for the diff again reads it afresh even while it is open.
    changes.reload();
    setDiffOpen(true);
    setTab(null);
  };

  const isExpandedHere = folderPath !== undefined && expandedFolder === folderPath;

  return {
    tab,
    show,
    toggle,
    close: () => setTab(null),
    isDiffOpen,
    isDiffExpanded: isDiffOpen && isExpandedHere,
    openDiff,
    closeDiff,
    toggleDiffExpanded: () => setExpandedFolder(isExpandedHere ? null : (folderPath ?? null)),
    collapseDiff: () => setExpandedFolder(null),
    width,
    setWidth,
    changes,
    headStats,
    headStatsFailed,
  };
}
