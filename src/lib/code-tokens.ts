/** What a piece of a code line is, for the viewer's monochrome syntax. */
export type TokenKind = "keyword" | "string" | "comment" | "number" | "plain";

export interface Token {
  kind: TokenKind;
  text: string;
}

/** Monochrome, per the spec: keywords brighter, strings muted, comments subtle italic. */
export const TOKEN_STYLE: Record<TokenKind, string> = {
  keyword: "text-fg",
  string: "text-fg-muted",
  comment: "text-fg-subtle italic",
  number: "text-fg",
  plain: "",
};

interface LanguageRules {
  keywords: ReadonlySet<string>;
  /** Markers that start a comment running to the end of the line. */
  lineComments: readonly string[];
  /** A line comment marker counts only at the start or after a space (shell's `$#`, `a#b`). */
  lineCommentNeedsSpace?: boolean;
  /** Pairs that open and close a comment that may span lines. */
  blockComments: readonly (readonly [string, string])[];
  /** Quotes that open and close a string that may span lines (Python's `"""`). */
  longStrings: readonly string[];
  /** Quotes of a string on one line; a backslash escapes the next character. */
  quotes: readonly string[];
}

const words = (list: string) => new Set(list.split(" ").filter(Boolean));

const JS_KEYWORDS = words(
  "abstract as async await break case catch class const continue declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface keyof let new null of private protected public readonly return satisfies set static super switch this throw true try type typeof undefined var void while with yield",
);
const C_COMMENTS = [["/*", "*/"]] as const;

const RULES: Readonly<Record<string, LanguageRules>> = {
  js: { keywords: JS_KEYWORDS, lineComments: ["//"], blockComments: C_COMMENTS, longStrings: [], quotes: ['"', "'", "`"] },
  rust: {
    keywords: words(
      "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
    ),
    lineComments: ["//"],
    blockComments: C_COMMENTS,
    longStrings: [],
    // No single quote: it starts a lifetime as often as a char.
    quotes: ['"'],
  },
  python: {
    keywords: words(
      "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield",
    ),
    lineComments: ["#"],
    blockComments: [],
    longStrings: ['"""', "'''"],
    quotes: ['"', "'"],
  },
  go: {
    keywords: words(
      "break case chan const continue default defer else fallthrough false for func go goto if import interface map nil package range return select struct switch true type var",
    ),
    lineComments: ["//"],
    blockComments: C_COMMENTS,
    longStrings: [],
    quotes: ['"', "'", "`"],
  },
  swift: {
    keywords: words(
      "as break case catch class continue default defer do else enum extension false fileprivate for func guard if import in init internal is let nil private protocol public return self static struct super switch throw throws true try var where while",
    ),
    lineComments: ["//"],
    blockComments: C_COMMENTS,
    longStrings: [],
    quotes: ['"'],
  },
  sh: {
    keywords: words("case do done elif else esac export fi for function if in local return then until while"),
    lineComments: ["#"],
    lineCommentNeedsSpace: true,
    blockComments: [],
    longStrings: [],
    quotes: ['"', "'"],
  },
  css: { keywords: words(""), lineComments: [], blockComments: C_COMMENTS, longStrings: [], quotes: ['"', "'"] },
  json: { keywords: words("true false null"), lineComments: [], blockComments: [], longStrings: [], quotes: ['"'] },
  toml: { keywords: words("true false"), lineComments: ["#"], lineCommentNeedsSpace: true, blockComments: [], longStrings: [], quotes: ['"', "'"] },
  yaml: { keywords: words("true false null"), lineComments: ["#"], lineCommentNeedsSpace: true, blockComments: [], longStrings: [], quotes: ['"', "'"] },
  html: { keywords: words(""), lineComments: [], blockComments: [["<!--", "-->"]], longStrings: [], quotes: ['"', "'"] },
};

const ALIASES: Readonly<Record<string, string>> = { ts: "js", tsx: "js", jsx: "js" };

function rulesFor(fence: string): LanguageRules | undefined {
  return RULES[ALIASES[fence] ?? fence];
}

const isWordStart = (ch: string) => /[A-Za-z_$]/.test(ch);
const isWordChar = (ch: string) => /[A-Za-z0-9_$]/.test(ch);
const isDigit = (ch: string) => ch >= "0" && ch <= "9";

/** A comment or long string left open at the end of a line, and what closes it. */
interface Open {
  kind: "comment" | "string";
  close: string;
}

/** Scans one line; `open` is what the line before left open, `opened` what this one leaves. */
class LineScanner {
  readonly tokens: Token[] = [];
  opened: Open | null = null;
  private plain = "";

  constructor(private readonly line: string) {}

  addPlain(text: string) {
    this.plain += text;
  }

  push(kind: TokenKind, text: string) {
    this.flush();
    this.tokens.push({ kind, text });
  }

  flush() {
    if (this.plain !== "") this.tokens.push({ kind: "plain", text: this.plain });
    this.plain = "";
  }

  /** A span from `from` up to and including `close`, searched from `searchFrom`; open to the line's end when absent. */
  span(kind: Open["kind"], from: number, searchFrom: number, close: string): number {
    const end = this.line.indexOf(close, searchFrom);
    if (end === -1) {
      this.push(kind, this.line.slice(from));
      this.opened = { kind, close };
      return this.line.length;
    }
    this.push(kind, this.line.slice(from, end + close.length));
    return end + close.length;
  }
}

function tokenizeLine(line: string, rules: LanguageRules, carried: Open | null): LineScanner {
  const scan = new LineScanner(line);
  let i = carried ? scan.span(carried.kind, 0, 0, carried.close) : 0;
  while (i < line.length) {
    const ch = line[i];
    const block = rules.blockComments.find(([start]) => line.startsWith(start, i));
    if (block) {
      i = scan.span("comment", i, i + block[0].length, block[1]);
      continue;
    }
    const long = rules.longStrings.find((quote) => line.startsWith(quote, i));
    if (long) {
      i = scan.span("string", i, i + long.length, long);
      continue;
    }
    const lineComment = rules.lineComments.find((marker) => line.startsWith(marker, i));
    if (lineComment && (!rules.lineCommentNeedsSpace || i === 0 || /\s/.test(line[i - 1]))) {
      scan.push("comment", line.slice(i));
      break;
    }
    if (rules.quotes.includes(ch)) {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) j += line[j] === "\\" ? 2 : 1;
      j = Math.min(j + 1, line.length);
      scan.push("string", line.slice(i, j));
      i = j;
      continue;
    }
    if (isDigit(ch) && (i === 0 || !isWordChar(line[i - 1]))) {
      let j = i + 1;
      while (j < line.length && /[0-9A-Za-z_.]/.test(line[j])) j++;
      scan.push("number", line.slice(i, j));
      i = j;
      continue;
    }
    if (isWordStart(ch)) {
      let j = i + 1;
      while (j < line.length && isWordChar(line[j])) j++;
      const word = line.slice(i, j);
      if (rules.keywords.has(word)) scan.push("keyword", word);
      else scan.addPlain(word);
      i = j;
      continue;
    }
    scan.addPlain(ch);
    i++;
  }
  scan.flush();
  return scan;
}

/**
 * Each line's tokens for the language named by `fence` (`languageOf`). The texts of a line's tokens
 * join back to the line exactly. A comment or long string left open carries to the next lines; an
 * unknown language is plain text.
 */
export function tokenizeLines(lines: readonly string[], fence: string): Token[][] {
  const rules = rulesFor(fence);
  if (!rules) return lines.map((line) => [{ kind: "plain", text: line }]);
  let carried: Open | null = null;
  return lines.map((line) => {
    const scan = tokenizeLine(line, rules, carried);
    carried = scan.opened;
    return scan.tokens;
  });
}
