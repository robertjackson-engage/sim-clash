// Procedural set pieces for the arcade stages (docs/dev/arcade-v2-contract.md, "Themes and
// props"): every prop kind a hole file may place that is not a GLB, built here from
// three's primitives. Low-poly on purpose: bold silhouettes and flat saturated colour that
// read from 300 yards, not detail nobody sees from the tee.
//
// One model = ONE merged geometry with per-vertex colour, drawn by ONE shared material
// (makePropMaterial) however many kinds and copies stand on a course (props.js instances
// each kind). What would otherwise need a light or a texture is in two vertex attributes:
//
//   aFx   = (glow, glow mode, sway, bob)
//           glow: how much of its own colour the vertex gives back unlit (windows, lava
//           cracks, neon, flames); mode 0 steady, 1 slow pulse running up the model (lava),
//           2 neon flicker, 3 flame, 4 flow (bands running down a waterfall, across a screen). sway: cloth and blossom moving in the wind (model
//           units). bob: the whole model rising and falling (a balloon).
//   aSpin = (hub x, hub y, radians a second, tint mask)
//           a part turning about the model's z axis through the hub (a windmill's sails);
//           tint mask 1 = this vertex takes the copy's own colour (aInst, per instance:
//           every balloon and banner a different colour from one geometry).
//   aAnim = (kind, phase, speed, amount), aPivot = (x, y, z)
//           kind 1 orbit: the part circles the vertical axis through the pivot at `speed`
//           rad/s, and rises and falls by `amount` (a bird's wing tips; a drifting airship);
//           kind 2 burst: the part flies out from the pivot and fades on a cycle of
//           1 / speed seconds, sagging by `amount` (fireworks); kind 3 bounce: the part hops
//           by `amount` (a crowd, each spectator out of step by `phase`).
//
// All of it runs in the vertex shader off ONE shared time uniform: no JavaScript per prop
// per frame, however many stand on a stage. A copy also shrinks away to nothing past its
// own cull distance (aInst.w), so a hundred torches 400 m off cost no pixels.
//
// Nothing here needs a renderer or a DOM, so every builder is unit-tested
// (test/arcade-look.test.mjs): a finite bounding box at the size asked for.
//
// Model space: metres, +y up, the model's FRONT faces +z (south: toward a tee south of
// it at rotDeg 0), +x east. Built at its default height; props.js scales it to heightM.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PI = Math.PI;

function rng(seed) {
  let a = seed | 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const colorOf = (c) => (c instanceof THREE.Color ? c : new THREE.Color(c));

// ---- primitives. (x, y, z) is the centre of the BASE unless said otherwise.
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const cyl = (rTop, rBot, h, seg = 8, x = 0, y = 0, z = 0) => new THREE.CylinderGeometry(rTop, rBot, h, seg).translate(x, y + h / 2, z);
const cone = (r, h, seg = 8, x = 0, y = 0, z = 0) => new THREE.ConeGeometry(r, h, seg).translate(x, y + h / 2, z);
// a four-sided frustum with its faces square to the axes; a, b: half-widths at top and bottom
const frustum4 = (a, b, h, x = 0, y = 0, z = 0) => new THREE.CylinderGeometry(a * Math.SQRT2, b * Math.SQRT2, h, 4).rotateY(PI / 4).translate(x, y + h / 2, z);
// centred on (x, y, z)
const ball = (r, detail = 1, x = 0, y = 0, z = 0) => new THREE.IcosahedronGeometry(r, detail).translate(x, y, z);
// a geometry made about the origin, turned (x then y then z) and moved
const place = (g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
  if (sx !== 1 || sy !== 1 || sz !== 1) g.scale(sx, sy, sz);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  return g.translate(x, y, z);
};
// a triangular prism: the triangle (in x, y) pushed `depth` along z, centred on z = 0
const prism = (pts, depth) => {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }).translate(0, 0, -depth / 2);
};

// ---- the kit: collects coloured parts, merges them into the one geometry
class Kit {
  constructor() { this.parts = []; }

  // A geometry in one colour. fx: { glow, mode, sway, bob, tint, spin: [hubX, hubY, speed],
  // anim: { kind: 'orbit' | 'burst' | 'bounce', pivot: [x, y, z], phase, speed, amount } }.
  // sway, and an anim's phase and amount, may be functions (x, y, z) -> number (cloth pinned
  // along one edge, a wing that flaps at its tip).
  add(geo, color, fx = {}) {
    if (this.all) fx = { ...this.all, ...fx };   // what every part of this model does (a cloud drifting)
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.attributes.position, n = pos.count;
    const c = colorOf(color);
    const col = new Float32Array(n * 3), afx = new Float32Array(n * 4), spin = new Float32Array(n * 4);
    const anim = new Float32Array(n * 4), pivot = new Float32Array(n * 3);
    const sp = fx.spin || [0, 0, 0], an = fx.anim || null, pv = an?.pivot || [0, 0, 0];
    const val = (v, i) => (typeof v === 'function' ? v(pos.getX(i), pos.getY(i), pos.getZ(i)) : (v || 0));
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      afx[i * 4] = fx.glow || 0;
      afx[i * 4 + 1] = fx.mode || 0;
      afx[i * 4 + 2] = val(fx.sway, i);
      afx[i * 4 + 3] = fx.bob || 0;
      spin[i * 4] = sp[0]; spin[i * 4 + 1] = sp[1]; spin[i * 4 + 2] = sp[2]; spin[i * 4 + 3] = fx.tint ? 1 : 0;
      if (an) {
        anim[i * 4] = ANIM[an.kind] || 0; anim[i * 4 + 1] = val(an.phase, i); anim[i * 4 + 2] = an.speed ?? 1; anim[i * 4 + 3] = val(an.amount, i);
        pivot[i * 3] = pv[0]; pivot[i * 3 + 1] = pv[1]; pivot[i * 3 + 2] = pv[2];
      }
    }
    return this._push(g, col, afx, spin, anim, pivot);
  }

  // A geometry coloured face by face (a wall of lit windows, a screen). pick(face) gets
  // { x, y, z (the quad's centre), nx, ny, nz (its normal), i (its index) } and returns
  // { color, glow, mode, tint }. quad: vertices per face (6 = the two triangles of a box cell).
  addFaces(geo, pick, { quad = 6, bob = this.all?.bob || 0, anim: an = this.all?.anim || null } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.attributes.position, n = pos.count;
    const col = new Float32Array(n * 3), afx = new Float32Array(n * 4), spin = new Float32Array(n * 4);
    const anim = new Float32Array(n * 4), pivot = new Float32Array(n * 3);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3();
    for (let f = 0; f * quad < n; f++) {
      const o = f * quad;
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < quad; k++) { cx += pos.getX(o + k); cy += pos.getY(o + k); cz += pos.getZ(o + k); }
      a.fromBufferAttribute(pos, o); b.fromBufferAttribute(pos, o + 1); c.fromBufferAttribute(pos, o + 2);
      nrm.subVectors(b, a).cross(c.sub(a)).normalize();
      const p = pick({ x: cx / quad, y: cy / quad, z: cz / quad, nx: nrm.x, ny: nrm.y, nz: nrm.z, i: f }) || {};
      const cc = colorOf(p.color ?? '#ffffff');
      for (let k = 0; k < quad; k++) {
        const i = o + k;
        col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
        afx[i * 4] = p.glow || 0; afx[i * 4 + 1] = p.mode || 0; afx[i * 4 + 3] = bob;
        spin[i * 4 + 3] = p.tint ? 1 : 0;
        if (an) {
          anim[i * 4] = ANIM[an.kind] || 0; anim[i * 4 + 1] = an.phase || 0; anim[i * 4 + 2] = an.speed ?? 1; anim[i * 4 + 3] = an.amount || 0;
          pivot[i * 3] = an.pivot?.[0] || 0; pivot[i * 3 + 1] = an.pivot?.[1] || 0; pivot[i * 3 + 2] = an.pivot?.[2] || 0;
        }
      }
    }
    return this._push(g, col, afx, spin, anim, pivot);
  }

  _push(g, col, afx, spin, anim, pivot) {
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aFx', new THREE.BufferAttribute(afx, 4));
    g.setAttribute('aSpin', new THREE.BufferAttribute(spin, 4));
    g.setAttribute('aAnim', new THREE.BufferAttribute(anim, 4));
    g.setAttribute('aPivot', new THREE.BufferAttribute(pivot, 3));
    g.morphAttributes = {};
    this.parts.push(g);
    return g;
  }

  // Everything added inside fn is turned and moved together (a wreck heeled over). An
  // animation's pivot moves with its part; a spinning part's hub is given in model space
  // and does not (see the windmill).
  group(matrix, fn) {
    const from = this.parts.length;
    fn();
    for (let i = from; i < this.parts.length; i++) {
      const g = this.parts[i];
      g.applyMatrix4(matrix);
      g.attributes.aPivot.applyMatrix4(matrix);
    }
  }

  merge() {
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}
// aAnim.x: how a part moves (the vertex shader in makePropMaterial)
const ANIM = Object.freeze({ orbit: 1, burst: 2, bounce: 3 });

// ---- shared palette
const STONE = '#9a9a94', STONE_DARK = '#7c7c78', WOOD = '#8a5a34', WOOD_DARK = '#4a3028', INK = '#1c1c22';
const SNOW = '#f4f9ff', GOLD = '#ffd84a', WARM = '#ffd27a', RED = '#e8372a';
const NEON_PINK = '#ff3df2', NEON_CYAN = '#3df2ff', NEON_YELLOW = '#ffe81f';
// what a copy of a tinted kind is coloured (props.js picks one per copy)
const BOLD = Object.freeze(['#ff3b30', '#ffd21f', '#2f7bff', '#ff4fd8', '#34c759', '#ff9f0a']);
const GEMS = Object.freeze(['#ff3df2', '#3df2ff', '#9d5cff', '#5cff9d', '#ffe81f']);

// a cliff of hexagonal columns with a gap in the middle for a fall: [x, z, radius, height]
const FALL_COLUMNS = Object.freeze([[-14.5, 1.5, 3.2, 9], [-11.5, -1.5, 3.6, 17], [-8.2, -3, 3.8, 24], [-5.2, -3.6, 3.4, 28.5], [-6.2, 0.6, 2.4, 19],
  [5.4, -3.8, 3.6, 30], [6.4, 0.4, 2.5, 21], [8.6, -3, 3.9, 25.5], [12, -1.2, 3.5, 15.5], [15, 2, 3.0, 8], [0, -6.6, 4.4, 27], [0, -3.4, 3.2, 26.4]]);

// a hexagonal crystal: a body and a point, leaning
function shard(k, r, bodyH, tipH, color, fx, x, z, lean = 0, turn = 0) {
  const m = new THREE.Matrix4().makeRotationY(turn).multiply(new THREE.Matrix4().makeRotationZ(lean));
  m.setPosition(x, 0, z);
  k.group(m, () => {
    k.add(cyl(r, r * 0.72, bodyH, 6, 0, -0.4, 0), color, fx);
    k.add(cone(r, tipH, 6, 0, bodyH - 0.4, 0), color, fx);
  });
}

// ---------------------------------------------------------------- the models
// Each: h (default height, m: what heightM replaces), build(kit), and optionally
//   shadow: false   too small to be worth a place in the shadow map
//   measure: 'length' | 'diameter'   what heightM means when it is not the height
//   baseY           the model height that stands on the ground (default: the box's bottom)
//   foot(kit)       a foundation below y = 0, added after the model is measured: it hides
//                   the gap under the downhill side when the model stands on a slope (a
//                   grandstand on a bank) and is simply buried on level ground
//   tints           colours handed out to its copies (its tint-masked parts take them)
//   roam: true      its motion carries it outside its own box (it circles or drifts)
const MODELS = {
  cactus: {
    h: 6, shadow: true,
    foot(k) { k.add(cyl(0.64, 0.66, 1.2, 8, 0, -1.2, 0), '#358a40'); },
    build(k) {
      const g = '#3f9b4a', d = '#358a40';
      k.add(cyl(0.55, 0.64, 5.2, 8), g);
      k.add(ball(0.56, 1, 0, 5.2, 0), g);
      // left arm
      k.add(place(new THREE.CylinderGeometry(0.32, 0.32, 0.9, 7), -0.85, 2.4, 0, 0, 0, PI / 2), d);
      k.add(ball(0.36, 1, -1.25, 2.4, 0), d);
      k.add(cyl(0.3, 0.33, 1.9, 7, -1.25, 2.4, 0), d);
      k.add(ball(0.31, 1, -1.25, 4.3, 0), d);
      // right arm, higher and shorter
      k.add(place(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 7), 0.8, 3.1, 0, 0, 0, PI / 2), d);
      k.add(ball(0.34, 1, 1.15, 3.1, 0), d);
      k.add(cyl(0.28, 0.31, 1.35, 7, 1.15, 3.1, 0), d);
      k.add(ball(0.29, 1, 1.15, 4.45, 0), d);
      k.add(ball(0.24, 0, 0, 5.82, 0), '#ff5fa2');   // a flower on top
    },
  },

  mesa: {
    h: 40, shadow: true,
    foot(k) { k.add(place(new THREE.CylinderGeometry(37, 38, 9, 9), -0.6, -4.5, 0.7, 0, 0, 0, 1.3, 1, 1), '#a84a2a'); k.add(cyl(6.4, 6.6, 8, 7, 40, -8, 6), '#b5532e'); k.add(cyl(4.4, 4.6, 8, 6, 49, -8, -3), '#a84a2a'); },
    build(k) {
      const layers = [
        [26, 37, 8, '#b5532e'], [24.5, 26, 11, '#c8663a'], [25.6, 25.2, 2.6, '#e09a58'],
        [22.5, 24.6, 13, '#bd5a30'], [21.5, 22.5, 5.4, '#d9864a'],
      ];
      let y = 0;
      layers.forEach(([a, b, h, c], i) => {
        k.add(place(new THREE.CylinderGeometry(a, b, h, 9), (i % 2 ? 0.8 : -0.6), y + h / 2, (i % 2 ? -0.5 : 0.7), 0, i * 0.37, 0, 1.3, 1, 1), c);
        y += h;
      });
      // two buttes standing off its shoulder
      k.add(cyl(4.2, 6.4, 20, 7, 40, 0, 6), '#c8663a');
      k.add(cyl(4.6, 4.4, 2.2, 7, 40, 20, 6), '#e09a58');
      k.add(cyl(2.6, 4.4, 13, 6, 49, 0, -3), '#b5532e');
      k.add(cyl(3.0, 2.8, 1.6, 6, 49, 13, -3), '#d9864a');
    },
  },

  pine: {
    h: 14, shadow: true,
    foot(k) { k.add(cyl(0.52, 0.56, 1.5, 7, 0, -1.5, 0), '#6a4630'); },
    build(k) {
      k.add(cyl(0.35, 0.52, 3, 7), '#6a4630');
      const tiers = [[3.5, 5, 2], [2.8, 4.5, 5], [2.05, 4, 8], [1.35, 3.2, 10.8]];
      tiers.forEach(([r, h, y], i) => {
        k.add(cone(r, h, 7, 0, y, 0), i % 2 ? '#2a7044' : '#2f7d4a');
        // snow lying on the top of each tier
        k.add(cone(r * 0.6, h * 0.56, 7, 0, y + h * 0.46, 0), SNOW);
      });
    },
  },

  snowman: {
    h: 3.3, shadow: false,
    build(k) {
      const w = '#f6faff';
      k.add(ball(0.85, 1, 0, 0.78, 0), w);
      k.add(ball(0.62, 1, 0, 1.85, 0), w);
      k.add(ball(0.43, 1, 0, 2.62, 0), w);
      k.add(cyl(0.48, 0.48, 0.07, 10, 0, 2.94, 0), INK);
      k.add(cyl(0.3, 0.32, 0.42, 10, 0, 2.98, 0), INK);
      k.add(cyl(0.325, 0.325, 0.1, 10, 0, 3.02, 0), RED);
      k.add(place(new THREE.ConeGeometry(0.075, 0.42, 6), 0, 2.62, 0.6, PI / 2), '#ff8a1f');   // the carrot
      for (const x of [-0.16, 0.16]) k.add(ball(0.055, 0, x, 2.75, 0.38), INK);
      for (const y of [1.65, 1.9, 2.15]) k.add(ball(0.065, 0, 0, y, 0.6 - Math.abs(y - 1.9) * 0.22), INK);
      k.add(place(new THREE.TorusGeometry(0.4, 0.1, 5, 10), 0, 2.3, 0, PI / 2), RED);        // scarf
      k.add(box(0.2, 0.55, 0.08, 0.3, 1.78, 0.42), RED);
      for (const s of [-1, 1]) k.add(place(new THREE.CylinderGeometry(0.035, 0.045, 1.1, 5), s * 0.98, 2.15, 0, 0, 0, -s * 1.05), WOOD_DARK);
    },
  },

  cabin: {
    h: 7, shadow: true,
    foot(k) { k.add(box(8.3, 3, 6.3, 0, -3, 0), STONE_DARK); },
    build(k) {
      k.add(box(8, 3.2, 6), WOOD);
      for (let i = 0; i < 4; i++) k.add(box(8.16, 0.12, 6.16, 0, 0.72 + i * 0.75, 0), '#6e4628');   // the logs' seams
      k.add(prism([[-4.7, 0], [4.7, 0], [0, 3.3]], 6.9).translate(0, 3.2, 0), '#6e3f24');
      k.add(prism([[-4.85, 0], [4.85, 0], [0, 3.4]], 6.4).translate(0, 3.42, 0), SNOW);             // snow on the roof
      k.add(box(1.0, 2.6, 1.0, 2.3, 4.2, -1.2), STONE_DARK);
      k.add(box(1.2, 0.25, 1.2, 2.3, 6.8, -1.2), SNOW);
      k.add(box(1.15, 2.05, 0.12, 0, 0, 3.02), WOOD_DARK);
      k.add(ball(0.07, 0, 0.36, 1.0, 3.12), GOLD);
      for (const x of [-2.5, 2.5]) {
        k.add(box(1.5, 1.3, 0.1, x, 1.2, 3.02), '#5a3a22');
        k.add(box(1.2, 1.0, 0.14, x, 1.35, 3.02), WARM, { glow: 2.4 });
        k.add(box(0.08, 1.0, 0.18, x, 1.35, 3.02), '#5a3a22');
      }
      for (const s of [-1, 1]) k.add(box(0.14, 1.0, 1.4, s * 4.02, 1.35, 0), WARM, { glow: 2.4 });
      k.add(box(2.6, 0.2, 1.4, 0, 0, 3.6), '#a8774a');   // the porch step
    },
  },

  'ice-spire': {
    h: 18, shadow: true,
    build(k) {
      const fx = { glow: 0.32, mode: 1 };
      shard(k, 1.7, 11.5, 6.9, '#bfeaff', fx, 0, 0, 0.04, 0);
      shard(k, 1.2, 7.6, 4.6, '#8fd4ff', fx, 2.2, 0.8, -0.26, 0.3);
      shard(k, 1.05, 6.2, 3.8, '#e6f7ff', fx, -2.1, 0.6, 0.3, -0.4);
      shard(k, 0.9, 4.6, 3.2, '#a8e0ff', fx, 0.5, 2.1, -0.38, 1.5);
      shard(k, 1.0, 5.4, 3.4, '#8fd4ff', fx, -0.8, -2.0, 0.34, 1.9);
      shard(k, 0.7, 2.8, 2.2, '#e6f7ff', fx, 3.1, -1.4, -0.5, -0.8);
      shard(k, 0.65, 2.4, 2.0, '#bfeaff', fx, -3.2, -1.0, 0.55, 0.6);
    },
  },

  // black basalt plates over a molten core: the seams between the plates are the glow
  'lava-rock': {
    h: 5, shadow: false,
    build(k) {
      const R = 3.1, r = rng(7);
      const src = new THREE.IcosahedronGeometry(R, 1);
      const p = src.attributes.position;
      const jitter = new Map();
      const pt = (i) => {
        const key = `${p.getX(i).toFixed(2)},${p.getY(i).toFixed(2)},${p.getZ(i).toFixed(2)}`;
        if (!jitter.has(key)) jitter.set(key, 0.74 + r() * 0.5);
        const j = jitter.get(key);
        const v = new THREE.Vector3(p.getX(i) * j, p.getY(i) * j * 0.82, p.getZ(i) * j);
        v.y = Math.max(v.y, -R * 0.42);   // a flat foot to stand on
        return v;
      };
      const plates = [], core = [];
      const cen = new THREE.Vector3(), nrm = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
      for (let f = 0; f < p.count; f += 3) {
        const a = pt(f), b = pt(f + 1), c = pt(f + 2);
        for (const v of [a, b, c]) core.push(v.x * 0.93, v.y * 0.93, v.z * 0.93);
        cen.copy(a).add(b).add(c).multiplyScalar(1 / 3);
        nrm.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
        for (const v of [a, b, c]) {
          const q = v.clone().lerp(cen, 0.07 + 0.1 * r()).addScaledVector(nrm, 0.1);
          plates.push(q.x, q.y, q.z);
        }
      }
      src.dispose();
      const geo = (arr) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.computeVertexNormals(); return g; };
      let i = 0;
      k.addFaces(geo(plates), () => ({ color: ['#2a2226', '#352a2c', '#231c20'][i++ % 3] }), { quad: 3 });
      k.add(geo(core), '#ff6a10', { glow: 1.2, mode: 1 });
    },
  },

  'lava-fall': {
    h: 30, shadow: true, baseY: -0.9,
    foot(k) { k.add(box(31, 7, 13, 0, -7.6, -1.5), '#241c20'); },
    build(k) {
      // a cliff of basalt columns, the tallest either side of the fall
      const r = rng(3), rock = ['#2d2428', '#3a2d30', '#241c20', '#352a2c'];
      FALL_COLUMNS.forEach(([x, z, rad, h], i) => {
        k.add(place(new THREE.CylinderGeometry(rad * 0.92, rad, h, 6), x, h / 2 - 0.9, z, (r() - 0.5) * 0.05, r() * PI, (r() - 0.5) * 0.05), rock[i % 4]);
        k.add(cyl(rad * 0.7, rad * 0.92, 0.5 + r() * 1.2, 6, x, h - 0.9, z), rock[(i + 1) % 4]);
      });
      // the fall: a wide molten sheet with a hotter core, bands of glow running down it.
      // (Glow is kept near 1.5: brighter, and the tone mapping bleaches orange to pink.)
      const lava = { glow: 1.25, mode: 1 };
      k.add(new THREE.PlaneGeometry(6.4, 26.6, 1, 22).translate(0, 13.3, -0.3), '#ff5a10', lava);
      k.add(new THREE.PlaneGeometry(2.8, 26.6, 1, 22).translate(0.3, 13.3, -0.2), '#ffb22a', { glow: 1.6, mode: 1 });
      k.add(box(6.4, 0.6, 3.6, 0, 26.2, -2.1), '#ff5a10', lava);
      // the pool it lands in, rocks round its rim
      k.add(place(new THREE.CylinderGeometry(6.4, 6.8, 0.5, 12), 0, 0.45, 3.2, 0, 0, 0, 1.35, 1, 1), '#ff4a0c', lava);
      k.add(place(new THREE.CylinderGeometry(3.2, 3.4, 0.56, 10), 0.4, 0.46, 2.6, 0, 0, 0, 1.3, 1, 1), '#ffb22a', { glow: 1.6, mode: 1 });
      for (let i = 0; i < 9; i++) {
        const a = -0.2 + (i / 8) * (PI + 0.4);
        k.add(ball(1.0 + r() * 0.9, 0, Math.cos(a) * 9.6, 0.5, 3.2 + Math.sin(a) * 6.6), i % 2 ? '#2d2428' : '#3a2d30');
      }
    },
  },

  'sakura-tree': {
    h: 9, shadow: true,
    foot(k) { k.add(cyl(0.5, 0.56, 1.5, 7, 0.32, -1.5, 0), WOOD_DARK); },
    build(k) {
      k.add(place(new THREE.CylinderGeometry(0.3, 0.46, 3.4, 7), 0.15, 1.7, 0, 0, 0, -0.1), WOOD_DARK);
      k.add(place(new THREE.CylinderGeometry(0.17, 0.26, 2.6, 6), -0.9, 4.1, 0.2, 0, 0, 0.75), WOOD_DARK);
      k.add(place(new THREE.CylinderGeometry(0.16, 0.25, 2.5, 6), 1.2, 4.2, -0.2, 0, 0, -0.8), WOOD_DARK);
      k.add(place(new THREE.CylinderGeometry(0.14, 0.22, 2.2, 6), 0.3, 4.3, 0.9, 0.7, 0, 0), WOOD_DARK);
      const blobs = [
        [0, 6.5, 0, 2.7, '#ff9ec8'], [-2.3, 5.6, 0.6, 2.0, '#ffb7d9'], [2.2, 5.9, -0.4, 2.1, '#ff86bc'],
        [0.4, 5.5, 2.1, 1.8, '#ffd0e6'], [-0.6, 5.7, -2.1, 1.9, '#ff9ec8'], [0.8, 7.6, 0.2, 1.75, '#ffb7d9'],
        [-1.6, 7.0, -0.6, 1.5, '#ffd0e6'],
      ];
      for (const [x, y, z, r, c] of blobs) k.add(place(new THREE.IcosahedronGeometry(r, 1), x, y, z, 0, x + z, 0, 1, 0.78, 1), c, { sway: 0.05 });
    },
  },

  torii: {
    h: 8.6, shadow: true,
    foot(k) { for (const s of [-1, 1]) k.add(cyl(0.68, 0.68, 2, 10, s * 3.1, -2, 0), INK); },
    build(k) {
      for (const s of [-1, 1]) {
        k.add(cyl(0.62, 0.68, 0.7, 10, s * 3.1, 0, 0), INK);
        k.add(place(new THREE.CylinderGeometry(0.4, 0.48, 7.4, 10), s * 3.02, 3.7, 0, 0, 0, s * 0.03), RED);
      }
      k.add(box(7.8, 0.5, 0.46, 0, 5.5, 0), RED);                // nuki
      k.add(box(0.8, 1.25, 0.22, 0, 5.9, 0), GOLD);              // the tablet
      k.add(box(9.2, 0.52, 0.7, 0, 7.2, 0), RED);                // shimaki
      k.add(box(9.6, 0.44, 0.95, 0, 7.72, 0), INK);              // kasagi, its ends turned up
      for (const s of [-1, 1]) k.add(place(new THREE.BoxGeometry(1.7, 0.44, 0.95), s * 5.45, 8.08, 0, 0, 0, s * 0.2), INK);
    },
  },

  pagoda: {
    h: 24, shadow: true,
    foot(k) { k.add(box(11.5, 5, 11.5, 0, -5, 0), STONE_DARK); },
    build(k) {
      k.add(box(11.5, 1, 11.5), STONE);
      let y = 1;
      const widths = [9, 7.8, 6.6, 5.4, 4.2];
      widths.forEach((w, i) => {
        k.add(box(w, 2.6, w, 0, y, 0), '#f4ecdc');
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(box(0.36, 2.6, 0.36, sx * w / 2, y, sz * w / 2), '#c8372a');
        k.add(box(w + 0.3, 0.3, w + 0.3, 0, y + 2.3, 0), '#c8372a');
        const win = { glow: 1.8 };
        k.add(box(w * 0.34, 1.3, w + 0.12, 0, y + 0.6, 0), WARM, win);
        k.add(box(w + 0.12, 1.3, w * 0.34, 0, y + 0.6, 0), WARM, win);
        y += 2.6;
        k.add(frustum4(w * 0.36, w * 0.82, 1.3, 0, y, 0), i % 2 ? '#2a5358' : '#2f5d62');
        k.add(frustum4(w * 0.86, w * 0.86, 0.16, 0, y - 0.04, 0), '#3f7a80');   // the eave
        y += 1.3;
      });
      k.add(cyl(0.14, 0.34, 3.2, 6, 0, y, 0), GOLD, { glow: 0.5 });
      for (let i = 0; i < 3; i++) k.add(cyl(0.5 - i * 0.1, 0.5 - i * 0.1, 0.14, 8, 0, y + 0.5 + i * 0.7, 0), GOLD, { glow: 0.5 });
    },
  },

  'stone-lantern': {
    h: 2.4, shadow: false,
    foot(k) { k.add(cyl(0.6, 0.6, 0.8, 6, 0, -0.8, 0), STONE_DARK); },
    build(k) {
      k.add(cyl(0.5, 0.6, 0.25, 6), STONE_DARK);
      k.add(cyl(0.18, 0.23, 0.9, 6, 0, 0.25, 0), STONE);
      k.add(cyl(0.52, 0.3, 0.2, 6, 0, 1.15, 0), STONE);
      k.add(box(0.6, 0.5, 0.6, 0, 1.35, 0), STONE_DARK);
      const flame = { glow: 2.6, mode: 3 };
      k.add(box(0.36, 0.3, 0.64, 0, 1.45, 0), '#ffcf70', flame);
      k.add(box(0.64, 0.3, 0.36, 0, 1.45, 0), '#ffcf70', flame);
      k.add(cyl(0.12, 0.78, 0.42, 6, 0, 1.85, 0), STONE);
      k.add(ball(0.13, 0, 0, 2.33, 0), STONE_DARK);
    },
  },

  // an arched footbridge, spanning along z: heightM is its LENGTH (20 m as built)
  bridge: {
    h: 20, measure: 'length', baseY: 0, shadow: true,
    build(k) {
      const L = 20, rise = 1.9, N = 10, W = 3.2;
      const yAt = (z) => 0.35 + rise * (1 - (z / (L / 2)) ** 2);
      for (let i = 0; i < N; i++) {
        const z0 = -L / 2 + (i * L) / N, z1 = z0 + L / N, zc = (z0 + z1) / 2;
        const y0 = yAt(z0), y1 = yAt(z1), len = Math.hypot(z1 - z0, y1 - y0) + 0.04, tilt = -Math.atan2(y1 - y0, z1 - z0);
        k.add(place(new THREE.BoxGeometry(W, 0.24, len), 0, (y0 + y1) / 2, zc, tilt), i % 2 ? '#a8683a' : '#9a5c32');
        for (const s of [-1, 1]) {
          k.add(place(new THREE.BoxGeometry(0.12, 0.12, len), s * (W / 2 - 0.1), (y0 + y1) / 2 + 1.05, zc, tilt), '#d8342a');
          k.add(place(new THREE.BoxGeometry(0.09, 0.09, len), s * (W / 2 - 0.1), (y0 + y1) / 2 + 0.58, zc, tilt), '#d8342a');
        }
      }
      for (let i = 0; i <= N; i++) {
        const z = -L / 2 + (i * L) / N, y = yAt(z);
        for (const s of [-1, 1]) {
          k.add(box(0.2, 1.3, 0.2, s * (W / 2 - 0.1), y, z), '#d8342a');
          if (i % 5 === 0) k.add(ball(0.2, 0, s * (W / 2 - 0.1), y + 1.42, z), GOLD);
        }
      }
      // piers down into the water, stone abutments in the banks
      for (const z of [-4.2, 4.2]) k.add(box(W - 0.4, 5.4, 0.7, 0, yAt(z) - 5.5, z), '#5a4a40');
      for (const s of [-1, 1]) k.add(box(W + 0.7, 2.4, 1.6, 0, -2.0, s * (L / 2 - 0.2)), STONE_DARK);
    },
  },

  temple: {
    h: 30, shadow: true,
    foot(k) { k.add(box(40, 7, 40, 0, -7, 0), '#6f6a5c'); k.add(box(6.6, 7, 4, 0, -7, 20.4), '#9a947e'); },
    build(k) {
      const widths = [40, 34, 28, 22, 16];
      widths.forEach((w, i) => {
        k.add(box(w, 3.6, w, 0, i * 3.6, 0), i % 2 ? '#7f7a6a' : '#8f8a78');
        k.add(box(w * 0.42, 0.22, 1.2, -w * 0.26, i * 3.6 + 3.6, w / 2 - 0.62), '#4f8a3a');   // moss on the ledges
        k.add(box(1.2, 0.22, w * 0.36, w / 2 - 0.62, i * 3.6 + 3.6, w * 0.2), '#5a9a40');
      });
      // the stair up the front
      for (let i = 0; i < 10; i++) k.add(box(6.6, 1.8 * (i + 1), 1.4, 0, 0, 21 - i * 1.4), '#b8b29a');
      // the shrine on top, its roof comb
      k.add(box(10, 6, 8, 0, 18, 0), '#9a9482');
      k.add(box(3, 4.2, 0.4, 0, 18, 4.02), '#1c1612');
      k.add(box(3.8, 0.7, 0.6, 0, 22.2, 4.05), '#b8b29a');
      k.add(box(12, 1.2, 10, 0, 24, 0), '#8f8a78');
      k.add(box(8, 4.6, 2.2, 0, 25.2, 0), '#9a9482');
      for (const x of [-2.6, 0, 2.6]) k.add(box(1.2, 1.6, 2.4, x, 26.4, 0), '#1c1612');
      // fires either side of the door
      for (const s of [-1, 1]) {
        k.add(box(1.1, 1.3, 1.1, s * 3.6, 18, 4.9), '#6f6a5c');
        k.add(cone(0.62, 1.7, 6, s * 3.6, 19.3, 4.9), '#ffa02a', { glow: 3.2, mode: 3, sway: 0.05 });
      }
    },
  },

  idol: {
    h: 10, shadow: true,
    foot(k) { k.add(box(4.4, 3, 4.4, 0, -3, 0), '#5f5a50'); },
    build(k) {
      k.add(box(4.4, 1.2, 4.4), '#6f6a5e');
      k.add(frustum4(1.75, 2.15, 7.2, 0, 1.2, 0), '#8f8a7a');
      k.add(box(3.9, 0.7, 1.0, 0, 6.3, 1.5), '#6f6a5e');            // the brow
      k.add(box(0.9, 2.3, 0.9, 0, 4.0, 1.85), '#9a9482');           // the nose
      for (const s of [-1, 1]) {
        k.add(box(1.0, 0.56, 0.3, s * 0.95, 5.66, 1.95), '#7dffb0', { glow: 3.2, mode: 1 });   // eyes that glow
        k.add(box(0.5, 2.6, 1.1, s * 2.1, 3.9, 0), '#7c7868');      // ears
      }
      k.add(box(2.1, 0.55, 0.4, 0, 2.7, 2.0), '#2a2620');           // the mouth
      for (const x of [-0.7, -0.23, 0.23, 0.7]) k.add(box(0.34, 0.36, 0.1, x, 2.8, 2.2), '#e8e2cc');
      k.add(cyl(1.6, 1.6, 1.6, 8, 0, 8.4, 0), '#a8452a');           // the topknot
      k.add(box(3.0, 0.2, 0.9, -0.4, 1.2, 1.9), '#4f8a3a');
    },
  },

  pyramid: {
    h: 60, shadow: true,
    foot(k) { k.add(frustum4(47, 47, 9, 0, -9, 0), '#c9a24e'); },
    build(k) {
      const R = 47, N = 10, hh = 5.6;
      for (let i = 0; i < N; i++) k.add(frustum4(R * (1 - (i + 1) / N) + 0.3, R * (1 - i / N), hh, 0, i * hh, 0), i % 2 ? '#dcb45c' : '#e8c26a');
      k.add(new THREE.ConeGeometry(4.9 * Math.SQRT2, 4.2, 4).rotateY(PI / 4).translate(0, N * hh + 2.1 - 0.2, 0), GOLD, { glow: 1.1 });
      // the way in
      k.add(box(7.5, 8.5, 3, 0, 0, R - 1.0), '#c9a24e');
      k.add(box(4.2, 6.2, 3.2, 0, 0, R - 0.9), '#2a1c10');
    },
  },

  obelisk: {
    h: 20, shadow: true,
    foot(k) { k.add(box(3.4, 3, 3.4, 0, -3, 0), '#a88a4e'); },
    build(k) {
      k.add(box(3.4, 1.2, 3.4), '#b89a5a');
      k.add(box(2.5, 0.8, 2.5, 0, 1.2, 0), '#c9aa66');
      k.add(frustum4(0.72, 1.0, 15.6, 0, 2, 0), '#e8c88a');
      for (const y of [5.6, 9.6, 13.6]) k.add(box(1.92 - (y - 5.6) * 0.035, 0.36, 1.92 - (y - 5.6) * 0.035, 0, y, 0), '#8a6a3a');
      k.add(new THREE.ConeGeometry(0.72 * Math.SQRT2, 2.4, 4).rotateY(PI / 4).translate(0, 18.8, 0), GOLD, { glow: 1.4 });
    },
  },

  sphinx: {
    h: 20, shadow: true,
    foot(k) { k.add(box(18, 7, 50, 0, -7, 1), '#b89858'); },
    build(k) {
      const sand = '#e0bc74', dark = '#c8a868';
      k.add(box(18, 2, 50, 0, 0, 1), dark);
      k.add(box(12, 9, 30, 0, 2, -6), sand);                        // the body
      k.add(box(14, 10.5, 9, 0, 2, -17), sand);                     // haunches
      k.add(box(11, 12, 7, 0, 2, 6), sand);                         // the chest
      for (const s of [-1, 1]) {
        k.add(box(3.4, 3.6, 17, s * 4.3, 2, 15.5), sand);           // forelegs
        k.add(box(3.9, 2.5, 3.2, s * 4.3, 2, 23.6), dark);          // paws
      }
      // the headdress in blue and gold bands, the face in front of it
      const bands = ['#2f6fd8', GOLD, '#2f6fd8', GOLD, '#2f6fd8'];
      bands.forEach((c, i) => k.add(frustum4(5.6 - (i + 1) * 0.5, 5.6 - i * 0.5, 1.8, 0, 11.2 + i * 1.8, 6.6), c));
      k.add(box(5.6, 6.0, 4.6, 0, 12.6, 9.0), '#e8c88a');
      for (const s of [-1, 1]) k.add(box(1.2, 0.5, 0.2, s * 1.4, 16.2, 11.32), INK);
      k.add(box(0.9, 1.5, 0.5, 0, 14.4, 11.4), dark);
      k.add(box(2.2, 0.36, 0.2, 0, 13.5, 11.32), '#9a6a3a');
      k.add(box(1.3, 3.2, 1.2, 0, 9.6, 11.0), '#2f6fd8');           // the beard
    },
  },

  skyscraper: {
    h: 120, shadow: true,
    foot(k) { k.add(box(26, 12, 26, 0, -12, 0), '#141a30'); },
    build(k) {
      const r = rng(11);
      const lit = ['#ffd76a', '#ffd76a', '#ffd76a', '#6fe0ff', '#ff7ae6'];
      const tower = (w, h, y, nx, ny, share) => {
        k.addFaces(new THREE.BoxGeometry(w, h, w, nx, ny, nx).translate(0, y + h / 2, 0), (f) => {
          if (Math.abs(f.ny) > 0.5) return { color: '#141a30' };
          return r() < share ? { color: lit[Math.floor(r() * lit.length)], glow: 1.3 + r() * 1.0 } : { color: r() < 0.5 ? '#1a2440' : '#222e52' };
        });
      };
      tower(26, 60, 0, 6, 20, 0.36);
      tower(20, 38, 60, 5, 13, 0.4);
      tower(14, 16, 98, 4, 6, 0.46);
      // neon up the corners and round each crown
      const trim = (w, h, y, c) => {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(box(0.7, h, 0.7, sx * w / 2, y, sz * w / 2), c, { glow: 2.4 });
        k.add(box(w + 0.9, 0.9, w + 0.9, 0, y + h - 0.2, 0), c, { glow: 2.4 });
      };
      trim(26, 60, 0, NEON_PINK);
      trim(20, 38, 60, NEON_CYAN);
      trim(14, 16, 98, NEON_PINK);
      k.add(cyl(0.3, 1.1, 5.4, 6, 0, 114, 0), '#8a909c');
      k.add(ball(0.9, 1, 0, 119.4, 0), '#ff3b30', { glow: 4.5, mode: 1 });
    },
  },

  'neon-sign': {
    h: 10, shadow: false,
    foot(k) { for (const s of [-1, 1]) k.add(cyl(0.24, 0.24, 2.5, 6, s * 2.7, -2.5, 0), '#2a2a34'); },
    build(k) {
      for (const s of [-1, 1]) k.add(cyl(0.18, 0.24, 5.3, 6, s * 2.7, 0, 0), '#2a2a34');
      k.add(box(8, 4.4, 0.36, 0, 5.2, 0), '#14142a');
      const tube = { glow: 3.4, mode: 2 };
      for (const z of [-0.24, 0.24]) {
        // the border
        k.add(box(8.2, 0.2, 0.14, 0, 5.1, z), NEON_CYAN, tube);
        k.add(box(8.2, 0.2, 0.14, 0, 9.5, z), NEON_CYAN, tube);
        for (const s of [-1, 1]) k.add(box(0.2, 4.6, 0.14, s * 4.0, 5.1, z), NEON_CYAN, tube);
        // an arrow, and a ball on a tee beside it
        k.add(box(3.3, 0.66, 0.14, 0.15, 7.07, z), NEON_PINK, tube);
        k.add(prism([[1.7, -1.25], [3.4, 0], [1.7, 1.25]], 0.14).translate(0, 7.4, z), NEON_PINK, tube);
        k.add(place(new THREE.TorusGeometry(0.72, 0.13, 5, 14), -2.6, 7.75, z), NEON_YELLOW, tube);
        k.add(box(0.16, 0.9, 0.14, -2.6, 6.0, z), NEON_YELLOW, tube);
        k.add(box(0.8, 0.16, 0.14, -2.6, 6.86, z), NEON_YELLOW, tube);
      }
      for (let i = 0; i < 9; i++) k.add(ball(0.17, 0, -3.6 + i * 0.9, 9.86, 0), NEON_YELLOW, { glow: 3.2 });
    },
  },

  billboard: {
    h: 12, shadow: true,
    foot(k) { for (const s of [-1, 1]) k.add(box(0.55, 3, 0.55, s * 4.2, -3, -0.2), '#5a5a66'); },
    build(k) {
      for (const s of [-1, 1]) k.add(box(0.55, 6.2, 0.55, s * 4.2, 0, -0.2), '#5a5a66');
      k.add(place(new THREE.BoxGeometry(9.4, 0.3, 0.3), 0, 3.2, -0.2, 0, 0, 0.62), '#5a5a66');
      k.add(box(13.6, 0.22, 1.3, 0, 5.9, 0.35), '#3a3a44');                 // the catwalk
      k.add(box(13.2, 5.7, 0.5, 0, 6.1, 0), '#f4f4f4');
      const face = (z, c) => {
        k.add(box(12.6, 5.1, 0.1, 0, 6.4, z), c);
        k.add(box(12.6, 0.9, 0.14, 0, 6.7, z), '#ffd21f');
        k.add(place(new THREE.CylinderGeometry(1.7, 1.7, 0.14, 16), -3.4, 9.3, z, PI / 2), '#ffffff');
        k.add(box(0.16, 3.4, 0.16, 2.2, 7.7, z), '#ffffff');
        k.add(prism([[2.3, 9.7], [4.9, 10.4], [2.3, 11.1]], 0.16).translate(0, 0, z), '#ffd21f');
      };
      face(0.3, '#ff3b30');
      face(-0.3, '#2f7bff');
      for (let i = 0; i < 5; i++) {
        k.add(box(0.14, 0.14, 1.5, -5.2 + i * 2.6, 11.8, 0.9), '#5a5a66');
        k.add(ball(0.26, 0, -5.2 + i * 2.6, 11.82, 1.7), '#fffbe8', { glow: 3 });
      }
    },
  },

  // a stand of seats facing +z, full of people
  grandstand: {
    h: 14, shadow: true,
    foot(k) { k.add(box(37.4, 8, 15.6, 0, -8, -0.6), '#8a90a0'); },
    build(k) {
      const W = 36, r = rng(23);
      const crowd = ['#ff3b30', '#ffd21f', '#2f7bff', '#ffffff', '#34c759', '#ff9f0a', '#ff4fd8', '#f4f4f4', '#22262e'];
      for (let i = 0; i < 9; i++) {
        const top = 1 + (i + 1) * 1.1, z = 6 - i * 1.5;
        k.add(box(W, top, 1.5, 0, 0, z), i % 2 ? '#aab0be' : '#b8bcc8');
        k.addFaces(new THREE.BoxGeometry(W - 1, 0.95, 0.55, 46, 1, 1).translate(0, top + 0.475, z - 0.2), () => {
          if (r() < 0.035) return { color: '#ffffff', glow: 3.5, mode: 2 };     // a camera flash
          return { color: crowd[Math.floor(r() * crowd.length)] };
        });
      }
      k.add(box(W, 13, 0.8, 0, 0, -7.9), '#3a4a7a');
      for (const s of [-1, 1]) k.add(box(0.7, 11.2, 14.6, s * (W / 2 + 0.35), 0, -0.6), '#2f3f6a');
      k.add(place(new THREE.BoxGeometry(W + 2.4, 0.5, 13.5), 0, 13.5, -1.4, 0.07), '#e8ecf4');   // the roof
      for (const x of [-12, 0, 12]) k.add(box(0.5, 13.2, 0.5, x, 0, -7.2), '#8a909c');
      k.add(box(W, 0.32, 0.32, 0, 12.6, 4.9), '#fffbe8', { glow: 2.8 });      // lights under the roof's edge
      // the front wall, in team colours
      k.addFaces(new THREE.BoxGeometry(W, 1.2, 0.3, 12, 1, 1).translate(0, 0.6, 6.9), (f) => ({ color: f.i % 2 ? '#ff3b30' : '#ffffff' }));
    },
  },

  floodlight: {
    h: 32, shadow: false,
    foot(k) { k.add(box(1.8, 3, 1.8, 0, -3, 0), '#5a5f6a'); },
    build(k) {
      k.add(box(1.8, 0.6, 1.8), '#5a5f6a');
      k.add(cyl(0.34, 0.7, 28, 6, 0, 0.6, 0), '#8a909c');
      k.add(box(5.6, 0.3, 0.3, 0, 26.6, 0), '#8a909c');
      // the bank of lamps, tipped down toward the pitch
      const tip = new THREE.Matrix4().makeTranslation(0, 29.4, 0.3).multiply(new THREE.Matrix4().makeRotationX(0.42));
      k.group(tip, () => {
        k.add(new THREE.BoxGeometry(7.4, 4.6, 0.6), '#3a3f4a');
        for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
          k.add(new THREE.BoxGeometry(1.35, 1.05, 0.2).translate(-2.55 + i * 1.7, -1.4 + j * 1.4, 0.36), '#fffbe8', { glow: 4.5 });
        }
      });
    },
  },

  // lies flat on the ground: heightM is its DIAMETER. props.js drapes each one over the
  // terrain (targetRingGeometry below); this is the flat one.
  'target-ring': {
    h: 20, measure: 'diameter', shadow: false, flat: true,
    build(k) { k.add(targetRingGeometry(20), '#ffffff', { glow: 0.5 }); },
  },

  // floats about 60 m up (props.js PROP_FLOAT_M), every copy a different colour
  balloon: {
    h: 22, shadow: false, tints: BOLD,
    build(k) {
      const bob = 0.5;
      const env = new THREE.SphereGeometry(7, 12, 9).scale(1, 1.14, 1).translate(0, 14.0, 0);
      const gore = (f) => (Math.floor(((Math.atan2(f.x, f.z) + PI) / (2 * PI)) * 12 + 0.0001) % 2 === 0 ? { color: '#ffffff', tint: true } : { color: '#fff6e0' });
      k.addFaces(env, gore, { quad: 3, bob });
      k.addFaces(new THREE.CylinderGeometry(4.5, 1.5, 4.6, 12, 1, true).translate(0, 6.1, 0), gore, { quad: 3, bob });
      k.add(cyl(1.6, 1.6, 0.5, 12, 0, 3.5, 0), '#ffffff', { bob, tint: true });
      k.add(box(1.9, 1.5, 1.9, 0, 0, 0), WOOD, { bob });
      k.add(box(2.1, 0.22, 2.1, 0, 1.4, 0), '#6e4628', { bob });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(place(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 4), sx * 1.1, 2.6, sz * 1.1, sz * 0.18, 0, -sx * 0.18), INK, { bob });
      k.add(cone(0.4, 1.3, 6, 0, 2.3, 0), '#ffb02a', { glow: 3.2, mode: 3, bob });
    },
  },

  // floats about 120 m up; its nose points +z
  blimp: {
    h: 18, shadow: false, tints: BOLD,
    build(k) {
      const bob = 0.4;
      const hull = new THREE.SphereGeometry(1, 16, 10).rotateX(PI / 2).scale(8, 8, 29).translate(0, 9.5, 0);
      k.addFaces(hull, (f) => {
        if (f.z > 22 || Math.abs(f.y - 9.5) < 1.7) return { color: '#ffffff', tint: true };
        return { color: '#f4f6fa' };
      }, { quad: 3, bob });
      // tail fins
      k.add(box(0.5, 7, 8, 0, 13.5, -23), '#ffffff', { bob, tint: true });
      k.add(box(0.5, 6, 8, 0, -0.5, -23), '#ffffff', { bob, tint: true });
      k.add(box(18, 0.5, 8, 0, 9.25, -23), '#ffffff', { bob, tint: true });
      // the gondola and its lit windows, an engine each side
      k.add(box(3, 2.3, 9, 0, 0, 2), '#3a3f4a', { bob });
      k.add(box(3.1, 0.8, 7.6, 0, 1.0, 2), WARM, { glow: 2, bob });
      for (const s of [-1, 1]) k.add(place(new THREE.CylinderGeometry(0.6, 0.6, 2.4, 8), s * 3.4, 2.0, -2, PI / 2), '#8a909c', { bob });
      // the screen along each flank
      for (const s of [-1, 1]) k.add(box(0.5, 3.2, 16, s * 7.98, 7.9, 1), NEON_CYAN, { glow: 2.4, mode: 2, bob });
    },
  },

  windmill: {
    h: 23, shadow: true,
    foot(k) { k.add(cyl(4.7, 4.8, 4, 8, 0, -4, 0), '#7a5c40'); },
    build(k) {
      k.add(cyl(4.5, 4.7, 1.2, 8), '#8a6a4a');
      k.add(cyl(2.2, 4.2, 13.2, 8, 0, 1.2, 0), '#f4ecdc');
      k.add(cyl(4.7, 4.7, 0.3, 8, 0, 5.2, 0), WOOD);                         // the gallery
      for (let i = 0; i < 8; i++) k.add(box(0.14, 1.0, 0.14, Math.cos((i / 8) * 2 * PI) * 4.5, 5.5, Math.sin((i / 8) * 2 * PI) * 4.5), WOOD);
      k.add(cone(2.7, 3.2, 8, 0, 14.4, 0), '#8a3a2a');                       // the cap
      k.add(box(1.3, 2.3, 0.2, 0, 1.2, 4.15), WOOD_DARK);
      for (const y of [7.5, 11]) k.add(box(0.8, 1.0, 0.2, 0, y, 2.2 + (14.4 - y) * 0.15), '#3a4a6a');
      // the sails turn about the hub
      const hubY = 14.9, spin = [0, hubY, 0.55];
      k.add(place(new THREE.CylinderGeometry(0.5, 0.5, 1.6, 8), 0, hubY, 3.1, PI / 2), WOOD_DARK, { spin });
      for (let i = 0; i < 4; i++) {
        const m = new THREE.Matrix4().makeTranslation(0, hubY, 3.7).multiply(new THREE.Matrix4().makeRotationZ((i * PI) / 2 + 0.3));
        k.group(m, () => {
          k.add(new THREE.BoxGeometry(0.3, 8.2, 0.2).translate(0, 4.1, 0), WOOD_DARK, { spin });
          k.add(new THREE.BoxGeometry(1.9, 6.4, 0.08).translate(1.05, 4.9, 0), '#f6e9c8', { spin });
          for (let j = 0; j < 4; j++) k.add(new THREE.BoxGeometry(1.9, 0.1, 0.12).translate(1.05, 2.1 + j * 1.86, 0), WOOD, { spin });
        });
      }
    },
  },

  // a wreck heeled over in the shallows
  shipwreck: {
    h: 12, shadow: true, sinkExtra: 1.4,
    build(k) {
      const heel = new THREE.Matrix4().makeRotationZ(0.26).multiply(new THREE.Matrix4().makeRotationX(-0.1));
      k.group(heel, () => {
        k.add(box(7, 5, 14, 0, 0, 0), '#6a4a34');                               // the hull amidships
        k.add(new THREE.CylinderGeometry(0.3, 4.95, 9, 4).rotateY(PI / 4).rotateX(PI / 2).scale(1, 5 / 7, 1).translate(0, 2.5, 11.5), '#5c3f2c');   // the bow
        k.add(box(7.4, 7.6, 5.4, 0, 0, -9.6), '#74523a');                       // the sterncastle
        k.add(box(6.6, 0.3, 13.6, 0, 5, 0), '#8a6a44');                         // the deck
        k.add(box(7.8, 0.4, 5.8, 0, 7.6, -9.6), '#8a6a44');
        for (const x of [-3.9, 3.9]) for (const z of [-7.4, -11.8]) k.add(box(0.3, 1.2, 0.3, x, 8, z), '#4a3324');
        k.add(box(0.2, 1.9, 2.8, 3.56, 1.2, -1.5), '#1c1410');                  // a hole stove in her side
        k.add(box(0.2, 1.4, 2.0, 3.56, 2.2, 3.4), '#1c1410');
        for (let i = 0; i < 5; i++) k.add(box(0.3, 3.4, 0.3, -3.7, 4.2, -4.5 + i * 2.2), '#4a3324');   // ribs standing proud
        // the mainmast, broken off and leaning, a rag of sail on its yard
        k.add(place(new THREE.CylinderGeometry(0.26, 0.36, 9.5, 6), 0.9, 9.4, 1.5, 0.12, 0, -0.2), '#5c3f2c');
        k.add(place(new THREE.CylinderGeometry(0.14, 0.14, 6.4, 5), 1.5, 12.0, 1.9, 0.12, 0, PI / 2 - 0.2), '#5c3f2c');
        k.add(place(new THREE.PlaneGeometry(5.4, 3.8, 5, 3), 1.2, 9.9, 2.0, 0.12, 0, -0.2), '#e8dcc0', { sway: 0.16 });
        k.add(cyl(0.3, 0.36, 2.8, 6, 0, 7.6, -9.4), '#5c3f2c');                 // a stump aft
        k.add(place(new THREE.CylinderGeometry(0.14, 0.2, 6, 5), 0, 4.6, 17.6, 1.25), '#5c3f2c');   // the bowsprit
      });
    },
  },

  // every cluster a different colour
  crystal: {
    h: 6, shadow: false, tints: GEMS,
    build(k) {
      k.add(place(new THREE.IcosahedronGeometry(1.5, 0), 0, 0.2, 0, 0, 0.4, 0, 1.25, 0.42, 1.1), '#3a3440');
      const fx = { glow: 1.5, mode: 1, tint: true };
      shard(k, 0.62, 3.6, 2.5, '#ffffff', fx, 0, 0, 0.05, 0);
      shard(k, 0.46, 2.4, 1.7, '#e8e8ff', fx, 0.8, 0.3, -0.42, 0.2);
      shard(k, 0.42, 2.0, 1.5, '#ffffff', fx, -0.75, 0.25, 0.46, -0.3);
      shard(k, 0.36, 1.6, 1.3, '#d8d8ff', fx, 0.2, 0.8, -0.5, 1.6);
      shard(k, 0.4, 1.8, 1.3, '#e8e8ff', fx, -0.3, -0.8, 0.5, 1.8);
      shard(k, 0.28, 1.0, 1.0, '#ffffff', fx, 1.15, -0.5, -0.75, -0.7);
    },
  },

  torch: {
    h: 3.6, shadow: false,
    foot(k) { k.add(cyl(0.09, 0.09, 0.8, 6, 0, -0.8, 0), '#c8a25a'); },
    build(k) {
      k.add(cyl(0.07, 0.09, 2.7, 6), '#c8a25a');
      for (const y of [0.7, 1.4, 2.1]) k.add(cyl(0.1, 0.1, 0.07, 6, 0, y, 0), '#8a6a34');
      k.add(cyl(0.3, 0.13, 0.36, 8, 0, 2.6, 0), '#3a2a20');
      k.add(cone(0.25, 0.8, 7, 0, 2.86, 0), '#ff8a1f', { glow: 3.4, mode: 3, sway: 0.035 });
      k.add(cone(0.14, 0.52, 6, 0, 2.9, 0), '#ffe27a', { glow: 4.4, mode: 3, sway: 0.035 });
    },
  },

  // a feather banner on a pole, every copy a different colour
  'flag-banner': {
    h: 8, shadow: false, tints: BOLD,
    foot(k) { k.add(cyl(0.36, 0.36, 0.8, 8, 0, -0.8, 0), '#5a5f6a'); },
    build(k) {
      k.add(cyl(0.3, 0.36, 0.2, 8), '#5a5f6a');
      k.add(cyl(0.06, 0.09, 7.9, 6), '#e8e8ee');
      k.add(ball(0.13, 0, 0, 7.96, 0), GOLD);
      const cloth = new THREE.PlaneGeometry(1.6, 5.8, 3, 10).translate(0.86, 4.8, 0);
      k.add(cloth, '#ffffff', { tint: true, sway: (x) => 0.22 * Math.max(0, (x - 0.06) / 1.6) });
      k.add(new THREE.PlaneGeometry(1.6, 0.5, 3, 1).translate(0.86, 6.9, 0.01), '#ffffff', { sway: (x) => 0.22 * Math.max(0, (x - 0.06) / 1.6) });
    },
  },

  // ------------------------------------------------------------ the second wave: set pieces and life

  waterfall: {
    h: 30, shadow: true, baseY: -0.9,
    foot(k) { k.add(box(31, 7, 13, 0, -7.6, -1.5), '#5a5248'); },
    build(k) {
      const r = rng(5), rock = ['#7a6f62', '#8a7d6c', '#6a6056', '#958874'];
      FALL_COLUMNS.forEach(([x, z, rad, h], i) => {
        k.add(place(new THREE.CylinderGeometry(rad * 0.92, rad, h, 6), x, h / 2 - 0.9, z, (r() - 0.5) * 0.05, r() * PI, (r() - 0.5) * 0.05), rock[i % 4]);
        k.add(cyl(rad * 1.02, rad * 0.95, 0.7 + r() * 0.8, 6, x, h - 0.9, z), i % 2 ? '#4f8a3a' : '#5fa644');   // grass on every top
      });
      // the fall: a sheet of water with bands running down it, white where it is thickest
      k.add(new THREE.PlaneGeometry(6.4, 26.6, 2, 26).translate(0, 13.3, -0.3), '#6fcaff', { glow: 0.5, mode: 4, sway: 0.07 });
      k.add(new THREE.PlaneGeometry(2.8, 26.6, 1, 26).translate(-0.5, 13.3, -0.2), '#e8f8ff', { glow: 0.7, mode: 4, sway: 0.05 });
      k.add(box(6.4, 0.6, 3.6, 0, 26.2, -2.1), '#6fcaff', { glow: 0.5, mode: 4 });
      // the pool, the spray where the fall lands, rocks round the rim
      k.add(place(new THREE.CylinderGeometry(6.6, 7.0, 0.5, 12), 0, 0.45, 3.2, 0, 0, 0, 1.35, 1, 1), '#3fb4e8', { glow: 0.3, mode: 4 });
      for (let i = 0; i < 7; i++) {
        k.add(ball(0.9 + r() * 0.7, 1, -3 + i, 0.9, 0.6 + r() * 1.2), '#ffffff', { glow: 0.5, anim: { kind: 'bounce', phase: i * 1.3, speed: 3.2, amount: 0.5 } });
      }
      for (let i = 0; i < 9; i++) {
        const a = -0.2 + (i / 8) * (PI + 0.4);
        k.add(ball(1.0 + r() * 0.9, 0, Math.cos(a) * 9.8, 0.5, 3.2 + Math.sin(a) * 6.8), i % 2 ? '#7a6f62' : '#6a6056');
      }
    },
  },

  castle: {
    h: 30, shadow: true,
    foot(k) { k.add(box(27, 7, 21, 0, -7, 0), '#8a867c'); for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(cyl(3.6, 3.6, 7, 10, sx * 13, -7, sz * 10), '#8a867c'); },
    build(k) {
      const stone = '#c2beb2', dark = '#a29e92', roof = '#c8372a';
      k.add(box(26, 9, 20), stone);
      for (let i = 0; i < 11; i++) for (const z of [-10, 10]) k.add(box(1.3, 1.3, 1.0, -12 + i * 2.4, 9, z), dark);
      for (let i = 0; i < 8; i++) for (const x of [-13, 13]) k.add(box(1.0, 1.3, 1.3, x, 9, -8.4 + i * 2.4), dark);
      // a tower on every corner, a flag on every roof
      let n = 0;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const x = sx * 13, z = sz * 10;
        k.add(cyl(3.4, 3.6, 15, 10, x, 0, z), stone);
        k.add(cyl(4.0, 3.7, 1.4, 10, x, 15, z), dark);
        k.add(cone(4.3, 6.2, 10, x, 16.4, z), n % 2 ? '#2f6fd8' : roof);
        k.add(cyl(0.07, 0.07, 3, 5, x, 22.4, z), INK);
        k.add(new THREE.PlaneGeometry(2.2, 1.2, 3, 1).translate(x + 1.15, 24.7, z), '#ffffff', { tint: true, sway: (px) => 0.2 * Math.max(0, px - x) });
        k.add(box(0.7, 1.5, 0.3, x, 9.5, z + sz * 3.5), WARM, { glow: 2.2 });
        n++;
      }
      // the keep
      k.add(box(11, 20, 10, 0, 0, -2), dark);
      k.add(box(12.4, 1.5, 11.4, 0, 20, -2), stone);
      for (let i = 0; i < 5; i++) k.add(box(1.3, 1.2, 1.0, -5 + i * 2.5, 21.5, 3.4), dark);
      k.add(frustum4(0.4, 5.6, 6.6, 0, 21.5, -2), roof);
      k.add(cyl(0.08, 0.08, 2.6, 5, 0, 28, -2), INK);
      k.add(new THREE.PlaneGeometry(2.6, 1.4, 3, 1).translate(1.35, 29.8, -2), '#ffffff', { tint: true, sway: (px) => 0.22 * Math.max(0, px) });
      for (const [x, y] of [[-2.6, 12], [2.6, 12], [0, 16], [-2.6, 7], [2.6, 7]]) k.add(box(1.1, 2.0, 0.3, x, y, 3.05), WARM, { glow: 2.2 });
      // the gate, its portcullis
      k.add(box(6.6, 8, 1.4, 0, 0, 10.2), dark);
      k.add(box(4.4, 6.2, 0.4, 0, 0, 10.95), '#2a1c10');
      for (let i = 0; i < 4; i++) k.add(box(0.16, 6.2, 0.1, -1.5 + i, 0, 11.2), '#5a5a66');
      for (let i = 0; i < 3; i++) k.add(box(4.4, 0.16, 0.1, 0, 1.5 + i * 1.6, 11.2), '#5a5a66');
    },
    tints: BOLD,
  },

  dragon: {
    h: 16, shadow: true,
    foot(k) { k.add(cyl(6.6, 7, 4, 8, 0, -4, 0), '#5f5a56'); },
    build(k) {
      const g1 = '#3fae4a', g2 = '#2f8a3c', belly = '#f2d46a', horn = '#f4ecdc';
      k.add(place(new THREE.IcosahedronGeometry(6, 0), 0, 1.2, -1, 0, 0.5, 0, 1.25, 0.42, 1.2), '#6f6a66');   // the rock it sits on
      // the body: from the tip of the tail, round and up through the chest to the head
      const spine = [[-3.4, 2.8, -9.0, 0.5], [-1.8, 2.9, -8.6, 0.75], [-0.2, 3.2, -7.4, 1.05], [0.9, 3.7, -5.6, 1.4], [0.8, 4.4, -3.4, 1.85],
        [0, 5.2, -1.0, 2.4], [0, 6.4, 1.3, 2.5], [0, 8.2, 2.7, 2.0], [0, 10.0, 3.4, 1.6], [0, 11.6, 4.1, 1.35]];
      spine.forEach(([x, y, z, rad], i) => {
        k.add(ball(rad, 1, x, y, z), i % 2 ? g2 : g1);
        if (i > 3) k.add(ball(rad * 0.72, 1, x, y - rad * 0.25, z + rad * 0.45), belly);
        k.add(cone(rad * 0.34, rad * 1.0, 4, x, y + rad * 0.78, z - rad * 0.2), '#ff8a1f');   // a crest down its back
      });
      // legs and claws
      for (const s of [-1, 1]) {
        k.add(ball(1.5, 1, s * 2.2, 4.2, -1.4), g2);
        k.add(cyl(0.55, 0.7, 3.2, 6, s * 2.5, 1.4, 1.6), g1);
        k.add(box(1.3, 0.6, 2.0, s * 2.5, 1.2, 2.6), g2);
        k.add(cyl(0.6, 0.75, 2.6, 6, s * 2.9, 1.4, -2.2), g1);
      }
      // the head: snout, jaw, teeth, horns, eyes that burn
      k.add(box(2.3, 1.9, 3.8, 0, 11.6, 5.4), g1);
      k.add(place(new THREE.BoxGeometry(2.0, 0.55, 3.2), 0, 11.0, 5.9, 0.22), g2);
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) k.add(cone(0.14, 0.42, 4, s * 0.8, 11.3, 5.2 + i * 0.9).rotateZ(0), horn);
        k.add(place(new THREE.ConeGeometry(0.3, 2.2, 5), s * 0.8, 14.2, 3.9, -0.7), horn);
        k.add(ball(0.33, 0, s * 1.05, 13.0, 5.6), '#ffe81f', { glow: 3.4, mode: 1 });
        k.add(ball(0.2, 0, s * 0.6, 12.6, 7.25), INK);
      }
      // fire
      k.add(place(new THREE.ConeGeometry(1.5, 6.4, 7), 0, 10.4, 10.2, -PI / 2 + 0.22), '#ff7a1a', { glow: 2.6, mode: 3, sway: 0.08 });
      k.add(place(new THREE.ConeGeometry(0.8, 4.6, 6), 0, 10.55, 9.6, -PI / 2 + 0.22), '#ffe27a', { glow: 3.4, mode: 3, sway: 0.06 });
      // wings: three panels of membrane a side, beating a little
      for (const s of [-1, 1]) {
        const sh = [s * 1.6, 8.6, 1.4], tips = [[s * 6.5, 15.6, 1.0], [s * 10.5, 12.6, -2.2], [s * 9.2, 8.4, -5.2], [s * 4.6, 6.4, -4.8]];
        const pos = [];
        for (let i = 0; i < tips.length - 1; i++) pos.push(...sh, ...tips[i], ...tips[i + 1]);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.computeVertexNormals();
        k.add(g, '#d8452a', { sway: (x) => 0.07 * Math.abs(x) });
        for (const t of tips) {
          const d = new THREE.Vector3(t[0] - sh[0], t[1] - sh[1], t[2] - sh[2]), len = d.length();
          const bone = new THREE.CylinderGeometry(0.1, 0.18, len, 4).translate(0, len / 2, 0);
          bone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())).translate(...sh);
          k.add(bone, g2, { sway: (x) => 0.07 * Math.abs(x) });
        }
      }
    },
  },

  'giant-tree': {
    h: 45, shadow: true,
    foot(k) { k.add(cyl(7, 7.4, 5, 9, 0, -5, 0), '#5c3f2c'); },
    build(k) {
      const r = rng(17), bark = '#6a4a34', barkDark = '#5c3f2c';
      k.add(cyl(4.0, 6.6, 23, 9), bark);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * 2 * PI + 0.3;
        k.add(place(new THREE.ConeGeometry(2.4, 9, 5), Math.cos(a) * 6.2, 3.6, Math.sin(a) * 6.2, Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35), barkDark);   // roots
      }
      // boughs
      const boughs = [[7, 25, 0, -0.95, 0], [-7, 26, 1, 0.95, 0], [1, 26, 7, 0, -0.9], [-1, 25, -7, 0, 0.9]];
      for (const [x, y, z, rz, rx] of boughs) k.add(place(new THREE.CylinderGeometry(1.1, 1.9, 13, 6), x, y, z, -rx, 0, rz), bark);
      // the canopy: a dozen great lobes
      const greens = ['#2f9a3a', '#3fae35', '#278a34', '#4fc040'];
      const lobes = [[0, 38, 0, 10], [10, 33, 2, 8.5], [-10, 34, 3, 8.5], [2, 33, 11, 8], [-2, 32, -11, 8], [8, 36, -7, 7.5], [-8, 37, -6, 7.5],
        [7, 37, 8, 7], [-8, 35, 9, 7], [15, 29, -3, 6], [-15, 30, -2, 6], [0, 41, 2, 6.5]];
      lobes.forEach(([x, y, z, rad], i) => k.add(place(new THREE.IcosahedronGeometry(rad, 1), x, y, z, 0, i * 0.9, 0, 1, 0.72, 1), greens[i % 4], { sway: 0.12 }));
      // vines, and lanterns hanging in them
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * 2 * PI + r() * 0.3, rad = 10 + r() * 6, len = 6 + r() * 7, top = 27 + r() * 3;
        k.add(box(0.22, len, 0.22, Math.cos(a) * rad, top - len, Math.sin(a) * rad), '#2f7d3c', { sway: 0.1 });
        if (i % 2 === 0) k.add(ball(0.6, 0, Math.cos(a) * rad, top - len - 0.5, Math.sin(a) * rad), '#ffe27a', { glow: 2.6, mode: 1, sway: 0.1 });
      }
      // a house in the boughs, its window lit
      k.add(box(5, 0.4, 5, 7.4, 21, 3.4), WOOD);
      k.add(box(4, 3, 4, 7.4, 21.4, 3.4), '#a8774a');
      k.add(cone(3.6, 2.6, 4, 7.4, 24.4, 3.4).rotateY(0), '#8a3a2a');
      k.add(box(1.4, 1.3, 0.2, 7.4, 22.2, 5.45), WARM, { glow: 2.4 });
      // a door between the roots
      k.add(box(2.2, 3.6, 0.5, 0, 0, 6.2), WOOD_DARK);
      k.add(box(0.9, 0.9, 0.3, 0, 4.6, 5.9), WARM, { glow: 2.2 });
    },
  },

  ruins: {
    h: 9, shadow: true,
    foot(k) { k.add(box(17, 4, 11, 0, -4, 0), '#9a9284'); },
    build(k) {
      const r = rng(29), marble = '#ddd5c2', worn = '#c4bca8';
      k.add(box(17, 0.5, 11), '#b4ac9c');
      k.add(box(18.4, 0.25, 12.4), '#a49c8c');
      const cols = [[-6.6, -3.4, 7.4], [-2.2, -3.4, 7.4], [2.2, -3.4, 4.6], [6.6, -3.4, 7.4], [-6.6, 3.4, 5.8], [-2.2, 3.4, 2.2], [6.6, 3.4, 3.4]];
      for (const [x, z, h] of cols) {
        k.add(box(1.9, 0.5, 1.9, x, 0.5, z), worn);
        k.add(cyl(0.72, 0.84, h, 8, x, 1.0, z), marble);
        if (h > 7) k.add(box(1.9, 0.55, 1.9, x, 1.0 + h, z), worn);
        else k.add(cyl(0.5, 0.72, 0.3, 6, x, 1.0 + h, z), worn);   // broken off
      }
      k.add(box(6.4, 1.0, 1.7, -4.4, 8.0, -3.4), marble);                      // the one lintel still up
      k.add(place(new THREE.CylinderGeometry(0.72, 0.8, 5.4, 8), 2.6, 1.25, 3.2, 0, 0.5, PI / 2), marble);   // a column lying where it fell
      k.add(place(new THREE.BoxGeometry(4.2, 1.0, 1.7), 4.6, 1.0, -0.4, 0, 0.7, 0.16), worn);
      for (let i = 0; i < 9; i++) k.add(place(new THREE.BoxGeometry(0.6 + r() * 0.9, 0.5 + r() * 0.6, 0.6 + r() * 0.9), -7 + r() * 14, 0.75, -4.5 + r() * 9, 0, r() * PI, r() * 0.4), i % 2 ? marble : worn);
      for (const [x, z, w] of [[-6.6, -3.4, 2.2], [6.6, 3.4, 2.4], [0, 4.6, 5]]) k.add(box(w, 0.2, 1.4, x, 0.5, z + 0.9), '#4f8a3a');
      k.add(box(0.18, 3.2, 0.18, -6.0, 5.0, -2.9), '#3f8a3a', { sway: 0.05 });
      k.add(box(0.18, 2.4, 0.18, 6.1, 5.9, -2.9), '#3f8a3a', { sway: 0.05 });
    },
  },

  // a stadium screen: its face is alive
  jumbotron: {
    h: 18, shadow: true,
    foot(k) { for (const s of [-1, 1]) k.add(box(1.5, 4, 1.5, s * 6, -4, -0.4), '#3a3f4a'); },
    build(k) {
      for (const s of [-1, 1]) {
        k.add(box(1.5, 8.2, 1.5, s * 6, 0, -0.4), '#3a3f4a');
        k.add(place(new THREE.BoxGeometry(0.4, 9, 0.4), s * 4.2, 4, -2.4, 0.5), '#5a5f6a');
      }
      k.add(box(18.6, 9.8, 1.8, 0, 8, 0), '#1c1c22');
      // the picture: a field of colour with chevrons running across it
      const hues = ['#ff3df2', '#d85cff', '#9a7cff', '#5c9cff', '#3dc8ff', '#3df2ff', '#5cffc8'];
      k.addFaces(new THREE.BoxGeometry(17.2, 8.4, 0.24, 16, 8, 1).translate(0, 12.9, 0.86), (f) => {
        if (f.nz < 0.5) return { color: '#1c1c22' };
        const col = Math.floor((f.x + 8.6) / (17.2 / 16)), row = Math.floor((f.y - 8.7) / (8.4 / 8));
        const chevron = (col + Math.abs(row - 3.5) + 100) % 5 < 1.2;
        return chevron ? { color: '#ffffff', glow: 2.0, mode: 4 } : { color: hues[Math.min(6, Math.floor(col / 2.3))], glow: 1.5, mode: 4 };
      });
      for (const s of [-1, 1]) k.add(box(0.3, 9.8, 0.3, s * 9.3, 8, 0.9), NEON_CYAN, { glow: 2.8, mode: 2 });
      k.add(box(18.6, 0.3, 0.3, 0, 17.6, 0.9), NEON_PINK, { glow: 2.8, mode: 2 });
      k.add(box(18.6, 1.0, 0.3, 0, 8, 0.92), '#ffd21f', { glow: 0.8 });
      for (let i = 0; i < 9; i++) k.add(ball(0.3, 0, -8 + i * 2, 18.1, 0.4), '#fffbe8', { glow: 3.4 });
      for (const y of [10, 13, 16]) k.add(box(17, 0.3, 0.3, 0, y, -1.0), '#5a5f6a');
    },
  },

  // bursts 60 to 100 m up, again and again (props.js lifts it); one shell takes the copy's colour
  fireworks: {
    h: 40, shadow: false, roam: true, tints: BOLD,
    build(k) {
      const r = rng(41);
      const shells = [[0, 24, 0, 15, '#ffffff', true, 0.0, 0.3], [-17, 11, 6, 11, '#ffd21f', false, 0.37, 0.27],
        [16, 31, -8, 10, '#ff4fd8', false, 0.68, 0.33], [7, 7, 10, 8, '#3df2ff', false, 0.2, 0.36]];
      for (const [cx, cy, cz, R, color, tint, phase, speed] of shells) {
        const anim = { kind: 'burst', pivot: [cx, cy, cz], phase, speed, amount: R * 0.45 };
        k.add(ball(1.4, 0, cx, cy, cz), '#ffffff', { glow: 4, anim });
        for (let i = 0; i < 44; i++) {
          const u = r() * 2 - 1, a = r() * 2 * PI, s = Math.sqrt(1 - u * u), d = R * (0.72 + 0.28 * r());
          k.add(new THREE.OctahedronGeometry(0.5 + r() * 0.3, 0).translate(cx + Math.cos(a) * s * d, cy + u * d, cz + Math.sin(a) * s * d), color, { glow: 3.4, tint, anim });
        }
      }
    },
  },

  // drifts 150 m up
  cloud: {
    h: 14, shadow: false, roam: true,
    build(k) {
      k.all = { glow: 0.22, bob: 0.5, anim: { kind: 'orbit', pivot: [0, 0, -260], speed: 0.012 } };
      const puffs = [[0, 6.5, 0, 7.5], [-9, 5.2, 1, 5.8], [9, 5.6, -1, 6.2], [-16.5, 4.1, 0, 4.2], [16.5, 4.3, 0.5, 4.6], [3.5, 9.8, 0, 5.2], [-4.5, 9.2, 1, 4.6], [0, 4.6, 4, 5], [1, 4.8, -4, 5]];
      puffs.forEach(([x, y, z, rad], i) => k.add(place(new THREE.IcosahedronGeometry(rad, 1), x, y, z, 0, i * 1.3, 0, 1, 0.74, 1), i % 3 ? '#ffffff' : '#eef4fc'));
      k.add(place(new THREE.CylinderGeometry(15, 13, 1.6, 12), 0, 1.6, 0, 0, 0, 0, 1.25, 1, 0.5), '#dfe8f4');
    },
  },

  // a flying ship, circling 100 m up; its nose points +z
  airship: {
    h: 22, shadow: false, roam: true, tints: BOLD,
    build(k) {
      k.all = { bob: 0.35, anim: { kind: 'orbit', pivot: [110, 0, 0], speed: 0.03 } };
      const env = new THREE.SphereGeometry(1, 14, 10).rotateX(PI / 2).scale(6.4, 6.4, 20).translate(0, 15, 0);
      k.addFaces(env, (f) => (Math.floor(((Math.atan2(f.x, f.y - 15) + PI) / (2 * PI)) * 10 + 0.0001) % 2 === 0 ? { color: '#ffffff', tint: true } : { color: '#fff1d0' }), { quad: 3 });
      for (const z of [-10, 0, 10]) k.add(place(new THREE.TorusGeometry(6.4 * Math.sqrt(1 - (z / 20) ** 2) + 0.1, 0.16, 4, 16), 0, 15, z), WOOD_DARK);
      // tail fins
      k.add(box(0.4, 9, 6, 0, 10.5, -17), '#ffffff', { tint: true });
      k.add(box(11, 0.4, 6, 0, 14.8, -17), '#ffffff', { tint: true });
      // the hull slung under it
      k.add(box(4.4, 2.8, 14, 0, 2, 0), WOOD);
      k.add(new THREE.CylinderGeometry(0.2, 3.1, 5, 4).rotateY(PI / 4).rotateX(PI / 2).scale(1, 2.8 / 4.4, 1).translate(0, 3.4, 9.5), '#74523a');
      k.add(box(4.8, 0.3, 14.4, 0, 4.8, 0), '#a8774a');
      k.add(box(3.4, 2.2, 4.4, 0, 4.9, -4.4), '#74523a');
      for (const s of [-1, 1]) {
        k.add(box(0.14, 0.9, 13, s * 2.3, 5.0, 0.4), WOOD_DARK);
        for (const z of [-5, 0, 5]) k.add(place(new THREE.CylinderGeometry(0.05, 0.05, 6, 4), s * 2.9, 7.9, z, 0, 0, s * 0.22), INK);
        k.add(box(0.2, 0.8, 1.0, s * 1.75, 5.6, -4.4), WARM, { glow: 2.2 });
        k.add(ball(0.32, 0, s * 2.2, 5.4, 6.6), '#ffe27a', { glow: 3, mode: 3 });
      }
      // the screw at her stern
      const spin = [0, 3.4, 7];
      k.add(place(new THREE.CylinderGeometry(0.3, 0.3, 1.4, 6), 0, 3.4, -7.6, PI / 2), '#8a909c');
      for (let i = 0; i < 3; i++) {
        k.group(new THREE.Matrix4().makeTranslation(0, 3.4, -8.3).multiply(new THREE.Matrix4().makeRotationZ((i * 2 * PI) / 3)), () => {
          k.add(new THREE.BoxGeometry(0.7, 2.6, 0.1).translate(0, 1.3, 0), '#e8e8ee', { spin });
        });
      }
    },
  },

  // a flock circling 40 m up
  'bird-flock': {
    h: 8, shadow: false, roam: true,
    build(k) {
      const r = rng(53);
      for (let i = 0; i < 11; i++) {
        const a = -0.9 + (i / 10) * 1.8 + (r() - 0.5) * 0.12, R = 15 + Math.abs(i - 5) * 1.1 + r() * 2, y = 0.6 + r() * 7;
        const phase = r() * 6.28, anim = { kind: 'orbit', pivot: [0, 0, 0], speed: 0.42, phase };
        const turn = new THREE.Matrix4().makeTranslation(Math.sin(a) * R, y, Math.cos(a) * R).multiply(new THREE.Matrix4().makeRotationY(Math.atan2(-Math.cos(a), Math.sin(a))));
        const body = k.add(new THREE.OctahedronGeometry(0.3, 0).scale(0.8, 0.7, 2.6), '#ffffff', { glow: 0.2, anim });
        const pos = [];
        for (const s of [-1, 1]) pos.push(0, 0, 0.5, 0, 0, -0.5, s * 2.0, 0.1, -0.25);
        const wg = new THREE.BufferGeometry();
        wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        wg.computeVertexNormals();
        const wings = k.add(wg, i % 3 ? '#ffffff' : '#e4ecf6', { glow: 0.2, anim: { ...anim, amount: (x) => Math.abs(x) * 0.55 } });
        body.applyMatrix4(turn); wings.applyMatrix4(turn);
      }
    },
  },

  // a golfer in gold, at the top of the swing
  statue: {
    h: 12, shadow: true,
    foot(k) { k.add(box(4.2, 3, 4.2, 0, -3, 0), '#9a968c'); },
    build(k) {
      const gold = '#e8b84a', fx = { glow: 0.3 };
      k.add(box(4.2, 0.6, 4.2), '#a29e92');
      k.add(box(3.4, 3.0, 3.4, 0, 0.6, 0), '#c2beb2');
      k.add(box(3.7, 0.4, 3.7, 0, 3.6, 0), '#a29e92');
      k.add(box(2.4, 0.9, 0.12, 0, 1.6, 1.72), GOLD, { glow: 0.6 });
      for (const s of [-1, 1]) {
        k.add(place(new THREE.CylinderGeometry(0.3, 0.34, 2.7, 6), s * 0.5, 5.35, 0, 0, 0, -s * 0.12), gold, fx);
        k.add(box(0.5, 0.25, 0.9, s * 0.66, 4.0, 0.15), gold, fx);
      }
      k.add(frustum4(0.82, 0.58, 2.5, 0, 6.6, 0), gold, fx);
      k.add(ball(0.52, 1, 0.1, 9.6, 0), gold, fx);
      k.add(cyl(0.56, 0.56, 0.14, 8, 0.1, 9.95, 0.1), gold, fx);
      // both arms up and back, the club across the shoulders
      k.add(place(new THREE.CylinderGeometry(0.2, 0.22, 2.3, 5), 0.95, 9.4, -0.1, 0, 0, -0.75), gold, fx);
      k.add(place(new THREE.CylinderGeometry(0.2, 0.22, 2.4, 5), 0.1, 9.75, -0.3, 0.2, 0, -1.25), gold, fx);
      k.add(place(new THREE.CylinderGeometry(0.06, 0.06, 4.6, 5), 0.2, 11.0, -0.3, 0, 0, 1.15), gold, fx);
      k.add(box(0.5, 0.3, 0.2, -1.95, 11.85, -0.3), gold, fx);
    },
  },

  fountain: {
    h: 6.6, shadow: false,
    foot(k) { k.add(cyl(5.2, 5.2, 2, 12, 0, -2, 0), STONE_DARK); },
    build(k) {
      const water = { glow: 0.35, mode: 4 };
      k.add(cyl(5.0, 5.2, 0.95, 12), STONE);
      k.add(cyl(4.6, 4.6, 0.2, 12, 0, 0.82, 0), '#4fc8ff', water);
      k.add(cyl(0.6, 0.9, 2.7, 8, 0, 0.9, 0), STONE);
      k.add(cyl(2.5, 1.0, 0.6, 10, 0, 3.4, 0), STONE_DARK);
      k.add(cyl(2.3, 2.3, 0.14, 10, 0, 3.92, 0), '#4fc8ff', water);
      k.add(new THREE.CylinderGeometry(2.45, 2.7, 2.9, 12, 4, true).translate(0, 2.4, 0), '#9fe0ff', { glow: 0.5, mode: 4, sway: 0.03 });   // the curtain falling from the bowl
      k.add(cyl(0.3, 0.42, 1.3, 6, 0, 4.0, 0), STONE);
      k.add(cone(0.55, 1.5, 7, 0, 5.2, 0), '#e8f8ff', { glow: 0.7, mode: 4, sway: 0.04 });
      for (let i = 0; i < 6; i++) k.add(ball(0.34, 0, Math.cos(i * 1.05) * 3.6, 1.1, Math.sin(i * 1.05) * 3.6), '#ffffff', { glow: 0.5, anim: { kind: 'bounce', phase: i * 1.1, speed: 3.4, amount: 0.3 } });
    },
  },

  // a carved pole of three faces
  tiki: {
    h: 4.3, shadow: false,
    foot(k) { k.add(cyl(0.6, 0.6, 1, 8, 0, -1, 0), '#7a4a2c'); },
    build(k) {
      const woods = ['#a8643a', '#c8372a', '#2f9a8a'];
      woods.forEach((c, i) => {
        const y = i * 1.2;
        k.add(cyl(0.56 - i * 0.03, 0.6 - i * 0.03, 1.2, 8, 0, y, 0), c);
        k.add(box(1.2 - i * 0.06, 0.2, 0.3, 0, y + 0.86, 0.46), INK);                 // brow
        for (const s of [-1, 1]) k.add(box(0.26, 0.2, 0.12, s * 0.27, y + 0.64, 0.56), i === 2 ? '#ffe81f' : '#ffffff', i === 2 ? { glow: 2.6, mode: 1 } : {});
        k.add(box(0.2, 0.34, 0.2, 0, y + 0.42, 0.56), '#7a4a2c');                       // nose
        k.add(box(0.74, 0.22, 0.12, 0, y + 0.1, 0.54), INK);
        for (const x of [-0.24, 0, 0.24]) k.add(box(0.16, 0.16, 0.06, x, y + 0.13, 0.6), '#f4ecdc');
      });
      for (const [x, rz, c] of [[-0.36, 0.5, '#ffd21f'], [0, 0, '#ff3b30'], [0.36, -0.5, '#ffd21f']]) k.add(place(new THREE.BoxGeometry(0.26, 0.9, 0.08), x, 3.98, 0, 0, 0, rz), c);
    },
  },

  // a thatched beach hut, a board leaning on it in the copy's colour
  hut: {
    h: 5.4, shadow: true, tints: BOLD,
    foot(k) { k.add(cyl(2.7, 2.7, 2, 10, 0, -2, 0), '#a8854a'); },
    build(k) {
      k.add(cyl(2.6, 2.6, 2.5, 10), '#c8a25a');
      for (let i = 0; i < 10; i++) { const a = (i / 10) * 2 * PI; k.add(box(0.12, 2.5, 0.12, Math.cos(a) * 2.6, 0, Math.sin(a) * 2.6), '#8a6a34'); }
      k.add(cone(4.0, 2.6, 10, 0, 2.3, 0), '#d8b45a');
      k.add(cone(2.5, 1.5, 10, 0, 4.0, 0), '#c8a24e');
      k.add(ball(0.22, 0, 0, 5.5, 0), '#8a6a34');
      k.add(box(1.1, 1.9, 0.2, 0, 0, 2.52), WOOD_DARK);
      k.add(box(0.8, 0.7, 0.2, 1.7, 1.1, 1.93).rotateY(0), WARM, { glow: 1.8 });
      k.add(place(new THREE.BoxGeometry(0.6, 2.8, 0.12), -2.2, 1.4, 2.4, -0.22, 0.5, 0), '#ffffff', { tint: true });
    },
  },

  // a little sailing boat; sits in the water
  boat: {
    h: 7, shadow: false, tints: BOLD, sinkExtra: 0.3,
    build(k) {
      k.all = { bob: 0.12 };
      k.add(box(2.6, 1.25, 6), '#f4f4f4');
      k.add(new THREE.CylinderGeometry(0.15, 1.84, 3.2, 4).rotateY(PI / 4).rotateX(PI / 2).scale(1, 1.25 / 2.6, 1).translate(0, 0.625, 4.6), '#f4f4f4');
      k.add(box(2.7, 0.3, 6.1, 0, 0.7, 0), '#ffffff', { tint: true });
      k.add(box(2.3, 0.12, 5.6, 0, 1.25, 0), '#c8a25a');
      k.add(box(1.5, 0.95, 1.7, 0, 1.3, -1.6), '#e8e8ee');
      k.add(box(1.52, 0.4, 0.9, 0, 1.6, -1.5), '#3a4a6a');
      k.add(cyl(0.07, 0.1, 5.7, 6, 0, 1.3, 0.7), '#e8e8ee');
      const sail = (pts, tint) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
        g.computeVertexNormals();
        k.add(g, tint ? '#ffffff' : '#fff6e0', { tint, sway: (x, y, z) => 0.05 * Math.abs(z - 0.7) });
      };
      sail([[0, 1.9, 0.55], [0, 6.8, 0.6], [0, 1.9, -2.7]], true);     // mainsail
      sail([[0, 1.7, 0.9], [0, 6.2, 0.75], [0, 1.6, 3.9]], false);     // jib
      k.add(place(new THREE.CylinderGeometry(0.05, 0.05, 3.3, 4), 0, 1.85, -1.05, PI / 2), '#e8e8ee');
    },
  },

  // a great gateway: two pylons and a lintel, fires at its feet, banners in the copy's colour
  gate: {
    h: 14, shadow: true, tints: BOLD,
    foot(k) { for (const s of [-1, 1]) k.add(box(6.6, 5, 5.4, s * 6.6, -5, 0), '#c9a24e'); },
    build(k) {
      const sand = '#e0bc74', dark = '#d0aa5e';
      for (const s of [-1, 1]) {
        k.add(new THREE.CylinderGeometry(2.3 * Math.SQRT2, 3.2 * Math.SQRT2, 12, 4).rotateY(PI / 4).scale(1, 1, 0.8).translate(s * 6.6, 6, 0), sand);
        k.add(box(5.2, 0.6, 4.4, s * 6.6, 12, 0), GOLD, { glow: 0.4 });
        k.add(box(5.9, 0.5, 4.6, s * 6.6, 3.6, 0), '#2f6fd8');
        k.add(box(5.3, 0.5, 4.2, s * 6.6, 8.2, 0), '#2f6fd8');
        k.add(cone(0.9, 1.5, 4, s * 6.6, 12.6, 0), GOLD, { glow: 0.8 });
        // a brazier
        k.add(cyl(0.5, 0.7, 1.6, 6, s * 3.2, 0, 3.2), dark);
        k.add(cyl(0.8, 0.5, 0.4, 8, s * 3.2, 1.6, 3.2), '#3a2a20');
        k.add(cone(0.6, 1.5, 7, s * 3.2, 1.9, 3.2), '#ff8a1f', { glow: 3.2, mode: 3, sway: 0.04 });
        // a banner down the face of the pylon
        k.add(new THREE.PlaneGeometry(1.8, 6, 2, 6).translate(s * 6.6, 7.6, 2.75), '#ffffff', { tint: true, sway: (x, y) => 0.06 * Math.max(0, (10.6 - y) / 6) });
      }
      k.add(box(9.4, 2.2, 3.4, 0, 8.6, 0), dark);
      k.add(box(10, 0.5, 3.8, 0, 10.8, 0), GOLD, { glow: 0.4 });
      k.add(place(new THREE.CylinderGeometry(1.1, 1.1, 0.3, 14), 0, 9.7, 1.75, PI / 2), GOLD, { glow: 1.2 });
      for (const s of [-1, 1]) k.add(place(new THREE.BoxGeometry(2.6, 0.5, 0.2), s * 2.3, 9.7, 1.75, 0, 0, s * 0.18), '#2f6fd8');
    },
  },

  // a round stone tower with a blue roof, a light in every window
  tower: {
    h: 30, shadow: true, tints: BOLD,
    foot(k) { k.add(cyl(4.5, 4.6, 6, 10, 0, -6, 0), '#8a867c'); },
    build(k) {
      const stone = '#c2beb2', dark = '#a29e92';
      k.add(cyl(4.7, 4.9, 1.2, 10), dark);
      k.add(cyl(3.6, 4.4, 21, 10, 0, 1.2, 0), stone);
      k.add(cyl(4.5, 3.7, 1.6, 10, 0, 22.2, 0), dark);
      for (let i = 0; i < 10; i++) { const a = (i / 10) * 2 * PI; k.add(box(1.1, 1.1, 1.1, Math.cos(a) * 4.1, 23.8, Math.sin(a) * 4.1).rotateY(0), dark); }
      k.add(cone(3.9, 5.6, 10, 0, 23.8, 0), '#2f6fd8');
      k.add(cyl(0.07, 0.07, 2.4, 5, 0, 29.2, 0), INK);
      k.add(new THREE.PlaneGeometry(2.4, 1.3, 3, 1).translate(1.25, 30.9, 0), '#ffffff', { tint: true, sway: (x) => 0.22 * Math.max(0, x) });
      k.add(box(1.5, 2.6, 0.4, 0, 1.2, 4.3), WOOD_DARK);
      for (let i = 0; i < 6; i++) {
        const a = i * 1.15 + 0.3, y = 5 + i * 3, rad = 4.4 - (y - 1.2) * (0.8 / 21);
        k.add(place(new THREE.BoxGeometry(0.9, 1.5, 0.5), Math.sin(a) * rad, y, Math.cos(a) * rad, 0, a, 0), WARM, { glow: 2.2 });
      }
    },
  },

  // pinnacles of banded rock
  'rock-spire': {
    h: 26, shadow: true,
    foot(k) { k.add(cyl(7.5, 8, 6, 7, 0.5, -6, -0.5), '#a84a2a'); },
    build(k) {
      const bands = ['#b5532e', '#c8663a', '#d98a4e', '#bd5a30'];
      const spire = (x, z, rad, heights, lean) => {
        let y = 0, r0 = rad;
        heights.forEach((h, i) => {
          const r1 = r0 * (i === heights.length - 1 ? 0.45 : 0.78);
          k.add(place(new THREE.CylinderGeometry(r1, r0, h, 6), x + lean * y * 0.06, y + h / 2, z, 0, i * 0.5 + x, 0), bands[(i + Math.round(Math.abs(x))) % 4]);
          y += h; r0 = r1 * 1.08;
        });
        k.add(cyl(r0 * 0.5, r0 * 0.9, 0.8, 6, x + lean * y * 0.06, y - 0.2, z), '#e0a060');
      };
      spire(0, 0, 4.2, [9, 8, 6, 3], 0.6);
      spire(5.2, 1.6, 3.2, [7, 6, 4], -0.8);
      spire(-4.6, -1.2, 2.8, [5.5, 4, 2.5], 1.2);
      spire(1.8, -4.4, 2.2, [4, 3], -0.5);
      spire(-2.4, 4.0, 1.8, [3, 2], 0.4);
    },
  },

  // a stunt ramp, running lights up its sides
  'launch-ramp': {
    h: 8, shadow: true,
    foot(k) { k.add(box(8.4, 4, 19, 0, -4, 0), '#3a3f4a'); },
    build(k) {
      // built rising toward +z, then turned about: seen from its front (the south at rotDeg 0)
      // the ramp climbs away from you, its arrow pointing up it
      k.group(new THREE.Matrix4().makeRotationY(PI), () => this.rise(k));
    },
    rise(k) {
      const N = 9, L = 18, yAt = (z) => 0.3 + 7.2 * ((z + L / 2) / L) ** 2.2;
      for (let i = 0; i < N; i++) {
        const z0 = -L / 2 + (i * L) / N, z1 = z0 + L / N, y0 = yAt(z0), y1 = yAt(z1);
        const len = Math.hypot(z1 - z0, y1 - y0) + 0.05, tilt = -Math.atan2(y1 - y0, z1 - z0), zc = (z0 + z1) / 2, yc = (y0 + y1) / 2;
        k.add(place(new THREE.BoxGeometry(7, 0.3, len), 0, yc, zc, tilt), i % 2 ? '#ffd21f' : '#22262e');
        for (const s of [-1, 1]) {
          k.add(place(new THREE.BoxGeometry(0.4, 0.9, len), s * 3.7, yc + 0.3, zc, tilt), '#ff3b30');
          k.add(place(new THREE.BoxGeometry(0.2, 0.3, len * 0.6), s * 3.7, yc + 0.9, zc, tilt), NEON_CYAN, { glow: 2.8, mode: 4 });
        }
        if (i > 1) k.add(box(6.6, yc - 0.2, 0.5, 0, 0, zc), i % 2 ? '#5a5f6a' : '#4a4f5a');
      }
      for (const s of [-1, 1]) k.add(box(0.5, yAt(L / 2) + 0.4, 0.5, s * 3.7, 0, L / 2 - 0.2), '#5a5f6a');
      // an arrow up the ramp, lit
      k.add(place(new THREE.BoxGeometry(1.2, 0.1, 5), 0, yAt(-3) + 0.34, -3.4, -0.32), '#ffffff', { glow: 1.6, mode: 4 });
      k.add(prism([[-2.2, 0], [2.2, 0], [0, 2.8]], 0.1).rotateX(PI / 2 - 0.42).translate(0, yAt(-0.4) + 0.62, 0.9), '#ffffff', { glow: 1.6, mode: 4 });
    },
  },

  // a block of spectators, four rows deep, about as tall as heightM and four times as wide:
  // heads and bodies in a crowd's colours, each hopping out of step so a wave runs along it
  crowd: {
    h: 4, shadow: false,
    foot(k) { k.add(box(16.4, 6, 4.2, 0, -6, -1.2), '#8a90a0'); },
    build(k) {
      const r = rng(67), W = 16, perRow = 20;
      const shirts = ['#ff3b30', '#ffd21f', '#2f7bff', '#ffffff', '#34c759', '#ff9f0a', '#ff4fd8', '#f4f4f4', '#3df2ff', '#9d5cff'];
      const skins = ['#f2c9a0', '#d9a577', '#a8704a', '#7a4a2e', '#f2c9a0'];
      for (let row = 0; row < 4; row++) {
        const top = (row + 1) * 0.7, z = 0.6 - row * 0.95;
        k.add(box(W + 0.4, top, 0.95, 0, 0, z), row % 2 ? '#aab0be' : '#b8bcc8');
        for (let i = 0; i < perRow; i++) {
          const x = -W / 2 + (i + 0.5) * (W / perRow) + (r() - 0.5) * 0.12;
          const keen = r() < 0.15;
          const anim = { kind: 'bounce', phase: x * 0.42 + row * 0.8 + r() * 0.5, speed: keen ? 7 : 5, amount: keen ? 0.34 : 0.13 };
          k.add(box(0.52, 0.78, 0.36, x, top + 0.04, z), shirts[Math.floor(r() * shirts.length)], { anim });
          const hat = r() < 0.2;
          k.add(box(0.3, 0.3, 0.3, x, top + 0.84, z), hat ? shirts[Math.floor(r() * shirts.length)] : skins[Math.floor(r() * skins.length)], { anim });
          if (keen) k.add(box(0.12, 0.6, 0.12, x + 0.3, top + 0.72, z), skins[Math.floor(r() * skins.length)], { anim });   // an arm in the air
          else if (r() < 0.06) k.add(box(0.5, 0.36, 0.05, x, top + 1.3, z), '#ffffff', { glow: 2.6, mode: 2, anim });      // a phone held up, flashing
        }
      }
      k.add(box(W + 0.4, 0.5, 0.12, 0, 0.5, 1.12), '#ff3b30');
      k.add(box(W + 0.4, 0.1, 0.14, 0, 1.0, 1.12), '#ffffff');
    },
  },

  // ---- v3:stadium the stadium kit's stand-ins: what is drawn if a kit GLB is missing. Plain
  // on purpose (the models are tools/arcade-art/blender/stadium.py); the two stands keep the
  // kit's own frame (front edge on z = 0, running back to -z) and its tier lines, so the
  // crowd (crowd.js) still sits on them.
  'stand-section': {
    h: 39, shadow: true, baseY: 0,
    build(k) {
      k.add(box(24, 4.8, 2.5, 0, -1.5, -1.25), '#c9cdd6');
      for (let r = 0; r < 20; r += 2) k.add(box(24, 3.3 + 0.405 * r + 1.5, 1.8, 0, -1.5, -(2.5 + 0.9 * r + 0.9)), r % 4 ? '#2b3348' : '#3a4460');
      k.add(box(24, 12.9, 4.4, 0, -1.5, -22.7), '#a3a9b6');
      for (let r = 0; r < 21; r += 3) k.add(box(24, 14.6 + 0.56 * r - 11.4, 2.58, 0, 11.4, -(24 + 0.86 * r + 1.29)), r % 2 ? '#2b3348' : '#3a4460');
      k.add(box(24, 12, 2.5, 0, 17, -45.25), '#e6eaf1');
      k.add(place(new THREE.BoxGeometry(24, 0.4, 37.5), 0, 35.8, -29, -0.136), '#e3e8f0');
      k.add(box(24, 1.6, 0.2, 0, 0.45, 0.05), '#ffd21f', { glow: 1.6, mode: 4 });
      k.add(box(24, 1.3, 0.2, 0, 14.0, -23.5), '#3dff8a', { glow: 1.6, mode: 4 });
    },
  },
  'stand-corner': {
    h: 61, shadow: true, baseY: 0,
    build(k) {
      MODELS['stand-section'].build(k);
      k.add(box(7, 33, 7, 0, 17, -50.5), '#e6eaf1');
      k.add(box(6.4, 2.5, 0.6, 0, 48.5, -46.4), '#fff6d8', { glow: 3 });
    },
  },
  'led-board': {
    h: 1.25, shadow: false,
    build(k) { k.add(box(12, 1.25, 0.3), '#14171f'); k.add(box(11.8, 1.05, 0.06, 0, 0.1, 0.17), '#ffd21f', { glow: 1.8, mode: 4 }); },
  },
  'ad-board': {
    h: 2.4, shadow: false,
    build(k) { k.add(box(6.4, 1.9, 0.24, 0, 0.35, 0), '#f4f4ee'); k.add(box(6.1, 1.6, 0.06, 0, 0.5, 0.14), '#1f5fd0', { glow: 0.7 }); k.add(box(6.4, 0.3, 1.7), '#737a88'); },
  },
  barrier: {
    h: 0.9, shadow: false,
    build(k) { for (let j = 0; j < 4; j++) k.add(box(1.96, 0.87, 0.7, -3 + j * 2, 0, 0), j % 2 ? '#f4f4ee' : '#e8372c'); },
  },
  'camera-tower': {
    h: 11.4, shadow: true,
    build(k) {
      for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) k.add(box(0.18, 8.2, 0.18, x, 0, z), '#8a93a5');
      k.add(box(4.4, 0.22, 4.4, 0, 8.2, 0), '#3a4152');
      k.add(box(4.9, 0.16, 4.9, 0, 11, 0), '#1f5fd0');
      k.add(box(0.55, 0.6, 1.25, 0, 9.75, 1.3), '#23262e');
    },
  },
  tunnel: {
    h: 7.4, shadow: true,
    build(k) {
      for (let i = 0; i < 8; i++) k.add(place(new THREE.CylinderGeometry(3.7, 3.7, 1.8, 10, 1, true, 0, PI), 0, 0.2, -(i * 1.8 + 0.9), PI / 2, 0, PI / 2), i % 2 ? '#f4f4ee' : '#1f5fd0');
      for (const s of [-1, 1]) k.add(box(1.3, 5.9, 1.3, s * 4.3, -0.4, 0.3), '#e6eaf1');
      k.add(box(9.9, 1.7, 1, 0, 4.9, 0.3), '#14171f');
      k.add(box(9.4, 1.4, 0.06, 0, 5.05, 0.84), '#3dff8a', { glow: 1.6, mode: 4 });
    },
  },
  podium: {
    h: 10.8, shadow: false,
    build(k) {
      for (const s of [-1, 1]) k.add(box(1.1, 8.6, 1.1, s * 8, 0, 0), '#c8ccd6');
      k.add(box(17.2, 1, 1, 0, 8.2, 0), '#c8ccd6');
      k.add(box(11, 1.5, 0.3, 0, 9.3, 0.55), '#14171f');
      k.add(box(10.6, 1.3, 0.06, 0, 9.4, 0.72), '#ffd21f', { glow: 1.8, mode: 4 });
      k.add(box(9.6, 3.4, 0.25, 0, 0, -2.6), '#f4f4ee');
    },
  },
};

// A target ring's band as flat geometry about the origin: outer diameter `d`, the band
// `bandM` wide (default: a share of the diameter). yAt(x, z) (optional) lifts each vertex
// onto the ground, in the ring's own frame.
export function targetRingGeometry(d = 1, { bandM = null, segments = 96, yAt = null } = {}) {
  const outer = d / 2, band = bandM ?? Math.min(outer * 0.6, Math.max(0.5, d * 0.06)), inner = Math.max(0, outer - band);
  const pos = [];
  const v = (r, a) => { const x = Math.cos(a) * r, z = Math.sin(a) * r; return [x, yAt ? yAt(x, z) : 0, z]; };
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * 2 * PI, a1 = ((i + 1) / segments) * 2 * PI;
    const p00 = v(inner, a0), p01 = v(outer, a0), p10 = v(inner, a1), p11 = v(outer, a1);
    pos.push(...p00, ...p10, ...p01, ...p01, ...p10, ...p11);   // wound to face up
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// A target ring's colour by its place among the rings round one pin, innermost first.
export const TARGET_RING_COLORS = Object.freeze(['#ffd21f', '#ff3b30', '#ffffff', '#2f7bff', '#ff3b30', '#ffffff']);

// One coloured, draped target ring ready for the prop material (props.js).
export function buildTargetRing(d, color, yAt) {
  const k = new Kit();
  k.add(targetRingGeometry(d, { yAt }), color, { glow: 0.55 });
  return k.merge();
}

export const PROCEDURAL_PROP_KINDS = Object.freeze(Object.keys(MODELS));

// The model for a kind: { geometry, measure (what heightM is set against: the box's
// height, or a bridge's length, or a ring's diameter), baseY (the model height that
// stands on the ground), shadow, tints, flat, sinkExtra }. null for a kind with no builder.
export function buildPropModel(kind) {
  const def = MODELS[kind];
  if (!def) return null;
  const k = new Kit();
  def.build(k);
  // measured as built: a foundation (def.foot) goes on afterwards, below the ground
  const b = new THREE.Box3();
  for (const p of k.parts) { p.computeBoundingBox(); b.union(p.boundingBox); }
  if (def.foot) def.foot(k);
  const geometry = k.merge();
  // a bridge's length is its deck's (def.h as built), not the box's: the abutments reach past it
  const baseY = def.baseY ?? (def.foot ? 0 : b.min.y);
  // (a height is measured from where the model stands, not from the bottom of its box)
  const measure = def.measure === 'length' ? def.h : def.measure === 'diameter' ? b.max.x - b.min.x : b.max.y - baseY;
  return {
    kind, geometry, measure,
    baseY,
    defaultHeightM: def.h,
    shadow: def.shadow !== false,
    tints: def.tints || null,
    flat: !!def.flat,
    span: def.measure === 'length',
    sinkExtra: def.sinkExtra || 0,
    roam: !!def.roam,          // moves beyond its own box (circling, drifting): never frustum-culled
  };
}

// The one material every procedural prop is drawn with. uniforms.uPropTime: seconds (the
// cheap motion); uniforms.uPropGlow: (x the glowing parts, own colour given back unlit).
// decal: for something lying on the ground (a target ring): drawn over the turf, no depth written.
export function makePropMaterial({ decal = false } = {}) {
  const uniforms = { uPropTime: { value: 0 }, uPropGlow: { value: new THREE.Vector2(1, 0) } };
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.86, metalness: 0, side: THREE.DoubleSide,
    ...(decal ? { transparent: true, opacity: 0.94, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 } : {}),
  });
  material.name = decal ? 'propDecal' : 'prop';
  material.userData.procedural = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPropTime = uniforms.uPropTime;
    shader.uniforms.uPropGlow = uniforms.uPropGlow;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aFx; attribute vec4 aSpin; attribute vec4 aAnim; attribute vec3 aPivot;
        #ifdef USE_INSTANCING
        attribute vec4 aInst;   // this copy's colour (rgb) and the distance it is gone by (m)
        #endif
        uniform float uPropTime;
        varying float vPropGlow;`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        #ifdef USE_INSTANCING
        vColor.rgb *= mix(vec3(1.0), aInst.rgb, aSpin.w);   // this copy's own colour, on its tint-masked parts
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
          vec3 propAt = instanceMatrix[3].xyz;
          #else
          vec3 propAt = modelMatrix[3].xyz;
          #endif
          float ph = fract(sin(dot(propAt.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;   // each copy out of step
          if (aSpin.z != 0.0) {
            float sa = uPropTime * aSpin.z + ph;
            vec2 sd = transformed.xy - aSpin.xy;
            transformed.xy = aSpin.xy + vec2(cos(sa) * sd.x - sin(sa) * sd.y, sin(sa) * sd.x + cos(sa) * sd.y);
          }
          float burst = 1.0;
          if (aAnim.x > 2.5) {
            // bounce: a spectator hopping, out of step with the next one
            transformed.y += abs(sin(uPropTime * aAnim.z + aAnim.y + ph)) * aAnim.w;
          } else if (aAnim.x > 1.5) {
            // burst: out from the pivot fast, hang, sag and fade; gone until the next one
            float cyc = fract(uPropTime * aAnim.z + aAnim.y + ph * 0.159);
            float grow = 1.0 - pow(1.0 - min(cyc * 1.7, 1.0), 3.0);
            transformed = aPivot + (transformed - aPivot) * (0.03 + 0.97 * grow) * step(cyc, 0.82);
            transformed.y -= cyc * cyc * aAnim.w;
            burst = smoothstep(0.0, 0.04, cyc) * (1.0 - smoothstep(0.45, 0.8, cyc));
          } else if (aAnim.x > 0.5) {
            // orbit: round the vertical axis through the pivot; wing tips beat
            float oa = uPropTime * aAnim.z + ph;
            vec2 od = transformed.xz - aPivot.xz;
            transformed.xz = aPivot.xz + vec2(cos(oa) * od.x - sin(oa) * od.y, sin(oa) * od.x + cos(oa) * od.y);
            transformed.y += sin(uPropTime * 8.0 + aAnim.y) * aAnim.w;
          }
          transformed.x += sin(uPropTime * 2.1 + ph + position.y * 0.7) * aFx.z;
          transformed.z += cos(uPropTime * 1.6 + ph * 1.3 + position.y * 0.5) * aFx.z * 0.6;
          transformed.y += sin(uPropTime * 0.55 + ph) * aFx.w;
          #ifdef USE_INSTANCING
          {
            // a copy shrinks away to nothing as it nears its cull distance: far small props cost no pixels
            float camD = distance(cameraPosition, (modelMatrix * vec4(propAt, 1.0)).xyz);
            transformed *= 1.0 - smoothstep(aInst.w * 0.85, aInst.w, camD);
          }
          #endif
          float gk = 1.0;
          if (aFx.y > 3.5) gk = 0.62 + 0.38 * sin(uPropTime * 5.0 + position.y * 1.4 + sin(position.x * 0.8 + uPropTime * 1.3) * 2.0);
          else
          if (aFx.y > 2.5) gk = 0.78 + 0.22 * sin(uPropTime * 11.0 + ph * 3.0) * sin(uPropTime * 7.3 + ph);
          else if (aFx.y > 1.5) gk = step(0.07, fract(sin(floor(uPropTime * 6.0 + ph * 5.0) * 12.9898 + ph) * 43758.5453)) * (0.92 + 0.08 * sin(uPropTime * 37.0));
          else if (aFx.y > 0.5) gk = 0.72 + 0.28 * sin(uPropTime * 1.8 + ph + position.y * 0.9);
          vPropGlow = aFx.x * gk * burst;
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec2 uPropGlow;
        varying float vPropGlow;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * (vPropGlow * uPropGlow.x + uPropGlow.y);`);
  };
  material.customProgramCacheKey = () => `prop-proc-v2${decal ? '-decal' : ''}`;
  return { material, uniforms };
}
