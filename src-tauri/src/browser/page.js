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
  const name = el => bounded(el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.getAttribute('alt') || el.getAttribute('title') || el.textContent || el.getAttribute('placeholder')) .trim();
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
  const describe = el => ({ref: ref(el), role: el.getAttribute('role') || el.localName, name: name(el),
    // A password stays in the page: its type and ref are enough to fill the field.
    ...(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? {...(el.type === 'password' ? {} : {value: bounded(el.value)}), type: el.type, disabled: el.disabled} : {}),
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
          case 'snapshot': return result({engine:'WebKit', url:location.href, title:document.title, controls:controls().map(describe), text:bounded(document.body?.innerText, 30000), documentHidden:document.hidden});
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
          case 'fill_form':
            if (!Array.isArray(a.fields) || a.fields.length > 100) throw new Error('Provide up to 100 fields.');
            for (const field of a.fields) {
              const input=target(field);
              if (input instanceof HTMLInputElement && ['checkbox','radio'].includes(input.type)) { if(input.checked!==Boolean(field.value)) input.click(); }
              else if (input instanceof HTMLSelectElement) {
                const values=Array.isArray(field.value)?field.value.map(String):[String(field.value)];
                for(const option of input.options) option.selected=values.includes(option.value);
                input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true}));
              } else fill(input, bounded(field.value, 100000));
            }
            return result({filled:a.fields.length});
          case 'click': el=target(a); if(a.button && a.button!=='left') el.dispatchEvent(new MouseEvent(a.button==='right'?'contextmenu':'auxclick',{bubbles:true,button:a.button==='right'?2:1})); else { el.click(); if(a.count===2){el.click();el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,detail:2}));} } return result({clicked:true, trusted:false});
          case 'hover': el=target(a); el.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})); el.dispatchEvent(new MouseEvent('mousemove',{bubbles:true})); return result({hovered:true,trusted:false});
          case 'drag': {
            el=target({...a,ref:a.from??a.ref}); const to=target({ref:a.to??a.toRef,selector:a.toSelector}); const dataTransfer=new DataTransfer();
            el.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer}));
            to.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer}));
            to.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer}));
            el.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer}));
            return result({dragged:true,trusted:false});
          }
          case 'fill': fill(target(a), bounded(a.value ?? a.text, 100000)); return result({filled:true,trusted:false});
          case 'select': {
            el=target(a); if (!(el instanceof HTMLSelectElement)) throw new Error('The element is not a select.');
            const values=Array.isArray(a.values)?a.values:[a.value];
            for (const option of el.options) option.selected=values.map(String).includes(option.value);
            el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
            return result({values:[...el.selectedOptions].map(o=>o.value)});
          }
          case 'check': el=target(a); if (!(el instanceof HTMLInputElement) || !['checkbox','radio'].includes(el.type)) throw new Error('The element is not a checkbox or radio.'); if(el.checked !== (a.checked ?? true)) el.click(); return result({checked:el.checked});
          case 'press': {
            el=a.ref||a.selector?target(a):document.activeElement; if(!el) throw new Error('No element is focused.');
            const key=bounded(a.key,64); el.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));
            if(key==='Enter' && el.form) el.form.requestSubmit();
            el.dispatchEvent(new KeyboardEvent('keyup',{key,bubbles:true})); return result({pressed:key,trusted:false});
          }
          default: throw new Error('Unsupported embedded browser operation.');
        }
      } catch (error) { return JSON.stringify({ok:false,error:bounded(error.message,2000)}); }
    }
  })});
  post({kind:'frame',document:prefix});
})();
