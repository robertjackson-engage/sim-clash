#!/usr/bin/env node
// A REAL match, end to end, against a private server: two players from the roster API, a
// best of three over HTTP, 'ready' / 'continue' posted as a client would, swings fired at
// POST /api/test-shot, and the 'match' state followed over SSE through course switches, a
// knockout, a tied hole into sudden death on an arena, and the result with its rewards.
// Then a rematch, an abort, and a quick match on stage 'current' (the same-hole shootout).
//
//   node tools/arcade-holes/build.mjs --out .scratch/match-engine/data     (once: the courses)
//   node tools/arcade-dev/match-e2e.mjs [--port 8315] [--oc 9945] [--data .scratch/match-engine/data]
//                                       [--no-spawn] [--verbose]
//
// It starts its own server (never the live game: private ports and data dir, no scenery
// downloads) and stops it afterwards; --no-spawn drives one that is already running on
// --port (start that one with BIRDIE_MATCH_READY_MS=3000 or the safety-timeout check waits 25 s).
// Exit code 0: every check held. The swings are played by a small bot that reads the
// match state: it picks a club for the distance, putts on the green, and misses on purpose
// when its player is meant to lose the hole.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { simulateShot } = require(path.join(repo, 'lib', 'physics.js'));

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const PORT = +flag('--port', 8315);
const OC_PORT = +flag('--oc', 9945);
const DATA = path.resolve(repo, flag('--data', path.join('.scratch', 'match-engine', 'data')));
const SPAWN = !args.includes('--no-spawn');
const VERBOSE = args.includes('--verbose');
const BASE = `http://127.0.0.1:${PORT}`;
const READY_MS = 3000;   // the spawned server's intro safety (25 s in the real game)

const t0 = Date.now();
const stamp = () => `${String(((Date.now() - t0) / 1000).toFixed(2)).padStart(7)}s`;
const say = (text) => console.log(`${stamp()}  ${text}`);
const failures = [];
let checks = 0;
function check(ok, what, detail = '') {
  checks++;
  if (ok) { if (VERBOSE) say(`  ok   ${what}`); return true; }
  failures.push(what);
  say(`  FAIL ${what}${detail ? `: ${detail}` : ''}`);
  return false;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the server ----------
let child = null;
const serverLog = [];
async function startServer(env = { BIRDIE_MATCH_READY_MS: String(READY_MS) }) {
  if (!fs.existsSync(path.join(DATA, 'courses'))) {
    throw new Error(`No courses in ${DATA}: run  node tools/arcade-holes/build.mjs --out ${path.relative(repo, DATA)}  first`);
  }
  serverLog.length = 0;
  stopping = false;
  child = spawn(process.execPath, ['server.js'], {
    cwd: repo,
    env: {
      ...process.env,
      BIRDIE_PORT: String(PORT), BIRDIE_OC_PORT: String(OC_PORT), BIRDIE_DATA_DIR: DATA,
      BIRDIE_ENRICH: '0', BIRDIE_SKY_PREFETCH: '0',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const keep = (buf) => { for (const line of String(buf).split(/\r?\n/)) if (line.trim()) { serverLog.push(line); if (VERBOSE) console.log(`           | ${line}`); } };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('exit', (code) => { if (code && code !== 0 && !stopping) say(`server exited with code ${code}`); });
  for (let i = 0; i < 150; i++) {
    if (serverLog.some((l) => l.includes('[HTTP] Open-Birdie UI'))) return;
    if (child.exitCode !== null) throw new Error(`the server did not start:\n${serverLog.join('\n')}`);
    await sleep(100);
  }
  throw new Error('the server did not come up within 15 s');
}
let stopping = false;
async function stopServer() {
  stopping = true;
  if (!child || child.exitCode !== null) return;
  const gone = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([gone, sleep(3000)]);
}

// ---------- HTTP and SSE ----------
const get = async (p) => (await fetch(BASE + p)).json();
const rawPost = async (p, body = {}) => (await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
// a match route's answer is ahead of the event stream: wait until the stream has that state too
async function post(p, body = {}) {
  const res = await rawPost(p, body);
  if (p.startsWith('/api/match/') && res && res.ok && 'match' in res) {
    const want = res.match;
    await waitFor((e) => e.event === 'match' && (want === null ? e.data === null : Boolean(e.data) && e.data.id === want.id && e.data.seq >= want.seq), Math.max(0, events.length - 30), 3000);
  }
  return res;
}

const events = [];   // every SSE event: { i, t, event, data }
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
          const event = (/^event: (.*)$/m.exec(chunk) || [])[1];
          const data = (/^data: (.*)$/m.exec(chunk) || [])[1];
          if (event) events.push({ i: events.length, t: Date.now(), event, data: data ? JSON.parse(data) : null });
        }
      }
    } catch (_) { /* closed */ }
  })();
  await waitFor((e) => e.event === 'match', 0, 3000);
}
async function waitFor(pred, from = 0, timeoutMs = 5000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    for (let i = from; i < events.length; i++) if (pred(events[i])) return events[i];
    if (Date.now() > until) return null;
    await sleep(15);
  }
}
// the newest match state the server sent
const matchNow = () => { for (let i = events.length - 1; i >= 0; i--) if (events[i].event === 'match') return events[i].data; return null; };
const waitPhase = (phase, from, timeoutMs = 20000) => waitFor((e) => e.event === 'match' && e.data && e.data.phase === phase, from, timeoutMs);
const phasesSeen = [];   // the phases in the order the server announced them
function notePhases(from) {
  for (let i = from; i < events.length; i++) {
    const e = events[i];
    if (e.event !== 'match') continue;
    const p = e.data ? `${e.data.phase}${e.data.phase === 'loading' || e.data.phase === 'intro' ? `(${(e.data.nextStage || e.data.stage).id})` : ''}` : 'none';
    if (phasesSeen[phasesSeen.length - 1] !== p) phasesSeen.push(p);
  }
  return events.length;
}

// ---------- the bot ----------
// a club for every distance: launch numbers along a driver-to-wedge curve, the total they
// make on flat ground, inverted
const CURVE = [[6, 30, 1000], [10, 30, 1500], [20, 30, 2500], [40, 30, 4000], [60, 30, 7000], [80, 27, 9000], [105, 21, 7900], [111, 19, 7000], [130, 15, 4500], [150, 13, 2700], [175, 12, 2500]];
function launchAt(speed) {
  for (let i = 0; i + 1 < CURVE.length; i++) {
    const a = CURVE[i], b = CURVE[i + 1];
    if (speed <= b[0]) {
      const f = Math.max(0, (speed - a[0]) / (b[0] - a[0]));
      return { speed, vla: a[1] + (b[1] - a[1]) * f, hla: 0, spin: a[2] + (b[2] - a[2]) * f, spinAxis: 0 };
    }
  }
  return { speed, vla: 12, hla: 0, spin: 2500, spinAxis: 0 };
}
const TABLE = [];
for (let s = 6; s <= 175; s += 1) {
  const l = launchAt(s);
  const sim = simulateShot({ speedMph: l.speed, vla: l.vla, hla: 0, totalSpin: l.spin, spinAxis: 0 }, { x: 0, y: 0 }, 0, () => 'fairway', {});
  TABLE.push([sim.totalYd, s]);
}
const forDistance = (yd) => launchAt((TABLE.find(([total]) => total >= yd) || TABLE[TABLE.length - 1])[1]);
// a putt at about the right pace; `miss`: 45 degrees off line (the putting assist pulls a
// stroke most of the way back, so only a wild one stays out)
const putt = (yd, miss = false) => ({ speed: Math.max(2, Math.sqrt(2 * 0.6 * (yd * 0.9144 + 0.35)) / 0.44704), vla: 0.5, hla: miss ? 45 : 0, spin: 100, spinAxis: 0 });
const MISSED_PUTT = { speed: 2.5, vla: 0.5, hla: 45, spin: 100, spinAxis: 0 };   // a yard or so, well wide
const DINK = { speed: 8, vla: 10, hla: 0, spin: 1000, spinAxis: 0 };
const MONSTER = { speed: 195, vla: 14, hla: 0, spin: 2400, spinAxis: 0 };

let shotsPlayed = 0;
let orderChecked = 0;
// One swing. -> { played, shot (the 'shot' event's data), match (the state after it) }
async function swing(launch, { expectIgnored = false, solo = false } = {}) {
  const mark = events.length;
  const before = expectIgnored ? (await get('/api/match')).match : matchNow();
  const res = await post('/api/test-shot', launch);
  check(res.ok === true, 'POST /api/test-shot answers ok');
  if (expectIgnored) {
    await sleep(250);
    const since = events.slice(mark).map((e) => e.event);
    check(!since.includes('shot') && !since.includes('arcade'), `a swing in '${before ? before.phase : 'no match'}' is dropped (no shot played)`, since.join(','));
    const now = (await get('/api/match')).match;
    check(same(now && now.seq, before && before.seq), `... and the match did not move (seq ${before && before.seq})`);
    return { played: false };
  }
  const state = await waitFor((e) => e.event === 'state', mark, 3000);
  const since = events.slice(mark, state ? state.i + 1 : events.length);
  const shot = since.find((e) => e.event === 'shot');
  if (!check(Boolean(shot), 'the swing was played', since.map((e) => e.event).join(','))) return { played: false };
  if (solo) return { played: true, shot: shot.data, match: null, order: since.map((e) => e.event) };
  shotsPlayed++;
  // the SSE order on a match shot: shot, arcade, match, state
  const order = since.map((e) => e.event).filter((e) => ['shot', 'arcade', 'match', 'state'].includes(e));
  if (check(same(order, ['shot', 'arcade', 'match', 'state']), 'SSE order on a match shot is shot, arcade, match, state', order.join(','))) orderChecked++;
  const m = since.find((e) => e.event === 'match');
  return { played: true, shot: shot.data, match: m ? m.data : matchNow() };
}

// Play the hole that is in 'play' until it is decided. plan: { [playerId]: 'make' | 'miss' }:
// 'miss' leaves every putt out on purpose (and so loses to a 'make').
async function playHole(plan, onShot = null) {
  let last = null;
  for (let guard = 0; guard < 40; guard++) {
    const m = matchNow();
    if (!m || m.phase !== 'play') return last;
    const me = m.players.find((p) => p.id === m.currentPlayerId);
    // a putt missed on purpose: the putting assist would pull even a wild stroke most of
    // the way back to the hole, so it is switched off for that one stroke
    const missing = me.lie === 'green' && plan[me.id] === 'miss';
    const launch = me.lie === 'green' ? (missing ? MISSED_PUTT : putt(me.distToPinYd)) : forDistance(me.distToPinYd);
    if (missing) await post('/api/arcade/settings', { assist: { putting: 'off' } });
    const r = await swing(launch);
    if (missing) await post('/api/arcade/settings', { assist: { putting: 'easy' } });
    if (!r.played) return last;
    const after = r.match.players.find((p) => p.id === me.id);
    say(`    ${me.name.padEnd(8)} ${me.lie === 'green' ? 'putts' : 'hits '} from ${String(me.distToPinYd).padStart(5)} yd (${me.lie}) -> ${after.holed ? 'IN' : `${after.distToPinYd} yd, ${after.lie}`}`
      + `  [${after.strokes}]${r.shot.penalty ? ' PENALTY' : ''}${r.shot.arcade && r.shot.arcade.callout ? `  "${r.shot.arcade.callout.text}"` : ''}${r.shot.match.event !== 'shot' ? `  => ${r.shot.match.event}` : ''}`);
    if (onShot) onShot(r, me);
    last = r;
  }
  check(false, 'the hole ended within 40 swings');
  return last;
}

// loading -> intro: wait for the stage to be in the bay; returns how long the switch took
async function awaitIntro(mark, sentAt, expectStageId = null) {
  const intro = await waitPhase('intro', mark, 30000);
  if (!check(Boolean(intro), `the stage ${expectStageId || ''} came up (intro)`)) return null;
  const ms = intro.t - sentAt;
  const course = events.slice(mark, intro.i).filter((e) => e.event === 'course').pop();
  if (expectStageId) check(intro.data.stage.id === expectStageId, `the intro is for ${expectStageId}`, intro.data.stage.id);
  return { state: intro.data, ms, course: course ? course.data : null };
}

// ---------- a rocket hole of our own ----------
// The contract's "rocket holes" (a stage with `freeBall`) and `routes` may not be in the
// built catalogue yet, so the run brings one: the tour's first stage copied under its own
// identity with `arcade.freeBall: 'rocket'`, routes on its hole and an entry of order 90 in
// the manifest (an "extra" stage: beyond the nine of the tour proper). Only in the private
// data dir, and taken out again at the end.
const ROCKET = { id: 'rocket-test', number: 90, file: 'osm-node-9900000000090.json', name: 'Rocket Test' };
const ROCKET_ROUTES = [
  { id: 'safe', name: 'The long way', note: 'Wide and dry.' },
  { id: 'risky', name: 'Over the lagoon', note: 'Carry it or swim.' },
  { id: 'rocket', name: 'The far shelf', note: 'Only a boosted ball gets there.' },
];
const TOUR_FILE = path.join(DATA, 'arcade-tour.json');
let tourBefore = null;
function addRocketHole() {
  tourBefore = fs.readFileSync(TOUR_FILE, 'utf8');
  const tour = JSON.parse(tourBefore);
  const from = tour.stages[0];
  const course = JSON.parse(fs.readFileSync(path.join(DATA, 'courses', from.file), 'utf8'));
  course.name = ROCKET.name;
  course.source = { courseId: `osm:node:${9900000000000 + ROCKET.number}`, osmType: 'node', osmId: 9900000000000 + ROCKET.number };
  course.arcade = { ...course.arcade, id: ROCKET.id, holes: [ROCKET.id], order: ROCKET.number, freeBall: 'rocket' };
  course.holes[0].routes = ROCKET_ROUTES;
  fs.writeFileSync(path.join(DATA, 'courses', ROCKET.file), JSON.stringify(course));
  tour.stages = tour.stages.filter((s) => s.id !== ROCKET.id);
  tour.stages.push({ ...from, id: ROCKET.id, order: ROCKET.number, number: ROCKET.number, file: ROCKET.file, name: ROCKET.name, freeBall: 'rocket', routes: ROCKET_ROUTES });
  fs.writeFileSync(TOUR_FILE, JSON.stringify(tour, null, 2));
}
function removeRocketHole() {
  if (tourBefore === null) return;
  try { fs.writeFileSync(TOUR_FILE, tourBefore); } catch (_) { /* leave it */ }
  try { fs.unlinkSync(path.join(DATA, 'courses', ROCKET.file)); } catch (_) { /* never written */ }
  tourBefore = null;
}

// ---------- the run ----------
async function main() {
  if (SPAWN) { say(`starting a private server on ${PORT} (Open Connect ${OC_PORT}), data ${path.relative(repo, DATA)}`); await startServer(); }
  if (SPAWN) addRocketHole();
  await openEvents();
  check(events.some((e) => e.event === 'match'), "the SSE stream carries 'match' on connect");
  await post('/api/match/abort');   // whatever an earlier run left

  // the tour and the roster
  const first = await get('/api/match');
  check(first.ok && first.match === null, 'GET /api/match: no match');
  check(first.tour && Array.isArray(first.tour.stages) && first.tour.stages.length >= 3, 'GET /api/match carries the tour', first.tour ? `${first.tour.stages.length} stages` : 'null');
  const arenas = first.tour ? first.tour.tiebreaks.map((a) => a.id) : [];
  say(`tour: ${first.tour.stages.length} stages (${first.tour.stages.map((s) => s.id).join(', ')}), ${arenas.length} arenas (${arenas.join(', ') || 'none'})`);
  check(first.profiles && typeof first.profiles === 'object', 'GET /api/match carries the profiles');
  const roster = (await get('/api/leagues')).players;
  const ids = [];
  for (const name of ['Alex', 'Dave']) {
    const have = roster.find((p) => p.name === name);
    if (have) { ids.push(have.id); continue; }
    const made = await post('/api/players', { name });
    check(made.ok && made.player && made.player.id, `POST /api/players adds ${name}`, JSON.stringify(made));
    ids.push(made.player.id);
  }
  const [A, B] = ids;
  const profilesBefore = (await get('/api/match')).profiles;
  check(['trophies', 'rank', 'wins', 'losses', 'streak', 'bestStreak', 'coins'].every((k) => k in profilesBefore[A]), 'a profile has trophies, rank, wins, losses, streak, bestStreak, coins', JSON.stringify(profilesBefore[A]));

  // The bay's arcade. On the private server it is wiped first (coins, streak, shelf), so every
  // run plays the same and the shelf holds no Windcutter: the match arms one all the same,
  // because a match loadout is not the bay's shelf. Tap-ins are off for the run, so a putt
  // missed on purpose stays out (the assists are put back at the end).
  const assists0 = (await get('/api/arcade')).assist;
  if (SPAWN) await post('/api/arcade/reset');
  const arcade0 = await get('/api/arcade');
  await post('/api/arcade/settings', { enabled: true, assist: { putting: 'easy', tapInFt: 0 } });
  const tricks = (arcade0.powerups || []).filter((p) => p.kind === 'trick').map((p) => p.id);
  const balls = (arcade0.powerups || []).filter((p) => p.kind !== 'trick').map((p) => p.id);
  // Windcutter: in the calm of the first stage it flies like a plain ball, so the script stays the same
  const notOwned = balls.includes('windcutter') ? 'windcutter' : balls[0];
  say(`catalogue: ${balls.length} balls, ${tricks.length} tricks${tricks.length ? ` (${tricks.join(', ')})` : ' (arcade-core has not landed any yet)'}`);

  // ---- a best of three ----
  say('START  best of 3, tour order');
  let mark = events.length;
  let sent = Date.now();
  const started = await post('/api/match/start', { playerIds: [A, B], format: 'bo3' });
  if (!check(started.ok === true, 'POST /api/match/start', JSON.stringify(started).slice(0, 200))) return;
  let m = started.match;
  const stage1 = first.tour.stages[0].id;
  check(m.phase === 'loading' && m.format === 'bo3' && m.target === 2 && m.maxHoles === 3 && m.stakes === null, 'it starts loading: bo3, first to 2, a friendly', `${m.phase} ${m.format}`);
  check(m.nextStage && m.nextStage.id === stage1 && m.stage.id === stage1, `the first stage of the tour is next (${stage1})`);
  check(same(m.events.map((e) => e.type), ['match-start', 'coin-flip']) && [A, B].includes(m.events[1].winnerId) && m.honourId === m.events[1].winnerId, 'match-start, then the coin flip names the honour');
  check(m.players.every((p) => p.charges === 3 && p.slot === (p.id === A ? 1 : 2)), 'three charges each; slots 1 and 2');
  check(m.options.tieRule === 'shootout' && m.options.powerups === 'loadout' && m.options.strokeCap === 3, 'default options: shootout, loadout, cap par + 3');
  const refused = await post('/api/match/start', { playerIds: [A, B], format: 'quick' });
  check(refused.ok === false && /in play/.test(refused.error), 'a second start is refused while one is in play');
  const honour1 = m.honourId, other1 = honour1 === A ? B : A;
  const nameOf = (id) => m.players.find((p) => p.id === id).name;
  say(`  toss: ${nameOf(honour1)} has the honour`);
  await swing(DINK, { expectIgnored: true });   // 'loading'
  const switches = [];
  let intro = await awaitIntro(mark, sent, stage1);
  switches.push([`start -> ${stage1}`, intro.ms]);
  say(`  ${intro.state.stage.name} in the bay after ${intro.ms} ms (par ${intro.state.stage.par}, ${intro.state.stage.lengthYd} yd)`);
  check(intro.course && intro.course.name === intro.state.stage.name, "the 'course' event announced the stage's course", JSON.stringify(intro.course));
  check((await get('/api/state')).courseName === intro.state.stage.name, 'the bay is on the stage course');
  check(intro.state.currentPlayerId === honour1 && intro.state.waiting.for === 'ready', 'intro: the honour is up, the server waits for ready');
  mark = notePhases(mark);

  // intro: arm a ball the bay does not own (the loadout is not the shelf), then a stray swing
  const armed = await post('/api/match/arm', { playerId: honour1, id: notOwned });
  check(armed.ok && armed.match.players.find((p) => p.id === honour1).armedPowerup === notOwned, `arm ${notOwned} from the loadout (the bay's shelf has ${(arcade0.inventory || {})[notOwned] || 0})`, JSON.stringify(armed).slice(0, 160));
  await swing(DINK, { expectIgnored: true });   // 'intro'
  m = matchNow();
  check(m.players.find((p) => p.id === honour1).armedPowerup === notOwned && m.players.find((p) => p.id === honour1).charges === 3, 'the dropped swing did not spend the armed ball');
  const again = await post('/api/match/arm', { playerId: honour1, id: 'no-such-ball' });
  check(again.ok === false, 'an unknown power-up is refused');
  // ... and a trick on the opponent (when the catalogue has one): it waits for their next swing
  let trick = null;
  if (tricks.length) {
    trick = tricks[0];
    const cast = await post('/api/match/arm', { playerId: honour1, id: trick });
    const victim = cast.ok ? cast.match.players.find((p) => p.id === other1) : null;
    const caster = cast.ok ? cast.match.players.find((p) => p.id === honour1) : null;
    check(cast.ok && victim.cursedWith === trick && cast.match.events.some((e) => e.type === 'trick-cast' && e.id === trick && e.targetId === other1), `${trick}: cast on the opponent, who is cursedWith it`, JSON.stringify(cast).slice(0, 160));
    check(cast.ok && caster.charges === 2 && same(caster.usedPowerups, [trick]) && caster.armedPowerup === notOwned && caster.cursedWith === null, 'the cast cost a charge at once; the armed ball is still armed');
  }

  let r = await post('/api/match/ready');
  check(r.ok && r.match.phase === 'play' && r.match.currentPlayerId === honour1, "POST /api/match/ready: 'play', the honour tees off");
  check((await post('/api/match/ready')).match.phase === 'play', 'a second ready changes nothing');
  check((await post('/api/mulligan')).ok === false, 'no mulligans in a match');
  check((await post('/api/next-hole')).ok === false, 'next-hole is refused while a match is in play');

  // hole 1: the honour makes, the other misses: a knockout
  say(`HOLE 1  ${intro.state.stage.name}: ${nameOf(honour1)} to win by knockout`);
  let sawMustHole = false, firstShot = null, cursedShot = null;
  let last = await playHole({ [honour1]: 'make', [other1]: 'miss' }, (res, me) => {
    if (!firstShot) firstShot = res;
    if (!cursedShot && me.id === other1) cursedShot = res;
    if (res.match.events.some((e) => e.type === 'must-hole')) sawMustHole = true;
  });
  check(firstShot && firstShot.shot.match.playerId === honour1 && firstShot.shot.match.powerup === notOwned && same(firstShot.shot.match.curses, []), `the first swing carried the ${notOwned} ball`, firstShot ? JSON.stringify(firstShot.shot.match).slice(0, 120) : '');
  check(firstShot && firstShot.shot.arcade && firstShot.shot.arcade.powerup === notOwned, '... and the arcade graded it as that ball');
  const p1 = firstShot.match.players.find((p) => p.id === honour1);
  check(p1.charges === (trick ? 1 : 2) && same(p1.usedPowerups, trick ? [trick, notOwned] : [notOwned]) && p1.armedPowerup === null, 'a charge spent with the swing, the id used, nothing armed', JSON.stringify([p1.charges, p1.usedPowerups]));
  if (trick) check(cursedShot && same(cursedShot.shot.match.curses, [trick]) && cursedShot.shot.match.powerup === null && cursedShot.match.players.find((p) => p.id === other1).cursedWith === null, `the opponent's next swing carried ${trick} and spent it`, cursedShot ? JSON.stringify(cursedShot.shot.match).slice(0, 120) : '');
  const shelf = (await get('/api/arcade'));
  check(shelf.armed === arcade0.armed && (shelf.inventory[notOwned] || 0) >= ((arcade0.inventory || {})[notOwned] || 0), "the bay's shelf was not touched by the match shot");
  m = matchNow();
  check(m.phase === 'hole-result', "hole 1 is decided: 'hole-result'", m.phase);
  check(m.lastResult.winnerId === honour1 && m.lastResult.reason === 'knockout', `hole 1: ${nameOf(honour1)} by knockout`, JSON.stringify(m.lastResult));
  check(sawMustHole || m.lastResult.scores[other1] >= m.lastResult.scores[honour1], 'the loser was out with N (or had to hole at N-1)');
  if (sawMustHole) say('    (the loser had one swing to stay alive: must-hole)');
  check(m.standings === `${nameOf(honour1)} 1 UP` && m.matchPoint === honour1, 'standings and match point', `${m.standings} / ${m.matchPoint}`);
  const stage2 = first.tour.stages[1].id;
  check(m.nextStage && m.nextStage.id === stage2 && m.nextStage.kind === 'match', `next: ${stage2}`);
  check(m.players.find((p) => p.id === honour1).stats.shots >= 2 && m.players.find((p) => p.id === honour1).stats.points > 0, 'stats: shots and arcade points counted');
  await swing(DINK, { expectIgnored: true });   // 'hole-result'
  mark = notePhases(mark);

  // continue: the course switches
  sent = Date.now();
  r = await post('/api/match/continue');
  check(r.ok && r.match.phase === 'loading' && r.match.holeNumber === 2 && r.match.nextStage.id === stage2, "POST /api/match/continue: 'loading' hole 2");
  intro = await awaitIntro(mark, sent, stage2);
  switches.push([`${stage1} -> ${stage2}`, intro.ms]);
  say(`  ${intro.state.stage.name} in the bay after ${intro.ms} ms`);
  check((await get('/api/state')).courseName === intro.state.stage.name, 'the bay switched to the stage course');
  check(intro.state.honourId === honour1 && intro.state.currentPlayerId === honour1, 'the winner of hole 1 has the honour');
  check(intro.state.events.some((e) => e.type === 'match-point' && e.playerId === honour1), 'a match-point event for the leader');
  if (trick) {
    const twice = await post('/api/match/arm', { playerId: honour1, id: trick });
    check(twice.ok === false && /already used/.test(twice.error), 'each id once per match', JSON.stringify(twice).slice(0, 120));
  }
  mark = notePhases(mark);
  await post('/api/match/ready');

  // hole 2: both play the same shots: tied, so sudden death
  say(`HOLE 2  ${intro.state.stage.name}: both make: a tie`);
  last = await playHole({ [A]: 'make', [B]: 'make' });
  m = matchNow();
  let tiedHole = m.lastResult && m.lastResult.reason === 'tied';
  if (!tiedHole) {
    // the two balls did not finish alike (wind, a trick): play on, the match is still a match
    say(`    (not tied: ${JSON.stringify(m.lastResult.scores)}, ${m.lastResult.reason})`);
  }
  check(tiedHole, 'hole 2 is tied', JSON.stringify(m.lastResult));
  let tiebreakSeen = false;
  if (tiedHole) {
    check(m.phase === 'hole-result' && m.lastResult.winnerId === null && m.nextStage.kind === 'tiebreak', "'hole-result' with reason 'tied' and a tiebreak next");
    const realArena = arenas.includes(m.nextStage.id);
    check(arenas.length ? realArena : m.nextStage.id === 'shootout', arenas.length ? `sudden death goes to a real arena (${m.nextStage.id})` : 'no arenas built: the same-hole shootout');
    check(m.events.some((e) => e.type === 'hole-tied'), 'a hole-tied event');
    const arena = m.nextStage;
    mark = notePhases(mark);
    sent = Date.now();
    r = await post('/api/match/continue');
    check(r.ok && r.match.phase === 'loading' && r.match.holeNumber === 2, "continue: 'loading' the arena, still hole 2");
    intro = await awaitIntro(mark, sent, arena.id);
    switches.push([`${stage2} -> ${arena.id} (arena)`, intro.ms]);
    say(`  SUDDEN DEATH at ${intro.state.stage.name} after ${intro.ms} ms (${intro.state.stage.lengthYd} yd)`);
    check((await get('/api/state')).courseName === arena.name, 'the bay is on the arena');
    check(intro.state.stage.kind === 'tiebreak' && intro.state.tiebreak && intro.state.tiebreak.round === 1 && intro.state.tiebreak.arenaId === arena.id, 'intro of the tiebreak: round 1 on the arena');
    await swing(DINK, { expectIgnored: true });   // 'intro'
    // no 'ready' this time: the server readies itself after its safety timeout
    mark = notePhases(mark);
    const auto = await waitPhase('tiebreak', mark, 30000);
    check(Boolean(auto), "with no ready from the client the server starts the tiebreak itself (the safety timeout)");
    if (auto) say(`  the server readied itself ${auto.t - intro.state.waiting.since} ms after the intro began (timeout ${intro.state.waiting.timeoutMs} ms)`);
    check(matchNow().events.some((e) => e.type === 'tiebreak-start'), 'a tiebreak-start event');
    tiebreakSeen = true;

    // round 1: both go for the moon. Water or out of bounds on both: again.
    // Then the player who lost hole 1 goes at the pin and the other dinks it.
    let monsters = true;
    const ledOff = {};   // who hit first in each round
    for (let guard = 0; guard < 12; guard++) {
      m = matchNow();
      if (m.phase !== 'tiebreak') break;
      const me = m.players.find((p) => p.id === m.currentPlayerId);
      const round = m.tiebreak.round;
      ledOff[round] ||= me.id;
      const mine = monsters ? MONSTER : me.id === other1 ? forDistance(me.distToPinYd) : DINK;
      const res = await swing(mine);
      if (!res.played) break;
      const tb = res.shot.match;
      say(`    round ${round}: ${me.name.padEnd(8)} ${monsters ? 'smashes it' : me.id === other1 ? 'goes at the pin' : 'dinks it'} -> ${tb.miss ? `MISS (${tb.miss})` : `${tb.ft} ft`}${tb.again ? '  => level: again' : ''}${tb.event !== 'tiebreak-shot' ? `  => ${tb.event}` : ''}`);
      if (tb.miss == null && monsters) monsters = false;        // somebody is on land: play it properly
      if (tb.again) {
        monsters = false;
        check(res.match.tiebreak.round === round + 1 && res.match.tiebreak.pending.length === 2 && res.match.tiebreak.pending[0] !== ledOff[round]
          && res.match.events.some((e) => e.type === 'tiebreak-again'), 'both missed: another round, the other player first', JSON.stringify(res.match.tiebreak.pending));
      }
    }
    m = matchNow();
    const hole2 = m.holeResults[1];
    check(hole2.reason === 'tiebreak' && hole2.winnerId && hole2.tiebreak && hole2.tiebreak.arenaId === arena.id && hole2.tiebreak.rounds.length >= 1, "the tied hole's result is rewritten: reason 'tiebreak', a winner, the rounds", JSON.stringify(hole2));
    check(m.holeResults.length === 2, 'no extra result for the tiebreak');
    say(`    ${nameOf(hole2.winnerId)} takes hole 2 in sudden death (${JSON.stringify(hole2.tiebreak.rounds)})`);
  }

  // hole 3 if it is 1-1
  m = matchNow();
  if (m.phase === 'hole-result') {
    const stage3 = m.nextStage.id;
    check(m.matchPoint === 'both' || m.matchPoint === honour1 || m.matchPoint === other1, 'match point on the result screen', String(m.matchPoint));
    mark = notePhases(mark);
    sent = Date.now();
    await post('/api/match/continue');
    intro = await awaitIntro(mark, sent, stage3);
    switches.push([`-> ${stage3}`, intro.ms]);
    say(`  ${intro.state.stage.name} in the bay after ${intro.ms} ms`);
    const st = await get('/api/state');
    check(st.courseName === intro.state.stage.name, 'the bay switched to the third stage');
    say(`    wind on this stage: ${st.conditions.windMph} mph (preset ${st.conditions.presetId || 'custom'})`);
    // the honour is to win: level on the green, the honour putts first and holes it, so
    // the other has exactly one swing to stay alive (must-hole) and leaves it out
    const honour3 = intro.state.honourId, loser3 = honour3 === A ? B : A;
    check(honour3 === intro.state.holeResults[1].winnerId, 'the sudden-death winner has the honour');
    mark = notePhases(mark);
    await post('/api/match/ready');
    say(`HOLE 3  ${intro.state.stage.name}: ${nameOf(honour3)} to win`);
    let mustHole3 = null;
    await playHole({ [honour3]: 'make', [loser3]: 'miss' }, (res) => {
      const ev = res.match.events.find((e) => e.type === 'must-hole');
      if (ev && res.shot.match.mustHole) mustHole3 = res.match.players.find((p) => p.id === ev.playerId);
    });
    m = matchNow();
    const hole3 = m.holeResults[2];
    check(hole3 && hole3.winnerId === honour3 && hole3.reason === 'knockout', `hole 3: ${nameOf(honour3)} by knockout`, JSON.stringify(hole3));
    if (mustHole3) {
      say(`    (${mustHole3.name} was out with N-1: one swing to stay alive, mustHole)`);
      check(mustHole3.id === loser3 && mustHole3.mustHole === true && hole3.scores[loser3] === hole3.scores[honour3], 'knockout at N-1: mustHole on the player, one swing, then out with N', JSON.stringify(hole3.scores));
    } else {
      check(hole3 && hole3.scores[loser3] >= hole3.scores[honour3], 'knockout at N: the loser had already taken as many', hole3 ? JSON.stringify(hole3.scores) : '');
    }
  }

  // ---- the result ----
  m = matchNow();
  mark = notePhases(mark);
  if (!check(m.phase === 'done' && m.winnerId && m.loserId, "the match is 'done'", m.phase)) return;
  const W = m.winnerId, Lo = m.loserId;
  say(`RESULT ${nameOf(W)} wins ${m.players.find((p) => p.id === W).holesWon}-${m.players.find((p) => p.id === Lo).holesWon} (${m.reason}); holes: ${m.holeResults.map((h) => `${h.stageId}: ${nameOf(h.winnerId)} by ${h.reason}`).join('; ')}`);
  check(['holes', 'tiebreak'].includes(m.reason) && m.players.find((p) => p.id === W).holesWon === 2, 'first to 2 holes');
  check(m.waiting && m.waiting.for === 'dismiss' && m.currentPlayerId === null, "done: nobody is up, the server waits to be dismissed");
  check(m.events[m.events.length - 1].type === 'match-over' && m.events.length <= 12, 'match-over is the last event; at most twelve are kept');
  const seqs = events.filter((e) => e.event === 'match' && e.data && e.data.id === m.id).map((e) => e.data.seq);
  check(seqs.every((s, i) => i === 0 || s >= seqs[i - 1]) && new Set(seqs).size > 10, 'seq never went backwards across the match');
  const rw = m.rewards;
  const streakBonus = Math.min(15, profilesBefore[W].streak * 5);
  check(rw && rw.winner.trophies === 20 + streakBonus && rw.winner.coins === 250 && rw.winner.chest.length === 2, `rewards: +${20 + streakBonus} trophies (20 for a bo3${streakBonus ? ` + ${streakBonus} streak` : ''}), 250 coins, a chest of two`, JSON.stringify(rw));
  check(rw.loser.trophies === -Math.min(10, profilesBefore[Lo].trophies), 'the loser drops 10, never below 0', JSON.stringify(rw.loser));
  check(rw.winner.chest.every((id) => balls.includes(id)), 'the chest holds balls of the catalogue', rw.winner.chest.join(','));
  check(Array.isArray(m.awards) && m.awards.length >= 1 && m.awards.every((a) => a.id && a.label && a.value && [A, B].includes(a.playerId)), 'awards with real values', JSON.stringify(m.awards));
  say(`  rewards: ${JSON.stringify(rw)}`);
  say(`  awards: ${m.awards.map((a) => `${a.label} ${nameOf(a.playerId)} ${a.value}`).join(' | ')}`);
  const after = await get('/api/match');
  check(after.match && after.match.phase === 'done' && after.tour && after.profiles, 'GET /api/match: the finished match, the tour, the profiles');
  const pw = after.profiles[W], pl = after.profiles[Lo];
  check(pw.trophies === profilesBefore[W].trophies + rw.winner.trophies && pw.wins === profilesBefore[W].wins + 1 && pw.streak === profilesBefore[W].streak + 1
    && pw.bestStreak >= pw.streak && pw.coins === profilesBefore[W].coins + 250, "the winner's profile: trophies, a win, the streak, coins", `${JSON.stringify(profilesBefore[W])} -> ${JSON.stringify(pw)}`);
  check(pl.trophies === Math.max(0, profilesBefore[Lo].trophies + rw.loser.trophies) && pl.losses === profilesBefore[Lo].losses + 1 && pl.streak === 0, "the loser's profile: the drop, a loss, streak 0", `${JSON.stringify(profilesBefore[Lo])} -> ${JSON.stringify(pl)}`);
  check(same(after.match.players.find((p) => p.id === W).profile, pw), 'the state carries the live profile');
  const ledger = JSON.parse(fs.readFileSync(path.join(DATA, 'match-ledger.json'), 'utf8'));
  check(same(ledger[W], pw) && same(ledger[Lo], pl), 'the profiles are on disk (match-ledger.json)');
  const lastArcade = [...events].reverse().find((e) => e.event === 'arcade');
  const shelfAfter = await get('/api/arcade');
  const gained = (id) => (shelfAfter.inventory[id] || 0) - (lastArcade.data.state.inventory[id] || 0);
  check(rw.winner.chest.every((id) => gained(id) >= 1) && shelfAfter.coins === lastArcade.data.state.coins + 250, "the chest is on the bay's shelf and its coins in the bay's wallet", `${JSON.stringify(lastArcade.data.state.inventory)} -> ${JSON.stringify(shelfAfter.inventory)}, coins ${lastArcade.data.state.coins} -> ${shelfAfter.coins}`);
  await swing(DINK, { expectIgnored: true });   // 'done'
  check((await post('/api/match/concede', { playerId: A })).ok === false, 'a finished match cannot be conceded');

  // ---- rematch, then abort ----
  mark = events.length;
  sent = Date.now();
  r = await post('/api/match/rematch');
  check(r.ok && r.match.id !== m.id && r.match.phase === 'loading' && r.match.format === 'bo3' && r.match.holeNumber === 1 && same(r.match.players.map((p) => p.id), [A, B]), 'POST /api/match/rematch: a new bo3, the same players');
  check(r.match.players.every((p) => p.holesWon === 0 && p.charges === 3 && p.usedPowerups.length === 0), '... with a clean slate');
  intro = await awaitIntro(mark, sent, stage1);
  if (intro) switches.push([`rematch -> ${stage1}`, intro.ms]);
  mark = notePhases(mark);
  r = await post('/api/match/concede', { playerId: B });
  check(r.ok && r.match.phase === 'done' && r.match.reason === 'concede' && r.match.winnerId === A && r.match.concededBy === B, 'POST /api/match/concede: the other player wins');
  check(r.match.rewards.winner.trophies === 20 + Math.min(15, after.profiles[A].streak * 5), 'a concession pays the same rewards');
  mark = events.length;
  r = await post('/api/match/abort');
  check(r.ok && r.match === null, 'POST /api/match/abort dismisses it');
  check(Boolean(await waitFor((e) => e.event === 'match' && e.data === null, mark, 2000)), "'match' null was broadcast");
  let st = await get('/api/state');
  check(st.loaded && st.strokes === 0 && st.holed === false && st.lie === 'tee', 'the bay stays on the last stage with a fresh hole', `${st.courseName}, strokes ${st.strokes}`);
  r = await swing(DINK, { solo: true });   // no match: an ordinary round shot again
  check(r.played && !r.shot.match && !r.order.includes('match'), 'with no match a swing carries no match');
  st = await get('/api/state');
  check(st.strokes === 1, 'with no match a swing is a round shot again', `strokes ${st.strokes}`);

  // ---- stakes (the optional extra): entry fees into escrow, refunded on abort, the pot to the winner ----
  say('STAKES a Rookie match (50 coins each): aborted, then conceded');
  const escrowFile = path.join(DATA, 'match-escrow.json');
  let bank = (await get('/api/match')).profiles;
  r = await post('/api/match/start', { playerIds: [A, B], format: 'quick', stage: 'current', stakes: 'rookie' });
  check(r.ok && same(r.match.stakes, { tier: 'rookie', tierLabel: 'Rookie', entryFee: 50, pot: 100 }), 'a staked match carries its stakes', r.ok ? JSON.stringify(r.match.stakes) : r.error);
  let held = (await get('/api/match')).profiles;
  check(held[A].coins === bank[A].coins - 50 && held[B].coins === bank[B].coins - 50 && fs.existsSync(escrowFile), 'both entry fees are taken and held in escrow (match-escrow.json)');
  await post('/api/match/abort');
  held = (await get('/api/match')).profiles;
  check(held[A].coins === bank[A].coins && held[B].coins === bank[B].coins && !fs.existsSync(escrowFile), 'aborted: the fees are refunded, the escrow is gone');
  await post('/api/match/start', { playerIds: [A, B], format: 'quick', stage: 'current', stakes: 'rookie' });
  r = await post('/api/match/concede', { playerId: B });
  const paid = (await get('/api/match')).profiles;
  check(r.ok && r.match.rewards.winner.pot === 100 && r.match.rewards.winner.coins === 200 && r.match.rewards.winner.trophies === 20 + Math.min(15, bank[A].streak * 5)
    && r.match.rewards.loser.trophies === -Math.min(20, bank[B].trophies), "decided: the tier's trophies both ways, the pot on top of the quick match's 100 coins", JSON.stringify(r.match.rewards));
  check(paid[A].coins === bank[A].coins - 50 + 200 && paid[B].coins === bank[B].coins - 50 && !fs.existsSync(escrowFile), 'the winner is paid the pot, the escrow is released', `${bank[A].coins} -> ${paid[A].coins}, ${bank[B].coins} -> ${paid[B].coins}`);
  const poor = await post('/api/match/start', { playerIds: [A, B], format: 'quick', stage: 'current', stakes: 'master' });
  check(poor.ok === false && /entry fee/.test(poor.error), 'a player who cannot cover the entry fee cannot start a staked match', JSON.stringify(poor).slice(0, 120));
  await post('/api/match/abort');
  check((await get('/api/state')).strokes === 1, 'the round under those matches is as it was');

  // ---- stage 'current': the loaded course, and the same-hole shootout ----
  say("QUICK  stage 'current' on the loaded course, tied on purpose");
  mark = events.length;
  r = await post('/api/match/start', { playerIds: [B, A], format: 'quick', stage: 'current', powerups: 'off' });
  check(r.ok && r.match.phase === 'intro' && r.match.stage.kind === 'current' && r.match.players[0].id === B && r.match.players[0].slot === 1, "stage 'current': straight to the intro, no course to load", r.ok ? r.match.phase : r.error);
  check(!events.slice(mark).some((e) => e.event === 'course'), 'no course was loaded');
  check((await post('/api/match/arm', { playerId: A, id: balls[0] })).ok === false, "powerups 'off': arming is refused");
  await post('/api/match/ready');
  await playHole({ [A]: 'make', [B]: 'make' });
  m = matchNow();
  if (check(m.phase === 'hole-result' && m.lastResult.reason === 'tied' && m.nextStage.id === 'shootout' && m.nextStage.kind === 'tiebreak', "tied: the same-hole shootout is next (stage 'current' never leaves the course)", JSON.stringify(m.lastResult))) {
    mark = events.length;
    r = await post('/api/match/continue');
    check(r.ok && r.match.phase === 'intro' && r.match.tiebreak && r.match.tiebreak.arenaId === null && !events.slice(mark).some((e) => e.event === 'course'), 'continue: the shootout intro on the same course, nothing loaded');
    await post('/api/match/ready');
    for (let guard = 0; guard < 8 && matchNow().phase === 'tiebreak'; guard++) {
      const now = matchNow();
      const me = now.players.find((p) => p.id === now.currentPlayerId);
      const res = await swing(me.id === A ? forDistance(me.distToPinYd) : DINK);
      if (!res.played) break;
      say(`    ${me.name.padEnd(8)} from ${now.tiebreak.spotYd} yd -> ${res.shot.match.miss ? `MISS (${res.shot.match.miss})` : `${res.shot.match.ft} ft`}`);
    }
    m = matchNow();
    check(m.phase === 'done' && m.reason === 'tiebreak' && m.rewards.winner.trophies >= 10 && m.rewards.winner.chest.length === 2, 'the shootout decides the quick match; a quick win pays 10 trophies', `${m.phase} ${m.reason}`);
    say(`    ${nameOf(m.winnerId)} wins the shootout`);
  }
  await post('/api/match/abort');
  st = await get('/api/state');
  check(st.strokes === 1, "abort puts the round back as it was before the stage 'current' match", `strokes ${st.strokes}`);

  // ---- a rocket hole: a free ball on every first stroke, in a match and in solo play ----
  const rocket = first.tour.stages.find((s) => s.freeBall);
  if (!rocket) {
    say('ROCKET no stage with a freeBall in this tour: not checked here (test/match.test.js covers the engine)');
  } else {
    say(`ROCKET ${rocket.name}: a free ${rocket.freeBall} on every tee shot`);
    check(first.tour.stages.length > 9 ? rocket.order > 9 : true, 'the rocket hole is an extra stage (order beyond 9) and was not part of the tour-order series above');
    mark = events.length;
    sent = Date.now();
    r = await post('/api/match/start', { playerIds: [A, B], format: 'quick', stage: rocket.id });
    check(r.ok && r.match.nextStage.id === rocket.id && r.match.nextStage.freeBall === rocket.freeBall && r.match.stage.freeBall === rocket.freeBall, 'a quick match on the extra stage: stage and nextStage carry freeBall', r.ok ? JSON.stringify(r.match.nextStage) : r.error);
    check(Array.isArray(r.match.stage.routes) && r.match.stage.routes.length === (rocket.routes || []).length && r.match.stage.routes.every((x) => x.id && x.name), 'routes are passed through on the stage', JSON.stringify(r.match.stage.routes));
    intro = await awaitIntro(mark, sent, rocket.id);
    check(intro.state.stage.freeBall === rocket.freeBall && same(intro.state.stage.routes, r.match.stage.routes), 'the intro still carries them (now from the course in the bay)');
    const up = intro.state.honourId, down = up === A ? B : A;
    await post('/api/match/arm', { playerId: up, id: notOwned });   // a ball of their own, for later
    await post('/api/match/ready');
    const shelf0 = await get('/api/arcade');
    let res = await swing(DINK);
    let me = res.match.players.find((p) => p.id === up);
    check(res.shot.match.playerId === up && res.shot.match.powerup === rocket.freeBall && res.shot.match.free === true && res.shot.freeBall === rocket.freeBall && res.shot.arcade.powerup === rocket.freeBall,
      `the tee shot is played with the free ${rocket.freeBall}`, JSON.stringify(res.shot.match).slice(0, 140));
    check(me.charges === 2 && me.usedPowerups.length === 0 && me.armedPowerup === notOwned, 'no charge, not in usedPowerups, their own armed ball kept', JSON.stringify([me.charges, me.usedPowerups, me.armedPowerup]));
    res = await swing(DINK);
    me = res.match.players.find((p) => p.id === down);
    check(res.shot.match.playerId === down && res.shot.match.powerup === rocket.freeBall && res.shot.match.free === true && me.charges === 2 && me.usedPowerups.length === 0, "the other player's tee shot is free too");
    // second strokes are ordinary: nothing for free, and the ball armed earlier rides now
    let own = null;
    for (let guard = 0; guard < 4 && !own && matchNow().phase === 'play'; guard++) {
      const who = matchNow().currentPlayerId;
      res = await swing(DINK);
      check(res.shot.match.free === false && !res.shot.freeBall, 'a second stroke is not free');
      if (who === up) own = res;
    }
    check(own && own.shot.match.powerup === notOwned && own.match.players.find((p) => p.id === up).charges === 1 && same(own.match.players.find((p) => p.id === up).usedPowerups, [notOwned]), `... and the ${notOwned} they armed rides on their second stroke, for a charge`);
    const shelf1 = await get('/api/arcade');
    check(same(shelf1.inventory, shelf0.inventory) || Object.keys(shelf0.inventory).every((id) => (shelf1.inventory[id] || 0) >= shelf0.inventory[id]), "the bay's shelf gave nothing to those shots");
    await post('/api/match/abort');

    // solo: the bay is on the rocket hole with a fresh hole
    st = await get('/api/state');
    check(st.courseName === rocket.name && st.strokes === 0, 'solo: the bay stays on the rocket hole, a fresh hole');
    const mine = Object.keys(shelf1.inventory).find((id) => id !== rocket.freeBall && shelf1.inventory[id] > 0);
    if (mine) await rawPost('/api/arcade/arm', { id: mine });
    const soloBefore = await get('/api/arcade');
    res = await swing(DINK, { solo: true });
    let soloAfter = await get('/api/arcade');
    check(res.played && res.shot.freeBall === rocket.freeBall && res.shot.arcade.powerup === rocket.freeBall && !res.shot.match, `solo: the first stroke is played with the free ${rocket.freeBall}`, res.played ? JSON.stringify([res.shot.freeBall, res.shot.arcade.powerup]) : '');
    check(soloAfter.armed === soloBefore.armed && Object.keys(soloBefore.inventory).every((id) => (soloAfter.inventory[id] || 0) >= soloBefore.inventory[id]), "solo: the bay's shelf and its armed ball are untouched", `${soloBefore.armed} ${JSON.stringify(soloBefore.inventory)} -> ${soloAfter.armed} ${JSON.stringify(soloAfter.inventory)}`);
    res = await swing(DINK, { solo: true });
    soloAfter = await get('/api/arcade');
    check(res.played && !res.shot.freeBall && res.shot.arcade.powerup === (mine || null), 'solo: the second stroke is an ordinary one (the armed ball, if any)', res.played ? JSON.stringify([res.shot.freeBall || null, res.shot.arcade.powerup]) : '');
    if (mine) check((soloAfter.inventory[mine] || 0) === soloBefore.inventory[mine] - 1 || soloAfter.unlimited, '... taken from the shelf as usual');
    await rawPost('/api/arcade/arm', { id: null });
  }
  removeRocketHole();

  // put the bay's assists back
  await post('/api/arcade/settings', { assist: assists0 });

  say('');
  phasesSeen.length = 0;
  notePhases(0);
  say(`phases, in the order the server announced them:\n           ${phasesSeen.join(' > ')}`);
  say(`course switches (POST to intro): ${switches.map(([what, ms]) => `${what} ${ms} ms`).join(' | ')}`);
  const loads = serverLog.filter((l) => l.includes('[match]') && l.includes('in the bay'));
  if (loads.length) say(`server-side (activate to stageReady): ${loads.map((l) => l.replace('[match] ', '')).join(' | ')}`);
  say(`swings played ${shotsPlayed}; SSE order shot, arcade, match, state held on ${orderChecked} of them`);
  return [A, B];
}

// The safety timeouts, on a second server whose screens time out in well under a second:
// a client that never answers. Nobody posts ready or continue, nobody dismisses the result.
async function timeouts([A, B]) {
  const T = { ready: 400, cont: 500, done: 700 };
  say('');
  say(`TIMEOUTS  a server with ready ${T.ready} ms, continue ${T.cont} ms, dismiss ${T.done} ms, and a client that never answers`);
  sseAbort.abort();
  await stopServer();
  events.length = 0;
  await startServer({ BIRDIE_MATCH_READY_MS: String(T.ready), BIRDIE_MATCH_CONTINUE_MS: String(T.cont), BIRDIE_MATCH_DONE_MS: String(T.done) });
  await openEvents();
  await rawPost('/api/arcade/settings', { assist: { putting: 'easy', tapInFt: 0 } });
  const took = (from, to) => (from && to ? to.t - from.t : null);
  const near = (ms, want) => ms != null && ms >= want - 30 && ms <= want + 400;
  let mark = events.length;
  const res = await rawPost('/api/match/start', { playerIds: [A, B], format: 'bo3', stage: 'current', powerups: 'off' });
  if (!check(res.ok && res.match.phase === 'intro' && res.match.waiting.for === 'ready' && res.match.waiting.timeoutMs === T.ready, "start: 'intro', waiting.timeoutMs is the server's", JSON.stringify(res).slice(0, 160))) return;
  const intro1 = await waitPhase('intro', mark, 2000);
  const play1 = await waitPhase('play', mark, 3000);
  check(near(took(intro1, play1), T.ready), `intro -> play by itself after ${took(intro1, play1)} ms`);
  // both dink it until both are out of strokes: tied
  for (let guard = 0; guard < 20 && matchNow().phase === 'play'; guard++) await swing(DINK);
  let m = matchNow();
  check(m.phase === 'hole-result' && m.lastResult.reason === 'tied' && m.players.every((p) => p.capped && p.strokes === m.par + 3), `both out of strokes at par + 3 (${m.par + 3}): tied`, JSON.stringify(m.lastResult));
  const result1 = [...events].reverse().find((e) => e.event === 'match' && e.data && e.data.phase === 'hole-result');
  const intro2 = await waitPhase('intro', result1.i, 3000);
  check(near(took(result1, intro2), T.cont) && intro2.data.stage.id === 'shootout', `hole-result -> the shootout's intro by itself after ${took(result1, intro2)} ms`);
  const tb = await waitPhase('tiebreak', intro2.i, 3000);
  check(near(took(intro2, tb), T.ready), `intro -> tiebreak by itself after ${took(intro2, tb)} ms`);
  m = matchNow();
  const far = m.currentPlayerId;
  await swing(DINK);
  await swing(forDistance(matchNow().players.find((p) => p.id !== far).distToPinYd));
  m = matchNow();
  check(m.phase === 'hole-result' && m.lastResult.reason === 'tiebreak' && m.lastResult.winnerId !== far, 'the shootout gives hole 1 a winner', JSON.stringify(m.lastResult));
  const result2 = [...events].reverse().find((e) => e.event === 'match' && e.data && e.data.phase === 'hole-result');
  const play2 = await waitFor((e) => e.event === 'match' && e.data && e.data.phase === 'play' && e.data.holeNumber === 2, result2.i, 4000);
  check(near(took(result2, play2), T.cont + T.ready), `hole-result -> intro -> play of hole 2 by itself after ${took(result2, play2)} ms`);
  const over = await rawPost('/api/match/concede', { playerId: A });
  check(over.ok && over.match.phase === 'done' && over.match.waiting.for === 'dismiss' && over.match.waiting.timeoutMs === T.done, "conceded: 'done', waiting to be dismissed");
  const done = await waitPhase('done', play2.i, 2000);
  const gone = await waitFor((e) => e.event === 'match' && e.data === null, done.i, 3000);
  check(near(took(done, gone), T.done), `done -> dismissed by itself after ${took(done, gone)} ms`);
  check((await get('/api/match')).match === null, 'no match is left');
  say(`  by themselves: intro -> play ${took(intro1, play1)} ms | tied result -> shootout intro ${took(result1, intro2)} ms | intro -> tiebreak ${took(intro2, tb)} ms`
    + ` | result -> intro -> play ${took(result2, play2)} ms | done -> dismissed ${took(done, gone)} ms`);
}

let crashed = null;
try {
  const players = await main();
  if (SPAWN && players) await timeouts(players);
} catch (error) {
  crashed = error;
} finally {
  if (sseAbort) sseAbort.abort();
  try { await rawPost('/api/match/abort'); } catch (_) { /* server gone */ }
  removeRocketHole();
  if (SPAWN) await stopServer();
}
if (crashed) { console.error(crashed); if (serverLog.length) console.error(serverLog.slice(-15).join('\n')); }
console.log(`\n${checks} checks, ${failures.length} failed${failures.length ? `:\n  - ${failures.join('\n  - ')}` : ''}`);
process.exit(crashed || failures.length ? 1 : 0);
