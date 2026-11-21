import { downloadCount, formatCount, latestVersion } from "../../lib/downloads";
import { LINKS } from "../../lib/links";

export function Download() {
  const downloads = formatCount(downloadCount());
  return (
    <section className="border-t border-border py-24 px-0" id="download" aria-labelledby="download-title">
      <div className="lp-wrap flex flex-col items-center gap-5 text-center" data-reveal="">
        <svg data-draw="" viewBox="0 0 40 40" width="72" height="72" fill="none" stroke="#fafafa" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Zorvo">
          <path pathLength="1" d="M6 7l10 7-10 7" />
          <path pathLength="1" d="M18 19l10 7-10 7" />
          <path pathLength="1" d="M30 33h5" />
        </svg>
        <h2 className="lp-h2" data-r="" id="download-title">Every agent, one prompt.</h2>
        <p className="lp-lead" data-r="">
          Download Zorvo, open a folder and pick the agent you already use. Zorvo installs the rest, and keeps itself up to date.
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-2" data-r="">
          <a className="focus-ring lp-btn lp-btn-primary" data-press="" href={LINKS.download}>
            <svg className="lp-ico" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 4v11" />
              <path d="M7 11l5 5 5-5" />
              <path d="M5 20h14" />
            </svg>
            Download for Mac
          </a>
          <a className="focus-ring lp-btn lp-btn-outline" data-press="" href={LINKS.installGuide}>
            Read the install guide
          </a>
        </div>
        <p className="flex flex-wrap justify-center items-baseline gap-x-5 gap-y-1.5 text-[14px] leading-5.5 text-fg-subtle" data-r="">
          <span>
            <b className="font-mono text-[15px] font-medium text-fg" data-downloads="">{downloads}</b>
            {" "}
            downloads
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Version
            {" "}
            <span className="font-mono text-fg-secondary">{latestVersion()}</span>
          </span>
          <span aria-hidden="true">·</span>
          <span>Signed with a Developer ID and notarized by Apple</span>
        </p>
      </div>
    </section>
  );
}
