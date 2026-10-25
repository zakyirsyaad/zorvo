/**
 * Every place the site sends people. The design's docs pages and download page do not exist
 * yet, so `docs` and its topics point at the README and `download` at the GitHub releases;
 * swap these once those pages ship, and every link on the page follows.
 */
const REPO = "https://github.com/zakyirsyaad/zorvo";

export const LINKS = {
  download: `${REPO}/releases`,
  docs: `${REPO}#readme`,
  installGuide: `${REPO}#install`,
  agentsGuide: `${REPO}#supported-agents`,
  troubleshooting: `${REPO}#troubleshooting`,
  changelog: `${REPO}/blob/main/CHANGELOG.md`,
} as const;
