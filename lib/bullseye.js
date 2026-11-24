'use strict';
// v3:modes BULLSEYE: darts with a golf ball (docs/modes.md "Bullseye").
//
// One to four players on one of the three sudden-death arenas, whose greens are painted as a
// target: concentric rings round the pin. Every ball is hit from the arena's tee and scores
// by the ring it FINISHES in.
//
//   Rounds      a game is a number of rounds; in a round every player takes a turn of N
//               balls, one after another (three rounds of three by default). Round one goes
//               in lobby order; after that whoever is behind leads off.
//   Scoring     the smallest ring is the bullseye (50; a holed ball is one). The rings
//               outside it are worth 5, 10, 15, 25 counted from the outside in, so a
//               five-ring target reads 50 / 25 / 15 / 10 / 5 from the pin out and a
//               four-ring one 50 / 15 / 10 / 5. Outside the last ring: nothing. In the
//               water or out of bounds: a MISS (nothing, and it is no dart on the board).
//   'high'      high score: the most points when the rounds run out. With a MULTIPLIER:
//               score with every ball of a turn and they multiply: the second scoring ball
//               in a row counts double, the third (and every one after it) treble. A ball
//               that scores nothing breaks the run; a new turn starts at x1. Three
//               bullseyes in a turn is 50 + 100 + 150 = 300, the perfect turn.
//   'countdown' the "301" game: everybody starts on the target (100 by default; 200, 300)
//               and scores DOWN, plain ring values (no multiplier: an exact finish has to
//               be something a player can aim for). Landing on exactly zero is a CHECK OUT. A ball that would
//               go below zero is a BUST: the turn is over and the score goes back to what
//               it was when the turn began. Everybody gets the same number of turns, so
//               the round a player checks out in is played to its end: whoever still has
//               a turn may answer, and the check out in the FEWEST BALLS wins (a player
//               who has already thrown as many balls as the best check out took does not
//               throw on). It is capped (6 / 10 / 14 rounds): when the rounds run out
//               with nobody out, whoever is nearest zero wins.
//   Level       on points (or on what is left): the player whose best single ball finished
//               nearest the pin; still level: the game is shared.
//
// A pure, serializable state machine like lib/match.js and lib/solo.js: no I/O, no timers.
// The Game (lib/game.js) holds ONE ball; before each swing the thrower is put on the tee
// (beforeShot), after it the ball is scored where it lies and the game is tidied (a holed
// ball is no hole-out of the round). What needs the outside world is asked for through
// `waiting` and done by a driver (lib/bullseye-mode.js):
//
//   { for: 'stage', file, ... }    put the arena's course in the bay, then stageReady(game, token)
//   { for: 'tee', timeoutMs }      a ball has been scored and still lies where it finished, so
//                                  the picture can stay on it: tee(game) puts the next ball
//                                  on the tee (POST /api/bullseye/next, or the timeout)
//   { for: 'dismiss', timeoutMs }  over: the driver drops the game after the timeout
//
// A swing counts in 'play' only ('loading' and 'done' ignore it). A swing that arrives
// before tee() is played all the same: beforeShot tees the ball up itself, so nobody who
// is ready ever waits.

const { YD } = require('./physics');
const { initials } = require('./leagues');
const { isStrayShot } = require('./match');
const { gameWind } = require('./arcade-wind');

const VARIANTS = Object.freeze({
  high: Object.freeze({ id: 'high', label: 'High Score' }),
  countdown: Object.freeze({ id: 'countdown', label: 'Countdown' }),
});
const BULL = 50;                                   // the smallest ring, and a holed ball
const RING_VALUES = Object.freeze([5, 10, 15, 25]); // the other rings, from the outside in
const RING_NAMES = Object.freeze({ 50: 'BULLSEYE', 25: 'INNER RING', 15: 'MIDDLE RING', 10: 'OUTER RING', 5: 'EDGE RING' });
const DEFAULT_RINGS_M = Object.freeze([3, 7, 11, 15, 19]);   // an arena with no ring props (none of the three)
const MULT_MAX = 3;
const DEFAULTS = Object.freeze({ rounds: 3, balls: 3, target: 100 });
const TARGETS = Object.freeze([100, 200, 300]);
const COUNTDOWN_ROUNDS = Object.freeze({ 100: 6, 200: 10, 300: 14 });   // the cap of a countdown game
const MAX_PLAYERS = 4, MAX_ROUNDS = 20, MAX_BALLS = 6;
const EVENTS_MAX = 12, LOG_MAX = 40;
const TIMEOUTS = Object.freeze({ teeMs: 15000, doneMs: 600000 });
const FT = 3.28084;

class BullseyeError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'BullseyeError'; this.status = status; }
}

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const whole = (v, lo, hi, dflt) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : dflt);
const nonNeg = (v, dflt) => (Number.isFinite(+v) && +v >= 0 ? +v : dflt);
const ftText = (ft) => (ft < 1 ? `${Math.max(1, Math.round(ft * 12))} in` : `${ft < 10 ? r1(ft) : Math.round(ft)} ft`);

/**
 * The scoring table of a target: radii in metres (any order) -> [{ r, value, name }] from
 * the pin out. The smallest ring is the bullseye; the others are worth 5, 10, 15, 25 from
 * the OUTSIDE in (a target of six or more rings repeats 25 inside).
 */
function ringTable(radii) {
  const rs = [...new Set((Array.isArray(radii) ? radii : []).map((r) => r2(+r)).filter((r) => Number.isFinite(r) && r > 0))].sort((a, b) => a - b);
  return rs.map((r, i) => {
    const value = i === 0 ? BULL : RING_VALUES[Math.min(RING_VALUES.length - 1, rs.length - 1 - i)];
    return { r, value, name: RING_NAMES[value] };
  });
}

/**
 * The target painted on an arena: its `target-ring` props (course.props; `heightM` is the
 * ring's DIAMETER in metres) centred on the pin -> radii in metres, smallest first. An
 * arena without any: the default target.
 */
function ringsFromCourse(course, pin) {
  const props = course && Array.isArray(course.props) ? course.props : [];
  const out = [];
  for (const p of props) {
    if (!p || p.kind !== 'target-ring' || !Number.isFinite(+p.heightM) || +p.heightM <= 0) continue;
    if (pin && Number.isFinite(+p.x) && Number.isFinite(+p.y) && Math.hypot(+p.x - pin[0], +p.y - pin[1]) > 2) continue;   // a ring somewhere else is scenery
    out.push(+p.heightM / 2);
  }
  return ringTable(out.length ? out : DEFAULT_RINGS_M);
}

/**
 * What one ball is worth: { distM, miss: 'water' | 'ob' | null, holed } on a ring table ->
 * { ring: index from the pin (0: the bullseye) | null, value, name, zone: 'ring' | 'off' | 'miss' }.
 */
function scoreBall({ distM, miss = null, holed = false } = {}, rings = []) {
  if (miss) return { ring: null, value: 0, name: 'MISS', zone: 'miss' };
  if (holed && rings.length) return { ring: 0, value: rings[0].value, name: rings[0].name, zone: 'ring' };
  if (Number.isFinite(distM)) {
    for (let i = 0; i < rings.length; i++) if (distM <= rings[i].r + 1e-6) return { ring: i, value: rings[i].value, name: rings[i].name, zone: 'ring' };
  }
  return { ring: null, value: 0, name: 'OFF THE TARGET', zone: 'off' };
}

/** The multiplier of the next ball after `streak` scoring balls in a row this turn. */
const multFor = (streak) => Math.min(MULT_MAX, 1 + Math.max(0, streak | 0));

/** The options of a game, cleaned: { variant, rounds, balls, target }. */
function cleanOptions(o = {}) {
  const variant = VARIANTS[String(o.variant || '').toLowerCase()] ? String(o.variant).toLowerCase() : 'high';
  const target = variant === 'countdown' ? (TARGETS.includes(+o.target) ? +o.target : DEFAULTS.target) : null;
  const rounds = whole(o.rounds, 1, MAX_ROUNDS, variant === 'countdown' ? COUNTDOWN_ROUNDS[target] : DEFAULTS.rounds);
  return { variant, rounds, balls: whole(o.balls, 1, MAX_BALLS, DEFAULTS.balls), target };
}

/**
 * @param {object[]} a.players  1 to 4 of { id, name, initials? }, in throwing order (slot 1 first)
 * @param {object}   a.arena    { id, name, file, lengthYd?, theme?, timeOfDay?, blurb? } (a tiebreak arena of the tour)
 * @param {object}   a.options  { variant: 'high' | 'countdown', rounds, balls, target }
 * @param {function} a.now      Date.now
 * @param {object}   a.timeouts { teeMs, doneMs } for `waiting.timeoutMs`
 */
function createBullseye({ players, arena, options = {}, now = Date.now, random = Math.random, timeouts = {} } = {}) {
  if (!Array.isArray(players) || players.length < 1 || players.length > MAX_PLAYERS) throw new BullseyeError('Bullseye is for one to four players');
  if (players.some((p) => !p || p.id == null || !p.name)) throw new BullseyeError('Each player needs an id and a name');
  if (new Set(players.map((p) => String(p.id))).size !== players.length) throw new BullseyeError('Pick different players');
  if (!arena || !arena.id || !arena.file) throw new BullseyeError('Pick an arena', 404);
  const O = cleanOptions(options);
  const T_ = { teeMs: nonNeg(timeouts.teeMs, TIMEOUTS.teeMs), doneMs: nonNeg(timeouts.doneMs, TIMEOUTS.doneMs) };

  const fresh = (p, i) => ({
    id: String(p.id), name: String(p.name), initials: p.initials || initials(p.name), slot: i + 1,
    total: 0,                                             // points that count (a bust takes its turn's back)
    remaining: O.variant === 'countdown' ? O.target : null,
    turns: [],                                            // closed turns: { round, score, bust }
    darts: [],                                            // every ball: see dart() below
    bulls: 0, misses: 0, busts: 0, closestFt: null, bestTurn: 0, balls: 0,
    out: null,                                            // countdown: checked out with this many balls thrown
    aimOffset: 0,
  });

  const m = {
    id: `be_${now().toString(36)}${Math.floor(random() * 1e6).toString(36)}`,
    seq: 0,
    phase: 'loading',
    arena: {
      id: String(arena.id), name: String(arena.name || arena.id), file: String(arena.file),
      lengthYd: Number.isFinite(+arena.lengthYd) ? Math.round(+arena.lengthYd) : null,
      theme: arena.theme || null, timeOfDay: arena.timeOfDay || 'day', blurb: arena.blurb || '', wind: null,
    },
    rings: [],
    hole: null, courseRef: null,          // the hole in the bay: { index, tee, pin, ux, uy }
    players: players.map(fresh),
    round: 1, order: players.map((p) => String(p.id)), turn: 0, ball: 1,
    visit: null,                          // the turn being thrown: { playerId, start, score, streak }
    currentPlayerId: null, loadedId: null, teed: false,
    darts: 0,                             // balls thrown in the game (a dart's n)
    lastBall: null,
    winnerIds: [], reason: null,          // 'score' (the rounds ran out) | 'finish' (a check out) | 'cap' (countdown, the rounds ran out)
    records: null,                        // set by the driver: the bests this game is up against / has made
    events: [], log: [],
    waiting: null, waitToken: 0,
    pending: null, undo: null,            // snapshots: the game before the ball being played / just played
    aborted: false, error: null,
    startedAt: now(), endedAt: null,
  };

  const byId = (id) => m.players.find((p) => p.id === String(id)) || null;
  const bump = () => { m.seq++; };
  const emit = (type, data = {}) => {
    m.events.push({ seq: ++m.seq, type, t: now(), ...data });
    if (m.events.length > EVENTS_MAX) m.events.splice(0, m.events.length - EVENTS_MAX);
  };
  const say = (text) => { m.log.push({ t: now(), text }); if (m.log.length > LOG_MAX) m.log.splice(0, m.log.length - LOG_MAX); };
  const wait = (what, extra = {}) => {
    const timeoutMs = what === 'tee' ? T_.teeMs : what === 'dismiss' ? T_.doneMs : null;
    m.waiting = { for: what, token: ++m.waitToken, since: now(), timeoutMs, ...extra };
  };
  const current = () => byId(m.currentPlayerId);
  // how a player stands: more is better in both games (countdown: what has come off the target)
  const standing = (p) => (O.variant === 'countdown' ? O.target - p.remaining : p.total);
  // what the next ball of a turn is multiplied by (the high-score game only)
  const multOf = (streak) => (O.variant === 'high' ? multFor(streak) : 1);

  // ---- the one-ball game ----
  // Put the thrower on the tee (and make the game playable: this hole, not over, not holed).
  function load(g, p) {
    if (!g || !m.hole || g.course !== m.courseRef || !p) return;
    const i = m.hole.index;
    g.holeIndex = i;
    g.over = false;
    g.scores[i] = null;
    g.pickedUp[i] = false;
    g._undo = null;
    g.ball = { x: m.hole.tee[0], y: m.hole.tee[1] };
    g.strokes = 0; g.lie = 'tee'; g.holed = false;
    g.aimOffset = p.aimOffset;
    g.player = { id: p.id, name: p.name, initials: p.initials, handicap: null };
    g.dropLocked = true;        // no rescue drop: every ball is from the tee
    m.loadedId = p.id;
    m.teed = true;
  }
  // A holed ball is no hole-out of the round: no score, no "round over". The ball stays
  // where it finished until tee() / the next swing.
  function tidy(g) {
    if (!g || !m.hole || g.course !== m.courseRef) return;
    g.over = false;
    g.scores[m.hole.index] = null;
    g.pickedUp[m.hole.index] = false;
    g.holed = false;
    g.strokes = 0;
    g._undo = null;
  }

  // ---- snapshots (undo): everything but the history, the counters and the course ----
  const HISTORY = ['id', 'seq', 'events', 'log', 'waitToken', 'startedAt', 'courseRef', 'pending', 'undo', 'records'];
  function snap() {
    const copy = {};
    for (const k of Object.keys(m)) if (!HISTORY.includes(k)) copy[k] = m[k];
    return structuredClone(copy);
  }

  // ---- turns ----
  function startTurn(g) {
    const p = byId(m.order[m.turn]);
    m.currentPlayerId = p.id;
    m.ball = 1;
    m.visit = { playerId: p.id, start: O.variant === 'countdown' ? p.remaining : p.total, score: 0, streak: 0 };
    emit('turn', { playerId: p.id, round: m.round });
    if (g) load(g, p);
  }
  // The order of the next round: whoever is behind leads off (level: as they stood).
  function nextOrder() {
    const at = (id) => m.order.indexOf(id);
    return [...m.players].sort((a, b) => standing(a) - standing(b) || at(a.id) - at(b.id)).map((p) => p.id);
  }
  // First to last. Level on points: the best single ball (nearest the pin) decides; still level: shared.
  // (a countdown two players checked out of: the one who needed fewer balls is ahead)
  function ranking() {
    const close = (p) => (p.closestFt == null ? Infinity : p.closestFt);
    const took = (p) => (p.out == null ? Infinity : p.out);
    const sorted = [...m.players].sort((a, b) => standing(b) - standing(a) || took(a) - took(b) || close(a) - close(b) || a.slot - b.slot);
    let rank = 0;
    return sorted.map((p, i) => {
      const prev = sorted[i - 1];
      if (!prev || standing(prev) !== standing(p) || took(prev) !== took(p) || close(prev) !== close(p)) rank = i + 1;
      return { playerId: p.id, rank, total: p.total, remaining: p.remaining, closestFt: p.closestFt, out: p.out };
    });
  }
  // The best check out so far ({ playerId, balls }), and whether a player can still match it.
  function chase() {
    const out = m.players.filter((p) => p.out != null).sort((a, b) => a.out - b.out);
    return out.length ? { playerId: out[0].id, balls: out[0].out } : null;
  }
  const cannotCatch = (p) => { const c = chase(); return Boolean(c && p.out == null && p.balls >= c.balls); };
  function finish(reason, winner = null) {
    m.phase = 'done';
    m.reason = reason;
    m.endedAt = now();
    m.currentPlayerId = null;
    m.visit = null;
    m.winnerIds = winner ? [winner.id] : ranking().filter((x) => x.rank === 1).map((x) => x.playerId);
    const names = m.winnerIds.map((id) => byId(id).name);
    say(m.players.length === 1 ? `Game over: ${m.players[0].name} ${O.variant === 'countdown' ? (m.players[0].remaining === 0 ? 'checks out!' : `has ${m.players[0].remaining} left`) : `scores ${m.players[0].total}`}.`
      : names.length > 1 ? `Game shared: ${names.join(' and ')}.` : `${names[0].toUpperCase()} WINS${reason === 'finish' ? ` by checking out in ${byId(m.winnerIds[0]).out} balls` : ''}!`);
    emit('game-over', { winnerIds: [...m.winnerIds], reason });
    wait('dismiss');
  }

  // What ring (by its value) would finish a countdown for this player with their next ball.
  function finishers(p) {
    if (O.variant !== 'countdown' || m.phase !== 'play' || !m.visit || m.visit.playerId !== p.id) return [];
    return m.rings.filter((r) => r.value === p.remaining).map((r) => r.name).filter((n, i, a) => a.indexOf(n) === i);
  }

  // One ball, scored where it lies. Returns its event.
  function played(g, p, result) {
    const h = m.hole;
    const sim = result.sim || {};
    const wet = Boolean(result.penalty) || result.lie === 'water' || result.lie === 'ob';
    const miss = wet ? (/water/i.test(result.note || '') || result.lie === 'water' ? 'water' : 'ob') : null;
    // where it finished: the ball in the game; a ball that was lost, the last point of its path (the game has dropped it)
    const pts = Array.isArray(sim.points) ? sim.points : [];
    const at = miss && pts.length ? pts[pts.length - 1] : g.ball;
    const dx = at.x - h.pin[0], dy = at.y - h.pin[1];
    const distM = Math.hypot(dx, dy);
    const holed = !miss && Boolean(result.holed) && distM < 0.05;
    const s = scoreBall({ distM, miss, holed }, m.rings);
    const v = m.visit;
    const mult = s.value > 0 ? multOf(v.streak) : 1;
    const score = s.value * mult;
    let bust = false, checkout = false;
    if (O.variant === 'countdown') {
      if (score > p.remaining) bust = true;
      else { p.remaining -= score; checkout = p.remaining === 0; }
    }
    const ft = miss ? null : r2(distM * FT);
    const dart = {
      n: ++m.darts, playerId: p.id, round: m.round, ball: m.ball,
      x: r2(dx * h.uy - dy * h.ux),    // metres across the line of play (+ right of the pin, seen from the tee)
      y: r2(dx * h.ux + dy * h.uy),    // metres along it (+ long, past the pin)
      ft, ring: s.ring, value: s.value, name: s.name, zone: s.zone, mult, score: bust ? 0 : score, miss, holed, bust,
      ...(checkout ? { checkout: true } : {}),
    };
    p.darts.push(dart);
    p.balls++;
    if (s.ring === 0) p.bulls++;
    if (miss) p.misses++;
    if (ft != null) p.closestFt = p.closestFt == null ? ft : Math.min(p.closestFt, ft);
    if (bust) {
      // the turn's points go back: the score is what it was when the turn began
      for (const d of p.darts) if (d.round === m.round && d.n !== dart.n && d.score) { d.voided = d.score; d.score = 0; }
      p.remaining = v.start;
      p.total = O.target - p.remaining;
      v.score = 0; v.streak = 0;
      p.busts++;
    } else {
      v.score += score;
      v.streak = s.value > 0 ? v.streak + 1 : 0;
      p.total = O.variant === 'countdown' ? O.target - p.remaining : p.total + score;
    }
    m.lastBall = { ...dart };
    tidy(g);
    say(checkout ? `${p.name} CHECKS OUT with ${s.name}${mult > 1 ? ` x${mult}` : ''}: zero in ${p.balls} balls!`
      : bust ? `${p.name}: BUST! ${score} is too many: back to ${p.remaining}.`
      : miss ? `${p.name} ${miss === 'water' ? 'finds the water' : 'is out of bounds'}: a miss.`
        : holed ? `${p.name} HOLES IT! ${score}.`
          : s.value ? `${p.name}: ${s.name}${mult > 1 ? ` x${mult}` : ''}, ${score}. ${ftText(ft)} from the pin.`
            : `${p.name} is off the target, ${ftText(ft)} away.`);
    emit('ball', { playerId: p.id, n: dart.n, ring: s.ring, value: s.value, mult, score: dart.score, ft, miss, bust, holed });
    const base = { event: 'ball', playerId: p.id, dart: { ...dart }, total: p.total, remaining: p.remaining };

    if (checkout) { p.out = p.balls; emit('checkout', { playerId: p.id, balls: p.balls }); }
    // the turn goes on: balls left, no bust, not out, and (a countdown somebody is out of) still able to match that
    if (!checkout && !bust && m.ball < O.balls && !cannotCatch(p)) {
      m.ball++;
      m.teed = false;
      wait('tee');
      return { ...base, nextPlayerId: p.id, ball: m.ball, mult: multOf(v.streak) };
    }
    const turnScore = v.score;
    p.turns.push({ round: m.round, score: turnScore, bust, ...(checkout ? { out: true } : {}) });
    p.bestTurn = Math.max(p.bestTurn, turnScore);
    emit('turn-over', { playerId: p.id, round: m.round, score: turnScore, bust });
    const over = (reason) => { finish(reason); return { ...base, event: 'game-over', turnScore, winnerIds: [...m.winnerIds], reason: m.reason }; };
    m.turn++;
    while (m.turn < m.order.length && cannotCatch(byId(m.order[m.turn]))) m.turn++;   // they have thrown as many balls as the check out took: no turn
    if (m.turn >= m.order.length) {
      emit('round-over', { round: m.round });
      if (chase()) return over('finish');                       // somebody checked out, and everybody has had the same turns
      if (m.round >= O.rounds) return over(O.variant === 'countdown' ? 'cap' : 'score');
      m.round++;
      m.order = nextOrder();
      m.turn = 0;
      say(`Round ${m.round} of ${O.rounds}: ${byId(m.order[0]).name} leads off.`);
    } else if (checkout) {
      say(`${byId(m.order[m.turn]).name} can still answer: a check out in ${p.out} balls or fewer.`);
    }
    startTurn(null);            // the next thrower is up; their ball goes on the tee with tee() / their swing
    m.teed = false;
    wait('tee');
    return { ...base, turnScore, turnOver: true, ...(checkout ? { checkout: true } : {}), nextPlayerId: m.currentPlayerId, round: m.round, ball: 1 };
  }

  emit('game-start', { variant: O.variant, playerIds: m.players.map((p) => p.id), arenaId: m.arena.id });
  say(`Bullseye at ${m.arena.name}: ${VARIANTS[O.variant].label}${O.variant === 'countdown' ? ` from ${O.target}` : ''}, ${O.rounds} round${O.rounds === 1 ? '' : 's'} of ${O.balls}.`);
  wait('stage', { stageId: m.arena.id, file: m.arena.file });

  return {
    get id() { return m.id; },
    get phase() { return m.phase; },
    get active() { return m.phase !== 'done'; },
    get aborted() { return m.aborted; },
    get currentPlayerId() { return m.currentPlayerId; },
    get waiting() { return m.waiting ? { ...m.waiting } : null; },
    get arena() { return { ...m.arena }; },

    // The arena's course is in the game: read its target, tee the first ball up.
    stageReady(g, token = null, { wind = null } = {}) {
      if (m.phase !== 'loading' || !m.waiting || m.waiting.for !== 'stage') return false;
      if (token != null && token !== m.waiting.token) return false;
      if (!g || !g.course || !g.course.holes.length) throw new BullseyeError('No course is loaded', 409);
      const h = g.course.holes[0];
      const len = Math.hypot(h.pin[0] - h.tee[0], h.pin[1] - h.tee[1]) || 1;
      bump();
      m.courseRef = g.course;
      m.hole = { index: 0, tee: [h.tee[0], h.tee[1]], pin: [h.pin[0], h.pin[1]], ux: (h.pin[0] - h.tee[0]) / len, uy: (h.pin[1] - h.tee[1]) / len };
      m.rings = ringsFromCourse(g.course, m.hole.pin);
      m.arena.lengthYd = m.arena.lengthYd ?? Math.round(len / YD);
      m.arena.wind = wind && Number.isFinite(wind.mph) ? { ...wind } : gameWind(g, h);
      m.phase = 'play';
      m.waiting = null;
      emit('stage-loaded', { arenaId: m.arena.id, rings: m.rings.length });
      startTurn(g);
      return true;
    },
    // The arena would not load: the game is off.
    stageFailed(token = null, message = '') {
      if (m.phase !== 'loading' || !m.waiting || m.waiting.for !== 'stage') return false;
      if (token != null && token !== m.waiting.token) return false;
      bump();
      m.phase = 'done'; m.aborted = true; m.currentPlayerId = null; m.waiting = null;
      m.error = message || `${m.arena.name} would not load`;
      say(`Game abandoned: ${m.error}.`);
      return true;
    },

    // Put the ball of whoever is up on the tee (the picture leaves the last ball). False
    // when it is there already or no ball is being waited for.
    tee(g, token = null) {
      if (m.phase !== 'play' || m.teed) return false;
      if (token != null && (!m.waiting || token !== m.waiting.token)) return false;
      bump();
      m.waiting = null;
      load(g, current());
      return true;
    },

    // Before the game plays a swing: null when swings do not count (the caller drops it),
    // else the thrower is on the tee: { playerId, round, ball }.
    beforeShot(g) {
      if (m.phase !== 'play') return null;
      const p = current();
      if (!p || !g || g.course !== m.courseRef) return null;
      if (m.loadedId === p.id && m.teed) p.aimOffset = g.aimOffset;   // the aim set for this ball
      m.pending = { m: snap(), playerId: p.id };
      load(g, p);
      if (m.waiting && m.waiting.for === 'tee') m.waiting = null;
      return { playerId: p.id, round: m.round, ball: m.ball };
    },

    // After the game played it: the ball is scored where it lies; the turn, the round or
    // the game moves on. Returns the ball's event (it rides on the shot as result.bullseye).
    afterShot(g, result) {
      if (m.phase !== 'play' || !m.currentPlayerId || !result) return null;
      const p = current();
      bump();
      const before = m.pending && m.pending.playerId === p.id ? m.pending : null;
      m.pending = null;
      const launch = (result.arcadeShot && result.arcadeShot.realLaunch) || result.launch || {};
      const stray = isStrayShot({ speedMph: launch.speedMph, isPutt: Boolean(result.sim && result.sim.isPutt), lie: 'tee', distYd: Math.hypot(m.hole.pin[0] - m.hole.tee[0], m.hole.pin[1] - m.hole.tee[1]) / YD });
      const ev = played(g, p, result);
      m.undo = before ? { ...before, stray, n: m.lastBall ? m.lastBall.n : null } : null;
      if (!stray) return ev;
      emit('stray-shot', { playerId: p.id, speedMph: r1(launch.speedMph) });
      return { ...ev, stray: true };
    },

    // Take the last ball back: the game exactly as it was before it (also from 'done').
    undoLastBall(g = null) {
      const u = m.undo;
      if (!u || m.aborted) throw new BullseyeError('There is no ball to take back', 409);
      const from = m.phase;
      Object.assign(m, structuredClone(u.m));
      m.pending = null; m.undo = null;
      bump();
      m.waiting = null;
      const p = current();
      if (g && p) load(g, p);
      emit('ball-undone', { playerId: u.playerId, stray: Boolean(u.stray), from });
      say(`${byId(u.playerId) ? byId(u.playerId).name : 'The'}'s last ball is taken back${u.stray ? ' (a stray ball)' : ''}.`);
      return { event: 'ball-undone', playerId: u.playerId, stray: Boolean(u.stray), from };
    },

    // The same game from the top: same players, arena, wind and options, every dart gone.
    restart(g = null) {
      if (m.phase === 'loading' || m.aborted || !m.hole) throw new BullseyeError('No game is being played', 409);
      bump();
      m.players = m.players.map((p, i) => ({ ...fresh(p, i), aimOffset: 0 }));
      m.phase = 'play';
      m.round = 1; m.order = m.players.map((p) => p.id); m.turn = 0; m.ball = 1;
      m.darts = 0; m.lastBall = null; m.winnerIds = []; m.reason = null; m.endedAt = null; m.records = null;
      m.pending = null; m.undo = null; m.waiting = null;
      emit('restarted', {});
      say('The game starts again.');
      startTurn(g);
      return { event: 'restarted' };
    },

    // End it with no result; given the game, hand the bay back.
    abort(g = null) {
      if (m.phase !== 'done') {
        bump();
        m.phase = 'done'; m.aborted = true; m.currentPlayerId = null; m.visit = null; m.waiting = null;
        m.pending = null; m.undo = null;
        say('Game abandoned.');
      }
      if (g) this.release(g);
      return this.state();
    },
    // Hand the bay back: the arena stays, with a fresh hole.
    release(g) {
      m.loadedId = null;
      if (!g || !m.courseRef || g.course !== m.courseRef) return false;
      g.dropLocked = false;
      g.reset();
      return true;
    },

    // What "play again" starts from.
    config() {
      return { players: m.players.map((p) => ({ id: p.id, name: p.name, initials: p.initials })), arenaId: m.arena.id, options: { ...O } };
    },

    // The bests this game is up against, and the ones it made (the driver keeps the store).
    setRecords(records) { m.records = records ? structuredClone(records) : null; bump(); },

    // A finished game, for the best-score store: one entry per player (null: no result).
    result() {
      if (m.phase !== 'done' || m.aborted) return null;
      return {
        arenaId: m.arena.id, arenaName: m.arena.name, variant: O.variant, rounds: O.rounds, balls: O.balls, target: O.target, at: m.endedAt || now(),
        players: m.players.map((p) => ({
          playerId: p.id, name: p.name, score: p.total, remaining: p.remaining, ballsThrown: p.out ?? p.balls,
          finished: p.out != null, closestFt: p.closestFt,
        })),
      };
    },

    state() {
      const up = current();
      return {
        id: m.id, seq: m.seq,
        variant: O.variant, variantLabel: VARIANTS[O.variant].label,
        options: { ...O },
        phase: m.phase,
        arena: { id: m.arena.id, name: m.arena.name, lengthYd: m.arena.lengthYd, theme: m.arena.theme, timeOfDay: m.arena.timeOfDay, blurb: m.arena.blurb, wind: m.arena.wind ? { ...m.arena.wind } : null },
        rings: m.rings.map((r) => ({ ...r })),
        round: m.round, rounds: O.rounds, ball: m.ball, balls: O.balls,
        currentPlayerId: m.currentPlayerId, order: [...m.order], teed: m.teed,
        // the turn being thrown: its points so far and what the next ball is multiplied by
        turn: m.visit ? { playerId: m.visit.playerId, score: m.visit.score, streak: m.visit.streak, mult: multOf(m.visit.streak), start: m.visit.start } : null,
        players: m.players.map((p) => ({
          id: p.id, name: p.name, initials: p.initials, slot: p.slot,
          total: p.total, remaining: p.remaining,
          turns: p.turns.map((t) => ({ ...t })), darts: p.darts.map((d) => ({ ...d })),
          bulls: p.bulls, misses: p.misses, busts: p.busts, closestFt: p.closestFt, bestTurn: p.bestTurn, balls: p.balls,
          out: p.out,                                   // countdown: checked out with this many balls (null: not out)
          finish: up && up.id === p.id ? finishers(p) : [],
        })),
        lastBall: m.lastBall ? { ...m.lastBall } : null,
        // countdown: the check out to beat ({ playerId, balls }) while the round it came in is played out
        chase: m.phase === 'play' ? chase() : null,
        standings: ranking(),
        winnerIds: [...m.winnerIds], reason: m.reason,
        records: m.records ? structuredClone(m.records) : null,
        undoable: m.undo && !m.aborted ? { playerId: m.undo.playerId, stray: Boolean(m.undo.stray), n: m.undo.n } : null,
        canRestart: (m.phase === 'play' || m.phase === 'done') && !m.aborted && Boolean(m.hole),
        events: m.events.map((e) => ({ ...e })),
        waiting: m.waiting ? { for: m.waiting.for, since: m.waiting.since, timeoutMs: m.waiting.timeoutMs } : null,
        log: [...m.log],
        startedAt: m.startedAt, endedAt: m.endedAt, aborted: m.aborted, error: m.error,
      };
    },
  };
}

// ---------- the bests: per-arena high scores per player, and the nearest ball of the night ----------

/**
 * The "night" a moment belongs to: the local date, with the day turning over at 6 in the
 * morning (a session that runs past midnight is still the same night).
 */
function nightKey(t = Date.now()) {
  const d = new Date(t - 6 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * <dataDir>/bullseye-best.json:
 *   { version: 1,
 *     high:      { <arenaId>: { '<rounds>x<balls>': { <playerId>: { score, at, name } } } },
 *     countdown: { <arenaId>: { '<target>': { <playerId>: { balls, at, name } } } },   // fewest balls to check out
 *     nearest:   { ft, playerId, name, arenaId, arenaName, at, night } | null,        // the nearest ball of the night
 *     nearestEver: { ... } | null }
 * A guest's scores are kept under '_guest'.
 */
function createBullseyeBests({ dataDir = null, file = null, now = Date.now, log = console } = {}) {
  const fs = require('fs');
  const path = require('path');
  const FILE = file || (dataDir ? path.join(dataDir, 'bullseye-best.json') : null);
  let data = { version: 1, high: {}, countdown: {}, nearest: null, nearestEver: null };
  if (FILE) {
    try {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (raw && typeof raw === 'object') {
        for (const k of ['high', 'countdown']) if (raw[k] && typeof raw[k] === 'object' && !Array.isArray(raw[k])) data[k] = raw[k];
        for (const k of ['nearest', 'nearestEver']) if (raw[k] && typeof raw[k] === 'object' && Number.isFinite(+raw[k].ft)) data[k] = raw[k];
      }
    } catch (_) { /* no scores yet */ }
  }
  const key = (id) => (id == null || id === '' ? '_guest' : String(id));
  const save = () => {
    if (!FILE) return;
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
    } catch (error) {
      if (log && log.warn) log.warn(`[bullseye] best scores not saved: ${error.message}`);
    }
  };
  const tonight = () => (data.nearest && data.nearest.night === nightKey(now()) ? { ...data.nearest } : null);
  return {
    /** The boards of one arena: { high: { '3x3': { id: rec } }, countdown: { '100': { id: rec } } }. */
    arena(arenaId) {
      return structuredClone({ high: data.high[arenaId] || {}, countdown: data.countdown[arenaId] || {} });
    },
    /** What a game of this shape is up against: { <playerId>: record } (only the players who have one). */
    board({ arenaId, variant, rounds, balls, target } = {}) {
      const b = variant === 'countdown' ? (data.countdown[arenaId] || {})[String(target)] : (data.high[arenaId] || {})[`${rounds}x${balls}`];
      return structuredClone(b || {});
    },
    /** Offer a finished game (engine.result()). -> { <playerId>: { newBest, best } }. */
    offerGame(result) {
      const out = {};
      if (!result || !Array.isArray(result.players)) return out;
      let changed = false;
      for (const p of result.players) {
        const k = key(p.playerId);
        if (result.variant === 'countdown') {
          const board = ((data.countdown[result.arenaId] ||= {})[String(result.target)] ||= {});
          const had = board[k] || null;
          if (p.finished && (!had || p.ballsThrown < had.balls)) { board[k] = { balls: p.ballsThrown, at: result.at, name: p.name }; changed = true; out[p.playerId] = { newBest: true, best: { ...board[k] } }; }
          else out[p.playerId] = { newBest: false, best: had ? { ...had } : null };
        } else {
          const board = ((data.high[result.arenaId] ||= {})[`${result.rounds}x${result.balls}`] ||= {});
          const had = board[k] || null;
          if (p.score > 0 && (!had || p.score > had.score)) { board[k] = { score: p.score, at: result.at, name: p.name }; changed = true; out[p.playerId] = { newBest: true, best: { ...board[k] } }; }
          else out[p.playerId] = { newBest: false, best: had ? { ...had } : null };
        }
      }
      if (changed) save();
      return out;
    },
    /** Offer one ball's distance. -> { night: true when it is the nearest of the night, ever: likewise, nearest, nearestEver }. */
    offerBall({ ft, playerId = null, name = null, arenaId = null, arenaName = null } = {}) {
      const res = { night: false, ever: false };
      if (Number.isFinite(ft) && ft >= 0) {
        const rec = { ft, playerId: key(playerId), name, arenaId, arenaName, at: now(), night: nightKey(now()) };
        const cur = tonight();
        if (!cur || ft < cur.ft) { data.nearest = rec; res.night = true; }
        if (!data.nearestEver || ft < data.nearestEver.ft) { data.nearestEver = { ...rec }; res.ever = true; }
        if (res.night || res.ever) save();
      }
      return { ...res, nearest: tonight(), nearestEver: data.nearestEver ? { ...data.nearestEver } : null };
    },
    /** The nearest ball of the night (null: none yet tonight), and of all time. */
    nearest() { return tonight(); },
    nearestEver() { return data.nearestEver ? { ...data.nearestEver } : null; },
    /** Everything, as it is on disk (to put back with restore(): an undone ball takes its records with it). */
    snapshot() { return structuredClone(data); },
    restore(snapshot) { if (snapshot && typeof snapshot === 'object') { data = structuredClone(snapshot); save(); } },
    /** A player was removed from the roster: their scores go too. */
    forget(playerId) {
      const k = key(playerId);
      let changed = false;
      for (const arena of [...Object.values(data.high), ...Object.values(data.countdown)]) for (const board of Object.values(arena)) if (board[k]) { delete board[k]; changed = true; }
      for (const n of ['nearest', 'nearestEver']) if (data[n] && data[n].playerId === k) { data[n] = null; changed = true; }
      if (changed) save();
      return changed;
    },
  };
}

module.exports = {
  createBullseye, createBullseyeBests, BullseyeError,
  VARIANTS, BULL, RING_VALUES, RING_NAMES, DEFAULT_RINGS_M, MULT_MAX, DEFAULTS, TARGETS, COUNTDOWN_ROUNDS, TIMEOUTS, MAX_PLAYERS,
  ringTable, ringsFromCourse, scoreBall, multFor, cleanOptions, nightKey,
};
