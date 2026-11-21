import { DocsShell, type TocEntry } from "../../../components/docs/DocsShell";
import { B, Callout, DocLink, H2, P, UL } from "../../../components/docs/parts";
import { Chip } from "../../../components/ui/Chip";
import { docsMetadata } from "../../../lib/docs-metadata";

export const metadata = docsMetadata("/docs/output");

const TOC: TocEntry[] = [
  { id: "tab", label: "The Output tab" },
  { id: "pages", label: "Pages and versions" },
  { id: "comments", label: "Comment on a page" },
  { id: "canvas", label: "A canvas of screens" },
  { id: "reach", label: "What a page can reach" },
  { id: "off", label: "Turn it off" },
];

export default function OutputPage() {
  return (
    <DocsShell
      current="/docs/output"
      title="Pages and canvases"
      lead="An agent can show you a page it made, or several screens side by side, beside the chat. You comment on what you see and send the comments back."
      toc={TOC}
    >
      <H2 id="tab">The Output tab</H2>
      <UL>
        <li>
          <B>Output</B> is a tab of the inspector, beside the chat. It is there for every session. Until the agent
          makes something, it says what will show there.
        </li>
        <li>
          Under the pages, the tab lists the files the agent created in the session. Click one to read it in the file
          viewer.
        </li>
        <li>
          <B>Output</B> in the sidebar lists the pages and canvases of every session.
        </li>
      </UL>
      <P>
        An agent shows a page when you ask for one, and may show one on its own when an answer is better seen than
        read: a report, a comparison, a chart or a diagram. Whether it does is the agent&apos;s choice.
      </P>

      <H2 id="pages">Pages and versions</H2>
      <UL>
        <li>
          Where the agent showed a page, the chat has a row with the page&apos;s title, its version and <B>Open</B>.
        </li>
        <li>
          Each time the agent changes the page you get a new version. <B>Versions</B> above the page goes back to an
          older one.
        </li>
        <li>
          <B>Export</B> saves the page as one HTML file. <B>Reload</B> starts the page again, which also ends a page
          that got stuck.
        </li>
        <li>Pages are stored on this Mac and deleted with their session.</li>
      </UL>

      <H2 id="comments">Comment on a page</H2>
      <UL>
        <li>
          Press <B>Comment</B> above the newest version, then select text or click a part of the page, and write what
          should change.
        </li>
        <li>
          Comments are numbered on the page and listed under it. <B>Add to message</B> puts one in your message, and{" "}
          <B>Add 2 to message</B> puts in all that are not there yet, with the file and version they are about. Read
          and edit the message, then press Send.
        </li>
        <li>
          A comment stays with the version it was written on. It reads <B>Current</B> on the newest version and{" "}
          <B>Outdated</B> once the agent has changed the page.
        </li>
        <li>What you type in a comment never reaches the page.</li>
      </UL>
      <P>
        Comments on a diff work the same way. See <DocLink href="/docs/review">Review changes</DocLink>.
      </P>

      <H2 id="canvas">A canvas of screens</H2>
      <Callout>
        <B>In versions after 0.14.1.</B> A canvas shows several screens at once: a flow, the variants of one screen,
        or a whole redesign.
      </Callout>
      <UL>
        <li>
          The screens are artboards in labelled sections. Pan with two fingers or by dragging, and pinch to zoom.{" "}
          <B>Sections</B> jumps to a section or fits the view.
        </li>
        <li>
          Click an artboard to select it. <B>Focus</B> shows it alone, and the arrows step to the previous or next
          one.
        </li>
        <li>
          <B>Comment</B> works on text or an element inside an artboard, or on the whole artboard.
        </li>
        <li>
          <B>Pick</B> keeps one variant of a screen. <B>Build this</B> and <B>Build section</B> ask the agent to build
          the screens in your repository. Each puts a message in the box for you to edit and send.
        </li>
        <li>
          <B>Export</B> saves one artboard as PNG or PDF, every artboard as PNG files, or the whole canvas as one PDF.
        </li>
      </UL>
      <P>
        A canvas is a folder in your project: <Chip isCode>canvas.json</Chip> and one HTML file per artboard. Git keeps
        its history, any session can open it again, and deleting a session keeps the files.
      </P>

      <H2 id="reach">What a page can reach</H2>
      <P>
        A page runs in a part of the window of its own. It cannot call Zorvo, read your files, keep data, or open any
        address but its own. An artboard runs under the same limits and may also load the files in its canvas folder.
      </P>
      <UL>
        <li>
          Scripts may load from <Chip isCode>cdnjs.cloudflare.com</Chip>, <Chip isCode>cdn.jsdelivr.net</Chip>,{" "}
          <Chip isCode>unpkg.com</Chip>, <Chip isCode>cdn.tailwindcss.com</Chip> and{" "}
          <Chip isCode>code.jquery.com</Chip>, and fonts from Google Fonts, only when the page asks for them.
        </li>
        <li>A page cannot send a request anywhere else.</li>
        <li>
          A page you export is an ordinary HTML file. Opened in a browser, it has none of these limits.
        </li>
      </UL>
      <P>
        <DocLink href="/docs/privacy">Privacy and your data</DocLink> lists every host Zorvo contacts.
      </P>

      <H2 id="off">Turn it off</H2>
      <P>
        Pages and canvases come with the tools Zorvo gives an agent. The switch for those tools is in Settings, Agents.
        It applies to sessions you start or reopen afterwards.
      </P>
    </DocsShell>
  );
}
