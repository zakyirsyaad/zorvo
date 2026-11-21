export interface TweetPart {
  text: string;
  /** Set for a link inside the post. */
  href?: string;
}

export interface Tweet {
  url: string;
  name: string;
  handle: string;
  isVerified: boolean;
  /** The day it was posted, as an ISO date. */
  postedOn: string;
  /** The post's own words, in order, with its links. */
  parts: readonly TweetPart[];
  /** The post carries a video, which the card links to instead of loading from X. */
  hasVideo: boolean;
}

/**
 * Zorvo's launch post, copied from X on 21 November 2026. The page shows a copy and links to the original,
 * so opening the site asks X for nothing.
 */
export const LAUNCH_TWEET: Tweet = {
  url: "https://x.com/zorvolabs/status/2121583312947007728",
  name: "Zorvo",
  handle: "zorvolabs",
  isVerified: true,
  postedOn: "2026-11-14",
  parts: [
    {
      text: "Every coding agent. One desktop.\n\nZorvo is a free, open-source Mac app for Claude Code, Codex, Qwen Code and 40 more. Bring the agent you already use.\n\n",
    },
    { text: "zorvolabs.xyz", href: "https://zorvolabs.xyz" },
  ],
  hasVideo: true,
};
