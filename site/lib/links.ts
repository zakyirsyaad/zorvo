/**
 * Every place the site sends people. The docs live on the site itself. Downloads and the
 * changelog come from the repository: `download` fetches the newest published DMG
 * under the stable name the Release workflow uploads.
 */
const REPOSITORY = "https://github.com/zakyirsyaad/zorvo";

export const LINKS = {
  repository: REPOSITORY,
  issues: `${REPOSITORY}/issues`,
  releases: `${REPOSITORY}/releases`,
  license: `${REPOSITORY}/blob/main/LICENSE`,
  download: `${REPOSITORY}/releases/latest/download/Zorvo-mac.dmg`,
  docs: "/docs",
  installGuide: "/docs/install",
  quickstart: "/docs/quickstart",
  compareGuide: "/docs/compare",
  reviewGuide: "/docs/review",
  delegateGuide: "/docs/delegate",
  outputGuide: "/docs/output",
  signingIn: "/docs/signing-in",
  agentsGuide: "/docs/agents",
  troubleshooting: "/docs/troubleshooting",
  privacyGuide: "/docs/privacy",
  credits: "/docs/credits",
  discord: "https://discord.gg/wX6SPqQu33",
  x: "https://x.com/zorvolabs",
  changelog: `${REPOSITORY}/blob/main/CHANGELOG.md`,
} as const;
