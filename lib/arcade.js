'use strict';
// Arcade layer: arcade golf on a real launch monitor. Every shot is graded
// (JACKPOT, PERFECT, GREAT, GOOD, OK, MISS, DISASTER), earns points, coins and XP,
// builds a streak, and streaks, level-ups and jackpots hand out power-up balls. The
// power-ups are overpowered on purpose (a Rocket drive flies ~500 yd); the fairness is
// that the real swing still has to earn them.
//
//   POWERUPS                       the catalogue, in display order: fifteen balls
//                                  (kind 'ball') and three tricks (kind 'trick': a
//                                  sabotage played on an opponent's shot in a match)
//   modifiersFor(id, assist, {curses, random})
//                                  { id, launch(l, ctx), physics, post(sim), gimmeFt,
//                                    assist, curses, gust, cupCurse } for Game.shotMods
//   ASSIST_DEFAULTS, normalizeAssist   the forgiveness settings (putting, dispersion, tap-ins)
//   CALLOUTS                       id -> { text, tone }: the one loud thing said about a shot
//   gradeShot({result, before, practice, streak, powerup, theme, handed})
//                                  -> { grade, label, points, basePoints, multiplier,
//                                       coins, reasons, tags, quality, callout, curses,
//                                       gust, facts }
//   CHALLENGES                     the pool the three live challenges are drawn from
//   ArcadeState                    coins / xp / level / streak / inventory / challenges,
//                                  persisted to <dataDir>/arcade.json

const fs = require('fs');
const path = require('path');
const { simulateShot, MPH } = require('./physics');
const { CLUB_FULL } = require('./game');

const FILE_VERSION = 2;   // 1: before the challenges (read as it is; the challenges start fresh)
const HISTORY_MAX = 20;
const STARTING_INVENTORY = Object.freeze({ rocket: 1, magnet: 1 });   // try one straight away

// ---------- assists ----------
// Arcade forgiveness, on whenever the layer is enabled:
//   putting     'off' | 'assist' | 'easy': how much help a putt gets (lib/putt-assist.js
//               does the maths; this module only stores and hands on the level)
//   dispersion  0..1: every non-putt's HLA and spin axis are scaled to this fraction
//               (0.6: straighter than real life; 1: your real ball; 0: dead straight)
//   tapInFt     0..20: a ball that stops on the green this close is holed for a stroke,
//               in place of settings.gimmeFt (0: no tap-ins)
const PUTTING_LEVELS = Object.freeze(['off', 'assist', 'easy']);
const TAP_IN_MAX_FT = 20;
const ASSIST_DEFAULTS = Object.freeze({ putting: 'easy', dispersion: 0.6, tapInFt: 8 });

// A whole assist object from a partial one, on top of `base`. Throws ArcadeError
// (BAD_ASSIST) on a value of the wrong kind; numbers are clamped to their range.
function normalizeAssist(patch, base = ASSIST_DEFAULTS) {
  const out = { ...ASSIST_DEFAULTS, ...base };
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return out;
  if ('putting' in patch) {
    const level = String(patch.putting).toLowerCase();
    if (!PUTTING_LEVELS.includes(level)) throw new ArcadeError('BAD_ASSIST', `putting must be one of ${PUTTING_LEVELS.join(', ')}`);
    out.putting = level;
  }
  const num = (name, lo, hi, step) => {
    if (!(name in patch)) return;
    const n = typeof patch[name] === 'string' && patch[name].trim() !== '' ? Number(patch[name]) : patch[name];
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new ArcadeError('BAD_ASSIST', `${name} must be a number`);
    out[name] = Math.round(Math.max(lo, Math.min(hi, n)) / step) * step;
  };
  num('dispersion', 0, 1, 0.01);
  out.dispersion = +out.dispersion.toFixed(2);
  num('tapInFt', 0, TAP_IN_MAX_FT, 0.5);
  return out;
}

// ---------- power-ups ----------
// launchMods runs AFTER launchFromBall's validation (so a Rocket legitimately exceeds the
// 250 mph cap); physicsOpts are simulateShot's arcade scales (lib/physics.js); postProcess
// may touch the finished sim. Rarity drives the random grants: common 60 / rare 30 / epic 10.
//   kind    'ball': armed on your own shot. 'trick': played on an opponent's next shot
//           in a match (lib/match.js), reaching the shot as a curse: never a solo ball.
//   color   the trail colour, a hex number
//   boost   a rocket-type ball: its launch is faster than the swing (callout BLAST OFF)
//   payout  the points and coins multiplier of a shot hit with it (default 0.5: the ball
//           did some of the work; Gold pays double)
//   curse(physics, random)   a trick's work on the cursed shot's physics options
const GUST_MPH = 25;
const TINY_CUP = Object.freeze({ cupRadiusScale: 0.25, cupMaxSpeedScale: 0.45 });
const POWERUPS = Object.freeze([
  {
    id: 'rocket', name: 'Rocket', emoji: '🚀', rarity: 'epic', color: 0xff5a1f, boost: true,
    tagline: 'Strap a booster to it. A normal drive flies 500 yards.',
    launchMods: (l) => ({ ...l, speedMph: l.speedMph * 1.5 }),
    physicsOpts: { dragScale: 0.7, liftScale: 1.2 },
  },
  {
    id: 'sticky', name: 'Sticky', emoji: '🍯', rarity: 'common', color: 0xffb300,
    tagline: 'Lands and stops dead. Where it carries is where it stays.',
    physicsOpts: { bounceScale: 0.05, keepScale: 0.1, rollScale: 6 },
  },
  {
    id: 'magnet', name: 'Magnet', emoji: '🧲', rarity: 'rare', color: 0xe53935,
    tagline: 'The cup is three yards wide. Get it close and it drops.',
    physicsOpts: { cupRadiusScale: 12, cupMaxSpeedScale: 3 },
  },
  {
    id: 'windcutter', name: 'Windcutter', emoji: '🌪️', rarity: 'common', color: 0x7fe3ff,
    tagline: 'What wind? This ball never feels it.',
    physicsOpts: { windScale: 0 },
  },
  {
    id: 'laser', name: 'Laser', emoji: '🎯', rarity: 'rare', color: 0xff2bd6,
    tagline: 'Dead straight. 85 % of your slice, gone.',
    launchMods: (l) => ({ ...l, hla: l.hla * 0.15, spinAxis: l.spinAxis * 0.15 }),
  },
  {
    id: 'moonball', name: 'Moonball', emoji: '🌙', rarity: 'common', color: 0xc9d4ff,
    tagline: 'Into orbit, down like a feather.',
    launchMods: (l) => ({ ...l, vla: Math.min(60, l.vla + 12), totalSpin: l.totalSpin * 1.3 }),
    physicsOpts: { liftScale: 1.6 },
  },
  {
    id: 'bouncy', name: 'Bouncy', emoji: '🏀', rarity: 'common', color: 0xff8a3d,
    tagline: 'Rubber core. Hits the ground and keeps on going.',
    physicsOpts: { bounceScale: 2.2 },
  },
  {
    id: 'fireball', name: 'Fireball', emoji: '🔥', rarity: 'epic', color: 0xff3d00, boost: true,
    tagline: 'Leaves hot and low, lands running. A hundred yards of roll.',
    launchMods: (l) => ({ ...l, speedMph: l.speedMph * 1.2 }),
    physicsOpts: { dragScale: 0.85, liftScale: 0.8, bounceScale: 1.2, keepScale: 1.5, rollScale: 0.25 },
  },
  {
    id: 'ghost', name: 'Ghost', emoji: '👻', rarity: 'rare', color: 0xb8f4ff,
    tagline: 'Trees? What trees. It flies straight through them.',
    physicsOpts: { ignoreTrees: true },
  },
  {
    id: 'skipper', name: 'Skipper', emoji: '🌊', rarity: 'common', color: 0x2f9bff,
    tagline: 'Skips across water like a flat stone. Five hops to the far bank.',
    physicsOpts: { waterSkips: 5 },
  },
  {
    id: 'yoyo', name: 'Yo-Yo', emoji: '🪀', rarity: 'rare', color: 0x9b5cff,
    tagline: 'Lands, bites, and rips back twenty yards. Fly it past the pin.',
    physicsOpts: { ripBackYd: 20 },
  },
  {
    id: 'homing', name: 'Homing', emoji: '🛰️', rarity: 'epic', color: 0x39ff88,
    tagline: 'Locks on to your line and bends back to it in the air.',
    physicsOpts: { homing: 1 },
  },
  {
    id: 'titan', name: 'Titan', emoji: '🗿', rarity: 'rare', color: 0x9aa7b8, boost: true,
    tagline: 'A quarter more speed and it will not curve. At all.',
    launchMods: (l) => ({ ...l, speedMph: l.speedMph * 1.25, spinAxis: 0 }),
  },
  {
    id: 'feather', name: 'Feather', emoji: '🪶', rarity: 'common', color: 0xfff6d5,
    tagline: 'Floats for ever, comes down soft and stays where it lands.',
    physicsOpts: { gravityScale: 0.55, dragScale: 1.15, bounceScale: 0.1, keepScale: 0.15, rollScale: 5 },
  },
  {
    id: 'gold', name: 'Gold', emoji: '👑', rarity: 'epic', color: 0xffd700, payout: 2,
    tagline: 'A plain ball made of money: double points, double coins.',
  },
  {
    id: 'gust', name: 'Gust', emoji: '💨', rarity: 'common', color: 0x9fe0ff, kind: 'trick',
    tagline: `A ${GUST_MPH} mph crosswind hits their next shot. Left or right? Nobody knows.`,
    curse: (physics, random) => {
      const side = random() < 0.5 ? -1 : 1;   // +: from the left, pushing the ball right
      physics.crossWindMps = side * GUST_MPH * MPH;
      return { gust: { mph: GUST_MPH, from: side > 0 ? 'left' : 'right' } };
    },
  },
  {
    id: 'tiny-cup', name: 'Tiny Cup', emoji: '🕳️', rarity: 'rare', color: 0xff6fa3, kind: 'trick',
    tagline: 'Their cup shrinks to a quarter. Good luck holing that.',
    curse: (physics) => {
      const own = { cupRadiusScale: physics.cupRadiusScale ?? 1, cupMaxSpeedScale: physics.cupMaxSpeedScale ?? 1 };
      physics.cupRadiusScale = own.cupRadiusScale * TINY_CUP.cupRadiusScale;
      physics.cupMaxSpeedScale = own.cupMaxSpeedScale * TINY_CUP.cupMaxSpeedScale;
      return { cupCurse: { ...TINY_CUP, own } };
    },
  },
  {
    id: 'fog', name: 'Fog', emoji: '🌫️', rarity: 'common', color: 0x9aa3ad, kind: 'trick',
    tagline: 'Their yardages vanish. They swing blind.',
  },
].map((p) => Object.freeze({ kind: 'ball', ...p, physicsOpts: Object.freeze(p.physicsOpts || {}) })));
const POWERUP_BY_ID = new Map(POWERUPS.map((p) => [p.id, p]));
const RARITY_WEIGHT = Object.freeze({ common: 60, rare: 30, epic: 10 });

const powerup = (id) => (id ? POWERUP_BY_ID.get(String(id)) || null : null);
// a ball that can be armed on your own shot (never a trick)
const ballOf = (id) => { const p = powerup(id); return p && p.kind === 'ball' ? p : null; };
// the tricks in a list of curse ids, each once, in catalogue order (anything else is dropped)
function trickList(curses) {
  const ids = new Set((Array.isArray(curses) ? curses : curses ? [curses] : []).map(String));
  return POWERUPS.filter((p) => p.kind === 'trick' && ids.has(p.id));
}
const NO_PHYSICS = Object.freeze({});
const NO_CURSES = Object.freeze([]);
const NO_MODS = Object.freeze({
  id: null, launch: (l) => l, physics: NO_PHYSICS, post: () => {}, gimmeFt: null, assist: null,
  curses: NO_CURSES, gust: null, cupCurse: null,
});

// The shot modifiers for a power-up, as Game.shotMods takes them: safe no-ops for null,
// an unknown id or a trick (a trick is never your own ball). With `assist`
// (ArcadeState.assist) the launch stage also applies the dispersion forgiveness to every
// non-putt (ctx.putt, from Game.handleShot), gimmeFt is the tap-in distance the round
// concedes, and the assist rides along for the putt hook. `curses` are the tricks played
// against the shooter (['gust', 'tiny-cup', 'fog'], any number): they stack on the ball's
// physics, `curses` lists the ones that applied, `gust` says which side the wind came
// from ({mph, from: 'left'|'right'}, picked by `random`) and `cupCurse` is the Tiny Cup's
// scales for the putt hook in Game.handleShot (the putting assist must not undo them).
function modifiersFor(id, assist = null, { curses = null, random = Math.random } = {}) {
  const p = ballOf(id);
  const tricks = trickList(curses);
  if (!p && !assist && !tricks.length) return NO_MODS;
  const a = assist ? normalizeAssist(assist) : null;
  const d = a ? a.dispersion : 1;
  let physics = p ? p.physicsOpts : NO_PHYSICS;
  let gust = null, cupCurse = null;
  if (tricks.length) {
    physics = { ...physics };
    for (const t of tricks) {
      const did = t.curse ? t.curse(physics, random) : null;
      if (did && did.gust) gust = did.gust;
      if (did && did.cupCurse) cupCurse = did.cupCurse;
    }
  }
  return {
    id: p ? p.id : null,
    launch: (l, ctx = null) => {
      let out = p && p.launchMods ? p.launchMods(l) : l;
      if (d < 1 && !(ctx && ctx.putt)) out = { ...out, hla: out.hla * d, spinAxis: out.spinAxis * d };
      return out;
    },
    physics,
    post: p && p.postProcess ? (sim, ctx) => p.postProcess(sim, ctx) : () => {},
    gimmeFt: a ? a.tapInFt : null,
    assist: a,
    curses: tricks.length ? tricks.map((t) => t.id) : NO_CURSES,
    gust,
    cupCurse,
  };
}

// The catalogue as the client sees it (no functions).
const catalogue = () => POWERUPS.map(({ id, name, emoji, rarity, tagline, kind, color }) => ({ id, name, emoji, rarity, tagline, kind, color }));

// ---------- grading ----------
const GRADES = Object.freeze(['DISASTER', 'MISS', 'OK', 'GOOD', 'GREAT', 'PERFECT', 'JACKPOT']);
const BASE_POINTS = Object.freeze({ JACKPOT: 1000, PERFECT: 850, GREAT: 650, GOOD: 450, OK: 250, MISS: 80, DISASTER: 0 });
const LABEL = Object.freeze({
  JACKPOT: 'JACKPOT!', PERFECT: 'PERFECT SHOT!', GREAT: 'GREAT SHOT', GOOD: 'GOOD', OK: 'OK', MISS: 'MISS', DISASTER: 'DISASTER',
});
const COIN_BONUS = Object.freeze({ JACKPOT: 100, PERFECT: 25, GREAT: 10 });
const STREAK_STEP = 0.25;
const STREAK_CAP = 3;
const POWERUP_MULT = 0.5;   // the ball did some of the work
const EXTEND = new Set(['JACKPOT', 'PERFECT', 'GREAT']);
const RESET = new Set(['MISS', 'DISASTER']);

const rank = (g) => GRADES.indexOf(g);
const higher = (a, b) => (rank(a) >= rank(b) ? a : b);
const lower = (a, b) => (rank(a) <= rank(b) ? a : b);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const r0 = (v) => Math.round(v);
const CLUB_NAMES = Object.freeze({
  DR: 'driver', W3: '3-wood', H3: 'hybrid', I4: '4-iron', I5: '5-iron', I6: '6-iron', I7: '7-iron',
  I8: '8-iron', I9: '9-iron', PW: 'pitching wedge', SW: 'sand wedge', LW: 'lob wedge', PT: 'putter',
});

// Typical carry of a CLUB_FULL preset on a flat fairway in standard air, simulated once.
const carryCache = new Map();
function typicalCarryYd(key) {
  const c = CLUB_FULL[key];
  if (!c) return null;
  let yd = carryCache.get(key);
  if (yd === undefined) {
    const sim = simulateShot({ speedMph: c.speedMph, vla: c.vla, hla: 0, totalSpin: c.spin, spinAxis: 0 }, { x: 0, y: 0 }, 0, () => 'fairway', {});
    yd = sim.carryYd;
    carryCache.set(key, yd);
  }
  return yd;
}

// The full-swing club nearest a ball speed, for shots with no club named.
function clubFromSpeed(speedMph) {
  let best = null;
  for (const [key, c] of Object.entries(CLUB_FULL)) {
    if (key === 'PT') continue;
    if (!best || Math.abs(c.speedMph - speedMph) < Math.abs(CLUB_FULL[best].speedMph - speedMph)) best = key;
  }
  return best;
}

const ftText = (ft) => (ft < 1 ? `${Math.max(1, Math.round(ft * 12))} in` : ft < 10 ? `${Math.round(ft * 10) / 10} ft` : `${Math.round(ft)} ft`);

// ---------- callouts ----------
// The single loudest thing to say about a shot: the HUD's banner and the announcer's
// line (voice id = callout id). The ids and texts are fixed by docs/dev/arcade-v2-contract.md
// (the voice lines are recorded from that table); the rules and numbers are below, in
// calloutFor. Tone picks the banner's colour and the crowd: epic, good, neutral, bad, funny.
const CALLOUTS = Object.freeze(Object.fromEntries([
  ['hole-in-one', 'HOLE IN ONE!!!', 'epic'],
  ['holed-out', 'HOLED OUT!', 'epic'],
  ['chip-in', 'CHIP IN!', 'epic'],
  ['drained', 'DRAINED IT!', 'epic'],
  ['in-the-hole', 'IN THE HOLE!', 'good'],
  ['pin-seeker', 'PIN SEEKER!', 'epic'],
  ['dart', 'DART!', 'good'],
  ['dance-floor', 'ON THE DANCE FLOOR!', 'good'],
  ['bomb', 'ABSOLUTE BOMB!', 'epic'],
  ['striped', 'STRIPED IT!', 'good'],
  ['perfect', 'PERFECT SHOT!', 'epic'],
  ['great-shot', 'GREAT SHOT!', 'good'],
  ['nice-shot', 'NICE SHOT!', 'good'],
  ['blast-off', 'BLAST OFF!', 'good'],
  ['robbed', 'ROBBED!', 'neutral'],
  ['so-close', 'SO CLOSE!', 'neutral'],
  ['terrible', 'TERRIBLE!', 'bad'],
  ['slice-house', 'SLICE HOUSE!', 'funny'],
  ['hook-city', 'HOOK CITY!', 'funny'],
  ['shank', 'SHANK-A-POTAMUS!', 'funny'],
  ['worm-burner', 'WORM BURNER!', 'funny'],
  ['sky-ball', 'SKY BALL!', 'funny'],
  ['chunk', 'CHUNK CITY!', 'funny'],
  ['splash', 'IN THE DRINK!', 'bad'],
  ['lava', 'MELTED!', 'funny'],
  ['ob', 'SEE YA!', 'bad'],
  ['beach', 'BEACH DAY!', 'funny'],
  ['timber', 'TIMBER!', 'funny'],
  ['on-fire', "YOU'RE ON FIRE!", 'epic'],
  ['unstoppable', 'UNSTOPPABLE!', 'epic'],
].map(([id, text, tone]) => [id, Object.freeze({ text, tone })])));

// The numbers the callouts turn on.
const CALLOUT_RULES = Object.freeze({
  offlineYd: 30,          // TERRIBLE / SLICE HOUSE / HOOK CITY: finishes farther than this off the aim line
  curveAxisDeg: 3,        // ... and a slice or a hook has at least this much spin axis as flown
  shankHlaDeg: 20,        // SHANK: the real ball starts this far off line ...
  shankMinMph: 35,        // ... and is more than a tap
  wormMinMph: 60,         // WORM BURNER: a full swing's ball speed ...
  wormApexFt: 9,          // ... that never gets this high
  skyVlaDeg: 28,          // SKY BALL: a tee shot launched at least this steeply ...
  skyCarryRatio: 0.7,     // ... that carries under this share of the club's distance,
  skyCarryYd: 170,        // or (club unknown, a hole of skyHoleYd or more) under this many yards
  skyHoleYd: 230,
  chunkCarryRatio: 0.6,   // CHUNK: a full shot carrying under this share of a named club's distance,
  chunkTotalRatio: 0.6,   // or a shot at a pin chunkMinYd..chunkMaxYd away that covers under this share of the way
  chunkMinYd: 15,
  chunkMaxYd: 230,
  bombCarryYd: 290,       // BOMB: a tee shot carrying this far,
  bombCarryRatio: 1.12,   // or this much over a driver's / wood's distance and at least bombMinYd
  bombMinYd: 230,
  stripedRatio: 0.015,    // STRIPED: offline under 1.5 % of the distance, on the fairway,
  stripedCarryRatio: 0.85,   // with at least this share of the club's distance
  pinSeekerFt: 3,
  dartFt: 10,
  danceFloorYd: 100,      // ON THE DANCE FLOOR: on the green from farther than this
  chipYd: 40,             // a chip: from this close, struck under chipMaxMph
  chipMaxMph: 70,
  teeMinMph: 100,         // a full swing on the range counts as a tee shot from this ball speed
  soCloseFt: 1,
  lagFt: 20,              // NICE SHOT for a putt left a tap-in away: only from this far
  lipM: 0.30,             // ROBBED: a rolling ball passes this close to the pin (or within lipEdgeM of the
  lipEdgeM: 0.12,         // edge of the cup the shot was played at, if that is farther out), at a pace a
  lipMinMps: 0.4,         // cup could have taken (still moving, not charging through), and stays out
  lipMaxMps: 2.5,
  streaks: Object.freeze([[5, 'unstoppable'], [3, 'on-fire']]),
});
const WOODS = new Set(['DR', 'W3', 'H3']);
const SHORT_CLUBS = new Set(['I8', 'I9', 'PW', 'SW', 'LW']);
const CUP_MODES = new Set(['putting', 'chipping', 'closest']);
const CUP_RADIUS_M = 0.22;   // lib/physics.js CUP_RADIUS

// How close the rolling ball came to the cup, and how fast it was going there. Null when
// it never rolled (a putt rolls all the way; any other shot from its last bounce on).
function cupPass(sim, pin) {
  const pts = Array.isArray(sim.points) ? sim.points : [];
  if (!pin || pts.length < 2) return null;
  const px = Array.isArray(pin) ? pin[0] : pin.x, py = Array.isArray(pin) ? pin[1] : pin.y;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  let from = 0;
  if (!sim.isPutt) {
    const events = Array.isArray(sim.events) ? sim.events : [];
    let last = null;
    for (const e of events) if (e.type === 'bounce') last = e;
    if (!last) return null;
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - last.x, pts[i].y - last.y);
      if (d <= best) { best = d; from = i; }
    }
  }
  let closestM = Infinity, speedMps = 0;
  for (let i = from + 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const u = len2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0;
    const d = Math.hypot(a.x + dx * u - px, a.y + dy * u - py);
    if (d < closestM) {
      closestM = d;
      const dt = b.t - a.t;
      speedMps = dt > 0 ? Math.sqrt(len2) / dt : 0;
    }
  }
  return Number.isFinite(closestM) ? { closestM, speedMps } : null;
}

// The callout id for a graded shot (null: nothing worth shouting). First match wins:
//   1 holed          hole-in-one, holed-out, chip-in, drained, in-the-hole
//   2 hazards        lava (water on a volcano stage), splash, ob
//   3 streak         unstoppable, on-fire: on the shot that takes the streak to 5 / 3
//   4 at the pin     robbed, pin-seeker, dart, dance-floor, so-close   (pinCallout)
//   5 mishits        timber, then shank, worm-burner, sky-ball, slice-house, hook-city,
//                    chunk, terrible (mishitCallout), then beach
//   6 the big ones   blast-off (a rocket-type ball), bomb, striped
//   7 the grade      perfect, great-shot, nice-shot
// A putt gets only the holed, robbed, so-close and (a long lag) nice-shot ones; a chip
// never gets the tee-shot ones (bomb, striped, slice-house, hook-city, sky-ball, terrible).
// A mishit that did not luck its way to the pin is a MISS at best (gradeShot caps the
// grade before the streak is looked at), tree or no tree.
function pinCallout(c) {
  const K = CALLOUT_RULES;
  const lipM = Math.max(K.lipM, CUP_RADIUS_M * c.cupRadiusScale + K.lipEdgeM);
  if (c.pass && c.pass.closestM <= lipM && c.pass.speedMps >= K.lipMinMps && c.pass.speedMps <= K.lipMaxMps) return 'robbed';
  if (c.isPutt) return c.leftFt !== null && c.leftFt <= K.soCloseFt ? 'so-close' : null;
  if (!c.chip && c.atPin && c.leftFt !== null) {
    if (c.leftFt <= K.pinSeekerFt) return 'pin-seeker';
    if (c.leftFt <= K.dartFt) return 'dart';
  }
  if (c.greenTarget && c.lie === 'green' && c.startYd !== null && c.startYd > K.danceFloorYd) return 'dance-floor';
  return c.chip && c.leftFt !== null && c.leftFt <= K.soCloseFt ? 'so-close' : null;
}

function mishitCallout(c) {
  const K = CALLOUT_RULES;
  if (c.isPutt) return null;
  if (Math.abs(c.real.hla) >= K.shankHlaDeg && c.real.speedMph >= K.shankMinMph) return 'shank';
  if (!c.chip && c.real.speedMph >= K.wormMinMph && c.apexFt !== null && c.apexFt < K.wormApexFt) return 'worm-burner';
  if (c.teeShot && c.real.vla >= K.skyVlaDeg && !SHORT_CLUBS.has(c.namedClub)) {
    const woodRef = c.mode === 'longdrive' ? typicalCarryYd('DR') : WOODS.has(c.namedClub) ? c.ref : null;
    if (woodRef ? c.carryYd <= K.skyCarryRatio * woodRef
      : !c.mode && !c.namedClub && c.startYd >= K.skyHoleYd && c.carryYd <= K.skyCarryYd) return 'sky-ball';
  }
  // Off line. A slice finishes right for a right-hander (left for a left-hander), a hook
  // the other way. A ball a Gust trick blew there is the trick's doing, not the swing's.
  const wide = !c.gusted && Math.abs(c.offlineYd) > K.offlineYd;
  const side = c.handed === 'LH' ? -1 : 1;
  if (wide && c.teeShot) {
    if (c.offlineYd * side > 0 && c.axis * side >= K.curveAxisDeg) return 'slice-house';
    if (c.offlineYd * side < 0 && c.axis * side <= -K.curveAxisDeg) return 'hook-city';
  }
  // Fat: a named club that carried far short of itself with the target out of its reach
  // (so not a partial swing), or a shot at a pin inside chunkMaxYd that got nowhere near
  // it. Never on the range: half swings are what a range is for.
  if (c.mode !== 'range') {
    if (c.full && !c.withinReach && c.namedClub && c.ref && c.carryYd < K.chunkCarryRatio * c.ref) return 'chunk';
    if (c.mode !== 'longdrive' && c.startYd !== null && c.leftYd !== null &&
        c.startYd >= K.chunkMinYd && c.startYd <= K.chunkMaxYd &&
        c.totalYd < K.chunkTotalRatio * c.startYd && c.leftYd > (1 - K.chunkTotalRatio) * c.startYd) return 'chunk';
  }
  return wide && c.full ? 'terrible' : null;
}

// c.pin / c.mishit: what pinCallout / mishitCallout made of the shot
function calloutFor(c) {
  const K = CALLOUT_RULES;
  if (c.holed) {
    if (c.isPutt) return c.longPutt ? 'drained' : 'in-the-hole';
    return c.ace ? 'hole-in-one' : c.chipIn ? 'chip-in' : 'holed-out';
  }
  if (c.wet) return c.theme === 'volcano' ? 'lava' : 'splash';
  if (c.ob) return 'ob';
  if (c.penalty) return null;
  if (EXTEND.has(c.grade)) for (const [n, id] of K.streaks) if (c.streak + 1 === n) return id;
  // a tee shot that is a bomb and found the green as well is a bomb first
  const bomb = c.teeShot && !c.boost && !c.tree && c.pu !== 'feather' &&
    (c.carryYd >= K.bombCarryYd || (WOODS.has(c.key) && c.ref && c.carryYd >= K.bombCarryRatio * c.ref && c.carryYd >= K.bombMinYd));
  if (c.pin === 'dance-floor' && bomb && !c.mishit) return 'bomb';
  if (c.pin) return c.pin;
  if (c.isPutt) return c.grade === 'GOOD' && c.startFt >= K.lagFt ? 'nice-shot' : null;
  if (c.tree) return 'timber';
  if (c.mishit) return c.mishit;
  if (c.lie === 'bunker') return 'beach';

  if (c.full && c.boost) return 'blast-off';
  if (bomb) return 'bomb';
  if (c.teeShot && c.onFairway && c.straightness < K.stripedRatio && !STRAIGHT_BALLS.has(c.pu) &&
      (!c.ref || c.carryYd >= K.stripedCarryRatio * c.ref)) return 'striped';

  return c.grade === 'PERFECT' ? 'perfect' : c.grade === 'GREAT' ? 'great-shot' : c.grade === 'GOOD' ? 'nice-shot' : null;
}
const STRAIGHT_BALLS = new Set(['laser', 'homing', 'titan']);   // the ball did the straight part

/**
 * Grade one shot.
 * @param {object} p.result   the shot result Game.handleShot returned (round or practice)
 * @param {object} p.before   game.state() before the shot (distToPinYd, pin, par, practice), or null
 * @param {object} p.practice before.practice (the session's state before the shot), or null
 * @param {number} p.streak   the streak going into this shot (points multiplier)
 * @param {string} p.powerup  the power-up used, or null (halves the points; Gold doubles them)
 * @param {string} p.theme    the course's arcade theme (course.arcade.theme), or null:
 *                            water on a 'volcano' stage is lava
 * @param {string} p.handed   'RH' (default) or 'LH': which way a slice goes
 */
function gradeShot({ result, before = null, practice = null, streak = 0, powerup: pu = null, theme = null, handed = 'RH' } = {}) {
  if (!result) throw new Error('gradeShot needs a shot result');
  const sim = result.sim || {};
  const events = Array.isArray(sim.events) ? sim.events : [];
  const shot = result.practice && result.practice.shot ? result.practice.shot : null;
  const mode = result.practice ? result.practice.mode : (practice && practice.mode) || null;
  const tags = [];
  const reasons = [];
  let grade = null;
  let frac = 0.5;   // quality within the grade's band, 0..1
  let approach = false;       // a round shot with the pin in the club's range
  let straightness = 1;       // |offline| / total of a full swing
  let ace = false, chipIn = false, longPutt = false;

  const wet = events.some((e) => e.type === 'water') || result.lie === 'water';
  const ob = result.lie === 'ob' || (result.penalty > 0 && /bounds/i.test(result.note || ''));
  const holedReal = events.some((e) => e.type === 'holed');
  const holed = Boolean(result.holed) && (holedReal || Boolean(shot && shot.holed));
  const totalYd = Number(sim.totalYd) || 0;
  const carryYd = Number(sim.carryYd) || 0;
  // How far off the aim line the SWING put the ball: what the day's wind did to it
  // (sim.windDriftYd, lib/game.js: the same swing flown in still air) is taken out, so a
  // ball aimed off to ride a crosswind is judged on the swing, not called "way right".
  const windDriftYd = Number.isFinite(sim.windDriftYd) ? sim.windDriftYd : 0;
  const offlineYd = (Number(sim.offlineYd) || 0) - windDriftYd;
  const leftYd = Number.isFinite(result.distToPinYd) ? result.distToPinYd : null;
  const leftFt = leftYd === null ? null : leftYd * 3;
  const startYd = before && Number.isFinite(before.distToPinYd) ? before.distToPinYd : null;
  const startFt = startYd === null ? (shot && shot.puttFt) || null : startYd * 3;
  const key = result.clubKey || (result.launch ? clubFromSpeed(result.launch.speedMph) : null);
  const clubName = CLUB_NAMES[key] || 'club';
  const ref = typicalCarryYd(key);

  if (wet || ob || (result.penalty > 0) || (shot && shot.counted === false && (result.lie === 'water' || result.lie === 'ob'))) {
    grade = 'DISASTER';
    reasons.push(wet ? 'Splash' : ob ? 'Out of bounds' : 'Penalty');
    tags.push(wet ? 'water' : ob ? 'ob' : 'penalty');
    frac = 0;
  } else if (holed) {
    if (sim.isPutt) {
      const from = startFt || totalYd * 3;
      if (from > 15) { grade = 'JACKPOT'; reasons.push(`Drained it from ${ftText(from)}`); tags.push('long-putt'); longPutt = true; }
      else { grade = 'PERFECT'; reasons.push(from > 3 ? `Holed from ${ftText(from)}` : 'In the hole'); frac = clamp01(from / 15); }
      tags.push('holed');
    } else {
      grade = 'JACKPOT';
      ace = (!result.practice && result.strokes === 1) || /hole in one/i.test(result.note || '') || /hole in one/i.test((shot && shot.note) || '');
      chipIn = !ace && (startYd ?? totalYd) <= CALLOUT_RULES.chipYd;   // holed from off the green, close in
      if (ace) { reasons.push('HOLE IN ONE!'); tags.push('ace'); }
      else if (chipIn) { reasons.push(`Chipped in from ${Math.round(totalYd)} yd`); tags.push('chip-in'); }
      else reasons.push(`Holed out from ${Math.round(totalYd)} yd!`);
      tags.push('holed', 'hole-out');
    }
  } else if (sim.isPutt) {
    tags.push('putt');
    const left = leftFt ?? 0;
    const from = startFt || 0;
    if (left <= 2) { grade = 'GOOD'; reasons.push(left < 0.5 ? 'Lipped out' : 'Tap-in left'); frac = clamp01(1 - left / 2); }
    else if (left <= Math.max(5, 0.15 * from)) { grade = 'OK'; reasons.push(`${ftText(left)} left`); frac = 0.5; }
    else {
      grade = 'MISS';
      reasons.push(from && left > from ? 'Farther away than you started' : `${ftText(left)} left`);
      frac = 0.2;
    }
    if (result.holed && !holedReal) { grade = higher(grade, 'OK'); tags.push('tap-in'); }   // conceded
  } else if (mode === 'closest' && shot) {
    const ft = shot.toTargetYd * 3;
    if (ft <= 10) { grade = 'PERFECT'; reasons.push('Inside 10 ft'); frac = clamp01(1 - ft / 10); }
    else if (ft <= 25) { grade = 'GREAT'; reasons.push('Inside 25 ft'); frac = clamp01(1 - (ft - 10) / 15); }
    else if (ft <= 45) { grade = 'GOOD'; reasons.push('On the dance floor'); frac = 0.5; }
    else if (ft <= 90) { grade = 'OK'; reasons.push(`${Math.round(ft)} ft from the pin`); frac = 0.5; }
    else { grade = 'MISS'; reasons.push(`${Math.round(shot.toTargetYd)} yd from the pin`); frac = 0.2; }
  } else if (mode === 'targets' && shot) {
    const pts = shot.points || 0;
    grade = pts >= 10 ? 'PERFECT' : pts >= 5 ? 'GREAT' : pts >= 3 ? 'GOOD' : pts >= 1 ? 'OK' : 'MISS';
    reasons.push(pts >= 10 ? 'Bullseye' : pts > 0 ? `${pts} point${pts === 1 ? '' : 's'} at ${shot.targetYd} yd` : `${Math.round(shot.toTargetYd)} yd off the flag`);
    frac = pts >= 10 ? clamp01(1 - shot.toTargetYd / 3) : 0.5;
  } else if (mode === 'chipping' && shot) {
    const pts = shot.points || 0;
    grade = pts >= 5 ? 'PERFECT' : pts >= 3 ? 'GREAT' : pts >= 2 ? 'GOOD' : pts >= 1 ? 'OK' : 'MISS';
    reasons.push(pts >= 5 ? 'Inside 3 ft' : pts > 0 ? `${ftText(shot.leftFt)} from the cup` : `${ftText(shot.leftFt)} away`);
    frac = pts >= 5 ? clamp01(1 - shot.leftFt / 3) : 0.5;
  } else if (mode === 'ladder' && shot) {
    if (shot.climbed) {
      grade = shot.toTargetYd <= 3 ? 'PERFECT' : 'GREAT';
      reasons.push(shot.toTargetYd <= 3 ? `Rung cleared, inside 3 yd` : 'Rung cleared');
      frac = clamp01(1 - shot.toTargetYd / 7);
      tags.push('climbed');
    } else if (shot.toTargetYd <= 15) { grade = 'OK'; reasons.push(`${Math.round(shot.toTargetYd)} yd off the rung`); }
    else { grade = 'MISS'; reasons.push(`${Math.round(shot.toTargetYd)} yd off the rung`); frac = 0.2; }
  } else {
    // a full swing: a drive, a lay-up, an approach, a range ball, a long drive
    straightness = Math.abs(offlineYd) / Math.max(totalYd, 1);
    let sStraight;
    if (straightness < 0.015) { sStraight = 1; reasons.push('Dead straight'); tags.push('straight'); }
    else if (straightness < 0.04) { sStraight = 0.75; reasons.push('Straight'); }
    else if (straightness < 0.08) { sStraight = 0.45; reasons.push(`Leaked ${Math.round(Math.abs(offlineYd))} yd ${offlineYd > 0 ? 'right' : 'left'}`); }
    else if (straightness < 0.12) { sStraight = 0.2; reasons.push(`${Math.round(Math.abs(offlineYd))} yd ${offlineYd > 0 ? 'right' : 'left'}`); }
    else { sStraight = 0; reasons.push(`Way ${offlineYd > 0 ? 'right' : 'left'}`); tags.push('wayward'); }

    // an approach: a round shot with the pin in the club's range (a par-3 tee shot, an
    // iron in, a chip). It is judged on where it finishes, not on how far it went.
    approach = !mode && startYd !== null && leftYd !== null && startYd <= Math.max(40, (ref || 0) * 1.1 + 10);
    let sDist = 0.7;
    if (ref && !approach) {
      const ratio = carryYd / ref;
      const diff = Math.round(carryYd - ref);
      if (ratio >= 1.08) { sDist = 1; reasons.push(`Piped it: +${diff} yd over your ${clubName}`); tags.push('piped'); }
      else if (ratio >= 0.97) { sDist = 0.9; reasons.push('Full value'); }
      else if (ratio >= 0.88) { sDist = 0.65; }
      else if (ratio >= 0.75) { sDist = 0.35; reasons.push(`${-diff} yd short of your ${clubName}`); }
      else { sDist = 0.1; reasons.push(`Chunked it: ${-diff} yd short`); tags.push('chunk'); }
    }

    const lie = result.lie;
    let sLie = 1;
    if (lie === 'rough') { sLie = 0.5; reasons.push('In the rough'); tags.push('rough'); }
    else if (lie === 'bunker') { sLie = 0.25; reasons.push('Bunkered'); tags.push('bunker'); }
    else if (lie === 'green') tags.push('green');
    else if (lie === 'fairway' || lie === 'tee') tags.push('fairway');

    const q = 0.45 * sStraight + 0.35 * sDist + 0.2 * sLie;
    grade = q >= 0.9 ? 'PERFECT' : q >= 0.72 ? 'GREAT' : q >= 0.5 ? 'GOOD' : q >= 0.3 ? 'OK' : 'MISS';
    frac = clamp01((q - (q >= 0.9 ? 0.9 : q >= 0.72 ? 0.72 : q >= 0.5 ? 0.5 : q >= 0.3 ? 0.3 : 0)) / 0.2);

    if (mode === 'longdrive' && shot) {
      if (shot.counted === false) { grade = lower(grade, 'MISS'); reasons.unshift('Out of the grid'); tags.push('out-of-grid'); }
      else if (shot.distanceYd) reasons.unshift(`${Math.round(shot.distanceYd)} yd in the grid`);
    } else if (mode === 'range' && shot) {
      if (shot.toTargetYd <= 5) { grade = higher(grade, 'GREAT'); reasons.unshift(`Inside 5 yd of the ${shot.targetYd} flag`); }
    } else if (!mode && leftFt !== null) {
      // round play: where it leaves you
      if (approach) {
        tags.push('approach');
        const sand = lie === 'bunker';   // close to the pin but in a bunker is a missed green, not a great shot
        if (leftFt <= 10 && !sand) { grade = 'PERFECT'; reasons.unshift('Inside 10 ft'); frac = clamp01(1 - leftFt / 10); tags.push('inside-10ft'); }
        else if (leftFt <= 25 && !sand) { grade = 'GREAT'; reasons.unshift('Inside 25 ft'); frac = clamp01(1 - (leftFt - 10) / 15); tags.push('inside-25ft'); }
        else if (lie === 'green') { grade = 'GOOD'; reasons.unshift(`On the green, ${Math.round(leftFt)} ft away`); frac = clamp01(1 - (leftFt - 25) / 50); }
        else if (leftYd <= Math.max(10, 0.15 * startYd)) { grade = 'OK'; reasons.unshift(`Missed the green, ${Math.round(leftYd)} yd away`); frac = 0.5; }
        else { grade = 'MISS'; reasons.unshift(`${Math.round(leftYd)} yd from the pin`); frac = 0.2; }
      } else if (leftFt <= 25 && lie !== 'bunker') {   // a drive that got all the way there
        grade = higher(grade, leftFt <= 10 ? 'PERFECT' : 'GREAT');
        reasons.unshift(leftFt <= 10 ? 'Inside 10 ft' : 'Inside 25 ft');
        tags.push(leftFt <= 10 ? 'inside-10ft' : 'inside-25ft');
      }
      if (startYd !== null && startYd > 0) {
        const gain = (startYd - leftYd) / startYd;
        if (gain < 0) { grade = lower(grade, 'MISS'); reasons.unshift('Farther from the pin than you started'); tags.push('backwards'); frac = Math.min(frac, 0.2); }
        else if (gain > 0.8 && !approach) tags.push('big-gain');
      }
      if (result.holed && !holedReal) tags.push('tap-in');   // stopped inside the tap-in circle
    }
    // however it was struck, a ball in the sand is no GREAT shot (and builds no streak)
    if (lie === 'bunker' && rank(grade) > rank('GOOD')) { grade = 'GOOD'; frac = Math.min(frac, 0.5); }
  }

  // ---- the callout: the one loud thing about this shot ----
  const usedBall = powerup(pu);
  const stamp = result.arcadeShot || null;   // what the arcade layer did to it (Game.handleShot)
  const flown = result.launch || {};
  const realIn = (stamp && stamp.realLaunch) || flown;   // the monitor's own ball: a callout is about the swing
  const real = { speedMph: Number(realIn.speedMph) || 0, vla: Number(realIn.vla) || 0, hla: Number(realIn.hla) || 0 };
  const isPutt = Boolean(sim.isPutt);
  const K = CALLOUT_RULES;
  const round = !mode;
  const chip = !isPutt && real.speedMph < K.chipMaxMph &&
    (mode === 'chipping' || (mode !== 'range' && mode !== 'longdrive' && startYd !== null && startYd <= K.chipYd));
  const full = !isPutt && !chip;
  // a tee shot: a hole's first stroke on a par 4 or 5, or a full swing on the range
  const teeShot = full && (round
    ? Boolean(before && before.strokes === 0 && before.par >= 4)
    : (mode === 'range' || mode === 'longdrive') && (real.speedMph >= K.teeMinMph || WOODS.has(result.clubKey)));
  const hazard = wet || ob || result.penalty > 0;
  const hasCup = round ? Boolean(before && before.pin) : CUP_MODES.has(mode) && Boolean(before && before.pin) &&
    (mode !== 'closest' || Boolean(practice && practice.holeIndex != null));
  const pass = hasCup && !holed && !holedReal && !hazard ? cupPass(sim, before.pin) : null;
  const practiceLie = result.lie !== 'rough' && result.lie !== 'bunker' && Math.abs(offlineYd) <= 15 && !(shot && shot.counted === false);
  const onFairway = !hazard && (round ? result.lie === 'fairway' || result.lie === 'green' || result.lie === 'tee' : practiceLie);
  const seen = {
    grade, streak: Math.max(0, streak | 0), theme, handed: String(handed || 'RH').toUpperCase(), mode, pu,
    boost: Boolean(usedBall && usedBall.boost),
    holed, ace, chipIn, longPutt, wet, ob, penalty: hazard,
    isPutt, chip, full, teeShot,
    withinReach: startYd !== null && startYd <= Math.max(40, (ref || 0) * 1.1 + 10),   // a partial swing is no mishit
    // the pin (or the flag the game is played at) is what the shot is judged against
    atPin: round || mode === 'closest' || mode === 'targets' || mode === 'ladder' || mode === 'range',
    greenTarget: round || mode === 'closest',
    startYd, startFt: startFt || 0, leftYd, leftFt, lie: result.lie, onFairway,
    carryYd, totalYd, offlineYd, straightness, apexFt: Number.isFinite(sim.apexFt) ? sim.apexFt : null,
    axis: Number(flown.spinAxis) || 0, real,
    key, namedClub: result.clubKey || null, ref,
    tree: events.some((e) => e.type === 'tree'),
    gusted: Boolean(stamp && Array.isArray(stamp.curses) && stamp.curses.includes('gust')),
    pass, cupRadiusScale: stamp && stamp.cup && Number.isFinite(stamp.cup.radiusScale) ? stamp.cup.radiusScale : 1,
  };
  const live = !holed && !hazard;   // a ball in play that is not in the hole
  seen.pin = live ? pinCallout(seen) : null;
  seen.mishit = live ? mishitCallout(seen) : null;
  // a mishit is a MISS at best (a topped drive that ran 100 yd down the fairway is no
  // GOOD shot), unless it lucked its way to the pin
  if (seen.mishit && !seen.pin) {
    if (rank(grade) > rank('MISS')) { grade = 'MISS'; frac = Math.min(frac, 0.2); }
    seen.grade = grade;
    tags.push('mishit');
  }
  const id = calloutFor(seen);
  const callout = id ? { id, text: CALLOUTS[id].text, tone: CALLOUTS[id].tone, voice: id } : null;

  const basePoints = grade === 'JACKPOT' ? 1000 : Math.min(1000, r0(BASE_POINTS[grade] + 100 * clamp01(frac)));
  const streakMult = Math.min(STREAK_CAP, 1 + STREAK_STEP * Math.max(0, streak | 0));
  const puMult = pu ? (usedBall && usedBall.payout) || POWERUP_MULT : 1;   // Gold: x2
  const points = r0(basePoints * streakMult * puMult);
  // a ball that pays over the odds pays exactly that multiple of a plain ball's coins
  const coins = puMult > 1
    ? (r0(r0(basePoints * streakMult) / 10) + (COIN_BONUS[grade] || 0)) * puMult
    : r0(points / 10) + (COIN_BONUS[grade] || 0);
  if (pu) tags.push(`powerup:${pu}`);
  if (streak >= 3) tags.push('on-fire');

  return {
    grade,
    label: LABEL[grade],
    points,
    basePoints,
    multiplier: { streak: +streakMult.toFixed(2), powerup: puMult, total: +(streakMult * puMult).toFixed(3) },
    coins,
    reasons,
    tags,
    quality: +clamp01(frac).toFixed(2),
    callout,
    curses: stamp && Array.isArray(stamp.curses) ? [...stamp.curses] : [],   // the tricks this shot was hit under
    gust: (stamp && stamp.gust) || null,                                      // { mph, from: 'left' | 'right' }
    // the shot in numbers, for the challenges (ArcadeState.applyShot)
    facts: {
      tee: teeShot, putt: isPutt, chip, holed, hazard, fairway: teeShot && onFairway, lie: result.lie || null,
      straight: full && straightness < K.stripedRatio,
      carryYd, totalYd, offlineYd, fromYd: startYd, leftFt, fromFt: startFt || null,
      boosted: Boolean(usedBall && usedBall.boost),
    },
  };
}

// ---------- the player's arcade state ----------
// XP curve: level L starts at 500 * (L - 1) * L xp (1000, 3000, 6000, 10000, ...).
const xpForLevel = (L) => 500 * (L - 1) * L;
function levelFor(xp) {
  let L = 1;
  while (xp >= xpForLevel(L + 1)) L++;
  return L;
}

class ArcadeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const nonNeg = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

// ---------- challenges ----------
// Three are live at a time, drawn in this order (a finished one is paid at once and the
// next one not already live takes its place; after the last comes the first again).
// Every one is about a single player's real swings: nothing here needs an opponent.
//   next(progress, x) -> the new progress; x = { f: the shot's facts (gradeShot), grade,
//   points, callout: id | null, powerup: id | null, streak: the streak after the shot }
const count = (hit) => (p, x) => p + (hit(x) ? 1 : 0);
const inARow = (counts, hit) => (p, x) => (counts(x) ? (hit(x) ? p + 1 : 0) : p);
const GREAT_UP = new Set(['GREAT', 'PERFECT', 'JACKPOT']);
const CHALLENGES = Object.freeze([
  { id: 'fairways-3', text: 'Hit 3 fairways in a row', goal: 3, coins: 150, balls: ['bouncy'],
    next: inARow((x) => x.f.tee, (x) => x.f.fairway) },
  { id: 'inside-10', text: 'Stick one inside 10 feet', goal: 1, coins: 200, balls: ['sticky'],
    next: count((x) => !x.f.putt && !x.f.chip && !x.f.hazard && x.f.leftFt !== null && x.f.leftFt <= 10) },
  { id: 'great-5', text: 'Hit 5 GREAT shots or better', goal: 5, coins: 200, balls: ['windcutter'],
    next: count((x) => GREAT_UP.has(x.grade)) },
  { id: 'carry-200', text: 'Carry a drive 200 yards', goal: 1, coins: 100, balls: [],
    next: count((x) => x.f.tee && !x.f.boosted && x.f.carryYd >= 200) },
  { id: 'putt-10', text: 'Hole a putt from 10 feet or more', goal: 1, coins: 200, balls: ['yoyo'],
    next: count((x) => x.f.putt && x.f.holed && x.f.fromFt >= 10) },
  { id: 'straight-3', text: 'Hit 3 dead-straight shots', goal: 3, coins: 150, balls: ['titan'],
    next: count((x) => x.f.straight && !x.f.hazard) },
  { id: 'greens-3', text: 'Hit 3 greens from 100 yards or more', goal: 3, coins: 250, balls: ['feather'],
    next: count((x) => !x.f.putt && !x.f.hazard && x.f.lie === 'green' && x.f.fromYd >= 100) },
  { id: 'streak-4', text: 'Build a streak of 4', goal: 4, coins: 300, balls: ['magnet'],
    next: (p, x) => Math.max(p, x.streak) },
  { id: 'yards-1500', text: 'Rack up 1,500 yards of carry', goal: 1500, coins: 150, balls: ['moonball'],
    next: (p, x) => p + (x.f.putt || x.f.hazard ? 0 : Math.round(x.f.carryYd)) },
  { id: 'close-3', text: 'Finish 3 shots inside 25 feet', goal: 3, coins: 200, balls: ['ghost'],
    next: count((x) => !x.f.putt && !x.f.hazard && x.f.leftFt !== null && x.f.leftFt <= 25) },
  { id: 'perfect-2', text: 'Hit 2 PERFECT shots', goal: 2, coins: 250, balls: ['laser'],
    next: count((x) => x.grade === 'PERFECT' || x.grade === 'JACKPOT') },
  { id: 'putts-3', text: 'Hole 3 putts', goal: 3, coins: 150, balls: ['skipper'],
    next: count((x) => x.f.putt && x.f.holed) },
  { id: 'carry-250', text: 'Carry a drive 250 yards', goal: 1, coins: 300, balls: ['fireball'],
    next: count((x) => x.f.tee && !x.f.boosted && x.f.carryYd >= 250) },
  { id: 'clean-6', text: 'Play 6 shots in a row with no MISS', goal: 6, coins: 200, balls: ['skipper'],
    next: inARow(() => true, (x) => !RESET.has(x.grade)) },
  { id: 'chip-3ft', text: 'Chip one inside 3 feet', goal: 1, coins: 150, balls: ['sticky'],
    next: count((x) => x.f.chip && !x.f.hazard && (x.f.holed || (x.f.leftFt !== null && x.f.leftFt <= 3))) },
  { id: 'points-5000', text: 'Score 5,000 points', goal: 5000, coins: 200, balls: ['rocket'],
    next: (p, x) => p + x.points },
  { id: 'powerups-3', text: 'Play 3 power-up balls', goal: 3, coins: 100, balls: ['bouncy'],
    next: count((x) => Boolean(x.powerup)) },
  { id: 'dance-150', text: 'Find the green from 150 yards or more', goal: 1, coins: 300, balls: ['gold'],
    next: count((x) => !x.f.putt && !x.f.hazard && x.f.lie === 'green' && x.f.fromYd >= 150) },
  { id: 'fairways-5', text: 'Hit 5 fairways', goal: 5, coins: 200, balls: ['windcutter'],
    next: count((x) => x.f.tee && x.f.fairway) },
  { id: 'inside-3', text: 'Stick one inside 3 feet', goal: 1, coins: 400, balls: ['homing'],
    next: count((x) => !x.f.putt && !x.f.chip && !x.f.hazard && x.f.leftFt !== null && x.f.leftFt <= 3) },
  { id: 'bomb', text: 'Hit an ABSOLUTE BOMB', goal: 1, coins: 400, balls: ['rocket'],
    next: count((x) => x.callout === 'bomb') },
].map((c) => Object.freeze({ ...c, balls: Object.freeze(c.balls) })));
const CHALLENGE_BY_ID = new Map(CHALLENGES.map((c) => [c.id, c]));
const CHALLENGES_LIVE = 3;
// a challenge as the client sees it
const challengeView = (def, progress, done = false) => ({
  id: def.id, text: def.text, progress: Math.min(def.goal, Math.max(0, Math.round(progress))), goal: def.goal, done,
  reward: { coins: def.coins, balls: [...def.balls] },
});

class ArcadeState {
  // { dataDir: where arcade.json lives (null: in memory only), random, log }
  constructor({ dataDir = null, random = Math.random, log = console } = {}) {
    this.file = dataDir ? path.join(dataDir, 'arcade.json') : null;
    this.random = random;
    this.log = log;
    this.assist = { ...ASSIST_DEFAULTS };   // settings, not progress: reset() keeps them
    this._defaults();
    this._load();
  }

  _defaults() {
    this.enabled = true;
    // unlimited: party mode. Every ball is always on the shelf and never runs out. The
    // armed ball is still spent from the armed slot by its shot (it must be armed again:
    // a ball left armed boosts the chip and the putt that follow and flies the green).
    // Kept across a reset().
    if (this.unlimited === undefined) this.unlimited = false;
    this.coins = 0;
    this.xp = 0;
    this.level = 1;
    this.streak = 0;
    this.bestStreak = 0;
    this.shots = 0;
    this.inventory = { ...STARTING_INVENTORY };
    this.armed = null;
    this.history = [];
    this.challenges = [];        // the live ones: [{ id, progress }]
    this.challengeCursor = 0;    // where in CHALLENGES the next one is drawn from
    this.challengesDone = 0;
    this._fillChallenges();
  }

  // Draw challenges until three are live: the next in the pool that is not live already.
  _fillChallenges() {
    while (this.challenges.length < Math.min(CHALLENGES_LIVE, CHALLENGES.length)) {
      let def = null;
      for (let i = 0; i < CHALLENGES.length && !def; i++) {
        const c = CHALLENGES[(this.challengeCursor + i) % CHALLENGES.length];
        if (!this.challenges.some((live) => live.id === c.id)) {
          def = c;
          this.challengeCursor = (this.challengeCursor + i + 1) % CHALLENGES.length;
        }
      }
      this.challenges.push({ id: def.id, progress: 0 });
    }
  }

  // Move the live challenges on by one graded shot. A finished one pays its coins and
  // balls at once and is replaced; returns the finished ones as the client sees them.
  _advanceChallenges(g, powerupUsed) {
    if (!g.facts || typeof g.facts !== 'object') return [];   // not a shot gradeShot graded
    const x = {
      f: g.facts, grade: g.grade, points: nonNeg(g.points), callout: g.callout ? g.callout.id : null,
      powerup: powerup(powerupUsed) ? powerupUsed : null, streak: this.streak,
    };
    const finished = [];
    this.challenges = this.challenges.filter((live) => {
      const def = CHALLENGE_BY_ID.get(live.id);
      const p = Number(def.next(live.progress, x));
      live.progress = Number.isFinite(p) && p > 0 ? p : 0;
      if (live.progress < def.goal) return true;
      this.coins += def.coins;
      for (const id of def.balls) this.grant(id);
      this.challengesDone++;
      finished.push(challengeView(def, def.goal, true));
      return false;
    });
    this._fillChallenges();
    return finished;
  }

  // The shot modifiers for the next ball: the power-up's (null: a plain ball) with the
  // assists on top, and any tricks played against the shooter ({ curses: ['gust'] }: the
  // match engine's). What the server hands Game.shotMods while the layer is enabled.
  // putting ('easy' | 'assist' | 'off'): the putting assist of this one shot instead of
  // the bay's own (a match plays its own level: lib/match.js `putting`).
  shotMods(powerupId = null, { curses = null, putting = null } = {}) {
    const assist = PUTTING_LEVELS.includes(putting) ? { ...this.assist, putting } : this.assist;
    return modifiersFor(powerupId, assist, { curses, random: this.random });
  }

  // Change the assists ({putting, dispersion, tapInFt}, any of them). Throws ArcadeError.
  setAssist(patch) {
    this.assist = normalizeAssist(patch, this.assist);
    this._save();
    return this.assist;
  }

  _load() {
    if (!this.file) return;
    let raw;
    try { raw = fs.readFileSync(this.file, 'utf8'); } catch (err) {
      if (err.code !== 'ENOENT') this.log.warn(`[arcade] cannot read ${path.basename(this.file)}: ${err.message}`);
      return;
    }
    try {
      const data = JSON.parse(raw);
      const s = data && typeof data === 'object' && data.state && typeof data.state === 'object' ? data.state : data;
      if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('not an object');
      this.enabled = s.enabled !== false;
      this.unlimited = s.unlimited === true;
      try { this.assist = normalizeAssist(s.assist); } catch (_) { this.assist = { ...ASSIST_DEFAULTS }; }
      this.coins = nonNeg(s.coins);
      this.xp = nonNeg(s.xp);
      this.level = levelFor(this.xp);
      this.streak = nonNeg(s.streak);
      this.bestStreak = Math.max(this.streak, nonNeg(s.bestStreak));
      this.shots = nonNeg(s.shots);
      this.inventory = {};
      if (s.inventory && typeof s.inventory === 'object') {
        // balls only: a trick has no target in solo play, so it is never on the bay's shelf
        for (const [id, n] of Object.entries(s.inventory)) if (ballOf(id) && nonNeg(n) > 0) this.inventory[id] = nonNeg(n);
      }
      this.armed = ballOf(s.armed) && this.inventory[s.armed] > 0 ? s.armed : null;
      this.history = Array.isArray(s.history)
        ? s.history.filter((h) => h && typeof h === 'object' && GRADES.includes(h.grade)).slice(0, HISTORY_MAX)
          .map((h) => ({ shotId: h.shotId ?? null, grade: h.grade, points: nonNeg(h.points), powerup: powerup(h.powerup) ? h.powerup : null, at: h.at ?? null }))
        : [];
      // a version 1 file has no challenges: the first three start fresh
      this.challenges = [];
      for (const c of Array.isArray(s.challenges) ? s.challenges : []) {
        const def = c && typeof c === 'object' ? CHALLENGE_BY_ID.get(c.id) : null;
        if (!def || this.challenges.length >= CHALLENGES_LIVE || this.challenges.some((live) => live.id === def.id)) continue;
        this.challenges.push({ id: def.id, progress: Math.min(nonNeg(c.progress), def.goal - 1) });
      }
      this.challengeCursor = nonNeg(s.challengeCursor) % CHALLENGES.length;
      this.challengesDone = nonNeg(s.challengesDone);
      this._fillChallenges();
    } catch (err) {
      this.log.warn(`[arcade] ignoring ${path.basename(this.file)}: ${err.message}`);
      try { fs.renameSync(this.file, `${this.file}.corrupt`); } catch (_) { /* leave it */ }
      this._defaults();
      this.assist = { ...ASSIST_DEFAULTS };
    }
  }

  _save() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: FILE_VERSION, state: this._data() }, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      this.log.warn(`[arcade] could not save: ${err.message}`);
    }
  }

  _data() {
    return {
      enabled: this.enabled, unlimited: this.unlimited === true, assist: { ...this.assist },
      coins: this.coins, xp: this.xp, level: this.level, streak: this.streak,
      bestStreak: this.bestStreak, shots: this.shots, inventory: { ...this.inventory }, armed: this.armed,
      history: this.history.slice(0, HISTORY_MAX),
      challenges: this.challenges.map((c) => ({ id: c.id, progress: c.progress })),
      challengeCursor: this.challengeCursor, challengesDone: this.challengesDone,
    };
  }

  owned(id) { return this.inventory[id] || 0; }

  // Arm a power-up for the next shot (null: disarm). Throws ArcadeError when unknown,
  // not owned, or a trick (TRICK_NEEDS_OPPONENT: a trick is played on an opponent in a
  // match, never on the bay's own ball, unlimited mode included). Returns the armed id.
  arm(id) {
    if (id === null || id === undefined || id === '') { this.armed = null; this._save(); return null; }
    const p = powerup(id);
    if (!p) throw new ArcadeError('UNKNOWN_POWERUP', `No such power-up: ${id}`);
    if (p.kind !== 'ball') throw new ArcadeError('TRICK_NEEDS_OPPONENT', `${p.name} is a trick: play it on your opponent in a match`);
    if (!this.unlimited && !this.owned(p.id)) throw new ArcadeError('NOT_OWNED', `You have no ${p.name} ball`);
    this.armed = p.id;
    this._save();
    return this.armed;
  }

  // Take the armed power-up off the shelf for this shot: its id (one fewer in the
  // inventory, nothing armed), or null. Unlimited mode: the shelf never runs out, but the
  // ball is still spent from the armed slot (arm it again for the next shot).
  consumeArmed() {
    const id = this.armed;
    if (id && this.unlimited) {
      this.armed = null;
      this._save();
      return powerup(id) ? id : null;
    }
    this.armed = null;
    if (!id || !this.owned(id)) { if (id) this._save(); return null; }
    this.inventory[id]--;
    if (!this.inventory[id]) delete this.inventory[id];
    this._save();
    return id;
  }

  // A consumed power-up whose shot never happened goes back, armed again.
  refund(id) {
    if (!powerup(id)) return;
    if (!this.unlimited) this.inventory[id] = this.owned(id) + 1;
    this.armed = id;
    this._save();
  }

  // Put balls on the shelf (in memory: the caller saves). Tricks and unknown ids are
  // skipped: the bay's shelf holds only what a solo player can arm.
  grant(id, n = 1) {
    if (!ballOf(id) || !(n > 0)) return false;
    this.inventory[id] = this.owned(id) + Math.floor(n);
    return true;
  }

  // Add balls to the bay's inventory (a match chest, a prize): an id or a list of ids,
  // one ball each. Tricks and unknown ids are skipped. Saves; returns the snapshot.
  grantBalls(ids) {
    for (const id of Array.isArray(ids) ? ids : ids ? [ids] : []) this.grant(String(id));
    this._save();
    return this.snapshot();
  }

  // Add coins to the bay's wallet (negative: spend; never below zero). Saves; returns the
  // snapshot.
  addCoins(n) {
    const add = Number(n);
    if (Number.isFinite(add)) this.coins = Math.max(0, this.coins + Math.trunc(add));
    this._save();
    return this.snapshot();
  }

  // A random ball weighted by rarity (rare: only rare and epic ones). Never a trick.
  grantRandom({ rare = false } = {}) {
    const pool = POWERUPS.filter((p) => p.kind === 'ball' && (!rare || p.rarity !== 'common'));
    const total = pool.reduce((s, p) => s + (RARITY_WEIGHT[p.rarity] || 1), 0);
    let r = this.random() * total;
    let pick = pool[pool.length - 1];
    for (const p of pool) {
      r -= RARITY_WEIGHT[p.rarity] || 1;
      if (r < 0) { pick = p; break; }
    }
    this.grant(pick.id);
    return pick.id;
  }

  // Bank a graded shot: coins and xp, the streak, the level, and the power-ups it earns.
  // Every third streak step grants one (by rarity), a level-up two per level, a JACKPOT
  // a rare one.
  applyShot(g, { powerupUsed = null, shotId = null } = {}) {
    if (!g || !GRADES.includes(g.grade)) throw new Error('applyShot needs a grade');
    const points = nonNeg(g.points);
    const coins = nonNeg(g.coins);
    this.shots++;
    const extended = EXTEND.has(g.grade);
    if (extended) this.streak++;
    else if (RESET.has(g.grade)) this.streak = 0;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.coins += coins;
    this.xp += points;
    const was = this.level;
    this.level = levelFor(this.xp);
    const granted = [];
    if (extended && this.streak % 3 === 0) granted.push(this.grantRandom());   // not while holding at 3
    for (let L = was; L < this.level; L++) granted.push(this.grantRandom(), this.grantRandom());
    if (g.grade === 'JACKPOT') granted.push(this.grantRandom({ rare: true }));
    const challenges = this._advanceChallenges(g, powerupUsed);   // finished by this shot, already paid
    this.history.unshift({ shotId, grade: g.grade, points, powerup: powerup(powerupUsed) ? powerupUsed : null, at: Date.now() });
    if (this.history.length > HISTORY_MAX) this.history.length = HISTORY_MAX;
    this._save();
    return {
      awarded: { coins, xp: points, points },
      levelUp: this.level > was,
      level: this.level,
      granted,
      streak: this.streak,
      challenges,
    };
  }

  setUnlimited(on) {
    this.unlimited = Boolean(on);
    if (!this.unlimited && this.armed && !this.owned(this.armed)) this.armed = null;   // back to the real shelf
    this._save();
    return this.unlimited;
  }

  setEnabled(on) {
    this.enabled = Boolean(on);
    this._save();
    return this.enabled;
  }

  reset() {
    const enabled = this.enabled;
    this._defaults();
    this.enabled = enabled;
    this._save();
  }

  snapshot() {
    const next = xpForLevel(this.level + 1), base = xpForLevel(this.level);
    return {
      ...this._data(),
      levelXp: this.xp - base,          // xp into the current level ...
      levelSpan: next - base,           // ... of this many to the next
      nextLevelXp: next,
      powerups: catalogue(),
      callouts: CALLOUTS,
      // the three live challenges, as the HUD draws them (the saved form is _data's)
      challenges: this.challenges.map((c) => challengeView(CHALLENGE_BY_ID.get(c.id), c.progress)),
    };
  }
}

module.exports = {
  POWERUPS, GRADES, BASE_POINTS, STARTING_INVENTORY, ASSIST_DEFAULTS, PUTTING_LEVELS, ArcadeError, ArcadeState,
  CALLOUTS, CALLOUT_RULES, CHALLENGES, GUST_MPH, TINY_CUP,
  catalogue, gradeShot, levelFor, modifiersFor, normalizeAssist, typicalCarryYd, xpForLevel,
};
