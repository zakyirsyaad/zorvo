import { LINKS } from "../../lib/links";

export function Review() {
  return (
    <section className="lp-sec" id="review" aria-labelledby="review-title">
      <div className="lp-wrap lp-row flex-row-reverse">
        <div className="lp-col" data-reveal="">
          <p className="lp-eyebrow" data-r="">Review</p>
          <h2 className="lp-h2" data-r="" id="review-title">Comment on the line. Send it back.</h2>
          <p className="lp-lead" data-r="">
            Read each agent's diff in the app. Write a comment on a line, add it to your next message and read it before you send.
          </p>
          <ul className="lp-pts" data-r="">
            <li>
              <h3>A comment never moves</h3>
              <p>Each one is checked against the line it was written on: Current, Outdated or Unknown.</p>
            </li>
            <li>
              <h3>Reply to what the agent said</h3>
              <p>Select part of an answer and Reply quotes it in your message.</p>
            </li>
          </ul>
          <p data-r="">
            <a className="focus-ring lp-more" href={LINKS.reviewGuide}>
              How reviewing works
              <svg className="lp-ico" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h14" />
                <path d="M13 6l6 6-6 6" />
              </svg>
            </a>
          </p>
        </div>
        <div className="lp-col basis-130">
          <div className="lp-card lp-ui flex flex-col overflow-hidden bg-bg" data-rev="" role="img" aria-label="The diff of src/checkout/Checkout.tsx with a comment on line 25, Uppercase the code before checking it, marked Current, and a bar that reads 1 comment not in a message with the button Add 1 comment to message.">
            <span className="lp-tool font-mono h-10 text-[12px] text-fg">
              src/checkout/Checkout.tsx
              <span className="flex-1" />
              <span className="text-status-running">+24</span>
              <span className="text-danger">−1</span>
            </span>
            <span className="font-mono flex flex-col py-2 px-0 border-t border-border overflow-hidden">
              <span className="lp-dr" data-rev-row="">
                <i>22</i>
                {"<section className=\"checkout\">"}
              </span>
              <span className="lp-dr" data-rev-row="">
                <i>23</i>
                {" "}
                {"<h2>Order summary</h2>"}
              </span>
              <span className="lp-dr lp-dr-add" data-rev-row="">
                <i>24</i>
                {" "}
                {"<div className=\"discount\">"}
              </span>
              <span className="lp-dr lp-dr-add" data-rev-row="">
                <i>25</i>
                {" "}
                {"<input name=\"discount\" value={code} />"}
              </span>
              <span className="lp-ui flex flex-col gap-1 m-[8px_12px_8px_46px] py-2.5 px-3 rounded-[10px] bg-surface-2 border border-border whitespace-normal" data-rev-comment="">
                <span className="lp-sub">
                  <b className="font-medium text-fg-secondary">Line 25</b>
                  {" "}
                  · Current
                </span>
                <span className="text-fg">
                  Uppercase the code before checking it. The API treats HEMAT10 and hemat10 as different codes.
                </span>
              </span>
              <span className="lp-dr lp-dr-add" data-rev-row="">
                <i>26</i>
                {" "}
                {"<button onClick={applyCode}>Apply</button>"}
              </span>
              <span className="lp-dr lp-dr-add" data-rev-row="">
                <i>27</i>
                {" "}
                {"</div>"}
              </span>
              <span className="lp-dr" data-rev-row="">
                <i>28</i>
                {" "}
                {"<dl>"}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-2.5 m-[4px_12px_12px] py-2.5 px-3 rounded-[10px] bg-surface-3 border border-border" data-rev-bar="">
              <svg className="lp-ico w-3.5 h-3.5" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 5h16v11H9l-5 4z" />
              </svg>
              <span className="flex-[1_1_160px]">1 comment not in a message</span>
              <span className="lp-pb">Add 1 comment to message</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
