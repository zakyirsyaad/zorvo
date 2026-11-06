import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLatest } from "../../hooks/useLatest";
import { ChevronDown, ShieldAlert } from "lucide-react";
import { Popover, PopoverHeader, PopoverList, PopoverOption, PopoverSearch } from "../ui/Popover";
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
  /** Before the value on the chip: only the agent chip has one (its logo); the canvas draws the others without. */
  icon?: ReactNode;
  /** A visible heading over the options: "Mode". */
  heading?: string;
  /** After the value on the chip: a risky mode's shield. */
  trailing?: ReactNode;
  /** The chip's look: the composer row's by default, `DRAFT_CHIP` above a draft's card. */
  chipClassName?: string;
  /**
   * Which way the menu opens: up from a session's composer at the bottom of the window (the default), down
   * in a draft, whose composer sits near the top with its column's room below.
   */
  side?: "top" | "bottom";
  /** A small mark before each row's name: the agent dropdown's logos. */
  renderIcon?: (option: DropdownOption) => ReactNode;
  /** Called each time the menu opens: a compare chip asks its agent for its models then. */
  onOpen?: () => void;
  /** Drawn in place of the rows and the search, while there is no list to show (it loads, or asking failed). */
  status?: ReactNode;
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
  return splitTag(label).name;
}

/** A label's leading "[Provider]" tag, if any, and the name after it: "[OpenRouter] kimi-k2" gives OpenRouter and kimi-k2. */
function splitTag(label: string): { tag?: string; name: string } {
  const match = /^\[([^\]]+)\]\s*(.*)$/.exec(label);
  if (!match || match[2] === "") return { name: label };
  return { tag: match[1], name: match[2] };
}

interface TagGroup {
  tag?: string;
  options: DropdownOption[];
}

/**
 * The options grouped by their tag, each group where its first option was, so a long model list reads by name
 * under one heading per provider instead of repeating the provider on every row. Untagged options keep their place.
 */
function groupByTag(options: readonly DropdownOption[]): TagGroup[] {
  const groups: TagGroup[] = [];
  for (const option of options) {
    const { tag } = splitTag(option.label);
    const group = groups.find((candidate) => candidate.tag === tag);
    if (group) group.options.push(option);
    else groups.push({ tag, options: [option] });
  }
  return groups;
}

function matches(option: DropdownOption, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return (
    needle === "" ||
    option.label.toLowerCase().includes(needle) ||
    (option.description?.toLowerCase().includes(needle) ?? false)
  );
}

/** The line under an option: what it does, and for a risky mode that it acts without asking, on one subtle line. */
function detailOf(option: DropdownOption): string | undefined {
  if (!option.risky) return option.description;
  if (!option.description) return `${RISKY_LINE}.`;
  // An agent's description may stop without a full stop ("Automatically approve all tools"): end it first.
  const description = /[.!?]$/.test(option.description) ? option.description : `${option.description}.`;
  return `${description} ${RISKY_LINE}.`;
}

interface OptionRowsProps {
  options: readonly DropdownOption[];
  current: DropdownOption | undefined;
  query: string;
  onSelect: (value: string | undefined) => void;
  renderIcon?: (option: DropdownOption) => ReactNode;
}

function OptionRow({ option, current, query, onSelect, renderIcon }: Omit<OptionRowsProps, "options"> & { option: DropdownOption }) {
  const { tag, name } = splitTag(option.label);
  return (
    <PopoverOption
      selected={option.value === current?.value}
      onSelect={() => onSelect(option.value)}
      description={detailOf(option)}
      // The full label, tag and all, for a name cut short.
      title={tag ? option.label : undefined}
    >
      <span className="flex items-center gap-1.5">
        {renderIcon && (
          <span data-option-icon="" aria-hidden="true" className="flex shrink-0">
            {renderIcon(option)}
          </span>
        )}
        <span className="truncate">
          <Highlighted text={name} query={query} />
        </span>
        {option.risky && (
          <ShieldAlert size={12} role="img" aria-label={RISKY_LINE} className="shrink-0 text-status-attention" />
        )}
      </span>
    </PopoverOption>
  );
}

function OptionRows({ options, ...row }: OptionRowsProps) {
  return (
    <div className="max-h-72 overflow-y-auto">
      {groupByTag(options).map((group) =>
        group.tag === undefined ? (
          group.options.map((option) => <OptionRow key={option.value ?? "__default"} option={option} {...row} />)
        ) : (
          <div key={`tag:${group.tag}`} role="group" aria-label={group.tag}>
            <PopoverHeader>{group.tag}</PopoverHeader>
            {group.options.map((option) => (
              <OptionRow key={option.value ?? "__default"} option={option} {...row} />
            ))}
          </div>
        ),
      )}
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
  renderIcon,
}: {
  label: string;
  options: readonly DropdownOption[];
  current: DropdownOption | undefined;
  onSelect: (value: string | undefined) => void;
  renderIcon?: (option: DropdownOption) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  // In the order the rows show, grouped by tag, so Return picks the first row you see.
  const visible = groupByTag(options.filter((option) => matches(option, query))).flatMap((group) => group.options);
  useEffect(() => searchRef.current?.focus(), []);

  return (
    <>
      <PopoverSearch
        inputRef={searchRef}
        type="search"
        value={query}
        onChange={setQuery}
        onKeyDown={(e) => {
          if (e.key === "Enter" && query.trim() !== "" && visible.length > 0) {
            e.preventDefault();
            onSelect(visible[0].value);
          }
        }}
        placeholder={`Search ${label.toLowerCase()}`}
      />
      <PopoverList label={label}>
        <OptionRows options={visible} current={current} query={query} onSelect={onSelect} renderIcon={renderIcon} />
      </PopoverList>
      <p className="px-2 pt-1.5 pb-0.5 text-caption text-fg-subtle">
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
  heading,
  trailing,
  chipClassName = COMPOSER_CHIP,
  side = "top",
  renderIcon,
  onOpen,
  status,
}: OptionDropdownProps) {
  const current = options.find((o) => o.value === selected) ?? options[0];
  const valueLabel = current?.label ?? "";
  const detail = current?.description ?? description;
  const hasStatus = status !== undefined && status !== null;
  const hasSearch = !hasStatus && options.length > SEARCH_THRESHOLD;
  // Options with a line under them wrap at the canvas's 300px; a short plain list stays as wide as its words.
  const isWide = hasStatus || hasSearch || options.some((option) => option.description || option.risky);
  const onOpenRef = useLatest(onOpen);

  // Once per opening, never on a re-render while it stays open.
  useEffect(() => {
    if (isOpen) onOpenRef.current?.();
  }, [isOpen, onOpenRef]);

  return (
    <Popover
      isOpen={isOpen}
      onClose={onClose}
      label={label}
      role={hasSearch ? "dialog" : "listbox"}
      side={side}
      align={align === "left" ? "start" : "end"}
      className={isWide ? "w-75" : "w-max min-w-40 max-w-80"}
      trigger={
        <button
          type="button"
          aria-label={`${label}: ${valueLabel}`}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          onClick={onToggle}
          title={detail ? `${valueLabel}: ${detail}` : valueLabel}
          className={chipClassName}
        >
          {icon}
          {showLabel && <span className="text-fg-subtle">{label}</span>}
          <span className="max-w-[140px] truncate">{chipLabelOf(valueLabel)}</span>
          {trailing}
          <ChevronDown size={12} aria-hidden="true" className="shrink-0 text-fg-muted" />
        </button>
      }
    >
      {heading && <PopoverHeader>{heading}</PopoverHeader>}
      {hasStatus ? (
        status
      ) : hasSearch ? (
        <SearchableOptions label={label} options={options} current={current} onSelect={onSelect} renderIcon={renderIcon} />
      ) : (
        <OptionRows options={options} current={current} query="" onSelect={onSelect} renderIcon={renderIcon} />
      )}
    </Popover>
  );
}
