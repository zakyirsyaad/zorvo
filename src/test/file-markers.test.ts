import { describe, expect, it } from "vitest";
import { markersOf } from "../lib/file-markers";
import type { FileStat } from "../lib/diff-stats";

function stat(path: string, kind: FileStat["kind"], oldPath: string | null = null): FileStat {
  return { path, oldPath, kind, added: 1, removed: 0, isBinary: false, fingerprint: path };
}

describe("markersOf", () => {
  it("marks files relative to the folder and the folders above them, dropping changes outside it", () => {
    const markers = markersOf(
      [
        stat("app/src/a.ts", "modified"),
        stat("app/src/new.ts", "untracked"),
        stat("app/old.ts", "deleted"),
        stat("other/x.ts", "added"),
      ],
      "app/",
    );

    expect([...markers.files]).toEqual([
      ["src/a.ts", "modified"],
      ["src/new.ts", "added"],
    ]);
    expect([...markers.folders]).toEqual(["src"]);
  });

  it("marks every folder above a deleted file, though the file has no row", () => {
    const markers = markersOf([stat("lib/deep/gone.ts", "deleted")], "");

    expect(markers.files.size).toBe(0);
    expect([...markers.folders].sort()).toEqual(["lib", "lib/deep"]);
  });

  it("calls a renamed file modified and an added one added", () => {
    const markers = markersOf([stat("b.ts", "renamed", "a.ts"), stat("c.ts", "added")], "");

    expect(markers.files.get("b.ts")).toBe("modified");
    expect(markers.files.get("c.ts")).toBe("added");
  });

  it("marks nothing before the stats arrive", () => {
    const markers = markersOf(null, "");

    expect(markers.files.size).toBe(0);
    expect(markers.folders.size).toBe(0);
  });
});
