// The sky photos that ship with the game (lib/sky-bundle.js, tools/arcade-holes/sky-files.mjs).
//
// The game never downloads a sky and its server only serves one that is in the data dir's
// sky-cache, so a fresh install must be handed the ones its stages are lit by. Since every
// stage got its own panorama (public/arcade/env/sky, inside the app) that is NONE: the two
// Poly Haven photos no longer ship (v3:env-polish), and the machinery stays for a stage that
// would need one. Checked here: which files the stages really ask for (from the look
// itself), that each photo a stage could fall back to is pinned to a source and a checksum,
// the install into an empty data dir, and a game server on a throwaway data dir serving a
// bundled sky and refusing one that is not bundled.
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
import { SKY_SOURCES, neededSkyFiles, skyFileOf, fallbackSkyFileOf, panoramaOf } from '../tools/arcade-holes/sky-files.mjs';

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

test('a stage is lit by its own panorama, a sky photo, a painted sky, or the midday sky inside the app', () => {
  const stage = (theme, timeOfDay) => ({ name: `${theme} ${timeOfDay}`, arcade: { theme, timeOfDay } });
  // under its own panorama a stage needs no photo on disk (the photo is only what it falls back to)
  for (const [theme, time, pano, fallback] of [
    ['tropical', 'day', 'tropical-day', GOLDEN], ['canyon', 'golden', 'canyon-golden', GOLDEN], ['alpine', 'golden', 'alpine-golden', GOLDEN],
    ['alpine', 'day', 'alpine-day', MORNING], ['sakura', 'day', 'sakura-day', MORNING], ['links', 'day', 'links-day', MORNING],
    ['volcano', 'dusk', 'volcano-dusk', null], ['stadium', 'night', 'stadium-night', null], ['neon', 'day', 'neon-night', null],
  ]) {
    assert.equal(panoramaOf(stage(theme, time)), pano, `${theme}/${time}`);
    assert.equal(skyFileOf(stage(theme, time)), null, `${theme}/${time} needs no sky photo`);
    assert.equal(fallbackSkyFileOf(stage(theme, time)), fallback, `${theme}/${time} falls back`);
  }
  // a theme at an hour it has no panorama for is still lit by a photo, and that photo is needed
  assert.equal(panoramaOf(stage('canyon', 'day')), null);
  assert.equal(skyFileOf(stage('canyon', 'day')), MORNING);
  assert.equal(skyFileOf(stage('tropical', 'golden')), GOLDEN);
  assert.equal(skyFileOf(stage('jungle', 'day')), MORNING);
  assert.equal(skyFileOf(stage('volcano', 'golden')), null);      // painted: ash and ember
  assert.equal(skyFileOf(stage('canyon', 'dusk')), null);         // painted dusk
  assert.equal(skyFileOf(stage('stadium', 'dusk')), null);
  assert.equal(skyFileOf(stage('desert', 'day')), null);          // midday: the sky inside the app
  // a course with no theme (a real course in the arcade look, the legacy Arcade Classics) has no panorama
  assert.equal(panoramaOf({ name: 'no theme', arcade: {} }), null);
  assert.equal(skyFileOf({ name: 'no theme', arcade: {} }), GOLDEN);
});

test('no stage that ships needs a sky photo: each has its own panorama, and the photos they could fall back to stay pinned', () => {
  const stages = COURSES.filter((c) => c.stage).map((c) => ({ name: c.name, arcade: { theme: c.stage.theme, timeOfDay: c.stage.timeOfDay } }));
  assert.ok(stages.length >= 15, `${stages.length} stages`);
  // exactly what ships: nothing (it was the two Poly Haven photos, 32 MB). A stage that brings
  // a photo back fails here first: it means a new row below, a credit and 15 MB of installer.
  assert.deepEqual(neededSkyFiles(stages), []);
  const envManifest = JSON.parse(fs.readFileSync(path.join(repo, 'public', 'arcade', 'env', 'manifest.json'), 'utf8'));
  for (const s of stages) {
    const id = panoramaOf(s);
    assert.ok(id && envManifest.skies[id], `${s.name} has a panorama that is in public/arcade/env/manifest.json`);
    assert.ok(fs.existsSync(path.join(repo, 'public', 'arcade', 'env', envManifest.skies[id].file)), `${s.name}: ${envManifest.skies[id].file} is in the repo (so inside the app)`);
  }
  // the photos a stage would be lit by without its panorama are still pinned, for the day one is needed again
  const fallbacks = [...new Set(stages.map(fallbackSkyFileOf).filter(Boolean))].sort();
  assert.deepEqual(fallbacks, [GOLDEN, MORNING]);
  for (const file of fallbacks) {
    const s = SKY_SOURCES[file];
    assert.ok(s, `${file} is not pinned in sky-files.mjs`);
    assert.match(file, FILE_RE);
    assert.match(s.sha256, /^[0-9a-f]{64}$/);
    assert.ok(s.bytes > 1e6);
    assert.equal(s.licence, 'CC0 1.0');
    assert.match(s.page, /^https:\/\/polyhaven\.com\/a\/[a-z0-9_]+$/);
    assert.equal(`${s.page.split('/').pop()}_4k.hdr`, file);
  }
  const of = (name) => skyFileOf(stages.find((s) => s.name === name));
  assert.equal(of('Canyon Run'), null);
  assert.equal(of('Volcano Drop'), null);
  assert.equal(of('Midnight Mile'), null);
  // the credits say what the stage skies are (generated for this project) and no longer say a Poly Haven photo is installed with the stages
  const credits = fs.readFileSync(path.join(repo, 'CREDITS.md'), 'utf8');
  assert.match(credits, /public\/arcade\/env/);
  assert.match(credits, /generated for this (project|game)/i);
  assert.ok(!/arcade-data\/sky/.test(credits), 'CREDITS.md still says sky photos are installed with the stages');
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
