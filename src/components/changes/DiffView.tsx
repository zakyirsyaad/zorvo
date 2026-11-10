import { useEffect, useMemo, useRef, useState } from "react";
import { DiffFileList } from "./DiffFileList";
import { DiffFileSection, diffSectionId } from "./DiffFileSection";
import { DiffViewHeader } from "./DiffViewHeader";
import { ReviewCommentsBar } from "./ReviewCommentsBar";
import { useDiffTargets, useTargetStats } from "../../hooks/useDiffStats";
import { DIFF_NOT_LOADED, useFileReviews } from "../../hooks/useFileReviews";
import type { ReviewComments } from "../../hooks/useReviewComments";
import type { AddReview } from "../../hooks/useReviewWiring";
import { defaultTarget, targetOptions, type DiffTargetId } from "../../lib/diff-stats";

/** Above this many files the sections start collapsed, so a large diff does not read them all. */
const AUTO_OPEN_LIMIT = 25;

const START_LOST = "The start of this worktree is no longer in this repository.";
/** What the backend says (`checked_commit`) when git does not have the start commit; any other failure is not that. */
const BACKEND_START_LOST = "This repository does not have the start commit";

/** The empty-diff line for `target`. */
function noChangesText(target: DiffTargetId, baseName: string | undefined): string {
  if (target === "start") return "No changes since the start of this worktree.";
  return `No changes against ${target === "base" && baseName ? baseName : "HEAD"}.`;
}

export interface DiffViewProps {
  rootPath: string;
  /** Goes up whenever the session's changes were read again. */
  version: number;
  isExpanded: boolean;
  /** Shows the Expand/Shrink button; absent when the view always fills the chat area. */
  onToggleExpanded?: () => void;
  onClose: () => void;
  onError: (message: string) => void;
  /** The commit this session's worktree was made from; it offers the "start" target. */
  startCommit?: string;
  /** Opens on the start of the worktree rather than the base (a session in a compare run). */
  prefersStart?: boolean;
  /** The comments of the session on screen. Without one (a draft, a compare run's panel) no comments are offered. */
  review?: ReviewComments;
  /** Puts this session's comments in the message; the composer stays behind it. */
  addReview?: AddReview;
}

/** A whole repository's diff: one collapsible section per changed file. */
export function DiffView({
  rootPath,
  version,
  isExpanded,
  onToggleExpanded,
  onClose,
  onError,
  startCommit,
  prefersStart = false,
  review,
  addReview,
}: DiffViewProps) {
  const {
    targets,
    isLoaded: areTargetsLoaded,
    hasFailed: haveTargetsFailed,
    reload: reloadTargets,
  } = useDiffTargets(rootPath, true, version, onError);
  const [chosen, setChosen] = useState<DiffTargetId | null>(null);
  // A start commit git cannot find any more stops being offered, for as long as this view lives.
  const [isStartLost, setIsStartLost] = useState(false);
  const options = useMemo(
    () => targetOptions(targets, isStartLost ? undefined : startCommit),
    [targets, startCommit, isStartLost],
  );
  // A chosen target means nothing once it is not on offer (main checked out, start lost).
  const target = chosen && options.includes(chosen) ? chosen : defaultTarget(options, prefersStart);
  const { stats, hasFailed: hasListFailed, reload } = useTargetStats(
    rootPath,
    areTargetsLoaded,
    target,
    startCommit,
    version,
    onError,
    // Only a start commit git no longer has drops the start. Any other failure
    // (a git lock, a timeout) is reported as usual and Refresh tries it again.
    (error) => {
      if (target !== "start" || !String(error).includes(BACKEND_START_LOST)) return false;
      setIsStartLost(true);
      onError(START_LOST);
      return true;
    },
  );
  // Refresh reads every open diff again; otherwise a diff is read again only when its file changed.
  const [refreshes, setRefreshes] = useState(0);
  const refresh = () => {
    setRefreshes((n) => n + 1);
    reloadTargets();
    reload();
  };
  const panel = useRef<HTMLElement>(null);
  const focusPanel = () => panel.current?.focus({ preventScroll: true });
  const { checked, reads, adder, fileReviewFor: fileReviewOf } = useFileReviews({
    rootPath,
    review,
    addReview,
    target,
    targets,
    stats,
    startCommit,
    refreshes,
    blockedReason: haveTargetsFailed || hasListFailed ? DIFF_NOT_LOADED : undefined,
    onFocusLost: focusPanel,
  });
  const [isSearching, setIsSearching] = useState(false);
  const [search, setSearch] = useState("");
  // Each target's first list decides what starts open; after that the user's
  // choices for that target are kept, also across switching away and back.
  const [opened, setOpened] = useState<Partial<Record<DiffTargetId, ReadonlySet<string>>>>({});
  if (stats && !opened[target]) {
    setOpened((prev) => ({ ...prev, [target]: new Set(stats.length > AUTO_OPEN_LIMIT ? [] : stats.map((s) => s.path)) }));
  }
  const openPaths = opened[target] ?? null;
  const setOpenPaths = (change: (prev: ReadonlySet<string>) => ReadonlySet<string>) =>
    setOpened((prev) => {
      const current = prev[target];
      return current ? { ...prev, [target]: change(current) } : prev;
    });

  const query = search.trim().toLowerCase();
  const visible = useMemo(
    () => (stats ?? []).filter((s) => s.path.toLowerCase().includes(query)),
    [stats, query],
  );

  const toggle = (path: string) =>
    setOpenPaths((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const toggleSearch = () => {
    if (isSearching) setSearch("");
    setIsSearching(!isSearching);
  };
  const noChanges = noChangesText(target, targets.base?.name);
  const totals = useMemo(
    () =>
      stats && stats.length > 0
        ? {
            files: stats.length,
            added: stats.reduce((sum, s) => sum + s.added, 0),
            removed: stats.reduce((sum, s) => sum + s.removed, 0),
          }
        : undefined,
    [stats],
  );
  // A file chosen in the list opens, and is scrolled to once its section has rendered open.
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  // The file marked in the list: the last one picked there while it is still listed, else the first.
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const selectedPath = visible.some((s) => s.path === pickedPath) ? pickedPath : (visible[0]?.path ?? null);
  const selectFile = (path: string) => {
    setPickedPath(path);
    setOpenPaths((prev) => (prev.has(path) ? prev : new Set(prev).add(path)));
    setScrollTarget(path);
  };
  useEffect(() => {
    if (scrollTarget === null) return;
    document.getElementById(diffSectionId(rootPath, scrollTarget))?.scrollIntoView?.({ block: "start" });
    setScrollTarget(null);
  }, [scrollTarget, rootPath]);

  return (
    <aside
      ref={panel}
      aria-label="Diff view"
      tabIndex={review ? -1 : undefined}
      className={`flex h-full flex-col text-ui ${isExpanded ? "min-w-0 flex-1" : "w-1/2 min-w-[480px] shrink-0 border-l border-border"}${review ? " focus-ring" : ""}`}
    >
      <DiffViewHeader
        target={target}
        targets={targets}
        options={options}
        onTargetChange={setChosen}
        isSearching={isSearching}
        onToggleSearch={toggleSearch}
        search={search}
        onSearchChange={setSearch}
        onCollapseAll={() => setOpenPaths(() => new Set())}
        onExpandAll={() => setOpenPaths(() => new Set((stats ?? []).map((s) => s.path)))}
        onRefresh={refresh}
        isExpanded={isExpanded}
        onToggleExpanded={onToggleExpanded}
        onClose={onClose}
        totals={totals}
      />
      <div className="flex min-h-0 flex-1">
        {isExpanded && stats && stats.length > 0 && <DiffFileList stats={visible} selectedPath={selectedPath} onSelect={selectFile} />}
        <div className="min-h-0 flex-1 overflow-y-auto">
        {stats === null ? (
          <p className="px-4 py-3 text-fg-subtle">Reading the changes…</p>
        ) : stats.length === 0 ? (
          <p className="px-4 py-3 text-fg-subtle">{noChanges}</p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-3 text-fg-subtle">No files match “{search.trim()}”.</p>
        ) : (
          visible.map((stat) => (
            <DiffFileSection
              key={stat.path}
              rootPath={rootPath}
              stat={stat}
              target={target}
              startCommit={startCommit}
              version={`${refreshes}:${stat.fingerprint}`}
              isOpen={openPaths?.has(stat.path) ?? false}
              onToggle={() => toggle(stat.path)}
              review={fileReviewOf(stat.path)}
            />
          ))
        )}
        </div>
      </div>
      {review && (
        <ReviewCommentsBar
          review={review}
          adder={adder}
          checked={checked}
          target={target}
          targets={targets}
          options={options}
          reads={reads}
          listed={stats}
          onTargetChange={setChosen}
          onFocusLost={focusPanel}
        />
      )}
    </aside>
  );
}
