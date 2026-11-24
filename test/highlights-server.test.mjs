// v3:modes The highlights reel on a real server (lib/highlights-mode.js through server.js's
// mode registry): a real match over HTTP on a throwaway data dir. The shot that wins the
// match is marked on the 'shot' event (result.highlight, auto in a match), the reel has it
// (GET /api/highlights, the 'highlights' event, <dataDir>/highlights.json), POST
// /api/highlights/play sends 'replay' with the whole record and puts the shot's stage back
// in the bay when another one is there (refused while a match or a solo run has the bay),
// a swing the match ignores is reported ('swing-ignored': it skips a replay on the page),
// and a notable shot outside a match is only offered (auto: false).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { swingForCarry } from '../public/arcade/shell-core.js';

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

test('the reel over HTTP: a match winner is marked, kept, played back on its stage; the bay is never taken from a game', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-hl-'));
  fs.mkdirSync(path.join(dataDir, 'courses'));
  const stages = [['s1', 841, 'HL One'], ['s2', 842, 'HL Two']];
  for (const [, osmId, name] of stages) fs.writeFileSync(path.join(dataDir, 'courses', fileOf(osmId)), JSON.stringify(course(osmId, name, { theme: 'links', formatVersion: 2, wind: { min: 0, max: 0 } }, [0, 137.2])));
  fs.writeFileSync(path.join(dataDir, 'courses', fileOf(861)), JSON.stringify(course(861, 'HL Arena', { theme: 'stadium', formatVersion: 2, role: 'tiebreak', wind: { min: 0, max: 0 } }, [0, 110])));
  fs.writeFileSync(path.join(dataDir, 'arcade-tour.json'), JSON.stringify({
    version: 1,
    stages: stages.map(([id, osmId, name], i) => ({ id, order: i + 1, file: fileOf(osmId), name, par: 3, lengthYd: 150, theme: 'links' })),
    tiebreaks: [{ id: 'a1', order: 1, file: fileOf(861), name: 'HL Arena', par: 3, lengthYd: 120, theme: 'stadium' }],
  }));
  Object.assign(process.env, {
    BIRDIE_PORT: '0', BIRDIE_OC_PORT: '0', BIRDIE_NO_AUTOLOAD: '1', BIRDIE_NO_WATCH: '1', BIRDIE_ENRICH: '0', BIRDIE_SKY_PREFETCH: '0',
    BIRDIE_DATA_DIR: dataDir, BIRDIE_ART_DIR: path.join(dataDir, 'missing-art'), BIRDIE_PRODUCT: 'simclash',
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
  const seen = { shot: [], highlights: [], replay: [], 'swing-ignored': [] };
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
          if (seen[event]) seen[event].push(JSON.parse((/^data: (.*)$/m.exec(chunk) || [])[1]));
        }
      }
    } catch (_) { /* closed */ }
  })();
  const until = async (what, fn, ms = 8000) => {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 15));
    }
  };
  const matchAt = (...phases) => until(`the match in ${phases.join(' / ')}`, async () => { const { match } = await get('/api/match'); return match && phases.includes(match.phase) ? match : null; });
  const swing = (ball) => post('/api/test-shot', ball);

  try {
    // the reel starts empty, and says so in the shape the screen reads
    await until('the first highlights event', () => seen.highlights.length > 0);
    let r = await get('/api/highlights');
    assert.equal(r.ok, true);
    assert.deepEqual(r.highlights.last, { game: null, shots: [] });
    assert.deepEqual(r.highlights.night.shots, []);
    assert.equal(r.highlights.shotOfMatch, null);
    assert.deepEqual(seen.highlights[0].last.shots, []);
    r = await post('/api/highlights/play', { id: 'nope' });
    assert.deepEqual([r.status, r.ok, r.error], [404, false, 'No such highlight']);
    r = await post('/api/highlights/nonsense');
    assert.deepEqual([r.status, r.ok], [404, false]);

    // ----- a quick match on stage one. One player plays golf, the other dinks it down the fairway, so the
    // match is won by the golfer's own last shot: the match winner, a highlight whatever it was.
    const w = (await post('/api/players', { name: 'Wendy' })).player, l = (await post('/api/players', { name: 'Lou' })).player;
    r = await post('/api/match/start', { playerIds: [w.id, l.id], format: 'quick', stage: 's1', putting: 'easy' });
    assert.equal(r.ok, true, r.error);
    const matchId = r.match.id;
    await matchAt('intro');
    // a swing while the intro is up is nobody's shot, and the page is told (it skips a replay with it)
    await swing(swingForCarry(150));
    await until('swing-ignored', () => seen['swing-ignored'].length > 0);
    assert.deepEqual(seen['swing-ignored'][0], { by: 'match', phase: 'intro' });
    assert.equal(seen.shot.length, 0);
    await post('/api/match/ready');
    let m = await matchAt('play');
    for (let i = 0; i < 40 && m.phase === 'play'; i++) {
      const up = m.currentPlayerId;
      const p = m.players.find((x) => x.id === up);
      const before = seen.shot.length;
      if (up === l.id) await swing({ speed: 45, vla: 20, hla: 0, spin: 3000, spinAxis: 0 });   // 30 yd at a time
      else if (p.distToPinYd < 14) await swing({ speed: +(22 * Math.sqrt(Math.max(1.5, p.distToPinYd * 0.9) / 8)).toFixed(1), vla: 26, hla: 0, spin: 3000, spinAxis: 0 });   // a little chip (the fixture has no green: inside the tap-in circle it is given)
      else await swing(swingForCarry(p.distToPinYd * (p.distToPinYd > 60 ? 0.97 : 0.9)));
      if (process.env.HL_TRACE) console.log(i, up === l.id ? 'L' : 'W', p.strokes, p.distToPinYd, p.lie);
      await until('the shot', () => seen.shot.length > before);
      m = (await get('/api/match')).match;
    }
    assert.equal(m.phase, 'done', 'the match is over');
    assert.equal(m.winnerId, w.id, 'the golfer won it');
    const decider = seen.shot[seen.shot.length - 1];
    assert.equal(decider.match.event, 'match-over');
    assert.equal(decider.match.playerId, w.id);
    // the shot itself says it is one to see again, by itself (a match)
    assert.ok(decider.highlight, 'the deciding shot is marked');
    assert.ok(decider.highlight.why.includes('match-winner'), decider.highlight.why.join());
    assert.equal(decider.highlight.auto, true);
    assert.equal(typeof decider.highlight.title, 'string');
    // none of Lou's dinks is
    assert.ok(seen.shot.filter((s) => s.match && s.match.playerId === l.id).every((s) => !s.highlight));

    // the reel has it: the last match's list, the night's, the event, the file
    r = await get('/api/highlights');
    const reel = r.highlights;
    assert.deepEqual(reel.last.game, { id: matchId, kind: 'match', label: 'Quick Match' });
    const h = reel.last.shots.find((x) => x.id === decider.highlight.id);
    assert.ok(h, 'in the last match');
    assert.deepEqual(h.player, { id: w.id, name: 'Wendy', slot: 1 });
    assert.deepEqual(h.stage, { id: 's1', name: 'HL One', courseName: 'HL One' });
    assert.equal(h.matchId, matchId);
    assert.equal(h.sim, undefined, 'the lists carry no path');
    assert.ok(reel.night.shots.some((x) => x.id === h.id));
    assert.equal(reel.night.current, true);
    assert.ok(seen.highlights.some((s) => s.last.shots.some((x) => x.id === h.id)), 'the event went out');
    const disk = JSON.parse(fs.readFileSync(path.join(dataDir, 'highlights.json'), 'utf8'));
    assert.equal(disk.version, 1);
    assert.ok(disk.night.shots.some((x) => x.id === h.id && x.sim.points.length >= 2));
    assert.ok(fs.statSync(path.join(dataDir, 'highlights.json')).size < 200000);
    // the shot of the match: when the engine gave the award, the reel names that very shot
    const award = (m.awards || []).find((a) => a.id === 'shot-of-the-match');
    if (award) {
      assert.equal(reel.shotOfMatch.matchId, matchId);
      const s = reel.last.shots.find((x) => x.id === reel.shotOfMatch.id);
      assert.ok(s && s.shotOfMatch === true && s.points === award.points && s.player.id === award.playerId, 'the award\'s shot');
    } else assert.equal(reel.shotOfMatch, null);

    // ----- play it back. The match is over but still on its winner screen; its stage is in the bay: no load
    r = await post('/api/highlights/play', { id: h.id, camera: 'greenside' });
    assert.deepEqual([r.status, r.ok, r.playing, r.loaded], [200, true, h.id, false]);
    assert.equal(r.highlights.last.shots.length, reel.last.shots.length, 'the answer carries the reel');
    await until('the replay event', () => seen.replay.length > 0);
    const rp = seen.replay[0];
    assert.equal(rp.id, h.id);
    assert.equal(rp.camera, 'greenside');
    assert.equal(rp.loaded, false);
    assert.ok(Array.isArray(rp.highlight.sim.points) && rp.highlight.sim.points.length >= 2 && rp.highlight.sim.points[0].length === 4, 'the whole path');
    assert.deepEqual(rp.highlight.hole.pin, [0, 137.2]);
    assert.equal(rp.highlight.stage.file, fileOf(841));
    assert.ok(rp.highlight.from && Number.isFinite(rp.highlight.from.x));
    assert.equal((await get('/api/match')).match.phase, 'done', 'the finished match is still there');
    r = await post('/api/highlights/play', { id: h.id, camera: 'sideways' });
    assert.equal(r.ok, true);
    await until('the second replay event', () => seen.replay.length > 1);
    assert.equal(seen.replay[1].camera, null, 'an unknown camera is the director\'s choice');

    // ----- another game has the bay on another stage: the reel does not take it away
    await post('/api/match/abort');
    r = await post('/api/match/start', { playerIds: [w.id, l.id], format: 'quick', stage: 's2' });
    assert.equal(r.ok, true, r.error);
    await matchAt('intro');
    r = await post('/api/highlights/play', { id: h.id });
    assert.deepEqual([r.status, r.ok], [409, false]);
    assert.match(r.error, /match is in play/i);
    await post('/api/match/abort');
    r = await post('/api/solo/start', { kind: 'stage', stage: 's2' });
    assert.equal(r.ok, true, r.error);
    await until('the solo stage', async () => (await get('/api/solo')).run?.phase === 'play');
    r = await post('/api/highlights/play', { id: h.id });
    assert.deepEqual([r.status, r.ok], [409, false]);
    assert.match(r.error, /solo game is in play/i);
    assert.equal((await get('/api/state')).courseName, 'HL Two');
    // nothing is being played: now it loads the shot's stage, then sends the replay
    await post('/api/solo/abort');
    const n = seen.replay.length;
    r = await post('/api/highlights/play', { id: h.id });
    assert.deepEqual([r.status, r.ok, r.loaded], [200, true, true]);
    assert.equal((await get('/api/state')).courseName, 'HL One', 'its stage is back in the bay');
    await until('the replay after the load', () => seen.replay.length > n);
    assert.equal(seen.replay[n].loaded, true);

    // ----- outside a match a notable shot is only offered: a hole-out handed to the mode as the server hands it every shot
    const mode = server.modes.find((x) => x.id === 'highlights');
    assert.equal(mode.active, false, 'it never owns a swing');
    const st = await get('/api/state');
    const fake = {
      shotId: 9001, holed: true, strokes: 2, lie: 'green', distToPinYd: 0,
      launch: { speedMph: 80, vla: 25, hla: 0, totalSpin: 8000, spinAxis: 0 },
      sim: { isPutt: false, flightTime: 2, carryYd: 90, totalYd: 95, events: [{ type: 'holed', t: 4 }], points: [{ t: 0, x: 0, y: 50, z: 0 }, { t: 2, x: 0, y: 130, z: 0 }, { t: 4, x: 0, y: 137.2, z: 0 }] },
    };
    mode.onShot(fake, { before: { ...st, distToPinYd: 95, ball: { x: 0, y: 50 } }, match: null, solo: null, mode: null });
    assert.deepEqual(fake.highlight.why, ['hole-out']);
    assert.equal(fake.highlight.auto, false);
    assert.equal(fake.highlight.title, 'HOLED FROM 95 YD');
    r = await get('/api/highlights');
    assert.equal(r.highlights.last.game.kind, 'free', 'a new game: the last list starts over');
    assert.deepEqual(r.highlights.last.shots.map((x) => x.id), [fake.highlight.id]);
    assert.ok(r.highlights.night.shots.some((x) => x.id === h.id) && r.highlights.night.shots.some((x) => x.id === fake.highlight.id), 'the night keeps both');
    assert.deepEqual(r.highlights.night.shots.map((x) => x.score), r.highlights.night.shots.map((x) => x.score).sort((a, b) => b - a), 'best first');
    // a practice game's balls and a shot with no path are not looked at
    const dull = { ...fake, shotId: 9002 };
    delete dull.highlight;
    mode.onShot(dull, { before: { ...st, practice: { mode: 'closest' } }, match: null });
    assert.equal(dull.highlight, undefined);

    // ----- remove, clear
    r = await post('/api/highlights/remove', { id: 'nope' });
    assert.deepEqual([r.status, r.ok], [404, false]);
    r = await post('/api/highlights/remove', { id: fake.highlight.id });
    assert.equal(r.ok, true);
    assert.equal(r.highlights.night.shots.some((x) => x.id === fake.highlight.id), false);
    r = await post('/api/highlights/clear', { which: 'all' });
    assert.deepEqual([r.ok, r.cleared, r.highlights.last.shots.length, r.highlights.night.shots.length], [true, 'all', 0, 0]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'highlights.json'), 'utf8')).night.shots, []);
    r = await post('/api/highlights/play', { id: h.id });
    assert.equal(r.status, 404, 'gone with the list');
  } finally {
    sse.abort();
    server.close();
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* in use */ }
  }
});
