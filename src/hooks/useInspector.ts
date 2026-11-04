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
  /** Whether the diff view shows beside the chat; apart from the tabs. */
  isDiffOpen: boolean;
  /** Whether the open diff view takes the chat's place; it opens beside the chat each time. */
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
  /** Called when the inspector opens in a window too narrow for the sidebar beside it. */
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
  const [isDiffExpanded, setDiffExpanded] = useState(false);
  const [width, setWidth] = useInspectorWidth();
  const changes = useSessionChanges(folderPath, isRepository, turnsEnded, onError);
  const { stats: headStats, hasFailed: headStatsFailed } = useDiffStats(folderPath, isRepository, "head", changes.version, onError);

  const show = (next: InspectorTab) => {
    // The list may be stale while its tab is not shown (an agent mid-turn): showing it reads it afresh.
    if ((next === "changes" || next === "activity") && tab !== next) changes.reload();
    if (tab === null && isCrowded(window.innerWidth, shownInspectorWidth(next, width), layout.isSidebarShown)) {
      layout.onCrowded();
    }
    setTab(next);
    setLastTab(next);
    layout.onShow?.(next);
  };

  const toggle = (offered: readonly InspectorTab[]) => {
    if (tab !== null && offered.includes(tab)) {
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
  };

  return {
    tab,
    show,
    toggle,
    close: () => setTab(null),
    isDiffOpen,
    isDiffExpanded: isDiffOpen && isDiffExpanded,
    openDiff,
    closeDiff: () => {
      setDiffOpen(false);
      // It opens beside the chat again next time.
      setDiffExpanded(false);
    },
    toggleDiffExpanded: () => setDiffExpanded((expanded) => !expanded),
    collapseDiff: () => setDiffExpanded(false),
    width,
    setWidth,
    changes,
    headStats,
    headStatsFailed,
  };
}
