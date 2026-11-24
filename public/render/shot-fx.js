// Shot presentation in 3D: a broadcast-style tracer that grows with the ball and lingers
// a few seconds after the shot, apex + landing markers, and a soft contact shadow under
// the ball. All unlit/additive, no textures, no shadows — a handful of draw calls on top
// of the scene.
//
// The tracer is there to show the shot's shape, never to cover the shot: it is bright
// and full width only just behind the ball (a comet), thins to a faint line further
// back, and fades out toward the camera, so a camera riding behind the ball looks past
// it at the ball and the ground it is coming down on.
import * as THREE from 'three';

export const TRACER_WIDTH_PX = 6;      // the ribbon's width just behind the ball
export const TRACER_THIN = 0.5;        // ...and the share of it the older trail keeps
export const TRACER_FRESH_S = 0.8;     // the comet: this much flight behind the ball is at full strength
export const TRACER_TAIL = 0.3;        // how much of the older trail's strength is left
export const TRACER_NEAR_M = Object.freeze([3, 9]);   // gone at the first distance from the camera, whole from the second

const smooth01 = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
// How strongly the trail is drawn (0..1) and how wide (share of TRACER_WIDTH_PX) at a
// point the ball passed ageS ago, distM from the camera. The shader below does the same
// sums; this is the copy the tests check (test/shot-fx.test.mjs).
export function tracerVisibility(ageS, distM) {
  const fresh = 1 - smooth01(0, TRACER_FRESH_S, Math.max(0, ageS));
  const near = smooth01(TRACER_NEAR_M[0], TRACER_NEAR_M[1], distM);
  return { strength: (TRACER_TAIL + (1 - TRACER_TAIL) * fresh) * near, width: TRACER_THIN + (1 - TRACER_THIN) * fresh };
}

const TRACER_VERT = /* glsl */`
  uniform float uPxWorld;   // world metres per pixel at 1 m depth (2 tan(fov/2) / viewport h)
  uniform float uPx;        // ribbon width in pixels
  uniform float uMinW;      // minimum world width (m)
  uniform float uHead;      // sim time of the ball
  uniform float uFreshS;    // the comet's length (s of flight)
  uniform float uThin;      // the older trail's share of the width
  #ifdef TRACER_TAPER
  uniform vec3 uTaper;      // the ball cam's streak: full width from y metres from the camera, down to share z by x metres
  #endif
  attribute vec3 aDir;
  attribute float aSide;
  attribute float aT;
  varying float vSide;
  varying float vT;
  varying float vDist;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec3 toCam = cameraPosition - wp.xyz;
    float dist = length(toCam);
    vec3 side = cross(aDir, toCam / max(dist, 1e-4));
    float sl = length(side);
    side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
    float fresh = 1.0 - smoothstep(0.0, uFreshS, max(0.0, uHead - aT));
    float w = max(uMinW, dist * uPxWorld * uPx) * mix(uThin, 1.0, fresh);
    #ifdef TRACER_TAPER
    // seen from right behind the ball the trail comes back at the lens: thick at the ball, narrowing as it nears the camera
    w *= mix(uTaper.z, 1.0, smoothstep(uTaper.x, uTaper.y, dist));
    #endif
    wp.xyz += side * aSide * w * 0.5;
    vSide = aSide;
    vT = aT;
    vDist = dist;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const TRACER_FRAG = /* glsl */`
  uniform float uHead;      // sim time of the ball: samples later than this aren't drawn yet
  uniform float uAlpha;     // overall fade (linger -> gone)
  uniform vec3 uColor;      // glow colour
  uniform vec3 uCore;       // hot core colour
  uniform float uFreshS;    // the comet's length (s of flight)
  uniform float uTail;      // what is left of the older trail's strength
  uniform vec2 uNear;       // fades out toward the camera between these distances (m)
  #ifdef TRACER_ARCADE
  uniform float uGain;      // the arcade trail's brightness (arcade-look.js trail.gain)
  #endif
  #ifdef TRACER_OUTLINE
  uniform vec4 uOutline;    // an arcade theme's dark rim along the trail (rgb, strength): a bright trail over snow
  #endif
  varying float vSide;
  varying float vT;
  varying float vDist;
  void main() {
    if (vT > uHead) discard;
    float e = 1.0 - abs(vSide);               // 0 at the ribbon edge, 1 on its spine
    float core = smoothstep(0.62, 1.0, e);
    float glow = e * e * e;
    float fresh = 1.0 - smoothstep(0.0, uFreshS, uHead - vT);   // the comet just behind the ball
    // only the comet is bright enough to bloom; the older trail is a plain thin line
    #ifdef TRACER_ARCADE
    // the arcade trail: a hot core, fat in the comet and a fine line behind it, inside a
    // wide halo that stays the trail's own colour. Only the core is bright enough to
    // bloom: a halo that bloomed too washed a tinted trail out to white along its length.
    core = smoothstep(mix(0.72, 0.3, fresh), mix(1.0, 0.85, fresh), e);
    glow = e * e;
    #ifdef TRACER_TAPER
    core = smoothstep(0.58, 0.98, e);   // a streak this wide keeps its colour: only its spine is hot
    #endif
    vec3 col = uColor * (0.8 + 0.35 * fresh) + uCore * core * uGain * (0.25 + 1.05 * fresh);
    #else
    vec3 col = mix(uColor, uCore, core) * (1.0 + 1.2 * core + (0.8 + 1.6 * core) * fresh);
    #endif
    float a = clamp(glow * 0.75 + core * 0.9, 0.0, 1.0) * uAlpha
      * mix(uTail, 1.0, fresh) * smoothstep(uNear.x, uNear.y, vDist);
    #ifdef TRACER_OUTLINE
    {
      // a dark band just inside the ribbon's edge: the trail keeps its shape on white ground
      float rim = smoothstep(0.0, 0.22, e) * (1.0 - smoothstep(0.3, 0.62, e));
      float ra = rim * uOutline.a * uAlpha * mix(uTail, 1.0, fresh) * smoothstep(uNear.x, uNear.y, vDist);
      col = mix(col, uOutline.rgb, rim * uOutline.a);
      a = max(a, ra);
    }
    #endif
    if (a < 0.003) discard;
    gl_FragColor = vec4(col * a, a);
  }`;

// One trajectory -> a camera-facing ribbon (two verts per sample, expanded in the
// vertex shader so it stays ~uPx pixels wide at any distance). Air phase only.
// arcade (optional, arcade-look.js lookTracer): { freshS, thin, tail, gain }, the arcade
// trail's comet length, older-trail width and strength shares, and brightness.
export class ShotTracer {
  constructor(points3, times, { color = 0xffb21e, core = 0xfff3c4, widthPx = TRACER_WIDTH_PX, arcade = null } = {}) {
    const n = points3.length;
    const pos = new Float32Array(n * 2 * 3);
    const dir = new Float32Array(n * 2 * 3);
    const side = new Float32Array(n * 2);
    const tt = new Float32Array(n * 2);
    const d = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const a = points3[Math.max(0, i - 1)], b = points3[Math.min(n - 1, i + 1)];
      d.subVectors(b, a);
      if (d.lengthSq() < 1e-10) d.set(0, 0, -1);
      d.normalize();
      for (let k = 0; k < 2; k++) {
        const j = i * 2 + k;
        pos[j * 3] = points3[i].x; pos[j * 3 + 1] = points3[i].y; pos[j * 3 + 2] = points3[i].z;
        dir[j * 3] = d.x; dir[j * 3 + 1] = d.y; dir[j * 3 + 2] = d.z;
        side[j] = k ? 1 : -1;
        tt[j] = times[i];
      }
    }
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setAttribute('aT', new THREE.BufferAttribute(tt, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    this.uniforms = {
      uPxWorld: { value: 0.0015 },
      uPx: { value: widthPx },
      uMinW: { value: 0.05 },
      uHead: { value: -1 },
      uAlpha: { value: 1 },
      uFreshS: { value: TRACER_FRESH_S },
      uThin: { value: TRACER_THIN },
      uTail: { value: TRACER_TAIL },
      uNear: { value: new THREE.Vector2(TRACER_NEAR_M[0], TRACER_NEAR_M[1]) },
      uColor: { value: new THREE.Color(color) },
      uCore: { value: new THREE.Color(core) },
    };
    if (arcade) {
      this.uniforms.uFreshS.value = arcade.freshS ?? TRACER_FRESH_S;
      this.uniforms.uThin.value = arcade.thin ?? TRACER_THIN;
      this.uniforms.uTail.value = arcade.tail ?? TRACER_TAIL;
      this.uniforms.uGain = { value: arcade.gain ?? 1 };
      // the ball cam's streak comes back at the lens: it fades out nearer the camera than the plain trail does
      if (Array.isArray(arcade.nearM)) this.uniforms.uNear.value.set(arcade.nearM[0], arcade.nearM[1]);
      if (Array.isArray(arcade.taper)) this.uniforms.uTaper = { value: new THREE.Vector3(arcade.taper[0], arcade.taper[1], arcade.taper[2]) };
      if (arcade.outline) {
        const oc = new THREE.Color(arcade.outline.color ?? '#000000');
        this.uniforms.uOutline = { value: new THREE.Vector4(oc.r, oc.g, oc.b, arcade.outline.strength ?? 0.6) };
      }
    }
    const mat = new THREE.ShaderMaterial({
      defines: arcade ? { TRACER_ARCADE: '', ...(arcade.outline ? { TRACER_OUTLINE: '' } : {}), ...(Array.isArray(arcade.taper) ? { TRACER_TAPER: '' } : {}) } : {},
      uniforms: this.uniforms, vertexShader: TRACER_VERT, fragmentShader: TRACER_FRAG,
      transparent: true, depthWrite: false, blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      side: THREE.DoubleSide, fog: false,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.endT = times[n - 1];
  }

  update(camera, viewportH, head, alpha) {
    const fov = THREE.MathUtils.degToRad(camera.fov);
    this.uniforms.uPxWorld.value = (2 * Math.tan(fov / 2)) / Math.max(1, viewportH);
    this.uniforms.uHead.value = head;
    this.uniforms.uAlpha.value = alpha;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// Soft round glow billboard (ball head while in flight, apex dot).
const GLOW_VERT = /* glsl */`
  uniform float uPxWorld; uniform float uPx; uniform float uMinW;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float w = max(uMinW, -mv.z * uPxWorld * uPx);
    mv.xy += position.xy * w;
    gl_Position = projectionMatrix * mv;
  }`;
const GLOW_FRAG = /* glsl */`
  uniform vec3 uColor; uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float a = (smoothstep(1.0, 0.0, r) * 0.55 + smoothstep(0.38, 0.0, r)) * uAlpha;
    gl_FragColor = vec4(uColor * a * 2.4, a);
  }`;

export function makeGlow({ color = 0xffe08a, px = 22 } = {}) {
  const uniforms = {
    uPxWorld: { value: 0.0015 }, uPx: { value: px }, uMinW: { value: 0.12 },
    uColor: { value: new THREE.Color(color) }, uAlpha: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
    transparent: true, depthWrite: false, depthTest: true, fog: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.frustumCulled = false;
  m.renderOrder = 11;
  m.userData.uniforms = uniforms;
  return m;
}

// Target ring on the ground at the landing spot (constant-ish screen size), with an
// expanding pulse. The scene dims it once the ball is down (landingRingAlpha).
export const LAND_RING_SETTLE_S = Object.freeze([0.8, 2.4]);   // full until the first, dimmed by the second (s after touchdown)
export const LAND_RING_REST = 0.35;                            // what is left of it then
export function landingRingAlpha(sinceLandingS) {
  return 1 - (1 - LAND_RING_REST) * smooth01(LAND_RING_SETTLE_S[0], LAND_RING_SETTLE_S[1], sinceLandingS);
}

const RING_FRAG = /* glsl */`
  uniform float uTime; uniform float uAlpha; uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    // a thin ring and its pulse: nothing drawn over the middle, where the ball is
    float ring = smoothstep(0.86, 0.90, r) * (1.0 - smoothstep(0.95, 1.0, r));
    float pulseR = fract(uTime * 0.7);
    float pulse = (1.0 - smoothstep(0.0, 0.05, abs(r - pulseR))) * (1.0 - pulseR) * 0.5 * smoothstep(0.2, 0.4, r);
    float a = clamp(ring + pulse, 0.0, 1.0) * uAlpha;
    gl_FragColor = vec4(uColor * a * 1.8, a);
  }`;

export function makeLandingRing({ color = 0xffffff } = {}) {
  const uniforms = { uTime: { value: 0 }, uAlpha: { value: 0 }, uColor: { value: new THREE.Color(color) } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: RING_FRAG,
    transparent: true, depthWrite: false, fog: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const g = new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 9;
  m.frustumCulled = false;
  m.userData.uniforms = uniforms;
  return m;
}

// Soft dark contact blob under the ball; size/opacity follow the ball's height.
export function makeBallShadow() {
  const s = 64, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const gr = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)');
  gr.addColorStop(0.5, 'rgba(0,0,0,0.35)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  const g = new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, fog: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 2;
  m.userData.disposeTextures = [tex];
  return m;
}

// Thin dashed drop line from the apex to the ground.
export function makeDropLine() {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]);
  const mat = new THREE.LineDashedMaterial({
    color: 0xffd36a, transparent: true, opacity: 0.0, dashSize: 1.2, gapSize: 1.0, depthWrite: false, fog: false,
  });
  const line = new THREE.Line(g, mat);
  line.frustumCulled = false;
  line.renderOrder = 9;
  return line;
}

// ---------------------------------------------------------------- the rocket ball
// A good shot's exhaust (scene.playShot opts.trailHeat > 0): a short flame on the ball
// pointing back along its flight, and sparks shed behind it. Only ever built for such a
// shot, so an ordinary one costs nothing.
//
// Like the tracer, both are sized in screen pixels (the ball in flight is a few pixels
// across at any distance), and both keep their colour: the flame's body and the sparks
// stay under the bloom's threshold and only the white-hot core at the ball blooms.

export const ROCKET_SPARKS = 120;       // the spark pool (live at once); Low graphics runs a third of it
export const ROCKET_SPARK_LIFE_S = 0.4;

// The flame's colours from the shot's tint: the tint itself for the body, a deeper tone
// for the tip (a warm tint burns down to red-orange, a cool one to a deeper blue), and a
// white-hot core that keeps a little of the tint. Returns THREE.Colors (linear).
export function flameColors(tint = 0xff8a1f) {
  const color = new THREE.Color(tint);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  const warm = hsl.h < 0.2 || hsl.h > 0.9;
  // toward red (h = 0, the short way round) or toward deep blue (h = 0.64)
  const h = warm ? (hsl.h > 0.5 ? hsl.h + (1 - hsl.h) * 0.6 : hsl.h * 0.35) : hsl.h + (0.64 - hsl.h) * 0.6;
  const deep = new THREE.Color().setHSL(h % 1, Math.max(hsl.s, 0.85), Math.min(hsl.l, 0.5) * 0.62);
  const core = new THREE.Color(1, 1, 1).lerp(color, 0.18);
  return { color, deep, core, warm };
}

// The ball's speed as a share of its launch speed, from how far down its carry it is
// (0 off the club .. 1 at first contact): a golf ball lands at something like 40% of the
// speed it left with. Taken from the distance, not the clock, because the replay's
// timestamps are re-timed for slow motion (public/arcade/feel.js).
export function rocketSpeedK(progress) {
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  return 1 - 0.62 * Math.pow(p, 0.85);
}

// How long and wide the flame is (px) and how fast it sheds sparks (a second) for a heat
// 0..1 and the ball's speed as a share of its launch speed: long off the club, shrinking
// through the apex and the descent. cfg: arcade-look.js ARCADE_LOOK.rocket.
export function rocketFlame(heat, speedK, cfg = {}) {
  const h = Math.min(1, Math.max(0, Number.isFinite(heat) ? heat : 0));
  const k = Math.min(1, Math.max(0, Number.isFinite(speedK) ? speedK : 0));
  const [l0, l1] = cfg.lengthPx || [70, 190], [w0, w1] = cfg.widthPx || [22, 38];
  const run = 0.3 + 0.7 * k;
  return {
    lengthPx: (l0 + (l1 - l0) * h) * run,
    widthPx: (w0 + (w1 - w0) * h) * (0.8 + 0.2 * k),
    sparksPerS: (cfg.sparksPerS ?? 140) * h * run,
    glow: 0.7 + 0.5 * h * run,
  };
}

const FLAME_VERT = /* glsl */`
  uniform vec3 uHead;       // the ball
  uniform vec3 uBack;       // unit vector back along its flight
  uniform float uUnit;      // world metres per pixel at the ball
  uniform float uLenPx, uWidthPx;
  varying vec2 vUv;         // x: 0 at the ball .. 1 at the tip; y: -1 .. 1 across
  varying float vFace;      // 1 seen from the side .. 0 end-on (looking down the flame)
  void main() {
    vUv = position.xy;
    vec3 wp = uHead + uBack * (position.x * uLenPx * uUnit);
    vec3 toCam = normalize(cameraPosition - uHead);
    vec3 side = cross(uBack, toCam);
    float sl = length(side);
    side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
    vFace = smoothstep(0.04, 0.3, sl);
    wp += side * position.y * uWidthPx * uUnit * 0.5;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;

const FLAME_FRAG = /* glsl */`
  uniform vec3 uColor, uDeep, uCore;
  uniform float uTime, uHeat, uGlow, uSeed;
  varying vec2 vUv;
  varying float vFace;
  void main() {
    // the tip dances in and out, tongues run down the flame, the whole thing wavers
    float flick = 0.86 + 0.14 * sin(uTime * 41.0 + uSeed) * sin(uTime * 17.3 + uSeed * 1.7);
    float u = vUv.x / flick;
    if (u >= 1.0) discard;
    float tongue = sin(u * 11.0 - uTime * 34.0 + uSeed) * 0.5 + sin(u * 23.0 - uTime * 53.0 + vUv.y * 2.5) * 0.3;
    float waver = sin(u * 6.0 - uTime * 19.0 + uSeed * 0.7) * 0.22 * u;
    // half-width: round at the ball, full a little way back, a point at the tip
    float w = smoothstep(-0.02, 0.12, u) * pow(1.0 - u, 0.8) * (0.86 + 0.14 * tongue);
    float d = abs(vUv.y + waver) / max(w, 1e-3);          // 0 on the axis .. 1 at the flame's edge
    if (d >= 1.0) discard;
    float body = 1.0 - d * d;
    float core = (1.0 - smoothstep(0.0, 0.45, d)) * (1.0 - smoothstep(0.02, 0.3, u));
    // the body keeps the shot's colour (under the bloom's threshold); only the core is white-hot
    vec3 col = mix(uColor, uDeep, smoothstep(0.2, 0.92, u)) * (0.72 + 0.4 * body) * uGlow;
    col += uCore * core * (1.3 + 1.5 * uHeat);
    float a = clamp(body * (1.0 - smoothstep(0.5, 1.0, u)) * (0.75 + 0.25 * tongue) + core, 0.0, 1.0) * vFace;
    if (a < 0.004) discard;
    gl_FragColor = vec4(col * a, a * 0.55);               // mostly light added, a little cover so it holds its colour on a bright sky
  }`;

// The same flame seen down its length (the camera following the ball looks straight up
// the exhaust, where the strip above is edge-on): a ragged ball of fire round the ball.
// It takes over as the strip turns away from the camera, so the two never both show whole.
const PLUME_VERT = /* glsl */`
  uniform vec3 uHead, uBack;
  uniform float uUnit, uWidthPx;
  varying vec2 vP;          // -1 .. 1 across the disc
  varying float vEnd;       // 0 seen from the side .. 1 end-on
  void main() {
    vP = position.xy;
    vec3 toCam = normalize(cameraPosition - uHead);
    vEnd = 1.0 - smoothstep(0.04, 0.3, length(cross(uBack, toCam)));
    vec4 mv = viewMatrix * vec4(uHead, 1.0);
    mv.xy += position.xy * uWidthPx * uUnit * 0.95;
    gl_Position = projectionMatrix * mv;
  }`;

const PLUME_FRAG = /* glsl */`
  uniform vec3 uColor, uDeep, uCore;
  uniform float uTime, uHeat, uGlow, uSeed;
  varying vec2 vP;
  varying float vEnd;
  void main() {
    if (vEnd < 0.004) discard;
    float ang = atan(vP.y, vP.x);
    // tongues of flame round the rim, licking in and out
    float rim = 0.76 + 0.15 * sin(ang * 7.0 + uTime * 29.0 + uSeed) + 0.09 * sin(ang * 13.0 - uTime * 43.0 + uSeed * 2.0);
    float r = length(vP) / rim;
    if (r >= 1.0) discard;
    float body = 1.0 - r * r;
    float core = 1.0 - smoothstep(0.1, 0.45, r);
    vec3 col = mix(uColor, uDeep, smoothstep(0.3, 1.0, r)) * (0.72 + 0.4 * body) * uGlow;
    col += uCore * core * (1.0 + 1.2 * uHeat);
    float a = clamp(body * 0.9 + core, 0.0, 1.0) * vEnd;
    gl_FragColor = vec4(col * a, a * 0.5);
  }`;

const SPARK_VERT = /* glsl */`
  uniform float uTime, uDpr;
  attribute vec3 aVel;      // world m/s at birth
  attribute vec4 aLife;     // birth time, lifetime, size (px), gravity (m/s2)
  varying float vK;
  void main() {
    float age = uTime - aLife.x;
    vK = age / aLife.y;
    if (vK < 0.0 || vK >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    float run = (1.0 - exp(-3.0 * age)) / 3.0;            // distance under air drag
    vec3 p = position + aVel * run + vec3(0.0, -0.5 * aLife.w * age * age, 0.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    gl_PointSize = max(1.5, aLife.z * uDpr * (1.0 - 0.65 * vK));
  }`;

const SPARK_FRAG = /* glsl */`
  uniform vec3 uColor, uDeep, uCore;
  varying float vK;
  void main() {
    if (vK < 0.0 || vK >= 1.0) discard;
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r >= 1.0) discard;
    float a = (1.0 - r * r) * (1.0 - vK * vK);
    // born white-hot, cooling through the shot's colour to its deep tone
    vec3 col = mix(uCore * 1.9, mix(uColor, uDeep, smoothstep(0.35, 1.0, vK)) * 1.15, smoothstep(0.0, 0.16, vK));
    gl_FragColor = vec4(col * a, a * 0.35);
  }`;

const ADDITIVE = {
  transparent: true, depthWrite: false, depthTest: true, fog: false,
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
};

export class RocketFx {
  // heat: 0..1; color: the shot's tint; sparks: the pool size (0 = none); cfg: sizes and
  // rates (arcade-look.js ARCADE_LOOK.rocket); sparkRate: a share of the spark rate (Low graphics)
  constructor({ heat = 1, color = 0xff8a1f, sparks = ROCKET_SPARKS, sparkRate = 1, cfg = {} } = {}) {
    this.heat = Math.min(1, Math.max(0, heat));
    this.cfg = cfg;
    this.sparkRate = sparkRate;
    this.stopped = false;
    this._last = null;          // the last frame's time
    this._owed = 0;             // sparks due, carried between frames
    this._aliveUntil = -Infinity;
    let seed = 0x9e3779b9 ^ Math.round(this.heat * 977);
    this._rnd = () => {         // repeatable, so a still captured at a fixed time draws the same sparks
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const c = flameColors(color);
    this.uniforms = {
      uHead: { value: new THREE.Vector3() }, uBack: { value: new THREE.Vector3(0, 0, 1) },
      uUnit: { value: 0.01 }, uLenPx: { value: 0 }, uWidthPx: { value: 0 },
      uColor: { value: c.color }, uDeep: { value: c.deep }, uCore: { value: c.core },
      uTime: { value: 0 }, uHeat: { value: this.heat }, uGlow: { value: 1 }, uSeed: { value: this.heat * 6.283 },
      uDpr: { value: 1 },
    };
    // the flame: a strip from the ball back, turned to the camera in the vertex shader
    const strip = new THREE.PlaneGeometry(1, 2, 10, 1);
    strip.translate(0.5, 0, 0);
    this.flame = new THREE.Mesh(strip, new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG, side: THREE.DoubleSide, ...ADDITIVE }));
    this.flame.name = 'rocketFlame';
    this.flame.frustumCulled = false;
    this.flame.renderOrder = 11;
    this.flame.visible = false;
    this.plume = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: PLUME_VERT, fragmentShader: PLUME_FRAG, ...ADDITIVE }));
    this.plume.name = 'rocketPlume';
    this.plume.frustumCulled = false;
    this.plume.renderOrder = 11;
    this.plume.visible = false;
    this.group = new THREE.Group();
    this.group.name = 'rocketFx';
    this.group.add(this.flame, this.plume);
    this.capacity = Math.max(0, Math.round(sparks));
    this.sparks = null;
    if (this.capacity) {
      const n = this.capacity, g = new THREE.BufferGeometry();
      this._pos = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
      this._vel = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
      this._life = new THREE.BufferAttribute(new Float32Array(n * 4), 4);
      for (let i = 0; i < n; i++) { this._life.array[i * 4] = -1e6; this._life.array[i * 4 + 1] = 1e-3; }   // every slot starts dead
      for (const a of [this._pos, this._vel, this._life]) a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', this._pos);
      g.setAttribute('aVel', this._vel);
      g.setAttribute('aLife', this._life);
      this.sparks = new THREE.Points(g, new THREE.ShaderMaterial({
        uniforms: { uTime: this.uniforms.uTime, uDpr: this.uniforms.uDpr, uColor: this.uniforms.uColor, uDeep: this.uniforms.uDeep, uCore: this.uniforms.uCore },
        vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, ...ADDITIVE,
      }));
      this.sparks.name = 'rocketSparks';
      this.sparks.frustumCulled = false;   // they fly with the ball
      this.sparks.renderOrder = 12;
      this.sparks.visible = false;
      this._next = 0;
      this.group.add(this.sparks);
    }
  }

  // world metres per pixel at a point (never under a centimetre: up close it is a real flame's size)
  _unit(camera, viewportH, at) {
    const pxWorld = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, viewportH);
    return Math.max(0.01, camera.position.distanceTo(at) * pxWorld);
  }

  _spawn(n, time, at, unit, make) {
    if (!this.sparks || n <= 0) return;
    const r = this._rnd;
    for (let k = 0; k < n; k++) {
      const i = this._next;
      this._next = (this._next + 1) % this.capacity;
      const s = make(r);   // { vx, vy, vz (px/s), life, size (px), grav (px/s2), off (px) }
      this._pos.setXYZ(i, at.x + (r() - 0.5) * s.off * unit, at.y + (r() - 0.5) * s.off * unit, at.z + (r() - 0.5) * s.off * unit);
      this._vel.setXYZ(i, s.vx * unit, s.vy * unit, s.vz * unit);
      this._life.setXYZW(i, time + r() * 0.02, s.life, s.size, s.grav * unit);
      this._aliveUntil = Math.max(this._aliveUntil, time + 0.02 + s.life);
    }
    this._pos.needsUpdate = this._vel.needsUpdate = this._life.needsUpdate = true;
    this.sparks.visible = true;
  }

  // Once a frame while the ball flies. time: the scene's frame time (s); head: the ball
  // (world); back: a vector pointing back along its flight (any length; a zero one keeps
  // the last direction); speedK: its speed as a share of launch speed (rocketSpeedK);
  // viewportH in CSS pixels, dpr the renderer's pixel ratio.
  update(time, head, back, speedK, camera, viewportH, dpr = 1) {
    const u = this.uniforms;
    const f = rocketFlame(this.heat, speedK, this.cfg);
    const unit = this._unit(camera, viewportH, head);
    const len = back.length();
    u.uTime.value = time;
    u.uDpr.value = dpr;
    u.uHead.value.copy(head);
    if (len > 1e-6) u.uBack.value.copy(back).multiplyScalar(1 / len);
    u.uUnit.value = unit;
    u.uLenPx.value = f.lengthPx;
    u.uWidthPx.value = f.widthPx;
    u.uGlow.value = f.glow;
    this.flame.visible = this.plume.visible = true;
    // sparks shed from the flame's waist, thrown back and out
    const dt = this._last == null ? 0 : Math.min(0.1, Math.max(0, time - this._last));
    this._last = time;
    this._owed += f.sparksPerS * this.sparkRate * dt;
    const n = Math.floor(this._owed);
    if (n > 0) {
      this._owed -= n;
      const b = u.uBack.value, at = _rocketAt.copy(head).addScaledVector(b, f.lengthPx * 0.3 * unit);
      const [s0, s1] = this.cfg.sparkPx || [3, 6];
      this._spawn(Math.min(n, 12), time, at, unit, (r) => {
        const back = 60 + 150 * r(), out = 55 * (0.4 + this.heat);
        return {
          vx: b.x * back + (r() - 0.5) * out, vy: b.y * back + (r() - 0.5) * out + 18, vz: b.z * back + (r() - 0.5) * out,
          life: ROCKET_SPARK_LIFE_S * (0.6 + 0.8 * r()), size: s0 + (s1 - s0) * r(), grav: 170, off: f.widthPx * 0.5,
        };
      });
    }
  }

  // The ball is down (or the replay is over): the flame goes out. burst: throw a last
  // ring of sparks up from where it came down.
  stop(time, head, camera, viewportH, { burst = true } = {}) {
    if (this.stopped) return;
    this.stopped = true;
    this.flame.visible = this.plume.visible = false;
    this.uniforms.uTime.value = time;
    if (!burst || !this.sparks) return;
    const unit = this._unit(camera, viewportH, head);
    const n = Math.round((this.cfg.burst ?? 34) * (0.4 + 0.6 * this.heat) * Math.min(1, this.sparkRate * 1.5));
    const [s0, s1] = this.cfg.sparkPx || [3, 6];
    this._spawn(Math.min(n, this.capacity), time, head, unit, (r) => {
      const a = r() * Math.PI * 2, out = 40 + 130 * r();
      return { vx: Math.cos(a) * out, vy: 90 + 170 * r(), vz: Math.sin(a) * out, life: ROCKET_SPARK_LIFE_S * (0.9 + 0.9 * r()), size: (s0 + (s1 - s0) * r()) * 1.15, grav: 420, off: 4 };
    });
  }

  // Once a frame after stop(), while its last sparks burn out. Returns false when nothing is left to draw.
  tick(time) {
    this.uniforms.uTime.value = time;
    return time < this._aliveUntil;
  }

  dispose() {
    this.flame.geometry.dispose();
    this.flame.material.dispose();
    this.plume.geometry.dispose();
    this.plume.material.dispose();
    if (this.sparks) { this.sparks.geometry.dispose(); this.sparks.material.dispose(); }
  }
}
const _rocketAt = new THREE.Vector3();
