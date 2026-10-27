import { spawnSync } from "node:child_process";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReleaseError, assetNames, checkArtifact, checkDownloadPolicy, readConfig } from "./release-checks.mjs";

const PUBKEY = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDhBRTQwMUE3MERBOEI4OUY=";
const TAG = "v0.6.1";
const NAMES = assetNames("0.6.1");
const REPO = "zakyirsyaad/zorvo-releases";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zorvo-release-checks-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A build folder as the Release workflow's artifact has it: the DMG and a .app.tar.gz of Zorvo.app. */
let builds = 0;
function makeBuild({ binary = `xx${PUBKEY}xx`, prepare = () => {}, name = NAMES.package } = {}) {
  // Each call gets folders of its own, so a test can make several builds.
  const root = join(dir, `build-${builds++}`);
  const build = join(root, "build");
  const app = join(root, "app");
  mkdirSync(join(app, "Zorvo.app/Contents/MacOS"), { recursive: true });
  writeFileSync(join(app, "Zorvo.app/Contents/Info.plist"), "<plist/>");
  writeFileSync(join(app, "Zorvo.app/Contents/MacOS/zorvo"), binary);
  prepare(join(app, "Zorvo.app"));
  mkdirSync(build, { recursive: true });
  const made = spawnSync("tar", ["-czf", join(build, name), "-C", app, "Zorvo.app"], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  if (made.status !== 0) throw new Error(`tar failed: ${made.stderr}`);
  writeFileSync(join(build, NAMES.dmg), "dmg bytes");
  return build;
}

const check = (build) => checkArtifact({ dir: build, tag: TAG, pubkey: PUBKEY });

describe("assetNames", () => {
  it("names the files after the version, as the bundler and the release do", () => {
    expect(NAMES).toEqual({ package: "Zorvo_0.6.1_universal.app.tar.gz", dmg: "Zorvo_0.6.1_universal.dmg" });
  });
});

describe("checkArtifact", () => {
  it("accepts the DMG and a package that holds Zorvo.app with the public key in its binary", () => {
    expect(() => check(makeBuild())).not.toThrow();
  });

  it("accepts a link that stays inside the app", () => {
    const build = makeBuild({ prepare: (app) => symlinkSync("Contents/Info.plist", join(app, "link")) });
    expect(() => check(build)).not.toThrow();
  });

  it("refuses an extra file, even a hidden one", () => {
    const build = makeBuild();
    writeFileSync(join(build, ".hidden"), "x");
    expect(() => check(build)).toThrow(/must hold exactly/);
  });

  it("refuses a missing DMG", () => {
    const build = makeBuild();
    rmSync(join(build, NAMES.dmg));
    expect(() => check(build)).toThrow(/must hold exactly/);
  });

  it("refuses a package named for another version", () => {
    expect(() => check(makeBuild({ name: "Zorvo_0.6.0_universal.app.tar.gz" }))).toThrow(/must hold exactly/);
  });

  it("names an odd file by its safe characters only", () => {
    const build = makeBuild();
    writeFileSync(join(build, "a\n::stop-commands::b"), "x");
    let error = null;
    try {
      check(build);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ReleaseError);
    expect(error.message).not.toContain("\n");
    expect(error.message).toContain("a???stop-commands??b");
  });

  it("refuses a symlinked or empty DMG", () => {
    const linked = makeBuild();
    rmSync(join(linked, NAMES.dmg));
    symlinkSync("/etc/hosts", join(linked, NAMES.dmg));
    expect(() => check(linked)).toThrow(/not a plain, non-empty file/);
    const empty = makeBuild();
    writeFileSync(join(empty, NAMES.dmg), "");
    expect(() => check(empty)).toThrow(/not a plain, non-empty file/);
  });

  it("refuses a package with a file outside Zorvo.app", () => {
    const build = join(dir, "build");
    mkdirSync(build, { recursive: true });
    mkdirSync(join(dir, "app/Zorvo.app/Contents/MacOS"), { recursive: true });
    mkdirSync(join(dir, "app/etc"), { recursive: true });
    writeFileSync(join(dir, "app/Zorvo.app/Contents/MacOS/zorvo"), PUBKEY);
    writeFileSync(join(dir, "app/etc/passwd"), "x");
    spawnSync("tar", ["-czf", join(build, NAMES.package), "-C", join(dir, "app"), "Zorvo.app", "etc"], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
    writeFileSync(join(build, NAMES.dmg), "dmg");
    expect(() => check(build)).toThrow(/Zorvo\.app and nothing outside it/);
  });

  it("refuses a package that is not a tarball", () => {
    const build = makeBuild();
    writeFileSync(join(build, NAMES.package), "not a tarball");
    expect(() => check(build)).toThrow(ReleaseError);
  });

  it("refuses a hard link", () => {
    const build = makeBuild({ prepare: (app) => linkSync(join(app, "Contents/Info.plist"), join(app, "Contents/hard")) });
    expect(() => check(build)).toThrow(/hard link, or a link that points outside/);
  });

  it("refuses a link to an absolute path and one that climbs out", () => {
    expect(() => check(makeBuild({ prepare: (app) => symlinkSync("/etc/passwd", join(app, "link")) }))).toThrow(/points outside/);
    expect(() => check(makeBuild({ prepare: (app) => symlinkSync("../../outside", join(app, "link")) }))).toThrow(/points outside/);
  });

  it("refuses a name with an arrow in it, which would hide where a link points", () => {
    const build = makeBuild({ prepare: (app) => symlinkSync("/etc", join(app, "x -> y")) });
    expect(() => check(build)).toThrow(/contains ' -> '/);
  });

  it("refuses a package that is a plain tar file, not a gzip one", () => {
    const build = makeBuild();
    spawnSync("tar", ["-cf", join(build, NAMES.package), "-C", join(build, "..", "app"), "Zorvo.app"], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
    expect(() => check(build)).toThrow(/not a gzip file/);
  });

  it("refuses an app that does not hold the updater public key", () => {
    expect(() => check(makeBuild({ binary: "no key in here" }))).toThrow(/does not hold the updater public key/);
    expect(() => check(makeBuild({ binary: "xxOTHERKEYxx" }))).toThrow(/does not hold the updater public key/);
  });

  it("refuses a package without the app's binary", () => {
    const build = makeBuild({ prepare: (app) => rmSync(join(app, "Contents/MacOS/zorvo")) });
    expect(() => check(build)).toThrow(ReleaseError);
  });

  it("refuses an empty public key, which every binary would 'hold'", () => {
    expect(() => checkArtifact({ dir: makeBuild(), tag: TAG, pubkey: "" })).toThrow(/does not hold the updater public key/);
  });
});

describe("readConfig", () => {
  it("reads the version, the public key and the update endpoints", () => {
    const path = join(dir, "tauri.conf.json");
    const endpoints = ["https://github.com/a/b/releases/latest/download/latest.json"];
    writeFileSync(path, JSON.stringify({ version: "0.6.1", plugins: { updater: { pubkey: PUBKEY, endpoints } } }));
    expect(readConfig(path)).toEqual({ version: "0.6.1", pubkey: PUBKEY, endpoints });
  });

  it("fails naming the file when the public key is missing or the file is not there", () => {
    const path = join(dir, "tauri.conf.json");
    writeFileSync(path, JSON.stringify({ version: "0.6.1", plugins: {} }));
    expect(() => readConfig(path)).toThrow(/plugins\.updater\.pubkey/);
    expect(() => readConfig(join(dir, "missing.json"))).toThrow(/Could not read/);
  });
});

describe("checkDownloadPolicy", () => {
  const endpoints = [`https://github.com/${REPO}/releases/latest/download/latest.json`];
  const api = (id) => `https://api.github.com/repos/${REPO}/releases/assets/${id}`;
  const manifest = (urls) => ({ platforms: Object.fromEntries(urls.map((url, i) => [`darwin-${i}`, { url, signature: "s" }])) });

  it("passes when the endpoint and every download are inside the releases repository", () => {
    expect(() => checkDownloadPolicy({ endpoints, manifest: manifest([api(1), `https://github.com/${REPO}/releases/download/v1/x`]), repo: REPO })).not.toThrow();
  });

  it("compares case-insensitively, as GitHub does", () => {
    const shouting = [`https://github.com/${REPO.toUpperCase()}/releases/latest/download/latest.json`];
    expect(() => checkDownloadPolicy({ endpoints: shouting, manifest: manifest([api(1)]), repo: REPO })).not.toThrow();
  });

  it("refuses an endpoint outside the repository, and none at all", () => {
    expect(() => checkDownloadPolicy({ endpoints: ["https://github.com/other/repo/releases/latest/download/latest.json"], manifest: manifest([api(1)]), repo: REPO })).toThrow(/plugins\.updater\.endpoints/);
    expect(() => checkDownloadPolicy({ endpoints: [], manifest: manifest([api(1)]), repo: REPO })).toThrow(/plugins\.updater\.endpoints/);
  });

  it("refuses a download outside the repository, a lookalike host and an empty manifest", () => {
    const bad = ["https://evil.example/x", `https://github.com.evil.example/${REPO}/x`, `http://api.github.com/repos/${REPO}/releases/assets/1`, "https://api.github.com/repos/other/repo/releases/assets/1", undefined];
    for (const url of bad) {
      expect(() => checkDownloadPolicy({ endpoints, manifest: manifest([api(1), url]), repo: REPO }), String(url)).toThrow(/download URL in latest\.json/);
    }
    expect(() => checkDownloadPolicy({ endpoints, manifest: { platforms: {} }, repo: REPO })).toThrow(/download URL in latest\.json/);
  });
});
