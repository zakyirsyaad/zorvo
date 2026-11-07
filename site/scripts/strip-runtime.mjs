// The site has no client components: every page is complete HTML, and React's runtime only
// hydrates what is already there. After `next build`, this removes that runtime from each page
// in out/ (script tags, their preloads and the inline flight data), so a visitor downloads no
// JavaScript. Structured data (`application/ld+json`) is data, not script, and stays.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = /<script\b(?![^>]*\btype="application\/ld\+json")[^>]*>[\s\S]*?<\/script>/g;
const SCRIPT_PRELOAD = /<link\b[^>]*\b(?:rel="modulepreload"|as="script")[^>]*\/?>/g;

/**
 * Removes scripts and script preloads until none is left: one pass could join the pieces around a
 * removed tag into a new one (`<scr<script></script>ipt>`), so it repeats until nothing changes.
 * @param {string} html @returns {string}
 */
export function stripRuntime(html) {
  let previous;
  let stripped = html;
  do {
    previous = stripped;
    stripped = stripped.replace(SCRIPT, "").replace(SCRIPT_PRELOAD, "");
  } while (stripped !== previous);
  return stripped;
}

/** @param {string} dir @returns {AsyncGenerator<string>} */
async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(path);
    else if (entry.name.endsWith(".html")) yield path;
  }
}

async function main() {
  const out = fileURLToPath(new URL("../out/", import.meta.url));
  let count = 0;
  for await (const file of htmlFiles(out)) {
    const html = await readFile(file, "utf8");
    const stripped = stripRuntime(html);
    if (stripped === html) continue;
    // A page that still names a runtime chunk would mean a script form this does not know.
    if (/\/_next\/static\/chunks\/[^"']+\.js["']/.test(stripped)) {
      throw new Error(`${file} still references a script after stripping`);
    }
    await writeFile(file, stripped);
    count++;
  }
  console.log(`Removed the React runtime from ${count} pages.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
