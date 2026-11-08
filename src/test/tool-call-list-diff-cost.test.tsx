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

const { diffDetail } = await import("../lib/diff-rows");

describe("ToolCallList's line counts", () => {
  it("counts an edit from the rows kept when it arrived, never diffing the files again", () => {
    // The diff is worked out once, when the agent's update arrives; drawing only reads its rows.
    const details = [diffDetail("/repo/a.ts", "a\n", "b\n")];
    counted.calls = 0;
    const tool = (): ToolExecution => ({ id: "t-1", name: "Edit a.ts", kind: "edit", status: "completed", locations: ["/repo/a.ts"], details });
    const view = render(<ToolCallList tools={[tool()]} defaultOpenDiffs isTurnOver />);
    view.rerender(<ToolCallList tools={[tool()]} defaultOpenDiffs isTurnOver />);
    expect(counted.calls).toBe(0);
  });
});
