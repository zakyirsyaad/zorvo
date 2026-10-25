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

export default nextConfig;
