import { downloadPercent, type AppUpdateInfo, type AppUpdateProgress } from '../lib/app-update';
import { Button } from './ui/Button';
import { NOTICE_BANNER_LAYOUT } from './ui/noticeBannerStyle';

export interface AppUpdateNoticeProps {
  update: AppUpdateInfo | null;
  isInstalling: boolean;
  progress: AppUpdateProgress | null;
  onInstall: () => void;
  onLater: () => void;
}

function installingMessage(progress: AppUpdateProgress | null): string {
  const percent = downloadPercent(progress);
  return percent === null ? 'Updating…' : `Updating… ${percent}%`;
}

/** Tells the user a newer Zorvo exists and offers to install it and restart. */
export function AppUpdateNotice({ update, isInstalling, progress, onInstall, onLater }: AppUpdateNoticeProps) {
  if (!update) return null;
  return (
    <div role="status" className={`bg-surface-2 text-fg-secondary ${NOTICE_BANNER_LAYOUT}`}>
      <span className="break-words">
        {isInstalling ? installingMessage(progress) : `Zorvo ${update.version} is available.`}
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
