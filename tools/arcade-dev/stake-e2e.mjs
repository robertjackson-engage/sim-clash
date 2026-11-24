#!/usr/bin/env node
// "Putt in to win", "putt in to tie", for real: a private server on the built Clash Tour, two
// players, quick matches on Lagoon Island (a par 3 with a big green) driven over HTTP until
// the match state says shotFor 'tie' and shotFor 'win' for a putt, with the order on the
// green (fewer strokes first) and the mark on the ball that drops (clutch).
//
//   node tools/arcade-dev/stake-e2e.mjs [--port 8327] [--oc 9957] [--data .scratch/wind/data] [--no-spawn]
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
async function matchAt(...phases) {
  for (let i = 0; i < 1500; i++) {
    const { match } = await get('/api/match');
    if (match && phases.includes(match.phase)) return match;
    await sleep(20);
  }
  throw new Error(`the match never reached ${phases.join(' / ')}`);
}
const I7 = { speed: 111, vla: 19, hla: 0, spin: 7000, spinAxis: 0 };
const DINK = { speed: 8, vla: 10, hla: 0, spin: 1000, spinAxis: 0 };
// a putt with the pace to reach a hole `yd` away and a little more
const putt = (yd) => ({ speed: Math.max(2, Math.sqrt(2 * 0.6 * (yd * 0.9144 + 0.35)) / 0.44704), vla: 0.5, hla: 0, spin: 100, spinAxis: 0 });
const swing = async (launch) => { await post('/api/test-shot', launch); await sleep(30); return (await get('/api/match')).match; };
const who = (m, id) => m.players.find((p) => p.id === id);
const line = (m) => m.players.map((p) => `${p.name.split(' ')[1] || p.name} ${p.holed ? `IN ${p.strokes}` : `lying ${p.strokes} ${p.lie} ${p.distToPinYd} yd`}`).join(' | ');

async function main() {
  if (SPAWN) await startServer();
  const roster = (await get('/api/leagues')).players || [];
  const player = async (name) => roster.find((p) => p.name === name) || (await post('/api/players', { name })).player;
  const a = await player('Stake One'), b = await player('Stake Two');
  await post('/api/match/abort');
  const tee = async () => {
    const r = await post('/api/match/start', { playerIds: [a.id, b.id], format: 'quick', stage: 'lagoon-island', powerups: 'off' });
    if (!r.ok) throw new Error(r.error);
    const m = await matchAt('intro');
    say(`Lagoon Island, wind ${m.stage.wind.label}`);
    return (await post('/api/match/ready')).match;
  };

  // ----- PUTT IN TO TIE: both on the green in one, the first putt drops, the other is to tie
  let m = await tee();
  let tied = false;
  for (let attempt = 1; attempt <= 8 && !tied; attempt++) {
    if (attempt > 1) m = (await post('/api/match/restart-hole')).match;
    m = await swing(I7);
    m = await swing(I7);
    if (!m.players.every((p) => p.lie === 'green' && p.strokes === 1 && !p.holed)) { say(`  attempt ${attempt}: ${line(m)}: not both on the green in one, the hole is restarted`); continue; }
    const first = m.currentPlayerId, second = m.players.find((p) => p.id !== first).id;
    say(`  both on in one: ${line(m)}; ${who(m, first).name} putts first`);
    check(who(m, first).distToPinYd >= who(m, second).distToPinYd, 'level on strokes on the green: the farther ball putts first');
    check(who(m, first).shotFor === 'lead' && who(m, first).shotKind === 'putt', 'level: a make would put the other on a must-make (shotFor lead, a putt)', JSON.stringify([who(m, first).shotFor, who(m, first).shotKind]));
    m = await swing(putt(who(m, first).distToPinYd));
    if (!who(m, first).holed) { say(`  attempt ${attempt}: the first putt stayed out (${line(m)}): the hole is restarted`); if (m.phase !== 'play') { await post('/api/match/abort'); m = await tee(); } continue; }
    const p = who(m, second);
    say(`  ${who(m, first).name} is in for 2. ${p.name}: shotFor ${p.shotFor}, shotKind ${p.shotKind}, mustHole ${p.mustHole}  => "PUTT IN TO TIE"`);
    check(m.currentPlayerId === second && p.shotFor === 'tie' && p.shotKind === 'putt' && p.mustHole === true, 'the match state says the putt is to tie', JSON.stringify([p.shotFor, p.shotKind, p.mustHole]));
    const turn = m.events.filter((e) => e.type === 'turn').at(-1);
    check(turn.playerId === second && turn.shotFor === 'tie' && turn.shotKind === 'putt', 'and so does the turn event', JSON.stringify(turn));
    m = await swing(putt(p.distToPinYd));
    const ev = m.events.find((e) => e.type === 'hole-tied');
    if (who(m, second).holed) {
      say(`  it drops: ${m.phase}, ${m.lastResult.reason}; hole-tied clutch ${ev && ev.clutch}; log: "${m.log.at(-1).text}"`);
      check(ev && ev.clutch === 'tie' && ev.playerId === second && /TIED IT UP!/.test(m.log.at(-1).text), 'the putt to tie dropped: marked TIED IT UP', JSON.stringify(ev));
    } else say(`  it stays out: ${m.phase} (${m.lastResult && m.lastResult.reason})`);
    tied = true;
  }
  check(tied, 'a putt-in-to-tie state was reached');
  await post('/api/match/abort');

  // ----- PUTT IN TO WIN: one on in one, the other fluffs the tee shot and is on in two
  m = await tee();
  let won = false;
  for (let attempt = 1; attempt <= 8 && !won; attempt++) {
    if (attempt > 1) m = (await post('/api/match/restart-hole')).match;
    const first = m.currentPlayerId, second = m.players.find((p) => p.id !== first).id;
    m = await swing(I7);         // the honour: on the green in one
    m = await swing(DINK);       // the other: a yard and a half
    m = await swing(I7);         // ... and on in two (farther from the hole, so up again)
    const p1 = who(m, first), p2 = who(m, second);
    if (!(p1.lie === 'green' && p1.strokes === 1 && p2.lie === 'green' && p2.strokes === 2)) { say(`  attempt ${attempt}: ${line(m)}: not the position wanted, the hole is restarted`); continue; }
    say(`  ${line(m)}; up: ${who(m, m.currentPlayerId).name}`);
    check(m.currentPlayerId === first, 'on the green the player with fewer strokes putts first', `${p1.distToPinYd} yd lying 1 against ${p2.distToPinYd} yd lying 2`);
    say(`  ${p1.name}: shotFor ${p1.shotFor}, shotKind ${p1.shotKind}  => "PUTT IN TO WIN"${p1.distToPinYd < p2.distToPinYd ? ' (and the nearer ball: the old order would have had the other putt)' : ''}`);
    check(p1.shotFor === 'win' && p1.shotKind === 'putt' && p1.mustHole === false, 'the match state says the putt is for the win', JSON.stringify([p1.shotFor, p1.shotKind]));
    check(p2.shotFor === null && p2.shotKind === null, 'the player who waits has no stake');
    m = await swing(putt(p1.distToPinYd));
    const ev = m.events.find((e) => e.type === 'hole-won');
    if (who(m, first).holed) {
      say(`  it drops: ${m.phase}, ${m.lastResult.reason}, hole-won clutch ${ev && ev.clutch}`);
      check(m.phase === 'done' && m.winnerId === first && m.lastResult.reason === 'knockout' && ev && ev.clutch === 'win', 'the putt for the win dropped: a knockout, marked FOR THE WIN', JSON.stringify(ev));
    } else {
      const q = who(m, m.currentPlayerId);
      say(`  it stays out: ${line(m)}; now ${q.name} is up: shotFor ${q.shotFor}`);
    }
    won = true;
  }
  check(won, 'a putt-in-to-win state was reached');
  await post('/api/match/abort');
}

try {
  await main();
} catch (error) {
  failures.push(`crashed: ${error.message}`);
  say(`CRASHED: ${error.stack || error.message}`);
} finally {
  if (SPAWN) await stopServer();
}
say(failures.length ? `${failures.length} of ${checks} checks FAILED` : `all ${checks} checks held`);
process.exit(failures.length ? 1 : 0);
