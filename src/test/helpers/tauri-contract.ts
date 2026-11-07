import ts from 'typescript';

/**
 * Extractors and checker behind `src/test/tauri-contract.test.ts`.
 *
 * The frontend is read with the TypeScript compiler API. The Rust side has no parser here, so
 * it is read with a small scanner that understands comments, string literals and brackets, and
 * refuses (throws) what it does not understand instead of guessing.
 */

// ---------------------------------------------------------------------------------------------
// Rust
// ---------------------------------------------------------------------------------------------

export interface RustParam {
  /** The name in the Rust signature. */
  rustName: string;
  /** The key the frontend must send: Tauri turns `snake_case` into `camelCase`. */
  name: string;
  isOptional: boolean;
}

export interface RustCommand {
  name: string;
  file: string;
  /** Parameters the frontend sends; those Tauri injects (`State`, `AppHandle`, ...) are left out. */
  params: RustParam[];
}

export interface RustConst {
  module: string;
  name: string;
  value: string;
  file: string;
}

export function snakeToCamel(name: string): string {
  const [first = '', ...rest] = name.split('_').filter((part) => part !== '');
  return first + rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

const CHAR_LITERAL = /^'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|.)|[^\\'])'/;

/** End (exclusive) of the string or char literal that starts at `i`, or null when none does. */
function literalEnd(text: string, i: number): number | null {
  const c = text[i];
  if (c === '"') {
    let j = i + 1;
    while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
    return Math.min(j + 1, text.length);
  }
  if (c === 'r' && !/\w/.test(text[i - 1] ?? '')) {
    const raw = /^r(#*)"/.exec(text.slice(i, i + 40));
    if (raw) {
      const closing = `"${raw[1] ?? ''}`;
      const end = text.indexOf(closing, i + raw[0].length);
      return end === -1 ? text.length : end + closing.length;
    }
  }
  if (c === "'") {
    const char = CHAR_LITERAL.exec(text.slice(i, i + 12));
    if (char) return i + char[0].length;
  }
  return null;
}

/** Blanks comments with spaces (keeping newlines), so positions and line numbers stay the same. */
export function stripRustComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i += 1;
      }
    } else if (c === '/' && next === '*') {
      let depth = 0;
      while (i < src.length) {
        if (src[i] === '/' && src[i + 1] === '*') {
          depth += 1;
          out += '  ';
          i += 2;
        } else if (src[i] === '*' && src[i + 1] === '/') {
          depth -= 1;
          out += '  ';
          i += 2;
          if (depth === 0) break;
        } else {
          out += src[i] === '\n' ? '\n' : ' ';
          i += 1;
        }
      }
    } else {
      const end = literalEnd(src, i);
      const stop = end ?? i + 1;
      out += src.slice(i, stop);
      i = stop;
    }
  }
  return out;
}

const OPENERS = '([{';
const CLOSERS = ')]}';

/** Index of the bracket that closes the one at `open`; literals are skipped. */
function findMatching(text: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const end = literalEnd(text, i);
    if (end !== null) {
      i = end;
      continue;
    }
    const c = text[i]!;
    if (OPENERS.includes(c)) depth += 1;
    else if (CLOSERS.includes(c)) {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  throw new Error(`No closing bracket for the one at offset ${open}`);
}

/** Splits at commas outside brackets and literals; `<>` count as brackets, `->` and `=>` do not. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const end = literalEnd(text, i);
    if (end !== null) {
      i = end;
      continue;
    }
    const c = text[i]!;
    const isArrow = c === '>' && (text[i - 1] === '-' || text[i - 1] === '=');
    if (OPENERS.includes(c) || c === '<') depth += 1;
    else if (CLOSERS.includes(c) || (c === '>' && !isArrow)) depth -= 1;
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
    i += 1;
  }
  parts.push(text.slice(start));
  return parts;
}

export function parseHandlerList(source: string): string[] {
  const text = stripRustComments(source);
  const macro = text.indexOf('generate_handler!');
  if (macro === -1) throw new Error('No generate_handler! found');
  const open = text.indexOf('[', macro);
  const inner = text.slice(open + 1, findMatching(text, open)).replace(/#\[[^\]]*\]/g, '');
  return splitTopLevel(inner)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => entry.split('::').pop()!.trim());
}

const INJECTED_TYPE =
  /^&?\s*(?:[A-Za-z_]\w*::)*(?:State|AppHandle|Window|WebviewWindow|Webview|Request|CommandScope|GlobalScope)\b/;
const OPTION_TYPE = /^(?:(?:std|core)::option::)?Option\s*</;
const FN_HEADER = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(/;

/** Index of the first `:` outside brackets that is not half of `::`. */
function paramColon(param: string): number {
  let depth = 0;
  for (let i = 0; i < param.length; i += 1) {
    const c = param[i]!;
    if (OPENERS.includes(c) || c === '<') depth += 1;
    else if (CLOSERS.includes(c) || c === '>') depth -= 1;
    else if (c === ':' && depth === 0 && param[i + 1] !== ':' && param[i - 1] !== ':') return i;
  }
  return -1;
}

function parseParam(param: string, fn: string, file: string): RustParam | null {
  const colon = paramColon(param);
  const pattern = param.slice(0, colon).trim().replace(/^mut\s+/, '');
  if (colon === -1 || !/^[A-Za-z_]\w*$/.test(pattern)) {
    throw new Error(`${file}: unsupported parameter pattern in ${fn}: ${param.trim()}`);
  }
  const type = param.slice(colon + 1).trim();
  if (INJECTED_TYPE.test(type)) return null;
  return { rustName: pattern, name: snakeToCamel(pattern), isOptional: OPTION_TYPE.test(type) };
}

export function parseRustCommands(source: string, file: string): RustCommand[] {
  const text = stripRustComments(source);
  const commands: RustCommand[] = [];
  for (const match of text.matchAll(/#\[\s*tauri::command\b/g)) {
    const open = text.indexOf('[', match.index);
    const attribute = text.slice(open, findMatching(text, open) + 1);
    if (/rename_all/.test(attribute)) throw new Error(`${file}: rename_all is not supported by the contract test`);
    let at = open + attribute.length;
    for (;;) {
      const further = /^\s*#\[/.exec(text.slice(at));
      if (!further) break;
      at = findMatching(text, at + further[0].length - 1) + 1;
    }
    const header = FN_HEADER.exec(text.slice(at, at + 400));
    if (!header) throw new Error(`${file}: no fn after #[tauri::command] at offset ${match.index}`);
    const name = header[1]!;
    const parenOpen = at + header[0].length - 1;
    const inner = text.slice(parenOpen + 1, findMatching(text, parenOpen));
    const params = splitTopLevel(inner)
      .filter((param) => param.trim() !== '')
      .map((param) => parseParam(param, name, file))
      .filter((param): param is RustParam => param !== null);
    commands.push({ name, file, params });
  }
  return commands;
}

function moduleOf(file: string): string {
  const parts = file.split('/');
  const stem = (parts.pop() ?? '').replace(/\.rs$/, '');
  if (stem === 'mod') return parts.pop() ?? 'crate';
  return stem === 'lib' || stem === 'main' ? 'crate' : stem;
}

export function parseRustConsts(source: string, file: string): RustConst[] {
  const text = stripRustComments(source);
  const pattern = /\bconst\s+([A-Z][A-Z0-9_]*)\s*:\s*&(?:'static\s*)?str\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/g;
  return [...text.matchAll(pattern)].map((m) => ({ module: moduleOf(file), name: m[1]!, value: m[2]!, file }));
}

/** Which argument of an emit method holds the event name. */
const EMIT_NAME_ARGUMENT: Record<string, number> = {
  emit: 0,
  emit_str: 0,
  emit_filter: 0,
  emit_to: 1,
  emit_str_to: 1,
};

function resolveRustString(expr: string, file: string, consts: RustConst[]): string | null {
  const literal = /^"((?:[^"\\]|\\.)*)"$/.exec(expr);
  if (literal) return literal[1]!;
  const parts = expr.replace(/^&/, '').split('::').map((part) => part.trim());
  if (!parts.every((part) => /^[A-Za-z_]\w*$/.test(part))) return null;
  const name = parts[parts.length - 1]!;
  const qualifier = parts.length > 1 ? parts[parts.length - 2] : undefined;
  let candidates = consts.filter((c) => c.name === name);
  if (qualifier && !['crate', 'self', 'super'].includes(qualifier)) {
    candidates = candidates.filter((c) => c.module === qualifier);
  } else {
    const sameFile = candidates.filter((c) => c.file === file);
    if (sameFile.length > 0) candidates = sameFile;
  }
  const values = new Set(candidates.map((c) => c.value));
  return values.size === 1 ? [...values][0]! : null;
}

export interface RustEmits {
  events: string[];
  unresolved: { file: string; expr: string }[];
}

export function parseRustEmits(source: string, file: string, consts: RustConst[]): RustEmits {
  const text = stripRustComments(source);
  const result: RustEmits = { events: [], unresolved: [] };
  for (const match of text.matchAll(/\.\s*(emit_str_to|emit_filter|emit_str|emit_to|emit)\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const args = splitTopLevel(text.slice(open + 1, findMatching(text, open)));
    const expr = (args[EMIT_NAME_ARGUMENT[match[1]!]!] ?? '').trim();
    const event = resolveRustString(expr, file, consts);
    if (event === null) result.unresolved.push({ file, expr });
    else result.events.push(event);
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Frontend
// ---------------------------------------------------------------------------------------------

export interface InvokeCall {
  file: string;
  line: number;
  /** The command when its name is a string literal, else null. */
  command: string | null;
  /** The command argument as written, for the table of calls whose name is not a literal. */
  nameExpr: string;
  /** Keys of the argument object; null when it is not a plain object literal (spread, computed, variable). */
  keys: string[] | null;
  /** Keys passed on some paths only (a conditional spread): allowed, but they do not satisfy a required parameter. */
  maybeKeys?: string[];
}

export interface EventUse {
  file: string;
  line: number;
  kind: 'listen' | 'once' | 'emit';
  /** The event name, or null when it could not be resolved. */
  name: string | null;
  nameExpr: string;
}

export interface FrontendFacts {
  invokes: InvokeCall[];
  events: EventUse[];
  /** A Tauri function used as a value (`register(invoke)`), which a scan of calls cannot follow. */
  indirectUses: { file: string; line: number; name: string }[];
  /** Event calls on window or webview objects, which are not scanned. */
  unsupported: { file: string; line: number; expr: string }[];
}

const CORE_MODULE = '@tauri-apps/api/core';
const EVENT_MODULE = '@tauri-apps/api/event';
const WINDOW_MODULES = ['@tauri-apps/api/window', '@tauri-apps/api/webview', '@tauri-apps/api/webviewWindow'];
const EVENT_FUNCTIONS = ['listen', 'once', 'emit', 'emitTo'];

function sourceFileOf(file: string, text: string): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isAsExpression(current) || ts.isParenthesizedExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}

function stringValue(node: ts.Expression): string | null {
  const inner = unwrap(node);
  return ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner) ? inner.text : null;
}

export function collectTsStringConsts(files: { file: string; text: string }[]): {
  values: Map<string, string>;
  ambiguous: Set<string>;
} {
  const values = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const { file, text } of files) {
    for (const statement of sourceFileOf(file, text).statements) {
      if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
      for (const declaration of statement.declarationList.declarations) {
        const value = declaration.initializer ? stringValue(declaration.initializer) : null;
        if (!ts.isIdentifier(declaration.name) || value === null) continue;
        const name = declaration.name.text;
        if (values.has(name) && values.get(name) !== value) ambiguous.add(name);
        values.set(name, value);
      }
    }
  }
  for (const name of ambiguous) values.delete(name);
  return { values, ambiguous };
}

/** Keys an argument object has on every path (`always`) and only on some (`sometimes`). */
interface KeyShape {
  always: Set<string>;
  sometimes: Set<string>;
}

/** The initializer of the `const` named by `id`, found in an enclosing block of the same file. */
function constInitializer(id: ts.Identifier): ts.Expression | null {
  for (let scope: ts.Node | undefined = id.parent; scope; scope = scope.parent) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === id.text) {
          return declaration.initializer ?? null;
        }
      }
    }
  }
  return null;
}

function mergeShape(into: KeyShape, from: KeyShape): void {
  for (const key of from.always) into.always.add(key);
  for (const key of from.sometimes) into.sometimes.add(key);
}

/**
 * Keys of an argument expression: an object literal, a spread of one, a conditional between
 * such, or a local `const` holding one. Null for anything else, whose keys cannot be known.
 */
function keyShapeOf(node: ts.Expression, depth = 0): KeyShape | null {
  const inner = unwrap(node);
  if (depth > 5) return null;
  if (ts.isIdentifier(inner)) {
    const initializer = constInitializer(inner);
    return initializer ? keyShapeOf(initializer, depth + 1) : null;
  }
  if (ts.isConditionalExpression(inner)) {
    const a = keyShapeOf(inner.whenTrue, depth + 1);
    const b = keyShapeOf(inner.whenFalse, depth + 1);
    if (!a || !b) return null;
    const always = new Set([...a.always].filter((key) => b.always.has(key)));
    const sometimes = new Set([...a.always, ...a.sometimes, ...b.always, ...b.sometimes].filter((key) => !always.has(key)));
    return { always, sometimes };
  }
  if (!ts.isObjectLiteralExpression(inner)) return null;
  const shape: KeyShape = { always: new Set(), sometimes: new Set() };
  for (const property of inner.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      shape.always.add(property.name.text);
    } else if (ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name)) {
      shape.always.add(property.name.text);
    } else if (ts.isSpreadAssignment(property)) {
      const spread = keyShapeOf(property.expression, depth + 1);
      if (!spread) return null;
      mergeShape(shape, spread);
    } else {
      return null;
    }
  }
  return shape;
}

interface TauriImports {
  invoke: Set<string>;
  events: Map<string, string>;
  namespaces: Map<string, string>;
  hasWindowImport: boolean;
}

function readImports(sf: ts.SourceFile): TauriImports {
  const imports: TauriImports = { invoke: new Set(), events: new Map(), namespaces: new Map(), hasWindowImport: false };
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = statement.moduleSpecifier.text;
    if (WINDOW_MODULES.includes(module)) imports.hasWindowImport = true;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || (module !== CORE_MODULE && module !== EVENT_MODULE)) continue;
    if (ts.isNamespaceImport(bindings)) {
      imports.namespaces.set(bindings.name.text, module);
      continue;
    }
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (module === CORE_MODULE && imported === 'invoke') imports.invoke.add(element.name.text);
      if (module === EVENT_MODULE && EVENT_FUNCTIONS.includes(imported)) imports.events.set(element.name.text, imported);
    }
  }
  return imports;
}

/** The imported Tauri function a call's callee stands for (`invoke`, `listen`, ...), or null. */
function tauriFunctionOf(callee: ts.Expression, imports: TauriImports): string | null {
  if (ts.isIdentifier(callee)) {
    if (imports.invoke.has(callee.text)) return 'invoke';
    return imports.events.get(callee.text) ?? null;
  }
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    const module = imports.namespaces.get(callee.expression.text);
    const member = callee.name.text;
    if (module === CORE_MODULE && member === 'invoke') return 'invoke';
    if (module === EVENT_MODULE && EVENT_FUNCTIONS.includes(member)) return member;
  }
  return null;
}

function isCallee(node: ts.Node): boolean {
  return ts.isCallExpression(node.parent) && node.parent.expression === node;
}

function isNamespaceMember(node: ts.PropertyAccessExpression, imports: TauriImports): boolean {
  return (
    ts.isIdentifier(node.expression) &&
    imports.namespaces.has(node.expression.text) &&
    (node.name.text === 'invoke' || EVENT_FUNCTIONS.includes(node.name.text))
  );
}

/** An identifier that reads the imported function, other than as the callee of a call. */
function isValueUse(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (isCallee(node)) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isBindingElement(parent) || ts.isParameter(parent) || ts.isVariableDeclaration(parent)) return false;
  return true;
}

export function parseFrontend(file: string, text: string, consts: Map<string, string>): FrontendFacts {
  const sf = sourceFileOf(file, text);
  const imports = readImports(sf);
  const facts: FrontendFacts = { invokes: [], events: [], indirectUses: [], unsupported: [] };
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const localNames = new Set([...imports.invoke, ...imports.events.keys()]);

  const eventName = (node: ts.Expression | undefined): string | null => {
    if (!node) return null;
    const literal = stringValue(node);
    if (literal !== null) return literal;
    const inner = unwrap(node);
    return ts.isIdentifier(inner) ? (consts.get(inner.text) ?? null) : null;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isCallExpression(node)) {
      const fn = tauriFunctionOf(node.expression, imports);
      const [first, second] = node.arguments;
      if (fn === 'invoke' && first) {
        const shape = second ? keyShapeOf(second) : { always: new Set<string>(), sometimes: new Set<string>() };
        facts.invokes.push({
          file,
          line: lineOf(node),
          command: stringValue(first),
          nameExpr: first.getText(sf),
          keys: shape ? [...shape.always] : null,
          maybeKeys: shape ? [...shape.sometimes] : [],
        });
      } else if (fn !== null) {
        const nameNode = fn === 'emitTo' ? second : first;
        facts.events.push({
          file,
          line: lineOf(node),
          kind: fn === 'emitTo' ? 'emit' : (fn as 'listen' | 'once' | 'emit'),
          name: eventName(nameNode),
          nameExpr: nameNode ? nameNode.getText(sf) : '',
        });
      } else if (
        imports.hasWindowImport &&
        ts.isPropertyAccessExpression(node.expression) &&
        EVENT_FUNCTIONS.includes(node.expression.name.text)
      ) {
        facts.unsupported.push({ file, line: lineOf(node), expr: node.expression.getText(sf) });
      }
    }
    if (ts.isIdentifier(node) && localNames.has(node.text) && isValueUse(node)) {
      facts.indirectUses.push({ file, line: lineOf(node), name: node.text });
    }
    if (ts.isPropertyAccessExpression(node) && isNamespaceMember(node, imports) && !isCallee(node)) {
      facts.indirectUses.push({ file, line: lineOf(node), name: node.getText(sf) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return facts;
}

// ---------------------------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------------------------

/** A call whose command name is not a literal: the commands it can reach and the keys it passes to each. */
export interface NonLiteralEntry {
  file: string;
  nameExpr: string;
  calls: { command: string; args: string[] }[];
}

export interface ContractModel {
  /** Command names in `generate_handler!`. */
  handlers: string[];
  commands: RustCommand[];
  invokes: InvokeCall[];
  nonLiteralTable: NonLiteralEntry[];
  indirectUses: FrontendFacts['indirectUses'];
  unsupported: FrontendFacts['unsupported'];
  rustEvents: string[];
  unresolvedRustEvents: RustEmits['unresolved'];
  frontendEvents: EventUse[];
  /** Events Rust emits that the frontend does not listen to, each with the reason. */
  eventAllowlist: Record<string, string>;
}

function checkArguments(
  where: string,
  command: string,
  passed: string[],
  commands: Map<string, RustCommand>,
  out: string[],
  maybePassed: string[] = [],
): void {
  const target = commands.get(command);
  if (!target) return;
  const accepted = target.params.map((p) => p.name);
  for (const key of [...passed, ...maybePassed]) {
    if (!accepted.includes(key)) {
      out.push(`${where} passes "${key}" to "${command}", which takes [${accepted.join(', ')}]`);
    }
  }
  for (const param of target.params) {
    if (!param.isOptional && !passed.includes(param.name)) {
      out.push(`${where} does not pass required "${param.name}" to "${command}"`);
    }
  }
}

/** Every violation of the contract in `model`, as sentences; empty when it holds. */
export function checkContract(model: ContractModel): string[] {
  const out: string[] = [];
  const handlers = new Set(model.handlers);
  const commands = new Map<string, RustCommand>();
  for (const command of model.commands) {
    if (commands.has(command.name)) out.push(`command "${command.name}" is defined twice (${command.file})`);
    commands.set(command.name, command);
  }
  for (const handler of handlers) {
    if (!commands.has(handler)) out.push(`"${handler}" is registered but no #[tauri::command] fn has that name`);
  }

  const usedEntries = new Set<NonLiteralEntry>();
  for (const call of model.invokes) {
    const where = `${call.file}:${call.line}`;
    if (call.command === null) {
      const entry = model.nonLiteralTable.find((e) => e.file === call.file && e.nameExpr === call.nameExpr);
      if (entry) usedEntries.add(entry);
      else out.push(`${where} invokes \`${call.nameExpr}\`, which is not a string literal: add it to NON_LITERAL_CALLS`);
      continue;
    }
    if (!handlers.has(call.command)) {
      out.push(`${where} invokes "${call.command}", which is not registered in generate_handler!`);
    } else if (call.keys === null) {
      out.push(`${where} invokes "${call.command}" but its arguments are not a plain object literal`);
    } else {
      checkArguments(where, call.command, call.keys, commands, out, call.maybeKeys);
    }
  }

  for (const entry of model.nonLiteralTable) {
    const where = `table entry ${entry.file} \`${entry.nameExpr}\``;
    if (!usedEntries.has(entry)) {
      out.push(`${where} matches no call: remove it`);
      continue;
    }
    for (const call of entry.calls) {
      if (handlers.has(call.command)) checkArguments(where, call.command, call.args, commands, out);
      else out.push(`${where} lists "${call.command}", which is not registered in generate_handler!`);
    }
  }

  out.push(...checkEvents(model));
  for (const use of model.indirectUses) {
    out.push(`${use.file}:${use.line} uses \`${use.name}\` as a value, so its calls cannot be checked`);
  }
  for (const use of model.unsupported) {
    out.push(`${use.file}:${use.line} calls \`${use.expr}\`, which the contract test does not scan`);
  }
  return out;
}

function checkEvents(model: ContractModel): string[] {
  const out: string[] = [];
  for (const emit of model.unresolvedRustEvents) {
    out.push(`${emit.file} emits an event named by \`${emit.expr}\`, which could not be resolved to a string`);
  }
  for (const use of model.frontendEvents) {
    if (use.name === null) {
      out.push(`${use.file}:${use.line} names an event with \`${use.nameExpr}\`, which could not be resolved to a string`);
    }
  }
  const named = (kinds: EventUse['kind'][]) =>
    model.frontendEvents.filter((e): e is EventUse & { name: string } => e.name !== null && kinds.includes(e.kind));
  const emitted = new Set([...model.rustEvents, ...named(['emit']).map((e) => e.name)]);
  const listened = new Set(named(['listen', 'once']).map((e) => e.name));

  for (const use of named(['listen', 'once'])) {
    if (!emitted.has(use.name)) {
      out.push(`${use.file}:${use.line} listens to "${use.name}", which nothing emits (Rust or frontend)`);
    }
  }
  for (const event of new Set(model.rustEvents)) {
    if (!listened.has(event) && !(event in model.eventAllowlist)) {
      out.push(`"${event}" is emitted but the frontend never listens to it: listen to it or add it to the allowlist`);
    }
  }
  for (const use of named(['emit'])) {
    if (!listened.has(use.name) && !(use.name in model.eventAllowlist)) {
      out.push(`${use.file}:${use.line} emits "${use.name}", which nothing listens to`);
    }
  }
  for (const [event, reason] of Object.entries(model.eventAllowlist)) {
    if (reason.trim() === '') out.push(`allowlist entry "${event}" needs a reason`);
    if (listened.has(event)) out.push(`allowlist entry "${event}" is listened to, so it does not need an entry`);
    else if (!emitted.has(event)) out.push(`allowlist entry "${event}" is not emitted by anything: remove it`);
  }
  return out;
}
