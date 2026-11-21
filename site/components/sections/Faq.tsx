import type { ReactNode } from "react";
import { LINKS } from "../../lib/links";

function More({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="focus-ring text-fg-secondary underline decoration-(--lp-strong) underline-offset-3" href={href}>
      {children}
    </a>
  );
}

/**
 * The questions people ask before they download. Each one is answered by the README or the docs, in the same
 * words: nothing here is a claim the rest of the site does not make.
 */
const QUESTIONS: ReadonlyArray<{ question: string; answer: ReactNode }> = [
  {
    question: "Is Zorvo free?",
    answer: (
      <>
        Yes. Zorvo is free and open source under the Apache License 2.0, and the source is on GitHub. Your agents
        run on your own accounts with their makers. The one paid part is optional: private mode, which uses
        prepaid credits.
      </>
    ),
  },
  {
    question: "Does Zorvo need my API keys?",
    answer: (
      <>
        No. Each agent signs in with its own tools, and Zorvo never asks for or stores keys or tokens.{" "}
        <More href={LINKS.signingIn}>How signing in works</More>
      </>
    ),
  },
  {
    question: "Which agent should I start with?",
    answer: (
      <>
        The one you already use. Zorvo shows each agent&apos;s own models and modes, so it works the way that agent
        does, next to the others.
      </>
    ),
  },
  {
    question: "What do I need installed?",
    answer: (
      <>
        A Mac with Apple silicon or Intel, and an account with at least one agent. Agents that come as npm packages
        need Node.js 22 or newer. If yours is missing or older, Zorvo installs its own when you install such an
        agent. <More href={LINKS.installGuide}>The install guide</More>
      </>
    ),
  },
  {
    question: "Does it work on Windows or Linux?",
    answer: <>Not yet. Zorvo is a Mac app for now.</>,
  },
  {
    question: "Does Zorvo send my code anywhere?",
    answer: (
      <>
        Zorvo sends no telemetry, and your sessions and transcripts stay in one folder on your Mac. Your agents talk
        to their own services, as they do in a terminal. The few hosts Zorvo itself contacts are all named.{" "}
        <More href={LINKS.privacyGuide}>Privacy and your data</More>
      </>
    ),
  },
];

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
          {QUESTIONS.map(({ question, answer }) => (
            <details key={question} name="faq" data-r="">
              <summary className="focus-ring">
                <h3>{question}</h3>
                <svg className="lp-ico" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
