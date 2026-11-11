export function LongSessions() {
  return (
    <section className="border-t border-border py-20 px-0 bg-surface-1" aria-label="Long sessions">
      <div className="lp-wrap flex flex-col gap-10" data-stats="">
        <h2 className="text-[28px] leading-9 font-medium tracking-[-0.025em] text-fg">
          Stays fast when a session gets long.
        </h2>
        <div className="flex flex-wrap gap-10">
          <p className="lp-stat">
            <b>
              <span data-count="9" data-from="43">9</span>
              {" "}
              MB
            </b>
            <span className="text-fg-muted">
              A long session's saved history, down from 43 MB. Zorvo keeps the lines the chat shows, not whole files.
            </span>
          </p>
          <p className="lp-stat">
            <b>
              <span data-count="263" data-from="42099">263</span>
            </b>
            <span className="text-fg-muted">
              Elements drawn per update in a long turn, down from 42,099. Only the tool that changed is drawn again.
            </span>
          </p>
          <p className="lp-stat">
            <b>
              <span data-count="4">4</span>
              {" "}
              agents
            </b>
            <span className="text-fg-muted">On one prompt at once, each in its own worktree.</span>
          </p>
        </div>
      </div>
    </section>
  );
}
