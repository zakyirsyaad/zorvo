import { useState } from "react";
import { ChevronDown, GitBranch } from "lucide-react";
import { Popover, PopoverHeader, PopoverList, PopoverOption } from "../ui/Popover";
import { COMPOSER_CHIP } from "./chip-style";
import type { BranchControl, FolderControl } from "./FolderPicker";

export interface BranchPickerProps {
  branch?: BranchControl;
  worktree?: FolderControl["worktree"];
  isOpen: boolean;
  onToggle: () => void;
  /** Closes the list on Escape or a click outside, without toggling it. */
  onClose: () => void;
}

/** The draft's branch chip: the local branches to start on, and whether to start in a new worktree. */
export function BranchPicker({ branch, worktree, isOpen, onToggle, onClose }: BranchPickerProps) {
  const [query, setQuery] = useState("");
  if (!isOpen && query !== "") setQuery("");
  const current = branch?.current ?? "Branch";
  const isWorktree = worktree?.isOn ?? false;
  const needle = query.trim().toLowerCase();
  const shown = (branch?.branches ?? []).filter((name) => needle === "" || name.toLowerCase().includes(needle));
  const pick = (name: string) => {
    branch?.onPick(name);
    onClose();
  };

  return (
    <Popover
      isOpen={isOpen}
      onClose={onClose}
      label="Choose a branch"
      role="dialog"
      side="top"
      align="start"
      className="w-72"
      trigger={
        <button
          type="button"
          aria-label={`Branch: ${current}${isWorktree ? ", in a new worktree" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={() => {
            if (!isOpen) branch?.onOpen();
            onToggle();
          }}
          title={current}
          className={COMPOSER_CHIP}
        >
          <GitBranch size={12} aria-hidden="true" className={`shrink-0 ${isWorktree ? "text-fg" : "text-fg-muted"}`} />
          <span className="min-w-0 truncate">{current}</span>
          {/* The space reads "main · new worktree" when copied or read as text; the gap draws it. */}
          {isWorktree && <span className="shrink-0 text-fg-muted">{" "}· new worktree</span>}
          <ChevronDown size={11} aria-hidden="true" className="shrink-0 text-fg-subtle" />
        </button>
      }
    >
      {branch && (
        <>
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && shown[0]) pick(shown[0]);
            }}
            placeholder="Search branches"
            aria-label="Search branches"
            className="focus-ring mb-1 w-full rounded border border-border bg-surface-2 px-2 py-1 text-ui-sm text-fg placeholder-fg-subtle outline-none"
          />
          <PopoverHeader>Local branches</PopoverHeader>
          <div className="max-h-56 overflow-y-auto">
            {branch.branches === null && <p className="px-2 py-1 text-ui-sm text-fg-muted">Loading branches…</p>}
            {branch.branches !== null && shown.length === 0 && (
              <p className="px-2 py-1 text-ui-sm text-fg-muted">No branch matches.</p>
            )}
            <PopoverList label="Local branches">
              {shown.map((name) => (
                <span key={name} title={name} className="block">
                  <PopoverOption selected={name === branch.current} onSelect={() => pick(name)}>
                    {name}
                  </PopoverOption>
                </span>
              ))}
            </PopoverList>
          </div>
        </>
      )}
      {worktree && <WorktreeSwitch worktree={worktree} from={current} />}
    </Popover>
  );
}

/** "New worktree": the session works on its own copy, so the folder's checkout is left alone. */
function WorktreeSwitch({ worktree, from }: { worktree: NonNullable<FolderControl["worktree"]>; from: string }) {
  const isLocked = worktree.lockedReason !== undefined;
  return (
    <div className="mt-1 border-t border-border px-2 pb-1 pt-2">
      <button
        type="button"
        role="switch"
        aria-checked={worktree.isOn}
        aria-label="New worktree"
        disabled={isLocked}
        onClick={() => worktree.onChange(!worktree.isOn)}
        className="focus-ring flex w-full items-center justify-between gap-2 rounded text-left text-ui text-fg disabled:cursor-default"
      >
        <span>New worktree</span>
        <span
          aria-hidden="true"
          className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${worktree.isOn ? "bg-fg" : "bg-border-strong"}`}
        >
          <span
            className={`absolute top-0.5 h-3 w-3 rounded-full transition-transform ${worktree.isOn ? "translate-x-3.5 bg-bg" : "translate-x-0.5 bg-fg"}`}
          />
        </span>
      </button>
      <p className="mt-1 text-caption text-fg-muted">
        {worktree.lockedReason ?? `Works on its own copy from ${from}. Your checkout stays as it is.`}
      </p>
    </div>
  );
}
