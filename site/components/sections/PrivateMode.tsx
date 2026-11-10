import { AgentTile } from "../ui/AgentTile";

export function PrivateMode() {
  return (
    <section className="lp-sec bg-surface-1" id="private" aria-labelledby="private-title">
      <div className="lp-wrap">
        <div className="lp-row items-start">
          <div className="lp-col basis-135">
            <div className="lp-card lp-ui flex flex-col bg-bg overflow-hidden" data-prv="" role="img" aria-label="A private session. Qwen Code, on a model that runs in a TEE, reviews a payment module, checks its credits first and reads two files. Its answer carries the badge Verified in TEE with the signer's address, and a line says 48 credits are left, with a Top up button.">
              <span className="lp-tb">
                <b className="font-semibold text-fg">Review the Acme payment module</b>
                <span className="lp-chip h-5.5 text-[11px] bg-surface-2" data-prv-chip="">
                  <svg className="lp-ico w-[11px] h-[11px]" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 3 5 6v6c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6z" />
                    <path d="m9 12 2 2 4-4" />
                  </svg>
                  Private · TEE
                </span>
                <span className="flex-1" />
                <span className="lp-sub">Qwen Code</span>
              </span>
              <span className="flex flex-col gap-3.5 p-[18px_16px_16px]">
                <span className="lp-bub" data-prv-item="">
                  Review the payment module for client Acme and list what could leak card data.
                </span>
                <span className="flex items-center gap-2" data-prv-item="">
                  <AgentTile agent="Qwen Code" size="small" logo={12} />
                  <b className="font-medium text-fg">Qwen Code</b>
                  <span className="lp-sub">Qwen 3.8 27B</span>
                </span>
                <span className="lp-card flex flex-col overflow-hidden" data-prv-item="">
                  <span className="lp-tool">
                    <svg className="lp-ico w-3.5 h-3.5" viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 2" />
                    </svg>
                    Checked
                    <span className="font-mono text-[12px]">credits_balance</span>
                    <span className="flex-1" />
                    <span className="lp-sub">52 credits left · ≈ 130 turns</span>
                  </span>
                  <span className="lp-tool">
                    <svg className="lp-ico w-3.5 h-3.5" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 3h8l4 4v14H6z" />
                      <path d="M14 3v4h4" />
                    </svg>
                    Read
                    <span className="font-mono text-[12px]">src/payments/logger.ts</span>
                    <span className="flex-1" />
                    <span className="lp-sub">Done</span>
                  </span>
                </span>
                <span data-prv-item="">
                  <span className="font-mono lp-chip h-5">logger.ts</span>
                  {" "}
                  writes the full request body on a failed charge, which includes the card number. Mask it before logging, or log only the token.
                </span>
                <span className="flex flex-wrap items-center gap-2" data-prv-item="">
                  <span className="lp-ob h-6 py-0 px-2 gap-1.5 border-border" data-prv-badge="">
                    <svg className="lp-ico w-3 h-3 text-status-running" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 3 5 6v6c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6z" />
                      <path data-prv-check="" pathLength="1" d="m9 12 2 2 4-4" />
                    </svg>
                    Verified in TEE
                  </span>
                  <span className="font-mono lp-sub">signed by 0x835a…aa26</span>
                </span>
                <span className="flex flex-wrap items-center gap-2.5 py-2 px-3 rounded-lg bg-surface-1 border border-border text-[12px]" data-prv-item="">
                  <span className="lp-dot bg-status-attention" />
                  <span className="flex-[1_1_200px]">
                    <span data-count="48" data-from="52">48</span>
                    {" "}
                    credits left, about 120 turns on Qwen 3.8 27B.
                  </span>
                  <span className="lp-ob h-6.5">Top up</span>
                </span>
              </span>
            </div>
          </div>
          <div className="lp-col" data-reveal="">
            <p className="lp-eyebrow" data-r="">Optional · Private mode on NEAR AI Cloud</p>
            <h2 className="lp-h2" data-r="" id="private-title">A private mode for sensitive code.</h2>
            <p className="lp-lead" data-r="">
              Zorvo stays free. Private mode is an extra you turn on for one session: Qwen Code then runs only on NEAR AI Cloud models inside a TEE, paid with prepaid credits. No login, no wallet, no email.
            </p>
            <p className="flex items-center gap-3 text-[13px] leading-5 text-fg-subtle" data-r="">
              Runs on
              <img className="block w-32 h-auto" src="/near-ai-wordmark-white.svg" alt="NEAR AI" width="128" height="24" />
            </p>
            <ul className="lp-pts" data-r="">
              <li>
                <h3>Runs inside a TEE</h3>
                <p>
                  NEAR AI Cloud, inside Intel TDX and NVIDIA confidential computing. The credits server never sees your prompts.
                </p>
              </li>
              <li>
                <h3>Every answer is verified</h3>
                <p>Zorvo checks each answer's signature and shows Verified in TEE with who signed it.</p>
              </li>
              <li>
                <h3>A cap that holds</h3>
                <p>Give a session a credit limit. NEAR AI stops it there, even if Zorvo is closed.</p>
              </li>
              <li>
                <h3>Off unless you turn it on</h3>
                <p>Without it, Zorvo costs nothing, asks for no key and makes none of these requests.</p>
              </li>
            </ul>
          </div>
        </div>
        <p className="mt-14 text-[17px] leading-6.5 text-fg-muted">
          <b className="font-semibold text-fg">Credits pay for private sessions only.</b>
          {" "}
          Zorvo, and every agent you already use in it, stays free.
        </p>
        <ol className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4 m-[20px_0_0] p-0 list-none" data-reveal="">
          <li className="lp-card flex flex-col gap-2 p-5" data-r="" data-hover="">
            <span className="font-mono lp-sub">01</span>
            <h3 className="text-[17px] leading-6 font-semibold text-fg">Buy credits</h3>
            <p className="text-[15px] leading-6 text-fg-muted">
              Pick a pack of prepaid credits in Settings. They are sold only while there is stock to cover them.
            </p>
          </li>
          <li className="lp-card flex flex-col gap-2 p-5" data-r="" data-hover="">
            <span className="font-mono lp-sub">02</span>
            <h3 className="text-[17px] leading-6 font-semibold text-fg">Pay with USDC</h3>
            <p className="text-[15px] leading-6 text-fg-muted">
              Checkout opens in your browser through PingPay: USDC from any chain, a wallet or a card.
            </p>
          </li>
          <li className="lp-card flex flex-col gap-2 p-5" data-r="" data-hover="">
            <span className="font-mono lp-sub">03</span>
            <h3 className="text-[17px] leading-6 font-semibold text-fg">Credits arrive by themselves</h3>
            <p className="text-[15px] leading-6 text-fg-muted">
              Zorvo adds them when the payment lands, with nothing for you to press. The key is saved in your Keychain.
            </p>
          </li>
        </ol>
      </div>
    </section>
  );
}
