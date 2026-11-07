import { ButtonLink } from "../ui/ButtonLink";
import { GithubMark } from "../ui/GithubMark";
import { ZorvoLockup } from "../ui/ZorvoSymbol";
import { TEXT_LINK } from "../ui/styles";
import { LINKS } from "../../lib/links";

/** `anchorBase` is "/" on pages other than the home page, so the section links lead back to it. */
export function SiteHeader({ anchorBase = "" }: { anchorBase?: "" | "/" }) {
  return (
    <header>
      <nav
        aria-label="Main"
        // Three columns from md up, the outer two equal, so the links sit at the page's centre
        // however wide the logo and the buttons are; on a phone the links are hidden and it is a row.
        className="site-wrap flex min-h-16 items-center justify-between gap-4 py-3 md:grid md:grid-cols-[1fr_auto_1fr] md:justify-items-start"
      >
        <ZorvoLockup anchorBase={anchorBase} />
        {/* On a phone the section links live in the footer; Docs and Download stay. */}
        <ul className="m-0 hidden list-none items-center gap-7 p-0 md:flex">
          <li><a className={TEXT_LINK} href={`${anchorBase}#agents`}>Agents</a></li>
          <li><a className={TEXT_LINK} href={`${anchorBase}#compare`}>Compare</a></li>
          <li><a className={TEXT_LINK} href={`${anchorBase}#review`}>Review</a></li>
          <li><a className={TEXT_LINK} href={`${anchorBase}#features`}>Features</a></li>
          <li><a className={TEXT_LINK} href={LINKS.changelog}>Changelog</a></li>
        </ul>
        <div className="flex items-center gap-2 md:justify-self-end">
          {/* Below lg only the mark shows, so the links stay centred; the hidden word still names the link. */}
          <ButtonLink href={LINKS.repository} variant="ghost">
            <GithubMark size={16} />
            <span className="max-lg:sr-only">GitHub</span>
          </ButtonLink>
          <ButtonLink href={LINKS.docs} variant="ghost">Docs</ButtonLink>
          <ButtonLink href={LINKS.download} variant="outline">Download</ButtonLink>
        </div>
      </nav>
    </header>
  );
}
