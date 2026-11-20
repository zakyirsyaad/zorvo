import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { access, chmod, mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as pause } from 'node:timers/promises';
import { catalog, validate } from './catalog.mjs';
import { DevTools } from './cdp.mjs';
import { brief, headers, Page, remember, tabState, waitFor, webURL } from './page.mjs';
import { Captures, lighthouseAudit, previewFile, stageUploads, workspaceFile } from './files.mjs';
import { compareHeaps, compressedFile, cpuSummary, heapView, MAX_FILE, readCompressed, traceSummary } from './analysis.mjs';

const workspace = await realpath(process.env.ZORVO_BROWSER_ROOT || process.argv[2] || '.');
const directory = await mkdtemp(join(process.env.ZORVO_BROWSER_DATA || tmpdir(), 'zorvo-browser-debug-'));
await chmod(directory, 0o700);
const chromeCandidates = [process.env.ZORVO_BROWSER_CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'].filter(Boolean);
let chrome;
for (const candidate of chromeCandidates) { try { await access(candidate); chrome = candidate; break; } catch { /* Try the next installed browser. */ } }
const lighthouse = process.env.ZORVO_LIGHTHOUSE_PATH;

const downloadDirectory = join(directory, 'downloads');
await mkdir(downloadDirectory, { mode: 0o700 });
const captures = new Captures(directory);
const tabs = new Map();
const sessions = new Map();
const downloads = new Map();
const owners = new Map();
let focused = null;
let preview = null;
let trace = null;
let heap = null;
let closing = false;
let uploads = 0;
let browser;

const lifetime = new AbortController();

async function setup(session) {
  await Promise.all([
    browser.send('Page.enable', {}, session),
    browser.send('Runtime.enable', {}, session),
    browser.send('Log.enable', {}, session),
    browser.send('DOM.enable', {}, session),
    browser.send('Page.setInterceptFileChooserDialog', { enabled: true }, session),
    browser.send('Network.enable', { maxTotalBufferSize: 6 * 1024 * 1024, maxResourceBufferSize: 256 * 1024 }, session),
    browser.send('Security.enable', {}, session),
    browser.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
      filter: [{ type: 'iframe' }, { exclude: true }] }, session),
  ]);
}

function trackNetwork(tab, method, data, session) {
  const { requestId, request, response, loaderId, type } = data;
  const key = `${session}:${requestId}`;
  if (method === 'Network.requestWillBeSent') {
    if (type === 'Document' && session === tab.session && tab.topFrame === data.frameId && tab.documentLoader !== loaderId) {
      tab.requests.clear();
      tab.activeRequests.clear();
      tab.messages.length = 0;
      tab.documentLoader = loaderId;
    }
    const previous = tab.requests.get(tab.activeRequests.get(key));
    if (previous && data.redirectResponse) {
      const redirect = data.redirectResponse;
      Object.assign(previous, {
        state: 'completed', status: redirect.status, statusText: redirect.statusText,
        responseHeaders: headers(redirect.headers), redirected: true,
      });
    }
    const id = `r${++tab.nextRequest}`;
    tab.activeRequests.set(key, id);
    tab.requests.set(id, { id, key, requestId, session, url: brief(request.url), method: request.method,
      type, startedAt: data.wallTime * 1000, requestHeaders: headers(request.headers), state: 'pending' });
    if (tab.requests.size > 180) {
      const [oldId, oldRequest] = tab.requests.entries().next().value;
      tab.requests.delete(oldId);
      if (tab.activeRequests.get(oldRequest.key) === oldId) tab.activeRequests.delete(oldRequest.key);
    }
    return;
  }
  const entry = tab.requests.get(tab.activeRequests.get(key));
  if (!entry) return;
  if (method === 'Network.responseReceived') {
    Object.assign(entry, { status: response.status, statusText: response.statusText, mime: response.mimeType,
      protocol: response.protocol, responseHeaders: headers(response.headers) });
  } else if (method === 'Network.loadingFailed') {
    Object.assign(entry, { state: 'failed', error: brief(data.errorText) });
  } else if (method === 'Network.loadingFinished') {
    Object.assign(entry, { state: 'completed', bytes: data.encodedDataLength });
  }
}

async function keepDownload(data) {
  const started = downloads.get(data.guid);
  if (!started) return;
  downloads.delete(data.guid);
  const path = join(downloadDirectory, data.guid);
  if (data.state !== 'completed' || !tabs.has(started.tabID)) {
    await rm(path, { force: true });
    return;
  }
  const filename = basename(started.name).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120) || 'download';
  const file = captures.reserve(started.tabID, 'download', filename);
  await rename(path, file.path);
  await chmod(file.path, 0o600);
  await captures.keep(file);
}

function event({ method, params: data, sessionId }) {
  const tab = sessions.get(sessionId);

  if (method === 'Target.attachedToTarget' && tab && data.targetInfo.type === 'iframe') {
    tab.childSessions.set(data.targetInfo.targetId, data.sessionId);
    sessions.set(data.sessionId, tab);
    owners.set(data.sessionId, sessionId);
    void setup(data.sessionId).catch(() => {});
  } else if (method === 'Target.detachedFromTarget') {
    const child = sessions.get(data.sessionId);
    for (const [id, session] of child?.childSessions ?? []) {
      if (session === data.sessionId) child.childSessions.delete(id);
    }
    sessions.delete(data.sessionId);
    owners.delete(data.sessionId);
  } else if (method === 'Target.targetDestroyed') {
    if (tabs.has(data.targetId)) void forget(data.targetId).catch(() => {});
  } else if (method === 'Browser.downloadWillBegin') {
    const owner = [...tabs.values()].find((tab) => tab.topFrame === data.frameId || tab.contexts.has(data.frameId));
    if (owner) downloads.set(data.guid, { tabID: owner.id, name: data.suggestedFilename });
    else void browser.send('Browser.cancelDownload', { guid: data.guid }).catch(() => {});
  } else if (method === 'Browser.downloadProgress') {
    if (data.state === 'inProgress' && data.receivedBytes > MAX_FILE) {
      void browser.send('Browser.cancelDownload', { guid: data.guid }).catch(() => {});
    } else if (data.state !== 'inProgress') {
      void keepDownload(data).catch(() => rm(join(downloadDirectory, data.guid), { force: true }).catch(() => {}));
    }
  } else if (method === 'Target.targetCreated' && data.targetInfo.type === 'page' && data.targetInfo.openerId) {
    if (tabs.has(data.targetInfo.openerId) && tabs.size < 12) void attachTab(data.targetInfo.targetId, false).catch(() => {});
    else void browser.send('Target.closeTarget', { targetId: data.targetInfo.targetId }).catch(() => {});
  } else if (method === 'Tracing.tracingComplete') {
    if (trace) trace.stream = data.stream;
  } else if (method === 'HeapProfiler.addHeapSnapshotChunk' && heap?.session === sessionId) {
    heap.length += data.chunk.length;
    if (heap.length <= 36 * 1024 * 1024) heap.chunks.push(data.chunk);
  } else if (tab) {
    if (method === 'Page.frameStartedLoading') tab.loading = true;
    if (method === 'Page.frameStoppedLoading') tab.loading = false;
    if (method.startsWith('Network.')) trackNetwork(tab, method, data, sessionId);
    else if (method === 'Input.dragIntercepted') tab.dragData = data.data;
    else if (method === 'Page.frameNavigated') {
      tab.refs.clear();
      if (sessionId === tab.session && !data.frame.parentId) tab.topFrame = data.frame.id;
    } else if (method === 'Page.navigatedWithinDocument') tab.refs.clear();
    else if (method === 'Runtime.executionContextCreated' && data.context.auxData?.isDefault) {
      const frameId = data.context.auxData.frameId;
      tab.contexts.set(frameId, { id: data.context.id, session: sessionId, parent: owners.get(sessionId) });
    } else if (method === 'Runtime.executionContextsCleared' || method === 'Runtime.executionContextDestroyed') {
      for (const [id, context] of tab.contexts) {
        if (context.session === sessionId && (method.endsWith('Cleared') || context.id === data.executionContextId)) tab.contexts.delete(id);
      }
    } else if (method === 'Runtime.consoleAPICalled') {
      remember(tab.messages, { level: data.type === 'warn' ? 'warning' : data.type,
        text: brief(data.args.map((arg) => arg.value ?? arg.unserializableValue ?? arg.description ?? '').join(' ')), timestamp: data.timestamp });
    } else if (method === 'Runtime.exceptionThrown') {
      remember(tab.messages, { level: 'error', text: brief(data.exceptionDetails.exception?.description ?? data.exceptionDetails.text),
        timestamp: data.timestamp });
    } else if (method === 'Log.entryAdded') {
      const { level, text, timestamp, source } = data.entry;
      remember(tab.messages, { level, text: brief(text), timestamp, source });
    } else if (method === 'Page.javascriptDialogOpening') {
      tab.dialog = { type: data.type, message: brief(data.message), defaultPrompt: brief(data.defaultPrompt), sessionId };
    } else if (method === 'Page.javascriptDialogClosed') tab.dialog = null;
  }
}

async function resetDisconnected() {
  if (!browser || browser.alive) return;
  if (trace?.timer) clearTimeout(trace.timer);
  trace = null;
  await Promise.all([...tabs.keys()].map(forget));
  browser = undefined;
}

async function launch() {
  await resetDisconnected();
  if (browser) return;
  if (!chrome) throw new Error('Install Chrome, Chromium or Brave to use advanced browser debugging.');
  browser = new DevTools(chrome, join(directory, 'profile'), event);
  await browser.send('Browser.resetPermissions');
  for (const name of ['camera', 'microphone', 'geolocation', 'notifications', 'clipboard-read', 'display-capture']) {
    await browser.send('Browser.setPermission', { permission: { name }, setting: 'denied' });
  }
  await browser.send('Target.setDiscoverTargets', { discover: true });
  await browser.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloadDirectory, eventsEnabled: true });
}

async function focus(id) {
  await browser.send('Target.activateTarget', { targetId: id });
  focused = id;
  return { id };
}

async function forget(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  tabs.delete(id);
  for (const session of [tab.session, ...tab.childSessions.values()]) {
    sessions.delete(session);
    owners.delete(session);
  }
  if (focused === id) {
    focused = null;
    const next = tabs.keys().next().value;
    if (next) await focus(next).catch(() => {});
  }
  if (preview?.tabID === id) preview = null;
  if (tab.cpu?.timer) clearTimeout(tab.cpu.timer);
  if (trace?.tabID === id) {
    clearTimeout(trace.timer);
    await (trace.result ?? finishTrace()).catch(() => {});
    trace = null;
  }
  await captures.clear(id);
}

async function openTab(args) {
  const url = webURL(args.url);
  if (tabs.size >= 12) throw new Error('Close a tab before opening another.');
  await launch();
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', background: args.focus === false });
  try {
    const tab = await attachTab(targetId, args.focus !== false);
    const page = new Page(browser, tab);
    if (url !== 'about:blank') await page.navigate(url);
    return { id: targetId, url, ...await listTabs() };
  } catch (error) {
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});
    await forget(targetId);
    throw error;
  }
}

async function attachTab(targetId, shouldFocus) {
  try {
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    const tab = tabState(targetId, sessionId);
    sessions.set(sessionId, tab);
    tabs.set(targetId, tab);
    await setup(sessionId);
    const page = new Page(browser, tab);
    tab.topFrame = (await page.send('Page.getFrameTree')).frameTree.frame.id;
    if (shouldFocus) await focus(targetId);
    return tab;
  } catch (error) {
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});
    await forget(targetId);
    throw error;
  }
}

async function listTabs() {
  await resetDisconnected();
  if (!browser) return { tabs: [], activeTabId: null, engine: 'chromium' };
  const { targetInfos } = await browser.send('Target.getTargets');
  const result = [];
  for (const { targetId, title, url } of targetInfos.filter(({ targetId }) => tabs.has(targetId))) {
    const tab = tabs.get(targetId);
    let canGoBack = false; let canGoForward = false;
    try {
      const history = await browser.send('Page.getNavigationHistory', {}, tab.session);
      canGoBack = history.currentIndex > 0;
      canGoForward = history.currentIndex + 1 < history.entries.length;
    } catch { /* closing targets keep their last known state */ }
    result.push({ id: targetId, title: brief(title), url: brief(url), loading: tab.loading === true, canGoBack, canGoForward });
  }
  return { tabs: result, activeTabId: focused, engine: 'chromium' };
}

async function finishTrace() {
  await browser.send('Tracing.end', {}, trace.session);
  const stream = await waitFor(() => trace?.stream, 10_000);
  try {
    const chunks = [];
    let length = 0;
    let eof = false;
    while (!eof) {
      const entry = await browser.send('IO.read', { handle: stream, size: 512 * 1024 }, trace.session);
      const data = Buffer.from(entry.data, entry.base64Encoded ? 'base64' : 'utf8');
      length += data.length;
      if (length > 36 * 1024 * 1024) throw new Error('Trace exceeded the capture limit.');
      chunks.push(data);
      eof = entry.eof;
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    await browser.send('IO.close', { handle: stream }, trace.session).catch(() => {});
  }
}

async function stopCpu(page) {
  const state = page.tab.cpu;
  if (!state) throw new Error('Start CPU sampling first.');
  clearTimeout(state.timer);
  if (!state.result) state.result = page.send('Profiler.stop');
  return state.result;
}

function networkList(tab, contains = '') {
  return { requests: [...tab.requests.values()].filter(({ url }) => url.includes(contains)).slice(-90)
    .map(({ id, url, method, status, state, type, bytes }) => ({ id, url, method, status, state, type, bytes })) };
}

async function networkGet(tab, args) {
  const record = tab.requests.get(args.requestID);
  if (!record) throw new Error('Request ID expired or does not belong to this tab.');
  const { requestId, session, key, ...response } = record;
  if (args.includeBody && tab.activeRequests.get(key) !== record.id) {
    response.bodyUnavailable = 'Chromium only retained the last response in this redirect chain.';
  } else if (args.includeBody) {
    try {
      const { body, base64Encoded } = await browser.send('Network.getResponseBody', { requestId }, session);
      if (!base64Encoded) response.body = brief(body, 16_384);
      else response.bodyUnavailable = 'Binary response';
      response.bodyTruncated = !base64Encoded && body.length > 16_384;
    } catch { response.bodyUnavailable = 'The browser no longer has this response.'; }
  }
  return response;
}

async function fromCapture(tabID, id, kind) {
  return readCompressed(captures.get(tabID, id, kind).path);
}

async function saveCompressed(tabID, kind, name, data) {
  const file = captures.reserve(tabID, kind, name);
  await compressedFile(file.path, data);
  return captures.keep(file);
}

async function fillForm(page, { fields }) {
  for (const { ref, value } of fields) {
    if (typeof value === 'boolean') await page.check(ref, value);
    else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) await page.select(ref, value);
    else if (typeof value === 'string') await page.fill(ref, value);
    else throw new Error('Select values must be strings.');
  }
  return { filled: fields.length };
}

async function filesDrop(page, args, paths) {
  const { x, y } = await page.position(args.ref);
  const data = { items: [], files: paths, dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) {
    await page.send('Input.dispatchDragEvent', { type, x, y, data });
  }
  return { files: paths.length };
}

async function operation(name, args) {
  if (name === 'catalog') return { namespace: 'browser', operations: catalog };
  if (name === 'upload.info') {
    const tab = tabs.get(args.tabID);
    if (!tab) throw new Error('The browser tab is closed.');
    const page = new Page(browser, tab);
    return { url: await page.uploadSite(args.ref), paths: await Promise.all(args.paths.map(path => workspaceFile(workspace, path))) };
  }
  if (name === 'preview.get') return preview ? preview.data ?? previewFile(preview.path) : null;
  const schema = Object.hasOwn(catalog, name) && catalog[name];
  if (!schema) throw new Error('Unknown browser operation. Call catalog to see available operations.');
  const { approval, ...validatedArgs } = args;
  validate(schema.inputSchema, validatedArgs, 'arguments');
  if (name === 'tabs.open') return openTab(args);
  if (name === 'tabs.list') return listTabs();
  if (name === 'preview') {
    const path = await workspaceFile(workspace, args.path);
    const data = await previewFile(path);
    preview = { id: randomUUID(), data };
    return data;
  }
  const id = args.tabID;
  const tab = tabs.get(id);
  if (!tab) throw new Error('Tab ID is not available in this session.');
  const page = new Page(browser, tab);
  switch (name) {
    case 'tabs.focus': await focus(id); return listTabs();
    case 'tabs.close': {
      const result = await browser.send('Target.closeTarget', { targetId: id });
      await forget(id);
      if (tabs.size === 0 && browser) {
        preview = null;
        const closed = browser;
        await Promise.race([closed.shutdown().catch(() => {}), pause(1300)]);
        browser = undefined;
      }
      return { ...result, remainingTabs: tabs.size, ...await listTabs() };
    }
    case 'navigate': return page.navigate(args.url);
    case 'back': return page.history(-1);
    case 'forward': return page.history(1);
    case 'reload': return page.refresh();
    case 'stop': return page.send('Page.stopLoading');
    case 'frames': return page.frames();
    case 'wait': return page.wait(args);
    case 'snapshot': return page.snapshot(args.frameID);
    case 'find': return page.find(args);
    case 'evaluate': return { value: await page.evaluate(args) };
    case 'screenshot': {
      const file = captures.reserve(id, 'screenshot', 'screenshot.png');
      const image = await page.screenshot(args);
      if (image.length > MAX_FILE) throw new Error('Screenshot exceeds 5 MiB.');
      await writeFile(file.path, image, { mode: 0o600 });
      const saved = await captures.keep(file);
      preview = { id: file.id, path: file.path, tabID: id };
      return { ...saved, mimeType: 'image/png', base64: image.toString('base64') };
    }
    case 'click': return page.click(args.ref, args.button, args.count);
    case 'hover': return page.mouse('mouseMoved', await page.position(args.ref));
    case 'drag': return page.drag(args.from, args.to);
    case 'fill': return page.fill(args.ref, args.value);
    case 'fill_form': return fillForm(page, args);
    case 'select': return page.select(args.ref, args.values);
    case 'check': return page.check(args.ref, args.checked);
    case 'press': return page.press(args);
    case 'scroll': {
      if (!args.ref) {
        const expression = `window.scrollBy(${args.deltaX ?? 0},${args.deltaY})`;
        return { value: await page.evaluate({ expression }) };
      }
      return page.onElement(args.ref, 'function (x,y) { this.scrollBy(x,y); }', [args.deltaX ?? 0, args.deltaY]);
    }
    case 'dialog': {
      const dialog = tab.dialog;
      if (!dialog || !args.action || args.action === 'inspect') {
        if (!dialog) return { dialog: null };
        const { type, message, defaultPrompt } = dialog;
        return { dialog: { type, message, defaultPrompt } };
      }
      return page.send('Page.handleJavaScriptDialog', { accept: args.action === 'accept', promptText: args.text }, dialog.sessionId);
    }
    case 'console': {
      const levels = ['verbose', 'debug', 'log', 'info', 'warning', 'error'];
      const min = levels.indexOf(args.level);
      return { messages: tab.messages.filter(({ level }) => min === -1 || levels.indexOf(level) >= min).slice(-80) };
    }
    case 'network.list': return networkList(tab, args.urlContains);
    case 'network.get': return networkGet(tab, args);
    case 'files.upload':
    case 'files.drop': {
      const { node, session } = page.element(args.ref);
      const receivingURL = await page.uploadSite(args.ref);
      const approvedPaths = await Promise.all(args.paths.map(path => workspaceFile(workspace, path)));
      if (approval?.url !== receivingURL || !Array.isArray(approval?.paths) ||
        approval.paths.length !== approvedPaths.length || approvedPaths.some((path, index) => path !== approval.paths[index])) {
        throw new Error('This upload needs explicit permission for these files and the receiving origin.');
      }
      if (uploads >= 20) throw new Error('This session has reached its upload limit. Close the session browser to start a fresh one.');
      const paths = await stageUploads(workspace, directory, args.paths);
      uploads++;
      if (name === 'files.drop') return filesDrop(page, args, paths);
      await page.send('DOM.setFileInputFiles', { backendNodeId: node, files: paths }, session);
      return { files: paths.length };
    }
    case 'files.list': return { files: captures.list(id) };
    case 'files.get': return captures.get(id, args.fileID);
    case 'trace.start': {
      if (trace) throw new Error('A trace is already recording in this session.');
      await browser.send('Tracing.start', { categories: 'devtools.timeline,loading,blink.user_timing,toplevel', transferMode: 'ReturnAsStream' }, tab.session);
      const recording = { tabID: id, session: tab.session };
      recording.timer = setTimeout(() => {
        recording.result = finishTrace();
        recording.result.catch(error => { recording.error = error.message; });
      }, 30000);
      trace = recording;
      return { recording: true };
    }
    case 'trace.stop': {
      if (trace?.tabID !== id) throw new Error('Start a trace for this tab first.');
      clearTimeout(trace.timer);
      try { return await saveCompressed(id, 'trace', 'trace.json.gz', await (trace.result ?? finishTrace())); }
      finally { trace = null; }
    }
    case 'trace.analyze': return traceSummary(await fromCapture(id, args.fileID, 'trace'));
    case 'cpu.start': {
      if (tab.cpu) throw new Error('CPU sampling already started.');
      await page.send('Profiler.enable');
      await page.send('Profiler.start');
      tab.cpu = { timer: setTimeout(() => { void stopCpu(page).catch(() => {}); }, 30_000) };
      return { recording: true };
    }
    case 'cpu.stop': {
      try { return await saveCompressed(id, 'cpu', 'profile.cpuprofile.gz', (await stopCpu(page)).profile); }
      finally { tab.cpu = null; }
    }
    case 'cpu.analyze': return cpuSummary(await fromCapture(id, args.fileID, 'cpu'));
    case 'heap.snapshot': {
      await page.send('HeapProfiler.enable');
      heap = { session: tab.session, length: 0, chunks: [] };
      try {
        await page.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
        if (heap.length > 36 * 1024 * 1024) throw new Error('Heap snapshot exceeded the capture limit.');
        return await saveCompressed(id, 'heap', 'snapshot.heapsnapshot.gz', heap.chunks.join(''));
      } finally { heap = null; }
    }
    case 'heap.summary': {
      const view = heapView(await fromCapture(id, args.fileID, 'heap'));
      return { objects: view.count, classes: view.list.slice(0, 50) };
    }
    case 'heap.query': return { objects: heapView(await fromCapture(id, args.fileID, 'heap')).query(args.query) };
    case 'heap.object': return heapView(await fromCapture(id, args.fileID, 'heap')).object(args.objectID);
    case 'heap.compare': {
      const before = heapView(await fromCapture(id, args.beforeID, 'heap'));
      const after = heapView(await fromCapture(id, args.afterID, 'heap'));
      return { changes: compareHeaps(before, after) };
    }
    case 'lighthouse': {
      if (!chrome) throw new Error('Install Chrome, Chromium or Brave to run Lighthouse.');
      const { targetInfo } = await browser.send('Target.getTargetInfo', { targetId: id });
      const url = webURL(targetInfo.url);
      if (url === 'about:blank') throw new Error('Open an HTTP or HTTPS page before running Lighthouse.');
      const file = captures.reserve(id, 'lighthouse', 'lighthouse.json');
      try {
        const scores = await lighthouseAudit({ executable: lighthouse, chrome, directory, url, file: file.path, signal: lifetime.signal });
        return { scores, report: await captures.keep(file) };
      } catch (error) {
        await rm(file.path, { force: true });
        throw error;
      }
    }
    default: throw new Error('Unknown browser operation.');
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();
lines.on('line', line => {
  if (Buffer.byteLength(line) > 256 * 1024) {
    process.stdout.write(JSON.stringify({ error: 'Browser command exceeds the input limit.' }) + '\n');
    return;
  }
  let message;
  try { message = JSON.parse(line); }
  catch { process.stdout.write(JSON.stringify({ error: 'Invalid browser command JSON.' }) + '\n'); return; }
  queue = queue.then(async () => {
    if (closing) return;
    let reply;
    try {
      const { operation: name, engine, ...input } = message.args ?? {};
      if (name === 'shutdown') {
        process.stdout.write(JSON.stringify({ id: message.id, result: { closed: true }, idle: true }) + '\n', () => { void shutdown(); });
        return;
      }
      if (engine && engine !== 'chromium') throw new Error('This worker supports only the Chromium debug engine.');
      const args = { ...input };
      for (const [alias, canonical] of [['tabId', 'tabID'], ['frameId', 'frameID'], ['requestId', 'requestID'], ['fileId', 'fileID'], ['beforeId', 'beforeID'], ['afterId', 'afterID'], ['objectId', 'objectID']]) {
        if (Object.hasOwn(args, alias)) { args[canonical] = args[alias]; delete args[alias]; }
      }
      const value = await operation(name, args);
      reply = { id: message.id, result: value ?? null, idle: tabs.size === 0 && !preview };
      if (Buffer.byteLength(JSON.stringify(reply)) > (['preview.get', 'preview', 'screenshot'].includes(name) ? 7 * 1024 * 1024 : 600_000)) throw new Error('Browser result exceeds the output limit.');
    } catch (error) { reply = { id: message.id, error: brief(error.message) }; }
    process.stdout.write(JSON.stringify(reply) + '\n');
  }).catch(error => { process.stderr.write(brief(error.message) + '\n'); });
});

async function shutdown() {
  if (closing) return;
  closing = true;
  lifetime.abort();
  if (trace?.timer) clearTimeout(trace.timer);
  for (const tab of tabs.values()) if (tab.cpu?.timer) clearTimeout(tab.cpu.timer);
  await browser?.shutdown().catch(() => {});
  await rm(directory, { recursive: true, force: true }).catch(error => process.stderr.write(brief(error.message) + '\n'));
  process.exit(0);
}
lines.on('close', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
