// v2:seeover The see-over address camera (public/render/see-over.js): on synthetic ground,
// the pose it picks sees the target whenever a pose within its caps can, is the plain
// address camera on open ground, moves continuously as the aim sweeps, stays above the
// ground and out of the trees, and says so when the target cannot be seen from behind
// the ball (the view from above then does).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEE_OVER, seeOverPose, aboveView, needHeight, sightClear, crownField, pinToFrame, markerText, inTheWay,
} from '../public/render/see-over.js';
import { ndc } from './helpers/camera-shots.mjs';
import fs from 'node:fs';
import { ballNdcAbove } from '../public/render/see-over.js';
import { aboveLabel, keyAction, coveredBottom } from '../public/arcade/seeover.js';

const D2R = Math.PI / 180;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const BALL = { x: 0, y: 0 };
const along = (azDeg, m, from = BALL) => ({ x: from.x + Math.sin(azDeg * D2R) * m, y: from.y + Math.cos(azDeg * D2R) * m });

// the grounds of the brief
const FLAT = () => 0;
const BROW = (x, y) => 4 * Math.exp(-(((y - 20) / 6) ** 2));                 // a brow 4 m high, 20 m ahead
const HILL = (x, y) => 30 * Math.exp(-(((y - 80) / 25) ** 2));               // a 30 m hill, 80 m ahead
const WALL = (x, y) => 60 * smooth(148, 152, y);                             // a wall 60 m high, 150 m ahead (a mesa)
const ROLLING = (x, y) => {                                                  // a ring of dunes round the ball, on rolling ground
  const r = Math.hypot(x, y);
  return 12 * Math.exp(-(((r - 60) / 15) ** 2)) + 3 * Math.sin(x / 23) * Math.cos(y / 31);
};

// the pose as a camera the helpers can look through
const lens = (p, fovDeg = SEE_OVER.fovDeg) => ({ pos: p.cam, look: p.look, zoom: p.zoom, fovDeg });
const at = (p, pt) => ndc(lens(p), pt, { fovDeg: SEE_OVER.fovDeg });
const onGround = (g, pt, up = 0.5) => ({ x: pt.x, y: pt.y, z: g(pt.x, pt.y) + up });
const inFrame = (n, lim = 0.95) => n.depth > 0 && Math.abs(n.x) < lim && Math.abs(n.y) < lim;

// is there ANY pose within the caps, behind the ball on the aim, that sees ball and target? (no margins: the oracle)
function anyPoseSees(g, azDeg, target) {
  const bz = g(0, 0), T = onGround(g, target), B = { x: 0, y: 0, z: bz + 0.1 };
  for (let d = SEE_OVER.backM; d <= SEE_OVER.maxBackM + 1e-9; d += 1) {
    const c = along(azDeg, -d);
    for (let up = SEE_OVER.upM; up <= SEE_OVER.maxUpM + 1e-9; up += 0.5) {
      const cam = { x: c.x, y: c.y, z: Math.max(bz + up, g(c.x, c.y) + SEE_OVER.clearM) };
      if (cam.z - bz > SEE_OVER.maxUpM) continue;
      if (sightClear(cam, T, g, 0, 0.5) && sightClear(cam, B, g, 0, 0.5)) return true;
    }
  }
  return false;
}

function checkPose(name, g, p, target, { crowns = null } = {}) {
  const bz = g(0, 0);
  assert.ok(p.cam.z >= g(p.cam.x, p.cam.y) + SEE_OVER.clearM - 1e-6, `${name}: ${(p.cam.z - g(p.cam.x, p.cam.y)).toFixed(2)} m off the ground`);
  assert.ok(p.z - bz <= SEE_OVER.maxUpM + 1e-6 || !p.visible, `${name}: ${(p.z - bz).toFixed(1)} m up`);
  assert.ok(p.d <= SEE_OVER.maxBackM + 4 + 1e-6, `${name}: ${p.d.toFixed(1)} m back`);
  if (crowns) assert.equal(crowns.core(p.cam.x, p.cam.y, p.cam.z), -Infinity, `${name}: inside a tree`);
  // the ball: seen, and at the bottom of the frame
  const b = at(p, { x: 0, y: 0, z: bz + 0.1 });
  assert.ok(sightClear(p.cam, { x: 0, y: 0, z: bz + 0.1 }, g, 0, 0.5), `${name}: ground between the camera and the ball`);
  assert.ok(b.depth > 0 && Math.abs(b.x) < 0.05 && b.y < 0 && b.y > -SEE_OVER.ballNdc - 0.02, `${name}: ball at (${b.x.toFixed(2)}, ${b.y.toFixed(2)})`);
  if (p.visible && target) {
    const T = onGround(g, target), t = at(p, T);
    assert.ok(sightClear(p.cam, T, g, 0.2, 0.5), `${name}: ground between the camera and the target`);
    assert.ok(inFrame(t, 0.7) && t.y > b.y, `${name}: target at (${t.x.toFixed(2)}, ${t.y.toFixed(2)}), ball at ${b.y.toFixed(2)}`);
  }
}

// the plain address camera, as scene.js _idleTargets has it
function plain(g, azDeg, pin, dist = SEE_OVER.backM, height = SEE_OVER.upM) {
  const c = along(azDeg, -dist), bz = g(0, 0);
  const z = Math.max(g(c.x, c.y) + SEE_OVER.clearM, bz + height);
  const toBall = Math.atan2(z - bz, dist), toPin = Math.atan2(z - g(pin.x, pin.y), dist + Math.max(Math.hypot(pin.x, pin.y), 1));
  return { cam: { x: c.x, y: c.y, z }, pitch: toPin + 0.285 * (toBall - toPin) };
}

test('on flat ground the address camera is the one it always was', () => {
  for (const azDeg of [0, 37, -90, 180]) {
    for (const pinM of [9, 30, 150, 320]) {
      for (const zoom0 of [1, 1.31]) {
        const pin = along(azDeg, pinM), land = along(azDeg + 2, Math.min(pinM, 210) * 0.92), rest = along(azDeg + 2, Math.min(pinM, 210));
        const p = seeOverPose({ ball: BALL, azDeg, pin, zoom0, groundAt: FLAT, targets: [land, rest, { ...pin, must: false }] });
        const d = plain(FLAT, azDeg, pin);
        const n = `aim ${azDeg}, pin ${pinM} m`;
        assert.equal(p.visible, true, n);
        assert.equal(p.raised, false, n);
        assert.ok(Math.hypot(p.cam.x - d.cam.x, p.cam.y - d.cam.y, p.cam.z - d.cam.z) < 1e-9, `${n}: moved`);
        assert.ok(Math.abs(p.pitch - d.pitch) < 1e-9, `${n}: pitch ${p.pitch} for ${d.pitch}`);
        assert.equal(p.zoom, zoom0, n);
        assert.equal(p.lift, 0, n);
      }
    }
  }
  // and with the wheel and the drag (scene.orbit) it is still theirs
  const pin = along(0, 150);
  const p = seeOverPose({ ball: BALL, azDeg: 0, pin, groundAt: FLAT, targets: [pin], base: { dist: 22, height: 9 } });
  assert.ok(Math.abs(p.d - 22) < 1e-9 && Math.abs(p.z - 9) < 1e-9);
});

test('a brow 4 m high 20 m ahead: it cranes up just enough to see over, where it stands', () => {
  const target = along(0, 150);
  const before = plain(BROW, 0, target);
  assert.equal(sightClear(before.cam, onGround(BROW, target), BROW, 0, 0.5), false, 'the plain camera cannot see the target');
  const p = seeOverPose({ ball: BALL, azDeg: 0, pin: target, groundAt: BROW, targets: [target] });
  assert.equal(p.visible, true);
  assert.equal(anyPoseSees(BROW, 0, target), true);
  checkPose('brow', BROW, p, target);
  assert.ok(p.lift > 1 && p.lift < 6, `lifted ${p.lift.toFixed(2)} m`);
  assert.ok(Math.abs(p.d - SEE_OVER.backM) < 1e-9, 'no need to pull back');
  // the lowest that clears (with its margin): three metres lower does not see it
  assert.equal(sightClear({ ...p.cam, z: p.cam.z - 3 }, onGround(BROW, target), BROW, 0.2, 0.5), false);
});

test('a 30 m hill 80 m ahead: a target on it is seen from where a pose can see it; one behind it is reported hidden', () => {
  // up the hill, to just short of its crown
  const onTop = along(0, 76);
  const p = seeOverPose({ ball: BALL, azDeg: 0, pin: onTop, groundAt: HILL, targets: [onTop] });
  assert.equal(anyPoseSees(HILL, 0, onTop), true);
  assert.equal(p.visible, true);
  checkPose('hill, target on top', HILL, p, onTop);
  // a third of the way up the far side of a dip in front of it: needs the crane AND the pull-back
  const dip = (x, y) => HILL(x, y) + 9 * Math.exp(-(((y - 24) / 7) ** 2));
  const far = along(0, 70);
  const q = seeOverPose({ ball: BALL, azDeg: 0, pin: far, groundAt: dip, targets: [far] });
  assert.equal(q.visible, true);
  checkPose('hill behind a rise', dip, q, far);
  // behind the hill: no pose within the caps sees it, and it says so
  const behind = along(0, 160);
  assert.equal(anyPoseSees(HILL, 0, behind), false);
  const r = seeOverPose({ ball: BALL, azDeg: 0, pin: behind, groundAt: HILL, targets: [behind] });
  assert.equal(r.visible, false);
  checkPose('hill, target behind', HILL, r, null);
  // ...but the view from above does
  const a = aboveView({ ball: BALL, azDeg: 0, far: [behind], groundAt: HILL });
  assert.equal(a.visible, true);
  assert.ok(sightClear(a.cam, onGround(HILL, behind), HILL, 0.2, 0.5));
});

test('when the crane is not enough it pulls back as well, and no further than it must', () => {
  // a ridge 16 m high 45 m ahead, the target 260 m off: from 14 m back the camera would have to
  // look almost straight down at the ball
  const ridge = (x, y) => 16 * Math.exp(-(((y - 45) / 9) ** 2));
  const target = along(0, 260);
  const p = seeOverPose({ ball: BALL, azDeg: 0, pin: target, groundAt: ridge, targets: [target] });
  assert.equal(p.visible, true);
  checkPose('ridge', ridge, p, target);
  assert.ok(p.d > SEE_OVER.backM + 2 && p.d <= SEE_OVER.maxBackM, `${p.d.toFixed(1)} m back`);
  assert.ok(p.z > 15 && p.z <= SEE_OVER.maxUpM, `${p.z.toFixed(1)} m up`);
  assert.equal(p.zoom, 1, 'on the wide lens');
  // two metres nearer the ball, at the height that sees over from there, the ball would be off the frame
  const b = at(p, { x: 0, y: 0, z: 0.1 });
  assert.ok(b.y < -SEE_OVER.ballNdc + 0.03, `the ball is at the bottom of the frame (${b.y.toFixed(2)})`);
});

test('a wall 60 m high 150 m ahead: the target on top is reported not visible, the ball and the top of the wall are framed', () => {
  const target = along(0, 180);
  assert.equal(anyPoseSees(WALL, 0, target), false);
  const p = seeOverPose({ ball: BALL, azDeg: 0, pin: target, groundAt: WALL, targets: [target] });
  assert.equal(p.visible, false);
  checkPose('wall', WALL, p, null);
  assert.ok(p.obstacle && p.obstacle.z > 55 && p.obstacle.y > 146 && p.obstacle.y < 160, `the top of the wall: ${JSON.stringify(p.obstacle)}`);
  const o = at(p, p.obstacle);
  assert.ok(inFrame(o, 0.7), `the top of the wall at (${o.x.toFixed(2)}, ${o.y.toFixed(2)})`);
  // the marker for it: off the top of the frame or on it, never lost; and it says how far and how high
  const T = onGround(WALL, target), m = pinToFrame(at(p, T), 1920, 1080);
  assert.ok(m.x >= 90 && m.x <= 1830 && m.y >= 84 && m.y <= 960);
  assert.equal(markerText('PIN', 130, 50.2), 'PIN 142 YD · +50 M ↑');
  assert.equal(markerText('TARGET', 91.44, -12.4), 'TARGET 100 YD · −12 M ↓');
  // the view from above sees the top of the mesa, the ball and the target both in the frame
  const a = aboveView({ ball: BALL, azDeg: 0, far: [target], groundAt: WALL });
  assert.equal(a.visible, true);
  assert.ok(sightClear(a.cam, T, WALL, 0.2, 0.5) && sightClear(a.cam, { x: 0, y: 0, z: 0.1 }, WALL, 0, 0.5));
  const ab = at(a, { x: 0, y: 0, z: 0.1 }), aT = at(a, T);
  assert.ok(inFrame(ab, 0.9) && ab.y < -0.6, `ball at ${ab.y.toFixed(2)}`);
  assert.ok(inFrame(aT, 0.85) && aT.y > 0.2, `target at ${aT.y.toFixed(2)}`);
  assert.ok(a.cam.z > 62 && a.cam.z - WALL(a.cam.x, a.cam.y) > 10);
});

test('the pose is continuous as the aim sweeps 90 degrees either side', () => {
  let prev = null, raised = 0, back = 0;
  for (let az = -90; az <= 90 + 1e-9; az += 0.25) {
    const target = along(az, 170);
    const p = seeOverPose({ ball: BALL, azDeg: az, pin: target, groundAt: ROLLING, targets: [along(az, 150), target] });
    assert.equal(p.visible, true, `aim ${az}`);
    checkPose(`aim ${az}`, ROLLING, p, target);
    if (p.lift > 0.5) raised++;
    if (p.d > SEE_OVER.backM + 0.5) back++;
    if (prev) {
      const step = Math.hypot(p.cam.x - prev.cam.x, p.cam.y - prev.cam.y, p.cam.z - prev.cam.z);
      assert.ok(step < 0.8, `aim ${az}: the camera steps ${step.toFixed(2)} m for a quarter of a degree`);
      assert.ok(Math.abs(p.pitch - prev.pitch) < 1.2 * D2R, `aim ${az}: the view pitches ${((p.pitch - prev.pitch) / D2R).toFixed(2)} deg`);
      assert.ok(Math.abs(p.zoom - prev.zoom) < 0.05, `aim ${az}: lens`);
    }
    prev = p;
  }
  assert.ok(raised > 300, `the dunes are in the way most of the way round (${raised} of 721)`);
});

test('it stays out of the trees and the buildings, and looks over a wood that is not simply faded', () => {
  // a tree right where the camera would stand, a building just behind it, and a belt of scrub across the line 90 m out
  const stand = [{ x: 0.3, y: -14.2, r: 4.5, top: 14, base: 0 }, { x: -0.5, y: -19, r: 4, top: 9, base: 0, solid: true }];
  const wood = (top) => { const w = []; for (let x = -40; x <= 40; x += 6) for (let y = 86; y <= 104; y += 6) w.push({ x, y, r: 4.5, top, base: 0 }); return w; };
  const crowns = crownField([...stand, ...wood(2.5)]);
  assert.ok(crowns.core(0.3, -14.2, 4.6) > 13, 'the plain camera would be inside the tree');
  const target = along(0, 190);
  const p = seeOverPose({ ball: BALL, azDeg: 0, pin: target, groundAt: FLAT, crowns, targets: [target] });
  assert.equal(p.visible, true);
  assert.equal(p.woodedM, 0);
  checkPose('woods', FLAT, p, target, { crowns });
  // over the scrub (a few metres more height does it): its sight line clears the crowns
  const T = onGround(FLAT, target);
  for (let u = 0.05; u < 1; u += 0.01) {
    const x = p.cam.x + (T.x - p.cam.x) * u, y = p.cam.y + (T.y - p.cam.y) * u, z = p.cam.z + (T.z - p.cam.z) * u;
    assert.ok(z > Math.max(0, crowns.soft(x, y)) || y < SEE_OVER.fadeAheadM + 1, `in the crowns ${Math.hypot(x, y).toFixed(0)} m out`);
  }
  assert.ok(p.z > 8 && p.lift <= SEE_OVER.crownLiftM + 1e-9, `${p.z.toFixed(1)} m up`);
  // a real wood is not looked over from behind the ball (it would take a crane four times as high):
  // the camera stays where the ground lets it, and reports how much of the line is under trees
  // (the scene then flies up to the view from above)
  const tall = crownField([...stand, ...wood(18)]);
  const w = seeOverPose({ ball: BALL, azDeg: 0, pin: target, groundAt: FLAT, crowns: tall, targets: [target] });
  assert.equal(w.visible, true);
  assert.ok(w.woodedM > 25, `${w.woodedM.toFixed(0)} m of the line under trees`);
  assert.ok(w.z < 8, 'not craned up for nothing');
  assert.equal(tall.core(w.cam.x, w.cam.y, w.cam.z), -Infinity);
  // one tree on the line is not a wood
  const one = seeOverPose({ ball: BALL, azDeg: 0, pin: target, groundAt: FLAT, crowns: crownField([{ x: 0, y: 100, r: 4.5, top: 30, base: 0 }]), targets: [target] });
  assert.ok(one.woodedM > 5 && one.woodedM < 25, `${one.woodedM.toFixed(0)} m`);
  // a tree 12 m past the ball is not looked over at all: it is faded out of the way
  const near = crownField([{ x: 0, y: 12, r: 4.5, top: 15, base: 0 }]);
  const q = seeOverPose({ ball: BALL, azDeg: 0, pin: target, groundAt: FLAT, crowns: near, targets: [target] });
  assert.equal(q.raised, false);
  // ...and sweeping the aim through the trees never puts the camera in one
  for (let az = -90; az <= 90; az += 1) {
    const t = along(az, 190);
    const s = seeOverPose({ ball: BALL, azDeg: az, pin: t, groundAt: FLAT, crowns, targets: [t] });
    assert.equal(crowns.core(s.cam.x, s.cam.y, s.cam.z), -Infinity, `aim ${az}: inside a tree`);
    assert.ok(s.cam.z >= SEE_OVER.clearM);
  }
});

test('the pin is given up before the aim target is; a ball under a lip is seen over it', () => {
  // laying up short of the wall: the lay-up spot can be seen, the pin on top cannot
  const layup = along(0, 110), pin = along(0, 185);
  const p = seeOverPose({ ball: BALL, azDeg: 0, pin, groundAt: WALL, targets: [layup, { ...pin, must: false }] });
  assert.equal(p.visible, true);
  assert.equal(p.sees.pin, false);
  checkPose('lay-up under the wall', WALL, p, layup);
  // a bunker under a 2.5 m lip, the pin 22 m away: the plain camera sees neither the pin's foot nor over the lip
  const lip = (x, y) => (y > -30 && y < 2.5 ? -1.2 : 0) + 2.5 * Math.exp(-(((y - 4.5) / 1.6) ** 2));
  const cup = along(0, 22);
  const q = seeOverPose({ ball: BALL, azDeg: 0, pin: cup, groundAt: lip, targets: [cup] });
  assert.equal(q.visible, true);
  checkPose('bunker lip', lip, q, cup);
});

test('needHeight is the least height that sees; things in the way of the ball are picked for fading', () => {
  const T = { x: 0, y: 150, z: 0.5 };
  const n = needHeight(0, -14, T, BROW);
  assert.ok(n.at.y > 14 && n.at.y < 26, 'the brow is what asks for it');
  assert.equal(sightClear({ x: 0, y: -14, z: n.z + 0.01 }, T, BROW, 0.3, 0.5), true);
  assert.equal(sightClear({ x: 0, y: -14, z: n.z - 2.5 }, T, BROW, 0, 0.5), false);
  // the line of the shot: camera 14 m behind the ball and 4.6 m up, level ground
  const line = { d: 14, camZ: 4.6, ballZ: 0, endZ: 0 };
  assert.equal(inTheWay(7, 0.5, 0.4, 12, line), true, 'a trunk between the camera and the ball');
  assert.equal(inTheWay(30, 2, 3, 9, line), true, 'a statue 16 m past the ball, on the line');
  assert.equal(inTheWay(30, 14, 3, 9, line), false, 'the same, well off the line');
  assert.equal(inTheWay(60, 0, 3, 9, line), true, 'and 46 m past it');
  assert.equal(inTheWay(14 + SEE_OVER.fadeAheadM + 12, 0, 3, 9, line), false, 'past the faded stretch: left standing');
  assert.equal(inTheWay(20, 0, 1, 0.8, line), false, 'a low rock under the sight line');
  assert.equal(inTheWay(-8, 0, 3, 9, line), false, 'behind the camera');
});

// ---- the ball above the HUD's dock ----
test('the ball is framed above the dock at the bottom of the screen: level, uphill and downhill, standing and from above', () => {
  // the dock covers the bottom 17 % of the frame's height at its middle: the ball's lowest place in the frame
  const lim = ballNdcAbove(0.17);
  assert.ok(Math.abs(lim - (1 - 2 * (0.17 + 0.035))) < 1e-9 && lim < SEE_OVER.ballNdc);
  assert.equal(ballNdcAbove(0), SEE_OVER.ballNdc, 'no dock: the frame is the limit');
  const onScreen = (n) => (1 - n.y) / 2;   // share of the frame's height, from the top
  const slopes = {
    level: () => 0,
    'uphill 12 %': (x, y) => 0.12 * y,
    'steep uphill 30 %': (x, y) => 0.3 * Math.max(0, y),
    'downhill 15 %': (x, y) => -0.15 * y,
    'off a 40 m cliff': (x, y) => -40 * smooth(20, 40, y),
    'a green 25 m above, 70 m away': (x, y) => 25 * smooth(30, 60, y),
  };
  for (const [name, g] of Object.entries(slopes)) {
    for (const pinM of [25, 70, 160, 280]) {
      for (const zoom0 of [1, 1.31]) {
        const pin = along(0, pinM), target = along(0, Math.min(pinM, 200));
        const n = `${name}, pin ${pinM} m`;
        const p = seeOverPose({ ball: BALL, azDeg: 0, pin, zoom0, groundAt: g, targets: [target, { ...pin, must: false }], ballNdc: lim });
        const b = at(p, { x: 0, y: 0, z: g(0, 0) + 0.1 });
        assert.ok(b.depth > 0 && b.y >= -lim - 1e-6, `${n}: the ball is ${(100 * onScreen(b)).toFixed(0)} % down the frame, the dock starts at 83 %`);
        assert.ok(onScreen(b) < 0.83 - 0.03, `${n}: ${(100 * onScreen(b)).toFixed(0)} % down`);
        assert.ok(b.y < 0.2, `${n}: the ball is still in the lower part of the frame (${b.y.toFixed(2)})`);
        if (p.visible) {
          const t = at(p, onGround(g, target));
          assert.ok(inFrame(t, 0.75), `${n}: target at (${t.x.toFixed(2)}, ${t.y.toFixed(2)})`);
        }
        const a = aboveView({ ball: BALL, azDeg: 0, far: [target, pin], groundAt: g, ballNdc: lim });
        const ab = at(a, { x: 0, y: 0, z: g(0, 0) + 0.1 });
        assert.ok(ab.depth > 0 && ab.y >= -lim - 1e-6 && ab.y < 0, `${n}: from above the ball is ${(100 * onScreen(ab)).toFixed(0)} % down the frame`);
      }
    }
  }
  // without the limit, the plain framing of a steep uphill lie has the ball lower than the dock's top
  const g = slopes['steep uphill 30 %'], pin = along(0, 160);
  const free = seeOverPose({ ball: BALL, azDeg: 0, pin, zoom0: 1.31, groundAt: g, targets: [pin] });
  assert.ok(onScreen(at(free, { x: 0, y: 0, z: 0.1 })) > 0.83, 'the case the limit is for');
});

test('how much of the bottom of the picture the HUD covers is measured where the ball is drawn', () => {
  const frame = { left: 0, top: 0, width: 1280, height: 720 };
  const canvas = { id: 'canvas' }, dock = { id: 'dock' }, bar = { id: 'bar' };
  // a bottom bar 61 px high across the screen, the dock above it in the middle from y = 575
  const hit = (x, y) => (y >= 659 ? bar : y >= 575 && y < 650 && Math.abs(x - 640) < 180 ? dock : canvas);
  const f = coveredBottom(hit, frame, (e) => e === canvas);
  assert.ok(Math.abs(f - (720 - 575) / 720) < 0.012, `${f}`);
  assert.equal(coveredBottom(() => canvas, frame, (e) => e === canvas), 0);
  // an open tray over half the screen is not a dock: the caller keeps what it had
  assert.equal(coveredBottom((x, y) => (y > 330 ? dock : canvas), frame, (e) => e === canvas), null);
  // a dock off to one side does not cover the ball
  assert.equal(coveredBottom((x, y) => (y > 560 && x < 300 ? dock : canvas), frame, (e) => e === canvas), 0);
});

test('VIEW FROM ABOVE: one button, one key; a tap toggles, a hold is a peek', () => {
  assert.deepEqual(aboveLabel({}), { main: 'VIEW FROM ABOVE', sub: '', icon: 'up' });
  assert.equal(aboveLabel({ hidden: true }).sub, 'THE TARGET IS HIDDEN FROM HERE');
  assert.deepEqual(aboveLabel({ above: true }), { main: 'BACK TO THE BALL', sub: '', icon: 'down' });
  assert.match(aboveLabel({ above: true, auto: true }).sub, /HIDDEN/);
  const st = { down: false, at: 0 };
  assert.equal(keyAction({ type: 'keydown', timeStamp: 1000 }, st), 'toggle');
  assert.equal(keyAction({ type: 'keydown', timeStamp: 1030, repeat: true }, st), null, 'auto-repeat');
  assert.equal(keyAction({ type: 'keyup', timeStamp: 1120 }, st), null, 'a tap stays where it went');
  assert.equal(keyAction({ type: 'keydown', timeStamp: 2000 }, st), 'toggle');
  assert.equal(keyAction({ type: 'keyup', timeStamp: 2900 }, st), 'release', 'a hold comes back on release');
  assert.equal(keyAction({ type: 'keyup', timeStamp: 3000 }, st), null);
});

test('the scene is wired for it: one pass-through, the x-ray line, the rig off unless the arcade turns it on', () => {
  const read = (f) => fs.readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
  const scene = read('render/scene.js'), props = read('render/props.js'), trees = read('render/trees.js');
  const lineup = read('render/lineup-fx.js'), rig = read('render/see-over-rig.js'), app = read('app.js'), cam = read('render/flight-camera.js');
  // the address camera: the plain one first, then the rig's (which returns at once when off)
  assert.match(scene, /this\._addressZoom = 1 \+ 0\.31 \* THREE\.MathUtils\.smoothstep\(pinD, 60, 160\);\r?\n    this\.seeOver\.idleTargets\(snap\);/);
  assert.match(rig, /idleTargets\(snap = false\) \{\r?\n    const sc = this\.scene;\r?\n    if \(!this\.on \|\| /);
  assert.match(rig, /this\.on = false;/);
  assert.match(app, /if \(arcadeOn && query\.get\('seeover'\) !== '0'\) \{\r?\n  mountSeeOver\(/);
  // one mechanism takes things out of the way, and it fades them: no prop is popped out of the picture
  assert.doesNotMatch(scene + props, /setViewer\(/);
  assert.match(scene, /this\.props\.setSeeThrough\(this\.seeOver\.passLine\(\), \{ x: cp\.x, y: -cp\.z, z: cp\.y \}, this\.anim \|\| !this\.ballSim \? null : this\.ballSim\)/);
  assert.match(props, /g\.opacity = SEE_OVER\.fadeOpacity;/);
  assert.match(props, /g\.renderOrder = depthOnly \? 19 : 20;/);
  assert.ok(SEE_OVER.fadeOpacity > 0.08 && SEE_OVER.fadeOpacity < 0.3, 'a ghost: seen through, still there');
  // the trees on the line of the shot, their ghosts drawn after the aim line
  assert.match(trees, /setFadeLine\(line\) \{/);
  assert.match(trees, /for \(const im of this\._ghosts \|\| \[\]\) im\.renderOrder = line \? 20 : 0;/);
  assert.match(trees, /if \(lod === 0 && fl\) \{/);
  // the line and the target's ring are drawn through what hides them, and the beacons stand on top
  assert.ok((lineup.match(/depthTest: false \}\)\);   \/\/ v2:seeover/g) || []).length >= 3);
  assert.match(lineup, /setBeacons\(list = \[\]\) \{/);
  assert.match(lineup, /if \(this\.xray\) this\.pred\.add/);
  // the shot takes the camera from wherever it is, with the speed it has
  assert.match(scene, /const seeOverVel = this\.seeOver\.camVel\(\); this\.seeOver\.onShot\(\);/);
  assert.match(scene, /startVel: seeOverVel,/);
  assert.match(cam, /startVel: startVel \? \{ \.\.\.startVel \} : null,/);
  // nothing of ours moves the camera between a shot and the next lie being lined up (the match's result hold)
  assert.match(rig, /onShot\(\) \{ this\.live = false;/);
  assert.match(rig, /if \(pred\) this\.live = true;/);
  // and it never flies up on a guess
  assert.match(rig, /const sure = !!sc\._lineupPred;/);
});
