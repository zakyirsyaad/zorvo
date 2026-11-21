import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "../../site/app/page";
import DocsHome from "../../site/app/docs/page";
import AgentsDocs from "../../site/app/docs/agents/page";
import CompareDocs from "../../site/app/docs/compare/page";
import InstallDocs from "../../site/app/docs/install/page";
import PrivacyDocs from "../../site/app/docs/privacy/page";
import CreditsDocs from "../../site/app/docs/credits/page";
import QuickstartDocs from "../../site/app/docs/quickstart/page";
import ReviewDocs from "../../site/app/docs/review/page";
import SigningInDocs from "../../site/app/docs/signing-in/page";
import DelegateDocs from "../../site/app/docs/delegate/page";
import OutputDocs from "../../site/app/docs/output/page";
import TerminalDocs from "../../site/app/docs/terminal/page";
import TroubleshootingDocs from "../../site/app/docs/troubleshooting/page";
import { DOCS_PAGES } from "../../site/lib/docs-nav";
import { AGENT_LOGOS } from "../../site/lib/agent-logos";
import { DOWNLOADS_FALLBACK, downloadCount, formatCount } from "../../site/lib/downloads";
import { STRIP_AGENTS } from "../../site/lib/strip-agents";
import { Voices } from "../../site/components/sections/Voices";
import { LINKS } from "../../site/lib/links";
import robots from "../../site/app/robots";
import sitemap from "../../site/app/sitemap";
import { OG_COLORS } from "../../site/lib/og-colors";
import { OG_IMAGE, siteUrl } from "../../site/lib/site";
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

  it("has the fourteen sections in order, the paid extra after the free app, and no pricing", () => {
    const names = [...document.querySelectorAll("main > section")].map(
      (section) => section.id || section.getAttribute("aria-label"),
    );
    expect(names).toEqual([
      "top",
      "Agents",
      "community",
      "sessions",
      "compare",
      "delegate",
      "review",
      "output",
      "control",
      "Long sessions",
      "features",
      "private",
      "privacy",
      "download",
    ]);
    // A session called "Review the pricing copy" is in a picture; the page's own words name no price.
    expect(copy).not.toMatch(/pricing|per month/i);
    expect(text).not.toMatch(/\$\d/);
    expect(copy).toContain("Zorvo stays free");
    expect(copy).toContain("Credits pay for private sessions only.");
  });

  it("has one h1, and every section is labelled", () => {
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    for (const section of document.querySelectorAll("main > section")) {
      const label = section.getAttribute("aria-labelledby");
      const named = label ? document.getElementById(label)?.textContent : section.getAttribute("aria-label");
      expect(named, section.id).toBeTruthy();
    }
  });

  it("follows the copy rules: no exclamation marks, emoji or banned words", () => {
    expect(copy).not.toContain("!");
    expect(text).not.toMatch(/\p{Emoji_Presentation}/u);
    expect(copy).not.toMatch(/\b(seamless(ly)?|unlock|empower|simply|AI-powered)\b/i);
  });

  it("names every agent and says it is not endorsed by them", () => {
    for (const agent of ["Claude Code", "Codex", "Qwen Code", "Antigravity"]) {
      expect(text).toContain(agent);
    }
    expect(text).toContain("not endorsed by them");
    expect(text).not.toMatch(/Gemini/);
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
      expect(href, link.textContent ?? "").toMatch(/^(#[a-z]+|\/docs(\/[a-z-]+)?|https:\/\/github\.com\/zakyirsyaad\/zorvo\b|https:\/\/discord\.gg\/wX6SPqQu33$|https:\/\/x\.com\/zorvolabs(\/status\/\d+)?$|https:\/\/zorvolabs\.xyz$)/);
    }
  });

  it("centres the section links on the page, not between the logo and the buttons", () => {
    // In a flex row, auto margins centre the nav in the room left between a short logo and a wider
    // group of buttons, which puts it left of the page's middle. Three columns, 1fr auto 1fr, give
    // both sides the same width. jsdom has no layout, so this checks the classes that do it.
    const row = document.querySelector('header nav[aria-label="Sections"]')!.parentElement!;
    const classes = row.className.split(" ");
    expect(classes).toContain("min-[861px]:grid");
    expect(classes).toContain("min-[861px]:grid-cols-[1fr_auto_1fr]");
    expect(row.firstElementChild!.className.split(" ")).toContain("justify-self-start");
    expect(row.lastElementChild!.className.split(" ")).toContain("min-[861px]:justify-self-end");
  });

  it("links the docs and the source from the header and the guides from their sections", () => {
    const header = document.querySelector("header")!;
    expect([...header.querySelectorAll("a")].map((link) => link.textContent)).toContain("Docs");
    expect(header.querySelector(`a[href="${LINKS.repository}"]`)?.textContent).toBe("GitHub, opens in a new tab");
    expect(document.querySelector(`footer a[href="${LINKS.license}"]`)).not.toBeNull();
    expect(document.querySelector(`#compare a[href="${LINKS.compareGuide}"]`)).not.toBeNull();
    expect(document.querySelector(`#delegate a[href="${LINKS.delegateGuide}"]`)).not.toBeNull();
    expect(document.querySelector(`#review a[href="${LINKS.reviewGuide}"]`)).not.toBeNull();
    expect(document.querySelector(`#output a[href="${LINKS.outputGuide}"]`)).not.toBeNull();
    // The page says what Zorvo runs in plain words: the protocol's name is for the docs.
    expect(copy).toContain("dozens more coding agents");
    expect(copy).not.toMatch(/\bACP\b|Agent Client Protocol/);
    expect(copy).not.toMatch(/Aider|Oh-My-Pi/);
  });

  it("says Private mode is optional, with the NEAR AI mark at the approved sizes", () => {
    expect(document.querySelector("#top a")?.textContent).toContain("Optional private mode on NEAR AI Cloud");
    const logos = [...document.querySelectorAll('img[alt="NEAR AI"]')].map((image) => [
      image.getAttribute("src"),
      image.getAttribute("width"),
      image.closest("section")?.id,
    ]);
    expect(logos).toEqual([
      ["/near-ai-tile-white.svg", "32", "top"],
      ["/near-ai-wordmark-white.svg", "128", "private"],
    ]);
    // One section explains private mode: the path of an answer and the credits terms live in it.
    expect(document.querySelector("#private [data-flow]")).not.toBeNull();
    expect(document.querySelector(`#private a[href="${LINKS.credits}"]`)?.textContent).toContain("credits terms");
    // "No wallet" means none to connect; the checkout still takes USDC from any chain.
    expect(document.querySelector("#private")?.textContent).toContain("no wallet to connect");
    for (const file of ["near-ai-tile-white.svg", "near-ai-wordmark-white.svg"]) {
      const svg = readFileSync(join(ROOT, "site", "public", file), "utf8");
      expect(svg, file).toMatch(/^<svg /);
      expect(svg, file).not.toMatch(/<script|on\w+=|<foreignObject|href=/i);
    }
    expect(document.querySelector("#privacy")?.textContent).toContain("Private mode is the one exception");
  });

  it("shows the four main agents by their own logos, in the design's tile", () => {
    const tiles = [...document.querySelectorAll(".lp-logo")];
    // A tile with a mask holds a registry icon; the others hold one of the four colour logos.
    const agentTiles = tiles.filter((tile) => !tile.querySelector(".lp-mark"));
    expect(agentTiles).toHaveLength(33);
    for (const tile of agentTiles) {
      expect(tile.getAttribute("aria-hidden"), tile.outerHTML).toBe("true");
      expect(tile.textContent, "no letter stands for the agent any more").toBe("");
      expect(tile.querySelectorAll('img[alt=""]')).toHaveLength(1);
    }
    const logos = new Set(agentTiles.map((tile) => tile.querySelector("img")?.getAttribute("src")));
    expect(logos).toEqual(new Set(Object.values(AGENT_LOGOS)));
  });

  it("names only agents the registry lists in the strip, each with an icon", () => {
    const history = JSON.parse(readFileSync(join(ROOT, "src-tauri", "resources", "registry-history.json"), "utf8")).agents;
    const icons = JSON.parse(readFileSync(join(ROOT, "src-tauri", "resources", "registry-icons.json"), "utf8"));
    for (const agent of STRIP_AGENTS) {
      expect(history[agent.id], agent.id).toBeDefined();
      if (!agent.logo) expect(icons[agent.id], agent.id).toMatch(/<svg[\s>]/);
    }
    const [shown, filler] = [...document.querySelectorAll('section[aria-label="Agents"] .lp-track > ul')];
    expect([...shown.querySelectorAll("li")].map((item) => item.textContent)).toEqual(STRIP_AGENTS.map((agent) => agent.name));
    // The second list only fills the loop.
    expect(shown.hasAttribute("aria-hidden")).toBe(false);
    expect(filler.getAttribute("aria-hidden")).toBe("true");
    expect(filler.querySelectorAll("li")).toHaveLength(STRIP_AGENTS.length);
    const masks = [...shown.querySelectorAll<HTMLElement>(".lp-mark")].map((mark) => mark.style.getPropertyValue("--lp-mark"));
    expect(masks).toEqual(STRIP_AGENTS.filter((agent) => !agent.logo).map((agent) => `url(/agents/${agent.id}.svg)`));
  });

  it("stops the moving strip under the pointer, keeps it still under reduced motion, and draws no line around it", () => {
    const css = readFileSync(join(ROOT, "site", "app", "landing.css"), "utf8");
    expect(css).toContain(".lp-mq:hover .lp-track { animation-play-state: paused; }");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s+\.lp-mq \{ mask-image: none; \}\s+\.lp-track \{ animation: none;/);
    // The owner chose a strip with no Pause control and no rules above or below it.
    const strip = document.querySelector('section[aria-label="Agents"]')!;
    expect(strip.querySelectorAll("input, button, label")).toHaveLength(0);
    expect(strip.className).not.toMatch(/border|bg-/);
    expect(document.querySelector("#community")?.className.split(" ")).toContain("border-t-0");
  });

  it("puts the download count on the hero's button and in the Download section", () => {
    const count = formatCount(DOWNLOADS_FALLBACK);
    const button = document.querySelector("#top [data-downloads]")?.closest("a");
    expect(button?.textContent).toBe(`Download for Mac${count}`);
    expect(button?.getAttribute("aria-label")).toBe(`Download for Mac. Downloaded ${count} times.`);
    expect(document.querySelector("#download [data-downloads]")?.parentElement?.textContent).toBe(`${count} downloads`);
    // A count that is missing, broken, or lower than the last one read is not shown.
    expect(downloadCount(undefined)).toBe(DOWNLOADS_FALLBACK);
    expect(downloadCount("12")).toBe(DOWNLOADS_FALLBACK);
    expect(downloadCount("abc")).toBe(DOWNLOADS_FALLBACK);
    expect(downloadCount("1480")).toBe(1480);
    expect(formatCount(1480)).toBe("1,480");
  });

  it("shows Zorvo's launch post as a card that loads nothing from X", () => {
    const card = document.querySelector("#community [data-tweet]")!;
    expect(card.textContent).toContain("Every coding agent. One desktop.");
    expect(card.textContent).toContain("Claude Code, Codex, Qwen Code and 40 more");
    expect(card.querySelector("time")?.getAttribute("datetime")).toBe("2026-11-14");
    expect(card.querySelector("time")?.textContent).toBe("14 Nov 2026");
    // A copy of the post: no picture, video or script comes from X.
    expect(card.querySelectorAll("img, video, iframe, script")).toHaveLength(0);
    // The card as a whole leads to the profile: the name's link is stretched over it, and it lifts on hover.
    expect(card.querySelector("a.lp-tweet-main")?.getAttribute("href")).toBe("https://x.com/zorvolabs");
    expect(card.hasAttribute("data-hover")).toBe(true);
    const css = readFileSync(join(ROOT, "site", "app", "landing.css"), "utf8");
    expect(css).toContain('.lp-tweet-main::after { content: ""; position: absolute; inset: 0;');
    expect([...card.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "https://x.com/zorvolabs",
      "https://x.com/zorvolabs/status/2121583312947007728",
      "https://zorvolabs.xyz",
      "https://x.com/zorvolabs/status/2121583312947007728",
    ]);
    const places = [...document.querySelectorAll("#community ul a")].map((link) => link.getAttribute("href"));
    expect(places).toEqual([LINKS.discord, LINKS.x, LINKS.repository]);
  });

  it("uncovers the footer instead of scrolling it in", () => {
    const footer = document.querySelector("footer[data-foot]")!;
    expect(footer.className.split(" ")).toContain("overflow-hidden");
    expect(footer.querySelector(":scope > [data-foot-inner]")).not.toBeNull();
    const script = readFileSync(join(ROOT, "site", "scripts", "motion", "landing.ts"), "utf8");
    expect(script).toMatch(/"\[data-foot-inner\]",\s+\{ yPercent: footStart \},\s+\{ yPercent: 0, ease: "none", scrollTrigger: \{ trigger: foot, start: "top bottom", end: "bottom bottom", scrub: true, invalidateOnRefresh: true \} \}/);
    // Held at the bottom of the window, a footer taller than the window would hide its own top for good.
    expect(script).toContain("const footStart = () => (foot.offsetHeight <= window.innerHeight ? -100 : 0);");
  });

  it("shows no voices section without real quotes, and lays out the ones it is given", () => {
    expect(document.querySelector("#voices")).toBeNull();
    const voices = ["one", "two", "three", "four"].map((word) => ({ quote: `Quote ${word}.`, name: `Name ${word}`, role: "Role", source: "Discord" }));
    const section = new DOMParser().parseFromString(renderToStaticMarkup(<Voices voices={voices} />), "text/html");
    expect([...section.querySelectorAll("blockquote")].map((quote) => quote.textContent)).toEqual(voices.map((voice) => voice.quote));
    expect(section.querySelector("figure")?.className).toContain("bg-fg");
    expect(section.querySelectorAll("figcaption")).toHaveLength(4);
  });

  it("keeps the long-session numbers, ending at their final values", () => {
    const stats = document.querySelector('[aria-label="Long sessions"]')!;
    expect(stats.textContent).toContain("9 MB");
    expect(stats.textContent).toContain("down from 43 MB");
    expect(stats.textContent).toContain("263");
    expect(stats.textContent).toContain("down from 42,099");
    const counted = [...stats.querySelectorAll("[data-count]")].map((el) => [el.getAttribute("data-from"), el.getAttribute("data-count")]);
    expect(counted).toEqual([["43", "9"], ["42099", "263"], [null, "4"]]);
  });

  it("lists the twelve features in order", () => {
    const features = [...document.querySelectorAll("#features ul > li h3")].map((title) => title.textContent);
    expect(features).toEqual([
      "Every choice the agent offers",
      "Install agents from Zorvo",
      "See which agents are ready",
      "One inspector beside the chat",
      "A browser beside the chat",
      "A session overview",
      "Pull requests in the sidebar",
      "Follow a subagent",
      "See what fills the context",
      "Read a file in place",
      "Fork and rewind",
      "When a turn goes wrong",
    ]);
    const numbers = [...document.querySelectorAll("#features ul > li > span")].map((number) => number.textContent);
    expect(numbers).toEqual(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]);
  });

  it("draws the window with the delegated session, and a compare run that asks before Pick", () => {
    const hero = document.querySelector("#top [data-win]");
    expect(hero?.textContent).toContain("Qwen Code · delegated");
    expect(hero?.textContent).toContain("38% of context");
    // Since 0.14.0 the branch is in the session's overview card, not the top bar, and a session
    // with a pull request shows its number in the sidebar.
    expect(hero?.querySelector(".lp-tb")?.textContent).not.toContain("main");
    expect(hero?.textContent).toMatch(/Environment.*main.*acme-shop.*Running.*pnpm test auth/s);
    expect(hero?.textContent).toContain("#128 open");
    const compare = document.querySelector("#compare [role=img]");
    expect(compare?.textContent).toContain("Start 3 sessions");
    expect(compare?.textContent).toContain("Pick Claude Code");
  });

  it("groups the section links under Product, with Docs beside them and three icon links", () => {
    const header = document.querySelector("header")!;
    const nav = header.querySelector('nav[aria-label="Sections"]')!;
    expect([...nav.children].map((item) => `${item.tagName.toLowerCase()}:${item.querySelector("button")?.textContent ?? item.textContent}`)).toEqual([
      "div:Product",
      "a:Private mode",
      "a:Privacy",
      "a:Docs",
    ]);
    // The menu sits inside its item, so CSS can open it under the pointer or on focus, with a transition.
    const item = nav.querySelector("[data-menu]")!;
    const button = item.querySelector("button")!;
    expect(button.getAttribute("aria-controls")).toBe("product-menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const menu = item.querySelector("#product-menu")!;
    expect(menu.hasAttribute("popover")).toBe(false);
    const css = readFileSync(join(ROOT, "site", "app", "landing.css"), "utf8");
    expect(css).toContain(".lp-nav-item:not([data-shut]):is(:hover, :focus-within, [data-open]) > .lp-menu { opacity: 1; visibility: visible;");
    expect(blockAfter(css, ".lp-menu {")).toMatch(/transition: opacity 160ms/);
    expect([...menu.querySelectorAll("a")].map((link) => [link.querySelector("b")?.textContent, link.getAttribute("href")])).toEqual([
      ["Compare", "#compare"],
      ["Delegate", "#delegate"],
      ["Review", "#review"],
      ["Output", "#output"],
      ["Control", "#control"],
      ["All features", "#features"],
    ]);
    // Icons only, each named for a screen reader.
    const icons = [...header.querySelectorAll(".lp-wrap a.lp-icon-link")].map((link) => [link.textContent, link.getAttribute("href")]);
    expect(icons).toEqual([
      ["Discord, opens in a new tab", LINKS.discord],
      ["X, opens in a new tab", LINKS.x],
      ["GitHub, opens in a new tab", LINKS.repository],
    ]);
    // Every link that leaves for Discord or X opens a new tab, without handing the new page a way back.
    for (const link of document.querySelectorAll('a[href^="https://discord.gg"], a[href^="https://x.com"], a.lp-icon-link[href^="https://github.com"]')) {
      expect(link.getAttribute("target"), link.outerHTML.slice(0, 80)).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
    expect(LINKS.discord).toBe("https://discord.gg/wX6SPqQu33");
    expect(LINKS.x).toBe("https://x.com/zorvolabs");
  });

  it("gives a phone a menu with every link the wide header has", () => {
    const header = document.querySelector("header")!;
    const opener = header.querySelector('button[popovertarget="site-menu"]')!;
    expect(opener.textContent).toBe("Menu");
    const sheet = header.querySelector("#site-menu")!;
    expect([...sheet.querySelectorAll("a")].map((link) => link.textContent)).toEqual([
      "Compare", "Delegate", "Review", "Output", "Control", "All features", "Private mode", "Privacy", "Docs",
      "Discord, opens in a new tab", "X, opens in a new tab", "GitHub, opens in a new tab",
    ]);
    // The script closes a menu when one of its links is followed.
    const script = readFileSync(join(ROOT, "site", "scripts", "motion", "landing.ts"), "utf8");
    expect(script).toMatch(/function boot\(\) \{\s+wireMenus\(\);/);
  });

  it("sends the footer's Privacy to its docs page, and links the credits terms", () => {
    const footerPrivacy = [...document.querySelectorAll("footer a")].find((link) => link.textContent === "Privacy");
    expect(footerPrivacy?.getAttribute("href")).toBe(LINKS.privacyGuide);
    expect(document.querySelector(`footer a[href="${LINKS.credits}"]`)).not.toBeNull();
  });

  it("says the build is signed and notarized, and nowhere that it is not", () => {
    // Zorvo is signed with a Developer ID and notarized since 0.14.1.
    for (const id of ["top", "download"]) {
      expect(document.getElementById(id)?.textContent, id).toMatch(/Signed with a Developer ID and\s+notarized by Apple/);
    }
    expect(text).not.toMatch(/not signed|Open Anyway/i);
  });

  it("does not claim the user approves every step, since an agent can be always allowed", () => {
    expect(document.querySelector("#control-title")?.textContent).toBe("You decide what an agent may do.");
    expect(document.querySelector("#control")?.textContent).toContain("Always allow");
  });

  it("ends the delegate scene with the answered card and the report alone, as the app does", () => {
    // The card's buttons and the working lines are moments the scene passes through, hidden by CSS.
    for (const hook of ["[data-dlg-status]", "[data-dlg-ask]"]) {
      expect(document.querySelector(hook)?.className.split(" "), hook).toContain("lp-brief");
    }
    for (const hook of ["[data-dlg-report]", "[data-dlg-allowed]"]) {
      expect(document.querySelector(hook)?.className, hook).not.toContain("lp-brief");
    }
  });

  it("shows an agent starting two workers with the app's own words", () => {
    const scene = document.querySelector("#delegate [role=img]");
    // The card's title, headings and buttons as src/lib/agent-tool-card.ts writes them.
    expect(scene?.querySelector("[data-dlg-card]")?.textContent).toMatch(
      /Claude Code wants to give other agents 2 tasks.*For Codex:.*For Qwen Code, in its own worktree:.*Deny.*Allow for this session/s,
    );
    // The report as the chat shows it: the heading, then each worker's handle, agent and state.
    expect(scene?.querySelector("[data-dlg-report]")?.textContent).toMatch(
      /Worker reports.*worker-1.*Codex.*Succeeded.*worker-2.*Qwen Code.*Succeeded/s,
    );
    expect(document.querySelector("#delegate")?.textContent).toContain("Type @ in the message box");
  });

  it("shows a canvas in the Output tab with a numbered comment, and says what a page can reach", () => {
    const scene = document.querySelector("#output [role=img]");
    expect([...scene!.querySelectorAll("[data-out-board] > .lp-sub")].map((label) => label.textContent)).toEqual([
      "Cart",
      "Payment A",
      "Payment B",
    ]);
    expect(scene?.textContent).toMatch(/Checkout redesign.*3 artboards.*Open/s);
    expect(scene?.textContent).toMatch(/Pick.*Build this/s);
    // The number on the artboard is the number in the list under it.
    expect(scene?.querySelector("[data-out-pick]")?.textContent).toContain("Total1");
    expect(scene?.querySelector("[data-out-comment]")?.textContent).toMatch(/^1Payment B · Current/);
    expect(scene?.querySelector("[data-out-bar]")?.textContent).toBe("Add 1 to message");
    const section = document.querySelector("#output")?.textContent ?? "";
    expect(section).toContain("It cannot call Zorvo or read your files");
    expect(document.querySelector("#control")?.textContent).toContain("for now it can only look at them");
  });

  it("points every in-page link at an element that exists", () => {
    for (const link of document.querySelectorAll('a[href^="#"]')) {
      const id = link.getAttribute("href")!.slice(1);
      expect(document.getElementById(id), `#${id}`).not.toBeNull();
    }
  });

  describe("motion", () => {
    const script = readFileSync(join(ROOT, "site", "scripts", "motion", "landing.ts"), "utf8");

    it("ships the motion script and the structured data, and no other script", () => {
      const scripts = [...document.querySelectorAll("script")].map((el) => el.getAttribute("src") ?? el.getAttribute("type"));
      expect(scripts.sort()).toEqual(["/motion.js", "application/ld+json"]);
    });

    it("does nothing under reduced motion", () => {
      expect(script).toContain("(prefers-reduced-motion: reduce)");
    });

    it("scrolls smoothly through GSAP's ScrollSmoother, over the two wrappers the page gives it", () => {
      expect(document.querySelector("#smooth-wrapper > #smooth-content > main#main")).not.toBeNull();
      expect(document.querySelector("#smooth-content > header")).not.toBeNull();
      expect(document.querySelector("#smooth-content > footer")).not.toBeNull();
      expect(script).toContain('ScrollSmoother.create({ wrapper: "#smooth-wrapper", content: "#smooth-content", smooth: 1, smoothTouch: false })');
      // Created only after the reduced-motion check, and undone with the rest of the motion.
      expect(script.indexOf("ScrollSmoother.create")).toBeGreaterThan(script.indexOf("function start("));
      expect(script).toContain("smoother?.kill();");
    });

    it("loops in one place only, the agents strip", () => {
      // Dots and the cursor stop on their own, so nothing else needs a pause control.
      expect(script).not.toMatch(/repeat:\s*-1/);
      const css = readFileSync(join(ROOT, "site", "app", "landing.css"), "utf8");
      expect(css.match(/\binfinite\b/g)).toHaveLength(1);
      expect(css).toContain(".lp-track { display: flex; gap: 12px; width: max-content; animation: lp-mq 90s linear infinite; }");
    });

    it("finds every hook it animates in the page", () => {
      const selectors = new Set([...script.matchAll(/["'`]((?:\[data-[\w-]+\]|\.lp-[\w-]+)[^"'`]*)["'`]/g)].map((match) => match[1]));
      expect(selectors.size).toBeGreaterThan(30);
      for (const selector of selectors) {
        expect(document.querySelector(selector.replace(/ \[data-count\]| path| i$/, "")), selector).not.toBeNull();
      }
    });

    it("never lets GSAP and Motion animate the same element", () => {
      const gsapHooks = [
        "[data-hero-fade]", "[data-win]", "[data-srow]", "[data-chat]", "[data-cmp-prompt]", "[data-cmp-type]", "[data-cmp-chip]",
        "[data-cmp-start]", "[data-cmp-card]", "[data-cmp-confirm]", "[data-dlg-pane]", "[data-dlg-card]", "[data-dlg-ask]",
        "[data-dlg-allow]", "[data-dlg-allowed]", "[data-dlg-status]", "[data-dlg-dot]", "[data-dlg-b]",
        "[data-dlg-report]", "[data-foot-inner]", "[data-out-pane]", "[data-out-board]", "[data-out-pick]", "[data-out-mark]", "[data-out-comment]",
        "[data-out-bar]", "[data-prv]", "[data-prv-chip]", "[data-prv-item]", "[data-prv-check]", "[data-prv-badge]",
        "[data-flow-step]", "[data-flow-end]", "[data-term-type]", "[data-term-out]", ".lp-ln > span", ".lp-pulse", ".lp-bar i",
        ".lp-st-a", ".lp-st-b", ".lp-cursor",
      ].join(",");
      const motionHooks = [
        "[data-r]", "[data-hover]", "[data-press]", "[data-rev-row]", "[data-rev-comment]", "[data-rev-bar]", "[data-perm-item]",
        "[data-perm-btn]", ".lp-pl-a", ".lp-pl-b", "[data-cell]",
      ].join(",");
      const shared = [...document.querySelectorAll(motionHooks)].filter((el) => el.matches(gsapHooks));
      expect(shared.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
    });

    it("starts hidden scenes by CSS, so the page is complete without the script", () => {
      const css = readFileSync(join(ROOT, "site", "app", "landing.css"), "utf8");
      expect(css).toMatch(/\.lp-st-a, \.lp-pl-a, \.lp-wire-dot, \.lp-brief \{ opacity: 0; visibility: hidden; \}/);
      // The finished state is what shows: Finished, the plan at 3/4, and the numbers at their end values.
      expect(copy + text).toContain("Finished · 2 min");
      expect(document.querySelector("[data-count='59']")?.textContent).toBe("59");
    });
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

  it("has Vercel serve the stripped static export, not its own Next.js build", () => {
    const config = JSON.parse(readFileSync(join(ROOT, "site", "vercel.json"), "utf8"));
    expect(config.framework).toBeNull();
    expect(config.outputDirectory).toBe("out");
    expect(config.trailingSlash).toBe(true);
    // The page's own motion script is the only script it allows: same origin, no inline code, no other host.
    const csp = config.headers[0].headers.find((header: { key: string }) => header.key === "Content-Security-Policy").value as string;
    expect(csp).toContain("script-src 'self';");
    expect(csp).not.toMatch(/unsafe-inline.*script|script-src[^;]*(unsafe|https?:)/);
    expect(csp).toContain("connect-src 'self'");
    // trailingSlash redirects any path without a file extension, so the shared image needs one.
    expect(OG_IMAGE.url).toMatch(/\.png$/);
    expect(existsSync(join(ROOT, "site", "app", "opengraph-image.tsx"))).toBe(false);
  });

  it("always builds production, and skips only previews that change nothing the site uses", () => {
    const { ignoreCommand } = JSON.parse(readFileSync(join(ROOT, "site", "vercel.json"), "utf8"));
    // Vercel skips the build when the command exits 0. Comparing HEAD with itself is a commit that changes nothing.
    const run = (environment: string, previousCommit = "HEAD") => {
      // A Git hook exports GIT_DIR (and friends) for its own repository; Vercel's
      // build does not, and inheriting it makes `git diff` from site/ look in the
      // wrong place, so the command fails instead of comparing commits.
      const { GIT_DIR: _gitDir, GIT_WORK_TREE: _gitWorkTree, GIT_INDEX_FILE: _gitIndex, ...inherited } = process.env;
      return spawnSync("sh", ["-c", ignoreCommand], {
        cwd: join(ROOT, "site"),
        env: { ...inherited, VERCEL_ENV: environment, VERCEL_GIT_PREVIOUS_SHA: previousCommit },
      }).status;
    };
    expect(run("production")).toBe(1);
    expect(run("preview")).toBe(0);
    // A rebased branch (Dependabot force-pushes) leaves Vercel naming a commit its clone no longer has.
    // git then exits 128, which Vercel reports as a failed deployment; only 1 means "build".
    expect(run("preview", "0".repeat(40))).toBe(1);
  });

  it("refuses to build for production without an address, rather than publish localhost links", () => {
    expect(() => siteUrl({ NODE_ENV: "production" })).toThrow(/SITE_URL/);
    expect(siteUrl({ NODE_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "zorvolabs.xyz" }).href).toBe("https://zorvolabs.xyz/");
  });

  it("keeps a sub-path in SITE_URL for the sitemap", () => {
    vi.stubEnv("SITE_URL", "https://example.github.io/zorvo");
    expect(siteUrl().href).toBe("https://example.github.io/zorvo/");
    expect(robots().sitemap).toBe("https://example.github.io/zorvo/sitemap.xml");
    expect(sitemap()[0].url).toBe("https://example.github.io/zorvo/");
  });

  it("takes the site's address from SITE_URL, then Vercel's production domain, then localhost", () => {
    expect(siteUrl({ SITE_URL: "https://zorvolabs.xyz", VERCEL_PROJECT_PRODUCTION_URL: "zorvo.vercel.app" }).href).toBe(
      "https://zorvolabs.xyz/",
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
    "/docs/delegate": DelegateDocs,
    "/docs/review": ReviewDocs,
    "/docs/output": OutputDocs,
    "/docs/terminal": TerminalDocs,
    "/docs/privacy": PrivacyDocs,
    "/docs/credits": CreditsDocs,
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
    for (const id of ["failed", "update"]) expect(troubleshooting).toContain(id);

    const quickstart = parse("/docs/quickstart");
    expect(quickstart.body.textContent).toContain("Rewind to here");
    expect(idsOf("/docs/quickstart")).toContain("composer");
    expect(quickstart.body.textContent).toContain("The welcome screen");

    expect(parse("/docs/terminal").body.textContent).toContain("Inspector");
    expect(parse("/docs/compare").body.textContent).toContain("Pick always asks first");
    expect(parse("/docs/review").body.textContent).toContain("Outdated");
    for (const href of Object.keys(PAGES)) {
      expect(parse(href).body.textContent, href).not.toMatch(/drawer|detected agents|Settings, General, GitHub|Gemini/i);
    }
  });

  it("names the default agents and says they do not endorse Zorvo", () => {
    const text = parse("/docs/agents").body.textContent ?? "";
    for (const agent of ["Claude Code", "Codex", "Qwen Code"]) expect(text).toContain(agent);
    expect(text).toContain("not endorsed by them");
  });
});
