import type { AgentName } from "../../lib/agent-logos";
import { FakeButton, LineCounts, LogoStack, StatusLine, type Status } from "../mockups/parts";
import { AgentLogo } from "../ui/AgentLogo";
import { Icon } from "../ui/Icon";
import { type Point, PointList } from "../ui/PointList";
import { SectionIntro } from "../ui/SectionIntro";

const POINTS: Point[] = [
  {
    icon: "git-branch",
    title: "Each agent in its own worktree",
    body: "Every agent gets its own copy of the repository on its own branch, in the safest mode it has, so none of them edits your checkout or another agent's files.",
  },
  {
    icon: "sliders-horizontal",
    title: "A model for each agent",
    body: "The composer shows one model chip per agent. Zorvo asks an agent for its models only when you open its chip.",
  },
  {
    icon: "square-check",
    title: "Pick keeps one",
    body: "Read each agent's changes, answer its permissions from the run, then Pick. Zorvo asks first, stops and archives the others, and keeps their worktrees.",
  },
];

interface RunRow {
  agent: AgentName;
  status?: Status;
  words: string;
  files?: number;
  added?: number;
  removed?: number;
}

const RUN: RunRow[] = [
  { agent: "Claude Code", status: "running", words: "Working · 12 min", files: 3, added: 58, removed: 14 },
  { agent: "Codex", words: "Finished · 8 min", files: 4, added: 120, removed: 31 },
  { agent: "Qwen Code", status: "attention", words: "Waiting for you · 2 min" },
];

const AGENTS = RUN.map(({ agent }) => agent);

/** The new-session draft with three agents ticked: its chips and its Start button. */
function DraftPicture() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-3 shadow-popover">
      <div className="flex flex-wrap gap-2 text-xs leading-4 text-fg-secondary">
        <span className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-2.5">
          <Icon name="folder" size={12} className="text-fg-muted" />
          zorvo
        </span>
        <span className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-2.5">
          <Icon name="git-branch" size={12} className="text-fg-muted" />
          <span className="font-mono text-[11px]">main</span>
        </span>
        <span className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-2.5">
          <LogoStack agents={AGENTS} ring="ring-surface-1" />
          3 agents <span className="text-fg-subtle">· compare</span>
        </span>
      </div>
      <span className="text-sm leading-[22px] text-fg">Make the session list work from the keyboard.</span>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] leading-4 text-fg-subtle">
          Each agent starts in its safest mode, in its own worktree.
        </span>
        <FakeButton variant="primary">
          Start 3 sessions
          <Icon name="arrow-up" size={12} />
        </FakeButton>
      </div>
    </div>
  );
}

function RunRowPicture({ row, isPicking }: { row: RunRow; isPicking?: boolean }) {
  const hasChanges = row.files !== undefined;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-xl border bg-surface-2 px-4 py-3.5 ${isPicking ? "border-border-strong" : "border-border"}`}
    >
      <span className="grid size-7 flex-none place-items-center rounded-[7px] bg-surface-hover">
        <AgentLogo agent={row.agent} size={16} />
      </span>
      <span className="flex min-w-[150px] flex-1 flex-col">
        <span className="truncate text-[13px] leading-[18px] font-medium text-fg">{row.agent}</span>
        <StatusLine status={row.status} className="text-xs leading-4 text-fg-secondary">
          {row.words}
        </StatusLine>
      </span>
      <span className="flex flex-none items-center gap-2">
        {hasChanges ? (
          <span className="inline-flex h-[26px] items-center gap-1.5 px-2 font-mono text-[11px] text-fg-muted">
            {row.files} files
            <LineCounts added={row.added ?? 0} removed={row.removed ?? 0} />
          </span>
        ) : (
          <span className="px-2 text-xs leading-4 text-fg-subtle">No changes yet</span>
        )}
        <FakeButton variant="ghost" size="sm">Open</FakeButton>
        <FakeButton variant="outline" size="sm" emphasis={isPicking ? "pressed" : "rest"}>
          Pick
        </FakeButton>
      </span>
    </div>
  );
}

function RunPicture() {
  return (
    <div
      role="img"
      aria-label="A compare run. The new session has three agents ticked and a Start 3 sessions button. Below, the run: Claude Code working for 12 minutes with 3 changed files, Codex finished after 8 minutes with 4 changed files, and Qwen Code waiting for you. Pick is pressed on Codex, and a bar asks to keep Codex and stop Claude Code mid-turn."
      className="flex min-w-0 flex-[1_1_520px] flex-col gap-4 rounded-xl border border-border bg-surface-1 p-4 text-left sm:p-7 lg:order-first"
    >
      <DraftPicture />
      <div className="flex flex-col gap-1 pt-2">
        <span className="text-lg leading-6 font-semibold tracking-[-0.02em] text-fg">Make the session list work from the keyboard</span>
        <span className="text-xs leading-4 text-fg-muted">3 agents, each in its own worktree · started 12 min ago</span>
      </div>
      <div className="flex flex-col gap-2">
        <RunRowPicture row={RUN[0]} />
        <RunRowPicture row={RUN[1]} isPicking />
        <RunRowPicture row={RUN[2]} />
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-3 px-4 py-3.5 shadow-popover">
        <span className="min-w-[220px] flex-1 text-[13px] leading-[18px] text-fg">
          Keep Codex? This stops Claude Code mid-turn. Their worktrees stay.
        </span>
        <span className="flex flex-none gap-2">
          <FakeButton variant="ghost">Cancel</FakeButton>
          <FakeButton variant="primary">Pick Codex</FakeButton>
        </span>
      </div>
    </div>
  );
}

export function Compare() {
  return (
    <section id="compare" aria-labelledby="compare-title" className="border-t border-border py-[72px] md:py-28">
      {/* The heading comes first for a screen reader and on a phone; on a wide screen the picture moves to the left. */}
      <div className="site-wrap flex flex-wrap items-center gap-12 lg:gap-16">
        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-8">
          <SectionIntro
            id="compare-title"
            eyebrow="compare"
            title="One prompt. Four agents. Keep the best."
            lead="In a git repository, tick up to four agents on a new session and send them the same prompt. Each works on its own, and you choose whose changes stay."
          />
          <PointList points={POINTS} />
          <p className="t-caption m-0">Each agent runs on its own sign-in and uses its own quota.</p>
        </div>
        <RunPicture />
      </div>
    </section>
  );
}
