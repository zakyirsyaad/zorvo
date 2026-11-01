import { DocsShell, type TocEntry } from "../../../components/docs/DocsShell";
import { B, DocLink, H2, P, Picture, PictureRow, Table, UL } from "../../../components/docs/parts";
import { FakeButton, SignInBadge, type SignInState } from "../../../components/mockups/parts";
import { AgentLogo } from "../../../components/ui/AgentLogo";
import { Chip } from "../../../components/ui/Chip";
import type { AgentName } from "../../../lib/agent-logos";
import { docsMetadata } from "../../../lib/docs-metadata";

export const metadata = docsMetadata("/docs/signing-in");

const SIGN_IN_ROWS: { agent: AgentName; state: SignInState; note?: string }[] = [
  { agent: "Claude Code", state: "sign-in" },
  { agent: "Codex", state: "ready" },
  {
    agent: "Qwen Code",
    state: "not-checked",
    note: "Qwen Code cannot say who is signed in, so checking opens a session in the open folder. It may stay in the agent’s history and may run your project’s hooks.",
  },
];

const TOC: TocEntry[] = [
  { id: "status", label: "Where each agent stands" },
  { id: "in-zorvo", label: "In Zorvo" },
  { id: "in-terminal", label: "In your terminal" },
  { id: "keys", label: "Keys and tokens" },
];

export default function SigningInPage() {
  return (
    <DocsShell
      current="/docs/signing-in"
      title="Signing in"
      lead="Agents sign in with their own tools. When one needs you to, the panel says so as soon as you pick it."
      toc={TOC}
    >
      <H2 id="status">Where each agent stands</H2>
      <P>
        The sidebar&apos;s detected agents and Settings, Agents show the same status: <B>Ready</B> when Zorvo saw you
        signed in, <B>Sign in</B> when the agent asked for it, and <B>Not checked</B> when Zorvo has not asked yet.
      </P>
      <Picture label="Settings, Agents: Claude Code asking you to sign in, Codex ready, Qwen Code not checked, each with a Check sign-in button, and a note that checking Qwen Code opens a session">
        <PictureRow>
          <span className="text-xs leading-4 font-medium text-fg">Agents in use</span>
          <span className="t-caption ml-auto">Settings</span>
        </PictureRow>
        {SIGN_IN_ROWS.map(({ agent, state, note }, index) => (
          <div
            key={agent}
            className={`flex flex-wrap items-center gap-x-3 gap-y-2.5 px-3.5 py-3 ${index === SIGN_IN_ROWS.length - 1 ? "" : "border-b border-border"}`}
          >
            <AgentLogo agent={agent} size={20} className="rounded-[4px]" />
            <span className="flex-1 text-[13px] leading-4 text-fg">{agent}</span>
            <SignInBadge state={state} />
            <FakeButton variant="outline">Check sign-in</FakeButton>
            {note && <p className="t-caption m-0 basis-full pl-8 text-fg-muted">{note}</p>}
          </div>
        ))}
      </Picture>
      <UL>
        <li>
          <B>Check sign-in</B> asks the agent. Claude Code and Codex can say who is signed in without a session. Gemini
          CLI and Qwen Code cannot, so the button says first that it opens one.
        </li>
        <li>
          Click an agent that is not ready to start a new session with it: Zorvo checks it and shows the sign-in panel
          before you type, and the message box waits until you are signed in.
        </li>
      </UL>
      <H2 id="in-zorvo">In Zorvo</H2>
      <P>
        An agent that offers its own login, such as Claude Code&apos;s Claude subscription, runs it in a terminal inside
        Zorvo. Your message is sent once you are signed in. Where an agent offers a key instead (Gemini CLI&apos;s API
        key, for example), the panel explains it and you set it up outside Zorvo, then click <B>Check again</B> in the sign-in
        panel, or <B>Check sign-in</B> in Settings. Zorvo reads your
        shell&apos;s settings again before it asks the agent, so a key you just added to <Chip isCode>~/.zshrc</Chip> is found.
      </P>
      <H2 id="in-terminal">In your terminal</H2>
      <P>Sign in once in a terminal, then send your message again.</P>
      <Table>
        <thead>
          <tr><th scope="col">Agent</th><th scope="col">Sign in</th></tr>
        </thead>
        <tbody>
          <tr><td>Qwen Code</td><td>Run <Chip isCode>qwen</Chip> once</td></tr>
          <tr><td>Claude Code</td><td><Chip isCode>claude</Chip>, then <Chip isCode>/login</Chip></td></tr>
          <tr><td>Codex</td><td><Chip isCode>codex login</Chip></td></tr>
        </tbody>
      </Table>
      <H2 id="keys">Keys and tokens</H2>
      <UL>
        <li>Zorvo never asks for or stores API keys or tokens.</li>
        <li>Pull request data comes from your own <Chip isCode>gh</Chip> login.</li>
        <li>
          When an agent asks you to sign in on a web page, the page opens in your default browser after you click{" "}
          <B>Open in browser</B>. Zorvo makes no request for it.
        </li>
      </UL>
      <P>
        Still stuck? See <DocLink href="/docs/troubleshooting#sign-in">Troubleshooting</DocLink>.
      </P>
    </DocsShell>
  );
}
