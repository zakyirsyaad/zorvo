import { invoke } from "@tauri-apps/api/core";
import { useRef, useState } from "react";
import { Copy, Download, MoreHorizontal } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { Popover, PopoverOption } from "../ui/Popover";
import {
  VISUAL_COPIED,
  VISUAL_COPY_FAILED,
  VISUAL_SAVED,
  VISUAL_SAVE_FAILED,
  drawnSize,
  menuItemsFor,
  themeNow,
  type VisualAction,
} from "../../lib/visual-export";
import type { VisualKind } from "../../lib/visuals";

export interface VisualMenuProps {
  sessionId: string;
  id: string;
  kind: VisualKind;
  /** The visual's size on screen now, which a picture is drawn at. */
  sizeOf: () => { width: number; height: number };
  /** What happened, in plain words; an empty text clears the line. */
  onStatus: (text: string) => void;
}

/** Copy and download for one inline visual. The webview sends ids, a size and a theme; never markup. */
export function VisualMenu({ sessionId, id, kind, sizeOf, onStatus }: VisualMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const run = async (action: VisualAction) => {
    setIsOpen(false);
    onStatus("");
    const { width, height } = drawnSize(sizeOf());
    const theme = themeNow();
    try {
      if (action === "copy") {
        await invoke("visual_copy_image", { sessionId, id, width, height, theme });
        onStatus(VISUAL_COPIED);
        return;
      }
      const isSaved = await invoke("visual_export", { sessionId, id, format: action, width, height, theme });
      onStatus(isSaved === true ? VISUAL_SAVED : "");
    } catch {
      // Never the error itself: it can name a path.
      onStatus(action === "copy" ? VISUAL_COPY_FAILED : VISUAL_SAVE_FAILED);
    }
  };

  return (
    <Popover
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      label="Visual actions"
      role="menu"
      align="end"
      className="w-[204px]"
      trigger={
        <IconButton ref={triggerRef} size="sm" label="Visual actions" aria-haspopup="menu" aria-expanded={isOpen} onClick={() => setIsOpen((open) => !open)}>
          <MoreHorizontal size={14} aria-hidden="true" />
        </IconButton>
      }
    >
      {menuItemsFor(kind).map((item) => (
        <PopoverOption key={item.id} onSelect={() => void run(item.id)}>
          <span className="inline-flex items-center gap-2">
            {item.id === "copy" ? <Copy aria-hidden="true" className="size-3.5 text-fg-muted" /> : <Download aria-hidden="true" className="size-3.5 text-fg-muted" />}
            {item.label}
          </span>
        </PopoverOption>
      ))}
    </Popover>
  );
}
