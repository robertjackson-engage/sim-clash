'use strict';
// v3:living A stage's LIFE (docs/living-world.md): what moves through its world by itself.
//
// A hole says it in `life: [...]`, either in the hole file itself or in a file of its own,
// tools/arcade-holes/life/<hole id>.js (so the worlds' casts can be worked on without
// touching the holes). The kinds and what each takes are public/render/world-life.js
// LIFE_KINDS; the game draws them in public/render/world-events.js. Scenery only: nothing
// listed here can touch a ball.
//
// This file is the builder's side, called by lib.js:
//   lifeOf(piece)            the piece's list: its own `life`, else life/<id>.js, else none
//   placeLife(list, dx, dy, dz)   the list moved into the course with its piece
//   validateLife(course, ctx)     every entry checked (a known kind, a usable shape, clear
//                                 of the line of play, inside the stage)
// Coordinates are the hole's own (metres, x east, y north, the tee at the origin).

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const round2 = (v) => Math.round(v * 100) / 100 + 0;
const isPt = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

let rules;
// The kinds and their rules are the renderer's own module (ESM): undefined on a Node that
// cannot require one (the game still runs; test/living-world.test.mjs checks the stages).
function lifeRules() {
  if (rules !== undefined) return rules;
  try { rules = require(path.join(REPO, 'public', 'render', 'world-life.js')); } catch (_) { rules = null; }
  return rules;
}

function lifeOf(piece) {
  if (Array.isArray(piece.life)) return piece.life;
  const file = path.join(__dirname, 'life', `${piece.id}.js`);
  if (!fs.existsSync(file)) return [];
  const list = require(file);
  if (!Array.isArray(list)) throw new Error(`life/${piece.id}.js must export an array`);
  return list;
}

function placeLife(list, dx = 0, dy = 0, dz = 0) {
  const pt = (p) => (isPt(p) ? [round2(p[0] + dx), round2(p[1] + dy), ...(Number.isFinite(p[2]) ? [round2(p[2] + dz)] : [])] : p);
  return (list || []).filter((e) => e && typeof e === 'object').map((e) => ({
    ...e,
    ...(Number.isFinite(e.x) ? { x: round2(e.x + dx) } : {}),
    ...(Number.isFinite(e.y) ? { y: round2(e.y + dy) } : {}),
    ...(Number.isFinite(e.z) ? { z: round2(e.z + dz) } : {}),
    ...(Array.isArray(e.path) ? { path: e.path.map(pt) } : {}),
    ...(Array.isArray(e.at) ? { at: e.at.map(pt) } : {}),
  }));
}

// ctx: { inGrid(x, y), bad(message) } (lib.js validateCourse). A stage of one hole is held
// to the line-of-play rules; a course of several holes (Arcade Classics) carries no life.
function validateLife(course, { inGrid, bad }) {
  if (course.life === undefined) return;
  if (!Array.isArray(course.life)) { bad('life must be an array'); return; }
  const R = lifeRules();
  if (!R) return;
  const hole = (course.holes || []).length === 1 ? course.holes[0] : null;
  for (const problem of R.validateLife(course.life, hole)) bad(problem);
  // (a far mover may leave the playable grid: a boat out at sea, a train behind the city. What
  // must be on it is anything that stands or walks, so its height can be read off the ground)
  for (const [i, e] of course.life.entries()) {
    if (!e || !R.LIFE_KINDS[e.kind]) continue;
    const K = R.LIFE_KINDS[e.kind];
    const grounded = ['walkers', 'groomer', 'caravan', 'windmill', 'windsock', 'pennants', 'perch', 'turtle', 'searchlight', 'geyser', 'dragon'].includes(e.kind);
    if (!grounded || Number.isFinite(e.z)) continue;
    const pts = K.shape === 'path' ? e.path : K.shape === 'points' ? e.at : [[e.x, e.y]];
    for (const p of pts || []) if (isPt(p) && !inGrid(p[0], p[1])) { bad(`life[${i}] (${e.kind}): (${p[0]}, ${p[1]}) is off the stage's ground`); break; }
  }
}

module.exports = { lifeOf, placeLife, validateLife, lifeRules };
