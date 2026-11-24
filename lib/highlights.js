'use strict';
// v3:modes The highlights reel (docs/modes.md "Instant replay and highlights"): which shots
// are worth seeing again, how they are ranked, and the store that keeps them. Pure: no
// files, no timers, no HTTP. lib/highlights-mode.js feeds it every shot the bay plays and
// gives it a file to keep the night's best in.
//
//   A notable shot   a ball that really drops from off the green (a hole-out, an ace), a long
//                    putt that drops, any shot with an EPIC callout, and the shot that decides
//                    a hole or a match in the shooter's favour (short putts only when they
//                    were clutch, or won the match). A conceded tap-in is never notable.
//   The last game    the notable shots of the most recent match (or solo run, or mode game),
//                    in memory, in the order they were hit, the newest `lastMax` of them. A
//                    new game starts the list over with its first notable shot.
//   The night        the best `nightMax` shots, by score, of the session of play that is
//                    going on. A night is a run of play with no break of `nightGapMs` (six
//                    hours) or more between two shots: the first shot after such a break
//                    starts a new night and the old list is dropped then (not before: the
//                    morning after, last night's best is still there to watch).
//   Shot of the match  the engine's own award (most arcade points on one shot): the reel
//                    keeps every player's best-paid shot of the match being played, so when
//                    the award is given it has that very shot, notable or not.

const NIGHT_GAP_MS = 6 * 3600 * 1000;
const LAST_MAX = 12;
const NIGHT_MAX = 8;
const PATH_MAX = 420;          // a stored path has at most this many samples
const LONG_PUTT_FT = 15;       // a putt from here or further that drops is a highlight by itself
const DECIDER_PUTT_FT = 8;     // a putt that wins a hole from here or further is one too
const DECIDING = Object.freeze(['hole-won', 'hole-tied', 'match-over']);
const STREAK_CALLOUTS = Object.freeze(['on-fire', 'unstoppable']);
const VERSION = 1;

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const num = (v, d = null) => (Number.isFinite(+v) ? +v : d);

/**
 * Is this shot worth seeing again?
 *   result   the shot as the server broadcasts it (lib/game.js handleShot, with .arcade and
 *            .match on it when there is a grade / a match)
 *   about    { before: game.state() before the swing, match: the match state after it | null }
 * -> null, or { why: [...], score, title }
 *   why      'ace' | 'hole-out' | 'long-putt' | 'epic' | 'match-winner' | 'hole-winner' |
 *            'sudden-death' | 'clutch' (one or more, the first is the headline)
 */
function notable(result, about = {}) {
  if (!result || !result.sim || !Array.isArray(result.sim.points) || result.sim.points.length < 2) return null;
  const sim = result.sim;
  const before = about.before || {};
  const a = result.arcade || null;
  const m = result.match || null;
  const isPutt = !!sim.isPutt;
  const dropped = !!result.holed && (sim.events || []).some((e) => e && e.type === 'holed');   // it went in by itself (a conceded tap-in has no such event)
  const fromYd = num(before.distToPinYd);
  const fromFt = fromYd == null ? null : fromYd * 3;
  const why = [];
  let score = a && Number.isFinite(+a.points) ? Math.max(0, +a.points) : 0;

  if (dropped && !isPutt) {
    if (result.strokes === 1) { why.push('ace'); score += 5000; } else { why.push('hole-out'); score += 2500; }
    score += Math.round((fromYd || 0) * 5);
  } else if (dropped && isPutt && fromFt != null && fromFt >= LONG_PUTT_FT) {
    why.push('long-putt');
    score += 600 + Math.round(fromFt * 10);
  }
  // (an epic callout about the SHOT: a streak's own shout, ON FIRE / UNSTOPPABLE, says nothing about this ball)
  if (a && a.callout && a.callout.tone === 'epic' && !STREAK_CALLOUTS.includes(a.callout.id)) { why.push('epic'); score += 800; }

  if (m && DECIDING.includes(m.event) && !m.drop && m.reason !== 'concede') {
    const mine = m.winnerId != null && String(m.winnerId) === String(m.playerId);
    const clutch = m.clutch === 'win' || m.clutch === 'tie';
    const bigEnough = !isPutt || (fromFt != null && fromFt >= DECIDER_PUTT_FT);
    if (m.event === 'match-over' && mine) { why.push('match-winner'); score += 1500; }
    else if (mine && m.reason === 'tiebreak') { why.push('sudden-death'); score += 700; }
    else if (mine && dropped && bigEnough) { why.push('hole-winner'); score += 500; }
    if (clutch && dropped) { why.push('clutch'); score += 400; }
  }
  if (!why.length) return null;
  return { why, score: Math.round(score), title: titleOf(why, result, fromFt, fromYd) };
}

function titleOf(why, result, fromFt, fromYd) {
  const c = result.arcade && result.arcade.callout && result.arcade.callout.text ? String(result.arcade.callout.text).toUpperCase() : null;
  switch (why[0]) {
    case 'ace': return 'HOLE IN ONE';
    case 'hole-out': return fromYd != null && fromYd >= 30 ? `HOLED FROM ${Math.round(fromYd)} YD` : 'CHIP-IN';
    case 'long-putt': return `${Math.round(fromFt)} FT PUTT`;
    case 'epic': return c || 'WHAT A SHOT';
    case 'match-winner': return 'THE MATCH WINNER';
    case 'sudden-death': return 'SUDDEN DEATH WINNER';
    case 'clutch': return 'CLUTCH';
    default: return c || 'FOR THE HOLE';
  }
}

/**
 * A path small enough to keep: at most `max` samples as [t, x, y, z] (ms, cm). The flight
 * (a smooth curve) is thinned first; the samples round an event (a bounce, a tree, the cup)
 * and the two ends are always kept.
 */
function thinPath(points, { flightTime = null, events = [], max = PATH_MAX } = {}) {
  const pts = (Array.isArray(points) ? points : []).filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.x) && Number.isFinite(p.y));
  const pack = (p) => [r3(p.t), r2(p.x), r2(p.y), r2(Number.isFinite(p.z) ? p.z : 0)];
  if (pts.length <= max) return pts.map(pack);
  const keep = new Set([0, pts.length - 1]);
  const times = (Array.isArray(events) ? events : []).map((e) => (e && Number.isFinite(e.t) ? e.t : null)).filter((t) => t != null);
  if (Number.isFinite(flightTime)) times.push(flightTime);
  for (const t of times) {
    let i = pts.findIndex((p) => p.t >= t);
    if (i < 0) i = pts.length - 1;
    for (let k = Math.max(0, i - 2); k <= Math.min(pts.length - 1, i + 2); k++) keep.add(k);
  }
  const room = Math.max(8, max - keep.size);
  const step = (pts.length - 1) / room;
  for (let k = 0; k <= room; k++) keep.add(Math.min(pts.length - 1, Math.round(k * step)));
  return [...keep].sort((x, y) => x - y).slice(0, max + 24).map((i) => pack(pts[i]));
}

/** The path of a stored highlight, back as [{ t, x, y, z }]. */
function unpackPath(path) {
  return (Array.isArray(path) ? path : []).map((p) => (Array.isArray(p) ? { t: p[0], x: p[1], y: p[2], z: p[3] } : p)).filter((p) => p && Number.isFinite(p.t));
}

/**
 * Everything a later replay needs of a shot, small enough to keep.
 *   result, about   as for notable()
 *   note            { why, score, title } (notable()'s answer, or one made up for a shot kept
 *                   for another reason: the shot of the match)
 *   stage           { id, name, file } the stage it was hit on (file: its course file, when known)
 *   game            { id, kind: 'match' | 'solo' | 'mode' | 'free', label }
 *   player          { id, name, slot }
 */
function recordOf(result, about = {}, { note = null, stage = null, game = null, player = null, at = Date.now() } = {}) {
  const sim = result.sim || {};
  const before = about.before || {};
  const a = result.arcade || null;
  const m = about.match || null;
  const pin = Array.isArray(before.pin) ? [r2(before.pin[0]), r2(before.pin[1])] : null;
  const end = sim.points && sim.points.length ? sim.points[sim.points.length - 1] : null;
  return {
    id: null, at, shotId: result.shotId ?? null,
    why: note ? [...note.why] : [], score: note ? note.score : 0, title: note ? note.title : 'REPLAY',
    game: game ? { id: game.id ?? null, kind: game.kind || 'free', label: game.label || null } : { id: null, kind: 'free', label: null },
    matchId: m ? m.id : null,
    holeNumber: m ? m.holeNumber ?? null : (before.holeRef ?? before.hole ?? null),
    player: player ? { id: player.id ?? null, name: String(player.name || 'Player'), slot: player.slot ?? null } : null,
    stage: { id: stage && stage.id ? String(stage.id) : null, name: String((stage && stage.name) || before.courseName || ''), file: (stage && stage.file) || null, courseName: before.courseName || null },
    hole: { pin, tee: Array.isArray(before.tee) ? [r2(before.tee[0]), r2(before.tee[1])] : null, ref: before.holeRef ?? before.hole ?? null, par: before.par ?? null },
    from: before.ball ? { x: r2(before.ball.x), y: r2(before.ball.y) } : null,
    aimDeg: num(before.aimDeg, 0), lie: before.lie || null,
    fromYd: num(before.distToPinYd), strokes: result.strokes ?? null, holed: !!result.holed,
    endFt: result.holed ? 0 : (num(result.distToPinYd) == null ? null : r2(result.distToPinYd * 3)),
    points: a && Number.isFinite(+a.points) ? +a.points : 0, grade: a ? a.grade || null : null,
    callout: a && a.callout ? { id: a.callout.id || null, text: a.callout.text || null, tone: a.callout.tone || null } : null,
    powerup: (a && a.powerup) || (result.match && result.match.powerup) || result.freeBall || null,
    launch: result.launch ? { speedMph: num(result.launch.speedMph), vla: num(result.launch.vla), hla: num(result.launch.hla), totalSpin: num(result.launch.totalSpin), spinAxis: num(result.launch.spinAxis) } : null,
    club: result.clubKey || result.club || null,
    sim: {
      points: thinPath(sim.points, { flightTime: sim.flightTime, events: sim.events }),
      flightTime: num(sim.flightTime), isPutt: !!sim.isPutt,
      events: (Array.isArray(sim.events) ? sim.events : []).slice(0, 40).map((e) => ({ ...e })),
      carryYd: num(sim.carryYd), totalYd: num(sim.totalYd), apexFt: num(sim.apexFt), offlineYd: num(sim.offlineYd),
    },
    end: end ? { x: r2(end.x), y: r2(end.y) } : null,
  };
}

/** What the reel's lists show of a highlight (no path: that goes out when it is played). */
function summaryOf(h) {
  return {
    id: h.id, at: h.at, why: [...(h.why || [])], title: h.title, score: h.score, points: h.points, grade: h.grade,
    callout: h.callout ? { ...h.callout } : null,
    player: h.player ? { ...h.player } : null,
    stage: { id: h.stage.id, name: h.stage.name, courseName: h.stage.courseName || null }, holeNumber: h.holeNumber,
    game: { ...h.game }, matchId: h.matchId,
    isPutt: !!(h.sim && h.sim.isPutt), carryYd: h.sim ? h.sim.carryYd : null, totalYd: h.sim ? h.sim.totalYd : null,
    fromYd: h.fromYd, endFt: h.endFt, holed: !!h.holed, strokes: h.strokes, powerup: h.powerup || null,
    shotOfMatch: h.shotOfMatch === true,
    replayable: !!(h.stage && (h.stage.file || h.stage.courseName)),
  };
}

/**
 * The store.
 *   now        Date.now
 *   read()     -> what write() was last given (the night's best), or null
 *   write(obj) keep it (lib/highlights-mode.js: <dataDir>/highlights.json)
 */
function createHighlights({ now = Date.now, read = () => null, write = () => {}, lastMax = LAST_MAX, nightMax = NIGHT_MAX, nightGapMs = NIGHT_GAP_MS } = {}) {
  let seq = 0;
  let counter = 0;
  let last = { game: null, shots: [] };                 // the most recent game's notable shots, oldest first
  let night = { startedAt: null, lastAt: null, shots: [] };   // the best of the night, best first
  let sotm = null;                                      // { matchId, id }: the shot of the match that last ended
  const best = new Map();                               // playerId -> the best-paid shot of the match in play (a record)
  let bestMatch = null;

  try {
    const raw = read();
    if (raw && typeof raw === 'object' && raw.version === VERSION && raw.night && Array.isArray(raw.night.shots)) {
      night = {
        startedAt: num(raw.night.startedAt), lastAt: num(raw.night.lastAt),
        shots: raw.night.shots.filter((h) => h && h.id && h.sim && Array.isArray(h.sim.points) && h.sim.points.length >= 2 && h.stage).slice(0, nightMax),
      };
    }
  } catch (_) { /* a broken file is an empty reel */ }

  const save = () => { try { write({ version: VERSION, night: { startedAt: night.startedAt, lastAt: night.lastAt, shots: night.shots } }); } catch (_) { /* best effort */ } };
  const newId = (at) => `h${at.toString(36)}${(++counter).toString(36)}`;
  const rank = (a, b) => b.score - a.score || b.at - a.at;
  const all = () => [...last.shots, ...night.shots, ...best.values()];

  // A shot was played (any shot): a break of nightGapMs since the last one starts a new night.
  function touch(at = now()) {
    if (night.lastAt != null && at - night.lastAt >= nightGapMs) {
      night = { startedAt: at, lastAt: at, shots: [] };
      seq++;
      save();
      return true;
    }
    if (night.startedAt == null) night.startedAt = at;
    night.lastAt = at;
    return false;
  }

  function intoNight(h) {
    if (night.shots.some((x) => x.id === h.id)) return false;
    const list = [...night.shots, h].sort(rank).slice(0, nightMax);
    const kept = list.includes(h);
    night.shots = list;
    if (kept) save();
    return kept;
  }

  return {
    NIGHT_GAP_MS: nightGapMs,
    get seq() { return seq; },
    touch,

    /** Keep a notable shot (a record from recordOf()). -> the stored record (with its id). */
    add(record) {
      const at = Number.isFinite(record.at) ? record.at : now();
      touch(at);
      const h = { ...record, id: record.id || newId(at), at };
      const g = h.game || { id: null, kind: 'free' };
      const key = `${g.kind}:${g.id ?? ''}`;
      if (!last.game || last.game.key !== key) last = { game: { key, id: g.id ?? null, kind: g.kind, label: g.label || null }, shots: [] };
      last.shots.push(h);
      if (last.shots.length > lastMax) last.shots.splice(0, last.shots.length - lastMax);
      intoNight(h);
      seq++;
      return h;
    },

    /**
     * A match shot, notable or not: remembered while it is its player's best-paid of the
     * match (the engine's rule for the award: more points than any before it). `record` is a
     * record from recordOf() (an id is given to it here when it has none).
     */
    offerBest(matchId, playerId, record) {
      if (matchId == null || playerId == null) return null;
      if (bestMatch !== matchId) { bestMatch = matchId; best.clear(); }
      const cur = best.get(String(playerId));
      if (!(record.points > 0) || (cur && record.points <= cur.points)) return null;
      const h = { ...record, id: record.id || newId(Number.isFinite(record.at) ? record.at : now()) };
      best.set(String(playerId), h);
      return h;
    },

    /**
     * The match is over and gave its award: { playerId, points, holeNumber }. The reel names
     * that player's best-paid shot THE shot of the match (and keeps it in the last game's
     * list when it was not notable by itself). -> { matchId, id } or null.
     */
    awardShotOfMatch(matchId, award) {
      if (sotm && matchId != null && sotm.matchId === matchId) return { ...sotm };
      if (!award || matchId == null || bestMatch !== matchId) return null;
      const h = best.get(String(award.playerId));
      if (!h || (Number.isFinite(+award.points) && h.points !== +award.points)) return null;
      h.shotOfMatch = true;
      const known = last.shots.find((x) => x.shotId != null && x.shotId === h.shotId) || night.shots.find((x) => x.shotId != null && x.shotId === h.shotId);
      if (known) { known.shotOfMatch = true; sotm = { matchId, id: known.id }; save(); } else {
        if (!h.why.length) { h.why = ['shot-of-the-match']; h.title = h.callout && h.callout.text ? String(h.callout.text).toUpperCase() : 'SHOT OF THE MATCH'; h.score = Math.max(h.score, h.points); }
        if (last.game && last.game.kind === 'match' && last.game.id === matchId) last.shots.push(h);
        else last = { game: { key: `match:${matchId}`, id: matchId, kind: 'match', label: h.game ? h.game.label : null }, shots: [h] };
        if (last.shots.length > lastMax) last.shots.splice(0, last.shots.length - lastMax);
        sotm = { matchId, id: h.id };
      }
      seq++;
      return sotm;
    },
    /** The deciding swing was taken back: the award is not given yet. */
    unaward(matchId) {
      if (!sotm || sotm.matchId !== matchId) return false;
      for (const h of all()) if (h.id === sotm.id) delete h.shotOfMatch;
      last.shots = last.shots.filter((h) => !(h.why.length === 1 && h.why[0] === 'shot-of-the-match' && h.id === sotm.id));
      sotm = null;
      seq++;
      return true;
    },

    /** A stored highlight by id (the whole record, path and all), or null. */
    get(id) {
      return all().find((h) => h.id === String(id)) || null;
    },
    /** Forget one, or a list ('last' | 'night' | 'all'). */
    remove(id) {
      const n = last.shots.length + night.shots.length;
      last.shots = last.shots.filter((h) => h.id !== id);
      night.shots = night.shots.filter((h) => h.id !== id);
      if (sotm && sotm.id === id) sotm = null;
      for (const [k, h] of best) if (h.id === id) best.delete(k);
      if (last.shots.length + night.shots.length === n) return false;
      seq++; save();
      return true;
    },
    clear(which = 'all') {
      if (which === 'last' || which === 'all') { last = { game: null, shots: [] }; sotm = null; best.clear(); bestMatch = null; }
      if (which === 'night' || which === 'all') { night = { startedAt: null, lastAt: null, shots: [] }; save(); }
      seq++;
    },

    /** What GET /api/highlights and the 'highlights' event carry. */
    state() {
      const at = now();
      return {
        seq,
        last: { game: last.game ? { id: last.game.id, kind: last.game.kind, label: last.game.label } : null, shots: [...last.shots].reverse().map(summaryOf) },   // newest first
        night: {
          startedAt: night.startedAt, lastAt: night.lastAt,
          current: night.lastAt != null && at - night.lastAt < nightGapMs,   // false: these are the last session's
          shots: night.shots.map(summaryOf),
        },
        shotOfMatch: sotm ? { ...sotm } : null,
      };
    },
  };
}

module.exports = {
  createHighlights, notable, recordOf, summaryOf, thinPath, unpackPath,
  NIGHT_GAP_MS, LAST_MAX, NIGHT_MAX, PATH_MAX, LONG_PUTT_FT, DECIDER_PUTT_FT, VERSION,
};
