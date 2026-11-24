#!/usr/bin/env node
// Stills and frame times of a stage's vegetation, from a PRIVATE game server, without a
// window and without sound (headless Chrome over the DevTools protocol, as
// tools/release/screenshots.mjs does):
//
//   BIRDIE_PORT=8351 BIRDIE_OC_PORT=9981 BIRDIE_DATA_DIR=.scratch/vegetation/data \
//   BIRDIE_ENRICH=0 BIRDIE_SKY_PREFETCH=0 node server.js
//
//   node tools/arcade-art/trees/capture.mjs --url http://localhost:8351 --stage temple-run
//        [--tag after] [--views tee,mid,green,wood] [--out .scratch/vegetation/shots]
//        [--gfx high] [--size 1920x1080] [--query "trees=classic"] [--perf] [--wait 9000]
//        [--free "x,y,yaw,pitch,dist[,hOff]"]  (a free camera: looks at the ground point x, y)
//        [--eval "<js expression of s (the scene) and f (its tree field)>"]
//
// Views: tee (the tee shot), mid (half way down the routing line), green (40 m short of
// the pin), wood (a free camera low at the nearest wood's edge). Files are
// <out>/<stage>-<view>-<tag>.png. --perf also prints, per view, the frame time measured the
// way public/perf-check.mjs does (frames back to back, then a one-pixel read-back so the GPU
// has finished them), the draw calls and the triangles of one frame, and what the tree
// field's group alone costs (the same frame with it hidden).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, d = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const has = (name) => args.includes(name);
const base = (flag('--url') || 'http://localhost:8351').replace(/\/$/, '');
const outDir = path.resolve(flag('--out') || path.join('.scratch', 'vegetation', 'shots'));
const stageId = flag('--stage') || 'temple-run';
const tag = flag('--tag') || 'shot';
const views = (flag('--views') || 'tee,mid,green').split(',').filter(Boolean);
const gfx = flag('--gfx') || 'high';
const [W, H] = (flag('--size') || '1920x1080').split('x').map(Number);
const extra = flag('--query') || '';
const waitMs = +(flag('--wait') || 9000);
const free = flag('--free');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = flag('--chrome') || [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => fs.existsSync(p));
if (!chrome) { console.error('No Chrome or Edge found: pass --chrome <path>.'); process.exit(1); }

const api = async (route, body) => {
  const res = await fetch(base + route, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json().catch(() => null);
};

fs.mkdirSync(outDir, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'veg-profile-'));
const proc = spawn(chrome, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--mute-audio', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--hide-scrollbars', `--window-size=${W},${H}`, '--force-device-scale-factor=1', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank',
], { stdio: 'ignore' });
const cleanup = () => { try { proc.kill(); } catch (_) { /* gone */ } setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) { /* in use */ } }, 500); };
process.on('exit', () => { try { proc.kill(); } catch (_) { /* gone */ } });

let port = null;
for (let i = 0; i < 100 && !port; i++) {
  await sleep(100);
  try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); } catch (_) { /* not yet */ }
}
if (!port) { console.error('The browser did not start.'); cleanup(); process.exit(1); }
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map();
const consoleLines = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); if (m.error) reject(new Error(m.error.message)); else resolve(m.result); }
  else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) consoleLines.push(`[${m.params.type}] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 600));
  else if (m.method === 'Runtime.exceptionThrown') consoleLines.push(`[exception] ${m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text}`.slice(0, 900));
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId })); });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const page = (method, params) => send(method, params, sessionId);
await page('Page.enable');
await page('Runtime.enable');
await page('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const evaluate = async (expression) => {
  const r = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result ? r.result.value : undefined;
};
const snap = async (name) => {
  const { data } = await page('Page.captureScreenshot', { format: 'png' });
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`wrote ${file}`);
  return file;
};

// In the page: put the ball (and so the address camera) at a view, or fly a free camera.
const PAGE_LIB = `(() => {
  const B = window.__birdie, s = B.scene;
  const lib = {};
  lib.ready = () => !!(s.geo && s.geo.holes && s.geo.holes.length) && (!s._treeField || !s._treeField.ready || s._treeField.loaded === true);
  lib.hud = (on) => {
    let st = document.getElementById('veg-capture-style');
    if (!st) { st = document.createElement('style'); st.id = 'veg-capture-style'; document.head.appendChild(st); }
    st.textContent = on ? '' : 'body > *:not(#scene) { visibility: hidden !important; } #scene > *:not(canvas) { visibility: hidden !important; }';
  };
  const along = (line, f) => {
    let L = 0; const seg = [];
    for (let i = 1; i < line.length; i++) { const d = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]); seg.push(d); L += d; }
    let want = f * L;
    for (let i = 0; i < seg.length; i++) {
      if (want <= seg[i] || i === seg.length - 1) { const t = Math.min(1, want / seg[i]); return { x: line[i][0] + (line[i + 1][0] - line[i][0]) * t, y: line[i][1] + (line[i + 1][1] - line[i][1]) * t, nx: line[i + 1][0], ny: line[i + 1][1] }; }
      want -= seg[i];
    }
  };
  lib.view = (name) => {
    const h = s.geo.holes[0], line = h.line && h.line.length > 1 ? h.line : [h.tee, h.pin];
    let p;
    if (name === 'tee') p = along(line, 0);
    else if (name === 'mid') p = along(line, 0.5);
    else if (name === 'green') {
      const q = along(line, 1), a = line[line.length - 2], L = Math.hypot(q.x - a[0], q.y - a[1]) || 1;
      p = { x: q.x - (q.x - a[0]) / L * 40, y: q.y - (q.y - a[1]) / L * 40, nx: q.x, ny: q.y };
    } else return false;
    s.enterFreeCam(false);
    const aim = Math.atan2(p.nx - p.x, p.ny - p.y) * 180 / Math.PI;
    s.aimDeg = aim; s.setBall({ x: p.x, y: p.y }); s.orbit = { yaw: 0, dist: 14, height: 4.6 }; s.camMode = 'idle'; s._snapIdleCam();
    return { x: p.x, y: p.y, aim };
  };
  lib.free = (pose) => { s.enterFreeCam(true); Object.assign(s.free, pose); s._freeTargets(); s.camera.position.copy(s.camPosT); s.lookCur.copy(s.lookT); s.camera.lookAt(s.lookCur); return true; };
  lib.wood = () => {
    // low at the edge of the trees nearest the middle of the hole, looking along them
    const h = s.geo.holes[0], line = h.line && h.line.length > 1 ? h.line : [h.tee, h.pin];
    const m = along(line, 0.35), trees = (s._allTreeSpots || []);
    let best = null, bd = 1e9;
    for (const t of trees) { const d = Math.hypot(t.x - m.x, t.y - m.y); if (d < bd && d > 12) { bd = d; best = t; } }
    if (!best) return false;
    const yaw = Math.atan2(best.x - m.x, best.y - m.y) * 180 / Math.PI;
    return lib.free({ tx: best.x, ty: best.y, yaw: yaw + 25, pitch: -6, dist: 26, hOff: 3.5 });
  };
  lib.perf = async () => {
    const r = s.renderer, gl = r.getContext(), px = new Uint8Array(4);
    const sync = () => { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); r.resetState(); };
    const track = s._trackFrameRate, resScale = s._resScale, resPending = s._resPending;
    r.setAnimationLoop(null); s._trackFrameRate = () => {}; s._resPending = null; s._resScale = 1; s.resize();
    const time = async () => {
      let t0 = performance.now();
      for (let i = 0; i < 3; i++) s._frame();
      sync();
      const n = Math.max(6, Math.min(60, Math.round(450 / Math.max(1, (performance.now() - t0) / 3))));
      let best = Infinity;
      for (let k = 0; k < 4; k++) {
        t0 = performance.now();
        for (let i = 0; i < n; i++) s._frame();
        sync();
        best = Math.min(best, (performance.now() - t0) / n);
        await new Promise((q) => setTimeout(q, 20));
      }
      return Math.round(best * 100) / 100;
    };
    const count = () => {
      const info = r.info, was = info.autoReset;
      info.autoReset = false; info.reset(); r.shadowMap.needsUpdate = true; s._frame();
      const out = { calls: info.render.calls, triangles: info.render.triangles };
      info.autoReset = was;
      return out;
    };
    const out = { canvas: r.domElement.width + 'x' + r.domElement.height, level: s.quality && s.quality.level };
    try {
      out.ms = await time();
      Object.assign(out, count());
      const g = s._treeField && s._treeField.group;
      if (g) {
        const extras = (s._treeField.extraGroups || []);
        const vis = [g, ...extras].map((o) => o.visible);
        g.visible = false; for (const o of extras) o.visible = false;
        out.msNoTrees = await time();
        const c = count(); out.callsNoTrees = c.calls; out.trianglesNoTrees = c.triangles;
        [g, ...extras].forEach((o, i) => { o.visible = vis[i]; });
        out.treeMs = Math.round((out.ms - out.msNoTrees) * 100) / 100;
        out.treeCalls = out.calls - out.callsNoTrees; out.treeTriangles = out.triangles - out.trianglesNoTrees;
        out.stats = s._treeField.stats;
      }
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      out.gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    } finally {
      s._resScale = resScale; s._resPending = resPending; s.resize(); s._trackFrameRate = track; s.clock.getDelta(); r.setAnimationLoop(s._liveFrame);
    }
    return out;
  };
  window.__veg = lib;
  return true;
})()`;

try {
  const state = await api('/api/match');
  const tour = state && state.tour;
  if (!tour) throw new Error(`No tour at ${base}: build the stages into the server's data dir first.`);
  const stage = [...tour.stages, ...tour.tiebreaks].find((x) => x.id === stageId);
  if (!stage) throw new Error(`No stage "${stageId}". Stages: ${[...tour.stages, ...tour.tiebreaks].map((x) => x.id).join(', ')}`);
  await api('/api/load-course', { cached: stage.file });
  await page('Page.navigate', { url: `${base}/?menu=0&sound=0&gfx=${gfx}${extra ? `&${extra}` : ''}` });
  await sleep(waitMs);
  await evaluate(PAGE_LIB);
  for (let i = 0; i < 60; i++) { if (await evaluate('window.__veg.ready()')) break; await sleep(500); }
  if (!has('--hud')) await evaluate('window.__veg.hud(false)');
  const perf = {};
  if (flag('--pre')) await evaluate(`(() => { const s = window.__birdie.scene, f = s._treeField; ${flag('--pre')}; return true; })()`);
  const list = free ? [...views, 'free'] : views;
  for (const v of list) {
    let ok;
    if (v === 'free') { const [tx, ty, yaw, pitch, dist, hOff = 0] = free.split(',').map(Number); ok = await evaluate(`window.__veg.free(${JSON.stringify({ tx, ty, yaw, pitch, dist, hOff })})`); }
    else if (v === 'wood') ok = await evaluate('window.__veg.wood()');
    else ok = await evaluate(`window.__veg.view(${JSON.stringify(v)})`);
    if (!ok) { console.log(`skipped view ${v}`); continue; }
    await sleep(2600);
    if (has('--perf')) { perf[v] = await evaluate('window.__veg.perf()'); await sleep(900); }
    await snap(`${stageId}-${v}-${tag}`);
  }
  if (flag('--eval')) console.log('eval:', JSON.stringify(await evaluate(`(() => { const s = window.__birdie.scene, f = s._treeField; return (${flag('--eval')}); })()`)));
  if (has('--perf')) {
    console.log(JSON.stringify(perf, null, 1));
    fs.writeFileSync(path.join(outDir, `${stageId}-perf-${tag}.json`), JSON.stringify(perf, null, 1));
  }
  if (consoleLines.length) console.log(`page console (${consoleLines.length}):\n  ${[...new Set(consoleLines)].slice(0, 20).join('\n  ')}`);
} catch (error) {
  console.error(error.message);
  if (consoleLines.length) console.error([...new Set(consoleLines)].slice(0, 20).join('\n'));
  process.exitCode = 1;
} finally {
  try { await send('Target.closeTarget', { targetId }); } catch (_) { /* closed */ }
  try { ws.close(); } catch (_) { /* closed */ }
  cleanup();
}
