import { useId, useRef, type KeyboardEvent, type Ref } from "react";
import type { Appearance } from "../../lib/appearance";
import { SEGMENTED_TRACK, segmentedItem } from "../ui/segmented-style";
import { SettingsHeader } from "./SettingsGroup";

export interface AppearanceSectionProps {
  titleRef?: Ref<HTMLHeadingElement>;
  titleId?: string;
  appearance: Appearance;
  onChange: (appearance: Appearance) => void;
}

const THEMES: readonly { id: Appearance; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

/** Said beside the control while System is picked. */
const SYSTEM_NOTE = "follows your Mac";

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** Settings → Appearance: System, Light and Dark as a segmented radio group. */
export function AppearanceSection({ titleRef, titleId, appearance, onChange }: AppearanceSectionProps) {
  const segments = useRef(new Map<Appearance, HTMLButtonElement>());
  const noteId = useId();

  // As a native radio group: an arrow moves to the next segment, wrapping, and picks it.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = STEP[event.key];
    if (!step) return;
    event.preventDefault();
    const index = THEMES.findIndex((theme) => theme.id === appearance);
    const next = THEMES[(index + step + THEMES.length) % THEMES.length].id;
    onChange(next);
    segments.current.get(next)?.focus();
  };

  const followsMac = appearance === "system";
  return (
    <div className="flex flex-col gap-4">
      <SettingsHeader title="Appearance" titleRef={titleRef} titleId={titleId}>
        The terminal stays dark in every theme, since agents color their output for a dark ground.
      </SettingsHeader>
      <div className="flex items-center gap-3">
        <div role="radiogroup" aria-label="Theme" onKeyDown={handleKeyDown} className={SEGMENTED_TRACK}>
          {THEMES.map((theme) => {
            const isChecked = theme.id === appearance;
            return (
              <button
                key={theme.id}
                ref={(element) => {
                  if (element) segments.current.set(theme.id, element);
                  else segments.current.delete(theme.id);
                }}
                type="button"
                role="radio"
                aria-checked={isChecked}
                aria-describedby={theme.id === "system" && followsMac ? noteId : undefined}
                tabIndex={isChecked ? 0 : -1}
                onClick={() => onChange(theme.id)}
                className={segmentedItem(isChecked, "px-3.5")}
              >
                {theme.label}
              </button>
            );
          })}
        </div>
        {followsMac && (
          <span id={noteId} className="text-ui-sm text-fg-subtle">
            {SYSTEM_NOTE}
          </span>
        )}
      </div>
    </div>
  );
}
