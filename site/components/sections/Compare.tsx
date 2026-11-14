import { LINKS } from "../../lib/links";
import { AgentTile } from "../ui/AgentTile";

export function Compare() {
  return (
    <section className="lp-sec" id="compare" aria-labelledby="compare-title">
      <div className="lp-wrap">
        <div className="lp-head" data-reveal="">
          <p className="lp-eyebrow" data-r="">Compare</p>
          <h2 className="lp-h2" data-r="" id="compare-title">One prompt. Up to four agents.</h2>
          <p className="lp-lead" data-r="">
            Each agent works in its own git worktree, so none touches another's files. Read the numbers, open a diff, keep one.
          </p>
        </div>
        <div className="lp-ui max-w-190 mx-auto flex flex-col gap-4" data-compare="" role="img" aria-label="A compare run. One prompt, Add discount codes to checkout, goes to Claude Code, Codex and Qwen Code. Each finishes with its own changes: 4 files, 3 files and 2 files. Claude Code is picked, and a bar asks to keep its work and archive the others.">
          <div className="lp-comp" data-cmp-prompt="">
            <span className="lp-stack text-[14px] leading-5">
              <span className="text-fg" data-cmp-type="">Add discount codes to checkout</span>
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <span className="lp-chip" data-cmp-chip="">
                <AgentTile agent="Claude Code" size="small" logo={12} />
                Claude Code
              </span>
              <span className="lp-chip" data-cmp-chip="">
                <AgentTile agent="Codex" size="small" logo={12} />
                Codex
              </span>
              <span className="lp-chip" data-cmp-chip="">
                <AgentTile agent="Qwen Code" size="small" logo={12} />
                Qwen Code
              </span>
              <span className="flex-1" />
              <span className="lp-pb" data-cmp-start="">Start 3 sessions</span>
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="lp-card flex flex-col gap-2.5 py-3.5 px-4 border-border-strong" data-cmp-card="" data-cmp-win="">
              <span className="flex items-center gap-3.5 max-[520px]:flex-wrap max-[520px]:gap-y-2">
                <AgentTile agent="Claude Code" size="large" logo={16} />
                <span className="flex-1 min-w-0 flex flex-col max-[520px]:basis-30">
                  <b className="font-medium text-fg">Claude Code</b>
                  <span className="lp-stack text-[12px]">
                    <span className="lp-st-a flex items-center gap-1.5">
                      <span className="lp-dot bg-status-running" />
                      Working
                    </span>
                    <span className="lp-st-b flex items-center gap-1.5">
                      <span className="lp-dot bg-status-unread" />
                      Finished · 2 min
                    </span>
                  </span>
                </span>
                <span className="font-mono flex gap-1.5 text-[11px] text-fg-muted">
                  4 files
                  <span className="text-status-running">
                    +
                    <span data-count="59">59</span>
                  </span>
                  <span className="text-danger">−4</span>
                </span>
                <span className="lp-gb">Open</span>
                <span className="lp-ob bg-surface-hover text-fg">Pick</span>
              </span>
              <span className="lp-bar">
                <i />
              </span>
            </div>
            <div className="lp-card flex flex-col gap-2.5 py-3.5 px-4" data-cmp-card="">
              <span className="flex items-center gap-3.5 max-[520px]:flex-wrap max-[520px]:gap-y-2">
                <AgentTile agent="Codex" size="large" logo={16} />
                <span className="flex-1 min-w-0 flex flex-col max-[520px]:basis-30">
                  <b className="font-medium text-fg">Codex</b>
                  <span className="lp-stack text-[12px]">
                    <span className="lp-st-a flex items-center gap-1.5">
                      <span className="lp-dot bg-status-running" />
                      Working
                    </span>
                    <span className="lp-st-b flex items-center gap-1.5">
                      <span className="lp-dot bg-status-unread" />
                      Finished · 1 min
                    </span>
                  </span>
                </span>
                <span className="font-mono flex gap-1.5 text-[11px] text-fg-muted">
                  3 files
                  <span className="text-status-running">
                    +
                    <span data-count="36">36</span>
                  </span>
                  <span className="text-danger">−4</span>
                </span>
                <span className="lp-gb">Open</span>
                <span className="lp-ob">Pick</span>
              </span>
              <span className="lp-bar">
                <i />
              </span>
            </div>
            <div className="lp-card flex flex-col gap-2.5 py-3.5 px-4" data-cmp-card="">
              <span className="flex items-center gap-3.5 max-[520px]:flex-wrap max-[520px]:gap-y-2">
                <AgentTile agent="Qwen Code" size="large" logo={16} />
                <span className="flex-1 min-w-0 flex flex-col max-[520px]:basis-30">
                  <b className="font-medium text-fg">Qwen Code</b>
                  <span className="lp-stack text-[12px]">
                    <span className="lp-st-a flex items-center gap-1.5">
                      <span className="lp-dot bg-status-running" />
                      Working
                    </span>
                    <span className="lp-st-b flex items-center gap-1.5">
                      <span className="lp-dot bg-status-unread" />
                      Finished · 3 min
                    </span>
                  </span>
                </span>
                <span className="font-mono flex gap-1.5 text-[11px] text-fg-muted">
                  2 files
                  <span className="text-status-running">
                    +
                    <span data-count="12">12</span>
                  </span>
                  <span className="text-danger">−1</span>
                </span>
                <span className="lp-gb">Open</span>
                <span className="lp-ob">Pick</span>
              </span>
              <span className="lp-bar">
                <i />
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 py-3.5 px-4 rounded-xl bg-surface-3 border border-border shadow-popover" data-cmp-confirm="">
            <span className="flex-[1_1_320px] text-fg">Keep Claude Code's work and archive the others?</span>
            <span className="lp-gb">Cancel</span>
            <span className="lp-pb">Pick Claude Code</span>
          </div>
        </div>
        <p className="flex justify-center mt-8">
          <a className="focus-ring lp-more" href={LINKS.compareGuide}>
            How compare runs work
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
