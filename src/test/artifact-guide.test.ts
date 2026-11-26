import { describe, expect, it } from "vitest";
import { ARTIFACT_GUIDE } from "../lib/artifacts";

describe("the artifact guide", () => {
  it("is short enough to read once", () => {
    expect(ARTIFACT_GUIDE.length).toBeGreaterThan(1500);
    expect(ARTIFACT_GUIDE.length).toBeLessThan(9000);
  });

  it("names every host a page may load from, as the tool does", () => {
    for (const host of ["cdnjs.cloudflare.com", "cdn.jsdelivr.net/npm/", "unpkg.com", "cdn.tailwindcss.com", "code.jquery.com", "fonts.googleapis.com"]) {
      expect(ARTIFACT_GUIDE).toContain(host);
    }
  });

  it("covers both themes, narrow widths and what a page cannot do", () => {
    for (const phrase of ["prefers-color-scheme: dark", "320", "localStorage", "fetch", "exact version"]) {
      expect(ARTIFACT_GUIDE).toContain(phrase);
    }
  });
});
