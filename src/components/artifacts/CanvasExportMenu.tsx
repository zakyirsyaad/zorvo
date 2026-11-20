import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "../ui/Button";
import { Popover, PopoverOption } from "../ui/Popover";

export type ExportScope = "selected" | "all";
export type ExportFormat = "png" | "pdf";

export interface CanvasExporting {
  /** An export is under way: the menu waits for it. */
  isExporting: boolean;
  onExport: (scope: ExportScope, format: ExportFormat) => void;
}

/** The header's Export menu: the selected artboard as PNG or PDF when there is one, then every artboard as PNG and the whole canvas as PDF. */
export function CanvasExportMenu({ exporting, hasSelection, onMenuOpen }: { exporting: CanvasExporting; hasSelection: boolean; onMenuOpen: (isOpen: boolean) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const setOpen = (open: boolean) => {
    setIsOpen(open);
    onMenuOpen(open);
  };
  const choose = (scope: ExportScope, format: ExportFormat) => {
    setOpen(false);
    exporting.onExport(scope, format);
  };
  return (
    <Popover
      isOpen={isOpen}
      onClose={() => setOpen(false)}
      label="Export"
      align="end"
      className="w-60"
      trigger={
        <Button
          variant="ghost"
          size="sm"
          tone="secondary"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          disabled={exporting.isExporting}
          title={exporting.isExporting ? "Exporting…" : undefined}
          onClick={() => setOpen(!isOpen)}
          className="shrink-0 gap-0.5 whitespace-nowrap"
        >
          Export
          <ChevronDown size={12} aria-hidden="true" className="text-fg-muted" />
        </Button>
      }
    >
      {hasSelection && (
        <>
          <PopoverOption onSelect={() => choose("selected", "png")}>This artboard as PNG</PopoverOption>
          <PopoverOption onSelect={() => choose("selected", "pdf")}>This artboard as PDF</PopoverOption>
          <div role="separator" className="my-1 h-px bg-border" />
        </>
      )}
      <PopoverOption onSelect={() => choose("all", "png")}>All artboards as PNG</PopoverOption>
      <PopoverOption onSelect={() => choose("all", "pdf")}>Whole canvas as PDF</PopoverOption>
    </Popover>
  );
}
