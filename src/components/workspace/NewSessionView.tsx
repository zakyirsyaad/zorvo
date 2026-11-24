import type { ReactNode } from "react";
import { Wordmark } from "../onboarding/Wordmark";

/** The welcome screen's line, said again over every new session. */
export const NEW_SESSION_LINE = "Every coding agent. One desktop.";

/**
 * Above the draft's card: the room that, matched by the room under it (`NewSessionBelow`), puts the card in the
 * middle of the column. At its foot, centred over the card, the Zorvo lockup and the welcome screen's line, as a
 * paragraph: the top bar's breadcrumb is the page's title (New session). A line shows only when something stops a
 * session from starting, right above the card.
 */
export function NewSessionAbove({ unavailableReason }: { unavailableReason?: string }) {
  return (
    <div data-new-session-above="" className="flex min-h-6 flex-1 flex-col justify-end px-6 pb-4">
      <div className="mx-auto flex w-full max-w-draft flex-col items-center gap-3 pb-6">
        <Wordmark />
        <p className="text-ui text-fg-muted">{NEW_SESSION_LINE}</p>
      </div>
      {unavailableReason && <p className="mx-auto w-full max-w-draft text-ui text-fg-muted">{unavailableReason}</p>}
    </div>
  );
}

/**
 * Under the draft's composer, in the same column: the agent's other sessions in the folder, to continue one. It
 * takes as much room as the space above the card, so the card stays put when the list arrives; a long list
 * scrolls inside it. It keeps at least 160px: when the window is too short, the main column scrolls to it.
 */
export function NewSessionBelow({ sessionList }: { sessionList?: ReactNode }) {
  return (
    <div className={`flex-1 overflow-y-auto px-6 pb-6 ${sessionList ? "min-h-40" : "min-h-0"}`}>
      {sessionList && <div className="mx-auto mt-8 w-full max-w-draft">{sessionList}</div>}
    </div>
  );
}
