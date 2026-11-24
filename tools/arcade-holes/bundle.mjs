#!/usr/bin/env node
// Bundle the arcade stage courses for a release build (lib/arcade-bundle.js installs them
// into the data dir on first boot):
//
//   node tools/arcade-holes/bundle.mjs [--out <dir>] [--check]
//     --out     bundle dir (default <repo>/build/arcade-data)
//     --check   exit 1 if the bundle on disk is missing or does not match the hole files
//
// Writes <out>/courses/*.json, <out>/arcade-tour.json and <out>/bundle.json:
//   { format, revision, appVersion, builtAt, courses: [{ file, id, name, sha256, bytes }], tour: { sha256 } }
// `revision` only moves when the CONTENT changes (the build is deterministic), so starting
// the app twice from the same sources never rewrites a player's data dir.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { COURSES, FAILED, TOUR_FILE, buildCourse, tourManifest } = require('./courses.js');
const { validateCourse } = require('./lib.js');
const { courseCacheStem } = require('../../lib/course-identity.js');
const { sha256, BUNDLE_FILE, BUNDLE_FORMAT, COURSE_RX, readBundle } = require('../../lib/arcade-bundle.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const outDir = path.resolve(flag('--out') || path.join(repo, 'build', 'arcade-data'));
const check = args.includes('--check');

// A release must not ship half a tour: any hole that fails stops the bundle.
if (FAILED.length) {
  for (const f of FAILED) console.error(`FAILED  ${f.id}${f.file ? ` (holes/${f.file})` : ''}: ${f.error.message}`);
  process.exit(1);
}
const built = [];
for (const spec of COURSES) {
  try {
    const { course, expect } = buildCourse(spec.id);
    validateCourse(course, { expect });
    const file = `${courseCacheStem(course.source)}.json`;
    if (!COURSE_RX.test(file)) throw new Error(`unexpected course file name ${file}`);
    built.push({ id: spec.id, course, file, buf: Buffer.from(JSON.stringify(course)) });
  } catch (error) {
    console.error(`FAILED  ${spec.name}: ${error.message}`);
    process.exit(1);
  }
}
const tourBuf = Buffer.from(`${JSON.stringify(tourManifest(built), null, 2)}\n`);
const courses = built.map((b) => ({ file: b.file, id: b.id, name: b.course.name, sha256: sha256(b.buf), bytes: b.buf.length }));
const tour = { sha256: sha256(tourBuf) };
const contentKey = sha256(Buffer.from(JSON.stringify({ courses: courses.map((c) => [c.file, c.sha256]), tour })));

const previous = readBundle(outDir);
const same = !!previous && previous.contentKey === contentKey
  && courses.every((c) => fs.existsSync(path.join(outDir, 'courses', c.file)))
  && fs.existsSync(path.join(outDir, TOUR_FILE));

if (check) {
  console.log(same ? `Arcade bundle is current (revision ${previous.revision}, ${courses.length} courses).` : 'Arcade bundle is missing or stale: run npm run prepare:arcade-data');
  process.exit(same ? 0 : 1);
}
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
if (same) {
  // the same stages under a new app version: say so in the manifest, keep the revision
  if (previous.appVersion !== pkg.version) fs.writeFileSync(path.join(outDir, BUNDLE_FILE), `${JSON.stringify({ ...previous, appVersion: pkg.version }, null, 2)}\n`);
  console.log(`Arcade bundle unchanged: ${courses.length} courses, revision ${previous.revision}  (${outDir})`);
  process.exit(0);
}

fs.rmSync(path.join(outDir, 'courses'), { recursive: true, force: true });   // only our own output dir
fs.mkdirSync(path.join(outDir, 'courses'), { recursive: true });
for (const b of built) fs.writeFileSync(path.join(outDir, 'courses', b.file), b.buf);
fs.writeFileSync(path.join(outDir, TOUR_FILE), tourBuf);
const now = new Date();
const manifest = {
  format: BUNDLE_FORMAT,
  // newer content always gets a higher number: lib/arcade-bundle.js replaces what an older
  // bundle installed only when this is greater
  revision: Math.max(Math.floor(now.getTime() / 1000), previous ? previous.revision + 1 : 0),
  appVersion: pkg.version,
  builtAt: now.toISOString(),
  contentKey,
  courses,
  tour,
};
fs.writeFileSync(path.join(outDir, BUNDLE_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
const bytes = built.reduce((n, b) => n + b.buf.length, 0) + tourBuf.length;
const t = JSON.parse(tourBuf);
console.log(`Arcade bundle written: ${courses.length} courses (${t.stages.length} match stages, ${t.tiebreaks.length} tiebreak arenas), ${(bytes / 1048576).toFixed(1)} MB, revision ${manifest.revision}`);
console.log(`  ${outDir}`);
