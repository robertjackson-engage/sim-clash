// v3:environment The world round an arcade stage (public/render/far-world.js, env-materials.js, the
// sky / ground / air / grade parts of arcade-look.js, quality.js env tiers) and the art
// that ships for it (public/arcade/env, tools/arcade-art/env). What can be pinned without a
// GPU: every theme at every time of day resolves to a complete sky, ground and grade; the
// sun is one direction for the sky, the light and the shadows; the files on disk are the
// files the manifest names; the tiers are ordered; and the real look gets none of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  ARCADE_LOOK, THEMES, TIMES_OF_DAY, resolveLook, lookSkyPano, lookSkyPreset, lookPanoPreset, lookGround, lookWater, lookTurf, lookFogColor, lookCourse,
} from '../public/render/arcade-look.js';
import { panoSun, packFarLayer, panoRadiance, FAR_LAYER_TYPES, MAX_FAR_LAYERS } from '../public/render/far-world.js';
import { ENV_LAYERS, envLayer, turfEnvUniforms, cliffEnvUniforms } from '../public/render/env-materials.js';
import { skyDirection, paintSky } from '../public/render/arcade-sky.js';
import { SKY_PRESETS } from '../public/render/sky-presets.js';
import { QUALITY_PRESETS } from '../public/render/quality.js';
import { makeTurfMaterial } from '../public/render/turf.js';
import { SKY_BAND, closeSeam, seamError, findHorizon, findSun, makeTileable, tileError, heightFromColor, normalFromHeight } from '../tools/arcade-art/env/lib.mjs';

THREE.TextureLoader.prototype.load = function load() { return new THREE.Texture(); };

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envDir = path.join(repo, 'public', 'arcade', 'env');
const manifest = JSON.parse(fs.readFileSync(path.join(envDir, 'manifest.json'), 'utf8'));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const HEX = /^#[0-9a-f]{6}$/i;
const themed = (theme, timeOfDay) => { const s = { look: 'arcade', geo: { arcade: { theme, timeOfDay } } }; lookCourse(s); return s; };
// the stages as they ship: theme and time of day (tools/arcade-holes; docs/arcade-look.md)
const STAGES = [
  ['tropical', 'day'], ['canyon', 'golden'], ['links', 'day'], ['volcano', 'dusk'], ['alpine', 'day'], ['sakura', 'day'],
  ['jungle', 'golden'], ['desert', 'golden'], ['neon', 'night'], ['stadium', 'night'], ['alpine', 'golden'],
];

test('the manifest names every sky and ground set, and the files on disk are those files', () => {
  assert.equal(manifest.format, 1);
  let bytes = 0;
  const files = [];
  for (const [id, s] of Object.entries(manifest.skies)) {
    assert.match(id, /^[a-z0-9-]+$/);
    assert.equal(s.file, `sky/${id}.webp`);
    files.push(s);
    assert.deepEqual(s.band, [...SKY_BAND], `${id}: the band the dome shader draws`);
    assert.equal(s.width / s.height, 4, `${id}: 90 degrees of sky a quarter of the way round`);
    assert.equal(s.haze.length, 16);
    for (const c of [...s.haze, s.horizon, s.zenith, s.ground]) assert.match(c, HEX);
    assert.ok(s.luma > 0 && s.luma < 1);
    assert.ok(s.sun && s.sun.azDeg >= 0 && s.sun.azDeg < 360 && s.sun.altDeg > 0 && s.sun.altDeg < 75, `${id}: a sun or a moon in the sky`);
    assert.ok(s.source && /generated/.test(s.source.made) && s.source.model, `${id}: where the picture came from`);
  }
  for (const [id, t] of Object.entries(manifest.textures)) {
    assert.ok(ENV_LAYERS.includes(id), `${id} is a layer of the ground array`);
    assert.equal(t.color.file, `tex/${id}_c.webp`);
    assert.equal(t.normal.file, `tex/${id}_n.webp`);
    assert.ok(t.tileError < 0.02, `${id} tiles (wrap step ${t.tileError})`);
    assert.ok(t.tileM > 0 && t.size >= 512);
    files.push(t.color, t.normal);
  }
  for (const f of files) {
    const buf = fs.readFileSync(path.join(envDir, f.file));
    assert.equal(buf.length, f.bytes, `${f.file}: size`);
    assert.equal(sha(buf), f.sha256, `${f.file}: checksum`);
    assert.equal(buf.subarray(8, 12).toString('latin1'), 'WEBP');
    bytes += buf.length;
  }
  // nothing in the folders that the manifest does not name (it would ship unverified)
  for (const dir of ['sky', 'tex']) {
    for (const name of fs.readdirSync(path.join(envDir, dir))) assert.ok(files.some((f) => f.file === `${dir}/${name}`), `${dir}/${name} is not in the manifest`);
  }
  assert.deepEqual(Object.keys(manifest.textures).sort(), [...ENV_LAYERS].sort(), 'every layer of the ground array has its set');
  const skyBytes = Object.values(manifest.skies).reduce((n, s) => n + s.bytes, 0);
  assert.ok(skyBytes < 40 * 1048576, `the skies weigh ${(skyBytes / 1048576).toFixed(1)} MB`);
  assert.ok(bytes < 48 * 1048576);
});

test('every theme at every time of day resolves to a complete sky, ground, air and grade', () => {
  for (const theme of THEMES) {
    for (const time of TIMES_OF_DAY) {
      const L = resolveLook(theme, time), tag = `${theme}/${time}`;
      // a sky: a panorama the manifest has, or a painted sky, or a sky photo preset
      if (L.sky.pano) {
        assert.ok(manifest.skies[L.sky.pano.id], `${tag}: panorama ${L.sky.pano.id} is in the manifest`);
        assert.ok(L.sky.pano.envLuma > 0 && L.sky.pano.gain > 0);
        assert.ok(Array.isArray(L.sky.far) && L.sky.far.length >= 1 && L.sky.far.length <= MAX_FAR_LAYERS, `${tag}: far layers`);
        for (const layer of L.sky.far) {
          assert.ok(layer.type in FAR_LAYER_TYPES, `${tag}: far layer type ${layer.type}`);
          assert.ok(layer.distM >= 1000 && layer.distM <= 12000 && layer.heightM > 0);
          assert.match(layer.color, HEX);
        }
        assert.ok(L.sky.air && L.sky.air.falloffM > 0, `${tag}: the air under a panorama`);
      } else {
        assert.ok(L.sky.paint || SKY_PRESETS[L.sky.preset], `${tag}: a painted sky or a photo preset`);
        assert.ok(!L.sky.far && !L.sky.air, `${tag}: far layers and air belong to a panorama`);
      }
      // the ground: a set of the array for the unmown ground, rock for the cliffs
      assert.ok(ENV_LAYERS.includes(L.turf.env.rough), `${tag}: unmown ground set`);
      for (const k of ['mownTileM', 'greenTileM', 'roughTileM', 'rockTileM', 'sandTileM']) assert.ok(L.turf.env[k] > 0, `${tag}: ${k}`);
      assert.ok(L.turf.cliff && HEX.test(L.turf.cliff.a) && HEX.test(L.turf.cliff.b));
      assert.equal(typeof L.turf.blades.rough, 'boolean');
      // what stands past the edge
      assert.ok(L.sky.ground && L.sky.ground.hills > 0, `${tag}: the country past the edge`);
      // the grade
      const G = L.grade;
      assert.ok(G.film >= 0 && G.film <= 0.4 && G.vibrance >= 0 && G.tint > 0 && G.tint <= 0.12, `${tag}: grade`);
      assert.match(G.shadows, HEX); assert.match(G.highlights, HEX);
      assert.ok(G.vignette <= 0.35, `${tag}: a light vignette`);
      assert.ok(G.bloom.strength <= 0.2 && G.bloom.threshold >= 1.25, `${tag}: bloom glows, it does not wash out`);
      assert.ok(G.dof && G.dof.maxPx <= 9 && G.motionBlur <= 0.7);
      // water extras
      assert.ok(['water', 'ice'].includes(L.water.surface));
    }
  }
});

test('the stages as they ship each have their own panorama', () => {
  const ids = new Set();
  for (const [theme, time] of STAGES) {
    const L = resolveLook(theme, time);
    assert.ok(L.sky.pano, `${theme}/${time} has a panorama`);
    ids.add(L.sky.pano.id);
  }
  assert.equal(ids.size, STAGES.length, 'no two of them share one');
  assert.deepEqual([...ids].sort(), Object.keys(manifest.skies).sort(), 'and no sky ships that no stage uses');
});

test('the sun is one direction for the sky, the light and the shadows', () => {
  for (const [theme, time] of STAGES) {
    const L = resolveLook(theme, time), entry = manifest.skies[L.sky.pano.id], tag = `${theme}/${time}`;
    const sun = panoSun(entry, { minAltDeg: L.sky.pano.minSunAltDeg, maxAltDeg: L.sky.pano.maxSunAltDeg });
    // the light's bearing is the picture's sun's bearing, exactly
    assert.equal(sun.azDeg, entry.sun.azDeg, `${tag}: bearing`);
    // its height is the picture's, held where shadows stay readable
    assert.ok(sun.altDeg >= entry.sun.altDeg, `${tag}: never under the picture's sun`);
    assert.ok(sun.altDeg >= 10 && sun.altDeg <= 64, `${tag}: light at ${sun.altDeg} degrees`);
    assert.equal(sun.skyAltDeg, entry.sun.altDeg);
    // the direction handed to the scene (scene.sunDir: the DirectionalLight, _fitShadows, the water's glitter) is that bearing and height
    const d = skyDirection(sun.azDeg, sun.altDeg);
    assert.ok(Math.abs(d.x - sun.x) < 1e-12 && Math.abs(d.y - sun.y) < 1e-12 && Math.abs(d.z - sun.z) < 1e-12);
    assert.ok(Math.abs(Math.hypot(sun.x, sun.y, sun.z) - 1) < 1e-9);
    // seen from above, the light and the sky's sun lie on one line from the course
    const sky = skyDirection(entry.sun.azDeg, entry.sun.altDeg);
    const cross = sun.x * sky.z - sun.z * sky.x, dot = sun.x * sky.x + sun.z * sky.z;
    assert.ok(Math.abs(cross) < 1e-9 && dot > 0, `${tag}: shadows fall straight away from the sun in the sky`);
    // a day's sun stays where the picture has it; a low sun or a night's moon is lifted, and the look says how far
    if (time === 'day') assert.ok(sun.altDeg - entry.sun.altDeg < 6, `${tag}: a day's light is the picture's sun`);
    // from the tee (holes play north) the sun is off to one side or behind, never dead ahead
    const off = Math.abs(((entry.sun.azDeg + 180) % 360) - 180);
    assert.ok(off > 35, `${tag}: the sun is ${off.toFixed(0)} degrees off the line of play`);
  }
  // no sun in the picture: the light keeps a bearing and a height of its own
  const none = panoSun({ sun: null }, { azDeg: 200, altDeg: 40 });
  assert.equal(none.azDeg, 200); assert.equal(none.altDeg, 40);
});

test('the radiance map a panorama lights by: the picture, scaled, with a ground and a sun', () => {
  const bw = 64, bh = 16, band = new Uint8ClampedArray(bw * bh * 4);
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) { const o = (j * bw + i) * 4; band[o] = 40; band[o + 1] = 90; band[o + 2] = 200; band[o + 3] = 255; }
  const entry = { band: [-15, 75], ground: '#20c0c0', sun: { azDeg: 270, altDeg: 30, color: '#ffffff' } };
  const img = panoRadiance(band, bw, bh, entry, { width: 64, height: 32, envLuma: 0.5, envSun: 0 });
  assert.equal(img.data.length, 64 * 32 * 4);
  // row 0 is straight down (three's equirect layout): ground, greyer and darker than the picture's turquoise
  const g = [img.data[0], img.data[1], img.data[2]];
  assert.ok((Math.max(...g) - Math.min(...g)) / Math.max(...g) < 0.5, 'the ground half has lost most of the picture\'s turquoise (which is all but pure)');
  // the sky's mean brightness is what was asked for
  let sum = 0, n = 0;
  for (let j = 20; j < 28; j++) for (let i = 0; i < 64; i++) { const o = (j * 64 + i) * 4; sum += 0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2]; n++; }
  assert.ok(Math.abs(sum / n - 0.5) < 0.02, `sky luma ${sum / n}`);
  // with a sun, the brightest texel is where the sun is: due west (270), 30 up
  const lit = panoRadiance(band, bw, bh, entry, { width: 64, height: 32, envLuma: 0.5, envSun: 6, sun: { azDeg: 270, altDeg: 30, skyAltDeg: 30 } });
  let best = -1, bi = 0, bj = 0;
  for (let j = 0; j < 32; j++) for (let i = 0; i < 64; i++) { const v = lit.data[(j * 64 + i) * 4]; if (v > best) { best = v; bi = i; bj = j; } }
  const el = ((bj + 0.5) / 32 - 0.5) * 180, phi = ((bi + 0.5) / 64 - 0.5) * 2 * Math.PI;
  const az = (Math.atan2(Math.cos(phi), -Math.sin(phi)) * 180 / Math.PI + 360) % 360;
  assert.ok(Math.abs(el - 30) < 6 && Math.abs(az - 270) < 8, `sun found at az ${az.toFixed(0)}, ${el.toFixed(0)} up`);
});

test('a far layer packs into what the dome shader reads', () => {
  const p = packFarLayer({ type: 'skyline', distM: 3600, baseM: 5, heightM: 620, freq: 110, seed: 3, color: '#1c1648', top: '#ff9af0', glow: 1.3, haze: 0.3 });
  assert.deepEqual(p.a, [3600, 5, 620, 110]);
  assert.deepEqual(p.b, [3, FAR_LAYER_TYPES.skyline, 0.3, 1]);
  assert.equal(p.e[1], 1.3);
  assert.ok(p.low.isColor && p.high.isColor);
  assert.equal(packFarLayer({ type: 'no-such' }).b[1], 0, 'an unknown type is mountains');
  assert.ok(packFarLayer({ distM: 10 }).a[0] >= 300, 'never on top of the course');
});

test('the panorama, its far layers and its air are for a themed stage in the arcade look only', () => {
  // the real look: nothing, whatever the course says
  const real = { look: 'real', geo: { arcade: { theme: 'tropical' } } };
  lookCourse(real);
  assert.equal(lookSkyPano(real), null);
  assert.equal(lookGround(real), null);
  assert.equal(lookTurf(real), null);
  assert.equal(lookWater(real), null);
  const preset = SKY_PRESETS.midday;
  assert.equal(lookPanoPreset(lookSkyPreset(preset, real), real), preset, 'the sky preset comes back as it went in');
  for (const bare of ['real', 'arcade', null, undefined]) assert.equal(lookSkyPano(bare), null);
  // the arcade look on a course with no theme (a real course): its sky photo, the rolling country
  const plain = { look: 'arcade', geo: {} };
  lookCourse(plain);
  assert.equal(lookSkyPano(plain), null);
  assert.equal(lookGround(plain), null);
  // a themed stage
  const lagoon = themed('tropical', 'day');
  assert.equal(lookSkyPano(lagoon), ARCADE_LOOK.sky);
  assert.equal(lookSkyPano(lagoon).pano.id, 'tropical-day');
  assert.equal(lookGround(lagoon).island, 150, 'the lagoon stages are islands');
  assert.equal(lookWater(lagoon), ARCADE_LOOK.water, 'the look\'s water is still the same object');
  // a theme at a time of day it has no panorama for: its painted sky, as before
  const canyonNight = themed('canyon', 'night');
  assert.equal(lookSkyPano(canyonNight), null);
  // under a panorama the haze is the picture's own: only a touch of the theme's pastel
  const base = new THREE.Color(0.2, 0.4, 0.6);
  const under = lookFogColor(base.clone(), { ...lagoon, _panoSky: ARCADE_LOOK.sky });
  const without = lookFogColor(base.clone(), lagoon);
  const dist = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  assert.ok(dist(under, base) < dist(without, base) * 0.5);
});

test('the turf takes the ground sets only when a look asks for them', () => {
  const tex = new THREE.Texture();
  const inputs = { baseMap: tex, mownMask: tex, bunkerMask: tex, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, anisotropy: 1 };
  const compile = (mat) => { const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader }; mat.onBeforeCompile(shader); return shader; };
  const real = compile(makeTurfMaterial(inputs));
  assert.ok(!/#define TURF_ENV/.test(real.fragmentShader), 'the real look compiles no TURF_ENV');
  assert.ok(!('uEnvTex' in real.uniforms) && !('uEnvA' in real.uniforms));
  assert.ok(!/sampler2DArray/.test(real.fragmentShader));
  // every use of the sets sits inside an #ifdef TURF_ENV (or the uniforms would be missing in the real look)
  const src = real.fragmentShader.split('\n');
  let depth = 0, inEnv = [];
  for (const line of src) {
    if (/^\s*#if/.test(line)) { depth++; inEnv.push(/TURF_ENV/.test(line) || inEnv[inEnv.length - 1] === true); }
    else if (/^\s*#endif/.test(line)) { depth--; inEnv.pop(); }
    else if (/\benv[CN]\(|uEnv[ABC]\b|envSpark/.test(line)) assert.ok(inEnv.includes(true), `outside TURF_ENV: ${line.trim().slice(0, 80)}`);
  }
  assert.equal(depth, 0);
  const arcadeMat = makeTurfMaterial({ ...inputs, arcade: ARCADE_LOOK.turf });
  const arcade = compile(arcadeMat);
  assert.match(arcade.fragmentShader, /#define TURF_ENV/);
  assert.ok(arcade.uniforms.uEnvTex.value.isDataArrayTexture);
  assert.equal(arcade.uniforms.uEnvTex.value.image.depth, ENV_LAYERS.length * 2, 'colour layers, then normal layers');
  assert.notEqual(arcadeMat.customProgramCacheKey(), makeTurfMaterial(inputs).customProgramCacheKey());
  // which set is the unmown ground
  assert.equal(turfEnvUniforms(resolveLook('alpine', 'day').turf.env).uEnvA.x, envLayer('snow'));
  assert.equal(turfEnvUniforms(resolveLook('volcano', 'dusk').turf.env).uEnvA.x, envLayer('basalt'));
  assert.equal(turfEnvUniforms(resolveLook('desert', 'golden').turf.env).uEnvA.x, envLayer('sand'));
  assert.equal(turfEnvUniforms(ARCADE_LOOK.turf.env).uEnvA.x, envLayer('rough'));
  assert.ok(resolveLook('alpine', 'day').turf.env.sparkle > 0, 'snow sparkles');
  // no blades of grass on snow, basalt or sand
  for (const t of ['alpine', 'volcano', 'desert', 'canyon']) assert.equal(resolveLook(t, 'day').turf.blades.rough, false, t);
});

test('graphics tiers: three, ordered, and Low pays for none of the extras', () => {
  const { ultra: U, high: H, low: L } = QUALITY_PRESETS;
  for (const p of [U, H, L]) {
    assert.deepEqual(Object.keys(p.env).sort(), ['atmosphere', 'blades', 'ground', 'lens', 'skyWidth', 'tier', 'waterFx']);
  }
  assert.deepEqual([L.env.tier, H.env.tier, U.env.tier], [0, 1, 2]);
  assert.ok(U.env.blades >= H.env.blades && H.env.blades > L.env.blades);
  assert.ok(U.env.waterFx >= H.env.waterFx && H.env.waterFx > L.env.waterFx);
  assert.ok(U.env.skyWidth >= H.env.skyWidth && H.env.skyWidth > L.env.skyWidth);
  assert.equal(L.env.atmosphere, false); assert.equal(L.env.lens, false); assert.equal(L.env.blades, 0); assert.equal(L.env.waterFx, 0);
  assert.equal(H.env.atmosphere, true); assert.equal(H.env.lens, true);
  assert.ok(L.env.skyWidth >= 4096, 'even Low keeps a 4k sky');
});

test('art tools: a seam is closed without ghosting, a horizon and a sun are found', () => {
  const W = 256, H = 64, px = new Float32Array(W * H * 3);
  // a sky gradient that does NOT wrap (brighter to the right), sea under row 44, a sun
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 3, sea = y >= 44;
    const sun = Math.exp(-((x - 60) ** 2 + (y - 20) ** 2) / 18) * 200;
    px[o] = (sea ? 10 : 60 + x * 0.2) + sun; px[o + 1] = (sea ? 60 : 110 + x * 0.2) + sun; px[o + 2] = (sea ? 90 : 200) + sun;
  }
  assert.ok(seamError(px, W, H) > 0.05, 'the strip starts with a seam');
  const inside = px[(10 * W + 128) * 3];
  closeSeam(px, W, H, 24);
  assert.ok(seamError(px, W, H) < 0.01, `seam after: ${seamError(px, W, H)}`);
  assert.equal(px[(10 * W + 128) * 3], inside, 'the middle of the strip is untouched');
  assert.equal(findHorizon(px, W, H), 44);
  const sun = findSun(px, W, H, 44);
  assert.ok(Math.abs(sun.u - 60.5 / W) < 0.02 && Math.abs(sun.v - 20.5 / H) < 0.06, `sun at ${sun.u}, ${sun.v}`);
});

test('art tools: a texture is made to tile, and a normal map follows its height', () => {
  const N = 64, px = new Float32Array(N * N * 3);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const o = (y * N + x) * 3; px[o] = px[o + 1] = px[o + 2] = 40 + x * 2 + y; }   // a ramp: the worst case
  const before = tileError(px, N);
  makeTileable(px, N);
  assert.ok(before > 0.2 && tileError(px, N) < before * 0.1, `wrap step ${before} -> ${tileError(px, N)}`);
  // height from light and shade, normals from height: a bump's left side leans left
  const bump = new Float32Array(N * N * 3);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const v = 120 + 100 * Math.exp(-((x - 32) ** 2 + (y - 32) ** 2) / 40); const o = (y * N + x) * 3; bump[o] = bump[o + 1] = bump[o + 2] = v; }
  const h = heightFromColor(bump, N);
  assert.ok(h[32 * N + 32] > h[32 * N + 20], 'the bright spot is high');
  const n = normalFromHeight(h, N, 4);
  assert.ok(n[(32 * N + 28) * 3] < 128 && n[(32 * N + 36) * 3] > 128, 'x leans away from the top on both sides');
  assert.ok(n[(4 * N + 4) * 3 + 2] > 250, 'flat ground points up');
});

// ---- v3:env-polish
const hsl = (hexStr) => { const c = new THREE.Color(hexStr), o = {}; c.getHSL(o, THREE.SRGBColorSpace); return o; };   // as the hex reads, not in linear light
const hueDeg = (hexStr) => hsl(hexStr).h * 360;
const hueGap = (a, b) => { const d = Math.abs(hueDeg(a) - hueDeg(b)) % 360; return Math.min(d, 360 - d); };
const isGreen = (hexStr) => { const c = new THREE.Color(hexStr); return c.g > c.r * 1.25 && c.g > c.b * 1.25; };

test('a volcano stage is a playable hole, not a night: a warm white key from well up, a fill without the sky\'s red', () => {
  const L = resolveLook('volcano', 'dusk'), P = L.sky.pano;
  const light = lookPanoPreset(lookSkyPreset(SKY_PRESETS.midday, { look: 'arcade', _arcadeLook: L }), { look: 'arcade', _arcadeLook: L });
  // the key: close to white (a warm one), bright, and high enough that level ground is fully lit
  const sun = new THREE.Color(light.sunColor);
  assert.ok(sun.b / sun.r > 0.7 && sun.g / sun.r > 0.85, `key light ${light.sunColor} is a warm white, not orange`);
  assert.ok(light.sunIntensity >= 3.2 && light.exposure >= 0.95);
  assert.ok(P.minSunAltDeg >= 30, 'short shadows');
  // the fill: the ember sky's own colour is all but out of it, and what is left leans cool
  assert.ok(P.envSat <= 0.3, 'the red is taken out of the light the sky gives');
  const tint = new THREE.Color(P.envTint);
  assert.ok(tint.b >= tint.r, 'and the fill leans cool');
  assert.ok(P.envLuma >= 0.6, 'brighter than the lagoon\'s shade');
  // the lava is the brightest warm thing in frame: the sky is drawn under full brightness
  assert.ok(P.gain < 1 && L.water.glow.mode === 'lava' && L.water.glow.strength >= 1);
  // mown turf is green, and the grade does not pour orange over it
  for (const k of ['fairwayA', 'fairwayB', 'greenA', 'greenB', 'tee']) assert.ok(isGreen(L.palette[k]), `${k} ${L.palette[k]}`);
  assert.ok(L.grade.saturation <= 1.12 && L.grade.tint <= 0.05);
  assert.ok(L.turf.glow.lift <= 0.12, 'little night-time self-glow on a lit hole: it turned the green to neon (some is kept for the painted-sky fallback)');
  // the tee, the green and the flag still read: glowing edges, a self-lit flag, a dark halo behind the ball
  assert.ok(L.turf.glow.edgeGain > 0 && L.turf.glow.greenEdgeGain > 0 && L.flag.glow > 0 && L.ball.halo);
  // the radiance map really does lose the red: a pure ember band, lit through this look's numbers
  const bw = 32, bh = 8, band = new Uint8ClampedArray(bw * bh * 4);
  for (let i = 0; i < bw * bh; i++) { band[i * 4] = 230; band[i * 4 + 1] = 70; band[i * 4 + 2] = 30; band[i * 4 + 3] = 255; }
  const entry = { band: [-15, 75], ground: '#502527', sun: null };
  const raw = panoRadiance(band, bw, bh, entry, { width: 32, height: 16, envLuma: 0.66, envSun: 0 });
  const lit = panoRadiance(band, bw, bh, entry, { width: 32, height: 16, envLuma: 0.66, envSun: 0, envSat: P.envSat, envTint: P.envTint });
  const at = (img) => { const o = (12 * 32 + 5) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2]]; };
  const [r0, g0] = at(raw), [r1, g1, b1] = at(lit);
  assert.ok(r0 / g0 > 3, 'as painted the sky lights everything red');
  assert.ok(r1 / g1 < 1.5 && b1 / g1 > 0.75, `with this look's fill most of that is gone (${[r1, g1, b1].map((v) => v.toFixed(2))})`);
  const lum = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  assert.ok(Math.abs(lum(at(lit)) - lum(at(raw))) < 0.03, 'at the brightness it had');
});

test('the canyon and the desert keep their hues apart: red rock, tan dust, green turf, teal water', () => {
  for (const [theme, time] of [['canyon', 'golden'], ['desert', 'golden']]) {
    const L = resolveLook(theme, time), tag = `${theme}/${time}`, P = L.sky.pano;
    for (const k of ['fairwayA', 'fairwayB', 'greenA', 'greenB', 'tee']) assert.ok(isGreen(L.palette[k]), `${tag}: ${k} ${L.palette[k]} is green`);
    // the wall is redder (and deeper) than the dust it stands in
    assert.ok(hueDeg(L.palette.base) - hueDeg(L.turf.cliff.a) >= 8, `${tag}: rock ${L.turf.cliff.a} against dust ${L.palette.base}`);
    assert.ok(hsl(L.turf.cliff.b).l < hsl(L.palette.base).l - 0.2);
    // water is a blue-green a long way round the wheel from both
    assert.ok(hueGap(L.palette.water, L.palette.base) > 120 && hueGap(L.water.deep, L.turf.cliff.a) > 120, `${tag}: water`);
    // the light: a warm white sun, a fill that leans cool, so shadows are not more orange
    const sun = new THREE.Color(P.light.sunColor);
    assert.ok(sun.b / sun.r > 0.5 && sun.g / sun.r > 0.75, `${tag}: sun ${P.light.sunColor} is a warm white (it was #ffb469, orange)`);
    const tint = new THREE.Color(P.envTint);
    assert.ok(tint.b > tint.r && P.envSat <= 0.6, `${tag}: a cool fill`);
    assert.ok(P.minSunAltDeg >= 18, `${tag}: the sun is lifted off the horizon`);
    // the grade is pulled back, with a cool shadow colour; the haze is pale, not the ground's orange
    const G = L.grade, sh = new THREE.Color(G.shadows);
    assert.ok(G.saturation <= 1.12 && G.tint <= 0.05 && G.vibrance <= 0.12, `${tag}: grade`);
    assert.ok(sh.b > sh.r * 1.5, `${tag}: shadows ${G.shadows} are cool`);
    assert.ok(hsl(L.fog.color).s < 0.6 && hsl(L.fog.color).l > 0.8, `${tag}: haze ${L.fog.color} is pale`);
    assert.ok(L.sky.air.colorMix >= 0.4, `${tag}: the air takes the pale haze, not only the sky's orange horizon`);
    // far layers stand off each other: the farther, the hazier
    const far = [...L.sky.far].sort((a, b) => a.distM - b.distM);
    for (let i = 1; i < far.length; i++) assert.ok(far[i].haze > far[i - 1].haze);
  }
});

test('a cliff is not a tiled floor stood on end: bands, a second rock, a cap, all behind TURF_ENV', () => {
  // what a look gives the rock: a band colour, a second set of the array, how far the hue wanders, what lies on it
  const plain = cliffEnvUniforms({ a: '#9a8a72', b: '#75675a' });
  assert.ok(plain.uArcCliffC.isColor && plain.uArcCliffC.getHSL({}).l > new THREE.Color('#9a8a72').getHSL({}).l, 'the pale band is lighter than the rock');   // (both in linear light)
  assert.equal(plain.uArcCliffD.x, envLayer('rock'), 'the second rock defaults to the rock set itself (laid on its side)');
  assert.ok(plain.uArcCliffD.y > 15 && plain.uArcCliffD.z > 0.2 && plain.uArcCliffD.z < 0.6 && plain.uArcCliffD.w === 1);
  assert.equal(plain.uArcCliffE.w, 0, 'no cap unless the look names one');
  assert.equal(cliffEnvUniforms({ a: '#5b4743', set2: 'basalt', set2TileM: 14, set2Mix: 2 }).uArcCliffD.x, envLayer('basalt'), 'a look may name another set');
  assert.equal(cliffEnvUniforms({ set2Mix: 2 }).uArcCliffD.z, 1, 'its share is held to 0..1');
  const alpine = cliffEnvUniforms(resolveLook('alpine', 'day').turf.cliff);
  assert.ok(alpine.uArcCliffE.w > 0.5 && alpine.uArcCliffE.x > 0.8, 'snow lies on an alpine wall');
  assert.ok(cliffEnvUniforms(resolveLook('sakura', 'day').turf.cliff).uArcCliffE.y > 0.2, 'moss on a garden one');
  // alpine rock is not the blue of the shade on the snow any more
  assert.ok(hsl(resolveLook('alpine', 'day').turf.cliff.a).s < 0.08);
  for (const t of THEMES) assert.match(resolveLook(t, 'day').turf.cliff.a, HEX);
  // the shader: the rock is read inside a branch (nothing on level ground), by gradient, along four bearings and from above
  const tex = new THREE.Texture();
  const inputs = { baseMap: tex, mownMask: tex, bunkerMask: tex, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, anisotropy: 1 };
  const compile = (mat) => { const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader }; mat.onBeforeCompile(shader); return shader; };
  const arcade = compile(makeTurfMaterial({ ...inputs, arcade: ARCADE_LOOK.turf }));
  const fs0 = arcade.fragmentShader;
  for (const u of ['uArcCliffC', 'uArcCliffD', 'uArcCliffE']) assert.ok(u in arcade.uniforms, u);
  assert.match(fs0, /vec4 rockAt\(vec2 uv, vec2 dx, vec2 dy/);
  assert.match(fs0, /if \(arcRock > 0\.002\) \{/);
  assert.equal((fs0.match(/rk \+= w[ST]\.?[xyzw]? \* rockAt\(/g) || []).length, 5, 'four bearings round the compass and one from above');
  const rockFn = fs0.slice(fs0.indexOf('vec4 rockAt('), fs0.indexOf('return r;', fs0.indexOf('vec4 rockAt(')));
  assert.ok(!/\benvC\(/.test(rockFn) && (rockFn.match(/envCG\(/g) || []).length === 4, 'every read in the branch is given its gradients');
  assert.match(fs0, /cross\(rPx, rPy\)/, 'from above or from the side goes by the triangle\'s own slope');
  // a look with rock but without the ground sets keeps the plain two-colour rock, and compiles none of this
  const bare = compile(makeTurfMaterial({ ...inputs, arcade: { ...ARCADE_LOOK.turf, env: null } }));
  assert.ok(!/vec4 rockAt\(|uniform vec3 uArcCliffC|#define TURF_ENV/.test(bare.fragmentShader) && /#define TURF_CLIFF/.test(bare.fragmentShader));
  assert.ok(!('uArcCliffD' in bare.uniforms));
  // and the real look none of it at all
  const real = compile(makeTurfMaterial(inputs));
  assert.ok(!/#define TURF_CLIFF/.test(real.fragmentShader) && !/vec4 rockAt/.test(real.fragmentShader));
});

test('the far world is one function for the dome and for the sky the water mirrors', () => {
  const src = fs.readFileSync(path.join(repo, 'public', 'render', 'far-world.js'), 'utf8');
  assert.match(src, /vec3 farWorld\(vec3 col, vec3 d, vec3 cam, float az, float k, float px\)/);
  assert.equal((src.match(/\$\{FAR_GLSL\}/g) || []).length, 2, 'the dome and the mirror share it');
  assert.match(src, /col = farWorld\(col, d, cameraPosition, az, 1\.0, uPixel\);/);
  assert.match(src, /farWorld\(col, d, uCenter \+ vec3\(0\.0, 2\.0, 0\.0\)/);
  // no sampler is read with an implicit level inside the layers' loop (a driver warning, and undefined on some)
  const far = src.slice(src.indexOf('const FAR_GLSL'), src.indexOf('const DOME_FRAG'));
  assert.ok(!/texture2D\(/.test(far), 'only textureLod in the shared part');
  // the scene hands the water that picture, and falls back to the light's own map
  const scene = fs.readFileSync(path.join(repo, 'public', 'render', 'scene.js'), 'utf8');
  assert.match(scene, /this\._waterSetSky\?\.\(this\._waterSky \|\| equirect\)/);
  assert.match(scene, /setSky\(this\._waterSky \|\| this\._equirect \|\| null\)/);
});

test('the server knows a .webp for what it is (the stage skies and ground sets)', () => {
  const server = fs.readFileSync(path.join(repo, 'server.js'), 'utf8');
  assert.match(server, /const MIME = \{[^}]*'\.webp': 'image\/webp'[^}]*\}/);
});

test('the neon skyline is the third take: flat-roofed invented towers, its prompt on record', () => {
  const s = manifest.skies['neon-night'];
  assert.match(s.source.prompt, /perfectly flat level roof/);
  assert.match(s.source.prompt, /no spires, no antennas/);
  assert.match(s.source.prompt, /must not resemble any real city/);
  assert.ok(s.source.job && s.source.note);
  assert.equal(s.source.prompt, fs.readFileSync(path.join(repo, 'tools', 'arcade-art', 'env', 'prompts', 'neon-night.txt'), 'utf8').trim(), 'the prompt file is the prompt that made it');
});

test('the painted skies still paint (the fallback when a panorama cannot be had)', () => {
  for (const [theme, time] of [['volcano', 'dusk'], ['neon', 'night'], ['stadium', 'night']]) {
    const L = resolveLook(theme, time);
    assert.ok(L.sky.paint, `${theme}/${time} keeps its painted sky under the panorama`);
    const img = paintSky(L.sky.paint, 32, 16);
    assert.ok(img.data.every((v) => Number.isFinite(v)));
  }
  // and a photo theme keeps its preset
  for (const [theme, time] of [['links', 'day'], ['canyon', 'golden'], ['alpine', 'day']]) assert.ok(SKY_PRESETS[resolveLook(theme, time).sky.preset], `${theme}/${time}`);
});
