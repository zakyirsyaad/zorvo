import { invoke } from '@tauri-apps/api/core';
import type { ChatMessage } from '../types';
import { visualIdsOf } from './visuals';

/** Where a fork's own copy of each visual is, by visual id. */
export type VisualPaths = Readonly<Record<string, string>>;

function pathsOf(answer: unknown): VisualPaths {
  if (!Array.isArray(answer)) return {};
  const paths: Record<string, string> = {};
  for (const item of answer as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, path } = item as { id?: unknown; path?: unknown };
    if (typeof id === 'string' && typeof path === 'string') paths[id] = path;
  }
  return paths;
}

/**
 * Gives a fork its own copies of the visuals its messages name, and says where they are, so a
 * handoff can point the new agent at them. Visuals are kept per session, so without this every
 * visual in a fork would read as gone. A failed copy does not stop the fork: it returns no paths.
 */
export async function copyForkVisuals(fromSessionId: string, toSessionId: string, messages: readonly ChatMessage[]): Promise<VisualPaths> {
  const ids = visualIdsOf(messages);
  if (ids.length === 0) return {};
  try {
    await invoke('visual_copy_session', { fromSessionId, toSessionId, ids });
    return pathsOf(await invoke('visual_paths', { sessionId: toSessionId, ids }));
  } catch {
    return {};
  }
}
