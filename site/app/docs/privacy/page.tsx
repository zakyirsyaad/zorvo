import { DocsShell, type TocEntry } from "../../../components/docs/DocsShell";
import { B, H2, P, UL } from "../../../components/docs/parts";
import { Chip } from "../../../components/ui/Chip";
import { docsMetadata } from "../../../lib/docs-metadata";

export const metadata = docsMetadata("/docs/privacy");

const TOC: TocEntry[] = [
  { id: "sign-in", label: "Sign-in stays with the agents" },
  { id: "hosts", label: "A few hosts, all named" },
  { id: "data", label: "Where your data lives" },
  { id: "folders", label: "Folder limits" },
];

export default function PrivacyPage() {
  return (
    <DocsShell
      current="/docs/privacy"
      title="Privacy and your data"
      lead="Zorvo sends no telemetry, never stores your keys, and says which hosts it contacts."
      toc={TOC}
    >
      <H2 id="sign-in">Sign-in stays with the agents</H2>
      <P>
        The app never asks for or stores API keys or tokens. Agents sign in with their own tools, and pull request data
        comes from your own <Chip isCode>gh</Chip> login.
      </P>

      <H2 id="hosts">A few hosts, all named</H2>
      <P>Zorvo&apos;s backend contacts these hosts, and only these:</P>
      <UL>
        <li>the ACP registry (<Chip isCode>cdn.agentclientprotocol.com</Chip>), to list agents and their versions, and to fetch their logos;</li>
        <li>the download URLs the registry lists, and the HTTPS hosts they redirect to, when you install a binary agent;</li>
        <li><Chip isCode>nodejs.org</Chip>, when you install an agent that needs Node.js and yours is missing or older than 22;</li>
        <li>uv&apos;s releases on GitHub, when you install an agent that runs with <Chip isCode>uvx</Chip> and you have no <Chip isCode>uvx</Chip>;</li>
        <li>
          Zorvo&apos;s own releases on GitHub: <Chip isCode>github.com/zakyirsyaad/zorvo-releases</Chip> to ask whether a
          newer Zorvo exists (a few seconds after start, then about once a day), and, when you click{" "}
          <B>Update &amp; restart</B>, <Chip isCode>api.github.com</Chip> to download it. GitHub sends both requests on to
          its download host, today <Chip isCode>release-assets.githubusercontent.com</Chip>.
        </li>
      </UL>
      <P>
        Every agent and runtime download is checked against a SHA-256 hash that was pinned before the download, and none
        starts until you click <B>Install</B>. A Zorvo update starts only when you click <B>Update &amp; restart</B>, must
        come from Zorvo&apos;s releases, and is installed only if its signature matches the key built into the app. The
        window itself makes no network requests: its Content Security Policy only allows the local IPC bridge.
      </P>
      <P>
        The tools your agents run make their own requests. <Chip isCode>npm</Chip> and <Chip isCode>npx</Chip> fetch
        packages from the npm registry, and <Chip isCode>uvx</Chip> can download Python and PyPI packages. Your agents
        talk to their own services as they always do.
      </P>

      <H2 id="data">Where your data lives</H2>
      <P>
        Sessions and transcripts are stored in <Chip isCode>~/Library/Application Support/xyz.zorvo.desktop/</Chip>, as{" "}
        <Chip isCode>state.json</Chip> and <Chip isCode>transcripts/</Chip>. Session worktrees live in{" "}
        <Chip isCode>worktrees/</Chip> there. On first launch, Zorvo copies sessions and transcripts from the folder
        earlier builds used and leaves that folder as it was.
      </P>

      <H2 id="folders">Folder limits</H2>
      <P>The backend only reads and runs in folders you opened in the app.</P>
    </DocsShell>
  );
}
