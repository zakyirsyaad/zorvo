import type { VisualKind } from './visuals';

export type VisualAction = 'copy' | 'svg' | 'html' | 'png';

export interface VisualMenuItem {
  id: VisualAction;
  label: string;
}

/** What a visual's menu offers: a copy, its own markup, and a picture. */
export function menuItemsFor(kind: VisualKind): VisualMenuItem[] {
  return [
    { id: 'copy', label: 'Copy as image' },
    kind === 'svg' ? { id: 'svg', label: 'Download as SVG' } : { id: 'html', label: 'Download as HTML' },
    { id: 'png', label: 'Download as PNG' },
  ];
}

/** The theme a picture is drawn in: the one on screen now. */
export function themeNow(): 'dark' | 'light' {
  const isLight = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches;
  return isLight ? 'light' : 'dark';
}

/** The size the backend draws at: whole pixels, inside the bounds it accepts. */
export function drawnSize(size: { width: number; height: number }): { width: number; height: number } {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));
  return { width: clamp(size.width, 200, 2000), height: clamp(size.height, 1, 8000) };
}

export const VISUAL_SAVED = 'Saved.';
export const VISUAL_COPIED = 'Copied as an image.';
export const VISUAL_SAVE_FAILED = 'Zorvo could not save that visual.';
export const VISUAL_COPY_FAILED = 'Zorvo could not copy that visual.';
