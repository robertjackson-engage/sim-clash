#!/usr/bin/env node
// v3:modes Instant replay and highlights, for real (docs/modes.md): a private server on the
// built Clash Tour, two players, matches driven over HTTP as a page would drive them, with
// the event stream open. It checks that the shot that wins a match is marked for a replay
// on the 'shot' event itself (result.highlight, auto in a match), that the reel has it
// (the last match, the night, the shot of the match, the file on disk), that a swing the
// match ignores is reported ('swing-ignored': the page skips a replay with it), that POST
// /api/highlights/play sends 'replay' with the whole path and puts the shot's stage back in
// the bay when it is not (never under a game in play), and that the night's best survives a
// restart of the server.
//
//   node tools/arcade-holes/build.mjs --out .scratch/highlights/data
//   node tools/arcade-dev/highlights-e2e.mjs [--port 8362] [--oc 9992] [--data .scratch/highlights/data]
//
// Its own server (private ports and data dir, no downloads, no sound), stopped afterwards.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const PORT = +flag('--port', 8362);
const OC_PORT = +flag('--oc', 9992);
const DATA = path.resolve(repo, flag('--data', path.join('.scratch', 'highlights', 'data')));
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

let child = null;
let serverLog = [];
async function startServer() {
  if (!fs.existsSync(path.join(DATA, 'courses'))) throw new Error(`No courses in ${DATA}: build them first (see the top of this file)`);
  serverLog = [];
  child = spawn(process.execPath, ['server.js'], {
    cwd: repo,
    env: { ...process.env, BIRDIE_PORT: String(PORT), BIRDIE_OC_PORT: String(OC_PORT), BIRDIE_DATA_DIR: DATA, BIRDIE_ENRICH: '0', BIRDIE_SKY_PREFETCH: '0', BIRDIE_MATCH_READY_MS: '0', BIRDIE_MATCH_CONTINUE_MS: '0', BIRDIE_MATCH_DONE_MS: '0', BIRDIE_WIND_SEED: '11' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const keep = (buf) => { for (const line of String(buf).split(/\r?\n/)) if (line.trim()) serverLog.push(line); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  for (let i = 0; i < 300; i++) {
    if (serverLog.some((l) => l.includes('[HTTP] Open-Birdie UI'))) return;
    if (child.exitCode !== null) throw new Error(`the server did not start:\n${serverLog.join('\n')}`);
    await sleep(100);
  }
  throw new Error('the server did not come up within 30 s');
}
async function stopServer() {
  if (!child || child.exitCode !== null) return;
  const gone = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([gone, sleep(3000)]);
}
const get = (p) => fetch(BASE + p).then((r) => r.json());
const post = async (p, body = {}) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};

// the event stream, as a page has it
let seen = null;
let sse = null;
function listen() {
  seen = { shot: [], highlights: [], replay: [], 'swing-ignored': [] };
  sse = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${BASE}/events`, { signal: sse.signal });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true });
        let at;
        while ((at = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, at);
          buf = buf.slice(at + 2);
          const event = (/^event: (.*)$/m.exec(chunk) || [])[1];
          if (seen[event]) { try { seen[event].push(JSON.parse((/^data: (.*)$/m.exec(chunk) || [])[1])); } catch (_) { /* a partial line */ } }
        }
      }
    } catch (_) { /* closed */ }
  })();
}
const until = async (what, fn, ms = 15000) => {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
};
const matchAt = (...phases) => until(`the match in ${phases.join(' / ')}`, async () => { const { match } = await get('/api/match'); return match && phases.includes(match.phase) ? match : null; });

// the swings of a small bot
const DINK = { speed: 45, vla: 20, hla: 0, spin: 3000, spinAxis: 0 };
const BOMB = { speed: 176, vla: 12.5, hla: 0, spin: 2400, spinAxis: 0 };
function swingFor(p) {
  const d = p.distToPinYd, ft = d * 3;
  if (p.lie === 'green') return { speed: +Math.min(22, 1.9 + 1.33 * Math.sqrt(ft * 1.06) + ft * 1.06 * 0.02).toFixed(1), vla: 0, hla: 0, spin: 0, spinAxis: 0 };
  if (d < 14) return { speed: +(22 * Math.sqrt(Math.max(2, d * 0.9) / 8)).toFixed(1), vla: 26, hla: 0, spin: 3000, spinAxis: 0 };
  if (d > 230) return { speed: 152, vla: 13, hla: 0, spin: 2800, spinAxis: 0 };
  return { speed: +(106 * Math.sqrt(d / 150)).toFixed(1), vla: d > 60 ? 20 : 28, hla: 0, spin: 6900, spinAxis: 0 };
}
async function swing(ball) {
  const n = seen.shot.length;
  await post('/api/test-shot', ball);
  return until('the shot', () => (seen.shot.length > n ? seen.shot[seen.shot.length - 1] : null), 8000);
}

async function main() {
  await startServer();
  listen();
  await until('the event stream', () => seen.highlights.length > 0);
  await post('/api/match/abort');
  await post('/api/solo/abort');
  await post('/api/highlights/clear', { which: 'all' });
  const tour = (await get('/api/match')).tour;
  check(!!tour && tour.stages.some((s) => s.id === 'lagoon-island') && tour.stages.some((s) => s.id === 'canyon-run'), 'the built tour is there (lagoon-island, canyon-run)');
  let r = await get('/api/highlights');
  check(r.ok && r.highlights.last.shots.length === 0 && r.highlights.night.shots.length === 0 && r.highlights.shotOfMatch === null, 'the reel starts empty');

  const roster = async () => (await get('/api/leagues')).players || [];
  for (const name of ['Alex', 'Sam']) if (!(await roster()).some((p) => p.name === name)) await post('/api/players', { name });
  const players = await roster();
  const A = players.find((p) => p.name === 'Alex'), S = players.find((p) => p.name === 'Sam');

  // ---------- match one: Lagoon Island. Alex plays golf, Sam dinks it into the lagoon: Alex's own last shot wins it
  say('match one: a quick match on Lagoon Island');
  r = await post('/api/match/start', { playerIds: [A.id, S.id], format: 'quick', stage: 'lagoon-island', putting: 'easy' });
  check(r.ok, 'match one starts', r.error);
  const matchId = r.match.id;
  await matchAt('intro');
  await post('/api/test-shot', swingFor({ distToPinYd: 150, lie: 'tee' }));
  await until('swing-ignored in the intro', () => seen['swing-ignored'].length > 0);
  check(seen['swing-ignored'][0].by === 'match' && seen['swing-ignored'][0].phase === 'intro' && seen.shot.length === 0, 'a swing during the intro is ignored, and the page is told');
  await post('/api/match/ready');
  let m = await matchAt('play');
  let last = null;
  for (let i = 0; i < 40 && m.phase === 'play'; i++) {
    const up = m.players.find((p) => p.id === m.currentPlayerId);
    last = await swing(up.id === S.id && up.strokes < 5 ? DINK : swingFor(up));
    m = (await get('/api/match')).match;
  }
  check(m.phase === 'done' && m.winnerId === A.id, 'Alex wins match one', `${m.phase}, winner ${m.winnerId}`);
  check(last.match && last.match.event === 'match-over' && last.match.playerId === A.id, 'the last shot is Alex\'s and ends the match');
  check(!!last.highlight && last.highlight.auto === true && last.highlight.why.includes('match-winner') && typeof last.highlight.title === 'string', 'the deciding shot is marked for a replay that plays by itself', JSON.stringify(last.highlight));
  say(`  the decider: "${last.highlight && last.highlight.title}" (${last.highlight && last.highlight.why.join(', ')})`);
  check(seen.shot.filter((s) => s.match && s.match.playerId === S.id).every((s) => !s.highlight), 'none of Sam\'s dinks is a highlight');
  r = await get('/api/highlights');
  let reel = r.highlights;
  const h1 = reel.last.shots.find((x) => x.id === last.highlight.id);
  check(!!h1 && reel.last.game.kind === 'match' && reel.last.game.id === matchId, 'the reel has it in the last match');
  check(!!h1 && h1.player.name === 'Alex' && h1.player.slot === 1 && h1.stage.id === 'lagoon-island' && h1.stage.courseName === 'Lagoon Island' && h1.matchId === matchId && h1.replayable === true && h1.sim === undefined, 'who, where, which match; no path in the list');
  check(reel.night.shots.some((x) => x.id === h1.id) && reel.night.current === true, 'and in the night\'s best');
  check(seen.highlights.some((s) => s.last.shots.some((x) => x.id === h1.id)), 'the highlights event went out with it');
  const award = (m.awards || []).find((a) => a.id === 'shot-of-the-match');
  if (award) {
    const s = reel.shotOfMatch ? reel.last.shots.find((x) => x.id === reel.shotOfMatch.id) : null;
    check(!!s && reel.shotOfMatch.matchId === matchId && s.shotOfMatch === true && s.points === award.points && s.player.id === award.playerId, 'the shot of the match is the award\'s own shot', JSON.stringify(reel.shotOfMatch));
    say(`  shot of the match: "${s && s.title}", ${award.points} pts`);
  } else check(reel.shotOfMatch === null, 'no award, no shot of the match');

  // a swing over the winner screen: ignored, reported
  const ign = seen['swing-ignored'].length;
  await post('/api/test-shot', DINK);
  await until('swing-ignored on the winner screen', () => seen['swing-ignored'].length > ign);
  check(seen['swing-ignored'][ign].phase === 'done', 'a swing over the winner screen is reported (it skips a replay)');

  // play it back: the match is over but still up, its stage is in the bay
  r = await post('/api/highlights/play', { id: h1.id, camera: 'reverse' });
  check(r.status === 200 && r.ok && r.playing === h1.id && r.loaded === false, 'play: its stage is in the bay, nothing is loaded', JSON.stringify([r.status, r.error]));
  const rp = await until('the replay event', () => seen.replay[0]);
  check(rp.id === h1.id && rp.camera === 'reverse' && rp.loaded === false, 'the replay event names it and the camera');
  check(Array.isArray(rp.highlight.sim.points) && rp.highlight.sim.points.length >= 2 && rp.highlight.sim.points[0].length === 4 && rp.highlight.sim.points.length <= 444, 'with the whole path, thinned', String(rp.highlight.sim.points.length));
  check(Array.isArray(rp.highlight.hole.pin) && rp.highlight.from && Number.isFinite(rp.highlight.sim.flightTime) && typeof rp.highlight.stage.file === 'string', 'the pin, where it was hit from, the flight time, the stage file');
  check((await get('/api/match')).match.phase === 'done', 'the finished match is still on its winner screen');
  r = await post('/api/highlights/play', { id: 'nope' });
  check(r.status === 404 && r.ok === false, 'an unknown highlight: 404');

  // ---------- match two: Canyon Run. A big drive in the middle of a hole
  say('match two: a quick match on Canyon Run, for a drive');
  await post('/api/match/abort');
  r = await post('/api/match/start', { playerIds: [A.id, S.id], format: 'quick', stage: 'canyon-run', putting: 'easy' });
  check(r.ok, 'match two starts', r.error);
  await matchAt('intro');
  // match two has the bay on another stage: the reel does not take it away
  r = await post('/api/highlights/play', { id: h1.id });
  check(r.status === 409 && /match is in play/i.test(r.error || ''), 'a highlight from another stage is refused while a match is in play', r.error);
  check((await get('/api/state')).courseName === 'Canyon Run', 'the match\'s stage is still in the bay');
  await post('/api/match/ready');
  m = await matchAt('play');
  const drive = await swing(BOMB);
  const co = drive.arcade && drive.arcade.callout;
  say(`  the drive: ${Math.round(drive.sim.carryYd)} yd, ${co ? `"${co.text}" (${co.tone})` : 'no callout'}`);
  if (co && co.tone === 'epic') {
    check(!!drive.highlight && drive.highlight.auto === true && drive.highlight.why.includes('epic') && drive.match.event === 'shot', 'an epic drive in the middle of a hole is marked too');
    reel = (await get('/api/highlights')).highlights;
    check(reel.last.game.id !== matchId && reel.last.shots.length === 1 && reel.last.shots[0].id === drive.highlight.id, 'a new match: the last list starts over with it');
    check(reel.night.shots.some((x) => x.id === h1.id) && reel.night.shots.some((x) => x.id === drive.highlight.id), 'the night keeps both matches\' shots');
    check(reel.night.shots.every((x, i, a) => i === 0 || a[i - 1].score >= x.score), 'best first');
  } else say('  (not an epic callout this time: the mid-hole checks are skipped)');
  // same stage as the one in the bay: a highlight of THIS stage may be shown even now
  if (drive.highlight) {
    r = await post('/api/highlights/play', { id: drive.highlight.id });
    check(r.ok && r.loaded === false, 'a highlight of the stage in the bay plays without touching the bay');
  }
  await post('/api/match/abort');

  // ---------- nothing in play: the reel puts the shot's stage back in the bay
  const n = seen.replay.length;
  r = await post('/api/highlights/play', { id: h1.id });
  check(r.status === 200 && r.ok && r.loaded === true, 'with nothing in play the shot\'s stage is loaded', JSON.stringify([r.status, r.error]));
  check((await get('/api/state')).courseName === 'Lagoon Island', 'Lagoon Island is back in the bay');
  await until('the replay after the load', () => seen.replay.length > n);
  check(seen.replay[n].loaded === true && seen.replay[n].camera === null, 'the replay event says the stage was loaded');
  // a solo game on another stage is not disturbed either
  r = await post('/api/solo/start', { kind: 'stage', stage: 'canyon-run' });
  check(r.ok, 'a solo stage starts', r.error);
  await until('the solo stage in play', async () => (await get('/api/solo')).run?.phase === 'play');
  r = await post('/api/highlights/play', { id: h1.id });
  check(r.status === 409 && /solo game is in play/i.test(r.error || ''), 'refused while a solo game is in play', r.error);
  await post('/api/solo/abort');

  // ---------- on disk, and after a restart
  const file = path.join(DATA, 'highlights.json');
  const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
  check(disk.version === 1 && disk.night.shots.some((x) => x.id === h1.id && x.sim.points.length >= 2), 'the night is on disk, paths and all');
  check(fs.statSync(file).size < 250000, 'and the file is small', `${fs.statSync(file).size} bytes`);
  say('restarting the server');
  sse.abort();
  await stopServer();
  await startServer();
  listen();
  await until('the event stream again', () => seen.highlights.length > 0);
  reel = (await get('/api/highlights')).highlights;
  check(reel.last.shots.length === 0 && reel.shotOfMatch === null, 'after a restart the last match is forgotten (it was in memory)');
  check(reel.night.shots.some((x) => x.id === h1.id) && reel.night.current === true, 'the night\'s best is still there');
  r = await post('/api/highlights/play', { id: h1.id, camera: 'greenside' });
  check(r.ok && r.playing === h1.id, 'and can still be played', r.error);
  const again = await until('the replay event after the restart', () => seen.replay[0]);
  check(again.highlight.sim.points.length >= 2 && again.camera === 'greenside', 'with its path');

  // ---------- remove, clear
  r = await post('/api/highlights/remove', { id: h1.id });
  check(r.ok && !r.highlights.night.shots.some((x) => x.id === h1.id), 'remove takes one off the reel');
  r = await post('/api/highlights/clear', { which: 'all' });
  check(r.ok && r.highlights.night.shots.length === 0 && JSON.parse(fs.readFileSync(file, 'utf8')).night.shots.length === 0, 'clear empties it, on disk too');
}

try {
  await main();
} catch (error) {
  failures.push(error.message);
  say(`ERROR ${error.stack || error.message}`);
  if (serverLog.length) say(`server log (tail):\n${serverLog.slice(-12).join('\n')}`);
} finally {
  try { sse && sse.abort(); } catch (_) { /* closed */ }
  await stopServer();
}
say(failures.length ? `${failures.length} FAILED of ${checks} checks: ${failures.join('; ')}` : `all ${checks} checks passed`);
process.exit(failures.length ? 1 : 0);
