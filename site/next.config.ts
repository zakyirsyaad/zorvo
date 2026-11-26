import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// The repository root: the site imports the agent logos from the app's src/assets.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const nextConfig: NextConfig = {
  // A static site: `next build` writes plain HTML, CSS and assets to out/.
  output: "export",
  // Each page becomes a folder with index.html (out/docs/install/index.html), which any static host serves at /docs/install/.
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
};

// The repositories whose releases hold the Mac app: this one, and the one that held it up to 0.7.0.
const RELEASE_REPOSITORIES = ["zakyirsyaad/zorvo", "zakyirsyaad/zorvo-releases"];

interface Release {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  /** Null for a draft. */
  published_at: string | null;
  assets: Array<{ name: string; download_count: number }>;
}

interface Published {
  downloads: string;
  /** The newest published release of this repository, without the "v". */
  version?: string;
  /** Each published release's counts as JSON, for the home page's Numbers section (lib/release-stats.ts checks them). */
  releaseStats: string;
}

/** The tags lib/release-stats.ts accepts. */
const STATS_TAG = /^v\d+\.\d+\.\d+$/;

const countOf = (release: Release, suffix: string): number =>
  release.assets.filter((asset) => asset.name.endsWith(suffix)).reduce((sum, asset) => sum + asset.download_count, 0);

/**
 * How often the .dmg was downloaded and which version is the newest published one, from GitHub's public
 * API. Update packages are not counted. Any failure gives undefined, and the page then shows the count in
 * lib/downloads.ts and the app's own package version.
 */
async function readReleases(): Promise<Published | undefined> {
  // Without a token GitHub allows 60 requests an hour per address, which a shared build machine can use up.
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = { accept: "application/vnd.github+json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const fallback = (reason: string): undefined => {
    console.warn(`Download count not read (${reason}): the page shows the count in lib/downloads.ts.`);
    return undefined;
  };
  try {
    let total = 0;
    let version: string | undefined;
    const perRelease: Array<{ tag: string; publishedOn: string; installers: number; updates: number }> = [];
    for (const repository of RELEASE_REPOSITORIES) {
      for (let page = 1; page <= 5; page += 1) {
        const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`, {
          headers,
          signal: AbortSignal.timeout(5000),
        });
        // A total without one of the repositories would be too low, so one failure drops it all.
        if (!response.ok) return fallback(`GitHub answered ${response.status} for ${repository}`);
        const releases = (await response.json()) as Release[];
        // GitHub lists the newest first. The first repository is the one the Download button reads.
        if (repository === RELEASE_REPOSITORIES[0] && version === undefined) {
          version = releases.find((release) => !release.draft && !release.prerelease)?.tag_name.replace(/^v/, "");
        }
        for (const release of releases) {
          for (const asset of release.assets) {
            if (asset.name.endsWith(".dmg")) total += asset.download_count;
          }
          // lib/release-stats.ts drops the whole read for one tag it does not accept (v1.0.0-beta.1, 0.22.0),
          // so such a release is left out here and costs only itself.
          if (release.draft || release.prerelease || !release.published_at || !STATS_TAG.test(release.tag_name)) continue;
          perRelease.push({
            tag: release.tag_name,
            publishedOn: release.published_at.slice(0, 10),
            installers: countOf(release, ".dmg"),
            updates: countOf(release, ".app.tar.gz"),
          });
        }
        if (releases.length < 100) break;
      }
    }
    return { downloads: String(total), version, releaseStats: JSON.stringify(perRelease) };
  } catch (error) {
    return fallback(error instanceof Error ? error.name : "request failed");
  }
}

export default async function config(): Promise<NextConfig> {
  const published = await readReleases();
  const env: Record<string, string> = {};
  if (published) env.ZORVO_DOWNLOADS = published.downloads;
  if (published?.version) env.ZORVO_VERSION = published.version;
  if (published) {
    env.ZORVO_RELEASE_STATS = published.releaseStats;
    env.ZORVO_STATS_READ_ON = new Date().toISOString().slice(0, 10);
  }
  return { ...nextConfig, env };
}
