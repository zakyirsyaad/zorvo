import type { ReactNode } from "react";

export type Status = "running" | "attention" | "unread" | "merged" | "danger" | "idle";

export interface StatusLineProps {
  status: Status;
  /** The status in words; the dot never stands alone. */
  children: ReactNode;
  className?: string;
}

const DOT: Record<Exclude<Status, "idle">, string> = {
  running: "bg-status-running motion-safe:animate-pulse",
  attention: "bg-status-attention",
  unread: "bg-status-unread",
  merged: "bg-status-merged",
  danger: "bg-danger",
};

/** A status word with its colored dot in front; idle shows the word alone. */
export function StatusLine({ status, children, className }: StatusLineProps) {
  const classes = ["inline-flex items-center gap-1.5", className].filter(Boolean).join(" ");
  return (
    <span className={classes}>
      {status !== "idle" && <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${DOT[status]}`} />}
      {children}
    </span>
  );
}
