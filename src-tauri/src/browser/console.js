// Page-world diagnostic data is page controlled, bounded, and never executed.
(() => {
  const lines = [];
  const safe = value => { try { return typeof value === 'string' ? value.slice(0, 2000) : JSON.stringify(value)?.slice(0, 2000); } catch { return '[unserializable]'; } };
  for (const level of ['log','info','warn','error','debug']) {
    const original=console[level].bind(console);
    console[level]=(...args)=>{ lines.push({level,text:args.slice(0,20).map(safe).join(' '),timestamp:Date.now()}); if(lines.length>500)lines.shift(); original(...args); };
  }
  addEventListener('error', event=>{ lines.push({level:'error',text:safe(event.message),timestamp:Date.now()}); if(lines.length>500)lines.shift(); });
  Object.defineProperty(globalThis,'__zorvoConsole',{value:lines});
})();
