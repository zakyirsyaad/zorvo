import { Columns3 } from "lucide-react";
import type { SessionNode } from "../../lib/session-helpers";
import { runSummary, statusOf } from "../../lib/sidebar-status";
import { AgentTile } from "../ui/AgentTile";
import type { SessionListContext } from "./SessionList";

/**
 * A compare run's heading, two lines like a session row: a columns tile with the badge of the run's
 * most urgent state, the run's task, then "Compare" and who is waiting, working and finished. The
 * agent count is in its accessible name and tooltip. A click opens its panel.
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
      className={`group relative flex items-start rounded-lg transition-colors ${
        isActive ? "bg-surface-hover" : "hover:bg-surface-hover"
      }`}
    >
      <button
        type="button"
        onClick={() => context.onOpenRun?.(run.id)}
        aria-current={isActive ? "true" : undefined}
        aria-label={`${run.name}, ${count}, ${summary}`}
        title={[run.name, count, summary].join(" · ")}
        className="flex min-w-0 flex-1 items-start gap-2.5 rounded-lg px-2 py-[7px] text-left focus-ring"
      >
        <AgentTile
          badge={status?.tone}
          badgeOn={isActive ? "hover" : "ground"}
          badgeClassName="group-hover:ring-surface-hover"
          className="mt-px"
        >
          <Columns3 size={12} aria-hidden="true" className="text-fg-muted" />
        </AgentTile>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={`truncate text-ui ${isActive ? "font-medium text-fg" : "text-fg-secondary"}`}>{run.name}</span>
          <span className={`truncate text-caption ${isActive ? "text-fg-muted" : "text-fg-subtle"}`}>{`Compare · ${summary}`}</span>
        </span>
      </button>
    </div>
  );
}
