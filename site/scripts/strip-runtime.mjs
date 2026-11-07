// The site has no client components: every page is complete HTML, and React's runtime only
// hydrates what is already there. After `next build`, this removes that runtime from each page
// in out/ (script tags, their preloads and the inline flight data), so a visitor downloads no
// JavaScript. Structured data (`application/ld+json`) is data, not script, and stays.
import { realpathSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, serialize } from "parse5";

/** @typedef {import("parse5").DefaultTreeAdapterMap["node"]} Node */

/** @param {Node} node @param {string} name */
const attr = (node, name) => ("attrs" in node ? node.attrs.find((entry) => entry.name === name)?.value : undefined);

/** A script that runs, or a hint to fetch one; structured data is a script element but never runs. */
function isRuntime(/** @type {Node} */ node) {
  if (node.nodeName === "script") return attr(node, "type") !== "application/ld+json";
  if (node.nodeName === "link") return attr(node, "rel") === "modulepreload" || attr(node, "as") === "script";
  return false;
}

/** Drops runtime nodes from a parsed tree, template contents included, and says how many went. @param {Node} node @returns {number} */
function prune(node) {
  let removed = "content" in node ? prune(node.content) : 0;
  if (!("childNodes" in node)) return removed;
  const kept = node.childNodes.filter((child) => !isRuntime(child));
  removed += node.childNodes.length - kept.length;
  node.childNodes = kept;
  return kept.reduce((total, child) => total + prune(child), removed);
}

/**
 * Parses the page as a browser would, removes its scripts and script preloads, and writes it back,
 * so what is removed is exactly what a browser would have run.
 * @param {string} html @returns {{ html: string, removed: number }}
 */
export function stripPage(html) {
  const document = parse(html);
  const removed = prune(document);
  return { html: serialize(document), removed };
}

/** @param {string} html @returns {string} */
export const stripRuntime = (html) => stripPage(html).html;

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
  let pages = 0;
  for await (const file of htmlFiles(out)) {
    const { html, removed } = stripPage(await readFile(file, "utf8"));
    // Parse the result again: anything still runnable means a form this does not know, so stop the build.
    if (stripPage(html).removed > 0) throw new Error(`${file} still has a script after stripping`);
    if (removed === 0) continue;
    await writeFile(file, html);
    pages++;
  }
  console.log(`Removed the React runtime from ${pages} pages.`);
}

// Compare real paths: Node gives argv[1] as typed, import.meta.url resolved, so a symlinked
// checkout would otherwise skip the step and still exit 0.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
