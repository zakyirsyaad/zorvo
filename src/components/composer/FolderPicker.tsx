import { useState } from "react";
import { ChevronDown, Folder, FolderPlus } from "lucide-react";
import { Popover, PopoverHeader, PopoverList, PopoverOption } from "../ui/Popover";
import { COMPOSER_CHIP } from "./chip-style";
import type { Workspace } from "../../types";

/** The folder a new session starts in, chosen before it starts. */
export interface FolderControl {
  folders: readonly Workspace[];
  selectedPath: string | undefined;
  onSelect: (path: string) => void;
  /** Opens the native folder dialog; the entry is hidden when absent. */
  onOpenFolder?: () => void;
  /** Whether the session gets its own worktree; offered only for a git repository. */
  worktree?: {
    isOn: boolean;
    onChange: (isOn: boolean) => void;
    /** Why the switch cannot be turned off (several agents run, each in its own worktree); it stays on and is disabled. */
    lockedReason?: string;
  };
  /** The branch the session starts on; offered only for a git repository. */
  branch?: BranchControl;
}

/** The branch chip: the folder's own branch, or a worktree's starting branch while New worktree is on. */
export interface BranchControl {
  current: string;
  /** The local branches, most recently committed first; null until they are loaded. */
  branches: readonly string[] | null;
  /** Called when the branch list opens, to load it. */
  onOpen: () => void;
  onPick: (branch: string) => void;
}

export interface FolderPickerProps {
  folders: FolderControl["folders"];
  selectedPath: FolderControl["selectedPath"];
  onSelect: FolderControl["onSelect"];
  onOpenFolder?: FolderControl["onOpenFolder"];
  isOpen: boolean;
  onToggle: () => void;
  /** Closes the list on Escape or a click outside, without toggling it. */
  onClose: () => void;
}

/** The draft's folder chip, with a searchable list of recent folders. */
export function FolderPicker({ folders, selectedPath, onSelect, onOpenFolder, isOpen, onToggle, onClose }: FolderPickerProps) {
  const [query, setQuery] = useState("");
  // However the list closed (a pick, Escape, a click elsewhere), it reopens unfiltered.
  if (!isOpen && query !== "") setQuery("");
  const selected = folders.find((folder) => folder.path === selectedPath);
  const needle = query.trim().toLowerCase();
  const shown = folders.filter(
    (folder) => needle === "" || folder.name.toLowerCase().includes(needle) || folder.path.toLowerCase().includes(needle),
  );
  const pick = (path: string) => {
    onSelect(path);
    onClose();
  };

  return (
    <Popover
      isOpen={isOpen}
      onClose={onClose}
      label="Choose a folder"
      role="dialog"
      side="top"
      align="start"
      className="w-64"
      trigger={
        <button
          type="button"
          aria-label={`Folder: ${selected?.name ?? "none"}`}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={onToggle}
          title={selected?.path}
          className={COMPOSER_CHIP}
        >
          <Folder size={12} aria-hidden="true" className="shrink-0 text-fg-muted" />
          <span className="max-w-[160px] truncate">{selected?.name ?? "Choose folder"}</span>
          <ChevronDown size={11} aria-hidden="true" className="shrink-0 text-fg-subtle" />
        </button>
      }
    >
      <input
        autoFocus
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && shown[0]) pick(shown[0].path);
        }}
        placeholder="Search folders"
        aria-label="Search folders"
        className="focus-ring mb-1 w-full rounded border border-border bg-surface-2 px-2 py-1 text-ui-sm text-fg placeholder-fg-subtle outline-none"
      />
      <PopoverHeader>Recent folders</PopoverHeader>
      <div className="max-h-64 overflow-y-auto">
        {shown.length === 0 && <p className="px-2 py-1 text-ui-sm text-fg-muted">No folder matches.</p>}
        <PopoverList label="Recent folders">
          {shown.map((folder) => (
            <span key={folder.path} title={folder.path} className="block">
              <PopoverOption selected={folder.path === selectedPath} onSelect={() => pick(folder.path)}>
                {folder.name}
              </PopoverOption>
            </span>
          ))}
        </PopoverList>
      </div>
      {onOpenFolder && (
        <div className="mt-1 border-t border-border pt-1">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenFolder();
            }}
            className="focus-ring flex min-h-7.5 w-full items-center gap-2 rounded px-2 py-1 text-left text-ui text-fg transition-colors hover:bg-surface-hover"
          >
            <FolderPlus size={13} aria-hidden="true" className="text-fg-muted" />
            Open another folder…
          </button>
        </div>
      )}
    </Popover>
  );
}
