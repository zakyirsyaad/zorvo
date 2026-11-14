/**
 * The private composer's local secret check. Pure: it reads text and returns only what the dialog
 * may show, never the whole secret, and never logs or stores a match.
 */

export interface SecretMatch {
  /** A plain name for the dialog row, e.g. "AWS access key". */
  kind: string;
  /** The attached file's path from the session folder, or `null` for the message itself. */
  file: string | null;
  /** 1-based line in the message or file. */
  line: number;
  /** The canvas preview: first 4 + bullets + last 4, or first 2 + bullets + last 2 under 16 characters. */
  preview: string;
}

interface Candidate extends SecretMatch {
  index: number;
  length: number;
}

const BULLETS = "••••••••";

/** The canvas mask: 4 + bullets + 4, and 2 + bullets + 2 for a match under 16 characters. */
export function maskSecret(value: string): string {
  if (value.length < 16) {
    return value.length < 4 ? BULLETS : `${value.slice(0, 2)}${BULLETS}${value.slice(-2)}`;
  }
  return `${value.slice(0, 4)}${BULLETS}${value.slice(-4)}`;
}

/** Shannon entropy per character, used to keep ordinary assignments out of the .env check. */
export function entropyBitsPerChar(value: string): number {
  if (value === "") return 0;
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const share = count / value.length;
    entropy -= share * Math.log2(share);
  }
  return entropy;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

function envKind(name: string): string {
  const upper = name.toUpperCase();
  if (upper.endsWith("PASSWORD")) return "Password";
  if (upper.endsWith("TOKEN")) return "Token";
  if (upper.endsWith("SECRET")) return "Secret";
  return "API key";
}

/** A value that names where a secret comes from, not the secret itself. */
function isExpressionValue(value: string): boolean {
  const trimmed = value.trim();
  // A full `${…}` template or `$UPPER_SNAKE` reference is an expression; a `$`-prefixed value with
  // mixed case or digits can be the password itself and stays caught.
  if (/^\$\{[^}]+\}$/.test(trimmed) || /^\$[A-Z_][A-Z0-9_]*$/.test(trimmed)) return true;
  return (
    /^(?:process\.env|os\.environ|os\.environ\.get|os\.getenv|import\.meta\.env|deno\.env)\b/i.test(trimmed) ||
    /^(?:getenv|env)\(\s*['"][^'"]*['"]\s*\)$/i.test(trimmed) ||
    /^request\.form\[/i.test(trimmed) ||
    trimmed.includes("${")
  );
}

/** A generic `sk-` value needs a digit, mixed case or enough entropy to be a key, not a word. */
function looksLikeSecret(value: string): boolean {
  if (/^sk-(?:learn|cube)-/.test(value)) return false;
  const body = value.replace(/^sk-(?:ant-|proj-)?/, "");
  return (
    /[0-9]/.test(body) ||
    (/[a-z]/.test(body) && /[A-Z]/.test(body)) ||
    entropyBitsPerChar(body) >= 3.5
  );
}

/** Every secret-looking value in `text`, with the attached file's path or `null` for the message. */
export function scanSecretText(text: string, file: string | null = null): SecretMatch[] {
  const candidates: Candidate[] = [];
  const add = (index: number, length: number, kind: string, preview: string) => {
    candidates.push({ kind, file, line: lineOf(text, index), preview, index, length });
  };

  for (const match of text.matchAll(/-----BEGIN ((?:PGP |[A-Z0-9]+ )?PRIVATE KEY(?: BLOCK)?)-----/g)) {
    const value = match[0];
    const label = match[1];
    add(match.index ?? 0, value.length, "Private key", `BEGIN ${label}`);
  }
  for (const match of text.matchAll(/\b(AKIA[0-9A-Z]{16})\b/g)) {
    const value = match[1];
    add(match.index ?? 0, value.length, "AWS access key", maskSecret(value));
  }
  for (const match of text.matchAll(/\b((?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,}))\b/g)) {
    const value = match[1];
    add(match.index ?? 0, value.length, "GitHub token", maskSecret(value));
  }
  for (const match of text.matchAll(/\b(sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,})\b/g)) {
    const value = match[1];
    if (!value.startsWith("sk-ant-") && !value.startsWith("sk-proj-") && !looksLikeSecret(value)) {
      continue;
    }
    add(match.index ?? 0, value.length, "API key", maskSecret(value));
  }
  for (const match of text.matchAll(/\b(xox[abpr]-[A-Za-z0-9-]{10,})\b/g)) {
    const value = match[1];
    add(match.index ?? 0, value.length, "Slack token", maskSecret(value));
  }

  const specific = [...candidates].sort((left, right) => left.index - right.index);
  const envPattern =
    /^[ \t]*(?:export[ \t]+)?((?:[A-Za-z_][A-Za-z0-9_]*)?(?:KEY|SECRET|TOKEN|PASSWORD))[ \t]*=[ \t]*(?:"([^"\n]{16,})"|'([^'\n]{16,})'|([^\s#]{16,}))/gim;
  for (const match of text.matchAll(envPattern)) {
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (value.length < 16 || isExpressionValue(value) || entropyBitsPerChar(value) < 3.5) continue;
    const index = (match.index ?? 0) + match[0].lastIndexOf(value);
    const overlaps = specific.some(
      (found) => index < found.index + found.length && found.index < index + value.length,
    );
    if (!overlaps) add(index, value.length, envKind(match[1]), maskSecret(value));
  }

  return candidates
    .sort((left, right) => left.index - right.index)
    .map(({ index: _index, length: _length, ...match }) => match);
}