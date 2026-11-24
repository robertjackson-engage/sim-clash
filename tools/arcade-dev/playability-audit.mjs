#!/usr/bin/env node
// Playability audit (v2:playability): how many resting spots of each arcade stage are
// DEAD (no realistic swing gets the ball 15 yd nearer the hole) or HARD (only one club
// family does), and how many swings out of sand go nowhere.
//
//   node tools/arcade-dev/playability-audit.mjs [--assist] [--both] [--step 12] [--only <stage>] [--json <file>]
//     --assist   with the arcade layer's assists (launch clearance, soft trees, 90 degree aim)
//     --both     the plain simulator and the assists, side by side
//     --step     grid pitch in metres (12; sand is sampled four times as fine, the
//                15 m round cliffs and trees twice as fine)
//     --json     write the full result (dead spots included) to this file
// The stages are built in memory from tools/arcade-holes (what build.mjs writes).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { stageIds, auditStage, table } = require('./playability-core.cjs');

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const step = Number(flag('--step')) || 12;
const only = flag('--only');
const both = args.includes('--both');
const assist = args.includes('--assist');
const ids = stageIds().filter((id) => !only || id === only);
if (!ids.length) { console.error(`No stage '${only}' (have: ${stageIds().join(', ')})`); process.exit(1); }

const run = (on) => ids.map((id) => {
  const t0 = Date.now();
  const r = auditStage(id, { assist: on, step });
  process.stderr.write(`  ${on ? 'assist' : 'plain '} ${id}: ${r.spots} spots, ${r.swings} swings, ${Date.now() - t0} ms\n`);
  return r;
});
const before = both || !assist ? run(false) : null;
const after = both || assist ? run(true) : null;
console.log(`\nPlayability audit, ${step} m grid${both ? ': plain simulator | arcade assists' : assist ? ': arcade assists' : ': plain simulator'}\n`);
console.log(before ? table(before, after) : table(after));
const causes = (list) => list.reduce((s, r) => { for (const k of Object.keys(r.causes)) s[k] = (s[k] || 0) + r.causes[k]; return s; }, {});
const zones = (list) => list.reduce((s, r) => { for (const [k, z] of Object.entries(r.byZone)) { s[k] ||= { n: 0, dead: 0 }; s[k].n += z.n; s[k].dead += z.dead; } return s; }, {});
for (const [label, list] of [['plain', before], ['assist', after]]) {
  if (!list) continue;
  console.log(`\n${label}: what killed the swings at the flag on dead and hard spots: ${JSON.stringify(causes(list))}`);
  console.log(`${label}: dead spots by zone: ${Object.entries(zones(list)).map(([k, z]) => `${k} ${z.dead}/${z.n}`).join(', ')}`);
}
const out = flag('--json');
if (out) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ step, at: new Date().toISOString(), before, after }, null, 1));
  console.log(`\nWritten to ${path.resolve(out)}`);
}
