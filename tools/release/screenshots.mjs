#!/usr/bin/env node
// Capture the README / site screenshots from a running game server, without a window:
//
//   node tools/release/screenshots.mjs --url http://localhost:8334 [--out .scratch/release/shots]
//        [--only title,lobby,stages,flight,match] [--chrome "C:\Path\chrome.exe"]
//
// Drives an installed Chrome or Edge in HEADLESS mode over the DevTools protocol (no
// dependency: Node's own WebSocket), with its own throwaway profile, muted, 1600 x 900.
// Every page is opened with ?sound=0. The server must be a PRIVATE instance on its own
// ports and data dir (this script creates two players and plays a match on it):
//
//   BIRDIE_PORT=8334 BIRDIE_OC_PORT=9964 BIRDIE_DATA_DIR=<scratch>/data BIRDIE_ENRICH=0 \
//   BIRDIE_SKY_PREFETCH=0 node server.js --bundled-arcade
//
// It writes JPEG frames (bursts round the moments that pass quickly: the VS screen, the
// stage intro, a ball in flight, a callout, the winner) and a contact sheet per burst when
// sharp is installed. Pick the frames you want and copy them to docs/media/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const flag = (name, d = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const base = (flag('--url') || 'http://localhost:8334').replace(/\/$/, '');
const outDir = path.resolve(flag('--out') || path.join('.scratch', 'release', 'shots'));
const only = (flag('--only') || 'title,lobby,stages,flight,match').split(',');
const W = 1600, H = 900;
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-profile-'));
const proc = spawn(chrome, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--mute-audio', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--hide-scrollbars', `--window-size=${W},${H}`, '--force-device-scale-factor=1', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', 'about:blank',
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
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); if (m.error) reject(new Error(m.error.message)); else resolve(m.result); }
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId })); });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const page = (method, params) => send(method, params, sessionId);
await page('Page.enable');
await page('Runtime.enable');
await page('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

const withSound0 = (p) => `${base}${p}${p.includes('?') ? '&' : '?'}sound=0`;
const go = async (p, waitMs = 7000) => { await page('Page.navigate', { url: withSound0(p) }); await sleep(waitMs); };
const evaluate = async (expression) => { const r = await page('Runtime.evaluate', { expression, returnByValue: true }); return r.result ? r.result.value : undefined; };
const written = [];
const snap = async (name) => {
  const { data } = await page('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
  const file = path.join(outDir, `${name}.jpg`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  written.push(file);
  return file;
};
// a burst: `count` frames `everyMs` apart, each named after what the match UI shows
const burst = async (name, count, everyMs) => {
  const files = [];
  for (let i = 0; i < count; i++) {
    const kind = await evaluate(`(() => { const s = document.querySelector('.mt-screen'); const k = s && !s.classList.contains('hidden') ? [...s.classList].filter((c) => c.startsWith('mt-k-') || c.startsWith('mt-screen-')).join('') : ''; return k; })()`).catch(() => '');
    files.push(await snap(`${name}-${String(i).padStart(2, '0')}${kind ? `-${kind}` : ''}`));
    await sleep(everyMs);
  }
  await sheet(name, files);
};
async function sheet(name, files) {
  let sharp;
  try { sharp = createRequire(import.meta.url)('sharp'); } catch (_) { return; }
  const cols = 4, tw = 400, th = 225;
  const rows = Math.ceil(files.length / cols);
  const tiles = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(tw, th).toBuffer(), left: (i % cols) * tw, top: Math.floor(i / cols) * th })));
  await sharp({ create: { width: cols * tw, height: rows * th, channels: 3, background: '#000' } }).composite(tiles).jpeg({ quality: 80 }).toFile(path.join(outDir, `_sheet-${name}.jpg`));
}

try {
  const state = await api('/api/match');
  const tour = state && state.tour;
  if (!tour) throw new Error(`No tour at ${base}: start the server with --bundled-arcade (or build the stages into its data dir).`);
  const stages = [...tour.stages, ...tour.tiebreaks];
  const gfx = flag('--gfx') || 'high';

  if (state.match) await api('/api/match/abort', {});
  // two players (reused when they are already on the roster)
  const roster = async () => ((await api('/api/leagues')) || {}).players || [];
  for (const name of ['Alex', 'Sam']) if (!(await roster()).some((p) => p.name === name)) await api('/api/players', { name });
  const players = (await roster()).filter((p) => p.name === 'Alex' || p.name === 'Sam');

  // The game shell (docs/sim-clash-shell.md): a plain address opens on the title, and swings
  // are dropped while a menu is up. ?menu=0 goes straight onto the stage (for stage and
  // flight shots); a page that loads during a match joins it.
  if (only.includes('title')) {
    await api('/api/load-course', { cached: (stages.find((x) => x.id === (flag('--title-stage') || 'canyon-run')) || tour.stages[0]).file });
    await go(`/?gfx=${gfx}`, 14000);
    await snap('title');
    await go(`/?menu=main&gfx=${gfx}`, 12000);
    await snap('menu');
  }

  if (only.includes('lobby')) {
    await api('/api/load-course', { cached: tour.stages[0].file });
    await go(`/?match=1&gfx=${gfx}`, 10000);
    await snap('lobby');
  }

  if (only.includes('stages')) {
    for (const s of stages) {
      await api('/api/load-course', { cached: s.file });
      await go(`/?menu=0&gfx=${gfx}`, 10000);
      await snap(`stage-${s.id}`);
    }
  }

  if (only.includes('flight')) {
    // solo shots on two stages: the ball cam in flight, then the callout
    const plan = [
      { id: 'volcano-drop', shot: { speed: 118, vla: 22, hla: 0, spin: 6200, spinAxis: 0 } },
      { id: 'canyon-run', shot: { speed: 158, vla: 13, hla: -1, spin: 2500, spinAxis: -2 } },
      { id: 'lagoon-island', shot: { speed: 104, vla: 24, hla: 0.5, spin: 7000, spinAxis: 0 } },
    ];
    for (const p of plan) {
      const s = stages.find((x) => x.id === p.id);
      if (!s) continue;
      await api('/api/load-course', { cached: s.file });
      await go(`/?menu=0&gfx=${gfx}`, 10000);
      await api('/api/test-shot', p.shot);
      await burst(`flight-${p.id}`, 16, 700);
    }
  }

  if (only.includes('match') && players.length === 2) {
    const stage = stages.find((x) => x.id === (flag('--match-stage') || 'sakura-garden')) || tour.stages[0];
    await go(`/?menu=0&gfx=${gfx}`, 8000);
    const started = await api('/api/match/start', { playerIds: players.map((p) => p.id), format: 'quick', stage: stage.id });
    if (!started || started.ok === false) throw new Error(`match did not start: ${started && started.error}`);
    await burst('match-intro', 24, 600);            // coin flip, VS, stage intro
    await api('/api/match/ready', {});
    await sleep(5000);
    await snap('match-tee');
    await api('/api/test-shot', { speed: 98, vla: 25, hla: 0, spin: 7200, spinAxis: 0 });
    await burst('match-shot', 16, 700);             // header, ticker, callout, the turn passing
    await sleep(3000);
    await api('/api/test-shot', { speed: 60, vla: 12, hla: 14, spin: 3000, spinAxis: 20 });
    await burst('match-shot2', 12, 800);
    const m = (await api('/api/match')).match;
    if (m && m.phase !== 'done') await api('/api/match/concede', { playerId: m.currentPlayerId || players[1].id });
    await burst('match-winner', 16, 700);           // result, winner, confetti
    await api('/api/match/abort', {});
  }
  console.log(`${written.length} frames in ${outDir}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  try { await send('Target.closeTarget', { targetId }); } catch (_) { /* closed */ }
  try { ws.close(); } catch (_) { /* closed */ }
  cleanup();
}
