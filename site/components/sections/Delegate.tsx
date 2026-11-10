import { LINKS } from "../../lib/links";

export function Delegate() {
  return (
    <section className="lp-sec" id="delegate" aria-labelledby="delegate-title">
      <div className="lp-wrap">
        <div className="lp-head" data-reveal="">
          <p className="lp-eyebrow" data-r="">New · Delegate</p>
          <h2 className="lp-h2" data-r="" id="delegate-title">Hand a task to another agent.</h2>
          <p className="lp-lead" data-r="">
            Type @ in the message box, pick an agent and say what it should do. It works in the same folder, and its answer comes back to the session that asked.
          </p>
        </div>
        <div className="lp-ui flex flex-wrap items-stretch gap-0" data-dlg="" role="img" aria-label="Delegating a task. In a Claude Code session the message at Codex, write tests for the discount totals, is sent with Delegate to Codex. Codex works on it in its own session, edits a test file and runs the tests. Its answer returns to the first session as a message headed From Codex.">
          <div className="lp-card flex-[1_1_400px] min-w-0 min-h-110 flex flex-col bg-bg" data-dlg-pane="">
            <span className="lp-tb">
              <span className="lp-logo lp-logo-s" aria-hidden="true">C</span>
              <b className="font-semibold text-fg">Add discount codes to checkout</b>
              <span className="flex-1" />
              <span className="lp-sub">Claude Code</span>
            </span>
            <span className="flex-1 flex flex-col gap-3.5 p-[18px_16px_0]">
              <span className="lp-bub" data-dlg-msg="">
                <span className="text-status-unread">@Codex</span>
                {" "}
                write tests for the discount totals
              </span>
              <span className="flex items-center gap-2 text-fg-muted text-[12px]" data-dlg-status="">
                <span className="lp-dot lp-pulse bg-status-running" />
                Codex is working on the task you delegated
              </span>
              <span className="lp-card flex flex-col gap-1.5 py-3 px-3.5" data-dlg-report="">
                <span className="flex items-center gap-2">
                  <span className="lp-logo lp-logo-s" aria-hidden="true">X</span>
                  <b className="font-medium text-fg">From Codex</b>
                </span>
                <span>
                  Added 6 tests in
                  {" "}
                  <span className="font-mono text-[12px]">totals.test.ts</span>
                  {" "}
                  for percent and fixed codes. All pass.
                </span>
              </span>
            </span>
            <span className="relative p-[14px_16px_16px]">
              <span className="lp-pop lp-card absolute left-4 bottom-24 w-60 flex flex-col gap-0.5 p-1.5 bg-surface-3 shadow-popover" data-dlg-pop="">
                <span className="lp-sub p-[4px_8px_6px] font-medium text-fg-muted">Delegate to an agent</span>
                <span className="flex items-center gap-2 h-7.5 py-0 px-2 rounded-md bg-surface-hover text-fg">
                  <span className="lp-logo lp-logo-s" aria-hidden="true">X</span>
                  Codex
                  <span className="flex-1" />
                  <span className="lp-sub">Ready</span>
                </span>
                <span className="flex items-center gap-2 h-7.5 py-0 px-2">
                  <span className="lp-logo lp-logo-s" aria-hidden="true">Q</span>
                  Qwen Code
                  <span className="flex-1" />
                  <span className="lp-sub">Ready</span>
                </span>
                <span className="flex items-center gap-2 h-7.5 py-0 px-2">
                  <span className="lp-logo lp-logo-s" aria-hidden="true">G</span>
                  Gemini CLI
                  <span className="flex-1" />
                  <span className="lp-sub">Sign in</span>
                </span>
              </span>
              <span className="lp-comp">
                <span className="lp-stack text-[13px]">
                  <span className="text-fg-subtle" data-dlg-ph="">Reply to Claude Code</span>
                  <span className="lp-typed text-fg" data-dlg-type="">
                    <span className="text-status-unread">@Codex</span>
                    {" "}
                    write tests for the discount totals
                  </span>
                </span>
                <span className="flex items-center gap-2 max-[520px]:flex-wrap">
                  <span className="lp-chip">
                    <span className="lp-logo lp-logo-s" aria-hidden="true">C</span>
                    Claude Code
                  </span>
                  <span className="lp-chip">Sonnet</span>
                  <span className="flex-1" />
                  <span className="lp-pb" data-dlg-send="">Delegate to Codex</span>
                </span>
              </span>
            </span>
          </div>
          <div className="lp-wire flex-[0_0_72px] items-center" aria-hidden="true">
            <span className="relative block w-full h-[1px] bg-(--lp-strong)">
              <span className="lp-wire-dot absolute -top-1 left-[0%] w-[9px] h-[9px] -ml-1 rounded-full bg-fg" data-dlg-dot="" />
            </span>
          </div>
          <div className="lp-card flex-[1_1_400px] min-w-0 min-h-110 flex flex-col bg-bg" data-dlg-pane="">
            <span className="lp-tb">
              <span className="lp-logo lp-logo-s" aria-hidden="true">X</span>
              <b className="font-semibold text-fg">Write tests for the discount totals</b>
              <span className="flex-1" />
              <span className="lp-sub">Codex · delegated</span>
            </span>
            <span className="flex-1 flex flex-col gap-3.5 py-4.5 px-4">
              <span className="lp-sub" data-dlg-b="">
                Delegated from Add discount codes to checkout · Claude Code
              </span>
              <span className="lp-bub" data-dlg-b="">write tests for the discount totals</span>
              <span className="lp-card flex flex-col overflow-hidden" data-dlg-b="">
                <span className="lp-tool">
                  <svg className="lp-ico w-3.5 h-3.5" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 20l4-1 11-11-3-3L5 16z" />
                  </svg>
                  Edited
                  <span className="font-mono text-[12px]">src/checkout/totals.test.ts</span>
                  <span className="flex-1" />
                  <span className="font-mono lp-sub text-status-running">+48</span>
                </span>
                <span className="lp-tool">
                  <svg className="lp-ico w-3.5 h-3.5" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 8l4 4-4 4" />
                    <path d="M12 17h7" />
                  </svg>
                  Ran
                  <span className="font-mono text-[12px]">pnpm test totals</span>
                  <span className="flex-1" />
                  <span className="lp-sub">Done</span>
                </span>
              </span>
              <span data-dlg-b="">
                Added 6 tests in
                {" "}
                <span className="font-mono text-[12px]">totals.test.ts</span>
                {" "}
                for percent and fixed codes. All pass.
              </span>
              <span className="lp-sub mt-auto" data-dlg-b="">
                This answer is sent back to the session that delegated it.
              </span>
            </span>
          </div>
        </div>
        <p className="flex justify-center mt-8">
          <a className="focus-ring lp-more" href={LINKS.delegateGuide}>
            How delegating works
            <svg className="lp-ico" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h14" />
              <path d="M13 6l6 6-6 6" />
            </svg>
          </a>
        </p>
      </div>
    </section>
  );
}
