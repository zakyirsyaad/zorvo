import { describe, expect, it } from "vitest";
import { ARTIFACT_GUIDE } from "../lib/artifacts";
import { CANVAS_GUIDE } from "../lib/canvas";
import { MOTION_GUIDE } from "../lib/motion";
import { VISUAL_GUIDE } from "../lib/visuals";

const CRAFT_PHRASES = [
  "design system",
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
