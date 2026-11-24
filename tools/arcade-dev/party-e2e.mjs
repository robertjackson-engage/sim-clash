#!/usr/bin/env node
// PARTY and handicaps, for real: a private server on the built Clash Tour, four roster players,
// and whole games driven over HTTP as a page would drive them (docs/modes.md):
//
//   1  SKINS for four over three holes, one player with HELP 3: the order of play checked on
//      every state (the tee in honour order, then the farthest; on the green the fewest
//      strokes), "out of the hole" (nobody who is picked up could still have tied), the skins
//      and the carry adding up, a trick cast on a chosen opponent, an undo and a restart of
//      the hole in mid-play, the forward tee of the helped player on every stage, the placings,
//      the rewards and every profile afterwards
//   2  ELIMINATION for three: one player out per hole (a tie goes to an arena), nobody who is
//      out ever comes up again, the last one standing wins
//   3  a STROKE RACE for four: every total is the sum of its holes, the lowest wins
//   4  a head-to-head with help: the old game, with one player on a forward tee
//
//   node tools/arcade-dev/party-e2e.mjs [--port 8358] [--oc 9988] [--data .scratch/modes/data] [--no-spawn]
//
// Its own server (private ports and data dir, no downloads, no sound), stopped afterwards.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testSwing } from '../../public/arcade/shell-core.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const PORT = +flag('--port', 8358);
const OC_PORT = +flag('--oc', 9988);
const DATA = path.resolve(repo, flag('--data', path.join('.scratch', 'modes', 'data')));
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
  if (!fs.existsSync(path.join(DATA, 'courses'))) throw new Error(`No courses in ${DATA}: build them first (node tools/arcade-holes/build.mjs --out ${path.relative(repo, DATA)})`);
  child = spawn(process.execPath, ['server.js'], {
    cwd: repo,
    env: { ...process.env, BIRDIE_PORT: String(PORT), BIRDIE_OC_PORT: String(OC_PORT), BIRDIE_DATA_DIR: DATA, BIRDIE_ENRICH: '0', BIRDIE_SKY_PREFETCH: '0', BIRDIE_MATCH_READY_MS: '0', BIRDIE_MATCH_CONTINUE_MS: '0', BIRDIE_WIND_SEED: '11' },
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
const matchNow = async () => (await get('/api/match')).match;
async function matchAt(...phases) {
  for (let i = 0; i < 1500; i++) {
    const m = await matchNow();
    if (m && phases.includes(m.phase)) return m;
    await sleep(20);
  }
  throw new Error(`the match never reached ${phases.join(' / ')}`);
}
// answer the screens as a page does, until a swing is wanted or the game is over
async function toPlay() {
  for (let i = 0; i < 400; i++) {
    const m = await matchAt('intro', 'play', 'tiebreak', 'hole-result', 'done');
    if (m.phase === 'intro') await post('/api/match/ready');
    else if (m.phase === 'hole-result') await post('/api/match/continue');
    else return m;
  }
  throw new Error('the screens never ended');
}

// a small deterministic player: a sensible swing for where the ball lies, a touch off (seeded)
let seed = 20261123;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
async function swing(skill = 1) {
  const st = await get('/api/state');
  // the shot the game's own lineup predicts for the club it picked (the page's SMART SWING), a touch off
  const plan = await get('/api/predict').catch(() => null);
  let ball = testSwing('auto', st, () => (rand() * 2 - 1) * (2 - skill), plan && plan.launch ? plan : null);
  if (st.lie === 'green' && skill < 1) {
    const ft = Math.max(1, (st.distToPinYd || 2) * 3);
    const sp = Math.min(22, 1.9 + 1.33 * Math.sqrt(ft) + ft * 0.02);
    const off = 0.6 + rand() * 0.6;   // a weak putter leaves them short or blasts them by
    ball = { speed: +(sp * off).toFixed(1), vla: 0, hla: +((rand() - 0.5) * 6).toFixed(1), spin: 0, spinAxis: 0 };
  }
  await post('/api/test-shot', ball);
  return ball;
}
const doneHole = (p) => p.holed || p.capped || p.pickedUp;
const liveOf = (m) => m.players.filter((p) => !p.out && !doneHole(p));

// the order of play, as docs/modes.md has it
function checkTurn(m, tag) {
  if (m.phase !== 'play' || !m.currentPlayerId) return;
  const live = liveOf(m);
  const up = m.players.find((p) => p.id === m.currentPlayerId);
  if (!check(!!up && live.includes(up), `${tag}: whoever is up is still playing the hole`, up ? `${up.name} out=${up.out} holed=${up.holed} pickedUp=${up.pickedUp}` : 'nobody')) return;
  const rank = (p) => m.teeOrder.indexOf(p.id);
  const onTee = live.filter((p) => p.strokes === 0).sort((a, b) => rank(a) - rank(b));
  if (onTee.length) { check(up.id === onTee[0].id, `${tag}: the tee is played in honour order`, `${up.name} is up, ${onTee[0].name} is next in the order`); return; }
  const allGreen = m.party !== 'stroke' && live.length >= 2 && live.every((p) => p.lie === 'green');
  if (allGreen) { check(up.strokes === Math.min(...live.map((p) => p.strokes)), `${tag}: on the green the fewest strokes putt first`, `${up.name} lies ${up.strokes}`); return; }
  const far = Math.max(...live.map((p) => p.distToPinYd ?? 0));
  check((up.distToPinYd ?? 0) >= far - 0.11, `${tag}: the farthest from the hole plays`, `${up.name} is ${up.distToPinYd} yd out, somebody is ${far}`);
}
// nobody who picked up could still have mattered
function checkSweep(m, tag) {
  const field = m.players.filter((p) => !p.out);
  const inn = field.filter((p) => p.holed);
  for (const p of field.filter((x) => x.pickedUp)) {
    if (m.party === 'skins') check(inn.length > 0 && p.strokes >= Math.min(...inn.map((q) => q.strokes)), `${tag}: ${p.name} picked up only once a tie was out of reach`, `${p.strokes} strokes`);
    if (m.party === 'stroke') check(false, `${tag}: nobody picks up in a stroke race`, p.name);
  }
}

async function addPlayers() {
  const names = ['Alex', 'Sam', 'Jordan', 'Riley'];
  let roster = (await get('/api/leagues')).players || [];
  for (const name of names) if (!roster.some((p) => p.name === name)) await post('/api/players', { name });
  roster = (await get('/api/leagues')).players || [];
  return names.map((name) => roster.find((p) => p.name === name));
}

async function playGame(tag, { skills, hooks = {} }) {
  let m = await toPlay();
  let swings = 0;
  const seenOut = new Set();
  while (m.phase !== 'done' && swings < 400) {
    checkTurn(m, tag);
    for (const p of m.players) if (p.out) seenOut.add(p.id);
    check(!seenOut.has(m.currentPlayerId), `${tag}: a player who is out never comes up`);
    if (hooks.before) await hooks.before(m, swings);
    m = await matchNow();
    if (m.phase !== 'play' && m.phase !== 'tiebreak') { m = await toPlay(); continue; }
    const up = m.currentPlayerId;
    const before = m.players.find((p) => p.id === up);
    await swing(skills[up] ?? 1);
    swings++;
    m = await matchNow();
    const after = m.players.find((p) => p.id === up);
    if (m.phase === 'play' && before && after && !after.out) check(after.strokes > before.strokes || m.holeNumber !== undefined, `${tag}: the swing counted`);
    checkSweep(m, tag);
    if (hooks.after) await hooks.after(m, swings);
    m = await matchNow();
    if (m.phase === 'hole-result' && hooks.result) await hooks.result(m);
    if (m.phase !== 'play' && m.phase !== 'tiebreak' && m.phase !== 'done') m = await toPlay();
  }
  check(m.phase === 'done', `${tag}: the game ended`, `after ${swings} swings it is in '${m.phase}'`);
  return { m, swings };
}

async function main() {
  if (SPAWN) { say(`starting a private server on ${PORT} / ${OC_PORT} (data ${path.relative(repo, DATA)})`); await startServer(); }
  await post('/api/match/abort');
  const ps = await addPlayers();
  const [a, b, c, d] = ps;
  const name = (id) => (ps.find((p) => p.id === id) || {}).name || id;
  const info = await get('/api/match');
  check(info.partyFormats && Object.keys(info.partyFormats).join() === 'skins,stroke,elim', 'GET /api/match offers the party formats');
  check(Array.isArray(info.helpLevels) && info.helpLevels.length === 4, 'GET /api/match explains the help levels');
  const before = { ...info.profiles };

  // ---------- 1. skins for four, three holes, Riley with HELP 3 ----------
  say('1. SKINS: four players, three holes, Riley on HELP 3');
  let r = await post('/api/match/start', { playerIds: ps.map((p) => p.id), format: 'skins', holes: 3, help: { [d.id]: 3 } });
  check(r.ok === true, 'a four-player skins game starts', r.error);
  let m = r.match;
  check(m.party === 'skins' && m.players.length === 4 && m.maxHoles === 3 && m.stakes === null, 'it is a party: skins, four players, three holes, friendly');
  check(m.players.find((p) => p.id === d.id).charges === 5 && m.players.find((p) => p.id === a.id).charges === 3, 'Riley has two more power-up charges');
  check(m.teeOrder.length === 4 && m.honourId === m.teeOrder[0], 'the first tee is drawn');
  const tees = [];
  let undone = false, restarted = false, cast = false;
  const holes = [];
  const out1 = await playGame('skins', {
    skills: { [a.id]: 1, [b.id]: 1, [c.id]: 0.6, [d.id]: 0.5 },
    hooks: {
      async before(mm, n) {
        const riley = mm.players.find((p) => p.id === d.id);
        if (mm.phase === 'play' && riley.strokes === 0 && !tees.some((t) => t.hole === mm.holeNumber)) tees.push({ hole: mm.holeNumber, stage: mm.stage.name, teeYd: riley.teeYd, lengthYd: mm.stage.lengthYd, lie: riley.lie });
        // a trick on a chosen opponent, once
        if (!cast && mm.phase === 'play' && mm.currentPlayerId === a.id) {
          cast = true;
          const out = await post('/api/match/arm', { playerId: a.id, id: 'gust', targetId: c.id });
          check(out.ok === true && out.match.players.find((p) => p.id === c.id).cursedWith === 'gust' && !out.match.players.some((p) => p.id !== c.id && p.cursedWith), 'a trick lands on the opponent chosen, and nobody else', out.error);
          check(out.match.players.find((p) => p.id === a.id).charges === 2, 'it cost its caster a charge');
        }
        // an undo in mid-play, once: the state is exactly as it was
        if (!undone && n === 5 && mm.phase === 'play') {
          undone = true;
          const snap = JSON.stringify(mm.players.map((p) => [p.id, p.strokes, p.lie, p.ball, p.holed, p.pickedUp, p.charges, p.cursedWith]));
          const who = mm.currentPlayerId;
          await swing(1);
          const mid = await matchNow();
          check(mid.undoable && mid.undoable.playerId === who, 'the swing can be taken back');
          const back = await post('/api/match/undo');
          check(back.ok === true && back.match.currentPlayerId === who && JSON.stringify(back.match.players.map((p) => [p.id, p.strokes, p.lie, p.ball, p.holed, p.pickedUp, p.charges, p.cursedWith])) === snap, 'undo: four players exactly as they were, the same player up');
        }
        // restart the hole once, on hole 2
        if (!restarted && mm.phase === 'play' && mm.holeNumber === 2 && mm.players.some((p) => p.strokes >= 2)) {
          restarted = true;
          const out = await post('/api/match/restart-hole');
          check(out.ok === true && out.match.players.every((p) => p.strokes === 0 && !p.holed && !p.pickedUp) && out.match.holeNumber === 2, 'restart the hole: everybody back on the tee of hole 2', out.error);
          const riley = out.match.players.find((p) => p.id === d.id);
          check(riley.teeYd == null || riley.distToPinYd < out.match.stage.lengthYd, 'Riley is back on the forward tee');
        }
      },
      async result(mm) {
        const res = mm.lastResult;
        holes.push({ hole: res.holeNumber, reason: res.reason, winner: res.winnerId, skins: res.skins, carry: mm.carry });
      },
    },
  });
  m = out1.m;
  say(`   ${out1.swings} swings; results: ${m.holeResults.map((x) => `${x.holeNumber}:${x.winnerId ? name(x.winnerId) : '-'}/${x.reason}${x.skins ? `/${x.skins}` : ''}`).join('  ')}`);
  say(`   Riley's tees: ${tees.map((t) => `${t.stage} ${t.teeYd ? `${t.teeYd} yd (of ${t.lengthYd}, ${t.lie})` : 'back tee'}`).join(' · ')}`);
  const totalSkins = m.players.reduce((s, p) => s + (p.holesWon || 0), 0);
  const playedHoles = m.holeResults.filter((x) => !x.playoff).length;
  check(totalSkins + m.carry === playedHoles, 'every skin of every hole played was won or is still carried', `${totalSkins} won + ${m.carry} carried against ${playedHoles} holes`);
  check(m.winnerId && m.placings.length === 4 && m.placings[0] === m.winnerId && new Set(m.placings).size === 4, 'four placings, the winner first');
  const top = Math.max(...m.players.map((p) => p.holesWon || 0));
  check(m.players.find((p) => p.id === m.winnerId).holesWon === top || m.reason === 'tiebreak', 'the winner has the most skins (or won the playoff)');
  check(m.rewards && m.rewards.winner.trophies >= 20 && m.rewards.winner.coins === 250 && m.rewards.placings.join() === m.placings.join(), 'the rewards are the game\'s');
  check(undone && restarted && cast, 'the undo, the restart and the trick were all exercised');
  check(tees.length >= 2, 'Riley\'s tee was looked at on the stages');
  check(tees.some((t) => t.teeYd && t.teeYd < t.lengthYd && (t.lie === 'fairway' || t.lie === 'tee')), 'a forward tee was found on mown ground on at least one stage', JSON.stringify(tees));
  const after = (await get('/api/match')).profiles;
  check(after[m.winnerId].wins === (before[m.winnerId].wins || 0) + 1, 'the winner\'s profile has the win');
  check(m.placings.slice(1).every((id) => after[id].losses === (before[id].losses || 0) + 1), 'the three others have a loss on the record');
  check(m.placings.slice(1, 3).every((id) => after[id].trophies === before[id].trophies), 'the players in between keep their trophies');

  // ---------- a rematch keeps it all ----------
  r = await post('/api/match/rematch');
  check(r.ok === true && r.match.party === 'skins' && r.match.players.length === 4 && r.match.players.find((p) => p.id === d.id).help.level === 3, 'a rematch: the same four, skins, Riley\'s help', r.error);
  await post('/api/match/abort');

  // ---------- 2. elimination for three ----------
  say('2. ELIMINATION: three players');
  r = await post('/api/match/start', { playerIds: [a.id, b.id, c.id], format: 'elim' });
  check(r.ok === true && r.match.party === 'elim' && r.match.maxHoles === 2, 'an elimination for three is two holes', r.error);
  const outs = [];
  const out2 = await playGame('elim', {
    skills: { [a.id]: 1, [b.id]: 0.8, [c.id]: 0.5 },
    hooks: { async result(mm) { if (mm.lastResult.eliminatedId) outs.push(mm.lastResult.eliminatedId); } },
  });
  m = out2.m;
  say(`   ${out2.swings} swings; out: ${m.holeResults.map((x) => `${x.holeNumber}:${x.eliminatedId ? name(x.eliminatedId) : '-'}/${x.reason}`).join('  ')}; winner ${name(m.winnerId)}`);
  check(m.players.filter((p) => p.out).length === 2 && m.players.filter((p) => !p.out).length === 1, 'two are out, one is left');
  check(m.players.find((p) => !p.out).id === m.winnerId, 'the one who is left is the winner');
  check(m.holeResults.filter((x) => x.eliminatedId).length === 2, 'one player went on each hole');
  check(m.placings[2] === m.holeResults.find((x) => x.eliminatedId).eliminatedId, 'the first one out is last');
  await post('/api/match/abort');

  // ---------- 3. a stroke race for four ----------
  say('3. STROKE RACE: four players, three holes');
  r = await post('/api/match/start', { playerIds: ps.map((p) => p.id), format: 'stroke', holes: 3 });
  check(r.ok === true && r.match.party === 'stroke', 'a stroke race starts', r.error);
  const out3 = await playGame('stroke', { skills: { [a.id]: 1, [b.id]: 0.9, [c.id]: 0.6, [d.id]: 0.5 } });
  m = out3.m;
  say(`   ${out3.swings} swings; totals: ${m.players.map((p) => `${p.name} ${p.total}`).join(' · ')}; winner ${name(m.winnerId)} (${m.reason})`);
  const holes3 = m.holeResults.filter((x) => !x.playoff);
  check(holes3.length === 3, 'three holes were played');
  for (const p of m.players) check(p.total === holes3.reduce((s, x) => s + x.scores[p.id], 0), `${p.name}'s total is the sum of the holes`, `${p.total}`);
  const low = Math.min(...m.players.map((p) => p.total));
  check(m.players.find((p) => p.id === m.winnerId).total === low, 'the lowest total wins');
  check(m.players.every((p) => !p.pickedUp), 'nobody picked up');
  check(holes3.every((x) => Object.values(x.scores).every((s) => s >= 1 && s <= x.par + 4)), 'no hole counts more than the stroke limit plus one');
  await post('/api/match/abort');

  // ---------- 4. a head-to-head with help ----------
  say('4. VERSUS with help: a quick match, Sam on HELP 2');
  r = await post('/api/match/start', { playerIds: [a.id, b.id], format: 'quick', stage: 'canyon-run', help: { [b.id]: 2 } });
  check(r.ok === true && !('party' in r.match), 'a head-to-head is still a head-to-head', r.error);
  m = await toPlay();
  const sam = m.players.find((p) => p.id === b.id), alex = m.players.find((p) => p.id === a.id);
  say(`   Canyon Run ${m.stage.lengthYd} yd: Sam's tee ${sam.teeYd ? `${sam.teeYd} yd (${sam.lie})` : 'the back tee'}`);
  check(sam.help && sam.help.level === 2 && !('help' in alex), 'only the helped player carries help');
  check(sam.charges === alex.charges + 1, 'one more charge');
  check(sam.teeYd > 0 && sam.teeYd < m.stage.lengthYd && sam.distToPinYd < alex.distToPinYd, 'Sam starts on a forward tee, nearer the pin');
  await post('/api/match/abort');
}

try {
  await main();
} catch (error) {
  failures.push(`the run stopped: ${error.message}`);
  say(`STOPPED: ${error.stack || error.message}`);
} finally {
  await post('/api/match/abort').catch(() => {});
  await stopServer();
}
say(`${checks} checks, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); if (serverLog.length) console.log(serverLog.slice(-12).join('\n')); process.exit(1); }
