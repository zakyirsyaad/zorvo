import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assetUrl, downloadBuild, draftState, ensureDraft, findRun, remoteTagCommit, uploadAssets, uploadFile } from "./release-github.mjs";

const REPO = "zakyirsyaad/zorvo";
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

  describe("when the connection breaks", () => {
    const RESET = "error writing zip archive: read tcp 192.168.1.5:50123->20.205.243.166:443: read: connection reset by peer\n";
    /** A `gh run download` that answers with each of `answers` in turn (the last one again after that). */
    function flakyGh(answers) {
      let attempt = 0;
      return fakeGh([[/^run download/, () => answers[Math.min(attempt++, answers.length - 1)]]]);
    }
    const download = (gh) => {
      const pauses = [];
      const messages = [];
      const options = { repo: "zakyirsyaad/zorvo", runId: 2, dir, sleep: (ms) => pauses.push(ms), log: (message) => messages.push(message) };
      return { run: () => downloadBuild(gh, options), pauses, messages };
    };

    it("tries again and succeeds on the second try, saying so", () => {
      const gh = flakyGh([{ status: 1, stderr: RESET }, { status: 0 }]);
      const { run, pauses, messages } = download(gh);
      run();
      expect(gh.calls).toHaveLength(2);
      expect(messages).toEqual(["Download failed (connection reset); trying again, 2 of 3..."]);
      expect(pauses).toHaveLength(1);
      expect(pauses[0]).toBeGreaterThan(0);
    });

    it("gives up after the third try with what the last try said", () => {
      const gh = flakyGh([
        { status: 1, stderr: RESET },
        { status: 1, stderr: 'Get "https://pipelines.actions.githubusercontent.com/x": net/http: TLS handshake timeout\n' },
        { status: 1, stderr: "error writing zip archive: unexpected EOF\n" },
      ]);
      const { run, pauses, messages } = download(gh);
      expect(run).toThrow(/Downloading the build of run 2 failed: error writing zip archive: unexpected EOF/);
      expect(gh.calls).toHaveLength(3);
      expect(messages).toEqual(["Download failed (connection reset); trying again, 2 of 3...", "Download failed (timeout); trying again, 3 of 3..."]);
      expect(pauses).toHaveLength(2);
      expect(pauses[1]).toBeGreaterThan(pauses[0]);
    });

    it.each([
      ["a server error", "HTTP 502: Bad Gateway (https://api.github.com/repos/zakyirsyaad/zorvo/actions/artifacts/1/zip)\n"],
      ["an unexpected EOF", "error writing zip archive: unexpected EOF\n"],
      ["a timeout", 'Get "https://api.github.com/x": context deadline exceeded (Client.Timeout exceeded while awaiting headers)\n'],
    ])("counts %s as worth another try", (_name, stderr) => {
      const gh = flakyGh([{ status: 1, stderr }, { status: 0 }]);
      download(gh).run();
      expect(gh.calls).toHaveLength(2);
    });

    it.each([
      ["a missing artifact", "no artifact matches any of the names or patterns provided\n"],
      ["a refused login", "HTTP 401: Bad credentials (https://api.github.com/repos/zakyirsyaad/zorvo/actions/runs/2/artifacts)\n"],
      ["a missing repository", "HTTP 404: Not Found (https://api.github.com/repos/zakyirsyaad/zorvo/actions/runs/2/artifacts)\n"],
      ["a gh that cannot start", "Could not run gh: spawnSync gh ENOENT\n"],
    ])("does not try again after %s", (_name, stderr) => {
      const gh = flakyGh([{ status: 1, stderr }, { status: 0 }]);
      const { run, pauses, messages } = download(gh);
      expect(run).toThrow(/Downloading the build of run 2 failed/);
      expect(gh.calls).toHaveLength(1);
      expect(pauses).toEqual([]);
      expect(messages).toEqual([]);
    });

    it("empties the directory between tries, so a half-written file is not left behind", () => {
      const seen = [];
      const gh = fakeGh([
        [
          /^run download/,
          () => {
            seen.push(readdirSync(dir));
            if (seen.length > 1) return { status: 0 };
            writeFileSync(join(dir, "Zorvo-mac.dmg"), "half a dmg");
            return { status: 1, stderr: RESET };
          },
        ],
      ]);
      download(gh).run();
      expect(seen).toEqual([[], []]);
    });
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
    expect(gh.lines()[1]).toBe("release create v0.6.1 --repo zakyirsyaad/zorvo --draft --verify-tag --title Zorvo v0.6.1 --notes-file /tmp/notes.md");
  });

  it("marks a draft for a tag with a pre-release part", () => {
    const gh = stateIs({ status: 1, stderr: "release not found" });
    ensureDraft(gh, { ...options, tag: "v0.7.0-rc.1", prerelease: true });
    expect(gh.lines()[1]).toMatch(/--notes-file \/tmp\/notes\.md --prerelease$/);
  });

  it("fills a draft that is already there, again, instead of making a second one", () => {
    const gh = stateIs({ stdout: "true\n" });
    ensureDraft(gh, { ...options, prerelease: true });
    expect(gh.lines()[1]).toBe("release edit v0.6.1 --repo zakyirsyaad/zorvo --title Zorvo v0.6.1 --notes-file /tmp/notes.md --prerelease=true");
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
