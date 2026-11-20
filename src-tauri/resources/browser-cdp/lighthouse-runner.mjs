// chrome-launcher normally detaches Chrome on Unix. Keep every audit process
// in the worker's owned process group so the Rust supervisor can end it even
// if this CLI is force-killed. This changes no installed package bytes.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';

const launch = childProcess.spawn;
const children = new Set();
childProcess.spawn = function (command, args, options) {
  const child = launch(command, args, { ...options, detached: false });
  if (child.pid) {
    children.add(child.pid);
    child.once('exit', () => children.delete(child.pid));
  }
  return child;
};
syncBuiltinESMExports();

const signal = process.kill.bind(process);
process.kill = function (pid, name) {
  if (pid >= 0 || !children.has(-pid)) return signal(pid, name);
  // chrome-launcher's cleanup sends to the group it expected to create.
  // These children deliberately share our group, so target their tree instead.
  const owned = new Set([-pid]);
  const rows = childProcess.execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8', timeout: 2000 })
    .trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  for (let pass = 0; pass < 16; pass++) for (const [child, parent] of rows) if (owned.has(parent)) owned.add(child);
  for (const child of [...owned].reverse()) {
    try { signal(child, name); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  return true;
};

const [, , executable, ...args] = process.argv;
if (!executable) throw new Error('A pinned Lighthouse entry point is required.');
process.argv = [process.execPath, executable, ...args];
await import(pathToFileURL(executable).href);
