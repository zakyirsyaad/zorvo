import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkKey,
  checkManifest,
  keyIdText,
  main,
  parsePublicKey,
  parseSignature,
  signedVersion,
  verifiesSignature,
} from "./check-updater-signing.mjs";

// Keys and signatures are made here the way `pnpm tauri generate/sign` makes them (minisign: Ed25519 over the
// BLAKE2b-512 hash of the file, then a second signature over the first and the trusted comment), so the tests need
// neither the Tauri CLI nor a real key.

/** A key pair with a minisign key id. */
function makeKey(keyId = randomBytes(8)) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { keyId, privateKey, raw: publicKey.export({ type: "spki", format: "der" }).subarray(-32) };
}

/** `plugins.updater.pubkey`: base64 of a minisign public key file. */
function pubkeyOf(key) {
  const line = Buffer.concat([Buffer.from("Ed"), key.keyId, key.raw]).toString("base64");
  return Buffer.from(`untrusted comment: minisign public key: ${keyIdText(key.keyId)}\n${line}\n`).toString("base64");
}

/** What `pnpm tauri signer sign` writes to the `.sig` file, and what latest.json holds: base64 of the four lines. */
function signatureOf(key, data, trustedComment) {
  const signature = sign(null, createHash("blake2b512").update(data).digest(), key.privateKey);
  const global = sign(null, Buffer.concat([signature, Buffer.from(trustedComment)]), key.privateKey);
  const text = [
    "untrusted comment: signature from tauri secret key",
    Buffer.concat([Buffer.from("ED"), key.keyId, signature]).toString("base64"),
    `trusted comment: ${trustedComment}`,
    global.toString("base64"),
    "",
  ].join("\n");
  return Buffer.from(text).toString("base64");
}

const commentFor = (version) => `timestamp:1793016198\tfile:Zorvo.app.tar.gz${version ? `\tversion:${version}` : ""}`;
const PACKAGE = Buffer.from("the update package");
const PROBE = Buffer.from("x");

// The id as minisign prints it is the 8 bytes reversed.
const KEY = makeKey(Buffer.from("0ae1e45192fcd698", "hex"));
const OTHER_KEY = makeKey(Buffer.from("a2601d620da226d5", "hex"));

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zorvo-updater-test-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function write(name, content) {
  const path = join(dir, name);
  writeFileSync(path, typeof content === "string" || Buffer.isBuffer(content) ? content : JSON.stringify(content));
  return path;
}

const configWith = (pubkey, version = "0.6.0") => write("tauri.conf.json", { version, plugins: { updater: { pubkey } } });

describe("minisign parsing and verification", () => {
  it("reads the key id the way minisign prints it", () => {
    expect(keyIdText(parsePublicKey(pubkeyOf(KEY)).keyId)).toBe("98D6FC9251E4E10A");
    expect(keyIdText(parseSignature(signatureOf(KEY, PACKAGE, commentFor("0.6.0"))).keyId)).toBe("98D6FC9251E4E10A");
  });

  it("verifies the update package and rejects other bytes", () => {
    const signature = parseSignature(signatureOf(KEY, PACKAGE, commentFor("0.6.0")));
    expect(verifiesSignature(parsePublicKey(pubkeyOf(KEY)), signature, PACKAGE)).toBe(true);
    expect(verifiesSignature(parsePublicKey(pubkeyOf(KEY)), signature, Buffer.from("other"))).toBe(false);
  });

  it("rejects a trusted comment that was edited after signing", () => {
    const signature = parseSignature(signatureOf(KEY, PACKAGE, commentFor("0.5.9")));
    const edited = { ...signature, trustedComment: signature.trustedComment.replace("version:0.5.9", "version:0.6.0") };
    expect(verifiesSignature(parsePublicKey(pubkeyOf(KEY)), signature, PACKAGE)).toBe(true);
    expect(verifiesSignature(parsePublicKey(pubkeyOf(KEY)), edited, PACKAGE)).toBe(false);
  });

  it("rejects a signature of another key", () => {
    const signature = parseSignature(signatureOf(OTHER_KEY, PACKAGE, commentFor("0.6.0")));
    expect(verifiesSignature(parsePublicKey(pubkeyOf(KEY)), signature, PACKAGE)).toBe(false);
  });

  it("reads the signed version like the updater plugin", () => {
    expect(signedVersion(parseSignature(signatureOf(KEY, PACKAGE, commentFor("0.6.0"))).trustedComment)).toBe("0.6.0");
    expect(signedVersion(parseSignature(signatureOf(KEY, PACKAGE, commentFor(""))).trustedComment)).toBeNull();
    expect(signedVersion("timestamp:1\tfile:a\tversion:1.2.3")).toBe("1.2.3");
    // Only a whole field counts, not text that happens to contain "version:".
    expect(signedVersion("timestamp:1\tfile:app-version:2.zip")).toBeNull();
  });

  it("refuses text that is not a minisign key or signature", () => {
    expect(() => parsePublicKey("REPLACE_WITH_UPDATER_PUBLIC_KEY")).toThrow(/not base64/);
    expect(() => parsePublicKey(Buffer.from("hello\nworld").toString("base64"))).toThrow(/not a minisign public key/);
    expect(() => parseSignature(Buffer.from("a\nb\nc\nd").toString("base64"))).toThrow(/not a minisign signature/);
  });
});

describe("key", () => {
  const env = { TAURI_SIGNING_PRIVATE_KEY: "set" };
  // The command signs a one-byte probe with `pnpm tauri signer sign`; here the signer is replaced.
  const signingWith = (key, comment) => () => signatureOf(key, PROBE, comment);

  it("passes for the pubkey's own key", () => {
    const config = configWith(pubkeyOf(KEY));
    expect(checkKey(config, env, signingWith(KEY, commentFor("0.6.0")))).toMatch(
      /Updater key OK: key 98D6FC9251E4E10A.*records version 0\.6\.0/,
    );
  });

  it("asks the signer to bind the signature to the version in the config", () => {
    const config = configWith(pubkeyOf(KEY), "0.7.1");
    const sign = vi.fn(signingWith(KEY, commentFor("0.7.1")));
    checkKey(config, env, sign);
    expect(sign).toHaveBeenCalledWith("0.7.1", env);
  });

  it("fails for another key, naming both ids", () => {
    const config = configWith(pubkeyOf(KEY));
    expect(() => checkKey(config, env, signingWith(OTHER_KEY, commentFor("0.6.0")))).toThrow(
      /key D526A20D621D60A2, but plugins\.updater\.pubkey is key 98D6FC9251E4E10A/,
    );
  });

  it("fails when the signature does not record the app version", () => {
    const config = configWith(pubkeyOf(KEY));
    expect(() => checkKey(config, env, signingWith(KEY, commentFor("")))).toThrow(/without recording the app version/);
  });

  it("fails when the public key in the config is damaged", () => {
    // Same key id, different key bytes: the id matches but the signature does not verify.
    const damaged = { ...KEY, raw: OTHER_KEY.raw };
    const config = configWith(pubkeyOf(damaged));
    expect(() => checkKey(config, env, signingWith(KEY, commentFor("0.6.0")))).toThrow(/does not verify under it/);
  });

  it("fails without the private key", () => {
    const config = configWith(pubkeyOf(KEY));
    expect(() => checkKey(config, {}, signingWith(KEY, commentFor("0.6.0")))).toThrow(/TAURI_SIGNING_PRIVATE_KEY is not set/);
  });

  it("fails for a config without a public key or with the placeholder", () => {
    expect(() => checkKey(write("none.json", { plugins: { updater: {} } }), env, signingWith(KEY, commentFor("0.6.0")))).toThrow(
      /has no plugins\.updater\.pubkey/,
    );
    expect(() => checkKey(configWith("REPLACE_WITH_UPDATER_PUBLIC_KEY"), env, signingWith(KEY, commentFor("0.6.0")))).toThrow(
      /not base64/,
    );
  });
});

describe("manifest", () => {
  const PLATFORMS = ["darwin-aarch64", "darwin-x86_64", "darwin-aarch64-app", "darwin-x86_64-app"];

  /** A latest.json for `version`, every platform signed by `key` for `signedFor` unless `overrides` says otherwise. */
  function manifest({ version = "0.6.0", key = KEY, signedFor = "0.6.0", overrides = {}, omit = [] } = {}) {
    const platforms = {};
    for (const name of PLATFORMS) {
      if (omit.includes(name)) continue;
      const entryKey = overrides[name]?.key ?? key;
      const entryVersion = overrides[name]?.signedFor ?? signedFor;
      platforms[name] = {
        url: `https://api.github.com/repos/zakyirsyaad/zorvo/releases/assets/${name.length}`,
        signature: signatureOf(entryKey, PACKAGE, commentFor(entryVersion)),
      };
    }
    return write("latest.json", { version, platforms });
  }

  const config = () => configWith(pubkeyOf(KEY));
  const packagePath = () => write("Zorvo.app.tar.gz", PACKAGE);

  it("passes for a release signed by the pubkey's key for that version", () => {
    expect(checkManifest(config(), manifest(), "v0.6.0", packagePath())).toMatch(
      /latest\.json OK: 4 platform entries are signed by key 98D6FC9251E4E10A for version 0\.6\.0, and the Mac ones verify the update package/,
    );
  });

  it("passes without the package, checking the signatures' keys and versions only", () => {
    expect(checkManifest(config(), manifest(), "v0.6.0")).toMatch(/latest\.json OK/);
  });

  it("fails when a signature records no version", () => {
    expect(() => checkManifest(config(), manifest({ signedFor: "" }), "v0.6.0")).toThrow(/does not record the version/);
  });

  it("fails when a signature was made for another version, in any entry", () => {
    expect(() => checkManifest(config(), manifest({ signedFor: "0.5.9" }), "v0.6.0")).toThrow(
      /made for version 0\.5\.9, but this release is 0\.6\.0/,
    );
    // The updater tries `darwin-aarch64-app` first, so a stale one is as bad as a stale main entry.
    const stale = manifest({ overrides: { "darwin-aarch64-app": { signedFor: "0.5.9" } } });
    expect(() => checkManifest(config(), stale, "v0.6.0")).toThrow(/darwin-aarch64-app signature.*0\.5\.9/);
  });

  it("fails for another key", () => {
    expect(() => checkManifest(config(), manifest({ key: OTHER_KEY }), "v0.6.0")).toThrow(/D526A20D621D60A2/);
  });

  it("fails when a Mac is missing", () => {
    expect(() => checkManifest(config(), manifest({ omit: ["darwin-x86_64"] }), "v0.6.0")).toThrow(
      /no signed darwin-x86_64 entry/,
    );
  });

  it("fails when latest.json names another version than the tag", () => {
    expect(() => checkManifest(config(), manifest({ version: "0.6.1" }), "v0.6.0")).toThrow(/names version 0\.6\.1, not 0\.6\.0/);
  });

  it("fails when the package is not what was signed", () => {
    const other = write("other.tar.gz", "something else");
    expect(() => checkManifest(config(), manifest(), "v0.6.0", other)).toThrow(/does not verify the update package/);
  });
});

describe("main", () => {
  let error;
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("exits 0 when a check passes, 1 when it fails and 2 for wrong usage", () => {
    const config = configWith(pubkeyOf(KEY));
    const latest = write("latest.json", {
      version: "0.6.0",
      platforms: Object.fromEntries(
        ["darwin-aarch64", "darwin-x86_64"].map((name) => [name, { url: "https://x", signature: signatureOf(KEY, PACKAGE, commentFor("0.6.0")) }]),
      ),
    });
    expect(main(["manifest", config, latest, "v0.6.0", write("p.tar.gz", PACKAGE)], {})).toBe(0);
    expect(main(["manifest", config, latest, "v0.7.0"], {})).toBe(1);
    expect(main(["manifest"], {})).toBe(2);
    expect(main([], {})).toBe(2);
  });

  it("prints a plain error, or a workflow annotation on GitHub Actions", () => {
    const config = configWith(pubkeyOf(KEY));
    const missing = join(dir, "missing.json");
    main(["manifest", config, missing, "v0.6.0"], {});
    expect(error.mock.calls.at(-1)[0]).toMatch(/^error: Could not read /);
    main(["manifest", config, missing, "v0.6.0"], { GITHUB_ACTIONS: "true" });
    expect(error.mock.calls.at(-1)[0]).toMatch(/^::error::Could not read /);
  });
});

describe("running the script", () => {
  const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "check-updater-signing.mjs");

  it("runs, and fails for wrong usage, when started by its real path", () => {
    const run = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("Usage:");
  });

  it("does the same when started through a symlink, instead of passing without a word", () => {
    const link = join(dir, "check-updater-signing.mjs");
    symlinkSync(SCRIPT, link);
    const run = spawnSync(process.execPath, [link], { encoding: "utf8" });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("Usage:");
  });
});
