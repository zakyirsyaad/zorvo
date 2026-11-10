export function Privacy() {
  return (
    <section className="lp-sec" id="privacy" aria-labelledby="privacy-title">
      <div className="lp-wrap lp-row">
        <div className="lp-col basis-130" data-reveal="">
          <p className="lp-eyebrow" data-r="">Privacy</p>
          <h2 className="lp-h2" data-r="" id="privacy-title">Nothing kept for itself.</h2>
          <p className="lp-lead" data-r="">
            Zorvo sits between you and your agents and keeps nothing for itself.
          </p>
          <ul className="lp-pts grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-y-7 gap-x-8" data-r="">
            <li>
              <h3>Sign-in stays with the agents</h3>
              <p>
                Zorvo never asks you for an API key or token. Agents sign in with their own tools, and GitHub goes through your own gh.
              </p>
            </li>
            <li>
              <h3>Your data, on your Mac</h3>
              <p>
                Sessions, transcripts, worktrees and installed agents live in one folder you can open in Finder.
              </p>
            </li>
            <li>
              <h3>Only the folders you open</h3>
              <p>The backend reads and runs only in folders you opened in the app.</p>
            </li>
            <li>
              <h3>Few requests, all named</h3>
              <p>
                The ACP registry, a daily check for a newer Zorvo, and an agent's download when you click Install.
              </p>
            </li>
          </ul>
          <p className="max-w-140 text-[14px] leading-5.5 text-fg-subtle" data-r="">
            Private mode is the one exception, and only while you have it on: Zorvo then keeps a NEAR AI key in your Keychain and talks to NEAR AI and the credits server.
            {" "}
            <a className="focus-ring text-fg-secondary underline decoration-(--lp-strong) underline-offset-3" href="#private">
              See Private mode
            </a>
          </p>
        </div>
        <div className="lp-col basis-105">
          <div className="lp-term font-mono text-[12px] leading-5 text-fg-secondary" data-term="" role="img" aria-label="A terminal listing the folder where Zorvo keeps its data: state.json, tools, transcripts and worktrees.">
            <span className="flex items-center gap-2 h-9 py-0 px-3.5 border-b border-border">
              <span className="lp-dot w-2.5 h-2.5 bg-surface-hover" />
              <span className="lp-dot w-2.5 h-2.5 bg-surface-hover" />
              <span className="lp-dot w-2.5 h-2.5 bg-surface-hover" />
              <span className="lp-sub ml-2">zsh</span>
            </span>
            <span className="flex flex-col gap-0.5 py-4.5 px-5 overflow-hidden">
              <span className="whitespace-nowrap">
                <span className="text-fg-subtle">~ %</span>
                {" "}
                <span className="inline-block align-top" data-term-type="">
                  ls ~/Library/Application\ Support/xyz.zorvo.desktop
                </span>
              </span>
              <span data-term-out="">state.json</span>
              <span data-term-out="">tools</span>
              <span data-term-out="">transcripts</span>
              <span data-term-out="">worktrees</span>
              <span data-term-out="">
                <span className="text-fg-subtle">~ %</span>
                {" "}
                <span className="lp-cursor" />
              </span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
