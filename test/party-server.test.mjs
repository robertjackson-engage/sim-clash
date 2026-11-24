// PARTY and handicaps, the server's side (server.js "v3:modes"; lib/match.js party formats):
// a real server in this process on a throwaway data dir, driven over HTTP. Three players
// start an elimination, one of them with help; a trick is cast on a chosen opponent; a hole
// that everybody caps goes to sudden death on the arena and the farthest ball is out; the
// final is decided the same way; the game pays every profile (first: a win, last: the drop,
// between: a loss), an undo of the deciding ball takes the payout back, a rematch keeps the
// players, the format and the help; a player who leaves is out and the others play on.
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

test('a party over HTTP: three players, help, a trick with a target, sudden death, rewards for three, undo, rematch, leaving', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-party-'));
  fs.mkdirSync(path.join(dataDir, 'courses'));
  const stages = [['s1', 831, 'Party One'], ['s2', 832, 'Party Two'], ['s3', 833, 'Party Three']];
  for (const [, osmId, name] of stages) fs.writeFileSync(path.join(dataDir, 'courses', fileOf(osmId)), JSON.stringify(course(osmId, name, { theme: 'links', formatVersion: 2, wind: { min: 0, max: 0 } }, [0, 182.9])));
  fs.writeFileSync(path.join(dataDir, 'courses', fileOf(851)), JSON.stringify(course(851, 'Party Arena', { theme: 'stadium', formatVersion: 2, role: 'tiebreak', wind: { min: 0, max: 0 } }, [0, 137.2])));
  fs.writeFileSync(path.join(dataDir, 'arcade-tour.json'), JSON.stringify({
    version: 1,
    stages: stages.map(([id, osmId, name], i) => ({ id, order: i + 1, file: fileOf(osmId), name, par: 3, lengthYd: 200, theme: 'links' })),
    tiebreaks: [{ id: 'a1', order: 1, file: fileOf(851), name: 'Party Arena', par: 3, lengthYd: 150, theme: 'stadium' }],
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
  const shots = [];
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
          if ((/^event: (.*)$/m.exec(chunk) || [])[1] === 'shot') shots.push(JSON.parse((/^data: (.*)$/m.exec(chunk) || [])[1]));
        }
      }
    } catch (_) { /* closed */ }
  })();
  const settle = () => new Promise((r) => setTimeout(r, 40));
  const matchAt = async (...phases) => {
    for (let i = 0; i < 600; i++) {
      const { match } = await get('/api/match');
      if (match && phases.includes(match.phase)) return match;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`the match never reached ${phases.join(' / ')}`);
  };
  const I7 = { speed: 111, vla: 19, hla: 0, spin: 7000, spinAxis: 0 };     // 148 yd: beside the arena's pin
  const I9 = { speed: 95, vla: 24, hla: 0, spin: 8200, spinAxis: 0 };      // well short of it
  const DINK = { speed: 8, vla: 10, hla: 0, spin: 1000, spinAxis: 0 };     // a yard and a half
  const who = (m, id) => m.players.find((p) => p.id === id);
  const types = (m) => m.events.map((e) => e.type);
  // one swing: played, and its 'shot' event has reached this client (a loaded machine takes its time)
  const hit = async (ball) => {
    const n = shots.length;
    await post('/api/test-shot', ball);
    for (let i = 0; i < 400 && shots.length === n; i++) await new Promise((r) => setTimeout(r, 5));
    return (await get('/api/match')).match;
  };
  // everybody dinks until the stroke limit: par 3 + 3 = six strokes each, nobody holes out
  const capEverybody = async () => {
    let m = (await get('/api/match')).match;
    for (let i = 0; i < 40 && m.phase === 'play'; i++) m = await hit(DINK);
    return m;
  };
  const toTee = async () => { await matchAt('intro'); return (await post('/api/match/ready')).match; };

  try {
    const [a, b, c] = await Promise.all(['Alex', 'Dave', 'Cara'].map(async (name) => (await post('/api/players', { name })).player));
    // what the lobby is offered
    let info = await get('/api/match');
    assert.deepEqual(Object.keys(info.partyFormats), ['skins', 'stroke', 'elim']);
    assert.deepEqual(info.partyHoles, [3, 6, 9]);
    assert.deepEqual(info.helpLevels.map((l) => [l.level, l.charges, l.tee, l.putting]), [[0, 0, 0, null], [1, 1, 0, 'easy'], [2, 1, 0.2, 'easy'], [3, 2, 0.35, 'easy']]);
    // a suggestion from the records (three new players: level), never applied
    let r = await post('/api/match/suggest', { playerIds: [a.id, b.id, c.id, 'nobody'] });
    assert.deepEqual([r.ok, r.help, r.levels.length], [true, { [a.id]: 0, [b.id]: 0, [c.id]: 0 }, 4]);
    assert.equal((await get('/api/match')).match, null, 'asking for a suggestion starts nothing');

    // ----- who can start what
    r = await post('/api/match/start', { playerIds: [a.id, b.id, c.id], format: 'bo3' });
    assert.deepEqual([r.status, r.error], [400, 'Pick two players from the roster']);
    r = await post('/api/match/start', { playerIds: [a.id], format: 'skins' });
    assert.deepEqual([r.status, r.error], [400, 'Pick two to four players from the roster']);
    r = await post('/api/match/start', { playerIds: [a.id, b.id, 'nobody'], format: 'skins' });
    assert.equal(r.status, 400);

    // ----- an elimination for three; Cara has help 3
    r = await post('/api/match/start', { playerIds: [a.id, b.id, c.id], format: 'elim', help: { [c.id]: 3 }, stakes: 'pro' });
    assert.equal(r.ok, true, r.error);
    let m = r.match;
    assert.deepEqual([m.party, m.format, m.maxHoles, m.holes, m.stakes, m.players.length], ['elim', 'elim', 2, 2, null, 3]);
    assert.deepEqual(m.players.map((p) => [p.slot, p.charges, p.help ? p.help.level : 0]), [[1, 3, 0], [2, 3, 0], [3, 5, 3]]);
    assert.deepEqual([...m.teeOrder].sort(), [a.id, b.id, c.id].sort());
    assert.ok(m.players.every((p) => p.profile && p.profile.rank === 'Rookie'), 'every player has their profile on the state');
    m = await toTee();
    assert.deepEqual([m.phase, m.stage.id], ['play', 's1']);
    assert.equal(who(m, c.id).teeYd, null, 'no mown ground on this stage: Cara plays the back tee');
    const first = m.currentPlayerId;
    assert.equal(first, m.teeOrder[0]);

    // ----- a trick on a chosen opponent (the third in the order), through both routes
    const [, second, third] = m.teeOrder;
    r = await post('/api/match/arm', { playerId: first, id: 'gust', targetId: third });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.match.players.map((p) => [p.id, p.cursedWith]).filter((x) => x[1]), [[third, 'gust']]);
    assert.deepEqual(r.match.events.at(-1).targetId, third);
    r = await post('/api/match/arm', { playerId: first, id: 'fog', targetId: first });
    assert.deepEqual([r.status, r.ok], [400, false], 'not on oneself');
    r = await post('/api/arcade/arm', { id: 'fog', targetId: second });   // the dock's route, for whoever is up
    assert.equal(r.ok, true, r.error);
    m = (await get('/api/match')).match;
    assert.equal(who(m, second).cursedWith, 'fog');

    // ----- the tee shots: each curse rides on its target's swing; Cara's putting level is her own
    m = await hit(DINK);
    assert.deepEqual([shots.at(-1).match.playerId, shots.at(-1).match.curses, shots.at(-1).match.event], [first, [], 'shot']);
    m = await hit(DINK);
    assert.deepEqual([shots.at(-1).match.playerId, shots.at(-1).match.curses], [second, ['fog']]);
    m = await hit(DINK);
    assert.deepEqual([shots.at(-1).match.playerId, shots.at(-1).match.curses], [third, ['gust']]);
    assert.ok(m.players.every((p) => p.strokes === 1 && !p.cursedWith));

    // ----- everybody runs out of strokes: a three-way tie for the highest score, sudden death, farthest is out
    m = await capEverybody();
    assert.deepEqual([m.phase, m.lastResult.reason, m.lastResult.scores, m.nextStage.kind], ['hole-result', 'tied', { [a.id]: 7, [b.id]: 7, [c.id]: 7 }, 'tiebreak']);
    assert.deepEqual(Object.values(m.lastResult.finish), ['capped', 'capped', 'capped']);
    assert.deepEqual([shots.at(-1).match.event, shots.at(-1).match.goal, shots.at(-1).match.next], ['hole-tied', 'worst', 'tiebreak']);
    r = await post('/api/match/continue');
    assert.equal(r.ok, true);
    m = await toTee();
    assert.deepEqual([m.phase, m.stage.id, m.tiebreak.goal, m.tiebreak.ids.length], ['tiebreak', 'a1', 'worst', 3]);
    r = await post('/api/match/drop', {});
    assert.deepEqual([r.status, r.error], [409, 'No drops in a sudden death']);
    const order = [...m.tiebreak.ids];
    m = await hit(I7);
    m = await hit(I9);
    assert.equal(m.phase, 'tiebreak');
    m = await hit(DINK);   // the last to hit goes a yard and a half: the farthest by a long way
    assert.deepEqual([m.phase, m.lastResult.reason, m.lastResult.eliminatedId], ['hole-result', 'tiebreak', order[2]]);
    assert.deepEqual([shots.at(-1).match.event, shots.at(-1).match.eliminatedId, shots.at(-1).match.reason], ['hole-won', order[2], 'tiebreak']);
    assert.deepEqual([who(m, order[2]).out, who(m, order[2]).place, m.standings.startsWith('THE FINAL')], [true, 3, true]);
    assert.ok(types(m).includes('eliminated'));

    // ----- the final: two players, the same again; the nearer ball wins the game
    await post('/api/match/continue');
    m = await toTee();
    assert.deepEqual([m.phase, m.stage.id, m.holeNumber], ['play', 's2', 2]);
    assert.ok(types(m).includes('final-two'));
    r = await post('/api/match/arm', { playerId: order[2], id: 'rocket' });
    assert.deepEqual([r.status, /is out of the game/.test(r.error)], [409, true], 'a player who is out arms nothing');
    m = await capEverybody();
    assert.deepEqual([m.phase, m.lastResult.reason], ['hole-result', 'tied']);
    await post('/api/match/continue');
    m = await toTee();
    const finalists = [...m.tiebreak.ids];
    assert.deepEqual([m.phase, finalists.length], ['tiebreak', 2]);
    m = await hit(I7);
    m = await hit(DINK);
    await settle();
    m = (await get('/api/match')).match;
    assert.deepEqual([m.phase, m.winnerId, m.reason, m.placings], ['done', finalists[0], 'tiebreak', [finalists[0], finalists[1], order[2]]]);
    assert.deepEqual([shots.at(-1).match.event, shots.at(-1).match.winnerId, shots.at(-1).match.playerId], ['match-over', finalists[0], finalists[1]]);
    assert.deepEqual([m.rewards.winner.trophies, m.rewards.winner.coins, m.rewards.loser.trophies, m.rewards.placings], [20, 250, 0, m.placings]);

    // ----- the game paid every profile: a win, and two losses
    const ledgerFile = path.join(dataDir, 'match-ledger.json');
    let ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
    assert.deepEqual(m.placings.map((id) => [ledger[id].wins, ledger[id].losses, ledger[id].trophies, ledger[id].coins, ledger[id].streak]), [[1, 0, 20, 1250, 1], [0, 1, 0, 1000, 0], [0, 1, 0, 1000, 0]]);
    assert.deepEqual(m.players.map((p) => p.profile.wins + p.profile.losses), [1, 1, 1], 'the state carries the profiles as they are now');

    // ----- the deciding ball is taken back: the payout with it
    r = await post('/api/match/undo');
    assert.equal(r.ok, true, r.error);
    assert.deepEqual([r.match.phase, r.match.winnerId, r.match.placings, r.match.currentPlayerId], ['tiebreak', null, null, finalists[1]]);
    ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
    assert.deepEqual([a.id, b.id, c.id].map((id) => [ledger[id].wins, ledger[id].losses, ledger[id].trophies, ledger[id].coins]), [[0, 0, 0, 1000], [0, 0, 0, 1000], [0, 0, 0, 1000]]);
    // ... and hit again, nearer this time: the other finalist wins
    m = await hit(I7);
    if (m.phase === 'tiebreak') m = await hit(I7), m = await hit(DINK);   // level within an inch: the round was played again
    await settle();
    m = (await get('/api/match')).match;
    assert.equal(m.phase, 'done');
    ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
    assert.deepEqual(m.placings.map((id) => [ledger[id].wins, ledger[id].losses]), [[1, 0], [0, 1], [0, 1]]);

    // ----- a rematch: the same three, the same format, Cara's help
    r = await post('/api/match/rematch');
    assert.equal(r.ok, true, r.error);
    m = r.match;
    assert.deepEqual([m.party, m.players.length, who(m, c.id).help.level, who(m, c.id).charges, who(m, a.id).charges], ['elim', 3, 3, 5, 3]);
    assert.notEqual(m.id, undefined);

    // ----- leaving: the player who is up drops out, the others play on; the last one left wins
    m = await toTee();
    const leaver = m.currentPlayerId;
    r = await post('/api/match/concede', { playerId: leaver });
    assert.equal(r.ok, true, r.error);
    m = r.match;
    assert.deepEqual([m.phase, who(m, leaver).out, who(m, leaver).left, m.winnerId], ['play', true, true, null]);
    assert.notEqual(m.currentPlayerId, leaver);
    const st = await get('/api/state');
    assert.equal(st.player.id, m.currentPlayerId, 'the bay has the next player');
    r = await post('/api/match/concede', {});   // whoever is up now
    m = r.match;
    assert.deepEqual([m.phase, m.reason, m.placings.length, m.placings[2]], ['done', 'concede', 3, leaver]);
    ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
    assert.equal(ledger[m.winnerId].wins >= 1, true);

    // ----- a head-to-head with help still starts as it always did, and says so on the helped player only
    r = await post('/api/match/start', { playerIds: [a.id, b.id], format: 'quick', help: { [b.id]: 1 } });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(['party' in r.match, 'help' in who(r.match, a.id), who(r.match, b.id).help.level, who(r.match, a.id).charges, who(r.match, b.id).charges], [false, false, 1, 2, 3]);
    await post('/api/match/abort');
  } finally {
    sse.abort();
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
