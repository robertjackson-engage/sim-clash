'use strict';
// Stream holes-b of the arcade tour (docs/dev/arcade-v2-contract.md section 1): Sakura Garden
// (match 6), Temple Run (match 7) and Bullseye Bay (tiebreak 1). Each hole file is
// assembled into its single-hole course exactly as the catalogue does it, validated with
// the loader's own code, and then played through the real Game with simulated swings:
// the safe line, the hero line, what the water costs, and a spray of ordinary misses.
// Offline: nothing here touches the network, a server or the repo's data dir.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Game } = require('../lib/game');
const { simulateShot, YD } = require('../lib/physics');
const courseLib = require('../lib/course');
const { courseCacheStem } = require('../lib/course-identity');
const L = require('../tools/arcade-holes/lib');
const { teeCameraClearance } = require('./helpers/arcade-holes');

// What the contract's stage table asks of each hole.
const SPEC = {
  'sakura-garden': {
    number: 6, role: 'match', order: 6, name: 'Sakura Garden', par: 3, yd: [125, 140], theme: 'sakura', sea: false,
    minGreenM: [28, 24], kinds: ['sakura-tree', 'torii', 'pagoda', 'stone-lantern', 'bridge'],
  },
  'temple-run': {
    number: 7, role: 'match', order: 7, name: 'Temple Run', par: 5, yd: [490, 530], theme: 'jungle', sea: false,
    minGreenM: [28, 24], kinds: ['temple', 'idol', 'torch', 'rock-arch', 'palm', 'bridge'],
  },
  'bullseye-bay': {
    number: 21, role: 'tiebreak', order: 1, name: 'Bullseye Bay', par: 3, yd: [110, 120], theme: 'tropical', sea: true,
    minGreenM: [34, 34], kinds: ['target-ring', 'palm', 'shipwreck', 'balloon', 'boat', 'hut', 'tiki', 'waterfall', 'lighthouse', 'bird-flock', 'crowd', 'flag-banner'],
  },
};
const IDS = Object.keys(SPEC);
const LIES = ['tee', 'fairway', 'green', 'rough', 'bunker'];   // where a ball may come to rest

// One hole file -> its stage course, as tools/arcade-holes/courses.js builds it.
function build(id) {
  const piece = require(`../tools/arcade-holes/holes/${id}.js`);
  const stage = L.normalizeStage(piece.stage, id);
  const { course, expect } = L.assembleCourse({
    id, number: stage.number, name: stage.name, origin: stage.origin, pieces: [{ piece }],
    ...(stage.baseM ? { baseM: stage.baseM } : {}), ...(stage.conditions ? { conditions: stage.conditions } : {}),
    stage,
  });
  return { piece, stage, course, expect, report: L.validateCourse(course, { expect }) };
}
const BUILT = Object.fromEntries(IDS.map((id) => [id, build(id)]));
const SURFACE = Object.fromEntries(IDS.map((id) => [id, courseLib.makeSurfaceLookup(BUILT[id].course)]));

// ---- swings: [ball speed mph, launch deg, spin rpm]
const DRIVE = [150, 12, 2500], WOOD = [145, 11, 3500], IRON5 = [130, 16, 5000], IRON7 = [115, 19, 6500];
const WEDGE = [90, 28, 9000], WEDGE_SOFT = [80, 30, 9000], WEDGE_FIRM = [95, 27, 9000], HALF = [60, 34, 8000];
const ball = ([Speed, VLA, TotalSpin], SpinAxis = 0) => ({ Speed, VLA, HLA: 0, TotalSpin, SpinAxis });

const GAMES = {};
// A fresh round on the hole (one Game per hole, reset: building the surface lookup is the slow part).
function newGame(id) {
  if (!GAMES[id]) { GAMES[id] = new Game(); GAMES[id].setCourse(structuredClone(BUILT[id].course)); }
  const g = GAMES[id];
  g.shotMods = null;
  g.reset();
  return g;
}
function hit(g, swing, { aim = 0, axis = 0 } = {}) {
  g.setAimOffset(aim);
  const r = g.handleShot(ball(swing, axis));
  assert.ok(r, 'the shot was played');
  assert.ok(LIES.includes(r.lie), `the ball lies on '${r.lie}'`);
  assert.equal(g.surfaceAt(r.end.x, r.end.y), r.holed ? 'green' : r.lie, 'the lie is the surface under the ball');
  assert.ok(r.penalty === 0 || r.penalty === 1);
  if (r.penalty) assert.match(r.note, /Water|Out of bounds/);
  return r;
}
const outcome = (r) => (r.penalty ? (/Water/.test(r.note) ? 'water' : 'ob') : r.lie);

// A spray of shots from the tee: every speed x aim x spin axis. -> { outcome: count, n }
function spray(id, { speeds, vla, spin, aims, axes }) {
  const tally = { n: 0 };
  for (const speed of speeds) for (const aim of aims) for (const axis of axes) {
    const r = hit(newGame(id), [speed, vla, spin], { aim, axis });
    const k = outcome(r);
    tally[k] = (tally[k] || 0) + 1;
    tally.n++;
  }
  return tally;
}
const share = (tally, ...kinds) => kinds.reduce((s, k) => s + (tally[k] || 0), 0) / tally.n;
const range = (a, b, step) => { const out = []; for (let v = a; v <= b + 1e-9; v += step) out.push(v); return out; };

// Finish the hole from where the ball lies with the short game: the pitch or putt whose
// predicted finish is nearest the hole without a penalty (the game's own physics call).
function finish(g, label, maxStrokes = 9) {
  while (!g.holed) {
    assert.ok(g.strokes < maxStrokes, `${label}: holed within ${maxStrokes} strokes (at ${g.strokes}, ${g.distToPinYd.toFixed(0)} yd out on ${g.lie})`);
    const h = g.hole, from = { ...g.ball };
    const options = g.lie === 'green'
      ? range(1, 16, 0.25).map((mph) => [mph, 0.5, 100])
      : range(20, 100, 2.5).map((mph) => [mph, 34, 7000]);
    let best = null;
    for (const o of options) {
      const sim = simulateShot({ speedMph: o[0], vla: o[1], hla: 0, totalSpin: o[2], spinAxis: 0 }, from, g.aimDeg - g.aimOffset, g.surfaceAt,
        { terrain: g.terrain, pin: { x: h.pin[0], y: h.pin[1] }, trees: g.treeObstacles });
      if (sim.endSurface === 'water' || sim.endSurface === 'ob' || sim.events.some((e) => e.type === 'water')) continue;
      const left = sim.holed ? 0 : Math.hypot(h.pin[0] - sim.end.x, h.pin[1] - sim.end.y);
      if (!best || left < best.left) best = { swing: o, left };
    }
    assert.ok(best, `${label}: there is a dry shot from (${from.x.toFixed(0)}, ${from.y.toFixed(0)}) on ${g.lie}`);
    const r = hit(g, best.swing);
    assert.equal(r.penalty, 0, `${label}: the short game stays dry`);
  }
  return g.strokes;
}

// The surfaces crossed walking from a to b, as [{ kind, fromM, toM }].
function walk(id, a, b, stepM = 0.25) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), out = [];
  for (let m = 0; m <= len; m += stepM) {
    const kind = SURFACE[id](a[0] + (b[0] - a[0]) * m / len, a[1] + (b[1] - a[1]) * m / len);
    if (!out.length || out[out.length - 1].kind !== kind) out.push({ kind, fromM: m, toM: m });
    else out[out.length - 1].toM = m;
  }
  return out;
}
const yd = (m) => m / YD;

// ---------------------------------------------------------------- every hole

for (const id of IDS) {
  const spec = SPEC[id];

  test(`${id}: assembles into a valid stage course, as the contract's table has it`, () => {
    const { piece, course, expect, report } = BUILT[id];
    assert.equal(piece.id, id);
    assert.deepEqual(report.warnings, [], 'no warnings: every prop kind has a model, the boundary holds');
    assert.equal(course.holes.length, 1);
    const [hole] = report.stats.holes;
    assert.equal(hole.par, spec.par);
    assert.ok(hole.lengthYd >= spec.yd[0] && hole.lengthYd <= spec.yd[1], `${hole.lengthYd} yd is within ${spec.yd.join(' to ')}`);
    assert.equal(course.name, spec.name);
    assert.equal(course.holes[0].name, spec.name);

    // the stage block, and what the course carries of it
    const s = piece.stage;
    assert.equal(s.number, spec.number);
    assert.equal(s.role, spec.role);
    assert.equal(s.order, spec.order);
    assert.equal(s.theme, spec.theme);
    assert.ok(typeof s.blurb === 'string' && s.blurb.length > 10 && s.blurb.length < 90, `blurb is ${s.blurb.length} characters`);
    assert.ok([1, 2, 3].includes(s.difficulty));
    assert.ok(['day', 'golden', 'dusk', 'night'].includes(s.timeOfDay));
    assert.ok(Number.isFinite(s.origin.lat) && Number.isFinite(s.origin.lon));
    assert.equal(course.arcade.id, id);
    assert.equal(course.arcade.formatVersion, 2);
    assert.deepEqual(course.arcade.holes, [id]);
    for (const k of ['theme', 'role', 'order', 'timeOfDay', 'blurb', 'difficulty']) assert.equal(course.arcade[k], s[k], `course.arcade.${k}`);
    assert.equal(course.source.osmId, 9900000000000 + spec.number);
    assert.equal(`${courseCacheStem(course.source)}.json`, `osm-node-99000000000${String(spec.number).padStart(2, '0')}.json`);

    // the loader takes it, before and after a trip through JSON
    assert.ok(courseLib.isCurrentCourseCache(course));
    assert.deepEqual(JSON.parse(JSON.stringify(course)), course);
    assert.equal(Boolean(report.stats.sea), spec.sea, spec.sea ? 'the sea is found' : 'no sea is found');
    assert.equal(expect.sea, spec.sea);
    assert.ok(expect.probes.length >= 10, 'the hazards and surfaces are pinned down by probes');
    for (const kind of ['water', 'rough']) assert.ok(expect.probes.some((p) => p.kind === kind), `a ${kind} probe`);
  });

  test(`${id}: a big, gentle green and a tee that sees it`, () => {
    const [hole] = BUILT[id].report.stats.holes;
    assert.ok(hole.greenM[0] >= spec.minGreenM[0] && hole.greenM[1] >= spec.minGreenM[1], `green ${hole.greenM.join(' x ')} m`);
    assert.ok(hole.greenSlopePct < 3, `green slope ${hole.greenSlopePct} %`);
    assert.ok(hole.greenSlopePct >= 0.5, 'not dead flat: putts break a little');
    assert.ok(hole.teeHeightM > hole.pinHeightM, 'the tee looks down on the green: nothing is hidden');
  });

  test(`${id}: plenty of props, all of kinds the look stream models, none in play`, () => {
    const { course } = BUILT[id];
    assert.ok(course.props.length >= 35, `${course.props.length} props`);
    for (const p of course.props) assert.ok(L.PROP_KINDS.includes(p.kind), `prop kind ${p.kind}`);
    for (const kind of spec.kinds) assert.ok(course.props.some((p) => p.kind === kind), `a ${kind}`);
    assert.equal(new Set(course.props.map((p) => p.id)).size, course.props.length, 'prop ids are unique');
    // nothing solid stands where a ball lies: fairways, bunkers and tees are clear, and
    // the green carries nothing but target rings
    for (const p of course.props) {
      if (p.kind === 'bridge') continue;                       // a deck over whatever it spans
      const on = SURFACE[id](p.x, p.y);
      if (p.kind === 'target-ring') assert.equal(on, 'green');
      else if (!['balloon', 'blimp'].includes(p.kind)) assert.ok(['rough', 'water', 'ob'].includes(on), `${p.id} stands on ${on}`);
    }
    assert.ok(course.trees.length >= 1, 'canopy trees switch the invented horizon trees off');
    for (const [x, y] of course.trees) assert.ok(['rough', 'ob'].includes(SURFACE[id](x, y)), `tree at (${x}, ${y}) stands on open ground`);
  });

  test(`${id}: a spray of ordinary misses is never out of bounds`, () => {
    const tee = spec.par === 5
      ? { speeds: [125, 135, 145, 150, 155], vla: 12, spin: 2600, aims: range(-12, 12, 3), axes: [-15, 0, 15] }
      : { speeds: [84, 88, 92, 96, 100], vla: 28, spin: 9000, aims: range(-12, 12, 3), axes: [-10, 0, 10] };
    const tally = spray(id, tee);
    assert.equal(tally.ob || 0, 0, JSON.stringify(tally));
  });
}

// ---------------------------------------------------------------- Sakura Garden and Temple Run: helpers

// The aim offset (degrees, as hit() takes it) that points the game at a spot from where the ball lies.
function aimTo(g, p) {
  const to = (q) => Math.atan2(q[0] - g.ball.x, q[1] - g.ball.y) * 180 / Math.PI;
  return to(p) - to(g.hole.pin);
}
// The wind, blowing FROM a bearing given relative to the tee-to-pin line (0: dead against,
// 180: behind, 90: from the right, 270: from the left). newGame() keeps one Game per hole,
// so every test that sets a wind puts the calm back (calm()).
function windAt(g, relDeg, mph) {
  const h = g.hole, bearing = Math.atan2(h.pin[0] - h.tee[0], h.pin[1] - h.tee[1]) * 180 / Math.PI;
  g.setConditions({ windMph: mph, windFromDeg: ((bearing + relDeg) % 360 + 360) % 360, gustMph: 0 });
}
const calm = (id) => newGame(id).setConditions({ windMph: 0, windFromDeg: 0, gustMph: 0 });
// The Rocket ball's shot modifiers (lib/arcade.js), or null when the arcade layer is not there.
function rocketMods() {
  try { const m = require('../lib/arcade').modifiersFor('rocket'); return m && m.id === 'rocket' ? m : null; } catch (_) { return null; }
}
// One swing with the Rocket ball.
function rocketHit(g, mods, swing, opts = {}) {
  g.shotMods = mods;
  try { return hit(g, swing, opts); } finally { g.shotMods = null; }
}
const propCount = (id, kind, where = () => true) => BUILT[id].course.props.filter((p) => p.kind === kind && where(p)).length;
const heightAt = (id, x, y) => newGame(id).terrain.h(x, y);

// ---------------------------------------------------------------- Sakura Garden

test('Sakura Garden: the smallest green on the tour, wrapped by ponds, under the Great Falls', () => {
  const id = 'sakura-garden';
  const { course, report, piece } = BUILT[id];
  const [hole] = report.stats.holes;
  assert.ok(hole.greenM[0] <= 32 && hole.greenM[1] <= 28, `the green is the minimum size, near enough (${hole.greenM.join(' x ')} m)`);
  assert.ok(course.surfaces.filter((s) => s.kind === 'water').length >= 3, 'ponds');
  assert.ok(course.surfaces.filter((s) => s.kind === 'bunker').length >= 5, 'stepping-stone bunkers');
  assert.equal(report.stats.sea, null);
  // the three routes are on the hole card, and the garden has its own (light) wind
  assert.deepEqual(course.holes[0].routes.map((r) => r.id), ['safe', 'risky', 'rocket']);
  assert.deepEqual(course.arcade.wind, piece.stage.wind);
  assert.ok(piece.stage.wind.min === 0 && piece.stage.wind.max <= 8, 'a walled garden: a breath of air at most');
  // looking out from the middle of the green, about half the directions meet water within 45 m
  const green = course.surfaces.find((s) => s.kind === 'green').poly;
  const [cx, cy] = L.centroid(green);
  let wet = 0, dry = 0, firstWetM = Infinity;
  for (let a = 0; a < 360; a += 5) {
    const far = [cx + 45 * Math.cos(a * Math.PI / 180), cy + 45 * Math.sin(a * Math.PI / 180)];
    const water = walk(id, [cx, cy], far).find((s) => s.kind === 'water');
    if (water) { wet++; firstWetM = Math.min(firstWetM, water.fromM); } else dry++;
  }
  assert.ok(wet / 72 >= 0.4 && wet / 72 <= 0.8, `${wet} of 72 directions are wet`);
  assert.ok(dry >= 14, 'and there are dry ways past the ponds');
  assert.ok(firstWetM >= 14, 'the water starts off the green, not at its edge');
  // the straight line at the flag carries the koi pond; the bank beyond it is dry
  const line = walk(id, course.holes[0].tee, course.holes[0].pin);
  const pond = line.filter((s) => s.kind === 'water');
  assert.equal(pond.length, 1, 'one carry on the line');
  assert.ok(yd(pond[0].fromM) > 90 && yd(pond[0].toM) < 116, `water from ${yd(pond[0].fromM).toFixed(0)} to ${yd(pond[0].toM).toFixed(0)} yd`);
  assert.equal(line[line.length - 1].kind, 'green');
  // elevation: the tee 16 m above the green on the south hill, the Great Falls 70 m and more above it behind
  assert.ok(hole.teeHeightM - hole.pinHeightM > 14, `the tee is ${(hole.teeHeightM - hole.pinHeightM).toFixed(1)} m above the flag`);
  assert.ok(heightAt(id, cx, cy + 34) - hole.pinHeightM > 60, 'a cliff 60 m and more high stands straight behind the green');
  assert.ok(heightAt(id, cx, cy + 20) - hole.pinHeightM < 3, 'with mown ground at its foot');
  assert.equal(SURFACE[id](cx, cy + 18), 'fairway', 'the collar, between the green and the cliff');
  // the garden: falls, pagodas, a torii avenue, bridges, lantern walks, the koi, a crowd
  assert.ok(course.props.length >= 100 && course.props.length <= 250, `${course.props.length} props`);
  assert.ok(propCount(id, 'waterfall') >= 4 && propCount(id, 'pagoda') >= 4 && propCount(id, 'torii') >= 6 && propCount(id, 'bridge') >= 3);
  assert.ok(propCount(id, 'stone-lantern') >= 12 && propCount(id, 'sakura-tree') >= 30 && propCount(id, 'statue') >= 1 && propCount(id, 'fountain') >= 1);
  assert.ok(propCount(id, 'crowd') >= 4 && propCount(id, 'jumbotron') === 1, 'the green is an event');
  assert.ok(propCount(id, 'torii', (p) => SURFACE[id](p.x, p.y) === 'water') >= 1, 'a torii stands in the koi pond');
  assert.ok(course.trees.length >= 150, `${course.trees.length} cherry trees on the terraced hills`);
});

test('Sakura Garden: RISKY, at the flag over the koi pond, and what short and right cost', () => {
  const id = 'sakura-garden';
  // a firm wedge straight at the flag carries the pond and is close
  const g = newGame(id);
  const hero = hit(g, WEDGE_FIRM);
  assert.equal(hero.penalty, 0);
  assert.ok(hero.holed || (hero.lie === 'green' && hero.distToPinYd < 6), `a 95 mph wedge finishes ${hero.distToPinYd} yd from the flag`);
  assert.ok(finish(g, 'hero line') <= 3, 'a par, at worst, from there');
  // a stock one is on the green short of the flag
  const stock = hit(newGame(id), WEDGE);
  assert.equal(outcome(stock), 'green');
  assert.ok(stock.distToPinYd < 14, `${stock.distToPinYd} yd from the flag`);
  // a chunked one is in the koi pond: one stroke, dropped on the tee side of it
  const g2 = newGame(id);
  const short = hit(g2, [72, 32, 9000]);
  assert.equal(outcome(short), 'water');
  assert.equal(g2.strokes, 2);
  assert.equal(short.lie, 'rough');
  assert.ok(short.end.y < 92 && short.distToPinYd < 50, 'the drop is short of the pond, a pitch away');
  const bogeyOrSo = finish(g2, 'after the pond');
  assert.ok(bogeyOrSo >= 3 && bogeyOrSo <= 5, `home in ${bogeyOrSo} after the water`);
  // and so is one pushed right of the flag
  assert.equal(outcome(hit(newGame(id), WEDGE_FIRM, { aim: 9 })), 'water', 'the koi pond is right of the flag too');
});

test('Sakura Garden: SAFE, the Moss Path left of the flag: nothing to carry, the fat of the green', () => {
  const id = 'sakura-garden';
  // short and left is on the path or beside it, never wet
  const g = newGame(id);
  const short = hit(g, WEDGE_SOFT, { aim: -7 });
  assert.ok(['fairway', 'rough'].includes(outcome(short)), `a soft wedge 7 degrees left is on ${outcome(short)}`);
  assert.ok(finish(g, 'safe and short') <= 4);
  assert.equal(outcome(hit(newGame(id), HALF, { aim: -7 })), 'fairway', 'a half wedge is on the Moss Path');
  for (const swing of [WEDGE, WEDGE_FIRM]) {
    const r = hit(newGame(id), swing, { aim: -7 });
    assert.equal(outcome(r), 'green', `${swing[0]} mph, 7 degrees left`);
    assert.ok(r.distToPinYd > 12 && r.distToPinYd < 24, `${r.distToPinYd} yd from the flag: a long putt`);
  }
  // the dry way in is mown from the foot of the hill to the green's edge
  const path = walk(id, [-10, 60], [-17, 106]);
  assert.ok(path.every((s) => s.kind === 'fairway' || s.kind === 'rough') && path.filter((s) => s.kind === 'fairway').reduce((m, s) => m + s.toM - s.fromM, 0) > 40);
  // an honest spray: the line at the flag costs water more often than the safe side does
  const at = (aims) => spray(id, { speeds: [84, 88, 92, 96], vla: 27, spin: 9000, aims, axes: [-8, 0, 8] });
  const hero = at(range(-6, 10, 2)), safe = at(range(-13, 3, 2));
  assert.ok(share(hero, 'green') >= 0.4, `hero line: ${JSON.stringify(hero)}`);
  assert.ok(share(hero, 'water') >= 0.1 && share(hero, 'water') <= 0.45, `the ponds are in play, not everywhere: ${JSON.stringify(hero)}`);
  assert.ok(share(safe, 'water') < share(hero, 'water'), `safe ${JSON.stringify(safe)} against hero ${JSON.stringify(hero)}`);
});

test('Sakura Garden: ROCKET, off the Great Falls; and every route in the strongest wind', (t) => {
  const id = 'sakura-garden';
  const { piece } = BUILT[id], top = piece.stage.wind.max;
  try {
    // the wind at its strongest, from every side: the flag and the safe side are both still on
    for (const rel of [0, 90, 180, 270]) {
      let g = newGame(id);
      windAt(g, rel, top);
      let r = hit(g, WEDGE_FIRM);
      assert.equal(r.penalty, 0, `a firm wedge at the flag stays dry in ${top} mph from ${rel} degrees`);
      assert.ok(r.distToPinYd < 20, `and finishes ${r.distToPinYd} yd from the flag on ${r.lie}`);
      g = newGame(id);
      windAt(g, rel, top);
      r = hit(g, WEDGE, { aim: -7 });
      assert.equal(r.penalty, 0, `the safe side stays dry in ${top} mph from ${rel} degrees`);
      assert.ok(['green', 'rough', 'fairway'].includes(r.lie) && r.distToPinYd < 28);
    }
    calm(id);
    // no ordinary wedge reaches the waterfall: the hardest of them is on the back of the green
    for (const swing of [WEDGE, WEDGE_FIRM, [100, 25, 8500]]) {
      const r = hit(newGame(id), swing);
      assert.ok(r.sim.carryYd < 148 && r.end.y < 134, `${swing[0]} mph carries ${r.sim.carryYd} yd`);
    }
    const mods = rocketMods();
    if (!mods) { t.diagnostic('lib/arcade.js has no Rocket to test with: skipped the rocket route'); return; }
    // any boosted wedge flies the pond and the green, hits the falls and comes down to the green
    for (const swing of [WEDGE_SOFT, [85, 29, 9000], WEDGE, WEDGE_FIRM]) {
      const g = newGame(id);
      const r = rocketHit(g, mods, swing);
      assert.ok(r.sim.carryYd > 152, `a Rocket ${swing[0]} mph wedge carries ${r.sim.carryYd} yd, into the cliff`);
      assert.equal(r.penalty, 0);
      assert.ok(r.lie === 'green' && r.distToPinYd < 12, `and comes down to the green, ${r.distToPinYd} yd from the flag (${r.lie})`);
      assert.ok(finish(g, `Rocket ${swing[0]}`) <= 3, 'a birdie putt, a par at worst');
    }
    // only the line matters: a little off it still feeds, well off it is rough at the cliff's foot
    for (const aim of [-4, -2, 2]) {
      const r = rocketHit(newGame(id), mods, WEDGE, { aim });
      assert.equal(r.penalty, 0);
      assert.ok(['green', 'fairway'].includes(r.lie) && r.distToPinYd < 16, `${aim} degrees off: ${r.distToPinYd} yd away on ${r.lie}`);
    }
    for (const aim of [-6, 4, 6]) assert.equal(rocketHit(newGame(id), mods, WEDGE, { aim }).penalty, 0, `${aim} degrees off the line is dry`);
    // and it works in the strongest wind from every side
    for (const rel of [0, 90, 180, 270]) {
      const g = newGame(id);
      windAt(g, rel, top);
      const r = rocketHit(g, mods, WEDGE);
      assert.equal(r.penalty, 0, `Rocket wedge, ${top} mph from ${rel} degrees`);
      assert.ok(r.distToPinYd < 27, `${r.distToPinYd} yd from the flag on ${r.lie}`);
    }
    calm(id);
    // (the cliff is a backboard for anything hit hard enough: an ordinary 7-iron comes back off it too)
    const iron = hit(newGame(id), IRON7);
    assert.ok(iron.penalty === 0 && iron.distToPinYd < 14, `a 7-iron at the flag comes back off the cliff to ${iron.distToPinYd} yd`);
  } finally { calm(id); }
});

// ---------------------------------------------------------------- Temple Run

test('Temple Run: a gorge, two rivers each with a ford, the green on the temple\'s first terrace', () => {
  const id = 'temple-run';
  const { course, piece, report } = BUILT[id];
  const hole = course.holes[0];
  const direct = yd(Math.hypot(hole.pin[0] - hole.tee[0], hole.pin[1] - hole.tee[1]));
  assert.ok(direct >= 520 && direct <= 530, `${direct.toFixed(0)} yd straight at the flag: a Rocket drive from the ledge gets there`);
  assert.deepEqual(hole.routes.map((r) => r.id), ['safe', 'risky', 'rocket']);
  assert.deepEqual(course.arcade.wind, piece.stage.wind);
  assert.ok(piece.stage.wind.max <= 12, 'a gorge is sheltered');
  // straight at the flag: fairway, river, the island, river, the forecourt, the sand under the stairs, green
  const line = walk(id, hole.tee, hole.pin);
  const crossings = line.filter((s) => s.kind === 'water');
  assert.equal(crossings.length, 2, 'two crossings on the direct line');
  assert.ok(yd(crossings[0].fromM) > 335, `the first river is ${yd(crossings[0].fromM).toFixed(0)} yd out: beyond a good drive, even from the ledge`);
  for (const c of crossings) assert.ok(yd(c.toM - c.fromM) >= 16 && yd(c.toM - c.fromM) <= 30, `a crossing ${yd(c.toM - c.fromM).toFixed(0)} yd wide`);
  assert.deepEqual(line.filter((s) => s.kind !== 'rough' && s.kind !== 'tee').map((s) => s.kind), ['fairway', 'water', 'fairway', 'water', 'fairway', 'bunker', 'green']);
  // SAFE: each river has a ford, a dry gap of mown ground 30 m and more wide, and the ramp climbs to the terrace:
  // from the drive to the green without once crossing water
  const way = [[-2, 220], [-30, 286], [-55, 328], [-40, 356], [8, 366], [44, 374], [58, 401], [58, 424], [70, 436], [80, 446], [84, 470], [64, 494], [34, 486]];
  let mownM = 0, totalM = 0;
  for (let i = 1; i < way.length; i++) {
    for (const s of walk(id, way[i - 1], way[i])) {
      assert.notEqual(s.kind, 'water', `the stepping-stone way is dry between (${way[i - 1]}) and (${way[i]})`);
      totalM += s.toM - s.fromM;
      if (s.kind === 'fairway' || s.kind === 'green') mownM += s.toM - s.fromM;
    }
  }
  assert.ok(mownM / totalM > 0.85, `and mown nearly all the way (${Math.round(100 * mownM / totalM)} %)`);
  const span = (y, x0, x1) => range(x0, x1, 0.5).filter((x) => SURFACE[id](x, y) !== 'water').length * 0.5;
  assert.ok(span(329, -80, -30) >= 30 && span(401, 34, 84) >= 30, 'the fords are 30 m and more wide');
  // landing zones 40 m wide and more: the drive (190 to 300 yd) and the island between the rivers
  const widthAt = (y) => {
    const xs = range(-80, 80, 0.5).filter((x) => SURFACE[id](x, y) === 'fairway');
    return xs.length ? xs[xs.length - 1] - xs[0] : 0;
  };
  for (const y of [175, 195, 215, 235, 255, 275]) assert.ok(widthAt(y) >= 44, `the drive's fairway is ${widthAt(y)} m wide at y ${y}`);
  for (const y of [352, 364, 376]) assert.ok(widthAt(y) >= 60, `the island is ${widthAt(y)} m wide at y ${y}`);
  assert.ok(course.surfaces.filter((s) => s.kind === 'bunker').length >= 6);
  // elevation: the ledge 34 m above the gorge floor, the green's terrace above the forecourt, the temple's above that, a peak behind
  const [stats] = report.stats.holes;
  assert.ok(stats.teeHeightM - heightAt(id, 0, 220) > 30, 'the tee is a ledge high on the gorge wall');
  assert.ok(stats.pinHeightM - heightAt(id, 12, 431) > 6 && heightAt(id, 12, 538) - stats.pinHeightM > 10, 'forecourt, green and temple on three terraces');
  assert.ok(heightAt(id, 12, 650) > 85 && heightAt(id, -220, 300) > 40 && heightAt(id, 226, 300) > 40, 'a peak behind the temple, gorge walls either side');
  assert.equal(heightAt(id, 8, 329), 0, 'the rivers are dead level');
  // the temple stands behind the green with a dragon on the mountain above it
  const temple = course.props.find((p) => p.kind === 'temple'), dragon = course.props.find((p) => p.kind === 'dragon');
  assert.ok(temple.y > hole.pin[1] + 40 && Math.abs(temple.x - hole.pin[0]) < 25, 'the temple is behind the green');
  assert.ok(dragon && dragon.y > temple.y && dragon.heightM >= 30, 'and the dragon above the temple');
  assert.ok(course.props.length >= 120 && course.props.length <= 250, `${course.props.length} props`);
  assert.ok(propCount(id, 'waterfall') >= 6 && propCount(id, 'giant-tree') >= 5 && propCount(id, 'idol') >= 8 && propCount(id, 'ruins') >= 6);
  assert.ok(propCount(id, 'torch') >= 14 && propCount(id, 'hut') >= 6 && propCount(id, 'bridge') >= 3 && propCount(id, 'boat') >= 3);
  assert.ok(propCount(id, 'crowd') >= 6 && propCount(id, 'jumbotron') === 1 && propCount(id, 'grandstand') === 1, 'the green is an event');
  assert.ok(course.trees.length >= 400, `${course.trees.length} jungle trees`);
});

test('Temple Run: SAFE, three sensible shots and a putt or two; or the stepping stones, never over water', () => {
  const id = 'temple-run';
  for (const [label, drive, second] of [
    ['drive, half wedge, wedge', DRIVE, [70, 32, 9000]],
    ['an average drive, 9-iron, wedge', [135, 13, 2800], [100, 23, 8500]],
    ['a 3-wood, wedge, wedge', WOOD, WEDGE],
    ['a weak drive, 7-iron, wedge', [120, 14, 3000], IRON7],
  ]) {
    const g = newGame(id);
    const d = hit(g, drive);
    assert.equal(outcome(d), 'fairway', `${label}: the drive finds the fairway`);
    assert.ok(d.end.y < 312, `${label}: the drive is short of the first river`);
    const lay = hit(g, second);
    assert.equal(outcome(lay), 'fairway', `${label}: the second finds the island`);
    assert.ok(lay.end.y > 340 && lay.end.y < 392 && lay.distToPinYd < 140, `${label}: laid up at ${lay.distToPinYd} yd`);
    const strokes = finish(g, label);
    assert.ok(strokes >= 3 && strokes <= 5, `${label}: home in ${strokes} (a par at worst)`);
  }
  // the stepping stones: ford to ford and up the ramp, with nothing longer than a wedge and never a carry
  const g = newGame(id);
  hit(g, [135, 13, 2800]);
  for (const [spot, swing] of [[[-52, 340], WEDGE_SOFT], [[8, 366], HALF], [[56, 394], HALF], [[80, 446], HALF], [[70, 488], HALF]]) {
    const r = hit(g, swing, { aim: aimTo(g, spot) });
    assert.equal(r.penalty, 0, `toward (${spot}): dry`);
    assert.ok(['fairway', 'rough', 'green'].includes(r.lie), `toward (${spot}): on ${r.lie}`);
    if (r.lie === 'green') break;
  }
  assert.ok(finish(g, 'the stepping stones') <= 8, 'home without a penalty by the fords');
});

test('Temple Run: RISKY in two, ROCKET in one', (t) => {
  const id = 'temple-run';
  // a good drive and a fairway wood carry both rivers and climb onto the terrace: on in two
  const g = newGame(id);
  const d = hit(g, DRIVE);
  assert.ok(d.distToPinYd > 195 && d.distToPinYd < 230, `${d.distToPinYd} yd left after the drive`);
  const wood = hit(g, WOOD);
  assert.equal(wood.penalty, 0);
  assert.ok(wood.holed || wood.lie === 'green', `on the green in two (${wood.lie})`);
  assert.ok(finish(g, 'in two') <= 4, 'an eagle or a birdie');
  // not enough club is under the stairs, in the sand: no way up but a bunker shot
  const g2 = newGame(id);
  hit(g2, DRIVE);
  const iron = hit(g2, IRON5);
  assert.equal(iron.penalty, 0);
  assert.ok(['bunker', 'fairway', 'rough'].includes(iron.lie) && iron.distToPinYd < 45 && iron.end.y < 462, `a 5-iron is short of the terrace on ${iron.lie}`);
  // far too little is in the second river: a stroke, dropped on the island
  const g3 = newGame(id);
  hit(g3, DRIVE);
  const greedy = hit(g3, [100, 23, 8500]);
  assert.equal(outcome(greedy), 'water');
  assert.equal(g3.strokes, 3);
  assert.ok(greedy.end.y < 394 && greedy.end.y > 340, 'dropped on the island');
  assert.ok(finish(g3, 'after the river') <= 6);
  // an average drive leaves too much: the wood from there is short of the terrace
  const g4 = newGame(id);
  hit(g4, [135, 13, 2800]);
  const far = hit(g4, WOOD);
  assert.ok(!far.holed && far.lie !== 'green', `from ${g4.distToPinYd.toFixed(0)} yd out the wood finishes on ${far.lie}`);

  // a Rocket ball (lib/arcade.js) reaches in one; the same swing without it does not
  const mods = rocketMods();
  if (!mods) { t.diagnostic('lib/arcade.js has no Rocket to test with: skipped that part'); return; }
  try {
    for (const speed of [145, 150]) {
      const g5 = newGame(id);
      const r = rocketHit(g5, mods, [speed, 12, 2500]);
      assert.ok(r.sim.carryYd > 500, `a Rocket ${speed} mph drive carries ${r.sim.carryYd} yd`);
      assert.equal(r.penalty, 0);
      assert.ok(r.holed || r.lie === 'green', `and finishes on the green (${r.lie}, ${r.distToPinYd} yd away)`);
      assert.ok(finish(g5, `Rocket ${speed}`) <= 3, 'an eagle putt');
    }
    // a little less swing is short of the terrace (in the sand, or on the forecourt), over both rivers and dry
    for (const swing of [[135, 13, 2800], [120, 14, 3000]]) {
      const r = rocketHit(newGame(id), mods, swing);
      assert.equal(r.penalty, 0, `a Rocket ${swing[0]} mph drive is dry`);
      assert.ok(r.end.y > 410 && r.distToPinYd < 80, `and ${r.distToPinYd} yd from the flag on ${r.lie}`);
    }
    // the strongest wind the gorge gets, dead against: the 150 mph Rocket still reaches the terrace
    const g6 = newGame(id);
    windAt(g6, 0, BUILT[id].piece.stage.wind.max);
    const head = rocketHit(g6, mods, DRIVE);
    assert.equal(head.penalty, 0);
    assert.ok(head.distToPinYd < 30 && head.end.y > 458, `into the wind: ${head.distToPinYd} yd from the flag on ${head.lie}`);
  } finally { calm(id); }
});

test('Temple Run: a wide drive finds rough or sand, never a river or the jungle line; and the wind does not change that', () => {
  const id = 'temple-run';
  const tally = spray(id, { speeds: [125, 135, 145, 150, 155], vla: 12, spin: 2600, aims: range(-12, 12, 3), axes: [-15, 0, 15] });
  assert.equal((tally.water || 0) + (tally.ob || 0), 0, `no penalty off the tee: ${JSON.stringify(tally)}`);
  assert.ok(share(tally, 'fairway') >= 0.3, JSON.stringify(tally));
  const straight = spray(id, { speeds: [125, 135, 145, 150, 155], vla: 12, spin: 2600, aims: range(-4, 4, 2), axes: [0] });
  assert.ok(share(straight, 'fairway') >= 0.8, `a straight drive is on the fairway: ${JSON.stringify(straight)}`);
  // the strongest wind from every side: the drive is still free, and each route still has its second shot
  const top = BUILT[id].piece.stage.wind.max;
  try {
    for (const [rel, layUp] of [[0, IRON7], [90, [100, 23, 8500]], [180, WEDGE_SOFT], [270, [100, 23, 8500]]]) {
      for (const speed of [135, 150, 155]) {
        const g = newGame(id);
        windAt(g, rel, top);
        const r = hit(g, [speed, 12, 2500]);
        assert.equal(r.penalty, 0, `${speed} mph in ${top} mph from ${rel} degrees: ${r.note}`);
        assert.ok(['fairway', 'rough'].includes(r.lie));
      }
      // safe: an average drive, a lay-up on the island, a wedge on
      const g = newGame(id);
      windAt(g, rel, top);
      hit(g, [135, 13, 2800]);
      const lay = hit(g, layUp);
      assert.equal(outcome(lay), 'fairway', `the lay-up in ${top} mph from ${rel} degrees finds ${outcome(lay)}`);
      assert.ok(lay.end.y > 340 && lay.end.y < 392);
      assert.ok(finish(g, `safe, wind from ${rel}`) <= 5);
      // risky: after a good drive the wood still clears both rivers
      const g2 = newGame(id);
      windAt(g2, rel, top);
      hit(g2, DRIVE);
      const wood = hit(g2, WOOD);
      assert.equal(wood.penalty, 0, `the wood in ${top} mph from ${rel} degrees is dry (${wood.lie}, ${wood.distToPinYd} yd left)`);
      assert.ok(wood.distToPinYd < 45);
    }
  } finally { calm(id); }
});

// ---------------------------------------------------------------- Bullseye Bay


test('Bullseye Bay: an island bullseye in a caldera, the tee on its rim, the whole target in view', () => {
  const id = 'bullseye-bay';
  const { course, report, piece } = BUILT[id];
  const hole = course.holes[0], [stats] = report.stats.holes, pin = hole.pin;
  const g = newGame(id), { caldera } = piece;
  assert.ok(report.stats.sea && report.stats.sea.frac > 0.3, 'a bay of open sea');
  assert.ok(Math.abs(stats.greenM[0] - stats.greenM[1]) < 1, 'the green is round');
  const green = course.surfaces.find((s) => s.kind === 'green').poly;
  const [cx, cy] = L.centroid(green);
  assert.ok(Math.hypot(cx - pin[0], cy - pin[1]) < 0.5, 'the flag is dead centre');
  // the rings: concentric on the flag, inside the green, heightM their diameter
  const rings = course.props.filter((p) => p.kind === 'target-ring');
  assert.ok(rings.length >= 4, `${rings.length} target rings`);
  for (const r of rings) {
    assert.deepEqual([r.x, r.y], pin, 'a ring is centred on the flag');
    assert.ok(r.heightM <= stats.greenM[0], `a ring ${r.heightM} m across lies inside the green`);
  }
  assert.equal(new Set(rings.map((r) => r.heightM)).size, rings.length, 'every ring its own size');
  assert.ok(Math.min(...rings.map((r) => r.heightM)) <= 6 && Math.max(...rings.map((r) => r.heightM)) >= 30);
  // every way out from the flag: green, a fringe, the beach (sand), then the bay
  for (let a = 0; a < 360; a += 5) {
    const far = [pin[0] + 48 * Math.cos(a * Math.PI / 180), pin[1] + 48 * Math.sin(a * Math.PI / 180)];
    const kinds = walk(id, pin, far).map((s) => s.kind);
    assert.deepEqual(kinds, ['green', 'rough', 'bunker', 'water'], `at ${a} degrees`);
  }
  // nothing between the tee and the target but the cliff and the water: no tree near the line, no prop on it but the rings
  const line = walk(id, hole.tee, pin).map((s) => s.kind);
  assert.deepEqual(line.filter((k) => k !== 'rough'), ['tee', 'water', 'bunker', 'green'], line.join(' '));
  for (const [x, y] of course.trees) assert.ok(L.distToSegment(x, y, hole.tee[0], hole.tee[1], pin[0], pin[1]) > 40, 'trees stand well clear');
  for (const p of course.props) {
    if (L.FLAT_PROP_KINDS.includes(p.kind) || L.FLOATING_PROP_KINDS.includes(p.kind)) continue;
    const off = L.distToSegment(p.x, p.y, hole.tee[0], hole.tee[1], pin[0], pin[1]);
    assert.ok(off > 5, `${p.id} is off the line`);
    if (p.y > 30 && p.y < pin[1]) assert.ok(off > 30, `${p.id} does not stand between the tee and the green`);
    // nothing tall beside the ball: the camera looks straight down the line at the island
    assert.ok(Math.abs(p.x) >= 12 || p.y > 30 || p.y < -15, `${p.id} does not stand in the view from the tee`);
  }
  // the tee: a ledge on the rim 25 to 40 m above the water, the lip just in front of the ball, and the
  // whole island (flag, green, the beach in front) in plain view of the address camera
  assert.ok(stats.teeHeightM >= 25 && stats.teeHeightM <= 40, `the tee is ${stats.teeHeightM} m above the sea`);
  assert.ok(g.terrain.h(0, 6) < stats.teeHeightM - 8, 'the cliff drops away right in front of the tee');
  assert.ok(teeCameraClearance(g, pin[0], pin[1]) > 0.25, 'the flag is in view from the tee');
  for (let a = 0; a < 360; a += 30) {
    const [x, y] = [pin[0] + 19 * Math.cos(a * Math.PI / 180), pin[1] + 19 * Math.sin(a * Math.PI / 180)];
    assert.ok(teeCameraClearance(g, x, y) > 0.25, `the edge of the green at ${a} degrees is in view from the tee`);
  }
  assert.ok(teeCameraClearance(g, 0, pin[1] - 30) > 0.25, 'so is the beach in front of it');
  // the caldera: a wall of real ground all the way round but for the mouth, which is open sea
  const turn = (a, b) => ((a - b + 540) % 360) - 180;
  for (let deg = -180; deg < 180; deg += 10) {
    const mouth = Math.abs(turn(deg, caldera.mouthDeg));
    if (mouth > 45) assert.ok(g.terrain.h(...caldera.at(deg, 36)) > 22, `the wall at ${deg} degrees stands ${g.terrain.h(...caldera.at(deg, 36)).toFixed(0)} m`);
    if (mouth < 20) assert.equal(g.surfaceAt(...caldera.at(deg, 30)), 'water', `the mouth is open at ${deg} degrees`);
  }
  assert.ok(g.terrain.h(...caldera.at(47, 50)) > 50 && g.terrain.h(...caldera.at(134, 50)) > 45, 'a horn either side of the mouth');
  const el = course.elevation;
  assert.ok(Math.max(...el.heights) - Math.min(...el.heights) > 55, 'real relief');
  // the village terrace in the west cove and the spectators' terrace in the east wall: level, dry ground
  const village = caldera.cove(183, 24), terrace = caldera.at(-4, 17);
  assert.ok(g.terrain.h(...village) > 3.5 && g.terrain.h(...village) < 6 && g.surfaceAt(...village) === 'rough');
  assert.ok(Math.abs(g.terrain.h(...terrace) - caldera.benchH) < 1 && g.surfaceAt(...terrace) === 'rough');
  // the scene: a village, a gallery, a fleet, falls, a light on the headland
  const count = (kind, where = () => true) => course.props.filter((p) => p.kind === kind && where(p)).length;
  const inCove = (p) => p.x < -60 && Math.abs(p.y - 105) < 70;
  assert.ok(course.props.length >= 150 && course.props.length <= 300, `${course.props.length} props`);
  assert.ok(count('hut', inCove) >= 6 && count('tiki', inCove) >= 6 && count('crowd', inCove) >= 3 && count('palm', inCove) >= 8, 'the beach village');
  assert.ok(count('crowd', (p) => p.x > 100) >= 4 && count('flag-banner', (p) => p.x > 100) >= 5, 'the terrace in the east wall');
  assert.ok(count('boat') >= 15 && count('boat', (p) => g.surfaceAt(p.x, p.y) !== 'water') === 0, 'a fleet, afloat');
  assert.ok(count('boat', (p) => Math.hypot(p.x - pin[0], p.y - pin[1]) < 80) >= 10, 'moored round the island');
  assert.ok(count('waterfall') >= 3 && count('lighthouse') === 1 && count('shipwreck') === 1 && count('palm') >= 40 && count('bird-flock') >= 3 && count('balloon') >= 3);
});

test('Bullseye Bay: stock wedges hold the green, a near miss is sand, a bad miss is wet, the wind is a read', () => {
  const id = 'bullseye-bay';
  const SAND = [78, 29, 10000], LOB = [68, 32, 10500], PITCH = [91, 25.5, 9300];   // the game's stock wedges
  // 115 yd that plays two clubs less: the sand wedge is the club, the lob wedge and a soft pitching wedge hold the green too
  for (const [name, swing, within] of [['a sand wedge', SAND, 8], ['a lob wedge', LOB, 18], ['a soft pitching wedge', [82, 25.5, 9300], 14], ['an 80 mph wedge', WEDGE_SOFT, 10]]) {
    const r = hit(newGame(id), swing);
    assert.ok(r.holed || r.lie === 'green', `${name} at the flag is on the green (${outcome(r)})`);
    assert.equal(r.penalty, 0);
    assert.ok(r.distToPinYd < within, `${name}: ${r.distToPinYd} yd`);
  }
  // too much club, or wide of the green: the beach, which still counts as land
  assert.equal(outcome(hit(newGame(id), PITCH)), 'bunker', 'a full pitching wedge is on the back beach');
  assert.equal(outcome(hit(newGame(id), SAND, { aim: 12 })), 'bunker');
  assert.equal(outcome(hit(newGame(id), HALF)), 'bunker', 'half a swing is on the front beach');
  // a shank, a duff or far too much club is in the bay
  assert.equal(outcome(hit(newGame(id), SAND, { aim: 22 })), 'water');
  const duff = hit(newGame(id), [45, 34, 8000]);
  assert.equal(outcome(duff), 'water');
  assert.ok(duff.end.y < 25, 'dropped back on the tee');
  assert.equal(outcome(hit(newGame(id), IRON7)), 'water');
  // a spray of wedges: mostly green, nearly all on land, some of it wet
  const tally = spray(id, { speeds: [68, 72, 76, 80, 84, 88], vla: 29, spin: 9500, aims: range(-12, 12, 2), axes: [-12, 0, 12] });
  assert.ok(share(tally, 'green') >= 0.55, JSON.stringify(tally));
  assert.ok(share(tally, 'green', 'bunker', 'rough') >= 0.9, JSON.stringify(tally));
  assert.ok((tally.water || 0) >= 1, 'the bay is in play');
  assert.equal(tally.ob || 0, 0);
  // the wind (stage.wind, 4 to 12 mph): at its strongest, from any quarter, the stock sand wedge still
  // finds the green unadjusted, and a sensible adjustment gets it close
  const { wind } = BUILT[id].piece.stage;
  assert.deepEqual(wind, { min: 4, max: 12 });
  const g = newGame(id);
  try {
    for (const windFromDeg of [0, 45, 90, 180, 225, 270]) {
      g.setConditions({ windMph: wind.max, windFromDeg });
      g.reset();
      const plain = hit(g, SAND);
      assert.equal(outcome(plain), 'green', `a stock sand wedge in ${wind.max} mph from ${windFromDeg}`);
      let best = Infinity;
      for (const swing of [SAND, [70, 29, 10000], [86, 29, 10000], LOB, PITCH]) for (let aim = -8; aim <= 8; aim += 2) {
        g.reset();
        const r = hit(g, swing, { aim });
        if (!r.penalty && r.lie === 'green') best = Math.min(best, r.distToPinYd);
      }
      assert.ok(best < 6, `allowing for ${wind.max} mph from ${windFromDeg}: ${best} yd`);
    }
  } finally { g.setConditions({ windMph: 0, windFromDeg: 0 }); }
  // a ball on the beach is playable: out of the sand and onto the green
  const sand = newGame(id);
  hit(sand, SAND, { aim: 12 });
  assert.ok(finish(sand, 'from the beach') <= 4);
});

// ---------------------------------------------------------------- the catalogue

test('the catalogue discovers all three holes as stages', (t) => {
  let courses;
  try { courses = require('../tools/arcade-holes/courses'); } catch (error) { t.skip(`tools/arcade-holes/courses.js does not load: ${error.message}`); return; }
  for (const id of IDS) {
    const built = courses.buildCourse(id);
    assert.deepEqual(built.course.holes, BUILT[id].course.holes, `${id}: the catalogue builds the same hole`);
    assert.deepEqual(built.course.arcade, BUILT[id].course.arcade, `${id}: and the same stage`);
    assert.equal(built.course.source.osmId, 9900000000000 + SPEC[id].number);
  }
});
