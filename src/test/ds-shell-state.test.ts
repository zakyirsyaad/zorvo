import { describe, expect, it } from 'vitest';
import { dsFileUrl, dsShellState, parseDesignSystemRead, type DesignSystemRead } from '../lib/design-systems';

const SESSION = 'session-1794800000000-k3x9a';
const KEY = 'd-0123456789abcdef';

function read(overrides: Partial<NonNullable<DesignSystemRead['content']>> = {}): DesignSystemRead {
  return {
    entry: {
      key: KEY,
      folder: '/w/docs/design-system',
      relative: 'docs/design-system',
      title: 'Acme',
      tokens: 2,
      components: 1,
      shownAt: 1,
    },
    error: null,
    googleFontsUrl: null,
    content: {
      index: { title: 'Acme', namespace: null, libraries: [], assetGroupOrder: [], isDefault: true },
      tokens: {
        themes: [
          { id: 'dark', name: 'Dark' },
          { id: 'light', name: 'Light' },
        ],
        tokens: [
          { family: 'color', name: 'accent', values: ['#111111', '#eeeeee'], usage: 'Links.', hash: 'aa' },
          { family: 'spacing', name: 'space-1', values: ['4px', '4px'], usage: null, hash: 'bb' },
        ],
        fonts: [{ family: 'Acme Sans', file: 'fonts/Acme Sans.woff2', weight: 600, style: null }],
        families: [['sans', '"Acme Sans", system-ui']],
        styles: [{ group: 'Text', name: 'body', fontSize: '15px', lineHeight: '22px', fontWeight: 400, letterSpacing: null, family: 'sans' }],
        dropped: [],
        source: null,
      },
      tokensError: null,
      sections: [
        { file: 'README.md', title: 'Overview', html: '<p>One</p>', hash: 's1' },
        { file: 'voice.md', title: 'Voice', html: `<p>${'x'.repeat(3000)}</p>`, hash: 's2' },
      ],
      components: [{ name: 'Button', group: 'Actions', height: 120, hasReadme: true, previewHash: 'cafebabecafebabe' }],
      assets: [
        { group: 'Logos', file: 'assets/Logos/mark.svg', kind: 'image', size: 300, isMissing: false },
        { group: 'Logos', file: 'assets/Logos/gone.svg', kind: 'image', size: null, isMissing: true },
      ],
      fonts: [{ group: 'Fonts', file: 'fonts/Acme Sans.woff2', kind: 'font', size: 1000, isMissing: false }],
      digest: '0123456789abcdef0123',
      ...overrides,
    },
  };
}

describe('the design system shell state', () => {
  it('parses a well-formed read and refuses a bad key', () => {
    expect(parseDesignSystemRead(read())).not.toBeNull();
    expect(parseDesignSystemRead({ ...read(), entry: { ...read().entry, key: 'c-1' } })).toBeNull();
    const broken = read();
    (broken.content!.tokens!.tokens[0] as unknown as { values?: unknown }).values = undefined;
    expect(parseDesignSystemRead(broken)?.content?.tokens?.tokens).toHaveLength(1);
    const noHtml = read();
    (noHtml.content!.sections[0] as unknown as { html?: unknown }).html = undefined;
    expect(parseDesignSystemRead(noHtml)?.content?.sections).toHaveLength(1);
  });

  it('takes colours in the chosen theme', () => {
    const state = JSON.parse(dsShellState(read(), SESSION, 'light', []));
    expect(state.colours).toEqual([{ name: 'accent', value: '#eeeeee', usage: 'Links.' }]);
    expect(state.spacing).toEqual([{ name: 'space-1', value: '4px' }]);
    expect(state.theme).toBe('light');
  });

  it('builds preview and file URLs as Rust does', () => {
    const state = JSON.parse(dsShellState(read(), SESSION, 'dark', []));
    expect(state.components[0].url).toBe(
      `${dsFileUrl(SESSION, KEY, 'dark', 'components/Button/preview.html')}?v=cafebabecafebabe&d=0123456789ab`,
    );
    expect(dsFileUrl(SESSION, KEY, 'dark', 'Brand Kit/Märk.svg')).toBe(
      `zorvo-artifact://localhost/ds/${SESSION}/${KEY}/t/dark/f/Brand%20Kit/M%C3%A4rk.svg`,
    );
    expect(state.fontCss).toContain('url("t/dark/f/fonts/Acme%20Sans.woff2")');
    expect(state.assets.map((asset: { url: string | null }) => asset.url)).toEqual([
      dsFileUrl(SESSION, KEY, 'dark', 'assets/Logos/mark.svg'),
      null,
    ]);
  });

  it('describes a type style with its own font', () => {
    const state = JSON.parse(dsShellState(read(), SESSION, 'dark', []));
    expect(state.type[0].css).toBe('font-family: "Acme Sans", system-ui; font-size: 15px; line-height: 22px; font-weight: 400');
  });

  it('leaves out the last sections when the state passes the limit', () => {
    const json = dsShellState(read(), SESSION, 'dark', [], 2000);
    const state = JSON.parse(json);
    expect(new TextEncoder().encode(json).length).toBeLessThanOrEqual(2000);
    expect(state.sectionsCut).toBe(true);
    expect(state.sections.map((section: { title: string }) => section.title)).toEqual(['Overview']);
  });

  it('passes notes through as text', () => {
    const state = JSON.parse(dsShellState(read(), SESSION, 'dark', ['Two tokens could not be read.']));
    expect(state.notes).toEqual(['Two tokens could not be read.']);
  });
});
