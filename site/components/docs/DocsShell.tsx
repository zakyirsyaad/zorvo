import type { ReactNode } from "react";
import appPackage from "../../../package.json";
import { DOCS_NAV, DOCS_PAGES } from "../../lib/docs-nav";
import { docsStructuredData } from "../../lib/docs-structured-data";
import { LINKS } from "../../lib/links";
import { ButtonLink } from "../ui/ButtonLink";
import { Icon } from "../ui/Icon";
import { ZorvoSymbol } from "../ui/ZorvoSymbol";
import { TEXT_LINK } from "../ui/styles";

export interface TocEntry {
  id: string;
  label: string;
  /** Indented one level, for an h3 under an h2. */
  isNested?: boolean;
}

const NAV_LINK =
  "focus-ring block rounded-md px-2.5 py-1.5 text-[13px] leading-5 no-underline transition-colors duration-150 hover:bg-surface-hover hover:text-fg";

function DocsNav({ current }: { current: string }) {
  return (
    <div className="flex flex-col gap-6">
      {DOCS_NAV.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <p className="m-0 px-2.5 pb-1 font-mono text-[11px] leading-4 text-fg-subtle">{group.title}</p>
          {group.pages.map((page) => {
            const isCurrent = page.href === current;
            return (
              <a
                key={page.href}
                href={page.href}
                aria-current={isCurrent ? "page" : undefined}
                className={`${NAV_LINK} ${isCurrent ? "bg-surface-2 font-medium text-fg" : "text-fg-muted"}`}
              >
                {page.label}
              </a>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function DocsHeader() {
  return (
    <header className="border-b border-border">
      <nav aria-label="Site" className="site-wrap flex min-h-16 items-center justify-between gap-4 py-3">
        <a
          href="/docs"
          aria-label="Zorvo docs home"
          className="focus-ring inline-flex items-center gap-[7px] rounded-sm text-fg no-underline"
        >
          <ZorvoSymbol size={24} />
          <span className="text-[20px] leading-5 font-semibold tracking-[-0.04em]">zorvo</span>
          <span aria-hidden="true" className="px-0.5 text-lg text-border-strong">/</span>
          <span className="text-sm leading-5 font-medium text-fg-muted">Docs</span>
        </a>
        <div className="flex items-center gap-4 sm:gap-6">
          <a className={TEXT_LINK} href="/">Home</a>
          <ButtonLink href={LINKS.download} variant="outline">Download</ButtonLink>
        </div>
      </nav>
    </header>
  );
}

/** The phone's way into the docs menu and the page's sections: native <details>, so it needs no script. */
function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group border-b border-border">
      <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-[13px] leading-5 text-fg-secondary marker:hidden sm:px-6 [&::-webkit-details-marker]:hidden">
        {summary}
        <Icon name="chevron-down" size={16} className="text-fg-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-2 pt-1 pb-4 sm:px-4">{children}</div>
    </details>
  );
}

function Pager({ current }: { current: string }) {
  const index = DOCS_PAGES.findIndex((page) => page.href === current);
  const previous = DOCS_PAGES[index - 1];
  const next = DOCS_PAGES[index + 1];
  const CARD =
    "focus-ring flex flex-col gap-0.5 rounded-xl border border-border p-4 no-underline transition-colors duration-150 hover:bg-surface-1";
  return (
    <nav aria-label="Previous and next" className="mt-10 grid grid-cols-2 gap-3 border-t border-border pt-8">
      {previous ? (
        <a href={previous.href} className={CARD}>
          <span className="t-caption">Previous</span>
          <span className="t-heading text-sm">{previous.label}</span>
        </a>
      ) : (
        <span />
      )}
      {next ? (
        <a href={next.href} className={`${CARD} items-end text-right`}>
          <span className="t-caption">Next</span>
          <span className="t-heading text-sm">{next.label}</span>
        </a>
      ) : (
        <span />
      )}
    </nav>
  );
}

function Toc({ entries }: { entries: TocEntry[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 border-l border-border p-0">
      {entries.map((entry) => (
        <li key={entry.id}>
          <a
            href={`#${entry.id}`}
            className={`focus-ring block rounded-sm py-1 text-[13px] leading-5 text-fg-muted no-underline transition-colors duration-150 hover:text-fg ${
              entry.isNested ? "pl-6" : "pl-3"
            }`}
          >
            {entry.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

interface DocsShellProps {
  /** The page's path, which marks it in the sidebar and sets the pager and breadcrumb. */
  current: string;
  title: string;
  lead: string;
  toc?: TocEntry[];
  children: ReactNode;
}

/** A docs article: sidebar, prose column and "On this page" list. The home page and the topic pages share it. */
export function DocsShell({ current, title, lead, toc = [], children }: DocsShellProps) {
  const group = DOCS_NAV.find((entry) => entry.pages.some((page) => page.href === current));
  const page = group?.pages.find((entry) => entry.href === current);
  if (!group || !page) throw new Error(`${current} is not in DOCS_NAV`);
  // Static data from the docs list; `<` is escaped so the JSON can never close the script tag.
  const structuredData = JSON.stringify(docsStructuredData(current, title, page.summary)).replace(/</g, "\\u003c");
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      <a
        href="#main"
        className="focus-ring sr-only rounded-lg bg-primary px-3 py-2 text-sm text-on-primary focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-10"
      >
        Skip to content
      </a>
      <DocsHeader />
      <div className="lg:hidden">
        <Disclosure summary="Docs menu">
          <nav aria-label="Docs menu">
            <DocsNav current={current} />
          </nav>
        </Disclosure>
        {toc.length > 0 && (
          <Disclosure summary="On this page">
            <nav aria-label="On this page, short">
              <Toc entries={toc} />
            </nav>
          </Disclosure>
        )}
      </div>
      <div className="site-wrap flex flex-1 items-start gap-12 pt-8 pb-20 lg:pt-10 lg:pb-24">
        <nav aria-label="Docs" className="sticky top-6 hidden w-56 flex-none lg:block">
          <DocsNav current={current} />
        </nav>
        <main id="main" className="flex min-w-0 max-w-[720px] flex-1 flex-col gap-4">
          <p className="t-ui m-0 text-fg-subtle">
            {group.title} <span aria-hidden="true">/</span> {page.label}
          </p>
          <h1 className="t-headline m-0">{title}</h1>
          <p className="t-lead m-0">{lead}</p>
          {children}
          <Pager current={current} />
        </main>
        {toc.length > 0 && (
          <aside aria-label="On this page" className="sticky top-6 hidden w-52 flex-none xl:block">
            <p className="m-0 pb-3 font-mono text-[11px] leading-4 text-fg-subtle">On this page</p>
            <Toc entries={toc} />
          </aside>
        )}
      </div>
      <footer className="mt-auto border-t border-border">
        <div className="site-wrap flex flex-wrap justify-between gap-3 pt-5 pb-6">
          <p className="t-caption m-0">© 2026 Zorvo.</p>
          <p className="t-caption m-0 max-w-[560px]">
            Docs for Zorvo {appPackage.version}. Agent names and logos belong to their makers. Zorvo
            works with them and is not endorsed by them.
          </p>
        </div>
      </footer>
    </>
  );
}
