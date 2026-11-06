import { Button } from "../ui/Button";
import type { CompareModelState } from "../../lib/compare-models";

const STATUS_LINE = "px-2 pt-1 pb-1.5 text-caption";
const SKELETON_ROWS = [0, 1, 2] as const;

/**
 * What a compare chip's menu shows while its agent's model list is not known: the agent being asked, with
 * skeleton rows where its models will land, or that asking failed, with Try again.
 */
export function CompareModelStatus({ name, state, onRetry }: { name: string; state: CompareModelState; onRetry: () => void }) {
  if (state === "failed") {
    return (
      <div>
        <p className={`${STATUS_LINE} text-fg-secondary`}>{`Could not ask ${name} for its models.`}</p>
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <div>
      <p className={`${STATUS_LINE} text-fg-muted`}>{`Asking ${name} for its models…`}</p>
      {SKELETON_ROWS.map((row) => (
        <span
          key={row}
          aria-hidden="true"
          data-skeleton-row=""
          className="my-0.5 block h-7.5 rounded bg-surface-hover motion-safe:animate-pulse"
        />
      ))}
    </div>
  );
}
