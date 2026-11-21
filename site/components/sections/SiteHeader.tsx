import { LINKS } from "../../lib/links";
import { BrandIcon, type Brand } from "../ui/BrandIcon";

/** The sections of the page that say what Zorvo does, as the Product menu lists them. */
const PRODUCT = [
  { id: "compare", title: "Compare", text: "One prompt, up to four agents, each in its own worktree." },
  { id: "delegate", title: "Delegate", text: "Hand a task to another agent, or let an agent start workers." },
  { id: "review", title: "Review", text: "Comment on a line of a diff and send it back." },
  { id: "output", title: "Output", text: "Pages and canvases an agent shows beside the chat." },
  { id: "control", title: "Control", text: "Approvals, the plan, and what the agent did." },
  { id: "features", title: "All features", text: "The inspector, the browser, files, fork and rewind." },
] as const;

const SOCIALS: ReadonlyArray<{ brand: Brand; href: string; name: string; size?: number }> = [
  { brand: "discord", href: LINKS.discord, name: "Discord" },
  { brand: "x", href: LINKS.x, name: "X", size: 18 },
  { brand: "github", href: LINKS.repository, name: "GitHub" },
];

function Socials() {
  return (
    <>
      {SOCIALS.map(({ brand, href, name, size }) => (
        <a key={brand} className="focus-ring lp-icon-link" href={href} target="_blank" rel="noopener noreferrer">
          <BrandIcon brand={brand} size={size} />
          <span className="sr-only">{name}, opens in a new tab</span>
        </a>
      ))}
    </>
  );
}

/** `anchorBase` is "/" on pages other than the home page, so the section links lead back to it. */
export function SiteHeader({ anchorBase = "" }: { anchorBase?: "" | "/" }) {
  return (
    <header className="border-b border-border">
      {/* Three columns from the width where the section links show: equal sides keep the links at the
          page's middle, whatever the logo and the buttons measure. Narrower, it is a plain row. */}
      <div className="lp-wrap flex items-center gap-6 h-16 min-[861px]:grid min-[861px]:grid-cols-[1fr_auto_1fr]">
        <a className="focus-ring inline-flex items-center gap-2.5 min-h-11 text-fg justify-self-start" href={`${anchorBase}#top`}>
          <svg viewBox="0 0 40 40" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 7l10 7-10 7" />
            <path d="M18 19l10 7-10 7" />
            <path d="M30 33h5" />
          </svg>
          <span className="text-[22px] font-semibold tracking-[-0.04em]">zorvo</span>
        </a>
        <nav className="lp-nav gap-1" aria-label="Sections">
          {/* Opens under the pointer and on keyboard focus, by CSS alone. The script adds a click, Escape and
              the expanded state. */}
          <div className="lp-nav-item" data-menu="">
            <button type="button" className="focus-ring lp-btn lp-btn-ghost cursor-pointer" aria-haspopup="true" aria-expanded="false" aria-controls="product-menu">
              Product
              <svg className="lp-ico lp-chev w-3.5 h-3.5" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            <div className="lp-menu" id="product-menu">
              <div className="lp-menu-panel">
                {PRODUCT.map(({ id, title, text }) => (
                  <a key={id} className="focus-ring" href={`${anchorBase}#${id}`}>
                    <b>{title}</b>
                    <span>{text}</span>
                  </a>
                ))}
              </div>
            </div>
          </div>
          <a className="focus-ring lp-btn lp-btn-ghost" href={`${anchorBase}#private`}>Private mode</a>
          <a className="focus-ring lp-btn lp-btn-ghost" href={`${anchorBase}#privacy`}>Privacy</a>
          <a className="focus-ring lp-btn lp-btn-ghost" href={LINKS.docs}>Docs</a>
        </nav>
        <span className="flex items-center ml-auto min-[861px]:justify-self-end">
          {/* On a phone the three links are in the menu. */}
          <span className="flex items-center max-[860px]:hidden">
            <Socials />
          </span>
          <a className="focus-ring lp-btn lp-btn-outline h-10 ml-2" data-press="" href={LINKS.download}>
            Download
          </a>
          <button type="button" className="focus-ring lp-icon-link cursor-pointer ml-1 min-[861px]:hidden" popoverTarget="site-menu">
            <svg className="lp-ico w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16" />
              <path d="M4 12h16" />
              <path d="M4 17h16" />
            </svg>
            <span className="sr-only">Menu</span>
          </button>
        </span>
      </div>
      <div className="lp-sheet" id="site-menu" popover="auto">
        <span className="lp-sub pt-3 pb-1">Product</span>
        {PRODUCT.map(({ id, title }) => (
          <a key={id} className="focus-ring lp-sheet-link" href={`${anchorBase}#${id}`}>{title}</a>
        ))}
        <span className="h-px bg-border my-2" />
        <a className="focus-ring lp-sheet-link" href={`${anchorBase}#private`}>Private mode</a>
        <a className="focus-ring lp-sheet-link" href={`${anchorBase}#privacy`}>Privacy</a>
        <a className="focus-ring lp-sheet-link" href={LINKS.docs}>Docs</a>
        <span className="h-px bg-border my-2" />
        <span className="flex -ml-3">
          <Socials />
        </span>
      </div>
    </header>
  );
}
