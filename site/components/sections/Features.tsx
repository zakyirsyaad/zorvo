export function Features() {
  return (
    <section className="lp-sec" id="features" aria-labelledby="features-title">
      <div className="lp-wrap">
        <div className="lp-head" data-reveal="">
          <h2 className="lp-h2" data-r="" id="features-title">One app. Each agent as it really is.</h2>
          <p className="lp-lead" data-r="">
            Sessions, worktrees, a terminal, a browser, files and diffs sit around the agent, never in its way.
          </p>
        </div>
        <ul className="lp-grid" data-reveal="">
          <li className="lp-cell" data-r="" data-cell="">
            <span className="font-mono lp-sub">01</span>
            <h3>Every choice the agent offers</h3>
            <p>
              Models, modes and other settings each get a chip with the agent's own description.
            </p>
          </li>
          <li className="lp-cell" data-r="" data-cell="">
            <span className="font-mono lp-sub">02</span>
            <h3>Install agents from Zorvo</h3>
            <p>
              Pick an agent and click Install. Zorvo brings Node.js or uv when it needs them.
            </p>
          </li>
          <li className="lp-cell" data-r="" data-cell="">
            <span className="font-mono lp-sub">03</span>
            <h3>See which agents are ready</h3>
            <p>
              Ready, Sign in or Not checked for each agent. Its own login runs in a terminal in the app.
            </p>
          </li>
          <li className="lp-cell" data-r="" data-cell="">
            <span className="font-mono lp-sub">04</span>
            <h3>One inspector beside the chat</h3>
            <p>
              Changes, Activity, Files, Output, Browser and Terminal in one panel. Its shells keep running when you close it.
            </p>
          </li>
          <li className="lp-cell" data-r="" data-cell="">
            <span className="font-mono lp-sub">05</span>
            <h3>A browser beside the chat</h3>
            <p>
              Open a link or an address in the Browser tab. An agent may use it only after you allow it for the session, and sending a file asks again.
            </p>
          </li>
          <li className="lp-cell" data-r="" data-cell="">
            <span className="font-mono lp-sub">06</span>
            <h3>A session overview</h3>
            <p>
              A card beside the chat says what is running, what changed, which files you attached and where the pull request stands.
            </p>
          </li>
          <li className="lp-cell" data-r="" data-cell="">
            <span className="font-mono lp-sub">07</span>
            <h3>Pull requests in the sidebar</h3>
            <p>
              A session whose branch has a pull request shows its number and state. Zorvo reads them with your own gh.
            </p>
          </li>
          <li className="lp-cell" data-r="" data-cell="">
            <span className="font-mono lp-sub">08</span>
            <h3>Follow a subagent</h3>
            <p>
              A subagent or a command the agent started opens as a tab. With Claude Code and Qwen Code you see its steps as they arrive.
            </p>
          </li>
          <li className="lp-cell" data-r="" data-cell="">
            <span className="font-mono lp-sub">09</span>
            <h3>See what fills the context</h3>
            <p>
              Click the context meter to see how full the window is, how it grew turn by turn, and what the session cost.
            </p>
          </li>
          <li className="lp-cell" data-r="" data-cell="">
            <span className="font-mono lp-sub">10</span>
            <h3>Read a file in place</h3>
            <p>
              Click a file to read it with its changed lines marked, and add the lines you select to your message.
            </p>
          </li>
          <li className="lp-cell" data-r="" data-cell="">
            <span className="font-mono lp-sub">11</span>
            <h3>Fork and rewind</h3>
            <p>
              Fork any reply into a new session. Or rewind to before a message and send it again, edited.
            </p>
          </li>
          <li className="lp-cell" data-r="" data-cell="">
            <span className="font-mono lp-sub">12</span>
            <h3>When a turn goes wrong</h3>
            <p>
              A failed turn says what happened in plain words, with Try again. An agent that ignores Stop can be ended.
            </p>
          </li>
        </ul>
      </div>
    </section>
  );
}
