#!/usr/bin/env node
'use strict';
// Fill the launch-monitor table of README.md, between the two <!-- launch-monitors:... -->
// markers, from the catalogue (lib/launch-monitors.json: the same data the in-game
// connection wizard, docs/launch-monitors.md and the website read), so the README never
// carries a list of its own and never claims more than the catalogue does.
//
//   node tools/release/readme-monitors.cjs [--check]
//
// One row per tier, in the catalogue's order: the tier's name and meaning, word for word,
// and every launch monitor in it. How each one connects is in docs/launch-monitors.md.
// --check: exit 1 when the README is stale (nothing is written).
const fs = require('fs');
const path = require('path');

const repo = path.join(__dirname, '..', '..');
const readmeFile = path.join(repo, 'README.md');
const { CATALOGUE } = require(path.join(repo, 'lib', 'launch-monitors.js'));
const START = /<!-- launch-monitors:start[^>]*-->/;
const END = '<!-- launch-monitors:end -->';

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const brandName = (id) => (CATALOGUE.brands.find((b) => b.id === id) || { name: id }).name;
const fullName = (d) => (String(d.name).toLowerCase().startsWith(String(brandName(d.brand)).toLowerCase()) ? d.name : `${brandName(d.brand)} ${d.name}`);

const rows = CATALOGUE.tiers.map((t) => {
  const devices = CATALOGUE.devices.filter((d) => d.tier === t.id);
  return `| **${cell(t.name)}** (${devices.length}) | ${cell(t.blurb)} | ${devices.length ? devices.map((d) => cell(fullName(d))).join('; ') : 'none yet'} |`;
});
const table = ['| Tier | What it means | Launch monitors |', '| --- | --- | --- |', ...rows, '', `Catalogue version ${CATALOGUE.version}, checked ${CATALOGUE.updated}.`].join('\n');

const raw = fs.readFileSync(readmeFile, 'utf8');
const crlf = raw.includes('\r\n');
const readme = raw.replace(/\r\n/g, '\n');
const s = START.exec(readme);
const e = readme.indexOf(END);
if (!s || e < 0 || e < s.index) { console.error('README.md has no launch-monitors markers.'); process.exit(1); }
const next = `${readme.slice(0, s.index + s[0].length)}\n${table}\n${readme.slice(e)}`;
if (next === readme) { console.log('README launch-monitor table is current.'); process.exit(0); }
if (process.argv.includes('--check')) { console.error('README launch-monitor table is stale: run node tools/release/readme-monitors.cjs'); process.exit(1); }
fs.writeFileSync(readmeFile, crlf ? next.replace(/\n/g, '\r\n') : next);
console.log(`README launch-monitor table updated (${CATALOGUE.devices.length} launch monitors in ${CATALOGUE.tiers.length} tiers).`);
