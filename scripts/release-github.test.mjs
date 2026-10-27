import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReleaseError } from "./release-checks.mjs";
import { assetUrl, downloadBuild, draftState, ensureDraft, findRun, gitBlobSha, remoteTagCommit, syncDocs, uploadAssets, uploadFile } from "./release-github.mjs";

const REPO = "zakyirsyaad/zorvo-releases";
const TAG = "v0.6.1";

/** A stand-in for `gh`: records each call, and answers with the first handler whose pattern matches the arguments. */
function fakeGh(handlers = []) {
  const calls = [];
  const gh = (args, options = {}) => {
    const line = args.join(" ");
    calls.push({ args, line, input: options.input });
    for (const [pattern, answer] of handlers) {
      if (pattern.test(line)) return { status: 0, stdout: "", stderr: "", ...(typeof answer === "function" ? answer(args, options) : answer) };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  gh.calls = calls;
  gh.lines = () => calls.map((call) => call.line);
  return gh;
}

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zorvo-release-github-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("findRun", () => {
  const runs = [
    { databaseId: 3, headSha: "cccc", event: "workflow_dispatch", createdAt: "2026-10-27T03:00:00Z" },
    { databaseId: 2, headSha: "bbbb", event: "push", createdAt: "2026-10-27T02:00:00Z" },
    { databaseId: 1, headSha: "aaaa", event: "push", createdAt: "2026-10-27T01:00:00Z" },
  ];

  it("takes the newest successful run the tag started", () => {
    const gh = fakeGh([[/^run list/, { stdout: JSON.stringify(runs) }]]);
    expect(findRun(gh, { repo: "zakyirsyaad/zorvo", tag: TAG })).toEqual({ id: 2, headSha: "bbbb" });
    expect(gh.lines()[0]).toBe("run list --repo zakyirsyaad/zorvo --workflow release.yml --branch v0.6.1 --status success --limit 10 --json databaseId,headSha,event,createdAt");
  });

  it("fails telling what to do when no run succeeded", () => {
    const gh = fakeGh([[/^run list/, { stdout: "[]" }]]);
    expect(() => findRun(gh, { repo: "zakyirsyaad/zorvo", tag: TAG })).toThrow(/No successful Release run for v0\.6\.1/);
  });

  it("fails with what gh said when it cannot list", () => {
    const gh = fakeGh([[/^run list/, { status: 1, stderr: "HTTP 401: Bad credentials\n" }]]);
    expect(() => findRun(gh, { repo: "zakyirsyaad/zorvo", tag: TAG })).toThrow(/HTTP 401: Bad credentials/);
  });
});

describe("remoteTagCommit", () => {
  it("asks GitHub which commit the tag is, by its qualified name", () => {
    const gh = fakeGh([[/^api repos/, { stdout: "551460d6d7b57f20b6d910ec7c278761606aa3a2\n" }]]);
    expect(remoteTagCommit(gh, { repo: "zakyirsyaad/zorvo", tag: TAG })).toBe("551460d6d7b57f20b6d910ec7c278761606aa3a2");
    expect(gh.lines()).toEqual(["api repos/zakyirsyaad/zorvo/commits/refs/tags/v0.6.1 --jq .sha"]);
  });

  it("fails naming the tag when GitHub does not have it", () => {
    const gh = fakeGh([[/^api repos/, { status: 1, stderr: "No commit found for SHA: refs/tags/v0.6.1 (HTTP 422)\n" }]]);
    expect(() => remoteTagCommit(gh, { repo: "zakyirsyaad/zorvo", tag: TAG })).toThrow(/the tag v0\.6\.1 on GitHub failed.*No commit found/s);
  });
});

describe("downloadBuild", () => {
  it("downloads the build artifact of the run", () => {
    const gh = fakeGh();
    downloadBuild(gh, { repo: "zakyirsyaad/zorvo", runId: 2, dir: "/tmp/x" });
    expect(gh.lines()).toEqual(["run download 2 --repo zakyirsyaad/zorvo --name release-build --dir /tmp/x"]);
  });

  it("fails naming the run when the artifact is gone", () => {
    const gh = fakeGh([[/^run download/, { status: 1, stderr: "no artifact matches any of the names or patterns provided\n" }]]);
    expect(() => downloadBuild(gh, { repo: "zakyirsyaad/zorvo", runId: 2, dir: "/tmp/x" })).toThrow(/run 2.*no artifact matches/s);
  });
});

describe("draftState", () => {
  const view = (answer) => fakeGh([[/^release view/, answer]]);

  it.each([
    ["none", { status: 1, stderr: "release not found\n" }],
    ["draft", { stdout: "true\n" }],
    ["published", { stdout: "false\n" }],
  ])("reads %s", (state, answer) => {
    expect(draftState(view(answer), { repo: REPO, tag: TAG })).toBe(state);
  });

  it("does not take an API error for a missing release, which would make a second draft", () => {
    expect(() => draftState(view({ status: 1, stderr: "HTTP 502: Bad Gateway\n" }), { repo: REPO, tag: TAG })).toThrow(/HTTP 502/);
  });
});

describe("ensureDraft", () => {
  const options = { repo: REPO, tag: TAG, notesFile: "/tmp/notes.md", prerelease: false };
  const stateIs = (answer) => fakeGh([[/^release view/, answer]]);

  it("creates a draft aimed at main when there is no release", () => {
    const gh = stateIs({ status: 1, stderr: "release not found" });
    ensureDraft(gh, options);
    expect(gh.lines()[1]).toBe("release create v0.6.1 --repo zakyirsyaad/zorvo-releases --draft --target main --title Zorvo v0.6.1 --notes-file /tmp/notes.md");
  });

  it("marks a draft for a tag with a pre-release part", () => {
    const gh = stateIs({ status: 1, stderr: "release not found" });
    ensureDraft(gh, { ...options, tag: "v0.7.0-rc.1", prerelease: true });
    expect(gh.lines()[1]).toMatch(/--notes-file \/tmp\/notes\.md --prerelease$/);
  });

  it("fills a draft that is already there, again, instead of making a second one", () => {
    const gh = stateIs({ stdout: "true\n" });
    ensureDraft(gh, { ...options, prerelease: true });
    expect(gh.lines()[1]).toBe("release edit v0.6.1 --repo zakyirsyaad/zorvo-releases --title Zorvo v0.6.1 --notes-file /tmp/notes.md --prerelease=true");
    expect(gh.lines().some((line) => line.startsWith("release create"))).toBe(false);
  });

  it("refuses a release that is already published", () => {
    const gh = stateIs({ stdout: "false\n" });
    expect(() => ensureDraft(gh, options)).toThrow(/already published.*Tag a new version/s);
    expect(gh.lines()).toHaveLength(1);
  });
});

describe("uploadAssets", () => {
  const files = ["/tmp/u/a.tar.gz", "/tmp/u/a.tar.gz.sig", "/tmp/u/a.dmg"];

  it("uploads every file, replacing the ones that are there", () => {
    const gh = fakeGh([[/--json assets/, { stdout: JSON.stringify({ assets: [{ name: "a.dmg" }] }) }]]);
    uploadAssets(gh, { repo: REPO, tag: TAG, files });
    expect(gh.lines().at(-1)).toBe(`release upload v0.6.1 --repo ${REPO} --clobber ${files.join(" ")}`);
  });

  it("removes a latest.json left by an earlier try, which names a package this upload replaces", () => {
    const gh = fakeGh([[/--json assets/, { stdout: JSON.stringify({ assets: [{ name: "latest.json" }] }) }]]);
    uploadAssets(gh, { repo: REPO, tag: TAG, files });
    expect(gh.lines()).toEqual([
      `release view v0.6.1 --repo ${REPO} --json assets`,
      `release delete-asset v0.6.1 latest.json --repo ${REPO} --yes`,
      `release upload v0.6.1 --repo ${REPO} --clobber ${files.join(" ")}`,
    ]);
  });
});

describe("assetUrl and uploadFile", () => {
  it("gives the asset's API URL, which latest.json names", () => {
    const assets = [{ name: "a.dmg", apiUrl: "https://api.github.com/repos/x/y/releases/assets/1" }, { name: "a.tar.gz", apiUrl: "https://api.github.com/repos/x/y/releases/assets/2" }];
    const gh = fakeGh([[/--json assets/, { stdout: JSON.stringify({ assets }) }]]);
    expect(assetUrl(gh, { repo: REPO, tag: TAG, name: "a.tar.gz" })).toBe("https://api.github.com/repos/x/y/releases/assets/2");
  });

  it("fails when the upload left no such asset", () => {
    const gh = fakeGh([[/--json assets/, { stdout: JSON.stringify({ assets: [] }) }]]);
    expect(() => assetUrl(gh, { repo: REPO, tag: TAG, name: "a.tar.gz" })).toThrow(/no a\.tar\.gz asset/);
  });

  it("uploads one file over what is there", () => {
    const gh = fakeGh();
    uploadFile(gh, { repo: REPO, tag: TAG, file: "/tmp/u/latest.json" });
    expect(gh.lines()).toEqual([`release upload v0.6.1 /tmp/u/latest.json --repo ${REPO} --clobber`]);
  });
});

describe("gitBlobSha", () => {
  it("is the hash git gives a file, which the contents API reports as sha", () => {
    expect(gitBlobSha(Buffer.from("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
    expect(gitBlobSha(Buffer.alloc(0))).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });
});

describe("syncDocs", () => {
  function file(name, content) {
    const path = join(dir, name);
    writeFileSync(path, content);
    return { src: path, dest: `docs/${name}`, content: Buffer.from(content) };
  }
  const putOf = (gh) => gh.calls.filter((call) => call.line.includes("--method PUT"));

  it("writes a file the repository does not have, as a JSON body", () => {
    const readme = file("README.md", "# Zorvo\n");
    const gh = fakeGh([[/^api repos\/.*\/contents\/.* --jq \.sha$/, { status: 1, stderr: "HTTP 404" }]]);
    syncDocs(gh, { repo: REPO, tag: TAG, files: [readme] });
    const [put] = putOf(gh);
    expect(put.args).toEqual(["api", "--method", "PUT", `repos/${REPO}/contents/docs/README.md`, "--input", "-", "--silent"]);
    const body = JSON.parse(put.input);
    expect(body).toEqual({ message: "docs: update docs/README.md for v0.6.1", content: Buffer.from("# Zorvo\n").toString("base64"), branch: "main" });
  });

  it("sends the sha of a file that changed", () => {
    const readme = file("README.md", "new text\n");
    const gh = fakeGh([[/^api repos\/.*\/contents\/.* --jq \.sha$/, { stdout: "abc123\n" }]]);
    syncDocs(gh, { repo: REPO, tag: TAG, files: [readme] });
    expect(JSON.parse(putOf(gh)[0].input).sha).toBe("abc123");
  });

  it("leaves a file alone when the repository already has the same bytes", () => {
    const readme = file("README.md", "same\n");
    const gh = fakeGh([[/--jq \.sha$/, { stdout: `${gitBlobSha(readme.content)}\n` }]]);
    syncDocs(gh, { repo: REPO, tag: TAG, files: [readme] });
    expect(putOf(gh)).toHaveLength(0);
  });

  it("sends a file too big for one command-line argument without trouble", () => {
    const big = file("big.bin", "x".repeat(300_000));
    const gh = fakeGh([[/--jq \.sha$/, { status: 1 }]]);
    syncDocs(gh, { repo: REPO, tag: TAG, files: [big] });
    expect(JSON.parse(putOf(gh)[0].input).content).toBe(Buffer.from("x".repeat(300_000)).toString("base64"));
    expect(putOf(gh)[0].line.length).toBeLessThan(200);
  });

  it("fails with what gh said when a write is refused", () => {
    const readme = file("README.md", "x\n");
    const gh = fakeGh([[/--method PUT/, { status: 1, stderr: "HTTP 422: sha wasn't supplied\n" }], [/--jq \.sha$/, { status: 1 }]]);
    expect(() => syncDocs(gh, { repo: REPO, tag: TAG, files: [readme] })).toThrow(ReleaseError);
    expect(() => syncDocs(gh, { repo: REPO, tag: TAG, files: [readme] })).toThrow(/HTTP 422/);
  });
});
