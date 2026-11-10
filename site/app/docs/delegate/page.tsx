import { DocsShell, type TocEntry } from "../../../components/docs/DocsShell";
import { B, Callout, DocLink, H2, OL, P, UL } from "../../../components/docs/parts";
import { docsMetadata } from "../../../lib/docs-metadata";

export const metadata = docsMetadata("/docs/delegate");

const TOC: TocEntry[] = [
  { id: "mention", label: "Delegate with @" },
  { id: "menu", label: "Delegate from the session menu" },
  { id: "report", label: "The answer comes back" },
  { id: "limits", label: "What blocks a delegation" },
  { id: "end", label: "End a delegation" },
];

export default function DelegatePage() {
  return (
    <DocsShell
      current="/docs/delegate"
      title="Delegate a task"
      lead="Hand a task from one session to another agent. It works in the same folder, and its answer comes back to the session that asked."
      toc={TOC}
    >
      <P>
        A delegation is a pair of sessions. The one you are in is the session that asks, and the agent you pick gets a
        session of its own. It reads the conversation so far, works on the task in the same folder, and each answer it
        gives is sent back to the first session. You can open the second session at any time to watch it work.
      </P>

      <H2 id="mention">Delegate with @</H2>
      <OL>
        <li>
          In a session that has messages, type <B>@</B> at the very start of the message box. An @ later in the
          message lists files instead, so an agent is offered only when the @ starts the message.
        </li>
        <li>
          The list <B>Delegate to an agent</B> shows each agent you use with its state: Ready, Not checked or Needs
          sign-in. Keep typing to narrow it by name, and pick one.
        </li>
        <li>
          Write what the agent should do after the @, for example &quot;@Codex write tests for the discount
          totals&quot;. The Send button becomes <B>Delegate to Codex</B>. Press it.
        </li>
      </OL>
      <P>
        The task is the text after the agent&apos;s name. Zorvo starts the agent&apos;s session with it, and the agent
        starts in the safest mode it has.
      </P>

      <H2 id="menu">Delegate from the session menu</H2>
      <OL>
        <li>
          Open the session&apos;s <B>⋯</B> menu in the top bar and choose <B>Delegate to another agent…</B>. The item
          is not there in a new session that has no message yet. When delegating is blocked, it stays in the menu,
          dimmed, with the reason under it.
        </li>
        <li>
          Pick the <B>Agent</B>, then write the <B>Task</B>. The dialog also shows the agent&apos;s own model, effort
          and permission mode chips, so you choose what it starts on. Opening the dialog starts no agent; Zorvo asks an
          agent for its options only when you open one of its chips.
        </li>
        <li>
          Press <B>Delegate</B>, or <B>Cancel</B> to drop it. A line under the task says that the agent reads this
          conversation first and works in the same folder, and that each answer it gives is sent to your session.
        </li>
      </OL>

      <H2 id="report">The answer comes back</H2>
      <UL>
        <li>
          While the agent works, the session that asked shows <B>Codex is working on the task you delegated</B> under
          the chat, with the time it has run and <B>Open</B>. If the agent needs your answer or a turn fails, the line
          says so.
        </li>
        <li>
          The second session is listed under the first in the sidebar, and starts with one quiet line:{" "}
          <B>Delegated from Add discount codes to checkout · Claude Code</B>, with <B>Open</B>.
        </li>
        <li>
          When the agent finishes a turn, its answer is sent to the first session as a message that begins{" "}
          <B>Report from Codex on the task you delegated</B>. It quotes the answer, up to 20,000 characters, and lists
          the files the agent reported changing in that turn. The first agent is told to treat the quote as
          information, not as instructions from you.
        </li>
        <li>
          If the first session is not running, the report waits in its composer until you send it.
        </li>
      </UL>
      <Callout>
        Each agent runs on its own sign-in and uses its own quota, so a delegation costs a turn for each agent. Read
        what the second agent changed in <DocLink href="/docs/review">Review changes</DocLink>.
      </Callout>

      <H2 id="limits">What blocks a delegation</H2>
      <UL>
        <li>
          <B>One task at a time.</B> A session that already has an open delegation says that the agent already has a
          task from this session.
        </li>
        <li>
          <B>One level.</B> A delegated session cannot delegate again.
        </li>
        <li>
          <B>Waiting turns.</B> While the first agent is working, you cannot send to the second, and the other way
          round: the session that asked waits for the agent&apos;s turn, and the agent waits while the first works on its
          report. Send says which one it is waiting for.
        </li>
        <li>An agent that is not installed cannot be picked.</li>
      </UL>

      <H2 id="end">End a delegation</H2>
      <P>
        Choose <B>End delegation</B> in either session&apos;s ⋯ menu. The two sessions stop reporting to each other and
        neither waits for the other. The second session keeps its history and reads{" "}
        <B>Delegated from … · ended</B>. It stays a delegated session, so it cannot delegate in turn.
      </P>
    </DocsShell>
  );
}
