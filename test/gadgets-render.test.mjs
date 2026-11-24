// Course gadgets, the client side (v3:gadgets; docs/gadgets.md):
//   public/render/gadget-core.js   the pure part: a shot's reaction timeline, warps, a geyser's
//                                  cycle in playback time, the cameras' obstacle lists, the cues,
//                                  the HUD's summary and the lineup's GADGETS AHEAD rows
//   public/render/gadgets.js       the layer: every kind builds, reacts to its event, stands
//                                  again for the next swing, and fades for the pass-through
// and that the hooks are where they should be (scene.js, app.js, the aim map, the stage intro).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  GADGET_LOOK, GADGET_KINDS, GADGET_CUES, COIN_CUE_GAP_MS, cueFor, cueGate, cueIntensity,
  gadgetTimeline, warpWindows, ballHiddenAt, geyserWindows, geyserState,
  gadgetFootprint, gadgetOutline, gadgetObstacles, gadgetBlockers, gadgetCeiling,
  gadgetSummary, gadgetSummaryText, gadgetsNearLine, lineupGadgets, ringTubeM, farScale, drawGadgetGlyph,
} from '../public/render/gadget-core.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const { KIND_IDS } = (await import('../lib/gadgets.js')).default;

// one of every kind, as /api/course-geometry sends them (lib/gadgets.js normalizeGadgets)
const GADGETS = [
  { id: 'ring', kind: 'ring', x: 0, y: 120, z: 30, radius: 8, heading: 0, strength: 1.25 },
  { id: 'pad', kind: 'pad', x: 20, y: 200, radius: 5, angle: 50, strength: 1, minMps: 16, maxMps: 45 },
  { id: 'strip', kind: 'strip', x: -40, y: 180, size: [14, 36], heading: 10, strength: 6, maxMps: 24 },
  { id: 'fan', kind: 'fan', x: 0, y: 80, size: [30, 50, 30], heading: 90, strength: 14, lift: 0 },
  { id: 'updraft', kind: 'fan', x: 60, y: 80, size: [16, 16, 40], heading: 0, strength: 0, lift: 25 },
  { id: 'geyser', kind: 'geyser', x: -50, y: 150, radius: 6, height: 40, strength: 24, cycle: 4, offset: 2, burst: 1.5 },
  { id: 'bumper', kind: 'bumper', x: -70, y: 200, radius: 1.6, height: 3.5, strength: 16 },
  { id: 'rail', kind: 'rail', x: -84, y: 226, points: [[-84, 226], [-78, 238], [-68, 246]], radius: 0.7, height: 1.6, strength: 12 },
  { id: 'board', kind: 'backboard', x: -60, y: 266, size: [18, 8], heading: 180, strength: 0.3 },
  { id: 'funnel', kind: 'funnel', x: -58, y: 226, radius: 9, strength: 1.2 },
  { id: 'ice', kind: 'ice', x: -48, y: 166, radius: 12, friction: 0.3 },
  { id: 'mud', kind: 'mud', x: 40, y: 96, size: [10, 16], heading: 30 },
  { id: 'cannon', kind: 'warp', x: -40, y: 128, radius: 3, delay: 0.7, pair: 'cannon-out', style: 'cannon' },
  { id: 'cannon-out', kind: 'warp-exit', x: -40, y: 133, heading: 20, angle: 45, speedMph: 80, style: 'cannon' },
  { id: 'pipe', kind: 'warp', x: 10, y: 110, z: 22, radius: 4, delay: 0.7, pair: 'pipe-out', style: 'pipe' },
  { id: 'pipe-out', kind: 'warp-exit', x: 62, y: 204, heading: 300, angle: 40, speedMph: 70, style: 'pipe' },
  { id: 'wall', kind: 'breakable', x: 58, y: 128, size: [34, 20], heading: 204, breakMph: 150, keep: 0.85, style: 'wall' },
  { id: 'ice-wall', kind: 'breakable', x: 90, y: 140, size: [24, 14], heading: 200, breakMph: 120, keep: 0.85, style: 'ice-wall' },
  { id: 'snowman', kind: 'breakable', x: -62, y: 120, radius: 2.2, height: 6, breakMph: 60, keep: 0.85, style: 'snowman' },
  { id: 'pinata', kind: 'breakable', x: -48, y: 192, z: 8, radius: 2, height: 4, breakMph: 50, keep: 0.85, style: 'pinata' },
  { id: 'crates', kind: 'breakable', x: 70, y: 192, radius: 2.4, height: 4.5, breakMph: 90, keep: 0.85, style: 'crate' },
  { id: 'coins', kind: 'coins', x: 0, y: 50, points: [[0, 50, 12], [0, 90, 22], [0, 130, 28], [0, 170, 26]], reach: 5 },
  { id: 'x3', kind: 'zone', x: 16, y: 239, radius: 8, mult: 3 },
  { id: 'x2', kind: 'zone', x: -52, y: 216, radius: 10, mult: 2 },
];
const flat = () => 0;
const ev = (id, kind, t, effect, extra = {}) => ({ type: 'gadget', id, kind, t, x: 1, y: 2, z: 3, effect, ...extra });

// ---------------------------------------------------------------- the look table

test('every kind the server knows has a look, a glyph and a name; the client knows no other', () => {
  assert.deepEqual([...GADGET_KINDS].sort(), [...KIND_IDS].sort());
  for (const [kind, L] of Object.entries(GADGET_LOOK)) {
    assert.match(L.color, /^#[0-9a-f]{6}$/, kind);
    assert.match(L.glow, /^#[0-9a-f]{6}$/, kind);
    assert.ok(L.label && L.short && L.glyph, kind);
    assert.ok(L.short.length <= 6, `${kind}: a chip's word is short`);
  }
  // every glyph draws with plain canvas calls (a recording context stands in for a canvas)
  const calls = [];
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push(k); return a; }), set: (t, k, v) => { t[k] = v; return true; } });
  for (const L of Object.values(GADGET_LOOK)) { calls.length = 0; drawGadgetGlyph(ctx, L.glyph, 10, 10, 8, L.color); assert.ok(calls.includes('save') && calls.includes('restore') && calls.length > 4, L.glyph); }
});

// ---------------------------------------------------------------- the audio cues

test('cues: the names the sound stream records, one a contact, coins throttled to one every 80 ms', () => {
  assert.deepEqual([...GADGET_CUES], ['gadget-ring', 'gadget-pad', 'gadget-bumper', 'gadget-break', 'gadget-coin', 'gadget-warp', 'gadget-geyser', 'gadget-strip', 'gadget-fan', 'gadget-zone', 'gadget-thud']);
  const want = {
    'ring:boost': 'gadget-ring', 'pad:launch': 'gadget-pad', 'bumper:bump': 'gadget-bumper', 'rail:bump': 'gadget-bumper',
    'breakable:smash': 'gadget-break', 'breakable:bounce': 'gadget-thud', 'backboard:board': 'gadget-thud', 'mud:stuck': 'gadget-thud',
    'coins:coin': 'gadget-coin', 'coins:full': 'gadget-coin', 'warp:in': 'gadget-warp', 'warp-exit:out': 'gadget-warp',
    'geyser:erupt': 'gadget-geyser', 'strip:speed': 'gadget-strip', 'fan:push': 'gadget-fan', 'zone:x2': 'gadget-zone', 'zone:x3': 'gadget-zone',
    'ice:slide': null, 'funnel:funnel': null,
  };
  for (const [k, cue] of Object.entries(want)) { const [kind, effect] = k.split(':'); assert.equal(cueFor({ kind, effect }), cue, k); if (cue) assert.ok(GADGET_CUES.includes(cue)); }
  assert.equal(cueFor(null), null);
  assert.equal(cueFor({ kind: 'nothing' }), null);
  assert.ok(cueIntensity({ kind: 'breakable', effect: 'smash' }) > cueIntensity({ kind: 'breakable', effect: 'bounce' }));
  assert.ok(cueIntensity({ kind: 'coins', effect: 'full' }) > cueIntensity({ kind: 'coins', effect: 'coin' }));
  // seven coins in 0.3 s: a chime at most every 80 ms, and the full trail's always sounds
  assert.equal(COIN_CUE_GAP_MS, 80);
  const gate = cueGate();
  const played = [];
  for (let i = 0; i < 7; i++) { const c = gate({ kind: 'coins', effect: 'coin' }, 1000 + i * 45); if (c) played.push(1000 + i * 45); }
  assert.deepEqual(played, [1000, 1090, 1180, 1270]);
  for (let i = 1; i < played.length; i++) assert.ok(played[i] - played[i - 1] >= 80);
  assert.equal(gate({ kind: 'coins', effect: 'full' }, 1275), 'gadget-coin', 'the full trail is never swallowed');
  assert.equal(gate({ kind: 'ring', effect: 'boost' }, 1276), 'gadget-ring', 'nothing else is throttled');
  assert.equal(gate({ kind: 'ring', effect: 'boost' }, 1277), 'gadget-ring');
  assert.equal(gate({ kind: 'ice', effect: 'slide' }, 1278), null);
});

// ---------------------------------------------------------------- a shot's reactions

test('the reaction timeline: gadget events only, in the order they play', () => {
  const events = [
    { type: 'bounce', x: 0, y: 0, surface: 'fairway' },
    ev('x3', 'zone', 6.8, 'x3', { mult: 3 }),
    ev('coins', 'coins', 1.2, 'coin', { index: 0 }),
    ev('ring', 'ring', 2.0, 'boost', { gain: 1.25 }),
    ev('coins', 'coins', 2.0, 'coin', { index: 1 }),
    { type: 'gadget', id: 'no-time', kind: 'ring', effect: 'boost' },
    { type: 'gadget', kind: 'ring', t: 1, effect: 'boost' },
    { type: 'tree', t: 3, x: 0, y: 0, z: 0, part: 'trunk' },
  ];
  const tl = gadgetTimeline(events);
  assert.deepEqual(tl.map((r) => `${r.id}:${r.effect}@${r.t}`), ['coins:coin@1.2', 'ring:boost@2', 'coins:coin@2', 'x3:x3@6.8']);
  assert.equal(tl[1].ev.gain, 1.25, 'the event rides along with its extras');
  assert.deepEqual(gadgetTimeline(null), []);
  assert.deepEqual(gadgetTimeline([]), []);
});

test('a warp: the ball is out of sight from the mouth to the exit, and only then', () => {
  const tl = gadgetTimeline([
    ev('cannon', 'warp', 5.2, 'in', { to: 'cannon-out' }),
    ev('cannon-out', 'warp-exit', 5.9, 'out', { from: 'cannon' }),
    ev('pipe', 'warp', 9, 'in', { to: 'pipe-out' }),   // (its exit event lost: the default delay stands in)
  ]);
  const w = warpWindows(tl);
  assert.deepEqual(w, [{ t0: 5.2, t1: 5.9, from: 'cannon', to: 'cannon-out' }, { t0: 9, t1: 9.7, from: 'pipe', to: 'pipe-out' }]);
  assert.equal(ballHiddenAt(w, 5.19), false);
  assert.equal(ballHiddenAt(w, 5.2), true);
  assert.equal(ballHiddenAt(w, 5.89), true);
  assert.equal(ballHiddenAt(w, 5.9), false, 'it is back the moment it leaves the exit');
  assert.equal(ballHiddenAt(w, 9.3), true);
  assert.equal(ballHiddenAt([], 1), false);
  assert.equal(ballHiddenAt(null, 1), false);
});

test('a geyser fires on the shot\'s own clock: offset + k x cycle for burst seconds, mapped to the picture\'s time', () => {
  const g = { cycle: 4, offset: 2, burst: 1.5 };
  // the same clock: eruptions at 2, 6, 10 ... until the shot ends
  assert.deepEqual(geyserWindows(g, { playDur: 11 }), [{ t0: 2, t1: 3.5 }, { t0: 6, t1: 7.5 }, { t0: 10, t1: 11 }]);
  // the picture re-timed (arcade/feel.js warpShot): full speed to 5 s, then slow motion at a
  // quarter speed to the end of a 7 s shot (played over 5 + 8 = 13 s)
  const toPlayTime = (t) => (t <= 5 ? t : t >= 7 ? 13 : 5 + (t - 5) * 4);
  const w = geyserWindows(g, { toPlayTime, playDur: 13 });
  assert.deepEqual(w, [{ t0: 2, t1: 3.5 }, { t0: 9, t1: 13 }], 'the second eruption (6 s to 7.5 s of the shot) plays from 9 s, in slow motion, to the end');
  // an eruption wholly after the shot is not there (toPlayTime holds at its last sample)
  assert.deepEqual(geyserWindows({ cycle: 6, offset: 5.9, burst: 1 }, { toPlayTime: (t) => Math.min(t, 5), playDur: 5 }), []);
  assert.deepEqual(geyserWindows({ cycle: 0, burst: 1 }), []);
  assert.deepEqual(geyserWindows(null), []);

  // it can be SEEN coming: pressure climbs over the quiet stretch, peaks as it fires
  const st = (t) => geyserState(w, t);
  assert.deepEqual(st(2.75), { on: true, k: 0.5, pressure: 1 });
  assert.equal(st(1.99).on, false);
  assert.ok(st(0.5).pressure < st(1.5).pressure && st(1.5).pressure < st(1.99).pressure, 'building toward the first eruption');
  assert.ok(st(1.99).pressure > 0.95);
  assert.ok(st(4).pressure < st(8).pressure, 'and again toward the second');
  assert.equal(st(3.6).on, false);
  assert.ok(st(3.6).pressure <= 0.2, 'spent just after firing');
  assert.equal(st(9.5).on, true);
  // no shot in the air: it simmers
  assert.deepEqual(geyserState(null, 0), { on: false, k: 0, pressure: 0.15 });
  assert.deepEqual(geyserState([], 5), { on: false, k: 0, pressure: 0.15 });
  // identical for both players: nothing but the shot's time goes in
  assert.deepEqual(geyserWindows(g, { toPlayTime, playDur: 13 }), w);
});

// ---------------------------------------------------------------- shapes and the cameras

test('footprints and outlines: what the map draws', () => {
  assert.deepEqual(gadgetFootprint(GADGETS[0]), { x: 0, y: 120, r: 8 });
  const strip = gadgetOutline(GADGETS.find((g) => g.id === 'strip'));
  assert.equal(strip.closed, true);
  assert.equal(strip.points.length, 4);
  const along = Math.hypot(strip.points[3][0] - strip.points[0][0], strip.points[3][1] - strip.points[0][1]);
  const across = Math.hypot(strip.points[1][0] - strip.points[0][0], strip.points[1][1] - strip.points[0][1]);
  assert.ok(Math.abs(along - 36) < 1e-9 && Math.abs(across - 14) < 1e-9, 'a strip is its width across and its length along its heading');
  // a wall, a backboard and a ring are the line they stand on, across their heading
  const wall = gadgetOutline(GADGETS.find((g) => g.id === 'wall'));
  assert.equal(wall.closed, false);
  assert.ok(Math.abs(Math.hypot(wall.points[1][0] - wall.points[0][0], wall.points[1][1] - wall.points[0][1]) - 34) < 1e-9);
  const ring = gadgetOutline(GADGETS[0]);
  assert.deepEqual(ring.points.map((p) => p.map((v) => +v.toFixed(6))), [[-8, 120], [8, 120]], 'a ring facing north spans east to west');
  assert.deepEqual(gadgetOutline(GADGETS.find((g) => g.id === 'coins')).points, [[0, 50], [0, 90], [0, 130], [0, 170]]);
  assert.equal(gadgetOutline(GADGETS.find((g) => g.id === 'x3')).points.length, 24);
  // the farther a ring hangs from the tee, the thicker its rim is drawn
  assert.ok(ringTubeM(60) < ringTubeM(200) && ringTubeM(200) < ringTubeM(320));
  assert.ok(ringTubeM(0) >= 0.45 && ringTubeM(5000) <= 1.6);
  assert.ok(farScale(0) === 1 && farScale(240) === 2 && farScale(9999) === 2.4);
});

test('obstacles: upright cylinders in PropsLayer.obstacles()\'s shape; a wall is a row, a ring only its rim', () => {
  const hAt = (x, y) => 4 + 0.01 * y;
  const obst = gadgetObstacles(GADGETS, hAt);
  for (const o of obst) {
    assert.ok(typeof o.id === 'string' && [o.x, o.y, o.r, o.base, o.top].every(Number.isFinite), JSON.stringify(o));
    assert.ok(o.r > 0 && o.top > o.base, JSON.stringify(o));
  }
  const of = (id) => obst.filter((o) => o.id === id);
  // what lies on the ground or is only light is no obstacle
  for (const id of ['pad', 'strip', 'funnel', 'ice', 'mud', 'coins', 'x3', 'x2']) assert.equal(of(id).length, 0, id);
  // the 34 m wall: a row across its heading, end to end, as tall as the wall
  const wall = of('wall');
  assert.ok(wall.length >= 9, `${wall.length} cylinders`);
  const ground = hAt(58, 128);
  for (const o of wall) { assert.ok(Math.abs(o.base - ground) < 1e-9 && Math.abs(o.top - (ground + 20)) < 1e-9); assert.ok(Math.hypot(o.x - 58, o.y - 128) <= 17 + 1e-9); }
  const span = Math.max(...wall.map((a) => Math.max(...wall.map((b) => Math.hypot(a.x - b.x, a.y - b.y)))));
  assert.ok(Math.abs(span - 34) < 1e-6, `it spans ${span.toFixed(1)} m`);
  for (let i = 1; i < wall.length; i++) assert.ok(Math.hypot(wall[i].x - wall[i - 1].x, wall[i].y - wall[i - 1].y) <= 2 * wall[i].r + 0.3, 'no gap a camera could slip through');
  // a bumper: one cylinder, its cap included
  assert.equal(of('bumper').length, 1);
  assert.ok(of('bumper')[0].top - of('bumper')[0].base >= 3.5);
  // a ring: its rim is in the way, the hole through it is not
  const ringObst = of('ring');
  assert.ok(ringObst.length >= 6);
  for (const o of ringObst) {
    const across = Math.hypot(o.x - 0, o.y - 120), mid = (o.base + o.top) / 2 - 30;
    assert.ok(Math.abs(Math.hypot(across, mid) - 8) < 1.3, `a piece of the rim (${across.toFixed(1)} m across, ${mid.toFixed(1)} m up)`);
  }
  assert.ok(ringObst.every((o) => o.hoop === true) && !obst.some((o) => o.hoop && o.id !== 'ring'));
  // ... and a ball cam's ceiling ignores the hoop altogether: it is flown through
  const ceil = gadgetCeiling(obst, 1);
  assert.equal(ceil(0, 120), -Infinity, 'the flight line through the ring is open to the camera');
  assert.equal(ceil(8, 120), -Infinity);
  assert.equal(ceil(300, 300), -Infinity);
  assert.ok(Math.abs(ceil(58, 128) - (ground + 20)) < 1e-9, 'over the wall: its top');
  assert.equal(gadgetCeiling([]), null);
  // the hanging pinata: from its own base, not from the ground
  assert.deepEqual([of('pinata')[0].base, of('pinata')[0].top], [8, 12]);
  // a rail follows its line
  assert.ok(of('rail').length >= 6);

  // the address camera's blockers (PropsLayer.blockers()'s shape): what stands on the ground,
  // at least 2.5 m tall; a ring in the air and a low rail hide nothing
  const blockers = gadgetBlockers(GADGETS, hAt);
  for (const b of blockers) assert.deepEqual(Object.keys(b).sort(), ['base', 'r', 'solid', 'top', 'x', 'y']);
  assert.ok(blockers.every((b) => b.solid === true && b.top - b.base >= 2.5));
  assert.ok(blockers.some((b) => Math.hypot(b.x - 58, b.y - 128) < 17.1 && b.top > ground + 19), 'the wall is one');
  assert.ok(!blockers.some((b) => Math.abs(b.y - 120) < 1e-9 && b.base > 20), 'the ring is not');
  assert.equal(gadgetBlockers(GADGETS.filter((g) => g.kind === 'rail'), hAt).length, 0);
  assert.deepEqual(gadgetObstacles(null, hAt), []);
});

// ---------------------------------------------------------------- the HUD

test('the stage intro\'s list: one row a kind, a wall says its speed, a warp and its exit are one', () => {
  const rows = gadgetSummary(GADGETS);
  const row = (label) => rows.find((r) => r.label === label);
  assert.deepEqual(row('Boost ring'), { kind: 'ring', label: 'Boost ring', short: 'BOOST', color: '#ffb21f', count: 1, note: '' });
  assert.equal(row('Wind tunnel').count, 2);
  assert.equal(row('Wall').note, '150 mph');
  assert.equal(row('Ice wall').note, '120 mph');
  assert.ok(row('Snowman') && row('Pinata') && row('Crates'));
  assert.equal(row('Cannon').count, 1);
  assert.equal(row('Warp pipe').count, 1);
  assert.ok(!rows.some((r) => r.kind === 'warp-exit'));
  assert.deepEqual(rows.filter((r) => r.kind === 'zone').map((r) => r.note).sort(), ['x2', 'x3']);
  assert.equal(gadgetSummaryText([GADGETS[0], GADGETS.find((g) => g.id === 'wall'), { id: 'b1', kind: 'bumper', x: 0, y: 0 }, { id: 'b2', kind: 'bumper', x: 3, y: 0 }]), 'Boost ring · Wall 150 mph · 2 Bumpers');
  assert.deepEqual(gadgetSummary(null), []);
  assert.deepEqual(gadgetSummary([{ kind: 'unknown' }, null]), []);
});

test('GADGETS AHEAD: the ones on or near the aim line as far as the club goes; the prediction\'s hits are ticked', () => {
  const from = { x: 0, y: 0 };
  // straight north: the ring, the fan and the coins on the line; the x3 ring 16 m right of it
  const north = gadgetsNearLine(GADGETS, from, 0, { reachM: 260, halfWidthM: 25 });
  assert.deepEqual(north.map((r) => r.id).filter((id) => ['ring', 'fan', 'x3', 'coins', 'wall', 'bumper'].includes(id)), ['fan', 'coins', 'ring', 'x3']);
  assert.equal(north.find((r) => r.id === 'ring').distYd, 131);
  assert.ok(!north.some((r) => r.kind === 'warp-exit'));
  // a short club: nothing beyond its reach
  assert.ok(!gadgetsNearLine(GADGETS, from, 0, { reachM: 100, halfWidthM: 25 }).some((r) => r.id === 'x3'));
  // aimed at the wall: the wall, not the ring
  const east = gadgetsNearLine(GADGETS, from, 24.4, { reachM: 200, halfWidthM: 10 });
  assert.ok(east.some((r) => r.id === 'wall') && !east.some((r) => r.id === 'ring'));
  // behind the ball: never
  assert.deepEqual(gadgetsNearLine(GADGETS, from, 180, { reachM: 300 }), []);

  // with the server's prediction: its hits first-class, its `ahead` list as given
  const pred = { totalYd: 280, gadgets: { hits: [{ id: 'ring', kind: 'ring', effect: 'boost', t: 2, x: 0, y: 120, z: 30 }, { id: 'x3', kind: 'zone', effect: 'x3', t: 6.8, x: 16, y: 239, z: 5 }], ahead: [{ id: 'fan', kind: 'fan', label: 'Wind tunnel', distYd: 92, offlineYd: 0 }, { id: 'ring', kind: 'ring', distYd: 131, offlineYd: 0 }] } };
  assert.deepEqual(lineupGadgets(GADGETS, pred, from, 0), [
    { id: 'fan', kind: 'fan', short: 'FAN', distYd: 92, hit: false },
    { id: 'ring', kind: 'ring', short: 'BOOST', distYd: 131, hit: true },
    { id: 'x3', kind: 'zone', short: 'MULTI', distYd: 262, hit: true },
  ]);
  // before the prediction lands (or from a server that sends none): worked out on the client
  const own = lineupGadgets(GADGETS, null, from, 0);
  assert.ok(own.length >= 3 && own.every((r) => r.hit === false));
  assert.deepEqual(lineupGadgets([], pred, from, 0), []);
  assert.deepEqual(lineupGadgets(null, null, from, 0), []);
});

// ---------------------------------------------------------------- the layer

// a canvas that takes any 2D call (the layer paints its own textures)
function fakeDocument() {
  const ctx = () => new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 10 }) : () => {}),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return { createElement: () => ({ width: 0, height: 0, getContext: ctx }) };
}

async function makeLayer(gadgets = GADGETS, env = {}) {
  globalThis.document ||= fakeDocument();
  const { GadgetLayer } = await import('../public/render/gadgets.js');
  const scene = new THREE.Scene();
  let changes = 0;
  const layer = new GadgetLayer({ scene, hAt: flat, V: (x, y, z) => new THREE.Vector3(x, z, -y), onChange: () => { changes++; }, env: () => ({ quality: 'high', night: false, ...env }) });
  layer.setCourse({ gadgets, holes: [{ tee: [0, 0], pin: [16, 261] }], arcade: { theme: 'desert' } });
  return { layer, scene, changes: () => changes };
}

test('the layer: every kind builds, the idle motion runs, a course without gadgets draws nothing', async () => {
  const { layer, scene } = await makeLayer();
  assert.equal(layer.count, GADGETS.length, 'one record a gadget');
  assert.deepEqual(layer.describe().map((r) => r.kind).sort(), GADGETS.map((g) => g.kind).sort());
  assert.ok(scene.getObjectByName('gadgets').children.length >= GADGETS.length);
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(0, 30, 40);
  for (let f = 0; f < 90; f++) layer.update(f / 30, cam);   // three seconds of idle frames
  assert.equal(layer.describe().find((r) => r.id === 'geyser').on, false, 'no shot: the geyser simmers');
  // low graphics builds too
  const low = await makeLayer(GADGETS, { quality: 'low' });
  assert.equal(low.layer.count, GADGETS.length);
  // nothing without gadgets; a new course replaces the old one's
  const v = layer.version;
  layer.setCourse({ gadgets: null });
  assert.equal(layer.count, 0);
  assert.ok(layer.version > v, 'the cameras\' cache key moved');
  assert.equal(scene.getObjectByName('gadgets').children.length, 0);
  assert.deepEqual(layer.obstacles(), []);
  assert.equal(layer.ceiling(), null);
  layer.update(4, cam);
  layer.step(1, { x: 0, y: 0, z: 0 });
  layer.setSeeThrough(null, { x: 0, y: 0, z: 2 }, null);
  // an entry the layer does not know is skipped, not fatal
  layer.setCourse({ gadgets: [{ id: 'x', kind: 'not-a-gadget', x: 0, y: 0 }, GADGETS[0]] });
  assert.equal(layer.count, 1);
  layer.dispose();
  assert.equal(scene.getObjectByName('gadgets'), undefined);
});

test('a shot: each contact plays when the ball reaches it, the cue hook hears it, and what broke stands again', async () => {
  const { layer } = await makeLayer();
  const cam = new THREE.PerspectiveCamera();
  const heard = [];
  layer.onHit = (e) => heard.push(`${e.id}:${e.effect}`);
  const events = [
    ev('coins', 'coins', 0.5, 'coin', { index: 0 }),
    ev('coins', 'coins', 0.9, 'coin', { index: 1 }),
    ev('ring', 'ring', 1.5, 'boost', { gain: 1.25 }),
    ev('wall', 'breakable', 2.4, 'smash', { needMph: 150, style: 'wall' }),
    ev('cannon', 'warp', 3.0, 'in', { to: 'cannon-out' }),
    ev('cannon-out', 'warp-exit', 3.7, 'out', { from: 'cannon' }),
    ev('snowman', 'breakable', 4.2, 'bounce', { needMph: 60 }),
    ev('gone', 'ring', 4.4, 'boost'),   // a gadget this client does not have: its effect still plays, harmlessly
    ev('x3', 'zone', 5.0, 'x3', { mult: 3 }),
  ];
  let frame = 0;
  const tick = (t, ball) => { layer.step(t, ball); layer.update(frame++ / 60 + 10, cam); };
  layer.update(10, cam);
  layer.onShot(events, { toPlayTime: (t) => t, playDur: 6 });
  const state = (id) => layer.describe().find((r) => r.id === id);
  tick(0.4, { x: 0, y: 30, z: 8 });
  assert.deepEqual(heard, [], 'nothing before the ball gets there');
  assert.equal(state('coins').coinsLeft, 4);
  tick(0.6, { x: 0, y: 50, z: 12 });
  assert.deepEqual(heard, ['coins:coin']);
  assert.equal(state('coins').coinsLeft, 3);
  tick(1.6, { x: 0, y: 120, z: 30 });
  assert.deepEqual(heard, ['coins:coin', 'coins:coin', 'ring:boost']);
  assert.equal(state('wall').broken, false);
  tick(2.5, { x: 58, y: 128, z: 10 });
  assert.equal(state('wall').broken, true, 'the wall is down');
  assert.equal(layer.ballHidden(2.9), false);
  tick(3.1, { x: -40, y: 128, z: 1 });
  assert.equal(layer.ballHidden(3.1), true, 'inside the cannon');
  assert.equal(layer.ballHidden(3.69), true);
  tick(3.8, { x: -40, y: 133, z: 3 });
  assert.equal(layer.ballHidden(3.8), false, 'and out of its muzzle');
  tick(4.5, { x: -62, y: 120, z: 1 });
  assert.equal(state('snowman').broken, false, 'a breakable that held is shaken, not broken');
  tick(5.5, { x: 16, y: 239, z: 0 });
  assert.deepEqual(heard, ['coins:coin', 'coins:coin', 'ring:boost', 'wall:smash', 'cannon:in', 'cannon-out:out', 'snowman:bounce', 'gone:boost', 'x3:x3']);
  // the geyser's cycle ran on the shot's clock
  assert.deepEqual(state('geyser').windows, [{ t0: 2, t1: 3.5 }]);
  // the ball stops: geysers settle at once; the wall and the coins stand again a moment later, by themselves
  layer.endShot();
  assert.equal(state('geyser').on, false);
  assert.equal(state('wall').broken, true, 'not the instant the ball stops');
  for (let i = 0; i < 240; i++) layer.update(frame++ / 60 + 10, cam);   // four seconds
  assert.equal(state('wall').broken, false, 'it stands again for the next swing');
  assert.equal(state('coins').coinsLeft, 4);
  // a new swing while something is still down: everything is back before it flies
  layer.onShot([ev('wall', 'breakable', 0.2, 'smash')], {});
  tick(0.3, { x: 58, y: 128, z: 10 });
  assert.equal(state('wall').broken, true);
  layer.onShot([], {});
  assert.equal(state('wall').broken, false);
  // a shot whose picture is cut off (no more steps) is let go, and its remaining contacts are not played late
  heard.length = 0;
  layer.onShot([ev('ring', 'ring', 9, 'boost')], {});
  tick(0.1, { x: 0, y: 1, z: 1 });
  for (let i = 0; i < 200; i++) layer.update(frame++ / 60 + 10, cam);
  assert.deepEqual(heard, []);
  assert.equal(layer.ballHidden(0.5), false);
  // a contact in the shot's very last frame still plays when the shot ends
  layer.onShot([ev('pad', 'pad', 0.9, 'launch')], {});
  tick(0.5, { x: 0, y: 1, z: 1 });
  layer.endShot();
  assert.deepEqual(heard, ['pad:launch']);
  // a broken onHit never breaks the picture
  layer.onHit = () => { throw new Error('audio fell over'); };
  const warn = console.warn; console.warn = () => {};
  try { layer.onShot([ev('ring', 'ring', 0.1, 'boost')], {}); tick(0.2, null); } finally { console.warn = warn; }
});

test('camera-safe: the layer\'s obstacle lists, and the pass-through fades what stands in the way', async () => {
  const { layer } = await makeLayer();
  const cam = new THREE.PerspectiveCamera();
  assert.deepEqual(layer.obstacles(), gadgetObstacles(GADGETS, flat));
  assert.equal(layer.ceiling()(0, 120), -Infinity, 'the ball cam follows the ball through a ring');
  assert.ok(layer.blockers().length > 0);
  assert.ok(layer.blockers({ x: 58, y: 128 }).length < layer.blockers().length, 'nothing for the gadget the ball lies against');
  assert.ok(layer.ceiling()(58, 128) >= 20);
  assert.equal(layer.seeThroughCount(), 0);
  // the address camera 12 m short of the wall, the ball 6 m behind it: the wall is in the way
  const d = Math.sin(24.4 * Math.PI / 180), n = Math.cos(24.4 * Math.PI / 180);
  const at = (m) => ({ x: d * m, y: n * m });
  const camAt = at(128), ball = at(146.5);
  const line = { x: camAt.x, y: camAt.y, ux: d, uy: n, d: 18.5, camZ: 4, ballZ: 0.1, endZ: 0, aheadM: 30 };
  layer.setSeeThrough(line, { ...camAt, z: 4 }, ball);
  assert.equal(layer.describe().find((r) => r.id === 'wall').ghost, true);
  assert.equal(layer.describe().find((r) => r.id === 'bumper').ghost, false, 'and only what is in the way');
  assert.equal(layer.seeThroughCount(), 1);
  for (let f = 0; f < 30; f++) layer.update(f / 30, cam);   // it fades, it does not pop
  // the line gone (a shot is away): solid again
  layer.setSeeThrough(null, { x: 0, y: -20, z: 30 }, null);
  assert.equal(layer.seeThroughCount(), 0);
  // a camera inside the cannon's barrel, a ball at rest against a bumper
  layer.setSeeThrough(null, { x: -40, y: 133, z: 2 }, { x: -70, y: 201 });
  const ghosts = layer.describe().filter((r) => r.ghost).map((r) => r.id).sort();
  assert.ok(ghosts.includes('bumper') && ghosts.includes('cannon-out'), ghosts.join(', '));
});

// ---------------------------------------------------------------- the hooks

test('wired in: the scene, the page, the map, the stage intro and the cameras', () => {
  const scene = read('public/render/scene.js');
  for (const hook of [
    "import { GadgetLayer } from './gadgets.js'", 'this.gadgets = new GadgetLayer(', 'this.gadgets.setCourse(geo)',
    'this.gadgets.onShot(opts.events', 'this.gadgets.step(a.t, p)', 'this.gadgets.ballHidden(a.t)', 'this.gadgets.endShot()',
    'this.gadgets.update(frameTime, this.camera)', 'this.gadgets.setSeeThrough(', 'this.gadgets.ceiling()',
  ]) assert.ok(scene.includes(hook), `scene.js: ${hook}`);
  const app = read('public/app.js');
  assert.match(app, /scene\.gadgets\.onHit = /);
  assert.match(app, /arcadeAudio\.cue\?\.\(name, \{ intensity: cueIntensity\(ev\) \}\)/, 'through the guarded cue API');
  assert.match(app, /toPlayTime: shot\.sim\.toPlayTime \|\| null/);
  assert.match(app, /matchUI\.setStageGadgets\?\.\(/);
  assert.match(read('public/aim-map.js'), /this\._drawGadgets\(ctx, view, w, h, ui\)/);
  assert.match(read('public/render/see-over-rig.js'), /sc\.gadgets\?\.blockers\?\.\(sc\.ballSim\)/);
  assert.match(read('public/arcade/shell.js'), /sc\.gadgets\.obstacles\(\)/);
  const match = read('public/arcade/match.js');
  assert.match(match, /setStageGadgets\(id, rows\)/);
  assert.match(match, /class="mt-gadgets"/);
  assert.match(read('public/arcade/match.css'), /\.mt-gadget \{/);
  // the layer draws: it never decides where a ball goes, and nothing in it is random
  const layer = read('public/render/gadgets.js');
  assert.ok(!/Math\.random/.test(layer), 'no randomness in a picture both players watch');
  assert.ok(!/fetch\(|XMLHttpRequest|new Audio|AudioContext/.test(layer), 'no network, no sound of its own');
  // a cue the engine does not know is silent: unknown names fall out of the mix table
  const audio = read('public/arcade/audio.js');
  assert.match(audio, /const cat = CUE_CATEGORY\[name\][^\n]*\n\s*if \(!cat\) return false;/);
});

// ---------------------------------------------------------------- the announcer

test('a gadget callout has no voice line yet: the banner shows, the announcer skips it and speaks the next line', async () => {
  const { VoiceQueue } = await import('../public/arcade/voice/queue.js');
  const { calloutOf } = await import('../public/arcade/arcade.js').catch(() => ({ calloutOf: null }));
  const ids = ['full-trail', 'smashed-it', 'triple-up', 'warp-speed', 'ring-it', 'double-up', 'thar-she-blows', 'boing', 'pinball', 'turbo', 'denied', 'stuck'];
  // the banner takes any callout with a text (arcade.js calloutOf: an unknown id is no reason to drop it)
  if (calloutOf) {
    for (const id of ids) {
      const c = calloutOf({ callout: { id, text: `${id.toUpperCase()}!`, tone: 'good', voice: id } });
      assert.ok(c && c.id === id && c.text, `${id}: the banner has it`);
    }
  }
  // the pack has no clip for them: load() resolves null, the queue moves on and does not stall
  const spoken = [];
  const q = new VoiceQueue({
    load: (item) => Promise.resolve(item.id === 'nice-shot' ? { id: item.id } : null),
    play: (clip, done) => { spoken.push(clip.id); setTimeout(done, 5); return () => {}; },
  });
  for (const id of ids) assert.equal(typeof q.say(id), 'boolean', `${id}: say never throws`);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(q.busy, false, 'nothing is left waiting behind a line that does not exist');
  assert.equal(q.say('nice-shot'), true);
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(spoken, ['nice-shot']);
});
