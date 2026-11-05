import { useMemo, useState } from "react";
import {
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  FolderSearch,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
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
}

const MARKER_COLOR: Record<FileMarker, string> = {
  modified: "text-status-attention",
  added: "text-status-running",
};

const BASE_INDENT_PX = 8;
const INDENT_STEP_PX = 12;
const HEADER_BUTTON =
  "rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg-secondary focus-ring";
const ROW =
  "group flex items-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg-secondary";
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

function indent(depth: number): { paddingLeft: number } {
  return { paddingLeft: BASE_INDENT_PX + depth * INDENT_STEP_PX };
}

function hasVisibleDescendant(visible: Set<string>, folder: string): boolean {
  const prefix = `${folder}/`;
  return [...visible].some((path) => path.startsWith(prefix));
}

function FolderRow({ entry, depth, view }: { entry: DirEntryInfo; depth: number; view: TreeView }) {
  const path = entry.relativePath;
  const expanded = view.visible ? hasVisibleDescendant(view.visible, path) : view.tree.isExpanded(path);
  const Icon = expanded ? FolderOpen : Folder;
  const hasChanges = view.markers?.folders.has(path) ?? false;
  return (
    <li role="treeitem" aria-label={hasChanges ? `${entry.name}, contains changes` : entry.name} aria-expanded={expanded}>
      <div className={ROW}>
        <button
          type="button"
          onClick={() => view.tree.toggleFolder(path)}
          title={path}
          style={indent(depth)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-2 text-left focus-ring"
        >
          <ChevronRight
            size={12}
            aria-hidden="true"
            className={`shrink-0 text-fg-muted transition-transform ${expanded ? "rotate-90" : ""}`}
          />
          <Icon size={13} aria-hidden="true" className="shrink-0 text-fg-muted" />
          <span className="truncate font-mono">{entry.name}</span>
        </button>
        {hasChanges && (
          <span role="img" aria-label="Contains changes" className="mr-2.5 size-1.5 shrink-0 rounded-full bg-status-attention" />
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
          // Files line up with folder names, past the folder chevron.
          style={indent(depth + 1)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-2 text-left focus-ring"
        >
          <File size={13} aria-hidden="true" className="shrink-0 text-fg-muted" />
          <span className="truncate font-mono">{entry.name}</span>
          {marker && (
            <>
              <span aria-hidden="true" className={`ml-auto shrink-0 font-mono text-caption ${MARKER_COLOR[marker]}`}>
                {MARKER_LETTER[marker]}
              </span>
              <span className="sr-only">{MARKER_WORD[marker]}</span>
            </>
          )}
        </button>
        {onInsertPath && (
          <button
            type="button"
            aria-label={`Add ${entry.name} to prompt`}
            title="Add to prompt"
            onClick={() => onInsertPath(joinWorkspacePath(view.rootPath, entry.relativePath))}
            className="mr-1 rounded p-1 text-fg-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-fg focus-ring"
          >
            <Plus size={12} aria-hidden="true" />
          </button>
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
    <div className="flex flex-col gap-2 border-b border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-caption font-semibold uppercase tracking-wider text-fg-subtle">Files</h2>
          <span title={rootPath} className="truncate font-mono text-caption text-fg-muted">
            {rootName}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" onClick={onRefresh} aria-label="Refresh files" title="Refresh" className={HEADER_BUTTON}>
            <RefreshCw size={13} aria-hidden="true" />
          </button>
          {onRevealRoot && (
            <button type="button" onClick={onRevealRoot} aria-label="Reveal in Finder" title="Reveal in Finder" className={HEADER_BUTTON}>
              <FolderSearch size={13} aria-hidden="true" />
            </button>
          )}
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close files panel" title="Close" className={HEADER_BUTTON}>
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <div className="relative">
        <Search
          size={13}
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Filter files"
          aria-label="Filter files"
          className="w-full rounded-md border border-border-strong bg-surface-2 py-1.5 pl-8 pr-3 text-ui-sm text-fg-secondary placeholder-fg-subtle focus-ring"
        />
      </div>
    </div>
  );
}

/** Right-hand panel with a lazily loaded tree of the workspace folder. */
export function FilesPanel({ rootPath, rootName, onClose, onInsertPath, onRevealRoot, markers }: FilesPanelProps) {
  const tree = useFileTree(rootPath);
  const [query, setQuery] = useState("");
  const [openError, setOpenError] = useState<string | null>(null);
  const visible = useMemo(() => filterVisiblePaths(tree.children, query), [tree.children, query]);

  const handleOpenFile = (entry: DirEntryInfo) => {
    setOpenError(null);
    openWorkspacePath(rootPath, entry.relativePath).catch((error: unknown) => {
      setOpenError(`Couldn't open ${entry.name}: ${errorMessage(error)}`);
    });
  };

  const view: TreeView = { tree, visible, rootPath, onOpenFile: handleOpenFile, onInsertPath, markers };

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
      <div className="flex-1 overflow-y-auto p-1.5">
        <ul role="tree" aria-label={`Files in ${rootName}`}>
          <FolderChildren folder={ROOT_FOLDER} depth={0} view={view} />
        </ul>
        {visible?.size === 0 && (
          <p className="px-2 py-1 text-caption text-fg-subtle">No loaded files match “{query.trim()}”.</p>
        )}
      </div>
    </aside>
  );
}
