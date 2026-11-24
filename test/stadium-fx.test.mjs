// v3:stadium Night-stadium light and the fireworks of a win (public/render/stadium-fx.js):
// what a fire() schedules, what is built from the lamps and cannons, and when each is drawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  StadiumFx, fxTimeline, FX_TIMES, FX_KINDS, FX_COUNTS,
  BEAM_VERTEX, BEAM_FRAGMENT, FLARE_VERTEX, FLARE_FRAGMENT, CONFETTI_VERTEX, CONFETTI_FRAGMENT, PYRO_VERTEX, PYRO_FRAGMENT, FIREWORK_VERTEX, FIREWORK_FRAGMENT,
} from '../public/render/stadium-fx.js';

const lamps = (n) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2;
  return { x: 90 * Math.sin(a), y: 90 * Math.cos(a), z: 36, tx: 20 * Math.sin(a), ty: 20 * Math.cos(a), tz: 1 };
});
const cannons = (n) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2;
  return { x: 60 * Math.sin(a), y: 60 * Math.cos(a), z: 3 };
});
function make(quality = 'high', night = true) {
  const scene = new THREE.Scene();
  const state = { night };
  const fx = new StadiumFx({ scene, V: (x, y, z) => new THREE.Vector3(x, z, -y), quality: () => quality, night: () => state.night });
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 5000);
  return { scene, fx, camera, state };
}

test('timeline: what each kind of fire schedules', () => {
  assert.deepEqual(FX_KINDS, ['confetti', 'pyro', 'fireworks', 'win']);
  assert.deepEqual(fxTimeline('confetti'), [{ what: 'confetti', delay: 0, life: FX_TIMES.confettiLife + FX_TIMES.confettiSpread }]);
  assert.equal(FX_TIMES.confettiLife, 7);
  assert.deepEqual(fxTimeline('pyro'), [{ what: 'pyro', delay: 0, shots: 1, life: 1.2 }]);
  assert.equal(fxTimeline('pyro', 3)[0].shots, 3);
  assert.ok(Math.abs(fxTimeline('pyro', 3)[0].life - (2 * 0.9 + 1.2)) < 1e-9);
  assert.equal(fxTimeline('pyro', 9)[0].shots, 3, 'never more than three');
  assert.deepEqual(fxTimeline('fireworks'), [{ what: 'fireworks', delay: 0, life: 3.5 + 1.6 }]);
  const win = fxTimeline('win');
  assert.deepEqual(win.map((s) => s.what), ['pyro', 'confetti', 'fireworks']);
  assert.equal(win[0].shots, 3);
  assert.ok(win[0].delay === 0 && win[1].delay > 0 && win[2].delay > win[1].delay, 'staggered');
  assert.deepEqual(fxTimeline('boo'), []);
  assert.deepEqual(fxTimeline(), []);
  assert.deepEqual(fxTimeline('pyro', NaN), fxTimeline('pyro', 1));
});

test('lamps: a glare on every lamp and a beam from each, aimed at the pitch; none of it by day', () => {
  const { scene, fx, camera, state } = make();
  assert.equal(scene.children.length, 0, 'nothing in the scene until something is set');
  fx.setLamps(lamps(12));
  let s = fx.stats();
  assert.deepEqual([s.lamps, s.beams, s.flares], [12, 12, 12]);
  assert.equal(scene.children.length, 1);
  assert.equal(fx.beams.visible, false, 'not drawn before the first update');
  fx.update(1, camera);
  assert.ok(fx.beams.visible && fx.flares.visible);
  // each beam leaves its lamp along the unit vector to its aim point, 92 % of the way
  const from = fx.beams.geometry.attributes.aFrom, axis = fx.beams.geometry.attributes.aAxis, shape = fx.beams.geometry.attributes.aShape;
  assert.deepEqual([from.getX(0), from.getY(0), from.getZ(0)], [0, 36, -90]);
  const d = new THREE.Vector3(axis.getX(0), axis.getY(0), axis.getZ(0));
  assert.ok(Math.abs(d.length() - 1) < 1e-6);
  const want = new THREE.Vector3(0, 1, -20).sub(new THREE.Vector3(0, 36, -90));
  assert.ok(d.dot(want.clone().normalize()) > 0.99999);
  assert.ok(Math.abs(axis.getW(0) - want.length() * 0.92) < 1e-3);
  assert.ok(shape.getX(0) > 3 && shape.getX(0) < axis.getW(0) * 0.25, 'a narrow cone');
  assert.equal(shape.getY(0), 1, 'full power');
  assert.equal(fx.flares.geometry.attributes.aShine.getW(3), 1);
  // additive, never written to depth, but tested against it: the stand in front hides a flare
  for (const m of [fx.beams.material, fx.flares.material]) {
    assert.equal(m.blending, THREE.AdditiveBlending);
    assert.ok(m.transparent && !m.depthWrite && m.depthTest);
  }
  assert.ok(fx.uniforms.uBeamGain.value * 2 >= 0.1 && fx.uniforms.uBeamGain.value * 2 <= 0.16, 'the two skins of a cone add 0.10 to 0.16 at most');
  assert.ok(!fx.beams.frustumCulled && !fx.beams.castShadow);
  // the lens follows the camera
  camera.fov = 30;
  fx.update(2, camera);
  assert.ok(Math.abs(fx.uniforms.uFxLens.value - Math.tan(15 * Math.PI / 180)) < 1e-9);
  assert.equal(fx.uniforms.uFxTime.value, 2);
  // by day the lamps are off
  state.night = false;
  fx.update(3, camera);
  assert.ok(!fx.beams.visible && !fx.flares.visible);
  // a new set replaces the old; broken entries are dropped; a dimmer lamp is dimmer
  fx.setLamps([...lamps(3), { x: 1, y: 2 }, null, { x: 0, y: 0, z: 30, tx: 0, ty: 10, tz: 0, power: 0.5 }]);
  s = fx.stats();
  assert.deepEqual([s.lamps, s.beams, s.flares], [4, 4, 4]);
  assert.equal(fx.flares.geometry.attributes.aShine.getW(3), 0.5);
  assert.equal(scene.children[0].children.length, 2);
  fx.setLamps([]);
  assert.deepEqual([fx.stats().beams, fx.stats().flares], [0, 0]);
  fx.dispose();
});

test('lamps: a big ring keeps every glare but thins its beams; low graphics builds no beams', () => {
  const { fx } = make();
  fx.setLamps(lamps(60));
  const s = fx.stats();
  assert.equal(s.flares, 60);
  assert.ok(s.beams <= FX_COUNTS.maxBeams && s.beams >= 15, `${s.beams} beams`);
  assert.ok(fx.beams.geometry.attributes.aShape.getY(0) > 1, 'each of the fewer beams carries more');
  const low = make('low');
  low.fx.setLamps(lamps(12));
  assert.equal(low.fx.beams, null);
  assert.equal(low.fx.stats().beams, 0);
  assert.equal(low.fx.stats().flares, 12);
  low.fx.update(0, low.camera);
  assert.ok(low.fx.flares.visible);
  fx.dispose(); low.fx.dispose();
});

test('cannons: confetti and jets are built, drawn only while a shot is alive', () => {
  const { scene, fx, camera } = make();
  fx.setCannons(cannons(8));
  let s = fx.stats();
  assert.deepEqual([s.cannons, s.confetti, s.jets], [8, FX_COUNTS.confetti, 8]);
  assert.equal(FX_COUNTS.confetti, 2400);
  fx.update(5, camera);
  assert.ok(!fx.confetti.visible && !fx.pyro.visible, 'nothing before the first fire');
  assert.deepEqual(fx.stats().active, { confetti: false, pyro: false, fireworks: false });
  // every paper starts at a cannon, goes up, and toward the middle
  const born = fx.confetti.geometry.attributes.aBorn, vel = fx.confetti.geometry.attributes.aVel, tint = fx.confetti.geometry.attributes.aTint;
  for (let i = 0; i < born.count; i += 37) {
    const c = cannons(8)[i % 8];
    assert.ok(Math.abs(born.getX(i) - c.x) < 1e-4 && Math.abs(born.getZ(i) + c.y) < 1e-4, 'born at its cannon');
    assert.ok(born.getW(i) >= 0 && born.getW(i) <= FX_TIMES.confettiSpread);
    assert.ok(vel.getY(i) >= 14 && vel.getY(i) <= 24, `up at ${vel.getY(i)} m/s`);
    assert.ok(tint.getW(i) > 0 && tint.getW(i) < 1);
  }
  let inward = 0;
  for (let i = 0; i < born.count; i++) inward += -(born.getX(i) * vel.getX(i) + born.getZ(i) * vel.getZ(i)) > 0 ? 1 : 0;
  assert.ok(inward / born.count > 0.95, 'thrown toward the pitch');
  // fire: drawn from that moment for its life, then not
  assert.deepEqual(fx.fire('confetti').map((p) => p.what), ['confetti']);
  assert.equal(fx.stats().queued, 1);
  fx.update(5.01, camera);
  assert.ok(fx.confetti.visible && !fx.pyro.visible);
  assert.equal(fx.uniforms.uConfetti.value.x, 5, 'the shot is timed from the fire, not from the frame that saw it');
  assert.equal(fx.stats().queued, 0);
  fx.update(5 + 7.5, camera);
  assert.ok(fx.confetti.visible);
  fx.update(5 + 7.61, camera);
  assert.ok(!fx.confetti.visible, 'gone when the last paper has landed');
  // pyro: one shot, then a volley of three (a fire is timed from the frame it was called in)
  fx.update(20, camera);
  fx.fire('pyro');
  fx.update(20.1, camera);
  assert.ok(fx.pyro.visible);
  assert.deepEqual([fx.uniforms.uPyro.value.x, fx.uniforms.uPyro.value.y], [20, 1]);
  fx.update(21.3, camera);
  assert.ok(!fx.pyro.visible);
  fx.fire('pyro', { intensity: 3 });
  fx.update(22, camera);
  assert.equal(fx.uniforms.uPyro.value.y, 3);
  fx.update(21.3 + 2.9, camera);
  assert.ok(fx.pyro.visible);
  fx.update(21.3 + 3.1, camera);
  assert.ok(!fx.pyro.visible);
  // a weak shot fires fewer papers
  fx.fire('confetti', { intensity: 0.4 });
  fx.update(40, camera);
  assert.equal(fx.uniforms.uConfetti.value.z, 0.4);
  assert.equal(fx.fire('boo').length, 0);
  assert.equal(fx.stats().queued, 0);
  assert.equal(fx.pyro.material.blending, THREE.AdditiveBlending);
  assert.equal(fx.confetti.material.blending, THREE.NormalBlending, 'paper is paper');
  assert.ok(fx.confetti.material.depthWrite);
  fx.clear();
  assert.equal(scene.children.length, 0);
  // low graphics: a third of the paper
  const low = make('low');
  low.fx.setCannons(cannons(4));
  assert.equal(low.fx.stats().confetti, FX_COUNTS.confettiLow);
  assert.equal(FX_COUNTS.confettiLow, 800);
  low.fx.dispose();
});

test('fireworks: twelve shells of ninety sparks over the sky zone, on demand', () => {
  const { fx, camera } = make();
  fx.fire('fireworks');
  fx.update(0, camera);                       // no sky zone yet: nothing to draw, nothing breaks
  assert.equal(fx.fireworks, null);
  fx.update(6, camera);                       // (that volley's time has passed)
  fx.setSkyZone({ x: 10, y: 90, z: 70, r: 50 });
  assert.equal(fx.stats().sparks, FX_COUNTS.shells * FX_COUNTS.sparks);
  assert.equal(fx.stats().sparks, 1080);
  assert.deepEqual(fx.uniforms.uFwZone.value.toArray(), [10, 70, -90, 50]);
  fx.update(7, camera);
  assert.ok(!fx.fireworks.visible);
  const shell = fx.fireworks.geometry.attributes.aShell, spark = fx.fireworks.geometry.attributes.aSpark;
  assert.equal(shell.getW(0), 0, 'the first shell goes at once');
  const delays = new Set();
  for (let i = 0; i < shell.count; i++) {
    for (const v of [shell.getX(i), shell.getY(i), shell.getZ(i)]) assert.ok(v >= -1 && v <= 1);
    assert.ok(shell.getW(i) >= 0 && shell.getW(i) <= 1);
    delays.add(shell.getW(i));
    const sp = Math.hypot(spark.getX(i), spark.getY(i), spark.getZ(i));
    assert.ok(sp > 0.5 && sp < 1.35, `spark speed ${sp}`);
  }
  assert.equal(delays.size, FX_COUNTS.shells, 'each shell its own moment');
  // a burst is a ball: its sparks leave in every direction
  let sx = 0, sy = 0, sz = 0;
  for (let k = 0; k < FX_COUNTS.sparks; k++) { sx += spark.getX(k); sy += spark.getY(k); sz += spark.getZ(k); }
  assert.ok(Math.hypot(sx, sy, sz) / FX_COUNTS.sparks < 0.1);
  fx.fire('fireworks', { intensity: 0.5 });
  fx.update(7.1, camera);
  assert.ok(fx.fireworks.visible);
  assert.deepEqual([fx.uniforms.uFw.value.x, fx.uniforms.uFw.value.z], [7, 0.5]);
  fx.update(7 + 5.0, camera);
  assert.ok(fx.fireworks.visible);
  fx.update(7 + 5.2, camera);
  assert.ok(!fx.fireworks.visible);
  // a burst somewhere else
  fx.fire('fireworks', { at: { x: 0, y: 0, z: 40 } });
  fx.update(13, camera);
  assert.deepEqual(fx.uniforms.uFwZone.value.toArray().map((v) => v + 0), [0, 40, 0, 50]);
  assert.equal(fx.fireworks.material.blending, THREE.AdditiveBlending);
  fx.dispose();
});

test('a win: jets at once, then paper, then the sky; everything ends; clear empties the scene', () => {
  const { scene, fx, camera } = make();
  fx.setLamps(lamps(6));
  fx.setCannons(cannons(6));
  fx.setSkyZone({ x: 0, y: 90, z: 80, r: 60 });
  assert.equal(scene.children.length, 1);
  assert.deepEqual(scene.children[0].children.map((m) => m.name).sort(), ['stadium-fx:beams', 'stadium-fx:confetti', 'stadium-fx:fireworks', 'stadium-fx:flares', 'stadium-fx:pyro']);
  fx.update(100, camera);
  const plan = fx.fire('win');
  assert.equal(plan.length, 3);
  assert.equal(fx.stats().queued, 3);
  fx.update(100.05, camera);
  assert.deepEqual(fx.stats().active, { confetti: false, pyro: true, fireworks: false });
  assert.equal(fx.uniforms.uPyro.value.y, 3);
  fx.update(100.2, camera);
  assert.deepEqual(fx.stats().active, { confetti: true, pyro: true, fireworks: false });
  fx.update(101, camera);
  assert.deepEqual(fx.stats().active, { confetti: true, pyro: true, fireworks: true });
  assert.equal(fx.stats().queued, 0);
  assert.equal(fx.uniforms.uConfetti.value.x, 100.15);
  assert.equal(fx.uniforms.uFw.value.x, 100.8);
  fx.update(104, camera);
  assert.deepEqual(fx.stats().active, { confetti: true, pyro: false, fireworks: true });
  fx.update(120, camera);
  assert.deepEqual(fx.stats().active, { confetti: false, pyro: false, fireworks: false });
  assert.ok(fx.beams.visible, 'the lights stay on');
  // every material reads the one uniform block
  for (const m of scene.children[0].children) assert.equal(m.material.uniforms, fx.uniforms, m.name);
  // a new course
  fx.fire('win');
  fx.clear();
  assert.equal(scene.children.length, 0);
  assert.deepEqual(fx.stats(), { lamps: 0, beams: 0, flares: 0, cannons: 0, confetti: 0, jets: 0, sparks: 0, queued: 0, active: { confetti: false, pyro: false, fireworks: false } });
  fx.update(121, camera);
  assert.equal(scene.children.length, 0, 'a cleared layer puts nothing back');
});

test('shader source: balanced, every uniform it reads is in the shared block, attributes are provided', () => {
  const { fx } = make();
  fx.setLamps(lamps(4)); fx.setCannons(cannons(4)); fx.setSkyZone({ x: 0, y: 0, z: 50, r: 40 });
  const pairs = { beams: [BEAM_VERTEX, BEAM_FRAGMENT], flares: [FLARE_VERTEX, FLARE_FRAGMENT], confetti: [CONFETTI_VERTEX, CONFETTI_FRAGMENT], pyro: [PYRO_VERTEX, PYRO_FRAGMENT], fireworks: [FIREWORK_VERTEX, FIREWORK_FRAGMENT] };
  for (const [key, [vs, fs]] of Object.entries(pairs)) {
    const mesh = fx[key];
    assert.equal(mesh.material.vertexShader, vs);
    assert.equal(mesh.material.fragmentShader, fs);
    for (const src of [vs, fs]) {
      let depth = 0, paren = 0;
      for (const ch of src) {
        if (ch === '{') depth++; else if (ch === '}') depth--;
        if (ch === '(') paren++; else if (ch === ')') paren--;
        assert.ok(depth >= 0 && paren >= 0, key);
      }
      assert.equal(depth, 0, `${key}: braces`);
      assert.equal(paren, 0, `${key}: parentheses`);
      assert.equal((src.match(/void main\(\)/g) || []).length, 1, key);
      for (const [, name] of src.matchAll(/uniform\s+\w+\s+(\w+);/g)) assert.ok(fx.uniforms[name], `${key}: uniform ${name} is in the block`);
      // every u* name used is declared in this stage
      for (const name of new Set(src.match(/\bu[A-Z]\w+/g))) assert.equal((src.match(new RegExp(`uniform\\s+\\w+\\s+${name};`, 'g')) || []).length, 1, `${key}: ${name} declared once`);
    }
    // varyings: what the vertex stage writes the fragment stage reads, same type
    const vary = (src) => Object.fromEntries([...src.matchAll(/varying\s+(\w+)\s+(\w+);/g)].map((m) => [m[2], m[1]]));
    assert.deepEqual(vary(fs), Object.fromEntries(Object.entries(vary(vs)).filter(([k]) => k in vary(fs))), `${key}: varyings agree`);
    for (const k of Object.keys(vary(fs))) assert.ok(k in vary(vs), `${key}: ${k} is written by the vertex stage`);
    // attributes: every one the shader declares is on the geometry (position and uv are three's own)
    for (const [, type, name] of vs.matchAll(/attribute\s+(\w+)\s+(\w+);/g)) {
      const a = mesh.geometry.attributes[name];
      assert.ok(a, `${key}: attribute ${name}`);
      assert.equal(a.itemSize, type === 'float' ? 1 : Number(type.slice(3)), `${key}: ${name} is a ${type}`);
      assert.ok(a.isInstancedBufferAttribute, `${key}: ${name} is per instance`);
      assert.equal(a.count, mesh.geometry.instanceCount, `${key}: one ${name} a copy`);
      assert.ok(a.array.every(Number.isFinite), `${key}: ${name} is finite`);
    }
    assert.ok(fs.includes('#include <tonemapping_fragment>') && fs.includes('#include <colorspace_fragment>'), `${key}: output as the scene's own materials`);
  }
  if (fx.pyro) assert.ok(fx.pyro.geometry.attributes.uv && fx.pyro.geometry.attributes.uv.count === fx.pyro.geometry.attributes.position.count);
  fx.dispose();
});
