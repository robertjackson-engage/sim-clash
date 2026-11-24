'use strict';
// Course gadgets (v3:gadgets; docs/gadgets.md).
//   lib/gadgets.js                 the kinds, the data, the physics field, the arcade's side
//   lib/physics.js                 simulateShot's opts.gadgets (the hooks)
//   lib/game.js                    Game.gadgets, result.gadgets, Rocket / Ghost
//   lib/arcade.js                  coins, points, the multiplier, the callouts
//   lib/predict.js                 the lineup flies the club through them
//   lib/playability.js             a lie is judged with them in play
//   tools/arcade-holes/gadgets.js  authoring and validation; every stage's set
// Off (a course with no gadgets): the simulator it was, to the last bit.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { simulateShot, YD, MPH } = require('../lib/physics');
const G = require('../lib/gadgets');
const { Game } = require('../lib/game');
const A = require('../lib/arcade');
const P = require('../lib/playability');
const { predictShot } = require('../lib/predict');
const { createMatch } = require('../lib/match');
const L = require('../tools/arcade-holes/lib.js');
const T = require('../tools/arcade-holes/gadgets.js');
const { COURSES, STAGES, PIECES, buildCourse } = require('../tools/arcade-holes/courses.js');

const flat = { h: () => 0, grad: () => ({ dx: 0, dy: 0 }) };
const fairway = () => 'fairway';
const DRIVE = { speedMph: 150, vla: 12, hla: 0, totalSpin: 2600, spinAxis: 0 };
// one swing north from the origin over level fairway, through `gadgets`
function fly(launch, gadgets, opts = {}, surfaceAt = fairway) {
  const n = G.normalizeGadgets(gadgets);
  assert.deepEqual(n.problems, [], 'the test gadgets are sound');
  return simulateShot(launch, { x: 0, y: 0 }, 0, surfaceAt, { terrain: flat, gadgets: G.gadgetField(gadgets, flat), ...opts });
}
const plain = (launch, opts = {}, surfaceAt = fairway) => simulateShot(launch, { x: 0, y: 0 }, 0, surfaceAt, { terrain: flat, ...opts });
const near = (got, want, tol, what) => assert.ok(Math.abs(got - want) <= tol, `${what}: ${got} (expected ${want} +/- ${tol})`);
const effects = (sim) => sim.gadgets.map((h) => `${h.id}:${h.effect}`);
const PLAIN = plain(DRIVE);          // carry 244.4 yd, total 265.3 yd, lands 223.5 m out after 6.19 s
const LAND_Y = PLAIN.land.y;

// ---------------------------------------------------------------- the data

test('the kinds: sixteen, each with a label, where it may stand and what it pays', () => {
  assert.deepEqual(G.KIND_IDS, ['ring', 'pad', 'strip', 'fan', 'geyser', 'bumper', 'rail', 'backboard', 'funnel', 'ice', 'mud', 'warp', 'warp-exit', 'breakable', 'coins', 'zone']);
  for (const id of G.KIND_IDS) {
    const k = G.KINDS[id];
    assert.ok(k.label && Array.isArray(k.on) && k.reward && typeof k.solid === 'boolean', id);
  }
  // what a Ghost ball passes through, and what may not stand in the safe route
  assert.deepEqual(G.KIND_IDS.filter((id) => G.KINDS[id].solid), ['bumper', 'rail', 'backboard', 'breakable']);
  // only a coin trail may hang in a sudden-death arena
  assert.deepEqual(G.KIND_IDS.filter((id) => G.KINDS[id].cosmetic), ['coins']);
});

test('normalizeGadgets fills in the defaults and keeps only what a kind uses', () => {
  const { gadgets, problems } = G.normalizeGadgets([
    { id: 'r', kind: 'ring', x: 1.234, y: 100, z: 20, heading: 370, colour: 'red' },
    { id: 'w', kind: 'breakable', x: 0, y: 50, size: [20, 8], heading: 180, breakMph: 150 },
    { id: 'c', kind: 'breakable', x: 9, y: 50, style: 'crate' },
    { id: 'm', kind: 'warp', x: 0, y: 10, pair: 'e' },
    { id: 'e', kind: 'warp-exit', x: 0, y: 12, heading: 0 },
    { id: 'z', kind: 'zone', x: 0, y: 200, mult: 3 },
    { id: 't', kind: 'coins', points: [[0, 10, 5], [0, 20, 8], [0, 30, 9]] },
  ]);
  assert.deepEqual(problems, []);
  assert.deepEqual(gadgets[0], { id: 'r', kind: 'ring', x: 1.23, y: 100, z: 20, heading: 10, radius: 8, strength: 1.25, reward: { coins: 25, points: 50 } });
  assert.deepEqual(gadgets[1], { id: 'w', kind: 'breakable', x: 0, y: 50, breakMph: 150, keep: 0.85, style: 'wall', size: [20, 8], heading: 180, reward: { coins: 50, points: 100 } });
  assert.deepEqual(gadgets[2], { id: 'c', kind: 'breakable', x: 9, y: 50, breakMph: 120, keep: 0.85, style: 'crate', radius: 2.5, height: 4, reward: { coins: 50, points: 100 } });
  assert.deepEqual(gadgets[3], { id: 'm', kind: 'warp', x: 0, y: 10, radius: 3, delay: 0.7, style: 'pipe', pair: 'e', reward: { coins: 20, points: 50 } });
  assert.deepEqual(gadgets[4], { id: 'e', kind: 'warp-exit', x: 0, y: 12, heading: 0, angle: 45, speedMph: 90, style: 'pipe' });
  assert.deepEqual(gadgets[5], { id: 'z', kind: 'zone', x: 0, y: 200, radius: 10, mult: 3 });
  assert.deepEqual(gadgets[6], { id: 't', kind: 'coins', points: [[0, 10, 5], [0, 20, 8], [0, 30, 9]], x: 0, y: 10, reach: 5, reward: { coins: 5, bonusCoins: 50, bonusPoints: 150 } });
  // nothing, and not a list
  assert.deepEqual(G.normalizeGadgets(undefined), { gadgets: [], problems: [] });
  assert.deepEqual(G.normalizeGadgets({}).problems, ['gadgets must be an array']);
});

test('normalizeGadgets names what is wrong: kinds, ids, sizes, pairs', () => {
  const bad = (list, re) => {
    const { gadgets, problems } = G.normalizeGadgets(list);
    assert.ok(problems.some((p) => re.test(p)), `${JSON.stringify(problems)} should match ${re}`);
    return gadgets;
  };
  bad([{ id: 'a', kind: 'trampoline', x: 0, y: 0 }], /kind must be one of ring, pad/);
  bad([{ kind: 'pad', x: 0, y: 0 }], /id is missing/);
  bad([{ id: 'a', kind: 'pad', x: 0, y: 0 }, { id: 'a', kind: 'pad', x: 9, y: 9 }], /its id is used twice/);
  bad([{ id: 'a', kind: 'pad', x: 'left', y: 0 }], /x and y must be numbers/);
  bad([{ id: 'a', kind: 'ring', x: 0, y: 0, heading: 0 }], /needs z, or alt/);
  bad([{ id: 'a', kind: 'ring', x: 0, y: 0, z: 9, radius: 40, heading: 0 }], /radius must be 3 to 20/);
  bad([{ id: 'a', kind: 'ring', x: 0, y: 0, z: 9, strength: 3, heading: 0 }], /strength must be 1.05 to 1.6/);
  bad([{ id: 'a', kind: 'ring', x: 0, y: 0, z: 9 }], /heading must be a compass bearing/);
  bad([{ id: 'a', kind: 'strip', x: 0, y: 0, heading: 0 }], /size must be \[width, length\]/);
  bad([{ id: 'a', kind: 'strip', x: 0, y: 0, heading: 0, size: [2, 500] }], /size must be/);
  bad([{ id: 'a', kind: 'geyser', x: 0, y: 0, cycle: 3, burst: 2.8 }], /burst must leave half a second/);
  bad([{ id: 'a', kind: 'zone', x: 0, y: 0, mult: 2.5 }], /mult must be 2 or 3/);
  bad([{ id: 'a', kind: 'breakable', x: 0, y: 0, style: 'vase' }], /style must be one of wall, crate, ice-wall, snowman, pinata/);
  bad([{ id: 'a', kind: 'breakable', x: 0, y: 0, breakMph: 400 }], /breakMph must be 30 to 220/);
  bad([{ id: 'a', kind: 'coins', points: [[0, 0, 1], [1, 1, 1]] }], /points must be 3\+ of \[x, y, z\]/);
  bad([{ id: 'a', kind: 'rail', points: [[0, 0]] }], /points must be 2\+ of \[x, y\]/);
  bad([{ id: 'a', kind: 'pad', x: 0, y: 0, reward: { coins: -5 } }], /reward.coins must be a whole number/);
  bad([{ id: 'a', kind: 'fan', x: 0, y: 0, heading: 0, size: [20, 20, 20], strength: 0 }], /needs a strength or a lift/);
  // a warp without its exit, an exit without a warp: named, and neither is kept
  assert.deepEqual(bad([{ id: 'm', kind: 'warp', x: 0, y: 0, pair: 'nowhere' }], /its pair 'nowhere' is not a warp-exit/), []);
  assert.deepEqual(bad([{ id: 'e', kind: 'warp-exit', x: 0, y: 0, heading: 0 }], /no warp fires from it/), []);
  // one bad gadget does not take the good ones with it
  assert.deepEqual(bad([{ id: 'ok', kind: 'mud', x: 0, y: 0 }, { id: 'no', kind: 'zone', x: 0, y: 0, radius: 99 }], /radius must be 4 to 25/).map((g) => g.id), ['ok']);
  assert.ok(G.normalizeGadgets(Array.from({ length: 41 }, (_, i) => ({ id: `m${i}`, kind: 'mud', x: i, y: 0 }))).problems.some((p) => /at most 40/.test(p)));
});

test('resolveGadgets turns alt (above the ground) into z; gadgetField is null without gadgets', () => {
  const hill = { h: (x, y) => 10 + y / 10, grad: () => ({ dx: 0, dy: 0.1 }) };
  const { gadgets } = G.normalizeGadgets([{ id: 'r', kind: 'ring', x: 0, y: 100, alt: 15, heading: 0 }]);
  assert.equal(gadgets[0].alt, 15);
  assert.deepEqual(G.resolveGadgets(gadgets, hill)[0], { id: 'r', kind: 'ring', x: 0, y: 100, heading: 0, radius: 8, strength: 1.25, reward: { coins: 25, points: 50 }, z: 35 });
  assert.equal(G.gadgetField(undefined, flat), null);
  assert.equal(G.gadgetField([], flat), null);
  assert.equal(G.gadgetField([{ id: 'x', kind: 'nothing' }], flat), null, 'a list of nothing sound is no field');
  assert.equal(G.gadgetField([{ id: 'm', kind: 'mud', x: 0, y: 0 }], flat).count, 1);
});

// ---------------------------------------------------------------- off is off

test('no gadgets: the simulator it was, to the last bit; and a putt is never touched', () => {
  for (const l of [DRIVE, { speedMph: 91, vla: 25.5, hla: 3, totalSpin: 9300, spinAxis: -4 }, { speedMph: 60, vla: 2, hla: 0, totalSpin: 2000, spinAxis: 0 }]) {
    const base = plain(l);
    assert.deepEqual(plain(l, { gadgets: null }), base);
    assert.deepEqual(plain(l, { gadgets: undefined, gadgetGhost: true, gadgetSmash: true }), base);
    assert.equal('gadgets' in base, false, 'no gadget list on a course without gadgets');
    // a field the ball never meets: the same flight, and an empty list
    const far = fly(l, [{ id: 'far', kind: 'bumper', x: 400, y: 400 }, { id: 'ring', kind: 'ring', x: 300, y: 300, z: 20, heading: 0 }]);
    const { gadgets, ...rest } = far;
    assert.deepEqual(gadgets, []);
    assert.deepEqual(rest, base);
  }
  // a putt across a funnel, a strip, mud and a pad rolls as if they were not there
  const green = () => 'green';
  const putt = { speedMph: 9, vla: 0, hla: 0, totalSpin: 0, spinAxis: 0 };
  const field = [
    { id: 'f', kind: 'funnel', x: 3, y: 6, radius: 9 }, { id: 's', kind: 'strip', x: 0, y: 5, size: [6, 10], heading: 90 },
    { id: 'm', kind: 'mud', x: 0, y: 8, radius: 3 }, { id: 'p', kind: 'pad', x: 0, y: 3, radius: 2 },
  ];
  const rolled = fly(putt, field, {}, green);
  assert.equal(rolled.isPutt, true);
  assert.deepEqual(rolled, plain(putt, {}, green), 'no gadget key, no event, the same roll');
});

// ---------------------------------------------------------------- each kind, with numbers

test('boost ring: a 150 mph drive through a x1.25 ring 100 m out gains 49 yd of carry', () => {
  // the drive is 21.4 m up and doing 90.2 mph there
  const ring = { id: 'r', kind: 'ring', x: 0, y: 100, z: 21.4, radius: 8, heading: 0, strength: 1.25 };
  const sim = fly(DRIVE, [ring]);
  near(PLAIN.carryYd, 244.4, 0.1, 'the plain drive carries');
  near(sim.carryYd, 293.5, 0.2, 'through the ring it carries');
  near(sim.totalYd, 316.2, 0.3, 'and finishes');
  assert.equal(sim.gadgets.length, 1);
  const hit = sim.gadgets[0];
  assert.deepEqual({ ...hit, t: 0, mphIn: 0, mphOut: 0, z: 0 }, { id: 'r', kind: 'ring', t: 0, x: 0, y: 100, z: 0, effect: 'boost', gain: 1.25, mphIn: 0, mphOut: 0, coins: 25, points: 50 });
  near(hit.t, 1.968, 0.01, 'it goes through at');
  near(hit.mphIn, 90.2, 0.2, 'doing');
  near(hit.mphOut, 112.7, 0.3, 'and leaves at');
  near(hit.mphOut / hit.mphIn, 1.25, 1e-3, 'its gain');
  // the same contact is in the event list, with its time
  assert.deepEqual(sim.events.filter((e) => e.type === 'gadget'), [{ type: 'gadget', ...hit }]);
  // miss it and nothing happens: 12 m wide of an 8 m ring is the plain drive
  const miss = fly(DRIVE, [{ ...ring, x: 12 }]);
  assert.deepEqual(miss.gadgets, []);
  assert.equal(miss.carryYd, PLAIN.carryYd);
  assert.equal(miss.totalYd, PLAIN.totalYd);
  // under it, over it: the same
  assert.deepEqual(fly(DRIVE, [{ ...ring, z: 32 }]).gadgets, []);
  assert.deepEqual(fly(DRIVE, [{ ...ring, z: 11 }]).gadgets, []);
  // a ring acts once, and from either side
  assert.equal(fly(DRIVE, [{ ...ring, heading: 180 }]).carryYd, sim.carryYd);
});

test('breakable wall: 149 mph bounces off the 150 wall, 150 and 151 break it and keep 85 % of their speed', () => {
  // a wall 60 m out, 24 m high: the drive meets it 13.4 m up
  const wall = { id: 'w', kind: 'breakable', x: 0, y: 60, size: [30, 24], heading: 180, breakMph: 150 };
  const held = fly({ ...DRIVE, speedMph: 149 }, [wall]);
  assert.deepEqual(effects(held), ['w:bounce']);
  assert.equal(held.gadgets[0].needMph, 150);
  assert.equal(held.gadgets[0].coins, undefined, 'a wall that held pays nothing');
  assert.ok(held.end.y < 60, `the ball came back off it and lies ${held.end.y.toFixed(1)} m out, short of the wall`);
  for (const mph of [150, 151]) {
    const broke = fly({ ...DRIVE, speedMph: mph }, [wall]);
    assert.deepEqual(effects(broke), ['w:smash'], `${mph} mph`);
    assert.deepEqual([broke.gadgets[0].coins, broke.gadgets[0].points, broke.gadgets[0].style], [50, 100, 'wall']);
    assert.ok(broke.end.y > 180, `${mph} mph went through and finished ${broke.end.y.toFixed(0)} m out`);
  }
  near(fly({ ...DRIVE, speedMph: 151 }, [wall]).carryYd, 208.1, 0.3, 'through at 85 %, the 151 mph drive carries');
  near(plain({ ...DRIVE, speedMph: 151 }).carryYd, 246.5, 0.5, '(without the wall)');
  // keep: 1 takes nothing
  assert.equal(fly({ ...DRIVE, speedMph: 151 }, [{ ...wall, keep: 1 }]).carryYd, plain({ ...DRIVE, speedMph: 151 }).carryYd);
  // over the top of it: untouched
  assert.deepEqual(fly(DRIVE, [{ ...wall, size: [30, 10] }]).gadgets, []);
  // wide of it: untouched
  assert.deepEqual(fly(DRIVE, [{ ...wall, x: 20 }]).gadgets, []);
  // a wall hanging in the air (z: its foot): the ball that flies under it is untouched too
  assert.deepEqual(fly(DRIVE, [{ ...wall, z: 16, size: [30, 10] }]).gadgets, []);
  assert.deepEqual(effects(fly(DRIVE, [{ ...wall, z: 9, size: [30, 10] }])), ['w:smash']);
});

test('breakables and power-up balls: a Rocket smashes any of them and loses nothing; a Ghost passes through', () => {
  const wall = { id: 'w', kind: 'breakable', x: 0, y: 30, size: [30, 24], heading: 180, breakMph: 150 };
  const slow = { ...DRIVE, speedMph: 100 };
  const open = plain(slow);
  assert.deepEqual(effects(fly(slow, [wall])), ['w:bounce']);
  const rocket = fly(slow, [wall], { gadgetSmash: true });
  assert.deepEqual(effects(rocket), ['w:smash']);
  assert.equal(rocket.carryYd, open.carryYd, 'the Rocket keeps all its speed');
  const ghost = fly(slow, [wall, { id: 'b', kind: 'bumper', x: 0, y: 60, height: 8, radius: 3 }, { id: 'bb', kind: 'backboard', x: 0, y: 80, size: [20, 16], heading: 180 }], { gadgetGhost: true });
  assert.deepEqual(ghost.gadgets, [], 'no contact at all');
  assert.equal(ghost.carryYd, open.carryYd);
  // the arcade's Ghost is the ball that ignores trees: the same flag does it
  assert.deepEqual(fly(slow, [wall], { ignoreTrees: true }).gadgets, []);
  // but a Ghost still goes through a ring
  assert.deepEqual(effects(fly(DRIVE, [{ id: 'r', kind: 'ring', x: 0, y: 100, z: 21.4, heading: 0 }], { gadgetGhost: true })), ['r:boost']);
  // a round one (a crate): below its speed the ball comes off it, at it the ball goes through
  const crate = { id: 'c', kind: 'breakable', x: 0, y: 30, radius: 3, height: 9, breakMph: 100, style: 'crate' };
  assert.deepEqual(effects(fly({ ...DRIVE, speedMph: 99 }, [crate])), ['c:bounce']);
  assert.deepEqual(effects(fly({ ...DRIVE, speedMph: 100 }, [crate])), ['c:smash']);
  // a ball that trickles into a wall never breaks it, whatever it was launched at
  const trickle = fly({ ...DRIVE, speedMph: 151 }, [{ ...wall, y: PLAIN.end.y + 2 }]);
  assert.deepEqual(effects(trickle), ['w:bounce'], 'a 151 mph drive at the end of its roll');
});

test('bounce pad: a ball landing on it is thrown back up at the pad\'s angle', () => {
  const pad = { id: 'p', kind: 'pad', x: 0, y: LAND_Y, radius: 5, angle: 50 };
  const sim = fly(DRIVE, [pad]);
  assert.deepEqual(effects(sim), ['p:launch']);
  const hit = sim.gadgets[0];
  near(hit.mphIn, 63.7, 0.2, 'the drive comes down at');
  near(hit.speedMps, 28.46, 0.05, 'and leaves at (strength 1)');
  near(sim.carryYd, 244.4, 0.1, 'the carry is still the first touch');
  near(sim.totalYd, 329, 1, 'and it finishes');
  assert.ok(sim.totalYd - PLAIN.totalYd > 60, 'over 60 yd farther than the drive that bounced');
  // its second flight leaves at 50 degrees
  const i = sim.points.findIndex((q) => Math.abs(q.t - hit.t) < 1e-3);
  const a = sim.points[i + 1], b = sim.points[i + 3];
  near(Math.atan2(b.z - a.z, b.y - a.y) * 180 / Math.PI, 50, 2.5, 'the launch angle');
  // min and max bound it; a heading turns it
  near(fly(DRIVE, [{ ...pad, minMps: 34, maxMps: 40 }]).gadgets[0].speedMps, 34, 0.01, 'never slower than minMps');
  near(fly(DRIVE, [{ ...pad, minMps: 10, maxMps: 20 }]).gadgets[0].speedMps, 20, 0.01, 'never faster than maxMps');
  const east = fly(DRIVE, [{ ...pad, heading: 90 }]);
  assert.ok(east.end.x > 60 && Math.abs(east.end.y - LAND_Y) < 3, `thrown east: it finishes at (${east.end.x.toFixed(0)}, ${east.end.y.toFixed(0)})`);
  // once a shot: the second time it lands on the same pad it bounces as ever
  assert.equal(fly(DRIVE, [{ ...pad, angle: 80, minMps: 6, maxMps: 10, radius: 12 }]).gadgets.length, 1);
  // a rolling ball sets it off too
  const rolled = fly(DRIVE, [{ ...pad, y: PLAIN.end.y - 6, radius: 3 }]);
  assert.deepEqual(effects(rolled), ['p:launch']);
  near(rolled.gadgets[0].speedMps, 16, 0.01, 'a slow roller leaves at minMps');
});

test('speed strip: a ball rolling through it is run on along the strip\'s heading', () => {
  const strip = { id: 's', kind: 'strip', x: 0, y: 247, size: [14, 40], heading: 0 };
  const sim = fly(DRIVE, [strip]);
  assert.deepEqual(effects(sim), ['s:speed']);
  near(sim.totalYd, 361, 2, 'the drive that rolled 21 yd now finishes');
  assert.ok(sim.totalYd - PLAIN.totalYd > 90);
  // maxMps caps it; a strip across the line pushes the ball sideways
  assert.ok(fly(DRIVE, [{ ...strip, maxMps: 8 }]).totalYd < sim.totalYd - 30);
  const across = fly(DRIVE, [{ ...strip, size: [40, 14], heading: 90 }]);
  assert.ok(across.end.x > 15, `pushed east: ${across.end.x.toFixed(1)} m`);
  // a ball flying over it is untouched
  assert.deepEqual(fly(DRIVE, [{ ...strip, y: 100 }]).gadgets, []);
});

test('fan: a sideways tunnel blows the drive 57 yd off line; an updraft holds it up', () => {
  const side = fly(DRIVE, [{ id: 'f', kind: 'fan', x: 0, y: 120, size: [40, 60, 60], heading: 90, strength: 14 }]);
  assert.deepEqual(effects(side), ['f:push']);
  near(side.offlineYd, 56.6, 1.5, 'offline');
  const up = fly(DRIVE, [{ id: 'f', kind: 'fan', x: 0, y: 120, size: [40, 60, 60], heading: 0, strength: 0, lift: 8 }]);
  near(up.carryYd, 283.7, 1.5, 'carry with 8 m/s2 of lift over 60 m');
  assert.ok(up.apexFt > PLAIN.apexFt + 40);
  // a ball over the top of the tunnel is untouched
  assert.deepEqual(fly(DRIVE, [{ id: 'f', kind: 'fan', x: 0, y: 120, size: [40, 60, 12], heading: 90, strength: 14 }]).gadgets, []);
});

test('geyser: it fires on a cycle from the shot\'s time zero; a ball over it then is thrown up', () => {
  // the drive comes down over the vent 5.9 s after impact
  const vent = (o) => ({ id: 'g', kind: 'geyser', x: 0, y: LAND_Y, radius: 6, height: 40, strength: 24, ...o });
  const on = fly(DRIVE, [vent({ offset: 2, cycle: 6, burst: 5 })]);            // firing from 2 to 7 s
  assert.deepEqual(effects(on), ['g:erupt']);
  near(on.gadgets[0].t, 5.94, 0.05, 'thrown at');
  assert.ok(on.apexFt > PLAIN.apexFt + 15 && on.carryYd > PLAIN.carryYd + 40, `up to ${on.apexFt.toFixed(0)} ft and ${on.carryYd.toFixed(0)} yd of carry`);
  // quiet when the ball arrives (firing 0 to 1 s, 8 to 9 s): the plain drive
  const off = fly(DRIVE, [vent({ offset: 0, cycle: 8, burst: 1 })]);
  assert.deepEqual(off.gadgets, []);
  assert.equal(off.totalYd, PLAIN.totalYd);
  // the window is exact: it starts firing after the ball has gone, or stops 0.05 s before it comes
  assert.deepEqual(fly(DRIVE, [vent({ offset: 7.5, cycle: 8, burst: 0.5 })]).gadgets, []);
  assert.deepEqual(effects(fly(DRIVE, [vent({ offset: 5.2, cycle: 8, burst: 1 })])), ['g:erupt']);
  assert.deepEqual(fly(DRIVE, [vent({ offset: 4.8, cycle: 8, burst: 1 })]).gadgets, []);
  // deterministic: the same swing, the same result, every time
  const again = fly(DRIVE, [vent({ offset: 2, cycle: 6, burst: 5 })]);
  assert.deepEqual(again, on);
  // above the column the ball is untouched
  assert.deepEqual(fly(DRIVE, [vent({ y: 100, height: 12, offset: 0, cycle: 4, burst: 3.5 })]).gadgets, []);
});

test('bumper, rail, backboard: the solids', () => {
  // a post in the drive's roll kicks it away at 16 m/s
  const bumped = fly(DRIVE, [{ id: 'b', kind: 'bumper', x: 0.5, y: PLAIN.end.y - 6 }]);
  assert.deepEqual(effects(bumped), ['b:bump']);
  assert.equal(bumped.gadgets[0].speedMps, 16);
  assert.ok(bumped.end.y < PLAIN.end.y - 15 && bumped.end.x < -5, `kicked back and left: (${bumped.end.x.toFixed(1)}, ${bumped.end.y.toFixed(1)})`);
  // a rail across the roll does the same along its whole length
  const railed = fly(DRIVE, [{ id: 'r', kind: 'rail', points: [[-20, PLAIN.end.y - 5], [20, PLAIN.end.y - 5]], strength: 6 }]);
  assert.deepEqual(effects(railed), ['r:bump']);
  assert.ok(railed.end.y < PLAIN.end.y - 5);
  // a backboard takes the pace off a ball in flight: it drops short of where it was going
  const board = fly(DRIVE, [{ id: 'bb', kind: 'backboard', x: 0, y: 200, size: [20, 16], heading: 180 }]);
  assert.deepEqual(effects(board), ['bb:board']);
  assert.ok(board.end.y < 200 && board.end.y > 170, `it lies ${board.end.y.toFixed(1)} m out, at the board's foot`);
  // two posts a ball's width apart cannot hold a shot for ever
  const trap = fly({ speedMph: 60, vla: 1, hla: 0, totalSpin: 500, spinAxis: 0 }, [
    { id: 'n', kind: 'bumper', x: 0, y: 30, radius: 2, strength: 20 }, { id: 's', kind: 'bumper', x: 0, y: 12, radius: 2, strength: 20 },
    { id: 'e', kind: 'rail', points: [[4, 8], [4, 34]], strength: 20 }, { id: 'w', kind: 'rail', points: [[-4, 8], [-4, 34]], strength: 20 },
  ]);
  assert.ok(trap.gadgets.length <= G.MAX_BUMPS, `${trap.gadgets.length} contacts, then the solids are air`);
  assert.ok(trap.points[trap.points.length - 1].t < 60);
});

test('funnel, ice, mud: the ground', () => {
  const green = (x, y) => (Math.hypot(x, y - 100) < 22 ? 'green' : 'fairway');
  const pitch = { speedMph: 86, vla: 27, hla: 4, totalSpin: 9000, spinAxis: 0 };
  const bare = plain(pitch, {}, green);
  const drawn = fly(pitch, [{ id: 'f', kind: 'funnel', x: 0, y: 100, radius: 12, strength: 1.2 }], {}, green);
  assert.deepEqual(effects(drawn), ['f:funnel']);
  const off = (s) => Math.hypot(s.end.x, s.end.y - 100);
  assert.ok(off(bare) > 4 && off(drawn) < 2.2, `the bowl draws it in: ${off(bare).toFixed(1)} m from the middle without, ${off(drawn).toFixed(1)} m with`);
  // ice: the drive that lands on it slides on (friction 0.3 against the fairway's 2)
  const ice = fly(DRIVE, [{ id: 'i', kind: 'ice', x: 0, y: LAND_Y + 20, radius: 30 }]);
  assert.deepEqual(effects(ice), ['i:slide']);
  near(ice.totalYd, 325.6, 2, 'total on ice');
  // mud: it stops where it lands
  const mud = fly(DRIVE, [{ id: 'm', kind: 'mud', x: 0, y: LAND_Y, radius: 8 }]);
  assert.deepEqual(effects(mud), ['m:stuck']);
  near(mud.totalYd, mud.carryYd, 0.01, 'total = carry');
  // rolling into mud: stopped inside a metre (a topped ball that is running along the ground at 9 m/s)
  const topped = { speedMph: 70, vla: 2, hla: 0, totalSpin: 1500, spinAxis: 0 };
  const run = plain(topped);
  const edge = run.end.y - 20;
  const at = run.points.find((q) => q.y >= edge);
  assert.ok(at.z < 1e-6 && run.points.filter((q) => q.y >= edge).every((q) => q.z < 1e-6), 'it is rolling there');
  const bogged = fly(topped, [{ id: 'm', kind: 'mud', x: 0, y: edge + 4, size: [20, 8], heading: 0 }]);
  assert.deepEqual(effects(bogged), ['m:stuck']);
  assert.ok(bogged.end.y >= edge && bogged.end.y < edge + 1, `rolled ${(bogged.end.y - edge).toFixed(2)} m into it`);
});

test('warp: a ball entering the mouth is fired from the paired exit on the exit\'s trajectory', () => {
  const pipe = [
    { id: 'm', kind: 'warp', x: 0, y: LAND_Y, radius: 4, pair: 'e', delay: 0.7 },
    { id: 'e', kind: 'warp-exit', x: 50, y: 300, heading: 90, angle: 45, speedMph: 80 },
  ];
  const sim = fly(DRIVE, pipe);
  assert.deepEqual(effects(sim), ['m:in', 'e:out']);
  const [inn, out] = sim.gadgets;
  assert.deepEqual([inn.to, out.from, out.kind, out.speedMph], ['e', 'm', 'warp-exit', 80]);
  near(out.t - inn.t, 0.7, 1e-6, 'the ball is gone for the delay');
  assert.deepEqual([out.x, out.y, out.z], [50, 300, 1.5]);
  // the path: it holds at the mouth, then it is at the exit, heading due east at 45 degrees
  const k = sim.points.findIndex((q) => q.x === 50 && q.y === 300);
  assert.ok(k > 2);
  near(sim.points[k].t, out.t, 2e-3, 'at the exit when the event says');
  assert.deepEqual([sim.points[k - 1].x, sim.points[k - 2].x], [inn.x, inn.x]);
  near(sim.points[k - 1].t, out.t - 0.001, 2e-3, 'it waits in the mouth');
  const a = sim.points[k], b = sim.points[k + 3];
  near(Math.atan2(b.z - a.z, b.x - a.x) * 180 / Math.PI, 45, 2, 'fired at 45 degrees');
  near(b.y, 300, 0.05, 'due east');
  // an 80 mph ball at 45 degrees flies about 110 yd: it lands east of the exit on its line
  assert.ok(Math.abs(sim.end.y - 300) < 2 && sim.end.x > 130 && sim.end.x < 175, `it finishes at (${sim.end.x.toFixed(0)}, ${sim.end.y.toFixed(0)})`);
  // the carry ends at the mouth, not where the exit throws the ball
  near(sim.carryYd, 240.4, 1, 'carry to the mouth');
  near(sim.flightTime, inn.t, 2e-3, 'flight time to the mouth');
  // a mouth lying on the ground takes a rolling ball as well
  const rolled = fly(DRIVE, [{ ...pipe[0], y: PLAIN.end.y - 4, radius: 2 }, pipe[1]]);
  assert.deepEqual(effects(rolled), ['m:in', 'e:out']);
});

test('coin trail: each coin within reach is collected, the full set pays a bonus; multiplier ring: the first landing', () => {
  const at = (y) => { const q = PLAIN.points.find((p) => p.y >= y); return [0, y, q.z]; };
  const trail = { id: 'c', kind: 'coins', points: [60, 100, 140, 180].map(at) };
  const all = fly(DRIVE, [trail]);
  assert.deepEqual(all.gadgets.map((h) => [h.effect, h.coins, h.index]), [['coin', 5, 0], ['coin', 5, 1], ['coin', 5, 2], ['coin', 5, 3], ['full', 50, undefined]]);
  assert.deepEqual([all.gadgets[4].points, all.gadgets[4].count], [150, 4]);
  assert.equal(all.carryYd, PLAIN.carryYd, 'coins never touch the ball');
  assert.equal(all.totalYd, PLAIN.totalYd);
  // a coin 6 m off the flight is out of a 5 m reach: three coins, no bonus
  const some = fly(DRIVE, [{ ...trail, points: [at(60), at(100), [6, 140, at(140)[2]], at(180)] }]);
  assert.deepEqual(some.gadgets.map((h) => h.effect), ['coin', 'coin', 'coin']);
  // a multiplier ring: the first landing inside it, and only that
  const zone = { id: 'z', kind: 'zone', x: 0, y: LAND_Y, radius: 10, mult: 3 };
  assert.deepEqual(fly(DRIVE, [zone]).gadgets.map((h) => [h.effect, h.mult]), [['x3', 3]]);
  assert.deepEqual(fly(DRIVE, [{ ...zone, y: LAND_Y + 15, radius: 4 }]).gadgets, [], 'a ball that bounces or rolls into one earns nothing');
  assert.equal(fly(DRIVE, [zone]).totalYd, PLAIN.totalYd);
});

// ---------------------------------------------------------------- the arcade's side

test('gadgetAward: coins and points add up, the best multiplier ring counts, one callout', () => {
  assert.equal(G.gadgetAward([]), null);
  assert.equal(G.gadgetAward(undefined), null);
  const hits = [
    { id: 'c', kind: 'coins', effect: 'coin', coins: 5 }, { id: 'c', kind: 'coins', effect: 'coin', coins: 5 },
    { id: 'r', kind: 'ring', effect: 'boost', coins: 25, points: 50 },
    { id: 'z', kind: 'zone', effect: 'x2', mult: 2 }, { id: 'y', kind: 'zone', effect: 'x3', mult: 3 },
  ];
  assert.deepEqual(G.gadgetAward(hits), { coins: 35, points: 50, mult: 3, callout: 'triple-up', hits: 5, kinds: ['coins', 'ring', 'zone'] });
  const call = (h) => G.gadgetAward([h]).callout;
  assert.equal(call({ kind: 'coins', effect: 'full' }), 'full-trail');
  assert.equal(call({ kind: 'coins', effect: 'coin' }), null, 'a coin or two is not a callout');
  assert.equal(call({ kind: 'breakable', effect: 'smash' }), 'smashed-it');
  assert.equal(call({ kind: 'breakable', effect: 'bounce' }), 'denied');
  assert.equal(call({ kind: 'warp', effect: 'in' }), 'warp-speed');
  assert.equal(call({ kind: 'ring', effect: 'boost' }), 'ring-it');
  assert.equal(call({ kind: 'zone', effect: 'x2', mult: 2 }), 'double-up');
  assert.equal(call({ kind: 'geyser', effect: 'erupt' }), 'thar-she-blows');
  assert.equal(call({ kind: 'pad', effect: 'launch' }), 'boing');
  assert.equal(call({ kind: 'bumper', effect: 'bump' }), 'pinball');
  assert.equal(call({ kind: 'strip', effect: 'speed' }), 'turbo');
  assert.equal(call({ kind: 'mud', effect: 'stuck' }), 'stuck');
  // loudest first: a smashed wall outshouts the ring behind it
  assert.equal(G.gadgetAward([{ kind: 'ring', effect: 'boost' }, { kind: 'breakable', effect: 'smash' }]).callout, 'smashed-it');
});

test('GADGET_CALLOUTS: twelve ids with a text and a tone, none of them a contract callout', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(G.GADGET_CALLOUTS).map(([id, c]) => [id, c.text])), {
    'full-trail': 'FULL TRAIL!', 'smashed-it': 'SMASHED IT!', 'triple-up': 'TRIPLE UP!', 'warp-speed': 'WARP SPEED!',
    'ring-it': 'RING IT!', 'double-up': 'DOUBLE UP!', 'thar-she-blows': 'THAR SHE BLOWS!', boing: 'BOING!',
    pinball: 'PINBALL WIZARD!', turbo: 'TURBO!', denied: 'DENIED!', stuck: 'STUCK IN THE MUD!',
  });
  for (const [id, c] of Object.entries(G.GADGET_CALLOUTS)) {
    assert.ok(['epic', 'good', 'neutral', 'bad', 'funny'].includes(c.tone), id);
    assert.equal(A.CALLOUTS[id], undefined, `${id} is not in the contract's table`);
  }
  assert.equal(A.GADGET_CALLOUTS, G.GADGET_CALLOUTS);
  assert.equal(Object.keys(A.CALLOUTS).length, 30, 'the contract\'s thirty are as they were');
});

// a shot result as Game hands it to gradeShot: a full swing down a fairway hole
const fullShot = (extra = {}) => ({
  hole: 1, strokes: 1, launch: { speedMph: 150, vla: 12, hla: 0, totalSpin: 2600, spinAxis: 0 },
  sim: { points: [], carryYd: 244.4, totalYd: 265.3, offlineYd: 0, apexFt: 83, flightTime: 6.2, isPutt: false, events: [] },
  from: { x: 0, y: 0 }, end: { x: 0, y: 242 }, lie: 'fairway', distToPinYd: 170, penalty: 0, holed: false, note: '', clubKey: 'DR', ...extra,
});
const BEFORE = { distToPinYd: 437, pin: [0, 400], par: 4, strokes: 0 };

test('gradeShot: gadget coins and points are added, a multiplier ring multiplies, the callout is the gadget\'s', () => {
  const base = A.gradeShot({ result: fullShot(), before: BEFORE });
  assert.equal(base.gadgets, undefined);
  assert.deepEqual(base.multiplier, { streak: 1, powerup: 1, total: 1 });
  assert.equal(base.callout.id, 'striped', 'the plain drive is STRIPED IT!');
  // through a ring: +25 coins, +50 points, RING IT!
  const ring = A.gradeShot({ result: fullShot({ gadgets: [{ id: 'r', kind: 'ring', effect: 'boost', coins: 25, points: 50 }] }), before: BEFORE });
  assert.equal(ring.points, base.points + 50);
  assert.equal(ring.coins, base.coins + 25);
  assert.deepEqual(ring.callout, { id: 'ring-it', text: 'RING IT!', tone: 'good', voice: 'ring-it' });
  assert.deepEqual(ring.gadgets, { coins: 25, points: 50, mult: 1, hits: 1, kinds: ['ring'] });
  assert.deepEqual(ring.multiplier, { streak: 1, powerup: 1, total: 1, gadget: 1 });
  assert.ok(ring.tags.includes('gadget:ring'));
  assert.equal(ring.grade, base.grade, 'a gadget never changes the grade');
  // a x3 landing: the shot's own points three times over, and its coins with them
  const x3 = A.gradeShot({ result: fullShot({ gadgets: [{ id: 'z', kind: 'zone', effect: 'x3', mult: 3 }] }), before: BEFORE });
  assert.equal(x3.points, base.points * 3);
  assert.equal(x3.coins, Math.round(base.points * 3 / 10) + (base.coins - Math.round(base.points / 10)));
  assert.deepEqual(x3.multiplier, { streak: 1, powerup: 1, total: 3, gadget: 3 });
  assert.equal(x3.callout.id, 'triple-up');
  // with a streak and a power-up ball: all three multiply, the flat points come on top
  const both = A.gradeShot({ result: fullShot({ gadgets: [{ id: 'z', kind: 'zone', effect: 'x2', mult: 2 }, { id: 'r', kind: 'ring', effect: 'boost', coins: 25, points: 50 }] }), before: BEFORE, streak: 2, powerup: 'laser' });
  assert.equal(both.points, Math.round(both.basePoints * 1.5 * 0.5 * 2) + 50);
  assert.deepEqual(both.multiplier, { streak: 1.5, powerup: 0.5, total: 1.5, gadget: 2 });
  // a full trail on a drive that then went in the water: the coins are banked, the points are not
  const wet = A.gradeShot({ result: fullShot({ lie: 'water', penalty: 1, note: 'Water', sim: { ...fullShot().sim, events: [{ type: 'water', x: 0, y: 200 }] }, gadgets: [{ id: 'c', kind: 'coins', effect: 'full', coins: 50, points: 150 }] }), before: BEFORE });
  assert.equal(wet.grade, 'DISASTER');
  assert.deepEqual([wet.points, wet.coins, wet.callout.id], [0, 50, 'splash']);
  assert.equal(wet.gadgets.points, 0);
  // quieter than a ball by the pin, louder than finding the green, a bomb or a tree
  const ringHit = [{ id: 'r', kind: 'ring', effect: 'boost', coins: 25, points: 50 }];
  const dart = A.gradeShot({ result: fullShot({ lie: 'green', distToPinYd: 2, gadgets: ringHit }), before: { ...BEFORE, distToPinYd: 280 } });
  assert.equal(dart.callout.id, 'dart');
  const onGreen = (gadgets) => A.gradeShot({ result: fullShot({ lie: 'green', distToPinYd: 12, sim: { ...fullShot().sim, carryYd: 300, totalYd: 310 }, ...(gadgets ? { gadgets } : {}) }), before: { ...BEFORE, distToPinYd: 320 } });
  assert.equal(onGreen(null).callout.id, 'bomb', 'a driven green is a bomb');
  assert.equal(onGreen(ringHit).callout.id, 'ring-it', 'through a ring it is RING IT!');
  // the swing is graded, not the gadget: the carry that counts is the swing's own (sim.swingCarryYd)
  const thrown = (swingCarryYd) => A.gradeShot({ result: fullShot({ sim: { ...fullShot().sim, carryYd: 300, totalYd: 320, ...(swingCarryYd ? { swingCarryYd } : {}) } }), before: BEFORE });
  assert.equal(thrown(null).callout.id, 'bomb');
  assert.ok(thrown(null).reasons.some((x) => /Piped it/.test(x)));
  assert.equal(thrown(244.4).callout.id, 'striped', 'a 244 yd drive that a ring threw to 300 is no bomb');
  assert.equal(thrown(244.4).facts.carryYd, 244.4);
  const tree = A.gradeShot({ result: fullShot({ sim: { ...fullShot().sim, events: [{ type: 'tree', t: 1, x: 0, y: 50, z: 5, part: 'trunk' }] }, gadgets: [{ id: 'p', kind: 'pad', effect: 'launch', coins: 10 }] }), before: BEFORE });
  assert.equal(tree.callout.id, 'boing');
  // banked like any other shot
  const bay = new A.ArcadeState();
  const award = bay.applyShot(ring, { shotId: 1 });
  assert.deepEqual(award.awarded, { coins: ring.coins, xp: ring.points, points: ring.points });
  assert.equal(bay.coins, ring.coins);
});

// ---------------------------------------------------------------- the stages

const games = new Map();
// a stage in a Game, as the arcade plays it (the play assists on)
function stageGame(id) {
  if (!games.has(id)) {
    const { course } = buildCourse(id);
    const g = new Game();
    const warn = console.warn;
    console.warn = () => {};
    try { g.setCourse(course); } finally { console.warn = warn; }
    g.playAssist = P.PLAY_ASSIST;
    games.set(id, g);
  }
  const g = games.get(id);
  g.reset();
  g.shotMods = null;
  return g;
}
// one swing on a stage: from the tee (or `from`), at the flag (or `at`), with a plain ball (or `ball`)
function swing(id, [speed, vla, spin], { at = null, from = null, ball = null, aim = 0 } = {}) {
  const g = stageGame(id);
  if (from) { g.ball = { x: from[0], y: from[1] }; g.lie = g.surfaceAt(from[0], from[1]); g.strokes = 1; }
  if (at) {
    const pin = g.hole.pin;
    const base = Math.atan2(pin[0] - g.ball.x, pin[1] - g.ball.y) * 180 / Math.PI;
    aim = ((Math.atan2(at[0] - g.ball.x, at[1] - g.ball.y) * 180 / Math.PI - base + 540) % 360) - 180;
  }
  g.aimOffset = aim;
  g.shotMods = A.modifiersFor(ball, null);
  try { return g.handleShot({ Speed: speed, VLA: vla, HLA: 0, TotalSpin: spin, SpinAxis: 0 }); } finally { g.shotMods = null; }
}
const met = (r) => (r.gadgets || []).filter((h) => h.effect !== 'coin').map((h) => `${h.id}:${h.effect}`);
const MATCH = STAGES.filter((s) => s.stage.role === 'match').map((s) => s.id);
const ARENAS = STAGES.filter((s) => s.stage.role === 'tiebreak').map((s) => s.id);

// what each stage carries: id -> its gadget ids
const SETS = {
  'lagoon-island': ['bar-runner', 'flag-x2', 'flag-x3', 'turtle-shell', 'sea-wall', 'skull-coins'],
  'canyon-run': ['barricade', 'mesa-ring', 'mesa-wall', 'ramp-runner', 'porch-x2', 'gorge-coins'],
  'lighthouse-point': ['updraft', 'cut-x2', 'crates-a', 'crates-b', 'cliff-rail', 'headland-runner', 'cove-coins'],
  'volcano-drop': ['jaws-ring', 'flag-x3', 'terrace-x2', 'reef-vent', 'west-vent', 'east-vent', 'jaws-coins'],
  'frostbite-ridge': ['lake-ring', 'shelf-x3', 'snowman-west', 'snowman-east', 'black-ice', 'cirque-coins'],
  'sakura-garden': ['festival-lantern', 'tea-bowl', 'koi-rail', 'moss-runner', 'falls-coins'],
  'temple-run': ['drive-x2', 'mud-bank', 'stone-drum', 'serpents-mouth', 'serpents-tail', 'temple-coins'],
  'pharaohs-gate': ['gate-ring', 'gate-x3', 'caravan-road', 'oasis-spring', 'court-coins'],
  'midnight-mile': ['neon-mile', 'harbour-ring', 'docks-x3', 'kick-off', 'bumper-left', 'bumper-mid', 'bumper-right', 'harbour-coins'],
  'sky-fortress': ['courtyard-x3', 'great-bombard', 'bombard-muzzle', 'siege-ladder', 'powder-trail', 'keep-coins'],
  'dragons-spine': ['dragons-step', 'jaw-vent', 'jaw-vent-west', 'jaw-vent-east', 'dragons-tail', 'terrace-x2', 'spine-coins'],
  'summit-express': ['headwall-step', 'blue-ice', 'snowman-west', 'snowman-east', 'ice-ramp', 'express-coins'],
  'bullseye-bay': ['bay-coins'],
  'thunder-dome': ['dome-coins'],
  'ice-pick': ['summit-coins'],
};

test('every stage builds and validates with its gadgets: three to eight on a match stage, only a coin trail in an arena', () => {
  assert.equal(MATCH.length, 12);
  assert.equal(ARENAS.length, 3);
  const used = new Set();
  for (const id of [...MATCH, ...ARENAS]) {
    const { course, expect } = buildCourse(id);
    const report = L.validateCourse(course, { expect });
    assert.ok(report, id);
    assert.deepEqual(course.gadgets.map((g) => g.id), SETS[id], `${id}: its gadgets`);
    // the course carries them tidied: sound, and nothing left to resolve
    assert.deepEqual(G.normalizeGadgets(course.gadgets), { gadgets: course.gadgets, problems: [] }, `${id}: normalized`);
    for (const g of course.gadgets) {
      assert.equal(g.alt, undefined, `${id}/${g.id}: alt was turned into z`);
      used.add(g.kind);
    }
    const n = course.gadgets.filter((g) => g.kind !== 'warp-exit').length;
    if (MATCH.includes(id)) assert.ok(n >= T.STAGE_MIN && n <= T.STAGE_MAX, `${id} has ${n}`);
    else assert.deepEqual(course.gadgets.map((g) => g.kind), ['coins'], `${id}: sudden death stays pure`);
    // it survives the trip through a course file
    assert.deepEqual(JSON.parse(JSON.stringify(course)).gadgets, course.gadgets);
  }
  // every kind is out on the tour somewhere
  assert.deepEqual([...used].sort(), [...G.KIND_IDS].sort());
  // the legacy three-hole course carries none
  assert.equal(buildCourse('arcade-classics').course.gadgets, undefined);
  // the stages the brief names: geysers on the volcano stages, ice on the alpine ones, a cannon on Sky Fortress
  const kinds = (id) => buildCourse(id).course.gadgets.map((g) => g.kind);
  for (const id of ['volcano-drop', 'dragons-spine']) assert.ok(kinds(id).includes('geyser'), id);
  for (const id of ['frostbite-ridge', 'summit-express']) assert.ok(kinds(id).includes('ice'), id);
  assert.equal(buildCourse('sky-fortress').course.gadgets.find((g) => g.kind === 'warp').style, 'cannon');
  const wall = buildCourse('canyon-run').course.gadgets.find((g) => g.id === 'barricade');
  assert.deepEqual([wall.kind, wall.breakMph, wall.style], ['breakable', 150, 'wall'], 'the owner\'s 150 mph wall');
});

test('validateCourse names a gadget that is badly placed', () => {
  // Pharaoh's Gate with other gadgets in place of its own
  const withGadgets = (gadgets, role = null) => {
    const piece = { ...PIECES['pharaohs-gate'], gadgets };
    const stage = L.normalizeStage(role ? { ...piece.stage, role, order: 1 } : piece.stage, piece.id);
    return () => {
      const { course, expect } = L.assembleCourse({ id: piece.id, number: stage.number, name: stage.name, origin: stage.origin, stage, pieces: [{ piece }] });
      return L.validateCourse(course, { expect });
    };
  };
  const three = [L.gadget('zone', 'a', -40, 120), L.gadget('zone', 'b', -48, 180), L.gadget('zone', 'c', 58, 120)];
  assert.ok(withGadgets(three)(), 'three rings on its fairways are fine');
  const fails = (extra, re, role = null) => assert.throws(withGadgets(role ? extra : [...three, ...extra], role), (e) => { assert.match(e.message, re); return true; });
  fails([L.gadget('bumper', 'post', 16, 262)], /gadget post \(bumper\) stands on green/);
  fails([L.gadget('pad', 'on-tee', 0, 0)], /gadget on-tee \(pad\) stands on tee/);
  fails([L.gadget('pad', 'wet', 122, 204)], /gadget wet \(pad\) stands on water/);
  fails([L.gadget('bumper', 'close', 0, 12)], /gadget close \(bumper\) stands 10 m from hole 1's tee \(at least 18\)/);
  fails([L.gadget('bumper', 'in-the-way', -30, 150)], /gadget in-the-way \(bumper\) blocks hole 1's routing line, the safe way home/);
  fails([L.gadget('breakable', 'wall', -34, 150, { size: [30, 10], heading: 180 })], /gadget wall \(breakable\) blocks hole 1's routing line/);
  fails([L.gadget('bumper', 'fringe', 37, 262)], /gadget fringe \(bumper\) stands on or against a green/);
  fails([L.gadget('zone', 'far', 600, 150)], /gadget far \(zone\) reaches outside the elevation grid/);
  fails([L.gadget('mud', 'gone', 286, 150, { radius: 4 })], /gadget gone \(mud\) reaches out of bounds/);
  fails([L.gadget('ring', 'buried', -40, 120, { z: 6, heading: 0 })], /gadget buried \(ring\) is cut by the ground/);
  fails([{ id: 'sunk', kind: 'coins', points: [[-40, 100, 20], [-40, 120, 2], [-40, 140, 20]] }], /gadget sunk \(coins\): coin 2 is under the ground/);
  fails([L.gadget('warp', 'in', -40, 120, { pair: 'out' }), L.gadget('warp-exit', 'out', 60, 190, { heading: 70, angle: 30, speedMph: 60 })], /gadget in \(warp\) fires the ball into the water/);
  fails([L.gadget('warp', 'lonely', -40, 120, { pair: 'nobody' })], /its pair 'nobody' is not a warp-exit/);
  fails([L.gadget('strip', 'thin', -40, 120, { size: [1, 30], heading: 0 })], /size must be \[width, length\]/);
  // too few, too many
  assert.throws(withGadgets(three.slice(0, 2)), /a match stage has 3 to 8 gadgets \(a warp and its exit are one\): this one has 2/);
  assert.throws(withGadgets(Array.from({ length: 9 }, (_, i) => L.gadget('zone', `z${i}`, -40, 100 + i * 10, { radius: 4 }))), /this one has 9/);
  // a sudden-death arena: nothing that touches the ball
  fails([L.gadget('zone', 'ring', -40, 120)], /a sudden-death arena carries no gadget that touches the ball \(closest to the pin stays pure\): ring/, 'tiebreak');
  assert.ok(withGadgets([{ id: 'trail', kind: 'coins', points: [[0, 40, 40], [0, 80, 45], [0, 120, 40]] }], 'tiebreak')(), 'a coin trail is fine there');
  // what hangs in the air stands on nothing: a lantern over the pool, on the line, is allowed
  assert.ok(withGadgets([...three, L.gadget('breakable', 'lantern', 8, 130, { z: 40, radius: 3, height: 6, style: 'pinata' })])());
});

test('L.flight: a real swing over the hole\'s ground, to hang rings and coins on', () => {
  const height = () => 0;
  const f = L.flight(height, [0, 0], [0, 100], { speedMph: 150, vla: 12, spin: 2600 });
  near(f.carryM / YD, 244.4, 0.2, 'its carry');
  assert.equal(f.heading, 0);
  const p = f.at(100);
  near(p.z, 21.4, 0.2, 'height 100 m out');
  assert.deepEqual(f.ring('r', 100, { radius: 6 }), { id: 'r', kind: 'ring', x: 0, y: 100, z: p.z, heading: 0, radius: 6 });
  const coins = f.coins('c', 40, 200, 5);
  assert.equal(coins.points.length, 5);
  assert.deepEqual(coins.points.map((q) => q[1]), [40, 80, 120, 160, 200]);
  assert.equal(f.at(400), null);
  assert.throws(() => f.ring('r', 400), /is past its landing/);
  // a Rocket's flight is the arcade's Rocket: a 150 mph swing carries about 497 yd
  near(L.flight(height, [0, 0], [0, 100], { speedMph: 150, vla: 12, spin: 2600, ball: 'rocket' }).carryM / YD, 496.6, 1.5, 'rocket carry');
  // and a drive through a ring hung on its own flight goes through it
  assert.deepEqual(effects(fly(DRIVE, [f.ring('r', 120, { radius: 3 })])), ['r:boost']);
});

test('the game: result.gadgets, the same contacts as events; a course without gadgets has neither', () => {
  const r = swing('pharaohs-gate', [138, 13, 2700]);
  assert.deepEqual(met(r), ['gate-ring:boost', 'gate-x3:x3']);
  assert.deepEqual(r.sim.events.filter((e) => e.type === 'gadget').map(({ type, ...h }) => h), r.gadgets);
  for (const h of r.gadgets) for (const k of ['id', 'kind', 't', 'x', 'y', 'z', 'effect']) assert.ok(h[k] !== undefined, `${h.id} has ${k}`);
  assert.ok(r.gadgets.every((h, i) => i === 0 || h.t >= r.gadgets[i - 1].t), 'in order of time');
  // the swing's own carry rides along when a gadget moved the ball: 248 yd of drive, thrown to 254 by the ring
  assert.ok(r.sim.swingCarryYd < r.sim.carryYd - 4, `${r.sim.swingCarryYd} yd of swing in ${r.sim.carryYd} yd of carry`);
  const bare = simulateShot(r.launch, r.from, stageGame('pharaohs-gate').aimDeg, stageGame('pharaohs-gate').surfaceAt, { terrain: stageGame('pharaohs-gate').terrain, carryOnly: true, ...P.PLAY_ASSIST.physics });
  near(r.sim.swingCarryYd, bare.carryYd, 0.06, 'the same swing with no gadgets');
  // a swing that meets nothing: an empty list (the course has gadgets), and no such number
  assert.deepEqual(swing('pharaohs-gate', [60, 30, 7000]).gadgets, []);
  assert.equal('swingCarryYd' in swing('pharaohs-gate', [60, 30, 7000]).sim, false);
  // coins and a landing ring do not move the ball: no reference flight for them
  assert.equal('swingCarryYd' in swing('pharaohs-gate', [150, 12, 2600], { ball: 'rocket' }).sim, false);
  // a course with none: no key at all, and the game has no field
  const g = new Game();
  g.setCourse({ name: 'Plain', surfaces: [], boundary: null, elevation: null, holes: [{ ref: 1, par: 4, tee: [0, 0], pin: [0, 400], lengthYd: 437, line: [[0, 0], [0, 400]] }] });
  assert.equal(g.gadgets, null);
  assert.equal('gadgets' in g.handleShot({ Speed: 150, VLA: 12, HLA: 0, TotalSpin: 2600, SpinAxis: 0 }), false);
});

test('Canyon Run, the 150 club: 149 mph comes back off the Barricade, 150 smashes it and rings its way to the mesa', () => {
  const denied = swing('canyon-run', [149, 12, 2600]);
  assert.deepEqual(met(denied), ['barricade:bounce']);
  assert.equal(denied.penalty, 0);
  assert.ok(denied.distToPinYd > 280, `it lies ${denied.distToPinYd} yd out, by the tee`);
  for (const mph of [150, 155, 160, 165]) {
    const r = swing('canyon-run', [mph, 12, 2600]);
    assert.deepEqual(met(r).slice(0, 2), ['barricade:smash', 'mesa-ring:boost'], `${mph} mph`);
    assert.equal(r.penalty, 0, `${mph} mph is dry`);
    assert.ok(r.distToPinYd < 30 && (r.lie === 'green' || r.lie === 'rough'), `${mph} mph: on the mesa, ${r.lie}, ${r.distToPinYd} yd from the flag`);
  }
  assert.equal(swing('canyon-run', [150, 12, 2600]).lie, 'green', 'the 150 mph drive is putting');
  // the Mesa Wall stops the hot one
  assert.ok(met(swing('canyon-run', [165, 12, 2600])).includes('mesa-wall:board'));
  // a Rocket smashes the Barricade at any speed and loses nothing to it; a Ghost goes through it untouched
  const rocket = swing('canyon-run', [100, 12, 2600], { ball: 'rocket' });
  assert.deepEqual(met(rocket)[0], 'barricade:smash');
  const ghost = swing('canyon-run', [100, 12, 2600], { ball: 'ghost' });
  assert.equal(met(ghost).some((m) => m.startsWith('barricade')), false);
  // the safe line and the Porch never meet it
  assert.equal(met(swing('canyon-run', [135, 13, 2800], { at: [-8, 130] })).some((m) => m.startsWith('barricade')), false);
  assert.deepEqual(met(swing('canyon-run', [150, 12, 2600], { at: [122, 185] })), ['gorge-coins:full', 'porch-x2:x2']);
  // the Ramp Runner sweeps a safe drive up the ramp
  const safe = swing('canyon-run', [135, 13, 2800], { at: [-8, 130] });
  assert.deepEqual(met(safe), ['ramp-runner:speed']);
  assert.ok(safe.distToPinYd < 100 && safe.lie === 'fairway', `${safe.distToPinYd} yd, ${safe.lie}`);
});

test('the stages, played: each set does what its hole file says', () => {
  const dry = (r, what) => assert.equal(r.penalty, 0, `${what}: ${r.note}`);
  // Lagoon Island: the Turtle Shell saves a short one, the Sea Wall a long one, the flag is a bullseye
  let r = swing('lagoon-island', [91, 25, 9300]);
  assert.deepEqual(met(r), ['turtle-shell:launch']);
  assert.equal(r.lie, 'green');
  r = swing('lagoon-island', [122, 16.5, 5300]);
  assert.deepEqual(met(r), ['sea-wall:board']); dry(r, 'off the Sea Wall');
  assert.deepEqual(met(swing('lagoon-island', [105, 21, 7900])), ['flag-x2:x2', 'flag-x3:x3']);
  r = swing('lagoon-island', [70, 29, 9500], { at: [46, 80] });
  assert.deepEqual(met(r), ['bar-runner:speed']);
  assert.deepEqual(met(swing('lagoon-island', [68, 32, 10500], { at: [-34, 138], ball: 'rocket' })), ['skull-coins:full']);
  // Lighthouse Point: the Updraft carries a 125 mph Cut that was wet; a 150 mph one flies over it
  r = swing('lighthouse-point', [125, 13.5, 3000], { at: [-40, 236] });
  assert.deepEqual(met(r), ['updraft:push']); dry(r, 'the 125 mph Cut');
  assert.deepEqual(met(swing('lighthouse-point', [150, 12, 2600], { at: [-40, 236] })), ['cut-x2:x2']);
  assert.deepEqual(met(swing('lighthouse-point', [135, 13, 2800], { at: [12, 130] })), ['headland-runner:speed']);
  // Volcano Drop: the Jaws Ring, and a vent that throws a chunked wedge onto the reef
  assert.deepEqual(met(swing('volcano-drop', [111, 19, 7000]))[0], 'jaws-ring:boost');
  r = swing('volcano-drop', [75, 28, 9500]);
  assert.deepEqual(met(r), ['reef-vent:erupt']); dry(r, 'thrown onto the reef');
  // Frostbite Ridge: the Lake Ring carries the 132 mph drive that was on the ice; the Black Ice runs a safe one on
  r = swing('frostbite-ridge', [132, 13, 2800]);
  assert.deepEqual(met(r)[0], 'lake-ring:boost'); dry(r, 'the 132 mph drive over the lake');
  assert.deepEqual(met(swing('frostbite-ridge', [150, 12, 2600])), ['shelf-x3:x3']);
  assert.deepEqual(met(swing('frostbite-ridge', [135, 13, 2800], { at: [-30, 225] })), ['black-ice:slide']);
  assert.deepEqual(met(swing('frostbite-ridge', [150, 12, 2600], { at: [27, 268] })), ['snowman-west:smash']);
  // Sakura Garden: the lantern on the line, the Tea Bowl at the flag
  r = swing('sakura-garden', [91, 25.5, 9300]);
  assert.deepEqual(met(r), ['festival-lantern:smash', 'tea-bowl:funnel']);
  assert.ok(r.distToPinYd < 4, `drawn in to ${r.distToPinYd} yd`);
  assert.deepEqual(met(swing('sakura-garden', [68, 32, 10500], { at: [-22, 100] })), ['moss-runner:speed']);
  // Temple Run: the Mud Bank stops a 160 mph drive short of the river; the Drum and the Serpent
  r = swing('temple-run', [160, 11, 2400]);
  assert.deepEqual(met(r), ['mud-bank:stuck']); dry(r, 'stuck, but dry');
  // (a lay-up that stops on the island is left alone; one that would have run on into the river is thrown over it)
  assert.deepEqual(met(swing('temple-run', [78, 29, 10000], { from: [6, 286], at: [8, 370] })), []);
  r = swing('temple-run', [85, 26.5, 9500], { from: [6, 286], at: [8, 370] });
  assert.deepEqual(met(r), ['stone-drum:launch']); dry(r, 'over the second river');
  assert.ok(r.end.y > 420 && r.lie === 'fairway', 'onto the forecourt');
  r = swing('temple-run', [68, 32, 10500], { from: [8, 366] });
  assert.deepEqual(met(r), ['serpents-mouth:in', 'serpents-tail:out']);
  assert.equal(r.lie, 'green');
  // Pharaoh's Gate: the Caravan Road and the Oasis Spring
  assert.deepEqual(met(swing('pharaohs-gate', [135, 13, 2800], { at: [-46, 176] })), ['caravan-road:speed']);
  r = swing('pharaohs-gate', [127, 15, 4800], { at: [66, 150] });
  assert.deepEqual(met(r), ['oasis-spring:launch']);
  assert.equal(r.lie, 'green');
  assert.deepEqual(met(swing('pharaohs-gate', [150, 12, 2600], { ball: 'rocket' })), ['court-coins:full']);
  // Midnight Mile: the Neon Mile, the Harbour Ring, the Kick-Off
  assert.deepEqual(met(swing('midnight-mile', [135, 13, 2800], { at: [32, 222] })), ['neon-mile:speed']);
  r = swing('midnight-mile', [122, 14, 3000]);
  assert.deepEqual(met(r), ['harbour-ring:boost']); dry(r, 'onto the Docks');
  r = swing('midnight-mile', [117, 17.5, 6000], { from: [-71, 276] });
  assert.deepEqual(met(r), ['kick-off:funnel']);
  assert.ok(r.distToPinYd < 4);
  // Sky Fortress: the Siege Ladder throws a 104 mph Rocket that landed on the upper ramp over the lip;
  // the Bombard fires a plain drive up there; and nothing hangs in a full Rocket's way
  r = swing('sky-fortress', [104, 13, 2600], { ball: 'rocket' });
  assert.deepEqual(met(r), ['siege-ladder:launch']);
  assert.ok(r.end.y > 288 && r.lie === 'fairway', `on top: y ${r.end.y.toFixed(0)}, ${r.lie}`);
  assert.deepEqual(met(swing('sky-fortress', [130, 13, 2600], { ball: 'rocket' })), []);
  r = swing('sky-fortress', [142, 12.5, 2600]);
  assert.deepEqual(met(r), ['great-bombard:in', 'bombard-muzzle:out']);
  assert.ok(r.end.y > 300 && r.lie === 'fairway', `in the courtyard: y ${r.end.y.toFixed(0)}, ${r.lie}`);
  // Dragon's Spine: the Step under the lip, a vent under a plain drive, the Tail beyond the Spine's end;
  // and a full Rocket meets none of them
  r = swing('dragons-spine', [104, 13, 2600], { ball: 'rocket' });
  assert.deepEqual(met(r), ['dragons-step:launch']);
  assert.equal(r.lie, 'fairway', 'on the Spine');
  r = swing('dragons-spine', [140, 13, 2600]);
  assert.deepEqual(met(r), ['jaw-vent:erupt']); dry(r, 'thrown onto the scree');
  r = swing('dragons-spine', [176, 13, 2600], { ball: 'rocket' });
  assert.deepEqual(met(r), ['dragons-tail:launch']);
  assert.ok(r.distToPinYd < 25, `into the caldera: ${r.distToPinYd} yd`);
  for (const mph of [125, 140, 155]) assert.deepEqual(met(swing('dragons-spine', [mph, 13, 2600], { ball: 'rocket' })).filter((m) => !m.startsWith('spine-coins')), [], `a ${mph} mph Rocket`);
  // Summit Express: the Headwall Step, the Blue Ice, the Ice Ramp
  r = swing('summit-express', [98, 13, 2600], { ball: 'rocket' });
  assert.deepEqual(met(r), ['headwall-step:launch']);
  assert.equal(r.lie, 'fairway', 'in the valley');
  assert.ok(met(swing('summit-express', [125, 13, 2600], { ball: 'rocket' })).includes('blue-ice:slide'));
  r = swing('summit-express', [60, 30, 7000], { from: [10, 480] });
  assert.deepEqual(met(r), ['ice-ramp:launch']); dry(r, 'over the crevasse');
  // the arenas: coins, and a flight that is the flight it was
  for (const [id, club] of [['bullseye-bay', [78, 29, 10000]], ['thunder-dome', [99, 23, 8600]], ['ice-pick', [68, 32, 10500]]]) {
    const coins = swing(id, club);
    assert.equal(coins.gadgets.filter((h) => h.effect === 'coin').length, 6, id);
    assert.equal(met(coins).length, 1);
    const g = stageGame(id);
    const bare = simulateShot(coins.launch, coins.from, g.aimDeg, g.surfaceAt, { terrain: g.terrain, pin: { x: g.hole.pin[0], y: g.hole.pin[1] }, trees: g.treeObstacles, ...P.PLAY_ASSIST.physics });
    assert.deepEqual(coins.sim.points, bare.points, `${id}: the trail never touches the ball`);
  }
});

// ---------------------------------------------------------------- fair, stateless

test('stateless: the same swing gives the same result, again and after a mulligan (a smashed wall stands again)', () => {
  const first = swing('canyon-run', [152, 12, 2600]);
  assert.deepEqual(met(first).slice(0, 2), ['barricade:smash', 'mesa-ring:boost']);
  const g = stageGame('canyon-run');
  const play = () => g.handleShot({ Speed: 152, VLA: 12, HLA: 0, TotalSpin: 2600, SpinAxis: 0 });
  const a = play();
  assert.deepEqual(a.gadgets, first.gadgets);
  assert.equal(g.mulligan(), true);
  const b = play();
  assert.deepEqual(b.gadgets, a.gadgets);
  assert.deepEqual(b.sim.points, a.sim.points);
  assert.deepEqual(b.end, a.end);
  // and from where that ball lies, a second ball back at the wall meets it whole
  g.reset();
  assert.deepEqual(met(play()).slice(0, 1), ['barricade:smash']);
  g.reset();
  assert.deepEqual(met(g.handleShot({ Speed: 140, VLA: 12, HLA: 0, TotalSpin: 2600, SpinAxis: 0 })), ['barricade:bounce']);
  // a geyser's cycle belongs to the shot: the second of two identical swings meets it exactly as the first did
  const v1 = swing('dragons-spine', [140, 13, 2600]), v2 = swing('dragons-spine', [140, 13, 2600]);
  assert.deepEqual(v2.gadgets, v1.gadgets);
  assert.deepEqual(v2.sim.points, v1.sim.points);
});

test('a match is fair: identical swings by both players give identical results, gadgets and all', () => {
  const { course } = buildCourse('pharaohs-gate');
  const tour = { version: 1, stages: [{ id: 'pharaohs-gate', order: 1, number: 8, file: 'p.json', name: "Pharaoh's Gate", par: 4, lengthYd: 301, theme: 'desert', timeOfDay: 'golden', blurb: 'b', difficulty: 2 }], tiebreaks: [] };
  const g = new Game();
  const warn = console.warn;
  console.warn = () => {};
  const match = createMatch({ game: g, players: [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Bob' }], tour, random: () => 0.1, options: { format: 'quick', stage: 'pharaohs-gate' } });
  // drive the match to the tee, as server.js does
  for (let i = 0; i < 12 && match.phase !== 'play'; i++) {
    const w = match.waiting;
    if (!w) break;
    if (w.for === 'stage') { g.setCourse(course); g.playAssist = P.PLAY_ASSIST; match.stageReady(g, w.token); } else if (w.for === 'ready') match.ready(g); else if (w.for === 'continue') match.continue();
  }
  console.warn = warn;
  assert.equal(match.phase, 'play');
  const results = [];
  for (let k = 0; k < 2; k++) {
    const shooter = match.beforeShot(g);
    assert.ok(shooter, 'someone is up');
    g.shotMods = A.modifiersFor(null, null);
    const r = g.handleShot({ Speed: 138, VLA: 13, HLA: 0, TotalSpin: 2700, SpinAxis: 0 });
    g.shotMods = null;
    results.push({ playerId: shooter.playerId, r });
    match.afterShot(g, r);
  }
  assert.notEqual(results[0].playerId, results[1].playerId, 'one swing each');
  assert.deepEqual(results[0].r.gadgets.map((h) => h.id), ['court-coins', 'gate-ring', 'gate-x3']);
  assert.deepEqual(results[1].r.gadgets, results[0].r.gadgets);
  assert.deepEqual(results[1].r.sim.points, results[0].r.sim.points);
  assert.deepEqual(results[1].r.end, results[0].r.end);
  // undo: the second player's ball is taken back, and the same swing meets the same gadgets
  match.undoLastShot(g);
  const again = match.beforeShot(g);
  assert.equal(again.playerId, results[1].playerId);
  g.shotMods = A.modifiersFor(null, null);
  const redo = g.handleShot({ Speed: 138, VLA: 13, HLA: 0, TotalSpin: 2700, SpinAxis: 0 });
  g.shotMods = null;
  assert.deepEqual(redo.gadgets, results[1].r.gadgets);
  match.afterShot(g, redo);
  // restart the hole: both tee off again into the same course
  match.restartHole(g);
  const teeAgain = match.beforeShot(g);
  g.shotMods = A.modifiersFor(null, null);
  const third = g.handleShot({ Speed: 138, VLA: 13, HLA: 0, TotalSpin: 2700, SpinAxis: 0 });
  g.shotMods = null;
  assert.ok(teeAgain);
  assert.deepEqual(third.gadgets, results[0].r.gadgets);
});

// ---------------------------------------------------------------- the lineup, the lies

test('the lineup flies the club through the gadgets: what it predicts is what the game plays', () => {
  const g = stageGame('pharaohs-gate');
  // the stock 3-wood (142 mph, 13.5 degrees, 3400 rpm) at the flag goes through the Gate Ring
  const bag = null;
  const pred = predictShot(g, { club: 'W3', bag });
  assert.ok(pred.gadgets, 'the prediction says what it meets');
  assert.deepEqual(pred.gadgets.hits.map((h) => `${h.id}:${h.effect}`), ['gate-ring:boost', 'gate-x3:x3']);
  assert.deepEqual(pred.events.filter((e) => e.type === 'gadget').map((e) => e.id), ['gate-ring', 'gate-x3']);
  // ahead: the others near the aim line, with how far and how wide
  for (const a of pred.gadgets.ahead) assert.deepEqual(Object.keys(a), ['id', 'kind', 'label', 'distYd', 'offlineYd']);
  assert.equal(pred.gadgets.ahead.some((a) => a.id === 'gate-ring'), false, 'what it hits is not also "ahead"');
  // and the game plays that swing to the same spot
  const r = swing('pharaohs-gate', [142, 13.5, 3400]);
  assert.deepEqual(met(r), ['gate-ring:boost', 'gate-x3:x3']);
  near(pred.rest.x, r.end.x, 0.02, 'predicted rest x');
  near(pred.rest.y, r.end.y, 0.02, 'predicted rest y');
  near(pred.carryYd, r.sim.carryYd, 0.1, 'predicted carry');
  // the predicted path turns at the ring: it keeps that point
  const ring = pred.gadgets.hits[0];
  assert.ok(pred.path.some((q) => Math.abs(q.t - ring.t) < 2e-3), 'the path has the point where the ring took the ball');
  // a course without gadgets: no such key
  const bare = new Game();
  bare.setCourse({ name: 'Plain', surfaces: [], boundary: null, elevation: null, holes: [{ ref: 1, par: 4, tee: [0, 0], pin: [0, 400], lengthYd: 437, line: [[0, 0], [0, 400]] }] });
  assert.equal('gadgets' in predictShot(bare, { club: 'DR', bag }), false);
  // Canyon Run: the stock driver at the flag is lined up through the Barricade and the Mesa Ring, onto the mesa
  const canyon = predictShot(stageGame('canyon-run'), { club: 'DR', bag });
  assert.deepEqual(canyon.gadgets.hits.map((h) => `${h.id}:${h.effect}`), ['barricade:smash', 'mesa-ring:boost']);
  assert.equal(canyon.restSurface, 'green');
  // and a 3-wood there is lined up off the Barricade: the aim line is honest about the wall
  const wood = predictShot(stageGame('canyon-run'), { club: 'W3', bag });
  assert.deepEqual(wood.gadgets.hits.map((h) => `${h.id}:${h.effect}`), ['barricade:bounce']);
  assert.ok(wood.totalYd < 80, `it predicts ${wood.totalYd} yd`);
});

test('gadgetsAhead: what stands near an aim line, nearest first', () => {
  const list = G.normalizeGadgets([
    { id: 'far', kind: 'zone', x: 0, y: 300 }, { id: 'near', kind: 'pad', x: 10, y: 100 }, { id: 'wide', kind: 'mud', x: 80, y: 150 },
    { id: 'behind', kind: 'mud', x: 0, y: -40 }, { id: 'm', kind: 'warp', x: 0, y: 200, pair: 'e' }, { id: 'e', kind: 'warp-exit', x: 0, y: 220, heading: 0 },
  ]).gadgets;
  assert.deepEqual(G.gadgetsAhead(list, { x: 0, y: 0 }, 0, { reachM: 400, halfWidthM: 25 }), [
    { id: 'near', kind: 'pad', label: 'Bounce pad', distYd: 109, offlineYd: 11 },
    { id: 'm', kind: 'warp', label: 'Warp', distYd: 219, offlineYd: 0 },
    { id: 'far', kind: 'zone', label: 'Multiplier', distYd: 328, offlineYd: 0 },
  ]);
  assert.deepEqual(G.gadgetsAhead(list, { x: 0, y: 0 }, 0, { reachM: 150 }).map((a) => a.id), ['near']);
  assert.deepEqual(G.gadgetsAhead(list, { x: 0, y: 0 }, 28, { reachM: 200, halfWidthM: 5 }).map((a) => a.id), ['wide']);
});

test('playability: no gadget makes a dead lie; a ball stuck in mud, on ice or under a wall plays on', () => {
  for (const id of MATCH) {
    const g = stageGame(id);
    const h = g.hole;
    const ctx = { surfaceAt: g.surfaceAt, terrain: g.terrain, trees: g.treeObstacles, gadgets: g.gadgets, pin: { x: h.pin[0], y: h.pin[1] } };
    const bare = { ...ctx, gadgets: null };
    for (const gd of g.course.gadgets) {
      if (!G.KINDS[gd.kind].solid && !['mud', 'ice', 'pad', 'strip', 'funnel', 'warp', 'geyser'].includes(gd.kind)) continue;
      // in it, and a few metres to each side of it (the tee side and the far side of a wall)
      const f = G.footprint(gd);
      const spots = [[f.x, f.y]];
      for (let a = 0; a < 360; a += 45) spots.push([f.x + (f.r + 3) * Math.cos(a * Math.PI / 180), f.y + (f.r + 3) * Math.sin(a * Math.PI / 180)]);
      for (const [x, y] of spots) {
        const lie = g.surfaceAt(x, y);
        if (lie === 'water' || lie === 'ob' || lie === 'green') continue;
        const withThem = P.lieReport(ctx, { x, y }, { assist: P.PLAY_ASSIST, stopAt: 1 });
        if (!withThem.dead) continue;
        // dead with the gadgets: it must be dead without them too (the ground's own doing: a forced carry)
        assert.equal(P.lieReport(bare, { x, y }, { assist: P.PLAY_ASSIST, stopAt: 1 }).dead, true, `${id}: (${x.toFixed(0)}, ${y.toFixed(0)}) by ${gd.id} is dead only because of the gadgets`);
      }
    }
  }
  // the drop on the line is offered with the gadgets in play, and the game asks with them
  const g = stageGame('temple-run');
  g.ball = { x: 8, y: 301 }; g.lie = 'fairway'; g.strokes = 1;   // stuck in the Mud Bank
  const st = g.state();
  assert.equal(st.rescue, false, 'a ball in the mud is no dead lie');
  const out = g.handleShot({ Speed: 91, VLA: 25.5, HLA: 0, TotalSpin: 9300, SpinAxis: 0 });
  assert.ok(out.sim.totalYd > 80, `a wedge out of the mud flies ${out.sim.totalYd} yd`);
});
