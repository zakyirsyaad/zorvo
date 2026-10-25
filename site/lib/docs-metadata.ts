import type { Metadata } from "next";
import { SITE_NAME } from "./site";
import { DOCS_PAGES } from "./docs-nav";

/** Title, description and canonical address for a docs page, taken from the docs list. */
export function docsMetadata(href: string): Metadata {
  const page = DOCS_PAGES.find((entry) => entry.href === href);
  if (!page) throw new Error(`${href} is not in DOCS_NAV`);
  const title = href === "/docs" ? `${SITE_NAME} docs` : `${page.label} · ${SITE_NAME} docs`;
  return {
    title,
    description: page.summary,
    alternates: { canonical: href },
    openGraph: { title, description: page.summary, url: href, type: "article", siteName: SITE_NAME, locale: "en_US" },
    twitter: { card: "summary_large_image", title, description: page.summary },
  };
}
