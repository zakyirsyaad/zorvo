import { useRef, type KeyboardEvent } from "react";
import { SEGMENTED_TRACK, segmentedItem } from "./segmented-style";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  /** Shown after the label when above zero. */
  count?: number;
}

export interface TabsProps<T extends string> {
  tabs: readonly TabItem<T>[];
  selected: T;
  onSelect: (id: T) => void;
  /** The tab list's accessible name. */
  label: string;
  /** Prefix for the tab and panel ids (see `tabIds`). */
  idPrefix: string;
  className?: string;
}

/** The ids a tab and its panel share, so the consumer's panel can point back at its tab. */
export function tabIds(prefix: string, id: string): { tab: string; panel: string } {
  return { tab: `${prefix}-tab-${id}`, panel: `${prefix}-panel-${id}` };
}

/** A tab strip: a click or Left/Right (wrapping), Home and End pick a tab and focus it. */
export function Tabs<T extends string>({ tabs, selected, onSelect, label, idPrefix, className }: TabsProps<T>) {
  const refs = useRef(new Map<T, HTMLButtonElement>());

  const pick = (index: number) => {
    const next = tabs[(index + tabs.length) % tabs.length].id;
    onSelect(next);
    refs.current.get(next)?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = tabs.findIndex((tab) => tab.id === selected);
    const target: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    if (!(event.key in target)) return;
    event.preventDefault();
    pick(target[event.key]);
  };

  return (
    <div role="tablist" aria-label={label} onKeyDown={handleKeyDown} className={[SEGMENTED_TRACK, className].filter(Boolean).join(" ")}>
      {tabs.map((tab) => {
        const isSelected = tab.id === selected;
        const ids = tabIds(idPrefix, tab.id);
        return (
          <button
            key={tab.id}
            ref={(element) => {
              if (element) refs.current.set(tab.id, element);
              else refs.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={ids.tab}
            aria-selected={isSelected}
            aria-controls={isSelected ? ids.panel : undefined}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            className={segmentedItem(isSelected)}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && <span className="text-fg-muted">{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
