import { useRef, type KeyboardEvent, type Ref } from "react";
import type { Appearance } from "../../lib/appearance";
import { SettingsHeader } from "./SettingsGroup";

export interface AppearanceSectionProps {
  titleRef?: Ref<HTMLHeadingElement>;
  titleId?: string;
  appearance: Appearance;
  onChange: (appearance: Appearance) => void;
}

const THEMES: readonly { id: Appearance; label: string; note?: string }[] = [
  { id: "system", label: "System", note: "· follows your Mac" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * A small window in one theme, whatever theme is in use: a sidebar strip, two lines of text and,
 * with `hasCard`, the composer. Its colours are the fixed `theme-sample-*` palettes in `globals.css`.
 */
function ThemeSample({ theme, hasCard }: { theme: "light" | "dark"; hasCard: boolean }) {
  return (
    <span className={`theme-sample-${theme} flex flex-1 bg-(--sample-bg)`}>
      <span className="w-[28%] border-r border-(--sample-line) bg-(--sample-side)" />
      <span className="flex flex-1 flex-col gap-1.25 p-2.5">
        <span className="h-1.25 w-[70%] rounded-xs bg-(--sample-bar)" />
        <span className="h-1.25 w-1/2 rounded-xs bg-(--sample-bar-2)" />
        {hasCard && <span className="mt-auto h-4 rounded border border-(--sample-line) bg-(--sample-card)" />}
      </span>
    </span>
  );
}

function Preview({ theme }: { theme: Appearance }) {
  // System is half light, half dark, framed in the dark line colour, as drawn.
  const frame = theme === "light" ? "theme-sample-light" : "theme-sample-dark";
  return (
    <span aria-hidden="true" className={`${frame} flex h-21 overflow-hidden rounded-md border border-(--sample-line)`}>
      {theme === "system" ? (
        <>
          <ThemeSample theme="light" hasCard={false} />
          <ThemeSample theme="dark" hasCard={false} />
        </>
      ) : (
        <ThemeSample theme={theme} hasCard />
      )}
    </span>
  );
}

/** Settings → Appearance: System, Light and Dark as a radio group of preview tiles. */
export function AppearanceSection({ titleRef, titleId, appearance, onChange }: AppearanceSectionProps) {
  const tiles = useRef(new Map<Appearance, HTMLButtonElement>());

  // As a native radio group: an arrow moves to the next tile, wrapping, and picks it.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = STEP[event.key];
    if (!step) return;
    event.preventDefault();
    const index = THEMES.findIndex((theme) => theme.id === appearance);
    const next = THEMES[(index + step + THEMES.length) % THEMES.length].id;
    onChange(next);
    tiles.current.get(next)?.focus();
  };

  return (
    <div className="flex flex-col gap-4">
      <SettingsHeader title="Appearance" titleRef={titleRef} id={titleId}>
        The terminal stays dark in every theme, since agents color their output for a dark ground.
      </SettingsHeader>
      <div role="radiogroup" aria-label="Theme" onKeyDown={handleKeyDown} className="flex gap-3">
        {THEMES.map((theme) => {
          const isChecked = theme.id === appearance;
          return (
            <button
              key={theme.id}
              ref={(element) => {
                if (element) tiles.current.set(theme.id, element);
                else tiles.current.delete(theme.id);
              }}
              type="button"
              role="radio"
              aria-checked={isChecked}
              tabIndex={isChecked ? 0 : -1}
              onClick={() => onChange(theme.id)}
              className={`flex flex-1 flex-col gap-2 rounded-[10px] border bg-surface-2 p-2 text-left focus-ring ${
                isChecked ? "border-fg ring-1 ring-fg" : "border-border"
              }`}
            >
              <Preview theme={theme.id} />
              <span className="flex items-center gap-1.5">
                <span className={isChecked ? "font-medium text-fg" : "text-fg-secondary"}>{theme.label}</span>
                {theme.note && <span className="text-ui-sm font-normal text-fg-subtle">{theme.note}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
