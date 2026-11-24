#!/usr/bin/env node
// v3:living Stills, short frame sequences and frame times of the WORLD EVENTS layer
// (public/render/world-events.js, docs/living-world.md) from a PRIVATE game server, without a
// window and without sound:
//
//   node tools/arcade-art/living/capture.mjs --url http://localhost:8357 --plan plan.json
//        [--out .scratch/living/shots] [--size 1280x720] [--gfx high] [--only <stage,stage>]
//   node tools/arcade-art/living/capture.mjs --url http://localhost:8357 --perf [--stages a,b]
//
// A plan is a JSON array of { stage, query?, sheet?, cols?, shots: [...] }, a shot being
//   { name,                       the tile's label
//     cam: 'tee' | { tx, ty, yaw, pitch, dist, hOff } | { at: [x, y], from: [x, y], up }
//          'tee' is the address camera; the object is the scene's free camera (a ground
//          pivot orbited at a distance); { at, from, up } looks at a point from another;
//          { follow: '<model>', index, dist, up, swing } looks at where that mover is now
//     pre: '<js>',                run in the page first, with s = the scene, w = s.worldEvents
//     waitMs: 1500,               then this long
//     frames: 1, everyMs: 400,    then this many stills, this far apart
//     shot: { speed, vla, ... }   a swing on the private server (POST /api/test-shot) just before the stills
//   }
// Every stage's stills are laid out on one contact sheet, <out>/<sheet or stage>.jpg, each
// tile labelled. Drives an installed Chrome or Edge headless over the DevTools protocol, the
// way tools/arcade-art/env/capture.mjs does (a throwaway profile, muted, ?sound=0).
//
// --perf: the layer's own share of the frame, at the tee of each stage: the layer switched on
// and off in place over 14 alternating rounds (see PERF_JS), so the difference is the layer
// and not the weather on the GPU that minute.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, d = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const has = (name) => args.includes(name);
const base = (flag('--url') || 'http://localhost:8357').replace(/\/$/, '');
const outDir = path.resolve(flag('--out') || path.join('.scratch', 'living', 'shots'));
const [W, H] = (flag('--size') || '1280x720').split('x').map(Number);
const gfx = flag('--gfx') || 'high';
const only = (flag('--only') || '').split(',').filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sharp = createRequire(import.meta.url)('sharp');

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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'living-capture-'));
const proc = spawn(chrome, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--mute-audio', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--hide-scrollbars', `--window-size=${W},${H}`, '--force-device-scale-factor=1', '--ignore-gpu-blocklist',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank',
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
const consoleErrors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); if (m.error) reject(new Error(m.error.message)); else resolve(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(`exception: ${m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text}`);
  else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) consoleErrors.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 600)}`);
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId })); });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const page = (method, params) => send(method, params, sessionId);
await page('Page.enable');
await page('Runtime.enable');
const setSize = (w, h) => page('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
await setSize(W, H);

const evaluate = async (expression) => {
  const r = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  return r.result ? r.result.value : undefined;
};
const inScene = (js) => evaluate(`(() => { const s = window.__birdie.scene, w = s.worldEvents; ${js} })()`);
const go = async (stageFile, query = '', hud = false) => {
  await api('/api/load-course', { cached: stageFile });
  await page('Page.navigate', { url: `${base}/?menu=0&sound=0&gfx=${gfx}${query ? `&${query}` : ''}` });
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const ok = await evaluate(`(() => { const s = window.__birdie && window.__birdie.scene; return !!(s && s.geo && s.environmentStatus && s.environmentStatus.state !== 'loading' && s._activeHole && (!s.farWorld || s.farWorld.ready !== false) && (!s._envTex || s._envTex.loaded)); })()`).catch(() => false);
    if (ok) break;
  }
  await sleep(4500);
  if (!hud) await evaluate(`(() => { const st = document.createElement('style'); st.textContent = 'body > *:not(#scene), #scene > *:not(canvas) { visibility: hidden !important; }'; document.head.appendChild(st); })()`);
  await evaluate(`(() => { const s = window.__birdie.scene; s._resScale = 1; s._resScaleSet = true; s._resPending = null; s._autoQuality = false; s.resize(); })()`);
};

const setCam = async (cam) => {
  if (!cam || cam === 'tee') return inScene('s.enterFreeCam(false);');
  if (cam.follow) {
    // look at where a mover is NOW (worldEvents.where), from the tee's side of it
    return inScene(`const p = w.where(${JSON.stringify(cam.follow)})[${cam.index || 0}]; if (!p) return 'no ${cam.follow}';
      const b = s.ballSim, dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy) || 1, dist = ${cam.dist || 40}, up = ${cam.up ?? 12}, yaw0 = ${cam.swing || 0} * Math.PI / 180;
      const ux = (dx / d) * Math.cos(yaw0) - (dy / d) * Math.sin(yaw0), uy = (dx / d) * Math.sin(yaw0) + (dy / d) * Math.cos(yaw0);
      s.enterFreeCam(true);
      Object.assign(s.free, { tx: p.x, ty: p.y, yaw: Math.atan2(-ux, -uy) * 180 / Math.PI, pitch: -Math.atan2(up, dist) * 180 / Math.PI, dist: Math.hypot(dist, up), hOff: p.z - s.hAt(p.x, p.y) + ${cam.hOff || 0} });`);
  }
  let c = cam;
  if (cam.at) {
    // look at a point from another: the free camera orbits a ground pivot, so the pivot is `at`
    const [ax, ay] = cam.at, [fx, fy] = cam.from, up = cam.up ?? 6;
    const dist = Math.hypot(ax - fx, ay - fy);
    c = { tx: ax, ty: ay, yaw: Math.atan2(ax - fx, ay - fy) * 180 / Math.PI, pitch: -Math.atan2(up, dist) * 180 / Math.PI, dist: Math.hypot(dist, up), hOff: cam.hOff ?? 1 };
  }
  return inScene(`s.enterFreeCam(true); Object.assign(s.free, ${JSON.stringify(c)});`);
};
const png = async () => Buffer.from((await page('Page.captureScreenshot', { format: 'png' })).data, 'base64');
const label = (text, w) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="30"><rect width="${w}" height="30" fill="rgba(0,0,0,0.62)"/><text x="10" y="21" font-family="Arial, sans-serif" font-size="17" font-weight="700" fill="#fff">${String(text).replace(/[<&>]/g, '')}</text></svg>`);
const sheet = async (file, tiles, cols = 3, tw = 640) => {
  if (!tiles.length) return;
  const th = Math.round(tw * H / W), rows = Math.ceil(tiles.length / cols);
  const parts = await Promise.all(tiles.map(async (t, i) => ({
    input: await sharp(t.png).resize(tw, th).composite([{ input: label(t.name, tw), left: 0, top: 0 }]).toBuffer(), left: (i % cols) * tw, top: Math.floor(i / cols) * th,
  })));
  await sharp({ create: { width: cols * tw, height: rows * th, channels: 3, background: '#000' } }).composite(parts).jpeg({ quality: 84 }).toFile(file);
  console.log(path.relative(process.cwd(), file));
};

// The layer's share of a frame. The GPU's own minute-to-minute weather is bigger than the
// thing measured (another game may be running on this PC), so the layer is switched on and
// off IN PLACE, without a rebuild (its group shown and hidden; a dragon stays, because the
// stage has one either way), in alternating rounds of frames drawn back to back and flushed
// by a one-pixel read. Reported: the median of the round-by-round differences, and its
// quartiles. Then the same with the "calm" setting, and the JavaScript alone.
const PERF_JS = (frames, pairs) => `(async () => {
  const s = window.__birdie.scene, r = s.renderer, gl = r.getContext(), w = s.worldEvents;
  s._resScale = 1; s._resScaleSet = true; s._resPending = null; s._autoQuality = false; s.resize();
  r.setAnimationLoop(null);
  const px = new Uint8Array(4);
  const flush = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const hide = () => { if (w.group) for (const o of w.group.children) { if (o.name === 'world-life:dragon') continue; o.userData.keep = o.visible; o.visible = false; } };
  const back = () => { if (w.group) for (const o of w.group.children) { if (o.name === 'world-life:dragon') continue; if (o.userData.keep !== undefined) o.visible = o.userData.keep; } };
  const upd = w.update.bind(w);
  const round = () => { const t0 = performance.now(); for (let i = 0; i < ${frames}; i++) s._frame(); flush(); return (performance.now() - t0) / ${frames}; };
  const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
  const q = (a, f) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * f))]; };
  const ab = async () => {
    for (let i = 0; i < 30; i++) s._frame(); flush();
    const on = [], off = [], d = [];
    for (let k = 0; k < ${pairs}; k++) {
      // off: the layer hidden, and its update not run either
      hide(); w.update = () => {}; const a = round(); w.update = upd; back();
      for (let i = 0; i < 3; i++) s._frame();
      const b = round();
      off.push(a); on.push(b); d.push(b - a);
      await new Promise((res) => setTimeout(res, 15));
    }
    return { off: +med(off).toFixed(3), on: +med(on).toFixed(3), d: +med(d).toFixed(3), lo: +q(d, 0.25).toFixed(3), hi: +q(d, 0.75).toFixed(3) };
  };
  const count = () => { let best = null; r.info.autoReset = false; for (let i = 0; i < 6; i++) { r.info.reset(); s._frame(); const c = { calls: r.info.render.calls, tris: r.info.render.triangles }; if (!best || c.calls < best.calls) best = c; } r.info.autoReset = true; return best; };
  const res = {};
  w.setMode('full', { save: false }); await new Promise((x) => setTimeout(x, 2500));
  res.full = await ab();
  res.drawsOn = count(); hide(); res.drawsOff = count(); back();
  res.stats = w.stats();
  { const t0 = performance.now(); for (let i = 0; i < 3000; i++) w.update(s._frameNow + i / 60, 1 / 60, s.camera, { ball: s.ball.position }); res.updateMs = +((performance.now() - t0) / 3000).toFixed(4); }
  w.setMode('calm', { save: false }); await new Promise((x) => setTimeout(x, 2500));
  res.calm = await ab();
  w.setMode('full', { save: false });
  const size = r.getDrawingBufferSize(new (Object.getPrototypeOf(s.camera.position).constructor)());
  res.w = size.x; res.h = size.y; res.level = s.quality.level;
  r.setAnimationLoop(s._liveFrame);
  return res;
})()`;

try {
  const state = await api('/api/match');
  const tour = state && state.tour;
  if (!tour) throw new Error(`No tour at ${base}: build the stages into the server's data dir first.`);
  const all = [...tour.stages, ...tour.tiebreaks];
  if (has('--perf')) {
    const [PW, PH] = (flag('--perf-size') || '1920x1080').split('x').map(Number);
    const want = (flag('--stages') || all.map((s) => s.id).join(',')).split(',').filter(Boolean);
    const rows = [];
    for (const id of want) {
      const st = all.find((x) => x.id === id);
      if (!st) continue;
      await go(st.file, flag('--query') || '');
      await setSize(PW, PH);
      await setCam('tee');
      await sleep(2500);
      const r = await evaluate(PERF_JS(30, 14));
      rows.push({ stage: id, ...r });
      console.log(`${id.padEnd(18)} frame ${r.full.off.toFixed(2)} ms without, ${r.full.on.toFixed(2)} with: +${r.full.d.toFixed(2)} ms (quartiles ${r.full.lo.toFixed(2)} .. ${r.full.hi.toFixed(2)})  calm +${r.calm.d.toFixed(2)} ms  draws ${r.drawsOff.calls} -> ${r.drawsOn.calls}  tris +${((r.drawsOn.tris - r.drawsOff.tris) / 1000).toFixed(1)}k  update() ${r.updateMs} ms  ${r.w}x${r.h} ${r.level}`);
      await setSize(W, H);
    }
    const file = path.join(outDir, `perf-living-${gfx}-${PW}x${PH}.json`);
    fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), gfx, size: [PW, PH], rows }, null, 2));
    console.log(path.relative(process.cwd(), file));
  } else {
    const plan = JSON.parse(fs.readFileSync(path.resolve(flag('--plan')), 'utf8'));
    let loaded = null;
    for (const job of plan) {
      if (only.length && !only.includes(job.stage) && !only.includes(job.sheet)) continue;
      const st = all.find((x) => x.id === job.stage);
      if (!st) { console.error(`no stage ${job.stage}`); continue; }
      // (two sheets of one stage running: the page that is up is used again)
      const key = `${st.file}|${job.query || ''}|${!!job.hud}`;
      if (key !== loaded) { consoleErrors.length = 0; await go(st.file, job.query || '', !!job.hud); loaded = key; }
      const tiles = [];
      for (const shot of job.shots) {
        await setCam(shot.cam);
        await sleep(shot.settleMs ?? 1800);
        if (shot.pre) { const v = await inScene(shot.pre); if (v !== undefined && v !== null) console.log(`  ${shot.name}:`, JSON.stringify(v)); }
        if (shot.shot) await api('/api/test-shot', shot.shot);
        await sleep(shot.waitMs ?? 600);
        for (let i = 0; i < (shot.frames || 1); i++) {
          if (i) await sleep(shot.everyMs ?? 400);
          tiles.push({ name: `${shot.name}${(shot.frames || 1) > 1 ? `  +${((shot.waitMs ?? 600) + i * (shot.everyMs ?? 400)) / 1000}s` : ''}`, png: await png() });
        }
        if (shot.post) await inScene(shot.post);
      }
      await sheet(path.join(outDir, `${job.sheet || job.stage}.jpg`), tiles, job.cols || 3);
      const errs = [...new Set(consoleErrors)].filter((e) => !/favicon|ERR_|Failed to load resource|THREE.Clock|Golden hour sky|no image data/.test(e));
      if (errs.length) console.error(`  [${job.stage}] page said:\n    ${errs.slice(0, 10).join('\n    ')}`);
    }
  }
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  try { await send('Target.closeTarget', { targetId }); } catch (_) { /* closed */ }
  try { ws.close(); } catch (_) { /* closed */ }
  cleanup();
}
