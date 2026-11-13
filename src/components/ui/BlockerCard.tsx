import type { ReactNode } from "react";
import { AgentTile } from "./AgentTile";

export interface BlockerCardProps {
  /** The region's accessible name ("Install Codex", "Sign in to Codex"). */
  label: string;
  /** The agent whose tile leads the card; none without it. */
  profileId?: string;
  /** What stands in the way, as one sentence ("Codex isn't installed yet"). */
  title: string;
  /** The explanation under the title. */
  children: ReactNode;
  /** The way past it (Install, Add) or out of it (Cancel), at the header's right. */
  action?: ReactNode;
  /** Something as wide as the card right under the header: the install's bar. */
  below?: ReactNode;
  /** A ruled-off line under the body: a status line, secondary buttons. */
  footer?: ReactNode;
}

/**
 * One thing that keeps an agent from starting (an install, a sign-in, an agent no longer in use),
 * as a card above the composer: the agent's tile, the title and the body, with the way past it at the right.
 */
export function BlockerCard({ label, profileId, title, children, action, below, footer }: BlockerCardProps) {
  return (
    <section aria-label={label} className="flex flex-col gap-3.5 rounded-xl border border-border bg-surface-2 p-4">
      {/* With a button at its right the header is one centred line of things; with a longer body it tops out. */}
      <div data-blocker-head="" className={`flex gap-3 ${action ? "items-center" : "items-start"}`}>
        {profileId && <AgentTile profileId={profileId} name="" size={28} />}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-ui font-semibold text-fg">{title}</h2>
          <div className="text-ui text-fg-muted">{children}</div>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {below}
      {footer && <div className="border-t border-border pt-3">{footer}</div>}
    </section>
  );
}
