import guide from './canvas-guide.md?raw';
import craft from './design-craft.md?raw';
import { codeSpan } from './artifact-comments';
import { escapeVisible } from './visible-text';

/** What `artifact_guide` answers for `kind: "canvas"`: how to lay out several screens, then how to design them well. */
export const CANVAS_GUIDE: string = guide + craft;

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
  /** How many artboards it had when last shown (or as read now, in a `CanvasRead`). */
  artboards: number;
  /** In `artifact_list` only, and only when true: the canvas's folder is gone. */
  folderGone?: boolean;
}

/** What the backend says when a canvas's folder, or the session folder it was shown from, is gone. A test keeps it equal to the Rust. */
export const FOLDER_NOT_FOUND = 'Folder not found';

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
  /** The design system's folder relative to the canvas folder, as `canvas.json` names it. */
  designSystem?: string;
}

export interface BoardState {
  id: string;
  /** The artboard's own key: a comment records it as its `fileHash`. */
  sha256: string | null;
  /** What its picture and live frame are keyed by; absent, or equal to `sha256`, when the canvas names no design system. */
  pictureKey?: string | null;
}

/** The key an artboard's picture and live frame go by. */
export function pictureKeyOf(board: BoardState): string | null {
  return board.pictureKey ?? board.sha256;
}

/** What a canvas read says about the design system its `canvas.json` names. */
export interface CanvasSystem {
  /** As `canvas.json` writes it. */
  path: string;
  key: string | null;
  themes: string[];
  isMissing: boolean;
  hidesDsFolder: boolean;
}

export interface CanvasRead {
  entry: CanvasEntry;
  canvas: Canvas | null;
  error: string | null;
  boards: BoardState[];
  designSystem?: CanvasSystem | null;
  /** The theme its picture keys are for, when it names a system. */
  theme?: string | null;
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
  const { key, folder, relative, title, shownAt, artboards, folderGone } = value;
  if (typeof key !== 'string' || !CANVAS_KEY.test(key)) return null;
  if (typeof folder !== 'string' || typeof relative !== 'string' || typeof title !== 'string' || !isCount(shownAt)) return null;
  if (artboards !== undefined && !isCount(artboards)) return null;
  const entry = { key, folder, relative, title, shownAt, artboards: artboards ?? 0 };
  return folderGone === true ? { ...entry, folderGone: true } : entry;
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
  const { title, sections, designSystem } = value;
  if (typeof title !== 'string' || !Array.isArray(sections)) return null;
  const parsed = sections.map(parseSection);
  if (parsed.some((section) => section === null)) return null;
  const canvas = { title, sections: parsed as CanvasSection[] };
  return typeof designSystem === 'string' ? { ...canvas, designSystem } : canvas;
}

function parseBoard(value: unknown): BoardState | null {
  if (!isObject(value)) return null;
  const { id, sha256, pictureKey } = value;
  if (typeof id !== 'string' || (sha256 !== null && typeof sha256 !== 'string')) return null;
  // Kept only when the backend sent one; without it pictures go by the artboard's own key (`pictureKeyOf`).
  return typeof pictureKey === 'string' ? { id, sha256, pictureKey } : { id, sha256 };
}

function parseCanvasSystem(value: unknown): CanvasSystem | null {
  if (!isObject(value)) return null;
  const { path, key, themes, isMissing, hidesDsFolder } = value;
  if (typeof path !== 'string' || typeof isMissing !== 'boolean' || typeof hidesDsFolder !== 'boolean') return null;
  if (key !== null && typeof key !== 'string') return null;
  const ids = Array.isArray(themes) ? themes.filter((theme): theme is string => typeof theme === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(theme)) : [];
  return { path, key, themes: ids, isMissing, hidesDsFolder };
}

/** The canvases in a backend list; anything that does not fit is dropped. */
export function parseCanvasEntries(value: unknown): CanvasEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = parseEntry(entry);
    return parsed === null ? [] : [parsed];
  });
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
  const designSystem = parseCanvasSystem(value.designSystem);
  const theme = typeof value.theme === 'string' && designSystem?.themes.includes(value.theme) ? value.theme : null;
  const read: CanvasRead = { entry, canvas, error, boards: parsed as BoardState[] };
  return designSystem === null ? read : { ...read, designSystem, ...(theme === null ? {} : { theme }) };
}

/** What the agent is told after a canvas was shown. */
export function canvasResultText(read: CanvasRead): string {
  const artboards = read.canvas ? artboardCount(read.canvas) : 0;
  return JSON.stringify({ shown: true, canvas: read.entry.key, artboards });
}

export function artboardCount(canvas: Canvas): number {
  return canvas.sections.reduce((total, section) => total + section.artboards.length, 0);
}

/** "Canvas · 12 artboards". */
export function canvasCountLabel(count: number): string {
  return `Canvas · ${count} ${count === 1 ? 'artboard' : 'artboards'}`;
}

const ORIGIN = 'zorvo-artifact://localhost/';

/** One path segment as the backend writes it: RFC 3986 unreserved characters kept, every other byte `%XX`. */
export function encodeSegment(segment: string): string {
  let out = '';
  for (const byte of new TextEncoder().encode(segment)) {
    const char = String.fromCharCode(byte);
    out += /[A-Za-z0-9\-._~]/.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** The URL of a canvas file, the same as `protocol.rs`'s `canvas_file_url` (a test compares them). */
export function canvasFileUrl(sessionId: string, key: string, relative: string): string {
  return `${ORIGIN}canvas/${sessionId}/${key}/f/${relative.split('/').map(encodeSegment).join('/')}`;
}

/** A file of a canvas that names a design system, in a theme: `protocol.rs`'s `canvas_themed_file_url`. */
export function canvasThemedFileUrl(sessionId: string, key: string, theme: string, relative: string): string {
  return `${ORIGIN}canvas/${sessionId}/${key}/t/${encodeSegment(theme)}/f/${relative.split('/').map(encodeSegment).join('/')}`;
}

/** The URL of an artboard's cached picture, the same as `protocol.rs`'s `thumb_url`. */
export function canvasThumbUrl(sha256: string): string {
  return `${ORIGIN}thumb/${sha256}.png`;
}

/** Hex characters of a file's hash in its URL: a changed artboard gets a new URL, so its frame loads once again. */
const VERSION_CHARS = 12;

/**
 * What the wrapper's `apply` takes, as JSON: the sections, each artboard with its file's URL (`v=` its
 * version, `b=` its id, since two artboards may show one file and a pick names the frame's; none, and
 * `missing`, when the file is gone), its picture when it has one, and the selection. The wrapper gets
 * keys and relative names only, never a path.
 */
export function canvasShellState(read: CanvasRead, sessionId: string, thumbs: ReadonlyMap<string, string>, selected?: string | null): string {
  // Pictures and frames follow the picture key, so a token or theme change reloads them.
  const hashes = new Map(read.boards.map((board) => [board.id, pictureKeyOf(board)]));
  const fileUrl = (file: string) =>
    !read.theme ? canvasFileUrl(sessionId, read.entry.key, file) : canvasThemedFileUrl(sessionId, read.entry.key, read.theme, file);
  const sections = read.canvas?.sections ?? [];
  const boards = sections.flatMap((section) =>
    section.artboards.map((board) => {
      const sha256 = hashes.get(board.id) ?? null;
      const thumb = thumbs.get(board.id);
      return {
        id: board.id,
        section: section.id,
        group: board.group,
        title: board.title,
        width: board.width,
        height: board.height,
        ...(sha256 === null
          ? { missing: true }
          : { url: `${fileUrl(board.file)}?v=${sha256.slice(0, VERSION_CHARS)}&b=${board.id}` }),
        ...(thumb === undefined ? {} : { thumb }),
      };
    }),
  );
  return JSON.stringify({
    sections: sections.map(({ id, title }) => ({ id, title })),
    boards,
    selected: selected ?? null,
  });
}

/** An artboard's file as the agent finds it: `folder` is the canvas folder relative to the session's folder. */
function boardPath(folder: string, board: CanvasArtboard): string {
  const base = folder.replace(/\/+$/, '');
  return codeSpan(escapeVisible(base === '' ? board.file : `${base}/${board.file}`));
}

const sizeOf = (board: CanvasArtboard): string => `${board.width} × ${board.height}`;

/** What Pick puts in the message box: keep this variant, drop the others of its group. */
export function pickMessage(canvas: Canvas, folder: string, board: CanvasArtboard): string {
  const group = board.group;
  const others =
    group === null
      ? []
      : canvas.sections.flatMap((section) => section.artboards).filter((other) => other.group === group && other.id !== board.id);
  const head = `Use variant ${escapeVisible(board.title)} (${boardPath(folder, board)}) from the ${escapeVisible(canvas.title)} canvas.`;
  if (others.length === 0 || group === null) return head;
  return `${head} Drop the other ${escapeVisible(group)} variants: ${others.map((other) => codeSpan(escapeVisible(other.file))).join(', ')}.`;
}

/** What Build this puts in the message box. */
export function buildMessage(folder: string, board: CanvasArtboard): string {
  return `Build the ${escapeVisible(board.title)} screen from ${boardPath(folder, board)} (${sizeOf(board)}) in this repository.`;
}

/** What Build section puts in the message box: the section's artboards, in order. */
export function buildSectionMessage(canvas: Canvas, folder: string, section: CanvasSection): string {
  const head = `Build the screens of the ${escapeVisible(section.title)} section of the ${escapeVisible(canvas.title)} canvas in this repository, in this order:`;
  const lines = section.artboards.map((board) => `- ${escapeVisible(board.title)}: ${boardPath(folder, board)} (${sizeOf(board)})`);
  return [head, ...lines].join('\n');
}

/** What `canvas_export` wrote: how many artboards, and the ids of those that could not be drawn. */
export interface ExportOutcome {
  written: number;
  failed: string[];
}

/** A `canvas_export` answer: null when the dialog was cancelled or the answer does not fit. */
export function parseExportOutcome(value: unknown): ExportOutcome | null {
  if (!isObject(value)) return null;
  const { written, failed } = value;
  if (typeof written !== 'number' || !Number.isInteger(written) || written < 0) return null;
  if (!Array.isArray(failed) || failed.some((id) => typeof id !== 'string')) return null;
  return { written, failed: failed as string[] };
}

/** "Exported 3 artboards.", or with the artboards that could not be drawn named by title. */
export function exportNotice(outcome: ExportOutcome, canvas: Canvas | null): { message: string; tone: 'info' | 'warning' } {
  const exported = `Exported ${outcome.written} ${outcome.written === 1 ? 'artboard' : 'artboards'}.`;
  if (outcome.failed.length === 0) return { message: exported, tone: 'info' };
  const boards = canvas?.sections.flatMap((section) => section.artboards) ?? [];
  const names = outcome.failed.map((id) => boards.find((board) => board.id === id)?.title ?? id);
  return { message: `${exported} ${outcome.failed.length} could not be drawn: ${names.join(', ')}.`, tone: 'warning' };
}
