import { VOICES, type Voice } from "../../lib/voices";
import { BrandIcon, type Brand } from "../ui/BrandIcon";

const BRANDS: Readonly<Record<string, Brand>> = { Discord: "discord", X: "x", GitHub: "github" };
const AGENT_LIST = new Intl.ListFormat("en", { type: "conjunction" });
/** The quote marks are drawn, not typed, so each blockquote holds the person's words and nothing else. */
const QUOTE_MARKS = "before:content-['“'] after:content-['”']";
const LINK = "focus-ring inline-flex items-center gap-1.5 min-h-11 text-[13px] text-fg-muted hover:text-fg underline underline-offset-3";

/** The quote, with the highlight drawn as selected text when the quote holds it word for word. */
function Words({ quote, highlight }: { quote: string; highlight?: string }) {
  const at = highlight ? quote.indexOf(highlight) : -1;
  if (!highlight || at < 0) return <>{quote}</>;
  return (
    <>
      {quote.slice(0, at)}
      <mark className="bg-mark text-on-mark rounded-[3px] px-1 [box-decoration-break:clone]">{highlight}</mark>
      {quote.slice(at + highlight.length)}
    </>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function SourceLink({ voice }: { voice: Voice }) {
  const brand = BRANDS[voice.source];
  if (!voice.href) return <span className="text-[13px] text-fg-subtle">{voice.source}</span>;
  return (
    <a className={LINK} href={voice.href} target="_blank" rel="noopener noreferrer">
      {brand && <BrandIcon brand={brand} size={14} />}
      Read on {voice.source}
      <span className="sr-only">, opens in a new tab</span>
    </a>
  );
}

/** The person: initials, name and handle, then what they do and the agents they run. */
function Person({ voice }: { voice: Voice }) {
  const details = [voice.role, voice.agents?.length ? `runs ${AGENT_LIST.format(voice.agents)}` : ""].filter(Boolean);
  return (
    <figcaption className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="size-9 flex-none rounded-full bg-surface-hover text-fg-secondary text-[12px] font-medium grid place-items-center" aria-hidden="true">
        {initials(voice.name)}
      </span>
      <span className="min-w-0 flex flex-1 flex-col">
        <span className="text-[15px] leading-5.5 font-medium text-fg">
          {voice.name}
          {voice.handle && <span className="font-normal text-fg-subtle"> @{voice.handle}</span>}
        </span>
        <span className="text-[13px] leading-5 text-fg-subtle">{details.join(" · ")}</span>
      </span>
      <SourceLink voice={voice} />
    </figcaption>
  );
}

/**
 * What people said about Zorvo. The first quote is drawn largest, with its highlight; the next two sit side by
 * side and the rest in a row of three, divided by hairlines rather than cards. Nothing renders without quotes.
 */
export function Voices({ voices = VOICES }: { voices?: readonly Voice[] }) {
  if (voices.length === 0) return null;
  const [lead, ...others] = voices;
  const pair = others.slice(0, 2);
  const rest = others.slice(2);
  return (
    <section className="lp-sec" id="voices" aria-labelledby="voices-title">
      <div className="lp-wrap" data-reveal="">
        <h2 className="lp-eyebrow" id="voices-title" data-r="">From people who work in Zorvo</h2>

        <figure className="flex flex-col gap-7 pt-4 pb-10 border-b border-border" data-voice="lead" data-r="">
          <blockquote className={`max-w-260 text-[28px] leading-9 min-[861px]:text-[44px] min-[861px]:leading-13 font-medium tracking-[-0.035em] text-fg ${QUOTE_MARKS}`}>
            <Words quote={lead.quote} highlight={lead.highlight} />
          </blockquote>
          <Person voice={lead} />
        </figure>

        {pair.length > 0 && (
          <div className={`grid border-b border-border ${pair.length === 2 ? "min-[861px]:grid-cols-2" : ""}`}>
            {pair.map((voice, index) => (
              <figure
                key={voice.name + voice.quote}
                className={`flex flex-col gap-7 py-8 ${index > 0 ? "border-t border-border min-[861px]:border-t-0 min-[861px]:border-l min-[861px]:pl-8" : "min-[861px]:pr-8"}`}
                data-voice="pair"
                data-r=""
              >
                <blockquote className={`text-[20px] leading-7.5 min-[861px]:text-[24px] min-[861px]:leading-8 font-medium tracking-[-0.02em] text-fg ${QUOTE_MARKS}`}>
                  {voice.quote}
                </blockquote>
                <Person voice={voice} />
              </figure>
            ))}
          </div>
        )}

        {rest.length > 0 && (
          <div className="grid min-[861px]:grid-cols-3" data-voice="rest">
            {rest.map((voice, index) => (
              <figure
                key={voice.name + voice.quote}
                className={`flex flex-col gap-3 py-6 border-border ${index > 0 ? "border-t min-[861px]:border-t-0" : ""} ${index % 3 > 0 ? "min-[861px]:border-l min-[861px]:pl-6" : ""} ${index % 3 < 2 ? "min-[861px]:pr-6" : ""}`}
                data-r=""
              >
                <blockquote className={`text-[16px] leading-6.5 text-fg-secondary ${QUOTE_MARKS}`}>{voice.quote}</blockquote>
                <figcaption className="mt-auto flex flex-wrap items-center gap-x-2 text-[13px] text-fg-subtle">
                  <span className="font-medium text-fg">{voice.name}</span>
                  <span aria-hidden="true">·</span>
                  <SourceLink voice={voice} />
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
