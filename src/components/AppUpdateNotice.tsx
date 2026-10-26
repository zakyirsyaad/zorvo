import { downloadPercent, restartWarning, type AppUpdateInfo, type AppUpdateProgress } from '../lib/app-update';
import { Button } from './ui/Button';
import { NOTICE_BANNER_LAYOUT } from './ui/noticeBannerStyle';

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

/** Tells the user a newer Zorvo exists and offers to install it and restart. */
export function AppUpdateNotice({
  update,
  busyCount = 0,
  terminalCount = 0,
  isInstalling,
  progress,
  onInstall,
  onLater,
}: AppUpdateNoticeProps) {
  if (!update) return null;
  const percent = downloadPercent(progress);
  const warning = restartWarning(busyCount, terminalCount);
  return (
    <div role="status" className={`bg-surface-2 text-fg-secondary ${NOTICE_BANNER_LAYOUT}`}>
      <span className="break-words">
        {isInstalling ? (
          <>
            Updating…
            {/* Shown, not announced: a screen reader would read every percent of the download. */}
            {percent !== null && <span aria-hidden="true"> {percent}%</span>}
          </>
        ) : (
          `Zorvo ${update.version} is available.`
        )}
        {warning && ` ${warning}`}
      </span>
      <span className="ml-3 flex shrink-0 gap-2">
        <Button variant="primary" onClick={onInstall} disabled={isInstalling}>
          Update &amp; restart
        </Button>
        {!isInstalling && (
          <Button variant="ghost" onClick={onLater}>Later</Button>
        )}
      </span>
    </div>
  );
}
