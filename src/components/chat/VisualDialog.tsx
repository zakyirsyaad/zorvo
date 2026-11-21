import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { IconButton } from "../ui/IconButton";
import { VisualFrame } from "./VisualFrame";

export interface VisualDialogProps {
  title: string;
  document: string;
  onClose: () => void;
}

/** Room the dialog's header and padding take out of the window's height. */
const DIALOG_CHROME = 140;

/** An inline visual at a larger size, over the app, until it is closed. Still a document that cannot run. */
export function VisualDialog({ title, document: source, onClose }: VisualDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(dialogRef);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay px-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[90vh] w-full max-w-[960px] flex-col rounded-xl border border-border bg-surface-2 text-fg-secondary shadow-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-border py-2.5 pr-3 pl-4">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-ui font-semibold text-fg">
            {title}
          </h2>
          <IconButton ref={closeRef} size="sm" label="Close" onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </IconButton>
        </header>
        <div className="min-h-0 overflow-hidden p-5">
          <VisualFrame document={source} title={title} maxHeight={Math.max(240, window.innerHeight - DIALOG_CHROME)} />
        </div>
      </div>
    </div>
  );
}
