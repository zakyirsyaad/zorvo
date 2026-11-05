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
  /** The card's buttons, on the title's row at the right. */
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
    <section aria-label={label} className="rounded-xl border border-border bg-surface-2 p-4">
      <div className="flex items-start gap-3">
        {profileId && <AgentLogo profileId={profileId} name="" size={24} className="mt-0.5" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-ui font-medium text-fg">{title}</h2>
          <div className="mt-1 text-ui-sm text-fg-muted">{children}</div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {footer && <div className="mt-3 border-t border-border pt-3">{footer}</div>}
    </section>
  );
}
