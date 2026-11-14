import { describe, expect, it } from "vitest";
import { MOTION_SCRIPT, scriptsOf, stripPage, stripRuntime } from "./strip-runtime.mjs";

const MOTION_TAG = `<script src="${MOTION_SCRIPT}" defer=""></script>`;

const PAGE = [
  "<html><head>",
  '<link rel="stylesheet" href="/_next/static/chunks/a.css"/>',
  '<link rel="preload" as="script" fetchPriority="low" href="/_next/static/chunks/b.js"/>',
  '<link rel="preload" href="/_next/static/media/logo.svg" as="image"/>',
  '<script src="/_next/static/chunks/c.js" async=""></script>',
  '<script id="_R_">(globalThis["TURBOPACK"] || []).push({})</script>',
  "</head><body><h1>Zorvo</h1>",
  '<script type="application/ld+json">{"@type":"SoftwareApplication"}</script>',
  MOTION_TAG,
  "<script>self.__next_f.push([1,\"<b>\"])</script>",
  "</body></html>",
].join("");

describe("stripRuntime", () => {
  const html = stripRuntime(PAGE);

  it("removes React's scripts, inline or not, and the script preloads, and keeps only the motion script", () => {
    expect(scriptsOf(html)).toHaveLength(2); // the structured data and the motion script
    expect(html).not.toContain("b.js");
    expect(html).not.toContain("c.js");
    expect(html).not.toContain("__next_f");
    expect(html).not.toContain("TURBOPACK");
    expect(html).toContain(MOTION_TAG);
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

describe("the motion script", () => {
  it("is kept only as that exact address with no inline code", () => {
    const page = (tag) => stripRuntime(`<body>${tag}</body>`);
    expect(page(`<script src="/motion.js" defer></script>`)).toContain('src="/motion.js"');
    // Anything else that looks like it goes: another address, another host, a module, a script with a body.
    for (const tag of [
      '<script src="/motion.js?v=2"></script>',
      '<script src="/other.js"></script>',
      '<script src="https://cdn.example.com/motion.js"></script>',
      '<script src="//evil.example/motion.js"></script>',
      '<script src="/motion.js" type="module"></script>',
      '<script src="/motion.js">alert(1)</script>',
      "<script>alert(1)</script>",
    ]) {
      expect(scriptsOf(page(tag)), tag).toEqual([]);
    }
  });

  it("is reported by scriptsOf, so the build can fail on any other script that survives", () => {
    expect(scriptsOf(PAGE).filter((script) => !script.isKept)).toHaveLength(3);
    expect(scriptsOf(stripRuntime(PAGE)).every((script) => script.isKept)).toBe(true);
  });
});
