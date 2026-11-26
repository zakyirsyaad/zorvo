import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DESIGN_SYSTEM_REFUSALS,
  DS_KEY,
  designSystemResultText,
  SEARCH_SCOPE,
  droppedLine,
  shownName,
  parseSystemList,
  systemsLine,
  type FoundSystem,
  type SystemList,
} from '../lib/design-systems';
import { guideAnswer } from '../lib/design-system-tool';
import { ARTIFACT_GUIDE } from '../lib/artifacts';
import { CANVAS_GUIDE } from '../lib/canvas';
import { MOTION_GUIDE } from '../lib/motion';
import { VISUAL_GUIDE } from '../lib/visuals';

function found(relative: string, title: string, isDefault = false, dropped: FoundSystem['dropped'] = []): FoundSystem {
  return { key: 'd-0123456789abcdef', relative, title, isDefault, dropped };
}

function list(systems: FoundSystem[], defaultProblem: SystemList['defaultProblem'] = null): SystemList {
  return { systems, defaultProblem };
}

describe('systemsLine', () => {
  it('names the one default system', () => {
    expect(systemsLine(list([found('docs/design-system', 'Zorvo', true)]))).toBe(
      'Design systems in this folder: `docs/design-system` (`Zorvo`, default). Read its README.md and tokens.json before you design. Zorvo looks only in this folder and below it, never above it.',
    );
  });

  it('names two systems and says which one is the default', () => {
    expect(systemsLine(list([found('a', 'A', true), found('b', 'B')]))).toBe(
      `Design systems in this folder: \`a\` (\`A\`, default), \`b\` (\`B\`). Read the README.md and tokens.json of the one you use before you design. ${SEARCH_SCOPE}`,
    );
  });

  it('says when the folder holds none', () => {
    expect(systemsLine(list([]))).toBe(
      'No design system in this folder. Zorvo looks only in this folder and below it, never above it.',
    );
  });

  it('repeats the tokens each system could not read before the search scope', () => {
    const line = systemsLine(
      list([
        found('a', 'A', true, [
          { family: 'color', name: 'brand', reason: 'var()' },
          { family: 'color', name: 'x', reason: 'named colour' },
        ]),
        found('b', 'B'),
      ]),
    );
    expect(line).toContain(
      'before you design. In `a`, 2 tokens could not be read: `brand` (var()), `x` (named colour). Zorvo looks only',
    );
    expect(line.endsWith(SEARCH_SCOPE)).toBe(true);
  });

  it('says when several are marked default', () => {
    const line = systemsLine(list([found('a', 'A'), found('b', 'B')], { kind: 'severalMarked', relatives: ['a', 'b'] }));
    expect(line).toBe(
      `Design systems in this folder: \`a\` (\`A\`), \`b\` (\`B\`). Read the README.md and tokens.json of the one you use before you design. \`a\` and \`b\` are both marked default, so none is: ask the user which to use. ${SEARCH_SCOPE}`,
    );
  });

  it('says when none of several is marked default', () => {
    const line = systemsLine(list([found('a', 'A'), found('b', 'B')], { kind: 'noneMarked', relatives: ['a', 'b'] }));
    expect(line).toBe(
      `Design systems in this folder: \`a\` (\`A\`), \`b\` (\`B\`). Read the README.md and tokens.json of the one you use before you design. None of them is marked default: ask the user which to use. ${SEARCH_SCOPE}`,
    );
  });

  it('escapes a title with a bidi control or a backtick', () => {
    const line = systemsLine(list([found('a', 'Ac\u202eme `kit`', true)]));
    expect(line).toContain('(`` Ac\\u202Eme `kit` ``, default)');
    expect(line).not.toContain('\u202e');
  });
});

describe('droppedLine', () => {
  it('counts and names the dropped tokens', () => {
    expect(droppedLine([{ family: 'color', name: 'brand', reason: 'var()' }])).toBe(
      '1 token could not be read: `brand` (var()).',
    );
    expect(droppedLine([])).toBeNull();
    expect(droppedLine([{ family: 'color', name: 'brand', reason: 'var()' }], shownName)).toBe('1 token could not be read: brand (var()).');
  });

  it('names a family that is not a list by its family', () => {
    expect(droppedLine([{ family: 'spacing', name: '', reason: 'not a list' }])).toBe(
      '1 token could not be read: `spacing` (not a list).',
    );
  });

  it('names at most ten and counts the rest', () => {
    const many = Array.from({ length: 12 }, (_, n) => ({ family: 'color', name: `c${n}`, reason: 'var()' }));
    const line = droppedLine(many) ?? '';
    expect(line.startsWith('12 tokens could not be read: `c0` (var()),')).toBe(true);
    expect(line).toContain('`c9` (var()) and 2 more.');
    expect(line).not.toContain('`c10`');
  });
});

describe('parseSystemList', () => {
  it('reads what the backend answers', () => {
    const value = {
      systems: [{ key: 'd-0123456789abcdef', relative: '.', title: 'A', isDefault: true, dropped: [] }],
      defaultProblem: null,
    };
    expect(parseSystemList(value)).toEqual(value);
    expect(parseSystemList({ systems: [], defaultProblem: { kind: 'noneMarked', relatives: ['a'] } })).toEqual({
      systems: [],
      defaultProblem: { kind: 'noneMarked', relatives: ['a'] },
    });
  });

  it('refuses any other shape', () => {
    expect(parseSystemList(null)).toBeNull();
    expect(parseSystemList({ systems: 'x', defaultProblem: null })).toBeNull();
    expect(parseSystemList({ systems: [{ key: 'c-0123456789abcdef', relative: 'a', title: 'A', isDefault: false, dropped: [] }], defaultProblem: null })).toBeNull();
    expect(parseSystemList({ systems: [], defaultProblem: { kind: 'other', relatives: [] } })).toBeNull();
    expect(parseSystemList({ systems: [{ key: 'd-0123456789abcdef', relative: 'a', title: 'A', isDefault: false, dropped: [{ family: 3 }] }], defaultProblem: null })).toBeNull();
  });

  it('knows a key when it sees one', () => {
    expect(DS_KEY.test('d-0123456789abcdef')).toBe(true);
    expect(DS_KEY.test('d-0123456789abcde')).toBe(false);
  });
});

describe('guideAnswer', () => {
  const ok = () => Promise.resolve({ systems: [], defaultProblem: null });
  const none = 'No design system in this folder. Zorvo looks only in this folder and below it, never above it.';

  it('ends every design guide with the line', async () => {
    expect(await guideAnswer('canvas', ok)).toBe(`${CANVAS_GUIDE}\n\n${none}`);
    expect(await guideAnswer('motion', ok)).toBe(`${MOTION_GUIDE}\n\n${none}`);
    expect(await guideAnswer('page', ok)).toBe(`${ARTIFACT_GUIDE}\n\n${none}`);
    expect(await guideAnswer(undefined, ok)).toBe(`${ARTIFACT_GUIDE}\n\n${none}`);
    expect(await guideAnswer('constructor', ok)).toBe(`${ARTIFACT_GUIDE}\n\n${none}`);
  });

  it('gives a visual no line and never asks', async () => {
    const asked = vi.fn(ok);
    expect(await guideAnswer('visual', asked)).toBe(VISUAL_GUIDE);
    expect(asked).not.toHaveBeenCalled();
  });

  it('gives the kind its own guide alone when the search fails', async () => {
    expect(await guideAnswer('canvas', () => Promise.reject(new Error('no')))).toBe(CANVAS_GUIDE);
    expect(await guideAnswer('motion', () => Promise.resolve({ junk: true }))).toBe(MOTION_GUIDE);
    expect(
      await guideAnswer('page', () => {
        throw new Error('sync');
      }),
    ).toBe(ARTIFACT_GUIDE);
  });
});

describe("design system refusals and answers", () => {
  it("keeps DESIGN_SYSTEM_REFUSALS equal to the Rust sentences", () => {
    const rust = ["src-tauri/src/artifacts/design_system.rs", "src-tauri/src/artifacts/ds_store.rs"].map((file) => readFileSync(file, "utf8")).join("\n");
    const oneLine = rust.replace(/"\s*\n\s*"/g, "").replace(/=\s*\n\s*"/g, '= "');
    for (const refusal of DESIGN_SYSTEM_REFUSALS) expect(oneLine).toContain(`"${refusal}"`);
    expect(DESIGN_SYSTEM_REFUSALS.size).toBe(5);
  });

  it("names the key and the dropped tokens in the show answer", () => {
    const read = {
      entry: { key: "d-0123456789abcdef", folder: "/w", relative: ".", title: "Acme", tokens: 1, components: 0, shownAt: 1 },
      content: null,
      error: null,
      googleFontsUrl: null,
    };
    expect(designSystemResultText(read)).toBe("Shown: `Acme` (key d-0123456789abcdef), 1 token, 0 components.");
  });
});
