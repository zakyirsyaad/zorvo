import { DocsShell, type TocEntry } from "../../../components/docs/DocsShell";
import { B, DocLink, H2, H3, P, Picture, PictureRow, Table, UL } from "../../../components/docs/parts";
import { FakeButton, StatusDot } from "../../../components/mockups/parts";
import { AgentLogo } from "../../../components/ui/AgentLogo";
import { Chip } from "../../../components/ui/Chip";
import { Icon } from "../../../components/ui/Icon";
import type { AgentName } from "../../../lib/agent-logos";
import { docsMetadata } from "../../../lib/docs-metadata";

export const metadata = docsMetadata("/docs/agents");

const TOC: TocEntry[] = [
  { id: "glance", label: "At a glance" },
  { id: "catalog", label: "The agent catalog" },
  { id: "not-available", label: "Agents Zorvo cannot offer", isNested: true },
  { id: "versions", label: "Versions and updates", isNested: true },
  { id: "elicitation", label: "When an agent asks you" },
  { id: "resume", label: "Resume and fork" },
];

const DEFAULTS: AgentName[] = ["Qwen Code", "Claude Code", "Codex"];

const ROWS: { feature: string; value: string }[] = [
  { feature: "Runs as", value: "ACP agent via npx" },
  { feature: "Models, effort, modes", value: "From the agent" },
  { feature: "Approvals", value: "In the chat" },
  { feature: "Resume after a restart", value: "When the agent can resume or load sessions" },
  { feature: "Rewind", value: "Yes" },
  { feature: "Fork", value: "Yes" },
];

export default function AgentsPage() {
  return (
    <DocsShell
      current="/docs/agents"
      title="Supported agents"
      lead="Zorvo runs the agents in the official ACP agent registry, each as a chat. Claude Code, Codex and Qwen Code are there by default. Add any other registry agent from Settings, Agents."
      toc={TOC}
    >
      <H2 id="glance">At a glance</H2>
      <Table>
        <thead>
          <tr>
            <th scope="col">Feature</th>
            {DEFAULTS.map((name) => (
              <th key={name} scope="col">
                <span className="inline-flex items-center gap-1.5">
                  <AgentLogo agent={name} size={16} />
                  {name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map(({ feature, value }) => (
            <tr key={feature}>
              <th scope="row">{feature}</th>
              {DEFAULTS.map((name) => (
                <td key={name}>{value === "ACP agent via npx" ? <>ACP agent via <Chip isCode>npx</Chip></> : value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
      <P>
        The table shows the default agents. Every other registry agent works the same way, and reports its own models,
        efforts and approval modes for each session, so Zorvo offers whatever your install has.
      </P>

      <H2 id="catalog">The agent catalog</H2>
      <P>
        Settings, Agents lists every agent in the registry, with search and logos. Add, install, update and remove
        agents there. Onboarding uses the same list.
      </P>
      <Picture label="Settings, Agents: a search field and four agents, Claude Code installed, Codex with an update, Qwen Code not installed and Pi not added, then a collapsed list of two agents that are not available">
        <PictureRow>
          <span className="text-xs leading-4 font-medium text-fg">Agents</span>
          <span className="ml-auto inline-flex items-center gap-2 text-fg-subtle">
            <Icon name="search" />
            <span className="text-xs leading-4">Search agents</span>
          </span>
        </PictureRow>
        <PictureRow>
          <AgentLogo agent="Claude Code" size={20} className="rounded-[4px]" />
          <span className="flex-1 text-[13px] leading-4 text-fg">Claude Code</span>
          <span className="t-caption">Installed</span>
        </PictureRow>
        <PictureRow>
          <AgentLogo agent="Codex" size={20} className="rounded-[4px]" />
          <span className="flex-1 text-[13px] leading-4 text-fg">Codex</span>
          <span className="t-caption inline-flex items-center gap-1.5"><StatusDot status="unread" />Update available</span>
          <FakeButton variant="outline">Update</FakeButton>
        </PictureRow>
        <PictureRow>
          <AgentLogo agent="Qwen Code" size={20} className="rounded-[4px]" />
          <span className="flex-1 text-[13px] leading-4 text-fg">Qwen Code</span>
          <span className="t-caption">Not installed</span>
          <FakeButton variant="outline">Install</FakeButton>
        </PictureRow>
        <PictureRow>
          <Icon name="bot" size={18} className="text-fg-muted" />
          <span className="flex-1 text-[13px] leading-4 text-fg">Pi</span>
          <span className="t-caption">In the registry</span>
          <FakeButton variant="outline">Add</FakeButton>
        </PictureRow>
        <div className="flex items-center gap-2 bg-surface-2 px-3.5 py-2.5 text-xs leading-4 text-fg-muted">
          <Icon name="chevron-right" />
          Not available (2)
        </div>
      </Picture>
      <UL>
        <li>
          <B>Agents in use only.</B> The sidebar and pickers show the agents you use: the three defaults, plus any
          registry agent already installed on your Mac, as a binary on your <Chip isCode>PATH</Chip> or a global npm
          package.
        </li>
        <li>
          <B>Checked in the background.</B> Zorvo reads the registry at startup when the last check is over a day old,
          and when you click <B>Check again</B>.
        </li>
        <li>
          <B>Installed by Zorvo.</B> See <DocLink href="/docs/install#first-agent">Install your first agent</DocLink>.
          Every download is checked against a SHA-256 hash.
        </li>
        <li>
          <B>One way to run each agent.</B> When the registry offers an agent both as a download and as a package, as
          it does for Kilo, Zorvo uses the pinned package.
        </li>
      </UL>

      <H3 id="not-available">Agents Zorvo cannot offer</H3>
      <P>
        Registry agents that Zorvo cannot run sit in a collapsed <B>Not available</B> list under the others, each with
        the reason, such as &quot;The registry publishes no usable checksum for this download, so Zorvo cannot verify
        it.&quot; Search covers them, but they cannot be added: Zorvo never runs a download it cannot check against a
        published SHA-256.
      </P>

      <H3 id="versions">Versions and updates</H3>
      <P>
        A new version is offered a week after it was published, and never one the registry has withdrawn. Zorvo keeps
        the version an agent started with until you click <B>Update</B>. When an update is offered, the Settings button
        shows a dot, the Agents tab shows a count, and a notice tells you once per version.
      </P>
      <P>
        Agents sign in with their own tools. See <DocLink href="/docs/signing-in">Signing in</DocLink>.
      </P>

      <H2 id="elicitation">When an agent asks you</H2>
      <P>
        An agent can show a form in the chat, or send you to a web page to sign in. You answer in the chat or in a
        popout window. What you type goes to the agent and is never saved, and a web page opens in your browser only
        after you click <B>Open in browser</B>.
      </P>

      <H2 id="resume">Resume and fork</H2>
      <P>
        Zorvo continues an earlier session with the agent&apos;s own resume (<Chip isCode>session/resume</Chip>) when
        it offers one, and otherwise loads it (<Chip isCode>session/load</Chip>). An agent that can do neither says so
        when you try to continue one.
      </P>
      <P>
        A fork from the latest reply uses the agent&apos;s own fork when it has one. Otherwise it is done by handoff:
        the conversation is written to a file, and the new agent is asked to read it and wait for your next message.
      </P>
    </DocsShell>
  );
}
