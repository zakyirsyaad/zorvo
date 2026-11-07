import type { ReactNode } from "react";
import { AgentMultiPicker, type AgentMultiPickerProps } from "./AgentMultiPicker";
import { BranchPicker } from "./BranchPicker";
import { FolderPicker, type FolderControl } from "./FolderPicker";

/** The draft chips' menus, opened one at a time like the composer's own. */
export type DraftChipName = "folder" | "branch" | "agent";

export interface DraftChipsProps {
  folder?: FolderControl;
  /** In a repository: the agent chip with a checkbox to tick several. */
  agents?: Omit<AgentMultiPickerProps, "isOpen" | "onToggle" | "onClose">;
  /** Outside a repository: the agent chip, drawn by the composer (it is an `OptionDropdown`). */
  agentChip?: ReactNode;
  isOpen: (name: DraftChipName) => boolean;
  onToggle: (name: DraftChipName) => void;
  onClose: (name: DraftChipName) => void;
  /** Chips after the agent's: the Private chip and its model menu. */
  children?: ReactNode;
}

/** Above the draft's composer: where the session starts (folder, branch) and which agents run it. */
export function DraftChips({ folder, agents, agentChip, isOpen, onToggle, onClose, children }: DraftChipsProps) {
  const hasBranch = Boolean(folder?.branch || folder?.worktree);
  return (
    <div className="mb-4 flex w-full flex-wrap items-center gap-2">
      {folder && (
        <FolderPicker
          folders={folder.folders}
          selectedPath={folder.selectedPath}
          onSelect={folder.onSelect}
          onOpenFolder={folder.onOpenFolder}
          isOpen={isOpen("folder")}
          onToggle={() => onToggle("folder")}
          onClose={() => onClose("folder")}
        />
      )}
      {folder && hasBranch && (
        <BranchPicker
          branch={folder.branch}
          worktree={folder.worktree}
          isOpen={isOpen("branch")}
          onToggle={() => onToggle("branch")}
          onClose={() => onClose("branch")}
        />
      )}
      {agents ? (
        <AgentMultiPicker
          {...agents}
          isOpen={isOpen("agent")}
          onToggle={() => onToggle("agent")}
          onClose={() => onClose("agent")}
          onPick={(agentId) => {
            agents.onPick(agentId);
            onClose("agent");
          }}
        />
      ) : (
        agentChip
      )}
      {children}
    </div>
  );
}
