import { execFileSync } from "node:child_process";
import type { MetadataRoute } from "next";
import { DOCS_PAGES } from "../lib/docs-nav";
import { siteUrl } from "../lib/site";

export const dynamic = "force-static";

const git = (...args: string[]): string => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/** A path as git reads it from the top of the repository, whatever folder the build runs in. */
const fromTop = (path: string): string => `:(top)site/${path}`;
/** The same, to leave a path out. */
const except = (path: string): string => `:(top,exclude)site/${path}`;

/**
 * When the files behind a page were last committed, or nothing when the history cannot say. A build host
 * clones only the newest commits, and git then names the oldest of them for every older file: that commit
 * has no parent, and a date taken from it would be made up, which teaches a crawler to ignore them all.
 */
function lastCommitted(...paths: string[]): Date | undefined {
  try {
    const [stamp, parents = ""] = git("log", "-1", "--format=%cI|%P", "--", ...paths).split("|");
    if (!stamp) return undefined;
    if (parents === "" && git("rev-parse", "--is-shallow-repository") === "true") return undefined;
    return new Date(stamp);
  } catch {
    return undefined;
  }
}

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return [
    // The home page is drawn from its sections, its styles and its data. Two files in lib describe only the docs.
    {
      url: base.href,
      lastModified: lastCommitted(
        fromTop("app/page.tsx"),
        fromTop("app/landing.css"),
        fromTop("components/sections"),
        fromTop("lib"),
        except("lib/docs-nav.ts"),
        except("lib/docs-metadata.ts"),
      ),
      changeFrequency: "monthly",
      priority: 1,
    },
    ...DOCS_PAGES.map(({ href }) => ({
      url: new URL(`${href.slice(1)}/`, base).href,
      lastModified: lastCommitted(fromTop(href === "/docs" ? "app/docs/page.tsx" : `app${href}/page.tsx`)),
      changeFrequency: "monthly" as const,
      priority: href === "/docs" ? 0.8 : 0.6,
    })),
  ];
}
