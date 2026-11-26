'use strict';
// v2:connect Getting a launch monitor connected (docs/launch-monitors.md).
//
// The hub sits beside the Open Connect server (lib/openconnect.js) and answers the one
// question the connection wizard, and anybody on the phone to a friend, needs answered:
// "why is my launch monitor not connected, and what do I do about it?"
//
//   - it owns the Open Connect port's life: it checks that nobody else already answers on
//     it, starts the server, and when the port is taken (GSPro is open) it says so, names
//     the program when it can, and takes the port by itself once it is free
//   - it follows who is connected, from where, when they last spoke, and the last shot
//   - it keeps the player's chosen launch monitor (<data dir>/launch-monitor.json)
//   - it holds the wizard's test ball: while the wizard is on HIT A BALL every swing is
//     shown to it and played in no game
//   - GET /api/launch-monitors, GET /api/connect/status, POST /api/connect/device,
//     POST /api/connect/probe; the page's event stream gets 'connect' on every change
//
// Pure parts (diagnose, checkShot, shotView) are exported for the tests.

const fs = require('fs');
const net = require('net');
const path = require('path');
const { execFile } = require('child_process');
const catalogue = require('./launch-monitors');

const RETRY_MS = 3000;
const PROBE_MS = 120 * 1000;       // the wizard renews it; a page that went away lets go by itself
const QUIET_MS = 20 * 1000;        // connected this long with no shot: say what to look at
const PROGRAMS_MS = 2500;          // the running programs are listed at most this often (the wizard's guide)
const GUIDE_ASK_MS = 6000;         // ...and only this long after a wizard last asked
const isLoopback = (a) => /^(::ffff:)?127\./.test(String(a || '')) || a === '::1';

/** 'free' | 'in-use' | 'error': can this host:port be bound right now? (bound for an instant, then let go) */
function probeBind(host, port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', (e) => resolve(e && e.code === 'EADDRINUSE' ? 'in-use' : 'error'));
    s.listen({ port, host, exclusive: true }, () => s.close(() => resolve('free')));
  });
}

/** The name of the program listening on a TCP port (Windows only; null when it cannot be told). */
function whoHolds(port) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || !Number.isInteger(port) || port <= 0) { resolve(null); return; }
    const script = `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { (Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue).ProcessName }`;
    try {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 6000, windowsHide: true }, (err, stdout) => {
        const name = err ? '' : String(stdout || '').trim().split(/\r?\n/)[0].trim();
        resolve(name && /^[\w .()-]{1,60}$/.test(name) ? name : null);
      });
    } catch (_) { resolve(null); }
  });
}

/** The names of the programs running on this PC, without ".exe" (Windows only; null when it cannot be told). */
function listPrograms() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve(null); return; }
    try {
      execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { timeout: 6000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err) { resolve(null); return; }
        const names = [];
        for (const line of String(stdout || '').split(/\r?\n/)) {
          const m = /^"([^"]+)"/.exec(line);
          if (m) names.push(m[1].replace(/\.exe$/i, ''));
        }
        resolve(names.length ? names : null);
      });
    } catch (_) { resolve(null); }
  });
}

/** Is a program of this name among `names`? A trailing * matches any ending; case does not matter. null: cannot be told. */
function programRunning(names, name) {
  if (!Array.isArray(names)) return null;
  const want = String(name || '').toLowerCase();
  const starts = want.endsWith('*');
  const key = starts ? want.slice(0, -1) : want;
  if (!key) return null;
  return names.some((n) => { const x = String(n).toLowerCase(); return starts ? x.startsWith(key) : x === key; });
}

/**
 * A device's guide checks answered (lib/launch-monitors.js GUIDE_WANTS): [{ step, ok }], ok
 * true, false or null (it cannot be told). Pure. A check only ticks a step in the wizard.
 */
function guideChecks(device, { connected = false, programs = null } = {}) {
  const checks = device && device.guide && Array.isArray(device.guide.checks) ? device.guide.checks : [];
  return checks.map((c) => {
    if (c.want === 'connected') return { step: c.step, ok: !!connected };
    const on = programRunning(programs, c.program);
    return { step: c.step, ok: on === null ? null : (c.want === 'closed' ? !on : on) };
  });
}

/** A process name as a player knows the program. */
function programName(processName) {
  const n = String(processName || '');
  if (!n) return null;
  if (/gsp(ro|connect|c)\b|^gsp/i.test(n)) return 'GSPro';
  return n;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round = (v, d = 1) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

/** Open Connect ball data -> the few numbers the wizard shows (null where the monitor sent none). */
function shotView(ball, { source = null, device = null, at = Date.now(), seq = 0 } = {}) {
  const b = ball || {};
  const back = num(b.BackSpin), side = num(b.SideSpin);
  const total = num(b.TotalSpin) ?? (back !== null || side !== null ? Math.hypot(back || 0, side || 0) : null);
  const view = {
    seq, at, source, device: device ? String(device).slice(0, 80) : null,
    speedMph: round(num(b.Speed)), vla: round(num(b.VLA)), hla: round(num(b.HLA)),
    totalSpin: total === null ? null : Math.round(total), spinAxis: round(num(b.SpinAxis)),
  };
  view.check = checkShot(view);
  return view;
}

/**
 * Do a shot's numbers look like a golf shot? -> { ok, issues: [{ id, text }] }. An issue is a
 * hint that the connector's units or mapping are off, in words for the wizard's "that looks
 * wrong" line. A soft shot is not an issue: only numbers a real ball does not produce.
 */
function checkShot(view) {
  const issues = [];
  const say = (id, text) => issues.push({ id, text });
  const s = view.speedMph, v = view.vla, h = view.hla, spin = view.totalSpin;
  if (s === null || s <= 0) say('no-speed', 'No ball speed came through.');
  else if (s > 210) say('speed-high', `${Math.round(s)} mph is faster than any golf ball: the connector may be sending km/h.`);
  if (v !== null && (v < -5 || v > 65)) say('launch-range', `A launch angle of ${v} degrees is not a golf shot: launch may be mapped wrong.`);
  if (h !== null && Math.abs(h) > 35) say('direction-range', `The ball started ${Math.abs(h)} degrees off line: left and right may be mapped wrong.`);
  if (spin !== null && spin > 16000) say('spin-high', `${spin} rpm is more spin than a golf ball takes.`);
  if (s !== null && s > 60 && (spin === null || spin === 0)) say('no-spin', 'No spin came through. The game will still play, with less curve and bite.');
  if (s !== null && s > 60 && v === null) say('no-launch', 'No launch angle came through.');
  // a driver-shaped launch (low, little spin) at a speed no full swing has: metres per second read as mph
  if (s !== null && s >= 35 && s < 82 && v !== null && v >= 7 && v <= 17 && spin !== null && spin >= 1500 && spin <= 4200) {
    say('maybe-mps', `If that was a full swing, ${Math.round(s)} mph is too slow: the connector may be sending metres per second.`);
  }
  return { ok: issues.length === 0, issues };
}

/**
 * The likely reason nothing is connected (or nothing is arriving), in plain words.
 * -> null | { id, title, help }. Pure: everything it needs is in `s`.
 *   s.listener   { state, holder, holderName }
 *   s.port, s.connected, s.source, s.route ('open-connect' | 'foresight-bridge' | 'none' | null)
 *   s.addressKind ('local' | 'lan' | null), s.lanAddress
 *   s.everConnected, s.connectedForMs, s.shotsThisConnection, s.remote (connector on another device)
 *   s.foresight  the bridge's status or null
 */
function diagnose(s) {
  const port = s.port;
  const fb = s.foresight || null;
  if (s.route === 'foresight-bridge' && !s.connected) {
    if (!fb || fb.state === 'off') {
      const why = fb && fb.idleReason === 'no-connector' ? 'GSPro\'s connector (GSPconnect) was not found on this PC. The Foresight bridge needs your own GSPro installation.'
        : 'Switch it to Auto or On (here, or in SETTINGS > LAUNCH MONITOR).';
      return { id: 'foresight-off', title: 'THE FORESIGHT BRIDGE IS OFF', help: why };
    }
    if (fb.state === 'port-in-use') return { id: 'foresight-port', title: 'CLOSE GSPRO', help: `GSPro, or another bridge program, is holding the Foresight connector (port ${fb.port}). Close it: the game takes over by itself within a few seconds.` };
    if (fb.state === 'no-log') return { id: 'foresight-no-connector', title: 'GSPRO\'S CONNECTOR WAS NOT FOUND', help: 'The game looks for GSPconnect in C:\\GSProV1\\Core\\GSPC. If GSPro is installed somewhere else, set the folder in SETTINGS > LAUNCH MONITOR.' };
    if (fb.state === 'error') return { id: 'foresight-error', title: 'THE FORESIGHT BRIDGE COULD NOT START', help: String(fb.lastError || 'See SETTINGS > LAUNCH MONITOR.') };
    return { id: 'foresight-waiting', title: 'OPEN GSPCONNECT', help: 'Open the Foresight connector (GSPconnect, in your GSPro folder) and connect your launch monitor in it. Close GSPro itself first.' };
  }
  if (s.connected) {
    if (s.shotsThisConnection === 0 && s.connectedForMs >= QUIET_MS) {
      return { id: 'no-shots', title: 'CONNECTED, BUT NO SHOT YET', help: 'The connector is talking to the game. Check that it shows your launch monitor as connected and ready, that the monitor itself is ready (its light), then hit a full shot.' };
    }
    return null;
  }
  const l = s.listener || {};
  if (l.state === 'port-in-use') {
    const who = programName(l.holderName);
    const gspro = who === 'GSPro';
    return {
      id: 'port-in-use',
      title: gspro ? 'CLOSE GSPRO' : `ANOTHER PROGRAM IS USING PORT ${port}`,
      help: gspro ? `GSPro is open and is using port ${port}, the one launch monitors send their shots to. Close GSPro: the game takes the port by itself within a few seconds.`
        : `${who ? who + ' is' : 'GSPro or another simulator is'} using port ${port}, the one launch monitors send their shots to. Close it: the game takes the port by itself within a few seconds.`,
    };
  }
  if (l.state === 'error') return { id: 'port-error', title: `PORT ${port} COULD NOT BE OPENED`, help: String(l.error || 'Restart the game.') };
  if (l.state !== 'listening') return { id: 'starting', title: 'STARTING UP', help: 'One moment.' };
  if (s.everConnected) return { id: 'dropped', title: 'THE CONNECTOR DISCONNECTED', help: 'Check that your connector program is still running and press its Connect button again.' };
  if (s.addressKind === 'lan' || s.remote) {
    return {
      id: 'firewall',
      title: 'NOTHING HAS CONNECTED YET',
      help: `Check the connector is set to ${s.lanAddress || 'this PC\'s network address'}, port ${port}. If it is, Windows Firewall is probably blocking it: when Windows asked to allow this game on your network, the answer has to be Allow (Windows Security > Firewall > Allow an app, tick Private).`,
    };
  }
  return { id: 'no-connector', title: 'WAITING FOR YOUR CONNECTOR', help: `Start your connector program and connect it. It should be set to 127.0.0.1, port ${port}.` };
}

function createConnectHub({
  oc, port, dataDir, broadcast = () => {}, foresight = () => null, log = console,
  probe = probeBind, holder = whoHolds, retryMs = RETRY_MS, now = Date.now, interfaces = undefined,
  programs = listPrograms, programsMs = PROGRAMS_MS,
} = {}) {
  const file = dataDir ? path.join(dataDir, 'launch-monitor.json') : null;
  const listener = { state: 'idle', holder: null, holderName: null, error: null, since: now() };
  let retry = null, stopped = true, lookingUp = false;
  let everConnected = false, connectedAt = null, lastDisconnectAt = null, lastMessageAt = null;
  let ready = false, shots = 0, shotsThisConnection = 0, lastShot = null, shotSeq = 0;
  const hold = { until: 0, shot: null };   // the wizard's test ball
  // The wizard's guide (a device's `guide.checks`): which programs are running is looked up
  // only while a wizard asks for it (GET /api/connect/status?guide=1), at most every programsMs.
  let procs = { at: 0, names: null, busy: false }, guideUntil = 0;
  let chosen = load();

  function load() {
    if (!file) return null;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const id = data && typeof data.device === 'string' ? data.device : null;
      return id && catalogue.choice(id) ? { id, at: Number(data.chosenAt) || null } : null;
    } catch (_) { return null; }
  }
  function save() {
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, device: chosen ? chosen.id : null, chosenAt: chosen ? chosen.at : null }, null, 2));
      fs.renameSync(tmp, file);
    } catch (e) { log.warn(`[connect] could not save the launch-monitor choice: ${e.message}`); }
  }

  function setListener(state, extra = {}) {
    const was = listener.state;
    Object.assign(listener, { holder: null, holderName: null, error: null }, extra, { state });
    if (was !== state) listener.since = now();
    if (was !== state) changed();
  }
  function changed() { try { broadcast('connect', status()); } catch (_) { /* a listener's problem */ } }

  function scheduleRetry() {
    clearTimeout(retry);
    if (stopped) return;
    retry = setTimeout(() => { retry = null; tryListen(); }, retryMs);
    if (retry.unref) retry.unref();
  }
  function lookUpHolder() {
    if (lookingUp || listener.holderName) return;
    lookingUp = true;
    Promise.resolve(holder(port)).catch(() => null).then((name) => {
      lookingUp = false;
      if (name && listener.state === 'port-in-use' && !listener.holderName) {
        listener.holderName = name;
        log.log(`[connect] port ${port} is held by ${name}`);
        changed();
      }
    });
  }
  function inUse(who) {
    if (listener.state !== 'port-in-use') log.error(`[connect] another program is using port ${port}: close GSPro or the other simulator (trying again every ${Math.round(retryMs / 1000)} s)`);
    setListener('port-in-use', { holder: who, holderName: listener.state === 'port-in-use' ? listener.holderName : null });
    lookUpHolder();
    scheduleRetry();
  }
  async function tryListen() {
    if (stopped || oc.listening) return;
    if (listener.state === 'idle') setListener('starting');
    // Somebody may already answer on 127.0.0.1 alone (GSPro's Open API does): Windows would
    // still let us listen on every address and then hand THEM the local connections, so
    // the port would look fine and no connector would ever arrive. Look first.
    if (port > 0 && await probe('127.0.0.1', port) === 'in-use') { inUse('loopback'); return; }
    if (stopped || oc.listening) return;
    try { oc.start(); } catch (e) { setListener('error', { error: e.message }); scheduleRetry(); }
  }

  oc.on('listening', () => {
    if (listener.state === 'port-in-use') log.log(`[connect] port ${port} is free again: listening`);
    setListener('listening');
  });
  oc.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') inUse('wildcard');
    else { setListener('error', { error: (err && err.message) || 'unknown error' }); scheduleRetry(); }
  });
  oc.on('connected', () => {
    everConnected = true;
    if (oc.clientCount === 1) { connectedAt = now(); shotsThisConnection = 0; ready = false; }
    changed();
  });
  oc.on('disconnected', () => {
    if (oc.clientCount === 0) { lastDisconnectAt = now(); connectedAt = null; ready = false; }
    changed();
  });
  oc.on('message', () => { lastMessageAt = now(); });
  oc.on('status', (s) => { const r = !!(s && s.ready); if (r !== ready) { ready = r; changed(); } });
  oc.on('shot', (shot) => {
    shots++;
    if ((shot.source || 'open-connect') === 'open-connect') shotsThisConnection++;
    lastMessageAt = now();
    lastShot = shotView(shot.ball, { source: shot.source || 'open-connect', device: shot.device, at: now(), seq: ++shotSeq });
    changed();
  });

  function refreshPrograms(full) {
    const t = now();
    if (procs.busy || t >= guideUntil || t - procs.at < programsMs) return;
    if (!full || !full.guide || !(full.guide.checks || []).some((c) => c.want !== 'connected')) return;
    procs.busy = true;
    const before = JSON.stringify(guideChecks(full, { programs: freshPrograms() }));
    Promise.resolve().then(() => programs()).catch(() => null).then((names) => {
      procs = { at: now(), names: Array.isArray(names) ? names : null, busy: false };
      if (JSON.stringify(guideChecks(full, { programs: procs.names })) !== before) changed();
    });
  }
  // what was seen a while ago says nothing about now
  function freshPrograms() { return procs.at && now() - procs.at < programsMs * 4 ? procs.names : null; }

  function status() {
    const t = now();
    const fb = (() => { try { return foresight() || null; } catch (_) { return null; } })();
    const clients = oc.clientInfo ? oc.clientInfo().map((c) => ({ ...c, local: isLoopback(c.address) })) : [];
    const ocUp = clients.length > 0 || oc.clientCount > 0;
    const fbUp = !!fb && fb.state === 'connector-connected';
    const connected = ocUp || fbUp;
    const source = ocUp ? 'open-connect' : (fbUp ? 'foresight' : null);
    const device = chosen ? catalogue.choice(chosen.id) : null;
    const addresses = catalogue.lanAddresses(interfaces);
    const isReady = connected && (source === 'foresight' ? !!fb.lastShotAt : (ready || shotsThisConnection > 0));
    const route = device ? device.route : null;
    const blocked = route === 'foresight-bridge'
      ? (!fb || ['off', 'port-in-use', 'no-log', 'error'].includes(fb.state))
      : (listener.state === 'port-in-use' || listener.state === 'error');
    const cause = diagnose({
      port, listener, connected, source, route,
      addressKind: device ? device.address : null,
      lanAddress: addresses.length ? addresses[0].address : null,
      everConnected, connectedForMs: connectedAt ? t - connectedAt : 0, shotsThisConnection,
      remote: false, foresight: fb,
    });
    const probing = t < hold.until;
    const full = chosen ? catalogue.device(chosen.id) : null;
    refreshPrograms(full);
    const guide = full && full.guide ? { checks: guideChecks(full, { connected, programs: freshPrograms() }) } : null;
    return {
      ok: true, now: t, port,
      state: connected ? (isReady ? 'ready' : 'connected') : (blocked ? 'blocked' : 'waiting'),
      connected, source, ready: isReady,
      listener: { ...listener, listening: !!oc.listening },
      clients, everConnected, connectedAt, lastDisconnectAt, lastMessageAt,
      shots, lastShot,
      foresight: fb ? { state: fb.state, mode: fb.mode, active: fb.active, idleReason: fb.idleReason, port: fb.port, connections: fb.connections, shots: fb.shots, lastShotAt: fb.lastShotAt, lastError: fb.lastError, experimental: true } : null,
      chosen: !!chosen, device, chosenAt: chosen ? chosen.at : null,
      probe: { on: probing, shot: hold.shot },
      addresses, lanAddress: addresses.length ? addresses[0].address : null,
      cause, guide,
    };
  }

  const hub = {
    /** Look, listen, and keep trying while the port is taken. */
    start() { stopped = false; return tryListen(); },
    stop() { stopped = true; clearTimeout(retry); retry = null; },
    status,
    /** True while the wizard holds every swing for its HIT A BALL screen. */
    get probing() { return now() < hold.until; },
    /**
     * The swing gate of the wizard's test ball. Called with every swing before it is played:
     * true means "the wizard has it, play it in no game".
     */
    gate(ball, source = null) {
      if (now() >= hold.until) return false;
      hold.shot = shotView(ball, { source: source || 'test', at: now(), seq: ++shotSeq });
      log.log(`[connect] test ball: ${hold.shot.speedMph} mph (shown to the wizard, played in no game)`);
      changed();
      return true;
    },
    setProbe(on) {
      const was = now() < hold.until;
      hold.until = on ? now() + PROBE_MS : 0;
      if (on && !was) hold.shot = null;
      if (!!on !== was) changed();
      return status();
    },
    /** id: a catalogue id, 'none', 'other'; null or '' forgets the choice (the wizard is due again). */
    setDevice(id) {
      if (id === null || id === undefined || id === '') chosen = null;
      else {
        if (!catalogue.choice(String(id))) { const e = new Error('No such launch monitor'); e.code = 'BAD_DEVICE'; throw e; }
        chosen = { id: String(id), at: now() };
      }
      save();
      changed();
      return status();
    },
    /** The HTTP routes. -> true when the request was one of ours. */
    async handle(req, res, url) {
      const p = url.pathname;
      const json = (obj, code = 200) => {
        res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(obj));
        return true;
      };
      if (p === '/api/launch-monitors' && req.method !== 'POST') {
        return json({ ...catalogue.forClient({ port, addresses: catalogue.lanAddresses(interfaces) }), chosen: chosen ? chosen.id : null });
      }
      if (p === '/api/connect/status' && req.method !== 'POST') {
        if (url.searchParams && url.searchParams.get('guide')) guideUntil = now() + GUIDE_ASK_MS;   // a wizard is showing a device's steps
        return json(status());
      }
      if (req.method === 'POST' && (p === '/api/connect/device' || p === '/api/connect/probe')) {
        let body;
        try { body = await readJson(req); } catch (_) { return json({ ok: false, error: 'Bad request' }, 400); }
        if (p === '/api/connect/probe') return json(hub.setProbe(!!body.on));
        try { return json(hub.setDevice(body.id)); }
        catch (e) { if (e.code !== 'BAD_DEVICE') throw e; return json({ ok: false, error: e.message, code: e.code }, 400); }
      }
      return json({ ok: false, error: 'No such route' }, 404);
    },
  };
  return hub;
}

function readJson(req, max = 16384) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > max) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { const v = b ? JSON.parse(b) : {}; resolve(v && typeof v === 'object' ? v : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

module.exports = { createConnectHub, diagnose, checkShot, shotView, probeBind, whoHolds, programName, listPrograms, programRunning, guideChecks, PROBE_MS, QUIET_MS, RETRY_MS, PROGRAMS_MS };
