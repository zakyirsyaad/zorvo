import { useState } from "react";
import { useSessionChanges, type SessionChanges } from "./useSessionChanges";
import { useDiffStats, useDiffTargets } from "./useDiffStats";
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
  /** Whether the open diff view takes the chat's place, in the view it opened in; it opens that way each time. */
  isDiffExpanded: boolean;
  /** Opens the full review in the chat's place of `forView` (what will be on screen), else of the view on screen now. */
  openDiff: (forView?: string) => void;
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
  /**
   * The Files tab's folder relative to its repository's root, with a trailing `/` ("" at the root or
   * until it loads): diff stats name repository paths, the Files tab the folder's own.
   */
  filesPrefix: string;
  /** The file open in the Files tab, relative to its folder; null shows the tree. Another folder closes it. */
  viewedFile: string | null;
  /** Opens a file in the Files tab; the inspector widens like the Terminal tab, the sidebar giving way if it must. */
  viewFile: (relative: string) => void;
  /** Back to the tree. */
  closeFile: () => void;
}

/** Where the inspector opens the first time: the changes in a repository, else the files. */
const FIRST_TABS: readonly InspectorTab[] = ["changes", "files"];

export interface InspectorLayout {
  isSidebarShown: boolean;
  /** The tabs that apply now; a tab outside them does not show, though it stays the tab. */
  offered: readonly InspectorTab[];
  /**
   * What is on screen (a session's id, a run's, a draft's with its folder): the review
   * takes the chat's place only in the view it opened in, so another one shows its own chat.
   */
  view: string;
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
  // The view whose chat the review takes the place of; any other view shows its chat, the diff beside it.
  const [expandedView, setExpandedView] = useState<string | null>(null);
  const [width, setWidth] = useInspectorWidth();
  const changes = useSessionChanges(folderPath, isRepository, turnsEnded, onError);
  const { stats: headStats, hasFailed: headStatsFailed } = useDiffStats(folderPath, isRepository, "head", changes.version, onError);
  const filesPrefix = useDiffTargets(folderPath, isRepository, changes.version, onError).targets.prefix ?? "";

  const shownTab = tab !== null && layout.offered.includes(tab) ? tab : null;

  // The file open in the Files tab, relative to its folder. Another folder closes it (adjusted in
  // render, not in an effect), so a path from the old folder never shows in the new one.
  const [viewedFile, setViewedFile] = useState<string | null>(null);
  const [viewedFolder, setViewedFolder] = useState(folderPath);
  if (viewedFolder !== folderPath) {
    setViewedFolder(folderPath);
    setViewedFile(null);
  }
  const isViewingFile = viewedFile !== null && viewedFolder === folderPath;

  /** Asks the sidebar to give way when the inspector is about to show wider than it does now, in a narrow window. */
  const makeRoom = (nextWidth: number) => {
    const shownWidth = shownInspectorWidth(shownTab, width, isViewingFile);
    if (nextWidth > shownWidth && isCrowded(window.innerWidth, nextWidth, layout.isSidebarShown)) layout.onCrowded();
  };

  const viewFile = (relative: string) => {
    if (shownTab === "files") makeRoom(shownInspectorWidth("files", width, true));
    setViewedFile(relative);
  };

  const closeDiff = () => {
    setDiffOpen(false);
    setExpandedView(null);
  };

  const show = (next: InspectorTab) => {
    // The list may be stale while its tab is not shown (an agent mid-turn): showing it reads it afresh.
    if ((next === "changes" || next === "activity") && shownTab !== next) changes.reload();
    makeRoom(shownInspectorWidth(next, width, next === "files" && isViewingFile));
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

  const openDiff = (forView?: string) => {
    // Asking for the diff again reads it afresh even while it is open.
    changes.reload();
    setDiffOpen(true);
    // The full review opens in the chat's place; Shrink, or Add to message, brings it beside the chat.
    setExpandedView(forView ?? layout.view);
    setTab(null);
  };

  const isExpandedHere = expandedView === layout.view;

  return {
    tab,
    show,
    toggle,
    close: () => setTab(null),
    isDiffOpen,
    isDiffExpanded: isDiffOpen && isExpandedHere,
    openDiff,
    closeDiff,
    toggleDiffExpanded: () => setExpandedView(isExpandedHere ? null : layout.view),
    collapseDiff: () => setExpandedView(null),
    width,
    setWidth,
    changes,
    headStats,
    headStatsFailed,
    filesPrefix,
    viewedFile: isViewingFile ? viewedFile : null,
    viewFile,
    closeFile: () => setViewedFile(null),
  };
}
