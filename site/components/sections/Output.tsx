import type { ReactNode } from "react";
import { LINKS } from "../../lib/links";

/** A number as the page draws it on a commented part, and as the list under the page repeats it. */
function Mark({ n, className = "", isOnPage = false }: { n: number; className?: string; isOnPage?: boolean }) {
  return (
    <span data-out-mark={isOnPage ? "" : undefined} className={`inline-flex items-center justify-center w-4 h-4 rounded-full bg-mark text-on-mark text-[10px] font-semibold flex-none ${className}`}>
      {n}
    </span>
  );
}

function Step({ label, note, children }: { label: string; note: string; children?: ReactNode }) {
  return (
    <span className="lp-card flex-1 min-w-0 flex flex-col gap-1 p-3" data-out-node="">
      <span className="flex items-center gap-1.5 font-mono text-[12px] text-fg">
        <span className="truncate">{label}</span>
        {children}
      </span>
      <span className="text-[11px] leading-4 text-fg-muted">{note}</span>
    </span>
  );
}

function Then() {
  return (
    <svg className="lp-ico w-3.5 h-3.5 self-center text-fg-subtle max-[520px]:rotate-90" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

export function Output() {
  return (
    <section className="lp-sec" id="output" aria-labelledby="output-title">
      <div className="lp-wrap lp-row">
        <div className="lp-col" data-reveal="">
          <p className="lp-eyebrow" data-r="">Output</p>
          <h2 className="lp-h2" data-r="" id="output-title">See the answer beside the chat.</h2>
          <p className="lp-lead" data-r="">
            A report, a diagram or a mockup opens as a page in the Output tab. The agent can show one on its own when an answer is better seen than read.
          </p>
          <ul className="lp-pts" data-r="">
            <li>
              <h3>Comment on what you see</h3>
              <p>
                Press Comment, select text or click a part of the page, and write what should change. Comments are numbered on the page and go into your next message.
              </p>
            </li>
            <li>
              <h3>Every change is a version</h3>
              <p>Each time the agent changes the page you get a new version, and you can go back to an older one. Export saves the page as one HTML file.</p>
            </li>
            <li>
              <h3>Kept apart from your files</h3>
              <p>
                A page runs in its own part of the window. It cannot call Zorvo or read your files, and it loads scripts and fonts only from a short list of public hosts.
              </p>
            </li>
          </ul>
          <p data-r="">
            <a className="focus-ring lp-more" href={LINKS.outputGuide}>
              How pages work
              <svg className="lp-ico" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h14" />
                <path d="M13 6l6 6-6 6" />
              </svg>
            </a>
          </p>
        </div>
        <div className="lp-col basis-130">
          <div className="lp-card lp-ui flex flex-col overflow-hidden bg-bg" data-out="" role="img" aria-label="A page in the Output tab, titled Login redirect flow, version 2, with Comment and Export above it. The page is a diagram of three steps: a visit to /checkout, the requireUser check, and the redirect to /login with the page to come back to. A comment numbered 1 on requireUser reads Show what happens when the session has expired, marked Current, and a button offers Add 1 to message.">
            <span className="lp-tool h-11 text-fg">
              <b className="font-semibold truncate">Login redirect flow</b>
              <span className="lp-chip">Version 2</span>
              <span className="flex-1" />
              <span className="lp-gb max-[520px]:hidden">Comment</span>
              <span className="lp-ob">Export</span>
            </span>
            <span className="flex flex-col gap-3 p-4 border-t border-border">
              <span className="text-[15px] font-medium text-fg">Where a signed-out visit goes</span>
              <span className="flex items-stretch gap-2 max-[520px]:flex-col">
                <Step label="/checkout" note="A visit without a session." />
                <Then />
                <Step label="requireUser" note="Builds the redirect.">
                  <Mark n={1} isOnPage />
                </Step>
                <Then />
                <Step label="/login?next=" note="Carries the page to come back to." />
              </span>
              <span className="text-[12px] leading-5 text-fg-muted">
                Before the fix, a visit to /login was sent to /login again, with itself as the page to come back to.
              </span>
            </span>
            <span className="flex items-start gap-2.5 py-3 px-4 border-t border-border" data-out-comment="">
              <Mark n={1} className="mt-px" />
              <span className="min-w-0 flex flex-col gap-0.5">
                <span className="lp-sub">
                  <b className="font-medium text-fg-secondary">requireUser</b>
                  {" "}
                  · Current
                </span>
                <span className="text-fg">Show what happens when the session has expired.</span>
              </span>
            </span>
            <span className="flex justify-end p-[0_16px_14px]" data-out-bar="">
              <span className="lp-pb">Add 1 to message</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
