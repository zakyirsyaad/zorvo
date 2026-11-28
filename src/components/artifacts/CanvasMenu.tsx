import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MoreHorizontal } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { Popover, PopoverOption } from "../ui/Popover";

export interface CanvasMenuProps {
  sessionId: string;
  canvasKey: string;
  title: string;
  onError: (message: string) => void;
}

/** A canvas row's ⋯: Remove takes the canvas off the list (`canvas_forget`); its folder stays. The Artifacts tab and the gallery share it. */
export function CanvasMenu({ sessionId, canvasKey, title, onError }: CanvasMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const remove = () => {
    setIsOpen(false);
    invoke("canvas_forget", { sessionId, key: canvasKey }).catch(() => onError("Zorvo could not remove the canvas."));
  };
  return (
    <Popover
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      label={`More actions for ${title}`}
      align="end"
      className="w-44"
      trigger={
        <IconButton label={`More actions for ${title}`} size="row" aria-haspopup="menu" aria-expanded={isOpen} onClick={() => setIsOpen(!isOpen)}>
          <MoreHorizontal size={14} />
        </IconButton>
      }
    >
      <PopoverOption description="The folder stays where it is." onSelect={remove}>
        Remove
      </PopoverOption>
    </Popover>
  );
}
