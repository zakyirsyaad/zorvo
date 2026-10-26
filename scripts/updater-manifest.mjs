#!/usr/bin/env node
// Writes latest.json, the file installed copies of Zorvo read to learn about an update.
//
//   node scripts/updater-manifest.mjs <tag> <notes.md> <package-url> <package.sig> <latest.json>
//
// The Release workflow's signing job runs it once the update package is signed and uploaded to the draft release
// (the URL names the uploaded asset). It makes the file `tauri-action` used to make, with the same entries, so the
// updater reads it the same way: one universal `.app.tar.gz` offered to both Macs. The signature is the text of the
// `.sig` file, which `tauri signer sign --app-version` wrote, so it records the version being released.
// `check-updater-signing.mjs manifest` then checks the result before it is uploaded.
//
// Exit codes: 0 written, 1 a check failed, 2 wrong usage.

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TAG = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/**
 * The names the updater looks up for a macOS build, the one-package-for-both-Macs build included: it tries
 * `{os}-{arch}-{installer}` before `{os}-{arch}`, and `app` is the installer of an `.app.tar.gz`. The same six
 * entries `tauri-action` wrote for v0.6.0.
 */
export const PLATFORM_ENTRIES = [
  "darwin-aarch64",
  "darwin-x86_64",
  "darwin-universal",
  "darwin-aarch64-app",
  "darwin-x86_64-app",
  "darwin-universal-app",
];

/** A check that failed; reported as a message, without a stack. */
class ManifestError extends Error {}

function fail(message) {
  throw new ManifestError(message);
}

/** The manifest object for a signed package that is already uploaded at `url`. */
export function buildManifest({ tag, notes, url, signature, now = new Date() }) {
  const version = TAG.exec(tag)?.[1];
  if (version === undefined) fail(`The tag "${tag}" must be vMAJOR.MINOR.PATCH, or vMAJOR.MINOR.PATCH-rc.1 for a pre-release.`);
  if (!/^https:\/\/\S+$/.test(url)) fail(`The package URL "${url}" must be an https URL.`);
  const trimmed = signature.trim();
  if (!BASE64.test(trimmed)) fail("The signature is not the base64 text of a .sig file.");
  const platforms = Object.fromEntries(PLATFORM_ENTRIES.map((name) => [name, { signature: trimmed, url }]));
  return { version, notes: notes.trim(), pub_date: now.toISOString(), platforms };
}

/** Reads a file, or fails naming it. */
function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    return fail(`Could not read ${path}: ${error.message}`);
  }
}

const USAGE = "Usage: node scripts/updater-manifest.mjs <tag> <notes.md> <package-url> <package.sig> <latest.json>";

/** Runs a command line and returns the exit code. */
export function main(argv, env = process.env) {
  if (argv.length !== 5) {
    console.error(USAGE);
    return 2;
  }
  const [tag, notesPath, url, signaturePath, outPath] = argv;
  try {
    const manifest = buildManifest({ tag, notes: readText(notesPath), url, signature: readText(signaturePath) });
    writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`latest.json written for ${manifest.version}: ${PLATFORM_ENTRIES.length} platform entries.`);
    return 0;
  } catch (error) {
    if (!(error instanceof ManifestError)) throw error;
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
