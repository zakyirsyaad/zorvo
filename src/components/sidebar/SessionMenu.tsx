import { useEffect, useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import type { Session } from "../../types";
import { Popover, PopoverOption } from "../ui/Popover";
import type { SessionListContext } from "./SessionList";

/** How long Delete waits for its confirming second click. */
export const CONFIRM_DELETE_MS = 4000;

const TRIGGER =
  "flex size-6 items-center justify-center rounded-md text-fg-secondary transition-colors hover:text-fg aria-expanded:bg-surface-hover focus-ring";
const CONFIRM =
  "focus-ring flex min-h-7.5 w-full items-center rounded bg-danger-surface px-2 py-1 text-left text-ui font-medium text-danger";

export interface SessionMenuProps {
  session: Session;
  /** What the menu calls the session: its name, or its agent in a compare run. */
  label: string;
  isBusy: boolean;
  /** A run member's row names the agent, so a rename would not show. */
  isInRun: boolean;
  context: SessionListContext;
  onRename: () => void;
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
 * A session's ⋯ menu: rename, pin, archive and delete. Deleting erases the
 * conversation for good, so Delete turns into "Delete?" first and turns back by itself.
 */
export function SessionMenu({ session, label, isBusy, isInRun, context, onRename }: SessionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  // A confirm left open must never delete a session whose agent has started working.
  const [wasBusy, setWasBusy] = useState(isBusy);
  if (wasBusy !== isBusy) {
    setWasBusy(isBusy);
    if (isBusy) setIsConfirming(false);
  }

  useEffect(() => {
    if (!isConfirming) return;
    const timer = setTimeout(() => setIsConfirming(false), CONFIRM_DELETE_MS);
    return () => clearTimeout(timer);
  }, [isConfirming]);

  const { onPinSession, onRenameSession, onDeleteSession } = context;
  // Archiving and deleting end the agent, so both wait until it is not working.
  const onArchiveSession = isBusy ? undefined : context.onArchiveSession;
  const deleteSession = isBusy ? undefined : onDeleteSession;
  const canRename = Boolean(onRenameSession) && !isInRun;
  const isArchived = Boolean(session.archivedAt);
  if (!canRename && !onPinSession && !onArchiveSession && !deleteSession) return null;

  const close = () => {
    setIsOpen(false);
    setIsConfirming(false);
  };
  const pick = (action: () => void) => () => {
    close();
    action();
  };

  return (
    <Popover
      isOpen={isOpen}
      onClose={close}
      label={`Actions for ${label}`}
      align="end"
      className="w-44"
      trigger={
        <button
          type="button"
          aria-label={`More actions for ${label}`}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={() => (isOpen ? close() : setIsOpen(true))}
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
      {deleteSession &&
        (isConfirming ? (
          <button
            type="button"
            role="menuitem"
            autoFocus
            aria-label="Confirm delete"
            title="Delete this session and its conversation for good"
            onClick={pick(() => deleteSession(session.id))}
            className={CONFIRM}
          >
            <Item icon={<Trash2 size={12} />}>Delete?</Item>
          </button>
        ) : (
          <PopoverOption onSelect={() => setIsConfirming(true)}>
            <Item icon={<Trash2 size={12} />}>Delete</Item>
          </PopoverOption>
        ))}
    </Popover>
  );
}
