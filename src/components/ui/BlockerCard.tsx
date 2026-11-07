import type { ReactNode } from "react";
import { AgentLogo } from "../AgentLogo";

export interface BlockerCardProps {
  /** The region's accessible name ("Install Codex", "Sign in to Codex"). */
  label: string;
  /** The agent whose logo leads the card; none without it. */
  profileId?: string;
  /** What stands in the way, as one sentence ("Codex isn't installed yet"). */
  title: string;
  /** The explanation under the title. */
  children: ReactNode;
  /** The way past it, on its own row under the body, at the right. */
  actions?: ReactNode;
  /** A ruled-off line under the body: progress, a status line, secondary buttons. */
  footer?: ReactNode;
}

/**
 * One thing that keeps an agent from starting (an install, a sign-in, an agent no longer in use),
 * as a card above the composer: the agent's logo, the title, the body, and the way past it.
 */
export function BlockerCard({ label, profileId, title, children, actions, footer }: BlockerCardProps) {
  return (
    <section aria-label={label} className="flex flex-col gap-3.5 rounded-xl border border-border bg-surface-2 p-[18px] shadow-popover">
      <div className="flex items-start gap-3">
        {profileId && (
          <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover">
            <AgentLogo profileId={profileId} name="" size={18} />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-ui font-semibold text-fg">{title}</h2>
          <div className="text-ui text-fg-muted">{children}</div>
        </div>
      </div>
      {actions && <div className="flex justify-end gap-2">{actions}</div>}
      {footer && <div className="border-t border-border pt-3">{footer}</div>}
    </section>
  );
}
