'use strict';
// Wind per hole (docs/dev/arcade-v2-contract.md section 5, docs/match.md "Wind"): every time an
// arcade stage comes up (a match hole, a tiebreak arena, the course loaded in solo play)
// the wind is ROLLED for that hole: a whole number of mph inside the stage's range, from
// anywhere round the compass. It is the same for both players for the whole hole and it is
// rolled again for the next one. Reading it is part of the game, as in any arcade golf game.
//
//   windRange(arcade)                       the stage's range { min, max } (whole mph)
//   rollWind({ arcade, hole, progress, random })   a wind for this hole
//   describeWind(mph, dirDeg, hole)         a wind relative to the hole's tee-to-pin line
//   pendingWind(entry)                      the range of a stage whose roll is still to come
//   windConditions(wind)                    lib/conditions.js values that play that wind
//   createStageWind({ game, random })       the bay's keeper: rolls onto game.conditions and
//                                           holds the day's conditions aside meanwhile
//
// A wind, as the match state's stage.wind carries it:
//
//   { mph,                 whole mph
//     dirDeg,              compass bearing it blows FROM (lib/conditions.js windFromDeg)
//     relDeg,              where it blows TO, relative to the direction of play: 0 straight
//                          at the pin (helping), 90 left to right, 180 / -180 into the
//                          player's face, -90 right to left. Null: calm, or no line.
//     cross,               'R' it pushes the ball right (left to right) | 'L' | null
//     along,               'tail' helping | 'head' hurting | null
//     crossMph, alongMph,  the two components (+ right, + helping), one decimal
//     strength,            'calm' (0 to 5) | 'moderate' (6 to 12) | 'strong' (13 and up)
//     label,               '12 MPH · LEFT TO RIGHT · HELPING'
//     min, max,            the range it was rolled from (null: not a rolled wind)
//     rolled }             true: rolled for this hole; false: the day's wind as it is
//
// Pure except createStageWind, which only touches the Game it is given. No I/O.

const { DEFAULTS, normalizeConditions, resolveConditions } = require('./conditions');

// the range a stage's conditions preset stands for (mph), when it has no wind of its own
const WIND_RANGES = Object.freeze({ calm: [0, 5], breezy: [6, 12], windy: [12, 22] });
const MAX_MPH = 40;                 // lib/conditions.js windMph tops out there
const LEAN = 2;                     // progress 1: the speed is the highest of three draws
const OCTANT = Math.sin(Math.PI / 8);   // a component under 38 % of the wind is not called
const STRONG_MPH = 12, CALM_MPH = 5;

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : null));
const clamp01 = (v) => (Number.isFinite(+v) ? Math.min(1, Math.max(0, +v)) : 0);
const r1 = (v) => Math.round(v * 10) / 10 || 0;
const norm360 = (d) => ((Math.round(d) % 360) + 360) % 360;
const norm180 = (d) => { const x = ((d % 360) + 360) % 360; return x > 180 ? x - 360 : x; };

// A course whose arcade block names a theme is an arcade stage: a hole with a wind of its
// own. Any other course (a real one, the three-hole Arcade Classics) plays the day's.
function isArcadeStage(course) {
  const a = course && course.arcade;
  return Boolean(a && typeof a === 'object' && typeof a.theme === 'string' && a.theme);
}

// The range of a stage: `wind: { min, max }` when it has one (course.arcade.wind, or a
// manifest entry's), else what its `conditions` stand for, else calm. Whole mph, 0 to 40,
// min <= max, whatever was written in the file.
function windRange(arcade) {
  const a = arcade && typeof arcade === 'object' ? arcade : {};
  const w = a.wind && typeof a.wind === 'object' ? a.wind : null;
  let lo = w ? finite(w.min) : null;
  let hi = w ? finite(w.max) : null;
  if (lo === null && hi === null) {
    const preset = WIND_RANGES[String(a.conditions || '').trim().toLowerCase()] || WIND_RANGES.calm;
    [lo, hi] = preset;
  } else {
    if (lo === null) lo = 0;
    if (hi === null) hi = lo;
  }
  lo = Math.min(MAX_MPH, Math.max(0, lo));
  hi = Math.min(MAX_MPH, Math.max(0, hi));
  if (lo > hi) [lo, hi] = [hi, lo];
  let min = Math.ceil(lo), max = Math.floor(hi);
  if (min > max) min = max = Math.round((lo + hi) / 2);   // a range inside one mph
  return { min, max };
}

// Compass bearing of play, tee to pin (course metres: x east, y north). Null: no line.
function playBearing(hole) {
  if (typeof hole === 'number') return Number.isFinite(hole) ? hole : null;
  const pt = (p) => (Array.isArray(p) ? { x: +p[0], y: +p[1] } : p && typeof p === 'object' ? { x: +p.x, y: +p.y } : null);
  const tee = pt(hole && hole.tee), pin = pt(hole && hole.pin);
  if (!tee || !pin) return null;
  const dx = pin.x - tee.x, dy = pin.y - tee.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 1e-6) return null;
  return Math.atan2(dx, dy) * 180 / Math.PI;
}

const strengthOf = (mph) => (mph <= CALM_MPH ? 'calm' : mph <= STRONG_MPH ? 'moderate' : 'strong');

/**
 * A wind (speed, compass bearing it blows FROM) as the players read it on a hole: relative
 * to the tee-to-pin line. `hole`: { tee, pin } (arrays or {x, y}), or the bearing of play in
 * degrees; without one only the speed is described.
 */
function describeWind(mph, dirDeg, hole = null) {
  const speed = Math.max(0, Math.round(finite(mph) || 0));
  const from = norm360(finite(dirDeg) || 0);
  const play = playBearing(hole);
  const out = {
    mph: speed, dirDeg: from, relDeg: null, cross: null, along: null, crossMph: 0, alongMph: 0,
    strength: strengthOf(speed), label: speed < 1 ? 'NO WIND' : `${speed} MPH`, min: null, max: null, rolled: false,
  };
  if (speed < 1 || play === null) return out;
  const rel = norm180(from + 180 - play);
  const s = Math.sin(rel * Math.PI / 180), c = Math.cos(rel * Math.PI / 180);
  out.relDeg = Math.round(rel) || 0;
  out.cross = Math.abs(s) >= OCTANT ? (s > 0 ? 'R' : 'L') : null;
  out.along = Math.abs(c) >= OCTANT ? (c > 0 ? 'tail' : 'head') : null;
  out.crossMph = r1(speed * s);
  out.alongMph = r1(speed * c);
  out.label = [
    `${speed} MPH`,
    out.cross === 'R' ? 'LEFT TO RIGHT' : out.cross === 'L' ? 'RIGHT TO LEFT' : null,
    out.along === 'tail' ? 'HELPING' : out.along === 'head' ? 'HURTING' : null,
  ].filter(Boolean).join(' · ');
  return out;
}

/**
 * Roll the wind for a hole.
 *   arcade    course.arcade (or anything with `wind` / `conditions`); or give `range`
 *   hole      { tee, pin }: what the wind is described against
 *   progress  0 to 1 through a series: late holes lean toward the top of the range (at 0
 *             every speed of the range is as likely as any other; at 1 the speed is as if
 *             the best of three draws were taken)
 *   random    () => [0, 1): two draws, the speed then the direction
 */
function rollWind({ arcade = null, range = null, hole = null, progress = 0, random = Math.random } = {}) {
  const { min, max } = range ? windRange({ wind: range }) : windRange(arcade);
  const u = clamp01(random());
  const leaned = 1 - Math.pow(1 - u, 1 + LEAN * clamp01(progress));
  const mph = Math.min(max, min + Math.floor(leaned * (max - min + 1)));
  const dirDeg = Math.floor(clamp01(random()) * 360) % 360;
  return { ...describeWind(mph, dirDeg, hole), min, max, rolled: true };
}

// A stage whose wind has not been rolled yet (the match's nextStage, read from the tour
// manifest): its range only, or null when the entry says nothing about its wind.
function pendingWind(entry) {
  const e = entry && typeof entry === 'object' ? entry : null;
  const has = e && ((e.wind && typeof e.wind === 'object' && (finite(e.wind.min) !== null || finite(e.wind.max) !== null))
    || WIND_RANGES[String(e.conditions || '').trim().toLowerCase()]);
  if (!has) return null;
  const { min, max } = windRange(e);
  return {
    mph: null, dirDeg: null, relDeg: null, cross: null, along: null, crossMph: null, alongMph: null, strength: null,
    label: min === max ? `${min} MPH` : `${min} TO ${max} MPH`, min, max, rolled: false,
  };
}

// The conditions a rolled wind is played in: that wind, steady (no gusts: both players
// meet the same air), in standard air on normal ground.
function windConditions(wind) {
  return normalizeConditions({ windMph: wind.mph, windFromDeg: wind.dirDeg, gustMph: 0 }, DEFAULTS);
}

// The hole of the game a wind is described against: the one in play.
function gameHole(game) {
  const c = game && game.course;
  if (!c || !Array.isArray(c.holes) || !c.holes.length) return null;
  return c.holes[game.holeIndex] || c.holes[0];
}

// The wind a game is playing in right now, described for a hole (not a roll).
function gameWind(game, hole = null) {
  const c = game && game.conditions;
  if (!c) return null;
  return describeWind(c.windMph, c.windFromDeg, hole || gameHole(game));
}

/**
 * The bay's wind keeper. roll() looks at the course in the game: an arcade stage gets a
 * fresh wind on game.conditions (the day's conditions are set aside the first time and
 * stay aside from stage to stage); any other course gets the day's conditions back.
 */
function createStageWind({ game, random = Math.random } = {}) {
  let day = null;       // the day's conditions while a rolled wind is in force
  let current = null;   // that wind
  const restore = () => {
    if (day) game.conditions = day;
    day = null;
    current = null;
  };
  return {
    get held() { return day !== null; },
    get day() { return day; },             // null: the game's conditions ARE the day's
    get current() { return current ? { ...current } : null; },
    roll({ progress = 0 } = {}) {
      if (!isArcadeStage(game.course)) { restore(); return null; }
      if (!day) day = game.conditions;
      current = rollWind({ arcade: game.course.arcade, hole: gameHole(game), progress, random });
      game.conditions = windConditions(current);
      return { ...current };
    },
    restore,
    // The player changed the conditions by hand (POST /api/conditions, already applied to
    // the game) while a rolled wind is in force: the change is also theirs for the day,
    // and the wind in force is whatever the game now plays. Returns what to save.
    changed(input) {
      if (!day) return game.conditions;
      try { day = resolveConditions(input, day); } catch (_) { /* the game refused it too */ }
      const now = gameWind(game);
      if (current && now && (now.mph !== current.mph || now.dirDeg !== current.dirDeg)) current = { ...now, min: current.min, max: current.max, rolled: false };
      return day;
    },
  };
}

// A small seeded generator (mulberry32) for tests and BIRDIE_WIND_SEED.
function seededRandom(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = {
  WIND_RANGES,
  createStageWind,
  describeWind,
  gameWind,
  isArcadeStage,
  pendingWind,
  playBearing,
  rollWind,
  seededRandom,
  windConditions,
  windRange,
};
