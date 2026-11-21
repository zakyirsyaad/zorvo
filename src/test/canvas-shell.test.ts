import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import shell from '../../src-tauri/src/artifacts/canvas_shell.html?raw';
import tokens from '../../docs/design-system/tokens.json';

/**
 * The canvas wrapper page, run in jsdom. jsdom has no layout, so these tests drive `apply`,
 * `layout`, `liveIds` and the DOM the wrapper builds, never pixels. The page's script runs
 * once (it defines a non-writable global), and every test starts from an empty canvas.
 */
interface Board {
  id: string;
  title: string;
  section: string;
  group?: string;
  width: number;
  height: number;
  url: string;
  thumb?: string;
  missing?: boolean;
}
interface State {
  boards: Board[];
  sections: { id: string; title: string }[];
  selected?: string;
  error?: string;
}
interface Canvas {
  apply: (state: State) => void;
  command: (name: string) => void;
  mode: (on: boolean, artboardId?: string) => void;
  marks: (artboardId: string, marks: unknown) => void;
  layout: (state: State) => {
    boards: { id: string; x: number; y: number; width: number; height: number }[];
    sections: { id: string; x: number; y: number }[];
    groups: { id: string; x: number; y: number; width: number }[];
    width: number;
    height: number;
  };
  liveIds: (
    state: State,
    view: { x: number; y: number; zoom: number },
    viewport: { width: number; height: number },
    budget: number,
  ) => string[];
}

type Posted = Record<string, unknown>;
let posted: Posted[] = [];
const win = window as unknown as { __zorvoCanvas?: Canvas; ipc?: unknown };
const canvas = () => win.__zorvoCanvas as Canvas;

function board(id: string, extra: Partial<Board> = {}): Board {
  return {
    id,
    title: id.toUpperCase(),
    section: 's1',
    width: 400,
    height: 300,
    url: `zorvo-artifact://localhost/canvas/x/c-1/f/${id}.html`,
    ...extra,
  };
}

function stateOf(boards: Board[], sectionIds = ['s1']): State {
  return { boards, sections: sectionIds.map((id) => ({ id, title: id })) };
}

beforeAll(() => {
  const parsed = new DOMParser().parseFromString(shell, 'text/html');
  const script = parsed.querySelector('script')?.textContent ?? '';
  parsed.querySelectorAll('script').forEach((node) => node.remove());
  document.body.innerHTML = parsed.body.innerHTML;
  new Function(script)();
});

beforeEach(() => {
  posted = [];
  win.ipc = { postMessage: (body: string) => posted.push(JSON.parse(body) as Posted) };
  canvas().apply({ boards: [], sections: [] });
  posted = [];
});

describe('the canvas wrapper', () => {
  it('lays sections out as rows with 80 px between artboards and 160 px between rows', () => {
    const state: State = {
      sections: [
        { id: 's1', title: 'One' },
        { id: 's2', title: 'Two' },
      ],
      boards: [
        board('a', { width: 400, height: 300 }),
        board('b', { width: 600, height: 500 }),
        board('c', { section: 's2', width: 300, height: 200 }),
      ],
    };

    const out = canvas().layout(state);
    const at = (id: string) => out.boards.find((b) => b.id === id)!;

    expect(at('b').x - (at('a').x + at('a').width)).toBe(80);
    expect(at('a').y).toBe(at('b').y);
    const section2 = out.sections.find((s) => s.id === 's2')!;
    const rowBottom = at('a').y + 500;
    expect(section2.y - rowBottom).toBe(160);
    expect(at('c').y - section2.y).toBe(48);
    expect(out.sections[0].y).toBeLessThan(section2.y);
  });

  it("puts a group's artboards together under one label", () => {
    const out = canvas().layout(
      stateOf([
        board('a', { group: 'pay' }),
        board('x'),
        board('b', { group: 'pay' }),
      ]),
    );

    const ids = out.boards.map((b) => b.id);
    expect(ids.indexOf('b') - ids.indexOf('a')).toBe(1);
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0].id).toBe('pay');
    expect(out.groups[0].width).toBe(400 + 80 + 400);
  });

  it('keeps at most 8 live artboards, nearest the centre, and none under 25% zoom', () => {
    const boards = Array.from({ length: 12 }, (_, i) => board(`b${i}`, { width: 200, height: 200 }));
    const state = stateOf(boards);
    const viewport = { width: 100000, height: 1000 };

    const live = canvas().liveIds(state, { x: 0, y: 0, zoom: 1 }, viewport, 8);
    expect(live).toHaveLength(8);
    const centre = 50000;
    const out = canvas().layout(state);
    const distance = (id: string) => {
      const b = out.boards.find((item) => item.id === id)!;
      return Math.abs(b.x + b.width / 2 - centre) + Math.abs(b.y + b.height / 2 - 500);
    };
    const rest = boards.map((b) => b.id).filter((id) => !live.includes(id));
    expect(Math.max(...live.map(distance))).toBeLessThanOrEqual(Math.min(...rest.map(distance)));

    expect(canvas().liveIds(state, { x: 0, y: 0, zoom: 0.24 }, viewport, 8)).toEqual([]);
    expect(canvas().liveIds(state, { x: 0, y: 0, zoom: 0.25 }, viewport, 8).length).toBeGreaterThan(0);
  });

  it('keeps off-screen artboards out of the live set', () => {
    const state = stateOf([board('a'), board('b')]);
    const live = canvas().liveIds(state, { x: 0, y: 0, zoom: 1 }, { width: 450, height: 600 }, 8);
    expect(live).toEqual(['a']);
  });

  it('draws a live frame, a picture, a rendering box or a missing box', () => {
    canvas().apply(
      stateOf([
        board('live'),
        board('pic', { thumb: 'zorvo-artifact://localhost/thumb/aa.png' }),
        board('wait'),
        board('gone', { missing: true }),
      ]),
    );
    canvas().command('fit');
    // Four boards in one row fit to a zoom above 25%: all are live, so push them out of range.
    canvas().command('out');
    for (let i = 0; i < 8; i += 1) canvas().command('out');

    const at = (id: string) => document.querySelector(`[data-id="${id}"]`)!;
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
    expect(at('pic').querySelector('img')?.getAttribute('src')).toBe(
      'zorvo-artifact://localhost/thumb/aa.png',
    );
    expect(at('wait').textContent).toContain('Rendering…');
    expect(at('gone').textContent).toContain('File not found');
    expect(at('gone').textContent).not.toContain('Rendering…');
  });

  it('shows a live artboard as a sandboxed frame at normal zoom', () => {
    canvas().apply(stateOf([board('a')]));
    canvas().command('actual');

    const frame = document.querySelector('[data-id="a"] iframe')!;
    expect(frame.getAttribute('src')).toBe('zorvo-artifact://localhost/canvas/x/c-1/f/a.html');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('posts canvas-select on a click of an artboard\'s title', () => {
    canvas().apply(stateOf([board('a'), board('b')]));

    document
      .querySelector('[data-id="b"] .title')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(posted).toContainEqual({ kind: 'canvas-select', artboardId: 'b' });
  });

  it('marks the selected artboard', () => {
    canvas().apply({ ...stateOf([board('a'), board('b')]), selected: 'b' });

    expect(document.querySelector('[data-id="b"]')!.classList.contains('selected')).toBe(true);
    expect(document.querySelector('[data-id="a"]')!.classList.contains('selected')).toBe(false);
  });

  it('keeps the last layout and shows the error bar when apply gets an error', () => {
    canvas().apply(stateOf([board('a')]));

    canvas().apply({ boards: [], sections: [], error: 'Unexpected token' });

    expect(document.querySelector('[data-id="a"]')).not.toBeNull();
    const bar = document.querySelector('.error')!;
    expect(bar.textContent).toBe('canvas.json could not be read: Unexpected token');
    expect((bar as HTMLElement).hidden).toBe(false);

    canvas().apply(stateOf([board('a')]));
    expect((document.querySelector('.error') as HTMLElement).hidden).toBe(true);
  });

  it('writes titles as text, never as markup', () => {
    canvas().apply(stateOf([board('a', { title: '<img src=x onerror=alert(1)>' })]));

    expect(document.querySelector('[data-id="a"] img')).toBeNull();
    expect(document.querySelector('[data-id="a"] .title')!.textContent).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('zooms with the commands and reports it', async () => {
    // Earlier tests may have left a report waiting on a real timer.
    await new Promise((resolve) => setTimeout(resolve, 150));
    vi.useFakeTimers();
    posted = [];
    canvas().apply(stateOf([board('a')]));

    canvas().command('actual');
    vi.advanceTimersByTime(200);
    canvas().command('in');
    vi.advanceTimersByTime(200);
    vi.useRealTimers();

    const zooms = posted.filter((m) => m.kind === 'canvas-zoom').map((m) => m.zoom as number);
    expect(zooms.at(-1)).toBeGreaterThan(1);
    expect(zooms.every((z) => z >= 0.05 && z <= 2)).toBe(true);
  });

  it('forwards comment mode and marks to an artboard\'s frame', () => {
    canvas().apply(stateOf([board('a')]));
    canvas().command('actual');
    const frame = document.querySelector('[data-id="a"] iframe') as HTMLIFrameElement;
    const received: unknown[] = [];
    Object.defineProperty(frame, 'contentWindow', {
      value: { postMessage: (message: unknown) => received.push(message) },
    });

    canvas().mode(true, 'a');
    canvas().marks('a', [{ n: 1 }]);

    expect(received).toEqual([
      { zorvo: 'mode', on: true },
      { zorvo: 'marks', marks: [{ n: 1 }] },
    ]);
  });

  it("says when a live artboard's frame has loaded, so its marks can be sent", () => {
    canvas().apply(stateOf([board('a')]));
    canvas().command('actual');
    const frame = document.querySelector('[data-id="a"] iframe') as HTMLIFrameElement;
    posted = [];

    frame.dispatchEvent(new Event('load'));

    expect(posted).toContainEqual({ kind: 'canvas-board-loaded', artboardId: 'a' });
  });

  it('cannot have its functions replaced', () => {
    const original = canvas().apply;
    try {
      (canvas() as unknown as Record<string, unknown>).apply = () => undefined;
    } catch {
      // A strict-mode refusal is as good as a silent one.
    }
    expect(canvas().apply).toBe(original);
    expect(Object.isFrozen(canvas())).toBe(true);
    expect(Object.getOwnPropertyDescriptor(window, '__zorvoCanvas')?.writable).toBe(false);
  });

  it('loads nothing from the network', () => {
    expect(shell).not.toMatch(/https?:\/\//);
  });

  it("uses only the design system's colours, with a light set for a light appearance", () => {
    const literals = (text: string) =>
      (text.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) ?? []).map((value) =>
        value.replace(/\s+/g, '').toLowerCase(),
      );
    const known = new Set(literals(JSON.stringify(tokens)));

    const used = literals(shell);

    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((value) => !known.has(value))).toEqual([]);
    expect(shell).toMatch(/@media \(prefers-color-scheme: light\)/);
  });

  it('lays out and draws an artboard, a group and a section named like an Object property', () => {
    const state: State = {
      sections: [{ id: 'constructor', title: 'Constructor' }],
      boards: [
        board('constructor', { section: 'constructor', group: 'constructor' }),
        board('tostring', { section: 'constructor', group: 'constructor' }),
      ],
    };

    const out = canvas().layout(state);
    canvas().apply(state);
    canvas().command('actual');

    expect(out.boards.map((b) => b.id)).toEqual(['constructor', 'tostring']);
    expect(out.groups).toEqual([expect.objectContaining({ id: 'constructor', width: 880 })]);
    const drawn = document.querySelector('[data-id="constructor"]')!;
    expect(drawn.querySelector('.title')!.textContent).toBe('CONSTRUCTOR');
    expect(document.querySelector('.section-title')!.textContent).toBe('Constructor');
    canvas().apply({ ...state, selected: 'constructor' });
    expect(drawn.classList.contains('selected')).toBe(true);
  });
});
