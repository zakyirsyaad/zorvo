// Fetches and pins trycua's cua-driver, the computer-use engine Zorvo ships inside Zorvo.app.
//
//   node scripts/cua-driver.mjs fetch    download the pinned release into src-tauri/binaries/
//                                        (--optional: warn and go on when it cannot, for `tauri dev`)
//   node scripts/cua-driver.mjs update   rewrite the pin to the newest release that qualifies
//
// The pin is src-tauri/resources/cua-driver.json. `update` is run by hand and its diff is read:
// trycua publishes several releases a day, so it is never part of a build.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isOldEnough, parseShasums } from "./runtimes.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PIN_PATH = join(ROOT, "src-tauri/resources/cua-driver.json");
export const BINARY_PATH = join(ROOT, "src-tauri/binaries/cua-driver");

const TAG_PREFIX = "cua-driver-rs-v";
const RELEASES_URL = "https://github.com/trycua/cua/releases/download/";
/** The one file Zorvo takes from the archive. */
const DRIVER_FILE = "cua-driver";
/** trycua's Developer ID team, checked against the downloaded file's signature. */
const TEAM = "YCK386LBJ7";
/** Before 0.52.1 the driver's worker took the frontmost app at every start. */
export const MINIMUM = "0.52.1";

const parts = (version) => version.split(".").map((n) => Number.parseInt(n, 10));

/** Negative, zero or positive as `a` is older than, equal to or newer than `b` ("0.52.13"). */
export const compareVersions = (a, b) => {
  const [left, right] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

const isPlainVersion = (version) => /^\d+\.\d+\.\d+$/.test(version);

/**
 * The newest driver release that is at least seven days old and not below `minimum`,
 * as {version, released}, or null. Nightly and other tags are ignored.
 */
export const pickDriverRelease = (releasesJson, nowMs, minimum = MINIMUM) => {
  const chosen = releasesJson
    .filter((r) => !r.draft && !r.prerelease && typeof r.tag_name === "string" && r.tag_name.startsWith(TAG_PREFIX))
    .map((r) => ({ version: r.tag_name.slice(TAG_PREFIX.length), published: r.published_at }))
    .filter((r) => isPlainVersion(r.version) && compareVersions(r.version, minimum) >= 0)
    .filter((r) => isOldEnough(r.published, nowMs))
    .sort((a, b) => compareVersions(b.version, a.version))[0];
  return chosen ? { version: chosen.version, released: chosen.published.slice(0, 10) } : null;
};

/** The releases in `gh api --jq` output, one JSON object per line. */
export const parseReleaseLines = (text) =>
  text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));

export const archiveName = (version) => `cua-driver-rs-${version}-darwin-universal-binary.tar.gz`;
export const archiveUrl = (version) => `${RELEASES_URL}${TAG_PREFIX}${version}/${archiveName(version)}`;

export const sha256OfFile = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const hasHash = (path, sha256) => {
  try {
    return lstatSync(path).isFile() && sha256OfFile(path) === sha256;
  } catch {
    return false;
  }
};

/** Throws unless `pin` has every field `fetch` relies on, in the shape it relies on. */
export const checkPin = (pin) => {
  const isHash = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  if (!isPlainVersion(pin?.version ?? "")) throw new Error("The pin has no version.");
  if (compareVersions(pin.version, pin.minimum ?? MINIMUM) < 0) {
    throw new Error(`cua-driver ${pin.version} is older than ${pin.minimum ?? MINIMUM}, the oldest Zorvo can use.`);
  }
  if (pin.url !== archiveUrl(pin.version)) throw new Error("The pin's url is not that version's archive on trycua's releases.");
  if (!isHash(pin.sha256) || !isHash(pin.file?.sha256)) throw new Error("The pin has no SHA-256.");
  if (!Number.isInteger(pin.size) || pin.size <= 0) throw new Error("The pin has no size.");
  if (pin.file.path !== DRIVER_FILE) throw new Error(`The pin must take ${DRIVER_FILE} from the archive.`);
};

/** Takes only `name` out of the archive into `dir` and returns its path. */
const extractOne = (archive, name, dir) => {
  execFileSync("/usr/bin/tar", ["-xzf", archive, "-C", dir, "--", name]);
  const extracted = join(dir, name);
  if (!lstatSync(extracted).isFile()) throw new Error(`${name} in the archive is not a regular file.`);
  return extracted;
};

/**
 * Puts the pinned driver at `dest`. `download(url, toPath)` fetches the archive; it is not
 * called when `dest` already holds the pinned file. Returns "kept" or "fetched".
 */
export const fetchDriver = async ({ pin, dest, download }) => {
  checkPin(pin);
  if (hasHash(dest, pin.file.sha256)) return "kept";
  const work = mkdtempSync(join(tmpdir(), "cua-driver-"));
  try {
    const archive = join(work, "archive.tar.gz");
    await download(pin.url, archive);
    const size = lstatSync(archive).size;
    if (size !== pin.size) throw new Error(`The archive is ${size} bytes, the pin says ${pin.size}.`);
    if (sha256OfFile(archive) !== pin.sha256) throw new Error("The archive's SHA-256 is not the pinned one.");
    const unpacked = join(work, "unpacked");
    mkdirSync(unpacked);
    const file = extractOne(archive, pin.file.path, unpacked);
    if (sha256OfFile(file) !== pin.file.sha256) throw new Error("The driver's SHA-256 is not the pinned one.");
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(file, dest);
    chmodSync(dest, 0o755);
    return "fetched";
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
};

const downloadTo = async (url, toPath) => {
  if (!url.startsWith(RELEASES_URL)) throw new Error(`Refusing to download from ${url}.`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  writeFileSync(toPath, Buffer.from(await response.arrayBuffer()));
};

/** True when codesign says `path` is validly signed by `team`. macOS only. */
const isSignedBy = (path, team) => {
  try {
    execFileSync("/usr/bin/codesign", [
      "--verify",
      "--strict",
      `-R=anchor apple generic and certificate leaf[subject.OU] = "${team}"`,
      path,
    ]);
    return true;
  } catch {
    return false;
  }
};

const runFetch = async () => {
  const pin = JSON.parse(readFileSync(PIN_PATH, "utf8"));
  try {
    const outcome = await fetchDriver({ pin, dest: BINARY_PATH, download: downloadTo });
    console.log(outcome === "kept" ? `cua-driver ${pin.version} is already in place.` : `Fetched cua-driver ${pin.version}.`);
  } catch (error) {
    // A development build runs without the driver; only computer use needs it. A bundle does not.
    if (!process.argv.includes("--optional")) throw error;
    console.warn(`cua-driver was not fetched: ${error.message} Computer use will not work in this build.`);
  }
};

const runUpdate = async () => {
  // One release per line: `--paginate` prints each page as its own JSON document on some
  // versions of gh, and `--jq` runs per page, so the lines parse the same on all of them.
  const listed = execFileSync(
    "gh",
    ["api", "repos/trycua/cua/releases?per_page=100", "--paginate", "--jq", ".[] | {tag_name, published_at, draft, prerelease}"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const picked = pickDriverRelease(parseReleaseLines(listed), Date.now());
  if (!picked) {
    console.error(`No cua-driver release is both ${MINIMUM} or newer and at least 7 days old yet.`);
    process.exit(1);
  }
  const work = mkdtempSync(join(tmpdir(), "cua-driver-pin-"));
  try {
    const url = archiveUrl(picked.version);
    const archive = join(work, archiveName(picked.version));
    await downloadTo(url, archive);
    const sums = join(work, "checksums.txt");
    await downloadTo(`${RELEASES_URL}${TAG_PREFIX}${picked.version}/checksums.txt`, sums);
    const sha256 = sha256OfFile(archive);
    if (parseShasums(readFileSync(sums, "utf8"), archiveName(picked.version)) !== sha256) {
      throw new Error("The archive does not match the release's checksums.txt.");
    }
    const file = extractOne(archive, DRIVER_FILE, work);
    if (!isSignedBy(file, TEAM)) throw new Error(`${DRIVER_FILE} is not signed by trycua's team ${TEAM}.`);
    const pin = {
      version: picked.version,
      released: picked.released,
      url,
      sha256,
      size: lstatSync(archive).size,
      file: { path: DRIVER_FILE, sha256: sha256OfFile(file) },
      team: TEAM,
      minimum: MINIMUM,
    };
    writeFileSync(PIN_PATH, `${JSON.stringify(pin, null, 2)}\n`);
    console.log(`Pinned cua-driver ${pin.version} (released ${pin.released}). Read the diff before committing.`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const commands = { fetch: runFetch, update: runUpdate };
  const command = commands[process.argv[2]];
  if (!command) {
    console.error("usage: node scripts/cua-driver.mjs fetch|update");
    process.exit(64);
  }
  command().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
