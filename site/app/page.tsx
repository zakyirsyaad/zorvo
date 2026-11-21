import { Agents } from "../components/sections/Agents";
import { Canvas } from "../components/sections/Canvas";
import { Community } from "../components/sections/Community";
import { Compare } from "../components/sections/Compare";
import { Control } from "../components/sections/Control";
import { Delegate } from "../components/sections/Delegate";
import { Download } from "../components/sections/Download";
import { Faq } from "../components/sections/Faq";
import { Features } from "../components/sections/Features";
import { Hero } from "../components/sections/Hero";
import { LongSessions } from "../components/sections/LongSessions";
import { Output } from "../components/sections/Output";
import { Privacy } from "../components/sections/Privacy";
import { PrivateMode } from "../components/sections/PrivateMode";
import { Review } from "../components/sections/Review";
import { Sessions } from "../components/sections/Sessions";
import { SiteFooter } from "../components/sections/SiteFooter";
import { SiteHeader } from "../components/sections/SiteHeader";
import { Voices } from "../components/sections/Voices";
import { faqPage } from "../lib/faq";
import { softwareApplication } from "../lib/site";

export default function Home() {
  // Static data from lib/site.ts and lib/faq.ts; `<` is escaped so the JSON can never close the script tag.
  const { "@context": context, ...application } = softwareApplication();
  const structuredData = JSON.stringify({ "@context": context, "@graph": [application, faqPage()] }).replace(/</g, "\\u003c");
  return (
    <div className="lp-root flex-1" data-landing="">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      <a
        href="#main"
        className="focus-ring sr-only rounded-lg bg-primary px-3 py-2 text-sm text-on-primary focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-10"
      >
        Skip to content
      </a>
      {/* The two wrappers GSAP's ScrollSmoother moves; without the script they are plain blocks. */}
      <div id="smooth-wrapper">
      <div id="smooth-content">
      <SiteHeader />
      <main id="main">
        <Hero />
        <Agents />
        {/* Right under the strip of agents: who makes Zorvo, and where to follow it. */}
        <Community />
        <Sessions />
        <Compare />
        <Delegate />
        <Review />
        {/* After Review: a comment on a line of a diff, then a comment on a page. */}
        <Output />
        <Canvas />
        <Control />
        <LongSessions />
        <Features />
        {/* Renders nothing until lib/voices.ts holds real quotes. */}
        <Voices />
        {/* The optional paid extra comes after everything Zorvo does for free, right before privacy. */}
        <PrivateMode />
        <Privacy />
        <Faq />
        <Download />
      </main>
      <SiteFooter />
      </div>
      </div>
      {/* The motion: one small script, nothing renders from it. See scripts/motion/. */}
      <script src="/motion.js" defer />
    </div>
  );
}
