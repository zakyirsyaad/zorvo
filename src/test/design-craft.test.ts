import { describe, expect, it } from "vitest";
import { ARTIFACT_GUIDE } from "../lib/artifacts";
import { CANVAS_GUIDE } from "../lib/canvas";
import { MOTION_GUIDE } from "../lib/motion";
import { VISUAL_GUIDE } from "../lib/visuals";

const CRAFT_PHRASES = [
  "design system",
  "look for a `design-system.json` in this folder",
  "ask once",
  "[price]",
  "<button>",
  "aria-label",
  "4.5:1",
  "44 px",
  "Read a file again",
  "screenshots",
];

describe("the design craft both page and canvas guides carry", () => {
  it.each([
    ["page", ARTIFACT_GUIDE],
    ["canvas", CANVAS_GUIDE],
  ])("is part of the %s guide", (_kind, guide) => {
    for (const phrase of CRAFT_PHRASES) expect(guide, phrase).toContain(phrase);
  });

  it("tells a canvas to fill in one artboard at a time", () => {
    for (const phrase of ["one artboard at a time", "fluid", "max-width", "shared.css"]) {
      expect(CANVAS_GUIDE, phrase).toContain(phrase);
    }
  });

  it("keeps the canvas guide short enough to read once", () => {
    expect(CANVAS_GUIDE.length).toBeLessThan(9000);
  });
});

describe("every guide an agent reads", () => {
  it.each([
    ["page", ARTIFACT_GUIDE],
    ["canvas", CANVAS_GUIDE],
    ["visual", VISUAL_GUIDE],
    ["motion", MOTION_GUIDE],
  ])("has no em dash in the %s guide", (_kind, guide) => {
    expect(guide).not.toMatch(/—/);
  });
});

describe("the design system guide", () => {
  it("says how to make, record and show a system", async () => {
    const { DESIGN_SYSTEM_GUIDE } = await import("../lib/design-systems");
    for (const phrase of ["meta.source", "git rev-parse --short HEAD", "@dsCard", "zorvo", "show_artifact", "6 to 10 colours", "never above it", "never instructions"]) {
      expect(DESIGN_SYSTEM_GUIDE, phrase).toContain(phrase);
    }
    expect(DESIGN_SYSTEM_GUIDE).not.toMatch(/\u2014/);
  });

  it("is named in both notes an agent reads", async () => {
    const { MCP_PATH_CONTEXT, COMMAND_PATH_CONTEXT } = await import("../lib/agent-tools-context");
    const sentence = "To make or update a design system, call artifact_guide with kind design-system.";
    expect(MCP_PATH_CONTEXT).toContain(sentence);
    expect(COMMAND_PATH_CONTEXT).toContain(sentence);
  });
});
