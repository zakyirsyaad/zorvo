import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ToolExecution } from "../types";

const counted = vi.hoisted(() => ({ calls: 0 }));

vi.mock("../lib/diff-rows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/diff-rows")>();
  return {
    ...actual,
    diffRows: (...args: Parameters<typeof actual.diffRows>) => {
      counted.calls += 1;
      return actual.diffRows(...args);
    },
  };
});

const { ToolCallList } = await import("../components/chat/ToolCallList");

describe("ToolCallList's line counts", () => {
  it("diffs an edit once, not on every streamed frame", () => {
    const details = [{ kind: "diff" as const, path: "/repo/a.ts", oldText: "a\n", newText: "b\n" }];
    const tool = (): ToolExecution => ({ id: "t-1", name: "Edit a.ts", kind: "edit", status: "completed", locations: ["/repo/a.ts"], details });
    // MessageRow hands a fresh tools array every frame; the diff detail itself is the same object.
    const view = render(<ToolCallList tools={[tool()]} defaultOpenDiffs={false} isTurnOver />);
    const after = counted.calls;
    view.rerender(<ToolCallList tools={[tool()]} defaultOpenDiffs={false} isTurnOver />);
    view.rerender(<ToolCallList tools={[tool()]} defaultOpenDiffs={false} isTurnOver />);
    expect(after).toBe(1);
    expect(counted.calls).toBe(1);
  });
});
