// The checks `scripts/sign-release.mjs` makes before it signs and publishes a release.
//
// The Release workflow builds the app in a job that runs the project's own dependencies, so what it hands on is
// data to check, not something to trust: `checkArtifact` is a sanity check for that, and a tripwire for the worst
// case, an app that trusts another updater key. It is not a boundary: a build that is compromised can still make a
// package that passes it. `checkDownloadPolicy` is the rule installed copies enforce on latest.json
// (`ALLOWED_DOWNLOADS` in src-tauri/src/app_update.rs), checked before the file is uploaded.

import { spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A check that failed; reported as a message, without a stack. */
export class ReleaseError extends Error {}

export function fail(message) {
  throw new ReleaseError(message);
}

const APP = "Zorvo.app";
const BINARY = `${APP}/Contents/MacOS/zorvo`;
/** A universal binary of the app is tens of megabytes; this is the most `tar` may hand back. */
const MAX_BINARY_BYTES = 1024 ** 3;
const TAR_TIMEOUT_MS = 120_000;

/** The files a build hands on for `version`, under the names the bundler gives them. */
export function assetNames(version) {
  return { package: `Zorvo_${version}_universal.app.tar.gz`, dmg: `Zorvo_${version}_universal.dmg` };
}

/** The version, updater public key and update endpoints of a tauri.conf.json. */
export function readConfig(path) {
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return fail(`Could not read ${path}: ${error.message}`);
  }
  const pubkey = config?.plugins?.updater?.pubkey;
  if (typeof pubkey !== "string" || pubkey.trim() === "") fail(`${path} has no plugins.updater.pubkey.`);
  const endpoints = config.plugins.updater.endpoints;
  return {
    version: String(config.version ?? ""),
    identifier: String(config.identifier ?? ""),
    pubkey,
    endpoints: Array.isArray(endpoints) ? endpoints : [],
  };
}

const CODESIGN = "/usr/bin/codesign";
const CODESIGN_TIMEOUT_MS = 120_000;

/** Runs `codesign`; its report goes to stderr, so the result is both streams joined. */
function codesign(args) {
  const run = spawnSync(CODESIGN, args, { encoding: "utf8", timeout: CODESIGN_TIMEOUT_MS, env: { ...process.env, LC_ALL: "C" } });
  if (run.error) fail(`Could not run codesign: ${run.error.message}`);
  return { ok: run.status === 0, report: `${run.stdout}${run.stderr}` };
}

/**
 * Fails unless the app in the update package is signed as a whole under `identifier` (the bundle identifier macOS
 * keys its permission grants by): the identifier is that name, the Info.plist is bound, the resources are sealed and
 * `codesign --verify --deep --strict` passes. Run it on the Mac that signs the release, where `codesign` is. It
 * unpacks the package into a folder of its own, which `checkArtifact` has already shown holds only `Zorvo.app`.
 */
export function checkCodeSignature({ dir, tag, identifier }) {
  const packagePath = join(dir, assetNames(tag.replace(/^v/, "")).package);
  const work = mkdtempSync(join(tmpdir(), "zorvo-signature-check-"));
  try {
    tar(["-xzf", packagePath, "-C", work]);
    const app = join(work, APP);
    const shown = codesign(["-dv", "--verbose=2", app]);
    const actual = /^Identifier=(.*)$/m.exec(shown.report)?.[1];
    if (!identifier || actual !== identifier) {
      fail(`The app in the update package is signed as ${printable(actual ?? "nothing")}, not as the bundle identifier ${identifier}, so macOS cannot match the permissions a person gave it.`);
    }
    if (!/^Info\.plist entries=\d+/m.test(shown.report)) fail("The app in the update package has no Info.plist bound into its signature.");
    if (!/^Sealed Resources version=/m.test(shown.report)) fail("The app in the update package has no sealed resources: only its executable is signed.");
    if (!codesign(["--verify", "--deep", "--strict", app]).ok) fail("`codesign --verify --deep --strict` fails on the app in the update package.");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** A file name safe to print: anything outside a plain set becomes `?`, newlines included. */
const printable = (name) => name.replace(/[^A-Za-z0-9._-]/g, "?");

/** Runs `tar`, and returns its output, or fails naming what tar said. */
function tar(args, { binary = false } = {}) {
  const run = spawnSync("tar", args, {
    encoding: binary ? "buffer" : "utf8",
    maxBuffer: MAX_BINARY_BYTES,
    timeout: TAR_TIMEOUT_MS,
    env: { ...process.env, COPYFILE_DISABLE: "1", LC_ALL: "C" },
  });
  if (run.error) fail(`Could not run tar: ${run.error.message}`);
  if (run.status !== 0) fail(`tar could not read the update package: ${String(run.stderr).trim().split("\n")[0]}`);
  return run.stdout;
}

/** Whether a link target leaves the app: an absolute path, or one that climbs out with `..`. */
const leavesApp = (target) => target.startsWith("/") || /(^|\/)\.\.(\/|$)/.test(target);

/**
 * Fails unless `dir` holds exactly the DMG and the update package for `tag`, as plain files, the package holds
 * only `Zorvo.app` (no hard links, no links out of it), and the app's binary holds `pubkey` as text.
 */
export function checkArtifact({ dir, tag, pubkey }) {
  const names = assetNames(tag.replace(/^v/, ""));
  const found = readdirSync(dir).sort();
  const expected = [names.dmg, names.package].sort();
  if (found.join("\n") !== expected.join("\n")) {
    fail(`The build artifact must hold exactly ${names.package} and ${names.dmg}, and it holds: ${found.map(printable).join(" ")}`);
  }
  for (const name of expected) {
    const stat = lstatSync(join(dir, name));
    if (!stat.isFile() || stat.size === 0) fail(`${name} is not a plain, non-empty file.`);
  }

  const packagePath = join(dir, names.package);
  // tar reads other formats too; the updater's client reads a .tar.gz.
  const magic = readFileSync(packagePath).subarray(0, 2);
  if (magic[0] !== 0x1f || magic[1] !== 0x8b) fail("The update package is not a gzip file.");
  const entries = tar(["-tzf", packagePath]).split("\n").filter(Boolean);
  // A listing shows a link as `name -> target`, so a name that has the arrow in it could hide where a link points.
  if (entries.some((entry) => entry.includes(" -> "))) fail("The update package holds a file whose name contains ' -> ', which hides where a link points.");
  const insideApp = entries.every((entry) => /^Zorvo\.app(\/|$)/.test(entry) && !/(^|\/)\.\.(\/|$)/.test(entry));
  if (!insideApp || !entries.some((entry) => entry.startsWith(`${APP}/Contents/`))) {
    fail("The update package must hold Zorvo.app and nothing outside it.");
  }
  const listing = tar(["-tvzf", packagePath]).split("\n");
  const badLink = listing.some((line) => line.startsWith("h") || (line.startsWith("l") && leavesApp(/^.* -> (.*)$/.exec(line)?.[1] ?? "/")));
  if (badLink) fail("The update package holds a hard link, or a link that points outside Zorvo.app.");

  const binary = tar(["-xzOf", packagePath, BINARY], { binary: true });
  if (!pubkey || !binary.includes(Buffer.from(pubkey))) {
    fail("The app in the update package does not hold the updater public key of src-tauri/tauri.conf.json, so installed copies that update to it would trust another key.");
  }
}

/**
 * Fails unless the update endpoints and every download in `manifest` are inside the releases repository `repo`,
 * the only place installed copies of Zorvo accept an update from.
 */
export function checkDownloadPolicy({ endpoints, manifest, repo }) {
  const repository = repo.toLowerCase();
  const inside = (url, prefixes) => typeof url === "string" && prefixes.some((prefix) => url.toLowerCase().startsWith(prefix));
  if (endpoints.length === 0 || !endpoints.every((url) => inside(url, [`https://github.com/${repository}/`]))) {
    fail(`plugins.updater.endpoints in src-tauri/tauri.conf.json is not inside https://github.com/${repo}, where releases are published.`);
  }
  const urls = Object.values(manifest?.platforms ?? {}).map((entry) => entry?.url);
  const allowed = [`https://api.github.com/repos/${repository}/`, `https://github.com/${repository}/`];
  if (urls.length === 0 || !urls.every((url) => inside(url, allowed))) {
    fail(`A download URL in latest.json is not inside https://github.com/${repo}, so installed copies of Zorvo would refuse it.`);
  }
}
