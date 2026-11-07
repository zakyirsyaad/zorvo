import { useRef } from 'react';
import { useRevealWhenShown } from '../hooks/useRevealWhenShown';
import { downloadPercent, restartWarning, type AppUpdateInfo, type AppUpdateProgress } from '../lib/app-update';
import { Button } from './ui/Button';

export interface AppUpdateNoticeProps {
  update: AppUpdateInfo | null;
  /** Sessions in the middle of a turn: Zorvo's restart stops them. */
  busyCount?: number;
  /** Terminal shells still running: Zorvo's restart ends them. */
  terminalCount?: number;
  isInstalling: boolean;
  progress: AppUpdateProgress | null;
  onInstall: () => void;
  onLater: () => void;
}

/** A card at the bottom right of the main area: a newer Zorvo is ready, with Update & restart. */
export function AppUpdateNotice({
  update,
  busyCount = 0,
  terminalCount = 0,
  isInstalling,
  progress,
  onInstall,
  onLater,
}: AppUpdateNoticeProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  useRevealWhenShown(cardRef, update?.version);
  if (!update) return null;
  const percent = downloadPercent(progress);
  const warning = restartWarning(busyCount, terminalCount);
  return (
    <div
      ref={cardRef}
      role="status"
      className="flex w-[340px] flex-col gap-3 rounded-xl border border-border bg-surface-3 px-4 py-3.5 shadow-popover"
    >
      <div className="flex flex-col gap-1">
        <p className="text-ui font-semibold text-fg">{`Zorvo ${update.version} is ready`}</p>
        {warning && <p className="text-ui-sm text-fg-muted">{warning}</p>}
        {isInstalling && (
          <p className="text-ui-sm text-fg-muted">
            {progress?.phase === 'installing' ? 'Installing…' : 'Downloading…'}
            {/* Shown, not announced: a screen reader would read every percent of the download. */}
            {percent !== null && <span aria-hidden="true"> {percent}%</span>}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        {!isInstalling && (
          <Button variant="ghost" tone="secondary" onClick={onLater}>
            Later
          </Button>
        )}
        <Button onClick={onInstall} disabled={isInstalling}>
          <span className="text-fg">Update &amp; restart</span>
        </Button>
      </div>
    </div>
  );
}
