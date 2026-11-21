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
  assets: Array<{ name: string; download_count: number }>;
}

/**
 * How often the .dmg was downloaded, from GitHub's public API. Update packages are not counted.
 * Any failure gives undefined, and the page then shows the count in lib/downloads.ts.
 */
async function readDownloads(): Promise<string | undefined> {
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
    for (const repository of RELEASE_REPOSITORIES) {
      for (let page = 1; page <= 5; page += 1) {
        const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`, {
          headers,
          signal: AbortSignal.timeout(5000),
        });
        // A total without one of the repositories would be too low, so one failure drops it all.
        if (!response.ok) return fallback(`GitHub answered ${response.status} for ${repository}`);
        const releases = (await response.json()) as Release[];
        for (const release of releases) {
          for (const asset of release.assets) {
            if (asset.name.endsWith(".dmg")) total += asset.download_count;
          }
        }
        if (releases.length < 100) break;
      }
    }
    return String(total);
  } catch (error) {
    return fallback(error instanceof Error ? error.name : "request failed");
  }
}

export default async function config(): Promise<NextConfig> {
  const downloads = await readDownloads();
  return { ...nextConfig, env: downloads === undefined ? {} : { ZORVO_DOWNLOADS: downloads } };
}
