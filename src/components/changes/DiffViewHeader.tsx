import { useState } from "react";
import { ChevronDown, Maximize2, Minimize2, MoreHorizontal, Search, X } from "lucide-react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Popover, PopoverOption } from "../ui/Popover";
import { formatLineCount, MINUS, targetLabel, type DiffTargetId, type DiffTargets } from "../../lib/diff-stats";

function TargetPicker({ target, targets, options, onSelect }: {
  target: DiffTargetId;
  targets: DiffTargets;
  options: readonly DiffTargetId[];
  onSelect: (target: DiffTargetId) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const label = targetLabel(target, targets);

  // With only HEAD to compare against there is nothing to choose between.
  if (options.length < 2) return <span className="truncate px-2 text-ui font-semibold text-fg">{label}</span>;

  return (
    <Popover
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      label="Diff target"
      role="listbox"
      className="min-w-56"
      wrapperClassName="min-w-0"
      trigger={
        <button
          type="button"
          aria-label={`Diff target: ${label}`}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
          className="flex h-7 max-w-full items-center gap-1.5 rounded-md px-2 text-ui font-semibold text-fg hover:bg-surface-hover cursor-pointer focus-ring"
        >
          <span className="truncate">{label}</span>
          <ChevronDown size={12} aria-hidden="true" className="shrink-0 text-fg-muted" />
        </button>
      }
    >
      {options.map((option) => (
        <PopoverOption
          key={option}
          selected={option === target}
          onSelect={() => {
            onSelect(option);
            setIsOpen(false);
          }}
        >
          {targetLabel(option, targets)}
        </PopoverOption>
      ))}
    </Popover>
  );
}

function MoreMenu({ onCollapseAll, onExpandAll, onRefresh }: {
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onRefresh: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const items = [
    { label: "Collapse all", run: onCollapseAll },
    { label: "Expand all", run: onExpandAll },
    { label: "Refresh", run: onRefresh },
  ];
  return (
    <Popover
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      label="More actions"
      align="end"
      className="min-w-36"
      trigger={
        <IconButton label="More actions" tone="secondary" aria-haspopup="menu" aria-expanded={isOpen} onClick={() => setIsOpen((open) => !open)}>
          <MoreHorizontal size={14} />
        </IconButton>
      }
    >
      {items.map((item) => (
        <PopoverOption
          key={item.label}
          onSelect={() => {
            item.run();
            setIsOpen(false);
          }}
        >
          {item.label}
        </PopoverOption>
      ))}
    </Popover>
  );
}

export interface DiffViewHeaderProps {
  target: DiffTargetId;
  targets: DiffTargets;
  /** The targets on offer, in the order they are listed. */
  options: readonly DiffTargetId[];
  onTargetChange: (target: DiffTargetId) => void;
  isSearching: boolean;
  onToggleSearch: () => void;
  search: string;
  onSearchChange: (search: string) => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onRefresh: () => void;
  isExpanded: boolean;
  /** Shows the Expand/Shrink button; absent when the view always fills the chat area. */
  onToggleExpanded?: () => void;
  onClose: () => void;
  /** How many files changed and the lines added and removed, once the list is read. */
  totals?: { files: number; added: number; removed: number };
}

/** The diff view's title bar: what is compared, plus search, section controls, expand and close. */
export function DiffViewHeader(props: DiffViewHeaderProps) {
  const { isExpanded, isSearching, search } = props;
  return (
    <header className="shrink-0 border-b border-border">
      <div className="flex h-12 items-center gap-2 pr-2.5 pl-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <TargetPicker target={props.target} targets={props.targets} options={props.options} onSelect={props.onTargetChange} />
          {props.totals && (
            <div role="group" aria-label="Diff totals" className="flex shrink-0 items-center gap-2 tabular-nums">
              <span className="text-ui-sm text-fg-muted">
                {formatLineCount(props.totals.files)} {props.totals.files === 1 ? "file" : "files"}
              </span>
              <span className="font-mono text-caption text-status-running">+{formatLineCount(props.totals.added)}</span>
              <span className="font-mono text-caption text-danger">
                {MINUS}
                {formatLineCount(props.totals.removed)}
              </span>
            </div>
          )}
        </div>
        <IconButton label="Search files" tone="secondary" aria-pressed={isSearching} onClick={props.onToggleSearch}>
          <Search size={14} />
        </IconButton>
        <MoreMenu onCollapseAll={props.onCollapseAll} onExpandAll={props.onExpandAll} onRefresh={props.onRefresh} />
        {props.onToggleExpanded && (
          <Button
            variant="outline"
            size="md"
            aria-label={isExpanded ? "Shrink diff view" : "Expand diff view"}
            icon={isExpanded ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
            onClick={props.onToggleExpanded}
          >
            {isExpanded ? "Shrink" : "Expand"}
          </Button>
        )}
        <IconButton label="Close diff view" tone="secondary" onClick={props.onClose}>
          <X size={14} />
        </IconButton>
      </div>
      {isSearching && (
        <div className="px-4 pb-2">
          <input
            type="text"
            autoFocus
            value={search}
            onChange={(e) => props.onSearchChange(e.target.value)}
            placeholder="Filter files"
            aria-label="Filter files"
            className="w-full rounded-md border border-border-strong bg-surface-2 px-2 py-1 text-ui-sm text-fg placeholder:text-fg-subtle focus-ring"
          />
        </div>
      )}
    </header>
  );
}
