import { describe, expect, it } from 'vitest';
import {
  checkContract,
  collectTsStringConsts,
  parseFrontend,
  parseHandlerList,
  parseRustCommands,
  parseRustConsts,
  parseRustEmits,
  snakeToCamel,
  stripRustComments,
  type ContractModel,
} from './tauri-contract';

/**
 * Unit tests of the extractors and of `checkContract` on small inline snippets. They prove each
 * assertion of `src/test/tauri-contract.test.ts` can fail: the real-tree test only shows the
 * current code passes, which says nothing if a check never fires.
 */

describe('snakeToCamel', () => {
  it('turns snake_case into camelCase the way Tauri does', () => {
    expect(snakeToCamel('session_id')).toBe('sessionId');
    expect(snakeToCamel('acp_session_id')).toBe('acpSessionId');
    expect(snakeToCamel('path')).toBe('path');
    expect(snakeToCamel('_unused_value')).toBe('unusedValue');
  });
});

describe('stripRustComments', () => {
  it('blanks line and block comments but keeps strings and line numbers', () => {
    const source = 'let a = "http://x"; // gone\n/* a /* nested */ still */ let b = 1;\n';
    const stripped = stripRustComments(source);
    expect(stripped).toContain('"http://x"');
    expect(stripped).not.toContain('gone');
    expect(stripped).not.toContain('nested');
    expect(stripped).toContain('let b = 1;');
    expect(stripped.split('\n')).toHaveLength(source.split('\n').length);
  });

  it('does not mistake a lifetime or a char for a string start', () => {
    const stripped = stripRustComments("fn a<'a>(x: &'a str) -> char { '\"' } // end\nfn b() {}");
    expect(stripped).toContain('fn b() {}');
    expect(stripped).not.toContain('end');
  });
});

describe('parseHandlerList', () => {
  it('returns the last path segment of each generate_handler entry', () => {
    const source = `
      .invoke_handler(tauri::generate_handler![
        app_update::app_update_check,
        // commented_out,
        get_agent_profiles,
        #[cfg(target_os = "macos")]
        acp::commands::acp_prompt
      ])
    `;
    expect(parseHandlerList(source)).toEqual(['app_update_check', 'get_agent_profiles', 'acp_prompt']);
  });

  it('throws when there is no handler list, so a moved macro cannot pass silently', () => {
    expect(() => parseHandlerList('fn main() {}')).toThrow(/generate_handler/);
  });
});

describe('parseRustCommands', () => {
  it('reads a multi-line command, drops injected parameters and marks Option as optional', () => {
    const source = `
      /// #[tauri::command] in a doc comment is not a command
      #[tauri::command(async)]
      pub fn session_file_diff(
          store: State<'_, AppStore>,
          app: AppHandle,
          path: String,
          target: Option<DiffTarget>,
          acp_session_id: std::option::Option<String>,
      ) -> Result<String, String> {
          Ok(String::new())
      }
    `;
    const [command, ...rest] = parseRustCommands(source, 'changes.rs');
    expect(rest).toEqual([]);
    expect(command).toEqual({
      name: 'session_file_diff',
      file: 'changes.rs',
      params: [
        { rustName: 'path', name: 'path', isOptional: false },
        { rustName: 'target', name: 'target', isOptional: true },
        { rustName: 'acp_session_id', name: 'acpSessionId', isOptional: true },
      ],
    });
  });

  it('reads an async command with no parameters and a generic that holds a comma', () => {
    const source = `
      #[tauri::command]
      pub async fn app_update_check(app: AppHandle, pending: State<'_, PendingAppUpdate>) -> Result<(), String> {}
      #[tauri::command]
      fn save(map: BTreeMap<String, String>, window: tauri::WebviewWindow) {}
    `;
    expect(parseRustCommands(source, 'a.rs').map((c) => [c.name, c.params.map((p) => p.name)])).toEqual([
      ['app_update_check', []],
      ['save', ['map']],
    ]);
  });

  it('refuses rename_all and destructured parameters, which would change the argument keys', () => {
    expect(() => parseRustCommands('#[tauri::command(rename_all = "snake_case")]\nfn a(x_y: String) {}', 'a.rs')).toThrow(
      /rename_all/,
    );
    expect(() => parseRustCommands('#[tauri::command]\nfn a((x, y): (u8, u8)) {}', 'a.rs')).toThrow(/pattern/);
  });
});

describe('Rust events', () => {
  const consts = [
    ...parseRustConsts('pub const EVENT: &str = "workspace-terminal";', 'src/workspace_terminal.rs'),
    ...parseRustConsts('pub const EVENT: &str = "other-event";', 'src/other.rs'),
    ...parseRustConsts('pub const SIGN_IN_EVENT: &str = "github-sign-in-terminal";', 'src/github.rs'),
    ...parseRustConsts('pub const CHANGED: &str = "agent-profiles-changed";', 'src/registry/mod.rs'),
  ];

  it('reads constants with their module, taking mod.rs from the folder name', () => {
    expect(consts.map((c) => `${c.module}::${c.name}=${c.value}`)).toEqual([
      'workspace_terminal::EVENT=workspace-terminal',
      'other::EVENT=other-event',
      'github::SIGN_IN_EVENT=github-sign-in-terminal',
      'registry::CHANGED=agent-profiles-changed',
    ]);
  });

  it('resolves literal, qualified, imported and emit_to event names', () => {
    const source = `
      let _ = app.emit("plain-event", ());
      let _ = app.emit(github::SIGN_IN_EVENT, 1);
      let _ = app.emit(workspace_terminal::EVENT, 1);
      let _ = app.emit(CHANGED, ());
      let _ = app.emit_to("main", "targeted", ());
      // app.emit("commented", ());
    `;
    expect(parseRustEmits(source, 'src/lib.rs', consts)).toEqual({
      events: ['plain-event', 'github-sign-in-terminal', 'workspace-terminal', 'agent-profiles-changed', 'targeted'],
      unresolved: [],
    });
  });

  it('reports an event name it cannot resolve instead of dropping it', () => {
    const source = 'let _ = app.emit(EVENT, ()); let _ = app.emit(name_from_variable, ());';
    expect(parseRustEmits(source, 'src/lib.rs', consts).unresolved).toEqual([
      { file: 'src/lib.rs', expr: 'EVENT' },
      { file: 'src/lib.rs', expr: 'name_from_variable' },
    ]);
  });
});

describe('parseFrontend', () => {
  const parse = (text: string, consts = new Map<string, string>()) => parseFrontend('src/x.ts', text, consts);

  it('collects the command and the keys of the argument object, shorthand and written out', () => {
    const { invokes } = parse(`
      import { invoke } from '@tauri-apps/api/core';
      invoke('a_command', { sessionId, cwd: folder, 'profileId': id });
      invoke<string>("no_args");
      invoke('empty', {});
    `);
    expect(invokes.map((c) => [c.command, c.keys, c.line])).toEqual([
      ['a_command', ['sessionId', 'cwd', 'profileId'], 3],
      ['no_args', [], 4],
      ['empty', [], 5],
    ]);
  });

  it('flags arguments that are not a plain object literal, so their keys cannot be checked', () => {
    const { invokes } = parse(`
      import { invoke } from '@tauri-apps/api/core';
      invoke('a', args);
      invoke('b', { ...rest, x });
      invoke('c', { [key]: 1 });
    `);
    expect(invokes.map((c) => c.keys)).toEqual([null, null, null]);
  });

  it('reads keys through a conditional spread and a local const, splitting always from sometimes', () => {
    const { invokes } = parse(`
      import { invoke } from '@tauri-apps/api/core';
      function f(answers?: string, target: string) {
        invoke('a', { sessionId, ...(answers ? { answers } : {}) });
        const args = target === 'start' ? { path, since } : { path, target };
        invoke('b', args);
        invoke('c', { ...(answers ? { x: 1, y: 2 } : { x: 3 }) });
      }
    `);
    expect(invokes.map((c) => [c.keys, c.maybeKeys])).toEqual([
      [['sessionId'], ['answers']],
      [['path'], ['since', 'target']],
      [['x'], ['y']],
    ]);
  });

  it('records a command name that is not a string literal with the written expression', () => {
    const { invokes } = parse(`
      import { invoke } from '@tauri-apps/api/core';
      invoke(current.command, current.args);
      invoke(\`tpl_\${x}\`, {});
    `);
    expect(invokes.map((c) => [c.command, c.nameExpr])).toEqual([
      [null, 'current.command'],
      [null, '`tpl_${x}`'],
    ]);
  });

  it('follows an aliased import and a namespace import, and ignores an unrelated invoke', () => {
    const { invokes } = parse(`
      import { invoke as call } from '@tauri-apps/api/core';
      import * as core from '@tauri-apps/api/core';
      call('aliased', { a });
      core.invoke('namespaced', { b });
      const invoke = (x: string) => x;
      invoke('not_tauri');
    `);
    expect(invokes.map((c) => c.command)).toEqual(['aliased', 'namespaced']);
  });

  it('reports a Tauri function used as a value, which a call scan cannot follow', () => {
    const { indirectUses } = parse(`
      import { invoke } from '@tauri-apps/api/core';
      const run = register(invoke);
    `);
    expect(indirectUses).toEqual([{ file: 'src/x.ts', line: 3, name: 'invoke' }]);
  });

  it('collects listen, once and emit names, resolving constants', () => {
    const consts = collectTsStringConsts([
      { file: 'src/lib/events.ts', text: "export const ACP_EVENT = 'acp-event'; const TPL = `tpl-event` as const;" },
    ]);
    const { events } = parse(
      `
      import { listen, once, emit, emitTo } from '@tauri-apps/api/event';
      listen('direct', () => {});
      listen<Payload>(ACP_EVENT, () => {});
      once(TPL, () => {});
      emit('out', 1);
      emitTo('main', 'targeted', 1);
      listen(someVariable, () => {});
    `,
      consts.values,
    );
    expect(events.map((e) => [e.kind, e.name])).toEqual([
      ['listen', 'direct'],
      ['listen', 'acp-event'],
      ['once', 'tpl-event'],
      ['emit', 'out'],
      ['emit', 'targeted'],
      ['listen', null],
    ]);
  });

  it('reports event methods on window and webview objects, which are not scanned', () => {
    const { unsupported } = parse(`
      import { getCurrentWebview } from '@tauri-apps/api/webview';
      getCurrentWebview().listen('x', () => {});
    `);
    expect(unsupported).toEqual([{ file: 'src/x.ts', line: 3, expr: 'getCurrentWebview().listen' }]);
  });
});

describe('collectTsStringConsts', () => {
  it('marks a name defined with two different values as ambiguous', () => {
    const { values, ambiguous } = collectTsStringConsts([
      { file: 'a.ts', text: "export const EVENT = 'one'; export const SAME = 'x';" },
      { file: 'b.ts', text: "const EVENT = 'two'; const SAME = 'x';" },
    ]);
    expect(values.get('SAME')).toBe('x');
    expect(values.has('EVENT')).toBe(false);
    expect([...ambiguous]).toEqual(['EVENT']);
  });
});

describe('checkContract', () => {
  const good = (): ContractModel => ({
    handlers: ['get_thing', 'set_thing'],
    commands: [
      {
        name: 'get_thing',
        file: 'a.rs',
        params: [{ rustName: 'session_id', name: 'sessionId', isOptional: false }],
      },
      {
        name: 'set_thing',
        file: 'a.rs',
        params: [
          { rustName: 'session_id', name: 'sessionId', isOptional: false },
          { rustName: 'value', name: 'value', isOptional: true },
        ],
      },
    ],
    invokes: [
      { file: 'src/a.ts', line: 1, command: 'get_thing', nameExpr: "'get_thing'", keys: ['sessionId'] },
      { file: 'src/a.ts', line: 2, command: 'set_thing', nameExpr: "'set_thing'", keys: ['sessionId'] },
    ],
    nonLiteralTable: [],
    indirectUses: [],
    unsupported: [],
    rustEvents: ['thing-changed'],
    unresolvedRustEvents: [],
    frontendEvents: [
      { file: 'src/a.ts', line: 3, kind: 'listen', name: 'thing-changed', nameExpr: "'thing-changed'" },
    ],
    eventAllowlist: {},
  });

  it('accepts a consistent model', () => {
    expect(checkContract(good())).toEqual([]);
  });

  it('1: fails for a command that is not registered in generate_handler', () => {
    const model = good();
    model.invokes.push({ file: 'src/b.ts', line: 9, command: 'missing_cmd', nameExpr: "'missing_cmd'", keys: [] });
    expect(checkContract(model)).toEqual([expect.stringContaining('src/b.ts:9 invokes "missing_cmd", which is not registered')]);
  });

  it('1: fails for a registered command that has no #[tauri::command] fn', () => {
    const model = good();
    model.handlers.push('ghost');
    model.invokes.push({ file: 'src/b.ts', line: 9, command: 'ghost', nameExpr: "'ghost'", keys: [] });
    expect(checkContract(model)).toEqual([expect.stringContaining('"ghost" is registered but no #[tauri::command] fn')]);
  });

  it('2: fails for an argument key the command does not take', () => {
    const model = good();
    model.invokes[0] = { ...model.invokes[0]!, keys: ['sessionId', 'sesionId'] };
    expect(checkContract(model)).toEqual([expect.stringContaining('passes "sesionId" to "get_thing"')]);
  });

  it('2: fails for a snake_case key, since Tauri expects camelCase', () => {
    const model = good();
    model.invokes[0] = { ...model.invokes[0]!, keys: ['session_id'] };
    const violations = checkContract(model);
    expect(violations).toContainEqual(expect.stringContaining('passes "session_id" to "get_thing"'));
    expect(violations).toContainEqual(expect.stringContaining('does not pass required "sessionId"'));
  });

  it('3: a key passed only on some paths is allowed but does not satisfy a required parameter', () => {
    const model = good();
    model.invokes[0] = { ...model.invokes[0]!, keys: [], maybeKeys: ['sessionId'] };
    expect(checkContract(model)).toEqual([expect.stringContaining('does not pass required "sessionId" to "get_thing"')]);
    model.invokes[1] = { ...model.invokes[1]!, keys: ['sessionId'], maybeKeys: ['value'] };
    model.invokes[0] = { ...model.invokes[0]!, keys: ['sessionId'], maybeKeys: [] };
    expect(checkContract(model)).toEqual([]);
    model.invokes[1] = { ...model.invokes[1]!, maybeKeys: ['typo'] };
    expect(checkContract(model)).toEqual([expect.stringContaining('passes "typo" to "set_thing"')]);
  });

  it('3: fails when a required parameter is not passed, and accepts an omitted Option', () => {
    const model = good();
    model.invokes[1] = { ...model.invokes[1]!, keys: [] };
    expect(checkContract(model)).toEqual([expect.stringContaining('does not pass required "sessionId" to "set_thing"')]);
  });

  it('2/3: fails for arguments that are not an object literal, which cannot be checked', () => {
    const model = good();
    model.invokes[0] = { ...model.invokes[0]!, keys: null };
    expect(checkContract(model)).toEqual([expect.stringContaining('arguments are not a plain object literal')]);
  });

  it('4: fails for an event the frontend listens to that nothing emits', () => {
    const model = good();
    model.frontendEvents.push({ file: 'src/c.ts', line: 4, kind: 'listen', name: 'typo-event', nameExpr: "'typo-event'" });
    expect(checkContract(model)).toEqual([expect.stringContaining('src/c.ts:4 listens to "typo-event", which nothing emits')]);
  });

  it('4: accepts an event the frontend emits itself, such as the popout bridge', () => {
    const model = good();
    model.frontendEvents.push(
      { file: 'src/c.ts', line: 4, kind: 'emit', name: 'popout-ready', nameExpr: "'popout-ready'" },
      { file: 'src/d.ts', line: 5, kind: 'listen', name: 'popout-ready', nameExpr: "'popout-ready'" },
    );
    expect(checkContract(model)).toEqual([]);
  });

  it('4: fails for an event Rust emits that nothing listens to, unless allowlisted with a reason', () => {
    const model = good();
    model.rustEvents.push('orphan-event');
    expect(checkContract(model)).toEqual([expect.stringContaining('"orphan-event" is emitted but the frontend never listens to it')]);
    model.eventAllowlist = { 'orphan-event': 'kept for a future window' };
    expect(checkContract(model)).toEqual([]);
  });

  it('4: fails for an allowlist entry that is no longer needed or has no reason', () => {
    const model = good();
    model.eventAllowlist = { 'thing-changed': 'was orphaned once', 'gone-event': '' };
    expect(checkContract(model)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('allowlist entry "thing-changed" is listened to'),
        expect.stringContaining('allowlist entry "gone-event" needs a reason'),
      ]),
    );
  });

  it('4: fails for an event name that cannot be resolved on either side', () => {
    const model = good();
    model.unresolvedRustEvents.push({ file: 'src/x.rs', expr: 'NAME' });
    model.frontendEvents.push({ file: 'src/e.ts', line: 7, kind: 'listen', name: null, nameExpr: 'someVariable' });
    expect(checkContract(model)).toEqual([
      expect.stringContaining('src/x.rs emits an event named by `NAME`'),
      expect.stringContaining('src/e.ts:7 names an event with `someVariable`'),
    ]);
  });

  it('5: fails for a call whose command name is not a literal until it is in the table', () => {
    const model = good();
    model.invokes.push({ file: 'src/f.ts', line: 8, command: null, nameExpr: 'cmd', keys: ['sessionId'] });
    expect(checkContract(model)).toEqual([expect.stringContaining('src/f.ts:8 invokes `cmd`, which is not a string literal')]);

    model.nonLiteralTable.push({
      file: 'src/f.ts',
      nameExpr: 'cmd',
      calls: [{ command: 'get_thing', args: ['sessionId'] }],
    });
    expect(checkContract(model)).toEqual([]);
  });

  it('5: checks the table entries like literal calls, and rejects an entry nothing uses', () => {
    const model = good();
    model.invokes.push({ file: 'src/f.ts', line: 8, command: null, nameExpr: 'cmd', keys: null });
    model.nonLiteralTable.push(
      { file: 'src/f.ts', nameExpr: 'cmd', calls: [{ command: 'get_thing', args: ['wrong'] }, { command: 'nope', args: [] }] },
      { file: 'src/stale.ts', nameExpr: 'old', calls: [] },
    );
    const violations = checkContract(model);
    expect(violations).toContainEqual(expect.stringContaining('passes "wrong" to "get_thing"'));
    expect(violations).toContainEqual(expect.stringContaining('does not pass required "sessionId" to "get_thing"'));
    expect(violations).toContainEqual(expect.stringContaining('"nope", which is not registered'));
    expect(violations).toContainEqual(expect.stringContaining('table entry src/stale.ts `old` matches no call'));
  });

  it('fails for a Tauri function used as a value or an event call on a window object', () => {
    const model = good();
    model.indirectUses.push({ file: 'src/g.ts', line: 2, name: 'invoke' });
    model.unsupported.push({ file: 'src/h.ts', line: 3, expr: 'win.listen' });
    expect(checkContract(model)).toEqual([
      expect.stringContaining('src/g.ts:2 uses `invoke` as a value'),
      expect.stringContaining('src/h.ts:3 calls `win.listen`'),
    ]);
  });
});
