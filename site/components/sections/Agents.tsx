import type { ReactNode } from "react";
import type { AgentName } from "../../lib/agent-logos";
import { FakeButton, SignInBadge, StatusDot } from "../mockups/parts";
import { AgentLogo } from "../ui/AgentLogo";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { SectionIntro } from "../ui/SectionIntro";

const CHAT_AGENTS: AgentName[] = ["Claude Code", "Codex", "Qwen Code"];

const CHAT_FEATURES = ["Models", "Effort", "Modes", "Approvals", "Questions", "Plans", "Diffs", "Rewind", "Fork", "Resume"];

function ChatPanel() {
  return (
    <article
      aria-labelledby="agents-chat"
      className="flex min-w-0 flex-[1_1_520px] flex-col overflow-hidden rounded-xl border border-border bg-surface-1"
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
          <li key={name} className="flex items-center gap-3.5 border-t border-border px-5 py-[18px] sm:px-7">
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

interface CatalogRowProps {
  logo: ReactNode;
  name: string;
  line: ReactNode;
  end: ReactNode;
  isLast?: boolean;
}

/** One agent in Settings, Agents: its logo tile, its name over a line, and what you can do. */
function CatalogRow({ logo, name, line, end, isLast }: CatalogRowProps) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${isLast ? "" : "border-b border-border"}`}>
      <span className="grid size-7 flex-none place-items-center rounded-[7px] bg-surface-hover text-fg-muted">{logo}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] leading-[18px] text-fg">{name}</span>
        <span className="truncate text-[11px] leading-4 text-fg-subtle">{line}</span>
      </span>
      <span className="flex flex-none items-center gap-2">{end}</span>
    </div>
  );
}

/** Settings, Agents: a search field, then agents in each state they can be in. */
function CatalogPicture() {
  return (
    <div
      role="img"
      aria-label="Settings, Agents: a search field, Codex ready with an update available, Qwen Code installing, Gemini CLI asking you to sign in, and Pi in the registry with an Add button"
      className="mx-5 mb-7 flex flex-col gap-3 sm:mx-7"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-8 flex-1 items-center gap-2 rounded-lg border border-border-strong bg-bg px-2.5 text-xs leading-4 text-fg-subtle">
          <Icon name="search" size={12} />
          Search agents
        </span>
        <span className="hidden sm:inline-flex">
          <FakeButton variant="outline" size="lg">Check again</FakeButton>
        </span>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface-2">
        <CatalogRow
          logo={<AgentLogo agent="Codex" size={16} />}
          name="Codex"
          line="Update available"
          end={
            <>
              <SignInBadge state="ready" />
              <FakeButton variant="outline">Update</FakeButton>
            </>
          }
        />
        <CatalogRow
          logo={<AgentLogo agent="Qwen Code" size={16} />}
          name="Qwen Code"
          line={
            <span className="inline-flex items-center gap-1.5">
              <StatusDot status="running" />
              Installing…
            </span>
          }
          end={
            <span className="h-1 w-14 overflow-hidden rounded-full bg-surface-hover">
              <span className="block h-full w-3/5 bg-fg-muted" />
            </span>
          }
        />
        <CatalogRow
          logo={<Icon name="sparkles" size={16} />}
          name="Gemini CLI"
          line="Runs with npx"
          end={<SignInBadge state="sign-in" />}
        />
        <CatalogRow
          logo={<Icon name="bot" size={16} />}
          name="Pi"
          line="In the registry"
          end={<FakeButton variant="outline">Add</FakeButton>}
          isLast
        />
      </div>
    </div>
  );
}

function RegistryPanel() {
  return (
    <article
      aria-labelledby="agents-registry"
      className="flex min-w-0 flex-[1_1_440px] flex-col overflow-hidden rounded-xl border border-border bg-surface-1"
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
