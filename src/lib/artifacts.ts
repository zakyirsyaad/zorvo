import type { Artifact, ArtifactCard, ArtifactVersion, Session } from '../types';
import type { CanvasEntry } from './canvas';
import { isArchived } from './session-helpers';
import guide from './artifact-guide.md?raw';

/** What `artifact_guide` answers: how to make a page that reads well in Zorvo. */
export const ARTIFACT_GUIDE: string = guide;

/**
 * The sentences the backend refuses a page with. They are written for the
 * agent and repeat nothing it sent, so they are passed on as they are; any
 * other failure is Zorvo's own and is not. A test keeps them equal to the Rust.
 */
export const ARTIFACT_REFUSALS: ReadonlySet<string> = new Set([
  'Give the page a title the first time you show it.',
  'This session already has 50 pages. The user can delete one in Zorvo.',
  "That is not an HTML file in this session's folder or the temporary folder.",
  'The page is over 16 MB.',
  'The page is not valid UTF-8 text.',
]);

/** What `artifact_show` answers: the artifact as it now is and the version to display. */
export interface ShownArtifact {
  artifact: Artifact;
  version: number;
  isNewArtifact: boolean;
  isNewVersion: boolean;
}

/** The artifact the viewer shows (a `version` of null follows the newest), or a canvas. */
export type ViewedArtifact =
  | { artifactId: string; version: number | null; canvasKey?: undefined }
  | { canvasKey: string; artifactId?: undefined; version?: undefined };

const ARTIFACT_ID = /^a-[0-9a-f]{16}$/;
const CANVAS_KEY = /^c-[0-9a-f]{16}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function isArtifactId(value: unknown): value is string {
  return typeof value === 'string' && ARTIFACT_ID.test(value);
}

function toVersion(value: unknown): ArtifactVersion | null {
  if (!isObject(value)) return null;
  const { n, at, bytes } = value;
  if (!isCount(n) || n === 0 || !isCount(at) || !isCount(bytes)) return null;
  return { n, at, bytes };
}

function toArtifact(value: unknown): Artifact | null {
  if (!isObject(value)) return null;
  const { id, title, sourcePath, versions } = value;
  if (!isArtifactId(id) || typeof title !== 'string' || typeof sourcePath !== 'string' || !Array.isArray(versions)) return null;
  const parsed = versions.map(toVersion);
  if (parsed.length === 0 || parsed.some((version) => version === null)) return null;
  return { id, title, sourcePath, versions: parsed as ArtifactVersion[] };
}

/** The artifacts in a backend answer; anything that does not fit is dropped. */
export function parseArtifacts(value: unknown): Artifact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const artifact = toArtifact(entry);
    return artifact === null ? [] : [artifact];
  });
}

export function parseShown(value: unknown): ShownArtifact | null {
  if (!isObject(value)) return null;
  const artifact = toArtifact(value.artifact);
  const { version, isNewArtifact, isNewVersion } = value;
  if (artifact === null || typeof isNewArtifact !== 'boolean' || typeof isNewVersion !== 'boolean') return null;
  if (!isCount(version) || !hasVersion(artifact, version)) return null;
  return { artifact, version, isNewArtifact, isNewVersion };
}

/** A card saved in a transcript, or null when it does not fit. */
export function parseArtifactCard(value: unknown): ArtifactCard | null {
  if (!isObject(value)) return null;
  if (value.kind === 'canvas') {
    const { canvasKey, title, artboards } = value;
    if (typeof canvasKey !== 'string' || !CANVAS_KEY.test(canvasKey) || typeof title !== 'string' || !isCount(artboards)) return null;
    return { kind: 'canvas', canvasKey, title, artboards };
  }
  const { artifactId, title, version } = value;
  if (!isArtifactId(artifactId) || typeof title !== 'string' || !isCount(version) || version === 0) return null;
  return { artifactId, title, version };
}

export function newestVersion(artifact: Artifact): number {
  return artifact.versions.reduce((newest, version) => Math.max(newest, version.n), 0);
}

function newestAt(artifact: Artifact): number {
  return artifact.versions.reduce((newest, version) => Math.max(newest, version.at), 0);
}

/** "Version 3 of 5": the second number is the newest, since older versions are pruned. */
export function versionLabel(version: number, artifact: Artifact): string {
  return `Version ${version} of ${newestVersion(artifact)}`;
}

/** The artifact the viewer shows: the one viewed, else the only one, else none (the list shows). */
export function shownArtifactOf(
  artifacts: readonly Artifact[],
  viewed: ViewedArtifact | null,
  /** Other rows the Output tab lists (the files the agent made): with any, a single page waits in the list. */
  otherRows = 0,
): Artifact | undefined {
  if (viewed) return artifacts.find((artifact) => artifact.id === viewed.artifactId);
  return artifacts.length === 1 && otherRows === 0 ? artifacts[0] : undefined;
}

export function hasVersion(artifact: Artifact | undefined, version: number): boolean {
  return artifact !== undefined && artifact.versions.some((listed) => listed.n === version);
}

/** What the agent is told after a page was shown. */
export function shownResultText(shown: ShownArtifact): string {
  return JSON.stringify({ title: shown.artifact.title, version: shown.version, shown: true });
}

/**
 * What the window does when an agent shows a page: a new artifact in the
 * session on screen shows the tab, a new version replaces the page only while
 * the viewer follows that artifact's newest, and nothing else moves.
 */
export function openingFor(input: {
  isOnScreen: boolean;
  shown: ShownArtifact;
  viewed: ViewedArtifact | null;
}): 'show-tab' | 'replace' | 'none' {
  if (!input.isOnScreen) return 'none';
  if (input.shown.isNewArtifact) return 'show-tab';
  const followsNewest = input.viewed?.artifactId === input.shown.artifact.id && input.viewed.version === null;
  return followsNewest ? 'replace' : 'none';
}

/**
 * What the window does when an agent shows a canvas: one of the session on screen opens in the tab,
 * unless it is the one shown already (its viewer reads it again by itself).
 */
export function canvasOpeningFor(input: { isOnScreen: boolean; key: string; viewed: ViewedArtifact | null }): 'show-tab' | 'none' {
  if (!input.isOnScreen || input.viewed?.canvasKey === input.key) return 'none';
  return 'show-tab';
}

/** The id a card names: an artifact's id or a canvas's key (they never look alike). */
export function cardIdOf(card: ArtifactCard): string {
  return card.kind === 'canvas' ? card.canvasKey : card.artifactId;
}

export function cardState(card: ArtifactCard, artifacts: readonly Artifact[]): 'open' | 'removed' {
  return artifacts.some((artifact) => artifact.id === cardIdOf(card)) ? 'open' : 'removed';
}

interface GalleryRowBase {
  sessionId: string;
  sessionName: string;
  /** The session's agent, for its logo. */
  profileId: string;
  agentName: string;
  isArchived: boolean;
  /** When its newest version (or the canvas) was shown. */
  at: number;
}

/** One line of the gallery: an artifact or a canvas, with the session it belongs to. */
export type GalleryRow = GalleryRowBase & ({ kind?: 'page'; artifact: Artifact } | { kind: 'canvas'; canvas: CanvasEntry });

export function rowTitle(row: GalleryRow): string {
  return row.kind === 'canvas' ? row.canvas.title : row.artifact.title;
}

/** Every listed session's artifacts and canvases, the most recently changed first. */
export function galleryRows(
  sessions: readonly Session[],
  bySession: ReadonlyMap<string, readonly Artifact[]>,
  agentNameOf: (profileId: string) => string,
  canvasesBySession: ReadonlyMap<string, readonly CanvasEntry[]> = new Map(),
): GalleryRow[] {
  return sessions
    .flatMap((session): GalleryRow[] => {
      const base = {
        sessionId: session.id,
        sessionName: session.name,
        profileId: session.profileId,
        agentName: agentNameOf(session.profileId),
        isArchived: isArchived(session),
      };
      const pages = (bySession.get(session.id) ?? []).map((artifact) => ({ ...base, artifact, at: newestAt(artifact) }));
      const canvases = (canvasesBySession.get(session.id) ?? []).map((canvas) => ({ ...base, kind: 'canvas' as const, canvas, at: canvas.shownAt }));
      return [...pages, ...canvases];
    })
    .sort((a, b) => b.at - a.at);
}

export function filterGallery(rows: readonly GalleryRow[], query: string): GalleryRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...rows];
  return rows.filter((row) => rowTitle(row).toLowerCase().includes(needle));
}
