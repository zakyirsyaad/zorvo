import { AGENT_LOGOS, type AgentName } from "../../lib/agent-logos";

interface AgentLogoProps {
  agent: AgentName;
  size: number;
  className?: string;
}

/** An agent's own logo. The agent's name always sits beside it, so the logo itself is decorative. */
export function AgentLogo({ agent, size, className = "rounded-[3px]" }: AgentLogoProps) {
  return (
    <img
      src={AGENT_LOGOS[agent]}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={`flex-none ${className}`}
    />
  );
}
