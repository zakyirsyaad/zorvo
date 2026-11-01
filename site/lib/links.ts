/**
 * Every place the site sends people. The docs live on the site itself. Downloads and the
 * changelog come from the releases repository: `download` fetches the newest published DMG
 * under the stable name the Release workflow uploads.
 */
const RELEASES = "https://github.com/zakyirsyaad/zorvo-releases";

export const LINKS = {
  download: `${RELEASES}/releases/latest/download/Zorvo-mac.dmg`,
  docs: "/docs",
  installGuide: "/docs/install",
  agentsGuide: "/docs/agents",
  troubleshooting: "/docs/troubleshooting",
  changelog: `${RELEASES}/blob/main/CHANGELOG.md`,
} as const;
