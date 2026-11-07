import type { ReactNode } from "react";
import type { AgentName } from "../../lib/agent-logos";
import { AgentLogo } from "../ui/AgentLogo";
import { Icon, type IconName } from "../ui/Icon";

/*
 * Pieces of the app drawn for the page's pictures, after the app's own design
 * system (docs/design-system/components/). They sit inside a role="img"
 * container that carries the description, so nothing here is focusable or
 * announced: the "buttons" are spans that only look like the app's.
 */

export type Status = "running" | "attention" | "unread";

const DOT: Record<Status, string> = {
  running: "bg-status-running animate-pulse-dot",
  attention: "bg-status-attention",
  unread: "bg-status-unread",
};

/** `isStill` for session rows, whose dot never pulses in the app. */
export function StatusDot({ status, isStill = false }: { status: Status; isStill?: boolean }) {
  const look = isStill ? DOT[status].replace(" animate-pulse-dot", "") : DOT[status];
  return <span className={`inline-block size-1.5 flex-none rounded-full ${look}`} />;
}

/** A status in words with its dot in front, as session rows and compare cards show it. */
export function StatusLine({ status, children, className = "" }: { status?: Status; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      {status && <StatusDot status={status} />}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** The turning arc the app draws for something that runs. */
export function Spinner({ size = 12, className = "" }: { size?: 12 | 14; className?: string }) {
  return (
    <span className={`inline-flex motion-safe:animate-spin ${className}`}>
      <Icon name="arc" size={size} />
    </span>
  );
}

export type SignInState = "ready" | "sign-in" | "not-checked";

const SIGN_IN_STATE: Record<SignInState, { label: string; text: string; dot: string }> = {
  ready: { label: "Ready", text: "text-fg-muted", dot: "bg-status-running" },
  "sign-in": { label: "Sign in", text: "text-status-attention", dot: "bg-status-attention" },
  "not-checked": { label: "Not checked", text: "text-fg-subtle", dot: "bg-fg-subtle" },
};

/** An agent's sign-in readiness, as the Agents menu and Settings show it: a dot and a word. */
export function SignInBadge({ state }: { state: SignInState }) {
  const { label, text, dot } = SIGN_IN_STATE[state];
  return (
    <span className={`inline-flex flex-none items-center gap-[5px] rounded-md border border-border px-1.5 text-[11px] leading-[18px] ${text}`}>
      <span className={`size-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

type FakeButtonVariant = "primary" | "outline" | "ghost" | "danger";

// As in the app since 0.9: outline and ghost buttons are regular weight, primary and danger medium.
const FAKE_BUTTON: Record<FakeButtonVariant, string> = {
  primary: "border-transparent bg-primary font-medium text-on-primary",
  outline: "border-border-strong",
  ghost: "border-transparent",
  danger: "border-transparent bg-danger-surface font-medium text-danger",
};

// Outline and ghost take their text colour here, so a pressed or emphasised button never carries two.
const QUIET_TEXT = { rest: "text-fg-secondary", strong: "text-fg", pressed: "bg-surface-hover text-fg" } as const;

const HEIGHT = { sm: "h-6 px-2", md: "h-7 px-3", lg: "h-8 px-3" } as const;

interface FakeButtonProps {
  variant: FakeButtonVariant;
  icon?: IconName;
  /** 28px, the app's default; 24px for the buttons inside a row; 32px beside a search field. */
  size?: keyof typeof HEIGHT;
  /** Outline and ghost only: `strong` for the update card's text in fg, `pressed` for an open or picked button. */
  emphasis?: keyof typeof QUIET_TEXT;
  children?: ReactNode;
}

export function FakeButton({ variant, icon, size = "md", emphasis = "rest", children }: FakeButtonProps) {
  const isQuiet = variant === "outline" || variant === "ghost";
  const text = isQuiet ? QUIET_TEXT[emphasis] : "";
  return (
    <span
      className={`inline-flex flex-none items-center justify-center gap-1.5 rounded-lg border text-xs leading-4 whitespace-nowrap ${HEIGHT[size]} ${FAKE_BUTTON[variant]} ${text}`}
    >
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

/** `+N −N` in mono, each only when it is not zero. */
export function LineCounts({ added, removed, className = "" }: { added: number; removed: number; className?: string }) {
  return (
    <span className={`inline-flex flex-none gap-1.5 font-mono text-[11px] leading-4 ${className}`}>
      {added > 0 && <span className="text-status-running">+{added}</span>}
      {removed > 0 && <span className="text-danger">−{removed}</span>}
    </span>
  );
}

export interface ChangedFile {
  path: string;
  added: number;
  removed: number;
}

interface PermissionCardProps {
  /** One sentence that says who wants what: "Claude Code wants to run pnpm test". */
  title: string;
  command?: string;
  files?: ChangedFile[];
}

/** The app's permission request: what the agent wants, then the agent's own choices, safe one first. */
export function PermissionCard({ title, command, files }: PermissionCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-attention-border bg-attention-surface p-3.5 text-left sm:p-4">
      <div className="flex items-start gap-2 text-[13px] leading-[18px] font-semibold text-fg">
        <Icon name="triangle-alert" className="mt-0.5 text-status-attention" />
        {title}
      </div>
      {command && (
        <pre className="m-0 rounded-lg border border-border bg-bg p-2.5 font-mono text-xs leading-[18px] break-all whitespace-pre-wrap text-fg-secondary">
          {command}
        </pre>
      )}
      {files && (
        <div className="flex flex-col rounded-lg border border-border bg-bg">
          {files.map((file, index) => (
            <div
              key={file.path}
              className={`flex items-center justify-between gap-3 px-2.5 py-1.5 ${index > 0 ? "border-t border-border" : ""}`}
            >
              <span className="truncate font-mono text-xs leading-[18px] text-fg-secondary">{file.path}</span>
              <LineCounts added={file.added} removed={file.removed} />
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <FakeButton variant="ghost">Deny</FakeButton>
        <FakeButton variant="outline">Always allow</FakeButton>
        <FakeButton variant="primary">Allow once</FakeButton>
      </div>
    </div>
  );
}

/** A run of tool calls folded into one card, with the file the agent touched last. */
export function ToolRunCard({ summary, last }: { summary: string; last: ChangedFile }) {
  return (
    <div className="flex h-[34px] items-center justify-between gap-3 rounded-lg bg-surface-1 px-3 text-xs leading-4">
      <span className="flex min-w-0 items-center gap-1.5 text-fg-secondary">
        <Icon name="chevron-right" size={12} className="text-fg-muted" />
        <span className="truncate">{summary}</span>
      </span>
      <span className="hidden min-w-0 items-center gap-1.5 font-mono text-[11px] text-fg-subtle sm:flex">
        <span className="truncate">{last.path}</span>
        <LineCounts added={last.added} removed={last.removed} />
      </span>
    </div>
  );
}

/** The agent's message header: its logo, its name and the time. */
export function AgentHeader({ agent, time }: { agent: AgentName; time: string }) {
  return (
    <div className="flex items-center gap-2">
      <AgentLogo agent={agent} size={16} />
      <span className="text-xs leading-4 font-medium text-fg-secondary">{agent}</span>
      <span className="text-[11px] leading-4 text-fg-subtle">{time}</span>
    </div>
  );
}

/** The agents' logos, overlapping, each ringed in the surface it sits on. */
export function LogoStack({ agents, ring = "ring-surface-1" }: { agents: AgentName[]; ring?: string }) {
  return (
    <span className="flex flex-none items-center">
      {agents.map((agent, index) => (
        <span key={agent} className={`inline-flex rounded-[4px] ring-2 ${ring} ${index > 0 ? "-ml-1" : ""}`}>
          <AgentLogo agent={agent} size={16} className="rounded-[4px]" />
        </span>
      ))}
    </span>
  );
}

export interface DiffLine {
  kind: "context" | "added" | "removed" | "hunk";
  text: string;
  /** The new line number (the old one for a removed line). */
  number?: number;
}

const LINE_BG: Record<DiffLine["kind"], string> = {
  context: "",
  hunk: "text-fg-subtle",
  added: "bg-diff-added",
  removed: "bg-diff-removed",
};

const LINE_MARK: Record<DiffLine["kind"], ReactNode> = {
  context: " ",
  hunk: "",
  added: <span className="text-status-running">+</span>,
  removed: <span className="text-danger">−</span>,
};

interface DiffRowsProps {
  lines: DiffLine[];
  /** Tailwind classes for the line-number gutter. */
  gutter?: string;
  /** Text size and line height of the rows. */
  density?: string;
  /** Something drawn under a row, by its index: a saved comment. */
  after?: Record<number, ReactNode>;
}

/** Diff rows with one gutter, as the inspector's file cards and the full review draw them. */
export function DiffRows({ lines, gutter = "w-[30px]", density = "text-[11px] leading-[18px]", after }: DiffRowsProps) {
  return (
    <div className={`py-1 font-mono text-fg-secondary ${density}`}>
      {lines.map((line, index) => (
        <div key={index}>
          <div className={`flex ${LINE_BG[line.kind]}`}>
            <span className={`${gutter} flex-none pr-2 text-right text-fg-subtle`}>{line.number}</span>
            {/* No scroll region inside a picture: a long line wraps on a narrow screen instead. */}
            <span className="min-w-0 pr-3 pl-1 break-all whitespace-pre-wrap">
              {LINE_MARK[line.kind]}
              {line.text}
            </span>
          </div>
          {after?.[index]}
        </div>
      ))}
    </div>
  );
}
