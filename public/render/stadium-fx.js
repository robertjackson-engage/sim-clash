// v3:stadium Light and atmosphere for a night stadium, and the fireworks of a win:
//
//   beams      a soft cone of haze from each floodlight bank toward the pitch
//   flares     a glare on each lamp that the stands in front of it hide
//   confetti   paper from the cannons at the rim           fx.fire('confetti')
//   pyro       flame jets at the same cannons              fx.fire('pyro')
//   fireworks  shells bursting over the arena              fx.fire('fireworks')
//                                                          fx.fire('win'): all three, staggered
//
// Each is ONE instanced draw (an InstancedBufferGeometry: a small shape, its copies as
// per-instance attributes), and all its motion is the vertex shader reading a start time.
// update() sets a time, the lens and which of the five are visible: no JavaScript runs per
// lamp, per paper or per spark, and no light is added to the scene. Before the first fire()
// and after a shot has burned out its mesh is not drawn at all.
import * as THREE from 'three';

export const FX_TIMES = Object.freeze({
  confettiLife: 7, confettiSpread: 0.6,     // a paper lives 7 s; the cannons fire over 0.6 s
  pyroShot: 1.2, pyroGap: 0.9,              // a jet burns 1.2 s; shots 0.9 s apart
  fireworksLaunch: 3.5, sparkLife: 1.6,     // shells go up over 3.5 s; a burst hangs 1.6 s
});
export const FX_KINDS = Object.freeze(['confetti', 'pyro', 'fireworks', 'win']);
export const FX_COUNTS = Object.freeze({ confetti: 2400, confettiLow: 800, shells: 12, sparks: 90, maxBeams: 28 });

// What a fire() schedules: [{ what, delay, life, shots? }] (seconds). intensity scales how
// much goes off (papers, shells) and, for pyro alone, how many shots (2 = two, 3 = three).
export function fxTimeline(kind, intensity = 1) {
  const k = Number.isFinite(intensity) && intensity > 0 ? intensity : 1;
  const pyro = (shots, delay = 0) => ({ what: 'pyro', delay, shots, life: (shots - 1) * FX_TIMES.pyroGap + FX_TIMES.pyroShot });
  const confetti = (delay = 0) => ({ what: 'confetti', delay, life: FX_TIMES.confettiLife + FX_TIMES.confettiSpread });
  const fireworks = (delay = 0) => ({ what: 'fireworks', delay, life: FX_TIMES.fireworksLaunch + FX_TIMES.sparkLife });
  if (kind === 'confetti') return [confetti()];
  if (kind === 'pyro') return [pyro(Math.max(1, Math.min(3, Math.round(k))))];
  if (kind === 'fireworks') return [fireworks()];
  if (kind === 'win') return [pyro(3), confetti(0.15), fireworks(0.8)];
  return [];
}

const NOISE_GLSL = /* glsl */`
  float fxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float fxNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(fxHash(i), fxHash(i + vec2(1.0, 0.0)), f.x), mix(fxHash(i + vec2(0.0, 1.0)), fxHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;
const OUT_GLSL = /* glsl */`
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
`;

// ---- beams
export const BEAM_VERTEX = /* glsl */`
  attribute vec3 aFrom;       // the lamp
  attribute vec4 aAxis;       // the way it shines (unit), and how far
  attribute vec2 aShape;      // the cone's radius at its far end, the lamp's power
  varying float vLen;
  varying float vEdge;
  varying float vPow;
  varying vec3 vWorld;
  void main() {
    vec3 d = aAxis.xyz;
    vec3 ref = abs(d.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 bx = normalize(cross(ref, d));
    vec3 bz = cross(d, bx);
    vec3 radial = bx * position.x + bz * position.z;
    vec3 wp = aFrom + radial * aShape.x + d * (-position.y) * aAxis.w;
    // soft at the silhouette: the cone's skin seen edge-on adds nothing
    vEdge = abs(dot(normalize(radial + bx * 1e-4), normalize(cameraPosition - wp + vec3(0.0, 1e-4, 0.0))));   // (never a zero vector: a NaN here poisons every frame after it through the bloom)
    vLen = -position.y;
    vPow = aShape.y;
    vWorld = wp;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;
export const BEAM_FRAGMENT = /* glsl */`
  uniform float uFxTime;
  uniform vec3 uBeamColor;
  uniform float uBeamGain;
  varying float vLen;
  varying float vEdge;
  varying float vPow;
  varying vec3 vWorld;
  ${NOISE_GLSL}
  void main() {
    float along = pow(clamp(1.0 - vLen, 0.0, 1.0), 1.6) * smoothstep(0.0, 0.05, vLen);
    float edge = pow(clamp(vEdge, 0.0, 1.0), 1.5);
    float haze = 0.7 + 0.3 * fxNoise(vWorld.xz * 0.045 + vec2(uFxTime * 0.05, vWorld.y * 0.03 - uFxTime * 0.02));
    gl_FragColor = vec4(uBeamColor * (along * edge * haze * uBeamGain * vPow), 1.0);
    ${OUT_GLSL}
  }
`;

// ---- flares
export const FLARE_VERTEX = /* glsl */`
  attribute vec3 aFrom;       // the lamp
  attribute vec4 aShine;      // the way it shines (unit), its power
  uniform float uFxLens;      // tan(half the vertical field of view)
  uniform float uFlareSize;   // the glare's height as a share of the screen's
  varying vec2 vP;
  varying float vI;
  void main() {
    vec3 toCam = cameraPosition - aFrom;
    float dist = max(1.0, length(toCam));
    // brightest when the lamp shines at the lens, nothing from behind it
    float facing = max(0.0, dot(aShine.xyz, toCam / dist));
    float size = clamp(uFlareSize * 2.0 * dist * uFxLens, 1.2, 26.0);
    vec4 mv = viewMatrix * vec4(aFrom, 1.0);
    mv.z += min(2.0, dist * 0.2);   // a little toward the eye: clear of its own housing, still behind the stand in front
    vP = vec2(position.x * 4.0, position.y);
    mv.xy += vP * size * step(0.001, facing);
    vI = facing * facing * aShine.w;
    gl_Position = projectionMatrix * mv;
  }
`;
export const FLARE_FRAGMENT = /* glsl */`
  uniform vec3 uFlareColor;
  uniform float uFlareGain;
  varying vec2 vP;
  varying float vI;
  void main() {
    float d = length(vP) * 2.0;
    float disc = pow(max(0.0, 1.0 - d), 2.2);
    float core = pow(max(0.0, 1.0 - d * 3.0), 2.0);
    float streak = exp(-abs(vP.y) * 22.0) * pow(max(0.0, 1.0 - abs(vP.x) * 0.5), 2.0);
    gl_FragColor = vec4(uFlareColor * ((disc * 0.5 + core * 1.6 + streak * 0.35) * vI * uFlareGain), 1.0);
    ${OUT_GLSL}
  }
`;

// ---- confetti
export const CONFETTI_VERTEX = /* glsl */`
  attribute vec4 aBorn;       // where it leaves the cannon, and when (s after the shot)
  attribute vec4 aVel;        // its launch velocity, a phase 0..1
  attribute vec4 aTint;       // its colour, its rank 0..1 (a weak shot fires the low ranks only)
  uniform float uFxTime;
  uniform vec4 uConfetti;     // the shot's time, a paper's life, the shot's strength, a paper's size
  varying vec3 vCol;
  void main() {
    float t = uFxTime - uConfetti.x - aBorn.w;
    float alive = step(0.0, t) * step(t, uConfetti.y) * step(aTint.w, uConfetti.z);
    float tt = clamp(t, 0.0, uConfetti.y);
    float e = (1.0 - exp(-1.1 * tt)) / 1.1;
    vec3 p = aBorn.xyz + aVel.xyz * e;
    p.y -= 2.4 * (tt - e);                                   // the launch spent, it falls at paper's pace
    float drift = min(tt, 1.5) * 0.5;
    p.x += sin(tt * 2.3 + aVel.w * 6.2831853) * drift;
    p.z += cos(tt * 1.9 + aVel.w * 4.1) * drift;
    // it tumbles about its own axis, and glints as it turns to the light
    float a = tt * (5.0 + aTint.w * 7.0) + aVel.w * 6.2831853;
    vec3 ax = normalize(vec3(sin(aVel.w * 31.0), cos(aVel.w * 17.0), sin(aVel.w * 53.0 + 1.0)) + vec3(0.0, 0.001, 0.0));
    float ca = cos(a), sa = sin(a);
    vec3 q = vec3(position.x * uConfetti.w, position.y * uConfetti.w * 0.6, 0.0);
    q = q * ca + cross(ax, q) * sa + ax * dot(ax, q) * (1.0 - ca);
    vec3 n = vec3(0.0, 0.0, 1.0);
    n = n * ca + cross(ax, n) * sa + ax * dot(ax, n) * (1.0 - ca);
    vCol = aTint.rgb * (0.55 + 0.75 * abs(dot(n, vec3(0.3015, 0.8542, 0.4020))));
    float shrink = 1.0 - smoothstep(uConfetti.y - 1.0, uConfetti.y, tt);
    gl_Position = projectionMatrix * viewMatrix * vec4(p + q * alive * shrink, 1.0);
  }
`;
export const CONFETTI_FRAGMENT = /* glsl */`
  varying vec3 vCol;
  void main() {
    gl_FragColor = vec4(vCol, 1.0);
    ${OUT_GLSL}
  }
`;

// ---- pyro
export const PYRO_VERTEX = /* glsl */`
  attribute vec4 aBase;       // the jet's foot, its full height
  attribute float aSeed;
  uniform float uFxTime;
  uniform vec4 uPyro;         // the first shot's time, how many shots, the gap between them, a shot's burn
  varying vec2 vUv;
  varying float vE;
  varying float vSeed;
  void main() {
    float t = uFxTime - uPyro.x;
    float shot = clamp(floor(t / uPyro.z), 0.0, uPyro.y - 1.0);
    float tau = t - shot * uPyro.z;
    float e = t < 0.0 ? 0.0 : smoothstep(0.0, 0.08, tau) * (1.0 - smoothstep(uPyro.w * 0.6, uPyro.w, tau));
    float w = 2.6 * (0.7 + 0.3 * e);
    vec3 wp = aBase.xyz + vec3(position.x * w, position.y * aBase.w * e, position.z * w);
    vUv = uv;
    vE = e;
    vSeed = aSeed;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;
export const PYRO_FRAGMENT = /* glsl */`
  uniform float uFxTime;
  uniform float uPyroGain;
  varying vec2 vUv;
  varying float vE;
  varying float vSeed;
  ${NOISE_GLSL}
  void main() {
    float y = vUv.y;
    float x = abs(vUv.x - 0.5) * 2.0;
    float n = fxNoise(vec2(vUv.x * 4.0 + vSeed * 9.0, y * 5.0 - uFxTime * 9.0));
    float w = pow(max(0.0, 1.0 - y), 0.7) * (0.5 + 0.5 * n) + 0.001;
    float m = (1.0 - smoothstep(w * 0.25, w, x)) * smoothstep(0.0, 0.06, y);
    vec3 c = mix(vec3(1.0, 0.25, 0.04), vec3(1.0, 0.72, 0.22), m);
    c = mix(c, vec3(1.0, 0.96, 0.85), m * m * (1.0 - y));
    gl_FragColor = vec4(c * (m * vE * uPyroGain), 1.0);
    ${OUT_GLSL}
  }
`;

// ---- fireworks
export const FIREWORK_VERTEX = /* glsl */`
  attribute vec4 aShell;      // where in the sky zone it bursts (-1 .. 1 each way), and when (0 .. 1 of the launch time)
  attribute vec4 aSpark;      // the spark's way out of the burst (its length is its speed), a seed
  attribute vec4 aTint;       // the shell's colour, its rank 0..1 (a weak volley fires the low ranks only)
  uniform float uFxTime;
  uniform float uFxLens;
  uniform vec4 uFw;           // the volley's time, a spark's life, the volley's strength, the launch time
  uniform vec4 uFwZone;       // the sky zone: its middle, its radius
  uniform float uFwSize;
  varying vec2 vP;
  varying vec3 vCol;
  void main() {
    float t = uFxTime - uFw.x - aShell.w * uFw.w;
    float alive = step(0.0, t) * step(t, uFw.y) * step(aTint.w, uFw.z);
    float tt = clamp(t, 0.0, uFw.y);
    vec3 c = uFwZone.xyz + aShell.xyz * vec3(uFwZone.w, uFwZone.w * 0.35, uFwZone.w);
    vec3 p = c + aSpark.xyz * (uFwZone.w * 0.34) * (1.0 - exp(-3.2 * tt));
    p.y -= 3.0 * tt * tt;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    // never smaller than a pixel or two: a burst a long way off still sparkles
    float size = max(uFwSize * (1.0 - 0.6 * tt / uFw.y), 0.006 * (-mv.z) * uFxLens);
    vP = position.xy;
    mv.xy += position.xy * size * alive;
    float fade = 1.0 - smoothstep(0.55 * uFw.y, uFw.y, tt);
    float twinkle = 0.7 + 0.3 * sin(tt * 30.0 + aSpark.w * 40.0);
    vCol = mix(vec3(1.0), aTint.rgb, smoothstep(0.0, 0.3, tt)) * fade * twinkle;
    gl_Position = projectionMatrix * mv;
  }
`;
export const FIREWORK_FRAGMENT = /* glsl */`
  uniform float uFwGain;
  varying vec2 vP;
  varying vec3 vCol;
  void main() {
    float d = length(vP) * 2.0;
    float a = pow(max(0.0, 1.0 - d), 1.5);
    gl_FragColor = vec4(vCol * (a * uFwGain), 1.0);
    ${OUT_GLSL}
  }
`;

// a stable 0..1 number
function hash(i, salt = 0) {
  let h = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

const CONFETTI_COLORS = ['#ff3b30', '#ffd21f', '#2f7bff', '#ff4fd8', '#34c759', '#ff9f0a', '#f4f4ee', '#3df2ff'];
const SHELL_COLORS = ['#ff4a3a', '#ffd21f', '#4fa3ff', '#ff5fd8', '#5cff9d', '#ffa53a', '#c59bff', '#f4f4ee'];

// an open cone down the -y axis: radius 0.06 at the lamp (y = 0), 1 at its far end (y = -1)
function coneGeometry(sides = 16) {
  const pos = [];
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const t0 = [Math.cos(a0) * 0.06, 0, Math.sin(a0) * 0.06], t1 = [Math.cos(a1) * 0.06, 0, Math.sin(a1) * 0.06];
    const b0 = [Math.cos(a0), -1, Math.sin(a0)], b1 = [Math.cos(a1), -1, Math.sin(a1)];
    pos.push(...t0, ...b0, ...b1, ...t0, ...b1, ...t1);
  }
  return new THREE.Float32BufferAttribute(pos, 3);
}
// a unit quad in x, y about the origin
const quadGeometry = () => new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3);

export class StadiumFx {
  // scene: the THREE.Scene; V(x, y, z): course -> three (x, z, -y); quality(): 'low' | 'high'
  // | 'ultra'; night(): is the stage lit by its floodlights (beams and flares are for the dark)
  constructor({ scene, V = null, quality = () => 'high', night = () => true } = {}) {
    this.scene = scene;
    this.V = V || ((x, y, z) => new THREE.Vector3(x, z, -y));
    this.quality = quality;
    this.night = night;
    this.group = null;
    this._t = 0;
    this._queue = [];                                   // shots waiting for their moment
    this._until = { confetti: -1, pyro: -1, fireworks: -1 };
    this._lamps = [];
    this._cannons = [];
    this._zone = null;
    this.beams = this.flares = this.confetti = this.pyro = this.fireworks = null;
    const far = -1e6;
    this.uniforms = {
      uFxTime: { value: 0 },
      uFxLens: { value: Math.tan(29 * Math.PI / 180) },
      uBeamColor: { value: new THREE.Color(0.82, 0.9, 1.0) },
      uBeamGain: { value: 0.07 },                       // a layer; the two skins of a cone add to about 0.14 at its brightest
      uFlareColor: { value: new THREE.Color(1.0, 0.97, 0.9) },
      uFlareGain: { value: 1.0 },
      uFlareSize: { value: 0.036 },
      uConfetti: { value: new THREE.Vector4(far, FX_TIMES.confettiLife, 1, 0.3) },
      uPyro: { value: new THREE.Vector4(far, 1, FX_TIMES.pyroGap, FX_TIMES.pyroShot) },
      uPyroGain: { value: 1.5 },
      uFw: { value: new THREE.Vector4(far, FX_TIMES.sparkLife, 1, FX_TIMES.fireworksLaunch) },
      uFwZone: { value: new THREE.Vector4(0, 80, 0, 60) },
      uFwSize: { value: 0.9 },
      uFwGain: { value: 3.0 },
    };
  }

  _group() {
    if (!this.group) {
      this.group = new THREE.Group();
      this.group.name = 'stadium-fx';
      this.scene.add(this.group);
    }
    return this.group;
  }

  _material(name, vertexShader, fragmentShader, extra = {}) {
    const m = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader, ...extra });
    m.name = `stadium-fx:${name}`;
    return m;
  }

  _add(name, geometry, material, order = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `stadium-fx:${name}`;
    mesh.frustumCulled = false;            // its copies are placed by the shader, all over the arena
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = order;
    mesh.visible = false;
    this._group().add(mesh);
    return mesh;
  }

  _drop(key) {
    const mesh = this[key];
    if (!mesh) return;
    this.group?.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    this[key] = null;
  }

  // The floodlight banks: [{ x, y, z, tx, ty, tz, power? }] (course metres): where each
  // hangs and the point on the pitch it is aimed at. Replaces the last set.
  setLamps(lamps) {
    this._drop('beams');
    this._drop('flares');
    const ok = (v) => typeof v === 'number' && Number.isFinite(v);
    this._lamps = (Array.isArray(lamps) ? lamps : []).filter((l) => l && [l.x, l.y, l.z, l.tx, l.ty, l.tz].every(ok));
    const n = this._lamps.length;
    if (!n) return;
    const additive = { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide };
    const from = new Float32Array(n * 3), shine = new Float32Array(n * 4), reach = new Float32Array(n);
    this._lamps.forEach((l, i) => {
      const a = this.V(l.x, l.y, l.z), b = this.V(l.tx, l.ty, l.tz), d = b.sub(a);
      reach[i] = d.length();
      d.normalize();
      from.set([a.x, a.y, a.z], i * 3);
      shine.set([d.x, d.y, d.z, ok(l.power) ? l.power : 1], i * 4);
    });
    // the glare: every lamp
    const fg = new THREE.InstancedBufferGeometry();
    fg.setAttribute('position', quadGeometry());
    fg.setAttribute('aFrom', new THREE.InstancedBufferAttribute(from, 3));
    fg.setAttribute('aShine', new THREE.InstancedBufferAttribute(shine, 4));
    fg.instanceCount = n;
    this.flares = this._add('flares', fg, this._material('flares', FLARE_VERTEX, FLARE_FRAGMENT, additive), 31);
    // the haze: not on low graphics, and never more cones than the fill rate can carry
    if ((this.quality() || 'high') !== 'low') {
      const every = Math.max(1, Math.ceil(n / FX_COUNTS.maxBeams)), picks = [];
      for (let i = 0; i < n; i += every) picks.push(i);
      const m = picks.length, bf = new Float32Array(m * 3), axis = new Float32Array(m * 4), shape = new Float32Array(m * 2);
      picks.forEach((i, j) => {
        const len = reach[i] * 0.92;
        bf.set(from.subarray(i * 3, i * 3 + 3), j * 3);
        axis.set([shine[i * 4], shine[i * 4 + 1], shine[i * 4 + 2], len], j * 4);
        shape.set([Math.max(3, len * 0.2), shine[i * 4 + 3] * Math.sqrt(every)], j * 2);
      });
      const bg = new THREE.InstancedBufferGeometry();
      bg.setAttribute('position', coneGeometry(16));
      bg.setAttribute('aFrom', new THREE.InstancedBufferAttribute(bf, 3));
      bg.setAttribute('aAxis', new THREE.InstancedBufferAttribute(axis, 4));
      bg.setAttribute('aShape', new THREE.InstancedBufferAttribute(shape, 2));
      bg.instanceCount = m;
      this.beams = this._add('beams', bg, this._material('beams', BEAM_VERTEX, BEAM_FRAGMENT, additive), 30);
    }
  }

  // The confetti cannons and pyro jets: [{ x, y, z }] (course metres), at the rim or the
  // pitch side. Replaces the last set.
  setCannons(points) {
    const ok = (v) => typeof v === 'number' && Number.isFinite(v);
    this._cannons = (Array.isArray(points) ? points : []).filter((p) => p && [p.x, p.y, p.z].every(ok));
    this._buildCannons();
  }

  // Where triggered fireworks burst: a ball of radius r about (x, y, z) (course metres),
  // over the arena. The confetti is thrown toward its middle.
  setSkyZone(zone) {
    const ok = zone && [zone.x, zone.y, zone.z].every((v) => typeof v === 'number' && Number.isFinite(v));
    this._zone = ok ? { x: zone.x, y: zone.y, z: zone.z, r: zone.r > 0 ? zone.r : 60 } : null;
    if (this._zone) {
      const c = this.V(this._zone.x, this._zone.y, this._zone.z);
      this.uniforms.uFwZone.value.set(c.x, c.y, c.z, this._zone.r);
    }
    this._buildCannons();
    this._buildFireworks();
  }

  _buildCannons() {
    this._drop('confetti');
    this._drop('pyro');
    const n = this._cannons.length;
    if (!n) return;
    const at = this._cannons.map((p) => this.V(p.x, p.y, p.z));
    // the pitch: under the sky zone, or the middle of the cannons
    const mid = new THREE.Vector3();
    if (this._zone) mid.copy(this.V(this._zone.x, this._zone.y, 0)); else { for (const p of at) mid.add(p); mid.multiplyScalar(1 / n); }
    const count = (this.quality() || 'high') === 'low' ? FX_COUNTS.confettiLow : FX_COUNTS.confetti;
    const born = new Float32Array(count * 4), vel = new Float32Array(count * 4), tint = new Float32Array(count * 4);
    const col = new THREE.Color(), inward = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const c = at[i % n];
      inward.set(mid.x - c.x, 0, mid.z - c.z);
      if (inward.lengthSq() < 1e-6) inward.set(0, 0, 1);
      inward.normalize();
      const h1 = hash(i, 1), h2 = hash(i, 2), h3 = hash(i, 3), h4 = hash(i, 4), h5 = hash(i, 5);
      const push = 3 + 6 * h1, side = (h2 - 0.5) * 8;
      born.set([c.x, c.y + 0.5, c.z, h3 * FX_TIMES.confettiSpread], i * 4);
      vel.set([inward.x * push - inward.z * side, 14 + 10 * h4, inward.z * push + inward.x * side, h5], i * 4);
      col.set(CONFETTI_COLORS[i % CONFETTI_COLORS.length]);
      tint.set([col.r, col.g, col.b, (i + 0.5) / count], i * 4);
    }
    const cg = new THREE.InstancedBufferGeometry();
    cg.setAttribute('position', quadGeometry());
    cg.setAttribute('aBorn', new THREE.InstancedBufferAttribute(born, 4));
    cg.setAttribute('aVel', new THREE.InstancedBufferAttribute(vel, 4));
    cg.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 4));
    cg.instanceCount = count;
    this.confetti = this._add('confetti', cg, this._material('confetti', CONFETTI_VERTEX, CONFETTI_FRAGMENT, { side: THREE.DoubleSide }), 0);
    // the jets: two crossed sheets of flame a cannon
    const pg = new THREE.InstancedBufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0,
      0, 0, -0.5, 0, 0, 0.5, 0, 1, 0.5, 0, 0, -0.5, 0, 1, 0.5, 0, 1, -0.5,
    ], 3));
    pg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
    const base = new Float32Array(n * 4), seed = new Float32Array(n);
    at.forEach((c, i) => { base.set([c.x, c.y, c.z, 8 + 6 * hash(i, 9)], i * 4); seed[i] = hash(i, 10); });
    pg.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 4));
    pg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    pg.instanceCount = n;
    this.pyro = this._add('pyro', pg, this._material('pyro', PYRO_VERTEX, PYRO_FRAGMENT, { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }), 32);
  }

  _buildFireworks() {
    this._drop('fireworks');
    if (!this._zone) return;
    const shells = FX_COUNTS.shells, per = FX_COUNTS.sparks, count = shells * per;
    const shell = new Float32Array(count * 4), spark = new Float32Array(count * 4), tint = new Float32Array(count * 4);
    const col = new THREE.Color();
    for (let s = 0; s < shells; s++) {
      // the first shell goes at once; the rest over the launch time
      const sx = hash(s, 21) * 2 - 1, sy = hash(s, 22) * 2 - 1, sz = hash(s, 23) * 2 - 1, when = s === 0 ? 0 : hash(s, 24);
      col.set(SHELL_COLORS[s % SHELL_COLORS.length]);
      const big = 0.7 + 0.6 * hash(s, 25);
      for (let k = 0; k < per; k++) {
        const i = s * per + k;
        // an even ball of directions (a golden spiral), each spark its own speed
        const u = 1 - (2 * (k + 0.5)) / per, r = Math.sqrt(Math.max(0, 1 - u * u)), a = k * 2.399963;
        const sp = big * (0.82 + 0.18 * hash(i, 26));
        shell.set([sx * 0.8, sy, sz * 0.8, when], i * 4);
        spark.set([Math.cos(a) * r * sp, u * sp, Math.sin(a) * r * sp, hash(i, 27)], i * 4);
        tint.set([col.r, col.g, col.b, (s + 0.5) / shells], i * 4);
      }
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', quadGeometry());
    g.setAttribute('aShell', new THREE.InstancedBufferAttribute(shell, 4));
    g.setAttribute('aSpark', new THREE.InstancedBufferAttribute(spark, 4));
    g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 4));
    g.instanceCount = count;
    this.fireworks = this._add('fireworks', g, this._material('fireworks', FIREWORK_VERTEX, FIREWORK_FRAGMENT, { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }), 33);
  }

  // Set something off. kind: 'confetti' | 'pyro' | 'fireworks' | 'win' (all three,
  // staggered). intensity: 1 is the full show. at { x, y, z } (course): fireworks burst
  // round that point instead of the sky zone's middle. Returns what was scheduled.
  fire(kind, { intensity = 1, at = null } = {}) {
    const k = Number.isFinite(intensity) && intensity > 0 ? intensity : 1;
    const plan = fxTimeline(kind, k);
    for (const step of plan) this._queue.push({ ...step, time: this._t + step.delay, intensity: k, at });
    return plan;
  }

  _start(shot) {
    const u = this.uniforms;
    if (shot.what === 'confetti') {
      u.uConfetti.value.x = shot.time;
      u.uConfetti.value.z = Math.min(1, shot.intensity);
    } else if (shot.what === 'pyro') {
      u.uPyro.value.x = shot.time;
      u.uPyro.value.y = shot.shots || 1;
    } else if (shot.what === 'fireworks') {
      u.uFw.value.x = shot.time;
      u.uFw.value.z = Math.min(1, shot.intensity);
      const z = shot.at && [shot.at.x, shot.at.y, shot.at.z].every((v) => typeof v === 'number' && Number.isFinite(v)) ? shot.at : this._zone;
      if (z) { const c = this.V(z.x, z.y, z.z); u.uFwZone.value.set(c.x, c.y, c.z, this._zone ? this._zone.r : 60); }
    }
    this._until[shot.what] = shot.time + shot.life;
  }

  // Every frame: the clock, the lens, and which of the five are drawn.
  update(t, camera = null) {
    this._t = t;
    this.uniforms.uFxTime.value = t;
    if (camera && camera.fov) this.uniforms.uFxLens.value = Math.tan(camera.fov * Math.PI / 360);
    if (this._queue.length) {
      const due = this._queue.filter((s) => s.time <= t);
      if (due.length) {
        this._queue = this._queue.filter((s) => s.time > t);
        for (const shot of due) this._start(shot);
      }
    }
    const night = !!this.night();
    if (this.beams) this.beams.visible = night;
    if (this.flares) this.flares.visible = night;
    if (this.confetti) this.confetti.visible = t < this._until.confetti;
    if (this.pyro) this.pyro.visible = t < this._until.pyro;
    if (this.fireworks) this.fireworks.visible = t < this._until.fireworks;
  }

  // what is built, and what is burning now
  stats() {
    const n = (m) => (m ? m.geometry.instanceCount : 0);
    return {
      lamps: this._lamps.length, beams: n(this.beams), flares: n(this.flares), cannons: this._cannons.length,
      confetti: n(this.confetti), jets: n(this.pyro), sparks: n(this.fireworks), queued: this._queue.length,
      active: { confetti: !!this.confetti?.visible, pyro: !!this.pyro?.visible, fireworks: !!this.fireworks?.visible },
    };
  }

  // everything off the stage (a new course)
  clear() {
    for (const key of ['beams', 'flares', 'confetti', 'pyro', 'fireworks']) this._drop(key);
    this._lamps = [];
    this._cannons = [];
    this._zone = null;
    this._queue = [];
    this._until = { confetti: -1, pyro: -1, fireworks: -1 };
    const far = -1e6;
    this.uniforms.uConfetti.value.x = far;
    this.uniforms.uPyro.value.x = far;
    this.uniforms.uFw.value.x = far;
    if (this.group) { this.scene.remove(this.group); this.group = null; }
  }

  dispose() { this.clear(); }
}
