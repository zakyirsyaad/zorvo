import type { ReactNode, Ref } from "react";

export interface NewSessionHeadingProps {
  /** The draft is private: the title says so. */
  isPrivate?: boolean;
  /** Why no session can start in the folder (no agent is ready). */
  unavailableReason?: string;
  /** Where the composer draws the draft's folder and branch chips, beside the title. */
  chipsSlot?: Ref<HTMLDivElement>;
}

/**
 * The top of the draft's 720px column, 64px down, as the canvas draws it: the title with the folder and branch
 * chips beside it (they wrap under it in a narrow window), and a line only when something stops the session
 * from starting. It is not centred: content that arrives below (the agent's sessions, a sign-in panel) would
 * make it jump.
 */
export function NewSessionHeading({ isPrivate = false, unavailableReason, chipsSlot }: NewSessionHeadingProps) {
  return (
    // The gutter outside the column, as the composer's and the session list's are, so all of them line up.
    <div className="px-6 pt-16 pb-5">
      <div className="mx-auto w-full max-w-draft">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-[200px] flex-1 break-words text-xl font-semibold tracking-[-0.02em] text-fg">
            {isPrivate ? "New private session" : "New session"}
          </h1>
          <div ref={chipsSlot} data-draft-chips-slot="" className="flex flex-wrap items-center gap-2 empty:hidden" />
        </div>
        {unavailableReason && <p className="mt-1 text-ui text-fg-muted">{unavailableReason}</p>}
      </div>
    </div>
  );
}

/**
 * Under the draft's composer, in the same column: the agent's other sessions in the folder, to continue one. A
 * long list scrolls inside it, so the heading, chips and card above stay put. It keeps at least 160px: when the
 * window is too short for the rest, the main column scrolls to it rather than squeezing it to nothing.
 */
export function NewSessionBelow({ sessionList }: { sessionList?: ReactNode }) {
  return (
    <div className={`flex-1 overflow-y-auto px-6 pb-6 ${sessionList ? "min-h-40" : "min-h-0"}`}>
      {sessionList && <div className="mx-auto mt-8 w-full max-w-draft">{sessionList}</div>}
    </div>
  );
}
