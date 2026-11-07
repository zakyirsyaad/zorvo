import { describe, expect, it } from "vitest";
import { stripRuntime } from "./strip-runtime.mjs";

const PAGE = [
  "<html><head>",
  '<link rel="stylesheet" href="/_next/static/chunks/a.css"/>',
  '<link rel="preload" as="script" fetchPriority="low" href="/_next/static/chunks/b.js"/>',
  '<link rel="preload" href="/_next/static/media/logo.svg" as="image"/>',
  '<script src="/_next/static/chunks/c.js" async=""></script>',
  '<script id="_R_">(globalThis["TURBOPACK"] || []).push({})</script>',
  "</head><body><h1>Zorvo</h1>",
  '<script type="application/ld+json">{"@type":"SoftwareApplication"}</script>',
  "<script>self.__next_f.push([1,\"<b>\"])</script>",
  "</body></html>",
].join("");

describe("stripRuntime", () => {
  const html = stripRuntime(PAGE);

  it("removes every script, inline or not, and the script preloads", () => {
    expect(html).not.toMatch(/<script(?![^>]*application\/ld\+json)/);
    expect(html).not.toContain("b.js");
    expect(html).not.toContain("__next_f");
  });

  it("leaves no script behind when removing one would form another", () => {
    expect(stripRuntime('<p>a</p><scr<script>x</script>ipt src="/x.js"></script><p>b</p>')).toBe("<p>a</p><p>b</p>");
  });

  it("keeps the structured data, the stylesheet, image preloads and the content", () => {
    expect(html).toContain('<script type="application/ld+json">{"@type":"SoftwareApplication"}</script>');
    expect(html).toContain("a.css");
    expect(html).toContain("logo.svg");
    expect(html).toContain("<h1>Zorvo</h1>");
  });
});
