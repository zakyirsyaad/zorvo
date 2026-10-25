import type { AgentName } from "../../lib/agent-logos";
import { FakeButton, StatusDot } from "../mockups/parts";
import { AgentLogo } from "../ui/AgentLogo";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { SectionIntro } from "../ui/SectionIntro";

const CHAT_AGENTS: AgentName[] = ["Claude Code", "Codex", "Qwen Code"];

const CHAT_FEATURES = ["Models", "Effort", "Modes", "Approvals", "Diffs", "Rewind", "Fork", "Resume"];

function ChatPanel() {
  return (
    <article
      aria-labelledby="agents-chat"
      className="flex min-w-0 flex-[1_1_560px] flex-col overflow-hidden rounded-xl border border-border bg-surface-1"
    >
      <div className="flex flex-col gap-2.5 px-5 pt-6 pb-5 sm:px-7 sm:pt-7 sm:pb-6">
        <div className="flex items-center gap-2.5 text-fg">
          <Icon name="message-square" size={18} />
          <h3 id="agents-chat" className="t-title m-0">In a chat</h3>
        </div>
        <p className="t-body m-0 max-w-[460px]">
          Driven over the Agent Client Protocol, so you see each agent&apos;s own models, effort,
          modes and approvals.
        </p>
      </div>
      <ul className="m-0 list-none p-0">
        {CHAT_AGENTS.map((name) => (
          <li
            key={name}
            className="flex items-center gap-3.5 border-t border-border px-5 py-[18px] sm:px-7"
          >
            <AgentLogo agent={name} size={28} className="rounded-md" />
            <span className="text-xl leading-[26px] font-medium tracking-[-0.025em] text-fg sm:text-2xl sm:leading-[30px]">
              {name}
            </span>
          </li>
        ))}
      </ul>
      <ul
        aria-label="What the chat shows"
        className="m-0 mt-auto flex list-none flex-wrap gap-1.5 border-t border-border bg-surface-2 px-5 py-[18px] sm:px-7"
      >
        {CHAT_FEATURES.map((feature) => (
          <li key={feature}>
            <Chip>{feature}</Chip>
          </li>
        ))}
      </ul>
    </article>
  );
}

const ROW = "flex items-center gap-2.5 px-3 py-2.5";

/** Settings, Agents: a search field, and the three states an agent can be in. */
function CatalogPicture() {
  return (
    <div
      role="img"
      aria-label="Settings, Agents: a search field, Codex with an Update button, Qwen Code installing and Pi with an Add button"
      className="mx-5 mb-7 overflow-hidden rounded-lg border border-border bg-bg sm:mx-7"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5 text-fg-subtle">
        <Icon name="search" />
        <span className="text-xs leading-4">Search agents</span>
      </div>
      <div className={`${ROW} border-b border-border`}>
        <AgentLogo agent="Codex" size={18} className="rounded-[4px]" />
        <span className="flex-1 text-[13px] leading-4 text-fg">Codex</span>
        <span className="text-[11px] leading-4 text-fg-muted">Update available</span>
        <FakeButton variant="outline">Update</FakeButton>
      </div>
      <div className={`${ROW} border-b border-border`}>
        <AgentLogo agent="Qwen Code" size={18} className="rounded-[4px]" />
        <span className="flex-1 text-[13px] leading-4 text-fg">Qwen Code</span>
        <span className="inline-flex items-center gap-1.5 text-[11px] leading-4 text-fg-subtle">
          <StatusDot status="running" />
          Installing…
        </span>
      </div>
      <div className={ROW}>
        <Icon name="bot" size={18} className="text-fg-muted" />
        <span className="flex-1 text-[13px] leading-4 text-fg">Pi</span>
        <span className="text-[11px] leading-4 text-fg-subtle">In the registry</span>
        <FakeButton variant="outline">Add</FakeButton>
      </div>
    </div>
  );
}

function RegistryPanel() {
  return (
    <article
      aria-labelledby="agents-registry"
      className="flex min-w-0 flex-[1_1_420px] flex-col overflow-hidden rounded-xl border border-border bg-surface-1"
    >
      <div className="flex flex-col gap-2.5 px-5 pt-6 pb-5 sm:px-7 sm:pt-7 sm:pb-6">
        <div className="flex items-center gap-2.5 text-fg">
          <Icon name="layers" size={18} />
          <h3 id="agents-registry" className="t-title m-0">From the ACP registry</h3>
        </div>
        <p className="t-body m-0">
          Add any registry agent in Settings. Zorvo installs it, plus Node.js or uv when it needs
          them, and checks every download against its SHA-256 hash.
        </p>
      </div>
      <CatalogPicture />
      <p className="t-caption m-0 mt-auto px-5 pb-6 sm:px-7">
        New versions are offered a week after they are published.
      </p>
    </article>
  );
}

export function Agents() {
  return (
    <section id="agents" aria-labelledby="agents-title" className="py-[72px] md:py-28">
      <div className="site-wrap flex flex-col gap-12">
        <SectionIntro
          id="agents-title"
          eyebrow="agents"
          title="Bring the agent you already use."
          lead="Zorvo runs each agent that speaks ACP as a real chat, with its own models, modes and approvals. Add any other agent from the ACP registry in Settings."
          className="max-w-[600px]"
        />
        <div className="flex flex-wrap items-stretch gap-4">
          <ChatPanel />
          <RegistryPanel />
        </div>
        <p className="t-caption m-0">
          Each agent reports its own models and modes, so Zorvo offers whatever your install has.
          Agent names belong to their makers; Zorvo works with them and is not endorsed by them.
        </p>
      </div>
    </section>
  );
}
