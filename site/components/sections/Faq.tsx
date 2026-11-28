import type { ReactNode } from "react";
import { QUESTIONS } from "../../lib/faq";
import { LINKS } from "../../lib/links";

function More({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="focus-ring text-fg-secondary underline decoration-(--lp-strong) underline-offset-3" href={href}>
      {children}
    </a>
  );
}

export function Faq() {
  return (
    <section className="lp-sec" id="faq" aria-labelledby="faq-title">
      <div className="lp-wrap lp-row items-start">
        <div className="lp-col" data-reveal="">
          <p className="lp-eyebrow" data-r="">Questions</p>
          <h2 className="lp-h2" data-r="" id="faq-title">Asked before the first download.</h2>
          <p className="lp-lead" data-r="">
            Something else, or something broke? <More href={LINKS.troubleshooting}>Troubleshooting</More> has the
            common cases.
          </p>
        </div>
        {/* Native details: they open and close without a script, and sharing a name keeps one open at a time. */}
        <div className="lp-col lp-faq gap-0" data-reveal="">
          {QUESTIONS.map(({ question, answer, more }) => (
            <details key={question} name="faq" data-r="">
              <summary className="focus-ring">
                <h3>{question}</h3>
                <svg className="lp-ico" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </summary>
              <p>
                {answer}
                {more && (
                  <>
                    {" "}
                    <More href={more.href}>{more.label}</More>
                  </>
                )}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
