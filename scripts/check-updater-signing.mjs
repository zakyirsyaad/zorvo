#!/usr/bin/env node
// Checks the updater signing setup before and after a release build.
//
//   node scripts/check-updater-signing.mjs key <tauri.conf.json>
//   node scripts/check-updater-signing.mjs manifest <tauri.conf.json> <latest.json> <tag> [<update.app.tar.gz>]
//
// `key` runs after `pnpm install` and before the build. It signs a one-byte probe with
// `pnpm tauri signer sign`, using TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD (the
// variables the build reads), and fails when the password is wrong or the signature was not made by the
// key in plugins.updater.pubkey. The Tauri CLI only warns about that mismatch, and reports a wrong
// password after the whole build.
//
// `manifest` runs after the build, on the latest.json that was uploaded. Every platform entry must carry
// a signature made by the pubkey's key that records the version being released, which is what a client
// with `requireSignedVersion` compares with the version latest.json announces. With the update package
// (the .app.tar.gz) it also checks the Mac signatures the way a client does.
//
// Exit codes: 0 passed, 1 a check failed, 2 wrong usage.

import { spawnSync } from "node:child_process";
import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const TRUSTED_PREFIX = "trusted comment: ";
/** DER prefix that turns a raw 32-byte Ed25519 public key into the SPKI form Node reads. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const PROBE_BYTES = Buffer.from("x");
const SIGN_TIMEOUT_MS = 120_000;
const FALLBACK_VERSION = "0.0.0";
/** The platform entries a universal macOS build must give latest.json. */
const MAC_TARGETS = ["darwin-aarch64", "darwin-x86_64"];

/** A check that failed; reported as a message, without a stack. */
class CheckError extends Error {}

function fail(message) {
  throw new CheckError(message);
}

/** Decodes strict base64 (minisign files never carry anything else), or fails naming `what`. */
function decodeBase64(text, what) {
  const value = String(text ?? "").trim();
  if (!BASE64.test(value)) fail(`${what} is not base64.`);
  return Buffer.from(value, "base64");
}

/** The lines of a base64-wrapped minisign file, which is how Tauri stores keys and signatures. */
function minisignLines(base64, what) {
  return decodeBase64(base64, what).toString("utf8").split(/\r?\n/);
}

/** A key id as minisign prints it ("untrusted comment: minisign public key 98D6FC9251E4E10A"). */
export function keyIdText(keyId) {
  return Buffer.from(keyId).reverse().toString("hex").toUpperCase();
}

/** `plugins.updater.pubkey`: base64 of a minisign public key file, whose second line holds "Ed", a key id and the key. */
export function parsePublicKey(base64) {
  const [comment, keyLine] = minisignLines(base64, "plugins.updater.pubkey");
  if (!comment?.startsWith("untrusted comment:") || !keyLine) {
    fail("plugins.updater.pubkey is not a minisign public key. Use the public key printed by 'pnpm tauri signer generate'.");
  }
  const bytes = decodeBase64(keyLine, "The key line of plugins.updater.pubkey");
  if (bytes.length !== 42 || !["Ed", "ED"].includes(bytes.subarray(0, 2).toString("latin1"))) {
    fail("plugins.updater.pubkey is not a minisign Ed25519 public key.");
  }
  return { keyId: bytes.subarray(2, 10), key: bytes.subarray(10, 42) };
}

/** A `.sig` file, or a latest.json `signature`: base64 of the four lines of a minisign signature. */
export function parseSignature(base64) {
  const [, signatureLine, trustedLine, globalLine] = minisignLines(base64, "The signature");
  if (!trustedLine?.startsWith(TRUSTED_PREFIX) || !signatureLine || !globalLine) {
    fail("The signature is not a minisign signature.");
  }
  const bytes = decodeBase64(signatureLine, "The signature line");
  const globalSignature = decodeBase64(globalLine, "The global signature line");
  const algorithm = bytes.subarray(0, 2).toString("latin1");
  if (bytes.length !== 74 || globalSignature.length !== 64 || !["Ed", "ED"].includes(algorithm)) {
    fail("The signature is not a minisign Ed25519 signature.");
  }
  return {
    prehashed: algorithm === "ED",
    keyId: bytes.subarray(2, 10),
    signature: bytes.subarray(10, 74),
    trustedComment: trustedLine.slice(TRUSTED_PREFIX.length),
    globalSignature,
  };
}

/** The version a signature was made for: the first `version:` field of the tab separated trusted comment, as the updater plugin reads it. */
export function signedVersion(trustedComment) {
  const field = trustedComment.split("\t").find((part) => part.startsWith("version:"));
  return field === undefined ? null : field.slice("version:".length);
}

/** Ed25519 verification that answers false, not an exception, for a key or signature that is malformed. */
function ed25519Verifies(message, key, signature) {
  try {
    return verify(null, message, key, signature);
  } catch {
    return false;
  }
}

/** What a client checks: the signature over `data` (its BLAKE2b-512 hash when prehashed), then the global signature over the signature and the trusted comment. */
export function verifiesSignature(publicKey, signature, data) {
  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey.key]),
    format: "der",
    type: "spki",
  });
  const message = signature.prehashed ? createHash("blake2b512").update(data).digest() : data;
  const global = Buffer.concat([signature.signature, Buffer.from(signature.trustedComment, "utf8")]);
  return ed25519Verifies(message, key, signature.signature) && ed25519Verifies(global, key, signature.globalSignature);
}

/** Reads and parses a JSON file, or fails naming it. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return fail(`Could not read ${path}: ${error.message}`);
  }
}

/** The pubkey and the version from a tauri.conf.json. */
function readConfig(path) {
  const config = readJson(path);
  const pubkey = config?.plugins?.updater?.pubkey;
  if (typeof pubkey !== "string" || pubkey.trim() === "") fail(`${path} has no plugins.updater.pubkey.`);
  const version = typeof config.version === "string" && !config.version.endsWith(".json") ? config.version : FALLBACK_VERSION;
  return { pubkey: parsePublicKey(pubkey), version };
}

/** Why `pnpm tauri signer sign` failed, in words that name the secret to fix. */
function signFailure(run) {
  if (run.error) return `Could not run 'pnpm tauri signer sign': ${run.error.message}`;
  const output = `${run.stderr}\n${run.stdout}`;
  if (/incorrect updater private key password/i.test(output)) {
    return "TAURI_SIGNING_PRIVATE_KEY_PASSWORD is not the password of TAURI_SIGNING_PRIVATE_KEY. 'tauri build' would only fail on this after the whole build.";
  }
  if (/unexpected argument '--app-version'/.test(output)) {
    return "The Tauri CLI is too old to bind a signature to the app version (needs @tauri-apps/cli 2.12.0 or newer).";
  }
  if (/secret key|private key/i.test(output)) {
    return "TAURI_SIGNING_PRIVATE_KEY is not a Tauri updater private key. Use the private key printed by 'pnpm tauri signer generate', as text.";
  }
  const lines = output.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("$ "));
  const reason = lines.find((line) => /^error\s+\S/i.test(line)) ?? lines.slice(0, 2).join(" ");
  return `'pnpm tauri signer sign' failed: ${(reason || `exit code ${run.status}`).slice(0, 300)}`;
}

/** Signs a one-byte probe the way the build signs the update package and returns the `.sig` text. */
function signProbe(version, env) {
  const dir = mkdtempSync(join(tmpdir(), "zorvo-updater-probe-"));
  try {
    const probe = join(dir, "probe.bin");
    writeFileSync(probe, PROBE_BYTES);
    // The build ignores TAURI_SIGNING_PRIVATE_KEY_PATH, and the CLI refuses it next to the key itself.
    const signingEnv = Object.fromEntries(Object.entries(env).filter(([name]) => name !== "TAURI_SIGNING_PRIVATE_KEY_PATH"));
    const run = spawnSync("pnpm", ["tauri", "signer", "sign", "--app-version", version, probe], {
      env: signingEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: SIGN_TIMEOUT_MS,
    });
    if (run.error || run.status !== 0) fail(signFailure(run));
    return readFileSync(`${probe}.sig`, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Fails unless `signature` was made by `publicKey`'s key; `where` names the signature in the message. */
function requireKeyId(publicKey, signature, where) {
  if (signature.keyId.equals(publicKey.keyId)) return;
  fail(
    `${where} was made by key ${keyIdText(signature.keyId)}, but plugins.updater.pubkey is key ${keyIdText(publicKey.keyId)}. ` +
      "Installed copies of Zorvo would refuse every update signed with it. Put the public key that belongs to the private key " +
      "in plugins.updater.pubkey, or set the secrets to the private key that belongs to the public one.",
  );
}

/** The `key` command. Returns the line to print when the signing key is usable. */
export function checkKey(configPath, env = process.env, sign = signProbe) {
  if (!env.TAURI_SIGNING_PRIVATE_KEY) {
    fail("TAURI_SIGNING_PRIVATE_KEY is not set. Set the secret to the private key made with 'pnpm tauri signer generate'.");
  }
  const { pubkey, version } = readConfig(configPath);
  const signature = parseSignature(sign(version, env));
  requireKeyId(pubkey, signature, "The probe signature");
  if (!verifiesSignature(pubkey, signature, PROBE_BYTES)) {
    fail(
      `The probe signature has the key id of plugins.updater.pubkey (${keyIdText(pubkey.keyId)}) but does not verify under it, ` +
        "so the public key in the config is damaged. Copy it again from the .pub file made with the private key.",
    );
  }
  if (signedVersion(signature.trustedComment) !== version) {
    fail("The Tauri CLI signed without recording the app version, which a client with requireSignedVersion would refuse. Update @tauri-apps/cli to 2.12.0 or newer.");
  }
  return `Updater key OK: key ${keyIdText(signature.keyId)} signed a probe, the signature verifies under plugins.updater.pubkey and records version ${version}.`;
}

/** Fails unless one latest.json platform entry's signature is the pubkey's and was made for `wanted`; checks the package when given. */
function checkEntry(pubkey, name, entry, wanted, artifact) {
  const where = `The ${name} signature in latest.json`;
  if (!entry?.url || !entry?.signature) fail(`latest.json has no signed ${name} entry.`);
  const signature = parseSignature(entry.signature);
  requireKeyId(pubkey, signature, where);
  const signed = signedVersion(signature.trustedComment);
  if (signed === null) {
    fail(`${where} does not record the version it was made for, so a client with requireSignedVersion would refuse this update. Rebuild with @tauri-apps/cli 2.12.0 or newer.`);
  }
  if (signed.replace(/^v/, "") !== wanted) {
    fail(`${where} was made for version ${signed}, but this release is ${wanted}. A client would refuse it as a possible tampered manifest.`);
  }
  if (artifact && name.startsWith("darwin-") && !verifiesSignature(pubkey, signature, artifact)) {
    fail(`${where} does not verify the update package under plugins.updater.pubkey.`);
  }
}

/** The `manifest` command. Returns the line to print when latest.json is safe to publish. */
export function checkManifest(configPath, manifestPath, tag, artifactPath) {
  const { pubkey } = readConfig(configPath);
  const wanted = tag.replace(/^v/, "");
  const manifest = readJson(manifestPath);
  if (manifest?.version !== wanted) fail(`latest.json names version ${manifest?.version}, not ${wanted} (${tag}).`);
  const platforms = manifest.platforms ?? {};
  const artifact = artifactPath ? readFileSync(artifactPath) : null;
  // The updater tries `darwin-aarch64-app` before `darwin-aarch64`, so every entry has to be right.
  for (const name of new Set([...MAC_TARGETS, ...Object.keys(platforms)])) {
    checkEntry(pubkey, name, platforms[name], wanted, artifact);
  }
  return `latest.json OK: ${Object.keys(platforms).length} platform entries are signed by key ${keyIdText(pubkey.keyId)} for version ${wanted}${artifact ? ", and the Mac ones verify the update package" : ""}.`;
}

const USAGE = [
  "Usage: node scripts/check-updater-signing.mjs key <tauri.conf.json>",
  "       node scripts/check-updater-signing.mjs manifest <tauri.conf.json> <latest.json> <tag> [<update.app.tar.gz>]",
].join("\n");

/** Runs a command line and returns the exit code. */
export function main(argv, env = process.env) {
  const [command, ...args] = argv;
  try {
    if (command === "key" && args.length === 1) {
      console.log(checkKey(args[0], env));
    } else if (command === "manifest" && (args.length === 3 || args.length === 4)) {
      console.log(checkManifest(...args));
    } else {
      console.error(USAGE);
      return 2;
    }
    return 0;
  } catch (error) {
    if (!(error instanceof CheckError)) throw error;
    console.error(env.GITHUB_ACTIONS ? `::error::${error.message}` : `error: ${error.message}`);
    return 1;
  }
}

/** Whether this file is the script being run, also when it was started through a symlink (`/tmp` is one on macOS). */
function isEntryPoint() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// Comparing the paths as given would make a symlinked start do nothing and exit 0: a gate that passes silently.
if (isEntryPoint()) {
  process.exitCode = main(process.argv.slice(2));
}
