// Bundles the landing page's motion script to public/motion.js (git-ignored), which Next copies into out/.
// One IIFE, minified, with only what the script imports from GSAP and Motion.
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const outfile = `${root}public/motion.js`;
await build({
  entryPoints: [`${root}scripts/motion/landing.ts`],
  outfile,
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2022",
  legalComments: "none",
  logLevel: "warning",
});
const bytes = readFileSync(outfile);
console.log(`motion.js: ${bytes.length} bytes, ${gzipSync(bytes, { level: 9 }).length} bytes gzipped`);
