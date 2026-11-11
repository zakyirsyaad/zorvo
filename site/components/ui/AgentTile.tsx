import type { AgentName } from "../../lib/agent-logos";
import { AgentLogo } from "./AgentLogo";

interface AgentTileProps {
  agent: AgentName;
  /** "large" is the 28px tile, "small" the 18px one; a width and height utility in `className` resizes it, as the design does for the chat header. */
  size: "large" | "small";
  /** Pixel size of the logo inside the tile. */
  logo: number;
  className?: string;
}

/** The tile that stands for an agent in the landing page's pictures: the design's box, with the agent's logo in it. Decorative, as the agent's name is always beside it. */
export function AgentTile({ agent, size, logo, className = "" }: AgentTileProps) {
  const box = size === "small" ? "lp-logo lp-logo-s" : "lp-logo";
  return (
    <span className={className ? `${box} ${className}` : box} aria-hidden="true">
      <AgentLogo agent={agent} size={logo} />
    </span>
  );
}
