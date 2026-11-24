// v3:environment The world round an arcade stage: its sky and everything past the course.
//
// A stage's sky is a PANORAMA made for its theme and time of day (public/arcade/env/sky,
// listed with checksums in public/arcade/env/manifest.json; tools/arcade-art/env builds
// them): a band from 15 degrees under the horizon to 75 above it, all the way round. This
// file draws it on a dome at infinity and gives the scene everything a sky photo gave it
// (env.js loadHDRIEnvironment's result): the image-based light and the reflections come
// from a small radiance map built from the same picture, the sun's bearing and height from
// where the sun is IN the picture, the haze colour from its horizon. So light, shadows,
// reflections and fog cannot disagree with the sky the player sees.
//
// Over the panorama, in the same draw:
//   - up to three FAR LAYERS (arcade-look.js sky.far): mountain ranges, islands, a skyline,
//     dunes, sea stacks, volcano cones. Each is a silhouette standing on a circle round the
//     course at its own distance (1.5 to 12 km), so they slide against each other and
//     against the sky as the camera travels down a hole: parallax, with no geometry;
//   - a sheet of drifting cloud at a fixed height, moving with the hole's wind;
//   - the sun's glare (brighter than a picture can hold, so it blooms), and a slow billow
//     that keeps the painted clouds (or an aurora) alive.
// Nothing here runs in the real look, and a stage without a panorama keeps its sky photo or
// painted sky exactly as before.
import * as THREE from 'three';
import { skyDirection, prefilterEnvironment } from './arcade-sky.js';

export const ENV_BASE = '/arcade/env/';
export const FAR_LAYER_TYPES = Object.freeze({ mountains: 0, islands: 1, skyline: 2, dunes: 3, stacks: 4, cones: 5, mesas: 6 });
export const MAX_FAR_LAYERS = 3;
const RAD = Math.PI / 180;

let manifestPromise = null;
/** public/arcade/env/manifest.json, fetched once. Rejects when it cannot be had. */
export function loadEnvManifest(base = ENV_BASE) {
  if (!manifestPromise) {
    manifestPromise = fetch(`${base}manifest.json`).then((r) => { if (!r.ok) throw new Error(`env manifest ${r.status}`); return r.json(); })
      .catch((e) => { manifestPromise = null; throw e; });
  }
  return manifestPromise;
}

/**
 * Where the key light stands for a panorama: its sun's (or moon's) own bearing, and its own
 * height held inside [minAltDeg, maxAltDeg] so shadows stay readable (a sun sitting on the
 * horizon would light nothing). Pure. -> { azDeg, altDeg, skyAltDeg, x, y, z }
 */
export function panoSun(entry, { minAltDeg = 12, maxAltDeg = 64, azDeg = 215, altDeg = 40 } = {}) {
  const s = entry && entry.sun;
  const az = s ? s.azDeg : azDeg, skyAlt = s ? s.altDeg : altDeg;
  const alt = Math.min(maxAltDeg, Math.max(minAltDeg, skyAlt));
  return { azDeg: az, altDeg: alt, skyAltDeg: skyAlt, ...skyDirection(az, alt) };
}

/** A far layer's numbers as the dome shader takes them (pure; unit-tested). */
export function packFarLayer(layer = {}) {
  const type = FAR_LAYER_TYPES[layer.type] ?? 0;
  const c = (hexStr, d) => new THREE.Color(hexStr ?? d);
  return {
    a: [Math.max(300, layer.distM ?? 4000), layer.baseM ?? 0, Math.max(1, layer.heightM ?? 400), layer.freq ?? 6],
    b: [layer.seed ?? 1, type, Math.min(1, Math.max(0, layer.haze ?? 0.5)), Math.min(1, Math.max(0, layer.opacity ?? 1))],
    low: c(layer.color, '#5d7f9c'), high: c(layer.top ?? layer.color, '#ffffff'),
    e: [layer.snowline ?? 2, layer.glow ?? 0, layer.cover ?? 0.5, layer.detail ?? 1],
  };
}

function noiseTexture() {
  const N = 256, data = new Uint8Array(N * N * 4);
  let h = 0x9e3779b9;
  for (let i = 0; i < data.length; i++) { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; data[i] = (h >>> 0) & 255; }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

const DOME_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
    gl_Position = p.xyww;   // at the far plane: only the pixels nothing else covered are shaded
  }`;

// (v3:env-polish the far layers and the cloud sheet are one function, farWorld(), shared by the dome
// and by the small picture of the sky the water mirrors: MIRROR_FRAG below)
const FAR_GLSL = /* glsl */`
  #define TAU 6.28318530718
  uniform sampler2D uPano, uNoise, uHaze;
  uniform vec2 uBand;            // the panorama's band of elevation (radians): bottom, top
  uniform float uGain, uTime, uPixel;
  uniform vec4 uBillow;          // amplitude (uv), speed, from elevation (rad), to elevation (rad)
  uniform vec3 uSunDir, uSunCol; // the sun as the picture has it; its glare
  uniform vec3 uGlare;           // core strength, halo strength, 0
  uniform vec3 uCenter;          // the course's centre (world)
  uniform vec4 uLA[${MAX_FAR_LAYERS}], uLB[${MAX_FAR_LAYERS}], uLE[${MAX_FAR_LAYERS}];
  uniform vec3 uLC[${MAX_FAR_LAYERS}], uLD[${MAX_FAR_LAYERS}];
  uniform vec4 uCloud;           // cover, opacity, height (m), 1 / feature size (m)
  uniform vec3 uCloudCol, uCloudShade;
  uniform vec2 uCloudOff;        // the sheet's drift (in features)
  uniform vec3 uFlash;           // a theme's far glow breathing on the horizon (volcano): rgb strength

  float nz(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return textureLod(uNoise, (i + f + 0.5) / 256.0, 0.0).r;
  }
  float fbm(vec2 p) { return 0.5 * nz(p) + 0.25 * nz(p * 2.03 + 17.1) + 0.125 * nz(p * 4.01 + 31.7) + 0.0625 * nz(p * 8.1 + 5.3); }
  float hash1(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
  vec3 hazeAt(float az) { return textureLod(uHaze, vec2(az / TAU + 0.03125, 0.5), 0.0).rgb; }   // (explicit level: it is read inside the layers' loop)

  // The ridge line of a layer at a point of its circle: p on the unit circle (so it joins
  // up all the way round), ang the same place as an angle 0..1. Returns its height 0..1.
  // (One way out, at the bottom: with a return in each branch Direct3D's compiler warned
  // "use of potentially uninitialized variable" on every start, and three prints that.)
  float ridge(int type, vec2 p, float ang, vec4 A, vec4 B, vec4 E, out float cell, out float fx) {
    cell = 0.0; fx = 0.5;
    float prof = 0.0;
    vec2 q = p * A.w + B.x * 7.31;
    if (type == 0) {          // mountains: a jagged range, never a gap
      float n = fbm(q), r = 1.0 - abs(2.0 * nz(q * 2.7 + 3.3) - 1.0);
      float fine = 1.0 - abs(2.0 * nz(q * 9.0 + 1.1) - 1.0);
      prof = clamp(0.18 + 0.62 * n + 0.34 * r * n + 0.07 * fine * E.w, 0.0, 1.2);
    } else if (type == 1) {   // islands: humps with open sea between them
      float n = fbm(q);
      float k = smoothstep(1.0 - E.z, 1.0 - E.z + 0.3, n + 0.25 * nz(q * 0.37 + 9.0));
      prof = k * (0.35 + 0.65 * nz(q * 3.1 + 2.0)) * (0.8 + 0.2 * nz(q * 11.0));
    } else if (type == 3) {   // dunes: long soft backs, a sharp crest here and there
      float n = fbm(q * vec2(1.0, 1.0));
      float crest = 1.0 - abs(2.0 * nz(q * 1.7 + 4.0) - 1.0);
      prof = 0.22 + 0.5 * n + 0.28 * crest * crest;
    } else if (type == 6) {   // mesas: flat tops, a cap of cliff over a skirt of scree, a butte here and there
      float n = fbm(q * 0.8);
      float skirt = smoothstep(0.3, 0.46, n) * 0.34;                       // the talus: a long slope up to the wall
      float wall = smoothstep(0.455, 0.475, n) * 0.36;                     // the cliff itself, near sheer
      float step2 = smoothstep(0.585, 0.6, n) * 0.26;                      // a second tier on the big ones
      float notch = 0.035 * nz(q * 9.0) + 0.02 * nz(q * 23.0);             // a broken rim, gullies
      prof = 0.07 + skirt + wall * (0.94 + notch) + step2;
    } else {
      // the cell kinds (a skyline, sea stacks, volcano cones) count round the circle
      float n = max(3.0, floor(A.w));
      float c = ang * n;
      cell = floor(c); fx = fract(c);
      float r1 = hash1(cell + B.x * 13.0), r2 = hash1(cell * 1.7 + B.x * 29.0 + 4.0);
      if (type == 2) {        // skyline: towers of every height, a few gaps
        float w = 0.5 - 0.42 * (0.55 + 0.45 * r2);
        float inX = smoothstep(w - uPixel * n, w + uPixel * n, fx) * smoothstep(w - uPixel * n, w + uPixel * n, 1.0 - fx);
        float h = mix(0.22, 1.0, r1 * r1) * step(0.12, r2);
        // a setback: the top third is narrower
        float w2 = w + 0.14 * step(0.5, hash1(cell + 7.0));
        float inTop = smoothstep(w2 - uPixel * n, w2 + uPixel * n, fx) * smoothstep(w2 - uPixel * n, w2 + uPixel * n, 1.0 - fx);
        prof = max(h * 0.72 * inX, h * inTop);
      } else if (type == 4) { // sea stacks: lone leaning pillars
        float on = step(1.0 - E.z, r2);
        float x = (fx - 0.5) / (0.1 + 0.16 * r1);
        float body = clamp(1.0 - x * x, 0.0, 1.0);
        prof = on * pow(body, 0.35) * (0.45 + 0.55 * r1) * (0.85 + 0.3 * nz(vec2(ang * n * 9.0, B.x)));
      } else {                // cones: volcanoes with a notched crater
        float on = step(1.0 - E.z, r2);
        float x = abs(fx - 0.5) / (0.3 + 0.18 * r1);
        float cone = clamp(1.0 - pow(x, 0.8), 0.0, 1.0);
        cone = min(cone, 0.82 + 0.1 * nz(vec2(ang * n * 14.0, 3.0)));   // the top blown off
        prof = on * cone * (0.5 + 0.5 * r1);
      }
    }
    return prof;
  }

  // The cloud sheet and the far layers over a sky colour (col), seen from cam along d
  // (az: its bearing). k: x their colours (1 on the dome; the water's sky is in the
  // light's own scale). px: the angle a pixel covers.
  vec3 farWorld(vec3 col, vec3 d, vec3 cam, float az, float k, float px) {
    // drifting cloud: a sheet at one height, sliding with the wind
    if (uCloud.x > 0.0 && d.y > 0.035) {
      vec2 cp = (cam.xz + d.xz * ((uCloud.z - cam.y) / d.y)) * uCloud.w + uCloudOff;
      float n = fbm(cp * vec2(1.0, 0.62)) + 0.25 * (nz(cp * 5.3 + 7.0) - 0.5);
      float cov = smoothstep(1.0 - uCloud.x, 1.0 - uCloud.x + 0.3, n) * smoothstep(0.035, 0.22, d.y);
      float lit = 0.5 + 0.5 * (nz(cp * 2.1 + 3.0 + uSunDir.xz * 0.35) - nz(cp * 2.1 + 3.0));
      col = mix(col, mix(uCloudShade, uCloudCol, clamp(0.35 + 1.6 * lit, 0.0, 1.0)) * k, cov * uCloud.y);
    }

    // the far layers, farthest first
    vec2 ro = cam.xz - uCenter.xz;
    vec2 rd = d.xz;
    float qa = max(dot(rd, rd), 1e-6), qb = dot(ro, rd);
    for (int i = 0; i < ${MAX_FAR_LAYERS}; i++) {
      vec4 A = uLA[i], B = uLB[i], E = uLE[i];
      if (B.w <= 0.0) continue;
      float qc = dot(ro, ro) - A.x * A.x;
      float t = (-qb + sqrt(max(qb * qb - qa * qc, 0.0))) / qa;
      vec3 hit = cam + d * t;
      vec2 onC = (hit.xz - uCenter.xz) / A.x;
      float ang = atan(onC.x, -onC.y) / TAU + 0.5;
      float cell, fx;
      int type = int(B.y + 0.5);
      float prof = ridge(type, onC, ang, A, B, E, cell, fx);
      float top = prof * A.z;
      float h = hit.y - A.y;
      // one pixel of height at that distance: the edge is a pixel wide at any range
      float aa = max(px * t * 1.2, 0.05);
      float inside = (1.0 - smoothstep(-aa, aa, h - top)) * smoothstep(0.0, 0.02, prof);
      if (inside <= 0.0) continue;
      float kk = clamp(h / max(top, 1.0), 0.0, 1.0);         // 0 at its foot, 1 on the ridge line
      float grain = nz(vec2(ang * A.w * 40.0 + h * 0.004, h * (3.0 / A.z) + B.x));
      vec3 c = uLC[i] * (0.82 + 0.36 * grain);
      if (type == 0 || type == 5) {
        // snow (or a cone's glow) from a line up the range, ragged
        float line = E.x + 0.12 * (nz(vec2(ang * A.w * 12.0, B.x * 3.0)) - 0.5);
        float capK = smoothstep(line - 0.04, line + 0.04, h / A.z);
        if (type == 0) c = mix(c, uLD[i] * (0.86 + 0.28 * grain), capK);
        else c += uLD[i] * E.y * (smoothstep(0.86, 1.0, kk) * 1.5 + 0.5 * step(0.94, nz(vec2(fx * 30.0 + cell, h * 0.002 - uTime * 0.02))) * smoothstep(0.35, 0.9, kk));
      } else if (type == 2) {
        // lit windows, floor by floor; a beacon on the tallest
        float cols = 5.0 + floor(hash1(cell + 3.0) * 5.0), floorM = A.z / 34.0;
        vec2 wv = vec2(fx * cols, h / floorM);
        float lit = step(0.52, hash1(floor(wv.x) * 7.0 + floor(wv.y) * 13.0 + cell * 31.0));
        float pane = smoothstep(0.12, 0.3, fract(wv.x)) * smoothstep(0.12, 0.3, 1.0 - fract(wv.x)) * smoothstep(0.2, 0.4, fract(wv.y)) * smoothstep(0.15, 0.35, 1.0 - fract(wv.y));
        float fade = 1.0 - smoothstep(0.0, 2.5, px * t / floorM);   // windows blur into a glow when they are under a pixel
        vec3 tint = mix(uLD[i], uLD[i].bgr, step(0.6, hash1(cell * 3.3 + floor(wv.y) * 0.37)));
        c += tint * E.y * (lit * pane * fade + 0.22 * (1.0 - fade)) * smoothstep(0.02, 0.1, kk);
        c += vec3(1.0, 0.15, 0.1) * E.y * 2.0 * smoothstep(0.985, 1.0, kk) * step(0.8, hash1(cell + 1.0)) * (0.5 + 0.5 * sin(uTime * 2.0 + cell));
      } else if (type == 6) {
        // a mesa: thin level beds, lighter toward the rim, gullies down the wall, and the
        // side turned from the sun in shade (so it has a form, not a striped box's flat face)
        float beds = nz(vec2(h * (11.0 / A.z) + B.x * 5.0, 0.0)), gully = nz(vec2(ang * A.w * 95.0, h * (1.3 / A.z)));
        float away = 0.5 + 0.5 * dot(normalize(vec2(onC.x, onC.y)), normalize(uSunDir.xz + 1e-4));   // 1 where the sun is behind the wall
        c = mix(uLC[i], uLD[i], 0.3 + 0.5 * smoothstep(0.25, 1.0, kk)) * (0.86 + 0.22 * beds) * (0.9 + 0.16 * gully) * mix(1.06, 0.78, smoothstep(0.35, 0.85, away));
      } else {
        c = mix(c, uLD[i] * (0.86 + 0.28 * grain), smoothstep(0.35, 1.0, kk) * 0.6);   // a lighter crown: the sun on the tops
      }
      // haze: thick at its foot, thinner up the face, so each range stands off the next
      float hz = clamp(B.z + (1.0 - B.z) * 0.6 * exp(-max(h, 0.0) / (0.3 * A.z)), 0.0, 1.0);
      vec3 hazeCol = hazeAt(az) * uGain;
      c = mix(c, hazeCol, hz * (type == 2 ? 0.7 : 1.0));
      col = mix(col, c * k, inside * B.w);
    }
    return col;
  }`;

const DOME_FRAG = /* glsl */`
  varying vec3 vDir;
  #include <common>
  ${FAR_GLSL}
  void main() {
    vec3 d = normalize(vDir);
    float el = asin(clamp(d.y, -1.0, 1.0));
    float az = atan(d.x, -d.z);                       // 0 north, east positive
    vec2 uv = vec2(az / TAU + 0.5, (el - uBand.x) / (uBand.y - uBand.x));
    // the picture's own gradients, taken across the seam due south without a jump
    vec2 gx = dFdx(uv), gy = dFdy(uv);
    gx.x = fract(gx.x + 0.5) - 0.5; gy.x = fract(gy.x + 0.5) - 0.5;
    // a slow billow in the clouds (none near the horizon, where the far world stands still)
    float sunCos = dot(d, uSunDir);
    float bk = uBillow.x * smoothstep(uBillow.z, uBillow.w, el) * (1.0 - smoothstep(0.985, 0.999, sunCos));
    float bt = uTime * uBillow.y;
    vec2 wob = vec2(sin(az * 7.0 + el * 9.0 + bt) + 0.6 * sin(az * 13.0 - el * 5.0 - bt * 0.7), cos(az * 5.0 + el * 11.0 - bt * 0.8) + 0.6 * sin(az * 11.0 + bt * 0.5));
    uv += bk * wob * vec2(1.0, 4.0);
    uv.y = clamp(uv.y, 0.001, 0.999);
    vec3 col = textureGrad(uPano, uv, gx, gy).rgb * uGain;

    // the sun's glare: what a picture cannot hold
    if (uGlare.x + uGlare.y > 0.0) {
      float s = max(sunCos, 0.0);
      col += uSunCol * (uGlare.x * smoothstep(0.99965, 0.99992, s) + uGlare.y * (pow(s, 600.0) + 0.05 * pow(s, 50.0)));
    }
    // a far glow that breathes along the horizon (a volcano's eruptions lighting the ash)
    if (uFlash.r + uFlash.g + uFlash.b > 0.0) {
      float pulse = 0.5 + 0.5 * sin(uTime * 0.6 + 3.0 * nz(vec2(az * 3.0, uTime * 0.11)));
      float where = smoothstep(0.55, 0.9, nz(vec2(az * 2.2 + 5.0, floor(uTime * 0.07) * 3.7)));
      col += uFlash * pulse * where * exp(-max(el, 0.0) * 9.0) * step(-0.02, el);
    }

    col = farWorld(col, d, cameraPosition, az, 1.0, uPixel);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// v3:env-polish THE SKY THE WATER MIRRORS. The sea and the ponds without a live mirror reflect a small
// equirect picture of the sky (water.js uSky); it used to be the light's own radiance map,
// which has the panorama in it but none of what this file draws over it, so an island on
// the horizon had no reflection. This redraws that map with the cloud sheet and the far
// layers laid on, as they stand seen from the middle of the course: one 1024 x 512 draw
// when a sky is shown or a course is loaded, never per frame. uBase: the radiance map;
// uMirrorK: the layers' colours brought from the screen's scale to the light's.
const MIRROR_VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const MIRROR_FRAG = /* glsl */`
  ${FAR_GLSL}
  uniform sampler2D uBase;
  uniform float uMirrorK;
  varying vec2 vUv;
  void main() {
    // three's equirect layout (common.glsl equirectUv), turned round: u = atan(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5
    float phi = (vUv.x - 0.5) * TAU, th = (vUv.y - 0.5) * 3.14159265359;
    vec3 d = vec3(cos(phi) * cos(th), sin(th), sin(phi) * cos(th));
    vec3 col = texture2D(uBase, vUv).rgb;
    if (d.y > -0.02) col = farWorld(col, d, uCenter + vec3(0.0, 2.0, 0.0), atan(d.x, -d.z), uMirrorK, 0.0061);
    gl_FragColor = vec4(col, 1.0);
  }`;

export class FarWorld {
  constructor({ renderer, scene }) {
    this.renderer = renderer;
    this.scene = scene;
    this.active = null;       // the manifest id of the sky showing, or null
    this.ready = true;        // false while a sky is loading (capture tools wait on it)
    this._noise = noiseTexture();
    this._haze = new THREE.DataTexture(new Uint8Array(16 * 4).fill(128), 16, 1, THREE.RGBAFormat);
    this._haze.colorSpace = THREE.SRGBColorSpace;
    this._haze.wrapS = THREE.RepeatWrapping;
    this._haze.magFilter = this._haze.minFilter = THREE.LinearFilter;
    this._haze.needsUpdate = true;
    const zero4 = () => Array.from({ length: MAX_FAR_LAYERS }, () => new THREE.Vector4());
    const zero3 = () => Array.from({ length: MAX_FAR_LAYERS }, () => new THREE.Color(0, 0, 0));
    this.uniforms = {
      uPano: { value: null }, uNoise: { value: this._noise }, uHaze: { value: this._haze },
      uBand: { value: new THREE.Vector2(-15 * RAD, 75 * RAD) },
      uGain: { value: 1 }, uTime: { value: 0 }, uPixel: { value: 0.001 },
      uBillow: { value: new THREE.Vector4(0, 0.05, 3 * RAD, 16 * RAD) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uGlare: { value: new THREE.Vector3() },
      uCenter: { value: new THREE.Vector3() },
      uLA: { value: zero4() }, uLB: { value: zero4() }, uLE: { value: zero4() }, uLC: { value: zero3() }, uLD: { value: zero3() },
      uCloud: { value: new THREE.Vector4(0, 0, 2400, 1 / 2600) }, uCloudCol: { value: new THREE.Color(1, 1, 1) }, uCloudShade: { value: new THREE.Color(0.6, 0.65, 0.75) },
      uCloudOff: { value: new THREE.Vector2() }, uFlash: { value: new THREE.Color(0, 0, 0) },
    };
    const mat = new THREE.ShaderMaterial({ name: 'FarWorldDome', uniforms: this.uniforms, vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), mat);
    this.mesh.name = 'farWorld';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 900;        // after the opaque world: early-z leaves it the sky's pixels only
    this.mesh.userData.noAO = true;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this._cloudDrift = new THREE.Vector2();
    this._lastT = 0;
    // v3:env-polish the sky as the water mirrors it (MIRROR_FRAG): made on first use
    this.mirror = null;
    this._mirror = null;
  }

  // The water's picture of the sky, redrawn: the light's radiance map `base` with the cloud
  // sheet and the far layers over it. Returns the texture to hand the water (the same one
  // every time: a later bake only changes what is in it), or null when it cannot be made.
  _bakeMirror(base = this._mirrorBase, k = this._mirrorK) {
    if (!base || !this.renderer?.setRenderTarget) return null;
    this._mirrorBase = base; this._mirrorK = k ?? 1;
    try {
      if (!this._mirror) {
        const target = new THREE.WebGLRenderTarget(1024, 512, { type: THREE.HalfFloatType, depthBuffer: false });
        target.texture.name = 'farWorldMirror';
        target.texture.wrapS = THREE.RepeatWrapping;
        target.texture.minFilter = target.texture.magFilter = THREE.LinearFilter;
        target.texture.generateMipmaps = false;
        target.texture.mapping = THREE.EquirectangularReflectionMapping;
        const mat = new THREE.ShaderMaterial({ name: 'FarWorldMirror', uniforms: { ...this.uniforms, uBase: { value: null }, uMirrorK: { value: 1 } }, vertexShader: MIRROR_VERT, fragmentShader: MIRROR_FRAG, depthTest: false, depthWrite: false, toneMapped: false });
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
        quad.frustumCulled = false;
        const scene = new THREE.Scene();
        scene.add(quad);
        this._mirror = { target, mat, quad, scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
        this.mirror = target.texture;
      }
      const m = this._mirror, r = this.renderer;
      m.mat.uniforms.uBase.value = base;
      m.mat.uniforms.uMirrorK.value = this._mirrorK;
      const prev = r.getRenderTarget(), xr = r.xr.enabled;
      r.xr.enabled = false;
      r.setRenderTarget(m.target);
      r.render(m.scene, m.camera);
      r.setRenderTarget(prev);
      r.xr.enabled = xr;
      return this.mirror;
    } catch (e) {
      console.warn(`[env] the water's sky could not be drawn (${e?.message || e}); it mirrors the plain panorama`);
      return null;
    }
  }

  /**
   * Load the panorama `id` and build what the scene lights by. Nothing on screen changes
   * until the returned show() is called (a newer sky may have been asked for meanwhile).
   * opts: { sun: panoSun's options, maxWidth, envLuma, envSun, ground: '#hex' }
   * -> { envTexture, equirect, sunDir, horizonColor, horizonLinear, entry, show() }
   */
  async load(id, opts = {}) {
    this.ready = false;
    try {
      const manifest = await loadEnvManifest();
      const entry = manifest.skies && manifest.skies[id];
      if (!entry) throw new Error(`no sky "${id}" in the env manifest`);
      const res = await fetch(ENV_BASE + entry.file);
      if (!res.ok) throw new Error(`sky ${entry.file}: ${res.status}`);
      const blob = await res.blob();
      const cap = Math.min(opts.maxWidth || 8192, this.renderer.capabilities.maxTextureSize);
      const resize = entry.width > cap ? { resizeWidth: cap, resizeHeight: Math.round((cap * entry.height) / entry.width), resizeQuality: 'high' } : {};
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none', ...resize });
      const pano = new THREE.Texture(bitmap);
      pano.colorSpace = THREE.SRGBColorSpace;
      pano.wrapS = THREE.RepeatWrapping; pano.wrapT = THREE.ClampToEdgeWrapping;
      pano.generateMipmaps = true; pano.minFilter = THREE.LinearMipmapLinearFilter; pano.magFilter = THREE.LinearFilter;
      pano.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
      pano.flipY = false;
      pano.needsUpdate = true;
      const sun = panoSun(entry, opts.sun);
      const env = buildPanoEnvironment(this.renderer, bitmap, entry, { ...opts, sun });
      const show = (style = {}) => { this._show(id, entry, pano, sun, style); return this._bakeMirror(env.equirect, env.envScale / Math.max(1e-3, style.gain ?? 1)); };   // v3:env-polish -> the water's sky
      return { ...env, sunDir: new THREE.Vector3(sun.x, sun.y, sun.z).normalize(), entry, sun, show, dispose: () => { pano.dispose(); bitmap.close?.(); } };
    } finally { this.ready = true; }
  }

  // style: arcade-look.js sky.pano ({ gain, glare, billow, clouds, flash }) and sky.far (the layers)
  _show(id, entry, pano, sun, { gain = 1, glare = null, billow = null, clouds = null, flash = null, far = [], center = null } = {}) {
    const u = this.uniforms;
    u.uPano.value?.dispose?.();
    u.uPano.value = pano;
    u.uBand.value.set(entry.band[0] * RAD, entry.band[1] * RAD);
    u.uGain.value = gain;
    const sd = skyDirection(sun.azDeg, sun.skyAltDeg);
    u.uSunDir.value.set(sd.x, sd.y, sd.z).normalize();
    u.uSunCol.value.set(glare?.color ?? entry.sun?.color ?? '#ffffff');
    u.uGlare.value.set(entry.sun ? (glare?.core ?? 6) : 0, entry.sun ? (glare?.halo ?? 0.6) : 0, 0);
    u.uBillow.value.set(billow?.amount ?? 0.0009, billow?.speed ?? 0.045, (billow?.fromDeg ?? 4) * RAD, (billow?.toDeg ?? 18) * RAD);
    const hz = this._haze.image.data;
    for (let s = 0; s < 16; s++) {
      const c = new THREE.Color(entry.haze?.[s] ?? entry.horizon ?? '#8899aa');
      // (set() took the hex as sRGB and made it linear: the texture wants the sRGB bytes back)
      c.convertLinearToSRGB();
      hz[s * 4] = Math.round(c.r * 255); hz[s * 4 + 1] = Math.round(c.g * 255); hz[s * 4 + 2] = Math.round(c.b * 255); hz[s * 4 + 3] = 255;
    }
    this._haze.needsUpdate = true;
    this.setFar(far, center);
    if (clouds && clouds.cover > 0) {
      u.uCloud.value.set(clouds.cover, clouds.opacity ?? 0.5, clouds.heightM ?? 2400, 1 / Math.max(200, clouds.sizeM ?? 2600));
      u.uCloudCol.value.set(clouds.color ?? '#ffffff').multiplyScalar(gain);
      u.uCloudShade.value.set(clouds.shade ?? entry.zenith ?? '#8090a8').multiplyScalar(gain);
      this._cloudSpeed = clouds.speed ?? 1;
    } else u.uCloud.value.x = 0;
    if (flash) u.uFlash.value.set(flash.color ?? '#ff5a14').multiplyScalar(flash.strength ?? 1); else u.uFlash.value.setRGB(0, 0, 0);
    this.active = id;
    this.entry = entry;
    this.mesh.visible = true;
  }

  // The far layers (arcade-look.js sky.far) and the point they stand round.
  setFar(layers = [], center = null) {
    const u = this.uniforms;
    if (center) u.uCenter.value.copy(center);
    const baseY = u.uCenter.value.y;   // the stage's low ground (its sea level): a layer's baseM is measured from it
    for (let i = 0; i < MAX_FAR_LAYERS; i++) {
      // drawn farthest first
      const L = [...(layers || [])].sort((a, b) => (b.distM ?? 0) - (a.distM ?? 0))[i];
      if (!L) { u.uLB.value[i].set(0, 0, 0, 0); continue; }
      const p = packFarLayer(L);
      u.uLA.value[i].fromArray(p.a); u.uLA.value[i].y += baseY; u.uLB.value[i].fromArray(p.b); u.uLE.value[i].fromArray(p.e);
      u.uLC.value[i].copy(p.low).multiplyScalar(u.uGain.value); u.uLD.value[i].copy(p.high).multiplyScalar(u.uGain.value);
    }
    if (this.mesh.visible && this._mirrorBase) this._bakeMirror();   // v3:env-polish the water mirrors the layers where they now stand
  }

  hide() {
    this.mesh.visible = false;
    this.active = null;
    this._mirrorBase = null;
    this.uniforms.uPano.value?.dispose?.();
    this.uniforms.uPano.value = null;
  }

  // Each frame: time, the size of a pixel, the cloud sheet's drift with the wind.
  update(camera, t, wind = null, heightPx = 1080) {
    if (!this.mesh.visible) return;
    const u = this.uniforms;
    u.uTime.value = t;
    u.uPixel.value = (2 * Math.tan((camera.fov * RAD) / 2)) / Math.max(1, heightPx);
    const dt = Math.min(0.1, Math.max(0, t - this._lastT));
    this._lastT = t;
    if (u.uCloud.value.x > 0) {
      const mph = Math.max(4, wind?.mph ?? 6), to = (wind?.toDeg ?? 90) * RAD;
      // world x east, z south: the sheet's pattern runs against the wind's heading
      const k = mph * 0.447 * 6 * (this._cloudSpeed ?? 1) * u.uCloud.value.w * dt;
      this._cloudDrift.x -= Math.sin(to) * k; this._cloudDrift.y += Math.cos(to) * k;
      u.uCloudOff.value.copy(this._cloudDrift);
    }
  }

  dispose() {
    this.hide();
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose(); this.mesh.material.dispose();
    this._noise.dispose(); this._haze.dispose();
    if (this._mirror) { this._mirror.target.dispose(); this._mirror.mat.dispose(); this._mirror.quad.geometry.dispose(); this._mirror = null; this.mirror = null; }
  }
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/**
 * The radiance map a panorama lights the scene by: a full equirect (three's own layout: row
 * 0 straight down) from the band, its zenith colour above and a ground colour below, scaled
 * so the sky's mean brightness is `envLuma`, the sun put back as a disc brighter than the
 * picture holds. band: Uint8ClampedArray RGBA of the panorama, `bw` x `bh`, row 0 its
 * BOTTOM. Pure (no three, no DOM): -> { data: Float32Array RGBA, width, height }
 */
export function panoRadiance(band, bw, bh, entry, { width = 512, height = 256, envLuma = 0.5, sun = null, envSun = 5, ground = null, envSat = 0.72, envTint = null } = {}) {
  const data = new Float32Array(width * height * 4);
  const lo = entry.band[0] * RAD, hi = entry.band[1] * RAD;
  // brightness of the sky as painted (above the horizon), for the scale
  let sum = 0, n = 0;
  const j0 = Math.floor(((0 - lo) / (hi - lo)) * bh);
  for (let j = j0; j < bh; j += 2) for (let i = 0; i < bw; i += 2) {
    const o = (j * bw + i) * 4;
    sum += 0.2126 * srgbToLinear(band[o] / 255) + 0.7152 * srgbToLinear(band[o + 1] / 255) + 0.0722 * srgbToLinear(band[o + 2] / 255); n++;
  }
  const scale = envLuma / Math.max(1e-4, sum / Math.max(1, n));
  const hexLin = (h) => { const v = parseInt(String(h).replace('#', ''), 16) || 0; return [srgbToLinear(((v >> 16) & 255) / 255), srgbToLinear(((v >> 8) & 255) / 255), srgbToLinear((v & 255) / 255)]; };
  // the ground half of the light: the picture's own (a turquoise sea, a red plain) would dye
  // every shaded wall and every yellow prop with it, so most of its colour is taken out
  const g0 = hexLin(ground ?? entry.ground ?? '#404040'), gl = 0.2126 * g0[0] + 0.7152 * g0[1] + 0.0722 * g0[2];
  const gnd = g0.map((c) => (gl + (c - gl) * 0.3) * scale * 0.55);
  // v3:env-polish a tint for the light itself (sky.pano.envTint), at the brightness it had: an ember
  // sky is all red, and red light on mown grass is mud, so a volcano's fill is pulled most of
  // the way to a cool grey (envSat) and then toward this colour
  const t0 = envTint ? hexLin(envTint) : null, tl = t0 ? Math.max(1e-4, 0.2126 * t0[0] + 0.7152 * t0[1] + 0.0722 * t0[2]) : 1;
  const tint = t0 ? t0.map((c) => c / tl) : null;
  const sd = sun ? skyDirection(sun.azDeg, sun.skyAltDeg ?? sun.altDeg) : null;
  const sunCol = sun && entry.sun?.color ? hexLin(entry.sun.color) : [1, 1, 1];
  for (let j = 0; j < height; j++) {
    const el = ((j + 0.5) / height - 0.5) * Math.PI;
    const sinEl = Math.sin(el), cosEl = Math.cos(el);
    const v = (el - lo) / (hi - lo);
    const by = Math.min(bh - 1, Math.max(0, Math.floor(v * bh)));
    const under = el < 0 ? Math.min(1, -el / (6 * RAD)) : 0;   // the ground takes over under the horizon
    for (let i = 0; i < width; i++) {
      const phi = ((i + 0.5) / width - 0.5) * 2 * Math.PI;      // three equirectUv: u = atan(z, x) / 2pi + 0.5
      const dx = Math.cos(phi) * cosEl, dz = Math.sin(phi) * cosEl;
      const az = Math.atan2(dx, -dz);
      const bx = Math.min(bw - 1, Math.max(0, Math.floor(((az / (2 * Math.PI) + 0.5) % 1) * bw)));
      const o = (by * bw + bx) * 4, p = (j * width + i) * 4;
      let r = srgbToLinear(band[o] / 255) * scale, g = srgbToLinear(band[o + 1] / 255) * scale, b = srgbToLinear(band[o + 2] / 255) * scale;
      // (a light is a little greyer than the sky it comes from: a saturated blue sky would turn warm colours green in the shade)
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = lum + (r - lum) * envSat; g = lum + (g - lum) * envSat; b = lum + (b - lum) * envSat;
      if (tint) { r *= tint[0]; g *= tint[1]; b *= tint[2]; }
      r += (gnd[0] - r) * under; g += (gnd[1] - g) * under; b += (gnd[2] - b) * under;
      if (sd && el > 0) {
        const c = dx * sd.x + sinEl * sd.y + dz * sd.z;
        const k = envSun * (Math.pow(Math.max(0, c), 900) + 0.08 * Math.pow(Math.max(0, c), 40));
        r += sunCol[0] * k; g += sunCol[1] * k; b += sunCol[2] * k;
      }
      data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 1;
    }
  }
  return { data, width, height, scale };
}

// The panorama as the scene takes a sky photo (env.js loadHDRIEnvironment's result shape).
function buildPanoEnvironment(renderer, bitmap, entry, opts) {
  const bw = 1024, bh = 256;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bw, bh) : Object.assign(document.createElement('canvas'), { width: bw, height: bh });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, bw, bh);   // the bitmap is bottom-up (flipY): row 0 is the band's bottom
  const band = ctx.getImageData(0, 0, bw, bh).data;
  const img = panoRadiance(band, bw, bh, entry, { width: 1024, height: 512, envLuma: opts.envLuma ?? 0.5, sun: opts.sun, envSun: opts.envSun ?? 5, ground: opts.ground, envSat: opts.envSat, envTint: opts.envTint });
  const equirect = new THREE.DataTexture(img.data, img.width, img.height, THREE.RGBAFormat, THREE.FloatType);
  equirect.mapping = THREE.EquirectangularReflectionMapping;
  equirect.colorSpace = THREE.LinearSRGBColorSpace;
  equirect.magFilter = equirect.minFilter = THREE.LinearFilter;
  equirect.wrapS = THREE.RepeatWrapping;
  equirect.generateMipmaps = false;
  equirect.needsUpdate = true;
  const envTexture = prefilterEnvironment(renderer, equirect);
  const hl = new THREE.Color(entry.horizon ?? '#8899aa').multiplyScalar(img.scale);
  return { envTexture, equirect, horizonColor: new THREE.Color(entry.horizon ?? '#8899aa').getHex(), horizonLinear: hl, envScale: img.scale };
}
