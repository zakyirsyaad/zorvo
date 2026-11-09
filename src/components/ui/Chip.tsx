import type { ReactNode } from "react";

export interface ChipProps {
  /** Plain: session info (branch, pull request). Outline: a contextual chip you can click. */
  variant?: "plain" | "outline";
  /** `sm` is the 22px header chip; the default is 24px. */
  size?: "default" | "sm";
  /** The text size: 11px by default, 12px for the verification badge. */
  textSize?: "caption" | "ui-sm";
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
const HEIGHTS = { default: "h-6", sm: "h-[22px]" } as const;
const TEXT_SIZES = { caption: "text-caption", "ui-sm": "text-ui-sm" } as const;
// Plain chips are session info, borderless and tight (0 4px); outline chips are actions.
const VARIANTS = { plain: "border-transparent px-1", outline: "border-border px-2" } as const;
// An open chip (its popover showing) is filled and edged, as the canvas draws it.
const ACTION =
  "focus-ring transition-colors enabled:hover:bg-surface-hover aria-expanded:bg-surface-hover aria-expanded:border-border-strong";

/** A 24px chip for session info and contextual actions in the top bar. */
export function Chip({
  variant = "outline",
  size = "default",
  textSize = "caption",
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
  const classes = [BASE, HEIGHTS[size], TEXT_SIZES[textSize], VARIANTS[variant], onClick && ACTION, className]
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
