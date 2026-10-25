import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { publicChangelog, sectionsOf } from "./public-docs.mjs";

const PRIVATE = "https://github.com/zakyirsyaad/zorvo";
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

[Unreleased]: ${PRIVATE}/compare/v0.5.0...HEAD
[0.5.0]: ${PRIVATE}/compare/v0.4.1...v0.5.0
[0.4.1]: ${PRIVATE}/compare/v0.4.0...v0.4.1
[#85]: ${PRIVATE}/pull/85
[#90]: ${PRIVATE}/pull/90
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

  it("drops links into the private repository and keeps their text", () => {
    expect(out).not.toContain(PRIVATE + "/");
    expect(out).toContain("(#85)");
    expect(out).not.toContain("[#85]");
  });

  it("keeps links to public pages", () => {
    expect(out).toContain("[ACP]: https://agentclientprotocol.com");
  });
});

describe("the public user guide", () => {
  const readme = sectionsOf(readFileSync(join(ROOT, "README.md"), "utf8"));
  const guide = sectionsOf(readFileSync(join(ROOT, "docs/releases-repo/README.md"), "utf8"));

  it.each(["Highlights", "Supported agents", "Requirements", "Getting started", "Privacy and your data", "Troubleshooting"])(
    "repeats the README's %s section word for word",
    (name) => {
      expect(guide.get(name)).toBeDefined();
      expect(guide.get(name)).toBe(readme.get(name));
    },
  );

  it("repeats the README's Install section, linking the public releases", () => {
    const install = readme.get("Install")?.replace(`${PRIVATE}-releases/releases/latest`, "RELEASES");
    expect(guide.get("Install")?.replace(`${PRIVATE}-releases/releases/latest`, "RELEASES")).toBe(install);
  });

  it("links nothing in the private repository", () => {
    expect([...guide.values()].join("\n")).not.toMatch(new RegExp(`${PRIVATE}[/#)]`));
  });
});
