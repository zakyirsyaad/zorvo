import { VOICES, type Voice } from "../../lib/voices";

function Person({ voice, isOnLight = false }: { voice: Voice; isOnLight?: boolean }) {
  const quiet = isOnLight ? "text-on-primary/70" : "text-fg-subtle";
  return (
    <figcaption className="mt-auto flex items-center gap-3">
      <span className="min-w-0 flex flex-col">
        <span className={`text-[15px] leading-5.5 font-medium ${isOnLight ? "text-on-primary" : "text-fg"}`}>{voice.name}</span>
        <span className={`text-[13px] leading-5 ${quiet}`}>{voice.role}</span>
      </span>
      <span className="flex-1" />
      {voice.href ? (
        <a className={`focus-ring inline-flex items-center min-h-11 text-[12px] underline underline-offset-3 ${isOnLight ? "text-on-primary" : ""}`} href={voice.href}>
          {voice.source}
        </a>
      ) : (
        <span className={`text-[12px] leading-4 whitespace-nowrap ${quiet}`}>{voice.source}</span>
      )}
    </figcaption>
  );
}

/** What people said about Zorvo: the first two quotes large, the rest in a row of three. Nothing renders without quotes. */
export function Voices({ voices = VOICES }: { voices?: readonly Voice[] }) {
  if (voices.length === 0) return null;
  const [first, second, ...rest] = voices;
  return (
    <section className="lp-sec" id="voices" aria-labelledby="voices-title">
      <div className="lp-wrap flex flex-col gap-14">
        <h2 className="lp-h2" id="voices-title" data-reveal="">
          <span data-r="">From people who work in Zorvo.</span>
        </h2>
        <div className="flex flex-col gap-5">
          <div className="grid gap-5 min-[861px]:grid-cols-[1.35fr_1fr]">
            <figure className="flex flex-col gap-10 min-h-80 p-8 min-[861px]:p-[44px_48px] rounded-2xl bg-fg text-on-primary">
              <blockquote className="text-[22px] leading-8 min-[861px]:text-[28px] min-[861px]:leading-9.5 font-medium tracking-[-0.02em]">{first.quote}</blockquote>
              <Person voice={first} isOnLight />
            </figure>
            {second && (
              <figure className="lp-card flex flex-col gap-10 min-h-80 p-8 min-[861px]:p-[44px_48px] rounded-2xl">
                <blockquote className="text-[20px] leading-7.5 min-[861px]:text-[22px] min-[861px]:leading-8 font-medium tracking-[-0.015em] text-fg">{second.quote}</blockquote>
                <Person voice={second} />
              </figure>
            )}
          </div>
          {rest.length > 0 && (
            <div className="grid gap-5 min-[861px]:grid-cols-3">
              {rest.map((voice) => (
                <figure key={voice.name + voice.quote} className="lp-card flex flex-col gap-8 min-h-60 p-7 rounded-2xl">
                  <blockquote className="text-[16px] leading-6.5 text-fg-secondary">{voice.quote}</blockquote>
                  <Person voice={voice} />
                </figure>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
