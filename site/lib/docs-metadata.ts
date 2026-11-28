import type { Metadata } from "next";
import { OG_IMAGE, SITE_NAME, X_HANDLE } from "./site";
import { DOCS_PAGES } from "./docs-nav";


/** Title, description and canonical address for a docs page, taken from the docs list. */
export function docsMetadata(href: string): Metadata {
  const page = DOCS_PAGES.find((entry) => entry.href === href);
  if (!page) throw new Error(`${href} is not in DOCS_NAV`);
  const { title, description } = page;
  // The export serves each page from a folder (next.config.ts trailingSlash), so its address ends in a slash.
  const url = `${href}/`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "article", siteName: SITE_NAME, locale: "en_US", images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", site: X_HANDLE, title, description, images: [OG_IMAGE.url] },
  };
}
