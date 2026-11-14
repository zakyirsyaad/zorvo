import { useId, type ReactNode, type Ref } from "react";

/** A section's title (20px) and the one sentence under it. The title takes focus when Settings opens. */
export function SettingsHeader({
  title,
  children,
  titleRef,
  titleId,
}: {
  title: string;
  children: ReactNode;
  titleRef?: Ref<HTMLHeadingElement>;
  /** The title's id, for the region it names. */
  titleId?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h1 ref={titleRef} id={titleId} tabIndex={-1} className="text-xl font-semibold tracking-[-0.02em] text-fg outline-none">
        {title}
      </h1>
      <p className="text-ui text-fg-muted">{children}</p>
    </div>
  );
}

/** A small muted heading over a card of rows. */
export function SettingsGroup({
  heading,
  meta,
  children,
}: {
  heading: string;
  /** A subtle line at the heading's right (a stock count). */
  meta?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <div className="flex items-baseline gap-2 px-1 pb-2">
        <h2 id={headingId} className="text-caption font-medium text-fg-muted">
          {heading}
        </h2>
        {meta && <span className="ml-auto text-[11px] text-fg-subtle">{meta}</span>}
      </div>
      {/* No overflow clip: a row's popover (the default agent list) opens past the card's edge. */}
      <div className="flex flex-col rounded-xl border border-border bg-surface-2">{children}</div>
    </section>
  );
}

export interface SettingsRowProps {
  label: ReactNode;
  description?: ReactNode;
  /** The control at the row's right end. */
  control?: ReactNode;
  /** Drawn before the label (an avatar). */
  leading?: ReactNode;
  /** 12px gaps, as the GitHub and Agents rows are drawn; 16px otherwise. */
  isTight?: boolean;
  /** The welcome screen's row: 10px by 14px padding, 12px gaps, and the two lines 1px apart. */
  isCompact?: boolean;
  /** Extra classes on the row (`group`, for a control that shows on hover). */
  className?: string;
}

/** One row of a group: label and description on the left, the control on the right, hairlines between rows. */
export function SettingsRow({ label, description, control, leading, isTight = false, isCompact = false, className }: SettingsRowProps) {
  const box = isCompact ? "gap-3 px-3.5 py-2.5" : `px-4 py-3 ${isTight ? "gap-3" : "gap-4"}`;
  return (
    <div
      data-settings-row
      className={`flex items-center border-b border-border last:border-b-0 ${box} ${className ?? ""}`}
    >
      {leading}
      <div className={`flex min-w-0 flex-1 flex-col ${isCompact ? "gap-px" : "gap-0.5"}`}>
        <span className="text-ui text-fg">{label}</span>
        {description && <span className="text-ui-sm text-fg-muted">{description}</span>}
      </div>
      {control && <div className={`flex shrink-0 items-center ${isCompact ? "gap-3" : "gap-2"}`}>{control}</div>}
    </div>
  );
}
