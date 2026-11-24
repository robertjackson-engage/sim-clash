'use strict';
// v2:connect Open Connect conformance: the messages real connectors put on the wire, sent
// to lib/openconnect.js over a real socket. Each case is built from protocol FACTS read in
// the GSPro Open Connect v1 specification (https://gsprogolf.com/GSProConnectV1.html) and
// in the source of open-source connectors (their licences: docs/launch-monitors.md, "Open
// Connect conformance"). No code of theirs is used here: only what they send and expect.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { OpenConnectServer, SEND_GAP_MS, toOpenConnectClub, classifyMessage, normalizeMessage } = require('../lib/openconnect');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A server on a free port and one connector on it. chunks: every packet as it arrived
// (the server promises one JSON object per packet); events: what the server emitted.
async function rig(t) {
  const oc = new OpenConnectServer(0);
  const events = [];
  for (const name of ['shot', 'heartbeat', 'status', 'club', 'ignored', 'duplicate', 'message']) {
    oc.on(name, (d) => events.push({ name, d }));
  }
  oc.start();
  await new Promise((resolve) => oc.server.once('listening', resolve));
  const sock = net.connect(oc.server.address().port, '127.0.0.1');
  const chunks = [];
  sock.on('data', (c) => chunks.push({ at: Date.now(), text: c.toString('utf8') }));
  sock.on('error', () => {});
  await new Promise((resolve) => sock.once('connect', resolve));
  t.after(() => { sock.destroy(); oc.server.close(); });
  const replies = () => chunks.map((c) => JSON.parse(c.text));
  const until = async (fn, ms = 2000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (fn()) return true; await sleep(10); }
    return false;
  };
  const of = (name) => events.filter((e) => e.name === name).map((e) => e.d);
  return { oc, sock, chunks, replies, until, of, events };
}

const BALL = { Speed: 142.3, SpinAxis: -3.1, TotalSpin: 2850, BackSpin: 2845, SideSpin: -154, HLA: 1.2, VLA: 13.4, CarryDistance: 248 };
const specShot = (n = 1, extra = {}) => ({
  DeviceID: 'GSPro LM 1.1', Units: 'Yards', ShotNumber: n, APIversion: '1',
  BallData: { ...BALL },
  ClubData: { Speed: 0, AngleOfAttack: 0, FaceToTarget: 0, Lie: 0, Loft: 0, Path: 0, SpeedAtImpact: 0, VerticalFaceImpact: 0, HorizontalFaceImpact: 0, ClosureRate: 0 },
  ShotDataOptions: { ContainsBallData: true, ContainsClubData: false, LaunchMonitorIsReady: true, LaunchMonitorBallDetected: true, IsHeartBeat: false },
  ...extra,
});

test('the specification\'s own example shot is played once and answered with a single 200', async (t) => {
  const r = await rig(t);
  r.sock.write(JSON.stringify(specShot(13)));
  assert.ok(await r.until(() => r.replies().some((x) => x.Code === 200)));
  await sleep(SEND_GAP_MS * 2);
  const replies = r.replies();
  assert.equal(replies[0].Code, 201, 'the greeting');
  assert.equal(replies.filter((x) => x.Code === 200).length, 1);
  const [shot] = r.of('shot');
  assert.equal(r.of('shot').length, 1);
  assert.equal(shot.shotNumber, 13);
  assert.equal(shot.units, 'Yards');
  assert.deepEqual(shot.ball, BALL);
  assert.equal(shot.club, null, 'ContainsClubData false: no club data, even though the block is there');
});

test('every reply is one compact JSON object in a packet of its own, with a number for Code', async (t) => {
  const r = await rig(t);
  // two objects back to back in ONE write (a heartbeat and a shot), as a connector's buffer may flush them
  r.sock.write(JSON.stringify({ DeviceID: 'x', ShotNumber: 0, APIversion: '1', ShotDataOptions: { ContainsBallData: false, ContainsClubData: false, IsHeartBeat: true } }) + JSON.stringify(specShot(1)));
  r.oc.setPlayer({ DistanceToTarget: 150 });
  assert.ok(await r.until(() => r.chunks.length >= 4));
  await sleep(SEND_GAP_MS * 2);
  for (const c of r.chunks) {
    assert.ok(!/[\r\n]/.test(c.text), 'no newline: one connector fails on a newline between objects');
    const obj = JSON.parse(c.text);   // throws if two objects shared a packet
    assert.equal(typeof obj.Code, 'number');
    assert.equal(typeof obj.Message, 'string');
  }
  for (let i = 1; i < r.chunks.length; i++) {
    assert.ok(r.chunks[i].at - r.chunks[i - 1].at >= SEND_GAP_MS - 25, `replies ${i - 1} and ${i} are apart`);
  }
  assert.equal(r.of('shot').length, 1);
  assert.equal(r.of('heartbeat').length, 1);
});

test('the 201 is a whole GSPro player: exact message, RH/LH, a GSPro club code, a distance above zero', async (t) => {
  const r = await rig(t);
  r.oc.setPlayer({ Handed: 'lh', Club: '5i', DistanceToTarget: 0 });
  assert.ok(await r.until(() => r.replies().length >= 2));
  for (const m of r.replies()) {
    assert.equal(m.Code, 201);
    assert.equal(m.Message, 'GSPro Player Information');
    assert.ok(['RH', 'LH'].includes(m.Player.Handed));
    assert.match(m.Player.Club, /^(DR|[WH][2-7]|I[1-9]|PW|GW|SW|LW|PT)$/);
    assert.ok(Number.isInteger(m.Player.DistanceToTarget) && m.Player.DistanceToTarget >= 1);
  }
  assert.deepEqual(r.replies().at(-1).Player, { Handed: 'LH', Club: 'I5', DistanceToTarget: 1 });
});

// MLM2PRO-GSPro-Connector (GPL-3.0): "Backspin" with a small s, ContainsClubData always
// true, no heartbeat; it waits 2 s for any reply, then sends the SAME payload once more.
test('MLM2PRO connector: "Backspin" is read, and its repeat of a shot is acknowledged, not replayed', async (t) => {
  const r = await rig(t);
  const payload = JSON.stringify({
    DeviceID: 'Rapsodo MLM2PRO', Units: 'Yards', ShotNumber: 1, APIversion: '1',
    BallData: { Speed: 120.5, SpinAxis: 4.2, TotalSpin: 5200, HLA: -1.5, VLA: 17.8, Backspin: 5186, SideSpin: 381, CarryDistance: 0 },
    ClubData: { Speed: 84, AngleOfAttack: 0, FaceToTarget: 0, Lie: 0, Loft: 0, Path: 1.1, SpeedAtImpact: 84, VerticalFaceImpact: 0, HorizontalFaceImpact: 0.6, ClosureRate: 0 },
    ShotDataOptions: { ContainsBallData: true, ContainsClubData: true },
  });
  r.sock.write(payload);
  assert.ok(await r.until(() => r.replies().filter((x) => x.Code === 200).length === 1));
  r.sock.write(payload);
  assert.ok(await r.until(() => r.replies().filter((x) => x.Code === 200).length === 2), 'the repeat is answered too, so the connector stops');
  const shots = r.of('shot');
  assert.equal(shots.length, 1);
  assert.equal(shots[0].ball.BackSpin, 5186);
  assert.ok(!('Backspin' in shots[0].ball));
  assert.equal(shots[0].club.Path, 1.1);
  assert.equal(r.of('duplicate').length, 1);
});

// gsp-r10-adapter (MIT): one heartbeat on connect with "APIVersion", ShotNumber 0 and
// "BallData": null; shots start at ShotNumber 0 and carry only the two Contains flags.
test('R10 adapter: a heartbeat with null ball data, then shot number 0', async (t) => {
  const r = await rig(t);
  r.sock.write(JSON.stringify({
    DeviceID: 'GSPRO-R10', Units: 'Yards', ShotNumber: 0, APIVersion: '1', BallData: null, ClubData: null,
    ShotDataOptions: { ContainsBallData: false, ContainsClubData: false, LaunchMonitorIsReady: false, LaunchMonitorBallDetected: false, IsHeartBeat: true },
  }));
  assert.ok(await r.until(() => r.of('heartbeat').length === 1));
  assert.deepEqual(r.of('status'), [{ ready: false, ballDetected: false }]);
  const shot = (speed) => JSON.stringify({
    DeviceID: 'GSPRO-R10', Units: 'Yards', ShotNumber: 0, APIVersion: '1',
    BallData: { Speed: speed, SpinAxis: -2, TotalSpin: 3100, BackSpin: 3098, SideSpin: -108, HLA: 0.4, VLA: 14, CarryDistance: 0 },
    ClubData: { Speed: 95, AngleOfAttack: -1, FaceToTarget: 0.5, Path: 1 },
    ShotDataOptions: { ContainsBallData: true, ContainsClubData: true },
  });
  r.sock.write(shot(130));
  await sleep(40);
  r.sock.write(shot(131));
  assert.ok(await r.until(() => r.of('shot').length === 2), 'two unnumbered shots are two shots');
  assert.equal(r.of('duplicate').length, 0);
});

// MLM2PRO-BT-APP (MIT): its keys are spelled DeviceId / ApiVersion / Hla / Vla; in one mode
// its real shots carry IsHeartBeat true; a misread goes out with a speed of zero.
test('MLM2PRO BT app: its spelling is read, a shot flagged as a heartbeat is a shot, a zero-speed one is not', async (t) => {
  const r = await rig(t);
  r.sock.write(JSON.stringify({
    DeviceId: 'SquareGolf', Units: 'Yards', ShotNumber: 7, ApiVersion: '1',
    BallData: { Speed: 98.6, SpinAxis: 1.5, TotalSpin: 6400, BackSpin: 6398, SideSpin: 167, Hla: 2.5, Vla: 21.3 },
    ClubData: { Speed: 72 },
    ShotDataOptions: { ContainsBallData: true, ContainsClubData: true, LaunchMonitorIsReady: true, LaunchMonitorBallDetected: true, IsHeartBeat: true },
  }));
  assert.ok(await r.until(() => r.of('shot').length === 1));
  const [shot] = r.of('shot');
  assert.equal(shot.device, 'SquareGolf');
  assert.equal(shot.ball.HLA, 2.5);
  assert.equal(shot.ball.VLA, 21.3);
  r.sock.write(JSON.stringify({
    DeviceId: 'SquareGolf', Units: 'Yards', ShotNumber: 8, ApiVersion: '1',
    BallData: { Speed: 0, SpinAxis: 0, TotalSpin: 0, Hla: 0, Vla: 0 },
    ShotDataOptions: { ContainsBallData: true, ContainsClubData: false },
  }));
  assert.ok(await r.until(() => r.of('ignored').length === 1));
  assert.equal(r.of('shot').length, 1, 'no speed: acknowledged, never played');
  assert.ok(await r.until(() => r.replies().filter((x) => x.Code === 200).length === 2), 'both are answered');
  // its keep-alive: a status with a constant ShotNumber, both flags true, no ball data
  r.sock.write(JSON.stringify({ DeviceId: 'SquareGolf', ShotNumber: 2, ApiVersion: '1', ShotDataOptions: { ContainsBallData: false, ContainsClubData: false, LaunchMonitorIsReady: true, LaunchMonitorBallDetected: true } }));
  assert.ok(await r.until(() => r.of('status').some((s) => s.ready && s.ballDetected)));
});

// PiTrac (GPL-2.0): pretty-printed JSON over many lines with a newline after it; a
// heartbeat (ShotNumber 0, ready, zeroed ball data) on connect and on ball-detected change.
test('PiTrac: pretty-printed, newline-terminated objects, also when split across packets', async (t) => {
  const r = await rig(t);
  const heartbeat = JSON.stringify({
    DeviceID: 'PiTrac LM 0.1', Units: 'Yards', ShotNumber: 0, APIversion: '1',
    BallData: { Speed: 0, SpinAxis: 0, TotalSpin: 0, BackSpin: 0, SideSpin: 0, HLA: 0, VLA: 0 },
    ClubData: { Speed: 0 },
    ShotDataOptions: { ContainsBallData: false, ContainsClubData: false, LaunchMonitorIsReady: true, LaunchMonitorBallDetected: true, IsHeartBeat: true },
  }, null, 4) + '\n';
  const shot = JSON.stringify({
    DeviceID: 'PiTrac LM 0.1', Units: 'Yards', ShotNumber: 1, APIversion: '1',
    BallData: { Speed: 87.2, SpinAxis: 6.3, TotalSpin: 7350.2, BackSpin: 7305.8, SideSpin: 806.6, HLA: 3.1, VLA: 24.6 },
    ClubData: { Speed: 0 },
    ShotDataOptions: { ContainsBallData: true, ContainsClubData: false, LaunchMonitorIsReady: true, LaunchMonitorBallDetected: true, IsHeartBeat: false },
  }, null, 4) + '\n';
  const all = heartbeat + shot;
  const cut = heartbeat.length + Math.floor(shot.length / 2);
  r.sock.write(all.slice(0, cut));
  await sleep(40);
  r.sock.write(all.slice(cut));
  assert.ok(await r.until(() => r.of('shot').length === 1));
  assert.equal(r.of('heartbeat').length, 1);
  assert.deepEqual(r.of('status'), [{ ready: true, ballDetected: true }], 'the heartbeat carries the ready light');
  assert.equal(r.of('shot')[0].ball.Speed, 87.2);
  assert.ok(!r.replies().some((x) => x.Code >= 500), 'the newlines between objects are not errors');
});

// OpenFlight (AGPL-3.0): a heartbeat every 5 s while idle, with zeroed ball and club data
// present and ContainsBallData false.
test('OpenFlight: an idle heartbeat with zeroed ball data is not a shot', async (t) => {
  const r = await rig(t);
  r.sock.write(JSON.stringify({
    DeviceID: 'OpenFlight', Units: 'Yards', ShotNumber: 0, APIversion: '1',
    BallData: { Speed: 0, SpinAxis: 0, TotalSpin: 0, BackSpin: 0, SideSpin: 0, HLA: 0, VLA: 0, CarryDistance: 0 },
    ClubData: { Speed: 0, Path: 0 },
    ShotDataOptions: { ContainsBallData: false, ContainsClubData: false, LaunchMonitorIsReady: true, LaunchMonitorBallDetected: false, IsHeartBeat: true },
  }));
  assert.ok(await r.until(() => r.of('heartbeat').length === 1));
  assert.equal(r.of('shot').length, 0);
  assert.equal(r.of('ignored').length, 0);
  assert.deepEqual(r.of('status'), [{ ready: true, ballDetected: false }]);
  assert.ok(await r.until(() => r.replies().at(-1).Message === 'Heartbeat OK'),'a shot\'s reply never says "heartbeat"; a heartbeat\'s does');
});

// The Square connector (MIT): newline after each object; a ready status 500 ms after
// connecting (false flags left out, no IsHeartBeat key); the ball data and the club data
// of one shot as two messages with the same ShotNumber.
test('Square connector: a ready status, then ball data and club data as two messages of one shot', async (t) => {
  const r = await rig(t);
  r.sock.write(JSON.stringify({ DeviceID: 'CustomLaunchMonitor', Units: 'Yards', ShotNumber: 0, APIversion: '1', ShotDataOptions: { ContainsBallData: false, ContainsClubData: false, LaunchMonitorIsReady: true } }) + '\n');
  assert.ok(await r.until(() => r.of('status').length === 1));
  assert.deepEqual(r.of('status')[0], { ready: true, ballDetected: false });
  r.sock.write(JSON.stringify({
    DeviceID: 'CustomLaunchMonitor', Units: 'Yards', ShotNumber: 1, APIversion: '1',
    BallData: { Speed: 151.2, SpinAxis: -5.5, TotalSpin: 2450, BackSpin: 2439, SideSpin: 235, HLA: -0.8, VLA: 11.9 },
    ClubData: { Speed: 0 },
    ShotDataOptions: { ContainsBallData: true, ContainsClubData: false },
  }) + '\n');
  r.sock.write(JSON.stringify({
    DeviceID: 'CustomLaunchMonitor', Units: 'Yards', ShotNumber: 1, APIversion: '1',
    ClubData: { Speed: 104.5, AngleOfAttack: 2.1, FaceToTarget: -0.7, Path: 1.9 },
    ShotDataOptions: { ContainsBallData: false, ContainsClubData: true },
  }) + '\n');
  assert.ok(await r.until(() => r.of('club').length === 1));
  assert.equal(r.of('shot').length, 1, 'the club data is not a second shot');
  assert.equal(r.of('club')[0].shotNumber, 1);
  assert.equal(r.of('club')[0].club.Speed, 104.5);
  assert.equal(r.of('status').length, 1, 'and it is not a status message: the ready light stays as it was');
});

// gspro-garmin-connect-v2 (MIT per its package.json): no Units key at all, all ten club
// fields with ContainsClubData true, ball data without BackSpin / SideSpin.
test('Garmin connect v2: a shot with no Units key and no back or side spin', async (t) => {
  const r = await rig(t);
  r.sock.write(JSON.stringify({
    DeviceID: 'GSPro LM 1.1', ShotNumber: 1, APIversion: '1',
    BallData: { Speed: 109.9, SpinAxis: 2.2, TotalSpin: 6900, HLA: 0.9, VLA: 19.5 },
    ClubData: { Speed: 80.1, AngleOfAttack: -3.2, FaceToTarget: 0.4, Lie: 0, Loft: 0, Path: -0.6, SpeedAtImpact: 80.1, VerticalFaceImpact: 0, HorizontalFaceImpact: 0, ClosureRate: 0 },
    ShotDataOptions: { ContainsBallData: true, ContainsClubData: true },
  }));
  assert.ok(await r.until(() => r.of('shot').length === 1));
  const [shot] = r.of('shot');
  assert.equal(shot.units, 'Yards');
  assert.equal(shot.ball.TotalSpin, 6900);
  assert.equal(shot.club.AngleOfAttack, -3.2);
});

test('bad input: a 501 and the link stays up; a stray brace or noise between objects is skipped', async (t) => {
  const r = await rig(t);
  r.sock.write('{"DeviceID": "x", "ShotNumber": }');
  assert.ok(await r.until(() => r.replies().some((x) => x.Code === 501)));
  r.sock.write('}\r\n garbage ' + JSON.stringify(specShot(3)));
  assert.ok(await r.until(() => r.of('shot').length === 1), 'the stream is not wedged by what came before');
  assert.equal(r.sock.destroyed, false);
});

test('numbers sent as strings are read as numbers; a message with no flags at all is a status', () => {
  const m = normalizeMessage({ deviceid: 'x', shotnumber: 4, balldata: { speed: '101.5', vla: '18', hla: 0 }, shotdataoptions: { containsballdata: true } });
  assert.equal(m.DeviceID, 'x');
  assert.equal(m.BallData.Speed, 101.5);
  assert.equal(m.BallData.VLA, 18);
  assert.equal(classifyMessage(m), 'shot');
  assert.equal(classifyMessage(normalizeMessage({ DeviceID: 'x' })), 'status');
  assert.equal(classifyMessage(normalizeMessage({ BallData: { Speed: 120 } })), 'shot', 'ball data with a speed and no flags: lenient');
  assert.equal(classifyMessage(normalizeMessage({ BallData: { Speed: 120 }, ShotDataOptions: { ContainsBallData: false } })), 'status');
});

test('club codes: golfer labels, wedges by name or loft, and anything off GSPro\'s list go to a code on it', () => {
  const cases = { '': 'DR', DR: 'DR', '1W': 'DR', driver: 'DR', '3W': 'W3', w3: 'W3', '9W': 'W7', '3H': 'H3', H9: 'H7', '7i': 'I7', I7: 'I7', PW: 'PW', AW: 'GW', GW: 'GW', '52': 'GW', '56': 'SW', '60': 'LW', SW: 'SW', LW: 'LW', putter: 'PT', PT: 'PT' };
  for (const [given, code] of Object.entries(cases)) assert.equal(toOpenConnectClub(given), code, given);
});

test('a taken port is reported, and start() works again once it is free', async (t) => {
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(0, resolve));
  const port = blocker.address().port;
  const oc = new OpenConnectServer(port);
  t.after(() => { try { oc.server.close(); } catch (_) { /* never listened */ } });
  const err = new Promise((resolve) => oc.once('error', resolve));
  oc.start();
  assert.equal((await err).code, 'EADDRINUSE');
  assert.equal(oc.listening, false);
  await new Promise((resolve) => blocker.close(resolve));
  const up = new Promise((resolve) => oc.once('listening', resolve));
  oc.start();
  assert.equal(await up, port);
  assert.equal(oc.listening, true);
});
