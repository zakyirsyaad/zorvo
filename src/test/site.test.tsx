import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "../../site/app/page";
import DocsHome from "../../site/app/docs/page";
import AgentsDocs from "../../site/app/docs/agents/page";
import CompareDocs from "../../site/app/docs/compare/page";
import InstallDocs from "../../site/app/docs/install/page";
import PrivacyDocs from "../../site/app/docs/privacy/page";
import QuickstartDocs from "../../site/app/docs/quickstart/page";
import ReviewDocs from "../../site/app/docs/review/page";
import SigningInDocs from "../../site/app/docs/signing-in/page";
import TerminalDocs from "../../site/app/docs/terminal/page";
import TroubleshootingDocs from "../../site/app/docs/troubleshooting/page";
import { DOCS_PAGES } from "../../site/lib/docs-nav";
import { LINKS } from "../../site/lib/links";
import robots from "../../site/app/robots";
import sitemap from "../../site/app/sitemap";
import { OG_COLORS } from "../../site/lib/og-colors";
import { siteUrl } from "../../site/lib/site";
import NotFound from "../../site/app/not-found";

const ROOT = join(__dirname, "..", "..");
const appCss = readFileSync(join(ROOT, "src", "styles", "globals.css"), "utf8");
const siteCss = readFileSync(join(ROOT, "site", "app", "globals.css"), "utf8");

/** The text between the braces that follow `opener`, or "". */
function blockAfter(css: string, opener: string): string {
  const start = css.indexOf(opener);
  if (start === -1) return "";
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  return "";
}

/** `--<prefix>-<name>: <value>;` declarations in a block, values without spaces. */
function declarations(block: string, prefix: string): Map<string, string> {
  const pattern = new RegExp(`--${prefix}-([\\w-]+):\\s*([^;]+);`, "g");
  return new Map(
    [...block.matchAll(pattern)]
      .filter(([, name]) => name !== "*")
      .map(([, name, value]) => [name, value.replace(/\s+/g, "")]),
  );
}

function themes(css: string) {
  const light = blockAfter(css, "@media (prefers-color-scheme: light)");
  return {
    darkColor: declarations(blockAfter(css, "@theme"), "color"),
    darkElevation: declarations(blockAfter(css, ":root"), "elevation"),
    lightColor: declarations(light, "color"),
    lightElevation: declarations(light, "elevation"),
  };
}

describe("site tokens", () => {
  const app = themes(appCss);
  const site = themes(siteCss);

  it.each(["darkColor", "darkElevation", "lightColor", "lightElevation"] as const)(
    "match the app's %s values",
    (key) => {
      expect(app[key].size).toBeGreaterThan(0);
      for (const [name, value] of app[key]) {
        expect(site[key].get(name), name).toBe(value);
      }
    },
  );

  it("draws the Open Graph image in the dark theme's colors", () => {
    for (const [name, value] of Object.entries(OG_COLORS)) {
      expect(site.darkColor.get(name), name).toBe(value);
    }
  });

  it("adds only terminal tokens of its own, which stay dark in both themes", () => {
    const extra = [...site.darkColor.keys()].filter((name) => !app.darkColor.has(name));
    expect(extra.every((name) => name.startsWith("terminal-"))).toBe(true);
    expect(extra.filter((name) => site.lightColor.has(name))).toEqual([]);
  });

  it("loads no web fonts from a CDN", () => {
    expect(siteCss).not.toMatch(/fonts\.googleapis|fonts\.gstatic|@import\s+url\(/);
  });
});

describe("landing page", () => {
  const html = renderToStaticMarkup(<Home />);
  const document = new DOMParser().parseFromString(html, "text/html");
  const text = document.body.textContent ?? "";
  // The page's own words, without the code and chat inside its pictures of the app.
  const copy = (() => {
    const body = document.body.cloneNode(true) as HTMLElement;
    body.querySelectorAll('[role="img"]').forEach((picture) => picture.remove());
    return body.textContent ?? "";
  })();

  it("has the eight approved sections in order, and no pricing", () => {
    const ids = [...document.querySelectorAll("main > section[id], main > div > section[id]")].map(
      (section) => section.id,
    );
    expect(ids).toEqual(["top", "agents", "compare", "control", "review", "features", "privacy", "download"]);
    expect(text).not.toMatch(/pricing|per month|\$\d+\s*\/\s*mo/i);
  });

  it("has one h1, and every section is labelled by its heading", () => {
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    for (const section of document.querySelectorAll("section")) {
      const label = section.getAttribute("aria-labelledby");
      expect(label && document.getElementById(label)?.textContent, section.id).toBeTruthy();
    }
  });

  it("follows the copy rules: no exclamation marks, emoji or banned words", () => {
    expect(copy).not.toContain("!");
    expect(text).not.toMatch(/\p{Emoji_Presentation}/u);
    expect(copy).not.toMatch(/\b(seamless(ly)?|unlock|empower|simply|AI-powered)\b/i);
  });

  it("names every agent and says it is not endorsed by them", () => {
    for (const agent of ["Claude Code", "Codex", "Qwen Code"]) {
      expect(text).toContain(agent);
    }
    expect(text).toContain("not endorsed by them");
  });

  it("gives every image alt text, and every picture a description", () => {
    for (const image of document.querySelectorAll("img")) {
      expect(image.hasAttribute("alt")).toBe(true);
    }
    for (const picture of document.querySelectorAll('[role="img"]')) {
      expect(picture.getAttribute("aria-label")).toBeTruthy();
    }
  });

  it("keeps the pictures inert: no links or buttons inside them", () => {
    expect(document.querySelectorAll('[role="img"] :is(a, button, input, textarea, select)')).toHaveLength(0);
  });

  it("gives every link the focus ring and a real destination", () => {
    const links = [...document.querySelectorAll("a")];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const href = link.getAttribute("href") ?? "";
      expect(link.className, href).toContain("focus-ring");
      expect(href, link.textContent ?? "").toMatch(/^(#[a-z]+|\/docs(\/[a-z-]+)?|https:\/\/github\.com\/zakyirsyaad\/zorvo\b)/);
    }
  });

  it("links the docs and the source from the header and says agents come from the ACP registry", () => {
    const header = document.querySelector("header")!;
    expect([...header.querySelectorAll("a")].map((link) => link.textContent)).toContain("Docs");
    expect(header.querySelector(`a[href="${LINKS.repository}"]`)?.textContent).toBe("GitHub");
    expect(document.querySelector(`footer a[href="${LINKS.license}"]`)).not.toBeNull();
    expect(document.querySelector(`#compare a[href="${LINKS.compareGuide}"]`)).not.toBeNull();
    expect(document.querySelector(`#review a[href="${LINKS.reviewGuide}"]`)).not.toBeNull();
    expect(copy).toContain("ACP registry");
    expect(copy).not.toMatch(/Aider|Oh-My-Pi/);
  });

  it("lists the twelve features in order and the registry's three agent states", () => {
    const features = [...document.querySelectorAll("#features ul > li h3")].map((title) => title.textContent);
    expect(features).toEqual([
      "The agent's own data",
      "Every choice the agent offers",
      "Install agents from Zorvo",
      "See which agents are ready",
      "One welcome screen",
      "A sidebar that says who waits",
      "One inspector",
      "Read a file in place",
      "Branches and worktrees",
      "Fork and rewind",
      "When a turn goes wrong",
      "Zorvo updates itself",
    ]);
    expect(copy).toContain("Install agents from Zorvo");
    expect(copy).not.toMatch(/drawer/i);
    const registry = document.querySelector('#agents [role="img"]');
    expect(registry?.textContent).toMatch(/Update available.*Installing….*In the registry/s);
  });

  it("draws the 0.9 window in the hero picture, and says the app updates itself", () => {
    const hero = document.querySelector('#top ~ div [role="img"]');
    expect(hero?.textContent).toMatch(/Claude Code · Working.*Codex · Waiting for you.*Compare · 3 agents/s);
    expect(hero?.textContent).toMatch(/Changes\s*3\s*Activity\s*Files\s*Terminal/);
    expect(hero?.textContent).toContain("38% of context");
    expect(copy).toContain("Zorvo updates itself");
    expect(copy).toContain("keeps itself up to date");
    expect(copy).toContain("a mode that skips approvals carries a shield");
  });

  it("shows the plan with one step done and the permission the agent waits on", () => {
    const picture = document.querySelector('#control [role="img"]');
    expect(picture?.textContent).toMatch(/Plan from Codex\s*1 of 4 done/);
    expect(picture?.textContent).toMatch(/Deny\s*Always allow\s*Allow once/);
    expect(picture?.textContent).not.toContain("Session cost");
  });

  it("shows a compare run that asks before Pick keeps one agent", () => {
    const picture = document.querySelector('#compare [role="img"]');
    expect(picture?.textContent).toContain("Start 3 sessions");
    expect(picture?.textContent).toMatch(/Claude Code\s*Working.*Codex\s*Finished.*Qwen Code\s*Waiting for you/s);
    expect(picture?.textContent).toContain("Pick Codex");
    expect(copy).toContain("uses its own quota");
  });

  it("shows a review comment that stays on its line and goes into the message", () => {
    const picture = document.querySelector('#review [role="img"]');
    expect(picture?.textContent).toContain("Line 42 · Current");
    expect(picture?.textContent).toContain("Add 2 comments to message");
    expect(copy).toContain("Outdated");
  });

  it("points every in-page link at an element that exists", () => {
    for (const link of document.querySelectorAll('a[href^="#"]')) {
      const id = link.getAttribute("href")!.slice(1);
      expect(document.getElementById(id), `#${id}`).not.toBeNull();
    }
  });
});

describe("search engines", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends the 404 page's section links back to the home page", () => {
    const page = new DOMParser().parseFromString(renderToStaticMarkup(<NotFound />), "text/html");
    const anchors = [...page.querySelectorAll("a")].map((link) => link.getAttribute("href") ?? "").filter((href) => href.includes("#"));
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.every((href) => href.startsWith("/#"))).toBe(true);
  });

  it("refuses to build for production without an address, rather than publish localhost links", () => {
    expect(() => siteUrl({ NODE_ENV: "production" })).toThrow(/SITE_URL/);
    expect(siteUrl({ NODE_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "zorvo.xyz" }).href).toBe("https://zorvo.xyz/");
  });

  it("keeps a sub-path in SITE_URL for the sitemap", () => {
    vi.stubEnv("SITE_URL", "https://example.github.io/zorvo");
    expect(siteUrl().href).toBe("https://example.github.io/zorvo/");
    expect(robots().sitemap).toBe("https://example.github.io/zorvo/sitemap.xml");
    expect(sitemap()[0].url).toBe("https://example.github.io/zorvo/");
  });

  it("takes the site's address from SITE_URL, then Vercel's production domain, then localhost", () => {
    expect(siteUrl({ SITE_URL: "https://zorvo.xyz", VERCEL_PROJECT_PRODUCTION_URL: "zorvo.vercel.app" }).href).toBe(
      "https://zorvo.xyz/",
    );
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "zorvo.vercel.app" }).href).toBe("https://zorvo.vercel.app/");
    expect(siteUrl({}).href).toBe("http://localhost:3100/");
  });

  it("lets crawlers in and points them at a sitemap of the page", () => {
    const base = siteUrl().href;
    expect(robots()).toMatchObject({ rules: { userAgent: "*", allow: "/" }, sitemap: `${base}sitemap.xml` });
    expect(sitemap().map((entry) => entry.url)).toEqual([base, ...DOCS_PAGES.map((page) => `${base}${page.href.slice(1)}/`)]);
  });

  it("describes Zorvo as a free macOS app in structured data", () => {
    const html = renderToStaticMarkup(<Home />);
    const json = new DOMParser()
      .parseFromString(html, "text/html")
      .querySelector('script[type="application/ld+json"]')?.textContent;
    expect(JSON.parse(json ?? "null")).toMatchObject({
      "@type": "SoftwareApplication",
      name: "Zorvo",
      operatingSystem: "macOS",
      offers: { price: "0" },
      isAccessibleForFree: true,
      publisher: { sameAs: [LINKS.repository] },
    });
  });
});

describe("docs pages", () => {
  const PAGES: Record<string, () => React.JSX.Element> = {
    "/docs": DocsHome,
    "/docs/install": InstallDocs,
    "/docs/quickstart": QuickstartDocs,
    "/docs/agents": AgentsDocs,
    "/docs/signing-in": SigningInDocs,
    "/docs/compare": CompareDocs,
    "/docs/review": ReviewDocs,
    "/docs/terminal": TerminalDocs,
    "/docs/privacy": PrivacyDocs,
    "/docs/troubleshooting": TroubleshootingDocs,
  };
  const parse = (href: string) =>
    new DOMParser().parseFromString(renderToStaticMarkup(PAGES[href]()), "text/html");
  /** The anchors on a docs page, with the fragment each internal link points at. */
  const idsOf = (href: string) => new Set([...parse(href).querySelectorAll("[id]")].map((el) => el.id));

  it("has a page for every entry in the docs list, and the list for every page", () => {
    expect(Object.keys(PAGES).sort()).toEqual(DOCS_PAGES.map((page) => page.href).sort());
  });

  it("points the landing page's docs links at the new pages and keeps downloads on the public releases repository", () => {
    expect(LINKS.docs).toBe("/docs");
    expect(LINKS.installGuide).toBe("/docs/install");
    expect(LINKS.agentsGuide).toBe("/docs/agents");
    expect(LINKS.download).toBe("https://github.com/zakyirsyaad/zorvo/releases/latest/download/Zorvo-mac.dmg");
  });

  for (const href of Object.keys(PAGES)) {
    describe(href, () => {
      const document = parse(href);
      const text = document.body.textContent ?? "";

      it("has one h1, a skip link target and a current page in the sidebar", () => {
        expect(document.querySelectorAll("h1")).toHaveLength(1);
        expect(document.getElementById("main")).not.toBeNull();
        expect(document.querySelector(`nav[aria-label="Docs"] a[aria-current="page"]`)?.getAttribute("href")).toBe(href);
      });

      it("resolves every in-page and internal link", () => {
        for (const link of document.querySelectorAll("a")) {
          const target = link.getAttribute("href") ?? "";
          if (target.startsWith("https://")) continue;
          const [path, hash] = target.split("#");
          const page = path === "" ? href : path;
          expect(Object.keys(PAGES).concat("/"), target).toContain(page);
          if (hash) expect(page === "/" ? new Set<string>() : idsOf(page), target).toContain(hash);
        }
      });

      it("gives every link the focus ring, sends nothing to other sites and ships no search field", () => {
        for (const link of document.querySelectorAll("a")) {
          expect(link.className, link.getAttribute("href") ?? "").toContain("focus-ring");
        }
        expect(document.querySelectorAll('input, script:not([type="application/ld+json"])')).toHaveLength(0);
        const data = JSON.parse(document.querySelector('script[type="application/ld+json"]')?.textContent ?? "[]");
        const trail = data.find((entry: { "@type": string }) => entry["@type"] === "BreadcrumbList");
        expect(trail.itemListElement.at(-1).item).toBe(new URL(`${href.slice(1)}/`, siteUrl()).href);
        expect(text).not.toMatch(/Aider|Oh-My-Pi|pricing|per month/i);
        expect(text).not.toContain("!");
        expect(text).not.toMatch(/\p{Emoji_Presentation}/u);
      });

      it("gives every image alt text and every picture a description", () => {
        for (const image of document.querySelectorAll("img")) expect(image.hasAttribute("alt")).toBe(true);
        for (const picture of document.querySelectorAll('[role="img"]')) {
          expect(picture.getAttribute("aria-label")).toBeTruthy();
          expect(picture.querySelectorAll("a, button, input")).toHaveLength(0);
        }
      });
    });
  }

  it("covers the 0.5.0 stuck-agent notice in troubleshooting", () => {
    const text = parse("/docs/troubleshooting").body.textContent ?? "";
    expect(text).toContain("An agent seems stuck");
    expect(text).toContain("sent nothing for a minute");
  });

  it("links the recent additions to sections that exist", () => {
    const links = [...parse("/docs").querySelectorAll('section[aria-labelledby="recent"] ul a')].map((a) => a.getAttribute("href"));
    expect(links).toEqual([
      "/docs/signing-in#status",
      "/docs/install#requirements",
      "/docs/quickstart#composer",
      "/docs/install#update",
    ]);
  });

  it("documents the 0.6 to 0.9 additions where the design puts them", () => {
    const install = parse("/docs/install").body.textContent ?? "";
    expect(install).toContain("Update Zorvo");
    expect(install).toContain("Older copies update once by hand");
    expect(install).toContain("Settings, GitHub");
    expect(parse("/docs/install").querySelector("#update ~ [role=img]")?.textContent).toContain("Restarting stops 2 agents mid-turn");
    expect(idsOf("/docs/install")).toContain("update");

    const agents = parse("/docs/agents");
    expect(agents.body.textContent).toContain("One way to run each agent");
    expect(agents.querySelector('[role="img"]')?.textContent).toContain("Not available (2)");
    expect(idsOf("/docs/agents")).toContain("not-available");

    const signingIn = parse("/docs/signing-in");
    expect(signingIn.querySelector("#status ~ [role=img]")?.textContent).toMatch(
      /Claude CodeSign in.*CodexReady.*Qwen CodeNot checked/s,
    );

    const troubleshooting = idsOf("/docs/troubleshooting");
    for (const id of ["failed", "gemini", "update"]) expect(troubleshooting).toContain(id);

    const quickstart = parse("/docs/quickstart");
    expect(quickstart.body.textContent).toContain("Rewind to here");
    expect(idsOf("/docs/quickstart")).toContain("composer");
    expect(quickstart.body.textContent).toContain("The welcome screen");

    expect(parse("/docs/terminal").body.textContent).toContain("Inspector");
    expect(parse("/docs/compare").body.textContent).toContain("Pick always asks first");
    expect(parse("/docs/review").body.textContent).toContain("Outdated");
    for (const href of Object.keys(PAGES)) {
      expect(parse(href).body.textContent, href).not.toMatch(/drawer|detected agents|Settings, General, GitHub/i);
    }
  });

  it("names the default agents and says they do not endorse Zorvo", () => {
    const text = parse("/docs/agents").body.textContent ?? "";
    for (const agent of ["Claude Code", "Codex", "Qwen Code"]) expect(text).toContain(agent);
    expect(text).toContain("not endorsed by them");
  });
});
