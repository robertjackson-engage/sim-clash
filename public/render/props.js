// Course props: small human-scale objects that say "maintained golf course".
// A bunker rake lying in each sand bunker — the iconic detail that grounds the
// bunkers at human scale (one instanced, shadow-casting draw call) — and, below,
// the GLB set pieces a course's data places on it (PropsLayer).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SEE_OVER } from './see-over.js';   // v2:seeover

// A rake lying along +x: a thin handle (0..1.5m) with a wider toothed head at
// the far end. Merged to one geometry so the whole fleet is a single draw call.
function rakeGeometry() {
  const handle = new THREE.BoxGeometry(1.5, 0.05, 0.05); handle.translate(0.75, 0, 0);
  const neck = new THREE.BoxGeometry(0.14, 0.05, 0.08); neck.translate(1.5, 0, 0);
  const head = new THREE.BoxGeometry(0.11, 0.07, 0.6); head.translate(1.58, 0, 0);
  return mergeGeometries([handle, neck, head]);
}

// bunkerSurfaces: [{kind:'bunker', poly:[[x,y]..]}], hAt(x,y)->z, V: sim->three.
// One rake per bunker, laid flat just inside the rim. Returns { meshes }.
export function buildRakes(bunkerSurfaces, hAt, V) {
  const spots = [];
  for (const s of bunkerSurfaces) {
    if (!s.poly || s.poly.length < 3) continue;
    let cx = 0, cy = 0;
    for (const [x, y] of s.poly) { cx += x; cy += y; }
    cx /= s.poly.length; cy /= s.poly.length;
    // a point ~60% from the centroid toward one rim vertex -> sits just inside the sand
    const v = s.poly[(s.poly.length * 0.37) | 0];
    spots.push({ x: cx + (v[0] - cx) * 0.6, y: cy + (v[1] - cy) * 0.6 });
  }
  if (!spots.length) return { meshes: [] };
  const geo = rakeGeometry();
  const mat = new THREE.MeshStandardMaterial({ color: 0xc6a268, roughness: 0.7, metalness: 0 });
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  mesh.castShadow = true;   // a small cast shadow grounds the rake on the sand
  mesh.receiveShadow = false;
  mesh.userData.isRakes = true; // probe/debug hook
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < spots.length; i++) {
    const sp = spots[i];
    const h = hAt(sp.x, sp.y);
    q.setFromAxisAngle(up, (i * 2.39996) % (Math.PI * 2)); // varied heading per bunker
    m4.compose(V(sp.x, sp.y, h + 0.04), q, sc); // just above the sand surface
    mesh.setMatrixAt(i, m4);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return { meshes: [mesh] };
}

// ---------------------------------------------------------------- GLB set pieces
// Models placed on a course: a lighthouse, palms, a rock arch, a volcano on the horizon.
// They come from the course's own data,
//
//   course.props = [{ id, kind, url?, x, y, z?, rotDeg?, heightM?, scale?, sinkM?, castShadow? }, ...]
//
// in the course frame (metres: x east, y north, z up). `kind` names a model served at
// /arcade/props/<kind>.glb; `url` (a path on this server) names any other. Each model is
// fetched and parsed once however many times it stands on the course, and every copy of
// it is one instanced draw per mesh. A model that is not there (404) is skipped without a
// word; one that fails to parse is skipped with a warning. Nothing here runs, and the
// glTF loader itself is not even fetched, until a course has props.
//
// How a model is stood on the ground: its bounding box is measured after load, it is
// scaled so the box is `heightM` tall (a default per kind below; without either it keeps
// its own size), times `scale` (a number, or [x, y, z] in the model's axes), turned
// `rotDeg` clockwise seen from above, and set down so the BOTTOM of the box rests on the
// terrain at (x, y), sunk `sinkM` (0.3 m) so the downhill side of a slope never shows
// daylight. With `z` given the bottom sits at that height instead and nothing is sunk.

//
// PROCEDURAL KINDS. Every other kind an arcade stage may place (docs/dev/arcade-v2-contract.md)
// is built in code, not fetched (prop-models.js: one merged geometry a kind, one material
// for them all, instanced like the GLB ones). Three of them do not stand on the ground the
// way a model does:
//   target-ring   lies flat, draped over the terrain; heightM is its DIAMETER
//   bridge        spans along its rotDeg heading (0 = north); heightM is its LENGTH; its
//                 deck ends rest on the higher of the two banks
//   balloon, blimp   float PROP_FLOAT_M above their ground point
// rotDeg 0 stands a procedural model with its front to the south (toward a tee south of it).

export const PROP_BASE_URL = '/arcade/props/';
export const PROP_SINK_M = 0.3;
// Kinds that are GLB models under /arcade/props/; every other known kind is procedural.
export const PROP_GLB_KINDS = Object.freeze(['lighthouse', 'palm', 'rock-arch', 'volcano']);
// The procedural kinds (prop-models.js has a builder for each: test/arcade-look.test.mjs).
export const PROP_PROCEDURAL_KINDS = Object.freeze([
  'cactus', 'mesa', 'pine', 'snowman', 'cabin', 'ice-spire', 'lava-rock', 'lava-fall', 'sakura-tree', 'torii', 'pagoda',
  'stone-lantern', 'bridge', 'temple', 'idol', 'pyramid', 'obelisk', 'sphinx', 'skyscraper', 'neon-sign', 'billboard',
  'grandstand', 'floodlight', 'target-ring', 'balloon', 'blimp', 'windmill', 'shipwreck', 'crystal', 'torch', 'flag-banner',
  // the second wave: set pieces and life
  'waterfall', 'castle', 'dragon', 'giant-tree', 'ruins', 'jumbotron', 'fireworks', 'cloud', 'airship', 'statue',
  'fountain', 'tiki', 'hut', 'boat', 'gate', 'tower', 'rock-spire', 'launch-ramp', 'crowd', 'bird-flock',
]);
// A GLB may stand in for any kind: public/arcade/props/manifest.json lists the ones the art
// stream has made, { "kinds": { "<kind>": { "file": "<kind>.glb", "tris": n, "heightM": h } } },
// and a kind listed there is drawn from its file (Y up, front +Z, origin at the centre of
// its base) with the procedural model as the fallback when the file is missing or broken.
export const PROP_MANIFEST = 'manifest.json';
// Kinds that are never a GLB: they are not models standing on the ground.
const PROP_NEVER_GLB = Object.freeze(['target-ring']);
export const PROP_PROC_SCHEME = 'proc:';
// The height (m) a kind stands at when its entry gives none (a bridge's length, a ring's diameter).
export const PROP_KIND_HEIGHT_M = Object.freeze({
  lighthouse: 28, palm: 9, 'rock-arch': 18, volcano: 140,
  cactus: 6, mesa: 40, pine: 14, snowman: 3, cabin: 7, 'ice-spire': 18, 'lava-rock': 5, 'lava-fall': 30,
  'sakura-tree': 9, torii: 9, pagoda: 24, 'stone-lantern': 2.4, bridge: 20, temple: 30, idol: 10,
  pyramid: 60, obelisk: 20, sphinx: 20, skyscraper: 120, 'neon-sign': 10, billboard: 12, grandstand: 14,
  floodlight: 32, 'target-ring': 20, balloon: 22, blimp: 18, windmill: 22, shipwreck: 12, crystal: 6,
  torch: 3.5, 'flag-banner': 8,
  waterfall: 30, castle: 30, dragon: 16, 'giant-tree': 45, ruins: 9, jumbotron: 18, fireworks: 40, cloud: 14,
  airship: 22, statue: 12, fountain: 6, tiki: 4, hut: 5, boat: 7, gate: 14, tower: 30, 'rock-spire': 26,
  'launch-ramp': 8, crowd: 4, 'bird-flock': 8,
});
// How far above its ground point a floating kind hangs (m, to the bottom of the model):
// fireworks burst from 60 m up, birds circle at 40 m, clouds drift at 150 m.
export const PROP_FLOAT_M = Object.freeze({ balloon: 60, blimp: 120, fireworks: 60, cloud: 150, airship: 100, 'bird-flock': 40 });
// The distance (m) by which a copy of a procedural prop has shrunk away to nothing: far
// enough that it was a handful of pixels. Big things are never culled.
export const propCullM = (heightM) => (heightM >= 12 ? 1e6 : Math.max(340, (heightM || 3) * 85));

// setSeeThrough(): only models at least this far across (the radius of the circle inside the
// box, m) can swallow a camera or a ball; a lantern or a cactus never does.
export const PROP_VIEWER_MIN_R = 3;
const PROP_ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

// Which of n variants of a model a prop gets: a stable hash (FNV-1a) of its id, or of its
// position when it has none. The same prop always gets the same one.
export function propVariantIndex(prop, n) {
  if (!(n > 1)) return 0;
  const key = prop && prop.id != null ? String(prop.id) : `${prop ? prop.x : 0},${prop ? prop.y : 0}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) % n;
}

const KIND_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const BACKSLASH = String.fromCharCode(92);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Where a prop's model is fetched from, or null when the entry names nothing usable. Only
// paths on this server: a course file cannot make the game call out to another host.
export function propUrl(spec, baseUrl = PROP_BASE_URL) {
  if (!spec) return null;
  if (typeof spec.url === 'string' && spec.url) {
    const u = spec.url.trim();
    return u.startsWith('/') && !u.startsWith('//') && !u.includes(BACKSLASH) ? u : null;
  }
  if (typeof spec.kind === 'string' && KIND_RE.test(spec.kind)) {
    // a procedural kind is built, not fetched (prop-models.js); the rest are GLB files
    return PROP_PROCEDURAL_KINDS.includes(spec.kind) ? `${PROP_PROC_SCHEME}${spec.kind}` : `${baseUrl}${spec.kind}.glb`;
  }
  return null;
}

// A bridge's scale [x, y, z] for a length: it stretches along its span, and grows a little
// wider and higher with it (a 40 m bridge is not twice as wide as a 20 m one).
export function bridgeScale(lengthM, builtLengthM) {
  const k = lengthM / builtLengthM, w = Math.min(1.5, Math.max(0.8, Math.sqrt(k)));
  return [w, w, k];
}

// One course.props entry, checked and with its defaults filled in; null when it cannot
// be placed (no position, no model).
export function normalizeProp(spec, baseUrl = PROP_BASE_URL) {
  if (!spec || typeof spec !== 'object') return null;
  const x = num(spec.x), y = num(spec.y), url = propUrl(spec, baseUrl);
  if (x == null || y == null || !url) return null;
  const kind = typeof spec.kind === 'string' ? spec.kind : null;
  const z = num(spec.z);
  const h = num(spec.heightM);
  let scale = 1;
  if (Array.isArray(spec.scale) && spec.scale.length === 3 && spec.scale.every((v) => num(v) > 0)) scale = spec.scale.slice();
  else if (num(spec.scale) > 0) scale = spec.scale;
  return {
    id: spec.id != null ? String(spec.id) : null,
    kind, url, x, y, z,
    rotDeg: num(spec.rotDeg) ?? 0,
    heightM: h > 0 ? h : (kind && PROP_KIND_HEIGHT_M[kind]) || null,
    scale,
    sinkM: num(spec.sinkM) ?? (z == null ? PROP_SINK_M : 0),
    castShadow: spec.castShadow !== false,
  };
}

// The model's scale along its own axes [x, y, z]: `heightM` over the box's height (1
// without a height), times the entry's scale.
export function propScale(prop, boxHeight) {
  const k = prop.heightM && boxHeight > 1e-6 ? prop.heightM / boxHeight : 1;
  const s = Array.isArray(prop.scale) ? prop.scale : [prop.scale, prop.scale, prop.scale];
  return [k * s[0], k * s[1], k * s[2]];
}

// The height (course z, m) of the model's origin so the bottom of its box (boxMinY, in
// the model's own units) rests on `ground`, less the sink.
export function propOriginZ(prop, ground, boxMinY, scaleY) {
  return ground - prop.sinkM - boxMinY * scaleY;
}

let gltfModule = null;   // three's GLTFLoader, fetched the first time a course has props
let modelsModule = null; // prop-models.js (the procedural kinds), likewise

function disposeMaterial(m) {
  for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
  m.dispose();
}

export class PropsLayer {
  // scene: the THREE.Scene; hAt(x, y): terrain height; V: sim -> three; onChange: called
  // when what is drawn changes (the scene redraws its cached shadows); style(): a look's
  // material settings for the models, or null (arcade-look.js lookProps).
  // groundAt(x, y): the ground as it is drawn (the scene's drawnGroundAt), for what lies ON it
  // waterAt(x, y): the water's surface there, or null on dry ground (the scene's waterLevelAt)
  constructor({ scene, hAt, V, onChange = null, style = null, baseUrl = PROP_BASE_URL, groundAt = null, waterAt = null } = {}) {
    this.scene = scene;
    this.hAt = hAt;
    this.waterAt = waterAt;
    this.groundAt = groundAt || hAt;
    this._manifestP = null;       // the GLB manifest, fetched once: Promise<{ kind: { file, heightM } }>
    this._proc = null;            // the procedural props' shared material { material, uniforms } (prop-models.js)
    this._decal = null;           // ... and the one for what lies on the ground (target rings)
    this.V = V;
    this.onChange = onChange;
    this.style = style;
    this.baseUrl = baseUrl;
    this.group = null;            // made, and added to the scene, with the first model
    this.skipped = [];            // [{ url, reason }] models that could not be drawn
    this.ready = Promise.resolve();   // settles when everything asked for so far is in (or skipped)
    this._templates = new Map();  // url -> Promise<template | null>
    this._batches = new Map();    // url -> { props: [...], meshes: [InstancedMesh] }
    this._epoch = 0;              // bumped by clear(): loads from before it are dropped
    this._geo = null;
  }

  // The course just loaded: its props replace the last course's. The same course again
  // (a scenery rebuild for a quality or look change) keeps what stands, re-seated on the
  // ground and re-dressed for the look.
  setCourse(geo) {
    if (geo && geo === this._geo) { this.refresh(); return this.ready; }
    this.clear();
    this._geo = geo || null;
    const list = geo && Array.isArray(geo.props) ? geo.props : [];
    return list.length ? this.add(list) : this.ready;
  }

  // Place one prop or a list of them (course.props entries). Resolves to
  // { placed, skipped } once their models are in.
  add(list) {
    const asked = Array.isArray(list) ? list : [list];
    const given = asked.filter((s) => normalizeProp(s, this.baseUrl));
    const props = given.map((s) => normalizeProp(s, this.baseUrl));
    const bad = asked.length - props.length;
    if (bad) console.warn(`[props] ${bad} of ${asked.length} entries without a position or a usable model, ignored`);
    const epoch = this._epoch;
    const job = this._manifest().then((manifest) => {
      if (epoch !== this._epoch) return [];
      const urls = new Set();
      props.forEach((p, i) => {
        // a kind the art stream has made a GLB for is drawn from it (an entry's own url still
        // wins); the procedural model stands by in case the file is missing or will not parse
        const m = p.kind && !given[i].url && !PROP_NEVER_GLB.includes(p.kind) ? manifest[p.kind] : null;
        if (m) {
          if (p.url.startsWith(PROP_PROC_SCHEME)) p.fallbackUrl = p.url;
          // a kind with variants (the skyline's three towers): each prop keeps its own, picked
          // by a stable hash of its id (its place when it has none), so a row of them is varied
          // and the same course always looks the same
          p.url = `${this.baseUrl}${m.variants ? m.variants[propVariantIndex(p, m.variants.length)] : m.file}`;
          p.manifest = true;
          if (!(num(given[i].heightM) > 0) && !PROP_KIND_HEIGHT_M[p.kind] && num(m.heightM) > 0) p.heightM = m.heightM;
        }
        let b = this._batches.get(p.url);
        if (!b) this._batches.set(p.url, (b = { props: [], meshes: [] }));
        b.props.push(p);
        urls.add(p.url);
      });
      return Promise.all([...urls].map(async (url) => {
        const t = await this._template(url);
        if (epoch !== this._epoch) return 0;
        if (t) return this._build(url, t);
        return this._fallBack(url, epoch);
      }));
    }).then((counts) => ({ placed: counts.reduce((a, b) => a + b, 0), skipped: this.skipped.slice() }));
    this.ready = this.ready.then(() => job).catch(() => {});
    return job;
  }

  // Take away the props with this id; true if any stood.
  remove(id) {
    let found = false;
    for (const [url, b] of this._batches) {
      const keep = b.props.filter((p) => p.id !== String(id));
      if (keep.length === b.props.length) continue;
      found = true;
      b.props = keep;
      this._template(url).then((t) => { if (t && this._batches.get(url) === b) this._build(url, t); });
    }
    return found;
  }

  // Everything off the course and out of memory.
  clear() {
    this._epoch++;
    const had = this._batches.size > 0;
    for (const url of [...this._batches.keys()]) this._dropBatch(url);
    for (const p of this._templates.values()) p.then((t) => t && this._disposeTemplate(t));
    this._templates.clear();
    for (const g of this._ghostMats?.values() || []) g.dispose();   // v2:seeover
    this._ghostMats?.clear();
    this.skipped = [];
    this._geo = null;
    if (this.group) { this.scene.remove(this.group); this.group = null; }
    if (had) this.onChange?.();
  }

  dispose() {
    this.clear();
    this._proc?.material.dispose();
    this._decal?.material.dispose();
    this._proc = this._decal = null;
  }

  // Each frame (scene._frame): the procedural props' cheap motion and flicker is one
  // uniform. Nothing to do on a course without them.
  update(t) {
    if (this._proc) this._proc.uniforms.uPropTime.value = t;
    if (this._decal) this._decal.uniforms.uPropTime.value = t;
  }

  // ---- v2:seeover pass-through: what stands between the camera and the ball is drawn as a ghost ----
  // One copy as it should be drawn now: solid, or see-through (setSeeThrough: the solid copy
  // scaled to nothing, its twin in the ghost meshes shown).
  _drawCopy(b, i) {
    const m4 = new THREE.Matrix4(), zero = PROP_ZERO_MATRIX;
    const ghost = !!b.ghost?.[i];
    b.meshes.forEach((im, k) => {
      if (!im.isInstancedMesh || !b.partMats[k]) return;
      im.setMatrixAt(i, ghost ? zero : m4.multiplyMatrices(b.place[i], b.partMats[k]));
      im.instanceMatrix.needsUpdate = true;
      for (const g of b.ghosts?.[k] || []) { g.setMatrixAt(i, ghost ? m4.multiplyMatrices(b.place[i], b.partMats[k]) : zero); g.instanceMatrix.needsUpdate = true; }
    });
  }

  // The see-through twins of a model's material, drawn after the aim line and the markers so
  // those show through: first its depth alone (depthOnly: no colour), then the same surface
  // at SEE_OVER.fadeOpacity where that depth is. So only the ghost's nearest face shows, once:
  // a model's overlapping faces (a palm's fronds) would otherwise add up to nearly solid.
  _ghostMat(m, depthOnly = false) {
    if (Array.isArray(m)) return m.map((x) => this._ghostMat(x, depthOnly));
    this._ghostMats ||= new Map();
    const key = depthOnly ? m.uuid + ':d' : m.uuid;
    let g = this._ghostMats.get(key);
    if (!g) {
      g = m.clone();
      g.onBeforeCompile = m.onBeforeCompile;   // the procedural props' shader (prop-models.js)
      g.customProgramCacheKey = m.customProgramCacheKey;
      g.userData = { ...m.userData };
      g.transparent = true;
      g.opacity = SEE_OVER.fadeOpacity;
      g.depthWrite = depthOnly;
      g.colorWrite = !depthOnly;
      g.name = `${m.name || 'prop'}:ghost${depthOnly ? '-depth' : ''}`;
      this._ghostMats.set(key, g);
    }
    return g;
  }

  _dropGhosts(b) {
    for (const pair of b.ghosts || []) for (const g of pair || []) { this.group?.remove(g); g.dispose?.(); }
    b.ghosts = null;
    if (b.ghost) b.ghost.fill(false);
  }

  // What stands on the course, for the address camera (see-over.js crownField): every
  // standing model at least minH tall as discs { x, y, r, top, base, solid } along its
  // longer side (a wall is a row of them). Nothing for what floats, spans or lies flat,
  // nor for a model the point `skip` {x, y} is inside (a bowl the hole is played in).
  blockers(skip = null, minH = 2.5) {
    const out = [];
    for (const b of this._batches.values()) {
      if (!b.body) continue;
      b.body.forEach((f, i) => {
        if (!f || f.top - f.base < minH) return;
        const p = b.props[i];
        const a = p.rotDeg * Math.PI / 180, long = Math.max(f.hx, f.hz), r = Math.max(0.6, Math.min(f.hx, f.hz));
        // the model's own x axis on the course: east turned clockwise by rotDeg; z is south
        const ax = f.hx >= f.hz ? [Math.cos(a), -Math.sin(a)] : [-Math.sin(a), -Math.cos(a)];
        if (skip && Math.hypot(skip.x - f.cx, skip.y - f.cy) < long) return;
        const n = Math.min(12, Math.max(1, Math.ceil((long - r) / r)));
        for (let k = 0; k < (long - r < 0.5 ? 1 : n + 1); k++) {
          const s = long - r < 0.5 ? 0 : -(long - r) + (2 * (long - r) * k) / n;
          out.push({ x: f.cx + ax[0] * s, y: f.cy + ax[1] * s, r, top: f.top, base: f.base, solid: true });
        }
      });
    }
    return out;
  }

  // Pass-through, every frame (scene._frame). ONE mechanism for everything that must not
  // stand between the player and the ball; a model in the way is drawn as a ghost (never
  // popped out of the picture), and stands solid again when it no longer is:
  //   - line = { x, y (the camera, on the course), ux, uy (the way of the shot), d (camera
  //     to ball, m), camZ, ballZ, endZ (the ground aheadM past the ball), aheadM }: at
  //     address in the arcade (see-over-rig.js), a standing model whose box the line of
  //     sight runs into, between the camera and the ball or over the first aheadM of the
  //     shot, and which rises into that sight line. null: no line (a shot is away, or the
  //     plain simulator);
  //   - cam { x, y, z }: a big model the camera is INSIDE (props are scenery, nothing
  //     collides with them: a ball dropped beside Canyon Run's waterfall left the address
  //     camera inside the model, a screen of the backs of its faces; a ball cam can fly
  //     through one);
  //   - ball { x, y }: a big model the ball at rest lies inside (null while it flies).
  // The ground, and what lies on it (a bridge, target rings), is never faded.
  setSeeThrough(line, cam = null, ball = null) {
    const key = (line ? [line.x, line.y, line.d, line.camZ].map((v) => Math.round(v * 4)).join(',') + `|${Math.round(Math.atan2(line.ux, line.uy) * 400)}` : '')
      + (cam ? `|c${Math.round(cam.x * 2)},${Math.round(cam.y * 2)},${Math.round(cam.z * 2)}` : '') + (ball ? `|b${Math.round(ball.x * 2)},${Math.round(ball.y * 2)}` : '');
    if (key === this._seeKey) return;
    this._seeKey = key;
    const P = new THREE.Vector3();
    let any = false;
    for (const b of this._batches.values()) {
      if (!b.body || !b.place) continue;
      b.ghost ||= new Array(b.props.length).fill(false);
      let changed = false;
      for (let i = 0; i < b.props.length; i++) {
        const f = b.body[i];
        // (the camera or the resting ball inside it: v2:qa's setViewer, which took the model out; now it fades)
        const ft = b.foot?.[i], p = b.props[i];
        let ghost = !!ft && ((!!cam && Math.hypot(cam.x - p.x, cam.y - p.y) < ft.r && cam.z < ft.top + 1)
          || (!!ball && Math.hypot(ball.x - p.x, ball.y - p.y) < ft.r));
        if (!ghost && line && f) {
          const len = line.d + line.aheadM;
          const reach = Math.hypot(f.hx, f.hz) + 3 + 0.05 * len;
          const rx = f.cx - line.x, ry = f.cy - line.y;
          const al = rx * line.ux + ry * line.uy, lat = rx * line.uy - ry * line.ux;
          if (al > -reach && al < len + reach && Math.abs(lat) < reach) {
            b.inv ||= [];
            const inv = (b.inv[i] ||= b.place[i].clone().invert());
            for (let s = 0; s <= len && !ghost; s += 1.5) {
              const sight = s <= line.d ? line.camZ + (line.ballZ - line.camZ) * (s / Math.max(1e-6, line.d))
                : line.camZ + (line.endZ - line.camZ) * (s / len);
              if (f.top < sight - 0.5) continue;
              P.copy(this.V(line.x + line.ux * s, line.y + line.uy * s, 0)).applyMatrix4(inv);
              const m = 1.2 + 0.03 * s;
              ghost = P.x > f.box.min.x - m / f.sx && P.x < f.box.max.x + m / f.sx && P.z > f.box.min.z - m / f.sz && P.z < f.box.max.z + m / f.sz;
            }
          }
        }
        if (ghost === b.ghost[i]) continue;
        b.ghost[i] = ghost;
        if (ghost && !b.ghosts) {
          // the ghost meshes, made the first time a copy of this model stands in the way
          b.ghosts = b.meshes.map((im) => {
            if (!im.isInstancedMesh) return null;
            return [true, false].map((depthOnly) => {
              const g = new THREE.InstancedMesh(im.geometry, this._ghostMat(im.material, depthOnly), b.props.length);
              g.name = `${im.name}:ghost`;
              for (let j = 0; j < b.props.length; j++) g.setMatrixAt(j, PROP_ZERO_MATRIX);
              g.frustumCulled = false;
              g.castShadow = false;
              g.receiveShadow = false;
              g.renderOrder = depthOnly ? 19 : 20;
              this.group.add(g);
              return g;
            });
          });
        }
        this._drawCopy(b, i);
        changed = true;
      }
      any ||= changed;
    }
    if (any) this.onChange?.();
  }

  // v2:final Every model that stands or floats on the course, as an upright cylinder:
  // [{ x, y, r, base, top }] (course metres). Props are scenery and nothing collides with them;
  // this is for a camera that flies by itself and should not fly through one (shell-core.js
  // backdropOrbit). Empty until the models have loaded; `version` moves when it changes.
  obstacles() {
    const out = [];
    for (const b of this._batches.values()) for (const o of b.obst || []) out.push(o);
    return out;
  }

  // how many copies are drawn see-through now (tests, and the scene's own report)
  seeThroughCount() {
    let n = 0;
    for (const b of this._batches.values()) for (const g of b.ghost || []) if (g) n++;
    return n;
  }

  // Re-seat every prop on the ground as it is now and dress the models for the look.
  refresh() {
    for (const [url, b] of this._batches) {
      this._template(url).then((t) => { if (t && this._batches.get(url) === b) this._build(url, t); });
    }
  }

  // ---- internals

  // The GLB manifest: { kind: { file, heightM } }, fetched once. No manifest, or one that
  // will not parse, is an empty one: every kind is then its procedural model (or its own GLB).
  _manifest() {
    if (this._manifestP) return this._manifestP;
    const safe = /^[a-z0-9][a-z0-9._-]*\.glb$/i;
    this._manifestP = (typeof fetch === 'function' ? fetch(`${this.baseUrl}${PROP_MANIFEST}`) : Promise.reject(new Error('no fetch')))
      .then((res) => (res.ok ? res.json() : {}))
      .then((json) => {
        const out = {};
        for (const [kind, m] of Object.entries((json && json.kinds) || {})) {
          if (KIND_RE.test(kind) && m && typeof m.file === 'string' && safe.test(m.file)) {
            // v2:qa `variants`: other files for the same kind (three skyscrapers), picked per prop
            const variants = Array.isArray(m.variants) ? m.variants.filter((f) => typeof f === 'string' && safe.test(f)) : [];
            out[kind] = { file: m.file, heightM: num(m.heightM), variants: variants.length > 1 ? variants : null };
          }
        }
        return out;
      })
      .catch(() => ({}));
    return this._manifestP;
  }

  // A model that could not be drawn: its props go to their fallback (a manifest GLB's
  // procedural model), or are dropped. Returns how many were placed after all.
  async _fallBack(url, epoch) {
    const b = this._batches.get(url);
    const movers = b ? b.props.filter((p) => p.fallbackUrl) : [];
    this._dropBatch(url);
    if (!movers.length) return 0;
    const to = movers[0].fallbackUrl;
    for (const p of movers) { p.url = to; p.fallbackUrl = null; p.manifest = false; }
    let fb = this._batches.get(to);
    if (!fb) this._batches.set(to, (fb = { props: [], meshes: [] }));
    fb.props.push(...movers);
    const t = await this._template(to);
    if (epoch !== this._epoch || !t) return 0;
    this._build(to, t);
    return movers.length;
  }

  // What a prop stands on at (x, y): the ground, or the water's surface where that is
  // higher (a rock in a lava lake sits in the lava, not on the lake's bed).
  _standAt(x, y) {
    const h = this.hAt(x, y), w = this.waterAt ? this.waterAt(x, y) : null;
    return w != null && w > h ? w : h;
  }

  // The model at a url, loaded once: { parts: [{ geometry, material, matrix }], minY, height }.
  _template(url) {
    let p = this._templates.get(url);
    if (p) return p;
    const epoch = this._epoch;
    p = this._load(url).then((t) => {
      if (t && epoch !== this._epoch) { this._disposeTemplate(t); return null; }   // the course changed meanwhile
      return t;
    }).catch((e) => {
      console.warn(`[props] ${url} skipped: ${e?.message || e}`);
      if (epoch === this._epoch) this.skipped.push({ url, reason: 'error' });
      return null;
    });
    this._templates.set(url, p);
    return p;
  }

  // A procedural kind's model (prop-models.js), in the shape of a loaded one.
  async _loadProcedural(kind) {
    const epoch = this._epoch;
    modelsModule ||= import('./prop-models.js');
    const M = await modelsModule;
    const model = M.buildPropModel(kind);
    if (!model) {
      if (epoch === this._epoch) this.skipped.push({ url: `${PROP_PROC_SCHEME}${kind}`, reason: 'missing' });
      return null;
    }
    this._proc ||= M.makePropMaterial();
    if (model.flat) this._decal ||= M.makePropMaterial({ decal: true });
    return {
      parts: [{ geometry: model.geometry, material: this._proc.material, matrix: new THREE.Matrix4() }],
      minY: model.baseY, height: model.measure, proc: model, models: M,
    };
  }

  async _load(url) {
    if (url.startsWith(PROP_PROC_SCHEME)) return this._loadProcedural(url.slice(PROP_PROC_SCHEME.length));
    const epoch = this._epoch;
    const res = await fetch(url);
    if (!res.ok) {
      // a model that is not there is not an error: the course simply goes without it
      if (res.status !== 404) console.warn(`[props] ${url} skipped: HTTP ${res.status}`);
      if (epoch === this._epoch) this.skipped.push({ url, reason: res.status === 404 ? 'missing' : `http-${res.status}` });
      return null;
    }
    const data = await res.arrayBuffer();
    gltfModule ||= import('three/addons/loaders/GLTFLoader.js');
    const { GLTFLoader } = await gltfModule;
    // its own loading manager: a prop's textures are no part of the course's load state
    const loader = new GLTFLoader(new THREE.LoadingManager());
    const gltf = await loader.parseAsync(data, url.slice(0, url.lastIndexOf('/') + 1));
    gltf.scene.updateMatrixWorld(true);
    const parts = [], box = new THREE.Box3();
    gltf.scene.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh) return;   // static meshes only
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      box.union(g.boundingBox.clone().applyMatrix4(o.matrixWorld));
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;   // base colour is always sRGB
      }
      parts.push({ geometry: g, material: o.material, matrix: o.matrixWorld.clone() });
    });
    if (!parts.length || box.isEmpty()) throw new Error('no static mesh in the model');
    // (the box, for a model whose origin is its base: a manifest GLB, see _build)
    return { parts, minY: box.min.y, height: box.max.y - box.min.y, box };
  }

  _disposeTemplate(t) {
    for (const part of t.parts) {
      part.geometry.dispose();
      if (t.proc) continue;   // the procedural material is the layer's, shared by every kind
      for (const m of Array.isArray(part.material) ? part.material : [part.material]) disposeMaterial(m);
    }
  }

  _dropBatch(url) {
    const b = this._batches.get(url);
    if (!b) return;
    for (const im of b.meshes) this._dropMesh(im);
    this._dropGhosts(b);   // v2:seeover
    this.version = (this.version || 0) + 1;   // v2:seeover
    this._batches.delete(url);
  }

  // One drawn mesh off the course. An instanced mesh's geometry and materials are its
  // template's; a draped one (a target ring) owns its geometry.
  _dropMesh(m) {
    this.group?.remove(m);
    if (m.userData.ownGeometry) m.geometry.dispose();
    m.dispose?.();
  }

  // A look's touch on the models' materials (arcade: matte, non-metal, a little of their
  // own colour given back as glow), undone when the look has none.
  _dress(t) {
    const st = this.style ? this.style() : null;
    if (t.proc) {
      // the procedural material: how hard its glowing parts glow, and how much of its own
      // colour it gives back unlit (so a night stage's scenery still reads)
      for (const m of [this._proc, this._decal]) if (m) m.uniforms.uPropGlow.value.set(st?.emissive ?? 1, st?.self ?? 0);
      return;
    }
    for (const part of t.parts) {
      for (const m of Array.isArray(part.material) ? part.material : [part.material]) {
        if (!m.isMeshStandardMaterial) continue;
        const u = m.userData;
        if (st) {
          u.propOwn ||= { roughness: m.roughness, metalness: m.metalness, envMapIntensity: m.envMapIntensity, emissive: m.emissive.clone(), emissiveMap: m.emissiveMap, emissiveIntensity: m.emissiveIntensity };
          m.roughness = st.roughness ?? u.propOwn.roughness;
          m.metalness = st.metalness ?? u.propOwn.metalness;
          m.envMapIntensity = st.envMapIntensity ?? u.propOwn.envMapIntensity;
          const lit = u.propOwn.emissiveMap || u.propOwn.emissive.getHex() !== 0;
          if (lit) {
            // a model's own lights (windows, lava, neon) take part in the look's glow: brighter at night
            m.emissive.copy(u.propOwn.emissive); m.emissiveMap = u.propOwn.emissiveMap;
            m.emissiveIntensity = u.propOwn.emissiveIntensity * Math.max(1, (st.emissive ?? 0.6) / 0.6) * (1 + (st.self ?? 0) * 4);
          } else if (st.glow > 0) {
            m.emissive.set(m.map ? 0xffffff : m.color);
            m.emissiveMap = m.map || null;
            m.emissiveIntensity = st.glow;
          }
          m.needsUpdate = true;
        } else if (u.propOwn) {
          const o = u.propOwn;
          m.roughness = o.roughness; m.metalness = o.metalness; m.envMapIntensity = o.envMapIntensity;
          m.emissive.copy(o.emissive); m.emissiveMap = o.emissiveMap; m.emissiveIntensity = o.emissiveIntensity;
          delete u.propOwn;
          m.needsUpdate = true;
        }
      }
    }
  }

  // (Re)build one model's instances from its batch. Returns how many stand.
  _build(url, t) {
    const b = this._batches.get(url);
    if (!b) return 0;
    for (const im of b.meshes) this._dropMesh(im);
    b.meshes = [];
    // v2:seeover a rebuild: the ghosts go with the meshes they shadow (and their materials, which
    // copy the look's dress); the next frame picks again what stands in the way
    this._dropGhosts(b); b.ghost = null; b.inv = null; b.body = null;
    for (const g of this._ghostMats?.values() || []) g.dispose();
    this._ghostMats?.clear();
    this._seeKey = null;
    this.version = (this.version || 0) + 1;
    const n = b.props.length;
    if (!n) { this._batches.delete(url); this.onChange?.(); return 0; }
    this._dress(t);
    if (!this.group) {
      this.group = new THREE.Group();
      this.group.name = 'props';
      this.scene.add(this.group);
    }
    if (t.proc?.flat) return this._buildRings(b, t);   // target rings are draped, one mesh each
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    // v2:qa the footprint of each copy, for setSeeThrough(): the radius of the circle inside its
    // box (m) and the height of its top (course z). Nothing for what floats, spans or is small.
    let tbox = t.box || null;
    if (!tbox && t.parts[0] && t.parts[0].geometry) { const g0 = t.parts[0].geometry; if (!g0.boundingBox) g0.computeBoundingBox(); tbox = g0.boundingBox; }
    b.foot = [];
    b.body = [];   // v2:seeover each standing copy's box on the course, for the address camera and the pass-through
    b.obst = [];   // v2:final every copy that stands or floats, as an upright cylinder: obstacles()
    const placements = b.props.map((p) => {
      // a manifest GLB's origin is the centre of its base (a skirt hangs below it); the four
      // older GLBs are centred on their middle and stand on the bottom of their box
      const based = p.manifest && t.box && !t.proc;
      const minY = based ? 0 : t.minY, tall = based ? Math.max(1e-6, t.box.max.y) : t.height;
      let s = propScale(p, tall);
      let ground = p.z != null ? p.z : this._standAt(p.x, p.y);
      let sink = p.sinkM;
      if (!t.proc && PROP_FLOAT_M[p.kind] && p.z == null) { ground += PROP_FLOAT_M[p.kind]; sink = 0; }   // a GLB balloon floats too
      if (t.proc) {
        const lift = PROP_FLOAT_M[p.kind];
        if (lift && p.z == null) { ground += lift; sink = 0; }          // a balloon hangs in the air
        else sink += t.proc.sinkExtra * s[1];                            // a wreck lies deeper
        if (t.proc.span && p.heightM) {
          // a bridge: stretched along its span, its deck ends on the higher bank
          const e = Array.isArray(p.scale) ? p.scale : [p.scale, p.scale, p.scale];
          const bs = bridgeScale(p.heightM, t.height);
          s = [bs[0] * e[0], bs[1] * e[1], bs[2] * e[2]];
          if (p.z == null) {
            const a = p.rotDeg * Math.PI / 180, half = (t.height * s[2]) / 2;
            const dx = Math.sin(a) * half, dy = Math.cos(a) * half;
            ground = Math.max(this._standAt(p.x + dx, p.y + dy), this._standAt(p.x - dx, p.y - dy));
            sink = 0.1;
          }
        }
      }
      // sim (x east, y north, z up) -> three (x, z, -y); clockwise from above is a negative turn about +y
      const pos = this.V(p.x, p.y, propOriginZ({ sinkM: sink }, ground, minY, s[1]));
      q.setFromAxisAngle(up, -p.rotDeg * Math.PI / 180);
      const r = tbox && !PROP_FLOAT_M[p.kind] && !(t.proc && (t.proc.span || t.proc.flat))
        ? 0.5 * 0.85 * Math.min((tbox.max.x - tbox.min.x) * s[0], (tbox.max.z - tbox.min.z) * s[2]) : 0;
      b.foot.push(r >= PROP_VIEWER_MIN_R ? { r, top: ground + tall * s[1] } : null);
      // v2:seeover its box: half sizes (m), middle (course x, y), top and foot (course z), and the box itself in the model's own frame
      if (tbox && !PROP_FLOAT_M[p.kind] && !(t.proc && (t.proc.span || t.proc.flat))) {
        const a = p.rotDeg * Math.PI / 180, mx = 0.5 * (tbox.min.x + tbox.max.x) * s[0], mz = 0.5 * (tbox.min.z + tbox.max.z) * s[2];
        b.body.push({
          hx: 0.5 * (tbox.max.x - tbox.min.x) * s[0], hz: 0.5 * (tbox.max.z - tbox.min.z) * s[2], sx: s[0], sz: s[2], box: tbox,
          cx: p.x + Math.cos(a) * mx - Math.sin(a) * mz, cy: p.y - Math.sin(a) * mx - Math.cos(a) * mz,
          top: ground + tall * s[1], base: ground,
        });
      } else b.body.push(null);
      // v2:final the same for a camera that flies by itself (the menus' backdrop): the circle ROUND the
      // box (course x, y, radius), its foot and its top (course z); floating models too
      if (tbox && !(t.proc && (t.proc.span || t.proc.flat))) {
        const a = p.rotDeg * Math.PI / 180, mx = 0.5 * (tbox.min.x + tbox.max.x) * s[0], mz = 0.5 * (tbox.min.z + tbox.max.z) * s[2];
        b.obst.push({
          x: p.x + Math.cos(a) * mx - Math.sin(a) * mz, y: p.y - Math.sin(a) * mx - Math.cos(a) * mz,
          r: 0.5 * Math.hypot((tbox.max.x - tbox.min.x) * s[0], (tbox.max.z - tbox.min.z) * s[2]), base: ground, top: ground + tall * s[1],
        });
      }
      return new THREE.Matrix4().compose(pos, q, sc.set(s[0], s[1], s[2]));
    });
    b.place = placements;
    b.partMats = t.parts.map((part) => part.matrix);
    // small procedural props stay out of the shadow map; so does anything that floats
    const cast = b.props.some((p) => p.castShadow) && (!t.proc || t.proc.shadow);
    if (t.proc) {
      // each copy's own colour (balloons, banners, crystals: white for a kind without tints)
      // and the distance by which it has shrunk away (small props only)
      const inst = new Float32Array(n * 4).fill(1);
      const pal = t.proc.tints, c = new THREE.Color();
      b.props.forEach((p, i) => {
        if (pal) { c.set(pal[i % pal.length]); inst[i * 4] = c.r; inst[i * 4 + 1] = c.g; inst[i * 4 + 2] = c.b; }
        inst[i * 4 + 3] = t.proc.flat || t.proc.span || PROP_FLOAT_M[p.kind] ? 1e6 : propCullM(p.heightM || t.height);
      });
      t.parts[0].geometry.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 4));
    }
    for (const part of t.parts) {
      const im = new THREE.InstancedMesh(part.geometry, part.material, n);
      im.name = `prop:${url}`;
      for (let i = 0; i < n; i++) im.setMatrixAt(i, m4.multiplyMatrices(placements[i], part.matrix));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingBox();
      im.computeBoundingSphere();
      im.castShadow = cast;
      im.receiveShadow = true;
      if (t.proc?.roam) im.frustumCulled = false;   // it circles or drifts beyond its own box
      this.group.add(im);
      b.meshes.push(im);
    }
    this.onChange?.();
    return n;
  }

  // Target rings: each a band draped over the ground as it is drawn, coloured by its place
  // among the rings round the same point (innermost first: gold, red, white, blue ...).
  _buildRings(b, t) {
    const M = t.models;
    const rank = new Map();
    const near = (a, c) => Math.hypot(a.x - c.x, a.y - c.y) < 1.5;
    for (const p of b.props) {
      const mates = b.props.filter((o) => near(o, p)).sort((a, c) => (a.heightM || 0) - (c.heightM || 0));
      rank.set(p, mates.indexOf(p));
    }
    for (const p of b.props) {
      const d = (p.heightM || t.height) * (Array.isArray(p.scale) ? p.scale[0] : p.scale);
      const lift = 0.05;
      // the ring's own frame is three's (x east, z south) about its centre
      const geo = M.buildTargetRing(d, M.TARGET_RING_COLORS[rank.get(p) % M.TARGET_RING_COLORS.length],
        (x, z) => (p.z != null ? p.z : this.groundAt(p.x + x, p.y - z)) + lift);
      const mesh = new THREE.Mesh(geo, this._decal.material);
      mesh.name = 'prop:target-ring';
      mesh.position.copy(this.V(p.x, p.y, 0));
      mesh.userData.ownGeometry = true;
      mesh.renderOrder = 1;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      b.meshes.push(mesh);
    }
    this.onChange?.();
    return b.props.length;
  }
}
