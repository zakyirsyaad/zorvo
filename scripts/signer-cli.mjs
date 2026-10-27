// The Tauri CLI that signs updates, and the care taken around it.
//
// The updater key and its password only ever meet the CLI pinned in scripts/updater-signer: installed on its own
// from its lockfile, with no install scripts, and run by node directly, so that none of the project's dependencies
// run next to them and no PATH lookup decides which program gets them. `scripts/sign-release.mjs` signs with it,
// and `scripts/check-updater-signing.mjs key` checks a key with it.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve, sep } from "node:path";
import { fail } from "./release-checks.mjs";

/** The folder that holds the pinned CLI's package.json and lockfile. */
export const signerFolder = (root) => join(root, "scripts", "updater-signer");

/** The CLI's own script, which node runs directly. */
export const signerEntry = (root) => join(signerFolder(root), "node_modules", "@tauri-apps", "cli", "tauri.js");

/** The names of an environment that hold the updater key, where it is, or its password (the Tauri CLI reads the old names too). */
const SECRET_NAMES = /^TAURI_(?:SIGNING_PRIVATE_KEY|PRIVATE_KEY)/;

/** Removes the updater key, its path and its password from `env`, so no program started from here inherits them. */
export function scrubSecrets(env) {
  for (const name of Object.keys(env)) {
    if (SECRET_NAMES.test(name)) delete env[name];
  }
  return env;
}

/**
 * A PATH without the folders of the project: `pnpm run` puts `node_modules/.bin` first, so a dependency with a
 * `bin` named node, git or gh would stand in for them, and relative entries mean whatever folder this runs from.
 */
export function withoutProjectDirs(pathValue, root) {
  const project = resolve(root);
  return String(pathValue ?? "")
    .split(delimiter)
    .filter((entry) => isAbsolute(entry) && resolve(entry) !== project && !resolve(entry).startsWith(project + sep))
    .join(delimiter);
}

/**
 * Installs the pinned CLI from scripts/updater-signer, every time: node_modules there is not tracked by git, so a
 * copy that is already there proves nothing. The lockfile has the hash of every package, and no install script runs.
 * Gives the path of the CLI's script.
 */
export function ensureSignerCli(root, log) {
  const folder = signerFolder(root);
  const wanted = JSON.parse(readFileSync(join(folder, "package.json"), "utf8")).dependencies["@tauri-apps/cli"];
  log(`Installing the Tauri CLI ${wanted} pinned in scripts/updater-signer (npm ci, no install scripts)...`);
  const install = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: folder, stdio: "inherit" });
  let installed = null;
  try {
    installed = JSON.parse(readFileSync(join(folder, "node_modules", "@tauri-apps", "cli", "package.json"), "utf8")).version;
  } catch {
    // Reported below.
  }
  if (install.status !== 0 || installed !== wanted) fail("Could not install the pinned Tauri CLI: 'npm ci' failed in scripts/updater-signer.");
  return signerEntry(root);
}
