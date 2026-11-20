import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { catalog, validate } from './catalog.mjs';
import { headers, documentForNode, Page, tabState, webURL } from './page.mjs';
import { readBounded, stageUploads, workspaceFile } from './files.mjs';
import { compressedFile, cpuSummary, readCompressed, traceSummary } from './analysis.mjs';

test('the browser guide covers every requested initial operation and strict arguments', () => {
  const names = ['tabs.open','tabs.list','tabs.focus','tabs.close','navigate','back','forward','reload','stop','frames','wait',
    'snapshot','find','evaluate','screenshot','preview','click','hover','drag','fill','fill_form','select','check','press','scroll','dialog',
    'console','network.list','network.get','files.upload','files.drop','files.list','files.get','trace.start','trace.stop','trace.analyze',
    'cpu.start','cpu.stop','cpu.analyze','heap.snapshot','heap.summary','heap.query','heap.object','heap.compare','lighthouse'];
  assert.deepEqual(Object.keys(catalog).sort(), names.sort());
  for (const value of [{ tabID: 't', expression: '1', injected: true }, { expression: '1' }]) {
    assert.throws(() => validate(catalog.evaluate.inputSchema, value, 'arguments'));
  }
  assert.throws(() => validate(catalog.scroll.inputSchema, { tabID: 't', deltaY: Infinity }, 'arguments'));
});

test('navigation refuses credentials, files and script schemes; network headers omit secrets', () => {
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:secret@example.com/', 'data:text/html,hello', 'not a url']) assert.throws(() => webURL(url));
  assert.equal(webURL('http://localhost:3000'), 'http://localhost:3000/');
  assert.deepEqual(headers({ Cookie: 'secret', 'Set-Cookie': 'secret', Authorization: 'secret', 'X-API-Key': 'secret', 'X-Access-Token': 'secret', 'Content-Type': 'text/plain' }), { 'Content-Type': 'text/plain' });
});

test('upload scope uses canonical regular files and stages private immutable bytes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'zorvo-cdp-scope-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'workspace'));
  await mkdir(join(root, 'private'));
  await writeFile(join(root, 'outside.txt'), 'outside');
  await writeFile(join(root, 'workspace', 'hello.txt'), 'original');
  await symlink(join(root, 'outside.txt'), join(root, 'workspace', 'link'));
  const workspace = await import('node:fs/promises').then(fs => fs.realpath(join(root, 'workspace')));
  await assert.rejects(workspaceFile(workspace, '../outside.txt'));
  await assert.rejects(workspaceFile(workspace, 'link'));
  await assert.rejects(readBounded(join(root, 'workspace', 'link')));
  const [staged] = await stageUploads(workspace, join(root, 'private'), ['hello.txt']);
  await writeFile(join(root, 'workspace', 'hello.txt'), 'changed');
  assert.equal(await readFile(staged, 'utf8'), 'original');
});

test('upload destination is read from native frame DOM metadata', () => {
  const document = { backendNodeId: 1, documentURL: 'https://parent.example/', children: [{ backendNodeId: 2,
    contentDocument: { backendNodeId: 3, documentURL: 'https://upload.example/form', shadowRoots: [{ backendNodeId: 4 }] } }] };
  assert.equal(documentForNode(document, 4), 'https://upload.example/form');
  assert.equal(documentForNode(document, 99), undefined);
});

test('explicit evaluate expressions are protocol arguments rather than helper source interpolation', async () => {
  const calls = [];
  const fake = { async send(method, args) {
    calls.push({ method, args });
    if (method === 'DOM.resolveNode') return { object: { objectId: 'node' } };
    return { result: { value: 'result' } };
  } };
  const tab = tabState('t', 'session'); tab.refs.set('e1', { node: 12, session: 'session' });
  const page = new Page(fake, tab);
  const expression = "'); throw new Error('injected'); //";
  assert.equal(await page.evaluate({ expression, ref: 'e1' }), 'result');
  const evaluation = calls.find(call => call.method === 'Runtime.callFunctionOn').args;
  assert.ok(!evaluation.functionDeclaration.includes(expression));
  assert.equal(evaluation.arguments[0].value, expression);
});

test('recording analysis reads bounded captures and measures actual protocol units', async t => {
  const root = await mkdtemp(join(tmpdir(), 'zorvo-cdp-analysis-')); t.after(() => rm(root, { recursive: true, force: true }));
  const trace = { traceEvents: [{ ph: 'X', name: 'RunTask', dur: 70000, ts: 1000, tid: 1 }, { ph: 'X', name: 'Layout', dur: 1000 }] };
  await compressedFile(join(root, 'trace.gz'), trace);
  const summary = traceSummary(await readCompressed(join(root, 'trace.gz')));
  assert.equal(summary.longestTasks[0].durationMs, 70);
  assert.equal(summary.eventDurationsMs.Layout, 1);
  const cpu = cpuSummary({ startTime: 0, endTime: 5000, samples: [1], timeDeltas: [1000], nodes: [{ id: 1, callFrame: { functionName: 'work', url: 'fixture', lineNumber: 0 } }] });
  assert.equal(cpu.durationMs, 5); assert.equal(cpu.functions[0].sampledMs, 1);
});

test('the Lighthouse launcher keeps owned subprocesses in its group and adapts group cleanup', async t => {
  const root = await mkdtemp(join(tmpdir(), 'zorvo-audit-group-')); t.after(() => rm(root, { recursive: true, force: true }));
  const entry = join(root, 'fake-cli.mjs');
  await writeFile(entry, `import { spawn, execFileSync } from 'node:child_process';
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
    const group=pid=>Number(execFileSync('ps',['-p',String(pid),'-o','pgid='],{encoding:'utf8'}).trim());
    const sameGroup=group(child.pid)===group(process.pid);
    const exited=new Promise(resolve=>child.once('exit',resolve));
    process.kill(-child.pid,'SIGTERM'); await exited;
    console.log(JSON.stringify({sameGroup,parentAlive:true,childExited:true}));`);
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./lighthouse-runner.mjs', import.meta.url)), entry], { timeout: 5000 });
  assert.deepEqual(JSON.parse(stdout), { sameGroup: true, parentAlive: true, childExited: true });
});
