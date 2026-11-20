import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { escapeVisible } from "../../lib/visible-text";
import { Button } from "../ui/Button";

/** What an agent is doing on this Mac, as `computer-use-activity` reports it. */
export interface ComputerUseActivity {
  sessionId: string;
  agentName: string;
  app: string;
  fullScreen: boolean;
}

export function parseActivity(payload: unknown): ComputerUseActivity | null {
  if (typeof payload !== "object" || payload === null) return null;
  const raw = payload as Record<string, unknown>;
  if (typeof raw.sessionId !== "string" || typeof raw.agentName !== "string" || typeof raw.app !== "string") {
    return null;
  }
  return {
    sessionId: raw.sessionId,
    // Both names come from outside Zorvo: a registry entry and an app's bundle.
    agentName: escapeVisible(raw.agentName),
    app: escapeVisible(raw.app),
    fullScreen: raw.fullScreen === true,
  };
}

export function pillSentence(activity: ComputerUseActivity): string {
  return activity.fullScreen
    ? `${activity.agentName} is controlling your screen`
    : `${activity.agentName} is using ${activity.app}`;
}

/**
 * The page of the always-on-top pill window. The backend shows and hides the
 * window; this page says who is using what and stops it.
 */
export function ComputerUsePill() {
  const [activity, setActivity] = useState<ComputerUseActivity | null>(null);

  useEffect(() => {
    let isActive = true;
    let stop: (() => void) | undefined;
    void listen("computer-use-activity", ({ payload }) => {
      const next = parseActivity(payload);
      if (next) setActivity(next);
    }).then((unlisten) => {
      if (isActive) stop = unlisten;
      else unlisten();
    });
    // The window is made on the first action, after that action's event went out.
    void invoke("computer_use_pill_state")
      .then((latest) => {
        const next = parseActivity(latest);
        if (isActive && next) setActivity((current) => current ?? next);
      })
      .catch(() => undefined);
    return () => {
      isActive = false;
      stop?.();
    };
  }, []);

  const stopComputerUse = () => {
    if (!activity) return;
    const stopped = activity;
    // Cleared once the backend stopped it: a Stop that failed must not read as done.
    void invoke("computer_use_revoke", { sessionId: stopped.sessionId })
      .then(() => setActivity((current) => (current === stopped ? null : current)))
      .catch(() => undefined);
  };

  return (
    <main className="flex h-screen w-screen select-none items-center gap-2.5 border border-border-strong bg-surface-3 px-3 text-ui text-fg">
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${activity?.fullScreen ? "bg-status-attention" : "bg-status-running"}`}
      />
      <p role="status" className="min-w-0 flex-1 truncate">
        {activity ? pillSentence(activity) : ""}
      </p>
      <Button variant="primary" size="sm" disabled={!activity} onClick={stopComputerUse}>
        Stop
      </Button>
    </main>
  );
}
