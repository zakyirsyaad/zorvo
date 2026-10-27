import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, sign as ed25519Sign } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keyIdText } from "./check-updater-signing.mjs";
import { ReleaseError, assetNames } from "./release-checks.mjs";
import { RELEASES_REPO, SOURCE_REPO } from "./release-github.mjs";
import { explainSignFailure, main, promptHidden, signRelease, signWithTauri } from "./sign-release.mjs";

// The release is signed and published from the machine that holds the updater key. Here everything around it is
// replaced: `gh` and the Tauri CLI are fakes, git answers from a table, and the build is a real tarball made by
// `tar`. The signature is made the way `tauri signer sign --app-version` makes it, so the manifest this script
// writes goes through the same check as a real one.

const TAG = "v0.6.1";
const VERSION = "0.6.1";
const NAMES = assetNames(VERSION);
const HEAD = "1f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c";
const KEY_SENTINEL = "THE-PRIVATE-KEY-MUST-NEVER-BE-READ-OR-PRINTED";
const DMG_BYTES = "dmg bytes";
const DOC_PATHS = ["docs/releases-repo/README.md", "docs/releases-repo/assets/icon.png"];

function makeKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { keyId: randomBytes(8), privateKey, raw: publicKey.export({ type: "spki", format: "der" }).subarray(-32) };
}

function pubkeyOf(key) {
  const line = Buffer.concat([Buffer.from("Ed"), key.keyId, key.raw]).toString("base64");
  return Buffer.from(`untrusted comment: minisign public key: ${keyIdText(key.keyId)}\n${line}\n`).toString("base64");
}

function signatureOf(key, data, version) {
  const comment = `timestamp:1793016198\tfile:Zorvo.app.tar.gz\tversion:${version}`;
  const signature = ed25519Sign(null, createHash("blake2b512").update(data).digest(), key.privateKey);
  const global = ed25519Sign(null, Buffer.concat([signature, Buffer.from(comment)]), key.privateKey);
  const text = ["untrusted comment: signature from tauri secret key", Buffer.concat([Buffer.from("ED"), key.keyId, signature]).toString("base64"), `trusted comment: ${comment}`, global.toString("base64"), ""].join("\n");
  return Buffer.from(text).toString("base64");
}

let dir;
let key;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zorvo-sign-release-"));
  key = makeKey();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const CHANGELOG = `# Changelog

## [Unreleased]

## [0.6.1] - 2026-10-27

### Fixed

- A thing.

[Unreleased]: https://github.com/zakyirsyaad/zorvo/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/zakyirsyaad/zorvo/compare/v0.6.0...v0.6.1
`;

/** A checkout of the repository: the config, the changelog, the user guide, and a key file with a sentinel in it. */
function makeRoot({ version = VERSION, changelog = CHANGELOG } = {}) {
  const root = join(dir, "repo");
  mkdirSync(join(root, "src-tauri"), { recursive: true });
  mkdirSync(join(root, "docs/releases-repo/assets"), { recursive: true });
  const endpoints = [`https://github.com/${RELEASES_REPO}/releases/latest/download/latest.json`];
  writeFileSync(join(root, "src-tauri/tauri.conf.json"), JSON.stringify({ version, plugins: { updater: { pubkey: pubkeyOf(key), endpoints } } }));
  writeFileSync(join(root, "CHANGELOG.md"), changelog);
  writeFileSync(join(root, "docs/releases-repo/README.md"), "# Zorvo\n");
  writeFileSync(join(root, "docs/releases-repo/assets/icon.png"), Buffer.from([1, 2, 3]));
  // A stray file that git does not track: it must never reach the public repository.
  writeFileSync(join(root, "docs/releases-repo/.DS_Store"), "stray");
  writeFileSync(join(dir, "zorvo-updater.key"), KEY_SENTINEL);
  chmodSync(join(dir, "zorvo-updater.key"), 0o600);
  return root;
}

/** The files the Release workflow's artifact holds. */
function makeBuild({ version = VERSION, extra = [] } = {}) {
  const names = assetNames(version);
  const build = join(dir, "artifact");
  const app = join(dir, "artifact-app");
  mkdirSync(join(app, "Zorvo.app/Contents/MacOS"), { recursive: true });
  writeFileSync(join(app, "Zorvo.app/Contents/Info.plist"), "<plist/>");
  writeFileSync(join(app, "Zorvo.app/Contents/MacOS/zorvo"), `xx${pubkeyOf(key)}xx`);
  mkdirSync(build, { recursive: true });
  spawnSync("tar", ["-czf", join(build, names.package), "-C", app, "Zorvo.app"], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  writeFileSync(join(build, names.dmg), DMG_BYTES);
  for (const name of extra) writeFileSync(join(build, name), "x");
  return build;
}

/** A fake `gh` for a release that goes right. It keeps what was uploaded, since the files are gone afterwards. */
function makeGh({ build, runSha = HEAD, tagSha = HEAD, state = "none" }) {
  const calls = [];
  const uploads = new Map();
  const puts = [];
  let notes = null;
  const gh = (args, { input } = {}) => {
    const line = args.join(" ");
    calls.push(line);
    const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
    if (line.startsWith("run list")) return ok(JSON.stringify([{ databaseId: 42, headSha: runSha, event: "push", createdAt: "2026-10-27T02:00:00Z" }]));
    if (line.includes("/commits/refs/tags/")) return ok(`${tagSha}\n`);
    if (line.startsWith("run download")) {
      const target = args[args.indexOf("--dir") + 1];
      mkdirSync(target, { recursive: true });
      for (const name of readdirSync(build)) copyFileSync(join(build, name), join(target, name));
      return ok();
    }
    if (line.includes("--jq .isDraft")) return state === "none" ? { status: 1, stdout: "", stderr: "release not found" } : ok(state === "draft" ? "true" : "false");
    if (line.startsWith("release create") || line.startsWith("release edit")) {
      notes = readFileSync(args[args.indexOf("--notes-file") + 1], "utf8");
      return ok();
    }
    if (line.startsWith("release upload")) {
      for (const file of args.filter((arg) => arg.startsWith("/") && existsSync(arg))) uploads.set(basename(file), readFileSync(file));
      return ok();
    }
    if (line.includes("--json assets")) {
      const assets = [...uploads.keys()].map((name, index) => ({ name, apiUrl: `https://api.github.com/repos/${RELEASES_REPO}/releases/assets/${index + 1}` }));
      return ok(JSON.stringify({ assets }));
    }
    if (line.includes("--jq .sha")) return { status: 1, stdout: "", stderr: "HTTP 404" };
    if (line.includes("--method PUT")) {
      puts.push({ line, body: JSON.parse(input) });
      return ok();
    }
    return ok();
  };
  return { gh, calls, uploads, puts, notes: () => notes };
}

function makeDeps({ build = makeBuild(), head = HEAD, runSha, tagSha, state, dirty = false, password = "right", answer = true, previousTag = "v0.6.0", signingKey = key, log, headChange } = {}) {
  const fake = makeGh({ build, runSha: runSha ?? head, tagSha: tagSha ?? head, state });
  const logs = [];
  const signed = [];
  const asked = [];
  const confirmed = [];
  const gitCalls = [];
  let headReads = 0;
  const deps = {
    gh: fake.gh,
    git: (args) => {
      gitCalls.push(args);
      if (args[0] === "rev-parse") {
        headReads += 1;
        // Read 1 is the checkout's. Read 2 is just before the signing, and read 3 just before the upload.
        return `${headChange && headReads >= headChange.from ? headChange.to : head}\n`;
      }
      if (args[0] === "status") return dirty ? " M scripts/x.mjs\n" : "";
      if (args[0] === "ls-files") return `${DOC_PATHS.join("\0")}\0`;
      if (args[0] === "describe") {
        if (!previousTag) throw new ReleaseError("git describe failed: No names found");
        return `${previousTag}\n`;
      }
      if (args[0] === "rev-list") return "7\n";
      if (args[0] === "diff") return " pnpm-lock.yaml | 4 ++--\n 1 file changed\n";
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    },
    sign: async ({ keyPath, version, packagePath, password: given }) => {
      signed.push({ keyPath, version, password: given });
      if (given !== "right") throw new ReleaseError("The password is wrong for this updater key.");
      writeFileSync(`${packagePath}.sig`, signatureOf(signingKey, readFileSync(packagePath), version));
    },
    askPassword: async () => {
      asked.push(true);
      return password;
    },
    confirm: async (question) => {
      confirmed.push(question);
      return answer;
    },
    log: log ?? ((message) => logs.push(message)),
  };
  return { deps, fake, logs, signed, asked, confirmed, gitCalls };
}

const run = (options = {}, ctx = makeDeps(options.deps)) => signRelease({ tag: TAG, keyPath: join(dir, "zorvo-updater.key"), root: makeRoot(options.root), deps: ctx.deps, ...options.args }).then(() => ctx);

describe("a release that goes right", () => {
  it("proves the checkout is the build, downloads it from the run, signs it, and fills the draft release", async () => {
    const ctx = await run();
    const lines = ctx.fake.calls;
    expect(lines[0]).toBe(`api repos/${SOURCE_REPO}/commits/refs/tags/v0.6.1 --jq .sha`);
    expect(lines[1]).toBe(`run list --repo ${SOURCE_REPO} --workflow release.yml --branch v0.6.1 --status success --limit 10 --json databaseId,headSha,event,createdAt`);
    expect(lines[2]).toMatch(new RegExp(`^run download 42 --repo ${SOURCE_REPO} --name release-build --dir `));
    expect(lines.some((line) => line.startsWith(`release create v0.6.1 --repo ${RELEASES_REPO} --draft --target main --title Zorvo v0.6.1`))).toBe(true);
    expect(ctx.signed).toEqual([{ keyPath: join(dir, "zorvo-updater.key"), version: VERSION, password: "right" }]);
    expect(lines.some((line) => line.includes("--prerelease"))).toBe(false);
  });

  it("looks at the checkout without counting files git does not track", async () => {
    const ctx = await run();
    expect(ctx.gitCalls).toContainEqual(["status", "--porcelain", "--untracked-files=no"]);
  });

  it("uploads the DMG twice, the package with its signature, and the checksums, and latest.json after them", async () => {
    const ctx = await run();
    expect([...ctx.fake.uploads.keys()].sort()).toEqual(["SHA256SUMS.txt", "Zorvo-mac.dmg", NAMES.dmg, NAMES.package, `${NAMES.package}.sig`, "latest.json"].sort());
    expect(ctx.fake.calls.findIndex((line) => line.includes("latest.json"))).toBeGreaterThan(ctx.fake.calls.findIndex((line) => line.includes(`${NAMES.package}.sig`)));
  });

  it("writes SHA256SUMS.txt for the two DMGs, which anyone can check with shasum", async () => {
    const ctx = await run();
    const sum = createHash("sha256").update(DMG_BYTES).digest("hex");
    expect(ctx.fake.uploads.get("SHA256SUMS.txt").toString()).toBe(`${sum}  Zorvo-mac.dmg\n${sum}  ${NAMES.dmg}\n`);
  });

  it("names the uploaded package in latest.json by its asset URL, for both Macs", async () => {
    const ctx = await run();
    const manifest = JSON.parse(ctx.fake.uploads.get("latest.json"));
    expect(manifest.version).toBe(VERSION);
    expect(Object.keys(manifest.platforms)).toHaveLength(6);
    const url = manifest.platforms["darwin-aarch64"].url;
    expect(url).toMatch(new RegExp(`^https://api\\.github\\.com/repos/${RELEASES_REPO}/releases/assets/\\d+$`));
    expect(manifest.platforms["darwin-x86_64-app"].url).toBe(url);
    expect(ctx.logs.filter((message) => /latest\.json OK: 6 platform entries/.test(message))).toHaveLength(2);
  });

  it("writes the notes from the changelog and the download line", async () => {
    const ctx = await run();
    expect(ctx.fake.notes()).toContain("### Fixed");
    expect(ctx.fake.notes()).toContain("- A thing.");
    expect(ctx.fake.notes()).toContain(`https://github.com/${RELEASES_REPO}#install`);
    expect(ctx.fake.notes()).not.toContain("Unreleased");
  });

  it("copies the user guide as git tracks it, and the public changelog, and no stray file", async () => {
    const ctx = await run();
    expect(ctx.fake.puts.map((put) => put.line.match(/contents\/(\S+)/)[1])).toEqual(["CHANGELOG.md", "README.md", "assets/icon.png"]);
    const changelog = Buffer.from(ctx.fake.puts[0].body.content, "base64").toString();
    expect(changelog).toContain("## 0.6.1 - 2026-10-27");
    expect(changelog).not.toContain("Unreleased");
    expect(ctx.fake.puts[2].body.content).toBe(Buffer.from([1, 2, 3]).toString("base64"));
  });

  it("makes the draft a pre-release for a tag with a pre-release part", async () => {
    const root = makeRoot({ version: "0.6.1-rc.1", changelog: CHANGELOG.replaceAll("0.6.1", "0.6.1-rc.1") });
    const ctx = makeDeps({ build: makeBuild({ version: "0.6.1-rc.1" }) });
    await signRelease({ tag: "v0.6.1-rc.1", keyPath: join(dir, "zorvo-updater.key"), root, deps: ctx.deps });
    expect(ctx.fake.calls.find((line) => line.startsWith("release create"))).toMatch(/--prerelease$/);
  });
});

describe("the look at what changed, which comes before the password", () => {
  it("lists what changed since the last release in what the release is made and trusted from, and asks to go on", async () => {
    const ctx = await run();
    expect(ctx.logs.join("\n")).toContain("Since v0.6.0: 7 commit(s).");
    expect(ctx.logs.join("\n")).toContain("pnpm-lock.yaml | 4 ++--");
    expect(ctx.gitCalls).toContainEqual(["diff", "--stat", "v0.6.0..HEAD", "--", "package.json", "pnpm-lock.yaml", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src-tauri/tauri.conf.json", ".github", "scripts"]);
    expect(ctx.confirmed).toEqual(["Sign and publish v0.6.1 from this build? [y/N] "]);
  });

  it("stops when the answer is no, before the password is asked for and before anything is signed or uploaded", async () => {
    const ctx = makeDeps({ answer: false });
    await expect(run({}, ctx)).rejects.toThrow(/Cancelled/);
    expect(ctx.asked).toHaveLength(0);
    expect(ctx.signed).toHaveLength(0);
    expect(ctx.fake.uploads.size).toBe(0);
  });

  it("says so when there is no earlier release to compare with", async () => {
    const ctx = await run({ deps: { previousTag: "" } });
    expect(ctx.logs.join("\n")).toMatch(/no earlier release tag in this checkout/);
  });
});

describe("a dry run", () => {
  it("downloads, checks, signs into a temporary folder and checks latest.json, but writes nothing to GitHub", async () => {
    const ctx = await run({ args: { dryRun: true } });
    expect(ctx.signed).toHaveLength(1);
    expect(ctx.fake.calls.map((line) => line.split(" ").slice(0, 2).join(" "))).toEqual(["api repos/zakyirsyaad/zorvo/commits/refs/tags/v0.6.1", "run list", "run download"]);
    expect(ctx.logs.join("\n")).toMatch(/Dry run.*nothing was uploaded/s);
    expect(ctx.logs.some((message) => /latest\.json OK/.test(message))).toBe(true);
  });

  it("does not ask to go on, since it signs nothing that leaves the machine", async () => {
    const ctx = await run({ args: { dryRun: true } });
    expect(ctx.confirmed).toHaveLength(0);
  });
});

describe("what it refuses", () => {
  const refuses = async (options, message) => {
    const ctx = makeDeps(options.deps);
    await expect(run(options, ctx)).rejects.toThrow(message);
    return ctx;
  };

  it("a tag that is not a version", async () => {
    await refuses({ args: { tag: "0.6.1" } }, /must be vMAJOR\.MINOR\.PATCH/);
  });

  it("a working tree with changes, since this script and the config it reads are what is trusted", async () => {
    const ctx = await refuses({ deps: { dirty: true } }, /working tree has changes/);
    expect(ctx.fake.calls).toEqual([]);
  });

  it("a config whose version is not the tag's, before it reaches GitHub", async () => {
    const ctx = await refuses({ root: { version: "0.6.0" } }, /says "0\.6\.0" but the tag is v0\.6\.1/);
    expect(ctx.fake.calls).toEqual([]);
  });

  it("a checkout that is not the commit the tag has on GitHub", async () => {
    const ctx = makeDeps();
    const other = "a".repeat(40);
    const git = ctx.deps.git;
    ctx.deps.git = (args) => (args[0] === "rev-parse" ? `${other}\n` : git(args));
    await expect(run({}, ctx)).rejects.toThrow(/HEAD is aaaaaaa but v0\.6\.1 is 1f2e3d4 on GitHub.*git fetch --tags && git switch --detach v0\.6\.1/s);
    expect(ctx.signed).toHaveLength(0);
  });

  it("a tag that moved after the newest successful run, which would sign a build of an older commit", async () => {
    const ctx = await refuses({ deps: { runSha: "b".repeat(40) } }, /newest successful run for v0\.6\.1 built bbbbbbb, not 1f2e3d4/);
    expect(ctx.signed).toHaveLength(0);
    expect(ctx.fake.calls.some((line) => line.startsWith("run download"))).toBe(false);
  });

  it("a key file that is not there, before it looks at anything", async () => {
    const ctx = makeDeps();
    await expect(signRelease({ tag: TAG, keyPath: join(dir, "missing.key"), root: makeRoot(), deps: ctx.deps })).rejects.toThrow(/No updater key at .*missing\.key/);
    expect(ctx.fake.calls).toEqual([]);
    expect(ctx.gitCalls).toEqual([]);
  });

  it("a build with a file it should not have, before it signs", async () => {
    const ctx = await refuses({ deps: { build: makeBuild({ extra: ["evil.sh"] }) } }, /must hold exactly/);
    expect(ctx.signed).toHaveLength(0);
  });

  it("a version with no changelog section, before it signs", async () => {
    const ctx = await refuses({ root: { changelog: "# Changelog\n\n## [Unreleased]\n" } }, /CHANGELOG\.md has no section for v0\.6\.1/);
    expect(ctx.signed).toHaveLength(0);
  });

  it("a published release, without touching it", async () => {
    const ctx = await refuses({ deps: { state: "published" } }, /already published/);
    expect(ctx.fake.uploads.size).toBe(0);
  });

  it("a wrong password, which leaves GitHub as it was", async () => {
    const ctx = await refuses({ deps: { password: "wrong" } }, /password is wrong/);
    expect(ctx.fake.calls.every((line) => line.startsWith("run ") || line.includes("/commits/refs/tags/"))).toBe(true);
  });

  it("a signature of a key that is not the public key's, before anything is uploaded", async () => {
    const ctx = await refuses({ deps: { signingKey: makeKey() } }, /plugins\.updater\.pubkey/);
    expect(ctx.fake.calls.some((line) => line.startsWith("release "))).toBe(false);
  });

  it("a checkout that changed while the password was typed, before it signs", async () => {
    const ctx = await refuses({ deps: { headChange: { from: 2, to: "c".repeat(40) } } }, /checkout changed while this ran/);
    expect(ctx.signed).toHaveLength(0);
  });

  it("a checkout that changed while it signed, before anything is uploaded", async () => {
    const ctx = await refuses({ deps: { headChange: { from: 3, to: "c".repeat(40) } } }, /checkout changed while this ran/);
    expect(ctx.signed).toHaveLength(1);
    expect(ctx.fake.uploads.size).toBe(0);
    expect(ctx.fake.calls.some((line) => line.startsWith("release "))).toBe(false);
  });
});

describe("the password and the key", () => {
  it("asks for the password, and only asks: it is never taken from the environment", async () => {
    const ctx = await run();
    expect(ctx.asked).toHaveLength(1);
  });

  it("only hands the key's path on: its contents are never read, printed or uploaded", async () => {
    const log = vi.fn();
    const ctx = await run({ deps: { log } });
    const everything = [...ctx.fake.calls, ...log.mock.calls.flat(), ...ctx.fake.puts.map((put) => put.line + JSON.stringify(put.body)), ...[...ctx.fake.uploads.values()].map(String)].join("\n");
    expect(everything).not.toContain(KEY_SENTINEL);
    expect(ctx.signed[0].keyPath).toBe(join(dir, "zorvo-updater.key"));
  });

  it("warns when other users can read the key file", async () => {
    const ctx = makeDeps();
    const root = makeRoot();
    chmodSync(join(dir, "zorvo-updater.key"), 0o644);
    await signRelease({ tag: TAG, keyPath: join(dir, "zorvo-updater.key"), root, deps: ctx.deps });
    expect(ctx.logs.join("\n")).toMatch(/other users can read .*zorvo-updater\.key.*chmod 600/);
  });
});

describe("signWithTauri", () => {
  /** A stand-in for the Tauri CLI's script: it writes what it was given next to the package, and exits as told. */
  function fakeCli(exit = 0, stderr = "") {
    const entry = join(dir, `cli-${exit}.js`);
    writeFileSync(entry, `require("node:fs").writeFileSync(process.argv.at(-1) + ".seen", JSON.stringify({ argv: process.argv.slice(2), env: process.env }));\nprocess.stderr.write(${JSON.stringify(stderr)});\nprocess.exit(${exit});\n`);
    const packagePath = join(dir, "pkg.tar.gz");
    writeFileSync(packagePath, "package");
    return { entry, packagePath };
  }

  it("runs the CLI's script with the version, the key's path and the package, and gives it the password and nothing else of this environment", () => {
    process.env.TAURI_SIGNING_PRIVATE_KEY_PATH = "/should/not/pass";
    process.env.SOME_PROJECT_SECRET = "nope";
    try {
      const { entry, packagePath } = fakeCli();
      signWithTauri({ entry, keyPath: "/k/zorvo.key", version: "0.6.1", packagePath, password: "pw" });
      const seen = JSON.parse(readFileSync(`${packagePath}.seen`, "utf8"));
      expect(seen.argv).toEqual(["signer", "sign", "--app-version", "0.6.1", "--private-key-path", "/k/zorvo.key", packagePath]);
      expect(seen.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD).toBe("pw");
      // macOS adds __CF_USER_TEXT_ENCODING to every process; nothing of this environment gets through besides these.
      const allowed = new Set(["HOME", "PATH", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "__CF_USER_TEXT_ENCODING"]);
      expect(Object.keys(seen.env).filter((name) => !allowed.has(name))).toEqual([]);
      expect(seen.env).not.toHaveProperty("SOME_PROJECT_SECRET");
      expect(seen.env).not.toHaveProperty("TAURI_SIGNING_PRIVATE_KEY_PATH");
    } finally {
      delete process.env.TAURI_SIGNING_PRIVATE_KEY_PATH;
      delete process.env.SOME_PROJECT_SECRET;
    }
  });

  it("fails with a reason that says what to fix when the CLI refuses", () => {
    const { entry, packagePath } = fakeCli(1, "        Error incorrect updater private key password: wrong password\n");
    expect(() => signWithTauri({ entry, keyPath: "/k", version: "0.6.1", packagePath, password: "pw" })).toThrow(/password is wrong/);
  });
});

describe("explainSignFailure", () => {
  it("says the password is wrong", () => {
    expect(explainSignFailure("        Error incorrect updater private key password: wrong password")).toMatch(/password is wrong/);
  });

  it("says the file is not a Tauri key, even when the CLI blames the password", () => {
    expect(explainSignFailure("Error incorrect updater private key password: Missing comment in secret key")).toMatch(/not a Tauri updater private key/);
    expect(explainSignFailure("Error failed to decode base64 secret key: Invalid symbol 32")).toMatch(/not a Tauri updater private key/);
  });

  it("recognizes the .pub file, which the CLI also blames on the password", () => {
    const message = explainSignFailure("       Error incorrect updater private key password: failed to fill whole buffer");
    expect(message).toMatch(/not a Tauri updater private key/);
    expect(message).toMatch(/\.pub/);
  });

  it("gives the CLI's own error line for anything else", () => {
    expect(explainSignFailure("noise\n       Error something odd happened\nmore")).toMatch(/Error something odd happened/);
  });
});

describe("promptHidden", () => {
  /** Terminal streams that record what is done to them, in order. */
  function terminal({ isTTY = true } = {}) {
    const events = [];
    const stdin = Object.assign(new EventEmitter(), {
      isTTY,
      setRawMode: (on) => events.push(`raw:${on}`),
      resume: () => events.push("resume"),
      pause: () => events.push("pause"),
      setEncoding: () => {},
    });
    const stdout = { write: (text) => events.push(`write:${JSON.stringify(text)}`) };
    return { stdin, stdout, events, type: (text) => stdin.emit("data", text) };
  }

  it("turns the echo off before it writes the question, and gives back what was typed, which it never shows", async () => {
    const t = terminal();
    const answer = promptHidden("Password> ", t);
    t.type("hunter2\r");
    expect(await answer).toBe("hunter2");
    expect(t.events.indexOf("raw:true")).toBeLessThan(t.events.indexOf('write:"Password> "'));
    expect(t.events.join("\n")).not.toContain("hunter2");
    expect(t.events.at(-1)).toBe('write:"\\n"');
    expect(t.events).toContain("raw:false");
  });

  it("takes a paste in one piece, and keys one by one", async () => {
    const pasted = terminal();
    const first = promptHidden("> ", pasted);
    pasted.type("pass word\n");
    expect(await first).toBe("pass word");
    const typed = terminal();
    const second = promptHidden("> ", typed);
    for (const char of "abc\r") typed.type(char);
    expect(await second).toBe("abc");
  });

  it("deletes with backspace and clears the line with Ctrl-U", async () => {
    const t = terminal();
    const answer = promptHidden("> ", t);
    t.type("abx\u007fc\r");
    expect(await answer).toBe("abc");
    const u = terminal();
    const cleared = promptHidden("> ", u);
    u.type("wrong\u0015right\r");
    expect(await cleared).toBe("right");
  });

  it("leaves arrow keys and other control keys out of the password", async () => {
    const t = terminal();
    const answer = promptHidden("> ", t);
    t.type("\u001b[Aab\u001bOBc\u0001\u0002\r");
    expect(await answer).toBe("abc");
  });

  it("cancels on Ctrl-C and on Ctrl-D with nothing typed, and puts the terminal back", async () => {
    const c = terminal();
    const first = promptHidden("> ", c);
    c.type("ab\u0003");
    await expect(first).rejects.toThrow(/Cancelled/);
    expect(c.events).toContain("raw:false");
    const d = terminal();
    const second = promptHidden("> ", d);
    d.type("\u0004");
    await expect(second).rejects.toThrow(/Cancelled/);
  });

  it("ends on Ctrl-D when something was typed", async () => {
    const t = terminal();
    const answer = promptHidden("> ", t);
    t.type("abc\u0004");
    expect(await answer).toBe("abc");
  });

  it("refuses to ask where there is no terminal, instead of showing the password or hanging", async () => {
    await expect(promptHidden("> ", terminal({ isTTY: false }))).rejects.toThrow(/no terminal/);
  });
});

describe("main", () => {
  it("exits 2 with the usage for wrong arguments, and touches nothing", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const path = process.env.PATH;
    expect(await main([])).toBe(2);
    expect(await main(["v1.2.3", "--bogus"])).toBe(2);
    expect(await main(["v1.2.3", "v1.2.4"])).toBe(2);
    expect(errors).toHaveBeenCalledWith(expect.stringMatching(/^Usage: node scripts\/sign-release\.mjs/));
    expect(process.env.PATH).toBe(path);
    errors.mockRestore();
  });
});
