import { DocsShell, type TocEntry } from "../../../components/docs/DocsShell";
import { B, DocLink, H2, P, UL } from "../../../components/docs/parts";
import { Chip } from "../../../components/ui/Chip";
import { docsMetadata } from "../../../lib/docs-metadata";

export const metadata = docsMetadata("/docs/review");

const TOC: TocEntry[] = [
  { id: "changes", label: "The Changes tab" },
  { id: "comments", label: "Comment on lines" },
  { id: "quote", label: "Quote a reply or a file" },
  { id: "activity", label: "What the agent did" },
  { id: "pull-requests", label: "Commit and pull requests" },
];

export default function ReviewPage() {
  return (
    <DocsShell
      current="/docs/review"
      title="Review changes"
      lead="Read what an agent changed, comment on the lines you want changed, and send the comments in your next message."
      toc={TOC}
    >
      <H2 id="changes">The Changes tab</H2>
      <UL>
        <li>
          <B>Inspector</B> in the top bar opens a panel beside the chat. Its <B>Changes</B> tab lists each changed file
          as a card with its added and removed lines. Open a card to read its diff.
        </li>
        <li>
          The diff chip in the top bar (<Chip isCode>+42 −11</Chip>), or <B>Open the diff</B> in Changes, opens the full
          review in the chat&apos;s place, with the changed files listed on its left. <B>Shrink</B> puts it beside the
          chat.
        </li>
      </UL>

      <H2 id="comments">Comment on lines</H2>
      <UL>
        <li>
          Click a line number in the full review or in a Changes card, write what you want changed, and press{" "}
          <B>Save comment</B>.
        </li>
        <li>
          <B>Add 2 comments to message</B> puts them in your message, each with its file, its line and the line itself.
          Read and edit the message, then press Send. Nothing reaches the agent before you do.
        </li>
        <li>
          A comment stays on the line it was written on. It reads <B>Current</B> while the line is as it was, and{" "}
          <B>Outdated</B> when the agent changed or removed it. It never moves to similar code elsewhere.
        </li>
        <li>
          A sent comment stays, dimmed, with <B>Add again</B>, until you press <B>Clear sent</B>. Comments belong to
          their session and are kept after a restart.
        </li>
      </UL>

      <H2 id="quote">Quote a reply or a file</H2>
      <UL>
        <li>Select text in a message and press <B>Reply</B> to quote it in your message, with a line under it for your question.</li>
        <li>
          The inspector&apos;s <B>Files</B> tab marks changed files (M, A) and the folders that hold them. Click a file
          to read it with its changed lines marked. Select lines and press <B>Add lines</B> to put the path, the range and
          the lines in your message.
        </li>
      </UL>

      <H2 id="activity">What the agent did</H2>
      <P>
        The <B>Activity</B> tab lists the files, commands and permissions the agent reported, grouped by turn, with a
        jump to each in the chat. When git shows changed files the agent did not report, a card lists them, with{" "}
        <B>Show in Changes</B>. It is the agent&apos;s own report, and rewinding the chat removes its entries too.
      </P>

      <H2 id="pull-requests">Commit and pull requests</H2>
      <P>
        Tick the files you want and press <B>Commit</B> at the bottom of the Changes tab. The top bar shows the
        branch&apos;s pull request and its state, read with your own <Chip isCode>gh</Chip>. Settings, GitHub says whether{" "}
        <Chip isCode>gh</Chip> is signed in. See <DocLink href="/docs/troubleshooting#pull-requests">No pull request status</DocLink>.
      </P>
    </DocsShell>
  );
}
