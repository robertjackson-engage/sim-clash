'use strict';
// The arcade course catalogue (docs/arcade-holes.md, docs/dev/arcade-v2-contract.md section 1).
//
// Every file in holes/ that exports a `stage` becomes its own single-hole course: one
// hole, one world, with its own theme, sky and wind. Nine match stages make the Clash
// Tour; three more are tiebreak arenas. To add a stage, add a hole file: nothing here
// needs editing. The legacy three-hole Arcade Classics is the one hand-listed course.
//
// build.mjs writes the courses and the tour manifest (arcade-tour.json) to the data dir;
// test/arcade-holes.test.js builds them in memory.
//
// The catalogue is read once, when this module loads, from holes/ (or from the directory
// named by ARCADE_HOLES_DIR, which the tests use to prove that a broken hole file fails
// alone). loadCatalogue(dir) reads any other directory.

const fs = require('node:fs');
const path = require('node:path');
const L = require('./lib');
const courseLib = require('../../lib/course.js');
const { courseCacheStem } = require('../../lib/course-identity.js');

const HOLES_DIR = path.join(__dirname, 'holes');
const TOUR_FILE = 'arcade-tour.json';
const TOUR_VERSION = 1;
const CLASSICS_NUMBER = 100;
const CLASSICS_HOLES = Object.freeze(['lagoon-island', 'canyon-run', 'lighthouse-point']);

const courseFile = (number) => `${courseCacheStem(L.arcadeSource(number))}.json`;

function loadCatalogue(holesDir = HOLES_DIR) {
  // ---- discovery: holes/*.js, each loaded on its own so one broken file fails alone
  const PIECES = {};     // id -> the hole file's export, for every file that loaded
  const FAILED = [];     // [{ id, name, file, error }]: a course that cannot be built, and why
  const fail = (id, file, error) => FAILED.push({ id, name: id, file, error: error instanceof Error ? error : new Error(String(error)) });

  const stageSpecs = [];
  const files = fs.readdirSync(holesDir).filter((f) => f.endsWith('.js')).sort();
  for (const file of files) {
    const id = path.basename(file, '.js');
    let piece;
    try {
      piece = require(path.join(holesDir, file));
      if (!piece || typeof piece !== 'object') throw new Error(`${file} exports no hole`);
      if (piece.id !== id) throw new Error(`${file} exports id '${piece.id}': a hole's id is its file name`);
    } catch (error) {
      fail(id, file, error);
      continue;
    }
    PIECES[id] = piece;
    if (piece.stage === undefined) continue;          // a hole that is only part of a larger course
    try {
      const stage = L.normalizeStage(piece.stage, id);
      // number: the course's synthetic identity (osm:node:<9900000000000 + number>). Never
      // reuse or change one: saved rounds, cache entries and HD bundles are keyed by it.
      // origin: open ocean on purpose (sun and sky only; see assembleCourse).
      stageSpecs.push({
        id, number: stage.number, name: stage.name, origin: stage.origin,
        ...(stage.baseM ? { baseM: stage.baseM } : {}),
        ...(stage.conditions ? { conditions: stage.conditions } : {}),
        stage, file,
        pieces: [{ piece }],
      });
    } catch (error) {
      fail(id, file, error);
    }
  }

  // Two stages may not share a number (an identity) or a place in the running order. The
  // first file by name keeps it; the other fails, loudly, on its own.
  const roleRank = (role) => (role === 'match' ? 0 : 1);
  const STAGES = [];
  for (const spec of stageSpecs) {
    const clash = STAGES.find((s) => s.number === spec.number) ||
      STAGES.find((s) => s.stage.role === spec.stage.role && s.stage.order === spec.stage.order);
    if (clash) {
      const what = clash.number === spec.number ? `number ${spec.number}` : `${spec.stage.role} order ${spec.stage.order}`;
      fail(spec.id, spec.file, new Error(`${spec.id}: stage ${what} is already taken by ${clash.id}`));
      continue;
    }
    STAGES.push(spec);
  }
  STAGES.sort((a, b) => roleRank(a.stage.role) - roleRank(b.stage.role) || a.stage.order - b.stage.order);

  // ---- Arcade Classics: the first three holes on one piece of ground, as before. A plain
  // 11 m above the sea, with the sea north of it (round Lagoon Island) and west of it
  // (below Lighthouse Point).
  // (A directory with none of its three hole files simply has no Arcade Classics.)
  const plain = [[-50, -500], [1000, -500], [1000, 470], [-50, 470]];
  const plainRoll = L.fbm({ seed: 401, scaleM: 110, octaves: 2 });
  const classicsBase = (x, y) => {
    const d = L.signedDistance(x, y, plain);
    return d <= 0 ? 0 : (11 + 1.2 * plainRoll(x, y)) * L.smoothstep(0, 9, d);
  };
  const LEGACY = [];
  {
    const missing = CLASSICS_HOLES.filter((id) => !PIECES[id]);
    if (!CLASSICS_HOLES.some((id) => files.includes(`${id}.js`))) { /* not in this directory */ }
    else if (missing.length) fail('arcade-classics', null, new Error(`arcade-classics: its hole(s) ${missing.join(', ')} did not load`));
    else {
      LEGACY.push({
        id: 'arcade-classics', number: CLASSICS_NUMBER, name: 'Arcade Classics',
        origin: { lat: 30.0, lon: -140.0 },
        cellM: 3,
        base: classicsBase,
        sea: true,
        pieces: [
          { piece: PIECES['lagoon-island'], dx: 140, dy: 520 },
          { piece: PIECES['canyon-run'], dx: 300, dy: 0, dz: 30 },   // the canyon country stands above the plain
          { piece: PIECES['lighthouse-point'], dx: 0, dy: 0 },
        ],
      });
    }
  }

  // Every course that can be built: the match stages in tour order, the tiebreak arenas in
  // theirs, then Arcade Classics.
  const COURSES = Object.freeze([...STAGES, ...LEGACY]);

  // -> { id, course, expect }. Throws for an unknown course and for one whose hole file
  // failed to load (with that file's own error).
  function buildCourse(id) {
    const spec = COURSES.find((c) => c.id === id);
    if (!spec) {
      const broken = FAILED.find((f) => f.id === id);
      if (broken) throw broken.error;
      throw new Error(`No arcade course '${id}' (have: ${COURSES.map((c) => c.id).join(', ')})`);
    }
    const { file, ...rest } = spec;
    return { id: spec.id, ...L.assembleCourse(rest) };
  }

  // Build and validate everything, each course on its own.
  // -> { built: [{ id, spec, course, expect, report }], failed: [{ id, name, file, error }] }
  function buildCatalogue({ only = null } = {}) {
    const built = [], failed = FAILED.filter((f) => !only || f.id === only).map((f) => ({ ...f }));
    for (const spec of COURSES) {
      if (only && spec.id !== only) continue;
      try {
        const { course, expect } = buildCourse(spec.id);
        const report = L.validateCourse(course, { expect });
        built.push({ id: spec.id, spec, course, expect, report });
      } catch (error) {
        failed.push({ id: spec.id, name: spec.name, file: spec.file || null, error });
      }
    }
    return { built, failed };
  }

  // Every course, built (not validated). Throws on the first that cannot be built.
  const buildAll = () => COURSES.map((c) => buildCourse(c.id));

  return { holesDir, COURSES, STAGES, FAILED: Object.freeze(FAILED), PIECES, buildCourse, buildCatalogue, buildAll };
}

// ---- the tour manifest: what the match engine and the lobby read to know which stages
// exist. `built`: [{ id, course }] of the courses to list (only stage courses are listed).
function tourManifest(built) {
  const entry = ({ course }, withDifficulty) => {
    const [hole] = course.holes;
    const a = course.arcade;
    return {
      id: a.id, order: a.order, number: course.source.osmId - L.ARCADE_OSM_ID_BASE,
      file: `${courseCacheStem(course.source)}.json`,
      name: course.name, par: hole.par, lengthYd: hole.lengthYd,
      theme: a.theme, timeOfDay: a.timeOfDay, blurb: a.blurb,
      ...(withDifficulty ? { difficulty: a.difficulty } : {}),
      // a rocket hole: the ball every tee shot is played with, free (contract section 5)
      ...(a.freeBall ? { freeBall: a.freeBall } : {}),
      // the hole's own wind range in mph, when it has one (else consumers use `conditions`)
      ...(a.wind ? { wind: { min: a.wind.min, max: a.wind.max } } : {}),
    };
  };
  const of = (role) => built
    .filter((b) => b.course.arcade && b.course.arcade.formatVersion >= 2 && b.course.arcade.role === role)
    .sort((p, q) => p.course.arcade.order - q.course.arcade.order);
  return {
    version: TOUR_VERSION,
    stages: of('match').map((b) => entry(b, true)),
    tiebreaks: of('tiebreak').map((b) => entry(b, false)),
  };
}

// Publish the manifest to <dataDir>/arcade-tour.json (atomically, like a course file).
function writeTourManifest(manifest, dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, TOUR_FILE);
  courseLib.atomicWriteOwned(file, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  return file;
}

module.exports = {
  // COURSES, STAGES, FAILED, PIECES, buildCourse, buildCatalogue, buildAll: the catalogue
  ...loadCatalogue(process.env.ARCADE_HOLES_DIR ? path.resolve(process.env.ARCADE_HOLES_DIR) : HOLES_DIR),
  HOLES_DIR, TOUR_FILE, TOUR_VERSION, CLASSICS_NUMBER,
  loadCatalogue, courseFile, tourManifest, writeTourManifest,
};
