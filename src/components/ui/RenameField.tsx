import { useRef, useState } from "react";

export interface RenameFieldProps {
  /** The name the field starts with, selected. */
  value: string;
  /** The field's accessible name ("Rename Alpha"). */
  label: string;
  /** Called once: with the text on Return or blur, with null on Escape. */
  onDone: (name: string | null) => void;
  className?: string;
}

/** The text field a name turns into while it is renamed: Return saves, Escape cancels. */
export function RenameField({ value, label, onDone, className }: RenameFieldProps) {
  const [name, setName] = useState(value);
  // Enter, Escape and the blur that follows them finish once.
  const isDoneRef = useRef(false);
  const finish = (result: string | null) => {
    if (isDoneRef.current) return;
    isDoneRef.current = true;
    onDone(result);
  };
  return (
    <input
      autoFocus
      onFocus={(e) => e.target.select()}
      value={name}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(name);
        if (e.key === "Escape") finish(null);
      }}
      onBlur={() => finish(name)}
      aria-label={label}
      className={[
        // 26px, radius 6, a 1px fg edge on the bg fill, as the canvas draws a name being edited.
        "h-6.5 min-w-0 flex-1 rounded-md border border-fg bg-bg px-2 text-ui text-fg focus-ring",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
