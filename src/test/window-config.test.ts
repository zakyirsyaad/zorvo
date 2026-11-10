import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("window sizes", () => {
  it("the main window cannot shrink below 640 × 560", () => {
    const config = JSON.parse(readFileSync(resolve(__dirname, "../../src-tauri/tauri.conf.json"), "utf8"));
    const main = config.app.windows.find((window: { label: string }) => window.label === "main");
    expect(main).toMatchObject({ minWidth: 640, minHeight: 560 });
  });

  it("places the traffic lights the same way in the main window and in popouts", () => {
    const config = JSON.parse(readFileSync(resolve(__dirname, "../../src-tauri/tauri.conf.json"), "utf8"));
    const main = config.app.windows.find((window: { label: string }) => window.label === "main");
    expect(main.trafficLightPosition.x).toBe(20);
    expect(typeof main.trafficLightPosition.y).toBe("number");
    const rust = readFileSync(resolve(__dirname, "../../src-tauri/src/windows.rs"), "utf8");
    const [, x, y] = rust.match(/TRAFFIC_LIGHT_POSITION: \(f64, f64\) = \(([\d.]+), ([\d.]+)\)/)!;
    expect([Number(x), Number(y)]).toEqual([main.trafficLightPosition.x, main.trafficLightPosition.y]);
    expect(rust).toContain(".traffic_light_position(");
  });
});
