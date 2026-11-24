#!/usr/bin/env node
// The stage table of docs/arcade-holes.md, written from the catalogue as it builds now
// (lengths, straight-line distance, wind range, time of day, routes, blurb): nothing in it
// is typed by hand, so it cannot go stale.
//
//   node tools/arcade-holes/table.mjs            print the table
//   node tools/arcade-holes/table.mjs --write    replace the table in docs/arcade-holes.md
//                                                (between the STAGE-TABLE markers)
//   node tools/arcade-holes/table.mjs --check    exit 1 when the doc's table is not current
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CAT = require('./courses.js');
const { windRange } = (() => { try { return require('../../lib/arcade-wind.js'); } catch { return {}; } })();

const YD = 0.9144;
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');
const { built, failed } = CAT.buildCatalogue();   // [{ id, spec, course, report }]
if (failed.length) { console.error(`Not built: ${failed.map((f) => `${f.id} (${f.error && f.error.message})`).join(', ')}`); process.exit(2); }
const manifest = CAT.tourManifest(built);
const byId = new Map(built.filter((b) => b.course.arcade).map((b) => [b.course.arcade.id, b.course]));

function row(e, role) {
  const course = byId.get(e.id);
  const hole = course.holes[0];
  const direct = Math.round(Math.hypot(hole.pin[0] - hole.tee[0], hole.pin[1] - hole.tee[1]) / YD);
  const hs = course.elevation && course.elevation.heights;
  const at = (x, y) => { const el = course.elevation; if (!el) return 0; const i = Math.max(0, Math.min(el.nx - 1, Math.round((x - el.minX) / el.cellM))), j = Math.max(0, Math.min(el.ny - 1, Math.round((y - el.minY) / el.cellM))); return hs[j * el.nx + i] || 0; };
  const rise = Math.round(at(hole.pin[0], hole.pin[1]) - at(hole.tee[0], hole.tee[1]));
  const len = `par ${e.par}, ${e.lengthYd} yd${Math.abs(direct - e.lengthYd) > 5 ? ` (${direct} straight)` : ''}${Math.abs(rise) >= 8 ? `, ${Math.abs(rise)} m ${rise > 0 ? 'up' : 'down'}` : ''}`;
  const w = e.wind || (windRange ? windRange(course.arcade) : null);
  const wind = w ? `${w.min} to ${w.max}` : '';
  const routes = (hole.routes || []).map((r) => `${r.id}: ${r.name}`).join('; ');
  const what = `${role}${e.freeBall ? `, **${e.freeBall} hole**` : ''}`;
  return `| ${e.number} | ${esc(e.name)} (\`${e.id}\`) | \`${e.file}\` | ${what} | ${e.theme}, ${e.timeOfDay || 'day'} | ${len} | ${wind} | ${esc(routes)} | ${esc(e.blurb)} |`;
}

const lines = [
  '| # | Stage (`id`) | File in `data/courses/` | Role | Theme, time | The hole | Wind (mph) | Routes | On the intro screen |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...manifest.stages.map((e) => row(e, e.order <= 9 ? `match ${e.order}${e.order === 9 ? ', the finale' : ''}` : `extra ${e.order}`)),
  ...manifest.tiebreaks.map((e) => row(e, `tiebreak ${e.order}`)),
  `| ${CAT.CLASSICS_NUMBER} | Arcade Classics (\`arcade-classics\`) | \`${CAT.courseFile(CAT.CLASSICS_NUMBER)}\` | (legacy, not on the tour) | | stages 1 to 3 as holes 1 to 3 on one piece of ground | | | |`,
];
const table = lines.join('\n');
const START = '<!-- STAGE-TABLE:start (node tools/arcade-holes/table.mjs --write) -->', END = '<!-- STAGE-TABLE:end -->';
const docFile = path.join(repo, 'docs', 'arcade-holes.md');
const args = process.argv.slice(2);
if (args.includes('--write') || args.includes('--check')) {
  // The doc is compared and rewritten with LF inside, whatever the checkout's line endings
  // are (a Windows clone with core.autocrlf has CRLF on disk): the table is stale when its
  // TEXT differs, never because of how its lines end. --write keeps the file's own endings.
  const raw = fs.readFileSync(docFile, 'utf8');
  const crlf = raw.includes('\r\n');
  const doc = raw.replace(/\r\n/g, '\n');
  const a = doc.indexOf(START), b = doc.indexOf(END);
  if (a < 0 || b < a) { console.error(`No ${START} ... ${END} block in ${docFile}`); process.exit(2); }
  const next = `${doc.slice(0, a)}${START}\n${table}\n${doc.slice(b)}`;
  if (args.includes('--check')) { if (next !== doc) { console.error('docs/arcade-holes.md: the stage table is stale (node tools/arcade-holes/table.mjs --write)'); process.exit(1); } console.log('docs/arcade-holes.md: the stage table is current'); }
  else { fs.writeFileSync(docFile, crlf ? next.replace(/\n/g, '\r\n') : next); console.log(`docs/arcade-holes.md: stage table written (${manifest.stages.length} stages, ${manifest.tiebreaks.length} arenas)`); }
} else console.log(table);
