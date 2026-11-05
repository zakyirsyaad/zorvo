/** A workspace file as `read_workspace_file` returns it. */
export type FileContent =
  | { kind: "text"; text: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "tooLarge"; size: number; limit: number };

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Validates a `read_workspace_file` response; throws on any other shape. */
export function parseFileContent(value: unknown): FileContent {
  if (typeof value === "object" && value !== null) {
    const candidate = value as Record<string, unknown>;
    if (candidate.kind === "text" && typeof candidate.text === "string" && isNumber(candidate.size)) {
      return { kind: "text", text: candidate.text, size: candidate.size };
    }
    if (candidate.kind === "binary" && isNumber(candidate.size)) return { kind: "binary", size: candidate.size };
    if (candidate.kind === "tooLarge" && isNumber(candidate.size) && isNumber(candidate.limit)) {
      return { kind: "tooLarge", size: candidate.size, limit: candidate.limit };
    }
  }
  throw new Error("Unexpected file contents from the backend");
}

/**
 * A text's lines as an editor numbers them: split on LF or CRLF, and the newline that ends the last
 * line starts no line of its own.
 */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** A language's name for the info line and its tag for a fenced code block. */
export interface Language {
  name: string;
  fence: string;
}

const LANGUAGES: Readonly<Record<string, Language>> = {
  ts: { name: "TypeScript", fence: "ts" },
  tsx: { name: "TypeScript", fence: "tsx" },
  mts: { name: "TypeScript", fence: "ts" },
  cts: { name: "TypeScript", fence: "ts" },
  js: { name: "JavaScript", fence: "js" },
  jsx: { name: "JavaScript", fence: "jsx" },
  mjs: { name: "JavaScript", fence: "js" },
  cjs: { name: "JavaScript", fence: "js" },
  rs: { name: "Rust", fence: "rust" },
  py: { name: "Python", fence: "python" },
  go: { name: "Go", fence: "go" },
  swift: { name: "Swift", fence: "swift" },
  sh: { name: "Shell", fence: "sh" },
  bash: { name: "Shell", fence: "sh" },
  zsh: { name: "Shell", fence: "sh" },
  css: { name: "CSS", fence: "css" },
  json: { name: "JSON", fence: "json" },
  md: { name: "Markdown", fence: "md" },
  toml: { name: "TOML", fence: "toml" },
  yml: { name: "YAML", fence: "yaml" },
  yaml: { name: "YAML", fence: "yaml" },
  html: { name: "HTML", fence: "html" },
};

const PLAIN: Language = { name: "Plain text", fence: "" };

/** The file's language from its extension; a name with no extension (Makefile, .env) is plain text. */
export function languageOf(path: string): Language {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return PLAIN;
  return LANGUAGES[name.slice(dot + 1).toLowerCase()] ?? PLAIN;
}

const KB = 1024;
const MB = KB * 1024;

/** A size in words: "300 bytes", "2 KB", "1.5 MB". */
export function formatSize(bytes: number): string {
  if (bytes < KB) return `${bytes} bytes`;
  if (bytes < MB) return `${Math.round(bytes / KB)} KB`;
  return `${Number((bytes / MB).toFixed(1))} MB`;
}
