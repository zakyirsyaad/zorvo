import { Button } from "./ui/Button";
import type { InstallProgress } from "../hooks/useAgentInstall";
import { describePhase } from "../lib/install-plan";
import { formatSize } from "../lib/file-content";

const PROGRESS_BAR =
  "h-1 w-full appearance-none overflow-hidden rounded-full bg-surface-hover " +
  "[&::-webkit-progress-bar]:bg-surface-hover [&::-webkit-progress-value]:bg-fg-secondary";

type InstallAction = "install" | "update";

/** The step, and how far its download is when the installer knows the size ("18 MB of 42 MB"). */
function stepParts(progress: InstallProgress | null, action: InstallAction): { step: string; size: string | null } {
  if (!progress) return { step: `Starting the ${action}…`, size: null };
  const phase = describePhase(progress.phase, progress.name);
  if (!progress.totalBytes) return { step: phase, size: null };
  // With a measure after it, the step reads as done talking, so it loses its "…".
  return { step: phase.replace(/…$/, ""), size: `${formatSize(progress.receivedBytes)} of ${formatSize(progress.totalBytes)}` };
}

/** "Downloading Node.js · 18 MB of 42 MB": only the step is a live region, so each step is announced and no byte is. */
export function InstallStatus({ progress, action = "install", isCompact = false }: {
  progress: InstallProgress | null;
  action?: InstallAction;
  /** In a list row (Settings' agents), at the row's caption size rather than a card's body size. */
  isCompact?: boolean;
}) {
  const { step, size } = stepParts(progress, action);
  return (
    <p className={`${isCompact ? "text-caption" : "text-ui"} text-fg-muted`}>
      <span role="status">{step}</span>
      {size && <span aria-hidden="true"> · {size}</span>}
    </p>
  );
}

/** The download's bar, once the installer reports one. */
export function InstallBar({ progress }: { progress: InstallProgress | null }) {
  if (!progress) return null;
  return (
    <progress
      aria-label={`${progress.name} download`}
      className={PROGRESS_BAR}
      max={progress.totalBytes || undefined}
      value={progress.totalBytes ? progress.receivedBytes : undefined}
    />
  );
}

/** Cancel, on its own row at the right. */
export function InstallCancel({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="flex justify-end">
      <Button variant="ghost" tone="secondary" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

export interface InstallProgressLineProps {
  progress: InstallProgress | null;
  onCancel: () => void;
  /** What the job is, for the line shown before the first progress report. */
  action?: InstallAction;
}

/** The step, its bar and Cancel, in one block, for a row that has no card around it (Settings' agent list). */
export function InstallProgressLine({ progress, onCancel, action = "install" }: InstallProgressLineProps) {
  return (
    <div className="mt-2 flex flex-col gap-2">
      <InstallStatus progress={progress} action={action} isCompact />
      <InstallBar progress={progress} />
      <InstallCancel onCancel={onCancel} />
    </div>
  );
}
