import {
  Archive,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Folder,
  GitBranch,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Pencil,
  Split,
  Unlink,
} from "lucide-react";
import { Fragment, useId, useState, type Ref } from "react";
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
      className="min-w-12 truncate text-ui font-semibold text-fg"
    >
      {name}
    </span>
  );
}

/** The session's menu: Open in new window, Open in Finder, Rename, Delegate, End delegation, Archive, each only when it applies. */
function MoreOptionsMenu({
  onPopout,
  onReveal,
  onRename,
  onArchive,
  onDelegate,
  delegateBlockedReason,
  onEndDelegation,
  triggerRef,
}: {
  onPopout?: () => void;
  onReveal?: () => void;
  onRename?: () => void;
  onArchive?: () => void;
  /** Opens the delegate dialog; the item is left out when the reason is the empty string. */
  onDelegate?: () => void;
  /** Why delegating is blocked; null or undefined when it is not, a non-empty reason disables the item. */
  delegateBlockedReason?: string | null;
  onEndDelegation?: () => void;
  /** The ⋯ button, which takes focus back when the dialog its Delegate item opened closes. */
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const delegateReasonId = useId();
  // The empty reason means blocked with nothing to say: a draft has no Delegate item to show.
  const canShowDelegate = onDelegate !== undefined && delegateBlockedReason !== "";
  const delegateReason = delegateBlockedReason ?? undefined;
  const items = [
    { label: "Open in new window", run: onPopout, Icon: ExternalLink },
    { label: "Open in Finder", run: onReveal, Icon: Folder },
    { label: "Rename", run: onRename, Icon: Pencil },
    ...(canShowDelegate
      ? [{ label: "Delegate to another agent…", run: onDelegate, Icon: Split, description: delegateReason }]
      : []),
    ...(onEndDelegation !== undefined ? [{ label: "End delegation", run: onEndDelegation, Icon: Unlink }] : []),
    { label: "Archive", run: onArchive, Icon: Archive },
  ].filter(
    (
      item,
    ): item is { label: string; run: () => void; Icon: typeof Archive; description?: string } =>
      Boolean(item.run),
  );
  if (items.length === 0) return null;
  return (
    <Popover
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      label="More options"
      align="end"
      className="w-[220px]"
      trigger={
        <IconButton
          ref={triggerRef}
          label="More options"
          tone="secondary"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
        >
          <MoreHorizontal size={14} />
        </IconButton>
      }
    >
      {items.map(({ label, run, Icon, description }, index) => (
        <Fragment key={label}>
          {/* Archive ends the session's work, so a rule sets it apart from the rest. */}
          {label === "Archive" && index > 0 && <div role="separator" className="my-1.5 h-px bg-border" />}
          <PopoverOption
            onSelect={() => {
              setIsOpen(false);
              run();
            }}
            // A blocked Delegate still shows its reason, which the row names for assistive tech.
            {...(description !== undefined && label === "Delegate to another agent…"
              ? { disabled: true, description, descriptionId: delegateReasonId }
              : {})}
          >
            <span className="flex items-center gap-2">
              <Icon
                size={14}
                aria-hidden="true"
                className={`shrink-0 ${description !== undefined ? "text-fg-subtle" : "text-fg-muted"}`}
              />
              {label}
            </span>
          </PopoverOption>
        </Fragment>
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
  /**
   * The window's traffic lights float over this bar, so it keeps their inset: in the main
   * window while the sidebar (which holds them otherwise) is hidden, and always in a popout.
   */
  hasTrafficLights?: boolean;
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
  /** Opens the dialog that delegates a task to another agent, from the menu. */
  onDelegate?: () => void;
  /**
   * Why delegating is blocked: null when it is not, a non-empty reason disables the item and
   * shows it under the label, and the empty string leaves the item out (a draft, say).
   */
  delegateBlockedReason?: string | null;
  /** Ends the session's open delegation (A's task, or B's link), from the menu. */
  onEndDelegation?: () => void;
  /** The ⋯ button, which takes focus back when a dialog its item opened closes. */
  moreButtonRef?: Ref<HTMLButtonElement>;
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
  hasTrafficLights = false,
  canGoBack = false,
  canGoForward = false,
  onBack,
  onForward,
  onPopout,
  onReveal,
  onArchive,
  onDelegate,
  delegateBlockedReason,
  onEndDelegation,
  moreButtonRef,
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
      style={hasTrafficLights ? { paddingLeft: TOP_BAR_TRAFFIC_LIGHT_INSET_PX } : undefined}
      className="flex h-12 w-full shrink-0 items-center gap-3 border-b border-border pr-3 pl-5 text-ui-sm select-none"
    >
      {/* Left: with the sidebar hidden, its show button and the session history; then what is open.
          It clips, so a crowded bar never paints its chips over the right-hand ones. */}
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-3 self-stretch overflow-hidden">
        {onShowSidebar && (
          // The three sit close together, as one control, with the title 4px after them.
          <div className="-mr-2 flex shrink-0 items-center">
            <IconButton label="Show sidebar" tone="secondary" onClick={onShowSidebar}>
              <PanelLeft size={14} />
            </IconButton>
            <IconButton
              label="Back"
              onClick={canGoBack ? onBack : undefined}
              disabled={!canGoBack}
              className="-ml-2 disabled:text-fg-subtle disabled:opacity-100"
            >
              <ChevronLeft size={14} />
            </IconButton>
            <IconButton
              label="Forward"
              onClick={canGoForward ? onForward : undefined}
              disabled={!canGoForward}
              className="-ml-2.5 disabled:text-fg-subtle disabled:opacity-100"
            >
              <ChevronRight size={14} />
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
          <span data-tauri-drag-region className="min-w-12 truncate text-ui font-semibold text-fg">
            {title ?? "Zorvo"}
          </span>
        )}
        {title && branch && (
          <Chip
            variant="plain"
            icon={<GitBranch size={12} className="text-fg-muted" />}
            label={`Branch ${branch}`}
            // Gives way four times faster than the title, down to its icon, in a crowded bar.
            className="min-w-0 shrink-[4] font-mono"
          >
            <span className="min-w-0 max-w-40 truncate">{branch}</span>
          </Chip>
        )}
        {title && branch && pullRequest && onOpenPullRequest && (
          <PullRequestChip pullRequest={pullRequest} onOpen={onOpenPullRequest} />
        )}
      </div>

      {/* Right: the chips that have something to say, the inspector, the session's menu. */}
      <div className="flex shrink-0 items-center gap-3 text-fg-muted">
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
          <IconButton
            ref={inspectorButtonRef}
            label="Inspector"
            tone="secondary"
            onClick={onToggleInspector}
            aria-pressed={isInspectorOpen}
          >
            <PanelRight size={14} />
          </IconButton>
        )}

        <MoreOptionsMenu
          onPopout={onPopout}
          onReveal={onReveal}
          onRename={sessionName && onRename ? () => setRenamingId(titleKey) : undefined}
          onArchive={onArchive}
          onDelegate={onDelegate}
          delegateBlockedReason={delegateBlockedReason}
          onEndDelegation={onEndDelegation}
          triggerRef={moreButtonRef}
        />
      </div>
    </header>
  );
}
