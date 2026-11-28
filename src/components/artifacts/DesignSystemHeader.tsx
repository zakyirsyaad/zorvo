import { ChevronLeft, FolderOpen, Maximize2, Minimize2, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";

export interface DesignSystemHeaderProps {
  title: string;
  /** The system's folder relative to the session's folder. */
  relative: string;
  onBack?: () => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onReveal?: () => void;
  onReload?: () => void;
  /** Lines about the system, as plain text: a default problem, tokens that could not be read. */
  notes: readonly string[];
  /** Controls later parts add (Theme, Comment). */
  children?: ReactNode;
}

/** The design system viewer's header: Zorvo's own controls, outside the system's page. */
export function DesignSystemHeader({ title, relative, onBack, isExpanded, onToggleExpanded, onReveal, onReload, notes, children }: DesignSystemHeaderProps) {
  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
        {onBack && !isExpanded && (
          <Button variant="ghost" size="sm" tone="secondary" aria-label="Back to artifacts" onClick={onBack} className="gap-0.5 pl-1">
            <ChevronLeft size={14} aria-hidden="true" />
            Artifacts
          </Button>
        )}
        <h3 title={title} className="max-w-[40%] shrink-0 truncate pl-1 text-ui font-semibold text-fg">
          {title}
        </h3>
        <span title={relative} className="min-w-0 flex-1 truncate text-caption text-fg-subtle">{`Design system · ${relative}`}</span>
        {children}
        {onReveal && (
          <IconButton label="Show in Finder" size="row" onClick={onReveal}>
            <FolderOpen size={14} />
          </IconButton>
        )}
        {onReload && (
          <IconButton label="Reload" size="row" onClick={onReload}>
            <RotateCw size={14} />
          </IconButton>
        )}
        <IconButton label={isExpanded ? "Shrink" : "Expand"} size="row" onClick={onToggleExpanded}>
          {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </IconButton>
      </div>
      {notes.length > 0 && (
        <div role="status" className="flex shrink-0 flex-col gap-0.5 border-b border-border px-3 py-2 text-ui-sm text-fg-muted">
          {notes.map((note) => (
            <span key={note} className="break-words">
              {note}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
