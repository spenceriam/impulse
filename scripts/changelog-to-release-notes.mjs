#!/usr/bin/env node
/**
 * Extract GitHub Release title and body from CHANGELOG.md for a given version.
 *
 * Usage: node scripts/changelog-to-release-notes.mjs <version> [changelogPath]
 * Writes: release-notes.md, release-title.txt
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const version = process.argv[2];
const changelogPath = resolve(process.cwd(), process.argv[3] ?? "CHANGELOG.md");

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: node scripts/changelog-to-release-notes.mjs <version> [changelogPath]");
  process.exit(1);
}

const markdown = readFileSync(changelogPath, "utf8");
const lines = markdown.split("\n");

const headerRe = new RegExp(
  `^##\\s*\\[?${version.replace(/\./g, "\\.")}\\]?\\s*[-–]\\s*(\\d{4}-\\d{2}-\\d{2})`
);
const nextVersionRe = /^##\s*\[?\d+\.\d+\.\d+\]?/;

let start = -1;
let date = "";
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(headerRe);
  if (m) {
    start = i;
    date = m[1];
    break;
  }
}

if (start === -1) {
  console.error(`CHANGELOG.md: no section found for version ${version}`);
  process.exit(1);
}

let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
  if (nextVersionRe.test(lines[i])) {
    end = i;
    break;
  }
}

const block = lines.slice(start + 1, end);

let titleSuffix = "";
const bodyLines = [`## v${version} — ${date}`, ""];

for (const line of block) {
  const titleMatch = line.match(/^\s*\*\*Title:\*\*\s*(.+)\s*$/);
  if (titleMatch) {
    titleSuffix = titleMatch[1].trim();
    continue;
  }
  if (/^\s*\*\*Type:\*\*/.test(line)) {
    continue;
  }

  const sectionMatch = line.match(/^\s*###\s+(.+)\s*$/);
  if (sectionMatch) {
    bodyLines.push(`### ${sectionMatch[1].trim()}`, "");
    continue;
  }

  const bulletMatch = line.match(/^\s*-\s+(.+)\s*$/);
  if (bulletMatch) {
    bodyLines.push(`- ${bulletMatch[1].trim()}`);
    continue;
  }

  if (line.trim() === "") {
    if (bodyLines.length > 0 && bodyLines[bodyLines.length - 1] !== "") {
      bodyLines.push("");
    }
  }
}

while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1] === "") {
  bodyLines.pop();
}

const releaseTitle = titleSuffix
  ? `v${version} — ${titleSuffix}`
  : `v${version}`;

writeFileSync("release-notes.md", `${bodyLines.join("\n")}\n`, "utf8");
writeFileSync("release-title.txt", releaseTitle, "utf8");

console.log(`Wrote release-title.txt: ${releaseTitle}`);
console.log("Wrote release-notes.md");
