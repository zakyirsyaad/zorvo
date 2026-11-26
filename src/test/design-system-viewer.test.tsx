import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener[]>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, [...(listeners.get(event) ?? []), cb]);
    return Promise.resolve(() => {
      listeners.set(event, (listeners.get(event) ?? []).filter((l) => l !== cb));
    });
  },
  emit: () => Promise.resolve(),
}));

const invoke = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args?: Record<string, unknown>) => invoke(cmd, args) }));

import { ArtifactsPanel } from "../components/artifacts/ArtifactsPanel";
import { defaultProblemLine, type DesignSystemEntry } from "../lib/design-systems";
import { parseArtifactCard } from "../lib/artifacts";
import { ArtifactCardRow } from "../components/chat/ArtifactCardRow";

const SESSION = "session-1794800000000-k3x9a";
const KEY = "d-0123456789abcdef";
const ENTRY: DesignSystemEntry = { key: KEY, folder: "/w/docs/ds", relative: "docs/ds", title: "Acme", tokens: 42, components: 12, shownAt: 1 };
const READ = {
  entry: ENTRY,
  error: null,
  googleFontsUrl: null,
  content: {
    index: { title: "Acme", namespace: null, libraries: [], assetGroupOrder: [], isDefault: true },
    tokens: {
      themes: [{ id: "dark", name: "Dark" }],
      tokens: [{ family: "color", name: "accent", values: ["#2563eb"], usage: null, hash: "h" }],
      fonts: [],
      families: [],
      styles: [],
      dropped: [{ family: "color", name: "brand", reason: "var()" }],
      source: null,
    },
    tokensError: null,
    sections: [],
    components: [],
    assets: [],
    fonts: [],
    digest: "0123456789abcdef",
  },
};

function panel(designSystems: DesignSystemEntry[], viewed: Parameters<typeof ArtifactsPanel>[0]["viewed"] = null) {
  const onView = vi.fn();
  render(
    <ArtifactsPanel
      sessionId={SESSION}
      artifacts={[]}
      viewed={viewed}
      onView={onView}
      isExpanded={false}
      onToggleExpanded={() => undefined}
      onError={() => undefined}
      cwd="/w"
      canvases={[{ key: "c-0123456789abcdef", folder: "/w/c", relative: "c", title: "Checkout", shownAt: 1, artboards: 2 }]}
      designSystems={designSystems}
    />,
  );
  return onView;
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((cmd) => {
    if (cmd === "ds_read") return Promise.resolve(READ);
    if (cmd === "design_systems_list") return Promise.resolve({ systems: [], defaultProblem: { kind: "noneMarked", relatives: ["a", "b"] } });
    return Promise.resolve(null);
  });
});

describe("design systems in the Artifacts tab", () => {
  it("lists a system with its counts and opens it", () => {
    const onView = panel([ENTRY]);
    const row = screen.getByRole("button", { name: /^Acme/ });
    expect(row.textContent).toContain("Design system · 42 tokens · 12 components");
    fireEvent.click(row);
    expect(onView).toHaveBeenCalledWith({ designSystemKey: KEY });
  });

  it("forgets a system on Remove", () => {
    panel([ENTRY]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Acme from Artifacts" }));
    expect(invoke).toHaveBeenCalledWith("ds_forget", { sessionId: SESSION, key: KEY });
  });

  it("shows the viewer with its notes and hands the shell its state", async () => {
    panel([ENTRY], { designSystemKey: KEY });
    expect(await screen.findByRole("heading", { name: "Acme" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("could not be read"));
    expect(screen.getByRole("status").textContent).toContain("No default design system: none of `a` and `b` is marked default.");
    fireEvent.click(screen.getByRole("button", { name: "Show in Finder" }));
    expect(invoke).toHaveBeenCalledWith("reveal_file_in_finder", { path: "/w/docs/ds/design-system.json" });
  });
});

describe("the default's line", () => {
  it("words both problems", () => {
    expect(defaultProblemLine({ kind: "severalMarked", relatives: ["a", "b"] })).toBe("No default design system: `a` and `b` are both marked default.");
    expect(defaultProblemLine({ kind: "noneMarked", relatives: ["a", "b", "c"] })).toBe("No default design system: none of `a`, `b` and `c` is marked default.");
  });
});

describe("the design system card", () => {
  it("is kept in a transcript only when well formed and opens the system", () => {
    const card = { kind: "design-system", designSystemKey: KEY, title: "Acme", tokens: 42, components: 12 };
    expect(parseArtifactCard(card)).toEqual(card);
    expect(parseArtifactCard({ ...card, designSystemKey: "c-0123456789abcdef" })).toBeNull();
    const onOpen = vi.fn();
    render(<ArtifactCardRow card={card as never} state="open" onOpen={onOpen} />);
    expect(screen.getByText("Design system · 42 tokens · 12 components")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open the design system Acme" }));
    expect(onOpen).toHaveBeenCalledWith(card);
  });
});

describe("design systems in the gallery", () => {
  it("lists a system with its session and counts", async () => {
    const { galleryRows } = await import("../lib/artifacts");
    const session = { id: SESSION, name: "Brand work", profileId: "qwen", cwd: "/w", status: "running", createdAt: 1, transport: "acp" } as const;
    const rows = galleryRows([session as never], new Map(), () => "Qwen Code", new Map(), new Map([[SESSION, [ENTRY]]]));
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("design-system");
  });
});

describe("the shared theme pick", () => {
  it("is the same for every reader of a system in a session, and falls back to the first", async () => {
    const { renderHook, act } = await import("@testing-library/react");
    const { useDesignSystemTheme } = await import("../hooks/useDesignSystemTheme");
    const themes = ["dark", "light"];
    const one = renderHook(() => useDesignSystemTheme("s-a", KEY, themes));
    const two = renderHook(() => useDesignSystemTheme("s-a", KEY, themes));
    const other = renderHook(() => useDesignSystemTheme("s-b", KEY, themes));
    expect(one.result.current.theme).toBe("dark");
    act(() => one.result.current.setTheme("light"));
    expect(two.result.current.theme).toBe("light");
    expect(other.result.current.theme).toBe("dark");
    const narrowed = renderHook(() => useDesignSystemTheme("s-a", KEY, ["sepia"]));
    expect(narrowed.result.current.theme).toBe("sepia");
  });
});

describe("out of date and Sync again", () => {
  it("words the source line and the message", async () => {
    const { sourceLine, syncMessage, parseSourceState } = await import("../lib/design-systems");
    const changed = { state: "changed" as const, commit: "a1b2c3d4", paths: ["src/styles/globals.css"], commits: 3, uncommitted: false };
    expect(sourceLine(changed)).toBe("Source changed since a1b2c3d: `src/styles/globals.css`, 3 commits.");
    expect(sourceLine({ ...changed, commits: 1 })).toBe("Source changed since a1b2c3d: `src/styles/globals.css`, 1 commit.");
    expect(sourceLine({ ...changed, commits: 0, uncommitted: true })).toBe("Source changed since a1b2c3d: `src/styles/globals.css` has uncommitted changes.");
    expect(sourceLine({ state: "unknownCommit", commit: "a1b2c3d" })).toBe("Source commit a1b2c3d is not in this repository.");
    expect(sourceLine({ state: "unreadable" })).toBe("Source paths could not be read.");
    expect(sourceLine({ state: "current", commit: "a1b2c3d" })).toBeNull();
    expect(sourceLine({ state: "none" })).toBeNull();
    expect(syncMessage("docs/design-system", changed)).toBe(
      "Update the design system `docs/design-system` from its source. `src/styles/globals.css` changed since a1b2c3d. Change only the tokens that changed, keep their usage notes, and record the new commit in `meta.source`.",
    );
    expect(parseSourceState({ state: "changed", commit: "HEAD", paths: [], commits: 1, uncommitted: false })).toBeNull();
  });

  it("offers Sync again only when the source changed, and only fills the composer", async () => {
    invoke.mockImplementation((cmd) => {
      if (cmd === "ds_read") return Promise.resolve(READ);
      if (cmd === "ds_source_state") return Promise.resolve({ state: "changed", commit: "a1b2c3d", paths: ["src/x.css"], commits: 2, uncommitted: false });
      return Promise.resolve(null);
    });
    const onInsertText = vi.fn();
    render(
      <ArtifactsPanel
        sessionId={SESSION}
        artifacts={[]}
        viewed={{ designSystemKey: KEY }}
        onView={() => undefined}
        isExpanded={false}
        onToggleExpanded={() => undefined}
        onError={() => undefined}
        cwd="/w"
        designSystems={[ENTRY]}
        onInsertText={onInsertText}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Sync again" }));
    expect(onInsertText).toHaveBeenCalledWith(expect.stringContaining("Update the design system `docs/ds` from its source."));
    expect(invoke.mock.calls.some(([cmd]) => cmd === "acp_prompt")).toBe(false);
  });
});
