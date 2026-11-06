import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, within, cleanup } from "@testing-library/react";
import { ActivityPanel } from "../components/activity/ActivityPanel";
import type { FileStat } from "../lib/diff-stats";
import type { ChatMessage, Session, ToolExecution } from "../types";

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
const internals = () => (window as unknown as { __TAURI_INTERNALS__: { invoke: Invoke } }).__TAURI_INTERNALS__;

const SESSION = { id: "s-1", cwd: "/r", name: "Fix", status: "running", profileId: "qwen" } as unknown as Session;
const TARGETS = { base: null, root: "/r", prefix: "" };
const stat = (path: string): FileStat => ({ path, oldPath: null, kind: "modified", added: 1, removed: 0, isBinary: false, fingerprint: path });
const reply = (tools: Partial<ToolExecution>[], patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "m-1",
  role: "agent",
  content: "",
  timestamp: 1000,
  tools: tools.map((tool, index) => ({ id: `t-${index}`, name: "Tool", status: "completed", ...tool })),
  ...patch,
});

function stubBackend(overrides: Record<string, () => Promise<unknown>> = {}) {
  const original = internals().invoke;
  vi.spyOn(internals(), "invoke").mockImplementation((cmd, args) => {
    if (overrides[cmd]) return overrides[cmd]();
    if (cmd === "session_diff_targets") return Promise.resolve(TARGETS);
    return original(cmd, args);
  });
}

async function show(props: Partial<Parameters<typeof ActivityPanel>[0]> = {}) {
  const handlers = { onJump: vi.fn(), onShowChanges: vi.fn() };
  await act(async () => {
    render(
      <ActivityPanel
        messages={[]}
        transcript="ready"
        session={SESSION}
        agentName="Qwen Code"
        isRepository
        isBusy={false}
        version={1}
        headStats={[]}
        headStatsFailed={false}
        {...handlers}
        {...props}
      />,
    );
  });
  return handlers;
}

afterEach(() => vi.restoreAllMocks());

describe("ActivityPanel inside the inspector", () => {
  it("has no close button of its own inside the inspector", async () => {
    await show();
    expect(screen.queryByRole("button", { name: "Close activity panel" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Activity panel" }).className).not.toContain("w-80");
  });
});

describe("ActivityPanel", () => {
  it("always says whose report this is, and what rewinding does", async () => {
    stubBackend();
    await show();
    expect(screen.getByText("This is Qwen Code's own report of what it did. Rewinding the chat removes its entries too.")).toBeDefined();
  });

  it("does not read as empty while the transcript loads", async () => {
    stubBackend();
    await show({ messages: undefined, transcript: "loading", headStats: [stat("a.ts")] });
    expect(screen.getByText("Reading the activity…")).toBeDefined();
    expect(screen.queryByText("Not reported by the agent")).toBeNull();
    expect(screen.queryByText(/^Nothing yet/)).toBeNull();
  });

  it("does not check a transcript that holds only live messages while it loads", async () => {
    stubBackend();
    await show({ messages: [reply([{ kind: "execute", command: "ls" }])], transcript: "loading", headStats: [stat("a.ts")] });
    expect(screen.getByText("Reading the activity…")).toBeDefined();
    expect(screen.queryByRole("region", { name: "Not reported by the agent" })).toBeNull();
  });

  it("says when the conversation could not be read", async () => {
    stubBackend();
    await show({ messages: undefined, transcript: "failed" });
    expect(screen.getByText("This conversation could not be read, so its activity is not shown.")).toBeDefined();
    expect(screen.queryByText("Reading the activity…")).toBeNull();
  });

  it("says a tool's name is not a file", async () => {
    stubBackend();
    await show({ messages: [reply([{ kind: "edit", name: "Write" }])] });
    expect(screen.getByText("Write (no file named)")).toBeDefined();
  });

  it("shows when a turn started, and nothing for a replayed one", async () => {
    stubBackend();
    const prompt = (patch: Partial<ChatMessage> = {}): ChatMessage => ({ id: "u-1", role: "user", content: "List", timestamp: Date.now() - 120_000, ...patch });
    await show({ messages: [prompt(), reply([{ kind: "execute", command: "ls" }])] });
    expect(screen.getByText("2 minutes ago")).toBeDefined();
    cleanup();
    await show({ messages: [prompt({ hasKnownTime: false }), reply([{ kind: "execute", command: "ls" }], { hasKnownTime: false })] });
    expect(screen.queryByText("2 minutes ago")).toBeNull();
  });

  it("names a row by its first line, kept short", async () => {
    stubBackend();
    await show({ messages: [reply([{ kind: "execute", command: `${"x".repeat(200)}\nsecond` }])] });
    const button = screen.getByRole("button", { name: /Show in the chat/ });
    expect(button.getAttribute("aria-label")).not.toContain("u000A");
    expect((button.getAttribute("aria-label") ?? "").length).toBeLessThan(140);
  });

  it("says one tool call in the singular", async () => {
    stubBackend();
    await show({ messages: [reply([{ kind: "fetch" }])] });
    expect(screen.getByText("1 other tool call is not listed.")).toBeDefined();
  });

  it("reads an empty session as empty", async () => {
    stubBackend();
    await show();
    expect(screen.getByText("Nothing yet. What the agent does shows here.")).toBeDefined();
  });

  it("filters the rows and counts each kind", async () => {
    stubBackend();
    await show({
      messages: [reply([{ kind: "edit", locations: ["/r/a.ts"] }, { kind: "execute", command: "ls" }])],
      headStats: [stat("a.ts")],
    });
    expect(screen.getByRole("button", { name: "Files, 1" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Commands, 1" }));
    expect(screen.getByText("ls")).toBeDefined();
    expect(screen.queryByText("/r/a.ts")).toBeNull();
  });

  it("lists a file git shows that the agent did not, and says what it compared", async () => {
    stubBackend();
    await show({ headStats: [stat("sneaky.ts")] });
    const section = screen.getByRole("region", { name: "Unreported changes" });
    expect(within(section).getByText("sneaky.ts")).toBeDefined();
    expect(within(section).getByText("1 file changed that Qwen Code didn't report")).toBeDefined();
    expect(within(section).getByText("Compared with uncommitted changes.")).toBeDefined();
  });

  it("compares since the worktree began when the session has a start commit", async () => {
    stubBackend({ session_diff_stats_since: () => Promise.resolve([stat("b.ts")]) });
    const session = { ...SESSION, worktree: { repoPath: "/m", path: "/r", branch: "agent/x", startCommit: "a".repeat(40) } } as Session;
    await show({ session, headStats: [] });
    const section = screen.getByRole("region", { name: "Unreported changes" });
    expect(within(section).getByText("Compared since this worktree began.")).toBeDefined();
    expect(within(section).getByText("b.ts")).toBeDefined();
  });

  it("shows no card when nothing is unreported", async () => {
    stubBackend();
    await show({ messages: [reply([{ kind: "edit", locations: ["/r/a.ts"] }])], headStats: [stat("a.ts")] });
    expect(screen.queryByRole("region", { name: "Unreported changes" })).toBeNull();
  });

  it("says it could not check when the stats failed", async () => {
    stubBackend();
    await show({ headStats: null, headStatsFailed: true });
    expect(screen.getByText("Could not check against git.")).toBeDefined();
  });

  it("does not guess when the targets failed", async () => {
    stubBackend({ session_diff_targets: () => Promise.reject("no") });
    await show({ headStats: [stat("a.ts")] });
    expect(screen.getByText("Could not check against git.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "a.ts" })).toBeNull();
  });

  it("does not check a session whose history stays in the agent", async () => {
    stubBackend();
    await show({ session: { ...SESSION, historyElsewhere: true }, headStats: [stat("a.ts")] });
    expect(screen.getByText("Earlier work stays in the agent, so it is not checked.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "a.ts" })).toBeNull();
  });

  it("shows no check outside a repository", async () => {
    stubBackend();
    await show({ isRepository: false, headStats: null });
    expect(screen.queryByText("Could not check against git.")).toBeNull();
    expect(screen.queryByRole("region", { name: "Not reported by the agent" })).toBeNull();
  });

  it("caps rows after the filter, and counts them all", async () => {
    stubBackend();
    const tools = Array.from({ length: 510 }, (_, i) => ({ kind: "execute", command: `c${i}` }));
    await show({ messages: [reply(tools)] });
    expect(screen.getByRole("button", { name: "Commands, 510" })).toBeDefined();
    expect(screen.getByText("10 older entries are not shown.")).toBeDefined();
    expect(screen.getByText("c509")).toBeDefined();
    expect(screen.queryByText("c0")).toBeNull();
  });

  it("caps the unreported list", async () => {
    stubBackend();
    await show({ headStats: Array.from({ length: 103 }, (_, i) => stat(`f${i}.ts`)) });
    expect(screen.getByText("3 more.")).toBeDefined();
  });

  it("says how many tools it does not list", async () => {
    stubBackend();
    await show({ messages: [reply([{ kind: "fetch" }, { kind: "fetch" }])] });
    expect(screen.getByText("2 other tool calls are not listed.")).toBeDefined();
  });

  it("shows a bidi control in a command as text", async () => {
    stubBackend();
    await show({ messages: [reply([{ kind: "execute", command: "rm ‮fdp.exe" }])] });
    expect(screen.getByText("rm \\u202Efdp.exe")).toBeDefined();
  });

  it("shows a multi-line command's first line, marked as cut", async () => {
    stubBackend();
    await show({ messages: [reply([{ kind: "execute", command: "one\ntwo\nthree\nfour" }])] });
    expect(screen.getByText(/^one/).textContent).toBe("one …");
  });

  it("keeps each row when an earlier tool reports another file", async () => {
    stubBackend();
    const message = (locations: string[]) =>
      reply([
        { id: "edit", kind: "edit", status: "running", locations },
        { id: "short", kind: "execute", command: "short" },
      ]);
    const props = { transcript: "ready" as const, session: SESSION, agentName: "Qwen Code", isRepository: true, isBusy: false, version: 1, headStats: [], headStatsFailed: false, onJump: vi.fn(), onShowChanges: vi.fn() };
    const view = render(<ActivityPanel {...props} messages={[message(["/r/a.ts"])]} />);
    await act(async () => {
      view.rerender(<ActivityPanel {...props} messages={[message(["/r/a.ts", "/r/b.ts"])]} />);
    });

    await screen.findByText("/r/b.ts");
    expect(screen.getByText("/r/a.ts")).toBeDefined();
    expect(screen.getByText("short")).toBeDefined();
  });

  it("renders markdown as text", async () => {
    stubBackend();
    await show({ messages: [reply([{ kind: "execute", command: "[a](http://x)" }])] });
    expect(screen.getByText("[a](http://x)")).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("words what a row may claim", async () => {
    stubBackend();
    await show({ messages: [reply([{ kind: "edit", status: "failed", locations: ["/r/a.ts"] }])], headStats: [] });
    expect(screen.getByText("Failed")).toBeDefined();
    expect(screen.queryByText("Changed")).toBeNull();
  });

  it("jumps to an entry's message", async () => {
    stubBackend();
    const { onJump } = await show({ messages: [reply([{ kind: "execute", command: "ls" }])] });
    fireEvent.click(screen.getByRole("button", { name: /ls/ }));
    expect(onJump).toHaveBeenCalledWith("m-1");
  });

  it("shows the Changes tab from the unreported card", async () => {
    stubBackend();
    const { onShowChanges } = await show({ headStats: [stat("a.ts")] });
    fireEvent.click(screen.getByRole("button", { name: "Show in Changes" }));
    expect(onShowChanges).toHaveBeenCalledOnce();
  });
});
