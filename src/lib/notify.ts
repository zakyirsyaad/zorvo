import * as notificationPlugin from '@tauri-apps/plugin-notification';
import * as windowApi from '@tauri-apps/api/window';
import type { AttentionReason } from '../hooks/session-engine/useAcpEngine';

export interface AttentionNotice {
  title: string;
  body: string;
  /** Session to open when the user clicks this notification. */
  sessionId?: string;
}

/** Whether any of the app's windows has focus: the main one, or a session popout. */
export async function isAppFocused(): Promise<boolean> {
  if (document.hasFocus()) return true;
  const windows = await windowApi.getAllWindows();
  const focused = await Promise.all(windows.map((window) => window.isFocused()));
  return focused.some(Boolean);
}

/**
 * Shows a system notification, but only while the user is away from the app:
 * when they are looking at any of its windows, the chat already shows what
 * happened. Asks for permission the first time.
 */
export async function notifyIfAway(notice: AttentionNotice): Promise<void> {
  if (await isAppFocused()) return;
  const isGranted =
    (await notificationPlugin.isPermissionGranted()) || (await notificationPlugin.requestPermission()) === 'granted';
  if (!isGranted) return;
  notificationPlugin.sendNotification({
    title: notice.title,
    body: notice.body,
    ...(notice.sessionId ? { extra: { sessionId: notice.sessionId } } : {}),
  });
}

/**
 * Listens for clicks on notifications that carry a `sessionId` payload,
 * brings this window forward, and hands the id to `onSession`.
 */
export function onNotificationSessionClick(onSession: (sessionId: string) => void): () => void {
  const registerAction =
    typeof notificationPlugin === 'object' && notificationPlugin !== null && 'onAction' in notificationPlugin
      ? notificationPlugin.onAction
      : undefined;
  if (typeof registerAction !== 'function') return () => {};
  let disposed = false;
  let unregister: (() => Promise<void>) | null = null;
  void registerAction((event) => {
    const raw = event.notification?.extra?.sessionId;
    if (typeof raw !== 'string' || raw.length === 0) return;
    if (typeof windowApi === 'object' && windowApi !== null && 'getCurrentWindow' in windowApi) {
      const currentWindow = windowApi.getCurrentWindow;
      if (typeof currentWindow === 'function') {
        const win = currentWindow();
        void win.unminimize?.().catch(() => {});
        void win.setFocus?.().catch(() => {});
      }
    }
    onSession(raw);
  })
    .then((listener) => {
      if (disposed) void listener.unregister().catch(() => {});
      else unregister = () => listener.unregister();
    })
    .catch(() => {});

  return () => {
    disposed = true;
    void unregister?.().catch(() => {});
  };
}

/** What a notification says about a session that needs the user or is done. */
export function attentionBody(agentName: string, reason: AttentionReason): string {
  return {
    'needs-answer': `${agentName} needs your answer.`,
    finished: `${agentName} finished.`,
    failed: `${agentName} stopped with an error.`,
  }[reason];
}
