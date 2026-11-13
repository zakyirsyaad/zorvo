import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assetNames } from "./release-checks.mjs";
import { BUILD_ARTIFACT } from "./release-github.mjs";

// The Release workflow only builds. The updater key, its password and the token that publishes to the releases
// repository are not in GitHub at all: scripts/sign-release.mjs uses them on the maintainer's Mac. These tests read
// the YAML as text (it is plain enough, and no YAML parser is a dependency) and fail when a change would give the
// build job, which runs the project's own dependencies, a secret or a way to publish.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");

/** The workflow text without comment lines, so a word in a comment never counts as code. */
const withoutComments = (text) => text.replace(/^[ \t]*#.*$/gm, "");
const code = withoutComments(WORKFLOW);

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
const secrets = [...code.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]);

describe("the workflow's job", () => {
  it("is one job, which builds", () => {
    expect(Object.keys(jobs)).toEqual(["macos"]);
  });

  it("asks nobody for approval and publishes nothing, since a second job would need a secret", () => {
    expect(code).not.toMatch(/^\s+(?:needs|environment):/m);
  });

  it("may only read this repository", () => {
    expect(code).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(code).not.toMatch(/^\s+[a-z-]+: (?:write|admin)\s*$/m);
  });
});

describe("secrets", () => {
  it("has only the Apple ones, which signing and notarizing the app needs while it is built", () => {
    expect(secrets.length).toBeGreaterThan(0);
    for (const name of secrets) expect(name).toMatch(/^APPLE_/);
  });

  it("never mentions the updater key, its password or the releases token as a secret", () => {
    expect(code).not.toMatch(/secrets\.(?:TAURI_SIGNING_PRIVATE_KEY|RELEASES_TOKEN)/);
  });

  it("reads secrets only by name, never as a whole", () => {
    expect(code).not.toMatch(/secrets\[|toJSON\(\s*secrets|secrets:\s*inherit/);
  });

  it("gives the build no token and no way to publish a release", () => {
    expect(code).not.toMatch(/\b(?:tagName|releaseId|releaseDraft|uploadUpdaterJson|GITHUB_TOKEN|GH_TOKEN)\b/);
    expect(code).not.toMatch(/\bgh (?:release|api|run)\b/);
  });
});

describe("the one-off key", () => {
  it("is made on the runner and used by the build, so `tauri build` runs without the real key", () => {
    expect(code).toContain('pnpm tauri signer generate --ci --write-keys "$RUNNER_TEMP/one-off.key"');
    expect(code).toContain("TAURI_SIGNING_PRIVATE_KEY: ${{ runner.temp }}/one-off.key");
  });

  it("is not handed on in the artifact", () => {
    const upload = stepsOf(jobs.macos).find((step) => step.includes("actions/upload-artifact"));
    expect(upload).toContain("path: ${{ runner.temp }}/release-build/");
    expect(code.split("one-off.key").length - 1).toBe(2);
  });
});

describe("what it hands on", () => {
  const upload = withoutComments(stepsOf(jobs.macos).find((step) => step.includes("actions/upload-artifact")));

  it("is the artifact scripts/sign-release.mjs downloads, and a new run may replace the one of an earlier try", () => {
    expect(upload).toContain(`name: ${BUILD_ARTIFACT}`);
    expect(upload).toContain("overwrite: true");
    expect(upload).toContain("if-no-files-found: error");
  });

  it("holds the DMG and the package under the names scripts/release-checks.mjs expects", () => {
    const names = assetNames("${version}");
    expect(code).toContain(`"$RUNNER_TEMP/release-build/${names.package}"`);
    expect(code).toContain(`"$RUNNER_TEMP/release-build/${names.dmg}"`);
  });

  it("is kept long enough to sign a release when it suits", () => {
    expect(Number(/retention-days: (\d+)/.exec(upload)?.[1])).toBeGreaterThanOrEqual(14);
  });
});

describe("before the build", () => {
  it("fails in seconds on a tag that does not match the app, or has no changelog section", () => {
    expect(code).toContain("Check the tag matches the app version");
    expect(code).toContain('node scripts/public-docs.mjs notes CHANGELOG.md "$TAG"');
    const steps = stepsOf(jobs.macos).map(withoutComments);
    const cheap = steps.findIndex((step) => step.includes("public-docs.mjs notes"));
    const build = steps.findIndex((step) => step.includes("tauri-apps/tauri-action"));
    expect(cheap).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(cheap);
  });

  it("is named release.yml, which scripts/release-github.mjs looks the run up by", () => {
    expect(readFileSync(join(ROOT, "scripts/release-github.mjs"), "utf8")).toContain('"release.yml"');
  });
});

// macOS keys a folder or App Management grant to the app's bundle identifier and checks the code requirement stored
// with it against the bundle on disk. An unsealed bundle (the linker's signature on the executable alone) never
// matches, so the prompts come back. Signing the whole bundle ad-hoc seals it under the bundle identifier. The Tauri
// bundler reads `APPLE_SIGNING_IDENTITY` before this setting (tauri-cli `interface/rust.rs`), so a real identity,
// once the workflow exports one, still wins.
describe("the app's code signature", () => {
  const config = JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8"));

  it("is an ad-hoc signature of the whole bundle unless a real identity is given", () => {
    expect(config.bundle.macOS.signingIdentity).toBe("-");
  });

  it("keeps the hardened runtime on, which notarizing needs once a real identity is used", () => {
    expect(config.bundle.macOS.hardenedRuntime ?? true).toBe(true);
  });

  it("is signed under the bundle identifier, which TCC keys its grants by", () => {
    expect(config.identifier).toBe("xyz.zorvo.desktop");
  });

  it("gets a real identity from APPLE_SIGNING_IDENTITY only when that secret is set", () => {
    expect(code).toContain("APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}");
    expect(code).toContain('if [ -n "$value" ]; then');
  });
});

describe("pinning", () => {
  it("pins every action to a commit", () => {
    const uses = [...code.matchAll(/^\s*(?:- )?uses: (\S+)/gm)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) expect(use).toMatch(/@[0-9a-f]{40}$/);
  });
});
