// This helper lives in a named WKContentWorld. Page globals cannot replace it.
// The DOM and all page-provided strings remain untrusted data.
(() => {
  const refs = new Map();
  const reverse = new WeakMap();
  const prefix = `b${crypto.getRandomValues(new Uint32Array(2)).join('')}-`;
  let next = 0;
  let picker = null;
  const bounded = (value, limit = 1000) => String(value ?? '').slice(0, limit);
  const pickText = (value, limit) => Array.from(String(value ?? '')).slice(0, limit).join('');
  const post = data => window.webkit.messageHandlers.zorvoBrowserFrame.postMessage(JSON.stringify(data));
  function stopPicker(cancelled = false) {
    const current = picker;
    picker = null;
    if (!current) return;
    clearTimeout(current.timer);
    current.overlay.remove();
    if (cancelled) post({kind:'picker-cancelled', document:prefix, nonce:current.nonce});
  }
  function pickTarget(event) {
    return event.composedPath().find(node => node instanceof Element && node !== picker?.overlay);
  }
  function selectorFor(el) {
    const levels = [];
    for (let node = el; node instanceof Element && levels.length < 8; node = node.parentElement) {
      let level = node.localName;
      if (node.id) { levels.unshift(`${level}#${CSS.escape(pickText(node.id, 128))}`); break; }
      const siblings = node.parentElement ? [...node.parentElement.children].filter(sibling => sibling.localName === node.localName) : [];
      if (siblings.length > 1) level += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      levels.unshift(level);
    }
    return pickText(levels.join(' > '), 2048);
  }
  window.addEventListener('click', event => {
    if (!event.isTrusted || window !== window.top || picker) return;
    const link = event.composedPath().find(node => node instanceof HTMLAnchorElement);
    if (link?.target.toLowerCase() === '_blank' && /^https?:\/\//i.test(link.href)) {
      post({kind:'popup-link', document:prefix, url:link.href});
    }
  }, true);
  // Capture handlers are installed at document start before page-authored handlers.
  // Hover stays inside the native page; only a trusted final click crosses the data handler.
  window.addEventListener('pointermove', event => {
    if (!picker || !event.isTrusted) return;
    const el = pickTarget(event);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    Object.assign(picker.overlay.style, {left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`});
  }, true);
  window.addEventListener('pointerdown', event => {
    if (!picker || !event.isTrusted) return;
    event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  window.addEventListener('click', event => {
    if (!picker || !event.isTrusted) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const el = pickTarget(event);
    if (!el) return;
    const nonce = picker.nonce;
    const selected = {kind:'picker-selected',document:prefix,nonce,selector:selectorFor(el),text:pickText(el.textContent || el.getAttribute('aria-label') || el.getAttribute('title'),4096).trim(),title:pickText(document.title,512)};
    stopPicker();
    post(selected);
  }, true);
  window.addEventListener('keydown', event => {
    if (picker && event.isTrusted && event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); stopPicker(true);
    }
  }, true);
  function ref(el) {
    let id = reverse.get(el);
    if (!id || !refs.has(id)) {
      id = prefix + (++next); refs.set(id, el); reverse.set(el, id);
      if (refs.size > 5000) refs.delete(refs.keys().next().value);
    }
    return id;
  }
  function target(args) {
    const el = args.ref ? refs.get(args.ref) : document.querySelector(args.selector);
    if (!el || !el.isConnected) throw new Error('The element reference is stale or no element matches. Take a new snapshot.');
    return el;
  }
  function controls(root = document) {
    const elements = [...root.querySelectorAll('a[href],button,input,textarea,select,[role],[contenteditable],summary,iframe,h1,h2,h3')];
    for (const el of [...root.querySelectorAll('*')].slice(0, 20000)) {
      if (el.shadowRoot) elements.push(...controls(el.shadowRoot));
    }
    return elements.slice(0, 1000);
  }
  // Snapshots are a default read, so never include credentials or payment data
  // already present in a form. Explicit page-world evaluate remains grant-bound.
  const sensitiveValue = el => el.type === 'password' || (el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/)
    .some(token => ['current-password', 'new-password', 'one-time-code'].includes(token) || token.startsWith('cc-'));
  // Textarea defaults also appear inside wrapping labels. Exclude sensitive
  // control subtrees from both generated names and the default page text.
  // Text nodes include what the page hides, which innerText left out. Where
  // WebKit can say so (Safari 17.4), an element that is not rendered is skipped.
  const rendered = el => typeof el.checkVisibility !== 'function' || el.checkVisibility({checkVisibilityCSS:true, visibilityProperty:true});
  function readableText(root, limit = 1000) {
    if (!root || sensitiveValue(root)) return '';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.parentElement && !rendered(node.parentElement)) return NodeFilter.FILTER_REJECT;
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          if (sensitiveValue(parent) || ['SCRIPT','STYLE','NOSCRIPT','TEMPLATE'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (parent === root) break;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let text = '', count = 0, node;
    while (count++ < 20000 && text.length < limit && (node = walker.nextNode())) text += node.textContent + ' ';
    return bounded(text, limit);
  }
  const name = el => bounded(el.getAttribute('aria-label') || readableText(el.labels?.[0]) || el.getAttribute('alt') || el.getAttribute('title') || readableText(el) || el.getAttribute('placeholder')).trim();
  const describe = el => ({ref: ref(el), role: el.getAttribute('role') || el.localName, name: name(el),
    ...(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? {...(!sensitiveValue(el) ? {value: bounded(el.value)} : {}), type: el.type, disabled: el.disabled} : {}),
    ...(el instanceof HTMLInputElement && ['checkbox','radio'].includes(el.type) ? {checked: el.checked} : {}),
    ...(el instanceof HTMLAnchorElement ? {url: bounded(el.href, 8192)} : {})});
  function fill(el, value) {
    if (el.isContentEditable) el.textContent = value;
    else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (!setter) throw new Error('This element does not accept text.');
      setter.call(el, value);
    }
    el.dispatchEvent(new Event('input', {bubbles: true}));
    el.dispatchEvent(new Event('change', {bubbles: true}));
  }
  const result = value => JSON.stringify({ok: true, value});
  Object.defineProperty(globalThis, '__zorvoBrowser', {value: Object.freeze({
    async dispatch(encoded) {
      try {
        const a = JSON.parse(encoded);
        let el;
        switch (a.operation) {
          case '__manual_site_clear': {
            if (window !== window.top || location.href !== a.expectedUrl) throw new Error('The page changed. Open site information again before clearing its data.');
            let complete = true;
            for (const storage of ['localStorage', 'sessionStorage']) {
              try { Storage.prototype.clear.call(globalThis[storage]); } catch { complete = false; }
            }
            const boundedTask = async task => {
              let timer;
              try { return await Promise.race([task(), new Promise(resolve => { timer = setTimeout(() => resolve(false), 2500); })]); }
              catch { return false; }
              finally { clearTimeout(timer); }
            };
            const tasks = [];
            if (globalThis.indexedDB) tasks.push(boundedTask(async () => {
              if (typeof indexedDB.databases !== 'function') return false;
              const databases = await indexedDB.databases();
              if (databases.length > 1000) return false;
              const outcomes = await Promise.all(databases.filter(database => typeof database.name === 'string').map(database => new Promise(resolve => {
                const request = indexedDB.deleteDatabase(database.name);
                request.onsuccess = () => resolve(true);
                request.onerror = request.onblocked = () => resolve(false);
              })));
              return outcomes.every(Boolean);
            }));
            if (globalThis.caches) tasks.push(boundedTask(async () => {
              const keys = await caches.keys();
              if (keys.length > 1000) return false;
              return (await Promise.all(keys.map(key => caches.delete(key)))).every(Boolean);
            }));
            if (navigator.serviceWorker) tasks.push(boundedTask(async () => {
              const registrations = await navigator.serviceWorker.getRegistrations();
              if (registrations.length > 1000) return false;
              return (await Promise.all(registrations.map(registration => registration.unregister()))).every(Boolean);
            }));
            const outcomes = await Promise.all(tasks);
            if (location.href !== a.expectedUrl) throw new Error('The page changed while its site data was being cleared.');
            return result({siteDataCleared:complete && outcomes.every(Boolean)});
          }
          case '__manual_pick': {
            if (!a.enabled) { stopPicker(); return result({active:false}); }
            if (window !== window.top || a.document !== prefix || typeof a.nonce !== 'string' || !CSS.supports('color', a.color)) throw new Error('The browser selection request is stale.');
            stopPicker();
            const overlay = document.createElement('div');
            overlay.setAttribute('aria-hidden','true');
            Object.assign(overlay.style,{position:'fixed',pointerEvents:'none',zIndex:'2147483647',boxSizing:'border-box',border:`2px solid ${a.color}`});
            document.documentElement.append(overlay);
            picker = {nonce:a.nonce,overlay,timer:setTimeout(() => stopPicker(true),60000)};
            return result({active:true});
          }
          case 'snapshot': return result({engine:'WebKit', url:location.href, title:document.title, controls:controls().map(describe), text:readableText(document.body, 30000), documentHidden:document.hidden});
          case 'find': { const term = bounded(a.text ?? a.query).toLowerCase(); return result(controls().filter(e => name(e).toLowerCase().includes(term)).map(describe)); }
          case 'wait': {
            const end = performance.now() + Math.min(30000, Math.max(0, Number(a.timeoutMs ?? 10000)));
            do {
              if (a.selector ? document.querySelector(a.selector) : a.text ? document.body?.innerText.includes(a.text) : document.readyState === 'complete') return result({ready:true});
              await new Promise(resolve => setTimeout(resolve, 100));
            } while (performance.now() < end);
            throw new Error('The browser wait timed out.');
          }
          case 'scroll': {
            el = a.ref || a.selector ? target(a) : window;
            el.scrollBy({left:Number(a.x ?? a.deltaX ?? 0), top:Number(a.y ?? a.deltaY ?? 600), behavior:'instant'});
            return result({scrolled:true});
          }
          case 'click': el=target(a); if(a.button && a.button!=='left') el.dispatchEvent(new MouseEvent(a.button==='right'?'contextmenu':'auxclick',{bubbles:true,button:a.button==='right'?2:1})); else { el.click(); if(a.count===2){el.click();el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,detail:2}));} } return result({clicked:true, trusted:false});
          case 'upload_target': el=target(a); return result({fileInput: el instanceof HTMLInputElement && el.type==='file' && !el.disabled});
          case 'fill': fill(target(a), bounded(a.value ?? a.text, 100000)); return result({filled:true,trusted:false});
          case 'select': {
            el=target(a); if (!(el instanceof HTMLSelectElement)) throw new Error('The element is not a select.');
            const values=Array.isArray(a.values)?a.values:[a.value];
            for (const option of el.options) option.selected=values.map(String).includes(option.value);
            el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
            return result({values:[...el.selectedOptions].map(o=>o.value)});
          }
          case 'check': el=target(a); if (!(el instanceof HTMLInputElement) || !['checkbox','radio'].includes(el.type)) throw new Error('The element is not a checkbox or radio.'); if(el.checked !== (a.checked ?? true)) el.click(); return result({checked:el.checked});
          default: throw new Error('Unsupported embedded browser operation.');
        }
      } catch (error) { return JSON.stringify({ok:false,error:bounded(error.message,2000)}); }
    }
  })});
  post({kind:'frame',document:prefix});
  // A page restored from the back-forward cache keeps this helper and runs no
  // document-start script, so it has to say again which document is showing.
  window.addEventListener('pageshow', event => { if (event.persisted) post({kind:'frame',document:prefix}); });
})();
