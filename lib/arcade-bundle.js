'use strict';
// The arcade courses that ship with the app (release packaging; docs/dev/packaging.md).
//
// In a source checkout the arcade stages are built by tools/arcade-holes/build.mjs. An
// installed app has no tools and its data dir (per-user AppData) starts empty, so the build
// bundles the stage courses and the tour manifest ahead of time:
//
//   npm run prepare:arcade-data   ->  build/arcade-data/{bundle.json, arcade-tour.json, courses/*.json}
//   electron-builder               ->  <resources>/arcade-data/   (package.json build.extraResources)
//
// and the server calls installArcadeBundle() once on boot, before it lists the courses,
// WHEN it was told where the bundle is: the Electron shell (main.js) always says so, and
// `node server.js --bundled-arcade` (npm run start:server) does too. A bare
// `node server.js` (tests, private dev instances) installs nothing: its data dir is
// whatever tools/arcade-holes/build.mjs put there.
// What the install does, and what it never does:
//
//   - It copies only the files named in bundle.json (the arcade stage courses, whose names
//     are their own synthetic ids, and arcade-tour.json). Downloaded courses, profiles,
//     coins, the match ledger and every other file of the data dir are never touched.
//   - A file is written when it is missing, or when the bundle is NEWER than the one that
//     was installed last (bundle.json `revision`, remembered in <dataDir>/arcade-bundle.json).
//   - A file that is already byte-identical is left alone.
//   - No bundle (a checkout that has never run prepare:arcade-data): nothing happens.
//
// Synchronous on purpose: it runs once, before the first listCached(), on about 6 MB.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BUNDLE_FILE = 'bundle.json';
const RECORD_FILE = 'arcade-bundle.json';
const TOUR_FILE = 'arcade-tour.json';
const BUNDLE_FORMAT = 1;
// A bundled course file: the cache stem of an arcade course, nothing with a path in it.
const COURSE_RX = /^osm-node-99\d{11}\.json$/;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function writeAtomic(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, buf);
  try { fs.renameSync(tmp, file); }
  catch (error) { try { fs.unlinkSync(tmp); } catch (_) { /* gone */ } throw error; }
}

const REPO_BUNDLE_DIR = path.join(__dirname, '..', 'build', 'arcade-data');

/**
 * Where the bundle to install is, or null for "do not install": BIRDIE_ARCADE_DIR (main.js
 * sets it: <resources>/arcade-data when packaged, <repo>/build/arcade-data from source),
 * else the repo's bundle when the server was started with --bundled-arcade.
 */
function bundleDirFor(env = process.env, argv = process.argv) {
  if (env.BIRDIE_ARCADE_DIR) return path.resolve(env.BIRDIE_ARCADE_DIR);
  return argv.includes('--bundled-arcade') ? REPO_BUNDLE_DIR : null;
}

/** The bundle's manifest, or null when there is no (valid) bundle in `bundleDir`. */
function readBundle(bundleDir) {
  const b = readJson(path.join(bundleDir, BUNDLE_FILE));
  if (!b || b.format !== BUNDLE_FORMAT || !Number.isFinite(b.revision) || !Array.isArray(b.courses)) return null;
  const courses = b.courses.filter((c) => c && typeof c.file === 'string' && COURSE_RX.test(c.file) && typeof c.sha256 === 'string');
  if (courses.length !== b.courses.length) return null;   // a name we would not write: refuse the lot
  return { ...b, courses };
}

/**
 * Install the bundled arcade courses into the data dir (see the top of this file).
 * -> { status: 'no-bundle' | 'current' | 'installed' | 'repaired' | 'failed', written: [file], revision, error? }
 * Never throws: a failed install leaves the game to start without the arcade stages.
 */
function installArcadeBundle({ bundleDir = bundleDirFor(), dataDir, log = console } = {}) {
  const out = { status: 'no-bundle', written: [], revision: null };
  try {
    if (!bundleDir) return out;
    if (!dataDir) throw new Error('no data dir');
    const bundle = readBundle(bundleDir);
    if (!bundle) return out;
    out.revision = bundle.revision;

    const coursesDir = path.join(dataDir, 'courses');
    const recordFile = path.join(dataDir, RECORD_FILE);
    const tourFile = path.join(dataDir, TOUR_FILE);
    const record = readJson(recordFile);
    const hasTour = fs.existsSync(tourFile);
    // newer: this bundle replaces what an older bundle (or nothing on record) put there
    const installedRevision = record && Number.isFinite(record.revision) ? record.revision : null;
    const newer = installedRevision === null || bundle.revision > installedRevision;

    for (const c of bundle.courses) {
      const dest = path.join(coursesDir, c.file);
      const missing = !fs.existsSync(dest);
      if (!missing && !newer) continue;
      const buf = fs.readFileSync(path.join(bundleDir, 'courses', c.file));
      if (sha256(buf) !== c.sha256) throw new Error(`bundled ${c.file} does not match its checksum`);
      if (!missing && sha256(fs.readFileSync(dest)) === c.sha256) continue;   // already this very file
      writeAtomic(dest, buf);
      out.written.push(c.file);
    }
    // the tour manifest: with a newer bundle, or when there is none
    if (newer || !hasTour) {
      const buf = fs.readFileSync(path.join(bundleDir, TOUR_FILE));
      if (!hasTour || sha256(fs.readFileSync(tourFile)) !== sha256(buf)) {
        writeAtomic(tourFile, buf);
        out.written.push(TOUR_FILE);
      }
    }
    if (newer) {
      writeAtomic(recordFile, Buffer.from(`${JSON.stringify({ format: BUNDLE_FORMAT, revision: bundle.revision, appVersion: bundle.appVersion || null, installedAt: new Date().toISOString() }, null, 2)}\n`));
    }
    out.status = !out.written.length ? 'current' : (newer ? 'installed' : 'repaired');
    if (out.written.length && log) {
      log.log(`[arcade] ${out.status === 'installed' ? 'installed' : 'restored'} ${out.written.filter((f) => f !== TOUR_FILE).length} stage course(s) from the bundle (revision ${bundle.revision}${bundle.appVersion ? `, ${bundle.appVersion}` : ''})`);
    }
    return out;
  } catch (error) {
    out.status = 'failed';
    out.error = error && error.message ? error.message : String(error);
    if (log) log.error(`[arcade] could not install the bundled stages: ${out.error}`);
    return out;
  }
}

module.exports = { installArcadeBundle, readBundle, bundleDirFor, REPO_BUNDLE_DIR, sha256, BUNDLE_FILE, RECORD_FILE, TOUR_FILE, BUNDLE_FORMAT, COURSE_RX };
