import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

export type ButtonVariant = "primary" | "outline" | "ghost" | "danger";

/**
 * The canvas's button heights: 24px for a small action in a row, 26px (`row`) in the inspector's path bars,
 * 28px by default (12px text), 32px for a lead action (13px text, always weight 500), and 32px (`field`)
 * for a button that sits beside a 32px field, with the 12px text of any other button.
 */
export type ButtonSize = "sm" | "row" | "md" | "lg" | "field";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** A ghost button's colour: muted (the default), the secondary text colour of a back button, or danger. */
  tone?: "muted" | "secondary" | "danger";
  /** Where the icon and label sit: centred, or from the left edge (the sidebar's New session). */
  align?: "center" | "start";
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

const BASE =
  "inline-flex items-center gap-1.5 rounded-lg border transition-colors " +
  "focus-ring disabled:cursor-not-allowed";

const ALIGNS = { center: "justify-center", start: "justify-start" } as const;

const SIZES: Record<ButtonSize, string> = {
  sm: "h-6 px-2 text-ui-sm",
  row: "h-6.5 px-2 text-ui-sm",
  md: "h-7 px-3 text-ui-sm",
  lg: "h-8 px-3 text-ui",
  field: "h-8 px-3 text-ui-sm",
};

/**
 * The canvas draws outline and ghost labels at weight 400 and primary and danger ones at 500; the
 * large lead action (the sidebar's New session) is 500 whatever its variant. One class is picked
 * here, so `font-normal` and `font-medium` never sit on one element.
 */
function weightClass(variant: ButtonVariant, size: ButtonSize): string {
  const isEmphasised = variant === "primary" || variant === "danger" || size === "lg";
  return isEmphasised ? "font-medium" : "font-normal";
}

// A faded primary fill still reads as a light, pressable button, so a disabled
// primary turns into a flat neutral one instead of dimming.
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-primary text-on-primary enabled:hover:bg-primary-hover " +
    "disabled:bg-surface-hover disabled:text-fg-muted",
  outline:
    "border-border-strong text-fg-secondary enabled:hover:bg-surface-hover enabled:hover:text-fg disabled:opacity-40",
  ghost: "border-transparent enabled:hover:bg-surface-hover enabled:hover:text-fg disabled:opacity-40",
  danger: "border-transparent bg-danger-surface text-danger disabled:opacity-40",
};

const GHOST_TONES = {
  muted: "text-fg-muted",
  secondary: "text-fg-secondary",
  danger: "text-danger enabled:hover:text-danger",
} as const;

export function Button({
  variant = "outline",
  size = "md",
  tone = "muted",
  align = "center",
  icon,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const toneClass = variant === "ghost" ? GHOST_TONES[tone] : undefined;
  const classes = [
    BASE,
    ALIGNS[align],
    SIZES[size],
    weightClass(variant, size),
    VARIANTS[variant],
    toneClass,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={classes} {...rest}>
      {icon}
      {children}
    </button>
  );
}
