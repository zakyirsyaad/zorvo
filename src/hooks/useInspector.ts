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
  /** Closes an open inspector, or opens it on the last tab used. */
  toggle: () => void;
  close: () => void;
  /** Whether the full diff review takes the chat's place; apart from the tabs. */
  isDiffOpen: boolean;
  openDiff: () => void;
  closeDiff: () => void;
  /** The remembered width, clamped to its bounds. */
  width: number;
  setWidth: (px: number) => void;
  /** The uncommitted changes in the session's repository, for the Changes tab and its count. */
  changes: SessionChanges;
  /** Per-file line counts against HEAD, for the diff-stat chip; null until the first read. */
  headStats: FileStat[] | null;
  headStatsFailed: boolean;
}

export interface InspectorLayout {
  isSidebarShown: boolean;
  /** Called when the inspector opens in a window too narrow for the sidebar beside it. */
  onCrowded: () => void;
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
  };

  const toggle = () => {
    if (tab !== null) {
      setTab(null);
      return;
    }
    show(lastTab ?? (isRepository ? "changes" : "files"));
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
    openDiff,
    closeDiff: () => setDiffOpen(false),
    width,
    setWidth,
    changes,
    headStats,
    headStatsFailed,
  };
}
