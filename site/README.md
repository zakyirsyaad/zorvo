# Zorvo landing page

The marketing site for Zorvo: one page, built with Next.js and exported as
static HTML to `out/`. It shares the app's design tokens (`app/globals.css`
mirrors `src/styles/globals.css`, checked by `src/test/site.test.tsx`), its
fonts (`@fontsource-variable`) and its agent logos (`src/assets/agents/`).

```bash
pnpm install                      # from the repository root
pnpm --filter zorvo-site dev      # http://localhost:3100
SITE_URL=https://zorvohub.xyz pnpm --filter zorvo-site build   # writes site/out/
```

`out/` is plain files: any static host serves it. The site has no client components, so the build
ends with `scripts/strip-runtime.mjs`, which removes React's hydration runtime from every page: a
visitor downloads HTML, CSS, fonts and images, and no JavaScript. Structured data stays. Next.js telemetry is off in
both scripts. The page makes no requests to other sites. Every link comes from
`lib/links.ts`: the docs links point at the pages under `app/docs/` and the
downloads and the changelog at the repository, and changing that one file moves
them all. The docs pages are listed in `lib/docs-nav.ts`, which the sidebar, the
pager, the docs home and the sitemap all read.

## Deploying on Vercel

Import the repository in Vercel and set **Root Directory** to `site`. The
rest comes from `vercel.json`: no framework preset, so Vercel serves `out/` as plain
files (the Next.js preset would deploy its own build from `.next/`, which keeps React's
runtime and drops the headers below), install and build with pnpm 12 (the version
the workspace's settings need), security headers including a CSP that only
allows the site's own origin, and a skipped build when a commit touches
nothing the site uses.

The canonical URL, sitemap and Open Graph links use `SITE_URL` if set,
otherwise Vercel's production domain, so adding a custom domain in Vercel
moves them with it. A build anywhere else needs `SITE_URL`: without it the
build fails instead of publishing localhost links.

The CSP allows only the site's own origin, so it also blocks the Vercel
Toolbar that Vercel injects into preview deployments. Turn the toolbar off
for this project (Settings → General → Vercel Toolbar) so previews show the
same clean console as production.

- Sections live in `components/sections/`, in page order in `app/page.tsx`.
- The pictures of the app (`components/mockups/`) are `role="img"` with a
  description; nothing inside them is focusable.
- Copy follows `docs/brand/zorvo-brand-brief.md`: sentence case, no
  exclamation marks or emoji, name the agents, never imply endorsement.
