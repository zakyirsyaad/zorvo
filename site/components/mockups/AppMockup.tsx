import { AGENT_LOGOS, type AgentName } from "../../lib/agent-logos";
import { Chip } from "../ui/Chip";
import { Icon, type IconName } from "../ui/Icon";
import { DiffCard, PermissionCard, StatusDot, type DiffLine } from "./parts";

const DRAWER_DIFF: DiffLine[] = [
  { kind: "removed", text: "  return null;" },
  { kind: "added", text: "  return (" },
  { kind: "added", text: "    <Drawer folder={folder} tabs={tabs} />" },
  { kind: "added", text: "  );" },
];

interface SessionRow {
  title: string;
  agent: AgentName;
  meta: "running" | "attention" | "unread" | string;
  isCurrent?: boolean;
}

const WORKSPACES: { folder: string; sessions: SessionRow[] }[] = [
  {
    folder: "zorvo",
    sessions: [
      { title: "Add a terminal to the session", agent: "Claude Code", meta: "running", isCurrent: true },
      { title: "Show the plan in the top bar", agent: "Codex", meta: "attention" },
      { title: "Thumbnails for attached images", agent: "Qwen Code", meta: "unread" },
      { title: "Install agents from Settings", agent: "Claude Code", meta: "2d" },
    ],
  },
  {
    folder: "site",
    sessions: [{ title: "Draft the docs pages", agent: "Qwen Code", meta: "5d" }],
  },
];

function SessionMeta({ meta }: { meta: SessionRow["meta"] }) {
  if (meta === "running" || meta === "attention" || meta === "unread") return <StatusDot status={meta} />;
  return <>{meta}</>;
}

function AgentLogo({ agent, size }: { agent: AgentName; size: number }) {
  // The session title or picker label beside it names the agent, so the logo is decorative.
  return <img src={AGENT_LOGOS[agent]} alt="" width={size} height={size} className="flex-none rounded-[3px]" />;
}

function Sidebar() {
  return (
    <div className="hidden w-[248px] flex-none flex-col gap-0.5 border-r border-border bg-surface-1 p-2 md:flex">
      {WORKSPACES.map(({ folder, sessions }, index) => (
        <div key={folder} className="flex flex-col gap-0.5">
          <div
            className={`flex items-center gap-1.5 px-2 pb-1.5 text-[11px] leading-4 text-fg-subtle ${index === 0 ? "pt-1.5" : "pt-3.5"}`}
          >
            <Icon name="folder" />
            {folder}
          </div>
          {sessions.map((session) => (
            <div
              key={session.title}
              className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs leading-4 ${session.isCurrent ? "bg-surface-hover text-fg" : "text-fg-muted"}`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <AgentLogo agent={session.agent} size={13} />
                <span className="truncate">{session.title}</span>
              </span>
              <span className="flex flex-none items-center text-[11px] text-fg-subtle">
                <SessionMeta meta={session.meta} />
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function TopBarIcon({ name, isActive, badge }: { name: IconName; isActive?: boolean; badge?: string }) {
  return (
    <span
      className={`relative inline-flex size-7 flex-none items-center justify-center rounded-md ${isActive ? "bg-surface-hover text-fg" : "text-fg-muted"}`}
    >
      <Icon name={name} />
      {badge && (
        <span className="absolute -top-0.5 -right-1 rounded-full border border-border bg-surface-hover px-1 text-[10px] leading-[14px] font-medium text-fg">
          {badge}
        </span>
      )}
    </span>
  );
}

function FakeSelect({ label, agent }: { label: string; agent?: AgentName }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs leading-4 whitespace-nowrap text-fg-secondary">
      {agent && <AgentLogo agent={agent} size={12} />}
      {label}
      <Icon name="chevron-down" />
    </span>
  );
}

function Composer() {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-3 text-left shadow-popover">
      <span className="truncate text-sm leading-[22px] text-fg-subtle">
        Ask Claude Code to change something, @ to mention a file
      </span>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <span className="inline-flex size-7 items-center justify-center text-fg-muted">
            <Icon name="plus" />
          </span>
          <FakeSelect label="Claude Code" agent="Claude Code" />
          <span className="hidden sm:inline-flex"><FakeSelect label="Sonnet 5.5" /></span>
          <span className="hidden sm:inline-flex"><FakeSelect label="Default" /></span>
        </div>
        <span className="inline-flex size-7 flex-none items-center justify-center rounded-lg bg-primary text-on-primary">
          <Icon name="arrow-up" />
        </span>
      </div>
    </div>
  );
}

/**
 * The app as a picture: the session list, a Claude Code chat with its tool calls folded into one
 * line, a diff and a permission request, the composer, and the top bar with the plan and terminal.
 */
export function AppMockup() {
  return (
    <div
      role="img"
      aria-label="The Zorvo app: a session list, a Claude Code chat with its tool calls folded into one line, a diff and a permission request, the composer, and the top bar with the agent's plan and the terminal"
      className="mx-auto flex max-w-[1100px] flex-col overflow-hidden rounded-t-xl border border-b-0 border-border bg-bg shadow-dialog md:h-[600px]"
    >
      <div className="flex h-10 flex-none items-center gap-3 border-b border-border bg-surface-1 pr-2.5 pl-3.5">
        <div className="flex gap-2">
          <span className="size-3 rounded-full bg-surface-hover" />
          <span className="size-3 rounded-full bg-surface-hover" />
          <span className="size-3 rounded-full bg-surface-hover" />
        </div>
        <div className="hidden min-w-0 flex-1 items-center justify-center gap-2 sm:flex">
          <span className="truncate text-xs leading-4 text-fg">Add a terminal to the session</span>
          <span className="hidden lg:inline-flex">
            <Chip isCode>agent/add-a-terminal</Chip>
          </span>
        </div>
        <span className="hidden flex-none lg:inline-flex">
          <Chip>
            <StatusDot status="running" />
            <span className="pl-0.5">PR #64 · checks passed</span>
          </Chip>
        </span>
        <div className="ml-auto flex items-center gap-1 sm:ml-0">
          <TopBarIcon name="square-check" badge="3/4" />
          <TopBarIcon name="server" />
          <TopBarIcon name="square-terminal" isActive />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col justify-end gap-3 px-4 pt-5 pb-4 text-left sm:px-7">
          <div className="max-w-[420px] self-end rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 text-sm leading-[22px] text-fg">
            Add a terminal drawer that opens a shell in the session&apos;s folder.
          </div>
          <div className="flex items-center gap-2 text-xs leading-4 text-fg-muted">
            <Icon name="chevron-right" />
            Ran 2 commands, read 3 files
          </div>
          <p className="m-0 max-w-[620px] text-sm leading-[22px] text-fg-secondary">
            The drawer opens under the chat with one shell per tab, kept for each folder.
          </p>
          <div className="max-w-[620px]">
            <DiffCard path="src/components/terminal/TerminalDrawer.tsx" added={3} removed={1} lines={DRAWER_DIFF} />
          </div>
          <div className="max-w-[620px]">
            <PermissionCard title="Claude Code wants to run a command" command="pnpm test" />
          </div>
          <Composer />
        </div>
      </div>
    </div>
  );
}
