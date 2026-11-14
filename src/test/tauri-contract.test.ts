import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkContract,
  collectTsStringConsts,
  parseFrontend,
  parseHandlerList,
  parseRustCommands,
  parseRustConsts,
  parseRustEmits,
  type ContractModel,
  type NonLiteralEntry,
} from './helpers/tauri-contract';

/**
 * The wiring between the frontend and the Rust backend: command names, argument keys and event
 * names. The Vitest suite fakes every Tauri command and the Rust tests never see the frontend, so
 * neither notices a renamed command, a misspelled argument key (a camelCase key Tauri does not
 * know fails only at run time) or an event nobody listens to. This test reads both sides as text:
 * the frontend with the TypeScript compiler API, the Rust with a small scanner.
 *
 * Not checked, on purpose: argument types and values, and what a command does. The extractors and
 * the check itself are tested on small snippets in `helpers/tauri-contract.test.ts`.
 */

const ROOT = join(__dirname, '..', '..');

/**
 * Calls whose command name is not a string literal, with the commands they can reach and the
 * keys they pass to each. A new such call fails the test until it is listed here; an entry that
 * no call matches fails too.
 */
const NON_LITERAL_CALLS: NonLiteralEntry[] = [
  {
    // `useStatsRead` runs the command and arguments of its `StatsRequest`, built in the same file.
    file: 'src/hooks/useDiffStats.ts',
    nameExpr: 'current.command',
    calls: [
      { command: 'session_diff_stats', args: ['path', 'target'] },
      { command: 'session_diff_stats_since', args: ['path', 'commit'] },
    ],
  },
  {
    // `runJob` picks install or update; both take only the agent id.
    file: 'src/lib/agent-installs.ts',
    nameExpr: 'command',
    calls: [
      { command: 'install_agent', args: ['agentId'] },
      { command: 'update_agent', args: ['agentId'] },
    ],
  },
];

/** Events Rust emits that the frontend does not listen to, each with the reason. */
const EVENT_ALLOWLIST: Record<string, string> = {};

function filesUnder(dir: string, extensions: string[]): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => extensions.some((extension) => name.endsWith(extension)))
    .map((name) => join(dir, name))
    .sort();
}

const posix = (path: string) => relative(ROOT, path).split(sep).join('/');

function loadModel(): ContractModel {
  const frontend = filesUnder(join(ROOT, 'src'), ['.ts', '.tsx'])
    .map((path) => ({ file: posix(path), text: readFileSync(path, 'utf8') }))
    .filter(({ file }) => !file.startsWith('src/test/'));
  const consts = collectTsStringConsts(frontend).values;
  const facts = frontend.map(({ file, text }) => parseFrontend(file, text, consts));

  const rust = filesUnder(join(ROOT, 'src-tauri/src'), ['.rs']).map((path) => ({
    file: posix(path),
    text: readFileSync(path, 'utf8'),
  }));
  const rustConsts = rust.flatMap(({ file, text }) => parseRustConsts(text, file));
  const emits = rust.map(({ file, text }) => parseRustEmits(text, file, rustConsts));

  return {
    handlers: parseHandlerList(readFileSync(join(ROOT, 'src-tauri/src/lib.rs'), 'utf8')),
    commands: rust.flatMap(({ file, text }) => parseRustCommands(text, file)),
    invokes: facts.flatMap((f) => f.invokes),
    nonLiteralTable: NON_LITERAL_CALLS,
    indirectUses: facts.flatMap((f) => f.indirectUses),
    unsupported: facts.flatMap((f) => f.unsupported),
    rustEvents: emits.flatMap((e) => e.events),
    unresolvedRustEvents: emits.flatMap((e) => e.unresolved),
    frontendEvents: facts.flatMap((f) => f.events),
    eventAllowlist: EVENT_ALLOWLIST,
  };
}

describe('Tauri contract: frontend calls against the Rust source', () => {
  const model = loadModel();

  it('reads enough of both sides to mean something', () => {
    // A scanner that silently found nothing would pass every check below.
    expect(model.handlers.length).toBeGreaterThan(60);
    expect(model.commands.length).toBeGreaterThan(60);
    expect(model.invokes.length).toBeGreaterThan(60);
    expect(model.rustEvents).toEqual(expect.arrayContaining(['acp-event', 'sign-in-terminal', 'workspace-terminal']));
    expect(model.frontendEvents.length).toBeGreaterThan(10);
  });

  it('registers every #[tauri::command] fn in generate_handler!', () => {
    const registered = new Set(model.handlers);
    const unregistered = model.commands.filter((c) => !registered.has(c.name)).map((c) => `${c.name} (${c.file})`);
    expect(unregistered).toEqual([]);
  });

  it('matches every invoke, argument key and event to the Rust side', () => {
    expect(checkContract(model)).toEqual([]);
  });
});
