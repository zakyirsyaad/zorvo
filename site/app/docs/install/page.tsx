import { AgentLogo } from "../../../components/ui/AgentLogo";
import { Chip } from "../../../components/ui/Chip";
import { FakeButton, StatusDot } from "../../../components/mockups/parts";
import { DocsShell, type TocEntry } from "../../../components/docs/DocsShell";
import { B, Callout, CodeBlock, DocLink, H2, H3, OL, P, Picture, PictureRow, Table, UL } from "../../../components/docs/parts";
import { docsMetadata } from "../../../lib/docs-metadata";
import { LINKS } from "../../../lib/links";

export const metadata = docsMetadata("/docs/install");

const TOC: TocEntry[] = [
  { id: "requirements", label: "Requirements" },
  { id: "download", label: "Download and open" },
  { id: "first-agent", label: "Install your first agent" },
  { id: "already", label: "Already installed in a terminal?", isNested: true },
  { id: "update", label: "Update Zorvo" },
  { id: "upgrade", label: "Upgrade from Agent Desktop" },
];

export default function InstallPage() {
  return (
    <DocsShell
      current="/docs/install"
      title="Install Zorvo"
      lead="Zorvo is a native app for macOS. It installs the agents you pick, and Node.js or uv when they need them."
      toc={TOC}
    >
      <H2 id="requirements">Requirements</H2>
      <UL>
        <li><B>macOS</B> on Apple silicon or Intel.</li>
        <li>
          <B>Node.js 22 or later, yours or Zorvo&apos;s.</B> Claude Code, Codex and Qwen
          Code run with <Chip isCode>npx</Chip>. Zorvo uses your Node.js when it is on your login shell&apos;s{" "}
          <Chip isCode>PATH</Chip> (nvm, Homebrew) and is 22 or newer. Otherwise it installs Node.js when you install an
          agent that needs it.
        </li>
        <li>
          <B>At least one agent, signed in.</B> You can install it from Zorvo, or use one
          you already have.
        </li>
        <li>
          <B>Optional:</B> the GitHub CLI, <Chip isCode>gh</Chip>, for pull request status. Settings, GitHub
          shows whether it is installed and signed in, and <B>Connect</B> signs you in through your browser.
        </li>
      </UL>

      <H2 id="download">Download and open</H2>
      <OL>
        <li>Download <DocLink href={LINKS.download}>the latest <Chip isCode>.dmg</Chip></DocLink>.</li>
        <li>Drag <B>Zorvo</B> into Applications.</li>
        <li>Open it. The welcome screen lists the agents, lets you tick the ones you&apos;ll use and asks for a project folder.</li>
      </OL>
      <Callout tone="attention">
        <B>macOS blocks it the first time.</B> The build is not signed yet. Open it once,
        then go to System Settings, Privacy and Security, and click <B>Open Anyway</B> next
        to the Zorvo message.
      </Callout>
      <P>Or remove the quarantine flag in a terminal:</P>
      <CodeBlock label="Terminal">{'xattr -dr com.apple.quarantine "/Applications/Zorvo.app"'}</CodeBlock>

      <H2 id="first-agent">Install your first agent</H2>
      <P>
        Pick an agent that is not installed and click <B>Install</B>, on the welcome screen, in a new
        session&apos;s agent picker or in Settings, Agents. You can write your first message while it installs.
      </P>
      <Picture label="The agent list in Settings, Agents: Claude Code installed, Codex installing, Qwen Code with an Install button">
        <PictureRow>
          <span className="text-xs leading-4 font-medium text-fg">Agents</span>
          <span className="t-caption ml-auto">Settings</span>
        </PictureRow>
        <PictureRow>
          <AgentLogo agent="Claude Code" size={20} className="rounded-[4px]" />
          <span className="flex-1 text-[13px] leading-4 text-fg">Claude Code</span>
          <span className="t-caption">Installed</span>
        </PictureRow>
        <PictureRow>
          <AgentLogo agent="Codex" size={20} className="rounded-[4px]" />
          <span className="flex-1 text-[13px] leading-4 text-fg">Codex</span>
          <span className="t-caption inline-flex items-center gap-1.5"><StatusDot status="running" />Installing…</span>
        </PictureRow>
        <PictureRow last>
          <AgentLogo agent="Qwen Code" size={20} className="rounded-[4px]" />
          <span className="flex-1 text-[13px] leading-4 text-fg">Qwen Code</span>
          <span className="t-caption">Not installed</span>
          <span className="rounded-lg border border-border-strong px-3 py-1.5 text-xs leading-4 font-medium text-fg-secondary">Install</span>
        </PictureRow>
      </Picture>
      <UL>
        <li>Zorvo downloads the agent, and Node.js or uv when you need them.</li>
        <li>Every agent, Node.js and uv download is checked against its SHA-256 hash, and none starts until you click <B>Install</B>.</li>
        <li>Then sign in. The sign-in panel offers the agent&apos;s own login, which runs in a terminal inside Zorvo. See <DocLink href="/docs/signing-in">Signing in</DocLink>.</li>
      </UL>

      <H3 id="already">Already installed in a terminal?</H3>
      <P>
        A global install is optional. It only makes an agent show up as installed before you first use it.
      </P>
      <Table>
        <thead>
          <tr><th scope="col">Agent</th><th scope="col">Optional global install</th><th scope="col">Sign in</th></tr>
        </thead>
        <tbody>
          <tr><td>Qwen Code</td><td><Chip isCode>npm i -g @qwen-code/qwen-code</Chip></td><td>Run <Chip isCode>qwen</Chip> once</td></tr>
          <tr><td>Claude Code</td><td><Chip isCode>npm i -g @anthropic-ai/claude-code</Chip></td><td><Chip isCode>claude</Chip>, then <Chip isCode>/login</Chip>, or the app&apos;s sign-in panel</td></tr>
          <tr><td>Codex</td><td><Chip isCode>npm i -g @openai/codex</Chip></td><td><Chip isCode>codex login</Chip>, or the app&apos;s sign-in panel</td></tr>
        </tbody>
      </Table>
      <Callout>
        Zorvo reads your login shell&apos;s environment, so anything your terminal finds, it finds too. If you install an
        agent while the app runs, click <B>Check again</B> in Settings, Agents.
      </Callout>

      <H2 id="update">Update Zorvo</H2>
      <P>
        From 0.6.0 on, Zorvo checks for a new version a few seconds after it starts, then about once a day. When there
        is one, a card in the bottom right corner, above the message box, says so and what a restart would stop.
      </P>
      <Picture label="The update card: Zorvo X.Y.Z is ready, restarting stops 2 agents mid-turn and 1 shell, with Later and Update and restart buttons">
        <div className="flex justify-end bg-bg p-4">
          <div className="flex w-full max-w-[340px] flex-col gap-3 rounded-xl border border-border bg-surface-3 px-4 py-3.5 shadow-popover">
            <div className="flex flex-col gap-1">
              <span className="text-[13px] leading-[18px] font-semibold text-fg">Zorvo X.Y.Z is ready</span>
              <span className="text-xs leading-4 text-fg-muted">Restarting stops 2 agents mid-turn and 1 shell.</span>
            </div>
            <span className="flex justify-end gap-2">
              <FakeButton variant="ghost">Later</FakeButton>
              <FakeButton variant="outline" className="text-fg">Update &amp; restart</FakeButton>
            </span>
          </div>
        </div>
      </Picture>
      <UL>
        <li><B>Update &amp; restart</B> downloads the update, checks its signature against the key built into Zorvo, installs it and opens Zorvo again.</li>
        <li><B>Later</B> hides the card until you next start Zorvo. Settings, General, About still shows the update, says when Zorvo last checked, and has <B>Check now</B>.</li>
        <li>Agents that are working stop, and open terminals end, when Zorvo restarts. Your sessions are kept, since they are stored outside the app.</li>
      </UL>
      <Callout>
        <B>Older copies update once by hand.</B> A copy older than 0.6.0 cannot update itself: download the newest{" "}
        <Chip isCode>.dmg</Chip> and replace Zorvo in Applications. A copy opened from the disk image cannot update
        either, so drag it into Applications first.
      </Callout>

      <H2 id="upgrade">Upgrade from Agent Desktop</H2>
      <P>
        Zorvo is a new app next to the old one. On first launch it copies your sessions and transcripts, and leaves the
        old folder as it was.
      </P>
      <UL>
        <li>Then delete Agent Desktop from Applications. Both apps share the old sessions&apos; worktrees, so deleting a session in one removes its worktree for the other.</li>
        <li>macOS asks again for notification and folder permissions, since they belong to the app&apos;s identifier.</li>
      </UL>
    </DocsShell>
  );
}
