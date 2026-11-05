/** The inspector's tabs, in the order they show. */
export type InspectorTab = "changes" | "activity" | "files" | "terminal";

export const INSPECTOR_WIDTH = { min: 320, max: 720, initial: 380, wide: 560, step: 16 } as const;

/** The sidebar's width while it shows. */
export const SIDEBAR_WIDTH = 256;
/** The narrowest the chat column may get before the sidebar gives way. */
export const MIN_CHAT_WIDTH = 560;

/** A width the inspector may take: rounded, within its bounds, the initial width when not a number. */
export function clampInspectorWidth(px: number): number {
  if (!Number.isFinite(px)) return INSPECTOR_WIDTH.initial;
  return Math.min(INSPECTOR_WIDTH.max, Math.max(INSPECTOR_WIDTH.min, Math.round(px)));
}

/** The Terminal tab, and the Files tab while a file is open in it, need room for a line of code or a shell. */
function isWideTab(tab: InspectorTab, isViewingFile: boolean): boolean {
  return tab === "terminal" || (tab === "files" && isViewingFile);
}

/** How wide the inspector shows: none while closed, at least `wide` on the Terminal tab or a file open in Files. */
export function shownInspectorWidth(tab: InspectorTab | null, width: number, isViewingFile = false): number {
  if (tab === null) return 0;
  return isWideTab(tab, isViewingFile) ? Math.max(INSPECTOR_WIDTH.wide, width) : width;
}

/** The narrowest a tab shows: `wide` on the Terminal tab or a file open in Files, else the inspector's own minimum. */
export function minInspectorWidth(tab: InspectorTab, isViewingFile = false): number {
  return isWideTab(tab, isViewingFile) ? INSPECTOR_WIDTH.wide : INSPECTOR_WIDTH.min;
}

/** The tabs that apply: Changes in a repository, Activity with a session, Files and Terminal with a folder. */
export function offeredTabs(on: { hasFolder: boolean; isRepository: boolean; hasSession: boolean }): InspectorTab[] {
  const tabs: InspectorTab[] = [];
  if (on.hasFolder && on.isRepository) tabs.push("changes");
  if (on.hasSession) tabs.push("activity");
  if (on.hasFolder) tabs.push("files", "terminal");
  return tabs;
}

/** True when the sidebar, the inspector and the narrowest chat column do not all fit. */
export function isCrowded(windowWidth: number, inspectorWidth: number, isSidebarShown: boolean): boolean {
  return isSidebarShown && windowWidth - SIDEBAR_WIDTH - inspectorWidth < MIN_CHAT_WIDTH;
}
