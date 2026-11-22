import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  ExternalLink,
  FileDiff,
  FileText,
  Folder,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Image as ImageIcon,
  LoaderCircle,
  PanelRight,
  PanelsTopLeft,
  Terminal,
  Users,
  X,
} from "lucide-react";
import { useNow } from "../../hooks/useNow";
import type { TaskTab } from "../../hooks/useTaskTabs";
import { fileNameOf } from "../../lib/attachments";
import { formatElapsed } from "../../lib/background-tasks";
import { fileNameAndFolder, pathInFolder, type CreatedFile } from "../../lib/created-files";
import { LOOK_STYLE, pullRequestLine, pullRequestLook, type PullRequestLook } from "../../lib/pull-request-look";
import { formatRelativeTime } from "../../lib/relative-time";
import { newestVersion } from "../../lib/artifacts";
import { pillParts, SECTION_CAP, type Overview, type OverviewTask } from "../../lib/session-overview";
import { ImagePreviewDialog } from "../composer/ImagePreviewDialog";
import { IconButton } from "../ui/IconButton";

export interface OverviewCardProps {
  overview: Overview;
  agentName: string;
  /** Lines added and removed against HEAD; null outside a repository, undefined while they are read. */
  changes: ChangeCountsOf | null | undefined;
  folderName?: string;
  branch?: string;
  /** The folder the file viewer shows: a file must be inside it to open there. */
  filesRoot?: string;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  onShowTab: (tab: "changes" | "files") => void;
  onOpenTask: (tab: TaskTab) => void;
  onOpenPage: (artifactId: string) => void;
  onOpenFile: (relative: string) => void;
  onOpenUrl: (url: string) => void;
}

type ChangeCountsOf = { added: number; removed: number };

/** "+42 −11" in the diff's colours. */
function ChangeCounts({ added, removed }: ChangeCountsOf) {
  return (
    <span className="shrink-0 font-mono text-caption">
      <span className="text-status-running">{`+${added}`}</span> <span className="text-danger">{`−${removed}`}</span>
    </span>
  );
}

const ROW =
  "focus-ring flex w-full min-h-8 items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-ui text-fg-secondary transition-colors hover:bg-surface-hover";
const STILL_ROW = "flex w-full min-h-8 items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-ui text-fg-secondary";
const ICON = "size-3.5 shrink-0 text-fg-muted";
const META = "shrink-0 text-caption text-fg-subtle";

/** A row's name and, under it, its second line. */
function Label({ name, detail, isMono = false }: { name: string; detail?: string; isMono?: boolean }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className={`truncate font-medium text-fg ${isMono ? "font-mono text-ui-sm" : ""}`}>{name}</span>
      {detail && <span className="truncate text-caption text-fg-subtle">{detail}</span>}
    </span>
  );
}

/** A section with a heading and, past `SECTION_CAP` rows, "Show N more". */
function Section({ id, title, count, children, aside }: { id: string; title: string; count?: number; children: ReactNode[]; aside?: ReactNode }) {
  const [isAll, setIsAll] = useState(false);
  const shown = isAll ? children : children.slice(0, SECTION_CAP);
  const hidden = children.length - shown.length;
  return (
    <section aria-labelledby={id} className="flex flex-col border-t border-border px-2 py-2.5 first:border-t-0">
      <div className="flex items-center justify-between">
        <h2 id={id} className="flex items-center gap-1.5 px-2 pt-0.5 pb-1.5 text-caption font-medium text-fg-muted">
          {title}
          {count !== undefined && count > 0 && <span className="font-normal text-fg-subtle">{count}</span>}
        </h2>
        {aside}
      </div>
      {shown}
      {hidden > 0 && (
        <button type="button" onClick={() => setIsAll(true)} className={`${ROW} min-h-7 text-ui-sm text-fg-muted`}>
          <ChevronDown aria-hidden="true" className={ICON} />
          {`Show ${hidden} more`}
        </button>
      )}
    </section>
  );
}

const TASK_ICON = { subagent: Users, shell: Terminal } as const;

/** The mark at a task's start: work in progress spins, a question waits, the end says how it went. */
function TaskState({ task }: { task: OverviewTask }) {
  if (task.state === "running") return <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 text-status-running motion-safe:animate-spin" />;
  if (task.state === "needs-you") return <CircleAlert aria-hidden="true" className="size-3.5 shrink-0 text-status-attention" />;
  if (task.state === "failed") return <X aria-hidden="true" className="size-3.5 shrink-0 text-danger" />;
  return <Check aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />;
}

function TaskRowOf({ task, onOpen }: { task: OverviewTask; onOpen: (tab: TaskTab) => void }) {
  const isLive = task.state === "running" || task.state === "needs-you";
  const now = useNow(1000, isLive && task.startedAt !== undefined);
  const elapsed = isLive && task.startedAt !== undefined ? formatElapsed(now - task.startedAt) : undefined;
  const Kind = TASK_ICON[task.kind];
  const statusWord = task.state === "failed" ? "Failed" : task.state === "needs-you" ? "Needs you" : undefined;
  const label = (
    <>
      <TaskState task={task} />
      <Label name={task.title} detail={task.detail} isMono={task.kind === "shell"} />
      {statusWord ? (
        <span className={`shrink-0 text-caption ${task.state === "failed" ? "text-danger" : "text-status-attention"}`}>{statusWord}</span>
      ) : elapsed ? (
        <span className={`${META} font-mono tabular-nums`}>{elapsed}</span>
      ) : (
        <Kind aria-hidden="true" className={ICON} />
      )}
    </>
  );
  const { tab } = task;
  // A background agent has no tab to open, so its row is plain text, not a control that does nothing.
  if (tab === undefined) {
    return (
      <div className={STILL_ROW}>
        {label}
        <span className="sr-only">{`Subagent, ${task.status.toLowerCase()}.`}</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-label={`Open ${task.title}. ${task.kind === "subagent" ? "Subagent" : "Shell command"}, ${task.status.toLowerCase()}.`}
      onClick={() => onOpen(tab)}
      className={ROW}
    >
      {label}
    </button>
  );
}

/** Running and waiting tasks, failed ones after them, and the finished ones folded under "N finished". */
function RunningSection({ overview, onOpenTask }: { overview: Overview; onOpenTask: (tab: TaskTab) => void }) {
  const [isFinishedOpen, setIsFinishedOpen] = useState(false);
  const { tasks, finished } = overview;
  if (tasks.length === 0 && finished.length === 0) return null;
  // With nothing at work or failed, the finished ones are the section.
  if (tasks.length === 0) {
    return (
      <Section id="overview-finished" title="Finished" count={finished.length}>
        {finished.map((task) => (
          <TaskRowOf key={task.key} task={task} onOpen={onOpenTask} />
        ))}
      </Section>
    );
  }
  const rows = tasks.map((task) => <TaskRowOf key={task.key} task={task} onOpen={onOpenTask} />);
  if (finished.length > 0) {
    rows.push(
      <button
        key="finished"
        type="button"
        aria-expanded={isFinishedOpen}
        onClick={() => setIsFinishedOpen((open) => !open)}
        className={`${ROW} min-h-7 text-ui-sm text-fg-muted`}
      >
        {isFinishedOpen ? <ChevronDown aria-hidden="true" className={ICON} /> : <ChevronRight aria-hidden="true" className={ICON} />}
        {`${finished.length} finished`}
      </button>,
      ...(isFinishedOpen ? finished.map((task) => <TaskRowOf key={task.key} task={task} onOpen={onOpenTask} />) : []),
    );
  }
  return (
    <Section id="overview-running" title="Running" count={overview.runningCount}>
      {rows}
    </Section>
  );
}

function SourceRow({ path, isImage, filesRoot, onPreview, onOpenFile }: {
  path: string;
  isImage: boolean;
  filesRoot?: string;
  onPreview: (path: string) => void;
  onOpenFile: (relative: string) => void;
}) {
  const relative = filesRoot ? pathInFolder(path, filesRoot) : null;
  const Icon = isImage ? ImageIcon : FileText;
  const body = (
    <>
      <Icon aria-hidden="true" className={ICON} />
      <Label name={fileNameOf(path)} isMono={!isImage} />
      <span className={META}>{isImage ? "Image" : "File"}</span>
    </>
  );
  if (isImage) {
    return (
      <button type="button" title={path} onClick={() => onPreview(path)} className={ROW}>
        {body}
      </button>
    );
  }
  if (relative === null) {
    return (
      <div title={path} className={STILL_ROW}>
        {body}
      </div>
    );
  }
  return (
    <button type="button" title={path} onClick={() => onOpenFile(relative)} className={ROW}>
      {body}
    </button>
  );
}

function FileRow({ file, filesRoot, onOpenFile }: { file: CreatedFile; filesRoot?: string; onOpenFile: (relative: string) => void }) {
  const { name, where } = fileNameAndFolder(file.path, filesRoot ?? "");
  const relative = filesRoot ? pathInFolder(file.path, filesRoot) : null;
  const body = (
    <>
      <FileText aria-hidden="true" className={ICON} />
      <Label name={name} detail={where ? `New file · ${where}` : "New file"} isMono />
      {file.at !== null && <span className={META}>{formatRelativeTime(file.at)}</span>}
    </>
  );
  return relative === null ? (
    <div title={file.path} className={STILL_ROW}>
      {body}
    </div>
  ) : (
    <button type="button" title={file.path} onClick={() => onOpenFile(relative)} className={ROW}>
      {body}
    </button>
  );
}

const PULL_REQUEST_ICON: Record<PullRequestLook, typeof GitPullRequest> = {
  open: GitPullRequest,
  failing: GitPullRequest,
  draft: GitPullRequestDraft,
  merged: GitMerge,
  closed: GitPullRequestClosed,
};

/** The session's overview beside the chat: where it works, what runs, what it read and made, and its pull request. */
export function OverviewCard({
  overview,
  agentName,
  changes,
  folderName,
  branch,
  filesRoot,
  isCollapsed,
  onToggleCollapsed,
  onShowTab,
  onOpenTask,
  onOpenPage,
  onOpenFile,
  onOpenUrl,
}: OverviewCardProps) {
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  // On a sheet too narrow for the card, its pill opens it floating over the chat.
  const [isFloating, setIsFloating] = useState(false);
  // The control that replaces the one just pressed takes the focus, so the keyboard does not fall back to the page.
  const pillRef = useRef<HTMLButtonElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const focusNextRef = useRef<"pill" | "collapse" | null>(null);
  useEffect(() => {
    if (!focusNextRef.current) return;
    (focusNextRef.current === "pill" ? pillRef : collapseRef).current?.focus();
    focusNextRef.current = null;
  });

  if (isCollapsed) {
    return (
      <OverviewPill
        ref={pillRef}
        overview={overview}
        changes={changes}
        onExpand={() => {
          // Floating only takes effect on a narrow sheet; a wide one docks the card as before.
          setIsFloating(true);
          focusNextRef.current = "collapse";
          onToggleCollapsed();
        }}
      />
    );
  }

  /** A floating card only closes, back to its pill; a docked one folds to the pill. */
  const close = (card: Element | null) => {
    const isOverChat = card !== null && getComputedStyle(card).position === "absolute";
    setIsFloating(false);
    focusNextRef.current = "pill";
    if (!isOverChat) onToggleCollapsed();
  };
  const closeOnEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || getComputedStyle(event.currentTarget).position !== "absolute") return;
    event.stopPropagation();
    close(event.currentTarget);
  };

  const environment = [
    changes !== null && (
      <button key="changes" type="button" onClick={() => onShowTab("changes")} className={ROW}>
        <FileDiff aria-hidden="true" className={ICON} />
        <Label name="Changes" />
        {/* Nothing while the counts are read, so the row never says "None yet" of a session that changed things. */}
        {changes && (changes.added === 0 && changes.removed === 0 ? <span className={META}>None yet</span> : <ChangeCounts {...changes} />)}
        <ChevronRight aria-hidden="true" className={ICON} />
      </button>
    ),
    folderName && (
      <button key="files" type="button" onClick={() => onShowTab("files")} className={ROW}>
        <Folder aria-hidden="true" className={ICON} />
        <Label name="Files" />
        <span className={`${META} max-w-32 truncate`}>{folderName}</span>
        <ChevronRight aria-hidden="true" className={ICON} />
      </button>
    ),
    branch && changes !== null && (
      <button key="branch" type="button" onClick={() => onShowTab("changes")} className={ROW}>
        <GitBranch aria-hidden="true" className={ICON} />
        <Label name={branch} isMono />
        <ChevronRight aria-hidden="true" className={ICON} />
      </button>
    ),
  ].filter(Boolean) as ReactNode[];

  const outputRows = [
    ...overview.pages.map((page) => (
      <button key={page.id} type="button" onClick={() => onOpenPage(page.id)} className={ROW}>
        <PanelsTopLeft aria-hidden="true" className={ICON} />
        <Label name={page.title} detail={`Page · version ${newestVersion(page)}`} />
        <span className={META}>{formatRelativeTime(page.versions.find((version) => version.n === newestVersion(page))?.at ?? 0)}</span>
      </button>
    )),
    ...overview.files.map((file) => <FileRow key={file.path} file={file} filesRoot={filesRoot} onOpenFile={onOpenFile} />),
  ];

  const pullRequest = overview.pullRequest;
  const look = pullRequest ? pullRequestLook(pullRequest) : null;
  const PullRequestIcon = look ? PULL_REQUEST_ICON[look] : GitPullRequest;

  return (
    <>
      {/* Below 900px of sheet the card gives way to its pill, which opens it over the chat. */}
      {!isFloating && (
        <span className="flex self-start @min-[900px]:hidden">
          <OverviewPill
            ref={pillRef}
            overview={overview}
            changes={changes}
            onExpand={() => {
              setIsFloating(true);
              focusNextRef.current = "collapse";
            }}
          />
        </span>
      )}
      <section
        aria-label="Session overview"
        onKeyDown={closeOnEscape}
        className={`max-h-[calc(100%-2rem)] w-80 shrink-0 flex-col self-start overflow-y-auto rounded-xl border border-border bg-surface-2 ${
          // Floating only while the sheet is narrow: widened again, the open card docks beside the chat.
          isFloating
            ? "flex @min-[900px]:mt-4 @min-[900px]:mr-4 @max-[900px]:absolute @max-[900px]:top-4 @max-[900px]:right-4 @max-[900px]:z-30 @max-[900px]:shadow-popover"
            : "mt-4 mr-4 hidden @min-[900px]:flex"
        }`}
      >
        <Section
          id="overview-environment"
          title="Environment"
          aside={
            <IconButton
              ref={collapseRef}
              label="Collapse session overview"
              size="sm"
              className="-mt-1 mr-0.5"
              onClick={(event) => close(event.currentTarget.closest("section[aria-label='Session overview']"))}
            >
              <ChevronUp aria-hidden="true" className="size-3.5" />
            </IconButton>
          }
        >
          {environment}
        </Section>
        <RunningSection overview={overview} onOpenTask={onOpenTask} />
        {overview.sources.length > 0 && (
          <Section id="overview-sources" title="Sources" count={overview.sources.length}>
            {overview.sources.map((source) => (
              <SourceRow key={source.path} {...source} filesRoot={filesRoot} onPreview={setPreviewPath} onOpenFile={onOpenFile} />
            ))}
          </Section>
        )}
        <Section id="overview-output" title="Output" count={outputRows.length}>
          {outputRows.length > 0
            ? outputRows
            : [
                <p key="empty" className="px-2 pb-1 text-ui-sm text-fg-muted">
                  {`Nothing yet. Pages and files ${agentName} makes in this session show here.`}
                </p>,
              ]}
        </Section>
        {pullRequest && look && (
          <Section id="overview-pull-request" title="Pull request">
            {[
              <button
                key="pull-request"
                type="button"
                aria-label={`Open pull request ${pullRequest.number} in your browser. ${pullRequestLine(pullRequest)}.`}
                onClick={() => onOpenUrl(pullRequest.url)}
                className={ROW}
              >
                <PullRequestIcon aria-hidden="true" className={`size-3.5 shrink-0 ${LOOK_STYLE[look]}`} />
                <Label name={pullRequest.title} detail={`#${pullRequest.number} · ${pullRequestLine(pullRequest)}`} />
                <ExternalLink aria-hidden="true" className={ICON} />
              </button>,
            ]}
          </Section>
        )}
      </section>
      {previewPath && <ImagePreviewDialog path={previewPath} onClose={() => setPreviewPath(null)} />}
    </>
  );
}

/** The folded card: what runs and what changed, in one line; a click opens the card again. */
function OverviewPill({ overview, changes, onExpand, ref }: {
  overview: Overview;
  changes: OverviewCardProps["changes"];
  onExpand: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const parts = pillParts(overview.runningCount, changes ?? null);
  const hasChanges = parts.added > 0 || parts.removed > 0;
  const said = [parts.running, hasChanges ? `${parts.added} lines added, ${parts.removed} removed` : null].filter(Boolean).join(", ");
  return (
    <button
      ref={ref}
      type="button"
      aria-label={said ? `Expand session overview: ${said}` : "Expand session overview"}
      aria-expanded="false"
      onClick={onExpand}
      className="focus-ring mt-4 mr-4 flex h-8 shrink-0 items-center gap-2 self-start rounded-full border border-border bg-surface-2 pr-2 pl-2.5 text-ui-sm text-fg-secondary transition-colors hover:bg-surface-hover"
    >
      <PanelRight aria-hidden="true" className="size-3.5 text-fg-muted" />
      {parts.running ?? (hasChanges ? null : "Overview")}
      {parts.running && hasChanges && <span aria-hidden="true" className="h-3.5 w-px bg-border" />}
      {hasChanges && <ChangeCounts added={parts.added} removed={parts.removed} />}
      <ChevronDown aria-hidden="true" className="size-3.5 text-fg-muted" />
    </button>
  );
}
