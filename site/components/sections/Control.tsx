import type { ReactNode } from "react";
import { PermissionCard, Spinner, type ChangedFile } from "../mockups/parts";
import { Icon, type IconName } from "../ui/Icon";
import { SectionIntro } from "../ui/SectionIntro";

const POINTS: { icon: IconName; title: string; body: ReactNode }[] = [
  {
    icon: "shield-check",
    title: "Approvals in the chat",
    body: "Deny, always allow or allow once, as the agent offers, with the files an edit touches and their changed lines. Each session starts in the safest mode its agent has, and a mode that skips approvals carries a shield.",
  },
  {
    icon: "list-checks",
    title: "The plan in the top bar",
    body: "The agent's plan shows as 2/4 beside the session's title. Open it to see which step runs now.",
  },
  {
    icon: "server",
    title: "Background tasks",
    body: "Each running shell command and subagent gets its own row, with how long it has run. Open one, or stop it.",
  },
  {
    icon: "activity",
    title: "What the agent did, turn by turn",
    body: "The Activity tab lists the files, commands and permissions the agent reported, with a jump to each in the chat. Files git shows as changed that the agent did not report are listed apart.",
  },
  {
    icon: "gauge",
    title: "Context in plain words",
    body: "The composer reads 38% of context, turns amber from 80%, and opens the numbers behind it.",
  },
];

type PlanState = "done" | "current" | "pending";

const PLAN: { step: string; state: PlanState }[] = [
  { step: "Read the session list", state: "done" },
  { step: "Keep pinned sessions visible", state: "current" },
  { step: "Add a test", state: "pending" },
  { step: "Run the tests", state: "pending" },
];

const EDITS: ChangedFile[] = [
  { path: "src/components/sidebar/SessionList.tsx", added: 3, removed: 1 },
  { path: "src/test/session-list.test.tsx", added: 14, removed: 0 },
];

const PLAN_ROW: Record<PlanState, string> = {
  done: "text-fg-muted",
  current: "bg-surface-hover text-fg",
  pending: "text-fg-secondary",
};

function PlanMarker({ state }: { state: PlanState }) {
  if (state === "done") return <Icon name="circle-check" className="text-fg-muted" />;
  if (state === "current") return <Spinner className="mx-px text-status-running" />;
  return <Icon name="circle" className="text-fg-subtle" />;
}

/** The agent's plan, as the top bar's popover lists it: one step done, the next one running. */
function PlanPopover() {
  const done = PLAN.filter(({ state }) => state === "done").length;
  return (
    <div className="flex w-full max-w-[340px] flex-col gap-1 self-end rounded-xl border border-border bg-surface-3 p-2 shadow-popover">
      <div className="flex items-center justify-between px-2 pt-1 pb-1.5 text-xs leading-4">
        <span className="font-medium text-fg">Plan from Codex</span>
        <span className="text-fg-subtle">
          {done} of {PLAN.length} done
        </span>
      </div>
      {PLAN.map(({ step, state }) => (
        <div key={step} className={`flex h-[30px] items-center gap-2 rounded-md px-2 text-xs leading-4 ${PLAN_ROW[state]}`}>
          <PlanMarker state={state} />
          <span>{step}</span>
        </div>
      ))}
    </div>
  );
}

export function Control() {
  return (
    <section id="control" aria-labelledby="control-title" className="border-t border-border py-[72px] md:py-28">
      <div className="site-wrap flex flex-wrap items-center gap-12 lg:gap-16">
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-8">
          <SectionIntro
            id="control-title"
            eyebrow="control"
            title="You approve every step."
            lead="Permission requests arrive with the agent's own choices. Its plan stays in sight, and every step it took is in its activity."
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
          aria-label="Codex's plan, one of four steps done and the second running, above the permission request it waits on: Codex wants to edit two files, with their added and removed lines, and Deny, Always allow and Allow once."
          className="flex min-w-0 flex-[1_1_480px] flex-col gap-4 rounded-xl border border-border bg-surface-1 p-4 sm:p-7"
        >
          <PlanPopover />
          <PermissionCard title="Codex wants to edit 2 files" files={EDITS} />
        </div>
      </div>
    </section>
  );
}
