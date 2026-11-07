import { describe, expect, it } from "vitest";
import { stripPage, stripRuntime } from "./strip-runtime.mjs";

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

  it("removes scripts however they are written, and those inside a template", () => {
    const page = stripRuntime('<p>a</p><SCRIPT SRC="/x.js"></SCRIPT><template><script>y()</script></template><p>b</p>');
    expect(page.toLowerCase()).not.toContain("<script");
    expect(page).toContain("<p>a</p>");
    expect(page).toContain("<p>b</p>");
  });

  it("counts what it removed, and nothing on a page that has no runtime", () => {
    expect(stripPage(PAGE).removed).toBe(4); // the script preload, the src script, the bootstrap and the flight data
    expect(stripPage(stripRuntime(PAGE)).removed).toBe(0);
  });

  it("keeps the structured data, the stylesheet, image preloads and the content", () => {
    expect(html).toContain('<script type="application/ld+json">{"@type":"SoftwareApplication"}</script>');
    expect(html).toContain("a.css");
    expect(html).toContain("logo.svg");
    expect(html).toContain("<h1>Zorvo</h1>");
  });
});
