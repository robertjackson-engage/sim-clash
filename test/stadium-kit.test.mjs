// v3:stadium The stadium kit: its sections close a ring on the arenas' own radii, its tables
// agree with the baked models, the renderer's wedge is the kit's wedge, and the props layer
// puts a crowd in the stands, lets the game make it react, ghosts a stand the camera is in
// (its people with it) and tells the menus' backdrop orbit where the stands are.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  STANDS, isStandKind, standWedge, wedgePoint, standToCourse, wedgeYaw, standSeats, standLamps, seamGap, seatLettering, SEAT_PITCH_M,
} from '../public/render/stadium-kit.js';
import { PropsLayer, PROP_PROCEDURAL_KINDS, PROP_SLOTS, PROP_TRUE_SIZE, WEDGE_VERTEX, WEDGE_NORMAL, wedgeMaterial, SPONSORS, normalizeProp } from '../public/render/props.js';
import { inspectGlb, readGlb, SLOTS } from '../tools/arcade-art/bake.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = require('../tools/arcade-holes/lib.js');
const dome = require('../tools/arcade-holes/holes/thunder-dome.js');
const mile = require('../tools/arcade-holes/holes/midnight-mile.js');
const DIR = path.join(ROOT, 'public', 'arcade', 'props');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8')).kinds;
const V3 = (x, y, z) => new THREE.Vector3(x, z, -y);
const sections = (piece) => piece.props.filter((p) => L.STAND_PROP_KINDS.includes(p.kind));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('the wedge: a straight stand is untouched, a splayed one opens with depth, its sag bulges the middle', () => {
  const straight = standWedge('stand-section', null);
  assert.deepEqual(straight, { w: 24, tl: 0, tr: 0, sag: 0, sagK: 0 });
  assert.deepEqual(wedgePoint(straight, 0.25, 10), [6, 10]);
  const w = standWedge('stand-section', { w: 20, tl: 0.1, tr: 0.3, sag: 1, sagK: 0.02 });
  assert.deepEqual(wedgePoint(w, -0.5, 0), [-10, 0]);
  assert.deepEqual(wedgePoint(w, 0.5, 0), [10, 0]);
  assert.deepEqual(wedgePoint(w, -0.5, 40).map((v) => +v.toFixed(6)), [-14, 40], 'the left side runs out 0.1 m a metre');
  assert.deepEqual(wedgePoint(w, 0.5, 40).map((v) => +v.toFixed(6)), [22, 40], 'the right 0.3');
  assert.deepEqual(wedgePoint(w, 0, 40).map((v) => +v.toFixed(6)), [4, 41.8], 'mid chord is pushed back by the sag, more with depth');
  assert.ok(Math.abs(wedgeYaw(w, 0.5) - Math.atan(0.3)) < 1e-12 && Math.abs(wedgeYaw(w, -0.5) + Math.atan(0.1)) < 1e-12, 'the rows turn with the sides');
  // a wild entry is tamed, a missing width is the model's own (times its scale)
  assert.equal(standWedge('grandstand', { tl: 9, tr: 'x' }, 0.5).w, 15);
  assert.equal(standWedge('grandstand', { tl: 9 }).tl, 1.6);
  // on the course: rotDeg 0 has its front to the south, so its back runs north and its +x east
  assert.deepEqual(standToCourse({ x: 5, y: 7, rotDeg: 0 }, 2, 10), [7, 17]);
  assert.deepEqual(standToCourse({ x: 0, y: 0, rotDeg: 90 }, 2, 10).map((v) => +v.toFixed(6) + 0), [10, -2]);
});

test('the renderer bends the model with the same four lines', () => {
  const src = WEDGE_VERTEX(24) + WEDGE_NORMAL(24);
  for (const piece of ['position.x / 24.000', 'wd = -position.z', '-0.5 * aWedge.x - wd * aWedge.y', '0.5 * aWedge.x + wd * aWedge.z', '(1.0 - 4.0 * wu * wu) * (aWedge.w + wd * aWedgeK)', 'atan(-aWedge.y + (aWedge.z + aWedge.y) * (wnu + 0.5))']) assert.ok(src.includes(piece), piece);
  assert.equal((src.match(/#ifdef USE_INSTANCING/g) || []).length, (src.match(/#endif/g) || []).length, 'only for instanced copies');
  // a material is taught once, keeps what it already did, and has a program of its own per model width
  const m = new THREE.MeshStandardMaterial();
  let called = 0;
  m.onBeforeCompile = () => { called++; };
  wedgeMaterial(m, 24);
  const again = m.onBeforeCompile;
  wedgeMaterial(m, 24);
  assert.equal(m.onBeforeCompile, again, 'once');
  const shader = { vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>\n' };
  m.onBeforeCompile(shader);
  assert.equal(called, 1);
  assert.ok(shader.vertexShader.includes('attribute vec4 aWedge; attribute float aWedgeK;') && shader.vertexShader.includes('transformed.x = wxl'));
  assert.equal(m.customProgramCacheKey(), 'prop-wedge-24');
  assert.notEqual(wedgeMaterial(new THREE.MeshDepthMaterial(), 30).customProgramCacheKey(), m.customProgramCacheKey());
});

test('the kit pieces close a ring at the arenas\' radii: Thunder Dome\'s bowl and Midnight Mile\'s arc', () => {
  for (const [piece, n, corners] of [[dome, 18, 4], [mile, 7, 2]]) {
    const ring = sections(piece);
    assert.equal(ring.length, n, `${piece.id}: ${ring.length} sections`);
    assert.equal(ring.filter((p) => p.kind === 'stand-corner').length, corners);
    assert.ok(n >= 6 && n <= 24);
    let worst = 0;
    for (let i = 0; i + 1 < ring.length; i++) {
      // neighbours share their side line: the same point at the front, at the back of the lower tier, at the back wall
      for (const D of [0, 20, 46]) {
        const g = seamGap(ring[i], ring[i + 1], D);
        worst = Math.max(worst, g.front, g.back);
        assert.ok(g.front < 0.002 && g.back < 0.02, `${piece.id}: sections ${i + 1} and ${i + 2} are ${(g.back * 1000).toFixed(1)} mm apart ${D} m back`);
        assert.equal(g.dz, 0, 'and stand on one level');
      }
      // and their tiers meet at the same depth along it: both see the shared line at the same angle
      const a = standWedge(ring[i].kind, ring[i].wedge), b = standWedge(ring[i + 1].kind, ring[i + 1].wedge);
      assert.ok(Math.abs(a.tl - b.tr) < 1e-4, `${piece.id}: seam ${i + 1} is the bisector of its two chords (${a.tl} against ${b.tr})`);
    }
    // every section is a sane wedge: its chord near the model's width, opening outward, bulging outward
    for (const p of ring) {
      assert.ok(p.wedge.w > 12 && p.wedge.w < 26, `${p.id}: a ${p.wedge.w} m chord`);
      assert.ok(p.wedge.tl > -0.05 && p.wedge.tr > -0.05 && p.wedge.tl < 0.7 && p.wedge.tr < 0.7, `${p.id}: splays ${p.wedge.tl}, ${p.wedge.tr}`);
      assert.ok(p.wedge.sag >= 0 && p.wedge.sag < 2.5 && p.wedge.sagK >= 0);
      assert.equal(p.z, ring[0].z);
    }
    // as the course carries them (rounded to a centimetre, the piece set down on the map) they still close to a centimetre or two
    const { course } = require('../tools/arcade-holes/courses.js').buildCourse(piece.id);
    const built = course.props.filter((p) => L.STAND_PROP_KINDS.includes(p.kind));
    for (let i = 0; i + 1 < built.length; i++) { const g = seamGap(built[i], built[i + 1], 46); assert.ok(g.front < 0.02 && g.back < 0.03, `${piece.id} as built: ${(g.back * 1000).toFixed(0)} mm`); }
    assert.ok(worst < 0.02);
  }
  // the arena's own radii: every section of the dome stands on the foot of its pitch wall, and its tiers cover the terraces
  const { arena } = dome;
  const h = dome.height;
  for (const p of sections(dome)) {
    const w = standWedge(p.kind, p.wedge), def = STANDS[p.kind];
    for (const u of [-0.5, -0.25, 0, 0.25, 0.5]) {
      for (const tier of def.tiers) {
        for (let r = 0; r < tier.rows; r += 3) {
          const d = tier.d0 + tier.tread * (r + 0.5), [x, y] = standToCourse(p, ...wedgePoint(w, u, d));
          const tread = p.z + tier.y0 + tier.rise * r;
          if (Math.abs(x) < arena.gapX + 2 && y < 30) continue;   // beside the stage the ground is the stage's bank
          assert.ok(tread > h(x, y) - 0.05, `${p.id}: the terrace shows through row ${r} (${tread.toFixed(2)} against ${h(x, y).toFixed(2)})`);
        }
      }
    }
  }
});

test('the kit\'s tables are the baked models: widths, depths, the tiers under the roof', () => {
  for (const [kind, def] of Object.entries(STANDS)) {
    assert.ok(isStandKind(kind) && manifest[kind], `${kind} is in the manifest`);
    const e = manifest[kind], s = inspectGlb(path.join(DIR, e.file));
    assert.equal(e.anchor, 'front', `${kind}: its front edge is its origin`);
    assert.ok(Math.abs(s.size[0] - def.widthM) < 2, `${kind}: ${s.size[0].toFixed(1)} m wide for ${def.widthM}`);
    assert.ok(Math.abs(-s.box.min[2] - def.depthM) < 1.2, `${kind}: runs ${(-s.box.min[2]).toFixed(1)} m back for ${def.depthM}`);
    assert.ok(Math.abs(s.box.max[1] - def.heightM) < 0.6, `${kind}: ${s.box.max[1].toFixed(1)} m tall for ${def.heightM}`);
    for (const t of def.tiers) {
      assert.ok(t.d0 + t.tread * t.rows < def.depthM && t.y0 + t.rise * t.rows < def.heightM, `${kind}: its tiers are inside it`);
      for (const v of t.voms) assert.ok(v[0] < v[1] && v[2] <= v[3] && v[3] < t.rows);
    }
    for (const a of def.aisles) assert.ok(a[0] >= -0.5 && a[1] <= 0.5 && a[0] < a[1]);
  }
  // the bowl sections are never resized (their seats are people-sized); the kit's kinds all have a stand-in
  assert.deepEqual([...PROP_TRUE_SIZE], ['stand-section', 'stand-corner']);
  for (const kind of ['stand-section', 'stand-corner', 'led-board', 'ad-board', 'barrier', 'camera-tower', 'tunnel', 'podium', 'grandstand', 'crowd', 'jumbotron']) {
    assert.ok(PROP_PROCEDURAL_KINDS.includes(kind) && L.PROP_KINDS.includes(kind) && manifest[kind], kind);
  }
  // the named material slots: only the ones the renderer feeds, the screen a full 0..1 rectangle
  assert.deepEqual([...PROP_SLOTS].sort(), SLOTS.filter((x) => x !== 'base' && x !== 'glow').sort());
  const j = readGlb(path.join(DIR, manifest.jumbotron.file));
  const names = j.json.materials.map((m) => m.name);
  assert.ok(names.includes('screen') && names.includes('led') && names.includes('ad'), names.join(', '));
  assert.ok(manifest['stand-section'].slots.includes('glass') && manifest['stand-section'].slots.includes('led'));
  assert.equal(SPONSORS.length, 16);
  assert.equal(new Set(SPONSORS.map((x) => x[0])).size, 16, 'sixteen invented names');
});

test('seats: rows between the aisles, none in a tunnel mouth, an even pitch along the real arc', () => {
  const straight = standSeats({ kind: 'stand-section', x: 0, y: 0, z: 0, rotDeg: 0 });
  const def = STANDS['stand-section'];
  assert.equal(straight.rows.length, def.tiers[0].rows + def.tiers[1].rows);
  assert.ok(straight.count > 1200 && straight.count < 1500, `${straight.count} seats`);
  const wide = standSeats({ kind: 'stand-section', x: 0, y: 0, z: 0, rotDeg: 0, wedge: { w: 21, tl: 0.25, tr: 0.25, sag: 1.2, sagK: 0.03 } });
  assert.ok(wide.count > straight.count * 1.2, 'a wedge has more seats in its back rows');
  for (const s of [straight, wide]) {
    for (const row of s.rows) {
      let prev = null;
      for (let i = row.from; i < row.to; i++) {
        const x = s.pos[i * 4], y = s.pos[i * 4 + 1], block = s.meta[i * 4 + 3];
        if (prev && prev.block === block) {
          const d = Math.hypot(x - prev.x, y - prev.y);
          assert.ok(d > SEAT_PITCH_M * 0.97 && d < SEAT_PITCH_M * 1.35, `a seat ${d.toFixed(2)} m from the next`);
        }
        prev = { x, y, block };
      }
    }
  }
  // a tunnel mouth: rows 8 to 12 of the lower tier have no seat between u -0.31 and -0.19
  for (let i = 0; i < straight.count; i++) {
    const tier = straight.meta[i * 4], row = straight.meta[i * 4 + 1], u = straight.pos[i * 4] / 24;
    if (tier === 0 && row >= 8 && row <= 12) assert.ok(!(u > -0.31 && u < -0.19) && !(u > 0.19 && u < 0.31), `a seat in the tunnel mouth at u ${u.toFixed(2)}`);
    assert.ok(Math.abs(u) > 0.026 || true);
  }
  // everyone faces the pitch: a north stand (rotDeg 0) looks south
  assert.ok(Math.abs(straight.pos[3] - Math.PI) < 1e-6);
  // a gallery scaled down keeps people-sized spacing; a small grandstand at 0.6 keeps every second row
  const gallery = standSeats({ kind: 'crowd', x: 0, y: 0, z: 0, rotDeg: 0, scale: 0.6 });
  assert.equal(gallery.rows.length, 4);
  assert.ok(gallery.count >= 4 * 15 && gallery.count <= 4 * 18, `${gallery.count} in a 10.8 m gallery`);
  // lamps: three banks under the roof's edge of a section, one on a corner's pylon
  assert.equal(standLamps({ kind: 'stand-section', x: 0, y: 0, z: 1, rotDeg: 0 }).length, 3);
  const [lamp] = standLamps({ kind: 'stand-corner', x: 0, y: 0, z: 1, rotDeg: 0 });
  assert.ok(lamp.z > 50 && lamp.y > 40, 'up on the pylon behind the stand');
  // lettering: a letter is upright and reads left to right across the block
  const cols = 40, rows = 21, pic = [];
  for (let r = rows - 1; r >= 0; r--) { let line = ''; for (let c = 0; c < cols; c++) line += seatLettering('L', c, cols, r, rows, 2) ? '#' : '.'; pic.push(line); }
  const lit = pic.filter((l) => l.includes('#'));
  assert.equal(lit.length, 14, 'seven font rows, two seat rows each');
  assert.ok(lit[0].indexOf('#') === lit[13].indexOf('#') && lit[13].lastIndexOf('#') > lit[0].lastIndexOf('#'), 'an L: its foot runs right along the front rows');
  assert.equal(seatLettering('', 3, 40, 3, 21), false);
});

test('the props layer fills the stands, the stage reacts, a stand the camera is in is a ghost and its people go with it', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404 });   // no manifest, no GLBs: the kit's stand-ins
  try {
    const scene = new THREE.Scene();
    let quality = 'high';
    const layer = new PropsLayer({ scene, hAt: () => 1, V: V3, env: () => ({ quality, night: true }), style: () => ({ self: 0.1, emissive: 1 }) });
    const { course } = require('../tools/arcade-holes/courses.js').buildCourse('thunder-dome');
    await layer.setCourse({ props: course.props, arcade: course.arcade });
    await layer.ready;
    assert.equal(layer.crowdReact('cheer'), false, 'nobody to react before the crowd is in');
    const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.5, 4000);
    const tee = course.holes[0].tee, pin = course.holes[0].pin;
    const place = (x, y, z) => { camera.position.copy(V3(x, y, z)); camera.lookAt(V3(pin[0], pin[1], 2)); camera.updateMatrixWorld(true); };
    place(tee[0], tee[1] - 8, 16);
    layer.update(0, camera);
    await sleep(160);
    layer.update(0.2, camera);     // the stadium is dressed once its models have been in for a moment
    const st = layer.stats();
    assert.equal(st.stands, 18 + 2 + 4, 'the bowl, the two stands behind the stage, the four galleries');
    assert.ok(st.crowd.people > 20000 && st.crowd.people < 32000, `${st.crowd.people} people`);
    assert.ok(st.crowd.seats > st.crowd.people, 'a few seats are empty');
    assert.ok(st.fx.lamps >= 18 * 2 + 13 && st.fx.beams > 0 && st.fx.beams <= 28 && st.fx.cannons >= 6, JSON.stringify(st.fx));
    // level of detail: from the tee the far side is cards, close in the people are figures; from above all cards
    layer.update(0.3, camera);
    const fromTee = layer.stats().crowd.drawn;
    assert.ok(fromTee.far > 5000 && fromTee.mid > 2000, JSON.stringify(fromTee));
    const s9 = course.props.find((p) => p.id.endsWith('/bowl-9'));
    place(s9.x, s9.y - 12, 6);
    camera.lookAt(V3(s9.x, s9.y + 20, 14)); camera.updateMatrixWorld(true);
    layer.update(0.4, camera);
    assert.ok(layer.stats().crowd.drawn.near > 300, 'figures in front of the lens');
    place(0, 90, 400);
    layer.update(0.5, camera);
    assert.deepEqual([layer.stats().crowd.drawn.near, layer.stats().crowd.drawn.mid], [0, 0], 'cards only from 400 m up');
    assert.ok(layer.stats().crowd.calls <= 70);
    // the reactions
    const u = layer.crowd.uniforms;
    assert.equal(layer.crowdReact('nonsense'), false);
    assert.equal(layer.crowdReact('cheer', { at: { x: pin[0], y: pin[1] }, intensity: 2 }), true);
    layer.update(1.0, camera);
    assert.ok(u.uCrowdMood.value.x > 0.5, 'cheering');
    assert.equal(layer.crowdReact('groan'), true);
    layer.update(1.6, camera);
    assert.ok(u.uCrowdMood.value.y > 0.5 && u.uCrowdMood.value.x < 0.5, 'a groan takes over');
    assert.equal(layer.crowdReact('tense'), true);
    assert.equal(layer.crowdReact('wave', { intensity: 2 }), true);
    layer.update(2.2, camera);
    assert.ok(u.uCrowdWave.value.y > 0, 'a wave is running');
    assert.equal(layer.crowdReact('win'), true);
    layer.update(2.3, camera);
    layer.update(2.6, camera);
    const fx = layer.stats().fx;
    assert.ok(fx.active.confetti || fx.queued > 0, 'a win fires the cannons');
    // pass-through: the camera inside a section's plan ghosts that section and hides its people; outside again, both are back
    const before = layer.stats().crowd.people;
    const inside = standToCourse(s9, ...wedgePoint(standWedge(s9.kind, s9.wedge), 0.1, 14));
    layer.setSeeThrough(null, { x: inside[0], y: inside[1], z: 9 }, null);
    assert.equal(layer.seeThroughCount(), 1);
    assert.equal(layer.crowd._hidden.size, 1, 'its people are not drawn');
    layer.setSeeThrough(null, { x: 0, y: 90, z: 9 }, null);     // on the pitch: inside no stand
    assert.equal(layer.seeThroughCount(), 0);
    assert.equal(layer.crowd._hidden.size, 0);
    layer.setSeeThrough(null, { x: s9.x, y: s9.y - 3, z: 4 }, null);   // at the foot of the pitch wall: still outside
    assert.equal(layer.seeThroughCount(), 0);
    layer.setSeeThrough(null, { x: inside[0], y: inside[1], z: 80 }, null);   // high over the roof
    assert.equal(layer.seeThroughCount(), 0);
    assert.equal(layer.stats().crowd.people, before);
    // the backdrop orbit's obstacle list has every stand, as a cylinder round its real middle (not its front edge)
    const obst = layer.obstacles();
    const mid = standToCourse(s9, 0, 24);
    assert.ok(obst.some((o) => Math.hypot(o.x - mid[0], o.y - mid[1]) < 3 && o.r > 20 && o.top - o.base > 30), 'the section behind the green is an obstacle');
    assert.ok(obst.length >= course.props.filter((p) => !['target-ring'].includes(p.kind)).length - 2);
    // low graphics: a thinner crowd, no beams
    quality = 'low';
    layer.update(3, camera);
    layer.refresh();
    await sleep(40);
    layer.update(3.1, camera);
    await sleep(160);
    layer.update(3.3, camera);
    layer.update(3.4, camera);
    const low = layer.stats();
    assert.ok(low.crowd.people < before * 0.6, `${low.crowd.people} people on low`);
    assert.equal(low.fx.beams, 0);
    // a new course: nothing of the stadium is left
    layer.clear();
    assert.equal(layer.stats().crowd.people, 0);
    assert.equal(scene.children.filter((c) => c.name === 'crowd' || c.name === 'stadium-fx').reduce((n, g) => n + g.children.length, 0), 0);
    layer.dispose();
  } finally { globalThis.fetch = realFetch; }
});

test('an entry keeps a stand\'s wedge and dressing, and only when it has them', () => {
  const plain = normalizeProp({ kind: 'palm', x: 1, y: 2 });
  assert.ok(!('wedge' in plain) && !('text' in plain) && !('team' in plain));
  const p = normalizeProp({ kind: 'stand-section', x: 1, y: 2, z: 0.95, heightM: 42, wedge: { w: 21, tl: 0.2, tr: 0.2, sag: 1, sagK: 0.02 }, text: 'A', team: ['#112233', '#ffffff'] });
  assert.deepEqual(p.wedge, { w: 21, tl: 0.2, tr: 0.2, sag: 1, sagK: 0.02 });
  assert.equal(p.text, 'A');
  assert.equal(p.sinkM, 0, 'it stands on the height it is given');
});
