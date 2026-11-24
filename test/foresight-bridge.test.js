'use strict';
// The Foresight bridge (lib/foresight-bridge.js, docs/foresight-bridge.md): the parser
// against lines copied from a real connector log (test/fixtures/foresight), the tail on
// real files in a temp folder (appends, a line split across reads, rollover, truncation,
// a file that turns up later), the listener on real local sockets (it holds a connector,
// survives garbage and resets, stands back from a taken port and comes up when it is
// freed), the mapping to Open Connect, the setting, and the whole way through a game
// server in this process: a fake connector on TCP 9051, a log being appended to, and a
// shot arriving in the game exactly once with the right numbers.
//
// Nothing here touches TCP 9050 or a real GSPro folder.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
// The end-to-end test's data dir, named before anything of the game is loaded (lib/course.js
// reads BIRDIE_DATA_DIR when it is first required, and lib/game.js requires it).
const E2E_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-foresight-e2e-'));
process.env.BIRDIE_DATA_DIR = path.join(E2E_DIR, 'data');
process.on('exit', () => { try { fs.rmSync(E2E_DIR, { recursive: true, force: true }); } catch (_) { /* in use */ } });
const {
  createForesightBridge, createForesightManager, createShotParser, createSwingGuard,
  parseLogLine, parseBallBracket, ballDataFromValues, toOpenConnect,
  findConnectorLog, logCandidates, logFileFromPath,
  DEFAULT_CONNECTOR_DIR, LOG_NAME, DEVICE_ID,
} = require('../lib/foresight-bridge');
const { OpenConnectServer } = require('../lib/openconnect');
const { launchFromBall } = require('../lib/game');

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'foresight', 'ConnectDebug.sample.txt'), 'utf8');
const FIXTURE_LINES = FIXTURE.split(/\r?\n/).filter((l) => l.length);
const E2E_BRIDGE_PORT = +(process.env.BIRDIE_TEST_FORESIGHT_PORT || 9051);
const E2E_OC_PORT = +(process.env.BIRDIE_TEST_OC_PORT || 9967);

// ---- helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what = 'condition', ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(15);
  }
}
const tmpDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-foresight-'));
  if (t) t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* in use */ } });
  return dir;
};
const pad = (n, w = 2) => String(n).padStart(w, '0');
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())},${pad(d.getMilliseconds(), 3)}`;
const PREFIX = '[1] INFO  VGPconnect.ForesightForm [(null)] - ';
// the three lines the connector writes for one shot, dated `at`
function shotLines(bracket, at = new Date()) {
  return [
    `${stamp(at)} ${PREFIX}Sending Shot`,
    `${stamp(new Date(at.getTime() + 2))} ${PREFIX}Logging ball data IMMEDIATELY before sending to GSPro`,
    `${stamp(new Date(at.getTime() + 5))} ${PREFIX}${bracket}`,
  ];
}
const text = (lines, eol = '\r\n') => lines.map((l) => l + eol).join('');
const DRIVE = '[152.4375,11.25,-1.5,-310.0,2540.5,2521.0,-7.01,0.0]';
const IRON = '[111.03125,19.5,2.25,412.0,6890.25,6878.0,3.43,0.0]';
const WEDGE = '[47.48572,42.81155,-25.90489,-1507.0,2674.085,2209.0,-34.302166,0.0]';
const PUTT = '[8.455603,0.0,-3.00250149,0.0,0.0,0.0,0.0,0.0]';
const speeds = (shots) => shots.map((s) => (s.BallData ? s.BallData.Speed : s.ball.Speed));

// a bridge on an ephemeral port with a fast poll, cleaned up with the test
function bridgeFor(t, opts = {}) {
  const shots = [];
  const states = [];
  const bridge = createForesightBridge({
    port: 0, pollMs: 20, retryMs: 60,
    onShot: (msg, meta) => shots.push({ ...msg, meta }),
    onStatus: (s) => states.push(s.state),
    ...opts,
  });
  t.after(() => bridge.stop());
  return { bridge, shots, states };
}
const connect = (port, t) => new Promise((resolve, reject) => {
  const sock = net.connect(port, '127.0.0.1');
  const seen = { data: 0, closed: false, ended: false };
  sock.on('data', (d) => { seen.data += d.length; });
  sock.on('end', () => { seen.ended = true; });
  sock.on('close', () => { seen.closed = true; });
  sock.on('error', () => {});
  sock.once('connect', () => resolve({ sock, seen }));
  sock.once('error', reject);
  if (t) t.after(() => sock.destroy());
});
const listenOn = (host, port, t) => new Promise((resolve, reject) => {
  const conns = [];
  const s = net.createServer((c) => { conns.push(c); c.on('error', () => {}); });
  s.once('error', reject);
  s.listen({ port, host, exclusive: true }, () => resolve({ server: s, conns, port: s.address().port, close: () => new Promise((r) => { for (const c of conns) c.destroy(); s.close(() => r()); }) }));
  if (t) t.after(() => { for (const c of conns) c.destroy(); try { s.close(); } catch (_) { /* closed */ } });
});

// ================================================================ the parser

test('parser: every shot of a real log, in order, and nothing else', () => {
  const shots = [];
  const parser = createShotParser({ onShot: (s) => shots.push(s) });
  for (const line of FIXTURE_LINES) parser.push(line);
  assert.deepEqual(speeds(shots), [53.5074539, 75.59378, 28.240696, 5.9062767, 47.18525, 7.410872, 107.432358, 8.143612, 79.75499]);
  assert.deepEqual(parser.counts, { markers: 20, shots: 9, duplicates: 0, ignored: 0, invalid: 0 });
  // a drive, as the log wrote it: speed, VLA, HLA, side spin, total spin, back spin, axis, 0
  assert.deepEqual(shots[0].ball, { Speed: 53.5074539, SpinAxis: 31.28819, TotalSpin: 2574.40649, BackSpin: 2200, SideSpin: 1337, HLA: 26.1026459, VLA: 5.214206 });
  assert.equal(shots[0].stamp, '2026-11-22 21:24:48,387');
  assert.equal(shots[0].at, new Date(2026, 10, 22, 21, 24, 48, 387).getTime());
  // a putt: slow, no launch, no spin
  assert.deepEqual(shots[5].ball, { Speed: 7.410872, SpinAxis: 0, TotalSpin: 0, BackSpin: 0, SideSpin: 0, HLA: -2.99686742, VLA: 0 });
  assert.equal(shots[5].isPutt, true);
  assert.equal(shots[0].isPutt, false);
  // spin the unit could not read is written "NaN": the shot still counts, with no spin
  assert.deepEqual(shots[8].ball, { Speed: 79.75499, SpinAxis: 0, TotalSpin: 0, BackSpin: 0, SideSpin: 0, HLA: -5.246079, VLA: 3.16992664 });
});

test('parser: a marker with no bracket is no shot; the next shot still is', () => {
  // the fixture's 21:53:12 "Sending Shot" has no bracket (it was left out of the excerpt)
  const at = FIXTURE_LINES.findIndex((l) => l.startsWith('2026-11-22 21:53:12,864'));
  assert.ok(at > 0);
  assert.ok(/Logging ball data/.test(FIXTURE_LINES[at + 1]) && /Sending Shot/.test(FIXTURE_LINES[at + 2]));
  const shots = [];
  const parser = createShotParser({ onShot: (s) => shots.push(s) });
  for (const line of FIXTURE_LINES.slice(at, at + 5)) parser.push(line);
  assert.deepEqual(speeds(shots), [47.18525]);
  // and a marker at the very end leaves the parser armed, with nothing emitted
  const p2 = createShotParser();
  assert.equal(p2.push(shotLines(DRIVE)[0]), null);
  assert.equal(p2.push(shotLines(DRIVE)[1]), null);
  assert.equal(p2.armed, true);
  assert.equal(p2.counts.shots, 0);
});

test('parser: a bracket with no marker just before it is ignored', () => {
  const t0 = new Date(2026, 10, 22, 20, 0, 0, 0);
  const [m1, m2, b] = shotLines(DRIVE, t0);
  // no marker at all
  let p = createShotParser();
  assert.equal(p.push(b), null);
  assert.deepEqual([p.counts.shots, p.counts.ignored], [0, 1]);
  // the marker was used by the first bracket: a second bracket on its own is not a shot
  p = createShotParser();
  for (const l of [m1, m2, b]) p.push(l);
  assert.equal(p.push(`${stamp(new Date(t0.getTime() + 900))} ${PREFIX}${IRON}`), null);
  assert.deepEqual([p.counts.shots, p.counts.ignored], [1, 1]);
  // a marker long ago in lines ...
  p = createShotParser();
  p.push(m1); p.push(m2);
  for (let i = 0; i < 13; i++) p.push(`${stamp(new Date(t0.getTime() + 10 + i))} [7] DEBUG Some.Logger [(null)] - chatter ${i}`);
  assert.equal(p.push(`${stamp(new Date(t0.getTime() + 40))} ${PREFIX}${DRIVE}`), null);
  assert.equal(p.counts.ignored, 1);
  // ... or long ago in time
  p = createShotParser();
  p.push(m1); p.push(m2);
  assert.equal(p.push(`${stamp(new Date(t0.getTime() + 6000))} ${PREFIX}${DRIVE}`), null);
  assert.equal(p.counts.ignored, 1);
  // a bracket that is not ball data (too few values, words) is not even looked at
  p = createShotParser();
  p.push(m1); p.push(m2);
  assert.equal(p.push(`${stamp(t0)} ${PREFIX}[1.0,2.0,3.0]`), null);
  assert.equal(p.push(`${stamp(t0)} ${PREFIX}[connected]`), null);
  assert.equal(p.counts.ignored, 0);
  assert.ok(p.push(`${stamp(new Date(t0.getTime() + 20))} ${PREFIX}${DRIVE}`), 'the marker still stands for the real bracket');
});

test('parser: another thread\'s error between the marker and the bracket does not lose the shot', () => {
  const errAt = FIXTURE_LINES.findIndex((l) => l.includes('ERROR VGPconnect.ForesightForm') && l.includes('IOException'));
  const errorBlock = FIXTURE_LINES.slice(errAt, errAt + 5);    // one ERROR line and its stack trace
  assert.equal(parseLogLine(errorBlock[1]), null, 'a stack trace line is a continuation, not a log line');
  const [m1, m2, b] = shotLines(IRON, new Date(2026, 10, 22, 21, 34, 46, 800));
  const p = createShotParser();
  for (const l of [m1, m2, ...errorBlock, b]) p.push(l);
  assert.equal(p.counts.shots, 1);
});

test('parser: the same shot twice is one shot', () => {
  const t0 = new Date(2026, 10, 22, 20, 0, 0, 0);
  const once = shotLines(DRIVE, t0);
  let p = createShotParser();
  for (const l of [...once, ...once]) p.push(l);                 // the same lines read again
  assert.deepEqual([p.counts.shots, p.counts.duplicates], [1, 1]);
  p = createShotParser();
  for (const l of [...once, ...shotLines(DRIVE, new Date(t0.getTime() + 1200))]) p.push(l);   // logged again a second later
  assert.deepEqual([p.counts.shots, p.counts.duplicates], [1, 1]);
  p = createShotParser();
  for (const l of [...once, ...shotLines(IRON, new Date(t0.getTime() + 1200))]) p.push(l);    // a different ball is a shot
  assert.deepEqual([p.counts.shots, p.counts.duplicates], [2, 0]);
  p = createShotParser();
  for (const l of [...once, ...shotLines(DRIVE, new Date(t0.getTime() + 20000))]) p.push(l);  // the same numbers much later: a new swing
  assert.deepEqual([p.counts.shots, p.counts.duplicates], [2, 0]);
});

test('parser: line and bracket forms', () => {
  const rec = parseLogLine('﻿2026-11-22 22:56:52,747 [1] INFO  VGPconnect.ForesightForm [(null)] - Sending Shot\r');
  assert.deepEqual([rec.level, rec.logger, rec.message, rec.stamp], ['INFO', 'VGPconnect.ForesightForm', 'Sending Shot', '2026-11-22 22:56:52,747']);
  assert.equal(parseLogLine('   at System.Net.Sockets.NetworkStream.Read(Byte[] buffer, Int32 offset, Int32 size)'), null);
  assert.equal(parseLogLine(''), null);
  assert.deepEqual(parseBallBracket(WEDGE), [47.48572, 42.81155, -25.90489, -1507, 2674.085, 2209, -34.302166, 0]);
  assert.deepEqual(parseBallBracket('[ 1.5e2 , 1E-1,-.5,0,0,0,"NaN",0.0 ]'), [150, 0.1, -0.5, 0, 0, 0, NaN, 0]);
  assert.equal(parseBallBracket('[1,2,3,4,5,6]'), null);
  assert.equal(parseBallBracket('[a,b,c,d,e,f,g,h]'), null);
  assert.equal(parseBallBracket('Sending Shot'), null);
  // no speed: not a shot
  assert.equal(ballDataFromValues([0, 1, 2, 3, 4, 5, 6, 0]), null);
  assert.equal(ballDataFromValues([NaN, 1, 2, 3, 4, 5, 6, 0]), null);
  const p = createShotParser();
  for (const l of shotLines('["NaN",0.0,0.0,0.0,0.0,0.0,0.0,0.0]')) p.push(l);
  assert.deepEqual([p.counts.shots, p.counts.invalid], [0, 1]);
});

// ================================================================ the mapping

test('mapping: the bracket becomes Open Connect ball data, units and signs as given', async (t) => {
  // the example from the connector's log: speed, VLA, HLA, side spin, total spin, back spin, axis
  const ball = ballDataFromValues(parseBallBracket(WEDGE));
  assert.deepEqual(ball, { Speed: 47.48572, SpinAxis: -34.302166, TotalSpin: 2674.085, BackSpin: 2209, SideSpin: -1507, HLA: -25.90489, VLA: 42.81155 });
  const msg = toOpenConnect(ball, 7);
  assert.deepEqual(msg, {
    DeviceID: DEVICE_ID, Units: 'Yards', ShotNumber: 7, APIversion: '1',
    BallData: ball, ClubData: null,
    ShotDataOptions: { ContainsBallData: true, ContainsClubData: false, LaunchMonitorIsReady: true, LaunchMonitorBallDetected: true, IsHeartBeat: false },
  });
  // what the game makes of it: the same launch, nothing flipped
  assert.deepEqual(launchFromBall(msg.BallData), { speedMph: 47.48572, vla: 42.81155, hla: -25.90489, totalSpin: 2674.085, spinAxis: -34.302166 });
  // and it IS an Open Connect message: sent to the game's own Open Connect server over a
  // socket, it comes out as the same shot
  const oc = new OpenConnectServer(0);
  oc.start();
  await new Promise((resolve) => oc.server.once('listening', resolve));
  t.after(() => { for (const s of oc.clients) s.destroy(); oc.server.close(); });
  const got = new Promise((resolve) => oc.once('shot', resolve));
  const { sock } = await connect(oc.server.address().port, t);
  sock.write(JSON.stringify(msg));
  const shot = await got;
  assert.deepEqual(shot.ball, ball);
  assert.deepEqual([shot.shotNumber, shot.device, shot.club], [7, DEVICE_ID, null]);
});

// ================================================================ the tail

test('tail: starts at the END of the log (old shots are never replayed), then reads what is appended', async (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, LOG_NAME);
  fs.writeFileSync(file, FIXTURE);                       // nine old shots
  const { bridge, shots } = bridgeFor(t, { logFile: file });
  await bridge.start();
  await bridge.poll(); await bridge.poll();
  assert.equal(shots.length, 0);
  fs.appendFileSync(file, text(shotLines(DRIVE)));       // CRLF, as the connector writes
  await waitFor(() => shots.length === 1, 'the appended shot');
  fs.appendFileSync(file, text(shotLines(PUTT), '\n'));  // LF
  await waitFor(() => shots.length === 2, 'the LF shot');
  await sleep(80);
  assert.deepEqual(speeds(shots), [152.4375, 8.455603]);
  assert.deepEqual(shots.map((s) => s.ShotNumber), [1, 2]);
  assert.deepEqual(shots[0].meta.source, 'foresight');
  assert.equal(shots[1].meta.isPutt, true);
  const s = bridge.status();
  assert.deepEqual([s.shots, s.duplicates, s.ignored, s.logFound, s.dirFound], [2, 0, 0, true, true]);
  assert.deepEqual(s.lastShot, shots[1].BallData);
  assert.ok(s.lastShotAt > 0);
});

test('tail: a line split across reads, and a bracket that arrives in a later read', async (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, LOG_NAME);
  fs.writeFileSync(file, text(FIXTURE_LINES.slice(0, 3)));
  const { bridge, shots } = bridgeFor(t, { logFile: file, pollMs: 100000 });   // polled by hand
  await bridge.start();
  const [m1, m2, b] = shotLines(IRON);
  fs.appendFileSync(file, `${m1}\r\n${m2.slice(0, 30)}`);       // the second marker half written
  await bridge.poll();
  fs.appendFileSync(file, `${m2.slice(30)}\r\n`);
  await bridge.poll();
  assert.equal(shots.length, 0, 'markers only: no shot yet');
  fs.appendFileSync(file, b.slice(0, b.length - 20));            // the bracket half written
  await bridge.poll();
  assert.equal(shots.length, 0, 'half a bracket is not a shot');
  fs.appendFileSync(file, b.slice(b.length - 20));               // the rest, still no newline
  await bridge.poll();
  assert.equal(shots.length, 0, 'a line is not read until it ends');
  fs.appendFileSync(file, '\r\n');
  await bridge.poll();
  assert.deepEqual(speeds(shots), [111.03125]);
  await bridge.poll();
  assert.equal(shots.length, 1, 'read once');
  // a multi-byte character split between two reads does not break the line after it
  const [n1, n2, nb] = shotLines(DRIVE);
  const odd = Buffer.from(`${stamp(new Date())} [9] WARN  Some.Logger [(null)] - café ⛳\r\n`, 'utf8');
  fs.appendFileSync(file, Buffer.concat([Buffer.from(`${n1}\r\n${n2}\r\n`), odd.subarray(0, odd.length - 4)]));
  await bridge.poll();
  fs.appendFileSync(file, Buffer.concat([odd.subarray(odd.length - 4), Buffer.from(`${nb}\r\n`)]));
  await bridge.poll();
  assert.deepEqual(speeds(shots), [111.03125, 152.4375]);
});

test('tail: the daily rollover (old log renamed, a new one started) is followed, nothing replayed', async (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, LOG_NAME);
  fs.writeFileSync(file, FIXTURE);
  const { bridge, shots } = bridgeFor(t, { logFile: file, pollMs: 100000 });
  await bridge.start();
  fs.appendFileSync(file, text(shotLines(DRIVE)));
  await bridge.poll();
  assert.equal(shots.length, 1);
  // rolled between two looks: the new file is there the next time we look
  fs.renameSync(file, `${file}.2026-11-22`);
  fs.writeFileSync(file, text(shotLines(IRON)));
  await bridge.poll();
  assert.deepEqual(speeds(shots), [152.4375, 111.03125]);
  assert.equal(bridge.status().rollovers, 1);
  fs.appendFileSync(file, text(shotLines(PUTT)));
  await bridge.poll();
  assert.deepEqual(speeds(shots), [152.4375, 111.03125, 8.455603]);
  // rolled with a look in between: the log is gone for a moment, then starts again (with a BOM this time)
  fs.renameSync(file, `${file}.2026-11-23`);
  await bridge.poll();
  assert.equal(bridge.status().logFound, false);
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text(shotLines(WEDGE), '\n'))]));
  await bridge.poll();
  assert.deepEqual(speeds(shots), [152.4375, 111.03125, 8.455603, 47.48572]);
  assert.equal(bridge.status().logFound, true);
  // a new log that already holds yesterday's shots (a copy put in its place): history, not swings
  fs.renameSync(file, `${file}.2026-11-24`);
  fs.writeFileSync(file, FIXTURE + text(shotLines(DRIVE, new Date(Date.now() - 500))));
  await bridge.poll();
  assert.deepEqual(speeds(shots), [152.4375, 111.03125, 8.455603, 47.48572, 152.4375], 'only the fresh one');
  assert.equal(bridge.status().stale, 9);
  await bridge.poll();
  assert.equal(shots.length, 5);
});

test('tail: a truncated log is read from its new start', async (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, LOG_NAME);
  fs.writeFileSync(file, FIXTURE);
  const { bridge, shots } = bridgeFor(t, { logFile: file, pollMs: 100000 });
  await bridge.start();
  fs.appendFileSync(file, text(shotLines(DRIVE)));
  await bridge.poll();
  assert.equal(shots.length, 1);
  // cut to nothing, then written to
  fs.truncateSync(file, 0);
  await bridge.poll();
  fs.appendFileSync(file, text(shotLines(IRON)));
  await bridge.poll();
  assert.deepEqual(speeds(shots), [152.4375, 111.03125]);
  // cut and rewritten between two looks, shorter than before
  fs.writeFileSync(file, text(shotLines(PUTT)));
  await bridge.poll();
  assert.deepEqual(speeds(shots), [152.4375, 111.03125, 8.455603]);
  // cut and rewritten between two looks, and already LONGER than where we were: only its
  // first bytes tell (old shots in it are history; the fresh one is a swing)
  const before = fs.statSync(file).size;
  const rewritten = text(FIXTURE_LINES.slice(0, 12)) + text(shotLines(WEDGE, new Date(Date.now() - 300)));
  assert.ok(Buffer.byteLength(rewritten) > before);
  fs.writeFileSync(file, rewritten);
  await bridge.poll();
  assert.deepEqual(speeds(shots), [152.4375, 111.03125, 8.455603, 47.48572]);
  assert.equal(bridge.status().stale, 4);
  assert.ok(bridge.status().rollovers >= 3);
});

test('tail: a log that is not there yet, and a connector folder that is not there', async (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'GSPC', LOG_NAME);
  const { bridge, shots } = bridgeFor(t, { logFile: file });
  await bridge.start();
  await waitFor(() => bridge.status().state === 'no-log', 'no-log');     // the folder is missing
  assert.deepEqual([bridge.status().dirFound, bridge.status().logFound, bridge.status().listening], [false, false, true]);
  fs.mkdirSync(path.dirname(file));
  await waitFor(() => bridge.status().state === 'listening', 'listening once the folder exists', 6000);
  assert.deepEqual([bridge.status().dirFound, bridge.status().logFound], [true, false]);
  // the connector starts and writes its log: read from the first line
  fs.writeFileSync(file, text(shotLines(DRIVE)));
  await waitFor(() => shots.length === 1, 'the first shot of a new log');
  fs.appendFileSync(file, text(shotLines(IRON)));
  await waitFor(() => shots.length === 2, 'the next shot');
  assert.deepEqual(speeds(shots), [152.4375, 111.03125]);
  assert.equal(bridge.status().logFound, true);
});

// ================================================================ the listener

test('listener: accepts the connector, holds the connection open, never writes', async (t) => {
  const dir = tmpDir(t);
  const { bridge, states } = bridgeFor(t, { logFile: path.join(dir, LOG_NAME) });
  const s0 = await bridge.start();
  assert.deepEqual([s0.state, s0.listening, s0.host, s0.connections], ['listening', true, '127.0.0.1', 0]);
  const a = await connect(bridge.port, t);
  await waitFor(() => bridge.status().state === 'connector-connected', 'connector-connected');
  const b = await connect(bridge.port, t);
  await waitFor(() => bridge.status().connections === 2, 'two connections');
  a.sock.write('{"some":"json the connector might send"}');
  await sleep(350);
  assert.deepEqual([a.seen.closed, a.seen.ended, a.seen.data], [false, false, 0], 'held open, nothing written back');
  assert.deepEqual([b.seen.closed, b.seen.ended, b.seen.data], [false, false, 0]);
  assert.ok(bridge.status().bytesReceived > 0);
  b.sock.end();                                           // a polite goodbye
  await waitFor(() => bridge.status().connections === 1, 'one left');
  assert.equal(a.seen.closed, false, 'the other connection is not touched');
  assert.equal(bridge.status().state, 'connector-connected');
  a.sock.destroy();
  await waitFor(() => bridge.status().state === 'listening', 'listening again');
  assert.ok(states.includes('connector-connected') && states[states.length - 1] === 'listening');
});

test('listener: garbage and a reset do not hurt it; what arrives can be captured, capped', async (t) => {
  const dir = tmpDir(t);
  const debugFile = path.join(dir, 'data', 'foresight-socket.log');
  const { bridge, shots } = bridgeFor(t, { logFile: path.join(dir, LOG_NAME), debugFile, debugMaxBytes: 4000 });
  await bridge.start();
  const a = await connect(bridge.port, t);
  a.sock.write(Buffer.from([0, 255, 1, 2, 3, 0x7b, 0x7b, 0x7b, 0x22, 0, 0, 13, 10]));
  await waitFor(() => bridge.status().bytesReceived === 13, 'the first bytes');
  a.sock.write('GET / HTTP/1.1\r\n\r\n');
  await waitFor(() => bridge.status().bytesReceived === 13 + 18, 'the second write');
  for (let i = 0; i < 40; i++) a.sock.write(Buffer.alloc(4096, i));    // far more than the capture's cap
  await waitFor(() => bridge.status().bytesReceived >= 13 + 18 + 40 * 4096, 'the bytes to be read');
  a.sock.resetAndDestroy();                                // the connector dies without a goodbye
  await waitFor(() => bridge.status().connections === 0, 'the dead connection to be dropped');
  assert.equal(bridge.status().state, 'listening');
  const b = await connect(bridge.port, t);                 // and comes back
  await waitFor(() => bridge.status().state === 'connector-connected', 'the reconnect');
  assert.equal(b.seen.closed, false);
  assert.equal(bridge.status().connectsTotal, 2);
  assert.equal(shots.length, 0, 'nothing on the socket is ever a shot');
  const captured = fs.readFileSync(debugFile, 'utf8');
  assert.match(captured, /conn#1 \+13 bytes 00ff0102037b7b7b2200000d0a \| /);
  assert.match(captured, /GET \/ HTTP\/1\.1/);
  assert.match(captured, /capture full/);
  assert.ok(captured.length < 4000 + 2000, `capped (${captured.length})`);
});

test('listener: a taken port is reported, not fatal, and the bridge comes up when it is freed', async (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, LOG_NAME);
  fs.writeFileSync(file, '');
  const holder = await listenOn('127.0.0.1', 0, t);       // GSPro, or another bridge
  const { bridge, shots } = bridgeFor(t, { port: holder.port, logFile: file });
  const s = await bridge.start();
  assert.deepEqual([s.state, s.listening, s.portHolder, s.port], ['port-in-use', false, 'loopback', holder.port]);
  await sleep(200);                                        // a few retries later: still standing back
  assert.equal(bridge.status().state, 'port-in-use');
  const c = await connect(holder.port, t);                 // the connector still reaches the other program
  await waitFor(() => holder.conns.length === 1, 'the holder to get the connection');
  assert.equal(bridge.status().connectsTotal, 0);
  // a shot logged meanwhile belongs to whoever holds the port (GSPro is being played, or
  // another bridge is already sending it to the Open Connect port): seen, not played
  fs.appendFileSync(file, text(shotLines(DRIVE)));
  await waitFor(() => bridge.status().unowned === 1, 'the shot to be seen');
  assert.deepEqual([shots.length, bridge.status().shots], [0, 0]);
  c.sock.destroy();
  await holder.close();
  await waitFor(() => bridge.status().state === 'listening', 'the bridge to take the freed port');
  assert.deepEqual([bridge.status().port, bridge.status().portHolder], [holder.port, null]);
  await connect(holder.port, t);
  await waitFor(() => bridge.status().state === 'connector-connected', 'the connector on the bridge');
  fs.appendFileSync(file, text(shotLines(IRON)));          // now the shots are ours
  await waitFor(() => shots.length === 1, 'a shot once the port is ours');
  assert.deepEqual(speeds(shots), [111.03125]);
});

test('one swing, one stroke: the same ball by the other road is a repeat', () => {
  let t = 1000;
  const guard = createSwingGuard({ now: () => t });
  const ball = ballDataFromValues(parseBallBracket(DRIVE));
  assert.equal(guard.isRepeat(ball, 'foresight'), false);
  t += 800;
  assert.equal(guard.isRepeat({ ...ball }, 'open-connect'), true, 'another bridge sent the same swing to Open Connect');
  assert.equal(guard.isRepeat({ ...ball, Speed: +ball.Speed.toFixed(2) }, 'open-connect'), true, 'rounded on the way: still the same swing');
  t += 800;
  assert.equal(guard.isRepeat(ballDataFromValues(parseBallBracket(IRON)), 'open-connect'), false, 'a different ball is a swing');
  assert.equal(guard.isRepeat(ballDataFromValues(parseBallBracket(IRON)), 'open-connect'), false, 'the same road twice is not this guard\'s business');
  t += 800;
  assert.equal(guard.isRepeat(ball, 'open-connect'), false);
  t += 20000;
  assert.equal(guard.isRepeat(ball, 'foresight'), false, 'long after: a new swing');
});

test('listener: stands back from a program listening on every address (no silent takeover)', async (t) => {
  const dir = tmpDir(t);
  const holder = await listenOn('0.0.0.0', 0, t);          // e.g. GSPro bound to 0.0.0.0:9050
  const { bridge } = bridgeFor(t, { port: holder.port, logFile: path.join(dir, LOG_NAME) });
  const s = await bridge.start();
  assert.equal(s.state, 'port-in-use');
  assert.equal(s.listening, false);
  await sleep(200);
  await connect(holder.port, t);
  await waitFor(() => holder.conns.length === 1, 'the holder to keep getting loopback connections');
  assert.equal(bridge.status().connectsTotal, 0, 'the bridge took nothing');
  await holder.close();
  await waitFor(() => bridge.status().state === 'listening', 'the bridge to come up');
});

test('listener: stop lets go of everything; a new log path keeps the connector', async (t) => {
  const dir = tmpDir(t);
  const one = path.join(dir, 'one', LOG_NAME);
  const two = path.join(dir, 'two', LOG_NAME);
  fs.mkdirSync(path.dirname(one)); fs.mkdirSync(path.dirname(two));
  fs.writeFileSync(one, ''); fs.writeFileSync(two, text(FIXTURE_LINES.slice(0, 3)));
  const { bridge, shots } = bridgeFor(t, { logFile: one });
  await bridge.start();
  const port = bridge.port;
  const a = await connect(port, t);
  await waitFor(() => bridge.status().connections === 1, 'the connector');
  await bridge.setLogFile(two);
  assert.equal(bridge.status().logFile, two);
  fs.appendFileSync(one, text(shotLines(IRON)));           // the old log is no longer read
  fs.appendFileSync(two, text(shotLines(DRIVE)));
  await waitFor(() => shots.length === 1, 'a shot from the new log');
  await sleep(80);
  assert.deepEqual(speeds(shots), [152.4375]);
  assert.deepEqual([a.seen.closed, bridge.status().connections, bridge.port], [false, 1, port], 'the connection was not touched');
  const off = await bridge.stop();
  assert.deepEqual([off.state, off.listening, off.connections], ['off', false, 0]);
  await waitFor(() => a.seen.closed, 'the connection to close with the bridge');
  const again = await listenOn('127.0.0.1', port, t);     // the port is free
  await again.close();
  fs.appendFileSync(two, text(shotLines(PUTT)));
  await sleep(120);
  assert.equal(shots.length, 1, 'a stopped bridge reads nothing');
});

// ================================================================ the setting

test('setting: auto / on / off, where the log is looked for, and what is saved', async (t) => {
  const dir = tmpDir(t);
  const gspc = path.join(dir, 'GSPro', 'Core', 'GSPC');
  const dataDir = path.join(dir, 'data');
  const quiet = { log() {}, warn() {} };
  const mk = (env, opts = {}) => {
    // defaultDir: never the real C:\\GSProV1 folder of the PC the tests run on
    const m = createForesightManager({ dataDir, env: { BIRDIE_FORESIGHT_PORT: '0', ...env }, log: quiet, defaultDir: path.join(dir, 'no-gspro-here'), bridgeOptions: { pollMs: 20, retryMs: 60 }, ...opts });
    t.after(() => m.stop());
    return m;
  };
  // where the log is looked for, best first
  assert.deepEqual(logCandidates({ env: {} }).map((c) => [c.from, c.file]), [['default', path.join(DEFAULT_CONNECTOR_DIR, LOG_NAME)]]);
  assert.deepEqual(
    logCandidates({ env: { BIRDIE_FORESIGHT_LOG: path.join(dir, 'x.txt'), BIRDIE_GSPCONNECT_DIR: gspc }, setting: path.join(dir, 'set') }).map((c) => c.from),
    ['env', 'setting', 'env-dir', 'default'],
  );
  assert.equal(logFileFromPath(path.join(dir, 'somewhere')), path.join(dir, 'somewhere', LOG_NAME), 'a folder means the log in it');
  assert.equal(logFileFromPath(path.join(dir, 'My.Log.txt')), path.join(dir, 'My.Log.txt'));

  // auto, no connector on this PC: idle, and it says why
  let m = mk({ BIRDIE_GSPCONNECT_DIR: gspc, BIRDIE_FORESIGHT_LOG: path.join(gspc, LOG_NAME) });
  let s = await m.start();
  assert.deepEqual([s.mode, s.active, s.idleReason, s.state, s.listening, s.experimental], ['auto', false, 'no-connector', 'no-log', false, true]);
  await m.stop();

  fs.mkdirSync(gspc, { recursive: true });
  assert.deepEqual(findConnectorLog({ env: { BIRDIE_GSPCONNECT_DIR: gspc } }), { from: 'env-dir', file: path.join(gspc, LOG_NAME), dir: gspc, dirFound: true });
  const env = { BIRDIE_GSPCONNECT_DIR: gspc, BIRDIE_FORESIGHT_LOG: path.join(gspc, LOG_NAME) };

  // auto on a second copy of the game (private ports): the connector's port is left alone
  m = mk(env, { primary: false });
  s = await m.start();
  assert.deepEqual([s.mode, s.active, s.idleReason, s.state, s.listening], ['auto', false, 'private-instance', 'off', false]);
  await m.stop();

  // auto on the bay's own game, connector folder found: up
  const shots = [];
  m = mk(env, { onShot: (msg) => shots.push(msg) });
  s = await m.start();
  assert.deepEqual([s.mode, s.active, s.idleReason, s.state, s.listening, s.logFile], ['auto', true, null, 'listening', true, path.join(gspc, LOG_NAME)]);
  const a = await connect(s.port, t);
  await waitFor(() => m.status().state === 'connector-connected', 'the connector');
  // the same setting again changes nothing: the connector is not dropped
  s = await m.configure({ mode: 'auto' });
  assert.deepEqual([s.state, a.seen.closed], ['connector-connected', false]);
  fs.writeFileSync(path.join(gspc, LOG_NAME), text(shotLines(DRIVE)));
  await waitFor(() => shots.length === 1, 'a shot through the manager');
  // off: down, the port let go, and the choice is kept
  s = await m.configure({ mode: 'off' });
  assert.deepEqual([s.mode, s.active, s.state, s.listening, s.idleReason], ['off', false, 'off', false, 'off']);
  await waitFor(() => a.seen.closed, 'the connection to close');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'foresight.json'), 'utf8')), { version: 1, mode: 'off', logFile: null });
  assert.throws(() => m.configure({ mode: 'sometimes' }), { code: 'BAD_SETTING' });
  assert.throws(() => m.configure({ logFile: 'relative\\path' }), { code: 'BAD_SETTING' });
  assert.throws(() => m.configure({ logFile: 42 }), { code: 'BAD_SETTING' });
  await m.stop();

  // a new game reads the saved choice; the environment can overrule it; a log path can be set
  m = mk({});
  assert.equal(m.status().mode, 'off');
  s = await m.configure({ mode: 'on', logFile: gspc });    // the folder is enough
  assert.deepEqual([s.mode, s.active, s.state, s.logFile, s.logFrom, s.savedLogFile], ['on', true, 'listening', path.join(gspc, LOG_NAME), 'setting', path.join(gspc, LOG_NAME)]);
  s = await m.configure({ logFile: '' });                  // forgotten: back to the default place
  assert.equal(s.savedLogFile, null);
  assert.equal(s.logFrom, 'default');
  await m.stop();
  m = mk({ BIRDIE_FORESIGHT: 'off' });
  s = await m.start();
  assert.deepEqual([s.mode, s.modeFrom, s.active], ['off', 'env', false]);
  await m.stop();
});

// ================================================================ end to end

test('end to end: a connector on TCP 9051 and its log, through a game server, played exactly once', async (t) => {
  const dir = E2E_DIR;
  const dataDir = process.env.BIRDIE_DATA_DIR;
  const gspc = path.join(dir, 'GSPC');
  const logFile = path.join(gspc, LOG_NAME);
  fs.mkdirSync(path.join(dataDir, 'courses'), { recursive: true });
  fs.mkdirSync(gspc);
  fs.writeFileSync(logFile, FIXTURE);                      // yesterday's shots: never to be replayed
  const pin = [0, 500];                                    // a long hole: four swings never finish it
  fs.writeFileSync(path.join(dataDir, 'courses', 'osm-way-901.json'), JSON.stringify({
    version: 4, name: 'Bridge Test Stage',
    source: { courseId: 'osm:way:901', osmType: 'way', osmId: 901 },
    origin: { lat: 47, lon: -122 }, surfaces: [], boundary: null, elevation: null,
    holes: [{ ref: 1, par: 5, tee: [0, 0], pin, line: [[0, 0], pin], lengthYd: 547 }],
    arcade: { theme: 'links', formatVersion: 2, wind: { min: 0, max: 0 } },
  }));
  // is the test port free? (9051 is this stream's; a clear failure beats a confusing one)
  const probe = await listenOn('127.0.0.1', E2E_BRIDGE_PORT).catch(() => null);
  assert.ok(probe, `TCP ${E2E_BRIDGE_PORT} is in use: set BIRDIE_TEST_FORESIGHT_PORT to a free port`);
  await probe.close();
  Object.assign(process.env, {
    BIRDIE_PORT: '0', BIRDIE_OC_PORT: String(E2E_OC_PORT), BIRDIE_NO_AUTOLOAD: '1', BIRDIE_NO_WATCH: '1', BIRDIE_ENRICH: '0', BIRDIE_SKY_PREFETCH: '0',
    BIRDIE_DATA_DIR: dataDir, BIRDIE_ART_DIR: path.join(dataDir, 'missing-art'),
    BIRDIE_FORESIGHT: 'on', BIRDIE_FORESIGHT_PORT: String(E2E_BRIDGE_PORT), BIRDIE_FORESIGHT_LOG: logFile,
  });
  const server = require('../server.js');
  const { httpPort } = await server.ready;
  const base = `http://127.0.0.1:${httpPort}`;
  const get = (p) => fetch(base + p).then((r) => r.json());
  const post = async (p, body = {}) => {
    const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, ...(await r.json()) };
  };
  await server.foresight.start();                           // the boot's own start has finished
  // the page's event stream: every event by name
  const seen = { shot: [], lm: [], foresight: [], 'shell-swing': [], bag: [], hello: [] };
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

  try {
    await waitFor(() => seen.hello.length === 1, 'the event stream');
    // the bridge is up on the test port, waiting; the page was told so when it connected
    let st = await get('/api/foresight');
    assert.deepEqual([st.ok, st.mode, st.modeFrom, st.active, st.state, st.port, st.logFile, st.logFound, st.experimental],
      [true, 'on', 'env', true, 'listening', E2E_BRIDGE_PORT, logFile, true, true]);
    assert.deepEqual(seen.lm[0], { connected: false, ready: false, source: null, foresight: 'listening' });
    assert.equal(seen.foresight[0].state, 'listening');

    const loaded = await post('/api/load-course', { cached: 'osm-way-901.json' });
    assert.equal(loaded.ok, true, JSON.stringify(loaded));
    const plain = await post('/api/arcade/settings', { enabled: false });   // a plain ball: the launch is the monitor's, untouched
    assert.equal(plain.enabled, false);
    await post('/api/club', { club: 'DR' });                // the page picks a club when it lines the shot up

    // the connector dials in: the launch monitor light goes on, and names its source
    const connector = await connect(E2E_BRIDGE_PORT);
    await waitFor(() => seen.lm.some((l) => l.connected && l.source === 'foresight'), 'the lm status');
    assert.deepEqual(seen.lm[seen.lm.length - 1], { connected: true, ready: false, source: 'foresight', foresight: 'connector-connected' });
    assert.equal((await get('/api/foresight')).state, 'connector-connected');
    connector.sock.write('whatever the connector says to GSPro');

    // a swing: the connector writes its three lines
    const drive = shotLines(DRIVE);
    fs.appendFileSync(logFile, text(drive));
    await waitFor(() => seen.shot.length === 1, 'the shot in the game');
    await sleep(400);
    assert.equal(seen.shot.length, 1, 'played exactly once');
    const shot = seen.shot[0];
    assert.equal(shot.source, 'foresight');
    assert.deepEqual(shot.launch, { speedMph: 152.4375, vla: 11.25, hla: -1.5, totalSpin: 2540.5, spinAxis: -7.01 });
    assert.ok(shot.sim.carryYd > 180 && shot.sim.carryYd < 320, `a drive (${shot.sim.carryYd} yd)`);
    assert.equal(shot.strokes, 1);
    // the same bag recording as an Open Connect shot
    await waitFor(() => seen.bag.length === 1, 'the bag');
    assert.equal(seen.bag[0].n, 1);
    const bagClub = (await get('/api/bag')).clubs.find((c) => c.club === seen.bag[0].club);
    assert.equal(bagClub.n, 1);
    st = await get('/api/foresight');
    assert.deepEqual([st.shots, st.duplicates, st.stale, st.ignored], [1, 0, 0, 0]);
    assert.deepEqual(st.lastShot, { Speed: 152.4375, SpinAxis: -7.01, TotalSpin: 2540.5, BackSpin: 2521, SideSpin: -310, HLA: -1.5, VLA: 11.25 });
    assert.ok(Date.now() - st.lastShotAt < 5000);

    // the same lines again (a log read twice, a connector that logs twice): not a second stroke
    fs.appendFileSync(logFile, text(drive));
    await waitFor(async () => (await get('/api/foresight')).duplicates === 1, 'the duplicate to be seen');
    await sleep(150);
    assert.equal(seen.shot.length, 1);
    assert.equal((await get('/api/state')).strokes, 1);

    // the same gating as any swing: while the page is in its menus the swing is nobody's shot
    await post('/api/shell', { cid: seen.hello[0].cid, screen: 'menu' });
    fs.appendFileSync(logFile, text(shotLines(IRON)));
    await waitFor(() => seen['shell-swing'].length === 1, 'the menu to be told of the swing');
    assert.deepEqual(seen['shell-swing'][0], { speedMph: 111.03125 });
    await sleep(100);
    assert.equal(seen.shot.length, 1);
    assert.equal((await get('/api/state')).strokes, 1);
    assert.equal((await get('/api/bag')).total, 1, 'a swing the menus dropped is not in the bag');
    await post('/api/shell', { cid: seen.hello[0].cid, screen: 'game' });

    // the next real swing is played
    fs.appendFileSync(logFile, text(shotLines(WEDGE), '\n'));
    await waitFor(() => seen.shot.length === 2, 'the second shot');
    assert.equal(seen.shot[1].source, 'foresight');
    assert.deepEqual(seen.shot[1].launch, { speedMph: 47.48572, vla: 42.81155, hla: -25.90489, totalSpin: 2674.085, spinAxis: -34.302166 });
    assert.equal(seen.shot[1].strokes, 2);

    // another bridge program reading the same log sends that swing to the Open Connect port as
    // well: acknowledged, not played again. A different ball on that port is a shot like any other.
    const ocClient = await connect(E2E_OC_PORT);
    ocClient.sock.write(JSON.stringify(toOpenConnect(ballDataFromValues(parseBallBracket(WEDGE)), 1)));
    await waitFor(() => ocClient.seen.data > 0, 'the Open Connect reply');
    await sleep(250);
    assert.equal(seen.shot.length, 2, 'the same swing by the other road is not a second stroke');
    assert.equal((await get('/api/state')).strokes, 2);
    ocClient.sock.write(JSON.stringify(toOpenConnect({ Speed: 70, SpinAxis: 0, TotalSpin: 5200, BackSpin: 5200, SideSpin: 0, HLA: 1, VLA: 24 }, 2)));
    await waitFor(() => seen.shot.length === 3, 'an Open Connect shot');
    assert.equal(seen.shot[2].source, 'open-connect');
    assert.equal(seen.shot[2].strokes, 3);
    ocClient.sock.destroy();
    await waitFor(() => seen.lm[seen.lm.length - 1].source === 'foresight', 'the light to name the bridge again');

    // a test shot is still a test shot (no source), and the setting's route checks its input
    await post('/api/test-shot', { speed: 60, vla: 20, hla: 0, spin: 5000, spinAxis: 0 });
    await waitFor(() => seen.shot.length === 4, 'the test shot');
    assert.equal(seen.shot[3].source, undefined);
    const bad = await post('/api/foresight', { mode: 'sometimes' });
    assert.deepEqual([bad.status, bad.ok, bad.code], [400, false, 'BAD_SETTING']);

    // the connector goes away: the light goes off; nothing else changes
    assert.equal(connector.seen.closed, false, 'held open the whole time');
    assert.equal(connector.seen.data, 0, 'and never written to');
    connector.sock.resetAndDestroy();
    await waitFor(() => seen.lm[seen.lm.length - 1].connected === false, 'the light to go off');
    assert.deepEqual(seen.lm[seen.lm.length - 1], { connected: false, ready: false, source: null, foresight: 'listening' });

    // the settings route answers the status; here the environment pins the mode, and says so
    const pinned = await post('/api/foresight', { mode: 'off' });
    assert.deepEqual([pinned.status, pinned.ok, pinned.mode, pinned.modeFrom, pinned.state], [200, true, 'on', 'env', 'listening']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'foresight.json'), 'utf8')).mode, 'off', 'the choice is saved for the next start');
    // closing the game lets go of the port
    await server.foresight.stop();
    assert.equal((await get('/api/foresight')).listening, false);
    const free = await listenOn('127.0.0.1', E2E_BRIDGE_PORT);
    await free.close();
  } finally {
    sse.abort();
    server.close();
  }
});

// ================================================================ the panel's words

test('panel: every state in plain words (public/arcade/foresight-panel.js)', async () => {
  const { describeForesight, agoText, mountForesightPanel, default: byDefault } = await import('../public/arcade/foresight-panel.js');
  assert.equal(typeof mountForesightPanel, 'function');
  assert.equal(byDefault, mountForesightPanel);
  const now = 1_800_000_000_000;
  const d = (s) => describeForesight({ port: 9050, ...s }, now);
  assert.deepEqual(d({ state: 'listening' }), {
    tone: 'wait', title: 'Waiting for the connector',
    help: 'Open the Foresight connector (GSPconnect) and connect your launch monitor.', last: '',
  });
  assert.equal(d({ state: 'port-in-use' }).tone, 'warn');
  assert.match(d({ state: 'port-in-use' }).help, /^Close GSPro or any other bridge: something else is using port 9050\./);
  assert.match(d({ state: 'port-in-use', port: 9051 }).help, /port 9051/);
  assert.deepEqual([d({ state: 'connector-connected', shots: 0 }).tone, d({ state: 'connector-connected', shots: 0 }).title], ['ok', 'Connector found, waiting for a shot']);
  const playing = d({ state: 'connector-connected', shots: 3, lastShotAt: now - 14000, lastShot: { Speed: 152.4375 } });
  assert.deepEqual([playing.title, playing.last], ['Foresight connected', 'Last shot 14 s ago · 152.4 mph']);
  assert.match(d({ state: 'no-log', active: true, logDir: 'D:\GSPro\Core\GSPC' }).help, /D:\GSPro\Core\GSPC/);
  assert.deepEqual([d({ state: 'no-log', active: false }).title, d({ state: 'no-log', active: false }).tone, d({ state: 'no-log', active: true }).tone], ['No Foresight connector on this PC', 'off', 'warn']);
  assert.equal(d({ state: 'off', idleReason: 'off' }).tone, 'off');
  assert.match(d({ state: 'off', idleReason: 'private-instance' }).help, /Choose On/);
  assert.match(d({ state: 'error', lastError: 'EADDRNOTAVAIL' }).help, /EADDRNOTAVAIL/);
  assert.equal(describeForesight(null).title, 'Off');
  assert.deepEqual([0, 2999, 14000, 89000, 90000, 3600000 * 3].map(agoText), ['just now', 'just now', '14 s ago', '89 s ago', '1 min ago', '3 h ago']);
});
