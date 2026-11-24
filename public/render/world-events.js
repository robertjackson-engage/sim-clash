// v3:living WORLD EVENTS: the stages are alive (docs/living-world.md).
//
// Two things, both scenery and nothing more (no ball ever goes anywhere else because of this
// file, no swing waits for it, and nothing here loops a sound):
//
//   AMBIENT LIFE   what moves through a world by itself, from the stage's own data
//                  (`course.life`, tools/arcade-holes/life/<stage>.js): boats, a train, cable
//                  cars, a camel caravan, birds that wheel and sit, fish, a dragon that watches
//                  the ball, a volcano that smokes, the hole's real wind in the windmill and
//                  the flags, weather. Deterministic: where a thing is is a function of the time.
//   REACTIONS      what the world does when the players do something: ONE beat at a time, on
//                  the frame where the cause is on screen (world-life.js ReactionBus).
//
//     scene.worldEvents.react(type, { at, intensity, playerSlot, pos, text })
//       type: 'rocket-launch' | 'great-shot' | 'holed' | 'splash' | 'lava' | 'duff' | 'bad' |
//             'snowman' | 'hole-won' | 'knockout' | 'sudden-death' | 'match-over'
//             and the states 'lead' (playerSlot 1 | 2 | 0) and 'scatter'
//       at: seconds from now (0: this frame). Returns the beat, or null when it was dropped
//       (another, at least as big, holds the stage: beats are never stacked).
//     scene.worldEvents.shotStart(shot, ctx) / shotProgress(t)   a shot's beats, on its own clock
//     scene.worldEvents.matchUpdate(match)                        a match's beats
//     scene.worldEvents.setMode('full' | 'calm' | 'off')          the player's "World life" setting
//
// How it stays cheap: one InstancedMesh a model for the whole cast (world-models.js, one
// material), three point clouds for every particle on the stage (world-fx.js), and a few
// dozen matrices written a frame. Low graphics draws the essentials only (world-life.js
// lifeBudget). A stage with no `life`, the real look, and the "off" setting cost one `if`.
//
// The camera's rules (docs/arcade-feel.md 1c) hold for what moves as they do for what stands:
// a mover on the address camera's line of sight to the ball, over the first 60 m of the shot,
// or near the path a struck ball is about to fly, shrinks out of the picture and comes back
// when the way is clear (_isClear: the twin of PropsLayer.setSeeThrough), and obstacles()
// lists the cast for a camera that flies by itself, as PropsLayer.obstacles() does.
import * as THREE from 'three';
import {
  LIFE_KINDS, BIRD_SPECIES, PLAYER_COLORS, REACTIONS, SCATTER_S, hash01, parseLifeMode, normalizeLife, lifeBudget, lifeVisible, lifeCount,
  measurePath, densifyPath, moverPose, orbitPose, flockPose, perchPose, fishJump, dolphinArc, whaleShow, trafficLight, windDrive, windmillRate,
  ReactionBus, shotReactions, matchReactions, flightSamples, reactionPlan, beatColors, beatCue, LIFE_MODE_KEY,
} from './world-life.js';
import { buildLifeModel, makeLifeMaterial } from './world-models.js';
import { Emitters, BurstPool, Weather, Beams, ShockRing, paintSign, pxPerMetre } from './world-fx.js';

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const smooth = (a, b, v) => { const k = clamp((v - a) / (b - a || 1e-9), 0, 1); return k * k * (3 - 2 * k); };
function rng(seed) {
  let a = seed | 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const PALETTE = ['#ff5a36', '#ffd21f', '#2e9bff', '#3dd17a', '#ff7ad1', '#f4f1e8', '#ff9a2e', '#8f6bff'];
const CAR_COLORS = ['#f4f1e8', '#e23a2e', '#2e9bff', '#ffd21f', '#30343c', '#8d949e'];
const NEON = ['#ff3fa8', '#3fe8ff', '#ffe23f', '#9d6bff'];
export const DRAGON_URL = '/arcade/props/dragon.glb';
// where a dragon's neck starts to turn and where the head is all the way round, as shares of its height
export const DRAGON_NECK = Object.freeze({ from: 0.5, to: 0.74, maxYaw: 1.05, maxUp: 0.75, maxDown: 0.4 });
// the bounding radius (m) a kind is given when the camera's rules are applied to it
const REACH = { boat: 5, gondola: 4, train: 8, cars: 3, 'cable-car': 4.5, groomer: 4, caravan: 2.5, balloon: 12, airship: 24, walkers: 1.6, dolphins: 2 };

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Color();
let gltfModule = null;
// The art stream's models a mover is drawn with when the file is there (the same boat, balloon
// and airship that stand still on the stages as props; the procedural copy is the fallback):
// heightM is how tall a copy stands unless its entry says, proc the procedural model's own
// height, lift how far the model's origin sits under ours (procedural metres).
export const GLB_MOVERS = Object.freeze({
  boat: { url: '/arcade/props/boat.glb', heightM: 6, proc: 8.25, lift: -0.3 },
  balloon: { url: '/arcade/props/balloon.glb', heightM: 22, proc: 21.9, lift: -1.4 },
  airship: { url: '/arcade/props/airship.glb', heightM: 19, proc: 16.8, lift: -9.6 },
});
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);

// A GLB as parts in one frame: [{ geometry (its node's place baked in), material }] and its box.
async function loadGlbParts(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.arrayBuffer();
  gltfModule ||= import('three/addons/loaders/GLTFLoader.js');
  const { GLTFLoader } = await gltfModule;
  const gltf = await new GLTFLoader(new THREE.LoadingManager()).parseAsync(data, url.slice(0, url.lastIndexOf('/') + 1));
  gltf.scene.updateMatrixWorld(true);
  const parts = [], box = new THREE.Box3();
  gltf.scene.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
    parts.push({ geometry, material: Array.isArray(o.material) ? o.material[0] : o.material });
  });
  return parts.length ? { parts, box, height: Math.max(1e-6, box.max.y) } : null;
}
// The look's touch on a model's material, as PropsLayer dresses its own (matte, a little of its colour given back).
function dressGlb(m, look) {
  if (!look || !m.isMeshStandardMaterial) return m;
  m.roughness = look.roughness ?? m.roughness; m.metalness = look.metalness ?? m.metalness; m.envMapIntensity = look.envMapIntensity ?? m.envMapIntensity;
  const lit = m.emissiveMap || m.emissive.getHex() !== 0;
  if (lit) m.emissiveIntensity *= Math.max(1, (look.emissive ?? 0.6) / 0.6) * (1 + (look.self ?? 0) * 4);
  else if (look.glow > 0) { m.emissive.set(m.map ? 0xffffff : m.color); m.emissiveMap = m.map || null; m.emissiveIntensity = look.glow; }
  return m;
}

export class WorldEvents {
  // scene: the THREE.Scene. V: sim -> three. hAt, waterAt: the ground and the water's surface
  // (null on dry ground). env(): { arcade, quality, theme, timeOfDay, night, reduced }.
  // props(): the PropsLayer (for the pieces this layer takes over, the stadium's cannons and
  // the big screens). style(): the look's touch on a model's material (arcade-look.js lookProps).
  constructor({ scene, V, hAt, waterAt = null, env = null, props = null, renderer = null, style = null, onChange = null } = {}) {
    this.scene = scene; this.V = V; this.hAt = hAt; this.waterAt = waterAt || (() => null);
    this.env = env || (() => ({ arcade: true, quality: 'high', theme: null, timeOfDay: 'day', night: false, reduced: false }));
    this.props = props || (() => null);
    this.renderer = renderer; this.style = style; this.onChange = onChange;
    this.audio = null;                 // an ArcadeAudio, handed over by app.js (every call is guarded)
    let saved = null;
    try { saved = typeof window !== 'undefined' ? window.localStorage.getItem(LIFE_MODE_KEY) : null; } catch { /* private mode */ }
    this.mode = parseLifeMode(saved);
    this.bus = new ReactionBus({ mode: () => this.mode, reduced: () => !!this._env.reduced });
    this._env = this.env();
    this._geo = null;
    this.group = null;
    this.entries = [];
    this.has = new Set();
    this.casts = new Map();            // model -> { mesh, n, vis, tint, dirty }
    this.movers = [];                  // (t, dt) => void, one a life entry
    this._wants = new Map();           // model -> instances asked for (while a stage is planned)
    this._replaced = new Map();        // prop id -> its entry in geo.props: props this layer draws instead
    this._timeline = [];               // [{ at, fn, beat }] steps of the beat that is playing
    this._wind = { mph: 0, toDeg: 0, x: 0, z: 0, hx: 0, hy: 1 };
    this._lead = 0;
    this._t = 0;
    this._shot = null;                 // { clock, live, flight, from, trail }
    this._line = null;
    this._match = null;
    this._expo = null;
    this._epoch = 0;
    this.emitters = new Emitters(); this.bursts = null; this.weather = new Weather(); this.beams = new Beams(); this.ring = new ShockRing();
    this._life = null;                 // the cast's material { material, uniforms }
  }

  // ---------------------------------------------------------------- the stage
  setCourse(geo) {
    if (geo !== this._geo) { this._replaced.clear(); this._fallen = []; this._lead = 0; this._match = null; this.bus.reset(); this._shot = null; }
    this._geo = geo || null;
    this._build();
  }

  // The player's "World life" setting: 'full' | 'calm' | 'off'. Remembered.
  setMode(mode, { save = true } = {}) {
    const m = parseLifeMode(mode);
    if (save) { try { if (typeof window !== 'undefined') window.localStorage.setItem(LIFE_MODE_KEY, m); } catch { /* private mode */ } }
    if (m === this.mode) return m;
    this.mode = m;
    this._build();
    return m;
  }

  setWind({ mph = 0, toDeg = 0 } = {}) {
    const a = (toDeg * Math.PI) / 180, hx = Math.sin(a), hy = Math.cos(a), ms = (Number(mph) || 0) * 0.447;
    this._wind = { mph: Number(mph) || 0, toDeg, x: hx * ms, z: -hy * ms, hx, hy };
    this._windDirty = true;
  }

  _clear() {
    this._epoch++;
    const g = this.group;
    for (const c of this.casts.values()) { g?.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh.dispose?.(); }
    this.casts.clear();
    this.movers = [];
    this._wants.clear();
    this._timeline = [];
    this.emitters.dispose(g); this.emitters = new Emitters();
    this.bursts?.dispose(g); this.bursts = null;
    this.weather.dispose(g); this.beams.dispose(g); this.ring.dispose(g);
    for (const fn of this._owned || []) fn();
    this._owned = [];
    this._teamTinted = []; this._pennants = []; this._forced = null; this._static = []; this._handles = [];
    this._dragons = []; this._signs = []; this._lights = []; this._flocks = []; this._perches = []; this._crocs = []; this._volcanoes = []; this._beamsLit = [];
    this._signature = null; this._tumble = null; this._fishSpare = null; this._snow = null; this._laugh = null;
    this.entries = []; this.has = new Set();
    this._restoreExposure();
    if (g) { this.scene.remove(g); this.group = null; }
  }

  dispose() {
    this._clear();
    this._restoreProps();
    this._life?.material.dispose();
    this._life = null;
  }

  // Props this layer drew instead (a dragon whose head turns) stand again as plain props.
  _restoreProps() {
    const pl = this.props();
    if (pl && this._replaced.size && typeof pl.add === 'function') pl.add([...this._replaced.values()]);
    this._replaced.clear();
    this._fallen = [];
  }

  _build() {
    this._clear();
    const e = (this._env = this.env()), geo = this._geo;
    const budget = (this.budget = lifeBudget(e.quality, this.mode));
    if (!geo || !e.arcade || !budget.on) { this._restoreProps(); this.onChange?.(); return; }
    const hole = (geo.holes || [])[0] || null;
    this._tee = hole && hole.tee ? hole.tee : [0, 0];
    this._pin = hole && hole.pin ? hole.pin : [0, 100];
    const dl = Math.hypot(this._pin[0] - this._tee[0], this._pin[1] - this._tee[1]) || 1;
    this._dir = [(this._pin[0] - this._tee[0]) / dl, (this._pin[1] - this._tee[1]) / dl];
    this.entries = normalizeLife(geo.life).filter((x) => lifeVisible(x, budget));
    this.has = new Set(this.entries.map((x) => x.kind));
    this.stadium = !!(geo.props || []).some((p) => p && (p.kind === 'stand-section' || p.kind === 'stand-corner'));
    this.group = new THREE.Group();
    this.group.name = 'world-life';
    this.scene.add(this.group);
    this._life ||= makeLifeMaterial();
    this._rand = rng(0x51c1a5 ^ (geo.life ? geo.life.length * 7919 : 0));
    this._beamCount = 0;
    const plans = [];
    for (const en of this.entries) {
      const fn = this[`_plan_${en.kind.replace(/-/g, '_')}`];
      if (fn) { const run = fn.call(this, en); if (run) plans.push(run); }
    }
    // what a beat may need on any stage: fish for a splash, a tumbleweed for a duff, a snowman's two halves
    const theme = e.theme || 'tropical';
    this._fishSpare = this._need('fish', 4);
    if (theme === 'desert' || theme === 'canyon' || this.has.has('tumbleweed')) this._tumble = { h: this._need('tumbleweed', 1), t0: -1 };
    this._snowmen = (geo.props || []).filter((p) => p && p.kind === 'snowman' && fin(p.x) && fin(p.y));
    if (this._snowmen.length) this._snow = { body: this._need('snowman-body', 3), head: this._need('snowman-head', 3), fallen: (this._fallen ||= []) };
    this._makeCasts();
    for (const run of plans) this.movers.push(run());
    for (const fn of this._static || []) fn();          // what is placed once and never moves
    this.emitters.build(this.group);
    this.beams.build(this.group, this._beamCount);
    this.ring.build(this.group);
    this._windDirty = true;
    this._applyLead();
    this.onChange?.();
  }

  // ---- the cast: one InstancedMesh a model, its copies handed out to the entries that asked
  _need(model, n) {
    const base = this._wants.get(model) || 0;
    this._wants.set(model, base + n);
    const h = { model, base, n, at: null };
    (this._handles ||= []).push(h);
    return h;
  }
  _makeCasts() {
    for (const [model, n] of this._wants) {
      const src = buildLifeModel(model);
      if (!src || !n) continue;
      const g = src.clone();
      const tint = new THREE.InstancedBufferAttribute(new Float32Array(n * 4).fill(1), 4);
      g.setAttribute('aTint', tint);
      const mesh = new THREE.InstancedMesh(g, this._life.material, n);
      mesh.name = `world-life:${model}`;
      mesh.frustumCulled = false;      // the copies roam the whole stage
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      _m.makeScale(0, 0, 0);
      for (let i = 0; i < n; i++) mesh.setMatrixAt(i, _m);
      this.group.add(mesh);
      this.casts.set(model, { mesh, n, tint, vis: new Float32Array(n).fill(1), dirty: true });
    }
  }
  _tint(h, i, color, flap = 1) {
    const c = this.casts.get(h.model);
    if (!c) return;
    _c.set(color);
    c.tint.setXYZW(h.base + i, _c.r, _c.g, _c.b, flap);
    c.tint.needsUpdate = true;
  }
  // Copy i of a handle at (x, y, z) on the course, nose along `yaw` (0: north... see _yaw),
  // pitched up and rolled, at a scale. reach: its bounding radius for the camera's rules
  // (0: it is never in the way: something flat on the water).
  _put(h, i, x, y, z, yaw, pitch = 0, roll = 0, sx = 1, sy = sx, sz = sx, reach = 2) {
    const c = this.casts.get(h.model);
    if (!c) return;
    const k = h.base + i;
    if (i === 0) (h.at ||= [0, 0, 0]), (h.at[0] = x), (h.at[1] = y), (h.at[2] = z);
    let v = 1;
    if (reach > 0) {
      const want = sx > 0 && this._isClear(x, y, z, reach) ? 1 : 0;
      v = c.vis[k] + (want - c.vis[k]) * this._ease;
      c.vis[k] = v;
      if (v < 0.02) v = 0;
    }
    _e.set(-pitch, yaw, roll, 'YXZ');
    if (h.objs) {
      // the art stream's model stands in for the procedural copy
      const o = h.objs[i], g = h.gk;
      _m.compose(_p.set(x, z + h.gy * sy * v, -y), _q.setFromEuler(_e), _s.set(sx * v * g, sy * v * g, sz * v * g));
      o.matrix.copy(_m); o.matrixWorldNeedsUpdate = true; o.visible = v > 0 && sx > 0;
      c.mesh.setMatrixAt(k, _zero);
    } else {
      _m.compose(_p.set(x, z, -y), _q.setFromEuler(_e), _s.set(sx * v, sy * v, sz * v));
      c.mesh.setMatrixAt(k, _m);
    }
    c.dirty = true;
  }
  // The art stream's model for a handle's copies, once its file is in (GLB_MOVERS).
  _glbFor(h, kind) {
    const G = GLB_MOVERS[kind];
    if (!G || typeof document === 'undefined' || typeof fetch !== 'function') return;
    this._glbTpl ||= new Map();
    if (!this._glbTpl.has(kind)) this._glbTpl.set(kind, loadGlbParts(G.url).catch((err) => { console.warn(`[world-life] ${kind}: the plain model is drawn (${err && err.message})`); return null; }));
    const epoch = this._epoch;
    this._glbTpl.get(kind).then((tpl) => {
      if (!tpl || epoch !== this._epoch) return;
      const look = this.style ? this.style() : null, mats = new Map();
      const objs = Array.from({ length: h.n }, () => {
        const g = new THREE.Group();
        for (const part of tpl.parts) {
          let m = mats.get(part.material);
          if (!m) mats.set(part.material, (m = dressGlb(part.material.clone(), look)));
          g.add(new THREE.Mesh(part.geometry, m));
        }
        g.matrixAutoUpdate = false; g.visible = false; g.name = `world-life:${kind}`;
        return this._own(g, { geometry: false, map: false });
      });
      h.gk = G.proc / tpl.height; h.gy = G.lift; h.objs = objs;
      h.mats = [...mats.values()];
      for (const m of h.mats) m.userData.own = m.color.clone();
      this._applyLead();
    });
  }
  _hide(h, i) {
    const c = this.casts.get(h.model);
    if (h.objs) h.objs[i].visible = false;
    if (!c) return;
    _m.makeScale(0, 0, 0);
    c.mesh.setMatrixAt(h.base + i, _m);
    c.dirty = true;
  }

  // ---- heights
  _ground(x, y) { const w = this.waterAt(x, y); const g = this.hAt(x, y); return w != null && w > g ? w : g; }
  _water(x, y) { const w = this.waterAt(x, y); return w != null ? w : this.hAt(x, y); }
  _z(en, x, y) { return fin(en.z) ? en.z : (LIFE_KINDS[en.kind].on === 'water' ? this._water(x, y) : this._ground(x, y)) + (en.lift || 0); }
  _three(x, y, z, out = new THREE.Vector3()) { return out.set(x, z, -y); }

  // ---- the camera's rules: is the point (course x, y, z; reach m) clear of the address
  // camera's sight line to the ball, of the first 60 m of the shot, and of the path a struck
  // ball still has to fly?
  _isClear(x, y, z, reach) {
    const L = this._line;
    if (L) {
      const rx = x - L.x, ry = y - L.y, al = rx * L.ux + ry * L.uy, lat = Math.abs(rx * L.uy - ry * L.ux), len = L.d + L.aheadM;
      if (al > -reach - 2 && al < len + reach && lat < reach + 3.5) {
        const sight = al <= L.d ? L.camZ + (L.ballZ - L.camZ) * (Math.max(0, al) / Math.max(1e-6, L.d)) : L.ballZ + (L.endZ - L.ballZ) * ((al - L.d) / Math.max(1e-6, L.aheadM));
        if (z + reach > sight - 1 && z - reach < Math.max(sight, L.camZ) + 3) return false;
      }
    }
    const S = this._shot;
    if (S && S.live && S.flight) {
      const lim = (reach + 9) * (reach + 9);
      for (let i = S.from; i < S.flight.length; i++) {
        const p = S.flight[i], dx = p.x - x, dy = p.y - y, dz = p.z - z;
        if (dx * dx + dy * dy + dz * dz < lim) return false;
      }
    }
    return true;
  }

  // Every mover that flies or stands tall, as upright cylinders [{ x, y, r, base, top }]: the
  // whole of a path it travels, so a camera that plans its own way round a stage (the menus'
  // orbit, shell-core.js backdropOrbit) keeps out of it wherever the mover happens to be.
  obstacles() {
    const out = [];
    for (const en of this.entries) {
      const K = LIFE_KINDS[en.kind], reach = REACH[en.kind] || 3;
      if (K.shape === 'path' && (K.air || en.kind === 'cable-car')) {
        for (const [x, y] of densifyPath(en.path, 20)) { const z = this._z(en, x, y); out.push({ x, y, r: reach + 2, base: z - reach - 4, top: z + reach }); }
      } else if (en.kind === 'airship') {
        for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU, x = en.x + Math.sin(a) * en.r, y = en.y + Math.cos(a) * en.r, z = this._z(en, x, y); out.push({ x, y, r: reach, base: z - 10, top: z + 8 }); }
      } else if (en.kind === 'windmill' || en.kind === 'dragon') {
        const z = this._ground(en.x, en.y), h = en.heightM || (en.kind === 'dragon' ? 30 : 14);
        out.push({ x: en.x, y: en.y, r: h * 0.5, base: z, top: z + h * 1.4 });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- vehicles on paths
  _pathMover(en, model, { step = 8, count = null, tints = PALETTE, each, spacing = null, fixedYaw = false, teamTint = false } = {}) {
    const loop = en.loop;
    const m = measurePath(densifyPath(en.path, step), loop === 'ring');
    const zs = m.pts.map(([x, y]) => this._z(en, x, y));
    const n = count ?? lifeCount(en, this.budget);
    const ent = { ...en, count: n, ...(spacing != null && !fin(en.spacingM) ? { spacingM: spacing } : {}) };
    const h = this._need(model, n);
    const G = GLB_MOVERS[model];
    const reach = REACH[en.kind] || 3, scale = G ? (en.heightM || G.heightM) / G.proc : en.scale || 1;
    if (G) this._glbFor(h, model);
    if (teamTint) (this._teamTinted ||= []).push({ h, n, tints, en });
    return () => {
      for (let i = 0; i < n; i++) this._tint(h, i, en.color || tints[(i + (en.seed || 0)) % tints.length]);
      return (t) => {
        for (let i = 0; i < n; i++) {
          const p = moverPose(m, ent, i, t);
          if (p.vis <= 0.001) { this._hide(h, i); continue; }
          const z0 = zs[p.i], z1 = zs[Math.min(p.i + 1, zs.length - 1)];
          const o = { x: p.x, y: p.y, z: z0 + (z1 - z0) * p.f, yaw: fixedYaw ? 0 : Math.atan2(p.hx, -p.hy), pitch: 0, roll: 0, s: scale * p.vis, sy: scale * p.vis };
          if (each) each(o, p, i, t, m, zs);
          this._put(h, i, o.x, o.y, o.z, o.yaw, o.pitch, o.roll, o.s, o.sy, o.s, o.hidden ? 0 : reach);
        }
      };
    };
  }
  _plan_boat(en) {
    return this._pathMover(en, 'boat', { step: 20, tints: ['#ff5a36', '#ffd21f', '#f4f1e8', '#2e9bff'], each: (o, p, i, t) => { o.z += Math.sin(t * 1.1 + i * 2) * 0.07; o.roll = Math.sin(t * 0.9 + i) * 0.06; o.pitch = Math.sin(t * 0.7 + i * 3) * 0.03; } });
  }
  _plan_gondola(en) {
    return this._pathMover(en, 'gondola', { step: 20, tints: ['#7a1f2e', '#1f4d7a', '#2e6b3a'], each: (o, p, i, t) => { o.z += Math.sin(t * 0.9 + i * 2) * 0.04; o.roll = Math.sin(t * 0.8 + i) * 0.04; } });
  }
  // track: true draws what a train or a road runs on where the stage has nothing there: a dark
  // deck line and a pier every 60 m down to the ground
  _track(en) {
    if (!en.track) return;
    const pts = densifyPath(en.path, 60), lines = [], piers = [];
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i], z = this._z(en, x, y) - 0.4, g = this._ground(x, y);
      if (i) { const [px, py] = pts[i - 1], pz = this._z(en, px, py) - 0.4; lines.push(px, pz, -py, x, z, -y); }
      if (z - g > 2) piers.push([x, y, g, z]);
    }
    this._addLines(lines, 0x14161c);
    if (!piers.length) return;
    const ph = this._need('pylon', piers.length);
    (this._static ||= []).push(() => piers.forEach(([x, y, g, z], i) => this._put(ph, i, x, y, g - 0.5, 0, 0, 0, 1.4, z - g + 0.5, 0.35, 0)));
  }
  _plan_train(en) {
    this._track(en);
    return this._pathMover(en, 'train', { step: 16, spacing: 14.3 * (en.scale || 1), tints: ['#dfe5ee'] });
  }
  _plan_cars(en) {
    // both ways: every other car runs the path backwards in the far lane
    const lane = en.laneM ?? 2.2;
    this._track(en);
    return this._pathMover({ ...en, scale: en.scale || 1.7 }, 'car', { step: 16, tints: CAR_COLORS, each: (o, p, i) => {
      if (i % 2) { o.yaw += Math.PI; }
      const s = i % 2 ? -1 : 1;
      o.x += p.hy * lane * s; o.y -= p.hx * lane * s;
    } });
  }
  _plan_cable_car(en) {
    // pylons at the path's own points, two cables between their heads, cabins up one and down the other
    const lift = en.lift ?? 14, half = 1.7;
    const tops = en.path.map(([x, y]) => [x, y, this._z(en, x, y)]);
    const ph = this._need('pylon', tops.length);
    const lines = [];
    for (let i = 0; i + 1 < tops.length; i++) {
      const a = tops[i], b = tops[i + 1], dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = (b[1] - a[1]) / dl, ny = -(b[0] - a[0]) / dl;
      for (const s of [-1, 1]) lines.push(a[0] + nx * half * s, a[2], -(a[1] + ny * half * s), b[0] + nx * half * s, b[2], -(b[1] + ny * half * s));
    }
    this._addLines(lines, 0x20242c);
    const run = this._pathMover(en, 'cable-car', { step: 1e9, tints: ['#e23a2e', '#ffd21f', '#2e9bff', '#f4f1e8'], each: (o, p, i, t) => {
      o.x += p.hy * half; o.y -= p.hx * half;      // each keeps to the right-hand cable of the way it is going
      o.roll = Math.sin(t * 0.8 + i * 1.9) * 0.03;
    } });
    return () => {
      tops.forEach(([x, y, z], i) => {
        const g = this._ground(x, y), a = tops[Math.min(i + 1, tops.length - 1)], b = tops[Math.max(i - 1, 0)];
        this._put(ph, i, x, y, g - 0.5, Math.atan2(a[0] - b[0], -(a[1] - b[1])), 0, 0, 1, Math.max(1, z - g + 0.5), 1, 0);
      });
      return run();
    };
  }
  _plan_groomer(en) {
    return this._pathMover(en, 'groomer', { step: 6, count: 1, tints: ['#d92a22'], each: (o, p, i, t, m, zs) => {
      const z0 = zs[p.i], z1 = zs[Math.min(p.i + 1, zs.length - 1)], seg = m.at[Math.min(p.i + 1, m.at.length - 1)] - m.at[p.i] || 1;
      o.pitch = Math.atan2(z1 - z0, seg) * (p.back ? -1 : 1);
    } });
  }
  _plan_caravan(en) {
    return this._pathMover(en, 'camel', { step: 6, spacing: 5.2, tints: ['#c0392b', '#2e6f9b', '#d9a521', '#6b3fa0', '#2e8b57'], each: (o, p, i, t) => { o.z += Math.abs(Math.sin(t * 1.9 + i * 1.3)) * 0.07; o.roll = Math.sin(t * 1.9 + i * 1.3) * 0.03; } });
  }
  _plan_balloon(en) {
    return this._pathMover(en, 'balloon', { step: 40, fixedYaw: true, teamTint: true, tints: ['#ff5a36', '#ffd21f', '#2e9bff', '#ff7ad1', '#3dd17a'], each: (o, p, i, t) => { o.z += Math.sin(t * 0.35 + i * 2.2) * 1.4; o.yaw = t * 0.04 + i; } });
  }
  _plan_walkers(en) {
    const seed = en.seed || 0;
    return this._pathMover(en, 'walker', { step: 5, tints: PALETTE, each: (o, p, i, t) => {
      const side = (hash01(seed, i, 5) - 0.5) * 2.6;
      o.x += p.hy * side; o.y -= p.hx * side;
      o.z += Math.abs(Math.sin(t * 5.2 + i * 1.7)) * 0.05;
      o.s *= 1.05 + 0.2 * hash01(seed, i, 6); o.sy = o.s;
    } });
  }
  _plan_dolphins(en) {
    return this._pathMover(en, 'dolphin', { step: 20, spacing: en.spacingM ?? 5, tints: ['#ffffff'], each: (o, p, i, t) => {
      const a = dolphinArc(((t / 3.4 + i * 0.31) % 1 + 1) % 1, en.heightM || 1.5);
      o.z += a.h; o.pitch = a.pitch;
      if (!a.up) { o.s = 0; o.sy = 0; }
    } });
  }
  _plan_squall(en) {
    // a curtain of rain far out at sea, walking along its path under the storm front
    const m = measurePath(densifyPath(en.path, 40), false);
    const w = en.widthM || 260, hgt = en.heightM || 170;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: this._life.uniforms.uLifeTime },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        float h(float x) { return fract(sin(x * 91.7) * 43758.5); }
        void main() {
          float sl = vUv.x * 46.0 + vUv.y * 9.0, st = h(floor(sl)) * (0.5 + 0.5 * sin(uTime * 0.6 + floor(sl)));
          float a = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x) * smoothstep(1.0, 0.55, vUv.y) * smoothstep(0.0, 0.12, vUv.y);
          a *= 0.2 + 0.2 * st;
          gl_FragColor = vec4(vec3(0.36, 0.42, 0.5) * a, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt).translate(0, hgt / 2, 0), mat);
    mesh.name = 'world-life:squall'; mesh.frustumCulled = false; mesh.renderOrder = 5;
    this._own(mesh);
    return () => (t, dt, camera) => {
      const p = moverPose(m, en, 0, t), z = this._water(p.x, p.y);
      mesh.position.set(p.x, z, -p.y);
      if (camera) mesh.rotation.y = Math.atan2(camera.position.x - mesh.position.x, camera.position.z - mesh.position.z);
    };
  }

  // ---------------------------------------------------------------- the airship and its sign
  _plan_airship(en) {
    const h = this._need('airship', 1);
    let sign = null;
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      const text = String(en.sign || this._geo?.name || 'SIM CLASH').toUpperCase();
      paintSign(canvas, text);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.anisotropy = 4;
      const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: true });
      mat.color.setScalar(this._env.night ? 1.9 : 1.15);
      const grp = new THREE.Group();
      for (const s of [-1, 1]) { const pl = new THREE.Mesh(new THREE.PlaneGeometry(24, 4.4), mat); pl.rotation.y = s * Math.PI / 2; pl.position.set(s * 6.02, -0.6, 0); grp.add(pl); }
      grp.name = 'world-life:sign';
      this._own(grp);
      sign = { grp, tex, canvas, text, until: -1 };
      this._signs.push(sign);
    }
    (this._teamTinted ||= []).push({ h, n: 1, tints: ['#e9edf2'], en });
    this._glbFor(h, 'airship');
    this._takeOver('airship', en, null, Infinity);     // the stage's own airship, wherever it was moored, is the one that flies
    const AG = GLB_MOVERS.airship, s = (en.heightM || AG.heightM) / AG.proc;
    return () => {
      this._tint(h, 0, '#e9edf2');
      return (t) => {
        const p = orbitPose(en, 0, t), z = this._z(en, p.x, p.y) + Math.sin(t * 0.2) * 2, yaw = Math.atan2(p.hx, -p.hy);
        if (sign && h.objs && !sign.wide) { sign.wide = true; sign.grp.children.forEach((pl, i) => { pl.position.x = (i ? 1 : -1) * 6.9; }); }
        this._put(h, 0, p.x, p.y, z, yaw, 0, (en.speed < 0 ? 1 : -1) * 0.05, s, s, s, REACH.airship * s);
        if (sign) {
          const c = this.casts.get('airship'), v = c ? c.vis[h.base] : 1;
          sign.grp.position.set(p.x, z, -p.y); sign.grp.rotation.set(0, yaw, 0); sign.grp.scale.setScalar(s * (v < 0.02 ? 0 : v));
          sign.tex.offset.x = (t * 0.06) % 1;
          if (sign.until > 0 && t > sign.until) { sign.until = -1; paintSign(sign.canvas, sign.text); sign.tex.needsUpdate = true; }
        }
      };
    };
  }

  // ---------------------------------------------------------------- birds
  _awayFrom(x, y) {
    // the side of the line of play a point is on: a frightened bird leaves that way
    const s = (x - this._tee[0]) * this._dir[1] - (y - this._tee[1]) * this._dir[0] >= 0 ? 1 : -1;
    return [this._dir[1] * s, -this._dir[0] * s];
  }
  _plan_flock(en) {
    const n = lifeCount(en, this.budget), sp = BIRD_SPECIES[en.species] || BIRD_SPECIES.crow;
    const h = this._need('bird', n);
    const ent = { ...en, count: n };
    const st = { en: ent, at: -1e9, away: this._awayFrom(en.x, en.y), ground: this._ground(en.x, en.y) };
    this._flocks.push(st);
    return () => {
      for (let i = 0; i < n; i++) this._tint(h, i, sp.color, 1);
      return (t) => {
        const age = t - st.at < SCATTER_S ? t - st.at : null;
        for (let i = 0; i < n; i++) {
          const p = flockPose(ent, i, t, age, st.away), s = sp.span * (en.scale || 1) * (0.9 + 0.3 * hash01(en.seed || 0, i, 7));
          this._put(h, i, p.x, p.y, st.ground + p.lift, Math.atan2(p.hx, -p.hy), 0, -p.bank, s, s, s, 1.5);
        }
      };
    };
  }
  _plan_perch(en) {
    const n = en.at.length, sp = BIRD_SPECIES[en.species] || BIRD_SPECIES.crow;
    const h = this._need('bird', n);
    const spots = en.at.map(([x, y, z]) => [x, y, fin(z) ? z : this._ground(x, y) + (en.lift || 0)]);
    const st = { en, spots, at: -1e9, away: this._awayFrom(spots[0][0], spots[0][1]), h, laugh: -1, laughI: 0, flying: false };
    this._perches.push(st);
    return () => {
      for (let i = 0; i < n; i++) this._tint(h, i, sp.color, 0);
      return (t) => {
        const age = t - st.at < SCATTER_S ? t - st.at : null;
        const flying = age !== null;
        if (flying !== st.flying) { st.flying = flying; for (let i = 0; i < n; i++) this._tint(h, i, sp.color, flying ? 1 : 0); }
        for (let i = 0; i < n; i++) {
          const p = perchPose(spots[i], i, t, age, st.away, en.seed || 0), s = sp.span * (en.scale || 1.25);
          let lift = p.lift, pitch = 0;
          if (st.laugh > 0 && i === st.laughI && t - st.laugh < 2.2) { const u = t - st.laugh; lift += Math.abs(Math.sin(u * 16)) * 0.22; pitch = 0.5 * Math.abs(Math.sin(u * 16)); }
          this._put(h, i, p.x, p.y, spots[i][2] + lift + 0.1 * s, Math.atan2(p.hx, -p.hy), pitch, -p.bank, s, s, s, flying ? 1.5 : 0);
        }
      };
    };
  }
  // Frighten the birds: all of them, or those within `within` metres of a point.
  scatter({ pos = null, within = null } = {}) {
    const t = this._t;
    let n = 0;
    const hit = (x, y, r, st) => {
      if (t - st.at < SCATTER_S + 4) return;
      if (pos && within != null && Math.hypot(pos.x - x, pos.y - y) > within + r) return;
      st.at = t; n++;
    };
    for (const st of this._flocks || []) hit(st.en.x, st.en.y, st.en.r, st);
    for (const st of this._perches || []) hit(st.spots[0][0], st.spots[0][1], 12, st);
    return n;
  }

  // ---------------------------------------------------------------- water creatures
  _plan_fish(en) {
    const n = lifeCount(en, this.budget), h = this._need('fish', n), z = this._water(en.x, en.y), ent = { ...en, count: n };
    return () => {
      for (let i = 0; i < n; i++) this._tint(h, i, en.color || (i % 3 ? '#c9d6e2' : '#ffb347'));
      return (t) => {
        for (let i = 0; i < n; i++) {
          const j = fishJump(ent, i, t);
          if (!j.up) { this._hide(h, i); continue; }
          const s = en.scale || 1.5;
          this._put(h, i, j.x, j.y, z + j.h, Math.atan2(j.hx, -j.hy), j.pitch, 0, s, s, s, 1);
        }
      };
    };
  }
  _plan_koi(en) {
    const n = lifeCount(en, this.budget), h = this._need('koi', n), z = this._water(en.x, en.y) + 0.04, seed = en.seed || 0;
    const cols = ['#ff7a1a', '#f4f1e8', '#ffd21f', '#e23a2e', '#ff9a4a'];
    return () => {
      for (let i = 0; i < n; i++) this._tint(h, i, cols[i % cols.length], 1);
      return (t) => {
        for (let i = 0; i < n; i++) {
          const r = en.r * (0.35 + 0.65 * hash01(seed, i, 1)), dir = i % 2 ? -1 : 1;
          const p = orbitPose({ ...en, count: n, speed: (en.speed || 0.5) * dir * (0.7 + 0.6 * hash01(seed, i, 2)) }, i, t, r), s = en.scale || 1.6;
          this._put(h, i, p.x, p.y, z, Math.atan2(p.hx, -p.hy) + Math.sin(t * 2.2 + i) * 0.25, 0, 0, s, s, s, 0);
        }
      };
    };
  }
  _plan_turtle(en) {
    const h = this._need('turtle', 1), z = this._ground(en.x, en.y), yaw = -((en.rotDeg || 0) * Math.PI) / 180, s = en.scale || 1.4;
    return () => (t) => this._put(h, 0, en.x, en.y, z + Math.max(0, Math.sin(t * 0.25)) * 0.03, yaw + Math.sin(t * 0.17) * 0.12, 0, 0, s, s, s, 0);
  }
  _plan_croc(en) {
    const h = this._need('croc', 1), z = this._water(en.x, en.y) - 0.1, yaw0 = -((en.rotDeg || 0) * Math.PI) / 180, s = en.scale || 1.3;
    const st = { en, lunge: -1, to: null };
    this._crocs.push(st);
    return () => (t) => {
      let x = en.x, y = en.y, yaw = yaw0, pitch = 0, lift = Math.sin(t * 0.3) * 0.03;
      if (st.lunge > 0 && t - st.lunge < 1.6 && st.to) {
        const u = (t - st.lunge) / 1.6, k = Math.sin(Math.PI * Math.min(1, u * 1.15)), dx = st.to.x - en.x, dy = st.to.y - en.y, d = Math.hypot(dx, dy) || 1, reachM = Math.min(5, d * 0.5);
        x += (dx / d) * reachM * k; y += (dy / d) * reachM * k; yaw = Math.atan2(dx, -dy); pitch = 0.55 * k; lift += 0.5 * k;
      }
      this._put(h, 0, x, y, z + lift, yaw, pitch, 0, s, s, s, 0);
    };
  }
  _plan_whale(en) {
    const h = this._need('whale', 1), z = this._water(en.x, en.y), s = en.scale || 2.2, yaw = -((en.rotDeg || 0) * Math.PI) / 180;
    let cycle = null;
    return () => (t) => {
      const w = whaleShow(en, t);
      if (w.tail <= 0.01) this._hide(h, 0);
      else this._put(h, 0, en.x, en.y, z - 3.6 * s * (1 - w.tail), yaw, 0, 0, s, s, s, 0);
      if (cycle !== null && w.cycle !== cycle && w.blow) this._burst(this._three(en.x + 6, en.y, z + 0.5), { kind: 'jet', color: '#eaf6ff', speed: 11, life: 1.6, size: 1.3, gravity: 7, spread: 0.14, over: 0.6, share: 0.5 });
      cycle = w.cycle;
    };
  }
  _area(en, n, fn) {
    const r = this._rand;
    for (let i = 0; i < n; i++) {
      const a = r() * TAU, d = Math.sqrt(r()) * en.r, x = en.x + Math.sin(a) * d, y = en.y + Math.cos(a) * d;
      fn(this._three(x, y, this._ground(x, y) + 0.5 + r() * (en.lift ?? 2.2)));
    }
  }
  _plan_fireflies(en) {
    if (this._env.timeOfDay === 'day') return null;      // they come out at dusk
    const n = Math.round(lifeCount(en, this.budget) * this.budget.particles);
    this._area(en, n, (p) => this.emitters.add(p, 1, { mode: 'hover', size: 0.34, color: en.color || '#d8ff6a', add: true, life: 4 }, this._rand));
    return null;
  }
  _plan_butterflies(en) {
    if (this._env.night) return null;
    const n = Math.round(lifeCount(en, this.budget) * this.budget.particles), cols = ['#ffd21f', '#ff7ad1', '#5fd0ff', '#ffffff', '#ff9a2e'];
    let i = 0;
    this._area(en, n, (p) => this.emitters.add(p, 1, { mode: 'flutter', size: 0.5, color: cols[i++ % cols.length], vel: [3.5, 0, 3.5], life: 4 }, this._rand));
    return null;
  }

  // ---------------------------------------------------------------- the big characters
  _plan_volcano(en) {
    const z = this._z(en, en.x, en.y), at = this._three(en.x, en.y, z), k = en.scale || 1, P = this.budget.particles, r = this._rand;
    this.emitters.add(at, Math.round(34 * P), { mode: 'plume', vel: [0, 5.5 * k, 0], velJitter: 3.2 * k, spread: 6 * k, life: 12, size: 17 * k, color: en.color || '#6b5a52', alpha: 0.3 }, r);
    this.emitters.add(at, Math.round(18 * P), { mode: 'ballistic', vel: [0, 13 * k, 0], velJitter: 9 * k, spread: 3 * k, life: 2.6, size: 1.1 * k, color: '#ff7a1a', add: true }, r);
    const st = { en, at, k, next: (en.everyS || 27) * (0.4 + 0.6 * hash01(en.seed || 0, 1, 1)) };
    this._volcanoes.push(st);
    return () => (t) => {
      // it throws a few lava bombs on its own every half minute or so (not while a ball is in the air)
      if (t >= st.next) { st.next = t + (en.everyS || 27) * (0.75 + 0.5 * hash01(en.seed || 0, Math.floor(t), 2)); if (!(this._shot && this._shot.live)) this._erupt(st, 0.45); }
    };
  }
  _erupt(st, power = 1) {
    const k = st.k * (0.7 + 0.5 * power);
    // (a far cone is drawn big: its fountain keeps its shape, so gravity grows with it)
    this._burst(st.at, { kind: 'jet', color: '#ff6a12', speed: 24 * k, life: 4.2, size: 2.6 * k, gravity: 9.8 * k, spread: 0.3, over: 1.5 * power, share: 0.4 + 0.6 * Math.min(1, power) });
    this._burst(st.at, { kind: 'puff', color: '#7a6a60', speed: 18 * k, life: 6.5, size: 15 * k, gravity: -2.2, dir: [0, 1, 0], spread: 0.95, over: 1.6, share: 0.5 });
  }
  _plan_mist(en) {
    const w = en.widthM || 8, at = this._three(en.x, en.y, this._z(en, en.x, en.y) + 0.6), r = this._rand;
    this.emitters.add(at, Math.round((en.count > 1 ? en.count : 16) * this.budget.particles), { mode: 'plume', vel: [0, 1.5, 0], velJitter: 2.6, spread: w / 2, life: 4.2, size: 0.55 * w + 2, color: en.color || '#f2fbff', alpha: 0.2 }, r);
    return null;
  }
  _plan_geyser(en) {
    const hM = en.heightM || 12, v = Math.sqrt(2 * 9.8 * hM), at = this._three(en.x, en.y, this._z(en, en.x, en.y) + 0.2), r = this._rand, P = this.budget.particles;
    // (glow: a spout of lava, lit by itself)
    this.emitters.add(at, Math.round(44 * P), { mode: 'ballistic', vel: [0, v, 0], velJitter: 2.4, spread: 0.4, life: (2 * v) / 9.8, size: en.glow ? 1.3 : 1.0, color: en.color || (en.glow ? '#ff7a1a' : '#f4fbff'), alpha: en.glow ? 1 : 0.6, add: !!en.glow, period: en.everyS || 14, on: 0.2 }, r);
    this.emitters.add(at, Math.round(6 * P), { mode: 'plume', vel: [0, 1.6, 0], velJitter: 0.8, spread: 0.6, life: 3.4, size: 2.6, color: en.glow ? '#3a2c28' : '#f4fbff', alpha: en.glow ? 0.3 : 0.18 }, r);
    return null;
  }
  _plan_beam(en) {
    // a lighthouse's lamp: two beams, back to back, sweeping
    const i0 = this._beamCount; this._beamCount += 2;
    const from = this._three(en.x, en.y, this._z(en, en.x, en.y)), len = en.lengthM || 260, col = new THREE.Color(en.color || '#fff1c4'), to = new THREE.Vector3();
    return () => (t, dt, camera) => {
      const a = (t / (en.periodS || 10)) * TAU;
      for (let k = 0; k < 2; k++) {
        const b = a + k * Math.PI;
        to.set(from.x + Math.sin(b) * len, from.y - len * 0.04, from.z - Math.cos(b) * len);
        // never a glare straight down the lens: the beam dims as it swings through the camera
        let glare = 1;
        if (camera) { _a.subVectors(camera.position, from).normalize(); _b.subVectors(to, from).normalize(); glare = 1 - 0.75 * smooth(0.96, 0.999, _a.dot(_b)); }
        this.beams.set(i0 + k, from, to, len, len * 0.045, col, (this._env.night ? 0.5 : this._env.timeOfDay === 'day' ? 0.13 : 0.3) * glare * (en.strength ?? 1));
      }
    };
  }
  _plan_searchlight(en) {
    const h = this._need('searchlight', 1), g = this._ground(en.x, en.y) + (en.lift || 0), s = en.scale || 1.4;
    const lit = this._env.night || this._env.timeOfDay === 'dusk';
    const i0 = lit ? this._beamCount++ : -1;
    const from = this._three(en.x, en.y, g + 1.6 * s), to = new THREE.Vector3(), col = new THREE.Color(en.color || '#cfe9ff');
    const st = { en, aim: null, until: -1, cur: new THREE.Vector3(0, 1, 0) };
    this._lights.push(st);
    const away = this._awayFrom(en.x, en.y), seed = en.seed || 0;
    return () => (t, dt) => {
      this._put(h, 0, en.x, en.y, g, 0, 0, 0, s, s, s, 0);
      if (i0 < 0) return;
      // idle: a slow sweep high in the sky, leaning away from the line of play; on a beat: onto the spot
      const az = Math.atan2(away[0], away[1]) + Math.sin(t * 0.21 + seed) * 0.9, el = 1.05 + Math.sin(t * 0.13 + seed * 2) * 0.22;
      _a.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
      if (st.aim && t < st.until) _a.subVectors(st.aim, from).normalize();
      st.cur.lerp(_a, dt > 0 ? Math.min(1, dt * 3.2) : 1).normalize();
      const len = st.aim && t < st.until ? Math.min(420, from.distanceTo(st.aim)) : 240;
      to.copy(from).addScaledVector(st.cur, len);
      this.beams.set(i0, from, to, len, len * 0.016, col, 0.4);
    };
  }
  _plan_windmill(en) {
    const s = (en.heightM || 14) / 12.4, th = this._need('windmill-tower', 1), rh = this._need('windmill-rotor', 1), g = this._ground(en.x, en.y) - 0.3;
    this._takeOver('windmill', en);
    let turn = hash01(en.seed || 0, 3, 3) * TAU;
    return () => (t, dt) => {
      // the cap faces the wind the hole really has; the sails turn as hard as it blows
      const yaw = Math.atan2(-this._wind.hx, this._wind.hy);
      turn += windmillRate(this._wind.mph) * dt;
      this._put(th, 0, en.x, en.y, g, yaw, 0, 0, s, s, s, 0);
      const fx = Math.sin(yaw), fz = Math.cos(yaw);     // the hub: at the front of the axle, 10.6 up (model units)
      this._put(rh, 0, en.x + fx * 2.95 * s, en.y - fz * 2.95 * s, g + 10.6 * s, yaw, 0, turn, s, s, s, 0);
    };
  }
  _plan_windsock(en) {
    const s = en.scale || 1.2, ph = this._need('windsock-pole', 1), sh = this._need('windsock', 1), g = this._ground(en.x, en.y) - 0.2;
    return () => {
      this._tint(sh, 0, '#ffffff', 1);
      return () => {
        const d = windDrive(this._wind.mph);
        this._put(ph, 0, en.x, en.y, g, 0, 0, 0, s, s, s, 0);
        // it points where the wind goes and hangs when there is none
        this._put(sh, 0, en.x, en.y, g + 6.9 * s, Math.atan2(this._wind.hx, -this._wind.hy), -(1 - d) * 1.2, 0, s, s, s, 0);
        const c = this.casts.get('windsock'); if (c) { c.tint.setW(sh.base, 0.25 + d); c.tint.needsUpdate = true; }
      };
    };
  }
  _plan_pennants(en) {
    // a string of flags between poles: it swings downwind and takes the leading player's colour
    const lift = en.lift ?? 5.5, poles = en.path.map(([x, y]) => [x, y, this._ground(x, y)]);
    const ph = this._need('windsock-pole', poles.length), flags = [], lines = [];
    for (let i = 0; i + 1 < poles.length; i++) {
      const a = poles[i], b = poles[i + 1], d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.floor(d / 0.95));
      let prev = null;
      for (let k = 0; k <= n; k++) {
        const u = k / n, sag = 4 * u * (1 - u) * Math.min(1.1, d * 0.05);
        const p = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u + lift - sag];
        if (prev) lines.push(prev[0], prev[2], -prev[1], p[0], p[2], -p[1]);
        if (k > 0 && k < n) flags.push({ p, yaw: Math.atan2(b[0] - a[0], -(b[1] - a[1])) + Math.PI / 2, ax: [(b[0] - a[0]) / d, (b[1] - a[1]) / d] });
        prev = p;
      }
    }
    this._addLines(lines, 0x2a2e36);
    const fh = this._need('pennant', flags.length);
    const cols = Array.isArray(en.colors) && en.colors.length ? en.colors : ['#ffd21f', '#f4f1e8', '#e23a2e'];
    const st = { fh, n: flags.length, cols };
    (this._pennants ||= []).push(st);
    let last = '';
    return () => () => {
      const d = windDrive(this._wind.mph), key = `${Math.round(d * 40)}|${Math.round(this._wind.toDeg)}|${this._shown || 0}`;
      if (key === last) return;
      last = key;
      const lead = this._shown ? [PLAYER_COLORS[this._shown], '#f4f1e8'] : cols;
      poles.forEach(([x, y, z], i) => this._put(ph, i, x, y, z - 0.2, 0, 0, 0, 1, (lift + 0.3) / 7, 1, 0));
      flags.forEach((f, i) => {
        // which side of the rope the wind pushes it to
        const side = f.ax[0] * this._wind.hy - f.ax[1] * this._wind.hx;
        const c = this.casts.get('pennant');
        if (c) { _e.set(-side * d * 0.95, f.yaw, 0, 'YXZ'); _m.compose(_p.set(f.p[0], f.p[2], -f.p[1]), _q.setFromEuler(_e), _s.set(1.25, 1.25, 1.25)); c.mesh.setMatrixAt(fh.base + i, _m); c.dirty = true; }
        this._tint(fh, i, lead[i % lead.length], 0.3 + 1.2 * d);
      });
    };
  }
  _plan_traffic_light(en) {
    const n = en.at.length, ph = this._need('traffic-light', n), lh = this._need('lamp', n), s = en.scale || 1.6;
    const COL = { red: '#ff2a1c', amber: '#ffb020', green: '#2cff6a' }, OFF = { red: 0.42, amber: 0, green: -0.42 };
    const spots = en.at.map(([x, y, z]) => [x, y, fin(z) ? z : this._ground(x, y) + (en.lift || 0)]);
    const state = new Array(n).fill('');
    return () => (t) => {
      spots.forEach(([x, y, z], i) => {
        const now = trafficLight(t, i, en.cycleS || 16);
        this._put(ph, i, x, y, z, 0, 0, 0, s, s, s, 0);
        this._put(lh, i, x, y - 0.25 * s, z + (4.95 + OFF[now]) * s, 0, 0, 0, s * 1.2, s * 1.2, s * 1.2, 0);
        if (now !== state[i]) { state[i] = now; this._tint(lh, i, COL[now]); }
      });
    };
  }
  _plan_signature(en) { this._signature = { x: en.x, y: en.y, z: this._z(en, en.x, en.y) }; return null; }
  _plan_tumbleweed() { return null; }
  _plan_weather(en) {
    this.weather.build(this.group, en.type, this.budget.weather, en.amount ?? 1, this._rand);
    return null;
  }
  _plan_shooting_stars(en) {
    if (!this._env.night) return null;
    // one thin streak, high in the sky and well off the hole's line (it is the one quick pale
    // thing here: it stays 55 degrees or more from where the ball is watched)
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]), 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    mesh.name = 'world-life:star'; mesh.frustumCulled = false; mesh.renderOrder = 4; mesh.visible = false;
    this._own(mesh);
    const every = en.everyS || 11, seed = en.seed || 0, hole = Math.atan2(this._dir[0], this._dir[1]);
    return () => (t, dt, camera) => {
      const k = Math.floor(t / every), u = (t - k * every) / 0.7;
      if (u >= 1 || !camera || hash01(seed, k, 1) < 0.25) { mesh.visible = false; return; }
      const side = hash01(seed, k, 2) < 0.5 ? -1 : 1, az = hole + side * (0.96 + hash01(seed, k, 3) * 1.6), el = 0.5 + hash01(seed, k, 4) * 0.45, R = 900;
      const dirTo = (a, e2, o) => o.set(Math.sin(a) * Math.cos(e2), Math.sin(e2), -Math.cos(a) * Math.cos(e2)).multiplyScalar(R).add(camera.position);
      const head = dirTo(az + side * 0.22 * u, el - 0.13 * u, _a), tail = dirTo(az + side * 0.22 * Math.max(0, u - 0.3), el - 0.13 * Math.max(0, u - 0.3), _b);
      const pos = mesh.geometry.attributes.position, w = 1.1;
      pos.setXYZ(0, tail.x, tail.y - w, tail.z); pos.setXYZ(1, tail.x, tail.y + w, tail.z); pos.setXYZ(2, head.x, head.y - w, head.z); pos.setXYZ(3, head.x, head.y + w, head.z);
      pos.needsUpdate = true;
      mesh.material.opacity = Math.sin(Math.PI * u) * 0.9;
      mesh.visible = true;
    };
  }

  // Something of this layer's own in the scene, taken out and freed with the stage. geometry,
  // map: false for what is shared with a template (the dragon's mesh and its texture).
  _own(obj, { geometry = true, map = true } = {}) {
    this.group.add(obj);
    this._owned.push(() => {
      obj.removeFromParent();
      obj.traverse((o) => {
        if (geometry) o.geometry?.dispose?.();
        const m = o.material;
        if (m) { if (map) m.map?.dispose?.(); m.dispose?.(); }
      });
    });
    return obj;
  }

  _addLines(flat, color) {
    if (!flat.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color }));
    l.name = 'world-life:lines'; l.frustumCulled = false;
    this._own(l);
  }

  // A prop this layer draws itself: the copy of `kind` standing at the entry's point leaves
  // the props layer (through its own remove()) once ours is ready, and comes back with "off".
  _takeOver(kind, en, when = null, within = 12) {
    const pl = this.props(), geo = this._geo;
    if (!pl || !geo || en.prop === false) return null;
    const spec = (geo.props || []).filter((p) => p && p.kind === kind).map((p) => ({ p, d: Math.hypot(p.x - en.x, p.y - en.y) })).sort((a, b) => a.d - b.d)[0];
    if (!spec || spec.d > within) return null;
    const epoch = this._epoch, go = () => { if (epoch !== this._epoch || this._replaced.has(spec.p.id)) return; if (pl.remove(spec.p.id)) this._replaced.set(spec.p.id, spec.p); };
    Promise.resolve(pl.ready).then(() => (when ? when.then(go) : go())).catch(() => {});
    return spec.p;
  }

  // ---------------------------------------------------------------- the dragon
  // The stage's dragon is the art stream's model (dragon.glb): this layer draws the same
  // file itself so that it can MOVE. The upper half of the model is turned in the vertex
  // shader about the neck (DRAGON_NECK): the head follows the ball, lifts to roar, and the
  // whole of it shifts its weight. Until the file is in, the plain prop stands.
  _plan_dragon(en) {
    const st = { en, mesh: null, yaw: 0, pitch: 0, roar: -1, snort: -1, next: (en.fireEveryS || 42) * 0.5, uniforms: { uDragon: { value: new THREE.Vector4(0, 0, 0, 0) }, uNeck: { value: new THREE.Vector4(0, 0, 1, 2) } } };
    this._dragons.push(st);
    const spec = (this._geo.props || []).filter((p) => p && p.kind === 'dragon').map((p) => ({ p, d: Math.hypot(p.x - en.x, p.y - en.y) })).sort((a, b) => a.d - b.d)[0];
    const from = spec && spec.d < 12 ? spec.p : null;
    const x = from ? from.x : en.x, y = from ? from.y : en.y, heightM = (from && from.heightM) || en.heightM || 30, rotDeg = from ? from.rotDeg || 0 : en.rotDeg || 0;
    const epoch = this._epoch;
    const loaded = this._loadDragon().then((tpl) => {
      if (!tpl || epoch !== this._epoch) return Promise.reject(new Error('no dragon'));
      const k = heightM / tpl.height, yaw = -(rotDeg * Math.PI) / 180, g = this.hAt(x, y) - 0.3;
      const mat = tpl.material.clone();
      mat.onBeforeCompile = (shader) => dragonShader(shader, st.uniforms);
      mat.customProgramCacheKey = () => 'world-life-dragon-v1';
      dressGlb(mat, this.style ? this.style() : null);
      const mesh = new THREE.Mesh(tpl.geometry, mat);
      mesh.name = 'world-life:dragon';
      mesh.position.set(x, g, -y); mesh.rotation.y = yaw; mesh.scale.setScalar(k);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      mesh.updateMatrixWorld(true);
      st.uniforms.uNeck.value.set(tpl.pivot.x, tpl.pivot.z, tpl.height * DRAGON_NECK.from, tpl.height * DRAGON_NECK.to);
      Object.assign(st, { mesh, tpl, k, yaw0: yaw, x, y, g });
      this._own(mesh, { geometry: false, map: false });
      this.onChange?.();
    });
    loaded.catch(() => {});
    if (from) this._takeOver('dragon', en, loaded);
    return () => (t, dt, camera, ball) => this._dragonStep(st, t, dt, ball);
  }
  _loadDragon() {
    if (this._dragonTpl) return this._dragonTpl;
    if (typeof fetch !== 'function' || typeof document === 'undefined') return Promise.resolve(null);
    this._dragonTpl = (async () => {
      const glb = await loadGlbParts(DRAGON_URL);
      if (!glb) return null;
      const part = glb.parts.reduce((a, b) => (b.geometry.attributes.position.count > a.geometry.attributes.position.count ? b : a));
      return { geometry: part.geometry, material: part.material, ...measureDragon(part.geometry.attributes.position) };
    })().catch((err) => { console.warn('[world-life] the dragon stays a plain prop:', err && err.message); return null; });
    return this._dragonTpl;
  }
  _dragonStep(st, t, dt, ball) {
    if (!st.mesh) return;
    const N = DRAGON_NECK, u = st.uniforms.uDragon.value, tpl = st.tpl;
    // where the ball is in the dragon's own frame (model units; +z is its front)
    let wantYaw = Math.sin(t * 0.23) * 0.22, wantPitch = Math.sin(t * 0.17) * 0.06;
    if (ball) {
      const dx = ball.x - st.x, dz = ball.z - -st.y, c = Math.cos(-st.yaw0), s = Math.sin(-st.yaw0);
      const lx = (dx * c + dz * s) / st.k, lz = (-dx * s + dz * c) / st.k, ly = (ball.y - st.g) / st.k - tpl.mouth.y;
      wantYaw = clamp(Math.atan2(lx, lz), -N.maxYaw, N.maxYaw) + Math.sin(t * 0.31) * 0.05;
      wantPitch = clamp(Math.atan2(ly, Math.hypot(lx, lz)), -N.maxDown, N.maxUp * 0.6);
    }
    const roaring = st.roar > 0 && t - st.roar < 2.6;
    if (roaring) { const k = smooth(0, 0.5, t - st.roar) * (1 - smooth(2.0, 2.6, t - st.roar)); wantPitch += (N.maxUp - wantPitch) * k; wantYaw *= 1 - 0.6 * k; }
    const e = dt > 0 ? 1 - Math.exp(-dt * (roaring ? 5 : 2.4)) : 1;
    st.yaw += (wantYaw - st.yaw) * e; st.pitch += (wantPitch - st.pitch) * e;
    u.set(st.yaw, st.pitch, Math.sin(t * 0.42) * 0.3 + Math.sin(t * 0.9) * 0.06, 0);
    // fire: skyward on a roar, a jet ahead of it on its own cycle (never with a ball in the air)
    const busy = this._shot && this._shot.live;
    if (roaring && !st.fired && t - st.roar > 0.55) { st.fired = true; this._dragonFire(st, 1.5, 1.3); }
    if (!roaring) st.fired = false;
    if (st.snort > 0 && t >= st.snort) { st.snort = -1; this._dragonFire(st, 0.5, 0.6); }
    if (t >= st.next) { st.next = t + (st.en.fireEveryS || 42) * (0.8 + 0.4 * hash01(st.en.seed || 0, Math.floor(t), 4)); if (!busy && this.bus.idle(t)) this._dragonFire(st, 1.1, 0.9); }
  }
  // the dragon's mouth and the way it points, in the world, with the head where it is now
  _dragonMouth(st, out, dir) {
    const tpl = st.tpl, m = tpl.mouth, pv = tpl.pivot, y0 = tpl.height * DRAGON_NECK.to;
    const bend = (x, y, z, o) => {
      let qx = x - pv.x, qy = y - y0, qz = z - pv.z;
      const cp = Math.cos(st.pitch), sp = Math.sin(st.pitch), y1 = qy * cp + qz * sp, z1 = -qy * sp + qz * cp;
      const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
      return o.set(qx * cy + z1 * sy + pv.x, y1 + y0, -qx * sy + z1 * cy + pv.z).applyMatrix4(st.mesh.matrixWorld);
    };
    bend(m.x, m.y, m.z, out);
    bend(m.x, m.y, m.z + 4, dir).sub(out).normalize();
  }
  _dragonFire(st, seconds, power) {
    if (!st.mesh) return;
    this._dragonMouth(st, _a, _b);
    const k = Math.sqrt((st.k * 15.7) / 30);      // a 30 m dragon breathes a 30 m dragon's fire; a small one rather more than its share
    // (never level at the ball: whatever the head is watching, the fire goes at least 25 degrees up)
    this._burst(_a.clone(), { kind: 'jet', color: '#ff5a14', speed: 30 * k * power, life: 1.25, size: 3.4 * k, gravity: -5, dir: [_b.x, Math.max(_b.y, 0.45) + 0.08, _b.z], spread: 0.16, over: seconds, share: 1 });
  }

  // ---------------------------------------------------------------- beats
  _burst(at, o) {
    if (!this.group) return -1;
    if (!this.bursts) { this.bursts = new BurstPool(this.budget.bursts); this.bursts.build(this.group, this._rand || rng(7)); }
    return this.bursts.fire(this._t, at, o);
  }
  _after(delay, fn, beat = null) { this._timeline.push({ at: this._t + Math.max(0, delay), fn, beat }); }
  _cue(name, intensity = 0.8) { if (!name) return; try { this.audio?.cue?.(name, { intensity }); } catch { /* sound is never worth an error */ } }

  // One beat of the world. Returns the beat that was accepted, or null (dropped: another holds the stage).
  react(type, opts = {}) {
    const at = fin(opts.at) && opts.at > 0 ? opts.at : 0;
    if (at > 0) { this._after(at, () => this.react(type, { ...opts, at: 0 })); return null; }
    if (type === 'lead') { this._lead = opts.playerSlot === 1 || opts.playerSlot === 2 ? opts.playerSlot : 0; this._applyLead(); return null; }
    if (type === 'scatter') { this.scatter({ pos: opts.pos || null, within: opts.pos ? 60 : null }); return null; }
    if (!this.group) { this.bus.last = { type, verdict: this.mode === 'off' ? 'off' : 'no-stage' }; return null; }
    const beat = this.bus.react(type, opts, this._t);
    if (!beat) return null;
    if (beat.cut) this._timeline = this._timeline.filter((s) => !s.beat || s.beat.type !== beat.cut);
    const stage = { theme: this._env.theme, night: this._env.night || this._env.timeOfDay === 'dusk', has: this.has, stadium: this.stadium };
    const steps = reactionPlan(type, stage);
    this._cue(beatCue(type, steps), clamp(0.5 + 0.25 * beat.intensity, 0, 1));
    for (const step of steps) {
      const fn = this[`_fx_${step.fx.replace(/-/g, '_')}`];
      if (!fn) continue;
      if (step.delay > 0) this._after(step.delay, () => fn.call(this, beat, step), beat);
      else fn.call(this, beat, step);
    }
    return beat;
  }

  // where a beat's fireworks go: behind the green as the players see it, or the stage's signature piece
  _anchor(from) {
    if (from === 'signature' && this._signature) return { ...this._signature };
    const x = this._pin[0] + this._dir[0] * 26, y = this._pin[1] + this._dir[1] * 26;
    return { x, y, z: this.hAt(this._pin[0], this._pin[1]) + 26 };
  }
  _fx_shockwave(beat) {
    if (!beat.flash || !beat.pos) return;       // a ring racing across the whole picture is a big flash: not with reduced motion
    this.ring.fire(this._t, beat.pos.x, beat.pos.y, this._env.theme === 'volcano' ? '#ffb070' : this._env.theme === 'neon' ? '#ff7ad1' : '#fff0c4');
  }
  _fx_scatter(beat, step) { this.scatter(step.all ? {} : { pos: beat.pos, within: 70 }); }
  _fx_erupt(beat, step) {
    const vs = this._volcanoes || [];
    vs.slice(0, 2).forEach((st, i) => this._after(i * 0.35, () => this._erupt(st, step.big ? 1.6 : 1), beat));
    if (step.big && beat.flash && vs.length) this._expo = { t0: this._t, kind: 'pulse' };
  }
  _fx_dragon_roar(beat) { for (const st of this._dragons || []) { st.roar = this._t; st.fired = false; } }
  _fx_dragon_snort(beat) { for (const st of this._dragons || []) st.snort = this._t + 0.05; }
  _fx_trail_fireworks(beat) {
    // the ball's own path, lit behind it: each burst goes off just AFTER the ball has passed,
    // well to one side and above, so nothing is ever between the camera and the ball
    if (!this._shot || !beat.trail) return;
    this._shot.trail = beat.trail.map((p, i) => ({ ...p, at: p.t + 0.3, i }));
  }
  _fx_fireworks(beat, step) {
    const a = this._anchor(step.from), cols = beatColors(beat.playerSlot), n = Math.round((step.count || 3) * (beat.intensity >= 1.5 ? 1.4 : 1)), seed = Math.floor(this._t * 10);
    const perp = [this._dir[1], -this._dir[0]];
    for (let i = 0; i < n; i++) {
      this._after(i * 0.3, () => {
        const lat = (hash01(seed, i, 1) - 0.5) * 70, up = hash01(seed, i, 2) * 22, back = hash01(seed, i, 3) * 18;
        this._burst(this._three(a.x + perp[0] * lat + this._dir[0] * back, a.y + perp[1] * lat + this._dir[1] * back, a.z + up), { kind: 'sphere', color: cols[i % cols.length], speed: 24, life: 2.0, size: 2.3, gravity: 2.2, white: 0.3 });
      }, beat);
    }
  }
  _fx_flares(beat, step) {
    // by day: flares going up, and a pop at the top
    const a = this._anchor(step.from), cols = beatColors(beat.playerSlot), perp = [this._dir[1], -this._dir[0]];
    const base = step.from === 'signature' && this._signature ? a.z : this._ground(a.x, a.y) + 1;
    for (let i = 0; i < 3; i++) {
      const lat = (i - 1) * 14, x = a.x + perp[0] * lat, y = a.y + perp[1] * lat;
      this._after(i * 0.16, () => this._burst(this._three(x, y, base), { kind: 'jet', color: cols[i % cols.length], speed: 34, life: 1.4, size: 2.4, gravity: 9, spread: 0.07, over: 0.6, share: 0.6 }), beat);
      this._after(1.05 + i * 0.16, () => this._burst(this._three(x, y, base + 32), { kind: 'sphere', color: cols[i % cols.length], speed: 19, life: 1.6, size: 2.2, gravity: 3, share: 0.8, white: 0.3 }), beat);
    }
  }
  _fx_sign(beat) {
    if (!beat.text) return;
    for (const sg of this._signs || []) {
      paintSign(sg.canvas, beat.text, { color: beat.playerSlot ? PLAYER_COLORS[beat.playerSlot] : '#ffd21f', bg: '#000000' });
      sg.tex.needsUpdate = true; sg.until = this._t + 6;
    }
  }
  _fx_searchlights(beat) {
    if (!beat.pos) return;
    // the beams cross in the air 14 m above the spot, never on the ball itself (and a beam fades to nothing toward its far end)
    const aim = this._three(beat.pos.x, beat.pos.y, this._ground(beat.pos.x, beat.pos.y) + 14);
    for (const st of this._lights || []) { st.aim = aim; st.until = this._t + 4.5; }
  }
  _fx_confetti(beat, step) {
    const pl = this.props();
    if (step.stadium && pl && pl.fx && typeof pl.fx.fire === 'function') { try { pl.fx.fire('confetti', { intensity: 1 }); return; } catch { /* its cannons are not there: ours */ } }
    const perp = [this._dir[1], -this._dir[0]], cols = beatColors(beat.playerSlot);
    for (const s of [-1, 1]) {
      const x = this._pin[0] + perp[0] * 13 * s + this._dir[0] * 6, y = this._pin[1] + perp[1] * 13 * s + this._dir[1] * 6;
      this._burst(this._three(x, y, this._ground(x, y) + 0.6), { kind: 'confetti', color: cols[0], speed: 16, life: 4.8, size: 0.5, gravity: 3.4, dir: [-perp[0] * s * 0.25, 1, perp[1] * s * 0.25], spread: 0.42, over: 0.55 });
    }
  }
  _fx_screen(beat) {
    const pl = this.props();
    if (beat.screen && pl && typeof pl.setScreen === 'function') { try { pl.setScreen(beat.screen); } catch { /* no big screen here */ } }
  }
  _fx_fish(beat) {
    if (!beat.pos || !this._fishSpare) return;
    const z = this._water(beat.pos.x, beat.pos.y), seed = Math.floor(this._t * 10);
    this._forced = [0, 1, 2].map((i) => {
      const a = hash01(seed, i, 1) * TAU, d = 1.3 + hash01(seed, i, 2) * 1.6, dir = a + 1.9;
      return { t0: this._t + 0.25 + i * 0.16, x: beat.pos.x + Math.sin(a) * d, y: beat.pos.y + Math.cos(a) * d, z, hx: Math.sin(dir), hy: Math.cos(dir) };
    });
  }
  _fx_ice(beat) {
    if (!beat.pos) return;
    const at = this._three(beat.pos.x, beat.pos.y, this._water(beat.pos.x, beat.pos.y) + 0.15);
    this._burst(at, { kind: 'splash', color: '#dff4ff', speed: 7, life: 0.9, size: 0.45, gravity: 11, share: 0.6 });
    this._burst(at, { kind: 'puff', color: '#ffffff', speed: 3, life: 1.6, size: 2.2, gravity: 0.5, spread: 0.9, share: 0.15 });
  }
  _fx_croc(beat) {
    const near = (this._crocs || []).map((st) => ({ st, d: beat.pos ? Math.hypot(st.en.x - beat.pos.x, st.en.y - beat.pos.y) : 1e9 })).sort((a, b) => a.d - b.d)[0];
    if (!near || near.d > 80) return this._fx_fish(beat);
    near.st.lunge = this._t + 0.15; near.st.to = beat.pos;
    const en = near.st.en;
    this._after(0.7, () => this._burst(this._three(en.x, en.y, this._water(en.x, en.y) + 0.2), { kind: 'splash', color: '#dff3ee', speed: 7, life: 0.9, size: 0.6, gravity: 12, share: 0.5 }), beat);
    return undefined;
  }
  _fx_lava_burp(beat) {
    if (!beat.pos) return;
    const at = this._three(beat.pos.x, beat.pos.y, this._water(beat.pos.x, beat.pos.y) + 0.3);
    this._after(0.25, () => {
      this._burst(at, { kind: 'jet', color: '#ffb23a', speed: 13, life: 1.5, size: 1.5, gravity: 10, spread: 0.55, over: 0.35, share: 0.7 });
      this._burst(at, { kind: 'puff', color: '#3a2c28', speed: 4, life: 2.6, size: 4.5, gravity: -1.6, spread: 0.6, share: 0.2 });
    }, beat);
  }
  _fx_snowman(beat) {
    // its head comes off: the plain prop gives way, behind a puff of snow, to a body and a head that rolls
    const S = this._snow, pl = this.props();
    if (!S || !beat.pos || S.fallen.length >= S.body.n) return;
    const p = this._snowmen.map((q) => ({ q, d: Math.hypot(q.x - beat.pos.x, q.y - beat.pos.y) })).sort((a, b) => a.d - b.d)[0];
    if (!p || p.d > 3 || S.fallen.some((f) => f.id === p.q.id)) return;
    const q = p.q, k = (q.heightM || 3.4) / 3.9, g = this._ground(q.x, q.y) - 0.3;
    if (pl && typeof pl.remove === 'function' && pl.remove(q.id)) this._replaced.set(q.id, q);
    const away = this._awayFrom(q.x, q.y);
    S.fallen.push({ id: q.id, x: q.x, y: q.y, g, k, yaw: -((q.rotDeg || 0) * Math.PI) / 180, t0: this._t, dir: away });
    this._burst(this._three(q.x, q.y, g + 3.0 * k), { kind: 'puff', color: '#ffffff', speed: 5, life: 1.3, size: 2.4 * k, gravity: 1, spread: 0.9, share: 0.3 });
  }
  _fx_laugh(beat) {
    // the nearest sitting bird has a good laugh (seen, not heard)
    const ps = (this._perches || []).filter((st) => this._t - st.at > SCATTER_S);
    if (!ps.length) return this._fx_startle(beat);
    let best = null;
    for (const st of ps) st.spots.forEach((sp, i) => { const d = beat.pos ? Math.hypot(sp[0] - beat.pos.x, sp[1] - beat.pos.y) : i; if (!best || d < best.d) best = { st, i, d, sp }; });
    best.st.laugh = this._t; best.st.laughI = best.i;
    this._laughSprite(best.sp);
    return undefined;
  }
  _fx_startle(beat) {
    const near = (this._flocks || []).map((st) => ({ st, d: beat.pos ? Math.hypot(st.en.x - beat.pos.x, st.en.y - beat.pos.y) : 0 })).sort((a, b) => a.d - b.d)[0];
    if (near && this._t - near.st.at > SCATTER_S + 4) near.st.at = this._t;
  }
  _laughSprite(sp) {
    if (typeof document === 'undefined') return;
    if (!this._laugh) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 128;
      const g = c.getContext('2d');
      g.font = '900 78px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 12; g.strokeStyle = '#1b1d22'; g.strokeText('HA HA!', 128, 66); g.fillStyle = '#fff3b0'; g.fillText('HA HA!', 128, 66);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
      sprite.name = 'world-life:laugh'; sprite.renderOrder = 36; sprite.visible = false;
      this._own(sprite);
      this._laugh = { sprite, t0: -1 };
    }
    this._laugh.sprite.position.set(sp[0], sp[2] + 1.6, -sp[1]);
    this._laugh.t0 = this._t;
  }
  _fx_tumbleweed(beat) {
    const T = this._tumble;
    if (!T || !beat.pos) return this._fx_laugh(beat);
    // it rolls across the hole some way AHEAD of the ball, never over it
    const toPin = [this._pin[0] - beat.pos.x, this._pin[1] - beat.pos.y], d = Math.hypot(toPin[0], toPin[1]) || 1, ux = toPin[0] / d, uy = toPin[1] / d;
    // ... on ground that is the ball's own: not down a cliff the ball stopped at the top of
    const g0 = this._ground(beat.pos.x, beat.pos.y);
    const ahead = [12, 16, 9, 21, 26, 7].find((a) => a < d && Math.abs(this._ground(beat.pos.x + ux * a, beat.pos.y + uy * a) - g0) < 2.5) || 8;
    const side = this._wind.hx * uy - this._wind.hy * ux >= 0 ? 1 : -1;
    Object.assign(T, { t0: this._t, x: beat.pos.x + ux * ahead, y: beat.pos.y + uy * ahead, px: uy * side, py: -ux * side });
    return undefined;
  }
  _fx_colours(beat) {
    if (!beat.playerSlot) return;
    if (beat.type === 'match-over') { this._lead = beat.playerSlot; this._applyLead(); return; }
    // the hole's winner flies their colour for the beat; after it the colours are the LEADER's again
    this._applyLead(beat.playerSlot);
    this._after(beat.until - beat.at, () => this._applyLead());
  }
  _fx_lights_dip(beat) { if (beat.flash) this._expo = { t0: this._t, kind: 'dip' }; }
  _fx_lights_flare(beat) {
    this._cue('world-lights-flare', 0.9);
    const pl = this.props();
    if (beat.flash && pl && pl.fx && typeof pl.fx.fire === 'function') { try { pl.fx.fire('pyro', { intensity: 2 }); } catch { /* no cannons */ } }
    else if (beat.flash) this._fx_flares(beat, { from: 'signature' });
  }
  _fx_finale(beat) {
    // the winner's colour floods the sky
    const a = this._anchor('green'), cols = beatColors(beat.playerSlot), perp = [this._dir[1], -this._dir[0]], seed = Math.floor(this._t * 10) + 5;
    const every = this.stadium ? 0.62 : 0.42, n = Math.floor(8 / every);
    for (let i = 0; i < n; i++) {
      this._after(0.3 + i * every, () => {
        const lat = (hash01(seed, i, 1) - 0.5) * 110, up = hash01(seed, i, 2) * 30, back = hash01(seed, i, 3) * 40;
        this._burst(this._three(a.x + perp[0] * lat + this._dir[0] * back, a.y + perp[1] * lat + this._dir[1] * back, a.z + up), { kind: 'sphere', color: cols[i % 3 === 2 ? 2 : 0], speed: 28, life: 2.3, size: 2.7, gravity: 2, white: i % 3 === 1 ? 0.6 : 0.2 });
      }, beat);
    }
    this._after(0.2, () => this._fx_confetti(beat, { stadium: false }), beat);
    this._after(3.4, () => this._fx_confetti(beat, { stadium: false }), beat);
  }

  // the leading player's colour on everything that flies a colour (0: each its own again)
  _applyLead(slot = this._lead) {
    this._shown = slot;
    for (const tt of this._teamTinted || []) {
      for (let i = 0; i < tt.n; i++) this._tint(tt.h, i, slot ? PLAYER_COLORS[slot] : (tt.en.color || tt.tints[(i + (tt.en.seed || 0)) % tt.tints.length]));
      // (the art stream's model: its own colours washed with the player's)
      for (const m of tt.h.mats || []) { if (slot) m.color.set(PLAYER_COLORS[slot]).lerp(m.userData.own, 0.25); else m.color.copy(m.userData.own); }
    }
    this._windDirty = true;
  }

  // ---------------------------------------------------------------- the game's events
  // A shot is struck: its beats go on the bus, each for its own frame, and the path it will
  // fly is remembered (movers get out of its way, birds it passes take fright).
  shotStart(shot, ctx = {}) {
    if (!this.group) { this._shot = null; return []; }
    const beats = shotReactions(shot, { theme: this._env.theme, pin: { x: this._pin[0], y: this._pin[1] }, snowmen: (this._snowmen || []).map((p) => ({ id: p.id, x: p.x, y: p.y, r: 1.3 * ((p.heightM || 3.4) / 3.4) + 0.5, top: this.hAt(p.x, p.y) + (p.heightM || 3.4) })), ...ctx });
    this.bus.schedule(beats);
    this._shot = { clock: 0, live: true, flight: flightSamples(shot), from: 0, trail: null, fed: false, flightS: shot?.sim?.flightTime ?? 0 };
    return beats;
  }
  // The shot's own clock, each frame it plays (scene.playShot onProgress).
  shotProgress(t) { if (this._shot && fin(t)) { this._shot.clock = t; this._shot.fed = true; } }
  // The match moved on (the server's snapshot, as public/arcade/match.js gets it).
  matchUpdate(m) {
    const beats = matchReactions(this._match, m);
    this._match = m ? { id: m.id, phase: m.phase, aborted: m.aborted, players: (m.players || []).map((p) => ({ id: p.id, slot: p.slot, holesWon: p.holesWon })), holeResults: (m.holeResults || []).map((r) => ({ winnerId: r.winnerId, reason: r.reason })), winnerId: m.winnerId, stage: m.stage ? { kind: m.stage.kind } : null, nextStage: m.nextStage ? { kind: m.nextStage.kind } : null } : null;
    for (const b of beats) this.react(b.type, { ...b, at: b.delayS || 0 });
    return beats;
  }

  // ---------------------------------------------------------------- every frame
  // t: the scene's clock (s). dt: the frame. camera. o: { line (the address camera's pass
  // line, see-over-rig.js passLine()), ball (the ball's THREE position), flying }.
  update(t, dt = 0, camera = null, o = null) {
    this._t = t;
    if (!this.group) return;
    this._cam = camera;
    this._line = (o && o.line) || null;
    this._ease = dt > 0 ? Math.min(1, dt * 7) : 1;
    const ball = (o && o.ball) || null, S = this._shot;
    // the shot's clock: the scene feeds it while the ball moves; after that it runs on by itself
    if (S && S.live) {
      if (!S.fed) S.clock += dt;
      S.fed = false;
      while (S.from < S.flight.length && S.flight[S.from].t < S.clock - 0.4) S.from++;
      for (const b of this.bus.due(S.clock)) this.react(b.type, { ...b, at: 0 });
      if (S.trail) {
        while (S.trail.length && S.trail[0].at <= S.clock) {
          const p = S.trail.shift(), side = p.i % 2 ? 1 : -1, perp = [this._dir[1] * side, -this._dir[0] * side];
          this._burst(this._three(p.x + perp[0] * (26 + (p.i % 3) * 7), p.y + perp[1] * (26 + (p.i % 3) * 7), p.z + 10 + (p.i % 2) * 8), { kind: 'sphere', color: NEON[p.i % NEON.length], speed: 20, life: 1.5, size: 1.9, gravity: 2.5, share: 0.7, white: 0.25 });
        }
        if (!S.trail.length) S.trail = null;
      }
      if (S.from >= S.flight.length && !this.bus.queue.length && !S.trail && S.clock > (S.flight.length ? S.flight[S.flight.length - 1].t : 0) + 1) S.live = false;
      // a ball that passes close frightens the birds there
      if (ball && S.clock < S.flightS + 1.5) this._frighten(ball.x, -ball.z, ball.y, t);
    }
    if (this._timeline.length) {
      const due = this._timeline.filter((s) => s.at <= t);
      if (due.length) { this._timeline = this._timeline.filter((s) => s.at > t); for (const s of due) s.fn(); }
    }
    const L = this._life.uniforms;
    L.uLifeTime.value = t;
    L.uLifeGlow.value = this._env.night ? 1.5 : this._env.timeOfDay === 'dusk' ? 1.2 : 0.75;
    for (const run of this.movers) if (run) run(t, dt, camera, ball);
    this._reactionPieces(t);
    for (const c of this.casts.values()) if (c.dirty) { c.mesh.instanceMatrix.needsUpdate = true; c.dirty = false; }
    const amb = this._env.night ? 0.42 : this._env.timeOfDay === 'dusk' ? 0.62 : 1;
    if (camera) {
      const px = pxPerMetre(camera, this.renderer ? this.renderer.domElement.height : 1080);
      const E = this.emitters.uniforms; E.uTime.value = t; E.uPx.value = px; E.uAmb.value = amb; E.uWind.value.set(this._wind.x, 0, this._wind.z);
      if (this.bursts) { this.bursts.uniforms.uPx.value = px; this.bursts.uniforms.uAmb.value = amb; this.bursts.update(t); }
      this.weather.uniforms.uPx.value = px; this.weather.uniforms.uAmb.value = amb;
      this.weather.update(t, camera, this._wind.x, this._wind.z, this._wind.mph);
    }
    this.ring.update(t, (x, y) => this._ground(x, y), this.V);
    this._exposure(t);
  }

  _frighten(bx, by, bz, t) {
    for (const st of this._flocks) {
      if (t - st.at < SCATTER_S + 5) continue;
      if (Math.hypot(bx - st.en.x, by - st.en.y) < st.en.r * 1.1 + 16 && Math.abs(bz - (st.ground + (st.en.lift ?? 34))) < 24) st.at = t;
    }
    for (const st of this._perches) {
      if (t - st.at < SCATTER_S + 5) continue;
      for (const sp of st.spots) if (Math.hypot(bx - sp[0], by - sp[1]) < 13 && Math.abs(bz - sp[2]) < 9) { st.at = t; break; }
    }
  }

  // the pieces only a beat brings out: fish at a splash, the tumbleweed, a snowman's head
  _reactionPieces(t) {
    const F = this._fishSpare;
    if (F && this._forced) {
      let any = false;
      this._forced.forEach((j, i) => {
        const u = (t - j.t0) / 0.95;
        if (u < 0 || u >= 1) { this._hide(F, i); if (u < 1) any = true; return; }
        any = true;
        if (!j.wet) { j.wet = true; this._burst(this._three(j.x, j.y, j.z + 0.1), { kind: 'splash', color: '#e6f6ff', speed: 4, life: 0.6, size: 0.35, gravity: 11, share: 0.2 }); }
        this._tint(F, i, i % 2 ? '#c9d6e2' : '#ffb347');
        this._put(F, i, j.x + j.hx * 1.7 * (u - 0.5), j.y + j.hy * 1.7 * (u - 0.5), j.z + 4 * 1.25 * u * (1 - u) - 0.15, Math.atan2(j.hx, -j.hy), Math.atan2(5 * (1 - 2 * u), 1.7), 0, 1.7, 1.7, 1.7, 0);
      });
      if (!any) this._forced = null;
    }
    const T = this._tumble;
    if (T && T.t0 >= 0) {
      const age = t - T.t0, u = age / 3.4;
      if (u >= 1) { T.t0 = -1; this._hide(T.h, 0); } else {
        const s = (u - 0.5) * 34, x = T.x + T.px * s, y = T.y + T.py * s, grow = smooth(0, 0.12, u) * (1 - smooth(0.88, 1, u));
        this._put(T.h, 0, x, y, this._ground(x, y) + Math.abs(Math.sin(age * 5.5)) * 0.7, Math.atan2(T.px, -T.py), -age * 6, 0, 2.1 * grow, 2.1 * grow, 2.1 * grow, 0);
      }
    }
    const S = this._snow;
    if (S) S.fallen.forEach((f, i) => {
      this._put(S.body, i, f.x, f.y, f.g, f.yaw, 0, 0, f.k, f.k, f.k, 0);
      // the head tips off the back, drops, and rolls a couple of metres
      const age = t - f.t0, fall = Math.min(1, age / 0.55), roll = smooth(0.45, 2.4, age), d = 0.9 * fall + 2.4 * roll;
      const z = f.g + (2.75 * (1 - fall * fall)) * f.k + 0.05;
      this._put(S.head, i, f.x + f.dir[0] * d * f.k, f.y + f.dir[1] * d * f.k, z, f.yaw, 0, 0, f.k, f.k, f.k, 0);
      const c = this.casts.get('snowman-head');
      if (c) { _e.set(fall * 1.4 + roll * 5.5, Math.atan2(f.dir[0], -f.dir[1]), 0, 'YXZ'); _m.compose(_p.set(f.x + f.dir[0] * d * f.k, z + 0.5 * f.k * Math.min(1, fall * 2), -(f.y + f.dir[1] * d * f.k)), _q.setFromEuler(_e), _s.setScalar(f.k)); c.mesh.setMatrixAt(S.head.base + i, _m); c.dirty = true; }
    });
    const Lg = this._laugh;
    if (Lg && Lg.t0 >= 0) {
      const age = t - Lg.t0;
      Lg.sprite.visible = age < 2.2;
      if (age < 2.2) {
        const far = this._cam ? this._cam.position.distanceTo(Lg.sprite.position) : 40;
        const k = clamp(far * 0.06, 0.7, 7) * (smooth(0, 0.15, age) * (1 - smooth(1.8, 2.2, age))) * (1 + 0.08 * Math.sin(age * 16));
        Lg.sprite.scale.set(k * 2, k, 1);
      } else Lg.t0 = -1;
    }
  }

  // The lights of the whole stage, for the two beats that play with them: the dip and flare
  // of SUDDEN DEATH, and the pulse of an eruption. It is the renderer's exposure for a
  // couple of seconds, given back exactly; a beat only asks for it when the player has not
  // asked for reduced motion (ReactionBus: beat.flash).
  _exposure(t) {
    const X = this._expo, r = this.renderer;
    if (!X || !r) return;
    const age = t - X.t0;
    let k = 1, done = false;
    if (X.kind === 'dip') { k = age < 1.5 ? 1 - 0.66 * smooth(0, 0.4, age) : 0.34 + (1.38 - 0.34) * smooth(1.5, 1.66, age) - 0.38 * smooth(1.7, 2.7, age); done = age > 2.8; }
    else { k = 1 + 0.16 * Math.exp(-age * 6); done = age > 0.7; }
    if (X.base == null || r.toneMappingExposure !== X.last) X.base = r.toneMappingExposure;     // (someone else set it meanwhile: that is the level to come back to)
    if (done || age < 0) { r.toneMappingExposure = X.base; this._expo = null; return; }
    X.last = r.toneMappingExposure = X.base * k;
  }
  _restoreExposure() { const X = this._expo; if (X && this.renderer && X.base != null && this.renderer.toneMappingExposure === X.last) this.renderer.toneMappingExposure = X.base; this._expo = null; }

  // Where the first copy of every entry drawn with a model is now: [{ x, y, z }] (the capture
  // tool points a camera at a boat wherever the boat has got to).
  where(model) { return (this._handles || []).filter((h) => h.model === model && h.at).map((h) => ({ x: h.at[0], y: h.at[1], z: h.at[2] })); }

  // what the layer is drawing now (the capture tool, the tests, docs/living-world.md's numbers)
  stats() {
    const casts = {};
    let instances = 0, tris = 0;
    for (const [k, c] of this.casts) { casts[k] = c.n; instances += c.n; tris += c.n * (c.mesh.geometry.attributes.position.count / 3); }
    return {
      mode: this.mode, quality: this._env.quality, entries: this.entries.length, kinds: [...this.has], casts, instances, tris,
      draws: this.casts.size + (this.emitters.mesh ? 1 : 0) + (this.weather.mesh ? 1 : 0) + (this.beams.mesh ? 1 : 0) + (this._owned || []).length + (this.bursts && this.bursts.live ? 1 : 0) + (this.ring.live ? 1 : 0),
      particles: this.emitters.count, weather: this.weather.mesh ? this.weather.mesh.geometry.attributes.position.count : 0, beams: this._beamCount || 0,
      bursts: this.bursts ? this.bursts.fired : 0, beats: this.bus.played, last: this.bus.last, lead: this._lead, replaced: [...this._replaced.keys()],
      dragon: (this._dragons || []).map((d) => (d.mesh ? { yaw: +d.yaw.toFixed(3), pitch: +d.pitch.toFixed(3) } : null)),
    };
  }
}

// A dragon's neck and mouth, measured from its vertices: the pivot is the middle of the neck
// (the vertices between 45 and 60 % of its height), the mouth the foremost point of the head.
export function measureDragon(pos) {
  let top = -Infinity;
  for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i));
  let n = 0, px = 0, pz = 0, mouth = { x: 0, y: top * 0.8, z: -Infinity };
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > top * 0.45 && y < top * 0.6) { px += pos.getX(i); pz += pos.getZ(i); n++; }
    if (y > top * 0.66 && y < top * 0.9 && pos.getZ(i) > mouth.z) mouth = { x: pos.getX(i), y, z: pos.getZ(i) };
  }
  return { height: top, pivot: { x: n ? px / n : 0, z: n ? pz / n : 0 }, mouth };
}

// The dragon's material learns to turn its head: everything above the neck is pitched and
// then turned about the vertical through the neck's middle, by how far up the neck it is.
export function dragonShader(shader, uniforms) {
  shader.uniforms.uDragon = uniforms.uDragon;
  shader.uniforms.uNeck = uniforms.uNeck;
  const bend = /* glsl */`
    uniform vec4 uDragon;   // yaw, pitch, sway, 0
    uniform vec4 uNeck;     // pivot x, pivot z, from y, to y
    vec3 dragonBend(vec3 p, float w, bool point) {
      vec3 pv = point ? vec3(uNeck.x, uNeck.w, uNeck.y) : vec3(0.0);
      vec3 q = p - pv;
      float cp = cos(uDragon.y * w), sp = sin(uDragon.y * w);
      q = vec3(q.x, q.y * cp + q.z * sp, -q.y * sp + q.z * cp);
      float cy = cos(uDragon.x * w), sy = sin(uDragon.x * w);
      q = vec3(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy);
      return q + pv;
    }`;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${bend}`)
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      float dragonW = smoothstep(uNeck.z, uNeck.w, position.y);
      objectNormal = dragonBend(objectNormal, dragonW, false);`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      transformed = dragonBend(transformed, dragonW, true);
      transformed.x += uDragon.z * smoothstep(0.0, uNeck.w, position.y);`);
}
