import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkManifest, keyIdText } from "./check-updater-signing.mjs";
import { PLATFORM_ENTRIES, buildManifest, main } from "./updater-manifest.mjs";

// A key and a signature made the way `tauri signer sign --app-version` makes them, so the manifest this script
// writes can be put through the same check the Release workflow runs on it.

const PACKAGE = Buffer.from("the update package");
const URL = "https://api.github.com/repos/zakyirsyaad/zorvo/releases/assets/678935071";

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
  const signature = sign(null, createHash("blake2b512").update(data).digest(), key.privateKey);
  const global = sign(null, Buffer.concat([signature, Buffer.from(comment)]), key.privateKey);
  const text = [
    "untrusted comment: signature from tauri secret key",
    Buffer.concat([Buffer.from("ED"), key.keyId, signature]).toString("base64"),
    `trusted comment: ${comment}`,
    global.toString("base64"),
    "",
  ].join("\n");
  return Buffer.from(text).toString("base64");
}

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zorvo-manifest-test-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function write(name, content) {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

const NOW = new Date("2026-10-27T01:02:03.456Z");

describe("buildManifest", () => {
  const signature = "c2lnbmF0dXJl";

  it("names the version without the tag's v, with the notes and the time", () => {
    const manifest = buildManifest({ tag: "v0.6.1", notes: "### Fixed\n\n- A thing.", url: URL, signature, now: NOW });
    expect(manifest.version).toBe("0.6.1");
    expect(manifest.notes).toBe("### Fixed\n\n- A thing.");
    expect(manifest.pub_date).toBe("2026-10-27T01:02:03.456Z");
  });

  it("keeps the pre-release part of the version", () => {
    expect(buildManifest({ tag: "v0.7.0-rc.1", notes: "", url: URL, signature, now: NOW }).version).toBe("0.7.0-rc.1");
  });

  it("offers one update package to both Macs under every name the updater looks up", () => {
    const { platforms } = buildManifest({ tag: "v0.6.1", notes: "", url: URL, signature, now: NOW });
    expect(Object.keys(platforms)).toEqual([
      "darwin-aarch64",
      "darwin-x86_64",
      "darwin-universal",
      "darwin-aarch64-app",
      "darwin-x86_64-app",
      "darwin-universal-app",
    ]);
    expect(Object.keys(platforms)).toEqual(PLATFORM_ENTRIES);
    for (const entry of Object.values(platforms)) expect(entry).toEqual({ signature, url: URL });
  });

  it("trims the signature and the notes, which a file ends with a newline", () => {
    const manifest = buildManifest({ tag: "v0.6.1", notes: "Notes\n\n", url: URL, signature: `${signature}\n`, now: NOW });
    expect(manifest.notes).toBe("Notes");
    expect(manifest.platforms["darwin-aarch64"].signature).toBe(signature);
  });

  it.each(["0.6.1", "v0.6", "v0.6.1+build", "v1.2.3-", "vx.y.z", ""])("refuses the tag %j", (tag) => {
    expect(() => buildManifest({ tag, notes: "", url: URL, signature, now: NOW })).toThrow(/tag/i);
  });

  it.each(["http://github.com/a/b", "ftp://github.com/a", "github.com/a/b", ""])("refuses the download URL %j", (url) => {
    expect(() => buildManifest({ tag: "v0.6.1", notes: "", url, signature, now: NOW })).toThrow(/https/);
  });

  it.each(["", "not base64!", "two\nlines"])("refuses the signature %j", (bad) => {
    expect(() => buildManifest({ tag: "v0.6.1", notes: "", url: URL, signature: bad, now: NOW })).toThrow(/signature/i);
  });
});

describe("a manifest for a real signature", () => {
  it("passes the check the Release workflow runs on latest.json", () => {
    const key = makeKey();
    const config = write("tauri.conf.json", JSON.stringify({ version: "0.6.1", plugins: { updater: { pubkey: pubkeyOf(key) } } }));
    const manifest = buildManifest({ tag: "v0.6.1", notes: "n", url: URL, signature: signatureOf(key, PACKAGE, "0.6.1"), now: NOW });
    const latest = write("latest.json", JSON.stringify(manifest));
    const pkg = write("Zorvo_0.6.1_universal.app.tar.gz", PACKAGE);
    expect(checkManifest(config, latest, "v0.6.1", pkg)).toMatch(/latest\.json OK: 6 platform entries/);
  });

  it("is refused by that check when the signature was made for another version", () => {
    const key = makeKey();
    const config = write("tauri.conf.json", JSON.stringify({ version: "0.6.1", plugins: { updater: { pubkey: pubkeyOf(key) } } }));
    const manifest = buildManifest({ tag: "v0.6.1", notes: "n", url: URL, signature: signatureOf(key, PACKAGE, "0.6.0"), now: NOW });
    const latest = write("latest.json", JSON.stringify(manifest));
    expect(() => checkManifest(config, latest, "v0.6.1")).toThrow(/made for version 0\.6\.0/);
  });
});

describe("main", () => {
  let errors;
  beforeEach(() => {
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("writes latest.json from the tag, the notes file, the package URL and the .sig file", () => {
    const notes = write("notes.md", "Release notes\n");
    const sig = write("Zorvo.app.tar.gz.sig", "c2lnbmF0dXJl");
    const out = join(dir, "latest.json");
    expect(main(["v0.6.1", notes, URL, sig, out])).toBe(0);
    const written = JSON.parse(readFileSync(out, "utf8"));
    expect(written.version).toBe("0.6.1");
    expect(written.notes).toBe("Release notes");
    expect(written.platforms["darwin-x86_64-app"]).toEqual({ signature: "c2lnbmF0dXJl", url: URL });
    expect(readFileSync(out, "utf8").endsWith("\n")).toBe(true);
  });

  it("exits 2 and writes nothing when the arguments are wrong", () => {
    const out = join(dir, "latest.json");
    expect(main(["v0.6.1", out])).toBe(2);
    expect(errors).toHaveBeenCalledWith(expect.stringMatching(/^Usage:/));
    expect(() => readFileSync(out)).toThrow();
  });

  it("exits 1 for a bad tag and for a file it cannot read, and writes nothing", () => {
    const notes = write("notes.md", "n");
    const sig = write("a.sig", "c2lnbmF0dXJl");
    const out = join(dir, "latest.json");
    expect(main(["0.6.1", notes, URL, sig, out])).toBe(1);
    expect(main(["v0.6.1", join(dir, "missing.md"), URL, sig, out])).toBe(1);
    expect(() => readFileSync(out)).toThrow();
  });

  it("reports a failure as a GitHub error annotation when it runs in Actions", () => {
    const out = join(dir, "latest.json");
    main(["nope", write("n.md", ""), URL, write("a.sig", "c2ln"), out], { GITHUB_ACTIONS: "true" });
    expect(errors.mock.calls[0][0]).toMatch(/^::error::/);
  });
});
