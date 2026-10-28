/** Matches the backend's prefix for "this agent needs a sign-in" errors. */
export const AUTH_REQUIRED_PREFIX = 'ACP_AUTH_REQUIRED:';

/**
 * How the app handles a sign-in method: `agent` runs inside the agent
 * (authenticate), `terminal` is a login command the app runs in a terminal
 * for the agent, `explain` needs a secret the app never asks for.
 */
export type AuthMethodKind = 'agent' | 'terminal' | 'explain';

/** A way to sign in that the agent offers. */
export interface AuthMethod {
  id: string;
  name: string;
  description?: string;
  kind: AuthMethodKind;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function methodKind(method: Json): AuthMethodKind {
  if (method.type === 'terminal') return 'terminal';
  // Any other type the app does not run (env_var needs a secret it never asks for).
  if (method.type !== undefined && method.type !== 'agent') return 'explain';
  const meta = isObject(method._meta) ? method._meta : {};
  // Keys, Vertex AI and a gateway need settings or a secret the app never asks for.
  if (meta.type === 'terminal' || 'api-key' in meta || 'gateway' in meta || /api.?key|vertex|gateway/i.test(String(method.id))) {
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

function toAuthMethods(raw: unknown): AuthMethod[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObject).flatMap((method) => {
    if (typeof method.id !== 'string' || typeof method.name !== 'string') return [];
    return [
      {
        id: method.id,
        name: limited(method.name, MAX_NAME),
        ...(typeof method.description === 'string' ? { description: limited(withoutBackticks(method.description), MAX_DESCRIPTION) } : {}),
        kind: methodKind(method),
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

export function authCopy(agentName: string, methods: readonly AuthMethod[]): AuthCopy {
  const hasButton = methods.some((method) => method.kind !== 'explain');
  const hasExplained = methods.some((method) => method.kind === 'explain');
  const onlyKeys = hasExplained && !hasButton;
  return {
    lead: onlyKeys
      ? `${agentName} needs an API key or another account setting before it can start.`
      : `${agentName} needs you to sign in before it can start.`,
    cliHint: methods.length === 0 ? `Sign in with ${agentName}'s own command line tool, then check again.` : null,
    keysNote: hasExplained
      ? `Zorvo never stores keys. To use a key or another account setting, set it up in ${agentName} or your shell (for example in ~/.zshrc), then check again.`
      : null,
  };
}
