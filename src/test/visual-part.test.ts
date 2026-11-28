import { describe, expect, it } from "vitest";
import { withVisualPart } from "../lib/visual-part";
import type { VisualEntry } from "../lib/visuals";
import type { ChatMessage } from "../types";

const entry: VisualEntry = { id: "v-0123456789abcdef", title: "Flow", kind: "svg", bytes: 10, shownAt: 1 };
const part = { kind: "visual", id: entry.id, title: "Flow", visualKind: "svg" };
const ctx = { sessionId: "s", now: 9, createId: (prefix: string) => `${prefix}-new` };

describe("withVisualPart", () => {
  it("puts the visual after the text already in the open reply", () => {
    const messages: ChatMessage[] = [{ id: "a", role: "agent", content: "one", timestamp: 1, parts: [{ kind: "text", text: "one" }] }];
    const next = withVisualPart(messages, entry, ctx);
    expect(next[0].parts).toEqual([{ kind: "text", text: "one" }, part]);
    expect(next[0].content).toBe("one");
    expect(messages[0].parts).toHaveLength(1);
  });

  it("starts a reply when none is open", () => {
    const messages: ChatMessage[] = [{ id: "u", role: "user", content: "draw", timestamp: 1 }];
    const next = withVisualPart(messages, entry, ctx);
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({ id: "msg-new", role: "agent", content: "", parts: [part] });
  });

  it("keeps the text of a reply written before parts existed first", () => {
    const messages: ChatMessage[] = [{ id: "a", role: "agent", content: "a", timestamp: 1 }];
    expect(withVisualPart(messages, entry, ctx)[0].parts).toEqual([{ kind: "text", text: "a" }, part]);
  });

  it("lets text that arrives next start a new part after the visual", () => {
    const messages: ChatMessage[] = [{ id: "a", role: "agent", content: "", timestamp: 1 }];
    const next = withVisualPart(withVisualPart(messages, entry, ctx), { ...entry, id: "v-000000000000000b" }, ctx);
    expect(next[0].parts?.map((p) => p.kind)).toEqual(["visual", "visual"]);
  });
});
