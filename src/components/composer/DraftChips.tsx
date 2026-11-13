import { BranchPicker } from "./BranchPicker";
import { FolderPicker, type FolderControl } from "./FolderPicker";

/** The draft's menus, opened one at a time like the composer's own. */
export type DraftChipName = "folder" | "branch" | "agent";

export interface DraftChipsProps {
  folder: FolderControl;
  isOpen: (name: DraftChipName) => boolean;
  onToggle: (name: DraftChipName) => void;
  onClose: (name: DraftChipName) => void;
  /** The row's own layout above the card; `contents` when the chips join the heading's row. */
  className?: string;
}

/** Where the draft's session starts: its folder and, in a repository, its branch. The agents are tiles under the heading. */
export function DraftChips({
  folder,
  isOpen,
  onToggle,
  onClose,
  className = "mb-4 flex w-full flex-wrap items-center gap-2",
}: DraftChipsProps) {
  const hasBranch = Boolean(folder.branch || folder.worktree);
  return (
    <div data-draft-chips="" className={className}>
      <FolderPicker
        folders={folder.folders}
        selectedPath={folder.selectedPath}
        onSelect={folder.onSelect}
        onOpenFolder={folder.onOpenFolder}
        isOpen={isOpen("folder")}
        onToggle={() => onToggle("folder")}
        onClose={() => onClose("folder")}
      />
      {hasBranch && (
        <BranchPicker
          branch={folder.branch}
          worktree={folder.worktree}
          isOpen={isOpen("branch")}
          onToggle={() => onToggle("branch")}
          onClose={() => onClose("branch")}
        />
      )}
    </div>
  );
}
