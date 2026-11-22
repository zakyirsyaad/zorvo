/** The window event a file link in a reply sends; the main window's session answers it. */
export const FILE_LINK_OPEN = 'zorvo:file-link-open';

/** A link that names a scheme: `https:`, `mailto:`, `vscode:`. A Windows drive letter is not one. */
const SCHEME = /^[a-z][a-z0-9+.-]+:/i;
/** A line (and column) an agent puts after a path: `src/a.ts:12`, `src/a.ts:12:3`, `src/a.ts#L12`. */
const POSITION = /(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?(?:C\d+)?)$/;
/** A control character, which no path a person reads holds. */
const hasControl = (text: string) => [...text].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f);

function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * The file a reply's link points at, or null when the link is not to a file: a path as the agent
 * wrote it (absolute, under the home folder as `~/…`, or relative), without its line and without a
 * `file://` prefix. A link with any other scheme, an anchor alone, or a control character is not one.
 */
export function fileLinkPath(href: string | undefined): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  const isFileUrl = /^file:\/\//i.test(trimmed);
  if (!isFileUrl && SCHEME.test(trimmed)) return null;
  const raw = isFileUrl ? trimmed.replace(/^file:\/\/(localhost)?/i, '') : trimmed;
  const path = decoded(raw.replace(/[?].*$/, '')).replace(POSITION, '');
  if (path === '' || path.startsWith('#') || hasControl(path)) return null;
  if (isFileUrl && !path.startsWith('/')) return null;
  return path;
}

/** `path` with its `.` and `..` parts worked out, as text: nothing is read from disk. */
function normalized(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

/** Where a file link goes: the file viewer, for a file inside the folder the Files tab shows, or the file manager. */
export type FileLinkTarget =
  | { kind: 'view'; relative: string }
  | { kind: 'reveal'; path: string }
  | { kind: 'unknown' };

/**
 * Decides where `path` opens. A relative path is read against `folder`, the folder the Files tab
 * shows; without one it cannot be placed. A path under the home folder is left for the backend,
 * which knows where home is.
 */
export function fileLinkTarget(path: string, folder: string | undefined): FileLinkTarget {
  if (path.startsWith('~/')) return { kind: 'reveal', path };
  const root = folder ? normalized(folder) : undefined;
  if (!path.startsWith('/') && root === undefined) return { kind: 'unknown' };
  const absolute = normalized(path.startsWith('/') ? path : `${root}/${path}`);
  if (root !== undefined && root !== '/' && absolute.startsWith(`${root}/`)) {
    return { kind: 'view', relative: absolute.slice(root.length + 1) };
  }
  return { kind: 'reveal', path: absolute };
}

/** Asks the main window to open the file a link in a reply points at. */
export function requestFileLinkOpen(path: string): void {
  window.dispatchEvent(new CustomEvent(FILE_LINK_OPEN, { detail: { path } }));
}
