#!/usr/bin/env node
'use strict';
// Put the GitHub account name in the places that carry the placeholder OWNER, once the
// repository exists (docs/dev/publishing.md):
//
//   node tools/release/set-owner.cjs <github-name>
//
// public/product.json (repo.owner: the game's credits link), site/config.js (every link on
// the site), and the clone address in README.md and CONTRIBUTING.md.
const fs = require('fs');
const path = require('path');

const repo = path.join(__dirname, '..', '..');
const owner = process.argv[2];
if (!owner || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner) || owner === 'OWNER') {
  console.error('Usage: node tools/release/set-owner.cjs <github-name>');
  process.exit(1);
}
const edits = [
  ['public/product.json', /("owner":\s*")OWNER(")/],
  ['site/config.js', /(owner:\s*')OWNER(')/],
  ['README.md', /(github\.com\/)OWNER(\/)/g],
  ['CONTRIBUTING.md', /(github\.com\/)OWNER(\/)/g],
];
let changed = 0;
for (const [file, rx] of edits) {
  const full = path.join(repo, file);
  if (!fs.existsSync(full)) { console.log(`  (no ${file})`); continue; }
  const text = fs.readFileSync(full, 'utf8');
  const next = text.replace(rx, (_m, a, b) => `${a}${owner}${b}`);
  if (next !== text) { fs.writeFileSync(full, next); changed++; console.log(`  ${file}`); }
  else console.log(`  ${file}: nothing to change`);
}
console.log(`${changed} file(s) updated for github.com/${owner}.`);
