import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronDown, ShieldAlert } from "lucide-react";

export interface DropdownOption {
  /** `undefined` means "agent default": no flag is passed. */
  value: string | undefined;
  label: string;
  /** What the choice does, as the agent words it; shown under the label and in the chip's tooltip. */
  description?: string;
  /** The choice lets the agent act without asking; the open menu marks it before it is picked. */
  risky?: boolean;
}

export interface OptionDropdownProps {
  /** Accessible name prefix, e.g. "Model" gives "Model: sonnet". */
  label: string;
  icon: ReactNode;
  options: readonly DropdownOption[];
  selected: string | undefined;
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (value: string | undefined) => void;
  align?: "left" | "right";
  /** Writes the label before the value on the chip, for a setting whose value alone ("On", "Plan") says little. */
  showLabel?: boolean;
  /** What the setting as a whole does; the chip's tooltip when the current choice has no description. */
  description?: string;
}

/** A list longer than this gets a search field. */
const SEARCH_THRESHOLD = 10;

/**
 * What the chip shows: a label without a leading "[Provider]" tag (Qwen
 * Code's model names carry one), so the narrow chip shows the model itself.
 */
function chipLabelOf(label: string): string {
  return label.replace(/^\[[^\]]*\]\s*/, "") || label;
}

function matches(option: DropdownOption, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return (
    needle === "" ||
    option.label.toLowerCase().includes(needle) ||
    (option.description?.toLowerCase().includes(needle) ?? false)
  );
}

interface OptionListProps {
  label: string;
  options: readonly DropdownOption[];
  current: DropdownOption | undefined;
  onSelect: (value: string | undefined) => void;
  align: "left" | "right";
  /** The chip that opened the menu; a menu with a search field gives focus back to it when it closes. */
  trigger: RefObject<HTMLButtonElement | null>;
}

/** The open menu; it is mounted only while open, so its search starts empty each time. */
function OptionList({ label, options, current, onSelect, align, trigger }: OptionListProps) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const hasSearch = options.length > SEARCH_THRESHOLD;
  const visible = hasSearch ? options.filter((o) => matches(o, query)) : options;

  useEffect(() => {
    if (!hasSearch) return;
    searchRef.current?.focus();
    // The focused search field leaves with the menu, which would drop focus to the page.
    const chip = trigger.current;
    return () => chip?.focus();
  }, [hasSearch, trigger]);

  return (
    <div
      className={`absolute bottom-full mb-2 min-w-40 max-w-80 w-max rounded-lg border border-border bg-surface-3 p-1 shadow-popover z-50 ${
        align === "left" ? "left-0" : "right-0"
      }`}
    >
      {hasSearch && (
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.trim() !== "" && visible.length > 0) {
              e.preventDefault();
              onSelect(visible[0].value);
            }
          }}
          placeholder={`Search ${label.toLowerCase()}`}
          aria-label={`Search ${label.toLowerCase()}`}
          autoComplete="off"
          spellCheck={false}
          className="mb-1 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-fg placeholder-fg-subtle outline-none focus-ring"
        />
      )}
      <div role="listbox" aria-label={label} className="max-h-72 overflow-y-auto">
        {visible.map((option) => {
          const isSelected = option.value === current?.value;
          return (
            <button
              key={option.value ?? "__default"}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => onSelect(option.value)}
              className={`flex w-full items-start justify-between gap-3 rounded px-2.5 py-1.5 text-xs text-left transition-colors cursor-pointer focus-ring ${
                isSelected
                  ? "bg-surface-hover text-fg font-medium"
                  : "text-fg-secondary hover:bg-surface-hover hover:text-fg"
              }`}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-1.5">
                  {option.risky && (
                    <ShieldAlert
                      size={12}
                      className="shrink-0 text-danger"
                      role="img"
                      aria-label="Lets the agent act without asking"
                    />
                  )}
                  <span className="truncate">{option.label}</span>
                </span>
                {option.description && (
                  <span className="text-[11px] font-normal leading-snug text-fg-muted">{option.description}</span>
                )}
              </span>
              {isSelected && <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-fg" />}
            </button>
          );
        })}
        {visible.length === 0 && <p className="px-2.5 py-1.5 text-xs text-fg-muted">No matches</p>}
      </div>
    </div>
  );
}

/** A compact composer dropdown listing only options the agent really supports. */
export function OptionDropdown({
  label,
  icon,
  options,
  selected,
  isOpen,
  onToggle,
  onSelect,
  align = "right",
  showLabel = false,
  description,
}: OptionDropdownProps) {
  const current = options.find((o) => o.value === selected) ?? options[0];
  const valueLabel = current?.label ?? "";
  const detail = current?.description ?? description;
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${label}: ${valueLabel}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={onToggle}
        title={detail ? `${valueLabel}: ${detail}` : valueLabel}
        className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-xs text-fg-secondary hover:bg-surface-hover hover:text-fg transition-colors cursor-pointer border border-border focus-ring"
      >
        {icon}
        {showLabel && <span className="text-fg-subtle">{label}</span>}
        <span className="max-w-[140px] truncate">{chipLabelOf(valueLabel)}</span>
        <ChevronDown size={11} className="text-fg-subtle" />
      </button>

      {isOpen && <OptionList label={label} options={options} current={current} onSelect={onSelect} align={align} trigger={triggerRef} />}
    </div>
  );
}
