import { LINKS } from "../../lib/links";
import { LAUNCH_TWEET } from "../../lib/tweets";
import { BrandIcon, type Brand } from "../ui/BrandIcon";
import { TweetCard } from "../ui/TweetCard";

const PLACES: ReadonlyArray<{ brand: Brand; href: string; name: string; text: string }> = [
  { brand: "discord", href: LINKS.discord, name: "Discord", text: "Ask a question, report what broke, or say what you want next." },
  { brand: "x", href: LINKS.x, name: "X", text: "Releases and short notes on what changed." },
  { brand: "github", href: LINKS.repository, name: "GitHub", text: "The source, the issues and every release." },
];

export function Community() {
  return (
    <section className="lp-sec border-t-0" id="community" aria-labelledby="community-title">
      <div className="lp-wrap lp-row">
        <div className="lp-col" data-reveal="">
          <p className="lp-eyebrow" data-r="">Community</p>
          <h2 className="lp-h2" data-r="" id="community-title">Built in the open.</h2>
          <p className="lp-lead" data-r="">
            Zorvo is open source, and its work is public. Follow it, or take part.
          </p>
          <ul className="lp-pts gap-2" data-r="">
            {PLACES.map(({ brand, href, name, text }) => (
              <li key={brand}>
                <a className="focus-ring lp-place" href={href} target="_blank" rel="noopener noreferrer">
                  <span className="lp-place-tile" aria-hidden="true">
                    <BrandIcon brand={brand} size={16} />
                  </span>
                  <span className="flex flex-1 flex-col">
                    <span className="text-[16px] leading-6 font-semibold text-fg">
                      {name}
                      <span className="sr-only">, opens in a new tab</span>
                    </span>
                    <span className="text-[15px] leading-6 text-fg-muted">{text}</span>
                  </span>
                  {/* Shows under the pointer: the link leaves for another site. */}
                  <svg className="lp-ico lp-place-go" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M7 17L17 7" />
                    <path d="M9 7h8v8" />
                  </svg>
                </a>
              </li>
            ))}
          </ul>
          <p className="text-[15px] leading-6 text-fg-muted" data-r="">
            Tried Zorvo and stopped? Tell us what got in your way in the{" "}
            <a
              className="focus-ring text-fg underline underline-offset-4"
              href={LINKS.feedback}
              target="_blank"
              rel="noopener noreferrer"
            >
              feedback form on GitHub
              <span className="sr-only">, opens in a new tab</span>
            </a>
            .
          </p>
        </div>
        <div className="lp-col basis-110 items-center" data-reveal="">
          <div className="w-full flex justify-center" data-r="">
            <TweetCard tweet={LAUNCH_TWEET} />
          </div>
        </div>
      </div>
    </section>
  );
}
