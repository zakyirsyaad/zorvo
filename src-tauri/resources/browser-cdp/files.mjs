import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { MAX_FILE } from './analysis.mjs';
import { fileURLToPath } from 'node:url';

function within(root, path) {
  const tail = relative(root, path);
  return tail !== '' && tail !== '..' && !tail.startsWith(`..${sep}`) && !isAbsolute(tail);
}

export async function readBounded(path, sizeLimit = MAX_FILE) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > sizeLimit) throw new Error('Select a regular file within the size limit.');
    const buffer = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== stat.size) throw new Error('The file changed while it was being read.');
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function workspaceFile(root, path) {
  const resolved = resolve(root, path);
  if (!within(root, resolved)) throw new Error('Choose a file in the session workspace.');
  const canonical = await realpath(resolved);
  if (!within(root, canonical)) throw new Error('Choose a file in the session workspace.');
  return canonical;
}

export async function stageUploads(root, directory, paths) {
  if (!paths.length) throw new Error('Specify at least one file.');
  const staging = await mkdtemp(join(directory, 'upload-'));
  let remaining = MAX_FILE;
  const files = [];
  try {
    for (const path of paths) {
      const source = await workspaceFile(root, path);
      const data = await readBounded(source, remaining);
      remaining -= data.length;
      const targetDir = join(staging, String(files.length));
      await mkdir(targetDir, { mode: 0o700 });
      const target = join(targetDir, basename(source));
      await writeFile(target, data, { mode: 0o600 });
      files.push(target);
    }
    return files;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

const formats = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.pdf': 'application/pdf', '.md': 'text/plain', '.txt': 'text/plain', '.html': 'text/plain', '.svg': 'text/plain',
  '.css': 'text/plain', '.js': 'text/plain', '.ts': 'text/plain', '.tsx': 'text/plain', '.json': 'text/plain',
  '.csv': 'text/plain', '.tsv': 'text/plain', '.mmd': 'text/plain', '.log': 'text/plain',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

export async function previewFile(path) {
  const mime = formats[extname(path).toLowerCase()];
  if (!mime) throw new Error('This file type cannot be previewed.');
  const data = await readBounded(path);
  return { mime, title: basename(path), content: mime === 'text/plain' ? data.toString('utf8') : data.toString('base64') };
}

export async function lighthouseAudit({ executable, chrome, directory, url, file, signal }) {
  if (!executable) throw new Error('Install the Lighthouse CLI on this Mac to run an audit.');
  const profile = await mkdtemp(join(directory, 'audit-'));
  try {
    await new Promise((resolve, reject) => {
      const task = spawn(process.execPath, [fileURLToPath(new URL('./lighthouse-runner.mjs', import.meta.url)), executable,
        '--quiet', '--output=json', `--output-path=${file}`,
        '--only-categories=accessibility,best-practices,seo,performance',
        '--chrome-flags=--headless --no-first-run',
        '--', url,
      ], { env: { HOME: process.env.HOME, TMPDIR: profile, PATH: process.env.PATH, CHROME_PATH: chrome },
        stdio: 'ignore' });
      const kill = () => {
        if (!task.pid) return;
        // Audit descendants inherit the worker's owned process group so the
        // Rust parent can remove them too if the worker itself is force-killed.
        // For this audit's own timeout, end only its descendant tree.
        execFile('ps', ['-axo', 'pid=,ppid='], { timeout: 2000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
          if (!error) {
            const rows = stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
            const owned = new Set([task.pid]);
            for (let pass = 0; pass < 16; pass++) for (const [pid, parent] of rows) if (owned.has(parent)) owned.add(pid);
            for (const pid of [...owned].reverse()) {
              if (pid <= 1 || !Number.isSafeInteger(pid)) continue;
              try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ }
            }
          } else task.kill('SIGKILL');
        });
      };
      const timeout = setTimeout(() => {
        kill();
        reject(new Error('Lighthouse exceeded its time limit.'));
      }, 75_000);
      const cleanup = () => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', kill);
      };
      if (signal.aborted) kill();
      else signal.addEventListener('abort', kill, { once: true });
      task.on('error', (error) => { cleanup(); reject(error); });
      task.on('exit', (code) => {
        cleanup();
        if (code === 0) resolve();
        else reject(new Error('Lighthouse could not complete the audit.'));
      });
    });
    const report = JSON.parse(await readBounded(file));
    await chmod(file, 0o600);
    return Object.fromEntries(Object.entries(report.categories).map(([id, value]) => [id, value.score]));
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}

export class Captures {
  #files = new Map();

  constructor(directory) { this.directory = directory; }

  reserve(tabID, kind, name) {
    if (this.#files.size >= 40) throw new Error('This session has reached its capture limit. Close tabs to free their files.');
    const id = randomUUID();
    return { id, tabID, kind, name, path: join(this.directory, `${id}-${name}`) };
  }

  async keep(file) {
    const stat = await lstat(file.path);
    if (!stat.isFile() || stat.size > MAX_FILE || this.#files.size >= 40) {
      await rm(file.path, { force: true });
      throw new Error('Could not keep this file within the capture limits.');
    }
    this.#files.set(file.id, { ...file, bytes: stat.size });
    return this.list(file.tabID).find(({ id }) => id === file.id);
  }

  list(tabID) { return [...this.#files.values()].filter((file) => file.tabID === tabID); }

  get(tabID, id, kind) {
    const file = this.#files.get(id);
    if (!file || file.tabID !== tabID || (kind && file.kind !== kind)) throw new Error('File ID is not available for this tab.');
    return file;
  }

  async clear(tabID) {
    for (const file of this.list(tabID)) {
      this.#files.delete(file.id);
      await rm(file.path, { force: true });
    }
  }
}
