import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The Release workflow's signing job installs the Tauri CLI alone, from .github/updater-signer, so none of the
// project's dependencies run next to the updater key. The build uses the CLI from the root lockfile; these tests
// keep the two on one version, and keep the signer folder's install free of scripts.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

const signerPackage = JSON.parse(read(".github/updater-signer/package.json"));
const signerLock = JSON.parse(read(".github/updater-signer/package-lock.json"));

/** The version pnpm resolved for the root package's @tauri-apps/cli. */
function rootCliVersion() {
  const match = /^ {6}'@tauri-apps\/cli':\n {8}specifier: [^\n]+\n {8}version: (\d+\.\d+\.\d+)\s*$/m.exec(read("pnpm-lock.yaml"));
  if (!match) throw new Error("pnpm-lock.yaml has no resolved @tauri-apps/cli for the root package.");
  return match[1];
}

describe("the signing job's Tauri CLI", () => {
  it("is pinned to one exact version, not a range", () => {
    expect(Object.keys(signerPackage.dependencies)).toEqual(["@tauri-apps/cli"]);
    expect(signerPackage.dependencies["@tauri-apps/cli"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("is the version the root lockfile builds with", () => {
    expect(signerPackage.dependencies["@tauri-apps/cli"]).toBe(rootCliVersion());
  });

  it("is locked to that version, with a hash for every package", () => {
    const version = signerPackage.dependencies["@tauri-apps/cli"];
    const packages = Object.entries(signerLock.packages).filter(([path]) => path !== "");
    expect(signerLock.packages["node_modules/@tauri-apps/cli"].version).toBe(version);
    expect(packages.length).toBeGreaterThan(1);
    for (const [path, entry] of packages) {
      expect(entry.version, path).toBe(version);
      expect(entry.integrity, path).toMatch(/^sha512-/);
      expect(entry.resolved, path).toMatch(/^https:\/\/registry\.npmjs\.org\//);
    }
  });

  it("has no install script, so installing it with scripts off hides nothing", () => {
    for (const [path, entry] of Object.entries(signerLock.packages)) expect(entry.hasInstallScript, path).toBeUndefined();
  });

  it("is built for macOS 2.12.0 or newer, which can bind a signature to the app version", () => {
    const [major, minor] = signerPackage.dependencies["@tauri-apps/cli"].split(".").map(Number);
    expect(major === 2 && minor >= 12).toBe(true);
  });

  it("is watched by dependabot together with the root, so the two move in one pull request", () => {
    const dependabot = read(".github/dependabot.yml");
    expect(dependabot).toMatch(/directories:\n\s+- \/\n\s+- \/\.github\/updater-signer\n/);
  });
});
