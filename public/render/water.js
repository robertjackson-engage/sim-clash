// Pond water. Each OSM water polygon becomes a flat plane at the pond's real water
// line, over a bed carved into the render terrain (water-shore.js), grown past the
// hand-traced outline so the bank — where it rises out of the water — draws the
// shore.
//
// High quality: the plane IS a planar mirror (three's Reflector re-renders the scene
// about the pond's level) with its own shader. A mirror re-renders the whole course,
// so only the ponds that matter most on screen (MAX_LIVE_MIRRORS, by size over
// distance) are live, refreshed in turns; the rest mirror the sky photo alone. An analytic ripple field in world XZ
// distorts the mirror and drives the sun glitter; Fresnel mixes the mirror with the
// dark water body (across a pond the trees and sky mirror; looking down you see into
// it); where the terrain depth pre-pass says the water is shallow it clears over the
// silty bed. Fog applies like any other surface.
// Low quality (no mirror): the same shader reflecting the sky photo alone.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RENDER_CONFIG } from './config.js';
import { ENV_TEX_GLSL } from './env-materials.js';   // v3:environment the ground sets (basalt, ice) the stages' lava and ice are drawn with

// GLSL: sum of directional ripples -> height gradient -> normal. Kept gentle (small
// amplitudes) so the plane reads as calm pond water, not surf. Directions fan out by
// the golden angle so no two waves align (aligned waves read as a mechanical
// crosshatch); frequencies grow by a non-integer ratio (no harmonic moire), from
// ~15 m swells down to ~1 m chop. Slow: water that moves pulls the eye off the shot.
const RIPPLE = `
  vec3 rippleNormal(vec2 p, float t, float chop) {
    vec2 g = vec2(0.0);
    float freq = 0.42, amp = 0.085, ang = 0.0;
    for (int i = 0; i < 8; i++) {
      vec2 d = vec2(cos(ang), sin(ang));
      float ph = dot(d, p) * freq + t * (0.3 + freq * 0.22);
      g += amp * freq * d * cos(ph);   // dh/dp = A * f * d * cos(phase)
      ang  += 2.39996;
      freq *= 1.53;
      amp  *= 0.62;   // fast falloff: calm water is long swells, not a lattice of chop
    }
    g *= chop;
    return normalize(vec3(-g.x, 1.0, -g.y));
  }
`;

// Self-lit water for an arcade theme (arcade-look.js water.glow), compiled in only behind
// WATER_GLOW: molten lava (a dark crust broken by slow bright veins, white-hot where they
// pool), or a night city's neon standing in black water (streaks of two colours that
// shimmer with the ripples). uArcFlow: strength, 1 / pattern size (m), speed, mode (0 lava, 1 neon).
const GLOW_GLSL = /* glsl */`
  #ifdef WATER_GLOW
  uniform vec3 uArcGlow, uArcHot, uArcCrust;
  uniform vec4 uArcFlow;
  float arcHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float arcNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(arcHash(i), arcHash(i + vec2(1.0, 0.0)), f.x), mix(arcHash(i + vec2(0.0, 1.0)), arcHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  vec3 arcGlow(vec3 col, vec2 p, vec3 N, vec3 V, float t) {
    vec2 q = p * uArcFlow.y;
    float s = t * uArcFlow.z;
    vec3 outCol = col;
    if (uArcFlow.w < 0.5) {
      float n = arcNoise(q + vec2(s, s * 0.6)) * 0.55 + arcNoise(q * 2.3 - vec2(s * 0.7, s * 1.1)) * 0.3 + arcNoise(q * 5.1 + vec2(s * 1.3, -s)) * 0.15;
      float vein = 1.0 - abs(n * 2.0 - 1.0);
      float pool = smoothstep(0.35, 0.8, arcNoise(q * 0.45 - vec2(s * 0.4, 0.0)));
      vec3 lava = mix(uArcCrust, uArcGlow, smoothstep(0.42, 0.86, vein) * (0.45 + 0.55 * pool));
      lava = mix(lava, uArcHot * 1.5, smoothstep(0.8, 0.99, vein) * (0.2 + 0.8 * pool));
      #ifdef WATER_ENV
      {
        // v3:environment a real crust: plates of the basalt set riding the flow, the melt glowing
        // through their cracks, brighter where the crust is thin. Two copies a half cycle
        // apart are cross-faded, so the crust travels without ever stretching.
        vec2 dir = vec2(0.8, 0.6);
        float ph = fract(t * uArcFlow.z * 0.5), ph2 = fract(ph + 0.5);
        vec4 c0 = envC(5.0, p / uWaterFx.w - dir * ph * 0.7), c1 = envC(5.0, p / uWaterFx.w - dir * ph2 * 0.7 + 0.43);
        vec4 cr = mix(c0, c1, abs(ph * 2.0 - 1.0));
        float thin = smoothstep(0.3, 0.85, vein) * (0.4 + 0.6 * pool);            // where the melt is near the top
        float crack = 1.0 - smoothstep(0.16 + 0.2 * thin, 0.36 + 0.3 * thin, cr.a);
        vec3 plate = uArcCrust * 2.2 * cr.rgb * (0.5 + 0.9 * cr.a);
        lava = mix(mix(plate, lava, 0.35 + 0.4 * thin), mix(uArcGlow, uArcHot * 1.6, thin * crack), crack);
      }
      #endif
      lava *= 0.86 + 0.14 * sin(t * 0.9 + n * 6.0);
      outCol = mix(col, lava, uArcFlow.x);
    } else {
      // streaks standing toward the viewer (a bearing from the camera), two colours
      float ang = atan(V.x, V.z) * 144.0 * uArcFlow.y + N.x * 2.2;
      float b = arcNoise(vec2(ang, 1.7));
      float shimmer = 0.6 + 0.4 * sin(t * (9.0 * uArcFlow.z) + p.x * 0.31 + p.y * 0.27 + N.z * 9.0);
      float graze = 0.3 + 0.7 * pow(1.0 - max(V.y, 0.0), 2.0);
      outCol = col + (uArcGlow * smoothstep(0.58, 0.85, b) + uArcHot * smoothstep(0.42, 0.15, b)) * (uArcFlow.x * shimmer * graze);
    }
    return outCol;
  }
  #endif
`;

// v3:environment WATER WORTH LOOKING AT (arcade stages, behind WATER_ENV; quality.js env.waterFx):
// caustics shimmering on a shallow bed, sparkle scattered on the ripples, the rings a ball
// leaves where it goes in, and the generated basalt and ice sets for a volcano's lava
// crust and a frozen tarn. uWaterFx: caustics, sparkle, what it is (0 water, 1 lava, 2 ice),
// the set's tile (m). uRing[i]: a splash at world (x, z), the time it landed, its strength.
const ENV_WATER_GLSL = /* glsl */`
  #ifdef WATER_ENV
  ${ENV_TEX_GLSL}
  uniform vec4 uRing[4];
  uniform vec4 uWaterFx;
  float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float wNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // the bright net light draws on a shallow bed: thin lines where three warped waves cross
  float caustics(vec2 p, float t) {
    vec2 q = p * 0.95;
    float a = sin(q.x * 1.7 + t * 0.9 + sin(q.y * 2.3 + t * 0.6) * 1.3);
    float b = sin(q.y * 1.9 - t * 0.7 + sin(q.x * 2.1 - t * 0.8) * 1.3);
    float c = sin((q.x + q.y) * 1.3 + t * 0.5 + sin((q.x - q.y) * 1.7) * 1.2);
    return pow(1.0 - abs((a + b + c) / 3.0), 7.0);
  }
  // rings spreading from where a ball went in: their brightness, and the way they tilt the surface
  float splashRings(vec2 p, float t, out vec2 push) {
    float s = 0.0; push = vec2(0.0);
    for (int i = 0; i < 4; i++) {
      float age = t - uRing[i].z;
      if (uRing[i].w <= 0.0 || age < 0.0 || age > 5.0) continue;
      vec2 dv = p - uRing[i].xy; float d = length(dv);
      float r = 0.3 + age * 1.7;
      float band = exp(-pow((d - r) / (0.1 + 0.05 * age), 2.0)) + 0.55 * exp(-pow((d - r * 0.55) / (0.08 + 0.04 * age), 2.0));
      float k = band * uRing[i].w * (1.0 - age / 5.0);
      s += k; push += dv / max(d, 1e-3) * k;
    }
    return s;
  }
  #endif
`;

// ---------------------------------------------------------------- mirror ponds
const POND_VERT = /* glsl */`
  uniform mat4 textureMatrix;
  varying vec4 vUv;
  varying vec3 vWorldPos;
  varying float vEye;
  #include <common>
  #include <fog_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vUv = textureMatrix * vec4(position, 1.0);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    vEye = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
    #include <fog_vertex>
  }`;

const POND_FRAG = /* glsl */`
  uniform vec3 color;            // mirror tint (set by Reflector)
  uniform sampler2D tDiffuse;    // the mirrored scene
  uniform float uTime, uChop, uDistort;
  uniform vec3 uSunDir, uSunColor, uDeep, uSilt;
  uniform float uDepthOn, uCamNear, uCamFar, uMirror;
  uniform sampler2D uDepthTex, uSky;
  uniform vec2 uResolution;
  #ifdef WATER_ARCADE
  uniform vec4 uArcWater;        // arcade look: reflection kept, shallows' reach (m), foam line (m), shallows' strength
  uniform vec3 uArcFoam;
  #endif
  varying vec4 vUv;
  varying vec3 vWorldPos;
  varying float vEye;
  #include <common>
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  ${RIPPLE}
  ${ENV_WATER_GLSL}
  ${GLOW_GLSL}
  void main() {
    #include <logdepthbuf_fragment>
    vec3 N = rippleNormal(vWorldPos.xz, uTime, uChop);
    vec3 V = normalize(cameraPosition - vWorldPos);
    #ifdef WATER_ENV
    vec2 ringPush; float rings = splashRings(vWorldPos.xz, uTime, ringPush);
    N = normalize(N + vec3(ringPush.x, 0.0, ringPush.y) * 0.45);
    vec4 iceT = vec4(1.0);
    if (uWaterFx.z > 1.5) {
      // ice: frosted and scratched, a dull mirror; the scratches turn the light
      iceT = envC(6.0, vWorldPos.xz / uWaterFx.w);
      vec3 iceN = envN(6.0, vWorldPos.xz / uWaterFx.w);
      N = normalize(vec3(iceN.x * 0.35, 1.0, -iceN.y * 0.35));
    }
    #endif
    // Schlick Fresnel, floored: a calm pond mirrors well above water's 2% at normal
    // incidence once the sky and banks are bright behind the viewer
    float F = mix(0.22, 1.0, 0.02 + 0.98 * pow(1.0 - max(dot(V, N), 0.0), 5.0));
    #ifdef WATER_ARCADE
    F *= uArcWater.x;   // arcade look: the water's own colour over the mirror
    #endif
    vec4 uv = vUv;
    uv.xy += N.xz * uDistort * uv.w;
    // a live mirror shows the course; the others reflect the sky photo alone
    vec3 mirror = uMirror > 0.5 ? texture2DProj(tDiffuse, uv).rgb * color
                                : texture2D(uSky, equirectUv(reflect(-V, N))).rgb * color;
    // the body: dark, a little green-brown (algae, tannin), lit by the daylight
    vec3 body = uDeep * (0.45 + 0.55 * clamp(uSunDir.y * 1.5, 0.0, 1.0));
    #ifdef WATER_ENV
    if (uWaterFx.z > 1.5) { body = body * iceT.rgb * (0.75 + 0.5 * iceT.a); F *= 0.55 + 0.3 * iceT.a; }
    #endif
    vec3 col = mix(body, mirror, F);
    vec3 H = normalize(uSunDir + V);
    col += uSunColor * pow(max(dot(N, H), 0.0), 380.0) * 3.0 * step(0.0, uSunDir.y);
    #ifdef WATER_ENV
    {
      // sparkle: the small ripples' own glints, scattered and flickering, round the sun's path
      vec3 N2 = rippleNormal(vWorldPos.xz * 4.7 + 13.0, uTime * 1.7, uChop * 1.6);
      float sp = pow(max(dot(normalize(N + N2 * 0.6), H), 0.0), 140.0) * step(0.55, wNoise(vWorldPos.xz * 2.3 + uTime * 0.6));
      col += uSunColor * sp * uWaterFx.y * step(0.0, uSunDir.y) * step(uWaterFx.z, 0.5);
    }
    #endif
    float alpha = 1.0;
    if (uDepthOn > 0.5) {
      // water column under this pixel along the view ray (terrain-only depth pre-pass)
      float d = texture2D(uDepthTex, gl_FragCoord.xy / uResolution).x;
      float sceneEye = (uCamNear * uCamFar) / (uCamFar - d * (uCamFar - uCamNear));
      float thick = max(sceneEye - vEye, 0.0);
      float clear = exp(-thick * 1.6);          // the waterline clears; ~1.5 m of water doesn't
      #ifdef WATER_ARCADE
      // arcade look: the shallows glow (uSilt is their colour) well out from the bank,
      // and a white foam line, breathing a little, rims the water
      float day = 0.45 + 0.55 * clamp(uSunDir.y * 1.5, 0.0, 1.0);
      // the water's depth straight down, near enough (the column along the view ray,
      // foreshortened), so the bands keep their width at a grazing view
      float deepM = thick * clamp(V.y, 0.12, 1.0);
      col = mix(col, uSilt * day, exp(-deepM / uArcWater.y) * uArcWater.w);
      float lap = 0.5 + 0.5 * sin(uTime * 1.4 + (vWorldPos.x + vWorldPos.z) * 0.7);
      #ifdef WATER_ENV
      // the bed lit through clear shallows: the caustic net, fading as the water deepens
      float clearK = exp(-deepM / max(uArcWater.y * 0.7, 0.05)) * step(uWaterFx.z, 0.5);
      col += uSilt * day * caustics(vWorldPos.xz + N.xz * 1.2, uTime) * uWaterFx.x * clearK;
      // foam that follows the bank, its edge broken up, and a thinner line lapping out from it
      float fn = wNoise(vWorldPos.xz * 1.9 + vec2(uTime * 0.13, -uTime * 0.09));
      float fd = deepM * (0.7 + 0.6 * fn);
      float rim = 1.0 - smoothstep(0.35 * uArcWater.z, uArcWater.z * (1.0 + 0.5 * lap), fd);
      float out2 = fd / max(uArcWater.z, 1e-3) - (2.0 + 1.3 * fract(uTime * 0.11 + fn * 0.35));
      rim = max(rim, (1.0 - smoothstep(0.0, 0.45, abs(out2))) * 0.55 * smoothstep(0.35, 0.6, fn) * (1.0 - fract(uTime * 0.11 + fn * 0.35)));
      col = mix(col, uArcFoam * day, rim);
      // ... and the water is thin enough at the bank to show the bed through it
      alpha = mix(0.5, 1.0, clamp(deepM / max(uArcWater.y * 0.35, 0.05) + rim + step(0.5, uWaterFx.z), 0.0, 1.0));
      #else
      float rim = 1.0 - smoothstep(0.35 * uArcWater.z, uArcWater.z * (1.0 + 0.5 * lap), deepM);
      col = mix(col, uArcFoam * day, rim);
      alpha = 1.0;
      #endif
      #else
      col = mix(col, mix(col, uSilt, 0.35), clear * (1.0 - F));
      alpha = 1.0 - clear * (1.0 - F) * 0.9;
      #endif
    }
    #ifdef WATER_GLOW
    col = arcGlow(col, vWorldPos.xz, N, V, uTime);
    #endif
    #ifdef WATER_ENV
    col = mix(col, uArcFoam * (0.45 + 0.55 * clamp(uSunDir.y * 1.5, 0.0, 1.0)), clamp(rings, 0.0, 1.0) * 0.85);
    #endif
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

function mirrorPond(geom, shared, skip, only) {
  // 512 px: the ripple field distorts the reflection by more than a texel anyway, and a
  // 1024 mirror filled 4x the pixels re-rendering the course every other frame
  const refl = new Reflector(geom, {
    textureWidth: 512, textureHeight: 512, clipBias: 0.003, color: 0xc4d0cc,
    shader: {
      name: 'PondMirror',
      uniforms: {
        color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      },
      vertexShader: POND_VERT,
      fragmentShader: POND_FRAG,
    },
  });
  const m = refl.material;
  // shared live uniforms (time, sun, sky, depth pre-pass) across every pond; uMirror is
  // this pond's own
  Object.assign(m.uniforms, shared, { uMirror: { value: 0 } });
  m.fog = true;
  m.transparent = true;
  refl.receiveShadow = false;
  refl.userData.isWaterReflector = true; // for disposal on course reload
  // Reflector re-renders the scene in onBeforeRender, which fires for EVERY pass that
  // draws the pond (the main pass, the AO normal pass, other ponds' mirrors). Render
  // only when the budget asked for it this frame, once, and never nested in another
  // pond's mirror. Ground cover (grass blades, flowers, litter) and the full terrain
  // (`skip`) stay out of the mirror, and a cheap terrain stand-in (`only`) takes the
  // terrain's place: a pond can't show blades or 1 m relief, and redrawing them was
  // most of a mirror's cost.
  const render = refl.onBeforeRender.bind(refl);
  refl.onBeforeRender = (...args) => {
    if (!refl.userData.refresh || inMirror) return;
    refl.userData.refresh = false;
    inMirror = true;
    const hidden = [], shown = [];
    for (const o of skip) if (o.visible) { o.visible = false; hidden.push(o); }
    for (const o of only) if (!o.visible) { o.visible = true; shown.push(o); }
    try { render(...args); } finally {
      inMirror = false;
      for (const o of hidden) o.visible = true;
      for (const o of shown) o.visible = false;
    }
  };
  return refl;
}
let inMirror = false;
const MAX_LIVE_MIRRORS = 2;

// ---------------------------------------------------------------- sky-only ponds
// Low graphics: the same pond shader on a plain mesh, never live (uMirror stays 0), so
// it reflects the sky photo with the ripples and glitter at no extra render cost.
function skyPond(geom, shared) {
  const m = new THREE.ShaderMaterial({
    name: 'PondSky',
    uniforms: {
      color: { value: new THREE.Color(0xc4d0cc) }, tDiffuse: { value: null }, textureMatrix: { value: new THREE.Matrix4() },
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...shared, uMirror: { value: 0 },
    },
    vertexShader: POND_VERT,
    fragmentShader: POND_FRAG,
    fog: true,
    transparent: true,
  });
  return new THREE.Mesh(geom, m);
}

// ---------------------------------------------------------------- the sea
// The sea or great lake round a coastal course (sea.js findSea): one plane at its water
// line from the course out to the horizon, cut to the sea by a mask of the terrain grid
// (R: sea, G: metres to land), which past the grid's edge carries on outward, as the
// ground apron does. No mirror: open water mostly shows the sky. Swell and chop run
// with the wind at deep water's speed and fade out as they get finer than a few pixels
// (they would only shimmer), roughening the surface instead; Schlick Fresnel at water's
// 2%; a deep blue body whose wave faces scatter blue-green; shallows that clear over
// sand near the shore; lines of surf running in to the waterline and a wash along it;
// whitecaps in a strong wind; the sun's glitter.
const SHORE_STEP_M = 0.5;   // metres per step of the mask's shore channel (to 127 m)

const SEA_VERT = /* glsl */`
  varying vec3 vWorldPos;
  varying float vEye;
  #include <common>
  #include <fog_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    vEye = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
    #include <fog_vertex>
  }`;

const SEA_FRAG = /* glsl */`
  uniform float uTime, uWind;
  uniform vec2 uWindDir;          // sim (east, north) the wind blows toward
  uniform vec3 uSunDir, uSunColor, uSeaDeep, uSeaScatter, uSeaShallow;
  uniform sampler2D uSky, uSeaMask;
  uniform vec4 uMaskRect;         // grid corner (sim m, less half a cell); 1 / its width, height
  #ifdef WATER_ARCADE
  uniform vec4 uArcSea;           // arcade look: reflection kept, shallows' reach (m), foam wash (m), island (1: past the grid it is all sea)
  uniform vec3 uArcFoam;
  #endif
  varying vec3 vWorldPos;
  varying float vEye;
  #include <common>
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  float seaHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float seaNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(seaHash(i), seaHash(i + vec2(1.0, 0.0)), f.x), mix(seaHash(i + vec2(0.0, 1.0)), seaHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  vec3 seaSky(vec3 d) { d.y = abs(d.y); return texture2D(uSky, equirectUv(normalize(d))).rgb; }
  ${ENV_WATER_GLSL}
  ${GLOW_GLSL}
  void main() {
    #include <logdepthbuf_fragment>
    vec2 sim = vec2(vWorldPos.x, -vWorldPos.z);
    vec2 uv = (sim - uMaskRect.xy) * uMaskRect.zw;
    vec4 m = texture2D(uSeaMask, clamp(uv, 0.0, 1.0));
    float outM = length(max(max(-uv, uv - 1.0), 0.0) / uMaskRect.zw);
    #ifdef WATER_ARCADE
    // v3:environment an island stage: past the grid's edge it is open sea all round (the ground
    // apron runs down under it, horizon.js), whatever the edge itself was
    if (m.r < 0.5 && (uArcSea.w < 0.5 || outM < 0.5)) discard;
    #else
    if (m.r < 0.5) discard;
    #endif
    // past the grid the shore only gets farther
    float shore = m.g * 255.0 * ${SHORE_STEP_M.toFixed(2)} + outM;
    #ifdef WATER_ARCADE
    if (m.r < 0.5) shore = 26.0 + outM * 0.35;   // off the island's own beach: clear shallows, no surf line
    #endif
    vec3 V = normalize(cameraPosition - vWorldPos);
    // a pixel's footprint on the water, stretched where the view grazes it
    float foot = vEye * 0.0012 / max(0.05, V.y);
    float wind = clamp(uWind, 0.0, 1.0);
    // swell and chop: waves within about 70 degrees of the wind, longest first, at deep
    // water's speed (w = sqrt(g k)); the chop grows with the wind; each fades out as it
    // gets finer than a few pixels, and what fades roughens the surface instead
    vec2 g = vec2(0.0);
    float rough = 0.0, crest = 0.0, k = 0.09, s = 0.026;
    float base = atan(uWindDir.y, uWindDir.x);
    for (int i = 0; i < 12; i++) {
      float a = base + (fract(float(i) * 0.618034) - 0.5) * 2.4;
      vec2 d = vec2(cos(a), sin(a));
      float ph = dot(d, sim) * k - uTime * 0.7 * sqrt(9.81 * k);
      float amp = s * (i < 3 ? 1.0 : 0.5 + 1.1 * wind);
      float fade = 1.0 - smoothstep(0.8, 2.0, k * foot);
      g += amp * fade * d * cos(ph);
      crest += amp * fade * sin(ph);
      rough += amp * (1.0 - fade);
      k *= 1.42;
      s *= 0.93;
    }
    vec3 N = normalize(vec3(-g.x, 1.0, g.y));   // sim north is world -z
    #ifdef WATER_ENV
    vec2 ringPush; float rings = splashRings(vWorldPos.xz, uTime, ringPush);
    N = normalize(N + vec3(ringPush.x, 0.0, ringPush.y) * 0.45);
    vec4 iceT = vec4(1.0);
    if (uWaterFx.z > 1.5) {
      iceT = envC(6.0, vWorldPos.xz / uWaterFx.w);
      vec3 iceN = envN(6.0, vWorldPos.xz / uWaterFx.w);
      N = normalize(vec3(iceN.x * 0.35, 1.0, -iceN.y * 0.35));
    }
    #endif
    // Fresnel, less of it where sub-pixel chop shadows and masks the facets
    float F = (0.02 + 0.98 * pow(1.0 - max(dot(V, N), 0.0), 5.0)) * (1.0 - 0.45 * clamp(rough * 6.0, 0.0, 1.0));
    #ifdef WATER_ARCADE
    F *= uArcSea.x;   // arcade look: the sea's own colour over the sky's
    #endif
    // the sky in the waves, softened where the chop is finer than a pixel
    vec3 R = reflect(-V, N);
    float spread = clamp(rough * 3.0, 0.0, 0.5);
    // rough water mirrors the sky well above the horizon too (its facets tilt up to it):
    // the deep blue of open sea, not the pale band along the horizon
    R = normalize(R + vec3(0.0, 0.04 + 0.3 * spread, 0.0));
    vec3 T = normalize(cross(R, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
    vec3 sky = (seaSky(R) + seaSky(R + T * spread) + seaSky(R - T * spread + vec3(0.0, spread * 0.5, 0.0))) / 3.0;
    float day = 0.35 + 0.65 * clamp(uSunDir.y * 1.6, 0.0, 1.0);
    // the body: deep blue, the faces of the waves scattering blue-green, clearing over
    // the sand within a few tens of metres of the shore
    vec3 body = uSeaDeep * day + uSeaScatter * day * smoothstep(-0.02, 0.1, crest) * 0.45;
    body = mix(body, uSeaShallow * day, exp(-shore / 14.0) * 0.85);
    #ifdef WATER_ARCADE
    body = mix(body, uSeaShallow * day, exp(-shore / uArcSea.y) * 0.92);   // arcade look: a wide turquoise band off the shore
    #endif
    #ifdef WATER_ENV
    if (uWaterFx.z > 1.5) { body = body * iceT.rgb * (0.75 + 0.5 * iceT.a); F *= 0.55 + 0.3 * iceT.a; }
    else if (uWaterFx.z < 0.5) {
      // the sand lit through the clear shallows off the beach: the caustic net, gone by a few metres of water
      float nearK = 1.0 - smoothstep(60.0, 260.0, vEye);
      body += uSeaShallow * day * caustics(sim + N.xz * 1.5, uTime) * uWaterFx.x * exp(-shore / (uArcSea.y * 0.45)) * nearK;
    }
    #endif
    vec3 col = mix(body, sky, F);
    // the sun's glitter: sharp on near water, a broad sheen where the chop is sub-pixel
    vec3 H = normalize(uSunDir + V);
    float shin = mix(1400.0, 90.0, clamp(rough * 8.0, 0.0, 1.0));
    col += uSunColor * pow(max(dot(N, H), 0.0), shin) * (0.002 * shin + 0.3) * step(0.0, uSunDir.y);
    #ifdef WATER_ENV
    {
      // sparkle: single glints scattered along the sun's path, flickering
      float sn = wNoise(sim * 1.9 + uTime * 0.7) * wNoise(sim * 0.37 - uTime * 0.21);
      float sp = pow(max(dot(normalize(N + vec3(0.0, 0.0, 0.0)), H), 0.0), 26.0) * smoothstep(0.42, 0.62, sn);
      col += uSunColor * sp * uWaterFx.y * 1.4 * step(0.0, uSunDir.y) * step(uWaterFx.z, 0.5) * (1.0 - smoothstep(300.0, 1400.0, vEye));
    }
    #endif
    // surf: broken lines running in to the waterline (bands of shore distance moving
    // shoreward), a wash along it, and whitecaps on the crests in a strong wind
    float zone = 1.0 - smoothstep(2.0, 22.0 + 25.0 * wind, shore);
    float run = sin(shore * 0.5 + uTime * 0.9 + seaNoise(sim * 0.05) * 3.0);
    float br = seaNoise(sim * 0.35 + vec2(uTime * 0.08, 0.0)) * 0.6 + seaNoise(sim * 1.1 - uTime * 0.1) * 0.4;
    float lines = smoothstep(0.86, 0.99, run) * smoothstep(0.45, 0.8, br);
    float wash = (1.0 - smoothstep(0.2, 1.3, shore)) * smoothstep(0.35, 0.7, br);
    #ifdef WATER_ARCADE
    // arcade look: a solid white wash along the waterline, its edge breathing in and out
    wash = max(wash, 1.0 - smoothstep(0.4 * uArcSea.z, uArcSea.z * (0.8 + 0.4 * sin(uTime * 0.8 + seaNoise(sim * 0.07) * 6.0)), shore));
    #endif
    float caps = smoothstep(0.45, 1.0, wind) * smoothstep(0.03, 0.09, crest) * smoothstep(0.62, 0.8, seaNoise(sim * 0.09 - uWindDir * uTime * 0.8));
    float foam = clamp(max(max(lines * zone, wash), caps), 0.0, 1.0) * (1.0 - smoothstep(600.0, 2500.0, vEye));
    #ifdef WATER_ARCADE
    col = mix(col, uArcFoam * day, foam * 0.95);
    #else
    col = mix(col, vec3(0.82, 0.86, 0.88) * day, foam * 0.8);
    #endif
    #ifdef WATER_GLOW
    // the glow under the surf: the foam keeps its own colour
    col = mix(arcGlow(col, sim, N, V, uTime), col, foam * 0.95);
    #endif
    #ifdef WATER_ENV
    col = mix(col, uArcFoam * day, clamp(rings, 0.0, 1.0) * 0.85);
    #endif
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

// sea: sea.js findSea; shared: buildWater's live uniforms (time, sun, sky);
// center: sim { x, y } the plane is centred on.
function buildSea(sea, shared, center, look = null) {
  const n = sea.nx * sea.ny;
  const data = new Uint8Array(n * 4);
  const half = sea.cellM / 2;
  for (let k = 0; k < n; k++) {
    data[k * 4] = sea.mask[k] ? 255 : 0;
    // the shoreline lies half a cell short of the nearest land cell's centre
    data[k * 4 + 1] = Math.min(255, Math.round(Math.max(0, sea.shoreM[k] - half) / SHORE_STEP_M));
    data[k * 4 + 3] = 255;
  }
  const mask = new THREE.DataTexture(data, sea.nx, sea.ny, THREE.RGBAFormat, THREE.UnsignedByteType);
  mask.magFilter = mask.minFilter = THREE.LinearFilter;
  mask.wrapS = mask.wrapT = THREE.ClampToEdgeWrapping;
  mask.generateMipmaps = false;
  mask.needsUpdate = true;
  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uTime: shared.uTime, uSunDir: shared.uSunDir, uSunColor: shared.uSunColor, uSky: shared.uSky,
    uWind: { value: 0.3 },
    uWindDir: { value: new THREE.Vector2(0, 1) },
    uSeaDeep: { value: new THREE.Color(0x1d5486).convertSRGBToLinear() },
    uSeaScatter: { value: new THREE.Color(0x2c8f94).convertSRGBToLinear() },
    uSeaShallow: { value: new THREE.Color(0x4f9f98).convertSRGBToLinear() },
    uSeaMask: { value: mask },
    uMaskRect: { value: new THREE.Vector4(sea.minX - half, sea.minY - half, 1 / (sea.nx * sea.cellM), 1 / (sea.ny * sea.cellM)) },
  };
  if (look) {   // the arcade look's sea (arcade-look.js water.sea)
    const s = look.sea || {};
    uniforms.uSeaDeep.value.set(s.deep ?? look.deep);
    uniforms.uSeaScatter.value.set(s.scatter ?? look.shallow);
    uniforms.uSeaShallow.value.set(s.shallow ?? look.shallow);
    uniforms.uArcSea = { value: new THREE.Vector4(s.reflect ?? 1, s.shallowReachM ?? 14, s.foamM ?? 1.3, look.island ? 1 : 0) };
    uniforms.uArcFoam = shared.uArcFoam;
    if (shared.uArcFlow) Object.assign(uniforms, { uArcGlow: shared.uArcGlow, uArcHot: shared.uArcHot, uArcCrust: shared.uArcCrust, uArcFlow: shared.uArcFlow });
    if (shared.uWaterFx) Object.assign(uniforms, { uEnvTex: shared.uEnvTex, uRing: shared.uRing, uWaterFx: shared.uWaterFx });
  }
  const mat = new THREE.ShaderMaterial({ name: 'Sea', defines: look ? { WATER_ARCADE: '', ...(shared.uArcFlow ? { WATER_GLOW: '' } : {}), ...(shared.uWaterFx ? { WATER_ENV: '' } : {}) } : {}, uniforms, vertexShader: SEA_VERT, fragmentShader: SEA_FRAG, fog: true });
  mat.userData.disposeTextures = [mask];
  // out past the horizon haze band (9.5 km), inside the camera's far plane
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(9000, 96), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(center.x, sea.level + 0.02, -center.y);
  mesh.receiveShadow = false;
  mesh.name = 'sea';
  // wind: { mph, toDeg } (compass heading it blows toward)
  const setWind = ({ mph = 0, toDeg = 0 } = {}) => {
    uniforms.uWind.value = Math.min(1, mph / 25);
    uniforms.uWindDir.value.set(Math.sin(toDeg * Math.PI / 180), Math.cos(toDeg * Math.PI / 180));
  };
  return { mesh, setWind };
}

// v3:environment Embers off the lava: point sprites that rise, drift and burn out, each on its own
// clock, placed over the lava ponds (and round the course's centre when the sea is lava).
function buildEmbers(ponds, seaMesh, seaCenter, uTime, glow) {
  const spots = [];
  for (const p of ponds) { const s = p.userData.sphere; if (s) spots.push({ x: s.center.x, y: s.center.y, z: s.center.z, r: s.radius * 0.8 }); }
  if (seaMesh) spots.push({ x: seaCenter ? seaCenter.x : seaMesh.position.x, y: seaMesh.position.y, z: seaCenter ? -seaCenter.y : seaMesh.position.z, r: 260 });
  if (!spots.length) return null;
  const n = Math.min(420, 140 * spots.length);
  const pos = new Float32Array(n * 3), seed = new Float32Array(n * 3);
  let h = 0x1234abcd;
  const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
  for (let i = 0; i < n; i++) {
    const s = spots[i % spots.length], a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * s.r;
    pos[i * 3] = s.x + Math.cos(a) * r; pos[i * 3 + 1] = s.y; pos[i * 3 + 2] = s.z + Math.sin(a) * r;
    seed[i * 3] = rnd(); seed[i * 3 + 1] = 0.5 + rnd(); seed[i * 3 + 2] = rnd();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  const mat = new THREE.ShaderMaterial({
    name: 'LavaEmbers',
    uniforms: { uTime, uHot: { value: new THREE.Color(glow.hot ?? '#ffd24a') }, uGlow: { value: new THREE.Color(glow.color ?? '#ff4a0c') } },
    vertexShader: /* glsl */`
      attribute vec3 aSeed; uniform float uTime; varying float vLife;
      void main() {
        float life = fract(uTime * 0.11 * aSeed.y + aSeed.x);
        vLife = life;
        vec3 p = position;
        p.y += 0.2 + life * (9.0 + 14.0 * aSeed.z);
        p.x += sin(uTime * 0.9 + aSeed.x * 40.0) * (0.4 + 1.6 * life) + life * 3.0;
        p.z += cos(uTime * 0.7 + aSeed.z * 31.0) * (0.4 + 1.6 * life);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp((2.2 + 3.5 * aSeed.z) * (1.0 - life * 0.7) * 160.0 / max(-mv.z, 1.0), 1.0, 9.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uHot, uGlow; varying float vLife;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = (1.0 - smoothstep(0.15, 0.5, d)) * sin(vLife * 3.14159) ;
        gl_FragColor = vec4(mix(uHot, uGlow, vLife) * 2.2 * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.name = 'lavaEmbers';
  pts.userData.noAO = true;
  return pts;
}

// ponds: water-shore.js coursePonds (grown outline + water level per pond);
// sunDir: world Vector3 toward the sun; depth: the terrain depth pre-pass or null;
// sea: sea.js findSea, with seaCenter the sim { x, y } to centre it on, or null.
// Returns { meshes, waterMeshes, sea, waterUpdate, setFoamDepth, setMirrorSkip, setWind }.
// look (optional, arcade-look.js water): the arcade look's colours, shallows, foam and
// glitter, compiled in behind WATER_ARCADE; null leaves the water as it is.
export function buildWater(ponds, sunDir, depth, sea = null, seaCenter = null, look = null) {
  const meshes = [];
  const mirrorSkip = [];   // objects left out of the live mirrors (setMirrorSkip)
  const mirrorOnly = [];   // objects drawn only inside them
  const reflect = RENDER_CONFIG.waterReflect;
  const shared = {
    uTime: { value: 0 },
    uChop: { value: 0.16 },      // calm until the day's wind says otherwise (setWind)
    uDistort: { value: 0.06 },
    uSunDir: { value: sunDir.clone().normalize() },
    uSunColor: { value: new THREE.Color(1.0, 0.95, 0.84) },
    uDeep: { value: new THREE.Color(0x14261f).convertSRGBToLinear() },
    uSilt: { value: new THREE.Color(0x4a4532).convertSRGBToLinear() },
    uDepthOn: { value: 0 },
    uSky: { value: null },
    uDepthTex: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uCamNear: { value: 0.3 },
    uCamFar: { value: 12000 },
  };
  const glintMul = look?.glint ?? 1, chopMul = look?.chopMul ?? 1;
  if (look) {
    shared.uDeep.value.set(look.deep);
    shared.uSilt.value.set(look.shallow);
    shared.uArcWater = { value: new THREE.Vector4(look.reflect ?? 1, look.shallowReachM ?? 0.6, look.foamM ?? 0, look.shallowMix ?? 0.35) };
    shared.uArcFoam = { value: new THREE.Color(look.foam ?? '#ffffff') };
    shared.uChop.value *= chopMul;
    if (look.glow) {   // a theme's self-lit water: lava, neon (WATER_GLOW)
      const g = look.glow;
      shared.uArcGlow = { value: new THREE.Color(g.color ?? '#ff5a14') };
      shared.uArcHot = { value: new THREE.Color(g.hot ?? '#ffd04a') };
      shared.uArcCrust = { value: new THREE.Color(g.crust ?? '#000000') };
      shared.uArcFlow = { value: new THREE.Vector4(g.strength ?? 1, 1 / Math.max(0.5, g.scaleM ?? 12), g.speed ?? 0.05, g.mode === 'neon' ? 1 : 0) };
    }
    // v3:environment the stages' extras (WATER_ENV): only with the ground sets' array and a graphics setting that allows them
    if (look.fx > 0 && look.envTex) {
      const kind = look.glow?.mode === 'lava' ? 1 : look.surface === 'ice' ? 2 : 0;
      shared.uEnvTex = { value: look.envTex };
      shared.uRing = { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, -100, 0)) };
      shared.uWaterFx = { value: new THREE.Vector4((look.caustics ?? 0.5) * (look.fx > 1 ? 1 : 0.7), look.sparkle ?? 1, kind, kind === 1 ? 7 : 9) };
    }
  }
  const envOn = !!shared.uWaterFx;
  let ringAt = 0;
  const open = sea
    ? buildSea(sea, shared, seaCenter || { x: sea.minX + (sea.nx * sea.cellM) / 2, y: sea.minY + (sea.ny * sea.cellM) / 2 }, look)
    : null;

  for (const p of ponds) {
    // shape in sim (x, y); a -90deg turn about x maps it to three (x, 0, -y) —
    // flipping y first (as this used to) mirrored every pond across the x axis. The
    // turn goes on the MESH, not the geometry: Reflector takes the mirror's normal
    // from the object's +Z (a baked-in turn left it mirroring sideways — black water)
    const shape = new THREE.Shape(p.grown.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ShapeGeometry(shape);
    // a hair over the flattened water line: the bank where it rises out draws the shore
    const level = p.level + 0.03;
    const m = reflect ? mirrorPond(g, shared, mirrorSkip, mirrorOnly) : skyPond(g, shared);
    if (look) m.material.defines = { ...m.material.defines, WATER_ARCADE: '', ...(look.glow ? { WATER_GLOW: '' } : {}), ...(envOn ? { WATER_ENV: '' } : {}) };
    m.rotation.x = -Math.PI / 2;
    m.position.y = level;
    m.updateMatrixWorld(true);
    g.computeBoundingSphere();
    m.userData.sphere = g.boundingSphere.clone().applyMatrix4(m.matrixWorld);
    meshes.push(m);
  }

  // Wire the terrain depth pre-pass (its texture/Vector2 are shared refs the helper
  // updates on resize, so this is set once).
  const setFoamDepth = (depthTex, resolution, near, far) => {
    shared.uDepthTex.value = depthTex; shared.uResolution.value = resolution;
    shared.uCamNear.value = near; shared.uCamFar.value = far;
    shared.uDepthOn.value = depthTex && reflect ? 1 : 0;
  };
  if (depth) setFoamDepth(depth.depthTexture, depth.resolution, depth.near, depth.far);
  // Each frame: the ponds most worth a live mirror (in view, within 900 m, biggest
  // for their distance) show it; they take turns re-rendering, a newly promoted one
  // at once (so a single captured frame is complete).
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4();
  let frame = 0;
  // Returns how many ponds in view are near enough (< 300 m) for their shallows to show:
  // the terrain depth pre-pass behind them redraws the whole terrain, so it runs only
  // then, and the shallows switch off (uDepthOn) on frames it doesn't.
  const SHALLOWS_M = 300;
  const updateMirrors = (camera) => {
    if (!reflect) return meshes.length;
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const cand = [];
    let near = 0;
    for (const r of meshes) {
      const sph = r.userData.sphere;
      const d = Math.max(1, sph.center.distanceTo(camera.position) - sph.radius * 0.5);
      if (d < 900 && frustum.intersectsSphere(sph)) {
        cand.push({ r, score: sph.radius / d });
        if (d < SHALLOWS_M) near++;
      } else { r.material.uniforms.uMirror.value = 0; r.userData.live = false; r.userData.refresh = false; }
    }
    cand.sort((a, b) => b.score - a.score);
    const n = Math.min(MAX_LIVE_MIRRORS, cand.length);
    frame++;
    cand.forEach(({ r }, i) => {
      const on = i < n;
      r.userData.refresh = on && (!r.userData.live || frame % n === i);
      r.userData.live = on;
      r.material.uniforms.uMirror.value = on ? 1 : 0;
    });
    shared.uDepthOn.value = near && shared.uDepthTex.value ? 1 : 0;
    return near;
  };
  // v3:environment embers rising off a lava lake (one draw, animated in its vertex shader)
  const embers = envOn && look.glow?.mode === 'lava' ? buildEmbers(meshes, open ? open.mesh : null, seaCenter, shared.uTime, look.glow) : null;
  return {
    meshes, waterMeshes: meshes,
    extras: embers ? [embers] : [],
    // a ball going in at world (x, z): rings spread from the spot for five seconds
    splash: (x, z, strength = 1) => {
      if (!envOn) return;
      shared.uRing.value[ringAt].set(x, z, shared.uTime.value, strength);
      ringAt = (ringAt + 1) % 4;
    },
    sea: open ? open.mesh : null,
    // the day's wind ({ mph, toDeg }): ponds ruffle with it, the sea runs downwind
    setWind: (wind) => {
      shared.uChop.value = (0.16 + 0.32 * Math.min(1, (wind?.mph || 0) / 25)) * chopMul;
      open?.setWind(wind);
    },
    waterUpdate: (t) => { shared.uTime.value = t; },
    setSun: (dir) => shared.uSunDir.value.copy(dir).normalize(),
    // the sun's glitter on the water, as bright as the sun is: none to speak of under cloud
    setSunGlint: (k) => shared.uSunColor.value.setRGB(1.0, 0.95, 0.84).multiplyScalar(Math.max(0, k) * glintMul),
    setSky: (tex) => { shared.uSky.value = tex; },
    updateMirrors,
    setFoamDepth,
    setMirrorSkip: (objects, only = []) => {
      mirrorSkip.length = 0; mirrorSkip.push(...objects.filter(Boolean));
      mirrorOnly.length = 0; mirrorOnly.push(...only.filter(Boolean));
    },
  };
}
