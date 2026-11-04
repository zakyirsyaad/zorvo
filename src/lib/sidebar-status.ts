import type { Session } from "../types";
import type { SessionNode } from "./session-helpers";
import { formatRelativeTime } from "./relative-time";

export type RowTone = "attention" | "running" | "unread";

export interface RowStatus {
  tone: RowTone;
  /** The status in words: the row's second line and its tooltip. */
  label: string;
  /** Only a working agent's dot pulses. */
  pulse: boolean;
}

/**
 * A row's or a folder's actions: shown on hover or focus, and while their menu is open.
 * WebKit does not focus a clicked button, so a menu opened with the mouse would otherwise
 * vanish, still open, when the pointer leaves the row.
 */
export const REVEAL_ON_ROW =
  "opacity-0 pointer-events-none transition-opacity " +
  "group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto " +
  "has-[[role=menu]]:opacity-100 has-[[role=menu]]:pointer-events-auto";

export const DOT_CLASS: Record<RowTone, string> = {
  attention: "bg-status-attention",
  running: "bg-status-running",
  unread: "bg-status-unread",
};

/** A session's status, waiting before working before unread; null when idle. */
export function statusOf(isWaiting: boolean, isBusy: boolean, hasUnread: boolean): RowStatus | null {
  if (isWaiting) return { tone: "attention", label: "Waiting for you", pulse: false };
  if (isBusy) return { tone: "running", label: "Working", pulse: true };
  if (hasUnread) return { tone: "unread", label: "Finished, unread", pulse: false };
  return null;
}

/** What a row says after its agent: the status in words, or how long ago the session started when idle. */
export function rowDetail(status: RowStatus | null, createdAt: number, now: number = Date.now()): string {
  return status?.label ?? formatRelativeTime(createdAt, now);
}

/** A row's second line as one string: the agent, then the status or the time. */
export function rowSubtitle(
  agentName: string | undefined,
  status: RowStatus | null,
  createdAt: number,
  now: number = Date.now(),
): string {
  const detail = rowDetail(status, createdAt, now);
  return agentName ? `${agentName} · ${detail}` : detail;
}

/** Every session in a tree, forks and a run's members included. */
export function sessionsIn(nodes: readonly SessionNode[]): Session[] {
  return nodes.flatMap((node) => {
    const children = sessionsIn(node.children);
    // A run's node stands for its newest member, who is also among its children.
    return node.run ? children : [node.session, ...children];
  });
}

export interface FolderSummary {
  text: string;
  tone: "attention" | "muted";
}

type IsTrue = (sessionId: string) => boolean;

/** What a folded folder says on its header: who waits, else who works, else how many sessions. */
export function folderSummary(sessions: readonly Session[], isWaiting: IsTrue, isBusy: IsTrue): FolderSummary {
  const waiting = sessions.filter((s) => isWaiting(s.id)).length;
  if (waiting > 0) return { text: `${waiting} waiting`, tone: "attention" };
  const working = sessions.filter((s) => isBusy(s.id)).length;
  if (working > 0) return { text: `${working} working`, tone: "muted" };
  return { text: `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`, tone: "muted" };
}

/** A compare run's second line, such as "2 working, 1 finished". */
export function runSummary(sessions: readonly Session[], isWaiting: IsTrue, isBusy: IsTrue): string {
  const waiting = sessions.filter((s) => isWaiting(s.id)).length;
  const working = sessions.filter((s) => !isWaiting(s.id) && isBusy(s.id)).length;
  const finished = sessions.length - waiting - working;
  const parts: [number, string][] = [
    [waiting, "waiting"],
    [working, "working"],
    [finished, "finished"],
  ];
  return parts
    .filter(([count]) => count > 0)
    .map(([count, word]) => `${count} ${word}`)
    .join(", ");
}
