'use strict';
// Playability (v2:playability): the arcade layer's guard against dead shots.
//   lib/physics.js        launch clearance (opts.launchClearM / launchClearRiseM), sand escape
//   lib/tree-obstacles.js soft trees (opts.softTrees / treeFreeM)
//   lib/playability.js    PLAY_ASSIST, the dead-lie test, where a drop on the line goes
//   lib/game.js           Game.playAssist, the 90 degree aim, dropInfo() / dropOnLine()
//   lib/match.js          match.drop(): per player, counted, undoable
//   the hole guard        the audit (tools/arcade-dev/playability-core.cjs) on every stage,
//                         with thresholds, and the stages' own suites with the assists on
// Off (Game.playAssist null, no options): the plain simulator, to the last bit.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { simulateShot, YD } = require('../lib/physics');
const { buildTreeObstacles } = require('../lib/tree-obstacles');
const { Game } = require('../lib/game');
const { createMatch, MatchError, STROKE_CAP } = require('../lib/match');
const { gradeShot, modifiersFor } = require('../lib/arcade');
const P = require('../lib/playability');
const { stageIds, stageGame, ctxOf, sampleSpots, auditStage, table } = require('../tools/arcade-dev/playability-core.cjs');

const A = P.PLAY_ASSIST.physics;
const L = (speedMph, vla, totalSpin, hla = 0) => ({ speedMph, vla, hla, totalSpin, spinAxis: 0 });
const DRIVER = L(150, 12, 2500), IRON5 = L(130, 16, 5000), WEDGE = L(90, 28, 9000);
const fairway = () => 'fairway';
const smooth = (u) => { const t = Math.max(0, Math.min(1, u)); return t * t * (3 - 2 * t); };
// ground that is level, then climbs `rise` metres between y = from and y = from + over, then is level again
const step = (from, over, rise) => ({
  h: (x, y) => rise * smooth((y - from) / over),
  grad: (x, y) => { const u = (y - from) / over; return { dx: 0, dy: u <= 0 || u >= 1 ? 0 : rise * 6 * u * (1 - u) / over }; },
});
const north = (launch, terrain, opts = {}, surfaceAt = fairway) => simulateShot(launch, { x: 0, y: 0 }, 0, surfaceAt, { terrain, ...opts });

// ---------------------------------------------------------------- the assist's numbers

test('PLAY_ASSIST: 35 m of launch clearance over 6 m of rise, soft trees, 15 m free, a 90 degree aim, the drop', () => {
  assert.deepEqual(P.PLAY_ASSIST, { physics: { launchClearM: 35, launchClearRiseM: 6, softTrees: true, treeFreeM: 15 }, aimLimitDeg: 90, drop: true });
  assert.ok(Object.isFrozen(P.PLAY_ASSIST) && Object.isFrozen(P.PLAY_ASSIST.physics));
  assert.equal(P.PLAIN_AIM_LIMIT_DEG, 45);
  // the swings: the brief's four clubs, a pitch and a chip; a duff is 80 % of the speed, 5 degrees lower
  assert.deepEqual(P.FAMILIES.map((f) => [f.id, f.speedMph, f.vla, f.totalSpin]), [
    ['driver', 150, 12, 2500], ['iron5', 130, 16, 5000], ['iron7', 115, 19, 6500], ['wedge', 90, 28, 9000], ['pitch', 60, 30, 7000], ['chip', 35, 24, 4000],
  ]);
  assert.deepEqual(P.launchOf(P.FAMILIES[0], true), { speedMph: 120, vla: 7, hla: 0, totalSpin: 2500, spinAxis: 0 });
  // who hits what: nothing that flies the hole by 30 yd, nothing that covers under a quarter of the way
  assert.deepEqual(P.familiesFor(280).map((f) => f.id), ['driver', 'iron5', 'iron7', 'wedge']);
  assert.deepEqual(P.familiesFor(150).map((f) => f.id), ['iron7', 'wedge', 'pitch']);
  assert.deepEqual(P.familiesFor(60).map((f) => f.id), ['pitch', 'chip']);
  assert.deepEqual(P.familiesFor(30).map((f) => f.id), ['chip']);
  assert.deepEqual(P.familiesFor(4).map((f) => f.id), ['chip']);
});

// ---------------------------------------------------------------- launch clearance

test('off is the plain simulator to the last bit: no option, a zero or a false changes nothing', () => {
  const g = stageGame('temple-run');
  const ctx = ctxOf(g);
  const spots = [{ x: -78, y: 242 }, { x: 192, y: 392 }, { x: 84, y: 236 }, { x: 0, y: 0 }];
  for (const s of spots) {
    for (const l of [DRIVER, IRON5, WEDGE, L(100, 2, 2000), L(120, 7, 2500, 6)]) {
      const o = { terrain: g.terrain, pin: ctx.pin, trees: g.treeObstacles };
      const aim = Math.atan2(ctx.pin.x - s.x, ctx.pin.y - s.y) * 180 / Math.PI;
      const plain = simulateShot(l, s, aim, g.surfaceAt, o);
      const zeroed = simulateShot(l, s, aim, g.surfaceAt, { ...o, launchClearM: 0, launchClearRiseM: 6, softTrees: false, treeFreeM: 0 });
      assert.deepEqual(zeroed, plain);
    }
  }
  // and a putt is never touched, with the assists on
  const flat = step(1e9, 1, 0);
  assert.deepEqual(simulateShot(L(6, 0.5, 100), { x: 0, y: 0 }, 0, () => 'green', { terrain: flat, ...A }), simulateShot(L(6, 0.5, 100), { x: 0, y: 0 }, 0, () => 'green', { terrain: flat }));
  // level open ground: the assists have nothing to do, and do nothing
  for (const l of [DRIVER, IRON5, WEDGE]) assert.deepEqual(north(l, flat, A), north(l, flat));
});

test('a ball 5 m short of a 3 m brow: the plain drive dies in it, the arcade drive clears it', () => {
  const brow = step(5, 3, 3);            // level, then 3 m up between 5 and 8 m ahead
  const level = step(1e9, 1, 0);
  const plain = north(DRIVER, brow);
  const first = plain.events[0];
  assert.equal(first.type, 'bounce');
  assert.ok(Math.hypot(first.x, first.y) < 8, `the plain drive meets the face ${Math.hypot(first.x, first.y).toFixed(1)} m out`);
  assert.ok(plain.carryYd < 9 && plain.totalYd < 60, `plain: carry ${plain.carryYd.toFixed(1)} yd, total ${plain.totalYd.toFixed(1)} yd`);
  const clear = north(DRIVER, brow, A);
  const open = north(DRIVER, level);
  assert.ok(clear.carryYd > 230, `arcade: it carries ${clear.carryYd.toFixed(0)} yd`);
  assert.ok(Math.abs(clear.carryYd - open.carryYd) < 12, `as far as on level ground give or take the plateau (${open.carryYd.toFixed(0)} yd there)`);
  // the ball was carried over the brow, never under the ground
  for (const p of clear.points) assert.ok(p.z >= brow.h(p.x, p.y) - 1e-6, `at ${p.y.toFixed(1)} m the ball is above the ground`);
  // a wedge (28 degrees) is over it anyway; the driver and the 5-iron, and a duffed one of each, are not
  assert.deepEqual(north(WEDGE, brow, A), north(WEDGE, brow));
  for (const f of P.FAMILIES.slice(0, 2)) for (const duffed of [false, true]) {
    const l = P.launchOf(f, duffed);
    assert.ok(north(l, brow).totalYd < 0.45 * north(l, level).totalYd, `${f.id}${duffed ? ' duffed' : ''}: the plain simulator loses most of it`);
    assert.ok(north(l, brow, A).carryYd > 0.9 * north(l, level).carryYd, `${f.id}${duffed ? ' duffed' : ''}: the arcade keeps it`);
  }
});

test('it forgives a few metres, not a wall: 6 m of rise, 35 m of travel', () => {
  // a 30 m cliff 20 m ahead stops the arcade drive as it stops the plain one
  const cliff = step(20, 6, 30);
  const plain = north(DRIVER, cliff), arc = north(DRIVER, cliff, A);
  assert.ok(plain.carryYd < 30 && arc.carryYd < 30, `both meet the cliff: plain ${plain.carryYd.toFixed(1)} yd out, arcade ${arc.carryYd.toFixed(1)} yd`);
  assert.ok(plain.end.y < 26 && arc.end.y < 26, 'and neither ball is on top of it');
  // the drive is 1.7 m up 8 m out: a 7 m bank there needs 5.3 m of forgiveness, a 9 m one 7.3 m
  assert.ok(north(DRIVER, step(5, 3, 7), A).carryYd > 200, 'a 7 m bank 8 m ahead: cleared');
  assert.ok(north(DRIVER, step(5, 3, 9), A).end.y < 8, 'a 9 m bank 8 m ahead: a wall');
  assert.ok(north(DRIVER, step(5, 3, 9), { ...A, launchClearRiseM: 9 }).carryYd > 200, '(launchClearRiseM is the knob)');
  assert.ok(north(DRIVER, step(5, 3, 7), { ...A, launchClearRiseM: 4 }).end.y < 8);
  // beyond 35 m the ground is the ground: a 3 m bank 40 m ahead is under a drive anyway (8.5 m up),
  // but a 12 m one is hit by both
  const far = step(40, 4, 12);
  assert.deepEqual(north(DRIVER, far, A).events[0], north(DRIVER, far).events[0]);
  // a ball coming DOWN onto rising ground lands on it: only a climbing ball is carried
  const chip = L(35, 24, 4000);
  const mound = step(12, 3, 2);
  assert.ok(north(chip, mound, A).carryYd < 16, 'a chip that has peaked lands on the bank in front');
});

test('a topped ball still runs along the ground: it is helped over a lip, not over a brow', () => {
  const top = L(100, 2, 2000);
  const lip = step(3, 1.5, 1);           // a 1 m lip 3 m ahead
  const level = step(1e9, 1, 0);
  const plain = north(top, lip), arc = north(top, lip, A), open = north(top, level);
  assert.ok(plain.totalYd < 0.5 * open.totalYd, `plain: the lip takes most of it (${plain.totalYd.toFixed(1)} of ${open.totalYd.toFixed(1)} yd)`);
  assert.ok(arc.totalYd > 0.8 * open.totalYd, `arcade: it runs on ${arc.totalYd.toFixed(1)} yd`);
  assert.ok(arc.apexFt < 9, `still a worm burner: apex ${arc.apexFt.toFixed(1)} ft`);
  // a 3 m brow is more than a lip: the topped ball is stopped by it either way
  const brow = step(5, 3, 3);
  assert.ok(north(top, brow, A).totalYd < 0.5 * open.totalYd, 'a topped ball does not fly a 3 m brow');
  assert.ok(north(L(100, 5, 2500), brow, A).carryYd > 40, 'five degrees of launch is a shot: carried over');
});

test('Lagoon Island: a 16 degree launch from the beach bunker went "1 ft"; now it comes out', () => {
  const g = stageGame('lagoon-island');
  const ctx = ctxOf(g);
  const spot = { x: -17, y: 112 };
  assert.equal(g.surfaceAt(spot.x, spot.y), 'bunker');
  const aimRad = Math.atan2(ctx.pin.x - spot.x, ctx.pin.y - spot.y);
  const ahead = (d) => g.terrain.h(spot.x + Math.sin(aimRad) * d, spot.y + Math.cos(aimRad) * d) - g.terrain.h(spot.x, spot.y);
  assert.ok(ahead(2) > 2.5 && ahead(2) < 3.5, `the bank of the green: ${ahead(2).toFixed(2)} m up, 2 m ahead (a 55 degree face)`);
  const o = { terrain: g.terrain, pin: ctx.pin, trees: g.treeObstacles };
  const aim = aimRad * 180 / Math.PI;
  const plain = simulateShot(IRON5, spot, aim, g.surfaceAt, o);
  assert.equal(plain.events[0].type, 'bounce');
  assert.ok(plain.carryYd * 3 < 1 && plain.totalYd * 3 < 2 && plain.endSurface === 'bunker', `plain: carry ${(plain.carryYd * 36).toFixed(0)} in, total ${(plain.totalYd * 3).toFixed(1)} ft, still in the sand`);
  for (const vla of [12, 20, 30, 45]) assert.ok(simulateShot(L(130, vla, 5000), spot, aim, g.surfaceAt, o).totalYd < 3, `plain: launched at ${vla} degrees it is still in the sand`);
  const arc = simulateShot(IRON5, spot, aim, g.surfaceAt, { ...o, ...A });
  assert.ok(arc.carryYd > 150, `arcade: the same swing carries ${arc.carryYd.toFixed(0)} yd`);
  // a splash shot ends on the green; even a topped one runs out of the sand
  const splash = simulateShot(L(42, 34, 6000), spot, aim, g.surfaceAt, { ...o, ...A });
  assert.equal(splash.endSurface, 'green', `a 42 mph splash: ${splash.totalYd.toFixed(1)} yd, on the ${splash.endSurface}`);
  assert.ok(simulateShot(L(42, 34, 6000), spot, aim, g.surfaceAt, o).totalYd < 3, 'plain: the splash stays in the sand');
  // sand escape: on level sand a topped ball dies in it (keep 0.12, 9 m/s2); in the arcade it runs out
  const beach = (x, y) => (y < 60 ? 'bunker' : 'fairway');
  const flat = step(1e9, 1, 0);
  const skull = L(100, 0.5, 1500);
  const stays = north(skull, flat, {}, beach);
  assert.ok(stays.totalYd < 12 && stays.endSurface === 'bunker', `plain: a skulled ball dies in the sand after ${stays.totalYd.toFixed(1)} yd`);
  const out = north(skull, flat, A, beach);
  assert.ok(out.totalYd > 20 && out.totalYd < 80, `arcade: it runs ${out.totalYd.toFixed(1)} yd`);
  assert.equal(out.events[0].surface, 'bunker', '(the bounce is still reported on sand)');
  // sand costs the roll of a ball that LANDS in it, as ever: only the bunker it was hit from lets go
  const landing = (x, y) => (y > 150 ? 'bunker' : 'fairway');
  assert.deepEqual(north(IRON5, flat, A, landing), north(IRON5, flat, {}, landing));
});

// ---------------------------------------------------------------- soft trees

// a tree as the course files have them: [x, y, heightM, crownRadiusM]
const treesOf = (list) => buildTreeObstacles({ name: 'Test', surfaces: [], holes: [], trees: [], canopy: { trees: list } });

test('a drive through a wood: leaves take a little speed, they do not stop it', () => {
  const flat = step(1e9, 1, 0);
  const wood = treesOf([40, 52, 64, 76, 88, 100].flatMap((y) => [[-5, y, 20, 6], [0, y + 4, 22, 6], [5, y, 20, 6]]));
  const open = north(DRIVER, flat);
  const plain = north(DRIVER, flat, { trees: wood });
  const tree = plain.events.find((e) => e.type === 'tree');
  assert.ok(tree && tree.part === 'crown', 'the plain drive meets a branch');
  assert.ok(plain.totalYd < 0.6 * open.totalYd, `plain: ${plain.totalYd.toFixed(0)} of ${open.totalYd.toFixed(0)} yd`);
  const soft = north(DRIVER, flat, { trees: wood, ...A });
  const brushes = soft.events.filter((e) => e.type === 'leaves');
  assert.ok(brushes.length >= 1 && brushes.length <= 3, `${brushes.length} brush(es) through the leaves, three at most`);
  assert.equal(soft.events.some((e) => e.type === 'tree'), false, 'no tree hit');
  assert.ok(soft.carryYd > 0.72 * open.carryYd, `arcade: it carries ${soft.carryYd.toFixed(0)} of ${open.carryYd.toFixed(0)} yd`);
  assert.ok(Math.abs(soft.offlineYd) < 25, `a little scatter: ${soft.offlineYd.toFixed(1)} yd offline`);
  assert.deepEqual(north(DRIVER, flat, { trees: wood, ...A }), soft, 'the same shot plays out the same way');
  // a brush is no TIMBER! and no mishit; a real tree hit still is
  const result = (sim) => ({ sim: { ...sim, carryYd: sim.carryYd, totalYd: sim.totalYd }, launch: DRIVER, lie: 'fairway', distToPinYd: 150, penalty: 0, holed: false, strokes: 1, clubKey: 'DR' });
  const before = { distToPinYd: 400, strokes: 0, par: 4, pin: [0, 365] };
  assert.notEqual((gradeShot({ result: result(soft), before }).callout || {}).id, 'timber');
  assert.equal(gradeShot({ result: result(plain), before }).callout.id, 'timber');
  // a Ghost ball still flies through everything
  assert.deepEqual(north(DRIVER, flat, { trees: wood, ...A, ignoreTrees: true }).events.filter((e) => e.type !== 'bounce'), []);
});

test('a trunk still stops a ball: slimmer, and never within 15 m of the strike', () => {
  const flat = step(1e9, 1, 0);
  const low = L(150, 3, 2000);           // a metre up at 22 m: under the crown, on the trunk
  const open = north(low, flat);
  const one = (x, y) => treesOf([[x, y, 16, 4]]);
  // (the species comes with the spot: a spot whose tree has a bare trunk, not a fir's skirt)
  const Y = [18, 19, 20, 21, 22, 23, 24, 25, 26].find((y) => one(0, y).cone[0] === 0 && one(0.26, y).cone[0] === 0);
  assert.ok(Y, 'a spot for a bare-trunked tree');
  const T = one(0, Y);
  assert.equal(+T.trunkR[0].toFixed(3), 0.308, 'its trunk is 0.31 m in radius (0.18 in the arcade)');
  assert.ok(T.trunkTop[0] > 5);
  for (const opts of [{}, A]) {
    const hit = north(low, flat, { trees: one(0, Y), ...opts });
    const ev = hit.events.find((e) => e.type === 'tree');
    assert.ok(ev && ev.part === 'trunk', `${opts === A ? 'arcade' : 'plain'}: a trunk dead ahead is hit`);
    assert.ok(hit.totalYd < 0.5 * open.totalYd && hit.end.y < Y, 'and the ball comes back off it');
  }
  // TIMBER! for the trunk
  const hit = north(low, flat, { trees: one(0, Y), ...A });
  const g = gradeShot({ result: { sim: hit, launch: low, lie: 'fairway', distToPinYd: 380, penalty: 0, holed: false, strokes: 1 }, before: { distToPinYd: 400, strokes: 0, par: 4, pin: [0, 365] } });
  assert.equal(g.callout.id, 'timber');
  // slim: the ball passes 0.26 m off the trunk's centre: inside 0.31 + the ball, outside 0.18 + the ball
  assert.ok(north(low, flat, { trees: one(0.26, Y) }).events.some((e) => e.type === 'tree' && e.part === 'trunk'), 'plain: clipped');
  assert.deepEqual(north(low, flat, { trees: one(0.26, Y), ...A }), north(low, flat, A), 'arcade: past it');
  // inside 15 m of the ball nothing stops it: not the trunk it lies behind
  assert.ok(north(low, flat, { trees: one(0, 10) }).events.some((e) => e.type === 'tree'), 'plain: the trunk 10 m ahead');
  assert.deepEqual(north(low, flat, { trees: one(0, 10), ...A }), north(low, flat, A), 'arcade: through it');
  assert.ok(north(low, flat, { trees: one(0, 10), softTrees: true }).events.some((e) => e.type === 'tree'), '(without treeFreeM the slim trunk is still there)');
  // a rolling ball: off a trunk as ever, but not stopped by a fir skirt or a trunk in the free zone
  const roll = L(60, 0.5, 500);
  assert.deepEqual(simulateShot(roll, { x: 0, y: 0 }, 0, fairway, { terrain: flat, trees: one(0, 6), ...A }), simulateShot(roll, { x: 0, y: 0 }, 0, fairway, { terrain: flat, ...A }));
});

test('Temple Run: the drive from the rough that "carries 42 yd, ends in: Trees"', () => {
  const g = stageGame('temple-run');
  const ctx = ctxOf(g);
  const spot = { x: -78, y: 242 };       // rough, 280 yd out
  assert.equal(g.surfaceAt(spot.x, spot.y), 'rough');
  assert.equal(Math.round(Math.hypot(ctx.pin.x - spot.x, ctx.pin.y - spot.y) / YD), 280);
  const aim = Math.atan2(ctx.pin.x - spot.x, ctx.pin.y - spot.y) * 180 / Math.PI;
  const o = { terrain: g.terrain, pin: ctx.pin, trees: g.treeObstacles };
  const plain = simulateShot(DRIVER, spot, aim, g.surfaceAt, o);
  const first = plain.events[0];
  assert.deepEqual([first.type, first.part], ['tree', 'crown']);
  assert.ok(Math.hypot(first.x - spot.x, first.y - spot.y) < 40 && plain.carryYd < 50 && plain.totalYd < 50, `plain: a crown ${Math.hypot(first.x - spot.x, first.y - spot.y).toFixed(1)} m out, carry ${plain.carryYd.toFixed(0)} yd, total ${plain.totalYd.toFixed(1)} yd`);
  const arc = simulateShot(DRIVER, spot, aim, g.surfaceAt, { ...o, ...A });
  assert.ok(arc.carryYd > 180, `arcade: carry ${arc.carryYd.toFixed(0)} yd`);
  assert.equal(arc.events.some((e) => e.type === 'tree'), false);
  // ... and the ball on a bump with the hill in front of it
  const bump = { x: 192, y: 392 };
  const aim2 = Math.atan2(ctx.pin.x - bump.x, ctx.pin.y - bump.y) * 180 / Math.PI;
  const dead = simulateShot(DRIVER, bump, aim2, g.surfaceAt, o);
  assert.ok(dead.carryYd < 1 && dead.totalYd < 6, `plain: the ground in front stops it after ${dead.totalYd.toFixed(1)} yd`);
  assert.ok(simulateShot(DRIVER, bump, aim2, g.surfaceAt, { ...o, ...A }).carryYd > 200, 'arcade: it flies');
  // the lineup predicts what the game will play (lib/predict.js)
  const { predictShot } = require('../lib/predict');
  g.ball = { ...spot }; g.lie = 'rough'; g.strokes = 1;
  const before = predictShot(g, { club: 'DR' });
  g.playAssist = P.PLAY_ASSIST;
  const after = predictShot(g, { club: 'DR' });
  assert.ok(before.carryYd < 60 && after.carryYd > 180, `predicted carry ${before.carryYd} yd plain, ${after.carryYd} yd in the arcade`);
});

// ---------------------------------------------------------------- the Game

// a straight 437 yd hole: a 30 m wide fairway up the line, rough beside it, a green round the pin
const holeCourse = (par = 4, lengthM = 400) => ({
  name: 'Straight', surfaces: [], boundary: null, elevation: null, pinY: lengthM,
  holes: [{ ref: 1, par, tee: [0, 0], pin: [0, lengthM], lengthYd: Math.round(lengthM / YD), line: [[0, 0], [0, lengthM]] }],
});
const corridor = (course) => (x, y) => (Math.hypot(x, y - course.pinY) < 25 ? 'green' : y > course.pinY + 40 ? 'water' : Math.abs(x) <= 15 ? (y < 8 ? 'tee' : 'fairway') : 'rough');
const newGame = (course = holeCourse(), assist = P.PLAY_ASSIST) => {
  const g = new Game({ surfaceLookupFactory: corridor });
  g.setCourse(course);
  g.playAssist = assist;
  return g;
};
const B = (Speed, VLA, TotalSpin, HLA = 0) => ({ Speed, VLA, HLA, TotalSpin, SpinAxis: 0 });

test('Game.playAssist: null is the plain game; on, the aim reaches 90 degrees and swings carry the assists', () => {
  const plain = new Game();
  assert.equal(plain.playAssist, null);
  assert.equal(Game.defaultPlayAssist, null, 'a new Game is the plain simulator');
  const g = newGame(holeCourse(), null);
  g.setAimOffset(80); assert.equal(g.aimOffset, 45);
  g.setAimOffset(-200); assert.equal(g.aimOffset, -45);
  let s = g.state();
  assert.deepEqual([s.playAssist, s.aimLimitDeg, s.canDrop, s.rescue, s.drop], [false, 45, false, false, null]);
  g.playAssist = P.PLAY_ASSIST;
  g.setAimOffset(80); assert.equal(g.aimOffset, 80);
  g.setAimOffset(-200); assert.equal(g.aimOffset, -90);
  s = g.state();
  assert.deepEqual([s.playAssist, s.aimLimitDeg], [true, 90]);
  // a league round's card is played without them
  g.leagueRound = { leagueId: 'l' };
  assert.equal(g.assist, null);
  assert.equal(g.aimLimitDeg, 45);
  g.leagueRound = null;
  // a practice session keeps its own 45
  g.startPractice('range');
  g.setAimOffset(80);
  assert.equal(g.practice.aimOffset, 45);
  assert.equal(g.state().aimLimitDeg, 45);
  g.endPractice();

  // the swing: out of Lagoon Island's beach bunker, through the Game
  const play = (assist) => {
    const lag = stageGame('lagoon-island', assist);
    lag.ball = { x: -17, y: 112 }; lag.lie = 'bunker'; lag.strokes = 1;
    return { r: lag.handleShot(B(42, 34, 6000)), lag };
  };
  const off = play(null), on = play(P.PLAY_ASSIST);
  assert.ok(off.r.sim.totalYd < 3 && off.r.lie === 'bunker', `plain: ${off.r.sim.totalYd} yd, ${off.r.lie}`);
  assert.equal(on.r.lie, 'green', `arcade: ${on.r.sim.totalYd} yd, on the ${on.r.lie}`);
  // a ball's own options go on top (a Ghost still ignores trees, a Rocket keeps its scales)
  const lag = stageGame('lagoon-island', P.PLAY_ASSIST);
  lag.shotMods = modifiersFor('rocket');
  const r = lag.handleShot(B(100, 20, 5000));
  assert.equal(r.arcadeShot.ball, 'rocket');
  assert.equal(lag.shotMods.id, 'rocket', 'the armed mods are the caller\'s again after the shot');
});

test('DROP ON THE LINE: back on the line, on mown ground, no nearer the hole; +1, or free out of a dead lie', () => {
  const g = newGame();
  let s = g.state();
  assert.deepEqual([s.canDrop, s.drop], [false, null], 'no drop on the tee before a swing');
  assert.equal(g.dropOnLine(), null);
  // a drive 30 yd right, into the rough
  const r = g.handleShot(B(150, 12, 2500, 7));
  assert.equal(r.lie, 'rough');
  s = g.state();
  const ball = { ...s.ball }, out = s.distToPinYd;
  assert.ok(ball.x > 20, `the ball is ${ball.x.toFixed(1)} m right of the line`);
  assert.deepEqual([s.canDrop, s.rescue, s.drop.free, s.drop.cost, s.drop.lie], [true, false, false, 1, 'fairway']);
  assert.ok(Math.abs(s.drop.x) < 1e-9, 'the spot is on the line');
  assert.ok(s.drop.distToPinYd >= out - 0.01 && s.drop.distToPinYd < out + 1.2, `no nearer the hole, and no farther back than it need be: ${s.drop.distToPinYd} yd for ${out}`);
  const d = g.dropOnLine();
  assert.deepEqual([d.drop, d.free, d.rescue, d.penalty, d.strokes, d.lie, d.note], [true, false, false, 1, 2, 'fairway', 'Drop on the line (+1)']);
  assert.deepEqual(d.from, ball);
  s = g.state();
  assert.deepEqual([s.strokes, s.lie, s.aimOffset, s.ball, s.canDrop, s.canMulligan], [2, 'fairway', 0, d.end, false, true]);
  assert.equal(g.dropOnLine(), null, 'already on the line: nothing to take');
  // taken back like a shot, and it is no mulligan on the card
  assert.equal(g.mulligan(), true);
  s = g.state();
  assert.deepEqual([s.strokes, s.lie, s.ball, s.mulligans[0], s.canDrop], [1, 'rough', ball, 0, true]);
  // on the green: no drop; the hole over: no drop
  g.ball = { x: 3, y: 395 }; g.lie = 'green';
  assert.equal(g.state().canDrop, false);
  // a match's sudden death locks it
  g.ball = ball; g.lie = 'rough'; g.dropLocked = true;
  assert.equal(g.state().canDrop, false);
  assert.equal(g.dropOnLine(), null);
  g.dropLocked = false;
  // off without the assists, in practice, in a league round
  g.playAssist = null; assert.equal(g.dropOnLine(), null);
  g.playAssist = P.PLAY_ASSIST;
  g.leagueRound = { leagueId: 'l' }; assert.equal(g.state().canDrop, false); g.leagueRound = null;
  assert.equal(g.state().canDrop, true);
});

test('where the drop goes on the real stages: fairway or tee, on the line, a clear lie; a dead lie is free', () => {
  for (const id of ['canyon-run', 'temple-run', 'dragons-spine']) {
    const g = stageGame(id, P.PLAY_ASSIST);
    const ctx = ctxOf(g);
    const h = g.hole;
    const spots = sampleSpots(g, 60).filter((sp) => sp.lie === 'rough' || sp.lie === 'bunker');
    assert.ok(spots.length > 20, `${id}: ${spots.length} spots`);
    let moved = 0;
    for (const sp of spots) {
      const d = P.dropOnLineSpot(ctx, h, sp, { assist: P.PLAY_ASSIST });
      assert.ok(d.lie === 'fairway' || d.lie === 'tee', `${id} (${sp.x}, ${sp.y}): dropped on ${d.lie}`);
      assert.equal(g.surfaceAt(d.x, d.y), d.lie);
      const was = Math.hypot(h.pin[0] - sp.x, h.pin[1] - sp.y), now = Math.hypot(h.pin[0] - d.x, h.pin[1] - d.y);
      if (d.tee) assert.deepEqual([d.x, d.y], h.tee);
      else {
        assert.ok(now >= was - 1e-6, `${id} (${sp.x}, ${sp.y}): the drop is ${(was - now).toFixed(1)} m nearer the hole`);
        // on the routing line
        let off = Infinity;
        for (let i = 0; i + 1 < h.line.length; i++) {
          const [ax, ay] = h.line[i], [bx, by] = h.line[i + 1];
          const t = Math.max(0, Math.min(1, ((d.x - ax) * (bx - ax) + (d.y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
          off = Math.min(off, Math.hypot(d.x - ax - t * (bx - ax), d.y - ay - t * (by - ay)));
        }
        assert.ok(off < 1e-6, `${id}: ${off.toFixed(2)} m off the line`);
        assert.equal(P.isDeadLie(ctx, d, P.PLAY_ASSIST), false, `${id}: the drop spot at (${d.x.toFixed(0)}, ${d.y.toFixed(0)}) is a clear lie`);
        moved++;
      }
    }
    assert.ok(moved > spots.length / 3, `${id}: ${moved} of ${spots.length} drops are on the fairway behind the ball`);
  }
  // a dead lie on Dragon's Spine (every swing from there ends in a penalty): rescue, the drop is free
  const g = stageGame('dragons-spine', P.PLAY_ASSIST);
  const dead = { x: -204.5, y: 17.6 };
  assert.equal(P.lieReport(ctxOf(g), dead, { assist: P.PLAY_ASSIST }).dead, true);
  g.ball = { ...dead }; g.lie = g.surfaceAt(dead.x, dead.y); g.strokes = 1;
  const s = g.state();
  assert.deepEqual([s.canDrop, s.rescue, s.drop.free, s.drop.cost], [true, true, true, 0]);
  const d = g.dropOnLine();
  assert.deepEqual([d.free, d.rescue, d.penalty, d.strokes, d.note], [true, true, 0, 1, 'Free drop on the line']);
  assert.equal(g.state().rescue, false);
});

// ---------------------------------------------------------------- a scored solo run

test('a scored solo run counts the stroke of a drop on the line; a free drop costs nothing', () => {
  // The wiring of server.js: POST /api/drop is game.dropOnLine() and nothing else; every shot
  // the game plays is handed to the run, which takes the stroke count from the game's own
  // (result.strokes). So a drop's stroke rides on the next swing, and on the score of the stage.
  const { createSoloRun } = require('../lib/solo');
  const start = (g) => {
    const run = createSoloRun({ kind: 'stage', stages: [{ id: 's', name: 'S', file: 's.json', par: g.hole.par }] });
    assert.equal(run.stageReady(run.waiting.token), true);
    return run;
  };
  const holeOut = (g, run) => {   // a four-foot putt, straight at the cup
    g.ball = { x: g.hole.pin[0], y: g.hole.pin[1] - 1.2 }; g.lie = 'green';
    const r = g.handleShot(B(3.5, 0.5, 100));
    assert.equal(r.holed, true);
    return run.recordShot(r);
  };

  // a drop that costs: swing, drop (+1), putt = 3 strokes on the card
  const g = stageGame('canyon-run', P.PLAY_ASSIST);
  const run = start(g);
  let ev = run.recordShot(g.handleShot(B(150, 12, 2500, 9)));
  assert.deepEqual([ev.strokes, ev.stageOver], [1, false]);
  assert.deepEqual([g.state().canDrop, g.state().drop.free, g.state().drop.cost], [true, false, 1]);
  const d = g.dropOnLine();
  assert.deepEqual([d.penalty, d.free, d.strokes, g.state().strokes], [1, false, 2, 2]);
  ev = holeOut(g, run);
  assert.deepEqual([ev.stageOver, ev.holed, ev.strokes], [true, true, 3]);
  let st = run.state();
  assert.deepEqual([st.stages[0].strokes, st.stages[0].shots, st.totals.strokes, st.totals.toPar], [3, 2, 3, 3 - g.hole.par]);
  assert.equal(run.result().strokes, 3, 'the score kept as a best has the drop in it');

  // the same hole without the drop: one stroke fewer
  const g0 = stageGame('canyon-run', P.PLAY_ASSIST);
  const run0 = start(g0);
  run0.recordShot(g0.handleShot(B(150, 12, 2500, 9)));
  assert.equal(holeOut(g0, run0).strokes, 2);

  // a free drop out of a dead lie adds nothing: swing (given), free drop, putt = 2
  const gf = stageGame('dragons-spine', P.PLAY_ASSIST);
  const runF = start(gf);
  gf.ball = { x: -204.5, y: 17.6 }; gf.lie = gf.surfaceAt(-204.5, 17.6); gf.strokes = 1;
  assert.deepEqual([gf.state().rescue, gf.state().drop.free, gf.state().drop.cost], [true, true, 0]);
  const f = gf.dropOnLine();
  assert.deepEqual([f.free, f.penalty, f.strokes, gf.state().strokes], [true, 0, 1, 1]);
  assert.equal(holeOut(gf, runF).strokes, 2);
  assert.equal(runF.state().totals.strokes, 2);

  // and a swing that does not hole out says the same: swing, drop, swing = 3
  const gu = stageGame('canyon-run', P.PLAY_ASSIST);
  const runU = start(gu);
  runU.recordShot(gu.handleShot(B(150, 12, 2500, 9)));
  gu.dropOnLine();
  const third = runU.recordShot(gu.handleShot(B(30, 24, 4000)));
  assert.deepEqual([third.strokes, third.stageOver, runU.state().stages[0].shots], [3, false, 2]);
});

// ---------------------------------------------------------------- the match

const PLAYERS = [{ id: 'p1', name: 'Alex' }, { id: 'p2', name: 'Dave' }];
function startMatch(course, options = {}) {
  const g = newGame(course);
  const match = createMatch({ game: g, players: PLAYERS, random: () => 0.1, options: { format: 'quick', stage: 'current', powerups: 'off', ...options } });
  const toPlay = () => {
    for (;;) {
      const w = match.waiting;
      if (!w || w.for === 'dismiss') return;
      if (w.for === 'stage') assert.equal(match.stageReady(g, w.token), true);
      else if (w.for === 'ready') assert.equal(match.ready(g), true);
      else if (w.for === 'continue') assert.equal(match.continue(), true);
    }
  };
  const swing = (ball) => { const up = match.beforeShot(g); assert.ok(up, 'a swing counts'); const r = g.handleShot(ball); return { up: up.playerId, r, ev: match.afterShot(g, r) }; };
  const who = (id) => match.state().players.find((p) => p.id === id);
  toPlay();
  return { g, match, toPlay, swing, who };
}
const WIDE = B(150, 12, 2500, 7), DRIVE = B(152, 13, 2650), I7 = B(111, 19, 7000);

test('match.drop: for the player who is up, +1, in the log and the events, taken back by the undo', () => {
  const { g, match, swing, who } = startMatch(holeCourse());
  assert.equal(match.state().currentPlayerId, 'p1');
  assert.throws(() => match.drop(g, 'p1'), (e) => e instanceof MatchError && e.status === 409 && /no drop to take/i.test(e.message), 'on the tee there is none');
  swing(WIDE);                            // p1: 30 yd right, in the rough
  swing(DRIVE);                           // p2: down the middle, nearer
  assert.equal(match.state().currentPlayerId, 'p1');
  const s0 = g.state(), p0 = who('p1');
  assert.deepEqual([s0.canDrop, s0.rescue, p0.strokes, p0.lie], [true, false, 1, 'rough']);
  assert.throws(() => match.drop(g, 'p2'), (e) => e.status === 409 && /Alex's turn/.test(e.message));
  assert.throws(() => match.drop(g, 'nobody'), (e) => e.status === 404);
  const ev = match.drop(g, 'p1');
  assert.deepEqual([ev.event, ev.playerId, ev.drop, ev.free, ev.penalty, ev.strokes, ev.lie, ev.nextPlayerId], ['drop', 'p1', true, false, 1, 2, 'fairway', 'p1']);
  let m = match.state();
  const p1 = who('p1');
  assert.deepEqual([p1.strokes, p1.lie, p1.ball, p1.stats.shots], [2, 'fairway', ev.end, 1], 'a stroke, not a swing');
  const e = m.events.find((x) => x.type === 'drop');
  assert.deepEqual({ type: e.type, playerId: e.playerId, free: e.free, strokes: e.strokes }, { type: 'drop', playerId: 'p1', free: false, strokes: 2 });
  assert.ok(m.log.some((l) => l.text === 'Alex drops back on the line: +1 (2).'));
  assert.deepEqual(m.undoable, { playerId: 'p1', stray: false, holeNumber: 1, drop: true });
  assert.deepEqual([g.ball, g.strokes, g.lie], [ev.end, 2, 'fairway'], 'the bay shows the dropped ball');
  // undo: the ball, the stroke and the aim are back
  const undone = match.undoLastShot(g);
  assert.deepEqual(undone, { event: 'shot-undone', playerId: 'p1', stray: false, from: 'play', drop: true });
  m = match.state();
  assert.deepEqual([who('p1').strokes, who('p1').lie, who('p1').ball, m.currentPlayerId, m.undoable], [1, 'rough', p0.ball, 'p1', null]);
  assert.deepEqual([g.ball, g.strokes, g.state().canDrop], [p0.ball, 1, true]);
  assert.ok(m.log.some((l) => l.text === 'Alex\'s drop is taken back.'));
  // a swing after a drop makes the swing the thing that is undone
  match.drop(g, 'p1');
  swing(I7);
  assert.equal(match.state().undoable.drop, undefined);
});

test('match.drop counts for the knockout and the stroke cap', () => {
  // a par 3 of 150 yd: p2 is in with 2 (a 7-iron to 6 ft, the tap-in); p1, out in the rough with 1,
  // must hole the next one. A drop makes it 2 without the ball in the hole: a knockout.
  const short = holeCourse(3, 150 * YD);
  let t = startMatch(short);
  t.swing(B(111, 19, 7000, 12));          // p1: wide of the green
  assert.equal(t.who('p1').lie, 'rough');
  const in2 = t.swing(I7);                // p2
  assert.deepEqual([in2.r.holed, t.who('p2').strokes, t.match.state().currentPlayerId, t.who('p1').mustHole], [true, 2, 'p1', true]);
  const ev = t.match.drop(t.g, 'p1');
  // (a quick match: the hole is the match)
  assert.deepEqual([ev.event, ev.winnerId, ev.drop, ev.free, ev.strokes], ['match-over', 'p2', true, false, 2]);
  let m = t.match.state();
  assert.deepEqual([m.phase, m.winnerId, m.lastResult.reason, m.lastResult.scores, m.undoable.drop], ['done', 'p2', 'knockout', { p1: 2, p2: 2 }, true]);
  assert.ok(m.log.some((l) => /^KNOCKOUT! Alex can't catch that/.test(l.text)));
  // ... and the undo brings the hole back to life
  t.match.undoLastShot(t.g);
  m = t.match.state();
  assert.deepEqual([m.phase, m.winnerId, m.currentPlayerId, t.who('p1').strokes, t.who('p1').mustHole], ['play', null, 'p1', 1, true]);

  // the stroke cap (par + 3): strokes 5 and a drop is 6 on a par 3: out of strokes
  t = startMatch(short);
  const wide = B(40, 20, 3000, 40);       // a few yards, well off the line
  t.swing(wide);                          // p1: 1
  t.swing(B(111, 19, 7000, 12));          // p2: wide of the green, but far nearer
  for (let n = 2; n <= 5; n++) {
    assert.equal(t.match.state().currentPlayerId, 'p1');
    if (n % 2 === 0) t.match.drop(t.g, 'p1'); else t.swing(wide);
    assert.equal(t.who('p1').strokes, n);
  }
  assert.equal(t.who('p1').capped, false);
  const capEv = t.match.drop(t.g, 'p1');
  assert.equal(STROKE_CAP, 3);
  assert.deepEqual([t.who('p1').strokes, t.who('p1').capped, capEv.event, capEv.nextPlayerId], [6, true, 'drop', 'p2']);
  assert.ok(t.match.state().log.some((l) => l.text === 'Alex is out of strokes (6).'));
});

test('match.drop: free out of a dead lie; never in a sudden death', () => {
  // Dragon's Spine: a ball on the dead lie behind the tee
  const g = stageGame('dragons-spine', P.PLAY_ASSIST);
  const match = createMatch({ game: g, players: PLAYERS, random: () => 0.1, options: { format: 'quick', stage: 'current', powerups: 'off' } });
  assert.equal(match.stageReady(g, match.waiting.token), true);
  assert.equal(match.ready(g), true);
  // (the tee shot of this stage is played with its free Rocket ball, as the server arms it)
  const swing = (ball, aim = 0) => {
    const up = match.beforeShot(g);
    g.setAimOffset(aim);
    g.shotMods = modifiersFor(up.armed, { dispersion: 1, putting: 'easy', tapInFt: 8 });
    const r = g.handleShot(ball);
    g.shotMods = null;
    return match.afterShot(g, r);
  };
  swing(B(70, 20, 3000, -40), -45);       // p1 (playability-e2e's tee shot): dead
  swing(B(150, 13, 2600));                // p2
  assert.equal(match.state().currentPlayerId, 'p1');
  assert.deepEqual([g.state().rescue, g.state().drop.free], [true, true]);
  const ev = match.drop(g);               // no id: whoever is up
  assert.deepEqual([ev.event, ev.playerId, ev.free, ev.penalty, ev.strokes], ['drop', 'p1', true, 0, 1]);
  const m = match.state();
  assert.ok(m.log.some((l) => l.text === 'Alex takes a FREE DROP back on the line.'));
  assert.equal(m.events.find((e) => e.type === 'drop').free, true);

  // a tied par 3 goes to sudden death on the same hole: no drop there
  const t = startMatch(holeCourse(3, 150 * YD));
  t.swing(I7); t.swing(I7);
  assert.equal(t.match.state().phase, 'hole-result');
  t.toPlay();
  assert.equal(t.match.state().phase, 'tiebreak');
  assert.equal(t.g.dropLocked, true);
  assert.equal(t.g.state().canDrop, false);
  assert.throws(() => t.match.drop(t.g), (e) => e instanceof MatchError && e.status === 409 && /sudden death/.test(e.message));
});

// ---------------------------------------------------------------- the match menu's item

test('the match menu offers the drop to the player who is up: FREE DROP in one press, +1 asks once', () => {
  const { menuItems } = require('../public/arcade/match.js');
  const m = { id: 'm1', phase: 'play', holeNumber: 1, currentPlayerId: 'p1', undoable: null, canRestartHole: true, players: [{ id: 'p1', name: 'Alex Morgan', slot: 1 }, { id: 'p2', name: 'Dave', slot: 2 }] };
  const ids = (list) => list.map((x) => x.id);
  assert.equal(ids(menuItems(m)).includes('drop'), false, 'no game state, no drop');
  assert.equal(ids(menuItems(m, { canDrop: false, drop: null })).includes('drop'), false);
  const paid = menuItems(m, { canDrop: true, rescue: false, drop: { x: 0, y: 250, free: false, cost: 1, distToPinYd: 247.4 } });
  assert.deepEqual(ids(paid).slice(0, 3), ['resume', 'undo', 'drop']);
  const d = paid[2];
  assert.deepEqual([d.label, d.on, d.ask.title], ['DROP ON THE LINE', true, 'DROP ON THE LINE?']);
  assert.match(d.sub, /ALEX.*\+1 STROKE/);
  const free = menuItems(m, { canDrop: true, rescue: true, drop: { x: 0, y: 0, free: true, cost: 0, distToPinYd: 603.7 } })[2];
  assert.deepEqual([free.label, free.ask], ['FREE DROP', null]);
  assert.match(free.sub, /NO PENALTY · 604 YD OUT/);
  // not in a sudden death, not on a result screen; an undoable drop reads as one
  assert.equal(ids(menuItems({ ...m, phase: 'tiebreak' }, { canDrop: true, drop: { x: 0, y: 0, free: false } })).includes('drop'), false);
  assert.equal(ids(menuItems({ ...m, phase: 'hole-result', currentPlayerId: null }, { canDrop: true, drop: { x: 0, y: 0, free: false } })).includes('drop'), false);
  const undo = menuItems({ ...m, undoable: { playerId: 'p2', stray: false, holeNumber: 1, drop: true } })[1];
  assert.deepEqual([undo.label, undo.on], ['UNDO THE DROP', true]);
  assert.match(undo.sub, /DAVE'S DROP/);
});

// ---------------------------------------------------------------- the hole guard

// The audit on every stage with the assists on (a 30 m grid here: the 15 m round cliffs and
// trees at 15 m, sand at 7.5 m; tools/arcade-dev/playability-audit.mjs runs it at 12 m).
//   stuck   dead spots where no swing even moves: the ground or a tree stops every one. The
//           kind that feels like a bug: there are to be (next to) none.
//   dead    stuck, or every swing that flies ends in a penalty: a forced carry (an island
//           green from the wrong side, the foot of a fortress). The hole's design; the
//           stages built round one are allowed more of them, and every one is a FREE DROP.
//   flag    good swings straight at the flag that are stopped dead (no penalty, under 30 % of
//           the club's level carry): what is left is real walls, the crater of Volcano Drop
//           above all (its rim and inner slopes are far over the 6 m the clearance forgives;
//           another club or another line gets out, so the spots are not dead)
const GUARD_STEP = 30;
const DEAD_MAX = { default: 2, 'sky-fortress': 6, 'bullseye-bay': 16, 'sakura-garden': 3, 'dragons-spine': 3 };
const STUCK_MAX_PCT = 0.25;
const FLAG_MAX = { default: 8, 'volcano-drop': 55, 'bullseye-bay': 25, 'sky-fortress': 14, 'dragons-spine': 12, 'summit-express': 12 };
const FLAG_MAX_ALL = 9;      // over every stage (19.3 % in the plain simulator, 6.1 % with the assists, on the 12 m grid)

test('hole guard: with the assists on no stage has more than a few dead spots, sand always lets go, a dead spot is a free drop', { timeout: 600000 }, (t) => {
  const rows = stageIds().map((id) => auditStage(id, { assist: true, step: GUARD_STEP }));
  t.diagnostic(`\n${table(rows)}`);
  assert.equal(rows.length, 15, 'the twelve stages and the three arenas');
  const all = (k) => rows.reduce((s, r) => s + r[k], 0);
  assert.ok(100 * all('flagKilled') / all('flagSwings') <= FLAG_MAX_ALL, `${(100 * all('flagKilled') / all('flagSwings')).toFixed(1)} % of swings at the flag are stopped dead over all stages (at most ${FLAG_MAX_ALL})`);
  assert.ok(100 * all('dead') / all('spots') <= 2, `${(100 * all('dead') / all('spots')).toFixed(2)} % of all spots are dead`);
  assert.ok(all('stuck') <= 3, `${all('stuck')} stuck spots in all`);
  for (const r of rows) {
    const id = r.id;
    assert.ok(r.spots >= 60, `${id}: ${r.spots} spots sampled`);
    const deadMax = DEAD_MAX[id] ?? DEAD_MAX.default, flagMax = FLAG_MAX[id] ?? FLAG_MAX.default;
    assert.ok(r.deadPct <= deadMax, `${id}: ${r.deadPct} % of spots are dead (at most ${deadMax})`);
    assert.ok(r.stuckPct <= STUCK_MAX_PCT, `${id}: ${r.stuckPct} % of spots are stuck (at most ${STUCK_MAX_PCT})`);
    assert.ok(r.flagKillPct <= flagMax, `${id}: ${r.flagKillPct} % of swings at the flag are stopped dead (at most ${flagMax})`);
    assert.equal(r.bunkerUnder10, 0, `${id}: ${r.bunkerUnder10} of ${r.bunkerSwings} swings out of sand travel under 10 yd (shortest ${r.bunkerMinYd} yd)`);
    assert.equal(r.bunkerDead, 0, `${id}: no dead lie in sand`);
    // every dead spot that remains is covered by the free drop, and the drop is somewhere playable
    const g = stageGame(id, P.PLAY_ASSIST);
    const ctx = ctxOf(g);
    for (const sp of r.deadSpots) {
      g.ball = { x: sp.x, y: sp.y }; g.lie = sp.lie; g.strokes = 1; g.holed = false;
      const s = g.state();
      const onTee = sp.x === g.hole.tee[0] && sp.y === g.hole.tee[1];
      if (onTee) continue;
      assert.deepEqual([s.canDrop, s.rescue, s.drop && s.drop.free], [true, true, true], `${id}: the dead spot (${sp.x}, ${sp.y}) offers a free drop`);
      assert.ok(s.drop.lie === 'fairway' || s.drop.lie === 'tee');
      if (s.drop.lie === 'fairway') assert.equal(P.isDeadLie(ctx, s.drop, P.PLAY_ASSIST), false, `${id}: its drop spot is a clear lie`);
    }
  }
});

test('the stages\' own suites hold with the assists on: the walls still block, the rocket routes are still the rocket routes', { timeout: 600000 }, (t) => {
  const root = path.join(__dirname, '..');
  const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=./test/helpers/play-assist-on.cjs`.trim() };
  delete env.NODE_TEST_CONTEXT;           // the child is a test run of its own, not a part of this one
  const files = ['arcade-holes.test.js', 'arcade-holes-a.test.js', 'arcade-holes-b.test.js', 'arcade-holes-x.test.js'].map((f) => path.join('test', f));
  const out = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd: root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const text = `${out.stdout}\n${out.stderr}`;
  const num = (k) => Number((new RegExp(`^# ${k} (\\d+)`, 'm').exec(text) || [])[1]);
  t.diagnostic(`hole suites with the play assists on: ${num('pass')} of ${num('tests')} pass`);
  const failures = text.split('\n').filter((l) => /^\s*not ok /.test(l)).slice(0, 12).join('\n');
  assert.equal(out.status, 0, `the hole suites fail with the assists on:\n${failures}`);
  assert.ok(num('tests') >= 70 && num('fail') === 0, `${num('tests')} tests, ${num('fail')} failed`);
});
