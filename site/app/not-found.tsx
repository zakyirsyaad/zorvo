import type { Metadata } from "next";
import { SiteFooter } from "../components/sections/SiteFooter";
import { SiteHeader } from "../components/sections/SiteHeader";
import { ButtonLink } from "../components/ui/ButtonLink";
import { LINKS } from "../lib/links";
import { SITE_NAME } from "../lib/site";

// A missing page is never indexed and names no canonical address, so it cannot pass for the home page.
export const metadata: Metadata = {
  title: `Page not found · ${SITE_NAME}`,
  description: "This page does not exist on the Zorvo site.",
  robots: { index: false, follow: true },
  alternates: { canonical: null },
};

export default function NotFound() {
  return (
    <>
      <SiteHeader anchorBase="/" />
      <main id="main" className="site-wrap flex flex-1 flex-col items-center justify-center gap-5 py-24 text-center">
        <p className="m-0 font-mono text-xs leading-4 text-fg-muted">404</p>
        <h1 className="t-headline m-0">This page does not exist.</h1>
        <p className="t-lead m-0 max-w-[440px]">The link may be old. The home page and the docs have everything about Zorvo.</p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <ButtonLink href="/" variant="primary">Go to the home page</ButtonLink>
          <ButtonLink href={LINKS.docs} variant="outline">Read the docs</ButtonLink>
        </div>
      </main>
      <SiteFooter anchorBase="/" />
    </>
  );
}
