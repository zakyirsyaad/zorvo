import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
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
  const handlers = { onJump: vi.fn(), onOpenDiff: vi.fn(), onClose: vi.fn() };
  await act(async () => {
    render(
      <ActivityPanel
        messages={[]}
        session={SESSION}
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

describe("ActivityPanel", () => {
  it("always says whose report this is, and what rewinding does", async () => {
    stubBackend();
    await show();
    expect(screen.getByText("Agents report this themselves. Zorvo can only check file changes against git.")).toBeDefined();
    expect(screen.getByText("Rewinding removes activity from this list.")).toBeDefined();
  });

  it("does not read as empty while the transcript loads", async () => {
    stubBackend();
    await show({ messages: undefined, headStats: [stat("a.ts")] });
    expect(screen.getByText("Reading the activity…")).toBeDefined();
    expect(screen.queryByText("Not reported by the agent")).toBeNull();
    expect(screen.queryByText(/^Nothing yet/)).toBeNull();
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
    const section = screen.getByRole("region", { name: "Not reported by the agent" });
    expect(within(section).getByRole("button", { name: "sneaky.ts" })).toBeDefined();
    expect(within(section).getByText("These changed in git, but the agent did not list them. A command, a rewind, you, or another session may have changed them.")).toBeDefined();
    expect(within(section).getByText("Compared with uncommitted changes.")).toBeDefined();
  });

  it("compares since the worktree began when the session has a start commit", async () => {
    stubBackend({ session_diff_stats_since: () => Promise.resolve([stat("b.ts")]) });
    const session = { ...SESSION, worktree: { repoPath: "/m", path: "/r", branch: "agent/x", startCommit: "a".repeat(40) } } as Session;
    await show({ session, headStats: [] });
    const section = screen.getByRole("region", { name: "Not reported by the agent" });
    expect(within(section).getByText("Compared since this worktree began.")).toBeDefined();
    expect(within(section).getByRole("button", { name: "b.ts" })).toBeDefined();
  });

  it("says when nothing is unreported", async () => {
    stubBackend();
    await show({ messages: [reply([{ kind: "edit", locations: ["/r/a.ts"] }])], headStats: [stat("a.ts")] });
    expect(screen.getByText("Nothing unreported.")).toBeDefined();
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
    await show({ messages: [reply([{ kind: "fetch" }])] });
    expect(screen.getByText("1 other tool calls are not listed.")).toBeDefined();
  });

  it("shows a bidi control in a command as text", async () => {
    stubBackend();
    await show({ messages: [reply([{ kind: "execute", command: "rm ‮fdp.exe" }])] });
    expect(screen.getByText("rm \\u202Efdp.exe")).toBeDefined();
  });

  it("keeps a multi-line command's lines and clamps it until opened", async () => {
    stubBackend();
    await show({ messages: [reply([{ kind: "execute", command: "one\ntwo\nthree\nfour" }])] });
    const shown = screen.getByText(/^one/);
    expect(shown.textContent).toBe("one\ntwo\nthree");
    fireEvent.click(screen.getByRole("button", { name: "Show all 4 lines" }));
    expect(screen.getByText(/^one/).textContent).toBe("one\ntwo\nthree\nfour");
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

  it("opens the diff from an unreported file", async () => {
    stubBackend();
    const { onOpenDiff } = await show({ headStats: [stat("a.ts")] });
    fireEvent.click(screen.getByRole("button", { name: "a.ts" }));
    expect(onOpenDiff).toHaveBeenCalledOnce();
  });
});
