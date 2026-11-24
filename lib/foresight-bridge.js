'use strict';
// The Foresight bridge (docs/foresight-bridge.md). EXPERIMENTAL.
//
// Foresight GC launch monitors (GCQuad, GC3, GCHawk, Bushnell Launch Pro) reach GSPro
// through the connector that ships inside a GSPro installation (GSPconnect.exe). That
// connector does not speak Open Connect. It dials TCP 127.0.0.1:9050 and expects
// something to be listening there, and for every shot it appends three lines to its own
// log file (ConnectDebug.txt, beside the connector):
//
//   2026-11-22 21:24:48,360 [1] INFO  VGPconnect.ForesightForm [(null)] - Sending Shot
//   2026-11-22 21:24:48,383 [1] INFO  VGPconnect.ForesightForm [(null)] - Logging ball data IMMEDIATELY before sending to GSPro
//   2026-11-22 21:24:48,387 [1] INFO  VGPconnect.ForesightForm [(null)] - [53.5074539,5.214206,26.1026459,1337.0,2574.40649,2200.0,31.28819,0.0]
//
// The bracket is: ball speed (mph), vertical launch (deg), horizontal launch (deg),
// side spin (rpm), total spin (rpm), back spin (rpm), spin axis (deg), and a trailing 0.
// A value the unit could not read is written as the string "NaN".
//
// So this module does two things and nothing else:
//   1. it LISTENS on that port, accepts the connector, and holds the connection open
//      (it reads and discards whatever arrives and never writes: no reply is known to
//      be needed);
//   2. it TAILS the log, and turns each shot into an Open Connect shaped message.
//
// It is original code, written from the behaviour above and from the connector's own
// log files. It opens the log read-only and writes nothing into the GSPro folder.
// Pure Node, no dependencies.

const net = require('net');
const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 9050;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_CONNECTOR_DIR = 'C:\\GSProV1\\Core\\GSPC';
const LOG_NAME = 'ConnectDebug.txt';
const DEVICE_ID = 'Foresight (GSPconnect)';
const SOURCE = 'foresight';
const MODES = Object.freeze(['auto', 'on', 'off']);
const STATES = Object.freeze(['off', 'starting', 'listening', 'connector-connected', 'port-in-use', 'no-log', 'error']);

// ---------------------------------------------------------------- the log's lines

// "2026-11-22 21:24:48,360 [1] INFO  Some.Logger [(null)] - the message"
const LINE_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:[,.](\d{1,3}))?\s+(?:\[[^\]]*\]\s+)?([A-Za-z]+)\s+(\S+)\s+(?:\[[^\]]*\]\s+)?-\s?(.*)$/;
const MARKER_RE = /^(?:Sending Shot\b|Logging ball data\b)/i;
const BRACKET_RE = /^\[(.*)\]$/;
const NUM_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const NAN_RE = /^(?:nan|null|[-+]?inf(?:inity)?)$/i;

// One line of the log: when it was written (the PC's local time, as ms), its level,
// logger and message. null for anything else (a stack trace's continuation lines).
function parseLogLine(line) {
  const m = LINE_RE.exec(String(line == null ? '' : line).replace(/^\uFEFF/, '').trimEnd());
  if (!m) return null;
  const ms = m[7] ? +m[7].padEnd(3, '0') : 0;
  const at = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms).getTime();
  return {
    at: Number.isFinite(at) ? at : null,
    stamp: `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]},${String(ms).padStart(3, '0')}`,
    level: m[8].toUpperCase(), logger: m[9], message: m[10].trim(),
  };
}

// The ball bracket of a message: its values in order (NaN for one the unit could not
// read), or null when the message is not a ball bracket.
function parseBallBracket(message) {
  const m = BRACKET_RE.exec(String(message == null ? '' : message).trim());
  if (!m) return null;
  const tokens = m[1].split(',').map((t) => t.trim().replace(/^"(.*)"$/, '$1').trim());
  if (tokens.length < 7 || tokens.length > 12) return null;
  const values = [];
  for (const t of tokens) {
    if (NUM_RE.test(t)) values.push(Number(t));
    else if (NAN_RE.test(t)) values.push(NaN);
    else return null;
  }
  return values;
}

// The bracket as Open Connect BallData, units as given (mph, degrees, rpm). This is the
// mapping and the sign convention that play correctly in this game: do not "fix" it.
// A spin or an angle the unit could not read is 0; a ball with no speed is no shot.
function ballDataFromValues(values) {
  if (!Array.isArray(values) || values.length < 7) return null;
  const speed = values[0];
  if (!Number.isFinite(speed) || speed <= 0) return null;
  const n = (v) => (Number.isFinite(v) ? v : 0);
  return {
    Speed: speed,
    SpinAxis: n(values[6]),
    TotalSpin: n(values[4]),
    BackSpin: n(values[5]),
    SideSpin: n(values[3]),
    HLA: n(values[2]),
    VLA: n(values[1]),
  };
}

// A shot as a GSPro Open Connect v1 message (what a connector would have sent on 921).
function toOpenConnect(ball, shotNumber = 1) {
  return {
    DeviceID: DEVICE_ID,
    Units: 'Yards',
    ShotNumber: shotNumber,
    APIversion: '1',
    BallData: { ...ball },
    ClubData: null,
    ShotDataOptions: {
      ContainsBallData: true,
      ContainsClubData: false,
      LaunchMonitorIsReady: true,
      LaunchMonitorBallDetected: true,
      IsHeartBeat: false,
    },
  };
}

// The shot state machine, fed one log line at a time. A marker line ("Sending Shot",
// "Logging ball data ...") arms it; the next ball bracket, if it comes soon enough, is
// the shot. A bracket with no marker just before it is ignored, and so is the same
// shot seen twice (the same log line read again, or the same numbers logged again
// within a few seconds).
function createShotParser({ onShot = null, maxGapLines = 12, maxGapMs = 5000, dedupeWindowMs = 3000, remember = 64 } = {}) {
  let armed = null;          // { at, gap }: a marker was seen, its bracket is awaited
  let last = null;           // { raw, at }: the last shot emitted
  const seen = [];           // keys of the last few shots
  const counts = { markers: 0, shots: 0, duplicates: 0, ignored: 0, invalid: 0 };

  function push(line, ctx = {}) {
    const rec = parseLogLine(line);
    if (!rec) {              // a continuation line (a stack trace): it only uses up the gap
      if (armed && ++armed.gap > maxGapLines) armed = null;
      return null;
    }
    if (MARKER_RE.test(rec.message)) {
      armed = { at: rec.at, gap: 0 };
      counts.markers++;
      return null;
    }
    const values = parseBallBracket(rec.message);
    if (!values) {
      if (armed && ++armed.gap > maxGapLines) armed = null;
      return null;
    }
    const marker = armed;
    armed = null;
    const late = marker && marker.at != null && rec.at != null && Math.abs(rec.at - marker.at) > maxGapMs;
    if (!marker || late) { counts.ignored++; return null; }
    const raw = values.map((v) => (Number.isFinite(v) ? String(v) : 'NaN')).join(',');
    const key = `${rec.stamp}|${raw}`;
    const again = last && last.raw === raw && rec.at != null && last.at != null && Math.abs(rec.at - last.at) <= dedupeWindowMs;
    if (seen.includes(key) || again) { counts.duplicates++; return null; }
    const ball = ballDataFromValues(values);
    if (!ball) { counts.invalid++; return null; }
    seen.push(key);
    if (seen.length > remember) seen.shift();
    last = { raw, at: rec.at };
    counts.shots++;
    const shot = { ball, values, at: rec.at, stamp: rec.stamp, isPutt: ball.VLA === 0 && ball.TotalSpin === 0, catchUp: !!ctx.catchUp };
    if (onShot) onShot(shot);
    return shot;
  }

  return {
    push,
    reset() { armed = null; },      // the file changed under us: a marker in the old one arms nothing
    get armed() { return !!armed; },
    counts,
  };
}

// ---------------------------------------------------------------- tailing the log

const HEAD_BYTES = 64;
const READ_CHUNK = 256 * 1024;
const MAX_PARTIAL = 64 * 1024;
const EMPTY = Buffer.alloc(0);

// Follows a text file another process is appending to. Polls (file-change events are
// not reliable for a file held open by another program), opens the file read-only for
// the length of one read, and hands over whole lines.
//
//   - It starts at the END of a file that is there when it starts: nothing old is read.
//   - A file that appears later, or that replaces the one being read (the daily
//     rollover renames the old log and starts a new one; a restart may truncate it), is
//     read from its start. That is told three ways: the file got shorter than where we
//     are, its first bytes changed (every log starts with its own timestamp), or, when
//     there were no first bytes to compare, its file id changed. The lines such a file
//     already held when it was first seen are flagged `catchUp`.
//   - A line still being written is kept until its newline arrives. UTF-8, with or
//     without a byte order mark; CRLF or LF.
function createLogTail({ file, onLine, onReset = null, onChange = null, pollMs = 150, fsImpl = fs } = {}) {
  const fsp = fsImpl.promises;
  let timer = null;
  let busy = null;
  let running = false;
  let first = true;          // the first look since start(): an existing file is entered at its end
  let positioned = false;    // following a file
  let offset = 0;
  let head = EMPTY;          // the file's first bytes, its identity
  let id = null;             // dev:ino, a second opinion
  let partial = EMPTY;
  let catchUpEnd = 0;
  let dirCheckedAt = 0;
  const info = { file, exists: false, dirFound: null, size: 0, offset: 0, rollovers: 0, lines: 0, lastError: null, lastReadAt: null };

  function changed() { if (onChange) { try { onChange(snapshot()); } catch (_) { /* a listener's problem */ } } }
  function snapshot() { return { ...info, offset }; }

  async function readAt(fh, length, position) {
    const buf = Buffer.allocUnsafe(length);
    let got = 0;
    while (got < length) {
      const { bytesRead } = await fh.read(buf, got, length - got, position + got);
      if (!bytesRead) break;
      got += bytesRead;
    }
    return got === length ? buf : buf.subarray(0, got);
  }

  function feed(chunk, catchUp, atFileStart) {
    let data = partial.length ? Buffer.concat([partial, chunk]) : chunk;
    if (atFileStart && data.length >= 3 && data[0] === 0xEF && data[1] === 0xBB && data[2] === 0xBF) data = data.subarray(3);
    let from = 0;
    for (;;) {
      const nl = data.indexOf(0x0A, from);
      if (nl < 0) break;
      let end = nl;
      if (end > from && data[end - 1] === 0x0D) end--;
      const line = data.toString('utf8', from, end);
      from = nl + 1;
      info.lines++;
      try { onLine(line, { catchUp }); } catch (_) { /* one bad line must not stop the tail */ }
    }
    partial = from < data.length ? Buffer.from(data.subarray(from)) : EMPTY;
    if (partial.length > MAX_PARTIAL) partial = EMPTY;     // not a log line: let it go
  }

  async function checkDir() {
    const t = Date.now();
    if (info.dirFound !== null && t - dirCheckedAt < 2000) return;
    dirCheckedAt = t;
    let found = false;
    try { found = (await fsp.stat(path.dirname(file))).isDirectory(); } catch (_) { found = false; }
    if (found !== info.dirFound) { info.dirFound = found; changed(); }
  }

  async function pollOnce() {
    let fh;
    try {
      fh = await fsp.open(file, 'r');
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
        const was = info.exists;
        if (positioned) { positioned = false; if (onReset) onReset('gone'); }
        first = false;                       // from now on a file that turns up is a new one
        partial = EMPTY; head = EMPTY; id = null; offset = 0;
        info.exists = false; info.size = 0; info.lastError = null;
        await checkDir();
        if (was) changed();
      } else if (info.lastError !== err.code) {   // busy, locked: try again next time
        info.lastError = err.code || String(err.message);
        changed();
      }
      return;
    }
    try {
      const st = await fh.stat({ bigint: true });
      const size = Number(st.size);
      const nowId = st.ino ? `${st.dev}:${st.ino}` : null;
      let atFileStart = false;
      if (!positioned) {
        if (first) { offset = size; catchUpEnd = 0; }     // there at the start: enter at its end
        else { offset = 0; catchUpEnd = size; atFileStart = true; }
        head = size ? await readAt(fh, Math.min(HEAD_BYTES, size), 0) : EMPTY;
        partial = EMPTY;
        positioned = true;
      } else {
        let replaced = size < offset;
        if (!replaced && head.length) {
          const cur = await readAt(fh, head.length, 0);
          replaced = !cur.equals(head);
        } else if (!replaced && id && nowId && id !== nowId) {
          replaced = true;
        }
        if (replaced) {
          offset = 0; partial = EMPTY; head = EMPTY; catchUpEnd = size;
          info.rollovers++;
          if (onReset) onReset('replaced');
        }
        if (head.length < HEAD_BYTES && size > head.length) head = await readAt(fh, Math.min(HEAD_BYTES, size), 0);
        atFileStart = offset === 0;
      }
      first = false;
      id = nowId;
      const was = info.exists;
      info.exists = true; info.dirFound = true; info.size = size; info.lastError = null;
      while (offset < size) {
        const chunk = await readAt(fh, Math.min(READ_CHUNK, size - offset), offset);
        if (!chunk.length) break;
        const catchUp = offset < catchUpEnd;
        const start = atFileStart && offset === 0;
        offset += chunk.length;
        info.lastReadAt = Date.now();
        feed(chunk, catchUp, start);
      }
      if (!was) changed();
    } catch (err) {
      if (info.lastError !== (err.code || err.message)) { info.lastError = err.code || String(err.message); changed(); }
    } finally {
      try { await fh.close(); } catch (_) { /* closed */ }
    }
  }

  function poll() {
    if (busy) return busy;
    busy = pollOnce().catch(() => {}).finally(() => { busy = null; });
    return busy;
  }

  return {
    // Resolves once the file has been looked at for the first time (so a line appended
    // after that is read).
    start() {
      if (running) return poll();
      running = true;
      first = true; positioned = false; offset = 0; head = EMPTY; id = null; partial = EMPTY; catchUpEnd = 0;
      const p = poll();
      timer = setInterval(() => { if (running) poll(); }, pollMs);
      if (timer.unref) timer.unref();
      return p;
    },
    async stop() {
      running = false;
      if (timer) { clearInterval(timer); timer = null; }
      if (busy) await busy;
    },
    poll,
    status: snapshot,
  };
}

// ---------------------------------------------------------------- the bridge

// Whether anything is LISTENING on `host:port`, told by trying to (and letting go at
// once). 'in-use', 'free', or 'unknown' (this address family is not there).
function probeBind(host, port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', (err) => resolve(err.code === 'EADDRINUSE' || err.code === 'EACCES' ? 'in-use' : 'unknown'));
    s.listen({ port, host, exclusive: true }, () => s.close(() => resolve('free')));
  });
}

// createForesightBridge({ port, host, logFile, onShot, onStatus, now })
//   .start()   listen for the connector and follow the log; resolves when both have been tried
//   .stop()    let go of the port, the connections and the log
//   .status()  see docs/foresight-bridge.md
//   .setLogFile(file)   follow another log without touching the listener
//
// onShot(message, meta): message is Open Connect shaped (toOpenConnect); meta is
// { source: 'foresight', at, stamp, receivedAt, isPutt }. onStatus(status) on every change.
//
// If the port is taken (GSPro itself, or another bridge) the bridge says so
// ('port-in-use') and tries again every `retryMs`, so closing the other program is all
// it takes. `debugFile`: what the connector sends is appended there as hex, up to
// `debugMaxBytes` (off unless a file is given: nobody knows what is in it).
function createForesightBridge({
  port = DEFAULT_PORT, host = DEFAULT_HOST, logFile = path.join(DEFAULT_CONNECTOR_DIR, LOG_NAME),
  onShot = null, onStatus = null, now = Date.now,
  pollMs = 150, retryMs = 3000, staleMs = 120000, keepAliveMs = 15000,
  probeWildcard = true, debugFile = null, debugMaxBytes = 256 * 1024, fsImpl = fs,
} = {}) {
  let running = false;
  let server = null;             // listening
  let pending = null;            // a listen attempt in flight
  let retryTimer = null;
  let boundPort = port;
  let portBusy = null;           // null | 'loopback' | 'wildcard': who holds it
  let listenError = null;
  let currentLog = logFile;
  let tail = null;
  const NO_TAIL = Object.freeze({ exists: false, dirFound: null, rollovers: 0, lastError: null });
  const tailInfo = () => (tail ? tail.status() : NO_TAIL);
  let lastSignature = '';
  let debugBytes = 0;
  let connSeq = 0;
  const sockets = new Set();
  const counts = { shots: 0, stale: 0, unowned: 0, connectsTotal: 0, bytesReceived: 0, listenAttempts: 0 };
  let lastShotAt = null;
  let lastShot = null;
  let since = null;

  const parser = createShotParser({ onShot: handleShot });

  function handleShot(shot) {
    // A file that appeared or was replaced is read from its start; a shot it already held
    // that is minutes old is history, not a swing.
    if (shot.catchUp && shot.at != null && now() - shot.at > staleMs) { counts.stale++; return; }
    // While another program has the port, the connector is ITS connector: GSPro is being
    // played, or another bridge is already sending these shots to the Open Connect port.
    // Either way the shot is not ours to play (it would be played twice, or in the wrong game).
    if (!server) { counts.unowned++; notify(); return; }
    counts.shots++;
    lastShotAt = now();
    lastShot = { ...shot.ball };
    const message = toOpenConnect(shot.ball, counts.shots);
    if (onShot) {
      try { onShot(message, { source: SOURCE, at: shot.at, stamp: shot.stamp, receivedAt: lastShotAt, isPutt: shot.isPutt }); }
      catch (err) { console.error(`[foresight] shot handler failed: ${err && err.stack ? err.stack : err}`); }
    }
    notify();
  }

  function state() {
    if (!running) return 'off';
    if (portBusy) return 'port-in-use';
    if (listenError) return 'error';
    if (tailInfo().dirFound === false) return 'no-log';
    if (sockets.size) return 'connector-connected';
    if (server) return 'listening';
    return 'starting';
  }

  function status() {
    const log = tailInfo();
    return {
      state: state(),
      running,
      host, port: boundPort,
      listening: !!server,
      connections: sockets.size,
      connectsTotal: counts.connectsTotal,
      bytesReceived: counts.bytesReceived,
      portHolder: portBusy,
      logFile: currentLog,
      logDir: path.dirname(currentLog),
      dirFound: log.dirFound,
      logFound: !!log.exists,
      rollovers: log.rollovers || 0,
      shots: counts.shots,
      duplicates: parser.counts.duplicates,
      ignored: parser.counts.ignored,
      invalid: parser.counts.invalid,
      stale: counts.stale,
      unowned: counts.unowned,
      lastShotAt,
      lastShot,
      lastError: listenError || log.lastError || null,
      since,
    };
  }

  function notify() {
    if (!onStatus) return;
    const s = status();
    const signature = JSON.stringify([s.state, s.port, s.connections, s.logFile, s.dirFound, s.logFound, s.shots, s.unowned, s.portHolder, s.lastError]);
    if (signature === lastSignature) return;
    lastSignature = signature;
    try { onStatus(s); } catch (_) { /* a listener's problem */ }
  }

  // ---- the connector's side: accept, hold, read and discard
  function debugLog(n, chunk) {
    if (!debugFile || debugBytes >= debugMaxBytes) return;
    const part = chunk.subarray(0, 512);
    const text = part.toString('latin1').replace(/[^\x20-\x7e]/g, '.');
    const line = `${new Date(now()).toISOString()} conn#${n} +${chunk.length} bytes ${part.toString('hex')} | ${text}\n`;
    debugBytes += Buffer.byteLength(line);
    try {
      fsImpl.mkdirSync(path.dirname(debugFile), { recursive: true });
      fsImpl.appendFileSync(debugFile, debugBytes >= debugMaxBytes ? `${line}(capture full: ${debugMaxBytes} bytes)\n` : line);
    } catch (_) { debugBytes = debugMaxBytes; }
  }

  function onSocket(sock) {
    const n = ++connSeq;
    counts.connectsTotal++;
    sockets.add(sock);
    try { sock.setKeepAlive(true, keepAliveMs); sock.setNoDelay(true); } catch (_) { /* already gone */ }
    sock.on('data', (chunk) => { counts.bytesReceived += chunk.length; debugLog(n, chunk); });   // read and discard; never answered
    sock.on('error', () => { /* a reset is the connector's to report; 'close' follows */ });
    sock.on('close', () => { sockets.delete(sock); notify(); });
    notify();
  }

  function scheduleRetry() {
    if (!running || retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = null; tryListen(); }, retryMs);
    if (retryTimer.unref) retryTimer.unref();
  }

  function tryListen() {
    if (!running || server) return Promise.resolve();
    if (pending) return pending;
    pending = (async () => {
      counts.listenAttempts++;
      // Windows lets a second program bind 127.0.0.1:port while another one listens on
      // every address (0.0.0.0 or ::), and then hands the loopback connections to the
      // newcomer. That would take the connector away from a running GSPro without a
      // word, so look for such a listener first and stand back if there is one.
      if (probeWildcard && port !== 0) {
        for (const any of ['0.0.0.0', '::']) {
          if (any === host || !running) continue;
          if (await probeBind(any, port) === 'in-use') { portBusy = 'wildcard'; listenError = null; return; }
        }
      }
      if (!running) return;
      await new Promise((resolve) => {
        const s = net.createServer({ keepAlive: true, keepAliveInitialDelay: keepAliveMs }, onSocket);
        let settled = false;
        s.on('error', (err) => {
          if (server === s) {                      // failed after it was up
            server = null;
            try { s.close(); } catch (_) { /* closed */ }
            for (const sock of sockets) sock.destroy();
            listenError = err.code || String(err.message);
            notify();
            scheduleRetry();
            return;
          }
          if (settled) return;
          settled = true;
          if (err.code === 'EADDRINUSE' || err.code === 'EACCES') { portBusy = 'loopback'; listenError = null; }
          else { portBusy = null; listenError = err.code || String(err.message); }
          resolve();
        });
        s.listen({ port, host, exclusive: true }, () => {
          if (settled) return;
          settled = true;
          if (!running) { s.close(); resolve(); return; }
          server = s;
          boundPort = s.address().port;
          portBusy = null; listenError = null;
          since = now();
          resolve();
        });
      });
    })().catch((err) => { listenError = err.code || String(err.message); }).finally(() => {
      pending = null;
      notify();
      if (running && !server) scheduleRetry();
    });
    return pending;
  }

  // ---- the log's side
  function startTail() {
    parser.reset();
    tail = createLogTail({
      file: currentLog, pollMs, fsImpl,
      onLine: (line, ctx) => parser.push(line, ctx),
      onReset: () => parser.reset(),
      onChange: () => notify(),
    });
    return tail.start().then(() => notify());
  }

  return {
    start() {
      if (running) return Promise.resolve(status());
      running = true;
      lastSignature = '';
      return Promise.all([startTail(), tryListen()]).then(() => status());
    },
    async stop() {
      if (!running) return status();
      running = false;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      const t = tail; tail = null;
      if (t) await t.stop();
      if (pending) await pending;
      const s = server; server = null;
      for (const sock of sockets) sock.destroy();
      sockets.clear();
      if (s) await new Promise((resolve) => s.close(() => resolve()));
      portBusy = null; listenError = null;
      notify();
      return status();
    },
    status,
    // Follow another log file. The listener, and the connector on it, are left alone.
    async setLogFile(file) {
      if (!file || file === currentLog) return status();
      currentLog = file;
      if (!running) return status();
      const t = tail; tail = null;
      if (t) await t.stop();
      if (running) await startTail();
      notify();
      return status();
    },
    // for tests: look at the log now instead of waiting for the next poll
    poll() { return tail ? tail.poll() : Promise.resolve(); },
    get port() { return boundPort; },
  };
}

// ---------------------------------------------------------------- the game's side

// One swing, one stroke. A swing can reach the game by two roads at once: this bridge
// reading the connector's log, and another bridge program reading the same log and
// sending the shot to the Open Connect port. The same numbers from the OTHER road within
// the window are that swing again. (The same road twice is that road's own business:
// the parser's duplicates here, the resend check in lib/openconnect.js there.)
function createSwingGuard({ windowMs = 10000, now = Date.now } = {}) {
  let last = null;           // { source, ball, at }
  const near = (a, b, tol) => Number.isFinite(+a) && Number.isFinite(+b) && Math.abs(+a - +b) <= tol;
  return {
    isRepeat(ball, source) {
      const t = now();
      const b = ball || {};
      const repeat = !!last && last.source !== source && t - last.at <= windowMs
        && near(b.Speed, last.ball.Speed, 0.01) && near(b.VLA, last.ball.VLA, 0.01)
        && near(b.HLA, last.ball.HLA, 0.01) && near(b.TotalSpin, last.ball.TotalSpin, 1);
      if (!repeat) last = { source, ball: { Speed: b.Speed, VLA: b.VLA, HLA: b.HLA, TotalSpin: b.TotalSpin }, at: t };
      return repeat;
    },
  };
}

function badSetting(message) {
  const err = new Error(message);
  err.code = 'BAD_SETTING';
  return err;
}

function isDir(p, fsImpl = fs) {
  try { return fsImpl.statSync(p).isDirectory(); } catch (_) { return false; }
}

// A log path as the player may give it: the file itself, or the connector's folder.
function logFileFromPath(p, fsImpl = fs) {
  const s = String(p || '').trim().replace(/^"(.*)"$/, '$1');
  if (!s) return null;
  if (isDir(s, fsImpl) || !/\.(txt|log)$/i.test(s)) return path.join(s, LOG_NAME);
  return s;
}

// Where the connector's log may be, best first: a test override of the file itself, the
// player's setting, the BIRDIE_GSPCONNECT_DIR folder, the default installation.
function logCandidates({ env = process.env, setting = null, defaultDir = DEFAULT_CONNECTOR_DIR, fsImpl = fs } = {}) {
  const out = [];
  const add = (from, file) => { if (file && !out.some((c) => c.file.toLowerCase() === file.toLowerCase())) out.push({ from, file, dir: path.dirname(file) }); };
  if (env.BIRDIE_FORESIGHT_LOG) add('env', logFileFromPath(env.BIRDIE_FORESIGHT_LOG, fsImpl));
  if (setting) add('setting', logFileFromPath(setting, fsImpl));
  if (env.BIRDIE_GSPCONNECT_DIR) add('env-dir', path.join(String(env.BIRDIE_GSPCONNECT_DIR), LOG_NAME));
  add('default', path.join(defaultDir, LOG_NAME));
  return out;
}

// The first candidate whose folder is there; none: the best one, marked not found.
function findConnectorLog(opts = {}) {
  const fsImpl = opts.fsImpl || fs;
  const list = logCandidates(opts);
  const hit = list.find((c) => isDir(c.dir, fsImpl));
  return hit ? { ...hit, dirFound: true } : { ...list[0], dirFound: false };
}

function loadForesightFile(file, fsImpl = fs) {
  try {
    const data = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
    const mode = MODES.includes(data && data.mode) ? data.mode : 'auto';
    const logFile = data && typeof data.logFile === 'string' && data.logFile.trim() ? data.logFile.trim() : null;
    return { mode, logFile };
  } catch (_) {
    return { mode: 'auto', logFile: null };
  }
}

// The bridge as the game runs it: the `foresight` setting ('auto' | 'on' | 'off', kept
// in <dataDir>/foresight.json with an optional log path), where the log is, and whether
// the bridge should be up.
//
//   auto   up only when the connector's folder is on this PC, and only on the bay's own
//          game (`primary`): a second copy on private ports leaves the port alone
//   on     up (it waits for the folder and the log to appear)
//   off    down
//
// Environment (tests, odd installations): BIRDIE_FORESIGHT=auto|on|off overrides the
// saved mode, BIRDIE_FORESIGHT_PORT the port, BIRDIE_FORESIGHT_LOG the log file,
// BIRDIE_GSPCONNECT_DIR the connector's folder, BIRDIE_FORESIGHT_DEBUG=1 captures what
// the connector sends into <dataDir>/foresight-socket.log (size-capped).
function createForesightManager({
  dataDir = null, env = process.env, primary = true, onShot = null, onStatus = null,
  log = console, fsImpl = fs, bridgeOptions = {}, defaultDir = DEFAULT_CONNECTOR_DIR,
} = {}) {
  const settingsFile = dataDir ? path.join(dataDir, 'foresight.json') : null;
  let saved = settingsFile ? loadForesightFile(settingsFile, fsImpl) : { mode: 'auto', logFile: null };
  let bridge = null;
  let plan = null;
  let lastState = null;
  let queue = Promise.resolve();
  const envMode = MODES.includes(String(env.BIRDIE_FORESIGHT || '').toLowerCase()) ? String(env.BIRDIE_FORESIGHT).toLowerCase() : null;
  const envPort = Number.isInteger(+env.BIRDIE_FORESIGHT_PORT) && env.BIRDIE_FORESIGHT_PORT !== '' && env.BIRDIE_FORESIGHT_PORT != null ? +env.BIRDIE_FORESIGHT_PORT : null;
  const port = envPort != null ? envPort : (bridgeOptions.port != null ? bridgeOptions.port : DEFAULT_PORT);
  const host = bridgeOptions.host || DEFAULT_HOST;

  function resolvePlan() {
    const mode = envMode || saved.mode;
    const found = findConnectorLog({ env, setting: saved.logFile, defaultDir, fsImpl });
    let want = false;
    let idleReason = null;
    if (mode === 'off') idleReason = 'off';
    else if (mode === 'on') want = true;
    else if (!primary) idleReason = 'private-instance';
    else if (!found.dirFound) idleReason = 'no-connector';
    else want = true;
    return { mode, modeFrom: envMode ? 'env' : 'saved', want, idleReason, log: found };
  }

  function status() {
    const p = plan || resolvePlan();
    const b = bridge ? bridge.status() : null;
    const idle = {
      state: p.idleReason === 'no-connector' ? 'no-log' : 'off',
      running: false, host, port, listening: false, connections: 0, connectsTotal: 0, bytesReceived: 0, portHolder: null,
      logFile: p.log.file, logDir: p.log.dir, dirFound: p.log.dirFound, logFound: false, rollovers: 0,
      shots: 0, duplicates: 0, ignored: 0, invalid: 0, stale: 0, unowned: 0, lastShotAt: null, lastShot: null, lastError: null, since: null,
    };
    return {
      ok: true, experimental: true, source: SOURCE,
      mode: p.mode, modeFrom: p.modeFrom, active: !!bridge, idleReason: bridge ? null : p.idleReason,
      logFrom: p.log.from, savedLogFile: saved.logFile,
      ...(b || idle),
    };
  }

  function report(s) {
    if (s.state !== lastState) {
      lastState = s.state;
      if (log) {
        if (s.state === 'listening') log.log(`[foresight] listening for the Foresight connector on ${s.host}:${s.port}; reading ${s.logFile}`);
        else if (s.state === 'connector-connected') log.log(`[foresight] connector connected (${s.connections}); waiting for a shot`);
        else if (s.state === 'port-in-use') log.log(`[foresight] port ${s.port} is in use (GSPro or another bridge): shots are left to it; close it and the bridge takes over within a few seconds`);
        else if (s.state === 'no-log' && !s.active) log.log(`[foresight] no Foresight connector on this PC (${s.logDir}): bridge idle`);
        else if (s.state === 'no-log') log.log(`[foresight] connector folder not found: ${s.logDir}`);
        else if (s.state === 'off' && s.idleReason === 'private-instance') log.log('[foresight] bridge idle on this copy (private ports); BIRDIE_FORESIGHT=on to use it');
        else if (s.state === 'error') log.log(`[foresight] cannot listen on ${s.host}:${s.port}: ${s.lastError}`);
        else if (s.state === 'off') log.log('[foresight] bridge off');
      }
    }
    if (onStatus) { try { onStatus(s); } catch (_) { /* a listener's problem */ } }
  }

  async function apply() {
    plan = resolvePlan();
    if (plan.want && !bridge) {
      bridge = createForesightBridge({
        ...bridgeOptions, port, host, logFile: plan.log.file, fsImpl,
        debugFile: env.BIRDIE_FORESIGHT_DEBUG === '1' && dataDir ? path.join(dataDir, 'foresight-socket.log') : (bridgeOptions.debugFile || null),
        onShot: (message, meta) => { if (onShot) onShot(message, meta); },
        onStatus: () => report(status()),
      });
      await bridge.start();
    } else if (!plan.want && bridge) {
      const b = bridge; bridge = null;
      await b.stop();
    } else if (plan.want && bridge) {
      await bridge.setLogFile(plan.log.file);
    }
    const s = status();
    report(s);
    return s;
  }

  const enqueue = (fn) => { queue = queue.then(fn, fn); return queue; };

  return {
    start() { return enqueue(apply); },
    stop() {
      return enqueue(async () => {
        const b = bridge; bridge = null;
        if (b) await b.stop();
        return status();
      });
    },
    status,
    // { mode?, logFile? }: logFile is the connector's log or its folder; '' or null forgets it.
    // Throws BAD_SETTING. The same values again change nothing (the listener stays up).
    configure(patch = {}) {
      const next = { ...saved };
      if (patch && patch.mode !== undefined) {
        const mode = String(patch.mode).toLowerCase();
        if (!MODES.includes(mode)) throw badSetting('mode must be auto, on or off');
        next.mode = mode;
      }
      if (patch && patch.logFile !== undefined) {
        if (patch.logFile === null || patch.logFile === '') next.logFile = null;
        else {
          if (typeof patch.logFile !== 'string' || patch.logFile.length > 400) throw badSetting('logFile must be a path');
          const file = logFileFromPath(patch.logFile, fsImpl);
          if (!file || !path.isAbsolute(file)) throw badSetting('logFile must be a full path to ConnectDebug.txt or to the folder it is in');
          next.logFile = file;
        }
      }
      saved = next;
      if (settingsFile) {
        try {
          fsImpl.mkdirSync(path.dirname(settingsFile), { recursive: true });
          const tmp = `${settingsFile}.${process.pid}.tmp`;
          fsImpl.writeFileSync(tmp, JSON.stringify({ version: 1, mode: saved.mode, logFile: saved.logFile }, null, 2));
          fsImpl.renameSync(tmp, settingsFile);
        } catch (err) { if (log) log.warn(`[foresight] could not save the setting: ${err.message}`); }
      }
      return enqueue(apply);
    },
    get bridge() { return bridge; },
  };
}

module.exports = {
  createForesightBridge, createForesightManager, createSwingGuard,
  createShotParser, createLogTail,
  parseLogLine, parseBallBracket, ballDataFromValues, toOpenConnect,
  logCandidates, findConnectorLog, logFileFromPath,
  DEFAULT_PORT, DEFAULT_HOST, DEFAULT_CONNECTOR_DIR, LOG_NAME, DEVICE_ID, SOURCE, MODES, STATES,
};
