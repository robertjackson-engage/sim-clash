'use strict';
// Course gadgets for the hand-built stages (v3:gadgets; docs/gadgets.md).
//
// A hole file lists its gadgets in `gadgets: [...]` (lib/gadgets.js has the kinds and the
// numbers each takes). This file is the builder's side:
//   gadget(kind, id, x, y, opts)   one entry, as a hole file writes it
//   flight(height, from, toward, launch)
//                                  a real swing flown over the hole's own ground: where a
//                                  ring or a coin trail belongs (at(), ring(), coins())
//   placeGadgets / buildGadgets    a piece's list moved into the course and tidied (alt -> z)
//   validateGadgets(course, ctx)   in bounds, on ground it may stand on, clear of the tee,
//                                  the green and the routing line, pairs resolve, a warp
//                                  fires onto dry land, three to eight on a match stage and
//                                  nothing but coin trails in a sudden-death arena
// lib.js calls the last three from placePiece, assembleCourse and validateCourse.

const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const G = require(path.join(REPO, 'lib', 'gadgets.js'));
const { simulateShot } = require(path.join(REPO, 'lib', 'physics.js'));
const { makeTerrain } = require(path.join(REPO, 'lib', 'elevation.js'));

const RAD = Math.PI / 180;
const round2 = (v) => Math.round(v * 100) / 100 + 0;

// What a match stage should carry (a warp and its exit count as one).
const STAGE_MIN = 3, STAGE_MAX = 8;
const TEE_CLEAR_M = 18;        // nothing solid this close to a tee
const LINE_CLEAR_M = 6;        // nothing solid this close to the routing line (the SAFE way home)
const GREEN_CLEAR_M = 1.5;     // a solid stands this far off the putting surface
const FLOAT_M = 3;             // a solid whose foot is this far above the ground hangs in the air

/** One gadget, as a hole file lists it: gadget('ring', 'tee-ring', 0, 120, { z: 30, heading: 0 }). */
function gadget(kind, id, x, y, opts = {}) {
  return { id, kind, x: round2(x), y: round2(y), ...opts };
}

// the heading (compass degrees) from one point to another
const bearing = (a, b) => round2(((Math.atan2(b[0] - a[0], b[1] - a[1]) / RAD) % 360 + 360) % 360);

/**
 * A swing flown over a hole's own ground, to hang rings and coins on.
 * @param {function} height  the hole file's height(x, y)
 * @param {number[]} from    [x, y] where it is struck (the tee)
 * @param {number[]} toward  [x, y] what it is aimed at
 * @param {object} launch    { speedMph, vla, spin, ball } (ball: 'rocket' flies it as the
 *                           arcade's Rocket: speed x1.5, drag 0.7, lift 1.2)
 * @returns {{ points, carryM, apex, heading, at(distM), ring(id, distM, opts), coins(id, fromM, toM, n, opts) }}
 *   at(distM): the point of the flight distM from the strike over the ground { x, y, z, t },
 *   or null past its landing.
 */
function flight(height, from, toward, { speedMph = 150, vla = 12, spin = 2600, ball = null } = {}) {
  const e = 0.5;
  const terrain = { h: height, grad: (x, y) => ({ dx: (height(x + e, y) - height(x - e, y)) / (2 * e), dy: (height(x, y + e) - height(x, y - e)) / (2 * e) }) };
  const heading = bearing(from, toward);
  const rocket = ball === 'rocket';
  const sim = simulateShot({ speedMph: rocket ? speedMph * 1.5 : speedMph, vla, hla: 0, totalSpin: spin, spinAxis: 0 }, { x: from[0], y: from[1] }, heading, () => 'rough',
    { terrain, carryOnly: true, ...(rocket ? { dragScale: 0.7, liftScale: 1.2 } : {}) });
  const pts = sim.points.map((p) => ({ ...p, d: Math.hypot(p.x - from[0], p.y - from[1]) }));
  const carryM = pts[pts.length - 1].d;
  const apex = pts.reduce((a, p) => (p.z > a.z ? p : a), pts[0]);
  const at = (distM) => {
    if (!(distM >= 0) || distM > carryM) return null;
    let i = 1;
    while (i < pts.length - 1 && pts[i].d < distM) i++;
    const a = pts[i - 1], b = pts[i], k = b.d > a.d ? (distM - a.d) / (b.d - a.d) : 0;
    return { x: round2(a.x + (b.x - a.x) * k), y: round2(a.y + (b.y - a.y) * k), z: round2(a.z + (b.z - a.z) * k), t: a.t + (b.t - a.t) * k };
  };
  const need = (distM) => { const p = at(distM); if (!p) throw new Error(`flight: ${distM} m is past its landing (${carryM.toFixed(0)} m)`); return p; };
  return {
    points: pts, carryM, apex, heading, at,
    /** A boost ring across this flight, distM from the strike. */
    ring(id, distM, opts = {}) { const p = need(distM); return gadget('ring', id, p.x, p.y, { z: p.z, heading, ...opts }); },
    /** n coins along this flight, from fromM to toM from the strike. */
    coins(id, fromM, toM, n, opts = {}) {
      const points = [];
      for (let k = 0; k < n; k++) { const p = need(fromM + ((toM - fromM) * k) / Math.max(1, n - 1)); points.push([p.x, p.y, p.z]); }
      return { id, kind: 'coins', points, ...opts };
    },
  };
}

/** A piece's gadgets moved into the course: (dx, dy) on the ground, dz up. */
function placeGadgets(list, dx, dy, dz) {
  if (list == null) return [];
  if (!Array.isArray(list)) return list;   // buildGadgets names the problem
  return list.map((g) => {
    if (!g || typeof g !== 'object') return g;
    const out = { ...g };
    if (Number.isFinite(g.x)) out.x = round2(g.x + dx);
    if (Number.isFinite(g.y)) out.y = round2(g.y + dy);
    if (Number.isFinite(g.z)) out.z = round2(g.z + dz);
    if (Array.isArray(g.points)) out.points = g.points.map((p) => (Array.isArray(p) ? [round2(p[0] + dx), round2(p[1] + dy), ...(p.length > 2 ? [round2(p[2] + dz)] : [])] : p));
    return out;
  });
}

/**
 * The list as the course carries it: checked, defaults filled in, alt turned into z on the
 * course's own height grid. Throws an Error naming everything that is wrong with it.
 */
function buildGadgets(list, elevation, id = 'course') {
  const { gadgets, problems } = G.normalizeGadgets(list);
  if (problems.length) throw new Error(`${id}: gadgets: ${problems.join('; ')}`);
  return G.resolveGadgets(gadgets, makeTerrain(elevation, [], { smooth: true }));
}

const distToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
};
const distToLine = (x, y, line) => {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, distToSegment(x, y, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]));
  return best;
};
// points along an outline, a metre or two apart (a wall is checked along its whole width)
function samples(g) {
  const o = G.outline(g, 16);
  const out = [[g.x, g.y]];
  const pts = o.closed ? [...o.points, o.points[0]] : o.points;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2));
    for (let k = 0; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

/**
 * Check a course's gadgets against the course. Pushes onto `bad` and `warnings`.
 * ctx: { surfaceAt, terrain, inGrid(x, y), bad(message), warnings: [] }
 */
function validateGadgets(course, { surfaceAt, terrain, inGrid, bad, warnings }) {
  if (course.gadgets === undefined) return;
  const { gadgets, problems } = G.normalizeGadgets(course.gadgets);
  for (const p of problems) bad(p);
  if (!Array.isArray(course.gadgets)) return;
  const a = course.arcade || {};
  const stage = a.formatVersion >= 2;
  const playing = gadgets.filter((g) => !G.KINDS[g.kind].cosmetic);
  if (stage && a.role === 'tiebreak' && playing.length) {
    bad(`a sudden-death arena carries no gadget that touches the ball (closest to the pin stays pure): ${playing.map((g) => g.id).join(', ')}`);
  }
  if (stage && a.role === 'match') {
    const n = gadgets.filter((g) => g.kind !== 'warp-exit').length;
    if (n && (n < STAGE_MIN || n > STAGE_MAX)) bad(`a match stage has ${STAGE_MIN} to ${STAGE_MAX} gadgets (a warp and its exit are one): this one has ${n}`);
  }
  const byId = new Map(gadgets.map((g) => [g.id, g]));
  for (const g of gadgets) {
    const K = G.KINDS[g.kind];
    const label = `gadget ${g.id} (${g.kind})`;
    const pts = samples(g);
    if (!pts.every(([x, y]) => inGrid(x, y))) { bad(`${label} reaches outside the elevation grid`); continue; }
    const under = new Set(pts.map(([x, y]) => surfaceAt(x, y)));
    if (under.has('ob')) bad(`${label} reaches out of bounds`);
    const ok = new Set(['rough', 'fairway', ...K.on]);
    const wrong = [...under].filter((s) => s !== 'ob' && !ok.has(s));
    // what flies is judged where it is (a ring over the lava is over the lava); what stands
    // or lies on the ground, by the ground under every part of it
    const hangs = Number.isFinite(g.z) && g.z >= terrain.h(g.x, g.y) + 3;
    if (K.ground || ((g.kind === 'breakable' || g.kind === 'warp' || g.kind === 'warp-exit') && !hangs)) {
      if (wrong.length) bad(`${label} stands on ${wrong.join(' and ')} (it may stand on ${[...ok].join(', ')})`);
    }
    if (!K.ground && Number.isFinite(g.z)) {
      const floor = terrain.h(g.x, g.y);
      if (g.kind === 'ring' && g.z - g.radius < floor - 0.5) bad(`${label} is cut by the ground: its foot is ${(floor - (g.z - g.radius)).toFixed(1)} m under it`);
      if (g.kind !== 'ring' && g.z < floor - 0.5) bad(`${label} is ${(floor - g.z).toFixed(1)} m under the ground`);
    }
    if (g.kind === 'coins') {
      for (const [i, p] of g.points.entries()) if (p[2] < terrain.h(p[0], p[1]) - 0.5) bad(`${label}: coin ${i + 1} is under the ground`);
    }
    if (K.solid || g.kind === 'mud') {
      // what hangs in the air (its foot 3 m or more above the ground) stands on nothing: a
      // small round one (a lantern, a pinata) blocks no route; a floating wall still may
      const floats = Number.isFinite(g.z) && g.z >= terrain.h(g.x, g.y) + FLOAT_M;
      const lineRule = K.solid && !(floats && !g.size);
      for (const h of course.holes) {
        const tee = Math.min(...pts.map(([x, y]) => Math.hypot(x - h.tee[0], y - h.tee[1])));
        if (tee < TEE_CLEAR_M) bad(`${label} stands ${tee.toFixed(0)} m from hole ${h.ref}'s tee (at least ${TEE_CLEAR_M})`);
        const line = Math.min(...pts.map(([x, y]) => distToLine(x, y, h.line))) - (g.kind === 'bumper' || (g.kind === 'breakable' && !g.size) ? g.radius : 0);
        if (lineRule && line < LINE_CLEAR_M) bad(`${label} blocks hole ${h.ref}'s routing line, the safe way home (${line.toFixed(1)} m from it; at least ${LINE_CLEAR_M})`);
      }
      // off the putting surface, with room to spare
      const r = GREEN_CLEAR_M + (g.radius && !g.size && !g.points ? g.radius : 0.5);
      for (const [x, y] of floats ? [] : pts) {
        let near = false;
        for (let k = 0; k < 8 && !near; k++) near = surfaceAt(x + r * Math.cos((k * Math.PI) / 4), y + r * Math.sin((k * Math.PI) / 4)) === 'green';
        if (near) { bad(`${label} stands on or against a green`); break; }
      }
    }
    if (g.kind === 'warp') {
      // where its exit fires the ball: onto dry land, in bounds
      const e = byId.get(g.pair);
      const sim = simulateShot({ speedMph: e.speedMph, vla: e.angle, hla: 0, totalSpin: 3000, spinAxis: 0 }, { x: e.x, y: e.y }, e.heading, surfaceAt, { terrain });
      const wet = sim.endSurface === 'water' || sim.events.some((ev) => ev.type === 'water');
      if (wet || sim.endSurface === 'ob') bad(`${label} fires the ball ${wet ? 'into the water' : 'out of bounds'} (${sim.carryYd.toFixed(0)} yd from its exit)`);
    }
    if (g.kind === 'zone' || g.kind === 'pad' || g.kind === 'strip') {
      if (pts.some(([x, y]) => surfaceAt(x, y) === 'water')) bad(`${label} lies in the water`);
    }
  }
  if (stage && a.role === 'match' && !gadgets.length) warnings.push('this match stage has no gadgets');
}

module.exports = { STAGE_MIN, STAGE_MAX, TEE_CLEAR_M, LINE_CLEAR_M, gadget, bearing, flight, placeGadgets, buildGadgets, validateGadgets };
