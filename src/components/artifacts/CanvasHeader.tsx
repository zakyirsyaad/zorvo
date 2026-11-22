import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Maximize2, MessageSquarePlus, Minimize2, Minus, Plus, RotateCw, Scan } from "lucide-react";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { IconButton } from "../ui/IconButton";
import { Popover, PopoverOption } from "../ui/Popover";
import type { CanvasSection } from "../../lib/canvas";
import { CanvasExportMenu, type CanvasExporting } from "./CanvasExportMenu";

export interface CanvasHeaderProps {
  title: string;
  /** How many artboards the canvas has. */
  count: number;
  sections: readonly CanvasSection[];
  zoom: number;
  /** The selected artboard's title, when one is selected. */
  selectedTitle: string | null;
  /** Back to the Artifacts list; absent when there is no list to go back to. */
  onBack?: () => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  /** Runs one of the wrapper's commands: `fit`, `actual`, `in`, `out`, `section:<id>`, `focus`, `prev`, `next`. */
  onCommand: (name: string) => void;
  /** Whether a menu of the header is open over the canvas. */
  onMenuOpen: (isOpen: boolean) => void;
  /** Comments on the canvas; absent (a popout), no Comment button. */
  commenting?: CanvasCommenting;
  /** Pick, Build this and Build section; absent (a popout), none of them. */
  handoff?: CanvasHandoff;
  /** The Export menu; absent (a popout), no Export. */
  exporting?: CanvasExporting;
  /** Makes a new view of the canvas, which is how one that ended or hangs comes back; absent, no Reload. */
  onReload?: () => void;
}

export interface CanvasHandoff {
  /** Why the message box cannot take text now; the buttons are disabled with it. */
  blockedReason?: string;
  /** Whether the selected artboard belongs to a group of variants. */
  canPick: boolean;
  onPick: () => void;
  onBuild: () => void;
  onBuildSection: (sectionId: string) => void;
}

export interface CanvasCommenting {
  isCommenting: boolean;
  setCommenting: (on: boolean) => void;
  /** Opens the comment box for the selected artboard as a whole. */
  onCommentOnArtboard: () => void;
}

const DIVIDER = <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />;

/** What the selected artboard offers: its title, Focus, and the artboards before and after it. */
function SelectionTools({
  title,
  onCommand,
  commenting,
  handoff,
  exporting,
  onMenuOpen,
}: {
  title: string;
  onCommand: (name: string) => void;
  commenting?: CanvasCommenting;
  handoff?: CanvasHandoff;
  exporting?: CanvasExporting;
  onMenuOpen: (isOpen: boolean) => void;
}) {
  return (
    <>
      <span aria-label={`Selected: ${title}`} className="min-w-0 truncate px-1 text-ui font-medium text-fg">
        {title}
      </span>
      {commenting && !commenting.isCommenting && (
        <Button variant="ghost" size="sm" tone="secondary" onClick={commenting.onCommentOnArtboard} className="shrink-0 whitespace-nowrap">
          Comment on artboard
        </Button>
      )}
      {handoff?.canPick && (
        <Button variant="ghost" size="sm" tone="secondary" onClick={handoff.onPick} disabled={handoff.blockedReason !== undefined} title={handoff.blockedReason} className="shrink-0 whitespace-nowrap">
          Pick
        </Button>
      )}
      {handoff && (
        <Button variant="ghost" size="sm" tone="secondary" onClick={handoff.onBuild} disabled={handoff.blockedReason !== undefined} title={handoff.blockedReason} className="shrink-0 whitespace-nowrap">
          Build this
        </Button>
      )}
      {exporting && <CanvasExportMenu exporting={exporting} hasSelection onMenuOpen={onMenuOpen} />}
      <IconButton label="Focus" size="row" onClick={() => onCommand("focus")}>
        <Scan size={14} />
      </IconButton>
      <IconButton label="Previous artboard" size="row" onClick={() => onCommand("prev")}>
        <ChevronLeft size={14} />
      </IconButton>
      <IconButton label="Next artboard" size="row" onClick={() => onCommand("next")}>
        <ChevronRight size={14} />
      </IconButton>
    </>
  );
}

/**
 * The canvas viewer's header: back, the title and artboard count, Fit, 100%, zoom out and in with the
 * zoom, the Sections menu and Expand. With an artboard selected it also shows that artboard's title
 * with Focus, Previous and Next: in the header when expanded, else in a row of its own under it.
 * Export sits with the selection, or in the header when nothing is selected.
 */
export function CanvasHeader({ title, count, sections, zoom, selectedTitle, onBack, isExpanded, onToggleExpanded, onCommand, onMenuOpen, commenting, handoff, exporting, onReload }: CanvasHeaderProps) {
  const [isSectionsOpen, setIsSectionsOpen] = useState(false);
  const percent = `${Math.round(zoom * 100)}%`;
  const setSectionsOpen = (isOpen: boolean) => {
    setIsSectionsOpen(isOpen);
    onMenuOpen(isOpen);
  };

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
        <span className="min-w-0 flex-1 truncate text-caption text-fg-subtle">{`${count} ${count === 1 ? "artboard" : "artboards"}`}</span>
        <Button variant="ghost" size="sm" tone="secondary" onClick={() => onCommand("fit")}>
          Fit
        </Button>
        <Button variant="ghost" size="sm" tone="secondary" onClick={() => onCommand("actual")}>
          100%
        </Button>
        <IconButton label="Zoom out" size="row" onClick={() => onCommand("out")}>
          <Minus size={14} />
        </IconButton>
        <span aria-label={`Zoom ${percent}`} className="min-w-10 shrink-0 text-center text-ui-sm text-fg-secondary tabular-nums">
          {percent}
        </span>
        <IconButton label="Zoom in" size="row" onClick={() => onCommand("in")}>
          <Plus size={14} />
        </IconButton>
        <Popover
          isOpen={isSectionsOpen}
          onClose={() => setSectionsOpen(false)}
          label="Sections"
          align="end"
          className="w-56"
          trigger={
            <Chip label="Sections" aria-haspopup="menu" aria-expanded={isSectionsOpen} onClick={() => setSectionsOpen(!isSectionsOpen)} className="shrink-0 whitespace-nowrap">
              Sections
              <ChevronDown size={12} aria-hidden="true" className="text-fg-muted" />
            </Chip>
          }
        >
          {sections.map((section) => (
            <PopoverOption
              key={section.id}
              trailing={`${section.artboards.length}`}
              onSelect={() => {
                setSectionsOpen(false);
                onCommand(`section:${section.id}`);
              }}
            >
              {section.title}
            </PopoverOption>
          ))}
          {handoff && (
            <>
              <div role="separator" className="my-1 h-px bg-border" />
              {sections.map((section) => (
                <PopoverOption
                  key={`build:${section.id}`}
                  disabled={handoff.blockedReason !== undefined}
                  title={handoff.blockedReason}
                  onSelect={() => {
                    setSectionsOpen(false);
                    handoff.onBuildSection(section.id);
                  }}
                >
                  {`Build section ${section.title}`}
                </PopoverOption>
              ))}
            </>
          )}
        </Popover>
        {isExpanded && selectedTitle !== null && (
          <>
            {DIVIDER}
            <SelectionTools title={selectedTitle} onCommand={onCommand} commenting={commenting} handoff={handoff} exporting={exporting} onMenuOpen={onMenuOpen} />
          </>
        )}
        {exporting && selectedTitle === null && <CanvasExportMenu exporting={exporting} hasSelection={false} onMenuOpen={onMenuOpen} />}
        {DIVIDER}
        {onReload && (
          <IconButton label="Reload" size="row" onClick={onReload}>
            <RotateCw size={14} />
          </IconButton>
        )}
        {commenting && (
          <IconButton
            label="Comment"
            size="row"
            aria-pressed={commenting.isCommenting}
            onClick={() => commenting.setCommenting(!commenting.isCommenting)}
          >
            <MessageSquarePlus size={14} />
          </IconButton>
        )}
        <IconButton label={isExpanded ? "Shrink" : "Expand"} size="row" onClick={onToggleExpanded}>
          {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </IconButton>
      </div>
      {!isExpanded && selectedTitle !== null && (
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
          <SelectionTools title={selectedTitle} onCommand={onCommand} commenting={commenting} handoff={handoff} exporting={exporting} onMenuOpen={onMenuOpen} />
        </div>
      )}
    </>
  );
}
