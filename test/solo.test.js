'use strict';
// Solo play (lib/solo.js): a run's state machine and its scoring (a tour, a single stage,
// free play), the pick-up that keeps a run from being stuck, the best shots, and the best
// scores kept on disk.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSoloRun, createSoloBests, betterResult, scoreName, relText, SoloError, PICKUP_OVER, GIVE_UP_OVER } = require('../lib/solo');

const STAGES = [
  { id: 'a', name: 'Alpha', file: 'a.json', par: 3, lengthYd: 150, theme: 'tropical' },
  { id: 'b', name: 'Bravo', file: 'b.json', par: 4, lengthYd: 350, theme: 'canyon' },
  { id: 'c', name: 'Charlie', file: 'c.json', par: 5, lengthYd: 520, theme: 'jungle' },
];
const shot = (strokes, { holed = false, points = 100, coins = 10, callout = null, grade = 'good' } = {}) => ({
  strokes, holed, arcade: { grade, points, coins, callout },
});
// load the stage that is waiting, then play the strokes given (the last one holes out)
function playStage(run, strokes, extra = {}) {
  const w = run.waiting;
  assert.ok(w, 'a stage is waiting to be loaded');
  assert.equal(run.stageReady(w.token), true);
  let ev = null;
  for (let n = 1; n <= strokes; n++) ev = run.recordShot(shot(n, { holed: n === strokes, ...extra }));
  return ev;
}

test('a tour: stage after stage, strokes against par, a total, the results', () => {
  const run = createSoloRun({ kind: 'tour', stages: STAGES, player: { id: 'p1', name: 'Alex' } });
  assert.equal(run.phase, 'loading');
  assert.equal(run.acceptsSwing, false);
  assert.deepEqual(run.waiting, { for: 'stage', token: 1, stageId: 'a', file: 'a.json' });
  assert.equal(run.recordShot(shot(1)), null);                 // a swing while the course loads is nobody's
  assert.equal(run.stageReady(99), false);                     // a stale answer
  assert.equal(run.stageReady(1), true);
  assert.equal(run.phase, 'play');
  assert.equal(run.waiting, null);

  assert.deepEqual(run.recordShot(shot(1)), { stageOver: false, holed: false, pickedUp: false, strokes: 1 });
  assert.deepEqual(run.recordShot(shot(2, { holed: true })), { stageOver: true, holed: true, pickedUp: false, strokes: 2 });
  assert.equal(run.phase, 'stage-result');
  assert.equal(run.acceptsSwing, false);                       // not over a result card either
  let s = run.state();
  assert.equal(s.stages[0].strokes, 2);
  assert.equal(s.stages[0].toPar, -1);
  assert.equal(s.stages[0].scoreName, 'BIRDIE');
  assert.equal(s.stages[0].points, 200);
  assert.deepEqual([s.totals.strokes, s.totals.par, s.totals.toPar, s.totals.toParText, s.totals.played, s.totals.complete], [2, 3, -1, '-1', 1, false]);

  run.next();
  assert.equal(run.phase, 'loading');
  assert.equal(run.waiting.stageId, 'b');
  assert.equal(run.waiting.token, 2);
  playStage(run, 5);                                            // a bogey on the par 4
  run.next();
  playStage(run, 5);                                            // par on the par 5: the last stage
  assert.equal(run.phase, 'done');
  assert.equal(run.active, false);
  s = run.state();
  assert.deepEqual(s.stages.map((x) => x.scoreName), ['BIRDIE', 'BOGEY', 'PAR']);
  assert.deepEqual([s.totals.strokes, s.totals.par, s.totals.toPar, s.totals.toParText, s.totals.complete], [12, 12, 0, 'E', true]);
  assert.equal(s.newBest, true);                                // there was no best to beat
  assert.deepEqual(run.result(), { kind: 'tour', playerId: 'p1', playerName: 'Alex', stageId: null, strokes: 12, par: 12, toPar: 0, points: 1200, stages: 3, at: run.state().endedAt });
  assert.throws(() => run.next(), SoloError);
});

test('a tour can be the first few stages only', () => {
  const run = createSoloRun({ kind: 'tour', stages: STAGES.slice(0, 2) });
  playStage(run, 3);
  run.next();
  playStage(run, 4);
  assert.equal(run.phase, 'done');
  assert.equal(run.result().stages, 2);
  assert.equal(run.state().player.name, 'Player 1');           // a guest
  assert.equal(run.result().playerId, null);
});

test('a single stage ends in its results; free play tees up again and keeps nothing', () => {
  const one = createSoloRun({ kind: 'stage', stages: [STAGES[1], STAGES[2]], best: { strokes: 3, toPar: -1, points: 900 } });
  assert.equal(one.state().stages.length, 1);                   // one stage, whatever came with it
  playStage(one, 4);
  assert.equal(one.phase, 'done');
  assert.equal(one.state().newBest, false);                     // 4 does not beat 3
  assert.equal(one.result().stageId, 'b');

  const free = createSoloRun({ kind: 'free', stages: [STAGES[0]] });
  playStage(free, 3);
  assert.equal(free.phase, 'stage-result');                     // never 'done'
  assert.equal(free.result(), null);                            // nothing for the best-score store
  free.next();
  assert.equal(free.waiting.stageId, 'a');                      // the same stage again
  assert.equal(free.state().stages[0].strokes, null);
  playStage(free, 2);
  assert.equal(free.state().stages[0].strokes, 2);
  assert.equal(free.state().canGiveUp, false);
});

test('a stage cannot go on for ever: the pick-up, and giving it up', () => {
  const run = createSoloRun({ kind: 'tour', stages: STAGES });
  run.stageReady(run.waiting.token);
  let ev = null;
  for (let n = 1; n <= 3 + PICKUP_OVER; n++) ev = run.recordShot(shot(n));
  assert.deepEqual(ev, { stageOver: true, holed: false, pickedUp: true, strokes: 3 + PICKUP_OVER + 1 });
  assert.equal(run.state().stages[0].scoreName, 'PICKED UP');
  assert.equal(run.state().stages[0].pickedUp, true);
  assert.equal(run.phase, 'stage-result');

  run.next();
  run.stageReady(run.waiting.token);
  assert.equal(run.state().canGiveUp, true);
  assert.deepEqual(run.giveUp(1), { stageOver: true, holed: false, pickedUp: true, strokes: 4 + GIVE_UP_OVER });   // never cheaper than that
  run.next();
  run.stageReady(run.waiting.token);
  for (let n = 1; n <= 9; n++) run.recordShot(shot(n));
  assert.equal(run.giveUp(9).strokes, 10);                      // nor cheaper than the strokes already played plus one
  assert.equal(run.phase, 'done');
  assert.throws(() => run.giveUp(0), SoloError);
});

test('restart: a single stage and free play go back to the tee; a tour is played straight through', () => {
  const tour = createSoloRun({ kind: 'tour', stages: STAGES });
  tour.stageReady(tour.waiting.token);
  tour.recordShot(shot(1));
  assert.throws(() => tour.restartStage(), /tour/i);
  assert.equal(tour.state().canRestartStage, false);

  const one = createSoloRun({ kind: 'stage', stages: [STAGES[0]] });
  one.stageReady(one.waiting.token);
  one.recordShot(shot(1, { callout: { text: 'DART!', tone: 'good' } }));
  one.restartStage();
  assert.equal(one.phase, 'loading');
  assert.equal(one.waiting.token, 2);
  assert.equal(one.state().stages[0].points, 0);
  assert.deepEqual(one.state().bestShots, []);                  // the wiped attempt's shots are gone too
});

test('the best shots are the loud ones, epic first', () => {
  const run = createSoloRun({ kind: 'tour', stages: STAGES });
  run.stageReady(run.waiting.token);
  run.recordShot(shot(1, { points: 300, callout: { text: 'DART!', tone: 'good' } }));
  run.recordShot(shot(2, { points: 50, callout: { text: 'IN THE DRINK!', tone: 'bad' } }));   // not a best shot
  run.recordShot(shot(3, { points: 900, callout: { text: 'GREAT SHOT!', tone: 'good' } }));
  run.recordShot(shot(4, { holed: true, points: 500, callout: { text: 'DRAINED IT!', tone: 'epic' } }));
  run.next();
  run.stageReady(run.waiting.token);
  run.recordShot(shot(1, { points: 100, callout: { text: 'STRIPED IT!', tone: 'good' } }));
  const best = run.state().bestShots;
  assert.deepEqual(best.map((b) => b.text), ['DRAINED IT!', 'GREAT SHOT!', 'DART!']);
  assert.equal(best[0].stageName, 'Alpha');
});

test('a stage that will not load ends the run with the reason; an abort is final', () => {
  const run = createSoloRun({ kind: 'tour', stages: STAGES });
  assert.equal(run.stageFailed(run.waiting.token, 'no such file'), true);
  assert.equal(run.aborted, true);
  assert.equal(run.state().error, 'no such file');
  assert.equal(run.acceptsSwing, false);
  assert.equal(run.result(), null);

  const other = createSoloRun({ kind: 'tour', stages: STAGES });
  other.abort();
  assert.equal(other.active, false);
  assert.equal(other.waiting, null);
  assert.throws(() => createSoloRun({ kind: 'tour', stages: [] }), /not installed/);
  assert.throws(() => createSoloRun({ kind: 'nope', stages: STAGES }), SoloError);
});

test('fewer strokes is better; level on strokes, more points', () => {
  assert.equal(betterResult({ strokes: 10, points: 0 }, null), true);
  assert.equal(betterResult(null, { strokes: 10 }), false);
  assert.equal(betterResult({ strokes: 9, points: 1 }, { strokes: 10, points: 999 }), true);
  assert.equal(betterResult({ strokes: 10, points: 500 }, { strokes: 10, points: 400 }), true);
  assert.equal(betterResult({ strokes: 10, points: 400 }, { strokes: 10, points: 400 }), false);
  assert.equal(scoreName(1, 3), 'HOLE IN ONE');
  assert.equal(scoreName(2, 5), 'ALBATROSS');
  assert.equal(scoreName(2, 4), 'EAGLE');
  assert.equal(scoreName(6, 4), 'DOUBLE BOGEY');
  assert.equal(scoreName(8, 4), '+4');
  assert.equal(relText(0), 'E');
});

test('the best scores are kept on disk, per player, per tour length and per stage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-solo-'));
  const bests = createSoloBests({ dataDir: dir });
  assert.equal(bests.get({ kind: 'tour', playerId: 'p1', stages: 3 }), null);

  let r = bests.offer({ kind: 'tour', playerId: 'p1', playerName: 'Alex', strokes: 12, toPar: 0, points: 1000, stages: 3, at: 5 });
  assert.equal(r.newBest, true);
  r = bests.offer({ kind: 'tour', playerId: 'p1', strokes: 13, toPar: 1, points: 5000, stages: 3 });   // worse: the best stands
  assert.equal(r.newBest, false);
  assert.equal(r.best.strokes, 12);
  r = bests.offer({ kind: 'tour', playerId: 'p1', strokes: 12, toPar: 0, points: 1500, stages: 3 });   // level, more points
  assert.equal(r.newBest, true);
  // another length, another player, a guest: all their own
  assert.equal(bests.offer({ kind: 'tour', playerId: 'p1', strokes: 50, toPar: 6, points: 1, stages: 12 }).newBest, true);
  assert.equal(bests.offer({ kind: 'tour', playerId: 'p2', strokes: 20, toPar: 8, points: 1, stages: 3 }).newBest, true);
  assert.equal(bests.offer({ kind: 'tour', playerId: null, strokes: 30, toPar: 18, points: 1, stages: 3 }).newBest, true);
  assert.equal(bests.get({ kind: 'tour', playerId: 'p1', stages: 3 }).points, 1500);
  assert.equal(bests.get({ kind: 'tour', playerId: 'p1', stages: 12 }).strokes, 50);
  assert.equal(bests.get({ kind: 'tour', playerId: null, stages: 3 }).strokes, 30);
  // a single stage
  assert.equal(bests.offer({ kind: 'stage', playerId: 'p1', stageId: 'a', strokes: 2, toPar: -1, points: 800 }).newBest, true);
  assert.equal(bests.offer({ kind: 'stage', playerId: 'p1', stageId: 'a', strokes: 3, toPar: 0, points: 900 }).newBest, false);
  assert.equal(bests.get({ kind: 'stage', playerId: 'p1', stageId: 'a' }).strokes, 2);
  assert.equal(bests.get({ kind: 'stage', playerId: 'p1', stageId: 'b' }), null);
  assert.equal(bests.offer({ kind: 'free', playerId: 'p1', stageId: 'a', strokes: 1 }).newBest, false);   // free play keeps nothing
  assert.equal(bests.offer(null).newBest, false);

  // on disk: a second store reads what the first wrote
  const again = createSoloBests({ dataDir: dir });
  assert.equal(again.get({ kind: 'tour', playerId: 'p1', stages: 3 }).points, 1500);
  assert.equal(again.get({ kind: 'stage', playerId: 'p1', stageId: 'a' }).strokes, 2);
  assert.deepEqual(Object.keys(again.all().tours).sort(), ['12', '3']);
  // a removed player's scores go with them, nobody else's
  again.forget('p1');
  const third = createSoloBests({ dataDir: dir });
  assert.equal(third.get({ kind: 'tour', playerId: 'p1', stages: 3 }), null);
  assert.equal(third.get({ kind: 'stage', playerId: 'p1', stageId: 'a' }), null);
  assert.equal(third.get({ kind: 'tour', playerId: 'p2', stages: 3 }).strokes, 20);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a run measured against a stored best says whether it beat it', () => {
  const run = createSoloRun({ kind: 'tour', stages: STAGES.slice(0, 2), best: { strokes: 7, toPar: 0, points: 100 } });
  playStage(run, 3);
  run.next();
  playStage(run, 3);
  assert.equal(run.state().newBest, true);                      // 6 beats 7
  const worse = createSoloRun({ kind: 'tour', stages: STAGES.slice(0, 2), best: { strokes: 5, toPar: -2, points: 100 } });
  playStage(worse, 3);
  worse.next();
  playStage(worse, 3);
  assert.equal(worse.state().newBest, false);
  assert.equal(worse.state().best.strokes, 5);
});
