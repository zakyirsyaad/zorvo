import { AgentTile } from "../ui/AgentTile";

export function Near() {
  return (
    <section className="lp-sec" id="near" aria-labelledby="near-title">
      <div className="lp-wrap">
        <div className="lp-head" data-reveal="">
          <img className="block w-50 h-auto mb-3" data-r="" src="/near-ai-wordmark-white.svg" alt="NEAR AI" width="200" height="38" />
          <h2 className="lp-h2" data-r="" id="near-title">What runs on NEAR.</h2>
          <p className="lp-lead" data-r="">
            Private mode is built on three pieces of NEAR. Nothing else in Zorvo depends on them.
          </p>
        </div>
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4" data-reveal="">
          <li className="lp-card flex flex-col gap-2.5 p-6" data-r="" data-hover="">
            <span className="font-mono lp-sub">NEAR AI Cloud</span>
            <h3 className="text-[19px] leading-6.5 font-semibold tracking-[-0.015em] text-fg">
              Private inference
            </h3>
            <p className="text-[15px] leading-6 text-fg-muted">
              The model runs inside a TEE: Intel TDX and NVIDIA confidential computing. Zorvo offers only the models NEAR AI lists as verifiable.
            </p>
          </li>
          <li className="lp-card flex flex-col gap-2.5 p-6" data-r="" data-hover="">
            <span className="font-mono lp-sub">Signed answers</span>
            <h3 className="text-[19px] leading-6.5 font-semibold tracking-[-0.015em] text-fg">
              Proof for every answer
            </h3>
            <p className="text-[15px] leading-6 text-fg-muted">
              Each answer comes back signed. Zorvo checks the signature before it shows Verified in TEE, and you can check it again in NEAR AI's Verification Center.
            </p>
          </li>
          <li className="lp-card flex flex-col gap-2.5 p-6" data-r="" data-hover="">
            <span className="font-mono lp-sub">NEAR Intents</span>
            <h3 className="text-[19px] leading-6.5 font-semibold tracking-[-0.015em] text-fg">
              Payment from any chain
            </h3>
            <p className="text-[15px] leading-6 text-fg-muted">
              Credits are bought with USDC through PingPay, which is built on NEAR Intents: any chain, a wallet or a card.
            </p>
          </li>
        </ul>
        <div className="lp-ui flex flex-wrap items-center justify-center gap-2.5 mt-10" data-flow="" role="img" aria-label="How a private answer travels: Qwen Code sends the prompt to Zorvo's proxy on your Mac, which sends it to NEAR AI Cloud inside a TEE. The answer comes back signed, and Zorvo shows Verified in TEE.">
          <span className="lp-chip h-8 py-0 px-3" data-flow-step="">
            <AgentTile agent="Qwen Code" size="small" logo={12} />
            Qwen Code
          </span>
          <svg className="lp-ico text-fg-subtle" data-flow-step="" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14" />
            <path d="M13 6l6 6-6 6" />
          </svg>
          <span className="lp-chip h-8 py-0 px-3" data-flow-step="">Zorvo's proxy on your Mac</span>
          <svg className="lp-ico text-fg-subtle" data-flow-step="" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14" />
            <path d="M13 6l6 6-6 6" />
          </svg>
          <span className="lp-chip h-8 py-0 px-3" data-flow-step="">NEAR AI Cloud, in a TEE</span>
          <svg className="lp-ico text-fg-subtle" data-flow-step="" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14" />
            <path d="M13 6l6 6-6 6" />
          </svg>
          <span className="lp-chip h-8 py-0 px-3" data-flow-step="">Signed answer</span>
          <svg className="lp-ico text-fg-subtle" data-flow-step="" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14" />
            <path d="M13 6l6 6-6 6" />
          </svg>
          <span className="lp-ob h-8 gap-1.5 border-border text-fg" data-flow-step="" data-flow-end="">
            <svg className="lp-ico w-3.5 h-3.5 text-status-running" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3 5 6v6c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            Verified in TEE
          </span>
        </div>
      </div>
    </section>
  );
}
