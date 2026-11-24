// The switchable look (public/render/arcade-look.js) and the GLB props layer's sums
// (public/render/props.js). The point of most of these: in the 'real' look every hook
// hands back exactly what it was given, so the default rendering cannot move.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  ARCADE_LOOK, parseLook, lookSkyPreset, lookFogColor, lookShadowRadius, lookSkySetting, lookFlagColors,
  lookPalette, lookCourse, lookTurf, lookSand, lookWater, lookTrees, lookProps, lookTracer, shotTrail, shotRocket,
  THEMES, TIMES_OF_DAY, ARCADE_THEMES, parseTheme, parseTimeOfDay, themeTimeOfDay, resolveLook, courseTheme, lookTheme,
  setLookThemeOverride, lookSkyPaint, lookTreeSpots, lookBallHalo,
} from '../public/render/arcade-look.js';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { paintSky, skyDirection, skyColor } from '../public/render/arcade-sky.js';
import { buildPropModel, makePropMaterial, targetRingGeometry, buildTargetRing, PROCEDURAL_PROP_KINDS, TARGET_RING_COLORS } from '../public/render/prop-models.js';
import { SKY_PRESETS } from '../public/render/sky-presets.js';
import { COLORS } from '../public/render/course-character.js';
import { makeTurfMaterial } from '../public/render/turf.js';
import { ShotTracer, makeGlow, RocketFx, flameColors, rocketFlame, rocketSpeedK, ROCKET_SPARKS } from '../public/render/shot-fx.js';
import {
  propUrl, normalizeProp, propScale, propOriginZ, bridgeScale, PropsLayer, PROP_SINK_M, PROP_KIND_HEIGHT_M,
  PROP_GLB_KINDS, PROP_PROCEDURAL_KINDS, PROP_FLOAT_M, PROP_PROC_SCHEME, propCullM,
} from '../public/render/props.js';

// TextureLoader.load needs a DOM Image; stub it so the turf material builds headless.
THREE.TextureLoader.prototype.load = function load() { return new THREE.Texture(); };

test('a look is real unless it is exactly arcade', () => {
  assert.equal(parseLook('arcade'), 'arcade');
  assert.equal(parseLook(' Arcade '), 'arcade');
  for (const v of [undefined, null, '', 'real', 'toon', 0, {}]) assert.equal(parseLook(v), 'real');
});

test('the real look: every hook returns its input untouched', () => {
  for (const preset of Object.values(SKY_PRESETS)) assert.equal(lookSkyPreset(preset, 'real'), preset);
  const fog = new THREE.Color(0.31, 0.42, 0.53);
  assert.equal(lookFogColor(fog, 'real'), fog);
  assert.deepEqual(fog.toArray(), [0.31, 0.42, 0.53]);
  assert.equal(lookShadowRadius(3, 'real'), 3);
  assert.equal(lookShadowRadius(1.5, 'real'), 1.5);
  const scene = { look: 'real' };
  assert.equal(lookSkySetting(scene, 'morning'), 'morning');
  assert.deepEqual(scene, { look: 'real' }, 'nothing remembered on the scene');
  assert.equal(lookFlagColors('real'), undefined, 'pin-flag.js falls back to its own red');
  assert.equal(lookPalette(COLORS, 'real'), COLORS);
  for (const hook of [lookTurf, lookWater, lookTrees, lookProps]) assert.equal(hook('real'), null);
  assert.equal(lookTracer('real'), undefined);
  const sand = new THREE.MeshStandardMaterial({ color: new THREE.Color(1.62, 1.6, 1.52) });
  assert.equal(lookSand(sand, 'real'), sand);
  assert.deepEqual(sand.color.toArray(), [1.62, 1.6, 1.52]);
  assert.equal(sand.emissive.getHex(), 0x000000);
  const course = { look: 'real', _courseDry: 0.85, _fescue: 1, _pal: COLORS, _macro: { closeWeight: 0.85, farWeight: 0.92, photoFar: 0.62 }, _hdMacros: [] };
  lookCourse(course);
  assert.equal(course._courseDry, 0.85);
  assert.equal(course._fescue, 1);
  assert.equal(course._pal, COLORS);
  assert.deepEqual(course._macro, { closeWeight: 0.85, farWeight: 0.92, photoFar: 0.62 });
});

test('the real look: a shot played without trail options touches nothing', () => {
  const headGlow = makeGlow({ color: 0xffe7a3, px: 13 });
  const scene = { look: 'real', headGlow };
  assert.equal(shotTrail(scene, {}), undefined);
  assert.equal(headGlow.userData.uniforms.uPx.value, 13);
  assert.equal(scene._trailStyled, undefined);
});

test('the arcade palette replaces every ground colour, and the course goes lush', () => {
  const pal = lookPalette(COLORS, 'arcade');
  assert.notEqual(pal, COLORS);
  for (const key of Object.keys(COLORS)) {
    assert.match(pal[key], /^#[0-9a-f]{6}$/, key);
    assert.ok(key in ARCADE_LOOK.palette, `the arcade palette has ${key}`);
  }
  const course = { look: 'arcade', _courseDry: 0.85, _fescue: 1, _pal: COLORS, _macro: { closeWeight: 0.85, farWeight: 0.92, photoFar: 0.62, bounds: 1 }, _hdMacros: [{ closeWeight: 0.85, farWeight: 0.92 }] };
  lookCourse(course);
  assert.equal(course._courseDry, 0);
  assert.equal(course._fescue, 0);
  assert.equal(course._pal.fairwayA, ARCADE_LOOK.palette.fairwayA);
  assert.equal(course._macro.photoFar, ARCADE_LOOK.turf.macro.photoFar);
  assert.equal(course._macro.bounds, 1, 'the rest of the macro is left alone');
  assert.equal(course._hdMacros[0].closeWeight, ARCADE_LOOK.turf.macro.closeWeight);
});

test('the arcade light rides on the picked sky; an overcast sky keeps its own sun', () => {
  const golden = lookSkyPreset(SKY_PRESETS.golden, 'arcade');
  assert.equal(golden.hdri, SKY_PRESETS.golden.hdri, 'no new sky file');
  assert.equal(golden.sunColor, ARCADE_LOOK.light.sunColor);
  assert.equal(golden.sunAltitudeDeg, ARCADE_LOOK.light.sunAltitudeDeg);
  assert.ok(golden.fogDensity < SKY_PRESETS.golden.fogDensity, 'thinner haze');
  assert.ok(Object.isFrozen(SKY_PRESETS.golden) && SKY_PRESETS.golden.sunColor === '#ffb877', 'the preset itself is not written to');
  const grey = lookSkyPreset(SKY_PRESETS.overcast, 'arcade');
  assert.equal(grey.sunColor, SKY_PRESETS.overcast.sunColor);
  assert.equal(grey.sunIntensity, SKY_PRESETS.overcast.sunIntensity);
  assert.equal(grey.sunAltitudeDeg, SKY_PRESETS.overcast.sunAltitudeDeg);
  assert.equal(grey.overcast, true);
  const scene = { look: 'arcade' };
  assert.equal(lookSkySetting(scene, 'morning'), ARCADE_LOOK.sky.preset);
  assert.equal(scene._skyBeforeLook, 'morning', 'the player\'s own sky is kept to go back to');
  assert.ok(ARCADE_LOOK.sky.preset in SKY_PRESETS);
});

test('the shot trail: arcade by look or by option, tinted by trailColor, put back after', () => {
  const headGlow = makeGlow({ color: 0xffe7a3, px: 13 });
  const u = headGlow.userData.uniforms;
  const plain = u.uColor.value.getHex();
  const arcade = { look: 'arcade', headGlow };
  const t = shotTrail(arcade, {});
  assert.equal(t.widthPx, ARCADE_LOOK.trail.widthPx);
  assert.equal(t.color, ARCADE_LOOK.trail.color);
  assert.ok(t.arcade && t.arcade.gain > 1);
  assert.equal(u.uPx.value, ARCADE_LOOK.trail.headGlowPx);
  // a power-up's colour
  assert.equal(shotTrail(arcade, { trailColor: '#ff4fd8' }).color, '#ff4fd8');
  assert.notEqual(u.uColor.value.getHex(), plain);
  // the plain tracer on request, the glow back as the scene made it
  assert.equal(shotTrail(arcade, { trail: false }), undefined);
  assert.equal(u.uPx.value, 13);
  assert.equal(u.uColor.value.getHex(), plain);
  // the real look opts in per shot
  const real = { look: 'real', headGlow };
  assert.ok(shotTrail(real, { trail: true }).arcade);
  const tinted = shotTrail(real, { trailColor: 0x33ccff });
  assert.deepEqual(tinted, { color: 0x33ccff }, 'a tint alone keeps the plain tracer\'s shape');
  assert.equal(u.uPx.value, 13);
  assert.equal(shotTrail(real, {}), undefined);
  assert.equal(u.uColor.value.getHex(), plain);
});

test('the tracer and the turf compile their arcade code only when asked', () => {
  const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, -1)];
  const plain = new ShotTracer(pts, [0, 1]);
  assert.deepEqual(plain.mesh.material.defines, {});
  assert.equal(plain.uniforms.uGain, undefined);
  assert.equal(plain.uniforms.uPx.value, 6);
  const glowing = new ShotTracer(pts, [0, 1], lookTracer('arcade'));
  assert.deepEqual(glowing.mesh.material.defines, { TRACER_ARCADE: '' });
  assert.equal(glowing.uniforms.uGain.value, ARCADE_LOOK.trail.gain);

  const tex = () => new THREE.Texture();
  const base = { baseMap: tex(), mownMask: tex(), bunkerMask: tex(), bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, anisotropy: 4 };
  const fake = () => ({ uniforms: {}, vertexShader: '#include <common>', fragmentShader: '#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n#include <lights_fragment_end>' });
  const real = makeTurfMaterial(base), realShader = fake();
  real.onBeforeCompile(realShader);
  assert.equal(real.customProgramCacheKey(), 'turf-grain-v46');
  assert.doesNotMatch(realShader.fragmentShader, /#define TURF_ARCADE/);
  assert.ok(!Object.keys(realShader.uniforms).some((k) => k.startsWith('uArc')), 'no arcade uniforms in the real look');
  const arc = makeTurfMaterial({ ...base, arcade: lookTurf('arcade') }), arcShader = fake();
  arc.onBeforeCompile(arcShader);
  assert.equal(arc.customProgramCacheKey(), 'turf-grain-v46-arcade-cliff');   // the arcade look draws steep ground as rock
  assert.match(arcShader.fragmentShader, /#define TURF_ARCADE/);
  assert.equal(arcShader.uniforms.uStripeM.value, ARCADE_LOOK.turf.stripeM);
  for (const k of ['uArcStripe', 'uArcTone', 'uArcCollar', 'uArcSand']) assert.ok(arcShader.uniforms[k], k);
  // every arcade line in the shader sits inside an #ifdef, so the real program is the old one
  const src = realShader.fragmentShader.split('\n');
  let depth = 0;
  for (const line of src) {
    if (/^\s*#ifdef TURF_(ARCADE|GLOW|CLIFF)/.test(line)) depth++;
    else if (depth && /^\s*#endif/.test(line)) depth--;
    else if (!depth) assert.doesNotMatch(line, /uArc/, `arcade code outside its #ifdef: ${line.trim()}`);
  }
  assert.equal(depth, 0);
});

test('the rocket ball: only a shot with trailHeat builds anything, and never a putt', () => {
  const scene = { look: 'arcade', quality: { level: 'high' } };
  for (const opts of [{}, { trail: true, trailColor: 0xff5a2a }, { trailHeat: 0 }, { trailHeat: -1 }, { trailHeat: NaN }, { trailHeat: 1, isPutt: true }]) {
    assert.equal(shotRocket(scene, opts, 200), null, JSON.stringify(opts));
  }
  const fx = shotRocket(scene, { trailHeat: 0.6, trailColor: 0xff5a2a }, 180);
  assert.ok(fx instanceof RocketFx);
  assert.equal(fx.heat, 0.6);
  assert.equal(fx.carryM, 180);
  assert.equal(fx.capacity, ROCKET_SPARKS);
  assert.equal(fx.uniforms.uColor.value.getHex(), 0xff5a2a);
  assert.equal(fx.flame.visible, false, 'nothing drawn until the ball flies');
  assert.equal(shotRocket(scene, { trailHeat: 7 }, 100).heat, 1, 'heat is 0..1');
  // any look: the heat is the shot's, not the look's
  assert.ok(shotRocket({ look: 'real' }, { trailHeat: 1 }, 100));
  // fewer sparks on Low graphics
  const low = shotRocket({ look: 'arcade', quality: { level: 'low' } }, { trailHeat: 1 }, 100);
  assert.ok(low.capacity < ROCKET_SPARKS / 2 && low.sparkRate < 0.5);
  fx.dispose(); low.dispose();
});

test('the rocket ball: a bigger, brighter glow round the ball, put back after', () => {
  const headGlow = makeGlow({ color: 0xffe7a3, px: 13 });
  const u = headGlow.userData.uniforms;
  const real = { look: 'real', headGlow };
  // heat alone in the real look: the plain tracer, the glow dressed for the flame
  assert.equal(shotTrail(real, { trailHeat: 1 }), undefined);
  assert.ok(u.uPx.value > 13 && u.uAlpha.value > 1);
  assert.equal(shotTrail(real, {}), undefined);
  assert.equal(u.uPx.value, 13);
  assert.equal(u.uAlpha.value, 1);
  // in the arcade trail the flame is the comet: the ribbon behind it is the plain line throughout
  const hot = shotTrail({ look: 'arcade', headGlow }, { trailHeat: 1, trailColor: 0x4fd8ff });
  assert.equal(hot.arcade.thin, 1);
  assert.equal(hot.widthPx, ARCADE_LOOK.trail.widthPx * ARCADE_LOOK.trail.thin);
  assert.equal(lookTracer('arcade').arcade.thin, ARCADE_LOOK.trail.thin, 'the look itself is not written to');
});

test('the rocket flame: long off the club, shrinking down the flight; hotter is longer', () => {
  assert.equal(rocketSpeedK(0), 1);
  assert.ok(Math.abs(rocketSpeedK(1) - 0.38) < 1e-9, 'a ball lands at about 40% of its launch speed');
  assert.equal(rocketSpeedK(5), rocketSpeedK(1));
  assert.equal(rocketSpeedK(NaN), 1);
  let last = Infinity;
  for (let p = 0; p <= 1.0001; p += 0.1) {
    const f = rocketFlame(1, rocketSpeedK(p));
    assert.ok(f.lengthPx < last, `shorter at ${p.toFixed(1)}`);
    last = f.lengthPx;
  }
  assert.ok(rocketFlame(1, rocketSpeedK(1)).lengthPx > 0.4 * rocketFlame(1, 1).lengthPx, 'still a flame at landing');
  assert.ok(rocketFlame(1, 1).lengthPx > rocketFlame(0.6, 1).lengthPx);
  assert.ok(rocketFlame(1, 1).sparksPerS > rocketFlame(0.6, 1).sparksPerS);
  assert.equal(rocketFlame(0, 1).sparksPerS, 0);
  // at most ~0.4 s x the rate live at once: inside the pool
  assert.ok(rocketFlame(1, 1, ARCADE_LOOK.rocket).sparksPerS * 0.4 * 1.4 < ROCKET_SPARKS);
});

test('the rocket flame: a warm tint burns down to red, a cool one to deep blue', () => {
  const hue = (c) => { const h = { h: 0, s: 0, l: 0 }; c.getHSL(h); return h; };
  for (const warm of [0xff5a2a, 0xff8a1f, 0xffd21f]) {
    const f = flameColors(warm), d = hue(f.deep);
    assert.ok(f.warm);
    assert.ok(d.h < 0.06, `${warm.toString(16)} deepens toward red (hue ${d.h.toFixed(3)})`);
    assert.ok(d.l < hue(f.color).l, 'and darker');
  }
  const blue = flameColors(0x4fd8ff), d = hue(blue.deep);
  assert.ok(!blue.warm);
  assert.ok(d.h > 0.55 && d.h < 0.68, `the blue rocket deepens to blue (hue ${d.h.toFixed(3)})`);
  assert.ok(hue(blue.core).l > 0.9, 'white-hot at the ball');
});

test('props: where a model is fetched from', () => {
  assert.equal(propUrl({ kind: 'lighthouse' }), '/arcade/props/lighthouse.glb');
  assert.equal(propUrl({ kind: 'rock-arch' }), '/arcade/props/rock-arch.glb');
  assert.equal(propUrl({ kind: 'palm', url: '/api/props/tall-palm.glb' }), '/api/props/tall-palm.glb', 'a url wins over the kind');
  for (const bad of [{ kind: '../secret' }, { kind: 'a/b' }, { kind: '' }, { url: 'https://example.com/x.glb' }, { url: '//example.com/x.glb' }, { url: 'x.glb' }, {}, null]) {
    assert.equal(propUrl(bad), null, JSON.stringify(bad));
  }
});

test('props: an entry gets its defaults, a broken one is dropped', () => {
  const p = normalizeProp({ id: 7, kind: 'palm', x: 10, y: -20 });
  assert.deepEqual(p, { id: '7', kind: 'palm', url: '/arcade/props/palm.glb', x: 10, y: -20, z: null, rotDeg: 0, heightM: PROP_KIND_HEIGHT_M.palm, scale: 1, sinkM: PROP_SINK_M, castShadow: true });
  assert.equal(normalizeProp({ kind: 'palm', x: 0, y: 0, heightM: 12 }).heightM, 12);
  assert.equal(normalizeProp({ url: '/x.glb', x: 0, y: 0 }).heightM, null, 'an unknown model keeps its own size');
  assert.equal(normalizeProp({ kind: 'palm', x: 0, y: 0, z: 31 }).sinkM, 0, 'a given height is taken as given');
  assert.deepEqual(normalizeProp({ kind: 'palm', x: 0, y: 0, scale: [1, 2, 1] }).scale, [1, 2, 1]);
  assert.equal(normalizeProp({ kind: 'palm', x: 0, y: 0, scale: -3 }).scale, 1);
  assert.equal(normalizeProp({ kind: 'palm', x: 0, y: 0, castShadow: false }).castShadow, false);
  for (const bad of [null, 'palm', { kind: 'palm' }, { kind: 'palm', x: 'a', y: 0 }, { kind: 'palm', x: 0, y: NaN }, { x: 0, y: 0 }]) {
    assert.equal(normalizeProp(bad), null, JSON.stringify(bad));
  }
});

test('props: scaled to its height and stood on its base', () => {
  // the generated models: a box centred on the origin, about 1.9 tall
  const box = { minY: -0.95, height: 1.9 };
  const lighthouse = normalizeProp({ kind: 'lighthouse', x: 0, y: 0 });
  const s = propScale(lighthouse, box.height);
  assert.ok(Math.abs(s[1] * box.height - 28) < 1e-9, '28 m tall');
  assert.deepEqual(s, [s[1], s[1], s[1]], 'uniform');
  const originZ = propOriginZ(lighthouse, 12, box.minY, s[1]);
  assert.ok(Math.abs((originZ + box.minY * s[1]) - (12 - PROP_SINK_M)) < 1e-9, 'its base 0.3 m into the ground at 12 m');
  // scale multiplies on top of the height; without a height the model keeps its units
  assert.ok(Math.abs(propScale(normalizeProp({ kind: 'palm', x: 0, y: 0, scale: 2 }), 1.9)[1] * 1.9 - 18) < 1e-9);
  assert.deepEqual(propScale(normalizeProp({ url: '/x.glb', x: 0, y: 0, scale: [1, 2, 3] }), 5), [1, 2, 3]);
});

// ---------------------------------------------------------------- themes
// The contract's lists (docs/dev/arcade-v2-contract.md, "Themes and props", and the second
// wave of prop kinds in its addenda).
const CONTRACT_THEMES = ['tropical', 'canyon', 'links', 'volcano', 'alpine', 'sakura', 'jungle', 'desert', 'neon', 'stadium'];
const CONTRACT_PROP_KINDS = [
  'lighthouse', 'palm', 'volcano', 'rock-arch', 'cactus', 'mesa', 'pine', 'snowman', 'cabin', 'ice-spire', 'lava-rock',
  'lava-fall', 'sakura-tree', 'torii', 'pagoda', 'stone-lantern', 'bridge', 'temple', 'idol', 'pyramid', 'obelisk', 'sphinx',
  'skyscraper', 'neon-sign', 'billboard', 'grandstand', 'floodlight', 'target-ring', 'balloon', 'blimp', 'windmill',
  'shipwreck', 'crystal', 'torch', 'flag-banner',
  'waterfall', 'castle', 'dragon', 'giant-tree', 'ruins', 'jumbotron', 'fireworks', 'cloud', 'airship', 'statue',
  'fountain', 'tiki', 'hut', 'boat', 'gate', 'tower', 'rock-spire', 'launch-ramp', 'crowd', 'bird-flock',
];
const CONTRACT_FLOATING = ['balloon', 'blimp', 'fireworks', 'cloud', 'airship', 'bird-flock'];
const HEX = /^#[0-9a-f]{6}$/i;
const plain = (v) => v && typeof v === 'object' && !Array.isArray(v);
// every key path of `shape` is there in `obj` (a theme may add keys, never lose one)
function sameShape(obj, shape, at = 'look') {
  for (const [k, v] of Object.entries(shape)) {
    assert.ok(k in obj, `${at}.${k} is missing`);
    if (plain(v) && plain(obj[k])) sameShape(obj[k], v, `${at}.${k}`);
  }
}
const luma = (hex) => { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };
const turfBase = () => ({ baseMap: new THREE.Texture(), mownMask: new THREE.Texture(), bunkerMask: new THREE.Texture(), bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, anisotropy: 4 });
const fakeShader = () => ({ uniforms: {}, vertexShader: '#include <common>', fragmentShader: '#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n#include <lights_fragment_end>' });

test('themes: the contract\'s ten, and its four times of day', () => {
  assert.deepEqual([...THEMES], CONTRACT_THEMES);
  assert.deepEqual([...TIMES_OF_DAY], ['day', 'golden', 'dusk', 'night']);
  assert.deepEqual(Object.keys(ARCADE_THEMES), CONTRACT_THEMES);
  assert.equal(parseTheme(' Volcano '), 'volcano');
  for (const v of [undefined, null, '', 'moon', 'arcade', 7, {}]) assert.equal(parseTheme(v), null);
  assert.equal(parseTimeOfDay('NIGHT'), 'night');
  for (const v of [undefined, null, '', 'noon', 3]) assert.equal(parseTimeOfDay(v), 'day');
});

test('themes: every theme at every time of day resolves to a complete look', () => {
  for (const theme of THEMES) {
    for (const time of TIMES_OF_DAY) {
      const L = resolveLook(theme, time), at = `${theme}/${time}`;
      sameShape(L, ARCADE_LOOK, at);
      for (const key of Object.keys(COLORS)) assert.match(L.palette[key], HEX, `${at} palette.${key}`);
      for (const key of ['collar', 'sand']) assert.match(L.turf[key], HEX, `${at} turf.${key}`);
      for (const key of ['a', 'b']) assert.match(L.turf.cliff[key], HEX, `${at} turf.cliff.${key}`);
      assert.ok(L.turf.cliff.from < L.turf.cliff.to && L.turf.cliff.strataM > 0, `${at} turf.cliff`);
      for (const key of ['deep', 'shallow', 'foam']) assert.match(L.water[key], HEX, `${at} water.${key}`);
      for (const key of ['deep', 'scatter', 'shallow']) assert.match(L.water.sea[key], HEX, `${at} water.sea.${key}`);
      assert.match(L.light.sunColor, HEX, at);
      assert.match(L.fog.color, HEX, at);
      for (const sp of ['oak', 'maple', 'birch', 'pine', 'fir']) assert.match(L.trees.leaves[sp], HEX, `${at} leaves.${sp}`);
      for (const key of ['cloth', 'hem', 'ink']) assert.match(L.flag.colors[key], HEX, `${at} flag.${key}`);
      assert.match(L.trail.color, HEX, at);
      assert.ok(L.trail.widthPx > 0 && L.trail.gain > 0, at);
      // a sky: a photo the game already has, or a painted one with its whole light
      if (L.sky.paint) {
        const l = L.sky.paint.light;
        for (const key of ['sunIntensity', 'sunAzimuthDeg', 'sunAltitudeDeg', 'environmentIntensity', 'exposure', 'fogDensity']) {
          assert.ok(Number.isFinite(l[key]), `${at} sky.paint.light.${key}`);
        }
        assert.match(l.sunColor, HEX, at);
        assert.ok(l.sunIntensity >= 1.5, `${at}: a painted sky still lights the hole`);
      } else {
        assert.ok(L.sky.preset in SKY_PRESETS, `${at} sky.preset ${L.sky.preset}`);
      }
      assert.equal(L.theme === undefined ? 'tropical' : L.theme, theme);
      assert.equal(resolveLook(theme, time), L, 'resolved once');
    }
  }
});

test('themes: no theme, an unknown theme and tropical by day are the arcade look itself', () => {
  assert.equal(resolveLook(null, 'night'), ARCADE_LOOK);
  assert.equal(resolveLook('moon', 'dusk'), ARCADE_LOOK);
  assert.equal(resolveLook(undefined), ARCADE_LOOK);
  assert.equal(resolveLook('tropical', 'day'), ARCADE_LOOK);
  assert.equal(resolveLook('tropical'), ARCADE_LOOK);
  assert.notEqual(resolveLook('tropical', 'night'), ARCADE_LOOK);
  // what a course asks for
  assert.equal(courseTheme({ name: 'Old' }, null), null);
  assert.equal(courseTheme({ arcade: { id: 'arcade-classics', formatVersion: 1 } }, null), null);
  assert.equal(courseTheme({ arcade: { theme: 'moon', timeOfDay: 'night' } }, null), null);
  assert.deepEqual(courseTheme({ arcade: { theme: 'volcano', timeOfDay: 'dusk' } }, null), { theme: 'volcano', timeOfDay: 'dusk' });
  assert.deepEqual(courseTheme({ arcade: { theme: 'alpine' } }, null), { theme: 'alpine', timeOfDay: 'day' });
  // a course without a theme is painted exactly as before themes existed
  const before = { ...COLORS, ...ARCADE_LOOK.palette };
  const course = { look: 'arcade', geo: { name: 'Arcade Classics', arcade: { formatVersion: 1 } }, _courseDry: 0.4, _fescue: 1, _pal: COLORS, _macro: null, _hdMacros: [] };
  lookCourse(course);
  assert.deepEqual(course._pal, before);
  assert.equal(course._arcadeLook ?? null, null);
  assert.equal(lookTurf(course), ARCADE_LOOK.turf);
  assert.equal(lookWater(course), ARCADE_LOOK.water);
  assert.equal(lookTrees(course), ARCADE_LOOK.trees);
  assert.deepEqual(lookTheme(course), { theme: null, timeOfDay: 'day' });
  // and none of the themes' extras are switched on in it
  assert.equal(ARCADE_LOOK.turf.glow, null);
  assert.equal(ARCADE_LOOK.water.glow, null);
  assert.equal(ARCADE_LOOK.sky.paint, null);
  assert.equal(ARCADE_LOOK.light.fill, null);
  assert.equal(ARCADE_LOOK.trees.fx, null);
  assert.equal(ARCADE_LOOK.ball.halo, null);
  assert.equal(ARCADE_LOOK.trail.outline, null);
});

test('themes: the real look ignores them: every hook still hands back its input', () => {
  const scene = { look: 'real', geo: { arcade: { theme: 'neon', timeOfDay: 'night' } }, _arcadeLook: resolveLook('neon', 'night'), _themeKey: 'neon|night' };
  for (const preset of Object.values(SKY_PRESETS)) assert.equal(lookSkyPreset(preset, scene), preset);
  assert.equal(lookSkyPaint(scene), null);
  const fog = new THREE.Color(0.31, 0.42, 0.53);
  assert.equal(lookFogColor(fog, scene), fog);
  assert.deepEqual(fog.toArray(), [0.31, 0.42, 0.53]);
  assert.equal(lookShadowRadius(3, scene), 3);
  assert.equal(lookFlagColors(scene), undefined);
  assert.equal(lookPalette(COLORS, scene), COLORS);
  for (const hook of [lookTurf, lookWater, lookTrees, lookProps]) assert.equal(hook(scene), null);
  assert.equal(lookTracer(scene), undefined);
  assert.equal(lookTheme(scene), null);
  const spots = [{ x: 1, y: 2, species: 'oak' }];
  assert.equal(lookTreeSpots(spots, scene), spots);
  const sand = new THREE.MeshStandardMaterial({ color: new THREE.Color(1.2, 1.1, 1.0) });
  assert.equal(lookSand(sand, scene), sand);
  assert.deepEqual(sand.color.toArray(), [1.2, 1.1, 1.0]);
  const course = { ...scene, _courseDry: 0.85, _fescue: 1, _pal: COLORS, _macro: null, _hdMacros: [] };
  lookCourse(course);
  assert.equal(course._pal, COLORS);
  assert.equal(course._courseDry, 0.85);
  lookBallHalo(scene, true, 0.001);
  assert.equal(scene._ballHalo, undefined, 'no halo is ever built in the real look');
  assert.equal(shotTrail({ ...scene, headGlow: makeGlow({ color: 0xffe7a3, px: 13 }) }, {}), undefined);
  // and the real turf is the program it always was: no arcade, glow or cliff code compiled in
  const real = makeTurfMaterial(turfBase()), shader = fakeShader();
  real.onBeforeCompile(shader);
  assert.equal(real.customProgramCacheKey(), 'turf-grain-v46');
  assert.doesNotMatch(shader.fragmentShader, /#define TURF_(ARCADE|GLOW|CLIFF)/);
});

test('themes: a course\'s theme reaches the hooks through the scene', () => {
  const scene = { look: 'arcade', geo: { name: 'Volcano Drop', arcade: { theme: 'volcano', timeOfDay: 'dusk' } }, _courseDry: 0, _fescue: 0, _pal: COLORS, _macro: null, _hdMacros: [] };
  lookCourse(scene);
  const L = resolveLook('volcano', 'dusk');
  assert.equal(scene._arcadeLook, L);
  assert.deepEqual(lookTheme(scene), { theme: 'volcano', timeOfDay: 'dusk' });
  assert.equal(scene._pal.rough, L.palette.rough);
  assert.equal(lookTurf(scene), L.turf);
  assert.equal(lookWater(scene).glow.mode, 'lava');
  assert.ok(lookSkyPaint(scene), 'a volcano has no blue sky: painted at every time of day');
  for (const time of TIMES_OF_DAY) assert.ok(resolveLook('volcano', time).sky.paint, time);
  const preset = lookSkyPreset(SKY_PRESETS.midday, scene);
  assert.equal(preset.painted, true);
  assert.equal(preset.hdri, null);
  assert.equal(preset.sunIntensity, L.sky.paint.light.sunIntensity);
  assert.ok(Object.isFrozen(SKY_PRESETS.midday));
  // the next course has no theme: back to the plain arcade look
  scene.geo = { name: 'Arcade Classics' };
  scene._pal = COLORS;
  lookCourse(scene);
  assert.equal(scene._arcadeLook, null);
  assert.equal(scene._pal.rough, ARCADE_LOOK.palette.rough);
  assert.equal(lookWater(scene), ARCADE_LOOK.water);
});

test('themes: ?theme=&tod= forces a theme on whatever course is loaded', () => {
  try {
    setLookThemeOverride('alpine', 'dusk');
    assert.deepEqual(courseTheme({ name: 'Anything' }), { theme: 'alpine', timeOfDay: 'dusk' });
    assert.deepEqual(courseTheme({ arcade: { theme: 'desert', timeOfDay: 'golden' } }), { theme: 'alpine', timeOfDay: 'dusk' });
    setLookThemeOverride('neon');
    assert.deepEqual(courseTheme({ arcade: { theme: 'desert', timeOfDay: 'golden' } }), { theme: 'neon', timeOfDay: 'night' });
    setLookThemeOverride(null, 'night');   // a time of day alone: the course's theme (tropical without one) at that time
    assert.deepEqual(courseTheme({ arcade: { theme: 'desert', timeOfDay: 'golden' } }), { theme: 'desert', timeOfDay: 'night' });
    assert.deepEqual(courseTheme({}), { theme: 'tropical', timeOfDay: 'night' });
    setLookThemeOverride('moon');
    assert.equal(courseTheme({ name: 'Anything' }), null, 'an unknown override is no override');
  } finally { setLookThemeOverride(null); }
  assert.equal(courseTheme({ name: 'Anything' }), null);
});

test('themes: each world is its own', () => {
  const day = (t) => resolveLook(t, 'day');
  // tropical is the look that shipped
  assert.equal(day('tropical'), ARCADE_LOOK);
  // alpine: snow off the fairway, a green fairway, still ice, conifers under snow
  const alpine = day('alpine');
  for (const key of ['base', 'rough', 'wood']) assert.ok(luma(alpine.palette[key]) > 0.6, `alpine ${key} is snow`);
  const fw = new THREE.Color(alpine.palette.fairwayA);
  assert.ok(fw.g > fw.r * 1.5 && fw.g > fw.b * 1.5, 'the fairway is green');
  assert.ok(alpine.turf.glow.baseLift > 0, 'snow is lifted to white under a low sun');
  assert.ok(alpine.water.chopMul < 0.3 && luma(alpine.water.deep) > 0.3, 'pale, near-still ice');
  assert.equal(alpine.trees.species.oak, 'fir');
  assert.ok(alpine.trees.fx.snowAmount > 0.5);
  // volcano: the water is molten and lights itself
  const volcano = day('volcano');
  assert.equal(volcano.water.glow.mode, 'lava');
  assert.ok(volcano.water.glow.strength > 0.5 && volcano.water.reflect < 0.2);
  assert.ok(luma(volcano.palette.rough) < 0.08, 'basalt');
  // neon: only ever a night, near-black water with colour in it, glowing edges
  assert.equal(themeTimeOfDay('neon', 'day'), 'night');
  assert.equal(day('neon'), resolveLook('neon', 'night'));
  const neon = day('neon');
  assert.ok(luma(neon.water.deep) < 0.01);
  assert.equal(neon.water.glow.mode, 'neon');
  assert.ok(neon.turf.glow.edgeGain > 1 && neon.turf.glow.greenEdgeGain > 1);
  // sakura: a green pond, blossom painted over the broadleaves
  const sakura = day('sakura');
  const pond = new THREE.Color(sakura.water.deep);
  assert.ok(pond.g > pond.r && pond.g > pond.b, 'a green garden pond');
  for (const sp of ['oak', 'maple', 'birch']) { const c = new THREE.Color(sakura.trees.fx.paint[sp]); assert.ok(c.r > c.g, `${sp} blossom is pink`); }
  // desert and canyon: the ground is not grass
  for (const t of ['desert', 'canyon']) { const c = new THREE.Color(day(t).palette.rough); assert.ok(c.r > c.g && c.g > c.b, `${t} ground is sand or rock`); }
  // jungle: denser haze than the plain look, broadleaf only
  assert.ok(day('jungle').fog.densityMul > ARCADE_LOOK.fog.densityMul);
  assert.equal(day('jungle').trees.species.fir, 'oak');
  // every pair of themes differs where it shows most
  const seen = new Set();
  for (const t of THEMES) { const L = day(t); const sig = `${L.palette.rough}${L.palette.fairwayA}${L.water.deep}${L.turf.cliff.a}`; assert.ok(!seen.has(sig), `${t} repeats another theme`); seen.add(sig); }
});

test('themes: night and dusk stay playable', () => {
  for (const theme of THEMES) {
    for (const time of ['dusk', 'night']) {
      const L = resolveLook(theme, time), at = `${theme}/${time}`;
      assert.ok(L.sky.paint, `${at} has a painted sky`);
      assert.ok(L.light.fill && L.light.fill.intensity > 0.3, `${at} has a fill light`);
      assert.ok(L.turf.glow && L.turf.glow.lift > 0.1, `${at}: the fairway and green give back light of their own`);
      assert.ok(L.flag.glow > 0, `${at}: the flag is self-lit`);
      assert.ok(L.sky.paint.light.sunAltitudeDeg >= 15, `${at}: the key light is high enough to light level ground`);
      assert.ok(L.props.self > 0, `${at}: scenery is not left black`);
    }
    const night = resolveLook(theme, 'night');
    assert.ok(night.turf.glow.edge && night.turf.glow.greenEdge, `${theme}: glowing fairway and green edges at night`);
    assert.ok(night.sky.paint.light.sunAltitudeDeg >= 50, `${theme}: floodlit from above`);
    assert.ok(luma(night.palette.fairwayA) > 0.25 && luma(night.palette.greenA) > 0.4, `${theme}: a bright fairway and green`);
  }
});

test('themes: the trail and the ball stay visible, on snow most of all', () => {
  for (const theme of THEMES) {
    for (const time of TIMES_OF_DAY) {
      const L = resolveLook(theme, time);
      // the trail is not the colour of the ground it flies over
      const trail = new THREE.Color(L.trail.color), ground = new THREE.Color(L.palette.rough);
      const d = Math.hypot(trail.r - ground.r, trail.g - ground.g, trail.b - ground.b);
      assert.ok(d > 0.35, `${theme}/${time}: trail ${L.trail.color} against ${L.palette.rough} (${d.toFixed(2)})`);
      // bright ground needs a dark halo behind a white ball, and a dark rim on the trail
      if (luma(L.palette.rough) > 0.5) {
        assert.ok(L.ball.halo && luma(L.ball.halo.color) < 0.05, `${theme}/${time}: a dark ball halo`);
        assert.ok(L.trail.outline && luma(L.trail.outline.color) < 0.05, `${theme}/${time}: a dark trail rim`);
      }
    }
  }
  // the halo is a second glow behind the ball, made on first use and hidden off the snow
  const ball = { position: new THREE.Vector3(1, 2, 3) };
  const added = [];
  const scene = { look: 'arcade', _arcadeLook: resolveLook('alpine', 'day'), ball, scene: { add: (m) => added.push(m) } };
  lookBallHalo(scene, false, 0.001);
  assert.equal(scene._ballHalo, undefined, 'nothing until the ball flies');
  lookBallHalo(scene, true, 0.001);
  assert.equal(added.length, 1);
  assert.equal(scene._ballHalo.visible, true);
  assert.deepEqual(scene._ballHalo.position.toArray(), [1, 2, 3]);
  assert.ok(scene._ballHalo.userData.uniforms.uPx.value > resolveLook('alpine', 'day').trail.headGlowPx, 'wider than the bright glow it sits behind');
  lookBallHalo(scene, false, 0.001);
  assert.equal(scene._ballHalo.visible, false);
  scene._arcadeLook = null;   // a course with no theme
  lookBallHalo(scene, true, 0.001);
  assert.equal(scene._ballHalo.visible, false);
  // the trail's dark rim is compiled only for a theme that asks for it
  const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, -1)];
  const snow = new ShotTracer(pts, [0, 1], lookTracer({ look: 'arcade', _arcadeLook: resolveLook('alpine', 'day') }));
  assert.deepEqual(snow.mesh.material.defines, { TRACER_ARCADE: '', TRACER_OUTLINE: '' });
  assert.ok(snow.uniforms.uOutline.value.w > 0);
  const plainTrail = new ShotTracer(pts, [0, 1], lookTracer('arcade'));
  assert.deepEqual(plainTrail.mesh.material.defines, { TRACER_ARCADE: '' });
  assert.equal(plainTrail.uniforms.uOutline, undefined);
  // a tinted shot on a theme keeps the theme's rim
  const tinted = shotTrail({ look: 'arcade', _arcadeLook: resolveLook('alpine', 'day') }, { trailColor: 0x4fd8ff });
  assert.ok(tinted.arcade.outline);
});

test('themes: the turf\'s night glow is compiled only for a theme that has one; steep ground is rock', () => {
  const plainMat = makeTurfMaterial({ ...turfBase(), arcade: resolveLook('tropical', 'day').turf }), plainShader = fakeShader();
  plainMat.onBeforeCompile(plainShader);
  assert.equal(plainMat.customProgramCacheKey(), 'turf-grain-v46-arcade-cliff');
  assert.doesNotMatch(plainShader.fragmentShader, /#define TURF_GLOW/);
  assert.match(plainShader.fragmentShader, /#define TURF_CLIFF/);
  assert.ok(!('uArcLift' in plainShader.uniforms));
  assert.ok(plainShader.uniforms.uArcCliff.value.x < plainShader.uniforms.uArcCliff.value.y, 'rock below one slope, turf above another');
  const night = makeTurfMaterial({ ...turfBase(), arcade: resolveLook('neon', 'night').turf }), nightShader = fakeShader();
  night.onBeforeCompile(nightShader);
  assert.equal(night.customProgramCacheKey(), 'turf-grain-v46-arcade-glow-cliff');
  assert.match(nightShader.fragmentShader, /#define TURF_GLOW/);
  assert.ok(nightShader.uniforms.uArcLift.value.x > 0.2);
  assert.ok(nightShader.uniforms.uArcEdge.value.w > 1 && nightShader.uniforms.uArcGreenEdge.value.w > 1);
  const snow = makeTurfMaterial({ ...turfBase(), arcade: resolveLook('alpine', 'day').turf }), snowShader = fakeShader();
  snow.onBeforeCompile(snowShader);
  assert.ok(snowShader.uniforms.uArcLift.value.y > 0.2 && snowShader.uniforms.uArcLift.value.x === 0, 'snow is lifted, the fairway is not');
  assert.equal(snowShader.uniforms.uArcEdge.value.w, 0);
  // a look with no cliff rock and no glow compiles the arcade turf as it first shipped
  const old = makeTurfMaterial({ ...turfBase(), arcade: { ...ARCADE_LOOK.turf, cliff: null } });
  assert.equal(old.customProgramCacheKey(), 'turf-grain-v46-arcade');
});

test('themes: course.trees keep their place and number, and take the theme\'s species', () => {
  const spots = [{ x: 0, y: 0, s: 1, species: 'oak' }, { x: 5, y: 9, s: 1.2, species: 'pine', h: 12, r: 3 }, { x: 8, y: 1, s: 0.9 }];
  assert.equal(lookTreeSpots(spots, 'arcade'), spots, 'the plain look leaves them alone');
  const alpine = lookTreeSpots(spots, { look: 'arcade', _arcadeLook: resolveLook('alpine', 'day') });
  assert.deepEqual(alpine.map((s) => s.species), ['fir', 'pine', 'fir']);
  assert.deepEqual(alpine.map((s) => [s.x, s.y]), spots.map((s) => [s.x, s.y]));
  const jungle = lookTreeSpots(spots, { look: 'arcade', _arcadeLook: resolveLook('jungle', 'day') });
  assert.deepEqual(jungle.map((s) => s.species), ['oak', 'maple', 'oak']);
  assert.ok(jungle[1].h > 12 && jungle[1].r > 3 && jungle[0].s > 1, 'a jungle canopy is bigger');
  assert.deepEqual(spots[1], { x: 5, y: 9, s: 1.2, species: 'pine', h: 12, r: 3 }, 'the course\'s own list is not written to');
  for (const t of THEMES) {
    const k = resolveLook(t, 'day').trees.scale;
    assert.ok(k >= 0.8 && k <= 1.25, `${t}: drawn near the size the ball hits (${k})`);
  }
});

test('painted skies: finite, the right way up, a night darker than a dusk', () => {
  const w = 64, h = 32;
  const px = (img, i, j) => { const o = (j * img.width + Math.floor(i)) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]]; };
  for (const theme of THEMES) {
    for (const time of TIMES_OF_DAY) {
      const spec = resolveLook(theme, time).sky.paint;
      if (!spec) continue;
      const img = paintSky(spec, w, h);
      assert.equal(img.data.length, w * h * 4);
      assert.ok(img.data.every((v) => Number.isFinite(v) && v >= 0), `${theme}/${time}: every texel is a radiance`);
      assert.equal(px(img, 3, 3)[3], 1);
    }
  }
  const sum = (c) => c[0] + c[1] + c[2];
  const night = paintSky({ ...resolveLook('links', 'night').sky.paint, stars: 0, disc: null }, w, h);
  const dusk = paintSky({ ...resolveLook('links', 'dusk').sky.paint, stars: 0, disc: null, clouds: null }, w, h);
  assert.ok(sum(px(night, 10, h - 1)) < sum(px(dusk, 10, h - 1)), 'the zenith is the last row');
  assert.ok(sum(px(night, 10, h - 1)) < sum(px(night, 10, h / 2 + 1)), 'darker overhead than at the horizon');
  assert.ok(sum(px(night, 10, h / 2 + 1)) < 0.5, 'a night horizon is dark');
  // a glow on a bearing lights that side of the horizon: north is three's -z, where u = 0.25
  const glow = paintSky({ zenith: '#000000', horizon: '#000000', glows: [{ color: '#ffffff', azDeg: 0, widthDeg: 60, heightDeg: 10, strength: 1 }] }, w, h);
  const row = h / 2;
  assert.ok(sum(px(glow, w * 0.25, row)) > 5 * sum(px(glow, w * 0.75, row)));
  const n = skyDirection(0, 0), e = skyDirection(90, 0), up = skyDirection(0, 90);
  assert.ok(Math.abs(n.z + 1) < 1e-9 && Math.abs(e.x - 1) < 1e-9 && Math.abs(up.y - 1) < 1e-9, 'north is -z, east +x, up +y');
  assert.deepEqual(skyColor('#ffffff', 2), [2, 2, 2]);
  assert.deepEqual(skyColor('#000000'), [0, 0, 0]);
});

// ---------------------------------------------------------------- procedural props
test('props: every contract prop kind has a model', () => {
  assert.deepEqual([...PROP_GLB_KINDS, ...PROP_PROCEDURAL_KINDS].sort(), [...CONTRACT_PROP_KINDS].sort());
  assert.deepEqual([...PROCEDURAL_PROP_KINDS].sort(), [...PROP_PROCEDURAL_KINDS].sort(), 'props.js lists exactly the kinds prop-models.js builds');
  for (const kind of CONTRACT_PROP_KINDS) assert.ok(PROP_KIND_HEIGHT_M[kind] > 0, `${kind} has a default height`);
  for (const kind of PROP_GLB_KINDS) {
    assert.equal(propUrl({ kind }), `/arcade/props/${kind}.glb`);
    assert.ok(existsSync(fileURLToPath(new URL(`../public/arcade/props/${kind}.glb`, import.meta.url))), `${kind}.glb is shipped`);
  }
  for (const kind of PROP_PROCEDURAL_KINDS) assert.equal(propUrl({ kind }), `${PROP_PROC_SCHEME}${kind}`);
  assert.equal(propUrl({ kind: 'spaceship' }), '/arcade/props/spaceship.glb', 'an unknown kind is looked for as a GLB (and skipped if it is not there)');
  assert.equal(buildPropModel('spaceship'), null);
  assert.deepEqual(Object.keys(PROP_FLOAT_M).sort(), [...CONTRACT_FLOATING].sort(), 'what floats');
  assert.ok(PROP_FLOAT_M.fireworks >= 60 && PROP_FLOAT_M.cloud >= 150 && PROP_FLOAT_M['bird-flock'] === 40);
  // the hole builder's own lists, when this Node can load them
  try {
    const lib = createRequire(import.meta.url)('../tools/arcade-holes/lib.js');
    if (Array.isArray(lib.PROP_KINDS)) for (const kind of lib.PROP_KINDS) assert.ok(CONTRACT_PROP_KINDS.includes(kind), `tools/arcade-holes knows '${kind}', the look does not`);
    if (Array.isArray(lib.FLOATING_PROP_KINDS)) for (const kind of lib.FLOATING_PROP_KINDS) assert.ok(kind in PROP_FLOAT_M, `'${kind}' should float`);
  } catch (e) { if (e instanceof assert.AssertionError) throw e; /* the hole tools are another stream's: not this test's to fail on */ }
});

test('props: every procedural model is sound geometry at the size asked for', () => {
  for (const kind of PROP_PROCEDURAL_KINDS) {
    const model = buildPropModel(kind);
    const g = model.geometry, b = g.boundingBox;
    const pos = g.attributes.position;
    assert.ok(pos.count >= 3 && pos.count % 3 === 0, `${kind}: whole triangles`);
    assert.ok(pos.count / 3 <= 5000, `${kind}: ${pos.count / 3} triangles is too many for scenery`);
    assert.ok(Array.prototype.every.call(pos.array, Number.isFinite), `${kind}: every vertex is finite`);
    for (const [name, size] of [['color', 3], ['aFx', 4], ['aSpin', 4], ['aAnim', 4], ['aPivot', 3]]) {
      assert.equal(g.attributes[name]?.itemSize, size, `${kind}: ${name}`);
      assert.equal(g.attributes[name].count, pos.count, `${kind}: ${name} per vertex`);
      assert.ok(Array.prototype.every.call(g.attributes[name].array, Number.isFinite), `${kind}: ${name} is finite`);
    }
    assert.ok(Array.prototype.every.call(g.attributes.color.array, (v) => v >= 0 && v <= 1), `${kind}: colours in range`);
    assert.equal(g.index, null, `${kind}: flat shaded, not indexed`);
    for (const v of [...b.min.toArray(), ...b.max.toArray()]) assert.ok(Number.isFinite(v), `${kind}: a finite box`);
    assert.ok(model.measure > 0, `${kind}: something to scale by`);
    assert.ok(model.baseY >= b.min.y - 1e-6 && model.baseY < b.max.y + 1e-6, `${kind}: stands on a height inside its box`);
    // scaled the way props.js does it, the model comes out at the size asked for
    const want = PROP_KIND_HEIGHT_M[kind] * 1.5;
    const s = propScale(normalizeProp({ kind, x: 0, y: 0, heightM: want }), model.measure);
    const size = b.getSize(new THREE.Vector3());
    if (kind === 'target-ring') {
      assert.ok(Math.abs(size.x * s[0] - want) < 1e-6 && Math.abs(size.z * s[2] - want) < 1e-6, 'a ring is its diameter across');
      assert.ok(size.y < 1e-6, 'and flat');
    } else if (kind === 'bridge') {
      const bs = bridgeScale(want, model.measure);
      assert.ok(Math.abs(model.measure * bs[2] - want) < 1e-6, 'a bridge is its length along its span');
      assert.ok(size.z >= size.x * 4, 'and spans along z');
      assert.ok(bs[0] < bs[2], 'a longer bridge is not as much wider');
    } else {
      const above = (b.max.y - model.baseY) * s[1];
      assert.ok(Math.abs(above - want) < Math.max(0.05, want * 0.02), `${kind}: ${above.toFixed(2)} m above the ground for ${want} m asked`);
      // a sane silhouette: not a sliver, not a slab
      const wide = Math.max(size.x, size.z), tall = b.max.y - model.baseY;
      assert.ok(wide / tall > 0.1 && wide / tall < 6.5, `${kind}: ${wide.toFixed(1)} wide by ${tall.toFixed(1)} tall`);
      assert.ok(model.baseY - b.min.y <= tall * 1.6, `${kind}: its foundation is no deeper than it needs`);
    }
    g.dispose();
  }
  // a crowd is about four times as wide as it is tall
  const crowd = buildPropModel('crowd'), cs = crowd.geometry.boundingBox.getSize(new THREE.Vector3());
  assert.ok(cs.x / crowd.measure > 3.2 && cs.x / crowd.measure < 4.8, `a crowd is ${(cs.x / crowd.measure).toFixed(2)} times as wide as it is tall`);
  // the same model every time (courses must look the same on every load)
  const a = buildPropModel('lava-rock'), c = buildPropModel('lava-rock');
  assert.deepEqual(Array.from(a.geometry.attributes.position.array.slice(0, 60)), Array.from(c.geometry.attributes.position.array.slice(0, 60)));
});

test('props: glow, motion and tints are where the worlds need them', () => {
  const max = (kind, i, attr = 'aFx') => { const a = buildPropModel(kind).geometry.attributes[attr]; let m = 0; for (let k = i; k < a.array.length; k += 4) m = Math.max(m, Math.abs(a.array[k])); return m; };
  const has = (kind, attr, i, value) => { const a = buildPropModel(kind).geometry.attributes[attr]; for (let k = i; k < a.array.length; k += 4) if (a.array[k] === value) return true; return false; };
  for (const kind of ['lava-rock', 'lava-fall', 'torch', 'neon-sign', 'skyscraper', 'floodlight', 'crystal', 'stone-lantern', 'cabin', 'idol', 'grandstand', 'jumbotron', 'castle', 'dragon', 'tower', 'gate', 'fireworks']) {
    assert.ok(max(kind, 0) > 0.3, `${kind} has a glowing part`);
  }
  for (const kind of ['cactus', 'mesa', 'snowman', 'torii', 'sphinx', 'ruins', 'rock-spire']) assert.equal(max(kind, 0), 0, `${kind} does not glow`);
  for (const kind of ['balloon', 'blimp', 'cloud', 'airship', 'boat']) assert.ok(max(kind, 3) > 0, `${kind} bobs`);
  for (const kind of ['flag-banner', 'torch', 'sakura-tree', 'shipwreck', 'giant-tree', 'castle', 'boat', 'dragon']) assert.ok(max(kind, 2) > 0, `${kind} sways`);
  for (const kind of ['windmill', 'airship']) assert.ok(max(kind, 2, 'aSpin') > 0, `${kind} has a part that turns`);
  // the flow of a waterfall's sheet and a screen's face (glow mode 4)
  for (const kind of ['waterfall', 'jumbotron', 'fountain', 'launch-ramp']) assert.ok(has(kind, 'aFx', 1, 4), `${kind} has a flowing part`);
  // what circles, bursts and bounces (aAnim.x: 1, 2, 3)
  for (const kind of ['bird-flock', 'cloud', 'airship']) assert.ok(has(kind, 'aAnim', 0, 1), `${kind} circles`);
  assert.ok(has('fireworks', 'aAnim', 0, 2), 'fireworks burst');
  assert.ok(has('crowd', 'aAnim', 0, 3), 'a crowd bounces');
  assert.ok(max('bird-flock', 3, 'aAnim') > 0, 'wings beat');
  for (const kind of ['fireworks', 'cloud', 'airship', 'bird-flock']) assert.equal(buildPropModel(kind).roam, true, `${kind} is never frustum-culled`);
  assert.equal(buildPropModel('pyramid').roam, false);
  for (const kind of ['balloon', 'blimp', 'crystal', 'flag-banner', 'airship', 'fireworks', 'hut', 'boat']) {
    const m = buildPropModel(kind);
    assert.ok(m.tints.length >= 4, `${kind}: copies in different colours`);
    assert.ok(max(kind, 3, 'aSpin') === 1, `${kind}: has parts that take the copy's colour`);
  }
  // small things stay out of the shadow map; so does what floats
  for (const kind of ['torch', 'stone-lantern', 'snowman', 'crystal', 'lava-rock', 'flag-banner', 'neon-sign', 'floodlight', 'balloon', 'blimp', 'target-ring', 'crowd', 'fireworks', 'cloud', 'bird-flock', 'tiki']) assert.equal(buildPropModel(kind).shadow, false, kind);
  for (const kind of ['pyramid', 'skyscraper', 'grandstand', 'temple', 'mesa', 'pagoda', 'castle', 'giant-tree', 'waterfall']) assert.equal(buildPropModel(kind).shadow, true, kind);
  // one material for them all, its shader extended, not replaced, and driven by one clock
  const { material, uniforms } = makePropMaterial();
  assert.ok(material.vertexColors && material.flatShading);
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <color_vertex>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <emissivemap_fragment>' };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uPropTime, uniforms.uPropTime);
  for (const attr of ['attribute vec4 aFx', 'attribute vec4 aSpin', 'attribute vec4 aAnim', 'attribute vec3 aPivot', 'attribute vec4 aInst']) assert.ok(shader.vertexShader.includes(attr), attr);
  assert.match(shader.vertexShader, /smoothstep\(aInst\.w \* 0\.85, aInst\.w, camD\)/, 'a copy shrinks away at its cull distance');
  assert.match(shader.fragmentShader, /totalEmissiveRadiance \+=/);
  const decal = makePropMaterial({ decal: true }).material;
  assert.ok(decal.polygonOffset && decal.depthWrite === false && decal.transparent, 'a ring is painted over the turf');
  assert.notEqual(decal.customProgramCacheKey(), material.customProgramCacheKey());
  // what is culled by distance, and what never is
  assert.ok(propCullM(3) >= 300 && propCullM(3) < 500, 'a torch is gone by a few hundred metres');
  assert.ok(propCullM(8) > propCullM(3));
  assert.ok(propCullM(30) > 1e5, 'a tower is never culled');
});

test('props: a target ring is a band of its diameter, draped on the ground', () => {
  const flat = targetRingGeometry(36);
  flat.computeBoundingBox();
  assert.ok(Math.abs(flat.boundingBox.max.x - 18) < 1e-6 && Math.abs(flat.boundingBox.min.z + 18) < 1e-6);
  // the band leaves the middle open: no vertex inside its inner edge
  const p = flat.attributes.position;
  let inner = Infinity;
  for (let i = 0; i < p.count; i++) inner = Math.min(inner, Math.hypot(p.getX(i), p.getZ(i)));
  assert.ok(inner > 14 && inner < 17.6, `a 36 m ring's band is ${(18 - inner).toFixed(2)} m wide`);
  const small = targetRingGeometry(4);
  let hole = Infinity;
  for (let i = 0; i < small.attributes.position.count; i++) hole = Math.min(hole, Math.hypot(small.attributes.position.getX(i), small.attributes.position.getZ(i)));
  assert.ok(hole >= 1.2, 'the smallest ring does not cover the hole');
  // draped: every vertex takes the ground's height under it
  const draped = buildTargetRing(20, TARGET_RING_COLORS[0], (x, z) => 5 + 0.03 * x - 0.01 * z);
  const dp = draped.attributes.position;
  for (let i = 0; i < dp.count; i += 7) assert.ok(Math.abs(dp.getY(i) - (5 + 0.03 * dp.getX(i) - 0.01 * dp.getZ(i))) < 1e-5);
  assert.ok(draped.attributes.aFx.array[0] > 0, 'it gives back some light of its own (a night stage)');
  assert.ok(TARGET_RING_COLORS.length >= 4 && TARGET_RING_COLORS.every((c) => HEX.test(c)));
});

const V3 = (x, y, z) => new THREE.Vector3(x, z, -y);   // sim -> three, as the scene's V
const meshesOf = (layer, kind) => layer.group.children.filter((m) => m.name === `prop:proc:${kind}` || m.name === `prop:${kind}`);
const worldBox = (m) => { m.computeBoundingBox?.(); return m.boundingBox || new THREE.Box3().setFromObject(m); };

test('props: the layer stands procedural kinds where they belong', async () => {
  const added = new THREE.Scene();
  const water = (x) => (x > 100 ? 2 : null);   // a lake east of x = 100, its surface at 2 m over a bed at 0
  const layer = new PropsLayer({ scene: added, hAt: (x) => (x > 100 ? 0 : 5), groundAt: (x) => 5 + 0.02 * x, waterAt: water, V: V3 });
  const res = await layer.add([
    { id: 'c1', kind: 'cactus', x: 0, y: 0, heightM: 6 },
    { id: 'c2', kind: 'cactus', x: 10, y: 0, heightM: 12 },
    { id: 'b', kind: 'balloon', x: 0, y: 50 },
    { id: 'fw', kind: 'fireworks', x: 0, y: 60 },
    { id: 'r', kind: 'lava-rock', x: 150, y: 0, heightM: 5 },
    { id: 'br', kind: 'bridge', x: 0, y: 100, heightM: 40, rotDeg: 90 },
    { id: 't1', kind: 'target-ring', x: 0, y: 200, heightM: 30 },
    { id: 't2', kind: 'target-ring', x: 0, y: 200, heightM: 10 },
    { id: 'f1', kind: 'flag-banner', x: 5, y: 5 }, { id: 'f2', kind: 'flag-banner', x: 9, y: 5 },
    { id: 'p', kind: 'pyramid', x: -300, y: 0 },
  ]);
  assert.equal(res.placed, 11);
  assert.deepEqual(res.skipped, []);
  // two cacti: one instanced draw, the second twice the height, both sunk 0.3 m into 5 m ground
  const cacti = meshesOf(layer, 'cactus');
  assert.equal(cacti.length, 1);
  assert.ok(cacti[0].isInstancedMesh && cacti[0].count === 2);
  const m0 = new THREE.Matrix4(), m1 = new THREE.Matrix4();
  cacti[0].getMatrixAt(0, m0); cacti[0].getMatrixAt(1, m1);
  const s0 = new THREE.Vector3().setFromMatrixScale(m0), s1 = new THREE.Vector3().setFromMatrixScale(m1);
  assert.ok(Math.abs(s1.y / s0.y - 2) < 1e-6);
  assert.ok(Math.abs(new THREE.Vector3().setFromMatrixPosition(m0).y - (5 - PROP_SINK_M)) < 1e-6);
  assert.equal(cacti[0].castShadow, true);
  // a balloon hangs 60 m up and casts nothing; fireworks too, and are never frustum-culled
  const balloon = meshesOf(layer, 'balloon')[0];
  balloon.getMatrixAt(0, m0);
  assert.ok(Math.abs(new THREE.Vector3().setFromMatrixPosition(m0).y - (5 + PROP_FLOAT_M.balloon)) < 1e-6);
  assert.equal(balloon.castShadow, false);
  const fw = meshesOf(layer, 'fireworks')[0];
  assert.ok(worldBox(fw).min.y >= 5 + PROP_FLOAT_M.fireworks - 1.5, 'bursting from 60 m up');
  assert.equal(fw.frustumCulled, false);
  assert.equal(cacti[0].frustumCulled, true);
  // a rock in the lake sits at the water, not on the bed
  const rb = worldBox(meshesOf(layer, 'lava-rock')[0]);
  assert.ok(Math.abs(rb.min.y - (2 - PROP_SINK_M)) < 0.01, `the rock's foot is at ${rb.min.y.toFixed(2)} m`);
  // a bridge heading east is 40 m long east to west
  const bb = worldBox(meshesOf(layer, 'bridge')[0]);
  assert.ok(bb.max.x - bb.min.x > 40 && bb.max.x - bb.min.x < 44, `the bridge spans ${(bb.max.x - bb.min.x).toFixed(1)} m east-west`);
  assert.ok(bb.max.z - bb.min.z < 8);
  // two rings round one point: one draped mesh each, the inner one gold, both on the drawn ground
  const rings = meshesOf(layer, 'target-ring');
  assert.equal(rings.length, 2);
  assert.ok(rings.every((m) => !m.isInstancedMesh && m.material.polygonOffset));
  const byWidth = rings.map((m) => { m.geometry.computeBoundingBox(); return m; }).sort((a, c) => a.geometry.boundingBox.max.x - c.geometry.boundingBox.max.x);
  const gold = new THREE.Color(TARGET_RING_COLORS[0]), second = new THREE.Color(TARGET_RING_COLORS[1]);
  assert.ok(Math.abs(byWidth[0].geometry.attributes.color.array[1] - gold.g) < 1e-6);
  assert.ok(Math.abs(byWidth[1].geometry.attributes.color.array[1] - second.g) < 1e-6);
  const ry = byWidth[1].geometry.boundingBox;
  assert.ok(ry.min.y > 5 + 0.02 * -15 && ry.max.y < 5 + 0.02 * 15 + 0.2, 'draped on the sloping ground');
  // banners: every copy its own colour, and a distance it is gone by; a pyramid is never culled
  const flags = meshesOf(layer, 'flag-banner')[0];
  const inst = flags.geometry.attributes.aInst;
  assert.equal(inst.count, 2);
  assert.notDeepEqual(Array.from(inst.array.slice(0, 3)), Array.from(inst.array.slice(4, 7)));
  assert.ok(Math.abs(inst.array[3] - propCullM(PROP_KIND_HEIGHT_M['flag-banner'])) < 1, 'culled by distance');
  assert.ok(meshesOf(layer, 'pyramid')[0].geometry.attributes.aInst.array[3] > 1e5);
  assert.ok(balloon.geometry.attributes.aInst.array[3] > 1e5, 'what floats is a landmark: never culled');
  // every procedural kind shares one material, and the frame hook moves its one clock
  assert.equal(new Set([cacti[0], balloon, fw, flags].map((m) => m.material)).size, 1);
  assert.equal(cacti[0].material.userData.procedural, true);
  layer.update(12.5);
  assert.equal(layer._proc.uniforms.uPropTime.value, 12.5);
  // a stage of hundreds of props is still one draw per kind
  const many = [];
  for (let i = 0; i < 120; i++) many.push({ kind: 'crowd', x: i * 20, y: 400 }, { kind: 'torch', x: i * 3, y: 420 });
  await layer.add(many);
  assert.equal(meshesOf(layer, 'crowd').length, 1);
  assert.equal(meshesOf(layer, 'crowd')[0].count, 120);
  assert.equal(meshesOf(layer, 'torch')[0].count, 120);
  // taking one away, then all
  assert.equal(layer.remove('c2'), true);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(meshesOf(layer, 'cactus')[0].count, 1);
  layer.clear();
  assert.equal(layer.group, null);
  layer.dispose();
});

test('props: a GLB in the manifest is preferred, and its procedural model is the fallback', async () => {
  const realFetch = globalThis.fetch;
  const asked = [];
  // a manifest listing a GLB for the pagoda and one for the torch; neither file is really there
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    if (String(url).endsWith('/manifest.json')) {
      return { ok: true, status: 200, json: async () => ({ kinds: { pagoda: { file: 'pagoda.glb', tris: 9000, heightM: 24 }, torch: { file: '../../secret.glb' }, 'target-ring': { file: 'target-ring.glb' } } }) };
    }
    return { ok: false, status: 404 };
  };
  try {
    const layer = new PropsLayer({ scene: new THREE.Scene(), hAt: () => 0, V: V3 });
    const res = await layer.add([
      { kind: 'pagoda', x: 0, y: 0 }, { kind: 'pagoda', x: 30, y: 0 },
      { kind: 'torch', x: 5, y: 5 }, { kind: 'target-ring', x: 0, y: 50, heightM: 10 }, { kind: 'cactus', x: 9, y: 9 },
    ]);
    assert.equal(asked.filter((u) => u.endsWith('/manifest.json')).length, 1, 'the manifest is fetched once');
    assert.ok(asked.includes('/arcade/props/pagoda.glb'), 'the manifest\'s GLB is tried first');
    assert.ok(!asked.some((u) => u.includes('secret')), 'a manifest cannot point outside the props folder');
    assert.ok(!asked.some((u) => u.includes('target-ring.glb')), 'a ring is never a model');
    assert.ok(!asked.some((u) => u.includes('cactus')), 'a kind not in the manifest is simply built');
    assert.equal(res.placed, 5, 'the missing GLB fell back to the procedural pagoda');
    assert.equal(meshesOf(layer, 'pagoda').length, 1);
    assert.equal(meshesOf(layer, 'pagoda')[0].count, 2);
    assert.equal(meshesOf(layer, 'torch')[0].count, 1);
    await layer.add({ kind: 'pagoda', x: 60, y: 0 });
    assert.equal(asked.filter((u) => u.endsWith('/manifest.json')).length, 1);
    layer.dispose();
  } finally { globalThis.fetch = realFetch; }
});

test('props: a kind with variants in the manifest gives each prop its own, the same one every time', async () => {
  const { propVariantIndex } = await import('../public/render/props.js');
  // stable, in range, and spread: a skyline of 30 towers uses all three models
  const row = Array.from({ length: 30 }, (_, i) => ({ id: `tower-${i}`, x: i * 40, y: 600 }));
  const picks = row.map((p) => propVariantIndex(p, 3));
  assert.deepEqual(picks, row.map((p) => propVariantIndex({ ...p }, 3)), 'the same prop, the same variant');
  assert.ok(picks.every((i) => i === 0 || i === 1 || i === 2));
  assert.deepEqual([...new Set(picks)].sort(), [0, 1, 2]);
  assert.notEqual(new Set(Array.from({ length: 30 }, (_, i) => propVariantIndex({ x: i * 40, y: 600 }, 3))).size, 1, 'without an id its place decides');
  assert.equal(propVariantIndex({ id: 'a' }, 1), 0);
  assert.equal(propVariantIndex({ id: 'a' }, 0), 0);

  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    if (String(url).endsWith('/manifest.json')) {
      return { ok: true, status: 200, json: async () => ({ kinds: { skyscraper: { file: 'skyscraper.glb', variants: ['skyscraper.glb', 'skyscraper-2.glb', '../evil.glb', 'skyscraper-3.glb'] } } }) };
    }
    return { ok: false, status: 404 };
  };
  try {
    const layer = new PropsLayer({ scene: new THREE.Scene(), hAt: () => 0, V: V3 });
    const res = await layer.add(row.map((p) => ({ ...p, kind: 'skyscraper' })));
    const glbs = new Set(asked.filter((u) => u.endsWith('.glb')));
    assert.deepEqual([...glbs].sort(), ['/arcade/props/skyscraper-2.glb', '/arcade/props/skyscraper-3.glb', '/arcade/props/skyscraper.glb'], 'all three files are asked for, and only safe names');
    assert.equal(res.placed, 30, 'every tower stands (here: on the procedural fallback, the files being absent)');
    layer.dispose();
  } finally { globalThis.fetch = realFetch; }
});

test('a Skipper ball\'s skip throws a splash and the ball flies on', async () => {
  const { impactSchedule } = await import('../public/render/impact-fx.js');
  const points = [];
  for (let i = 0; i <= 60; i++) points.push({ t: i * 0.1, x: 0, y: i * 3, z: Math.max(0, 12 * Math.sin((i / 20) * Math.PI) * (i <= 20 ? 1 : i <= 40 ? 0.5 : 0.25)) });
  const events = [{ type: 'skip', x: 0, y: 60 }, { type: 'skip', x: 0, y: 120 }, { type: 'water', x: 0, y: 180 }];
  const out = impactSchedule(points, events, 2.0);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((i) => i.kind), ['water', 'water', 'water']);
  assert.deepEqual(out.map((i) => !!i.skip), [true, true, false], 'only the last one sinks');
  assert.ok(out[0].t < out[1].t && out[1].t < out[2].t);
  assert.ok(out.every((i) => i.power > 0 && i.power <= 1));
  assert.equal(impactSchedule(points, [{ type: 'water', x: 0, y: 60 }], 2.0)[0].skip, undefined, 'an ordinary splash is as it was');
});

// ---------------------------------------------------------------- ball skins
const ballLib = await import('../public/render/ball-skins.js');
const { BALL_SKIN_IDS, BALL_SKIN_COLORS, BALL_TRICKS, ballSkin, ballSkinId, ballSkinColor, ballCurseMark, restBallLook, shotBallSkin, BallSkins } = ballLib;
// the catalogue the skins must cover (lib/arcade.js is arcade-core's: read, not owned)
const CATALOGUE = (() => { try { return createRequire(import.meta.url)('../lib/arcade.js').POWERUPS; } catch { return null; } })();

test('ball skins: every ball of the catalogue has a complete skin in its own colour', () => {
  assert.equal(BALL_SKIN_IDS.length, 15);
  if (CATALOGUE) {
    const balls = CATALOGUE.filter((p) => p.kind !== 'trick');
    assert.deepEqual([...BALL_SKIN_IDS].sort(), balls.map((p) => p.id).sort(), 'one skin for each ball, and no others');
    for (const p of balls) assert.equal(BALL_SKIN_COLORS[p.id], p.color, `${p.id}: the ball, its trail and its dock token agree`);
    assert.deepEqual(CATALOGUE.filter((p) => p.kind === 'trick').map((p) => p.id).sort(), [...BALL_TRICKS].sort());
  }
  const seen = new Set();
  for (const id of BALL_SKIN_IDS) {
    const s = ballSkin(id);
    assert.equal(s.id, id);
    assert.equal(s.plain, false);
    assert.equal(s.color, BALL_SKIN_COLORS[id]);
    assert.match(s.cssColor, HEX);
    assert.equal(ballSkinColor(id), s.color);
    for (const key of ['roughness', 'metalness', 'opacity']) assert.ok(Number.isFinite(s.body[key]) && s.body[key] >= 0 && s.body[key] <= 1, `${id} body.${key}`);
    assert.ok(s.aura && s.aura.px >= 18 && s.aura.alpha > 0.2, `${id}: an aura big enough to see from the tee`);
    assert.equal(typeof s.paint, 'function', `${id}: a pattern for the close-ups`);
    assert.ok(s.flight && s.flight.rate > 0 && s.flight.colors.every((c) => HEX.test(c)), `${id}: leaves something of itself in the air`);
    assert.ok(s.burst > 0, `${id}: throws its own colour up where it lands`);
    if (s.idle) assert.ok(s.idle.rate > 0 && s.idle.life > 0 && s.idle.px > 0 && s.idle.colors.every((c) => HEX.test(c)), `${id} idle`);
    if (s.glow) assert.ok(s.glow.intensity > 0, `${id} glow`);
    // told apart at a glance: no two share a colour, and each has something that moves or glows
    assert.ok(!seen.has(s.color), `${id} shares a colour`);
    seen.add(s.color);
    const m = s.motion;
    assert.ok(s.idle || s.glow || m.spinU || m.hover || m.hop, `${id}: a signature at rest`);
  }
  // the briefs' signatures
  assert.equal(ballSkin('rocket').idle.from, 'back', 'a flame licking off the back at rest');
  assert.ok(ballSkin('fireball').glow.flicker > 0 && ballSkin('fireball').scorch);
  assert.ok(ballSkin('ghost').body.opacity < 0.6, 'the grass shows through a ghost');
  assert.ok(ballSkin('gold').body.metalness === 1 && ballSkin('gold').idle.twinkle);
  assert.ok(ballSkin('titan').body.metalness > 0.8 && ballSkin('titan').motion.heavy);
  assert.ok(ballSkin('moonball').motion.hover > 0 && ballSkin('moonball').motion.bob > 0, 'a low-gravity float');
  assert.ok(ballSkin('bouncy').motion.squash);
  assert.ok(ballSkin('yoyo').motion.spinU > 1, 'a spinning stripe');
  assert.ok(ballSkin('homing').aura.blink, 'a blinking light');
  assert.ok(ballSkin('laser').glow.intensity >= ballSkin('rocket').glow.intensity, 'a neon core');
});

test('ball skins: null, an unknown id and every trick are the plain ball', () => {
  const plainBall = ballSkin(null);
  assert.equal(plainBall.plain, true);
  assert.equal(plainBall.id, null);
  for (const id of [undefined, null, '', 'spaceship', 42, {}, 'toString', 'constructor', ...BALL_TRICKS]) {
    assert.equal(ballSkinId(id), null, String(id));
    assert.equal(ballSkin(id), plainBall, String(id));
    assert.equal(ballSkinColor(id), null);
  }
  assert.equal(ballSkinId({ id: 'gold' }), 'gold', 'a catalogue entry will do for its id');
  assert.equal(ballCurseMark('gust'), 'gust');
  for (const id of ['tiny-cup', 'fog', 'rocket', null, undefined]) assert.equal(ballCurseMark(id), null, 'only a gust shows on the ball');
});

test('ball skins: which ball lies at rest', () => {
  // solo: the bay's armed ball
  assert.deepEqual(restBallLook({ arcade: { armed: 'fireball' }, strokes: 2 }), { skin: 'fireball', curse: null });
  assert.deepEqual(restBallLook({ arcade: { armed: null }, strokes: 0 }), { skin: null, curse: null });
  assert.deepEqual(restBallLook({}), { skin: null, curse: null });
  assert.deepEqual(restBallLook({ arcade: { armed: 'gust' } }), { skin: null, curse: null }, 'a trick never skins your own ball');
  assert.deepEqual(restBallLook({ arcade: { armed: 'gold', enabled: false } }), { skin: null, curse: null });
  // a rocket hole: the course's free ball on the hole's first stroke only, not on the range
  const course = { freeBall: 'rocket' };
  assert.deepEqual(restBallLook({ arcade: { armed: 'gold' }, strokes: 0, courseArcade: course }), { skin: 'rocket', curse: null });
  assert.deepEqual(restBallLook({ arcade: { armed: 'gold' }, strokes: 1, courseArcade: course }), { skin: 'gold', curse: null });
  assert.deepEqual(restBallLook({ arcade: { armed: null }, strokes: 0, practice: true, courseArcade: course }), { skin: null, curse: null });
  assert.deepEqual(restBallLook({ arcade: { armed: null }, strokes: 0, courseArcade: { freeBall: 'fog' } }), { skin: null, curse: null });
  // a match: the ball of whoever is up, whatever the bay has armed
  const match = (over = {}) => ({
    phase: 'play', currentPlayerId: 'a', stage: { freeBall: null },
    players: [{ id: 'a', strokes: 1, armedPowerup: 'ghost', cursedWith: null }, { id: 'b', strokes: 0, armedPowerup: 'titan', cursedWith: 'gust' }],
    ...over,
  });
  assert.deepEqual(restBallLook({ match: match(), arcade: { armed: 'gold' } }), { skin: 'ghost', curse: null });
  assert.deepEqual(restBallLook({ match: match({ currentPlayerId: 'b' }), arcade: { armed: 'gold' } }), { skin: 'titan', curse: 'gust' }, 'the next player up: their ball, and the gust on them');
  assert.deepEqual(restBallLook({ match: match({ currentPlayerId: 'b', stage: { freeBall: 'rocket' } }) }), { skin: 'rocket', curse: 'gust' }, 'a free first stroke');
  assert.deepEqual(restBallLook({ match: match({ stage: { freeBall: 'rocket' } }) }), { skin: 'ghost', curse: null }, 'after the first stroke, their own');
  const cursed = match(); cursed.players[0].cursedWith = 'tiny-cup';
  assert.deepEqual(restBallLook({ match: cursed }), { skin: 'ghost', curse: null }, 'a tiny cup is not on the ball');
  for (const phase of ['loading', 'hole-result']) assert.deepEqual(restBallLook({ match: match({ phase }), arcade: { armed: 'gold' } }), { skin: null, curse: null }, `${phase}: nobody is up`);
  assert.deepEqual(restBallLook({ match: match({ phase: 'done' }), arcade: { armed: 'gold' } }), { skin: 'gold', curse: null }, 'a finished match is solo play again');
  // the ball a shot was hit with: the server's word
  assert.equal(shotBallSkin({ arcade: { powerup: 'skipper' } }), 'skipper');
  assert.equal(shotBallSkin({ arcade: { powerup: null }, freeBall: 'rocket' }), 'rocket');
  assert.equal(shotBallSkin({ arcade: { powerup: 'gust' } }), null);
  assert.equal(shotBallSkin({}), null);
  assert.equal(shotBallSkin(null), null);
});

test('ball skins: the ball at rest, the ball in flight, and plain again after', () => {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
  const plainMap = material.map = new THREE.Texture();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), material);
  const stage = new THREE.Scene();
  const skins = new BallSkins({ ball, scene: stage, doc: null });   // no canvas here: a skin falls back to its colour
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.3, 1000);
  camera.position.set(0, 4, 14);
  const host = { anim: null, camera, renderer: { domElement: { clientHeight: 720 }, getPixelRatio: () => 1 }, aimDeg: 0, headGlow: { visible: false } };
  // a ball that is never skinned is never touched, and nothing is built for it
  skins.update(0, 0.016, host);
  assert.equal(skins.set(null), null);
  skins.update(0.016, 0.016, host);
  assert.equal(stage.children.length, 0);
  assert.equal(material.map, plainMap);
  assert.equal(material.roughness, 0.35);
  // armed: the ball changes at once, with a pop
  assert.equal(skins.set('gold'), 'gold');
  assert.equal(skins.activeId, 'gold');
  assert.equal(material.metalness, 1);
  assert.equal(material.color.getHex(), BALL_SKIN_COLORS.gold);
  skins.update(0.05, 0.016, host);
  assert.equal(stage.children.length, 4, 'one aura, one ring, one set of motes, one scorch: built once');
  const [aura, ring] = stage.children;
  assert.ok(aura.visible && ring.visible, 'the aura in its colour, the pop\'s ring');
  assert.ok(ball.scale.x > 1, 'a scale punch');
  assert.equal(aura.userData.uniforms.uColor.value.getHex(), BALL_SKIN_COLORS.gold);
  // a trick is not a ball; an unknown id is the plain ball
  assert.equal(skins.set('fog'), null);
  assert.equal(material.metalness, 0);
  assert.equal(material.map, plainMap);
  // the shot: hit with a rocket, and it stays a rocket whatever is armed while it flies
  skins.set('ghost', { pop: false });
  assert.ok(material.transparent && material.opacity < 0.6);
  skins.beginShot('rocket');
  host.anim = {};
  ball.scale.setScalar(1);
  skins.update(1.0, 0.016, host);
  assert.equal(skins.activeId, 'rocket');
  assert.equal(material.transparent, false);
  skins.set('titan');
  skins.update(1.1, 0.016, host);
  assert.equal(skins.activeId, 'rocket', 'the armed ball changing mid-flight does not change the ball in the air');
  // a bounce throws motes in its colour
  ball.position.set(0, 5, 0); skins.update(1.2, 0.016, host);
  ball.position.set(0, 4, 0); skins.update(1.216, 0.016, host);
  ball.position.set(0, 4.2, 0); skins.update(1.232, 0.016, host);
  assert.ok(skins._gfx.alive > 0, 'a burst where it landed');
  // the shot is over: the ball at rest is the armed one
  host.anim = null;
  skins.update(1.3, 0.016, host);
  assert.equal(skins.activeId, 'titan');
  assert.ok(material.metalness > 0.8);
  // and back to plain: exactly the ball the scene made
  skins.set(null);
  assert.equal(material.map, plainMap);
  assert.equal(material.roughness, 0.35);
  assert.equal(material.metalness, 0);
  assert.equal(material.color.getHex(), 0xffffff);
  assert.equal(material.emissiveIntensity, 1);
  assert.equal(material.transparent, false);
  // a gust on the player who is up swirls round a plain ball
  skins.set(null, { curse: 'gust' });
  for (let i = 0; i < 30; i++) skins.update(2 + i * 0.016, 0.016, host);
  assert.ok(skins._gfx.alive > 0, 'wind streaks round the ball');
  skins.set(null, { curse: 'tiny-cup' });
  for (let i = 0; i < 90; i++) skins.update(3 + i * 0.016, 0.016, host);
  assert.equal(skins._gfx.alive, 0, 'a tiny cup shows nothing on the ball');
  skins.dispose();
  assert.equal(stage.children.length, 0);
});

test('ball skins: the trail and the rocket flame fly in the ball\'s colour', () => {
  const headGlow = makeGlow({ color: 0xffe7a3, px: 13 });
  const scene = { look: 'arcade', headGlow, quality: { level: 'high' } };
  assert.equal(shotTrail(scene, { trail: true, trailColor: 0x123456, ballSkin: 'gold' }).color, BALL_SKIN_COLORS.gold, 'the skin wins over another tint');
  assert.equal(shotTrail(scene, { trail: true, trailColor: 0x123456, ballSkin: 'gust' }).color, 0x123456, 'a trick is not a ball');
  assert.equal(shotTrail(scene, { trail: true, trailColor: 0x123456 }).color, 0x123456);
  const fx = shotRocket(scene, { trailHeat: 1, trailColor: 0x123456, ballSkin: 'fireball' }, 200);
  assert.equal(fx.uniforms.uColor.value.getHex(), BALL_SKIN_COLORS.fireball);
  fx.dispose();
});

test('the ball cam flies a bold tapered streak; the other cameras keep the thinner trail', () => {
  const T = ARCADE_LOOK.trail;
  const side = lookTracer({ look: 'arcade', shotCam: 'follow' }), tv = lookTracer({ look: 'arcade', shotCam: 'tv' }), plainLook = lookTracer('arcade');
  for (const t of [side, tv, plainLook]) {
    assert.equal(t.widthPx, T.widthPx);
    assert.equal(t.arcade.thin, T.thin);
    assert.equal(t.arcade.nearM, undefined);
  }
  const ball = lookTracer({ look: 'arcade', shotCam: 'ball' });
  assert.ok(ball.widthPx >= 2.5 * T.widthPx, 'thick at the ball');
  assert.ok(ball.arcade.freshS >= 0.9 && ball.arcade.freshS <= 1.4, 'tapering over about a second of flight');
  assert.ok(ball.widthPx * ball.arcade.thin <= T.widthPx * T.thin, 'down to a line no wider than the plain trail\'s');
  assert.ok(ball.arcade.nearM[0] < ball.arcade.nearM[1] && ball.arcade.nearM[1] < 5.5, 'whole at the ball (5.5 m ahead of the lens), gone before it reaches the lens');
  assert.equal(lookTracer({ look: 'real', shotCam: 'ball' }), undefined, 'the real look keeps its own tracer');
  // the streak is in the skin's colour, and a themed look keeps its rim
  const headGlow = makeGlow({ color: 0xffe7a3, px: 13 });
  const shot = shotTrail({ look: 'arcade', shotCam: 'ball', headGlow, _arcadeLook: resolveLook('alpine', 'day') }, { ballSkin: 'gold' });
  assert.equal(shot.color, ballLib.BALL_SKIN_COLORS.gold);
  assert.equal(shot.widthPx, T.ballCam.widthPx);
  assert.ok(shot.arcade.outline);
  assert.equal(headGlow.userData.uniforms.uPx.value, T.ballCam.headGlowPx);
  const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, -1)];
  const tracer = new ShotTracer(pts, [0, 1], ball);
  assert.deepEqual(tracer.uniforms.uNear.value.toArray(), T.ballCam.nearM);
  assert.equal(tracer.uniforms.uPx.value, T.ballCam.widthPx);
  assert.deepEqual(new ShotTracer(pts, [0, 1], side).uniforms.uNear.value.toArray(), [3, 9]);
});
