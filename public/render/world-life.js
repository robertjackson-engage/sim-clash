// v3:living THE LIVING WORLD, the part with no renderer in it (docs/living-world.md).
//
// A stage says what lives in it as data, `course.life = [...]` (tools/arcade-holes/life/<id>.js,
// or `life` in the hole file), and public/render/world-events.js draws it. Everything here is
// pure: what an entry may say (LIFE_KINDS, normalizeLife, validateLife), where a mover is at a
// time t (deterministic: every player, and every capture, sees the same boat in the same
// place), what the graphics setting and the "World life" setting leave on (lifeBudget), and
// the REACTION BUS: which beat of the world answers which game event (shotReactions,
// matchReactions, reactionPlan) and the one-at-a-time rule (ReactionBus).
//
// Nothing in this file, or in the layer it feeds, changes where a ball goes: it is scenery.
//
// Coordinates are the course's (metres, x east, y north). A height is `lift` (metres above the
// ground or the water under the point) or `z` (absolute, the scene's own height, as a prop's z).

export const LIFE_MODES = Object.freeze(['full', 'calm', 'off']);
export const LIFE_MODE_KEY = 'sim-clash.world-life';
export const WORLD_CLOCK_KEY = 'sim-clash.world-clock';
export const parseLifeMode = (v) => (LIFE_MODES.includes(String(v ?? '').trim().toLowerCase()) ? String(v).trim().toLowerCase() : 'full');

export const PLAYER_COLORS = Object.freeze({ 1: '#ff5a36', 2: '#2e9bff' });   // public/arcade/match.js SLOT_COLORS

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, v) => { const k = clamp((v - a) / (b - a || 1e-9), 0, 1); return k * k * (3 - 2 * k); };
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const isPt = (p) => Array.isArray(p) && p.length >= 2 && fin(p[0]) && fin(p[1]);

// A repeatable number in [0, 1) from integers (and a seed): the same on every machine.
export function hash01(a, b = 0, c = 0) {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x165667b1, 0x85ebca6b) ^ Math.imul((c | 0) + 0x9e3779b9, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- the kinds
// shape   what places it: 'path' (a polyline), 'orbit' (a circle), 'point', 'area' (a disc),
//         'points' (a list of spots), 'stage' (the whole stage: weather)
// group   vehicle | creature | character | weather | set (a fixed piece that answers the game)
// tier    0: an essential, drawn even on Low graphics. 1: High and Ultra
// calm    kept in the "calm" setting (slow, far or still things; never weather, never a flock)
// air     it flies: it must keep clear of the line of play (validateLife, and at run time)
// white   small, pale and quick: could be taken for a ball, so never near the line of play
// n       default count; speed in m/s; lift in m
export const LIFE_KINDS = Object.freeze({
  // ---- vehicles and craft on paths
  boat:        { shape: 'path',  group: 'vehicle',   tier: 1, calm: true,  n: 1, speed: 2.4, loop: 'wrap', on: 'water' },
  gondola:     { shape: 'path',  group: 'vehicle',   tier: 1, calm: true,  n: 1, speed: 1.6, loop: 'wrap', on: 'water' },
  train:       { shape: 'path',  group: 'vehicle',   tier: 1, calm: true,  n: 5, speed: 16, loop: 'wrap', gapS: 14 },
  cars:        { shape: 'path',  group: 'vehicle',   tier: 1, calm: true,  n: 8, speed: 15, loop: 'wrap' },
  'traffic-light': { shape: 'points', group: 'vehicle', tier: 1, calm: true },
  'cable-car': { shape: 'path',  group: 'vehicle',   tier: 0, calm: true,  n: 4, speed: 3.2, loop: 'pingpong', lift: 14, air: true },
  groomer:     { shape: 'path',  group: 'vehicle',   tier: 1, calm: true,  n: 1, speed: 1.8, loop: 'pingpong' },
  caravan:     { shape: 'path',  group: 'vehicle',   tier: 1, calm: true,  n: 5, speed: 0.9, loop: 'wrap' },
  balloon:     { shape: 'path',  group: 'vehicle',   tier: 1, calm: true,  n: 1, speed: 1.6, loop: 'pingpong', lift: 80, air: true },
  airship:     { shape: 'orbit', group: 'vehicle',   tier: 0, calm: true,  n: 1, speed: 5, lift: 95, air: true },
  walkers:     { shape: 'path',  group: 'creature',  tier: 1, calm: true,  n: 10, speed: 1.15, loop: 'pingpong' },
  // ---- creatures
  flock:       { shape: 'orbit', group: 'creature',  tier: 0, calm: false, n: 9, speed: 7, lift: 34, air: true },
  perch:       { shape: 'points', group: 'creature', tier: 1, calm: true },
  fish:        { shape: 'area',  group: 'creature',  tier: 1, calm: true,  n: 3 },
  koi:         { shape: 'orbit', group: 'creature',  tier: 1, calm: true,  n: 6, speed: 0.5 },
  turtle:      { shape: 'point', group: 'creature',  tier: 1, calm: true },
  croc:        { shape: 'point', group: 'creature',  tier: 1, calm: true },
  dolphins:    { shape: 'path',  group: 'creature',  tier: 1, calm: true,  n: 3, speed: 5, loop: 'wrap', on: 'water' },
  whale:       { shape: 'point', group: 'creature',  tier: 1, calm: true },
  fireflies:   { shape: 'area',  group: 'creature',  tier: 1, calm: true,  n: 40 },
  butterflies: { shape: 'area',  group: 'creature',  tier: 1, calm: true,  n: 14 },
  // ---- the big characters and the pieces that answer the game
  dragon:      { shape: 'point', group: 'character', tier: 0, calm: true },
  volcano:     { shape: 'point', group: 'character', tier: 0, calm: true },
  mist:        { shape: 'point', group: 'character', tier: 1, calm: true },
  geyser:      { shape: 'point', group: 'character', tier: 1, calm: true },
  beam:        { shape: 'point', group: 'character', tier: 0, calm: true },
  windmill:    { shape: 'point', group: 'character', tier: 0, calm: true },
  windsock:    { shape: 'point', group: 'character', tier: 0, calm: true },
  pennants:    { shape: 'path',  group: 'set',       tier: 0, calm: true },
  searchlight: { shape: 'point', group: 'set',       tier: 1, calm: true },
  tumbleweed:  { shape: 'stage', group: 'set',       tier: 1, calm: false },   // a flag: a duff here rolls a tumbleweed (desert and canyon have it anyway)
  signature:   { shape: 'point', group: 'set',       tier: 0, calm: true },
  // ---- weather and the sky
  weather:     { shape: 'stage', group: 'weather',   tier: 0, calm: false },
  squall:      { shape: 'path',  group: 'weather',   tier: 1, calm: true,  n: 1, speed: 4, loop: 'pingpong' },
  'shooting-stars': { shape: 'stage', group: 'weather', tier: 1, calm: false },
});
export const WEATHER_TYPES = Object.freeze(['snow', 'ash', 'sand', 'mist', 'petals', 'rain']);
export const BIRD_SPECIES = Object.freeze({
  // white: pale birds read as a ball at a distance, so validateLife keeps them far from the line
  gull:   { color: '#eef2f6', span: 1.5, white: true },
  crow:   { color: '#20242c', span: 1.1 },
  parrot: { color: '#e23a2e', span: 1.0 },
  crane:  { color: '#d9dde4', span: 2.2, white: true },
  bat:    { color: '#2a1410', span: 1.0, bat: true },
  swift:  { color: '#3a4250', span: 0.8 },
});

// How far (m) a thing must keep from the tee-to-pin line. What flies below 60 m is kept
// further off than what walks; a pale bird furthest of all.
export const LINE_CLEAR_M = Object.freeze({ ground: 10, air: 28, white: 60, highM: 60 });

const distToSeg = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const k = l2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + dx * k), py - (ay + dy * k));
};

// One entry made regular: its kind's defaults filled in, its numbers finite. null for an
// entry nothing can be drawn from.
export function normalizeLifeEntry(e, i = 0) {
  if (!e || typeof e !== 'object') return null;
  const K = LIFE_KINDS[e.kind];
  if (!K) return null;
  const out = { ...e, kind: e.kind, id: typeof e.id === 'string' && e.id ? e.id : `${e.kind}-${i + 1}`, seed: Number.isInteger(e.seed) ? e.seed : i * 97 + 13 };
  if (K.shape === 'path') {
    if (!Array.isArray(e.path) || e.path.length < 2 || !e.path.every(isPt)) return null;
    out.path = e.path.map((p) => [p[0], p[1]]);
    out.loop = ['ring', 'wrap', 'pingpong'].includes(e.loop) ? e.loop : (K.loop || 'wrap');
  } else if (K.shape === 'orbit' || K.shape === 'area') {
    if (!fin(e.x) || !fin(e.y)) return null;
    out.r = fin(e.r) && e.r > 0 ? e.r : (K.shape === 'area' ? 10 : 40);
  } else if (K.shape === 'point') {
    if (!fin(e.x) || !fin(e.y)) return null;
  } else if (K.shape === 'points') {
    if (!Array.isArray(e.at) || !e.at.length || !e.at.every(isPt)) return null;
    out.at = e.at.map((p) => (fin(p[2]) ? [p[0], p[1], p[2]] : [p[0], p[1]]));
  }
  out.count = Number.isInteger(e.count) && e.count > 0 ? Math.min(e.count, 400) : (K.n || 1);
  out.speed = fin(e.speed) ? e.speed : (K.speed || 0);
  if (!fin(e.lift) && !fin(e.z) && fin(K.lift)) out.lift = K.lift;
  if (e.kind === 'weather' && !WEATHER_TYPES.includes(e.type)) return null;
  if ((e.kind === 'flock' || e.kind === 'perch') && !BIRD_SPECIES[e.species]) out.species = 'crow';
  return out;
}

export function normalizeLife(list) {
  if (!Array.isArray(list)) return [];
  return list.map((e, i) => normalizeLifeEntry(e, i)).filter(Boolean);
}

// What is wrong with a stage's life, as sentences (none: it is sound). hole: { tee, pin }.
// The rules a hole author has to keep:
//   - a known kind, a usable shape, a sane count;
//   - nothing that FLIES below 60 m comes within 28 m of the tee-to-pin line, and nothing
//     that walks, sails or stands within 10 m of it (a boat or a walker may CROSS the line of
//     play only with `crossing: true`, and then never within 45 m of the tee or the pin);
//   - a pale bird (gull, crane) never within 60 m of the line: it is the one thing in the
//     picture that could be taken for the ball;
//   - one `weather` a stage at most.
export function validateLife(list, hole = null) {
  const problems = [];
  if (list === undefined || list === null) return problems;
  if (!Array.isArray(list)) return ['life must be an array'];
  const tee = hole && isPt(hole.tee) ? hole.tee : null, pin = hole && isPt(hole.pin) ? hole.pin : null;
  let weather = 0;
  const ids = new Set();
  list.forEach((raw, i) => {
    const name = `life[${i}]${raw && raw.kind ? ` (${raw.kind})` : ''}`;
    if (!raw || typeof raw !== 'object') { problems.push(`${name}: not an object`); return; }
    if (!LIFE_KINDS[raw.kind]) { problems.push(`${name}: unknown kind '${raw.kind}'`); return; }
    const e = normalizeLifeEntry(raw, i);
    if (!e) { problems.push(`${name}: it has no usable ${LIFE_KINDS[raw.kind].shape}${raw.kind === 'weather' ? ` or its type is not one of ${WEATHER_TYPES.join(', ')}` : ''}`); return; }
    if (ids.has(e.id)) problems.push(`${name}: id '${e.id}' is used twice`);
    ids.add(e.id);
    if (raw.count !== undefined && !(Number.isInteger(raw.count) && raw.count > 0 && raw.count <= 400)) problems.push(`${name}: count must be a whole number from 1 to 400`);
    if (raw.speed !== undefined && !(fin(raw.speed) && Math.abs(raw.speed) <= 60 && (raw.speed >= 0 || LIFE_KINDS[raw.kind].shape === 'orbit'))) problems.push(`${name}: speed must be 0 to 60 m/s (something that circles may go the other way round: a negative speed)`);
    if (e.kind === 'weather' && ++weather > 1) problems.push(`${name}: a stage has one weather`);
    if ((raw.kind === 'flock' || raw.kind === 'perch') && raw.species !== undefined && !BIRD_SPECIES[raw.species]) problems.push(`${name}: unknown species '${raw.species}'`);
    if (!tee || !pin) return;
    const K = LIFE_KINDS[e.kind];
    if (K.shape === 'stage' || e.kind === 'signature') return;
    const high = (fin(e.lift) ? e.lift : 0) >= LINE_CLEAR_M.highM;
    const white = (e.kind === 'flock' || e.kind === 'perch') && BIRD_SPECIES[e.species]?.white;
    const need = white ? LINE_CLEAR_M.white : K.air ? (high ? 0 : LINE_CLEAR_M.air) : LINE_CLEAR_M.ground;
    if (!need) return;
    const reach = K.shape === 'orbit' || K.shape === 'area' ? e.r : 0;
    const pts = K.shape === 'path' ? e.path : K.shape === 'points' ? e.at : [[e.x, e.y]];
    let nearest = Infinity, nearEnd = Infinity;
    const probe = (x, y) => {
      nearest = Math.min(nearest, distToSeg(x, y, tee[0], tee[1], pin[0], pin[1]) - reach);
      nearEnd = Math.min(nearEnd, Math.hypot(x - tee[0], y - tee[1]) - reach, Math.hypot(x - pin[0], y - pin[1]) - reach);
    };
    if (K.shape === 'path') {
      for (let k = 0; k + 1 < pts.length; k++) {
        const n = Math.max(1, Math.ceil(Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]) / 6));
        for (let j = 0; j <= n; j++) probe(pts[k][0] + (pts[k + 1][0] - pts[k][0]) * j / n, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * j / n);
      }
    } else for (const p of pts) probe(p[0], p[1]);
    if (e.crossing === true && !K.air && !white) {
      if (nearEnd < 45) problems.push(`${name}: it crosses the line of play ${Math.round(nearEnd)} m from the tee or the pin (45 m at least)`);
    } else if (nearest < need) {
      problems.push(`${name}: it comes within ${Math.max(0, Math.round(nearest))} m of the line of play (${need} m at least${white ? ': a pale bird can be taken for the ball' : K.air ? ', or fly it at 60 m or more' : ', or say crossing: true'})`);
    }
  });
  return problems;
}

// ---------------------------------------------------------------- what is drawn
// The share of a stage's life the graphics level and the player's "World life" setting
// leave on. Low: the essentials (tier 0) and thin weather. calm: the slow and the far, no
// weather, no flocks; off: nothing (the stage is the set it was).
export function lifeBudget(quality = 'high', mode = 'full') {
  const q = quality === 'low' || quality === 'ultra' ? quality : 'high';
  const m = parseLifeMode(mode);
  if (m === 'off') return { on: false, tier: -1, calm: false, countMul: 0, weather: 0, particles: 0, bursts: 0, reactions: 'none' };
  const calm = m === 'calm';
  return {
    on: true,
    tier: q === 'low' ? 0 : 1,
    calm,
    countMul: q === 'low' ? 0.5 : q === 'ultra' ? 1.25 : 1,
    weather: calm ? 0 : q === 'low' ? 500 : q === 'ultra' ? 2600 : 1800,
    particles: q === 'low' ? 0.4 : 1,          // x an emitter's own count
    bursts: q === 'low' ? 48 : 96,             // sparks a burst
    reactions: calm ? 'key' : 'all',           // calm: only the hole and the match (REACTIONS[].key)
  };
}
export function lifeVisible(entry, budget) {
  const K = entry && LIFE_KINDS[entry.kind];
  if (!K || !budget || !budget.on) return false;
  if (K.tier > budget.tier) return false;
  if (budget.calm && !K.calm) return false;
  return true;
}
export const lifeCount = (entry, budget) => Math.max(1, Math.round((entry.count || 1) * (LIFE_KINDS[entry.kind].group === 'vehicle' || entry.kind === 'dolphins' ? 1 : budget.countMul)));

// ---------------------------------------------------------------- paths
// A polyline measured: { pts, at (metres along at each point), total, closed }.
export function measurePath(path, closed = false) {
  const pts = closed ? [...path, path[0]] : path.slice();
  const at = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, at, total: at[at.length - 1], closed };
}
// A path with points no further apart than stepM (so a mover's height follows the ground).
export function densifyPath(path, stepM = 8) {
  const out = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / stepM));
    for (let j = 1; j <= n; j++) out.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]);
  }
  return out;
}
// The point s metres along: { x, y, hx, hy (unit heading), i (segment), f (fraction of it) }.
export function pathAt(m, s) {
  const d = clamp(s, 0, m.total);
  let lo = 0, hi = m.at.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (m.at[mid] <= d) lo = mid; else hi = mid; }
  const a = m.pts[lo], b = m.pts[Math.min(lo + 1, m.pts.length - 1)];
  const len = m.at[Math.min(lo + 1, m.at.length - 1)] - m.at[lo];
  const f = len > 0 ? (d - m.at[lo]) / len : 0;
  const hl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, hx: (b[0] - a[0]) / hl, hy: (b[1] - a[1]) / hl, i: lo, f };
}

// Where copy i of a path mover is at time t (seconds): { x, y, hx, hy, i, f, vis } with vis
// 0 .. 1 (a `wrap` mover grows in at one end of its path and away at the other, and is out
// of sight for `gapS` between two crossings; the others are always there).
//   ring      a closed path, round and round
//   wrap      start to end, then again from the start
//   pingpong  there and back (it turns round at each end)
// Copies are spaced `spacingM` apart (default: evenly along the path; a train's cars nose to tail).
export function moverPose(m, entry, i, t) {
  const n = entry.count || 1;
  const loop = m.closed ? 'ring' : entry.loop;
  const speed = entry.speed || 0;
  const phase = (entry.phase || 0) * m.total;
  if (loop === 'ring') {
    const gap = fin(entry.spacingM) ? entry.spacingM : m.total / n;
    const s = (((speed * t + phase - i * gap) % m.total) + m.total) % m.total;
    return { ...pathAt(m, s), vis: 1 };
  }
  if (loop === 'pingpong') {
    const gap = fin(entry.spacingM) ? entry.spacingM : (2 * m.total) / n;
    const d = (((speed * t + phase + i * gap) % (2 * m.total)) + 2 * m.total) % (2 * m.total);
    const back = d > m.total;
    const p = pathAt(m, back ? 2 * m.total - d : d);
    if (back) { p.hx = -p.hx; p.hy = -p.hy; }
    return { ...p, back, vis: 1 };
  }
  // wrap: the run is the path plus a gap out of sight
  const gapM = Math.max(0, (entry.gapS || 0) * speed);
  const gap = fin(entry.spacingM) ? entry.spacingM : (m.total + gapM) / n;
  const run = m.total + gapM + (fin(entry.spacingM) ? (n - 1) * gap : 0);
  const s = (((speed * t + phase - i * gap) % run) + run) % run;
  const edge = Math.min(12, m.total * 0.08);
  const vis = s > m.total ? 0 : entry.fade === false ? 1 : Math.min(smooth(0, edge, s), 1 - smooth(m.total - edge, m.total, s));
  return { ...pathAt(m, Math.min(s, m.total)), vis };
}

// Something circling a point: { x, y, hx, hy } at radius r, `speed` m/s along the circle
// (negative: the other way round), copy i of n evenly round it.
export function orbitPose(entry, i, t, r = entry.r) {
  const n = entry.count || 1, w = (entry.speed || 0) / Math.max(1, r);
  const a = w * t + (entry.phase || 0) * TAU + (i / n) * TAU;
  const dir = w < 0 ? -1 : 1;
  return { x: entry.x + Math.sin(a) * r, y: entry.y + Math.cos(a) * r, hx: Math.cos(a) * dir, hy: -Math.sin(a) * dir, a };
}

// ---------------------------------------------------------------- birds
// The envelope of a scatter, `age` seconds after the fright: up at once, held, home by 7 s.
export const SCATTER_S = 7;
export function scatterEnvelope(age) {
  if (!(age >= 0) || age >= SCATTER_S) return 0;
  return smooth(0, 0.45, age) * (1 - smooth(3.2, SCATTER_S, age));
}
// Bird i of a wheeling flock: { x, y, lift, hx, hy, bank }. The flock turns about its
// point at radius r; each bird rides its own radius and height inside it. scatterAge: seconds
// since something frightened them (null: calm), away: unit vector the burst leans to (off the
// line of play).
export function flockPose(entry, i, t, scatterAge = null, away = null) {
  const n = entry.count || 1, seed = entry.seed || 0;
  const e = scatterAge === null ? 0 : scatterEnvelope(scatterAge);
  const r0 = entry.r * (0.55 + 0.45 * hash01(seed, i, 1));
  const r = r0 * (1 + 1.6 * e);
  const w = (entry.speed || 7) / Math.max(6, entry.r) * (0.8 + 0.4 * hash01(seed, i, 2));
  const a = w * t + (i / n) * TAU * 0.6 + hash01(seed, i, 3) * 1.4;
  const lift = (entry.lift ?? 34) + (hash01(seed, i, 4) - 0.5) * 8 + Math.sin(t * 0.5 + i) * 1.5 + 16 * e;
  const ox = away ? away[0] * 18 * e : 0, oy = away ? away[1] * 18 * e : 0;
  return { x: entry.x + Math.sin(a) * r + ox, y: entry.y + Math.cos(a) * r + oy, lift, hx: Math.cos(a), hy: -Math.sin(a), bank: 0.35 + 0.5 * e, flap: 1 };
}
// A perched bird: sitting (a head bob now and then), or, frightened, up and round and home.
export function perchPose(spot, i, t, scatterAge = null, away = null, seed = 0) {
  const e = scatterAge === null ? 0 : scatterEnvelope(scatterAge);
  if (e <= 0.001) {
    const hop = Math.max(0, Math.sin(t * 0.7 + i * 2.1 + seed) - 0.985) * 8;   // a little hop every nine seconds or so
    return { x: spot[0], y: spot[1], lift: hop, hx: Math.sin(i * 1.7 + seed), hy: Math.cos(i * 1.7 + seed), bank: 0, flap: 0 };
  }
  const a = scatterAge * 1.5 + i * 1.3, r = 9 * e;
  const ox = away ? away[0] * 10 * e : 0, oy = away ? away[1] * 10 * e : 0;
  return { x: spot[0] + Math.sin(a) * r + ox, y: spot[1] + Math.cos(a) * r + oy, lift: 7 * e, hx: Math.cos(a), hy: -Math.sin(a), bank: 0.5, flap: 1 };
}

// ---------------------------------------------------------------- fish, dolphins, a whale
export const FISH_JUMP_S = 0.95;
// Fish i of a pond: every `everyS` it leaps somewhere in the disc. { x, y, h, pitch, hx, hy, up }.
export function fishJump(entry, i, t) {
  const every = entry.everyS || 8, n = entry.count || 1;
  const tt = t + (i / n) * every + hash01(entry.seed || 0, i, 9) * every;
  const k = Math.floor(tt / every), u = (tt - k * every) / FISH_JUMP_S;
  if (u >= 1) return { up: false, k };
  const ang = hash01(entry.seed || 0, i, k) * TAU, rad = Math.sqrt(hash01(entry.seed || 0, k, i + 31)) * entry.r;
  const dir = hash01(entry.seed || 0, k + 5, i) * TAU, hx = Math.sin(dir), hy = Math.cos(dir);
  const top = entry.heightM || 1.1, travel = 1.7;
  return {
    up: true, k, u,
    x: entry.x + Math.sin(ang) * rad + hx * travel * (u - 0.5), y: entry.y + Math.cos(ang) * rad + hy * travel * (u - 0.5),
    h: 4 * top * u * (1 - u) - 0.15, pitch: Math.atan2(4 * top * (1 - 2 * u), travel), hx, hy,
  };
}
// A dolphin's leap along its path: height over the water and nose pitch at phase u (0 .. 1).
export function dolphinArc(u, top = 1.5) {
  const s = Math.sin(u * TAU);
  return { h: s > 0 ? s * top - 0.25 : -0.6, pitch: s > 0 ? Math.cos(u * TAU) * 0.9 : 0, up: s > 0.12 };
}
// A whale: every everyS it blows, then shows its flukes. { blow (true on the first 0.5 s), tail (0 .. 1) }.
export function whaleShow(entry, t) {
  const every = entry.everyS || 38, u = ((t + (entry.phase || 0) * every) % every + every) % every;
  return { blow: u < 0.5, tail: smooth(2.5, 4.2, u) * (1 - smooth(6, 8, u)), cycle: Math.floor((t + (entry.phase || 0) * every) / every) };
}

// A traffic light's lamp at time t: 'red' | 'amber' | 'green'.
export function trafficLight(t, i = 0, cycleS = 16) {
  const u = (((t + i * cycleS * 0.37) % cycleS) + cycleS) % cycleS / cycleS;
  return u < 0.45 ? 'green' : u < 0.55 ? 'amber' : 'red';
}

// How hard the hole's wind drives a sail, a sock or a string of flags: 0 (calm) to 1 (20 mph and up).
export const windDrive = (mph) => clamp((Number(mph) || 0) / 20, 0, 1);
// A windmill's turn rate (rad/s): it idles in a calm and spins up with the hole's wind.
export const windmillRate = (mph) => 0.12 + 1.5 * windDrive(mph);

// ---------------------------------------------------------------- the time of day in a tournament
// With the "world clock" option on, a best of 9 runs through one day: every hole a little
// later. Returns the time of day hole `index` (0-based) of `of` is played at, or null to
// leave the stage as its file says (the option is off by default; a theme that is only ever
// one time of day, like the neon city's night, ignores it in arcade-look.js).
export const WORLD_CLOCK = Object.freeze(['day', 'day', 'golden', 'dusk', 'night']);
export function worldClockTime(index, of = 9, on = false) {
  if (!on || !Number.isInteger(index) || index < 0) return null;
  const n = Math.max(2, of | 0);
  return WORLD_CLOCK[Math.min(WORLD_CLOCK.length - 1, Math.floor((index / (n - 1)) * (WORLD_CLOCK.length - 1) + 1e-9))];
}

// ---------------------------------------------------------------- the reaction bus
// A reaction is ONE beat of the world answering the game. priority: a higher one cuts in on
// a lower one; an equal or lower one arriving while a beat holds is dropped (never stacked).
// holdS: how long the beat owns the stage. key: kept in the calm setting. cue: the ONE sound
// it asks the mix for (public/arcade/audio.js cue(), guarded; a name the mix does not know is
// silent), null for a beat that is only seen. flash: it has a big flash of light, which
// prefers-reduced-motion takes out.
export const REACTIONS = Object.freeze({
  'rocket-launch': { priority: 2, holdS: 2.4, key: false, cue: 'world-shockwave', flash: true },
  'great-shot':    { priority: 2, holdS: 3.0, key: false, cue: 'world-flare', flash: false },
  holed:           { priority: 4, holdS: 5.5, key: true,  cue: 'world-celebration', flash: false },
  splash:          { priority: 1, holdS: 1.6, key: false, cue: 'world-snap', flash: false },
  lava:            { priority: 1, holdS: 1.8, key: false, cue: 'world-lava-burp', flash: false },
  duff:            { priority: 1, holdS: 3.2, key: false, cue: 'world-tumbleweed', flash: false },
  bad:             { priority: 1, holdS: 2.4, key: false, cue: null, flash: false },             // the gull laughs: seen, not heard
  snowman:         { priority: 1, holdS: 2.0, key: false, cue: 'world-snowman', flash: false },
  'hole-won':      { priority: 3, holdS: 3.0, key: true,  cue: null, flash: false },             // the match UI's fanfare is the sound
  knockout:        { priority: 4, holdS: 3.6, key: true,  cue: 'world-knockout', flash: true },
  'sudden-death':  { priority: 4, holdS: 3.4, key: true,  cue: 'world-lights-dip', flash: true },
  'match-over':    { priority: 5, holdS: 9.0, key: true,  cue: 'world-finale', flash: false },
});
// States, not beats: they change how the stage is dressed and take no turn on the bus.
export const REACTION_STATES = Object.freeze(['lead', 'scatter']);
export const REACTION_TYPES = Object.freeze([...Object.keys(REACTIONS), ...REACTION_STATES]);
// Every new cue name, for the sound stream (docs/living-world.md lists what each one is).
export const LIVING_CUES = Object.freeze([...new Set(Object.values(REACTIONS).map((r) => r.cue).filter(Boolean)), 'world-eruption', 'world-dragon-roar', 'world-fireworks', 'world-lights-flare']);

// One beat at a time. react() answers with the accepted beat, or null when it was dropped
// (and says why in `last`). The caller keeps time: `now` is seconds on any steady clock.
export class ReactionBus {
  constructor({ mode = () => 'full', reduced = () => false } = {}) {
    this.mode = mode;
    this.reduced = reduced;
    this.active = null;       // { type, priority, at, until }
    this.queue = [];          // [{ at (shot clock, s), type, opts }] a shot's beats, waiting for their frame
    this.last = null;         // { type, verdict: 'played' | 'busy' | 'off' | 'calm' | 'unknown' }
    this.played = 0;
  }

  react(type, opts = {}, now = 0) {
    const R = REACTIONS[type];
    const verdict = (v) => { this.last = { type, verdict: v, now }; return null; };
    if (!R) return verdict('unknown');
    const m = parseLifeMode(this.mode());
    if (m === 'off') return verdict('off');
    if (m === 'calm' && !R.key) return verdict('calm');
    if (this.active && now < this.active.until && R.priority <= this.active.priority) return verdict('busy');
    const cut = this.active && now < this.active.until ? this.active.type : null;
    const intensity = clamp(fin(opts.intensity) ? opts.intensity : 1, 0.2, 3);
    const beat = {
      type, priority: R.priority, at: now, until: now + (fin(opts.holdS) ? opts.holdS : R.holdS), cut,
      intensity: m === 'calm' ? Math.min(1, intensity) : intensity,
      playerSlot: opts.playerSlot === 1 || opts.playerSlot === 2 ? opts.playerSlot : 0,
      pos: opts.pos && fin(opts.pos.x) && fin(opts.pos.y) ? { x: opts.pos.x, y: opts.pos.y } : null,
      text: typeof opts.text === 'string' ? opts.text.slice(0, 40) : '',
      trail: Array.isArray(opts.trail) ? opts.trail : null,
      screen: opts.screen && typeof opts.screen === 'object' ? opts.screen : null,
      flash: R.flash && !this.reduced() && m !== 'calm',     // the big flash of light, when the player can take it
      cue: R.cue,
    };
    this.active = beat;
    this.played++;
    this.last = { type, verdict: 'played', now };
    return beat;
  }

  // A shot's beats, each on the shot clock (seconds from impact). A new shot drops the last one's.
  schedule(list) {
    this.queue = (Array.isArray(list) ? list : []).filter((b) => b && REACTION_TYPES.includes(b.type) && fin(b.at)).sort((a, b) => a.at - b.at);
  }
  // Those whose moment has come (clock: the shot clock now). The caller plays each through react().
  due(clock) {
    const out = [];
    while (this.queue.length && this.queue[0].at <= clock) out.push(this.queue.shift());
    return out;
  }
  idle(now) { return !this.active || now >= this.active.until; }
  reset() { this.active = null; this.queue = []; }
}

// ---------------------------------------------------------------- game events -> beats
export const DUFF_IDS = Object.freeze(['chunk', 'worm-burner']);
const HOLED_IDS = ['hole-in-one', 'holed-out', 'chip-in', 'drained', 'in-the-hole'];
export const CUP_HOLD_S = 0.8;           // public/arcade/feel.js: the hold on the cup after the drop
const CALLOUT_SLAM_S = 0.33;             // public/arcade/arcade.js TONE_HIT: the banner's slam lands this long after the ball stops
const ROCKET_BALLS = ['rocket'];
const GRADE_TONE = { JACKPOT: 'epic', PERFECT: 'good', GREAT: 'good' };

// The beats of one shot, each at the moment its cause is on screen (seconds on the shot's own
// clock, which public/arcade/feel.js has already re-timed for slow motion):
//   launch   a Rocket ball leaving the club                       -> rocket-launch
//   flight   the ball going through a snowman                     -> snowman
//   water    the ball into water, or lava on a volcano stage      -> splash | lava
//   stop     a holed ball, after the 0.8 s hold on the cup        -> holed
//            else an epic or a good callout (or grade)            -> great-shot
//            else a duffed one (CHUNK CITY!, WORM BURNER!)        -> duff
//            else a bad or a funny one                            -> bad
// A shot has one beat at the stop, never two: the first that applies, in that order.
// ctx: { theme, pin: { x, y }, snowmen: [{ x, y, r }], playerSlot, screen }.
export function shotReactions(shot, ctx = {}) {
  const sim = shot && shot.sim;
  const pts = sim && Array.isArray(sim.points) ? sim.points : [];
  if (!pts.length) return [];
  const out = [];
  const events = Array.isArray(sim.events) ? sim.events : [];
  const endS = fin(sim.playS) ? sim.playS : pts[pts.length - 1].t;
  const slot = ctx.playerSlot === 1 || ctx.playerSlot === 2 ? ctx.playerSlot : 0;
  const arc = shot.arcade || null;
  const callout = arc && arc.callout && typeof arc.callout === 'object' ? arc.callout : null;
  const ball = (arc && arc.powerup) || shot.freeBall || null;
  const last = pts[pts.length - 1];
  const flightS = fin(sim.flightTime) ? sim.flightTime : endS;

  if (ROCKET_BALLS.includes(ball) && !sim.isPutt) {
    // the ball's flight, a point every 0.7 s, for a stage that lights its path (the neon city)
    const trail = [];
    for (let t = 0.7; t < flightS - 0.3 && trail.length < 10; t += 0.7) {
      const p = pts.find((q) => q.t >= t);
      if (p) trail.push({ t: +p.t.toFixed(2), x: p.x, y: p.y, z: fin(p.z) ? p.z : 0 });
    }
    out.push({ type: 'rocket-launch', at: 0.1, intensity: 1.5, playerSlot: slot, pos: { x: pts[0].x, y: pts[0].y }, trail, holdS: ctx.theme === 'neon' ? Math.max(2.4, flightS) : undefined });
  }

  for (const sm of ctx.snowmen || []) {
    const hit = pts.find((p) => p.t <= flightS + 2 && Math.hypot(p.x - sm.x, p.y - sm.y) < (sm.r || 2.2) && (!fin(p.z) || !fin(sm.top) || p.z < sm.top + 0.6));
    if (hit) { out.push({ type: 'snowman', at: hit.t, intensity: 1, playerSlot: slot, pos: { x: sm.x, y: sm.y }, id: sm.id || null }); break; }
  }

  const wet = events.find((e) => e && e.type === 'water' && !e.skip);
  if (wet) {
    const t = fin(wet.t) ? wet.t : flightS;
    const p = fin(wet.x) && fin(wet.y) ? { x: wet.x, y: wet.y } : { x: last.x, y: last.y };
    out.push({ type: ctx.theme === 'volcano' ? 'lava' : 'splash', at: t + 0.12, intensity: 1, playerSlot: slot, pos: p });
  }

  const holed = events.some((e) => e && (e.type === 'holed' || e.type === 'cup-drop')) || fin(sim.cupDropT);
  // (BLAST OFF! is the launch's callout: at the stop the banner leads with the grade, so the beat does too)
  const said = callout && callout.id !== 'blast-off' ? callout : null;
  const tone = said ? said.tone : GRADE_TONE[arc && arc.grade] || null;
  if (holed) {
    const drop = fin(sim.cupDropT) ? sim.cupDropT : endS - CUP_HOLD_S;
    const at = sim.cup && fin(sim.cup.tEnd) ? sim.cup.tEnd : drop + CUP_HOLD_S;
    out.push({ type: 'holed', at, intensity: tone === 'epic' ? 2 : 1.3, playerSlot: slot, pos: ctx.pin || { x: last.x, y: last.y }, text: said ? said.text : 'IN THE HOLE!', screen: ctx.screen || null });
  } else if (!wet && callout && HOLED_IDS.includes(callout.id)) {
    // (a holed callout with no drop in the path: nothing to time a celebration to)
  } else if (!wet && (tone === 'epic' || tone === 'good')) {
    out.push({ type: 'great-shot', at: endS + CALLOUT_SLAM_S, intensity: tone === 'epic' ? 2 : 1, playerSlot: slot, pos: { x: last.x, y: last.y }, text: said ? said.text : (arc.grade === 'JACKPOT' ? 'JACKPOT!!!' : arc.grade === 'PERFECT' ? 'PERFECT SHOT!' : 'GREAT SHOT!') });
  } else if (!wet && callout && DUFF_IDS.includes(callout.id)) {
    out.push({ type: 'duff', at: endS + CALLOUT_SLAM_S, intensity: 1, playerSlot: slot, pos: { x: last.x, y: last.y } });
  } else if (!wet && callout && (callout.tone === 'bad' || callout.tone === 'funny')) {
    out.push({ type: 'bad', at: endS + CALLOUT_SLAM_S, intensity: 1, playerSlot: slot, pos: { x: last.x, y: last.y } });
  }
  return out.sort((a, b) => a.at - b.at);
}

// Where a flying ball frightens birds: the points of the path, thinned to one every `stepS`,
// as { t, x, y, z }. The layer scatters a flock the ball passes within its reach of.
export function flightSamples(shot, stepS = 0.35) {
  const pts = shot && shot.sim && Array.isArray(shot.sim.points) ? shot.sim.points : [];
  const out = [];
  let next = 0;
  for (const p of pts) if (p.t >= next) { out.push({ t: p.t, x: p.x, y: p.y, z: fin(p.z) ? p.z : 0 }); next = p.t + stepS; }
  if (pts.length && out[out.length - 1].t !== pts[pts.length - 1].t) { const p = pts[pts.length - 1]; out.push({ t: p.t, x: p.x, y: p.y, z: fin(p.z) ? p.z : 0 }); }
  return out;
}

const slotOf = (m, id) => {
  const ps = (m && m.players) || [];
  const i = ps.findIndex((p) => p && p.id === id);
  return i < 0 ? 0 : (ps[i].slot === 1 || ps[i].slot === 2 ? ps[i].slot : i + 1);
};
// Who leads the match: 1 | 2, or 0 while it is level (or there is no match).
export function matchLeader(m) {
  const ps = (m && !m.aborted && m.players) || [];
  if (ps.length < 2) return 0;
  const a = ps[0].holesWon || 0, b = ps[1].holesWon || 0;
  return a === b ? 0 : slotOf(m, (a > b ? ps[0] : ps[1]).id);
}
const matchKey = (m) => (m && !m.aborted ? `${m.id}|${m.phase}|${(m.holeResults || []).length}` : '');

// The beats of the match moving from `prev` to `next` (the server's match snapshots):
//   the SUDDEN DEATH intro, or the tiebreak beginning        -> sudden-death
//   a hole decided by knockout (or the stroke cap)            -> knockout   (the winner's colour)
//   a hole won any other way                                  -> hole-won   (the winner's colour)
//   the match decided                                         -> match-over (the winner's colour)
// and, whenever the lead changes hands, the state `lead` (banners and flags take the
// leader's colour; 0 gives them back). Nothing for a repeat of the same snapshot.
export function matchReactions(prev, next) {
  const out = [];
  const key = matchKey(next);
  if (key === matchKey(prev)) return out;
  const lead = matchLeader(next);
  if (lead !== matchLeader(prev) || !key) out.push({ type: 'lead', playerSlot: lead });
  if (!key) return out;
  const stage = next.stage || next.nextStage || null;
  const wasSudden = prev && !prev.aborted && prev.id === next.id && (prev.phase === 'tiebreak' || (prev.phase === 'intro' && (prev.stage || prev.nextStage || {}).kind === 'tiebreak'));
  if (next.phase === 'intro' && stage && stage.kind === 'tiebreak') out.push({ type: 'sudden-death', delayS: 2.5, intensity: 1.5 });
  else if (next.phase === 'tiebreak' && !wasSudden) out.push({ type: 'sudden-death', intensity: 1.5 });
  else if (next.phase === 'done' && next.winnerId) out.push({ type: 'match-over', playerSlot: slotOf(next, next.winnerId), intensity: 2 });
  else if (next.phase === 'hole-result') {
    const r = (next.holeResults || [])[(next.holeResults || []).length - 1];
    if (r && r.winnerId) out.push({ type: r.reason === 'knockout' || r.reason === 'cap' ? 'knockout' : 'hole-won', playerSlot: slotOf(next, r.winnerId), intensity: r.reason === 'knockout' ? 1.6 : 1.2 });
  }
  return out;
}

// ---------------------------------------------------------------- beats -> what the stage does
// What a beat sets off on a stage, as steps the layer plays: [{ fx, ... }], in order, each
// `delay` seconds into the beat. stage: { theme, night, has: Set of life kinds on it,
// stadium: it has the stadium stream's cannons }. This is the reaction map of
// docs/living-world.md, and what test/living-world.test.mjs holds it to.
//   fx: 'erupt' | 'shockwave' | 'scatter' | 'trail-fireworks' | 'fireworks' | 'flares' |
//       'dragon-roar' | 'dragon-snort' | 'sign' | 'searchlights' | 'confetti' | 'screen' |
//       'fish' | 'croc' | 'ice' | 'lava-burp' | 'snowman' | 'laugh' | 'tumbleweed' | 'startle' |
//       'colours' | 'lights-dip' | 'lights-flare' | 'finale'
export function reactionPlan(type, stage = {}) {
  const has = (k) => !!(stage.has && stage.has.has(k));
  const theme = stage.theme || 'tropical';
  const steps = [];
  const add = (fx, extra = {}) => steps.push({ fx, delay: 0, ...extra });
  switch (type) {
    case 'rocket-launch':
      add('shockwave');
      add('scatter', { all: true, delay: 0.15 });
      if (has('volcano')) add('erupt', { delay: 0.25, big: true });
      else if (has('dragon')) add('dragon-snort', { delay: 0.3 });
      if (theme === 'neon' || theme === 'stadium') add('trail-fireworks', { delay: 0.5 });
      break;
    case 'great-shot':
      if (has('dragon')) add('dragon-roar');
      else if (has('volcano')) add('erupt', { big: false });
      else add(stage.night ? 'fireworks' : 'flares', { from: 'signature' });
      if (has('airship')) add('sign');
      if (has('searchlight')) add('searchlights', { delay: 0.1 });
      break;
    case 'holed':
      add('fireworks', { from: 'green', count: 5 });
      add('confetti', { from: 'green', stadium: !!stage.stadium });
      add('scatter', { all: true, delay: 0.1 });
      if (has('dragon')) add('dragon-roar', { delay: 0.5 });
      if (has('airship')) add('sign');
      if (has('searchlight')) add('searchlights');
      add('screen');
      break;
    case 'splash':
      add(theme === 'alpine' ? 'ice' : has('croc') ? 'croc' : 'fish');     // (an alpine stage's water is ice: chips fly, no fish)
      add('scatter', { near: true, delay: 0.1 });
      break;
    case 'lava':
      add('lava-burp');
      break;
    case 'snowman':
      add('snowman');
      break;
    case 'duff':
      add(theme === 'desert' || theme === 'canyon' || has('tumbleweed') ? 'tumbleweed' : 'laugh');
      break;
    case 'bad':
      add(has('perch') ? 'laugh' : 'startle');
      break;
    case 'hole-won':
      add('colours');
      add('flares', { from: 'green', delay: 0.2 });
      break;
    case 'knockout':
      add('colours');
      add(has('dragon') ? 'dragon-roar' : has('volcano') ? 'erupt' : 'fireworks', { from: 'signature', big: true, count: 4 });
      if (has('searchlight')) add('searchlights', { delay: 0.1 });
      break;
    case 'sudden-death':
      add('lights-dip');
      add('lights-flare', { delay: 1.5 });
      add('scatter', { all: true, delay: 1.5 });
      if (has('searchlight')) add('searchlights', { delay: 1.5 });
      break;
    case 'match-over':
      add('colours');
      add('finale');
      if (has('dragon')) add('dragon-roar', { delay: 0.8 });
      if (has('airship')) add('sign');
      add('screen');
      break;
    default:
      break;
  }
  return steps;
}

// The ONE sound a beat asks for (a name for public/arcade/audio.js cue(); the mix decides the
// rest): the loudest thing the stage does in it. Nothing for a beat that is only seen.
export function beatCue(type, steps = []) {
  const R = REACTIONS[type];
  if (!R || !R.cue) return null;
  const fx = new Set(steps.map((x) => x.fx));
  if (fx.has('dragon-roar')) return 'world-dragon-roar';
  if (fx.has('erupt')) return 'world-eruption';
  if (type === 'great-shot' && fx.has('fireworks')) return 'world-fireworks';
  return R.cue;
}

// A player's colour softened for a sky full of it (fireworks alternate it with white and gold).
export const beatColors = (slot) => (slot === 1 ? ['#ff5a36', '#ffb38a', '#ffd21f'] : slot === 2 ? ['#2e9bff', '#9fd6ff', '#ffd21f'] : ['#ffd21f', '#ffffff', '#ff7ad1', '#5fe6ff']);
