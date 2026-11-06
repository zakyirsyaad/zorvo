import type { ReactNode } from "react";
import type { Workspace } from "../../types";

export interface NewSessionHeadingProps {
  workspace: Workspace;
  /** Why no session can start in the folder (no agent is ready). */
  unavailableReason?: string;
}

/**
 * The top of the draft's 680px column, left-aligned as the canvas draws it: the title, and a line only when
 * something stops the session from starting. The chips under it say the rest.
 *
 * The canvas puts it 120px down in an 800px frame. A taller window would leave its lower half empty, so the
 * offset grows with the window (24vh, between 120px and 260px), putting the composer a little above the middle.
 * It is not centred: content that arrives below (the agent's sessions, a sign-in panel) would make it jump.
 */
export function NewSessionHeading({ workspace, unavailableReason }: NewSessionHeadingProps) {
  return (
    // The gutter outside the column, as the composer's and the session list's are, so all of them line up.
    <div className="px-6 pt-[clamp(120px,24vh,260px)] pb-4">
      <div className="mx-auto w-full max-w-chat">
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-fg">{`New session in ${workspace.name}`}</h1>
        {unavailableReason && <p className="mt-1 text-ui text-fg-muted">{unavailableReason}</p>}
      </div>
    </div>
  );
}

/** Under the draft's composer, in the same column: the agent's other sessions in the folder, to continue one. */
export function NewSessionBelow({ sessionList }: { sessionList?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-6">
      {sessionList && <div className="mx-auto mt-6 w-full max-w-chat">{sessionList}</div>}
    </div>
  );
}
