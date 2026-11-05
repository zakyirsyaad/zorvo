import { createContext, useContext, useEffect, useRef, type FocusEvent, type ReactNode } from "react";
import { Check } from "lucide-react";
import { useDismiss } from "../../hooks/useDismiss";

type PopoverRole = "menu" | "listbox" | "dialog";

export interface PopoverProps {
  isOpen: boolean;
  onClose: () => void;
  /** The control that opens the popover; it gets focus back when the popover closes from inside. */
  trigger: ReactNode;
  /** The panel's accessible name. */
  label: string;
  role?: PopoverRole;
  side?: "bottom" | "top";
  align?: "start" | "end";
  /**
   * Places the panel itself (in place of `side` and `align`), against the nearest positioned box around
   * the popover rather than its trigger: the sidebar's Agents menu spans the sidebar's footer.
   */
  panelClassName?: string;
  className?: string;
  children: ReactNode;
}

/** The panel's look without its position, for a list that keeps focus in a text field (the `/` and `@` menus). */
export const POPOVER_PANEL_STYLE = "rounded-lg border border-border bg-surface-3 p-1.5 shadow-popover";
const PANEL = `absolute z-50 ${POPOVER_PANEL_STYLE}`;
const SIDES = { bottom: "top-full mt-1", top: "bottom-full mb-1" } as const;
const ALIGNS = { start: "left-0", end: "right-0" } as const;
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

const PopoverRoleContext = createContext<PopoverRole>("menu");

/** The one popover style: a panel under (or above) its trigger, closed by Escape or a click outside. */
export function Popover({
  isOpen,
  onClose,
  trigger,
  label,
  role = "menu",
  side = "bottom",
  align = "start",
  panelClassName,
  className,
  children,
}: PopoverProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const hasFocusInside = useRef(false);
  useDismiss(wrapperRef, isOpen, onClose);

  useEffect(() => {
    if (isOpen || !hasFocusInside.current) return;
    hasFocusInside.current = false;
    // Only focus that the closing lost goes back: a choice that moved it (a rename field) keeps it.
    const active = document.activeElement;
    if (active && active !== document.body) return;
    triggerRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [isOpen]);

  // A blur with no related target is the panel unmounting (or a click on nothing focusable): keep the flag.
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next && !event.currentTarget.contains(next)) hasFocusInside.current = false;
  };

  const placement = panelClassName ?? `${SIDES[side]} ${ALIGNS[align]}`;
  const panelClasses = [PANEL, placement, className].filter(Boolean).join(" ");
  return (
    // With its own placement the panel is positioned against a box further out, so the wrapper is not one.
    <div ref={wrapperRef} className={panelClassName ? undefined : "relative"}>
      <span ref={triggerRef} className="contents">
        {trigger}
      </span>
      {isOpen && (
        <div
          role={role}
          aria-label={label}
          className={panelClasses}
          onFocus={() => (hasFocusInside.current = true)}
          onBlur={handleBlur}
        >
          <PopoverRoleContext.Provider value={role}>{children}</PopoverRoleContext.Provider>
        </div>
      )}
    </div>
  );
}

/** A small muted heading over a group of options. */
export function PopoverHeader({ children }: { children: ReactNode }) {
  return <div className="px-2 pt-1 pb-1.5 text-caption font-medium text-fg-muted">{children}</div>;
}

/** A listbox of options inside a dialog popover, beside a search field the listbox cannot hold. */
export function PopoverList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="listbox" aria-label={label}>
      <PopoverRoleContext.Provider value="listbox">{children}</PopoverRoleContext.Provider>
    </div>
  );
}

export interface PopoverOptionProps {
  selected?: boolean;
  onSelect: () => void;
  /** A line under the label that says what the option does. */
  description?: ReactNode;
  /** In a menu: one of a set of choices, checked when `selected` (a radio item, not a command). */
  isRadio?: boolean;
  /** Shown at the right edge, before the check (a hint such as a count). */
  trailing?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}

const OPTION =
  "focus-ring flex min-h-7.5 w-full items-center gap-2 rounded px-2 py-1 text-left text-ui text-fg transition-colors enabled:hover:bg-surface-hover disabled:text-fg-subtle";

/** One row of a popover: an option in a listbox, a menu item in a menu. */
export function PopoverOption({
  selected = false,
  onSelect,
  description,
  isRadio = false,
  trailing,
  disabled,
  children,
}: PopoverOptionProps) {
  const popoverRole = useContext(PopoverRoleContext);
  const menuRole = isRadio ? "menuitemradio" : "menuitem";
  const role = popoverRole === "listbox" ? "option" : popoverRole === "menu" ? menuRole : undefined;
  return (
    <button
      type="button"
      role={role}
      aria-selected={role === "option" ? selected : undefined}
      aria-checked={role === "menuitemradio" ? selected : undefined}
      disabled={disabled}
      onClick={onSelect}
      className={[OPTION, selected && "bg-surface-hover"].filter(Boolean).join(" ")}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{children}</span>
        {description && <span className="text-caption text-fg-muted">{description}</span>}
      </span>
      {trailing && <span className="shrink-0 text-caption text-fg-muted">{trailing}</span>}
      {selected && <Check aria-hidden="true" className="size-3.5 shrink-0 text-fg" />}
    </button>
  );
}
