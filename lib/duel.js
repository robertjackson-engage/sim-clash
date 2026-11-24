'use strict';
// v3:modes TRICK SHOT DUEL: call your shot, match it or take a letter (docs/modes.md "Trick
// shot duel"). Two players, one stage, every ball from its tee.
//
//   A round     the CHALLENGER hits any shot. The game reads what made it special and says
//               so as the CALL: its carry, and the one or two things most its own (how much
//               it bent and which way, how close it finished, how tall or how low it flew,
//               a gadget it went through): "MATCH IT: 150 YD CARRY · BENDS LEFT · INSIDE 32
//               FT". The other player gets one ball to MATCH it, every part of the call
//               within its tolerance. Matched: nothing happens. Not matched: a LETTER.
//               Then the roles swap, whatever happened: the players take turns to call.
//   NO CALL     a challenger's ball that is lost (water, out of bounds) or a duff (under 40
//               yd of carry, or a putt) sets no challenge: no letter for anyone, the round
//               is over and the roles swap.
//   Letters     spell a word (CLASH by default; PIG and HORSE in the lobby; any word of 2 to
//               8 letters). Whoever spells it first has LOST.
//   The cap     four rounds for every letter of the word (CLASH: 20). When they run out the
//               player with fewer letters wins; level: the duel is shared.
//
// The tolerances (TOL below) are generous on purpose: a real golfer who hits the shot that
// was called should get it. Carry within 10 % (at least 8 yd either way); the same bend
// side with at least 40 % of the bend (3 yd at the least); finishing inside twice the
// challenger's distance (at least 20 ft more); as tall as 85 % of a tall one, no taller than
// 125 % (+ 5 ft) of a low one; through the same gadget; on the green.
//
// A pure, serializable state machine like lib/bullseye.js: no I/O, no timers. The Game
// holds ONE ball; before each swing whoever is up is put on the tee (beforeShot), after it
// the shot is read where it lies and the game is tidied. What needs the outside world is
// asked for through `waiting` and done by a driver (lib/duel-mode.js):
//
//   { for: 'stage', file, ... }    put the stage's course in the bay, then stageReady(game, token)
//   { for: 'tee', timeoutMs }      a ball has been judged and still lies where it finished:
//                                  tee(game) puts the next one on the tee (POST /api/duel/next,
//                                  or the timeout); a swing does it by itself
//   { for: 'dismiss', timeoutMs }  over: the driver drops the duel after the timeout
//
// A swing counts in 'play' only ('loading' and 'done' ignore it).

const { YD } = require('./physics');
const { initials } = require('./leagues');
const { isStrayShot } = require('./match');
const { gameWind } = require('./arcade-wind');

const WORDS = Object.freeze(['CLASH', 'PIG', 'HORSE']);
const ROUNDS_PER_LETTER = 4;        // the cap: this many rounds for every letter of the word
const DUFF_YD = 40;                 // a challenger's ball that carries less than this is no call
const FT_PER_YD = 3;
// what makes a shot worth calling, and how close a match has to be
const TOL = Object.freeze({
  carryPct: 0.10, carryMinYd: 8,                    // carry: within 10 %, at least 8 yd either way
  curveMinYd: 6, curveShare: 0.4, curveFloorYd: 3,  // a bend of 6 yd or more is called; match: the same side, 40 % of it (3 yd at least)
  finishCallFt: 60, finishFactor: 2, finishMinFt: 20,   // finishing inside 60 ft is called; match: inside twice that distance, at least 20 ft more
  tallFt: 100, tallShare: 0.85,                     // 100 ft and up is TALL; match: 85 % of it
  lowFt: 30, lowCarryYd: 100, lowFactor: 1.25, lowPlusFt: 5,   // 30 ft and under with 100 yd of carry is LOW; match: no taller than 125 % + 5 ft
});
const GADGET_WORDS = Object.freeze({
  ring: 'THROUGH THE RING', cannon: 'INTO THE CANNON', warp: 'THROUGH THE WARP', wall: 'THROUGH THE WALL',
  pad: 'OFF THE BOUNCE PAD', strip: 'OVER THE BOOST STRIP', coins: 'THROUGH THE COINS',
});
const GADGET_RANK = Object.freeze(['ring', 'cannon', 'warp', 'wall', 'pad', 'strip', 'coins']);   // which one a call names when a ball met several
const GADGET_SKIP = Object.freeze(['zone', 'warp-exit']);   // not something a player aims a ball through
const EVENTS_MAX = 12, LOG_MAX = 40, HISTORY_MAX = 60;
const TIMEOUTS = Object.freeze({ teeMs: 15000, doneMs: 600000 });

class DuelError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'DuelError'; this.status = status; }
}

const r1 = (v) => Math.round(v * 10) / 10;
const whole = (v) => Math.round(v);
const nonNeg = (v, dflt) => (Number.isFinite(+v) && +v >= 0 ? +v : dflt);
const ftText = (ft) => (ft < 1 ? `${Math.max(1, Math.round(ft * 12))} IN` : `${whole(ft)} FT`);

/** A word to spell: letters only, upper case, 2 to 8 of them; anything else is CLASH. */
function cleanWord(word) {
  const w = String(word ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  return w.length >= 2 && w.length <= 8 ? w : WORDS[0];
}

/**
 * The gadgets a shot met, whatever shape the result carries them in: absent, an array of
 * ids, or an array of objects ({ id, kind, ... }). -> [{ id, kind }], each id once, in the
 * order met, without the ones nobody aims at (zones, a warp's exit). Never throws.
 */
function gadgetList(result) {
  const out = [];
  try {
    const raw = result && result.gadgets;
    const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray(raw.hits) ? raw.hits : [];
    for (const g of list) {
      let id = null, kind = null;
      if (typeof g === 'string' || typeof g === 'number') id = String(g);
      else if (g && typeof g === 'object') {
        if (g.id != null) id = String(g.id);
        if (typeof g.kind === 'string') kind = g.kind;
        else if (typeof g.type === 'string') kind = g.type;
      }
      if (!id) continue;
      if (!kind) kind = String(id).replace(/^.*\//, '').replace(/[-_ ]?\d+$/, '') || 'gadget';
      kind = kind.toLowerCase();
      if (GADGET_SKIP.includes(kind) || out.some((x) => x.id === id)) continue;
      out.push({ id, kind });
    }
  } catch (_) { /* a shape nobody thought of: no gadgets */ }
  return out;
}

/**
 * How much a ball bent in the air, in yards (+ right, - left): how far its landing point is
 * from the line it started on. The start line is the ball's first stretch (to 12 % of the
 * carry, between 8 and 30 m); the landing point is where the path has covered the carry.
 * Read from the path, so it is whatever bent the ball: spin, the wind, a gust. Null when
 * the path cannot say (too short, no carry).
 */
function curveOf(points, from, carryYd) {
  if (!Array.isArray(points) || points.length < 3 || !from || !(carryYd > 0)) return null;
  const carryM = carryYd * YD;
  const d = (p) => Math.hypot(p.x - from.x, p.y - from.y);
  const leadM = Math.max(8, Math.min(30, carryM * 0.12));
  if (carryM < leadM * 2) return null;
  const lead = points.find((p) => Number.isFinite(p.x) && d(p) >= leadM);
  const land = points.find((p) => Number.isFinite(p.x) && d(p) >= carryM - 0.5) || points[points.length - 1];
  if (!lead || !land || lead === land) return null;
  const len = d(lead);
  const ux = (lead.x - from.x) / len, uy = (lead.y - from.y) / len;
  const right = (land.x - from.x) * uy - (land.y - from.y) * ux;   // + right of the start line
  return Number.isFinite(right) ? r1(right / YD) : null;
}

/**
 * What a shot was, as numbers: read from the game's result (lib/game.js _play) and where
 * the ball was hit from and the pin. -> { clean, miss, isPutt, carryYd, curveYd, apexFt,
 * finishFt, lie, holed, speedMph, gadgets: [{ id, kind }] }. `clean`: it stayed in play.
 */
function shotFeatures(result, { from = null, pin = null } = {}) {
  const r = result && typeof result === 'object' ? result : {};
  const sim = r.sim && typeof r.sim === 'object' ? r.sim : {};
  const wet = Boolean(r.penalty) || r.lie === 'water' || r.lie === 'ob';
  const miss = wet ? (/water/i.test(r.note || '') || r.lie === 'water' ? 'water' : 'ob') : null;
  const launch = (r.arcadeShot && r.arcadeShot.realLaunch) || r.launch || {};
  const start = from || r.from || null;
  const end = r.end && Number.isFinite(r.end.x) ? r.end : null;
  const carryYd = Number.isFinite(+sim.carryYd) ? r1(+sim.carryYd) : null;
  let finishFt = null;
  if (!wet) {
    if (pin && end) finishFt = r1(Math.hypot(end.x - pin[0], end.y - pin[1]) / YD * FT_PER_YD);
    else if (Number.isFinite(+r.distToPinYd)) finishFt = r1(+r.distToPinYd * FT_PER_YD);
  }
  return {
    clean: !wet, miss, isPutt: Boolean(sim.isPutt),
    carryYd,
    curveYd: sim.isPutt ? null : curveOf(sim.points, start, carryYd),
    apexFt: Number.isFinite(+sim.apexFt) ? whole(+sim.apexFt) : null,
    finishFt, lie: wet ? miss : (r.lie || null), holed: Boolean(r.holed) && finishFt === 0,
    speedMph: Number.isFinite(+launch.speedMph) ? r1(+launch.speedMph) : null,
    gadgets: gadgetList(r),
  };
}

/**
 * The call a shot makes, or why it makes none.
 *   -> { ok: false, reason: 'hazard' | 'duff' }                    NO CALL
 *   -> { ok: true, text, parts: [part] }                           the call
 * A part: { id: 'carry' | 'curve' | 'finish' | 'apex' | 'gadget' | 'green', label (what the
 * challenger did), target (what a match has to do, in words), ...numbers the judge reads }.
 * The carry is always part of it; then the one or two things most this shot's own, by how
 * far out of the ordinary they are (`max` parts in all, three by default).
 */
function makeCall(f, { max = 3 } = {}) {
  if (!f || !f.clean) return { ok: false, reason: 'hazard' };
  if (f.isPutt || !(f.carryYd >= DUFF_YD)) return { ok: false, reason: 'duff' };
  const carryTol = Math.max(TOL.carryMinYd, f.carryYd * TOL.carryPct);
  const lo = whole(f.carryYd - carryTol), hi = whole(f.carryYd + carryTol);
  const parts = [{ id: 'carry', label: `${whole(f.carryYd)} YD CARRY`, short: `${whole(f.carryYd)} YD CARRY`, target: `CARRY ${lo} TO ${hi} YD`, value: f.carryYd, lo, hi }];
  const extra = [];   // [score, part]: the higher, the more it is this shot's own
  const g = [...f.gadgets].sort((a, b) => (GADGET_RANK.indexOf(a.kind) + 1 || 99) - (GADGET_RANK.indexOf(b.kind) + 1 || 99))[0];
  if (g) {
    const words = GADGET_WORDS[g.kind] || `HIT THE ${g.kind.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim() || 'GADGET'}`;
    extra.push([100, { id: 'gadget', label: words, short: words, target: `${words}: THE SAME ONE`, gadgetId: g.id, kind: g.kind }]);
  }
  if (f.finishFt != null && f.finishFt <= TOL.finishCallFt) {
    const within = whole(Math.max(f.finishFt * TOL.finishFactor, f.finishFt + TOL.finishMinFt));
    extra.push([20 + (TOL.finishCallFt - f.finishFt) / TOL.finishCallFt * 60, {
      id: 'finish', label: f.holed ? 'HOLED IT' : `${ftText(f.finishFt)} FROM THE PIN`, short: `INSIDE ${within} FT`, target: `FINISH INSIDE ${within} FT`, value: f.finishFt, within,
    }]);
  } else if (f.lie === 'green') {
    extra.push([15, { id: 'green', label: 'ON THE GREEN', short: 'ON THE GREEN', target: 'FINISH ON THE GREEN' }]);
  }
  if (f.curveYd != null && Math.abs(f.curveYd) >= TOL.curveMinYd) {
    const side = f.curveYd > 0 ? 'right' : 'left';
    const atLeast = whole(Math.max(TOL.curveFloorYd, Math.abs(f.curveYd) * TOL.curveShare));
    extra.push([Math.min(80, Math.abs(f.curveYd) * 4), {
      id: 'curve', label: `BENT ${side.toUpperCase()} ${whole(Math.abs(f.curveYd))} YD`, short: `BENDS ${side.toUpperCase()}`, target: `BEND IT ${side.toUpperCase()} ${atLeast} YD OR MORE`, value: f.curveYd, side, atLeast,
    }]);
  }
  if (f.apexFt != null && f.apexFt >= TOL.tallFt) {
    const atLeast = whole(f.apexFt * TOL.tallShare);
    extra.push([10 + (f.apexFt - TOL.tallFt) * 1.5, { id: 'apex', label: `${f.apexFt} FT HIGH`, short: `${atLeast} FT HIGH OR MORE`, target: `FLY IT ${atLeast} FT HIGH OR MORE`, value: f.apexFt, kind: 'tall', atLeast }]);
  } else if (f.apexFt != null && f.apexFt <= TOL.lowFt && f.carryYd >= TOL.lowCarryYd) {
    const atMost = whole(f.apexFt * TOL.lowFactor + TOL.lowPlusFt);
    extra.push([50 + (TOL.lowFt - f.apexFt), { id: 'apex', label: `A STINGER: ${f.apexFt} FT HIGH`, short: `UNDER ${atMost} FT HIGH`, target: `KEEP IT UNDER ${atMost} FT HIGH`, value: f.apexFt, kind: 'low', atMost }]);
  }
  extra.sort((a, b) => b[0] - a[0]);
  for (const [, part] of extra.slice(0, Math.max(0, max - 1))) parts.push(part);
  return { ok: true, text: `MATCH IT: ${parts.map((p) => p.short).join(' · ')}`, parts };
}

/**
 * Is a shot a match for a call? Every part within its tolerance, and the ball in play.
 * -> { ok, checks: [{ id, ok, want (the target, in words), got (what this ball did, in words) }] }
 */
function judge(call, f) {
  const checks = [];
  const parts = call && Array.isArray(call.parts) ? call.parts : [];
  const lost = !f || !f.clean;
  for (const p of parts) {
    let ok = false, got = lost ? (f && f.miss === 'water' ? 'IN THE WATER' : 'OUT OF BOUNDS') : '';
    if (!lost) {
      if (p.id === 'carry') { ok = f.carryYd != null && f.carryYd >= p.lo - 0.5 && f.carryYd <= p.hi + 0.5; got = f.carryYd == null ? 'NO CARRY' : `${whole(f.carryYd)} YD`; }
      else if (p.id === 'curve') {
        const c = f.curveYd == null ? 0 : f.curveYd;
        ok = (p.side === 'right' ? c : -c) >= p.atLeast - 0.5;
        got = Math.abs(c) < 1 ? 'STRAIGHT' : `${c > 0 ? 'RIGHT' : 'LEFT'} ${whole(Math.abs(c))} YD`;
      } else if (p.id === 'finish') { ok = f.finishFt != null && f.finishFt <= p.within; got = f.finishFt == null ? '' : f.holed ? 'HOLED' : ftText(f.finishFt); }
      else if (p.id === 'green') { ok = f.lie === 'green'; got = f.lie === 'green' ? 'ON THE GREEN' : `IN THE ${String(f.lie || 'ROUGH').toUpperCase()}`; }
      else if (p.id === 'apex') {
        ok = f.apexFt != null && (p.kind === 'tall' ? f.apexFt >= p.atLeast : f.apexFt <= p.atMost);
        got = f.apexFt == null ? '' : `${f.apexFt} FT HIGH`;
      } else if (p.id === 'gadget') { ok = f.gadgets.some((g) => g.id === p.gadgetId); got = ok ? 'THROUGH IT' : 'MISSED IT'; }
    }
    checks.push({ id: p.id, ok, want: p.target, got });
  }
  return { ok: !lost && checks.length > 0 && checks.every((c) => c.ok), checks };
}

/**
 * @param {object[]} a.players  two of { id, name, initials? }: slot 1, slot 2
 * @param {object}   a.stage    { id, name, file, par?, lengthYd?, theme?, timeOfDay?, kind? } (a tour stage or an arena)
 * @param {object}   a.options  { word: 'CLASH', first: 0 | 1 | null (who calls first; null: the toss), maxRounds }
 * @param {function} a.random   Math.random (the toss)
 * @param {function} a.now      Date.now
 * @param {object}   a.timeouts { teeMs, doneMs } for `waiting.timeoutMs`
 */
function createDuel({ players, stage, options = {}, now = Date.now, random = Math.random, timeouts = {} } = {}) {
  if (!Array.isArray(players) || players.length !== 2) throw new DuelError('A duel needs two players');
  if (players.some((p) => !p || p.id == null || !p.name)) throw new DuelError('Each player needs an id and a name');
  if (String(players[0].id) === String(players[1].id)) throw new DuelError('Pick two different players');
  if (!stage || !stage.id || !stage.file) throw new DuelError('Pick a stage', 404);
  const word = cleanWord(options.word);
  const maxRounds = Number.isFinite(+options.maxRounds) && +options.maxRounds >= 1 ? Math.min(99, Math.round(+options.maxRounds)) : word.length * ROUNDS_PER_LETTER;
  const T_ = { teeMs: nonNeg(timeouts.teeMs, TIMEOUTS.teeMs), doneMs: nonNeg(timeouts.doneMs, TIMEOUTS.doneMs) };

  const fresh = (p, i) => ({
    id: String(p.id), name: String(p.name), initials: p.initials || initials(p.name), slot: i + 1,
    letters: 0, calls: 0, noCalls: 0, matched: 0, missed: 0, shots: 0, aimOffset: 0,
  });
  const firstIndex = options.first === 0 || options.first === 1 ? options.first : (random() < 0.5 ? 0 : 1);

  const m = {
    id: `du_${now().toString(36)}${Math.floor(random() * 1e6).toString(36)}`,
    seq: 0,
    phase: 'loading',
    stage: {
      id: String(stage.id), name: String(stage.name || stage.id), file: String(stage.file),
      par: Number.isFinite(+stage.par) ? +stage.par : null, lengthYd: Number.isFinite(+stage.lengthYd) ? Math.round(+stage.lengthYd) : null,
      theme: stage.theme || null, timeOfDay: stage.timeOfDay || 'day', kind: stage.kind === 'tiebreak' || stage.arena ? 'arena' : 'stage', wind: null,
    },
    hole: null, courseRef: null,
    players: players.map(fresh),
    round: 1,
    role: 'challenge',                    // what the swing that is awaited is: 'challenge' | 'match'
    challengerId: String(players[firstIndex].id),
    currentPlayerId: null, loadedId: null, teed: false,
    call: null,                           // the call to match: { playerId, round, text, parts, shot }
    last: null,                           // the newest verdict: { kind, playerId, round, ... }
    history: [],                          // one line per finished round
    winnerId: null, loserId: null, reason: null,   // 'word' | 'cap'; level at the cap: no winner (shared)
    events: [], log: [],
    waiting: null, waitToken: 0,
    pending: null, undo: null,
    aborted: false, error: null,
    startedAt: now(), endedAt: null,
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
    const timeoutMs = what === 'tee' ? T_.teeMs : what === 'dismiss' ? T_.doneMs : null;
    m.waiting = { for: what, token: ++m.waitToken, since: now(), timeoutMs, ...extra };
  };
  const current = () => byId(m.currentPlayerId);
  const lettersOf = (p) => word.slice(0, p.letters);

  // ---- the one-ball game ----
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
  function tidy(g) {
    if (!g || !m.hole || g.course !== m.courseRef) return;
    g.over = false;
    g.scores[m.hole.index] = null;
    g.pickedUp[m.hole.index] = false;
    g.holed = false;
    g.strokes = 0;
    g._undo = null;
  }

  const HISTORY = ['id', 'seq', 'events', 'log', 'waitToken', 'startedAt', 'courseRef', 'pending', 'undo'];
  function snap() {
    const copy = {};
    for (const k of Object.keys(m)) if (!HISTORY.includes(k)) copy[k] = m[k];
    return structuredClone(copy);
  }

  function startTurn(g, playerId, role) {
    m.currentPlayerId = playerId;
    m.role = role;
    emit('turn', { playerId, role, round: m.round });
    if (g) load(g, byId(playerId));
  }
  function finish(reason) {
    const [a, b] = m.players;
    m.phase = 'done';
    m.reason = reason;
    m.endedAt = now();
    m.currentPlayerId = null;
    m.call = null;
    const loser = a.letters === b.letters ? null : (a.letters > b.letters ? a : b);
    m.loserId = loser ? loser.id : null;
    m.winnerId = loser ? other(loser).id : null;
    say(loser ? `${other(loser).name.toUpperCase()} WINS THE DUEL: ${loser.name} ${reason === 'word' ? `spelled ${word}` : `has more letters (${lettersOf(loser) || 'none'})`}.` : `The duel is shared: level on ${a.letters ? lettersOf(a) : 'no letters'}.`);
    emit('duel-over', { winnerId: m.winnerId, loserId: m.loserId, reason });
    wait('dismiss');
  }
  // A round is over (matched, a letter, or no call): the game is decided, or the roles swap.
  function closeRound(base, line) {
    m.history.push({ round: m.round, ...line });
    if (m.history.length > HISTORY_MAX) m.history.splice(0, m.history.length - HISTORY_MAX);
    m.call = null;
    const speller = m.players.find((p) => p.letters >= word.length);
    if (speller) { finish('word'); return { ...base, event: 'duel-over', winnerId: m.winnerId, loserId: m.loserId, reason: m.reason }; }
    if (m.round >= maxRounds) { finish('cap'); return { ...base, event: 'duel-over', winnerId: m.winnerId, loserId: m.loserId, reason: m.reason }; }
    m.round++;
    m.challengerId = other(byId(m.challengerId)).id;
    startTurn(null, m.challengerId, 'challenge');
    m.teed = false;
    wait('tee');
    return { ...base, nextPlayerId: m.currentPlayerId, role: 'challenge', round: m.round };
  }

  // One ball, read where it lies. Returns its event.
  function played(g, p, result) {
    const f = shotFeatures(result, { from: { x: m.hole.tee[0], y: m.hole.tee[1] }, pin: m.hole.pin });
    p.shots++;
    tidy(g);
    if (m.role === 'challenge') {
      const call = makeCall(f);
      if (!call.ok) {
        p.noCalls++;
        m.last = { kind: 'no-call', playerId: p.id, round: m.round, reason: call.reason, shot: f };
        say(`${p.name}: NO CALL (${call.reason === 'hazard' ? (f.miss === 'water' ? 'in the water' : 'out of bounds') : 'a duff'}).`);
        emit('no-call', { playerId: p.id, reason: call.reason, round: m.round });
        return closeRound({ event: 'no-call', playerId: p.id, reason: call.reason, shot: f }, { challengerId: p.id, call: null, result: 'no-call', reason: call.reason });
      }
      p.calls++;
      m.call = { playerId: p.id, round: m.round, text: call.text, parts: call.parts, shot: f };
      m.last = { kind: 'call', playerId: p.id, round: m.round, text: call.text, parts: call.parts, shot: f };
      const o = other(p);
      say(`${p.name} calls it: ${call.parts.map((x) => x.label).join(', ')}. ${o.name} to match.`);
      emit('call', { playerId: p.id, text: call.text, round: m.round });
      startTurn(null, o.id, 'match');
      m.teed = false;
      wait('tee');
      return { event: 'call', playerId: p.id, call: { text: call.text, parts: call.parts }, shot: f, nextPlayerId: o.id, role: 'match', round: m.round };
    }
    // the answer
    const call = m.call;
    const v = judge(call, f);
    const line = { challengerId: call.playerId, call: call.text, matcherId: p.id };
    if (v.ok) {
      p.matched++;
      m.last = { kind: 'matched', playerId: p.id, round: m.round, checks: v.checks, shot: f, call: call.text };
      say(`${p.name} MATCHED IT!`);
      emit('matched', { playerId: p.id, round: m.round });
      return closeRound({ event: 'matched', playerId: p.id, checks: v.checks, shot: f }, { ...line, result: 'matched' });
    }
    p.missed++;
    p.letters++;
    const letter = word[p.letters - 1];
    m.last = { kind: 'letter', playerId: p.id, round: m.round, checks: v.checks, shot: f, call: call.text, letter, letters: lettersOf(p) };
    say(`${p.name} misses it (${v.checks.filter((c) => !c.ok).map((c) => `${c.want}: ${c.got || 'no'}`).join('; ')}): ${letter}. ${lettersOf(p)}${p.letters >= word.length ? '!' : ''}`);
    emit('letter', { playerId: p.id, letter, letters: lettersOf(p), round: m.round });
    return closeRound({ event: 'letter', playerId: p.id, letter, letters: lettersOf(p), checks: v.checks, shot: f }, { ...line, result: 'letter', letter });
  }

  emit('duel-start', { word, playerIds: m.players.map((p) => p.id), stageId: m.stage.id, firstId: m.challengerId });
  say(`Trick shot duel at ${m.stage.name}: ${m.players[0].name} against ${m.players[1].name}, first to spell ${word} loses. ${byId(m.challengerId).name} calls first.`);
  wait('stage', { stageId: m.stage.id, file: m.stage.file });

  return {
    get id() { return m.id; },
    get phase() { return m.phase; },
    get active() { return m.phase !== 'done'; },
    get aborted() { return m.aborted; },
    get currentPlayerId() { return m.currentPlayerId; },
    get waiting() { return m.waiting ? { ...m.waiting } : null; },

    stageReady(g, token = null, { wind = null } = {}) {
      if (m.phase !== 'loading' || !m.waiting || m.waiting.for !== 'stage') return false;
      if (token != null && token !== m.waiting.token) return false;
      if (!g || !g.course || !g.course.holes.length) throw new DuelError('No course is loaded', 409);
      const h = g.course.holes[0];
      bump();
      m.courseRef = g.course;
      m.hole = { index: 0, tee: [h.tee[0], h.tee[1]], pin: [h.pin[0], h.pin[1]] };
      m.stage.par = m.stage.par ?? h.par ?? null;
      m.stage.lengthYd = m.stage.lengthYd ?? (Number.isFinite(+h.lengthYd) ? Math.round(+h.lengthYd) : Math.round(Math.hypot(h.pin[0] - h.tee[0], h.pin[1] - h.tee[1]) / YD));
      m.stage.wind = wind && Number.isFinite(wind.mph) ? { ...wind } : gameWind(g, h);
      m.phase = 'play';
      m.waiting = null;
      emit('stage-loaded', { stageId: m.stage.id });
      startTurn(g, m.challengerId, 'challenge');
      return true;
    },
    stageFailed(token = null, message = '') {
      if (m.phase !== 'loading' || !m.waiting || m.waiting.for !== 'stage') return false;
      if (token != null && token !== m.waiting.token) return false;
      bump();
      m.phase = 'done'; m.aborted = true; m.currentPlayerId = null; m.waiting = null;
      m.error = message || `${m.stage.name} would not load`;
      say(`Duel abandoned: ${m.error}.`);
      return true;
    },

    // Put the ball of whoever is up on the tee. False when it is there already.
    tee(g, token = null) {
      if (m.phase !== 'play' || m.teed) return false;
      if (token != null && (!m.waiting || token !== m.waiting.token)) return false;
      bump();
      m.waiting = null;
      load(g, current());
      return true;
    },

    beforeShot(g) {
      if (m.phase !== 'play') return null;
      const p = current();
      if (!p || !g || g.course !== m.courseRef) return null;
      if (m.loadedId === p.id && m.teed) p.aimOffset = g.aimOffset;
      m.pending = { m: snap(), playerId: p.id };
      load(g, p);
      if (m.waiting && m.waiting.for === 'tee') m.waiting = null;
      return { playerId: p.id, role: m.role, round: m.round };
    },

    afterShot(g, result) {
      if (m.phase !== 'play' || !m.currentPlayerId || !result) return null;
      const p = current();
      bump();
      const before = m.pending && m.pending.playerId === p.id ? m.pending : null;
      m.pending = null;
      const launch = (result.arcadeShot && result.arcadeShot.realLaunch) || result.launch || {};
      const stray = isStrayShot({ speedMph: launch.speedMph, isPutt: Boolean(result.sim && result.sim.isPutt), lie: 'tee', distYd: Math.hypot(m.hole.pin[0] - m.hole.tee[0], m.hole.pin[1] - m.hole.tee[1]) / YD });
      const role = m.role;
      const ev = played(g, p, result);
      m.undo = before ? { ...before, stray, role } : null;
      if (!stray) return ev;
      emit('stray-shot', { playerId: p.id, speedMph: r1(launch.speedMph) });
      return { ...ev, stray: true };
    },

    // Take the last shot back: the duel exactly as it was before it (also from 'done').
    undoLastShot(g = null) {
      const u = m.undo;
      if (!u || m.aborted) throw new DuelError('There is no shot to take back', 409);
      const from = m.phase;
      Object.assign(m, structuredClone(u.m));
      m.pending = null; m.undo = null;
      bump();
      m.waiting = null;
      const p = current();
      if (g && p) load(g, p);
      emit('shot-undone', { playerId: u.playerId, stray: Boolean(u.stray), role: u.role, from });
      say(`${byId(u.playerId) ? byId(u.playerId).name : 'The'}'s last shot is taken back${u.stray ? ' (a stray ball)' : ''}.`);
      return { event: 'shot-undone', playerId: u.playerId, stray: Boolean(u.stray), role: u.role, from };
    },

    // The same duel from the top: no letters, round one, the other player calls first.
    restart(g = null) {
      if (m.phase === 'loading' || m.aborted || !m.hole) throw new DuelError('No duel is being played', 409);
      bump();
      const firstWas = m.history.length ? m.history[0].challengerId : m.challengerId;
      m.players = m.players.map((p, i) => fresh(p, i));
      m.phase = 'play';
      m.round = 1; m.call = null; m.last = null; m.history = [];
      m.winnerId = null; m.loserId = null; m.reason = null; m.endedAt = null;
      m.pending = null; m.undo = null; m.waiting = null;
      m.challengerId = other(byId(firstWas)).id;
      emit('restarted', { firstId: m.challengerId });
      say(`The duel starts again: ${byId(m.challengerId).name} calls first.`);
      startTurn(g, m.challengerId, 'challenge');
      return { event: 'restarted' };
    },

    abort(g = null) {
      if (m.phase !== 'done') {
        bump();
        m.phase = 'done'; m.aborted = true; m.currentPlayerId = null; m.call = null; m.waiting = null;
        m.pending = null; m.undo = null;
        say('Duel abandoned.');
      }
      if (g) this.release(g);
      return this.state();
    },
    release(g) {
      m.loadedId = null;
      if (!g || !m.courseRef || g.course !== m.courseRef) return false;
      g.dropLocked = false;
      g.reset();
      return true;
    },

    // What "play again" starts from (the loser calls first; a shared duel: the other player).
    config() {
      const firstWas = m.history.length ? m.history[0].challengerId : m.challengerId;
      const next = m.loserId || other(byId(firstWas)).id;
      return { players: m.players.map((p) => ({ id: p.id, name: p.name, initials: p.initials })), stageId: m.stage.id, options: { word, maxRounds, first: m.players.findIndex((p) => p.id === next) } };
    },

    state() {
      return {
        id: m.id, seq: m.seq,
        phase: m.phase,
        word, options: { word, maxRounds },
        stage: { id: m.stage.id, name: m.stage.name, par: m.stage.par, lengthYd: m.stage.lengthYd, theme: m.stage.theme, timeOfDay: m.stage.timeOfDay, kind: m.stage.kind, wind: m.stage.wind ? { ...m.stage.wind } : null },
        round: m.round, maxRounds,
        role: m.phase === 'play' ? m.role : null,
        currentPlayerId: m.currentPlayerId, challengerId: m.challengerId, teed: m.teed,
        call: m.call ? structuredClone(m.call) : null,
        players: m.players.map((p) => ({
          id: p.id, name: p.name, initials: p.initials, slot: p.slot,
          letters: lettersOf(p), lettersCount: p.letters, lettersLeft: word.length - p.letters,
          calls: p.calls, noCalls: p.noCalls, matched: p.matched, missed: p.missed, shots: p.shots,
        })),
        last: m.last ? structuredClone(m.last) : null,
        history: m.history.map((h) => ({ ...h })),
        winnerId: m.winnerId, loserId: m.loserId, reason: m.reason,
        undoable: m.undo && !m.aborted ? { playerId: m.undo.playerId, stray: Boolean(m.undo.stray), role: m.undo.role } : null,
        canRestart: (m.phase === 'play' || m.phase === 'done') && !m.aborted && Boolean(m.hole),
        events: m.events.map((e) => ({ ...e })),
        waiting: m.waiting ? { for: m.waiting.for, since: m.waiting.since, timeoutMs: m.waiting.timeoutMs } : null,
        log: [...m.log],
        startedAt: m.startedAt, endedAt: m.endedAt, aborted: m.aborted, error: m.error,
      };
    },
  };
}

module.exports = {
  createDuel, DuelError, WORDS, TOL, DUFF_YD, ROUNDS_PER_LETTER, TIMEOUTS, GADGET_WORDS,
  cleanWord, gadgetList, curveOf, shotFeatures, makeCall, judge,
};
