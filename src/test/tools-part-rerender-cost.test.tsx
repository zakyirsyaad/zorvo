import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ToolExecution } from "../types";

const counted = vi.hoisted(() => ({ renders: 0 }));

// Counts how often a tool's expanded output is drawn. Its diff rows are what a long turn holds by the
// thousand, so drawing them again for tools that did not change is what made a long session lag.
vi.mock("../components/chat/ToolDetails", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/chat/ToolDetails")>();
  return {
    ...actual,
    ToolDetails: (props: Parameters<typeof actual.ToolDetails>[0]) => {
      counted.renders += 1;
      return actual.ToolDetails(props);
    },
  };
});

const { ToolsPart } = await import("../components/chat/ToolsPart");

const edit = (id: string, status: ToolExecution["status"] = "completed"): ToolExecution => ({
  id,
  name: `Edit ${id}.ts`,
  kind: "edit",
  status,
  locations: [`/repo/${id}.ts`],
  details: [{ kind: "diff", path: `/repo/${id}.ts`, oldText: "a\n", newText: "b\n" }],
});

describe("a streamed update to one tool in a long turn", () => {
  it("draws only that tool's output again, not every open diff", () => {
    counted.renders = 0;
    const first = edit("a");
    const second = edit("b");
    const third = edit("c", "running");
    // MessageRow hands each part a fresh tools array on every frame; unchanged tools keep their objects.
    const view = render(<ToolsPart tools={[first, second, third]} isCurrentTurn isTurnOver={false} />);
    expect(counted.renders).toBe(3);

    view.rerender(<ToolsPart tools={[first, second, { ...third, status: "completed" }]} isCurrentTurn isTurnOver={false} />);

    expect(counted.renders).toBe(4);
  });

  it("draws nothing again when the part's tools are the same objects in a fresh array", () => {
    counted.renders = 0;
    const tools = [edit("a"), edit("b")];
    const view = render(<ToolsPart tools={[...tools]} isCurrentTurn isTurnOver={false} />);
    const afterFirst = counted.renders;

    view.rerender(<ToolsPart tools={[...tools]} isCurrentTurn isTurnOver={false} />);

    expect(counted.renders).toBe(afterFirst);
  });
});
