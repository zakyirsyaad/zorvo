import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import tokens from '../../docs/design-system/tokens.json';

// Vitest empties CSS imports, `?raw` included, so the fixture is read from disk.
const fixture = readFileSync(
  join(__dirname, '..', '..', 'src-tauri', 'tests', 'fixtures', 'ds-zorvo-tokens.css'),
  'utf8',
);

/**
 * Rust builds `tokens.css` for a design system's previews; the reference's own viewer builds
 * the same variables with `themeCss`. Every declaration `themeCss` makes for a theme must be
 * in Rust's rule for that theme. Rust also declares `motion`, so this is a subset check.
 */
type ThemeCss = (tokens: unknown) => string;
let themeCss: ThemeCss;

beforeAll(async () => {
  // jsdom has no `CSS.escape`; this stub escapes what token names hold.
  globalThis.CSS = {
    escape: (s: string) =>
      s.replace(/^(\d)/, (d) => `\\3${d} `).replace(/[^A-Za-z0-9_\\ -]/g, (c) => `\\${c}`),
  } as typeof CSS;
  const module = await import('../../docs/design-system/viewer/tokens-css');
  themeCss = module.themeCss as ThemeCss;
});

interface Rule {
  selectors: string[];
  body: string;
}

function rules(text: string): Rule[] {
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: match[1].split(',').map((selector) => selector.trim()),
    body: match[2],
  }));
}

function ruleFor(text: string, theme: string): Rule {
  const rule = rules(text).find((r) => r.selectors.includes(`[data-theme="${theme}"]`));
  if (!rule) throw new Error(`no rule for ${theme}`);
  return rule;
}

function declarations(body: string): string[] {
  return [...body.matchAll(/--[^:;\s]+:[^;]*;/g)].map((match) => match[0].trim());
}

describe("Rust's tokens.css", () => {
  it.each(['dark', 'light'])('holds every themeCss declaration for %s', (theme) => {
    const expected = declarations(ruleFor(themeCss(tokens), theme).body);
    const actual = declarations(ruleFor(fixture, theme).body);
    expect(expected.length).toBeGreaterThan(40);
    expect(expected.filter((declaration) => !actual.includes(declaration))).toEqual([]);
  });

  it('declares motion too', () => {
    expect(declarations(ruleFor(fixture, 'dark').body)).toContain('--duration-quick: 120ms;');
  });
});
