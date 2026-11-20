import { setTimeout as pause } from 'node:timers/promises';

export function webURL(input = 'about:blank') {
  if (input === 'about:blank') return input;
  let url;
  try { url = new URL(input); } catch { throw new Error('Enter a complete HTTP or HTTPS URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use an HTTP or HTTPS URL without embedded credentials.');
  }
  return url.href;
}

export async function waitFor(probe, timeout = 10_000) {
  const finish = Date.now() + Math.max(1, Math.min(timeout, 20_000));
  do {
    const value = await probe();
    if (value) return value;
    await pause(100);
  } while (Date.now() < finish);
  throw new Error('The browser condition was not reached before the deadline.');
}

export const brief = (value, max = 2400) => String(value ?? '').slice(0, max);
const excludedHeaders = /^(authorization|proxy-authorization|cookie|set-cookie|.*(?:api[-_]?key|auth[-_]?token|access[-_]?token|secret))$/i;
export const headers = (input) => Object.fromEntries(Object.entries(input ?? {})
  .filter(([key]) => !excludedHeaders.test(key)).slice(0, 65).map(([key, value]) => [key, brief(value)]));
export function remember(list, entry) {
  list.push(entry);
  if (list.length > 150) list.shift();
}

export function tabState(id, session) {
  return {
    id, session, refs: new Map(), nextRef: 0, contexts: new Map(), childSessions: new Map(),
    messages: [], requests: new Map(), activeRequests: new Map(), nextRequest: 0,
    documentLoader: undefined, dialog: null, cpu: null, dragData: null,
  };
}

/** Resolve the receiving document from native DOM metadata, never page-authored getters. */
export function documentForNode(root, backendNodeID) {
  const pending = [[root, root.documentURL]];
  while (pending.length) {
    const [node, inherited] = pending.pop();
    const document = node.documentURL || inherited;
    if (node.backendNodeId === backendNodeID) return document;
    for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? []), ...(node.contentDocument ? [node.contentDocument] : [])]) {
      pending.push([child, document]);
    }
  }
}

export class Page {
  constructor(browser, tab) {
    this.browser = browser;
    this.tab = tab;
  }

  send(method, args = {}, session = this.tab.session) { return this.browser.send(method, args, session); }

  async uploadSite(ref) {
    const { node, session } = this.element(ref);
    const { root } = await this.send('DOM.getDocument', { depth: -1, pierce: true }, session);
    const document = documentForNode(root, node);
    if (!document) throw new Error('The upload element is no longer in this document.');
    const url = webURL(document);
    if (url === 'about:blank') throw new Error('Open a web page before uploading files.');
    return new URL(url).origin + '/';
  }

  async navigate(url) {
    this.tab.refs.clear();
    const result = await this.send('Page.navigate', { url: webURL(url) });
    if (result.errorText) throw new Error(`Navigation failed: ${result.errorText}`);
    if (result.isDownload) return { downloading: true };
    return { navigated: true };
  }

  async history(offset) {
    const { currentIndex, entries } = await this.send('Page.getNavigationHistory');
    const target = entries[currentIndex + offset];
    if (!target) return { navigated: false };
    this.tab.refs.clear();
    await this.send('Page.navigateToHistoryEntry', { entryId: target.id });
    return { navigated: true };
  }

  refresh() {
    this.tab.refs.clear();
    return this.send('Page.reload');
  }

  frameSession(frameID) {
    return this.tab.childSessions.get(frameID) ?? this.tab.session;
  }

  async frames() {
    const result = new Map();
    const visit = ({ frame, childFrames = [] }) => {
      result.set(frame.id, { id: frame.id, parentID: frame.parentId, url: brief(frame.url), name: frame.name });
      childFrames.forEach(visit);
    };
    for (const session of [this.tab.session, ...this.tab.childSessions.values()]) {
      try { visit((await this.send('Page.getFrameTree', {}, session)).frameTree); }
      catch (error) { if (session === this.tab.session) throw error; }
    }
    return { frames: [...result.values()] };
  }

  async snapshot(frameID) {
    const session = this.frameSession(frameID);
    const { nodes } = await this.send('Accessibility.getFullAXTree', { frameId: frameID }, session);
    const depths = new Map();
    const lines = [];
    for (const node of nodes.slice(0, 1500)) {
      const depth = depths.get(node.parentId) ?? 0;
      depths.set(node.nodeId, depth + (node.ignored ? 0 : 1));
      if (node.ignored) continue;
      let ref = '';
      if (node.backendDOMNodeId && !['RootWebArea', 'StaticText', 'InlineTextBox'].includes(node.role?.value)) {
        ref = [...this.tab.refs].find(([, item]) => item.node === node.backendDOMNodeId && item.session === session)?.[0];
        if (!ref) {
          if (this.tab.refs.size >= 10000) throw new Error('This document reached its element-reference limit. Navigate or reload to reset it.');
          ref = `e${++this.tab.nextRef}`;
          this.tab.refs.set(ref, { node: node.backendDOMNodeId, session, frameID: frameID ?? this.tab.topFrame });
        }
      }
      const label = brief(node.name?.value, 180).replace(/[\n\r\t]/g, ' ');
      const value = node.role?.value === 'textbox' && node.properties?.some((item) => item.name === 'protected')
        ? '' : brief(node.value?.value, 100).replace(/[\n\r\t]/g, ' ');
      lines.push(`${'  '.repeat(Math.min(depth, 16))}${node.role?.value ?? 'unknown'}${label ? ' ' + JSON.stringify(label) : ''}${value ? ' = ' + JSON.stringify(value) : ''}${ref ? ' [ref=' + ref + ']' : ''}`);
      if (lines.length >= 350) break;
    }
    return { content: lines.join('\n'), truncated: nodes.length > 1500 || lines.length >= 350 };
  }

  async find(args) {
    const { content, truncated } = await this.snapshot(args.frameID);
    return { matches: content.split('\n').filter((line) => line.toLowerCase().includes(args.text.toLowerCase())).slice(0, 80), truncated };
  }

  element(ref) {
    const item = this.tab.refs.get(ref);
    if (!item) throw new Error('Element reference expired. Take a new snapshot.');
    return item;
  }

  async onElement(ref, body, values = [], isolated = true) {
    const { node, session, frameID } = this.element(ref);
    const executionContextId = isolated ? (await this.send('Page.createIsolatedWorld', {
      frameId: frameID ?? this.tab.topFrame, worldName: 'zorvo.browser.internal',
    }, session)).executionContextId : undefined;
    const { object } = await this.send('DOM.resolveNode', { backendNodeId: node, executionContextId }, session);
    try {
      return this.result(await this.send('Runtime.callFunctionOn', {
        objectId: object.objectId, returnByValue: true, awaitPromise: true,
        functionDeclaration: body, arguments: values.map((value) => ({ value })),
      }, session));
    } finally {
      await this.send('Runtime.releaseObject', { objectId: object.objectId }, session).catch(() => {});
    }
  }

  result({ result, exceptionDetails }) {
    if (exceptionDetails) throw new Error(brief(exceptionDetails.exception?.description ?? exceptionDetails.text));
    return result.value ?? result.unserializableValue ?? null;
  }

  async evaluate({ expression, frameID, ref }) {
    if (ref) return this.onElement(ref, 'function (expression) { const element = this; return eval(expression); }', [expression], false);
    const session = this.frameSession(frameID);
    const contextId = frameID ? this.tab.contexts.get(frameID)?.id : undefined;
    if (frameID && !contextId) throw new Error('Frame is unavailable. List frames again.');
    return this.result(await this.send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true }, session));
  }

  async position(ref) {
    const { node, session } = this.element(ref);
    await this.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: node }, session);
    const { quads } = await this.send('DOM.getContentQuads', { backendNodeId: node }, session);
    if (!quads?.length) throw new Error('Element has no visible layout.');
    const q = quads[0];
    let x = (q[0] + q[2] + q[4] + q[6]) / 4;
    let y = (q[1] + q[3] + q[5] + q[7]) / 4;
    let owner = session;
    while (owner !== this.tab.session) {
      const frame = [...this.tab.childSessions].find(([, child]) => child === owner)?.[0];
      const parent = this.tab.contexts.get(frame)?.parent ?? this.tab.session;
      const { backendNodeId } = await this.send('DOM.getFrameOwner', { frameId: frame }, parent);
      const { model } = await this.send('DOM.getBoxModel', { backendNodeId }, parent);
      x += model.content[0];
      y += model.content[1];
      owner = parent;
    }
    return { x, y };
  }

  mouse(type, point, extra = {}) {
    return this.send('Input.dispatchMouseEvent', { type, ...point, ...extra });
  }

  async click(ref, button = 'left', count = 1) {
    const point = await this.position(ref);
    const clicks = Math.max(1, Math.min(count, 3));
    for (let clickCount = 1; clickCount <= clicks; clickCount++) {
      await this.mouse('mousePressed', point, { button, clickCount });
      await this.mouse('mouseReleased', point, { button, clickCount });
    }
    return { clicked: true };
  }

  async drag(from, to) {
    const start = await this.position(from);
    const end = await this.position(to);
    this.tab.dragData = null;
    await this.send('Input.setInterceptDrags', { enabled: true });
    try {
      await this.mouse('mouseMoved', start);
      await this.mouse('mousePressed', start, { button: 'left', buttons: 1, clickCount: 1 });
      for (let step = 1; step <= 8; step++) {
        await this.mouse('mouseMoved', { x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8 }, { button: 'left', buttons: 1 });
      }
      if (this.tab.dragData) {
        for (const type of ['dragEnter', 'dragOver', 'drop']) {
          await this.send('Input.dispatchDragEvent', { type, ...end, data: this.tab.dragData });
        }
      }
    } finally {
      this.tab.dragData = null;
      await this.send('Input.setInterceptDrags', { enabled: false }).catch(() => {});
      await this.mouse('mouseReleased', end, { button: 'left', clickCount: 1 }).catch(() => {});
    }
    return { dragged: true };
  }

  async fill(ref, value) {
    return this.onElement(ref, `function (value) {
      if (this.disabled || this.readOnly || this.type === 'file') throw new Error('Element is not editable.');
      this.focus();
      if (this.isContentEditable) this.textContent = value;
      else if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) {
        const prototype = this instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(this, value);
      } else throw new Error('Element is not a text field.');
      this.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertReplacementText' }));
      this.dispatchEvent(new Event('change', { bubbles: true }));
      return { filled: true };
    }`, [value]);
  }

  select(ref, values) {
    return this.onElement(ref, `function (values) {
      if (!(this instanceof HTMLSelectElement) || this.disabled) throw new Error('Element is not a select field.');
      const options = Array.from(this.options);
      if ((!this.multiple && values.length > 1) || values.some((value) => !options.some((o) => o.value === value && !o.disabled))) {
        throw new Error('Invalid option value.');
      }
      for (const option of options) option.selected = values.includes(option.value);
      this.dispatchEvent(new Event('input', { bubbles: true }));
      this.dispatchEvent(new Event('change', { bubbles: true }));
      return { values: Array.from(this.selectedOptions, (o) => o.value) };
    }`, [values]);
  }

  async check(ref, checked) {
    const read = () => this.onElement(ref, `function () {
      if (!['checkbox', 'radio'].includes(this.type) || this.disabled) throw new Error('Element is not a checkable input.');
      return this.checked;
    }`);
    if (await read() !== checked) await this.click(ref);
    if (await read() !== checked) throw new Error('The input did not reach the requested state.');
    return { checked };
  }

  async press({ ref, key }) {
    if (ref) await this.onElement(ref, 'function () { this.focus(); }');
    const parts = key.split('+');
    const last = parts.pop();
    const masks = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Shift: 8 };
    const modifiers = parts.reduce((mask, part) => {
      if (!Object.hasOwn(masks, part)) throw new Error('Unknown shortcut modifier.');
      return mask | masks[part];
    }, 0);
    const keys = { Backspace: 8, Tab: 9, Enter: 13, Escape: 27, ' ': 32, Space: 32, PageUp: 33, PageDown: 34, End: 35,
      Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46 };
    const code = keys[last] ?? (/^[a-z0-9]$/i.test(last) ? last.toUpperCase().charCodeAt(0) : 0);
    const name = last === 'Space' ? ' ' : last;
    if (!name || (name.length !== 1 && !code)) throw new Error('Unknown key.');
    const args = { key: name, modifiers, windowsVirtualKeyCode: code };
    const text = !(modifiers & 7) && (name.length === 1 || name === 'Enter') ? (name === 'Enter' ? '\r' : name) : undefined;
    await this.send('Input.dispatchKeyEvent', { ...args, type: text ? 'keyDown' : 'rawKeyDown', text });
    await this.send('Input.dispatchKeyEvent', { ...args, type: 'keyUp' });
    return { pressed: true };
  }

  async wait(args) {
    if (args.condition !== 'load' && !args.text?.trim()) throw new Error('Text is required for this wait.');
    const expression = args.condition === 'load' ? 'document.readyState === "complete"'
      : `Boolean(document.body?.innerText.includes(${JSON.stringify(args.text)})) === ${args.condition === 'visible'}`;
    await waitFor(async () => {
      try { return await this.evaluate({ frameID: args.frameID, expression }); } catch { return false; }
    }, args.timeoutMs);
    return { ready: true };
  }

  async screenshot(args) {
    let clip;
    const { cssContentSize, cssLayoutViewport } = await this.send('Page.getLayoutMetrics');
    if (args.ref) {
      const { node, session } = this.element(args.ref);
      const { model } = await this.send('DOM.getBoxModel', { backendNodeId: node }, session);
      const point = await this.position(args.ref);
      clip = { x: Math.max(0, point.x + cssLayoutViewport.pageX - model.width / 2),
        y: Math.max(0, point.y + cssLayoutViewport.pageY - model.height / 2), width: model.width, height: model.height };
    } else if (args.fullPage) {
      clip = { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height };
    } else {
      clip = { x: cssLayoutViewport.pageX, y: cssLayoutViewport.pageY,
        width: cssLayoutViewport.clientWidth, height: cssLayoutViewport.clientHeight };
    }
    if (clip.width < 1 || clip.height < 1 || clip.width * clip.height > 16_000_000) {
      throw new Error('Capture exceeds the screenshot dimensions limit.');
    }
    const { data } = await this.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: Boolean(args.fullPage || args.ref), clip: { ...clip, scale: 1 },
    });
    return Buffer.from(data, 'base64');
  }
}
