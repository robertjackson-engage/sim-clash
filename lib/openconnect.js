'use strict';
// GSPro Open Connect v1 server. A launch monitor's connector normally sends its shots to
// GSPro's Open API on TCP 921 as JSON; we listen on that port and speak the same protocol,
// so the connector feeds shots to us instead.
//
// v2:connect What this file does beyond the letter of the specification
// (https://gsprogolf.com/GSProConnectV1.html) comes from reading what real connectors send
// and expect (docs/launch-monitors.md, "Open Connect conformance", lists each with its
// source). In short:
//   in   keys are matched without regard to case ("APIVersion", "Backspin", "Hla"); objects
//        may be back to back, newline separated or pretty-printed; "BallData": null is fine;
//        a message that carries ball data with a speed is a shot even when it is also
//        flagged as a heartbeat; a "shot" with no speed is acknowledged and not played; a
//        club-only message is acknowledged and never mistaken for a status message;
//        heartbeats carry the ready / ball-detected flags too
//   out  one compact JSON object per write, never two inside the same 75 ms (some clients
//        read one object per packet); every 201 carries Handed, Club (a GSPro club code) and
//        a DistanceToTarget above zero (clients arm the launch monitor on it)

const net = require('net');
const EventEmitter = require('events');

// Every reply names this simulator in a field GSPro never sends, so a launch monitor
// that shows what it is connected to (OpenFlight) can say "Open-Birdie", not "GSPro".
// GSPro clients ignore unknown fields.
const SIMULATOR_NAME = 'Open-Birdie';

// A launch monitor that loses its link right after sending a shot can't tell
// whether it arrived, so it sends it again on the new link (OpenFlight does this
// when the network switches; the MLM2PRO connector does when a reply is late). The same
// numbered shot, with the same ball data, inside this window is that resend:
// acknowledged, never played twice.
const RESEND_WINDOW_MS = 60 * 1000;

// Two replies are never written closer together than this: several connectors parse one
// JSON object per read, and two objects that arrive in one packet are lost to them.
const SEND_GAP_MS = 75;

// The names of the specification, by their lower-case form: connectors disagree on case.
const canon = (names) => new Map(names.map((n) => [n.toLowerCase(), n]));
const TOP_KEYS = canon(['DeviceID', 'Units', 'ShotNumber', 'APIversion', 'BallData', 'ClubData', 'ShotDataOptions', 'ClubName']);
const BALL_KEYS = canon(['Speed', 'SpinAxis', 'TotalSpin', 'BackSpin', 'SideSpin', 'HLA', 'VLA', 'CarryDistance']);
const CLUB_KEYS = canon(['Speed', 'AngleOfAttack', 'FaceToTarget', 'Lie', 'Loft', 'Path', 'SpeedAtImpact', 'VerticalFaceImpact', 'HorizontalFaceImpact', 'ClosureRate']);
const OPTION_KEYS = canon(['ContainsBallData', 'ContainsClubData', 'LaunchMonitorIsReady', 'LaunchMonitorBallDetected', 'IsHeartBeat']);

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// A copy of `obj` with the specification's spelling of every key it knows (others are kept
// as they came). numbers: a numeric string becomes a number ("142.5" -> 142.5).
function canonKeys(obj, keys, { numbers = false } = {}) {
  if (!isObject(obj)) return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const name = keys.get(String(k).toLowerCase()) || k;
    out[name] = numbers && typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v;
  }
  return out;
}

const truthy = (v) => v === true || v === 1 || (typeof v === 'string' && v.trim().toLowerCase() === 'true');

/**
 * An inbound message in the specification's own spelling, whatever the connector's casing.
 * BallData / ClubData / ShotDataOptions that are missing or null come back as null / null / {}.
 */
function normalizeMessage(raw) {
  const msg = canonKeys(raw, TOP_KEYS) || {};
  msg.BallData = canonKeys(msg.BallData, BALL_KEYS, { numbers: true });
  msg.ClubData = canonKeys(msg.ClubData, CLUB_KEYS, { numbers: true });
  msg.ShotDataOptions = canonKeys(msg.ShotDataOptions, OPTION_KEYS) || {};
  return msg;
}

/**
 * What a message is: 'shot' (ball data with a speed), 'no-speed' (flagged as ball data but
 * the speed is zero or missing: a misread), 'heartbeat', 'club' (club data on its own: the
 * second half of a shot some connectors send separately) or 'status' (ready / ball detected).
 * Ball data comes first: one connector flags its real shots as heartbeats as well.
 */
function classifyMessage(msg) {
  const o = msg.ShotDataOptions || {};
  const ball = msg.BallData;
  const speed = ball ? Number(ball.Speed) : NaN;
  const heartbeat = truthy(o.IsHeartBeat);
  const saysBall = 'ContainsBallData' in o ? truthy(o.ContainsBallData) : (!!ball && !heartbeat);
  if (saysBall && ball && Number.isFinite(speed) && speed > 0) return 'shot';
  if (heartbeat) return 'heartbeat';
  if (saysBall && ball) return 'no-speed';
  if (truthy(o.ContainsClubData) && msg.ClubData) return 'club';
  return 'status';
}

class OpenConnectServer extends EventEmitter {
  constructor(port = 921) {
    super();
    this.port = port;
    this.clients = new Set();
    this.info = new Map();   // sock -> what we know about that connector (clientInfo())
    this.player = { Handed: 'RH', Club: 'DR', DistanceToTarget: 0 };
    this._lastShot = null;   // { key, at } for spotting a resend
    this.listening = false;
    this.server = net.createServer((sock) => this._onClient(sock));
    this.server.on('error', (err) => { this.listening = false; this.emit('error', err); });
    this.server.on('close', () => { this.listening = false; });
  }

  /** Listen (again: safe to call after an 'error', e.g. once the port has come free). */
  start() {
    if (this.listening || this.server.listening) return;
    this.server.listen(this.port, () => { this.listening = true; this.emit('listening', this.port); });
  }

  _onClient(sock) {
    sock.setNoDelay(true);
    this.clients.add(sock);
    const info = {
      address: sock.remoteAddress || null, connectedAt: Date.now(), deviceId: null,
      lastMessageAt: null, messages: 0, shots: 0, heartbeats: 0, ownClub: false,
      queue: [], timer: null, lastSendAt: 0,
    };
    this.info.set(sock, info);
    this.emit('connected', sock.remoteAddress);
    let buf = '';

    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      // Messages are bare JSON objects: back to back, newline separated or pretty-printed
      // over many lines. Split by brace depth (string-aware).
      let depth = 0, startIdx = -1, inStr = false, esc = false;
      for (let i = 0; i < buf.length; i++) {
        const c = buf[i];
        if (esc) { esc = false; continue; }
        if (inStr) {
          if (c === '\\') esc = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (depth === 0 && c !== '{') continue;   // between objects: whitespace, or a stray byte
        if (c === '"') { inStr = true; continue; }
        if (c === '{') { if (depth === 0) startIdx = i; depth++; }
        else if (c === '}') {
          depth--;
          if (depth === 0 && startIdx >= 0) {
            const raw = buf.slice(startIdx, i + 1);
            let parsed = null;
            try { parsed = JSON.parse(raw); }
            catch (e) { this._send(sock, { Code: 501, Message: 'Bad JSON: ' + e.message }); }
            if (parsed) {
              try { this._onMessage(sock, parsed); }
              catch (e) { this._send(sock, { Code: 501, Message: 'Failure occurred' }); this.emit('fault', e); }
            }
            buf = buf.slice(i + 1);
            i = -1; startIdx = -1;
          }
        }
      }
      if (startIdx < 0) buf = '';               // nothing open: only whitespace or noise was left
      else if (buf.length > 65536) buf = '';    // safety: drop runaway garbage
    });

    const drop = () => {
      if (!this.clients.delete(sock)) return;   // 'error' is followed by 'close': once
      clearTimeout(info.timer);
      info.queue.length = 0;
      this.info.delete(sock);
      this.emit('disconnected', info.address);
    };
    sock.on('close', drop);
    sock.on('error', drop);

    // Greet with player info like GSPro does
    this.sendPlayerInfo(sock);
  }

  _onMessage(sock, raw) {
    const msg = normalizeMessage(raw);
    const opts = msg.ShotDataOptions;
    const kind = classifyMessage(msg);
    const info = this.info.get(sock);
    if (info) {
      info.lastMessageAt = Date.now();
      info.messages++;
      if (msg.DeviceID != null && String(msg.DeviceID).trim()) {
        info.deviceId = String(msg.DeviceID).slice(0, 80);
        // OpenFlight changes club on its own side and applies the Club of every 201 it is
        // sent: it is only ever told about a club the player picked here (sendPlayerInfo).
        info.ownClub = /open\s*-?\s*flight/i.test(info.deviceId);
      }
      if (kind === 'shot') info.shots++;
      if (kind === 'heartbeat') info.heartbeats++;
    }
    this.emit('message', { kind, device: msg.DeviceID ?? null, shotNumber: msg.ShotNumber ?? null, address: info ? info.address : null });
    // the ready / ball-detected flags, from whichever message carries them
    const flags = () => {
      if (!('LaunchMonitorIsReady' in opts) && !('LaunchMonitorBallDetected' in opts)) return;
      this.emit('status', { ready: truthy(opts.LaunchMonitorIsReady), ballDetected: truthy(opts.LaunchMonitorBallDetected) });
    };
    if (kind === 'shot') {
      this._send(sock, { Code: 200, Message: 'Shot received successfully' });
      if (this._isResend(msg)) {
        this.emit('duplicate', { shotNumber: msg.ShotNumber, device: msg.DeviceID });
        return;
      }
      this.emit('shot', {
        shotNumber: msg.ShotNumber,
        device: msg.DeviceID,
        units: msg.Units || 'Yards',
        ball: msg.BallData,   // Speed mph, SpinAxis, TotalSpin, BackSpin, SideSpin, HLA, VLA
        club: truthy(opts.ContainsClubData) ? msg.ClubData : null,
        clubName: msg.ClubName || null,   // club TYPE from the bridge (e.g. "DRIVER")
      });
      return;
    }
    if (kind === 'heartbeat') {
      this._send(sock, { Code: 200, Message: 'Heartbeat OK' });
      this.emit('heartbeat', msg);
      flags();
      return;
    }
    if (kind === 'no-speed') {
      // a misread (a zero-speed "shot"): acknowledged so the connector does not send it
      // again, never played
      this._send(sock, { Code: 200, Message: 'Shot received successfully' });
      this.emit('ignored', { reason: 'no-speed', shotNumber: msg.ShotNumber, device: msg.DeviceID });
      return;
    }
    if (kind === 'club') {
      // club data on its own, after the ball data of the same shot: not a new shot, and
      // not a status message (it says nothing about the monitor being ready)
      this._send(sock, { Code: 200, Message: 'Club Data received' });
      this.emit('club', { shotNumber: msg.ShotNumber, device: msg.DeviceID, club: msg.ClubData });
      return;
    }
    // status-only message (monitor ready / ball detected): a flag left out is false
    this._send(sock, { Code: 200, Message: 'OK' });
    this.emit('status', {
      ready: truthy(opts.LaunchMonitorIsReady),
      ballDetected: truthy(opts.LaunchMonitorBallDetected),
    });
  }

  _isResend(msg, now = Date.now()) {
    const n = Number(msg.ShotNumber);
    if (!Number.isFinite(n) || n <= 0) return false;   // unnumbered shots can't be told apart
    const key = JSON.stringify([msg.DeviceID ?? null, n, msg.BallData]);
    const last = this._lastShot;
    this._lastShot = { key, at: now };
    return !!last && last.key === key && now - last.at <= RESEND_WINDOW_MS;
  }

  // One object per write, and never two within SEND_GAP_MS: what cannot go now waits its
  // turn. Two player updates waiting in a row are merged into one (the newest wins).
  _send(sock, obj) {
    const info = this.info.get(sock);
    const out = { ...obj, Simulator: SIMULATOR_NAME };
    if (!info) { this._write(sock, out); return; }
    const tail = info.queue[info.queue.length - 1];
    if (tail && tail.Code === 201 && out.Code === 201) tail.Player = { ...tail.Player, ...out.Player };
    else info.queue.push(out);
    this._drain(sock, info);
  }

  _drain(sock, info) {
    if (info.timer || !info.queue.length) return;
    const wait = info.lastSendAt + SEND_GAP_MS - Date.now();
    if (wait > 0) {
      info.timer = setTimeout(() => { info.timer = null; this._drain(sock, info); }, wait);
      return;
    }
    info.lastSendAt = Date.now();
    this._write(sock, info.queue.shift());
    this._drain(sock, info);
  }

  _write(sock, obj) {
    try { sock.write(JSON.stringify(obj)); } catch (_) { /* client gone */ }
  }

  // Every 201 is a whole GSPro player: Handed, Club and DistanceToTarget, which is what
  // GSPro's own example shows and what connectors expect (one reads Player.Club of every
  // 201 without checking that it is there; others arm the launch monitor only on a 201
  // whose DistanceToTarget is above zero).
  //
  // The exception is a launch monitor that changes club on its own side (OpenFlight's
  // Change Club) and applies the Club of every 201: the club is a command to it, not state
  // to repeat, so after the greeting it is sent only what changed. Re-sending our club with
  // each post-shot distance update snapped it back to Driver after every shot.
  sendPlayerInfo(sock, fields = null) {
    const whole = playerForWire(this.player);
    const one = (s) => {
      const info = this.info.get(s);
      const player = fields && info && info.ownClub ? playerForWire({ Handed: this.player.Handed, ...fields }) : whole;
      this._send(s, { Code: 201, Message: 'GSPro Player Information', Player: player });
    };
    if (sock) one(sock);
    else for (const s of this.clients) one(s);
  }

  setPlayer(patch) {
    Object.assign(this.player, patch);
    this.sendPlayerInfo(null, patch);
  }

  get clientCount() { return this.clients.size; }

  /** The connectors that are connected: where from, what they call themselves, when they last spoke. */
  clientInfo() {
    return [...this.info.values()].map((i) => ({
      address: i.address, connectedAt: i.connectedAt, deviceId: i.deviceId,
      lastMessageAt: i.lastMessageAt, messages: i.messages, shots: i.shots, heartbeats: i.heartbeats,
    }));
  }
}

// The player as it goes on the wire: Handed is RH or LH, Club a GSPro code, and a
// DistanceToTarget (when there is one) a whole number of at least 1. GSPro sends 0 while
// it is in its menus and connectors take that as "do not arm"; this game wants the
// launch monitor armed whenever a connector is on, also in its menus (the connection
// check asks for a ball there).
function playerForWire(player) {
  const out = {};
  if ('Handed' in player) out.Handed = String(player.Handed || '').toUpperCase() === 'LH' ? 'LH' : 'RH';
  if ('Club' in player) out.Club = toOpenConnectClub(player.Club);
  if ('DistanceToTarget' in player) {
    const d = Math.round(Number(player.DistanceToTarget));
    out.DistanceToTarget = Number.isFinite(d) && d >= 1 ? d : 1;
  }
  return out;
}

// GSPro Open Connect club codes are type-first ("I5", "W3", "H3"). The UI shows golfer
// labels ("5i", "3W", "3H"); a launch monitor that maps codes (e.g. OpenFlight) reads
// a label as an unknown club, so normalise anything we are handed before sending it.
// Connectors with a fixed list of codes (DR, W2-W7, H2-H7, I1-I9, PW, GW, SW, LW, PT) drop
// the whole message on anything else, so what is not on that list goes to its nearest
// code: an approach / utility wedge to GW, a wedge named by loft to the wedge of that
// loft, a 1-wood to DR, long woods and hybrids to the longest on the list.
const OC_CLUBS = new Set(['DR', 'PW', 'GW', 'SW', 'LW', 'PT',
  ...[2, 3, 4, 5, 6, 7].flatMap((n) => [`W${n}`, `H${n}`]),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `I${n}`)]);
const OC_CLUB_WORDS = {
  D: 'DR', DRIVER: 'DR', '1W': 'DR', W1: 'DR',
  AW: 'GW', UW: 'GW', GAP: 'GW', APPROACH: 'GW',
  PITCHING: 'PW', SAND: 'SW', LOB: 'LW',
  P: 'PT', PUTT: 'PT', PUTTER: 'PT',
};
function toOpenConnectClub(club) {
  let s = String(club || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return 'DR';
  const m = /^(\d{1,2})([IWH])$/.exec(s);
  if (m) s = m[2] + m[1];
  if (OC_CLUBS.has(s)) return s;
  if (OC_CLUB_WORDS[s]) return OC_CLUB_WORDS[s];
  const typed = /^([IWH])(\d{1,2})$/.exec(s);
  if (typed) {
    const n = +typed[2];
    if (typed[1] === 'I') return `I${Math.max(1, Math.min(9, n))}`;
    return n <= 1 && typed[1] === 'W' ? 'DR' : `${typed[1]}${Math.max(2, Math.min(7, n))}`;
  }
  const loft = /^(\d{2})$/.exec(s);
  if (loft) {
    const d = +loft[1];
    if (d >= 44 && d <= 64) return d <= 48 ? 'PW' : d <= 53 ? 'GW' : d <= 57 ? 'SW' : 'LW';
  }
  return s;   // not a club we know: as given (the specification has no list of codes)
}

module.exports = { OpenConnectServer, SIMULATOR_NAME, SEND_GAP_MS, toOpenConnectClub, normalizeMessage, classifyMessage, playerForWire };
