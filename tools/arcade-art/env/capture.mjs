#!/usr/bin/env node
// Stills and frame times of the arcade stages from a PRIVATE game server, without a window
// and without sound (docs/arcade-look.md, "The world round a stage"):
//
//   node tools/arcade-art/env/capture.mjs --url http://localhost:8353 --tag after
//        [--stages lagoon-island,volcano-drop] [--views tee,green,wide] [--size 1920x1080]
//        [--gfx high] [--out .scratch/environment/shots] [--perf] [--perf-size 1920x1080]
//        [--query "theme=neon"] [--hud] [--eval "<js run in the page before each still>"]
//        [--putt [n]] (the putting game on the stage's green, then n putts (default 2) played through
//                  the private server, each filmed in six frames with the lens state: the pin
//                  cam's close-up and its depth of field on a putt that drops)
//        [--water] (a ball played into water, filmed where it goes in: splash rings)
//        [--menu] (the page as the player gets it: the title screen and menus up, nothing hidden;
//                  use with --views none to leave the camera to the shell: the stage behind
//                  the menus, and its depth of field)
//        [--fixed-time <s>] (each still is one frame drawn at that scene time with the camera
//                  snapped: scene.renderVisualCaptureStill. Two runs then show the same
//                  moment, which is what a before / after comparison of the real look needs)
//        [--probe "<js expression>"] (evaluated in the page after each still, with `s` the
//                  scene; its value is printed as JSON: what is in front of the camera, the
//                  lens state, a material's defines)
//        [--shot] (a full drive on the private server, then six frames of the flight: add
//                  --query "shotcam=ball" for the ball cam and its motion blur)
//
// Drives an installed Chrome or Edge in headless mode over the DevTools protocol (the same
// way tools/release/screenshots.mjs does: no dependency, a throwaway profile, muted, every
// page opened with ?sound=0). Views:
//   tee    the address camera the player sees on the tee
//   green  from behind the green, looking back over the flag
//   wide   an establishing angle: high and to one side of the hole
//   pin    close on the flag (the pin-cam framing)
// --perf times the frame instead: N frames drawn back to back and flushed (so vsync does not
// round the number), at --perf-size, reported as ms a frame with the draw calls of one frame.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, d = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const has = (name) => args.includes(name);
const base = (flag('--url') || 'http://localhost:8353').replace(/\/$/, '');
const outDir = path.resolve(flag('--out') || path.join('.scratch', 'environment', 'shots'));
const tag = flag('--tag') || 'shot';
const views = (flag('--views') || 'tee,green,wide').split(',').filter(Boolean);
const [W, H] = (flag('--size') || '1920x1080').split('x').map(Number);
const [PW, PH] = (flag('--perf-size') || '1920x1080').split('x').map(Number);
const gfx = flag('--gfx') || 'high';
const extraQuery = flag('--query') || '';
const preEval = flag('--eval') || '';
const probe = flag('--probe') || '';
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'env-capture-'));
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
const go = async (stageFile) => {
  await api('/api/load-course', { cached: stageFile });
  const q = `${has('--menu') ? '' : 'menu=0&'}sound=0&gfx=${gfx}${extraQuery ? `&${extraQuery}` : ''}`;
  await page('Page.navigate', { url: `${base}/?${q}` });
  // the course, its sky and its shaders are in; then a moment for trees, props and mirrors
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const ok = await evaluate(`(() => { const s = window.__birdie && window.__birdie.scene; return !!(s && s.geo && s.environmentStatus && s.environmentStatus.state !== 'loading' && s._activeHole && (!s.farWorld || s.farWorld.ready !== false) && (!s._envTex || s._envTex.loaded)); })()`).catch(() => false);
    if (ok) break;
  }
  await sleep(5000);
  if (!has('--hud') && !has('--menu')) await evaluate(`(() => { const st = document.createElement('style'); st.textContent = 'body > *:not(#scene), #scene > *:not(canvas) { visibility: hidden !important; }'; document.head.appendChild(st); })()`);
  // stills are taken at the full resolution asked for, whatever dynamic resolution settled on
  await evaluate(`(() => { const s = window.__birdie.scene; s._resScale = 1; s._resScaleSet = true; s._resPending = null; s._autoQuality = false; s.resize(); })()`);
};

// A camera for a view, set through the scene's own free camera (a ground pivot orbited at a
// distance): returns nothing, the next frames ease to it, so wait before the still.
const VIEW_JS = {
  tee: `s.enterFreeCam(false);`,
  none: `void 0;`,   // the camera as the page has it
  // (from behind the green where the ground allows it: a green at the foot of a cliff is
  // looked at from the first bearing round from there that leaves the camera in the open)
  green: `s.enterFreeCam(true); { const p = s.pinSim, b = s.ballSim; const dx = p.x - b.x, dy = p.y - b.y; const back = Math.atan2(-dx, -dy) * 180 / Math.PI;
    const dist = 34, pitch = -11, h0 = s.hAt(p.x, p.y) + 0.4;
    const open = (yaw) => { const r = yaw * Math.PI / 180, c = Math.cos(pitch * Math.PI / 180), up = -Math.sin(pitch * Math.PI / 180);
      for (let i = 2; i <= 12; i++) { const t = dist * i / 12, x = p.x - Math.sin(r) * c * t, y = p.y - Math.cos(r) * c * t; if (s.hAt(x, y) > h0 + up * t - 1.2) return false; } return true; };
    const yaw = [28, -28, 62, -62, 100, -100, 140, -140, 180].map((d) => back + d).find(open) ?? back + 28;
    Object.assign(s.free, { tx: p.x, ty: p.y, yaw, pitch, dist, hOff: 0.4 }); }`,
  wide: `s.enterFreeCam(true); { const p = s.pinSim, b = s.ballSim; const dx = p.x - b.x, dy = p.y - b.y, len = Math.hypot(dx, dy); const yaw = Math.atan2(dx, dy) * 180 / Math.PI;
    Object.assign(s.free, { tx: b.x + dx * 0.55, ty: b.y + dy * 0.55, yaw: yaw - 38, pitch: -15, dist: Math.max(150, len * 1.05), hOff: 6 }); }`,
  // the far world: from above the tee, looking level down the hole (and --yaw <deg> round from it)
  sky: `s.enterFreeCam(true); { const p = s.pinSim, b = s.ballSim; const yaw = Math.atan2(p.x - b.x, p.y - b.y) * 180 / Math.PI;
    Object.assign(s.free, { tx: b.x, ty: b.y, yaw: yaw + (window.__yaw || 0), pitch: -1.5, dist: 30, hOff: 22 }); }`,
  pin: `s.enterFreeCam(true); { const p = s.pinSim, b = s.ballSim; const dx = p.x - b.x, dy = p.y - b.y; const yaw = Math.atan2(dx, dy) * 180 / Math.PI;
    Object.assign(s.free, { tx: p.x, ty: p.y, yaw: yaw + 12, pitch: -7, dist: 9, hOff: 0.2 }); }`,
};
const setView = async (view) => {
  await evaluate(`(() => { const s = window.__birdie.scene; ${VIEW_JS[view] || VIEW_JS.tee} })()`);
  await sleep(2600);
};
const written = [];
const snap = async (name) => {
  const { data } = await page('Page.captureScreenshot', { format: 'png' });
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  written.push(file);
  return file;
};

// ms a frame: `frames` frames drawn back to back, flushed by a one-pixel read (so vsync does
// not round the number), median of `rounds`; and the draw calls and triangles of one frame.
const PERF_JS = (frames, rounds) => `(async () => {
  const s = window.__birdie.scene, r = s.renderer, gl = r.getContext();
  s._resScale = 1; s._resScaleSet = true; s._resPending = null; s._autoQuality = false; s.resize();
  r.setAnimationLoop(null);
  const px = new Uint8Array(4);
  const flush = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  for (let i = 0; i < 20; i++) s._frame(); flush();
  const out = [];
  for (let k = 0; k < ${rounds}; k++) {
    const t0 = performance.now();
    for (let i = 0; i < ${frames}; i++) s._frame();
    flush();
    out.push((performance.now() - t0) / ${frames});
    await new Promise((res) => setTimeout(res, 30));
  }
  r.info.autoReset = false; r.info.reset(); s._frame(); const calls = r.info.render.calls, tris = r.info.render.triangles; r.info.autoReset = true;
  out.sort((a, b) => a - b);
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const size = r.getDrawingBufferSize(new (Object.getPrototypeOf(s.camera.position).constructor)());
  r.setAnimationLoop(s._liveFrame);
  return { ms: +out[out.length >> 1].toFixed(2), best: +out[0].toFixed(2), worst: +out[out.length - 1].toFixed(2), calls, tris, w: size.x, h: size.y, level: s.quality.level, gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '' };
})()`;

try {
  const state = await api('/api/match');
  const tour = state && state.tour;
  if (!tour) throw new Error(`No tour at ${base}: build the stages into the server's data dir first.`);
  const all = [...tour.stages, ...tour.tiebreaks];
  const want = (flag('--stages') || all.map((s) => s.id).join(',')).split(',').filter(Boolean);
  const perf = [];
  for (const id of want) {
    const s = all.find((x) => x.id === id);
    if (!s) { console.error(`no stage ${id}`); continue; }
    consoleErrors.length = 0;
    await go(s.file);
    if (preEval) await evaluate(`(() => { const s = window.__birdie.scene; ${preEval} })()`);
    if (has('--perf')) {
      await setSize(PW, PH);
      await sleep(1500);
      for (const view of views) {
        await setView(view);
        const r = await evaluate(PERF_JS(40, 5));
        perf.push({ stage: id, view, ...r });
        console.log(`${id.padEnd(18)} ${view.padEnd(6)} ${String(r.ms).padStart(6)} ms  (best ${r.best}, worst ${r.worst})  ${r.calls} draws  ${(r.tris / 1e6).toFixed(2)} M tris  ${r.w}x${r.h} ${r.level}`);
      }
      await setSize(W, H);
    } else if (has('--putt')) {
      // the putting game puts a ball on this stage's green (lib/practice.js); the easy
      // putting assist steers a decent putt in (docs/arcade-feel.md, "Pin cam")
      await api('/api/practice', { mode: 'putting' });
      await sleep(2500);
      const n = Number(flag('--putt')) > 0 ? Number(flag('--putt')) : 2;
      for (let k = 0; k < n; k++) {
        const st = await api('/api/state');
        const ft = Math.max(2, Math.hypot(st.pin[0] - st.ball.x, st.pin[1] - st.ball.y) / 0.3048);
        const speed = +(1.45 * Math.sqrt(ft) + 0.6).toFixed(2);
        await api('/api/test-shot', { speed, vla: 0, hla: 0, spin: 0, spinAxis: 0 });
        console.log(`putt ${k + 1}: ${ft.toFixed(1)} ft at ${speed} mph`);
        for (let i = 0; i < 6; i++) {
          await sleep(i === 0 ? 700 : 600);
          const lens = await evaluate(`(() => { const s = window.__birdie.scene, L = s._lens, e = s.postfx && s.postfx._envState; return { dof: L ? +L.dof.toFixed(2) : null, focusM: L ? +L.focus.toFixed(1) : null, pass: e ? { dof: e.dof, blur: e.blur } : null, pinCam: !!(s.anim && s.anim.plan && s.anim.plan.pinCam), cam: s.camMode, hold: !!s._flightHold, toPin: +s.camera.position.distanceTo(s.pin.position).toFixed(1) }; })()`);
          const f = await snap(`${id}-putt${k + 1}-${i}-${tag}`);
          console.log(path.relative(process.cwd(), f), JSON.stringify(lens));
        }
        await sleep(2500);
        const after = await api('/api/state');
        console.log(`  -> ${after.practice ? JSON.stringify(after.practice.score) : 'no practice state'}`);
      }
      await api('/api/practice', { action: 'end' });
    } else if (has('--water')) {
      // a ball into the water: a few shots are tried until one finds it (the shot's own list
      // of what the ball hits says whether, where and when)
      await setView('tee');
      const tries = (flag('--water-shots') || '110,24,0;150,16,25;150,16,-25;90,30,40;90,30,-40;130,12,0').split(';').map((t) => t.split(',').map(Number));
      for (const [speed, vla, hla] of tries) {
        await api('/api/reset');
        await sleep(1500);
        await api('/api/test-shot', { speed, vla, hla, spin: 3000, spinAxis: 0 });
        await sleep(600);
        const wet = await evaluate(`(() => { const s = window.__birdie.scene, a = s.anim; const im = a && a.impacts && a.impacts.find((m) => m.kind === 'water'); return im ? { x: +im.x.toFixed(1), y: +im.y.toFixed(1), inS: +((im.t - a.t) / (a.speed || 1)).toFixed(2) } : null; })()`).catch(() => null);
        if (!wet) { console.log(`  ${speed} mph, ${vla} up, ${hla} off: dry`); await sleep(6000); continue; }
        // look at where it goes in, from a little way off, while the rings spread
        await sleep(Math.max(0, wet.inS * 1000 - 400));
        await evaluate(`(() => { const s = window.__birdie.scene; s.enterFreeCam(true); Object.assign(s.free, { tx: ${wet.x}, ty: ${wet.y}, pitch: -24, dist: 13, hOff: 0.2 }); })()`);
        for (let i = 0; i < 4; i++) {
          await sleep(i === 0 ? 1000 : 700);
          const rings = await evaluate(`(() => { const s = window.__birdie.scene; let u = null; s.scene.traverse((m) => { if (!u && m.material && m.material.uniforms && m.material.uniforms.uRing) u = m.material.uniforms; }); return u ? { t: +u.uTime.value.toFixed(2), rings: u.uRing.value.filter((r) => r.w > 0).map((r) => [+r.x.toFixed(1), +r.y.toFixed(1), +(u.uTime.value - r.z).toFixed(2), r.w]), defines: null } : null; })()`).catch(() => null);
          const f = await snap(`${id}-splash${i}-${tag}`);
          console.log(path.relative(process.cwd(), f), JSON.stringify(wet), JSON.stringify(rings));
        }
        break;
      }
    } else if (has('--shot')) {
      await setView('tee');
      await api('/api/test-shot', { speed: 155, vla: 13, hla: 0, spin: 2600, spinAxis: 0 });
      for (let i = 0; i < 6; i++) {
        await sleep(i === 0 ? 900 : 650);
        const lens = await evaluate(`(() => { const s = window.__birdie.scene, L = s._lens; return L ? { dof: +L.dof.toFixed(2), blur: +L.blur.toFixed(2) } : null; })()`);
        const f = await snap(`${id}-flight${i}-${tag}`);
        console.log(path.relative(process.cwd(), f), JSON.stringify(lens));
      }
    } else {
      for (const view of views) {
        await setView(view);
        if (flag('--fixed-time') != null) {
          await evaluate(`(() => { const s = window.__birdie.scene; return s.renderVisualCaptureStill(Object.assign({ width: ${W}, height: ${H}, time: ${Number(flag('--fixed-time')) || 0} }, s.camMode === 'free' ? { mode: 'free', pose: { ...s.free } } : {})) && true; })()`);
          await sleep(300);
        }
        const f = await snap(`${id}-${view}-${tag}`);
        console.log(path.relative(process.cwd(), f));
        if (probe) console.log('  probe:', JSON.stringify(await evaluate(`(() => { const s = window.__birdie.scene; return (${probe}); })()`)));
      }
    }
    const errs = [...new Set(consoleErrors)].filter((e) => !/favicon|ERR_|Failed to load resource/.test(e));
    if (errs.length) console.error(`  [${id}] page said:\n    ${errs.slice(0, 8).join('\n    ')}`);
  }
  if (perf.length) {
    const file = path.join(outDir, `perf-${tag}-${PW}x${PH}.json`);
    fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), gfx, size: [PW, PH], gpu: perf[0].gpu, rows: perf }, null, 2));
    console.log(`GPU: ${perf[0].gpu}\n${path.relative(process.cwd(), file)}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  try { await send('Target.closeTarget', { targetId }); } catch (_) { /* closed */ }
  try { ws.close(); } catch (_) { /* closed */ }
  cleanup();
}
