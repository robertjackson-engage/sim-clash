// The menus' backdrop camera (public/arcade/shell-core.js backdropOrbit, flown by shell.js).
//
// Props are scenery: nothing collides with them, and the camera that drifts over the stage
// behind the title and the menus used to fly through the ones that stand where it swings
// (Midnight Mile's skyscrapers, Ice Pick's spires, Thunder Dome's floodlights). The orbit is
// now planned per stage. Checked here: the plan itself on made-up obstacles, and on every
// real stage that the whole flight, as shell.js eases it, stays outside every prop's box.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { BACKDROP, backdropOrbit, backdropCamera } from '../public/arcade/shell-core.js';

const require = createRequire(import.meta.url);
const { stageIds, stageGame } = require('../tools/arcade-dev/playability-core.cjs');
const manifest = require('../public/arcade/props/manifest.json').kinds;
const { PROP_FLOAT_M } = await import('../public/render/props.js');

const ball = { x: 0, y: 0 }, pin = { x: 0, y: 200 };
const flat = () => 0;
const usualDist = 200 * 0.78 + 42;

test('open ground: the usual orbit', () => {
  assert.deepEqual(backdropOrbit({ ball, pin, groundAt: flat, obstacles: [] }), { dist: usualDist, swingDeg: 34, lift: 0, clear: true });
  // a prop the camera never comes near changes nothing: beside the green, or far below the camera
  const cam = backdropCamera({ ball, pin, dist: usualDist, yawOffDeg: 0 });
  assert.ok(cam.up > 60 && cam.y < -40, `the camera is ${cam.up.toFixed(0)} m up, ${(-cam.y).toFixed(0)} m behind the tee`);
  const far = [{ x: 30, y: 200, r: 12, base: 0, top: 60 }, { x: cam.x, y: cam.y, r: 15, base: 0, top: cam.up - 20 }];
  assert.deepEqual(backdropOrbit({ ball, pin, groundAt: flat, obstacles: far }), { dist: usualDist, swingDeg: 34, lift: 0, clear: true });
  // a short hole and a long one: the distance is kept in range
  assert.equal(backdropOrbit({ ball, pin: { x: 0, y: 40 }, groundAt: flat }).dist, BACKDROP.distMin);
  assert.equal(backdropOrbit({ ball, pin: { x: 0, y: 600 }, groundAt: flat }).dist, BACKDROP.distMax);
});

test('a tower at the end of the swing: a narrower swing, the same distance', () => {
  const edge = backdropCamera({ ball, pin, dist: usualDist, yawOffDeg: 30 });
  const tower = [{ x: edge.x, y: edge.y, r: 10, base: 0, top: 150 }];
  const plan = backdropOrbit({ ball, pin, groundAt: flat, obstacles: tower });
  assert.deepEqual([plan.dist, plan.lift, plan.clear], [usualDist, 0, true]);
  assert.ok(plan.swingDeg < 34, `swing ${plan.swingDeg}`);
  // and the planned swing really is clear of it, by the margin
  for (let a = -plan.swingDeg; a <= plan.swingDeg; a += 1) {
    const c = backdropCamera({ ball, pin, dist: plan.dist, yawOffDeg: a });
    assert.ok(Math.hypot(c.x - tower[0].x, c.y - tower[0].y) >= tower[0].r + BACKDROP.propClearM, `at ${a} degrees`);
  }
});

test('a tower dead behind the tee: closer in, or over the top of a low one', () => {
  const mid = backdropCamera({ ball, pin, dist: usualDist, yawOffDeg: 0 });
  const tall = backdropOrbit({ ball, pin, groundAt: flat, obstacles: [{ x: mid.x, y: mid.y, r: 14, base: 0, top: 200 }] });
  assert.equal(tall.clear, true);
  assert.ok(tall.dist < usualDist && tall.lift === 0, `a 200 m tower: dist ${tall.dist.toFixed(0)}, lift ${tall.lift}`);
  // a roof just over the camera's height, on a short hole where the camera cannot come closer: lifted over it
  const short = { x: 0, y: 40 };
  const c0 = backdropCamera({ ball, pin: short, dist: BACKDROP.distMin, yawOffDeg: 0 });
  const ring = [];
  for (let a = 0; a < 360; a += 4) ring.push({ x: c0.tx + 60 * Math.sin(a * Math.PI / 180), y: c0.ty + 60 * Math.cos(a * Math.PI / 180), r: 30, base: 0, top: c0.up + 4 });
  const low = backdropOrbit({ ball, pin: short, groundAt: flat, obstacles: ring });
  assert.equal(low.clear, true);
  assert.ok(low.lift >= 12, `lift ${low.lift}`);
});

test('nothing on the list is clear: the least bad orbit, and it says so', () => {
  const wall = [];
  for (let x = -400; x <= 400; x += 20) for (let y = -400; y <= 300; y += 20) wall.push({ x, y, r: 16, base: -50, top: 400 });
  const plan = backdropOrbit({ ball, pin, groundAt: flat, obstacles: wall });
  assert.equal(plan.clear, false);
  assert.ok(plan.dist > 0 && plan.swingDeg >= 0);
});

// every prop of a built stage as its box on the course (what PropsLayer.obstacles() gives the
// shell, from the same manifest sizes): a circle round the box for the plan, the box itself for the check
function stageProps(g) {
  const out = [];
  for (const p of g.course.props || []) {
    const m = manifest[p.kind];
    if (!m || !p.heightM || p.kind === 'target-ring' || p.kind === 'fireworks') continue;
    const k = p.heightM / m.heightM;
    const base = (p.z != null ? p.z : g.terrain.h(p.x, p.y)) + (PROP_FLOAT_M[p.kind] || 0);
    out.push({ id: p.id, x: p.x, y: p.y, rot: (p.rotDeg || 0) * Math.PI / 180, hw: 0.5 * m.widthM * k, hd: 0.5 * m.depthM * k, r: 0.5 * Math.hypot(m.widthM * k, m.depthM * k), base, top: base + p.heightM });
  }
  return out;
}
const insideBox = (b, x, y, z, margin) => {
  const dx = x - b.x, dy = y - b.y, c = Math.cos(b.rot), s = Math.sin(b.rot);
  return Math.abs(dx * c - dy * s) < b.hw + margin && Math.abs(dx * s + dy * c) < b.hd + margin && z < b.top + margin && z > b.base - margin;
};

test('on every real stage the whole flight stays out of every prop, with room to spare', { timeout: 150000 }, () => {
  const RAD = Math.PI / 180;
  const changed = [];
  for (const id of stageIds()) {
    const g = stageGame(id);
    const h = g.hole, b = { x: h.tee[0], y: h.tee[1] }, p = { x: h.pin[0], y: h.pin[1] };
    const props = stageProps(g);
    const groundAt = (x, y) => g.terrain.h(x, y);
    const plan = backdropOrbit({ ball: b, pin: p, groundAt, obstacles: props });
    assert.equal(plan.clear, true, `${id}: no clear orbit`);
    if (plan.swingDeg !== BACKDROP.swingDeg || plan.lift || plan.dist !== backdropOrbit({ ball: b, pin: p, groundAt }).dist) changed.push(id);
    // fly it as shell.js does: the yaw and the pitch on their two slow sines, the rig lifted clear of the ground with a lag
    const line = Math.atan2(p.x - b.x, p.y - b.y) / RAD;
    let lift = null;
    for (let T = 0; T < 700; T += 0.25) {
      const a = plan.swingDeg * Math.sin(T / 21 + 0.6), pitchDeg = BACKDROP.pitchDeg + BACKDROP.pitchSwingDeg * Math.sin(T / 13);
      const c = backdropCamera({ ball: b, pin: p, dist: plan.dist, yawOffDeg: a, pitchDeg });
      const z0 = groundAt(c.tx, c.ty) + 2 + c.up;
      const need = Math.max(plan.lift, groundAt(c.x, c.y) + BACKDROP.groundClearM - z0, 0);
      lift = lift === null ? need : lift + (need - lift) * Math.min(1, 0.25 * 1.5);
      const hit = props.find((o) => insideBox(o, c.x, c.y, z0 + lift, 4));
      assert.equal(hit, undefined, `${id}: ${T.toFixed(0)} s in, the camera is within 4 m of ${hit && hit.id} (line ${line.toFixed(0)}, yaw ${a.toFixed(1)})`);
    }
  }
  // most stages keep the orbit they were designed and looked at with
  assert.deepEqual(changed.sort(), ['bullseye-bay', 'ice-pick', 'midnight-mile', 'thunder-dome']);   // v3:stadium Bullseye Bay too: its galleries are real bleachers now, a metre and a half deeper
});
