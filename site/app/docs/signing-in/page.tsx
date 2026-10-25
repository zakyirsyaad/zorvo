import { DocsShell, type TocEntry } from "../../../components/docs/DocsShell";
import { B, DocLink, H2, P, Table, UL } from "../../../components/docs/parts";
import { Chip } from "../../../components/ui/Chip";
import { docsMetadata } from "../../../lib/docs-metadata";

export const metadata = docsMetadata("/docs/signing-in");

const TOC: TocEntry[] = [
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
      <H2 id="in-zorvo">In Zorvo</H2>
      <P>
        An agent that offers its own login, such as Claude Code&apos;s Claude subscription, runs it in a terminal inside
        Zorvo. Your message is sent once you are signed in.
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
