// v3:living The living world (docs/living-world.md): what a stage's `life` may say, where its
// movers are at a time, what the graphics level and the "World life" setting leave on, and
// the reaction bus (which beat answers which game event, and never two at once).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  LIFE_KINDS, LIFE_MODES, WEATHER_TYPES, BIRD_SPECIES, LINE_CLEAR_M, REACTIONS, REACTION_TYPES, LIVING_CUES, PLAYER_COLORS, SCATTER_S, FISH_JUMP_S, CUP_HOLD_S, WORLD_CLOCK,
  parseLifeMode, normalizeLife, validateLife, lifeBudget, lifeVisible, measurePath, densifyPath, pathAt, moverPose, orbitPose, flockPose, perchPose, scatterEnvelope,
  fishJump, dolphinArc, whaleShow, trafficLight, windDrive, windmillRate, worldClockTime, ReactionBus, shotReactions, flightSamples, matchReactions, matchLeader, reactionPlan, beatCue, beatColors, hash01,
} from '../public/render/world-life.js';
import { buildLifeModel, LIFE_MODEL_KINDS, makeLifeMaterial } from '../public/render/world-models.js';
import { WorldEvents, measureDragon, DRAGON_NECK, GLB_MOVERS } from '../public/render/world-events.js';
import { BURST_SLOTS, BURST_KINDS, WEATHER, EMIT_MODES, BurstPool, pxPerMetre } from '../public/render/world-fx.js';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const holesDir = path.join(root, 'tools', 'arcade-holes', 'holes');
const STAGES = fs.readdirSync(holesDir).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).sort();
const ARENAS = ['bullseye-bay', 'thunder-dome', 'ice-pick'];
const lifeTools = require('../tools/arcade-holes/life.js');
const piece = (id) => require(path.join(holesDir, `${id}.js`));
const stageOf = (id) => {
  const p = piece(id), line = p.hole.line;
  return { id, piece: p, life: lifeTools.lifeOf(p), tee: line[0], pin: line[line.length - 1], theme: p.stage.theme, timeOfDay: p.stage.timeOfDay || 'day' };
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------- the data
test('every kind of life is described, and the layer knows how to draw each', () => {
  for (const [kind, K] of Object.entries(LIFE_KINDS)) {
    assert.ok(['path', 'orbit', 'point', 'area', 'points', 'stage'].includes(K.shape), `${kind}: shape`);
    assert.ok(['vehicle', 'creature', 'character', 'weather', 'set'].includes(K.group), `${kind}: group`);
    assert.ok(K.tier === 0 || K.tier === 1, `${kind}: tier`);
    assert.equal(typeof K.calm, 'boolean', `${kind}: calm`);
    assert.equal(typeof WorldEvents.prototype[`_plan_${kind.replace(/-/g, '_')}`], 'function', `${kind}: world-events.js has no _plan_ for it`);
  }
  // weather and flocks are what "calm" takes out; the big characters are what Low keeps
  for (const k of ['weather', 'flock', 'shooting-stars']) assert.equal(LIFE_KINDS[k].calm, false);
  for (const k of ['dragon', 'volcano', 'beam', 'windmill', 'airship']) assert.equal(LIFE_KINDS[k].tier, 0);
  assert.deepEqual(LIFE_MODES, ['full', 'calm', 'off']);
  assert.equal(parseLifeMode('CALM'), 'calm');
  assert.equal(parseLifeMode('nonsense'), 'full');
  assert.equal(parseLifeMode(null), 'full');
  assert.deepEqual(PLAYER_COLORS, { 1: '#ff5a36', 2: '#2e9bff' });
});

test('an entry is made regular, and one nothing can be drawn from is refused', () => {
  const out = normalizeLife([
    { kind: 'boat', path: [[0, 0], [10, 0]] },
    { kind: 'boat', path: [[0, 0]] },                 // one point is no path
    { kind: 'flock', x: 1, y: 2 },
    { kind: 'flock', x: 'a', y: 2 },
    { kind: 'weather', type: 'snow' },
    { kind: 'weather', type: 'frogs' },
    { kind: 'unicorn', x: 0, y: 0 },
    null,
  ]);
  assert.deepEqual(out.map((e) => e.kind), ['boat', 'flock', 'weather']);
  assert.equal(out[0].loop, 'wrap');
  assert.equal(out[0].speed, LIFE_KINDS.boat.speed);
  assert.equal(out[1].species, 'crow');
  assert.equal(out[1].r, 40);
  assert.equal(out[1].lift, LIFE_KINDS.flock.lift);
  assert.deepEqual(normalizeLife(undefined), []);
});

test('validateLife: what flies keeps off the line of play, and a pale bird furthest of all', () => {
  const hole = { tee: [0, 0], pin: [0, 200] };
  assert.deepEqual(validateLife([{ kind: 'flock', species: 'crow', x: 80, y: 100, r: 20 }], hole), []);
  assert.match(validateLife([{ kind: 'flock', species: 'crow', x: 40, y: 100, r: 20 }], hole)[0], /within 20 m of the line of play \(28 m/);
  // a gull is the one thing that could be taken for a ball: 60 m
  assert.match(validateLife([{ kind: 'flock', species: 'gull', x: 70, y: 100, r: 20 }], hole)[0], /pale bird/);
  assert.deepEqual(validateLife([{ kind: 'flock', species: 'gull', x: 90, y: 100, r: 20 }], hole), []);
  // high enough, a flyer may cross the hole
  assert.deepEqual(validateLife([{ kind: 'balloon', path: [[-100, 100], [100, 100]], lift: 80 }], hole), []);
  assert.equal(validateLife([{ kind: 'balloon', path: [[-100, 100], [100, 100]], lift: 30 }], hole).length, 1);
  // what walks or sails keeps 10 m off, or says it crosses, and then never near the tee or the pin
  assert.equal(validateLife([{ kind: 'walkers', path: [[-50, 100], [50, 100]] }], hole).length, 1);
  assert.deepEqual(validateLife([{ kind: 'walkers', path: [[-50, 100], [50, 100]], crossing: true }], hole), []);
  assert.match(validateLife([{ kind: 'walkers', path: [[-50, 20], [50, 20]], crossing: true }], hole)[0], /45 m at least/);
  // the plain mistakes
  const bad = validateLife([{ kind: 'unicorn' }, { kind: 'boat', path: [[0, 0]] }, { kind: 'weather', type: 'snow' }, { kind: 'weather', type: 'ash' }, { kind: 'cars', path: [[90, 0], [90, 9]], count: 0 }, { kind: 'boat', path: [[90, 0], [90, 9]], speed: -3 }, { kind: 'flock', species: 'dodo', x: 300, y: 0 }], hole);
  assert.equal(bad.length, 6);
  assert.match(bad[0], /unknown kind/);
  assert.match(bad[2], /one weather/);
  // something that circles may go the other way round
  assert.deepEqual(validateLife([{ kind: 'airship', x: 0, y: 100, r: 150, lift: 100, speed: -5 }], hole), []);
  assert.deepEqual(validateLife(undefined, hole), []);
  assert.deepEqual(validateLife('x', hole), ['life must be an array']);
  assert.equal(LINE_CLEAR_M.white > LINE_CLEAR_M.air && LINE_CLEAR_M.air > LINE_CLEAR_M.ground, true);
});

test('all fifteen stages have a considered cast, and every entry keeps the rules', () => {
  assert.equal(STAGES.length, 15);
  for (const id of STAGES) {
    const st = stageOf(id);
    assert.ok(Array.isArray(st.life) && st.life.length >= 6, `${id}: a stage has at least six entries (${st.life.length})`);
    assert.deepEqual(validateLife(st.life, { tee: st.tee, pin: st.pin }), [], `${id}: life`);
    const kinds = new Set(st.life.map((e) => e.kind));
    // each world has something that moves by itself and something for a great shot to set off
    assert.ok(st.life.some((e) => ['vehicle', 'creature'].includes(LIFE_KINDS[e.kind].group)), `${id}: nothing moves`);
    assert.ok(kinds.has('dragon') || kinds.has('volcano') || kinds.has('signature') || kinds.has('airship') || kinds.has('pennants'), `${id}: nothing answers a great shot`);
    // its weather is the theme's
    const w = st.life.find((e) => e.kind === 'weather');
    if (st.theme === 'alpine') assert.equal(w && w.type, 'snow', `${id}: alpine stages snow`);
    if (st.theme === 'volcano') assert.equal(w && w.type, 'ash', `${id}: ash at the volcano`);
    if (st.theme === 'desert') assert.equal(w && w.type, 'sand', `${id}: blowing sand`);
    // moved into the course with its piece
    const moved = lifeTools.placeLife(st.life, 100, 50, 7);
    st.life.forEach((e, i) => {
      if (Number.isFinite(e.x)) assert.ok(near(moved[i].x, e.x + 100, 0.006), `${id}: x moves`);
      if (Array.isArray(e.path)) assert.ok(near(moved[i].path[0][1], e.path[0][1] + 50, 0.006), `${id}: a path moves`);
      if (Number.isFinite(e.z)) assert.ok(near(moved[i].z, e.z + 7, 0.006), `${id}: z moves`);
    });
  }
  // the stages that have a dragon have a dragon that watches the ball
  for (const id of ['dragons-spine', 'ice-pick', 'volcano-drop', 'temple-run']) {
    const st = stageOf(id), d = st.life.find((e) => e.kind === 'dragon');
    assert.ok(d, `${id}: the dragon`);
    assert.ok((st.piece.props || []).some((p) => p.kind === 'dragon' && Math.hypot(p.x - d.x, p.y - d.y) < 12), `${id}: the dragon stands where the stage's dragon prop stands`);
  }
  // the arenas decide matches: they get the showiest pieces
  for (const id of ARENAS) {
    const kinds = new Set(stageOf(id).life.map((e) => e.kind));
    assert.ok(kinds.has('airship') || kinds.has('dragon'), `${id}: an arena has an airship or a dragon`);
  }
  const neon = new Set(stageOf('midnight-mile').life.map((e) => e.kind));
  for (const k of ['train', 'cars', 'traffic-light', 'searchlight', 'shooting-stars']) assert.ok(neon.has(k), `midnight-mile: ${k}`);
  assert.ok(stageOf('pharaohs-gate').life.some((e) => e.kind === 'caravan'));
  assert.ok(stageOf('sakura-garden').life.some((e) => e.kind === 'koi'));
  assert.ok(stageOf('lighthouse-point').life.some((e) => e.kind === 'beam'));
});

// ---------------------------------------------------------------- where things are
test('a path mover is where the clock says, the same every time', () => {
  const m = measurePath([[0, 0], [100, 0], [100, 50]]);
  assert.equal(m.total, 150);
  assert.deepEqual(pathAt(m, 50), { x: 50, y: 0, hx: 1, hy: 0, i: 0, f: 0.5 });
  assert.equal(pathAt(m, 125).x, 100);
  assert.equal(pathAt(m, 125).y, 25);
  assert.equal(pathAt(m, 1e6).y, 50);
  assert.equal(densifyPath([[0, 0], [100, 0]], 8).length, 14);
  const e = { loop: 'wrap', speed: 5, count: 1 };
  assert.deepEqual(moverPose(m, e, 0, 12.5), moverPose(m, e, 0, 12.5));
  // it travels at its speed
  const a = moverPose(m, e, 0, 4), b = moverPose(m, e, 0, 5);
  assert.ok(near(Math.hypot(b.x - a.x, b.y - a.y), 5, 1e-9));
  // wrap: it grows in at one end, away at the other, and is out of sight for the gap
  assert.equal(moverPose(m, e, 0, 0).vis, 0);
  assert.equal(moverPose(m, e, 0, 15).vis, 1);
  assert.ok(moverPose(m, e, 0, 29.9).vis < 0.1);
  const g = { loop: 'wrap', speed: 5, count: 1, gapS: 10 };
  assert.equal(moverPose(m, g, 0, 35).vis, 0);            // 175 m along a 150 m path: in the gap
  assert.ok(moverPose(m, g, 0, 43).vis > 0);              // round again (the run is 200 m)
  // pingpong: there and back, turned round
  const p = { loop: 'pingpong', speed: 10, count: 1 };
  assert.equal(moverPose(m, p, 0, 5).hx, 1);
  const back = moverPose(m, p, 0, 25);                     // 250 m: 100 m back from the far end
  assert.equal(back.back, true);
  assert.ok(near(back.x, 50) && near(back.y, 0));
  assert.ok(near(back.hx, -1), 'it faces the way it is going');
  // ring: continuous through the join
  const ring = measurePath([[0, 0], [10, 0], [10, 10], [0, 10]], true);
  assert.equal(ring.total, 40);
  const r0 = moverPose(ring, { speed: 1, count: 1 }, 0, 39.999), r1 = moverPose(ring, { speed: 1, count: 1 }, 0, 40.001);
  assert.ok(Math.hypot(r0.x - r1.x, r0.y - r1.y) < 0.01);
  // a train's cars are nose to tail, in order
  const tr = { loop: 'wrap', speed: 16, count: 3, spacingM: 14 };
  const c0 = moverPose(m, tr, 0, 4), c1 = moverPose(m, tr, 1, 4);
  assert.ok(near(c0.x - c1.x, 14));
});

test('what circles, wheels, leaps and blows is a function of the time', () => {
  const o = orbitPose({ x: 10, y: 20, r: 50, speed: 5, count: 2 }, 0, 7);
  assert.ok(near(Math.hypot(o.x - 10, o.y - 20), 50, 1e-9));
  assert.ok(near(o.hx * (o.x - 10) + o.hy * (o.y - 20), 0, 1e-9), 'it heads along the circle');
  const o2 = orbitPose({ x: 10, y: 20, r: 50, speed: 5, count: 2 }, 1, 7);
  assert.ok(near(o.x + o2.x, 20, 1e-9), 'two copies are opposite each other');
  // a flock stays inside its reach; frightened, it goes wider and higher and comes home
  const f = { x: 0, y: 0, r: 30, lift: 34, count: 9, speed: 7, seed: 4 };
  for (let i = 0; i < 9; i++) {
    const calm = flockPose(f, i, 12.3);
    assert.ok(Math.hypot(calm.x, calm.y) <= 30 + 1e-9);
    assert.ok(calm.lift > 25 && calm.lift < 43);
    const scared = flockPose(f, i, 12.3, 2, [1, 0]);
    assert.ok(scared.lift > calm.lift + 10);
    assert.deepEqual(flockPose(f, i, 12.3, SCATTER_S + 1, [1, 0]), calm);
  }
  assert.equal(scatterEnvelope(0), 0);
  assert.equal(scatterEnvelope(2), 1);
  assert.equal(scatterEnvelope(SCATTER_S), 0);
  assert.equal(scatterEnvelope(-1), 0);
  // a perched bird sits until something frightens it
  const sit = perchPose([5, 6, 3], 0, 2);
  assert.equal(sit.x, 5); assert.equal(sit.y, 6); assert.equal(sit.flap, 0);
  const up = perchPose([5, 6, 3], 0, 2, 1.5, [0, 1]);
  assert.ok(up.lift > 5 && up.flap === 1);
  // a fish is in the air for under a second of its cycle, somewhere in its pond
  const pond = { x: 0, y: 0, r: 10, count: 2, everyS: 8, seed: 3 };
  let air = 0;
  for (let t = 0; t < 80; t += 0.05) { const j = fishJump(pond, 0, t); if (j.up) { air++; assert.ok(Math.hypot(j.x, j.y) <= 10 + 1.7); assert.ok(j.h <= 1.1 + 1e-9 && j.h >= -0.16); } }
  assert.ok(near(air * 0.05, (80 / 8) * FISH_JUMP_S, 0.6));
  assert.equal(dolphinArc(0.25).up, true);
  assert.equal(dolphinArc(0.75).up, false);
  assert.ok(dolphinArc(0.25, 2).h > 1.7);
  const w = { everyS: 30 };
  assert.equal(whaleShow(w, 0.2).blow, true);
  assert.equal(whaleShow(w, 5).tail, 1);
  assert.equal(whaleShow(w, 15).tail, 0);
  assert.equal(whaleShow(w, 31).cycle, 1);
  const seen = new Set();
  for (let t = 0; t < 16; t += 0.5) seen.add(trafficLight(t, 0, 16));
  assert.deepEqual([...seen].sort(), ['amber', 'green', 'red']);
  assert.equal(hash01(3, 4, 5), hash01(3, 4, 5));
  assert.ok(hash01(1, 2) >= 0 && hash01(1, 2) < 1);
});

test('the windmill and the flags answer the wind the hole really has', () => {
  assert.equal(windDrive(0), 0);
  assert.equal(windDrive(10), 0.5);
  assert.equal(windDrive(40), 1);
  assert.equal(windDrive(undefined), 0);
  assert.ok(windmillRate(0) > 0, 'it idles in a calm');
  assert.ok(windmillRate(15) > windmillRate(5) && windmillRate(5) > windmillRate(0));
  assert.equal(windmillRate(20), windmillRate(35));
});

test('the world clock is off unless asked for, and then runs one day through a match', () => {
  for (let i = 0; i < 9; i++) assert.equal(worldClockTime(i, 9, false), null);
  const day = Array.from({ length: 9 }, (_, i) => worldClockTime(i, 9, true));
  assert.equal(day[0], 'day');
  assert.equal(day[8], 'night');
  assert.ok(day.includes('golden') && day.includes('dusk'));
  for (let i = 1; i < 9; i++) assert.ok(WORLD_CLOCK.indexOf(day[i]) >= WORLD_CLOCK.indexOf(day[i - 1]), 'the day never runs backwards');
  assert.deepEqual([0, 1, 2].map((i) => worldClockTime(i, 3, true)), ['day', 'golden', 'night']);
  assert.equal(worldClockTime(-1, 9, true), null);
});

// ---------------------------------------------------------------- quality and the setting
test('Low draws the essentials, calm the slow and the far, off nothing', () => {
  const full = lifeBudget('high', 'full'), low = lifeBudget('low', 'full'), ultra = lifeBudget('ultra', 'full'), calm = lifeBudget('high', 'calm'), off = lifeBudget('high', 'off');
  assert.equal(off.on, false);
  assert.equal(off.weather, 0);
  assert.equal(off.reactions, 'none');
  assert.ok(low.weather < full.weather && full.weather < ultra.weather);
  assert.ok(low.bursts < full.bursts);
  assert.ok(low.countMul < full.countMul && full.countMul < ultra.countMul);
  assert.equal(calm.weather, 0);
  assert.equal(calm.reactions, 'key');
  assert.equal(full.reactions, 'all');
  const seen = (kind, b) => lifeVisible({ kind }, b);
  for (const k of ['dragon', 'volcano', 'windmill', 'beam', 'airship', 'weather', 'pennants', 'cable-car']) assert.equal(seen(k, low), true, `${k} on Low`);
  for (const k of ['boat', 'train', 'cars', 'walkers', 'fish', 'koi', 'fireflies', 'searchlight', 'caravan']) assert.equal(seen(k, low), false, `${k} not on Low`);
  for (const k of ['boat', 'train', 'dragon', 'koi', 'windmill', 'caravan']) assert.equal(seen(k, calm), true, `${k} in calm`);
  for (const k of ['weather', 'flock', 'shooting-stars']) assert.equal(seen(k, calm), false, `${k} not in calm`);
  for (const k of Object.keys(LIFE_KINDS)) { assert.equal(seen(k, off), false); assert.equal(seen(k, full), true); }
  assert.equal(lifeBudget('nonsense', 'nonsense').tier, 1);
  // every stage keeps something on Low, and more on High
  for (const id of STAGES) {
    const life = normalizeLife(stageOf(id).life);
    const nLow = life.filter((e) => lifeVisible(e, low)).length, nFull = life.filter((e) => lifeVisible(e, full)).length;
    assert.ok(nLow >= 2, `${id}: Low keeps ${nLow}`);
    assert.ok(nFull > nLow, `${id}: High draws more than Low`);
    assert.equal(nFull, life.length);
  }
});

// ---------------------------------------------------------------- the reaction bus
test('one beat at a time: a bigger one cuts in, an equal or smaller one is dropped', () => {
  const bus = new ReactionBus();
  const great = bus.react('great-shot', { intensity: 2, playerSlot: 1, text: 'DART!', pos: { x: 1, y: 2 } }, 10);
  assert.equal(great.type, 'great-shot');
  assert.equal(great.until, 10 + REACTIONS['great-shot'].holdS);
  assert.equal(great.playerSlot, 1);
  assert.deepEqual(great.pos, { x: 1, y: 2 });
  assert.equal(bus.react('great-shot', {}, 11), null, 'the same again while it holds');
  assert.equal(bus.last.verdict, 'busy');
  assert.equal(bus.react('splash', {}, 11), null, 'a smaller one');
  assert.equal(bus.react('rocket-launch', {}, 11), null, 'an equal one');
  const holed = bus.react('holed', {}, 11.5);
  assert.equal(holed.type, 'holed');
  assert.equal(holed.cut, 'great-shot', 'it says what it cut, so the layer can stop that beat');
  assert.equal(bus.react('knockout', {}, 12), null, 'equal priority: no');
  assert.equal(bus.react('match-over', { playerSlot: 2 }, 12).cut, 'holed');
  // when the hold is over the stage is free again
  const later = 12 + REACTIONS['match-over'].holdS + 0.01;
  assert.equal(bus.idle(later), true);
  assert.equal(bus.react('splash', {}, later).cut, null);
  assert.equal(bus.played, 4);
  assert.equal(bus.react('nonsense', {}, 100), null);
  assert.equal(bus.last.verdict, 'unknown');
  // every beat has a priority, a hold and at most one cue
  for (const [type, R] of Object.entries(REACTIONS)) {
    assert.ok(R.priority >= 1 && R.priority <= 5, type);
    assert.ok(R.holdS > 0 && R.holdS <= 9, type);
    assert.ok(R.cue === null || /^world-[a-z-]+$/.test(R.cue), type);
  }
  assert.ok(REACTIONS['match-over'].priority > REACTIONS.holed.priority && REACTIONS.holed.priority > REACTIONS['great-shot'].priority && REACTIONS['great-shot'].priority > REACTIONS.splash.priority);
  assert.equal(REACTIONS.bad.cue, null, 'the gull laughs: seen, not heard');
  assert.ok(REACTION_TYPES.includes('lead') && REACTION_TYPES.includes('scatter'));
});

test('calm keeps the hole and the match, off nothing; reduced motion takes the flashes out', () => {
  let mode = 'calm', reduced = false;
  const bus = new ReactionBus({ mode: () => mode, reduced: () => reduced });
  assert.equal(bus.react('great-shot', {}, 0), null);
  assert.equal(bus.last.verdict, 'calm');
  assert.equal(bus.react('rocket-launch', {}, 0), null);
  assert.equal(bus.react('holed', { intensity: 2 }, 0).intensity, 1, 'calm plays it gently');
  bus.reset();
  assert.equal(bus.react('sudden-death', {}, 0).flash, false, 'no dip of the lights in calm');
  mode = 'off';
  bus.reset();
  for (const type of Object.keys(REACTIONS)) assert.equal(bus.react(type, {}, 50), null);
  assert.equal(bus.last.verdict, 'off');
  mode = 'full';
  bus.reset();
  assert.equal(bus.react('sudden-death', {}, 0).flash, true);
  bus.reset(); reduced = true;
  assert.equal(bus.react('sudden-death', {}, 0).flash, false);
  bus.reset();
  assert.equal(bus.react('rocket-launch', {}, 0).flash, false);
  bus.reset();
  assert.equal(bus.react('holed', {}, 0).flash, false, 'a beat with no flash never has one');
});

test("a shot's beats come due on its own clock, in order", () => {
  const bus = new ReactionBus();
  bus.schedule([{ type: 'holed', at: 6 }, { type: 'rocket-launch', at: 0.1 }, { type: 'nonsense', at: 1 }, { type: 'splash' }]);
  assert.deepEqual(bus.queue.map((b) => b.type), ['rocket-launch', 'holed']);
  assert.deepEqual(bus.due(0.05), []);
  assert.deepEqual(bus.due(0.2).map((b) => b.type), ['rocket-launch']);
  assert.deepEqual(bus.due(5.9), []);
  assert.deepEqual(bus.due(6).map((b) => b.type), ['holed']);
  bus.schedule([{ type: 'splash', at: 1 }]);
  bus.schedule([]);
  assert.deepEqual(bus.due(99), [], 'a new shot drops the last one\'s');
});

// a shot as public/arcade/feel.js hands it over: points with their times, events, the cup
const shotOf = ({ dur = 8, flight = 5, events = [], arcade = null, freeBall = null, cup = null, isPutt = false } = {}) => ({
  sim: { points: Array.from({ length: dur * 10 + 1 }, (_, i) => ({ t: i / 10, x: 0, y: i * 2.5, z: Math.max(0, 30 - ((i / 10 - flight / 2) ** 2) * 4.8) })), flightTime: flight, playS: dur, events, isPutt, ...(cup ? { cupDropT: cup.tDrop, cup } : {}) },
  arcade, freeBall,
});

test('game events -> beats: each on the frame its cause is on screen', () => {
  // an ordinary shot: nothing
  assert.deepEqual(shotReactions(shotOf({ arcade: { grade: 'OK' } })), []);
  assert.deepEqual(shotReactions(null), []);
  // a Rocket leaving the club (armed, or the stage's free ball)
  const rocket = shotReactions(shotOf({ arcade: { powerup: 'rocket', grade: 'OK', callout: { id: 'blast-off', text: 'BLAST OFF!', tone: 'good' } } }), { theme: 'volcano' });
  assert.deepEqual(rocket.map((b) => b.type), ['rocket-launch'], 'BLAST OFF! is the launch, not a great shot as well');
  assert.ok(rocket[0].at <= 0.2);
  assert.ok(rocket[0].trail.length >= 4 && rocket[0].trail.every((p, i, a) => !i || p.t > a[i - 1].t));
  assert.equal(shotReactions(shotOf({ freeBall: 'rocket', arcade: { grade: 'OK' } }))[0].type, 'rocket-launch');
  // (at the stop the banner leads with the grade, and so does the world)
  assert.deepEqual(shotReactions(shotOf({ freeBall: 'rocket', arcade: { powerup: 'rocket', grade: 'PERFECT', callout: { id: 'blast-off', text: 'BLAST OFF!', tone: 'good' } } })).map((b) => [b.type, b.text || '']), [['rocket-launch', ''], ['great-shot', 'PERFECT SHOT!']]);
  assert.deepEqual(shotReactions(shotOf({ isPutt: true, arcade: { powerup: 'rocket' } })), [], 'never a putt');
  // on the neon stage the launch holds the stage for the whole flight (fireworks chase the ball)
  assert.equal(shotReactions(shotOf({ flight: 6, freeBall: 'rocket' }), { theme: 'neon' })[0].holdS, 6);
  // water: a splash, or lava on a volcano stage, as the ball goes in
  const wet = shotOf({ events: [{ type: 'water', t: 5, x: 3, y: 120 }], arcade: { grade: 'MISS', callout: { id: 'splash', text: 'IN THE DRINK!', tone: 'bad' } } });
  const splash = shotReactions(wet, { theme: 'tropical' });
  assert.deepEqual(splash.map((b) => b.type), ['splash'], 'the splash is the beat: no second one at the stop');
  assert.ok(near(splash[0].at, 5.12));
  assert.deepEqual(splash[0].pos, { x: 3, y: 120 });
  assert.equal(shotReactions(wet, { theme: 'volcano' })[0].type, 'lava');
  assert.deepEqual(shotReactions(shotOf({ events: [{ type: 'water', t: 5, skip: true }] })), [], 'a Skipper ball skipping is not in the water');
  // holed: the celebration after the 0.8 s hold on the cup
  const cup = { x: 0, y: 200, z: 0, t0: 6.2, tTip: 6.6, tDrop: 7.0, tEnd: 7.8 };
  const holed = shotReactions(shotOf({ dur: 8, cup, events: [{ type: 'holed', t: 7.0 }], arcade: { grade: 'JACKPOT', callout: { id: 'hole-in-one', text: 'HOLE IN ONE!!!', tone: 'epic' } } }), { pin: { x: 0, y: 200 }, playerSlot: 2, screen: { big: 'ACE' } });
  assert.deepEqual(holed.map((b) => b.type), ['holed']);
  assert.equal(holed[0].at, 7.8);
  assert.ok(near(holed[0].at - cup.tDrop, CUP_HOLD_S));
  assert.equal(holed[0].intensity, 2);
  assert.equal(holed[0].playerSlot, 2);
  assert.deepEqual(holed[0].pos, { x: 0, y: 200 });
  assert.deepEqual(holed[0].screen, { big: 'ACE' });
  // (no cup record: the drop time and the hold)
  assert.ok(near(shotReactions({ sim: { ...shotOf().sim, cupDropT: 6 } })[0].at, 6.8));
  // a great shot: with the banner's slam, a moment after the ball stops
  const great = shotReactions(shotOf({ arcade: { grade: 'PERFECT', callout: { id: 'pin-seeker', text: 'PIN SEEKER!', tone: 'epic' } } }));
  assert.deepEqual(great.map((b) => b.type), ['great-shot']);
  assert.ok(great[0].at > 8 && great[0].at < 8.5);
  assert.equal(great[0].intensity, 2);
  assert.equal(great[0].text, 'PIN SEEKER!');
  assert.equal(shotReactions(shotOf({ arcade: { grade: 'GREAT', callout: { id: 'dart', text: 'DART!', tone: 'good' } } }))[0].intensity, 1);
  assert.equal(shotReactions(shotOf({ arcade: { grade: 'PERFECT' } }))[0].text, 'PERFECT SHOT!', 'a grade with no callout still gets its flare');
  assert.deepEqual(shotReactions(shotOf({ arcade: { grade: 'GOOD' } })), []);
  // a duffed one, a bad one
  assert.equal(shotReactions(shotOf({ arcade: { grade: 'MISS', callout: { id: 'chunk', text: 'CHUNK CITY!', tone: 'funny' } } }))[0].type, 'duff');
  assert.equal(shotReactions(shotOf({ arcade: { grade: 'MISS', callout: { id: 'worm-burner', text: 'WORM BURNER!', tone: 'funny' } } }))[0].type, 'duff');
  assert.equal(shotReactions(shotOf({ arcade: { grade: 'DISASTER', callout: { id: 'shank', text: 'SHANK-A-POTAMUS!', tone: 'funny' } } }))[0].type, 'bad');
  assert.equal(shotReactions(shotOf({ arcade: { grade: 'DISASTER', callout: { id: 'ob', text: 'SEE YA!', tone: 'bad' } } }))[0].type, 'bad');
  assert.deepEqual(shotReactions(shotOf({ arcade: { grade: 'OK', callout: { id: 'so-close', text: 'SO CLOSE!', tone: 'neutral' } } })), []);
  // a snowman the ball goes through loses its head as the ball gets there
  const sm = shotReactions(shotOf(), { snowmen: [{ id: 's', x: 0.5, y: 25, r: 2, top: 40 }, { id: 'far', x: 60, y: 25, r: 2, top: 40 }] });
  assert.equal(sm[0].type, 'snowman');
  assert.ok(near(sm[0].at, 1));
  assert.equal(sm[0].id, 's');
  assert.deepEqual(shotReactions(shotOf(), { snowmen: [{ x: 0, y: 62.5, r: 2, top: 3 }] }), [], 'a ball flying 30 m over one leaves it alone');
  // a shot never has two beats at the stop, and they come in time order
  const all = shotReactions(shotOf({ freeBall: 'rocket', cup, events: [{ type: 'holed', t: 7 }], arcade: { grade: 'JACKPOT', callout: { id: 'hole-in-one', text: 'HOLE IN ONE!!!', tone: 'epic' } } }), { snowmen: [{ x: 0, y: 25, r: 2, top: 40 }] });
  assert.deepEqual(all.map((b) => b.type), ['rocket-launch', 'snowman', 'holed']);
  // where a flying ball frightens birds
  const fl = flightSamples(shotOf());
  assert.ok(fl.length > 15 && fl.length < 30);
  assert.equal(fl[fl.length - 1].t, 8);
  assert.deepEqual(flightSamples(null), []);
});

test('match events -> beats: sudden death, a knockout, a hole won, the match over, who leads', () => {
  const m = (o) => ({ id: 7, phase: 'play', players: [{ id: 'a', slot: 1, holesWon: 0 }, { id: 'b', slot: 2, holesWon: 0 }], holeResults: [], ...o });
  assert.deepEqual(matchReactions(null, null), []);
  assert.deepEqual(matchReactions(null, m({})), [], 'a match beginning level is no beat');
  assert.deepEqual(matchReactions(m({}), m({})), [], 'the same snapshot again is nothing');
  const won = m({ phase: 'hole-result', players: [{ id: 'a', slot: 1, holesWon: 0 }, { id: 'b', slot: 2, holesWon: 1 }], holeResults: [{ winnerId: 'b', reason: 'strokes' }] });
  assert.deepEqual(matchReactions(m({}), won).map((b) => [b.type, b.playerSlot]), [['lead', 2], ['hole-won', 2]]);
  const ko = m({ phase: 'hole-result', players: [{ id: 'a', slot: 1, holesWon: 1 }, { id: 'b', slot: 2, holesWon: 1 }], holeResults: [{ winnerId: 'b', reason: 'strokes' }, { winnerId: 'a', reason: 'knockout' }] });
  assert.deepEqual(matchReactions(won, ko).map((b) => [b.type, b.playerSlot]), [['lead', 0], ['knockout', 1]], 'level again: the colours go back');
  assert.equal(matchReactions(won, { ...ko, holeResults: [{}, { winnerId: 'a', reason: 'cap' }] })[1].type, 'knockout');
  assert.deepEqual(matchReactions(ko, m({ phase: 'hole-result', holeResults: [{}, {}, { winnerId: null, reason: 'tied' }] })).map((b) => b.type), [], 'a halved hole is no beat');
  // sudden death: on its intro (the arena's models are still arriving: 2.5 s), and not again when the round begins
  const intro = m({ phase: 'intro', stage: { kind: 'tiebreak' } });
  const sd = matchReactions(ko, intro).find((b) => b.type === 'sudden-death');
  assert.equal(sd.delayS, 2.5);
  assert.deepEqual(matchReactions(intro, m({ phase: 'tiebreak', stage: { kind: 'tiebreak' } })).filter((b) => b.type === 'sudden-death'), []);
  assert.equal(matchReactions(m({}), m({ phase: 'tiebreak' })).filter((b) => b.type === 'sudden-death').length, 1);
  const done = m({ phase: 'done', winnerId: 'a', players: [{ id: 'a', slot: 1, holesWon: 2 }, { id: 'b', slot: 2, holesWon: 1 }] });
  assert.deepEqual(matchReactions(ko, done).map((b) => [b.type, b.playerSlot]), [['lead', 1], ['match-over', 1]]);
  assert.deepEqual(matchReactions(done, null), [{ type: 'lead', playerSlot: 0 }], 'the match gone: the stage is its own colours again');
  assert.deepEqual(matchReactions(done, { ...done, aborted: true }).map((b) => b.type), ['lead']);
  assert.equal(matchLeader(done), 1);
  assert.equal(matchLeader(null), 0);
  // players without a slot are slots 1 and 2 in order
  assert.equal(matchLeader({ players: [{ id: 'x', holesWon: 0 }, { id: 'y', holesWon: 3 }] }), 2);
});

test('the reaction map: every beat does something on every stage, and the right thing', () => {
  const stageFor = (id) => { const st = stageOf(id); return { theme: st.theme, night: st.timeOfDay === 'night' || st.timeOfDay === 'dusk', has: new Set(st.life.map((e) => e.kind)), stadium: id === 'thunder-dome' || id === 'midnight-mile' }; };
  const fx = (type, id) => reactionPlan(type, stageFor(id)).map((s) => s.fx);
  for (const id of STAGES) for (const type of Object.keys(REACTIONS)) {
    const steps = reactionPlan(type, stageFor(id));
    assert.ok(steps.length >= 1, `${id}: ${type} does nothing`);
    for (const s of steps) {
      assert.equal(typeof WorldEvents.prototype[`_fx_${s.fx.replace(/-/g, '_')}`], 'function', `${type}: world-events.js has no _fx_ for '${s.fx}'`);
      assert.ok(s.delay >= 0 && s.delay <= 2);
    }
    const cue = beatCue(type, steps);
    assert.ok(cue === null || LIVING_CUES.includes(cue), `${type}: cue ${cue} is not in LIVING_CUES`);
  }
  // a Rocket launch: the volcano erupts, the ground ripples, the birds go up; fireworks chase the ball in the neon city
  assert.deepEqual(fx('rocket-launch', 'dragons-spine'), ['shockwave', 'scatter', 'erupt']);
  assert.ok(fx('rocket-launch', 'midnight-mile').includes('trail-fireworks'));
  assert.ok(!fx('rocket-launch', 'lagoon-island').includes('erupt'));
  assert.equal(beatCue('rocket-launch', reactionPlan('rocket-launch', stageFor('dragons-spine'))), 'world-eruption');
  assert.equal(beatCue('rocket-launch', reactionPlan('rocket-launch', stageFor('lagoon-island'))), 'world-shockwave');
  // a great shot: the dragon roars where there is one; else flares by day, fireworks by night; the airship says it
  for (const id of ['dragons-spine', 'ice-pick', 'temple-run', 'volcano-drop']) assert.equal(fx('great-shot', id)[0], 'dragon-roar', id);
  assert.equal(fx('great-shot', 'lagoon-island')[0], 'flares');
  assert.equal(fx('great-shot', 'thunder-dome')[0], 'fireworks');
  for (const id of ['thunder-dome', 'midnight-mile']) { assert.ok(fx('great-shot', id).includes('sign'), id); assert.ok(fx('great-shot', id).includes('searchlights'), id); }
  assert.equal(beatCue('great-shot', reactionPlan('great-shot', stageFor('ice-pick'))), 'world-dragon-roar');
  assert.equal(beatCue('great-shot', reactionPlan('great-shot', stageFor('thunder-dome'))), 'world-fireworks');
  // a holed ball: the full celebration, with the stadium's own cannons where it has them
  for (const id of STAGES) for (const need of ['fireworks', 'confetti', 'scatter', 'screen']) assert.ok(fx('holed', id).includes(need), `${id}: holed has no ${need}`);
  assert.equal(reactionPlan('holed', stageFor('thunder-dome')).find((s) => s.fx === 'confetti').stadium, true);
  assert.equal(reactionPlan('holed', stageFor('lagoon-island')).find((s) => s.fx === 'confetti').stadium, false);
  // a bad one
  assert.equal(fx('splash', 'temple-run')[0], 'croc');
  assert.equal(fx('splash', 'lagoon-island')[0], 'fish');
  assert.deepEqual(fx('lava', 'volcano-drop'), ['lava-burp']);
  assert.deepEqual(fx('duff', 'pharaohs-gate'), ['tumbleweed']);
  assert.deepEqual(fx('duff', 'canyon-run'), ['tumbleweed']);
  assert.deepEqual(fx('duff', 'lagoon-island'), ['laugh']);
  assert.deepEqual(fx('bad', 'lagoon-island'), ['laugh']);
  assert.deepEqual(fx('snowman', 'frostbite-ridge'), ['snowman']);
  assert.equal(fx('splash', 'frostbite-ridge')[0], 'ice', 'a ball onto a frozen lake throws chips of ice, not fish');
  assert.equal(beatCue('bad', reactionPlan('bad', stageFor('lagoon-island'))), null);
  // the match's beats
  assert.deepEqual(fx('sudden-death', 'thunder-dome').slice(0, 2), ['lights-dip', 'lights-flare']);
  assert.equal(reactionPlan('sudden-death', stageFor('thunder-dome'))[1].delay, 1.5, 'the flare comes after the dip');
  for (const id of STAGES) { assert.equal(fx('hole-won', id)[0], 'colours'); assert.ok(fx('match-over', id).includes('finale')); assert.equal(fx('knockout', id)[0], 'colours'); }
  assert.deepEqual(beatColors(1)[0], PLAYER_COLORS[1]);
  assert.deepEqual(beatColors(2)[0], PLAYER_COLORS[2]);
  assert.ok(beatColors(0).length >= 3);
  // the cue names are new ones, for the sound stream to fill
  const audio = fs.readFileSync(path.join(root, 'public', 'arcade', 'audio.js'), 'utf8');
  assert.equal(new Set(LIVING_CUES).size, LIVING_CUES.length);
  for (const cue of LIVING_CUES) assert.match(cue, /^world-/);
  assert.ok(!/loop\s*=\s*true/.test(fs.readFileSync(path.join(root, 'public', 'render', 'world-events.js'), 'utf8')), 'nothing here loops a sound');
  assert.ok(audio.includes('Unknown names are ignored'), 'a cue the mix does not know yet is silent (public/arcade/audio.js cue())');
});

// ---------------------------------------------------------------- the models and the particles
test('every model of the cast builds, small, with its colours and its motion', () => {
  assert.ok(LIFE_MODEL_KINDS.length >= 25);
  for (const kind of LIFE_MODEL_KINDS) {
    const g = buildLifeModel(kind);
    assert.ok(g && g.attributes.position.count >= 3, kind);
    for (const name of ['normal', 'color', 'aLife']) assert.ok(g.attributes[name], `${kind}: ${name}`);
    assert.equal(g.attributes.aLife.itemSize, 4);
    const b = g.boundingBox;
    for (const v of [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z]) assert.ok(Number.isFinite(v), `${kind}: a finite box`);
    assert.ok(g.attributes.position.count / 3 <= 520, `${kind}: ${g.attributes.position.count / 3} triangles`);
    assert.equal(buildLifeModel(kind), g, 'built once');
  }
  assert.equal(buildLifeModel('unicorn'), null);
  // a bird's wings beat (its body does not); a walker's shirt takes the copy's colour
  const bird = buildLifeModel('bird').attributes.aLife;
  let flap = 0, still = 0;
  for (let i = 0; i < bird.count; i++) (bird.getY(i) > 0 ? flap++ : still++);
  assert.ok(flap > 0 && still > 0);
  const walker = buildLifeModel('walker').attributes.aLife;
  let tint = 0;
  for (let i = 0; i < walker.count; i++) tint += walker.getZ(i);
  assert.ok(tint > 0 && tint < walker.count);
  const { material, uniforms } = makeLifeMaterial();
  assert.equal(material.vertexColors, true);
  assert.ok('uLifeTime' in uniforms && 'uLifeGlow' in uniforms);
  // the layer names only models that exist
  const src = fs.readFileSync(path.join(root, 'public', 'render', 'world-events.js'), 'utf8');
  for (const m of src.matchAll(/_need\('([a-z-]+)'/g)) assert.ok(LIFE_MODEL_KINDS.includes(m[1]), `world-events.js asks for a model '${m[1]}' that world-models.js has not got`);
  for (const k of Object.keys(GLB_MOVERS)) { assert.ok(LIFE_MODEL_KINDS.includes(k), `${k}: the procedural copy stands by`); assert.match(GLB_MOVERS[k].url, /^\/arcade\/props\/[a-z-]+\.glb$/); assert.ok(fs.existsSync(path.join(root, 'public', GLB_MOVERS[k].url)), `${k}: its file`); }
});

test('the particle systems: a fixed pool, a known weather for every type', () => {
  assert.deepEqual(Object.keys(WEATHER).sort(), [...WEATHER_TYPES].sort());
  for (const [type, W] of Object.entries(WEATHER)) { assert.ok(W.size > 0 && W.alpha > 0 && W.alpha <= 1, type); assert.equal(W.box.length, 3); }
  assert.ok(WEATHER.snow.fall < 2, 'light snow: it drifts, it does not streak');
  assert.equal(BURST_SLOTS, 14);
  assert.deepEqual(Object.keys(BURST_KINDS), ['sphere', 'jet', 'confetti', 'puff', 'splash']);
  assert.ok('plume' in EMIT_MODES && 'hover' in EMIT_MODES);
  const pool = new BurstPool(48);
  assert.equal(pool.fire(1, new THREE.Vector3(), {}), -1, 'nothing fires before it is built');
  const group = new THREE.Group();
  let seed = 1;
  pool.build(group, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
  assert.equal(pool.mesh.geometry.attributes.aSlot.count, 14 * 48);
  const slots = new Set();
  for (let i = 0; i < 14; i++) slots.add(pool.fire(1, new THREE.Vector3(i, 0, 0), { life: 2 }));
  assert.equal(slots.size, 14, 'fourteen at once each get a slot');
  pool.update(1.5);
  assert.equal(pool.live, true);
  pool.update(10);
  assert.equal(pool.live, false, 'burned out: not drawn');
  assert.ok(pool.fire(10, new THREE.Vector3(), {}) >= 0);
  assert.ok(near(pxPerMetre({ fov: 90 }, 1000), 500, 1e-6));
  for (const B of Object.keys(BIRD_SPECIES)) assert.match(BIRD_SPECIES[B].color, /^#[0-9a-f]{6}$/);
});

// ---------------------------------------------------------------- the layer itself (no renderer needed)
const V = (x, y, z) => new THREE.Vector3(x, z, -y);
const layerFor = (id, env = {}) => {
  const st = stageOf(id), scene = new THREE.Scene();
  const removed = [], added = [];
  const props = { ready: Promise.resolve(), remove: (pid) => { removed.push(pid); return true; }, add: (list) => { added.push(...list); }, fx: null, setScreen: (info) => { props.screen = info; } };
  const w = new WorldEvents({ scene, V, hAt: () => 0, waterAt: () => null, props: () => props, env: () => ({ arcade: true, quality: 'high', theme: st.theme, timeOfDay: st.timeOfDay, night: st.timeOfDay === 'night', reduced: false, ...env }) });
  const geo = { name: id, holes: [{ tee: st.tee, pin: st.pin }], props: (st.piece.props || []).map((p, i) => ({ ...p, id: p.id || `${p.kind}-${i}` })), life: st.life, arcade: { theme: st.theme } };
  w.setCourse(geo);
  return { w, scene, st, props, removed, added, geo };
};
const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 5000);
cam.position.set(0, 6, 14);

test('every stage builds and runs: a bounded cast, a handful of draws, nothing thrown', () => {
  for (const id of STAGES) {
    const { w, scene, st } = layerFor(id);
    w.setWind({ mph: 12, toDeg: 70 });
    for (let i = 0; i < 240; i++) w.update(i / 30, 1 / 30, cam, { line: null, ball: new THREE.Vector3(st.tee[0], 0.02, -st.tee[1]) });
    const s = w.stats();
    assert.equal(s.entries, st.life.length, `${id}: every entry is drawn on High`);
    assert.ok(s.instances > 0 && s.instances <= 220, `${id}: ${s.instances} copies`);
    assert.ok(s.draws <= 26, `${id}: ${s.draws} draws`);
    assert.ok(s.tris <= 30000, `${id}: ${s.tris} triangles in the cast`);
    assert.ok(s.particles <= 700, `${id}: ${s.particles} particles`);
    assert.ok(scene.getObjectByName('world-life'), id);
    // every beat plays here without a throw, and the stage settles
    for (const type of Object.keys(REACTIONS)) { w.bus.reset(); w.react(type, { playerSlot: 1, pos: { x: st.pin[0], y: st.pin[1] }, text: 'X', intensity: 2 }); for (let i = 0; i < 90; i++) w.update(20 + i / 30, 1 / 30, cam, {}); }
    assert.ok(w.stats().beats >= Object.keys(REACTIONS).length, `${id}: the beats played`);
    w.dispose();
    assert.equal(scene.getObjectByName('world-life'), undefined, `${id}: disposed`);
  }
});

test('off leaves the stage the set it was; Low and calm draw less; nothing is drawn in the real look', () => {
  const full = layerFor('frostbite-ridge');
  const n = full.w.stats();
  assert.ok(n.weather > 0 && n.kinds.includes('weather'));
  full.w.setMode('calm', { save: false });
  const calm = full.w.stats();
  assert.equal(calm.weather, 0);
  assert.ok(calm.entries < n.entries && calm.entries > 0);
  assert.ok(!calm.kinds.includes('flock'));
  assert.equal(full.w.react('great-shot', {}), null, 'calm: no flare for a great shot');
  assert.equal(full.w.react('holed', { pos: { x: 0, y: 0 } }).type, 'holed', 'calm: the hole still celebrates');
  full.w.setMode('off', { save: false });
  assert.equal(full.scene.children.length, 0);
  assert.equal(full.w.stats().entries, 0);
  assert.equal(full.w.react('holed', {}), null);
  assert.equal(full.w.bus.last.verdict, 'off');
  full.w.update(1, 1 / 60, cam, {});                       // one `if`
  assert.deepEqual(full.w.shotStart({ sim: { points: [{ t: 0, x: 0, y: 0, z: 0 }] } }), []);
  full.w.setMode('full', { save: false });
  assert.equal(full.w.stats().entries, n.entries);
  const low = layerFor('frostbite-ridge', { quality: 'low' }).w.stats();
  assert.ok(low.entries < n.entries && low.entries >= 2);
  assert.ok(low.weather < n.weather);
  assert.ok(low.instances < n.instances);
  const real = layerFor('frostbite-ridge', { arcade: false });
  assert.equal(real.scene.children.length, 0);
  assert.equal(real.w.stats().entries, 0);
  // a course with no life at all
  const scene = new THREE.Scene(), w = new WorldEvents({ scene, V, hAt: () => 0 });
  w.setCourse({ name: 'plain', holes: [{ tee: [0, 0], pin: [0, 100] }] });
  assert.equal(w.stats().entries, 0);
  w.update(1, 1 / 60, cam, {});
  w.setCourse(null);
  assert.equal(scene.children.length, 0);
});

test('the layer plays one beat at a time, on the shot\'s own clock', () => {
  const { w, st, props } = layerFor('lagoon-island');
  for (let i = 0; i < 30; i++) w.update(i / 30, 1 / 30, cam, {});
  const cup = { tDrop: 3.0, tEnd: 3.8 };
  const shot = { sim: { points: Array.from({ length: 41 }, (_, i) => ({ t: i / 10, x: st.pin[0] * (i / 40), y: st.pin[1] * (i / 40), z: 22 * (1 - i / 40) })), flightTime: 2.5, playS: 4, cupDropT: 3.0, cup, events: [{ type: 'holed', t: 3.0 }] }, arcade: { grade: 'JACKPOT', callout: { id: 'hole-in-one', text: 'HOLE IN ONE!!!', tone: 'epic' } } };
  const beats = w.shotStart(shot, { playerSlot: 2, screen: { title: 'SAM', big: 'HOLE IN ONE' } });
  assert.deepEqual(beats.map((b) => [b.type, b.at]), [['holed', 3.8]]);
  let t = 1;
  for (let clock = 0; clock <= 3.7; clock += 1 / 30) { w.shotProgress(clock); w.update((t += 1 / 30), 1 / 30, cam, {}); }
  assert.equal(w.stats().beats, 0, 'not before the hold on the cup is over');
  // the scene stops feeding the clock when the ball is down; the layer runs it on
  for (let i = 0; i < 12; i++) w.update((t += 1 / 30), 1 / 30, cam, {});
  assert.equal(w.stats().beats, 1);
  assert.equal(w.bus.active.type, 'holed');
  assert.equal(w.bus.active.playerSlot, 2);
  assert.deepEqual(props.screen, { title: 'SAM', big: 'HOLE IN ONE' }, 'the big screens are told who and what');
  assert.equal(w.react('great-shot', {}), null, 'nothing is stacked on the celebration');
  assert.equal(w.react('match-over', { playerSlot: 2 }).cut, 'holed');
  assert.equal(w.stats().lead, 2, "the winner's colour is up");
  // the states take no turn on the bus
  assert.equal(w.react('lead', { playerSlot: 1 }), null);
  assert.equal(w.stats().lead, 1);
  assert.equal(w.bus.active.type, 'match-over');
  // a match snapshot does the same through matchUpdate, and a beat may be asked for later
  w.bus.reset();
  const m = { id: 1, phase: 'hole-result', players: [{ id: 'a', slot: 1, holesWon: 0 }, { id: 'b', slot: 2, holesWon: 1 }], holeResults: [{ winnerId: 'b', reason: 'knockout' }] };
  assert.deepEqual(w.matchUpdate(m).map((b) => b.type), ['lead', 'knockout']);
  assert.equal(w.bus.active.type, 'knockout');
  // a hole's winner flies their colour for the beat; afterwards the colours are the leader's (here: level)
  w.bus.reset();
  const level = { id: 1, phase: 'hole-result', players: [{ id: 'a', slot: 1, holesWon: 1 }, { id: 'b', slot: 2, holesWon: 1 }], holeResults: [{ winnerId: 'b', reason: 'knockout' }, { winnerId: 'a', reason: 'strokes' }] };
  assert.deepEqual(w.matchUpdate(level).map((b) => [b.type, b.playerSlot]), [['lead', 0], ['hole-won', 1]]);
  assert.equal(w._shown, 1, 'the hole winner\'s colour is up');
  for (let i = 0; i < 120; i++) w.update((t += 1 / 30), 1 / 30, cam, {});
  assert.equal(w._shown, 0, 'and comes down when the beat is over: nobody leads');
  assert.equal(w.stats().lead, 0);
  assert.deepEqual(w.matchUpdate(level), [], 'the same snapshot again: nothing');
  w.bus.reset();
  assert.equal(w.react('holed', { at: 0.5, pos: { x: 0, y: 0 } }), null, 'asked for in half a second');
  for (let i = 0; i < 20; i++) w.update((t += 1 / 30), 1 / 30, cam, {});
  assert.equal(w.bus.active.type, 'holed');
});

test('a beat has one cue at most, through the guarded cue()', () => {
  const { w } = layerFor('dragons-spine');
  const heard = [];
  w.audio = { cue: (name, o) => heard.push([name, o.intensity]) };
  w.update(1, 1 / 30, cam, {});
  w.react('rocket-launch', { pos: { x: 0, y: 0 } });
  assert.deepEqual(heard.map((h) => h[0]), ['world-eruption']);
  w.bus.reset();
  w.react('bad', { pos: { x: 0, y: 0 } });
  assert.equal(heard.length, 1, 'a beat that is only seen asks for nothing');
  w.audio = { cue: () => { throw new Error('the engine fell over'); } };
  w.bus.reset();
  assert.equal(w.react('great-shot', {}).type, 'great-shot', 'sound is never worth an error');
  w.audio = null;
  w.bus.reset();
  assert.equal(w.react('holed', {}).type, 'holed');
});

test('the camera\'s rules: a mover on the sight line or in the ball\'s way gets out of it', () => {
  const { w } = layerFor('canyon-run');
  w.update(0, 1 / 30, cam, {});
  // the address camera 14 m behind the ball, looking north along the shot
  w._line = { x: 0, y: -14, ux: 0, uy: 1, d: 14, camZ: 4.6, ballZ: 0, endZ: 0, aheadM: 60 };
  assert.equal(w._isClear(0.5, -7, 1, 1.6), false, 'between the camera and the ball');
  assert.equal(w._isClear(1, 30, 1, 1.6), false, 'over the first 60 m of the shot');
  assert.equal(w._isClear(1, 90, 1, 1.6), true, 'further down the hole');
  assert.equal(w._isClear(20, 30, 1, 1.6), true, 'off to one side');
  assert.equal(w._isClear(0, 30, 80, 12), true, 'a balloon 80 m up is not in the way');
  assert.equal(w._isClear(0, -30, 1, 1.6), true, 'behind the camera');
  w._line = null;
  assert.equal(w._isClear(0.5, -7, 1, 1.6), true, 'no line: a shot is away');
  // the path a struck ball still has to fly
  w.shotStart({ sim: { points: Array.from({ length: 50 }, (_, i) => ({ t: i / 10, x: 0, y: i * 4, z: 30 })), flightTime: 5, playS: 5 } });
  assert.equal(w._isClear(3, 100, 28, 1.5), false, 'a bird where the ball is going');
  assert.equal(w._isClear(40, 100, 28, 1.5), true);
  for (let clock = 0; clock <= 4; clock += 0.1) { w.shotProgress(clock); w.update(1 + clock, 0.1, cam, {}); }
  assert.equal(w._isClear(3, 20, 30, 1.5), true, 'where the ball has already been is free again');
  // and the cast is listed for a camera that flies by itself
  const fort = layerFor('summit-express').w;
  const obst = fort.obstacles();
  assert.ok(obst.length >= 8);
  for (const o of obst) assert.ok([o.x, o.y, o.r, o.base, o.top].every(Number.isFinite) && o.top > o.base && o.r > 0);
});

test('birds a ball passes take fright, and a scatter is not repeated at once', () => {
  const { w } = layerFor('lagoon-island');
  for (let i = 0; i < 10; i++) w.update(i / 30, 1 / 30, cam, {});
  assert.ok(w.scatter() >= 3, 'everything that flies or sits');
  assert.equal(w.scatter(), 0, 'they are already up');
  w.update(40, 1 / 30, cam, {});
  assert.equal(w.scatter({ pos: { x: -170, y: 210 }, within: 30 }), 1, 'only the flock there');
  // a ball flying through a flock's air
  const fresh = layerFor('lagoon-island').w;
  fresh.update(0, 1 / 30, cam, {});
  const flock = fresh._flocks[0];
  fresh.shotStart({ sim: { points: [{ t: 0, x: 0, y: 0, z: 0 }, { t: 5, x: 1, y: 1, z: 0 }], flightTime: 5, playS: 5 } });
  fresh.shotProgress(1);
  fresh.update(1, 1 / 30, cam, { ball: V(flock.en.x + 5, flock.en.y, flock.ground + flock.en.lift) });
  assert.equal(flock.at, 1, 'frightened as the ball goes by');
});

test('pieces the layer draws itself leave the props layer, and come back with "off"', async () => {
  const lp = layerFor('lighthouse-point');
  await new Promise((r) => setTimeout(r, 0));
  const mills = lp.geo.props.filter((p) => p.kind === 'windmill').map((p) => p.id);
  assert.equal(mills.length, 2);
  assert.deepEqual(lp.removed.sort(), mills.sort(), 'both windmills are the layer\'s now (they turn with the wind)');
  lp.w.setMode('off', { save: false });
  assert.deepEqual(lp.added.map((p) => p.id).sort(), mills.sort(), 'and are plain props again when the layer is off');
  // a snowman is the prop until a ball takes its head off
  const fr = layerFor('frostbite-ridge');
  await new Promise((r) => setTimeout(r, 0));
  const snowmen = fr.geo.props.filter((p) => p.kind === 'snowman');
  assert.ok(snowmen.length >= 6);
  assert.ok(!fr.removed.some((id) => snowmen.some((s) => s.id === id)));
  fr.w.update(1, 1 / 30, cam, {});
  fr.w.react('snowman', { pos: { x: snowmen[0].x, y: snowmen[0].y } });
  assert.ok(fr.removed.includes(snowmen[0].id));
  // the dragon stays a plain prop where its model cannot be loaded (here: no page), and the layer still runs
  const ds = layerFor('dragons-spine');
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(!ds.removed.some((id) => /dragon/.test(id)));
  assert.deepEqual(ds.w.stats().dragon, [null]);
});

test('the dragon: its neck is found from its own vertices', () => {
  // a column with a head sticking out in front at the top
  const pts = [];
  for (let y = 0; y <= 10; y += 0.5) for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pts.push(x + 2, y, z + 3);
  pts.push(2, 8, 9);
  const d = measureDragon(new THREE.Float32BufferAttribute(pts, 3));
  assert.equal(d.height, 10);
  assert.ok(near(d.pivot.x, 2) && near(d.pivot.z, 3));
  assert.deepEqual(d.mouth, { x: 2, y: 8, z: 9 });
  assert.ok(DRAGON_NECK.from < DRAGON_NECK.to && DRAGON_NECK.maxYaw > 0.8 && DRAGON_NECK.maxYaw < 1.3, 'it turns its head, it does not wring its neck');
});

// ---------------------------------------------------------------- the hooks in the shared files
test('the shared files carry the hooks, marked v3:living', () => {
  const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
  const scene = read('public', 'render', 'scene.js');
  for (const needle of ['new WorldEvents(', 'this.worldEvents.setCourse(geo)', 'this.worldEvents.update(frameTime, dt, this.camera', 'this.worldEvents?.setWind(']) assert.ok(scene.includes(needle), `scene.js: ${needle}`);
  const app = read('public', 'app.js');
  for (const needle of ['worldShot(shot)', 'scene.worldEvents.shotProgress(t)', 'scene.worldEvents.matchUpdate(m)', 'scene.worldEvents.audio = arcadeAudio', "segmented($('seg-life')", 'worldClock(']) assert.ok(app.includes(needle), `app.js: ${needle}`);
  assert.ok(read('server.js').includes('life: Array.isArray(game.course.life) ? game.course.life : null'));
  const lib = read('tools', 'arcade-holes', 'lib.js');
  for (const needle of ['lifeTools.placeLife(lifeTools.lifeOf(piece)', 'lifeTools.validateLife(course']) assert.ok(lib.includes(needle), `lib.js: ${needle}`);
  assert.ok(read('public', 'index.html').includes('id="seg-life"'));
  assert.ok(read('public', 'arcade', 'shell.js').includes("label: 'WORLD LIFE'"));
  for (const [file, text] of [['scene.js', scene], ['app.js', app], ['lib.js', lib]]) assert.ok((text.match(/v3:living/g) || []).length >= 3, `${file}: the edits are marked`);
  // scenery only: nothing of it reaches the physics or the rules
  for (const f of ['physics.js', 'game.js', 'match.js', 'arcade.js']) assert.ok(!/world-life|worldEvents|course\.life/.test(read('lib', f)), `lib/${f} knows nothing of the living world`);
});
