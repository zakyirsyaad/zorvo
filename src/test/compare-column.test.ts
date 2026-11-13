import { describe, it, expect } from "vitest";
import { columnFiles, columnRequest, lastAgentText, moreFilesLabel, openFormPrompt } from "../lib/compare-column";
import type { FileStat } from "../lib/diff-stats";
import type { ActionCard, ChatMessage } from "../types";

const stat = (path: string, added: number, removed: number): FileStat => ({
  path,
  oldPath: null,
  kind: "modified",
  added,
  removed,
  isBinary: false,
  fingerprint: path,
});

const message = (id: string, role: ChatMessage["role"], content: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, role, content, timestamp: 1, ...extra }) as ChatMessage;

const card = (extra: Partial<ActionCard> = {}): ActionCard => ({
  id: "card-1",
  sessionId: "s-1",
  title: "Run a command",
  prompt: "rm -rf build",
  status: "pending",
  timestamp: 1,
  options: [
    { optionId: "allow", name: "Allow once", kind: "allow_once" },
    { optionId: "always", name: "Always allow", kind: "allow_always" },
    { optionId: "reject", name: "Reject", kind: "reject_once" },
  ],
  ...extra,
});

describe("columnFiles", () => {
  it("lists the most changed files first, ties by path, and counts the rest", () => {
    const stats = [stat("b.ts", 1, 0), stat("z.ts", 30, 5), stat("a.ts", 1, 0), stat("m.ts", 2, 2), stat("c.ts", 0, 1)];
    const { shown, more } = columnFiles(stats);
    expect(shown.map((file) => file.path)).toEqual(["z.ts", "m.ts", "a.ts"]);
    expect(more).toBe(2);
  });

  it("shows every file when there are three or fewer, and leaves the input as it was", () => {
    const stats = [stat("b.ts", 1, 0), stat("a.ts", 9, 0)];
    expect(columnFiles(stats)).toEqual({ shown: [stats[1], stats[0]], more: 0 });
    expect(stats.map((file) => file.path)).toEqual(["b.ts", "a.ts"]);
    expect(columnFiles([])).toEqual({ shown: [], more: 0 });
  });

  it("words the rest in the singular and the plural", () => {
    expect(moreFilesLabel(1)).toBe("1 more file");
    expect(moreFilesLabel(4)).toBe("4 more files");
  });
});

describe("lastAgentText", () => {
  it("is the agent's newest words, on one line, skipping empty replies and the user's messages", () => {
    const messages = [
      message("1", "user", "Fix the login"),
      message("2", "agent", "I read the files.\n\nNext I will\tedit them."),
      message("3", "agent", "   "),
      message("4", "user", "ok"),
    ];
    expect(lastAgentText(messages)).toBe("I read the files. Next I will edit them.");
  });

  it("is null before the agent has said anything", () => {
    expect(lastAgentText([])).toBeNull();
    expect(lastAgentText([message("1", "user", "Hello")])).toBeNull();
  });

  it("shows control characters instead of obeying them", () => {
    expect(lastAgentText([message("1", "agent", "safe‮txt")])).not.toContain("‮");
  });
});

describe("an agent's prose in a column", () => {
  it("the last message reads without markdown marks, still on one line", () => {
    const messages = [message("1", "agent", "The store is a `TokenStore` class.\n\n- **Done**: `login.ts`")];
    expect(lastAgentText(messages)).toBe("The store is a TokenStore class. Done: login.ts");
  });

  it("code in the last message is kept as written, a span over a line break included", () => {
    expect(lastAgentText([message("1", "agent", "Run `printf\n**done**\n` now, in `src/*/test/*`.")])).toBe(
      "Run printf **done** now, in src/*/test/*.",
    );
  });
});

describe("openFormPrompt", () => {
  it("is what the newest open form asks, and null when none is open", () => {
    const open = message("1", "agent", "", { elicitation: { status: "pending", message: "Which branch?" } } as unknown as Partial<ChatMessage>);
    const done = message("2", "agent", "", { elicitation: { status: "accepted", message: "Old" } } as unknown as Partial<ChatMessage>);
    expect(openFormPrompt([open, done])).toBe("Which branch?");
    expect(openFormPrompt([done])).toBeNull();
  });
});

describe("columnRequest", () => {
  it("answers a plain permission in the column, by its reject and allow-once choices only", () => {
    const request = columnRequest(card({ commandSnippet: "rm -rf build" }), null);
    expect(request).toEqual({
      kind: "plain",
      cardId: "card-1",
      line: "rm -rf build",
      isPath: false,
      reject: { optionId: "reject", name: "Reject", kind: "reject_once" },
      allowOnce: { optionId: "allow", name: "Allow once", kind: "allow_once" },
    });
  });

  it("says when its line is one file's path, which a column cuts at its start", () => {
    expect(columnRequest(card({ edits: [{ path: "/repo/src/a.ts" }] }), null)).toMatchObject({ line: "/repo/src/a.ts", isPath: true });
    // Several files are a list, and a command is not a path even when the request names a file too.
    expect(columnRequest(card({ edits: [{ path: "src/a.ts" }, { path: "src/b.ts" }] }), null)).toMatchObject({ isPath: false });
    expect(columnRequest(card({ commandSnippet: "ls", edits: [{ path: "src/a.ts" }] }), null)).toMatchObject({ line: "ls", isPath: false });
  });

  it("names the files an edit would change when there is no command, else the prompt", () => {
    expect(columnRequest(card({ edits: [{ path: "src/a.ts" }, { path: "src/b.ts" }] }), null)).toMatchObject({ line: "src/a.ts, src/b.ts" });
    expect(columnRequest(card(), null)).toMatchObject({ kind: "plain", line: "rm -rf build" });
  });

  it("asks to open the session for questions, and for a permission it cannot answer with two buttons", () => {
    const questions = [{ question: "Which editor do you use?", header: "Editor", options: [{ label: "Vim" }, { label: "Zed" }], multiSelect: false }];
    expect(columnRequest(card({ questions } as Partial<ActionCard>), null)).toEqual({ kind: "open", line: "Which editor do you use?" });
    const noReject = card({ options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }] });
    expect(columnRequest(noReject, null)).toEqual({ kind: "open", line: "rm -rf build" });
  });

  it("asks to open the session for a form, and is null when nothing waits", () => {
    expect(columnRequest(null, "Which branch should I target?")).toEqual({ kind: "open", line: "Which branch should I target?" });
    expect(columnRequest(null, null)).toBeNull();
  });
});
