import { DocsShell, type TocEntry } from "../../../components/docs/DocsShell";
import { B, Callout, DocLink, H2, OL, P, UL } from "../../../components/docs/parts";
import { docsMetadata } from "../../../lib/docs-metadata";

export const metadata = docsMetadata("/docs/compare");

const TOC: TocEntry[] = [
  { id: "start", label: "Start a compare run" },
  { id: "run", label: "Follow the run" },
  { id: "pick", label: "Pick one" },
];

export default function ComparePage() {
  return (
    <DocsShell
      current="/docs/compare"
      title="Compare agents"
      lead="Send one prompt to up to four agents. Each works in its own worktree, and you keep the one you pick."
      toc={TOC}
    >
      <H2 id="start">Start a compare run</H2>
      <OL>
        <li>
          In a git repository, start a new session and open its <B>Agent</B> chip. Tick up to four agents. An agent
          that still needs an install or a sign-in cannot be ticked, and its status says why.
        </li>
        <li>
          The chip reads &quot;3 agents · compare&quot;, and Send becomes <B>Start 3 sessions</B>. The composer shows one
          model chip per agent. Zorvo asks an agent for its models only when you open its chip, and your pick is that
          agent&apos;s model in its next session too.
        </li>
        <li>
          Write the prompt and press <B>Start 3 sessions</B>. Zorvo makes each agent&apos;s worktree, on its own{" "}
          <B>agent/&lt;title&gt;</B> branch, and starts each agent in the safest mode it has.
        </li>
      </OL>

      <H2 id="run">Follow the run</H2>
      <UL>
        <li>
          The sidebar shows the run as one row, &quot;Compare · 3 agents&quot;, with what its agents are doing
          (&quot;2 working, 1 finished&quot;). Its sessions are listed under it, each named by its agent.
        </li>
        <li>
          The run&apos;s panel lists each agent with its status and how long its turn has run or took (&quot;Working · 12
          min&quot;, &quot;Finished · 8 min&quot;), and the files and lines it changed since its worktree started. Click the
          numbers to read that agent&apos;s diff. See <DocLink href="/docs/review">Review changes</DocLink>.
        </li>
        <li>
          <B>Open</B> shows an agent&apos;s chat, where you answer its permissions. An agent that asks you to sign in
          waits on its row, which reads <B>Needs sign-in</B>, until you open it.
        </li>
      </UL>

      <H2 id="pick">Pick one</H2>
      <P>
        <B>Pick</B> always asks first, in a bar at the bottom of the panel that names the agents it would stop
        mid-turn. Confirm, and Zorvo stops and archives the other sessions. Their worktrees and branches stay, so you
        can still read or merge what they did. The session you picked carries on as a normal session.
      </P>
      <Callout>Each agent runs on its own sign-in and uses its own quota, so a run of four costs four turns.</Callout>
    </DocsShell>
  );
}
