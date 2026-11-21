import { LINKS } from "../../lib/links";
import { AgentTile } from "../ui/AgentTile";

/** A number as the page draws it on a commented part, and as the list under the page repeats it. */
function Mark({ n, className = "", isOnPage = false }: { n: number; className?: string; isOnPage?: boolean }) {
  return (
    <span data-out-mark={isOnPage ? "" : undefined} className={`inline-flex items-center justify-center w-4 h-4 rounded-full bg-mark text-on-mark text-[10px] font-semibold flex-none ${className}`}>
      {n}
    </span>
  );
}

export function Output() {
  return (
    <section className="lp-sec" id="output" aria-labelledby="output-title">
      <div className="lp-wrap">
        <div className="lp-head" data-reveal="">
          <p className="lp-eyebrow" data-r="">Output</p>
          <h2 className="lp-h2" data-r="" id="output-title">See the answer beside the chat.</h2>
          <p className="lp-lead" data-r="">
            A report, a diagram or a mockup opens as a page in the Output tab. Several screens open as a canvas, side by side. Comment on what you see and send it back.
          </p>
        </div>
        <div className="lp-ui flex flex-wrap items-stretch gap-4" data-out="" role="img" aria-label="A Claude Code session beside its Output tab. The chat asks for two ways to lay out the payment step, and the agent answers with a canvas called Checkout redesign, 3 artboards. The canvas shows Cart, Payment A and Payment B side by side. Payment B is selected, with Pick and Build this above it. A comment numbered 1 on its total reads Put the total above the Pay now button, marked Current, and a bar offers Add 1 to message.">
          <div className="lp-card flex-[1_1_300px] min-w-0 flex flex-col bg-bg" data-out-pane="">
            <span className="lp-tb">
              <AgentTile agent="Claude Code" size="small" logo={12} />
              <b className="font-semibold text-fg truncate">Redesign the checkout</b>
            </span>
            <span className="flex-1 flex flex-col gap-3.5 p-[18px_16px_0]">
              <span className="lp-bub">Show me two ways to lay out the payment step.</span>
              <span className="flex items-center gap-2">
                <AgentTile agent="Claude Code" size="small" logo={14} className="w-5.5 h-5.5" />
                <b className="font-medium text-fg">Claude Code</b>
              </span>
              <span>Two variants of the payment step, next to the cart as it is now.</span>
              <span className="lp-card flex items-center gap-2.5 py-2.5 px-3">
                <svg className="lp-ico w-3.5 h-3.5" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 5h7v14H4z" />
                  <path d="M14 5h6v6h-6z" />
                  <path d="M14 14h6v5h-6z" />
                </svg>
                <span className="min-w-0 flex flex-col">
                  <b className="font-medium text-fg truncate">Checkout redesign</b>
                  <span className="lp-sub">3 artboards</span>
                </span>
                <span className="flex-1" />
                <span className="lp-ob">Open</span>
              </span>
            </span>
            <span className="p-[14px_16px_16px]">
              <span className="lp-comp">
                <span className="text-fg-subtle text-[13px]">Reply to Claude Code</span>
                <span className="flex items-center gap-2">
                  <span className="lp-chip">
                    <AgentTile agent="Claude Code" size="small" logo={12} />
                    Claude Code
                  </span>
                  <span className="lp-chip">Sonnet</span>
                </span>
              </span>
            </span>
          </div>
          <div className="lp-card flex-[2_1_520px] min-w-0 flex flex-col bg-bg overflow-hidden" data-out-pane="">
            <span className="lp-tb">
              <b className="font-semibold text-fg truncate">Checkout redesign</b>
              <span className="lp-sub whitespace-nowrap max-[520px]:hidden">Payment B</span>
              <span className="flex-1" />
              <span className="lp-gb max-[640px]:hidden">Comment</span>
              <span className="lp-gb">Pick</span>
              <span className="lp-ob">Build this</span>
            </span>
            <span className="flex-1 flex flex-col gap-2.5 p-4">
              <span className="lp-sub font-medium text-fg-muted">Payment</span>
              <span className="flex items-stretch gap-4">
                <span className="flex-1 min-w-0 flex flex-col gap-1.5 max-[640px]:hidden" data-out-board="">
                  <span className="lp-sub">Cart</span>
                  <span className="lp-card flex-1 flex flex-col gap-2 p-3 text-[11px] leading-4">
                    <b className="font-medium text-fg">Your cart</b>
                    <span className="flex justify-between gap-2"><span className="truncate">Blue mug × 2</span><span className="font-mono">180.000</span></span>
                    <span className="flex justify-between gap-2"><span className="truncate">Tote bag × 1</span><span className="font-mono">60.000</span></span>
                    <span className="flex justify-between gap-2 pt-2 border-t border-border text-fg"><span>Total</span><span className="font-mono">240.000</span></span>
                    <span className="mt-auto lp-chip justify-center">Continue</span>
                  </span>
                </span>
                <span className="flex-1 min-w-0 flex flex-col gap-1.5" data-out-board="">
                  <span className="lp-sub">Payment A</span>
                  <span className="lp-card flex-1 flex flex-col gap-2 p-3 text-[11px] leading-4">
                    <b className="font-medium text-fg">Payment</b>
                    <span className="flex items-center gap-2"><span className="lp-dot bg-fg" />Card</span>
                    <span className="flex items-center gap-2"><span className="lp-dot border border-(--lp-strong)" />Bank transfer</span>
                    <span className="flex items-center gap-2"><span className="lp-dot border border-(--lp-strong)" />QRIS</span>
                    <span className="flex justify-between gap-2 pt-2 border-t border-border text-fg"><span>Total</span><span className="font-mono">240.000</span></span>
                    <span className="mt-auto lp-chip justify-center bg-fg text-on-primary">Pay now</span>
                  </span>
                </span>
                <span className="flex-1 min-w-0 flex flex-col gap-1.5" data-out-board="">
                  <span className="lp-sub text-fg">Payment B</span>
                  <span className="lp-card flex-1 flex flex-col gap-2 p-3 text-[11px] leading-4 border-mark" data-out-pick="">
                    <b className="font-medium text-fg">Payment</b>
                    <span className="flex gap-1.5">
                      <span className="lp-chip h-5 text-[11px] bg-fg text-on-primary">Card</span>
                      <span className="lp-chip h-5 text-[11px]">Transfer</span>
                      <span className="lp-chip h-5 text-[11px] max-[400px]:hidden">QRIS</span>
                    </span>
                    <span className="lp-chip justify-center bg-fg text-on-primary">Pay now</span>
                    <span className="mt-auto flex items-center justify-between gap-2 pt-2 border-t border-border text-fg">
                      <span className="flex items-center gap-1.5">
                        Total
                        <Mark n={1} isOnPage />
                      </span>
                      <span className="font-mono">240.000</span>
                    </span>
                  </span>
                </span>
              </span>
            </span>
            <span className="flex items-start gap-2.5 py-3 px-4 border-t border-border" data-out-comment="">
              <Mark n={1} className="mt-px" />
              <span className="min-w-0 flex flex-col gap-0.5">
                <span className="lp-sub">
                  <b className="font-medium text-fg-secondary">Payment B</b>
                  {" "}
                  · Current
                </span>
                <span className="text-fg">Put the total above the Pay now button.</span>
              </span>
            </span>
            <span className="flex justify-end p-[0_16px_14px]" data-out-bar="">
              <span className="lp-pb">Add 1 to message</span>
            </span>
          </div>
        </div>
        <ul className="lp-pts grid grid-cols-2 max-[860px]:grid-cols-1 gap-x-16 gap-y-8 mt-14" data-reveal="">
          <li data-r="">
            <h3>Comment on what you see</h3>
            <p>
              Press Comment, select text or click a part of the page, and write what should change. Comments are numbered on the page and go into your next message.
            </p>
          </li>
          <li data-r="">
            <h3>A canvas for several screens</h3>
            <p>
              A flow or the variants of one screen show as artboards. Pick keeps one variant, and Build this asks the agent to build that screen in your repository.
            </p>
          </li>
          <li data-r="">
            <h3>Versions, and files you keep</h3>
            <p>
              Each change to a page is a new version you can go back to. Export a page as one HTML file, or an artboard as PNG or PDF. A canvas is a folder in your project, so git has its history.
            </p>
          </li>
          <li data-r="">
            <h3>Kept apart from your files</h3>
            <p>
              A page runs in its own part of the window. It cannot call Zorvo or read your files, and it loads scripts and fonts only from a short list of public hosts.
            </p>
          </li>
        </ul>
        <p className="flex justify-center mt-8">
          <a className="focus-ring lp-more" href={LINKS.outputGuide}>
            How pages and canvases work
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
