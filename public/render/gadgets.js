// Course gadgets, drawn (v3:gadgets; docs/gadgets.md): the rings, pads, strips, fans, geysers,
// bumpers, rails, backboards, funnels, ice, mud, warps, breakables, coin trails and multiplier
// rings a stage carries in geo.gadgets (lib/gadgets.js), each modelled in code in the arcade's
// own style: bold shapes, emissive accents, an icon beacon over each one so it reads from the
// tee, and a reaction when a shot meets it, timed off the shot's own event list.
//
//   const layer = new GadgetLayer({ scene, hAt, groundAt, V, onChange, env });
//   layer.setCourse(geo);                       // geo.gadgets (null: nothing is drawn)
//   layer.update(time, camera);                 // every frame: the idle motion and the reactions
//   layer.onShot(events, { toPlayTime, playDur });   // a shot is away: its contacts, in playback time
//   layer.step(t, ball);                        // every frame of the shot: fire what the ball has reached
//   layer.endShot();                            // the ball is at rest: what broke stands again soon
//   layer.ballHidden(t);                        // true while the ball is inside a warp
//   layer.obstacles(), layer.blockers();        // for the cameras (the shapes of PropsLayer's)
//   layer.setSeeThrough(line, cam, ball);       // the pass-through view fades what stands in the way
//   layer.onHit = (ev) => { ... };              // each contact as it plays (the audio cue hook)
//
// Nothing here decides anything: where the ball goes is the server's (lib/physics.js). A smashed
// wall, a taken coin or a fired geyser is the picture of an event the shot already carries.
// The idle motion runs off the one `time` update() is given; no frame allocates.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  GADGET_LOOK, gadgetTimeline, warpWindows, ballHiddenAt, geyserWindows, geyserState,
  gadgetObstacles, gadgetBlockers, gadgetCeiling, gadgetFootprint, ringTubeM, farScale, drawGadgetGlyph,
} from './gadget-core.js';

const RAD = Math.PI / 180;
const TAU = Math.PI * 2;
const RESPAWN_S = 2.6;         // after the ball stops, what broke or was taken stands again
const POP_S = 0.4;             // ... popping in over this long
const BEACON_NEAR_M = 38, BEACON_FAR_M = 70;   // a beacon fades in between these distances from the camera
const GHOST_OPACITY = 0.2;
const DEBRIS_MAX = 160, SPARK_MAX = 220, WAVES = 8, FLASHES = 6;
const G_FX = 14;               // debris falls a little fast: it reads at range

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const _c = new THREE.Color();
const _n = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);

const hex = (css) => new THREE.Color(css);
const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
// a spring settling on 1 from `from`: the squash of a pad, the kick of a bumper
const spring = (t, from, freq = 18, damp = 7) => 1 + (from - 1) * Math.exp(-damp * t) * Math.cos(freq * t);

// ---------------------------------------------------------------- textures
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function tex(c, { repeat = false, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
// arrows up a dark lane, with bright edges: a speed strip (v runs along its heading)
function chevronTexture(color) {
  const c = canvas(128, 128), x = c.getContext('2d');
  x.fillStyle = 'rgba(10,22,34,0.86)'; x.fillRect(0, 0, 128, 128);
  x.fillStyle = color; x.fillRect(0, 0, 9, 128); x.fillRect(119, 0, 9, 128);
  x.strokeStyle = color; x.lineWidth = 15; x.lineJoin = 'miter';
  for (const y of [100, 36]) { x.beginPath(); x.moveTo(26, y + 22); x.lineTo(64, y - 22); x.lineTo(102, y + 22); x.stroke(); }
  return tex(c, { repeat: true });
}
// triangles pointing in round an annulus: the inside of a boost ring
function ringArrowTexture(color) {
  const c = canvas(256, 256), x = c.getContext('2d');
  x.translate(128, 128);
  x.fillStyle = color;
  for (let k = 0; k < 12; k++) {
    x.rotate(TAU / 12);
    x.beginPath(); x.moveTo(-15, -122); x.lineTo(15, -122); x.lineTo(0, -84); x.closePath(); x.fill();
  }
  return tex(c);
}
// spiral arms into a bright middle: a funnel, a warp's portal
function swirlTexture(color, core = '#ffffff') {
  const c = canvas(256, 256), x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 4, 128, 128, 128);
  g.addColorStop(0, core); g.addColorStop(0.25, color); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.globalAlpha = 0.55; x.beginPath(); x.arc(128, 128, 126, 0, TAU); x.fill();
  x.globalAlpha = 1; x.strokeStyle = color; x.lineWidth = 10; x.lineCap = 'round';
  for (let arm = 0; arm < 5; arm++) {
    x.beginPath();
    for (let k = 0; k <= 40; k++) {
      const u = k / 40, a = arm * (TAU / 5) + u * 4.2, r = 10 + u * 112;
      const px = 128 + Math.cos(a) * r, py = 128 + Math.sin(a) * r;
      if (k) x.lineTo(px, py); else x.moveTo(px, py);
    }
    x.stroke();
  }
  return tex(c);
}
// a bullseye of hazard stripes: a bounce pad's base
function padTexture(color) {
  const c = canvas(256, 256), x = c.getContext('2d');
  x.translate(128, 128);
  for (let k = 0; k < 24; k++) {
    x.fillStyle = k % 2 ? '#15130a' : '#ffd21f';
    x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, 126, (k * TAU) / 24, ((k + 1) * TAU) / 24); x.closePath(); x.fill();
  }
  x.fillStyle = '#15130a'; x.beginPath(); x.arc(0, 0, 96, 0, TAU); x.fill();
  x.fillStyle = color; x.beginPath(); x.arc(0, 0, 84, 0, TAU); x.fill();
  x.strokeStyle = '#ffffff'; x.lineWidth = 16; x.lineJoin = 'round'; x.lineCap = 'round';
  x.beginPath(); x.moveTo(-36, 12); x.lineTo(0, -34); x.lineTo(36, 12); x.stroke();
  x.beginPath(); x.moveTo(-36, 48); x.lineTo(0, 2); x.lineTo(36, 48); x.stroke();
  return tex(c);
}
// dashes along u: the streamlines of a fan (scrolled)
function dashTexture() {
  const c = canvas(256, 32), x = c.getContext('2d');
  for (const [x0, w] of [[10, 120], [150, 70]]) {
    const g = x.createLinearGradient(x0, 0, x0 + w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.75, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath(); x.ellipse(x0 + w / 2, 16, w / 2, 9, 0, 0, TAU); x.fill();
  }
  return tex(c, { repeat: true, srgb: false });
}
// pale arrows on nothing: the lane a fan blows down, laid on the ground under it
function laneTexture(color) {
  const c = canvas(128, 128), x = c.getContext('2d');
  x.fillStyle = 'rgba(255,255,255,0.10)'; x.fillRect(0, 0, 128, 128);
  x.fillStyle = color; x.globalAlpha = 0.5; x.fillRect(0, 0, 5, 128); x.fillRect(123, 0, 5, 128);
  x.globalAlpha = 0.85; x.strokeStyle = color; x.lineWidth = 9; x.lineJoin = 'round'; x.lineCap = 'round';
  x.beginPath(); x.moveTo(34, 86); x.lineTo(64, 46); x.lineTo(94, 86); x.stroke();
  return tex(c, { repeat: true });
}
// streaks running up: the body of a geyser's column (scrolled along v)
function streakTexture() {
  const c = canvas(128, 256), x = c.getContext('2d');
  for (let k = 0; k < 30; k++) {
    const x0 = (k * 37) % 128, h = 70 + ((k * 53) % 150), y0 = (k * 97) % 256;
    for (const off of [0, -256]) {
      const g = x.createLinearGradient(0, y0 + off, 0, y0 + off + h);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.fillRect(x0, y0 + off, 7, h);
    }
  }
  return tex(c, { repeat: true, srgb: false });
}
function glowTexture() {
  const c = canvas(128, 128), x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 2, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return tex(c, { srgb: false });
}
// a landing ring with its multiplier written across it
function zoneTexture(mult, color) {
  const c = canvas(512, 512), x = c.getContext('2d');
  x.translate(256, 256);
  x.fillStyle = 'rgba(8,26,10,0.42)'; x.beginPath(); x.arc(0, 0, 250, 0, TAU); x.fill();
  x.strokeStyle = color; x.lineWidth = 30; x.beginPath(); x.arc(0, 0, 232, 0, TAU); x.stroke();
  x.lineWidth = 8; x.setLineDash([26, 18]); x.beginPath(); x.arc(0, 0, 190, 0, TAU); x.stroke(); x.setLineDash([]);
  x.fillStyle = '#ffffff'; x.strokeStyle = '#0b1a0c'; x.lineWidth = 16; x.lineJoin = 'round';
  x.font = '900 250px "Arial Black", Impact, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.strokeText(`x${mult}`, 0, 14); x.fillText(`x${mult}`, 0, 14);
  return tex(c);
}
// the face of a breakable: its material, and the ball speed it takes, written large
const BREAK_PAINT = Object.freeze({
  wall: { base: '#b9562f', line: '#5b2412', ink: '#fff3d0', glow: '#ffb21f', debris: [0xb9562f, 0x8f3d20, 0xd8a070] },
  crate: { base: '#b98a4a', line: '#5e4020', ink: '#fff3d0', glow: '#ffd21f', debris: [0xb98a4a, 0x8a6030, 0xdcb680] },
  'ice-wall': { base: '#a8e4ff', line: '#e9fbff', ink: '#0b3b5c', glow: '#dff6ff', debris: [0xbfeaff, 0xffffff, 0x7fd0ff] },
  snowman: { base: '#ffffff', line: '#d6e6f2', ink: '#12314a', glow: '#ffffff', debris: [0xffffff, 0xe6f2fa, 0xff8a2a] },
  pinata: { base: '#ff4fd8', line: '#ffd21f', ink: '#ffffff', glow: '#ffd21f', debris: [0xff4fd8, 0xffd21f, 0x27e0ff, 0x7dff5a, 0xff5a2a] },
});
function wallTexture(style, mph, aspect) {
  const P = BREAK_PAINT[style] || BREAK_PAINT.wall;
  const H = 256, W = Math.max(256, Math.min(1024, Math.round((256 * aspect) / 64) * 64));
  const c = canvas(W, H), x = c.getContext('2d');
  x.fillStyle = P.base; x.fillRect(0, 0, W, H);
  x.strokeStyle = P.line; x.lineWidth = style === 'ice-wall' ? 3 : 5;
  if (style === 'ice-wall') {
    for (let k = 0; k < 16; k++) { x.beginPath(); x.moveTo((k * 173) % W, (k * 61) % H); x.lineTo(((k * 173) % W) + 60 - ((k * 37) % 120), ((k * 61) % H) + 80); x.stroke(); }
  } else if (style === 'crate') {
    for (let px = 0; px < W; px += 128) { x.strokeRect(px + 6, 6, 116, H - 12); x.beginPath(); x.moveTo(px + 6, 6); x.lineTo(px + 122, H - 6); x.moveTo(px + 122, 6); x.lineTo(px + 6, H - 6); x.stroke(); }
  } else {
    for (let row = 0; row < 8; row++) {
      const y = row * 32;
      x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke();
      for (let px = (row % 2) * 32; px < W; px += 64) { x.beginPath(); x.moveTo(px, y); x.lineTo(px, y + 32); x.stroke(); }
    }
  }
  // the number, on a plate
  const pw = Math.min(W - 24, 360), ph = 178;
  x.fillStyle = 'rgba(12,10,6,0.82)'; x.fillRect((W - pw) / 2, (H - ph) / 2, pw, ph);
  x.strokeStyle = P.glow; x.lineWidth = 8; x.strokeRect((W - pw) / 2 + 4, (H - ph) / 2 + 4, pw - 8, ph - 8);
  x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '900 122px "Arial Black", Impact, system-ui, sans-serif';
  x.fillText(String(Math.round(mph)), W / 2, H / 2 - 14);
  x.fillStyle = P.glow; x.font = '900 38px "Arial Black", Impact, system-ui, sans-serif';
  x.fillText('MPH', W / 2, H / 2 + 62);
  return tex(c);
}
// the plate alone, as a glow map: the number shines, the bricks do not
function wallGlowTexture(mph, aspect, glow) {
  const H = 256, W = Math.max(256, Math.min(1024, Math.round((256 * aspect) / 64) * 64));
  const c = canvas(W, H), x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  const pw = Math.min(W - 24, 360), ph = 178;
  x.strokeStyle = glow; x.lineWidth = 8; x.strokeRect((W - pw) / 2 + 4, (H - ph) / 2 + 4, pw - 8, ph - 8);
  x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '900 122px "Arial Black", Impact, system-ui, sans-serif';
  x.fillText(String(Math.round(mph)), W / 2, H / 2 - 14);
  x.fillStyle = glow; x.font = '900 38px "Arial Black", Impact, system-ui, sans-serif';
  x.fillText('MPH', W / 2, H / 2 + 62);
  return tex(c);
}
function stripeTexture(a, b, n = 6) {
  const c = canvas(64, 128), x = c.getContext('2d');
  for (let k = 0; k < n; k++) { x.fillStyle = k % 2 ? a : b; x.fillRect(0, (k * 128) / n, 64, 128 / n + 1); }
  return tex(c, { repeat: true });
}
function boardTexture() {
  const c = canvas(256, 128), x = c.getContext('2d');
  x.fillStyle = 'rgba(233,241,255,0.9)'; x.fillRect(0, 0, 256, 128);
  x.strokeStyle = '#ff5a2a'; x.lineWidth = 12; x.strokeRect(6, 6, 244, 116);
  x.lineWidth = 9; x.strokeRect(92, 56, 72, 50);
  return tex(c);
}
function blotchTexture(base, dark, light) {
  const c = canvas(256, 256), x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 60, 128, 128, 128);
  g.addColorStop(0, base); g.addColorStop(0.8, base); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 46; k++) {
    const a = k * 2.399, r = 8 + ((k * 53) % 96);
    x.fillStyle = k % 3 ? dark : light; x.globalAlpha = 0.5;
    x.beginPath(); x.ellipse(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 5 + (k % 7) * 2.4, 3 + (k % 5) * 1.6, a, 0, TAU); x.fill();
  }
  return tex(c);
}
function iceTexture() {
  const c = canvas(256, 256), x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 30, 128, 128, 128);
  g.addColorStop(0, 'rgba(214,244,255,0.95)'); g.addColorStop(0.86, 'rgba(170,226,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 2.5;
  for (let k = 0; k < 14; k++) {
    let px = 128 + Math.cos(k * 1.9) * 20, py = 128 + Math.sin(k * 1.9) * 20;
    x.beginPath(); x.moveTo(px, py);
    for (let j = 0; j < 4; j++) { px += Math.cos(k * 1.9 + j * 0.7 - 1) * 26; py += Math.sin(k * 1.9 + j * 0.7 - 1) * 26; x.lineTo(px, py); }
    x.stroke();
  }
  return tex(c);
}
function beaconTexture(kind) {
  const look = GADGET_LOOK[kind] || GADGET_LOOK.ring;
  const c = canvas(128, 160), x = c.getContext('2d');
  // a badge with a pointer under it
  x.fillStyle = 'rgba(12,10,6,0.86)';
  x.beginPath(); x.arc(64, 62, 56, 0, TAU); x.fill();
  x.beginPath(); x.moveTo(40, 108); x.lineTo(64, 156); x.lineTo(88, 108); x.closePath(); x.fill();
  x.strokeStyle = look.color; x.lineWidth = 9; x.beginPath(); x.arc(64, 62, 50, 0, TAU); x.stroke();
  drawGadgetGlyph(x, look.glyph, 64, 62, 30, look.color);
  return tex(c);
}

// ---------------------------------------------------------------- geometry
// Several parts as one geometry (one draw): the parts are disposed.
function fuse(parts) {
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const g = mergeGeometries(flat);
  for (const p of parts) p.dispose();
  for (const p of flat) p.dispose();
  return g;
}
// A coin of radius 1 facing +Z: a bright face, a pale boss, a dark rim (vertex colours: it is
// drawn unlit, so it reads the same against a noon sky, a sunset and a night).
function coinGeometry() {
  const paint = (g, hexColor) => {
    const c = new THREE.Color(hexColor), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  const parts = [
    paint(new THREE.CylinderGeometry(0.86, 0.86, 0.3, 24).rotateX(Math.PI / 2), 0xffc81a),
    paint(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 20).rotateX(Math.PI / 2), 0xfff0a0),
    paint(new THREE.TorusGeometry(0.93, 0.15, 8, 28), 0x7a3c00),
  ];
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  for (const p of parts) p.dispose();
  return g;
}
// A disc laid on the ground: every vertex takes the ground's own height, so it follows a slope.
// World coordinates (the mesh stays at the origin). axisDeg turns its texture: v runs that way.
function drapedDisc(V, groundAt, cx, cy, r, { rings = 4, segs = 36, lift = 0.12, axisDeg = 0, inner = 0 } = {}) {
  const pos = [], uv = [], idx = [];
  const ax = Math.sin(axisDeg * RAD), ay = Math.cos(axisDeg * RAD);
  for (let j = 0; j <= rings; j++) {
    const rr = inner + ((r - inner) * j) / rings;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * TAU, ex = Math.cos(a) * rr, ey = Math.sin(a) * rr;
      const p = V(cx + ex, cy + ey, groundAt(cx + ex, cy + ey) + lift);
      pos.push(p.x, p.y, p.z);
      // u: to the right of the axis, v: along it
      uv.push(0.5 + (ex * ay - ey * ax) / (2 * r), 0.5 + (ex * ax + ey * ay) / (2 * r));
    }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
    const a = j * (segs + 1) + i, b = a + segs + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// A rectangle laid on the ground: hw across, hl along its heading. u across (0..1), v along (0..vRepeat).
function drapedRect(V, groundAt, cx, cy, hw, hl, headingDeg, { nx = 4, ny = 14, lift = 0.12, vRepeat = 1 } = {}) {
  const pos = [], uv = [], idx = [];
  const dx = Math.sin(headingDeg * RAD), dy = Math.cos(headingDeg * RAD), rx = dy, ry = -dx;
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const a = -hw + (2 * hw * i) / nx, b = -hl + (2 * hl * j) / ny;
    const x = cx + rx * a + dx * b, y = cy + ry * a + dy * b;
    const p = V(x, y, groundAt(x, y) + lift);
    pos.push(p.x, p.y, p.z);
    uv.push(i / nx, (j / ny) * vRepeat);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + nx + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class GadgetLayer {
  /**
   * @param {object} o { scene: THREE.Scene, hAt(x, y): the smooth ground, groundAt(x, y): the
   *   ground as drawn (decals lie on it), V(x, y, z): course metres -> three, onChange():
   *   something that casts a shadow moved, env(): { quality: 'ultra' | 'high' | 'low', night, theme } }
   */
  constructor({ scene, hAt, groundAt = null, V, onChange = null, env = null } = {}) {
    this.scene = scene;
    this.hAt = hAt;
    this.groundAt = groundAt || hAt;
    this.V = V;
    this.onChange = onChange;
    this.env = env || (() => ({ quality: 'high', night: false, theme: null }));
    this.group = new THREE.Group();
    this.group.name = 'gadgets';
    scene.add(this.group);
    this.onHit = null;          // (ev) => {}: each contact as it plays
    this.version = 0;           // moves whenever the set of gadgets changes (the cameras cache on it)
    this.gadgets = [];
    this.recs = [];
    this._byId = new Map();
    this._tex = new Map();
    this._owned = [];           // geometries and materials to dispose with the course
    this._time = 0;
    this._tl = [];              // the shot's contacts still to play
    this._tlI = 0;
    this._warps = [];
    this._shotT = null;         // playback time of the shot in the air (null: none)
    this._respawnAt = null;
    this._lastBall = null;
    this._ballDir = new THREE.Vector3(0, 0, -1);
    this._obst = [];
    this._seeKey = '';
    this._fx = null;
  }

  get count() { return this.recs.length; }

  // ---------------------------------------------------------------- the course
  setCourse(geo) {
    this.clear();
    const list = geo && Array.isArray(geo.gadgets) ? geo.gadgets.filter((g) => g && GADGET_LOOK[g.kind] && (Number.isFinite(g.x) || Array.isArray(g.points))) : [];
    this.version++;
    this.gadgets = list;
    if (!list.length) return;
    const hole = geo.holes && geo.holes[0];
    this._tee = hole && Array.isArray(hole.tee) ? { x: hole.tee[0], y: hole.tee[1] } : null;
    this._theme = (geo.arcade && geo.arcade.theme) || null;
    const byId = new Map(list.map((g) => [g.id, g]));
    this._fxInit();
    for (const g of list) {
      let rec = null;
      try { rec = this._build(g, byId); }
      catch (e) { console.warn(`[gadgets] ${g.id} (${g.kind}) not drawn:`, e && e.message); }
      if (!rec) continue;
      rec.g = g; rec.kind = g.kind; rec.hitAt = -1e9; rec.hitFx = null; rec.broken = false; rec.popAt = -1e9; rec.ghost = 0; rec.ghostT = 0;
      this.recs.push(rec);
      this._byId.set(g.id, rec);
      if (rec.group) this.group.add(rec.group);
    }
    this._obst = gadgetObstacles(list, this.hAt);
    this.onChange?.();
  }

  clear() {
    for (const rec of this.recs) if (rec.group) this.group.remove(rec.group);
    if (this._fx) { for (const o of this._fx.objects) this.group.remove(o); this._fx = null; }
    for (const o of this._owned) o.dispose?.();
    for (const t of this._tex.values()) t.dispose();
    this._owned = []; this._tex.clear();
    this.recs = []; this._byId.clear(); this.gadgets = []; this._obst = [];
    this._tl = []; this._tlI = 0; this._warps = []; this._shotT = null; this._respawnAt = null; this._lastBall = null;
    this._seeKey = '';
  }

  dispose() { this.clear(); this.scene.remove(this.group); }

  // ---- shared bits
  _t(key, make) { let t = this._tex.get(key); if (!t) this._tex.set(key, t = make()); return t; }
  _own(o) { this._owned.push(o); return o; }
  _geo(g) { return this._own(g); }
  // a lit, coloured body
  _body(color, { rough = 0.55, metal = 0.1, map = null, emissive = null, glow = 0, side = THREE.FrontSide, opacity = 1 } = {}) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, map, side });
    if (emissive != null) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = glow; }
    if (opacity < 1) { m.transparent = true; m.opacity = opacity; }
    return this._own(m);
  }
  // a part that shines by itself: its colour is its light
  _glow(color, intensity = 1.6, opts = {}) {
    const m = new THREE.MeshStandardMaterial({ color: 0x15130a, emissive: new THREE.Color(color), emissiveIntensity: intensity, roughness: 0.4, metalness: 0, ...opts });
    return this._own(m);
  }
  // a decal lying on the ground
  _decal(map, { glow = 0.9, opacity = 1, color = 0xffffff, rough = 0.9, metal = 0 } = {}) {
    const m = new THREE.MeshStandardMaterial({
      color, map, transparent: true, opacity, depthWrite: false, roughness: rough, metalness: metal,
      emissive: new THREE.Color(0xffffff), emissiveMap: map, emissiveIntensity: glow,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, side: THREE.DoubleSide,
    });
    return this._own(m);
  }
  // light in the air: additive, never written to depth
  _light(map, color, opacity = 0.6) {
    return this._own(new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false }));
  }
  _mesh(geo, mat, { shadow = false, order = 0 } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow; m.receiveShadow = false;
    if (order) m.renderOrder = order;
    return m;
  }
  _distFromTee(x, y) { return this._tee ? Math.hypot(x - this._tee.x, y - this._tee.y) : 120; }
  _beacon(rec, kind, x, y, z) {
    const mat = this._own(new THREE.SpriteMaterial({ map: this._t(`beacon:${kind}`, () => beaconTexture(kind)), transparent: true, depthWrite: false, sizeAttenuation: false, fog: false, toneMapped: false }));
    const sp = new THREE.Sprite(mat);
    sp.center.set(0.5, 0);
    sp.scale.set(0.044, 0.055, 1);
    sp.position.copy(this.V(x, y, z));
    sp.renderOrder = 30;
    rec.beacon = sp;
    rec.group.add(sp);
  }
  _base(g, extra = 0) { return (Number.isFinite(g.z) ? g.z : this.hAt(g.x, g.y)) + extra; }

  // ---------------------------------------------------------------- the models
  _build(g, byId) {
    const V = this.V, L = GADGET_LOOK[g.kind];
    const rec = { group: new THREE.Group(), fade: [], id: g.id };
    rec.group.name = `gadget:${g.id}`;
    const far = this._distFromTee(Number.isFinite(g.x) ? g.x : g.points[0][0], Number.isFinite(g.y) ? g.y : g.points[0][1]);
    rec.far = far;
    const ground = Number.isFinite(g.x) ? this.hAt(g.x, g.y) : 0;
    // a standing part: turned to the gadget's heading (its forward is local -Z, its right +X)
    const stand = (x, y, z, headingDeg = 0) => { const o = new THREE.Group(); o.position.copy(V(x, y, z)); o.rotation.y = -headingDeg * RAD; rec.group.add(o); return o; };
    switch (g.kind) {
      case 'ring': {
        const R = g.radius, tube = ringTubeM(far);
        const o = stand(g.x, g.y, g.z, g.heading);
        rec.rim = this._glow(L.color, 1.5);
        const rim = this._mesh(this._geo(new THREE.TorusGeometry(R, tube, 10, 56)), rec.rim, { shadow: true });
        const edge = this._mesh(this._geo(new THREE.TorusGeometry(R + tube * 1.05, tube * 0.42, 6, 56)), this._body(0x1a1030, { rough: 0.5 }));
        rec.arrowsMat = this._light(this._t('ring-arrows', () => ringArrowTexture('#ffe08a')), 0xffffff, 0.55);
        rec.arrows = this._mesh(this._geo(new THREE.RingGeometry(R * 0.5, R - tube * 0.6, 48)), rec.arrowsMat, { order: 12 });
        o.add(rim, edge, rec.arrows);
        rec.spin = o; rec.fade.push(rec.rim);
        rec.center = V(g.x, g.y, g.z); rec.normal = new THREE.Vector3(Math.sin(g.heading * RAD), 0, -Math.cos(g.heading * RAD));
        this._beacon(rec, 'ring', g.x, g.y, g.z + R + tube + 1.5);
        break;
      }
      case 'pad': {
        const r = g.radius, axis = Number.isFinite(g.heading) ? g.heading : (this._tee ? Math.atan2(g.x - this._tee.x, g.y - this._tee.y) / RAD : 0);
        rec.decalMat = this._decal(this._t('pad', () => padTexture(L.color)), { glow: 0.55 });
        rec.group.add(this._mesh(this._geo(drapedDisc(V, this.groundAt, g.x, g.y, r, { axisDeg: axis })), rec.decalMat, { order: 2 }));
        const o = stand(g.x, g.y, ground, axis);
        rec.topMat = this._glow(L.color, 1.3);
        const drum = this._mesh(this._geo(new THREE.CylinderGeometry(r * 0.56, r * 0.66, 1, 28).translate(0, 0.5, 0)), this._body(0x2a1030, { rough: 0.4, map: this._t('pad-stripe', () => stripeTexture('#ffd21f', '#15130a', 4)) }));
        const cap = this._mesh(this._geo(new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.22, 28).translate(0, 1.08, 0)), rec.topMat);
        o.add(drum, cap);
        rec.flex = o; rec.fade.push(rec.topMat);
        this._beacon(rec, 'pad', g.x, g.y, ground + 3.5);
        break;
      }
      case 'strip': {
        const [w, l] = g.size;
        const map = this._t('strip', () => chevronTexture(L.color));
        rec.decalMat = this._decal(map, { glow: 1.1 });
        rec.scroll = map;
        rec.group.add(this._mesh(this._geo(drapedRect(V, this.groundAt, g.x, g.y, w / 2, l / 2, g.heading, { ny: Math.max(8, Math.round(l / 3)), vRepeat: Math.max(1, Math.round(l / (w * 0.9))) })), rec.decalMat, { order: 2 }));
        this._beacon(rec, 'strip', g.x, g.y, ground + 4);
        break;
      }
      case 'fan': {
        const [w, l, h] = g.size, base = this._base(g);
        const up = !(g.strength > 0) && g.lift > 0;
        const R = Math.max(2.5, Math.min(w, h, 14) / 2 * 0.86);
        // the turbine at the upwind face (an updraft: flat on the ground under the column)
        const o = up ? stand(g.x, g.y, base + 0.6, g.heading) : stand(g.x - Math.sin(g.heading * RAD) * l / 2, g.y - Math.cos(g.heading * RAD) * l / 2, base + R + 1.2, g.heading);
        if (up) o.rotation.x = -Math.PI / 2;
        rec.bodyMat = this._body(0x24384a, { rough: 0.45, metal: 0.4 });
        rec.rimMat = this._glow(L.color, 1.1);
        const ductMat = this._body(0x24384a, { rough: 0.45, metal: 0.4, side: THREE.DoubleSide });
        const housing = this._mesh(this._geo(new THREE.CylinderGeometry(R, R * 1.06, R * 0.7, 36, 1, true).rotateX(Math.PI / 2)), ductMat, { shadow: true });
        const lips = this._mesh(this._geo(fuse([
          new THREE.TorusGeometry(R, R * 0.06, 6, 36).translate(0, 0, -R * 0.35),
          new THREE.TorusGeometry(R * 1.06, R * 0.05, 6, 36).translate(0, 0, R * 0.35),
        ])), rec.rimMat);
        const frame = [new THREE.CylinderGeometry(R * 0.16, R * 0.22, R * 0.9, 12).rotateX(Math.PI / 2)];
        if (!up) frame.push(new THREE.CylinderGeometry(R * 0.14, R * 0.34, 1.8, 10).translate(0, -(R + 0.5), 0));
        const body = this._mesh(this._geo(fuse(frame)), rec.bodyMat);
        rec.fade.push(ductMat);
        const bladeParts = [new THREE.SphereGeometry(R * 0.2, 12, 8)];
        for (let k = 0; k < 4; k++) bladeParts.push(new THREE.BoxGeometry(R * 0.26, R * 0.9, 0.12).translate(0, R * 0.47, 0).rotateY(0.5).rotateZ((k * TAU) / 4));
        const blades = this._mesh(this._geo(fuse(bladeParts)), rec.bodyMat);
        o.add(housing, lips, body, blades);
        rec.blades = blades;
        // streamlines through the volume
        const n = this.env().quality === 'low' ? 5 : 9;
        const sMap = this._t('dash', dashTexture);
        rec.streamMat = this._own(new THREE.MeshBasicMaterial({ map: sMap, color: hex('#e6fbff'), transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false }));
        rec.scroll = sMap;
        if (!up) {
          // the lane it blows down, on the ground
          const lane = this._t('lane', () => laneTexture(L.color));
          rec.laneMat = this._decal(lane, { glow: 0.5, opacity: 0.8 });
          rec.lane = lane;
          rec.group.add(this._mesh(this._geo(drapedRect(V, this.groundAt, g.x, g.y, w / 2, l / 2, g.heading, { nx: 6, ny: Math.max(8, Math.round(l / 3)), vRepeat: Math.max(2, Math.round(l / (w * 0.7))) })), rec.laneMat, { order: 2 }));
        } else {
          const lane = this._t(`updraft:${L.color}`, () => swirlTexture(L.color, '#ffffff'));
          lane.center.set(0.5, 0.5);
          rec.laneMat = this._decal(lane, { glow: 0.5, opacity: 0.7 });
          rec.swirl = lane;
          rec.group.add(this._mesh(this._geo(drapedDisc(V, this.groundAt, g.x, g.y, Math.min(w, l) / 2)), rec.laneMat, { order: 2 }));
        }
        // unit ribbons whose u runs the way the air goes: upright and flat ones along the heading
        // (so the stream shows from the side and from behind), upright ones for an updraft
        const upright = new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2);
        const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).rotateY(Math.PI / 2);
        const rising = new THREE.PlaneGeometry(1, 1).rotateZ(Math.PI / 2);
        const vol = stand(g.x, g.y, base, g.heading);
        const H = Math.min(h, 34);
        const ribbons = [];
        for (let k = 0; k < n; k++) {
          const a = ((k * 0.618) % 1 - 0.5) * w * 0.86, hh = (0.12 + ((k * 0.377) % 1) * 0.8) * H, thick = 1.1 + (k % 3) * 0.5;
          if (up) ribbons.push(rising.clone().applyMatrix4(_m4.compose(_v.set(a, H / 2, ((k * 0.377) % 1 - 0.5) * l * 0.8), _q.setFromAxisAngle(UP, k * 1.3), _s.set(thick, H, 1))));
          else if (k % 2) ribbons.push(flat.clone().applyMatrix4(_m4.compose(_v.set(a, hh, 0), _q.identity(), _s.set(thick, 1, l * 0.96))));
          else ribbons.push(upright.clone().applyMatrix4(_m4.compose(_v.set(a, hh, 0), _q.identity(), _s.set(1, thick, l * 0.96))));
        }
        vol.add(this._mesh(this._geo(mergeGeometries(ribbons)), rec.streamMat, { order: 14 }));   // every ribbon in one draw
        for (const r of [upright, flat, rising, ...ribbons]) r.dispose();
        rec.fade.push(rec.bodyMat, rec.rimMat);
        this._beacon(rec, 'fan', g.x, g.y, base + Math.min(h, 34) + 2);
        break;
      }
      case 'geyser': {
        const r = g.radius, lava = this._theme === 'volcano';
        const hot = lava ? '#ff7a1a' : L.color, core = lava ? '#ffe08a' : '#ffffff';
        rec.zoneMat = this._decal(this._t(`geyser-zone:${hot}`, () => swirlTexture(hot, core)), { glow: 0.5, opacity: 0.75 });
        rec.group.add(this._mesh(this._geo(drapedDisc(V, this.groundAt, g.x, g.y, r)), rec.zoneMat, { order: 2 }));
        const o = stand(g.x, g.y, ground, 0);
        const mound = this._mesh(this._geo(new THREE.CylinderGeometry(r * 0.3, r * 0.56, 1.7, 18, 1, true).translate(0, 0.8, 0)), this._body(lava ? 0x2a1a16 : 0x5a6670, { rough: 0.95, side: THREE.DoubleSide }));
        rec.poolMat = this._glow(hot, 0.8);
        const pool = this._mesh(this._geo(new THREE.CircleGeometry(r * 0.3, 18).rotateX(-Math.PI / 2).translate(0, 1.5, 0)), rec.poolMat);
        const cMap = this._t('column', streakTexture);
        rec.scroll = cMap;
        rec.colMat = this._light(cMap, hex(lava ? '#ffb060' : '#dff6ff'), 0.0);
        rec.col = this._mesh(this._geo(new THREE.CylinderGeometry(r * 0.3, r * 0.42, 1, 18, 1, true).translate(0, 0.5, 0)), rec.colMat, { order: 14 });
        rec.zoneMat.map.center.set(0.5, 0.5);
        rec.steam = new THREE.Sprite(this._own(new THREE.SpriteMaterial({ map: this._t('glow', glowTexture), color: hex(lava ? '#ff9a50' : '#eaf8ff'), transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
        rec.steam.position.set(0, 2.2, 0); rec.steam.scale.set(r * 1.2, r * 1.6, 1);
        o.add(mound, pool, rec.col, rec.steam);
        rec.mound = o; rec.home = o.position.clone();
        rec.h = g.height; rec.windows = [];
        this._beacon(rec, 'geyser', g.x, g.y, ground + 5);
        break;
      }
      case 'bumper': {
        const r = g.radius, h = g.height;
        const o = stand(g.x, g.y, ground, 0);
        rec.capMat = this._glow(L.color, 1.4);
        rec.ringMat = this._glow(L.glow, 1.6);
        const post = this._mesh(this._geo(new THREE.CylinderGeometry(r * 0.72, r * 0.8, h, 22).translate(0, h / 2, 0)), this._body(0xffffff, { rough: 0.35, map: this._t('bumper-stripe', () => stripeTexture('#ffffff', '#ff3b5c', 6)) }), { shadow: true });
        const cap = this._mesh(this._geo(new THREE.CylinderGeometry(r * 1.3, r * 1.18, 0.6, 22).translate(0, h + 0.3, 0)), rec.capMat);
        const dome = this._mesh(this._geo(new THREE.SphereGeometry(r * 0.95, 18, 8, 0, TAU, 0, Math.PI / 2).translate(0, h + 0.6, 0)), rec.capMat);
        const skirt = this._mesh(this._geo(new THREE.TorusGeometry(r * 1.05, 0.16, 6, 24).rotateX(Math.PI / 2).translate(0, 0.22, 0)), rec.ringMat);
        o.add(post, cap, dome, skirt);
        rec.kick = o; rec.fade.push(rec.capMat, rec.ringMat, post.material);
        this._beacon(rec, 'bumper', g.x, g.y, ground + h + 2.2);
        break;
      }
      case 'rail': {
        const pts = g.points.map(([x, y]) => V(x, y, this.hAt(x, y) + g.height * 0.72));
        const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
        const len = curve.getLength();
        const map = this._t('rail-stripe', () => stripeTexture('#ff3b5c', '#ffd21f', 2));
        rec.scroll = map;
        rec.railMat = this._own(new THREE.MeshStandardMaterial({ color: 0xffffff, map, emissive: new THREE.Color(0xffffff), emissiveMap: map, emissiveIntensity: 0.9, roughness: 0.4 }));
        const tubeGeo = this._geo(new THREE.TubeGeometry(curve, Math.max(8, Math.round(len / 1.2)), Math.max(0.28, g.radius * 0.55), 8, false));
        const uv = tubeGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i) * Math.max(2, Math.round(len / 2.5)));
        rec.group.add(this._mesh(tubeGeo, rec.railMat));
        const nPost = Math.max(2, Math.round(len / 4) + 1);
        const posts = new THREE.InstancedMesh(this._geo(new THREE.CylinderGeometry(0.16, 0.2, 1, 8).translate(0, 0.5, 0)), this._body(0x2a2a36, { rough: 0.5, metal: 0.4 }), nPost);
        for (let k = 0; k < nPost; k++) {
          const p = curve.getPointAt(k / (nPost - 1));
          const gz = p.y - g.height * 0.72;
          _m4.compose(_v.set(p.x, gz, p.z), _q.identity(), _s.set(1, g.height * 0.72, 1));
          posts.setMatrixAt(k, _m4);
        }
        rec.group.add(posts);
        rec.fade.push(rec.railMat);
        const mid = g.points[Math.floor(g.points.length / 2)];
        this._beacon(rec, 'rail', mid[0], mid[1], this.hAt(mid[0], mid[1]) + g.height + 2.2);
        break;
      }
      case 'backboard': {
        const [w, h] = g.size;
        const o = stand(g.x, g.y, ground, g.heading);
        const map = this._t('board', boardTexture);
        rec.boardMat = this._own(new THREE.MeshStandardMaterial({ color: 0xffffff, map, emissive: new THREE.Color(0xffffff), emissiveMap: map, emissiveIntensity: 0.25, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.92 }));
        const panel = this._mesh(this._geo(new THREE.BoxGeometry(w, h * 0.78, 0.35).translate(0, h * 0.61, 0)), rec.boardMat, { shadow: true });
        const postMat = this._body(0x2a2a36, { rough: 0.5, metal: 0.4 });
        const pGeo = this._geo(new THREE.CylinderGeometry(0.22, 0.26, h * 0.3, 8).translate(0, h * 0.15, 0));
        const p1 = this._mesh(pGeo, postMat), p2 = this._mesh(pGeo, postMat);
        p1.position.x = -w * 0.36; p2.position.x = w * 0.36;
        o.add(panel, p1, p2);
        rec.shake = o; rec.home = o.position.clone(); rec.fade.push(rec.boardMat, postMat);
        this._beacon(rec, 'backboard', g.x, g.y, ground + h + 2);
        break;
      }
      case 'funnel': {
        const map = this._t('funnel', () => swirlTexture(L.color, '#ffffff'));
        rec.decalMat = this._decal(map, { glow: 0.8, opacity: 0.8 });
        rec.swirl = map; map.center.set(0.5, 0.5);
        rec.group.add(this._mesh(this._geo(drapedDisc(V, this.groundAt, g.x, g.y, g.radius)), rec.decalMat, { order: 2 }));
        this._beacon(rec, 'funnel', g.x, g.y, ground + 4);
        break;
      }
      case 'ice': case 'mud': {
        const ice = g.kind === 'ice';
        const map = ice ? this._t('ice', iceTexture) : this._t('mud', () => blotchTexture('rgba(92,58,30,0.96)', '#3d2512', '#a8743e'));
        rec.decalMat = this._decal(map, ice ? { glow: 0.22, rough: 0.06, metal: 0.25 } : { glow: 0.04, rough: 0.3 });
        const geo = Array.isArray(g.size)
          ? drapedRect(V, this.groundAt, g.x, g.y, g.size[0] / 2, g.size[1] / 2, g.heading || 0, { nx: 6, ny: Math.max(6, Math.round(g.size[1] / 3)) })
          : drapedDisc(V, this.groundAt, g.x, g.y, g.radius, { rings: 5 });
        rec.group.add(this._mesh(this._geo(geo), rec.decalMat, { order: 2 }));
        this._beacon(rec, g.kind, g.x, g.y, ground + 4);
        break;
      }
      case 'warp': case 'warp-exit': {
        const cannon = g.style === 'cannon';
        const col = cannon ? 0x2b2f3a : 0x1faa4a, trim = cannon ? '#ffd21f' : '#b6ffcb';
        rec.bodyMat = this._body(col, { rough: 0.35, metal: cannon ? 0.6 : 0.15 });
        rec.trimMat = this._glow(trim, 1.2);
        rec.portalMat = this._light(this._t(`portal:${cannon ? 'c' : 'p'}`, () => swirlTexture(cannon ? '#ffb21f' : '#35e06a', '#ffffff')), 0xffffff, 0.85);
        rec.portalMat.map.center.set(0.5, 0.5);
        rec.swirl = rec.portalMat.map;
        if (g.kind === 'warp') {
          const r = g.radius, onGround = !Number.isFinite(g.z);
          if (onGround) {
            // a mouth in the ground: a chunky rim round a swirling portal
            const o = stand(g.x, g.y, ground, 0);
            const rim = this._mesh(this._geo(new THREE.TorusGeometry(r, Math.max(0.45, r * 0.2), 8, 30).rotateX(Math.PI / 2).translate(0, 0.25, 0)), rec.bodyMat);
            const lip = this._mesh(this._geo(new THREE.TorusGeometry(r * 0.86, 0.14, 6, 30).rotateX(Math.PI / 2).translate(0, 0.52, 0)), rec.trimMat);
            rec.portal = this._mesh(this._geo(new THREE.CircleGeometry(r * 0.84, 28).rotateX(-Math.PI / 2).translate(0, 0.3, 0)), rec.portalMat, { order: 13 });
            o.add(rim, lip, rec.portal);
            rec.flashAt = V(g.x, g.y, ground + 1);
          } else {
            // a mouth in the air: a portal ring facing the tee
            const face = this._tee ? Math.atan2(this._tee.x - g.x, this._tee.y - g.y) / RAD : 180;
            const o = stand(g.x, g.y, g.z, face);
            const rim = this._mesh(this._geo(new THREE.TorusGeometry(r, Math.max(0.5, r * 0.18), 8, 30)), rec.bodyMat, { shadow: true });
            const lip = this._mesh(this._geo(new THREE.TorusGeometry(r * 0.84, 0.16, 6, 30)), rec.trimMat);
            rec.portal = this._mesh(this._geo(new THREE.CircleGeometry(r * 0.84, 28)), rec.portalMat, { order: 13 });
            o.add(rim, lip, rec.portal);
            rec.flashAt = V(g.x, g.y, g.z);
          }
          const z = onGround ? ground : g.z;
          this._beacon(rec, 'warp', g.x, g.y, z + r + 2.5);
        } else {
          // where it fires from: a barrel laid along its heading at its angle
          const z = Number.isFinite(g.z) ? g.z : ground + 1.5;
          const len = cannon ? 7 : 5, R = cannon ? 1.5 : 1.3;
          const o = stand(g.x, g.y, z, g.heading);
          const barrel = new THREE.Group();
          barrel.rotation.x = g.angle * RAD;   // forward is -Z: tipping about +X lifts the muzzle
          const tube = this._mesh(this._geo(new THREE.CylinderGeometry(R, R * (cannon ? 1.25 : 1), len, 20, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -len / 2 + 1.2)), this._own(rec.bodyMat.clone()), { shadow: true });
          tube.material.side = THREE.DoubleSide;
          const lipR = R * 1.16;
          const muzzle = this._mesh(this._geo(new THREE.CylinderGeometry(lipR, lipR, 0.8, 20, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -len + 1.4)), rec.trimMat);
          muzzle.material.side = THREE.DoubleSide;
          rec.portal = this._mesh(this._geo(new THREE.CircleGeometry(R * 0.92, 20).translate(0, 0, -len + 1.5)), rec.portalMat, { order: 13 });
          barrel.add(tube, muzzle, rec.portal);
          o.add(barrel);
          if (cannon) {
            const wGeo = this._geo(new THREE.CylinderGeometry(1.5, 1.5, 0.5, 16).rotateZ(Math.PI / 2));
            const wMat = this._body(0x6b4a2a, { rough: 0.7 });
            const w1 = this._mesh(wGeo, wMat), w2 = this._mesh(wGeo, wMat);
            w1.position.set(-R - 0.5, -0.2, 0.6); w2.position.set(R + 0.5, -0.2, 0.6);
            o.add(w1, w2);
            rec.fade.push(wMat);
          } else if (z - ground > 0.4) {
            o.add(this._mesh(this._geo(new THREE.CylinderGeometry(R * 0.9, R * 0.9, z - ground + 1, 16).translate(0, -(z - ground + 1) / 2, 0.6)), rec.bodyMat, { shadow: true }));
          }
          rec.recoil = barrel;
          // the muzzle, in the world: where its flash goes
          const a = g.angle * RAD, hx = Math.sin(g.heading * RAD), hy = Math.cos(g.heading * RAD), d = len - 1.4;
          rec.flashAt = V(g.x + hx * Math.cos(a) * d, g.y + hy * Math.cos(a) * d, z + Math.sin(a) * d);
          rec.fade.push(tube.material);
          // one beacon serves a cannon whose mouth is at its foot
          const mouth = [...byId.values()].find((m) => m.kind === 'warp' && m.pair === g.id);
          if (!mouth || Math.hypot(mouth.x - g.x, mouth.y - g.y) > 10) this._beacon(rec, 'warp-exit', g.x, g.y, z + len * Math.sin(a) + 3);
        }
        rec.fade.push(rec.bodyMat, rec.trimMat);
        break;
      }
      case 'breakable': {
        const style = g.style || 'wall', P = BREAK_PAINT[style] || BREAK_PAINT.wall;
        rec.paint = P;
        if (Array.isArray(g.size)) {
          const [w, h] = g.size, thick = style === 'ice-wall' ? 1 : 1.5;
          const wallBase = Number.isFinite(g.z) ? g.z : ground;   // a wall may hang in the air (z: its foot)
          const o = stand(g.x, g.y, wallBase, g.heading);
          const map = this._t(`wall:${style}:${g.breakMph}:${(w / h).toFixed(1)}`, () => wallTexture(style, g.breakMph, w / h));
          const glow = this._t(`wallglow:${style}:${g.breakMph}:${(w / h).toFixed(1)}`, () => wallGlowTexture(g.breakMph, w / h, P.glow));
          rec.wallMat = this._own(new THREE.MeshStandardMaterial({
            color: 0xffffff, map, emissive: new THREE.Color(0xffffff), emissiveMap: glow, emissiveIntensity: 1.3,
            roughness: style === 'ice-wall' ? 0.12 : 0.85, metalness: style === 'ice-wall' ? 0.2 : 0,
            ...(style === 'ice-wall' ? { transparent: true, opacity: 0.86 } : {}),
          }));
          const sideMat = this._body(hex(P.line), { rough: 0.9, ...(style === 'ice-wall' ? { opacity: 0.8 } : {}) });
          const boxGeo = this._geo(new THREE.BoxGeometry(w, h + 0.6, thick).translate(0, (h + 0.6) / 2 - 0.6, 0));
          boxGeo.clearGroups(); boxGeo.addGroup(0, 24, 0); boxGeo.addGroup(24, 12, 1);   // its four edges, then its two faces
          const box = this._mesh(boxGeo, [sideMat, rec.wallMat], { shadow: true });
          o.add(box);
          rec.body = o; rec.home = o.position.clone(); rec.fade.push(rec.wallMat, sideMat);
          rec.span = { w, h }; rec.top = wallBase + h;
          this._beacon(rec, 'breakable', g.x, g.y, wallBase + h + 2);
        } else {
          const r = g.radius, h = g.height, base = Number.isFinite(g.z) ? g.z : ground;
          const o = stand(g.x, g.y, base, this._tee ? Math.atan2(this._tee.x - g.x, this._tee.y - g.y) / RAD + 180 : 0);
          if (style === 'snowman') {
            const snow = this._body(0xffffff, { rough: 0.8, emissive: 0xbfe2ff, glow: 0.12 });
            const rs = [h * 0.3, h * 0.22, h * 0.15];
            let y = 0;
            const balls = [];
            for (const rr of rs) { balls.push(new THREE.SphereGeometry(Math.min(rr, r), 16, 12).translate(0, y + rr * 0.9, 0)); y += rr * 1.55; }
            o.add(this._mesh(this._geo(fuse(balls)), snow, { shadow: true }));
            const nose = this._mesh(this._geo(new THREE.ConeGeometry(h * 0.035, h * 0.16, 8).rotateX(Math.PI / 2).translate(0, y - rs[2] * 0.7, h * 0.2)), this._glow('#ff8a2a', 0.9));
            o.add(nose);
            rec.fade.push(snow);
          } else if (style === 'pinata') {
            const mats = ['#ff4fd8', '#ffd21f', '#27e0ff', '#7dff5a'].map((c) => this._glow(c, 0.7));
            o.add(this._mesh(this._geo(new THREE.IcosahedronGeometry(r * 0.62, 0).translate(0, h * 0.5, 0)), mats[0], { shadow: true }));
            const dirs = [[0, 1, 0], [0, -1, 0], [1, 0.2, 0], [-1, 0.2, 0], [0, 0.2, 1], [0, 0.2, -1]];
            for (let c = 0; c < 3; c++) {
              const spikes = dirs.map((d, k) => (k % 3 === c ? new THREE.ConeGeometry(r * 0.32, r * 0.95, 6).translate(0, r * 0.95, 0).applyQuaternion(_q.setFromUnitVectors(UP, _v.set(d[0], d[1], d[2]).normalize())).translate(0, h * 0.5, 0) : null)).filter(Boolean);
              o.add(this._mesh(this._geo(fuse(spikes)), mats[1 + c]));
            }
            o.add(this._mesh(this._geo(new THREE.CylinderGeometry(0.05, 0.05, 6, 4).translate(0, h * 0.5 + r + 3, 0)), this._body(0x2a2a36)));
            rec.fade.push(...mats);
            rec.sway = o;
          } else {
            // crates (and anything else round): a stack with the number on it
            const map = this._t(`crate:${style}:${g.breakMph}`, () => wallTexture(style === 'ice-wall' ? 'ice-wall' : 'crate', g.breakMph, 1));
            const m = this._own(new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughness: 0.8 }));
            const side = r * 1.5;
            o.add(this._mesh(this._geo(new THREE.BoxGeometry(side, h * 0.62, side).translate(0, h * 0.31, 0)), m, { shadow: true }));
            const top = this._mesh(this._geo(new THREE.BoxGeometry(side * 0.66, h * 0.38, side * 0.66).translate(0, h * 0.81, 0)), m, { shadow: true });
            top.rotation.y = 0.5;
            o.add(top);
            rec.fade.push(m);
          }
          rec.body = o; rec.home = o.position.clone();
          rec.span = { w: r * 2, h }; rec.top = base + h;
          this._beacon(rec, 'breakable', g.x, g.y, base + h + 2);
        }
        break;
      }
      case 'coins': {
        const n = g.points.length;
        const s = farScale(this._distFromTee(g.points[Math.floor(n / 2)][0], g.points[Math.floor(n / 2)][1]));
        rec.coinR = 0.85 * s;
        rec.coinR = 1.0 * s;
        rec.coinMat = this._own(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
        const mesh = new THREE.InstancedMesh(this._geo(coinGeometry()), rec.coinMat, n);
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        rec.coins = mesh;
        rec.coinPos = g.points.map((p) => V(p[0], p[1], p[2]));
        rec.coinGot = new Array(n).fill(false);
        rec.coinAt = new Float32Array(n).fill(-1e9);   // when each was taken (it pops, then is gone)
        rec.group.add(mesh);
        break;
      }
      case 'zone': {
        const axis = this._tee ? Math.atan2(g.x - this._tee.x, g.y - this._tee.y) / RAD : 0;
        const col = g.mult === 3 ? '#ffd21f' : L.color;
        rec.decalMat = this._decal(this._t(`zone:${g.mult}`, () => zoneTexture(g.mult, col)), { glow: 0.85 });
        rec.group.add(this._mesh(this._geo(drapedDisc(V, this.groundAt, g.x, g.y, g.radius, { axisDeg: axis, rings: 5 })), rec.decalMat, { order: 2 }));
        rec.waveColor = hex(col);
        this._beacon(rec, 'zone', g.x, g.y, ground + 4);
        break;
      }
      default: return null;
    }
    // where its effects go, and how it is faded when it stands in the way
    const f = gadgetFootprint(g);
    rec.at = this.V(f.x, f.y, g.kind === 'ring' ? g.z : this.hAt(f.x, f.y) + 1);
    rec.foot = f;
    for (const m of rec.fade) m.userData.opacity0 = m.opacity;
    return rec;
  }

  // ---------------------------------------------------------------- effects (pooled)
  _fxInit() {
    const low = this.env().quality === 'low';
    const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.8 }), low ? 64 : DEBRIS_MAX);
    debris.frustumCulled = false; debris.castShadow = false;
    for (let i = 0; i < debris.count; i++) { debris.setMatrixAt(i, ZERO_M); debris.setColorAt(i, _c.set(0xffffff)); }
    const sparkN = low ? 90 : SPARK_MAX;
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sparkN * 3), 3));
    sGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(sparkN * 3), 3));
    const glow = this._t('glow', glowTexture);
    const sparks = new THREE.Points(sGeo, new THREE.PointsMaterial({ map: glow, size: 2.2, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }));
    sparks.frustumCulled = false; sparks.renderOrder = 16; sparks.visible = false;
    debris.visible = false;
    const waveGeo = new THREE.RingGeometry(0.82, 1, 48);
    const waves = [];
    for (let i = 0; i < WAVES; i++) {
      const m = new THREE.Mesh(waveGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false }));
      m.visible = false; m.renderOrder = 15; m.frustumCulled = false;
      waves.push({ mesh: m, t0: -1e9, life: 1, r0: 1, r1: 2 });
    }
    const flashes = [];
    for (let i = 0; i < FLASHES; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }));
      sp.visible = false; sp.renderOrder = 17;
      flashes.push({ sp, t0: -1e9, life: 0.4, size: 6 });
    }
    this._owned.push(debris.geometry, debris.material, sGeo, sparks.material, waveGeo, ...waves.map((w) => w.mesh.material), ...flashes.map((f) => f.sp.material));
    const D = debris.count;
    this._fx = {
      objects: [debris, sparks, ...waves.map((w) => w.mesh), ...flashes.map((f) => f.sp)],
      debris, D, dNext: 0, dUntil: -1e9,
      dP: new Float32Array(D * 3), dV: new Float32Array(D * 3), dS: new Float32Array(D), dT: new Float32Array(D).fill(-1e9), dLife: new Float32Array(D), dSpin: new Float32Array(D * 3), dFloor: new Float32Array(D), dLand: new Float32Array(D),
      sparks, S: sparkN, sNext: 0, sUntil: -1e9,
      sP: new Float32Array(sparkN * 3), sV: new Float32Array(sparkN * 3), sT: new Float32Array(sparkN).fill(-1e9), sLife: new Float32Array(sparkN), sC: new Float32Array(sparkN * 3),
      waves, wNext: 0, flashes, fNext: 0,
    };
    for (const o of this._fx.objects) this.group.add(o);
  }

  // pieces thrown from a box (centre p, half extents hx/hy/hz in three axes after `quat`), mostly along `dir`
  _debris(p, quat, hx, hy, hz, dir, n, colors, speed = 14, size = 0.8) {
    const F = this._fx;
    if (!F) return;
    const now = this._time;
    n = Math.min(n, F.D);
    for (let k = 0; k < n; k++) {
      const i = F.dNext; F.dNext = (F.dNext + 1) % F.D;
      // a repeatable scatter: nothing random in a picture both players watch
      const a = ((k * 0.61803) % 1), b = ((k * 0.41421) % 1), c = ((k * 0.73205) % 1);
      _v.set((a * 2 - 1) * hx, (b * 2 - 1) * hy, (c * 2 - 1) * hz).applyQuaternion(quat).add(p);
      F.dP[i * 3] = _v.x; F.dP[i * 3 + 1] = _v.y; F.dP[i * 3 + 2] = _v.z;
      const sp = speed * (0.35 + 0.65 * c);
      F.dV[i * 3] = dir.x * sp + (b - 0.5) * speed * 0.7;
      F.dV[i * 3 + 1] = Math.abs(dir.y) * sp + (0.25 + a * 0.75) * speed * 0.55;
      F.dV[i * 3 + 2] = dir.z * sp + (a - 0.5) * speed * 0.7;
      F.dS[i] = size * (0.5 + b);
      F.dSpin[i * 3] = (a - 0.5) * 12; F.dSpin[i * 3 + 1] = (b - 0.5) * 12; F.dSpin[i * 3 + 2] = (c - 0.5) * 12;
      F.dT[i] = now; F.dLife[i] = 1.7 + c * 0.9;
      F.dFloor[i] = p.y - hy - 0.2;
      // when it reaches the ground: it lies where it lands
      { const vy = F.dV[i * 3 + 1], drop = Math.max(0, F.dP[i * 3 + 1] - F.dFloor[i]); F.dLand[i] = (vy + Math.sqrt(vy * vy + 2 * G_FX * drop)) / G_FX; }
      F.debris.setColorAt(i, _c.set(colors[k % colors.length]));
    }
    if (F.debris.instanceColor) F.debris.instanceColor.needsUpdate = true;
    F.dUntil = Math.max(F.dUntil, now + 2.8);
  }

  _sparks(p, n, color, speed = 9, life = 0.8) {
    const F = this._fx;
    if (!F) return;
    const now = this._time;
    _c.set(color);
    n = Math.min(n, F.S);
    for (let k = 0; k < n; k++) {
      const i = F.sNext; F.sNext = (F.sNext + 1) % F.S;
      const a = (k * 2.39996) % TAU, u = ((k * 0.61803) % 1) * 2 - 1, s = Math.sqrt(1 - u * u);
      F.sP[i * 3] = p.x; F.sP[i * 3 + 1] = p.y; F.sP[i * 3 + 2] = p.z;
      const sp = speed * (0.4 + 0.6 * ((k * 0.41421) % 1));
      F.sV[i * 3] = Math.cos(a) * s * sp; F.sV[i * 3 + 1] = u * sp + speed * 0.35; F.sV[i * 3 + 2] = Math.sin(a) * s * sp;
      F.sT[i] = now; F.sLife[i] = life * (0.6 + 0.4 * ((k * 0.73205) % 1));
      F.sC[i * 3] = _c.r; F.sC[i * 3 + 1] = _c.g; F.sC[i * 3 + 2] = _c.b;
    }
    F.sUntil = Math.max(F.sUntil, now + life + 0.1);
  }

  // an expanding ring of light: in a ring's plane (normal), or flat on the ground (normal null)
  _wave(p, normal, r0, r1, color, life = 0.6) {
    const F = this._fx;
    if (!F) return;
    const w = F.waves[F.wNext]; F.wNext = (F.wNext + 1) % F.waves.length;
    w.mesh.position.copy(p);
    if (normal) w.mesh.quaternion.setFromUnitVectors(_v.set(0, 0, 1), normal);
    else w.mesh.quaternion.setFromAxisAngle(_v.set(1, 0, 0), -Math.PI / 2);
    w.mesh.material.color.set(color);
    w.t0 = this._time; w.life = life; w.r0 = r0; w.r1 = r1;
    w.mesh.visible = true;
  }

  _flash(p, size, color, life = 0.35) {
    const F = this._fx;
    if (!F) return;
    const f = F.flashes[F.fNext]; F.fNext = (F.fNext + 1) % F.flashes.length;
    f.sp.position.copy(p); f.sp.material.color.set(color);
    f.t0 = this._time; f.life = life; f.size = size; f.sp.visible = true;
  }

  _fxStep(time) {
    const F = this._fx;
    if (!F) return;
    const debrisOn = time < F.dUntil + 0.1 && F.dUntil > -1e8;
    if (F.debris.visible !== debrisOn) F.debris.visible = debrisOn;
    if (debrisOn) {
      for (let i = 0; i < F.D; i++) {
        const t = time - F.dT[i];
        if (t < 0 || t > F.dLife[i]) { if (F.dT[i] > -1e8) { F.debris.setMatrixAt(i, ZERO_M); F.dT[i] = -1e9; } continue; }
        const tt = Math.min(t, F.dLand[i]);
        const y = Math.max(F.dFloor[i], F.dP[i * 3 + 1] + F.dV[i * 3 + 1] * tt - 0.5 * G_FX * tt * tt);
        const k = 1 - smooth(F.dLife[i] - 0.4, F.dLife[i], t);
        _e.set(F.dSpin[i * 3] * tt, F.dSpin[i * 3 + 1] * tt, F.dSpin[i * 3 + 2] * tt);
        _m4.compose(_v.set(F.dP[i * 3] + F.dV[i * 3] * tt, y, F.dP[i * 3 + 2] + F.dV[i * 3 + 2] * tt), _q.setFromEuler(_e), _s.setScalar(F.dS[i] * k));
        F.debris.setMatrixAt(i, _m4);
      }
      F.debris.instanceMatrix.needsUpdate = true;
    }
    if (time < F.sUntil + 0.1 && F.sUntil > -1e8) {
      const pos = F.sparks.geometry.attributes.position, col = F.sparks.geometry.attributes.color;
      for (let i = 0; i < F.S; i++) {
        const t = time - F.sT[i];
        if (t < 0 || t > F.sLife[i]) { pos.setXYZ(i, 0, -1e5, 0); col.setXYZ(i, 0, 0, 0); continue; }
        const k = 1 - t / F.sLife[i];
        pos.setXYZ(i, F.sP[i * 3] + F.sV[i * 3] * t, F.sP[i * 3 + 1] + F.sV[i * 3 + 1] * t - 4 * t * t, F.sP[i * 3 + 2] + F.sV[i * 3 + 2] * t);
        col.setXYZ(i, F.sC[i * 3] * k, F.sC[i * 3 + 1] * k, F.sC[i * 3 + 2] * k);
      }
      pos.needsUpdate = true; col.needsUpdate = true;
      F.sparks.visible = true;
    } else if (F.sparks.visible) { F.sparks.visible = false; }
    for (const w of F.waves) {
      if (!w.mesh.visible) continue;
      const u = (time - w.t0) / w.life;
      if (u >= 1 || u < 0) { w.mesh.visible = false; continue; }
      const e = 1 - (1 - u) * (1 - u);
      w.mesh.scale.setScalar(w.r0 + (w.r1 - w.r0) * e);
      w.mesh.material.opacity = 0.9 * (1 - u);
    }
    for (const f of F.flashes) {
      if (!f.sp.visible) continue;
      const u = (time - f.t0) / f.life;
      if (u >= 1 || u < 0) { f.sp.visible = false; continue; }
      f.sp.scale.setScalar(f.size * (0.6 + 1.2 * u));
      f.sp.material.opacity = 0.7 * (1 - u);
    }
  }

  // ---------------------------------------------------------------- a shot
  /**
   * A shot is away. events: shot.sim.events (playback time); toPlayTime: shot time -> playback
   * time (arcade/feel.js; none: the same clock); playDur: how long the shot plays for.
   */
  onShot(events, { toPlayTime = null, playDur = Infinity } = {}) {
    this.respawn(true);
    this._tl = gadgetTimeline(events);
    this._tlI = 0;
    this._warps = warpWindows(this._tl);
    this._shotT = 0;
    this._stepAt = this._time;
    this._respawnAt = null;
    this._lastBall = null;
    for (const rec of this.recs) if (rec.kind === 'geyser') rec.windows = geyserWindows(rec.g, { toPlayTime, playDur });
  }

  /** The shot's clock is at t (playback seconds) and the ball at `ball` { x, y, z } (course metres). */
  step(t, ball = null) {
    if (this._shotT === null) return;
    this._shotT = t;
    this._stepAt = this._time;
    if (ball && Number.isFinite(ball.x)) {
      if (this._lastBall) {
        const dx = ball.x - this._lastBall.x, dy = ball.y - this._lastBall.y, dz = (ball.z || 0) - this._lastBall.z;
        const l = Math.hypot(dx, dy, dz);
        if (l > 0.05 && l < 40) this._ballDir.set(dx / l, dz / l, -dy / l);   // (a warp's jump is no direction)
        this._lastBall.x = ball.x; this._lastBall.y = ball.y; this._lastBall.z = ball.z || 0;
      } else this._lastBall = { x: ball.x, y: ball.y, z: ball.z || 0 };
    }
    while (this._tlI < this._tl.length && this._tl[this._tlI].t <= t) this._react(this._tl[this._tlI++]);
  }

  /** The ball has stopped: the geysers settle, and what broke or was taken stands again shortly. */
  endShot(abandoned = false) {
    if (this._shotT === null) return;
    // (anything the clock never reached plays now: a contact in the shot's last frame)
    while (!abandoned && this._tlI < this._tl.length) this._react(this._tl[this._tlI++]);
    this._shotT = null;
    this._respawnAt = this._time + RESPAWN_S;
    for (const rec of this.recs) if (rec.kind === 'geyser') rec.windows = [];
  }

  ballHidden(t) { return ballHiddenAt(this._warps, t); }

  /** Everything smashed or collected stands again (now: at once, without the pop). */
  respawn(now = false) {
    this._respawnAt = null;
    let any = false;
    for (const rec of this.recs) {
      if (rec.broken) { rec.broken = false; if (rec.body) rec.body.visible = true; if (rec.beacon) rec.beacon.visible = true; rec.popAt = now ? -1e9 : this._time; any = true; }
      if (rec.coins && rec.coinGot.some(Boolean)) { rec.coinGot.fill(false); rec.coinAt.fill(-1e9); rec.popAt = now ? -1e9 : this._time; }
      rec.hitFx = null;
    }
    if (any) this.onChange?.();
  }

  // one contact, as the ball reaches it
  _react(r) {
    const rec = this._byId.get(r.id);
    const now = this._time;
    const at = this.V(r.x, r.y, r.z);
    if (rec) { rec.hitAt = now; rec.hitFx = r.effect; }
    const look = GADGET_LOOK[r.kind] || GADGET_LOOK.ring;
    switch (r.kind) {
      case 'ring':
        if (rec) { this._wave(rec.center, rec.normal, rec.g.radius * 0.9, rec.g.radius * 2.6, look.color, 0.7); this._wave(rec.center, rec.normal, rec.g.radius * 0.5, rec.g.radius * 1.7, 0xffffff, 0.45); }
        this._flash(at, 7, look.glow, 0.3);
        this._sparks(at, 36, look.color, 16, 0.7);
        break;
      case 'pad':
        this._wave(at, null, 1, (rec ? rec.g.radius : 5) * 1.6, look.color, 0.5);
        this._sparks(at, 18, look.glow, 9, 0.6);
        break;
      case 'strip': this._sparks(at, 14, look.color, 7, 0.5); break;
      case 'fan': break;
      case 'geyser':
        this._flash(at, 8, look.glow, 0.4);
        this._sparks(at, 40, this._theme === 'volcano' ? 0xff9a40 : 0xdff6ff, 18, 1.0);
        break;
      case 'bumper': case 'rail':
        this._flash(at, 7, look.glow, 0.25);
        this._wave(at, null, 0.6, 4.5, look.glow, 0.35);
        this._sparks(at, 16, look.glow, 10, 0.45);
        break;
      case 'backboard': this._flash(at, 6, look.glow, 0.25); break;
      case 'funnel': this._wave(at, null, (rec ? rec.g.radius : 8), 1, look.color, 0.8); break;
      case 'ice': this._sparks(at, 12, 0xffffff, 5, 0.5); break;
      case 'mud': this._debris(at, _q.identity(), 0.8, 0.1, 0.8, UP, 14, [0x5c3a1e, 0x3d2512, 0x7a5230], 6, 0.35); break;
      case 'warp': case 'warp-exit': {
        const p = rec && rec.flashAt ? rec.flashAt : at;
        this._flash(p, r.kind === 'warp-exit' ? 10 : 7, look.glow, 0.4);
        this._wave(p, null, 0.8, r.kind === 'warp-exit' ? 9 : 6, look.color, 0.55);
        this._sparks(p, r.kind === 'warp-exit' ? 44 : 26, look.color, r.kind === 'warp-exit' ? 20 : 10, 0.8);
        break;
      }
      case 'breakable':
        if (r.effect === 'smash' && rec) {
          rec.broken = true;
          if (rec.body) rec.body.visible = false;
          if (rec.beacon) rec.beacon.visible = false;
          const P = rec.paint || BREAK_PAINT.wall;
          _q2.setFromAxisAngle(UP, rec.body ? rec.body.rotation.y : 0);
          const c = rec.body ? _s.copy(rec.home) : _s.copy(at);
          c.y += rec.span.h / 2;
          const big = rec.span.w * rec.span.h;
          this._debris(c, _q2, rec.span.w / 2, rec.span.h / 2, 0.6, this._ballDir, Math.round(Math.min(DEBRIS_MAX, 26 + big * 0.45)), P.debris, 16, Math.max(0.6, Math.min(2.6, Math.sqrt(big) * 0.09)));
          this._flash(at, Math.min(14, 5 + rec.span.h * 0.4), P.glow, 0.35);
          this._wave(at, _n.set(Math.sin(-(rec.body ? rec.body.rotation.y : 0)), 0, -Math.cos(rec.body ? rec.body.rotation.y : 0)), 1.5, Math.max(8, rec.span.h * 0.9), 0xffffff, 0.5);
          this._sparks(at, 40, P.glow, 18, 0.8);
          this.onChange?.();
        } else {
          this._flash(at, 6, 0xff5a3c, 0.3);
          this._sparks(at, 10, 0xffffff, 6, 0.4);
        }
        break;
      case 'coins':
        if (rec && r.effect === 'coin' && Number.isInteger(r.ev.index) && r.ev.index < rec.coinGot.length) {
          rec.coinGot[r.ev.index] = true; rec.coinAt[r.ev.index] = now;
          this._sparks(rec.coinPos[r.ev.index], 10, 0xffd21f, 8, 0.55);
        } else if (r.effect === 'full') {
          this._flash(at, 9, 0xffe08a, 0.5);
          this._sparks(at, 70, 0xffd21f, 22, 1.1);
          this._wave(at, this._ballDir, 1, 12, 0xffd21f, 0.7);
        }
        break;
      case 'zone':
        this._wave(at, null, 1, (rec ? rec.g.radius : 8) * 1.5, rec ? rec.waveColor : look.color, 0.8);
        this._wave(at, null, 0.5, (rec ? rec.g.radius : 8), 0xffffff, 0.5);
        this._sparks(at, r.ev.mult === 3 ? 50 : 30, rec ? rec.waveColor : look.color, 12, 0.9);
        break;
      default: break;
    }
    try { this.onHit?.(r.ev); } catch (e) { console.warn('[gadgets] onHit failed', e); }
  }

  // ---------------------------------------------------------------- every frame
  update(time, camera = null) {
    this._time = time;
    if (!this.recs.length) return;
    if (this._respawnAt !== null && time >= this._respawnAt) this.respawn(false);
    // a shot whose picture was cut short (a replay ended, the course changed hands): let it go
    if (this._shotT !== null && time - this._stepAt > 2) this.endShot(true);
    const shot = this._shotT;
    const cx = camera ? camera.position.x : 0, cy = camera ? camera.position.y : 0, cz = camera ? camera.position.z : 0;
    for (const rec of this.recs) {
      const g = rec.g, since = time - rec.hitAt;
      const pop = time - rec.popAt < POP_S ? spring(time - rec.popAt, 0.55, 16, 9) : 1;
      switch (rec.kind) {
        case 'ring': {
          const hit = since < 0.8 ? 1 - since / 0.8 : 0;
          rec.spin.scale.setScalar(1 + 0.03 * Math.sin(time * 2.4 + rec.far * 0.05) + 0.16 * hit * Math.sin(since * 22));
          rec.arrows.rotation.z = -time * 0.7;
          rec.rim.emissiveIntensity = 1.5 + 0.5 * Math.sin(time * 2.4) + 7 * hit;
          rec.arrowsMat.opacity = 0.5 + 0.2 * Math.sin(time * 4.8) + 0.5 * hit;
          break;
        }
        case 'pad': {
          const sq = since < 1.2 ? spring(since, 0.25, 20, 5) : 1;
          rec.flex.scale.set(1 + (1 - sq) * 0.35, (1 + 0.1 * Math.sin(time * 3.2 + rec.far)) * sq, 1 + (1 - sq) * 0.35);
          rec.topMat.emissiveIntensity = 1.3 + 0.5 * Math.sin(time * 3.2 + rec.far) + (since < 0.6 ? 6 * (1 - since / 0.6) : 0);
          break;
        }
        case 'strip':
          rec.scroll.offset.y = -((time * 1.6) % 1);
          rec.decalMat.emissiveIntensity = 1.1 + (since < 0.7 ? 3 * (1 - since / 0.7) : 0);
          break;
        case 'fan':
          rec.blades.rotation.z = -time * 9;
          rec.scroll.offset.x = -((time * 1.4) % 1);
          if (rec.lane) rec.lane.offset.y = -((time * 1.1) % 1);
          if (rec.swirl) rec.swirl.rotation = time * 1.6;
          rec.streamMat.opacity = 0.6 + (since < 1 ? 0.4 * (1 - since) : 0);
          break;
        case 'geyser': {
          const st = shot === null ? geyserState(null, 0) : geyserState(rec.windows, shot);
          // pressure builds: the pool brightens, the mound trembles, the steam thickens; then the column
          const p = st.pressure;
          rec.poolMat.emissiveIntensity = 0.6 + 4.5 * p * p + (st.on ? 4 : 0);
          rec.zoneMat.emissiveIntensity = 0.35 + 1.4 * p * p;
          rec.zoneMat.map.rotation = time * (0.4 + 2.5 * p);
          const shake = st.on ? 0.1 : p > 0.6 ? 0.07 * (p - 0.6) / 0.4 : 0;
          rec.mound.position.set(rec.home.x + Math.sin(time * 61) * shake, rec.home.y, rec.home.z + Math.cos(time * 53) * shake);
          rec.steam.material.opacity = 0.18 + 0.5 * p;
          rec.steam.scale.set(g.radius * (1 + 0.8 * p), g.radius * (1.4 + 1.6 * p + 0.2 * Math.sin(time * 5)), 1);
          // up fast, hold, fall away
          const env = st.on ? Math.min(1, st.k / 0.12) * (1 - smooth(0.78, 1, st.k)) : 0;
          rec.col.visible = env > 0.01;
          if (rec.col.visible) {
            rec.col.scale.set(1 + 0.12 * Math.sin(time * 31), Math.max(0.5, rec.h * env), 1 + 0.12 * Math.cos(time * 27));
            rec.colMat.opacity = 0.75 * env + 0.15;
          }
          rec.scroll.offset.y = -((time * 3.1) % 1);
          break;
        }
        case 'bumper': {
          const k = since < 0.5 ? spring(since, 1.45, 30, 8) : 1;
          rec.kick.scale.set(k, 1 + (1 - k) * 0.4, k);
          const flash = since < 0.4 ? 1 - since / 0.4 : 0;
          rec.capMat.emissiveIntensity = 1.2 + 0.4 * Math.sin(time * 4 + rec.far) + 7 * flash;
          rec.ringMat.emissiveIntensity = 1.3 + (Math.sin(time * 9 + rec.far) > 0 ? 0.9 : 0) + 7 * flash;
          break;
        }
        case 'rail':
          rec.scroll.offset.y = (time * 0.8) % 1;
          rec.railMat.emissiveIntensity = 0.9 + (since < 0.4 ? 5 * (1 - since / 0.4) : 0);
          break;
        case 'backboard': {
          const sh = since < 0.5 ? (1 - since / 0.5) * 0.18 : 0;
          rec.shake.position.set(rec.home.x + Math.sin(time * 70) * sh, rec.home.y, rec.home.z + Math.cos(time * 63) * sh);
          rec.boardMat.emissiveIntensity = 0.25 + (since < 0.5 ? 2.5 * (1 - since / 0.5) : 0);
          break;
        }
        case 'funnel':
          rec.swirl.rotation = time * 0.9;
          rec.decalMat.emissiveIntensity = 0.8 + 0.25 * Math.sin(time * 2) + (since < 0.8 ? 2.5 * (1 - since / 0.8) : 0);
          break;
        case 'ice':
          rec.decalMat.emissiveIntensity = 0.22 + 0.08 * Math.sin(time * 1.7 + rec.far) + (since < 0.6 ? 1.2 * (1 - since / 0.6) : 0);
          break;
        case 'mud': break;
        case 'warp': case 'warp-exit': {
          rec.swirl.rotation = -time * 2.2;
          const flash = since < 0.6 ? 1 - since / 0.6 : 0;
          rec.portalMat.opacity = 0.75 + 0.2 * Math.sin(time * 5) + flash * 0.4;
          rec.trimMat.emissiveIntensity = 1.2 + 0.4 * Math.sin(time * 3) + 8 * flash;
          if (rec.recoil) rec.recoil.position.z = since < 0.5 ? 1.4 * Math.exp(-7 * since) * Math.cos(9 * since) : 0;
          if (rec.portal) rec.portal.scale.setScalar(1 + 0.25 * flash);
          break;
        }
        case 'breakable': {
          if (rec.broken || !rec.body) break;
          const held = rec.hitFx === 'bounce' && since < 0.6 ? (1 - since / 0.6) : 0;
          rec.body.position.set(rec.home.x + Math.sin(time * 77) * 0.22 * held, rec.home.y, rec.home.z + Math.cos(time * 69) * 0.22 * held);
          rec.body.scale.setScalar(pop);
          if (rec.wallMat) rec.wallMat.emissiveIntensity = 1.3 + 0.35 * Math.sin(time * 2.2) + 4 * held;
          if (rec.sway) rec.sway.rotation.z = 0.12 * Math.sin(time * 1.3 + rec.far);
          break;
        }
        case 'coins': {
          const n = rec.coinPos.length;
          for (let i = 0; i < n; i++) {
            const took = time - rec.coinAt[i];
            let s = rec.coinR * pop;
            if (rec.coinGot[i]) s = took < 0.18 ? rec.coinR * (1 + 3 * took) * (1 - took / 0.18) : 0;
            if (s <= 0) { rec.coins.setMatrixAt(i, ZERO_M); continue; }
            const p = rec.coinPos[i];
            _q.setFromAxisAngle(UP, time * 3 + i * 0.7);
            _m4.compose(_v.set(p.x, p.y + 0.25 * Math.sin(time * 2 + i), p.z), _q, _s.setScalar(s));
            rec.coins.setMatrixAt(i, _m4);
          }
          rec.coins.instanceMatrix.needsUpdate = true;
          break;
        }
        case 'zone':
          rec.decalMat.emissiveIntensity = 0.85 + 0.3 * Math.sin(time * 2.6 + rec.far) + (since < 1 ? 4 * (1 - since) : 0);
          break;
        default: break;
      }
      // its beacon: there from range, gone close by (and with a wall that is down)
      if (rec.beacon && rec.beacon.visible) {
        const d = Math.hypot(rec.beacon.position.x - cx, rec.beacon.position.y - cy, rec.beacon.position.z - cz);
        rec.beacon.material.opacity = camera ? smooth(BEACON_NEAR_M, BEACON_FAR_M, d) * (1 - 0.8 * rec.ghost) : 1;
      }
      // the pass-through view
      if (rec.ghost !== rec.ghostT) {
        const step = 0.12;
        rec.ghost = Math.abs(rec.ghostT - rec.ghost) < step ? rec.ghostT : rec.ghost + Math.sign(rec.ghostT - rec.ghost) * step;
        for (const m of rec.fade) {
          const o0 = m.userData.opacity0 ?? 1;
          m.opacity = o0 * (1 - (1 - GHOST_OPACITY) * rec.ghost);
          const see = rec.ghost > 0.01 || o0 < 1;
          if (m.transparent !== see) { m.transparent = see; m.needsUpdate = true; }
          m.depthWrite = rec.ghost < 0.5 && o0 >= 1;
        }
      }
    }
    this._fxStep(time);
  }

  // ---------------------------------------------------------------- the cameras
  /** Every standing or hanging gadget as an upright cylinder [{ id, x, y, r, base, top }]. */
  obstacles() { return this._obst; }
  /** For the address camera's crown field: discs { x, y, r, top, base, solid }; nothing for a gadget `skip` {x, y} is inside. */
  blockers(skip = null, minH = 2.5) {
    const list = gadgetBlockers(this.gadgets, this.hAt, minH);
    return skip ? list.filter((b) => Math.hypot(skip.x - b.x, skip.y - b.y) > b.r + 1) : list;
  }
  /** (x, y) -> the height a camera must stay above there (-Infinity in the open), or null with no gadgets. */
  ceiling(marginM = 1.5) { return gadgetCeiling(this._obst, marginM); }

  /**
   * The pass-through view (props.js setSeeThrough's contract): a standing gadget on the line of
   * sight from the address camera to the ball or over the first metres of the shot, one the
   * camera is inside, or one the ball at rest lies inside, is faded (never popped out).
   */
  setSeeThrough(line, cam = null, ball = null) {
    if (!this.recs.length) return;
    const key = (line ? [line.x, line.y, line.d, line.camZ].map((v) => Math.round(v * 4)).join(',') + `|${Math.round(Math.atan2(line.ux, line.uy) * 400)}` : '')
      + (cam ? `|c${Math.round(cam.x * 2)},${Math.round(cam.y * 2)},${Math.round(cam.z * 2)}` : '') + (ball ? `|b${Math.round(ball.x * 2)},${Math.round(ball.y * 2)}` : '');
    if (key === this._seeKey) return;
    this._seeKey = key;
    for (const rec of this.recs) rec.ghostT = 0;
    for (const o of this._obst) {
      const rec = this._byId.get(o.id);
      if (!rec || rec.ghostT === 1 || !rec.fade.length) continue;
      let ghost = (!!cam && Math.hypot(cam.x - o.x, cam.y - o.y) < o.r + 1.5 && cam.z < o.top + 1 && cam.z > o.base - 1)
        || (!!ball && Math.hypot(ball.x - o.x, ball.y - o.y) < o.r + 0.5);
      if (!ghost && line) {
        const len = line.d + line.aheadM;
        const rx = o.x - line.x, ry = o.y - line.y;
        const al = rx * line.ux + ry * line.uy, lat = Math.abs(rx * line.uy - ry * line.ux);
        if (al > -o.r && al < len + o.r && lat < o.r + 1.2 + 0.03 * Math.max(0, al)) {
          const s = Math.max(0, Math.min(len, al));
          const sight = s <= line.d ? line.camZ + (line.ballZ - line.camZ) * (s / Math.max(1e-6, line.d)) : line.camZ + (line.endZ - line.camZ) * (s / len);
          ghost = o.top > sight - 0.5 && o.base < sight + 3;
        }
      }
      if (ghost) rec.ghostT = 1;
    }
  }
  seeThroughCount() { let n = 0; for (const rec of this.recs) if (rec.ghostT === 1) n++; return n; }

  /** What is drawn, for tests and probes: [{ id, kind, broken, ghost, coinsLeft }]. */
  describe() {
    return this.recs.map((r) => ({
      id: r.id, kind: r.kind, broken: !!r.broken, ghost: r.ghostT === 1,
      ...(r.coinGot ? { coinsLeft: r.coinGot.filter((x) => !x).length } : {}),
      ...(r.kind === 'geyser' ? { windows: r.windows.map((w) => ({ t0: w.t0, t1: w.t1 })), ...geyserState(this._shotT === null ? null : r.windows, this._shotT ?? 0) } : {}),
    }));
  }
}
