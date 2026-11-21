import { LINKS } from "../../lib/links";
import { AgentTile } from "../ui/AgentTile";

/** A number as the page draws it on a commented part, and as the list under the page repeats it. */
function Mark({ n, className = "", isOnPage = false }: { n: number; className?: string; isOnPage?: boolean }) {
  return (
    <span data-cv-mark={isOnPage ? "" : undefined} className={`inline-flex items-center justify-center w-4 h-4 rounded-full bg-mark text-on-mark text-[10px] font-semibold flex-none ${className}`}>
      {n}
    </span>
  );
}

export function Canvas() {
  return (
    <section className="lp-sec" id="canvas" aria-labelledby="canvas-title">
      <div className="lp-wrap">
        <div className="lp-head" data-reveal="">
          <p className="lp-eyebrow" data-r="">Canvas</p>
          <h2 className="lp-h2" data-r="" id="canvas-title">Several screens, side by side.</h2>
          <p className="lp-lead" data-r="">
            Ask for a flow, the variants of one screen or a whole redesign. The agent lays the screens out as artboards on a canvas you pan and zoom.
          </p>
        </div>
        <div className="lp-ui flex flex-wrap items-stretch gap-4" data-cv="" role="img" aria-label="A Claude Code session beside a canvas in its Output tab. The chat asks for two ways to lay out the payment step, and the agent answers with a canvas called Checkout redesign, 3 artboards. The canvas shows Cart, Payment A and Payment B side by side. Payment B is selected, with Pick and Build this above it. A comment numbered 1 on its total reads Put the total above the Pay now button, marked Current, and a bar offers Add 1 to message.">
          <div className="lp-card flex-[1_1_300px] min-w-0 flex flex-col bg-bg" data-cv-pane="">
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
          <div className="lp-card flex-[2_1_520px] min-w-0 flex flex-col bg-bg overflow-hidden" data-cv-pane="">
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
                <span className="flex-1 min-w-0 flex flex-col gap-1.5 max-[640px]:hidden" data-cv-board="">
                  <span className="lp-sub">Cart</span>
                  <span className="lp-card flex-1 flex flex-col gap-2 p-3 text-[11px] leading-4">
                    <b className="font-medium text-fg">Your cart</b>
                    <span className="flex justify-between gap-2"><span className="truncate">Blue mug × 2</span><span className="font-mono">180.000</span></span>
                    <span className="flex justify-between gap-2"><span className="truncate">Tote bag × 1</span><span className="font-mono">60.000</span></span>
                    <span className="flex justify-between gap-2 pt-2 border-t border-border text-fg"><span>Total</span><span className="font-mono">240.000</span></span>
                    <span className="mt-auto lp-chip justify-center">Continue</span>
                  </span>
                </span>
                <span className="flex-1 min-w-0 flex flex-col gap-1.5" data-cv-board="">
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
                <span className="flex-1 min-w-0 flex flex-col gap-1.5" data-cv-board="">
                  <span className="lp-sub text-fg">Payment B</span>
                  <span className="lp-card flex-1 flex flex-col gap-2 p-3 text-[11px] leading-4 border-mark" data-cv-pick="">
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
            <span className="flex items-start gap-2.5 py-3 px-4 border-t border-border" data-cv-comment="">
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
            <span className="flex justify-end p-[0_16px_14px]" data-cv-bar="">
              <span className="lp-pb">Add 1 to message</span>
            </span>
          </div>
        </div>
        <ul className="lp-pts grid grid-cols-3 max-[860px]:grid-cols-1 gap-x-12 gap-y-8 mt-14" data-reveal="">
          <li data-r="">
            <h3>Pick one, then build it</h3>
            <p>
              Pick keeps one variant of a screen. Build this and Build section ask the agent to build the screens in your repository. Each puts a message in the box for you to edit and send.
            </p>
          </li>
          <li data-r="">
            <h3>Comment on any artboard</h3>
            <p>
              On its text, on one element, or on the artboard as a whole. The comments go into your next message with the file they are about.
            </p>
          </li>
          <li data-r="">
            <h3>Files in your project</h3>
            <p>
              A canvas is a folder: canvas.json and one HTML file per artboard, so git has its history. Export saves an artboard or the whole canvas as PNG or PDF.
            </p>
          </li>
        </ul>
        <p className="flex justify-center mt-8">
          <a className="focus-ring lp-more" href={LINKS.canvasGuide}>
            How a canvas works
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
