import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import shell from '../../src-tauri/src/artifacts/ds_shell.html?raw';
import tokens from '../../docs/design-system/tokens.json';

/**
 * The design system shell, run in jsdom. jsdom has no layout, so these tests drive `apply`,
 * `liveIds` and the DOM the shell builds, never pixels. The script runs once (it defines a
 * non-writable global), and every test starts from an empty state.
 */
interface Component {
  name: string;
  group: string | null;
  height: number;
  url: string | null;
}
interface State {
  title: string;
  theme: string;
  themes: { id: string; name: string }[];
  sections: { id: string; title: string; html: string }[];
  sectionsCut: boolean;
  colours: { name: string; value: string; usage?: string }[];
  type: { group: string; name: string; css: string; family?: string }[];
  spacing: { name: string; value: string }[];
  radius: { name: string; value: string }[];
  shadow: { name: string; value: string }[];
  components: Component[];
  assets: { group: string; file: string; kind: string; url: string | null; size: number | null }[];
  fonts: { family: string; file: string; url: string | null }[];
  fontCss: string;
  googleFontsUrl: string | null;
  notes: string[];
  ownMarks: { tokens: Record<string, number[]>; components: Record<string, number[]>; sections: Record<string, number[]> };
}
interface Shell {
  apply: (state: State) => void;
  mode: (on: boolean) => void;
  marks: (component: string, marks: unknown) => void;
  liveIds: (viewport: { top: number; height: number }) => string[];
}

const win = window as unknown as { __zorvoDs?: Shell };
const ds = () => win.__zorvoDs as Shell;

function empty(): State {
  return {
    title: 'Acme',
    theme: 'dark',
    themes: [{ id: 'dark', name: 'Dark' }],
    sections: [],
    sectionsCut: false,
    colours: [],
    type: [],
    spacing: [],
    radius: [],
    shadow: [],
    components: [],
    assets: [],
    fonts: [],
    fontCss: '',
    googleFontsUrl: null,
    notes: [],
    ownMarks: { tokens: {}, components: {}, sections: {} },
  };
}

function component(name: string, group: string | null = 'Actions'): Component {
  return { name, group, height: 120, url: `zorvo-artifact://localhost/ds/s/d-1/t/dark/f/components/${name}/preview.html?v=1&d=2` };
}

const indexLinks = () => [...document.querySelectorAll('#index a')].map((a) => a.textContent);

beforeAll(() => {
  const parsed = new DOMParser().parseFromString(shell, 'text/html');
  const script = parsed.querySelector('script')?.textContent ?? '';
  parsed.querySelectorAll('script').forEach((node) => node.remove());
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
  new Function(script)();
});

beforeEach(() => {
  ds().apply(empty());
});

describe('the design system shell', () => {
  it('names no http address and uses only the design system colours', () => {
    expect(shell).not.toMatch(/https?:\/\//);
    const literals = (text: string) =>
      (text.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) ?? []).map((value) => value.replace(/\s+/g, '').toLowerCase());
    const known = new Set(literals(JSON.stringify(tokens)));
    const used = literals(shell);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((value) => !known.has(value))).toEqual([]);
    expect(shell).toMatch(/@media \(prefers-color-scheme: light\)/);
  });

  it('cannot be replaced by a page script', () => {
    const before = win.__zorvoDs;
    try {
      (win as { __zorvoDs?: unknown }).__zorvoDs = {};
    } catch {
      // A strict-mode assignment to a non-writable property throws; either way it stays.
    }
    expect(win.__zorvoDs).toBe(before);
  });

  it('builds the index in order and leaves empty families out', () => {
    ds().apply({
      ...empty(),
      sections: [
        { id: 's-0', title: 'Overview', html: '<p>Hi</p>' },
        { id: 's-1', title: 'Voice', html: '<p>Short.</p>' },
      ],
      colours: [{ name: 'accent', value: '#2563eb' }],
      spacing: [{ name: 'space-1', value: '4px' }],
      components: [component('Button', 'Actions'), component('Card', 'Surfaces')],
      fonts: [{ family: 'Acme', file: 'fonts/Acme.woff2', url: null }],
    });

    expect(indexLinks()).toEqual(['Overview', 'Voice', 'Colours', 'Spacing', 'Components', 'Actions', 'Surfaces', 'Fonts']);
    expect(document.querySelectorAll('#index a.group')).toHaveLength(2);
    for (const link of document.querySelectorAll<HTMLAnchorElement>('#index a')) {
      expect(link.getAttribute('href')).toMatch(/^#/);
      expect(document.getElementById(link.getAttribute('href')!.slice(1))).not.toBeNull();
    }
  });

  it('lists ungrouped components under one Components entry with no level below it', () => {
    ds().apply({ ...empty(), components: [component('Button', null), component('Card', null)] });

    expect(indexLinks()).toEqual(['Components']);
    expect(document.querySelectorAll('#main h3.group')).toHaveLength(0);
  });

  it('puts components with no group under Other beside the named groups', () => {
    ds().apply({ ...empty(), components: [component('Button', 'Actions'), component('Swatch', null)] });

    expect(indexLinks()).toEqual(['Components', 'Actions', 'Other']);
  });

  it('puts a section in an article and keeps its prefixed ids', () => {
    ds().apply({ ...empty(), sections: [{ id: 's-0', title: 'Overview', html: '<h2 id="ds-u-usage">Usage</h2><p>x</p>' }] });

    const article = document.querySelector('#main article');
    expect(article?.querySelector('#ds-u-usage')?.textContent).toBe('Usage');
  });

  it('keeps at most 12 live previews', () => {
    const components = Array.from({ length: 20 }, (_, i) => component(`C${i}`));
    ds().apply({ ...empty(), components });

    const live = ds().liveIds({ top: 0, height: 100000 });
    expect(live).toHaveLength(12);
    const frames = document.querySelectorAll('iframe');
    expect(frames.length).toBeLessThanOrEqual(12);
    for (const frame of frames) expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(document.querySelectorAll('.preview .placeholder').length).toBe(20 - frames.length);
  });

  it('uses only buttons and links as controls', () => {
    ds().apply({
      ...empty(),
      colours: [{ name: 'accent', value: '#2563eb', usage: 'Links.' }],
      components: [component('Button')],
    });

    const clickable = [...document.querySelectorAll('[onclick], [tabindex]')].filter(
      (node) => !['BUTTON', 'A', 'IFRAME'].includes(node.tagName),
    );
    expect(clickable).toEqual([]);
    expect(document.querySelectorAll('button.swatch').length).toBe(1);
  });

  it('adds one Google Fonts stylesheet and one font style, and never a tokens.css', () => {
    const url = 'https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap';
    ds().apply({ ...empty(), googleFontsUrl: url, fontCss: '@font-face { font-family: "Acme"; src: url("t/dark/f/fonts/Acme.woff2"); }' });
    ds().apply({ ...empty(), googleFontsUrl: url, fontCss: '@font-face { font-family: "Acme"; src: url("t/dark/f/fonts/Acme.woff2"); }' });

    const links = document.querySelectorAll('link[rel="stylesheet"]');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe(url);
    expect(document.querySelectorAll('style[data-font-css]')).toHaveLength(1);
    expect(document.querySelector('link[href*="tokens.css"]')).toBeNull();
  });

  it('says when sections were left out and shows notes as text', () => {
    ds().apply({ ...empty(), sectionsCut: true, notes: ['<b>2 tokens</b> could not be read.'] });

    const status = document.getElementById('notes')!;
    expect(status.textContent).toContain('Some sections are too long to show here.');
    expect(status.textContent).toContain('<b>2 tokens</b> could not be read.');
    expect(status.querySelector('b')).toBeNull();
  });

  it('sets swatch colours through the style object, never as markup', () => {
    ds().apply({ ...empty(), colours: [{ name: 'evil', value: 'red;" onmouseover="x' }] });

    const chip = document.querySelector<HTMLElement>('button.swatch .chip');
    expect(chip?.getAttribute('onmouseover')).toBeNull();
  });
});

describe('comments in the design system shell', () => {
  const posted: Record<string, unknown>[] = [];
  beforeEach(() => {
    posted.length = 0;
    (window as unknown as { ipc: unknown }).ipc = { postMessage: (body: string) => posted.push(JSON.parse(body) as Record<string, unknown>) };
  });

  it('picks a token or a component only in comment mode', () => {
    ds().apply({ ...empty(), colours: [{ name: 'accent', value: '#2563eb' }], components: [component('Button')] });
    document.querySelector<HTMLButtonElement>('button.swatch')!.click();
    expect(posted).toEqual([]);
    ds().mode(true);
    document.querySelector<HTMLButtonElement>('button.swatch')!.click();
    document.querySelector<HTMLButtonElement>('[data-component="Button"]')!.click();
    expect(posted).toEqual([
      { kind: 'ds-pick-token', name: 'accent' },
      { kind: 'ds-pick-component', name: 'Button' },
    ]);
    ds().mode(false);
  });

  it('never passes on a message a preview frame sent', () => {
    ds().apply({ ...empty(), components: [component('Button')] });
    ds().mode(true);
    window.dispatchEvent(new MessageEvent('message', { data: { kind: 'ds-pick-token', name: 'x' } }));
    expect(posted).toEqual([]);
    ds().mode(false);
  });

  it('reports a preview as loaded from its iframe element', () => {
    ds().apply({ ...empty(), components: [component('Button')] });
    ds().liveIds({ top: 0, height: 100000 });
    const frame = document.querySelector('iframe');
    expect(frame).not.toBeNull();
    frame!.dispatchEvent(new Event('load'));
    expect(posted).toContainEqual({ kind: 'ds-preview-loaded', component: 'Button' });
  });

  it('draws the numbers of comments on a token', () => {
    ds().apply({ ...empty(), colours: [{ name: 'accent', value: '#2563eb' }], ownMarks: { tokens: { accent: [1, 3] }, components: {}, sections: {} } });
    expect([...document.querySelectorAll('button.swatch strong .badge')].map((badge) => badge.textContent)).toEqual(['1', '3']);
  });
});

describe('a brand book pick', () => {
  it('takes the context around the selection, not around the first match', () => {
    const posted: Record<string, unknown>[] = [];
    (window as unknown as { ipc: unknown }).ipc = { postMessage: (body: string) => posted.push(JSON.parse(body) as Record<string, unknown>) };
    ds().apply({ ...empty(), sections: [{ id: 's-0', file: 'README.md', title: 'Overview', html: '<p>one word here then two word there</p>' } as never] });
    ds().mode(true);
    const text = document.querySelector('article p')!.firstChild!;
    const second = text.textContent!.lastIndexOf('word');
    const range = document.createRange();
    range.setStart(text, second);
    range.setEnd(text, second + 4);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(posted).toEqual([{ kind: 'ds-pick-section', file: 'README.md', quote: 'word', before: 'one word here then two ', after: ' there' }]);
    ds().mode(false);
  });
});

describe('new comment numbers', () => {
  it('redraw the numbers without rebuilding the live previews', () => {
    const state = { ...empty(), colours: [{ name: 'accent', value: '#2563eb' }], components: [component('Button')] };
    ds().apply(state);
    ds().liveIds({ top: 0, height: 100000 });
    const frame = document.querySelector('iframe');
    ds().apply({ ...state, ownMarks: { tokens: { accent: [2] }, components: { Button: [1] }, sections: {} } });
    expect(document.querySelector('iframe')).toBe(frame);
    expect(document.querySelector('button.swatch strong .badge')?.textContent).toBe('2');
    expect(document.querySelector('[data-component="Button"] .badge')?.textContent).toBe('1');
  });
});
