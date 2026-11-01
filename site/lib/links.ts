/**
 * Every place the site sends people. The docs live on the site itself. Downloads and the
 * changelog come from the repository: `download` fetches the newest published DMG
 * under the stable name the Release workflow uploads.
 */
const REPOSITORY = "https://github.com/zakyirsyaad/zorvo";

export const LINKS = {
  download: `${REPOSITORY}/releases/latest/download/Zorvo-mac.dmg`,
  docs: "/docs",
  installGuide: "/docs/install",
  agentsGuide: "/docs/agents",
  troubleshooting: "/docs/troubleshooting",
  changelog: `${REPOSITORY}/blob/main/CHANGELOG.md`,
} as const;
