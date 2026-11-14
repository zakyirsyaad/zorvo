import { useState } from "react";
import { ChevronDown, GitBranch } from "lucide-react";
import { Popover, PopoverHeader, PopoverList, PopoverOption, PopoverSearch } from "../ui/Popover";
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
      side="bottom"
      align="start"
      className="w-90"
      wrapperClassName="min-w-0 max-w-full"
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
          <GitBranch size={12} aria-hidden="true" className="shrink-0 text-fg-muted" />
          <span className="min-w-0 truncate font-mono text-caption">{current}</span>
          {/* The space reads "main · new worktree" when copied or read as text; the gap draws it. */}
          {isWorktree && <span className="shrink-0 text-fg-subtle">{" "}· new worktree</span>}
          <ChevronDown size={12} aria-hidden="true" className="shrink-0 text-fg-muted" />
        </button>
      }
    >
      {branch && (
        <>
          <PopoverSearch
            autoFocus
            value={query}
            onChange={setQuery}
            onKeyDown={(e) => {
              // Only with something typed: a pick here can switch the folder's own checkout.
              if (e.key === "Enter" && needle !== "" && shown[0]) pick(shown[0]);
            }}
            placeholder="Search branches"
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
                  <PopoverOption
                    selected={name === branch.current}
                    onSelect={() => pick(name)}
                    trailing={name === branch.checkedOut ? "checked out" : undefined}
                  >
                    <span className="font-mono text-ui-sm">{name}</span>
                  </PopoverOption>
                </span>
              ))}
            </PopoverList>
          </div>
        </>
      )}
      {worktree && <WorktreeSwitch worktree={worktree} from={current} hasListAbove={Boolean(branch)} />}
    </Popover>
  );
}

/**
 * "New worktree": the session works on its own copy, so the folder's checkout is left alone. The switch sits on
 * the left with its label over what it does, as the canvas draws it.
 */
function WorktreeSwitch({
  worktree,
  from,
  hasListAbove,
}: {
  worktree: NonNullable<FolderControl["worktree"]>;
  from: string;
  hasListAbove: boolean;
}) {
  const isLocked = worktree.lockedReason !== undefined;
  return (
    <>
      {hasListAbove && <div aria-hidden="true" className="my-1.5 h-px bg-border" />}
      <button
        type="button"
        role="switch"
        aria-checked={worktree.isOn}
        aria-label="New worktree"
        disabled={isLocked}
        onClick={() => worktree.onChange(!worktree.isOn)}
        className="focus-ring flex w-full items-start gap-2.5 rounded px-2 py-1.5 text-left text-ui text-fg disabled:cursor-default"
      >
        <span
          aria-hidden="true"
          className={`relative mt-px h-4 w-7 shrink-0 rounded-full transition-colors ${worktree.isOn ? "bg-fg" : "bg-border-strong"}`}
        >
          <span
            className={`absolute left-0 top-0.5 h-3 w-3 rounded-full transition-transform ${worktree.isOn ? "translate-x-3.5 bg-surface-3" : "translate-x-0.5 bg-fg"}`}
          />
        </span>
        <span className="flex min-w-0 flex-col">
          <span>New worktree</span>
          <span className="text-caption text-fg-subtle">
            {worktree.lockedReason ?? `Works on its own copy from ${from}. Your checkout stays as it is.`}
          </span>
        </span>
      </button>
    </>
  );
}
