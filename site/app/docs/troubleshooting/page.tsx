import { DocsShell, type TocEntry } from "../../../components/docs/DocsShell";
import { B, DocLink, H2, P, UL } from "../../../components/docs/parts";
import { FakeButton } from "../../../components/mockups/parts";
import { Chip } from "../../../components/ui/Chip";
import { Icon } from "../../../components/ui/Icon";
import { docsMetadata } from "../../../lib/docs-metadata";

export const metadata = docsMetadata("/docs/troubleshooting");

const TOC: TocEntry[] = [
  { id: "not-installed", label: "An agent shows as not installed" },
  { id: "sign-in", label: "An agent needs you to sign in" },
  { id: "failed", label: "A turn failed" },
  { id: "stuck", label: "An agent seems stuck" },
  { id: "gemini", label: "Gemini CLI does not answer" },
  { id: "start", label: "An agent does not start" },
  { id: "pull-requests", label: "No pull request status" },
  { id: "update", label: "An update does not install" },
  { id: "worktree", label: "A worktree would not have it" },
  { id: "blocked", label: "The app is blocked on first open" },
];

export default function TroubleshootingPage() {
  return (
    <DocsShell
      current="/docs/troubleshooting"
      title="Troubleshooting"
      lead="Most problems are an agent that is not installed yet, or one that needs you to sign in."
      toc={TOC}
    >
      <H2 id="not-installed">An agent shows as not installed</H2>
      <P>
        Click <B>Add</B> or <B>Install</B> next to it in Settings, Agents, or choose it in a new session&apos;s agent
        picker (it is labelled &quot;not installed&quot;) and click <B>Install</B>. Zorvo brings Node.js when yours is
        missing or older than 22, and uv for agents that need it.
      </P>
      <P>
        A registry agent also counts as installed when its binary is on your <Chip isCode>PATH</Chip> or its npm package
        is installed globally. Then click <B>Check again</B> in Settings.
      </P>

      <H2 id="sign-in">An agent needs you to sign in</H2>
      <P>
        Its status reads <B>Sign in</B> in the Agents menu and in Settings, Agents. Use a sign-in method the card offers,
        or sign in once in a terminal, then click <B>Check again</B>. Zorvo reads your shell&apos;s settings again first,
        so a key you just added to <Chip isCode>~/.zshrc</Chip> is found. Your message is sent once you are signed in.
        See <DocLink href="/docs/signing-in">Signing in</DocLink>.
      </P>

      <H2 id="failed">A turn failed</H2>
      <P>
        A row under the last message says what happened. When the agent could not reach the network, it says so in plain
        words and keeps the agent&apos;s own error behind <B>Details</B>.
      </P>
      <div
        role="img"
        aria-label="A failed turn under the last message: Qwen Code could not reach the network, check your connection or proxy, then try again, with Try again, Details and Dismiss"
        className="flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-xl border border-danger bg-danger-surface px-3.5 py-3"
      >
        <Icon name="circle-alert" className="flex-none text-danger" />
        <p className="m-0 min-w-[220px] flex-1 text-[13px] leading-5 text-fg">
          Qwen Code could not reach the network. Check your connection or proxy, then try again.
        </p>
        <span className="flex flex-none items-center gap-1">
          <FakeButton variant="outline">Try again</FakeButton>
          <FakeButton variant="ghost">Details</FakeButton>
          <FakeButton variant="ghost">Dismiss</FakeButton>
        </span>
      </div>
      <UL>
        <li>
          <B>Try again</B> sends your last message once more. It is off while a turn runs, and an agent that has exited
          is reopened first.
        </li>
        <li>Other errors show the agent&apos;s own text.</li>
      </UL>

      <H2 id="stuck">An agent seems stuck</H2>
      <P>
        Under the line that says the agent is working, Zorvo shows a notice with a <B>Stop</B> button when the agent reports failed requests in a row
        (for Qwen Code, with the error it logged), or has sent nothing for a minute while no tool is running. Click{" "}
        <B>Stop</B> to end the turn, or wait if the agent is working on something long.
      </P>

      <H2 id="gemini">Gemini CLI does not answer</H2>
      <P>
        Gemini&apos;s default model, <Chip isCode>auto</Chip>, can hang without an answer. Pick another model in the
        composer&apos;s model chip. Zorvo sets it before your first message, and your next session starts with it.
      </P>

      <H2 id="start">An agent does not start</H2>
      <P>
        When you click <B>Install</B> and your Node.js is missing or older than 22, Zorvo installs Node.js for Claude
        Code, Codex and Qwen Code. The first start downloads the agent&apos;s pinned package, so it can take a moment.
      </P>

      <H2 id="pull-requests">No pull request status</H2>
      <P>
        Open Settings, GitHub. It says when the GitHub CLI is missing, with <Chip isCode>brew install gh</Chip>{" "}
        to copy. When you are signed out, <B>Connect</B> opens a terminal where <Chip isCode>gh</Chip> signs you in
        through your browser. The Changes tab links there too. A repository without a GitHub remote has no pull
        requests to show.
      </P>

      <H2 id="update">An update does not install</H2>
      <UL>
        <li>
          <B>Opened from the disk image.</B> A copy in a read-only place cannot update itself. Drag Zorvo into
          Applications, open it from there and update again.
        </li>
        <li>
          <B>Older than 0.6.0.</B> Update once by hand: download the newest <Chip isCode>.dmg</Chip> and replace Zorvo
          in Applications. See <DocLink href="/docs/install#update">Update Zorvo</DocLink>.
        </li>
      </UL>

      <H2 id="worktree">A worktree would not have it</H2>
      <P>
        The message &quot;is not in the last commit, so a worktree would not have it&quot; means a worktree checks out
        the last commit. Commit the folder first, or turn off New worktree.
      </P>

      <H2 id="blocked">The app is blocked on first open</H2>
      <P>
        The build is not signed yet. See <DocLink href="/docs/install#download">Download and open</DocLink>.
      </P>
    </DocsShell>
  );
}
