const catalog = {};
const string = { type: 'string' };
const number = { type: 'number' };
const integer = { type: 'integer' };
const boolean = { type: 'boolean' };
const strings = { type: 'array', items: string };
const oneOf = (...values) => ({ type: 'string', enum: values });
const add = (operation, description, properties = {}, required = []) => {
  catalog[operation] = { description, inputSchema: { type: 'object', properties, required, additionalProperties: false } };
};
const tab = (operation, description, properties = {}, required = []) =>
  add(operation, description, { tabID: string, ...properties }, ['tabID', ...required]);

add('tabs.list', 'List the current session’s browser tabs.');
add('tabs.open', 'Open an HTTP or HTTPS page or a blank tab.', { url: string, focus: boolean });
tab('tabs.focus', 'Bring a browser tab to the front.');
tab('tabs.close', 'Close a tab and discard its captured diagnostics.');
tab('navigate', 'Load an HTTP or HTTPS URL or about:blank.', { url: string }, ['url']);
tab('back', 'Open the previous history entry.');
tab('forward', 'Open the next history entry.');
tab('reload', 'Reload the current document.');
tab('stop', 'Stop loading the current document.');
tab('frames', 'List the page’s frame IDs.');
tab('wait', 'Wait for the document or the presence or absence of visible text.', {
  condition: oneOf('load', 'visible', 'hidden'), text: string, frameID: string, timeoutMs: integer,
}, ['condition']);
tab('snapshot', 'Read the accessibility tree and refresh element references.', { frameID: string });
tab('find', 'Search the accessibility tree for text.', { text: string, frameID: string }, ['text']);
tab('evaluate', 'Evaluate JavaScript in a page, a frame or on an element.', {
  expression: string, frameID: string, ref: string,
}, ['expression']);
tab('screenshot', 'Save a PNG screenshot and show it in the Browser panel.', { fullPage: boolean, ref: string });
add('preview', 'Show a workspace image, text file or PDF in the Browser panel.', { path: string }, ['path']);
tab('click', 'Click an element reference.', { ref: string, button: oneOf('left', 'right', 'middle'), count: integer }, ['ref']);
tab('hover', 'Move the pointer over an element.', { ref: string }, ['ref']);
tab('drag', 'Drag an element to another element.', { from: string, to: string }, ['from', 'to']);
tab('fill', 'Replace an editable element’s text.', { ref: string, value: string }, ['ref', 'value']);
tab('fill_form', 'Fill text, select and checkbox fields in order.', {
  fields: { type: 'array', maxItems: 30, items: { type: 'object', properties: {
    ref: string, value: { type: ['string', 'boolean', 'array'] },
  }, required: ['ref', 'value'], additionalProperties: false } },
}, ['fields']);
tab('select', 'Set the values of a select element.', { ref: string, values: strings }, ['ref', 'values']);
tab('check', 'Set a checkbox or radio button to the given state.', { ref: string, checked: boolean }, ['ref', 'checked']);
tab('press', 'Press a key or a shortcut such as Meta+A.', { key: string, ref: string }, ['key']);
tab('scroll', 'Scroll by CSS pixels.', { deltaX: number, deltaY: number, ref: string }, ['deltaY']);
tab('dialog', 'Inspect, accept or dismiss the current JavaScript dialog.', {
  action: oneOf('inspect', 'accept', 'dismiss'), text: string,
});
tab('console', 'Read recent console messages.', { level: oneOf('all', 'log', 'info', 'warning', 'error') });
tab('network.list', 'List captured requests.', { urlContains: string });
tab('network.get', 'Read one captured request and optionally its response body.', { requestID: string, includeBody: boolean }, ['requestID']);
tab('files.upload', 'Attach workspace files to a file input.', { ref: string, paths: strings }, ['ref', 'paths']);
tab('files.drop', 'Drop workspace files on a page element.', { ref: string, paths: strings }, ['ref', 'paths']);
tab('files.list', 'List captures, reports and downloads for a tab.');
tab('files.get', 'Get the local path of a retained file.', { fileID: string }, ['fileID']);
tab('trace.start', 'Start a Chrome performance trace.');
tab('trace.stop', 'Finish the trace and return its file ID.');
tab('trace.analyze', 'Summarize trace events and long tasks.', { fileID: string }, ['fileID']);
tab('cpu.start', 'Start CPU sampling.');
tab('cpu.stop', 'Finish CPU sampling and return its file ID.');
tab('cpu.analyze', 'Summarize sampled JavaScript functions.', { fileID: string }, ['fileID']);
tab('heap.snapshot', 'Capture a JavaScript heap snapshot.');
tab('heap.summary', 'Summarize heap classes and shallow sizes.', { fileID: string }, ['fileID']);
tab('heap.query', 'Find objects by class or name.', { fileID: string, query: string }, ['fileID', 'query']);
tab('heap.object', 'Inspect a heap object and its direct references.', { fileID: string, objectID: integer }, ['fileID', 'objectID']);
tab('heap.compare', 'Compare counts and shallow sizes in two heap snapshots.', {
  beforeID: string, afterID: string,
}, ['beforeID', 'afterID']);
tab('lighthouse', 'Run Lighthouse against the tab’s URL in a fresh profile.');

export { catalog };

export function validate(schema, value, label) {
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (type === 'number' && !Number.isFinite(value)) throw new Error(`${label} must be finite.`);
  if (!allowed.includes(type) && !(allowed.includes('integer') && Number.isSafeInteger(value))) {
    throw new Error(`${label} must be ${allowed.join(' or ')}.`);
  }
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`Invalid ${label}.`);
  if (type === 'object') {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) throw new Error(`Missing ${key}.`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties ?? {}, key)) throw new Error(`Unexpected field ${key}.`);
      validate(schema.properties[key], child, key);
    }
  }
  if (type === 'array') {
    if (value.length > (schema.maxItems ?? 32)) throw new Error(`Too many items in ${label}.`);
    if (schema.items) for (const child of value) validate(schema.items, child, label);
  }
  if (type === 'string' && value.length > 32_000) throw new Error(`${label} is too long.`);
}
