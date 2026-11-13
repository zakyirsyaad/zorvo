import { useEffect, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { IconButton } from "../ui/IconButton";

export interface SidebarSearchProps {
  query: string;
  onQueryChange: (next: string) => void;
  onNewSession: () => void;
}

const BOX = "h-8 rounded-lg border border-border bg-surface-2";

/**
 * The sidebar's top row: New session beside a Search sessions button. Pressing Search swaps the row
 * for the search field; Escape or Close search closes it and clears the query, so the list is never
 * left narrowed with nothing to show why.
 */
export function SidebarSearch({ query, onQueryChange, onNewSession }: SidebarSearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  // Set when the field closes, so focus goes back to the button once it is mounted again.
  const returnFocus = useRef(false);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      searchButtonRef.current?.focus();
    }
  }, [isOpen]);

  const close = () => {
    returnFocus.current = true;
    onQueryChange("");
    setIsOpen(false);
  };

  if (isOpen) {
    return (
      <div className={`relative flex items-center ${BOX}`}>
        <Search size={13} aria-hidden="true" className="pointer-events-none absolute left-2.5 text-fg-subtle" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
          placeholder="Search sessions"
          aria-label="Search sessions"
          className="h-full min-w-0 flex-1 rounded-lg bg-transparent pl-8 pr-1 text-ui text-fg placeholder-fg-subtle focus-ring"
        />
        <IconButton label="Close search" size="xs" className="mr-1" onClick={close}>
          <X size={12} />
        </IconButton>
      </div>
    );
  }

  return (
    <div className="flex gap-1.5">
      <button
        type="button"
        onClick={onNewSession}
        className={`${BOX} flex flex-1 items-center justify-start gap-1.5 px-3 text-ui font-medium text-fg transition-colors hover:bg-surface-hover focus-ring`}
      >
        <Plus size={14} aria-hidden="true" className="mr-0.5" />
        New session
      </button>
      <button
        ref={searchButtonRef}
        type="button"
        aria-label="Search sessions"
        title="Search sessions"
        onClick={() => setIsOpen(true)}
        className={`${BOX} flex size-8 shrink-0 items-center justify-center text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-ring`}
      >
        <Search size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
