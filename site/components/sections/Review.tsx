import { DiffRows, FakeButton, LineCounts, type ChangedFile, type DiffLine } from "../mockups/parts";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { type Point, PointList } from "../ui/PointList";
import { SectionIntro } from "../ui/SectionIntro";

const POINTS: Point[] = [
  {
    icon: "message-square-text",
    title: "Comment on the lines you want changed",
    body: "In the full review or the inspector's Changes tab. Add puts each comment in your message with its file, line and the line itself, for you to read and edit before Send.",
  },
  {
    icon: "lock",
    title: "A comment never moves",
    body: "It stays on the line it was written on. When the agent changes that line, the comment reads Outdated instead of jumping to similar code.",
  },
  {
    icon: "reply",
    title: "Quote anything back",
    body: "Select text in a reply and press Reply, or select lines in the file view and add them to your message.",
  },
  {
    icon: "git-pull-request",
    title: "Commit, then open the pull request",
    body: (
      <>
        Commit the files you tick. The top bar shows the branch&apos;s pull request and its state, read with
        your own <Chip isCode>gh</Chip>.
      </>
    ),
  },
];

const FILES: ChangedFile[] = [
  { path: "SessionList.tsx", added: 24, removed: 6 },
  { path: "useSessionKeys.ts", added: 31, removed: 0 },
  { path: "session-list.test.tsx", added: 18, removed: 2 },
];

const LINES: DiffLine[] = [
  { kind: "hunk", text: "@@ -38,7 +38,12 @@ export function SessionList" },
  { kind: "context", number: 38, text: "  const rows = visibleRows(sessions);" },
  { kind: "removed", number: 39, text: "  const [active, setActive] = useState(0);" },
  { kind: "added", number: 39, text: "  const { active, onKeyDown } = useSessionKeys(rows);" },
  { kind: "added", number: 40, text: "  // Up and Down move, Return opens." },
  { kind: "context", number: 41, text: "  return (" },
  { kind: "added", number: 42, text: '    <ul role="listbox" onKeyDown={onKeyDown}>' },
];

function SavedComment() {
  return (
    <div className="my-1.5 mr-3 ml-[46px] flex flex-col gap-1.5 rounded-lg border border-border bg-surface-3 p-2.5 font-sans">
      <span className="text-[11px] leading-4 text-fg-subtle">Line 42 · Current</span>
      <span className="text-xs leading-[18px] text-fg-secondary">
        Give the list a name, and say which row is selected with aria-activedescendant.
      </span>
      <span className="flex flex-wrap gap-1">
        <FakeButton variant="ghost" size="sm">Edit</FakeButton>
        <FakeButton variant="ghost" size="sm">Delete</FakeButton>
      </span>
    </div>
  );
}

function ReviewPicture() {
  return (
    <div
      role="img"
      aria-label="The full diff review: three changed files listed on the left, the diff of SessionList.tsx with a comment on line 42 that reads Current, and a bar at the bottom with 2 comments not in a message and a button to add them to your message."
      className="relative flex min-w-0 flex-[1_1_640px] flex-col overflow-hidden rounded-xl border border-border bg-bg text-left shadow-dialog"
    >
      <div className="flex h-12 flex-none items-center gap-3 border-b border-border pr-3 pl-4">
        <span className="inline-flex items-center gap-1 text-xs leading-4 font-semibold text-fg">
          Uncommitted changes
          <Icon name="chevron-down" className="text-fg-muted" />
        </span>
        <span className="text-xs leading-4 text-fg-muted">3 files</span>
        <LineCounts added={73} removed={8} />
        <span className="ml-auto hidden sm:inline-flex">
          <FakeButton variant="outline" icon="minimize-2">Shrink</FakeButton>
        </span>
        <Icon name="x" className="text-fg-secondary" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[200px] flex-none flex-col gap-0.5 border-r border-border bg-surface-1 px-2 py-2.5 sm:flex">
          {FILES.map((file, index) => (
            <span
              key={file.path}
              className={`flex h-[30px] items-center justify-between gap-2 rounded-md px-2 font-mono text-[11px] ${index === 0 ? "bg-surface-hover text-fg" : "text-fg-secondary"}`}
            >
              <span className="truncate">{file.path}</span>
              <LineCounts added={file.added} removed={file.removed} />
            </span>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col pb-[88px]">
          <div className="flex h-9 flex-none items-center gap-2 border-b border-border px-4">
            <Icon name="chevron-down" size={12} className="text-fg-muted" />
            <span className="min-w-0 truncate font-mono text-xs text-fg">src/components/sidebar/SessionList.tsx</span>
            <span className="ml-auto hidden flex-none text-[11px] whitespace-nowrap text-fg-subtle xl:inline">Click a line number to comment</span>
          </div>
          <DiffRows lines={LINES} gutter="w-10" density="text-xs leading-5" after={{ 6: <SavedComment /> }} />
        </div>
      </div>
      <div className="absolute inset-x-4 bottom-4 flex items-center justify-end gap-3 rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 shadow-popover">
        <span className="hidden min-w-0 flex-1 items-center gap-3 sm:flex">
          <Icon name="message-square" className="text-fg-muted" />
          <span className="min-w-0 truncate text-xs leading-4 text-fg-secondary">2 comments not in a message</span>
        </span>
        <FakeButton variant="primary">Add 2 comments to message</FakeButton>
      </div>
    </div>
  );
}

export function Review() {
  return (
    <section id="review" aria-labelledby="review-title" className="border-t border-border py-[72px] md:py-28">
      <div className="site-wrap flex flex-col gap-12">
        <SectionIntro
          id="review-title"
          eyebrow="review"
          title="Review it like a pull request, before it is one."
          lead="Every change the agent makes waits in a diff you can read, comment on and send back in your next message."
          className="max-w-[620px]"
        />
        <div className="flex flex-wrap items-start gap-12 lg:gap-16">
          <ReviewPicture />
          <PointList points={POINTS} className="min-w-0 flex-[1_1_300px]" />
        </div>
      </div>
    </section>
  );
}
