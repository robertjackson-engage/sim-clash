// v3:modes TRICK SHOT DUEL, the server's side (lib/duel-mode.js through server.js's mode
// registry): a real server in this process on a throwaway data dir, driven over HTTP.
// GET /api/duel and its event, the start's refusals, a call and its answer with real balls
// (the verdict on the shot and in the state), the tee request, a stray ball taken back, a
// letter, a whole duel to its last letter, swings dropped on the result screen, undo from
// the result, play again (the loser calls first), restart, abort, one game at a time.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const PIN = [0, 137.2];   // 150 yd
const course = (osmId, name, arcade) => ({
  version: 4, name,
  source: { courseId: `osm:way:${osmId}`, osmType: 'way', osmId },
  origin: { lat: 47, lon: -122 },
  surfaces: [], boundary: null, elevation: null,
  holes: [{ ref: 1, par: 3, tee: [0, 0], pin: PIN, line: [[0, 0], PIN], lengthYd: 150 }],
  arcade,
});
const fileOf = (osmId) => `osm-way-${osmId}.json`;

test('a trick shot duel over HTTP: the call, the match, a letter, the word, again, restart, abort', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-duel-'));
  fs.mkdirSync(path.join(dataDir, 'courses'));
  fs.writeFileSync(path.join(dataDir, 'courses', fileOf(931)), JSON.stringify(course(931, 'Duel One', { theme: 'links', formatVersion: 2, wind: { min: 0, max: 0 } })));
  fs.writeFileSync(path.join(dataDir, 'courses', fileOf(932)), JSON.stringify(course(932, 'Duel Arena', { theme: 'stadium', formatVersion: 2, role: 'tiebreak', wind: { min: 0, max: 0 } })));
  fs.writeFileSync(path.join(dataDir, 'arcade-tour.json'), JSON.stringify({
    version: 1,
    stages: [{ id: 's1', order: 1, file: fileOf(931), name: 'Duel One', par: 3, lengthYd: 150, theme: 'links' }, { id: 'gone', order: 2, file: 'not-there.json', name: 'Missing', par: 4 }],
    tiebreaks: [{ id: 'a1', order: 1, file: fileOf(932), name: 'Duel Arena', par: 3, lengthYd: 150, theme: 'stadium' }],
  }));
  Object.assign(process.env, {
    BIRDIE_PORT: '0', BIRDIE_OC_PORT: '0', BIRDIE_NO_AUTOLOAD: '1', BIRDIE_NO_WATCH: '1', BIRDIE_ENRICH: '0', BIRDIE_SKY_PREFETCH: '0',
    BIRDIE_DATA_DIR: dataDir, BIRDIE_ART_DIR: path.join(dataDir, 'missing-art'),
    BIRDIE_MATCH_READY_MS: '0', BIRDIE_MATCH_CONTINUE_MS: '0', BIRDIE_MATCH_DONE_MS: '0',
    BIRDIE_DUEL_TEE_MS: '0', BIRDIE_DUEL_DONE_MS: '0',
  });
  const server = require('../server.js');
  const { httpPort } = await server.ready;
  const base = `http://127.0.0.1:${httpPort}`;
  const get = (p) => fetch(base + p).then((r) => r.json());
  const post = async (p, body = {}) => {
    const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, ...(await r.json()) };
  };
  const seen = { shots: [], duel: [] };
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
          else if (event === 'duel') seen.duel.push(JSON.parse((/^data: (.*)$/m.exec(chunk) || [])[1]));
        }
      }
    } catch (_) { /* closed */ }
  })();
  const settle = () => new Promise((r) => setTimeout(r, 40));
  const at = async (...phases) => {
    for (let i = 0; i < 400; i++) {
      const { duel } = await get('/api/duel');
      if (duel && phases.includes(duel.phase)) return duel;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`the duel never reached ${phases.join(' / ')}`);
  };
  const IRON = { speed: 106, vla: 20, hla: 0, spin: 6900, spinAxis: 0 };       // about 150 yd
  const SHORT = { speed: 80, vla: 26, hla: 0, spin: 8400, spinAxis: 0 };       // about 100 yd: no match for it
  const DINK = { speed: 25, vla: 12, hla: 0, spin: 2000, spinAxis: 0 };        // a stray ball
  const swing = async (ball) => { await post('/api/test-shot', ball); await settle(); return (await get('/api/duel')).duel; };
  const who = (s, id) => s.players.find((p) => p.id === id);

  try {
    await settle();
    for (let i = 0; i < 100 && !seen.duel.length; i++) await settle();   // the event stream has connected (a loaded machine takes its time)
    // ----- nothing in play
    assert.deepEqual(seen.duel, [null], "the 'duel' event on connect");
    let r = await get('/api/duel');
    assert.deepEqual([r.ok, r.duel], [true, null]);
    assert.deepEqual(r.stages.map((s) => [s.id, s.arena]), [['s1', false], ['a1', true]], 'the stages whose course is on disk, then the arenas');
    assert.deepEqual(r.words, ['CLASH', 'PIG', 'HORSE']);
    assert.deepEqual([r.tolerances.carryPct, r.tolerances.duffYd, r.tolerances.roundsPerLetter], [0.1, 40, 4]);
    for (const route of ['next', 'undo', 'restart', 'again']) assert.equal((await post(`/api/duel/${route}`)).status, 409, `${route} with no duel`);
    assert.equal((await post('/api/duel/abort')).duel, null);

    const a = (await post('/api/players', { name: 'Alex' })).player, b = (await post('/api/players', { name: 'Blair' })).player;
    for (const [body, status, re] of [
      [{ playerIds: [a.id] }, 400, /two players/],
      [{ playerIds: [a.id, a.id] }, 400, /different/],
      [{ playerIds: [a.id, 'nobody'] }, 404, /roster/],
      [{ playerIds: [a.id, b.id], stage: 'nowhere' }, 404, /No such stage/],
      [{ playerIds: [a.id, b.id], stage: 'gone' }, 404, /No such stage/],
    ]) {
      r = await post('/api/duel/start', body);
      assert.deepEqual([r.status, r.ok], [status, false]);
      assert.match(r.error, re);
    }

    // ----- a duel for PIG on the stage, Alex to call first
    r = await post('/api/duel/start', { playerIds: [a.id, b.id], stage: 's1', word: 'pig', first: 0 });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.duel.phase, 'loading');
    let s = await at('play');
    assert.deepEqual([s.word, s.maxRounds, s.round, s.role, s.challengerId, s.currentPlayerId, s.teed, s.stage.name, s.stage.kind, s.stage.wind.mph], ['PIG', 12, 1, 'challenge', a.id, a.id, true, 'Duel One', 'stage', 0]);
    let g = await get('/api/state');
    assert.deepEqual([g.courseName, g.lie, g.player.id], ['Duel One', 'tee', a.id]);
    for (const route of ['/api/drop', '/api/mulligan', '/api/next-hole']) {
      r = await post(route);
      assert.deepEqual([r.status, r.error], [409, 'A Trick Shot Duel game is in play'], route);
    }

    // ----- the call: a real ball, read and said
    s = await swing(IRON);
    let shot = seen.shots.at(-1);
    assert.deepEqual([shot.duel.event, shot.duel.playerId, shot.duel.nextPlayerId, shot.duel.role], ['call', a.id, b.id, 'match']);
    assert.ok(shot.duel.shot.carryYd > 135 && shot.duel.shot.carryYd < 165, `about 150 yd (${shot.duel.shot.carryYd})`);
    assert.equal(shot.duel.call.parts[0].id, 'carry');
    assert.match(s.call.text, /^MATCH IT: \d+ YD CARRY/);
    assert.deepEqual([s.role, s.currentPlayerId, s.challengerId, s.teed, s.waiting.for, s.call.playerId, s.last.kind], ['match', b.id, a.id, false, 'tee', a.id, 'call']);
    assert.deepEqual(s.call.parts, shot.duel.call.parts);
    g = await get('/api/state');
    assert.ok(g.distToPinYd < 60 && g.strokes === 0, 'the ball lies where it finished');
    r = await post('/api/duel/next');
    assert.deepEqual([r.duel.teed, r.duel.waiting], [true, null]);
    g = await get('/api/state');
    assert.deepEqual([g.lie, g.player.id, Math.round(g.distToPinYd)], ['tee', b.id, 150]);

    // ----- the answer: the same swing is a match; the roles swap
    s = await swing(IRON);
    shot = seen.shots.at(-1);
    assert.deepEqual([shot.duel.event, shot.duel.playerId, shot.duel.checks.every((c) => c.ok)], ['matched', b.id, true]);
    assert.deepEqual([s.round, s.role, s.challengerId, s.currentPlayerId, s.call, s.last.kind, who(s, b.id).matched], [2, 'challenge', b.id, b.id, null, 'matched', 1]);

    // ----- a stray ball by the challenger: no call, marked, and taken back
    s = await swing(DINK);
    assert.deepEqual([seen.shots.at(-1).duel.event, seen.shots.at(-1).duel.stray, s.undoable.stray, s.challengerId, s.round], ['no-call', true, true, a.id, 3]);
    r = await post('/api/duel/undo');
    assert.equal(r.ok, true, r.error);
    assert.deepEqual([r.undone.stray, r.duel.round, r.duel.role, r.duel.currentPlayerId, r.duel.teed, who(r.duel, b.id).noCalls], [true, 2, 'challenge', b.id, true, 0]);
    assert.equal((await post('/api/duel/undo')).status, 409);

    // ----- Blair calls, Alex comes up 50 yd short: a letter (a swing before "next" is played all the same)
    s = await swing(IRON);
    assert.equal(s.role, 'match');
    s = await swing(SHORT);
    shot = seen.shots.at(-1);
    assert.deepEqual([shot.duel.event, shot.duel.playerId, shot.duel.letter, shot.duel.letters], ['letter', a.id, 'P', 'P']);
    assert.equal(shot.duel.checks[0].ok, false);
    assert.deepEqual([who(s, a.id).letters, who(s, a.id).lettersLeft, s.round, s.challengerId, s.last.kind], ['P', 2, 3, a.id, 'letter']);

    // ----- to the end: Blair misses every call of Alex's, Alex matches Blair's
    for (let i = 0; i < 3; i++) {
      s = await swing(IRON);            // Alex calls
      s = await swing(SHORT);           // Blair misses: P, I, G
      if (s.phase !== 'play') break;
      s = await swing(IRON);            // Blair calls
      s = await swing(IRON);            // Alex matches
    }
    assert.deepEqual([s.phase, s.reason, s.winnerId, s.loserId, who(s, b.id).letters, who(s, a.id).letters], ['done', 'word', a.id, b.id, 'PIG', 'P']);
    assert.equal(seen.shots.at(-1).duel.event, 'duel-over');
    assert.equal(s.history.length, 7);
    // the result screen: a swing is nobody's
    const before = seen.shots.length;
    await post('/api/test-shot', IRON);
    await settle();
    assert.equal(seen.shots.length, before);
    // the ball that spelled it can be taken back
    r = await post('/api/duel/undo');
    assert.deepEqual([r.duel.phase, r.duel.role, r.duel.currentPlayerId, who(r.duel, b.id).letters, r.duel.winnerId], ['play', 'match', b.id, 'PI', null]);
    s = await swing(SHORT);
    assert.equal(s.phase, 'done');

    // ----- play again: the same players, stage and word, the loser calls first
    const firstId = s.id;
    r = await post('/api/duel/again');
    assert.equal(r.ok, true, r.error);
    assert.notEqual(r.duel.id, firstId);
    s = await at('play');
    assert.deepEqual([s.word, s.stage.id, s.challengerId, s.players.map((p) => p.letters)], ['PIG', 's1', b.id, ['', '']]);
    assert.equal((await post('/api/duel/again')).status, 409);
    // restart: from the top, the other player first
    await swing(IRON); await swing(SHORT);
    r = await post('/api/duel/restart');
    assert.deepEqual([r.duel.round, r.duel.challengerId, r.duel.players.map((p) => p.letters), r.duel.history], [1, a.id, ['', ''], []]);

    // ----- one game at a time
    r = await post('/api/match/start', { playerIds: [a.id, b.id], format: 'quick', stage: 's1' });
    assert.equal(r.ok, true, r.error);
    assert.equal((await get('/api/duel')).duel, null);
    r = await post('/api/duel/start', { playerIds: [b.id, a.id], stage: 'a1' });
    assert.equal(r.ok, true, r.error);
    assert.equal((await get('/api/match')).match, null, 'the match was dropped');
    s = await at('play');
    assert.deepEqual([s.word, s.maxRounds, s.stage.kind, s.players.map((p) => p.id)], ['CLASH', 20, 'arena', [b.id, a.id]]);
    r = await post('/api/duel/start', { playerIds: [a.id, b.id] });   // 'random': the par 3 or the arena, not the one just played
    assert.equal(r.ok, true, r.error);
    s = await at('play');
    assert.equal(s.stage.id, 's1');

    // ----- abort hands the bay back
    r = await post('/api/duel/abort');
    assert.deepEqual([r.ok, r.duel], [true, null]);
    g = await get('/api/state');
    assert.deepEqual([g.lie, g.strokes], ['tee', 0]);
    await post('/api/test-shot', IRON);
    await settle();
    assert.equal(seen.shots.at(-1).duel, undefined, 'the next swing is an ordinary shot');
  } finally {
    sse.abort();
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
