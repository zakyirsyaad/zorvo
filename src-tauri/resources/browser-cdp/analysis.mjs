import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';

const compress = promisify(gzip);
const decompress = promisify(gunzip);
export const MAX_FILE = 5 * 1024 * 1024;
const MAX_RECORDING = 36 * 1024 * 1024;

export async function compressedFile(destination, value) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  if (Buffer.byteLength(raw) > MAX_RECORDING) throw new Error('Recording exceeded the capture limit.');
  const data = await compress(raw);
  if (data.length > MAX_FILE) throw new Error('Compressed recording exceeds 5 MiB.');
  await writeFile(destination, data, { mode: 0o600 });
}

export async function readCompressed(path) {
  return JSON.parse(await decompress(await readFile(path), { maxOutputLength: MAX_RECORDING }));
}

export function traceSummary(trace) {
  const events = trace.traceEvents ?? trace;
  const longTasks = [];
  const byCategory = new Map();
  for (const item of events) {
    if (item.ph !== 'X' || typeof item.dur !== 'number') continue;
    const ms = item.dur / 1000;
    const key = item.name;
    if (/^(RunTask|ThreadControllerImpl::RunTask|TaskQueueManager::ProcessTaskFromWorkQueue)$/.test(key) && ms >= 50) {
      longTasks.push({ durationMs: ms, timestampMs: item.ts / 1000, thread: item.tid });
    }
    if (/^(EvaluateScript|FunctionCall|EventDispatch|Layout|UpdateLayoutTree|Paint|RasterTask)$/.test(key)) {
      byCategory.set(key, (byCategory.get(key) ?? 0) + ms);
    }
  }
  return {
    events: events.length,
    longTaskCount: longTasks.length,
    longestTasks: longTasks.sort((a, b) => b.durationMs - a.durationMs).slice(0, 30),
    eventDurationsMs: Object.fromEntries(byCategory),
  };
}

export function cpuSummary(profile) {
  const times = new Map();
  const hits = new Map();
  for (const [index, id] of (profile.samples ?? []).entries()) {
    times.set(id, (times.get(id) ?? 0) + (profile.timeDeltas?.[index] ?? 0) / 1000);
    hits.set(id, (hits.get(id) ?? 0) + 1);
  }
  return {
    durationMs: (profile.endTime - profile.startTime) / 1000,
    samples: profile.samples?.length ?? 0,
    functions: profile.nodes.map(({ id, callFrame }) => ({
      function: callFrame.functionName,
      url: callFrame.url,
      line: callFrame.lineNumber + 1,
      samples: hits.get(id) ?? 0,
      sampledMs: times.get(id) ?? 0,
    })).filter((item) => item.samples).sort((a, b) => b.sampledMs - a.sampledMs).slice(0, 30),
  };
}

export function heapView(profile) {
  const { node_fields: fields, node_types: types, edge_fields: edgeFields, edge_types: edgeTypes } = profile.snapshot.meta;
  const nodes = new Map();
  const classes = new Map();
  const index = Object.fromEntries(fields.map((field, i) => [field, i]));
  let edgeStart = 0;
  for (let i = 0; i < profile.nodes.length; i += fields.length) {
    const raw = profile.nodes;
    const id = raw[i + index.id];
    const name = profile.strings[raw[i + index.name]];
    const type = types[index.type][raw[i + index.type]];
    const size = raw[i + index.self_size];
    const count = raw[i + index.edge_count];
    nodes.set(id, { id, name, type, size, edgeStart, edgeCount: count });
    edgeStart += count * edgeFields.length;
    const entry = classes.get(name) ?? { name, count: 0, bytes: 0 };
    entry.count++;
    entry.bytes += size;
    classes.set(name, entry);
  }
  const list = [...classes.values()].sort((a, b) => b.bytes - a.bytes);
  const summarize = ({ id, name, type, size }) => ({ id, name, type, bytes: size });
  const nameIndex = edgeFields.indexOf('name_or_index');
  const targetIndex = edgeFields.indexOf('to_node');
  const typeIndex = edgeFields.indexOf('type');
  return {
    list,
    count: nodes.size,
    query: (text) => Array.from(nodes.values()).filter((item) => item.name.toLowerCase().includes(text.toLowerCase()))
      .sort((a, b) => b.size - a.size).slice(0, 40).map(summarize),
    object(id) {
      const found = nodes.get(id);
      if (!found) throw new Error('Object ID does not belong to this heap snapshot.');
      const outgoing = [];
      const retainers = [];
      for (const source of nodes.values()) {
        const end = source.edgeStart + source.edgeCount * edgeFields.length;
        for (let i = source.edgeStart; i < end; i += edgeFields.length) {
          const target = nodes.get(profile.nodes[profile.edges[i + targetIndex] + index.id]);
          if (!target || (source !== found && target !== found)) continue;
          const type = edgeTypes[typeIndex][profile.edges[i + typeIndex]];
          const label = profile.edges[i + nameIndex];
          const name = type === 'element' || type === 'hidden' ? String(label) : profile.strings[label];
          if (source === found && outgoing.length < 25) outgoing.push({ name, type, target: summarize(target) });
          if (target === found && retainers.length < 25) retainers.push({ name, type, source: summarize(source) });
        }
      }
      return { ...summarize(found), outgoing, retainers };
    },
  };
}

export function compareHeaps(before, after) {
  const changes = new Map();
  for (const [view, sign] of [[before, -1], [after, 1]]) {
    for (const { name, count, bytes } of view.list) {
      const delta = changes.get(name) ?? { name, countDelta: 0, bytesDelta: 0 };
      delta.countDelta += count * sign;
      delta.bytesDelta += bytes * sign;
      changes.set(name, delta);
    }
  }
  return Array.from(changes.values()).filter(({ countDelta, bytesDelta }) => countDelta || bytesDelta)
    .sort((a, b) => Math.abs(b.bytesDelta) - Math.abs(a.bytesDelta)).slice(0, 40);
}
