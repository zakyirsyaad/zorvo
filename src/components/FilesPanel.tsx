import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, File, Folder, Plus, RefreshCw, Search, X } from "lucide-react";
import { IconButton } from "./ui/IconButton";
import { useFileTree, type FileTree } from "../hooks/useFileTree";
import {
  errorMessage,
  filterVisiblePaths,
  joinWorkspacePath,
  openWorkspacePath,
  ROOT_FOLDER,
  type DirEntryInfo,
} from "../lib/files";
import { MARKER_LETTER, MARKER_WORD, type FileMarker, type FileMarkers } from "../lib/file-markers";
import { FileViewer } from "./files/FileViewer";

export interface FilesPanelProps {
  /** Absolute path of the workspace folder the tree shows. */
  rootPath: string;
  /** Display name of that folder, e.g. its last path segment. */
  rootName: string;
  /** Shows a close button; inside the inspector the inspector closes it. */
  onClose?: () => void;
  /** Adds a file's absolute path to the composer; row buttons are hidden when absent. */
  onInsertPath?: (absolutePath: string) => void;
  /** Reveals the workspace folder in Finder; the header button is hidden when absent. */
  onRevealRoot?: () => void;
  /** Git markers: a letter on changed files, a dot on folders holding changes. */
  markers?: FileMarkers;
  /** The file open in the viewer, relative to the folder; the tree shows while it is null. */
  viewedFile?: string | null;
  /** Opens a clicked file in the viewer; without it, a click opens the file in its own app. */
  onViewFile?: (relative: string) => void;
  /** The viewer's "← Files". */
  onCloseFile?: () => void;
  /** Moves when the folder's changes are read again; the open file is read again then. */
  version?: number;
  /** The folder relative to its repository's root, for the open file's diff. */
  filesPrefix?: string;
  /** Adds text to the composer (a range of the open file's lines). */
  onInsertText?: (text: string) => void;
}

const MARKER_COLOR: Record<FileMarker, string> = {
  modified: "text-status-attention",
  added: "text-status-running",
};

// As drawn: a folder 4px in plus 16px a level; a file past its folder's 12px chevron and 6px gap, so the icons line up.
const BASE_INDENT_PX = 4;
const INDENT_STEP_PX = 16;
const FILE_INDENT_PX = 18;
const ROW =
  "group flex h-[26px] items-center gap-1.5 rounded pr-1.5 text-fg-secondary hover:bg-surface-hover hover:text-fg focus-within:bg-surface-hover";
const ROW_BUTTON = "flex h-[26px] min-w-0 flex-1 items-center gap-1.5 text-left focus-ring";
const MARKER_SLOT = "w-3 shrink-0 text-center text-micro font-semibold";
const NOTE = "py-1 pr-2 text-caption";

interface TreeView {
  tree: FileTree;
  /** Paths kept by the filter, or null when no filter is active. */
  visible: Set<string> | null;
  rootPath: string;
  onOpenFile: (entry: DirEntryInfo) => void;
  onInsertPath?: (absolutePath: string) => void;
  markers?: FileMarkers;
}

function indent(depth: number, extra = 0): { paddingLeft: number } {
  return { paddingLeft: BASE_INDENT_PX + depth * INDENT_STEP_PX + extra };
}

function hasVisibleDescendant(visible: Set<string>, folder: string): boolean {
  const prefix = `${folder}/`;
  return [...visible].some((path) => path.startsWith(prefix));
}

function FolderRow({ entry, depth, view }: { entry: DirEntryInfo; depth: number; view: TreeView }) {
  const path = entry.relativePath;
  const expanded = view.visible ? hasVisibleDescendant(view.visible, path) : view.tree.isExpanded(path);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const hasChanges = view.markers?.folders.has(path) ?? false;
  return (
    <li role="treeitem" aria-label={hasChanges ? `${entry.name}, contains changes` : entry.name} aria-expanded={expanded}>
      <div className={ROW}>
        <button type="button" onClick={() => view.tree.toggleFolder(path)} title={path} style={indent(depth)} className={ROW_BUTTON}>
          <Chevron size={12} aria-hidden="true" className="shrink-0 text-fg-subtle" />
          {/* The folder icon stays closed, as drawn: the chevron says whether it is open. */}
          <Folder size={14} aria-hidden="true" className="shrink-0 text-fg-muted" />
          <span className="truncate font-mono">{entry.name}</span>
        </button>
        {hasChanges && (
          <span role="img" aria-label="Contains changes" className={`${MARKER_SLOT} text-status-attention`}>
            •
          </span>
        )}
      </div>
      {expanded && (
        <ul role="group">
          <FolderChildren folder={path} depth={depth + 1} view={view} />
        </ul>
      )}
    </li>
  );
}

function FileRow({ entry, depth, view }: { entry: DirEntryInfo; depth: number; view: TreeView }) {
  const { onInsertPath } = view;
  const marker = view.markers?.files.get(entry.relativePath);
  return (
    <li role="treeitem" aria-label={marker ? `${entry.name}, ${MARKER_WORD[marker]}` : entry.name}>
      <div className={ROW}>
        <button
          type="button"
          onClick={() => view.onOpenFile(entry)}
          title={`Open ${entry.relativePath}`}
          // Files line up with folder icons, past the folder chevron and its gap.
          style={indent(depth, FILE_INDENT_PX)}
          className={ROW_BUTTON}
        >
          <File size={14} aria-hidden="true" className="shrink-0 text-fg-subtle" />
          <span className="truncate font-mono">{entry.name}</span>
          {marker && <span className="sr-only">{MARKER_WORD[marker]}</span>}
        </button>
        {onInsertPath && (
          // Shown on the row's hover or focus, before the marker, as drawn.
          <button
            type="button"
            aria-label={`Add ${entry.name} to prompt`}
            title="Add to prompt"
            onClick={() => onInsertPath(joinWorkspacePath(view.rootPath, entry.relativePath))}
            // Out of the layout until then, so the hidden pill does not cut every file name short.
            className="hidden h-5 shrink-0 items-center gap-1 rounded border border-border-strong px-1.5 font-sans text-caption text-fg group-hover:flex group-focus-within:flex focus-ring"
          >
            <Plus size={10} aria-hidden="true" />
            Add to prompt
          </button>
        )}
        {marker && (
          <span aria-hidden="true" className={`${MARKER_SLOT} ${MARKER_COLOR[marker]}`}>
            {MARKER_LETTER[marker]}
          </span>
        )}
      </div>
    </li>
  );
}

function FolderChildren({ folder, depth, view }: { folder: string; depth: number; view: TreeView }) {
  const { tree, visible } = view;
  const error = tree.errors[folder];
  const entries = tree.children[folder];

  if (error) {
    return (
      <li role="none">
        <p role="alert" style={indent(depth + 1)} className={`${NOTE} text-danger`}>
          {error}
        </p>
      </li>
    );
  }
  if (!entries) {
    return tree.isLoading(folder) && !visible ? (
      <li role="none" style={indent(depth + 1)} className={`${NOTE} text-fg-subtle`}>
        Loading…
      </li>
    ) : null;
  }
  if (entries.length === 0 && !visible) {
    return (
      <li role="none" style={indent(depth + 1)} className={`${NOTE} text-fg-subtle`}>
        Empty folder
      </li>
    );
  }

  const shown = visible ? entries.filter((entry) => visible.has(entry.relativePath)) : entries;
  return (
    <>
      {shown.map((entry) =>
        entry.isDir ? (
          <FolderRow key={entry.relativePath} entry={entry} depth={depth} view={view} />
        ) : (
          <FileRow key={entry.relativePath} entry={entry} depth={depth} view={view} />
        )
      )}
    </>
  );
}

interface PanelHeaderProps {
  rootName: string;
  rootPath: string;
  query: string;
  onQueryChange: (query: string) => void;
  onRefresh: () => void;
  onRevealRoot?: () => void;
  onClose?: () => void;
}

function PanelHeader({ rootName, rootPath, query, onQueryChange, onRefresh, onRevealRoot, onClose }: PanelHeaderProps) {
  return (
    <div className="flex shrink-0 flex-col gap-2.5 pt-3 pr-3 pb-2 pl-4">
      <div className="flex items-center gap-1.5">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui font-semibold text-fg">{rootName}</span>
          <span title={rootPath} className="truncate font-mono text-caption text-fg-subtle">
            {rootPath}
          </span>
        </span>
        <IconButton label="Refresh files" title="Refresh" size="row" onClick={onRefresh}>
          <RefreshCw size={14} aria-hidden="true" />
        </IconButton>
        {onRevealRoot && (
          <IconButton label="Reveal in Finder" title="Reveal in Finder" size="row" onClick={onRevealRoot}>
            <ExternalLink size={14} aria-hidden="true" />
          </IconButton>
        )}
        {onClose && (
          <IconButton label="Close files panel" title="Close" size="row" onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </IconButton>
        )}
      </div>
      <label className="flex h-[30px] items-center gap-2 rounded-lg border border-border-strong bg-surface-2 px-2.5 text-fg-subtle focus-ring-within">
        <Search size={14} aria-hidden="true" className="shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Filter files"
          aria-label="Filter files"
          className="min-w-0 flex-1 bg-transparent text-ui-sm text-fg placeholder-fg-subtle outline-none"
        />
      </label>
    </div>
  );
}

/** Right-hand panel with a lazily loaded tree of the workspace folder. */
export function FilesPanel({
  rootPath,
  rootName,
  onClose,
  onInsertPath,
  onRevealRoot,
  markers,
  viewedFile = null,
  onViewFile,
  onCloseFile,
  version = 0,
  onInsertText,
  filesPrefix = "",
}: FilesPanelProps) {
  const tree = useFileTree(rootPath);
  const [query, setQuery] = useState("");
  const [openError, setOpenError] = useState<string | null>(null);
  const visible = useMemo(() => filterVisiblePaths(tree.children, query), [tree.children, query]);

  const handleOpenFile = (entry: DirEntryInfo) => {
    // With the viewer wired (the inspector), a click reads the file here; else it opens in its app.
    if (onViewFile) {
      onViewFile(entry.relativePath);
      return;
    }
    setOpenError(null);
    openWorkspacePath(rootPath, entry.relativePath).catch((error: unknown) => {
      setOpenError(`Couldn't open ${entry.name}: ${errorMessage(error)}`);
    });
  };

  const view: TreeView = { tree, visible, rootPath, onOpenFile: handleOpenFile, onInsertPath, markers };

  // The viewer takes the header's and the tree's place; the tree's state (open folders, filter) waits for "← Files".
  if (viewedFile) {
    return (
      <aside aria-label="Files panel" className="flex h-full min-h-0 flex-1 flex-col bg-surface-1 text-ui-sm text-fg-secondary">
        <FileViewer
          rootPath={rootPath}
          relativePath={viewedFile}
          marker={markers?.files.get(viewedFile)}
          version={version}
          onBack={() => onCloseFile?.()}
          onInsertPath={(path) => onInsertPath?.(path)}
          onInsertText={onInsertText}
          filesPrefix={filesPrefix}
        />
      </aside>
    );
  }

  return (
    <aside
      aria-label="Files panel"
      className="flex h-full min-h-0 flex-1 flex-col bg-surface-1 text-ui-sm text-fg-secondary select-none"
    >
      <PanelHeader
        rootName={rootName}
        rootPath={rootPath}
        query={query}
        onQueryChange={setQuery}
        onRefresh={tree.refresh}
        onRevealRoot={onRevealRoot}
        onClose={onClose}
      />
      {openError && (
        <p role="alert" className="border-b border-border px-3 py-1.5 text-caption text-danger">
          {openError}
        </p>
      )}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        <ul role="tree" aria-label={`Files in ${rootName}`} className="font-mono">
          <FolderChildren folder={ROOT_FOLDER} depth={0} view={view} />
        </ul>
        {visible?.size === 0 && (
          <p className="px-2 py-1 text-caption text-fg-subtle">No loaded files match “{query.trim()}”.</p>
        )}
      </div>
    </aside>
  );
}
