// v3:environment The ground materials of the arcade stages: eight generated, tiling sets (grass, rough,
// sand, rock, snow, basalt, ice, earth; public/arcade/env/tex, built by
// tools/arcade-art/env/tex-build.mjs) in ONE array texture, because the turf shader has no
// texture units to spare (it sits at WebGL's sixteen). Layers 0..7 hold each set's colour
// DETAIL in rgb (the texel over the set's mean colour, halved: 0.5 is "the theme's colour
// as it is") and its height in alpha; layers 8..15 its normal in rg and roughness in b.
//
// The array exists from the first frame, filled with "no detail" (grey, flat), and each
// layer is written when its picture arrives: a material built before then is not rebuilt,
// it just gains its detail. Nothing here is fetched in the real look.
import * as THREE from 'three';
import { ENV_BASE, loadEnvManifest } from './far-world.js';

export const ENV_LAYERS = Object.freeze(['grass', 'rough', 'sand', 'rock', 'snow', 'basalt', 'ice', 'earth']);
export const envLayer = (name) => Math.max(0, ENV_LAYERS.indexOf(name));

let shared = null;

// The shared array texture (made on first use; `size` only counts the first time).
export function envTextures(size = 1024) {
  if (shared) return shared;
  const n = ENV_LAYERS.length, data = new Uint8Array(size * size * 4 * n * 2);
  for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = 128; data[i + 3] = 128; }
  // the normal layers: flat, fully rough
  for (let i = size * size * 4 * n; i < data.length; i += 4) { data[i] = 128; data[i + 1] = 128; data[i + 2] = 242; data[i + 3] = 255; }
  const array = new THREE.DataArrayTexture(data, size, size, n * 2);
  array.format = THREE.RGBAFormat;
  array.type = THREE.UnsignedByteType;
  array.colorSpace = THREE.NoColorSpace;
  array.wrapS = array.wrapT = THREE.RepeatWrapping;
  array.minFilter = THREE.LinearMipmapLinearFilter;
  array.magFilter = THREE.LinearFilter;
  array.generateMipmaps = true;
  array.anisotropy = 8;
  array.needsUpdate = true;
  shared = { array, size, loaded: false, ready: null, sand: null, meta: {} };
  return shared;
}

// Fetch the sets and write them into the array. Resolves when all are in (a set that
// cannot be had stays "no detail": the ground is then the plain colour it used to be).
export function loadEnvTextures({ size = 1024, anisotropy = 8 } = {}) {
  const env = envTextures(size);
  if (env.ready) return env.ready;
  env.array.anisotropy = anisotropy;
  const N = env.size, n = ENV_LAYERS.length;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(N, N) : Object.assign(document.createElement('canvas'), { width: N, height: N });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const put = async (file, layer) => {
    const res = await fetch(ENV_BASE + file);
    if (!res.ok) throw new Error(`${file}: ${res.status}`);
    const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none', resizeWidth: N, resizeHeight: N, resizeQuality: 'high' });
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(bmp, 0, 0, N, N);
    env.array.image.data.set(ctx.getImageData(0, 0, N, N).data, layer * N * N * 4);
    bmp.close?.();
  };
  env.ready = loadEnvManifest().then(async (manifest) => {
    const sets = manifest.textures || {};
    await Promise.all(ENV_LAYERS.map(async (name, i) => {
      const set = sets[name];
      if (!set) return;
      env.meta[name] = { tileM: set.tileM, mean: set.mean };
      try { await put(set.color.file, i); await put(set.normal.file, i + n); }
      catch (e) { console.warn(`[env] ground set ${name} unavailable (${e?.message || e})`); }
    }));
    env.array.needsUpdate = true;
    env.loaded = true;
    return env;
  }).catch((e) => { console.warn(`[env] ground materials unavailable (${e?.message || e})`); return env; });
  return env.ready;
}

// The sand set as plain textures, for the bunker meshes' material (turf.js makeSandMaterial):
// { map, normalMap }, each a fresh clone that shares the one upload, repeating `rep` times.
let sandBase = null;
export function envSandMaps(repX = 1, repY = 1) {
  if (typeof document === 'undefined') return null;
  if (!sandBase) {
    const loader = new THREE.TextureLoader();
    const mk = (file, srgb) => {
      const waiting = [];
      // the picture is in: the clones made while it was on its way may upload now
      const t = loader.load(ENV_BASE + file, () => { for (const c of waiting.splice(0)) c.needsUpdate = true; });
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
      return { base: t, waiting };
    };
    sandBase = { map: mk('tex/sand_c.webp', true), normalMap: mk('tex/sand_n.webp', false) };
  }
  // A clone marks itself for upload. Made before the picture has arrived it would be drawn
  // with nothing to upload, and three says so in the console on every frame until it comes:
  // such a clone waits unmarked and is marked when the picture lands.
  const share = ({ base, waiting }) => {
    const t = base.clone();
    if (!base.image) { t.version = 0; waiting.push(t); }
    return t;
  };
  const map = share(sandBase.map), normalMap = share(sandBase.normalMap);
  for (const t of [map, normalMap]) t.repeat.set(repX, repY);
  return { map, normalMap };
}

// GLSL the turf and water shaders share: the two reads of the array.
export const ENV_TEX_GLSL = /* glsl */`
  uniform mediump sampler2DArray uEnvTex;
  // a set's colour detail (x1 = the theme's colour as it is) in rgb, its height in a
  vec4 envC(float layer, vec2 uv) { vec4 t = texture(uEnvTex, vec3(uv, layer)); return vec4(t.rgb * t.rgb * 4.0, t.a); }
  // the same read with the uv's screen gradients handed in, for a read inside a branch (v3:env-polish)
  vec4 envCG(float layer, vec2 uv, vec2 dx, vec2 dy) { vec4 t = textureGrad(uEnvTex, vec3(uv, layer), dx, dy); return vec4(t.rgb * t.rgb * 4.0, t.a); }
  // its normal's x and y (-1..1), its roughness
  vec3 envN(float layer, vec2 uv) { vec4 t = texture(uEnvTex, vec3(uv, layer + ${ENV_LAYERS.length}.0)); return vec3(t.rg * 2.0 - 1.0, t.b); }
`;

// What the turf shader needs from a look's turf.env (arcade-look.js), as uniform values.
// env: { rough, roughTileM, mownTileM, greenTileM, rockTileM, sandTileM, detail, normal, sparkle, roughTint }
// v3:env-polish What the cliff's rock needs from a look's turf.cliff besides its two colours: the
// colour of its great pale bands (c; a lightened, greyed `a` when the look names none), and
// the SECOND rock that runs through the first in beds and patches ({ set2, set2TileM,
// set2Mix }: a set of the array, its tile, how much of the wall it takes; it is laid on its
// side, so the rock set itself makes a rock jointed in upright columns between the level
// ledges of the first; a volcano names its basalt), and how far the
// wall's hue wanders over a hundred metres (macro), and what lies on its ledges and where it
// leans back ({ cap, capAmount }: snow in the mountains, moss in a garden; none without a cap).
export function cliffEnvUniforms(cliff = {}) {
  const a = new THREE.Color(cliff.a ?? '#8f7f6a');
  const l = 0.2126 * a.r + 0.7152 * a.g + 0.0722 * a.b;
  const c = cliff.c ? new THREE.Color(cliff.c) : new THREE.Color(a.r + (l - a.r) * 0.45, a.g + (l - a.g) * 0.45, a.b + (l - a.b) * 0.45).multiplyScalar(1.5);
  return {
    uArcCliffC: c,
    uArcCliffD: new THREE.Vector4(envLayer(cliff.set2 ?? 'rock'), cliff.set2TileM ?? 34, Math.min(1, Math.max(0, cliff.set2Mix ?? 0.38)), cliff.macro ?? 1),
    uArcCliffE: (() => { const k = new THREE.Color(cliff.cap ?? '#000000'); return new THREE.Vector4(k.r, k.g, k.b, cliff.cap ? cliff.capAmount ?? 0.8 : 0); })(),
  };
}

export function turfEnvUniforms(env = {}) {
  return {
    // which set the unmown ground is, the tile (m) of the mown cut, of the green's nap, of the unmown ground
    uEnvA: new THREE.Vector4(envLayer(env.rough ?? 'rough'), env.mownTileM ?? 1.5, env.greenTileM ?? 0.75, env.roughTileM ?? 2.6),
    // the colour detail's strength on the mown and on the unmown ground, the normal's strength, snow's sparkle
    uEnvB: new THREE.Vector4(env.detail ?? 0.8, env.roughDetail ?? 0.9, env.normal ?? 0.5, env.sparkle ?? 0),
    // the rock's tile (m), the sand's tile (m), the rock detail's strength, how far apart the two scales of a set are
    uEnvC: new THREE.Vector4(env.rockTileM ?? 11, env.sandTileM ?? 3.2, env.rockDetail ?? 1, env.farScale ?? 6.3),
  };
}
