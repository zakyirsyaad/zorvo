import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ShieldAlert } from "lucide-react";
import { Popover, PopoverList, PopoverOption } from "../ui/Popover";
import { Highlighted } from "../ui/Highlighted";
import { COMPOSER_CHIP, RISKY_LINE, pluralOf } from "./chip-style";

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
  /**
   * Closes the menu on Escape or a click outside. Defaults to `onToggle`; a parent that also closes its menus
   * on those (the composer) passes a close, or the two would toggle it shut and open again.
   */
  onClose?: () => void;
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

/** The line under an option: what it does, and for a risky mode that it acts without asking. */
function detailOf(option: DropdownOption): ReactNode {
  if (!option.risky) return option.description;
  return (
    <>
      {option.description && <span className="block">{option.description}</span>}
      <span className="block text-status-attention">{RISKY_LINE}</span>
    </>
  );
}

interface OptionRowsProps {
  options: readonly DropdownOption[];
  current: DropdownOption | undefined;
  query: string;
  onSelect: (value: string | undefined) => void;
}

function OptionRows({ options, current, query, onSelect }: OptionRowsProps) {
  return (
    <div className="max-h-72 overflow-y-auto">
      {options.map((option) => (
        <PopoverOption
          key={option.value ?? "__default"}
          selected={option.value === current?.value}
          onSelect={() => onSelect(option.value)}
          description={detailOf(option)}
        >
          <span className="flex items-center gap-1.5">
            {option.risky && <ShieldAlert size={12} aria-hidden="true" className="shrink-0 text-status-attention" />}
            <span className="truncate">
              <Highlighted text={option.label} query={query} />
            </span>
          </span>
        </PopoverOption>
      ))}
      {options.length === 0 && <p className="px-2 py-1 text-ui-sm text-fg-muted">No matches</p>}
    </div>
  );
}

/** A long list's menu: a search field over the options, and how many match under them. */
function SearchableOptions({
  label,
  options,
  current,
  onSelect,
}: {
  label: string;
  options: readonly DropdownOption[];
  current: DropdownOption | undefined;
  onSelect: (value: string | undefined) => void;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const visible = options.filter((option) => matches(option, query));
  useEffect(() => searchRef.current?.focus(), []);

  return (
    <>
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
        className="focus-ring mb-1 w-full rounded border border-border bg-surface-2 px-2 py-1 text-ui-sm text-fg placeholder-fg-subtle outline-none"
      />
      <PopoverList label={label}>
        <OptionRows options={visible} current={current} query={query} onSelect={onSelect} />
      </PopoverList>
      <p className="px-2 pt-1.5 text-caption text-fg-muted">
        {visible.length} of {options.length} {pluralOf(label)}
      </p>
    </>
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
  onClose = onToggle,
  onSelect,
  align = "right",
  showLabel = false,
  description,
}: OptionDropdownProps) {
  const current = options.find((o) => o.value === selected) ?? options[0];
  const valueLabel = current?.label ?? "";
  const detail = current?.description ?? description;
  const hasSearch = options.length > SEARCH_THRESHOLD;

  return (
    <Popover
      isOpen={isOpen}
      onClose={onClose}
      label={label}
      role={hasSearch ? "dialog" : "listbox"}
      side="top"
      align={align === "left" ? "start" : "end"}
      className="w-max min-w-40 max-w-80"
      trigger={
        <button
          type="button"
          aria-label={`${label}: ${valueLabel}`}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          onClick={onToggle}
          title={detail ? `${valueLabel}: ${detail}` : valueLabel}
          className={COMPOSER_CHIP}
        >
          {icon}
          {showLabel && <span className="text-fg-subtle">{label}</span>}
          <span className="max-w-[140px] truncate">{chipLabelOf(valueLabel)}</span>
          <ChevronDown size={11} aria-hidden="true" className="shrink-0 text-fg-subtle" />
        </button>
      }
    >
      {hasSearch ? (
        <SearchableOptions label={label} options={options} current={current} onSelect={onSelect} />
      ) : (
        <OptionRows options={options} current={current} query="" onSelect={onSelect} />
      )}
    </Popover>
  );
}
