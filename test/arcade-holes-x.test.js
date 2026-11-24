'use strict';
// The EXTREME stages (tools/arcade-holes/holes/{sky-fortress,dragons-spine,summit-express}.js):
// three rocket holes, order 10 to 12, each `freeBall: 'rocket'`. Huge and vertical, and built
// so that the hero target is reached by the stage's free Rocket ball and by nothing else.
// Everything is played through the real Game, with the arcade layer's own Rocket (its launch
// and physics modifiers), on the course exactly as tools/arcade-holes builds it.
//
// What "playable" means here, and is tested:
//   - a Rocket struck at 125 to 155 mph finishes on the hero target, in still air and into the
//     stiffest headwind the stage's own wind range rolls; a plain ball never gets there
//   - a Rocket that comes up short, or 12 degrees off line, is never out of bounds
//   - from wherever a mishit finishes, a caddie with plain balls who may aim only 45 degrees
//     either side of the flag (the game's own limit) holes out: no spot is a dead end

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Game, CLUB_FULL } = require('../lib/game');
const { simulateShot, YD } = require('../lib/physics');
const courseLib = require('../lib/course');
const L = require('../tools/arcade-holes/lib');
const CAT = require('../tools/arcade-holes/courses');

let arcade = null;
try { arcade = require('../lib/arcade'); } catch (_) { /* no arcade layer in this tree */ }
const HAS_ROCKET = Boolean(arcade && typeof arcade.modifiersFor === 'function' && arcade.POWERUPS.some((p) => p.id === 'rocket'));

const IDS = ['sky-fortress', 'dragons-spine', 'summit-express'];
const BUILT = {};
for (const id of IDS) {
  const { course, expect } = CAT.buildCourse(id);
  BUILT[id] = { course, expect, report: L.validateCourse(course, { expect }), piece: CAT.PIECES[id] };
}

// What each stage is. `hero`: the Rocket's target, as [minX, minY, maxX, maxY] and its height;
// `short`: where a Rocket that does not make it must finish (above this height: on the scree
// or the ledge under the target, not at the bottom).
const WANT = {
  'sky-fortress': {
    number: 10, par: 3, theme: 'canyon', yd: [420, 435], climbM: 50, wind: { min: 8, max: 18 },
    hero: { box: [-58, 289, 58, 482], z: 82, what: 'the top of the butte' }, shortZ: 40,
    kinds: { 'launch-ramp': 2, castle: 1, tower: 8, gate: 1, 'flag-banner': 20, torch: 20, statue: 2, crowd: 3, waterfall: 3, boat: 3, mesa: 6 },
    widths: [['fairway', 184, 56, 'the Rampart ledge'], ['fairway', 334, 70, 'the courtyard'], ['fairway', 60, 60, 'the floor fairway']],
  },
  'dragons-spine': {
    number: 11, par: 4, theme: 'volcano', yd: [595, 612], climbM: 45, wind: { min: 6, max: 15 },
    hero: { box: [-44, 297, 44, 474], z: 69, what: 'the Spine' }, shortZ: 30,
    kinds: { 'launch-ramp': 2, dragon: 1, 'lava-fall': 6, torch: 24, 'lava-rock': 30, crystal: 10, volcano: 4, gate: 1, 'flag-banner': 12 },
    widths: [['fairway', 380, 66, 'the Spine'], ['fairway', 340, 80, 'the Ash Terrace'], ['fairway', 206, 80, 'the Jaw']],
  },
  'summit-express': {
    number: 12, par: 5, theme: 'alpine', yd: [690, 710], climbM: 44, wind: { min: 10, max: 22 },
    // (the biggest Rockets run through the valley and on up the bank to the Bench, 12 m higher)
    hero: { box: [-56, 258, 58, 548], z: 52, zMax: 64, what: 'the hanging valley' }, shortZ: 14,
    kinds: { 'launch-ramp': 2, cabin: 6, balloon: 4, 'flag-banner': 20, statue: 2, tower: 8, 'ice-spire': 12, pine: 20, snowman: 4, bridge: 1 },
    widths: [['fairway', 350, 90, 'the hanging valley'], ['fairway', 510, 100, 'the Bench'], ['fairway', 213, 120, 'the Shoulder']],
  },
};

const newGame = (id, conditions = null) => {
  const g = new Game();
  g.setCourse(structuredClone(BUILT[id].course));
  if (conditions) g.setConditions(conditions);
  return g;
};
// One swing. `rocket: true`: with the arcade layer's Rocket ball, exactly as the server arms it
// (no assists, so a mishit is the mishit it was).
function swing(g, { speed, vla = 13, spin = 2600, hla = 0, axis = 0, aim = 0, rocket = true }) {
  g.setAimOffset(aim);
  g.shotMods = rocket ? arcade.modifiersFor('rocket', null) : null;
  try { return g.handleShot({ Speed: speed, VLA: vla, HLA: hla, TotalSpin: spin, SpinAxis: axis }); } finally { g.shotMods = null; }
}
const zAt = (g, r) => g.terrain.h(r.end.x, r.end.y);
const where = (g, r) => `(${r.end.x.toFixed(0)}, ${r.end.y.toFixed(0)}) at ${zAt(g, r).toFixed(0)} m on ${r.lie}${r.penalty ? `, ${r.note}` : ''}`;
const onHero = (id, g, r) => {
  const { box, z, zMax = z } = WANT[id].hero;
  return r.penalty === 0 && r.end.x >= box[0] && r.end.x <= box[2] && r.end.y >= box[1] && r.end.y <= box[3] && zAt(g, r) > z - 3 && zAt(g, r) < zMax + 3;
};
const LIES = ['tee', 'fairway', 'green', 'rough', 'bunker'];

// A caddie with plain balls. From where the ball lies: the swing whose predicted finish is
// nearest the flag (a metre still to climb counts as CLIMB metres), dry and in bounds, aimed
// no more than 45 degrees off the flag. The same physics call the game makes.
const CADDIE_CLUBS = [['DR', 1], ['W3', 1], ['I5', 1], ['I7', 1], ['I9', 1], ['PW', 1], ['PW', 0.7], ['SW', 1], ['SW', 0.7], ['SW', 0.45], ['LW', 1], ['LW', 0.6], ['LW', 0.35]];
const CLIMB = 4;
function caddie(g) {
  const h = g.hole, from = { ...g.ball };
  const pinZ = g.terrain.h(h.pin[0], h.pin[1]);
  const options = [];
  if (g.lie === 'green') for (let mph = 1; mph <= 18; mph += 0.5) options.push({ k: 'putt', launch: { Speed: mph, VLA: 0.5, HLA: 0, TotalSpin: 100, SpinAxis: 0 }, aim: 0 });
  else for (const [k, power] of CADDIE_CLUBS) for (let aim = -45; aim <= 45; aim += 9) options.push({ k: `${k}${power < 1 ? `@${power}` : ''}`, launch: { Speed: CLUB_FULL[k].speedMph * power, VLA: CLUB_FULL[k].vla, HLA: 0, TotalSpin: CLUB_FULL[k].spin, SpinAxis: 0 }, aim });
  let best = null;
  for (const o of options) {
    const sim = simulateShot({ speedMph: o.launch.Speed, vla: o.launch.VLA, hla: 0, totalSpin: o.launch.TotalSpin, spinAxis: 0 }, from, g.aimDeg - g.aimOffset + o.aim, g.surfaceAt,
      { terrain: g.terrain, pin: { x: h.pin[0], y: h.pin[1] }, trees: g.treeObstacles });
    if (sim.endSurface === 'water' || sim.endSurface === 'ob' || sim.events.some((e) => e.type === 'water')) continue;
    const left = sim.holed ? 0 : Math.hypot(h.pin[0] - sim.end.x, h.pin[1] - sim.end.y);
    const score = left + CLIMB * Math.max(0, pinZ - g.terrain.h(sim.end.x, sim.end.y)) + (sim.endSurface === 'bunker' ? 5 : 0);
    if (!best || score < best.score) best = { ...o, score };
  }
  return best;
}
// Play out the hole from where the ball lies. -> { strokes, log }
function playOut(g, label, maxStrokes) {
  const log = [];
  while (!g.holed) {
    assert.ok(g.strokes < maxStrokes, `${label}: holed within ${maxStrokes} strokes (at ${g.strokes}, ${g.distToPinYd.toFixed(0)} yd out on ${g.lie}: ${log.join(' ')})`);
    const pick = caddie(g);
    assert.ok(pick, `${label}: there is a dry shot within 45 degrees of the flag from (${g.ball.x.toFixed(0)}, ${g.ball.y.toFixed(0)}) on ${g.lie}`);
    assert.ok(Math.abs(pick.aim) <= 45);
    g.setAimOffset(pick.aim);
    const r = g.handleShot(pick.launch);
    assert.ok(r && LIES.includes(r.lie), `${label}: a sound shot`);
    assert.equal(r.penalty, 0, `${label}: the caddie's shot stays dry (${pick.k} ${pick.aim})`);
    log.push(`${pick.k}/${pick.aim}>(${r.end.x.toFixed(0)},${r.end.y.toFixed(0)},${zAt(g, r).toFixed(0)}m)`);
  }
  return { strokes: g.strokes, log };
}

// ---------------------------------------------------------------- the stages

test('extreme stages: three rocket holes, built, validated, in the catalogue after the tour', () => {
  assert.deepEqual(CAT.STAGES.filter((s) => s.stage.role === 'match' && s.stage.order > L.TOUR_STAGES).map((s) => s.id), IDS, 'orders 10, 11, 12');
  for (const id of IDS) {
    const { course, report, piece } = BUILT[id], want = WANT[id];
    const stage = L.normalizeStage(piece.stage, id);
    assert.deepEqual([stage.number, stage.role, stage.order, stage.theme, stage.freeBall], [want.number, 'match', want.number, want.theme, 'rocket'], id);
    assert.equal(stage.difficulty, 3, `${id}: the hardest`);
    assert.deepEqual(stage.wind, want.wind, `${id}: its own wind range`);
    assert.ok(stage.blurb.length < 90 && /^Rocket par [345]/.test(stage.blurb), `${id}: blurb`);
    assert.ok(Math.abs(stage.origin.lat) > 35 && stage.baseM >= 1000, `${id}: high, and far enough north for no azalea beds`);
    assert.deepEqual(report.warnings, [], id);
    assert.equal(report.stats.sea, null, `${id}: no sea`);
    assert.ok(courseLib.isCurrentCourseCache(course), id);
    assert.equal(course.source.osmId, L.ARCADE_OSM_ID_BASE + want.number);
    assert.equal(course.arcade.freeBall, 'rocket');
    assert.deepEqual(course.arcade.wind, want.wind);
    assert.equal(course.arcade.order, want.number);
    const [hole] = course.holes, [stats] = report.stats.holes;
    assert.equal(hole.par, want.par, id);
    assert.ok(hole.lengthYd >= want.yd[0] && hole.lengthYd <= want.yd[1], `${id}: ${hole.lengthYd} yd`);
    // the three routes of the contract, documented and carried to the course
    assert.deepEqual(hole.routes.map((r) => r.id), ['safe', 'risky', 'rocket'], `${id}: routes`);
    for (const r of hole.routes) assert.ok(r.name.length >= 8 && r.name.length <= 28 && r.note.length >= 40 && r.note.length <= 120, `${id}: route ${r.id} reads on the intro (${r.name.length}, ${r.note.length})`);
    assert.deepEqual(hole.routes, piece.hole.routes);
    assert.ok(hole.note.length > 120 && /Rocket/.test(hole.note) && hole.greenNote.length > 40, `${id}: hole card`);
    // a big green, all but flat
    const [small, big] = [...stats.greenM].sort((p, q) => p - q);
    assert.ok(big >= 30 && small >= 26, `${id}: green ${stats.greenM.join(' x ')} m`);
    assert.ok(stats.greenSlopePct > 0.8 && stats.greenSlopePct < 2, `${id}: green slope ${stats.greenSlopePct} %`);
    // every landing zone 40 m and more across
    const g = newGame(id);
    for (const [kind, y, min, what] of want.widths) {
      let width = 0;
      for (let x = -160; x <= 200; x += 0.5) if (g.surfaceAt(x, y) === kind) width += 0.5;
      assert.ok(width >= min && min >= 40, `${id}: ${what} is ${width} m of ${kind} across at y ${y} (want ${min})`);
    }
    // probes pin down every tier and hazard
    assert.ok(piece.probes.length >= 22, `${id}: ${piece.probes.length} probes`);
    for (const kind of ['fairway', 'rough', 'water', 'bunker', 'ob']) assert.ok(piece.probes.some((p) => p.kind === kind), `${id}: a ${kind} probe`);
    for (const p of piece.probes) assert.equal(g.surfaceAt(p.at[0], p.at[1]), p.kind, `${id}: ${p.what}`);
  }
});

test('extreme stages: huge and vertical', () => {
  for (const id of IDS) {
    const { course, report } = BUILT[id], want = WANT[id];
    const g = newGame(id), el = course.elevation;
    const [stats] = report.stats.holes;
    const teeZ = stats.teeHeightM;
    assert.ok(Math.abs(want.hero.z - teeZ - want.climbM) < 1.5, `${id}: ${want.hero.what} is ${want.hero.z - teeZ} m above the tee`);
    let lo = Infinity, hi = -Infinity;
    for (const h of el.heights) { if (h < lo) lo = h; if (h > hi) hi = h; }
    assert.ok(hi - lo >= 100 && hi - lo <= 260, `${id}: ${(hi - lo).toFixed(0)} m of relief`);
    assert.ok((el.nx - 1) * el.cellM >= 500 && (el.ny - 1) * el.cellM >= 700, `${id}: a big world`);
    assert.ok(el.nx * el.ny <= 150_000, `${id}: ${el.nx * el.ny} height nodes: still a small file`);
    // the flag is far above or far beyond anything a plain ball flies to
    const pinZ = stats.pinHeightM;
    if (id === 'sky-fortress') assert.equal(pinZ - teeZ, 50);
    if (id === 'summit-express') assert.equal(pinZ - teeZ, 70);
    if (id === 'dragons-spine') assert.ok(want.hero.z - pinZ > 35 && pinZ - teeZ > 5, `${id}: the green is in the caldera, ${(want.hero.z - pinZ).toFixed(0)} m below the Spine`);
    // every bank a ball must climb holds a ball: rough, never steeper than half
    const slopeAt = (x, y) => { const gr = g.terrain.grad(x, y); return Math.hypot(gr.dx, gr.dy); };
    const banks = { 'sky-fortress': [[0, 100], [0, 140], [0, 230], [0, 270], [-74, 390], [74, 390]], 'dragons-spine': [[0, 240], [0, 280], [110, 190], [80, 480]], 'summit-express': [[4, 150], [4, 180], [6, 244], [8, 454], [-45, 566]] }[id];
    for (const [x, y] of banks) {
      assert.equal(g.surfaceAt(x, y), 'rough', `${id}: the bank at (${x}, ${y})`);
      assert.ok(slopeAt(x, y) > 0.25 && slopeAt(x, y) < 0.5, `${id}: the bank at (${x}, ${y}) slopes ${(slopeAt(x, y) * 100).toFixed(0)} %`);
    }
  }
});

test('extreme stages: set pieces that tell the story, clear of play', () => {
  for (const id of IDS) {
    const { course } = BUILT[id], want = WANT[id];
    const kinds = course.props.reduce((m, p) => ({ ...m, [p.kind]: (m[p.kind] || 0) + 1 }), {});
    assert.ok(course.props.length >= 120 && course.props.length <= 260, `${id}: ${course.props.length} props`);
    for (const [kind, n] of Object.entries(want.kinds)) assert.ok((kinds[kind] || 0) >= n, `${id}: ${kinds[kind] || 0} x ${kind} (want ${n} or more)`);
    assert.ok(Object.keys(kinds).length >= 18, `${id}: ${Object.keys(kinds).length} kinds of prop`);
    for (const p of course.props) assert.ok(L.PROP_KINDS.includes(p.kind), `${id}: ${p.kind}`);
    // a launch ramp either side of the line at the tee, and nothing between the tee and the flag
    const ramps = course.props.filter((p) => p.kind === 'launch-ramp');
    assert.deepEqual(ramps.map((p) => Math.sign(p.x)).sort(), [-1, 1], `${id}: a launch ramp either side of the tee`);
    for (const p of ramps) assert.ok(Math.hypot(p.x, p.y) < 26 && p.rotDeg === 0, `${id}: the ramps point up the hole`);
    assert.ok(course.trees.length >= 30 && course.woods.length >= 1, `${id}: ${course.trees.length} trees and ${course.woods.length} woods`);
  }
  const at = (id, kind) => BUILT[id].course.props.filter((p) => p.kind === kind);
  const g1 = newGame('sky-fortress');
  const [castle] = at('sky-fortress', 'castle');
  assert.ok(castle.y > 460 && Math.abs(castle.x) < 5 && g1.terrain.h(castle.x, castle.y) > 90, 'the castle stands on the keep, behind the green');
  assert.ok(at('sky-fortress', 'tower').filter((p) => g1.terrain.h(p.x, p.y) > 80).length >= 6, 'towers on the fortress wall');
  const g2 = newGame('dragons-spine');
  const [dragon] = at('dragons-spine', 'dragon');
  assert.ok(g2.terrain.h(dragon.x, dragon.y) > 80 && dragon.heightM >= 30, 'the dragon is coiled on the high rim');
  const g3 = newGame('summit-express');
  assert.ok(at('summit-express', 'cabin').filter((p) => p.y < 0).length >= 5, 'base camp');
  assert.ok(at('summit-express', 'cabin').some((p) => g3.terrain.h(p.x, p.y) > 75), 'a hut on the summit');
});

// ---------------------------------------------------------------- the rocket

test('extreme stages: the free Rocket makes the hero target from 125 to 155 mph, a plain ball never', (t) => {
  if (!HAS_ROCKET) return t.skip('lib/arcade.js has no Rocket power-up');
  for (const id of IDS) {
    const want = WANT[id];
    const made = [];
    for (let speed = 125; speed <= 155; speed += 5) {
      const g = newGame(id);
      const r = swing(g, { speed });
      assert.ok(onHero(id, g, r), `${id}: a ${speed} mph Rocket finishes on ${want.hero.what}: ${where(g, r)}`);
      assert.equal(r.strokes, 1);
      made.push(Math.round(r.sim.carryYd));
    }
    assert.deepEqual(made, [...made].sort((p, q) => p - q), `${id}: the harder it is hit the further it carries: ${made}`);
    assert.ok(made[0] >= 345 && made[made.length - 1] <= 480, `${id}: carries of ${made[0]} to ${made[made.length - 1]} yd`);
    // a lower and a higher launch still make it
    for (const [vla, spin] of [[10, 2200], [16, 3000]]) for (const speed of [130, 140, 150]) {
      const g = newGame(id);
      const r = swing(g, { speed, vla, spin });
      // v3:gadgets (or better: a low one that runs off the Spine's far end is thrown into the caldera by the Dragon's Tail, a pad)
      const thrown = (r.gadgets || []).some((h) => h.id === 'dragons-tail') && r.penalty === 0 && r.distToPinYd < 40;
      assert.ok(thrown || onHero(id, g, r), `${id}: ${speed} mph launched at ${vla} degrees: ${where(g, r)}`);
    }
    // a plain ball, however hard, is nowhere near (and so is a Rocket hit like a chip)
    for (const speed of [125, 140, 152, 170]) {
      const g = newGame(id);
      const r = swing(g, { speed, rocket: false });
      // v3:gadgets (by its own flight: on Sky Fortress the Great Bombard, a cannon on the Rampart ledge,
      // fires a plain ball that comes down on it up into the courtyard: test/gadgets.test.js)
      const fired = (r.gadgets || []).some((h) => h.kind === 'warp');
      assert.ok(fired || (!onHero(id, g, r) && (r.penalty || zAt(g, r) < want.hero.z - 12)), `${id}: a plain ${speed} mph drive: ${where(g, r)}`);
    }
  }
  // what the Rocket leaves: a putt on Sky Fortress, a wedge down on Dragon's Spine
  const fortress = newGame('sky-fortress');
  const ace = swing(fortress, { speed: 138 });
  assert.equal(ace.lie, 'green', `Sky Fortress at 138 mph: ${where(fortress, ace)}`);
  for (const speed of [130, 135, 140]) { const g = newGame('sky-fortress'); assert.ok(swing(g, { speed }).distToPinYd < 20, `Sky Fortress: ${speed} mph is a birdie putt`); }
  const spine = newGame('dragons-spine');
  swing(spine, { speed: 140 });
  assert.ok(spine.distToPinYd > 110 && spine.distToPinYd < 170, `Dragon's Spine at 140 mph: ${spine.distToPinYd.toFixed(0)} yd down to the flag`);
  // ... and a huge one runs off the Spine's end and down the crater wall
  const bomb = newGame('dragons-spine');
  const b = swing(bomb, { speed: 168 });
  assert.ok(b.penalty === 0 && zAt(bomb, b) < 34 && b.distToPinYd < 60, `Dragon's Spine at 168 mph: ${where(bomb, b)}`);
});

test('extreme stages: the hero carry is still on in the stiffest wind the stage rolls', (t) => {
  if (!HAS_ROCKET) return t.skip('lib/arcade.js has no Rocket power-up');
  for (const id of IDS) {
    const { max, min } = WANT[id].wind;
    // dead into it (the hole plays north: the wind is FROM the north)
    for (const speed of [130, 140, 155]) {
      const g = newGame(id, { windMph: max, windFromDeg: 0 });
      const r = swing(g, { speed });
      assert.ok(onHero(id, g, r), `${id}: ${speed} mph into ${max} mph: ${where(g, r)}`);
    }
    const head = newGame(id, { windMph: max, windFromDeg: 0 });
    const marginal = swing(head, { speed: 125 });
    assert.ok(onHero(id, head, marginal), `${id}: even 125 mph makes it into ${max} mph: ${where(head, marginal)}`);
    // with it behind: further, and still in play
    for (const speed of [125, 135]) {
      const g = newGame(id, { windMph: max, windFromDeg: 180 });
      const r = swing(g, { speed });
      // v3:gadgets (or better than the hero target: on Dragon's Spine a ball that runs to the Spine's far
      // end is thrown down into the caldera by the Dragon's Tail, a pad, and finishes by the green)
      const thrown = (r.gadgets || []).some((h) => h.id === 'dragons-tail') && r.penalty === 0 && r.distToPinYd < 40;
      assert.ok(thrown || onHero(id, g, r), `${id}: ${speed} mph with ${max} mph behind: ${where(g, r)}`);
    }
    // across, from either side: aimed off into it, as a player would
    for (const fromDeg of [90, 270]) for (const speed of [125, 140]) {
      const into = fromDeg === 90 ? 1 : -1;
      const drift = Array.from({ length: 5 }, (_, k) => into * k * 2);       // 0, 2, 4, 6, 8 degrees into the wind
      const ok = drift.some((aim) => { const g = newGame(id, { windMph: max, windFromDeg: fromDeg }); return onHero(id, g, swing(g, { speed, aim })); });
      assert.ok(ok, `${id}: ${speed} mph in a ${max} mph crosswind from ${fromDeg}: one of the aims ${drift} finds ${WANT[id].hero.what}`);
    }
    // the lightest wind of the range, from ahead: nothing changes
    const light = newGame(id, { windMph: min, windFromDeg: 0 });
    assert.ok(onHero(id, light, swing(light, { speed: 125 })), `${id}: 125 mph into ${min} mph`);
  }
});

test('extreme stages: a Rocket that misses has somewhere to finish, and 12 degrees off line is never out of bounds', (t) => {
  if (!HAS_ROCKET) return t.skip('lib/arcade.js has no Rocket power-up');
  for (const id of IDS) {
    const want = WANT[id];
    // short: on the scree or the ledge under the target, dry, a pitch from it
    for (const speed of [98, 104, 110]) for (const [vla, spin] of [[10, 2200], [13, 2600], [16, 3000]]) {
      const g = newGame(id);
      const r = swing(g, { speed, vla, spin });
      assert.equal(r.penalty, 0, `${id}: ${speed} mph at ${vla} degrees is dry: ${where(g, r)}`);
      assert.ok(zAt(g, r) >= want.shortZ && zAt(g, r) <= want.hero.z + 1 && LIES.includes(r.lie), `${id}: ${speed} mph at ${vla} degrees finishes under the target: ${where(g, r)}`);
    }
    // 12 degrees off line, or struck with 12 degrees of push or pull: never out of bounds
    for (const speed of [125, 140, 155]) for (const miss of [{ aim: -12 }, { aim: 12 }, { aim: -6 }, { aim: 6 }, { hla: -12 }, { hla: 12 }]) {
      const g = newGame(id);
      const r = swing(g, { speed, ...miss });
      assert.ok(r && LIES.includes(r.lie), `${id}: ${speed} mph ${JSON.stringify(miss)}: ${where(g, r)}`);
      assert.doesNotMatch(r.note || '', /Out of bounds/, `${id}: ${speed} mph ${JSON.stringify(miss)}: ${where(g, r)}`);
      assert.equal(g.surfaceAt(r.end.x, r.end.y), r.lie);
    }
  }
  // Sky Fortress: 12 degrees wide still holds a bastion; Summit Express: the aretes feed it back
  for (const aim of [-12, 12]) for (const speed of [125, 140, 155]) {
    const f = newGame('sky-fortress');
    const r = swing(f, { speed, aim });
    assert.ok(r.penalty === 0 && zAt(f, r) >= 69, `Sky Fortress ${speed} mph ${aim}: ${where(f, r)}`);
    const s = newGame('summit-express');
    const v = swing(s, { speed, aim });
    assert.ok(v.penalty === 0 && zAt(s, v) >= 51, `Summit Express ${speed} mph ${aim}: ${where(s, v)}`);
  }
  // Dragon's Spine: left melts (dropped back on dry rock), right is the Ash Terrace
  for (const speed of [125, 140]) {
    const d = newGame('dragons-spine');
    const left = swing(d, { speed, aim: -12 });
    assert.equal(left.penalty, 1, `Dragon's Spine ${speed} mph pulled: ${where(d, left)}`);
    assert.match(left.note, /^Water/);
    assert.ok(zAt(d, left) > 20, `the drop is back on top, not under a wall: ${where(d, left)}`);
    const e = newGame('dragons-spine');
    const right = swing(e, { speed, aim: 12 });
    assert.ok(right.penalty === 0 && Math.abs(zAt(e, right) - 38) < 2, `Dragon's Spine ${speed} mph pushed: ${where(e, right)}`);
  }
});

// ---------------------------------------------------------------- the bail-outs

// [label, the tee shot, the most strokes the caddie may then need in all]
const BAILOUTS = {
  'sky-fortress': [
    ['a Rocket at 100 mph (on the Siege Ramp)', { speed: 100 }, 5],
    ['a Rocket at 112 mph (just under the lip)', { speed: 112 }, 4],
    ['a topped Rocket', { speed: 110, vla: 3, spin: 1500 }, 7],
    ['a plain drive', { speed: 152, rocket: false }, 6],
    ['a plain 7-iron', { speed: 111, vla: 19, spin: 7000, rocket: false }, 8],
    ['a Rocket 12 degrees left (the west bastion)', { speed: 140, aim: -12 }, 4],
    ['a Rocket sliced into the lake', { speed: 140, hla: 12, axis: 12 }, 8],
  ],
  'dragons-spine': [
    ['a Rocket at 100 mph (on the scree under the Spine)', { speed: 100 }, 6],
    ['a topped Rocket (lava, dropped by the tee)', { speed: 110, vla: 3, spin: 1500 }, 10],
    ['a plain drive at the flag (the Jaw, or lava)', { speed: 152, rocket: false }, 8],
    ['a plain drive down the Ash Road', { speed: 152, rocket: false, aim: 32 }, 8],
    ['a plain 7-iron down the Ash Road', { speed: 111, vla: 19, spin: 7000, rocket: false, aim: 35 }, 9],
    ['a Rocket pushed 12 degrees (the Ash Terrace)', { speed: 140, aim: 12 }, 6],
    ['a Rocket down the Ash Road', { speed: 135, aim: 25 }, 6],
    ['a Rocket pulled into the lava', { speed: 140, aim: -12 }, 8],
  ],
  'summit-express': [
    ['a Rocket at 100 mph (on the headwall)', { speed: 100 }, 7],
    ['a topped Rocket', { speed: 110, vla: 3, spin: 1500 }, 9],
    ['a plain drive', { speed: 152, rocket: false }, 9],
    ['a Rocket at 125 mph', { speed: 125 }, 6],
    ['a Rocket at 150 mph', { speed: 150 }, 6],
    ['a Rocket 12 degrees left (off the west arete)', { speed: 140, aim: -12 }, 7],
    ['a Rocket hooked over the arete (out of bounds, dropped on the crest)', { speed: 140, aim: -20 }, 9],
  ],
};

for (const id of IDS) {
  test(`${id}: from wherever a mishit finishes, the hole is played out with plain balls aimed within 45 degrees of the flag`, (t) => {
    if (!HAS_ROCKET) return t.skip('lib/arcade.js has no Rocket power-up');
    const par = BUILT[id].course.holes[0].par;
    const cards = [];
    for (const [label, tee, most] of BAILOUTS[id]) {
      const g = newGame(id);
      const first = swing(g, tee);
      assert.ok(first && LIES.includes(first.lie), `${id}, ${label}: ${where(g, first)}`);
      const { strokes, log } = playOut(g, `${id}, ${label}`, most + 4);
      assert.ok(strokes <= most, `${id}, ${label}: home in ${strokes} (want ${most} or fewer): ${where(g, first)} then ${log.join(' ')}`);
      assert.equal(g.state().over, true);
      cards.push(strokes);
      if (process.env.ARCADE_X_LOG) console.log(`${id}, ${label}: ${where(g, first)}; home in ${strokes}: ${log.join(' ')}`);   // ARCADE_X_LOG=1: print every card
    }
    assert.ok(Math.min(...cards) <= par + 2, `${id}: the bail-outs cost a stroke or two, not the hole: ${cards}`);
  });
}

test('extreme stages: the routes are real', (t) => {
  if (!HAS_ROCKET) return t.skip('lib/arcade.js has no Rocket power-up');
  // Sky Fortress: the Rocket makes a two (or a one); the Siege Ramp takes plain balls up in steps
  const hero = newGame('sky-fortress');
  swing(hero, { speed: 138 });
  assert.ok(playOut(hero, 'Sky Fortress, the Rocket', 6).strokes <= 3, 'on in one, down in two');
  const ramp = newGame('sky-fortress');
  const first = swing(ramp, { speed: 152, rocket: false });
  assert.ok(first.penalty === 0 && zAt(ramp, first) > 30 && zAt(ramp, first) < 82 && Math.abs(first.end.x) < 40, `a plain drive finishes on the Siege Ramp: ${where(ramp, first)}`);
  // Dragon's Spine: Rocket, wedge, two putts; the Ash Road is dry all the way and costs strokes
  const spine = newGame('dragons-spine');
  swing(spine, { speed: 140 });
  assert.ok(playOut(spine, "Dragon's Spine, the Rocket", 8).strokes <= 4, 'a par at worst from the Spine');
  const road = newGame('dragons-spine');
  const lay = swing(road, { speed: 152, rocket: false, aim: 32 });
  assert.equal(lay.penalty, 0, `the Ash Road is dry: ${where(road, lay)}`);
  const viaRoad = playOut(road, "Dragon's Spine, the Ash Road", 12).strokes;
  assert.ok(viaRoad >= 5 && viaRoad <= 8, `the Ash Road is home in ${viaRoad}: a stroke or two more than the Spine`);
  // ... and from the Ash Terrace one long shot can clear the low rim (the risky route)
  const terrace = newGame('dragons-spine');
  swing(terrace, { speed: 140, aim: 15 });
  assert.ok(Math.abs(terrace.terrain.h(terrace.ball.x, terrace.ball.y) - 38) < 2, 'on the Ash Terrace');
  const overs = ['DR', 'W3', 'H3', 'I4'].map((k) => {
    const g = new Game(); g.setCourse(structuredClone(BUILT['dragons-spine'].course));
    swing(g, { speed: 140, aim: 15 });
    const r = g.handleShot({ Speed: CLUB_FULL[k].speedMph, VLA: CLUB_FULL[k].vla, HLA: 0, TotalSpin: CLUB_FULL[k].spin, SpinAxis: 0 });
    return { k, inBowl: r.penalty === 0 && zAt(g, r) < 34 && r.distToPinYd < 70 };
  });
  assert.ok(overs.some((o) => o.inBowl), `a wood or long iron from the Ash Terrace finishes in the bowl: ${JSON.stringify(overs)}`);
  // Summit Express: from the Bench the crevasse is a real carry, and the West Col goes round it
  const g = newGame('summit-express');
  swing(g, { speed: 125 });
  assert.ok(Math.abs(zAt(g, { end: g.ball }) - 52) < 2);
  const line = [];
  for (let y = 500; y <= 640; y += 2) line.push(g.surfaceAt(L.lerp(0, 20, (y - 500) / 140), y));
  const ice = line.filter((s) => s === 'water').length * 2;
  assert.ok(ice >= 44 && ice <= 52, `${ice} m of crevasse between the Bench and the flag`);
  for (let y = 548; y <= 600; y += 4) assert.ok(LIES.includes(g.surfaceAt(-50, y)), `the West Col is dry at y ${y}`);
  // short of the far lip is a stroke, dropped back on the Bench
  const short = newGame('summit-express');
  short.ball = { x: 0, y: 520 }; short.lie = 'fairway'; short.strokes = 2;
  const wet = short.handleShot({ Speed: CLUB_FULL.SW.speedMph * 0.8, VLA: CLUB_FULL.SW.vla, HLA: 0, TotalSpin: CLUB_FULL.SW.spin, SpinAxis: 0 });
  assert.equal(wet.penalty, 1, `a weak wedge from the Bench is in the crevasse: ${where(short, wet)}`);
  assert.ok(wet.end.y < 550 && Math.abs(zAt(short, wet) - 64) < 3, `and is dropped back on the Bench: ${where(short, wet)}`);
});
