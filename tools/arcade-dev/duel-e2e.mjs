#!/usr/bin/env node
// v3:modes TRICK SHOT DUEL for real (docs/modes.md): a private server on the built Clash Tour,
// two players, whole duels driven over HTTP the way the page drives them.
//
//   1. the lobby's data: every stage and arena, the words, the tolerances
//   2. a duel for PIG at Thunder Dome: a call read from a real ball (cross-checked against
//      lib/duel.js makeCall on the features the server reports), the tee request (the ball
//      lies where it finished until POST /next), an answer that misses (a letter, every
//      check cross-checked against judge), an answer that matches, the roles swapping every
//      round, a stray ball marked and taken back, to the last letter; the result, a swing
//      dropped on it, undo from the result, play again (the loser calls first), restart
//   3. NO CALL at Bullseye Bay: a ball flown over the island into the lagoon sets no challenge
//   4. a stage with gadgets (Pharaoh's Gate, when the build has them): a drive is read
//      without a hitch whatever result.gadgets carries
//   5. on a second server with a short tee timeout: nobody says "next" and the ball is teed
//      up all the same
//
//   node tools/arcade-dev/duel-e2e.mjs [--port 18368] [--oc 19998] [--data .scratch/modes/data-b] [--no-spawn]
//
// Its own server (private ports and data dir, no downloads, no sound), stopped afterwards.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { makeCall, judge, gadgetList } = createRequire(import.meta.url)(path.join(repo, 'lib', 'duel.js'));
const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const PORT = +flag('--port', 18368);
const OC_PORT = +flag('--oc', 19998);
const DATA = path.resolve(repo, flag('--data', path.join('.scratch', 'modes', 'data-b')));
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
let serverLog = [];
async function startServer(env = {}) {
  if (!fs.existsSync(path.join(DATA, 'courses'))) throw new Error(`No courses in ${DATA}: build them first (node tools/arcade-holes/build.mjs --out ${path.relative(repo, DATA)})`);
  serverLog = [];
  child = spawn(process.execPath, ['server.js'], {
    cwd: repo,
    env: { ...process.env, BIRDIE_PORT: String(PORT), BIRDIE_OC_PORT: String(OC_PORT), BIRDIE_DATA_DIR: DATA, BIRDIE_ENRICH: '0', BIRDIE_SKY_PREFETCH: '0', BIRDIE_DUEL_TEE_MS: '0', BIRDIE_DUEL_DONE_MS: '0', BIRDIE_MATCH_READY_MS: '0', ...env },
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
const duel = async () => (await get('/api/duel')).duel;
async function phase(...phases) {
  for (let i = 0; i < 600; i++) {
    const s = await duel();
    if (s && phases.includes(s.phase)) return s;
    await sleep(50);
  }
  throw new Error(`the duel never reached ${phases.join(' / ')}`);
}
const who = (s, id) => s.players.find((p) => p.id === id);
const shots = (s) => s.players.reduce((n, p) => n + p.shots, 0);
const short = (s, id) => who(s, id).name.split(' ').pop();

const DRAW = { speed: 96, vla: 22, hla: 3, spin: 7200, spinAxis: -24 };      // about 135 yd, bending left
const SHORT = { speed: 78, vla: 27, hla: 0, spin: 8600, spinAxis: 0 };        // 100 yd and straight: no match for it
const DINK = { speed: 20, vla: 10, hla: 0, spin: 1500, spinAxis: 0 };         // a stray ball
const BOMB = { speed: 150, vla: 14, hla: 0, spin: 2800, spinAxis: 0 };        // 250 yd

// One ball by whoever is up: swing, read the state back, cross-check the verdict against lib/duel.js.
async function hit(ball, label) {
  const before = await duel();
  const up = before.currentPlayerId, role = before.role, n = shots(before);
  await post('/api/test-shot', ball);
  let s = null;
  for (let i = 0; i < 100; i++) { s = await duel(); if (s && shots(s) > n) break; await sleep(20); }
  if (!check(s && shots(s) === n + 1, `${label}: the ball was played and read`)) return { s, up, role, last: null };
  const l = s.last;
  check(l && l.playerId === up, `${label}: the verdict is on the player who hit`);
  const f = l.shot;
  if (role === 'challenge') {
    const mine = makeCall(f);
    check(mine.ok ? l.kind === 'call' && l.text === mine.text : l.kind === 'no-call' && l.reason === mine.reason, `${label}: the call is what the shot's numbers make it`, `${l.kind} ${l.text || l.reason} against ${mine.ok ? mine.text : mine.reason}`);
    if (l.kind === 'call') {
      const carry = l.parts[0];
      check(carry.id === 'carry' && carry.lo <= f.carryYd && carry.hi >= f.carryYd && carry.hi - carry.lo >= 16, `${label}: the carry and its tolerance lead the call`, JSON.stringify(carry));
      check(l.parts.length <= 3 && s.role === 'match' && s.call && s.call.text === l.text && s.currentPlayerId !== up, `${label}: the other player is up to match it`);
      check(judge({ parts: l.parts }, f).ok, `${label}: a call is always a match for its own shot`);
    } else check(s.role === 'challenge' && s.currentPlayerId !== up && s.round === before.round + 1 && s.call === null, `${label}: no call, the roles swap`);
  } else {
    const v = judge(before.call, f);
    check((l.kind === 'matched') === v.ok && JSON.stringify(l.checks) === JSON.stringify(v.checks), `${label}: the verdict is the judge's`, `${l.kind}: ${JSON.stringify(l.checks)}`);
    if (l.kind === 'letter') check(who(s, up).lettersCount === who(before, up).lettersCount + 1 && l.letter === s.word[who(before, up).lettersCount], `${label}: a letter, the next of the word`, `${l.letter} ${who(s, up).letters}`);
    else check(who(s, up).lettersCount === who(before, up).lettersCount, `${label}: matched, no letter`);
    if (s.phase === 'play') check(s.role === 'challenge' && s.currentPlayerId === up && s.challengerId === up && s.round === before.round + 1, `${label}: the roles swap: the one who answered calls next`);
  }
  return { s, up, role, last: l };
}

async function main() {
  if (SPAWN) await startServer();
  say(`server on ${BASE}, data ${path.relative(repo, DATA)}`);

  // ---------- 1. the lobby's data
  await post('/api/duel/abort');
  await post('/api/bullseye/abort');
  await post('/api/match/abort');
  const info = await get('/api/duel');
  check(info.ok === true && info.duel === null, 'no duel to begin with');
  check(info.stages.filter((x) => !x.arena).length >= 9 && info.stages.filter((x) => x.arena).length === 3, 'every stage of the tour, and the three arenas', `${info.stages.length} in all`);
  check(info.words.join() === 'CLASH,PIG,HORSE', 'the words');
  check(info.tolerances.carryPct === 0.1 && info.tolerances.duffYd === 40 && info.tolerances.roundsPerLetter === 4, 'the tolerances are there for the lobby to explain');
  const names = ['Duel Alex', 'Duel Sam'];
  let roster = (await get('/api/leagues')).players || [];
  for (const name of names) if (!roster.some((p) => p.name === name)) await post('/api/players', { name });
  roster = (await get('/api/leagues')).players || [];
  const [a, b] = names.map((name) => roster.find((p) => p.name === name).id);

  // ---------- 2. a duel for PIG at Thunder Dome
  say('a duel for PIG at Thunder Dome');
  let r = await post('/api/duel/start', { playerIds: [a, b], stage: 'thunder-dome', word: 'PIG', first: 0 });
  check(r.ok && r.duel.phase === 'loading', 'started: the stage is loading', r.error || '');
  let s = await phase('play');
  check(s.word === 'PIG' && s.maxRounds === 12 && s.round === 1 && s.role === 'challenge' && s.currentPlayerId === a && s.stage.kind === 'arena', 'round one, the first player calls');
  check(s.stage.wind && Number.isFinite(s.stage.wind.mph), 'the stage has its rolled wind', JSON.stringify(s.stage.wind && s.stage.wind.label));
  let g = await get('/api/state');
  check(g.lie === 'tee' && g.strokes === 0 && g.player && g.player.id === a, 'the challenger is on the tee');
  check((await post('/api/drop')).status === 409, 'no rescue drop in a duel');

  // the call
  let t = await hit(DRAW, 'R1 the call');
  s = t.s;
  say(`  ${short(s, a)} calls: ${s.call ? s.call.text : '(none)'}   [${t.last && t.last.shot ? `${t.last.shot.carryYd} yd, bend ${t.last.shot.curveYd} yd, apex ${t.last.shot.apexFt} ft, ${t.last.shot.finishFt} ft away` : ''}]`);
  check(t.last.kind === 'call' && t.last.shot.curveYd < -3, 'a ball hit with a draw is read as bending left', `${t.last.shot.curveYd} yd`);
  check(s.teed === false && s.waiting && s.waiting.for === 'tee', 'after a ball the duel waits to tee the next one up');
  g = await get('/api/state');
  check(g.distToPinYd < 80 && g.strokes === 0 && !g.holed, 'the ball is still where it finished', `${g.distToPinYd} yd`);
  r = await post('/api/duel/next');
  g = await get('/api/state');
  check(r.ok && r.duel.teed === true && g.lie === 'tee' && g.player.id === b, 'POST /next: the matcher is on the tee');
  // the answer: short and straight
  t = await hit(SHORT, 'R1 the answer');
  s = t.s;
  check(t.last.kind === 'letter' && t.last.letter === 'P' && t.last.checks[0].ok === false, 'a ball 35 yd short takes a letter', JSON.stringify(t.last.checks));
  say(`  ${short(s, b)}: ${t.last.checks.map((c) => `${c.ok ? 'ok' : 'NO'} ${c.want} (${c.got})`).join(', ')} > ${t.last.letter}`);

  // round two: the other player calls, and is matched (a swing before "next" is played all the same)
  t = await hit(DRAW, 'R2 the call');
  t = await hit(DRAW, 'R2 the answer');
  s = t.s;
  check(t.last.kind === 'matched', 'the same swing matches the call', JSON.stringify(t.last.checks));
  check(s.round === 3 && s.challengerId === a, 'round three: the first player calls again');

  // a stray ball by the challenger: marked, no call, and taken back
  t = await hit(DINK, 'R3 a stray ball');
  s = t.s;
  check(t.last.kind === 'no-call' && t.last.reason === 'duff' && s.undoable && s.undoable.stray === true && s.events.some((e) => e.type === 'stray-shot'), 'a 20 mph ball off the tee is marked a stray ball, and is no call');
  r = await post('/api/duel/undo');
  check(r.ok && r.undone.stray === true && r.duel.round === 3 && r.duel.role === 'challenge' && r.duel.currentPlayerId === a && who(r.duel, a).noCalls === 0, 'undo takes it back: the same round, the same challenger');
  check((await post('/api/duel/undo')).status === 409, 'one level of undo');

  // to the last letter: the first player calls a draw, the second answers short
  let guard = 0;
  while ((s = await duel()).phase === 'play' && guard++ < 30) {
    const up = s.currentPlayerId;
    await hit(up === a ? DRAW : (s.role === 'match' ? SHORT : DRAW), `R${s.round} ${short(s, up)} ${s.role}`);
  }
  s = await duel();
  check(s.phase === 'done' && s.reason === 'word' && s.loserId === b && s.winnerId === a && who(s, b).letters === 'PIG', 'first to spell the word has lost', `${s.phase} ${s.reason} ${who(s, a).letters}/${who(s, b).letters}`);
  check(s.history.length === s.round && s.history.every((h) => h.result === 'matched' || h.result === 'letter'), 'every round is in the history');
  say(`  ${short(s, a)} ${who(s, a).letters || '-'} · ${short(s, b)} ${who(s, b).letters || '-'}  after ${s.round} rounds`);
  const n = shots(s);
  await post('/api/test-shot', DRAW);
  await sleep(150);
  s = await duel();
  check(s.phase === 'done' && shots(s) === n, 'a swing on the result screen is dropped');
  r = await post('/api/duel/undo');
  check(r.ok && r.duel.phase === 'play' && r.duel.role === 'match' && who(r.duel, b).letters === 'PI' && r.duel.winnerId === null, 'undo from the result: the duel is on again, the letter is back');
  await hit(SHORT, 'the last answer again');
  s = await duel();
  check(s.phase === 'done' && s.loserId === b, 'and it ends the same way');
  r = await post('/api/duel/again');
  check(r.ok && r.duel.id !== s.id, 'PLAY AGAIN: a new duel');
  s = await phase('play');
  check(s.word === 'PIG' && s.stage.id === 'thunder-dome' && s.challengerId === b && s.players.every((p) => p.letters === ''), 'the same stage and word, the loser calls first');
  await hit(DRAW, 'again R1 the call');
  r = await post('/api/duel/restart');
  check(r.ok && r.duel.round === 1 && r.duel.challengerId === a && r.duel.history.length === 0 && r.duel.call === null, 'RESTART: from the top, the other player first');

  // ---------- 3. NO CALL: over the island into the lagoon
  say('no call at Bullseye Bay');
  r = await post('/api/duel/start', { playerIds: [a, b], stage: 'bullseye-bay', first: 0 });
  check(r.ok, 'a new start takes the bay from the duel in play', r.error || '');
  s = await phase('play');
  check(s.word === 'CLASH' && s.maxRounds === 20 && s.stage.id === 'bullseye-bay', 'CLASH by default: twenty rounds at most');
  t = await hit(BOMB, 'a ball in the lagoon');
  check(t.last.kind === 'no-call' && t.last.reason === 'hazard' && t.last.shot.clean === false, 'a lost ball is no call', JSON.stringify(t.last));
  check(t.s.players.every((p) => p.lettersCount === 0) && t.s.currentPlayerId === b && t.s.role === 'challenge', 'no letter for anyone, the other player calls');
  t = await hit({ speed: 80, vla: 27, hla: 0, spin: 8600, spinAxis: 0 }, 'a wedge at the island');
  say(`  ${t.last.kind === 'call' ? t.last.text : `no call (${t.last.reason})`}`);

  // ---------- 4. a stage with gadgets
  const gate = info.stages.find((x) => x.id === 'pharaohs-gate');
  if (gate) {
    say("a drive at Pharaoh's Gate");
    r = await post('/api/duel/start', { playerIds: [a, b], stage: 'pharaohs-gate', first: 0 });
    s = await phase('play');
    t = await hit(BOMB, 'a drive on a stage with gadgets');
    const met = t.last && t.last.shot ? t.last.shot.gadgets : null;
    check(Array.isArray(met) && met.every((x) => x.id && x.kind), 'the gadgets the ball met are read as { id, kind }', JSON.stringify(met));
    check(JSON.stringify(gadgetList({ gadgets: met })) === JSON.stringify(met), 'and read the same again');
    say(`  ${t.last.kind === 'call' ? t.last.text : `no call (${t.last.reason})`}   gadgets met: ${met && met.length ? met.map((x) => x.kind).join(', ') : 'none'}`);
  }
  // a match takes the bay
  r = await post('/api/match/start', { playerIds: [a, b], format: 'quick' });
  check(r.ok && (await duel()) === null, 'starting a match ends the duel', r.error || '');
  await post('/api/match/abort');

  // ---------- 5. the safety tee
  if (SPAWN) {
    await stopServer();
    await startServer({ BIRDIE_DUEL_TEE_MS: '300' });
    r = await post('/api/duel/start', { playerIds: [a, b], stage: 'thunder-dome', first: 0 });
    s = await phase('play');
    await post('/api/test-shot', DRAW);
    await sleep(80);
    s = await duel();
    check(s.teed === false && s.waiting && s.waiting.timeoutMs === 300, 'the duel waits 300 ms for "next"');
    await sleep(600);
    s = await duel();
    g = await get('/api/state');
    check(s.teed === true && g.lie === 'tee' && g.player.id === b, 'nobody said "next": the matcher is teed up by itself');
    await post('/api/duel/abort');
  }
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
