'use strict';
// v3:modes TRICK SHOT DUEL on the server (docs/modes.md "Trick shot duel"): the driver of
// lib/duel.js and its routes, registered with server.js's mode registry (`registerMode`).
//
//   GET  /api/duel            { ok, duel: state | null, stages, words, tolerances }
//   POST /api/duel/start      { playerIds: [a, b], stage?: id | 'random', word?: 'CLASH', first?: 0 | 1 }
//   POST /api/duel/next       {}  the ball of whoever is up goes on the tee (a swing does it by itself)
//   POST /api/duel/undo       {}  take the last shot back
//   POST /api/duel/restart    {}  the same duel from the top (the other player calls first)
//   POST /api/duel/again      {}  a finished duel's players, stage and word, a new duel (the loser calls first)
//   POST /api/duel/abort      {}  end it (also dismisses a finished one)
//
// Every change broadcasts 'duel' with the state (null: none). A shot played in a duel carries
// result.duel: its verdict ({ event: 'call' | 'no-call' | 'matched' | 'letter' | 'duel-over', ... }).

const { createDuel, DuelError, WORDS, TOL, DUFF_YD, ROUNDS_PER_LETTER } = require('./duel');

const envMs = (name) => (process.env[name] !== undefined && Number.isFinite(+process.env[name]) ? Math.max(0, +process.env[name]) : undefined);
const RANDOM_MAX_YD = 240;   // "random" picks a par 3 no longer than this, or an arena

function create(ctx) {
  const { ModeError, game } = ctx;
  const TIMEOUTS = { teeMs: envMs('BIRDIE_DUEL_TEE_MS'), doneMs: envMs('BIRDIE_DUEL_DONE_MS') };
  let duel = null;
  let timer = null;
  let driven = null;
  let lastStage = null;

  // every stage a duel can be played on: the tour's stages, then the arenas
  const stages = () => {
    const t = ctx.tour();
    const sort = (list, kind) => (Array.isArray(list) ? list : []).filter((s) => s && s.id && s.file).sort((a, b) => (a.order || 0) - (b.order || 0)).map((s) => ({ ...s, kind }));
    return t ? [...sort(t.stages, 'stage'), ...sort(t.tiebreaks, 'tiebreak')] : [];
  };
  const wrap = (fn) => { try { return fn(); } catch (e) { if (e instanceof DuelError) throw new ModeError(e.message, e.status); throw e; } };
  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };

  function drive() {
    if (!duel) return;
    const w = duel.waiting;
    const key = w ? `${duel.id}:${w.token}` : null;
    if (key === driven) return;
    driven = key;
    clearTimer();
    if (!w) return;
    const d = duel;
    if (w.for === 'stage') {
      ctx.loadStage(w.file).then((error) => {
        if (duel !== d) return;
        if (error) {
          console.warn(`[duel] ${w.stageId} would not load: ${error}`);
          d.stageFailed(w.token, error);
          const st = d.state();
          duel = null; driven = null;
          ctx.broadcast('duel', st);
          ctx.setGamePlayer();
          return;
        }
        try {
          if (!d.stageReady(game, w.token, { wind: ctx.wind() })) return;
          console.log(`[duel] ${w.stageId} in the bay`);
        } catch (e) {
          console.error(`[duel] dropped: ${e.message}`);
          return drop();
        }
        drive();
        ctx.changed('duel');
      }).catch((e) => console.error(`[duel] stage load: ${e.message}`));
      return;
    }
    if (!(w.timeoutMs > 0)) return;
    timer = setTimeout(() => {
      timer = null;
      const now = duel === d ? d.waiting : null;
      if (!now || now.token !== w.token) return;
      try {
        if (w.for === 'dismiss') return drop();
        if (w.for === 'tee' && d.tee(game, w.token)) { drive(); ctx.changed('duel'); }
      } catch (e) {
        console.error(`[duel] ${w.for} timeout: ${e.message}`);
      }
    }, w.timeoutMs);
    if (timer.unref) timer.unref();
  }

  function start(cfg) {
    const ids = Array.isArray(cfg.playerIds) ? cfg.playerIds.map(String).filter(Boolean) : [];
    if (ids.length !== 2) throw new ModeError('Pick two players from the roster');
    if (ids[0] === ids[1]) throw new ModeError('Pick two different players');
    const pls = ids.map((id) => ctx.player(id));
    if (pls.some((p) => !p)) throw new ModeError('Pick two players from the roster', 404);
    const list = stages();
    if (!list.length) throw new ModeError('No stage is installed: build the stages first', 409);
    const want = cfg.stage == null || cfg.stage === '' ? 'random' : String(cfg.stage);
    let stage;
    if (want === 'random') {
      let pool = list.filter((s) => s.kind === 'tiebreak' || (s.par === 3 && (s.lengthYd || 0) <= RANDOM_MAX_YD));
      if (!pool.length) pool = list;
      if (pool.length > 1) pool = pool.filter((s) => s.id !== lastStage);
      stage = pool[Math.min(pool.length - 1, Math.floor(Math.random() * pool.length))];
    } else {
      stage = list.find((s) => s.id === want);
      if (!stage) throw new ModeError(`No such stage: ${want}`, 404);
    }
    ctx.takeBay('duel');
    drop({ quiet: true });
    duel = wrap(() => createDuel({
      players: pls.map((p) => ({ id: p.id, name: p.name, initials: ctx.initials(p.name) })),
      stage, timeouts: TIMEOUTS,
      options: { word: cfg.word, first: cfg.first === 0 || cfg.first === 1 ? cfg.first : null, maxRounds: cfg.maxRounds },
    }));
    lastStage = stage.id;
    driven = null;
    drive();
  }

  function drop({ quiet = false } = {}) {
    if (!duel) return;
    clearTimer();
    driven = null;
    duel.abort(game);
    duel = null;
    ctx.setGamePlayer();
    if (!quiet) {
      ctx.rollWind();
      ctx.broadcast('duel', null);
      ctx.broadcast('state', game.state());
    }
  }

  return {
    id: 'duel',
    label: 'Trick Shot Duel',
    // the duel has the bay until it is dismissed: a finished one takes no swing (beforeShot answers null)
    get active() { return Boolean(duel); },
    state() { return duel ? duel.state() : null; },
    info() {
      return {
        stages: stages().map((s) => ({ id: s.id, name: s.name, par: s.par ?? null, lengthYd: s.lengthYd ?? null, theme: s.theme || null, timeOfDay: s.timeOfDay || 'day', arena: s.kind === 'tiebreak', order: s.order ?? null })),
        words: WORDS,
        tolerances: { ...TOL, duffYd: DUFF_YD, roundsPerLetter: ROUNDS_PER_LETTER },
      };
    },
    drop,

    beforeShot(g) {
      if (!duel) return null;
      const s = duel.beforeShot(g);
      if (!s) { console.log(`[duel] swing ignored (${duel.phase})`); return null; }
      return { playerId: s.playerId };   // a plain ball: the shot is the player's own
    },
    afterShot(g, result) {
      if (!duel) return null;
      const ev = duel.afterShot(g, result);
      drive();
      return ev;
    },

    async handle(action, body) {
      if (action === 'start') { start(body || {}); return undefined; }
      if (action === 'abort') { drop(); return undefined; }
      if (action === 'again') {
        if (!duel) throw new ModeError('No duel to play again', 409);
        if (duel.phase !== 'done') throw new ModeError('A duel is in play: quit it first', 409);
        const c = duel.config();
        start({ playerIds: c.players.map((p) => p.id), stage: c.stageId, word: c.options.word, first: c.options.first, maxRounds: c.options.maxRounds });
        return undefined;
      }
      if (!duel) throw new ModeError('No trick shot duel in play', 409);
      if (action === 'next') {
        duel.tee(game);
      } else if (action === 'undo') {
        const ev = wrap(() => duel.undoLastShot(game));
        drive();
        return { undone: ev };
      } else if (action === 'restart') {
        wrap(() => duel.restart(game));
      } else {
        throw new ModeError('No such duel route', 404);
      }
      drive();
      return undefined;
    },
  };
}

module.exports = { create };
