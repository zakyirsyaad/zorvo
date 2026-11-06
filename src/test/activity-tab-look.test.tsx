import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ActivityPanel } from "../components/activity/ActivityPanel";
import type { FileStat } from "../lib/diff-stats";
import type { ActionCard, ChatMessage, Session, ToolExecution } from "../types";

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
const internals = () => (window as unknown as { __TAURI_INTERNALS__: { invoke: Invoke } }).__TAURI_INTERNALS__;

const SESSION = { id: "s-1", cwd: "/r", name: "Fix", status: "running", profileId: "claude" } as unknown as Session;
const TARGETS = { base: null, root: "/r", prefix: "" };
const stat = (path: string): FileStat => ({ path, oldPath: null, kind: "modified", added: 1, removed: 0, isBinary: false, fingerprint: path });
const user = (id: string, content: string): ChatMessage => ({ id, role: "user", content, timestamp: Date.now() - 4 * 60_000 });
const reply = (id: string, tools: Partial<ToolExecution>[], patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: "agent",
  content: "",
  timestamp: 1000,
  tools: tools.map((tool, index) => ({ id: `${id}-t${index}`, name: "Tool", status: "completed", ...tool })),
  ...patch,
});

function stubBackend() {
  const original = internals().invoke;
  vi.spyOn(internals(), "invoke").mockImplementation((cmd, args) => {
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
        agentName="Claude Code"
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

describe("the Activity tab as drawn", () => {
  it("names the agent in the intro", async () => {
    await show();
    expect(screen.getByText("This is Claude Code's own report of what it did. Rewinding the chat removes its entries too.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Activity" })).toBeNull();
  });

  it("lists unreported files in an attention card with Show in Changes", async () => {
    stubBackend();
    const handlers = await show({ messages: [user("u1", "Go"), reply("r1", [])], headStats: [stat("src/a.ts"), stat("pnpm-lock.yaml")] });

    const card = await screen.findByRole("region", { name: "Unreported changes" });
    expect(card).toHaveClass("bg-attention-surface", "border-attention-border");
    expect(within(card).getByText("2 files changed that Claude Code didn't report")).toHaveClass("font-semibold");
    expect(within(card).getByText("src/a.ts")).toHaveClass("font-mono");
    act(() => within(card).getByRole("button", { name: "Show in Changes" }).click());
    expect(handlers.onShowChanges).toHaveBeenCalledTimes(1);
  });

  it("groups rows under turn headings, newest first", async () => {
    await show({
      messages: [
        user("u1", "The sidebar feels crowded"),
        reply("r1", [{ kind: "read", locations: ["/r/a.ts"] }]),
        user("u2", "Try again"),
        reply("r2", [{ kind: "read", locations: ["/r/b.ts"] }]),
      ],
    });
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      expect.stringContaining("Turn 2"),
      expect.stringContaining("Turn 1"),
    ]);
    expect(screen.getByRole("region", { name: /Turn 2/ })).toHaveTextContent("· Try again");
  });

  it("a row shows verb, target and result", async () => {
    const rejected: ActionCard = {
      id: "c-1",
      sessionId: "s-1",
      title: "Permission requested",
      prompt: "Run rm",
      commandSnippet: "rm -rf node_modules",
      status: "rejected",
      chosenOptionId: "no",
      timestamp: 900,
      options: [{ optionId: "no", name: "Reject", kind: "reject_once" }],
    };
    await show({
      messages: [user("u1", "Go"), reply("r1", [{ kind: "edit", locations: ["/r/src/list.tsx"] }], { actionCard: rejected })],
    });

    const edit = screen.getByText("/r/src/list.tsx").closest("li")!;
    expect(within(edit).getByText("Edited")).toHaveClass("w-[52px]");
    expect(screen.getByText("/r/src/list.tsx")).toHaveClass("font-mono", "truncate");
    expect(within(edit).getByRole("button", { name: /Done/ })).toHaveTextContent("Done");

    const asked = screen.getByText("Asked").closest("li")!;
    expect(within(asked).getByRole("button", { name: /You denied/ })).toHaveClass("text-danger");
    expect(asked).toHaveTextContent("to run rm -rf node_modules");
  });

  it("a running tool in an idle session reads Did not finish with an open dot", async () => {
    await show({ messages: [user("u1", "Go"), reply("r1", [{ kind: "edit", locations: ["/r/x.ts"], status: "running" }])] });
    const row = screen.getByText("/r/x.ts").closest("li")!;
    expect(within(row).getByText("Edit")).toBeTruthy();
    expect(within(row).getByRole("button", { name: /Did not finish/ })).toHaveClass("text-fg-muted");
    expect(row.querySelector("[data-dot]")).toHaveClass("border-border-strong");
  });

  it("the cap keeps the newest entries and says how many are hidden", async () => {
    const tools = Array.from({ length: 502 }, (_, i) => ({ kind: "read", locations: [`/r/f${i}.ts`] }) as Partial<ToolExecution>);
    await show({ messages: [user("u1", "Go"), reply("r1", tools)] });
    expect(screen.getByText("2 older entries are not shown.")).toBeTruthy();
    expect(screen.queryByText("/r/f0.ts")).toBeNull();
    expect(screen.queryByText("/r/f1.ts")).toBeNull();
    expect(screen.getByText("/r/f2.ts")).toBeTruthy();
  });
});
