#!/usr/bin/env node
// v3:modes BULLSEYE for real (docs/modes.md): a private server on the built Clash Tour, four
// players, whole games driven over HTTP the way the page drives them, on the real arenas.
//
//   1. the lobby's data: the three arenas with the rings painted on them (read from the
//      course files' target-ring props), the defaults, no game
//   2. a high-score game, three rounds of three, four players, at Bullseye Bay: a small bot
//      finds its range ball by ball; every ball is checked against the ring table (the ring
//      its distance falls in, the multiplier of the turn), every turn against the order
//      (lobby order, then whoever is behind leads off), the tee request against the game
//      state (the ball lies where it finished until POST /next), a ball in the water is a
//      miss, a stray ball is marked and taken back, the last ball ends it, the high scores
//      and the nearest ball of the night are on disk, a swing on the result screen is dropped
//   3. play again, then a countdown from 100 at Thunder Dome (four rings: 50 / 15 / 10 / 5)
//      to a check out or the cap, with every bust checked
//   4. on a second server with a short tee timeout: nobody says "next" and the ball is teed
//      up all the same
//
//   node tools/arcade-dev/bullseye-e2e.mjs [--port 18368] [--oc 19998] [--data .scratch/modes/data-b] [--no-spawn]
//
// Its own server (private ports and data dir, no downloads, no sound), stopped afterwards.
// Build the stages first: node tools/arcade-holes/build.mjs --out <data>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const PORT = +flag('--port', 18368);
const OC_PORT = +flag('--oc', 19998);
const DATA = path.resolve(repo, flag('--data', path.join('.scratch', 'modes', 'data-b')));
const SPAWN = !args.includes('--no-spawn');
const BASE = `http://127.0.0.1:${PORT}`;
const FT = 3.28084;

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
async function startServer(env = {}) {
  if (!fs.existsSync(path.join(DATA, 'courses'))) throw new Error(`No courses in ${DATA}: build them first (node tools/arcade-holes/build.mjs --out ${path.relative(repo, DATA)})`);
  serverLog = [];
  child = spawn(process.execPath, ['server.js'], {
    cwd: repo,
    env: { ...process.env, BIRDIE_PORT: String(PORT), BIRDIE_OC_PORT: String(OC_PORT), BIRDIE_DATA_DIR: DATA, BIRDIE_ENRICH: '0', BIRDIE_SKY_PREFETCH: '0', BIRDIE_BULLSEYE_TEE_MS: '0', BIRDIE_BULLSEYE_DONE_MS: '0', ...env },
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
  child = null;
}
const get = (p) => fetch(BASE + p).then((r) => r.json());
const post = async (p, body = {}) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, ...(await r.json()) };
};
const game = async () => (await get('/api/bullseye')).bullseye;
async function phase(...phases) {
  for (let i = 0; i < 600; i++) {
    const s = await game();
    if (s && phases.includes(s.phase)) return s;
    await sleep(50);
  }
  throw new Error(`the game never reached ${phases.join(' / ')}`);
}
const who = (s, id) => s.players.find((p) => p.id === id);
const dartsThrown = (s) => s.players.reduce((n, p) => n + p.darts.length, 0);

// The ball a state's rings give a dart (what lib/bullseye.js scoreBall does), from the dart's own numbers.
function worth(s, d) {
  if (d.miss) return 0;
  if (d.holed) return s.rings[0].value;
  const distM = d.ft / FT;
  const ring = s.rings.find((r) => distM <= r.r + 0.006);   // the dart's ft is rounded to 0.01
  return ring ? ring.value : 0;
}

// A wedge that carries about `yd` (a rough table: the bot corrects it ball by ball).
const TABLE = [[80, 73, 28, 8400], [110, 88, 25, 8600], [135, 100, 22, 7600], [150, 106, 20, 6900]];
function wedge(yd) {
  const d = Math.max(TABLE[0][0], Math.min(TABLE[TABLE.length - 1][0], yd));
  let i = 1;
  while (i < TABLE.length - 1 && TABLE[i][0] < d) i++;
  const a = TABLE[i - 1], b = TABLE[i], t = (d - a[0]) / (b[0] - a[0]);
  const l = (k) => a[k] + (b[k] - a[k]) * t;
  return { speed: +l(1).toFixed(1), vla: +l(2).toFixed(1), hla: 0, spin: Math.round(l(3)), spinAxis: 0 };
}
// One ball: swing, read the state back, check the dart against the rules. Returns { s, d }.
async function throwBall(ball, { label = '', expectPlayer = null } = {}) {
  const before = await game();
  const up = before.currentPlayerId;
  const n = dartsThrown(before);
  const mult = before.turn ? before.turn.mult : 1;
  if (expectPlayer) check(up === expectPlayer, `${label}: it is ${expectPlayer}'s throw`, `up: ${up}`);
  await post('/api/test-shot', ball);
  let s = null;
  for (let i = 0; i < 100; i++) { s = await game(); if (s && dartsThrown(s) > n) break; await sleep(20); }
  if (!check(s && dartsThrown(s) === n + 1, `${label}: the ball was thrown and scored`)) return { s, d: null, up };
  const d = s.lastBall;
  const p = who(s, up);
  check(d.playerId === up && d.n === n + 1, `${label}: the dart is the thrower's`);
  const value = worth(s, d);
  check(d.value === value, `${label}: the ring is the one the ball finished in`, `value ${d.value}, by distance ${value} (${d.ft} ft, rings ${s.rings.map((r) => r.r).join('/')})`);
  check(d.value === 0 ? d.mult === 1 : d.mult === mult, `${label}: the multiplier of the turn`, `x${d.mult}, expected x${mult}`);
  if (!d.bust) check(d.score === d.value * d.mult, `${label}: score = value x multiplier`, `${d.score}`);
  if (d.miss) check(d.ft === null && d.score === 0, `${label}: a lost ball has no distance and no score`);
  else check(Math.abs(Math.hypot(d.x, d.y) * FT - d.ft) < 0.06, `${label}: the dart is where the ball finished`, `(${d.x}, ${d.y}) m against ${d.ft} ft`);
  check(p.darts.at(-1).n === d.n, `${label}: on the player's board`);
  return { s, d, up, mult };
}

async function main() {
  if (SPAWN) await startServer();
  say(`server on ${BASE}, data ${path.relative(repo, DATA)}`);
  const bestFile = path.join(DATA, 'bullseye-best.json');
  const bestBackup = fs.existsSync(bestFile) ? fs.readFileSync(bestFile) : null;
  try { fs.unlinkSync(bestFile); } catch (_) { /* none */ }
  if (SPAWN) { await stopServer(); await startServer(); }   // the store is read at start: begin with none

  // ---------- 1. the lobby's data
  await post('/api/bullseye/abort');
  let info = await get('/api/bullseye');
  check(info.ok === true && info.bullseye === null, 'no game to begin with');
  check(info.arenas.length === 3, 'three arenas', info.arenas.map((a) => a.id).join(', '));
  for (const a of info.arenas) {
    check(Array.isArray(a.rings) && a.rings.length >= 4 && a.rings[0].value === 50 && a.rings.at(-1).value === 5, `${a.id}: its rings are read from the course`, JSON.stringify(a.rings));
  }
  const dome = info.arenas.find((a) => a.id === 'thunder-dome'), bay = info.arenas.find((a) => a.id === 'bullseye-bay');
  check(!!dome && dome.rings.map((r) => r.value).join('/') === '50/15/10/5', 'Thunder Dome: four rings, 50 / 15 / 10 / 5');
  check(!!bay && bay.rings.map((r) => `${r.r}=${r.value}`).join(' ') === '3=50 7=25 11=15 15=10 19=5', 'Bullseye Bay: 3 / 7 / 11 / 15 / 19 m, 50 / 25 / 15 / 10 / 5');
  check(info.defaults.rounds === 3 && info.defaults.balls === 3 && info.defaults.target === 100, 'three rounds of three; a countdown from 100');

  const names = ['Bull Alex', 'Bull Sam', 'Bull Jordan', 'Bull Riley'];
  let roster = (await get('/api/leagues')).players || [];
  for (const name of names) if (!roster.some((p) => p.name === name)) await post('/api/players', { name });
  roster = (await get('/api/leagues')).players || [];
  const ps = names.map((name) => roster.find((p) => p.name === name));
  const ids = ps.map((p) => p.id);

  // ---------- 2. high score, three rounds of three, four players, Bullseye Bay
  say('high score at Bullseye Bay, four players');
  let r = await post('/api/bullseye/start', { playerIds: ids, arena: 'bullseye-bay', variant: 'high' });
  check(r.ok && r.bullseye.phase === 'loading', 'started: the arena is loading', r.error || '');
  let s = await phase('play');
  check(s.rings.map((x) => `${x.r}=${x.value}`).join(' ') === '3=50 7=25 11=15 15=10 19=5', 'the game reads the same rings from the course in the bay');
  check(s.order.join() === ids.join() && s.currentPlayerId === ids[0], 'round one in lobby order');
  check(s.arena.wind && Number.isFinite(s.arena.wind.mph) && s.arena.wind.mph >= 4 && s.arena.wind.mph <= 12, 'the arena has its rolled wind', JSON.stringify(s.arena.wind && s.arena.wind.label));
  let g = await get('/api/state');
  check(g.lie === 'tee' && g.strokes === 0 && g.player && g.player.id === ids[0], 'the first thrower is on the tee');
  check((await post('/api/drop')).status === 409, 'no rescue drop in a game of Bullseye');

  const bot = { yd: (s.arena.lengthYd || 115) * 0.8, hla: 0 };   // downhill: the first guess is short of the card
  const aim = () => ({ ...wedge(bot.yd), hla: bot.hla });
  const learn = (d) => { if (d && !d.miss) { bot.yd -= (d.y / 0.9144) * 0.75; bot.hla -= Math.atan2(d.x, 105) * 180 / Math.PI * 0.6; } };
  let strayDone = false, wetDone = false, teeDone = false;
  const turnsSeen = [];
  for (let round = 1; round <= 3; round++) {
    s = await game();
    check(s.round === round, `round ${round} begins`, `round ${s.round}`);
    if (round > 1) {
      const byScore = [...s.players].sort((a, b) => a.total - b.total).map((p) => p.total);
      check(s.order.map((id) => who(s, id).total).join() === byScore.join(), `round ${round}: whoever is behind leads off`, s.order.map((id) => who(s, id).total).join());
    }
    const order = [...s.order];
    for (const id of order) {
      turnsSeen.push(id);
      let turnScore = 0;
      for (let b = 1; b <= 3; b++) {
        const label = `R${round} ${who(s, id).name.split(' ')[1]} ball ${b}`;
        // once: a stray ball (a 20 mph dribble off the tee) is marked, and undo takes it back
        if (!strayDone && round === 1 && b === 2) {
          strayDone = true;
          const t = await throwBall({ speed: 20, vla: 10, hla: 0, spin: 1500, spinAxis: 0 }, { label: `${label} (stray)`, expectPlayer: id });
          check(t.s.undoable && t.s.undoable.stray === true && t.s.events.some((e) => e.type === 'stray-shot'), 'a 20 mph ball off the tee is marked a stray ball');
          r = await post('/api/bullseye/undo');
          check(r.ok && r.undone.stray === true && r.bullseye.currentPlayerId === id && r.bullseye.ball === 2 && who(r.bullseye, id).darts.length === 1, 'undo takes the stray ball back: the same thrower, the same ball');
          check((await post('/api/bullseye/undo')).status === 409, 'one level of undo');
        }
        // once: a ball flown into the lagoon is a miss
        const wet = !wetDone && round === 2 && b === 1;
        const t = await throwBall(wet ? { speed: 135, vla: 16, hla: 0, spin: 5000, spinAxis: 0 } /* 75 yd over the back: the lagoon is all round the island */ : aim(), { label: wet ? `${label} (into the water)` : label, expectPlayer: id });
        if (!t.d) continue;
        if (wet) { wetDone = true; check(t.d.miss === 'water' || t.d.miss === 'ob', 'a ball in the lagoon is a miss', JSON.stringify(t.d)); } else learn(t.d);
        turnScore += t.d.score;
        s = t.s;
        // once: the ball lies where it finished until the page says "next"
        if (!teeDone && s.phase === 'play') {
          teeDone = true;
          check(s.teed === false && s.waiting && s.waiting.for === 'tee', 'after a ball the game waits to tee the next one up');
          g = await get('/api/state');
          check(g.distToPinYd < 60 && g.strokes === 0 && !g.holed, 'the ball is still where it finished', `${g.distToPinYd} yd, lie ${g.lie}`);
          r = await post('/api/bullseye/next');
          g = await get('/api/state');
          check(r.ok && r.bullseye.teed === true && g.lie === 'tee' && Math.round(g.distToPinYd) >= 110, 'POST /next: the next ball is on the tee');
        }
      }
      s = await game();
      const turn = who(s, id).turns.at(-1);
      check(turn && turn.round === round && turn.score === turnScore, `R${round} ${who(s, id).name}: the turn adds up`, `${turn && turn.score} against ${turnScore}`);
    }
  }
  s = await game();
  check(s.phase === 'done' && s.reason === 'score', 'the last ball of round three ends the game', `${s.phase} / ${s.reason}`);
  check(turnsSeen.length === 12 && ids.every((id) => turnsSeen.filter((x) => x === id).length === 3), 'every player threw three turns');
  check(s.players.every((p) => p.darts.length === 9 && p.total === p.darts.reduce((n, d) => n + d.score, 0)), 'nine balls each, and the totals add up');
  const top = Math.max(...s.players.map((p) => p.total));
  check(s.winnerIds.length >= 1 && s.winnerIds.every((id) => who(s, id).total === top), 'the most points wins', `${s.players.map((p) => `${p.name} ${p.total}`).join(', ')}`);
  say(`  ${s.players.map((p) => `${p.name.split(' ')[1]} ${p.total}`).join(' · ')}  winner: ${s.winnerIds.map((id) => who(s, id).name).join(' & ')}`);
  const scored = s.players.filter((p) => p.total > 0).map((p) => p.id);
  check(scored.length >= 2, 'the bot found the target', `${scored.length} of 4 scored`);
  check(JSON.stringify([...s.records.newBest].sort()) === JSON.stringify([...scored].sort()), 'a first game: every score is a new best');
  const disk = JSON.parse(fs.readFileSync(bestFile, 'utf8'));
  check(scored.every((id) => disk.high['bullseye-bay']['3x3'][id].score === who(s, id).total), 'the high scores are on disk, per arena and per player');
  const nearest = Math.min(...s.players.map((p) => (p.closestFt == null ? Infinity : p.closestFt)));
  check(disk.nearest && disk.nearest.ft === nearest && s.records.nearest.ft === nearest, 'the nearest ball of the night is on disk', `${disk.nearest && disk.nearest.ft} against ${nearest}`);
  info = await get('/api/bullseye');
  check(info.nearest.ft === nearest && info.bests['bullseye-bay'].high['3x3'][scored[0]].score === who(s, scored[0]).total, 'GET /api/bullseye has them for the lobby');
  // the result screen: a swing is nobody's
  const before = dartsThrown(s);
  await post('/api/test-shot', aim());
  await sleep(150);
  s = await game();
  check(s.phase === 'done' && dartsThrown(s) === before, 'a swing on the result screen is dropped');

  // ---------- 3. again; then a countdown at Thunder Dome
  r = await post('/api/bullseye/again');
  check(r.ok && r.bullseye.id !== s.id, 'PLAY AGAIN: a new game, the same players and options');
  s = await phase('play');
  check(s.arena.id === 'bullseye-bay' && s.options.rounds === 3 && s.players.map((p) => p.id).join() === ids.join() && Object.keys(s.records.bests).length === scored.length, 'it knows the bests it is up against');
  r = await post('/api/bullseye/abort');
  check(r.ok && r.bullseye === null, 'abort: no game');

  // A countdown driven to its end: every ball checked (the points come off, a bust puts the turn's back, zero is a check out).
  // `wide`: the first ball of the game is pushed into an outer ring on purpose. Alone, a bot that then finds the
  // bullseye every time goes 50 too many again and again: busts all the way to the cap.
  async function countdown(playerIds, { wide = false } = {}) {
    r = await post('/api/bullseye/start', { playerIds, arena: 'thunder-dome', variant: 'countdown' });
    check(r.ok, 'the countdown starts', r.error || '');
    s = await phase('play');
    check(s.rings.map((x) => x.value).join('/') === '50/15/10/5' && s.rounds === 6 && s.players.every((p) => p.remaining === 100), 'four rings, 100 each, six rounds at most');
    check(s.turn.mult === 1, 'no multiplier in a countdown');
    let busts = 0, safety = 0;
    while (s.phase === 'play' && safety++ < 60) {
      const id = s.currentPlayerId;
      const leftBefore = who(s, id).remaining, start = s.turn.start;
      const off = wide && s.round === 1 && s.ball === 1 && id === playerIds[0];
      const t = await throwBall(off ? { ...aim(), hla: 4.5 } : aim(), { label: `countdown ${who(s, id).name.split(' ')[1]} R${s.round} ball ${s.ball}` });
      if (!t.d) break;
      if (!off) learn(t.d);
      const p = who(t.s, id);
      check(t.d.mult === 1, 'plain ring values');
      if (t.d.bust) {
        busts++;
        check(t.d.value > leftBefore && p.remaining === start && t.d.score === 0, 'a bust: too many, and the score is back to where the turn began', `${t.d.value} with ${leftBefore} left, now ${p.remaining}`);
        check(t.s.phase !== 'play' || t.s.currentPlayerId !== id || t.s.round !== s.round, 'a bust ends the turn');
      } else {
        check(p.remaining === leftBefore - t.d.score, 'the points come off', `${leftBefore} - ${t.d.score} = ${p.remaining}`);
        if (p.remaining === 0) check(t.d.checkout === true && p.out === p.darts.length, 'exactly zero is a check out', `out ${p.out}`);
      }
      s = t.s;
    }
    check(s.phase === 'done' && (s.reason === 'finish' || s.reason === 'cap'), 'the countdown ends: a check out, or the cap', `${s.phase} / ${s.reason} after ${dartsThrown(s)} balls`);
    if (s.reason === 'cap') check(s.round === 6 && who(s, s.winnerIds[0]).remaining === Math.min(...s.players.map((p) => p.remaining)), 'at the cap the nearest to zero wins');
    else check(who(s, s.winnerIds[0]).out === Math.min(...s.players.filter((p) => p.out != null).map((p) => p.out)), 'the check out in the fewest balls wins');
    say(`  ${s.players.map((p) => `${p.name.split(' ')[1]} ${p.out != null ? `out in ${p.out}` : `${p.remaining} left`}`).join(' · ')}  (${s.reason}, ${busts} bust${busts === 1 ? '' : 's'})`);
    return busts;
  }
  say('countdown from 100 at Thunder Dome, alone, the first ball wide');
  bot.yd = 140 * 0.97; bot.hla = 0;
  const soloBusts = await countdown(ids.slice(0, 1), { wide: true });
  check(soloBusts >= 1 || s.reason === 'finish', 'a bullseye with less than 50 left is a bust', `${soloBusts} busts, ${s.reason}`);
  say('countdown from 100 at Thunder Dome, two players');
  await countdown(ids.slice(0, 2));
  check(s.players.some((p) => p.out != null) ? s.reason === 'finish' : s.reason === 'cap', 'a check out decides it; without one, the cap');
  // the ball that ended it can be taken back, and the game goes on
  r = await post('/api/bullseye/undo');
  check(r.ok && r.bullseye.phase === 'play' && r.bullseye.winnerIds.length === 0, 'undo from the result: the game is on again');
  r = await post('/api/bullseye/restart');
  check(r.ok && r.bullseye.phase === 'play' && r.bullseye.round === 1 && r.bullseye.players.every((p) => p.remaining === 100 && p.darts.length === 0), 'RESTART GAME: everybody back on 100');
  // a match takes the bay
  r = await post('/api/match/start', { playerIds: ids.slice(0, 2), format: 'quick' });
  check(r.ok && (await game()) === null, 'starting a match ends the game of Bullseye', r.error || '');
  await post('/api/match/abort');

  // ---------- 4. the safety tee: nobody says "next"
  if (SPAWN) {
    await stopServer();
    await startServer({ BIRDIE_BULLSEYE_TEE_MS: '300' });
    r = await post('/api/bullseye/start', { playerIds: ids.slice(0, 1), arena: 'ice-pick', rounds: 1, balls: 2 });
    s = await phase('play');
    check(s.waiting === null && s.teed, 'a solo game at Ice Pick', r.error || '');
    await post('/api/test-shot', wedge(80));
    await sleep(80);
    s = await game();
    check(s.teed === false && s.waiting && s.waiting.timeoutMs === 300, 'the game waits 300 ms for "next"');
    await sleep(600);
    s = await game();
    g = await get('/api/state');
    check(s.teed === true && g.lie === 'tee', 'nobody said "next": the ball is teed up by itself');
    await post('/api/bullseye/abort');
  }

  // put the data dir's own scores back
  if (SPAWN) await stopServer();
  if (bestBackup) fs.writeFileSync(bestFile, bestBackup); else { try { fs.unlinkSync(bestFile); } catch (_) { /* none */ } }
}

try {
  await main();
} catch (error) {
  failures.push(`crashed: ${error.message}`);
  console.error(error);
  if (serverLog.length) console.error(serverLog.slice(-25).join('\n'));
} finally {
  await stopServer();
}
say(`${checks} checks, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
