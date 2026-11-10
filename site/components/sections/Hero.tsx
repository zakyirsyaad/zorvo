import { LINKS } from "../../lib/links";

export function Hero() {
  return (
    <section className="p-[88px_0_112px]" id="top" data-hero="" aria-labelledby="hero-title">
      <div className="lp-wrap flex flex-col items-center gap-7 text-center">
        <a className="focus-ring inline-flex items-center gap-2.5 min-h-11 text-[14px] leading-5 text-fg-secondary" data-hero-fade="" href="#private">
          <span className="inline-flex items-center h-5.5 py-0 px-2 rounded-md bg-fg text-on-primary text-[12px] font-semibold">
            New
          </span>
          <img className="block w-8 h-8" src="/near-ai-tile-white.svg" alt="NEAR AI" width="32" height="32" />
          Optional private mode on NEAR AI Cloud
          <svg className="lp-ico w-3.5 h-3.5 text-fg-subtle" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14" />
            <path d="M13 6l6 6-6 6" />
          </svg>
        </a>
        <h1 className="text-[clamp(34px,9.4vw,76px)] leading-[clamp(35px,9.65vw,78px)] font-medium tracking-[-0.04em] text-fg" id="hero-title">
          <span className="lp-ln">
            <span>Every coding agent.</span>
          </span>
          <span className="lp-ln">
            <span>One desktop.</span>
          </span>
        </h1>
        <p className="max-w-160 text-[19px] leading-7.5 text-fg-muted" data-hero-fade="">
          Claude Code, Codex, Qwen Code and the agents of the ACP registry in one native Mac app. Put them on one project, send one prompt to four, or hand a task from one to another. No lock-in, no API keys.
        </p>
        <div className="flex flex-wrap justify-center gap-3" data-hero-fade="">
          <a className="focus-ring lp-btn lp-btn-primary" data-press="" href={LINKS.download}>
            <svg className="lp-ico" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 4v11" />
              <path d="M7 11l5 5 5-5" />
              <path d="M5 20h14" />
            </svg>
            Download for Mac
          </a>
          <a className="focus-ring lp-btn lp-btn-outline" data-press="" href={LINKS.docs}>
            Read the docs
            <svg className="lp-ico" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h14" />
              <path d="M13 6l6 6-6 6" />
            </svg>
          </a>
        </div>
        <p className="text-[14px] leading-5.5 text-fg-subtle" data-hero-fade="">
          Free and open source under Apache 2.0, for Macs with Apple silicon or Intel.
        </p>
      </div>
      <div className="lp-wrap mt-16">
        <div className="lp-win lp-ui" data-win="" role="img" aria-label="Zorvo's window. The sidebar lists one project, acme-shop, with a compare run and sessions run by Codex, Qwen Code and Claude Code. The chat shows Codex fixing a login redirect loop, with the file it read and its edit.">
          <div className="lp-sb">
            <span className="flex gap-2 p-[6px_8px_14px]">
              <span className="lp-dot w-3 h-3 bg-[#3f3f46]" />
              <span className="lp-dot w-3 h-3 bg-[#3f3f46]" />
              <span className="lp-dot w-3 h-3 bg-[#3f3f46]" />
            </span>
            <span className="flex items-center gap-2 h-8 py-0 px-2.5 mb-2.5 border border-(--lp-strong) rounded-lg text-fg font-medium" data-srow="">
              <svg className="lp-ico w-3.5 h-3.5" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
              New session
            </span>
            <span className="flex items-center gap-2 py-1.5 px-2.5 text-[12px] text-fg" data-srow="">
              <svg className="lp-ico w-3.5 h-3.5" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
              acme-shop
            </span>
            <span className="lp-sr" data-srow="">
              <b>Compare · 3 agents</b>
              <span>
                <span className="lp-dot lp-pulse bg-status-running" />
                2 working, 1 finished
              </span>
            </span>
            <span className="lp-sr lp-sr-on" data-srow="">
              <b>Fix login redirect loop</b>
              <span>
                <span className="lp-logo lp-logo-s" aria-hidden="true">X</span>
                Codex · Working
              </span>
            </span>
            <span className="lp-sr ml-3.5 border-l border-border rounded-[0_8px_8px_0]" data-srow="">
              <b>Write tests for the redirect</b>
              <span>
                <span className="lp-logo lp-logo-s" aria-hidden="true">Q</span>
                Qwen Code · delegated
              </span>
            </span>
            <span className="lp-sr" data-srow="">
              <b>Refactor orders API client</b>
              <span>
                <span className="lp-logo lp-logo-s" aria-hidden="true">Q</span>
                Qwen Code · Finished, unread
              </span>
            </span>
            <span className="lp-sr" data-srow="">
              <b>Document the checkout flow</b>
              <span>
                <span className="lp-logo lp-logo-s" aria-hidden="true">C</span>
                Claude Code · 3 hours ago
              </span>
            </span>
          </div>
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="lp-tb">
              <b className="font-semibold text-fg">Fix login redirect loop</b>
              <span className="font-mono inline-flex items-center gap-1.5 text-[11px] text-fg-muted">
                <svg className="lp-ico w-3 h-3" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="6" cy="6" r="2" />
                  <circle cx="6" cy="18" r="2" />
                  <circle cx="18" cy="8" r="2" />
                  <path d="M6 8v8" />
                  <path d="M18 10c0 4-6 3-6 6" />
                </svg>
                main
              </span>
              <span className="flex-1" />
              <span className="lp-chip">Plan 2/4</span>
              <span className="lp-chip font-mono">
                <span className="text-status-running">+2</span>
                <span className="text-danger">−1</span>
              </span>
            </div>
            <div className="flex-1 min-h-0 flex flex-col gap-4.5 w-full max-w-160 mx-auto p-[24px_20px_0]">
              <span className="lp-bub" data-chat="">
                Signing in from /login sends me back to /login?next=/login forever. Find the loop and fix it.
              </span>
              <span className="flex items-center gap-2" data-chat="">
                <span className="lp-logo lp-logo-s w-5.5 h-5.5" aria-hidden="true">X</span>
                <b className="font-medium text-fg">Codex</b>
                <span className="lp-sub">now</span>
              </span>
              <span data-chat="">
                Looking at how
                {" "}
                <span className="font-mono lp-chip h-5">requireUser</span>
                {" "}
                builds the redirect.
              </span>
              <span className="lp-card flex flex-col overflow-hidden" data-chat="">
                <span className="lp-tool">
                  <svg className="lp-ico w-3.5 h-3.5" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 3h8l4 4v14H6z" />
                    <path d="M14 3v4h4" />
                  </svg>
                  Read
                  <span className="font-mono text-[12px]">src/auth/session.ts</span>
                  <span className="flex-1" />
                  <span className="lp-sub">Done</span>
                </span>
                <span className="lp-tool">
                  <svg className="lp-ico w-3.5 h-3.5" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 20l4-1 11-11-3-3L5 16z" />
                  </svg>
                  Edited
                  <span className="font-mono text-[12px]">src/auth/session.ts</span>
                  <span className="flex-1" />
                  <span className="font-mono lp-sub">
                    <span className="text-status-running">+2</span>
                    {" "}
                    <span className="text-danger">−1</span>
                  </span>
                </span>
                <span className="font-mono flex flex-col py-1.5 px-0 border-t border-border bg-bg overflow-hidden">
                  <span className="lp-dr lp-dr-del">
                    <i>−</i>
                    {"return redirect(`/login?next=${path}`);"}
                  </span>
                  <span className="lp-dr lp-dr-add">
                    <i>+</i>
                    if (path.startsWith("/login")) return redirect("/login");
                  </span>
                  <span className="lp-dr lp-dr-add">
                    <i>+</i>
                    {"return redirect(`/login?next=${encodeURIComponent(path)}`);"}
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-2 text-fg-muted" data-chat="">
                <span className="lp-dot lp-pulse bg-status-running" />
                Running the auth tests
              </span>
            </div>
            <div className="w-full max-w-160 mx-auto p-[16px_20px_20px]">
              <span className="lp-comp">
                <span className="text-fg-subtle">Reply to Codex</span>
                <span className="flex items-center gap-2">
                  <span className="lp-chip">
                    <span className="lp-logo lp-logo-s" aria-hidden="true">X</span>
                    Codex
                  </span>
                  <span className="lp-chip">gpt-5-codex</span>
                  <span className="lp-chip">Auto</span>
                  <span className="flex-1" />
                  <span className="lp-sub">38% of context</span>
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
