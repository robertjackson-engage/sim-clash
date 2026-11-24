// BALL SKINS: the golf ball itself takes the look of the power-up ball that is armed, the
// moment it is picked, and keeps it through the strike, the flight, the bounces, the roll
// and into the cup. The next ball is plain white again (or whatever is armed next).
//
//   scene.setBallSkin(id | null, { curse, pop })   the ball at rest (the armed ball)
//   scene.playShot(points, t, done, { ballSkin })  the ball that was hit, for that shot
//
// A skin is cheap on purpose: the ONE ball mesh with its material's maps and numbers
// swapped, one glow sprite round it (the aura), and one small pool of point sprites for
// what comes off it (a flame licking off a rocket, feather motes, glitter). No lights.
// The ball is a handful of pixels from the tee, so a skin is told from the others first by
// its COLOUR, its aura and its idle motion; the painted pattern is for the close-ups.
//
// The skin table and the functions that pick a skin (ballSkin, ballSkinId, restBallLook)
// are pure, so they are unit-tested (test/arcade-look.test.mjs). Nothing here touches the
// DOM or the GPU until a skin is first put on.
import * as THREE from 'three';
import { makeGlow } from './shot-fx.js';

const TAU = Math.PI * 2;

// Every ball's anchor colour: lib/arcade.js POWERUPS[].color, so the ball, its trail and
// its token in the dock agree (a test holds the two lists together).
export const BALL_SKIN_COLORS = Object.freeze({
  rocket: 0xff5a1f, sticky: 0xffb300, magnet: 0xe53935, windcutter: 0x7fe3ff, laser: 0xff2bd6,
  moonball: 0xc9d4ff, bouncy: 0xff8a3d, fireball: 0xff3d00, ghost: 0xb8f4ff, skipper: 0x2f9bff,
  yoyo: 0x9b5cff, homing: 0x39ff88, titan: 0x9aa7b8, feather: 0xfff6d5, gold: 0xffd700,
});
// Tricks are played on an opponent: they never skin a ball. A cursed shooter's ball may
// show it (gust: wind round the ball; the others change the cup or the HUD, not the ball).
export const BALL_TRICKS = Object.freeze(['gust', 'tiny-cup', 'fog']);
export const BALL_CURSE_MARKS = Object.freeze(['gust']);

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const C = BALL_SKIN_COLORS;

// ---- painters: a skin's surface on an equirect canvas (u round the ball, v pole to pole).
// Each takes (g, W, H, rnd); `glow` painters draw on black: what they draw is self-lit.
const fill = (g, W, H, c) => { g.fillStyle = c; g.fillRect(0, 0, W, H); };
const grad = (g, W, H, top, bottom) => { const l = g.createLinearGradient(0, 0, 0, H); l.addColorStop(0, top); l.addColorStop(1, bottom); g.fillStyle = l; g.fillRect(0, 0, W, H); };
const band = (g, W, H, v0, v1, c) => { g.fillStyle = c; g.fillRect(0, v0 * H, W, (v1 - v0) * H); };
const dot = (g, x, y, r, c) => { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
const line = (g, pts, w, c) => { g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };
function cracks(g, W, H, rnd, outer, inner) {
  for (let k = 0; k < 16; k++) {
    let x = rnd() * W, y = (0.1 + rnd() * 0.8) * H;
    const pts = [[x, y]];
    for (let i = 0; i < 7; i++) { x += (rnd() - 0.5) * W * 0.16; y += (rnd() - 0.5) * H * 0.3; pts.push([x, y]); }
    line(g, pts, H * 0.07, outer);
    line(g, pts, H * 0.026, inner);
  }
}
const rings = (g, cx, cy, radii, w, c) => { g.strokeStyle = c; g.lineWidth = w; for (const r of radii) { g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke(); } };

const PAINT = {
  rocket(g, W, H) {
    grad(g, W, H, '#e2e6ee', '#8f96a4');
    band(g, W, H, 0, 0.2, '#e8372a');                       // the nose
    band(g, W, H, 0.2, 0.225, '#3a3f4a');
    for (let i = 0; i < 16; i++) dot(g, (i + 0.5) * W / 16, 0.27 * H, H * 0.014, '#5a6170');
    for (let i = 0; i < 4; i++) { g.fillStyle = '#e8372a'; g.beginPath(); const x = (i + 0.5) * W / 4; g.moveTo(x, 0.5 * H); g.lineTo(x + W * 0.05, 0.7 * H); g.lineTo(x - W * 0.05, 0.7 * H); g.fill(); }   // fins
    band(g, W, H, 0.7, 0.82, '#ff8a1f');                    // the nozzle band, glowing
    band(g, W, H, 0.82, 1, '#3a3f4a');
  },
  rocketGlow(g, W, H) { band(g, W, H, 0.7, 0.82, '#ff8a1f'); band(g, W, H, 0.9, 1, '#ffd24a'); },
  fireball(g, W, H, rnd) { fill(g, W, H, '#2a0a04'); cracks(g, W, H, rnd, '#ff4a0c', '#ffd24a'); },
  fireballGlow(g, W, H, rnd) { cracks(g, W, H, rnd, '#ff4a0c', '#ffe27a'); },
  ghost(g, W, H) {
    grad(g, W, H, '#f4feff', '#bfeeff');
    for (const u of [0.25, 0.75]) {                          // a face, front and back
      for (const s of [-1, 1]) { g.fillStyle = '#3a5a6a'; g.beginPath(); g.ellipse((u + s * 0.035) * W, 0.42 * H, W * 0.016, H * 0.07, 0, 0, TAU); g.fill(); }
      g.fillStyle = '#3a5a6a'; g.beginPath(); g.ellipse(u * W, 0.62 * H, W * 0.02, H * 0.05, 0, 0, TAU); g.fill();
    }
  },
  ghostGlow(g, W, H) { fill(g, W, H, '#6fd0ee'); },
  gold(g, W, H, rnd) {
    grad(g, W, H, '#ffe27a', '#d89a1a');
    band(g, W, H, 0.46, 0.54, '#b8860b');
    for (let i = 0; i < 8; i++) {                            // a ring of stars
      const x = (i + 0.5) * W / 8, y = 0.5 * H, r = H * 0.09;
      g.fillStyle = '#fff3b0'; g.beginPath();
      for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU - Math.PI / 2, rr = k % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr * 0.55, y + Math.sin(a) * rr); }
      g.fill();
    }
    for (let i = 0; i < 60; i++) dot(g, rnd() * W, rnd() * H, H * 0.008, '#fffbe0');
  },
  goldGlow(g, W, H, rnd) { fill(g, W, H, '#3a2600'); for (let i = 0; i < 60; i++) dot(g, rnd() * W, rnd() * H, H * 0.012, '#fff3b0'); },
  titan(g, W, H) {
    fill(g, W, H, '#2b2f38');
    band(g, W, H, 0.44, 0.56, '#4a5260');
    for (let i = 0; i <= 8; i++) line(g, [[i * W / 8, 0], [i * W / 8, H]], H * 0.012, '#14161a');
    for (const v of [0.25, 0.44, 0.56, 0.75]) line(g, [[0, v * H], [W, v * H]], H * 0.012, '#14161a');
    for (const v of [0.47, 0.53, 0.22, 0.78]) for (let i = 0; i < 24; i++) dot(g, (i + 0.5) * W / 24, v * H, H * 0.016, '#aab4c4');   // rivets
  },
  feather(g, W, H) {
    fill(g, W, H, '#fffdf2');
    for (let i = 0; i < 9; i++) {                            // quills and barbs
      const x = (i + 0.5) * W / 9;
      line(g, [[x, 0.14 * H], [x + W * 0.02, 0.86 * H]], H * 0.012, '#e6d8b0');
      for (let k = 0; k < 9; k++) { const y = (0.2 + k * 0.07) * H; line(g, [[x, y], [x + W * 0.035, y - H * 0.06]], H * 0.008, '#efe4c4'); line(g, [[x, y], [x - W * 0.03, y - H * 0.05]], H * 0.008, '#efe4c4'); }
    }
  },
  featherGlow(g, W, H) { fill(g, W, H, '#8a8266'); },
  skipper(g, W, H) {
    grad(g, W, H, '#6fc4ff', '#1560c8');
    for (const [v, a] of [[0.4, 0.035], [0.5, 0.045], [0.6, 0.035]]) {   // the ripple band
      const pts = []; for (let i = 0; i <= 48; i++) pts.push([i * W / 48, (v + Math.sin((i / 48) * TAU * 6) * a) * H]);
      line(g, pts, H * 0.028, '#eafaff');
    }
    for (let i = 0; i < 10; i++) dot(g, (i + 0.3) * W / 10, 0.2 * H, H * 0.02, '#c8ecff');
  },
  skipperGlow(g, W, H) { for (const v of [0.4, 0.5, 0.6]) band(g, W, H, v - 0.012, v + 0.012, '#9fdcff'); },
  yoyo(g, W, H) {
    band(g, W, H, 0, 0.5, '#9b5cff'); band(g, W, H, 0.5, 1, '#ffffff');
    band(g, W, H, 0.47, 0.53, '#2a1a4a');                    // the groove
    g.fillStyle = '#ffd21f';                                  // slanted stripes: its spin shows
    for (let i = 0; i < 6; i++) { const x = i * W / 6; g.beginPath(); g.moveTo(x, 0.08 * H); g.lineTo(x + W * 0.05, 0.08 * H); g.lineTo(x + W * 0.13, 0.92 * H); g.lineTo(x + W * 0.08, 0.92 * H); g.fill(); }
  },
  homing(g, W, H) {
    fill(g, W, H, '#0f1f18');
    for (const u of [0.25, 0.75]) {                          // a reticle, front and back
      const cx = u * W, cy = 0.5 * H;
      rings(g, cx, cy, [H * 0.12, H * 0.24, H * 0.36], H * 0.03, '#39ff88');
      line(g, [[cx - H * 0.44, cy], [cx + H * 0.44, cy]], H * 0.022, '#39ff88');
      line(g, [[cx, cy - H * 0.44], [cx, cy + H * 0.44]], H * 0.022, '#39ff88');
      dot(g, cx, cy, H * 0.05, '#ff2b2b');
    }
  },
  homingGlow(g, W, H) { PAINT.homing(g, W, H); },
  sticky(g, W, H, rnd) {
    grad(g, W, H, '#ffbf2a', '#c87400');
    g.fillStyle = '#ffe08a';                                  // honey running down from the top
    g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(W, 0.22 * H);
    for (let i = 12; i >= 0; i--) { const x = i * W / 12, d = (0.18 + rnd() * 0.42) * H; g.quadraticCurveTo(x + W / 24, d, x, 0.22 * H); }
    g.fill();
    for (let i = 0; i < 14; i++) dot(g, rnd() * W, (0.5 + rnd() * 0.4) * H, H * (0.015 + rnd() * 0.02), '#ffd766');
  },
  stickyGlow(g, W, H) { band(g, W, H, 0, 0.3, '#5a3a00'); },
  magnet(g, W, H) {
    band(g, W, H, 0, 0.44, '#e53935'); band(g, W, H, 0.56, 1, '#2f6fd8'); band(g, W, H, 0.44, 0.56, '#e2e6ee');
    g.fillStyle = '#ffffff'; g.font = `bold ${Math.round(H * 0.26)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < 4; i++) { g.fillText('N', (i + 0.5) * W / 4, 0.25 * H); g.fillText('S', (i + 0.5) * W / 4, 0.77 * H); }
  },
  windcutter(g, W, H) {
    grad(g, W, H, '#f2f6fa', '#b4c0cc');
    for (let i = 0; i < 9; i++) {                            // swept grooves
      const x = i * W / 9, pts = [];
      for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push([x + t * t * W * 0.16, (0.12 + t * 0.76) * H]); }
      line(g, pts, H * 0.035, '#7fe3ff');
      line(g, pts.map(([px, py]) => [px + W * 0.012, py]), H * 0.012, '#ffffff');
    }
  },
  windcutterGlow(g, W, H) { for (let i = 0; i < 9; i++) { const x = i * W / 9, pts = []; for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push([x + t * t * W * 0.16, (0.12 + t * 0.76) * H]); } line(g, pts, H * 0.02, '#3fa8c8'); } },
  laser(g, W, H) {
    fill(g, W, H, '#16021c');
    for (const v of [0.2, 0.5, 0.8]) band(g, W, H, v - 0.03, v + 0.03, '#ff2bd6');
    for (let i = 0; i < 8; i++) line(g, [[(i + 0.5) * W / 8, 0], [(i + 0.5) * W / 8, H]], H * 0.02, '#ff2bd6');
    band(g, W, H, 0.485, 0.515, '#ffd0f6');
  },
  laserGlow(g, W, H) { PAINT.laser(g, W, H); },
  moonball(g, W, H, rnd) {
    fill(g, W, H, '#bcc2d0');
    for (let i = 0; i < 5; i++) { g.fillStyle = '#a2a8b8'; g.beginPath(); g.ellipse(rnd() * W, (0.2 + rnd() * 0.6) * H, W * (0.05 + rnd() * 0.06), H * (0.1 + rnd() * 0.1), rnd() * 3, 0, TAU); g.fill(); }   // maria
    for (let i = 0; i < 26; i++) { const x = rnd() * W, y = (0.08 + rnd() * 0.84) * H, r = H * (0.02 + rnd() * 0.06); dot(g, x, y, r, '#868c9c'); dot(g, x - r * 0.18, y - r * 0.18, r * 0.78, '#9aa0b0'); rings(g, x, y, [r], H * 0.008, '#dfe4ee'); }
  },
  bouncy(g, W, H) {
    fill(g, W, H, '#ff8a3d');
    for (let i = 0; i < 80; i++) dot(g, (i * 61.8) % W, ((i * 37.7) % (H * 0.9)) + H * 0.05, H * 0.006, '#e8702a');
    const ink = '#22140c', w = H * 0.03;
    line(g, [[0, 0.5 * H], [W, 0.5 * H]], w, ink);
    for (const u of [0, 0.5, 1]) line(g, [[u * W, 0], [u * W, H]], w, ink);
    for (const u of [0.25, 0.75]) { g.strokeStyle = ink; g.lineWidth = w; g.beginPath(); g.ellipse(u * W, 0.5 * H, W * 0.09, H * 0.42, 0, 0, TAU); g.stroke(); }
  },
};

// ---- the fifteen balls. body: the material's numbers. glow: how its glow map is lit
// (flicker: fire; pulseHz: a slow breath). aura: the sprite round the ball at rest, in px
// at the tee camera. idle / flight: what comes off it at rest and in the air (an emitter:
// rate a second, life s, px, colours, where it starts (`from`), speeds in ball radii a
// second). burst: how many motes a bounce throws. motion: spinU / scrollV (the map
// turning), hover (floating a little off the ground, in radii), squash (on a bounce).
const SKIN_DEFS = {
  rocket: {
    body: { roughness: 0.32, metalness: 0.75 }, glow: { intensity: 1.6, flicker: 0.25 },
    aura: { px: 26, alpha: 0.5 },
    idle: { rate: 26, life: 0.34, px: 5, colors: ['#fff2b0', '#ff8a1f', '#ff3d00'], from: 'back', back: 3.2, up: 2.4, spread: 0.5 },
    flight: { rate: 40, life: 0.4, px: 5, colors: ['#fff2b0', '#ff8a1f'], from: 'surface', gravity: 2 },
    burst: 14,
  },
  fireball: {
    body: { roughness: 0.9, metalness: 0 }, glow: { intensity: 2.4, flicker: 0.45 },
    aura: { px: 34, alpha: 0.75, flicker: 0.3 },
    idle: { rate: 16, life: 0.8, px: 4.5, colors: ['#ffe27a', '#ff7a1a', '#ff3d00'], from: 'surface', up: 3.2, spread: 0.6 },
    flight: { rate: 60, life: 0.6, px: 5, colors: ['#ffe27a', '#ff7a1a', '#ff3d00'], from: 'surface', gravity: 1.5 },
    burst: 22, scorch: true,
  },
  ghost: {
    body: { roughness: 0.6, metalness: 0, opacity: 0.42 }, glow: { intensity: 0.7, pulseHz: 0.7, pulse: 0.5 },
    aura: { px: 32, alpha: 0.4, pulseHz: 0.7, pulse: 0.5 },
    idle: { rate: 5, life: 1.6, px: 9, colors: ['#e8fbff', '#b8f4ff'], from: 'surface', up: 1.1, alpha: 0.35, spread: 0.4 },
    flight: { rate: 22, life: 1.1, px: 9, colors: ['#e8fbff', '#b8f4ff'], from: 'surface', alpha: 0.3 },
    burst: 8, motion: { hover: 0.5 },
  },
  gold: {
    body: { roughness: 0.16, metalness: 1 }, glow: { intensity: 0.9, pulseHz: 1.3, pulse: 0.5 },
    aura: { px: 28, alpha: 0.55 },
    idle: { rate: 8, life: 0.5, px: 5, colors: ['#ffffff', '#fff3b0', '#ffd700'], from: 'shell', r: 1.9, twinkle: true },
    flight: { rate: 36, life: 0.9, px: 4.5, colors: ['#ffffff', '#fff3b0', '#ffd700'], from: 'surface', gravity: 3, twinkle: true },
    burst: 26,
  },
  titan: {
    body: { roughness: 0.42, metalness: 0.9 }, glow: null,
    aura: { px: 26, alpha: 0.6 },
    idle: { rate: 4, life: 1.1, px: 5, colors: ['#c4ccd8', '#9aa7b8'], from: 'base', out: 1.6, alpha: 0.6 },
    flight: { rate: 10, life: 0.5, px: 4, colors: ['#9aa7b8', '#dfe6ee'], from: 'surface' },
    burst: 18, motion: { heavy: true },
  },
  feather: {
    body: { roughness: 1, metalness: 0 }, glow: { intensity: 0.5 },
    aura: { px: 36, alpha: 0.4, pulseHz: 0.4, pulse: 0.25 },
    idle: { rate: 2.6, life: 3, px: 8, colors: ['#ffffff', '#fff6d5'], from: 'shell', r: 2.6, orbit: 0.6, up: 0.25, alpha: 0.8 },
    flight: { rate: 9, life: 2.2, px: 7, colors: ['#ffffff', '#fff6d5'], from: 'surface', gravity: 0.4, alpha: 0.8 },
    burst: 10,
  },
  skipper: {
    body: { roughness: 0.06, metalness: 0.1 }, glow: { intensity: 0.5 },
    aura: { px: 26, alpha: 0.45 },
    idle: { rate: 7, life: 0.5, px: 3.5, colors: ['#eafaff', '#6fc4ff'], from: 'base', up: 2.6, out: 1.2, gravity: 9 },
    flight: { rate: 16, life: 0.5, px: 3.5, colors: ['#eafaff', '#6fc4ff'], from: 'surface', gravity: 6 },
    burst: 18, motion: { scrollV: 0, spinU: 0.12 },
  },
  yoyo: {
    body: { roughness: 0.45, metalness: 0 }, glow: null,
    aura: { px: 26, alpha: 0.45 },
    idle: null,
    flight: { rate: 12, life: 0.5, px: 4, colors: ['#9b5cff', '#ffd21f'], from: 'surface' },
    burst: 12, motion: { spinU: 1.4 },
  },
  homing: {
    body: { roughness: 0.5, metalness: 0.3 }, glow: { intensity: 1.8, pulseHz: 1.6, pulse: 0.6, blink: true },
    aura: { px: 26, alpha: 0.6, pulseHz: 1.6, pulse: 0.8, blink: true },
    idle: null,
    flight: { rate: 14, life: 0.35, px: 3.5, colors: ['#39ff88', '#dfffe8'], from: 'surface' },
    burst: 12,
  },
  sticky: {
    body: { roughness: 0.12, metalness: 0 }, glow: { intensity: 0.5 },
    aura: { px: 26, alpha: 0.45 },
    idle: { rate: 3, life: 0.9, px: 4.5, colors: ['#ffd766', '#ffb300'], from: 'under', up: -0.6, gravity: 5 },
    flight: { rate: 12, life: 0.7, px: 4.5, colors: ['#ffd766', '#ffb300'], from: 'surface', gravity: 8 },
    burst: 14,
  },
  magnet: {
    body: { roughness: 0.35, metalness: 0.4 }, glow: null,
    aura: { px: 26, alpha: 0.45 },
    idle: { rate: 14, life: 0.22, px: 3.5, colors: ['#ffffff', '#9fd0ff', '#ff8a8a'], from: 'arc', r: 1.7, twinkle: true },
    flight: { rate: 16, life: 0.3, px: 3.5, colors: ['#ff8a8a', '#9fd0ff'], from: 'surface' },
    burst: 12,
  },
  windcutter: {
    body: { roughness: 0.22, metalness: 0.85 }, glow: { intensity: 0.6 },
    aura: { px: 26, alpha: 0.45 },
    idle: { rate: 9, life: 0.4, px: 3, colors: ['#ffffff', '#7fe3ff'], from: 'side', side: 5, alpha: 0.8 },
    flight: { rate: 20, life: 0.3, px: 3, colors: ['#ffffff', '#7fe3ff'], from: 'surface' },
    burst: 10, motion: { spinU: 0.5 },
  },
  laser: {
    body: { roughness: 0.3, metalness: 0.2 }, glow: { intensity: 3.2, pulseHz: 3, pulse: 0.15 },
    aura: { px: 20, alpha: 0.9 },
    idle: { rate: 5, life: 0.25, px: 3, colors: ['#ffd0f6', '#ff2bd6'], from: 'shell', r: 1.4, twinkle: true },
    flight: { rate: 24, life: 0.2, px: 3, colors: ['#ffd0f6', '#ff2bd6'], from: 'surface' },
    burst: 14,
  },
  moonball: {
    body: { roughness: 1, metalness: 0 }, glow: null,
    aura: { px: 30, alpha: 0.35, pulseHz: 0.3, pulse: 0.3 },
    idle: { rate: 2.5, life: 2.4, px: 3, colors: ['#ffffff', '#c9d4ff'], from: 'shell', r: 2.4, orbit: 0.9, twinkle: true },
    flight: { rate: 8, life: 1.2, px: 3, colors: ['#ffffff', '#c9d4ff'], from: 'surface', twinkle: true },
    burst: 10, motion: { hover: 0.9, bobHz: 0.45, bob: 0.5 },
  },
  bouncy: {
    body: { roughness: 0.55, metalness: 0 }, glow: null,
    aura: { px: 24, alpha: 0.4 },
    idle: null,
    flight: { rate: 6, life: 0.4, px: 4, colors: ['#ff8a3d', '#ffd0a8'], from: 'surface' },
    burst: 16, motion: { squash: true, hopHz: 1.1, hop: 0.7 },
  },
};
const CURSE_DEFS = {
  // a little swirl of wind streaks round the ball
  gust: { rate: 16, life: 0.7, px: 3.5, colors: ['#ffffff', '#9fe0ff'], from: 'shell', r: 2.3, orbit: 5.5, alpha: 0.85 },
};

export const BALL_SKIN_IDS = Object.freeze(Object.keys(SKIN_DEFS));

/** A ball id that has a skin, or null (null, an unknown id, and every trick). */
export function ballSkinId(id) {
  const k = typeof id === 'string' ? id : (id && typeof id === 'object' && typeof id.id === 'string' ? id.id : null);
  return k && Object.prototype.hasOwnProperty.call(SKIN_DEFS, k) ? k : null;
}
/** A curse that marks the ball of the player it is on, or null. */
export const ballCurseMark = (id) => (typeof id === 'string' && BALL_CURSE_MARKS.includes(id) ? id : null);

const PLAIN = Object.freeze({ id: null, plain: true, color: 0xffffff, cssColor: '#ffffff', body: Object.freeze({ roughness: 0.35, metalness: 0, opacity: 1 }), glow: null, aura: null, idle: null, flight: null, burst: 0, scorch: false, motion: Object.freeze({}), paint: null, paintGlow: null });
const SKINS = {};
for (const [id, d] of Object.entries(SKIN_DEFS)) {
  SKINS[id] = Object.freeze({
    id, plain: false, color: C[id], cssColor: hex(C[id]),
    body: Object.freeze({ roughness: 0.4, metalness: 0, opacity: 1, ...d.body }),
    glow: d.glow ? Object.freeze({ intensity: 1, flicker: 0, pulse: 0, pulseHz: 0, blink: false, ...d.glow }) : null,
    aura: Object.freeze({ px: 26, alpha: 0.45, flicker: 0, pulse: 0, pulseHz: 0, blink: false, ...d.aura }),
    idle: d.idle ? Object.freeze(d.idle) : null,
    flight: d.flight ? Object.freeze(d.flight) : null,
    burst: d.burst || 0, scorch: !!d.scorch,
    motion: Object.freeze({ spinU: 0, hover: 0, bob: 0, bobHz: 0, squash: false, hop: 0, hopHz: 0, heavy: false, ...(d.motion || {}) }),
    paint: PAINT[id], paintGlow: PAINT[`${id}Glow`] || null,
  });
}

/** The complete skin for a ball id; the plain ball for null, an unknown id or a trick. */
export const ballSkin = (id) => SKINS[ballSkinId(id)] || PLAIN;
/** A skin's colour as a number (the trail's tint), or null for the plain ball. */
export const ballSkinColor = (id) => (ballSkinId(id) ? C[ballSkinId(id)] : null);

/**
 * Which ball lies at rest right now, and whether it is cursed: { skin: id | null, curse: id | null }.
 *   match        the match state, or null. While someone is up (phase play / tiebreak / intro)
 *                it is THEIR ball: the stage's free ball on their first stroke of a rocket
 *                hole, else the ball they armed; a trick cast on them marks it (gust).
 *   arcade       the bay's arcade snapshot (solo play): its `armed` ball
 *   strokes      strokes taken on this hole in solo play; practice: true on the range
 *   courseArcade course.arcade (its freeBall is played on the hole's first stroke)
 * A trick never skins a ball; an id with no skin is the plain ball.
 */
export function restBallLook({ match = null, arcade = null, strokes = null, practice = false, holed = false, courseArcade = null } = {}) {
  if (match && Array.isArray(match.players) && !match.aborted && match.phase !== 'done') {
    const up = ['play', 'tiebreak', 'intro'].includes(match.phase) ? match.players.find((p) => p && p.id === match.currentPlayerId) : null;
    if (!up) return { skin: null, curse: null };
    const free = match.stage && match.stage.freeBall && Number(up.strokes) === 0 ? ballSkinId(String(match.stage.freeBall)) : null;
    return { skin: free || ballSkinId(up.armedPowerup), curse: ballCurseMark(up.cursedWith) };
  }
  const free = courseArcade && courseArcade.freeBall && !practice && !holed && Number(strokes) === 0 ? ballSkinId(String(courseArcade.freeBall)) : null;
  return { skin: free || ballSkinId(arcade && arcade.enabled !== false ? arcade.armed : null), curse: null };
}

/** The ball a shot was actually hit with (the server's word): shot.arcade.powerup, or a stage's free ball. */
export const shotBallSkin = (shot) => ballSkinId(shot && ((shot.arcade && shot.arcade.powerup) || shot.freeBall));

// ---------------------------------------------------------------- drawing it
const MOTES = 72;
const MOTE_VERT = /* glsl */`
  attribute vec3 aColor; attribute vec2 aLook;   // size (px), alpha
  uniform float uScale;
  varying vec3 vColor; varying float vAlpha;
  void main() {
    vColor = aColor; vAlpha = aLook.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
    gl_PointSize = aLook.x * uScale;
  }`;
const MOTE_FRAG = /* glsl */`
  varying vec3 vColor; varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = (smoothstep(1.0, 0.25, r) * 0.6 + smoothstep(0.45, 0.0, r)) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * a * 1.9, a);
  }`;
// an expanding ring, sized in pixels like the glows (the pop when the ball changes)
const RING_VERT = /* glsl */`
  uniform float uPxWorld; uniform float uPx;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv.xy += position.xy * (-mv.z * uPxWorld * uPx);
    gl_Position = projectionMatrix * mv;
  }`;
const RING_FRAG = /* glsl */`
  uniform vec3 uColor; uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float a = smoothstep(0.62, 0.84, r) * (1.0 - smoothstep(0.86, 1.0, r)) * uAlpha;
    if (a < 0.005) discard;
    gl_FragColor = vec4(uColor * a * 2.2, a);
  }`;
const OVER = { transparent: true, depthWrite: false, fog: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor };

function mulberry(seed) {
  let a = seed | 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class BallSkins {
  // ball: the scene's ball mesh; scene: the THREE.Scene the aura and motes are added to
  constructor({ ball, scene, doc = globalThis.document } = {}) {
    this.ball = ball;
    this.scene = scene;
    this.doc = doc;
    this.rest = { id: null, curse: null };   // what lies at rest: the armed ball, a curse's mark
    this.shot = null;                        // { id, since } while a shot is being played
    this.activeId = null;                    // the skin on the ball right now
    this._plain = null;                      // the ball's own material numbers, kept to put back
    this._tex = new Map();                   // id -> { map, glow }
    this._gfx = null;                        // aura, ring, motes, scorch: built with the first skin
    this._pop = -1;                          // seconds since the last pop (-1: none)
    this._squash = 0;
    this._last = null;                       // the ball's last position (bounce detection)
    this._vy = 0;
    this._emit = 0; this._emitCurse = 0;
    this._rnd = mulberry(20261122);
    this._t = 0;
  }

  /** The ball at rest takes this skin (null: plain). curse: a trick on the player who is up. Returns the skin id in use. */
  set(id, { curse = null, pop = true } = {}) {
    const next = ballSkinId(id), mark = ballCurseMark(curse);
    const changed = next !== this.rest.id;
    this.rest = { id: next, curse: mark };
    if (!this.shot && changed) { this._apply(next); if (pop) this._pop = 0; }
    return next;
  }

  /** A shot is about to be played with this ball (null: plain): it keeps the look until the shot is over. */
  beginShot(id) {
    this.shot = { id: ballSkinId(id), since: this._t, flew: false };
    this._apply(this.shot.id);
    this._last = null;
  }

  // ---- the material
  _textures(skin) {
    let t = this._tex.get(skin.id);
    if (t || !this.doc) return t || null;
    const make = (paint) => {
      const cv = this.doc.createElement('canvas');
      cv.width = 512; cv.height = 256;
      const g = cv.getContext('2d');
      g.fillStyle = '#000000'; g.fillRect(0, 0, 512, 256);
      paint(g, 512, 256, mulberry(skin.color));
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.anisotropy = 4;
      return tex;
    };
    t = { map: make(skin.paint), glow: skin.paintGlow ? make(skin.paintGlow) : null };
    this._tex.set(skin.id, t);
    return t;
  }

  _apply(id) {
    const skin = ballSkin(id), m = this.ball?.material;
    this.activeId = skin.id;
    if (!m) return;
    if (!this._plain) {
      if (skin.plain) return;   // never skinned: the ball is left exactly as the scene made it
      this._plain = { map: m.map, color: m.color.clone(), roughness: m.roughness, metalness: m.metalness, emissive: m.emissive.clone(), emissiveMap: m.emissiveMap, emissiveIntensity: m.emissiveIntensity, transparent: m.transparent, opacity: m.opacity };
    }
    const p = this._plain;
    if (skin.plain) {
      m.map = p.map; m.color.copy(p.color); m.roughness = p.roughness; m.metalness = p.metalness;
      m.emissive.copy(p.emissive); m.emissiveMap = p.emissiveMap; m.emissiveIntensity = p.emissiveIntensity;
      m.transparent = p.transparent; m.opacity = p.opacity;
    } else {
      const t = this._textures(skin);
      m.map = t ? t.map : p.map;
      m.color.set(t ? 0xffffff : skin.color);
      m.roughness = skin.body.roughness; m.metalness = skin.body.metalness;
      m.emissiveMap = skin.glow && t ? t.glow : null;
      m.emissive.set(skin.glow ? (t && t.glow ? 0xffffff : skin.color) : 0x000000);
      m.emissiveIntensity = skin.glow ? skin.glow.intensity : 0;
      m.transparent = skin.body.opacity < 1; m.opacity = skin.body.opacity;
    }
    m.needsUpdate = true;
  }

  // ---- the aura, the pop's ring, the motes, the scorch
  _build() {
    const aura = makeGlow({ color: 0xffffff, px: 26 });
    aura.renderOrder = 9;
    const ringU = { uPxWorld: { value: 0.0015 }, uPx: { value: 20 }, uColor: { value: new THREE.Color(1, 1, 1) }, uAlpha: { value: 0 } };
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ uniforms: ringU, vertexShader: RING_VERT, fragmentShader: RING_FRAG, ...OVER, depthTest: false }));   // whole, not cut off by the turf it stands in
    ring.frustumCulled = false; ring.renderOrder = 9;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MOTES * 3), col = new Float32Array(MOTES * 3), look = new Float32Array(MOTES * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aLook', new THREE.BufferAttribute(look, 2));
    const moteU = { uScale: { value: 1 } };
    const points = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: moteU, vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, ...OVER }));
    points.frustumCulled = false; points.renderOrder = 9;
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x140804, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    scorch.visible = false; scorch.renderOrder = 1;
    aura.visible = ring.visible = false;
    this.scene.add(aura, ring, points, scorch);
    const motes = Array.from({ length: MOTES }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, px: 3, a: 1, c: new THREE.Color(), tw: false, orbit: 0, ang: 0, rad: 0, h: 0, stick: false }));
    this._gfx = { aura, ring, ringU, points, geo, pos, col, look, moteU, motes, scorch, scorchAge: -1, next: 0 };
  }

  _spawn(spec, o, R, frame) {
    const G = this._gfx, r = this._rnd;
    const m = G.motes[G.next]; G.next = (G.next + 1) % MOTES;
    const a = r() * TAU, u = r() * 2 - 1, s = Math.sqrt(1 - u * u);
    let dx = Math.cos(a) * s, dy = u, dz = Math.sin(a) * s;      // a direction off the ball
    let rad = 1.0, sgn = 0;
    m.orbit = 0; m.stick = false; m.g = (spec.gravity || 0) * R;
    switch (spec.from) {
      case 'back': dx = frame.bx + (r() - 0.5) * (spec.spread || 0.4); dz = frame.bz + (r() - 0.5) * (spec.spread || 0.4); dy = 0.2 + r() * 0.3; rad = 0.9; break;
      case 'base': dy = -0.75; dx *= 0.9; dz *= 0.9; rad = 1.05; break;
      case 'under': dy = -0.5 - r() * 0.4; rad = 1.0; break;
      case 'side': sgn = r() < 0.5 ? -1 : 1; dx = frame.sx * sgn * 2.2; dz = frame.sz * sgn * 2.2; dy = (r() - 0.5) * 1.2; rad = 1; break;   // a streak crossing the ball
      case 'arc': { const t = (r() - 0.5) * Math.PI; dx = Math.cos(t) * frame.sx; dz = Math.cos(t) * frame.sz; dy = Math.sin(t); rad = spec.r || 1.6; break; }
      case 'shell': rad = (spec.r || 2) * (0.75 + 0.35 * r()); break;
      default: rad = 1.0;
    }
    m.x = o.x + dx * rad * R; m.y = o.y + dy * rad * R; m.z = o.z + dz * rad * R;
    const out = (spec.out || 0) * R, up = (spec.up || 0) * R, back = (spec.back || 0) * R, side = (spec.side || 0) * R;
    m.vx = dx * out + frame.bx * back - frame.sx * side * sgn;
    m.vy = up + (spec.from === 'base' ? out * 0.4 : 0);
    m.vz = dz * out + frame.bz * back - frame.sz * side * sgn;
    if (spec.orbit) { m.orbit = spec.orbit; m.ang = a; m.rad = rad; m.h = dy * 0.8; m.stick = true; }
    m.max = spec.life * (0.7 + 0.6 * r()); m.life = m.max;
    m.px = spec.px * (0.75 + 0.5 * r()); m.a = spec.alpha ?? 1; m.tw = !!spec.twinkle;
    m.c.set(spec.colors[Math.floor(r() * spec.colors.length)]);
    return m;
  }

  // A bounce or a landing: a handful of motes thrown up in the ball's colour.
  _burst(skin, o, R) {
    const spec = { life: 0.6, px: 5, colors: skin.flight?.colors || [skin.cssColor], from: 'surface', gravity: 9 };
    for (let i = 0; i < skin.burst; i++) {
      const m = this._spawn(spec, o, R, { bx: 0, bz: 0, sx: 1, sz: 0 });
      const a = this._rnd() * TAU, sp = (2.5 + this._rnd() * 4) * R;
      m.vx = Math.cos(a) * sp; m.vz = Math.sin(a) * sp; m.vy = (3 + this._rnd() * 5) * R;
      m.tw = !!skin.flight?.twinkle;
    }
  }

  /**
   * Each frame, after the scene has sized and seated the ball. host: the GolfScene
   * (anim, camera, renderer, aimDeg). Costs one `if` while the ball is plain and nothing is alive.
   */
  update(t, dt, host) {
    this._t = t;
    const flying = !!host.anim;
    if (this.shot) {
      if (flying) this.shot.flew = true;
      // the shot is over (or never started): the ball at rest is the armed one again
      else if (this.shot.flew || t - this.shot.since > 1.5) {
        this.shot = null;
        if (this.activeId !== this.rest.id) { this._apply(this.rest.id); if (this.rest.id) this._pop = 0; }
      }
    }
    const skin = ballSkin(this.activeId);
    const curse = !flying && !this.shot ? CURSE_DEFS[this.rest.curse] || null : null;
    const G0 = this._gfx;
    if (skin.plain && !curse && this._pop < 0 && (!G0 || (G0.alive === 0 && G0.scorchAge < 0))) {
      if (G0) { G0.aura.visible = false; G0.ring.visible = false; G0.points.visible = false; }
      this._last = null;
      return;
    }
    if (!this._gfx) this._build();
    const G = this._gfx, ball = this.ball, cam = host.camera;
    dt = Math.min(0.05, Math.max(0, dt || 0));
    const seen = ball.visible !== false;
    const viewH = host.renderer?.domElement?.clientHeight || 720;
    const pxWorld = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / Math.max(1, viewH);
    const dist = Math.max(0.1, cam.position.distanceTo(ball.position));
    const baseR = ball.geometry?.parameters?.radius || 0.02135;
    let R = baseR * ball.scale.x;
    const ballPx = (2 * R) / (dist * pxWorld);                 // the ball's size on screen
    const grow = Math.min(4.5, Math.max(1, ballPx / 9));       // close on the green everything grows with it

    // ---- the ball's own motion: the pop's punch, a float, a hop, the squash of a bounce
    const mo = skin.motion;
    let sx = 1, sy = 1, lift = 0;
    if (this._pop >= 0) {
      this._pop += dt;
      const k = this._pop / 0.45;
      if (k >= 1) this._pop = -1;
      else { const punch = 1 + (mo.heavy ? 0.9 : 0.6) * Math.exp(-k * 5) * Math.cos(k * 9); sx *= punch; sy *= punch; }
    }
    if (!flying) {
      if (mo.hover) lift += mo.hover * R * (1 + (mo.bob || 0) * Math.sin(t * TAU * (mo.bobHz || 0.5)));
      if (mo.hop) { const h = Math.abs(Math.sin(t * TAU * mo.hopHz * 0.5)); lift += mo.hop * R * h; const q = 1 - h; sy *= 1 - 0.16 * q * q; sx *= 1 + 0.1 * q * q; }
    }
    // a bounce: the ball was falling and now is not
    const p = ball.position;
    if (this._last && dt > 0) {
      const vy = (p.y - this._last.y) / dt;
      if (flying && this._vy < -1.2 && vy > -0.2 && seen) {
        if (skin.burst) this._burst(skin, p, R);
        if (mo.squash) this._squash = 1;
        if (skin.scorch && G.scorchAge < 0) { G.scorch.position.set(p.x, p.y - R * 0.6 + 0.03, p.z); G.scorch.scale.setScalar(Math.max(0.45, R * 3)); G.scorch.visible = true; G.scorchAge = 0; }
      }
      this._vy = vy;
      if (flying && mo.squash && Math.abs(vy) > 4) { const st = Math.min(0.25, Math.abs(vy) / 120); sy *= 1 + st; sx *= 1 - st * 0.5; }   // stretched in flight
    }
    this._last = this._last ? this._last.copy(p) : p.clone();
    if (this._squash > 0) { const q = this._squash; sy *= 1 - 0.45 * q; sx *= 1 + 0.3 * q; this._squash = Math.max(0, q - dt / 0.22); }
    if (sx !== 1 || sy !== 1) ball.scale.set(ball.scale.x * sx, ball.scale.y * sy, ball.scale.z * sx);
    if (lift) ball.position.y += lift;
    R = baseR * ball.scale.x;

    // ---- the material's life: fire flickers, a ghost breathes, a light blinks, a stripe spins
    const m = ball.material;
    if (!skin.plain && m) {
      const gl = skin.glow;
      if (gl) {
        let k = 1;
        if (gl.flicker) k *= 1 - gl.flicker + gl.flicker * (0.5 + 0.5 * Math.sin(t * 23) * Math.sin(t * 13.7 + 1.3)) * 2;
        if (gl.pulse) k *= gl.blink ? (Math.sin(t * TAU * gl.pulseHz) > 0.2 ? 1 : 1 - gl.pulse) : 1 - gl.pulse * (0.5 + 0.5 * Math.sin(t * TAU * gl.pulseHz));
        m.emissiveIntensity = gl.intensity * k;
      }
      if (skin.body.opacity < 1) m.opacity = skin.body.opacity * (0.8 + 0.3 * Math.sin(t * TAU * 0.7));
      if (mo.spinU && m.map) { m.map.offset.x = (t * mo.spinU) % 1; if (m.emissiveMap) m.emissiveMap.offset.x = m.map.offset.x; }
    }

    // ---- the aura: at rest and rolling; in the air the trail's own glow marks the ball
    const inAir = flying && host.headGlow?.visible;
    const au = skin.aura;
    G.aura.visible = !!au && seen && !inAir;
    if (G.aura.visible) {
      const u = G.aura.userData.uniforms;
      let a = au.alpha;
      if (au.flicker) a *= 1 - au.flicker + au.flicker * (0.5 + 0.5 * Math.sin(t * 19) * Math.sin(t * 11.3)) * 2;
      if (au.pulse) a *= au.blink ? (Math.sin(t * TAU * au.pulseHz) > 0.2 ? 1 : 1 - au.pulse) : 1 - au.pulse * (0.5 + 0.5 * Math.sin(t * TAU * au.pulseHz));
      u.uColor.value.set(skin.color);
      u.uPx.value = au.px * grow;
      u.uAlpha.value = a;
      u.uPxWorld.value = pxWorld;
      G.aura.position.copy(ball.position);
    }

    // ---- the pop's ring
    G.ring.visible = this._pop >= 0 && seen;
    if (G.ring.visible) {
      const k = this._pop / 0.45;
      G.ringU.uColor.value.set(skin.plain ? 0xffffff : skin.color);
      G.ringU.uPx.value = (14 + 78 * (1 - Math.pow(1 - k, 2))) * grow;
      G.ringU.uAlpha.value = (1 - k) * 0.9;
      G.ringU.uPxWorld.value = pxWorld;
      G.ring.position.copy(ball.position);
    }

    // ---- what comes off the ball
    const aim = THREE.MathUtils.degToRad(host.aimDeg || 0);
    // sim (east, north) -> three (x, -z): `back` points away from where the ball is aimed
    const frame = { bx: -Math.sin(aim), bz: Math.cos(aim), sx: Math.cos(aim), sz: Math.sin(aim) };
    const spec = seen ? (flying ? (inAir ? skin.flight : null) : skin.idle) : null;
    if (spec) {
      this._emit += spec.rate * dt;
      while (this._emit >= 1) { this._emit -= 1; this._spawn(spec, ball.position, R, frame); }
    } else this._emit = 0;
    if (curse && seen) {
      this._emitCurse += curse.rate * dt;
      while (this._emitCurse >= 1) { this._emitCurse -= 1; this._spawn(curse, ball.position, R, frame); }
    }
    let alive = 0;
    for (let i = 0; i < MOTES; i++) {
      const q = G.motes[i];
      if (q.life > 0) {
        q.life -= dt;
        if (q.stick) { q.ang += q.orbit * dt; q.x = ball.position.x + Math.cos(q.ang) * q.rad * R; q.z = ball.position.z + Math.sin(q.ang) * q.rad * R; q.y = ball.position.y + q.h * R + q.vy * (q.max - q.life); }
        else { q.vy -= q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; }
      }
      const k = q.life > 0 ? q.life / q.max : 0;
      G.pos[i * 3] = q.x; G.pos[i * 3 + 1] = q.y; G.pos[i * 3 + 2] = q.z;
      G.col[i * 3] = q.c.r; G.col[i * 3 + 1] = q.c.g; G.col[i * 3 + 2] = q.c.b;
      G.look[i * 2] = q.px * (0.5 + 0.5 * k);
      G.look[i * 2 + 1] = k > 0 ? q.a * Math.min(1, k * 2.5) * (q.tw ? 0.35 + 0.65 * Math.abs(Math.sin(t * 17 + i * 2.1)) : 1) : 0;
      if (k > 0) alive++;
    }
    G.alive = alive;
    G.points.visible = alive > 0;
    if (alive > 0) {
      G.geo.attributes.position.needsUpdate = G.geo.attributes.aColor.needsUpdate = G.geo.attributes.aLook.needsUpdate = true;
      G.moteU.uScale.value = (host.renderer?.getPixelRatio?.() || 1) * grow;
    }

    // ---- where a fireball landed: a scorch that fades
    if (G.scorchAge >= 0) {
      G.scorchAge += dt;
      G.scorch.material.opacity = 0.6 * Math.max(0, 1 - G.scorchAge / 9);
      if (G.scorchAge > 9) { G.scorchAge = -1; G.scorch.visible = false; }
    }
  }

  dispose() {
    this._apply(null);
    for (const t of this._tex.values()) { t.map.dispose(); t.glow?.dispose(); }
    this._tex.clear();
    const G = this._gfx;
    if (G) {
      this.scene.remove(G.aura, G.ring, G.points, G.scorch);
      for (const o of [G.aura, G.ring, G.points, G.scorch]) { o.geometry.dispose(); o.material.dispose(); }
      this._gfx = null;
    }
  }
}
