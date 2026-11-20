// Bundled from this checkout's real React, with no CDN or production app assets.
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

export async function prepareReactFixture() {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const entry = `${root}__zorvo_browser_react_smoke__.js`;
  const source = `
    import React, { useEffect, useState } from 'react';
    import { createRoot } from 'react-dom/client';
    const h = React.createElement;
    window.smokeDocument = crypto.randomUUID();
    function Form() {
      const [text, setText] = useState('original');
      const [choice, setChoice] = useState('a');
      const [checked, setChecked] = useState(false);
      const [fields, setFields] = useState(Array.from({length:40},(_,i)=>'field '+i));
      useEffect(() => { document.querySelector('#forms-ready').dataset.ready='true'; }, []);
      return h('form', {onSubmit:event=>{
        event.preventDefault();
        window.smokeFormSubmitted={text,choice,checked,last:fields[39]};
        document.querySelector('#submitted').textContent=JSON.stringify(window.smokeFormSubmitted);
      }},
        h('h1',null,'Controlled React long form'),
        h('output',{id:'forms-ready'},'React mounted'),
        h('label',null,'Controlled input',h('input',{id:'react-input',value:text,onChange:event=>setText(event.target.value)})),
        h('output',{id:'react-state'},text),
        h('label',{htmlFor:'react-choice'},'Controlled choice'),h('select',{id:'react-choice',value:choice,onChange:event=>setChoice(event.target.value)},h('option',{value:'a'},'Alpha'),h('option',{value:'b'},'Beta')),
        h('label',null,'Controlled check',h('input',{id:'react-check',type:'checkbox',checked,onChange:event=>setChecked(event.target.checked)})),
        fields.map((value,index)=>h('label',{key:index,className:'field'},'Long field '+index,
          h('input',{id:'long-'+index,value,onChange:event=>setFields(old=>old.map((v,i)=>i===index?event.target.value:v))}))),
        h('button',{id:'react-submit',type:'submit'},'Submit controlled form'),
        h('output',{id:'submitted'})
      );
    }
    createRoot(document.querySelector('#react-root')).render(h(Form));
  `;
  const output = await build({
    root,
    configFile: false,
    publicDir: false,
    logLevel: 'error',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [{
      name: 'browser-react-smoke-fixture',
      resolveId(id) { if (id === entry) return entry; },
      load(id) { if (id === entry) return source; },
    }],
    build: {
      write: false,
      minify: false,
      lib: { entry, name: 'ZorvoBrowserFormSmoke', formats: ['iife'] },
    },
  });
  const files = Array.isArray(output) ? output.flatMap(result => result.output) : output.output;
  const script = files.find(file => file.type === 'chunk' && file.isEntry)?.code;
  if (!script) throw new Error('React smoke fixture did not produce an entry script.');
  return {
    script,
    html: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>React browser form smoke</title>
      <style>body{font:18px system-ui;margin:20px}label{display:block;margin:18px 0}input,select,button{font:inherit;max-width:100%}.field{min-height:90px}output{display:block;overflow-wrap:anywhere}</style>
      <main id="react-root"></main><script src="/react.js"></script>`,
  };
}
