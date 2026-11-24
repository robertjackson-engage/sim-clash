// The arcade worlds' trees: modelled species (public/arcade/trees/*.glb, grown by
// tools/arcade-art/trees), instanced, with levels of detail, wind, snow, blossom and the
// plants at their feet. trees.js makeTreeField() picks this field for the arcade look and
// keeps the photographed-leaf TreeField for the real one (and as the fallback when the
// model files are missing).
//
// How a frame stays cheap with 700 trees and a few thousand plants:
//
//   - ONE material draws everything: bark, leaves, rocks, flowers. Four textures: a painted
//     leaf atlas (colour stored as DETAIL round each tile's mean) with its masks (coverage,
//     accent, blade), and a strip of painted bark columns with their normal map. Every
//     colour still comes from per-vertex and per-instance tints, so a world's palette, its
//     snow and its night cost no texture; the paint says how one leaf differs from the next.
//   - The trees nearest a tee or a green stand as their species' HERO model (more of
//     everything); they are ordinary batches, so they fade and change level like the rest.
//   - One InstancedMesh a species variant and level of detail. A tree's leaf cards are
//     RANKED in the model; the far levels hold a prefix of them, and the vertex shader
//     drops cards by rank as the tree recedes while the ones that stay grow, so the
//     hand-over from one level to the next is a card already shrunk to nothing: no pop,
//     no dither.
//   - Instance matrices are composed once; each frame the camera moved, trees are
//     re-bucketed near / mid / far / see-through with a memcpy (as TreeField does).
//   - Wind, the cards' drop-out and the understory's fade are all vertex shader work on
//     attributes baked into the models; nothing runs per tree per frame in JavaScript.
//
// The pass-through (tree-fade.js, setFadeLine) is the same rule TreeField uses: a tree in
// front of the shot goes to a fourth bucket drawn with a blended copy of the material.
import * as THREE from 'three';
import { RENDER_CONFIG } from './config.js';
import { readTreeGlb } from './tree-glb.js';
import { treeWorld, worldSpecies, treeAt, variantOf, treeScale, placeUnderstory, treeDetail, hash2, spotHeight, UNDER_MODELS, treeGrade, heroSpots, leafPaint } from './tree-species.js';
import { treeFade, FADE_NEAR_M, FADE_HUG_M, FADE_SHOWN, FADE_AT } from './tree-fade.js';

export const TREE_ASSET_BASE = '/arcade/trees/';
export const TREE_ENV_MANIFEST = '/arcade/env/manifest.json';   // the stage skies (far-world.js): the trees take their light's colours from the same picture
const FAR_CULL_M = 3200;    // fogged out past here
const KEEP_RADIUS_M = 70;   // always drawn (shadow casters just off-screen)
const STATURE_OVER = 0.12;   // a species may stand this much taller than the look's own tree scale (see _build)
const ARCADE_MID_M = 480;   // mid -> far model: a 14 m tree is ~35 px tall there at 1080p
const PREVAILING_TO_DEG = 62;   // a links' wind-bent pines lean this way (the wind off the sea), a few degrees each side

// ---------------------------------------------------------------- assets (fetched once a session)
const assetCache = new Map();   // base -> { manifest: Promise, species: Map<name, Promise>, textures: Promise }
function assets(base) {
  if (!assetCache.has(base)) assetCache.set(base, { manifest: null, species: new Map(), textures: null });
  return assetCache.get(base);
}
export function loadTreeManifest(base = TREE_ASSET_BASE) {
  const a = assets(base);
  return (a.manifest ||= fetch(`${base}manifest.json`).then((r) => { if (!r.ok) throw new Error(`tree manifest: ${r.status}`); return r.json(); }));
}
function loadSpecies(name, base, manifest) {
  const a = assets(base);
  if (!a.species.has(name)) {
    const entry = manifest.species[name];
    a.species.set(name, !entry ? Promise.reject(new Error(`no tree species "${name}" in the manifest`)) : fetch(`${base}${entry.file}`).then((r) => { if (!r.ok) throw new Error(`${entry.file}: ${r.status}`); return r.arrayBuffer(); }).then((buf) => speciesModels(buf, entry)));
  }
  return a.species.get(name);
}
// A species file (.glb bytes) and its manifest entry -> its variants, ready to instance.
// (the list also carries `hero`: the species' higher-detail model, when the file has one)
export function speciesModels(buf, entry) {
  const all = readTreeGlb(buf).models;
  const model = (m, meta) => ({
    name: m.name,
    meta: { ...meta, H: entry.H, kind: entry.kind, align: entry.align },
    // BufferAttributes shared by the model's three index buffers (one upload)
    attrs: {
      position: new THREE.BufferAttribute(m.attributes.position, 3), normal: new THREE.BufferAttribute(m.attributes.normal, 3), uv: new THREE.BufferAttribute(m.attributes.uv, 2),
      aData: new THREE.BufferAttribute(m.attributes.aData, 4, true), aTint: new THREE.BufferAttribute(m.attributes.aTint, 4, true), aWind: new THREE.BufferAttribute(m.attributes.aWind, 4, true),
      aPivot: new THREE.BufferAttribute(m.attributes.aPivot, 3),
    },
    index: m.lods.map((idx) => new THREE.BufferAttribute(idx, 1)),
  });
  const list = entry.variants.map((meta, v) => model(all[v], meta));
  const hero = entry.hero && all.find((m) => m.name.endsWith('-hero'));
  if (hero) list.hero = model(hero, entry.hero);
  return list;
}
function loadTextures(base, manifest) {
  const a = assets(base);
  if (!a.textures) {
    const loader = new THREE.TextureLoader(new THREE.LoadingManager());   // its own manager: never holds the course's load state
    const load = (file) => new Promise((resolve, reject) => loader.load(`${base}${file}`, resolve, undefined, () => reject(new Error(`${file} did not load`))));
    const T = manifest.textures;
    a.textures = Promise.all([load(T.leaves.file), load(T.leavesAux.file), load(T.bark.file), load(T.barkNormal.file)]).then(([leaves, aux, bark, barkN]) => {
      for (const t of [leaves, aux, bark, barkN]) { t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4; }
      leaves.colorSpace = bark.colorSpace = THREE.SRGBColorSpace;   // painted colour; the masks and the normal map are data
      aux.colorSpace = barkN.colorSpace = THREE.NoColorSpace;
      for (const t of [leaves, aux]) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      for (const t of [bark, barkN]) { t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; }
      return { leaves, aux, bark, barkN };
    });
  }
  return a.textures;
}

// The stage's sky as the environment stream measured it (sun colour, zenith, haze): fetched
// once; a stage without one (or a copy without the file) grades its trees neutrally.
let envManifestP = null;
function loadSkyEntry(theme, timeOfDay) {
  if (typeof fetch !== 'function') return Promise.resolve(null);
  envManifestP ||= fetch(TREE_ENV_MANIFEST).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return envManifestP.then((m) => (m && m.skies && m.skies[`${theme}-${timeOfDay}`]) || null);
}

// ?trees=classic (the old procedural trees in the arcade look) | arcade (the default)
export function treeModeFromQuery() {
  try { return new URLSearchParams(globalThis.location?.search || '').get('trees') === 'classic' ? 'classic' : 'arcade'; } catch { return 'arcade'; }
}

// ---------------------------------------------------------------- shaders
// Shared by the lit material, its see-through copy and the shadow depth material.
const VERT_DECL = /* glsl */`
  attribute vec4 aData; attribute vec4 aTint; attribute vec4 aWind; attribute vec3 aPivot;
  attribute vec4 aInst; attribute vec4 aFx;
  uniform float uTime; uniform vec4 uWind; uniform vec3 uLodCam; uniform vec4 uLod;
  // the share of its leaf cards a tree keeps at distance d (tree-species.js lodKeep)
  float treeKeep(float d) {
    float k = mix(1.0, uLod.z, smoothstep(uLod.x * 0.45, uLod.x, d));
    return mix(k, uLod.w, smoothstep(uLod.x, uLod.y, d));
  }`;
// after this: `transformed` is the vertex in the model's space, cards dropped / grown, bent by the wind
const VERT_BODY = /* glsl */`
  vec3 tIp = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float tSx = max(1e-4, length(instanceMatrix[0].xyz)), tSy = max(1e-4, length(instanceMatrix[1].xyz));
  float tDist = distance(tIp, uLodCam);
  float tLeaf = step(0.75, aData.a);
  {
    // levels of detail: a leaf card of rank r is drawn while the tree keeps more than r of them
    float keep = aFx.x > 0.0 ? aFx.x : treeKeep(tDist);
    float vis = clamp((keep * 1.08 - aWind.y) / (0.08 * keep + 1e-4), 0.0, 1.0);
    float grow = mix(1.0, pow(1.0 / keep, 0.46), aWind.z);
    transformed = (position - aPivot) + aPivot * mix(1.0, vis * grow, tLeaf);
    // the understory shrinks into the ground at its draw distance
    if (aFx.z > 0.0) transformed *= 1.0 - smoothstep(aFx.y, aFx.z, tDist);
  }
  {
    // wind: the hole's own, in the tree's space. The whole tree leans and sways downwind
    // (more with height), gusts roll across the course the way the wind blows, each limb
    // bobs on its own beat, leaves flutter.
    vec3 wW = vec3(uWind.x, 0.0, uWind.y);
    vec2 wl = vec2(dot(instanceMatrix[0].xyz, wW), dot(instanceMatrix[2].xyz, wW)) / tSx;
    float ph = tIp.x * 0.043 + tIp.z * 0.067;
    float str = uWind.z;
    float gust = 0.55 + 0.45 * sin(uTime * (0.5 + 0.5 * str) - dot(tIp.xz, uWind.xy) * 0.035 + sin(ph) * 1.3);
    float hM = max(transformed.y, 0.0) * tSy;
    float bend = (hM / 12.0) * (hM / 12.0);
    float s1 = sin(uTime * 1.15 + ph) * 0.6 + sin(uTime * 1.9 + ph * 1.7) * 0.4;
    float along = (0.55 * str + s1 * (0.25 + 0.75 * str) * gust) * (0.05 + 0.34 * str) * bend;
    float aside = cos(uTime * 0.9 + ph * 1.3) * (0.03 + 0.1 * str) * bend;
    transformed.xz += (wl * along + vec2(-wl.y, wl.x) * aside) / tSx;
    float b1 = sin(uTime * (1.5 + 1.2 * str) + aWind.x * 6.283 + ph * 2.0);
    float amp = aData.g * (0.025 + 0.2 * str) * (0.6 + 0.4 * gust);
    transformed.y += b1 * amp * 0.6 / tSy;
    transformed.xz += wl * (b1 * 0.5 + 0.5 * str) * amp / tSx;
    float fl = sin(uTime * (4.0 + 7.0 * str) + dot(position, vec3(2.3, 1.7, 3.1)) + aWind.x * 20.0 + ph * 3.0);
    transformed += normal * (fl * aData.b * (0.02 + 0.08 * str) * gust / tSx);
  }`;

const FRAG_DECL = /* glsl */`
  uniform sampler2D uLeafTex; uniform sampler2D uLeafAux; uniform sampler2D uBarkTex; uniform sampler2D uBarkNrm;
  uniform vec3 uSunView; uniform vec4 uSnow; uniform vec4 uUp; uniform vec4 uMoss; uniform vec3 uBarkMul; uniform vec3 uGlow; uniform float uTime;
  uniform vec3 uShadeLo; uniform vec3 uShadeHi; uniform vec4 uPaint;   // uPaint: 1 / the atlas's detail mid, bark relief, (spare), light through the leaves
  varying vec4 vTData; varying vec3 vTTint; varying float vTCol; varying vec3 vTAccent; varying vec4 vTMisc; varying vec2 vTUv; varying float vTDepth;`;
// The painted atlases are DETAIL round 1 (texture x uPaint.x): a leaf's own light and dark
// drive the ramp from the sky-tinted shade colour to the sun-tinted lit one (uShadeLo / Hi,
// graded from the stage's sky), its hue drift rides on the tree's palette colour, twigs keep
// their painted colour, flowers / seed heads / snow take the tree's accent colour. A leaf
// fragment reads the leaf atlas and its masks, a bark fragment the bark column and its
// normal: two texture reads either way (explicit gradients, so the branch is a real one).
const FRAG_COLOR = /* glsl */`
  float tIsLeaf = step(0.75, vTData.a);
  float tIsSolid = step(0.25, vTData.a) * (1.0 - tIsLeaf);
  vec3 tInst = vColor.rgb;
  vec2 tDx = dFdx(vTUv), tDy = dFdy(vTUv);
  vec3 tQ0 = dFdx(vViewPosition), tQ1 = dFdy(vViewPosition);
  vec3 tCol; vec3 tBarkN = vec3(0.0, 0.0, 1.0);
  float tAccent = 0.0, tBlade = 0.0, tSnow = 0.0;
  if (tIsLeaf > 0.5) {
    vec3 tD = textureGrad(uLeafTex, vTUv, tDx, tDy).rgb * uPaint.x;
    vec3 tAux = textureGrad(uLeafAux, vTUv, tDx, tDy).rgb;
    tAccent = tAux.g; tBlade = tAux.b * (1.0 - tAux.g);
    float tL = dot(tD, vec3(0.2126, 0.7152, 0.0722));
    vec3 tHue = mix(vec3(1.0), clamp(tD / max(tL, 0.35), 0.0, 1.7), 0.9);   // (a dark pixel keeps its darkness: its cast is not blown up into a colour)
    float tShade = clamp(tL * 0.62, 0.0, 1.0) * mix(0.3, 1.0, vTData.r);
    vec3 tLeafCol = tInst * vTTint * tHue * mix(uShadeLo, uShadeHi, smoothstep(0.06, 0.9, tShade));
    vec3 tWood = (tD / uPaint.x) * uBarkMul * mix(0.5, 1.15, vTData.r);
    vec3 tAcc = vTAccent * (0.3 + 0.75 * min(tL, 1.4)) * mix(0.62, 1.0, vTData.r);
    tCol = mix(mix(tWood, tLeafCol, tAux.b), tAcc, tAux.g);
    // snow on the light parts of a bough that faces the sky (a painted snow tile brings its own, as accent)
    tSnow = uSnow.a * vTMisc.z * smoothstep(0.42, 0.76, tL * 0.62) * smoothstep(0.05, 0.5, vTMisc.y) * smoothstep(0.25, 0.6, vTData.r) * (1.0 - tAux.g);
    // far cards keep their coverage (a plain mip chain thins leaves out to nothing). The cut is
    // a plain alpha test: the frame's SMAA softens the silhouette (the composer's targets carry
    // no MSAA, so there is no alpha-to-coverage, and a screen-door dither would crawl)
    diffuseColor.a *= clamp(tAux.r * (1.0 + 0.9 * smoothstep(40.0, 320.0, vTDepth)), 0.0, 1.0);
  } else {
    float tF = fract(vTUv.x), tTri = 1.0 - abs(2.0 * tF - 1.0);
    vec2 tBuv = vec2((vTCol + 0.04 + 0.92 * tTri) / 8.0, vTUv.y);
    vec2 tBdx = vec2(tDx.x * 0.23, tDx.y), tBdy = vec2(tDy.x * 0.23, tDy.y);
    vec3 tD = textureGrad(uBarkTex, tBuv, tBdx, tBdy).rgb * uPaint.x;
    vec4 tNm = textureGrad(uBarkNrm, tBuv, tBdx, tBdy);
    // a rock borrows a bark column for its cracks and grain, not for its colour
    tD = mix(tD, vec3(dot(tD, vec3(0.2126, 0.7152, 0.0722))), 0.85 * tIsSolid);
    float tOcc = mix(0.5, 1.0, vTData.r);
    tCol = mix(vTTint * uBarkMul, tInst * vTTint, tIsSolid) * tD * (0.62 * tOcc);
    tCol = mix(tCol, uMoss.rgb * tD * (0.8 * tOcc), tNm.b * uMoss.a * (1.0 - tIsSolid));
    // the column is mirrored round the trunk: so is its normal's x
    tBarkN = vec3((tNm.xy * 2.0 - 1.0) * vec2(tF < 0.5 ? 1.0 : -1.0, 1.0) * (uPaint.y * (1.0 - smoothstep(50.0, 170.0, vTDepth))), 1.0);
    tSnow = uSnow.a * vTMisc.z * smoothstep(0.3, 0.75, vTMisc.y);
  }
  tCol = mix(tCol, uSnow.rgb, tSnow);
  diffuseColor.rgb = tCol;`;

function patchTreeMaterial(mat, shared, { ghost = false } = {}) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        ${VERT_DECL}
        varying vec4 vTData; varying vec3 vTTint; varying float vTCol; varying vec3 vTAccent; varying vec4 vTMisc; varying vec2 vTUv; varying float vTDepth;`)
      .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
        ${VERT_BODY}
        vTData = aData; vTTint = aTint.rgb * 2.0; vTCol = floor(aTint.a * 8.0); vTAccent = aInst.rgb; vTUv = uv;
        vTMisc = vec4(clamp(max(transformed.y, 0.0) * tSy / max(1.0, abs(aInst.w)), 0.0, 1.0), normalize(mat3(instanceMatrix) * normal).y, aWind.a, aFx.w);`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vTDepth = -mvPosition.z;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${FRAG_DECL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${FRAG_COLOR}`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        // leaf cards carry a normal bent out of the crown: a card seen from behind must not
        // flip it inward, or half the canopy shades black
        if (tIsLeaf > 0.5) { normal = normalize(vNormal); nonPerturbedNormal = normal; }
        else {
          // bark: the painted relief, in a tangent frame from the surface's own derivatives
          vec3 tQ1p = cross(tQ1, normal), tQ0p = cross(normal, tQ0);
          vec3 tT = tQ1p * tDx.x + tQ0p * tDy.x, tB = tQ1p * tDx.y + tQ0p * tDy.y;
          float tDet = max(dot(tT, tT), dot(tB, tB));
          float tSc = tDet == 0.0 ? 0.0 : inversesqrt(tDet);
          normal = normalize(tT * (tBarkN.x * tSc) + tB * (tBarkN.y * tSc) + normal);
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // foliage is a matte scatterer (no sky-grey sheen on a card at a grazing angle); a
        // little more sun against a little less sky, so lit lobes stand out from shaded ones
        reflectedLight.indirectSpecular *= mix(0.5, 0.1, tIsLeaf);
        reflectedLight.directSpecular *= mix(0.6, 0.25, tIsLeaf);
        // the inside of a crown sees little sky and less sun (the baked occlusion), its outside all of both
        reflectedLight.indirectDiffuse *= mix(1.0, 0.9 * mix(0.4, 1.0, vTData.r), tIsLeaf);
        reflectedLight.directDiffuse *= mix(1.0, 1.18 * mix(0.55, 1.0, vTData.r), tIsLeaf);
        #if NUM_DIR_LIGHTS > 0
        {
          // light THROUGH the leaves: the sun wraps round a crown's terminator and its shaded
          // side is lit yellow-green from inside, most at the outside of the crown
          float tNdl = dot(normal, directionalLights[0].direction);
          float tWrap = clamp((tNdl + 0.55) / 1.55, 0.0, 1.0) - clamp(tNdl, 0.0, 1.0);
          reflectedLight.directDiffuse += directionalLights[0].color * BRDF_Lambert(diffuseColor.rgb * vec3(1.2, 1.08, 0.5)) * (tWrap * uPaint.w * vTData.r * tBlade * (1.0 - tSnow));
        }
        #endif
        {
          // light off the ground: bark's shaded side is not black, a crown's underside glows a little green
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          float down = clamp(0.5 - 0.5 * dot(normal, upV), 0.0, 1.0);
          reflectedLight.indirectDiffuse += BRDF_Lambert(diffuseColor.rgb) * vec3(0.5, 0.58, 0.38) * (0.3 + 0.7 * down) * mix(1.0, 0.45, tIsLeaf) * uGlow.z;
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // leaves glow when the camera looks toward the sun through them
          vec3 toCam = normalize(vViewPosition);
          float back = pow(clamp(dot(-toCam, uSunView), 0.0, 1.0), 4.0);
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.1, 1.05, 0.7) * back * uGlow.y * vTData.r * tBlade * (1.0 - tSnow);
          // lit from below (a city's lamps, a lava lake): warm at the foot, gone by the top
          totalEmissiveRadiance += diffuseColor.rgb * uUp.rgb * (uUp.a * 2.2 * (1.0 - vTMisc.x) * (1.0 - vTMisc.x));
          // flowers, embers and fairy lights that are their own light
          totalEmissiveRadiance += vTAccent * (tAccent * uGlow.x * (0.72 + 0.28 * sin(uTime * 2.7 + vTMisc.w * 43.0 + vTUv.x * 61.0)));
        }`);
  };
  mat.customProgramCacheKey = () => `arcade-tree-v2${ghost ? '-ghost' : ''}`;
  return mat;
}

function makeTreeDepthMaterial(shared) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        ${VERT_DECL}
        varying vec2 vTUv; varying float vTLeaf;`)
      .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
        ${VERT_BODY}
        vTUv = uv; vTLeaf = tLeaf;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uLeafAux; varying vec2 vTUv; varying float vTLeaf;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (vTLeaf > 0.5 && texture2D(uLeafAux, vTUv).r < 0.5) discard;`);
  };
  m.customProgramCacheKey = () => 'arcade-tree-v2-depth';
  return m;
}

// ---------------------------------------------------------------- small helpers
// a dark core at the trunk's foot, a wide soft shade out to the crown's edge: [radius 0..1, alpha]
const BLOB_STOPS = [[0, 0.7], [0.1, 0.46], [0.3, 0.17], [0.65, 0.06], [1, 0]];
function blobTexture() {
  const s = 64, px = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const d = Math.min(1, Math.hypot(x + 0.5 - s / 2, y + 0.5 - s / 2) / (s / 2));
    let k = 1;
    while (k < BLOB_STOPS.length - 1 && BLOB_STOPS[k][0] < d) k++;
    const [d0, a0] = BLOB_STOPS[k - 1], [d1, a1] = BLOB_STOPS[k];
    const o = (y * s + x) * 4;
    px[o] = px[o + 1] = px[o + 2] = 255;
    px[o + 3] = Math.round(255 * (a0 + (a1 - a0) * Math.min(1, Math.max(0, (d - d0) / (d1 - d0)))));
  }
  const t = new THREE.DataTexture(px, s, s, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// Blossom drifting down round the camera: one draw of point sprites in a box that follows
// the camera (positions wrap, so the box never empties), carried by the wind.
function makePetals(shared, colors, count) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3), rnd = new Float32Array(count * 4);
  let a = 1234567;
  const r = () => { a = (Math.imul(a, 1664525) + 1013904223) | 0; return (a >>> 0) / 4294967296; };
  for (let i = 0; i < count; i++) { pos[i * 3] = r(); pos[i * 3 + 1] = r(); pos[i * 3 + 2] = r(); rnd[i * 4] = r(); rnd[i * 4 + 1] = r(); rnd[i * 4 + 2] = r(); rnd[i * 4 + 3] = r(); }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: shared.uTime, uWind: shared.uWind, uLodCam: shared.uLodCam, uBox: { value: new THREE.Vector3(70, 26, 70) }, uColA: { value: new THREE.Color(colors[0]) }, uColB: { value: new THREE.Color(colors[1]) }, uPx: { value: 1 } },
    vertexShader: /* glsl */`
      attribute vec4 aRnd; uniform float uTime; uniform vec4 uWind; uniform vec3 uLodCam; uniform vec3 uBox; uniform float uPx;
      varying float vMix; varying float vSpin; varying float vFade;
      void main() {
        float fall = 0.55 + 0.6 * aRnd.x, drift = 0.4 + 0.9 * aRnd.y + 2.2 * uWind.z;
        vec3 p = position * uBox;
        p.y -= uTime * fall;
        p.xz += uWind.xy * uTime * drift + vec2(sin(uTime * (0.6 + aRnd.z) + aRnd.w * 6.283), cos(uTime * (0.5 + aRnd.x) + aRnd.y * 6.283)) * 0.6;
        vec3 org = uLodCam - uBox * vec3(0.5, 0.35, 0.5);
        p = org + mod(p - org, uBox);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        vFade = smoothstep(1.2, 3.0, d) * (1.0 - smoothstep(uBox.x * 0.32, uBox.x * 0.5, d));
        gl_PointSize = clamp(uPx * (0.07 + 0.05 * aRnd.z) / max(d, 0.5), 1.5, 22.0);
        vMix = aRnd.w; vSpin = uTime * (1.5 + 3.0 * aRnd.x) + aRnd.y * 6.283;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColA; uniform vec3 uColB; varying float vMix; varying float vSpin; varying float vFade;
      void main() {
        // a petal tumbling: an ellipse that turns and thins as it rolls edge-on
        vec2 q = gl_PointCoord - 0.5;
        float c = cos(vSpin), s = sin(vSpin);
        q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
        q.y /= 0.35 + 0.65 * abs(sin(vSpin * 0.7));
        float a = 1.0 - smoothstep(0.16, 0.25, dot(q, q) * 1.6 + q.x * q.x);
        if (a * vFade < 0.02) discard;
        gl_FragColor = vec4(mix(uColA, uColB, step(0.72, vMix)) * 1.15, a * vFade * 0.92);
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  pts.name = 'blossomPetals';
  return pts;
}

// ---------------------------------------------------------------- the field
export class ArcadeTreeField {
  // spots: [{ x, y, h?, r?, s?, species?, edge? }] (sim metres), as TreeField takes them;
  // hAt(x, y) -> ground height; V: sim -> three.
  // opts: nearM, midM, sunDir, theme, timeOfDay, quality ('ultra' | 'high' | 'low'), look
  // (arcade-look.js trees: only its `scale` is read, to get back the measured sizes),
  // blocked(x, y, r), waterAt(x, y), wind { mph, toDeg }, baseUrl, onFail(field, error), onReady(field),
  // focus (where the player stands and looks: [{ x, y }] or [[x, y]], the tees and pins; the trees nearest
  // each stand as their species' hero model),
  // assets (the files already in hand, for a test or a tool: { manifest, glb(name) -> bytes,
  // textures: { leaves, aux, bark, barkN }, sky (the stage's row of the env manifest) })
  constructor(spots, hAt, V, { nearM = 150, midM = 1100, sunDir = null, theme = 'tropical', timeOfDay = 'day', quality = 'high', look = null, blocked = null, waterAt = null, wind = null, focus = null, baseUrl = TREE_ASSET_BASE, onFail = null, onReady = null, assets: given = null } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'treeField';
    this.isArcadeTreeField = true;
    this.theme = theme;
    this.world = treeWorld(theme);
    this.detail = treeDetail(quality);
    this.nearM = nearM;
    // the far model takes over where a tree is a few dozen pixels tall (its cards have
    // been thinning out by rank all the way there, so nothing pops)
    this.midM = Math.max(nearM * 1.5, Math.min(midM ?? 1100, ARCADE_MID_M));
    this.fadeOn = true;
    this.fadeLine = null;
    this.loaded = false;
    this.failed = false;
    this.ownsGrounding = this.detail.blobs;
    this.variants = [];   // the batches (TreeField's name for them)
    this.stats = { near: 0, mid: 0, far: 0, seeThrough: 0, under: 0 };
    this.heroes = 0;
    this._focus = (focus || []).map((f) => (Array.isArray(f) ? { x: f[0], y: f[1] } : f)).filter((f) => f && Number.isFinite(f.x) && Number.isFinite(f.y));
    this._timeOfDay = timeOfDay;
    this._sunDir = sunDir || new THREE.Vector3(0.4, 0.8, 0.3).normalize();
    this._ghosts = [];
    this._hAt = hAt; this._V = V;
    const fx = this.world.fx || {};
    const night = timeOfDay === 'night' || timeOfDay === 'dusk';
    const v4 = (pair, a = 1) => { const c = new THREE.Color(pair ? pair[0] : '#000000'); return new THREE.Vector4(c.r, c.g, c.b, pair ? pair[1] * a : 0); };
    const k0 = Math.min(1, Math.max(0, RENDER_CONFIG.windStrength ?? 0.5)) * 0.4;
    this.shared = {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector4(0.7, 0.7, k0, 0) },          // direction (three x, z), strength 0..1
      uWindAmp: { value: 0 },                                        // TreeField's knob (scene.setWind writes it): unused here
      uLodCam: { value: new THREE.Vector3() },
      uLod: { value: new THREE.Vector4(this.nearM, this.midM, 0.42, 0.15) },
      uLeafTex: { value: null }, uLeafAux: { value: null }, uBarkTex: { value: null }, uBarkNrm: { value: null },
      // the shade ramp's two ends (graded from the stage's sky in _load), and the paint's knobs:
      // 1 / detail mid, bark relief, (spare), light through the leaves
      uShadeLo: { value: new THREE.Vector3(...treeGrade(null).lo) }, uShadeHi: { value: new THREE.Vector3(...treeGrade(null).hi) },
      uPaint: { value: new THREE.Vector4(2.5, this.detail.barkRelief, 0, (fx.through ?? 0.32) * (night ? 0.3 : 1)) },
      uSunView: { value: new THREE.Vector3(0, 1, 0) },
      uSnow: { value: v4(fx.snow) },
      // up-lighting belongs to the dark: a lit world's lamps at night and dusk, a volcano's lava always
      uUp: { value: v4(fx.uplight, fx.lit ? (night ? 1 : 0.12) : 1) },
      uMoss: { value: v4(fx.moss) },
      uBarkMul: { value: new THREE.Vector3(...(fx.bark || [1, 1, 1])) },
      // accent glow, back light through the leaves, ground bounce
      uGlow: { value: new THREE.Vector3((fx.accentGlow || 0) * (fx.lit && !night ? 0.15 : 1), (fx.backlight ?? 0.55) * (night ? 0.15 : 1), night ? 0.35 : 1) },
    };
    if (wind) this.setWind(wind);
    this.ready = this._load(spots, baseUrl, look, blocked, waterAt, given).then(() => { this.loaded = true; this._last.t = -1e9; onReady?.(this); }, (err) => {
      this.failed = true; this.loaded = true;
      console.warn('[trees] the arcade tree models did not load; drawing the classic trees', err?.message || err);
      onFail?.(this, err);
    });
    this._frustum = new THREE.Frustum();
    this._cullCam = new THREE.PerspectiveCamera();
    this._pm = new THREE.Matrix4();
    this._last = { pos: new THREE.Vector3(1e9, 0, 0), dir: new THREE.Vector3(), t: -1e9 };
    this._tmp = new THREE.Vector3();
  }

  async _load(spots, base, look, blocked, waterAt, given) {
    const manifest = given ? given.manifest : await loadTreeManifest(base);
    const names = worldSpecies(this.theme, { understory: this.detail.understory > 0 });
    const [tex, sky, ...lists] = await Promise.all([given ? given.textures : loadTextures(base, manifest), given ? (given.sky || null) : loadSkyEntry(this.theme, this._timeOfDay), ...names.map((n) => (given ? speciesModels(given.glb(n), manifest.species[n]) : loadSpecies(n, base, manifest)))]);
    this.manifest = manifest;
    const models = new Map(names.map((n, i) => [n, lists[i]]));
    this.shared.uLeafTex.value = tex.leaves; this.shared.uLeafAux.value = tex.aux || null; this.shared.uBarkTex.value = tex.bark; this.shared.uBarkNrm.value = tex.barkN || null;
    if (manifest.detailMid > 0) this.shared.uPaint.value.x = 1 / manifest.detailMid;
    // the trees sit in the stage's own light: shade toward its sky, lit sides toward its sun
    this.grade = treeGrade(sky, this.world.fx?.grade);
    this.shared.uShadeLo.value.set(...this.grade.lo); this.shared.uShadeHi.value.set(...this.grade.hi);
    this.shared.uLod.value.z = manifest.lodKeep[1]; this.shared.uLod.value.w = manifest.lodKeep[2];
    this._build(spots, models, look, blocked, waterAt);
  }

  // the classic field takes this one's place (trees.js, when the model files are missing)
  adopt(field) {
    this._fallback = field;
    field.fadeOn = this.fadeOn;
    if (this.fadeLine) field.setFadeLine(this.fadeLine);
    this.group.add(field.group);
  }

  _build(spots, models, look, blocked, waterAt) {
    const hAt = this._hAt, V = this._V, world = this.world;
    const mat = patchTreeMaterial(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.86, metalness: 0, envMapIntensity: 0.7, alphaTest: 0.5 }), this.shared);
    const ghostMat = patchTreeMaterial(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.86, metalness: 0, envMapIntensity: 0.7, alphaTest: 0.5 * FADE_SHOWN, transparent: true, opacity: FADE_SHOWN, depthWrite: false }), this.shared, { ghost: true });   // no depth from a ghost: the ambient occlusion pass would print its leaves as dark specks
    const depthMat = makeTreeDepthMaterial(this.shared);
    this._materials = [mat, ghostMat, depthMat];

    // the measured sizes: arcade-look's theme scale is undone (this field has its own statures)
    const k = look?.scale > 0 ? look.scale : 1;
    const real = k === 1 ? spots : spots.map((s) => ({ ...s, h: s.h != null ? s.h / k : s.h, r: s.r != null ? s.r / k : s.r, s: s.s != null ? s.s / k : s.s }));
    let hLo = Infinity, hHi = -Infinity;
    for (const s of real) { const h = spotHeight(s); if (h < hLo) hLo = h; if (h > hHi) hHi = h; }
    const hRel = (s) => (hHi > hLo ? (spotHeight(s) - hLo) / (hHi - hLo) : 0.5);

    // ---- which model each spot gets
    const lists = new Map();   // "species:variant" -> [{ spot, entry, ... }]
    const put = (key, item) => (lists.get(key) || lists.set(key, []).get(key)).push(item);
    const blobs = [];
    // the heroes: the few trees nearest each tee and green stand as their species' best model
    const heroes = this.detail.heroes > 0 ? heroSpots(real, this._focus, this.detail.heroes) : new Set();
    for (let si = 0; si < real.length; si++) {
      const s = real[si];
      const t = treeAt(this.theme, s, hRel(s));
      const set = models.get(t.species);
      const isHero = heroes.has(si) && !!set.hero;
      const v = variantOf(s, set.length), model = isHero ? set.hero : set[v], m = model.meta;
      if (isHero) this.heroes++;
      // no taller than the camera's own idea of the tree allows: the scene's glide and landing
      // cameras clear the spots as arcade-look scaled them (x k), with a 2 m margin
      const entry = t.entry.height > k + STATURE_OVER ? { ...t.entry, height: k + STATURE_OVER } : t.entry;
      const size = treeScale(s, entry, m, t.u, t.v);
      put(isHero ? `${t.species}:hero` : `${t.species}:${v}`, { x: s.x, y: s.y, model, w: size.w, ht: size.ht, heightM: size.heightM, leaf: t.entry.leaf, accent: t.entry.accent || t.entry.leaf, u: t.u, v: t.v, rot: m.align ? Math.PI / 2 - (PREVAILING_TO_DEG + (t.u - 0.5) * 26) * Math.PI / 180 : t.v * Math.PI * 2, under: null });
      blobs.push({ x: s.x, y: s.y, d: Math.max(3, size.crownM * 1.7) });
    }
    // ---- the plants at their feet
    let plants = [];
    if (this.detail.understory > 0) {
      const clear = (x, y) => {
        const h = hAt(x, y);
        if (waterAt) { const wl = waterAt(x, y); if (wl !== h && h < wl + 0.12) return false; }   // under water, or on the wet line (waterAt gives the ground's own height where there is no water)
        return Math.abs(hAt(x + 1.5, y) - hAt(x - 1.5, y)) < 2.4 && Math.abs(hAt(x, y + 1.5) - hAt(x, y - 1.5)) < 2.4;   // not on a cliff
      };
      plants = placeUnderstory(this.theme, real, { blocked, clear, density: this.detail.understory });
      for (const p of plants) {
        const row = world.under[p.row];
        const name = row.species || UNDER_MODELS[p.plant];
        const set = models.get(name);
        if (!set) continue;
        const v = Math.min(set.length - 1, Math.floor(p.u * set.length)), m = set[v].meta;
        const sc = p.size / m.top;
        const big = m.kind !== 'under';
        put(`${name}:${v}:u${p.row}`, { x: p.x, y: p.y, model: set[v], w: sc * (0.92 + 0.16 * hash2(p.x, p.y, 3)), ht: sc, heightM: p.size, leaf: row.leaf, accent: row.accent || row.leaf, u: p.u, v: hash2(p.x, p.y, 5), rot: p.rot, under: { big, sapling: p.plant === 'sapling', rock: p.plant === 'rock' } });
      }
    }
    this.plants = plants.length;

    // ---- one batch a model: its instances composed once, four buckets of instanced meshes
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color(), ca = new THREE.Color();
    const maxLod = this.detail.maxLod;
    for (const [key, list] of lists) {
      const model = list[0].model, meta = model.meta, n = list.length, under = list[0].under;
      const mats = new Float32Array(n * 16), cols = new Float32Array(n * 3), inst = new Float32Array(n * 4), fxa = new Float32Array(n * 4), centers = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        const t = list[i];
        const h = hAt(t.x, t.y);
        q.setFromAxisAngle(up, t.rot);
        sc.set(t.w, t.ht, t.w);
        const p = V(t.x, t.y, h - (under ? 0.04 + 0.05 * t.heightM : 0.12));   // sunk a little: no daylight under the downhill side
        m4.compose(p, q, sc);
        m4.toArray(mats, i * 16);
        // per-tree colour: brightness and a little hue drift (sun-scorched / lush)
        const b = 0.86 + 0.26 * t.u, warm = (t.v - 0.5) * 0.12;
        const lp = under && under.rock ? c.set(t.leaf).toArray() : leafPaint(t.leaf, world.fx?.leaf);
        cols[i * 3] = lp[0] * b * (1 + warm); cols[i * 3 + 1] = lp[1] * b; cols[i * 3 + 2] = lp[2] * b * (1 - warm * 1.3);
        ca.set(t.accent);
        inst[i * 4] = ca.r; inst[i * 4 + 1] = ca.g; inst[i * 4 + 2] = ca.b; inst[i * 4 + 3] = t.heightM;
        fxa[i * 4 + 3] = t.u;
        centers[i * 4] = p.x; centers[i * 4 + 1] = p.y + meta.top * 0.5 * t.ht; centers[i * 4 + 2] = p.z;
        centers[i * 4 + 3] = Math.max(meta.top * 0.6 * t.ht, meta.crownR * t.w) + 2;
      }
      // which geometry and which forced keep each bucket draws: [near, mid, far, see-through]
      let geo = [Math.max(0, maxLod), Math.max(1, maxLod), 2, Math.max(0, maxLod)], keepOv = [0, 0, 0, 0], cfg = null;
      if (maxLod >= 1) keepOv[0] = keepOv[3] = this.shared.uLod.value.z;   // the cheap trees: the mid model's cards, grown, even up close
      if (under) {
        const drawM = this.detail.underDrawM * (under.big ? 1.5 : 1) * Math.min(1.6, 0.7 + list[0].heightM * 0.25);
        cfg = { nearM: under.big ? 55 : drawM, midM: drawM, cullM: drawM, fade0: drawM * 0.8 };
        if (under.sapling) { geo = [2, 2, 2, 2]; keepOv = [0.15, 0.15, 0.15, 0.15]; cfg.nearM = drawM; }
        else if (under.big) { geo = [0, 1, 1, 0]; keepOv = [1, 0.42, 0.42, 1]; }
        else { geo = [0, 0, 0, 0]; keepOv = [1, 1, 1, 1]; }
      }
      const buckets = [0, 1, 2, 3].map((b) => {
        const g = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(model.attrs)) g.setAttribute(name, attr);
        g.setIndex(model.index[geo[b]]);
        const iInst = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4), iFx = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
        iInst.setUsage(THREE.DynamicDrawUsage); iFx.setUsage(THREE.DynamicDrawUsage);
        g.setAttribute('aInst', iInst); g.setAttribute('aFx', iFx);
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
        const im = new THREE.InstancedMesh(g, b === 3 ? ghostMat : mat, 0);
        const mat4 = new THREE.InstancedBufferAttribute(new Float32Array(n * 16), 16), col = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
        mat4.setUsage(THREE.DynamicDrawUsage); col.setUsage(THREE.DynamicDrawUsage);
        im.instanceMatrix = mat4; im.instanceColor = col;
        im.frustumCulled = false;
        im.castShadow = this.detail.shadows && (b === 0 || b === 3) && (!under || under.big);
        im.receiveShadow = true;
        im.customDepthMaterial = depthMat;
        im.name = `tree:${key}:${b}`;
        if (b === 3) this._ghosts.push(im);
        this.group.add(im);
        return { im, mat4, col, iInst, iFx, count: 0, keep: keepOv[b] };
      });
      this.variants.push({ name: key, n, H: meta.top, mats, cols, inst, fxa, centers, buckets, under: !!under, cfg });
    }

    // ---- ground darkening under every tree: one draw of soft blobs laid on the slope
    if (this.detail.blobs && blobs.length) {
      const geoP = new THREE.PlaneGeometry(1, 1);
      geoP.rotateX(-Math.PI / 2);
      const tex = blobTexture();
      const bm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: this.world.fx?.snow ? 0.6 : 0.85, color: this.world.fx?.snow ? 0x1a2a4a : 0x000000, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      const mesh = new THREE.InstancedMesh(geoP, bm, blobs.length);
      mesh.castShadow = false; mesh.receiveShadow = false; mesh.renderOrder = 1; mesh.name = 'treeShade';
      const nrm = new THREE.Vector3();
      blobs.forEach((b, i) => {
        const h = hAt(b.x, b.y);
        // lie on the slope: the ground's normal from its heights round the foot
        nrm.set(hAt(b.x - 1.5, b.y) - hAt(b.x + 1.5, b.y), 3, hAt(b.x, b.y + 1.5) - hAt(b.x, b.y - 1.5)).normalize();
        q.setFromUnitVectors(up, nrm);
        sc.set(b.d, 1, b.d);
        m4.compose(V(b.x, b.y, h + 0.06), q, sc);
        mesh.setMatrixAt(i, m4);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this._blobs = mesh;
    }
    // ---- blossom on the air
    if (this.world.fx?.petals && this.detail.petals > 0) {
      this._petals = makePetals(this.shared, this.world.fx.petals, Math.round(1100 * this.detail.petals));
      this.group.add(this._petals);
    }
    for (const im of this._ghosts) im.renderOrder = this.fadeLine ? 20 : 0;
  }

  setNearDistance(m) { this.nearM = m; this.shared.uLod.value.x = m; this._last.t = -1e9; this._fallback?.setNearDistance(m); }

  // Today's wind: where it blows TO (compass degrees) and how hard. The trees lean and
  // sway that way and the gusts run down it, so a player reads the wind off the woods.
  setWind({ mph = 0, toDeg = 0 } = {}) {
    const a = toDeg * Math.PI / 180;
    // sim (x east, y north) -> three (x, z = -y)
    this.shared.uWind.value.set(Math.sin(a), -Math.cos(a), Math.min(1, Math.max(0, mph / 25)), 0);
  }

  // v2:seeover / v3:vegetation The arcade's pass-through: the trees standing on the line of
  // the shot are drawn as ghosts (TreeField.setFadeLine has the full account; same rule).
  setFadeLine(line) {
    const key = line ? [line.x, line.z, line.d, line.len, line.camY].map((v) => Math.round(v * 2)).join(',') + `|${Math.round(Math.atan2(line.ux, line.uz) * 300)}` : '';
    if (key === this._fadeKey) return;
    this._fadeKey = key;
    this.fadeLine = line || null;
    for (const im of this._ghosts || []) im.renderOrder = line ? 20 : 0;
    this._last.t = -1e9;
    this._fallback?.setFadeLine(line);
  }

  // Re-bucket instances for this camera. Returns true when the sets were rebuilt (the
  // shadow casters may have changed).
  update(camera, timeSec = 0) {
    if (this._fallback) { this._fallback.fadeOn = this.fadeOn; return this._fallback.update(camera, timeSec); }
    this.shared.uTime.value = timeSec;
    this.shared.uLodCam.value.copy(camera.position);
    this.shared.uSunView.value.copy(this._sunDir).transformDirection(camera.matrixWorldInverse);
    if (this._petals) this._petals.material.uniforms.uPx.value = (camera.projectionMatrix.elements[5] || 1) * 540;
    if (!this.variants.length) return false;
    const dir = camera.getWorldDirection(this._tmp);
    const L = this._last;
    const now = performance.now();
    const moved = camera.position.distanceToSquared(L.pos) > 1.0 || dir.dot(L.dir) < 0.9997;
    if (!moved && now - L.t < 1000) return false;
    L.pos.copy(camera.position); L.dir.copy(dir); L.t = now;
    // widened frustum so a frame of lag never shows a pop at the screen edge
    const cc = this._cullCam;
    cc.fov = Math.min(150, camera.fov * 1.35); cc.aspect = camera.aspect; cc.near = camera.near; cc.far = FAR_CULL_M;
    cc.updateProjectionMatrix();
    this._frustum.setFromProjectionMatrix(this._pm.multiplyMatrices(cc.projectionMatrix, camera.matrixWorldInverse));
    const planes = this._frustum.planes;
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const vm = camera.matrixWorldInverse.elements;
    const fadeOn = this.fadeOn;
    const fl = fadeOn ? this.fadeLine : null;
    let nN = 0, nM = 0, nF = 0, nG = 0, nU = 0;
    for (const sp of this.variants) {
      const { n, mats, cols, inst, fxa, centers, buckets, H, cfg } = sp;
      const nearM = cfg ? cfg.nearM : this.nearM, midM = cfg ? cfg.midM : this.midM, cullM = cfg ? cfg.cullM : FAR_CULL_M;
      const out = [0, 0, 0, 0];
      for (let i = 0; i < n; i++) {
        const x = centers[i * 4], y = centers[i * 4 + 1], z = centers[i * 4 + 2], R = centers[i * 4 + 3];
        const dx = x - cx, dy = y - cy, dz = z - cz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > cullM) continue;
        if (d > (cfg ? 12 : KEEP_RADIUS_M)) {
          let vis = true;
          for (let k = 0; k < 6; k++) {
            const pl = planes[k];
            if (pl.normal.x * x + pl.normal.y * y + pl.normal.z * z + pl.constant < -R) { vis = false; break; }
          }
          if (!vis) continue;
        }
        let lod = d < nearM ? 0 : d < midM ? 1 : 2;
        const o = i * 16;
        if (lod === 0 && fl) {
          // v2:seeover along the line of the shot: from the camera to len past it, wherever the camera looks
          const ax = mats[o + 12] - fl.x, az = mats[o + 14] - fl.z;
          const al = ax * fl.ux + az * fl.uz;
          if (al > -FADE_HUG_M && al < fl.len + 15) {
            const treeH = Math.hypot(mats[o + 4], mats[o + 5], mats[o + 6]) * H;
            const a = Math.min(Math.max(al, 0), fl.len);
            const sight = a <= fl.d ? fl.camY + (fl.ballY - fl.camY) * (a / Math.max(1e-6, fl.d)) : fl.camY + (fl.endY - fl.camY) * (a / fl.len);
            // on the line (a crown wide, a little wider with distance), or hugging the camera wherever it looks
            const lat = Math.abs(ax * fl.uz - az * fl.ux);
            const near = Math.hypot(ax, az) < FADE_HUG_M * 0.85 && al > -(0.3 * treeH + 1) && mats[o + 13] + treeH > fl.camY - 3;
            if (near || (al > -1 && al < fl.len && mats[o + 13] + treeH > sight - 0.5 && lat < 0.3 * treeH + 1.2 + 0.03 * al)) lod = 3;
          }
        } else if (lod === 0 && fadeOn && d < FADE_NEAR_M + 30) {
          // the tree's foot in view space, and its height from the instance's y scale
          const fx = mats[o + 12], fy = mats[o + 13], fz = mats[o + 14];
          const vx = vm[0] * fx + vm[4] * fy + vm[8] * fz + vm[12];
          const vz = vm[2] * fx + vm[6] * fy + vm[10] * fz + vm[14];
          const treeH = Math.hypot(mats[o + 4], mats[o + 5], mats[o + 6]) * H;
          if (treeFade(vx, vz, treeH) > FADE_AT) lod = 3;
        }
        const b = buckets[lod], j = out[lod]++;
        b.mat4.array.set(mats.subarray(o, o + 16), j * 16);
        b.col.array.set(cols.subarray(i * 3, i * 3 + 3), j * 3);
        const ia = b.iInst.array, fa = b.iFx.array;
        ia[j * 4] = inst[i * 4]; ia[j * 4 + 1] = inst[i * 4 + 1]; ia[j * 4 + 2] = inst[i * 4 + 2]; ia[j * 4 + 3] = inst[i * 4 + 3];
        fa[j * 4] = b.keep; fa[j * 4 + 1] = cfg ? cfg.fade0 : 0; fa[j * 4 + 2] = cfg ? cfg.cullM : 0; fa[j * 4 + 3] = fxa[i * 4 + 3];
      }
      buckets.forEach((b, lod) => {
        b.count = out[lod];
        b.im.count = out[lod];
        if (out[lod]) {
          for (const [attr, size] of [[b.mat4, 16], [b.col, 3], [b.iInst, 4], [b.iFx, 4]]) { attr.clearUpdateRanges(); attr.addUpdateRange(0, out[lod] * size); attr.needsUpdate = true; }
        }
      });
      if (sp.under) nU += out[0] + out[1] + out[2] + out[3];
      else { nN += out[0]; nM += out[1]; nF += out[2]; nG += out[3]; }
    }
    this.stats = { near: nN, mid: nM, far: nF, seeThrough: nG, under: nU };
    return true;
  }

  dispose() {
    this._fallback?.dispose();
    for (const m of this._materials || []) m.dispose();
    for (const sp of this.variants) for (const b of sp.buckets) b.im.geometry.dispose();
    if (this._blobs) { this._blobs.geometry.dispose(); this._blobs.material.map?.dispose(); this._blobs.material.dispose(); }
    if (this._petals) { this._petals.geometry.dispose(); this._petals.material.dispose(); }
  }
}
