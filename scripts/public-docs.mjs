#!/usr/bin/env node
// What the Release workflow publishes in the public zorvo-releases repository.
// The source repository is private, so the public changelog leaves out the
// Unreleased section and every link into it.
//
//   node scripts/public-docs.mjs changelog CHANGELOG.md > public/CHANGELOG.md

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PRIVATE_REPO = "https://github.com/zakyirsyaad/zorvo";

/** True for a link into the private repository (not into zorvo-releases). */
function isPrivateLink(url) {
  return url === PRIVATE_REPO || /^https:\/\/github\.com\/zakyirsyaad\/zorvo[/#]/.test(url);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The changelog as the public may read it: released versions only, no links into the private repository. */
export function publicChangelog(text) {
  const lines = text.split("\n");
  const privateLabels = [];
  const kept = [];
  let inUnreleased = false;
  for (const line of lines) {
    if (/^## /.test(line)) inUnreleased = /^## \[Unreleased\]/i.test(line);
    if (inUnreleased) continue;
    const reference = /^\[([^\]]+)\]:\s*(\S+)/.exec(line);
    if (reference && isPrivateLink(reference[2])) {
      privateLabels.push(reference[1]);
      continue;
    }
    kept.push(line);
  }
  let out = kept.join("\n");
  // A reference whose link was dropped keeps its text: "[#85]" becomes "#85".
  for (const label of privateLabels) {
    out = out.replace(new RegExp(`\\[${escapeRegExp(label)}\\](?![(:\\[])`, "g"), label);
  }
  return out.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** A Markdown document's `## ` sections, by heading, each trimmed. */
export function sectionsOf(text) {
  const sections = new Map();
  for (const part of text.split(/^## /m).slice(1)) {
    const newline = part.indexOf("\n");
    const heading = part.slice(0, newline).trim();
    sections.set(heading, part.slice(newline + 1).trim());
  }
  return sections;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [kind, file] = process.argv.slice(2);
  if (kind !== "changelog" || !file) {
    console.error("Usage: node scripts/public-docs.mjs changelog <CHANGELOG.md>");
    process.exit(2);
  }
  process.stdout.write(publicChangelog(readFileSync(file, "utf8")));
}
