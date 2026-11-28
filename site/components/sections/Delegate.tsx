import { LINKS } from "../../lib/links";
import { AgentTile } from "../ui/AgentTile";

export function Delegate() {
  return (
    <section className="lp-sec" id="delegate" aria-labelledby="delegate-title">
      <div className="lp-wrap">
        <div className="lp-head" data-reveal="">
          <p className="lp-eyebrow" data-r="">Delegate</p>
          <h2 className="lp-h2" data-r="" id="delegate-title">Agents hand work to each other.</h2>
          <p className="lp-lead" data-r="">
            Give a task to another agent yourself, or let an agent ask for workers. Each works in a session of its own, and the reports come back to the session that asked.
          </p>
        </div>
        <div className="lp-ui flex flex-wrap items-stretch gap-0" data-dlg="" role="img" aria-label="An agent starting workers. In a Claude Code session, a card from Zorvo reads Claude Code wants to give other agents 2 tasks: tests for the discount totals for Codex, and the checkout docs for Qwen Code in its own worktree. It was allowed for this session. Codex and Qwen Code each work in a session of their own, and one message headed Worker reports returns to the first session: worker-1, Codex, Succeeded, and worker-2, Qwen Code, Succeeded.">
          <div className="lp-card flex-[1_1_400px] min-w-0 flex flex-col bg-bg" data-dlg-pane="">
            <span className="lp-tb">
              <AgentTile agent="Claude Code" size="small" logo={12} />
              <b className="font-semibold text-fg truncate">Add discount codes to checkout</b>
              <span className="flex-1" />
              <span className="lp-sub whitespace-nowrap">Claude Code</span>
            </span>
            <span className="flex-1 flex flex-col gap-3.5 py-4.5 px-4">
              <span>The tests and the docs can run beside this. I will hand them to two workers.</span>
              <span className="lp-card flex flex-col gap-2.5 py-3 px-3.5" data-dlg-card="">
                <b className="font-medium text-fg">Claude Code wants to give other agents 2 tasks</b>
                <span className="flex flex-col gap-0.5">
                  <span className="lp-sub">For Codex:</span>
                  <span className="text-fg-secondary">Write tests for the discount totals</span>
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="lp-sub">For Qwen Code, in its own worktree:</span>
                  <span className="text-fg-secondary">Update the checkout docs</span>
                </span>
                {/* The buttons show only until the card is answered, as in the app. */}
                <span className="lp-stack">
                  <span className="lp-brief flex flex-wrap justify-end gap-2" data-dlg-ask="">
                    <span className="lp-ob">Deny</span>
                    <span className="lp-pb" data-dlg-allow="">Allow for this session</span>
                  </span>
                  <span className="lp-sub self-center" data-dlg-allowed="">Allowed for this session</span>
                </span>
              </span>
              {/* The status lines hold the report's place while the workers run, and go when it arrives. */}
              <span className="lp-stack">
                <span className="lp-brief self-start flex flex-col gap-1.5 text-fg-muted text-[12px]" data-dlg-status="">
                  <span className="flex items-center gap-2">
                    <span className="lp-dot lp-pulse bg-status-running" />
                    Codex is working on the task you delegated
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="lp-dot lp-pulse bg-status-running" />
                    Qwen Code is working on the task you delegated
                  </span>
                </span>
                <span className="lp-bub max-w-full self-stretch flex flex-col gap-1.5" data-dlg-report="">
                  <b className="font-medium text-fg">Worker reports</b>
                  <span className="flex items-center gap-2 text-[12px]">
                    <span className="font-mono text-fg">worker-1</span>
                    <span className="text-fg-muted">Codex</span>
                    <span className="flex-1" />
                    <span className="text-fg-muted">Succeeded</span>
                  </span>
                  <span className="flex items-center gap-2 text-[12px]">
                    <span className="font-mono text-fg">worker-2</span>
                    <span className="text-fg-muted">Qwen Code</span>
                    <span className="flex-1" />
                    <span className="text-fg-muted">Succeeded</span>
                  </span>
                </span>
              </span>
            </span>
          </div>
          <div className="lp-wire flex-[0_0_72px] items-center" aria-hidden="true">
            <span className="relative block w-full h-[1px] bg-(--lp-strong)">
              <span className="lp-wire-dot absolute -top-1 left-[0%] w-[9px] h-[9px] -ml-1 rounded-full bg-fg" data-dlg-dot="" />
            </span>
          </div>
          <div className="flex-[1_1_400px] min-w-0 flex flex-col gap-4 max-[860px]:mt-4">
            <div className="lp-card flex-1 min-w-0 flex flex-col bg-bg" data-dlg-pane="">
              <span className="lp-tb">
                <AgentTile agent="Codex" size="small" logo={12} />
                <b className="font-semibold text-fg truncate">Write tests for the discount totals</b>
                <span className="flex-1" />
                <span className="lp-sub whitespace-nowrap">Codex · worker-1</span>
              </span>
              <span className="flex-1 flex flex-col gap-3 py-3.5 px-4">
                <span className="lp-card flex flex-col overflow-hidden" data-dlg-b="">
                  <span className="lp-tool">
                    <svg className="lp-ico w-3.5 h-3.5" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 8l4 4-4 4" />
                      <path d="M12 17h7" />
                    </svg>
                    Ran
                    <span className="font-mono text-[12px] truncate">pnpm test totals</span>
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
              </span>
            </div>
            <div className="lp-card flex-1 min-w-0 flex flex-col bg-bg" data-dlg-pane="">
              <span className="lp-tb">
                <AgentTile agent="Qwen Code" size="small" logo={12} />
                <b className="font-semibold text-fg truncate">Update the checkout docs</b>
                <span className="flex-1" />
                <span className="lp-sub whitespace-nowrap">Qwen Code · worker-2</span>
              </span>
              <span className="flex-1 flex flex-col gap-3 py-3.5 px-4">
                <span className="lp-card flex flex-col overflow-hidden" data-dlg-b="">
                  <span className="lp-tool">
                    <svg className="lp-ico w-3.5 h-3.5" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4 20l4-1 11-11-3-3L5 16z" />
                    </svg>
                    Edited
                    <span className="font-mono text-[12px] truncate">docs/checkout.md</span>
                    <span className="flex-1" />
                    <span className="font-mono lp-sub text-status-running">+31</span>
                  </span>
                </span>
                <span data-dlg-b="">
                  Documented discount codes in
                  {" "}
                  <span className="font-mono text-[12px]">docs/checkout.md</span>
                  , on a branch of its own.
                </span>
              </span>
            </div>
          </div>
        </div>
        <ul className="lp-pts grid grid-cols-3 max-[860px]:grid-cols-1 gap-x-12 gap-y-8 mt-14" data-reveal="">
          <li data-r="">
            <h3>You hand it over</h3>
            <p>
              Type @ in the message box, pick an agent and say what it should do. It works in the same folder as the session you are in.
            </p>
          </li>
          <li data-r="">
            <h3>Or the agent asks</h3>
            <p>
              An agent can start several workers, in your folder or each in a worktree of its own. A card shows every task first, and you allow it once for the session.
            </p>
          </li>
          <li data-r="">
            <h3>One report, whatever happened</h3>
            <p>
              Workers report back in one message. It also names a worker that failed, was stopped, or whose agent exited.
            </p>
          </li>
        </ul>
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
