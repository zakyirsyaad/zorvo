import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { openInspectorTab } from "./inspector-helpers";
import { fakeTauriInvoke, type FakeTauriStore } from "./setup";
import App from "../App";
import { lineHash } from "../lib/review-comments";
import type { ReviewComment } from "../types";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

const tauriInternals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
const fakeStore = () => (window as unknown as { __FAKE_TAURI_STORE__: FakeTauriStore }).__FAKE_TAURI_STORE__;

const FILE = "src/app.ts";
const CWD = "/Users/test/developer/zorvo";
const DIFF = "@@ -41,2 +41,2 @@\n the context\n-old line\n+const x\n";
const STAT = { path: FILE, oldPath: null, kind: "modified", added: 1, removed: 1, isBinary: false, fingerprint: "f1" };
const NOT_LOADED = "The diff has not loaded, so comments cannot be added. Refresh to try again.";
const SLOT_ELSEWHERE = "The message holds comments for another session. Go back to it, or clear the message.";

const commentOf = (overrides: Partial<ReviewComment> = {}): ReviewComment => ({
  id: "c-1",
  file: FILE,
  side: "new",
  line: 42,
  lineHash: lineHash("const x"),
  quote: "const x",
  target: "head",
  body: "Use AuthError here.",
  createdAt: 1,
  ...overrides,
});

const sessionOf = (id: string, name: string, reviewComments: ReviewComment[]) => ({
  id,
  name,
  profileId: "claude-acp",
  cwd: CWD,
  status: "terminated",
  createdAt: id === "s-a" ? 2 : 1,
  transport: "acp",
  acpSessionId: `acp-${id}`,
  reviewComments,
});

let isListFailing = false;

function seed(sessions: unknown[], base: { name: string } | null = null) {
  fakeStore().state.sessions = sessions as FakeTauriStore["state"]["sessions"];
  vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
    if (cmd === "session_changes") return Promise.resolve([{ path: FILE, oldPath: null, kind: "modified" }]);
    if (cmd === "session_diff_targets") return Promise.resolve({ base, root: CWD, prefix: "" });
    if (cmd === "session_diff_stats") return isListFailing ? Promise.reject(new Error("git is busy")) : Promise.resolve([STAT]);
    if (cmd === "session_file_diff") return Promise.resolve(DIFF);
    return fakeTauriInvoke(cmd, args);
  });
}

async function press(name: string | RegExp, scope: HTMLElement = document.body) {
  await act(async () => {
    fireEvent.click(within(scope).getByRole("button", { name }));
  });
}

const changes = () => screen.getByRole("complementary", { name: "Changes panel" });

/** The app on its newest session, with the Changes tab open on the file's card. */
async function openChanges(sessions: unknown[], base: { name: string } | null = null) {
  seed(sessions, base);
  await act(async () => {
    render(<App />);
  });
  await openInspectorTab("Changes");
  await act(async () => {
    fireEvent.click(await within(changes()).findByTitle(FILE));
  });
}

async function writeComment(body: string) {
  fireEvent.mouseOver(await within(changes()).findByRole("row", { name: /^Line 42, added/ }));
  await press("Comment on line 42", changes());
  fireEvent.change(within(changes()).getByRole("textbox", { name: "Comment on line 42" }), { target: { value: body } });
  await press("Save comment", changes());
}

const prompt = () => screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement;

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  isListFailing = false;
  vi.restoreAllMocks();
});

describe("Line comments in the Changes tab", () => {
  it("the Changes inline diff offers a comment on its active line", async () => {
    await openChanges([sessionOf("s-a", "Alpha work", [])]);

    const grid = await within(changes()).findByRole("grid", { name: `Diff of ${FILE}` });
    fireEvent.mouseOver(within(grid).getByRole("row", { name: /^Line 42, added/ }));
    expect(within(grid).getByRole("button", { name: "Comment on line 42" })).toBeInTheDocument();
  });

  it("a comment saved in Changes shows in the card and the bar counts it", async () => {
    await openChanges([sessionOf("s-a", "Alpha work", [])]);
    await writeComment("Check this.");

    const panel = within(changes());
    const saved = panel.getByText("Check this.").closest(".bg-surface-3") as HTMLElement;
    expect(saved.textContent).toContain("Line 42 · Current");
    expect(panel.getByRole("region", { name: "Review comments" }).textContent).toContain("1 comment not in a message");
    expect(panel.getByTitle(FILE).closest("li")?.textContent).toContain("1 comment");
  });

  it("Add 1 puts it in the message", async () => {
    await openChanges([sessionOf("s-a", "Alpha work", [commentOf()])]);

    const add = await within(changes()).findByRole("button", { name: "Add 1 comment to message" });
    expect(add).toHaveTextContent("Add 1");
    await waitFor(() => expect(add).toBeEnabled());
    await act(async () => {
      fireEvent.click(add);
    });

    expect(prompt().value).toContain("Use AuthError here.");
    expect(within(changes()).getByText("In message")).toBeInTheDocument();
  });

  it("Changes' Add says why while the message holds another session's comments", async () => {
    await openChanges([sessionOf("s-a", "Alpha work", [commentOf()]), sessionOf("s-b", "Beta work", [commentOf({ id: "c-b", body: "For beta." })])]);
    const add = await within(changes()).findByRole("button", { name: "Add 1 comment to message" });
    await waitFor(() => expect(add).toBeEnabled());
    await act(async () => {
      fireEvent.click(add);
    });

    await act(async () => {
      fireEvent.click(screen.getAllByText("Beta work")[0]);
    });
    await openInspectorTab("Changes");

    const other = await within(changes()).findByRole("button", { name: "Add 1 comment to message" });
    expect(other).toBeDisabled();
    expect(other).toHaveAccessibleDescription(SLOT_ELSEWHERE);
  });

  it("a comment from the Changes tab reads Not in this diff in a review against base", async () => {
    await openChanges([sessionOf("s-a", "Alpha work", [])], { name: "main" });
    await writeComment("Written in Changes.");

    await press(/Open the diff$/, changes());

    const review = within(await screen.findByRole("complementary", { name: "Diff view" }));
    await waitFor(() => expect(review.getByText("Not in this diff")).toBeInTheDocument());
    expect(review.getAllByText("Written in Changes.")).toHaveLength(1);
    expect(review.queryByRole("button", { name: /^Add \d+ comments? to message$/ })).toBeNull();
  });

  it("Changes' Add says why when the list of changes against HEAD failed", async () => {
    isListFailing = true;
    await openChanges([sessionOf("s-a", "Alpha work", [commentOf()])]);

    const add = await within(changes()).findByRole("button", { name: "Add 1 comment to message" });
    expect(add).toBeDisabled();
    await waitFor(() => expect(add).toHaveAccessibleDescription(NOT_LOADED));
  });
});
