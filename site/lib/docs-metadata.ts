import type { Metadata } from "next";
import { OG_IMAGE, SITE_NAME } from "./site";
import { DOCS_PAGES } from "./docs-nav";


/** Title, description and canonical address for a docs page, taken from the docs list. */
export function docsMetadata(href: string): Metadata {
  const page = DOCS_PAGES.find((entry) => entry.href === href);
  if (!page) throw new Error(`${href} is not in DOCS_NAV`);
  const title = href === "/docs" ? `${SITE_NAME} docs: install, agents, compare and review` : `${page.label} · ${SITE_NAME} docs`;
  // The export serves each page from a folder (next.config.ts trailingSlash), so its address ends in a slash.
  const url = `${href}/`;
  return {
    title,
    description: page.summary,
    alternates: { canonical: url },
    openGraph: { title, description: page.summary, url, type: "article", siteName: SITE_NAME, locale: "en_US", images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title, description: page.summary, images: [OG_IMAGE.url] },
  };
}
