import { describe, expect, it } from "vitest";
import { fileLinkPath, fileLinkTarget } from "../lib/file-links";

describe("fileLinkPath", () => {
  it("reads a path as the agent wrote it, without its line or a file:// prefix", () => {
    expect(fileLinkPath("src/App.tsx")).toBe("src/App.tsx");
    expect(fileLinkPath("./src/App.tsx:42")).toBe("./src/App.tsx");
    expect(fileLinkPath("src/App.tsx:42:7")).toBe("src/App.tsx");
    expect(fileLinkPath("src/App.tsx#L12-L20")).toBe("src/App.tsx");
    expect(fileLinkPath("/Users/me/.codex/hooks.json")).toBe("/Users/me/.codex/hooks.json");
    expect(fileLinkPath("~/notes/plan.md")).toBe("~/notes/plan.md");
    expect(fileLinkPath("file:///Users/me/My%20Notes/a.md")).toBe("/Users/me/My Notes/a.md");
    expect(fileLinkPath("docs/a%20b.md?plain=1")).toBe("docs/a b.md");
  });

  it("reads a file in the folder itself with its line, which looks like a scheme", () => {
    expect(fileLinkPath("README.md:12")).toBe("README.md");
    expect(fileLinkPath("package.json:5:3")).toBe("package.json");
    // A scheme is followed by more than a line number.
    expect(fileLinkPath("vscode:12abc")).toBeNull();
    expect(fileLinkPath("tel:5550100")).toBeNull();
  });

  it("is not a file link for another scheme, an anchor, nothing, or a control character", () => {
    for (const href of [undefined, "", "   ", "#section", "https://example.com/a.md", "mailto:me@example.com", "vscode://file/a", "javascript:alert(1)", "file://server-without-path", "a\nb.md", "a%00b.md"]) {
      expect(fileLinkPath(href), String(href)).toBeNull();
    }
  });

  it("keeps a percent sign that is not an escape", () => {
    expect(fileLinkPath("reports/100%.md")).toBe("reports/100%.md");
  });
});

describe("fileLinkTarget", () => {
  const folder = "/Users/me/project";

  it("opens a file inside the folder in the viewer, by its path relative to the folder", () => {
    expect(fileLinkTarget("src/App.tsx", folder)).toEqual({ kind: "view", relative: "src/App.tsx" });
    expect(fileLinkTarget("./src/../src/App.tsx", folder)).toEqual({ kind: "view", relative: "src/App.tsx" });
    expect(fileLinkTarget("/Users/me/project/docs/a.md", folder)).toEqual({ kind: "view", relative: "docs/a.md" });
    expect(fileLinkTarget("docs/a.md", "/Users/me/project/")).toEqual({ kind: "view", relative: "docs/a.md" });
  });

  it("shows a file outside the folder in the file manager, by its whole path", () => {
    expect(fileLinkTarget("/Users/me/.codex/hooks.json", folder)).toEqual({ kind: "reveal", path: "/Users/me/.codex/hooks.json" });
    expect(fileLinkTarget("../other/a.md", folder)).toEqual({ kind: "reveal", path: "/Users/me/other/a.md" });
    // A folder whose name only starts the same is another folder.
    expect(fileLinkTarget("/Users/me/project-two/a.md", folder)).toEqual({ kind: "reveal", path: "/Users/me/project-two/a.md" });
    // The folder itself is not a file to view.
    expect(fileLinkTarget("/Users/me/project", folder)).toEqual({ kind: "reveal", path: "/Users/me/project" });
    expect(fileLinkTarget("~/notes/plan.md", folder)).toEqual({ kind: "reveal", path: "~/notes/plan.md" });
    expect(fileLinkTarget("/etc/hosts", undefined)).toEqual({ kind: "reveal", path: "/etc/hosts" });
  });

  it("shows a folder in the file manager, since the viewer reads files only", () => {
    expect(fileLinkTarget("src/hooks/", folder)).toEqual({ kind: "reveal", path: "/Users/me/project/src/hooks" });
    expect(fileLinkTarget("/Users/me/project/docs/", folder)).toEqual({ kind: "reveal", path: "/Users/me/project/docs" });
  });

  it("cannot place a relative path without a folder", () => {
    expect(fileLinkTarget("src/App.tsx", undefined)).toEqual({ kind: "unknown" });
  });
});
