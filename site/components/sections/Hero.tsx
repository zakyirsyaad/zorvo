import appPackage from "../../../package.json";
import { AppMockup } from "../mockups/AppMockup";
import { ButtonLink } from "../ui/ButtonLink";
import { Icon } from "../ui/Icon";
import { LINKS } from "../../lib/links";

export function Hero() {
  return (
    <>
      <section
        id="top"
        aria-labelledby="hero-title"
        className="site-wrap flex flex-col items-center gap-7 pt-16 pb-14 text-center md:pt-24 md:pb-[72px]"
      >
        {/* The release line reads the app's own version, so it moves with each release. */}
        <a
          href={LINKS.changelog}
          className="focus-ring inline-flex items-center gap-2 rounded-sm font-mono text-xs leading-4 text-fg-muted no-underline transition-colors duration-150 hover:text-fg"
        >
          <span aria-hidden="true" className="text-fg-subtle">&gt;</span>
          <span>zorvo {appPackage.version} is out</span>
          <span aria-hidden="true" className="text-fg-subtle">→</span>
        </a>
        <h1 id="hero-title" className="t-display m-0 max-w-[760px]">
          Every coding agent.
          <br />
          One desktop.
        </h1>
        <p className="t-lead m-0 max-w-[580px]">
          Claude Code, Codex, Qwen Code and the agents of the ACP registry in one native Mac app. Work
          with one, or send one prompt to four and keep the best. No lock-in, no API keys.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <ButtonLink href={LINKS.download} variant="primary" size="lg">
            <Icon name="download" size={16} />
            Download for Mac
          </ButtonLink>
          <ButtonLink href={LINKS.docs} variant="outline" size="lg">
            Read the docs
            <Icon name="arrow-right" size={16} />
          </ButtonLink>
        </div>
        <p className="t-caption m-0 max-w-[460px]">
          Free and open source, for Macs with Apple silicon or Intel. Zorvo updates itself, and brings
          Node.js when an agent needs it.
        </p>
      </section>
      {/* The picture bleeds a little past the column on wide screens, so the window reads as the app, not a card. */}
      <div className="site-wrap lg:max-w-[1260px]">
        <AppMockup />
      </div>
    </>
  );
}
