import type { ReactNode } from "react";
import type { Workspace } from "../../types";

export interface NewSessionHeadingProps {
  workspace?: Workspace;
  /** Why no session can start in the folder (no agent is ready). */
  unavailableReason?: string;
}

/**
 * Above the draft's composer, which sits in the middle of the main area: the title, and a line only when
 * something stops the session from starting. The folder and branch chips say the rest.
 */
export function NewSessionHeading({ workspace, unavailableReason }: NewSessionHeadingProps) {
  const reason = !workspace ? "Open a project folder to start a session in it." : unavailableReason;
  return (
    <div className="flex flex-1 flex-col items-center justify-end px-6 pb-6">
      <h1 className="text-xl font-medium text-fg">{workspace ? `New session in ${workspace.name}` : "New session"}</h1>
      {reason && <p className="mt-1 max-w-md text-center text-ui text-fg-muted">{reason}</p>}
    </div>
  );
}

/** Under the draft's composer: the agent's other sessions in the folder, to continue one. */
export function NewSessionBelow({ sessionList }: { sessionList?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto px-6 pb-6">
      {sessionList && <div className="w-full max-w-md">{sessionList}</div>}
    </div>
  );
}
