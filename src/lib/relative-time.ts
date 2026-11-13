/**
 * Format a timestamp as how long ago it was, e.g. "Just now", "2 minutes ago",
 * "5 hours ago", "3 days ago". A timestamp in the future reads as "Just now".
 */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const diffSec = Math.floor((now - timestamp) / 1000);
  if (diffSec < 60) return "Just now";
  const ago = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return ago(diffMin, "minute");
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return ago(diffHour, "hour");
  return ago(Math.floor(diffHour / 24), "day");
}

const MONTH = new Intl.DateTimeFormat("en-US", { month: "short" });

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * A short form for a sidebar row: "now", "5 min ago", "2 h ago", "Yesterday", "Oct 28" or
 * "Oct 28, 2025". Hours count only within the same calendar day, so a session from 23:00
 * yesterday reads "Yesterday", not "13 h ago". A timestamp in the future reads "now".
 */
export function formatShortTime(timestamp: number, now: number = Date.now()): string {
  const diffMin = Math.floor((now - timestamp) / 60_000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const today = startOfDay(now);
  if (timestamp >= today) return `${Math.floor(diffMin / 60)} h ago`;
  const dayBefore = new Date(today);
  dayBefore.setDate(dayBefore.getDate() - 1);
  if (timestamp >= dayBefore.getTime()) return "Yesterday";
  const date = new Date(timestamp);
  const day = `${MONTH.format(date)} ${date.getDate()}`;
  return date.getFullYear() === new Date(now).getFullYear() ? day : `${day}, ${date.getFullYear()}`;
}
