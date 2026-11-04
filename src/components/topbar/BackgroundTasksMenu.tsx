import { useEffect, useState } from "react";
import { Bot, Terminal, Users, ListChecks, type LucideIcon } from "lucide-react";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Popover, PopoverHeader } from "../ui/Popover";
import { formatElapsed, type BackgroundTask, type BackgroundTaskKind } from "../../lib/background-tasks";

export interface BackgroundTasksMenuProps {
  tasks: BackgroundTask[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenTask: (task: BackgroundTask) => void;
  onStopTask: (task: BackgroundTask) => Promise<boolean>;
}

const TICK_MS = 1000;

const KIND_ICONS: Record<BackgroundTaskKind, LucideIcon> = {
  agent: Bot,
  shell: Terminal,
  subagent: Users,
};

const STATUS_CLASSES: Record<BackgroundTask["status"], string> = {
  Working: "text-status-running",
  Running: "text-status-running",
  "Needs approval": "text-status-attention",
};

/** The current time, refreshed every second while `isActive`. */
function useNow(isActive: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  const [wasActive, setWasActive] = useState(isActive);
  // Refreshed while rendering, so the first frame after opening is not stale.
  if (isActive !== wasActive) {
    setWasActive(isActive);
    if (isActive) setNow(Date.now());
  }
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [isActive]);
  return now;
}

/**
 * What runs in the background, as a top bar chip ("2 background tasks") that
 * shows only while something runs; it opens each task with Open and Stop.
 */
export function BackgroundTasksMenu({ tasks, isOpen, onOpenChange, onOpenTask, onStopTask }: BackgroundTasksMenuProps) {
  const count = tasks.length;
  const isShown = isOpen && count > 0;
  const now = useNow(isShown);
  const [stoppingIds, setStoppingIds] = useState<ReadonlySet<string>>(new Set());

  // A task that is gone is no longer stopping; if it comes back it is a new run.
  useEffect(() => {
    setStoppingIds((current) => {
      const present = new Set(tasks.map((t) => t.id));
      const kept = [...current].filter((id) => present.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [tasks]);

  // With the last task gone the chip goes too, and the next task must not find it open.
  useEffect(() => {
    if (isOpen && count === 0) onOpenChange(false);
  }, [isOpen, count, onOpenChange]);

  if (count === 0) return null;

  const stop = (task: BackgroundTask) => {
    setStoppingIds((current) => new Set(current).add(task.id));
    void onStopTask(task).then((isStopped) => {
      if (isStopped) return;
      setStoppingIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    });
  };

  return (
    <Popover
      isOpen={isShown}
      onClose={() => onOpenChange(false)}
      label="Background tasks"
      role="dialog"
      align="end"
      className="w-96 select-text"
      trigger={
        <Chip
          icon={<ListChecks size={12} />}
          aria-haspopup="dialog"
          aria-expanded={isShown}
          onClick={() => onOpenChange(!isOpen)}
        >
          {count} {count === 1 ? "background task" : "background tasks"}
        </Chip>
      }
    >
      <PopoverHeader>Background tasks · {count} running</PopoverHeader>
      <ul aria-label="Running tasks" className="max-h-80 overflow-y-auto">
        {tasks.map((task) => {
          const Icon = KIND_ICONS[task.kind];
          const isStopping = stoppingIds.has(task.id);
          const canOpen = task.kind === "agent" || task.kind === "subagent";
          return (
            <li key={task.id} className="flex items-center gap-2.5 rounded px-2 py-2">
              <Icon size={14} aria-hidden="true" className="shrink-0 text-fg-muted" />
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate text-ui font-medium text-fg ${task.kind === "shell" ? "font-mono" : ""}`}
                  title={task.name}
                >
                  {task.name}
                </p>
                {task.detail && (
                  <p className="truncate text-caption text-fg-muted" title={task.detail}>
                    {task.detail}
                  </p>
                )}
                <p className="flex items-center gap-1.5 text-caption text-fg-muted">
                  <span className={STATUS_CLASSES[task.status]}>{task.status}</span>
                  <span className="tabular-nums">{formatElapsed(now - task.startedAt)}</span>
                </p>
              </div>
              {canOpen && (
                <Button
                  variant="outline"
                  aria-label={`Open ${task.name}`}
                  className="shrink-0"
                  onClick={() => {
                    onOpenTask(task);
                    onOpenChange(false);
                  }}
                >
                  Open
                </Button>
              )}
              {(task.kind === "agent" || task.pid !== undefined) && (
                <Button
                  variant="outline"
                  aria-label={`Stop ${task.name}`}
                  className="shrink-0"
                  disabled={isStopping}
                  onClick={() => stop(task)}
                >
                  {isStopping ? "Stopping…" : "Stop"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="border-t border-border px-2 pt-1.5 text-caption text-fg-muted">
        Tasks keep running when you switch sessions.
      </p>
    </Popover>
  );
}
