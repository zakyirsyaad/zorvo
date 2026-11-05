import { Fragment, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Copy, ExternalLink, Plus } from "lucide-react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { useFileContent } from "../../hooks/useFileContent";
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
}

const MARKER_COLOR: Record<FileMarker, string> = {
  modified: "text-status-attention",
  added: "text-status-running",
};

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

/** The file's lines, numbered, in mono. */
function Lines({ name, lines }: { name: string; lines: readonly string[] }) {
  return (
    <div role="region" aria-label={`Contents of ${name}`} className="min-h-0 flex-1 overflow-auto py-1 font-mono text-ui-sm">
      {lines.map((line, index) => (
        <div key={index} data-line={index + 1} className="flex min-w-max">
          <span className="w-12 shrink-0 select-none pr-3 text-right tabular-nums text-fg-subtle">{index + 1}</span>
          <span className="whitespace-pre pr-4 text-fg-secondary">{line}</span>
        </div>
      ))}
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
export function FileViewer({ rootPath, relativePath, marker, version, onBack, onInsertPath }: FileViewerProps) {
  const read = useFileContent(rootPath, relativePath, version);
  const [isCopied, setIsCopied] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const absolutePath = joinWorkspacePath(rootPath, relativePath);
  const name = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  const language = languageOf(relativePath);
  const text = read.status === "ready" && read.content.kind === "text" ? read.content.text : null;
  const lines = useMemo(() => (text === null ? [] : splitLines(text)), [text]);

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
          <p className="text-caption text-fg-muted">
            {language.name} · {lines.length} {lines.length === 1 ? "line" : "lines"} · Read only
          </p>
        )}
        {openError && (
          <p role="alert" className="text-caption text-danger">
            {openError}
          </p>
        )}
      </div>
      {read.status === "loading" && <p className="px-3 py-4 text-ui-sm text-fg-muted">Loading…</p>}
      {read.status === "failed" && <Unshown failure={read.message} />}
      {read.status === "ready" && (text !== null ? <Lines name={name} lines={lines} /> : <Unshown content={read.content} />)}
    </section>
  );
}
