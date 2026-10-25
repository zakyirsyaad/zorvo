import { DocsShell, type TocEntry } from "../../../components/docs/DocsShell";
import { B, DocLink, H2, P, UL } from "../../../components/docs/parts";
import { Chip } from "../../../components/ui/Chip";
import { docsMetadata } from "../../../lib/docs-metadata";

export const metadata = docsMetadata("/docs/troubleshooting");

const TOC: TocEntry[] = [
  { id: "not-installed", label: "An agent shows as not installed" },
  { id: "sign-in", label: "An agent needs you to sign in" },
  { id: "start", label: "An agent does not start" },
  { id: "stuck", label: "An agent seems stuck" },
  { id: "pull-requests", label: "No pull request status" },
  { id: "worktree", label: "A worktree would not have it" },
  { id: "blocked", label: "The app is blocked on first open" },
];

export default function TroubleshootingPage() {
  return (
    <DocsShell
      current="/docs/troubleshooting"
      crumb={["Reference", "Troubleshooting"]}
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
        Use a sign-in method the panel offers, or sign in once in a terminal, then send your message again. See{" "}
        <DocLink href="/docs/signing-in">Signing in</DocLink>.
      </P>

      <H2 id="start">An agent does not start</H2>
      <P>
        When you click <B>Install</B> and your Node.js is missing or older than 22, Zorvo installs Node.js for Claude
        Code, Codex and Qwen Code. The first start downloads the agent&apos;s pinned package, so it can take a moment.
      </P>

      <H2 id="stuck">An agent seems stuck</H2>
      <P>
        Under Working…, Zorvo shows a notice with a <B>Stop</B> button in two cases. It states only what the agent
        reported.
      </P>
      <UL>
        <li>The agent reports failed requests in a row. For Qwen Code, the notice includes the error it logged.</li>
        <li>The agent has sent nothing for a minute while no tool is running.</li>
      </UL>
      <P>The notice belongs to the current turn and is not saved. Click <B>Stop</B> to end the turn, or wait if the agent is working on something long.</P>

      <H2 id="pull-requests">No pull request status</H2>
      <P>
        Install <Chip isCode>gh</Chip> and run <Chip isCode>gh auth login</Chip>. A repository without a GitHub remote
        has none to show.
      </P>

      <H2 id="worktree">A worktree would not have it</H2>
      <P>
        The message &quot;is not in the last commit, so a worktree would not have it&quot; means a worktree checks out
        the last commit. Commit the folder first, or start the session without Worktree.
      </P>

      <H2 id="blocked">The app is blocked on first open</H2>
      <P>
        The build is not signed yet. See <DocLink href="/docs/install#download">Download and open</DocLink>.
      </P>
    </DocsShell>
  );
}
