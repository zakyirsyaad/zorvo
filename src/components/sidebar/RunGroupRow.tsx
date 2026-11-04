import type { SessionNode } from "../../lib/session-helpers";
import { DOT_CLASS, runSummary, statusOf } from "../../lib/sidebar-status";
import { AgentLogo } from "../AgentLogo";
import type { SessionListContext } from "./SessionList";

/**
 * A compare run's heading, two lines like a session row: its agents' logos and its task,
 * then "Compare · N agents" with who is waiting, working and finished. A click opens its panel.
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
  const detail = `Compare · ${members.length} agents · ${summary}`;
  const isActive = context.activeRunId === run.id;
  return (
    <div
      data-testid={`run-group-${run.id}`}
      className={`relative flex h-11 items-center rounded-md transition-colors ${
        isActive ? "bg-surface-hover text-fg" : "text-fg-muted hover:bg-surface-hover hover:text-fg-secondary"
      }`}
    >
      <button
        type="button"
        onClick={() => context.onOpenRun?.(run.id)}
        aria-current={isActive ? "true" : undefined}
        title={[run.name, detail].join(" · ")}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left focus-ring"
      >
        <span
          aria-hidden="true"
          className={`size-1.5 shrink-0 rounded-full ${status ? DOT_CLASS[status.tone] : ""} ${
            status?.pulse ? "motion-safe:animate-pulse" : ""
          }`}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            {/* Decorative: the words name the run, so the logos stay out of the button's name. */}
            <span aria-hidden="true" className="flex shrink-0 -space-x-1">
              {members.map((member) => (
                <span key={member.id} className="flex rounded-full bg-surface-1 ring-1 ring-surface-1">
                  <AgentLogo
                    profileId={member.profileId}
                    name={context.agentNameOf(member.profileId) ?? member.profileId}
                    size={12}
                  />
                </span>
              ))}
            </span>
            <span className="truncate text-ui">{run.name}</span>
          </span>
          <span className="truncate text-caption text-fg-subtle">{detail}</span>
        </span>
      </button>
    </div>
  );
}
