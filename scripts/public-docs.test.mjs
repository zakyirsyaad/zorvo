import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { publicChangelog, releaseNotes } from "./public-docs.mjs";

const SOURCE = "https://github.com/zakyirsyaad/zorvo";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const changelog = `# Changelog

All notable changes to Zorvo.

## [Unreleased]

### Added

- **A secret plan.** Not shipped yet ([#90]).

## [0.5.0] - 2026-10-25

### Added

- **A notice when an agent seems stuck** ([#85]).

## [0.4.1] - 2026-10-24

- **The drawer scrolls.**

[Unreleased]: ${SOURCE}/compare/v0.5.0...HEAD
[0.5.0]: ${SOURCE}/compare/v0.4.1...v0.5.0
[0.4.1]: ${SOURCE}/compare/v0.4.0...v0.4.1
[#85]: ${SOURCE}/pull/85
[#90]: ${SOURCE}/pull/90
[ACP]: https://agentclientprotocol.com
`;

describe("publicChangelog", () => {
  const out = publicChangelog(changelog);

  it("leaves out the Unreleased section, which is not public yet", () => {
    expect(out).not.toContain("Unreleased");
    expect(out).not.toContain("A secret plan");
  });

  it("keeps every released version with its notes", () => {
    expect(out).toContain("## 0.5.0 - 2026-10-25");
    expect(out).toContain("## 0.4.1 - 2026-10-24");
    expect(out).toContain("A notice when an agent seems stuck");
  });

  it("drops references into the source repository and keeps their text", () => {
    expect(out).not.toContain(SOURCE + "/");
    expect(out).toContain("(#85)");
    expect(out).not.toContain("[#85]");
  });

  it("keeps links to public pages", () => {
    expect(out).toContain("[ACP]: https://agentclientprotocol.com");
  });
});

describe("releaseNotes", () => {
  it("gives a version's public notes, without its heading", () => {
    const notes = releaseNotes(changelog, "v0.5.0");
    expect(notes).toContain("### Added");
    expect(notes).toContain("**A notice when an agent seems stuck** (#85)");
    expect(notes).not.toContain("## 0.5.0");
    expect(notes).not.toContain("The drawer scrolls");
    expect(notes).not.toContain(SOURCE + "/");
  });

  it("accepts the version with or without its leading v", () => {
    expect(releaseNotes(changelog, "0.4.1")).toBe(releaseNotes(changelog, "v0.4.1"));
  });

  it("keeps the public links its notes use, which the changelog defines at its end", () => {
    const withPublicLink = changelog.replace("- **The drawer scrolls.**", "- **The drawer scrolls**, as the [ACP] spec allows.");
    const notes = releaseNotes(withPublicLink, "v0.4.1");
    expect(notes).toContain("[ACP]: https://agentclientprotocol.com");
    expect(releaseNotes(withPublicLink, "v0.5.0")).not.toContain("[ACP]:");
  });

  it("gives nothing for a version the changelog does not list", () => {
    expect(releaseNotes(changelog, "v9.9.9")).toBe("");
  });
});

/** GitHub's anchor for a heading: lower case, punctuation dropped, spaces to dashes. */
function anchorOf(heading) {
  return heading.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-");
}

describe("the public user guide", () => {
  const guide = readFileSync(join(ROOT, "README.md"), "utf8");
  const anchors = new Set([...guide.matchAll(/^#{2,3} (.+)$/gm)].map((m) => anchorOf(m[1])));

  // The release notes, the issue forms and SECURITY.md link these.
  it.each(["install", "supported-agents", "troubleshooting", "check-your-download", "open-zorvo-the-first-time"])(
    "keeps the #%s section others link to",
    (anchor) => {
      expect(anchors.has(anchor)).toBe(true);
    },
  );

  it("links only to sections it has", () => {
    for (const [, anchor] of guide.matchAll(/\]\(#([a-z0-9-]+)\)/g)) {
      expect(anchors.has(anchor), anchor).toBe(true);
    }
  });
});
