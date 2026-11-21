import type { Tweet } from "../../lib/tweets";
import { BrandIcon } from "./BrandIcon";

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * A post from X as a card, after Magic UI's Tweet Card: the author, the post's words and a link to it.
 * It draws a copy kept in lib/tweets.ts, so the page loads nothing from X. Every link opens a new tab.
 *
 * The whole card leads to the author's profile: the name is the link, stretched over the card by CSS, and
 * the card lifts under the pointer (the page's `data-hover` motion). The other links sit above that one.
 */
export function TweetCard({ tweet }: { tweet: Tweet }) {
  const profile = `https://x.com/${tweet.handle}`;
  return (
    <article className="lp-card lp-tweet relative flex w-full max-w-lg flex-col gap-4 p-5 rounded-xl" data-tweet="" data-hover="">
      <header className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-3">
          {/* Zorvo's own mark stands for its account. */}
          <span className="flex size-12 flex-none items-center justify-center rounded-full border border-border bg-bg text-fg" aria-hidden="true">
            <svg viewBox="0 0 40 40" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 7l10 7-10 7" />
              <path d="M18 19l10 7-10 7" />
              <path d="M30 33h5" />
            </svg>
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1 text-fg font-medium whitespace-nowrap">
              <a className="focus-ring lp-tweet-main" href={profile} target="_blank" rel="noopener noreferrer">
                {tweet.name}
                <span className="sr-only"> on X, opens in a new tab</span>
              </a>
              {tweet.isVerified && (
                <svg className="size-4 flex-none text-mark" viewBox="0 0 24 24" role="img" aria-label="Verified account">
                  <path
                    fill="currentColor"
                    d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.415-.165-.866-.25-1.336-.25-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .47 0 .92-.086 1.335-.25.62 1.334 1.926 2.25 3.437 2.25 1.512 0 2.818-.916 3.437-2.25.415.163.865.248 1.336.248 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.513 1.158-.687 1.943-1.99 1.943-3.484zm-6.616-3.334l-4.334 6.5c-.145.217-.382.334-.625.334-.143 0-.288-.04-.416-.126l-.115-.094-2.415-2.415c-.293-.293-.293-.768 0-1.06s.768-.294 1.06 0l1.77 1.767 3.825-5.74c.23-.345.696-.436 1.04-.207.346.23.44.696.21 1.04z"
                  />
                </svg>
              )}
            </span>
            <span className="text-[14px] leading-5 text-fg-muted">@{tweet.handle}</span>
          </span>
        </span>
        <a className="focus-ring lp-icon-link lp-tweet-over -m-3" href={tweet.url} target="_blank" rel="noopener noreferrer">
          <BrandIcon brand="x" size={18} />
          <span className="sr-only">Open the post on X, in a new tab</span>
        </a>
      </header>
      <p className="text-[15px] leading-6.5 text-fg whitespace-pre-line break-words">
        {tweet.parts.map((part) =>
          part.href ? (
            <a key={part.text} className="focus-ring lp-tweet-link lp-tweet-over" href={part.href} target="_blank" rel="noopener noreferrer">
              {part.text}
            </a>
          ) : (
            part.text
          ),
        )}
      </p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-5 text-fg-subtle">
        <time dateTime={tweet.postedOn}>{DAY.format(new Date(`${tweet.postedOn}T00:00:00Z`))}</time>
        {tweet.hasVideo && (
          <>
            <span aria-hidden="true">·</span>
            <a className="focus-ring lp-tweet-link lp-tweet-over" href={tweet.url} target="_blank" rel="noopener noreferrer">
              Watch the video on X
              <span className="sr-only">, opens in a new tab</span>
            </a>
          </>
        )}
      </p>
    </article>
  );
}
