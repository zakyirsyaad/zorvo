// Synthetic native-browser smoke page. No model/provider calls or personal data.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { prepareReactFixture } from './react-smoke-fixture.mjs';
const react = await prepareReactFixture();
const server = http.createServer((request, response) => {
  if (!['127.0.0.1', 'localhost'].includes(request.headers.host?.split(':')[0])) {
    response.writeHead(403).end(); return;
  }
  if (request.url === '/react' || request.url === '/react.js') {
    response.writeHead(200, { 'Content-Type': request.url === '/react' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(request.url === '/react' ? react.html : react.script);
    return;
  }
  if (request.url === '/csp') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'" });
    response.end('<!doctype html><meta charset="utf-8"><title>Strict CSP browser smoke</title><h1 id="strict-ready">Strict CSP</h1><label>Strict input <input id="strict-input" aria-label="Strict input"></label>');
    return;
  }
  if (request.url === '/delayed') {
    setTimeout(() => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('<!doctype html><button id="delayed-ready" onclick="this.textContent=Number(this.textContent)+1">0</button>');
    }, 400);
    return;
  }
  if (request.url === '/pending-image') {
    response.writeHead(200, { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' });
    const timer = setTimeout(() => response.end(), 15000);
    response.once('close', () => clearTimeout(timer));
    return;
  }
  if (request.url === '/loading') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('<!doctype html><button id="loading-ready" onclick="this.textContent=Number(this.textContent)+1">0</button><img src="/pending-image" alt="Pending fixture image">');
    return;
  }
  if (request.url.split('?')[0] === '/responsive') {
    // Header data stays a string literal even if it contains HTML/script syntax.
    const info = JSON.stringify({ ua: request.headers['user-agent'] ?? '', document: randomUUID() }).replace(/</g, '\\u003c');
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Responsive browser smoke</title>
      <style>*{box-sizing:border-box}body{margin:0;font:18px system-ui;--layout:wide}main{padding:16px;max-width:100%}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}article{border:1px solid currentColor;padding:12px;overflow-wrap:anywhere}input{max-width:100%;font:inherit}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:600px){body{--layout:narrow}.cards{grid-template-columns:1fr}}</style>
      <main><h1>Responsive browser smoke</h1><label>Resize state <input id="responsive-input" value="original"></label><div class="cards"><article>First fluid card</article><article>Second fluid card</article><article>Third fluid card</article></div><pre id="request-ua"></pre><output id="responsive-status">Ready</output></main>
      <script>window.responsiveRequest=${info};sessionStorage.setItem('responsive-loads',String(Number(sessionStorage.getItem('responsive-loads')||0)+1));document.querySelector('#request-ua').textContent=window.responsiveRequest.ua;document.querySelector('#responsive-status').id='responsive-ready';</script>`);
    return;
  }
  const frame = request.url.startsWith('/frame');
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(`<!doctype html><meta charset="utf-8"><title>Browser smoke</title>
  <style>body{font:18px system-ui;padding:20px}section{height:1500px}input,button,select{font:inherit}</style>
  <h1>Browser smoke</h1><label>Smoke input <input id="input" value="original"></label>
  <button id="increment" onclick="document.querySelector('#count').textContent=++window.smokeCount">Increment</button><output id="count">0</output>
  <label>Choice <select id="choice"><option value="a">Alpha</option><option value="b">Beta</option></select></label>
  <label>Check <input id="check" type="checkbox"></label>
  <label>Password <input id="secret-password" type="password" value="synthetic-password-secret"></label>
  <label>Code <input id="secret-code" autocomplete="one-time-code" value="synthetic-code-secret"></label>
  <label>Card number <input id="secret-card" autocomplete="section-checkout billing cc-number" value="synthetic-card-secret"></label>
  <textarea autocomplete="cc-number">synthetic-unlabeled-card-secret</textarea>
  <label>Card code<textarea autocomplete="cc-csc">synthetic-wrapped-card-secret</textarea></label>
  <a id="popup-link" href="/frame?popup=user" target="_blank" rel="opener">Open background popup</a>
  <div id="drag" draggable="true">Drag</div><div id="drop">Drop here</div>
  ${frame ? '' : `<iframe title="Same origin" src="/frame"></iframe><iframe title="Other origin" src="http://localhost:${server.address().port}/frame"></iframe>`}
  <div id="nested-scroll" style="height:120px;overflow:auto"><div style="height:800px">Nested scroll target</div></div>
  <x-widget></x-widget><section>Scroll test</section><p id="end">End of page</p>
  <script>window.smokeDocument=${JSON.stringify(randomUUID())};window.smokeCount=0;console.info('browser-smoke-console');window.addEventListener('input',()=>document.body.dataset.inputEvents=String(+(document.body.dataset.inputEvents||0)+1));
  const root=document.querySelector('x-widget').attachShadow({mode:'open'});root.innerHTML='<x-inner></x-inner>';const inner=root.querySelector('x-inner').attachShadow({mode:'open'});inner.innerHTML='<button>Shadow increment</button><input aria-label="Shadow input"><output>0</output>';inner.querySelector('button').onclick=()=>inner.querySelector('output').textContent=String(Number(inner.querySelector('output').textContent)+1);
  </script>`);
});
server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
