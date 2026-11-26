import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Chip } from "../ui/Chip";
import { Popover, PopoverOption } from "../ui/Popover";

export interface ThemeMenuProps {
  /** The design system's theme ids, in its order. */
  themes: readonly string[];
  theme: string;
  onPick: (theme: string) => void;
  /** Tells the viewer a menu covers its page, so the native view hides under it. */
  onMenuOpen?: (isOpen: boolean) => void;
}

/** Theme: which of a design system's themes its tokens, previews and artboards show. Two or more only. */
export function ThemeMenu({ themes, theme, onPick, onMenuOpen }: ThemeMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  if (themes.length < 2) return null;
  const setOpen = (open: boolean) => {
    setIsOpen(open);
    onMenuOpen?.(open);
  };
  return (
    <Popover
      isOpen={isOpen}
      onClose={() => setOpen(false)}
      label="Theme"
      align="end"
      className="w-44"
      trigger={
        <Chip label={`Theme: ${theme}`} aria-haspopup="menu" aria-expanded={isOpen} onClick={() => setOpen(!isOpen)} className="shrink-0 whitespace-nowrap">
          {theme}
          <ChevronDown size={12} aria-hidden="true" className="text-fg-muted" />
        </Chip>
      }
    >
      {themes.map((id) => (
        <PopoverOption
          key={id}
          isRadio
          selected={id === theme}
          onSelect={() => {
            setOpen(false);
            onPick(id);
          }}
        >
          {id}
        </PopoverOption>
      ))}
    </Popover>
  );
}
