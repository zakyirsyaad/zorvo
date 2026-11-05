import { useEffect, useRef, useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import type { Session } from "../../types";
import { Popover, PopoverOption } from "../ui/Popover";
import type { SessionListContext } from "./SessionList";

/** How long Delete? waits in the row for its confirming press. */
export const CONFIRM_DELETE_MS = 4000;

const TRIGGER =
  "flex size-6 items-center justify-center rounded-md text-fg-secondary transition-colors hover:text-fg aria-expanded:bg-surface-hover focus-ring";
/** The row's "Delete?" pill: 24px, danger on its surface, 12px at 500, radius 4. */
const CONFIRM =
  "focus-ring flex h-6 shrink-0 items-center rounded bg-danger-surface px-2 text-ui-sm font-medium text-danger";

export interface SessionMenuProps {
  session: Session;
  /** What the menu calls the session: its name, or its agent in a compare run. */
  label: string;
  isBusy: boolean;
  /** A run member's row names the agent, so a rename would not show. */
  isInRun: boolean;
  context: SessionListContext;
  onRename: () => void;
  /** Whether the menu is open, when the row holds it (a right-click opens it); else the menu does. */
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** An option's icon and words. */
function Item({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className="flex shrink-0">
        {icon}
      </span>
      {children}
    </span>
  );
}

/**
 * A session's ⋯ menu: rename, pin, archive and delete. Deleting erases the conversation for
 * good, so Delete closes the menu and asks "Delete?" in the row, focused: Return deletes,
 * Escape gives up and puts focus back on ⋯, and it turns back by itself after a while.
 */
export function SessionMenu({
  session,
  label,
  isBusy,
  isInRun,
  context,
  onRename,
  isOpen: heldOpen,
  onOpenChange,
}: SessionMenuProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const isOpen = heldOpen ?? ownOpen;
  const setIsOpen = (open: boolean) => (onOpenChange ? onOpenChange(open) : setOwnOpen(open));
  const [isConfirming, setIsConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Set when the pill had focus as it went away, so focus goes back to ⋯ rather than the page.
  const shouldRefocusRef = useRef(false);
  // A confirm left open must never delete a session whose agent has started working.
  const [wasBusy, setWasBusy] = useState(isBusy);
  if (wasBusy !== isBusy) {
    setWasBusy(isBusy);
    if (isBusy) setIsConfirming(false);
  }

  useEffect(() => {
    if (!isConfirming) return;
    const timer = setTimeout(() => {
      shouldRefocusRef.current = document.activeElement === confirmRef.current;
      setIsConfirming(false);
    }, CONFIRM_DELETE_MS);
    return () => clearTimeout(timer);
  }, [isConfirming]);

  useEffect(() => {
    if (isConfirming || !shouldRefocusRef.current) return;
    shouldRefocusRef.current = false;
    triggerRef.current?.focus();
  }, [isConfirming]);

  const { onPinSession, onRenameSession, onDeleteSession } = context;
  // Archiving and deleting end the agent, so both wait until it is not working.
  const onArchiveSession = isBusy ? undefined : context.onArchiveSession;
  const deleteSession = isBusy ? undefined : onDeleteSession;
  const canRename = Boolean(onRenameSession) && !isInRun;
  const isArchived = Boolean(session.archivedAt);
  if (!canRename && !onPinSession && !onArchiveSession && !deleteSession) return null;

  const pick = (action: () => void) => () => {
    setIsOpen(false);
    action();
  };

  if (isConfirming && deleteSession) {
    return (
      <button
        ref={confirmRef}
        type="button"
        autoFocus
        aria-label="Confirm delete"
        title="Delete this session and its conversation for good"
        onClick={() => {
          setIsConfirming(false);
          deleteSession(session.id);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          shouldRefocusRef.current = true;
          setIsConfirming(false);
        }}
        onBlur={(event) => {
          // A press elsewhere in the window gives up too; focus is already where the user put it.
          if (event.relatedTarget) setIsConfirming(false);
        }}
        className={CONFIRM}
      >
        Delete?
      </button>
    );
  }

  return (
    <Popover
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      label={`Actions for ${label}`}
      align="end"
      className="w-44"
      trigger={
        <button
          ref={triggerRef}
          type="button"
          aria-label={`More actions for ${label}`}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={() => setIsOpen(!isOpen)}
          className={TRIGGER}
        >
          <MoreHorizontal size={12} />
        </button>
      }
    >
      {canRename && (
        <PopoverOption onSelect={pick(onRename)}>
          <Item icon={<Pencil size={12} />}>Rename</Item>
        </PopoverOption>
      )}
      {onPinSession && !isArchived && (
        <PopoverOption onSelect={pick(() => onPinSession(session.id, !session.pinned))}>
          <Item icon={session.pinned ? <PinOff size={12} /> : <Pin size={12} />}>{session.pinned ? "Unpin" : "Pin"}</Item>
        </PopoverOption>
      )}
      {onArchiveSession && (
        <PopoverOption onSelect={pick(() => onArchiveSession(session.id, !isArchived))}>
          <Item icon={isArchived ? <ArchiveRestore size={12} /> : <Archive size={12} />}>
            {isArchived ? "Unarchive" : "Archive"}
          </Item>
        </PopoverOption>
      )}
      {deleteSession && (
        <PopoverOption onSelect={pick(() => setIsConfirming(true))}>
          <Item icon={<Trash2 size={12} />}>Delete</Item>
        </PopoverOption>
      )}
    </Popover>
  );
}
