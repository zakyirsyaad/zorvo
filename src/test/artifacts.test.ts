import { describe, expect, it } from "vitest";
import {
  cardState,
  filterGallery,
  galleryRows,
  hasVersion,
  newestVersion,
  canvasOpeningFor,
  openingFor,
  parseArtifacts,
  parseShown,
  shownArtifactOf,
  shownResultText,
  rowTitle,
  versionLabel,
  type ShownArtifact,
} from "../lib/artifacts";
import { normalizeTranscript } from "../lib/persistence";
import type { Artifact, Session } from "../types";

const ID = "a-0123456789abcdef";

function artifactOf(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: ID,
    title: "Report",
    sourcePath: "/work/report.html",
    versions: [
      { n: 1, at: 100, bytes: 10 },
      { n: 2, at: 200, bytes: 12 },
    ],
    ...overrides,
  };
}

function sessionOf(overrides: Partial<Session>): Session {
  return { id: "s-1", name: "A session", profileId: "codex-acp", cwd: "/work", status: "idle", createdAt: 1, transport: "acp", ...overrides };
}

function shownOf(overrides: Partial<ShownArtifact> = {}): ShownArtifact {
  return { artifact: artifactOf(), version: 2, isNewArtifact: false, isNewVersion: true, ...overrides };
}

describe("parseArtifacts", () => {
  it("keeps well-formed artifacts", () => {
    expect(parseArtifacts([artifactOf()])).toEqual([artifactOf()]);
  });

  it("drops what does not fit, and reads anything else as none", () => {
    const noVersions = { ...artifactOf(), versions: [] };
    const badId = { ...artifactOf(), id: "../x" };
    const badVersion = { ...artifactOf(), versions: [{ n: 0, at: 1, bytes: 1 }] };
    const noTitle = { ...artifactOf(), title: 3 };
    expect(parseArtifacts([noVersions, badId, badVersion, noTitle, null, "x"])).toEqual([]);
    expect(parseArtifacts({})).toEqual([]);
    expect(parseArtifacts(undefined)).toEqual([]);
  });

  it("keeps only the fields it knows", () => {
    const [parsed] = parseArtifacts([{ ...artifactOf(), extra: "x", versions: [{ n: 1, at: 1, bytes: 1, more: true }] }]);
    expect(parsed).toEqual({ id: ID, title: "Report", sourcePath: "/work/report.html", versions: [{ n: 1, at: 1, bytes: 1 }] });
  });
});

describe("parseShown", () => {
  it("reads what artifact_show returns", () => {
    expect(parseShown(shownOf())).toEqual(shownOf());
  });

  it("refuses a version the artifact does not list, and other shapes", () => {
    expect(parseShown({ ...shownOf(), version: 9 })).toBeNull();
    expect(parseShown({ ...shownOf(), isNewVersion: "yes" })).toBeNull();
    expect(parseShown(null)).toBeNull();
  });
});

describe("versions", () => {
  it("names the newest and labels a version against it", () => {
    const pruned = artifactOf({ versions: [{ n: 4, at: 1, bytes: 1 }, { n: 5, at: 2, bytes: 1 }] });
    expect(newestVersion(pruned)).toBe(5);
    expect(versionLabel(4, pruned)).toBe("Version 4 of 5");
    expect(hasVersion(pruned, 4)).toBe(true);
    expect(hasVersion(pruned, 1)).toBe(false);
    expect(hasVersion(undefined, 1)).toBe(false);
  });
});

describe("shownResultText", () => {
  it("is the JSON the agent reads", () => {
    expect(JSON.parse(shownResultText(shownOf()))).toEqual({ title: "Report", version: 2, shown: true });
  });
});

describe("openingFor", () => {
  it("shows the tab for a new artifact in the session on screen", () => {
    expect(openingFor({ isOnScreen: true, shown: shownOf({ isNewArtifact: true }), viewed: null })).toBe("show-tab");
  });

  it("replaces the page when the viewer follows this artifact's newest version", () => {
    expect(openingFor({ isOnScreen: true, shown: shownOf(), viewed: { artifactId: ID, version: null } })).toBe("replace");
  });

  it("moves nothing for another session, another artifact, a pinned version or a closed viewer", () => {
    expect(openingFor({ isOnScreen: false, shown: shownOf({ isNewArtifact: true }), viewed: null })).toBe("none");
    expect(openingFor({ isOnScreen: true, shown: shownOf(), viewed: { artifactId: "a-ffffffffffffffff", version: null } })).toBe("none");
    expect(openingFor({ isOnScreen: true, shown: shownOf(), viewed: { artifactId: ID, version: 1 } })).toBe("none");
    expect(openingFor({ isOnScreen: true, shown: shownOf(), viewed: null })).toBe("none");
  });
});

describe("canvasOpeningFor", () => {
  const KEY = "c-0123456789abcdef";
  it("opens a canvas of the session on screen in the tab", () => {
    expect(canvasOpeningFor({ isOnScreen: true, key: KEY, viewed: null })).toBe("show-tab");
    expect(canvasOpeningFor({ isOnScreen: true, key: KEY, viewed: { artifactId: ID, version: null } })).toBe("show-tab");
  });

  it("moves nothing for another session, or when the canvas already shows", () => {
    expect(canvasOpeningFor({ isOnScreen: false, key: KEY, viewed: null })).toBe("none");
    expect(canvasOpeningFor({ isOnScreen: true, key: KEY, viewed: { canvasKey: KEY } })).toBe("none");
  });
});

describe("cardState", () => {
  it("is open while the artifact exists, whatever became of the version", () => {
    expect(cardState({ artifactId: ID, title: "Report", version: 1 }, [artifactOf()])).toBe("open");
    expect(cardState({ artifactId: ID, title: "Report", version: 1 }, [])).toBe("removed");
  });
});

describe("galleryRows", () => {
  const names = (id: string) => (id === "codex-acp" ? "Codex" : id);

  it("lists every session's artifacts, newest first", () => {
    const sessions = [sessionOf({ id: "s-1", name: "One" }), sessionOf({ id: "s-2", name: "Two", archivedAt: 5 })];
    const older = artifactOf({ id: "a-1111111111111111", title: "Older", versions: [{ n: 1, at: 50, bytes: 1 }] });
    const bySession = new Map([
      ["s-1", [artifactOf()]],
      ["s-2", [older]],
    ]);

    const rows = galleryRows(sessions, bySession, names);

    expect(rows.map((row) => rowTitle(row))).toEqual(["Report", "Older"]);
    expect(rows[0]).toMatchObject({ sessionId: "s-1", sessionName: "One", agentName: "Codex", isArchived: false, at: 200 });
    expect(rows[1].isArchived).toBe(true);
  });

  it("lists canvases beside pages, by when they were shown", () => {
    const canvas = { key: "c-0123456789abcdef", folder: "/work/design/x", relative: "design/x", title: "Checkout", shownAt: 150, artboards: 12 };
    const rows = galleryRows([sessionOf({ name: "One" })], new Map([["s-1", [artifactOf()]]]), names, new Map([["s-1", [canvas]]]));

    expect(rows.map((row) => rowTitle(row))).toEqual(["Report", "Checkout"]);
    expect(rows[1]).toMatchObject({ kind: "canvas", canvas, at: 150, sessionName: "One" });
    expect(filterGallery(rows, "check").map((row) => rowTitle(row))).toEqual(["Checkout"]);
  });

  it("gives no row for a session that is not listed", () => {
    expect(galleryRows([], new Map([["gone", [artifactOf()]]]), names)).toEqual([]);
  });

  it("filters by title, whatever the case", () => {
    const rows = galleryRows([sessionOf({})], new Map([["s-1", [artifactOf(), artifactOf({ id: "a-2222222222222222", title: "Diagram" })]]]), names);
    expect(filterGallery(rows, " DIAG ").map((row) => rowTitle(row))).toEqual(["Diagram"]);
    expect(filterGallery(rows, "  ")).toHaveLength(2);
    expect(filterGallery(rows, "nothing")).toEqual([]);
  });
});

describe("a saved transcript", () => {
  const message = { id: "m-1", role: "agent", content: "", timestamp: 1 };

  it("keeps a well-formed artifact card", () => {
    const card = { artifactId: ID, title: "Report", version: 2 };
    expect(normalizeTranscript([{ ...message, artifactCard: card }])[0].artifactCard).toEqual(card);
  });

  it("keeps a canvas card", () => {
    const card = { kind: "canvas", canvasKey: "c-0123456789abcdef", title: "Checkout", artboards: 12 };
    expect(normalizeTranscript([{ ...message, artifactCard: card }])[0].artifactCard).toEqual(card);
    const [bad] = normalizeTranscript([{ ...message, artifactCard: { ...card, canvasKey: "../x" } }]);
    expect("artifactCard" in bad).toBe(false);
  });

  it("drops a malformed one and keeps the message", () => {
    const [kept] = normalizeTranscript([{ ...message, artifactCard: { artifactId: "../x", title: "T", version: 1 } }]);
    expect(kept.id).toBe("m-1");
    expect("artifactCard" in kept).toBe(false);
  });
});

describe("shownArtifactOf", () => {
  const one = { id: "a-0000000000000001", title: "One", sourcePath: "/w/1.html", versions: [{ n: 1, at: 1, bytes: 1 }] };
  const two = { ...one, id: "a-0000000000000002", title: "Two" };

  it("is the viewed artifact, or the only one when none is viewed", () => {
    expect(shownArtifactOf([one, two], { artifactId: two.id, version: null })).toBe(two);
    expect(shownArtifactOf([one], null)).toBe(one);
    expect(shownArtifactOf([one, two], null)).toBeUndefined();
    expect(shownArtifactOf([one], { artifactId: "a-ffffffffffffffff", version: null })).toBeUndefined();
  });
});
