#!/usr/bin/env node
'use strict';
// Make rates of the arcade putting assist (lib/putt-assist.js), measured: putts by three
// kinds of player from 6, 15, 30 and 45 ft, on a level green and across a 2 % slope, at
// each level ('off': the real stroke at the real cup).
//
//   node tools/arcade-dev/putt-rates.cjs            the tables docs/arcade.md carries
//
// A stroke is the right putt (lib/putt-assist.js solvePutt: the read and the pace) with
// the player's own errors on it: a start line off by N(0, lineDeg) degrees and a pace
// off by a factor exp(N(0, pace)). Seeded, so the tables repeat to the last digit.
//   steady   1.5 degrees, 10 % of pace: a good putter on a good day
//   average  3 degrees, 22 %: most people on a launch monitor
//   wild     6 degrees, 40 %: a ball rolled off the mat in a hurry
const { simulateShot } = require('../../lib/physics');
const { solvePutt, assistPutt } = require('../../lib/putt-assist');

const FT = 0.3048;
const PLAYERS = Object.freeze({
  steady: Object.freeze({ lineDeg: 1.5, pace: 0.10 }),
  average: Object.freeze({ lineDeg: 3, pace: 0.22 }),
  wild: Object.freeze({ lineDeg: 6, pace: 0.40 }),
});
const LEVELS = Object.freeze(['off', 'assist', 'easy']);
const DISTANCES_FT = Object.freeze([6, 15, 30, 45]);
const TAP_IN_FT = 8;           // lib/arcade.js ASSIST_DEFAULTS.tapInFt: inside it the next one is conceded

const green = () => 'green';
const FLAT = { flat: true, h: () => 0, grad: () => ({ dx: 0, dy: 0 }) };
const tilt = (s) => ({ h: (x) => -s * x, grad: () => ({ dx: -s, dy: 0 }) });   // down to the east: a putt north breaks right

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rnd) => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

// One stroke: lineErrDeg off the right start line, paceRatio times the right pace, from
// distFt, at a level. -> { holed, leftFt }
function onePutt({ distFt, lineErrDeg, paceRatio, level, terrain = FLAT }) {
  const from = { x: 0, y: 0 }, pin = { x: 0, y: distFt * FT };
  const ctx = { from, pin, surfaceAt: green, terrain };
  const ideal = solvePutt(ctx);
  // the player aims along the read (the HUD shows it): the stroke is measured from there
  const aimDeg = ideal.bearingDeg;
  const stroke = { speedMph: ideal.speedMph * paceRatio, vla: 0.5, hla: lineErrDeg, totalSpin: 0, spinAxis: 0 };
  const a = level === 'off' ? null : assistPutt(stroke, { ...ctx, aimDeg }, level);
  const sim = simulateShot(a ? a.launch : stroke, from, aimDeg, green, { terrain, pin, putt: true, ...(a ? a.physics : {}) });
  return { holed: sim.holed, leftFt: sim.holed ? 0 : Math.hypot(sim.end.x - pin.x, sim.end.y - pin.y) / FT, made: a ? a.quality.made : null };
}

// n strokes of one kind of player from one distance at one level.
// -> { made: % holed, tapIn: % left inside the tap-in (two putts), three: % left outside it, leftFt: mean leave of the misses }
function rate({ player, distFt, level, n = 400, terrain = FLAT, seed = 20261123 }) {
  const p = PLAYERS[player];
  const rnd = mulberry32(seed + Math.round(distFt * 7) + Object.keys(PLAYERS).indexOf(player) * 1000);
  let holed = 0, tap = 0, left = 0;
  for (let i = 0; i < n; i++) {
    const r = onePutt({ distFt, lineErrDeg: gauss(rnd) * p.lineDeg, paceRatio: Math.exp(gauss(rnd) * p.pace), level, terrain });
    if (r.holed) holed++;
    else { left += r.leftFt; if (r.leftFt <= TAP_IN_FT) tap++; }
  }
  const pct = (k) => Math.round(1000 * k / n) / 10;
  return { made: pct(holed), tapIn: pct(tap), three: pct(n - holed - tap), leftFt: n > holed ? Math.round(10 * left / (n - holed)) / 10 : 0 };
}

function rateTable({ n = 400, terrain = FLAT } = {}) {
  const rows = [];
  for (const player of Object.keys(PLAYERS)) for (const level of LEVELS) {
    rows.push({ player, level, cells: DISTANCES_FT.map((distFt) => rate({ player, distFt, level, n, terrain })) });
  }
  return rows;
}

function print(rows, title) {
  console.log(`\n${title}`);
  console.log(`${'player'.padEnd(8)} ${'level'.padEnd(7)} | ${DISTANCES_FT.map((d) => `${String(d).padStart(2)} ft: made / 3-putt`.padEnd(22)).join('| ')}`);
  for (const r of rows) {
    console.log(`${r.player.padEnd(8)} ${r.level.padEnd(7)} | ${r.cells.map((c) => `${String(c.made).padStart(5)} % / ${String(c.three).padStart(4)} %`.padEnd(22)).join('| ')}`);
  }
}

if (require.main === module) {
  print(rateTable(), 'Level green: % holed / % left outside the 8 ft tap-in (400 putts a cell)');
  print(rateTable({ terrain: tilt(0.02) }), 'Across a 2 % slope');
  console.log('\nOne stroke at a time, 30 ft, level green (holed, or feet left):');
  const lines = [0, 2, 3, 4, 5, 8, 14], paces = [0.5, 0.7, 0.8, 0.9, 1, 1.3, 1.5, 1.7, 2, 3];
  for (const level of LEVELS) {
    console.log(`  ${level}: rows = start line off by (deg), columns = pace x ${paces.join(', ')}`);
    for (const l of lines) {
      console.log(`    ${String(l).padStart(2)}  ${paces.map((p) => { const r = onePutt({ distFt: 30, lineErrDeg: l, paceRatio: p, level }); return (r.holed ? 'IN' : r.leftFt.toFixed(1)).padStart(5); }).join(' ')}`);
    }
  }
}

module.exports = { PLAYERS, LEVELS, DISTANCES_FT, TAP_IN_FT, onePutt, rate, rateTable, tilt, FLAT };
