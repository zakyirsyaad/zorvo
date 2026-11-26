import type { ArtifactAnchor, DesignSystemTarget } from '../types';

/**
 * A `ds-pick` payload, checked again here: what the design system on screen reported, a token, a
 * component (whole, or an element or text in its preview) or a passage of the brand book.
 */
export interface DsPick {
  sessionId: string;
  key: string;
  target: DesignSystemTarget;
  anchor: ArtifactAnchor;
}

const KEY = /^d-[0-9a-f]{16}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const MAX_QUOTE = 1000;
const MAX_CONTEXT = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const within = (value: unknown, limit: number): value is string => typeof value === 'string' && [...value].length <= limit;

function targetOf(raw: unknown): DesignSystemTarget | null {
  if (!isRecord(raw)) return null;
  if ((raw.kind === 'token' || raw.kind === 'component') && typeof raw.name === 'string' && NAME.test(raw.name)) return { kind: raw.kind, name: raw.name };
  if (raw.kind === 'section' && typeof raw.file === 'string' && raw.file.endsWith('.md') && !raw.file.startsWith('/') && !raw.file.split('/').includes('..')) {
    return { kind: 'section', file: raw.file };
  }
  return null;
}

function anchorOf(raw: unknown, target: DesignSystemTarget): ArtifactAnchor | null {
  if (raw === undefined) return target.kind === 'section' ? null : { kind: 'system' };
  if (!isRecord(raw)) return null;
  if (raw.kind === 'pick-text') {
    const { quote, before, after } = raw;
    if (!within(quote, MAX_QUOTE) || quote === '' || !within(before, MAX_CONTEXT) || !within(after, MAX_CONTEXT)) return null;
    return { kind: 'text', quote, before, after };
  }
  if (raw.kind === 'pick-element' && target.kind === 'component') {
    const { tag, classes, text, path, elementId, label } = raw;
    if (typeof tag !== 'string' || !Array.isArray(classes) || typeof text !== 'string' || typeof path !== 'string') return null;
    return {
      kind: 'element',
      tag,
      classes: classes.filter((name): name is string => typeof name === 'string'),
      text,
      path,
      ...(typeof elementId === 'string' ? { elementId } : {}),
      ...(typeof label === 'string' ? { label } : {}),
    };
  }
  return null;
}

export function parseDsPick(payload: unknown): DsPick | null {
  if (!isRecord(payload)) return null;
  const { sessionId, key } = payload;
  if (typeof sessionId !== 'string' || sessionId === '' || typeof key !== 'string' || !KEY.test(key)) return null;
  const target = targetOf(payload.target);
  if (target === null) return null;
  const anchor = anchorOf(payload.message, target);
  return anchor && { sessionId, key, target, anchor };
}

/** A `ds-pick` payload that is a preview's cancel (Escape), with the system it came from. */
export function parseDsCancel(payload: unknown): { sessionId: string; key: string } | null {
  if (!isRecord(payload) || !isRecord(payload.message) || payload.message.kind !== 'cancel') return null;
  const { sessionId, key } = payload;
  if (typeof sessionId !== 'string' || sessionId === '' || typeof key !== 'string' || !KEY.test(key)) return null;
  return { sessionId, key };
}
