import { LINKS } from "../../lib/links";

/** `anchorBase` is "/" on pages other than the home page, so the section links lead back to it. */
export function SiteHeader({ anchorBase = "" }: { anchorBase?: "" | "/" }) {
  return (
    <header className="border-b border-border">
      {/* Three columns from the width where the section links show: equal sides keep the links at the
          page's middle, whatever the logo and the buttons measure. Narrower, it is a plain row. */}
      <div className="lp-wrap flex items-center gap-6 h-16 min-[861px]:grid min-[861px]:grid-cols-[1fr_auto_1fr]">
        <a className="focus-ring inline-flex items-center gap-2.5 min-h-11 text-fg justify-self-start" href={`${anchorBase}#top`}>
          <svg viewBox="0 0 40 40" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 7l10 7-10 7" />
            <path d="M18 19l10 7-10 7" />
            <path d="M30 33h5" />
          </svg>
          <span className="text-[22px] font-semibold tracking-[-0.04em]">zorvo</span>
        </a>
        <nav className="lp-nav gap-1" aria-label="Sections">
          <a className="focus-ring lp-btn lp-btn-ghost" href={`${anchorBase}#compare`}>Compare</a>
          <a className="focus-ring lp-btn lp-btn-ghost" href={`${anchorBase}#delegate`}>Delegate</a>
          <a className="focus-ring lp-btn lp-btn-ghost" href={`${anchorBase}#private`}>Private</a>
          <a className="focus-ring lp-btn lp-btn-ghost" href={`${anchorBase}#review`}>Review</a>
          <a className="focus-ring lp-btn lp-btn-ghost" href={`${anchorBase}#features`}>Features</a>
          <a className="focus-ring lp-btn lp-btn-ghost" href={`${anchorBase}#privacy`}>Privacy</a>
        </nav>
        <span className="flex items-center gap-1 ml-auto min-[861px]:justify-self-end">
          {/* Hidden on a phone, and from 861px to 1100px, where it would make this side wider than the
              logo's and push the section links off the middle. The footer has the link at every width. */}
          <a className="focus-ring lp-btn lp-btn-ghost max-[520px]:hidden min-[861px]:max-[1100px]:hidden" href={LINKS.repository}>GitHub</a>
          <a className="focus-ring lp-btn lp-btn-ghost" href={LINKS.docs}>Docs</a>
          <a className="focus-ring lp-btn lp-btn-outline h-10" data-press="" href={LINKS.download}>
            Download
          </a>
        </span>
      </div>
    </header>
  );
}
