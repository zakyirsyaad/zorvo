/**
 * Every place the site sends people. The docs live on the site itself; downloads go to the
 * GitHub releases until the download host is decided, and the changelog stays on GitHub.
 */
const REPO = "https://github.com/zakyirsyaad/zorvo";

export const LINKS = {
  download: `${REPO}/releases`,
  docs: "/docs",
  installGuide: "/docs/install",
  agentsGuide: "/docs/agents",
  troubleshooting: "/docs/troubleshooting",
  changelog: `${REPO}/blob/main/CHANGELOG.md`,
} as const;
