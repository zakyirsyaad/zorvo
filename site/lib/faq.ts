import { LINKS } from "./links";

export interface Question {
  question: string;
  /** Plain words, so the page and the structured data say exactly the same. */
  answer: string;
  /** A page that says more, shown after the answer. */
  more?: { href: string; label: string };
}

/**
 * The questions people ask before they download. Each one is answered by the README or the docs, in the same
 * words: nothing here is a claim the rest of the site does not make.
 */
export const QUESTIONS: readonly Question[] = [
  {
    question: "Is Zorvo free?",
    answer:
      "Yes. Zorvo is free and open source under the Apache License 2.0, and the source is on GitHub. Your agents run on your own accounts with their makers. The one paid part is optional: private mode, which uses prepaid credits.",
  },
  {
    question: "Does Zorvo need my API keys?",
    answer: "No. Each agent signs in with its own tools, and Zorvo never asks for or stores keys or tokens.",
    more: { href: LINKS.signingIn, label: "How signing in works" },
  },
  {
    question: "Which agent should I start with?",
    answer: "The one you already use. Zorvo shows each agent's own models and modes, so it works the way that agent does, next to the others.",
  },
  {
    question: "What do I need installed?",
    answer:
      "A Mac with Apple silicon or Intel, and an account with at least one agent. Agents that come as npm packages need Node.js 22 or newer. If yours is missing or older, Zorvo installs its own when you install such an agent.",
    more: { href: LINKS.installGuide, label: "The install guide" },
  },
  {
    question: "Does it work on Windows or Linux?",
    answer: "Not yet. Zorvo is a Mac app for now.",
  },
  {
    question: "Does Zorvo send my code anywhere?",
    answer:
      "Zorvo sends no telemetry, and your sessions and transcripts stay in one folder on your Mac. Your agents talk to their own services, as they do in a terminal. The few hosts Zorvo itself contacts are all named.",
    more: { href: LINKS.privacyGuide, label: "Privacy and your data" },
  },
];

/** schema.org data for the questions, so a search engine can show them with their answers. */
export function faqPage() {
  return {
    "@type": "FAQPage",
    mainEntity: QUESTIONS.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
}
