#!/usr/bin/env node
// Build the arcade courses into the data dir, where the app finds them like any cached
// course:   node tools/arcade-holes/build.mjs [--out <dataDir>] [--only <id>] [--check]
//   --out     data dir (default: BIRDIE_DATA_DIR, else <repo>/data); files go to <out>/courses/
//   --only    write one course (a stage id such as lagoon-island, or arcade-classics)
//   --check   validate only, write nothing
// Every hole file in holes/ with a `stage` is its own course (see courses.js). Also writes
// the tour manifest <out>/arcade-tour.json: the stages and tiebreak arenas that built, in
// order. A hole that fails to load or to validate fails here by name, with exit code 1;
// the other courses and the manifest are still written.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { COURSES, FAILED, TOUR_FILE, buildCourse, courseFile, tourManifest, writeTourManifest } = require('./courses.js');
const { validateCourse, writeCourse } = require('./lib.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const dataDir = path.resolve(flag('--out') || process.env.BIRDIE_DATA_DIR || path.join(here, '..', '..', 'data'));
const only = flag('--only');
const check = args.includes('--check');

if (only && !COURSES.some((c) => c.id === only) && !FAILED.some((f) => f.id === only)) {
  console.error(`No arcade course '${only}' (have: ${COURSES.map((c) => c.id).join(', ')})`);
  process.exit(1);
}

let failed = false;
const shout = (name, error) => {
  failed = true;
  console.error(`FAILED  ${name}: ${error && error.message ? error.message : error}`);
};
// hole files that did not even load (a syntax error, a throw, a bad `stage`)
for (const f of FAILED) if (!only || f.id === only) shout(f.file ? `${f.id} (holes/${f.file})` : f.id, f.error);

const sound = [];        // every course that validated in this run: the manifest's candidates
for (const spec of COURSES) {
  const wanted = !only || spec.id === only;
  try {
    const { course, expect } = buildCourse(spec.id);
    // a course outside --only is validated for the manifest, not written and not printed
    const report = check || !wanted ? { ...validateCourse(course, { expect }), file: '(not written)' } : writeCourse(course, dataDir, { expect });
    sound.push({ id: spec.id, course });
    if (!wanted) continue;
    const holes = report.stats.holes.map((h) => `${h.name} par ${h.par} ${h.lengthYd} yd (direct ${h.directYd}), green ${h.greenM.join(' x ')} m at ${h.greenSlopePct} %`);
    const a = course.arcade;
    console.log(`${course.name}  [${report.courseId}]`);
    if (a.formatVersion >= 2) console.log(`  stage  ${a.role} ${a.order}, theme ${a.theme}, ${a.timeOfDay}${a.conditions ? `, ${a.conditions}` : ''}, difficulty ${a.difficulty}${a.wind ? `, wind ${a.wind.min} to ${a.wind.max} mph` : ''}${a.freeBall ? `, FREE ${a.freeBall} ball on the tee` : ''}: ${a.blurb}`);
    console.log(`  file   ${report.file}${report.bytes ? `  (${Math.round(report.bytes / 1024)} KB)` : ''}`);
    console.log(`  grid   ${course.elevation.nx} x ${course.elevation.ny} at ${course.elevation.cellM} m, sea ${report.stats.sea ? `at ${report.stats.sea.level} m over ${Math.round(report.stats.sea.frac * 100)} % of it` : 'none'}`);
    for (const h of holes) console.log(`  hole   ${h}`);
    for (const h of course.holes) for (const r of h.routes || []) console.log(`  route  ${r.id.padEnd(6)} ${r.name}: ${r.note}`);
    console.log(`  props  ${course.props.length}, trees ${course.trees.length}`);
    for (const w of report.warnings) console.log(`  warn   ${w}`);
    if (!check) console.log(`  load   POST /api/load-course {"cached":"${report.file}"}`);
  } catch (error) {
    if (wanted) shout(spec.name, error);
  }
}

// The tour: only stages whose course file is really there (with --only, the others must
// have been built before).
const present = check ? sound : sound.filter(({ course }) => fs.existsSync(path.join(dataDir, 'courses', courseFile(course.source.osmId - 9_900_000_000_000))));
const manifest = tourManifest(present);
const line = (list) => list.map((s) => `${s.order}. ${s.name} (par ${s.par}, ${s.lengthYd} yd${s.freeBall ? `, free ${s.freeBall}` : ''})`).join(', ') || 'none';
console.log(`\nClash Tour: ${manifest.stages.length} stage(s): ${line(manifest.stages)}`);
console.log(`Tiebreak arenas: ${manifest.tiebreaks.length}: ${line(manifest.tiebreaks)}`);
if (!check) {
  console.log(`\nWritten to ${path.join(dataDir, 'courses')}`);
  console.log(`Tour manifest ${writeTourManifest(manifest, dataDir)}`);
} else console.log(`\n(--check: nothing written; ${TOUR_FILE} would list the above)`);
if (failed) console.error('\nSome courses FAILED (see above); the rest were built.');
process.exit(failed ? 1 : 0);
