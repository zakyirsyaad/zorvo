import type { ReactNode } from "react";
import { DiffCard, PermissionCard, StatusDot, type DiffLine } from "../mockups/parts";
import { Icon, type IconName } from "../ui/Icon";
import { SectionIntro } from "../ui/SectionIntro";

const POINTS: { icon: IconName; title: string; body: ReactNode }[] = [
  {
    icon: "shield-check",
    title: "Approvals in the chat",
    body: "Allow once, always allow or deny, as the agent offers. Each session starts in the safest mode its agent has, and a mode that skips approvals carries a shield.",
  },
  {
    icon: "file-code",
    title: "A diff of every change",
    body: "Tool calls fold into one line, and a part that changes a file opens on its own so you see the diff.",
  },
  {
    icon: "square-check",
    title: "The plan in the top bar",
    body: "The agent's current plan sits beside Background tasks, with a count of the steps it has done.",
  },
  {
    icon: "server",
    title: "Background tasks",
    body: "Each running shell command and subagent gets its own row, with its session and how long it has run. Open one, or stop it.",
  },
  {
    icon: "gauge",
    title: "Context in plain numbers",
    body: "Tokens used, tokens left and the session's cost, one click away.",
  },
];

const PIN_DIFF: DiffLine[] = [
  { kind: "context", number: 41, text: "  const visible = sessions.filter(" },
  { kind: "removed", number: 42, text: "   (s) => !s.archived," },
  { kind: "added", number: 42, text: "   (s) => !s.archived || s.pinned," },
  { kind: "added", number: 43, text: "  );" },
  { kind: "added", number: 44, text: "  const pinned = visible.filter((s) => s.pinned);" },
];

type PlanState = "done" | "waiting" | "pending";

const PLAN: { step: string; state: PlanState }[] = [
  { step: "Read the session list", state: "done" },
  { step: "Keep pinned sessions visible", state: "waiting" },
  { step: "Add a test", state: "pending" },
  { step: "Run the tests", state: "pending" },
];

function PlanMarker({ state }: { state: PlanState }) {
  if (state === "done") return <Icon name="check" className="text-status-running" />;
  if (state === "waiting") {
    return (
      <span className="mx-1 inline-flex">
        <StatusDot status="attention" />
      </span>
    );
  }
  return (
    <span className="inline-grid size-3.5 flex-none place-items-center">
      <span className="size-2 rounded-full border border-border-strong" />
    </span>
  );
}

const PLAN_TEXT: Record<PlanState, string> = {
  done: "text-fg-muted line-through",
  waiting: "text-fg",
  pending: "text-fg-subtle",
};

/** The agent's plan, as the top bar's popover lists it: one step done, the next one waiting on you. */
function PlanPopover() {
  const done = PLAN.filter(({ state }) => state === "done").length;
  return (
    <div className="flex w-full max-w-[280px] flex-col gap-2 self-end rounded-lg border border-border bg-surface-3 p-3 shadow-popover">
      <div className="flex items-center justify-between">
        <span className="text-xs leading-4 font-medium text-fg">Plan</span>
        <span className="font-mono text-[11px] leading-4 text-fg-muted">
          {done}/{PLAN.length}
        </span>
      </div>
      {PLAN.map(({ step, state }) => (
        <div key={step} className={`flex items-center gap-2 text-xs leading-4 ${PLAN_TEXT[state]}`}>
          <PlanMarker state={state} />
          <span>{step}</span>
          {state === "waiting" && <span className="t-caption ml-auto">Waiting on you</span>}
        </div>
      ))}
    </div>
  );
}

export function Control() {
  return (
    <section
      id="control"
      aria-labelledby="control-title"
      className="border-t border-border py-[72px] md:py-28"
    >
      <div className="site-wrap flex flex-wrap items-center gap-12 lg:gap-16">
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-8">
          <SectionIntro
            id="control-title"
            eyebrow="control"
            title="You approve every step."
            lead="Permission requests arrive with the agent's own choices. Every file it touches comes with a diff, and its plan stays in sight."
          />
          <ul className="m-0 flex list-none flex-col gap-5 p-0">
            {POINTS.map(({ icon, title, body }) => (
              <li key={title} className="flex gap-3.5">
                <Icon name={icon} size={18} className="mt-[3px] text-fg" />
                <div className="flex flex-col gap-1">
                  <h3 className="t-heading m-0">{title}</h3>
                  <p className="t-body m-0">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div
          role="img"
          aria-label="The agent's plan, one of four steps done and the next waiting on you, the Codex permission request it waits on, and its diff"
          className="flex min-w-0 flex-[1_1_480px] flex-col gap-3.5 rounded-xl border border-border bg-surface-1 p-4 sm:p-7"
        >
          <PlanPopover />
          <PermissionCard
            title="Codex wants to edit a file"
            body="It will update the session list so archived sessions stay pinned."
            command="src/components/SessionList.tsx"
          />
          <DiffCard path="src/components/SessionList.tsx" added={3} removed={1} lines={PIN_DIFF} />
        </div>
      </div>
    </section>
  );
}
