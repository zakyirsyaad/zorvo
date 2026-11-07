import { DocsShell, type TocEntry } from "../../../components/docs/DocsShell";
import { B, DocLink, H2, OL, P, UL } from "../../../components/docs/parts";
import { Chip } from "../../../components/ui/Chip";
import { docsMetadata } from "../../../lib/docs-metadata";

export const metadata = docsMetadata("/docs/quickstart");

const TOC: TocEntry[] = [
  { id: "steps", label: "Your first session" },
  { id: "window", label: "Find your way around" },
  { id: "composer", label: "The composer" },
  { id: "mode", label: "Permission modes" },
];

export default function QuickstartPage() {
  return (
    <DocsShell
      current="/docs/quickstart"
      title="Quickstart"
      lead="From a fresh install to a first message: tick your agents, pick a folder and start."
      toc={TOC}
    >
      <H2 id="steps">Your first session</H2>
      <OL>
        <li>
          <B>The welcome screen.</B> The first run is one page. Tick the agents you&apos;ll use (one that is not
          installed offers <B>Install</B>), pick a project folder from the ones Zorvo finds or open another, and press{" "}
          <B>Start</B>. Signing in waits for your first session. You can change all of this later in Settings.
        </li>
        <li>
          <B>Start a session.</B> Click <B>New session</B> at the top of the sidebar, or the <B>+</B> next to a folder.
          The new session shows its folder, branch and agent as chips above the message box. Turn on{" "}
          <B>New worktree</B> in the branch chip&apos;s menu to give the session its own copy, on an{" "}
          <Chip isCode>agent/&lt;title&gt;</Chip> branch. Tick more than one agent to{" "}
          <DocLink href="/docs/compare">compare them</DocLink>.
        </li>
        <li>
          <B>Work with the agent.</B>
          <UL>
            <li>Answer its permission requests and its questions in the chat.</li>
            <li>
              Open <B>Inspector</B> in the top bar to review what it changed, see what it did, read files and open a
              terminal. See <DocLink href="/docs/review">Review changes</DocLink>.
            </li>
            <li>Select text in a reply and press <B>Reply</B> to quote it in your next message.</li>
          </UL>
        </li>
        <li>
          <B>Branch off.</B> Point at a message to see its actions.
          <UL>
            <li><B>Fork from here</B> under a reply starts a new session from there.</li>
            <li>
              <B>Rewind to here</B> on one of your messages takes the conversation back to before it and puts the message
              in the composer to edit. It asks once more, and files the agent changed stay as they are.
            </li>
          </UL>
        </li>
      </OL>

      <H2 id="window">Find your way around</H2>
      <UL>
        <li>
          <B>The sidebar</B> lists sessions by folder, two lines each: the title, then the agent and what it is doing
          (&quot;Working&quot;, &quot;Waiting for you&quot;, &quot;Finished, unread&quot;). A folded folder still says
          what its sessions are doing. <B>Hide sidebar</B> makes room for the chat.
        </li>
        <li>
          <B>The Agents button</B> next to Settings, at the bottom of the sidebar, shows your agents and whether each is
          signed in.
        </li>
        <li>
          <B>The top bar</B> shows chips only when they have something to say: the agent&apos;s plan (
          <Chip isCode>2/4</Chip>), what runs in the background, and the changes (<Chip isCode>+42 −11</Chip>). Double-click
          the title to rename the session; the <B>⋯</B> menu opens it in a new window or in Finder.
        </li>
        <li>
          <B>The inspector</B> opens on the right with tabs for Changes, Activity, Files and Terminal. Drag its left
          edge to make it wider; Zorvo remembers the width.
        </li>
      </UL>

      <H2 id="composer">The composer</H2>
      <P>
        The row under the message box shows what your agent offers. Models, permission modes and other settings each
        get a chip, and the open menu shows the agent&apos;s own description under each choice that has one. At most
        three chips sit in the row; the rest are under <B>⋯</B>. Zorvo shows only the choices the agent reports.
      </P>
      <UL>
        <li><B>Codex</B> has a collaboration mode chip, which is where you put Codex in Plan.</li>
        <li><B>Claude Code</B> has a fast mode chip and one for its agent persona.</li>
        <li>
          <B>Gemini CLI</B> and other agents that list their models only through ACP get a model chip too. Your pick
          is set before your first message, and the next session starts with it.
        </li>
        <li>A list over ten choices has a search field.</li>
        <li>
          A mode that lets the agent act without asking (YOLO, bypass, full access) is marked with a shield in the
          open menu, before you pick it.
        </li>
      </UL>
      <P>
        Mention files with <B>@</B>, list the agent&apos;s commands with <B>/</B>, and drop files and pictures onto the
        window; an image shows as a thumbnail. The context use reads &quot;38% of context&quot; and opens the numbers
        behind it. While the agent works, <B>Stop</B> sits where Send was.
      </P>

      <H2 id="mode">Permission modes</H2>
      <P>
        Each session starts in the safest permission mode its agent offers (its Default, Manual, Ask or Read-only mode),
        so the agent asks before it edits files or runs commands. Pick another mode in the composer.
      </P>
    </DocsShell>
  );
}
