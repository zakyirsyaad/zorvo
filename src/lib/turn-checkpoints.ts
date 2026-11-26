import { invoke } from '@tauri-apps/api/core';

const CHECKPOINT_SHA = /^[0-9a-f]{40,64}$/;

/** True when `value` matches a git object SHA-1 or SHA-256 hash. */
export function isValidCheckpoint(value: unknown): value is string {
  return typeof value === 'string' && CHECKPOINT_SHA.test(value);
}

/** Captures a git tree snapshot before a turn starts; returns null outside a git repo or on failure. */
export async function createTurnCheckpoint(path: string): Promise<string | null> {
  try {
    const raw = await invoke<string | null>('create_turn_checkpoint', { path });
    return isValidCheckpoint(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Restores the repository's non-ignored files to `checkpoint`, returning how many files changed. */
export function restoreTurnCheckpoint(path: string, checkpoint: string): Promise<number> {
  return invoke<number>('restore_turn_checkpoint', { path, checkpoint });
}
