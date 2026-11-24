'use strict';
// Course gadgets (v3:gadgets): interactive pieces placed on the arcade stages that a real
// swing can hit. Rings that boost a ball, pads that throw it back into the air, strips that
// run it on, fans, geysers, bumpers, rails, backboards, funnels, ice, mud, warp pipes and
// cannons, breakable walls, coin trails and multiplier rings. docs/gadgets.md is the guide.
//
// This module is the pure part, shared by the hole builder (tools/arcade-holes/lib.js: the
// data and its validation), the physics (lib/physics.js simulateShot: opts.gadgets is a
// field made here), the game (lib/game.js), the lineup (lib/predict.js) and the arcade
// economy (lib/arcade.js: coins, points, callouts).
//
// THE RULES every gadget keeps:
//   - deterministic. The whole shot is simulated on the server at impact, so nothing here
//     is random and nothing depends on wall time: the same swing meets the same gadgets
//     with the same result, for both players and on every client. A geyser's cycle is
//     keyed to the shot's own time zero.
//   - stateless between shots. A wall that was smashed stands again for the next swing:
//     both players of a match face the same course, and an undo or a restart has nothing
//     to put back.
//   - a putt is never touched (the putting assist solves the putt it then plays).
//   - no ball is trapped: a solid within 12 m of where the ball is struck is air for that shot.
//   - every contact is in the shot's event list ({ type: 'gadget', id, kind, t, x, y, z,
//     effect, ... }) with its time, so the client animates and sounds it in sync.
//
// Coordinates: x east, y north, z up (metres, the elevation grid's datum). A heading is a
// compass bearing in degrees (0 north, 90 east), as an aim is.

const RAD = Math.PI / 180;
const MPH = 0.44704;
const BALL_R = 0.02135;

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const fin = Number.isFinite;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------- the kinds
// What each kind is, the numbers it takes (with the range a hole may give them and the
// default), and where it may stand. `solid`: a Ghost ball passes through it and it may not
// stand in the SAFE route. `ground`: it lies on the ground (no z). `on`: surfaces it may
// stand on beyond rough / fairway ('green', 'tee', 'water', 'bunker').
const num = (min, max, dflt) => Object.freeze({ min, max, dflt });
const KINDS = Object.freeze({
  // a hoop in the air: a ball through it flies on faster
  ring: Object.freeze({
    label: 'Boost ring', solid: false, ground: false, air: true, on: ['water', 'bunker', 'green', 'tee'],
    fields: { radius: num(3, 20, 8), strength: num(1.05, 1.6, 1.25) }, need: ['heading'], reward: { coins: 25, points: 50 },
  }),
  // a pad on the ground: a ball landing or rolling on it is thrown back into the air
  pad: Object.freeze({
    label: 'Bounce pad', solid: false, ground: true, on: ['bunker'],
    fields: { radius: num(2, 12, 5), angle: num(20, 80, 50), strength: num(0.5, 1.6, 1), minMps: num(6, 40, 16), maxMps: num(10, 70, 45) }, reward: { coins: 10, points: 0 },
  }),
  // a strip of fairway that runs a rolling ball on along the strip's heading
  strip: Object.freeze({
    label: 'Speed strip', solid: false, ground: true, on: [], rect: true,
    fields: { strength: num(2, 15, 7), maxMps: num(3, 40, 24) }, need: ['heading', 'size'], reward: { coins: 10, points: 0 },
  }),
  // a volume of moving air: pushes the ball along its heading (and up, with lift) while inside
  fan: Object.freeze({
    label: 'Wind tunnel', solid: false, ground: false, on: ['water', 'bunker'], box: true,
    fields: { strength: num(0, 30, 14), lift: num(0, 40, 0) }, need: ['heading', 'size'], reward: { coins: 0, points: 0 },
  }),
  // a vent that erupts on a fixed cycle from the shot's time zero: a ball over it when it fires is thrown up
  geyser: Object.freeze({
    label: 'Geyser', solid: false, ground: true, on: ['bunker', 'water'],
    fields: { radius: num(2, 12, 5), height: num(10, 80, 40), strength: num(10, 40, 24), cycle: num(2, 12, 4), offset: num(0, 12, 2), burst: num(0.5, 6, 1.5) }, reward: { coins: 15, points: 0 },
  }),
  // a pinball post: kicks the ball away hard
  bumper: Object.freeze({
    label: 'Bumper', solid: true, ground: true, on: ['bunker'],
    fields: { radius: num(0.8, 4, 1.6), height: num(1.5, 8, 3.5), strength: num(4, 28, 16) }, reward: { coins: 5, points: 0 },
  }),
  // a curved rail: a low wall along a line that kicks the ball back
  rail: Object.freeze({
    label: 'Rail', solid: true, ground: true, on: ['bunker'], line: true,
    fields: { radius: num(0.3, 2, 0.7), height: num(0.8, 4, 1.6), strength: num(4, 24, 12) }, need: ['points'], reward: { coins: 5, points: 0 },
  }),
  // a wall that takes the pace off a ball and drops it at its foot
  backboard: Object.freeze({
    label: 'Backboard', solid: true, ground: true, on: ['bunker'], wall: true,
    fields: { strength: num(0.05, 0.8, 0.3) }, need: ['heading', 'size'], reward: { coins: 0, points: 0 },
  }),
  // a bowl in the ground: a rolling ball is drawn to its middle
  funnel: Object.freeze({
    label: 'Funnel', solid: false, ground: true, on: ['green', 'bunker'],
    fields: { radius: num(4, 20, 9), strength: num(0.3, 3, 1.2) }, reward: { coins: 0, points: 0 },
  }),
  // very low friction: a long slide
  ice: Object.freeze({
    label: 'Ice patch', solid: false, ground: true, on: ['bunker'], zone: true,
    fields: { friction: num(0.1, 1, 0.3) }, reward: { coins: 0, points: 0 },
  }),
  // stops the ball dead
  mud: Object.freeze({
    label: 'Sticky mud', solid: false, ground: true, on: ['bunker'], zone: true,
    fields: {}, reward: { coins: 0, points: 0 },
  }),
  // the mouth of a pipe or a cannon: a ball entering it is fired from its paired exit
  warp: Object.freeze({
    label: 'Warp', solid: false, ground: false, on: ['bunker', 'water'],
    fields: { radius: num(1.5, 8, 3), delay: num(0.2, 2, 0.7) }, need: ['pair'], reward: { coins: 20, points: 50 },
  }),
  // where a warp fires the ball from, and on what trajectory
  'warp-exit': Object.freeze({
    label: 'Warp exit', solid: false, ground: false, on: ['bunker', 'water'],
    fields: { angle: num(5, 80, 45), speedMph: num(10, 220, 90) }, need: ['heading'], reward: { coins: 0, points: 0 },
  }),
  // a crate, an ice wall, a snowman, a pinata: a fast ball smashes through, a slow one bounces off
  breakable: Object.freeze({
    label: 'Breakable', solid: true, ground: false, on: ['bunker', 'water'],
    fields: { breakMph: num(30, 220, 120), keep: num(0.5, 1, 0.85) }, reward: { coins: 50, points: 100 },
  }),
  // coins hung along a flight line
  coins: Object.freeze({
    label: 'Coin trail', solid: false, ground: false, air: true, on: ['green', 'tee', 'water', 'bunker'], cosmetic: true,
    fields: { reach: num(2, 10, 5) }, need: ['points'], reward: { coins: 5, points: 0, bonusCoins: 50, bonusPoints: 150 },
  }),
  // a landing ring on the ground: the shot's points are multiplied
  zone: Object.freeze({
    label: 'Multiplier', solid: false, ground: true, on: ['green', 'bunker'],
    fields: { radius: num(4, 25, 10), mult: num(2, 3, 2) }, reward: { coins: 0, points: 0 },
  }),
});
const KIND_IDS = Object.freeze(Object.keys(KINDS));
const BREAK_STYLES = Object.freeze(['wall', 'crate', 'ice-wall', 'snowman', 'pinata']);
const WARP_STYLES = Object.freeze(['pipe', 'cannon']);
const MAX_GADGETS = 40;
const MAX_BUMPS = 8;            // contacts with solids in one shot: past this they are air (no endless pinball)
const WALL_KEEP = 0.7;          // tangential speed kept off a backboard or an unbroken wall
const WALL_BOUNCE = 0.45;       // restitution of a breakable that did not break
const FREE_M = 12;              // a solid within this of where the ball is struck is air for that shot: no ball is ever trapped behind one
const BREAK_MIN_MPS = 4;        // a ball trickling into a wall never breaks it, whatever it was launched at
const KICK_MAX_MPS = 34;
const ICE_TURF = Object.freeze({ e: 0.45, keep: 0.85, spinBite: 0 });
const MUD_TURF = Object.freeze({ e: 0, keep: 0, roll: 60, spinBite: 0 });   // 60 m/s^2: a ball rolling into mud stops inside a metre
const FUNNEL_REST_M = 2;        // inside this of a funnel's middle the pull fades to nothing: the ball can rest
const WARP_SPIN_RPM = 3000;     // the backspin a warp fires a ball with
const GEYSER_KEEP = 0.6;        // horizontal speed a ball thrown by a geyser keeps

// ---------------------------------------------------------------- the data
const isPt = (p) => Array.isArray(p) && p.length >= 2 && fin(p[0]) && fin(p[1]);

/**
 * Check a gadget list and fill in the defaults. Never throws.
 * @param {Array} list  what a hole file or a course carries
 * @returns {{ gadgets: object[], problems: string[] }} the sound gadgets, tidied (numbers
 *   to a centimetre, defaults filled in, nothing a kind does not use), and what is wrong
 *   with the rest. A gadget in the air keeps `z` (the datum's) or `alt` (above the ground at
 *   its x, y: resolveGadgets turns it into z).
 */
function normalizeGadgets(list) {
  const problems = [], gadgets = [];
  if (list == null) return { gadgets, problems };
  if (!Array.isArray(list)) return { gadgets, problems: ['gadgets must be an array'] };
  if (list.length > MAX_GADGETS) problems.push(`there are ${list.length} gadgets (at most ${MAX_GADGETS})`);
  const ids = new Set();
  for (const [i, raw] of list.entries()) {
    const label = raw && typeof raw.id === 'string' && raw.id ? `gadget ${raw.id}` : `gadget ${i + 1}`;
    const bad = [];
    if (!raw || typeof raw !== 'object') { problems.push(`${label} must be an object`); continue; }
    const K = KINDS[raw.kind];
    if (!K) { problems.push(`${label}: kind must be one of ${KIND_IDS.join(', ')}`); continue; }
    if (typeof raw.id !== 'string' || !raw.id.trim()) bad.push('id is missing');
    else if (ids.has(raw.id)) bad.push('its id is used twice');
    const g = { id: String(raw.id || '').trim(), kind: raw.kind };
    const range = (key, { min, max, dflt }) => {
      const v = raw[key];
      if (v === undefined || v === null) { g[key] = dflt; return; }
      if (!fin(v) || v < min || v > max) { bad.push(`${key} must be ${min} to ${max}`); return; }
      g[key] = r2(v);
    };
    // where it is
    if (K.line || raw.kind === 'coins') {
      const need = raw.kind === 'coins' ? 3 : 2, dims = raw.kind === 'coins' ? 3 : 2;
      const pts = Array.isArray(raw.points) ? raw.points : null;
      if (!pts || pts.length < need || !pts.every((p) => isPt(p) && (dims === 2 || fin(p[2])))) bad.push(`points must be ${need}+ of [x, y${dims === 3 ? ', z' : ''}]`);
      else {
        g.points = pts.map((p) => (dims === 3 ? [r2(p[0]), r2(p[1]), r2(p[2])] : [r2(p[0]), r2(p[1])]));
        if (pts.length > 60) bad.push('points: at most 60');
        g.x = g.points[0][0]; g.y = g.points[0][1];
      }
    } else if (!fin(raw.x) || !fin(raw.y)) bad.push('x and y must be numbers');
    else { g.x = r2(raw.x); g.y = r2(raw.y); }
    if (!K.ground && raw.kind !== 'coins') {
      if (fin(raw.z)) g.z = r2(raw.z);
      else if (fin(raw.alt) && raw.alt >= 0 && raw.alt <= 200) g.alt = r2(raw.alt);
      else if (raw.z !== undefined || raw.alt !== undefined) bad.push('z (or alt, metres above the ground) must be a number');
      else if (K.air) bad.push('needs z, or alt (metres above the ground)');
    }
    if ((K.need || []).includes('heading') || raw.heading !== undefined) {
      if (!fin(raw.heading)) bad.push('heading must be a compass bearing in degrees');
      else g.heading = r2(((raw.heading % 360) + 360) % 360);
    }
    for (const [key, spec] of Object.entries(K.fields)) range(key, spec);
    // its size
    const pair = (lims, what) => {
      const s = raw.size;
      if (!Array.isArray(s) || s.length < lims.length || !lims.every(([lo, hi], k) => fin(s[k]) && s[k] >= lo && s[k] <= hi)) {
        bad.push(`size must be [${what}] in metres (${lims.map(([lo, hi]) => `${lo} to ${hi}`).join(', ')})`);
        return;
      }
      g.size = lims.map((_, k) => r2(s[k]));
    };
    if (K.rect) pair([[4, 40], [8, 140]], 'width, length');
    else if (K.box) pair([[6, 80], [6, 160], [6, 100]], 'width, length, height');
    else if (K.wall) pair([[4, 60], [2, 20]], 'width, height');
    else if (K.zone) {
      if (raw.size !== undefined) {
        pair([[4, 120], [4, 160]], 'width, length');
        if (!fin(raw.heading)) bad.push('a rectangular zone needs a heading'); else g.heading = r2(((raw.heading % 360) + 360) % 360);
      } else range('radius', num(2, 60, raw.kind === 'ice' ? 14 : 8));
    } else if (raw.kind === 'breakable') {
      g.style = BREAK_STYLES.includes(raw.style) ? raw.style : (raw.style === undefined ? 'wall' : null);
      if (!g.style) bad.push(`style must be one of ${BREAK_STYLES.join(', ')}`);
      if (raw.size !== undefined) {
        pair([[3, 80], [2, 40]], 'width, height');
        if (!fin(raw.heading)) bad.push('a wall needs a heading (the way it faces)'); else g.heading = r2(((raw.heading % 360) + 360) % 360);
      } else {
        range('radius', num(1, 8, 2.5));
        range('height', num(1.5, 14, 4));
      }
    }
    if (raw.kind === 'warp' || raw.kind === 'warp-exit') {
      g.style = WARP_STYLES.includes(raw.style) ? raw.style : (raw.style === undefined ? 'pipe' : null);
      if (!g.style) bad.push(`style must be one of ${WARP_STYLES.join(', ')}`);
    }
    if (raw.kind === 'warp') {
      if (typeof raw.pair !== 'string' || !raw.pair) bad.push('pair must name its warp-exit');
      else g.pair = raw.pair;
    }
    if (raw.kind === 'zone' && g.mult !== 2 && g.mult !== 3) bad.push('mult must be 2 or 3');
    if (raw.kind === 'geyser' && fin(g.cycle) && fin(g.burst) && fin(g.offset)) {
      if (g.burst > g.cycle - 0.5) bad.push('burst must leave half a second of the cycle quiet');
      if (g.offset > g.cycle) bad.push('offset must be within one cycle');
    }
    if (raw.kind === 'pad' && fin(g.minMps) && fin(g.maxMps) && g.minMps > g.maxMps) bad.push('minMps must not be over maxMps');
    if (raw.kind === 'fan' && !(g.strength > 0 || g.lift > 0)) bad.push('needs a strength or a lift');
    // what it pays (the kind's own, unless the hole says otherwise)
    const pay = { ...K.reward };
    if (raw.reward !== undefined) {
      if (!raw.reward || typeof raw.reward !== 'object') bad.push('reward must be { coins, points }');
      else for (const key of Object.keys(pay)) {
        if (raw.reward[key] === undefined) continue;
        if (!Number.isInteger(raw.reward[key]) || raw.reward[key] < 0 || raw.reward[key] > 1000) bad.push(`reward.${key} must be a whole number 0 to 1000`);
        else pay[key] = raw.reward[key];
      }
    }
    if (Object.values(pay).some((v) => v > 0)) g.reward = Object.fromEntries(Object.entries(pay).filter(([, v]) => v > 0));
    if (typeof raw.note === 'string' && raw.note.trim()) g.note = raw.note.trim().slice(0, 80);
    if (bad.length) { problems.push(`${label} (${raw.kind}): ${bad.join('; ')}`); continue; }
    ids.add(g.id);
    gadgets.push(g);
  }
  // a warp fires from its exit; an exit belongs to a warp
  const byId = new Map(gadgets.map((g) => [g.id, g]));
  const fed = new Set();
  for (const g of gadgets) {
    if (g.kind !== 'warp') continue;
    const exit = byId.get(g.pair);
    if (!exit || exit.kind !== 'warp-exit') problems.push(`gadget ${g.id} (warp): its pair '${g.pair}' is not a warp-exit`);
    else fed.add(exit.id);
  }
  for (const g of gadgets) if (g.kind === 'warp-exit' && !fed.has(g.id)) problems.push(`gadget ${g.id} (warp-exit): no warp fires from it`);
  const sound = gadgets.filter((g) => !(g.kind === 'warp' && !(byId.get(g.pair) && byId.get(g.pair).kind === 'warp-exit')) && !(g.kind === 'warp-exit' && !fed.has(g.id)));
  return { gadgets: sound, problems };
}

/** alt (metres above the ground at x, y) -> z, in the terrain's datum. Returns new gadgets. */
function resolveGadgets(gadgets, terrain) {
  return gadgets.map((g) => {
    if (!fin(g.alt)) return g;
    const { alt, ...rest } = g;
    return { ...rest, z: r2(terrain.h(g.x, g.y) + alt) };
  });
}

// The circle a gadget stands or acts in, on the map: { x, y, r }.
function footprint(g) {
  if (g.points) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of g.points) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, r: Math.hypot(x1 - x0, y1 - y0) / 2 + (g.radius || g.reach || 0) };
  }
  if (g.size) return { x: g.x, y: g.y, r: Math.hypot(g.size[0], KINDS[g.kind].wall || g.kind === 'breakable' ? 1 : g.size[1]) / 2 };
  return { x: g.x, y: g.y, r: g.radius || 1 };
}

// The points of a gadget's outline on the ground (for the maps and the validation): a
// closed ring for a zone, a pad or a strip; the line of a wall or a rail.
function outline(g, n = 24) {
  if (g.kind === 'rail') return { closed: false, points: g.points.map((p) => [p[0], p[1]]) };
  if (g.kind === 'coins') return { closed: false, points: g.points.map((p) => [p[0], p[1]]) };
  const d = fin(g.heading) ? { x: Math.sin(g.heading * RAD), y: Math.cos(g.heading * RAD) } : { x: 0, y: 1 };
  const rt = { x: d.y, y: -d.x };
  if (g.size && (KINDS[g.kind].wall || g.kind === 'breakable')) {
    const h = g.size[0] / 2;
    return { closed: false, points: [[g.x - rt.x * h, g.y - rt.y * h], [g.x + rt.x * h, g.y + rt.y * h]] };
  }
  if (g.kind === 'ring') return { closed: false, points: [[g.x - rt.x * g.radius, g.y - rt.y * g.radius], [g.x + rt.x * g.radius, g.y + rt.y * g.radius]] };
  if (g.size) {
    const w = g.size[0] / 2, l = g.size[1] / 2;
    return { closed: true, points: [[-w, -l], [w, -l], [w, l], [-w, l]].map(([a, b]) => [g.x + rt.x * a + d.x * b, g.y + rt.y * a + d.y * b]) };
  }
  const r = g.radius || 1.5, pts = [];
  for (let k = 0; k < n; k++) pts.push([g.x + r * Math.cos((k / n) * 2 * Math.PI), g.y + r * Math.sin((k / n) * 2 * Math.PI)]);
  return { closed: true, points: pts };
}

// ---------------------------------------------------------------- the field (physics)
// One per course and terrain: the gadgets with what the step loop needs worked out once.
function prepare(g, terrain, byId) {
  const ground = terrain.h(g.x, g.y);
  const p = { g, id: g.id, kind: g.kind, x: g.x, y: g.y, ground, K: KINDS[g.kind], reward: g.reward || {} };
  if (fin(g.heading)) { p.dx = Math.sin(g.heading * RAD); p.dy = Math.cos(g.heading * RAD); }
  switch (g.kind) {
    case 'ring': p.z = g.z; p.r = g.radius; break;
    case 'pad': p.r = g.radius; p.sin = Math.sin(g.angle * RAD); p.cos = Math.cos(g.angle * RAD); break;
    case 'strip': p.hw = g.size[0] / 2; p.hl = g.size[1] / 2; p.reach = Math.hypot(p.hw, p.hl); break;
    case 'fan': p.hw = g.size[0] / 2; p.hl = g.size[1] / 2; p.top = (fin(g.z) ? g.z : ground) + g.size[2]; p.reach = Math.hypot(p.hw, p.hl); break;
    case 'geyser': p.r = g.radius; p.top = ground + g.height; break;
    case 'bumper': p.r = g.radius; p.top = ground + g.height; p.base = -Infinity; break;
    case 'rail': {
      p.segs = [];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i + 1 < g.points.length; i++) p.segs.push([g.points[i][0], g.points[i][1], g.points[i + 1][0], g.points[i + 1][1]]);
      for (const q of g.points) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
      p.box = [x0 - g.radius - 1, y0 - g.radius - 1, x1 + g.radius + 1, y1 + g.radius + 1];
      p.r = g.radius;
      break;
    }
    case 'backboard': p.hw = g.size[0] / 2; p.top = ground + g.size[1]; p.base = -Infinity; break;
    case 'funnel': p.r = g.radius; break;
    case 'ice': case 'mud':
      if (g.size) { p.hw = g.size[0] / 2; p.hl = g.size[1] / 2; p.reach = Math.hypot(p.hw, p.hl); } else p.r = g.radius;
      if (g.kind === 'ice') p.turf = Object.freeze({ ...ICE_TURF, roll: g.friction });
      break;
    case 'warp': {
      p.r = g.radius;
      p.onGround = !fin(g.z);
      p.z = fin(g.z) ? g.z : ground + 1;
      const e = byId.get(g.pair);
      const eg = terrain.h(e.x, e.y);
      const v = e.speedMph * MPH, a = e.angle * RAD, hx = Math.sin(e.heading * RAD), hy = Math.cos(e.heading * RAD);
      p.exit = {
        id: e.id, x: e.x, y: e.y, z: fin(e.z) ? e.z : eg + 1.5,
        vx: hx * v * Math.cos(a), vy: hy * v * Math.cos(a), vz: v * Math.sin(a),
        // the spin it leaves with: backspin about the axis to the right of its new heading
        axis: Object.freeze({ x: hy, y: -hx, z: 0 }), omega: WARP_SPIN_RPM * 2 * Math.PI / 60,
        speedMph: e.speedMph,
      };
      break;
    }
    case 'breakable':
      if (g.size) { p.wall = true; p.hw = g.size[0] / 2; p.base = fin(g.z) ? g.z : -Infinity; p.top = (fin(g.z) ? g.z : ground) + g.size[1]; } else { p.r = g.radius; p.base = fin(g.z) ? g.z : -Infinity; p.top = (fin(g.z) ? g.z : ground) + g.height; }
      break;
    case 'coins': {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of g.points) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
      p.box = [x0 - g.reach, y0 - g.reach, x1 + g.reach, y1 + g.reach];
      p.reach2 = g.reach * g.reach;
      break;
    }
    case 'zone': p.r = g.radius; break;
    default: break;
  }
  return p;
}

// how far (x, y) is from a solid's footprint on the ground (0 inside it)
function solidDistance(p, x, y) {
  const seg = (ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const u = clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1);
    return Math.hypot(x - ax - dx * u, y - ay - dy * u);
  };
  if (p.segs) return Math.max(0, Math.min(...p.segs.map(([ax, ay, bx, by]) => seg(ax, ay, bx, by))) - p.r);
  if (p.hw !== undefined) return seg(p.x - p.dy * p.hw, p.y + p.dx * p.hw, p.x + p.dy * p.hw, p.y - p.dx * p.hw);
  return Math.max(0, Math.hypot(x - p.x, y - p.y) - p.r);
}

// inside a rectangle (hw x hl about x, y, long side along the heading) or a circle
function inZone(p, x, y) {
  const ex = x - p.x, ey = y - p.y;
  if (p.r !== undefined) return ex * ex + ey * ey <= p.r * p.r;
  if (Math.abs(ex) > p.reach || Math.abs(ey) > p.reach) return false;
  return Math.abs(ex * p.dx + ey * p.dy) <= p.hl && Math.abs(ex * p.dy - ey * p.dx) <= p.hw;
}

/**
 * The gadgets of a course over a terrain, ready for simulateShot (opts.gadgets). Null when
 * the course has none (and then the physics is the physics it was, to the last bit).
 * @param {Array} list     course.gadgets
 * @param {object} terrain { h(x, y) }
 */
function gadgetField(list, terrain) {
  const { gadgets } = normalizeGadgets(list);
  if (!gadgets.length || !terrain || typeof terrain.h !== 'function') return null;
  const resolved = resolveGadgets(gadgets, terrain);
  const byId = new Map(resolved.map((g) => [g.id, g]));
  const all = resolved.filter((g) => g.kind !== 'warp-exit').map((g) => prepare(g, terrain, byId));
  const pick = (...kinds) => all.filter((p) => kinds.includes(p.kind));
  const lists = {
    air: pick('ring', 'fan', 'geyser', 'bumper', 'rail', 'backboard', 'breakable', 'warp'),
    land: pick('zone', 'pad', 'warp', 'geyser', 'mud'),
    turf: pick('ice', 'mud'),
    drive: pick('strip', 'fan', 'funnel'),
    roll: pick('pad', 'geyser', 'bumper', 'rail', 'backboard', 'breakable', 'warp'),
    enter: pick('strip', 'fan', 'funnel', 'ice', 'mud'),
    coins: pick('coins'),
  };
  const field = {
    gadgets: resolved,
    count: resolved.length,
    terrain,
    /**
     * One shot's run through the field.
     * @param {object} o { events: the sim's event list (gadget events are pushed onto it),
     *   speedMph: the ball speed the shot was launched at (what a breakable is judged on),
     *   ghost: a Ghost ball (solids are air), smash: a Rocket (every breakable breaks),
     *   start: { x, y } where it is struck (a solid within 12 m of that is air for this shot) }
     */
    begin(o) { return new Run(field, lists, o || {}); },
  };
  return field;
}

class Run {
  constructor(field, lists, { events = [], speedMph = 0, ghost = false, smash = false, start = null }) {
    this.L = lists;
    this.terrain = field.terrain;
    this.events = events;
    this.hits = [];
    this.speedMph = speedMph;
    this.ghost = ghost === true;
    this.smash = smash === true;
    this.done = new Set();      // gadgets that act once a shot and have
    this.inside = new Set();    // volumes and zones the ball has entered (one event each)
    this.bumps = 0;
    this.landed = false;
    this.jump = null;           // a warp just taken: { x, y, z (the mouth), delay, omega, axis }
    this.spin = null;           // a contact that turned the ball: { axis, keep } (the step loop takes it and clears it)
    this.coins = lists.coins.map((p) => ({ p, got: new Array(p.g.points.length).fill(false), n: 0 }));
    this._push = { x: 0, y: 0 };
    // launch clearance: the solids the ball is lying against (or behind) do not exist for this shot
    if (start) for (const p of lists.air) if (p.K.solid && solidDistance(p, start.x, start.y) < FREE_M) this.done.add(p.id);
  }

  emit(p, effect, t, pos, extra = null) {
    const hit = { id: p.id, kind: p.kind, t: r3(t), x: r2(pos.x), y: r2(pos.y), z: r2(pos.z), effect, ...(extra || {}) };
    this.hits.push(hit);
    this.events.push({ type: 'gadget', ...hit });
    return hit;
  }

  // The ball was turned onto a new heading: what spin it has left is backspin about the axis
  // to the right of that heading (the launch's own axis would curve it sideways now).
  respin(vel, keep) {
    const vh = Math.hypot(vel.x, vel.y);
    this.spin = { axis: vh > 1e-6 ? { x: vel.y / vh, y: -vel.x / vh, z: 0 } : { x: 0, y: 0, z: 0 }, keep };
  }

  pay(p, extra = null) {
    const out = { ...(extra || {}) };
    if (p.reward.coins > 0) out.coins = p.reward.coins;
    if (p.reward.points > 0) out.points = p.reward.points;
    return out;
  }

  geyserOn(p, t) {
    const g = p.g;
    if (t < g.offset) return false;
    return (t - g.offset) % g.cycle < g.burst;
  }

  // ---- shared: coins (any phase)
  collect(pos, t) {
    for (const c of this.coins) {
      const p = c.p;
      if (c.n === c.got.length || pos.x < p.box[0] || pos.x > p.box[2] || pos.y < p.box[1] || pos.y > p.box[3]) continue;
      const pts = p.g.points;
      for (let i = 0; i < pts.length; i++) {
        if (c.got[i]) continue;
        const ex = pos.x - pts[i][0], ey = pos.y - pts[i][1], ez = pos.z - pts[i][2];
        if (ex * ex + ey * ey + ez * ez > p.reach2) continue;
        c.got[i] = true; c.n++;
        this.emit(p, 'coin', t, { x: pts[i][0], y: pts[i][1], z: pts[i][2] }, { index: i, ...(p.reward.coins > 0 ? { coins: p.reward.coins } : {}) });
        if (c.n === pts.length) {
          this.emit(p, 'full', t, pos, {
            count: pts.length,
            ...(p.reward.bonusCoins > 0 ? { coins: p.reward.bonusCoins } : {}), ...(p.reward.bonusPoints > 0 ? { points: p.reward.bonusPoints } : {}),
          });
        }
      }
    }
  }

  // ---- shared: the ball takes a warp. pos and vel become the exit's; this.jump tells the
  // step loop where it went in and how long it is gone.
  warp(p, pos, vel, t) {
    const e = p.exit;
    this.done.add(p.id);
    this.emit(p, 'in', t, pos, this.pay(p, { to: e.id }));
    this.jump = { x: pos.x, y: pos.y, z: pos.z, delay: p.g.delay, omega: e.omega, axis: e.axis };
    pos.x = e.x; pos.y = e.y; pos.z = e.z;
    vel.x = e.vx; vel.y = e.vy; vel.z = e.vz;
    this.hits.push({ id: e.id, kind: 'warp-exit', t: r3(t + p.g.delay), x: r2(e.x), y: r2(e.y), z: r2(e.z), effect: 'out', from: p.id, speedMph: e.speedMph });
    this.events.push({ type: 'gadget', ...this.hits[this.hits.length - 1] });
  }

  // ---- shared: a solid in the way. Returns true when the ball's path turned.
  // n: the unit normal (horizontal) pointing from the solid to the ball.
  kick(p, pos, vel, t, nx, ny, airborne) {
    const vn = vel.x * nx + vel.y * ny;
    if (vn >= 0) return false;                       // already leaving
    const vh = Math.hypot(vel.x, vel.y);
    // off the post like a pinball: turned round its normal, and sent away at the post's pace
    let ox = vel.x - 2 * vn * nx, oy = vel.y - 2 * vn * ny;
    const out = Math.min(KICK_MAX_MPS, Math.max(p.g.strength, vh));
    const ol = Math.hypot(ox, oy) || 1;
    ox = ox / ol; oy = oy / ol;
    // never along the post: at least half of it straight away
    const away = ox * nx + oy * ny;
    if (away < 0.5) { ox += nx * (0.5 - away); oy += ny * (0.5 - away); const l = Math.hypot(ox, oy) || 1; ox /= l; oy /= l; }
    vel.x = ox * out; vel.y = oy * out;
    if (airborne && vel.z < 2) vel.z = 2;
    this.respin(vel, 0.3);
    this.bumps++;
    this.emit(p, 'bump', t, pos, this.pay(p, { speedMps: r2(out) }));
    return true;
  }

  // a wall (a backboard, a breakable that held): the pace comes off it
  rebound(p, pos, vel, t, nx, ny, e, effect, extra) {
    const vn = vel.x * nx + vel.y * ny;
    const tx = vel.x - vn * nx, ty = vel.y - vn * ny;
    vel.x = tx * WALL_KEEP - vn * e * nx;
    vel.y = ty * WALL_KEEP - vn * e * ny;
    vel.z *= WALL_KEEP;
    this.respin(vel, 0.3);
    this.bumps++;
    this.emit(p, effect, t, pos, extra);
  }

  // a breakable breaks for a Rocket, or for a ball LAUNCHED at its speed or more (the number
  // the launch monitor showed) that still has some pace when it gets there
  breaks(p, vel) {
    return this.smash || (this.speedMph >= p.g.breakMph && Math.hypot(vel.x, vel.y, vel.z) >= BREAK_MIN_MPS);
  }

  // through a breakable: it takes some of the ball's pace (none of a Rocket's)
  through(p, vel) {
    if (this.smash) return;
    vel.x *= p.g.keep; vel.y *= p.g.keep; vel.z *= p.g.keep;
  }

  // a wall across the ball's step (a -> pos). Returns true when it was met (the ball's path turned, or it broke).
  wallStep(p, ax, ay, az, pos, vel, t, rolling = false) {
    const d0 = (ax - p.x) * p.dx + (ay - p.y) * p.dy, d1 = (pos.x - p.x) * p.dx + (pos.y - p.y) * p.dy;
    if ((d0 > 0) === (d1 > 0) || d0 === d1) return false;
    const k = d0 / (d0 - d1);
    const cx = ax + (pos.x - ax) * k, cy = ay + (pos.y - ay) * k, cz = az + (pos.z - az) * k;
    const across = (cx - p.x) * p.dy - (cy - p.y) * p.dx;
    if (Math.abs(across) > p.hw || (!rolling && (cz > p.top || cz < p.base)) || (rolling && p.base > cz + 1)) return false;
    const side = d0 > 0 ? 1 : -1;                    // the side the ball came from
    const at = { x: cx, y: cy, z: cz };
    if (p.kind === 'breakable') {
      if (this.breaks(p, vel)) {
        this.done.add(p.id);
        this.through(p, vel);
        this.emit(p, 'smash', t, at, this.pay(p, { needMph: p.g.breakMph, style: p.g.style }));
        return true;
      }
      pos.x = cx + p.dx * side * 0.03; pos.y = cy + p.dy * side * 0.03; pos.z = cz;
      this.rebound(p, at, vel, t, p.dx * side, p.dy * side, WALL_BOUNCE, 'bounce', { needMph: p.g.breakMph, style: p.g.style });
      return true;
    }
    pos.x = cx + p.dx * side * 0.03; pos.y = cy + p.dy * side * 0.03; pos.z = cz;
    this.rebound(p, at, vel, t, p.dx * side, p.dy * side, p.g.strength, 'board', null);
    return true;
  }

  // a round solid (a bumper, a crate, a snowman) at the ball. Returns true when it was met.
  postStep(p, pos, vel, t, airborne) {
    const ex = pos.x - p.x, ey = pos.y - p.y;
    const reach = p.r + BALL_R;
    const d2 = ex * ex + ey * ey;
    if (d2 > reach * reach || pos.z > p.top || pos.z < p.base) return false;
    const d = Math.sqrt(d2);
    let nx, ny;
    if (d > 1e-6) { nx = ex / d; ny = ey / d; } else { const v = Math.hypot(vel.x, vel.y) || 1; nx = -vel.x / v; ny = -vel.y / v; }
    if (p.kind === 'breakable') {
      if (vel.x * nx + vel.y * ny >= 0) return false;
      if (this.breaks(p, vel)) {
        this.done.add(p.id);
        this.through(p, vel);
        this.emit(p, 'smash', t, pos, this.pay(p, { needMph: p.g.breakMph, style: p.g.style }));
        return true;
      }
      pos.x = p.x + nx * (reach + 0.02); pos.y = p.y + ny * (reach + 0.02);
      this.rebound(p, pos, vel, t, nx, ny, WALL_BOUNCE, 'bounce', { needMph: p.g.breakMph, style: p.g.style });
      return true;
    }
    if (!this.kick(p, pos, vel, t, nx, ny, airborne)) return false;
    pos.x = p.x + nx * (reach + 0.02); pos.y = p.y + ny * (reach + 0.02);
    return true;
  }

  railStep(p, pos, vel, t, airborne) {
    if (pos.x < p.box[0] || pos.x > p.box[2] || pos.y < p.box[1] || pos.y > p.box[3]) return false;
    const reach = p.r + BALL_R;
    for (const [ax, ay, bx, by] of p.segs) {
      const sx = bx - ax, sy = by - ay, l2 = sx * sx + sy * sy || 1;
      const u = clamp(((pos.x - ax) * sx + (pos.y - ay) * sy) / l2, 0, 1);
      const qx = ax + sx * u, qy = ay + sy * u;
      const ex = pos.x - qx, ey = pos.y - qy, d2 = ex * ex + ey * ey;
      if (d2 > reach * reach) continue;
      if (airborne && pos.z > this.terrain.h(qx, qy) + p.g.height) continue;
      const d = Math.sqrt(d2);
      let nx, ny;
      if (d > 1e-6) { nx = ex / d; ny = ey / d; } else { const l = Math.sqrt(l2); nx = -sy / l; ny = sx / l; if (vel.x * nx + vel.y * ny > 0) { nx = -nx; ny = -ny; } }
      if (!this.kick(p, pos, vel, t, nx, ny, airborne)) continue;
      pos.x = qx + nx * (reach + 0.02); pos.y = qy + ny * (reach + 0.02);
      return true;
    }
    return false;
  }

  // ---- the air step: the ball went from (ax, ay, az) to pos. Returns 0 (nothing), 1 (its
  // path turned here: keep the point), 2 (it took a warp: this.jump).
  air(ax, ay, az, pos, vel, t, dt) {
    let code = 0;
    for (const p of this.L.air) {
      if (this.done.has(p.id)) continue;
      switch (p.kind) {
        case 'ring': {
          const d0 = (ax - p.x) * p.dx + (ay - p.y) * p.dy, d1 = (pos.x - p.x) * p.dx + (pos.y - p.y) * p.dy;
          if ((d0 > 0) === (d1 > 0) || d0 === d1) break;
          const k = d0 / (d0 - d1);
          const cx = ax + (pos.x - ax) * k, cy = ay + (pos.y - ay) * k, cz = az + (pos.z - az) * k;
          const ex = cx - p.x, ey = cy - p.y, ez = cz - p.z;
          if (ex * ex + ey * ey + ez * ez > p.r * p.r) break;
          this.done.add(p.id);
          const before = Math.hypot(vel.x, vel.y, vel.z);
          vel.x *= p.g.strength; vel.y *= p.g.strength; vel.z *= p.g.strength;
          this.emit(p, 'boost', t, { x: cx, y: cy, z: cz }, this.pay(p, { gain: p.g.strength, mphIn: r2(before / MPH), mphOut: r2(before * p.g.strength / MPH) }));
          code = Math.max(code, 1);
          break;
        }
        case 'fan': {
          const ex = pos.x - p.x, ey = pos.y - p.y;
          if (Math.abs(ex) > p.reach || Math.abs(ey) > p.reach || pos.z > p.top) break;
          if (Math.abs(ex * p.dx + ey * p.dy) > p.hl || Math.abs(ex * p.dy - ey * p.dx) > p.hw) break;
          vel.x += p.dx * p.g.strength * dt; vel.y += p.dy * p.g.strength * dt; vel.z += p.g.lift * dt;
          if (!this.inside.has(p.id)) { this.inside.add(p.id); this.emit(p, 'push', t, pos, this.pay(p)); }
          break;
        }
        case 'geyser': {
          if (pos.z > p.top || !this.geyserOn(p, t)) break;
          const ex = pos.x - p.x, ey = pos.y - p.y;
          if (ex * ex + ey * ey > p.r * p.r) break;
          this.done.add(p.id);
          vel.x *= GEYSER_KEEP; vel.y *= GEYSER_KEEP; vel.z = Math.max(vel.z, 0) + p.g.strength;
          this.respin(vel, 0.5);
          this.emit(p, 'erupt', t, pos, this.pay(p));
          code = Math.max(code, 1);
          break;
        }
        case 'bumper':
          if (!this.ghost && this.bumps < MAX_BUMPS && this.postStep(p, pos, vel, t, true)) code = Math.max(code, 1);
          break;
        case 'rail':
          if (!this.ghost && this.bumps < MAX_BUMPS && this.railStep(p, pos, vel, t, true)) code = Math.max(code, 1);
          break;
        case 'backboard':
          if (!this.ghost && this.bumps < MAX_BUMPS && this.wallStep(p, ax, ay, az, pos, vel, t)) code = Math.max(code, 1);
          break;
        case 'breakable':
          if (this.ghost || this.bumps >= MAX_BUMPS) break;
          if (p.wall ? this.wallStep(p, ax, ay, az, pos, vel, t) : this.postStep(p, pos, vel, t, true)) code = Math.max(code, 1);
          break;
        case 'warp': {
          const ex = pos.x - p.x, ey = pos.y - p.y, ez = pos.z - p.z;
          if (ex * ex + ey * ey + ez * ez > p.r * p.r) break;
          this.warp(p, pos, vel, t);
          this.collect(pos, t);
          return 2;
        }
        default: break;
      }
    }
    if (this.coins.length) this.collect(pos, t);
    return code;
  }

  // ---- the ball meets the ground at pos. Returns 0 (it bounces as ever), 1 (thrown back
  // into the air: a pad, a geyser), 2 (a warp: this.jump), 3 (stuck: mud).
  land(pos, vel, t) {
    const first = !this.landed;
    this.landed = true;
    // a bounce on ice is a contact too (turf() changes that bounce)
    for (const p of this.L.turf) {
      if (p.kind !== 'ice' || this.inside.has(p.id) || !inZone(p, pos.x, pos.y)) continue;
      this.inside.add(p.id);
      this.emit(p, 'slide', t, pos, this.pay(p));
    }
    for (const p of this.L.land) {
      if (p.kind === 'zone') {
        if (first && inZone(p, pos.x, pos.y)) this.emit(p, p.g.mult === 3 ? 'x3' : 'x2', t, pos, { mult: p.g.mult });
        continue;
      }
      if (this.done.has(p.id)) continue;
      if (p.kind === 'pad') {
        if (!inZone(p, pos.x, pos.y)) continue;
        this.launch(p, pos, vel, t);
        return 1;
      }
      if (p.kind === 'warp') {
        if (!p.onGround || !inZone(p, pos.x, pos.y)) continue;
        this.warp(p, pos, vel, t);
        return 2;
      }
      if (p.kind === 'geyser') {
        if (!this.geyserOn(p, t) || !inZone(p, pos.x, pos.y)) continue;
        this.done.add(p.id);
        vel.x *= GEYSER_KEEP; vel.y *= GEYSER_KEEP; vel.z = p.g.strength;
        this.respin(vel, 0.5);
        this.emit(p, 'erupt', t, pos, this.pay(p));
        return 1;
      }
      if (p.kind === 'mud') {
        if (!inZone(p, pos.x, pos.y)) continue;
        if (!this.inside.has(p.id)) { this.inside.add(p.id); this.emit(p, 'stuck', t, pos, null); }
        return 3;
      }
    }
    return 0;
  }

  // a pad throws the ball: at its angle, the way it was going (or the pad's own way)
  launch(p, pos, vel, t) {
    this.done.add(p.id);
    const g = p.g;
    const vin = Math.hypot(vel.x, vel.y, vel.z);
    const out = clamp(vin * g.strength, g.minMps, g.maxMps);
    let hx = p.dx, hy = p.dy;
    if (hx === undefined) {
      const vh = Math.hypot(vel.x, vel.y);
      if (vh > 0.2) { hx = vel.x / vh; hy = vel.y / vh; } else { hx = 0; hy = 0; }
    }
    vel.x = hx * out * p.cos; vel.y = hy * out * p.cos;
    vel.z = hx === 0 && hy === 0 ? out : out * p.sin;
    this.respin(vel, 0.6);
    this.emit(p, 'launch', t, pos, this.pay(p, { speedMps: r2(out), mphIn: r2(vin / MPH), mphOut: r2(out / MPH) }));
  }

  // ---- the ground at (x, y) as a gadget makes it: ice, mud. sp: the
  // surface's own { e, keep, roll, spinBite }; the same object back when no gadget is there.
  turf(x, y, sp) {
    for (const p of this.L.turf) {
      if (!inZone(p, x, y)) continue;
      if (p.kind === 'ice') return p.turf;
      return MUD_TURF;
    }
    return sp;
  }

  // ---- what drives a rolling ball at pos: a strip, a fan, a funnel. Null, or { x, y } m/s^2.
  drive(pos, vel) {
    let ax = 0, ay = 0, any = false;
    for (const p of this.L.drive) {
      if (p.kind === 'funnel') {
        const ex = p.x - pos.x, ey = p.y - pos.y, d = Math.hypot(ex, ey);
        if (d > p.r || d < 1e-6) continue;
        const pull = p.g.strength * Math.min(1, d / FUNNEL_REST_M);
        ax += (ex / d) * pull; ay += (ey / d) * pull; any = true;
        continue;
      }
      if (!inZone(p, pos.x, pos.y)) continue;
      if (p.kind === 'strip') {
        if (vel.x * p.dx + vel.y * p.dy >= p.g.maxMps) continue;
        ax += p.dx * p.g.strength; ay += p.dy * p.g.strength; any = true;
      } else if (pos.z <= p.top && p.g.strength > 0) {
        ax += p.dx * p.g.strength; ay += p.dy * p.g.strength; any = true;
      }
    }
    if (!any) return null;
    this._push.x = ax; this._push.y = ay;
    return this._push;
  }

  // ---- the roll step: the ball rolled from (ax, ay) to pos. Returns 0, 1 (its path
  // turned), 2 (a warp: this.jump), 4 (thrown into the air: a pad, a geyser).
  roll(ax, ay, pos, vel, t) {
    let code = 0;
    for (const p of this.L.roll) {
      if (this.done.has(p.id)) continue;
      switch (p.kind) {
        case 'pad':
          if (!inZone(p, pos.x, pos.y)) break;
          this.launch(p, pos, vel, t);
          return 4;
        case 'geyser':
          if (!this.geyserOn(p, t) || !inZone(p, pos.x, pos.y)) break;
          this.done.add(p.id);
          vel.x *= GEYSER_KEEP; vel.y *= GEYSER_KEEP; vel.z = p.g.strength;
          this.respin(vel, 0.5);
          this.emit(p, 'erupt', t, pos, this.pay(p));
          return 4;
        case 'warp': {
          const ex = pos.x - p.x, ey = pos.y - p.y;
          if (ex * ex + ey * ey > p.r * p.r || Math.abs(pos.z - p.z) > p.r + 1.5) break;
          this.warp(p, pos, vel, t);
          return 2;
        }
        case 'bumper':
          if (!this.ghost && this.bumps < MAX_BUMPS && this.postStep(p, pos, vel, t, false)) code = 1;
          break;
        case 'rail':
          if (!this.ghost && this.bumps < MAX_BUMPS && this.railStep(p, pos, vel, t, false)) code = 1;
          break;
        case 'backboard':
          if (!this.ghost && this.bumps < MAX_BUMPS && this.wallStep(p, ax, ay, pos.z, pos, vel, t, true)) code = 1;
          break;
        case 'breakable':
          if (this.ghost || this.bumps >= MAX_BUMPS) break;
          if (p.wall ? this.wallStep(p, ax, ay, pos.z, pos, vel, t, true) : this.postStep(p, pos, vel, t, false)) code = 1;
          break;
        default: break;
      }
    }
    for (const p of this.L.enter) {
      if (this.inside.has(p.id)) continue;
      const within = p.kind === 'funnel' ? Math.hypot(pos.x - p.x, pos.y - p.y) <= p.r : inZone(p, pos.x, pos.y) && (p.kind !== 'fan' || pos.z <= p.top);
      if (!within) continue;
      this.inside.add(p.id);
      this.emit(p, p.kind === 'strip' ? 'speed' : p.kind === 'fan' ? 'push' : p.kind === 'funnel' ? 'funnel' : p.kind === 'ice' ? 'slide' : 'stuck', t, pos, this.pay(p));
    }
    if (this.coins.length) this.collect(pos, t);
    return code;
  }
}

// ---------------------------------------------------------------- the arcade's side
// The loud thing a gadget makes of a shot: id -> { text, tone }. The voice lines are not
// recorded yet (docs/gadgets.md lists them); a callout's `voice` is its id, as ever.
const GADGET_CALLOUTS = Object.freeze(Object.fromEntries([
  ['full-trail', 'FULL TRAIL!', 'epic'],
  ['smashed-it', 'SMASHED IT!', 'epic'],
  ['triple-up', 'TRIPLE UP!', 'epic'],
  ['warp-speed', 'WARP SPEED!', 'good'],
  ['ring-it', 'RING IT!', 'good'],
  ['double-up', 'DOUBLE UP!', 'good'],
  ['thar-she-blows', 'THAR SHE BLOWS!', 'funny'],
  ['boing', 'BOING!', 'funny'],
  ['pinball', 'PINBALL WIZARD!', 'funny'],
  ['turbo', 'TURBO!', 'good'],
  ['denied', 'DENIED!', 'funny'],
  ['stuck', 'STUCK IN THE MUD!', 'funny'],
].map(([id, text, tone]) => [id, Object.freeze({ text, tone })])));

// kind + effect -> the callout it earns, loudest first
const CALLOUT_ORDER = Object.freeze([
  ['full-trail', (h) => h.kind === 'coins' && h.effect === 'full'],
  ['smashed-it', (h) => h.kind === 'breakable' && h.effect === 'smash'],
  ['triple-up', (h) => h.kind === 'zone' && h.mult === 3],
  ['warp-speed', (h) => h.kind === 'warp' && h.effect === 'in'],
  ['ring-it', (h) => h.kind === 'ring'],
  ['double-up', (h) => h.kind === 'zone' && h.mult === 2],
  ['thar-she-blows', (h) => h.kind === 'geyser'],
  ['boing', (h) => h.kind === 'pad'],
  ['pinball', (h) => h.kind === 'bumper' || h.kind === 'rail'],
  ['turbo', (h) => h.kind === 'strip'],
  ['denied', (h) => h.kind === 'breakable' && h.effect === 'bounce'],
  ['stuck', (h) => h.kind === 'mud'],
]);

/**
 * What a shot's gadget hits are worth (lib/arcade.js gradeShot).
 * @param {Array} hits  result.gadgets
 * @returns {{ coins, points, mult, callout: id | null, hits: number, kinds: string[] } | null}
 *   coins and points are flat bonuses; mult (1, 2 or 3) multiplies the shot's own points
 *   (the best multiplier ring the ball's first landing was in). Null with no hits.
 */
function gadgetAward(hits) {
  if (!Array.isArray(hits) || !hits.length) return null;
  let coins = 0, points = 0, mult = 1;
  const kinds = new Set();
  for (const h of hits) {
    if (!h || typeof h !== 'object') continue;
    kinds.add(h.kind);
    if (Number.isFinite(h.coins) && h.coins > 0) coins += Math.floor(h.coins);
    if (Number.isFinite(h.points) && h.points > 0) points += Math.floor(h.points);
    if (h.kind === 'zone' && (h.mult === 2 || h.mult === 3)) mult = Math.max(mult, h.mult);
  }
  let callout = null;
  for (const [id, test] of CALLOUT_ORDER) if (hits.some((h) => h && test(h))) { callout = id; break; }
  return { coins, points, mult, callout, hits: hits.length, kinds: [...kinds] };
}

/**
 * The gadgets a shot along an aim line could meet, for the lineup ("gadget ahead"): those
 * within `halfWidthM` of the line and no farther than `reachM` along it, nearest first.
 * @returns {Array<{ id, kind, label, distYd, offlineYd }>}
 */
function gadgetsAhead(gadgets, from, aimDeg, { reachM = 400, halfWidthM = 30 } = {}) {
  const out = [];
  const dx = Math.sin(aimDeg * RAD), dy = Math.cos(aimDeg * RAD);
  for (const g of gadgets || []) {
    if (g.kind === 'warp-exit') continue;
    const f = footprint(g);
    const al = (f.x - from.x) * dx + (f.y - from.y) * dy, lat = (f.x - from.x) * dy - (f.y - from.y) * dx;
    if (al < 2 - f.r || al > reachM + f.r || Math.abs(lat) > halfWidthM + f.r) continue;
    out.push({ id: g.id, kind: g.kind, label: KINDS[g.kind].label, distYd: Math.round(al / 0.9144), offlineYd: Math.round(lat / 0.9144) });
  }
  return out.sort((a, b) => a.distYd - b.distYd);
}

module.exports = {
  KINDS, KIND_IDS, BREAK_STYLES, WARP_STYLES, MAX_GADGETS, MAX_BUMPS, GADGET_CALLOUTS,
  normalizeGadgets, resolveGadgets, footprint, outline, gadgetField, gadgetAward, gadgetsAhead,
};
