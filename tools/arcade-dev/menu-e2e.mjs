#!/usr/bin/env node
// The match menu, for real: a private server on the built Clash Tour, two players, and the
// routes behind the pause panel driven over HTTP as the UI drives them: a 30 mph stray ball
// off the tee is marked and taken back (POST /api/match/undo), a hole is restarted
// (/restart-hole), a second start is refused with a message, the match is restarted from the
// top while it is in play (/restart), a swing that decided a hole is taken back from the
// result screen, and the match is quit (/abort).
//
//   node tools/arcade-holes/build.mjs --out .scratch/wind/data     (once: the courses)
//   node tools/arcade-dev/menu-e2e.mjs [--port 8327] [--oc 9957] [--data .scratch/wind/data] [--no-spawn]
//
// Its own server (private ports and data dir, no downloads, no sound), stopped afterwards.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const PORT = +flag('--port', 8327);
const OC_PORT = +flag('--oc', 9957);
const DATA = path.resolve(repo, flag('--data', path.join('.scratch', 'wind', 'data')));
const SPAWN = !args.includes('--no-spawn');
const BASE = `http://127.0.0.1:${PORT}`;

const t0 = Date.now();
const say = (text) => console.log(`${String(((Date.now() - t0) / 1000).toFixed(2)).padStart(7)}s  ${text}`);
const failures = [];
let checks = 0;
function check(ok, what, detail = '') {
  checks++;
  if (ok) return true;
  failures.push(what);
  say(`  FAIL ${what}${detail ? `: ${detail}` : ''}`);
  return false;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

let child = null;
const serverLog = [];
async function startServer() {
  if (!fs.existsSync(path.join(DATA, 'courses'))) throw new Error(`No courses in ${DATA}: build them first`);
  child = spawn(process.execPath, ['server.js'], {
    cwd: repo,
    env: { ...process.env, BIRDIE_PORT: String(PORT), BIRDIE_OC_PORT: String(OC_PORT), BIRDIE_DATA_DIR: DATA, BIRDIE_ENRICH: '0', BIRDIE_SKY_PREFETCH: '0', BIRDIE_MATCH_READY_MS: '0', BIRDIE_MATCH_CONTINUE_MS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const keep = (buf) => { for (const line of String(buf).split(/\r?\n/)) if (line.trim()) serverLog.push(line); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  for (let i = 0; i < 200; i++) {
    if (serverLog.some((l) => l.includes('[HTTP] Open-Birdie UI'))) return;
    if (child.exitCode !== null) throw new Error(`the server did not start:\n${serverLog.join('\n')}`);
    await sleep(100);
  }
  throw new Error('the server did not come up within 20 s');
}
async function stopServer() {
  if (!child || child.exitCode !== null) return;
  const gone = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([gone, sleep(3000)]);
}

const get = async (p) => (await fetch(BASE + p)).json();
const post = async (p, body = {}) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };
const shots = [];
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
          if ((/^event: (.*)$/m.exec(chunk) || [])[1] === 'shot') shots.push(JSON.parse((/^data: (.*)$/m.exec(chunk) || [])[1]));
        }
      }
    } catch (_) { /* closed */ }
  })();
}
async function matchAt(...phases) {
  for (let i = 0; i < 1500; i++) {
    const { match } = await get('/api/match');
    if (match && phases.includes(match.phase)) return match;
    await sleep(20);
  }
  throw new Error(`the match never reached ${phases.join(' / ')}`);
}
async function swing(launch) {
  const n = shots.length;
  await post('/api/test-shot', launch);
  for (let i = 0; i < 150 && shots.length === n; i++) await sleep(10);
  return shots.length > n ? shots[shots.length - 1] : null;
}
const I7 = { speed: 111, vla: 19, hla: 0, spin: 7000, spinAxis: 0 };
const DRIVER = { speed: 150, vla: 13, hla: 0, spin: 2650, spinAxis: 0 };
const DINK = { speed: 8, vla: 10, hla: 0, spin: 1000, spinAxis: 0 };
const MISHIT = { speed: 30, vla: 12, hla: 0, spin: 2000, spinAxis: 0 };
const who = (m, id) => m.players.find((p) => p.id === id);

async function main() {
  if (SPAWN) await startServer();
  await openEvents();
  const roster = (await get('/api/leagues')).players || [];
  const player = async (name) => roster.find((p) => p.name === name) || (await post('/api/players', { name })).player;
  const a = await player('Menu One'), b = await player('Menu Two');
  const name = (id) => (id === a.id ? 'P1' : 'P2');
  await post('/api/match/abort');

  // ----- hole 1 on Canyon Run (a par 4): the stray ball off the tee
  let r = await post('/api/match/start', { playerIds: [a.id, b.id], format: 'bo3', stage: 'canyon-run' });
  if (!check(r.ok, 'POST /api/match/start', r.error)) return;
  const firstId = r.match.id;
  let m = await matchAt('intro');
  const wind = m.stage.wind;
  m = (await post('/api/match/ready')).match;
  const up = m.currentPlayerId;
  const tee = await get('/api/state');
  say(`hole 1 ${m.stage.name}, ${wind.label}; ${name(up)} on the tee, ${tee.distToPinYd} yd`);
  await post('/api/match/arm', { playerId: up, id: 'rocket' });
  let shot = await swing(MISHIT);
  m = (await get('/api/match')).match;
  say(`  a 30 mph mishit: counted as ${name(up)}'s shot (strokes ${who(m, up).strokes}, ${who(m, up).distToPinYd} yd left, rocket spent: charges ${who(m, up).charges}); shot.stray ${shot && shot.stray}; undoable ${JSON.stringify(m.undoable)}`);
  check(shot && shot.stray === true && shot.match.stray === true, 'the stray swing is marked on the shot result');
  check(m.events.some((e) => e.type === 'stray-shot' && e.playerId === up) && m.undoable && m.undoable.stray === true && m.undoable.playerId === up, 'the match state offers it for undo as a stray ball', JSON.stringify(m.undoable));
  check(who(m, up).strokes === 1 && who(m, up).charges === 2 && m.currentPlayerId !== up, 'left alone it counts: a stroke, the ball spent, the other player up');
  r = await post('/api/match/undo');
  m = r.match;
  let st = await get('/api/state');
  say(`  UNDO: ${name(up)} back on the tee (strokes ${who(m, up).strokes}, charges ${who(m, up).charges}, armed ${who(m, up).armedPowerup}); game ball ${JSON.stringify(st.ball)} lie ${st.lie}, up: ${st.player && st.player.name}`);
  check(r.ok && m.phase === 'play' && m.currentPlayerId === up && who(m, up).strokes === 0 && who(m, up).charges === 3 && who(m, up).armedPowerup === 'rocket' && same(who(m, up).usedPowerups, []), 'undo: the match is as it was before the swing', r.error);
  check(same(st.ball, tee.ball) && st.strokes === 0 && st.lie === 'tee' && st.player.id === up && st.distToPinYd === tee.distToPinYd, 'undo: the game has the ball back on the tee for whoever is up');
  check(m.events.at(-1).type === 'shot-undone' && m.undoable === null, 'undo: a shot-undone event, and nothing more to take back');
  check(same(m.stage.wind, wind) && st.conditions.windMph === wind.mph, 'undo: the same wind');
  r = await post('/api/match/undo');
  check(r.status === 409 && r.error === 'There is no shot to take back', 'a second undo is refused', r.error);

  // ----- real shots, then RESTART HOLE
  await post('/api/match/arm', { playerId: up, id: null });
  shot = await swing(DRIVER);
  check(shot && shot.stray === undefined, 'a real drive is not marked');
  await swing(DRIVER);
  await swing(I7);
  m = (await get('/api/match')).match;
  say(`  three real shots: strokes ${m.players.map((p) => p.strokes).join(' / ')}`);
  r = await post('/api/match/restart-hole');
  m = r.match;
  st = await get('/api/state');
  say(`  RESTART HOLE: strokes ${m.players.map((p) => p.strokes).join(' / ')}, ${name(m.currentPlayerId)} up, game ball ${JSON.stringify(st.ball)}`);
  check(r.ok && m.phase === 'play' && m.holeNumber === 1 && m.players.every((p) => p.strokes === 0 && p.lie === 'tee' && p.charges === 3 && p.stats.shots === 0), 'restart-hole: both players on the tee with nothing spent', r.error);
  check(m.currentPlayerId === up && m.honourId === up && same(m.stage.wind, wind) && same(st.ball, tee.ball) && st.strokes === 0, 'restart-hole: the same honour, the same wind, the ball on the tee');
  check(m.events.at(-1).type === 'hole-restarted' && m.undoable === null, 'restart-hole: a hole-restarted event');

  // ----- a second start is refused; RESTART MATCH works while this one is in play
  r = await post('/api/match/start', { playerIds: [a.id, b.id], format: 'quick' });
  say(`  a second start: ${r.status} "${r.error}"`);
  check(r.status === 409 && r.error === 'A match is in play: quit it first' && (await get('/api/match')).match.id === firstId, 'a start while a match is in play is refused with a clear message');
  r = await post('/api/match/restart');
  check(r.ok && r.match.id !== firstId && r.match.format === 'bo3' && same(r.match.players.map((p) => p.id), [a.id, b.id]) && r.match.holeResults.length === 0, 'restart: a new match, the same players and format, while the old one was in play', r.error);
  m = await matchAt('intro');
  say(`  RESTART MATCH: a new match on ${m.stage.name}, wind ${m.stage.wind.label}`);
  check(m.stage.id === 'canyon-run', 'restart: from the same first stage', m.stage.id);

  // ----- a swing that decides the hole, taken back from the result screen
  m = (await post('/api/match/ready')).match;
  for (let i = 0; i < 40 && m.phase === 'play'; i++) { await swing(DINK); m = (await get('/api/match')).match; }
  const lastId = m.undoable && m.undoable.playerId;
  say(`  both out of strokes: ${m.phase}, ${m.lastResult && m.lastResult.reason}; the last swing was ${name(lastId)}'s`);
  check(m.phase === 'hole-result' && m.undoable && m.canRestartHole === false, 'a decided hole: the last swing can be taken back, the hole cannot be restarted');
  r = await post('/api/match/undo');
  m = r.match;
  check(r.ok && m.phase === 'play' && m.currentPlayerId === lastId && m.holeResults.length === 0 && m.lastResult === null && m.nextStage === null, 'undo from the result screen: back in play, the hole undecided', r.error);
  st = await get('/api/state');
  check(st.player.id === lastId && st.strokes === who(m, lastId).strokes, 'and the game is on that player\'s ball');
  say(`  UNDO from the result: ${m.phase}, ${name(lastId)} to play stroke ${who(m, lastId).strokes + 1}`);

  // ----- QUIT MATCH
  r = await post('/api/match/abort');
  check(r.ok && r.match === null && (await get('/api/match')).match === null, 'abort quits the match');
  r = await post('/api/match/undo');
  check(r.status === 409, 'no match: nothing to undo');
  r = await post('/api/match/start', { playerIds: [a.id, b.id], format: 'quick', stage: 'lagoon-island' });
  check(r.ok, 'and a new match starts at once', r.error);
  await post('/api/match/abort');
}

try {
  await main();
} catch (error) {
  failures.push(`crashed: ${error.message}`);
  say(`CRASHED: ${error.stack || error.message}`);
} finally {
  if (sseAbort) sseAbort.abort();
  if (SPAWN) await stopServer();
}
say(failures.length ? `${failures.length} of ${checks} checks FAILED` : `all ${checks} checks held`);
process.exit(failures.length ? 1 : 0);
