import { LINKS } from "../../lib/links";

/** `anchorBase` is "/" on pages other than the home page, so the section links lead back to it. */
export function SiteFooter({ anchorBase = "" }: { anchorBase?: "" | "/" }) {
  return (
    // On the landing page the script holds the footer's content still at the bottom of the window while the
    // page above scrolls away, so the footer is uncovered rather than scrolled in. The clip is what hides the
    // part not uncovered yet.
    <footer className="border-t border-border overflow-hidden" data-foot="">
      <div className="p-[56px_0_72px]" data-foot-inner="">
      <div className="lp-wrap flex flex-wrap gap-y-10 gap-x-16 text-[14px] leading-5.5">
        <div className="flex-[1_1_240px] flex flex-col gap-2.5">
          <span className="text-[20px] font-semibold tracking-[-0.04em] text-fg">zorvo</span>
          <span className="text-fg-subtle">Every coding agent. One desktop.</span>
        </div>
        <div className="flex flex-col">
          <span className="text-fg-subtle pb-1.5">Product</span>
          <a className="focus-ring min-h-8" href={`${anchorBase}#compare`}>Compare</a>
          <a className="focus-ring min-h-8" href={`${anchorBase}#delegate`}>Delegate</a>
          <a className="focus-ring min-h-8" href={`${anchorBase}#review`}>Review</a>
          <a className="focus-ring min-h-8" href={`${anchorBase}#output`}>Output</a>
          <a className="focus-ring min-h-8" href={`${anchorBase}#canvas`}>Canvas</a>
          <a className="focus-ring min-h-8" href={`${anchorBase}#features`}>Features</a>
          <a className="focus-ring min-h-8" href={`${anchorBase}#private`}>Private mode</a>
          <a className="focus-ring min-h-8" href={`${anchorBase}#faq`}>Questions</a>
        </div>
        <div className="flex flex-col">
          <span className="text-fg-subtle pb-1.5">Docs</span>
          <a className="focus-ring min-h-8" href={LINKS.quickstart}>Quickstart</a>
          <a className="focus-ring min-h-8" href={LINKS.installGuide}>Install</a>
          <a className="focus-ring min-h-8" href={LINKS.signingIn}>Signing in</a>
          <a className="focus-ring min-h-8" href={LINKS.privacyGuide}>Privacy</a>
          <a className="focus-ring min-h-8" href={LINKS.credits}>Credits terms</a>
        </div>
        <div className="flex flex-col">
          <span className="text-fg-subtle pb-1.5">Project</span>
          <a className="focus-ring min-h-8" href={LINKS.repository}>Source</a>
          <a className="focus-ring min-h-8" href={LINKS.feedback}>Send feedback</a>
          <a className="focus-ring min-h-8" href={LINKS.discord} target="_blank" rel="noopener noreferrer">Discord</a>
          <a className="focus-ring min-h-8" href={LINKS.x} target="_blank" rel="noopener noreferrer">X</a>
          <a className="focus-ring min-h-8" href={LINKS.releases}>Releases</a>
          <a className="focus-ring min-h-8" href={`${anchorBase}#stats`}>Download stats</a>
          <a className="focus-ring min-h-8" href={LINKS.changelog}>Changelog</a>
          <a className="focus-ring min-h-8" href={LINKS.license}>Apache 2.0</a>
        </div>
        <p className="basis-full max-w-140 text-fg-subtle">
          Claude Code, Codex, Qwen Code and other agent names belong to their makers. Zorvo works with them and is not
          endorsed by them.
        </p>
      </div>
      </div>
    </footer>
  );
}
