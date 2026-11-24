'use strict';
// v2:connect The connection hub (lib/connect.js): the status endpoint, the diagnosis, the
// taken port and its recovery, the saved choice, and the wizard's test ball. Real sockets,
// free ports only: nothing here touches 921.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const { OpenConnectServer } = require('../lib/openconnect');
const { createConnectHub, diagnose, checkShot, shotView, programName } = require('../lib/connect');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quiet = { log() {}, warn() {}, error() {} };
const NET = { 'Wi-Fi': [{ family: 'IPv4', address: '192.168.1.40', internal: false }] };

async function freePort() {
  const s = net.createServer();
  await new Promise((resolve) => s.listen(0, resolve));
  const { port } = s.address();
  await new Promise((resolve) => s.close(resolve));
  return port;
}
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(15); }
  return false;
}

// A hub on a free port, with its HTTP routes on another, the way server.js wires them.
async function rig(t, opts = {}) {
  const port = opts.port || await freePort();
  const dataDir = opts.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'connect-test-'));
  const oc = new OpenConnectServer(port);
  oc.on('error', () => {});
  const events = [];
  const hub = createConnectHub({
    oc, port, dataDir, log: quiet, interfaces: NET, retryMs: 60,
    broadcast: (name, data) => events.push({ name, data }),
    foresight: opts.foresight || (() => null),
    holder: opts.holder || (async () => null),
  });
  const web = http.createServer((req, res) => { hub.handle(req, res, new URL(req.url, 'http://x')); });
  await new Promise((resolve) => web.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${web.address().port}`;
  const get = (p) => fetch(base + p).then((r) => r.json());
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ ...(await r.json()), http: r.status }));
  t.after(() => {
    hub.stop();
    web.close();
    for (const s of oc.clients) s.destroy();
    try { oc.server.close(); } catch (_) { /* never listened */ }
  });
  const connector = async () => {
    const sock = net.connect(port, '127.0.0.1');
    sock.on('error', () => {});
    sock.on('data', () => {});
    await new Promise((resolve) => sock.once('connect', resolve));
    t.after(() => sock.destroy());
    return sock;
  };
  return { port, dataDir, oc, hub, events, get, post, connector };
}

const shot = (n, ball = {}) => JSON.stringify({
  DeviceID: 'Test LM', Units: 'Yards', ShotNumber: n, APIversion: '1',
  BallData: { Speed: 142.3, SpinAxis: -3.1, TotalSpin: 2850, HLA: 1.2, VLA: 13.4, ...ball },
  ShotDataOptions: { ContainsBallData: true, ContainsClubData: false },
});

test('GET /api/connect/status: waiting, then a connector from this PC, ready, its last shot', async (t) => {
  const r = await rig(t);
  await r.hub.start();
  assert.ok(await until(async () => (await r.get('/api/connect/status')).listener.state === 'listening'));
  let st = await r.get('/api/connect/status');
  assert.equal(st.ok, true);
  assert.equal(st.port, r.port);
  assert.equal(st.state, 'waiting');
  assert.equal(st.connected, false);
  assert.equal(st.chosen, false);
  assert.equal(st.device, null);
  assert.equal(st.cause.id, 'no-connector');
  assert.match(st.cause.help, new RegExp(`127\\.0\\.0\\.1, port ${r.port}`));
  assert.equal(st.lanAddress, '192.168.1.40');

  const sock = await r.connector();
  assert.ok(await until(async () => (await r.get('/api/connect/status')).connected));
  st = await r.get('/api/connect/status');
  assert.equal(st.state, 'connected');
  assert.equal(st.source, 'open-connect');
  assert.equal(st.clients.length, 1);
  assert.equal(st.clients[0].local, true, 'where the connector connects from');
  assert.equal(st.cause, null);

  sock.write(JSON.stringify({ DeviceID: 'Test LM', ShotNumber: 0, APIversion: '1', ShotDataOptions: { ContainsBallData: false, ContainsClubData: false, LaunchMonitorIsReady: true, IsHeartBeat: true } }));
  assert.ok(await until(async () => (await r.get('/api/connect/status')).state === 'ready'));
  st = await r.get('/api/connect/status');
  assert.equal(st.clients[0].deviceId, 'Test LM');
  assert.ok(st.lastMessageAt >= st.connectedAt);

  sock.write(shot(1));
  assert.ok(await until(async () => (await r.get('/api/connect/status')).shots === 1));
  st = await r.get('/api/connect/status');
  assert.equal(st.lastShot.speedMph, 142.3);
  assert.equal(st.lastShot.vla, 13.4);
  assert.equal(st.lastShot.totalSpin, 2850);
  assert.equal(st.lastShot.source, 'open-connect');
  assert.equal(st.lastShot.check.ok, true);
  assert.ok(r.events.some((e) => e.name === 'connect' && e.data.lastShot), 'the page is told on its event stream');

  sock.destroy();
  assert.ok(await until(async () => !(await r.get('/api/connect/status')).connected));
  st = await r.get('/api/connect/status');
  assert.equal(st.cause.id, 'dropped');
});

test('a port another program answers on is reported to the UI, named, and taken over when it is free', async (t) => {
  const port = await freePort();
  // the other program listens on 127.0.0.1 only, as GSPro's Open API does: a plain listen on
  // every address would succeed beside it on Windows and never see a connector
  const other = net.createServer(() => {});
  await new Promise((resolve) => other.listen(port, '127.0.0.1', resolve));
  const r = await rig(t, { port, holder: async () => 'GSPconnect' });
  await r.hub.start();
  assert.ok(await until(async () => (await r.get('/api/connect/status')).listener.holderName === 'GSPconnect'));
  const st = await r.get('/api/connect/status');
  assert.equal(st.state, 'blocked');
  assert.equal(st.listener.state, 'port-in-use');
  assert.equal(st.listener.listening, false);
  assert.equal(st.cause.id, 'port-in-use');
  assert.equal(st.cause.title, 'CLOSE GSPRO');
  assert.match(st.cause.help, new RegExp(`port ${port}`));
  assert.ok(r.events.some((e) => e.name === 'connect' && e.data.listener.state === 'port-in-use'), 'reported, not only logged');

  await new Promise((resolve) => other.close(resolve));
  assert.ok(await until(async () => (await r.get('/api/connect/status')).listener.state === 'listening'), 'no restart needed');
  await r.connector();
  assert.ok(await until(async () => (await r.get('/api/connect/status')).connected));
});

test('the chosen launch monitor is remembered, and steers the diagnosis', async (t) => {
  const r = await rig(t);
  await r.hub.start();
  let out = await r.post('/api/connect/device', { id: 'no-such-monitor' });
  assert.equal(out.http, 400);
  assert.equal(out.code, 'BAD_DEVICE');
  assert.equal(out.ok, false);
  out = await r.post('/api/connect/device', { id: 'pitrac' });
  assert.equal(out.chosen, true);
  assert.equal(out.device.id, 'pitrac');
  assert.equal(out.device.tier, 'expected');
  assert.equal(out.cause.id, 'firewall', 'a connector on another device: the firewall is the usual suspect');
  assert.match(out.cause.help, /192\.168\.1\.40/);
  assert.equal((await r.get('/api/launch-monitors')).chosen, 'pitrac');

  // a second hub on the same data dir (the game started again) still knows
  const again = await rig(t, { dataDir: r.dataDir });
  assert.equal((await again.get('/api/connect/status')).device.id, 'pitrac');
  for (const id of ['other', 'none']) assert.equal((await r.post('/api/connect/device', { id })).device.id, id);
  assert.equal((await r.post('/api/connect/device', { id: null })).chosen, false, 'null forgets: the wizard is due again');
});

test('the wizard\'s test ball: held swings are shown, not played; the hold lets go', async (t) => {
  const r = await rig(t);
  await r.hub.start();
  assert.equal(r.hub.gate({ Speed: 120 }, 'open-connect'), false, 'no hold: the swing is the game\'s');
  let st = await r.post('/api/connect/probe', { on: true });
  assert.equal(st.probe.on, true);
  assert.equal(r.hub.probing, true);
  assert.equal(r.hub.gate({ Speed: 142.3, VLA: 13.4, HLA: -2, BackSpin: 2800, SideSpin: 300 }, 'open-connect'), true);
  st = await r.get('/api/connect/status');
  assert.equal(st.probe.shot.speedMph, 142.3);
  assert.equal(st.probe.shot.totalSpin, 2816, 'total spin from back and side spin when the connector sends no total');
  assert.equal(r.hub.gate({ Speed: 90 }, null), true, 'a test shot is held too');
  assert.equal((await r.get('/api/connect/status')).probe.shot.source, 'test');
  st = await r.post('/api/connect/probe', { on: false });
  assert.equal(st.probe.on, false);
  assert.equal(r.hub.gate({ Speed: 120 }, 'open-connect'), false);
});

test('the Foresight route is diagnosed from the bridge', async (t) => {
  let fb = { state: 'listening', mode: 'auto', active: true, port: 9050, shots: 0, lastShotAt: null };
  const r = await rig(t, { foresight: () => fb });
  await r.hub.start();
  let st = await r.post('/api/connect/device', { id: 'foresight-gcquad' });
  assert.equal(st.device.route, 'foresight-bridge');
  assert.equal(st.state, 'waiting');
  assert.equal(st.cause.id, 'foresight-waiting');
  fb = { ...fb, state: 'port-in-use' };
  st = await r.get('/api/connect/status');
  assert.equal(st.state, 'blocked');
  assert.equal(st.cause.title, 'CLOSE GSPRO');
  fb = { ...fb, state: 'off', active: false, idleReason: 'no-connector' };
  assert.equal((await r.get('/api/connect/status')).cause.id, 'foresight-off');
  fb = { ...fb, state: 'connector-connected', active: true };
  st = await r.get('/api/connect/status');
  assert.equal(st.state, 'connected');
  assert.equal(st.source, 'foresight');
  fb = { ...fb, lastShotAt: Date.now(), shots: 1 };
  assert.equal((await r.get('/api/connect/status')).state, 'ready');
});

test('diagnose: connected with no shot for a while, a port error, a plain taken port', () => {
  const base = { port: 921, listener: { state: 'listening' }, connected: false, route: 'open-connect', addressKind: 'local', everConnected: false, connectedForMs: 0, shotsThisConnection: 0 };
  assert.equal(diagnose({ ...base, connected: true, connectedForMs: 5000 }), null);
  assert.equal(diagnose({ ...base, connected: true, connectedForMs: 25000 }).id, 'no-shots');
  assert.equal(diagnose({ ...base, connected: true, connectedForMs: 25000, shotsThisConnection: 2 }), null);
  assert.equal(diagnose({ ...base, listener: { state: 'error', error: 'EACCES' } }).id, 'port-error');
  const taken = diagnose({ ...base, listener: { state: 'port-in-use', holderName: null } });
  assert.equal(taken.title, 'ANOTHER PROGRAM IS USING PORT 921');
  assert.match(taken.help, /GSPro or another simulator/);
  assert.match(diagnose({ ...base, listener: { state: 'port-in-use', holderName: 'PurePlay' } }).help, /^PurePlay is using port 921/);
  assert.equal(programName('GSPconnect'), 'GSPro');
  assert.equal(programName('GSPro'), 'GSPro');
  assert.equal(programName('node'), 'node');
});

test('checkShot: a golf shot passes; wrong units and wrong mapping are called out', () => {
  const view = (ball) => shotView(ball);
  assert.equal(view({ Speed: 152, VLA: 12.5, HLA: -1.5, TotalSpin: 2500, SpinAxis: 2 }).check.ok, true);
  assert.equal(view({ Speed: 68, VLA: 31, HLA: 3, TotalSpin: 9800 }).check.ok, true, 'a wedge is not "wrong"');
  assert.equal(view({ Speed: 6, VLA: 0, HLA: 0.5, TotalSpin: 0 }).check.ok, true, 'nor is a putt');
  const ids = (ball) => view(ball).check.issues.map((i) => i.id);
  assert.deepEqual(ids({ Speed: 68, VLA: 12.5, HLA: 0, TotalSpin: 2500 }), ['maybe-mps'], 'a driver launch at 68: metres per second');
  assert.deepEqual(ids({ Speed: 245, VLA: 12.5, HLA: 0, TotalSpin: 2500 }), ['speed-high'], 'km/h');
  assert.ok(ids({ Speed: 140, VLA: 12, HLA: 62, TotalSpin: 2500 }).includes('direction-range'));
  assert.ok(ids({ Speed: 140, VLA: 85, HLA: 0, TotalSpin: 2500 }).includes('launch-range'));
  assert.ok(ids({ Speed: 140, VLA: 12, HLA: 0 }).includes('no-spin'));
  assert.ok(ids({ Speed: 140, HLA: 0, TotalSpin: 2500 }).includes('no-launch'));
  assert.ok(ids({ Speed: 140, VLA: 12, HLA: 0, TotalSpin: 40000 }).includes('spin-high'));
});
