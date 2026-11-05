import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

export type ButtonVariant = "primary" | "outline" | "ghost" | "danger";

/** The canvas's three button heights: 24px for a small action in a row, 28px by default, 32px for a lead action. */
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Where the icon and label sit: centred, or from the left edge (the sidebar's New session). */
  align?: "center" | "start";
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

const BASE =
  "inline-flex items-center gap-1.5 rounded-lg border font-medium transition-colors " +
  "focus-ring disabled:cursor-not-allowed";

const ALIGNS = { center: "justify-center", start: "justify-start" } as const;

const SIZES: Record<ButtonSize, string> = {
  sm: "h-6 px-2 text-ui-sm",
  md: "h-7 px-3 text-ui",
  lg: "h-8 px-3 text-ui",
};

// A faded primary fill still reads as a light, pressable button, so a disabled
// primary turns into a flat neutral one instead of dimming.
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-primary text-on-primary enabled:hover:bg-primary-hover " +
    "disabled:bg-surface-hover disabled:text-fg-muted",
  outline:
    "border-border-strong text-fg-secondary enabled:hover:bg-surface-hover enabled:hover:text-fg disabled:opacity-40",
  ghost:
    "border-transparent text-fg-muted enabled:hover:bg-surface-hover enabled:hover:text-fg disabled:opacity-40",
  danger: "border-transparent bg-danger-surface text-danger disabled:opacity-40",
};

export function Button({
  variant = "outline",
  size = "md",
  align = "center",
  icon,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const classes = [BASE, ALIGNS[align], SIZES[size], VARIANTS[variant], className].filter(Boolean).join(" ");
  return (
    <button type={type} className={classes} {...rest}>
      {icon}
      {children}
    </button>
  );
}
