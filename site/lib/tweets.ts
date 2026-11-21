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
  /** The post's video, as a copy the site serves itself. */
  video?: TweetVideo;
}

export interface TweetVideo {
  src: string;
  /** The still shown until the video plays, and for good under reduced motion. */
  poster: string;
  width: number;
  height: number;
  /** What the video is, for someone who cannot see it. */
  label: string;
}

/**
 * Zorvo's launch post, copied from X on 21 November 2026. The page shows a copy and links to the original,
 * so opening the site asks X for nothing. The video is Zorvo's own showreel, made smaller and without its
 * sound (public/media): 960 by 540, 15 seconds.
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
  video: {
    src: "/media/zorvo-launch.mp4",
    poster: "/media/zorvo-launch.jpg",
    width: 960,
    height: 540,
    label: "Zorvo's launch video: 15 seconds of the app at work, without sound.",
  },
};
