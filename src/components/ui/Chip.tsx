import type { ReactNode } from "react";

export interface ChipProps {
  /** Plain: session info (branch, pull request). Outline: a contextual chip you can click. */
  variant?: "plain" | "outline";
  icon?: ReactNode;
  /** Makes the chip a button. */
  onClick?: () => void;
  /** The accessible name when the visible text is not enough (the diff chip). */
  label?: string;
  /** For a chip that opens a popover: what it opens, and whether it is open. */
  "aria-haspopup"?: "dialog" | "menu";
  "aria-expanded"?: boolean;
  className?: string;
  children: ReactNode;
}

const BASE = "inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-caption whitespace-nowrap text-fg-secondary";
const VARIANTS = { plain: "border-transparent", outline: "border-border" } as const;
const ACTION = "focus-ring transition-colors enabled:hover:bg-surface-hover";

/** A 24px chip for session info and contextual actions in the top bar. */
export function Chip({
  variant = "outline",
  icon,
  onClick,
  label,
  "aria-haspopup": hasPopup,
  "aria-expanded": isExpanded,
  className,
  children,
}: ChipProps) {
  const content = (
    <>
      {icon && (
        <span aria-hidden="true" className="flex shrink-0 items-center">
          {icon}
        </span>
      )}
      {children}
    </>
  );
  const classes = [BASE, VARIANTS[variant], onClick && ACTION, className].filter(Boolean).join(" ");
  if (!onClick) {
    return (
      <span className={classes} aria-label={label}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      aria-label={label}
      aria-haspopup={hasPopup}
      aria-expanded={isExpanded}
    >
      {content}
    </button>
  );
}
