import type { ReactNode } from "react";

export interface ChipProps {
  /** Plain: session info (branch, pull request). Outline: a contextual chip you can click. */
  variant?: "plain" | "outline";
  /** `bar`: the 28px chip the top bar's contextual actions (Plan, background tasks, diff) use; the default is 24px. */
  size?: "sm" | "bar";
  /** 12px text on a 24px chip, for the verification badge; the size sets it otherwise. */
  textSize?: "ui-sm";
  icon?: ReactNode;
  /** Makes the chip a button. */
  onClick?: () => void;
  /** The accessible name when the visible text is not enough (the diff chip). */
  label?: string;
  /** For a chip that opens a popover: what it opens, and whether it is open. */
  "aria-haspopup"?: "dialog" | "menu";
  "aria-expanded"?: boolean;
  /** A tooltip with more than the chip shows (a pull request's title). */
  title?: string;
  className?: string;
  children: ReactNode;
}

const BASE = "inline-flex items-center gap-1.5 rounded-md border whitespace-nowrap text-fg-secondary";
const HEIGHTS = { sm: "h-6", bar: "h-7" } as const;
const TEXT_SIZES = { sm: "text-caption", bar: "text-ui-sm" } as const;
// Plain chips are session info, borderless and tight (0 4px); outline chips are actions.
const VARIANTS = {
  plain: { sm: "border-transparent px-1", bar: "border-transparent px-1" },
  outline: { sm: "border-border px-2", bar: "border-border px-2.5" },
} as const;
// An open chip (its popover showing) is filled and edged, as the canvas draws it.
const ACTION =
  "focus-ring transition-colors enabled:hover:bg-surface-hover aria-expanded:bg-surface-hover aria-expanded:border-border-strong";

/** A 24px chip (28px with `size="bar"`) for session info and contextual actions in the top bar. */
export function Chip({
  variant = "outline",
  size = "sm",
  textSize,
  icon,
  onClick,
  label,
  "aria-haspopup": hasPopup,
  "aria-expanded": isExpanded,
  title,
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
  const text = textSize === "ui-sm" ? "text-ui-sm" : TEXT_SIZES[size];
  const classes = [BASE, HEIGHTS[size], text, VARIANTS[variant][size], onClick && ACTION, className]
    .filter(Boolean)
    .join(" ");
  if (!onClick) {
    return (
      <span className={classes} aria-label={label} title={title}>
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
      title={title}
      aria-haspopup={hasPopup}
      aria-expanded={isExpanded}
    >
      {content}
    </button>
  );
}
