import { useCallback } from 'react';
import { canvasOpeningFor, openingFor, type ShownArtifact, type ViewedArtifact } from '../lib/artifacts';

/** What an agent showed: a page, or a canvas by its key. */
export type ShownOutput = ShownArtifact | { kind: 'canvas'; key: string };
import { useLatest } from './useLatest';

export interface ArtifactOpeningDeps {
  /** The session on screen, if any. */
  activeSessionId: string | null;
  /** What the viewer shows now. */
  viewed: ViewedArtifact | null;
  /** Shows the inspector's Artifacts tab; focus stays where it is. */
  showTab: () => void;
  view: (view: ViewedArtifact) => void;
}

/**
 * What the window does when an agent shows a page: a new artifact of the
 * session on screen opens the Artifacts tab on it, and so does a canvas, unless it is open already. Nothing else moves: a new
 * version reaches the viewer by itself while it follows the newest, and Zorvo
 * never switches sessions for a page.
 */
export function useArtifactOpening(deps: ArtifactOpeningDeps): (sessionId: string, shown: ShownOutput) => void {
  const latest = useLatest(deps);
  return useCallback(
    (sessionId, shown) => {
      const { activeSessionId, viewed, showTab, view } = latest.current;
      const isOnScreen = activeSessionId !== null && sessionId === activeSessionId;
      if ('kind' in shown) {
        if (canvasOpeningFor({ isOnScreen, key: shown.key, viewed }) !== 'show-tab') return;
        view({ canvasKey: shown.key });
        showTab();
        return;
      }
      const opening = openingFor({ isOnScreen, shown, viewed });
      if (opening !== 'show-tab') return;
      view({ artifactId: shown.artifact.id, version: null });
      showTab();
    },
    [latest],
  );
}
