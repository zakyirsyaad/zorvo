import { Copy, Check, GitBranch, Volume2, Square } from "lucide-react";
import { IconButton } from "./ui/IconButton";
import { REVEAL_ON_ROW } from "../lib/sidebar-status";

export interface MessageActionBarProps {
  copied: boolean;
  onCopy: () => void;
  /** Fork is offered only when the host app can fork a session. */
  onFork?: () => void;
  /** Read aloud is offered only when speech synthesis is available. */
  readAloud?: { speaking: boolean; onToggle: () => void };
}

/**
 * Copy, Fork from here and Read aloud under an agent message, as icon buttons
 * that show when you point at the message or tab into it. Its time is in the header.
 */
export function MessageActionBar({ copied, onCopy, onFork, readAloud }: MessageActionBarProps) {
  return (
    // 24px icons in fg-secondary, the nearest primitive step to the canvas's 26px.
    <div data-message-actions="" className={`-ml-1.5 mt-1.5 flex items-center gap-0.5 ${REVEAL_ON_ROW}`}>
      <IconButton
        label={copied ? "Copied" : "Copy message"}
        size="sm"
        tone="secondary"
        onClick={onCopy}
        aria-label="Copy message"
      >
        {copied ? <Check size={14} className="text-status-running" /> : <Copy size={14} />}
      </IconButton>
      {onFork && (
        <IconButton label="Fork from here" size="sm" tone="secondary" onClick={onFork}>
          <GitBranch size={14} />
        </IconButton>
      )}
      {readAloud && (
        <IconButton
          label={readAloud.speaking ? "Stop reading" : "Read aloud"}
          size="sm"
          tone="secondary"
          onClick={readAloud.onToggle}
          className={readAloud.speaking ? "text-fg" : undefined}
        >
          {readAloud.speaking ? <Square size={14} /> : <Volume2 size={14} />}
        </IconButton>
      )}
    </div>
  );
}
