import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("window sizes", () => {
  it("the main window cannot shrink below 640 × 560", () => {
    const config = JSON.parse(readFileSync(resolve(__dirname, "../../src-tauri/tauri.conf.json"), "utf8"));
    const main = config.app.windows.find((window: { label: string }) => window.label === "main");
    expect(main).toMatchObject({ minWidth: 640, minHeight: 560 });
  });
});
