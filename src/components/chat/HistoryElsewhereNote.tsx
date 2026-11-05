export interface HistoryElsewhereNoteProps {
  /** Display name of the agent that holds the earlier messages, e.g. "Claude Code". */
  agentName: string;
}

/**
 * Explains that an imported session was reopened where the agent kept it, so
 * its earlier messages are not in this transcript.
 */
export function HistoryElsewhereNote({ agentName }: HistoryElsewhereNoteProps) {
  return (
    // A quiet line above the first message, not a card.
    <p role="note" className="text-ui-sm text-fg-muted">
      Earlier messages stay in {agentName}. They are not shown here.
    </p>
  );
}
