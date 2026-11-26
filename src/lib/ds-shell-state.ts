import type { DesignSystemRead, DsFont, DsTokens } from './design-system-read';
import { encodeSegment } from './canvas';

/**
 * What the design system shell's `apply` takes, as JSON (`ds_view_apply`). The shell gets keys,
 * values and URLs only, never a path, and never the system's `tokens.css`: its token names would
 * overwrite the shell's own variables, so swatches and samples carry their values here.
 */

const ORIGIN = 'zorvo-artifact://localhost/';
/** The most `ds_view_apply` takes; Rust refuses more. */
export const MAX_SHELL_STATE_BYTES = 1024 * 1024;
const DIGEST_CHARS = 12;
const FONT_EXTENSIONS = /\.(woff2|woff|ttf|otf)$/i;
const FONT_STYLES = new Set(['normal', 'italic', 'oblique']);
const DEFAULT_WEIGHT = 400;
/** What may not reach a `style` attribute from a project's tokens. */
const UNSAFE_CSS = /[;{}<>\\]|url\(|expression\(|@import/i;

export function dsShellUrl(sessionId: string, key: string): string {
  return `${ORIGIN}ds/${sessionId}/${key}/`;
}

/** A system file's URL for a theme, as `ds_protocol.rs`'s `ds_file_url` builds it. */
export function dsFileUrl(sessionId: string, key: string, theme: string, relative: string): string {
  return `${dsShellUrl(sessionId, key)}t/${encodeSegment(theme)}/f/${relative.split('/').map(encodeSegment).join('/')}`;
}

function safeCss(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' && !UNSAFE_CSS.test(value) ? value : null;
}

/** `@font-face` rules for the type samples, their URLs relative to the shell. */
function fontCss(fonts: readonly DsFont[], theme: string): string {
  return fonts
    .flatMap((font) => {
      const rest = font.file?.startsWith('fonts/') ? font.file.slice('fonts/'.length) : null;
      if (!rest || !FONT_EXTENSIONS.test(rest)) return [];
      const segments = rest.split('/');
      if (segments.some((s) => s === '' || s === '.' || s === '..' || s.includes('\\'))) return [];
      if (font.family.trim() === '' || /["\\;{}<]/.test(font.family) || /\p{Cc}/u.test(font.family)) return [];
      const url = `t/${encodeSegment(theme)}/f/fonts/${segments.map(encodeSegment).join('/')}`;
      const style = font.style && FONT_STYLES.has(font.style) ? font.style : 'normal';
      return [
        `@font-face { font-family: "${font.family}"; src: url("${url}"); font-weight: ${font.weight ?? DEFAULT_WEIGHT}; font-style: ${style}; }`,
      ];
    })
    .join('\n');
}

function valuesIn(tokens: DsTokens | null, family: string, at: number) {
  return (tokens?.tokens ?? [])
    .filter((token) => token.family === family)
    .map((token) => ({ name: token.name, value: token.values[at] ?? token.values[0] ?? '', usage: token.usage }));
}

function typeStyles(tokens: DsTokens | null) {
  const families = new Map(tokens?.families ?? []);
  return (tokens?.styles ?? []).map((style) => {
    const stack = style.family ? safeCss(families.get(style.family)) : null;
    const parts = [
      ...(stack ? [`font-family: ${stack}`] : []),
      ...(safeCss(style.fontSize) ? [`font-size: ${style.fontSize}`] : []),
      ...(safeCss(style.lineHeight) ? [`line-height: ${style.lineHeight}`] : []),
      `font-weight: ${style.fontWeight}`,
      ...(safeCss(style.letterSpacing) ? [`letter-spacing: ${style.letterSpacing}`] : []),
    ];
    return { group: style.group, name: style.name, css: parts.join('; '), ...(style.family ? { family: style.family } : {}) };
  });
}

/**
 * The shell's state for one theme. When the JSON would pass `maxBytes`, the last sections are left
 * out one by one and `sectionsCut` says so, so the shell always gets valid JSON.
 */
export function dsShellState(
  read: DesignSystemRead,
  sessionId: string,
  theme: string,
  notes: readonly string[],
  maxBytes: number = MAX_SHELL_STATE_BYTES,
): string {
  const content = read.content;
  const key = read.entry.key;
  const tokens = content?.tokens ?? null;
  const themes = tokens?.themes ?? [{ id: theme, name: theme }];
  const at = Math.max(0, themes.findIndex((item) => item.id === theme));
  const digest = (content?.digest ?? '').slice(0, DIGEST_CHARS);
  const fileUrl = (relative: string) => dsFileUrl(sessionId, key, theme, relative);
  const base = {
    title: content?.index.title ?? read.entry.title,
    theme,
    themes,
    sectionsCut: false,
    colours: valuesIn(tokens, 'color', at).map(({ name, value, usage }) => ({ name, value, ...(usage ? { usage } : {}) })),
    type: typeStyles(tokens),
    spacing: valuesIn(tokens, 'spacing', at).map(({ name, value }) => ({ name, value })),
    radius: valuesIn(tokens, 'radius', at).map(({ name, value }) => ({ name, value })),
    shadow: valuesIn(tokens, 'shadow', at).map(({ name, value }) => ({ name, value })),
    components: (content?.components ?? []).map((component) => ({
      name: component.name,
      group: component.group,
      height: component.height ?? 120,
      url: component.previewHash
        ? `${fileUrl(`components/${component.name}/preview.html`)}?v=${component.previewHash}&d=${digest}`
        : null,
    })),
    assets: (content?.assets ?? []).map((asset) => ({
      group: asset.group,
      file: asset.file,
      kind: asset.kind,
      url: asset.isMissing ? null : fileUrl(asset.file),
      size: asset.size,
    })),
    fonts: (content?.fonts ?? []).map((font) => ({ family: font.file.split('/').pop() ?? font.file, file: font.file, url: font.isMissing ? null : fileUrl(font.file) })),
    fontCss: fontCss(tokens?.fonts ?? [], theme),
    googleFontsUrl: read.googleFontsUrl,
    notes: [...notes],
    ownMarks: { tokens: {}, components: {}, sections: {} },
  };
  const sections = (content?.sections ?? []).map((section, index) => ({ id: `s-${index}`, title: section.title, html: section.html }));
  for (let kept = sections.length; kept >= 0; kept -= 1) {
    const json = JSON.stringify({ ...base, sections: sections.slice(0, kept), sectionsCut: kept < sections.length });
    if (new TextEncoder().encode(json).length <= maxBytes || kept === 0) return json;
  }
  return JSON.stringify({ ...base, sections: [], sectionsCut: sections.length > 0 });
}
