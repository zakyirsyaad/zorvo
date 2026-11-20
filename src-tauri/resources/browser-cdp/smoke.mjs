// Explicit local integration run: node src-tauri/resources/browser-cdp/smoke.mjs.
// Optional ZORVO_LIGHTHOUSE_PATH tests the installed pinned Lighthouse runtime too.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';

const root = await realpath(await mkdtemp(join(tmpdir(), 'zorvo-browser-debug-smoke-')));
await writeFile(join(root, 'upload.txt'), 'local upload fixture');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Browser fixture</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><h1>Browser fixture</h1>
<label>Name <input id="name" aria-label="Name"></label><button id="change" onclick="this.textContent='Changed'">Change</button>
<label>Choice <select id="choice"><option value="one">One</option><option value="two">Two</option></select></label>
<label><input id="agree" type="checkbox">Agree</label><input id="file" type="file" aria-label="Upload file">
<button id="drop" ondragover="event.preventDefault()" ondrop="event.preventDefault();this.textContent=event.dataTransfer.files[0].name">Drop here</button>
<button draggable="true" id="drag" ondragstart="event.dataTransfer.setData('text/plain','dragged')">Drag me</button>
<iframe title="Child frame" src="/frame"></iframe><div style="height:1800px"></div>
<script>console.log('fixture console');fetch('/data',{headers:{'X-API-Key':'secret-key'}});window.samples=[];</script></html>`;
const server = createServer((req,res) => {
  if (req.url === '/data') { res.setHeader('Set-Cookie','secret-cookie=1; Secure; HttpOnly; SameSite=Strict'); res.setHeader('Content-Type','application/json'); res.end('{"fixture":true}'); }
  else if (req.url === '/frame') { res.setHeader('Content-Type','text/html'); res.end('<html lang="en"><title>Child</title><button>Child button</button></html>'); }
  else { res.setHeader('Content-Type','text/html'); res.end(html); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const worker = spawn(process.execPath, [fileURLToPath(new URL('./main.mjs', import.meta.url))], {
  env: { ...process.env, ZORVO_BROWSER_ROOT: root, ZORVO_BROWSER_DATA: root, ZORVO_BROWSER_HEADLESS: '1' }, stdio: ['pipe','pipe','pipe'],
});
let stderr = ''; worker.stderr.on('data', data => { stderr = (stderr + data).slice(-16000); });
const pending = new Map(); let serial = 0;
const completed = new Set();
createInterface({ input: worker.stdout }).on('line', line => {
  const result = JSON.parse(line); pending.get(result.id)?.(result);
});
function send(operation,args={}) {
  const id = ++serial;
  return new Promise((resolve,reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(operation+' timeout '+stderr)); }, operation === 'lighthouse' ? 100000 : 35000);
    pending.set(id, reply => { clearTimeout(timeout); pending.delete(id);
      if (reply.error) reject(new Error(operation+': '+reply.error)); else { completed.add(operation); resolve(reply.result); }
    });
    worker.stdin.write(JSON.stringify({id,args:{operation,...args}})+'\n');
  });
}
let tabID;
const call = (op,args={})=>send(op,{tabID,...args});
async function ref(label) {
  const snapshot = await call('snapshot');
  const line = snapshot.content.split('\n').find(line => line.includes('"'+label+'"') && /\[ref=e\d+\]/.test(line));
  assert.ok(line, `No ref for ${label}: ${snapshot.content}`);
  return line.match(/\[ref=(e\d+)\]/)[1];
}
try {
  const catalog = await send('catalog'); assert.equal(Object.keys(catalog.operations).length,45);
  const tab = await send('tabs.open',{url}); tabID=tab.id;
  await call('wait',{condition:'load'});
  assert.equal((await send('tabs.list')).tabs.length,1);
  await call('tabs.focus');
  const frames=await call('frames'); assert.ok(frames.frames.length>=2);
  assert.ok((await call('find',{text:'Change'})).matches.length);
  await call('hover',{ref:await ref('Change')});
  await call('click',{ref:await ref('Change')});
  assert.equal((await call('evaluate',{expression:'document.getElementById("change").textContent'})).value,'Changed');
  await call('fill',{ref:await ref('Name'),value:'typed'});
  await call('evaluate',{expression:'Object.defineProperty(HTMLInputElement.prototype,"value",{set(){throw new Error("page-owned setter")}}); document.querySelector=()=>{throw new Error("page-owned query")}; true'});
  await call('press',{ref:await ref('Name'),key:'End'});
  await call('fill_form',{fields:[{ref:await ref('Name'),value:'form value'}]});
  await call('select',{ref:await ref('Choice'),values:['two']});
  await call('check',{ref:await ref('Agree'),checked:true});
  assert.deepEqual((await call('evaluate',{expression:'[document.getElementById("name").value,document.getElementById("choice").value,document.getElementById("agree").checked]'})).value,['form value','two',true]);
  await call('scroll',{deltaY:100});
  const snap=await call('screenshot'); assert.ok(snap.bytes>0);
  assert.equal((await call('files.get',{fileID:snap.id})).id,snap.id);
  assert.ok((await call('files.list')).files.length);
  await send('preview',{path:'upload.txt'}); assert.equal((await send('preview.get')).content,'local upload fixture');
  const uploadRef=await ref('Upload file');
  await assert.rejects(call('files.upload',{ref:uploadRef,paths:['upload.txt']}),/explicit permission/);
  const approval=await call('upload.info',{ref:uploadRef,paths:['upload.txt']});
  await call('files.upload',{ref:uploadRef,paths:['upload.txt'],approval});
  assert.equal((await call('evaluate',{expression:'document.getElementById("file").files[0].name'})).value,'upload.txt');
  const dropRef=await ref('Drop here'); const dropApproval=await call('upload.info',{ref:dropRef,paths:['upload.txt']});
  await call('files.drop',{ref:dropRef,paths:['upload.txt'],approval:dropApproval});
  assert.equal((await call('evaluate',{expression:'document.getElementById("drop").textContent'})).value,'upload.txt');
  const dragRef=await ref('Drag me');
  const targetRef=await ref('upload.txt');
  await call('drag',{from:dragRef,to:targetRef});
  assert.ok((await call('console')).messages.some(item=>item.text.includes('fixture console')));
  const requests=await call('network.list',{urlContains:'/data'}); assert.ok(requests.requests.length);
  const request=await call('network.get',{requestID:requests.requests[0].id,includeBody:true});
  assert.equal(request.body,'{"fixture":true}');
  assert.ok(!JSON.stringify(request.requestHeaders).includes('secret-key'));
  assert.ok(!JSON.stringify(request.responseHeaders).includes('secret-cookie'));
  await call('trace.start'); await call('cpu.start');
  await call('evaluate',{expression:'(()=>{const start=performance.now();while(performance.now()-start<150){ window.samples.push(Math.random()); }return samples.length})()'});
  const cpu=await call('cpu.stop'); assert.ok((await call('cpu.analyze',{fileID:cpu.id})).samples>0);
  const trace=await call('trace.stop'); assert.ok((await call('trace.analyze',{fileID:trace.id})).events>0);
  const before=await call('heap.snapshot'); const summary=await call('heap.summary',{fileID:before.id}); assert.ok(summary.objects>0);
  const query=await call('heap.query',{fileID:before.id,query:'Array'}); assert.ok(query.objects.length);
  assert.equal((await call('heap.object',{fileID:before.id,objectID:query.objects[0].id})).id,query.objects[0].id);
  await call('evaluate',{expression:'window.moreObjects=Array.from({length:1000},()=>({fixture:true}))'});
  const after=await call('heap.snapshot'); assert.ok(Array.isArray((await call('heap.compare',{beforeID:before.id,afterID:after.id})).changes));
  await call('evaluate',{expression:'setTimeout(()=>alert("fixture dialog"),100); true'}); await pause(250);
  assert.equal((await call('dialog')).dialog.message,'fixture dialog'); await call('dialog',{action:'dismiss'});
  await call('navigate',{url:url+'second'}); await call('wait',{condition:'load'});
  await call('back'); await call('wait',{condition:'load'}); await call('forward'); await call('wait',{condition:'load'});
  await call('reload'); await call('wait',{condition:'load'}); await call('stop');
  if(process.env.ZORVO_LIGHTHOUSE_PATH) { const audit=await call('lighthouse'); assert.ok(audit.scores.performance>=0); }
  const extra = await send('tabs.open',{url});
  const last = await send('tabs.open',{url});
  await send('tabs.close',{tabID:last.id});
  assert.equal((await send('tabs.list')).activeTabId,tabID);
  await send('tabs.close',{tabID:extra.id});
  assert.equal((await send('tabs.list')).activeTabId,tabID);
  await call('tabs.close'); assert.equal((await send('tabs.list')).tabs.length,0);
  const expected=Object.keys(catalog.operations).filter(name=>name!=='lighthouse'||process.env.ZORVO_LIGHTHOUSE_PATH);
  assert.deepEqual(expected.filter(name=>!completed.has(name)),[]);
  console.log(JSON.stringify({engine:'Chromium/CDP',operationsTested:expected.length,operations:[...completed].sort(),allPassed:true},null,2));
} finally {
  worker.stdin.end();
  const exit = new Promise(resolve=>worker.once('exit',resolve));
  await Promise.race([exit,pause(4000)]);
  if(worker.exitCode===null){worker.kill('SIGTERM');await Promise.race([exit,pause(2000)]);}
  server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
  await rm(root,{recursive:true,force:true});
}
