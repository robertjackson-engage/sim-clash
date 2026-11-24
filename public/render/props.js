// Course props: small human-scale objects that say "maintained golf course".
// A bunker rake lying in each sand bunker — the iconic detail that grounds the
// bunkers at human scale (one instanced, shadow-casting draw call) — and, below,
// the GLB set pieces a course's data places on it (PropsLayer).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SEE_OVER } from './see-over.js';   // v2:seeover
import { STANDS, isStandKind, standWedge, standLamps, wedgePoint, standToCourse } from './stadium-kit.js';   // v3:stadium
import { CrowdLayer } from './crowd.js';             // v3:stadium
import { StadiumFx } from './stadium-fx.js';         // v3:stadium

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
  // v3:stadium the stadium kit (GLBs from the manifest; these are their stand-ins)
  'stand-section', 'stand-corner', 'led-board', 'ad-board', 'barrier', 'camera-tower', 'tunnel', 'podium',
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
  // v3:stadium (a bowl section always stands at the size it is modelled: PROP_TRUE_SIZE)
  'stand-section': 42.5, 'stand-corner': 61.4,
  'led-board': 1.25, 'ad-board': 2.4, barrier: 0.9, 'camera-tower': 11.4, tunnel: 7.4, podium: 10.8,
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
    // v3:stadium a stand's wedge (stadium-kit.js), and how its crowd is dressed
    ...(spec.wedge && typeof spec.wedge === 'object' ? { wedge: spec.wedge } : {}),
    ...(typeof spec.text === 'string' && spec.text ? { text: spec.text.slice(0, 12) } : {}),
    ...(Array.isArray(spec.team) && spec.team.length >= 2 ? { team: spec.team.slice(0, 2) } : {}),
    ...(num(spec.fill) != null ? { fill: spec.fill } : {}),
    ...(typeof spec.url === 'string' && spec.url ? { urlGiven: true } : {}),
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
  // v3:stadium env(): { quality: 'low' | 'high' | 'ultra', night: bool } (the scene's graphics level and the stage's time of day)
  constructor({ scene, hAt, V, onChange = null, style = null, baseUrl = PROP_BASE_URL, groundAt = null, waterAt = null, env = null } = {}) {
    this.scene = scene;
    this.env = env;
    this.crowd = null;            // v3:stadium the people in the stands (crowd.js), made with the first stand
    this.fx = null;               // v3:stadium beams, flares, confetti, pyro, fireworks (stadium-fx.js)
    this._slotTex = null;         // v3:stadium the kit's shared textures { led, ad, screen }
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
          if (PROP_TRUE_SIZE.includes(p.kind) && num(m.heightM) > 0) p.heightM = m.heightM;   // v3:stadium a bowl section stands at the size it is modelled (its seats are people-sized)
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
    this._stadiumClear();   // v3:stadium
    if (this.group) { this.scene.remove(this.group); this.group = null; }
    if (had) this.onChange?.();
  }

  dispose() {
    this.clear();
    this._proc?.material.dispose();
    this._decal?.material.dispose();
    this._proc = this._decal = null;
    this.crowd?.dispose(); this.fx?.dispose(); this.crowd = this.fx = null;   // v3:stadium
  }

  // Each frame (scene._frame): the procedural props' cheap motion and flicker is one
  // uniform. Nothing to do on a course without them.
  update(t, camera = null) {
    if (this._proc) this._proc.uniforms.uPropTime.value = t;
    if (this._decal) this._decal.uniforms.uPropTime.value = t;
    this._stadiumUpdate(t, camera);   // v3:stadium the crowd, the lights, the boards (nothing on a course without a stand)
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
        // v3:stadium a stand is a wedge, front edge on its origin: inside it is inside its own plan (stadium-kit.js)
        let ghost = b.stand ? (!!f && ((!!cam && cam.z < f.top + 1 && this._inStand(b, i, cam.x, cam.y)) || (!!ball && this._inStand(b, i, ball.x, ball.y))))
          : !!ft && ((!!cam && Math.hypot(cam.x - p.x, cam.y - p.y) < ft.r && cam.z < ft.top + 1)
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
        if (b.stand) this.crowd?.setHidden(b.standId[i], ghost);   // v3:stadium its people go with it
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
            out[kind] = { file: m.file, heightM: num(m.heightM), variants: variants.length > 1 ? variants : null, anchor: m.anchor === 'front' ? 'front' : null };
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
        if (PROP_SLOTS.includes(m.name)) m.userData.slot = m.name;   // v3:stadium a kit material the layer feeds (screen, led, ad) or keeps clear (glass)
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
        if (u.slot) { this._dressSlot(m, st); continue; }   // v3:stadium
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
    b.stand = !!(b.props[0] && isStandKind(b.props[0].kind) && !b.props[0].urlGiven);   // v3:stadium
    b.standZ = []; b.standK = []; b.standId = [];
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
      if (b.stand) { b.standZ.push(propOriginZ({ sinkM: sink }, ground, minY, s[1])); b.standK.push(s[1]); b.standId.push(p.id || `${p.kind}@${Math.round(p.x * 10)},${Math.round(p.y * 10)}`); }   // v3:stadium
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
    if (b.stand && !t.proc) this._wedge(b, t);   // v3:stadium each copy's wedge, and the shader that bends the straight model into it
    for (const part of t.parts) {
      const im = new THREE.InstancedMesh(part.geometry, part.material, n);
      im.name = `prop:${url}`;
      for (let i = 0; i < n; i++) im.setMatrixAt(i, m4.multiplyMatrices(placements[i], part.matrix));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingBox();
      im.computeBoundingSphere();
      im.castShadow = cast && !(part.material.userData && part.material.userData.slot);   // v3:stadium a screen, a board, a glass roof cast nothing
      im.receiveShadow = true;
      if (b.stand && !t.proc) { im.frustumCulled = false; im.customDepthMaterial = this._wedgeDepth(t); }   // v3:stadium (its box is the straight model's)
      if (part.material.userData && part.material.userData.slot === 'glass') im.renderOrder = 3;
      if (t.proc?.roam) im.frustumCulled = false;   // it circles or drifts beyond its own box
      this.group.add(im);
      b.meshes.push(im);
    }
    this._stadiumDirty = (typeof performance !== 'undefined' ? performance.now() : Date.now());   // v3:stadium
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

  // ---------------------------------------------------------------- v3:stadium
  // The stadium: the kit's stands are bent into their wedges, people sit in them (crowd.js),
  // lamps get beams and flares, and the whole stage answers the game together:
  //
  //   scene.props.crowdReact('cheer' | 'groan' | 'wave' | 'tense' | 'calm' | 'flash' | 'win',
  //                          { at: { x, y } (course metres), intensity, label })
  //
  // 'win' is a long cheer with camera flashes, confetti, flame jets and fireworks. `label`
  // is what the big screens say for a few seconds (a default per reaction; '' for nothing).
  // Returns true when there is a crowd to react. Nothing is made, and nothing runs, on a
  // course without a stand or a floodlight.
  crowdReact(kind, { at = null, intensity = 1, label = null } = {}) {
    const k = String(kind || '');
    const say = (text, color) => { if (label !== '') this._screenFlash(label || text, color); };
    if (k === 'win') {
      this.crowd?.react('cheer', { intensity: Math.max(2, intensity * 2) });
      this.crowd?.react('flash', { intensity: 1 });
      this.fx?.fire('win', { intensity });
      say('WINNER!', '#ffd21f');
      return !!this.crowd;
    }
    if (!this.crowd) return false;
    if (this.crowd.react(k, { at, intensity }) === false) return false;
    if (k === 'cheer') {
      if (intensity >= 1.5) { this.crowd.react('flash', { intensity: 1 }); this.fx?.fire('pyro', { intensity: 1 }); }
      say(intensity >= 1.5 ? 'IN THE HOLE!' : 'GREAT SHOT', '#3dff8a');
    } else if (k === 'groan') say('SO CLOSE', '#ff5a4a');
    return true;
  }

  // What the big screens show between reactions: { title, big, sub, color }. The screen is a
  // canvas texture on every material named `screen` in the kit (the jumbotron's 16:9 face,
  // UV 0..1): scene.props.screen is { canvas, texture, redraw() } for a HUD that wants to
  // draw into it itself (draw on the canvas, then set texture.needsUpdate = true).
  setScreen(info) {
    this._screenInfo = info && typeof info === 'object' ? info : null;
    this._screenUntil = null;
    this._drawScreen(null);
  }

  get screen() {
    const tex = this._slotTextures();
    return tex ? { canvas: tex.screen.image, texture: tex.screen, redraw: () => this._drawScreen(null) } : null;
  }

  // what the stadium is drawing now (the capture tool and the tests)
  stats() {
    return { crowd: this.crowd ? this.crowd.stats() : null, fx: this.fx ? this.fx.stats() : null, stands: this._standCount || 0 };
  }

  _env() {
    const e = this.env ? this.env() : null;
    return { quality: (e && e.quality) || 'high', night: !!(e && e.night) };
  }

  _stadiumUpdate(t, camera) {
    this._fxT = t;
    if (this._stadiumDirty != null) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - this._stadiumDirty > 120) { this._stadiumDirty = null; this._stadium(); }
    }
    const tex = this._slotTex;
    if (tex) {
      tex.led.offset.x = (t * 0.03) % 1;   // the LED boards scroll: one number for every board on the stage
      if (this._screenUntil != null && t > this._screenUntil) { this._screenUntil = null; this._drawScreen(null); }
    }
    if (camera) { this.crowd?.update(t, camera); this.fx?.update(t, camera); }
  }

  _stadiumClear() {
    this.crowd?.clear();
    this.fx?.clear();
    this._standCount = 0;
    this._stadiumDirty = null;
    if (this._slotTex) { for (const t of Object.values(this._slotTex)) t.dispose(); this._slotTex = null; }
    this._screenInfo = null; this._screenUntil = null;
  }

  // The stands as they stand now -> the crowd in them, the lamps over them, the cannons at
  // their feet. Runs once after the models of a course (or a rebuild of them) are in.
  _stadium() {
    const stands = [], lamps = [], cannons = [];
    let ring = 0, cx = 0, cy = 0, top = -Infinity, ax = 0, ay = 0;
    for (const b of this._batches.values()) {
      if (b.stand && b.standZ && b.standZ.length === b.props.length) {
        b.props.forEach((p, i) => {
          const k = b.standK[i] || 1;
          const place = { id: b.standId[i], kind: p.kind, x: p.x, y: p.y, z: b.standZ[i], rotDeg: p.rotDeg, wedge: p.wedge, scale: k, text: p.text, team: p.team, ...(p.fill != null ? { fill: p.fill } : {}) };
          stands.push(place);
          ax += p.x; ay += p.y;
          top = Math.max(top, place.z + STANDS[p.kind].heightM * k);
          for (const l of standLamps(place)) {
            const reach = (l.z - place.z) * 1.1 + 8;
            lamps.push({ x: l.x, y: l.y, z: l.z - 0.6, tx: l.x + Math.sin(l.yaw) * reach, ty: l.y + Math.cos(l.yaw) * reach, tz: place.z + 1, power: p.kind === 'stand-corner' ? 1.7 : 1 });
          }
          if (p.wedge) {
            ring++; cx += p.x; cy += p.y;
            if (p.kind === 'stand-section' && ring % 2 === 0) {
              const [lx, back] = wedgePoint(standWedge(p.kind, p.wedge, k), 0, 1.3 * k);
              const [x, y] = standToCourse(p, lx, back);
              cannons.push({ x, y, z: place.z + 3.6 * k });
            }
          }
        });
      } else if (b.body) {
        b.props.forEach((p, i) => {
          const f = b.body[i];
          if (p.kind !== 'floodlight' || !f) return;
          const a = (p.rotDeg + 180) * Math.PI / 180, h = f.top - f.base, reach = h * 1.15;
          lamps.push({ x: p.x, y: p.y, z: f.base + h * 0.93, tx: p.x + Math.sin(a) * reach, ty: p.y + Math.cos(a) * reach, tz: f.base, power: 1.3 });
        });
      }
    }
    this._standCount = stands.length;
    const quality = () => this._env().quality, night = () => this._env().night;
    if (stands.length) {
      this.crowd ||= new CrowdLayer({
        scene: this.scene, V: this.V, quality,
        style: () => { const st = this.style ? this.style() : null; return { self: st?.self ?? 0, emissive: st?.emissive ?? 1, night: night() }; },
      });
      this.crowd.setStands(stands, { centre: ring >= 6 ? { x: cx / ring, y: cy / ring } : null, theme: this._geo?.arcade?.theme || null });
      for (const b of this._batches.values()) if (b.stand && b.ghost) b.ghost.forEach((g, i) => { if (g) this.crowd.setHidden(b.standId[i], true); });
    } else this.crowd?.clear();
    if (lamps.length || cannons.length) {
      this.fx ||= new StadiumFx({ scene: this.scene, V: this.V, quality, night });
      this.fx.setLamps(lamps);
      this.fx.setCannons(cannons);
      const n = Math.max(1, stands.length);
      this.fx.setSkyZone(stands.length ? { x: ring >= 6 ? cx / ring : ax / n, y: ring >= 6 ? cy / ring : ay / n, z: top + 40, r: ring >= 6 ? 70 : 40 } : null);
    } else this.fx?.clear();
    this.onChange?.();
  }

  // Is the point (course x, y) inside copy i of a stand's plan (its wedge, from just behind
  // the front wall to its back)?
  _inStand(b, i, x, y) {
    const p = b.props[i], k = b.standK[i] || 1, def = STANDS[p.kind];
    const a = p.rotDeg * Math.PI / 180, dx = x - p.x, dy = y - p.y;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), back = dx * Math.sin(a) + dy * Math.cos(a);
    if (back < 0.6 || back > def.depthM * k) return false;
    const w = standWedge(p.kind, p.wedge, k);
    return lx > -w.w / 2 - back * w.tl && lx < w.w / 2 + back * w.tr;
  }

  // Each copy's wedge as per-instance attributes on the model's geometry (shared by its
  // ghost twins), and the model's materials taught to bend by it (once per model).
  _wedge(b, t) {
    const n = b.props.length, W = STANDS[b.props[0].kind].widthM;
    const a = new Float32Array(n * 4), sk = new Float32Array(n);
    b.props.forEach((p, i) => {
      const k = b.standK[i] || 1, w = standWedge(p.kind, p.wedge, k);
      a[i * 4] = w.w / k; a[i * 4 + 1] = w.tl; a[i * 4 + 2] = w.tr; a[i * 4 + 3] = w.sag / k; sk[i] = w.sagK;
    });
    const aw = new THREE.InstancedBufferAttribute(a, 4), ak = new THREE.InstancedBufferAttribute(sk, 1);
    t.wedgeW = W;
    for (const part of t.parts) {
      part.geometry.setAttribute('aWedge', aw);
      part.geometry.setAttribute('aWedgeK', ak);
      for (const m of Array.isArray(part.material) ? part.material : [part.material]) wedgeMaterial(m, W);
    }
  }

  // the shadow pass draws the same wedge
  _wedgeDepth(t) {
    return (t.wedgeDepth ||= wedgeMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), t.wedgeW));
  }

  // The kit's shared textures, made with the first model that needs one: the LED strip
  // (scrolling), the sponsor atlas (still), the big screen. null without a DOM (the tests).
  _slotTextures() {
    if (this._slotTex) return this._slotTex;
    if (typeof document === 'undefined') return null;
    const stage = { tiebreak: this._geo?.arcade?.role === 'tiebreak', name: String(this._geo?.name || 'Sim Clash').toUpperCase() };
    const mk = (canvas, repeat) => {
      const t = new THREE.CanvasTexture(canvas);
      t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 4;
      if (repeat) t.wrapS = THREE.RepeatWrapping;
      return t;
    };
    this._slotTex = { led: mk(paintLedStrip(stage), true), ad: mk(paintSponsorAtlas(), false), screen: mk(document.createElement('canvas'), false) };
    this._slotStage = stage;
    this._drawScreen(null);
    return this._slotTex;
  }

  _drawScreen(flash) {
    const tex = this._slotTex;
    if (!tex) return;
    paintScreen(tex.screen.image, this._slotStage, this._screenInfo, flash);
    tex.screen.needsUpdate = true;
  }

  _screenFlash(text, color) {
    if (!text || !this._slotTex) return;
    this._drawScreen({ big: text, color });
    this._screenUntil = (this._fxT || 0) + 4.5;
  }

  // A kit material the layer feeds: screen, led, ad carry no texture in the file (their NAME
  // is the contract: tools/arcade-art/bake.mjs); glass is the canopy.
  _dressSlot(m, st) {
    const slot = m.userData.slot, night = this._env().night;
    if (slot === 'glass') {
      m.transparent = true; m.depthWrite = false; m.roughness = 0.2;
      m.emissive.set(0x9fd8ff); m.emissiveMap = null; m.emissiveIntensity = night ? 0.14 : 0;
      m.needsUpdate = true;
      return;
    }
    const tex = this._slotTextures();
    m.color.set(tex ? 0x000000 : 0x202428); m.map = null;
    m.emissive.set(0xffffff); m.emissiveMap = tex ? tex[slot] : null;
    m.emissiveIntensity = (slot === 'ad' ? 0.8 : 1.1) * (night ? 1.2 : 0.9) * (st ? 1 : 0.85);
    m.roughness = 0.45; m.metalness = 0;
    m.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- v3:stadium
// The kit's material slots (tools/arcade-art/bake.mjs writes them by NAME into the GLBs).
export const PROP_SLOTS = Object.freeze(['screen', 'led', 'ad', 'glass']);
export const PROP_TRUE_SIZE = Object.freeze(['stand-section', 'stand-corner']);

// The wedge, in the vertex shader: the four lines of stadium-kit.js wedgePoint(), on the
// straight model (x across its width W, front edge on z = 0, running back to -z), before
// the instance matrix places it. aWedge = (front chord, left splay, right splay, sag), all
// in the model's own metres; aWedgeK = how the sag grows with depth.
export const WEDGE_VERTEX = (W) => `
  #ifdef USE_INSTANCING
  {
    float wu = position.x / ${W.toFixed(3)}, wd = -position.z;
    float wxl = -0.5 * aWedge.x - wd * aWedge.y, wxr = 0.5 * aWedge.x + wd * aWedge.z;
    transformed.x = wxl + (wxr - wxl) * (wu + 0.5);
    transformed.z = -(wd + (1.0 - 4.0 * wu * wu) * (aWedge.w + wd * aWedgeK));
  }
  #endif`;
export const WEDGE_NORMAL = (W) => `
  #ifdef USE_INSTANCING
  {
    float wnu = position.x / ${W.toFixed(3)};
    float wth = atan(-aWedge.y + (aWedge.z + aWedge.y) * (wnu + 0.5));
    float wc = cos(wth), ws = sin(wth);
    objectNormal = vec3(objectNormal.x * wc - objectNormal.z * ws, objectNormal.y, objectNormal.x * ws + objectNormal.z * wc);
  }
  #endif`;

// A material that bends its model by the wedge (whatever else it already does).
export function wedgeMaterial(m, W) {
  if (m.userData.wedge === W) return m;
  m.userData.wedge = W;
  const before = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    if (before) before.call(m, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
  #ifdef USE_INSTANCING
  attribute vec4 aWedge; attribute float aWedgeK;
  #endif`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>${WEDGE_NORMAL(W)}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>${WEDGE_VERTEX(W)}`);
  };
  m.customProgramCacheKey = () => `prop-wedge-${W}`;
  m.needsUpdate = true;
  return m;
}

// ---- the boards' artwork, painted once per stage on canvases. Every name is invented.
export const SPONSORS = Object.freeze([
  ['VOLTARA', '#ffd21f', '#14171f'], ['KITEWAVE AIR', '#19c2b8', '#ffffff'], ['NOVAFIZZ', '#e8372c', '#ffffff'], ['PEAKLINE', '#1f5fd0', '#ffffff'],
  ['ZORBO TYRES', '#14171f', '#ffd21f'], ['GLIMMER BANK', '#f4f4ee', '#1f5fd0'], ['FERN & FIG', '#2fbf4a', '#ffffff'], ['HALCYON HOTELS', '#8e4de0', '#ffffff'],
  ['BRIGHTBOLT', '#ff8a1f', '#14171f'], ['SIM CLASH', '#14171f', '#3dff8a'], ['ARCADIA GOLF', '#f4f4ee', '#e8372c'], ['QUILLON', '#28507a', '#ffd21f'],
  ['TIDEPOOL', '#8fe3ff', '#14171f'], ['MAPLEJET', '#e8372c', '#f4f4ee'], ['OXLEY & SONS', '#3b4252', '#f4f4ee'], ['DUNE COLA', '#ffb46b', '#5a2a12'],
]);

const FONT_UI = '"Arial Black", "Segoe UI", Impact, system-ui, sans-serif';
function fitText(g, text, maxW, px, weight = '900') {
  let size = px;
  do { g.font = `${weight} ${size}px ${FONT_UI}`; size -= 2; } while (g.measureText(text).width > maxW && size > 8);
}

// The sponsor atlas: 4 x 4 cells of 512 x 128 (the kit's `ad` material; a model's UVs pick cells).
export function paintSponsorAtlas() {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 512;
  const g = c.getContext('2d');
  SPONSORS.forEach(([name, bg, ink], n) => {
    const x = (n % 4) * 512, y = Math.floor(n / 4) * 128;
    g.fillStyle = bg; g.fillRect(x, y, 512, 128);
    g.fillStyle = ink; g.globalAlpha = 0.14;
    g.beginPath(); g.moveTo(x + 330, y); g.lineTo(x + 512, y); g.lineTo(x + 512, y + 128); g.lineTo(x + 250, y + 128); g.closePath(); g.fill();
    g.globalAlpha = 1;
    // a mark: a different simple shape for each
    g.save(); g.translate(x + 62, y + 64);
    g.beginPath();
    if (n % 4 === 0) { g.moveTo(8, -40); g.lineTo(-22, 6); g.lineTo(-2, 6); g.lineTo(-10, 40); g.lineTo(24, -8); g.lineTo(4, -8); g.closePath(); }
    else if (n % 4 === 1) { g.arc(0, 0, 34, 0, Math.PI * 2); g.arc(0, 0, 17, 0, Math.PI * 2, true); }
    else if (n % 4 === 2) { g.moveTo(0, -38); g.lineTo(36, 30); g.lineTo(-36, 30); g.closePath(); }
    else { g.rect(-32, -32, 26, 64); g.rect(6, -32, 26, 64); }
    g.fill('evenodd'); g.restore();
    g.textBaseline = 'middle'; g.textAlign = 'left';
    fitText(g, name, 370, 70);
    g.fillText(name, x + 120, y + 68);
  });
  return c;
}

// The LED strip, 2048 x 128, two rows: the pitch-side perimeter board (top: sponsors) and
// the tier ribbon (bottom: the stage and the occasion). It scrolls (texture offset).
export function paintLedStrip(stage) {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#05070c'; g.fillRect(0, 0, 2048, 128);
  g.textBaseline = 'middle'; g.textAlign = 'center';
  const picks = [0, 2, 3, 6, 8, 9, 1, 13];
  picks.forEach((n, i) => {
    const [name, bg, ink] = SPONSORS[n], x = i * 256;
    g.fillStyle = bg; g.fillRect(x + 3, 3, 250, 58);
    g.fillStyle = ink; fitText(g, name, 226, 38);
    g.fillText(name, x + 128, 34);
  });
  const words = stage.tiebreak ? ['SUDDEN DEATH', stage.name, 'CLOSEST TO THE PIN', 'SIM CLASH'] : ['SIM CLASH TOUR', stage.name, 'SIM CLASH TOUR', stage.name];
  const cols = ['#ffd21f', '#ffffff', '#3dff8a', '#ff5fa8'];
  words.forEach((w, i) => {
    const x = i * 512;
    g.fillStyle = cols[i]; fitText(g, w, 400, 44);
    g.fillText(w, x + 230, 98);
    g.fillStyle = cols[(i + 1) % 4];
    for (let k = 0; k < 3; k++) { g.beginPath(); const cx = x + 452 + k * 20; g.moveTo(cx, 78); g.lineTo(cx + 14, 98); g.lineTo(cx, 118); g.lineTo(cx + 8, 98); g.closePath(); g.fill(); }
  });
  // the diodes: a fine dark grid over everything
  g.fillStyle = 'rgba(0,0,0,0.28)';
  for (let x = 0; x < 2048; x += 4) g.fillRect(x, 0, 1, 128);
  for (let y = 0; y < 128; y += 4) g.fillRect(0, y, 2048, 1);
  return c;
}

// The big screen, 1024 x 576: a broadcast card. info: { title, big, sub, color } (what it shows
// between reactions; the stage's own by default); flash: { big, color } (a reaction's word).
export function paintScreen(c, stage, info, flash) {
  if (c.width !== 1024) { c.width = 1024; c.height = 576; }
  const g = c.getContext('2d');
  const accent = (flash && flash.color) || (info && info.color) || '#ffd21f';
  const bg = g.createLinearGradient(0, 0, 0, 576);
  bg.addColorStop(0, '#101a3a'); bg.addColorStop(1, '#05070f');
  g.fillStyle = bg; g.fillRect(0, 0, 1024, 576);
  // target rings behind the words
  g.save(); g.translate(790, 330); g.globalAlpha = flash ? 0.5 : 0.85;
  [[210, '#1f5fd0'], [160, '#f4f4ee'], [112, '#e8372c'], [62, '#ffd21f']].forEach(([r, col]) => { g.fillStyle = col; g.beginPath(); g.ellipse(0, 0, r, r * 0.62, 0, 0, Math.PI * 2); g.fill(); });
  g.restore();
  g.fillStyle = 'rgba(5,7,15,0.55)'; g.fillRect(0, 150, 1024, 290);
  g.fillStyle = accent; g.fillRect(0, 150, 1024, 8); g.fillRect(0, 432, 1024, 8);
  g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillStyle = '#f4f4ee'; fitText(g, (info && info.title) || stage.name, 620, 54);
  g.fillText((info && info.title) || stage.name, 40, 78);
  g.fillStyle = '#e8372c'; g.beginPath(); g.arc(880, 78, 13, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#f4f4ee'; g.font = `900 34px ${FONT_UI}`; g.fillText('LIVE', 904, 80);
  const big = (flash && flash.big) || (info && info.big) || (stage.tiebreak ? 'SUDDEN DEATH' : 'SIM CLASH');
  g.textAlign = 'center'; g.fillStyle = accent; fitText(g, big, 940, flash ? 170 : 130);
  g.fillText(big, 512, 288);
  const sub = flash ? '' : (info && info.sub) || (stage.tiebreak ? 'ONE BALL EACH  •  CLOSEST TO THE PIN WINS' : 'THE CLASH TOUR');
  g.fillStyle = '#f4f4ee'; fitText(g, sub, 900, 38, '700');
  g.fillText(sub, 512, 396);
  g.fillStyle = '#3dff8a'; fitText(g, 'SIM CLASH', 300, 44); g.textAlign = 'left'; g.fillText('SIM CLASH', 40, 510);
  g.fillStyle = 'rgba(0,0,0,0.22)';
  for (let y = 0; y < 576; y += 3) g.fillRect(0, y, 1024, 1);
  return c;
}
