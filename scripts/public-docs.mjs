#!/usr/bin/env node
// A release's notes, from CHANGELOG.md. They leave out the Unreleased section, and
// references into this repository become plain text, which GitHub links by itself.
//
//   node scripts/public-docs.mjs notes CHANGELOG.md v1.2.3 > notes.md

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE_REPO = "https://github.com/zakyirsyaad/zorvo";

/** True for a link into this repository. */
function isSourceLink(url) {
  return url === SOURCE_REPO || /^https:\/\/github\.com\/zakyirsyaad\/zorvo[/#]/.test(url);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The changelog for release notes: released versions only, no references into this repository. */
export function publicChangelog(text) {
  const lines = text.split("\n");
  const sourceLabels = [];
  const kept = [];
  let inUnreleased = false;
  for (const line of lines) {
    if (/^## /.test(line)) inUnreleased = /^## \[Unreleased\]/i.test(line);
    if (inUnreleased) continue;
    const reference = /^\[([^\]]+)\]:\s*(\S+)/.exec(line);
    if (reference && isSourceLink(reference[2])) {
      sourceLabels.push(reference[1]);
      continue;
    }
    kept.push(line);
  }
  let out = kept.join("\n");
  // A reference whose link was dropped keeps its text: "[#85]" becomes "#85".
  for (const label of sourceLabels) {
    out = out.replace(new RegExp(`\\[${escapeRegExp(label)}\\](?![(:\\[])`, "g"), label);
  }
  return out.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** One version's public notes, without its heading; empty when the changelog does not list it. */
export function releaseNotes(text, version) {
  const wanted = version.replace(/^v/, "");
  const heading = new RegExp(`^${escapeRegExp(wanted)}(\\s|$)`);
  const changelog = publicChangelog(text);
  // Link definitions sit at the end of the changelog, after the last version.
  const definitions = [...changelog.matchAll(/^\[([^\]]+)\]:\s*\S+$/gm)];
  for (const [name, body] of sectionsOf(changelog)) {
    if (!heading.test(name)) continue;
    const notes = body.replace(/^\[[^\]]+\]:\s*\S+$/gm, "").trim();
    const used = definitions.filter(([, label]) => notes.includes(`[${label}]`)).map(([line]) => line);
    return used.length ? `${notes}\n\n${used.join("\n")}` : notes;
  }
  return "";
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
  const [kind, file, version] = process.argv.slice(2);
  const text = file ? readFileSync(file, "utf8") : "";
  if (kind === "notes" && file && version) {
    const notes = releaseNotes(text, version);
    if (!notes) {
      console.error(`CHANGELOG.md has no section for ${version}.`);
      process.exit(1);
    }
    process.stdout.write(notes + "\n");
  } else {
    console.error("Usage: node scripts/public-docs.mjs notes <CHANGELOG.md> <version>");
    process.exit(2);
  }
}
