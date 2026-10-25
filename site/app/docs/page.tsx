import { DocsShell } from "../../components/docs/DocsShell";
import { Icon, type IconName } from "../../components/ui/Icon";
import { DOCS_NAV } from "../../lib/docs-nav";
import { docsMetadata } from "../../lib/docs-metadata";
import { LINKS } from "../../lib/links";

export const metadata = docsMetadata("/docs");

const CARD =
  "focus-ring flex flex-col gap-2 rounded-xl border border-border bg-surface-1 p-5 no-underline transition-colors duration-150 hover:bg-surface-2";

const START: { href: string; label: string; icon: IconName; text: string }[] = [
  { href: "/docs/install", label: "Install", icon: "download", text: "Download Zorvo, open it the first time and install your first agent from inside the app." },
  { href: "/docs/quickstart", label: "Quickstart", icon: "message-square", text: "Pick a folder, a branch and an agent, and send your first message." },
  { href: "/docs/agents", label: "Supported agents", icon: "layers", text: "Agents from the ACP registry, and how to add, install, update and sign in to them." },
];

const RECENT: { href: string; label: string; version: string; icon: IconName; text: string }[] = [
  { href: "/docs/troubleshooting#stuck", label: "A notice when an agent seems stuck", version: "0.5", icon: "triangle-alert", text: "Under Working…, Zorvo says when an agent reports failed requests in a row or has sent nothing for a minute." },
  { href: "/docs/terminal", label: "A terminal for the session's folder", version: "0.4", icon: "square-terminal", text: "A shell in a drawer under the chat, with tabs kept per folder." },
  { href: "/docs/install#first-agent", label: "Install agents from Zorvo", version: "0.3", icon: "download", text: "Choose an agent that is not installed and click Install. Zorvo installs what it needs." },
];

export default function DocsHome() {
  return (
    <DocsShell
      current="/docs"
      crumb={["Get started", "Introduction"]}
      title="Zorvo docs"
      lead="Install Zorvo and the agents you use, sign in to them, and work with sessions, worktrees, terminals and changes in one desktop."
    >
      <section aria-labelledby="start" className="mt-6 flex flex-col gap-4">
        <h2 id="start" className="t-title m-0">Start here</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {START.map(({ href, label, icon, text }) => (
            <a key={href} href={href} className={CARD}>
              <span className="grid size-9 place-items-center rounded-lg border border-border bg-surface-2 text-fg">
                <Icon name={icon} size={18} />
              </span>
              <span className="t-heading">{label}</span>
              <span className="t-body">{text}</span>
            </a>
          ))}
        </div>
      </section>

      <section aria-labelledby="recent" className="mt-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="recent" className="t-title m-0">Recent additions</h2>
          <a className="focus-ring rounded-sm text-[13px] leading-5 text-fg-muted underline underline-offset-2 hover:text-fg" href={LINKS.changelog}>
            Read the changelog
          </a>
        </div>
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
          {RECENT.map(({ href, label, version, icon, text }) => (
            <li key={href} className="flex">
              <a href={href} className={`${CARD} flex-1`}>
                <span className="flex items-center gap-2 text-fg">
                  <Icon name={icon} size={16} />
                  <span className="t-heading text-sm">{label}</span>
                </span>
                <span className="t-body">{text}</span>
                <span className="t-caption">Zorvo {version}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="topics" className="mt-6 flex flex-col gap-4">
        <h2 id="topics" className="t-title m-0">All topics</h2>
        <div className="grid gap-8 border-t border-border pt-6 sm:grid-cols-2">
          {DOCS_NAV.map((group) => (
            <div key={group.title} className="flex flex-col gap-2">
              <h3 className="m-0 font-mono text-[11px] leading-4 font-normal text-fg-subtle">{group.title}</h3>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {group.pages.map((page) => (
                  <li key={page.href}>
                    <a className="focus-ring rounded-sm text-sm leading-5 text-fg underline decoration-border-strong underline-offset-2 hover:decoration-fg" href={page.href}>
                      {page.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="stuck-help"
        className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface-1 px-6 py-5"
      >
        <div className="flex flex-col gap-1">
          <h2 id="stuck-help" className="t-heading m-0">Something not working?</h2>
          <p className="t-body m-0">Most problems are an agent that is not installed yet, or one that needs you to sign in.</p>
        </div>
        <a
          href="/docs/troubleshooting"
          className="focus-ring inline-flex min-h-11 items-center rounded-lg border border-border-strong px-[18px] text-sm font-medium text-fg-secondary no-underline transition-colors duration-150 hover:bg-surface-hover hover:text-fg"
        >
          Troubleshooting
        </a>
      </section>
    </DocsShell>
  );
}
