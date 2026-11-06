import { Fragment, memo, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Check, ChevronLeft, Copy, ExternalLink, Plus } from "lucide-react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { useFileContent } from "../../hooks/useFileContent";
import { useLatest } from "../../hooks/useLatest";
import { useChangedLines } from "../../hooks/useChangedLines";
import { useLineSelection } from "../../hooks/useLineSelection";
import { lineQuote, lineRangeLabel } from "../../lib/line-quote";
import type { LineChange } from "../../lib/changed-lines";
import { TOKEN_STYLE, tokenizeLines, type Token } from "../../lib/code-tokens";
import { errorMessage, joinWorkspacePath, openWorkspacePath } from "../../lib/files";
import { formatSize, languageOf, splitLines, type FileContent } from "../../lib/file-content";
import { MARKER_LETTER, MARKER_WORD, type FileMarker } from "../../lib/file-markers";

export interface FileViewerProps {
  /** The Files tab's folder. */
  rootPath: string;
  /** The file, relative to that folder. */
  relativePath: string;
  marker?: FileMarker;
  /** Moves when the folder's changes are read again; the file is read again then. */
  version: number;
  /** Back to the tree. */
  onBack: () => void;
  /** Adds the file's absolute path to the composer. */
  onInsertPath: (absolutePath: string) => void;
  /** Adds text to the composer (a range of lines); absent in a popout. */
  onInsertText?: (text: string) => void;
  /** The Files tab's folder relative to its repository's root ("app/"), for the file's diff. */
  filesPrefix?: string;
}

const GUTTER_COLOR: Record<LineChange, string> = {
  added: "bg-status-running",
  modified: "bg-status-attention",
};

const MARKER_COLOR: Record<FileMarker, string> = {
  modified: "text-status-attention",
  added: "text-status-running",
};

const NO_CHANGES: ReadonlyMap<number, LineChange> = new Map();

/** How long "Path copied" stays after Copy path. */
const COPIED_MS = 2000;

/** A failed read that says the file is gone, as `resolve_inside_root` words it. */
const isGone = (message: string) => message.includes("not accessible");

function Breadcrumb({ relativePath, marker }: { relativePath: string; marker?: FileMarker }) {
  const segments = relativePath.split("/");
  const folders = segments.slice(0, -1);
  const name = segments[segments.length - 1];
  return (
    // A heading, so the open file can be found by heading; its folders give way first on a long path, never its name.
    <h3 title={relativePath} className="flex min-w-0 flex-1 items-center whitespace-nowrap font-mono text-caption text-fg-subtle">
      {folders.length > 0 && (
        <span className="min-w-0 truncate">
          {folders.map((folder, index) => (
            <Fragment key={index}>
              {folder}
              <span aria-hidden="true" className="mx-1">/</span>
            </Fragment>
          ))}
        </span>
      )}
      <span className="shrink-0 text-fg">{name}</span>
      {marker && (
        <>
          <span aria-hidden="true" className={`ml-1 shrink-0 font-semibold ${MARKER_COLOR[marker]}`}>
            {MARKER_LETTER[marker]}
          </span>
          <span className="sr-only">{MARKER_WORD[marker]}</span>
        </>
      )}
    </h3>
  );
}

/**
 * The file's lines, numbered, in mono, with a thin bar beside each changed line. Memoized: the window
 * re-renders on every streamed frame of a turn, and a 1 MiB file has some 25,000 rows to rebuild.
 */
export const FileLines = memo(function FileLines({
  name,
  lines,
  tokens,
  changes,
  bodyRef,
  selected,
  overlay,
}: {
  name: string;
  lines: readonly string[];
  tokens: readonly Token[][];
  changes: ReadonlyMap<number, LineChange>;
  bodyRef: RefObject<HTMLDivElement | null>;
  /** The lines a selection covers, tinted. */
  selected?: { first: number; last: number } | null;
  /** Drawn inside the scrolling code, so it moves with the lines (the add-lines card). */
  overlay?: ReactNode;
}) {
  return (
    // Focusable: WebKit does not let the keyboard into a scroll container, and Shift with the arrows selects lines here.
    <div
      ref={bodyRef}
      role="region"
      tabIndex={0}
      aria-label={`Contents of ${name}`}
      // Padding and line height come from the numbers the add-lines card is placed by, so the two cannot drift.
      style={BODY_STYLE}
      className="focus-ring relative min-h-0 flex-1 overflow-auto bg-bg font-mono text-ui-sm select-text"
    >
      {lines.map((_, index) => {
        const line = index + 1;
        const change = changes.get(line);
        const isSelected = selected != null && line >= selected.first && line <= selected.last;
        return (
          <div key={index} data-line={line} className={`flex min-w-max ${isSelected ? "bg-line-selected" : ""}`}>
            <span className={`w-10 shrink-0 select-none pr-3 text-right tabular-nums ${isSelected ? "text-fg" : "text-fg-subtle"}`}>
              {line}
            </span>
            <span className="mr-2.5 w-[3px] shrink-0 select-none">
              {change && <span data-gutter="" aria-hidden="true" className={`block h-full w-[3px] ${GUTTER_COLOR[change]}`} />}
            </span>
            <span className="whitespace-pre pr-4 text-fg-secondary">
              {tokens[index].map((token, at) =>
                token.kind === "plain" ? (
                  <Fragment key={at}>{token.text}</Fragment>
                ) : (
                  <span key={at} className={TOKEN_STYLE[token.kind]}>
                    {token.text}
                  </span>
                ),
              )}
            </span>
          </div>
        );
      })}
      {overlay}
    </div>
  );
});

/** The code's top padding and line height (12px on 20px rows, as drawn), which also place the add-lines card. */
const BODY_PADDING_PX = 10;
const LINE_HEIGHT_PX = 20;
const BODY_STYLE = { paddingTop: BODY_PADDING_PX, paddingBottom: BODY_PADDING_PX, lineHeight: `${LINE_HEIGHT_PX}px` } as const;
/** Just right of the 40px number gutter and its change bar. */
const ADD_LINES_LEFT_PX = 56;
const ADD_LINES_GAP_PX = 4;

/** Why there is nothing to read: binary, too large, gone, or another failure. */
function Unshown({ content, failure }: { content?: FileContent; failure?: string }) {
  const message =
    failure !== undefined
      ? isGone(failure)
        ? "This file is no longer here."
        : failure
      : content?.kind === "binary"
        ? `This file is binary (${formatSize(content.size)}), so it is not shown.`
        : content?.kind === "tooLarge"
          ? `This file is too large to show (${formatSize(content.size)}; the limit is ${formatSize(content.limit)}).`
          : "";
  const isError = failure !== undefined && !isGone(failure);
  return (
    <p role={isError ? "alert" : undefined} className={`px-3 py-4 text-ui-sm ${isError ? "text-danger" : "text-fg-muted"}`}>
      {message}
    </p>
  );
}

/** A workspace file, read only, inside the Files tab. */
export function FileViewer({
  rootPath,
  relativePath,
  marker,
  version,
  onBack,
  onInsertPath,
  onInsertText,
  filesPrefix = "",
}: FileViewerProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const selection = useLineSelection(bodyRef);
  const read = useFileContent(rootPath, relativePath, version);
  const [isMarking, setIsMarking] = useState(true);
  // Only a changed file has lines to mark; one without a marker reads no diff at all.
  const changes = useChangedLines(rootPath, `${filesPrefix}${relativePath}`, marker !== undefined, version);
  const [isCopied, setIsCopied] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const absolutePath = joinWorkspacePath(rootPath, relativePath);
  const name = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  const language = languageOf(relativePath);
  const text = read.status === "ready" && read.content.kind === "text" ? read.content.text : null;
  const lines = useMemo(() => (text === null ? [] : splitLines(text)), [text]);
  // Once per text: a re-render (a tick of the copied label, the checkbox) never re-scans the file.
  const tokens = useMemo(() => tokenizeLines(lines, language.fence), [lines, language.fence]);

  useEffect(() => {
    if (!isCopied) return;
    const timer = setTimeout(() => setIsCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [isCopied]);

  const copyPath = () => {
    navigator.clipboard
      .writeText(absolutePath)
      .then(() => setIsCopied(true))
      .catch(() => setIsCopied(false));
  };

  const openInEditor = () => {
    setOpenError(null);
    openWorkspacePath(rootPath, relativePath).catch((error: unknown) => {
      setOpenError(`Couldn't open ${name}: ${errorMessage(error)}`);
    });
  };

  const { range, clear: clearSelection } = selection;
  // The caller passes a new callback on every render; read through a ref, it does not rebuild the card.
  const insertTextRef = useLatest(onInsertText);
  const canInsertText = onInsertText !== undefined;
  // Built once per selection: a new element each render would rebuild every row of the memoized lines.
  const addLines = useMemo(() => {
    if (!canInsertText || !range) return null;
    return (
      <div
        // Beside the end you moved, where you are looking: under the last line, or above the first for a selection
        // made upward (which on a long file would otherwise leave the card far below the view).
        style={{
          top: range.isBackward
            ? BODY_PADDING_PX + (range.first - 1) * LINE_HEIGHT_PX - ADD_LINES_GAP_PX
            : BODY_PADDING_PX + range.last * LINE_HEIGHT_PX + ADD_LINES_GAP_PX,
          left: ADD_LINES_LEFT_PX,
        }}
        className={`absolute flex rounded-lg border border-border bg-surface-3 p-0.5 font-sans shadow-popover select-none ${
          range.isBackward ? "-translate-y-full" : ""
        }`}
      >
        <Button
          variant="ghost"
          tone="secondary"
          icon={<Plus size={14} aria-hidden="true" />}
          // mousedown, not click, would end the selection the click is about.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            insertTextRef.current?.(lineQuote(relativePath, range.first, range.last, lines.slice(range.first - 1, range.last), language.fence));
            clearSelection();
            window.getSelection()?.removeAllRanges();
          }}
        >
          {lineRangeLabel(range.first, range.last)}
        </Button>
      </div>
    );
  }, [canInsertText, range, relativePath, lines, language.fence, clearSelection, insertTextRef]);

  return (
    <section aria-label="File viewer" className="flex h-full min-h-0 flex-1 flex-col bg-surface-1">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border px-2">
        <Button variant="ghost" tone="secondary" size="row" icon={<ChevronLeft size={14} aria-hidden="true" />} onClick={onBack}>
          Files
        </Button>
        <Breadcrumb relativePath={relativePath} marker={marker} />
        <IconButton label={`Add ${name} to prompt`} title="Add to prompt" size="row" onClick={() => onInsertPath(absolutePath)}>
          <Plus size={14} />
        </IconButton>
        <IconButton label="Open in editor" title="Open in editor" size="row" onClick={openInEditor}>
          <ExternalLink size={14} />
        </IconButton>
        <IconButton label={isCopied ? "Path copied" : "Copy path"} title="Copy path" size="row" onClick={copyPath}>
          {isCopied ? <Check size={14} /> : <Copy size={14} />}
        </IconButton>
      </div>
      {text !== null && (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border pr-3 pl-4 text-caption text-fg-subtle">
          <span className="min-w-0 flex-1 truncate">
            {language.name} · {lines.length} {lines.length === 1 ? "line" : "lines"} · Read only
          </span>
          {marker && (
            <label className="flex shrink-0 items-center gap-1.5 text-fg-secondary">
              <input
                type="checkbox"
                checked={isMarking}
                onChange={(event) => setIsMarking(event.target.checked)}
                className="focus-ring size-3 accent-fg"
              />
              Mark changed lines
            </label>
          )}
        </div>
      )}
      {openError && (
        <p role="alert" className="border-b border-border px-4 py-1.5 text-caption text-danger">
          {openError}
        </p>
      )}
      {read.status === "loading" && <p className="px-3 py-4 text-ui-sm text-fg-muted">Loading…</p>}
      {read.status === "failed" && <Unshown failure={read.message} />}
      {read.status === "ready" &&
        (text !== null ? (
          <FileLines
            name={name}
            lines={lines}
            tokens={tokens}
            changes={isMarking ? changes : NO_CHANGES}
            bodyRef={bodyRef}
            selected={canInsertText ? range : null}
            overlay={addLines}
          />
        ) : (
          <Unshown content={read.content} />
        ))}
    </section>
  );
}
