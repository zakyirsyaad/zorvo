import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { dsMarksFor } from '../lib/design-system-comments';
import type { DesignSystemRead } from '../lib/design-system-read';
import type { ArtifactComment } from '../types';
import { enqueueArtifactViewCall } from './useArtifactView';
import { useLatest } from './useLatest';

/** Emitted with `{sessionId, key, kind: "preview-loaded", component}` when a live preview loads. */
const DS_VIEW = 'ds-view';
const COULD_NOT_MARK = 'Zorvo could not mark that preview.';

/**
 * Sends each live preview of the design system on screen its marks: when it loads, and again
 * whenever the comments change. Only the main window passes comments.
 */
export function useDesignSystemMarks(
  sessionId: string,
  key: string,
  comments: readonly ArtifactComment[] | undefined,
  read: DesignSystemRead | null,
  onError: (message: string) => void,
): void {
  const latest = useLatest({ comments, read, onError });

  const send = (component: string) => {
    const { comments: list, read: now } = latest.current;
    if (!list) return;
    const previewHash = now?.content?.components.find((candidate) => candidate.name === component)?.previewHash ?? null;
    const marks = dsMarksFor(list, key, component, previewHash);
    enqueueArtifactViewCall(
      () => invoke('ds_view_marks', { sessionId, key, component, marks }),
      () => latest.current.onError(COULD_NOT_MARK),
    );
  };
  const sendRef = useLatest(send);

  useEffect(() => {
    const stop = listen<unknown>(DS_VIEW, (event) => {
      const payload = event.payload as Record<string, unknown> | null;
      if (payload?.sessionId !== sessionId || payload.key !== key || payload.kind !== 'preview-loaded') return;
      if (typeof payload.component === 'string') sendRef.current(payload.component);
    });
    return () => {
      void stop.then((unlisten) => unlisten());
    };
  }, [sessionId, key, sendRef]);

  const signature = JSON.stringify((comments ?? []).filter((comment) => comment.designSystem?.key === key).map((comment) => [comment.id, comment.designSystem?.hash]));
  useEffect(() => {
    const components = latest.current.read?.content?.components ?? [];
    if (!latest.current.comments) return;
    for (const component of components) sendRef.current(component.name);
  }, [signature, latest, sendRef]);
}
