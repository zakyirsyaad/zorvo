import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  /** Outline: a second action beside the view's one primary (Stop, where Send was). */
  variant?: "ghost" | "primary" | "outline";
  /** 22px and 24px for actions inside a row, 26px (`row`) for the inspector's header and path bars, 28px (the default) for bars. */
  size?: "xs" | "sm" | "row" | "md";
  /** A ghost button's colour: muted (the default) or the secondary text colour the canvas gives row actions. */
  tone?: "muted" | "secondary";
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

const BASE =
  "inline-flex shrink-0 items-center justify-center transition-colors " +
  "focus-ring disabled:cursor-not-allowed " +
  // Open (a menu it opens) or pressed (a panel it shows) reads as a filled button.
  "aria-expanded:bg-surface-hover aria-pressed:bg-surface-hover";

const SIZES: Record<NonNullable<IconButtonProps["size"]>, string> = {
  xs: "h-5.5 w-5.5",
  sm: "h-6 w-6",
  row: "h-6.5 w-6.5",
  md: "h-7 w-7",
};

const TONES: Record<NonNullable<IconButtonProps["tone"]>, string> = {
  muted: "text-fg-muted",
  secondary: "text-fg-secondary",
};

// Like Button: a disabled primary turns flat neutral instead of a faded light fill.
const VARIANTS: Record<NonNullable<IconButtonProps["variant"]>, string> = {
  ghost: "rounded-md enabled:hover:bg-surface-hover enabled:hover:text-fg disabled:opacity-40",
  primary:
    "rounded-lg bg-primary text-on-primary enabled:hover:bg-primary-hover " +
    "disabled:bg-surface-hover disabled:text-fg-muted",
  outline: "rounded-lg border border-border-strong text-fg enabled:hover:bg-surface-hover disabled:opacity-40",
};

export function IconButton({
  label,
  variant = "ghost",
  size = "md",
  tone = "muted",
  className,
  type = "button",
  children,
  ...rest
}: IconButtonProps) {
  const classes = [BASE, SIZES[size], variant === "ghost" && TONES[tone], VARIANTS[variant], className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} aria-label={label} title={label} className={classes} {...rest}>
      {children}
    </button>
  );
}
