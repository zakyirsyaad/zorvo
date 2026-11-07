// The site has no client components: every page is complete HTML, and React's runtime only
// hydrates what is already there. After `next build`, this removes that runtime from each page
// in out/ (script tags, their preloads and the inline flight data), so a visitor downloads no
// JavaScript. Structured data (`application/ld+json`) is data, not script, and stays.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, serialize } from "parse5";

/** @typedef {{ nodeName: string, attrs?: { name: string, value: string }[], childNodes?: Node[], content?: Node }} Node */

/** @param {Node} node @param {string} name */
const attr = (node, name) => node.attrs?.find((entry) => entry.name === name)?.value;

/** A script that runs, or a hint to fetch one; structured data is a script element but never runs. */
function isRuntime(/** @type {Node} */ node) {
  if (node.nodeName === "script") return attr(node, "type") !== "application/ld+json";
  if (node.nodeName === "link") return attr(node, "rel") === "modulepreload" || attr(node, "as") === "script";
  return false;
}

/** Drops runtime nodes from a parsed tree, template contents included. @param {Node} node */
function prune(node) {
  if (node.content) prune(node.content);
  if (!node.childNodes) return;
  node.childNodes = node.childNodes.filter((child) => !isRuntime(child));
  node.childNodes.forEach(prune);
}

/**
 * Parses the page as a browser would, removes its scripts and script preloads, and writes it back,
 * so what is removed is exactly what a browser would have run.
 * @param {string} html @returns {string}
 */
export function stripRuntime(html) {
  const document = parse(html);
  prune(/** @type {Node} */ (/** @type {unknown} */ (document)));
  return serialize(document);
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
