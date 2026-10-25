/**
 * Every place the site sends people. The app's source is private, so downloads and the user
 * guide live in the public releases repository: its README is `docs/releases-repo/README.md`,
 * copied there by the Release workflow. `download` fetches the newest published DMG under the
 * stable name the workflow uploads. Swap these once the site's own docs pages ship, and every
 * link on the page follows.
 */
const RELEASES = "https://github.com/zakyirsyaad/zorvo-releases";

export const LINKS = {
  download: `${RELEASES}/releases/latest/download/Zorvo-mac.dmg`,
  docs: `${RELEASES}#readme`,
  installGuide: `${RELEASES}#install`,
  agentsGuide: `${RELEASES}#supported-agents`,
  troubleshooting: `${RELEASES}#troubleshooting`,
  changelog: `${RELEASES}/blob/main/CHANGELOG.md`,
} as const;
