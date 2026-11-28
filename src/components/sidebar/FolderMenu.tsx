import { useEffect, useRef, useState } from "react";
import { Archive, ChevronDown, ChevronRight, Copy, FolderOpen, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { Popover, PopoverOption } from "../ui/Popover";

const CONFIRM_MS = 4000;

export interface FolderMenuProps {
  folderName: string;
  folderPath?: string;
  isFolded: boolean;
  /** Opens or closes the menu from outside (e.g. right-click on the folder header). */
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onNewSession?: () => void;
  onReveal?: () => void;
  onCopyPath?: () => void;
  onToggle?: () => void;
  onArchiveAll?: () => void;
  /** Permanently removes the project from Zorvo and deletes its sessions (files on disk stay). */
  onRemove?: () => void;
}

/** Holds an inline confirmation open for a few seconds and resets on Escape or timeout. */
function useConfirm(ms: number) {
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    setConfirming(false);
    if (timer.current) clearTimeout(timer.current);
  };
  const arm = () => {
    setConfirming(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setConfirming(false), ms);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { confirming, arm, cancel };
}

/** Per-project action menu, opened from its hover ⋯ button or right-click. */
export function FolderMenu({
  folderName,
  isFolded,
  isOpen,
  onOpenChange,
  onNewSession,
  onReveal,
  onCopyPath,
  onToggle,
  onArchiveAll,
  onRemove,
}: FolderMenuProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (isOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const confirm = useConfirm(CONFIRM_MS);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirm.confirming) confirmRef.current?.focus();
  }, [confirm.confirming]);

  if (confirm.confirming && onRemove) {
    return (
      <button
        ref={confirmRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          confirm.cancel();
          onRemove();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            confirm.cancel();
          }
        }}
        aria-label={`Confirm removing ${folderName}`}
        data-confirm=""
        className="focus-ring shrink-0 rounded bg-danger-surface px-1.5 py-0.5 text-caption font-medium text-danger"
      >
        Remove?
      </button>
    );
  }

  const hasAny = Boolean(onNewSession || onReveal || onCopyPath || onToggle || onArchiveAll || onRemove);
  if (!hasAny) return null;

  const pick = (fn?: () => void) => () => {
    setOpen(false);
    fn?.();
  };

  return (
    <Popover
      isOpen={open}
      onClose={() => setOpen(false)}
      align="end"
      className="w-48"
      label={`Actions for ${folderName}`}
      trigger={
        <IconButton
          label={`Actions for ${folderName}`}
          size="xs"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
        >
          <MoreHorizontal size={13} />
        </IconButton>
      }
    >
      {onNewSession && (
        <PopoverOption onSelect={pick(onNewSession)}>
          <span className="inline-flex items-center gap-2">
            <Plus size={12} aria-hidden="true" className="text-fg-subtle" />
            New session
          </span>
        </PopoverOption>
      )}
      {onReveal && (
        <PopoverOption onSelect={pick(onReveal)}>
          <span className="inline-flex items-center gap-2">
            <FolderOpen size={12} aria-hidden="true" className="text-fg-subtle" />
            Reveal in Finder
          </span>
        </PopoverOption>
      )}
      {onCopyPath && (
        <PopoverOption onSelect={pick(onCopyPath)}>
          <span className="inline-flex items-center gap-2">
            <Copy size={12} aria-hidden="true" className="text-fg-subtle" />
            Copy path
          </span>
        </PopoverOption>
      )}
      {onToggle && (
        <PopoverOption onSelect={pick(onToggle)}>
          <span className="inline-flex items-center gap-2">
            {isFolded ? (
              <ChevronRight size={12} aria-hidden="true" className="text-fg-subtle" />
            ) : (
              <ChevronDown size={12} aria-hidden="true" className="text-fg-subtle" />
            )}
            {isFolded ? "Expand" : "Collapse"}
          </span>
        </PopoverOption>
      )}
      {onArchiveAll && (
        <PopoverOption onSelect={pick(onArchiveAll)}>
          <span className="inline-flex items-center gap-2">
            <Archive size={12} aria-hidden="true" className="text-fg-subtle" />
            Archive all sessions
          </span>
        </PopoverOption>
      )}
      {onRemove && (
        <>
          <div role="separator" className="my-1 border-t border-border" />
          <PopoverOption
            onSelect={() => {
              setOpen(false);
              confirm.arm();
            }}
          >
            <span className="inline-flex items-center gap-2 text-danger">
              <Trash2 size={12} aria-hidden="true" />
              Remove project
            </span>
          </PopoverOption>
        </>
      )}
    </Popover>
  );
}
