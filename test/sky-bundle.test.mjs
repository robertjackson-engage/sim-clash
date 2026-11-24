// The sky photos that ship with the game (lib/sky-bundle.js, tools/arcade-holes/sky-files.mjs).
//
// The game never downloads a sky and its server only serves one that is in the data dir's
// sky-cache, so a fresh install must be handed the ones its stages are lit by. Checked here:
// which files the stages really ask for (from the look itself), that each is pinned to a
// source and a checksum, the install into an empty data dir, and a game server on a
// throwaway data dir serving a bundled sky and refusing one that is not bundled.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SKY_SOURCES, neededSkyFiles, skyFileOf } from '../tools/arcade-holes/sky-files.mjs';

const require = createRequire(import.meta.url);
const { installSkyBundle, readSkyBundle, SKY_MANIFEST, SKY_DIR, SKY_FORMAT } = require('../lib/sky-bundle.js');
const { FILE_RE } = require('../lib/sky-cache.js');
const { COURSES } = require('../tools/arcade-holes/courses.js');

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const quiet = { log() {}, error() {} };
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `sky-bundle-${name}-`));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const GOLDEN = 'kloppenheim_06_puresky_4k.hdr';
const MORNING = 'rustig_koppie_puresky_4k.hdr';

// a bundle dir holding small stand-in "skies" (the real ones are 15 MB each)
function fakeBundle(files = { [GOLDEN]: 'golden sky bytes', [MORNING]: 'morning sky bytes!' }) {
  const dir = tmp('bundle');
  fs.mkdirSync(path.join(dir, SKY_DIR));
  const list = [];
  for (const [file, text] of Object.entries(files)) {
    const buf = Buffer.from(text);
    fs.writeFileSync(path.join(dir, SKY_DIR, file), buf);
    list.push({ file, sha256: sha256(buf), bytes: buf.length });
  }
  fs.writeFileSync(path.join(dir, SKY_MANIFEST), JSON.stringify({ format: SKY_FORMAT, complete: true, files: list }));
  return dir;
}

test('a stage is lit by a sky photo, a painted sky, or the midday sky inside the app', () => {
  const stage = (theme, timeOfDay) => ({ name: `${theme} ${timeOfDay}`, arcade: { theme, timeOfDay } });
  assert.equal(skyFileOf(stage('tropical', 'day')), GOLDEN);      // the arcade look's own sky
  assert.equal(skyFileOf(stage('canyon', 'golden')), GOLDEN);
  assert.equal(skyFileOf(stage('alpine', 'golden')), GOLDEN);
  assert.equal(skyFileOf(stage('alpine', 'day')), MORNING);
  assert.equal(skyFileOf(stage('sakura', 'day')), MORNING);
  assert.equal(skyFileOf(stage('volcano', 'dusk')), null);        // painted: ash and ember
  assert.equal(skyFileOf(stage('volcano', 'golden')), null);
  assert.equal(skyFileOf(stage('canyon', 'dusk')), null);         // painted dusk
  assert.equal(skyFileOf(stage('stadium', 'night')), null);       // painted night
  assert.equal(skyFileOf(stage('neon', 'day')), null);            // the neon city is always a night
  assert.equal(skyFileOf(stage('desert', 'day')), null);          // midday: the sky inside the app
  assert.equal(skyFileOf({ name: 'no theme', arcade: {} }), GOLDEN);
});

test('every sky the real stages ask for is pinned to its Poly Haven source and checksum', () => {
  const stages = COURSES.filter((c) => c.stage).map((c) => ({ name: c.name, arcade: { theme: c.stage.theme, timeOfDay: c.stage.timeOfDay } }));
  assert.ok(stages.length >= 15, `${stages.length} stages`);
  const needed = neededSkyFiles(stages);
  assert.deepEqual(needed.map((n) => n.file), [GOLDEN, MORNING]);   // exactly what ships: a new sky means a new row, a credit and 15 MB
  for (const n of needed) {
    const s = SKY_SOURCES[n.file];
    assert.ok(s, `${n.file} (${n.stages.join(', ')}) is not pinned in sky-files.mjs`);
    assert.match(n.file, FILE_RE);
    assert.match(s.sha256, /^[0-9a-f]{64}$/);
    assert.ok(s.bytes > 1e6);
    assert.equal(s.licence, 'CC0 1.0');
    assert.match(s.page, /^https:\/\/polyhaven\.com\/a\/[a-z0-9_]+$/);
    assert.equal(`${s.page.split('/').pop()}_4k.hdr`, n.file);
  }
  // the golden-hour and the dusk stages by name (the two the release brief asks about)
  const of = (name) => skyFileOf(stages.find((s) => s.name === name));
  assert.equal(of('Canyon Run'), GOLDEN);
  assert.equal(of('Volcano Drop'), null);
  assert.equal(of('Midnight Mile'), null);
  // and the credits name every file that ships
  const credits = fs.readFileSync(path.join(repo, 'CREDITS.md'), 'utf8');
  for (const n of needed) assert.ok(credits.includes(SKY_SOURCES[n.file].page), `CREDITS.md does not name ${n.file}`);
});

test('no bundle, or a bundle without skies: nothing happens', () => {
  const data = tmp('data');
  assert.equal(installSkyBundle({ bundleDir: null, dataDir: data, log: quiet }).status, 'no-bundle');
  assert.equal(installSkyBundle({ bundleDir: tmp('empty'), dataDir: data, log: quiet }).status, 'no-bundle');
  assert.deepEqual(fs.readdirSync(data), []);
});

test('a first boot installs every sky into the sky cache; a second boot writes nothing', () => {
  const bundle = fakeBundle();
  const data = tmp('data');
  const first = installSkyBundle({ bundleDir: bundle, dataDir: data, log: quiet });
  assert.equal(first.status, 'installed');
  assert.deepEqual(first.written.sort(), [GOLDEN, MORNING]);
  assert.equal(fs.readFileSync(path.join(data, 'sky-cache', GOLDEN), 'utf8'), 'golden sky bytes');
  assert.deepEqual(fs.readdirSync(path.join(data, 'sky-cache')).sort(), [GOLDEN, MORNING]);   // no temp file left
  const second = installSkyBundle({ bundleDir: bundle, dataDir: data, log: quiet });
  assert.equal(second.status, 'current');
  assert.deepEqual(second.written, []);
});

test('a cut-off copy is replaced; other skies and files in the data dir are left alone', () => {
  const bundle = fakeBundle();
  const data = tmp('data');
  fs.mkdirSync(path.join(data, 'sky-cache'));
  fs.writeFileSync(path.join(data, 'sky-cache', GOLDEN), 'gold');                       // half a download
  fs.writeFileSync(path.join(data, 'sky-cache', 'kloofendal_overcast_puresky_4k.hdr'), 'mine');   // the simulator's own
  fs.writeFileSync(path.join(data, 'profile.json'), '{}');
  const r = installSkyBundle({ bundleDir: bundle, dataDir: data, log: quiet });
  assert.deepEqual(r.written.sort(), [GOLDEN, MORNING]);
  assert.equal(fs.readFileSync(path.join(data, 'sky-cache', GOLDEN), 'utf8'), 'golden sky bytes');
  assert.equal(fs.readFileSync(path.join(data, 'sky-cache', 'kloofendal_overcast_puresky_4k.hdr'), 'utf8'), 'mine');
  assert.equal(fs.readFileSync(path.join(data, 'profile.json'), 'utf8'), '{}');
});

test('a bundled sky that does not match its checksum fails the install without throwing', () => {
  const bundle = fakeBundle();
  fs.writeFileSync(path.join(bundle, SKY_DIR, GOLDEN), 'golden sky BYTES');   // same length, other bytes
  const data = tmp('data');
  const errors = [];
  const r = installSkyBundle({ bundleDir: bundle, dataDir: data, log: { log() {}, error: (m) => errors.push(m) } });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /does not match its checksum/);
  assert.equal(errors.length, 1);
  assert.equal(fs.existsSync(path.join(data, 'sky-cache', GOLDEN)), false);
});

test('a manifest that names anything but a sky file is refused whole', () => {
  for (const file of ['../profile.json', 'sky.json', 'courses/osm-node-9900000000001.json', 'a_4k.hdr/../../x', 'Kloppenheim_4k.hdr']) {
    const bundle = tmp('bad');
    fs.writeFileSync(path.join(bundle, SKY_MANIFEST), JSON.stringify({ format: SKY_FORMAT, files: [{ file, sha256: 'x', bytes: 4 }] }));
    assert.equal(readSkyBundle(bundle), null, file);
    const data = tmp('data');
    assert.equal(installSkyBundle({ bundleDir: bundle, dataDir: data, log: quiet }).status, 'no-bundle');
    assert.deepEqual(fs.readdirSync(data), []);
  }
});

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

test('a game server on an empty data dir serves the bundled sky from disk, and no other', { timeout: 90000 }, async (t) => {
  const bundle = fakeBundle();
  const data = tmp('data');
  const [http, oc] = [await freePort(), await freePort()];
  const child = spawn(process.execPath, [path.join(repo, 'server.js')], {
    cwd: repo,
    env: {
      ...process.env, BIRDIE_PRODUCT: 'simclash', BIRDIE_PORT: String(http), BIRDIE_OC_PORT: String(oc), BIRDIE_DATA_DIR: data,
      BIRDIE_ARCADE_DIR: bundle, BIRDIE_FORESIGHT: 'off', BIRDIE_NO_WATCH: '1', BIRDIE_SKY_FETCH: '', BIRDIE_CLOUD_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  t.after(() => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill(); }));

  const base = `http://127.0.0.1:${http}`;
  let up = false;
  for (let i = 0; i < 300 && !up && child.exitCode === null; i++) {
    try { up = (await fetch(`${base}/product.js`, { signal: AbortSignal.timeout(1000) })).ok; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  assert.ok(up, `the server did not come up:\n${out}`);
  assert.match(out, /\[sky\] installed 2 sky photo\(s\) from the bundle/);

  const golden = await fetch(`${base}/sky/${GOLDEN}`);
  assert.equal(golden.status, 200);
  assert.equal(Buffer.from(await golden.arrayBuffer()).toString(), 'golden sky bytes');
  assert.equal((await fetch(`${base}/sky/${MORNING}`)).status, 200);
  // a sky that is not bundled is not fetched: the page falls back to the midday sky
  const started = Date.now();
  assert.equal((await fetch(`${base}/sky/kloofendal_overcast_puresky_4k.hdr`)).status, 404);
  assert.ok(Date.now() - started < 2000, 'a 404 at once, not a download attempt');
  assert.deepEqual(fs.readdirSync(path.join(data, 'sky-cache')).sort(), [GOLDEN, MORNING]);
});
