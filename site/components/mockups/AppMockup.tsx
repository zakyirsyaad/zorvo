import type { ReactNode } from "react";
import type { AgentName } from "../../lib/agent-logos";
import { AgentLogo } from "../ui/AgentLogo";
import { Icon, type IconName } from "../ui/Icon";
import {
  AgentHeader,
  DiffRows,
  LineCounts,
  LogoStack,
  PermissionCard,
  Spinner,
  StatusDot,
  ToolRunCard,
  type ChangedFile,
  type DiffLine,
  type Status,
} from "./parts";

/*
 * The app as a picture, after the 0.9 design: a full-height sidebar with two-line
 * session rows, the top bar over the chat, the chat column with the composer, and
 * the inspector on its Changes tab. Narrow screens drop the inspector, then the
 * sidebar, so the chat always reads.
 */

interface SessionRow {
  title: string;
  agent: AgentName;
  line: string;
  status?: Status;
  isOpen?: boolean;
  isWorktree?: boolean;
}

const SESSIONS: SessionRow[] = [
  { title: "Add selected lines to the prompt", agent: "Claude Code", line: "Working", status: "running", isOpen: true, isWorktree: true },
  { title: "Show the plan in the top bar", agent: "Codex", line: "Waiting for you", status: "attention" },
  { title: "Thumbnails for attached images", agent: "Qwen Code", line: "Finished, unread", status: "unread" },
  { title: "Install agents from Settings", agent: "Claude Code", line: "2 days ago" },
];

const COMPARE_AGENTS: AgentName[] = ["Claude Code", "Codex", "Qwen Code"];

const CHANGED: ChangedFile[] = [
  { path: "src/components/files/FileViewer.tsx", added: 24, removed: 6 },
  { path: "src/lib/line-quote.ts", added: 16, removed: 0 },
  { path: "src/test/line-quote.test.ts", added: 2, removed: 5 },
];

const VIEWER_DIFF: DiffLine[] = [
  { kind: "hunk", text: "@@ -88,6 +88,12 @@" },
  { kind: "context", number: 88, text: " const range = selected(lines);" },
  { kind: "removed", number: 89, text: " if (!range) return null;" },
  { kind: "added", number: 89, text: " if (!range || !canAdd) return;" },
  { kind: "added", number: 90, text: " return <AddLines {...range} />;" },
];

function WindowButtons() {
  return (
    <div className="flex gap-2">
      <span className="size-3 rounded-full bg-surface-hover" />
      <span className="size-3 rounded-full bg-surface-hover" />
      <span className="size-3 rounded-full bg-surface-hover" />
    </div>
  );
}

function titleLook(session: SessionRow): string {
  if (session.isOpen) return "font-medium text-fg";
  if (session.status === "unread") return "font-medium text-fg-secondary";
  return "text-fg-secondary";
}

function SessionRowPicture({ session }: { session: SessionRow }) {
  return (
    <div className={`flex gap-2.5 rounded-md p-2 ${session.isOpen ? "bg-surface-hover" : ""}`}>
      <span className="flex w-1.5 flex-none pt-1.5">{session.status && <StatusDot status={session.status} isStill />}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={`truncate text-xs leading-[18px] ${titleLook(session)}`}>{session.title}</span>
        <span className={`flex min-w-0 items-center gap-1 text-[11px] leading-4 ${session.isOpen ? "text-fg-muted" : "text-fg-subtle"}`}>
          {session.isWorktree && <Icon name="git-branch" size={11} />}
          <AgentLogo agent={session.agent} size={13} />
          <span className="truncate">
            {session.agent} · {session.line}
          </span>
        </span>
      </span>
    </div>
  );
}

function CompareRunRowPicture() {
  return (
    <div className="flex items-center gap-2.5 rounded-md p-2">
      <span className="flex w-1.5 flex-none self-start pt-1.5">
        <StatusDot status="running" isStill />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-xs leading-[18px] text-fg-secondary">Compare · 3 agents</span>
        <span className="truncate text-[11px] leading-4 text-fg-subtle">2 working, 1 finished</span>
      </span>
      <LogoStack agents={COMPARE_AGENTS} />
    </div>
  );
}

function Sidebar() {
  return (
    <div className="hidden w-[236px] flex-none flex-col border-r border-border bg-surface-1 md:flex">
      <div className="flex h-12 flex-none items-center justify-between px-3.5">
        <WindowButtons />
        <Icon name="panel-left" className="text-fg-muted" />
      </div>
      <div className="flex flex-col gap-2 px-2 pb-2">
        <span className="flex h-8 items-center gap-2 rounded-lg border border-border-strong px-2.5 text-xs leading-4 font-medium text-fg-secondary">
          <Icon name="plus" size={12} />
          New session
        </span>
        <span className="flex h-[30px] items-center gap-2 rounded-lg bg-surface-2 px-2.5 text-xs leading-4 text-fg-subtle">
          <Icon name="search" size={12} />
          Search sessions
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden px-2">
        <div className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[11px] leading-4 font-medium text-fg-muted">
          <Icon name="folder" size={12} />
          zorvo
        </div>
        <SessionRowPicture session={SESSIONS[0]} />
        <SessionRowPicture session={SESSIONS[1]} />
        <CompareRunRowPicture />
        <SessionRowPicture session={SESSIONS[2]} />
        <SessionRowPicture session={SESSIONS[3]} />
        <div className="mt-1 flex h-8 items-center gap-1.5 px-2 text-xs leading-4">
          <Icon name="chevron-right" size={12} className="text-fg-subtle" />
          <span className="flex-1 text-fg-secondary">site</span>
          <span className="text-[11px] text-fg-subtle">3 sessions</span>
        </div>
      </div>
      <div className="flex h-12 flex-none items-center gap-2 border-t border-border px-3">
        <span className="grid size-6 place-items-center rounded-full bg-surface-hover text-[10px] font-medium text-fg-secondary">
          S
        </span>
        <span className="flex-1 truncate text-xs leading-4 text-fg-secondary">@sam</span>
        <Icon name="users" className="text-fg-muted" />
        <Icon name="settings" className="text-fg-muted" />
      </div>
    </div>
  );
}

function OutlineChip({ icon, children }: { icon?: IconName; children: ReactNode }) {
  return (
    <span className="inline-flex h-6 flex-none items-center gap-1.5 rounded-md border border-border px-2 text-[11px] leading-4 text-fg-secondary">
      {icon && <Icon name={icon} size={12} className="text-fg-muted" />}
      {children}
    </span>
  );
}

function TopBar() {
  return (
    <div className="flex h-12 flex-none items-center gap-3 border-b border-border px-4">
      <span className="md:hidden">
        <WindowButtons />
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* Both shrink, the branch four times faster, so the title gives way last; the pull request needs a wide screen. */}
        <span className="min-w-0 truncate text-xs leading-4 font-semibold text-fg">Add selected lines to the prompt</span>
        <span className="hidden min-w-0 shrink-[4] items-center gap-1 px-1 font-mono text-[11px] text-fg-muted xl:inline-flex">
          <Icon name="git-branch" size={12} />
          <span className="truncate">agent/add-selected-lines</span>
        </span>
        <span className="hidden flex-none items-center gap-1 px-1 text-[11px] 2xl:inline-flex">
          <span className="font-mono text-fg-muted">#142</span>
          <span className="text-fg-secondary">Open</span>
        </span>
      </div>
      <div className="flex flex-none items-center gap-2">
        <span className="hidden sm:inline-flex">
          <OutlineChip icon="list-checks">
            <span className="font-mono">2/4</span>
          </OutlineChip>
        </span>
        <span className="hidden xl:inline-flex">
          <OutlineChip>
            <Spinner className="text-status-running" />1 background task
          </OutlineChip>
        </span>
        <OutlineChip>
          <LineCounts added={42} removed={11} />
        </OutlineChip>
        <span className="hidden size-7 place-items-center rounded-md bg-surface-hover text-fg lg:grid">
          <Icon name="panel-right" />
        </span>
        <span className="grid size-7 place-items-center text-fg-secondary">
          <Icon name="ellipsis" />
        </span>
      </div>
    </div>
  );
}

function ControlChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-7 flex-none items-center gap-1 rounded-md px-2 text-xs leading-4 text-fg-secondary">
      {children}
      <Icon name="chevron-down" size={12} className="text-fg-muted" />
    </span>
  );
}

function Composer() {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface-2 p-3 shadow-popover">
      <span className="h-11 text-sm leading-[22px] text-fg-subtle">Reply to Claude Code</span>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <span className="grid size-7 flex-none place-items-center text-fg-muted">
            <Icon name="paperclip" />
          </span>
          <span className="inline-flex flex-none items-center gap-1.5 px-1.5 text-xs leading-4 text-fg-secondary">
            <AgentLogo agent="Claude Code" size={16} />
            <span className="hidden sm:inline">Claude Code</span>
          </span>
          <ControlChip>Opus 5.5</ControlChip>
          <span className="hidden sm:inline-flex">
            <ControlChip>Default</ControlChip>
          </span>
          <span className="hidden xl:inline-flex">
            <ControlChip>High</ControlChip>
          </span>
        </div>
        <div className="flex flex-none items-center gap-2.5">
          <span className="hidden text-[11px] leading-4 text-fg-subtle sm:inline">38% of context</span>
          {/* While the agent works, Stop takes Send's place. */}
          <span className="inline-flex size-7 items-center justify-center rounded-lg border border-border-strong text-fg-secondary">
            <Icon name="square" size={11} />
          </span>
        </div>
      </div>
    </div>
  );
}

function Chat() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <TopBar />
      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden px-4 pt-6 sm:px-6">
        <div className="mx-auto flex w-full max-w-[560px] flex-col gap-5 text-left">
          <div className="max-w-[85%] self-end rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 text-sm leading-[22px] text-fg">
            When I select lines in the file view, let me add them to my message.
          </div>
          <div className="flex flex-col gap-2.5">
            <AgentHeader agent="Claude Code" time="2:14 PM" />
            <ToolRunCard summary="Read 3 files, edited 2" last={CHANGED[0]} />
            <p className="m-0 text-sm leading-[22px] text-fg-secondary">
              Selected lines are tinted now, with Add lines under them. It inserts the path, the range and the
              lines, fenced in the file&apos;s language.
            </p>
          </div>
          <PermissionCard title="Claude Code wants to run a command" command="pnpm vitest run src/test/line-quote.test.ts" />
          <div className="flex items-center gap-2 text-xs leading-4">
            <span className="size-1.5 rounded-full bg-status-running ring-4 ring-status-running/20" />
            <span className="text-fg-secondary">Claude Code is working</span>
            <span className="text-[11px] text-fg-subtle">12s</span>
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-[608px] px-4 pt-4 pb-4 sm:px-6 sm:pb-5">
        <Composer />
      </div>
    </div>
  );
}

function InspectorTab({ label, count, isSelected }: { label: string; count?: number; isSelected?: boolean }) {
  return (
    <span
      className={`inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs leading-4 ${isSelected ? "bg-surface-hover text-fg" : "text-fg-muted"}`}
    >
      {label}
      {count !== undefined && <span className="text-[11px] text-fg-subtle">{count}</span>}
    </span>
  );
}

function FileCard({ file, isOpen }: { file: ChangedFile; isOpen?: boolean }) {
  const kind = file.removed === 0 ? "A" : "M";
  return (
    <div className={`overflow-hidden rounded-lg border border-border ${isOpen ? "bg-surface-2" : ""}`}>
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span className="grid size-3.5 flex-none place-items-center rounded-[4px] bg-fg text-on-primary">
          <Icon name="check" size={11} />
        </span>
        <Icon name={isOpen ? "chevron-down" : "chevron-right"} size={12} className="text-fg-muted" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-4 text-fg-secondary">{file.path}</span>
        <span className="text-[10px] leading-[14px] font-semibold text-fg-subtle">{kind}</span>
        <LineCounts added={file.added} removed={file.removed} />
      </div>
      {isOpen && (
        <div className="border-t border-border">
          <DiffRows lines={VIEWER_DIFF} />
        </div>
      )}
    </div>
  );
}

function Inspector() {
  return (
    <div className="hidden w-[300px] flex-none flex-col border-l border-border bg-surface-1 lg:flex">
      <div className="flex h-12 flex-none items-center justify-between border-b border-border pr-2 pl-3">
        <div className="flex items-center gap-0.5">
          <InspectorTab label="Changes" count={3} isSelected />
          <InspectorTab label="Activity" />
          <InspectorTab label="Files" />
          <InspectorTab label="Terminal" />
        </div>
        <Icon name="x" size={12} className="text-fg-muted" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
        <div className="flex items-center gap-2 text-xs leading-4">
          <span className="font-semibold text-fg">3 files changed</span>
          <LineCounts added={42} removed={11} />
        </div>
        <FileCard file={CHANGED[0]} isOpen />
        <FileCard file={CHANGED[1]} />
        <FileCard file={CHANGED[2]} />
      </div>
      <div className="flex flex-none flex-col gap-2 border-t border-border px-4 py-3">
        <span className="h-11 rounded-lg border border-border-strong bg-bg px-2.5 py-2 text-xs leading-4 text-fg-subtle">
          Commit message
        </span>
        <span className="flex h-7 items-center justify-center rounded-lg bg-primary text-xs leading-4 font-medium text-on-primary">
          Commit 3 files
        </span>
      </div>
    </div>
  );
}

export function AppMockup() {
  return (
    <div
      role="img"
      aria-label="The Zorvo app. The sidebar lists sessions by folder with what each agent is doing: a Claude Code session working, a Codex session waiting for you, and a compare run of three agents. The open Claude Code chat shows a folded tool run, a reply, a permission request to run a test, and the composer with its model and mode. On the right, the inspector lists three changed files with a diff and a Commit button."
      className="mx-auto flex max-w-[1180px] overflow-hidden rounded-t-xl border border-b-0 border-border bg-bg shadow-dialog md:h-[640px]"
    >
      <Sidebar />
      <Chat />
      <Inspector />
    </div>
  );
}
