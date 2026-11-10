export function Sessions() {
  return (
    <section className="lp-sec" id="sessions" aria-labelledby="sessions-title">
      <div className="lp-wrap lp-row">
        <div className="lp-col" data-reveal="">
          <p className="lp-eyebrow" data-r="">Sessions</p>
          <h2 className="lp-h2" data-r="" id="sessions-title">
            One project.
            <br />
            Many agents.
          </h2>
          <p className="lp-lead" data-r="">
            Give the feature to Claude Code, the bug to Codex and the refactor to Qwen Code. Every session sits under its folder and says who runs it and what it is doing.
          </p>
          <ul className="lp-pts" data-r="">
            <li>
              <h3>Each session picks its own agent</h3>
              <p>With that agent's own models, effort and modes, as it reports them.</p>
            </li>
            <li>
              <h3>A worktree when you want one</h3>
              <p>
                Turn on New worktree to give a session its own copy on an
                {" "}
                <span className="font-mono lp-chip h-5.5">{"agent/<title>"}</span>
                {" "}
                branch.
              </p>
            </li>
            <li>
              <h3>A sidebar that says who waits</h3>
              <p>Working, Waiting for you, Finished, unread. A folded folder still says 1 waiting.</p>
            </li>
          </ul>
        </div>
        <div className="lp-col basis-95 items-center">
          <div className="lp-ui lp-card w-full max-w-95 flex flex-col gap-1 p-3 bg-surface-1" data-reveal="" role="img" aria-label="The sidebar's acme-shop folder with four sessions: Claude Code working on discount codes, Codex waiting for you on the login fix, Qwen Code finished and unread on the orders client, and Gemini CLI started three hours ago.">
            <span className="flex items-center gap-2 py-1.5 px-2.5 text-[12px] text-fg" data-r="">
              <svg className="lp-ico w-3.5 h-3.5" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
              acme-shop
              <span className="flex-1" />
              <span className="lp-sub">4 sessions</span>
            </span>
            <span className="lp-sr lp-sr-on py-2.5 px-3" data-r="">
              <b>Add discount codes to checkout</b>
              <span>
                <span className="lp-logo lp-logo-s" aria-hidden="true">C</span>
                Claude Code ·
                <span className="lp-dot lp-pulse bg-status-running" />
                Working
              </span>
            </span>
            <span className="lp-sr py-2.5 px-3" data-r="">
              <b>Fix login redirect loop</b>
              <span>
                <span className="lp-logo lp-logo-s" aria-hidden="true">X</span>
                Codex ·
                <span className="lp-dot bg-status-attention" />
                Waiting for you
              </span>
            </span>
            <span className="lp-sr py-2.5 px-3" data-r="">
              <b>Refactor orders API client</b>
              <span>
                <span className="lp-logo lp-logo-s" aria-hidden="true">Q</span>
                Qwen Code ·
                <span className="lp-dot bg-status-unread" />
                Finished, unread
              </span>
            </span>
            <span className="lp-sr py-2.5 px-3" data-r="">
              <b>Review the pricing copy</b>
              <span>
                <span className="lp-logo lp-logo-s" aria-hidden="true">G</span>
                Gemini CLI · 3 hours ago
              </span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
