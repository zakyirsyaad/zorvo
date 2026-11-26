/**
 * What `ds_read` and `design_system_show` answer: a remembered design system and what Rust read
 * from its folder (`ds_content.rs`). Every field is checked here, since the folder is the
 * project's and the shape crosses IPC.
 */

export interface DesignSystemEntry {
  key: string;
  folder: string;
  relative: string;
  title: string;
  tokens: number;
  components: number;
  shownAt: number;
}

export interface DsTheme {
  id: string;
  name: string;
}

export interface DsToken {
  family: string;
  name: string;
  /** One value per theme, in `themes` order. */
  values: string[];
  usage: string | null;
  hash: string;
}

export interface DsFont {
  family: string;
  file: string | null;
  weight: number | null;
  style: string | null;
}

export interface DsTypeStyle {
  group: string;
  name: string;
  fontSize: string;
  lineHeight: string;
  fontWeight: number;
  letterSpacing: string | null;
  family: string | null;
}

export interface DsDroppedToken {
  family: string;
  name: string;
  reason: string;
}

export type DsSource = { kind: 'code'; paths: string[]; commit: string | null } | { kind: 'references'; files: string[] };

export interface DsTokens {
  themes: DsTheme[];
  tokens: DsToken[];
  fonts: DsFont[];
  families: [string, string][];
  styles: DsTypeStyle[];
  dropped: DsDroppedToken[];
  source: DsSource | null;
}

export interface DsSection {
  file: string;
  title: string;
  html: string;
  hash: string;
}

export interface DsComponent {
  name: string;
  group: string | null;
  height: number | null;
  hasReadme: boolean;
  previewHash: string | null;
}

export interface DsAsset {
  group: string;
  file: string;
  kind: string;
  size: number | null;
  isMissing: boolean;
}

export interface DsIndex {
  title: string;
  namespace: string | null;
  libraries: string[];
  assetGroupOrder: string[];
  isDefault: boolean;
}

export interface DsContent {
  index: DsIndex;
  tokens: DsTokens | null;
  tokensError: string | null;
  sections: DsSection[];
  components: DsComponent[];
  assets: DsAsset[];
  fonts: DsAsset[];
  digest: string;
}

export interface DesignSystemRead {
  entry: DesignSystemEntry;
  content: DsContent | null;
  error: string | null;
  googleFontsUrl: string | null;
}

const DS_KEY = /^d-[0-9a-f]{16}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const optional = <T>(value: unknown, check: (item: unknown) => item is T): T | null => (check(value) ? value : null);
const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter(isString) : []);

/** Keeps the items that parse; an item of the wrong shape is left out, never the whole list. */
function each<T>(value: unknown, parse: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.map(parse).filter((item): item is T => item !== null);
}

export function parseDesignSystemEntry(value: unknown): DesignSystemEntry | null {
  if (!isRecord(value)) return null;
  const { key, folder, relative, title, tokens, components, shownAt } = value;
  if (!isString(key) || !DS_KEY.test(key) || !isString(folder) || !isString(relative) || !isString(title)) return null;
  if (!isNumber(tokens) || !isNumber(components) || !isNumber(shownAt)) return null;
  return { key, folder, relative, title, tokens, components, shownAt };
}

function parseToken(value: unknown): DsToken | null {
  if (!isRecord(value)) return null;
  const { family, name, values, usage, hash } = value;
  if (!isString(family) || !isString(name) || !isString(hash) || !Array.isArray(values) || !values.every(isString)) return null;
  return { family, name, values, usage: optional(usage, isString), hash };
}

function parseFont(value: unknown): DsFont | null {
  if (!isRecord(value) || !isString(value.family)) return null;
  return {
    family: value.family,
    file: optional(value.file, isString),
    weight: optional(value.weight, isNumber),
    style: optional(value.style, isString),
  };
}

function parseStyle(value: unknown): DsTypeStyle | null {
  if (!isRecord(value)) return null;
  const { group, name, fontSize, lineHeight, fontWeight } = value;
  if (!isString(group) || !isString(name) || !isString(fontSize) || !isString(lineHeight) || !isNumber(fontWeight)) return null;
  return {
    group,
    name,
    fontSize,
    lineHeight,
    fontWeight,
    letterSpacing: optional(value.letterSpacing, isString),
    family: optional(value.family, isString),
  };
}

function parseSource(value: unknown): DsSource | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'code') return { kind: 'code', paths: stringList(value.paths), commit: optional(value.commit, isString) };
  if (value.kind === 'references') return { kind: 'references', files: stringList(value.files) };
  return null;
}

function parseTokens(value: unknown): DsTokens | null {
  if (!isRecord(value)) return null;
  const themes = each(value.themes, (item) =>
    isRecord(item) && isString(item.id) && isString(item.name) ? { id: item.id, name: item.name } : null,
  );
  if (themes.length === 0) return null;
  const families = each(value.families, (item) =>
    Array.isArray(item) && item.length === 2 && isString(item[0]) && isString(item[1]) ? ([item[0], item[1]] as [string, string]) : null,
  );
  const dropped = each(value.dropped, (item) =>
    isRecord(item) && isString(item.family) && isString(item.name) && isString(item.reason)
      ? { family: item.family, name: item.name, reason: item.reason }
      : null,
  );
  return {
    themes,
    tokens: each(value.tokens, parseToken).filter((token) => token.values.length === themes.length),
    fonts: each(value.fonts, parseFont),
    families,
    styles: each(value.styles, parseStyle),
    dropped,
    source: parseSource(value.source),
  };
}

function parseAsset(value: unknown): DsAsset | null {
  if (!isRecord(value)) return null;
  const { group, file, kind, isMissing } = value;
  if (!isString(group) || !isString(file) || !isString(kind) || typeof isMissing !== 'boolean') return null;
  return { group, file, kind, size: optional(value.size, isNumber), isMissing };
}

function parseContent(value: unknown): DsContent | null {
  if (!isRecord(value) || !isRecord(value.index) || !isString(value.digest)) return null;
  const index = value.index;
  if (!isString(index.title) || typeof index.isDefault !== 'boolean') return null;
  return {
    index: {
      title: index.title,
      namespace: optional(index.namespace, isString),
      libraries: stringList(index.libraries),
      assetGroupOrder: stringList(index.assetGroupOrder),
      isDefault: index.isDefault,
    },
    tokens: parseTokens(value.tokens),
    tokensError: optional(value.tokensError, isString),
    sections: each(value.sections, (item) =>
      isRecord(item) && isString(item.file) && isString(item.title) && isString(item.html) && isString(item.hash)
        ? { file: item.file, title: item.title, html: item.html, hash: item.hash }
        : null,
    ),
    components: each(value.components, (item) =>
      isRecord(item) && isString(item.name) && typeof item.hasReadme === 'boolean'
        ? {
            name: item.name,
            group: optional(item.group, isString),
            height: optional(item.height, isNumber),
            hasReadme: item.hasReadme,
            previewHash: optional(item.previewHash, isString),
          }
        : null,
    ),
    assets: each(value.assets, parseAsset),
    fonts: each(value.fonts, parseAsset),
    digest: value.digest,
  };
}

/** What `ds_read` answered; `null` when its entry does not parse. */
export function parseDesignSystemRead(value: unknown): DesignSystemRead | null {
  if (!isRecord(value)) return null;
  const entry = parseDesignSystemEntry(value.entry);
  if (!entry) return null;
  return {
    entry,
    content: value.content === null || value.content === undefined ? null : parseContent(value.content),
    error: optional(value.error, isString),
    googleFontsUrl: optional(value.googleFontsUrl, isString),
  };
}
