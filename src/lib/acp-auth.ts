/** Matches the backend's prefix for "this agent needs a sign-in" errors. */
export const AUTH_REQUIRED_PREFIX = 'ACP_AUTH_REQUIRED:';

/**
 * How the app handles a sign-in method: `agent` runs inside the agent
 * (authenticate), `terminal` is a login command the app runs in a terminal
 * for the agent, `setup` is the agent's own interactive setup (Qwen Code picks
 * its provider there), run in a terminal by `acp_start_agent_setup`, and
 * `explain` needs a secret the app never asks for.
 */
export type AuthMethodKind = 'agent' | 'terminal' | 'setup' | 'explain';

/** A way to sign in that the agent offers. */
export interface AuthMethod {
  id: string;
  name: string;
  description?: string;
  kind: AuthMethodKind;
  /** The variables a key method needs set (an `env_var` method's required `vars`), for the line the user copies. */
  variables?: readonly string[];
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function methodKind(method: Json): AuthMethodKind {
  if (method.type === 'terminal') return 'terminal';
  // Any other type the app does not run (env_var needs a secret it never asks for).
  if (method.type !== undefined && method.type !== 'agent') return 'explain';
  const meta = isObject(method._meta) ? method._meta : {};
  // The older terminal form (no `type`, `_meta.type: "terminal"`) is the agent's own setup; its args are not used.
  if (method.type === undefined && meta.type === 'terminal') return 'setup';
  // Keys, Vertex AI and a gateway need settings or a secret the app never asks for.
  if ('api-key' in meta || 'gateway' in meta || /api.?key|vertex|gateway/i.test(String(method.id))) {
    return 'explain';
  }
  return 'agent';
}

/** Agents write variable names in Markdown backticks; the UI shows plain text. */
const withoutBackticks = (text: string) => text.replace(/`/g, '');

/** What an agent writes about its methods is shown, so it is kept short. */
const MAX_NAME = 80;
const MAX_DESCRIPTION = 300;
const limited = (text: string, max: number) => {
  // By characters, not UTF-16 units, so an emoji is not cut in half.
  const characters = Array.from(text);
  return characters.length > max ? `${characters.slice(0, max - 1).join('')}…` : text;
};

/** A shell variable name, so the export line shown can only ever be `export NAME=...`. */
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const MAX_VARIABLES = 5;

/** The names of the variables a method requires (`vars` entries not marked optional). */
function requiredVariables(method: Json): string[] {
  if (!Array.isArray(method.vars)) return [];
  const names = method.vars
    .filter(isObject)
    .filter((v) => v.optional !== true && typeof v.name === 'string' && VARIABLE_NAME.test(v.name))
    .map((v) => v.name as string);
  return [...new Set(names)].slice(0, MAX_VARIABLES);
}

/** The methods of an `initialize` answer, validated as the ones a sign-in refusal carries. */
export function toAuthMethods(raw: unknown): AuthMethod[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObject).flatMap((method) => {
    if (typeof method.id !== 'string' || typeof method.name !== 'string') return [];
    const variables = requiredVariables(method);
    return [
      {
        id: method.id,
        name: limited(method.name, MAX_NAME),
        ...(typeof method.description === 'string' ? { description: limited(withoutBackticks(method.description), MAX_DESCRIPTION) } : {}),
        kind: methodKind(method),
        ...(variables.length > 0 ? { variables } : {}),
      },
    ];
  });
}

/** The agent's sign-in methods when `error` says it needs a sign-in, otherwise null. */
export function parseAuthRequired(error: unknown): AuthMethod[] | null {
  if (typeof error !== 'string' || !error.startsWith(AUTH_REQUIRED_PREFIX)) return null;
  try {
    return toAuthMethods(JSON.parse(error.slice(AUTH_REQUIRED_PREFIX.length)));
  } catch {
    return [];
  }
}

/** A name that already starts with a verb ("Log in with Google") is the whole button label. */
const NAME_STARTS_WITH_VERB = /^(log ?in|sign ?in|sign ?up|use|connect|continue|authenticate|authorize)\b/i;

/** The button that opens an agent's own setup in the terminal dialog. */
export const OPEN_SETUP_LABEL = 'Open setup in terminal';

/** The words on a method's button: a setup opens the agent's own setup, a sign-in names its method. */
export function methodButtonLabel(method: Pick<AuthMethod, 'name' | 'kind'>): string {
  return method.kind === 'setup' ? OPEN_SETUP_LABEL : signInButtonLabel(method);
}

/** The words on a method's sign-in button. */
export function signInButtonLabel(method: Pick<AuthMethod, 'name'>): string {
  const name = method.name.trim();
  return NAME_STARTS_WITH_VERB.test(name) ? name : `Sign in with ${name}`;
}

/** The sentences that frame an agent's sign-in methods, shared by the draft's panel and Settings. */
export interface AuthCopy {
  lead: string;
  /** For an agent that listed no method at all. */
  cliHint: string | null;
  /** For methods that need a key or setting Zorvo never handles. */
  keysNote: string | null;
}

/**
 * The method a sign-in leads with, the first one Zorvo can run, and the other ways folded under it.
 * The agent's own order is kept: Zorvo does not know which method the agent recommends.
 */
export function splitMethods(methods: readonly AuthMethod[]): { first: AuthMethod | null; others: AuthMethod[] } {
  const first = methods.find((method) => method.kind !== 'explain') ?? null;
  return { first, others: methods.filter((method) => method !== first) };
}

/**
 * The line the user adds to their shell for a key variable, ending at the `=` the key is pasted after.
 * It holds no value, not even a placeholder: pasted as it is, the variable stays empty and still reads as not set.
 */
export function exportLine(variable: string): string {
  return `export ${variable}=`;
}

/** True when Zorvo can run one of the methods itself: inside the agent, its login in a terminal, or its own setup. */
export function hasRunnableMethod(methods: readonly AuthMethod[]): boolean {
  return methods.some((method) => method.kind !== 'explain');
}

/** True when the agent's only way in is its own setup: the draft shows the setup card. */
export function isSetupOnly(methods: readonly AuthMethod[]): boolean {
  return methods.length > 0 && methods.every((method) => method.kind === 'setup');
}

export function authCopy(agentName: string, methods: readonly AuthMethod[]): AuthCopy {
  const hasButton = methods.some((method) => method.kind !== 'explain');
  const hasExplained = methods.some((method) => method.kind === 'explain');
  const onlyKeys = hasExplained && !hasButton;
  const lead = isSetupOnly(methods)
    ? `${agentName} needs its own setup before it can start.`
    : methods.length === 0
      ? `${agentName} needs you to sign in before it can start.`
      : onlyKeys
      ? `${agentName} needs an API key or another account setting before it can start.`
      : `${agentName} signs in with its own tool. Zorvo never sees your password or key.`;
  return {
    lead,
    cliHint: methods.length === 0 ? `Sign in with ${agentName}'s own command line tool, then check again.` : null,
    keysNote: onlyKeys
      ? `Zorvo never stores keys. To use a key or another account setting, set it up in ${agentName} or your shell (for example in ~/.zshrc), then check again.`
      : null,
  };
}
