import type { SessionNode } from "../../lib/session-helpers";
import { DOT_CLASS, runSummary, statusOf } from "../../lib/sidebar-status";
import { AgentLogo } from "../AgentLogo";
import type { SessionListContext } from "./SessionList";

/**
 * A compare run's heading, two lines like a session row: "Compare · N agents" over who is waiting,
 * working and finished, with its agents' logos on the right. The task names the run in its
 * accessible name and tooltip. A click opens its panel.
 */
export function RunGroupRow({ node, context }: { node: SessionNode; context: SessionListContext }) {
  const run = node.run;
  if (!run) return null;
  // Counted from the run, not from the rows a search leaves.
  const members = run.sessions;
  const status = statusOf(
    members.some((member) => context.isSessionWaiting(member.id)),
    members.some((member) => context.isSessionBusy(member.id)),
    members.some((member) => member.hasUnread),
  );
  const summary = runSummary(members, context.isSessionWaiting, context.isSessionBusy);
  const count = `Compare · ${members.length} agents`;
  const isActive = context.activeRunId === run.id;
  return (
    <div
      data-testid={`run-group-${run.id}`}
      className={`relative flex items-start rounded-md transition-colors ${
        isActive ? "bg-surface-hover" : "hover:bg-surface-hover"
      }`}
    >
      <button
        type="button"
        onClick={() => context.onOpenRun?.(run.id)}
        aria-current={isActive ? "true" : undefined}
        aria-label={`${run.name}, ${count}, ${summary}`}
        title={[run.name, count, summary].join(" · ")}
        className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md p-2 text-left focus-ring"
      >
        <span aria-hidden="true" className={`mt-1.5 size-1.5 shrink-0 rounded-full ${status ? DOT_CLASS[status.tone] : ""}`} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={`truncate text-ui ${isActive ? "font-medium text-fg" : "text-fg-secondary"}`}>{count}</span>
          <span className={`truncate text-caption ${isActive ? "text-fg-muted" : "text-fg-subtle"}`}>{summary}</span>
        </span>
        {/* Decorative: the words name the run, so the logos stay out of the button's name. */}
        <span aria-hidden="true" className="mt-0.5 flex shrink-0 -space-x-1">
          {members.map((member) => (
            <span key={member.id} className="flex rounded-[4px] bg-ground ring-2 ring-ground">
              <AgentLogo
                profileId={member.profileId}
                name={context.agentNameOf(member.profileId) ?? member.profileId}
                size={16}
              />
            </span>
          ))}
        </span>
      </button>
    </div>
  );
}
