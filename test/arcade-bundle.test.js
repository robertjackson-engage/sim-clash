'use strict';
// The arcade courses that ship with the app: lib/arcade-bundle.js installs them into an
// empty data dir on first boot, updates them from a newer bundle, repairs a missing file,
// and never touches anything else (docs/dev/packaging.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { installArcadeBundle, readBundle, bundleDirFor, REPO_BUNDLE_DIR, sha256, BUNDLE_FILE, RECORD_FILE, TOUR_FILE } = require('../lib/arcade-bundle.js');

const quiet = { log() {}, error() {} };
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `arcade-bundle-${name}-`));
const A = 'osm-node-9900000000001.json';
const B = 'osm-node-9900000000002.json';

/** A bundle dir with the given { file: text } courses. */
function makeBundle(dir, revision, courses, tour = { version: 1, stages: [], tiebreaks: [] }) {
  fs.mkdirSync(path.join(dir, 'courses'), { recursive: true });
  const list = [];
  for (const [file, text] of Object.entries(courses)) {
    fs.writeFileSync(path.join(dir, 'courses', file), text);
    list.push({ file, id: file, name: file, sha256: sha256(Buffer.from(text)), bytes: text.length });
  }
  fs.writeFileSync(path.join(dir, TOUR_FILE), JSON.stringify({ ...tour, revision }));
  fs.writeFileSync(path.join(dir, BUNDLE_FILE), JSON.stringify({ format: 1, revision, appVersion: 'test', courses: list, tour: {} }));
  return dir;
}
const read = (dir, ...p) => fs.readFileSync(path.join(dir, ...p), 'utf8');

test('no bundle: nothing happens and nothing is created', () => {
  const data = tmp('data');
  const r = installArcadeBundle({ bundleDir: path.join(data, 'nope'), dataDir: data, log: quiet });
  assert.equal(r.status, 'no-bundle');
  assert.deepEqual(fs.readdirSync(data), []);
  assert.equal(installArcadeBundle({ bundleDir: null, dataDir: data, log: quiet }).status, 'no-bundle');
});

test('a bare `node server.js` installs nothing: the bundle is opt-in (main.js, --bundled-arcade)', () => {
  assert.equal(bundleDirFor({}, ['node', 'server.js']), null);
  assert.equal(bundleDirFor({}, ['node', 'server.js', '--bundled-arcade']), REPO_BUNDLE_DIR);
  assert.equal(bundleDirFor({ BIRDIE_ARCADE_DIR: path.join(os.tmpdir(), 'x') }, ['node', 'server.js']), path.join(os.tmpdir(), 'x'));
});

test('a first boot installs every course, the tour and a record; a second boot writes nothing', () => {
  const bundle = makeBundle(tmp('b'), 10, { [A]: '{"a":1}', [B]: '{"b":1}' });
  const data = path.join(tmp('data'), 'data');   // does not exist yet
  const r = installArcadeBundle({ bundleDir: bundle, dataDir: data, log: quiet });
  assert.equal(r.status, 'installed');
  assert.deepEqual(r.written.sort(), [A, B, TOUR_FILE].sort());
  assert.equal(read(data, 'courses', A), '{"a":1}');
  assert.equal(JSON.parse(read(data, RECORD_FILE)).revision, 10);
  const again = installArcadeBundle({ bundleDir: bundle, dataDir: data, log: quiet });
  assert.equal(again.status, 'current');
  assert.deepEqual(again.written, []);
});

test('a newer bundle replaces what the older one installed; an older one does not', () => {
  const data = tmp('data');
  installArcadeBundle({ bundleDir: makeBundle(tmp('b1'), 10, { [A]: '{"a":1}', [B]: '{"b":1}' }), dataDir: data, log: quiet });
  const r = installArcadeBundle({ bundleDir: makeBundle(tmp('b2'), 11, { [A]: '{"a":2}', [B]: '{"b":1}' }), dataDir: data, log: quiet });
  assert.equal(r.status, 'installed');
  assert.deepEqual(r.written.sort(), [A, TOUR_FILE].sort());   // B is byte-identical: not rewritten
  assert.equal(read(data, 'courses', A), '{"a":2}');
  assert.equal(JSON.parse(read(data, RECORD_FILE)).revision, 11);
  const old = installArcadeBundle({ bundleDir: makeBundle(tmp('b0'), 9, { [A]: '{"a":0}', [B]: '{"b":0}' }), dataDir: data, log: quiet });
  assert.equal(old.status, 'current');
  assert.equal(read(data, 'courses', A), '{"a":2}');
});

test('a missing course is restored without touching the others', () => {
  const bundle = makeBundle(tmp('b'), 10, { [A]: '{"a":1}', [B]: '{"b":1}' });
  const data = tmp('data');
  installArcadeBundle({ bundleDir: bundle, dataDir: data, log: quiet });
  fs.unlinkSync(path.join(data, 'courses', B));
  const r = installArcadeBundle({ bundleDir: bundle, dataDir: data, log: quiet });
  assert.equal(r.status, 'repaired');
  assert.deepEqual(r.written, [B]);
});

test('other courses and player data are never touched', () => {
  const data = tmp('data');
  fs.mkdirSync(path.join(data, 'courses'), { recursive: true });
  const keep = { 'courses/osm-relation-3741806.json': '{"real":"course"}', 'arcade.json': '{"coins":500}', 'leagues.json': '{"players":[1]}', 'match-ledger.json': '[]', 'settings.json': '{}' };
  for (const [f, text] of Object.entries(keep)) fs.writeFileSync(path.join(data, f), text);
  installArcadeBundle({ bundleDir: makeBundle(tmp('b1'), 10, { [A]: '{"a":1}' }), dataDir: data, log: quiet });
  installArcadeBundle({ bundleDir: makeBundle(tmp('b2'), 11, { [A]: '{"a":2}' }), dataDir: data, log: quiet });
  for (const [f, text] of Object.entries(keep)) assert.equal(read(data, f), text, f);
  assert.deepEqual(fs.readdirSync(data).sort(), ['arcade-bundle.json', 'arcade-tour.json', 'arcade.json', 'courses', 'leagues.json', 'match-ledger.json', 'settings.json']);
  assert.deepEqual(fs.readdirSync(path.join(data, 'courses')).sort(), [A, 'osm-relation-3741806.json']);
});

test('a data dir with stages but no install record (built by an older version, or by build.mjs) is brought up to the bundle', () => {
  const data = tmp('data');
  fs.mkdirSync(path.join(data, 'courses'), { recursive: true });
  fs.writeFileSync(path.join(data, 'courses', A), '{"old":true}');
  fs.writeFileSync(path.join(data, TOUR_FILE), '{"old":true}');
  const r = installArcadeBundle({ bundleDir: makeBundle(tmp('b'), 99, { [A]: '{"a":1}', [B]: '{"b":1}' }), dataDir: data, log: quiet });
  assert.equal(r.status, 'installed');
  assert.deepEqual(r.written.sort(), [A, B, TOUR_FILE].sort());
  assert.equal(read(data, 'courses', A), '{"a":1}');
  assert.equal(JSON.parse(read(data, RECORD_FILE)).revision, 99);
});

test('a bundle that names anything but an arcade course file is refused whole', () => {
  const bundle = makeBundle(tmp('b'), 10, { [A]: '{"a":1}' });
  const m = JSON.parse(read(bundle, BUNDLE_FILE));
  for (const bad of ['../settings.json', 'arcade.json', 'osm-relation-3741806.json', 'courses/x.json']) {
    fs.writeFileSync(path.join(bundle, BUNDLE_FILE), JSON.stringify({ ...m, courses: [...m.courses, { file: bad, sha256: 'x' }] }));
    assert.equal(readBundle(bundle), null, bad);
    const data = tmp('data');
    assert.equal(installArcadeBundle({ bundleDir: bundle, dataDir: data, log: quiet }).status, 'no-bundle');
    assert.deepEqual(fs.readdirSync(data), []);
  }
});

test('a corrupted bundle file fails the install without throwing', () => {
  const bundle = makeBundle(tmp('b'), 10, { [A]: '{"a":1}' });
  fs.writeFileSync(path.join(bundle, 'courses', A), '{"tampered":1}');
  const r = installArcadeBundle({ bundleDir: bundle, dataDir: tmp('data'), log: quiet });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /checksum/);
});

test('bundle.mjs builds the real stages; they install into an empty data dir and the tour lists files that exist', { timeout: 120000 }, () => {
  const out = tmp('real');
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'arcade-holes', 'bundle.mjs'), '--out', out], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const bundle = readBundle(out);
  assert.ok(bundle && bundle.courses.length >= 13, 'the stage courses are bundled');
  const again = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'arcade-holes', 'bundle.mjs'), '--out', out], { encoding: 'utf8' });
  assert.match(again.stdout, /unchanged/);
  assert.equal(readBundle(out).revision, bundle.revision, 'the same sources keep the same revision');

  const data = tmp('data');
  const r = installArcadeBundle({ bundleDir: out, dataDir: data, log: quiet });
  assert.equal(r.status, 'installed');
  const tour = JSON.parse(read(data, TOUR_FILE));
  assert.ok(tour.stages.length >= 9 && tour.tiebreaks.length >= 3);
  for (const s of [...tour.stages, ...tour.tiebreaks]) {
    const course = JSON.parse(read(data, 'courses', s.file));
    assert.equal(course.name, s.name);
    assert.equal(course.arcade.id, s.id);
  }
});
