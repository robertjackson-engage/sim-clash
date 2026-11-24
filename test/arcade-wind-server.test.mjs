// Wind per hole, the server's side (server.js "v2:wind", lib/arcade-wind.js): a real server
// in this process on a throwaway data dir with hand-made stage courses, driven over HTTP.
// Solo play on an arcade stage rolls a wind (and a restart / next hole rolls again), a real
// course keeps the day's conditions, a best of three rolls one wind per hole and arena onto
// the game's conditions and into stage.wind, a 7-iron drifts the way the wind says, and the
// day's conditions (and conditions.json) come through it all untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const course = (osmId, name, arcade = null, pin = [0, 137.2]) => ({
  version: 4, name,
  source: { courseId: `osm:way:${osmId}`, osmType: 'way', osmId },
  origin: { lat: 47, lon: -122 },
  surfaces: [], boundary: null, elevation: null,
  holes: [{ ref: 1, par: 3, tee: [0, 0], pin, line: [[0, 0], pin], lengthYd: 150 }],
  ...(arcade ? { arcade } : {}),
});
const STAGES = [
  ['s1', 901, 'Wind One', { theme: 'links', formatVersion: 2, conditions: 'windy' }],
  ['s2', 902, 'Wind Two', { theme: 'canyon', formatVersion: 2, conditions: 'calm', wind: { min: 14, max: 20 } }],
  ['s3', 903, 'Wind Three', { theme: 'neon', formatVersion: 2, conditions: 'windy' }],
];
const ARENA = ['a1', 921, 'Wind Arena', { theme: 'stadium', formatVersion: 2, role: 'tiebreak', wind: { min: 8, max: 12 } }];
const fileOf = (osmId) => `osm-way-${osmId}.json`;

test('the server rolls a wind for every arcade hole, plays it, and gives the day\'s conditions back', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-wind-'));
  fs.mkdirSync(path.join(dataDir, 'courses'));
  for (const [, osmId, name, arcade] of [...STAGES, ARENA]) fs.writeFileSync(path.join(dataDir, 'courses', fileOf(osmId)), JSON.stringify(course(osmId, name, arcade)));
  fs.writeFileSync(path.join(dataDir, 'courses', fileOf(950)), JSON.stringify(course(950, 'Real Links')));
  const manifestEntry = ([id, osmId, name, arcade], i) => ({ id, order: i + 1, file: fileOf(osmId), name, par: 3, lengthYd: 150, theme: arcade.theme, ...(arcade.wind ? { wind: arcade.wind } : {}) });
  fs.writeFileSync(path.join(dataDir, 'arcade-tour.json'), JSON.stringify({ version: 1, stages: STAGES.map(manifestEntry), tiebreaks: [manifestEntry(ARENA, 0)] }));
  Object.assign(process.env, {
    BIRDIE_PORT: '0', BIRDIE_OC_PORT: '0', BIRDIE_NO_AUTOLOAD: '1', BIRDIE_NO_WATCH: '1', BIRDIE_ENRICH: '0', BIRDIE_SKY_PREFETCH: '0',
    BIRDIE_DATA_DIR: dataDir, BIRDIE_ART_DIR: path.join(dataDir, 'missing-art'), BIRDIE_WIND_SEED: '20261122',
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
  const saved = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'conditions.json'), 'utf8')).conditions;
  const windOf = (c) => [c.windMph, c.windFromDeg];
  const I7 = { speed: 111, vla: 19, hla: 0, spin: 7000, spinAxis: 0 };
  const DINK = { speed: 8, vla: 10, hla: 0, spin: 1000, spinAxis: 0 };
  const matchAt = async (...phases) => {
    for (let i = 0; i < 400; i++) {
      const { match } = await get('/api/match');
      if (match && phases.includes(match.phase)) return match;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`the match never reached ${phases.join(' / ')}`);
  };

  try {
    // ----- the day's conditions, on a real course
    assert.equal((await post('/api/conditions', { preset: 'windy', greenStimp: 11 })).ok, true);
    const day = (await get('/api/conditions')).conditions;
    assert.deepEqual([windOf(day), day.greenStimp], [[16, 270], 11]);
    assert.equal((await post('/api/load-course', { cached: fileOf(950) })).ok, true);
    let c = await get('/api/conditions');
    assert.deepEqual([c.conditions, c.stageWind, c.day], [day, null, null], 'a real course: the day\'s conditions, nothing rolled');
    await post('/api/reset');
    await post('/api/next-hole');
    assert.deepEqual((await get('/api/state')).conditions, day, 'restart and next hole leave a real course alone');

    // ----- solo play on an arcade stage: a rolled wind; restart and next hole roll again
    assert.equal((await post('/api/load-course', { cached: fileOf(902) })).ok, true);
    c = await get('/api/conditions');
    const solo1 = c.stageWind;
    assert.ok(solo1 && solo1.rolled && solo1.mph >= 14 && solo1.mph <= 20, `rolled inside 14 to 20: ${solo1 && solo1.mph}`);
    assert.deepEqual([solo1.min, solo1.max], [14, 20]);
    assert.deepEqual(windOf(c.conditions), [solo1.mph, solo1.dirDeg], 'the game plays it');
    assert.deepEqual([c.conditions.gustMph, c.conditions.tempF, c.conditions.greenStimp], [0, 70, 10.5], 'steady, in standard air');
    assert.deepEqual(c.day, day, 'the day\'s conditions are held aside');
    assert.deepEqual(windOf((await get('/api/state')).conditions), [solo1.mph, solo1.dirDeg], 'GET /api/state: what the HUD\'s wind dial shows');
    assert.equal((await get('/api/course-geometry')).arcade.theme, 'canyon');
    await post('/api/reset');
    const solo2 = (await get('/api/conditions')).stageWind;
    await post('/api/next-hole');
    const solo3 = (await get('/api/conditions')).stageWind;
    assert.equal(new Set([solo1, solo2, solo3].map((w) => `${w.mph}/${w.dirDeg}`)).size, 3, 'three different winds');
    for (const w of [solo2, solo3]) assert.ok(w.mph >= 14 && w.mph <= 20);
    assert.deepEqual(windOf((await get('/api/state')).conditions), [solo3.mph, solo3.dirDeg]);
    // a change by hand while a rolled wind is in force is kept as the day's, without the roll
    assert.equal((await post('/api/conditions', { greenStimp: 12 })).ok, true);
    assert.deepEqual(saved(), { ...saved(), windMph: 16, windFromDeg: 270, greenStimp: 12 }, 'conditions.json: the day\'s wind, never the rolled one');
    const day2 = { ...day, greenStimp: 12 };

    // ----- a best of three: one wind per hole and per arena, on the game and in stage.wind
    const a = (await post('/api/players', { name: 'Alex' })).player, b = (await post('/api/players', { name: 'Dave' })).player;
    const started = await post('/api/match/start', { playerIds: [a.id, b.id], format: 'bo3', powerups: 'off' });
    assert.equal(started.ok, true, started.error);
    const loading = started.match;
    assert.deepEqual([loading.phase, loading.stage.id, loading.stage.wind], ['loading', 's1', null], 'hole one\'s manifest entry has no wind: nothing to show before the roll');
    const seen = [];
    let checkedDrift = 0;
    for (let hole = 1; hole <= 3; hole++) {
      let m = await matchAt('intro');
      const w = m.stage.wind;
      assert.deepEqual([m.stage.id, m.stage.kind, m.holeNumber], [`s${hole}`, 'match', hole]);
      assert.ok(w && w.rolled && Number.isInteger(w.mph) && w.mph >= w.min && w.mph <= w.max, `hole ${hole}: ${JSON.stringify(w)}`);
      assert.deepEqual([w.min, w.max], hole === 2 ? [14, 20] : [12, 22]);
      assert.match(w.label, new RegExp(`^${w.mph} MPH`));
      let st = await get('/api/state');
      assert.deepEqual(windOf(st.conditions), [w.mph, w.dirDeg], `hole ${hole}: GET /api/state plays stage.wind`);
      assert.deepEqual((await get('/api/conditions')).stageWind, w);
      seen.push(w);
      // tee off: a dead-straight 7-iron by whoever has the honour, on a hole played due north
      m = (await post('/api/match/ready')).match;
      assert.equal(m.phase, 'play');
      const shooter = m.currentPlayerId;
      await post('/api/test-shot', I7);
      m = (await get('/api/match')).match;
      const ball = m.players.find((p) => p.id === shooter).ball;
      if (Math.abs(w.crossMph) >= 3) {
        checkedDrift++;
        assert.equal(Math.sign(ball.x), Math.sign(w.crossMph), `hole ${hole}: ${w.label} (${w.crossMph} mph across) moved the ball ${ball.x.toFixed(1)} m`);
        assert.ok(Math.abs(ball.x) > 0.6 * Math.abs(w.crossMph), `by a real amount (a 7-iron moves over a metre for every mph across): ${ball.x.toFixed(1)} m for ${w.crossMph} mph`);
      }
      assert.deepEqual(m.stage.wind, w, 'the same wind after the shot');
      // nobody holes out: both run into the stroke limit, the hole is tied, sudden death on the arena
      for (let i = 0; i < 20 && m.phase === 'play'; i++) { await post('/api/test-shot', DINK); m = (await get('/api/match')).match; }
      assert.deepEqual([m.phase, m.lastResult.reason, m.nextStage.kind], ['hole-result', 'tied', 'tiebreak']);
      assert.deepEqual([m.nextStage.wind.mph, m.nextStage.wind.min, m.nextStage.wind.max, m.nextStage.wind.label], [null, 8, 12, '8 TO 12 MPH'], 'the arena to come: its range, the roll is not in yet');
      assert.deepEqual(m.stage.wind, w, 'the hole just played keeps its wind on the result screen');
      await post('/api/match/continue');
      m = await matchAt('intro');
      const aw = m.stage.wind;
      assert.deepEqual([m.stage.id, m.stage.kind, aw.rolled, aw.min, aw.max], ['a1', 'tiebreak', true, 8, 12]);
      assert.ok(aw.mph >= 8 && aw.mph <= 12);
      st = await get('/api/state');
      assert.deepEqual(windOf(st.conditions), [aw.mph, aw.dirDeg], 'the arena plays its own wind');
      seen.push(aw);
      // player one wins holes 1 and 3, player two hole 2: whoever is to win hits the green
      m = (await post('/api/match/ready')).match;
      const winner = hole === 2 ? b.id : a.id;
      for (let i = 0; i < 2; i++) {
        await post('/api/test-shot', m.currentPlayerId === winner ? I7 : DINK);
        m = (await get('/api/match')).match;
      }
      assert.equal(m.lastResult.winnerId, winner, `hole ${hole} to ${winner === a.id ? 'Alex' : 'Dave'}`);
      if (hole < 3) {
        assert.deepEqual([m.phase, m.nextStage.id], ['hole-result', `s${hole + 1}`]);
        await post('/api/match/continue');
      }
    }
    assert.equal(new Set(seen.map((w) => `${w.mph}/${w.dirDeg}`)).size, 6, `three holes and three arena visits, six different winds: ${seen.map((w) => w.label).join(' | ')}`);
    assert.ok(checkedDrift >= 2, 'the drift was checked on at least two holes');

    // ----- the match is over and dropped
    let done = (await get('/api/match')).match;
    assert.deepEqual([done.phase, done.winnerId], ['done', a.id]);
    assert.equal((await post('/api/match/abort')).match, null);
    c = await get('/api/conditions');
    // the bay is left on the last arena, in solo play: like any arcade stage it has a wind of its own
    assert.ok(c.stageWind && c.stageWind.rolled && c.stageWind.mph >= 8 && c.stageWind.mph <= 12);
    assert.notDeepEqual([c.stageWind.mph, c.stageWind.dirDeg], [seen[5].mph, seen[5].dirDeg], 'a fresh hole, a fresh wind');
    assert.deepEqual(c.day, day2, 'the day\'s conditions are still there, aside');
    // ... and are back, exactly, with the first course that is not an arcade stage
    assert.equal((await post('/api/load-course', { cached: fileOf(950) })).ok, true);
    c = await get('/api/conditions');
    assert.deepEqual([c.conditions, c.stageWind, c.day], [day2, null, null]);
    assert.deepEqual((await get('/api/state')).conditions, day2);
    assert.deepEqual(saved(), { ...saved(), windMph: 16, windFromDeg: 270, greenStimp: 12 });

    // ----- a match on a real course ('current'): nothing rolled, the day's wind read for the hole
    const cur = await post('/api/match/start', { playerIds: [a.id, b.id], format: 'quick', stage: 'current' });
    assert.equal(cur.ok, true, cur.error);
    assert.deepEqual([cur.match.phase, cur.match.stage.wind.label, cur.match.stage.wind.rolled, cur.match.stage.wind.min], ['intro', '16 MPH · LEFT TO RIGHT', false, null]);
    assert.deepEqual((await get('/api/state')).conditions, day2);
    await post('/api/match/abort');
    assert.deepEqual((await get('/api/conditions')).conditions, day2, 'dropped: the day\'s conditions as they were');

    // ----- a match that starts on the stage already in the bay still gets its roll
    await post('/api/load-course', { cached: fileOf(901) });
    const before = (await get('/api/conditions')).stageWind;
    const again = await post('/api/match/start', { playerIds: [a.id, b.id], format: 'quick', stage: 's1', powerups: 'off' });
    assert.equal(again.ok, true, again.error);
    const m1 = await matchAt('intro');
    assert.ok(m1.stage.wind.rolled);
    assert.notDeepEqual([m1.stage.wind.mph, m1.stage.wind.dirDeg], [before.mph, before.dirDeg], 'rolled for the match, not left over from solo play');
    assert.deepEqual(windOf((await get('/api/state')).conditions), [m1.stage.wind.mph, m1.stage.wind.dirDeg]);
    await post('/api/match/abort');
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
