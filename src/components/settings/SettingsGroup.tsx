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
export function SettingsGroup({ heading, children }: { heading: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <div id={headingId} className="px-1 pb-2 text-caption font-medium text-fg-muted">
        {heading}
      </div>
      <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface-2">{children}</div>
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
}

/** One row of a group: label and description on the left, the control on the right, hairlines between rows. */
export function SettingsRow({ label, description, control, leading, isTight = false }: SettingsRowProps) {
  return (
    <div
      data-settings-row
      className={`flex items-center border-b border-border px-4 py-3 last:border-b-0 ${isTight ? "gap-3" : "gap-4"}`}
    >
      {leading}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-ui text-fg">{label}</span>
        {description && <span className="text-ui-sm text-fg-subtle">{description}</span>}
      </div>
      {control && <div className="flex shrink-0 items-center gap-2">{control}</div>}
    </div>
  );
}
