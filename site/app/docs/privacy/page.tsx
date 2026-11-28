import { DocsShell, type TocEntry } from "../../../components/docs/DocsShell";
import { B, DocLink, H2, P, UL } from "../../../components/docs/parts";
import { Chip } from "../../../components/ui/Chip";
import { docsMetadata } from "../../../lib/docs-metadata";

export const metadata = docsMetadata("/docs/privacy");

const TOC: TocEntry[] = [
  { id: "sign-in", label: "Sign-in stays with the agents" },
  { id: "hosts", label: "A few hosts, all named" },
  { id: "pages", label: "Pages, the browser and apps" },
  { id: "private-mode", label: "Private mode's hosts" },
  { id: "data", label: "Where your data lives" },
  { id: "folders", label: "Folder limits" },
  { id: "website", label: "This website" },
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
      <P>
        Zorvo asks your <Chip isCode>gh</Chip> whether you are signed in to github.com and reads only your login and
        name, to show them in the sidebar and in Settings. It stores neither, never reads or keeps a token, and
        downloads no picture. <B>Connect</B> runs <Chip isCode>gh auth login</Chip> for github.com in a terminal, and
        you sign in through your browser.
      </P>

      <H2 id="hosts">A few hosts, all named</H2>
      <P>
        For its own work, Zorvo&apos;s backend contacts these hosts, and only these, until you open private mode (see{" "}
        <DocLink href="#private-mode">Private mode&apos;s hosts</DocLink>). What a page or the browser loads is under{" "}
        <DocLink href="#pages">Pages, the browser and apps</DocLink>:
      </P>
      <UL>
        <li>the ACP registry (<Chip isCode>cdn.agentclientprotocol.com</Chip>), to list agents and their versions, and to fetch their logos;</li>
        <li>the download URLs the registry lists, and the HTTPS hosts they redirect to, when you install a binary agent;</li>
        <li><Chip isCode>nodejs.org</Chip>, when you install an agent that needs Node.js and yours is missing or older than 22;</li>
        <li>uv&apos;s releases on GitHub, when you install an agent that runs with <Chip isCode>uvx</Chip> and you have no <Chip isCode>uvx</Chip>;</li>
        <li>
          Zorvo&apos;s own releases on GitHub: <Chip isCode>github.com/zakyirsyaad/zorvo</Chip> to ask whether a
          newer Zorvo exists (a few seconds after start, then about once a day), and, when you click{" "}
          <B>Update &amp; restart</B>, <Chip isCode>api.github.com</Chip> to download it. GitHub sends both requests on to
          its download host, today <Chip isCode>release-assets.githubusercontent.com</Chip>.
        </li>
      </UL>
      <P>
        Every runtime and binary agent download is checked against a SHA-256 hash that was pinned before the download,
        and an agent that comes as an npm package is installed at the exact version the registry pins. None starts
        until you click <B>Install</B>, with one exception: when Zorvo opens, an agent you have already used whose
        package is not in Zorvo&apos;s folder yet is installed once, without a click. A Zorvo update starts only when you click <B>Update &amp; restart</B>, must
        come from Zorvo&apos;s releases, and is installed only if its signature matches the key built into the app. The
        window itself makes no network requests: its Content Security Policy only allows the local IPC bridge.
      </P>
      <P>
        The tools your agents run make their own requests. <Chip isCode>npm</Chip> and <Chip isCode>npx</Chip> fetch
        packages from the npm registry, and <Chip isCode>uvx</Chip> can download Python and PyPI packages. Your agents
        talk to their own services as they always do.
      </P>

      <H2 id="pages">Pages, the browser and apps</H2>
      <UL>
        <li>
          <B>A page an agent shows you</B> runs in a part of the window of its own. It cannot call Zorvo or read your
          files. It may load scripts and fonts from a short list of public hosts, and can send a request nowhere else.{" "}
          <DocLink href="/docs/output#reach">What a page can reach</DocLink> names the hosts. They see that a file was
          asked for, as any website&apos;s would.
        </li>
        <li>
          <B>The Browser tab</B> (in versions after 0.14.1) loads the pages you or your agent open, and what those
          pages load, in a view apart from the chat. Search text you submit in the address bar goes to Google. Each
          session has its own browser store, kept in memory and not shared with other sessions. An agent needs your
          grant for the session before it uses the browser, and sending a file asks again.
        </li>
        <li>
          <B>Apps on your Mac</B> (in versions after 0.14.1) are off until you turn computer use on in Settings,
          Agents. An agent then asks which apps it may use in a session, and for now it can only read a window and
          take a picture of it. What an agent sees in an app goes to its model provider.
        </li>
      </UL>

      <H2 id="private-mode">Private mode&apos;s hosts</H2>
      <P>
        Private mode adds two hosts. Zorvo contacts neither until you open Settings, Private mode, and NEAR AI only once
        you run a private session or add your own NEAR AI key:
      </P>
      <UL>
        <li>
          the Zorvo Credits server (<Chip isCode>zorvo-credits-server.zkyxentertain.workers.dev</Chip>), run by
          zorvolabs. Opening Settings, Private mode the first time registers this Mac with it and reads the packs on
          offer and the models. From then on, Zorvo reads your balance from it each time it starts. It is also
          contacted when you buy credits or redeem a code, start a private session with a spending cap, and use your
          recovery code on another Mac. It never sees your prompts;
        </li>
        <li>
          NEAR AI Cloud (<Chip isCode>cloud-api.near.ai</Chip>), during private sessions. Qwen Code sends its requests to
          Zorvo&apos;s proxy on your Mac, which passes them on to NEAR AI. Zorvo also asks NEAR AI for each answer&apos;s signature and the
          model&apos;s attestation, to show Verified in TEE, reads what each call cost, and checks your own NEAR AI key if
          you add one.
        </li>
      </UL>
      <P>
        Your browser, not Zorvo, opens PingPay&apos;s checkout (<Chip isCode>pay.pingpay.io</Chip>) when you buy credits,
        and NEAR AI&apos;s Verification Center (<Chip isCode>cloud.near.ai/verify</Chip>) when you open it from a
        session. What you pay with stays between you and PingPay. See{" "}
        <DocLink href="/docs/credits">Credits terms</DocLink>.
      </P>

      <H2 id="data">Where your data lives</H2>
      <P>
        Sessions and transcripts are stored in <Chip isCode>~/Library/Application Support/xyz.zorvo.desktop/</Chip>, as{" "}
        <Chip isCode>state.json</Chip> and <Chip isCode>transcripts/</Chip>. Session worktrees live in{" "}
        <Chip isCode>worktrees/</Chip> there. On first launch, Zorvo copies sessions and transcripts from the folder
        earlier builds used and leaves that folder as it was.
      </P>
      <P>
        Once you open private mode in Settings, Zorvo keeps its secrets in your Keychain: the recovery code that
        identifies this Mac, the
        NEAR AI key the Credits server hands over (or your own key), and the key of each session with a spending cap.
      </P>

      <H2 id="folders">Folder limits</H2>
      <P>The backend only reads and runs in folders you opened in the app.</P>

      <H2 id="website">This website</H2>
      <P>
        Everything above is about the app. This website is hosted on Vercel and uses two of its services: Web Analytics
        counts page views, and Speed Insights measures how fast pages load. Both are scripts served from this
        site&apos;s own address, and they send what they measure to Vercel.
      </P>
      <P>
        They set no cookies. Vercel receives the address of the page, the page you came from, your browser and
        operating system, the kind of device and your country. It tells one visit from another with a hash of the
        request, which it discards after a day. The app has no such script and sends none of this.
      </P>
    </DocsShell>
  );
}
