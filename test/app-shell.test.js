'use strict';
// The desktop window before the game is there (lib/app-shell.js) and main.js's window flow,
// run against a fake Electron (test/helpers/main-harness.cjs): nothing here opens a window.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { splashHtml, splashUrl, startErrorText, readWindowPrefs, writeWindowPrefs } = require('../lib/app-shell.js');

const product = { name: 'Sim Clash', wordmark: ['SIM', 'CLASH'], tagline: 'Arcade 1v1 golf', colors: { p1: '#ff5a36', p2: '#2e9bff', gold: '#ffd21f', ink: '#07090d' } };

test('the splash is dark, shows the wordmark in the two player colours, and loads nothing from anywhere', () => {
  const html = splashHtml(product);
  assert.match(html, /<h1><i>SIM<\/i> <b>CLASH<\/b><\/h1>/);
  assert.match(html, /background:#07090d/);
  assert.match(html, /h1 i\{[^}]*color:#ff5a36/);
  assert.match(html, /h1 b\{[^}]*color:#2e9bff/);
  assert.match(html, /LOADING/);
  assert.doesNotMatch(html, /https?:|<script|<img|url\(/i);
  assert.ok(splashUrl(product).startsWith('data:text/html;charset=utf-8,'));
  assert.equal(decodeURIComponent(splashUrl(product).split(',')[1]), html);
});

test('the splash follows product.json: another name, one word, hostile text, bad colours', () => {
  assert.match(splashHtml({ name: 'Bay Brawl' }), /<h1><i>BAY<\/i> <b>BRAWL<\/b><\/h1>/);
  assert.match(splashHtml({ name: 'Golfbash' }), /<h1><i>GOLFBASH<\/i><\/h1>/);
  const evil = splashHtml({ name: '<script>x</script>', wordmark: ['<img src=x>', '"b"'], tagline: '</div><script>', colors: { ink: 'red;}</style><script>' } });
  assert.doesNotMatch(evil, /<script|<img/);
  assert.match(evil, /background:#07090d/, 'a colour that is not a hex colour is not used');
});

test('a server that cannot start is explained in plain words', () => {
  const busy = startErrorText(Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE', port: 8222 }), { name: 'Sim Clash' });
  assert.match(busy, /port 8222/);
  assert.match(busy, /already in use/);
  assert.match(busy, /Open-Birdie/);
  assert.match(startErrorText(new Error('boom\n  at x'), { name: 'Sim Clash' }), /^Sim Clash could not start: boom$/);
  const html = splashHtml(product, { error: busy });
  assert.match(html, /class="e"/);
  assert.doesNotMatch(html, /LOADING/);
});

test('window prefs: full screen unless the player left it, and never a throw', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-shell-'));
  const file = path.join(dir, 'sub', 'window.json');
  assert.deepEqual(readWindowPrefs(file), { fullscreen: true });
  assert.equal(writeWindowPrefs(file, { fullscreen: false }), true);
  assert.deepEqual(readWindowPrefs(file), { fullscreen: false });
  fs.writeFileSync(file, 'not json');
  assert.deepEqual(readWindowPrefs(file), { fullscreen: true });
  const blocker = path.join(dir, 'file');
  fs.writeFileSync(blocker, '');
  assert.equal(writeWindowPrefs(path.join(blocker, 'x', 'window.json'), { fullscreen: true }), false);
});

// ---- main.js, against a fake Electron
function run(scenario) {
  const out = spawnSync(process.execPath, [path.join(__dirname, 'helpers', 'main-harness.cjs'), scenario], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout.trim().split('\n').pop());
}
const steps = (r) => r.log.map((l) => l[0]);

test('main.js: SIMCLASH_MUTE=1 mutes the window before anything is loaded into it; without it nothing is muted', () => {
  const muted = run('muted');
  const s = steps(muted);
  assert.deepEqual(muted.log.find((l) => l[0] === 'setAudioMuted'), ['setAudioMuted', true]);
  assert.ok(s.indexOf('setAudioMuted') > s.indexOf('window') && s.indexOf('setAudioMuted') < s.indexOf('loadURL'), 'muted before the splash is loaded');
  assert.equal(steps(run('ok')).includes('setAudioMuted'), false);
});

test('main.js: the window opens at once on the splash, hidden until painted, then the game replaces it', () => {
  const r = run('ok');
  const [, win, splash] = r.log;
  assert.deepEqual(r.log[0], ['setName', 'Sim Clash'], 'its own user-data folder, before anything asks for it');
  assert.deepEqual(win, ['window', { fullscreen: true, show: false, backgroundColor: '#07090d', title: 'Sim Clash', contextIsolation: true }]);
  assert.equal(splash[0], 'loadURL');
  assert.match(splash[1], /^data:.*<i>SIM<\/i> <b>CLASH<\/b>.*LOADING/);
  const s = steps(r);
  assert.ok(s.indexOf('window') < s.indexOf('-- app ready, server not yet --'), 'the window does not wait for the server');
  assert.ok(s.indexOf('show') > s.indexOf('-- app ready, server not yet --'), 'shown when it has something to show');
  const game = r.log.filter((l) => l[0] === 'loadURL')[1];
  assert.equal(game[1], 'http://localhost:8334?primaryNonce=NONCE');
  assert.equal(r.arcadeDir, path.join(__dirname, '..', 'build', 'arcade-data'), 'the server is told where the bundled stages are');
});

test('main.js: Alt+Enter and F11 toggle full screen and the choice is remembered; plain Enter is left alone', () => {
  const r = run('ok');
  assert.deepEqual(r.log.filter((l) => l[0] === 'setFullScreen'), [['setFullScreen', false], ['setFullScreen', true]]);
  assert.deepEqual(r.log.find((l) => l[0] === 'alt+enter prevented'), ['alt+enter prevented', true]);
  assert.ok(!steps(r).some((x) => /BUG/.test(x)));
  assert.deepEqual(r.prefs, { fullscreen: true });
  const w = run('windowed');
  assert.equal(w.log.find((l) => l[0] === 'window')[1].fullscreen, false, 'a player who left full screen starts windowed');
  assert.deepEqual(w.prefs, { fullscreen: false });
});

test('main.js: a busy port is said on screen, and the game page is never loaded', () => {
  const r = run('busy');
  const loads = r.log.filter((l) => l[0] === 'loadURL');
  assert.equal(loads.length, 2);
  assert.match(loads[1][1], /could not start: port 8334 on this PC is already in use/);
  assert.ok(!loads.some((l) => l[1].startsWith('http')));
});

test('main.js: a second launch quits at once (the first one is focused instead) and never touches the ports', () => {
  const second = run('second');
  assert.deepEqual(steps(second), ['setName', 'quit']);
  assert.ok(steps(run('ok')).includes('focus'), 'the running game comes to the front');
});
