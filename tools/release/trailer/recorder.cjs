'use strict';
// The trailer recorder: an Electron main process that is NOT the game's (main.js is never
// loaded). Started by shoot.mjs:
//
//   electron tools/release/trailer/recorder.cjs --scenes <file.mjs> [--only a,b] [--out <dir>]
//
// It starts a PRIVATE game server (ports 8341 / 9972, data dir .scratch/trailer/data: never
// 8222 / 921 / 9050), opens ONE hidden offscreen window of 1920 x 1080 on it (never shown,
// never focused, muted three ways: see preload.cjs), connects a stand-in launch-monitor
// connector to the private Open Connect port, and hands a small driving API to the scene
// script, which plays the game and says when to record. Clips are written as Matroska/WebM
// by the page's own MediaRecorder (video: a capture of the tab itself, HUD included;
// audio: the game's master output, tapped). No ffmpeg is needed to shoot.
const { app, BrowserWindow, session, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repo = path.resolve(__dirname, '..', '..', '..');
const args = process.argv.slice(2);
const flag = (name, d = null) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const has = (name) => args.includes(name);

const PORT = +flag('--port', 8341);
const OC_PORT = +flag('--oc', 9972);
for (const p of [PORT, OC_PORT]) if ([921, 8222, 9050].includes(p)) { console.error(`recorder: port ${p} belongs to the live game`); process.exit(2); }
const SCRATCH = path.resolve(repo, flag('--scratch', path.join('.scratch', 'trailer')));
const DATA = path.join(SCRATCH, 'data');
const OUT = path.resolve(repo, flag('--out', path.join(SCRATCH, 'raw')));
const SCENES = path.resolve(flag('--scenes', path.join(__dirname, 'scenes.mjs')));
const ONLY = (flag('--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const W = +flag('--width', 1920), H = +flag('--height', 1080), FPS = +flag('--fps', 60);
const MODE = flag('--window', 'osr');           // 'osr' (offscreen rendering) | 'hidden' (a never-shown window)
const GFX = flag('--gfx', 'high');             // the graphics tier every page is filmed at (never Auto: a slow moment would drop it mid-take)
const INPUT = flag('--input', 'connector');     // 'connector' (Open Connect, as a launch monitor's software does) | 'test-shot'
let windSeed = flag('--wind-seed', 'trailer-1');
const FAST = has('--fast');                    // rehearse: no recording, no waiting for the picture (the server plays a swing at once)
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const say = (text) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(7)}s  ${text}`);

// ---------- Chromium: no sound device, no throttling, one device pixel per CSS pixel ----------
app.setPath('userData', path.join(SCRATCH, 'electron-profile'));   // its own profile: never the game's settings or its single-instance lock
app.commandLine.appendSwitch('mute-audio');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCEncoderSupport');
app.on('window-all-closed', () => { /* the recorder quits when the scenes are done */ });

// ---------- the private server ----------
let server = null;
const serverLog = [];
async function startServer() {
  fs.mkdirSync(DATA, { recursive: true });
  const env = {
    ...process.env,
    BIRDIE_PORT: String(PORT), BIRDIE_OC_PORT: String(OC_PORT), BIRDIE_DATA_DIR: DATA,
    BIRDIE_ENRICH: '0', BIRDIE_SKY_PREFETCH: '0', BIRDIE_FORESIGHT: 'off', BIRDIE_NO_WATCH: '1',
    BIRDIE_WIND_SEED: windSeed,
    BIRDIE_VOICE_ENV: path.join(SCRATCH, 'no-such.env'),
    ELEVENLABS_API_KEY: '',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_TEST_CONTEXT;
  server = spawn('node', ['server.js', '--bundled-arcade'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const keep = (buf) => { for (const line of String(buf).split(/\r?\n/)) if (line.trim()) { serverLog.push(line); if (has('--verbose')) console.log(`           | ${line}`); } };
  server.stdout.on('data', keep);
  server.stderr.on('data', keep);
  for (let i = 0; i < 300; i++) {
    if (serverLog.some((l) => l.includes('[HTTP]'))) return;
    if (server.exitCode !== null) throw new Error(`the private server did not start:\n${serverLog.join('\n')}`);
    await sleep(100);
  }
  throw new Error(`the private server did not come up within 30 s:\n${serverLog.join('\n')}`);
}
function stopServer() { try { if (server && server.exitCode === null) server.kill(); } catch (_) { /* gone */ } }
async function stopServerAndWait() {
  if (!server || server.exitCode !== null) return;
  const gone = new Promise((resolve) => server.once('exit', resolve));
  server.kill();
  await Promise.race([gone, sleep(4000)]);
}
process.on('exit', stopServer);

const api = async (route, body) => {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(BASE + route, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return await res.json().catch(() => null);
    } catch (error) {   // a kept-alive socket to a server that was just restarted
      if (attempt >= 4) throw error;
      await sleep(200);
    }
  }
};

// ---------- the event stream (the match state, shots) ----------
const events = [];
let sseAbort = null;
async function openEvents() {
  sseAbort = new AbortController();
  const res = await fetch(`${BASE}/events`, { signal: sseAbort.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true });
        let at;
        while ((at = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, at);
          buf = buf.slice(at + 2);
          const event = (/^event: (.*)$/m.exec(chunk) || [])[1];
          const data = (/^data: (.*)$/m.exec(chunk) || [])[1];
          let parsed = null;
          try { parsed = data ? JSON.parse(data) : null; } catch (_) { /* not JSON */ }
          if (event) events.push({ i: events.length, t: Date.now(), event, data: parsed });
          if (events.length > 6000) events.splice(0, 2000);
        }
      }
    } catch (_) { /* closed */ }
  })();
}
async function waitEvent(pred, { since = null, timeoutMs = 20000 } = {}) {
  const from = since == null ? Date.now() : since;
  const until = Date.now() + timeoutMs;
  for (;;) {
    for (const e of events) if (e.t >= from && pred(e)) return e;
    if (Date.now() > until) return null;
    await sleep(20);
  }
}
const matchNow = () => { for (let i = events.length - 1; i >= 0; i--) if (events[i].event === 'match') return events[i].data; return null; };

// ---------- the stand-in connector (Open Connect, specification-shaped messages) ----------
let ocSock = null, ocBeat = null, shotNumber = Math.floor(Date.now() / 1000) % 100000;
const ocMessage = (ball, options) => ({
  DeviceID: 'Trailer Connector', Units: 'Yards', ShotNumber: ball ? ++shotNumber : 0, APIversion: '1',
  BallData: ball || { Speed: 0, SpinAxis: 0, TotalSpin: 0, BackSpin: 0, SideSpin: 0, HLA: 0, VLA: 0, CarryDistance: 0 },
  ClubData: { Speed: 0, AngleOfAttack: 0, FaceToTarget: 0, Lie: 0, Loft: 0, Path: 0, SpeedAtImpact: 0, VerticalFaceImpact: 0, HorizontalFaceImpact: 0, ClosureRate: 0 },
  ShotDataOptions: { ContainsBallData: !!ball, ContainsClubData: false, LaunchMonitorIsReady: true, LaunchMonitorBallDetected: true, IsHeartBeat: false, ...options },
});
function connectMonitor() {
  return new Promise((resolve, reject) => {
    ocSock = net.connect(OC_PORT, '127.0.0.1');
    ocSock.setNoDelay(true);
    ocSock.on('connect', () => {
      ocSock.write(JSON.stringify(ocMessage(null, { IsHeartBeat: true })));
      ocBeat = setInterval(() => { try { ocSock.write(JSON.stringify(ocMessage(null, { IsHeartBeat: true }))); } catch (_) { /* closed */ } }, 5000);
      resolve();
    });
    ocSock.on('data', () => {});
    ocSock.on('error', (e) => reject(e));
  });
}
function disconnectMonitor() { clearInterval(ocBeat); try { ocSock && ocSock.destroy(); } catch (_) { /* gone */ } ocSock = null; }

// ---------- the window ----------
let win = null;
const files = new Map();   // clip name -> { fd, file, next, held: Map }
const clipMeta = new Map();
function createWindow() {
  win = new BrowserWindow({
    width: W, height: H, useContentSize: true, show: false, frame: false, skipTaskbar: true, focusable: false,
    enableLargerThanScreen: true, paintWhenInitiallyHidden: true, backgroundColor: '#07090d',
    webPreferences: {
      offscreen: MODE === 'osr', backgroundThrottling: false, contextIsolation: false, nodeIntegration: false, sandbox: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  win.webContents.setAudioMuted(true);
  if (MODE === 'osr') win.webContents.setFrameRate(FPS);
  win.setContentSize(W, H);
  win.webContents.on('console-message', (e) => { if (e && (e.level === 'error' || e.level === 3)) pageErrors.push(`${e.message} (${e.sourceId}:${e.lineNumber})`); });
  win.webContents.on('render-process-gone', (_e, d) => { say(`!! renderer gone: ${d && d.reason}`); });
  // the tab captures itself; nothing else is ever offered
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => { callback({ video: win.webContents.mainFrame }); });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(true));
  session.defaultSession.setPermissionCheckHandler(() => true);
  // player-name clips are rendered by an outside service when the owner has a key: never from here
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/api/voice/*'] }, (details, callback) => callback({ cancel: details.method === 'POST' }));
  // ... and nothing but the private server is ever fetched
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    let host = '';
    try { host = new URL(details.url).hostname; } catch (_) { /* odd URL */ }
    const local = host === '127.0.0.1' || host === 'localhost' || details.url.startsWith('devtools:') || details.url.startsWith('file:') || details.url.startsWith('data:') || details.url.startsWith('blob:');
    if (!local) offsite.push(details.url);
    callback({ cancel: !local, requestHeaders: details.requestHeaders });
  });
}
const pageErrors = [];
const offsite = [];

ipcMain.on('trailer:begin', (_e, name, mime) => {
  const ext = /matroska/.test(mime) ? 'mkv' : 'webm';
  const file = path.join(OUT, `${name}.${ext}`);
  fs.mkdirSync(OUT, { recursive: true });
  for (const other of ['mkv', 'webm']) { try { fs.unlinkSync(path.join(OUT, `${name}.${other}`)); } catch (_) { /* none */ } }
  files.set(name, { fd: fs.openSync(file, 'w'), file, next: 0, held: new Map() });
});
ipcMain.on('trailer:chunk', (_e, name, n, bytes) => {
  const f = files.get(name);
  if (!f) return;
  f.held.set(n, Buffer.from(bytes));
  while (f.held.has(f.next)) { fs.writeSync(f.fd, f.held.get(f.next)); f.held.delete(f.next); f.next++; }
});
ipcMain.on('trailer:end', (_e, name, meta) => {
  const f = files.get(name);
  if (f) { fs.closeSync(f.fd); files.delete(name); meta.file = path.relative(repo, f.file).replace(/\\/g, '/'); }
  clipMeta.set(name, meta);
});

const evaluate = (js, gesture = true) => win.webContents.executeJavaScript(js, gesture);

// ---------- what a scene gets ----------
function makeContext() {
  const ctx = {
    repo, base: BASE, out: OUT, scratch: SCRATCH, W, H, FPS, say, api, events, waitEvent, matchNow,
    fast: FAST,
    /** Wait (not at all when rehearsing with --fast). */
    sleep: (ms) => sleep(FAST ? Math.min(ms, 30) : ms),
    realSleep: sleep,
    /** A fresh private server with this wind seed: the same seed and the same sequence of stages give the same winds, so a scene plays the same every time. */
    async restartServer(seed) {
      try { sseAbort && sseAbort.abort(); } catch (_) { /* closed */ }
      disconnectMonitor();
      await stopServerAndWait();
      serverLog.length = 0; events.length = 0;
      if (seed) windSeed = String(seed);
      // a clean bay for every take: no roster, no trophies, no coins left by the take before
      // (only the private data dir; the stages and the skies in it are kept)
      for (const e of fs.readdirSync(DATA, { withFileTypes: true })) {
        if (e.isFile() && !['arcade-tour.json', 'arcade-bundle.json'].includes(e.name)) fs.rmSync(path.join(DATA, e.name), { force: true });
        if (e.isDirectory() && e.name === 'voice') fs.rmSync(path.join(DATA, e.name), { recursive: true, force: true });
      }
      await startServer();
      await openEvents();
    },
    get: (route) => api(route),
    evaluate,
    /** Load a game page and wait for its event stream (and the stage) to be up. */
    async goto(pathAndQuery, { settleMs = 6000 } = {}) {
      // a renderer that died (seen once, on the fourth quick reload of a rehearsal) is replaced
      for (let attempt = 0; ; attempt++) {
        try {
          if (!win || win.isDestroyed() || win.webContents.isCrashed()) { try { win && !win.isDestroyed() && win.destroy(); } catch (_) { /* gone */ } createWindow(); }
          await win.loadURL(BASE + (/[?&]gfx=/.test(pathAndQuery) ? pathAndQuery : `${pathAndQuery}${pathAndQuery.includes('?') ? '&' : '?'}gfx=${GFX}`));
          break;
        } catch (error) {
          if (attempt >= 2) throw error;
          say(`   (the page did not load: ${error.message}; a new window)`);
          try { win.destroy(); } catch (_) { /* gone */ }
          await sleep(1500);
          createWindow();
        }
      }
      await evaluate('new Promise((r) => { const go = () => (window.__birdie ? r(true) : setTimeout(go, 100)); go(); })');
      // every frame at full resolution: the game's dynamic resolution would trade pixels for frame rate in the middle of a take
      await evaluate("(() => { const s = window.__birdie.scene; if (!s) return false; s._resScale = 1; s._resScaleSet = true; s._resPending = null; s._resIntervals = { push() {}, length: 0 }; s.resize(); return true; })()");
      // the game makes its AudioContext on the first gesture: give it one that no screen reacts to
      // (a bare 'pointerdown' on window: only the audio layer listens there), so the sound
      // tap exists, and the samples are loading, before anything is recorded
      await evaluate("window.dispatchEvent(new Event('pointerdown')); true");
      await sleep(FAST ? 1500 : settleMs);
      recorderReady = false;
    },
    /** A real key press in the page (down + up), e.g. 'Enter', 'Escape', '1', 'B', 'Right'. */
    async key(keyCode, { modifiers = [], holdMs = 40 } = {}) {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      if (keyCode.length === 1) win.webContents.sendInputEvent({ type: 'char', keyCode, modifiers });
      await sleep(holdMs);
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      await ctx.mark(`key:${keyCode}`);
    },
    /** A real mouse click at the middle of the first element matching `selector`. */
    async click(selector) {
      const at = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      if (!at) throw new Error(`click: nothing matches ${selector}`);
      win.webContents.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y });
      win.webContents.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 });
      await ctx.mark(`click:${selector}`);
      return at;
    },
    /** Park the mouse where no HUD element hovers. */
    async mouseAway() { win.webContents.sendInputEvent({ type: 'mouseMove', x: W - 2, y: Math.round(H * 0.42) }); },
    /** One swing: { speed, vla, hla, spin, spinAxis }. Through the connector (default) or the test-shot route. */
    async swing(launch, label = 'swing') {
      const since = Date.now();
      await ctx.mark(label, { launch });
      if (INPUT === 'connector' && ocSock) {
        const axis = launch.spinAxis || 0, spin = launch.spin || 0;
        ocSock.write(JSON.stringify(ocMessage({
          Speed: launch.speed, SpinAxis: axis, TotalSpin: spin,
          BackSpin: Math.round(spin * Math.cos(axis * Math.PI / 180)), SideSpin: Math.round(spin * Math.sin(axis * Math.PI / 180)),
          HLA: launch.hla || 0, VLA: launch.vla, CarryDistance: 0,
        })));
      } else {
        await api('/api/test-shot', launch);
      }
      const shot = await waitEvent((e) => e.event === 'shot', { since, timeoutMs: 4000 });
      if (!shot) say(`   !! the swing '${label}' was not played (${JSON.stringify(launch)})`);
      return shot ? shot.data : null;
    },
    /** Wait until `js` (an expression) is truthy in the page. */
    async waitFor(js, { timeoutMs = 20000, everyMs = 50 } = {}) {
      const until = Date.now() + timeoutMs;
      for (;;) {
        const v = await evaluate(`(() => { try { return (${js}); } catch (e) { return null; } })()`).catch(() => null);
        if (v) return v;
        if (Date.now() > until) return null;
        await sleep(everyMs);
      }
    },
    /** A still of the hidden window (PNG), for looking at what a scene will film. */
    async snap(name) {
      const img = await win.webContents.capturePage();
      const file = path.join(SCRATCH, 'stills', `${name}.png`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, img.toPNG());
      return file;
    },
    rec: {
      async start(name, opts = {}) {
        if (FAST) return null;
        if (!recorderReady) {
          const info = await evaluate(`window.__trailer.init(${JSON.stringify({ fps: FPS, width: W, height: H })})`);
          if (!recorderInfo) say(`   recorder: ${info.mime}; capture ${info.settings.width}x${info.settings.height}@${info.settings.frameRate}; audio ${JSON.stringify(info.audio)}`);
          recorderInfo = info;
          recorderReady = true;
        }
        const audio = await evaluate('window.__trailer.audioState()');
        if (audio.context !== 'running' && !opts.silent) throw new Error(`the game's sound is not running (${JSON.stringify(audio)}): a clip recorded now would be silent`);
        const r = await evaluate(`window.__trailer.start(${JSON.stringify(name)}, ${JSON.stringify(opts)})`);
        clipExtra.set(name, { scene: currentScene, ...(opts.info || {}) });
        say(`   REC ${name}${r.hasAudio ? '' : ' (NO AUDIO: the game has not made its AudioContext yet)'}`);
        return r;
      },
      async stop() {
        if (FAST) return null;
        const meta = await evaluate('window.__trailer.stop()');
        if (!meta) return null;
        await sleep(150);   // the last chunk and the 'end' message
        const full = { ...meta, ...(clipMeta.get(meta.name) || {}), ...(clipExtra.get(meta.name) || {}), audible: win.webContents.isCurrentlyAudible(), muted: win.webContents.isAudioMuted() };
        fs.writeFileSync(path.join(OUT, `${meta.name}.json`), JSON.stringify(full, null, 2));
        say(`   CUT ${meta.name}: ${meta.durationS.toFixed(1)} s, ${(meta.bytes / 1e6).toFixed(1)} MB, page ${meta.pageCadence.fps} fps (p95 gap ${meta.pageCadence.gapMs.p95} ms, max ${meta.pageCadence.gapMs.max} ms), tap peak ${meta.tapPeak}, audible to a device: ${full.audible}`);
        return full;
      },
    },
    async mark(label, extra) { try { return await evaluate(`window.__trailer && window.__trailer.mark(${JSON.stringify(label)}, ${JSON.stringify(extra || null)})`); } catch (_) { return null; } },
    audible: () => win.webContents.isCurrentlyAudible(),
    monitor: { connect: connectMonitor, disconnect: disconnectMonitor, get connected() { return Boolean(ocSock); } },
    pageErrors, offsite, serverLog,
  };
  return ctx;
}
let recorderReady = false, recorderInfo = null, currentScene = null;
const clipExtra = new Map();

app.whenReady().then(async () => {
  let code = 0;
  try {
    say(`private server on ${PORT} (Open Connect ${OC_PORT}), data ${path.relative(repo, DATA)}`);
    await startServer();
    await openEvents();
    createWindow();
    const mod = await import(pathToFileURL(SCENES).href);
    const scenes = mod.scenes || mod.default;
    const ctx = makeContext();
    if (mod.setup) await mod.setup(ctx);
    const todo = scenes.filter((s) => !ONLY.length || ONLY.includes(s.id));
    if (ONLY.length) for (const id of ONLY) if (!scenes.some((s) => s.id === id)) throw new Error(`no scene '${id}' (have: ${scenes.map((s) => s.id).join(', ')})`);
    for (const scene of todo) {
      currentScene = scene.id;
      say(`SCENE ${scene.id}${scene.title ? `: ${scene.title}` : ''}`);
      try {
        await scene.run(ctx);
      } catch (error) {
        code = 1;
        say(`!! scene ${scene.id} failed: ${error && error.stack || error}`);
        try { await ctx.rec.stop(); } catch (_) { /* nothing recording */ }
        try { await api('/api/match/abort', {}); } catch (_) { /* server gone */ }
      }
    }
    if (mod.teardown) await mod.teardown(ctx);
    if (pageErrors.length) say(`page errors (${pageErrors.length}): ${[...new Set(pageErrors)].slice(0, 8).join(' | ')}`);
    if (offsite.length) say(`requests that would have left this PC, all blocked (${offsite.length}): ${[...new Set(offsite)].slice(0, 5).join(' | ')}`);
  } catch (error) {
    code = 1;
    console.error(error && error.stack || error);
    if (serverLog.length) console.error(serverLog.slice(-12).join('\n'));
  } finally {
    try { sseAbort && sseAbort.abort(); } catch (_) { /* closed */ }
    disconnectMonitor();
    try { if (win && !win.isDestroyed()) win.destroy(); } catch (_) { /* gone */ }
    stopServer();
    app.exit(code);
  }
});
