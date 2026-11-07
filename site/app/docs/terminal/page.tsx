import { DocsShell, type TocEntry } from "../../../components/docs/DocsShell";
import { B, H2, P, UL } from "../../../components/docs/parts";
import { docsMetadata } from "../../../lib/docs-metadata";

export const metadata = docsMetadata("/docs/terminal");

const TOC: TocEntry[] = [
  { id: "shell", label: "A shell where the agent works" },
  { id: "ends", label: "When a shell ends" },
];

export default function TerminalPage() {
  return (
    <DocsShell
      current="/docs/terminal"
      title="Terminal"
      lead="The inspector's Terminal tab opens a shell in the folder the session works in."
      toc={TOC}
    >
      <H2 id="shell">A shell where the agent works</H2>
      <UL>
        <li>
          Open <B>Inspector</B> in the top bar and pick <B>Terminal</B>. The inspector widens to at least 560px while the
          tab shows. The shell runs in the session&apos;s folder, or its worktree when it has one.
        </li>
        <li>It is your login shell, so your <B>PATH</B> and tools are there.</li>
        <li>
          Each shell is a tab named by its shell (&quot;zsh&quot;, then &quot;zsh 2&quot;), and the selected one shows the
          folder and its size (&quot;80 × 38&quot;). <B>New terminal</B> adds a tab.
        </li>
        <li>
          Each folder keeps its own tabs. Switching tabs, closing the inspector or switching sessions leaves the shells
          running, and coming back shows them as they were.
        </li>
      </UL>
      <H2 id="ends">When a shell ends</H2>
      <UL>
        <li>Closing a tab or quitting Zorvo ends the shell and the processes running under it. A job detached from the shell, or left after <B>exit</B>, can outlive it.</li>
        <li>A shell that exited says so under it, with <B>Start a new shell</B>.</li>
        <li>A worktree&apos;s terminals end when Zorvo removes that worktree. A worktree it keeps, with uncommitted changes or still used by another session, keeps them.</li>
      </UL>
      <P>An agent&apos;s own sign-in or setup uses a separate terminal inside Zorvo; it is not one of these tabs.</P>
    </DocsShell>
  );
}
