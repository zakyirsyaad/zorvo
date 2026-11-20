import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ArtifactGallery } from "../components/artifacts/ArtifactGallery";
import type { GalleryRow } from "../lib/artifacts";

const NOW = 1_800_000_000_000;
const row = (overrides: Partial<Extract<GalleryRow, { artifact: unknown }>> & { title: string; id: string }): GalleryRow => ({
  sessionId: "s-1",
  sessionName: "Session list performance",
  profileId: "claude-code",
  agentName: "Claude Code",
  isArchived: false,
  at: NOW - 60_000,
  artifact: { id: overrides.id, title: overrides.title, sourcePath: "/w/a.html", versions: [{ n: 3, at: NOW - 60_000, bytes: 1 }] },
  ...overrides,
});

const ROWS = [
  row({ id: "a-0000000000000001", title: "Session list performance" }),
  row({ id: "a-0000000000000002", title: "Transcript save timeline", sessionId: "s-2", sessionName: "Fix transcript save interval", agentName: "Codex" }),
  row({ id: "a-0000000000000003", title: "Sign-in states diagram", sessionId: "s-3", sessionName: "Agent sign-in chip", isArchived: true }),
];

describe("the gallery", () => {
  it("lists every artifact with its session, version and agent, in the order given", () => {
    render(<ArtifactGallery rows={ROWS} onOpen={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Output" })).toBeTruthy();
    expect(screen.getByText("3 pages in 3 sessions")).toBeTruthy();
    const items = within(screen.getByRole("list", { name: "Output" })).getAllByRole("listitem");
    expect(items.map((item) => within(item).getByRole("button").getAttribute("aria-label"))).toEqual([
      "Session list performance, in Session list performance",
      "Transcript save timeline, in Fix transcript save interval",
      "Sign-in states diagram, in Agent sign-in chip",
    ]);
    expect(items[0].textContent).toContain("Session list performance · Version 3");
    expect(items[1].textContent).toContain("Codex");
    expect(items[2].textContent).toContain("Archived");
    expect(items[0].textContent).not.toContain("Archived");
  });

  it("opens an artifact in its session", () => {
    const onOpen = vi.fn();
    render(<ArtifactGallery rows={ROWS} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /Transcript save timeline/ }));
    expect(onOpen).toHaveBeenCalledWith("s-2", "a-0000000000000002");
  });

  it("searches by title", () => {
    render(<ArtifactGallery rows={ROWS} onOpen={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search artifacts" }), { target: { value: "diagram" } });
    expect(within(screen.getByRole("list", { name: "Output" })).getAllByRole("listitem")).toHaveLength(1);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search artifacts" }), { target: { value: "zzz" } });
    expect(screen.getByText("No artifacts match.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Output" })).toBeNull();
  });

  it("offers Show sidebar while the sidebar is hidden, since the top bar is not there", () => {
    const onShowSidebar = vi.fn();
    const { rerender } = render(<ArtifactGallery rows={ROWS} onOpen={vi.fn()} onShowSidebar={onShowSidebar} />);

    fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
    expect(onShowSidebar).toHaveBeenCalledTimes(1);

    rerender(<ArtifactGallery rows={ROWS} onOpen={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Show sidebar" })).toBeNull();
  });

  it("shows a notice of its own, since the chat that usually shows one is hidden under it", () => {
    render(<ArtifactGallery rows={ROWS} onOpen={vi.fn()} notice={<div role="alert">Could not delete the session's artifacts.</div>} />);
    expect(within(screen.getByRole("region", { name: "Artifact gallery" })).getByRole("alert").textContent).toContain("Could not delete");
  });

  it("counts one page in one session in the singular, and says where pages live", () => {
    render(<ArtifactGallery rows={ROWS.slice(0, 1)} onOpen={vi.fn()} />);
    expect(screen.getByText("1 page in 1 session")).toBeTruthy();
    expect(screen.getByText("Pages stay on this Mac. Deleting a session deletes its pages.")).toBeTruthy();
  });
});

describe("a canvas in the gallery", () => {
  type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
  const CANVAS = { key: "c-0123456789abcdef", folder: "/w/design/checkout", relative: "design/checkout", title: "Checkout", shownAt: NOW, artboards: 12 };
  const CANVAS_ROW: GalleryRow = { sessionId: "s-9", sessionName: "Checkout flow", profileId: "claude-code", agentName: "Claude Code", isArchived: false, at: NOW, kind: "canvas", canvas: CANVAS };

  it("opens a canvas and removes it from its menu", async () => {
    const internals = (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
    const spy = vi.spyOn(internals, "invoke").mockResolvedValue(undefined);
    const onOpenCanvas = vi.fn();
    render(<ArtifactGallery rows={[CANVAS_ROW]} onOpen={vi.fn()} onOpenCanvas={onOpenCanvas} />);

    expect(screen.getByRole("button", { name: "Checkout, in Checkout flow" }).textContent).toContain("Canvas · 12 artboards");
    fireEvent.click(screen.getByRole("button", { name: "Checkout, in Checkout flow" }));
    expect(onOpenCanvas).toHaveBeenCalledWith("s-9", CANVAS.key);

    fireEvent.click(screen.getByRole("button", { name: "More actions for Checkout" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Remove/ }));
    await waitFor(() => expect(spy.mock.calls.filter(([cmd]) => cmd === "canvas_forget").map(([, args]) => args)).toEqual([{ sessionId: "s-9", key: CANVAS.key }]));
    spy.mockRestore();
  });
});

