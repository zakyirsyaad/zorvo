// What `scripts/sign-release.mjs` does on GitHub, through the `gh` CLI signed in as the person running it.
//
// Every function takes `gh`, a function `(args, { input }) => { status, stdout, stderr }` (`runGh` runs the real
// one), so the tests need no network. The Release workflow publishes nothing: it only builds, and keeps the build
// as a workflow artifact. Making the draft release, uploading to it and copying the user guide to the releases
// repository all happen here, on the machine that holds the updater key.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fail } from "./release-checks.mjs";

export const SOURCE_REPO = "zakyirsyaad/zorvo";
export const RELEASES_REPO = "zakyirsyaad/zorvo-releases";
/** The name the Release workflow gives the artifact that holds the DMG and the update package. */
export const BUILD_ARTIFACT = "release-build";

/** Runs the real `gh`. */
export function runGh(args, { input } = {}) {
  const run = spawnSync("gh", args, { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return { status: 127, stdout: "", stderr: `Could not run gh: ${run.error.message}` };
  return { status: run.status ?? 1, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

const firstLine = (text) => String(text).trim().split("\n")[0];

/** The output of a `gh` call that had to work, or a failure that says what it was doing and what gh said. */
function output(run, doing) {
  if (run.status !== 0) fail(`${doing} failed: ${firstLine(run.stderr) || `gh exited with ${run.status}`}`);
  return run.stdout;
}

/** The newest successful Release run that the push of `tag` started. */
export function findRun(gh, { repo, tag }) {
  const listing = output(
    gh(["run", "list", "--repo", repo, "--workflow", "release.yml", "--branch", tag, "--status", "success", "--limit", "10", "--json", "databaseId,headSha,event,createdAt"]),
    "Listing the Release runs",
  );
  const runs = JSON.parse(listing)
    .filter((run) => run.event === "push")
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (runs.length === 0) {
    fail(`No successful Release run for ${tag} in ${repo}. Push the tag and wait for its run to finish (or re-run the failed one), then try again.`);
  }
  return { id: runs[0].databaseId, headSha: runs[0].headSha };
}

/** The commit `tag` points to on GitHub (an annotated tag too); the qualified name leaves a branch of the same name out of it. */
export function remoteTagCommit(gh, { repo, tag }) {
  return output(gh(["api", `repos/${repo}/commits/refs/tags/${tag}`, "--jq", ".sha"]), `Looking up the tag ${tag} on GitHub`).trim();
}

/** Downloads the DMG and the update package a run kept, into `dir`. */
export function downloadBuild(gh, { repo, runId, dir }) {
  output(gh(["run", "download", String(runId), "--repo", repo, "--name", BUILD_ARTIFACT, "--dir", dir]), `Downloading the build of run ${runId}`);
}

/** Whether `tag` has no release yet, a draft, or a published release. */
export function draftState(gh, { repo, tag }) {
  const run = gh(["release", "view", tag, "--repo", repo, "--json", "isDraft", "--jq", ".isDraft"]);
  if (run.status === 0) return run.stdout.trim() === "true" ? "draft" : "published";
  // Only "not found" means there is none: an API error taken for it would make a second draft.
  if (/release not found/.test(run.stderr)) return "none";
  return fail(`Looking up the release ${tag} failed: ${firstLine(run.stderr)}`);
}

/** Makes the draft release for `tag`, or fills the one that is there again; a published release cannot change. */
export function ensureDraft(gh, { repo, tag, notesFile, prerelease }) {
  const state = draftState(gh, { repo, tag });
  if (state === "published") fail(`${tag} is already published in ${repo}, and a published release cannot be changed. Tag a new version.`);
  if (state === "draft") {
    output(gh(["release", "edit", tag, "--repo", repo, "--title", `Zorvo ${tag}`, "--notes-file", notesFile, `--prerelease=${prerelease}`]), "Updating the draft release");
    return;
  }
  const args = ["release", "create", tag, "--repo", repo, "--draft", "--target", "main", "--title", `Zorvo ${tag}`, "--notes-file", notesFile];
  if (prerelease) args.push("--prerelease");
  output(gh(args), "Creating the draft release");
}

/** The assets a release holds. */
function assetsOf(gh, { repo, tag }) {
  return JSON.parse(output(gh(["release", "view", tag, "--repo", repo, "--json", "assets"]), `Listing the assets of ${tag}`)).assets ?? [];
}

/**
 * Uploads `files` to the draft, over any that are there. A latest.json left by an earlier try names the package
 * this upload replaces, so it goes first; the checked one is uploaded last.
 */
export function uploadAssets(gh, { repo, tag, files }) {
  if (assetsOf(gh, { repo, tag }).some((asset) => asset.name === "latest.json")) {
    output(gh(["release", "delete-asset", tag, "latest.json", "--repo", repo, "--yes"]), "Removing the old latest.json");
  }
  output(gh(["release", "upload", tag, "--repo", repo, "--clobber", ...files]), "Uploading the build");
}

/** The API URL of an asset of the draft, which is how latest.json names the update package. */
export function assetUrl(gh, { repo, tag, name }) {
  const asset = assetsOf(gh, { repo, tag }).find((candidate) => candidate.name === name);
  if (!asset?.apiUrl) fail(`The draft release has no ${name} asset after the upload.`);
  return asset.apiUrl;
}

/** Uploads one file to the draft, over the one that is there. */
export function uploadFile(gh, { repo, tag, file }) {
  output(gh(["release", "upload", tag, file, "--repo", repo, "--clobber"]), `Uploading ${file}`);
}

/** The hash git gives a file's bytes; the contents API reports it as `sha`. */
export function gitBlobSha(content) {
  return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
}

/**
 * Puts each `{ dest, content }` file (`content` a Buffer) in the main branch of the releases repository, skipping
 * the ones it already has. The file goes in a JSON body on standard input: a command-line argument is limited to
 * 128 KiB on Linux.
 */
export function syncDocs(gh, { repo, tag, files }) {
  for (const { dest, content } of files) {
    const existing = gh(["api", `repos/${repo}/contents/${dest}`, "--jq", ".sha"]);
    const sha = existing.status === 0 ? existing.stdout.trim() : "";
    if (sha && sha === gitBlobSha(content)) continue;
    const body = { message: `docs: update ${dest} for ${tag}`, content: content.toString("base64"), branch: "main", ...(sha ? { sha } : {}) };
    output(gh(["api", "--method", "PUT", `repos/${repo}/contents/${dest}`, "--input", "-", "--silent"], { input: JSON.stringify(body) }), `Copying ${dest}`);
  }
}
