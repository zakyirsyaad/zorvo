import type { ReactNode } from "react";
import { AgentLogo } from "../AgentLogo";

export type AgentTileSize = 16 | 22 | 28;
export type AgentTileBadge = "attention" | "running" | "unread";

export interface AgentTileProps {
  /** The agent whose logo shows; omit it and pass an icon as children instead. */
  profileId?: string;
  /** Read out in place of the logo; "" when the name is written beside the tile. */
  name?: string;
  size?: AgentTileSize;
  badge?: AgentTileBadge;
  /** The color behind the tile, which the badge's ring takes. */
  badgeOn?: "ground" | "sheet" | "hover";
  children?: ReactNode;
  className?: string;
}

const BOX: Readonly<Record<AgentTileSize, { box: string; logo: number }>> = {
  16: { box: "size-4 rounded", logo: 10 },
  22: { box: "size-[22px] rounded-md", logo: 14 },
  28: { box: "size-7 rounded-lg", logo: 16 },
};

const BADGE_FILL: Readonly<Record<AgentTileBadge, string>> = {
  attention: "bg-status-attention",
  running: "bg-status-running",
  unread: "bg-status-unread",
};

const BADGE_RING: Readonly<Record<NonNullable<AgentTileProps["badgeOn"]>, string>> = {
  ground: "ring-ground",
  sheet: "ring-sheet",
  hover: "ring-surface-hover",
};

/**
 * A rounded square around an agent's logo or an icon. The badge is only a dot, so the row it sits in
 * always says the state in words as well.
 */
export function AgentTile({ profileId, name = "", size = 22, badge, badgeOn = "ground", children, className }: AgentTileProps) {
  const { box, logo } = BOX[size];
  const classes = [
    "relative inline-flex shrink-0 items-center justify-center bg-chip ring-1 ring-inset ring-border",
    box,
    className,
  ];
  return (
    <span className={classes.filter(Boolean).join(" ")}>
      {profileId !== undefined ? <AgentLogo profileId={profileId} name={name} size={logo} /> : children}
      {badge && (
        <span
          data-badge
          aria-hidden="true"
          className={`absolute -right-[3px] -bottom-[3px] size-2 rounded-full ring-2 ${BADGE_FILL[badge]} ${BADGE_RING[badgeOn]}`}
        />
      )}
    </span>
  );
}
