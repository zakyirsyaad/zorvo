import { createContext, useContext, useEffect, useRef, type FocusEvent, type KeyboardEventHandler, type ReactNode, type Ref } from "react";
import { Check, Search } from "lucide-react";
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
  /**
   * Classes on the wrapper around the trigger: a chip in a wrapping row passes `min-w-0 max-w-full`, so the
   * wrapper (a flex item) can shrink and its chip truncate instead of widening the row.
   */
  wrapperClassName?: string;
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
  wrapperClassName,
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
    <div ref={wrapperRef} className={[panelClassName ? undefined : "relative", wrapperClassName].filter(Boolean).join(" ") || undefined}>
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

/** A small muted heading over a group of options; `aside` sits on its right, as the agent menu's hint does. */
export function PopoverHeader({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 px-2 pt-1.5 pb-1 text-caption font-medium text-fg-muted">
      <span className="min-w-0 flex-1">{children}</span>
      {aside && <span className="font-normal text-fg-subtle">{aside}</span>}
    </div>
  );
}

export interface PopoverSearchProps {
  value: string;
  onChange: (value: string) => void;
  /** Also the field's accessible name: "Search branches". */
  placeholder: string;
  /** `search` where a list filters as you type and Escape may clear it (the model menu). */
  type?: "search" | "text";
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}

/** The 30px search field at the top of a long menu, with its icon, as the canvas draws the branch and model menus. */
export function PopoverSearch({ value, onChange, placeholder, type = "text", autoFocus, inputRef, onKeyDown }: PopoverSearchProps) {
  return (
    <label className="focus-ring-within mb-1 flex h-7.5 items-center gap-2 rounded border border-border bg-surface-2 px-2 text-fg-subtle">
      <Search size={12} aria-hidden="true" className="shrink-0" />
      <input
        ref={inputRef}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-ui-sm text-fg placeholder-fg-subtle outline-none"
      />
    </label>
  );
}

/** A popover's title row, as the canvas draws the Plan and Background tasks headers: the title, and a count on the right. */
export function PopoverTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-2 pt-1 pb-2">
      <span className="truncate text-ui font-semibold text-fg">{children}</span>
      {aside && <span className="shrink-0 text-caption text-fg-subtle">{aside}</span>}
    </div>
  );
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
  /** A tooltip with more than the row shows (a model's full name, its provider tag included). */
  title?: string;
  children: ReactNode;
}

const OPTION =
  "focus-ring flex min-h-7.5 w-full gap-2 rounded px-2 text-left text-ui text-fg transition-colors enabled:hover:bg-surface-hover disabled:text-fg-subtle";
// A row with a line under its label tops its check and grows; a one-line row is centred in 30px.
const OPTION_TWO_LINES = "items-start py-1.75";
const OPTION_ONE_LINE = "items-center py-1.5";

/** One row of a popover: an option in a listbox, a menu item in a menu. */
export function PopoverOption({
  selected,
  onSelect,
  description,
  isRadio = false,
  trailing,
  disabled,
  title,
  children,
}: PopoverOptionProps) {
  const popoverRole = useContext(PopoverRoleContext);
  const menuRole = isRadio ? "menuitemradio" : "menuitem";
  const role = popoverRole === "listbox" ? "option" : popoverRole === "menu" ? menuRole : undefined;
  const isSelected = selected ?? false;
  // A row you can check keeps its check's place on the left; a command (Rename, Delete) has none.
  const isCheckable = selected !== undefined || role === "option" || role === "menuitemradio";
  const classes = [OPTION, description ? OPTION_TWO_LINES : OPTION_ONE_LINE, isSelected && "bg-surface-hover"];
  return (
    <button
      type="button"
      role={role}
      aria-selected={role === "option" ? isSelected : undefined}
      aria-checked={role === "menuitemradio" ? isSelected : undefined}
      disabled={disabled}
      title={title}
      onClick={onSelect}
      className={classes.filter(Boolean).join(" ")}
    >
      {isCheckable && (
        <span data-check-slot="" aria-hidden="true" className="flex w-3.5 shrink-0 justify-center pt-0.5">
          {isSelected && <Check className="size-3.5 text-fg" />}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{children}</span>
        {description && <span className="text-caption leading-[15px] text-fg-subtle">{description}</span>}
      </span>
      {trailing && <span className="shrink-0 text-caption text-fg-muted">{trailing}</span>}
    </button>
  );
}
