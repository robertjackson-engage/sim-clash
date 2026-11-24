// v3:living The living world's particles and lights (docs/living-world.md): what
// world-events.js sets off and leaves running. Each system is ONE draw call whatever a stage
// asks of it, and all its motion is the vertex shader reading a clock:
//
//   Emitters   what a stage always does: a volcano's smoke, a waterfall's mist, a geyser on
//              its cycle, fireflies, butterflies. Stateless: a particle's whole life is a
//              function of the time, so nothing is written per frame
//   BurstPool  what a moment sets off: fireworks, a jet of dragon fire, lava bombs, confetti,
//              a splash. Fourteen slots; firing one writes five numbers
//   Weather    snow, ash, blowing sand, drifting mist: one box of points that follows the camera
//   Beams      a lighthouse's sweep and the searchlights: additive cones, instanced
//   ShockRing  the ring a Rocket ball throws across the ground
//
// Nothing here adds a light to the scene, reads a pixel back, or loops a sound.
import * as THREE from 'three';

const OUT_GLSL = /* glsl */`
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
`;
// premultiplied: a fragment writes (rgb * a, a) to be laid over the picture, or (rgb * a, 0) to be added to it
const blendBoth = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, transparent: true, depthWrite: false };
const lin = (hex) => new THREE.Color(hex);
// pixels a metre covers one metre from the lens
export const pxPerMetre = (camera, viewH) => viewH / (2 * Math.tan(((camera.fov || 50) * Math.PI) / 360));

// ---------------------------------------------------------------- emitters
export const EMIT_MODES = Object.freeze({ plume: 0, ballistic: 2, hover: 3, flutter: 4 });
const EMIT_VERT = /* glsl */`
  attribute vec3 aVel;
  attribute vec4 aP;      // life (s), phase (0..1), size (m), mode
  attribute vec4 aCol;    // rgb, and in a: add (1: added to the picture, 0: laid over it) + half its opacity
  attribute vec4 aQ;      // period (s), on (share of the period), emitter phase, random
  uniform float uTime, uPx, uAmb;
  uniform vec3 uWind;
  varying vec4 vCol;
  varying float vAdd, vMode;
  void main() {
    float life = aP.x, mode = aP.w;
    float age = fract(uTime / life + aP.y) * life, u = age / life;
    vec3 p = position;
    float a = 1.0, size = aP.z;
    if (mode < 2.5) {
      // it was thrown out a moment (age) ago: was its emitter running then (a geyser between two blows is not)
      float born = uTime - age;
      float on = aQ.y >= 1.0 ? 1.0 : step(fract(born / aQ.x + aQ.z), aQ.y);
      if (mode < 1.0) {                                       // plume: it rises, widens, leans with the wind, thins away
        p += aVel * age + uWind * age * (0.35 + 0.65 * u);
        p.x += sin(age * 0.7 + aQ.w * 40.0) * (0.4 + u * 1.6);
        size *= 0.6 + 2.6 * u;
        a = sin(3.14159 * sqrt(u)) * on;
      } else {                                                // ballistic: up and over under gravity
        p += aVel * age + uWind * age * 0.2;
        p.y -= 4.9 * age * age;
        size *= 1.0 - 0.4 * u;
        a = (1.0 - u * u) * on;
      }
    } else {                                                  // hover: fireflies; flutter: butterflies
      float ph = aQ.w * 60.0, w = mode > 3.5 ? 3.2 : 1.3;
      p += vec3(sin(uTime * 0.6 + ph) * w, sin(uTime * 0.9 + ph * 1.7) * w * 0.4, cos(uTime * 0.5 + ph * 2.3) * w);
      if (mode > 3.5) { p += aVel * sin(uTime * 0.13 + ph); size *= 0.55 + 0.45 * abs(sin(uTime * 13.0 + ph)); }
      else a = smoothstep(0.1, 0.9, sin(uTime * 1.7 + ph * 3.0));
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float px = size * uPx / max(0.5, -mv.z);
    gl_PointSize = clamp(px, 0.0, 170.0);
    // a puff the lens is inside is a white-out: it thins to nothing close to the camera
    a *= smoothstep(mode < 2.5 ? 6.0 : 1.5, mode < 2.5 ? 22.0 : 4.0, -mv.z) * min(1.0, px * 0.6);
    float add = step(0.75, aCol.a);
    vAdd = add; vMode = mode;
    vCol = vec4(aCol.rgb * mix(uAmb, 1.0, add), a * (aCol.a - add) * 2.0);
  }
`;
const EMIT_FRAG = /* glsl */`
  varying vec4 vCol;
  varying float vAdd, vMode;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0, a;
    if (vMode > 3.5) a = smoothstep(0.5, 0.3, length(vec2(abs(c.x) - 0.22, c.y * 1.25)) * 2.0);   // two wings
    else if (vMode > 2.5) a = pow(max(0.0, 1.0 - d), 2.5);
    else a = smoothstep(1.0, 0.25, d);
    a *= vCol.a;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vCol.rgb * a * (1.0 + 2.2 * vAdd * step(2.5, vMode)), a * (1.0 - vAdd));
    ${OUT_GLSL}
  }
`;

export class Emitters {
  constructor() {
    this.rows = [];       // one row a particle: [x, y, z, vx, vy, vz, life, phase, size, mode, r, g, b, add, period, on, ephase, rnd]
    this.mesh = null;
    this.uniforms = { uTime: { value: 0 }, uPx: { value: 1000 }, uAmb: { value: 1 }, uWind: { value: new THREE.Vector3() } };
  }
  // n particles from `at` (THREE.Vector3). spec: { mode, vel: [x, y, z], velJitter, spread
  // (m round the source), life, size, color, add, period, on, seed, alpha }
  add(at, n, spec, rand) {
    const c = lin(spec.color || '#ffffff'), k = spec.alpha ?? 1, ephase = rand();
    for (let i = 0; i < n; i++) {
      const sp = spec.spread || 0, vj = spec.velJitter || 0, a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * sp;
      const v = spec.vel || [0, 0, 0];
      this.rows.push([
        at.x + Math.cos(a) * r, at.y + (spec.spreadY || 0) * (rand() - 0.5), at.z + Math.sin(a) * r,
        v[0] + (rand() - 0.5) * vj, v[1] * (0.7 + 0.6 * rand()), v[2] + (rand() - 0.5) * vj,
        (spec.life || 4) * (0.75 + 0.5 * rand()), rand(), (spec.size || 1) * (0.7 + 0.6 * rand()), EMIT_MODES[spec.mode] ?? 0,
        c.r, c.g, c.b, (spec.add ? 1 : 0) + 0.5 * Math.min(1, Math.max(0.02, k)), spec.period || 1, spec.on ?? 1, ephase, rand(),
      ]);
    }
  }
  build(group) {
    this.dispose(group);
    const n = this.rows.length;
    if (!n) return null;
    const f = (w, o) => { const a = new Float32Array(n * w); this.rows.forEach((r, i) => { for (let k = 0; k < w; k++) a[i * w + k] = r[o + k]; }); return new THREE.BufferAttribute(a, w); };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', f(3, 0)); g.setAttribute('aVel', f(3, 3)); g.setAttribute('aP', f(4, 6)); g.setAttribute('aCol', f(4, 10)); g.setAttribute('aQ', f(4, 14));
    this.mesh = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: EMIT_VERT, fragmentShader: EMIT_FRAG, ...blendBoth }));
    this.mesh.name = 'world-life:emitters';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    group.add(this.mesh);
    return this.mesh;
  }
  get count() { return this.rows.length; }
  dispose(group) {
    if (this.mesh) { group?.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh = null; }
  }
}

// ---------------------------------------------------------------- bursts
export const BURST_SLOTS = 14;
export const BURST_KINDS = Object.freeze({ sphere: 1, jet: 2, confetti: 3, puff: 4, splash: 5 });
const BURST_VERT = /* glsl */`
  attribute float aSlot;
  attribute vec4 aRnd;
  uniform vec4 uA[${BURST_SLOTS}];   // origin, start time
  uniform vec4 uB[${BURST_SLOTS}];   // colour, kind
  uniform vec4 uC[${BURST_SLOTS}];   // speed (m/s), life (s), size (m), gravity (m/s2; negative: it rises)
  uniform vec4 uD[${BURST_SLOTS}];   // direction, spread
  uniform vec4 uE[${BURST_SLOTS}];   // thrown over this long (s), share of the sparks used, second colour mix, 0
  uniform float uTime, uPx, uAmb;
  varying vec4 vCol;
  varying float vKind, vDay;
  void main() {
    vDay = smoothstep(0.7, 0.95, uAmb);
    int s = int(aSlot + 0.5);
    vec4 A = uA[s], B = uB[s], C = uC[s], D = uD[s], E = uE[s];
    float kind = B.w;
    float life = C.y * (0.65 + 0.35 * aRnd.w);
    float age = uTime - A.w - aRnd.z * E.x;
    gl_PointSize = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vCol = vec4(0.0); vKind = kind;
    if (kind < 0.5 || age < 0.0 || age > life || fract(aRnd.x * 91.7) > E.y) return;
    vec3 rd = normalize(aRnd.xyz * 2.0 - 1.0 + vec3(1e-3, 2e-3, 3e-3));
    vec3 dir = kind < 1.5 ? rd : normalize(D.xyz + rd * D.w);
    if (kind > 4.5) dir = normalize(vec3(rd.x, 0.5 + 0.9 * aRnd.w, rd.z));
    float sp = C.x * (0.5 + 0.5 * fract(aRnd.w * 7.31));
    float drag = kind < 1.5 ? 1.7 : (kind > 3.5 && kind < 4.5 ? 1.3 : 0.3);
    vec3 p = A.xyz + dir * sp * (1.0 - exp(-drag * age)) / drag;
    p.y -= 0.5 * C.w * age * age;
    if (kind > 2.5 && kind < 3.5) { p.x += sin(age * 5.0 + aRnd.x * 40.0) * 0.5; p.z += cos(age * 4.3 + aRnd.y * 40.0) * 0.5; }
    float u = age / life, a, size = C.z;
    vec3 col = B.rgb;
    if (kind < 1.5) { a = (1.0 - u * u) * (0.7 + 0.3 * sin(age * 31.0 + aRnd.x * 50.0)); size *= 1.0 - 0.5 * u; col = mix(col, vec3(1.0), E.z * step(0.7, aRnd.y)); }
    else if (kind < 2.5) { a = 1.0 - u; size *= 0.7 + 1.1 * u; col = mix(vec3(1.0, 0.92, 0.6), col, smoothstep(0.0, 0.45, u)); }
    else if (kind < 3.5) { a = 1.0 - smoothstep(0.75, 1.0, u); col = aRnd.y < 0.34 ? col : (aRnd.y < 0.67 ? vec3(1.0, 0.82, 0.12) : vec3(1.0)); col *= uAmb; size *= 0.6 + 0.4 * abs(sin(age * 9.0 + aRnd.x * 30.0)); }
    else if (kind < 4.5) { a = (1.0 - u) * smoothstep(0.0, 0.12, u) * 0.36; size *= 0.5 + 2.6 * u; col *= mix(uAmb, 1.0, 0.35); }
    else { a = 1.0 - u; size *= 1.0 - 0.3 * u; col *= uAmb; }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(size * uPx / max(0.5, -mv.z), 1.5, 200.0);
    vCol = vec4(col, a * smoothstep(1.0, 4.0, -mv.z));
  }
`;
const BURST_FRAG = /* glsl */`
  varying vec4 vCol;
  varying float vKind, vDay;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0, a, add = 1.0, gain = 2.6;
    if (vKind > 2.5 && vKind < 3.5) { a = step(abs(c.x), 0.36) * step(abs(c.y), 0.2); add = 0.0; gain = 1.0; }          // a slip of paper
    else if (vKind > 3.5) { a = smoothstep(1.0, 0.2, d); add = 0.0; gain = 1.0; }                                         // smoke, spray
    else { a = pow(max(0.0, 1.0 - d), 2.0); add = 1.0 - 0.8 * vDay; gain = 2.6 - 1.2 * vDay; a = min(1.0, a * (1.0 + 1.5 * vDay)); }   // a spark: by day it is laid over the bright sky as well as added to it
    a *= vCol.a;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vCol.rgb * a * gain, a * (1.0 - add));
    ${OUT_GLSL}
  }
`;

export class BurstPool {
  constructor(perSlot = 96) {
    this.perSlot = perSlot;
    const vec = () => Array.from({ length: BURST_SLOTS }, () => new THREE.Vector4(0, 0, 0, 0));
    this.uniforms = { uA: { value: vec() }, uB: { value: vec() }, uC: { value: vec() }, uD: { value: vec() }, uE: { value: vec() }, uTime: { value: 0 }, uPx: { value: 1000 }, uAmb: { value: 1 } };
    this.until = new Float32Array(BURST_SLOTS).fill(-1);
    this.next = 0;
    this.mesh = null;
    this.fired = 0;
  }
  build(group, rand) {
    const n = BURST_SLOTS * this.perSlot;
    const g = new THREE.BufferGeometry();
    const slot = new Float32Array(n), rnd = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { slot[i] = Math.floor(i / this.perSlot); for (let k = 0; k < 4; k++) rnd[i * 4 + k] = rand(); }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSlot', new THREE.BufferAttribute(slot, 1));
    g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 4));
    this.mesh = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: BURST_VERT, fragmentShader: BURST_FRAG, ...blendBoth }));
    this.mesh.name = 'world-life:bursts';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 34;
    this.mesh.visible = false;
    group.add(this.mesh);
  }
  // Set one off at `at` (THREE.Vector3) at time t. { kind, color, speed, life, size, gravity,
  // dir: [x, y, z], spread, over (s), share (0..1 of the sparks), white (share turned white) }.
  // Returns the slot. The oldest slot is taken when all fourteen are burning.
  fire(t, at, o = {}) {
    if (!this.mesh) return -1;
    let s = -1;
    for (let i = 0; i < BURST_SLOTS; i++) { const k = (this.next + i) % BURST_SLOTS; if (this.until[k] <= t) { s = k; break; } }
    if (s < 0) s = this.next;
    this.next = (s + 1) % BURST_SLOTS;
    const u = this.uniforms, c = lin(o.color || '#ffd21f'), life = o.life ?? 1.6, d = o.dir || [0, 1, 0];
    u.uA.value[s].set(at.x, at.y, at.z, t);
    u.uB.value[s].set(c.r, c.g, c.b, BURST_KINDS[o.kind] || 1);
    u.uC.value[s].set(o.speed ?? 16, life, o.size ?? 1.2, o.gravity ?? 2.5);
    u.uD.value[s].set(d[0], d[1], d[2], o.spread ?? 0.25);
    u.uE.value[s].set(o.over ?? 0, o.share ?? 1, o.white ?? 0, 0);
    this.until[s] = t + life + (o.over ?? 0);
    this.fired++;
    return s;
  }
  update(t) {
    this.uniforms.uTime.value = t;
    if (!this.mesh) return;
    let live = false;
    for (let i = 0; i < BURST_SLOTS; i++) if (this.until[i] > t) { live = true; break; }
    this.mesh.visible = live;
  }
  get live() { return !!(this.mesh && this.mesh.visible); }
  dispose(group) {
    if (this.mesh) { group?.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh = null; }
    this.until.fill(-1);
  }
}

// ---------------------------------------------------------------- weather
// type -> how its box of points looks and moves. fall: m/s down; drift: x the hole's wind;
// box: metres round the camera; glow: share of the points that are embers.
export const WEATHER = Object.freeze({
  snow:   { color: '#ffffff', size: 0.1, alpha: 0.85, fall: 1.25, drift: 0.55, sway: 0.5, box: [56, 30, 56], mode: 0, glow: 0, share: 1 },
  ash:    { color: '#4a4542', size: 0.095, alpha: 0.8, fall: 0.45, drift: 0.5, sway: 0.7, box: [56, 28, 56], mode: 0, glow: 0.18, share: 0.8 },
  petals: { color: '#ffc4dc', size: 0.085, alpha: 0.85, fall: 0.6, drift: 0.7, sway: 0.9, box: [60, 26, 60], mode: 0, glow: 0, share: 0.35 },
  sand:   { color: '#fff1cf', size: 0.7, alpha: 0.34, fall: 0.05, drift: 1.6, sway: 0.2, box: [70, 8, 70], mode: 1, glow: 0, share: 0.7, minWind: 4 },
  mist:   { color: '#dcefe2', size: 15, alpha: 0.05, fall: 0, drift: 0.35, sway: 0.1, box: [190, 16, 190], mode: 2, glow: 0, share: 0.022, minWind: 2 },
  rain:   { color: '#bcd0e0', size: 0.22, alpha: 0.3, fall: 9, drift: 0.9, sway: 0, box: [50, 30, 50], mode: 1, glow: 0, share: 0.9 },
});
const WEATHER_VERT = /* glsl */`
  attribute float aRnd;
  uniform vec3 uBox, uCam, uVel, uColor;
  uniform float uTime, uPx, uSize, uAlpha, uSway, uMode, uGlow, uShare, uAmb;
  varying vec4 vCol;
  varying float vMode;
  void main() {
    vec3 home = position * uBox + uVel * uTime;
    home.x += sin(uTime * 0.6 + aRnd * 60.0) * uSway;
    home.z += cos(uTime * 0.5 + aRnd * 47.0) * uSway;
    vec3 rel = mod(home - uCam, uBox) - 0.5 * uBox;
    vec4 mv = viewMatrix * vec4(uCam + rel, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = -mv.z;
    float px = uSize * (0.7 + 0.6 * fract(aRnd * 13.7)) * uPx / max(0.5, dist);
    float cap = uMode > 1.5 ? 210.0 : (uMode > 0.5 ? 46.0 : 9.0);
    gl_PointSize = clamp(px, 1.2, cap);
    float edge = 1.0 - smoothstep(0.36, 0.5, max(abs(rel.x) / uBox.x, abs(rel.z) / uBox.z));
    // nothing within a few metres of the lens: a flake on the camera is a white blob, and a
    // small pale thing close to the line of sight is the one thing that could pass for a ball
    float near = uMode > 1.5 ? smoothstep(20.0, 60.0, dist) : smoothstep(3.5, 8.0, dist);
    float ember = step(1.0 - uGlow, fract(aRnd * 7.77));
    float on = step(fract(aRnd * 3.33), uShare);
    vCol = vec4(mix(uColor * uAmb, vec3(1.0, 0.45, 0.12) * 2.4, ember), uAlpha * edge * near * on * min(1.0, px));
    vMode = uMode + ember * 0.25;
  }
`;
const WEATHER_FRAG = /* glsl */`
  varying vec4 vCol;
  varying float vMode;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float a;
    if (vMode > 1.5) a = smoothstep(0.5, 0.0, length(c));                                    // a wisp of mist
    else if (vMode > 0.9) a = smoothstep(0.5, 0.1, abs(c.y) * 9.0) * smoothstep(0.5, 0.05, abs(c.x));  // a streak
    else a = smoothstep(0.5, 0.15, length(c));
    float add = step(0.2, fract(vMode));                                                     // an ember is added, the rest laid over
    // a flake has a faint shadow round it: white snow falling in front of white snow is
    // otherwise not there at all (it shows as a speck of grey on snow, of white on the pines)
    float halo = vMode < 0.2 ? smoothstep(0.5, 0.22, length(c)) * 0.3 : 0.0;
    float core = vMode < 0.2 ? smoothstep(0.34, 0.1, length(c)) : a;
    a = core * vCol.a;
    float cover = max(core, halo) * vCol.a;
    if (cover < 0.003) discard;
    gl_FragColor = vec4(vCol.rgb * a, cover * (1.0 - add));
    ${OUT_GLSL}
  }
`;

export class Weather {
  constructor() {
    this.mesh = null;
    this.type = null;
    this.uniforms = {
      uBox: { value: new THREE.Vector3(60, 30, 60) }, uCam: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color('#fff') },
      uTime: { value: 0 }, uPx: { value: 1000 }, uSize: { value: 0.06 }, uAlpha: { value: 0.7 }, uSway: { value: 0.4 }, uMode: { value: 0 }, uGlow: { value: 0 }, uShare: { value: 1 }, uAmb: { value: 1 },
    };
  }
  // type: a WEATHER key; n: points; amount: 0 .. 1.5 of the type's own density
  build(group, type, n, amount, rand) {
    this.dispose(group);
    const W = WEATHER[type];
    if (!W || n <= 0) return;
    this.type = type;
    this.spec = W;
    const pos = new Float32Array(n * 3), rnd = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = rand(); pos[i * 3 + 1] = rand(); pos[i * 3 + 2] = rand(); rnd[i] = rand(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
    const u = this.uniforms;
    u.uBox.value.set(...W.box); u.uColor.value.set(W.color); u.uSize.value = W.size; u.uAlpha.value = W.alpha; u.uSway.value = W.sway;
    u.uMode.value = W.mode; u.uGlow.value = W.glow; u.uShare.value = Math.min(1, W.share * Math.max(0.1, amount));
    this.mesh = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: u, vertexShader: WEATHER_VERT, fragmentShader: WEATHER_FRAG, ...blendBoth }));
    this.mesh.name = `world-life:weather-${type}`;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    group.add(this.mesh);
  }
  // wind: three-space m/s { x, z }
  update(t, camera, windX, windZ, mph) {
    if (!this.mesh) return;
    const u = this.uniforms, W = this.spec;
    u.uTime.value = t;
    u.uCam.value.copy(camera.position);
    u.uVel.value.set(windX * W.drift, -W.fall, windZ * W.drift);
    // blowing sand and drifting mist need a wind to be there at all
    this.mesh.visible = !(W.minWind && mph < W.minWind);
  }
  dispose(group) {
    if (this.mesh) { group?.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh = null; }
    this.type = null;
  }
}

// ---------------------------------------------------------------- beams
const BEAM_VERT = /* glsl */`
  attribute vec4 aBeam;   // rgb, strength
  varying vec4 vBeam;
  varying float vAlong, vRim;
  void main() {
    vAlong = position.z;
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vec3 n = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vRim = abs(dot(n, normalize(cameraPosition - wp.xyz)));
    vBeam = aBeam;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const BEAM_FRAG = /* glsl */`
  varying vec4 vBeam;
  varying float vAlong, vRim;
  void main() {
    // (max: a negative base is NaN, and one NaN pixel in the bloom is a black frame)
    float a = pow(max(0.0, 1.0 - vAlong), 1.6) * smoothstep(0.0, 0.55, vRim) * vBeam.a * smoothstep(0.0, 0.03, max(0.0, vAlong));
    gl_FragColor = vec4(vBeam.rgb * a, 0.0);
    ${OUT_GLSL}
  }
`;
export class Beams {
  constructor() { this.mesh = null; this.n = 0; }
  build(group, n) {
    this.dispose(group);
    this.n = n;
    if (!n) return;
    // apex at the origin, opening along +z to radius 1 at z = 1
    const g = new THREE.ConeGeometry(1, 1, 14, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    g.setAttribute('aBeam', this.attr);
    this.mesh = new THREE.InstancedMesh(g, new THREE.ShaderMaterial({ vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, ...blendBoth, side: THREE.DoubleSide }), n);
    this.mesh.name = 'world-life:beams';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 32;
    group.add(this.mesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._z = new THREE.Vector3(0, 0, 1); this._d = new THREE.Vector3();
  }
  // beam i from `from` toward `to` (THREE.Vector3), `len` metres long, opening to `radius`
  set(i, from, to, len, radius, color, strength) {
    if (!this.mesh || i >= this.n) return;
    this._d.subVectors(to, from).normalize();
    this._q.setFromUnitVectors(this._z, this._d);
    this._m.compose(from, this._q, this._s.set(radius, radius, len));
    this.mesh.setMatrixAt(i, this._m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.attr.setXYZW(i, color.r, color.g, color.b, strength);
    this.attr.needsUpdate = true;
  }
  dispose(group) {
    if (this.mesh) { group?.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.dispose?.(); this.mesh = null; }
    this.n = 0;
  }
}

// ---------------------------------------------------------------- the shock ring
export const RING_SEGMENTS = 72;
export class ShockRing {
  constructor() { this.mesh = null; this.t0 = -1; }
  build(group) {
    if (this.mesh) return;
    const n = RING_SEGMENTS + 1, pos = new Float32Array(n * 3 * 3), col = new Float32Array(n * 3 * 3), idx = [];
    for (let i = 0; i < n; i++) { const o = (i * 3 + 1) * 3; col[o] = col[o + 1] = col[o + 2] = 1; }   // the middle of the band is lit, its edges are not
    for (let i = 0; i < RING_SEGMENTS; i++) { const a = i * 3, b = a + 3; idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: 0xffffff, fog: false }));
    this.mesh.name = 'world-life:shock';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    group.add(this.mesh);
  }
  fire(t, x, y, color = '#ffe2a8', { speed = 58, life = 2.2 } = {}) {
    this.t0 = t; this.x = x; this.y = y; this.speed = speed; this.life = life; this.z0 = null;
    this.mesh?.material.color.set(color).multiplyScalar(1.5);     // over the bloom's threshold: it glows
  }
  // groundAt(x, y) -> course z; V(x, y, z) -> THREE.Vector3
  update(t, groundAt, V) {
    if (!this.mesh) return;
    const age = t - this.t0;
    if (this.t0 < 0 || age < 0 || age > this.life) { this.mesh.visible = false; return; }
    const u = age / this.life, r = 2 + this.speed * age * (1 - 0.35 * u), w = 2.5 + 13 * u;
    if (this.z0 === null) this.z0 = groundAt(this.x, this.y);
    const pos = this.mesh.geometry.attributes.position;
    for (let i = 0; i <= RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
      for (let k = 0; k < 3; k++) {
        const rr = r + (k - 1) * w, x = this.x + s * rr, y = this.y + c * rr;
        // it hugs the ground, but off the edge of a tee on a cliff it carries on through the air,
        // sinking gently: a ring that dropped straight down the cliff was never seen from the tee
        const p = V(x, y, Math.max(groundAt(x, y), this.z0 - 0.22 * Math.max(0, rr - 10)) + 0.4 + (k === 1 ? 0.9 : 0));
        pos.setXYZ(i * 3 + k, p.x, p.y, p.z);
      }
    }
    pos.needsUpdate = true;
    this.mesh.material.opacity = Math.pow(1 - u, 1.5);
    this.mesh.visible = true;
  }
  get live() { return !!(this.mesh && this.mesh.visible); }
  dispose(group) {
    if (this.mesh) { group?.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh = null; }
    this.t0 = -1;
  }
}

// ---------------------------------------------------------------- an airship's sign
// The words that run along an airship's flank: a canvas, repeated, scrolled by its offset.
// null without a DOM (the tests).
export function paintSign(canvas, text, { color = '#ffd21f', bg = '#0b0e18' } = {}) {
  if (canvas.width !== 1024) { canvas.width = 1024; canvas.height = 128; }
  const g = canvas.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 1024, 128);
  g.fillStyle = color; g.textBaseline = 'middle'; g.textAlign = 'center';
  let px = 92;
  g.font = `900 ${px}px Arial, Helvetica, sans-serif`;
  const msg = `${text}  ★  `;
  while (px > 40 && g.measureText(msg).width > 1010) { px -= 4; g.font = `900 ${px}px Arial, Helvetica, sans-serif`; }
  g.fillText(msg, 512, 68);
  // the lamps of a dot-matrix board
  g.fillStyle = 'rgba(0,0,0,0.28)';
  for (let y = 0; y < 128; y += 4) g.fillRect(0, y, 1024, 1);
  for (let x = 0; x < 1024; x += 4) g.fillRect(x, 0, 1, 128);
  return canvas;
}
