'use strict';
// The playability audit's core (v2:playability): sample the resting spots of a stage and
// play the realistic swings from each (lib/playability.js lieReport). Used by the CLI
// (tools/arcade-dev/playability-audit.mjs) and the hole guard (test/arcade-playability.test.js).
const path = require('path');
const { Game } = require('../../lib/game');
const { PLAY_ASSIST, FAMILIES, launchOf, trySwing, lieReport } = require('../../lib/playability');
const { COURSES, buildCourse } = require('../arcade-holes/courses.js');

const NEAR_M = 15;            // "near" a cliff or a wood
const CLIFF_SLOPE = 0.8;      // rise over run: ground this steep is a cliff face
const BASE_CLUBS = FAMILIES.slice(0, 4);   // driver, 5-iron, 7-iron, wedge: the brief's four
// tuning only: BIRDIE_TEST_CLEAR_RISE / BIRDIE_TEST_CLEAR_M try another launch clearance
const tune = { rise: Number(process.env.BIRDIE_TEST_CLEAR_RISE), dist: Number(process.env.BIRDIE_TEST_CLEAR_M) };
const ASSIST = tune.rise > 0 || tune.dist > 0
  ? { ...PLAY_ASSIST, physics: { ...PLAY_ASSIST.physics, ...(tune.rise > 0 ? { launchClearRiseM: tune.rise } : {}), ...(tune.dist > 0 ? { launchClearM: tune.dist } : {}) } }
  : PLAY_ASSIST;

// Every arcade stage with a hole of its own: the tour's stages and the tiebreak arenas.
function stageIds() {
  return COURSES.filter((c) => c.id !== 'arcade-classics').map((c) => c.id);
}

// A stage in a Game. assist: PLAY_ASSIST (the arcade layer on) or null (the plain simulator).
function stageGame(id, assist = null) {
  const { course } = buildCourse(id);
  const g = new Game();
  const warn = console.warn;
  console.warn = () => {};    // the course loader's notes are not the audit's
  try { g.setCourse(course); } finally { console.warn = warn; }
  g.playAssist = assist;
  return g;
}

const ctxOf = (g) => {
  const h = g.hole;
  return { surfaceAt: g.surfaceAt, terrain: g.terrain, trees: g.treeObstacles, gadgets: g.gadgets || null /* v3:gadgets */, pin: { x: h.pin[0], y: h.pin[1] } };
};

// The spots: a `step` grid over everything in bounds that is not water or the green, a
// grid twice as fine within 15 m of a cliff or a tree, and one four times as fine in sand.
function sampleSpots(g, step = 12) {
  const e = g.course.elevation;
  const x0 = e.minX, y0 = e.minY, x1 = e.minX + (e.nx - 1) * e.cellM, y1 = e.minY + (e.ny - 1) * e.cellM;
  const fine = step / 2, sand = step / 4;
  const slope = (x, y) => { const s = g.terrain.grad(x, y); return Math.hypot(s.dx, s.dy); };
  // cliffs: steep cells of a NEAR_M / 3 lattice; woods: the trees
  const cell = NEAR_M;
  const marks = new Map();
  const key = (cx, cy) => `${cx},${cy}`;
  const mark = (x, y, what) => {
    const k = key(Math.floor(x / cell), Math.floor(y / cell));
    let m = marks.get(k);
    if (!m) marks.set(k, m = []);
    m.push([x, y, what]);
  };
  for (let y = y0; y <= y1; y += 5) for (let x = x0; x <= x1; x += 5) if (slope(x, y) >= CLIFF_SLOPE) mark(x, y, 'cliff');
  for (const t of g.course.trees || []) mark(t[0], t[1], 'woods');
  const near = (x, y) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    let cliff = false, woods = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const [mx, my, what] of marks.get(key(cx + dx, cy + dy)) || []) {
        if (Math.hypot(mx - x, my - y) > NEAR_M) continue;
        if (what === 'cliff') cliff = true; else woods = true;
      }
    }
    return { cliff, woods };
  };
  const spots = [];
  const nx = Math.floor((x1 - x0) / fine), ny = Math.floor((y1 - y0) / fine);
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + i * fine, y = y0 + j * fine;
      const lie = g.surfaceAt(x, y);
      if (lie === 'water' || lie === 'ob' || lie === 'green' || lie === 'bunker') continue;
      const n = near(x, y);
      if (!(i % 2 === 0 && j % 2 === 0) && !n.cliff && !n.woods) continue;
      spots.push({ x, y, lie, cliff: n.cliff, woods: n.woods });
    }
  }
  const sx = Math.floor((x1 - x0) / sand), sy = Math.floor((y1 - y0) / sand);
  for (let j = 0; j <= sy; j++) {
    for (let i = 0; i <= sx; i++) {
      const x = x0 + i * sand, y = y0 + j * sand;
      if (g.surfaceAt(x, y) !== 'bunker') continue;
      const n = near(x, y);
      spots.push({ x, y, lie: 'bunker', cliff: n.cliff, woods: n.woods });
    }
  }
  return spots;
}

// Why a swing at the flag died: 'ground' (it met the ground inside 35 m while it was
// launched to fly), 'tree', 'penalty', or null (it did not die).
function causeOf(r, launch) {
  if (r.penalty) return 'penalty';
  if (r.advanceYd >= 15 && r.totalYd >= 10) return null;
  const first = r.sim.events.find((e) => e.type === 'tree' || e.type === 'bounce');
  if (first && first.type === 'tree') return 'tree';
  if (r.carryYd < 38 && launch.vla >= 4) return 'ground';
  return r.tree ? 'tree' : 'other';
}

/**
 * Audit one stage.
 * @param {string} id      a stage id
 * @param {object} o       { assist: true | false, step: grid pitch in m (12), spots: reuse these }
 * @returns {object}       { id, spots, dead, hard, deadPct, hardPct, bunkerSpots, bunkerSwings,
 *                           bunkerUnder3, bunkerUnder10, bunkerMinYd, causes, deadSpots, byZone }
 */
function auditStage(id, { assist = false, step = 12, spots = null } = {}) {
  const A = assist ? ASSIST : null;
  const g = stageGame(id, A);
  const ctx = ctxOf(g);
  const list = spots || sampleSpots(g, step);
  const out = {
    id, name: g.course.name, assist: Boolean(assist), step, spots: list.length, dead: 0, stuck: 0, hard: 0,
    flagSwings: 0, flagKilled: 0, flagTree: 0,
    bunkerSpots: 0, bunkerSwings: 0, bunkerUnder3: 0, bunkerUnder10: 0, bunkerMinYd: null, bunkerDead: 0,
    causes: { ground: 0, tree: 0, penalty: 0, other: 0 }, deadSpots: [], hardSpots: 0, swings: 0,
    byZone: { open: { n: 0, dead: 0 }, cliff: { n: 0, dead: 0 }, woods: { n: 0, dead: 0 }, bunker: { n: 0, dead: 0 } },
  };
  for (const s of list) {
    const rep = lieReport(ctx, s, { assist: A });
    out.swings += rep.swings;
    const zone = s.lie === 'bunker' ? 'bunker' : s.cliff ? 'cliff' : s.woods ? 'woods' : 'open';
    out.byZone[zone].n++;
    out.flagSwings += rep.flag.n; out.flagKilled += rep.flag.killed; out.flagTree += rep.flag.tree;
    if (rep.dead) {
      out.dead++; out.byZone[zone].dead++;
      if (rep.stuck) out.stuck++;
      out.deadSpots.push({ x: +s.x.toFixed(1), y: +s.y.toFixed(1), lie: s.lie, zone, distYd: Math.round(rep.distYd), stuck: rep.stuck });
    } else if (rep.hard) out.hard++;
    if (s.lie === 'bunker') {
      // sand: the four clubs, a good swing and a duffed one of each, straight at the flag
      out.bunkerSpots++;
      if (rep.dead) out.bunkerDead++;
      for (const f of BASE_CLUBS) for (const duffed of [false, true]) {
        const r = trySwing(ctx, s, launchOf(f, duffed), 0, A ? A.physics : null);
        out.bunkerSwings++;
        if (r.totalYd < 3) out.bunkerUnder3++;
        if (r.totalYd < 10) out.bunkerUnder10++;
        if (out.bunkerMinYd === null || r.totalYd < out.bunkerMinYd) out.bunkerMinYd = +r.totalYd.toFixed(1);
      }
    }
    if (rep.dead || rep.hard) {
      // what killed the swings at the flag (the four clubs, good and duffed)
      for (const f of BASE_CLUBS) for (const duffed of [false, true]) {
        const l = launchOf(f, duffed);
        const c = causeOf(trySwing(ctx, s, l, 0, A ? A.physics : null), l);
        if (c) out.causes[c]++;
      }
    }
  }
  out.deadPct = list.length ? +(100 * out.dead / list.length).toFixed(1) : 0;
  out.hardPct = list.length ? +(100 * out.hard / list.length).toFixed(1) : 0;
  out.stuckPct = list.length ? +(100 * out.stuck / list.length).toFixed(2) : 0;
  out.flagKillPct = out.flagSwings ? +(100 * out.flagKilled / out.flagSwings).toFixed(1) : 0;
  return out;
}

// The table the report prints: one row per stage; before and after when both are given.
//   dead%   spots where no realistic swing gains 15 yd on the hole without a penalty
//   stuck%  ... of them, where no swing even moves (the ground or a tree stops every one)
//   hard%   spots where only one club family works
//   flag%   good swings straight at the flag that the ground or a tree stops dead
//   sand    swings out of sand (four clubs, good and duffed, at the flag) under 3 / under 10 yd
function table(before, after = null) {
  const pad = (v, n) => String(v).padStart(n);
  const cols = (r) => `${pad(r.deadPct, 5)} ${pad(r.stuckPct, 6)} ${pad(r.hardPct, 5)} ${pad(r.flagKillPct, 5)} ${pad(r.bunkerUnder3, 4)} ${pad(r.bunkerUnder10, 4)}`;
  const sum = (list, k) => list.reduce((t, x) => t + x[k], 0);
  const all = (list) => ({
    deadPct: (100 * sum(list, 'dead') / sum(list, 'spots')).toFixed(1), stuckPct: (100 * sum(list, 'stuck') / sum(list, 'spots')).toFixed(2),
    hardPct: (100 * sum(list, 'hard') / sum(list, 'spots')).toFixed(1), flagKillPct: (100 * sum(list, 'flagKilled') / Math.max(1, sum(list, 'flagSwings'))).toFixed(1),
    bunkerUnder3: sum(list, 'bunkerUnder3'), bunkerUnder10: sum(list, 'bunkerUnder10'),
  });
  const h1 = 'dead% stuck% hard% flag%  <3y <10y';
  const head = `${'stage'.padEnd(17)} ${'spots'.padStart(5)} ${'sand'.padStart(5)} | ${h1}${after ? ` | ${h1}  sand min` : ''}`;
  const rows = [after ? `${' '.repeat(29)} | ${'PLAIN SIMULATOR'.padEnd(h1.length)} | ARCADE ASSISTS` : null, head, '-'.repeat(head.length)].filter(Boolean);
  for (const b of before) {
    const a = after ? after.find((x) => x.id === b.id) : null;
    rows.push(`${b.id.padEnd(17)} ${pad(b.spots, 5)} ${pad(b.bunkerSwings, 5)} | ${cols(b)}${a ? ` | ${cols(a)}  ${a.bunkerMinYd === null ? '-' : `${a.bunkerMinYd} yd`}` : ''}`);
  }
  rows.push('-'.repeat(head.length));
  rows.push(`${'ALL'.padEnd(17)} ${pad(sum(before, 'spots'), 5)} ${pad(sum(before, 'bunkerSwings'), 5)} | ${cols(all(before))}${after ? ` | ${cols(all(after))}` : ''}`);
  return rows.join('\n');
}

module.exports = { stageIds, stageGame, ctxOf, sampleSpots, auditStage, table, causeOf, BASE_CLUBS, root: path.join(__dirname, '..', '..') };
