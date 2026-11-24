'use strict';
// v3:modes BULLSEYE on the server (docs/modes.md "Bullseye"): the driver of lib/bullseye.js
// and its routes, registered with server.js's mode registry (`registerMode`).
//
//   GET  /api/bullseye            { ok, bullseye: state | null, arenas, nearest, nearestEver, bests, defaults }
//   POST /api/bullseye/start      { playerIds: [1 to 4 roster ids], arena: id | 'random', variant: 'high' | 'countdown',
//                                   rounds?, balls?, target? }
//   POST /api/bullseye/next       {}  the ball of whoever is up goes on the tee (the page says so once the last
//                                     ball has had its moment; a swing does it by itself)
//   POST /api/bullseye/undo       {}  take the last ball back (its records with it)
//   POST /api/bullseye/restart    {}  the same game from the top
//   POST /api/bullseye/again      {}  a finished game's players and options, a new game
//   POST /api/bullseye/abort      {}  end it (also dismisses a finished one)
//
// Every change broadcasts 'bullseye' with the state (null: no game). A shot played in a game
// carries result.bullseye: the ball's event ({ event: 'ball' | 'game-over', dart, ... }).

const fs = require('fs');
const path = require('path');
const {
  createBullseye, createBullseyeBests, BullseyeError, DEFAULTS, TARGETS, COUNTDOWN_ROUNDS, VARIANTS, RING_VALUES, BULL, MULT_MAX, ringsFromCourse,
} = require('./bullseye');

const envMs = (name) => (process.env[name] !== undefined && Number.isFinite(+process.env[name]) ? Math.max(0, +process.env[name]) : undefined);

function create(ctx) {
  const { ModeError, game } = ctx;
  const bests = createBullseyeBests({ dataDir: ctx.dataDir });
  const TIMEOUTS = { teeMs: envMs('BIRDIE_BULLSEYE_TEE_MS'), doneMs: envMs('BIRDIE_BULLSEYE_DONE_MS') };
  let be = null;            // the game (lib/bullseye.js), or null
  let timer = null;
  let driven = null;        // the request (game id : waiting token) already being seen to
  let undoBests = null;     // the store as it stood before the last ball (an undone ball takes its records back)
  let settled = false;      // a finished game has been offered to the store
  let lastArena = null;     // 'random' never gives the same arena twice running

  const arenas = () => {
    const t = ctx.tour();
    return (t && Array.isArray(t.tiebreaks) ? t.tiebreaks : []).filter((a) => a && a.id && a.file)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  };
  // The target painted on an arena, read from its course file (for the lobby's cards): the
  // same table a game reads from the course once it is in the bay. Null: unreadable.
  const ringCache = new Map();
  function ringsOf(file) {
    try {
      const full = path.join(ctx.dataDir, 'courses', path.basename(file));
      const at = fs.statSync(full).mtimeMs;
      const had = ringCache.get(file);
      if (had && had.at === at) return had.rings;
      const course = JSON.parse(fs.readFileSync(full, 'utf8'));
      const h = course && Array.isArray(course.holes) ? course.holes[0] : null;
      const rings = h ? ringsFromCourse(course, h.pin) : null;
      ringCache.set(file, { at, rings });
      return rings;
    } catch (_) {
      return null;
    }
  }
  const wrap = (fn) => { try { return fn(); } catch (e) { if (e instanceof BullseyeError) throw new ModeError(e.message, e.status); throw e; } };
  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };

  // What the game is up against, and what it has made so far: on the state as `records`.
  function syncRecords(extra = {}) {
    if (!be) return;
    const c = be.config();
    be.setRecords({
      bests: bests.board({ arenaId: c.arenaId, variant: c.options.variant, rounds: c.options.rounds, balls: c.options.balls, target: c.options.target }),
      nearest: bests.nearest(), nearestEver: bests.nearestEver(),
      newBest: [], newNearest: null, ...extra,
    });
  }

  // A finished game is offered to the store, once.
  function settle() {
    if (!be || be.phase !== 'done' || settled) return;
    const r = be.result();
    if (!r) return;
    settled = true;
    const got = bests.offerGame(r);
    syncRecords({ newBest: Object.keys(got).filter((id) => got[id].newBest), newNearest: (be.state().records || {}).newNearest || null });
  }

  // See to whatever the game is waiting for: the arena in the bay, or a timeout.
  function drive() {
    if (!be) return;
    const w = be.waiting;
    const key = w ? `${be.id}:${w.token}` : null;
    if (key === driven) return;
    driven = key;
    clearTimer();
    if (!w) return;
    const g = be;
    if (w.for === 'stage') {
      ctx.loadStage(w.file).then((error) => {
        if (be !== g) return;                      // dropped meanwhile
        if (error) {
          console.warn(`[bullseye] ${w.stageId} would not load: ${error}`);
          g.stageFailed(w.token, error);
          const st = g.state();
          be = null; driven = null;
          ctx.broadcast('bullseye', st);           // aborted, with the reason
          ctx.setGamePlayer();
          return;
        }
        try {
          if (!g.stageReady(game, w.token, { wind: ctx.wind() })) return;
          syncRecords();
          console.log(`[bullseye] ${w.stageId} in the bay`);
        } catch (e) {
          console.error(`[bullseye] dropped: ${e.message}`);
          return drop();
        }
        drive();
        ctx.changed('bullseye');
      }).catch((e) => console.error(`[bullseye] stage load: ${e.message}`));
      return;
    }
    if (!(w.timeoutMs > 0)) return;
    timer = setTimeout(() => {
      timer = null;
      const now = be === g ? g.waiting : null;
      if (!now || now.token !== w.token) return;
      try {
        if (w.for === 'dismiss') return drop();
        if (w.for === 'tee' && g.tee(game, w.token)) { drive(); ctx.changed('bullseye'); }
      } catch (e) {
        console.error(`[bullseye] ${w.for} timeout: ${e.message}`);
      }
    }, w.timeoutMs);
    if (timer.unref) timer.unref();
  }

  function start(cfg) {
    const ids = Array.isArray(cfg.playerIds) ? cfg.playerIds.map(String).filter(Boolean) : [];
    const roster = ctx.leagues.state().players || [];
    let players;
    if (!ids.length && !roster.length) players = [{ id: '_guest', name: 'Player 1' }];   // nobody on the roster: a guest plays
    else {
      if (ids.length < 1 || ids.length > 4) throw new ModeError('Pick one to four players');
      if (new Set(ids).size !== ids.length) throw new ModeError('Pick different players');
      players = ids.map((id) => ctx.player(id));
      if (players.some((p) => !p)) throw new ModeError('Pick players from the roster', 404);
      players = players.map((p) => ({ id: p.id, name: p.name, initials: ctx.initials(p.name) }));
    }
    const list = arenas();
    if (!list.length) throw new ModeError('No arena is installed: build the stages first', 409);
    const want = cfg.arena == null || cfg.arena === '' ? 'random' : String(cfg.arena);
    let arena;
    if (want === 'random') {
      const pool = list.length > 1 ? list.filter((a) => a.id !== lastArena) : list;
      arena = pool[Math.min(pool.length - 1, Math.floor(Math.random() * pool.length))];
    } else {
      arena = list.find((a) => a.id === want);
      if (!arena) throw new ModeError(`No such arena: ${want}`, 404);
    }
    ctx.takeBay('bullseye');
    drop({ quiet: true });   // a finished game still on its result screen
    be = wrap(() => createBullseye({
      players, arena, timeouts: TIMEOUTS,
      options: { variant: cfg.variant, rounds: cfg.rounds, balls: cfg.balls, target: cfg.target },
    }));
    lastArena = arena.id;
    settled = false; undoBests = null; driven = null;
    drive();
  }

  // End whatever game there is and hand the bay back. Safe when there is none.
  function drop({ quiet = false } = {}) {
    if (!be) return;
    clearTimer();
    driven = null;
    be.abort(game);
    be = null;
    settled = false; undoBests = null;
    ctx.setGamePlayer();
    if (!quiet) {
      ctx.rollWind();          // the arena is in solo play again: a wind of its own
      ctx.broadcast('bullseye', null);
      ctx.broadcast('state', game.state());
    }
  }

  return {
    id: 'bullseye',
    label: 'Bullseye',
    // the game has the bay until it is dismissed: a finished one still on its result screen
    // takes no swing (beforeShot answers null), so a stray ball cannot close it
    get active() { return Boolean(be); },
    state() { return be ? be.state() : null; },
    info() {
      const list = arenas();
      return {
        arenas: list.map((a) => ({ id: a.id, name: a.name, lengthYd: a.lengthYd ?? null, theme: a.theme || null, timeOfDay: a.timeOfDay || 'day', blurb: a.blurb || '', wind: a.wind || null, rings: ringsOf(a.file) })),
        nearest: bests.nearest(), nearestEver: bests.nearestEver(),
        bests: Object.fromEntries(list.map((a) => [a.id, bests.arena(a.id)])),
        defaults: { ...DEFAULTS, targets: TARGETS, countdownRounds: COUNTDOWN_ROUNDS, variants: Object.values(VARIANTS), bull: BULL, ringValues: RING_VALUES, multMax: MULT_MAX },
      };
    },
    drop,

    beforeShot(g) {
      if (!be) return null;
      const s = be.beforeShot(g);
      if (!s) { console.log(`[bullseye] swing ignored (${be.phase})`); return null; }
      undoBests = bests.snapshot();
      return { playerId: s.playerId };   // a plain ball: no power-ups in this game
    },
    afterShot(g, result) {
      if (!be) return null;
      const ev = be.afterShot(g, result);
      if (!ev) return null;
      // the nearest ball of the night (any ball that stayed dry)
      let near = null;
      const had = bests.nearest();   // the record this ball is up against (null: the first ball of the night sets it, quietly)
      if (ev.dart && ev.dart.ft != null) {
        const c = be.config();
        const p = c.players.find((x) => x.id === ev.playerId);
        const arena = be.arena;
        near = bests.offerBall({ ft: ev.dart.ft, playerId: ev.playerId, name: p ? p.name : null, arenaId: arena.id, arenaName: arena.name });
      }
      const was = (be.state().records || {}).newNearest || null;
      syncRecords({ newNearest: near && near.night ? { playerId: ev.playerId, ft: ev.dart.ft, n: ev.dart.n, ever: near.ever, first: !had } : was });
      settle();
      drive();
      return { ...ev, ...(near && near.night ? { nearest: true, nearestEver: near.ever, nearestFirst: !had } : {}) };
    },

    async handle(action, body) {
      if (action === 'start') { start(body || {}); return undefined; }
      if (action === 'abort') { drop(); return undefined; }
      if (action === 'again') {
        if (!be) throw new ModeError('No game to play again', 409);
        if (be.phase !== 'done') throw new ModeError('A game is in play: quit it first', 409);
        const c = be.config();
        start({ playerIds: c.players[0].id === '_guest' ? [] : c.players.map((p) => p.id), arena: c.arenaId, ...c.options });
        return undefined;
      }
      if (!be) throw new ModeError('No Bullseye game in play', 409);
      if (action === 'next') {
        be.tee(game);                      // nothing to tee up: nothing happens, still ok
      } else if (action === 'undo') {
        const ev = wrap(() => be.undoLastBall(game));
        if (undoBests) bests.restore(undoBests);
        undoBests = null; settled = false;
        syncRecords();
        drive();
        return { undone: ev };
      } else if (action === 'restart') {
        wrap(() => be.restart(game));
        settled = false; undoBests = null;
        syncRecords();
      } else {
        throw new ModeError('No such Bullseye route', 404);
      }
      drive();
      return undefined;
    },

    // for the tests
    _bests: bests,
  };
}

module.exports = { create };
