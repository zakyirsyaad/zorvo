import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { scrubSecrets, signerEntry, withoutProjectDirs } from "./signer-cli.mjs";

const ROOT = "/Users/me/zorvo";

describe("withoutProjectDirs", () => {
  const path = (...entries) => entries.join(delimiter);

  it("drops the folders `pnpm run` puts first, where a dependency's `bin` could stand in for node, git or gh", () => {
    const given = path(`${ROOT}/node_modules/.bin`, `${ROOT}/scripts/updater-signer/node_modules/.bin`, "/opt/homebrew/bin", "/usr/bin", "/bin");
    expect(withoutProjectDirs(given, ROOT)).toBe(path("/opt/homebrew/bin", "/usr/bin", "/bin"));
  });

  it("drops the project folder itself and relative entries, which mean whatever folder it is run from", () => {
    expect(withoutProjectDirs(path(ROOT, ".", "", "node_modules/.bin", "bin", "/usr/bin"), ROOT)).toBe("/usr/bin");
  });

  it("keeps a folder that only starts with the project's name", () => {
    expect(withoutProjectDirs(path(`${ROOT}-tools/bin`, "/usr/bin"), ROOT)).toBe(path(`${ROOT}-tools/bin`, "/usr/bin"));
  });

  it("keeps the order of what is left, and copes with no PATH at all", () => {
    expect(withoutProjectDirs(path("/b", "/a"), ROOT)).toBe(path("/b", "/a"));
    expect(withoutProjectDirs(undefined, ROOT)).toBe("");
  });
});

describe("scrubSecrets", () => {
  it("removes the updater key, its path and its password, old and new names, from an environment", () => {
    const env = {
      PATH: "/usr/bin",
      HOME: "/Users/me",
      TAURI_SIGNING_PRIVATE_KEY: "key",
      TAURI_SIGNING_PRIVATE_KEY_PATH: "/k",
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "pw",
      TAURI_PRIVATE_KEY: "old key",
      TAURI_PRIVATE_KEY_PASSWORD: "old pw",
      TAURI_BUNDLER_DMG_IGNORE_CI: "true",
    };
    scrubSecrets(env);
    expect(Object.keys(env).sort()).toEqual(["HOME", "PATH", "TAURI_BUNDLER_DMG_IGNORE_CI"]);
  });
});

describe("signerEntry", () => {
  it("is the CLI's own script inside the pinned install, which node runs directly, so no PATH lookup decides what runs", () => {
    expect(signerEntry(ROOT)).toBe(join(ROOT, "scripts/updater-signer/node_modules/@tauri-apps/cli/tauri.js"));
  });
});
