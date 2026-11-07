import appPackage from "../../package.json";
import { LINKS } from "./links";

export const SITE_NAME = "Zorvo";
// The tab and search result name the app by what people search for; the tagline stays the h1.
export const SITE_TITLE = "Zorvo: a Mac app for Claude Code, Codex and Qwen Code";
export const SITE_DESCRIPTION =
  "Free, open-source Mac app for Claude Code, Codex, Qwen Code and every ACP registry agent. Compare agents on one prompt and review their diffs. No API keys.";

/** The card shown when a page is shared, drawn by app/og.png/route.tsx at build time. */
export const OG_IMAGE = { url: "/og.png", type: "image/png", width: 1200, height: 630, alt: SITE_TITLE } as const;

const LOCAL_URL = "http://localhost:3100/";

// A trailing slash keeps a sub-path (https://example.github.io/zorvo/) when relative URLs resolve against it.
const withTrailingSlash = (href: string) => (href.endsWith("/") ? href : `${href}/`);

/**
 * The address the site is served from, for canonical links, the sitemap and
 * Open Graph URLs. SITE_URL wins; on Vercel the production domain is used, so
 * adding a custom domain there moves these with it. A production build with
 * neither fails rather than publish localhost links; dev and tests use the
 * local preview port.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): URL {
  if (env.SITE_URL) return new URL(withTrailingSlash(env.SITE_URL));
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return new URL(`https://${env.VERCEL_PROJECT_PRODUCTION_URL}/`);
  if (env.NODE_ENV === "production") {
    throw new Error(
      "Set SITE_URL to the address the site is served from, e.g. SITE_URL=https://zorvohub.xyz (on Vercel it comes from the production domain).",
    );
  }
  return new URL(LOCAL_URL);
}

/** schema.org data for search engines: a free macOS developer app. */
export function softwareApplication(url: URL = siteUrl()) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: url.href,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "macOS",
    softwareVersion: appPackage.version,
    downloadUrl: LINKS.download,
    image: new URL(OG_IMAGE.url.slice(1), url).href,
    isAccessibleForFree: true,
    license: "https://www.apache.org/licenses/LICENSE-2.0",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@type": "Organization", name: SITE_NAME, url: url.href, sameAs: [LINKS.repository] },
  };
}
