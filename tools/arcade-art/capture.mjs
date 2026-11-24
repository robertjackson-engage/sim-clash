#!/usr/bin/env node
// Stills and frame-time numbers of a stage from a PRIVATE game server, without a window and
// without sound (headless Chrome over the DevTools protocol, as tools/release/screenshots.mjs):
//
//   node tools/arcade-art/capture.mjs --url http://localhost:8352 --stage thunder-dome --tag after
//        [--views tee,green,wide,stands] [--out .scratch/stadium/shots] [--gfx high] [--size 1920x1080]
//        [--stats] [--react cheer,groan,wave,tense,win] [--theme x --tod night] [--settle 9000]
//
// --views   named cameras, placed relative to the hole's own tee -> pin line (see VIEWS)
// --stats   frame time (the scene's own frame run N times, then gl.finish), triangles and
//           draw calls of one frame, per view; printed and written to <out>/<stage>-<tag>-stats.json
// --at      extra cameras in metres from the tee (x east, y north: a hole file's own frame): name:x:y:up:yaw:pitch:dist[,name:...] (yaw: compass bearing the camera looks along)
// --react   after the stills: a short burst of frames for each reaction (scene.props.crowdReact)
//
// PNG files are named <stage>-<tag>-<view>.png. The server must be on its own ports and data
// dir (BIRDIE_PORT / BIRDIE_OC_PORT / BIRDIE_DATA_DIR): this script switches its course.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, d = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const has = (name) => args.includes(name);
const base = (flag('--url') || 'http://localhost:8352').replace(/\/$/, '');
const outDir = path.resolve(flag('--out') || path.join('.scratch', 'stadium', 'shots'));
const stageId = flag('--stage') || 'thunder-dome';
const tag = flag('--tag') || 'shot';
const gfx = flag('--gfx') || 'high';
const [W, H] = (flag('--size') || '1920x1080').split('x').map(Number);
const settleMs = Number(flag('--settle') || 9000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A view: where the free camera looks (along / across the tee -> pin line, metres from the
// tee; up above the ground there), from which bearing relative to the line of play
// (0 = looking the way the hole plays, 180 = back at the tee), pitch (deg, negative looks
// down) and distance. 'tee' is the game's own address camera.
export const VIEWS = {
  tee: null,
  green: { along: 0.42, across: 0, up: 3, yaw: 180, pitch: -4, dist: 78, rel: true },       // from behind the flag, back at the tee and the stands
  wide: { along: 0.7, across: 0, up: 0, yaw: 24, pitch: -30, dist: 290, rel: true },         // the whole arena from above
  stands: { along: 0.72, across: -60, up: 6, yaw: -78, pitch: -3, dist: 34, rel: true },     // close on a side stand, from the pitch
  side: { along: 0.72, across: 0, up: 2, yaw: 90, pitch: -6, dist: 120, rel: true },         // across the hole
  finish: { along: 1.0, across: 0, up: 4, yaw: 0, pitch: -8, dist: 70, rel: true },          // up to the green and what is behind it
  crowd: { along: 0.72, across: -68, up: 5, yaw: -80, pitch: 4, dist: 13, rel: true },      // into the faces
};

const chrome = flag('--chrome') || [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => fs.existsSync(p));
if (!chrome) { console.error('No Chrome or Edge found: pass --chrome <path>.'); process.exit(1); }

const api = async (route, body) => {
  const res = await fetch(base + route, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json().catch(() => null);
};

fs.mkdirSync(outDir, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'stadium-capture-'));
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
  else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) consoleLines.push(`[${m.params.type}] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400)}`);
  else if (m.method === 'Runtime.exceptionThrown') consoleLines.push(`[exception] ${(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 600)}`);
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
  console.log('  wrote', file);
  return file;
};

const setView = (v) => evaluate(`(() => {
  const s = window.__birdie.scene;
  const v = ${JSON.stringify(v)};
  s.backdrop = null;   // (the menus' backdrop blurs a free camera)
  if (!v) { s.enterFreeCam(false); s.camMode = 'idle'; s._snapIdleCam(); return 'idle'; }
  const b = s.ballSim, p = s.pinSim;
  const L = Math.hypot(p.x - b.x, p.y - b.y) || 1, ux = (p.x - b.x) / L, uy = (p.y - b.y) / L;
  const al = v.rel ? v.along * L : v.along;
  const tx = v.abs ? b.x + v.x : b.x + ux * al + uy * v.across, ty = v.abs ? b.y + v.y : b.y + uy * al - ux * v.across;
  s.enterFreeCam(true);
  const line = Math.atan2(ux, uy) * 180 / Math.PI;
  Object.assign(s.free, { tx, ty, hOff: v.up || 0, yaw: (v.abs ? 0 : line) + v.yaw, pitch: v.pitch, dist: v.dist });
  s._freeStep(0); s._freeTargets();
  s.camera.position.copy(s.camPosT); s.lookCur.copy(s.lookT); s.camera.lookAt(s.lookCur);
  return 'free';
})()`);

// one frame's triangles and draw calls, and the time of N frames run back to back (no vsync)
const stats = (frames = 40) => evaluate(`(async () => {
  const s = window.__birdie.scene, r = s.renderer, gl = r.getContext();
  const info = r.info, was = info.autoReset;
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  info.autoReset = false; info.reset();
  s._frame(); gl.finish();
  const one = { calls: info.render.calls, triangles: info.render.triangles, points: info.render.points };
  info.autoReset = was;
  // GPU time: N frames, then wait for the GPU to drain
  const px = new Uint8Array(4);
  const t0 = performance.now();
  for (let i = 0; i < ${frames}; i++) s._frame();
  gl.finish(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const ms = (performance.now() - t0) / ${frames};
  // and what the page's own loop is doing
  let n = 0; const t1 = performance.now();
  await new Promise((res) => { const tick = () => { n++; if (performance.now() - t1 < 1500) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return { ...one, frameMs: Math.round(ms * 100) / 100, rafFps: Math.round(n / ((performance.now() - t1) / 1000)),
    size: [r.domElement.width, r.domElement.height], quality: s.quality && (s.quality.name || s.quality.key || s.qualitySetting) || null,
    gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
    props: s.props && s.props.stats ? s.props.stats() : null };
})()`);

try {
  const state = await api('/api/match');
  const tour = state && state.tour;
  if (!tour) throw new Error(`No tour at ${base}: build the stages into its data dir.`);
  const stage = [...tour.stages, ...tour.tiebreaks].find((x) => x.id === stageId);
  if (!stage) throw new Error(`no stage ${stageId}`);
  if (state.match) await api('/api/match/abort', {});
  await api('/api/load-course', { cached: stage.file });
  const extra = [flag('--theme') ? `&theme=${flag('--theme')}` : '', flag('--tod') ? `&tod=${flag('--tod')}` : '', flag('--query') ? `&${flag('--query')}` : ''].join('');
  await page('Page.navigate', { url: `${base}/?menu=0&sound=0&gfx=${gfx}${extra}` });
  await sleep(settleMs);
  await evaluate(`(async () => { const s = window.__birdie.scene; if (s.props && s.props.ready) await s.props.ready; return true; })()`);
  await evaluate(`document.body.classList.add('stadium-capture'); (() => { const st = document.createElement('style'); st.textContent = ${JSON.stringify(has('--hud') ? '' : '#hud, .hud, .arc-root, .arc-hud, .mt-root, #sidebar, .panel, .toast, #toast { visibility: hidden !important; }')}; document.head.appendChild(st); })()`);
  await sleep(1500);
  if (flag('--eval')) console.log('  eval:', JSON.stringify(await evaluate(flag('--eval'))));   // a line of JavaScript in the page (window.__birdie.scene), for debugging
  const views = (flag('--views') || 'tee,green,wide').split(',').filter(Boolean);
  for (const spec of (flag('--at') || '').split(',').filter(Boolean)) {
    const [name, x, y, up, yaw, pitch, dist] = spec.split(':');
    VIEWS[name] = { abs: true, x: +x, y: +y, up: +up, yaw: +yaw, pitch: +pitch, dist: +dist };
    views.push(name);
  }
  const out = {};
  for (const name of views) {
    if (!(name in VIEWS)) { console.warn('unknown view', name); continue; }
    await setView(VIEWS[name]);
    await sleep(1800);
    await snap(`${stageId}-${tag}-${name}`);
    if (has('--stats')) { out[name] = await stats(); console.log(' ', name, JSON.stringify(out[name])); }
  }
  if (has('--stats')) fs.writeFileSync(path.join(outDir, `${stageId}-${tag}-stats.json`), JSON.stringify(out, null, 2) + '\n');
  if (flag('--react')) {
    const view = flag('--react-view') || 'stands';
    await setView(VIEWS[view]);
    await sleep(1200);
    for (const kind of flag('--react').split(',')) {
      await evaluate(`(() => { const p = window.__birdie.scene.props; if (p.crowdReact) p.crowdReact(${JSON.stringify(kind)}, { intensity: 1 }); return true; })()`);
      for (let i = 0; i < Number(flag('--react-frames') || 6); i++) {
        await sleep(Number(flag('--react-every') || 420));
        await snap(`${stageId}-${tag}-react-${kind}-${i}`);
      }
      await sleep(2500);
    }
  }
  if (consoleLines.length) { console.log('console:'); for (const l of [...new Set(consoleLines)].slice(0, 30)) console.log('  ', l); }
} catch (error) {
  console.error(error.message);
  if (consoleLines.length) for (const l of [...new Set(consoleLines)].slice(0, 30)) console.log('  ', l);
  process.exitCode = 1;
} finally {
  try { await send('Target.closeTarget', { targetId }); } catch (_) { /* closed */ }
  try { ws.close(); } catch (_) { /* closed */ }
  cleanup();
}
