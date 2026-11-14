import { Agents } from "../components/sections/Agents";
import { Compare } from "../components/sections/Compare";
import { Control } from "../components/sections/Control";
import { Delegate } from "../components/sections/Delegate";
import { Download } from "../components/sections/Download";
import { Features } from "../components/sections/Features";
import { Hero } from "../components/sections/Hero";
import { LongSessions } from "../components/sections/LongSessions";
import { Near } from "../components/sections/Near";
import { Privacy } from "../components/sections/Privacy";
import { PrivateMode } from "../components/sections/PrivateMode";
import { Review } from "../components/sections/Review";
import { Sessions } from "../components/sections/Sessions";
import { SiteFooter } from "../components/sections/SiteFooter";
import { SiteHeader } from "../components/sections/SiteHeader";
import { softwareApplication } from "../lib/site";

export default function Home() {
  // Static data from lib/site.ts; `<` is escaped so the JSON can never close the script tag.
  const structuredData = JSON.stringify(softwareApplication()).replace(/</g, "\\u003c");
  return (
    <div className="lp-root flex-1" data-landing="">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      <a
        href="#main"
        className="focus-ring sr-only rounded-lg bg-primary px-3 py-2 text-sm text-on-primary focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-10"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">
        <Hero />
        <Agents />
        <Sessions />
        <Compare />
        <Delegate />
        <PrivateMode />
        <Near />
        <Review />
        <Control />
        <LongSessions />
        <Features />
        <Privacy />
        <Download />
      </main>
      <SiteFooter />
      {/* The motion: one small script, nothing renders from it. See scripts/motion/. */}
      <script src="/motion.js" defer />
    </div>
  );
}
