'use strict';
// Match mode v2: an arcade-style 1v1 on one simulator bay, hot-seat, for a REAL launch
// monitor (docs/dev/arcade-v2-contract.md section 4, docs/match.md).
//
//   Formats     quick (one hole), bo3 (first to 2), bo9 (first to 5).
//   Stages      every hole of a match is a stage of the Clash Tour: its own single-hole
//               course (the tour manifest, <dataDir>/arcade-tour.json). stage 'current'
//               plays the course that is loaded instead (holes follow the course).
//   Honour      a coin flip on hole one, then the previous hole's winner. Both tee off,
//               then whoever is farther from the hole plays.
//   Knockout    the hole ends the moment it is decided. A is in with N: B, out with N
//               taken, has lost; B out with N-1 gets one swing and must hole it. A stroke
//               cap of par + 3: reaching it without holing out loses the hole to a player
//               who holes out (both capped: tied).
//   Tied hole   tieRule 'shootout' (default): SUDDEN DEATH at once, closest to the pin, one
//               ball each on a tiebreak arena (the same hole from 150 yd when there is no
//               arena). Water or out of bounds is a miss; both miss or within 0.1 ft: again,
//               the other player first. tieRule 'halve': the hole is halved and only a level
//               match at the end goes to sudden death.
//   Power-ups   'loadout' (default): charges for the match, any ball or trick, each id
//               once. A trick lands on the OPPONENT's next swing. 'unlimited', 'off'.
//   Putting     how much the arcade's putting assist helps in this match (lib/putt-assist.js):
//               'assist' (default: a putt to win can be missed), 'easy' or 'off'. The bay's
//               own setting is for solo play; the server arms every match swing with this.
//
// This module is a pure state machine: no I/O, no timers, no course loading. The Game
// (lib/game.js) holds ONE ball; the match keeps both players' positions and swaps the one
// who is up into the game (beforeShot / afterShot). Whatever needs the outside world is
// asked for through `match.waiting` and done by a driver (server.js driveMatch):
//
//   { for: 'stage', file, ... }   put the bay on that course, then stageReady(game, token)
//                                 (file null: the loaded course is the one; call it now)
//   { for: 'ready', timeoutMs }   the intro is showing: ready() on POST /api/match/ready,
//                                 or when the safety timeout runs out
//   { for: 'continue', ... }      the hole result is showing: continue() likewise
//   { for: 'dismiss', ... }       over: the driver drops the match after the timeout
//
// Swings only count in 'play' and 'tiebreak': in every other phase beforeShot() answers
// null and the caller drops the swing.

const { YD } = require('./physics');
const { initials } = require('./leagues');
const { gameWind, pendingWind } = require('./arcade-wind');   // the wind of each hole (stage.wind)

const MATCH_TIERS = Object.freeze([
  Object.freeze({ id: 'rookie', label: 'Rookie', entryFee: 50, trophies: 20 }),
  Object.freeze({ id: 'amateur', label: 'Amateur', entryFee: 200, trophies: 25 }),
  Object.freeze({ id: 'pro', label: 'Pro', entryFee: 1000, trophies: 30 }),
  Object.freeze({ id: 'master', label: 'Master', entryFee: 5000, trophies: 35 }),
]);
// target: holes to win; charges: power-up charges each (loadout); trophies / coins / chest:
// what a friendly win is worth (chest: random balls for the bay's shelf).
const MATCH_FORMATS = Object.freeze({
  quick: Object.freeze({ id: 'quick', label: 'Quick Match', target: 1, maxHoles: 1, charges: 2, trophies: 10, coins: 100, chest: 2 }),
  bo3: Object.freeze({ id: 'bo3', label: 'Best of 3', target: 2, maxHoles: 3, charges: 3, trophies: 20, coins: 250, chest: 2 }),
  bo9: Object.freeze({ id: 'bo9', label: 'Best of 9', target: 5, maxHoles: 9, charges: 6, trophies: 40, coins: 600, chest: 4 }),
});
const RANKS = Object.freeze([
  Object.freeze({ rank: 'Rookie', trophies: 0 }),
  Object.freeze({ rank: 'Amateur', trophies: 100 }),
  Object.freeze({ rank: 'Pro', trophies: 300 }),
  Object.freeze({ rank: 'Expert', trophies: 600 }),
  Object.freeze({ rank: 'Master', trophies: 1000 }),
  Object.freeze({ rank: 'Legend', trophies: 1500 }),
]);
const TOUR_STAGES = 9;           // tour order plays orders 1 to 9; stages beyond are extras
const STROKE_CAP = 3;            // par + this many strokes without holing out: capped
const TIEBREAK_TIE_FT = 0.1;     // tiebreak balls this close to each other are level: hit again
const SHOOTOUT_YD = 150;         // no arena: closest to the pin from this far out on the same hole
const STREAK_STEP = 5;           // bonus trophies per win in a row coming in ...
const STREAK_CAP = 15;           // ... up to this
const BANKROLL = 1000;           // coins a new profile starts with
// A stray ball: the launch monitor picked something up that was not a real swing (a ball
// rolled off the mat, a practice waggle). A ball slower than STRAY_MAX_MPH from farther
// than STRAY_MIN_YD, off anything but a green, is flagged (`stray: true`): it still counts
// unless the players take it back (undoLastShot). Putts and chips are never flagged.
const STRAY_MAX_MPH = 40;
const STRAY_MIN_YD = 40;
const LOG_MAX = 40;
const EVENTS_MAX = 12;
const CALLOUTS_MAX = 24;
// The safety timeouts the driver runs (the client normally answers long before).
const TIMEOUTS = Object.freeze({ readyMs: 25000, continueMs: 60000, doneMs: 600000 });
// The ball ids of the first catalogue: what a match falls back to when lib/arcade.js has none.
const POWERUPS = Object.freeze(['rocket', 'sticky', 'magnet', 'windcutter', 'laser', 'moonball', 'bouncy']);
const GRADES = Object.freeze(['DISASTER', 'MISS', 'OK', 'GOOD', 'GREAT', 'PERFECT', 'JACKPOT']);
const RARITY_WEIGHT = Object.freeze({ common: 60, rare: 30, epic: 10, legendary: 4 });

class MatchError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const r1 = (v) => Math.round(v * 10) / 10;
const int = (v, fallback = 0) => (Number.isFinite(+v) ? Math.round(+v) : fallback);
const nonNeg = (v, fallback = 0) => (Number.isFinite(+v) && +v >= 0 ? Math.floor(+v) : fallback);
const newId = (now) => `m_${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const distYd = (ball, pin) => Math.hypot(pin[0] - ball.x, pin[1] - ball.y) / YD;
const ftText = (ft) => (ft < 1 ? `${Math.max(1, Math.round(ft * 12))} in` : `${ft < 10 ? r1(ft) : Math.round(ft)} ft`);

// 'rookie', 'Rookie', 'ROOKIE' or a tier object -> the tier; null when none matches.
function tierFor(tier) {
  if (tier && typeof tier === 'object') return MATCH_TIERS.find((t) => t.id === tier.id || t.id === tier.tier) || null;
  const s = String(tier ?? '').trim().toLowerCase();
  return MATCH_TIERS.find((t) => t.id === s || t.label.toLowerCase() === s) || null;
}

// 'quick' | 'bo3' | 'bo9' (or the old `holes` 1 | 3 | 9) -> the format; null when none matches.
function formatFor(format, holes = null) {
  const s = String(format ?? '').trim().toLowerCase();
  if (MATCH_FORMATS[s]) return MATCH_FORMATS[s];
  const n = +holes || +format;
  return Object.values(MATCH_FORMATS).find((f) => f.maxHoles === n) || null;
}

// What a score is called: "an ace", "a birdie", "par", "a double bogey".
function scoreName(strokes, par) {
  if (strokes === 1) return 'an ace';
  const d = strokes - par;
  if (d <= -3) return 'an albatross';
  if (d === -2) return 'an eagle';
  if (d === -1) return 'a birdie';
  if (d === 0) return 'par';
  if (d === 1) return 'a bogey';
  if (d === 2) return 'a double bogey';
  if (d === 3) return 'a triple bogey';
  return `a +${d}`;
}

// The same-hole shootout's spot: yd from the pin back along the hole's line (pin -> tee),
// on the tee when the hole is shorter than that. Returns {x, y}.
function shootoutSpot(hole, yd = SHOOTOUT_YD) {
  const pts = Array.isArray(hole.line) && hole.line.length >= 2 ? hole.line : [hole.tee, hole.pin];
  const path = [...pts].reverse();   // from the pin back to the tee
  path[0] = hole.pin;
  let left = yd * YD;
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, ay] = path[i], [bx, by] = path[i + 1];
    const seg = Math.hypot(bx - ax, by - ay);
    if (seg >= left) {
      const f = seg ? left / seg : 0;
      return { x: ax + (bx - ax) * f, y: ay + (by - ay) * f };
    }
    left -= seg;
  }
  return { x: hole.tee[0], y: hole.tee[1] };
}

// ---------- profiles and rewards (pure: the server keeps the ledger) ----------

function rankFor(trophies) {
  let rank = RANKS[0].rank;
  for (const r of RANKS) if (trophies >= r.trophies) rank = r.rank;
  return rank;
}

// Any stored record (the first ledger kept { coins, trophies, streak, wins, losses }) -> a
// profile { trophies, rank, wins, losses, streak, bestStreak, coins }.
function normalizeProfile(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const trophies = nonNeg(s.trophies);
  const streak = nonNeg(s.streak);
  return {
    trophies, rank: rankFor(trophies),
    wins: nonNeg(s.wins), losses: nonNeg(s.losses),
    streak, bestStreak: Math.max(streak, nonNeg(s.bestStreak)),
    coins: nonNeg(s.coins, BANKROLL),
  };
}

// What a decided match pays. A friendly: trophies by format plus the streak bonus (5 per win
// in a row coming in, up to 15), the loser drops half the format's (never below 0), the
// winner's chest is random balls, plus coins. With stakes the tier's trophies move both ways
// and the pot is the winner's on top. winner.coins is everything the winner's profile gains;
// pot is the part of it that was the stakes.
function rewardsFor({ format, stakes = null, winStreak = 0, loserTrophies = 0, chest = [] } = {}) {
  const f = formatFor(format) || MATCH_FORMATS.quick;
  const tier = stakes ? tierFor(stakes) : null;
  const base = tier ? tier.trophies : f.trophies;
  const streakBonus = Math.min(STREAK_CAP, nonNeg(winStreak) * STREAK_STEP);
  const drop = Math.min(tier ? base : Math.floor(base / 2), nonNeg(loserTrophies));
  const pot = tier ? nonNeg(stakes.pot, tier.entryFee * 2) : 0;
  return {
    winner: { trophies: base + streakBonus, coins: f.coins + pot, chest: [...chest], streakBonus, pot },
    loser: { trophies: drop ? -drop : 0 },
  };
}

// The two profiles after a match: -> { winner, loser } (new objects).
function applyRewards(winner, loser, rewards) {
  const w = normalizeProfile(winner), l = normalizeProfile(loser);
  w.trophies += nonNeg(rewards && rewards.winner && rewards.winner.trophies);
  w.coins += nonNeg(rewards && rewards.winner && rewards.winner.coins);
  w.wins++; w.streak++;
  w.bestStreak = Math.max(w.bestStreak, w.streak);
  w.rank = rankFor(w.trophies);
  l.trophies = Math.max(0, l.trophies + Math.min(0, int(rewards && rewards.loser && rewards.loser.trophies)));
  l.losses++; l.streak = 0;
  l.rank = rankFor(l.trophies);
  return { winner: w, loser: l };
}

// ---------- the tour and the catalogue ----------

// The tour manifest -> { stages, tiebreaks } the match can use (entries with an id and a
// course file, in tour order). Anything else (null, a broken file) is an empty tour.
function normalizeTour(tour) {
  const clean = (list, kind) => (Array.isArray(list) ? list : [])
    .filter((s) => s && typeof s === 'object' && s.id && typeof s.file === 'string' && s.file)
    .map((s, i) => ({
      id: String(s.id), name: String(s.name || s.id),
      par: nonNeg(s.par, 3) || 3, lengthYd: Number.isFinite(+s.lengthYd) ? +s.lengthYd : null,
      theme: s.theme || null, timeOfDay: s.timeOfDay || 'day', blurb: s.blurb || '',
      difficulty: Number.isFinite(+s.difficulty) ? +s.difficulty : null,
      kind, file: s.file, order: Number.isFinite(+s.order) ? +s.order : i + 1,
      freeBall: s.freeBall ? String(s.freeBall) : null, routes: cleanRoutes(s.routes),
      wind: pendingWind(s),   // the stage's range, when the manifest has it: the roll comes with the course
    }))
    .sort((a, b) => a.order - b.order);
  const t = tour && typeof tour === 'object' ? tour : {};
  return { stages: clean(t.stages, 'match'), tiebreaks: clean(t.tiebreaks, 'tiebreak') };
}

// The power-up catalogue as the match needs it: [{ id, kind: 'ball' | 'trick', rarity }].
// From lib/arcade.js POWERUPS (a missing kind is a ball); the first seven balls when that
// export is missing or empty.
function powerupCatalogue(list = undefined) {
  let src = list;
  if (src === undefined) {
    try { src = require('./arcade').POWERUPS; } catch (_) { src = null; }
  }
  if (!Array.isArray(src) || !src.some((p) => p && (typeof p === 'string' || p.id))) src = POWERUPS;
  return src.filter((p) => p && (typeof p === 'string' || p.id)).map((p) => (typeof p === 'string'
    ? { id: p, kind: 'ball', rarity: 'common' }
    : { id: String(p.id), kind: p.kind === 'trick' ? 'trick' : 'ball', rarity: p.rarity || 'common' }));
}

// routes: [{ id: 'safe' | 'risky' | 'rocket', name, note }] as a hole file documents them, or null
function cleanRoutes(routes) {
  const list = (Array.isArray(routes) ? routes : []).filter((r) => r && typeof r === 'object' && (r.id || r.name))
    .map((r) => ({ id: r.id ? String(r.id) : null, name: String(r.name || r.id), note: r.note ? String(r.note) : '' }));
  return list.length ? list : null;
}

// freeBall: a ball every player's first stroke on the stage is played with, for free (a "rocket hole")
// wind: the hole's wind (lib/arcade-wind.js). Rolled when the stage's course comes up, so the
// stage in play has { mph, dirDeg, relDeg, cross, along, label, ... }; a stage still to be
// loaded (nextStage) has its range only ({ mph: null, min, max, label }) or null.
const PUBLIC_STAGE = Object.freeze(['id', 'name', 'par', 'lengthYd', 'theme', 'timeOfDay', 'blurb', 'difficulty', 'kind', 'freeBall', 'routes', 'wind']);
const publicStage = (s) => (s ? Object.fromEntries(PUBLIC_STAGE.map((k) => [k, k === 'wind' && s.wind ? { ...s.wind } : (s[k] ?? null)])) : null);

// Is this swing obviously not a real shot? { speedMph, lie, distYd (to the pin, before it),
// isPutt }. Under 40 mph from a full-shot lie (tee, fairway, rough, sand: anything but a
// green) more than 40 yd out. A putt, a chip, a pitch from inside 40 yd: never.
function isStrayShot({ speedMph, lie, distYd, isPutt = false } = {}) {
  if (isPutt || lie === 'green') return false;
  if (!Number.isFinite(speedMph) || !Number.isFinite(distYd)) return false;
  return speedMph < STRAY_MAX_MPH && distYd > STRAY_MIN_YD;
}

// What the swing of the player who is up is FOR: what holing this very shot would do.
//   me:  { strokes, lie, distYd } (before the swing)     opp: { strokes, holed, capped }
//   shotFor  'win'   holing it wins the hole at once: the opponent is in with more than this
//                    would make, or is out having already taken at least as many strokes as
//                    this would make (the knockout rule ends it), or is out of strokes
//            'tie'   holing it ties the hole: the opponent is in with exactly what this would
//                    make (the must-make swing; a miss is a knockout)
//            'lead'  holing it puts the opponent on a must-make: they are out with exactly
//                    one stroke fewer than this would make
//            null    anything else
//   shotKind 'putt'  the ball is on the green | 'chip' off it within CHIP_MAX_YD of the pin
//            | 'shot'
const CHIP_MAX_YD = 40;
function shotStake(me, opp) {
  const lie = me && me.lie, distYd = me && me.distYd;
  const shotKind = lie === 'green' ? 'putt' : (Number.isFinite(distYd) && distYd <= CHIP_MAX_YD ? 'chip' : 'shot');
  const make = ((me && me.strokes) || 0) + 1;   // the score this swing would make
  const theirs = (opp && opp.strokes) || 0;
  let shotFor = null;
  if (opp && opp.holed) shotFor = make < theirs ? 'win' : make === theirs ? 'tie' : null;
  else if (opp && (opp.capped || theirs >= make)) shotFor = 'win';
  else if (opp && theirs === make - 1) shotFor = 'lead';
  return { shotFor, shotKind };
}

// The fields of lib/game.js that make up one player's position on the hole.
const POSITION = Object.freeze(['ball', 'strokes', 'lie', 'holed', 'aimOffset']);

/**
 * @param {object}   a.players   [{ id, name, initials?, handicap?, profile? }, { ... }] (slot 1, slot 2)
 * @param {object}   a.options   { format, stage, order, tieRule, powerups, stakes, hazardLosesHole,
 *                                 holeIndex (stage 'current': the hole to start on), catalogue }
 * @param {object}   a.tour      the tour manifest (null: only stage 'current' can be played)
 * @param {Game}     a.game      the bay's game: needed for stage 'current' (its course and round)
 * @param {function} a.random    Math.random (the coin flip, shuffles, arenas, the chest)
 * @param {function} a.now       Date.now
 * @param {object}   a.timeouts  { readyMs, continueMs, doneMs } for `waiting.timeoutMs`
 */
function createMatch({ game = null, players, options = {}, tour = null, random = Math.random, now = Date.now, timeouts = {} } = {}) {
  if (!Array.isArray(players) || players.length !== 2) throw new MatchError('A match needs two players');
  if (players.some((p) => !p || p.id == null || !p.name)) throw new MatchError('Each player needs an id and a name');
  if (String(players[0].id) === String(players[1].id)) throw new MatchError('Pick two different players');
  if (game && game.leagueRound) throw new MatchError('Finish or leave the league round first', 409);

  const F = formatFor(options.format, options.holes) || MATCH_FORMATS.quick;
  const tier = options.stakes == null || options.stakes === false || options.stakes === '' ? null : tierFor(options.stakes);
  if (options.stakes && !tier) throw new MatchError(`No such stakes tier: ${typeof options.stakes === 'object' ? options.stakes.tier : options.stakes}`);
  const tieRule = options.tieRule === 'halve' ? 'halve' : 'shootout';
  const order = options.order === 'shuffle' ? 'shuffle' : 'tour';
  const powerups = ['loadout', 'unlimited', 'off'].includes(options.powerups) ? options.powerups : 'loadout';
  const hazardLosesHole = options.hazardLosesHole === true;
  const putting = ['easy', 'assist', 'off'].includes(options.putting) ? options.putting : 'assist';
  const catalogue = powerupCatalogue(options.catalogue);
  const T = normalizeTour(tour);
  const T_ = { readyMs: nonNeg(timeouts.readyMs, TIMEOUTS.readyMs), continueMs: nonNeg(timeouts.continueMs, TIMEOUTS.continueMs), doneMs: nonNeg(timeouts.doneMs, TIMEOUTS.doneMs) };

  // which holes: the tour's stages, or the course that is loaded
  const want = options.stage == null || options.stage === '' ? null : String(options.stage);
  const mode = want === 'current' || (want === null && !T.stages.length) ? 'current' : 'tour';
  if (mode === 'tour') {
    if (!T.stages.length) throw new MatchError('No tour stages are built yet: only stage "current" can be played', 409);
    if (want && want !== 'random' && !T.stages.some((s) => s.id === want)) throw new MatchError(`No such stage: ${want}`, 404);
  } else if (!game || !game.course) {
    throw new MatchError('Load a course first', 409);
  }

  const pick = (list) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];
  const shuffled = (list) => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(random() * (i + 1)));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // The stages of the match, one per possible hole. Quick: the one asked for, or a random
  // one. A series: tour order (from the stage asked for, else stage 1) or shuffled, with no
  // stage twice until every stage has been played (a short tour goes round again).
  function planStages() {
    const all = T.stages;
    const first = want && want !== 'random' ? all.find((s) => s.id === want) : null;
    if (F.maxHoles === 1) return [first || pick(all)];
    let lap;
    if (order === 'shuffle') {
      lap = shuffled(all);
      if (first) lap = [first, ...lap.filter((s) => s !== first)];
    } else {
      const core = all.some((s) => s.order <= TOUR_STAGES) ? all.filter((s) => s.order <= TOUR_STAGES) : all;
      const at = first ? core.indexOf(first) : 0;
      lap = at >= 0 ? [...core.slice(at), ...core.slice(0, at)] : [first, ...core];
    }
    const plan = [];
    let pool = [...lap];
    while (plan.length < F.maxHoles) {
      if (!pool.length) {
        pool = order === 'shuffle' ? shuffled(all) : [...lap];
        if (pool.length > 1 && pool[0] === plan[plan.length - 1]) pool.push(pool.shift());   // not the same stage twice running
      }
      plan.push(pool.shift());
    }
    return plan;
  }

  // stage 'current': the round as it stands (to put back afterwards) and the course's holes
  const snapshot = mode === 'current' ? {
    course: game.course, shotLogLength: game.shotLog.length,
    holeIndex: game.holeIndex, over: game.over, scores: [...game.scores], pickedUp: [...game.pickedUp],
    ball: { ...game.ball }, strokes: game.strokes, lie: game.lie, holed: game.holed, aimOffset: game.aimOffset,
    _undo: game._undo, player: game.player,
  } : null;
  const courseHoles = mode === 'current' ? game.course.holes.map((h, i) => ({ ref: h.ref ?? i + 1, par: h.par, lengthYd: h.lengthYd ?? null, routes: cleanRoutes(h.routes) })) : null;
  const courseArcade = mode === 'current' ? game.course.arcade || {} : null;
  const courseName = mode === 'current' ? game.course.name : null;
  const startHole = mode === 'current'
    ? (Number.isInteger(options.holeIndex) && game.course.holes[options.holeIndex] ? options.holeIndex : game.holeIndex)
    : 0;
  const currentStage = (n) => {   // the n-th hole of the match (0-based) on the loaded course
    const holeIndex = (startHole + n) % courseHoles.length;
    const h = courseHoles[holeIndex];
    return {
      id: 'current', name: courseHoles.length > 1 ? `${courseName} · Hole ${h.ref}` : courseName,
      par: h.par, lengthYd: h.lengthYd, theme: courseArcade.theme || null, timeOfDay: courseArcade.timeOfDay || 'day',
      blurb: courseArcade.blurb || '', difficulty: courseArcade.difficulty ?? null, kind: 'current', file: null, holeIndex,
      freeBall: courseArcade.freeBall ? String(courseArcade.freeBall) : null, routes: h.routes,
    };
  };
  const plan = mode === 'tour' ? planStages() : null;

  const slot = (p, i) => ({
    id: String(p.id), name: String(p.name), initials: p.initials || initials(p.name), slot: i + 1,
    handicap: Number.isFinite(+p.handicap) ? +p.handicap : null,
    profile: normalizeProfile(p.profile),
    ball: null, strokes: 0, lie: 'tee', holed: false, aimOffset: 0,
    holesWon: 0, holeScores: [], mustHole: false, capped: false,
    shotFor: null, shotKind: null,   // while this player is up on a hole: what holing the next swing does (shotStake)
    charges: powerups === 'loadout' ? F.charges : powerups === 'off' ? 0 : null,
    usedPowerups: [], armedPowerup: null, cursedWith: null, tiebreakFt: null,
    stats: { shots: 0, longestDriveYd: null, closestFt: null, bestGrade: null, perfects: 0, points: 0, callouts: [], bestShot: null },
  });

  const m = {
    id: newId(now), seq: 0, mode,
    stakes: tier ? { tier: tier.id, tierLabel: tier.label, entryFee: tier.entryFee, pot: tier.entryFee * 2 } : null,
    players: players.map(slot),
    phase: 'loading',
    holeNumber: 1, holesPlayed: 0,
    stage: null, nextStage: null,
    hole: null,                // the hole in play: { index, ref, par, lengthYd, tee, pin, line }
    courseRef: null,           // the course object the hole belongs to (a swing on another is not ours)
    honourId: null, currentPlayerId: null, loadedId: null,
    holeResults: [], lastResult: null,
    tiebreak: null,            // { arenaId, round, pending, results, spot, lie, spotYd }
    tied: null,                // a tiebreak still to play: { result (the tied hole's) | null, playoff }
    lastBy: 'holes',           // how the newest hole was settled: 'holes' | 'tiebreak'
    arenasUsed: [], stagesFailed: [],
    events: [], log: [],
    winnerId: null, loserId: null, reason: null, rewards: null, awards: null,
    aborted: false, concededBy: null, error: null,
    waiting: null, waitToken: 0,
    turnStartedAt: null, startedAt: now(),
    // taking a swing back, starting a hole again (snapshots of this object, see snap())
    pending: null,             // the match as it stood before the swing being played
    undo: null,                // ... before the swing just played: what undoLastShot() puts back
    restart: null,             // ... as the hole (or the sudden-death round) teed off: restartHole()
  };

  const byId = (id) => m.players.find((p) => p.id === String(id)) || null;
  const other = (p) => m.players.find((q) => q !== p);
  const bump = () => { m.seq++; };
  const emit = (type, data = {}) => {
    m.events.push({ seq: ++m.seq, type, t: now(), ...data });
    if (m.events.length > EVENTS_MAX) m.events.splice(0, m.events.length - EVENTS_MAX);
  };
  const say = (text) => { m.log.push({ t: now(), text }); if (m.log.length > LOG_MAX) m.log.splice(0, m.log.length - LOG_MAX); };
  const wait = (what, extra = {}) => {
    const timeoutMs = what === 'ready' ? T_.readyMs : what === 'continue' ? T_.continueMs : what === 'dismiss' ? T_.doneMs : null;
    m.waiting = { for: what, token: ++m.waitToken, since: now(), timeoutMs, ...extra };
  };
  const pDist = (p) => (m.hole && p.ball ? distYd(p.ball, m.hole.pin) : null);
  const tiebreakLive = () => Boolean(m.tiebreak && m.tied);
  // A stage's free ball, when this player's next swing is their first stroke on it (a
  // rocket hole's tee shot; on an arena every sudden-death ball is one). Null: none.
  const freeBallFor = (p) => {
    const id = m.stage && m.stage.freeBall;
    if (!id || p.strokes !== 0 || !catalogue.some((c) => c.id === id && c.kind === 'ball')) return null;
    return m.phase === 'play' || m.phase === 'tiebreak' ? id : null;
  };
  // what the course in the bay says about its stage: the free ball, the routes
  const stageExtras = (g, h, st) => ({
    freeBall: (g.course.arcade && g.course.arcade.freeBall ? String(g.course.arcade.freeBall) : null) || st.freeBall || null,
    routes: cleanRoutes(h.routes) || st.routes || null,
  });
  // The wind of the hole that is coming up: the one the driver rolled for it (and put on
  // the game's conditions), else the wind the game is playing in, as it is.
  const stageWind = (g, given) => (given && Number.isFinite(given.mph) ? { ...given } : gameWind(g, m.hole));

  function standingsText() {
    const [a, b] = m.players;
    if (a.holesWon === b.holesWon) return 'ALL SQUARE';
    const lead = a.holesWon > b.holesWon ? a : b;
    return `${lead.name} ${Math.abs(a.holesWon - b.holesWon)} UP`;
  }

  // Who wins the match by winning the hole that is being played (or, on the result
  // screen, the one that is next): a player id, 'both', or null. Never in a quick match:
  // its only hole is the whole match.
  function matchPoint() {
    if (F.maxHoles === 1 || m.phase === 'done') return null;
    if (m.tied && m.tied.playoff) return 'both';
    const left = F.maxHoles - (m.holesPlayed + (m.tied ? 0 : 1));   // holes after this one
    const at = m.players.filter((p) => p.holesWon + 1 >= F.target || p.holesWon + 1 - other(p).holesWon > left);
    return at.length === 2 ? 'both' : at.length ? at[0].id : null;
  }

  // ---- the hole in play and the one-ball game ----

  function teeUp() {
    for (const p of m.players) {
      p.ball = { x: m.hole.tee[0], y: m.hole.tee[1] }; p.strokes = 0; p.lie = 'tee'; p.holed = false; p.aimOffset = 0;
      p.mustHole = false; p.capped = false; p.tiebreakFt = null; p.shotFor = null; p.shotKind = null;
    }
  }

  // Put a player's position into the game (and make the game playable for it: this hole,
  // not over, no score on it yet, no mulligan to take).
  function load(g, p) {
    if (!g || !m.hole || g.course !== m.courseRef) return;
    const i = m.hole.index;
    g.holeIndex = i;
    g.over = false;
    g.scores[i] = null;
    g.pickedUp[i] = false;
    g._undo = null;
    if (tiebreakLive()) {
      g.ball = { ...m.tiebreak.spot }; g.strokes = 0; g.lie = m.tiebreak.lie; g.holed = false;
    } else {
      g.ball = { ...p.ball }; g.strokes = p.strokes; g.lie = p.lie; g.holed = p.holed;
    }
    g.aimOffset = p.aimOffset;
    g.player = { id: p.id, name: p.name, initials: p.initials, handicap: p.handicap };
    g.dropLocked = tiebreakLive();   // v2:playability no rescue drop in a sudden death (closest to the pin, one ball each)
    m.loadedId = p.id;
  }

  function capture(g, p) {
    p.ball = { ...g.ball }; p.strokes = g.strokes; p.lie = g.lie; p.holed = g.holed; p.aimOffset = g.aimOffset;
  }

  // The match's hole-outs are not the round's: no score, no "round over" left behind.
  function tidy(g) {
    if (!g || !m.hole || g.course !== m.courseRef) return;
    g.over = false;
    g.scores[m.hole.index] = null;
    g.pickedUp[m.hole.index] = false;
    g._undo = null;
    g.dropLocked = false;   // v2:playability
  }

  // Who hits next. Sudden death: whoever is still to hit this round. A hole: the honour
  // tees off, then the other; after the tee shots the player farther from the hole among
  // those still out (level: fewer strokes, then the honour). Holed or capped: waiting.
  // ON THE GREEN it is the score that counts: with both balls on the green the player with
  // FEWER strokes putts first (level on strokes: farther from the hole first, as anywhere).
  // The leader's putt is then always for the win: the other has already taken at least as
  // many strokes as it would make, so a make is a knockout on the spot. And when they are
  // level, whoever putts first and makes it leaves the other one swing that must drop.
  function nextTurnPlayerId() {
    if (m.phase === 'tiebreak' || (m.phase === 'intro' && tiebreakLive())) return m.tiebreak.pending[0] || null;
    if (m.phase !== 'play' && m.phase !== 'intro') return null;
    const live = m.players.filter((p) => !p.holed && !p.capped);
    if (!live.length) return null;
    const honourFirst = (a, b) => (a.id === m.honourId ? -1 : b.id === m.honourId ? 1 : 0);
    const onTee = live.filter((p) => p.strokes === 0).sort(honourFirst);
    if (onTee.length) return onTee[0].id;
    const bothOnGreen = live.length === 2 && live.every((p) => p.lie === 'green');
    live.sort((a, b) => (bothOnGreen ? a.strokes - b.strokes : 0) || pDist(b) - pDist(a) || a.strokes - b.strokes || honourFirst(a, b));
    return live[0].id;
  }

  // Bring up whoever is next: the game shows their ball, the UI is told.
  function turn(g) {
    for (const p of m.players) { p.mustHole = false; p.shotFor = null; p.shotKind = null; }
    m.currentPlayerId = nextTurnPlayerId();
    m.turnStartedAt = now();
    const p = byId(m.currentPlayerId);
    if (!p) return;
    const o = other(p);
    p.mustHole = m.phase === 'play' && o.holed && p.strokes === o.strokes - 1;
    // what holing this swing would do (a hole only: a sudden-death ball is for nothing but its distance)
    if (m.phase === 'play') Object.assign(p, shotStake({ strokes: p.strokes, lie: p.lie, distYd: pDist(p) }, o));
    emit('turn', { playerId: p.id, mustHole: p.mustHole, shotFor: p.shotFor, shotKind: p.shotKind });
    if (p.mustHole) { emit('must-hole', { playerId: p.id }); say(`${p.name} must hole this to stay alive.`); }
    load(g, p);
  }

  // ---- taking a swing back, starting a hole again ----
  // A snapshot is the match as it stands, to be put back later: everything except its
  // history (the events and the log go on: what happened, happened), its counters (seq and
  // the wait token only ever rise) and the course. Plain data, so the match stays
  // serializable; structuredClone keeps the shared objects shared (lastResult and
  // tied.result are entries of holeResults).
  const HISTORY = ['id', 'seq', 'events', 'log', 'waitToken', 'startedAt', 'courseRef', 'pending', 'undo'];
  function snap(g, also = []) {
    const copy = {};
    for (const k of Object.keys(m)) if (!HISTORY.includes(k) && !also.includes(k)) copy[k] = m[k];
    return { m: structuredClone(copy), shotLogLength: g && Array.isArray(g.shotLog) ? g.shotLog.length : null };
  }
  // Put a snapshot back, and the game with it: whoever is up has their ball in the bay.
  function putBack(g, s) {
    Object.assign(m, structuredClone(s.m));
    m.pending = null;
    m.undo = null;
    m.turnStartedAt = now();
    if (!g || !m.hole || g.course !== m.courseRef) return;
    if (Number.isInteger(s.shotLogLength) && Array.isArray(g.shotLog)) g.shotLog.length = Math.min(g.shotLog.length, s.shotLogLength);
    const p = byId(m.currentPlayerId);
    if (p) load(g, p); else tidy(g);
  }

  // ---- stages ----

  function requestStage(stage) {
    m.pending = null; m.undo = null; m.restart = null;   // a new stage: nothing of the last one can be taken back
    m.phase = 'loading';
    m.nextStage = stage;
    if (!m.stage) m.stage = stage;   // nothing of the match is on screen yet: show where it starts
    m.currentPlayerId = null;
    wait('stage', { stageId: stage.id, kind: stage.kind, file: stage.file || null });
  }

  const nextMatchStage = () => (mode === 'tour' ? plan[m.holesPlayed] : currentStage(m.holesPlayed));

  // Where the sudden death is played: an arena of the tour (random, none twice until all
  // have been used), or the hole just played from SHOOTOUT_YD when there is no arena.
  function tiebreakStage({ sameHole = false } = {}) {
    if (!sameHole && mode === 'tour' && T.tiebreaks.length) {
      let pool = T.tiebreaks.filter((a) => !m.arenasUsed.includes(a.id) && !m.stagesFailed.includes(a.id));
      if (!pool.length) {
        const last = m.arenasUsed[m.arenasUsed.length - 1];
        m.arenasUsed = [];
        pool = T.tiebreaks.filter((a) => !m.stagesFailed.includes(a.id));
        if (pool.length > 1) pool = pool.filter((a) => a.id !== last);
      }
      if (pool.length) {
        const arena = pick(pool);
        m.arenasUsed.push(arena.id);
        return { ...arena, kind: 'tiebreak' };
      }
    }
    return {
      id: 'shootout', name: 'Shootout', par: 3, lengthYd: SHOOTOUT_YD,
      theme: m.stage ? m.stage.theme : null, timeOfDay: m.stage ? m.stage.timeOfDay : 'day',
      blurb: 'Closest to the pin, one ball each.', difficulty: null, kind: 'tiebreak', file: null, freeBall: null, routes: null, wind: null,
      holeIndex: m.hole ? m.hole.index : 0, sameHole: true,
    };
  }

  // ---- closing a hole, the match ----

  // null: play on. Else { winner } or { tie: true }, with the reason.
  function holeDecided(shooter) {
    const [a, b] = m.players;
    if (a.holed && b.holed) {
      if (a.strokes === b.strokes) return { tie: true, reason: 'score' };
      return { winner: a.strokes < b.strokes ? a : b, reason: 'score' };
    }
    const inn = a.holed ? a : b.holed ? b : null;
    if (!inn) return a.capped && b.capped ? { tie: true, reason: 'cap' } : null;
    const out = other(inn);
    if (out.capped && inn === shooter) return { winner: inn, reason: 'cap' };   // holed out against a capped player
    if (out.capped || out.strokes >= inn.strokes) return { winner: inn, reason: 'knockout' };
    return null;   // out with fewer: plays on (one fewer: must hole it)
  }

  // After a hole has its winner (or was halved): the match is over, goes to a sudden-death
  // playoff (level at the end, tieRule 'halve'), or the next stage is on its way.
  function afterHole(ev) {
    const [a, b] = m.players;
    const left = F.maxHoles - m.holesPlayed;
    const lead = Math.abs(a.holesWon - b.holesWon);
    if (Math.max(a.holesWon, b.holesWon) >= F.target || lead > left || left <= 0) {
      if (lead > 0) return { ...ev, ...finish(a.holesWon > b.holesWon ? a : b, m.lastBy === 'tiebreak' ? 'tiebreak' : 'holes') };
      m.tied = { result: null, playoff: true };
      m.phase = 'hole-result';
      m.nextStage = tiebreakStage();
      say('ALL SQUARE after the last hole: SUDDEN DEATH decides the match!');
      wait('continue');
      return { ...ev, next: 'tiebreak', standings: standingsText() };
    }
    m.phase = 'hole-result';
    m.nextStage = nextMatchStage();
    if (F.maxHoles > 1) say(`${standingsText()}. Next: ${m.nextStage.name}.`);
    wait('continue');
    return { ...ev, next: 'hole', standings: standingsText() };
  }

  function closeHole(g, decision, shooter) {
    const par = m.hole.par;
    const scores = {};
    // the swing that closed it dropped, and it was for the win or to tie: said on the events
    const clutch = shooter.holed && (shooter.shotFor === 'win' || shooter.shotFor === 'tie') ? shooter.shotFor : null;
    for (const p of m.players) { scores[p.id] = p.strokes; p.holeScores.push(p.holed ? p.strokes : null); p.mustHole = false; p.shotFor = null; p.shotKind = null; }
    const res = {
      holeNumber: m.holeNumber, stageId: m.stage.id, stageName: m.stage.name, par,
      winnerId: null, reason: decision.reason, scores, tiebreak: null,
    };
    m.holeResults.push(res);
    m.lastResult = res;
    m.holesPlayed++;
    m.currentPlayerId = null;
    m.lastBy = 'holes';
    tidy(g);
    const base = { playerId: shooter.id, holeResult: res };
    if (decision.winner) {
      const w = decision.winner, l = other(w);
      res.winnerId = w.id;
      w.holesWon++;
      m.honourId = w.id;
      if (decision.reason === 'hazard') say(`Hazard! ${l.name} forfeits the hole: ${w.name} takes it.`);
      else if (decision.reason === 'cap') say(`${l.name} ran out of strokes: ${w.name} wins the hole with ${scoreName(w.strokes, par)}.`);
      else if (decision.reason === 'knockout') say(`KNOCKOUT! ${l.name} can't catch that: ${w.name} wins the hole with ${scoreName(w.strokes, par)}!`);
      else say(`${w.name} wins the hole: ${scoreName(w.strokes, par)} beats ${scoreName(l.strokes, par)}!`);
      emit('hole-won', { winnerId: w.id, reason: res.reason, holeNumber: res.holeNumber, clutch: clutch === 'win' && shooter === w ? 'win' : null });
      return afterHole({ ...base, event: 'hole-won', winnerId: w.id, reason: res.reason, clutch: clutch === 'win' && shooter === w ? 'win' : null });
    }
    const [a] = m.players;
    const how = decision.reason === 'cap' ? 'both out of strokes' : `both make ${scoreName(a.strokes, par)}`;
    if (tieRule === 'halve') {
      res.reason = 'halved';
      say(`${clutch === 'tie' ? `${shooter.name} TIED IT UP! ` : ''}Hole halved: ${how}.`);
      emit('hole-tied', { holeNumber: res.holeNumber, reason: 'halved', playerId: shooter.id, clutch: clutch === 'tie' ? 'tie' : null });
      return afterHole({ ...base, event: 'hole-tied', reason: 'halved', clutch: clutch === 'tie' ? 'tie' : null });
    }
    res.reason = 'tied';
    m.tied = { result: res, playoff: false };
    m.phase = 'hole-result';
    m.nextStage = tiebreakStage();
    say(`${clutch === 'tie' ? `${shooter.name} TIED IT UP! ` : ''}Hole tied (${how}): SUDDEN DEATH, closest to the pin!`);
    emit('hole-tied', { holeNumber: res.holeNumber, reason: 'tied', playerId: shooter.id, clutch: clutch === 'tie' ? 'tie' : null });
    wait('continue');
    return { ...base, event: 'hole-tied', reason: 'tied', next: 'tiebreak', standings: standingsText(), clutch: clutch === 'tie' ? 'tie' : null };
  }

  // The chest: n random balls (never a trick), by rarity, no ball twice while there are others.
  function rollChest(n) {
    const balls = catalogue.filter((c) => c.kind === 'ball');
    const out = [];
    while (balls.length && out.length < n) {
      let pool = balls.filter((c) => !out.includes(c.id));
      if (!pool.length) pool = balls;
      const total = pool.reduce((s, c) => s + (RARITY_WEIGHT[c.rarity] || 20), 0);
      let r = random() * total;
      let got = pool[pool.length - 1];
      for (const c of pool) { r -= RARITY_WEIGHT[c.rarity] || 20; if (r < 0) { got = c; break; } }
      out.push(got.id);
    }
    return out;
  }

  // Only awards somebody really earned: a drive that was hit, an approach that was measured.
  function buildAwards() {
    const best = (value, better) => m.players.reduce((top, p) => {
      const v = value(p);
      return v != null && (!top || better(v, top.v)) ? { p, v } : top;
    }, null);
    const awards = [];
    const drive = best((p) => p.stats.longestDriveYd, (v, t) => v > t);
    if (drive) awards.push({ id: 'longest-drive', label: 'LONGEST DRIVE', playerId: drive.p.id, value: `${Math.round(drive.v)} yd` });
    const close = best((p) => p.stats.closestFt, (v, t) => v < t);
    if (close) awards.push({ id: 'closest-to-pin', label: 'CLOSEST TO THE PIN', playerId: close.p.id, value: close.v === 0 ? 'HOLED' : ftText(close.v) });
    const shot = best((p) => (p.stats.bestShot && p.stats.bestShot.points > 0 ? p.stats.bestShot.points : null), (v, t) => v > t);
    if (shot) {
      const s = shot.p.stats.bestShot;
      awards.push({ id: 'shot-of-the-match', label: 'SHOT OF THE MATCH', playerId: shot.p.id, value: `${s.text} · ${s.points} pts`, points: s.points, holeNumber: s.holeNumber });
    }
    const [a, b] = m.players;
    if (a.stats.perfects !== b.stats.perfects) {
      const top = a.stats.perfects > b.stats.perfects ? a : b;
      awards.push({ id: 'most-perfects', label: 'MOST PERFECTS', playerId: top.id, value: String(top.stats.perfects) });
    }
    return awards;
  }

  // reason: 'holes' | 'tiebreak' | 'concede'
  function finish(winner, reason) {
    const loser = other(winner);
    m.phase = 'done';
    m.currentPlayerId = null;
    m.nextStage = null;
    m.tied = null;
    for (const p of m.players) p.mustHole = false;
    m.winnerId = winner.id;
    m.loserId = loser.id;
    m.reason = reason;
    m.rewards = rewardsFor({
      format: F.id, stakes: m.stakes, winStreak: winner.profile.streak, loserTrophies: loser.profile.trophies, chest: rollChest(F.chest),
    });
    m.awards = buildAwards();
    const r = m.rewards.winner;
    say(`${winner.name.toUpperCase()} WINS THE MATCH! +${r.trophies} trophies, +${r.coins} coins.`);
    emit('match-over', { winnerId: winner.id, loserId: loser.id, reason });
    wait('dismiss');
    return { event: 'match-over', winnerId: winner.id, loserId: loser.id, reason, rewards: m.rewards };
  }

  // ---- shots ----

  function shotText(p, result) {
    const par = m.hole.par;
    if (result.penalty) return /water/i.test(result.note || '') ? `${p.name} finds the water! +1` : `${p.name} is out of bounds! +1`;
    if (result.holed && result.strokes === 1) return `${p.name}: HOLE IN ONE!`;
    if (result.holed) return `${p.name} is in for ${scoreName(result.strokes, par)} (${result.strokes})!`;
    const total = result.sim ? result.sim.totalYd : 0;
    if (result.lie === 'green') return `${p.name} is on the green, ${ftText(result.distToPinYd * 3)} away.`;
    if (result.lie === 'bunker' || result.lie === 'sand') return `${p.name} is in the sand, ${Math.round(result.distToPinYd)} yd out.`;
    if (result.strokes === 1 && total >= 280) return `${p.name} BOMBS it ${Math.round(total)} yd!`;
    if (result.strokes === 1) return `${p.name} drives ${Math.round(total)} yd, ${Math.round(result.distToPinYd)} to go.`;
    return `${p.name}: ${Math.round(result.distToPinYd)} yd to go.`;
  }

  // The match's numbers for one shot, from the game's result and the arcade grade on it.
  // (p still holds the position the ball was hit from.)
  function recordStats(p, result, fromYd) {
    const s = p.stats;
    const sim = result.sim || {};
    const a = result.arcade || null;
    s.shots++;
    const clean = !result.penalty && result.lie !== 'water' && result.lie !== 'ob';
    if (m.phase === 'play' && p.strokes === 0 && m.hole.par >= 4 && !sim.isPutt && clean && Number.isFinite(sim.totalYd)) {
      s.longestDriveYd = Math.max(s.longestDriveYd ?? 0, sim.totalYd);
    }
    if (!sim.isPutt && clean && fromYd != null && fromYd >= 30 && Number.isFinite(result.distToPinYd)) {
      const ft = Math.round(result.distToPinYd * 3 * 10) / 10;
      s.closestFt = s.closestFt == null ? ft : Math.min(s.closestFt, ft);
    }
    if (!a) return;
    if (GRADES.includes(a.grade)) {
      if (s.bestGrade == null || GRADES.indexOf(a.grade) > GRADES.indexOf(s.bestGrade)) s.bestGrade = a.grade;
      if (a.grade === 'PERFECT' || a.grade === 'JACKPOT') s.perfects++;
    }
    const points = nonNeg(a.points);
    s.points += points;
    if (a.callout && a.callout.id) {
      s.callouts.push(String(a.callout.id));
      if (s.callouts.length > CALLOUTS_MAX) s.callouts.splice(0, s.callouts.length - CALLOUTS_MAX);
    }
    if (!s.bestShot || points > s.bestShot.points) {
      s.bestShot = {
        points, grade: a.grade || null, callout: a.callout && a.callout.id ? String(a.callout.id) : null,
        text: (a.callout && a.callout.text) || a.label || a.grade || 'Shot', holeNumber: m.holeNumber,
      };
    }
  }

  // One sudden-death ball. Nearest wins; a ball in the water or out of bounds is a miss (no
  // distance: it loses to any ball that has one); both miss, or within 0.1 ft: again.
  function tiebreakShot(g, p, result) {
    const tb = m.tiebreak;
    // the game has already dropped a hazard ball (+1), so the miss is read from the
    // penalty; a ball that counts is measured where it lies (a tap-in stays where it
    // stopped; only a ball that dropped is on the pin: 0)
    const counted = !result.penalty && result.lie !== 'water' && result.lie !== 'ob';
    const ft = counted ? Math.round(g.distToPinYd * 3 * 100) / 100 : null;
    const miss = counted ? null : (/water/i.test(result.note || '') || result.lie === 'water' ? 'water' : 'ob');
    const holed = counted && ft === 0;
    tb.results.push({ round: tb.round, playerId: p.id, ft, miss, holed });
    p.tiebreakFt = ft;
    p.ball = { ...g.ball }; p.lie = result.lie; p.aimOffset = g.aimOffset;
    tidy(g);
    say(holed ? `${p.name} HOLES IT!` : counted ? `${p.name}: ${ftText(ft)} from the pin.` : `${p.name} ${miss === 'water' ? 'finds the water' : 'is out of bounds'}: a miss!`);
    emit('tiebreak-shot', { playerId: p.id, ft, miss, round: tb.round });
    tb.pending = tb.pending.filter((id) => id !== p.id);
    const base = { event: 'tiebreak-shot', playerId: p.id, ft, miss, round: tb.round };
    if (tb.pending.length) {
      turn(g);
      return { ...base, nextPlayerId: m.currentPlayerId };
    }
    const [a, b] = m.players;
    const da = a.tiebreakFt == null ? Infinity : a.tiebreakFt, db = b.tiebreakFt == null ? Infinity : b.tiebreakFt;
    if (da === db || Math.abs(da - db) <= TIEBREAK_TIE_FT) {
      tb.round++;
      tb.order = [...tb.order].reverse();   // the other player leads off the next round
      tb.pending = [...tb.order];
      for (const q of m.players) { q.tiebreakFt = null; q.ball = { ...tb.spot }; q.lie = tb.lie; }
      say(`Still level: sudden death round ${tb.round}!`);
      emit('tiebreak-again', { round: tb.round });
      turn(g);
      m.restart = snap(g, ['restart']);   // restartHole() restarts this round
      return { ...base, again: true, nextPlayerId: m.currentPlayerId };
    }
    const w = da < db ? a : b;
    const rounds = [];
    for (const r of tb.results) (rounds[r.round - 1] ||= {})[r.playerId] = r.ft;
    const record = { arenaId: tb.arenaId, rounds };
    let res = m.tied.result;
    if (res) {            // the tied hole gets its winner
      res.winnerId = w.id; res.reason = 'tiebreak'; res.tiebreak = record;
    } else {              // the playoff after the last hole: a result of its own
      res = { holeNumber: m.holeNumber, stageId: m.stage.id, stageName: m.stage.name, par: m.hole.par, winnerId: w.id, reason: 'tiebreak', scores: {}, tiebreak: record, playoff: true };
      m.holeResults.push(res);
    }
    m.lastResult = res;
    m.tied = null;
    m.lastBy = 'tiebreak';
    m.currentPlayerId = null;
    w.holesWon++;
    m.honourId = w.id;
    say(`${w.name} wins the sudden death${w.tiebreakFt === 0 ? ' by holing it' : `: ${ftText(w.tiebreakFt)} from the pin`}!`);
    emit('hole-won', { winnerId: w.id, reason: 'tiebreak', holeNumber: res.holeNumber });
    return afterHole({ ...base, event: 'hole-won', winnerId: w.id, reason: 'tiebreak', holeResult: res });
  }

  // ---- start ----
  m.honourId = m.players[random() < 0.5 ? 0 : 1].id;
  emit('match-start', { format: F.id, playerIds: m.players.map((p) => p.id) });
  emit('coin-flip', { winnerId: m.honourId });
  say(`${m.players[0].name} vs ${m.players[1].name}: ${F.label}${m.stakes ? `, ${m.stakes.pot} coins in the pot` : ''}. ${byId(m.honourId).name} wins the toss and has the honour.`);
  requestStage(mode === 'tour' ? plan[0] : currentStage(0));

  return {
    get id() { return m.id; },
    get mode() { return m.mode; },
    get phase() { return m.phase; },
    get active() { return m.phase !== 'done'; },
    get currentPlayerId() { return m.currentPlayerId; },
    get winnerId() { return m.winnerId; },
    get aborted() { return m.aborted; },
    get stakes() { return m.stakes; },
    get holeIndex() { return m.hole ? m.hole.index : null; },
    // The putting assist every swing of this match is played with ('easy' | 'assist' | 'off').
    get putting() { return putting; },
    // How far through the series the hole that is coming up is, 0 to 1 (a quick match: 0).
    // The wind leans toward the top of a stage's range late in a match (lib/arcade-wind.js).
    get progress() { return F.maxHoles > 1 ? Math.min(1, Math.max(0, m.holesPlayed / (F.maxHoles - 1))) : 0; },
    // What the match is waiting for from its driver (see the top of this file), or null.
    get waiting() { return m.waiting ? { ...m.waiting } : null; },
    nextTurnPlayerId,

    // The course the match asked for is in the game: tee the hole (or the sudden death) up
    // and show the intro. `token` is `waiting.token` of the request this answers: an answer
    // to an older request is ignored (false). `wind`: the wind the driver rolled for this
    // hole and applied to the game (lib/arcade-wind.js); without one the stage carries the
    // wind the game is playing in.
    stageReady(g, token = null, { wind = null } = {}) {
      if (m.phase !== 'loading' || !m.waiting || m.waiting.for !== 'stage') return false;
      if (token != null && token !== m.waiting.token) return false;
      if (!g || !g.course || !g.course.holes.length) throw new MatchError('No course is loaded', 409);
      const st = m.nextStage;
      const index = st.file ? 0 : (g.course.holes[st.holeIndex] ? st.holeIndex : 0);
      const h = g.course.holes[index];
      bump();
      m.courseRef = g.course;
      m.hole = {
        index, ref: h.ref ?? index + 1, par: h.par, lengthYd: h.lengthYd ?? null,
        tee: [h.tee[0], h.tee[1]], pin: [h.pin[0], h.pin[1]], line: Array.isArray(h.line) ? h.line : null,
      };
      m.nextStage = null;
      if (st.kind === 'tiebreak') {
        // an arena is played from its tee; without one, from 150 yd on the hole just played
        const spot = st.sameHole ? shootoutSpot(m.hole, SHOOTOUT_YD) : { x: h.tee[0], y: h.tee[1] };
        const onTee = spot.x === h.tee[0] && spot.y === h.tee[1];
        const lie = onTee || typeof g.surfaceAt !== 'function' ? 'tee' : g.surfaceAt(spot.x, spot.y);
        const spotYd = r1(distYd(spot, m.hole.pin));
        const first = byId(m.honourId), second = other(first);
        m.tiebreak = { arenaId: st.sameHole ? null : st.id, round: 1, order: [first.id, second.id], pending: [first.id, second.id], results: [], spot, lie, spotYd };
        m.stage = { ...st, par: st.sameHole ? 3 : (st.par || h.par), lengthYd: st.sameHole ? Math.round(spotYd) : (st.lengthYd ?? h.lengthYd ?? null), ...(st.sameHole ? {} : stageExtras(g, h, st)), wind: stageWind(g, wind) };
        for (const p of m.players) {
          p.ball = { ...spot }; p.strokes = 0; p.lie = lie; p.holed = false; p.aimOffset = 0;
          p.mustHole = false; p.capped = false; p.tiebreakFt = null; p.shotFor = null; p.shotKind = null;
        }
      } else {
        m.stage = { ...st, par: h.par ?? st.par, lengthYd: st.lengthYd ?? h.lengthYd ?? null, ...stageExtras(g, h, st), wind: stageWind(g, wind) };
        m.tiebreak = null;
        teeUp();
      }
      m.phase = 'intro';
      emit('stage-loaded', { stageId: m.stage.id, kind: m.stage.kind, holeNumber: m.holeNumber });
      const mp = st.kind === 'tiebreak' ? null : matchPoint();
      if (mp) { emit('match-point', { playerId: mp }); say(mp === 'both' ? 'MATCH POINT for both players!' : `MATCH POINT: ${byId(mp).name}.`); }
      m.currentPlayerId = nextTurnPlayerId();
      m.turnStartedAt = now();
      load(g, byId(m.currentPlayerId));
      wait('ready');
      return true;
    },

    // The course could not be put in the bay. An arena: sudden death on the hole just played
    // instead. A stage: another one that has not been played; none left: the match is off.
    stageFailed(token = null, message = '') {
      if (m.phase !== 'loading' || !m.waiting || m.waiting.for !== 'stage') return false;
      if (token != null && token !== m.waiting.token) return false;
      const st = m.nextStage;
      if (!st.file) return false;   // nothing was to be loaded
      bump();
      m.stagesFailed.push(st.id);
      if (st.kind === 'tiebreak') {
        say(`${st.name} would not load: sudden death on this hole instead.`);
        requestStage(tiebreakStage({ sameHole: true }));
        return true;
      }
      const usable = T.stages.filter((s) => !m.stagesFailed.includes(s.id));
      if (usable.length) {
        // the rest of the plan without it: a stage the match would not have seen takes its
        // place; when there is none, the stages that do load go round again
        const played = m.holeResults.map((r) => r.stageId);
        const rest = plan.slice(m.holesPlayed);
        const fresh = usable.find((s) => !played.includes(s.id) && !rest.includes(s));
        const next = fresh ? rest.map((s) => (s.id === st.id ? fresh : s)) : rest.filter((s) => s.id !== st.id);
        for (let i = 0; next.length < rest.length; i++) {
          const s = usable[i % usable.length];
          if (usable.length > 1 && next[next.length - 1] === s) continue;   // not twice running
          next.push(s);
        }
        plan.splice(m.holesPlayed, rest.length, ...next);
        const sub = plan[m.holesPlayed];
        say(`${st.name} would not load: ${sub.name} instead.`);
        if (m.stage === st) m.stage = sub;
        requestStage(sub);
        return true;
      }
      m.phase = 'done'; m.currentPlayerId = null; m.aborted = true; m.nextStage = null;
      m.error = message || `${st.name} would not load`;
      say(`Match abandoned: ${m.error}.`);
      wait('dismiss');
      return true;
    },

    // The intro screens are done: tee off. False when no intro is showing.
    ready(g = null) {
      if (m.phase !== 'intro') return false;
      bump();
      m.phase = tiebreakLive() ? 'tiebreak' : 'play';
      m.waiting = null;
      emit('ready', { holeNumber: m.holeNumber });
      if (m.phase === 'tiebreak') {
        emit('tiebreak-start', { arenaId: m.tiebreak.arenaId, round: m.tiebreak.round });
        say(`SUDDEN DEATH${m.tiebreak.arenaId ? ` at ${m.stage.name}` : ''}: closest to the pin from ${Math.round(m.tiebreak.spotYd)} yd.`);
      }
      turn(g);
      m.restart = snap(g, ['restart']);   // the hole as it tees off: what restartHole() puts back
      return true;
    },

    // Leave the hole-result screen: on to the next stage, or to the sudden death of a tied
    // hole. False when no result is showing.
    continue() {
      if (m.phase !== 'hole-result' || !m.nextStage) return false;
      bump();
      const st = m.nextStage;
      if (st.kind !== 'tiebreak') { m.holeNumber = m.holesPlayed + 1; m.tiebreak = null; }
      else if (m.tied && m.tied.playoff) m.holeNumber = m.holesPlayed + 1;
      requestStage(st);
      return true;
    },

    // Before the game plays a swing: null when swings do not count right now (the caller
    // drops it); else the player who is up is in the game and this is their shot:
    // { playerId, armed: ball id | null, curses: [trick ids against them] }.
    beforeShot(g) {
      if (m.phase !== 'play' && m.phase !== 'tiebreak') return null;
      const p = byId(m.currentPlayerId);
      if (!p || !g || g.course !== m.courseRef) return null;
      if (m.loadedId === p.id) p.aimOffset = g.aimOffset;   // the aim set for this shot
      load(g, p);
      m.pending = { ...snap(g), playerId: p.id };   // the match before this swing (undoLastShot)
      const free = freeBallFor(p);
      return { playerId: p.id, armed: free || p.armedPowerup, curses: p.cursedWith ? [p.cursedWith] : [], free: Boolean(free) };
    },

    // After the game played it: the ball and the curse are spent, the shot is the player's,
    // the hole / sudden-death round / match is decided, and whoever is next comes up.
    afterShot(g, result) {
      if ((m.phase !== 'play' && m.phase !== 'tiebreak') || !m.currentPlayerId || !result) return null;
      const p = byId(m.currentPlayerId);
      bump();
      // what undoLastShot() would put back, and whether this looks like a stray ball (read
      // before the shot moves the player: where it was hit from, the monitor's own speed)
      const before = m.pending && m.pending.playerId === p.id ? m.pending : null;
      m.pending = null;
      const launch = (result.arcadeShot && result.arcadeShot.realLaunch) || result.launch || {};
      const stray = isStrayShot({
        speedMph: launch.speedMph, isPutt: Boolean(result.sim && result.sim.isPutt),
        lie: tiebreakLive() ? m.tiebreak.lie : p.lie, distYd: tiebreakLive() ? m.tiebreak.spotYd : pDist(p),
      });
      const holeNumber = m.holeNumber;
      const ev = this._played(g, p, result);
      m.undo = before ? { ...before, stray, holeNumber } : null;
      if (!stray) return ev;
      emit('stray-shot', { playerId: p.id, speedMph: r1(launch.speedMph) });   // (not in the log: the UI asks)
      return { ...ev, stray: true };
    },
    // (afterShot's own work: spend, record, decide, bring the next player up)
    _played(g, p, result) {
      const armed = freeBallFor(p) ? null : p.armedPowerup;   // a free first stroke spends nothing: their own ball stays armed
      if (armed) {
        if (!p.usedPowerups.includes(armed)) p.usedPowerups.push(armed);
        if (p.charges != null) p.charges = Math.max(0, p.charges - 1);
        p.armedPowerup = null;
      }
      p.cursedWith = null;
      recordStats(p, result, tiebreakLive() ? m.tiebreak.spotYd : pDist(p));
      if (m.phase === 'tiebreak') return tiebreakShot(g, p, result);
      capture(g, p);
      g._undo = null;   // no mulligans in a match
      say(shotText(p, result));
      if (hazardLosesHole && result.penalty) return closeHole(g, { winner: other(p), reason: 'hazard' }, p);
      p.capped = !p.holed && p.strokes >= m.hole.par + STROKE_CAP;
      if (p.capped) say(`${p.name} is out of strokes (${p.strokes}).`);
      const decided = holeDecided(p);
      if (decided) return closeHole(g, decided, p);
      turn(g);
      const next = byId(m.currentPlayerId);
      return { event: 'shot', playerId: p.id, nextPlayerId: m.currentPlayerId, mustHole: Boolean(next && next.mustHole), shotFor: next ? next.shotFor : null, shotKind: next ? next.shotKind : null };
    },

    // v2:playability DROP ON THE LINE (lib/game.js dropOnLine): the player who is up takes
    // the rescue drop instead of swinging from where the ball lies: back on the hole's
    // line, on mown ground, no nearer the hole. It costs a stroke, or nothing out of a lie
    // the game judges dead (game.state().rescue). The stroke counts like any other: the
    // knockout and the stroke cap are looked at straight away, so a drop can lose the hole
    // (out with as many as the player who is in) or end it capped. It is in the log and
    // the events ('drop', { playerId, free, strokes }), spends no ball or trick, is no
    // swing in the stats, and undoLastShot() takes it back like a swing. Only while a hole
    // is being played: never in a sudden death.
    drop(g, playerId = null) {
      if (m.phase !== 'play') throw new MatchError(m.phase === 'tiebreak' ? 'No drops in a sudden death' : 'No hole is being played', 409);
      const p = byId(m.currentPlayerId);
      if (!p || !g || g.course !== m.courseRef) throw new MatchError('No hole is being played', 409);
      if (playerId != null && playerId !== '' && String(playerId) !== p.id) {
        throw new MatchError(byId(playerId) ? `It is ${p.name}'s turn` : 'No such player in this match', byId(playerId) ? 409 : 404);
      }
      if (m.loadedId === p.id) p.aimOffset = g.aimOffset;
      load(g, p);
      const before = { ...snap(g), playerId: p.id };
      const d = typeof g.dropOnLine === 'function' ? g.dropOnLine() : null;
      if (!d) throw new MatchError('There is no drop to take from here', 409);
      bump();
      m.pending = null;
      const holeNumber = m.holeNumber;
      capture(g, p);
      g._undo = null;   // the match's own undo takes it back
      say(d.free ? `${p.name} takes a FREE DROP back on the line.` : `${p.name} drops back on the line: +1 (${p.strokes}).`);
      emit('drop', { playerId: p.id, free: d.free, strokes: p.strokes });
      const base = { playerId: p.id, drop: true, free: d.free, penalty: d.penalty, strokes: p.strokes, from: d.from, end: d.end, lie: d.lie };
      p.capped = !p.holed && p.strokes >= m.hole.par + STROKE_CAP;
      if (p.capped) say(`${p.name} is out of strokes (${p.strokes}).`);
      const decided = holeDecided(p);
      let ev;
      if (decided) ev = { ...closeHole(g, decided, p), ...base };
      else {
        turn(g);
        ev = { event: 'drop', ...base, nextPlayerId: m.currentPlayerId };
      }
      m.undo = { ...before, stray: false, holeNumber, drop: true };
      return ev;
    },

    // Take the last swing back: the match (and the game) exactly as they were before it:
    // both players' positions, strokes, lies, the ball and the trick that rode on it, the
    // charges, the stats, a sudden-death result, and the hole or the match if that swing
    // decided it (from 'hole-result' or 'done' back into 'play' / 'tiebreak'). Anything
    // armed or cast since that swing is put back too. One level: the swing before it is
    // final. Not after the result screen was left, not after a concession.
    undoLastShot(g = null) {
      const u = m.undo;
      if (!u || m.aborted || m.concededBy) throw new MatchError('There is no shot to take back', 409);
      const from = m.phase;
      putBack(g, u);
      bump();
      const p = byId(u.playerId);
      // v2:playability a drop (drop()) is taken back the same way, and says so
      const drop = u.drop ? { drop: true } : {};
      emit('shot-undone', { playerId: u.playerId, stray: Boolean(u.stray), from, ...drop });
      say(u.drop ? `${p ? p.name : 'The'}'s drop is taken back.` : `${p ? p.name : 'The'}'s last shot is taken back${u.stray ? ' (a stray ball)' : ''}.`);
      return { event: 'shot-undone', playerId: u.playerId, stray: Boolean(u.stray), from, ...drop };
    },

    // Start the hole again: both players back on the tee with no strokes, the balls and
    // tricks spent on it back in their loadouts (and its stats forgotten), the same stage,
    // the same wind, the same honour. In a sudden death: the round that is being played.
    restartHole(g = null) {
      if ((m.phase !== 'play' && m.phase !== 'tiebreak') || !m.restart) throw new MatchError('No hole is being played', 409);
      const tiebreak = m.phase === 'tiebreak';
      putBack(g, m.restart);
      bump();
      emit('hole-restarted', { holeNumber: m.holeNumber, tiebreak, round: tiebreak ? m.tiebreak.round : null });
      say(tiebreak ? `Sudden death round ${m.tiebreak.round} starts again.` : `Hole ${m.holeNumber} starts again: both players back on the tee.`);
      return { event: 'hole-restarted', holeNumber: m.holeNumber, tiebreak };
    },

    // A ball for that player's next shot (null: put it back), or a trick, which is cast at
    // once on the opponent's next swing. Loadout: a charge each, every id once per match.
    arm(playerId, id) {
      if (m.phase === 'done') throw new MatchError('The match is over', 409);
      const p = byId(playerId);
      if (!p) throw new MatchError('No such player in this match', 404);
      if (id == null || id === '') {
        if (p.armedPowerup) { bump(); p.armedPowerup = null; }
        return null;
      }
      if (powerups === 'off') throw new MatchError('Power-ups are off in this match', 409);
      const c = catalogue.find((x) => x.id === String(id));
      if (!c) throw new MatchError(`Unknown power-up: ${id}`);
      const o = other(p);
      if (powerups === 'loadout') {
        if (p.usedPowerups.includes(c.id)) throw new MatchError(`${p.name} has already used ${c.id} in this match`, 409);
        // an armed ball has its charge spoken for (arming another ball swaps it)
        const spokenFor = p.armedPowerup && c.kind === 'trick' ? 1 : 0;
        if (p.charges - spokenFor < 1) throw new MatchError(`${p.name} has no charges left`, 409);
      }
      if (c.kind === 'trick' && o.cursedWith) throw new MatchError(`${o.name} is already cursed`, 409);
      bump();
      if (c.kind === 'trick') {
        o.cursedWith = c.id;
        if (!p.usedPowerups.includes(c.id)) p.usedPowerups.push(c.id);
        if (p.charges != null) p.charges--;
        emit('trick-cast', { playerId: p.id, id: c.id, targetId: o.id });
        say(`SABOTAGE! ${p.name} casts ${c.id} on ${o.name}.`);
        return c.id;
      }
      p.armedPowerup = c.id;
      emit('powerup-armed', { playerId: p.id, id: c.id });
      return c.id;
    },
    setArmed(playerId, id) { return this.arm(playerId, id); },

    // A player gives up: the other wins the match.
    concede(playerId) {
      if (m.phase === 'done') throw new MatchError('The match is over', 409);
      const p = byId(playerId);
      if (!p) throw new MatchError('No such player in this match', 404);
      bump();
      m.pending = null; m.undo = null; m.restart = null;   // a concession is final
      m.concededBy = p.id;
      say(`${p.name} concedes.`);
      return finish(other(p), 'concede');
    },

    // End the match without a result; given the game, also hand the bay back (release).
    abort(g = null) {
      if (m.phase !== 'done') {
        bump();
        m.phase = 'done'; m.currentPlayerId = null; m.aborted = true; m.nextStage = null; m.waiting = null;
        m.pending = null; m.undo = null; m.restart = null;
        say('Match abandoned.');
      }
      if (g) this.release(g);
      return this.state();
    },

    // Hand the bay back. Stage 'current': the round exactly as it stood when the match began
    // (false, and nothing touched, if another course was loaded since). A tour match: the
    // bay stays on the last stage, with a fresh hole.
    release(g) {
      m.loadedId = null;
      if (!g) return false;
      if (mode === 'current') {
        if (g.course !== snapshot.course) return false;
        g.holeIndex = snapshot.holeIndex;
        g.over = snapshot.over;
        g.scores = [...snapshot.scores];
        g.pickedUp = [...snapshot.pickedUp];
        for (const k of POSITION) g[k] = k === 'ball' ? { ...snapshot.ball } : snapshot[k];
      g.dropLocked = false;   // v2:playability
        g._undo = snapshot._undo;
        g.player = snapshot.player;
        g.shotLog.length = Math.min(g.shotLog.length, snapshot.shotLogLength);
        return true;
      }
      if (!m.courseRef || g.course !== m.courseRef) return false;
      g.dropLocked = false;   // v2:playability
      g.reset();
      return true;
    },

    // What a rematch starts from: the same players and the options as they were asked for.
    config() {
      return {
        players: m.players.map((p) => ({ id: p.id, name: p.name, initials: p.initials, handicap: p.handicap })),
        options: {
          format: F.id, stage: want, order, tieRule, powerups, hazardLosesHole, putting,
          stakes: m.stakes ? m.stakes.tier : null,
          ...(mode === 'current' ? { holeIndex: startHole } : {}),
        },
      };
    },

    // The serializable state: GET /api/match and the 'match' event (docs/match.md).
    state() {
      const tb = m.tiebreak;
      return {
        id: m.id, seq: m.seq,
        format: F.id, formatLabel: F.label, target: F.target, maxHoles: F.maxHoles,
        stakes: m.stakes ? { ...m.stakes } : null,
        options: { tieRule, powerups, order, hazardLosesHole, strokeCap: STROKE_CAP, putting },
        phase: m.phase,
        currentPlayerId: m.currentPlayerId,
        holeNumber: m.holeNumber, holesPlayed: m.holesPlayed,
        holeIndex: m.hole ? m.hole.index : null, holeRef: m.hole ? m.hole.ref : null,
        par: m.stage ? m.stage.par : null, lengthYd: m.stage ? m.stage.lengthYd : null,
        stage: publicStage(m.stage),
        nextStage: publicStage(m.nextStage),
        honourId: m.honourId,
        players: m.players.map((p) => ({
          id: p.id, name: p.name, initials: p.initials, slot: p.slot,
          strokes: p.strokes, lie: p.lie, holed: p.holed, ball: p.ball ? { ...p.ball } : null,
          distToPinYd: pDist(p) == null ? null : r1(pDist(p)),
          holesWon: p.holesWon, holeScores: [...p.holeScores],
          mustHole: p.mustHole, capped: p.capped,
          shotFor: p.shotFor ?? null, shotKind: p.shotKind ?? null,
          charges: p.charges, usedPowerups: [...p.usedPowerups], armedPowerup: p.armedPowerup, cursedWith: p.cursedWith,
          tiebreakFt: p.tiebreakFt,
          stats: { ...p.stats, longestDriveYd: p.stats.longestDriveYd == null ? null : r1(p.stats.longestDriveYd), callouts: [...p.stats.callouts], bestShot: p.stats.bestShot ? { ...p.stats.bestShot } : null },
          profile: { ...p.profile },
        })),
        holeResults: m.holeResults.map((r) => ({ ...r, scores: { ...r.scores } })),
        lastResult: m.lastResult ? { ...m.lastResult, scores: { ...m.lastResult.scores } } : null,
        tiebreak: tb ? { arenaId: tb.arenaId, round: tb.round, pending: [...tb.pending], results: tb.results.map((r) => ({ ...r })), spotYd: tb.spotYd } : null,
        standings: standingsText(),
        matchPoint: matchPoint(),
        winnerId: m.winnerId, loserId: m.loserId, reason: m.reason,
        rewards: m.rewards,
        awards: m.awards,
        events: m.events.map((e) => ({ ...e })),
        waiting: m.waiting ? { for: m.waiting.for, since: m.waiting.since, timeoutMs: m.waiting.timeoutMs } : null,
        turnStartedAt: m.turnStartedAt, startedAt: m.startedAt,
        log: [...m.log],
        // the match menu: the swing undoLastShot() would take back ({ playerId, stray,
        // holeNumber }, or null), and whether restartHole() has a hole to restart
        // (v2:playability: with drop: true when it is a rescue drop, not a swing)
        undoable: m.undo && !m.aborted && !m.concededBy ? { playerId: m.undo.playerId, stray: Boolean(m.undo.stray), holeNumber: m.undo.holeNumber, ...(m.undo.drop ? { drop: true } : {}) } : null,
        canRestartHole: (m.phase === 'play' || m.phase === 'tiebreak') && Boolean(m.restart),
        aborted: m.aborted, concededBy: m.concededBy, error: m.error,
      };
    },
  };
}

module.exports = {
  createMatch, MatchError,
  MATCH_TIERS, MATCH_FORMATS, RANKS, POWERUPS, TIMEOUTS, STROKE_CAP, SHOOTOUT_YD, TIEBREAK_TIE_FT, BANKROLL,
  STRAY_MAX_MPH, STRAY_MIN_YD, isStrayShot, CHIP_MAX_YD, shotStake,
  tierFor, formatFor, scoreName, shootoutSpot, rankFor, normalizeProfile, rewardsFor, applyRewards,
  normalizeTour, powerupCatalogue,
};
