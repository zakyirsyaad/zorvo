import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useLatest } from "../../hooks/useLatest";

export interface PrivateDialogProps {
  title: string;
  children: ReactNode;
  /** The row of buttons at the bottom. */
  footer: ReactNode;
  /** What Escape does; absent where closing is not safe (a restore is running). */
  onEscape?: () => void;
  /** The control that takes focus on open; else the dialog itself. */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/** A modal over the app: focus moves in on open and back on close, Tab stays inside, labelled by its title. */
export function PrivateDialog({ title, children, footer, onEscape, initialFocusRef }: PrivateDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onEscapeRef = useLatest(onEscape);
  useFocusTrap(dialogRef);

  useEffect(() => {
    // A control that is still disabled (Copy, before the code arrives) cannot take focus: the dialog does.
    const target = initialFocusRef?.current;
    const canFocus = target !== null && target !== undefined && !target.matches(":disabled");
    (canFocus ? target : dialogRef.current)?.focus();
  }, [initialFocusRef]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEscapeRef.current?.();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onEscapeRef]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay px-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex w-full max-w-[440px] flex-col gap-4 rounded-xl border border-border bg-surface-1 p-5 text-fg-secondary shadow-dialog outline-none"
      >
        <h2 id={titleId} className="text-base font-semibold text-fg">
          {title}
        </h2>
        {children}
        <div className="flex items-center justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}
