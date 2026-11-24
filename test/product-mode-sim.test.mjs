// The product switch, the other way: BIRDIE_PRODUCT=open-birdie is the original simulator,
// unchanged. The same data dir as test/product-mode.test.mjs (two arcade stages and a real
// course that sorts first): here the server boots onto the real course, lists it in the
// course library, loads it on request, keeps its leagues, and a page that never names a
// screen holds no swing gate. (No search, no download and no scenery fetch is made: that
// would leave this machine; the routes are only shown to be the simulator's own.)
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
const fileOf = (osmId) => `osm-way-${osmId}.json`;
const STAGE = { theme: 'links', formatVersion: 2, wind: { min: 0, max: 0 } };

test('a simulator server: real courses, the library and leagues are all still there', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-product-sim-'));
  fs.mkdirSync(path.join(dataDir, 'courses'));
  fs.writeFileSync(path.join(dataDir, 'courses', fileOf(100)), JSON.stringify(course(100, 'Real Links Golf Club')));
  fs.writeFileSync(path.join(dataDir, 'courses', fileOf(701)), JSON.stringify(course(701, 'Stage One', STAGE)));
  fs.writeFileSync(path.join(dataDir, 'arcade-tour.json'), JSON.stringify({
    version: 1, stages: [{ id: 's1', order: 1, file: fileOf(701), name: 'Stage One', par: 3, lengthYd: 150, theme: 'links' }], tiebreaks: [],
  }));
  for (const k of ['BIRDIE_NO_AUTOLOAD', 'BIRDIE_CLOUD_URL']) delete process.env[k];
  Object.assign(process.env, {
    BIRDIE_PRODUCT: 'open-birdie',
    BIRDIE_PORT: '0', BIRDIE_OC_PORT: '0', BIRDIE_NO_WATCH: '1', BIRDIE_ENRICH: '0', BIRDIE_SKY_PREFETCH: '0', BIRDIE_FORESIGHT: 'off',
    BIRDIE_DATA_DIR: dataDir, BIRDIE_ART_DIR: path.join(dataDir, 'missing-art'),
  });
  const server = require('../server.js');
  const { httpPort } = await server.ready;
  const base = `http://127.0.0.1:${httpPort}`;
  const get = (p) => fetch(base + p).then((r) => r.json());
  const post = async (p, body = {}) => {
    const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, ...(await r.json()) };
  };
  try {
    assert.equal(server.productMode, 'open-birdie');
    assert.equal((await get('/api/product')).mode, 'open-birdie');
    const boot = await (await fetch(`${base}/product.js`)).text();
    assert.match(boot, /"mode":"open-birdie"/);                 // the page follows the server: no title screen, no boot cover drawn

    // boots onto the first cached course, as it always did: the real one
    assert.equal((await get('/api/state')).courseName, 'Real Links Golf Club');
    // the course library lists what is downloaded, real course and stage alike
    const lib = await get('/api/courses');
    assert.ok(lib.courses.some((c) => c.name === 'Real Links Golf Club'));
    assert.ok((await get('/api/courses/cached')).length >= 2);
    // a real course loads on request, and so does a stage
    assert.equal((await post('/api/load-course', { cached: fileOf(701) })).ok, true);
    assert.equal((await get('/api/state')).courseName, 'Stage One');
    const real = await post('/api/load-course', { cached: fileOf(100), name: 'Real Links Golf Club' });
    assert.equal(real.status, 200);
    assert.equal(real.ok, true);
    assert.equal((await get('/api/state')).courseName, 'Real Links Golf Club');
    // leagues are the simulator's
    const pl = await post('/api/players', { name: 'Ada' });
    assert.equal(pl.ok, true);
    const lg = await post('/api/leagues', { name: 'Tuesday', playerIds: [pl.player.id], weeks: [{ course: { name: 'Real Links Golf Club', cached: fileOf(100) } }] });
    assert.notEqual(lg.status, 404);
    assert.notEqual(lg.code, 'PRODUCT');
    // no page has named a screen: a swing is a shot (the gate is the game front end's, and only when it says so)
    await post('/api/test-shot', { speed: 106, vla: 20, hla: 0, spin: 6900, spinAxis: 0 });
    assert.equal((await get('/api/state')).strokes, 1);
    // the round's own routes are untouched by solo play, which nobody started
    assert.equal((await get('/api/solo')).run, null);
    assert.equal((await post('/api/mulligan', {})).ok, true);
    assert.equal((await get('/api/state')).strokes, 0);
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
