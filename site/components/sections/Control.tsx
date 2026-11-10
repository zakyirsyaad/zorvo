import { AgentTile } from "../ui/AgentTile";

export function Control() {
  return (
    <section className="lp-sec" id="control" aria-labelledby="control-title">
      <div className="lp-wrap lp-row">
        <div className="lp-col" data-reveal="">
          <p className="lp-eyebrow" data-r="">Control</p>
          <h2 className="lp-h2" data-r="" id="control-title">You approve every step.</h2>
          <p className="lp-lead" data-r="">
            Permission requests arrive with the agent's own choices. Its plan stays in sight, and every step it took is in its activity.
          </p>
          <ul className="lp-pts" data-r="">
            <li>
              <h3>Approvals in the chat</h3>
              <p>
                Deny, always allow or allow once, with the files an edit touches. Each session starts in the safest mode its agent has.
              </p>
            </li>
            <li>
              <h3>The plan in the top bar</h3>
              <p>
                The agent's plan shows as 2/4 beside the session's title. Open it to see which step runs now.
              </p>
            </li>
            <li>
              <h3>What the agent did, turn by turn</h3>
              <p>
                Activity lists the files, commands and permissions the agent reported, and the files it did not.
              </p>
            </li>
          </ul>
        </div>
        <div className="lp-col basis-110 items-center">
          <div className="lp-ui w-full max-w-110 flex flex-col gap-3" data-perm="" role="img" aria-label="Codex's plan, three of four steps done, above its permission request: Codex wants to edit 2 files, with Deny, Always allow and Allow once.">
            <span className="lp-chip self-end" data-perm-item="">
              Plan
              {" "}
              <span className="lp-stack font-mono">
                <span className="lp-pl-a">2/4</span>
                <span className="lp-pl-b">3/4</span>
              </span>
            </span>
            <span className="lp-card flex flex-col gap-3 py-3.5 px-4" data-perm-item="">
              <span className="flex items-center gap-2.5">
                <AgentTile agent="Codex" size="large" logo={16} />
                <b className="font-medium text-fg">Codex wants to edit 2 files</b>
              </span>
              <span className="font-mono flex flex-col gap-1.5 text-[12px]">
                <span className="flex gap-2">
                  src/auth/session.ts
                  <span className="flex-1" />
                  <span className="text-status-running">+2</span>
                  <span className="text-danger">−1</span>
                </span>
                <span className="flex gap-2">
                  src/auth/session.test.ts
                  <span className="flex-1" />
                  <span className="text-status-running">+18</span>
                </span>
              </span>
              <span className="flex flex-wrap justify-end gap-2">
                <span className="lp-gb">Deny</span>
                <span className="lp-ob">Always allow</span>
                <span className="lp-pb" data-perm-btn="">Allow once</span>
              </span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
