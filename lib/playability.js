'use strict';
// Playability (v2:playability): the arcade layer's guard against dead shots. The stages
// are vertical (cliffs, 100 m of relief, woods) and the players hit REAL balls off a mat:
// they cannot punch out, chip sideways or pick the perfect club. This module is the pure
// part, shared by lib/game.js, the audit (tools/arcade-dev/playability-audit.mjs) and the
// hole guard (test/arcade-playability.test.js):
//
//   PLAY_ASSIST        what Game.playAssist holds while the arcade layer is on: the
//                      simulateShot options (launch clearance, soft trees), the aim range
//                      and the rescue drop. null on a Game: the plain simulator.
//   lieReport(ctx, spot, { assist })
//                      play the realistic swings from a spot, toward the pin and round it:
//                      { dead, hard, works, eligible, best }.
//   dropOnLineSpot(ctx, hole, ball, { assist })
//                      where a DROP ON THE LINE puts the ball: back on the hole's routing
//                      line, on mown ground, no nearer the hole, with a clear lie.
//
// A lie is DEAD when no swing a player would make from there advances the ball 15 yd
// toward the hole (and 10 yd in all) without a penalty; HARD when only one club family
// does. A dead lie is STUCK when no swing even moves the ball that far (the ground or a
// tree stops every one: the kind that feels like a bug), and a forced CARRY when swings
// do fly but every one ends in the water or out of bounds (an island green from the
// wrong side: the hole's design). Still air, standard ground: a lie is dead or not
// whatever the day's wind.

const { simulateShot, YD } = require('./physics');

// Game.playAssist while the arcade layer is on (frozen: one object for every game).
//   physics.launchClearM / launchClearRiseM   lib/physics.js: ground that rises into a
//       climbing ball within this many metres of where it was struck passes under it, up
//       to this much rise in all (a lip, a bump, a brow: not a cliff)
//   physics.softTrees / treeFreeM             lib/tree-obstacles.js: leaves only brush a
//       ball; trunks (slim) still stop it; nothing within treeFreeM of the strike does
//   aimLimitDeg                               Game.setAimOffset's range either side of the flag
//   drop                                      the DROP ON THE LINE rescue is offered
const PLAY_ASSIST = Object.freeze({
  physics: Object.freeze({ launchClearM: 35, launchClearRiseM: 6, softTrees: true, treeFreeM: 15 }),
  aimLimitDeg: 90,
  drop: true,
});
const PLAIN_AIM_LIMIT_DEG = 45;

// The swings: a good one of each club family and a duffed one (80 % of the ball speed,
// launched 5 degrees lower). The four full clubs are the audit's; the pitch and the chip
// are what a player hits from close in.
const FAMILIES = Object.freeze([
  Object.freeze({ id: 'driver', speedMph: 150, vla: 12, totalSpin: 2500 }),
  Object.freeze({ id: 'iron5', speedMph: 130, vla: 16, totalSpin: 5000 }),
  Object.freeze({ id: 'iron7', speedMph: 115, vla: 19, totalSpin: 6500 }),
  Object.freeze({ id: 'wedge', speedMph: 90, vla: 28, totalSpin: 9000 }),
  Object.freeze({ id: 'pitch', speedMph: 60, vla: 30, totalSpin: 7000 }),
  Object.freeze({ id: 'chip', speedMph: 35, vla: 24, totalSpin: 4000 }),
]);
const DUFF_SPEED = 0.8;
const DUFF_VLA_DEG = 5;
const DEAD_ADVANCE_YD = 15;   // the best swing must gain this much on the hole ...
const DEAD_TOTAL_YD = 10;     // ... and travel this far
const FLAG_KILL_SHARE = 0.3;  // a swing at the flag is "stopped dead" under this share of its club's level carry
const AIMS_PLAIN = Object.freeze([0, -20, 20, -40, 40]);              // inside the plain 45 degree clamp
const AIMS_ASSIST = Object.freeze([0, -20, 20, -40, 40, -60, 60, -80, 80]);   // inside the arcade's 90

const launchOf = (f, duffed = false) => ({
  speedMph: duffed ? f.speedMph * DUFF_SPEED : f.speedMph,
  vla: duffed ? Math.max(0, f.vla - DUFF_VLA_DEG) : f.vla,
  hla: 0, totalSpin: f.totalSpin, spinAxis: 0,
});

// A family's carry on a flat fairway (yd), simulated once.
const flatCarry = new Map();
function flatCarryYd(f) {
  let yd = flatCarry.get(f.id);
  if (yd === undefined) {
    yd = simulateShot(launchOf(f), { x: 0, y: 0 }, 0, () => 'fairway', { carryOnly: true }).carryYd;
    flatCarry.set(f.id, yd);
  }
  return yd;
}

// The families a player would hit from distYd out: none that flies the hole by more than
// 30 yd, none that covers under a quarter of the way (that is a punch-out, and nobody
// punches out off a mat). Always at least the shortest one.
function familiesFor(distYd) {
  const list = FAMILIES.filter((f) => { const c = flatCarryYd(f); return c <= distYd + 30 && c >= 0.25 * distYd; });
  return list.length ? list : [FAMILIES[FAMILIES.length - 1]];
}

// One swing from a spot: { advanceYd, totalYd, carryYd, penalty, tree, sim }.
function trySwing(ctx, spot, launch, aimOffsetDeg, physics) {
  const pin = ctx.pin;
  const base = Math.atan2(pin.x - spot.x, pin.y - spot.y) * 180 / Math.PI;
  const sim = simulateShot(launch, spot, base + aimOffsetDeg, ctx.surfaceAt, {
    terrain: ctx.terrain, pin, trees: ctx.trees || null, ...(physics || {}),
    ...(ctx.gadgets ? { gadgets: ctx.gadgets } : {}),   // v3:gadgets a lie is judged with the course's gadgets in play
  });
  const penalty = sim.endSurface === 'water' || sim.endSurface === 'ob' || sim.events.some((e) => e.type === 'water');
  const before = Math.hypot(pin.x - spot.x, pin.y - spot.y);
  const after = Math.hypot(pin.x - sim.end.x, pin.y - sim.end.y);
  return {
    advanceYd: (before - after) / YD, totalYd: sim.totalYd, carryYd: sim.carryYd, penalty,
    tree: sim.events.some((e) => e.type === 'tree'), holed: sim.holed, sim,
  };
}

/**
 * How playable a resting spot is.
 * @param {object} ctx   { surfaceAt, terrain, trees, pin: {x, y}, gadgets (v3:gadgets: the course's gadget field, or none) }
 * @param {object} spot  { x, y }
 * @param {object} o     { assist: PLAY_ASSIST | null (plain physics, 45 degree aim),
 *                         stopAt: 2 (stop once this many families work: 1 answers "dead?" only) }
 * @returns {{ dead, stuck, hard, works: string[], eligible: string[], best, swings, flag }}
 *   stuck: dead, and no swing even travelled (penalty or not)
 *   best: the swing that gained most { family, duffed, aim, advanceYd, totalYd }
 *   swings: how many were simulated
 *   flag: the good swings played straight at the flag { n, killed: stopped dead by the
 *         ground or a tree (no penalty, and under 30 % of the club's carry on level
 *         ground travelled), tree: of those, the ones that met a tree }
 */
function lieReport(ctx, spot, { assist = null, stopAt = 2 } = {}) {
  const pin = ctx.pin;
  const distYd = Math.hypot(pin.x - spot.x, pin.y - spot.y) / YD;
  const physics = assist ? assist.physics : null;
  const aims = assist && assist.aimLimitDeg >= 80 ? AIMS_ASSIST : AIMS_PLAIN;
  const needAdvance = Math.min(DEAD_ADVANCE_YD, 0.5 * distYd);
  const needTotal = Math.min(DEAD_TOTAL_YD, 0.4 * distYd);
  const eligible = familiesFor(distYd);
  const works = [];
  const flag = { n: 0, killed: 0, tree: 0 };
  let best = null, swings = 0, moved = false;
  for (const f of eligible) {
    let ok = false;
    search:
    for (const duffed of [false, true]) {
      for (const aim of aims) {
        const r = trySwing(ctx, spot, launchOf(f, duffed), aim, physics);
        swings++;
        const travels = r.holed || (r.advanceYd >= needAdvance && r.totalYd >= needTotal);
        const good = travels && (r.holed || !r.penalty);
        if (travels || r.totalYd >= 3 * DEAD_TOTAL_YD) moved = true;   // it flew: the ground did not stop it
        if (!duffed && aim === 0) {
          flag.n++;
          if (!r.penalty && !r.holed && r.totalYd < FLAG_KILL_SHARE * flatCarryYd(f)) { flag.killed++; if (r.tree) flag.tree++; }
        }
        if (!r.penalty && (!best || r.advanceYd > best.advanceYd)) best = { family: f.id, duffed, aim, advanceYd: r.advanceYd, totalYd: r.totalYd };
        if (good) { ok = true; break search; }
      }
    }
    if (ok) works.push(f.id);
    if (works.length >= stopAt) break;
  }
  return {
    dead: works.length === 0,
    stuck: works.length === 0 && !moved,
    flag,
    hard: works.length === 1 && eligible.length > 1,
    works, eligible: eligible.map((f) => f.id), best, swings, distYd,
  };
}

const isDeadLie = (ctx, spot, assist = null) => lieReport(ctx, spot, { assist, stopAt: 1 }).dead;

// ---------- the rescue drop ----------
const DROP_STEP_M = 1;           // the routing line is walked a metre at a time
const DROP_TURF = new Set(['fairway', 'tee']);
const DROP_LIE_CHECKS = 12;      // how many candidate spots are tested for a clear lie

/**
 * Where DROP ON THE LINE puts a ball: the nearest point of the hole's routing line
 * (hole.line: tee, turns, pin) that is no nearer the hole than the ball is, on fairway or
 * tee turf (never water, sand, green or out of bounds), with a clear lie (not a dead
 * one). Candidates are taken nearest first; when none is clear, the tee.
 * @returns {{ x, y, lie, tee: boolean }}
 */
function dropOnLineSpot(ctx, hole, ball, { assist = null } = {}) {
  const pin = { x: hole.pin[0], y: hole.pin[1] };
  const tee = { x: hole.tee[0], y: hole.tee[1], lie: 'tee', tee: true };
  const line = Array.isArray(hole.line) && hole.line.length >= 2 ? hole.line : [hole.tee, hole.pin];
  const ballToPin = Math.hypot(pin.x - ball.x, pin.y - ball.y);
  const spots = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i], [bx, by] = line[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / DROP_STEP_M));
    for (let k = 0; k < n; k++) {
      const x = ax + (bx - ax) * k / n, y = ay + (by - ay) * k / n;
      if (Math.hypot(pin.x - x, pin.y - y) < ballToPin) continue;            // nearer the hole: never
      const lie = ctx.surfaceAt(x, y);
      if (!DROP_TURF.has(lie)) continue;
      spots.push({ x, y, lie, tee: false, d: Math.hypot(x - ball.x, y - ball.y) });
    }
  }
  spots.sort((a, b) => a.d - b.d);
  // a clear lie: nearest first, but not every metre of a bad stretch (5 m apart at least)
  let checks = 0, last = null;
  for (const s of spots) {
    if (last && Math.hypot(s.x - last.x, s.y - last.y) < 5) continue;
    if (checks++ >= DROP_LIE_CHECKS) break;
    last = s;
    if (!isDeadLie({ ...ctx, pin }, s, assist)) return { x: s.x, y: s.y, lie: s.lie, tee: false };
  }
  return tee;
}

module.exports = {
  PLAY_ASSIST, PLAIN_AIM_LIMIT_DEG, FAMILIES, DUFF_SPEED, DUFF_VLA_DEG, DEAD_ADVANCE_YD, DEAD_TOTAL_YD,
  launchOf, flatCarryYd, familiesFor, trySwing, lieReport, isDeadLie, dropOnLineSpot,
};
