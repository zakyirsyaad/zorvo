import type { ChatMessage } from '../types';
import guide from './visual-guide.md?raw';

/** What `artifact_guide` answers for `kind: "visual"`: how to draw a picture for `show_visual`. */
export const VISUAL_GUIDE: string = guide;

/**
 * The sentences the backend refuses a visual with. They are written for the agent and repeat
 * nothing it sent, so they are passed on as they are; any other failure is Zorvo's own and is
 * not. A test keeps them equal to the Rust.
 */
export const VISUAL_REFUSALS: ReadonlySet<string> = new Set([
  'The visual is over 256 KB.',
  'The visual is not valid UTF-8 text.',
  'There is nothing to show in that visual.',
  'This session already has 100 visuals.',
  'Give the visual a title.',
  'Give show_visual either code or path, not both.',
  'Zorvo could not keep that visual.',
  "That is not an HTML file in this session's folder or the temporary folder.",
]);

/** What the webview is told when a visual's file is gone. Never sent to an agent. */
export const VISUAL_GONE = 'That visual is no longer available.';

/** What `show_visual` answers the agent on success. */
export const VISUAL_SHOWN_TEXT = '{"shown":true}';

export type VisualKind = 'svg' | 'html';

/** One visual as the backend keeps it. */
export interface VisualEntry {
  id: string;
  title: string;
  kind: VisualKind;
  bytes: number;
  shownAt: number;
}

export interface VisualRead {
  entry: VisualEntry;
  /** The whole document for the chat's frame: Zorvo's wrapper around the cleaned markup. */
  document: string;
}

const VISUAL_ID = /^v-[0-9a-f]{16}$/;

export function isVisualId(value: unknown): value is string {
  return typeof value === 'string' && VISUAL_ID.test(value);
}

export function isVisualKind(value: unknown): value is VisualKind {
  return value === 'svg' || value === 'html';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseVisualEntry(value: unknown): VisualEntry | null {
  if (!isObject(value)) return null;
  const { id, title, kind, bytes, shownAt } = value;
  if (!isVisualId(id) || typeof title !== 'string' || !isVisualKind(kind)) return null;
  if (typeof bytes !== 'number' || typeof shownAt !== 'number') return null;
  return { id, title, kind, bytes, shownAt };
}

export function parseVisualRead(value: unknown): VisualRead | null {
  if (!isObject(value) || typeof value.document !== 'string') return null;
  const entry = parseVisualEntry(value.entry);
  return entry ? { entry, document: value.document } : null;
}

/** The visuals a transcript names, once each, in the order they were shown. */
export function visualIdsOf(messages: readonly ChatMessage[]): string[] {
  const ids = messages.flatMap((message) => (message.parts ?? []).flatMap((part) => (part.kind === 'visual' ? [part.id] : [])));
  return [...new Set(ids)];
}
