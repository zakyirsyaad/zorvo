import guide from './canvas-guide.md?raw';

/** What `artifact_guide` answers for `kind: "canvas"`: how to lay out several screens. */
export const CANVAS_GUIDE: string = guide;

/**
 * The sentences the backend refuses a canvas with that name no path and repeat nothing the agent
 * sent. A parse error (`<field>: <rule>`) is passed on too, but is not listed: it names a field.
 * A test keeps these equal to the Rust.
 */
export const CANVAS_REFUSALS: ReadonlySet<string> = new Set([
  'The canvas must be a folder with a canvas.json inside this folder.',
  'This session already has 50 canvases. The user can remove one in Zorvo.',
]);

export interface CanvasEntry {
  key: string;
  folder: string;
  relative: string;
  title: string;
  shownAt: number;
}

export interface CanvasArtboard {
  id: string;
  title: string;
  file: string;
  width: number;
  height: number;
  group: string | null;
}

export interface CanvasSection {
  id: string;
  title: string;
  artboards: CanvasArtboard[];
}

export interface Canvas {
  title: string;
  sections: CanvasSection[];
}

export interface BoardState {
  id: string;
  sha256: string | null;
}

export interface CanvasRead {
  entry: CanvasEntry;
  canvas: Canvas | null;
  error: string | null;
  boards: BoardState[];
}

const CANVAS_KEY = /^c-[0-9a-f]{16}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function parseEntry(value: unknown): CanvasEntry | null {
  if (!isObject(value)) return null;
  const { key, folder, relative, title, shownAt } = value;
  if (typeof key !== 'string' || !CANVAS_KEY.test(key)) return null;
  if (typeof folder !== 'string' || typeof relative !== 'string' || typeof title !== 'string' || !isCount(shownAt)) return null;
  return { key, folder, relative, title, shownAt };
}

function parseArtboard(value: unknown): CanvasArtboard | null {
  if (!isObject(value)) return null;
  const { id, title, file, width, height, group } = value;
  if (typeof id !== 'string' || typeof title !== 'string' || typeof file !== 'string') return null;
  if (!isCount(width) || !isCount(height)) return null;
  if (group !== null && group !== undefined && typeof group !== 'string') return null;
  return { id, title, file, width, height, group: group ?? null };
}

function parseSection(value: unknown): CanvasSection | null {
  if (!isObject(value)) return null;
  const { id, title, artboards } = value;
  if (typeof id !== 'string' || typeof title !== 'string' || !Array.isArray(artboards)) return null;
  const boards = artboards.map(parseArtboard);
  if (boards.some((board) => board === null)) return null;
  return { id, title, artboards: boards as CanvasArtboard[] };
}

function parseCanvas(value: unknown): Canvas | null {
  if (!isObject(value)) return null;
  const { title, sections } = value;
  if (typeof title !== 'string' || !Array.isArray(sections)) return null;
  const parsed = sections.map(parseSection);
  if (parsed.some((section) => section === null)) return null;
  return { title, sections: parsed as CanvasSection[] };
}

function parseBoard(value: unknown): BoardState | null {
  if (!isObject(value)) return null;
  const { id, sha256 } = value;
  if (typeof id !== 'string' || (sha256 !== null && typeof sha256 !== 'string')) return null;
  return { id, sha256 };
}

/** A backend canvas answer, or null when it does not fit. */
export function parseCanvasRead(value: unknown): CanvasRead | null {
  if (!isObject(value)) return null;
  const entry = parseEntry(value.entry);
  const canvas = value.canvas === null ? null : parseCanvas(value.canvas);
  const { error, boards } = value;
  if (entry === null || (value.canvas !== null && canvas === null)) return null;
  if (error !== null && typeof error !== 'string') return null;
  if (!Array.isArray(boards)) return null;
  const parsed = boards.map(parseBoard);
  if (parsed.some((board) => board === null)) return null;
  return { entry, canvas, error, boards: parsed as BoardState[] };
}

/** What the agent is told after a canvas was shown. */
export function canvasResultText(read: CanvasRead): string {
  const artboards = read.canvas?.sections.reduce((total, section) => total + section.artboards.length, 0) ?? 0;
  return JSON.stringify({ shown: true, canvas: read.entry.key, artboards });
}
