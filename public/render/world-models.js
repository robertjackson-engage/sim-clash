// v3:living The small cast of the living world (docs/living-world.md): the boats, the train,
// the birds, the camel. Low-poly on purpose, like the procedural props (prop-models.js): a
// bold silhouette and flat colour that read from 200 yards. Each is ONE merged geometry with
// per-vertex colour, and every one of them is drawn by ONE material (makeLifeMaterial), so a
// stage's whole cast is a draw call a model.
//
//   color   per-vertex colour (linear)
//   aLife   (glow, flap, tint, rate)
//           glow: how much of its own colour the vertex gives back unlit (a train's windows,
//           a car's lamps); flap: metres this vertex rises and falls (a wing tip, a pennant's
//           point); tint: 1 = it takes the copy's own colour (aTint, per instance: every sail
//           and every walker's shirt a different colour from one geometry); rate: rad/s of the flap
//   aTint   per instance: (r, g, b, how hard it flaps: 0 for a bird sitting still)
//
// Model space: metres, +y up, the model's FRONT is +z, its origin where it touches what it
// stands on (a boat's waterline, a cable car's cable, a bird's middle). No renderer and no DOM
// is needed, so the builders are unit-tested (test/living-world.test.mjs).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PI = Math.PI;
const colorOf = (c) => (c instanceof THREE.Color ? c : new THREE.Color(c));
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const cyl = (rTop, rBot, h, seg = 8, x = 0, y = 0, z = 0) => new THREE.CylinderGeometry(rTop, rBot, h, seg).translate(x, y + h / 2, z);
const cone = (r, h, seg = 8, x = 0, y = 0, z = 0) => new THREE.ConeGeometry(r, h, seg).translate(x, y + h / 2, z);
const ball = (r, detail = 1, x = 0, y = 0, z = 0) => new THREE.IcosahedronGeometry(r, detail).translate(x, y, z);
const tri = (a, b, c) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3)); return g; };   // (the material draws both faces)
const at = (g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
  if (sx !== 1 || sy !== 1 || sz !== 1) g.scale(sx, sy, sz);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  return g.translate(x, y, z);
};

class Kit {
  constructor() { this.parts = []; }
  // flap may be a function (x, y, z) -> metres
  add(geo, color, { glow = 0, flap = 0, tint = 0, rate = 0 } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
    g.computeVertexNormals();
    const pos = g.attributes.position, n = pos.count, c = colorOf(color);
    const col = new Float32Array(n * 3), life = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      life[i * 4] = glow;
      life[i * 4 + 1] = typeof flap === 'function' ? flap(pos.getX(i), pos.getY(i), pos.getZ(i)) : flap;
      life[i * 4 + 2] = tint;
      life[i * 4 + 3] = rate;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(life, 4));
    this.parts.push(g);
    return this;
  }
  build() {
    const g = mergeGeometries(this.parts, false);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

const WHITE = '#f4f1e8', DARK = '#23262c', WOOD = '#8a5a34', STEEL = '#8d949e';

// ---------------------------------------------------------------- vehicles
const MODELS = {
  // a little sailing boat, 8 m: the sail takes the copy's colour
  boat() {
    const k = new Kit();
    k.add(at(cyl(1.25, 0.7, 1.0, 6), 0, -0.25, 0, 0, 0, 0, 1, 1, 3.1), WHITE);
    k.add(box(2.1, 0.12, 6.6, 0, 0.7, 0), WOOD);
    k.add(box(1.3, 0.7, 2.0, 0, 0.78, -1.2), '#d8dde2');
    k.add(cyl(0.07, 0.09, 7.2, 5, 0, 0.8, 0.5), DARK);
    k.add(tri([0, 7.7, 0.45], [0, 1.5, 0.45], [0, 1.5, -3.2]), WHITE, { tint: 1 });
    k.add(tri([0, 6.6, 0.6], [0, 1.4, 0.6], [0, 1.4, 3.5]), WHITE);
    k.add(tri([0, 8.0, 0.5], [0, 7.6, 0.5], [0, 7.8, -0.7]), '#e23a2e', { flap: (x, y, z) => (z < 0 ? 0.08 : 0), rate: 9 });
    return k.build();
  },
  // a long black punt with a lantern at each end (the neon canal, the garden pond)
  gondola() {
    const k = new Kit();
    k.add(at(cyl(0.75, 0.4, 0.6, 6), 0, -0.15, 0, 0, 0, 0, 1, 1, 5.2), '#16181d');
    k.add(box(1.0, 0.1, 5.4, 0, 0.42, 0), '#5a1f2a', { tint: 1 });
    k.add(at(cone(0.2, 1.3, 5), 0, 0.3, 3.7, 0.5), '#16181d');
    k.add(at(cone(0.2, 1.1, 5), 0, 0.3, -3.7, -0.5), '#16181d');
    k.add(box(0.14, 1.5, 0.14, 0, 0.45, -2.6), DARK);
    k.add(box(0.42, 0.5, 0.42, 0, 1.9, -2.6), '#ffd27a', { glow: 1.6 });
    k.add(box(0.3, 0.36, 0.3, 0, 0.9, 3.0), '#ff7ad1', { glow: 1.4 });
    k.add(box(0.5, 1.2, 0.4, 0, 0.5, -1.6), '#2e3440');           // the gondolier
    k.add(ball(0.24, 0, 0, 1.95, -1.6), '#e8b98a');
    return k.build();
  },
  // one car of a train, 14 m, its windows lit; nose to tail they make the train
  train() {
    const k = new Kit();
    k.add(box(2.9, 2.6, 13.6, 0, 0.9, 0), '#d9dee6', { tint: 1 });
    k.add(box(2.7, 0.3, 13.2, 0, 3.5, 0), '#3a4150');
    k.add(box(2.4, 0.6, 12.4, 0, 0.3, 0), DARK);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 6; i++) k.add(box(0.08, 0.9, 1.5, s * 1.46, 2.1, -5.2 + i * 2.08), '#ffe9a8', { glow: 1.5 });
      k.add(box(0.08, 0.22, 13.2, s * 1.46, 1.3, 0), '#ff4fa8', { glow: 0.9 });
    }
    k.add(box(2.2, 0.5, 0.08, 0, 2.3, 6.82), '#bff3ff', { glow: 1.2 });
    return k.build();
  },
  // a car, 4.4 m: white lamps ahead, red behind (all that is seen of it at night)
  car() {
    const k = new Kit();
    k.add(box(1.8, 0.75, 4.4, 0, 0.3, 0), WHITE, { tint: 1 });
    k.add(box(1.6, 0.6, 2.2, 0, 1.05, -0.3), '#20252e');
    for (const s of [-1, 1]) {
      k.add(box(0.5, 0.26, 0.1, s * 0.55, 0.62, 2.2), '#fff6d8', { glow: 2.4 });
      k.add(box(0.5, 0.2, 0.1, s * 0.55, 0.66, -2.2), '#ff2a1c', { glow: 1.8 });
    }
    return k.build();
  },
  // a cable car's cabin: the origin is on the cable, the cabin hangs 3 m under it
  'cable-car'() {
    const k = new Kit();
    k.add(box(0.5, 0.3, 1.2, 0, -0.15, 0), DARK);
    k.add(box(0.16, 2.2, 0.16, 0, -2.3, 0), DARK);
    k.add(box(2.2, 2.3, 3.0, 0, -4.7, 0), '#e23a2e', { tint: 1 });
    k.add(box(2.3, 0.3, 3.2, 0, -2.45, 0), '#f4f1e8');
    for (const s of [-1, 1]) k.add(box(0.06, 0.95, 2.5, s * 1.12, -3.75, 0), '#cfeeff', { glow: 0.5 });
    k.add(box(1.8, 0.95, 0.06, 0, -3.75, 1.52), '#cfeeff', { glow: 0.5 });
    k.add(box(1.8, 0.95, 0.06, 0, -3.75, -1.52), '#cfeeff', { glow: 0.5 });
    return k.build();
  },
  // a snow groomer, 5.5 m: red cab, wide tracks, the blade ahead, an amber beacon
  groomer() {
    const k = new Kit();
    for (const s of [-1, 1]) k.add(box(1.1, 0.9, 5.0, s * 1.35, 0, 0), '#1c1f24');
    k.add(box(2.4, 1.0, 3.6, 0, 0.7, -0.3), '#d92a22', { tint: 1 });
    k.add(box(2.1, 1.1, 1.8, 0, 1.7, 0.3), '#d92a22', { tint: 1 });
    k.add(box(1.9, 0.7, 0.08, 0, 1.95, 1.22), '#cfeeff', { glow: 0.35 });
    k.add(at(box(4.4, 1.0, 0.3), 0, 0.1, 3.1, 0.25), STEEL);
    k.add(box(4.6, 0.25, 0.9, 0, 0.05, -3.2), STEEL);
    k.add(cyl(0.16, 0.16, 0.3, 6, 0, 2.8, 0.3), '#ffb020', { glow: 3 });
    for (const s of [-1, 1]) k.add(box(0.3, 0.22, 0.08, s * 0.8, 1.35, 1.52), '#fff6d8', { glow: 2.2 });
    return k.build();
  },
  // a camel with its rider, 2.3 m at the hump: the blanket takes the copy's colour
  camel() {
    const k = new Kit(), tan = '#c9a063', dk = '#a8834c';
    k.add(at(ball(0.62, 1), 0, 1.55, 0, 0, 0, 0, 0.8, 0.85, 1.6), tan);
    k.add(at(ball(0.42, 1), 0, 2.1, -0.1, 0, 0, 0, 0.8, 1, 1), tan);
    k.add(at(cyl(0.16, 0.22, 1.1, 6), 0, 1.6, 0.85, 0.6), tan);
    k.add(at(ball(0.24, 0), 0, 2.62, 1.55, 0, 0, 0, 0.8, 0.8, 1.5), tan);
    for (const [x, z] of [[-0.25, 0.65], [0.25, 0.65], [-0.25, -0.7], [0.25, -0.7]]) k.add(cyl(0.09, 0.08, 1.25, 5, x, 0, z), dk);
    k.add(box(0.95, 0.5, 0.9, 0, 1.75, -0.1), '#c0392b', { tint: 1 });
    k.add(box(0.4, 0.75, 0.3, 0, 2.3, -0.15), '#f1ead8');         // the rider
    k.add(ball(0.17, 0, 0, 3.2, -0.15), '#3b2a20');
    return k.build();
  },
  // a hot-air balloon, 20 m: striped, a basket, a burner that glows
  balloon() {
    const k = new Kit();
    const env = new THREE.SphereGeometry(7, 12, 8).scale(1, 1.18, 1).translate(0, 12.2, 0).toNonIndexed();
    // alternate gores take the copy's colour
    const pos = env.attributes.position, a = new THREE.BufferGeometry(), b = new THREE.BufferGeometry();
    const pa = [], pb = [];
    for (let i = 0; i < pos.count; i += 3) {
      const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      const gore = Math.floor(((Math.atan2(cz, cx) + PI) / (2 * PI)) * 12 + 1e-4) % 2;
      const dst = gore ? pa : pb;
      for (let j = 0; j < 3; j++) dst.push(pos.getX(i + j), pos.getY(i + j), pos.getZ(i + j));
    }
    a.setAttribute('position', new THREE.Float32BufferAttribute(pa, 3));
    b.setAttribute('position', new THREE.Float32BufferAttribute(pb, 3));
    k.add(a, WHITE, { tint: 1 });
    k.add(b, '#fff4d6');
    k.add(cyl(2.4, 0.9, 3.4, 12, 0, 1.6, 0), '#fff4d6');
    k.add(box(1.5, 1.2, 1.5, 0, -1.4, 0), WOOD);
    k.add(box(0.5, 0.5, 0.5, 0, 0.5, 0), '#ffb040', { glow: 3 });
    for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) k.add(at(cyl(0.03, 0.03, 2.2, 3), x, -0.3, z), DARK);
    return k.build();
  },
  // an airship, 44 m, nose to +z: the layer hangs its scrolling sign on the flanks
  airship() {
    const k = new Kit();
    k.add(new THREE.SphereGeometry(6, 14, 10).scale(1, 1, 3.6), '#e9edf2', { tint: 1 });
    k.add(new THREE.SphereGeometry(6.06, 14, 4, 0, PI * 2, PI * 0.42, PI * 0.16).scale(1, 1, 3.6), '#e2392e');
    for (const r of [0, PI / 2, PI, -PI / 2]) k.add(at(new THREE.BoxGeometry(0.3, 5.2, 6.5).translate(0, 5.4, -17.5), 0, 0, 0, 0, 0, r), '#e2392e');
    k.add(box(2.6, 2.0, 8, 0, -8.0, 2), '#3a4150');
    for (const s of [-1, 1]) k.add(box(0.06, 0.8, 6.4, s * 1.32, -7.2, 2), '#fff0b8', { glow: 1.6 });
    k.add(ball(0.5, 0, 0, -8.4, 6.4), '#fff6d8', { glow: 3 });
    k.add(ball(0.35, 0, 0, 6.2, -6), '#ff3020', { glow: 3 });
    return k.build();
  },
  // ---------------------------------------------------------------- creatures
  // a bird, wingspan 1 m (the layer scales it to its species): the wings beat by the vertex
  bird() {
    const k = new Kit();
    const beat = (x) => Math.abs(x) * 0.62;
    k.add(at(ball(0.11, 0), 0, 0, 0.02, 0, 0, 0, 0.9, 0.8, 2.3), WHITE, { tint: 1 });
    k.add(at(cone(0.035, 0.14, 4), 0, 0, 0.32, PI / 2), '#f0a020');
    k.add(tri([0, 0.02, -0.2], [-0.09, 0.02, -0.42], [0.09, 0.02, -0.42]), WHITE, { tint: 1 });
    for (const s of [-1, 1]) {
      k.add(tri([s * 0.05, 0.03, 0.14], [s * 0.05, 0.03, -0.12], [s * 0.5, 0.03, -0.08]), WHITE, { tint: 1, flap: beat, rate: 11 });
      k.add(tri([s * 0.05, 0.03, 0.14], [s * 0.5, 0.03, -0.08], [s * 0.3, 0.03, 0.12]), WHITE, { tint: 1, flap: beat, rate: 11 });
    }
    return k.build();
  },
  // a fish in the air, 0.55 m, nose to +z
  fish() {
    const k = new Kit();
    k.add(at(ball(0.13, 0), 0, 0, 0.04, 0, 0, 0, 0.55, 1, 2.1), '#c9d6e2', { tint: 1 });
    k.add(tri([0, 0, -0.2], [0, 0.14, -0.4], [0, -0.14, -0.4]), '#c9d6e2', { tint: 1 });
    k.add(tri([0, 0.1, 0.06], [0, 0.22, -0.08], [0, 0.1, -0.12]), '#93a4b6');
    return k.build();
  },
  // a koi seen from above, 0.7 m, lying in the plane of the water
  koi() {
    const k = new Kit();
    k.add(at(ball(0.13, 0), 0, 0, 0.05, 0, 0, 0, 1, 0.35, 2.4), '#ff7a1a', { tint: 1 });
    k.add(tri([0, 0.01, -0.24], [-0.14, 0.01, -0.46], [0.14, 0.01, -0.46]), '#ffe9d6', { flap: (x, y, z) => (z < -0.3 ? 0.0 : 0), rate: 4 });
    k.add(tri([-0.1, 0.02, 0.1], [-0.24, 0.02, 0.0], [-0.1, 0.02, -0.02]), '#ffe9d6');
    k.add(tri([0.1, 0.02, 0.1], [0.24, 0.02, 0.0], [0.1, 0.02, -0.02]), '#ffe9d6');
    return k.build();
  },
  dolphin() {
    const k = new Kit(), g = '#6f8497';
    k.add(at(ball(0.34, 1), 0, 0, 0, 0, 0, 0, 0.8, 0.85, 3.2), g);
    k.add(at(cone(0.12, 0.5, 5), 0, -0.02, 1.25, PI / 2), g);
    k.add(tri([0, 0.24, 0.1], [0, 0.62, -0.25], [0, 0.24, -0.4]), '#56697a');
    k.add(tri([0, 0, -1.0], [-0.42, 0.02, -1.45], [0.42, 0.02, -1.45]), '#56697a');
    return k.build();
  },
  // a whale's flukes rising out of the sea: the origin is the waterline
  whale() {
    const k = new Kit(), g = '#3d4b5c';
    k.add(at(cyl(0.35, 0.9, 3.6, 7), 0, -1.2, 0, 0.12), g);
    k.add(tri([0, 2.3, 0.1], [-2.3, 3.3, -0.5], [-0.3, 2.9, 0.1]), g);
    k.add(tri([0, 2.3, 0.1], [2.3, 3.3, -0.5], [0.3, 2.9, 0.1]), g);
    k.add(tri([0, 2.3, 0.1], [-2.3, 3.3, -0.5], [-1.9, 2.5, -0.3]), '#33404f');
    k.add(tri([0, 2.3, 0.1], [2.3, 3.3, -0.5], [1.9, 2.5, -0.3]), '#33404f');
    return k.build();
  },
  turtle() {
    const k = new Kit();
    k.add(at(new THREE.SphereGeometry(0.5, 8, 4, 0, PI * 2, 0, PI / 2), 0, 0.08, 0, 0, 0, 0, 1, 0.62, 1.2), '#4f7a3a');
    k.add(at(cyl(0.52, 0.56, 0.1, 8), 0, 0.02, 0, 0, 0, 0, 1, 1, 1.2), '#8a9a4a');
    k.add(at(ball(0.14, 0), 0, 0.2, 0.72, 0, 0, 0, 1, 0.9, 1.3), '#8a9a4a');
    for (const [x, z] of [[-0.5, 0.36], [0.5, 0.36], [-0.46, -0.4], [0.46, -0.4]]) k.add(at(box(0.3, 0.07, 0.2), x, 0.02, z), '#8a9a4a');
    return k.build();
  },
  // a crocodile, 4.2 m, lying in the water to its eyes: it lunges when a ball splashes by
  croc() {
    const k = new Kit(), g = '#4d6b34', d = '#3a5228';
    k.add(at(box(0.9, 0.34, 2.4), 0, 0, -0.4), g);
    k.add(at(box(0.55, 0.26, 1.3), 0, 0.02, 1.4), g);
    k.add(at(box(0.5, 0.1, 1.2), 0, -0.14, 1.45), '#e9e2c0');
    k.add(at(cone(0.3, 1.9, 5), 0, 0.1, -2.5, -PI / 2), d);
    for (let i = 0; i < 6; i++) k.add(at(cone(0.09, 0.2, 4), 0, 0.34, -1.3 + i * 0.36), d);
    for (const s of [-1, 1]) k.add(ball(0.09, 0, s * 0.2, 0.34, 0.86), '#f2d23a', { glow: 0.5 });
    return k.build();
  },
  // a spectator on foot, 1.8 m: the shirt takes the copy's colour
  walker() {
    const k = new Kit();
    k.add(box(0.36, 0.82, 0.24, 0, 0, 0), '#2c3340');
    k.add(box(0.46, 0.66, 0.28, 0, 0.82, 0), WHITE, { tint: 1 });
    k.add(ball(0.17, 0, 0, 1.66, 0), '#e2b48c');
    k.add(box(0.36, 0.08, 0.38, 0, 1.76, 0.03), '#f4f1e8');
    return k.build();
  },
  // ---------------------------------------------------------------- set pieces
  // a windmill's tower, 11 m to the hub, cap to +z: the rotor is its own model
  'windmill-tower'() {
    const k = new Kit();
    k.add(cyl(1.5, 2.6, 10, 8), WHITE);
    k.add(at(cone(1.9, 2.4, 8), 0, 10, 0), '#c0392b');
    k.add(at(cyl(0.3, 0.3, 1.6, 6), 0, 10.6, 1.3, PI / 2), DARK);
    k.add(box(0.9, 1.6, 0.1, 0, 0, 2.58), WOOD);
    for (const y of [4.2, 7.2]) k.add(box(0.6, 0.8, 0.1, 0, y, 2.6 - y * 0.11), '#3a4150');
    return k.build();
  },
  // ... turning about its own z axis through the origin: four lattice sails, 8 m long
  'windmill-rotor'() {
    const k = new Kit();
    k.add(at(cyl(0.4, 0.4, 0.5, 6), 0, 0, 0, PI / 2), DARK);
    for (let i = 0; i < 4; i++) {
      const r = (i * PI) / 2;
      k.add(at(box(0.22, 8.2, 0.14), 0, 0, 0.1, 0, 0, r), WOOD);
      k.add(at(box(1.5, 6.0, 0.06, 0.82, 1.9, 0.06), 0, 0, 0, 0, 0, r), '#f4ecd8');
    }
    return k.build();
  },
  // a windsock's pole, 7 m; the sock is its own model, mouth at the origin, tail to +z
  'windsock-pole'() {
    const k = new Kit();
    k.add(cyl(0.07, 0.1, 7, 6), '#d8dde2');
    return k.build();
  },
  windsock() {
    const k = new Kit();
    const sock = at(new THREE.CylinderGeometry(0.42, 0.16, 2.6, 8, 4, true), 0, 0, 1.3, PI / 2).toNonIndexed();
    // orange and white hoops, by where along the sock a face is
    const pos = sock.attributes.position, a = [], b = [];
    for (let i = 0; i < pos.count; i += 3) {
      const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      const dst = Math.floor(cz / 0.65) % 2 ? b : a;
      for (let j = 0; j < 3; j++) dst.push(pos.getX(i + j), pos.getY(i + j), pos.getZ(i + j));
    }
    const ga = new THREE.BufferGeometry(), gb = new THREE.BufferGeometry();
    ga.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
    gb.setAttribute('position', new THREE.Float32BufferAttribute(b, 3));
    const wag = (x, y, z) => z * 0.06;
    k.add(ga, '#ff6a1a', { flap: wag, rate: 7 });
    k.add(gb, WHITE, { flap: wag, rate: 7 });
    return k.build();
  },
  // one flag of a string of pennants: it hangs from the origin, 0.8 m, its point flutters
  pennant() {
    const k = new Kit();
    k.add(tri([-0.36, 0, 0], [0.36, 0, 0], [0, -0.85, 0]), WHITE, { tint: 1, flap: (x, y) => (y < -0.4 ? 0.07 : 0), rate: 8 });
    return k.build();
  },
  // a cable car's pylon, 1 m tall as built (the layer stretches it to the cable)
  pylon() {
    const k = new Kit();
    k.add(cyl(0.22, 0.5, 1, 4), STEEL);
    k.add(box(5.4, 0.05, 0.3, 0, 0.95, 0), STEEL);
    return k.build();
  },
  // a searchlight's drum; the beam is the layer's
  searchlight() {
    const k = new Kit();
    k.add(cyl(0.9, 1.1, 0.5, 8), DARK);
    k.add(cyl(0.7, 0.5, 1.1, 8, 0, 0.5, 0), '#3a4150');
    k.add(cyl(0.66, 0.66, 0.06, 8, 0, 1.6, 0), '#dff4ff', { glow: 3 });
    return k.build();
  },
  // a snowman without its head, 2.1 m (the head is its own model, so it can fall off)
  'snowman-body'() {
    const k = new Kit();
    k.add(ball(1.0, 1, 0, 0.85, 0), '#f7fbff');
    k.add(ball(0.72, 1, 0, 2.05, 0), '#f7fbff');
    for (const y of [1.9, 2.2, 2.5]) k.add(ball(0.08, 0, 0, y, 0.7), DARK);
    for (const s of [-1, 1]) k.add(at(cyl(0.035, 0.05, 1.3, 4), s * 1.0, 2.25, 0, 0, 0, -s * 1.0), WOOD);
    k.add(at(new THREE.TorusGeometry(0.52, 0.11, 5, 10), 0, 2.72, 0, PI / 2), '#d92a22', { tint: 1 });
    return k.build();
  },
  'snowman-head'() {
    const k = new Kit();
    k.add(ball(0.5, 1, 0, 0.5, 0), '#f7fbff');
    k.add(at(cone(0.08, 0.5, 5), 0, 0.5, 0.68, PI / 2), '#ff8a1f');
    for (const s of [-1, 1]) k.add(ball(0.06, 0, s * 0.18, 0.66, 0.42), DARK);
    k.add(cyl(0.5, 0.5, 0.06, 8, 0, 0.9, 0), DARK);
    k.add(cyl(0.32, 0.32, 0.5, 8, 0, 0.94, 0), DARK);
    return k.build();
  },
  tumbleweed() {
    const k = new Kit();
    const g = new THREE.IcosahedronGeometry(0.6, 1), pos = g.attributes.position, pts = [];
    // every other face only: a ball of twigs, not a boulder
    for (let i = 0; i < pos.count; i += 6) for (let j = 0; j < 3; j++) pts.push(pos.getX(i + j), pos.getY(i + j) + 0.6, pos.getZ(i + j));
    const h = new THREE.BufferGeometry();
    h.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    k.add(h, '#7a5528');
    k.add(at(new THREE.IcosahedronGeometry(0.47, 1), 0, 0.6, 0, 0.6, 0.4, 0.2), '#5a3d1c');     // (dark: it has to read against sand)
    return k.build();
  },
  // a traffic light's pole and head, 5 m; its three lamps are the layer's (they change)
  'traffic-light'() {
    const k = new Kit();
    k.add(cyl(0.09, 0.12, 5, 5), DARK);
    k.add(box(0.5, 1.4, 0.4, 0, 4.4, 0), '#15171b');
    return k.build();
  },
  lamp() {
    const k = new Kit();
    k.add(ball(0.17, 0), WHITE, { tint: 1, glow: 3 });
    return k.build();
  },
};

export const LIFE_MODEL_KINDS = Object.freeze(Object.keys(MODELS));
// The model's geometry, built once and kept (null for a kind with no model).
const built = new Map();
export function buildLifeModel(kind) {
  if (!MODELS[kind]) return null;
  if (!built.has(kind)) built.set(kind, MODELS[kind]());
  return built.get(kind);
}

// The one material the whole cast is drawn with. uniforms.uLifeTime: seconds;
// uniforms.uLifeGlow: x the lit parts' glow (a night stage turns it up).
export function makeLifeMaterial() {
  const uniforms = { uLifeTime: { value: 0 }, uLifeGlow: { value: 1 } };
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  material.name = 'world-life';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLifeTime = uniforms.uLifeTime;
    shader.uniforms.uLifeGlow = uniforms.uLifeGlow;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aLife;
        attribute vec4 aTint;
        uniform float uLifeTime;
        varying float vLifeGlow;`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        vLifeGlow = aLife.x;
        #ifdef USE_INSTANCING
          vColor.rgb *= mix(vec3(1.0), aTint.rgb, aLife.z);
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          transformed.y += aLife.y * aTint.w * sin(uLifeTime * aLife.w + float(gl_InstanceID) * 2.399);
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uLifeGlow;
        varying float vLifeGlow;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vColor.rgb * vLifeGlow * uLifeGlow;`);
  };
  material.customProgramCacheKey = () => 'world-life-v1';
  return { material, uniforms };
}
