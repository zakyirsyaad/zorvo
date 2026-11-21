import { invoke } from '@tauri-apps/api/core';
import type { ChatMessage } from '../types';
import { visualIdsOf } from './visuals';

/**
 * Gives a fork its own copies of the visuals its messages name. Visuals are kept per session, so
 * without this every visual in a fork would read as gone. A failed copy does not stop the fork.
 */
export async function copyForkVisuals(fromSessionId: string, toSessionId: string, messages: readonly ChatMessage[]): Promise<void> {
  const ids = visualIdsOf(messages);
  if (ids.length === 0) return;
  await invoke('visual_copy_session', { fromSessionId, toSessionId, ids }).catch(() => undefined);
}
