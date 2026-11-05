import { describe, expect, it } from "vitest";
import { formatSize, languageOf, parseFileContent, splitLines } from "../lib/file-content";

describe("splitLines", () => {
  it("splits on LF and CRLF without a phantom last line", () => {
    expect(splitLines("a\r\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
    expect(splitLines("")).toEqual([]);
    expect(splitLines("\n")).toEqual([""]);
    expect(splitLines("a\n\n")).toEqual(["a", ""]);
  });
});

describe("parseFileContent", () => {
  it("accepts the three shapes the backend sends", () => {
    expect(parseFileContent({ kind: "text", text: "x", size: 1 })).toEqual({ kind: "text", text: "x", size: 1 });
    expect(parseFileContent({ kind: "binary", size: 2 })).toEqual({ kind: "binary", size: 2 });
    expect(parseFileContent({ kind: "tooLarge", size: 3, limit: 2 })).toEqual({ kind: "tooLarge", size: 3, limit: 2 });
  });

  it("refuses anything else", () => {
    expect(() => parseFileContent({ kind: "text" })).toThrow();
    expect(() => parseFileContent({ kind: "image", size: 1 })).toThrow();
    expect(() => parseFileContent(null)).toThrow();
  });
});

describe("languageOf", () => {
  it("names a language from the extension, with its fence", () => {
    expect(languageOf("src/App.tsx")).toEqual({ name: "TypeScript", fence: "tsx" });
    expect(languageOf("src-tauri/src/files.rs")).toEqual({ name: "Rust", fence: "rust" });
    expect(languageOf("README.md").name).toBe("Markdown");
    expect(languageOf("Makefile")).toEqual({ name: "Plain text", fence: "" });
    expect(languageOf(".env").name).toBe("Plain text");
  });
});

describe("formatSize", () => {
  it("says a size in KB or MB", () => {
    expect(formatSize(2048)).toBe("2 KB");
    expect(formatSize(1_048_576)).toBe("1 MB");
    expect(formatSize(1_572_864)).toBe("1.5 MB");
    expect(formatSize(300)).toBe("300 bytes");
  });
});
