// The product switch (lib/product-mode.js, server.js "v2:shell"): the GAME, which is what a
// server is unless it is told otherwise.
//
// The pure part first: the mode from the environment, which courses the game accepts, the
// stage it boots onto, the swing gate. Then a real server in this process, as the game, on
// a throwaway data dir that holds two arcade stages AND a real course, with a cloud address
// and nothing turned off in the environment: it boots onto a stage, refuses the real course
// and every search or download, drops a swing while the front end is in its menus, plays a
// solo tour to a stored best score, and in all of that never opens a connection to anything
// but this machine. (The simulator product: test/product-mode-sim.test.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { testSwing } from '../public/arcade/shell-core.js';

const require = createRequire(import.meta.url);
const { productMode, isArcadeCourse, courseRefusal, bootStage, createShellGate } = require('../lib/product-mode');

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

test('the mode: the game unless BIRDIE_PRODUCT names the simulator', () => {
  // under the test runner an unnamed product is the simulator (the upstream suites); a named one is what it says
  assert.equal(productMode({ NODE_TEST_CONTEXT: 'child-v8' }), 'open-birdie');
  assert.equal(productMode({ NODE_TEST_CONTEXT: 'child-v8', BIRDIE_PRODUCT: 'simclash' }), 'simclash');
  assert.equal(productMode({ NODE_TEST_CONTEXT: 'child-v8', BIRDIE_PRODUCT: 'open-birdie' }), 'open-birdie');
  assert.equal(productMode({}), 'simclash');
  assert.equal(productMode({ BIRDIE_PRODUCT: '' }), 'simclash');
  assert.equal(productMode({ BIRDIE_PRODUCT: 'simclash' }), 'simclash');
  assert.equal(productMode({ BIRDIE_PRODUCT: 'anything-else' }), 'simclash');
  assert.equal(productMode({ BIRDIE_PRODUCT: 'open-birdie' }), 'open-birdie');
  assert.equal(productMode({ BIRDIE_PRODUCT: ' Open-Birdie ' }), 'open-birdie');
  assert.equal(productMode({ BIRDIE_PRODUCT: 'simulator' }), 'open-birdie');
});

test('the game accepts a stage that is on disk, and nothing that means a search or a download', () => {
  const files = { 'stage.json': course(1, 'Stage', STAGE), 'real.json': course(2, 'Real Links') };
  const loadCached = (f) => files[f] || null;
  assert.equal(isArcadeCourse(files['stage.json']), true);
  assert.equal(isArcadeCourse(files['real.json']), false);
  assert.equal(isArcadeCourse({ arcade: {} }), false);
  assert.equal(isArcadeCourse({ arcade: { theme: '  ' } }), false);
  assert.equal(isArcadeCourse(null), false);

  assert.equal(courseRefusal({ cached: 'stage.json' }, { loadCached }), null);
  assert.equal(courseRefusal({ cached: 'real.json' }, { loadCached }).code, 'PRODUCT_COURSE_REFUSED');
  assert.match(courseRefusal({ cached: 'real.json' }, { loadCached }).message, /real course/);
  assert.match(courseRefusal({ cached: 'missing.json' }, { loadCached }).message, /No such stage/);
  assert.match(courseRefusal({ cached: '../stage.json' }, { loadCached }).message, /No such stage/);
  // an OSM id, a bounding box, a name: refused before the cache is even looked at
  let looked = 0;
  const spy = (f) => { looked++; return loadCached(f); };
  for (const req of [{ osmType: 'way', osmId: 5 }, { name: 'Pebble Beach', bbox: [0, 0, 1, 1] }, { source: { osmType: 'way', osmId: 5 } }, {}, null]) {
    assert.match(courseRefusal(req, { loadCached: spy }).message, /no course search or download/);
  }
  assert.equal(looked, 0);
  assert.match(courseRefusal({ cached: 'stage.json' }, { loadCached: () => { throw new Error('disk'); } }).message, /No such stage/);
});

test('the game boots onto the first tour stage that is really there, never a real course', () => {
  const files = { 'a.json': course(1, 'A', STAGE), 'b.json': course(2, 'B', STAGE), 'real.json': course(3, 'Real') };
  const loadCached = (f) => files[f] || null;
  const cached = [{ file: 'real.json' }, { file: 'b.json' }, { file: 'a.json' }];
  const tour = { stages: [{ id: 'b', order: 2, file: 'b.json' }, { id: 'gone', order: 0, file: 'gone.json' }, { id: 'a', order: 1, file: 'a.json' }] };
  assert.equal(bootStage({ tour, cached, loadCached }), 'a.json');            // tour order, the missing one skipped
  assert.equal(bootStage({ tour: null, cached, loadCached }), 'b.json');     // no tour: the first arcade course in the cache
  assert.equal(bootStage({ tour: null, cached: [{ file: 'real.json' }], loadCached }), null);   // only real courses: nothing
  assert.equal(bootStage({}), null);
});

test('the swing gate belongs to the page that spoke last, and opens when that page goes', () => {
  const gate = createShellGate();
  assert.equal(gate.closed, false);                       // nobody has said anything: swings are played
  assert.deepEqual(gate.set('c1', 'menu'), { inMenu: true, cid: 'c1' });
  assert.equal(gate.closed, true);
  gate.set('c1', 'game');
  assert.equal(gate.closed, false);
  gate.set('c1', 'menu');
  gate.set('c2', 'game');                                 // a second page in play speaks last
  assert.equal(gate.closed, false);
  gate.set('c1', 'menu');
  gate.drop('c2');                                        // not the holder: nothing changes
  assert.equal(gate.closed, true);
  gate.drop('c1');                                        // the page in the menus closed: nobody is locked out
  assert.equal(gate.closed, false);
  assert.deepEqual(gate.set('', 'menu'), { inMenu: false, cid: null });   // no id, no say
  gate.set('c3', 'anything');
  assert.equal(gate.closed, false);                       // only 'menu' closes it
});

test('a game server with no stage of its own still starts: no course in the bay, nothing pending', () => {
  // only a real course in the cache (a data dir left behind by the simulator): the game must not load it, and must not wait for it
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-product-empty-'));
  fs.mkdirSync(path.join(dataDir, 'courses'));
  fs.writeFileSync(path.join(dataDir, 'courses', fileOf(100)), JSON.stringify(course(100, 'Real Links Golf Club')));
  const script = `
    (async () => {
      const server = require('./server.js');
      const ready = await server.ready;
      const state = await fetch('http://127.0.0.1:' + ready.httpPort + '/api/state').then((r) => r.json());
      const load = await fetch('http://127.0.0.1:' + ready.httpPort + '/api/load-course', { method: 'POST', body: JSON.stringify({ cached: ${JSON.stringify(fileOf(100))} }) });
      const solo = await fetch('http://127.0.0.1:' + ready.httpPort + '/api/solo/start', { method: 'POST', body: JSON.stringify({ kind: 'tour' }) });
      const soloError = (await solo.json()).error;
      server.close();
      console.log('__RESULT__' + JSON.stringify({ mode: server.productMode, loaded: state.loaded, load: load.status, solo: solo.status, soloError }));
      setTimeout(() => process.exit(0), 20);
    })().catch((error) => { console.error(error); process.exit(1); });`;
  let out;
  try {
    out = execFileSync(process.execPath, ['-e', script], {
      cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), encoding: 'utf8', timeout: 30000,   // a boot that waits for ever fails here, it does not hang the suite
      env: { ...process.env, BIRDIE_PRODUCT: 'simclash', BIRDIE_PORT: '0', BIRDIE_OC_PORT: '0', BIRDIE_NO_WATCH: '1', BIRDIE_DATA_DIR: dataDir, BIRDIE_ART_DIR: path.join(dataDir, 'missing-art') },
    });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  const line = out.split(/\r?\n/).find((l) => l.startsWith('__RESULT__'));
  assert.ok(line, out);
  assert.deepEqual(JSON.parse(line.slice('__RESULT__'.length)), { mode: 'simclash', loaded: false, load: 403, solo: 409, soloError: 'No stage to play: the stages are not installed' });
});

test('a game server: its own stages only, the menus drop swings, solo keeps a best score, no outbound request', async () => {
  // every TCP connection this process opens, loopback or not (node's fetch goes through here too)
  const outbound = [];
  const realConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function connect(...args) {
    const o = args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) ? args[0] : (Array.isArray(args[0]) && args[0][0] && typeof args[0][0] === 'object' ? args[0][0] : { port: args[0], host: args[1] });
    const host = String(o.host || o.path || 'localhost');
    if (!/^(127\.0\.0\.1|localhost|::1|\[::1\])$/.test(host) && !o.path) outbound.push(`${host}:${o.port}`);
    return realConnect.apply(this, args);
  };
  const realFetch = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = (url, init) => { const u = String(url && url.url ? url.url : url); if (!/^http:\/\/127\.0\.0\.1[:/]/.test(u)) fetched.push(u); return realFetch(url, init); };

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-product-'));
  fs.mkdirSync(path.join(dataDir, 'courses'));
  // the real course sorts FIRST in the cache: the simulator would boot onto it
  fs.writeFileSync(path.join(dataDir, 'courses', fileOf(100)), JSON.stringify(course(100, 'Real Links Golf Club')));
  fs.writeFileSync(path.join(dataDir, 'courses', fileOf(701)), JSON.stringify(course(701, 'Stage One', STAGE)));
  fs.writeFileSync(path.join(dataDir, 'courses', fileOf(702)), JSON.stringify(course(702, 'Stage Two', STAGE, [0, 91.4])));
  fs.writeFileSync(path.join(dataDir, 'arcade-tour.json'), JSON.stringify({
    version: 1,
    stages: [[701, 's1', 'Stage One'], [702, 's2', 'Stage Two']].map(([osmId, id, name], i) => ({ id, order: i + 1, file: fileOf(osmId), name, par: 3, lengthYd: 150, theme: 'links' })),
    // a manifest gone wrong: an "arena" that is really the real course
    tiebreaks: [{ id: 'bad', order: 1, file: fileOf(100), name: 'Not A Stage', par: 3, lengthYd: 150, theme: 'links' }],
  }));
  for (const k of ['BIRDIE_NO_AUTOLOAD', 'BIRDIE_ENRICH', 'BIRDIE_SKY_PREFETCH', 'BIRDIE_SKY_FETCH']) delete process.env[k];   // nothing switched off by hand
  Object.assign(process.env, {
    BIRDIE_PRODUCT: 'simclash',   // said out loud: under the test runner an unnamed product is the simulator (lib/product-mode.js)
    BIRDIE_PORT: '0', BIRDIE_OC_PORT: '0', BIRDIE_NO_WATCH: '1', BIRDIE_FORESIGHT: 'off',
    BIRDIE_DATA_DIR: dataDir, BIRDIE_ART_DIR: path.join(dataDir, 'missing-art'),
    BIRDIE_CLOUD_URL: 'https://cloud.example.invalid', BIRDIE_WIND_SEED: 'product',   // a cloud is named: the game must ignore it
  });
  const server = require('../server.js');
  const { httpPort } = await server.ready;
  const base = `http://127.0.0.1:${httpPort}`;
  const get = (p) => realFetch(base + p).then((r) => r.json());
  const raw = (p) => realFetch(base + p);
  const post = async (p, body = {}) => {
    const r = await realFetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, ...(await r.json()) };
  };
  // one page's event stream: its id, and every event by name
  const openStream = () => {
    const seen = { hello: null, events: [] };
    const ctl = new AbortController();
    const ready = new Promise((resolve) => {
      (async () => {
        try {
          const res = await realFetch(`${base}/events`, { signal: ctl.signal });
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) return;
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, i); buf = buf.slice(i + 2);
              const name = (/^event: (.*)$/m.exec(block) || [])[1];
              const data = (/^data: (.*)$/m.exec(block) || [])[1];
              let json = null;
              try { json = JSON.parse(data); } catch (_) { /* not json */ }
              seen.events.push([name, json]);
              if (name === 'hello') { seen.hello = json; resolve(); }
            }
          }
        } catch (_) { /* aborted */ }
      })();
    });
    return { seen, ready, close: () => ctl.abort() };
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const swing = { speed: 106, vla: 20, hla: 0, spin: 6900, spinAxis: 0 };

  try {
    assert.equal(server.productMode, 'simclash');
    assert.equal(server.sceneryEnricher, null);                               // no background scenery, though nothing turned it off

    // ---- it booted onto a stage, not onto the real course that sorts first
    let st = await get('/api/state');
    assert.equal(st.loaded, true);
    assert.equal(st.courseName, 'Stage One');

    // ---- the page's bootstrap and the product
    const info = await get('/api/product');
    assert.equal(info.mode, 'simclash');
    assert.equal(typeof info.name, 'string');
    assert.ok(Array.isArray(info.wordmark) && info.wordmark.length >= 1);
    const boot = await (await raw('/product.js')).text();
    assert.match(boot, /window\.__PRODUCT__=p/);
    assert.match(boot, /sc-boot/);                                            // the boot cover is drawn before any module loads
    assert.ok(boot.includes(JSON.stringify(info.name).slice(1, -1)));         // the name comes from the one product file

    // ---- no real-course feature answers
    const search = await raw('/api/search?q=pebble');
    assert.equal(search.status, 404);
    assert.equal((await search.json()).code, 'PRODUCT');
    assert.deepEqual(await get('/api/courses'), { courses: [], featured: [] });
    assert.deepEqual(await get('/api/courses/cached'), []);
    assert.equal((await raw('/sky/kloppenheim_06_puresky_4k.hdr')).status, 404);   // not on disk: not fetched
    assert.equal((await get('/api/google-tiles-config')).enabled, false);
    assert.equal((await post('/api/leagues', { name: 'Tuesday' })).status, 404);

    // ---- it refuses a non-arcade course, whichever way it is asked for
    for (const body of [{ cached: fileOf(100), name: 'Real Links Golf Club' }, { osmType: 'way', osmId: 100, name: 'Real Links Golf Club' }, { name: 'Pebble Beach', bbox: [36.56, -121.96, 36.58, -121.93] }]) {
      const r = await post('/api/load-course', body);
      assert.equal(r.status, 403, JSON.stringify(body));
      assert.equal(r.ok, false);
      assert.equal(r.code, 'PRODUCT_COURSE_REFUSED');
    }
    assert.equal((await get('/api/state')).courseName, 'Stage One');          // the bay is as it was
    // ---- ... and every refusal is immediate: an answer, a settled promise, never a request left pending
    const quick = (p, what) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what}: still pending after 3 s`)), 3000))]);
    for (const req of [{ cached: fileOf(100) }, { osmType: 'way', osmId: 100, name: 'Real Links Golf Club', bbox: [46.9, 47.1, -122.1, -121.9] }, { name: 'no identity at all' }]) {
      const r = await quick(server.activationManager.activate(req), `activate ${JSON.stringify(req)}`);
      assert.equal(r.status, 'failed');
      assert.ok(r.diagnostic && r.diagnostic.message);
    }
    assert.equal((await quick(post('/api/load-course', { cached: fileOf(100) }), 'load-course')).status, 403);
    assert.equal((await quick(post('/api/leagues/play', { leagueId: 'x', week: 1, playerId: 'y' }), 'leagues/play')).status, 404);
    assert.equal(server.activationManager.current().courseId, 'osm:way:701');   // still the stage it booted onto
    // a solo stage that turns out to be a real course: the run ends at once and says why
    const bad = openStream();
    await bad.ready;
    assert.equal((await quick(post('/api/solo/start', { kind: 'stage', stage: 'bad' }), 'solo start')).ok, true);
    for (let i = 0; i < 100 && (await get('/api/solo')).run; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal((await get('/api/solo')).run, null);
    const why = bad.seen.events.filter(([n, d]) => n === 'solo' && d && d.aborted).map(([, d]) => d.error);
    assert.equal(why.length, 1);
    assert.match(why[0], /real course/);
    assert.equal((await get('/api/state')).courseName, 'Stage One');
    bad.close();
    assert.equal((await post('/api/load-course', { cached: fileOf(702) })).ok, true);   // a stage loads
    assert.equal((await get('/api/state')).courseName, 'Stage Two');
    assert.equal((await post('/api/load-course', { cached: fileOf(701) })).ok, true);

    // ---- the swing gate: a page in its menus
    assert.equal((await post('/api/shell', { cid: 'not-a-page', screen: 'menu' })).status, 409);   // nobody can shut the gate and walk away
    await post('/api/test-shot', swing);
    assert.equal((await get('/api/state')).strokes, 1);
    await post('/api/reset', {});
    const page = openStream();
    await page.ready;
    assert.equal(page.seen.hello.product, 'simclash');
    const cid = page.seen.hello.cid;
    assert.ok(cid);
    const shotsBefore = (await get('/api/arcade')).shots;
    assert.deepEqual(await post('/api/shell', { cid, screen: 'menu' }), { status: 200, ok: true, inMenu: true, cid });
    await post('/api/test-shot', swing);
    await wait(60);
    st = await get('/api/state');
    assert.equal(st.strokes, 0);                                              // not played
    assert.deepEqual(st.ball, { x: 0, y: 0 });
    assert.equal((await get('/api/arcade')).shots, shotsBefore);              // not counted, nothing spent
    assert.equal(page.seen.events.filter(([n]) => n === 'shot').length, 0);
    const told = page.seen.events.filter(([n]) => n === 'shell-swing');
    assert.equal(told.length, 1);                                             // the page is told: "press any key"
    assert.equal(told[0][1].speedMph, 106);
    // in play: the same swing is a shot
    assert.equal((await post('/api/shell', { cid, screen: 'game' })).inMenu, false);
    await post('/api/test-shot', swing);
    await wait(60);
    assert.equal((await get('/api/state')).strokes, 1);
    assert.equal(page.seen.events.filter(([n]) => n === 'shot').length, 1);
    // back in the menus, then the page goes away: the gate does not stay shut behind it
    await post('/api/shell', { cid, screen: 'menu' });
    await post('/api/reset', {});
    page.close();
    await wait(150);
    await post('/api/test-shot', swing);
    assert.equal((await get('/api/state')).strokes, 1);

    // ---- solo: a two-stage tour, over HTTP, to a best score on disk
    const view = openStream();
    await view.ready;
    assert.equal((await post('/api/solo/start', { kind: 'stage', stage: 'nope' })).status, 404);
    const started = await post('/api/solo/start', { kind: 'tour' });
    assert.equal(started.ok, true);
    assert.equal(started.run.kind, 'tour');
    assert.equal(started.run.stages.length, 2);
    const runState = async () => (await get('/api/solo')).run;
    const until = async (fn, what) => { for (let i = 0; i < 100; i++) { const r = await runState(); if (fn(r)) return r; await wait(20); } throw new Error(`solo never reached: ${what}`); };
    let run = await until((r) => r.phase === 'play', 'play on stage one');
    assert.equal(run.stageId, 's1');
    assert.equal((await get('/api/state')).courseName, 'Stage One');
    assert.equal((await get('/api/state')).strokes, 0);                       // a fresh tee, whatever was played here before
    assert.equal((await post('/api/next-hole', {})).status, 409);             // the run moves itself on
    // play it: a sensible swing for wherever the ball lies, until the stage is over (holed, or picked up)
    const playStage = async () => {
      for (let n = 0; n < 14; n++) {
        const s = await get('/api/state');
        await post('/api/test-shot', testSwing('auto', s));
        await wait(30);
        const r = await runState();
        if (r.phase !== 'play') return r;
      }
      throw new Error('the stage never ended');
    };
    await post('/api/test-shot', swing);
    await wait(30);
    assert.equal((await post('/api/mulligan', {})).status, 409);              // the score counts
    run = await playStage();
    assert.equal(run.phase, 'stage-result');
    const first = run.stages[0];
    assert.ok(first.strokes >= 1 && first.strokes <= 10, `strokes ${first.strokes}`);
    assert.equal(first.toPar, first.strokes - 3);
    assert.ok(first.scoreName);
    assert.equal(run.totals.strokes, first.strokes);
    // over its card a swing is nobody's shot
    const strokesAtCard = (await get('/api/state')).strokes;
    await post('/api/test-shot', swing);
    await wait(30);
    assert.equal((await get('/api/state')).strokes, strokesAtCard);
    assert.equal((await runState()).totals.strokes, first.strokes);

    assert.equal((await post('/api/solo/next', {})).ok, true);
    run = await until((r) => r.phase === 'play' && r.index === 1, 'play on stage two');
    assert.equal((await get('/api/state')).courseName, 'Stage Two');
    run = await playStage();
    assert.equal(run.phase, 'done');
    assert.equal(run.totals.complete, true);
    assert.equal(run.totals.strokes, run.stages[0].strokes + run.stages[1].strokes);
    assert.equal(run.totals.toPar, run.totals.strokes - 6);
    assert.equal(run.newBest, true);
    assert.equal(run.best.strokes, run.totals.strokes);
    const disk = JSON.parse(fs.readFileSync(path.join(dataDir, 'solo-best.json'), 'utf8'));
    assert.equal(disk.tours['2']._guest.strokes, run.totals.strokes);         // kept on disk, per tour length
    assert.equal((await get('/api/solo')).bests.tours['2']._guest.toPar, run.totals.toPar);
    assert.ok(view.seen.events.some(([n, d]) => n === 'solo' && d && d.phase === 'done'));
    assert.equal((await post('/api/solo/abort', {})).run, null);              // the card is dismissed
    assert.equal((await get('/api/solo')).run, null);
    // a single stage for a score, given up: it costs, and it is a result
    await post('/api/solo/start', { kind: 'stage', stage: 's2' });
    await until((r) => r.phase === 'play', 'play on the single stage');
    const gave = await post('/api/solo/give-up', {});
    assert.equal(gave.run.phase, 'done');
    assert.equal(gave.run.stages[0].pickedUp, true);
    assert.equal(gave.run.stages[0].strokes, 7);                              // par 3 + 4
    await post('/api/solo/abort', {});
    view.close();

    // ---- a match starts from the game's stages (the lobby's START), and ends a solo run
    const a = (await post('/api/players', { name: 'Ada' })).player;
    const b = (await post('/api/players', { name: 'Ben' })).player;
    await post('/api/solo/start', { kind: 'free', stage: 's1', playerId: a.id });
    const m = await post('/api/match/start', { playerIds: [a.id, b.id], format: 'quick', stage: 's2' });
    assert.equal(m.ok, true);
    assert.equal((await get('/api/solo')).run, null);
    assert.equal((await post('/api/solo/start', { kind: 'tour' })).status, 409);   // not while a match is in play
    await post('/api/match/abort', {});

    await wait(100);
    // ---- and through all of it, nothing left this machine
    assert.deepEqual(outbound, []);
    assert.deepEqual(fetched, []);
  } finally {
    server.close();
    net.Socket.prototype.connect = realConnect;
    globalThis.fetch = realFetch;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
