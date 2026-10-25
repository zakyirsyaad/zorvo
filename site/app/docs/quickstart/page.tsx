import { DocsShell, type TocEntry } from "../../../components/docs/DocsShell";
import { B, DocLink, H2, OL, P, UL } from "../../../components/docs/parts";
import { docsMetadata } from "../../../lib/docs-metadata";

export const metadata = docsMetadata("/docs/quickstart");

const TOC: TocEntry[] = [
  { id: "steps", label: "Your first session" },
  { id: "mode", label: "Permission modes" },
];

export default function QuickstartPage() {
  return (
    <DocsShell
      current="/docs/quickstart"
      title="Quickstart"
      lead="From a fresh install to a first message: choose a folder, a branch and an agent."
      toc={TOC}
    >
      <H2 id="steps">Your first session</H2>
      <OL>
        <li>
          <B>Onboarding.</B> The first run checks which agents are installed, lets you pick a default, and asks for a
          project folder. Add more agents later in Settings, Agents.
        </li>
        <li>
          <B>Start a session.</B> Click <B>+ New</B>, or the <B>+</B> next to a folder to choose its agent. Pick the
          folder, branch, model, effort and permission mode in the composer, and send your first message. Turn on{" "}
          <B>Worktree</B> first to give the session its own checkout, on an <B>agent/&lt;title&gt;</B> branch.
        </li>
        <li>
          <B>Work with the agent.</B>
          <UL>
            <li>Answer its permission requests in the chat.</li>
            <li>Open <B>Files</B> to browse the folder and <B>Changes</B> to review and commit what it changed.</li>
            <li>Open <B>Terminal</B> for a shell in the same folder. See <DocLink href="/docs/terminal">Terminal</DocLink>.</li>
            <li>Use the top bar to go back and forth between sessions.</li>
          </UL>
        </li>
        <li>
          <B>Branch off.</B>
          <UL>
            <li><B>Fork</B> under any reply starts a new session from there.</li>
            <li>
              <B>Rewind</B> under one of your messages takes the conversation back to before it and puts the message in
              the composer to edit. It needs a confirming second click, and files the agent changed stay as they are.
            </li>
          </UL>
        </li>
      </OL>
      <P>
        The composer also lets you mention files with <B>@</B>, drop files onto the window, and click the context meter
        to see tokens used, tokens left and cost.
      </P>

      <H2 id="mode">Permission modes</H2>
      <P>
        Each session starts in the safest permission mode its agent offers (its Default, Manual, Ask or Read-only mode),
        so the agent asks before it edits files or runs commands. Pick another mode in the composer.
      </P>
    </DocsShell>
  );
}
