import { invoke } from '@tauri-apps/api/core';
import { activityOf } from './activity';
import type { ChatMessage } from '../types';

const CHECKPOINT_SHA = /^([0-9a-f]{40}|[0-9a-f]{64})$/;

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

/**
 * Restores `files` (the files the agent reported changing, absolute or relative to `path`) to their
 * content in `checkpoint`, returning how many changed. No other file in the repository is touched.
 */
export function restoreTurnCheckpoint(path: string, checkpoint: string, files: readonly string[]): Promise<number> {
  return invoke<number>('restore_turn_checkpoint', { path, checkpoint, files });
}

/** The files the agent reported changing in `messages`, each once, in the order first reported. */
export function changedFilesOf(messages: readonly ChatMessage[]): string[] {
  const seen = new Set<string>();
  for (const entry of activityOf(messages).entries) {
    if (entry.kind === 'file' && entry.isNamed && entry.action !== 'read' && !entry.isSearch) seen.add(entry.path);
  }
  return [...seen];
}
