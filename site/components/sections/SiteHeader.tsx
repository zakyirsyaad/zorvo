import { ButtonLink } from "../ui/ButtonLink";
import { GithubMark } from "../ui/GithubMark";
import { ZorvoLockup } from "../ui/ZorvoSymbol";
import { TEXT_LINK } from "../ui/styles";
import { LINKS } from "../../lib/links";

export function SiteHeader() {
  return (
    <header>
      <nav
        aria-label="Main"
        className="site-wrap flex min-h-16 items-center justify-between gap-4 py-3"
      >
        <ZorvoLockup />
        {/* On a phone the section links live in the footer; Docs and Download stay. */}
        <ul className="m-0 hidden list-none items-center gap-7 p-0 md:flex">
          <li><a className={TEXT_LINK} href="#agents">Agents</a></li>
          <li><a className={TEXT_LINK} href="#compare">Compare</a></li>
          <li><a className={TEXT_LINK} href="#review">Review</a></li>
          <li><a className={TEXT_LINK} href="#features">Features</a></li>
          <li><a className={TEXT_LINK} href={LINKS.changelog}>Changelog</a></li>
        </ul>
        <div className="flex items-center gap-2">
          {/* On a phone only the mark shows; the hidden word still names the link. */}
          <ButtonLink href={LINKS.repository} variant="ghost">
            <GithubMark size={16} />
            <span className="max-sm:sr-only">GitHub</span>
          </ButtonLink>
          <ButtonLink href={LINKS.docs} variant="ghost">Docs</ButtonLink>
          <ButtonLink href={LINKS.download} variant="outline">Download</ButtonLink>
        </div>
      </nav>
    </header>
  );
}
