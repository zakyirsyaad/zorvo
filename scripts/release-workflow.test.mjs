import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The Release workflow keeps the updater key out of reach of the project's build code. These tests read the YAML as
// text (the workflow is plain enough, and no YAML parser is a dependency) and fail when a change would put the key,
// its password or the releases token back where a build dependency could read them.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");

const KEY_SECRETS = ["TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"];
const PUBLISH_SECRETS = [...KEY_SECRETS, "RELEASES_TOKEN"];

/** The workflow text without comment lines, so a word in a comment never counts as code. */
const withoutComments = (text) => text.replace(/^[ \t]*#.*$/gm, "");

/** `jobs:` split into `{ id: text }`, by the two-space keys under it. */
function jobsOf(text) {
  const body = text.slice(text.indexOf("\njobs:\n") + "\njobs:\n".length);
  const parts = body.split(/^ {2}([a-z][\w-]*):[ \t]*$/m);
  const jobs = {};
  for (let i = 1; i < parts.length; i += 2) jobs[parts[i]] = parts[i + 1];
  return jobs;
}

/** A job's steps, split at the `- ` of each step (six spaces in). */
const stepsOf = (job) => job.split(/^ {6}- /m).slice(1).map((step) => `- ${step}`);

const jobs = jobsOf(WORKFLOW);
const secretsIn = (text) => [...withoutComments(text).matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]);
/** What a step runs from the project or its dependencies. The signer CLI and `gh` are not that. */
const RUNS_PROJECT_CODE = /\b(?:node|pnpm|npm|npx|yarn|cargo|bash|sh|python3?|deno|bun)\b|(?:^|\s)\.{1,2}\//m;

describe("the jobs", () => {
  it("builds in one job and signs in another", () => {
    expect(Object.keys(jobs)).toEqual(["macos", "sign"]);
  });

  it("makes the signing job wait for the build and for a reviewer", () => {
    expect(withoutComments(jobs.sign)).toMatch(/^\s+needs: macos\s*$/m);
    expect(withoutComments(jobs.sign)).toMatch(/^\s+environment: release\s*$/m);
  });

  it("does not gate the build itself, which would ask for approval before the macOS minutes are spent", () => {
    expect(withoutComments(jobs.macos)).not.toMatch(/environment:/);
  });
});

describe("secrets", () => {
  it("keeps the key, its password and the releases token out of the build job and the workflow header", () => {
    const outsideSign = withoutComments(WORKFLOW.replace(jobs.sign, ""));
    for (const name of PUBLISH_SECRETS) expect(outsideSign).not.toContain(`secrets.${name}`);
  });

  it("gives the build job only the Apple secrets", () => {
    const names = secretsIn(jobs.macos);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toMatch(/^APPLE_/);
  });

  it("does not let the build upload anything to a release", () => {
    const build = withoutComments(jobs.macos);
    expect(build).not.toMatch(/\b(?:tagName|releaseId|releaseDraft|uploadUpdaterJson|GITHUB_TOKEN)\b/);
    expect(build).not.toMatch(/\bgh (?:release|api)\b/);
  });

  it("never puts the key or its password in a step that runs a script or a package manager", () => {
    const keySteps = stepsOf(jobs.sign).filter((step) => KEY_SECRETS.some((name) => secretsIn(step).includes(name)));
    expect(keySteps.length).toBeGreaterThan(0);
    for (const step of keySteps) expect(withoutComments(step)).not.toMatch(RUNS_PROJECT_CODE);
  });

  it("never puts the releases token in a step that runs a script or a package manager", () => {
    const tokenSteps = stepsOf(jobs.sign).filter((step) => secretsIn(step).includes("RELEASES_TOKEN"));
    expect(tokenSteps.length).toBeGreaterThan(0);
    for (const step of tokenSteps) expect(withoutComments(step)).not.toMatch(RUNS_PROJECT_CODE);
  });

  it("keeps the key and the releases token in different steps", () => {
    for (const step of stepsOf(jobs.sign)) {
      const names = secretsIn(step);
      expect(names.includes("RELEASES_TOKEN") && names.some((name) => KEY_SECRETS.includes(name))).toBe(false);
    }
  });

  it("lets no step change the environment or the path of the steps after it", () => {
    // A step before the key step could otherwise set NODE_OPTIONS, or put its own `tauri` first in PATH.
    expect(withoutComments(jobs.sign)).not.toMatch(/GITHUB_ENV|GITHUB_PATH/);
  });

  it("gives the key's password to one step, the one that signs with the Tauri CLI", () => {
    const withPassword = stepsOf(jobs.sign).filter((step) => secretsIn(step).includes("TAURI_SIGNING_PRIVATE_KEY_PASSWORD"));
    expect(withPassword).toHaveLength(1);
    expect(withPassword[0]).toContain("signer sign --app-version");
  });

  it("gives the key itself only to that step and to a check that it is set", () => {
    const withKey = stepsOf(jobs.sign).filter((step) => secretsIn(step).includes("TAURI_SIGNING_PRIVATE_KEY"));
    expect(withKey).toHaveLength(2);
    const [check, signing] = withKey;
    expect(check).toContain("Check the updater key is set");
    expect(withoutComments(check)).not.toMatch(RUNS_PROJECT_CODE);
    expect(check).not.toContain("signer sign");
    expect(signing).toContain("signer sign --app-version");
  });

  it("reads secrets only by name, never as a whole", () => {
    const code = withoutComments(WORKFLOW);
    expect(code).not.toMatch(/secrets\[|toJSON\(\s*secrets|secrets:\s*inherit/);
  });

  it("never hands the one-off key on in the artifact", () => {
    const upload = stepsOf(jobs.macos).find((step) => step.includes("actions/upload-artifact"));
    expect(upload).toContain("path: ${{ runner.temp }}/release-build/");
    expect(withoutComments(jobs.macos)).toContain('"$RUNNER_TEMP/one-off.key"');
    expect(withoutComments(jobs.macos).split("one-off.key").length - 1).toBe(2);
  });
});

describe("the signing job's code", () => {
  const sign = withoutComments(jobs.sign);

  it("installs only the pinned Tauri CLI, without install scripts", () => {
    expect(sign).toContain("working-directory: .github/updater-signer");
    expect(sign).toContain("npm ci --ignore-scripts");
    expect(sign).not.toMatch(/pnpm install|pnpm\/action-setup/);
  });

  it("signs the update package bound to the version being released", () => {
    expect(sign).toMatch(/signer sign --app-version "\$version"/);
  });

  it("checks latest.json with the package before uploading it", () => {
    const steps = stepsOf(jobs.sign).map(withoutComments);
    const checked = steps.findIndex((step) => step.includes("check-updater-signing.mjs manifest"));
    const uploaded = steps.findIndex((step) => step.startsWith("- name: Upload latest.json"));
    expect(checked).toBeGreaterThan(-1);
    expect(uploaded).toBeGreaterThan(checked);
    expect(steps[checked]).toContain('manifest src-tauri/tauri.conf.json "$upload/latest.json" "$TAG" "$package"');
    expect(steps[checked]).toContain('package="$upload/Zorvo_${version}_universal.app.tar.gz"');
  });

  it("keeps the tag check, the checksums, the docs sync and the pre-release rule", () => {
    expect(withoutComments(jobs.macos)).toContain("Check the tag matches the app version");
    // The notes are written after the build, so a version with no changelog section must fail before it.
    expect(withoutComments(jobs.macos)).toContain('node scripts/public-docs.mjs notes CHANGELOG.md "$TAG"');
    expect(sign).toContain("SHA256SUMS.txt");
    expect(sign).toContain("scripts/public-docs.mjs changelog");
    expect(sign).toMatch(/\*-\*\)\s*prerelease=true/);
    expect(sign).toContain("--draft");
  });
});

describe("pinning", () => {
  it("pins every action to a commit", () => {
    const uses = [...withoutComments(WORKFLOW).matchAll(/^\s*(?:- )?uses: (\S+)/gm)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) expect(use).toMatch(/@[0-9a-f]{40}$/);
  });
});
