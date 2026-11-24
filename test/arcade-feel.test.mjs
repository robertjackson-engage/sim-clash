// Arcade game feel (public/arcade/feel.js): a shot is re-timed for drama, never moved;
// time slows only by the pin, and never over the landing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { slowmoWindows, warpShot, arcadeShot, shotTrail, MAX_PLAY_S, LANDING_CLEAR_S } from '../public/arcade/feel.js';
import { flightCameraPlan, flightCameraAt, setFollowLanding } from '../public/render/flight-camera.js';
import { smoothPointAt } from '../public/render/flight-profile.js';

const require = createRequire(import.meta.url);
const { simulateShot } = require('../lib/physics.js');
const { solvePutt } = require('../lib/putt-assist.js');

const fairway = () => 'fairway';
const green = () => 'green';
const DRIVER = { speedMph: 160, vla: 12, hla: 0, totalSpin: 2500, spinAxis: 0 };
const SEVEN = { speedMph: 114, vla: 19.5, hla: 0, totalSpin: 6800, spinAxis: 0 };
const fly = (launch, surf, opts = {}) => simulateShot(launch, { x: 0, y: 0 }, 0, surf, opts);
const reasons = (w) => w.map((x) => x.reason);
const monotonic = (pts) => pts.every((p, i) => i === 0 || p.t >= pts[i - 1].t);

test('a drive nowhere near the flag: only the hit-stop, and the path is untouched', () => {
  const sim = fly(DRIVER, fairway);
  const w = warpShot(sim, { pin: { x: 300, y: 50 }, speedMph: DRIVER.speedMph });
  assert.deepEqual(reasons(w.slowmo), ['strike']);
  assert.equal(w.points.length, sim.points.length);
  w.points.forEach((p, i) => {
    assert.equal(p.x, sim.points[i].x); assert.equal(p.y, sim.points[i].y); assert.equal(p.z, sim.points[i].z);
  });
  assert.ok(monotonic(w.points));
  assert.ok(w.playS <= MAX_PLAY_S + 1e-6);
});

test('the landing is never slowed: an approach that pitches by the flag plays its bounce at full speed', () => {
  const sim = fly(SEVEN, green);
  const land = sim.land;
  for (const pin of [{ x: land.x + 2, y: land.y + 1 }, { x: sim.end.x + 0.6, y: sim.end.y }, { x: land.x, y: land.y }]) {
    const w = warpShot(sim, { pin, speedMph: SEVEN.speedMph });
    // one second before touchdown until the landing is clear: play time advances exactly as shot time does
    const t0 = sim.flightTime - 1, t1 = sim.flightTime + LANDING_CLEAR_S - 0.2;
    const played = w.toPlayTime(t1) - w.toPlayTime(t0);
    assert.ok(Math.abs(played - (t1 - t0)) < 1e-6, `the landing plays in ${played.toFixed(3)} s of ${(t1 - t0).toFixed(3)}`);
    for (const win of slowmoWindows(sim, { pin, speedMph: SEVEN.speedMph })) {
      if (win.reason !== 'strike') assert.ok(win.t0 >= sim.flightTime + LANDING_CLEAR_S - 1e-9, `${win.reason} starts after the landing`);
    }
  }
});

test('a ball that only lands near the flag, and runs well away, gets no slow motion at all', () => {
  const sim = fly({ ...DRIVER, speedMph: 150 }, fairway);   // pitches, then runs 20 yd on
  const w = slowmoWindows(sim, { pin: { x: sim.land.x + 1, y: sim.land.y + 1 }, speedMph: 80 });
  assert.deepEqual(reasons(w), []);
});

test('a holed putt slows over its last second, and the window runs to the drop', () => {
  const pin = { x: 0, y: 7 };
  const s = solvePutt({ from: { x: 0, y: 0 }, pin, surfaceAt: green, terrain: undefined });
  const sim = simulateShot({ speedMph: s.speedMph, vla: 0, hla: 0, totalSpin: 0, spinAxis: 0 }, { x: 0, y: 0 }, s.bearingDeg, green, { pin, putt: true });
  assert.equal(sim.holed, true);
  const w = warpShot(sim, { pin });
  assert.deepEqual(reasons(w.slowmo), ['holing']);
  const raw = sim.points.at(-1).t;
  assert.ok(w.playS > raw + 0.8, `plays ${w.playS.toFixed(2)} s for a ${raw.toFixed(2)} s putt`);
  assert.ok(Math.abs(w.slowmo[0].t1 - w.playS) < 1e-6);
});

test('by the pin: a putt sliding past the edge slows; one that stops a yard short does not', () => {
  const by = simulateShot({ speedMph: 7.5, vla: 0, hla: 0, totalSpin: 0, spinAxis: 0 }, { x: 0, y: 0 }, 0, green, { putt: true });
  assert.ok(by.end.y > 6.5, 'runs well past');
  assert.deepEqual(reasons(slowmoWindows(by, { pin: { x: 0.35, y: 5 } })), ['lip']);
  const short = simulateShot({ speedMph: 4.6, vla: 0, hla: 0, totalSpin: 0, spinAxis: 0 }, { x: 0, y: 0 }, 0, green, { putt: true });
  assert.deepEqual(reasons(slowmoWindows(short, { pin: { x: 0, y: short.end.y + 0.9 } })), []);
  assert.deepEqual(reasons(slowmoWindows(short, { pin: { x: 0, y: short.end.y + 0.3 } })), ['lip'], 'dying at the edge does');
});

test('a rocket ball launches on the same short hit-stop as any hard strike (no slow motion off the tee), and a long shot still fits the screen time', () => {
  const sim = fly({ ...DRIVER, speedMph: 240 }, fairway, { dragScale: 0.7 });
  const raw = sim.points.at(-1).t;
  const w = warpShot(sim, { pin: null, powerup: 'rocket', speedMph: 240 });
  assert.deepEqual(reasons(w.slowmo), ['strike']);
  assert.ok(w.playS <= MAX_PLAY_S + 1e-6, `${raw.toFixed(1)} s shot plays in ${w.playS.toFixed(1)} s`);
  assert.ok(monotonic(w.points));
  assert.ok(w.slowmo[0].t1 - w.slowmo[0].t0 < 0.45, 'under half a second on screen: a hit-stop, not slow motion');
  // a soft Rocket (a boosted wedge) gets the hit-stop too, and nothing else at launch
  const soft = warpShot(fly({ ...DRIVER, speedMph: 80 }, fairway, { dragScale: 0.7 }), { pin: null, powerup: 'rocket', speedMph: 80 });
  assert.deepEqual(reasons(soft.slowmo), ['strike']);
  // the middle is fast-forwarded, but the landing is not played any faster than the rest is squeezed
  const a = w.toPlayTime(sim.flightTime - 0.8), b = w.toPlayTime(sim.flightTime + 1.5);
  const mid = w.toPlayTime(sim.flightTime / 2 + 1) - w.toPlayTime(sim.flightTime / 2);
  assert.ok((b - a) / 2.3 >= mid - 1e-9, 'the landing gets at least as much screen time per second as mid-flight');
});

test('timed events map through; nothing to do leaves the times alone', () => {
  const sim = fly({ speedMph: 60, vla: 20, hla: 0, totalSpin: 5000, spinAxis: 0 }, fairway);
  const plain = warpShot(sim, { pin: null, speedMph: 60 });
  assert.equal(plain.points, sim.points, 'same array when unchanged');
  assert.equal(plain.playS, sim.points.at(-1).t);
  const withEv = warpShot({ ...sim, events: [{ type: 'tree', t: 0.05, x: 1, y: 1 }, { type: 'bounce', x: 2, y: 2 }] },
    { pin: null, powerup: 'rocket' });
  assert.ok(withEv.events[0].t > 0.05, 'a tree hit inside the launch window is later in play time');
  assert.equal(withEv.events[1].t, undefined);
  assert.equal(withEv.toPlayTime(0), 0);
  assert.ok(Math.abs(withEv.toPlayTime(1e9) - withEv.playS) < 1e-9);
});

test('arcadeShot keeps the raw sim and picks the trail; disabled returns the shot itself', () => {
  const sim = fly(DRIVER, fairway);
  const shot = { shotId: 1, launch: DRIVER, sim, holed: false, note: '', arcade: { grade: 'PERFECT', powerup: null } };
  const a = arcadeShot(shot, { pin: [0, 400] });
  assert.equal(a.simRaw, sim);
  assert.equal(a.sim.slowmo[0].reason, 'strike');
  assert.equal(a.trail.kind, 'rocket');
  assert.ok(shotTrail({ ...shot, arcade: { grade: 'JACKPOT' } }).heat > shotTrail({ ...shot, arcade: { grade: 'GREAT' } }).heat);
  assert.equal(shotTrail({ ...shot, arcade: { grade: 'GOOD' } }), null, 'an ordinary shot flies plain');
  assert.equal(shotTrail({ ...shot, arcade: { grade: 'MISS', powerup: 'rocket' } }).color, 0x4fd8ff, 'a rocket ball always burns');
  assert.equal(shotTrail({ ...shot, sim: { ...sim, isPutt: true } }), null);
  assert.equal(arcadeShot(shot, { pin: [0, 400] }, { enabled: false }), shot);
  setFollowLanding(false);
});

// ---- the camera through the landing (render/flight-camera.js setFollowLanding) ----
function landingFraming(launch, surf, landing) {
  setFollowLanding(landing);
  const sim = fly(launch, surf), pts = sim.points, ft = sim.flightTime, end = pts.at(-1).t;
  const plan = flightCameraPlan(pts, {
    startCam: { x: 0, y: -7, z: 2.2 }, startLook: { x: 0, y: 40, z: 1 }, flightTime: ft, isPutt: false,
    fovDeg: 58, mode: 'follow', groundAt: () => 0, treeTopAt: null, isClear: () => true,
  });
  let worst = 0, closest = Infinity, crossings = 0, lastSide = null;
  for (let t = ft - 1.2; t <= end + 0.6; t += 1 / 60) {
    const b = smoothPointAt(pts, Math.min(t, end), ft), c = flightCameraAt(plan, t, pts);
    const toB = [b.x - c.pos.x, b.y - c.pos.y, b.z - c.pos.z], d = Math.hypot(...toB);
    const f = [c.look.x - c.pos.x, c.look.y - c.pos.y, c.look.z - c.pos.z], fl = Math.hypot(...f);
    const off = Math.acos(Math.min(1, (f[0] * toB[0] + f[1] * toB[1] + f[2] * toB[2]) / (fl * d))) * 180 / Math.PI;
    worst = Math.max(worst, off / 29);   // 1 = the edge of a 58 degree frame
    closest = Math.min(closest, d);
    const side = Math.sign(toB[1]);      // is the camera still on the tee side of the ball?
    if (lastSide !== null && side !== lastSide) crossings++;
    lastSide = side;
  }
  setFollowLanding(false);
  return { worst, closest, crossings };
}

test('the arcade landing keeps the ball in the frame through its bounce; the plain camera loses it', () => {
  const plain = landingFraming(SEVEN, green, false);
  assert.ok(plain.worst > 1, `plain: the ball leaves the frame (${plain.worst.toFixed(2)})`);
  for (const [name, launch, surf] of [
    ['7-iron to a green', SEVEN, green],
    ['wedge that spins back', { speedMph: 88, vla: 28, hla: 0, totalSpin: 10500, spinAxis: 0 }, green],
    ['drive to a fairway', { ...DRIVER, speedMph: 152, hla: 2, spinAxis: 6 }, fairway],
  ]) {
    const a = landingFraming(launch, surf, true);
    assert.ok(a.worst < 0.45, `${name}: ball within ${a.worst.toFixed(2)} of the frame's middle`);
    assert.ok(a.closest > 8, `${name}: never closer than ${a.closest.toFixed(1)} m`);
    assert.equal(a.crossings, 0, `${name}: the camera never crosses to the other side of the ball`);
  }
});

// ---- a ball that goes in: the holing window follows the ball, and the drop is animated ----
import { cupDrop, CUP, HOLING, PUTT_CLEAR_S } from '../public/arcade/feel.js';
import { closeShots } from './helpers/camera-shots.mjs';

const CLOSE = closeShots();
const shotNamed = (part) => CLOSE.find((s) => s.name.includes(part));
const rawAt = (raw, t) => raw.points.reduce((a, p) => (Math.abs(p.t - t) < Math.abs(a.t - t) ? p : a), raw.points[0]);
const toPin = (p, pin) => Math.hypot(p.x - pin.x, p.y - pin.y);

test('holing: time slows as the ball closes on the cup, not at a fixed time; deeper for the last metre', () => {
  for (const name of ['40 ft putt', '7-iron that releases', '6 ft putt']) {
    const s = shotNamed(name), raw = s.raw, isPutt = !!raw.isPutt, H = isPutt ? HOLING.putt : HOLING.shot;
    const [w] = slowmoWindows(raw, { pin: s.pin }).filter((x) => x.reason === 'holing');
    const end = raw.points.at(-1).t;
    assert.ok(w, `${name}: a holing window`);
    assert.equal(w.t1, end);
    // it opens with the ball inside closeM, and never reaches back more than closeS
    assert.ok(toPin(rawAt(raw, w.t0), s.pin) <= H.closeM + 0.05, `${name}: opens ${toPin(rawAt(raw, w.t0), s.pin).toFixed(2)} m out`);
    assert.ok(w.t0 >= end - H.closeS - 1e-9);
    // nothing before the landing is clear (or, for a putt, before it has got away)
    assert.ok(w.t0 >= (isPutt ? Math.min(PUTT_CLEAR_S, end / 3) : raw.flightTime + LANDING_CLEAR_S) - 1e-9, `${name}: opens at ${w.t0.toFixed(2)}`);
    // the deep part: inside deepM, the last deepS at most, slower than the rest
    assert.ok(w.deep.t0 >= w.t0 && w.deep.t0 >= end - H.deepS - 1e-9 && w.deep.rate < w.rate);
    assert.ok(toPin(rawAt(raw, w.deep.t0), s.pin) <= H.deepM + 0.05 || w.deep.t0 === w.t0, `${name}: deepens ${toPin(rawAt(raw, w.deep.t0), s.pin).toFixed(2)} m out`);
  }
  // a 40 ft putt is still at full speed while the ball is far from the hole
  const long = shotNamed('40 ft putt'), w = long.sim;
  assert.ok(Math.abs(w.toPlayTime(1.5) - 1.5) < 1e-6, 'the first second and a half of a long putt is untouched');
});

test('the drop: a holed ball runs on to the cup, tips in and falls out of sight; then a hold; and it is timed', () => {
  for (const s of CLOSE.filter((x) => x.want === 'holed')) {
    const w = s.sim, k = w.cup, pts = w.points, last = pts.at(-1);
    assert.ok(k, `${s.name}: has a drop`);
    assert.equal(w.cupDropT, k.tDrop);
    assert.ok(k.t0 <= k.tTip && k.tTip < k.tDrop && Math.abs(k.tEnd - k.tDrop - CUP.holdS) < 1e-9 && Math.abs(k.tEnd - w.playS) < 1e-9, `${s.name}: taken, tips, drops, holds`);
    assert.ok(w.playS <= MAX_PLAY_S + 1e-6);
    // the events: the app and the HUD key the sound and the roar to these
    const ev = w.events.find((e) => e.type === 'cup-drop'), holed = w.events.find((e) => e.type === 'holed');
    assert.ok(ev && ev.t === k.tDrop && ev.t0 === k.t0 && ev.tEnd === k.tEnd && ev.x === s.pin.x && ev.y === s.pin.y);
    assert.equal(holed.t, k.tDrop, 'the holed event lands on the drop');
    // the ball ends in the hole, on the pin, below the green
    assert.ok(toPin(last, s.pin) < 1e-9 && Math.abs(last.z - (k.z - CUP.depthM)) < 1e-9);
    // from the moment the cup takes it: no jump (the server's path puts it on the pin in one step),
    // on the green until it tips, then down, never back up out of the hole
    let prev = null, low = Infinity;
    for (const p of pts) {
      if (p.t < k.t0 - 1e-9) { prev = null; continue; }
      if (prev) assert.ok(Math.hypot(p.x - prev.x, p.y - prev.y) < 0.05, `${s.name}: t=${p.t.toFixed(2)} jumps ${Math.hypot(p.x - prev.x, p.y - prev.y).toFixed(3)} m`);
      if (p.t >= k.t0 && p.t < k.tTip - 1e-9) assert.ok(Math.abs(p.z - k.z) < 1e-9, `${s.name}: on the green until it tips`);
      if (p.z < k.z - 1e-9) { assert.ok(p.z <= low + 1e-9, `${s.name}: falling`); low = p.z; }
      prev = p;
    }
    assert.ok(monotonic(pts));
    // the holing window runs through the drop and the hold
    const hw = w.slowmo.find((x) => x.reason === 'holing');
    assert.ok(hw && Math.abs(hw.t1 - w.playS) < 1e-9 && hw.t0 <= k.t0 + 1e-9);
  }
  // nobody else gets one
  for (const s of CLOSE.filter((x) => x.want !== 'holed')) {
    assert.equal(s.sim.cup, undefined);
    assert.equal(s.sim.cupDropT, undefined);
    assert.ok(!s.sim.events.some((e) => e.type === 'cup-drop'));
  }
});

test('a ball straight in: the flight and the pitch at full speed, only the drop itself slowed', () => {
  const s = shotNamed('slam dunk'), raw = s.raw, w = s.sim;
  assert.deepEqual(reasons(slowmoWindows(raw, { pin: s.pin })), [], 'nothing in shot time: there is no roll to slow');
  const ft = raw.flightTime;
  assert.ok(Math.abs((w.toPlayTime(ft) - w.toPlayTime(ft - 1)) - 1) < 1e-6, 'the last second of the flight plays in a second');
  const hw = w.slowmo.find((x) => x.reason === 'holing');
  assert.ok(hw && Math.abs(hw.t0 - w.cup.t0) < 1e-9 && hw.rate === CUP.directRate, 'the window opens as the cup takes the ball');
});

test('cupDrop: slow or fast, near or metres out (a Magnet catch), the ball runs in smoothly and drops', () => {
  const pin = { x: 3, y: 40 };
  for (const [name, from, vel] of [
    ['dying at the lip', { x: 3.02, y: 39.82 }, { x: 0, y: 0.3 }],
    ['with pace', { x: 2.9, y: 39.83 }, { x: 0.4, y: 2.6 }],
    ['a Magnet catch 2.5 m out, going past', { x: 5.2, y: 38.9 }, { x: -1, y: 6 }],
    ['already on the pin', { x: 3, y: 40 }, { x: 0, y: 0 }],
  ]) {
    const d = cupDrop(from, vel, pin);
    const first = d.points[0], last = d.points.at(-1);
    assert.ok(Math.hypot(first.x - from.x, first.y - from.y) < 1e-9 && first.z === 0, `${name}: starts where the cup took it`);
    assert.ok(Math.hypot(last.x - pin.x, last.y - pin.y) < 1e-9 && last.z === -CUP.depthM && last.t === d.tDrop, `${name}: ends in the hole`);
    assert.ok(d.tDrop <= CUP.gatherMaxS + 0.16 + Math.sqrt(2 * CUP.depthM / 9.81) + 0.01, `${name}: takes ${d.tDrop.toFixed(2)} s`);
    let prev = first;
    for (const p of d.points.slice(1)) {
      assert.ok(Math.hypot(p.x - prev.x, p.y - prev.y) < 0.02 && p.t > prev.t, `${name}: t=${p.t.toFixed(3)} smooth`);
      // it only goes under the green once it is over the hole
      if (p.z < 0) assert.ok(Math.hypot(p.x - pin.x, p.y - pin.y) < CUP.rimM + 1e-9, `${name}: falls inside the hole`);
      prev = p;
    }
    // a ball with pace hops off the back of the cup before it drops; a dying one just falls
    const hop = Math.max(...d.points.map((p) => p.z));
    assert.equal(hop > 0.02, Math.hypot(vel.x, vel.y) >= CUP.rattleMps, `${name}: hop ${hop.toFixed(3)}`);
  }
});
