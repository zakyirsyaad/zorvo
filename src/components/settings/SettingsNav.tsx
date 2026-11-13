import type { MouseEvent, ReactNode } from "react";
import { ChevronLeft, LayoutGrid, Settings2 } from "lucide-react";

export type SettingsTab = "general" | "appearance" | "agents" | "github";

export const SETTINGS_SECTIONS: readonly { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "agents", label: "Agents" },
  { id: "github", label: "GitHub" },
];

export interface SettingsNavProps {
  current: SettingsTab;
  onSelect: (tab: SettingsTab) => void;
  onBack: () => void;
  /** Agents in use with an update, counted on the Agents link. */
  updateCount: number;
}

const ITEM = "flex h-7.5 items-center gap-2.5 rounded-lg px-2.5 text-ui";
const LINK = `${ITEM} text-fg-secondary transition-colors hover:bg-surface-hover focus-ring`;
const CURRENT = "bg-surface-hover text-fg font-medium";
const TAG = "ml-auto flex h-4.5 items-center justify-center rounded-md bg-chip text-caption";

/** The canvas's own glyphs where lucide has none that match: 14px, stroke 1.75, round ends. */
function DrawnIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

const ICONS: Record<SettingsTab, ReactNode> = {
  general: <Settings2 size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />,
  appearance: (
    <DrawnIcon>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" />
    </DrawnIcon>
  ),
  agents: <LayoutGrid size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />,
  github: (
    <DrawnIcon>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M6 8.5v7M18 15.5V9a3 3 0 0 0-3-3h-3" />
    </DrawnIcon>
  ),
};

/** Runs `action` instead of following the link: Settings has no URLs, so the address never changes. */
const instead = (action: () => void) => (event: MouseEvent<HTMLAnchorElement>) => {
  event.preventDefault();
  action();
};

/** MCP servers, drawn where the canvas puts it, until its backend lands: dimmed, not a link, out of the Tab order. */
function SoonItem() {
  return (
    <div data-soon className={`${ITEM} text-fg-subtle`}>
      <DrawnIcon>
        <path d="M9 7V3M15 7V3M6 7h12v4a6 6 0 0 1-12 0zM12 17v4" />
      </DrawnIcon>
      MCP servers
      <span className="sr-only">, coming soon</span>
      <span aria-hidden="true" className={`${TAG} px-1.5 text-fg-muted`}>
        Soon
      </span>
    </div>
  );
}

/** Settings' left navigation, in the sidebar's place and on the ground as it is: Back to sessions, then one link per section. */
export function SettingsNav({ current, onSelect, onBack, updateCount }: SettingsNavProps) {
  return (
    <nav
      aria-label="Settings"
      className="flex w-60 shrink-0 select-none flex-col gap-0.5 px-2"
    >
      {/* The window's own buttons float here; the strip drags the window. */}
      <div data-tauri-drag-region className="h-11 shrink-0" />
      <a href="#sessions" onClick={instead(onBack)} className={`${LINK} mb-2.5 text-fg-muted`}>
        <ChevronLeft size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
        Back to sessions
      </a>
      {SETTINGS_SECTIONS.map((section) => {
        const isCurrent = section.id === current;
        const count = section.id === "agents" ? updateCount : 0;
        return (
          <div key={section.id} className="contents">
            <a
              href={`#settings-${section.id}`}
              aria-current={isCurrent ? "page" : undefined}
              onClick={instead(() => onSelect(section.id))}
              className={isCurrent ? `${LINK} ${CURRENT}` : LINK}
            >
              {ICONS[section.id]}
              {section.label}
              {count > 0 && (
                <>
                  <span className="sr-only">{`, ${count} ${count === 1 ? "update" : "updates"}`}</span>
                  <span aria-hidden="true" className={`${TAG} min-w-4.5 px-1.25 text-fg`}>
                    {count}
                  </span>
                </>
              )}
            </a>
            {section.id === "agents" && <SoonItem />}
          </div>
        );
      })}
    </nav>
  );
}
