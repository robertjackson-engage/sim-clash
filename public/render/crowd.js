// v3:stadium The crowd: thousands of individual spectators in the seats of the stadium kit.
//
// Where they sit comes from stadium-kit.js (standSeats: every seat of a stand, on the
// course). This file decides who is in each seat and what they wear (planCrowd, pure),
// builds the low-poly figures (buildFigure), draws them instanced with all their motion
// in the vertex shader (CrowdLayer), and runs the reactions (CrowdMood, pure):
//
//   crowd.react('cheer' | 'groan' | 'wave' | 'tense' | 'calm' | 'flash', { at, intensity })
//
// How it stays cheap with 30,000 people on a stage:
//   - one CHUNK per tier of a stand; per chunk the people are instanced in three levels of
//     detail: `near` (a figure of about 140 triangles, one mesh per variant: cap and scarf,
//     long hair, beanie and coat, a flag, a phone), `mid` (one figure of 28 triangles) and
//     `far` (a card of 8). update() picks the levels per CHUNK from its distance (never per
//     person); inside the 6 m band where two levels overlap each person fades from one to
//     the other by a screen-door dither on their own distance;
//   - every mesh shares ONE uniform block: a reaction is a few numbers changing, and each
//     person answers it from their own per-instance phase, threshold and place. No
//     JavaScript runs per person per frame;
//   - colour is resolved in the vertex shader from per-instance attributes (shirt, trousers,
//     accessory, indices into a skin and a hair palette), so one geometry dresses everyone;
//   - no shadows cast or received, flat shading (no normals stored or animated).
//
// The figure is modelled STANDING, arms down, front to +z, 1.75 m tall, on one skeleton
// (FIG below) shared by every variant, so the shader's pivots are constants.
import * as THREE from 'three';
import { standSeats, seatHash, seatLettering, FAN_SCALE, STANDS } from './stadium-kit.js';

// ---------------------------------------------------------------- the reactions (pure)
export const CROWD_REACTIONS = Object.freeze(['cheer', 'groan', 'wave', 'tense', 'calm', 'flash']);
const TWO_PI = Math.PI * 2;
// attack, hold, release (s). A hold is stretched by the reaction's intensity.
export const CROWD_ENVELOPES = Object.freeze({
  cheer: Object.freeze({ attack: 0.25, hold: 4, release: 2.5 }),
  groan: Object.freeze({ attack: 0.2, hold: 2.5, release: 2 }),
  tense: Object.freeze({ attack: 0.6, hold: 12, release: 1.5 }),
  flash: Object.freeze({ attack: 0.05, hold: 0.6, release: 0.85 }),
});
export const CROWD_WAVE_LAP_S = 5;
export const CROWD_IDLE_ENERGY = 0.35;
const CUT_S = 0.25;            // how fast a reaction is cut short by the one that replaces it
const clamp01 = (v) => Math.max(0, Math.min(1, v));

function envLevel(e, now) {
  if (!e) return 0;
  const dt = Math.max(0, now - e.t0);
  if (dt < e.attack) return e.from + (e.peak - e.from) * (dt / e.attack);
  if (dt < e.attack + e.hold) return e.peak;
  return e.peak * Math.max(0, 1 - (dt - e.attack - e.hold) / e.release);
}

// The crowd's mood as a handful of numbers, 0..1, that the shader turns into motion.
// react() starts or replaces a reaction; step(now) is what the mood is at `now` (seconds on
// any clock, as long as it is the same one). Nothing here knows about three or the stage.
export class CrowdMood {
  constructor() {
    this._env = { cheer: null, groan: null, tense: null, flash: null };
    this._wave = null;
    this._at = null;           // { x, y, r }: where the last placed reaction happened
    this._lastCheer = -1e9;
    this._out = { cheer: 0, groan: 0, tense: 0, stand: 0, energy: CROWD_IDLE_ENERGY, flash: 0, waveAngle: 0, waveAmp: 0, at: [0, 0], atRadius: 0, atOn: false };
  }

  _start(kind, now, intensity) {
    const def = CROWD_ENVELOPES[kind];
    const k = Math.max(0.2, Math.min(3, intensity));
    const from = envLevel(this._env[kind], now);
    // a reaction of the same kind picks up from where the last one stands: never a pop
    this._env[kind] = { t0: now, from, peak: Math.max(Math.min(1, k), 0.25), attack: def.attack, hold: kind === 'tense' ? def.hold : def.hold * k, release: def.release };
  }

  // let a reaction go from where it stands now, over `over` seconds
  _cut(kind, now, over = CUT_S) {
    const level = envLevel(this._env[kind], now);
    this._env[kind] = level > 1e-4 ? { t0: now, from: level, peak: level, attack: 0, hold: 0, release: over } : null;
  }

  // kind: 'cheer' | 'groan' | 'tense' | 'wave' | 'flash' | 'calm'. intensity: 1 is a full
  // reaction (a wave: laps of the ring); at { x, y } (course metres): where it happened,
  // people within radiusM (default 90) answer hardest. Returns false for a kind it does not know.
  react(kind, { intensity = 1, at = null, radiusM = null, startAngle = Math.PI } = {}, now = 0) {
    if (!CROWD_REACTIONS.includes(kind)) return false;
    const k = Number.isFinite(intensity) && intensity > 0 ? intensity : 1;
    if (kind === 'calm') {
      for (const name of ['cheer', 'groan', 'flash']) this._cut(name, now, 0.6);
      this._cut('tense', now, 0.8);
      if (this._wave) this._wave.end = Math.min(this._wave.end, now + 0.5);
      return true;
    }
    if (kind === 'wave') {
      const laps = Math.max(1, Math.min(4, Math.round(k)));
      this._wave = { t0: now, end: now + laps * CROWD_WAVE_LAP_S, start: startAngle };
      return true;
    }
    if (kind !== 'flash') {
      this._at = at && Number.isFinite(at.x) && Number.isFinite(at.y) ? { x: at.x, y: at.y, r: radiusM > 0 ? radiusM : 90 } : null;
    }
    if (kind === 'cheer') { this._cut('tense', now); this._cut('groan', now); this._lastCheer = now; }
    if (kind === 'groan') { this._cut('tense', now); this._cut('cheer', now); }
    this._start(kind, now, k);
    return true;
  }

  step(now) {
    const o = this._out, e = this._env;
    o.cheer = clamp01(envLevel(e.cheer, now));
    o.groan = clamp01(envLevel(e.groan, now));
    o.tense = clamp01(envLevel(e.tense, now));
    // the cameras come out as a cheer peaks
    const sinceCheer = now - this._lastCheer;
    const cheerFlash = sinceCheer >= 0 && sinceCheer < 1.5 ? 0.6 * o.cheer : 0;
    o.flash = clamp01(Math.max(envLevel(e.flash, now), cheerFlash));
    o.stand = Math.max(o.cheer, 0.3 * o.tense);
    // idle liveliness: up for some seconds after a cheer, held still while they are tense
    const lift = sinceCheer >= 0 && sinceCheer < 10 ? 1 - sinceCheer / 10 : 0;
    o.energy = clamp01((CROWD_IDLE_ENERGY + 0.4 * lift + 0.25 * o.cheer) * (1 - 0.75 * o.tense));
    const w = this._wave;
    if (w && now >= w.t0 && now < w.end) {
      const dt = now - w.t0;
      o.waveAngle = (w.start + TWO_PI * (dt / CROWD_WAVE_LAP_S)) % TWO_PI;
      o.waveAmp = clamp01(Math.min(dt / 0.3, (w.end - now) / 0.5));
    } else {
      o.waveAmp = 0;
      if (w && now >= w.end) this._wave = null;
    }
    o.atOn = !!this._at && (o.cheer > 0 || o.groan > 0);
    if (this._at) { o.at[0] = this._at.x; o.at[1] = this._at.y; o.atRadius = this._at.r; } else { o.atRadius = 0; }
    return o;
  }

  // anything still moving? (a caller may skip work while the crowd only idles)
  active(now) {
    const o = this.step(now);
    return o.cheer > 0 || o.groan > 0 || o.tense > 0 || o.flash > 0 || o.waveAmp > 0;
  }
}

// ---------------------------------------------------------------- levels of detail (pure)
export const CROWD_LOD = Object.freeze({ nearM: 38, nearUltraM: 55, midM: 120, bandM: 6, seatsM: 60 });

// The lens: a zoomed-in camera sees detail further off. distance * lodScale is compared
// with the bands, so a 29 degree half-angle (the game's base 58 degree lens) is 1.
export function crowdLodScale(fovDeg) {
  return Math.tan((fovDeg || 58) * Math.PI / 360) / Math.tan(29 * Math.PI / 180);
}

// where `near` ends for a quality: low has no near figures at all
export function crowdNearM(quality) {
  return quality === 'low' ? -1e4 : quality === 'ultra' ? CROWD_LOD.nearUltraM : CROWD_LOD.nearM;
}

// Which levels a chunk shows: distM from the camera to the middle of its bounding sphere of
// radiusM. Two levels are on together while the chunk straddles a band; each person then
// picks one by their own distance (the shader).
export function pickLod(distM, radiusM = 0, lodScale = 1, quality = 'high') {
  const nearest = Math.max(0, distM - radiusM) * lodScale, farthest = (distM + radiusM) * lodScale;
  const hb = CROWD_LOD.bandM / 2, nearEnd = crowdNearM(quality);
  return {
    near: quality !== 'low' && nearest < nearEnd + hb,
    mid: farthest > nearEnd - hb && nearest < CROWD_LOD.midM + hb,
    far: farthest > CROWD_LOD.midM - hb,
    seats: quality !== 'low' && nearest < CROWD_LOD.seatsM + 5,
  };
}

// ---------------------------------------------------------------- who wears what (pure)
const srgb = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
// '#rrggbb' or 0xrrggbb -> linear [r, g, b]
export function linearRgb(hex) {
  const n = typeof hex === 'number' ? hex : parseInt(String(hex).replace('#', ''), 16) || 0;
  return [srgb(((n >> 16) & 255) / 255), srgb(((n >> 8) & 255) / 255), srgb((n & 255) / 255)];
}

const SKIN = ['#f2c9a0', '#e0ac7e', '#c68a5c', '#96623c', '#6a4228'];
const HAIR = ['#2a2018', '#5a3a1e', '#d8b25a', '#1b1b1f', '#8a2f1c', '#d9d9d9'];
const TROUSERS = ['#2b3350', '#3b3b3b', '#5a4632', '#c9c4b4', '#28507a', '#1d1f26'];
const SHIRTS = ['#e8372c', '#ff8a1f', '#ffd21f', '#2fbf4a', '#19c2b8', '#2f7fe8', '#8e4de0', '#ff5fa8', '#f4f4ee', '#30343f', '#b7e04a', '#f4f4ee'];
const PALETTES = {
  stadium: { team: ['#1f6fe8', '#f4f4ee'] },
  neon: { team: ['#ff3df2', '#3df2ff'], shirts: ['#ff3df2', '#3df2ff', '#ffe81f', '#9d5cff', '#5cff9d', '#f4f4ee', '#ff8a1f', '#2f7fe8', '#30343f'] },
  alpine: { team: ['#e8372c', '#f4f9ff'], shirts: ['#e8372c', '#2f7fe8', '#ffd21f', '#19c2b8', '#f4f9ff', '#8e4de0', '#ff8a1f', '#2fbf4a', '#3a4254', '#ff5fa8'], coats: 0.38 },
  tropical: { team: ['#ff8a1f', '#f4f4ee'], shirts: ['#ff5fa8', '#ffd21f', '#19c2b8', '#f4f4ee', '#ff8a1f', '#2fbf4a', '#2f7fe8', '#e8372c', '#b7e04a', '#f4f4ee'] },
};
// The colours a theme's crowd is dressed from (hex strings), and its two team colours.
export function crowdPalette(theme) {
  const p = PALETTES[theme] || PALETTES.stadium;
  return { shirts: p.shirts || SHIRTS, skin: SKIN, hair: HAIR, trousers: TROUSERS, team: p.team, coats: p.coats ?? 0.08 };
}

// near figure variants; a person's `flag` (aCC.w) says what their right hand does
export const FIGURE_VARIANTS = Object.freeze(['plain', 'cap-scarf', 'long-hair', 'beanie-coat', 'flag', 'phone']);
const V_PLAIN = 0, V_CAP = 1, V_HAIR = 2, V_COAT = 3, V_FLAG = 4, V_PHONE = 5;

// Who sits where. stands: [{ id, kind, x, y, z, rotDeg, wedge?, scale?, text?, team?: [a, b],
// fill? }]; opts: { quality, theme, centre: { x, y } }. Returns
//   { centre, people, seats, chunks: [{ standId, standIndex, tier, standing, count, seatCount,
//       inst [x, y, z, yaw, sx, sy] * count      (course metres; yaw clockwise from north)
//       ca [shirt r, g, b, phase] * count        (linear rgb; phase 0..1)
//       cb [trousers r, g, b, angle round the centre] * count
//       cc [skin + 8 * hair, standing, random, hand (0 none, 1 flag, 2 phone)] * count
//       cd [accessory r, g, b, variant] * count
//       variant Uint8, letter Uint8 (1: a lettering seat),
//       seatPos [x, y, z, yaw] * seatCount, seatCol [r, g, b] * seatCount,
//       bounds { x, y, z, r } }] }
// Deterministic: the same stands give the same crowd.
export function planCrowd(stands, { quality = 'high', theme = null, centre = null } = {}) {
  const list = (Array.isArray(stands) ? stands : []).filter((s) => s && STANDS[s.kind]);
  const pal = crowdPalette(theme);
  const shirts = pal.shirts.map(linearRgb), trousers = pal.trousers.map(linearRgb);
  const low = quality === 'low';
  let cx = 0, cy = 0;
  if (centre && Number.isFinite(centre.x) && Number.isFinite(centre.y)) { cx = centre.x; cy = centre.y; } else if (list.length) {
    for (const s of list) { cx += s.x; cy += s.y; }
    cx /= list.length; cy /= list.length;
  }
  const out = { centre: { x: cx, y: cy }, people: 0, seats: 0, chunks: [] };
  list.forEach((stand, si) => {
    const seats = standSeats(stand);
    if (!seats.count) return;
    const def = seats.def;
    const fill = Number.isFinite(stand.fill) ? clamp01(stand.fill) : 0.9;
    const team = (Array.isArray(stand.team) && stand.team.length >= 2 ? stand.team : pal.team).map(linearRgb);
    const textTier = stand.text ? (Number.isInteger(stand.textTier) ? stand.textTier : def.tiers.length - 1) : -1;
    const k = typeof stand.scale === 'number' && stand.scale > 0 ? stand.scale : 1;
    def.tiers.forEach((tier, ti) => {
      const rows = seats.rows.filter((r) => r.tier === ti);
      const first = rows[0].from, last = rows[rows.length - 1].to, nSeats = last - first;
      if (!nSeats) return;
      const standing = !!tier.stand;
      const inst = new Float32Array(nSeats * 6), ca = new Float32Array(nSeats * 4), cb = new Float32Array(nSeats * 4);
      const cc = new Float32Array(nSeats * 4), cd = new Float32Array(nSeats * 4);
      const variant = new Uint8Array(nSeats), letter = new Uint8Array(nSeats);
      const seatPos = standing || low ? new Float32Array(0) : new Float32Array(nSeats * 4);
      const seatCol = standing || low ? new Float32Array(0) : new Float32Array(nSeats * 3);
      let n = 0, ns = 0;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const row of rows) {
        const nCols = row.to - row.from;
        for (let s = row.from; s < row.to; s++) {
          const px = seats.pos[s * 4], py = seats.pos[s * 4 + 1], pz = seats.pos[s * 4 + 2], yaw = seats.pos[s * 4 + 3];
          const col = seats.meta[s * 4 + 2], block = seats.meta[s * 4 + 3];
          const lit = ti === textTier && seatLettering(stand.text, col, nCols, row.row, tier.rows, 2);
          if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; if (pz < z0) z0 = pz; if (pz > z1) z1 = pz;
          if (seatPos.length) {
            seatPos[ns * 4] = px; seatPos[ns * 4 + 1] = py; seatPos[ns * 4 + 2] = pz; seatPos[ns * 4 + 3] = yaw;
            const c = lit ? team[1] : team[0], shade = lit ? 1 : (block & 1 ? 0.82 : 1);
            seatCol[ns * 3] = c[0] * shade; seatCol[ns * 3 + 1] = c[1] * shade; seatCol[ns * 3 + 2] = c[2] * shade;
            ns++;
          }
          if (seatHash(si, s, 1) >= fill) continue;                       // an empty seat
          if (low && ((col + row.row) & 1)) continue;                     // low graphics: every second person
          const h1 = seatHash(si, s, 2), h2 = seatHash(si, s, 3), h3 = seatHash(si, s, 4), h4 = seatHash(si, s, 5), h5 = seatHash(si, s, 6);
          // what they wear: the lettering in the team's second colour, a share of the rest in its first
          let shirt;
          if (lit) shirt = h1 < 0.93 ? team[1] : shirts[(h2 * shirts.length) | 0];
          else shirt = h1 < (ti === textTier && stand.text ? 0.8 : 0.4) ? team[0] : shirts[(h2 * shirts.length) | 0];   // round a letter the block wears the first colour: the letter reads
          const bright = 0.86 + 0.24 * h3;
          // who they are: a figure variant, and what the right hand holds
          const coats = pal.coats;
          let v = V_PLAIN;
          if (h4 < 0.05) v = V_FLAG; else if (h4 < 0.16) v = V_PHONE; else if (h4 < 0.16 + coats) v = V_COAT;
          else if (h4 < 0.34 + coats) v = V_CAP; else if (h4 < 0.54 + coats) v = V_HAIR;
          const kid = h5 < 0.045;
          const tall = FAN_SCALE * (kid ? 0.7 : 0.92 + 0.16 * h2), girth = FAN_SCALE * (kid ? 0.72 : 0.9 + 0.24 * h3);
          inst[n * 6] = px; inst[n * 6 + 1] = py; inst[n * 6 + 2] = pz; inst[n * 6 + 3] = yaw; inst[n * 6 + 4] = girth; inst[n * 6 + 5] = tall;
          ca[n * 4] = shirt[0] * bright; ca[n * 4 + 1] = shirt[1] * bright; ca[n * 4 + 2] = shirt[2] * bright; ca[n * 4 + 3] = h5;
          const tr = trousers[(h3 * trousers.length) | 0];
          cb[n * 4] = tr[0]; cb[n * 4 + 1] = tr[1]; cb[n * 4 + 2] = tr[2]; cb[n * 4 + 3] = Math.atan2(px - cx, py - cy);
          cc[n * 4] = ((h1 * 977) % 1 * SKIN.length | 0) + 8 * ((h4 * 613) % 1 * HAIR.length | 0);
          cc[n * 4 + 1] = standing ? 1 : 0; cc[n * 4 + 2] = h1; cc[n * 4 + 3] = v === V_FLAG ? 1 : v === V_PHONE ? 2 : 0;
          // scarves, caps and flags in the team's colours
          const acc = h3 < 0.7 ? team[0] : team[1];
          cd[n * 4] = acc[0]; cd[n * 4 + 1] = acc[1]; cd[n * 4 + 2] = acc[2]; cd[n * 4 + 3] = v;
          variant[n] = v; letter[n] = lit ? 1 : 0;
          n++;
        }
      }
      if (!n && !ns) return;
      const bx = (x0 + x1) / 2, by = (y0 + y1) / 2, bz = (z0 + z1) / 2;
      out.people += n; out.seats += ns;
      out.chunks.push({
        standId: stand.id != null ? String(stand.id) : `stand-${si}`, standIndex: si, tier: ti, standing, count: n, seatCount: ns, scale: k,
        inst: inst.subarray(0, n * 6), ca: ca.subarray(0, n * 4), cb: cb.subarray(0, n * 4), cc: cc.subarray(0, n * 4), cd: cd.subarray(0, n * 4),
        variant: variant.subarray(0, n), letter: letter.subarray(0, n), seatPos, seatCol,
        bounds: { x: bx, y: by, z: bz, r: Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 2.5 },
      });
    });
  });
  return out;
}

// ---------------------------------------------------------------- the figures
// The skeleton every figure is built on (metres, standing): the shader's pivots.
export const FIG = Object.freeze({
  hipY: 0.92, kneeY: 0.48, thighM: 0.44, shoulderY: 1.42, shoulderX: 0.225, upperArmM: 0.28, neckY: 1.5, headY: 1.635, headR: 0.135, legX: 0.09, heightM: 1.75,
});
const PART = Object.freeze({ torso: 0, head: 1, upperArm: 2, foreArm: 3, thigh: 4, shin: 5 });
const MAT = Object.freeze({ shirt: 0, skin: 1, trousers: 2, hair: 3, accessory: 4, screen: 5, dark: 6 });
export const FIGURE_PARTS = PART;
export const FIGURE_MATS = MAT;

// collects triangles with a part and a material each (and a sway weight per vertex, for cloth)
class FigBuilder {
  constructor() { this.pos = []; this.pm = []; }
  tri(a, b, c, part, mat, sway = 0) {
    const sw = Array.isArray(sway) ? sway : [sway, sway, sway];
    [a, b, c].forEach((p, i) => { this.pos.push(p[0], p[1], p[2]); this.pm.push(part, mat, sw[i]); });
  }
  quad(a, b, c, d, part, mat, sway = 0) {
    const sw = Array.isArray(sway) ? sway : [sway, sway, sway, sway];
    this.tri(a, b, c, part, mat, [sw[0], sw[1], sw[2]]);
    this.tri(a, c, d, part, mat, [sw[0], sw[2], sw[3]]);
  }
  // the wall between two rings of the same count
  band(r0, r1, part, mat) {
    const n = r0.length;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.quad(r0[i], r0[j], r1[j], r1[i], part, mat); }
  }
  // a ring closed to a point
  fan(ring, apex, part, mat) {
    const n = ring.length;
    for (let i = 0; i < n; i++) this.tri(ring[i], ring[(i + 1) % n], apex, part, mat);
  }
  // a tapered limb down the y axis from (x, y0, z0) to (x1, y1, z1)
  limb(top, bot, rTop, rBot, part, mat, n = 4) {
    const a = ring(n, top[0], top[1], top[2], rTop, rTop, Math.PI / 4), b = ring(n, bot[0], bot[1], bot[2], rBot, rBot, Math.PI / 4);
    this.band(a, b, part, mat);
    return b;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('aPM', new THREE.BufferAttribute(new Float32Array(this.pm), 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}
const ring = (n, cx, y, cz, rx, rz, rot = 0) => Array.from({ length: n }, (_, i) => {
  const a = rot + (i / n) * TWO_PI;
  return [cx + Math.cos(a) * rx, y, cz + Math.sin(a) * rz];
});

function nearFigure(b, variant) {
  const coat = variant === 'beanie-coat', girth = coat ? 1.2 : 1;
  // torso: hips, chest, shoulders
  const hips = ring(6, 0, coat ? 0.8 : 0.9, 0, 0.165 * girth, 0.105 * girth);
  const chest = ring(6, 0, 1.34, 0, 0.2 * girth, 0.118 * girth);
  const top = ring(6, 0, 1.47, 0, 0.14 * girth, 0.085 * girth);
  b.band(hips, chest, PART.torso, MAT.shirt);
  b.band(chest, top, PART.torso, MAT.shirt);
  b.fan(top, [0, 1.5, 0], PART.torso, MAT.shirt);
  // head: 20 faces, the top and the back are hair (or a cap, or a beanie)
  const ico = new THREE.IcosahedronGeometry(FIG.headR, 0).attributes.position;
  const hatMat = variant === 'cap-scarf' || coat ? MAT.accessory : MAT.hair;
  for (let f = 0; f < ico.count; f += 3) {
    const p = [0, 1, 2].map((k) => [ico.getX(f + k), ico.getY(f + k) + FIG.headY, ico.getZ(f + k)]);
    const cy = (p[0][1] + p[1][1] + p[2][1]) / 3 - FIG.headY, cz = (p[0][2] + p[1][2] + p[2][2]) / 3;
    const crown = cy > 0.035, back = cz < -0.035 && cy > -0.06;
    b.tri(p[0], p[1], p[2], PART.head, crown ? hatMat : back ? MAT.hair : MAT.skin);
  }
  // arms: sleeve, forearm, hand
  for (const s of [-1, 1]) {
    const sx = s * FIG.shoulderX, ex = s * 0.235;
    b.limb([sx, FIG.shoulderY + 0.03, 0], [ex, 1.14, 0], 0.056 * girth, 0.045 * girth, PART.upperArm, MAT.shirt);
    const wrist = b.limb([ex, 1.14, 0], [ex, 0.9, 0], 0.043 * girth, 0.034, PART.foreArm, coat ? MAT.shirt : MAT.skin);
    b.fan(wrist, [ex, 0.81, 0.01], PART.foreArm, MAT.skin);
  }
  // legs: thigh, shin, shoe
  for (const s of [-1, 1]) {
    const lx = s * FIG.legX;
    b.limb([lx, FIG.hipY + 0.02, 0], [lx, FIG.kneeY, 0], 0.08, 0.06, PART.thigh, MAT.trousers);
    b.limb([lx, FIG.kneeY, 0], [lx, 0.07, 0], 0.058, 0.044, PART.shin, MAT.trousers);
    const w = 0.05;
    b.quad([lx - w, 0.075, -0.05], [lx + w, 0.075, -0.05], [lx + w, 0.03, 0.17], [lx - w, 0.03, 0.17], PART.shin, MAT.dark);
    b.tri([lx - w, 0.075, -0.05], [lx - w, 0.03, 0.17], [lx - w, 0, -0.05], PART.shin, MAT.dark);
    b.tri([lx + w, 0.075, -0.05], [lx + w, 0, -0.05], [lx + w, 0.03, 0.17], PART.shin, MAT.dark);
  }
  if (variant === 'cap-scarf') {
    // the peak of the cap, and a scarf round the neck with one end hanging
    b.quad([-0.09, 1.685, 0.09], [0.09, 1.685, 0.09], [0.075, 1.665, 0.25], [-0.075, 1.665, 0.25], PART.head, MAT.accessory);
    b.band(ring(6, 0, 1.43, 0, 0.155, 0.11), ring(6, 0, 1.51, 0, 0.115, 0.095), PART.torso, MAT.accessory);
    b.quad([0.03, 1.45, 0.112], [0.11, 1.45, 0.112], [0.115, 1.14, 0.125], [0.035, 1.14, 0.125], PART.torso, MAT.accessory);
  } else if (variant === 'long-hair') {
    // hair down the back to the shoulder blades
    const y0 = 1.71, y1 = 1.33;
    b.quad([-0.11, y0, -0.06], [0.11, y0, -0.06], [0.12, y1, -0.115], [-0.12, y1, -0.115], PART.head, MAT.hair);
    b.quad([-0.11, y0, -0.06], [-0.12, y1, -0.115], [-0.125, y1 + 0.06, 0.0], [-0.115, y0 - 0.04, 0.02], PART.head, MAT.hair);
    b.quad([0.11, y0, -0.06], [0.115, y0 - 0.04, 0.02], [0.125, y1 + 0.06, 0.0], [0.12, y1, -0.115], PART.head, MAT.hair);
  } else if (coat) {
    // a bobble on the beanie
    const c = [0, FIG.headY + FIG.headR * 0.85 + 0.02, 0], r = 0.045;
    const base = ring(3, c[0], c[1] - 0.02, c[2], r, r);
    b.fan(base, [c[0], c[1] + 0.05, c[2]], PART.head, MAT.accessory);
    b.tri(base[0], base[2], base[1], PART.head, MAT.accessory);
  } else if (variant === 'flag') {
    // a flag in the right hand: the pole runs on past the hand along the forearm (which is
    // held up while it is waved), the cloth hangs off its far end
    const hx = 0.235, y0 = 0.9, y1 = -0.4;
    b.band(ring(3, hx, y0, 0.03, 0.014, 0.014), ring(3, hx, y1, 0.03, 0.014, 0.014), PART.foreArm, MAT.dark);
    const segs = 3, w = 0.78, hgt = 0.5;
    for (let i = 0; i < segs; i++) {
      const xa = hx + (w * i) / segs, xb = hx + (w * (i + 1)) / segs, sa = i / segs, sb = (i + 1) / segs;
      b.quad([xa, y1, 0.03], [xb, y1, 0.03], [xb, y1 + hgt, 0.03], [xa, y1 + hgt, 0.03], PART.foreArm, i === 1 ? MAT.shirt : MAT.accessory, [sa, sb, sb, sa]);
    }
  } else if (variant === 'phone') {
    // a phone in the right hand, screen lit
    const hx = 0.235, y0 = 0.74, y1 = 0.9, w = 0.045, z = 0.03;
    b.quad([hx - w, y0, z], [hx + w, y0, z], [hx + w, y1, z], [hx - w, y1, z], PART.foreArm, MAT.screen);
  }
}

function midFigure(b) {
  // 28 triangles: a four-sided body, an eight-faced head, limbs as flat strips
  const hips = ring(4, 0, 0.9, 0, 0.2, 0.13, Math.PI / 4), sh = ring(4, 0, 1.47, 0, 0.24, 0.13, Math.PI / 4);
  b.band(hips, sh, PART.torso, MAT.shirt);
  const eq = ring(4, 0, FIG.headY, 0, FIG.headR * 0.95, FIG.headR * 0.95, Math.PI / 4);
  b.fan(eq, [0, FIG.headY + FIG.headR * 0.85, 0], PART.head, MAT.hair);
  for (let i = 0; i < 4; i++) b.tri(eq[(i + 1) % 4], eq[i], [0, FIG.headY - FIG.headR * 0.85, 0], PART.head, MAT.skin);
  for (const s of [-1, 1]) {
    const x0 = s * 0.18, x1 = s * 0.28;
    b.quad([x0, 1.44, 0], [x1, 1.44, 0], [x1, 1.14, 0], [x0, 1.14, 0], PART.upperArm, MAT.shirt);
    b.quad([x0 + s * 0.01, 1.14, 0], [x1 - s * 0.01, 1.14, 0], [x1 - s * 0.02, 0.84, 0], [x0 + s * 0.02, 0.84, 0], PART.foreArm, MAT.skin);
  }
  b.quad([-0.17, 0.92, 0.02], [0.17, 0.92, 0.02], [0.15, 0.48, 0.02], [-0.15, 0.48, 0.02], PART.thigh, MAT.trousers);
  b.quad([-0.15, 0.48, 0.02], [0.15, 0.48, 0.02], [0.14, 0.0, 0.03], [-0.14, 0.0, 0.03], PART.shin, MAT.trousers);
}

function farFigure(b) {
  // 8 triangles facing the pitch: a body, a head, and two arms that only show when they are up
  b.quad([-0.2, 0.6, 0], [0.2, 0.6, 0], [0.22, 1.46, 0], [-0.22, 1.46, 0], PART.torso, MAT.shirt);
  b.quad([-0.12, 1.48, 0], [0.12, 1.48, 0], [0.12, 1.74, 0], [-0.12, 1.74, 0], PART.head, MAT.skin);
  for (const s of [-1, 1]) b.quad([s * 0.17, 1.42, 0], [s * 0.27, 1.42, 0], [s * 0.36, 1.98, 0], [s * 0.26, 1.98, 0], PART.upperArm, MAT.shirt);
}

// A figure's geometry: position and aPM = (part, material, sway). lod 'near' takes a
// variant name (FIGURE_VARIANTS); 'mid' and 'far' ignore it. Not indexed, no normals (the
// crowd is flat shaded).
export function buildFigure(variant = 'plain', lod = 'near') {
  const b = new FigBuilder();
  if (lod === 'far') farFigure(b);
  else if (lod === 'mid') midFigure(b);
  else nearFigure(b, FIGURE_VARIANTS.includes(variant) ? variant : 'plain');
  const g = b.geometry();
  g.userData.triangles = b.pos.length / 9;
  return g;
}

// a stadium seat: a back and a pan (and the bracket under it), front to +z
export function buildSeat() {
  const b = new FigBuilder();
  const w = 0.24;
  b.quad([-w, 0.44, -0.2], [w, 0.44, -0.2], [w, 0.92, -0.27], [-w, 0.92, -0.27], 0, 0);
  b.quad([-w, 0.44, -0.2], [w, 0.44, -0.2], [w, 0.42, 0.2], [-w, 0.42, 0.2], 0, 0);
  b.quad([-0.04, 0.42, -0.12], [0.04, 0.42, -0.12], [0.04, 0, -0.16], [-0.04, 0, -0.16], 0, 0);
  const g = b.geometry();
  g.deleteAttribute('aPM');
  g.computeVertexNormals();
  g.userData.triangles = 6;
  return g;
}

// ---------------------------------------------------------------- the shader
// The vertex stage of every crowd level. CROWD_LEVEL: 0 near, 1 mid, 2 far.
export const CROWD_VERTEX_PARS = /* glsl */`
  attribute vec3 aPM;
  attribute vec4 aCA;
  attribute vec4 aCB;
  attribute vec4 aCC;
  attribute vec4 aCD;
  uniform float uCrowdTime;
  uniform vec4 uCrowdMood;
  uniform vec4 uCrowdWave;
  uniform vec4 uCrowdAt;
  uniform vec4 uCrowdLod;
  uniform vec3 uCrowdFx;
  uniform vec3 uCrowdSkin[5];
  uniform vec3 uCrowdHair[6];
  varying vec3 vCrowdCol;
  varying vec3 vCrowdEm;
  varying float vCrowdFade;
  float crowdHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  // about x: positive swings what hangs down (an arm, a thigh) forward and up
  vec3 crowdRotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, p.y * c + p.z * s, -p.y * s + p.z * c); }
  vec3 crowdRotZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z); }
  vec3 crowdRotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c); }
`;

export const CROWD_VERTEX_MAIN = /* glsl */`
  vec3 transformed = vec3(position);
  {
    float part = aPM.x;
    float matId = aPM.y;
    float ph = aCA.w * 6.2831853;
    float rnd = aCC.z;
    float rnd2 = fract(rnd * 7.31 + aCA.w * 3.7);
    float rnd3 = fract(rnd * 13.17 + 0.37);
    float side = position.x >= 0.0 ? 1.0 : -1.0;
    #ifdef USE_INSTANCING
    vec3 iPos = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
    #else
    vec3 iPos = modelMatrix[3].xyz;
    #endif
    // which level of detail draws this person: a dither across the band between two
    float camD = distance(cameraPosition, iPos) * uCrowdLod.w;
    float hb = uCrowdLod.z * 0.5;
    float fadeNear = 1.0 - smoothstep(uCrowdLod.x - hb, uCrowdLod.x + hb, camD);
    float fadeFar = smoothstep(uCrowdLod.y - hb, uCrowdLod.y + hb, camD);
    #if CROWD_LEVEL == 0
    float fade = fadeNear;
    vCrowdFade = fade;
    #elif CROWD_LEVEL == 1
    float fade = (1.0 - fadeNear) * (1.0 - fadeFar);
    vCrowdFade = camD < 0.5 * (uCrowdLod.x + uCrowdLod.y) ? -fade : fade;
    #else
    float fade = fadeFar;
    vCrowdFade = -fade;
    #endif

    // how hard this person answers the mood: their own threshold, and how near they are to it
    float fall = 1.0;
    if (uCrowdAt.w > 0.5) fall = mix(0.3, 1.0, 1.0 - smoothstep(uCrowdAt.z * 0.45, uCrowdAt.z, distance(iPos.xz, uCrowdAt.xy)));
    float cheerP = smoothstep(rnd * 0.5, rnd * 0.5 + 0.35, uCrowdMood.x * fall);
    float groanP = smoothstep(rnd2 * 0.5, rnd2 * 0.5 + 0.35, uCrowdMood.y * fall);
    float tenseP = smoothstep(rnd3 * 0.4, rnd3 * 0.4 + 0.4, uCrowdMood.z);
    float energy = uCrowdMood.w;
    // the wave: a front running round the ring
    float wd = abs(mod(aCB.w - uCrowdWave.x + 3.14159265, 6.2831853) - 3.14159265);
    float waveP = uCrowdWave.y * (1.0 - smoothstep(0.08, 0.5, wd));
    float up = max(cheerP, waveP);
    float standing = max(aCC.y, max(up, tenseP * step(0.72, rnd)));
    float sit = 1.0 - standing;
    float jump = abs(sin(uCrowdTime * (6.0 + rnd * 2.5) + ph)) * 0.26 * cheerP + waveP * 0.12;
    float legA = sit * 1.48;
    float drop = 0.44 * (1.0 - cos(legA));

    #if CROWD_LEVEL == 2
    // the card: it rises and sinks, and its arms grow out of the shoulders
    float armsUp = max(up, groanP * 0.7);
    if (part > 1.5) transformed.y = 1.42 + (transformed.y - 1.42) * armsUp;
    transformed.y += jump - drop;
    #else
    if (part > 4.5) {
      // shins: carried by the knees
      transformed.y += drop;
      transformed.z += 0.44 * sin(legA);
    } else if (part > 3.5) {
      // thighs: forward about the hips
      transformed = crowdRotX(transformed - vec3(0.0, 0.92, 0.0), legA) + vec3(0.0, 0.92, 0.0);
    } else {
      // what the arms do: blended between the poses, the weights add up to one
      float clapT = uCrowdTime * 0.21 + rnd2 * 7.0;
      float clapW = fract(clapT);
      float clap = step(0.8, crowdHash(vec2(rnd, floor(clapT)))) * smoothstep(0.0, 0.08, clapW) * (1.0 - smoothstep(0.75, 1.0, clapW));
      clap = min(1.0, clap * energy * 1.6);
      float wCheer = up;
      float wGroan = groanP * (1.0 - wCheer);
      float wTense = tenseP * (1.0 - wCheer) * (1.0 - groanP);
      float wClap = clap * (1.0 - wCheer) * (1.0 - groanP) * (1.0 - tenseP);
      float wRest = (1.0 - wCheer) * (1.0 - groanP) * (1.0 - tenseP) * (1.0 - clap);
      // shoulder (up from hanging), elbow (bend), roll (out when raised), yaw (in across the chest)
      float aS = wCheer * (2.85 + 0.2 * sin(uCrowdTime * 9.0 + ph)) + wGroan * 2.45 + wTense * 0.95 + wClap * 0.9 + wRest * 0.42 * sit;
      float aE = wCheer * 0.2 + wGroan * 2.1 + wTense * 2.0 + wClap * 1.25 + wRest * 1.05 * sit;
      float roll = wCheer * (0.3 + 0.22 * sin(uCrowdTime * 7.0 + ph * 1.7)) - wGroan * 0.42;
      float yaw = wTense * 0.6 + wClap * (0.35 + 0.3 * sin(uCrowdTime * 15.0 + ph));
      if (side > 0.0 && aCC.w > 0.5) {
        // the right hand holds something: a flag is always up and swinging, a phone comes up to film
        float isFlag = 1.0 - step(1.5, aCC.w);
        float swing = sin(uCrowdTime * 2.6 + ph) * (0.4 + energy + up);
        float hold = max(isFlag, max(tenseP, cheerP));
        aS = mix(aS, mix(1.5, 2.5 + 0.25 * swing, isFlag), hold);
        aE = mix(aE, mix(1.2, 0.15, isFlag), hold);
        roll = mix(roll, mix(0.1, 0.45 * swing, isFlag), hold);
        yaw = mix(yaw, 0.0, hold);
      }
      if (part > 1.5) {
        vec3 sh = vec3(side * 0.225, 1.42, 0.0);
        vec3 q = transformed - sh;
        if (part > 2.5) {
          vec3 el = vec3(side * 0.01, -0.28, 0.0);
          q = crowdRotX(q - el, aE) + el;
          q.z += sin(uCrowdTime * 6.0 + ph + position.x * 5.0) * aPM.z * 0.16;   // cloth
        }
        q = crowdRotX(q, aS);
        q = crowdRotZ(q, -side * roll);
        q = crowdRotY(q, -side * yaw);
        transformed = sh + q;
      } else if (part > 0.5) {
        // the head: looking about, thrown back in a groan, dipped when tense
        vec3 nk = vec3(0.0, 1.5, 0.0);
        vec3 q = crowdRotY(transformed - nk, sin(uCrowdTime * (0.6 + rnd2 * 0.8) + ph * 2.0) * 0.4 * energy * wRest);
        transformed = nk + crowdRotX(q, wGroan * 0.35 - wTense * 0.12);
      }
      // the whole upper body about the hips: lean (forward is negative about x) and sway
      float lean = wTense * 0.3 - wGroan * 0.2 - 0.07 * sit * wRest + sin(uCrowdTime * (0.5 + rnd2) + ph * 1.3) * 0.03 * energy;
      float sway = sin(uCrowdTime * (0.7 + rnd * 0.9) + ph) * 0.045 * energy;
      vec3 hp = vec3(0.0, 0.92, 0.0);
      transformed = hp + crowdRotZ(crowdRotX(transformed - hp, -lean), sway);
    }
    // down onto the seat (and back on it), up with a jump
    transformed.y += jump - drop;
    transformed.z -= 0.08 * sit;
    #endif

    // colour: this person's own
    vec3 col = vec3(0.07, 0.07, 0.09);
    if (matId < 0.5) col = aCA.rgb;
    else if (matId < 1.5) col = uCrowdSkin[int(min(4.0, mod(aCC.x + 0.25, 8.0)))];
    else if (matId < 2.5) col = aCB.rgb;
    else if (matId < 3.5) col = uCrowdHair[int(min(5.0, floor((aCC.x + 0.25) / 8.0)))];
    else if (matId < 4.5) col = aCD.rgb;
    else if (matId < 5.5) col = vec3(0.55, 0.8, 1.0);
    vCrowdCol = col;
    vCrowdEm = (matId > 4.5 && matId < 5.5) ? vec3(0.55, 0.8, 1.0) * uCrowdFx.z : vec3(0.0);
    // a camera flash: now and then, for a frame or two, a head goes white
    float flashOn = step(1.0 - uCrowdFx.x * 0.014, crowdHash(vec2(rnd * 91.7 + aCA.w, floor(uCrowdTime * 12.0))));
    if (flashOn > 0.5 && part > 0.5 && part < 1.5) {
      vCrowdEm += vec3(9.0);
      #if CROWD_LEVEL == 2
      vec3 hc = vec3(0.0, 1.61 + jump - drop, 0.0);
      transformed = hc + (transformed - hc) * 2.2;
      #endif
    }
    #if CROWD_LEVEL == 2
    {
      // a card turns about its own upright to face the lens: seen along a row (from a gap in the bowl, from above) it was edge-on and gone
      vec3 crowdToCam = cameraPosition - (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
      vec2 crowdDir = normalize(vec2(dot(crowdToCam, normalize(instanceMatrix[0].xyz)), dot(crowdToCam, normalize(instanceMatrix[2].xyz))) + vec2(0.0, 1e-4));
      transformed.xz = vec2(transformed.x * crowdDir.y + transformed.z * crowdDir.x, -transformed.x * crowdDir.x + transformed.z * crowdDir.y);
    }
    #endif
    // someone another level draws is nothing here
    transformed *= step(0.002, fade);
  }
`;

export const CROWD_FRAGMENT_PARS = /* glsl */`
  uniform vec3 uCrowdFx;
  varying vec3 vCrowdCol;
  varying vec3 vCrowdEm;
  varying float vCrowdFade;
`;
// between two levels each pixel of a person belongs to one of them (interleaved gradient noise)
export const CROWD_FRAGMENT_DITHER = /* glsl */`
  {
    float crowdN = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (vCrowdFade >= 0.0 ? crowdN >= vCrowdFade : crowdN < 1.0 + vCrowdFade) discard;
  }
`;

// One level's material: lit like everything else (fog, the scene's lights, tone mapping),
// flat shaded, its colour from the instance. uniforms: the shared block (CrowdLayer.uniforms).
export function makeCrowdMaterial(level, uniforms) {
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, side: THREE.DoubleSide });
  material.name = `crowd:${['near', 'mid', 'far'][level]}`;
  material.defines = { CROWD_LEVEL: level };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${CROWD_VERTEX_PARS}`)
      .replace('#include <begin_vertex>', CROWD_VERTEX_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CROWD_FRAGMENT_PARS}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${CROWD_FRAGMENT_DITHER}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= vCrowdCol;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vCrowdCol * uCrowdFx.y + vCrowdEm;');
  };
  material.customProgramCacheKey = () => `crowd-v1-${level}`;
  return material;
}

// The seats: instanced, each its own colour (three's instanceColor), shrunk away by about 60 m
// (under a full house they are a few pixels of colour between the shoulders).
export function makeSeatMaterial(uniforms) {
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  material.name = 'crowd:seats';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCrowdLod = uniforms.uCrowdLod;
    shader.uniforms.uCrowdFx = uniforms.uCrowdFx;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n  uniform vec4 uCrowdLod;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
        {
          float seatD = distance(cameraPosition, (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz) * uCrowdLod.w;
          transformed *= 1.0 - smoothstep(${(CROWD_LOD.seatsM - 8).toFixed(1)}, ${(CROWD_LOD.seatsM + 2).toFixed(1)}, seatD);
        }
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n  uniform vec3 uCrowdFx;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * uCrowdFx.y;');
  };
  material.customProgramCacheKey = () => 'crowd-v1-seats';
  return material;
}

// ---------------------------------------------------------------- the layer
const LEVELS = ['near', 'mid', 'far'];

export class CrowdLayer {
  // scene: the THREE.Scene; V(x, y, z): course -> three (x, z, -y); quality(): 'low' | 'high'
  // | 'ultra'; style(): { self, emissive, night } or null: how much of its own colour a
  // night stage's crowd gives back unlit, and how bright its screens are.
  constructor({ scene, V = null, quality = () => 'high', style = () => null } = {}) {
    this.scene = scene;
    this.V = V || ((x, y, z) => new THREE.Vector3(x, z, -y));
    this.quality = quality;
    this.style = style;
    this.mood = new CrowdMood();
    this.group = null;
    this.chunks = [];
    this.plan = null;
    this._hidden = new Set();
    this._t = 0;
    this._builtQuality = null;
    this._drawn = { near: 0, mid: 0, far: 0, seats: 0, triangles: 0, calls: 0 };
    this.uniforms = {
      uCrowdTime: { value: 0 },
      uCrowdMood: { value: new THREE.Vector4(0, 0, 0, CROWD_IDLE_ENERGY) },   // cheer, groan, tense, energy
      uCrowdWave: { value: new THREE.Vector4(0, 0, 0, 0) },                    // the front's angle, its strength
      uCrowdAt: { value: new THREE.Vector4(0, 0, 90, 0) },                     // where (three x, z), radius, on
      uCrowdLod: { value: new THREE.Vector4(CROWD_LOD.nearM, CROWD_LOD.midM, CROWD_LOD.bandM, 1) },   // near ends, mid ends, band, lens
      uCrowdFx: { value: new THREE.Vector3(0, 0, 1) },                         // flash, own colour unlit, screens
      uCrowdSkin: { value: SKIN.map((c) => new THREE.Color(c)) },
      uCrowdHair: { value: HAIR.map((c) => new THREE.Color(c)) },
    };
    this._materials = null;
    this._figures = null;
  }

  _kit() {
    if (this._materials) return;
    this._materials = { near: makeCrowdMaterial(0, this.uniforms), mid: makeCrowdMaterial(1, this.uniforms), far: makeCrowdMaterial(2, this.uniforms), seats: makeSeatMaterial(this.uniforms) };
    this._figures = { near: FIGURE_VARIANTS.map((v) => buildFigure(v, 'near')), mid: buildFigure('plain', 'mid'), far: buildFigure('plain', 'far'), seat: buildSeat() };
  }

  // The stands of the stage, replacing whatever stood. stands: the `place` objects of
  // stadium-kit.js standSeats plus { id, text, team: [a, b], fill }.
  setStands(stands, { centre = null, theme = null } = {}) {
    this.clear();
    this._stands = Array.isArray(stands) ? stands : [];
    this._opts = { centre, theme };
    const quality = this.quality() || 'high';
    this._builtQuality = quality;
    const plan = planCrowd(this._stands, { quality, theme, centre });
    this.plan = plan;
    if (!plan.people && !plan.seats) return this.stats();
    this._kit();
    this.group = new THREE.Group();
    this.group.name = 'crowd';
    this.scene.add(this.group);
    for (const c of plan.chunks) this._buildChunk(c);
    return this.stats();
  }

  // an instanced mesh over a figure: its own geometry object, the figure's vertex buffers
  _mesh(base, material, count, matrix, attrs, sphere, name) {
    const g = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(base.attributes)) g.setAttribute(k, a);
    for (const [k, a] of Object.entries(attrs)) g.setAttribute(k, a);
    g.boundingSphere = base.boundingSphere;
    g.boundingBox = base.boundingBox;
    const m = new THREE.InstancedMesh(g, material, count);
    m.instanceMatrix = matrix;
    m.boundingSphere = sphere;
    m.name = name;
    m.castShadow = false;
    m.receiveShadow = false;
    m.matrixAutoUpdate = false;
    m.userData.triangles = (base.userData.triangles || 0) * count;
    this.group.add(m);
    return m;
  }

  _buildChunk(c) {
    const o = this.V(0, 0, 0);
    const centre = this.V(c.bounds.x, c.bounds.y, c.bounds.z);
    const sphere = new THREE.Sphere(centre, c.bounds.r + 1.5);
    const chunk = { standId: c.standId, tier: c.tier, centre, radius: c.bounds.r, near: [], mid: null, far: null, seats: null, count: c.count };
    const n = c.count;
    if (n) {
      // every person's matrix: turned to face the way their seat does, their own height and girth
      const mats = new Float32Array(n * 16);
      for (let i = 0; i < n; i++) {
        const x = c.inst[i * 6], y = c.inst[i * 6 + 1], z = c.inst[i * 6 + 2], th = Math.PI - c.inst[i * 6 + 3];
        const sx = c.inst[i * 6 + 4], sy = c.inst[i * 6 + 5], cs = Math.cos(th), sn = Math.sin(th), k = i * 16;
        mats[k] = cs * sx; mats[k + 2] = -sn * sx; mats[k + 5] = sy; mats[k + 8] = sn * sx; mats[k + 10] = cs * sx;
        mats[k + 12] = o.x + x; mats[k + 13] = o.y + z; mats[k + 14] = o.z - y; mats[k + 15] = 1;
      }
      const inst = (arr, size) => new THREE.InstancedBufferAttribute(arr, size);
      const all = { aCA: inst(c.ca, 4), aCB: inst(c.cb, 4), aCC: inst(c.cc, 4), aCD: inst(c.cd, 4) };
      const matrix = inst(mats, 16);
      // mid and far draw everyone, from the same instance buffers
      chunk.mid = this._mesh(this._figures.mid, this._materials.mid, n, matrix, all, sphere, `crowd:${c.standId}:${c.tier}:mid`);
      chunk.far = this._mesh(this._figures.far, this._materials.far, n, matrix, all, sphere, `crowd:${c.standId}:${c.tier}:far`);
      if (this._builtQuality !== 'low') {
        // near: the people of each variant
        const counts = new Array(FIGURE_VARIANTS.length).fill(0);
        for (let i = 0; i < n; i++) counts[c.variant[i]]++;
        FIGURE_VARIANTS.forEach((name, v) => {
          const m = counts[v];
          if (!m) return;
          const vm = new Float32Array(m * 16), va = new Float32Array(m * 4), vb = new Float32Array(m * 4), vc = new Float32Array(m * 4), vd = new Float32Array(m * 4);
          for (let i = 0, j = 0; i < n; i++) {
            if (c.variant[i] !== v) continue;
            vm.set(mats.subarray(i * 16, i * 16 + 16), j * 16);
            va.set(c.ca.subarray(i * 4, i * 4 + 4), j * 4); vb.set(c.cb.subarray(i * 4, i * 4 + 4), j * 4);
            vc.set(c.cc.subarray(i * 4, i * 4 + 4), j * 4); vd.set(c.cd.subarray(i * 4, i * 4 + 4), j * 4);
            j++;
          }
          chunk.near.push(this._mesh(this._figures.near[v], this._materials.near, m, inst(vm, 16), { aCA: inst(va, 4), aCB: inst(vb, 4), aCC: inst(vc, 4), aCD: inst(vd, 4) }, sphere, `crowd:${c.standId}:${c.tier}:near:${name}`));
        });
      }
    }
    if (c.seatCount) {
      const ns = c.seatCount, mats = new Float32Array(ns * 16), k0 = FAN_SCALE;
      for (let i = 0; i < ns; i++) {
        const th = Math.PI - c.seatPos[i * 4 + 3], cs = Math.cos(th), sn = Math.sin(th), k = i * 16;
        mats[k] = cs * k0; mats[k + 2] = -sn * k0; mats[k + 5] = k0; mats[k + 8] = sn * k0; mats[k + 10] = cs * k0;
        mats[k + 12] = o.x + c.seatPos[i * 4]; mats[k + 13] = o.y + c.seatPos[i * 4 + 2]; mats[k + 14] = o.z - c.seatPos[i * 4 + 1]; mats[k + 15] = 1;
      }
      const seat = this._mesh(this._figures.seat, this._materials.seats, ns, new THREE.InstancedBufferAttribute(mats, 16), {}, sphere, `crowd:${c.standId}:${c.tier}:seats`);
      seat.instanceColor = new THREE.InstancedBufferAttribute(c.seatCol, 3);
      chunk.seats = seat;
    }
    for (const m of [...chunk.near, chunk.mid, chunk.far, chunk.seats]) if (m) m.visible = false;
    this.chunks.push(chunk);
  }

  // A reaction. kind: 'cheer' | 'groan' | 'wave' | 'tense' | 'calm' | 'flash'; at { x, y }:
  // where on the course it happened (people near it answer hardest); intensity: 1 is full.
  // Returns false for a kind it does not know.
  react(kind, { at = null, intensity = 1, radiusM = null, startAngle = undefined } = {}) {
    return this.mood.react(kind, { at, intensity, radiusM, ...(startAngle === undefined ? {} : { startAngle }) }, this._t);
  }

  // Every frame: the mood into the shared uniforms, and which levels each CHUNK shows.
  update(t, camera) {
    this._t = t;
    const quality = this.quality() || 'high';
    if (this._stands && this._stands.length && this._builtQuality && (quality === 'low') !== (this._builtQuality === 'low')) {
      // low graphics is a different crowd (thinner, no figures up close): build it again
      const hidden = [...this._hidden];
      this.setStands(this._stands, this._opts);
      for (const id of hidden) this._hidden.add(id);
    }
    if (this._builtQuality) this._builtQuality = quality;
    const u = this.uniforms, m = this.mood.step(t), st = this.style ? this.style() : null;
    u.uCrowdTime.value = t;
    u.uCrowdMood.value.set(m.cheer, m.groan, m.tense, m.energy);
    u.uCrowdWave.value.set(m.waveAngle, m.waveAmp, 0, 0);
    this._o ||= this.V(0, 0, 0);
    u.uCrowdAt.value.set(this._o.x + m.at[0], this._o.z - m.at[1], m.atRadius || 90, m.atOn ? 1 : 0);
    u.uCrowdFx.value.set(quality === 'low' ? 0 : m.flash, st?.self ?? 0, (st?.emissive ?? 1) * (st?.night ? 2.2 : 1));
    const lodScale = camera ? crowdLodScale(camera.fov) : 1;
    u.uCrowdLod.value.set(crowdNearM(quality), CROWD_LOD.midM, CROWD_LOD.bandM, lodScale);
    const d = this._drawn;
    d.near = d.mid = d.far = d.seats = d.triangles = d.calls = 0;
    if (!camera) return;
    const cp = camera.position;
    for (const c of this.chunks) {
      const hidden = this._hidden.has(c.standId);
      const lod = pickLod(cp.distanceTo(c.centre), c.radius, lodScale, quality);
      for (const mesh of c.near) { mesh.visible = !hidden && lod.near; if (mesh.visible) { d.near += mesh.count; d.triangles += mesh.userData.triangles; d.calls++; } }
      if (c.mid) { c.mid.visible = !hidden && lod.mid; if (c.mid.visible) { d.mid += c.mid.count; d.triangles += c.mid.userData.triangles; d.calls++; } }
      if (c.far) { c.far.visible = !hidden && lod.far; if (c.far.visible) { d.far += c.far.count; d.triangles += c.far.userData.triangles; d.calls++; } }
      if (c.seats) { c.seats.visible = !hidden && lod.seats; if (c.seats.visible) { d.seats += c.seats.count; d.triangles += c.seats.userData.triangles; d.calls++; } }
    }
  }

  // a stand drawn as a ghost (the camera is inside it): its people are not drawn
  setHidden(id, hidden = true) {
    const key = String(id);
    if (hidden) this._hidden.add(key); else this._hidden.delete(key);
  }

  // people and seats on the stage, and what the last update() handed to the renderer:
  // instances per level and their triangles (an upper bound: a person another level draws
  // is collapsed in the vertex shader), before the camera's own frustum cull.
  stats() {
    return {
      people: this.plan ? this.plan.people : 0, seats: this.plan ? this.plan.seats : 0, chunks: this.chunks.length,
      drawn: { near: this._drawn.near, mid: this._drawn.mid, far: this._drawn.far, seats: this._drawn.seats }, triangles: this._drawn.triangles, calls: this._drawn.calls,
      quality: this._builtQuality,
    };
  }

  // everything off the stage (the figures and materials are kept for the next one)
  clear() {
    for (const c of this.chunks) {
      for (const m of [...c.near, c.mid, c.far, c.seats]) {
        if (!m) continue;
        this.group?.remove(m);
        m.geometry.dispose();
        m.dispose();
      }
    }
    this.chunks = [];
    this.plan = null;
    this._hidden.clear();
    if (this.group) { this.scene.remove(this.group); this.group = null; }
    const d = this._drawn;
    d.near = d.mid = d.far = d.seats = d.triangles = d.calls = 0;
  }

  dispose() {
    this.clear();
    this._stands = null;
    if (this._materials) for (const m of Object.values(this._materials)) m.dispose();
    if (this._figures) for (const g of [...this._figures.near, this._figures.mid, this._figures.far, this._figures.seat]) g.dispose();
    this._materials = this._figures = null;
  }
}
