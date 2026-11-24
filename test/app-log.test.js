'use strict';
// The installed app's log file (lib/app-log.js): console output is copied to game.log.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { installFileLog, LOG_NAME } = require('../lib/app-log.js');

const fakeConsole = () => { const out = []; return { out, log: (...a) => out.push(['log', ...a]), info: (...a) => out.push(['info', ...a]), warn: (...a) => out.push(['warn', ...a]), error: (...a) => out.push(['error', ...a]) }; };

test('console output goes to game.log and still reaches the console', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'app-log-')), 'logs');
  const con = fakeConsole();
  const file = installFileLog({ dir, target: con, now: () => new Date('2026-01-02T03:04:05Z') });
  assert.equal(file, path.join(dir, LOG_NAME));
  con.log('[OC] listening on %d', 921);
  con.error('[OC] Port 921 is in use');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /2026-01-02T03:04:05.000Z INFO  ---- started ----/);
  assert.match(text, /INFO  \[OC\] listening on 921/);
  assert.match(text, /ERROR \[OC\] Port 921 is in use/);
  assert.deepEqual(con.out, [['log', '[OC] listening on %d', 921], ['error', '[OC] Port 921 is in use']]);
});

test('a big log is put aside at start, and a runaway session stops writing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-log-'));
  fs.writeFileSync(path.join(dir, LOG_NAME), 'x'.repeat(5000));
  const con = fakeConsole();
  const file = installFileLog({ dir, maxBytes: 1000, target: con });
  assert.equal(fs.readFileSync(path.join(dir, 'game.old.log'), 'utf8').length, 5000);
  for (let i = 0; i < 200; i++) con.log('y'.repeat(50));
  assert.ok(fs.statSync(file).size <= 2000);
});

test('no folder, or one that cannot be made: no log, no throw', () => {
  assert.equal(installFileLog({ dir: null, target: fakeConsole() }), null);
  const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'app-log-')), 'file');
  fs.writeFileSync(blocker, '');
  assert.equal(installFileLog({ dir: path.join(blocker, 'logs'), target: fakeConsole() }), null);
});
