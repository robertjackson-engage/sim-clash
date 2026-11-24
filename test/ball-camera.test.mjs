// The ball cam and its pin cam (public/render/flight-camera.js, mode 'ball'): real shots
// (lib/physics.js), re-timed as the game plays them (public/arcade/feel.js), filmed frame
// by frame through the whole playback. What must hold for every one of them: the camera
// moves continuously, never crosses to the other side of the ball, keeps the ball in the
// frame, and never goes under the ground or into the ball.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  flightCameraPlan, flightCameraAt, closeOne, BALL_CAM, PIN_CAM, CAM_CLEARANCE_M, ADDRESS,
} from '../public/render/flight-camera.js';
import { aboveView, SEE_OVER } from '../public/render/see-over.js';   // v2:seeover
import { closeShots, flights, film, ndc, address, FLAT, SEVEN } from './helpers/camera-shots.mjs';
import { createRequire } from 'node:module';
import { warpShot } from '../public/arcade/feel.js';

const require = createRequire(import.meta.url);
const { simulateShot } = require('../lib/physics.js');

const CLOSE = closeShots();
const FLIGHTS = flights();
const byName = (list, part) => list.find((s) => s.name.includes(part));
const cupOf = (s) => ({ x: s.pin.x, y: s.pin.y, z: s.terrain.h(s.pin.x, s.pin.y) });
// how much of the frame's height the ball (drawn 17 cm across) takes up
const ballShare = (f) => (2 * Math.atan(0.085 / f.dist)) / (2 * Math.atan(Math.tan(29 * Math.PI / 180) / (f.cam.zoom || 1)));

// ---- what is true of every shot ----
function everyShot(s, m) {
  const n = s.name;
  // it leaves exactly from the address camera, looking where it looked
  const a = address(s.sim.points[0], s.pin && Math.hypot(s.pin.x, s.pin.y) < 400 ? s.pin : { x: s.sim.points[0].x + Math.sin(s.aimDeg * Math.PI / 180), y: s.sim.points[0].y + Math.cos(s.aimDeg * Math.PI / 180) }, (x, y) => s.terrain.h(x, y));
  const c0 = m.frames[0].cam;
  assert.ok(Math.hypot(c0.pos.x - a.startCam.x, c0.pos.y - a.startCam.y, c0.pos.z - a.startCam.z) < 1e-9, `${n}: starts at the address camera`);
  assert.ok(Math.hypot(c0.look.x - a.startLook.x, c0.look.y - a.startLook.y, c0.look.z - a.startLook.z) < 1e-6, `${n}: looking where it looked`);
  assert.ok(Math.abs((c0.zoom ?? 1) - 1) < 1e-9 && Math.abs(c0.roll || 0) < 1e-5, `${n}: on the address lens, level`);
  // continuous: its position, its speed and its view each change a little per frame, never in a jump
  assert.ok(m.maxStep < 1.4 * m.maxBallStep + 0.2, `${n}: moves ${m.maxStep.toFixed(2)} m in a frame (the ball ${m.maxBallStep.toFixed(2)})`);
  assert.ok(m.maxKick < 0.08 * m.maxBallStep + 0.03, `${n}: its velocity jumps ${m.maxKick.toFixed(3)} m/frame in one frame`);
  assert.ok(m.maxTurn < 2.5, `${n}: the view swings ${m.maxTurn.toFixed(2)} deg in a frame`);
  // never on the far side of the ball from where the ball came
  assert.ok(m.minAhead > 1.2, `${n}: at its least ${m.minAhead.toFixed(2)} m on the near side of the ball`);
  for (const f of m.frames) assert.ok(f.ahead > 0, `${n}: t=${f.t.toFixed(2)} the ball is in front of the lens`);
  // the ball inside the frame, all the way
  const early = Math.max(...m.frames.filter((f) => f.t <= 0.5).map((f) => Math.max(Math.abs(f.ballNdc.x), Math.abs(f.ballNdc.y))));
  assert.ok(early < 0.9, `${n}: off the tee the ball is within ${early.toFixed(2)} of the frame`);
  assert.ok(m.maxNdc < 0.75, `${n}: the ball strays to ${m.maxNdc.toFixed(2)} of the frame`);
  // never under the ground, nor with ground between it and the ball, nor inside the ball
  assert.ok(m.minClear > PIN_CAM.clearM - 0.02, `${n}: ${m.minClear.toFixed(2)} m off the ground at its lowest`);
  assert.ok(m.minSight > 0, `${n}: the ground comes within ${m.minSight.toFixed(2)} m of its line to the ball`);
  assert.ok(m.minDist > 2, `${n}: never nearer the ball than ${m.minDist.toFixed(2)} m`);
  // and it ends at rest
  const last = m.frames.at(-1), before = m.frames.at(-13);
  assert.ok(Math.hypot(last.cam.pos.x - before.cam.pos.x, last.cam.pos.y - before.cam.pos.y, last.cam.pos.z - before.cam.pos.z) < 0.25, `${n}: comes to rest`);
}

test('ball cam: every shot is filmed in one continuous move, the ball always in frame, from the same side', () => {
  for (const s of [...CLOSE, ...FLIGHTS]) everyShot(s, film(s));
});

// ---- the pin cam ----
test('a close one is called at impact: holed, by the lip, or finishing inside 15 ft; nothing else', () => {
  for (const s of CLOSE) {
    const c = closeOne(s.sim.points, { pin: s.pin, flightTime: s.sim.flightTime, isPutt: s.sim.isPutt, cup: s.sim.cup || null });
    assert.ok(c, `${s.name}: a close one`);
    if (s.want === 'holed') assert.equal(c.kind, 'holed', s.name);
    else assert.ok(c.kind === 'lip' || c.kind === 'close', `${s.name}: ${c.kind}`);
    assert.equal(!!c.direct, !!s.direct || s.name === 'chip-in', `${s.name}: straight in?`);
  }
  assert.equal(byName(CLOSE, 'lip-out').sim.cup, undefined);
  assert.equal(closeOne(byName(CLOSE, 'lip-out').sim.points, { pin: byName(CLOSE, 'lip-out').pin, isPutt: true }).kind, 'lip');
  for (const s of FLIGHTS) assert.equal(film(s).plan.pinCam, null, `${s.name}: an ordinary shot`);
  // 30 ft away is not close: the roll camera, at its own distance
  const free = simulateShot(SEVEN, { x: 0, y: 0 }, 0, () => 'green', {});
  const pin = { x: free.end.x, y: free.end.y + 9 };
  const far = { name: '30 ft away', sim: warpShot(simulateShot(SEVEN, { x: 0, y: 0 }, 0, () => 'green', { pin }), { pin }), pin, terrain: FLAT, aimDeg: 0 };
  const m = film(far);
  assert.equal(m.plan.pinCam, null);
  assert.ok(Math.abs(m.frames.at(-1).dist - Math.hypot(BALL_CAM.rollBackM, BALL_CAM.rollUpM)) < 0.3, `rests ${m.frames.at(-1).dist.toFixed(2)} m from the ball`);
  assert.equal(m.frames.at(-1).cam.zoom, 1);
});

test('pin cam: a close one ends low and tight behind the ball, with the cup in the picture', () => {
  for (const s of CLOSE) {
    const m = film(s), last = m.frames.at(-1), cup = cupOf(s);
    const c = ndc(last.cam, cup);
    const camToCup = Math.hypot(last.cam.pos.x - cup.x, last.cam.pos.y - cup.y, last.cam.pos.z - cup.z);
    assert.ok(last.clear < 1.0, `${s.name}: ends ${last.clear.toFixed(2)} m off the green`);
    assert.ok(c.depth > 0 && Math.abs(c.x) < 0.85 && Math.abs(c.y) < 0.85, `${s.name}: the cup at (${c.x.toFixed(2)}, ${c.y.toFixed(2)})`);
    assert.ok(last.cam.zoom >= 1.6, `${s.name}: lens ${last.cam.zoom.toFixed(2)}`);
    if (s.name === 'lip-out') {
      // the ball has run on metres past: it is the cup the camera stayed behind
      assert.ok(camToCup < 4, `${s.name}: ${camToCup.toFixed(2)} m from the cup`);
    } else {
      assert.ok(last.dist < 4, `${s.name}: ${last.dist.toFixed(2)} m from the ball`);
      assert.ok(ballShare(last) > 0.08, `${s.name}: the ball is ${(100 * ballShare(last)).toFixed(0)} % of the frame's height`);
    }
    // it only ever closes in once it has taken over: no pulling back out
    const tA = s.sim.isPutt ? 0.5 : s.sim.flightTime + 1.2;
    let prev = Infinity;
    for (const f of m.frames) {
      if (f.t < tA) continue;
      const d = Math.min(f.dist, Math.hypot(f.cam.pos.x - cup.x, f.cam.pos.y - cup.y, f.cam.pos.z - cup.z));
      assert.ok(d < prev + 0.06, `${s.name}: t=${f.t.toFixed(2)} backs away (${d.toFixed(2)} after ${prev.toFixed(2)})`);
      prev = Math.min(prev, d);
    }
  }
});

test('pin cam: at the drop the camera is within a few metres of the cup, ball and cup both in frame, and holds there', () => {
  for (const s of CLOSE.filter((x) => x.want === 'holed')) {
    const m = film(s), cup = cupOf(s), k = s.sim.cup;
    assert.ok(k && s.sim.cupDropT === k.tDrop, `${s.name}: the drop is timed`);
    for (const t of [k.t0, k.tTip, (k.tTip + k.tDrop) / 2, k.tDrop, k.tEnd]) {
      const f = m.at(t), c = ndc(f.cam, cup);
      const d = Math.hypot(f.cam.pos.x - cup.x, f.cam.pos.y - cup.y, f.cam.pos.z - cup.z);
      const lim = !m.plan.pinCam.direct ? 5.5 : t >= k.tDrop ? 6.5 : 13;   // a ball straight in has only just arrived: the camera pushes in through the drop
      assert.ok(d < lim, `${s.name}: t=${t.toFixed(2)} the camera is ${d.toFixed(2)} m from the cup`);
      assert.ok(c.depth > 0 && Math.abs(c.x) < 0.7 && Math.abs(c.y) < 0.7, `${s.name}: t=${t.toFixed(2)} cup at (${c.x.toFixed(2)}, ${c.y.toFixed(2)})`);
      assert.ok(Math.abs(f.ballNdc.x) < 0.7 && Math.abs(f.ballNdc.y) < 0.7, `${s.name}: t=${t.toFixed(2)} ball at (${f.ballNdc.x.toFixed(2)}, ${f.ballNdc.y.toFixed(2)})`);
    }
    const drop = m.at(k.tDrop);
    assert.ok(drop.cam.zoom > 1.5, `${s.name}: lens ${drop.cam.zoom.toFixed(2)} at the drop`);
    // it does not look down the hole after the ball: the view holds on the cup's mouth
    assert.ok(m.at(k.tEnd).cam.look.z > cup.z - 0.05, `${s.name}: looks at the cup, not into it`);
    // rolling in (not straight in): the cup is ahead of the ball in the frame through the last second and a half
    if (!s.direct && !s.back && s.name !== 'chip-in') {
      for (let t = Math.max(s.sim.isPutt ? 1 : s.sim.flightTime + 1.6, k.t0 - 1.5); t < k.t0; t += 0.1) {
        const f = m.at(t), c = ndc(f.cam, cup);
        assert.ok(c.depth > f.ballNdc.depth - 0.05 && Math.abs(c.x) < 0.9 && Math.abs(c.y) < 0.9, `${s.name}: t=${t.toFixed(2)} the cup is ahead, in frame (${c.x.toFixed(2)}, ${c.y.toFixed(2)})`);
      }
    }
  }
});

test('pin cam: a ball that pitches past the flag and spins back is watched over the cup, from the side it came from', () => {
  const s = byName(CLOSE, 'spins back into the hole'), m = film(s), cup = cupOf(s), k = s.sim.cup;
  assert.ok(s.raw.land.y > s.pin.y + 1, 'it pitched past the flag');
  for (let t = k.t0 - 1; t <= k.tDrop; t += 0.1) {
    const f = m.at(t), c = ndc(f.cam, cup);
    assert.ok(c.depth > 0 && c.depth < f.ballNdc.depth + 0.05, `t=${t.toFixed(2)}: the cup is between the camera and the ball`);
    assert.ok(f.cam.pos.y < cup.y - 1.5, `t=${t.toFixed(2)}: still on the tee side`);
  }
});

test('the 7-iron that releases really does run 30 ft to the hole', () => {
  const s = byName(CLOSE, 'releases 30 ft');
  assert.ok(Math.hypot(s.pin.x - s.raw.land.x, s.pin.y - s.raw.land.y) > 8.5 && s.raw.holed);
  assert.ok(s.pin.y > s.raw.land.y, 'toward the flag');
});

test('pin cam: a ball straight in: the lens is already closing on the flag before the ball arrives', () => {
  const s = byName(CLOSE, 'slam dunk'), m = film(s), ft = s.sim.flightTime, cup = cupOf(s);
  assert.equal(m.plan.pinCam.direct, true);
  assert.ok(m.at(ft - 2).cam.zoom < 1.05, 'wide two seconds out');
  assert.ok(m.at(ft - 0.3).cam.zoom > 1.35, `tightening before touchdown (${m.at(ft - 0.3).cam.zoom.toFixed(2)})`);
  const c = ndc(m.at(ft - 0.15).cam, cup);
  assert.ok(c.depth > 0 && Math.abs(c.x) < 0.8 && Math.abs(c.y) < 0.8, `the cup is in the frame as the ball comes down (${c.x.toFixed(2)}, ${c.y.toFixed(2)})`);
  // and after the drop it pushes in on the cup
  assert.ok(m.frames.at(-1).dist < m.at(ft).dist - 4);
});

test('pin cam: a lip-out keeps the cup in the frame after the ball has gone by', () => {
  const s = byName(CLOSE, 'lip-out'), m = film(s), cup = cupOf(s);
  const tNear = m.plan.pinCam.tNear;
  for (const f of m.frames) {
    if (f.t < tNear - 1) continue;
    const c = ndc(f.cam, cup);
    assert.ok(c.depth > 0 && Math.abs(c.x) < 0.9 && Math.abs(c.y) < 0.9, `t=${f.t.toFixed(2)}: cup at (${c.x.toFixed(2)}, ${c.y.toFixed(2)})`);
  }
  assert.ok(m.at(tNear).cam.zoom > 1.5 && m.at(tNear).dist < 4.5, 'tight as it burns the edge');
});

test('pin cam: a putt is chased from the start, low, closing as it nears the cup', () => {
  const s = byName(CLOSE, '40 ft'), m = film(s);
  const third = m.at(s.sim.cup.t0 / 3), late = m.at(s.sim.cup.t0 - 0.5);
  assert.ok(third.dist < 7 && third.clear < 2, `a third of the way: ${third.dist.toFixed(1)} m back, ${third.clear.toFixed(1)} m up`);
  assert.ok(late.dist < 3.2 && late.clear < 0.8, `near the cup: ${late.dist.toFixed(1)} m back, ${late.clear.toFixed(1)} m up`);
  assert.ok(late.cam.zoom > third.cam.zoom);
  // the old cameras leave a putt alone
  const still = film(s, { mode: 'follow' });
  assert.ok(Math.hypot(still.frames.at(-1).cam.pos.x - still.frames[0].cam.pos.x, still.frames.at(-1).cam.pos.y - still.frames[0].cam.pos.y) < 1e-9);
});

// ---- the whole flight ----
test('ball cam: it flies with the ball, behind and above it, the ball under the middle of the frame', () => {
  for (const s of FLIGHTS) {
    const m = film(s), ft = s.sim.flightTime;
    for (const f of m.frames) {
      if (f.t < (s.name.includes('rocket') ? 3.5 : 2) || f.t > ft - 1.2) continue;   // a rocket ball is still getting away
      const hag = f.ball.z - s.terrain.h(f.ball.x, f.ball.y);
      if (hag < 4) continue;   // skimming a cliff top
      assert.ok(f.cam.pos.z > f.ball.z, `${s.name}: t=${f.t.toFixed(2)} above the ball`);
      assert.ok(f.dist > 4 && f.dist < 16, `${s.name}: t=${f.t.toFixed(2)} ${f.dist.toFixed(1)} m behind`);
      assert.ok(f.ballNdc.y < 0.12 && f.ballNdc.y > -0.6 && Math.abs(f.ballNdc.x) < 0.35, `${s.name}: t=${f.t.toFixed(2)} ball at (${f.ballNdc.x.toFixed(2)}, ${f.ballNdc.y.toFixed(2)})`);
      // looking forward and down: never up at the sky, never straight down at the turf
      const pitch = Math.asin(f.dir[2]) * 180 / Math.PI;
      assert.ok(pitch < 0 && pitch > -45, `${s.name}: t=${f.t.toFixed(2)} looking ${(-pitch).toFixed(0)} deg down`);
    }
  }
});

test('ball cam: the landing spot is in the picture, ahead and below, from the apex down', () => {
  for (const part of ['drive', 'high wedge']) {
    const s = byName(FLIGHTS, part), m = film(s), ft = s.sim.flightTime;
    const land = { x: s.raw.land.x, y: s.raw.land.y, z: s.raw.land.z };
    let ap = s.sim.points[0];
    for (const p of s.sim.points) { if (p.t > ft) break; if (p.z > ap.z) ap = p; }
    for (let t = ap.t; t < ft - 0.1; t += 0.1) {
      const f = m.at(t), c = ndc(f.cam, land);
      assert.ok(c.depth > 0 && Math.abs(c.x) < 0.9 && c.y < 0.3 && c.y > -0.98, `${s.name}: t=${t.toFixed(2)} landing spot at (${c.x.toFixed(2)}, ${c.y.toFixed(2)})`);
    }
    // it pitches forward as the ball comes down
    const pitchAt = (t) => Math.asin(m.at(t).dir[2]) * 180 / Math.PI;
    assert.ok(pitchAt(ft - 1.4) < pitchAt(ap.t) - 6, `${s.name}: ${pitchAt(ap.t).toFixed(0)} deg at the apex, ${pitchAt(ft - 1.4).toFixed(0)} coming down`);
  }
});

test('ball cam: through the pitch and the bounces it stays behind the ball, then closes in along the ground', () => {
  for (const part of ['drive', 'high wedge', 'big slice']) {
    const s = byName(FLIGHTS, part), m = film(s), ft = s.sim.flightTime;
    for (const f of m.frames) {
      if (f.t < ft - 0.5 || f.t > ft + 1.5) continue;
      assert.ok(f.behind > 4 && Math.max(Math.abs(f.ballNdc.x), Math.abs(f.ballNdc.y)) < 0.6, `${s.name}: t=${f.t.toFixed(2)} ${f.behind.toFixed(1)} m behind, ball at (${f.ballNdc.x.toFixed(2)}, ${f.ballNdc.y.toFixed(2)})`);
    }
    const last = m.frames.at(-1);
    assert.ok(last.dist < m.at(ft + 0.3).dist - 4 && last.clear < m.at(ft + 0.3).clear, `${s.name}: closes from ${m.at(ft + 0.3).dist.toFixed(1)} to ${last.dist.toFixed(1)} m`);
    assert.ok(Math.abs(last.clear - BALL_CAM.rollUpM) < 0.1);
  }
});

test('ball cam: speed is felt: the lens opens at pace, most on a rocket; a slice banks the camera into the curve', () => {
  const zoomMin = (part) => film(byName(FLIGHTS, part)).minZoom;
  assert.ok(zoomMin('rocket') < 0.88 && zoomMin('rocket') >= 1 - BALL_CAM.widen - 1e-9, `rocket ${zoomMin('rocket').toFixed(2)}`);
  assert.ok(zoomMin('drive') < 0.95 && zoomMin('drive') > zoomMin('rocket'), `drive ${zoomMin('drive').toFixed(2)}`);
  assert.ok(zoomMin('high wedge') > 0.99, 'a wedge is filmed on the plain lens');
  const slice = film(byName(FLIGHTS, 'big slice')), straight = film(byName(FLIGHTS, 'drive'));
  assert.ok(straight.maxRoll < 0.5 * Math.PI / 180, 'a straight ball flies level');
  assert.ok(slice.maxRoll > 2 * Math.PI / 180 && slice.maxRoll <= BALL_CAM.bankMaxDeg * Math.PI / 180 + 1e-9, `${(slice.maxRoll * 57.3).toFixed(1)} deg`);
  const mid = slice.at(byName(FLIGHTS, 'big slice').sim.flightTime * 0.6);
  assert.ok(mid.cam.roll > 0, 'curving right, it leans right');
  // and the roll is gone by the time the ball is down
  assert.ok(Math.abs(slice.frames.at(-1).cam.roll) < 1e-6);
  // the ball is drawn bigger high in the air, life size (as drawn) on the ground
  assert.ok(straight.at(3).cam.ballScale > 2 && Math.abs(straight.frames.at(-1).cam.ballScale - 1) < 1e-6 && Math.abs(straight.frames[0].cam.ballScale - 1) < 0.05);
});

test('ball cam: off a 60 m cliff, up onto a butte 80 m above, and into its wall: over the ground all the way', () => {
  for (const part of ['60 m cliff', 'butte 80 m', 'butte wall']) {
    const s = byName(FLIGHTS, part), m = film(s);
    assert.ok(m.minClear >= BALL_CAM.rollClearM - 1e-6, `${s.name}: ${m.minClear.toFixed(2)} m clear at its lowest`);
    assert.ok(m.minSight > 0.04, `${s.name}: sight line ${m.minSight.toFixed(2)} m over the ground`);
  }
  const cliff = byName(FLIGHTS, '60 m cliff'), mc = film(cliff);
  assert.ok(mc.frames.at(-1).cam.pos.z < 5 && mc.frames[0].cam.pos.z > 60, 'it goes down with the ball');
  const up = byName(FLIGHTS, 'butte 80 m'), mu = film(up);
  assert.ok(up.raw.endZ > 79, 'the ball finishes on top');
  assert.ok(mu.frames.at(-1).cam.pos.z > 80 + BALL_CAM.rollClearM - 1e-6, 'and so does the camera');
});

test('ball cam: it is lifted, smoothly, over tree crowns in its way', () => {
  const s = byName(FLIGHTS, 'drive');
  const crowns = (x, y) => (y > 215 && y < 262 ? 16 : -Infinity);   // a wood across the landing area
  const m = film(s, { treeTopAt: crowns });
  let prev = null;
  for (const f of m.frames) {
    if (f.t < 0.7) continue;
    assert.ok(f.cam.pos.z >= Math.max(crowns(f.cam.pos.x, f.cam.pos.y), 0) - 1e-6, `t=${f.t.toFixed(2)} in the trees`);
    if (prev !== null) assert.ok(Math.abs(f.cam.pos.z - prev) < 1.2, `t=${f.t.toFixed(2)} jumped ${Math.abs(f.cam.pos.z - prev).toFixed(2)} m`);
    prev = f.cam.pos.z;
  }
  assert.ok(m.maxNdc < 0.8, `the ball stays in the frame (${m.maxNdc.toFixed(2)})`);
});

test('the other cameras are as they were: follow has no ball-cam extras, and no pin cam', () => {
  const s = byName(CLOSE, '7-iron');
  const plan = flightCameraPlan(s.sim.points, {
    ...address(s.sim.points[0], s.pin), flightTime: s.sim.flightTime, mode: 'follow', groundAt: () => 0,
    pin: s.pin, holed: true, cup: s.sim.cup,
  });
  assert.equal(plan.pinCam, undefined);
  const c = flightCameraAt(plan, s.sim.cup.tDrop, s.sim.points);
  assert.equal(c.zoom, 1);
  assert.equal(c.roll, undefined);
  assert.ok(c.pos.z >= CAM_CLEARANCE_M - 1e-6);
});

// ---- v2:seeover the hand-over from a raised address camera ----
// The arcade's address camera may stand 35 m above the ball and 40 m back (see-over.js), or
// 110 m up in the view from above, when the ball is struck. The ball cam takes over from
// exactly there and comes down with the shot.
function raisedStarts(s) {
  const p0 = s.sim.points[0], g = (x, y) => s.terrain.h(x, y), a = s.aimDeg * Math.PI / 180;
  const ux = Math.sin(a), uy = Math.cos(a), bz = g(p0.x, p0.y);
  const crane = { x: p0.x - ux * SEE_OVER.maxBackM, y: p0.y - uy * SEE_OVER.maxBackM, z: bz + SEE_OVER.maxUpM };
  // looking down the line, the ball low in the frame
  const pitch = Math.atan2(SEE_OVER.maxUpM, SEE_OVER.maxBackM) - Math.atan(0.55 * Math.tan(29 * Math.PI / 180));
  const far = s.pin && Math.hypot(s.pin.x - p0.x, s.pin.y - p0.y) < 400 ? s.pin : s.sim.points.at(-1);
  const up = aboveView({ ball: p0, azDeg: s.aimDeg, far: [far], groundAt: g, ballNdc: 0.6 });
  return [
    ['the see-over camera at its caps', { startCam: crane, startLook: { x: crane.x + ux * 80, y: crane.y + uy * 80, z: crane.z - Math.tan(pitch) * 80 } }],
    ['the view from above', { startCam: up.cam, startLook: up.look }],
  ];
}

test('ball cam: from a raised address camera it starts exactly there and comes down with the shot, the ball in the frame all the way', () => {
  for (const s of [...CLOSE, ...FLIGHTS]) {
    const plain = film(s);
    for (const [from, start] of raisedStarts(s)) {
      const n = `${s.name}, from ${from}`, m = film(s, { start });
      const c0 = m.frames[0].cam;
      assert.ok(Math.hypot(c0.pos.x - start.startCam.x, c0.pos.y - start.startCam.y, c0.pos.z - start.startCam.z) < 1e-9, `${n}: starts at the address camera`);
      assert.ok(Math.hypot(c0.look.x - start.startLook.x, c0.look.y - start.startLook.y, c0.look.z - start.startLook.z) < 1e-6, `${n}: looking where it looked`);
      assert.ok(Math.abs((c0.zoom ?? 1) - 1) < 1e-9 && Math.abs(c0.roll || 0) < 1e-5, `${n}: on the address lens, level`);
      // it leaves at rest and is never faster than the ball plus its own way down
      assert.ok(m.frames[1].step < 0.02, `${n}: jumps ${m.frames[1].step.toFixed(3)} m in the first frame`);
      const down = 1.5 * ADDRESS.comeDownMps / 60;   // the cubic's top speed, per frame
      assert.ok(m.maxStep < 1.4 * m.maxBallStep + 0.2 + down, `${n}: moves ${m.maxStep.toFixed(2)} m in a frame (the ball ${m.maxBallStep.toFixed(2)})`);
      assert.ok(m.maxKick < 0.08 * m.maxBallStep + 0.06, `${n}: its velocity jumps ${m.maxKick.toFixed(3)} m/frame in one frame`);
      assert.ok(m.maxTurn < 2.5, `${n}: the view swings ${m.maxTurn.toFixed(2)} deg in a frame`);
      // the ball in the frame from the first frame to the last, in front of the lens, never under ground
      for (const f of m.frames) assert.ok(f.ahead > 0 && Math.abs(f.ballNdc.x) < 0.9 && Math.abs(f.ballNdc.y) < 0.92, `${n}: t=${f.t.toFixed(2)} ball at (${f.ballNdc.x.toFixed(2)}, ${f.ballNdc.y.toFixed(2)})`);
      assert.ok(m.maxNdc < 0.75, `${n}: the ball strays to ${m.maxNdc.toFixed(2)} of the frame`);
      assert.ok(m.minClear > PIN_CAM.clearM - 0.02, `${n}: ${m.minClear.toFixed(2)} m off the ground at its lowest`);
      assert.ok(m.minSight > 0, `${n}: the ground comes within ${m.minSight.toFixed(2)} m of its line to the ball`);
      // once it is down it is the ball cam of any other shot: it ends where the plain one ends (a putt watched
      // from above came at the ball from the pin's line, not the aim's, so its pin cam may sit a step round), at rest
      const last = m.frames.at(-1), ref = plain.frames.at(-1), before = m.frames.at(-13);
      assert.ok(Math.hypot(last.cam.pos.x - ref.cam.pos.x, last.cam.pos.y - ref.cam.pos.y, last.cam.pos.z - ref.cam.pos.z) < (s.sim.isPutt ? 2.5 : 0.6), `${n}: ends ${Math.hypot(last.cam.pos.x - ref.cam.pos.x, last.cam.pos.y - ref.cam.pos.y, last.cam.pos.z - ref.cam.pos.z).toFixed(2)} m from where the plain ball cam ends`);
      assert.ok(Math.hypot(last.cam.pos.x - before.cam.pos.x, last.cam.pos.y - before.cam.pos.y, last.cam.pos.z - before.cam.pos.z) < 0.25, `${n}: comes to rest`);
      // and it does come down: within three and a half seconds (or the shot's own length) it is the plain camera's path
      const tDown = Math.min(3.7, 0.85 * m.end), a = m.at(tDown), b = plain.at(tDown);
      assert.ok(Math.hypot(a.cam.pos.x - b.cam.pos.x, a.cam.pos.y - b.cam.pos.y, a.cam.pos.z - b.cam.pos.z) < 3, `${n}: still ${Math.hypot(a.cam.pos.x - b.cam.pos.x, a.cam.pos.y - b.cam.pos.y, a.cam.pos.z - b.cam.pos.z).toFixed(1)} m off the chase at ${tDown.toFixed(1)} s`);
    }
  }
});

test('ball cam: struck while the address camera is gliding, it takes the camera over moving, not from a standstill', () => {
  const s = byName(FLIGHTS, 'drive');
  const [, start] = raisedStarts(s)[0];
  const still = film(s, { start });
  const vel = { x: 0, y: -6, z: 14 };   // on its way up and back, 15 m/s
  const m = film(s, { start: { ...start, startVel: vel } });
  const c0 = m.frames[0].cam, c1 = m.frames[1].cam;
  assert.ok(Math.hypot(c0.pos.x - start.startCam.x, c0.pos.y - start.startCam.y, c0.pos.z - start.startCam.z) < 1e-9, 'no jump at impact');
  const v1 = [(c1.pos.x - c0.pos.x) * 60, (c1.pos.y - c0.pos.y) * 60, (c1.pos.z - c0.pos.z) * 60];
  assert.ok(Math.hypot(v1[0] - vel.x, v1[1] - vel.y, v1[2] - vel.z) < 3, `it leaves at (${v1.map((v) => v.toFixed(1))}) m/s`);
  assert.ok(still.frames[1].step < 0.02 && m.frames[1].step > 0.2);
  assert.ok(m.maxNdc < 0.75 && m.minClear > 1 && m.maxTurn < 2.5);
  // a glide faster than the cap is not carried whole into the shot
  const fast = film(s, { start: { ...start, startVel: { x: 0, y: 0, z: 160 } } });
  assert.ok(fast.frames[1].step * 60 < ADDRESS.maxGlideMps + 1, `${(fast.frames[1].step * 60).toFixed(0)} m/s`);
  // and from the plain address camera nothing at all has changed
  const plain = film(s), same = film(s, { start: null });
  assert.equal(plain.maxStep, same.maxStep);
});
