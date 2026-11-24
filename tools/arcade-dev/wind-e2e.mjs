#!/usr/bin/env node
// Wind per hole, for real: a private server on the built Clash Tour, two players from the
// roster API, a best of three over HTTP (ready / continue posted as a client would, swings
// at POST /api/test-shot), and at every hole and arena: stage.wind is a roll inside the
// stage's range, GET /api/state plays exactly that wind, both players' identical 7-irons off
// the tee finish in the same place, and they drift the way the wind says. Then solo play:
// an arcade stage rolls, a restart and the next hole roll again, and a course that is not
// an arcade stage has the day's conditions back.
//
//   node tools/arcade-holes/build.mjs --out .scratch/wind/data     (once: the courses)
//   node tools/arcade-dev/wind-e2e.mjs [--port 8327] [--oc 9957] [--data .scratch/wind/data] [--seed N] [--no-spawn]
//
// Its own server (private ports and data dir, no downloads, no sound), stopped afterwards.
// Exit code 0: every check held.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { simulateShot } = require(path.join(repo, 'lib', 'physics.js'));
const { windRange } = require(path.join(repo, 'lib', 'arcade-wind.js'));

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const PORT = +flag('--port', 8327);
const OC_PORT = +flag('--oc', 9957);
const DATA = path.resolve(repo, flag('--data', path.join('.scratch', 'wind', 'data')));
const SEED = flag('--seed', '');
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

// ---------- the server ----------
let child = null;
const serverLog = [];
async function startServer() {
  if (!fs.existsSync(path.join(DATA, 'courses'))) throw new Error(`No courses in ${DATA}: run  node tools/arcade-holes/build.mjs --out ${path.relative(repo, DATA)}  first`);
  child = spawn(process.execPath, ['server.js'], {
    cwd: repo,
    env: {
      ...process.env, BIRDIE_PORT: String(PORT), BIRDIE_OC_PORT: String(OC_PORT), BIRDIE_DATA_DIR: DATA, BIRDIE_ENRICH: '0', BIRDIE_SKY_PREFETCH: '0',
      BIRDIE_MATCH_READY_MS: '0', BIRDIE_MATCH_CONTINUE_MS: '0', ...(SEED ? { BIRDIE_WIND_SEED: SEED } : {}),
    },
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

// ---------- HTTP and SSE ----------
const get = async (p) => (await fetch(BASE + p)).json();
const post = async (p, body = {}) => (await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
const shots = [];   // every 'shot' event
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
// fire a swing and hand back its 'shot' event
async function swing(launch) {
  const n = shots.length;
  await post('/api/test-shot', launch);
  for (let i = 0; i < 150 && shots.length === n; i++) await sleep(10);
  return shots.length > n ? shots[shots.length - 1] : null;
}

// ---------- swings ----------
const I7 = { speed: 111, vla: 19, hla: 0, spin: 7000, spinAxis: 0 };   // 150 yd on a still day, dead straight
const DINK = { speed: 8, vla: 10, hla: 0, spin: 1000, spinAxis: 0 };   // a yard and a half
// a straight wedge or iron that carries about `yd` on a still day (for the arenas)
function approach(yd) {
  let best = null;
  for (let speed = 60; speed <= 125; speed += 1) {
    const launch = { speed, vla: 26 - (speed - 60) * 0.11, hla: 0, spin: 9500 - (speed - 60) * 40, spinAxis: 0 };
    const sim = simulateShot({ speedMph: launch.speed, vla: launch.vla, hla: 0, spinRpm: launch.spin, spinAxis: 0 }, { x: 0, y: 0 }, 0, () => 'fairway', {});
    const miss = Math.abs(sim.totalYd - yd);
    if (!best || miss < best.miss) best = { launch, miss };
  }
  return best.launch;
}
const windOf = (c) => `${c.windMph} mph from ${c.windFromDeg}`;
const rad = (d) => d * Math.PI / 180;

async function main() {
  if (SPAWN) await startServer();
  await openEvents();
  const tourFile = JSON.parse(fs.readFileSync(path.join(DATA, 'arcade-tour.json'), 'utf8'));
  const rangeOf = (stageId) => {
    const entry = [...tourFile.stages, ...tourFile.tiebreaks].find((s) => s.id === stageId);
    return windRange(JSON.parse(fs.readFileSync(path.join(DATA, 'courses', entry.file), 'utf8')).arcade);
  };

  // ----- the day's conditions, set by hand before anything: they must come back at the end
  await post('/api/conditions', { preset: 'hot', windMph: 7, windFromDeg: 200 });
  const day = (await get('/api/conditions')).conditions;
  say(`the day's conditions: ${windOf(day)}, ${day.tempF} F, firmness ${day.firmness}`);

  // ----- a best of three
  const roster = (await get('/api/leagues')).players || [];
  const player = async (name) => roster.find((p) => p.name === name) || (await post('/api/players', { name })).player;
  const a = await player('Wind One'), b = await player('Wind Two');
  const started = await post('/api/match/start', { playerIds: [a.id, b.id], format: 'bo3', powerups: 'off' });
  if (!check(started.ok, 'POST /api/match/start', started.error)) return;
  const nameOf = (id) => (id === a.id ? 'P1' : 'P2');
  const seen = [];
  let drifts = 0;
  let wins1 = null;

  // one stage visit: the intro's wind against the game's conditions and the stage's range
  async function visit(kind) {
    const m = await matchAt('intro');
    const w = m.stage.wind;
    const range = rangeOf(m.stage.id);
    const st = await get('/api/state');
    say(`${kind === 'tiebreak' ? '  arena' : `hole ${m.holeNumber}`} ${m.stage.name}: ${w ? w.label : 'NO stage.wind'}  (from ${w && w.dirDeg} deg, range ${range.min} to ${range.max}, strength ${w && w.strength}); game: ${windOf(st.conditions)}`);
    check(m.stage.kind === kind, `${m.stage.name}: the stage is a ${kind}`, m.stage.kind);
    if (!check(w && w.rolled === true && Number.isInteger(w.mph), `${m.stage.name}: stage.wind is a rolled wind`, JSON.stringify(w))) return m;
    check(w.mph >= range.min && w.mph <= range.max && w.min === range.min && w.max === range.max, `${m.stage.name}: ${w.mph} mph is inside the stage's range ${range.min} to ${range.max}`, JSON.stringify(w));
    check(st.conditions.windMph === w.mph && st.conditions.windFromDeg === w.dirDeg && st.conditions.gustMph === 0, `${m.stage.name}: GET /api/state plays stage.wind`, `${windOf(st.conditions)} against ${w.mph} from ${w.dirDeg}`);
    check(typeof w.label === 'string' && w.label.startsWith(w.mph < 1 ? 'NO WIND' : `${w.mph} MPH`), `${m.stage.name}: the label reads`, w.label);
    const c = await get('/api/conditions');
    check(c.stageWind && c.stageWind.mph === w.mph && c.stageWind.dirDeg === w.dirDeg && JSON.stringify(c.day) === JSON.stringify(day), `${m.stage.name}: the day's conditions are held aside`, JSON.stringify(c.day));
    seen.push({ id: m.stage.id, name: m.stage.name, kind, ...w });
    return m;
  }
  // a tee shot's drift against the wind across the line it was aimed on
  function drift(name, w, aimDeg, shot, club = '7-iron') {
    const across = w.mph * Math.sin(rad(w.dirDeg + 180 - aimDeg));
    const off = shot.sim.offlineYd;
    const tree = (shot.sim.events || []).some((e) => /tree/.test(e.type));
    say(`    ${name}: ${club} carried ${shot.sim.carryYd} yd, ${Math.abs(off)} yd ${off > 0 ? 'RIGHT' : off < 0 ? 'LEFT' : 'on the line'} (wind across the aim line: ${across.toFixed(1)} mph ${across > 0 ? 'left to right' : 'right to left'}; the shot met ${shot.wind.speedMph} mph from ${shot.wind.fromDeg})`);
    check(shot.wind.speedMph === w.mph && shot.wind.fromDeg === w.dirDeg && shot.wind.gustMph === 0, `${name}: the shot met the hole's wind, steady`, JSON.stringify(shot.wind));
    if (Math.abs(across) >= 2 && !tree) {
      drifts++;
      check(Math.sign(off) === Math.sign(across) && Math.abs(off) >= Math.abs(across) * 0.6, `${name}: the ball drifted the way the wind blows`, `${off} yd for ${across.toFixed(1)} mph across`);
    }
  }

  for (let guard = 0; guard < 4; guard++) {
    let m = await visit('match');
    const w = m.stage.wind;
    const hole = m.holeNumber;
    m = (await post('/api/match/ready')).match;
    // both players: the same dead-straight 7-iron off the tee
    const tee = [];
    for (let i = 0; i < 2 && m.phase === 'play'; i++) {
      const who = m.currentPlayerId;
      const aimDeg = (await get('/api/state')).aimDeg;
      const shot = await swing(I7);
      if (!check(shot && shot.match && shot.match.playerId === who, `hole ${hole}: ${nameOf(who)}'s tee shot was played`)) break;
      drift(`hole ${hole} ${nameOf(who)}`, w, aimDeg, shot);
      tee.push(shot);
      m = (await get('/api/match')).match;
    }
    if (tee.length === 2) check(tee[0].sim.offlineYd === tee[1].sim.offlineYd && tee[0].sim.carryYd === tee[1].sim.carryYd, `hole ${hole}: the same swing in the same wind, the same ball for both players`, `${tee[0].sim.offlineYd} / ${tee[1].sim.offlineYd}`);
    // nobody plays on properly: dinks until the hole is decided or tied
    for (let i = 0; i < 40 && m.phase === 'play'; i++) { await swing(DINK); m = (await get('/api/match')).match; }
    check(JSON.stringify(m.stage.wind) === JSON.stringify(w) || m.phase !== 'hole-result', `hole ${hole}: the wind did not change during the hole`);
    if (m.phase === 'hole-result' && m.nextStage && m.nextStage.kind === 'tiebreak') {
      say(`  hole ${hole} tied (${m.lastResult.reason}); the arena to come: ${m.nextStage.name}, wind ${m.nextStage.wind ? m.nextStage.wind.label : 'not known until it is rolled'}`);
      check(!m.nextStage.wind || m.nextStage.wind.mph === null, `hole ${hole}: nextStage.wind is the range only before the roll`, JSON.stringify(m.nextStage.wind));
      await post('/api/match/continue');
      m = await visit('tiebreak');
      const aw = m.stage.wind;
      m = (await post('/api/match/ready')).match;
      // hole 1 to whoever hits first; hole 2 to the other player, so the match goes to a third
      const good = approach(m.stage.lengthYd);
      const wanted = hole === 2 && wins1 ? (wins1 === a.id ? b.id : a.id) : m.currentPlayerId;
      for (let i = 0; i < 6 && m.phase === 'tiebreak'; i++) {
        const who = m.currentPlayerId;
        const aimDeg = (await get('/api/state')).aimDeg;
        const shot = await swing(who === wanted ? good : DINK);
        if (shot && who === wanted) drift(`arena ${m.stage.name} ${nameOf(who)}`, aw, aimDeg, shot, 'approach');
        m = (await get('/api/match')).match;
      }
    }
    const r = m.lastResult || (m.holeResults || []).slice(-1)[0];
    say(`  hole ${hole}: ${r && r.winnerId ? `${nameOf(r.winnerId)} wins it (${r.reason})` : 'no winner'}; ${m.standings}`);
    if (hole === 1) wins1 = r && r.winnerId;
    if (m.phase === 'done') break;
    if (!check(m.phase === 'hole-result', `hole ${hole}: on to the next hole`, m.phase)) break;
    check(m.nextStage && (m.nextStage.wind === null || m.nextStage.wind.mph === null), `hole ${hole}: the next stage's wind is not rolled yet`, JSON.stringify(m.nextStage && m.nextStage.wind));
    await post('/api/match/continue');
  }

  const holes = seen.filter((s) => s.kind === 'match');
  say(`winds of the match: ${seen.map((s) => `${s.name} ${s.mph} mph from ${s.dirDeg}`).join(' | ')}`);
  check(holes.length >= 2, 'at least two holes were played', String(holes.length));
  check(new Set(seen.map((s) => `${s.mph}/${s.dirDeg}`)).size === seen.length, 'every hole and arena had a different wind');
  check(drifts >= 1, 'at least one tee shot had a wind across it to check the drift against', String(drifts));

  // ----- the match is over: dropped, the bay is in solo play on an arcade stage
  let m = (await get('/api/match')).match;
  check(m && m.phase === 'done', 'the match is over', m && m.phase);
  await post('/api/match/abort');
  let c = await get('/api/conditions');
  const last = seen[seen.length - 1];
  say(`match dropped: the bay is on ${(await get('/api/state')).courseName}, solo wind ${c.stageWind ? c.stageWind.label : 'none'}`);
  check(c.stageWind && c.stageWind.rolled && !(c.stageWind.mph === last.mph && c.stageWind.dirDeg === last.dirDeg), 'solo play on the stage the match ended on: a fresh wind', JSON.stringify(c.stageWind));
  check(JSON.stringify(c.day) === JSON.stringify(day), 'the day\'s conditions are still held aside');

  // ----- solo play: load a stage, restart, next hole
  const windy = tourFile.stages.find((s) => s.id === 'lighthouse-point') || tourFile.stages[tourFile.stages.length - 1];
  const range = rangeOf(windy.id);
  await post('/api/load-course', { cached: windy.file });
  const solo = [(await get('/api/conditions')).stageWind];
  await post('/api/next-hole');   // (a one-hole stage: the round is over, the next one starts with a restart)
  solo.push((await get('/api/conditions')).stageWind);
  await post('/api/reset');
  solo.push((await get('/api/conditions')).stageWind);
  say(`solo on ${windy.name} (range ${range.min} to ${range.max}): loaded ${solo[0].label} | next hole ${solo[1].label} | restart ${solo[2].label}`);
  check(solo.every((w) => w && w.rolled && w.mph >= range.min && w.mph <= range.max), 'solo: every roll is inside the stage\'s range');
  check(new Set(solo.map((w) => `${w.mph}/${w.dirDeg}`)).size === 3, 'solo: load, restart and next hole each rolled a wind of their own');
  const st = await get('/api/state');
  check(st.conditions.windMph === solo[2].mph && st.conditions.windFromDeg === solo[2].dirDeg, 'solo: GET /api/state plays the rolled wind');
  const aimDeg = st.aimDeg;
  const shot = await swing(I7);
  if (check(Boolean(shot), 'solo: a tee shot was played')) drift(`solo ${windy.name}`, solo[2], aimDeg, shot);

  // ----- a course that is not an arcade stage: the day's conditions, exactly
  const classics = fs.readdirSync(path.join(DATA, 'courses')).find((f) => /9900000000100\.json$/.test(f));
  if (check(Boolean(classics), 'the three-hole Arcade Classics course is built (not an arcade stage)')) {
    await post('/api/load-course', { cached: classics });
    c = await get('/api/conditions');
    say(`${(await get('/api/state')).courseName}: ${windOf(c.conditions)}, ${c.conditions.tempF} F`);
    check(JSON.stringify(c.conditions) === JSON.stringify(day) && c.stageWind === null && c.day === null, 'a course that is not an arcade stage: the day\'s conditions are back', JSON.stringify(c.conditions));
    await post('/api/reset');
    check(JSON.stringify((await get('/api/state')).conditions) === JSON.stringify(day), 'and a restart there rolls nothing');
  }
  const kept = JSON.parse(fs.readFileSync(path.join(DATA, 'conditions.json'), 'utf8')).conditions;
  check(kept.windMph === day.windMph && kept.windFromDeg === day.windFromDeg && kept.tempF === day.tempF, 'conditions.json still holds the day\'s conditions', JSON.stringify(kept));
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
const rolls = serverLog.filter((l) => l.startsWith('[wind]'));
if (rolls.length) say(`the server rolled ${rolls.length} winds`);
say(failures.length ? `${failures.length} of ${checks} checks FAILED` : `all ${checks} checks held`);
process.exit(failures.length ? 1 : 0);
