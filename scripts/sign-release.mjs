#!/usr/bin/env node
// Signs a release on the machine that holds the updater key, and fills the draft release.
//
//   node scripts/sign-release.mjs <vX.Y.Z> [--key <path>] [--dry-run]
//
// Run it with node, not through a package script: `pnpm run` puts the project's `node_modules/.bin` first on PATH.
//
// The Release workflow only builds: it runs the project's own dependencies, so it holds no secret and publishes
// nothing. It keeps the DMG and the update package as the workflow artifact `release-build`. Every installed Zorvo
// trusts one updater key and installs whatever it signs, so the key never leaves your machine. After the run for
// the tag has finished, from a clean checkout of that tag, this script:
//
//   1. proves the checkout is the build: HEAD, the tag on GitHub and the commit the run built must be the same;
//   2. downloads the artifact from that run, with your own `gh` login, and checks it (release-checks.mjs);
//   3. shows what changed since the last release in the dependencies, the build and this code, and asks to go on;
//   4. asks for the key's password (typed hidden) and signs the update package with the pinned Tauri CLI of
//      scripts/updater-signer, `--app-version` included, since installed copies require the signature to record
//      the version it was made for. The key file is handed to the CLI by path: this script never reads it;
//   5. checks latest.json against the signature, then makes the draft release (or fills it again), uploads the
//      build and latest.json, and copies the user guide and public changelog to the releases repository.
//
// You then publish the draft in the releases repository. `--dry-run` does 1 to 4 and the check in 5, and writes
// nothing to GitHub.
//
// Exit codes: 0 done, 1 a check failed, 2 wrong usage.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { CheckError, checkManifest } from "./check-updater-signing.mjs";
import { publicChangelog, releaseNotes } from "./public-docs.mjs";
import { ReleaseError, assetNames, checkArtifact, checkDownloadPolicy, fail, readConfig } from "./release-checks.mjs";
import { RELEASES_REPO, SOURCE_REPO, assetUrl, downloadBuild, ensureDraft, findRun, remoteTagCommit, runGh, syncDocs, uploadAssets, uploadFile } from "./release-github.mjs";
import { ensureSignerCli, scrubSecrets, withoutProjectDirs } from "./signer-cli.mjs";
import { ManifestError, buildManifest } from "./updater-manifest.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TAG = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
const DEFAULT_KEY = join(homedir(), ".tauri", "zorvo-updater.key");
const DOCS = "docs/releases-repo/";
/** What an updater client and the people who download Zorvo trust is made from these: a change in them since the last release is worth a look before signing. */
const TRUSTED_PATHS = ["package.json", "pnpm-lock.yaml", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src-tauri/tauri.conf.json", ".github", "scripts"];
const SIGN_TIMEOUT_MS = 120_000;

/** Why `tauri signer sign` failed, in words that say what to fix. */
export function explainSignFailure(output) {
  // The CLI words a key it cannot read as a wrong password too, with the cause after the colon.
  if (/missing comment in secret key|failed to fill whole buffer|failed to decode (?:base64 )?secret key|not a valid|failed to read private key file|unable to find the private key/i.test(output)) {
    return "The key file is not a Tauri updater private key. Use the file 'tauri signer generate' wrote, not the one that ends in .pub.";
  }
  if (/incorrect updater private key password/i.test(output)) return "The password is wrong for this updater key.";
  const line = output.split("\n").map((text) => text.trim()).find((text) => /^error\b/i.test(text));
  return `'tauri signer sign' failed: ${(line ?? output.trim().split("\n")[0] ?? "no output").slice(0, 300)}`;
}

/**
 * Signs `packagePath` with the key file at `keyPath`, bound to `version`; the `.sig` lands next to it. node runs the
 * CLI's script itself, and the CLI is given the key's path and the password in its own environment, and nothing else.
 */
export function signWithTauri({ entry, keyPath, version, packagePath, password }) {
  const run = spawnSync(process.execPath, [entry, "signer", "sign", "--app-version", version, "--private-key-path", keyPath, packagePath], {
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password },
    encoding: "utf8",
    timeout: SIGN_TIMEOUT_MS,
  });
  if (run.error) fail(`Could not run the Tauri CLI: ${run.error.message}`);
  if (run.status !== 0) fail(explainSignFailure(`${run.stderr}\n${run.stdout}`));
}

/** Asks for a secret without showing it. Enter ends it; Ctrl-C cancels; Ctrl-D ends it when something is typed. */
export function promptHidden(question, { stdin = process.stdin, stdout = process.stdout } = {}) {
  if (!stdin.isTTY) return Promise.reject(new ReleaseError("There is no terminal to type the password in. Run this in a terminal."));
  return new Promise((resolve, reject) => {
    // Raw mode first: once the question is on the screen, whatever is typed must not be echoed.
    stdin.setRawMode(true);
    stdout.write(question);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    // 0: none; 1: after Escape; 2: inside a `[` or `O` sequence (an arrow key), up to its last letter.
    let escape = 0;
    const finish = (done) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write("\n");
      done();
    };
    const cancel = () => finish(() => reject(new ReleaseError("Cancelled.")));
    const onData = (chunk) => {
      for (const char of chunk) {
        if (escape === 1) {
          escape = char === "[" || char === "O" ? 2 : 0;
        } else if (escape === 2) {
          if (/[A-Za-z~]/.test(char)) escape = 0;
        } else if (char === "\u001b") {
          escape = 1;
        } else if (char === "\r" || char === "\n") {
          return finish(() => resolve(value));
        } else if (char === "\u0003") {
          return cancel();
        } else if (char === "\u0004") {
          return value === "" ? cancel() : finish(() => resolve(value));
        } else if (char === "\u0015") {
          value = "";
        } else if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else if (char >= " ") {
          value += char;
        }
      }
    };
    stdin.on("data", onData);
  });
}

/** Asks a question and gives the answer; the default is no. */
export async function confirmOnTerminal(question) {
  if (!process.stdin.isTTY) throw new ReleaseError("There is no terminal to answer in. Run this in a terminal.");
  const lines = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise((resolve) => lines.question(question, resolve));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    lines.close();
  }
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Copies the files that go to the release into `uploadDir`, under the names they have there, with their checksums. */
function stage({ buildDir, uploadDir, names }) {
  mkdirSync(uploadDir, { recursive: true });
  copyFileSync(join(buildDir, names.package), join(uploadDir, names.package));
  copyFileSync(join(buildDir, names.dmg), join(uploadDir, names.dmg));
  // The site links to releases/latest/download/Zorvo-mac.dmg, so every release also carries its DMG under that name.
  copyFileSync(join(buildDir, names.dmg), join(uploadDir, "Zorvo-mac.dmg"));
  // Lets anyone check a download: shasum -a 256 -c SHA256SUMS.txt. Only the DMGs: the update package is protected by its signature.
  const sums = ["Zorvo-mac.dmg", names.dmg].sort().map((name) => `${sha256(join(uploadDir, name))}  ${name}`);
  writeFileSync(join(uploadDir, "SHA256SUMS.txt"), `${sums.join("\n")}\n`);
}

/**
 * What the repository holds, read once, right after the checkout was proven clean: the config, the changelog and
 * the user guide as git tracks it (a stray file in that folder never goes to the public repository).
 */
function readSnapshot({ root, git }) {
  const tracked = git(["ls-files", "-z", "--", DOCS]).split("\0").filter(Boolean);
  return {
    config: readConfig(join(root, "src-tauri", "tauri.conf.json")),
    changelog: readFileSync(join(root, "CHANGELOG.md"), "utf8"),
    docs: tracked.map((path) => ({ dest: path.slice(DOCS.length), content: readFileSync(join(root, path)) })),
  };
}

/** Says what changed since the last release in what the release is made and trusted from. */
function reviewChanges({ git, tag, log }) {
  let previous = "";
  try {
    previous = git(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", "--exclude", tag, "HEAD"]).trim();
  } catch {
    // No earlier release tag in this checkout.
  }
  if (!previous) {
    log("There is no earlier release tag in this checkout, so there is no list of what changed to look at.");
    return;
  }
  const commits = git(["rev-list", "--count", `${previous}..HEAD`]).trim();
  const stat = git(["diff", "--stat", `${previous}..HEAD`, "--", ...TRUSTED_PATHS]).trim();
  log(`Since ${previous}: ${commits} commit(s). Changes to the dependencies, the build, the workflow and this signing code:`);
  log(stat || "  none");
}

/** latest.json for the signed package, checked against the download policy and the signature before anyone uploads it. */
function makeLatestJson({ root, work, tag, notes, url, packagePath, config, log }) {
  const latest = join(work, "upload", "latest.json");
  const manifest = buildManifest({ tag, notes, url, signature: readFileSync(`${packagePath}.sig`, "utf8") });
  writeFileSync(latest, `${JSON.stringify(manifest, null, 2)}\n`);
  checkDownloadPolicy({ endpoints: config.endpoints, manifest, repo: RELEASES_REPO });
  log(checkManifest(join(root, "src-tauri", "tauri.conf.json"), latest, tag, packagePath));
  return latest;
}

/** The whole job. `deps` holds everything outside this repository: `gh`, git, the signer, the prompts. */
export async function signRelease({ tag, keyPath, dryRun = false, root = ROOT, deps }) {
  const { gh, git, sign, askPassword, confirm, log } = deps;
  const version = TAG.exec(tag)?.[1];
  if (version === undefined) fail(`The tag "${tag}" must be vMAJOR.MINOR.PATCH, or vMAJOR.MINOR.PATCH-rc.1 for a pre-release.`);
  if (!existsSync(keyPath)) fail(`No updater key at ${keyPath}. Pass --key <path>, or set TAURI_SIGNING_PRIVATE_KEY_PATH.`);
  if (statSync(keyPath).mode & 0o077) log(`Warning: other users can read ${keyPath}. Run: chmod 600 ${keyPath}`);

  // This script and the config it reads are what is trusted, so they must be the tag's, with nothing changed.
  const isClean = () => git(["status", "--porcelain", "--untracked-files=no"]).trim() === "";
  if (!isClean()) fail("The working tree has changes. Commit or stash them, so the release is signed from exactly the tagged commit.");
  const head = git(["rev-parse", "HEAD"]).trim();
  const snapshot = readSnapshot({ root, git });
  const { config } = snapshot;
  if (config.version !== version) {
    fail(`src-tauri/tauri.conf.json says "${config.version}" but the tag is ${tag}. Check out the tag first: git switch --detach ${tag}`);
  }
  const assertUnchanged = () => {
    if (!isClean() || git(["rev-parse", "HEAD"]).trim() !== head) fail("The checkout changed while this ran (a branch switch, or an edit). Run it again.");
  };

  const tagCommit = remoteTagCommit(gh, { repo: SOURCE_REPO, tag });
  if (tagCommit !== head) {
    fail(`HEAD is ${head.slice(0, 7)} but ${tag} is ${tagCommit.slice(0, 7)} on GitHub. Fetch and check out the tag: git fetch --tags && git switch --detach ${tag}`);
  }
  const run = findRun(gh, { repo: SOURCE_REPO, tag });
  if (run.headSha !== head) {
    fail(`The newest successful run for ${tag} built ${run.headSha.slice(0, 7)}, not ${head.slice(0, 7)}: the tag moved after that run, and the run for its new commit has not succeeded. Wait for it, or re-run it.`);
  }

  const notesText = releaseNotes(snapshot.changelog, tag);
  if (!notesText) fail(`CHANGELOG.md has no section for ${tag}.`);
  const notes = `${notesText}\n\nDownload **Zorvo-mac.dmg** (Apple Silicon and Intel). See the [user guide](https://github.com/${RELEASES_REPO}#install) to install it, and SHA256SUMS.txt to check the download.\n`;

  const work = mkdtempSync(join(tmpdir(), "zorvo-sign-release-"));
  try {
    const names = assetNames(version);
    const buildDir = join(work, "build");
    log(`Downloading the build of run ${run.id}...`);
    downloadBuild(gh, { repo: SOURCE_REPO, runId: run.id, dir: buildDir, log });
    checkArtifact({ dir: buildDir, tag, pubkey: config.pubkey });
    log("The build is the DMG and a package that holds only Zorvo.app, with the updater public key inside.");

    reviewChanges({ git, tag, log });
    if (!dryRun && !(await confirm(`Sign and publish ${tag} from this build? [y/N] `))) fail("Cancelled.");

    const notesFile = join(work, "notes.md");
    writeFileSync(notesFile, notes);
    const uploadDir = join(work, "upload");
    stage({ buildDir, uploadDir, names });
    const packagePath = join(uploadDir, names.package);

    const password = await askPassword();
    assertUnchanged();
    log("Signing the update package...");
    await sign({ keyPath, version, packagePath, password });
    if (!existsSync(`${packagePath}.sig`)) fail("The Tauri CLI wrote no signature.");

    // Before anything goes to GitHub: a key that is not the public key's, or a manifest the app would refuse, stops here.
    makeLatestJson({ root, work, tag, notes, url: `https://api.github.com/repos/${RELEASES_REPO}/releases/assets/0`, packagePath, config, log });
    if (dryRun) {
      log("Dry run: nothing was uploaded.");
      return;
    }

    assertUnchanged();
    ensureDraft(gh, { repo: RELEASES_REPO, tag, notesFile, prerelease: tag.includes("-") });
    // latest.json names the package by its asset URL, which exists only once the package is uploaded.
    uploadAssets(gh, { repo: RELEASES_REPO, tag, files: [names.package, `${names.package}.sig`, names.dmg, "Zorvo-mac.dmg", "SHA256SUMS.txt"].map((name) => join(uploadDir, name)) });
    const url = assetUrl(gh, { repo: RELEASES_REPO, tag, name: names.package });
    const latest = makeLatestJson({ root, work, tag, notes, url, packagePath, config, log });
    uploadFile(gh, { repo: RELEASES_REPO, tag, file: latest });

    const docs = [{ dest: "CHANGELOG.md", content: Buffer.from(publicChangelog(snapshot.changelog)) }, ...snapshot.docs];
    syncDocs(gh, { repo: RELEASES_REPO, tag, files: docs });
    log(`The draft ${tag} is ready: https://github.com/${RELEASES_REPO}/releases. Publish it when it looks right; a published release cannot be changed.`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const USAGE = "Usage: node scripts/sign-release.mjs <vX.Y.Z> [--key <path>] [--dry-run]";

/** `<tag> [--key <path>] [--dry-run]`, or null when the arguments are wrong. */
function parseArgs(argv) {
  const args = { tag: null, key: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--key" && argv[i + 1]) args.key = argv[(i += 1)];
    else if (!argv[i].startsWith("--") && args.tag === null) args.tag = argv[i];
    else return null;
  }
  return args.tag === null ? null : args;
}

/** Runs a command line and returns the exit code. */
export async function main(argv, env = process.env) {
  const args = parseArgs(argv);
  if (!args) {
    console.error(USAGE);
    return 2;
  }
  // Nothing started from here may inherit the key's path or password, or find a program of the project's first.
  const keyFromEnv = env.TAURI_SIGNING_PRIVATE_KEY_PATH;
  process.env.PATH = withoutProjectDirs(process.env.PATH, ROOT);
  scrubSecrets(process.env);

  const log = (message) => console.log(message);
  const deps = {
    gh: runGh,
    git: (gitArgs) => {
      const run = spawnSync("git", gitArgs, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      if (run.status !== 0) fail(`git ${gitArgs[0]} failed: ${String(run.stderr).trim().split("\n")[0]}`);
      return run.stdout;
    },
    sign: async (options) => signWithTauri({ ...options, entry: ensureSignerCli(ROOT, log) }),
    askPassword: () => promptHidden("Updater key password (typed hidden)> "),
    confirm: confirmOnTerminal,
    log,
  };
  try {
    await signRelease({ tag: args.tag, keyPath: args.key ?? keyFromEnv ?? DEFAULT_KEY, dryRun: args.dryRun, root: ROOT, deps });
    return 0;
  } catch (error) {
    if (!(error instanceof ReleaseError || error instanceof CheckError || error instanceof ManifestError)) throw error;
    console.error(`error: ${error.message}`);
    return 1;
  }
}

/** Whether this file is the script being run, also when it was started through a symlink. */
function isEntryPoint() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = await main(process.argv.slice(2));
}
