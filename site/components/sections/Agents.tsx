import { AgentTile } from "../ui/AgentTile";

export function Agents() {
  return (
    <section className="border-t border-border py-14 px-0" aria-label="Agents">
      <div className="lp-wrap flex flex-col items-center gap-7" data-reveal="">
        <p className="lp-eyebrow" data-r="">
          Driven over the Agent Client Protocol, so each agent shows its own models, effort, modes and approvals.
        </p>
        <ul className="flex flex-wrap justify-center gap-3">
          <li className="lp-card flex items-center gap-3 h-14 py-0 px-4.5" data-r="" data-hover="">
            <AgentTile agent="Claude Code" size="large" logo={16} />
            <span className="text-fg font-medium">Claude Code</span>
          </li>
          <li className="lp-card flex items-center gap-3 h-14 py-0 px-4.5" data-r="" data-hover="">
            <AgentTile agent="Codex" size="large" logo={16} />
            <span className="text-fg font-medium">Codex</span>
          </li>
          <li className="lp-card flex items-center gap-3 h-14 py-0 px-4.5" data-r="" data-hover="">
            <AgentTile agent="Qwen Code" size="large" logo={16} />
            <span className="text-fg font-medium">Qwen Code</span>
          </li>
          <li className="lp-card flex items-center gap-3 h-14 py-0 px-4.5" data-r="" data-hover="">
            <AgentTile agent="Gemini CLI" size="large" logo={16} />
            <span className="text-fg font-medium">Gemini CLI</span>
          </li>
          <li className="lp-card flex items-center gap-3 h-14 py-0 px-4.5 border-dashed" data-r="" data-hover="">
            <span className="lp-logo font-mono" aria-hidden="true">+</span>
            <span className="text-fg-secondary">Every agent in the ACP registry</span>
          </li>
        </ul>
      </div>
    </section>
  );
}
