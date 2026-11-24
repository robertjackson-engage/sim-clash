#!/usr/bin/env node
// Stills of the course gadgets (v3:gadgets) from a PRIVATE game server: no window, no sound.
//
//   node tools/arcade-dev/gadgets-shots.mjs --url http://localhost:8356 --out .scratch/gadgets/shots
//        [--stages lab-a,lab-b] [--size 1280x720] [--gfx high] [--only tee,close,react]
//        [--react "lab-a:150,12,0;lab-b:60,20,-8"]   swings to film, by stage: speed,vla,hla[,spin]
//        [--sheet]   (assemble what was written into <out>/sheet.png)
//
// For each stage: the address view from the tee (do the gadgets read at range?), a wide view,
// a close-up of every gadget idle, and, for each --react swing, frames at the moments the
// shot's own event list says a gadget is met (ring flash, pad squash, wall shatter, warp ...).
// Drives an installed Chrome or Edge headless over the DevTools protocol, as
// tools/arcade-art/env/capture.mjs does: a throwaway profile, muted, every page ?sound=0.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, d = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const has = (name) => args.includes(name);
const base = (flag('--url') || 'http://localhost:8356').replace(/\/$/, '');
const outDir = path.resolve(flag('--out') || path.join('.scratch', 'gadgets', 'shots'));
const [W, H] = (flag('--size') || '1280x720').split('x').map(Number);
const gfx = flag('--gfx') || 'high';
const only = (flag('--only') || 'tee,wide,close,react').split(',');
const reactArg = flag('--react') || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(outDir, { recursive: true });

// ---- the contact sheet: every still, scaled into a grid (nearest neighbour is enough to judge by)
function sheet(files, { cols = 4, tw = 480, th = 270, file = path.join(outDir, 'sheet.png') } = {}) {
  const { PNG } = createRequire(import.meta.url)('pngjs');
  const rows = Math.ceil(files.length / cols);
  const out = new PNG({ width: cols * tw, height: rows * th });
  out.data.fill(24);
  for (let k = 3; k < out.data.length; k += 4) out.data[k] = 255;
  files.forEach((f, i) => {
    let src;
    try { src = PNG.sync.read(fs.readFileSync(f)); } catch (_) { return; }
    const ox = (i % cols) * tw, oy = Math.floor(i / cols) * th;
    for (let y = 0; y < th - 4; y++) for (let x = 0; x < tw - 4; x++) {
      // a 2 x 2 box filter: text on a wall stays legible at a third of its size
      const fx = (x / (tw - 4)) * src.width, fy = (y / (th - 4)) * src.height;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const sx = Math.min(src.width - 1, Math.floor(fx + dx * src.width / (tw - 4) / 2)), sy = Math.min(src.height - 1, Math.floor(fy + dy * src.height / (th - 4) / 2));
        const k = (sy * src.width + sx) * 4;
        r += src.data[k]; g += src.data[k + 1]; b += src.data[k + 2]; n++;
      }
      const d = ((oy + y + 2) * out.width + ox + x + 2) * 4;
      out.data[d] = r / n; out.data[d + 1] = g / n; out.data[d + 2] = b / n;
    }
  });
  fs.writeFileSync(file, PNG.sync.write(out));
  return file;
}
if (has('--sheet-only')) {
  const list = (flag('--files') ? flag('--files').split(',') : fs.readdirSync(outDir).filter((f) => f.endsWith('.png') && !f.startsWith('sheet')).sort()).map((f) => path.resolve(outDir, f));
  console.log(sheet(list, { cols: Number(flag('--cols')) || 4, file: path.resolve(outDir, flag('--name') || 'sheet.png') }), `(${list.length} tiles)`);
  list.forEach((f, i) => console.log(`  ${i + 1}. ${path.basename(f)}`));
  process.exit(0);
}

const chrome = flag('--chrome') || [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => fs.existsSync(p));
if (!chrome) { console.error('No Chrome or Edge found: pass --chrome <path>.'); process.exit(1); }

const api = async (route, body) => {
  const res = await fetch(base + route, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json().catch(() => null);
};

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gadget-shots-'));
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
  else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) consoleErrors.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 500)}`);
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
  if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  return r.result ? r.result.value : undefined;
};
const S = (js) => evaluate(`(() => { const s = window.__birdie.scene; ${js} })()`);
const written = [];
const snap = async (name) => {
  const { data } = await page('Page.captureScreenshot', { format: 'png' });
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  written.push(file);
  console.log(path.relative(process.cwd(), file));
  return file;
};
const hud = async (on) => evaluate(`(() => { let st = document.getElementById('gadget-shots-hide'); if (!st) { st = document.createElement('style'); st.id = 'gadget-shots-hide'; document.head.appendChild(st); } st.textContent = ${on ? "''" : "'body > *:not(#scene), #scene > *:not(canvas) { visibility: hidden !important; }'"}; })()`);

const go = async (file, query = '') => {
  await api('/api/load-course', { cached: file });
  await page('Page.navigate', { url: `${base}/?menu=0&sound=0&gfx=${gfx}${query ? `&${query}` : ''}` });
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const ok = await evaluate(`(() => { const s = window.__birdie && window.__birdie.scene; return !!(s && s.geo && s.environmentStatus && s.environmentStatus.state !== 'loading' && s._activeHole); })()`).catch(() => false);
    if (ok) break;
  }
  await sleep(4500);
  await hud(false);
  await S(`s._resScale = 1; s._resScaleSet = true; s._resPending = null; s._autoQuality = false; s.resize();`);
};
// the free camera on a point: yaw (compass, the way it looks), pitch, distance
const look = (x, y, yaw, pitch, dist, hOff = 1) => S(`s.enterFreeCam(true); Object.assign(s.free, { tx: ${x}, ty: ${y}, yaw: ${yaw}, pitch: ${pitch}, dist: ${dist}, hOff: ${hOff} });`);

try {
  const state = await api('/api/match');
  const tour = state && state.tour;
  if (!tour) throw new Error(`No tour at ${base}: build the stages into the server's data dir first.`);
  const all = [...tour.stages, ...tour.tiebreaks];
  const want = (flag('--stages') || all.map((s) => s.id).join(',')).split(',').filter(Boolean);
  const reacts = Object.fromEntries(reactArg.split(';').filter(Boolean).map((r) => { const [id, v] = r.split(':'); return [id, v]; }));
  const reactList = reactArg.split(';').filter(Boolean).map((r) => { const [id, v] = r.split(':'); return { id, v: v.split(',').map(Number) }; });
  void reacts;
  if (reactList.length) await api('/api/arcade/settings', { assist: { dispersion: 1 } });   // a start line is the line asked for
  for (const id of want) {
    const st = all.find((x) => x.id === id);
    if (!st) { console.error(`no stage ${id}`); continue; }
    consoleErrors.length = 0;
    await go(st.file, flag('--query') || '');
    const info = await S(`return { n: s.gadgets.count, tee: s.geo.holes[0].tee, pin: s.geo.holes[0].pin, list: (s.geo.gadgets || []).map((g) => { const m = g.kind === 'coins' ? g.points[g.points.length >> 1] : null; return ({ id: g.id, kind: g.kind, x: m ? m[0] : g.x, y: m ? m[1] : g.y, z: m ? m[2] : (g.z ?? null), r: g.radius || (g.size ? Math.max(g.size[0], g.size[1] || 0) / 2 : 6), h: g.kind === 'ring' ? 0 : (g.height || (g.size && (g.size[2] || g.size[1])) || 3) }); }) };`);
    console.log(`${id}: ${info.n} gadgets drawn of ${info.list.length}`);
    // what the gadgets cost: draw calls and triangles of one frame with and without them, and
    // the frame time of the layer's own update
    if (only.includes('perf')) {
      const r = await S(`const R = s.renderer; const one = () => { R.info.autoReset = false; R.info.reset(); s._frame(); const o = { calls: R.info.render.calls, tris: R.info.render.triangles }; R.info.autoReset = true; return o; };
        s.enterFreeCam(false); const on = one(); s.gadgets.group.visible = false; const off = one(); s.gadgets.group.visible = true;
        const t0 = performance.now(); for (let i = 0; i < 2000; i++) s.gadgets.update(i / 60, s.camera); const ms = (performance.now() - t0) / 2000;
        return { on, off, updateMs: +ms.toFixed(4), level: s.quality.level };`);
      console.log(`  perf (${r.level}): ${r.on.calls - r.off.calls} draw calls and ${r.on.tris - r.off.tris} triangles for the gadgets (${r.on.calls} / ${r.on.tris} in all); update ${r.updateMs} ms a frame`);
    }
    // the stage intro of a match on this stage, with its GADGETS row, then the match is let go
    if (only.includes('intro')) {
      let roster = ((await api('/api/leagues')) || {}).players || [];
      for (const name of ['Alex', 'Sam']) if (roster.length < 2) { await api('/api/players', { name }); roster = ((await api('/api/leagues')) || {}).players || []; }
      await hud(true);
      const started = await api('/api/match/start', { playerIds: roster.slice(0, 2).map((p) => p.id), format: 'quick', stage: id });
      if (!started || !started.ok) console.error(`  no match: ${JSON.stringify(started).slice(0, 160)}`);
      let seen = false;
      for (let i = 0; i < 160 && !seen; i++) { await sleep(250); seen = await evaluate(`!!document.querySelector('.mt-s-stage .mt-gadget')`).catch(() => false); }
      if (seen) { await sleep(1900); await snap(`${id}-intro`); } else console.error('  the stage intro with its gadget row did not come up');
      await api('/api/match/abort', {});
      await sleep(1500);
      await go(st.file, flag('--query') || '');
    }
    if (only.includes('tee')) { await S(`s.enterFreeCam(false);`); await sleep(2600); await snap(`${id}-tee`); if (has('--hud')) { await hud(true); await sleep(400); await snap(`${id}-tee-hud`); await hud(false); } }
    if (only.includes('wide')) {
      const dx = info.pin[0] - info.tee[0], dy = info.pin[1] - info.tee[1], len = Math.hypot(dx, dy), yaw = Math.atan2(dx, dy) * 180 / Math.PI;
      await look(info.tee[0] + dx * 0.5, info.tee[1] + dy * 0.5, yaw - 32, -20, Math.max(150, len * 0.95), 6);
      await sleep(2600); await snap(`${id}-wide`);
    }
    if (only.includes('close')) {
      for (const g of info.list) {
        if (g.kind === 'warp-exit' && info.list.some((m) => m.kind === 'warp' && Math.hypot(m.x - g.x, m.y - g.y) < 10)) continue;
        const yaw = Math.atan2(g.x - info.tee[0], g.y - info.tee[1]) * 180 / Math.PI;   // from the tee's side
        const z = g.z != null ? `${g.z} - s.hAt(${g.x}, ${g.y})` : `${Math.min(g.h, 16) * 0.4}`;
        const dist = g.kind === 'coins' ? 46 : Math.max(16, Math.min(60, g.r * 3.4 + g.h * 1.1));
        await S(`s.enterFreeCam(true); Object.assign(s.free, { tx: ${g.x}, ty: ${g.y}, yaw: ${yaw + 24}, pitch: ${g.z != null ? -4 : -16}, dist: ${dist}, hOff: ${z} });`);
        await sleep(1800);
        await snap(`${id}-close-${g.kind}-${g.id}`);
      }
    }
    if (only.includes('react')) {
      for (const [k, r] of reactList.filter((q) => q.id === id).entries()) {
        const [speed, vla, hla, spin = 2600, aim = 0] = r.v;
        await api('/api/reset', {});
        await sleep(1200);
        await S(`s.enterFreeCam(false);`);
        await sleep(1500);
        // the swing's line: `aim` degrees off the flag, whatever the page's own aim assist has set
        // meanwhile (the dispersion assist is off for these, so the start line is the line asked for)
        await sleep(3500);   // (the lineup's own prediction, and the aim it may set, have landed)
        await api('/api/aim', { offset: 0 });
        const now = await api('/api/state');
        if (has('--debug')) console.log('   state', JSON.stringify({ ball: now.ball, aimOffset: now.aimOffset, strokes: now.strokes, holed: now.holed, over: now.over }));
        await api('/api/test-shot', { speed, vla, hla: hla + aim - (Number(now && now.aimOffset) || 0), spin, spinAxis: 0 });
        await sleep(250);
        // the shot as the page plays it: its gadget contacts, in playback time
        const tl = await S(`const a = s.anim; return a ? { t: a.t, tl: s.gadgets._tl.map((r) => ({ t: r.t, id: r.id, kind: r.kind, effect: r.effect, x: r.x, y: r.y, z: r.z })) } : null;`);
        console.log(`  swing ${speed} mph, ${vla} up, ${hla} off: ${tl ? tl.tl.filter((e) => e.effect !== 'coin').map((e) => `${e.id}:${e.effect}@${e.t.toFixed(2)}`).join(' ') || 'no gadget met' : 'no shot'}`);
        if (!tl) continue;
        // a geyser fires on the shot's own clock whether the ball is over it or not: film each
        // one building pressure, then at the height of its first eruption
        if (has('--geysers')) {
          const gs = await S(`return s.gadgets.describe().filter((r) => r.kind === 'geyser' && r.windows.length).map((r) => ({ id: r.id, w: r.windows[0] }));`);
          for (const gy of gs) {
            const g = info.list.find((q) => q.id === gy.id);
            const yaw = Math.atan2(g.x - info.tee[0], g.y - info.tee[1]) * 180 / Math.PI;
            await S(`const h = s.hAt(${g.x}, ${g.y}) + 9; Object.assign(s.free, { tx: ${g.x}, ty: ${g.y}, yaw: ${yaw + 25}, pitch: -8, dist: 52, h, hOff: 9 }); s.camMode = 'free'; s._freeTargets(); s.camera.position.copy(s.camPosT); s.lookCur.copy(s.lookT); s._flightZoom = 1; s._flightRoll = 0;`);
            for (const [name, at] of [['pressure', gy.w.t0 - 0.35], ['erupt', gy.w.t0 + 0.4 * (gy.w.t1 - gy.w.t0)]]) {
              for (let i = 0; i < 400; i++) { const t = await S(`return s.anim ? s.anim.t : 1e9;`); if (t >= at) break; await sleep(20); }
              await snap(`${id}-geyser${k + 1}-${gy.id}-${name}`);
            }
          }
        }
        const seen = new Set();
        for (const e of tl.tl) {
          const key = `${e.id}:${e.effect === 'coin' ? 'coin' : e.effect}`;
          if (seen.has(key)) continue;
          seen.add(key);
          // wait for the picture's clock to reach the contact, then film it from the side for a few frames
          for (let i = 0; i < 400; i++) { const t = await S(`return s.anim ? s.anim.t : 1e9;`); if (t >= e.t - 0.25) break; await sleep(25); }
          const yaw = Math.atan2(e.x - info.tee[0], e.y - info.tee[1]) * 180 / Math.PI;
          const g = info.list.find((q) => q.id === e.id) || { r: 6, h: 6 };
          const dist = Math.max(18, Math.min(64, (g.r || 6) * 3.2 + (g.h || 3) * 1.2));
          // (the free camera is refused while a shot plays: take it, and put it there at once)
          await S(`const h = ${e.z} + 1; Object.assign(s.free, { tx: ${e.x}, ty: ${e.y}, yaw: ${yaw + 30}, pitch: -9, dist: ${dist}, h, hOff: h - s.hAt(${e.x}, ${e.y}) }); s.camMode = 'free'; s._freeTargets(); s.camera.position.copy(s.camPosT); s.lookCur.copy(s.lookT); s._flightZoom = 1; s._flightRoll = 0;`);
          for (const [j, ms] of [[0, 330], [1, 260]]) { await sleep(ms); await snap(`${id}-react${k + 1}-${e.kind}-${e.effect}-${j}`); }
        }
        for (let i = 0; i < 80; i++) { if (!(await S(`return !!s.anim;`))) break; await sleep(250); }
        await S(`if (s.camMode === 'free') { s.camMode = 'idle'; }`);
      }
    }
    const errs = [...new Set(consoleErrors)].filter((e) => !/favicon|ERR_|Failed to load resource/.test(e));
    if (errs.length) console.error(`  [${id}] page said:\n    ${errs.slice(0, 10).join('\n    ')}`);
  }
  if (has('--sheet') && written.length) console.log(sheet(written));
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  try { await send('Target.closeTarget', { targetId }); } catch (_) { /* closed */ }
  try { ws.close(); } catch (_) { /* closed */ }
  cleanup();
}
