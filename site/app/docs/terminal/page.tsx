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
      crumb={["Using Zorvo", "Terminal"]}
      title="Terminal"
      lead="The Terminal button in the top bar opens a shell in the folder the session works in."
      toc={TOC}
    >
      <H2 id="shell">A shell where the agent works</H2>
      <UL>
        <li>The shell opens in a drawer under the chat and the side panels. It runs in the session&apos;s folder, or its worktree when it has one.</li>
        <li>It is your login shell, so your <B>PATH</B> and tools are there.</li>
        <li>Each folder keeps its own tabs, so switching sessions and coming back leaves them as they were. <B>New terminal</B> adds a tab, and the drawer&apos;s edge resizes it.</li>
      </UL>
      <H2 id="ends">When a shell ends</H2>
      <UL>
        <li>Closing a tab or quitting Zorvo ends the shell and the processes running under it. A job detached from the shell, or left after <B>exit</B>, can outlive it.</li>
        <li>A worktree&apos;s terminals end when Zorvo removes that worktree. A worktree it keeps, with uncommitted changes or still used by another session, keeps them.</li>
      </UL>
      <P>An agent&apos;s own sign-in uses a separate terminal inside Zorvo; it is not one of these tabs.</P>
    </DocsShell>
  );
}
