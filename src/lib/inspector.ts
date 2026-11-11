/** The inspector's tabs, in the order they show. */
export type InspectorTab = "changes" | "activity" | "files" | "terminal";

export const INSPECTOR_WIDTH = { min: 320, max: 720, initial: 380, wide: 560, step: 16 } as const;

/** The sidebar's width while it shows. */
export const SIDEBAR_WIDTH = 264;
/** The gap around and between the sheets. */
export const STAGE_INSET = 8;
/**
 * The narrowest the chat column may get before the sidebar gives way. It was 560 when the sidebar was 256px
 * and nothing framed the sheets; the 264px sidebar and the 16px of insets take 24px more, so 536 keeps the
 * same window sizes crowded as before (a 380px inspector still fits beside the sidebar from 1196px wide).
 */
export const MIN_CHAT_WIDTH = 536;

/** A width the inspector may take: rounded, within its bounds, the initial width when not a number. */
export function clampInspectorWidth(px: number): number {
  if (!Number.isFinite(px)) return INSPECTOR_WIDTH.initial;
  return Math.min(INSPECTOR_WIDTH.max, Math.max(INSPECTOR_WIDTH.min, Math.round(px)));
}

/** The Terminal tab, and the Files tab while a file is open in it, need room for a line of code or a shell. */
function isWideTab(tab: InspectorTab, isViewingFile: boolean): boolean {
  return tab === "terminal" || (tab === "files" && isViewingFile);
}

/** The narrowest the main sheet may get beside the inspector, so its top bar is never crushed. */
export const MIN_MAIN_SHEET_WIDTH = 240;

/**
 * The widest the inspector may show in a window this wide: what is left once the sidebar (or the stage's own
 * 8px inset while the sidebar is hidden), the gap and the right inset, and a 240px main sheet are counted.
 */
export function maxInspectorWidth(windowWidth: number, isSidebarShown: boolean): number {
  const left = isSidebarShown ? SIDEBAR_WIDTH : STAGE_INSET;
  return windowWidth - left - 2 * STAGE_INSET - MIN_MAIN_SHEET_WIDTH;
}

/**
 * How wide the inspector shows: none while closed, at least `wide` on the Terminal tab or a file open in Files,
 * and never above `maxWidth` (the cap wins over that minimum and over the remembered width).
 */
export function shownInspectorWidth(
  tab: InspectorTab | null,
  width: number,
  isViewingFile = false,
  maxWidth = Number.POSITIVE_INFINITY,
): number {
  if (tab === null) return 0;
  const wanted = isWideTab(tab, isViewingFile) ? Math.max(INSPECTOR_WIDTH.wide, width) : width;
  return Math.min(wanted, maxWidth);
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

/** True when the sidebar, the inspector, the insets and the narrowest chat column do not all fit. */
export function isCrowded(windowWidth: number, inspectorWidth: number, isSidebarShown: boolean): boolean {
  return isSidebarShown && windowWidth - SIDEBAR_WIDTH - inspectorWidth - 2 * STAGE_INSET < MIN_CHAT_WIDTH;
}
