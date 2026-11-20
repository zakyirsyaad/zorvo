import { spawn } from 'node:child_process';
import { chmod, mkdir } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';

// Chrome's CDP pipe uses NUL-terminated JSON on child descriptors 3 and 4.
// It has no listening TCP socket and never attaches to the user's profile.
export class DevTools {
  alive = true;
  next = 0;
  pending = new Map();
  buffer = Buffer.alloc(0);
  constructor(executable, directory, event) {
    this.event = event;
    this.ready = mkdir(directory, { recursive: true, mode: 0o700 }).then(async () => {
      await chmod(directory, 0o700);
      this.child = spawn(executable, [
        '--remote-debugging-pipe', `--user-data-dir=${directory}`, '--no-first-run',
        '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
        '--disable-sync', '--disable-extensions', '--disable-breakpad', '--deny-permission-prompts',
        '--disable-features=MediaRouter', '--no-startup-window',
        ...(process.env.ZORVO_BROWSER_HEADLESS === '1' ? ['--headless=new'] : []),
      ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
      this.stderr = '';
      this.child.stderr.on('data', data => { this.stderr = (this.stderr + data.toString()).slice(-8000); });
      this.child.on('error', error => this.close(error.message));
      this.child.on('exit', () => this.close('The Chromium debug browser exited.'));
      this.child.stdio[4].on('data', data => this.receive(data));
      this.child.stdio[4].on('error', error => this.close(error.message));
      this.child.stdio[3].on('error', error => this.close(error.message));
    });
  }
  receive(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    if (this.buffer.length > 40 * 1024 * 1024) { this.close('CDP message exceeded its limit.'); this.child.kill('SIGTERM'); return; }
    let boundary;
    while ((boundary = this.buffer.indexOf(0)) !== -1) {
      const raw = this.buffer.subarray(0, boundary);
      this.buffer = this.buffer.subarray(boundary + 1);
      if (!raw.length) continue;
      let message;
      try { message = JSON.parse(raw.toString('utf8')); }
      catch { this.close('Chromium sent invalid protocol JSON.'); this.child.kill('SIGTERM'); return; }
      if (message.id !== undefined) this.pending.get(message.id)?.(message);
      else this.event(message);
    }
  }
  async send(method, params = {}, sessionId) {
    await this.ready;
    if (!this.alive) throw new Error('The Chromium debug browser is closed.');
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} exceeded its deadline.`)); }, 25000);
      this.pending.set(id, ({ result, error }) => {
        clearTimeout(timer); this.pending.delete(id);
        if (error) reject(new Error(error.message)); else resolve(result);
      });
      this.child.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0', error => {
        if (error) this.pending.get(id)?.({ error: { message: error.message } });
      });
    });
  }
  close(reason = 'The Chromium debug browser is closed.') {
    this.alive = false;
    for (const finish of [...this.pending.values()]) finish({ error: { message: reason } });
  }
  async shutdown() {
    await this.ready.catch(() => {});
    if (!this.child) return;
    const exited = new Promise(resolve => this.child.once('exit', resolve));
    if (this.alive) await this.send('Browser.close').catch(() => {});
    await Promise.race([exited, pause(1000)]);
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill('SIGTERM');
      await Promise.race([exited, pause(1000)]);
    }
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
    this.close();
  }
}
