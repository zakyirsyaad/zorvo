import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VISUAL_REFUSALS, isVisualId, parseVisualEntry, parseVisualRead, visualIdsOf } from "../lib/visuals";
import type { ChatMessage } from "../types";

const ENTRY = { id: "v-0123456789abcdef", title: "Flow", kind: "svg", bytes: 10, shownAt: 1 };

describe("visual rules", () => {
  it("keeps the refusals equal to the sentences Rust returns", () => {
    const rust = readFileSync("src-tauri/src/artifacts/visuals.rs", "utf8") + readFileSync("src-tauri/src/artifacts/source.rs", "utf8");
    for (const sentence of VISUAL_REFUSALS) expect(rust).toContain(`"${sentence}"`);
    expect(VISUAL_REFUSALS.size).toBe(8);
    expect(VISUAL_REFUSALS.has("That visual is no longer available.")).toBe(false);
  });

  it("knows a visual id by its shape", () => {
    expect(isVisualId("v-0123456789abcdef")).toBe(true);
    for (const bad of ["v-0123", "a-0123456789abcdef", "v-0123456789ABCDEF", 3, null]) expect(isVisualId(bad)).toBe(false);
  });

  it("parses an entry and refuses a wrong shape", () => {
    expect(parseVisualEntry(ENTRY)).toEqual(ENTRY);
    for (const bad of [null, {}, { ...ENTRY, id: "x" }, { ...ENTRY, kind: "png" }, { ...ENTRY, title: 3 }, { ...ENTRY, bytes: "1" }]) {
      expect(parseVisualEntry(bad)).toBeNull();
    }
  });

  it("parses a read only with its document", () => {
    expect(parseVisualRead({ entry: ENTRY, document: "<!doctype html>" })).toEqual({ entry: ENTRY, document: "<!doctype html>" });
    expect(parseVisualRead({ entry: ENTRY })).toBeNull();
    expect(parseVisualRead({ entry: {}, document: "x" })).toBeNull();
  });

  it("lists the visuals a transcript names, once each", () => {
    const visual = (id: string) => ({ kind: "visual" as const, id, title: "T", visualKind: "svg" as const });
    const messages: ChatMessage[] = [
      { id: "u", role: "user", content: "hi", timestamp: 1 },
      { id: "a", role: "agent", content: "x", timestamp: 2, parts: [{ kind: "text", text: "x" }, visual("v-000000000000000a"), visual("v-000000000000000b")] },
      { id: "b", role: "agent", content: "", timestamp: 3, parts: [visual("v-000000000000000a")] },
    ];
    expect(visualIdsOf(messages)).toEqual(["v-000000000000000a", "v-000000000000000b"]);
  });
});
