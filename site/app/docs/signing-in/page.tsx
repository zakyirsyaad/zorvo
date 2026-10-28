import { DocsShell, type TocEntry } from "../../../components/docs/DocsShell";
import { B, DocLink, H2, P, Table, UL } from "../../../components/docs/parts";
import { Chip } from "../../../components/ui/Chip";
import { docsMetadata } from "../../../lib/docs-metadata";

export const metadata = docsMetadata("/docs/signing-in");

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
        Detected agents in the sidebar show whether you can use them. <B>Ready</B> means Zorvo saw you signed in.{" "}
        <B>Sign in</B> means the agent asked for it. <B>Not checked</B> means it is installed but Zorvo has not asked it
        yet. Click one that is not ready to start a new session with it: Zorvo checks it and shows the sign-in panel
        before you type, and the message box waits until you are signed in.
      </P>
      <P>
        <B>Settings → Agents</B> shows the same status on each agent in use, with a <B>Check sign-in</B> button. If the
        agent needs you to sign in, its sign-in methods are listed there too, with the same buttons and explanations as
        the panel. Gemini CLI and Qwen Code cannot say who is signed in, so checking one opens a session that stays in
        its history; the button says so before you click it.
      </P>
      <H2 id="in-zorvo">In Zorvo</H2>
      <P>
        An agent that offers its own login, such as Claude Code&apos;s Claude subscription, runs it in a terminal inside
        Zorvo. Your message is sent once you are signed in. Where an agent offers a key instead (Gemini CLI&apos;s API
        key, for example), the panel explains it and you set it up outside Zorvo, then click <B>Check again</B>.
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
