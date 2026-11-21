import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import script from '../../src-tauri/src/artifacts/page_script.js?raw';

/**
 * Zorvo's script in an artifact page, run in jsdom. It is plain JavaScript that
 * the child webview runs before the page's own scripts; here it runs once, and
 * each test gives it a new body and a fresh recorder for what it posts.
 */
type Posted = Record<string, unknown>;

interface PageWindow {
  ipc?: { postMessage: (body: string) => void };
  __zorvoCommentMode?: (on: boolean) => void;
  __zorvoMarks?: (marks: unknown) => void;
}

const page = window as unknown as PageWindow;
let posted: Posted[] = [];

function load(html: string) {
  document.documentElement.innerHTML = `<head></head><body>${html}</body>`;
  posted = [];
  page.ipc = { postMessage: (body) => posted.push(JSON.parse(body) as Posted) };
  if (!page.__zorvoCommentMode) new Function(script)();
}

function click(target: Element) {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function select(startNode: Node, startOffset: number, endNode: Node, endOffset: number) {
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}

const BUTTON_PAGE = '<main><section><p>Plans</p></section><section><button id="export" class="btn">Export CSV</button></section></main>';

describe('the artifact page script', () => {
  beforeEach(() => load(BUTTON_PAGE));

  afterEach(() => {
    page.__zorvoCommentMode?.(false);
    window.getSelection()?.removeAllRanges();
  });

  it('posts nothing and lets the page act while comment mode is off', () => {
    let clicks = 0;
    document.querySelector('button')!.addEventListener('click', () => clicks++);

    click(document.querySelector('button')!);

    expect(posted).toEqual([]);
    expect(clicks).toBe(1);
  });

  it('reports a clicked element and stops the page from seeing the click', () => {
    let clicks = 0;
    const button = document.querySelector('button')!;
    button.addEventListener('click', () => clicks++);
    page.__zorvoCommentMode!(true);

    click(button);

    expect(clicks).toBe(0);
    expect(posted).toEqual([
      {
        kind: 'pick-element',
        tag: 'button',
        elementId: 'export',
        classes: ['btn'],
        text: 'Export CSV',
        path: 'main > section:nth-of-type(2) > button',
      },
    ]);
  });

  it('names a label and cuts long element fields', () => {
    load(`<div role="note" aria-label="Summary" class="a b c d e f">${'word '.repeat(80)}</div>`);
    page.__zorvoCommentMode!(true);

    click(document.querySelector('div')!);

    const [pick] = posted;
    expect(pick).toMatchObject({ kind: 'pick-element', tag: 'div', label: 'Summary', path: 'div' });
    expect(pick.classes).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect((pick.text as string).length).toBe(200);
    expect(pick).not.toHaveProperty('elementId');
  });

  it('keeps the twelve levels nearest the element', () => {
    load(`${'<div>'.repeat(14)}<span>deep</span>${'</div>'.repeat(14)}`);
    page.__zorvoCommentMode!(true);

    click(document.querySelector('span')!);

    expect(posted[0].path).toBe([...Array(11).fill('div'), 'span'].join(' > '));
  });

  it('cancels on a click on the page itself', () => {
    page.__zorvoCommentMode!(true);

    click(document.body);

    expect(posted).toEqual([{ kind: 'cancel' }]);
  });

  it('reports selected text cut from the text nodes, with context', () => {
    load('<p>Alpha <b>beta</b> gamma</p>');
    page.__zorvoCommentMode!(true);
    const alpha = document.querySelector('p')!.firstChild!;
    const beta = document.querySelector('b')!.firstChild!;

    select(alpha, 2, beta, 2);

    expect(posted).toEqual([{ kind: 'pick-text', quote: 'pha be', before: 'Al', after: 'ta gamma' }]);
  });

  it('keeps sixty characters of context on each side', () => {
    load(`<p>${'x'.repeat(100)}QUOTE${'y'.repeat(100)}</p>`);
    page.__zorvoCommentMode!(true);
    const text = document.querySelector('p')!.firstChild!;

    select(text, 100, text, 105);

    expect(posted).toEqual([{ kind: 'pick-text', quote: 'QUOTE', before: 'x'.repeat(60), after: 'y'.repeat(60) }]);
  });

  it('cuts a long selection to 1000 characters, with the context after the cut', () => {
    load(`<p>${'q'.repeat(1200)}</p>`);
    page.__zorvoCommentMode!(true);
    const text = document.querySelector('p')!.firstChild!;

    select(text, 0, text, 1200);

    expect((posted[0].quote as string).length).toBe(1000);
    expect(posted[0].after).toBe('q'.repeat(60));
  });

  it('does not report a selection while comment mode is off', () => {
    load('<p>Alpha beta</p>');
    const text = document.querySelector('p')!.firstChild!;

    select(text, 0, text, 5);

    expect(posted).toEqual([]);
  });

  it('does not report the click that ends a selection as an element', () => {
    load('<p>Alpha beta</p>');
    page.__zorvoCommentMode!(true);
    const text = document.querySelector('p')!.firstChild!;
    select(text, 0, text, 5);
    posted = [];

    click(document.querySelector('p')!);

    expect(posted).toEqual([]);
  });

  it('draws the marks it finds and reports the numbers it does not', () => {
    load('<main><p id="a">Hello world</p><button>Go</button></main>');

    page.__zorvoMarks!([
      { n: 1, anchor: { kind: 'element', tag: 'button', classes: [], text: 'Go', path: 'main > button' } },
      { n: 2, anchor: { kind: 'text', quote: 'world', before: 'Hello ', after: '' } },
      { n: 4, anchor: { kind: 'text', quote: 'Hello', before: 'not here ', after: '' } },
      { n: 3, anchor: { kind: 'element', tag: 'div', classes: [], text: '', path: 'main > div' } },
      { n: 5, anchor: { kind: 'text', quote: 'absent', before: '', after: '' } },
    ]);

    expect(posted).toEqual([{ kind: 'marks-missing', numbers: [3, 5] }]);
    const badges = [...document.querySelectorAll('[data-zorvo-overlay] [data-zorvo-badge]')].map((badge) => badge.textContent);
    expect(badges).toEqual(['1', '2', '4']);
  });

  it('replaces earlier marks and says when none are missing', () => {
    load('<p>Hello</p>');
    page.__zorvoMarks!([{ n: 1, anchor: { kind: 'text', quote: 'Hello', before: '', after: '' } }]);
    posted = [];

    page.__zorvoMarks!([]);

    expect(posted).toEqual([{ kind: 'marks-missing', numbers: [] }]);
    expect(document.querySelectorAll('[data-zorvo-badge]')).toHaveLength(0);
  });

  it('never reports its own overlay as a pick', () => {
    load('<p>Hello</p>');
    page.__zorvoMarks!([{ n: 1, anchor: { kind: 'text', quote: 'Hello', before: '', after: '' } }]);
    page.__zorvoCommentMode!(true);
    posted = [];

    click(document.querySelector('[data-zorvo-badge]')!);

    expect(posted).toEqual([]);
  });

  /** Gives each element a place by its text, since jsdom lays nothing out. */
  function placeByText(places: Record<string, number>) {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const left = places[(this.textContent ?? '').trim()] ?? 0;
      return { left, top: 100, width: 50, height: 20, right: left + 50, bottom: 120, x: left, y: 100, toJSON: () => ({}) } as DOMRect;
    });
  }
  const badgeLeft = () => (document.querySelector('[data-zorvo-badge]') as HTMLElement).style.left;

  it('moves its marks when a panel inside the page scrolls, not only the window', () => {
    load('<div id="panel"><p>Plans</p><button id="export">Export CSV</button></div>');
    placeByText({ 'Export CSV': 100 });
    page.__zorvoCommentMode!(true);
    click(document.querySelector('#export')!);
    const pick = posted[0];
    page.__zorvoCommentMode!(false);
    page.__zorvoMarks!([{ n: 1, anchor: { kind: 'element', tag: pick.tag, classes: pick.classes, text: pick.text, path: pick.path } }]);
    expect(badgeLeft()).toBe('91px');

    // The panel scrolls its content sideways: the button is now 200 points further right.
    placeByText({ 'Export CSV': 300 });
    document.querySelector('#panel')!.dispatchEvent(new Event('scroll'));

    expect(badgeLeft()).toBe('291px');
    vi.restoreAllMocks();
  });

  it('marks the element the path names from the body, not a nested one with the same tail', () => {
    load('<div class="wrap"><section><div class="card"><p>Inner</p></div></section><p id="target">Outer</p></div>');
    placeByText({ Inner: 300, Outer: 100 });
    page.__zorvoCommentMode!(true);
    click(document.querySelector('#target')!);
    const pick = posted[0];
    page.__zorvoCommentMode!(false);
    posted = [];

    page.__zorvoMarks!([{ n: 1, anchor: { kind: 'element', tag: pick.tag, classes: pick.classes, text: pick.text, path: pick.path } }]);

    expect(posted).toEqual([{ kind: 'marks-missing', numbers: [] }]);
    expect(badgeLeft()).toBe('91px');
    vi.restoreAllMocks();
  });

  it('finds a cut path by its text when it matches more than one element', () => {
    const chain = (word: string) => `${'<div>'.repeat(13)}<span>${word}</span>${'</div>'.repeat(13)}`;
    load(chain('first') + chain('second'));
    placeByText({ first: 300, second: 100 });
    page.__zorvoCommentMode!(true);
    click(document.querySelectorAll('span')[1]);
    const pick = posted[0];
    page.__zorvoCommentMode!(false);
    posted = [];

    page.__zorvoMarks!([{ n: 1, anchor: { kind: 'element', tag: 'span', classes: [], text: pick.text, path: pick.path } }]);

    expect(badgeLeft()).toBe('91px');
    vi.restoreAllMocks();
  });

  it('keeps the case of SVG names in a path, so the mark is found', () => {
    load('<svg><clipPath id="c"><rect width="4" height="4"></rect></clipPath></svg>');
    page.__zorvoCommentMode!(true);
    click(document.querySelector('rect')!);
    const pick = posted[0];
    page.__zorvoCommentMode!(false);
    posted = [];

    expect(pick).toMatchObject({ tag: 'rect', path: 'svg > clipPath > rect' });
    page.__zorvoMarks!([{ n: 1, anchor: { kind: 'element', tag: 'rect', classes: [], text: '', path: pick.path } }]);
    expect(posted).toEqual([{ kind: 'marks-missing', numbers: [] }]);
  });

  it('does not search script text for a mark', () => {
    load('<script>var s = "secret";</script><p>visible</p>');

    page.__zorvoMarks!([{ n: 1, anchor: { kind: 'text', quote: 'secret', before: '', after: '' } }]);

    expect(posted).toEqual([{ kind: 'marks-missing', numbers: [1] }]);
  });

  describe('in an artboard frame', () => {
    const parent = {} as Window;
    const relay = (data: unknown, source: unknown = parent) =>
      window.dispatchEvent(new MessageEvent('message', { data, source: source as Window }));

    beforeEach(() => {
      Object.defineProperty(window, 'parent', { value: parent, configurable: true });
    });

    afterEach(() => {
      Object.defineProperty(window, 'parent', { value: window, configurable: true });
    });

    it("takes comment mode and marks relayed by the wrapper, the frame's parent", () => {
      load('<p>Hello</p><button id="go">Go</button>');

      relay({ zorvo: 'marks', marks: [{ n: 1, anchor: { kind: 'text', quote: 'Hello', before: '', after: '' } }] });
      relay({ zorvo: 'mode', on: true });
      click(document.querySelector('#go')!);

      expect(posted).toEqual([
        { kind: 'marks-missing', numbers: [] },
        expect.objectContaining({ kind: 'pick-element', elementId: 'go' }),
      ]);
      relay({ zorvo: 'mode', on: false });
      posted = [];
      click(document.querySelector('#go')!);
      expect(posted).toEqual([]);
    });

    it('ignores what any other window posts, and kinds it does not know', () => {
      load('<button id="go">Go</button>');

      relay({ zorvo: 'mode', on: true }, window);
      relay({ zorvo: 'mode', on: true }, null);
      relay({ zorvo: 'eval', code: '1' });
      relay('mode');
      click(document.querySelector('#go')!);

      expect(posted).toEqual([]);
    });
  });

  it('ignores a relayed message in a page that is not in a frame', () => {
    load('<button id="go">Go</button>');

    window.dispatchEvent(new MessageEvent('message', { data: { zorvo: 'mode', on: true }, source: window }));
    click(document.querySelector('#go')!);

    expect(posted).toEqual([]);
  });
});
