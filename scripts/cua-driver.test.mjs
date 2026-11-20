// @vitest-environment node
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MINIMUM,
  archiveUrl,
  compareVersions,
  fetchDriver,
  parseReleaseLines,
  pickDriverRelease,
  sha256OfFile,
} from "./cua-driver.mjs";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-30T12:00:00Z");
const release = (version, daysAgo, extra = {}) => ({
  tag_name: `cua-driver-rs-v${version}`,
  published_at: new Date(NOW - daysAgo * DAY).toISOString(),
  draft: false,
  prerelease: false,
  ...extra,
});

describe("compareVersions", () => {
  it("orders by number, not by text", () => {
    expect(compareVersions("0.52.13", "0.52.2")).toBeGreaterThan(0);
    expect(compareVersions("0.52.1", "0.52.1")).toBe(0);
    expect(compareVersions("0.45.4", "0.52.1")).toBeLessThan(0);
  });
});

describe("pickDriverRelease", () => {
  it("update_skips_releases_younger_than_7_days", () => {
    const picked = pickDriverRelease([release("0.56.0", 1), release("0.55.0", 6), release("0.52.13", 13)], NOW);
    expect(picked).toEqual({ version: "0.52.13", released: "2026-11-17" });
  });

  it("update_skips_releases_below_the_minimum", () => {
    expect(pickDriverRelease([release("0.52.0", 15), release("0.45.4", 30)], NOW)).toBeNull();
    expect(pickDriverRelease([release("0.52.1", 15), release("0.45.4", 30)], NOW)?.version).toBe("0.52.1");
  });

  it("takes the highest version, and ignores nightlies, drafts and other products", () => {
    const releases = [
      release("0.52.4", 14),
      release("0.52.13", 13),
      { ...release("0.60.0", 20), tag_name: "nightly-cua-driver-rs-v0.60.0-nightly.1" },
      { ...release("0.61.0", 20), tag_name: "cua-spaces-v0.61.0" },
      release("0.62.0", 20, { draft: true }),
      release("0.63.0-rc.1", 20),
    ];
    expect(pickDriverRelease(releases, NOW)?.version).toBe("0.52.13");
  });
});

describe("parseReleaseLines", () => {
  it("reads one release per line, across pages", () => {
    const pages = `${JSON.stringify(release("0.52.13", 13))}\n${JSON.stringify(release("0.52.4", 14))}\n\n`;
    expect(pickDriverRelease(parseReleaseLines(pages), NOW)?.version).toBe("0.52.13");
    expect(parseReleaseLines("")).toEqual([]);
  });
});

describe("fetchDriver", () => {
  let dir;
  let archive;
  let pin;
  const download = vi.fn(async (_url, toPath) => copyFileSync(archive, toPath));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cua-driver-test-"));
    const source = join(dir, "source");
    mkdirSync(source);
    writeFileSync(join(source, "cua-driver"), "#!/bin/sh\necho driver\n");
    writeFileSync(join(source, "libcua_driver_sdk.dylib"), "not taken");
    archive = join(dir, "archive.tar.gz");
    execFileSync("/usr/bin/tar", ["-czf", archive, "-C", source, "cua-driver", "libcua_driver_sdk.dylib"]);
    pin = {
      version: "0.52.13",
      released: "2026-11-17",
      url: archiveUrl("0.52.13"),
      sha256: sha256OfFile(archive),
      size: statSync(archive).size,
      file: { path: "cua-driver", sha256: sha256OfFile(join(source, "cua-driver")) },
      team: "YCK386LBJ7",
      minimum: MINIMUM,
    };
    download.mockClear();
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const dest = () => join(dir, "binaries", "cua-driver");

  it("takes_only_the_pinned_file", async () => {
    expect(await fetchDriver({ pin, dest: dest(), download })).toBe("fetched");
    expect(readFileSync(dest(), "utf8")).toContain("echo driver");
    expect(statSync(dest()).mode & 0o777).toBe(0o755);
    expect(existsSync(join(dir, "binaries", "libcua_driver_sdk.dylib"))).toBe(false);
    expect(download).toHaveBeenCalledWith(pin.url, expect.any(String));
  });

  it("refuses_an_archive_with_the_wrong_hash", async () => {
    const wrong = { ...pin, sha256: "0".repeat(64) };
    await expect(fetchDriver({ pin: wrong, dest: dest(), download })).rejects.toThrow(/archive's SHA-256/);
    expect(existsSync(dest())).toBe(false);
  });

  it("refuses an archive of another size", async () => {
    await expect(fetchDriver({ pin: { ...pin, size: pin.size + 1 }, dest: dest(), download })).rejects.toThrow(/bytes/);
    expect(existsSync(dest())).toBe(false);
  });

  it("refuses_an_extracted_file_with_the_wrong_hash", async () => {
    const wrong = { ...pin, file: { ...pin.file, sha256: "1".repeat(64) } };
    await expect(fetchDriver({ pin: wrong, dest: dest(), download })).rejects.toThrow(/driver's SHA-256/);
    expect(existsSync(dest())).toBe(false);
  });

  it("skips_the_download_when_the_file_is_already_right", async () => {
    await fetchDriver({ pin, dest: dest(), download });
    download.mockClear();
    expect(await fetchDriver({ pin, dest: dest(), download })).toBe("kept");
    expect(download).not.toHaveBeenCalled();
  });

  it("fetches again when the file in place is not the pinned one", async () => {
    mkdirSync(join(dir, "binaries"));
    writeFileSync(dest(), "an older driver");
    expect(await fetchDriver({ pin, dest: dest(), download })).toBe("fetched");
    expect(readFileSync(dest(), "utf8")).toContain("echo driver");
  });

  it("fetch_refuses_a_pin_below_the_minimum", async () => {
    const old = { ...pin, version: "0.45.4", url: archiveUrl("0.45.4") };
    await expect(fetchDriver({ pin: old, dest: dest(), download })).rejects.toThrow(/older than 0\.52\.1/);
    expect(download).not.toHaveBeenCalled();
  });

  it("refuses a pin whose url or file is not the driver's own", async () => {
    const elsewhere = { ...pin, url: "https://example.com/cua-driver.tar.gz" };
    await expect(fetchDriver({ pin: elsewhere, dest: dest(), download })).rejects.toThrow(/url/);
    const other = { ...pin, file: { ...pin.file, path: "../cua-driver" } };
    await expect(fetchDriver({ pin: other, dest: dest(), download })).rejects.toThrow(/must take cua-driver/);
    expect(download).not.toHaveBeenCalled();
  });
});
