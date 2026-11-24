// v3:modes BULLSEYE, the server's side (lib/bullseye-mode.js through server.js's mode
// registry): a real server in this process on a throwaway data dir, driven over HTTP.
// GET /api/bullseye and its event, a guest game on an empty roster, the start's refusals,
// the target read from the arena's target-ring props, real balls scored and kept, the tee
// request, undo (with the records it made), a game to its end with the high scores and the
// nearest ball of the night on disk, swings dropped on the result screen, play again,
// restart, abort, and one game at a time with a match and a solo run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const PIN = [0, 109.7];   // 120 yd
const course = (osmId, name, arcade, props = []) => ({
  version: 4, name,
  source: { courseId: `osm:way:${osmId}`, osmType: 'way', osmId },
  origin: { lat: 47, lon: -122 },
  surfaces: [], boundary: null, elevation: null,
  holes: [{ ref: 1, par: 3, tee: [0, 0], pin: PIN, line: [[0, 0], PIN], lengthYd: 120 }],
  props, arcade,
});
const fileOf = (osmId) => `osm-way-${osmId}.json`;
const rings = (...diameters) => diameters.map((d) => ({ id: `ring-${d}`, kind: 'target-ring', x: PIN[0], y: PIN[1], rotDeg: 0, heightM: d }));

test('a game of Bullseye over HTTP: start, balls, tee, undo, the end, the bests, again, restart, abort', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-bullseye-'));
  fs.mkdirSync(path.join(dataDir, 'courses'));
  fs.writeFileSync(path.join(dataDir, 'courses', fileOf(901)), JSON.stringify(course(901, 'Stage One', { theme: 'links', formatVersion: 2, wind: { min: 0, max: 0 } })));
  fs.writeFileSync(path.join(dataDir, 'courses', fileOf(921)), JSON.stringify(course(921, 'Ring Arena', { theme: 'stadium', formatVersion: 2, role: 'tiebreak', wind: { min: 0, max: 0 } }, rings(6, 14, 24, 60))));
  fs.writeFileSync(path.join(dataDir, 'courses', fileOf(922)), JSON.stringify(course(922, 'Other Arena', { theme: 'alpine', formatVersion: 2, role: 'tiebreak', wind: { min: 0, max: 0 } }, rings(38, 30, 22, 14, 6))));
  fs.writeFileSync(path.join(dataDir, 'arcade-tour.json'), JSON.stringify({
    version: 1,
    stages: [{ id: 's1', order: 1, file: fileOf(901), name: 'Stage One', par: 3, lengthYd: 120, theme: 'links' }],
    tiebreaks: [
      { id: 'a1', order: 1, file: fileOf(921), name: 'Ring Arena', par: 3, lengthYd: 120, theme: 'stadium' },
      { id: 'a2', order: 2, file: fileOf(922), name: 'Other Arena', par: 3, lengthYd: 120, theme: 'alpine' },
      { id: 'gone', order: 3, file: 'not-there.json', name: 'Missing', par: 3 },
    ],
  }));
  Object.assign(process.env, {
    BIRDIE_PORT: '0', BIRDIE_OC_PORT: '0', BIRDIE_NO_AUTOLOAD: '1', BIRDIE_NO_WATCH: '1', BIRDIE_ENRICH: '0', BIRDIE_SKY_PREFETCH: '0',
    BIRDIE_DATA_DIR: dataDir, BIRDIE_ART_DIR: path.join(dataDir, 'missing-art'),
    BIRDIE_MATCH_READY_MS: '0', BIRDIE_MATCH_CONTINUE_MS: '0', BIRDIE_MATCH_DONE_MS: '0',
    BIRDIE_BULLSEYE_TEE_MS: '0', BIRDIE_BULLSEYE_DONE_MS: '0',
  });
  const server = require('../server.js');
  const { httpPort } = await server.ready;
  const base = `http://127.0.0.1:${httpPort}`;
  const get = (p) => fetch(base + p).then((r) => r.json());
  const post = async (p, body = {}) => {
    const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, ...(await r.json()) };
  };
  // the event stream: every 'shot', and every 'bullseye' state
  const seen = { shots: [], bullseye: [] };
  const sse = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${base}/events`, { signal: sse.signal });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true });
        let at;
        while ((at = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, at);
          buf = buf.slice(at + 2);
          const event = (/^event: (.*)$/m.exec(chunk) || [])[1];
          if (event === 'shot') seen.shots.push(JSON.parse((/^data: (.*)$/m.exec(chunk) || [])[1]));
          else if (event === 'bullseye') seen.bullseye.push(JSON.parse((/^data: (.*)$/m.exec(chunk) || [])[1]));
        }
      }
    } catch (_) { /* closed */ }
  })();
  const settle = () => new Promise((r) => setTimeout(r, 40));
  const at = async (...phases) => {
    for (let i = 0; i < 400; i++) {
      const { bullseye } = await get('/api/bullseye');
      if (bullseye && phases.includes(bullseye.phase)) return bullseye;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`the game never reached ${phases.join(' / ')}`);
  };
  const WEDGE = { speed: 84, vla: 26, hla: 0, spin: 8200, spinAxis: 0 };
  const MISHIT = { speed: 25, vla: 12, hla: 0, spin: 2000, spinAxis: 0 };
  const swing = async (ball = WEDGE) => { await post('/api/test-shot', ball); await settle(); return (await get('/api/bullseye')).bullseye; };
  const who = (s, id) => s.players.find((p) => p.id === id);

  try {
    await settle();
    for (let i = 0; i < 100 && !seen.bullseye.length; i++) await settle();   // the event stream has connected (a loaded machine takes its time)
    // ----- nothing in play: the event said so on connect, the info is there, the routes refuse
    assert.deepEqual(seen.bullseye, [null], "the 'bullseye' event on connect");
    let r = await get('/api/bullseye');
    assert.equal(r.ok, true);
    assert.equal(r.bullseye, null);
    assert.deepEqual(r.arenas.map((a) => a.id), ['a1', 'a2'], 'only the arenas whose course is on disk');
    assert.deepEqual([r.nearest, r.nearestEver], [null, null]);
    assert.deepEqual([r.defaults.rounds, r.defaults.balls, r.defaults.target, r.defaults.bull], [3, 3, 100, 50]);
    for (const route of ['next', 'undo', 'restart', 'again']) {
      r = await post(`/api/bullseye/${route}`);
      assert.deepEqual([r.status, r.ok], [409, false], `${route} with no game`);
    }
    assert.equal((await post('/api/bullseye/nonsense')).status, 409);
    assert.deepEqual((await post('/api/bullseye/abort')).bullseye, null);

    // ----- nobody on the roster: a guest plays
    r = await post('/api/bullseye/start', { arena: 'a2', rounds: 1, balls: 1 });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual([r.bullseye.phase, r.bullseye.players.map((p) => [p.id, p.name])], ['loading', [['_guest', 'Player 1']]]);
    let s = await at('play');
    assert.deepEqual(s.rings.map((x) => [x.r, x.value]), [[3, 50], [7, 25], [11, 15], [15, 10], [19, 5]], "the arena's own rings");
    assert.equal((await post('/api/bullseye/abort')).bullseye, null);
    assert.equal((await get('/api/state')).courseName, 'Other Arena', 'the arena stays in the bay');

    // ----- the start's refusals
    const a = (await post('/api/players', { name: 'Alex' })).player, b = (await post('/api/players', { name: 'Blair' })).player;
    for (const [body, status, re] of [
      [{ playerIds: [] }, 400, /one to four/],
      [{ playerIds: [a.id, a.id] }, 400, /different/],
      [{ playerIds: [a.id, 'nobody'] }, 404, /roster/],
      [{ playerIds: [a.id], arena: 'nowhere' }, 404, /No such arena/],
      [{ playerIds: [a.id], arena: 'gone' }, 404, /No such arena/],
    ]) {
      r = await post('/api/bullseye/start', body);
      assert.deepEqual([r.status, r.ok], [status, false]);
      assert.match(r.error, re);
    }
    assert.equal((await get('/api/bullseye')).bullseye, null);

    // ----- a game: two players, one round of two balls, on the four-ring arena
    r = await post('/api/bullseye/start', { playerIds: [a.id, b.id], arena: 'a1', variant: 'high', rounds: 1, balls: 2 });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.bullseye.phase, 'loading');
    s = await at('play');
    assert.deepEqual(s.rings.map((x) => [x.r, x.value, x.name]), [[3, 50, 'BULLSEYE'], [7, 15, 'MIDDLE RING'], [12, 10, 'OUTER RING'], [30, 5, 'EDGE RING']]);
    assert.deepEqual([s.currentPlayerId, s.round, s.ball, s.teed, s.arena.name, s.arena.wind.mph], [a.id, 1, 1, true, 'Ring Arena', 0]);
    assert.deepEqual(s.records, { bests: {}, nearest: null, nearestEver: null, newBest: [], newNearest: null });
    let g = await get('/api/state');
    assert.deepEqual([g.courseName, g.strokes, g.lie, g.player.id], ['Ring Arena', 0, 'tee', a.id]);

    // the round's own moves wait while the game has the bay
    for (const route of ['/api/drop', '/api/mulligan', '/api/next-hole']) {
      r = await post(route);
      assert.deepEqual([r.status, r.error], [409, 'A Bullseye game is in play'], route);
    }

    // ----- a real ball: scored where it finished, on the shot and in the state
    const shots = seen.shots.length;
    s = await swing();
    assert.equal(seen.shots.length, shots + 1);
    const shot = seen.shots.at(-1);
    assert.deepEqual([shot.bullseye.event, shot.bullseye.playerId, shot.bullseye.dart.n], ['ball', a.id, 1]);
    assert.equal(shot.match, undefined);
    const d1 = who(s, a.id).darts[0];
    assert.deepEqual(d1, shot.bullseye.dart);
    assert.ok(d1.ft > 0 && d1.ft < 98, `a wedge finishes on the target (${d1.ft} ft)`);
    assert.ok(d1.value >= 5 && d1.score === d1.value, 'the first ball of a turn is x1');
    assert.equal(who(s, a.id).total, d1.score);
    assert.deepEqual([s.currentPlayerId, s.ball, s.teed, s.waiting.for, s.turn.mult], [a.id, 2, false, 'tee', 2]);
    assert.deepEqual(s.records.newNearest, { playerId: a.id, ft: d1.ft, n: 1, ever: true, first: true }, 'the first ball of the night sets the record (quietly: first)');
    assert.equal(shot.bullseye.nearest, true);
    g = await get('/api/state');
    assert.ok(g.distToPinYd < 33 && g.strokes === 0 && !g.holed, 'the ball lies where it finished, and the round has no stroke on it');
    // ----- the tee: the next ball goes on it when the page says so
    r = await post('/api/bullseye/next');
    assert.deepEqual([r.ok, r.bullseye.teed, r.bullseye.waiting], [true, true, null]);
    g = await get('/api/state');
    assert.deepEqual([g.lie, Math.round(g.distToPinYd)], ['tee', 120]);
    assert.equal((await post('/api/bullseye/next')).ok, true, 'nothing to tee up: still fine');

    // ----- a stray ball is marked; undo takes it back, and the record it could not have made
    s = await swing(MISHIT);
    assert.deepEqual([s.undoable.stray, s.undoable.playerId, s.undoable.n, s.currentPlayerId], [true, a.id, 2, b.id]);
    assert.equal(seen.shots.at(-1).bullseye.stray, true);
    assert.equal(who(s, a.id).darts[1].score, 0);
    r = await post('/api/bullseye/undo');
    assert.equal(r.ok, true, r.error);
    assert.deepEqual([r.undone.event, r.undone.stray], ['ball-undone', true]);
    s = r.bullseye;
    assert.deepEqual([s.currentPlayerId, s.ball, s.teed, s.undoable, who(s, a.id).darts.length], [a.id, 2, true, null, 1]);
    assert.deepEqual([(await post('/api/bullseye/undo')).status], [409]);
    // a good ball taken back takes its "nearest of the night" with it
    s = await swing({ ...WEDGE, speed: 86.5 });
    const d2 = who(s, a.id).darts[1];
    const near1 = (await get('/api/bullseye')).nearest;
    assert.equal(near1.ft, Math.min(d1.ft, d2.ft));
    await post('/api/bullseye/undo');
    assert.equal((await get('/api/bullseye')).nearest.ft, d1.ft);

    // ----- to the end: a swing before "next" is played all the same (nobody waits)
    s = await swing();                       // Alex's second ball
    assert.equal(who(s, a.id).darts[1].mult, 2, 'the second scoring ball of the turn counts double');
    assert.deepEqual([s.currentPlayerId, s.ball, s.teed], [b.id, 1, false]);
    s = await swing({ ...WEDGE, hla: 9 });   // Blair, straight from the result of the last ball
    assert.deepEqual([who(s, b.id).darts.length, s.currentPlayerId, s.ball], [1, b.id, 2]);
    assert.ok(who(s, b.id).darts[0].x > 3, 'pushed right of the pin');
    s = await swing({ ...WEDGE, hla: 9 });
    assert.deepEqual([s.phase, s.reason, s.currentPlayerId], ['done', 'score', null]);
    assert.equal(seen.shots.at(-1).bullseye.event, 'game-over');
    const totals = Object.fromEntries(s.players.map((p) => [p.id, p.total]));
    assert.ok(totals[a.id] > totals[b.id]);
    assert.deepEqual(s.winnerIds, [a.id]);
    assert.deepEqual(s.records.newBest.sort(), [a.id, b.id].filter((id) => totals[id] > 0).sort());
    assert.equal(s.records.bests[a.id].score, totals[a.id]);
    // on disk
    const disk = JSON.parse(fs.readFileSync(path.join(dataDir, 'bullseye-best.json'), 'utf8'));
    assert.equal(disk.high.a1['1x2'][a.id].score, totals[a.id]);
    assert.equal(disk.nearest.arenaId, 'a1');
    r = await get('/api/bullseye');
    assert.equal(r.bests.a1.high['1x2'][a.id].name, 'Alex');
    assert.equal(r.nearest.ft, disk.nearest.ft);

    // ----- the result screen: a swing is dropped, the game stays until it is dismissed
    const before = seen.shots.length;
    await post('/api/test-shot', WEDGE);
    await settle();
    assert.equal(seen.shots.length, before, 'no shot was played');
    assert.equal((await get('/api/bullseye')).bullseye.phase, 'done');
    // the ball that ended it can still be taken back: the game goes on, the high scores are as they were
    r = await post('/api/bullseye/undo');
    assert.deepEqual([r.bullseye.phase, r.bullseye.currentPlayerId, r.bullseye.ball, r.bullseye.records.newBest], ['play', b.id, 2, []]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'bullseye-best.json'), 'utf8')).high.a1, undefined);
    s = await swing({ ...WEDGE, hla: 9 });
    assert.equal(s.phase, 'done');

    // ----- play again: the same players, arena and options
    r = await post('/api/bullseye/restart');
    assert.deepEqual([r.ok, r.bullseye.phase, r.bullseye.round, r.bullseye.players.map((p) => p.darts.length)], [true, 'play', 1, [0, 0]]);
    s = await swing(); s = await swing(); s = await swing({ ...WEDGE, hla: 9 }); s = await swing({ ...WEDGE, hla: 9 });
    assert.equal(s.phase, 'done');
    const firstId = s.id;
    r = await post('/api/bullseye/again');
    assert.equal(r.ok, true, r.error);
    assert.notEqual(r.bullseye.id, firstId);
    s = await at('play');
    assert.deepEqual([s.arena.id, s.options, s.players.map((p) => p.id)], ['a1', { variant: 'high', rounds: 1, balls: 2, target: null }, [a.id, b.id]]);
    assert.equal(s.records.bests[a.id].score, totals[a.id], 'the game knows what it is up against');
    assert.deepEqual([(await post('/api/bullseye/again')).status], [409], 'not while one is in play');

    // ----- one game at a time: a match takes the bay, and Bullseye takes it back
    r = await post('/api/match/start', { playerIds: [a.id, b.id], format: 'quick', stage: 's1' });
    assert.equal(r.ok, true, r.error);
    assert.equal((await get('/api/bullseye')).bullseye, null);
    assert.equal(seen.bullseye.at(-1), null);
    r = await post('/api/bullseye/start', { playerIds: [b.id], arena: 'a2', variant: 'countdown' });
    assert.equal(r.ok, true, r.error);
    assert.equal((await get('/api/match')).match, null, 'the match was dropped');
    s = await at('play');
    assert.deepEqual([s.variant, s.options.target, s.rounds, who(s, b.id).remaining], ['countdown', 100, 6, 100]);
    s = await swing();
    assert.equal(who(s, b.id).remaining, 100 - who(s, b.id).darts[0].score);
    // ... and a solo run takes it from Bullseye
    r = await post('/api/solo/start', { kind: 'stage', stage: 's1' });
    assert.equal(r.ok, true, r.error);
    assert.equal((await get('/api/bullseye')).bullseye, null);
    await post('/api/solo/abort');

    // ----- abort hands the bay back
    await post('/api/bullseye/start', { playerIds: [a.id], arena: 'a1' });
    await at('play');
    await swing();
    r = await post('/api/bullseye/abort');
    assert.deepEqual([r.ok, r.bullseye], [true, null]);
    g = await get('/api/state');
    assert.deepEqual([g.lie, g.strokes, Math.round(g.distToPinYd)], ['tee', 0, 120]);
    assert.equal((await post('/api/drop')).error !== 'A Bullseye game is in play', true);
    await post('/api/test-shot', WEDGE);
    await settle();
    assert.equal(seen.shots.at(-1).bullseye, undefined, 'the next swing is an ordinary shot');
  } finally {
    sse.abort();
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
