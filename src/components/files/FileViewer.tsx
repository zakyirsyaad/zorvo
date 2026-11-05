import { Fragment, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ArrowLeft, Check, Copy, ExternalLink, Plus } from "lucide-react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { useFileContent } from "../../hooks/useFileContent";
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
  return (
    <h3 title={relativePath} className="flex min-w-0 items-center gap-0.5 truncate font-mono text-caption">
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="text-fg-subtle">/</span>}
          <span className={index === segments.length - 1 ? "text-fg" : "text-fg-muted"}>{segment}</span>
        </Fragment>
      ))}
      {marker && (
        <>
          <span aria-hidden="true" className={`ml-1.5 shrink-0 ${MARKER_COLOR[marker]}`}>
            {MARKER_LETTER[marker]}
          </span>
          <span className="sr-only">{MARKER_WORD[marker]}</span>
        </>
      )}
    </h3>
  );
}

/** The file's lines, numbered, in mono, with a thin bar beside each changed line. */
function Lines({
  name,
  lines,
  tokens,
  changes,
  bodyRef,
}: {
  name: string;
  lines: readonly string[];
  tokens: readonly Token[][];
  changes: ReadonlyMap<number, LineChange>;
  bodyRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={bodyRef}
      role="region"
      aria-label={`Contents of ${name}`}
      className="min-h-0 flex-1 overflow-auto py-1 font-mono text-ui-sm select-text"
    >
      {lines.map((_, index) => {
        const change = changes.get(index + 1);
        return (
          <div key={index} data-line={index + 1} className="flex min-w-max">
            <span className="w-12 shrink-0 select-none pr-2 text-right tabular-nums text-fg-subtle">{index + 1}</span>
            <span className="mr-2 w-0.5 shrink-0 select-none">
              {change && <span data-gutter="" aria-hidden="true" className={`block h-full w-0.5 ${GUTTER_COLOR[change]}`} />}
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
    </div>
  );
}

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

  return (
    <section aria-label="File viewer" className="flex h-full min-h-0 flex-1 flex-col bg-surface-1">
      <div className="flex flex-col gap-1.5 border-b border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" icon={<ArrowLeft size={13} aria-hidden="true" />} onClick={onBack} className="-ml-2 px-2">
            Files
          </Button>
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton label="Add to prompt" onClick={() => onInsertPath(absolutePath)}>
              <Plus size={14} />
            </IconButton>
            <IconButton label="Open in editor" onClick={openInEditor}>
              <ExternalLink size={14} />
            </IconButton>
            <IconButton label={isCopied ? "Path copied" : "Copy path"} onClick={copyPath}>
              {isCopied ? <Check size={14} /> : <Copy size={14} />}
            </IconButton>
          </div>
        </div>
        <Breadcrumb relativePath={relativePath} marker={marker} />
        {text !== null && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-caption text-fg-muted">
              {language.name} · {lines.length} {lines.length === 1 ? "line" : "lines"} · Read only
            </p>
            {marker && (
              <label className="flex shrink-0 items-center gap-1.5 text-caption text-fg-muted">
                <input
                  type="checkbox"
                  checked={isMarking}
                  onChange={(event) => setIsMarking(event.target.checked)}
                  className="focus-ring accent-fg"
                />
                Mark changed lines
              </label>
            )}
          </div>
        )}
        {openError && (
          <p role="alert" className="text-caption text-danger">
            {openError}
          </p>
        )}
      </div>
      {read.status === "loading" && <p className="px-3 py-4 text-ui-sm text-fg-muted">Loading…</p>}
      {read.status === "failed" && <Unshown failure={read.message} />}
      {read.status === "ready" &&
        (text !== null ? (
          <div className="relative flex min-h-0 flex-1 flex-col">
            <Lines name={name} lines={lines} tokens={tokens} changes={isMarking ? changes : NO_CHANGES} bodyRef={bodyRef} />
            {onInsertText && selection.range && (
              <Button
                variant="outline"
                className="absolute right-3 top-2 bg-surface-2 shadow-popover"
                // mousedown, not click, would end the selection the click is about.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  const { first, last } = selection.range!;
                  onInsertText(lineQuote(relativePath, first, last, lines.slice(first - 1, last), language.fence));
                  selection.clear();
                  window.getSelection()?.removeAllRanges();
                }}
              >
                {lineRangeLabel(selection.range.first, selection.range.last)}
              </Button>
            )}
          </div>
        ) : (
          <Unshown content={read.content} />
        ))}
    </section>
  );
}
