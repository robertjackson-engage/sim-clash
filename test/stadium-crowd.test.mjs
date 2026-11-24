// v3:stadium The crowd (public/render/crowd.js): the reaction state machine, who sits where,
// the levels of detail, the figures, and the layer itself against a bare THREE.Scene.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  CrowdMood, CrowdLayer, planCrowd, pickLod, buildFigure, buildSeat, crowdPalette, crowdLodScale, crowdNearM, linearRgb,
  makeCrowdMaterial, makeSeatMaterial, FIGURE_VARIANTS, FIGURE_PARTS, FIGURE_MATS, FIG, CROWD_LOD, CROWD_ENVELOPES, CROWD_WAVE_LAP_S,
  CROWD_IDLE_ENERGY, CROWD_REACTIONS, CROWD_VERTEX_PARS, CROWD_VERTEX_MAIN, CROWD_FRAGMENT_PARS, CROWD_FRAGMENT_DITHER,
} from '../public/render/crowd.js';
import { standSeats, STANDS, FAN_SCALE } from '../public/render/stadium-kit.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// a ring of n straight bowl sections facing the middle
function ring(n = 20, r = 80, extra = {}) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    // at bearing a from the middle; its front (rotDeg + 180) looks back at the middle
    return { id: `s${i}`, kind: 'stand-section', x: r * Math.sin(a), y: r * Math.cos(a), z: 1, rotDeg: (a * 180) / Math.PI, ...extra };
  });
}

// ---------------------------------------------------------------- CrowdMood
test('mood: an unknown reaction is ignored', () => {
  const m = new CrowdMood();
  assert.equal(m.react('boo', {}, 0), false);
  assert.equal(m.react(undefined, {}, 0), false);
  const s = m.step(1);
  assert.deepEqual([s.cheer, s.groan, s.tense, s.flash, s.waveAmp], [0, 0, 0, 0, 0]);
  assert.equal(s.energy, CROWD_IDLE_ENERGY);
  assert.equal(m.active(1), false);
  for (const k of CROWD_REACTIONS) assert.equal(new CrowdMood().react(k, {}, 0), true, k);
});

test('mood: a cheer attacks in 0.25 s, holds about 4 s, lets go over 2.5 s', () => {
  const m = new CrowdMood(), e = CROWD_ENVELOPES.cheer;
  assert.deepEqual([e.attack, e.hold, e.release], [0.25, 4, 2.5]);
  m.react('cheer', {}, 10);
  assert.equal(m.step(10).cheer, 0);
  assert.ok(near(m.step(10.125).cheer, 0.5));
  assert.equal(m.step(10.25).cheer, 1);
  assert.equal(m.step(14.2).cheer, 1);
  assert.ok(near(m.step(14.25 + 1.25).cheer, 0.5));
  assert.equal(m.step(16.8).cheer, 0);
  assert.equal(m.active(10.3), true);
  assert.equal(m.active(40), false);
  // a small one is lower and shorter; a big one holds longer, never past 1
  const small = new CrowdMood(); small.react('cheer', { intensity: 0.5 }, 0);
  assert.ok(near(small.step(1).cheer, 0.5));
  assert.ok(small.step(0.25 + 2 + 0.01).cheer < 0.5);
  const big = new CrowdMood(); big.react('cheer', { intensity: 2 }, 0);
  assert.equal(big.step(8).cheer, 1);
  assert.equal(big.step(8.25 + 2.5).cheer, 0);
});

test('mood: a groan is 0.2 / 2.5 / 2', () => {
  const m = new CrowdMood();
  m.react('groan', {}, 0);
  assert.ok(near(m.step(0.1).groan, 0.5));
  assert.equal(m.step(2.7).groan, 1);
  assert.ok(near(m.step(2.7 + 1).groan, 0.5));
  assert.equal(m.step(4.71).groan, 0);
  assert.equal(m.step(1).cheer, 0);
});

test('mood: tense holds until something happens, a cheer or a groan ends it at once, calm lets it go', () => {
  const m = new CrowdMood();
  m.react('tense', {}, 0);
  assert.ok(near(m.step(0.3).tense, 0.5));
  assert.equal(m.step(6).tense, 1);
  assert.ok(m.step(6).energy < CROWD_IDLE_ENERGY, 'a tense crowd is still');
  m.react('cheer', {}, 6);
  assert.ok(m.step(6.1).tense < 1 && m.step(6.1).tense > 0, 'no pop');
  assert.equal(m.step(6.3).tense, 0);
  assert.equal(m.step(6.3).cheer, 1);
  // the same for a groan, which also ends the cheer
  m.react('tense', {}, 20);
  m.react('groan', {}, 21);
  assert.equal(m.step(21.3).tense, 0);
  m.react('cheer', {}, 30);
  m.react('groan', {}, 31);
  assert.equal(m.step(31.3).cheer, 0);
  assert.equal(m.step(31.3).groan, 1);
  // left alone it lets go after 12 s
  const alone = new CrowdMood();
  alone.react('tense', {}, 0);
  assert.equal(alone.step(12.5).tense, 1);
  assert.equal(alone.step(0.6 + 12 + 1.5).tense, 0);
  // calm
  const c = new CrowdMood();
  c.react('tense', {}, 0); c.react('calm', {}, 3);
  assert.ok(c.step(3.4).tense > 0 && c.step(3.4).tense < 1);
  assert.equal(c.step(3.81).tense, 0);
});

test('mood: the same reaction again picks up from where it stands', () => {
  const m = new CrowdMood();
  m.react('cheer', {}, 0);
  const before = m.step(5.5).cheer;                  // half way down its release
  assert.ok(near(before, 0.5));
  m.react('cheer', {}, 5.5);
  assert.ok(near(m.step(5.5).cheer, before), 'no jump at the moment it restarts');
  assert.ok(m.step(5.6).cheer > before);
  assert.equal(m.step(5.75).cheer, 1);
  assert.equal(m.step(9.7).cheer, 1);
});

test('mood: a wave laps the ring in about 5 s; intensity 2 is two laps', () => {
  assert.equal(CROWD_WAVE_LAP_S, 5);
  const m = new CrowdMood();
  m.react('wave', { startAngle: 1 }, 0);
  const a0 = m.step(0.5), ang0 = a0.waveAngle;
  assert.equal(a0.waveAmp, 1);
  const ang1 = m.step(1.75).waveAngle;
  assert.ok(near(((ang1 - ang0) + 4 * Math.PI) % (2 * Math.PI), Math.PI / 2, 1e-9), 'a quarter of the ring in a quarter of the lap');
  assert.ok(m.step(4.9).waveAmp > 0 && m.step(4.9).waveAmp < 1, 'it dies away at the end');
  assert.equal(m.step(5.01).waveAmp, 0);
  const two = new CrowdMood();
  two.react('wave', { intensity: 2 }, 0);
  assert.equal(two.step(7).waveAmp, 1);
  assert.equal(two.step(10.01).waveAmp, 0);
  assert.equal(two.step(7).cheer, 0, 'a wave is not a cheer');
});

test('mood: flashes for 1.5 s, and as a cheer peaks; energy is lifted after a cheer', () => {
  const m = new CrowdMood();
  m.react('flash', {}, 0);
  assert.equal(m.step(0.3).flash, 1);
  assert.ok(m.step(1.2).flash > 0);
  assert.equal(m.step(1.51).flash, 0);
  const c = new CrowdMood();
  c.react('cheer', {}, 0);
  assert.ok(c.step(0.5).flash > 0.5);
  assert.equal(c.step(2).flash, 0);
  assert.ok(c.step(1).energy > 0.8);
  assert.ok(c.step(8).energy > CROWD_IDLE_ENERGY, 'still lively after the cheer');
  assert.ok(near(c.step(20).energy, CROWD_IDLE_ENERGY));
});

test('mood: where it happened', () => {
  const m = new CrowdMood();
  m.react('cheer', { at: { x: 10, y: 20 } }, 0);
  let s = m.step(1);
  assert.equal(s.atOn, true);
  assert.deepEqual([s.at[0], s.at[1], s.atRadius], [10, 20, 90]);
  m.react('groan', { at: { x: -5, y: 7 }, radiusM: 40 }, 2);
  s = m.step(2.5);
  assert.deepEqual([s.at[0], s.at[1], s.atRadius, s.atOn], [-5, 7, 40, true]);
  m.react('cheer', {}, 3);                      // everyone
  assert.equal(m.step(3.5).atOn, false);
  m.react('cheer', { at: { x: NaN, y: 1 } }, 4);
  assert.equal(m.step(4.5).atOn, false);
});

// ---------------------------------------------------------------- levels of detail
test('lod: bands, the overlap between them, the lens and the quality setting', () => {
  assert.deepEqual([CROWD_LOD.nearM, CROWD_LOD.midM, CROWD_LOD.bandM], [38, 120, 6]);
  assert.deepEqual(pickLod(10, 0), { near: true, mid: false, far: false, seats: true });
  assert.deepEqual(pickLod(38, 0), { near: true, mid: true, far: false, seats: true }, 'both in the band');
  assert.deepEqual(pickLod(60, 0), { near: false, mid: true, far: false, seats: true });
  assert.equal(pickLod(70, 0).seats, false, 'seats are only drawn close');
  assert.deepEqual(pickLod(120, 0), { near: false, mid: true, far: true, seats: false });
  assert.deepEqual(pickLod(200, 0), { near: false, mid: false, far: true, seats: false });
  // a chunk is as wide as it is: one that reaches into a band shows that level too
  assert.equal(pickLod(55, 20).near, true);
  assert.equal(pickLod(55, 20).mid, true);
  assert.equal(pickLod(110, 20).far, true);
  assert.equal(pickLod(70, 20).near, false);
  // a long lens sees detail further off
  assert.ok(near(crowdLodScale(58), 1, 1e-12));
  assert.ok(crowdLodScale(30) < 0.5);
  assert.equal(pickLod(70, 0, crowdLodScale(30)).near, true);
  assert.equal(pickLod(200, 0, crowdLodScale(30)).mid, true);
  // low: no near figures, mid from the camera out; ultra: near to 55 m
  assert.deepEqual(pickLod(5, 0, 1, 'low'), { near: false, mid: true, far: false, seats: false });
  assert.equal(pickLod(200, 0, 1, 'low').far, true);
  assert.equal(pickLod(50, 0, 1, 'ultra').near, true);
  assert.equal(pickLod(50, 0, 1, 'high').near, false);
  assert.ok(crowdNearM('low') < -1000);
  assert.equal(crowdNearM('ultra'), 55);
});

// ---------------------------------------------------------------- who sits where
test('plan: a ring of 20 sections is filled as asked, the same every time', () => {
  const stands = ring(20);
  const seatsEach = standSeats(stands[0]).count;
  assert.ok(seatsEach > 1200 && seatsEach < 2600, `${seatsEach} seats a section`);
  const t0 = performance.now();
  const plan = planCrowd(stands, { centre: { x: 0, y: 0 } });
  const ms = performance.now() - t0;
  console.log(`  planCrowd: ${plan.people} people, ${plan.seats} seats, ${plan.chunks.length} chunks in ${ms.toFixed(1)} ms`);
  assert.equal(plan.chunks.length, 40, 'a chunk a tier');
  assert.equal(plan.seats, 20 * seatsEach);
  assert.ok(Math.abs(plan.people / plan.seats - 0.9) < 0.02, `fill ${(plan.people / plan.seats).toFixed(3)}`);
  assert.equal(plan.people, plan.chunks.reduce((n, c) => n + c.count, 0));
  assert.ok(ms < 1500, `${ms.toFixed(0)} ms`);
  const again = planCrowd(ring(20), { centre: { x: 0, y: 0 } });
  assert.equal(again.people, plan.people);
  for (const k of ['inst', 'ca', 'cb', 'cc', 'cd', 'variant', 'seatCol']) assert.deepEqual(again.chunks[7][k], plan.chunks[7][k], k);
  // half full
  const half = planCrowd(ring(20, 80, { fill: 0.5 }), { centre: { x: 0, y: 0 } });
  assert.ok(Math.abs(half.people / half.seats - 0.5) < 0.02);
  // each chunk's numbers are in range
  for (const c of plan.chunks) {
    assert.equal(c.inst.length, c.count * 6);
    assert.equal(c.seatPos.length, c.seatCount * 4);
    assert.ok(c.bounds.r > 5 && c.bounds.r < 40, `radius ${c.bounds.r}`);
    for (let i = 0; i < c.count; i++) {
      assert.ok(Math.abs(c.cb[i * 4 + 3]) <= Math.PI, 'the angle round the centre');
      assert.ok(c.inst[i * 6 + 5] > 0.6 * FAN_SCALE * 0.99 && c.inst[i * 6 + 5] < 1.1 * FAN_SCALE, 'height');
      assert.ok(c.cc[i * 4] >= 0 && c.cc[i * 4] < 48 && Number.isInteger(c.cc[i * 4]), 'skin and hair');
      assert.ok(c.variant[i] < FIGURE_VARIANTS.length);
      assert.equal(c.cc[i * 4 + 1], 0, 'seated');
    }
  }
  // every variant turns up, flags are few
  const counts = new Array(FIGURE_VARIANTS.length).fill(0);
  for (const c of plan.chunks) for (const v of c.variant) counts[v]++;
  assert.ok(counts.every((n) => n > 0), counts.join(','));
  assert.ok(counts[FIGURE_VARIANTS.indexOf('flag')] / plan.people < 0.08);
  assert.ok(counts[0] / plan.people > 0.25, 'most are plain');
});

test('plan: low graphics halves the crowd and has no seats', () => {
  const high = planCrowd(ring(20), { centre: { x: 0, y: 0 } });
  const low = planCrowd(ring(20), { centre: { x: 0, y: 0 }, quality: 'low' });
  assert.ok(Math.abs(low.people / high.people - 0.5) < 0.03, `${low.people} of ${high.people}`);
  assert.equal(low.seats, 0);
  assert.equal(low.chunks.length, high.chunks.length);
});

test('plan: the lettering is in the seats and in the shirts of the people in them', () => {
  const stands = ring(4, 80, { text: 'AB', team: ['#0000ff', '#ff0000'], fill: 1 });
  const plan = planCrowd(stands, { centre: { x: 0, y: 0 } });
  let lit = 0, litRed = 0, rest = 0, restBlue = 0, redSeats = 0, seats = 0;
  for (const c of plan.chunks) {
    for (let i = 0; i < c.count; i++) {
      const r = c.ca[i * 4], g = c.ca[i * 4 + 1], b = c.ca[i * 4 + 2];
      if (c.letter[i]) { lit++; if (g === 0 && b === 0 && r > 0) litRed++; } else { rest++; if (r === 0 && g === 0 && b > 0) restBlue++; }
    }
    for (let i = 0; i < c.seatCount; i++) { seats++; if (c.seatCol[i * 3] > 0 && c.seatCol[i * 3 + 2] === 0) redSeats++; }
    if (c.tier === 0) assert.equal(c.letter.reduce((a, b) => a + b, 0), 0, 'the lettering is on the upper tier');
  }
  assert.ok(lit > 200, `${lit} people in letters`);
  assert.ok(litRed / lit > 0.88 && litRed / lit < 0.97, `${(litRed / lit).toFixed(2)} of them wear the second colour`);
  assert.ok(restBlue / rest > 0.4 && restBlue / rest < 0.85, `${(restBlue / rest).toFixed(2)} of the rest wear the first (most of them round a letter, so it reads)`);
  assert.ok(redSeats > 200 && redSeats < seats / 2, 'the seats spell it too');
  assert.equal(redSeats, lit, 'a full house: a person in every lettering seat');
  // no text, no letters
  const plain = planCrowd(ring(2), {});
  assert.ok(plain.chunks.every((c) => c.letter.every((v) => v === 0)));
});

test('plan: a gallery stands, has no seats, and a stage with no stands has no crowd', () => {
  const plan = planCrowd([{ id: 'g', kind: 'crowd', x: 5, y: 9, z: 2, rotDeg: 30 }, { kind: 'pagoda', x: 0, y: 0 }, null]);
  assert.equal(plan.chunks.length, 1);
  const c = plan.chunks[0];
  assert.equal(c.standing, true);
  assert.equal(c.seatCount, 0);
  assert.ok(c.count > 60 && c.count < 130, `${c.count} people`);
  for (let i = 0; i < c.count; i++) assert.equal(c.cc[i * 4 + 1], 1);
  assert.deepEqual(plan.centre, { x: 5, y: 9 }, 'the centroid when no centre is given');
  assert.equal(planCrowd([]).people, 0);
  assert.equal(planCrowd(null).chunks.length, 0);
});

test('palette: every theme has shirts, skins, hair and two team colours as linear rgb', () => {
  for (const theme of [null, 'stadium', 'neon', 'alpine', 'tropical', 'nonsense']) {
    const p = crowdPalette(theme);
    assert.ok(p.shirts.length >= 8 && p.skin.length === 5 && p.hair.length === 6 && p.trousers.length >= 4 && p.team.length === 2, String(theme));
  }
  assert.deepEqual(linearRgb('#ffffff'), [1, 1, 1]);
  assert.deepEqual(linearRgb(0x000000), [0, 0, 0]);
  assert.ok(near(linearRgb('#808080')[0], 0.2158605, 1e-6));
  assert.ok(crowdPalette('alpine').coats > crowdPalette('stadium').coats, 'coats in the snow');
});

// ---------------------------------------------------------------- the figures
test('figures: every variant and level builds, on one skeleton, within its triangle budget', () => {
  const tris = {};
  for (const v of FIGURE_VARIANTS) {
    const g = buildFigure(v, 'near');
    const n = g.attributes.position.count / 3;
    tris[v] = n;
    assert.equal(g.userData.triangles, n);
    assert.ok(n >= 100 && n <= 175, `${v}: ${n} triangles`);
    const b = g.boundingBox;
    for (const c of [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z]) assert.ok(Number.isFinite(c), v);
    assert.ok(b.max.y > 1.7 && b.max.y < 1.85, `${v}: top at ${b.max.y}`);
    assert.ok(Math.abs(b.min.x + b.max.x) < 1.2, v);
    const pm = g.attributes.aPM;
    assert.equal(pm.count, g.attributes.position.count, 'a part and a material on every vertex');
    assert.equal(pm.itemSize, 3);
    const parts = new Set(), mats = new Set();
    for (let i = 0; i < pm.count; i++) {
      parts.add(pm.getX(i)); mats.add(pm.getY(i));
      assert.ok(pm.getZ(i) >= 0 && pm.getZ(i) <= 1, 'sway weight');
    }
    assert.deepEqual([...parts].sort(), [0, 1, 2, 3, 4, 5], `${v}: every part`);
    for (const m of mats) assert.ok(Number.isInteger(m) && m >= 0 && m <= 6, `${v}: material ${m}`);
    for (const m of [FIGURE_MATS.shirt, FIGURE_MATS.skin, FIGURE_MATS.trousers]) assert.ok(mats.has(m), `${v}: material ${m}`);
    // limbs hang from the skeleton's joints: every forearm vertex is below the elbow or held (a flag pole runs on down)
    for (let i = 0; i < pm.count; i++) {
      const y = g.attributes.position.getY(i), x = g.attributes.position.getX(i);
      if (pm.getX(i) === FIGURE_PARTS.thigh) assert.ok(y <= FIG.hipY + 0.03 && y >= FIG.kneeY - 0.01, `${v}: thigh at ${y}`);
      if (pm.getX(i) === FIGURE_PARTS.shin) assert.ok(y <= FIG.kneeY + 0.01 && y >= -0.01, `${v}: shin at ${y}`);
      if (pm.getX(i) === FIGURE_PARTS.upperArm || pm.getX(i) === FIGURE_PARTS.foreArm) assert.ok(Math.abs(x) > 0.1, `${v}: an arm at x ${x}`);
      if (pm.getX(i) === FIGURE_PARTS.foreArm) assert.ok(y <= 1.14 + 0.06, `${v}: forearm at ${y}`);
    }
    assert.equal(g.attributes.normal, undefined, 'flat shaded: no normals stored');
  }
  // a standing adult is about 1.75 m, feet on the ground
  const plain = buildFigure('plain', 'near').boundingBox;
  assert.ok(Math.abs(plain.max.y - 1.75) < 0.03, `height ${plain.max.y}`);
  assert.ok(Math.abs(plain.max.y - FIG.heightM) < 0.01);
  assert.ok(Math.abs(plain.min.y) < 0.01);
  // what each variant adds
  const mats = (v) => new Set([...buildFigure(v).attributes.aPM.array].filter((_, i) => i % 3 === 1));
  assert.ok(mats('phone').has(FIGURE_MATS.screen), 'the phone has a screen');
  assert.ok(!mats('plain').has(FIGURE_MATS.screen));
  assert.ok(mats('cap-scarf').has(FIGURE_MATS.accessory) && mats('flag').has(FIGURE_MATS.accessory) && mats('beanie-coat').has(FIGURE_MATS.accessory));
  assert.ok(tris['long-hair'] > tris.plain && tris['cap-scarf'] > tris.plain && tris.flag > tris.plain);
  const flag = buildFigure('flag');
  assert.ok([...flag.attributes.aPM.array].some((v, i) => i % 3 === 2 && v > 0.5), 'the flag cloth moves');
  // mid and far
  const mid = buildFigure('plain', 'mid'), far = buildFigure('plain', 'far');
  assert.ok(mid.userData.triangles >= 24 && mid.userData.triangles <= 36, `mid ${mid.userData.triangles}`);
  assert.ok(far.userData.triangles >= 6 && far.userData.triangles <= 8, `far ${far.userData.triangles}`);
  assert.ok(Math.abs(mid.boundingBox.max.y - 1.75) < 0.05 && Math.abs(mid.boundingBox.min.y) < 0.01);
  assert.ok(far.boundingBox.max.z === 0 && far.boundingBox.min.z === 0, 'a card');
  assert.equal(buildFigure('nonsense').userData.triangles, tris.plain, 'an unknown variant is the plain one');
  console.log(`  triangles: near ${JSON.stringify(tris)}, mid ${mid.userData.triangles}, far ${far.userData.triangles}, seat ${buildSeat().userData.triangles}`);
  assert.ok(buildSeat().attributes.normal, 'the seat is lit smooth');
});

// ---------------------------------------------------------------- the shader source
test('shader: the crowd GLSL sits inside the hooks, every name it uses is declared once', () => {
  for (const level of [0, 1, 2]) {
    const mat = makeCrowdMaterial(level, {});
    assert.equal(mat.defines.CROWD_LEVEL, level);
    assert.equal(mat.customProgramCacheKey(), `crowd-v1-${level}`);
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
    const u = { uCrowdTime: { value: 0 } };
    makeCrowdMaterial(level, u).onBeforeCompile(shader);
    assert.equal(shader.uniforms.uCrowdTime, u.uCrowdTime, 'the shared uniform objects themselves');
    assert.ok(!shader.vertexShader.includes('#include <begin_vertex>'), 'begin_vertex is replaced');
    assert.ok(shader.vertexShader.includes('vec3 transformed = vec3(position);'));
    assert.ok(shader.fragmentShader.includes('discard'));
    assert.ok(shader.fragmentShader.includes('diffuseColor.rgb *= vCrowdCol;'));
    assert.ok(shader.fragmentShader.includes('totalEmissiveRadiance += vCrowdCol * uCrowdFx.y + vCrowdEm;'));
    for (const stage of [shader.vertexShader, shader.fragmentShader]) {
      for (const name of new Set(stage.match(/\b[uv]Crowd\w+/g))) {
        const decl = stage.match(new RegExp(`(uniform|varying)\\s+\\w+\\s+${name}\\b`, 'g')) || [];
        assert.equal(decl.length, 1, `${name} declared ${decl.length} times at level ${level}`);
      }
    }
  }
  // every per-vertex and per-instance attribute the shader reads is declared, and the layer provides it
  for (const a of ['aPM', 'aCA', 'aCB', 'aCC', 'aCD']) assert.equal((CROWD_VERTEX_PARS.match(new RegExp(`attribute\\s+vec\\d\\s+${a};`, 'g')) || []).length, 1, a);
  for (const src of [CROWD_VERTEX_PARS, CROWD_VERTEX_MAIN, CROWD_FRAGMENT_PARS, CROWD_FRAGMENT_DITHER]) {
    let depth = 0, paren = 0;
    for (const ch of src) {
      if (ch === '{') depth++; else if (ch === '}') depth--;
      if (ch === '(') paren++; else if (ch === ')') paren--;
      assert.ok(depth >= 0 && paren >= 0);
    }
    assert.equal(depth, 0, 'braces balance');
    assert.equal(paren, 0, 'parentheses balance');
    assert.equal((src.match(/^\s*#if/gm) || []).length, (src.match(/^\s*#endif/gm) || []).length, '#if and #endif pair up');
    assert.ok(!/\b(mat|flat|sample|input|output|filter|active|half)\s*[=;,)]/.test(src.replace(/\/\/.*$/gm, '')), 'no reserved word as a name');
  }
  // every branch of the level switch gives `fade` a value
  assert.equal((CROWD_VERTEX_MAIN.match(/float fade = /g) || []).length, 3);
  // every local the main block uses that is not a GLSL builtin was declared in it or in the pars
  const declared = new Set([...`${CROWD_VERTEX_PARS}\n${CROWD_VERTEX_MAIN}`.matchAll(/\b(?:float|vec2|vec3|vec4|int)\s+(\w+)/g)].map((m) => m[1]));
  for (const name of ['part', 'matId', 'ph', 'rnd', 'rnd2', 'rnd3', 'side', 'iPos', 'camD', 'hb', 'fadeNear', 'fadeFar', 'fade', 'fall', 'cheerP', 'groanP', 'tenseP', 'energy', 'wd', 'waveP', 'up', 'standing', 'sit', 'jump', 'legA', 'drop', 'armsUp', 'clapT', 'clapW', 'clap', 'wCheer', 'wGroan', 'wTense', 'wClap', 'wRest', 'aS', 'aE', 'roll', 'yaw', 'isFlag', 'swing', 'hold', 'sh', 'q', 'el', 'nk', 'lean', 'sway', 'hp', 'col', 'flashOn', 'hc']) {
    assert.ok(declared.has(name), `${name} is declared`);
  }
  const seat = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  makeSeatMaterial({ uCrowdLod: { value: 1 }, uCrowdFx: { value: 2 } }).onBeforeCompile(seat);
  assert.ok(seat.vertexShader.includes('uniform vec4 uCrowdLod;') && seat.vertexShader.includes('seatD'));
  assert.ok(seat.fragmentShader.includes('uniform vec3 uCrowdFx;'));
});

// ---------------------------------------------------------------- the layer
function layer(quality = 'high', style = () => ({ self: 0.3, emissive: 1.2, night: true })) {
  const scene = new THREE.Scene();
  const q = { value: quality };
  const crowd = new CrowdLayer({ scene, V: (x, y, z) => new THREE.Vector3(x, z, -y), quality: () => q.value, style });
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 5000);
  return { scene, crowd, camera, q };
}

test('layer: builds a ring, draws the right levels for where the camera is, hides a stand, clears', () => {
  const { scene, crowd, camera } = layer();
  const stands = ring(20, 80, { text: 'GO' });
  const t0 = performance.now();
  const st = crowd.setStands(stands, { centre: { x: 0, y: 0 }, theme: 'stadium' });
  const ms = performance.now() - t0;
  console.log(`  CrowdLayer.setStands: ${st.people} people in ${st.chunks} chunks, ${ms.toFixed(1)} ms`);
  assert.equal(st.chunks, 40);
  assert.ok(st.people > 20000 && st.seats > st.people);
  assert.equal(scene.children.length, 1);
  assert.equal(scene.children[0].name, 'crowd');
  const meshes = scene.children[0].children;
  assert.ok(meshes.every((m) => m.isInstancedMesh && m.visible === false && !m.castShadow && !m.receiveShadow && m.boundingSphere && m.boundingSphere.radius > 5));
  assert.ok(meshes.every((m) => m.frustumCulled), 'culled by its own sphere');
  // per chunk: near variants, mid, far, seats; mid and far share their instance buffers
  const one = crowd.chunks[0];
  assert.ok(one.near.length >= 4 && one.mid && one.far && one.seats);
  assert.equal(one.mid.instanceMatrix, one.far.instanceMatrix);
  assert.equal(one.mid.geometry.attributes.aCA, one.far.geometry.attributes.aCA);
  assert.notEqual(one.mid.geometry, one.far.geometry);
  assert.equal(one.near.reduce((n, m) => n + m.count, 0), one.mid.count, 'every person has a near figure');
  assert.equal(one.mid.geometry.attributes.position, crowd.chunks[5].mid.geometry.attributes.position, 'every chunk draws the one figure');
  assert.equal(one.seats.instanceColor.count, one.seats.count);
  for (const m of meshes) for (const a of Object.values(m.geometry.attributes)) for (const v of a.array.subarray(0, 64)) assert.ok(Number.isFinite(v));
  for (const m of meshes) assert.ok(m.instanceMatrix.array.every(Number.isFinite), m.name);
  // a person stands where their seat is: the instance's translation is V(seat)
  const seats = standSeats(stands[0]);
  const m0 = one.mid.instanceMatrix.array;
  let found = false;
  for (let s = 0; s < seats.count && !found; s++) found = near(seats.pos[s * 4], m0[12], 1e-4) && near(seats.pos[s * 4 + 2], m0[13], 1e-4) && near(-seats.pos[s * 4 + 1], m0[14], 1e-4);
  assert.ok(found, 'the first person sits in one of the stand\'s seats');
  // the figure faces the middle of the ring: its +z (the front) points from the seat toward (0, 0)
  const front = new THREE.Vector3(m0[8], m0[9], m0[10]).normalize(), toMid = new THREE.Vector3(-m0[12], 0, -m0[14]).normalize();
  assert.ok(front.dot(toMid) > 0.9, `facing ${front.dot(toMid).toFixed(2)}`);

  // from the middle of the pitch: everything is mid range or beyond, nothing near
  camera.position.set(0, 3, 0);
  crowd.update(0, camera);
  let s = crowd.stats();
  assert.equal(s.drawn.near, 0);
  assert.ok(s.drawn.mid > 0.9 * s.people, `${s.drawn.mid} mid`);
  assert.ok(s.triangles > 0 && s.calls >= 40 && s.calls <= 70, `${s.calls} draws`);
  assert.ok(s.triangles < 1.3e6, `${s.triangles} triangles from the middle`);
  // standing in the front row of one stand: its lower tier is near, the far side is cards
  const a = stands[0];
  camera.position.copy(new THREE.Vector3(a.x * 0.97, 6, -a.y * 0.97));
  crowd.update(0.1, camera);
  s = crowd.stats();
  assert.ok(s.drawn.near > 300, `${s.drawn.near} near`);
  assert.ok(s.drawn.far > 0.3 * s.people, `${s.drawn.far} far`);
  assert.ok(s.drawn.seats > 0);
  assert.ok(crowd.chunks.find((c) => c.standId === 's0' && c.tier === 0).near.every((m) => m.visible));
  assert.ok(crowd.chunks.find((c) => c.standId === 's10' && c.tier === 0).near.every((m) => !m.visible));
  assert.equal(crowd.chunks.find((c) => c.standId === 's10' && c.tier === 0).far.visible, true);
  // a stand drawn as a ghost has no people
  crowd.setHidden('s0', true);
  crowd.update(0.2, camera);
  const mine = crowd.chunks.filter((c) => c.standId === 's0');
  assert.equal(mine.length, 2);
  assert.ok(mine.every((c) => [...c.near, c.mid, c.far, c.seats].every((m) => !m.visible)));
  assert.ok(crowd.stats().drawn.near < s.drawn.near);
  crowd.setHidden('s0', false);
  crowd.update(0.3, camera);
  assert.ok(mine.some((c) => c.near.some((m) => m.visible)));
  // off the stage
  crowd.clear();
  assert.equal(scene.children.length, 0);
  assert.equal(crowd.stats().people, 0);
  assert.equal(crowd.chunks.length, 0);
  crowd.dispose();
  assert.ok(ms < 3000, `${ms.toFixed(0)} ms to build`);
});

test('layer: a reaction moves the shared uniforms, and only those', () => {
  const { crowd, camera } = layer();
  crowd.setStands(ring(4), { centre: { x: 0, y: 0 } });
  const u = crowd.uniforms;
  crowd.update(1, camera);
  assert.deepEqual(u.uCrowdMood.value.toArray(), [0, 0, 0, CROWD_IDLE_ENERGY]);
  assert.equal(u.uCrowdTime.value, 1);
  assert.equal(u.uCrowdFx.value.y, 0.3, 'the look\'s own-colour term');
  assert.ok(near(u.uCrowdFx.value.z, 1.2 * 2.2), 'screens are brighter at night');
  assert.deepEqual(u.uCrowdLod.value.toArray(), [38, 120, 6, 1]);
  assert.equal(crowd.react('boo'), false);
  assert.equal(crowd.react('cheer', { at: { x: 30, y: 40 }, intensity: 1 }), true);
  crowd.update(1.3, camera);
  assert.equal(u.uCrowdMood.value.x, 1);
  assert.deepEqual(u.uCrowdAt.value.toArray(), [30, -40, 90, 1], 'where it happened, in the renderer\'s frame');
  assert.ok(u.uCrowdFx.value.x > 0, 'cameras flash as the cheer peaks');
  crowd.react('groan');
  crowd.update(1.6, camera);
  assert.equal(u.uCrowdMood.value.x, 0);
  assert.equal(u.uCrowdMood.value.y, 1);
  assert.equal(u.uCrowdAt.value.w, 0);
  crowd.react('tense');
  crowd.update(9, camera);
  assert.equal(u.uCrowdMood.value.z, 1);
  crowd.react('wave');
  crowd.update(10, camera);
  assert.equal(u.uCrowdWave.value.y, 1);
  assert.ok(u.uCrowdWave.value.x >= 0 && u.uCrowdWave.value.x < Math.PI * 2);
  // every material reads the same uniform objects
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  crowd.chunks[0].mid.material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uCrowdMood, u.uCrowdMood);
  const far = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  crowd.chunks[0].far.material.onBeforeCompile(far);
  assert.equal(far.uniforms.uCrowdMood, u.uCrowdMood);
  // a long lens
  camera.fov = 30;
  crowd.update(11, camera);
  assert.ok(u.uCrowdLod.value.w < 0.5);
  // no style: nothing given back, screens as they are
  const bare = layer('high', () => null);
  bare.crowd.setStands(ring(2));
  bare.crowd.update(0, bare.camera);
  assert.deepEqual([bare.crowd.uniforms.uCrowdFx.value.y, bare.crowd.uniforms.uCrowdFx.value.z], [0, 1]);
  crowd.dispose(); bare.crowd.dispose();
});

test('layer: low graphics is a thinner crowd with no near figures, no seats and no flashes; a change rebuilds it', () => {
  const { scene, crowd, camera, q } = layer('low');
  const stands = ring(6);
  const low = crowd.setStands(stands, { centre: { x: 0, y: 0 } });
  assert.equal(low.seats, 0);
  assert.ok(crowd.chunks.every((c) => c.near.length === 0 && !c.seats && c.mid && c.far));
  camera.position.set(stands[0].x, 6, -stands[0].y);
  crowd.react('cheer');
  crowd.update(0.5, camera);
  assert.equal(crowd.stats().drawn.near, 0);
  assert.ok(crowd.stats().drawn.mid > 0);
  assert.equal(crowd.uniforms.uCrowdFx.value.x, 0, 'no flashes');
  assert.ok(crowd.uniforms.uCrowdLod.value.x < -1000, 'mid from the camera out');
  // the player turns the graphics up: the full crowd is built at the next frame, and it is still cheering
  q.value = 'high';
  crowd.setHidden('s3', true);
  crowd.update(0.6, camera);
  const high = crowd.stats();
  assert.ok(high.people > 1.8 * low.people, `${high.people} against ${low.people}`);
  assert.ok(high.seats > 0 && high.drawn.near > 0);
  assert.equal(crowd.uniforms.uCrowdMood.value.x, 1);
  assert.equal(scene.children.length, 1);
  assert.ok(crowd.chunks.filter((c) => c.standId === 's3').every((c) => !c.mid.visible), 'what was hidden stays hidden');
  // high to ultra is only a longer near range: nothing is rebuilt
  const group = crowd.group;
  q.value = 'ultra';
  crowd.update(0.7, camera);
  assert.equal(crowd.group, group);
  assert.equal(crowd.uniforms.uCrowdLod.value.x, 55);
  crowd.dispose();
  assert.equal(scene.children.length, 0);
});

test('layer: galleries and scaled stands; nothing to draw is nothing in the scene', () => {
  const { scene, crowd, camera } = layer();
  assert.equal(crowd.setStands([]).people, 0);
  assert.equal(scene.children.length, 0);
  crowd.update(0, camera);
  assert.equal(crowd.react('cheer'), true, 'a reaction with no crowd is harmless');
  crowd.setStands([{ id: 'g1', kind: 'crowd', x: 0, y: 30, z: 0, rotDeg: 0 }, { id: 'gs', kind: 'grandstand', x: 40, y: 30, z: 0, rotDeg: 90 }, { id: 'x', kind: 'windmill', x: 0, y: 0 }]);
  assert.equal(crowd.chunks.length, 2);
  const g = crowd.chunks.find((c) => c.standId === 'g1');
  assert.equal(g.seats, null);
  assert.ok(g.mid.count > 60);
  assert.ok(STANDS.crowd.tiers[0].stand);
  camera.position.set(0, 2, -10);
  crowd.update(0, camera);
  assert.ok(crowd.stats().drawn.near > 0);
  // setStands replaces what stood
  crowd.setStands([{ id: 'g2', kind: 'crowd', x: 0, y: 30, z: 0, rotDeg: 0 }]);
  assert.equal(crowd.chunks.length, 1);
  assert.equal(scene.children.length, 1);
  crowd.dispose();
});
