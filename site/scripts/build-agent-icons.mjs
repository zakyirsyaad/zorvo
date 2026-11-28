// Writes the strip's agent icons to public/agents/<id>.svg (git-ignored), from the registry icons the app
// bundles. The page uses each file as a CSS mask, so an icon can only ever give a shape; this still refuses
// anything but plain SVG.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const icons = JSON.parse(readFileSync(`${root}../src-tauri/resources/registry-icons.json`, "utf8"));
const source = readFileSync(`${root}lib/strip-agents.ts`, "utf8");
const list = source.slice(source.indexOf("STRIP_AGENTS"));
const entries = [...list.matchAll(/\{[^{}]*\}/g)].map((match) => match[0]);
if (entries.length === 0) throw new Error("No agents found in lib/strip-agents.ts");
// An agent with a colour logo of its own needs no icon file.
const ids = entries
  .filter((entry) => !/\blogo:/.test(entry))
  .map((entry) => {
    const id = /\bid:\s*"([a-z0-9-]+)"/.exec(entry)?.[1];
    if (!id) throw new Error(`An agent in lib/strip-agents.ts has no readable id: ${entry}`);
    return id;
  });

const out = `${root}public/agents`;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const id of ids) {
  const svg = icons[id];
  if (typeof svg !== "string" || !/^\s*(<\?xml[^>]*\?>\s*)?<svg[\s>]/.test(svg)) throw new Error(`${id}: no SVG icon in the registry copy`);
  if (/<script|on\w+\s*=|<foreignObject|href\s*=/i.test(svg)) throw new Error(`${id}: the icon is not plain SVG`);
  writeFileSync(`${out}/${id}.svg`, svg);
}
console.log(`agent icons: ${ids.length} files`);
