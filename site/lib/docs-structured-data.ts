import { SITE_NAME, siteUrl } from "./site";

/**
 * schema.org data for a docs page: where it sits (Zorvo, Docs, the page) and what it is (a
 * technical article about the Zorvo app). Search engines show the trail instead of the bare URL.
 */
export function docsStructuredData(href: string, title: string, description: string, base: URL = siteUrl()) {
  const url = new URL(`${href.slice(1)}/`, base).href;
  const trail = [
    { name: SITE_NAME, url: base.href },
    { name: "Docs", url: new URL("docs/", base).href },
    ...(href === "/docs" ? [] : [{ name: title, url }]),
  ];
  return [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: trail.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        item: item.url,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: title,
      description,
      url,
      inLanguage: "en",
      about: { "@type": "SoftwareApplication", name: SITE_NAME, operatingSystem: "macOS" },
      publisher: { "@type": "Organization", name: SITE_NAME, url: base.href },
    },
  ];
}
