'use strict';
// v2:shell Solo play for the game product (docs/sim-clash-shell.md "Solo").
//
// One player, the arcade stages, a score. Three kinds of run:
//
//   tour    the tour's stages one after another (all of them, or the first few: a sprint),
//           for a total against par. The best total of each player, per length, is kept.
//   stage   one stage (any tour stage or tiebreak arena), for a score. The best of each
//           player on each stage is kept.
//   free    one stage, nothing kept: hole out and it tees up again. Practice.
//
// A run is a small pure state machine, like the match (lib/match.js): it never touches the
// game, the disk or a timer. Whatever it needs from outside (a stage's course in the bay)
// it asks for through `waiting`, and the server does it and answers stageReady() /
// stageFailed(). The server feeds it every shot the game played (recordShot); the arcade
// layer has graded the shot by then, so the run only keeps the score and the best shots.
//
//   phase  'loading'       a stage's course is being put in the bay (swings are dropped)
//          'play'          the stage is being played (the only phase a swing counts in)
//          'stage-result'  the stage is done: its card is up (tour: NEXT; free: AGAIN)
//          'done'          the run is over: the results card
//
// A stage ends when the ball is holed, when the player gives it up (giveUp), or when the
// strokes run out: PICKUP_OVER over par without holing is a pick-up, so a run cannot be
// stuck on one hole for ever.

const fs = require('fs');
const path = require('path');

const KINDS = Object.freeze(['tour', 'stage', 'free']);
const PICKUP_OVER = 6;        // strokes over par at which the stage is picked up
const GIVE_UP_OVER = 4;       // the least a given-up stage costs over par
const BEST_SHOTS = 3;         // how many shots the results card names

class SoloError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'SoloError';
    this.status = status;
  }
}

const relText = (n) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`);
/** What a score on a hole is called. */
function scoreName(strokes, par) {
  if (strokes === 1) return 'HOLE IN ONE';
  const d = strokes - par;
  if (d <= -3) return 'ALBATROSS';
  if (d === -2) return 'EAGLE';
  if (d === -1) return 'BIRDIE';
  if (d === 0) return 'PAR';
  if (d === 1) return 'BOGEY';
  if (d === 2) return 'DOUBLE BOGEY';
  return `+${d}`;
}

const cleanStage = (s) => ({
  id: String(s.id), name: String(s.name || s.id), file: String(s.file),
  par: Number.isFinite(+s.par) && +s.par > 0 ? Math.round(+s.par) : 3,
  lengthYd: Number.isFinite(+s.lengthYd) ? Math.round(+s.lengthYd) : null,
  theme: s.theme ? String(s.theme) : null,
  arena: s.arena === true,
});

/**
 * Is `a` a better result than `b`? Fewer strokes; level on strokes, more points.
 * Either may be null (no result yet).
 */
function betterResult(a, b) {
  if (!a) return false;
  if (!b) return true;
  if (a.strokes !== b.strokes) return a.strokes < b.strokes;
  return (a.points || 0) > (b.points || 0);
}

/**
 * A run.
 *   kind     'tour' | 'stage' | 'free'
 *   stages   [{ id, name, file, par, lengthYd, theme }] in play order (stage / free: one)
 *   player   { id, name } or null (a guest)
 *   best     the stored best this run is up against ({ strokes, toPar, points, at } or null)
 */
function createSoloRun({ kind = 'tour', stages = [], player = null, best = null, now = Date.now, random = Math.random } = {}) {
  if (!KINDS.includes(kind)) throw new SoloError('No such solo game');
  const list = (Array.isArray(stages) ? stages : []).filter((s) => s && s.id && s.file).map(cleanStage);
  if (!list.length) throw new SoloError('No stage to play: the stages are not installed', 409);
  const plays = kind === 'tour' ? list : [list[0]];
  const run = {
    id: `solo_${now().toString(36)}_${Math.floor(random() * 1e6).toString(36)}`,
    kind,
    player: player && player.id ? { id: String(player.id), name: String(player.name || 'Player 1') } : { id: null, name: (player && player.name) || 'Player 1' },
    stages: plays.map((s) => ({ ...s, strokes: null, pickedUp: false, points: 0, coins: 0, shots: 0, laps: 0 })),
    index: 0,
    phase: 'loading',
    seq: 0,
    token: 1,
    shots: [],        // every graded shot worth naming: { stageId, text, tone, grade, points, n }
    startedAt: now(),
    endedAt: null,
    aborted: false,
    error: null,
    best: best ? { ...best } : null,
    newBest: false,
  };
  const bump = () => { run.seq++; };
  const current = () => run.stages[run.index];
  const totals = () => {
    const played = run.stages.filter((s) => s.strokes != null);
    const strokes = played.reduce((a, s) => a + s.strokes, 0);
    const par = played.reduce((a, s) => a + s.par, 0);
    return {
      strokes, par, toPar: strokes - par, played: played.length, stages: run.stages.length,
      points: run.stages.reduce((a, s) => a + s.points, 0),
      coins: run.stages.reduce((a, s) => a + s.coins, 0),
      complete: played.length === run.stages.length,
    };
  };
  const finishStage = (strokes, pickedUp) => {
    const s = current();
    s.strokes = strokes;
    s.pickedUp = pickedUp;
    s.laps++;
    const last = run.index === run.stages.length - 1;
    if (run.kind === 'free') run.phase = 'stage-result';
    else if (!last) run.phase = 'stage-result';
    else {
      run.phase = 'done';
      run.endedAt = now();
      const t = totals();
      const mine = { strokes: t.strokes, toPar: t.toPar, points: t.points };
      run.newBest = betterResult(mine, run.best);
    }
    bump();
  };

  return {
    get id() { return run.id; },
    get kind() { return run.kind; },
    get phase() { return run.phase; },
    get active() { return !run.aborted && run.phase !== 'done'; },
    get aborted() { return run.aborted; },
    get playerId() { return run.player.id; },
    get stage() { return current(); },
    /** True while a swing is a stroke of this run. */
    get acceptsSwing() { return !run.aborted && run.phase === 'play'; },
    /** What the run needs from the server: a stage's course in the bay. Null: nothing. */
    get waiting() {
      if (run.aborted || run.phase !== 'loading') return null;
      const s = current();
      return { for: 'stage', token: run.token, stageId: s.id, file: s.file };
    },

    /** The stage's course is in the bay, on its tee: play. */
    stageReady(token) {
      if (run.aborted || run.phase !== 'loading' || token !== run.token) return false;
      run.phase = 'play';
      bump();
      return true;
    },
    /** The stage would not load: the run is over, with the reason. */
    stageFailed(token, error) {
      if (run.aborted || run.phase !== 'loading' || token !== run.token) return false;
      run.aborted = true;
      run.error = String(error || 'The stage would not load');
      run.endedAt = now();
      bump();
      return true;
    },

    /**
     * A shot the game played while this run was in 'play': `result` as lib/game.js
     * handleShot gives it ({ strokes, holed, sim, arcade? }). -> what happened:
     * { stageOver, holed, pickedUp, strokes }.
     */
    recordShot(result) {
      if (!this.acceptsSwing || !result) return null;
      const s = current();
      const strokes = Number.isFinite(+result.strokes) ? Math.round(+result.strokes) : s.shots + 1;
      s.shots++;
      const a = result.arcade || null;
      if (a) {
        s.points += Math.max(0, Math.round(+a.points || 0));
        s.coins += Math.max(0, Math.round(+a.coins || 0));
        const c = a.callout || null;
        if (c && c.text && (c.tone === 'epic' || c.tone === 'good')) {
          run.shots.push({ stageId: s.id, stageName: s.name, text: String(c.text), tone: c.tone, grade: a.grade || null, points: Math.max(0, Math.round(+a.points || 0)), n: strokes });
        }
      }
      if (result.holed) { finishStage(strokes, false); return { stageOver: true, holed: true, pickedUp: false, strokes }; }
      if (strokes >= s.par + PICKUP_OVER) { finishStage(strokes + 1, true); return { stageOver: true, holed: false, pickedUp: true, strokes: strokes + 1 }; }
      bump();
      return { stageOver: false, holed: false, pickedUp: false, strokes };
    },

    /** Give the stage up: it costs the strokes so far plus one, and never less than GIVE_UP_OVER over par. */
    giveUp(strokesSoFar = 0) {
      if (!this.acceptsSwing) throw new SoloError('No stage is being played', 409);
      const s = current();
      const strokes = Math.max(s.par + GIVE_UP_OVER, Math.max(0, Math.round(+strokesSoFar || 0)) + 1);
      finishStage(strokes, true);
      return { stageOver: true, holed: false, pickedUp: true, strokes };
    },

    /** Leave a stage's card: the tour's next stage, or (free) the same stage again. */
    next() {
      if (run.aborted || run.phase !== 'stage-result') throw new SoloError('Nothing to continue from', 409);
      if (run.kind === 'free') {
        const s = current();
        Object.assign(s, { strokes: null, pickedUp: false, points: 0, coins: 0, shots: 0 });
      } else {
        run.index++;
      }
      run.phase = 'loading';
      run.token++;
      bump();
    },

    /** The stage in play from its tee again (not in a tour: its score is the point). */
    restartStage() {
      if (run.aborted || (run.phase !== 'play' && run.phase !== 'stage-result')) throw new SoloError('No stage to restart', 409);
      if (run.kind === 'tour') throw new SoloError('A tour is played straight through: restart the tour instead', 409);
      const s = current();
      run.shots = run.shots.filter((x) => x.stageId !== s.id);
      Object.assign(s, { strokes: null, pickedUp: false, points: 0, coins: 0, shots: 0 });
      run.phase = 'loading';
      run.token++;
      bump();
    },

    abort() {
      if (run.aborted) return;
      run.aborted = true;
      run.endedAt = now();
      bump();
    },

    /** The stored best this run is measured against changed (the server saved a new one). */
    setBest(best) { run.best = best ? { ...best } : null; },

    /** What a finished run has to offer the best-score store: null when there is nothing to keep. */
    result() {
      if (run.aborted || run.phase !== 'done' || run.kind === 'free') return null;
      const t = totals();
      return {
        kind: run.kind, playerId: run.player.id, playerName: run.player.name,
        stageId: run.kind === 'stage' ? run.stages[0].id : null,
        strokes: t.strokes, par: t.par, toPar: t.toPar, points: t.points, stages: t.stages, at: run.endedAt,
      };
    },

    /** The state the page draws (the 'solo' event, GET /api/solo). */
    state() {
      const t = totals();
      const best = [...run.shots].sort((a, b) => (a.tone === b.tone ? b.points - a.points : a.tone === 'epic' ? -1 : 1)).slice(0, BEST_SHOTS);
      const s = current();
      return {
        id: run.id, kind: run.kind, phase: run.phase, seq: run.seq, aborted: run.aborted, error: run.error,
        player: { ...run.player },
        index: run.index,
        stageId: s.id,
        stages: run.stages.map((x) => ({
          id: x.id, name: x.name, par: x.par, lengthYd: x.lengthYd, theme: x.theme, arena: x.arena,
          strokes: x.strokes, pickedUp: x.pickedUp, points: x.points, coins: x.coins, shots: x.shots,
          toPar: x.strokes == null ? null : x.strokes - x.par,
          scoreName: x.strokes == null ? null : (x.pickedUp ? 'PICKED UP' : scoreName(x.strokes, x.par)),
        })),
        totals: { ...t, toParText: relText(t.toPar) },
        bestShots: best,
        best: run.best,
        newBest: run.newBest,
        pickupAt: s.par + PICKUP_OVER,
        canRestartStage: !run.aborted && run.kind !== 'tour' && (run.phase === 'play' || run.phase === 'stage-result'),
        canGiveUp: !run.aborted && run.phase === 'play' && run.kind !== 'free',
        startedAt: run.startedAt, endedAt: run.endedAt,
      };
    },
  };
}

/**
 * The best scores, on disk (DATA_DIR/solo-best.json):
 *   { version: 2, tours: { <number of stages>: { <playerId>: { strokes, toPar, points, stages, at, name } } },
 *     stages: { <stageId>: { <playerId>: { strokes, toPar, points, at, name } } } }
 * A guest (no player id) is kept under '_guest'. A tour's best is kept per length (the
 * 3-stage sprint, the 6-stage half, the full tour): scores of different lengths never meet.
 */
function createSoloBests({ dataDir = null, file = null, log = console } = {}) {
  const FILE = file || (dataDir ? path.join(dataDir, 'solo-best.json') : null);
  const data = { version: 2, tours: {}, stages: {} };
  if (FILE) {
    try {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (raw && typeof raw === 'object') {
        if (raw.tours && typeof raw.tours === 'object') Object.assign(data.tours, raw.tours);
        if (raw.stages && typeof raw.stages === 'object') Object.assign(data.stages, raw.stages);
      }
    } catch (_) { /* no scores yet */ }
  }
  const key = (id) => (id ? String(id) : '_guest');
  const save = () => {
    if (!FILE) return;
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
    } catch (error) {
      if (log && log.warn) log.warn(`[solo] best scores not saved: ${error.message}`);
    }
  };
  return {
    /** The best a run of this kind is up against, or null. */
    get({ kind, playerId = null, stageId = null, stages = null } = {}) {
      if (kind === 'tour') {
        const b = (data.tours[String(stages)] || {})[key(playerId)] || null;
        return b ? { ...b } : null;
      }
      if (kind === 'stage' && stageId) {
        const b = (data.stages[stageId] || {})[key(playerId)] || null;
        return b ? { ...b } : null;
      }
      return null;
    },
    /** Offer a finished run's result (run.result()). -> { newBest, best }. */
    offer(result) {
      if (!result || (result.kind !== 'tour' && result.kind !== 'stage')) return { newBest: false, best: null };
      const k = key(result.playerId);
      const rec = { strokes: result.strokes, toPar: result.toPar, points: result.points || 0, at: result.at || Date.now(), name: result.playerName || null };
      if (result.kind === 'tour') {
        const board = (data.tours[String(result.stages)] ||= {});
        const had = board[k] || null;
        if (!betterResult(rec, had)) return { newBest: false, best: had ? { ...had } : null };
        board[k] = { ...rec, stages: result.stages };
        save();
        return { newBest: true, best: { ...board[k] } };
      }
      if (!result.stageId) return { newBest: false, best: null };
      const board = (data.stages[result.stageId] ||= {});
      const had = board[k] || null;
      if (!betterResult(rec, had)) return { newBest: false, best: had ? { ...had } : null };
      board[k] = rec;
      save();
      return { newBest: true, best: { ...rec } };
    },
    /** A player was removed from the roster: their scores go too. */
    forget(playerId) {
      const k = key(playerId);
      let changed = false;
      for (const board of [...Object.values(data.tours), ...Object.values(data.stages)]) if (board[k]) { delete board[k]; changed = true; }
      if (changed) save();
    },
    /** Everything, for the page ({ tours: { length: { id: best } }, stages: { stageId: { id: best } } }). */
    all() { return JSON.parse(JSON.stringify({ tours: data.tours, stages: data.stages })); },
  };
}

module.exports = { KINDS, PICKUP_OVER, GIVE_UP_OVER, SoloError, createSoloRun, createSoloBests, betterResult, scoreName, relText };
