import type { MetadataRoute } from "next";
import { DOCS_PAGES } from "../lib/docs-nav";
import { siteUrl } from "../lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return [
    { url: base.href, changeFrequency: "monthly", priority: 1 },
    ...DOCS_PAGES.map(({ href }) => ({
      url: new URL(`${href.slice(1)}/`, base).href,
      changeFrequency: "monthly" as const,
      priority: href === "/docs" ? 0.8 : 0.6,
    })),
  ];
}
