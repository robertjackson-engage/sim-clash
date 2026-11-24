// The match menu, the server's side (server.js "v2:menu"; lib/match.js undoLastShot /
// restartHole): a real server in this process on a throwaway data dir, driven over HTTP.
// A stray ball is marked and can be taken back, POST /api/match/undo puts the match and the
// game's ball back (also from the result of a hole and of the match, with the payout
// reversed), /restart-hole tees the hole up again, /restart starts the match over while it
// is in play, and a second /start is refused with a message the lobby can show.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const course = (osmId, name, arcade, pin) => ({
  version: 4, name,
  source: { courseId: `osm:way:${osmId}`, osmType: 'way', osmId },
  origin: { lat: 47, lon: -122 },
  surfaces: [], boundary: null, elevation: null,
  holes: [{ ref: 1, par: 3, tee: [0, 0], pin, line: [[0, 0], pin], lengthYd: Math.round(pin[1] / 0.9144) }],
  arcade,
});
const fileOf = (osmId) => `osm-way-${osmId}.json`;

test('undo, restart the hole, restart the match and the stray-ball mark, over HTTP', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-menu-'));
  fs.mkdirSync(path.join(dataDir, 'courses'));
  const stages = [['s1', 801, 'Menu One'], ['s2', 802, 'Menu Two'], ['s3', 803, 'Menu Three']];
  for (const [, osmId, name] of stages) fs.writeFileSync(path.join(dataDir, 'courses', fileOf(osmId)), JSON.stringify(course(osmId, name, { theme: 'links', formatVersion: 2, wind: { min: 0, max: 0 } }, [0, 182.9])));
  fs.writeFileSync(path.join(dataDir, 'courses', fileOf(821)), JSON.stringify(course(821, 'Menu Arena', { theme: 'stadium', formatVersion: 2, role: 'tiebreak', wind: { min: 0, max: 0 } }, [0, 137.2])));
  fs.writeFileSync(path.join(dataDir, 'arcade-tour.json'), JSON.stringify({
    version: 1,
    stages: stages.map(([id, osmId, name], i) => ({ id, order: i + 1, file: fileOf(osmId), name, par: 3, lengthYd: 200, theme: 'links' })),
    tiebreaks: [{ id: 'a1', order: 1, file: fileOf(821), name: 'Menu Arena', par: 3, lengthYd: 150, theme: 'stadium' }],
  }));
  Object.assign(process.env, {
    BIRDIE_PORT: '0', BIRDIE_OC_PORT: '0', BIRDIE_NO_AUTOLOAD: '1', BIRDIE_NO_WATCH: '1', BIRDIE_ENRICH: '0', BIRDIE_SKY_PREFETCH: '0',
    BIRDIE_DATA_DIR: dataDir, BIRDIE_ART_DIR: path.join(dataDir, 'missing-art'),
    BIRDIE_MATCH_READY_MS: '0', BIRDIE_MATCH_CONTINUE_MS: '0', BIRDIE_MATCH_DONE_MS: '0',
  });
  const server = require('../server.js');
  const { httpPort } = await server.ready;
  const base = `http://127.0.0.1:${httpPort}`;
  const get = (p) => fetch(base + p).then((r) => r.json());
  const post = async (p, body = {}) => {
    const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, ...(await r.json()) };
  };
  // the event stream: every 'shot' and how many 'match' / 'state' events have gone out
  const seen = { shots: [], match: 0, state: 0 };
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
          else if (event === 'match' || event === 'state') seen[event]++;
        }
      }
    } catch (_) { /* closed */ }
  })();
  const settle = () => new Promise((r) => setTimeout(r, 40));
  const matchAt = async (...phases) => {
    for (let i = 0; i < 400; i++) {
      const { match } = await get('/api/match');
      if (match && phases.includes(match.phase)) return match;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`the match never reached ${phases.join(' / ')}`);
  };
  const I7 = { speed: 111, vla: 19, hla: 0, spin: 7000, spinAxis: 0 };
  const DINK = { speed: 8, vla: 10, hla: 0, spin: 1000, spinAxis: 0 };
  const MISHIT = { speed: 30, vla: 12, hla: 0, spin: 2000, spinAxis: 0 };   // the stray ball: 30 mph off the tee
  const who = (m, id) => m.players.find((p) => p.id === id);
  const types = (m) => m.events.map((e) => e.type);

  try {
    const a = (await post('/api/players', { name: 'Alex' })).player, b = (await post('/api/players', { name: 'Dave' })).player;
    // nothing to act on before there is a match
    for (const route of ['undo', 'restart-hole', 'restart']) {
      const r = await post(`/api/match/${route}`);
      assert.deepEqual([r.status, r.ok], [409, false], `${route} with no match`);
    }
    let r = await post('/api/match/start', { playerIds: [a.id, b.id], format: 'bo3' });
    assert.equal(r.ok, true, r.error);
    const firstId = r.match.id;
    await matchAt('intro');
    let m = (await post('/api/match/ready')).match;
    assert.deepEqual([m.phase, m.undoable, m.canRestartHole], ['play', null, true]);
    r = await post('/api/match/undo');
    assert.deepEqual([r.status, r.ok, r.error], [409, false, 'There is no shot to take back']);

    // ----- a second start while this one is in play: refused, with words the lobby can show
    r = await post('/api/match/start', { playerIds: [a.id, b.id], format: 'quick' });
    assert.deepEqual([r.status, r.ok, r.error], [409, false, 'A match is in play: quit it first']);
    assert.equal((await get('/api/match')).match.id, firstId, 'the match in play is untouched');

    // ----- the stray ball: a 30 mph mishit is the tee shot, with a rocket on it
    const up = m.currentPlayerId;
    m = (await post('/api/match/arm', { playerId: up, id: 'rocket' })).match;
    assert.deepEqual([who(m, up).armedPowerup, who(m, up).charges], ['rocket', 3]);
    const tee = await get('/api/state');
    await post('/api/test-shot', MISHIT);
    await settle();
    m = (await get('/api/match')).match;
    assert.deepEqual([who(m, up).strokes, who(m, up).charges, who(m, up).usedPowerups, who(m, up).armedPowerup], [1, 2, ['rocket'], null], 'it counted, and spent the ball');
    assert.deepEqual(m.undoable, { playerId: up, stray: true, holeNumber: 1 });
    assert.ok(types(m).includes('stray-shot'));
    const shot = seen.shots.at(-1);
    assert.deepEqual([shot.stray, shot.match.stray, shot.match.playerId, shot.match.powerup], [true, true, up, 'rocket'], 'the shot event is marked stray');
    assert.notEqual(m.currentPlayerId, up, 'the other player is up');

    // ----- POST /api/match/undo: the swing never happened
    const before = { match: seen.match, state: seen.state };
    r = await post('/api/match/undo');
    assert.equal(r.ok, true, r.error);
    m = r.match;
    assert.deepEqual([m.phase, m.currentPlayerId, m.undoable, who(m, up).strokes, who(m, up).lie, who(m, up).charges, who(m, up).usedPowerups, who(m, up).armedPowerup],
      ['play', up, null, 0, 'tee', 3, [], 'rocket']);
    assert.deepEqual(m.events.at(-1).type, 'shot-undone');
    let st = await get('/api/state');
    assert.deepEqual([st.ball, st.strokes, st.lie, st.distToPinYd], [tee.ball, 0, 'tee', tee.distToPinYd], 'the game has the ball back on the tee');
    assert.equal(st.player.id, up);
    await settle();
    assert.ok(seen.match > before.match && seen.state > before.state, 'match and state were broadcast');
    r = await post('/api/match/undo');
    assert.deepEqual([r.status, r.error], [409, 'There is no shot to take back'], 'one level');
    // a real shot is not marked
    await post('/api/match/arm', { playerId: up, id: null });
    await post('/api/test-shot', I7);
    await settle();
    assert.equal(seen.shots.at(-1).stray, undefined);
    m = (await get('/api/match')).match;
    assert.deepEqual([m.undoable.stray, who(m, up).strokes], [false, 1]);

    // ----- POST /api/match/restart-hole: both back on the tee, nothing of the hole kept
    await post('/api/test-shot', I7);            // the other player
    m = (await get('/api/match')).match;
    assert.deepEqual(m.players.map((p) => p.strokes), [1, 1]);
    r = await post('/api/match/restart-hole');
    assert.equal(r.ok, true, r.error);
    m = r.match;
    assert.deepEqual([m.phase, m.holeNumber, m.currentPlayerId, m.honourId, m.undoable, m.events.at(-1).type], ['play', 1, up, up, null, 'hole-restarted']);
    assert.deepEqual(m.players.map((p) => [p.strokes, p.lie, p.charges, p.stats.shots]), [[0, 'tee', 3, 0], [0, 'tee', 3, 0]]);
    st = await get('/api/state');
    assert.deepEqual([st.ball, st.strokes, st.player.id], [tee.ball, 0, up]);

    // ----- a swing that decides the hole is taken back from the result screen
    for (let i = 0; i < 20 && m.phase === 'play'; i++) { await post('/api/test-shot', DINK); m = (await get('/api/match')).match; }
    assert.deepEqual([m.phase, m.lastResult.reason, m.holesPlayed], ['hole-result', 'tied', 1], 'both out of strokes: tied');
    const last = m.undoable.playerId;
    r = await post('/api/match/restart-hole');
    assert.deepEqual([r.status, r.error], [409, 'No hole is being played']);
    m = (await post('/api/match/undo')).match;
    assert.deepEqual([m.phase, m.currentPlayerId, m.holeResults.length, m.lastResult, m.holesPlayed, who(m, last).strokes, who(m, last).capped], ['play', last, 0, null, 0, 5, false]);
    await post('/api/test-shot', DINK);
    m = (await get('/api/match')).match;
    assert.deepEqual([m.phase, m.lastResult.reason], ['hole-result', 'tied'], 'played again: tied again');
    await post('/api/match/continue');
    await matchAt('intro');
    r = await post('/api/match/undo');
    assert.equal(r.status, 409, 'the result screen was left: the hole is final');

    // ----- POST /api/match/restart: the same match from the top, while this one is in play
    r = await post('/api/match/restart');
    assert.equal(r.ok, true, r.error);
    assert.notEqual(r.match.id, firstId);
    assert.deepEqual([r.match.format, r.match.holeNumber, r.match.players.map((p) => p.id), r.match.players.map((p) => p.holesWon), r.match.holeResults], ['bo3', 1, [a.id, b.id], [0, 0], []]);
    m = await matchAt('intro');
    assert.deepEqual([m.stage.id, m.stage.kind], ['s1', 'match']);
    assert.equal((await post('/api/match/abort')).match, null);
    r = await post('/api/match/restart');
    assert.deepEqual([r.status, r.error], [409, 'No match to restart']);

    // ----- a quick match decided by a stray ball in sudden death: undo unpays it
    const profilesBefore = (await get('/api/match')).profiles;
    r = await post('/api/match/start', { playerIds: [a.id, b.id], format: 'quick', stage: 's2', powerups: 'off' });
    assert.equal(r.ok, true, r.error);
    await matchAt('intro');
    m = (await post('/api/match/ready')).match;
    for (let i = 0; i < 20 && m.phase === 'play'; i++) { await post('/api/test-shot', DINK); m = (await get('/api/match')).match; }
    assert.deepEqual([m.phase, m.nextStage.kind], ['hole-result', 'tiebreak']);
    await post('/api/match/continue');
    await matchAt('intro');
    m = (await post('/api/match/ready')).match;
    const first = m.currentPlayerId, second = m.players.find((p) => p.id !== first).id;
    await post('/api/test-shot', I7);            // a real ball at the pin
    const bay = await get('/api/arcade');
    await post('/api/test-shot', MISHIT);        // ... and the other player's ball is a stray one: the match is over
    await settle();
    m = (await get('/api/match')).match;
    assert.deepEqual([m.phase, m.winnerId, m.reason, m.undoable], ['done', first, 'tiebreak', { playerId: second, stray: true, holeNumber: 1 }]);
    assert.equal(seen.shots.at(-1).stray, true);
    const paid = (await get('/api/match')).profiles;
    assert.deepEqual([paid[first].wins, paid[second].losses, paid[first].trophies > profilesBefore[first].trophies], [1, 1, true], 'the result was paid out');
    const bayPaid = await get('/api/arcade');
    const count = (inv) => Object.values(inv).reduce((s, n) => s + n, 0);
    assert.equal(count(bayPaid.inventory), count(bay.inventory) + m.rewards.winner.chest.length, 'the chest is on the shelf');
    r = await post('/api/match/undo');
    assert.equal(r.ok, true, r.error);
    m = r.match;
    assert.deepEqual([m.phase, m.currentPlayerId, m.winnerId, m.rewards, m.tiebreak.pending, m.tiebreak.results.length, m.lastResult.reason], ['tiebreak', second, null, null, [second], 1, 'tied']);
    assert.deepEqual((await get('/api/match')).profiles, profilesBefore, 'the profiles are as they were before the result');
    const bayBack = await get('/api/arcade');
    assert.deepEqual(bayBack.inventory, bay.inventory, 'the chest is off the shelf');
    assert.equal(bayBack.coins, bayPaid.coins - 100, 'the 100 coins of a quick match are out of the wallet');
    st = await get('/api/state');
    assert.equal(st.player.id, second);
    // the real ball this time: it is decided again and paid again, once
    await post('/api/test-shot', { ...I7, speed: 105 });
    await settle();
    m = (await get('/api/match')).match;
    assert.equal(m.phase, 'done');
    const again = (await get('/api/match')).profiles;
    assert.equal(again[m.winnerId].wins, 1);
    assert.equal(again[m.loserId].losses, 1);
    await post('/api/match/abort');
  } finally {
    sse.abort();
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
