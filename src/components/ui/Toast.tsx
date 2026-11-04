import type { ReactNode } from "react";
import { CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";

export type ToastTone = "info" | "warning" | "error";

export interface ToastProps {
  tone?: ToastTone;
  message: string;
  action?: { label: string; onClick: () => void };
  onDismiss: () => void;
}

const CARD = "flex w-[340px] items-start gap-2.5 rounded-[10px] border bg-surface-3 p-3 shadow-popover";
const TONES = {
  info: { border: "border-border", icon: <Info size={15} className="text-fg-muted" /> },
  warning: { border: "border-border", icon: <TriangleAlert size={15} className="text-status-attention" /> },
  error: { border: "border-danger", icon: <CircleAlert size={15} className="text-danger" /> },
} as const;

/** A notice in the corner of the main area: an error is spoken at once, the rest politely. */
export function Toast({ tone = "warning", message, action, onDismiss }: ToastProps) {
  const { border, icon } = TONES[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`${CARD} ${border}`}>
      <span aria-hidden="true" className="mt-0.5 flex shrink-0">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <p className="min-w-0 text-ui text-fg break-words [overflow-wrap:anywhere]">{message}</p>
        {action && <Button onClick={action.onClick}>{action.label}</Button>}
      </div>
      <IconButton label="Dismiss notice" onClick={onDismiss} className="-mt-1 -mr-1 shrink-0">
        <X size={13} />
      </IconButton>
    </div>
  );
}

/** Holds the toasts at the bottom right of the main area, which must be `relative`. */
export function ToastStack({ children }: { children: ReactNode }) {
  return <div className="absolute right-5 bottom-5 z-40 flex flex-col gap-2.5">{children}</div>;
}
