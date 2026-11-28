import type { CSSProperties } from "react";
import { STRIP_AGENTS, type StripAgent } from "../../lib/strip-agents";
import { AgentTile } from "../ui/AgentTile";

function AgentCard({ agent }: { agent: StripAgent }) {
  return (
    <li className="lp-card flex flex-none items-center gap-3 h-14 py-0 px-4.5">
      {agent.logo ? (
        <AgentTile agent={agent.logo} size="large" logo={16} />
      ) : (
        // The registry's icon is one colour, so it is drawn as a mask in the text colour.
        <span className="lp-logo" aria-hidden="true">
          <span className="lp-mark" style={{ "--lp-mark": `url(/agents/${agent.id}.svg)` } as CSSProperties} />
        </span>
      )}
      <span className="text-fg font-medium whitespace-nowrap">{agent.name}</span>
    </li>
  );
}

export function Agents() {
  return (
    <section className="py-14 px-0" aria-label="Agents">
      <div className="lp-wrap flex flex-col items-center gap-7" data-reveal="">
        <p className="lp-eyebrow" data-r="">
          Each agent runs as itself, with its own models, effort, modes and approvals.
        </p>
        {/* A slow strip. It stops under the pointer, and with reduced motion it is a plain wrapped list. The
            second list only fills the loop, so it is hidden from assistive technology. */}
        <div className="lp-mq w-full" data-r="">
          <div className="lp-track">
            <ul>
              {STRIP_AGENTS.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </ul>
            <ul aria-hidden="true">
              {STRIP_AGENTS.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
