#!/usr/bin/env node
// Playability end to end over HTTP (v2:playability), against a private test server:
//
//   BIRDIE_PORT=8332 BIRDIE_OC_PORT=9962 BIRDIE_DATA_DIR=<repo>/.scratch/playability/data \
//     BIRDIE_ENRICH=0 BIRDIE_SKY_PREFETCH=0 BIRDIE_MATCH_READY_MS=0 BIRDIE_MATCH_CONTINUE_MS=0 node server.js
//   node tools/arcade-dev/playability-e2e.mjs [--port 8332]
//
// 1 a ball in the sand under the green's bank on Lagoon Island: the next swing gets out
//   (and with the arcade layer off the same swing from the same lie goes a few feet);
// 2 a ball behind a brow: the next drive clears it (the plain simulator stops it dead);
// 3 solo: a dead lie says rescue: true and its drop is free; a live lie's drop costs a
//   stroke; a drop is taken back by the mulligan;
// 4 a match: the free drop for the player who is up, undone, taken again, then a +1 drop.
// The tee shots that reach those lies are searched in this process (the same stage, the
// same physics) and then hit on the server with POST /api/test-shot.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { stageGame } = require('./playability-core.cjs');
const { simulateShot, YD } = require('../../lib/physics');
const { PLAY_ASSIST } = require('../../lib/playability');
const { modifiersFor } = require('../../lib/arcade');

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]) || 8332;
const base = `http://127.0.0.1:${port}`;
// (a search in this process can outlast the server's keep-alive: a reset socket is tried again)
const call = async (url, init) => { try { return await fetch(url, init); } catch (_) { return fetch(url, init); } };
const post = async (p, body = {}) => { const r = await call(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Connection: 'close' }, body: JSON.stringify(body) }); return r.json().catch(() => ({ ok: false })); };
const get = async (p) => (await call(base + p, { headers: { Connection: 'close' } })).json();
const state = () => get('/api/state');
const shot = (speed, vla, hla = 0, spin = 3000) => post('/api/test-shot', { speed, vla, hla, spin, spinAxis: 0 });
let failed = 0;
const check = (ok, text) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${text}`); if (!ok) failed++; };
const still = async () => { await post('/api/conditions', { windMph: 0, gustMph: 0 }); };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const TOUR = await get('/api/match').then((r) => [...r.tour.stages, ...r.tour.tiebreaks]);
const loadStage = async (id) => { const r = await post('/api/load-course', { cached: TOUR.find((t) => t.id === id).file }); if (!r.ok) throw new Error(`${id}: ${r.error}`); await still(); return state(); };

// A tee shot on a stage, played in this process the way the server plays a solo one (the
// play assists, no dispersion, still air, the stage's free ball), that leaves the game as wanted.
function searchTee(id, grid, want, aims = [0]) {
  const g = stageGame(id, PLAY_ASSIST);
  const free = (g.course.arcade && g.course.arcade.freeBall) || null;
  for (const aim of aims) {
    for (const [mph, vla, hla, spin] of grid) {
      g.reset();
      g.setAimOffset(aim);
      g.shotMods = modifiersFor(free, { dispersion: 1, putting: 'easy', tapInFt: 8 });
      const r = g.handleShot({ Speed: mph, VLA: vla, HLA: hla, TotalSpin: spin, SpinAxis: 0 });
      g.shotMods = null;
      if (r && want(g, r)) return { id, mph, vla, hla, spin, aim };
    }
  }
  return null;
}
const searchStages = (ids, grid, want, aims) => { for (const id of ids) { const t = searchTee(id, grid, want, aims); if (t) return t; } return null; };
const gridOf = (speeds, vlas, hlas, spin) => { const out = []; for (const a of speeds) for (const b of vlas) for (const c of hlas) out.push([a, b, c, spin]); return out; };
const range = (a, b, step) => { const out = []; for (let v = a; v <= b + 1e-9; v += step) out.push(+v.toFixed(2)); return out; };
const hit = async (t) => { await post('/api/reset'); await still(); await post('/api/aim', { offset: t.aim || 0 }); await shot(t.mph, t.vla, t.hla, t.spin); return state(); };

await post('/api/match/abort');
await post('/api/arcade/settings', { enabled: true, unlimited: false, assist: { dispersion: 1, putting: 'easy', tapInFt: 8 } });
await post('/api/arcade/arm', { id: null });

// ---- 1 the sand under the bank on Lagoon Island ----
console.log('\n1. Lagoon Island: out of the sand under the green');
let s = await loadStage('lagoon-island');
check(s.playAssist === true && s.aimLimitDeg === 90, `the arcade layer is on: playAssist ${s.playAssist}, aim limit ${s.aimLimitDeg} deg`);
// under the bank: the ground rises more than 2 m within 5 m toward the flag
const bankAt = (g, ball) => { const pin = g.hole.pin; const a = Math.atan2(pin[0] - ball.x, pin[1] - ball.y); return g.terrain.h(ball.x + Math.sin(a) * 5, ball.y + Math.cos(a) * 5) - g.terrain.h(ball.x, ball.y); };
let found = searchTee('lagoon-island', gridOf(range(50, 100, 0.5), [30, 36, 42], [-6, -3, 0, 3, 6, 9], 7000), (g) => g.lie === 'bunker' && bankAt(g, g.ball) > 2);
if (found) { s = await hit(found); found.rise = bankAt(stageGame('lagoon-island'), s.ball); if (s.lie !== 'bunker') found = null; }
check(Boolean(found), found ? `a ${found.mph} mph wedge finds the beach bunker at (${s.ball.x.toFixed(1)}, ${s.ball.y.toFixed(1)}), ${s.distToPinYd} yd out, the bank ${found.rise.toFixed(1)} m high 5 m ahead` : 'no tee shot found the sand under the bank');
if (found) {
  const from = { ...s.ball }, strokes = s.strokes;
  await shot(130, 16, 0, 5000);
  let t = await state();
  const moved = dist(t.ball, from) / YD;
  check(moved > 10 || t.strokes > strokes + 1, `arcade ON: the 130 mph / 16 deg swing leaves the sand: the ball is ${moved.toFixed(1)} yd away (${t.lie}${t.strokes > strokes + 1 ? ', +1: a full 5-iron from 31 yd flew the island' : ''})`);
  await post('/api/mulligan');
  await shot(42, 34, 0, 6000);
  t = await state();
  check(dist(t.ball, from) / YD > 10 && t.lie !== 'bunker', `arcade ON: a 42 mph / 34 deg splash from the same lie: ${(dist(t.ball, from) / YD).toFixed(1)} yd, on the ${t.lie}, ${(t.distToPinYd * 3).toFixed(0)} ft from the pin, strokes ${strokes} -> ${t.strokes}`);
  await post('/api/mulligan');
  t = await state();
  check(dist(t.ball, from) < 0.01 && t.lie === 'bunker', 'the mulligan puts it back in the sand');
  await post('/api/arcade/settings', { enabled: false });
  t = await state();
  check(t.playAssist === false && t.aimLimitDeg === 45 && t.canDrop === false, `arcade OFF: playAssist ${t.playAssist}, aim limit ${t.aimLimitDeg}, canDrop ${t.canDrop}`);
  await shot(130, 16, 0, 5000);
  t = await state();
  check(dist(t.ball, from) / YD < 3 && t.lie === 'bunker', `arcade OFF: the same 130 mph / 16 deg swing from the same lie goes ${(dist(t.ball, from) / YD * 3).toFixed(1)} ft and stays in the sand`);
  await post('/api/mulligan');
  await post('/api/arcade/settings', { enabled: true });
  await post('/api/aim', { offset: 80 });
  t = await state();
  check(t.aimOffset === 80, `the aim turns to ${t.aimOffset} deg (the plain clamp is 45)`);
  await post('/api/aim', { offset: 0 });
}

// ---- 2 behind a brow ----
console.log('\n2. A drive from behind a brow');
const DR = { speedMph: 150, vla: 12, hla: 0, totalSpin: 2500, spinAxis: 0 };
const plainFrom = (g, ball) => { const pin = g.hole.pin; return simulateShot(DR, ball, Math.atan2(pin[0] - ball.x, pin[1] - ball.y) * 180 / Math.PI, g.surfaceAt, { terrain: g.terrain, pin: { x: pin[0], y: pin[1] }, trees: g.treeObstacles }); };
// the plain simulator stops a good drive at the flag inside 12 yd, on the ground, not in a tree
const browAt = (g, ball) => { const p = plainFrom(g, ball); const first = p.events.find((e) => e.type === 'tree' || e.type === 'bounce'); return p.totalYd < 12 && first && first.type === 'bounce' ? p.totalYd : null; };
let tries = 0;
const STAGES = ['temple-run', 'frostbite-ridge', 'canyon-run', 'midnight-mile', 'pharaohs-gate', 'lighthouse-point', 'summit-express', 'dragons-spine', 'sky-fortress', 'volcano-drop', 'sakura-garden'];
found = searchStages(STAGES, gridOf(range(90, 165, 15), [10, 16, 24], range(-40, 40, 8), 3500), (g, r) => { tries++; return !r.penalty && !g.holed && g.lie !== 'green' && g.distToPinYd > 120 && browAt(g, g.ball) !== null; }, [0, -60, 60]);
if (found) { await loadStage(found.id); s = await hit(found); found.plain = browAt(stageGame(found.id), s.ball); }
check(Boolean(found && found.plain !== null), found ? `${found.id}: after ${tries} tee shots searched, aim ${found.aim}, ${found.mph} mph / ${found.vla} deg / hla ${found.hla} leaves the ball at (${s.ball.x.toFixed(1)}, ${s.ball.y.toFixed(1)}) in the ${s.lie}, ${s.distToPinYd} yd out: the plain simulator stops a 150 mph / 12 deg drive at the flag after ${found.plain === null ? '?' : found.plain.toFixed(1)} yd (the ground in front)` : `no ball came to rest behind a brow in ${tries} tee shots`);
if (found && found.plain !== null) {
  const from = { ...s.ball };
  const g = stageGame(found.id);
  const a = Math.atan2(s.pin[0] - from.x, s.pin[1] - from.y);
  const prof = [2, 5, 10, 20].map((d) => `${d} m: ${(g.terrain.h(from.x + Math.sin(a) * d, from.y + Math.cos(a) * d) - g.terrain.h(from.x, from.y)).toFixed(1)}`).join(', ');
  await shot(150, 12, 0, 2500);
  const t = await state();
  check(dist(t.ball, from) / YD > 100, `arcade ON: the same drive from there travels ${(dist(t.ball, from) / YD).toFixed(0)} yd (${t.lie}, ${t.distToPinYd} yd out); the ground ahead rises ${prof}`);
}

// ---- 3 solo: a dead lie, the free drop, a +1 drop, the mulligan ----
console.log('\n3. Solo: rescue and the drop');
tries = 0;
const wide = gridOf(range(30, 120, 5), [8, 14, 20, 28], range(-44, 44, 4), 3000);
found = searchStages(['dragons-spine', 'sky-fortress', 'sakura-garden', 'summit-express', 'volcano-drop', 'lagoon-island'], wide, (g, r) => { tries++; const d = r.penalty ? null : g.dropInfo(); return Boolean(d && d.rescue); }, [0, -45, 45, -90, 90]);
const live = found ? searchTee(found.id, wide, (g, r) => { const d = r.penalty ? null : g.dropInfo(); return Boolean(d && !d.rescue && g.lie === 'rough'); }) : null;
check(Boolean(found), found ? `${found.id}: after ${tries} tee shots searched: aim ${found.aim}, ${found.mph} mph / ${found.vla} deg / hla ${found.hla} comes to rest on a DEAD lie` : `no dead lie in ${tries} tee shots`);
if (found) {
  await loadStage(found.id);
  s = await hit(found);
  check(s.rescue === true && s.canDrop === true && s.drop && s.drop.free === true && s.drop.cost === 0, `state: lie ${s.lie} at (${s.ball.x.toFixed(1)}, ${s.ball.y.toFixed(1)}), ${s.distToPinYd} yd out: rescue ${s.rescue}, canDrop ${s.canDrop}, drop ${JSON.stringify(s.drop)}`);
  const before = s;
  const r = await post('/api/drop');
  s = await state();
  check(r.ok && r.drop.free === true && r.drop.penalty === 0 && s.strokes === before.strokes, `POST /api/drop: free ${r.drop && r.drop.free}, strokes ${before.strokes} -> ${s.strokes}, note "${r.drop && r.drop.note}"`);
  // (a ball that lies farther from the hole than the tee itself goes to the tee: the line has nothing behind it)
  check(Math.abs(s.ball.x - before.drop.x) < 1e-6 && ['fairway', 'tee'].includes(s.lie) && (s.distToPinYd >= before.distToPinYd - 0.1 || (s.ball.x === s.tee[0] && s.ball.y === s.tee[1])) && s.rescue === false, `the ball is on the ${s.lie} at (${s.ball.x.toFixed(1)}, ${s.ball.y.toFixed(1)}), ${s.distToPinYd} yd out (was ${before.distToPinYd}): ${s.distToPinYd >= before.distToPinYd - 0.1 ? 'no nearer the hole' : 'the tee (the ball lay behind it)'}, not a dead lie`);
  await post('/api/mulligan');
  s = await state();
  check(dist(s.ball, before.ball) < 0.01 && s.rescue === true && s.mulligans[0] === 0, `the mulligan takes the drop back: the ball is where it lay, rescue ${s.rescue}, mulligans counted ${s.mulligans[0]}`);
}
if (live) {
  s = await hit(live);
  const before = s;
  const r = await post('/api/drop');
  s = await state();
  check(before.rescue === false && r.ok && r.drop.free === false && s.strokes === before.strokes + 1, `a live lie (${before.lie}, ${before.distToPinYd} yd out): the drop costs a stroke: strokes ${before.strokes} -> ${s.strokes}, "${r.drop && r.drop.note}", now ${s.lie} ${s.distToPinYd} yd out`);
  const again = await post('/api/drop');
  check(again.ok === false && s.canDrop === false, `no second drop from the line: canDrop ${s.canDrop}, "${again.error}"`);
} else check(false, 'no live lie with a drop found');

// ---- 4 a match ----
console.log(`\n4. A match on ${found ? found.id : '?'}: the drop for the player who is up`);
if (found) {
  const need = ['Drop Tester A', 'Drop Tester B'];
  let roster = (await get('/api/leagues')).players || [];
  for (const name of need) if (!roster.some((p) => p.name === name)) await post('/api/players', { name });
  roster = (await get('/api/leagues')).players || [];
  const ids = need.map((n) => roster.find((p) => p.name === n).id);
  const start = await post('/api/match/start', { playerIds: ids, format: 'quick', stage: found.id, powerups: 'off' });
  check(start.ok, `match started: ${start.ok ? `${start.match.stage.name}, ${start.match.phase}` : start.error}`);
  const waitPhase = async (want) => { for (let i = 0; i < 200; i++) { const m = (await get('/api/match')).match; if (m && m.phase === want) return m; await new Promise((r) => setTimeout(r, 50)); } return (await get('/api/match')).match; };
  let m = await waitPhase('intro');
  await post('/api/match/ready');
  m = await waitPhase('play');
  await still();
  const A = m.currentPlayerId, B = ids.find((x) => x !== A);
  // A hits the tee shot that lies dead, B one down the middle: A, farther out, is up again
  await post('/api/aim', { offset: found.aim || 0 });
  await shot(found.mph, found.vla, found.hla, found.spin);
  await shot(150, 13, 0, 2600);
  m = (await get('/api/match')).match;
  s = await state();
  const dead = m.phase === 'play' && m.currentPlayerId === A && s.rescue === true;
  check(dead, `A's tee shot lies dead and A is up again: phase ${m.phase}, up ${m.currentPlayerId === A ? 'A' : 'B'}, rescue ${s.rescue}, drop ${JSON.stringify(s.drop)}`);
  if (dead) {
    const a0 = m.players.find((p) => p.id === A);
    const wrong = await post('/api/match/drop', { playerId: B });
    check(wrong.ok === false, `B cannot drop on A's turn: "${wrong.error}"`);
    let r = await post('/api/match/drop', { playerId: A });
    m = r.match; s = await state();
    const a1 = m.players.find((p) => p.id === A);
    const ev = m.events.filter((e) => e.type === 'drop').at(-1);
    const said = m.log.filter((l) => /DROP|drops/.test(l.text)).at(-1);
    check(r.ok && a1.strokes === a0.strokes && ev && ev.free === true && ev.playerId === A, `POST /api/match/drop: A's strokes ${a0.strokes} -> ${a1.strokes}, event ${JSON.stringify(ev && { type: ev.type, free: ev.free, strokes: ev.strokes })}, log "${said && said.text}"`);
    check(Boolean(m.undoable && m.undoable.drop === true && m.undoable.playerId === A), `undoable: ${JSON.stringify(m.undoable)}`);
    check(['fairway', 'tee'].includes(a1.lie), `A's ball: ${a1.lie}, ${a1.distToPinYd} yd out (was ${a0.lie}, ${a0.distToPinYd})`);
    r = await post('/api/match/undo');
    m = r.match; s = await state();
    const a2 = m.players.find((p) => p.id === A);
    const last = m.events.at(-1);
    check(r.ok && dist(a2.ball, a0.ball) < 0.01 && a2.strokes === a0.strokes && m.currentPlayerId === A && s.rescue === true && m.events.some((e) => e.type === 'shot-undone' && e.drop === true), `POST /api/match/undo: A's ball back at (${a2.ball.x.toFixed(1)}, ${a2.ball.y.toFixed(1)}), ${a2.lie}, strokes ${a2.strokes}, rescue ${s.rescue}, last event ${last.type}`);
    // the hole again: this time A's tee shot finds a live lie in the rough, and the drop costs a stroke
    await post('/api/match/restart-hole'); await still();
    if (live) { await post('/api/aim', { offset: live.aim || 0 }); await shot(live.mph, live.vla, live.hla, live.spin); await shot(150, 13, 0, 2600); }
    m = (await get('/api/match')).match; s = await state();
    const up = m.currentPlayerId, u0 = m.players.find((p) => p.id === up);
    if (s.canDrop && !s.rescue) {
      r = await post('/api/match/drop', { playerId: up });
      const u1 = r.match.players.find((p) => p.id === up);
      const e2 = r.match.events.filter((e) => e.type === 'drop').at(-1);
      check(r.ok && u1.strokes === u0.strokes + 1 && e2.free === false, `a live lie in the match (${up === A ? 'A' : 'B'}, ${u0.lie}, ${u0.distToPinYd} yd out): the drop costs a stroke (${u0.strokes} -> ${u1.strokes}), event free ${e2.free}, now ${u1.lie} ${u1.distToPinYd} yd out`);
    } else check(false, `  note  whoever is up has no paid drop to take (canDrop ${s.canDrop}, rescue ${s.rescue}, lie ${u0.lie})`);
  }
  await post('/api/match/abort');
}
await post('/api/arcade/settings', { assist: { dispersion: 0.6 } });
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
