import { ChevronLeft, ChevronRight, GitBranch, MoreHorizontal, PanelLeft, PanelRight } from "lucide-react";
import { useState, type Ref } from "react";
import { Chip } from "./ui/Chip";
import { IconButton } from "./ui/IconButton";
import { Popover, PopoverOption } from "./ui/Popover";
import { RenameField } from "./ui/RenameField";
import { DiffStatChip } from "./changes/DiffStatChip";
import { BackgroundTasksMenu, type BackgroundTasksMenuProps } from "./topbar/BackgroundTasksMenu";
import { PlanMenu } from "./topbar/PlanMenu";
import { PullRequestChip } from "./topbar/PullRequestChip";
import type { PullRequestStatus } from "../hooks/usePullRequest";
import type { PlanEntry } from "../types";

/**
 * Left inset reserved for the native macOS traffic lights.
 *
 * The window uses `titleBarStyle: Overlay` with a hidden title, so the real
 * close/minimise/zoom buttons float over this header. Nothing may be rendered
 * under them, and the inset replaces the fake circles that used to stand in for
 * them. The value is wider than the buttons themselves so a click just past
 * them does not hit an interactive control.
 */
export const TOP_BAR_TRAFFIC_LIGHT_INSET_PX = 78;

/**
 * The session's title. With `onRename`, a double-click turns it into a field;
 * then it is not a drag region, since a double-click there would zoom the window.
 */
function SessionTitle({ name, isRenaming, onRename, onStartRename, onEndRename }: {
  name: string;
  isRenaming: boolean;
  onRename?: (name: string) => void;
  onStartRename: () => void;
  onEndRename: () => void;
}) {
  if (isRenaming && onRename) {
    return (
      <RenameField
        value={name}
        label={`Rename ${name}`}
        className="max-w-64"
        onDone={(next) => {
          onEndRename();
          const trimmed = next?.trim();
          if (trimmed && trimmed !== name) onRename(trimmed);
        }}
      />
    );
  }
  return (
    <span
      data-tauri-drag-region={onRename ? undefined : true}
      title={onRename ? "Double-click to rename" : undefined}
      onDoubleClick={onRename ? onStartRename : undefined}
      className="truncate text-ui font-medium text-fg-secondary"
    >
      {name}
    </span>
  );
}

/** The session's menu: Open in new window, Open in Finder, Rename, Archive, each only when it applies. */
function MoreOptionsMenu({ onPopout, onReveal, onRename, onArchive }: {
  onPopout?: () => void;
  onReveal?: () => void;
  onRename?: () => void;
  onArchive?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const items = [
    { label: "Open in new window", run: onPopout },
    { label: "Open in Finder", run: onReveal },
    { label: "Rename", run: onRename },
    { label: "Archive", run: onArchive },
  ].filter((item): item is { label: string; run: () => void } => Boolean(item.run));
  if (items.length === 0) return null;
  return (
    <Popover
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      label="More options"
      align="end"
      className="min-w-48"
      trigger={
        <IconButton label="More options" aria-haspopup="menu" aria-expanded={isOpen} onClick={() => setIsOpen((open) => !open)}>
          <MoreHorizontal size={15} />
        </IconButton>
      }
    >
      {items.map((item) => (
        <PopoverOption
          key={item.label}
          onSelect={() => {
            setIsOpen(false);
            item.run();
          }}
        >
          {item.label}
        </PopoverOption>
      ))}
    </Popover>
  );
}

export interface TopBarProps {
  /** Which session the bar shows; a rename field closes when it changes. */
  sessionId?: string;
  sessionName?: string;
  /** Renames the session; the title then opens a field on double-click, and the menu offers Rename. */
  onRename?: (name: string) => void;
  /** The title while no session is open (a new-session draft's folder). */
  workspaceName?: string;
  /** The workspace's git branch, shown as a chip when it is a repository. */
  branch?: string;
  /** The branch's pull request, with a chip that opens it; none when absent. */
  pullRequest?: PullRequestStatus | null;
  onOpenPullRequest?: (url: string) => void;
  /** Set while the sidebar is hidden: its show button, then Back and Forward, lead the bar. */
  onShowSidebar?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onBack?: () => void;
  onForward?: () => void;
  /** Opens this session in its own window, from the menu. */
  onPopout?: () => void;
  /** Opens the session's folder in Finder, from the menu. */
  onReveal?: () => void;
  /** Archives the session, from the menu. */
  onArchive?: () => void;
  /** Opens or closes the inspector (changes, activity, files, terminal); the button is hidden when absent. */
  onToggleInspector?: () => void;
  isInspectorOpen?: boolean;
  /** The Inspector button, which takes focus back when the inspector closes from its own button. */
  inspectorButtonRef?: Ref<HTMLButtonElement>;
  /** Lines added and removed against HEAD, shown as a chip beside the button once known. */
  diffStats?: { added: number; removed: number };
  /** Keeps the chip on screen at 0/0: the session has committed work or comments to open the diff for. */
  isDiffAlwaysShown?: boolean;
  /** Review comments on the session, counted on the chip. */
  diffCommentCount?: number;
  /** Opens the diff view; the chip opens it. */
  onOpenDiff?: () => void;
  /** What is running in the background; the menu is hidden when absent. */
  backgroundTasks?: BackgroundTasksMenuProps;
  /** The session's current plan; the menu is hidden when it has none. */
  plan?: readonly PlanEntry[];
  /** The agent the plan comes from ("Plan from Claude Code"). */
  planSource?: string;
}

export function TopBar({
  sessionId,
  sessionName,
  onRename,
  workspaceName,
  branch,
  pullRequest,
  onOpenPullRequest,
  onShowSidebar,
  canGoBack = false,
  canGoForward = false,
  onBack,
  onForward,
  onPopout,
  onReveal,
  onArchive,
  onToggleInspector,
  isInspectorOpen = false,
  inspectorButtonRef,
  diffStats,
  isDiffAlwaysShown = false,
  diffCommentCount,
  onOpenDiff,
  backgroundTasks,
  plan,
  planSource,
}: TopBarProps) {
  // The session whose title is a field; another session showing closes it.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const titleKey = sessionId ?? "";
  const isRenaming = renamingId === titleKey;
  const title = sessionName ?? workspaceName;

  return (
    <header
      data-tauri-drag-region
      style={{ paddingLeft: TOP_BAR_TRAFFIC_LIGHT_INSET_PX }}
      className="flex h-11 w-full items-center gap-3 border-b border-border bg-bg px-3.5 text-xs select-none"
    >
      {/* Left: with the sidebar hidden, its show button and the session history; then what is open. */}
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-2">
        {onShowSidebar && (
          <div className="flex shrink-0 items-center gap-0.5 text-fg-subtle">
            <IconButton label="Show sidebar" onClick={onShowSidebar}>
              <PanelLeft size={14} />
            </IconButton>
            <IconButton label="Back" onClick={canGoBack ? onBack : undefined} disabled={!canGoBack}>
              <ChevronLeft size={15} />
            </IconButton>
            <IconButton label="Forward" onClick={canGoForward ? onForward : undefined} disabled={!canGoForward}>
              <ChevronRight size={15} />
            </IconButton>
          </div>
        )}
        {sessionName ? (
          <SessionTitle
            name={sessionName}
            isRenaming={isRenaming}
            onRename={onRename}
            onStartRename={() => setRenamingId(titleKey)}
            onEndRename={() => setRenamingId(null)}
          />
        ) : (
          <span data-tauri-drag-region className="truncate text-ui font-medium text-fg-muted">
            {title ?? "Zorvo"}
          </span>
        )}
        {title && branch && (
          <Chip variant="plain" icon={<GitBranch size={12} />} label={`Branch ${branch}`} className="shrink-0 font-mono">
            <span className="max-w-40 truncate">{branch}</span>
          </Chip>
        )}
        {title && branch && pullRequest && onOpenPullRequest && (
          <PullRequestChip pullRequest={pullRequest} onOpen={onOpenPullRequest} />
        )}
      </div>

      {/* Right: the chips that have something to say, the inspector, the session's menu. */}
      <div className="flex shrink-0 items-center gap-1.5 text-fg-muted">
        {plan && plan.length > 0 && <PlanMenu plan={plan} source={planSource} />}

        {backgroundTasks && <BackgroundTasksMenu {...backgroundTasks} />}

        {diffStats && onOpenDiff && (
          <DiffStatChip
            added={diffStats.added}
            removed={diffStats.removed}
            commentCount={diffCommentCount}
            isAlwaysShown={isDiffAlwaysShown}
            onOpen={onOpenDiff}
          />
        )}

        {onToggleInspector && (
          <IconButton ref={inspectorButtonRef} label="Inspector" onClick={onToggleInspector} aria-pressed={isInspectorOpen}>
            <PanelRight size={14} className={isInspectorOpen ? "text-fg" : undefined} />
          </IconButton>
        )}

        <MoreOptionsMenu
          onPopout={onPopout}
          onReveal={onReveal}
          onRename={sessionName && onRename ? () => setRenamingId(titleKey) : undefined}
          onArchive={onArchive}
        />
      </div>
    </header>
  );
}
