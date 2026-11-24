'use strict';
// v3:modes BULLSEYE (lib/bullseye.js, docs/modes.md): darts with a golf ball on an arena's
// painted target. The ring table read from the arena's target-ring props, what a ball is
// worth, the multiplier of a turn, turn order and who leads off a round, the high-score
// game and the countdown (the check out and the answer to it, bust, the round cap), level games, the swing gate,
// the tee request, undo, restart, the stray-ball mark, the state shape, and the store of
// high scores and the nearest ball of the night.
//
// The game is a pure state machine: these tests are its driver. Most balls are placed by
// hand (the engine scores a ball where the game says it lies); a few are real swings.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Game } = require('../lib/game');
const {
  createBullseye, createBullseyeBests, BullseyeError, ringTable, ringsFromCourse, scoreBall, multFor, cleanOptions, nightKey,
  DEFAULTS, COUNTDOWN_ROUNDS, DEFAULT_RINGS_M, TIMEOUTS,
} = require('../lib/bullseye');

// ---------- an arena ----------
// 120 yd due north, a green 20 m round the pin, a lake from 40 m past it, five rings.
const PIN_Y = 120 * 0.9144;
const ring = (d, extra = {}) => ({ id: `r${d}`, kind: 'target-ring', x: 0, y: PIN_Y, rotDeg: 0, heightM: d, ...extra });
const arenaCourse = (rings = [38, 30, 22, 14, 6]) => ({
  name: 'Test Arena', kind: 'arena', surfaces: [], boundary: null, elevation: null,
  holes: [{ ref: 1, par: 3, tee: [0, 0], pin: [0, PIN_Y], lengthYd: 120, line: [[0, 0], [0, PIN_Y]] }],
  props: [...rings.map((d) => ring(d)), { id: 'tree', kind: 'palm', x: 30, y: 50, heightM: 12 }],
  arcade: { theme: 'tropical' },
});
const surfaces = () => (x, y) => (Math.hypot(x, y - PIN_Y) < 20 ? 'green' : y > PIN_Y + 40 ? 'water' : 'fairway');
const newGame = (course = arenaCourse()) => { const g = new Game({ surfaceLookupFactory: surfaces }); g.setCourse(course); return g; };
const ARENA = { id: 'a1', name: 'Test Arena', file: 'a1.json', lengthYd: 120, theme: 'tropical', timeOfDay: 'day', blurb: 'A target.' };
const FOUR = [{ id: 'p1', name: 'Alex' }, { id: 'p2', name: 'Blair' }, { id: 'p3', name: 'Casey' }, { id: 'p4', name: 'Drew' }];

function start(options = {}, { players = FOUR.slice(0, 2), game = newGame(), now = () => 1000, timeouts } = {}) {
  const be = createBullseye({ players, arena: ARENA, options, now, random: () => 0.5, timeouts });
  assert.equal(be.waiting.for, 'stage');
  assert.equal(be.stageReady(game, be.waiting.token, { wind: { mph: 7, dirDeg: 90, label: '7 MPH' } }), true);
  return { be, game };
}
// A ball placed by hand `r` metres from the pin (at `deg` round it: 0 is long, 90 right).
// { miss: 'water' | 'ob' }: a lost ball; { holed: true }: in the cup; { mph }: the launch speed.
function ball(be, game, r, { deg = 0, miss = null, holed = false, mph = 90 } = {}) {
  const pre = be.beforeShot(game);
  if (!pre) return null;
  assert.deepEqual([game.ball.x, game.ball.y, game.lie, game.strokes], [0, 0, 'tee', 0], 'every ball is hit from the tee');
  const rad = deg * Math.PI / 180;
  const at = { x: Math.sin(rad) * r, y: PIN_Y + Math.cos(rad) * r };
  const result = { launch: { speedMph: mph }, sim: { isPutt: false, points: [{ x: 0, y: 0, t: 0 }, { ...at, t: 3 }], events: [] }, penalty: 0, lie: 'green', holed: false, note: '' };
  if (miss) {
    result.penalty = 1; result.note = miss === 'water' ? 'Water — lateral drop (+1)' : 'Out of bounds — drop where it left (+1)';
    game.ball = { x: 0, y: PIN_Y - 30 }; game.strokes = 2; game.lie = 'fairway';   // where the game dropped it
  } else {
    game.ball = holed ? { x: 0, y: PIN_Y } : at;
    game.strokes = 1; game.lie = r < 20 ? 'green' : 'fairway'; result.lie = game.lie;
    if (holed) { game.holed = true; game.over = true; game.scores[0] = 1; result.holed = true; }
  }
  return be.afterShot(game, result);
}
const pl = (be, id) => be.state().players.find((p) => p.id === id);

// ---------- the target ----------

test('the ring table: read from the arena\'s target-ring props (diameters), the bullseye inside, 5 / 10 / 15 / 25 from the outside in', () => {
  assert.deepEqual(ringsFromCourse(arenaCourse(), [0, PIN_Y]), [
    { r: 3, value: 50, name: 'BULLSEYE' }, { r: 7, value: 25, name: 'INNER RING' }, { r: 11, value: 15, name: 'MIDDLE RING' },
    { r: 15, value: 10, name: 'OUTER RING' }, { r: 19, value: 5, name: 'EDGE RING' },
  ]);
  // Thunder Dome has four: the outside still starts at 5, the inside is still the bullseye
  assert.deepEqual(ringsFromCourse(arenaCourse([6, 14, 24, 36]), [0, PIN_Y]).map((r) => [r.r, r.value]), [[3, 50], [7, 15], [12, 10], [18, 5]]);
  assert.deepEqual(ringTable([19, 3]).map((r) => r.value), [50, 5]);
  assert.deepEqual(ringTable([4]).map((r) => r.value), [50]);
  assert.deepEqual(ringTable([1, 2, 3, 4, 5, 6, 7]).map((r) => r.value), [50, 25, 25, 25, 15, 10, 5]);
  assert.deepEqual(ringTable([7, 7, 3, -1, 'x']).map((r) => r.r), [3, 7], 'a ring given twice is one ring; rubbish is ignored');
  // a ring that is not round the pin is scenery; no rings at all: the default target
  const stray = arenaCourse([6]);
  stray.props.push(ring(60, { x: 80, y: 10 }));
  assert.deepEqual(ringsFromCourse(stray, [0, PIN_Y]).map((r) => r.r), [3]);
  assert.deepEqual(ringsFromCourse({ props: [] }, [0, 0]).map((r) => r.r), [...DEFAULT_RINGS_M]);
  assert.deepEqual(ringsFromCourse(null, null).map((r) => r.r), [...DEFAULT_RINGS_M]);
});

test('what a ball is worth: the ring it finishes in, the line counts as in, nothing outside, a lost ball is a miss', () => {
  const rings = ringTable([3, 7, 11, 15, 19]);
  const worth = (distM, extra = {}) => scoreBall({ distM, ...extra }, rings);
  assert.deepEqual(worth(0), { ring: 0, value: 50, name: 'BULLSEYE', zone: 'ring' });
  assert.equal(worth(3).value, 50, 'on the line is in');
  assert.equal(worth(3.01).value, 25);
  assert.deepEqual([worth(7.5).value, worth(11.2).value, worth(15.5).value, worth(19).value], [15, 10, 5, 5]);
  assert.deepEqual(worth(19.3), { ring: null, value: 0, name: 'OFF THE TARGET', zone: 'off' });
  assert.deepEqual(worth(2, { miss: 'water' }), { ring: null, value: 0, name: 'MISS', zone: 'miss' });
  assert.equal(worth(12, { holed: true }).value, 50, 'a holed ball is a bullseye wherever the sum puts it');
  assert.deepEqual([multFor(0), multFor(1), multFor(2), multFor(3), multFor(9)], [1, 2, 3, 3, 3]);
});

test('the options: three rounds of three by default; a countdown from 100 capped at six rounds; rubbish is put right', () => {
  assert.deepEqual(cleanOptions(), { variant: 'high', rounds: 3, balls: 3, target: null });
  assert.deepEqual(cleanOptions({ variant: 'countdown' }), { variant: 'countdown', rounds: 6, balls: 3, target: 100 });
  assert.deepEqual(cleanOptions({ variant: 'countdown', target: 300 }), { variant: 'countdown', rounds: 14, balls: 3, target: 300 });
  assert.deepEqual(cleanOptions({ variant: 'countdown', target: 301, rounds: 2 }), { variant: 'countdown', rounds: 2, balls: 3, target: 100 });
  assert.deepEqual(cleanOptions({ variant: 'HIGH', rounds: 99, balls: 0 }), { variant: 'high', rounds: 20, balls: 1, target: null });
  assert.deepEqual([DEFAULTS.rounds, DEFAULTS.balls, COUNTDOWN_ROUNDS[200]], [3, 3, 10]);
});

test('who can play: one to four different players, on an arena', () => {
  const mk = (players, arena = ARENA) => () => createBullseye({ players, arena });
  assert.throws(mk([]), BullseyeError);
  assert.throws(mk([...FOUR, { id: 'p5', name: 'Eve' }]), /one to four/);
  assert.throws(mk([FOUR[0], FOUR[0]]), /different/);
  assert.throws(mk([{ id: 'x' }]), /id and a name/);
  assert.throws(mk(FOUR, null), (e) => e instanceof BullseyeError && e.status === 404);
  assert.equal(createBullseye({ players: [FOUR[0]], arena: ARENA }).phase, 'loading');
});

// ---------- a game ----------

test('loading, then play: swings are dropped until the arena is in the bay, and after the game is over', () => {
  const game = newGame();
  const be = createBullseye({ players: FOUR.slice(0, 2), arena: ARENA, now: () => 5 });
  assert.equal(be.phase, 'loading');
  assert.deepEqual({ for: be.waiting.for, file: be.waiting.file, stageId: be.waiting.stageId }, { for: 'stage', file: 'a1.json', stageId: 'a1' });
  assert.equal(be.beforeShot(game), null);
  assert.equal(be.afterShot(game, {}), null);
  assert.equal(be.stageReady(game, 999), false, 'an answer to another request is ignored');
  assert.equal(be.stageReady(game, be.waiting.token), true);
  assert.equal(be.phase, 'play');
  assert.equal(be.waiting, null);
  const s = be.state();
  assert.equal(s.currentPlayerId, 'p1');
  assert.deepEqual([s.round, s.rounds, s.ball, s.balls, s.teed], [1, 3, 1, 3, true]);
  assert.deepEqual(s.rings.map((r) => r.value), [50, 25, 15, 10, 5]);
  assert.equal(s.arena.wind.mph, 0, 'no wind was handed over: the wind the game is playing in');
  assert.equal(game.player.id, 'p1');
  assert.equal(game.dropLocked, true, 'no rescue drop: every ball is from the tee');
  // a one-round, one-ball game ends with the last ball; a swing after that is dropped
  const one = start({ rounds: 1, balls: 1 });
  ball(one.be, one.game, 5);
  const last = ball(one.be, one.game, 2);
  assert.equal(last.event, 'game-over');
  assert.equal(one.be.phase, 'done');
  assert.equal(one.be.beforeShot(one.game), null);
  assert.equal(one.be.waiting.for, 'dismiss');
  assert.equal(one.be.waiting.timeoutMs, TIMEOUTS.doneMs);
});

test('an arena that will not load ends the game with the reason', () => {
  const be = createBullseye({ players: FOUR.slice(0, 1), arena: ARENA });
  assert.equal(be.stageFailed(be.waiting.token, 'no such file'), true);
  const s = be.state();
  assert.deepEqual([s.phase, s.aborted, s.error], ['done', true, 'no such file']);
  assert.equal(be.result(), null);
});

test('a turn: each ball from the tee, scored where it lies, the dart kept relative to the pin', () => {
  const { be, game } = start();
  const ev = ball(be, game, 5, { deg: 90 });   // 5 m right of the pin: the inner ring
  assert.equal(ev.event, 'ball');
  assert.deepEqual({ ring: ev.dart.ring, value: ev.dart.value, mult: ev.dart.mult, score: ev.dart.score, name: ev.dart.name }, { ring: 1, value: 25, mult: 1, score: 25, name: 'INNER RING' });
  assert.deepEqual([ev.dart.x, ev.dart.y], [5, 0], 'across (+ right) and along (+ long), in metres');
  assert.equal(ev.dart.ft, 16.4);
  assert.deepEqual([ev.nextPlayerId, ev.ball, ev.mult], ['p1', 2, 2]);
  // the ball still lies where it finished (the picture stays on it) and the game is tidy
  assert.deepEqual([game.ball.x, Math.round(game.ball.y - PIN_Y), game.holed, game.over, game.strokes], [5, 0, false, false, 0]);
  let s = be.state();
  assert.deepEqual([s.teed, s.waiting.for, s.waiting.timeoutMs, s.ball], [false, 'tee', TIMEOUTS.teeMs, 2]);
  assert.deepEqual(s.turn, { playerId: 'p1', score: 25, streak: 1, mult: 2, start: 0 });
  // tee(): the next ball goes on the tee; a second call has nothing to do
  assert.equal(be.tee(game), true);
  assert.deepEqual([game.ball.x, game.ball.y, game.lie], [0, 0, 'tee']);
  assert.equal(be.tee(game), false);
  assert.equal(be.state().waiting, null);
  // long and left: 12 m at 315 degrees is the outer ring, behind and left of the pin
  const far = ball(be, game, 12, { deg: 315 });
  assert.deepEqual([far.dart.value, far.dart.mult, far.dart.score], [10, 2, 20]);
  assert.ok(far.dart.x < 0 && far.dart.y > 0);
  s = be.state();
  assert.equal(pl(be, 'p1').total, 45);
  assert.equal(pl(be, 'p1').darts.length, 2);
  assert.equal(s.lastBall.n, 2);
});

test('the multiplier: the second scoring ball of a turn in a row counts double, the third treble; a blank breaks the run; a new turn starts at x1', () => {
  const { be, game } = start({ rounds: 2 }, { players: FOUR.slice(0, 1) });
  assert.deepEqual([ball(be, game, 1).dart.score, ball(be, game, 1).dart.score, ball(be, game, 1).dart.score], [50, 100, 150], 'three bullseyes: the perfect turn');
  assert.equal(pl(be, 'p1').total, 300);
  assert.deepEqual(pl(be, 'p1').turns, [{ round: 1, score: 300, bust: false }]);
  assert.equal(pl(be, 'p1').bestTurn, 300);
  assert.equal(pl(be, 'p1').bulls, 3);
  // round two: a ring, a ball off the target, a ring: x1, nothing, x1 again
  assert.equal(be.state().turn.mult, 1, 'a new turn starts at x1');
  const a = ball(be, game, 18), b = ball(be, game, 25), c = ball(be, game, 18);
  assert.deepEqual([a.dart.score, b.dart.score, b.dart.zone, c.dart.mult, c.dart.score], [5, 0, 'off', 1, 5]);
  assert.equal(c.event, 'game-over');
  assert.equal(pl(be, 'p1').total, 310);
});

test('water or out of bounds is a miss: nothing, no distance, the run is broken, the dart is marked where the ball was lost', () => {
  const { be, game } = start({}, { players: FOUR.slice(0, 1) });
  ball(be, game, 2);
  const ev = ball(be, game, 60, { miss: 'water' });
  assert.deepEqual({ miss: ev.dart.miss, ft: ev.dart.ft, score: ev.dart.score, zone: ev.dart.zone, y: ev.dart.y }, { miss: 'water', ft: null, score: 0, zone: 'miss', y: 60 });
  assert.equal(ball(be, game, 2).dart.mult, 1);
  const p = pl(be, 'p1');
  assert.deepEqual([p.misses, p.total, p.closestFt], [1, 100, 6.56]);
  const ob = start({}, { players: FOUR.slice(0, 1) });
  assert.equal(ball(ob.be, ob.game, 80, { miss: 'ob' }).dart.miss, 'ob');
});

test('a holed ball is a bullseye, and is no hole-out of the round', () => {
  const { be, game } = start({}, { players: FOUR.slice(0, 1) });
  const ev = ball(be, game, 0, { holed: true });
  assert.deepEqual([ev.dart.holed, ev.dart.value, ev.dart.ft], [true, 50, 0]);
  assert.deepEqual([game.holed, game.over, game.scores[0]], [false, false, null]);
  assert.equal(pl(be, 'p1').closestFt, 0);
});

test('turn order: every player throws a whole turn; round one in lobby order, after that whoever is behind leads off', () => {
  const { be, game } = start({ balls: 2 }, { players: FOUR });
  const who = [];
  const turn = (r1, r2) => { who.push(be.currentPlayerId); ball(be, game, r1); assert.equal(be.currentPlayerId, who[who.length - 1], 'the same player throws the second ball'); ball(be, game, r2); };
  turn(1, 1);     // p1: 50 + 100
  turn(25, 25);   // p2: 0
  turn(18, 25);   // p3: 5
  turn(10, 25);   // p4: 15
  assert.deepEqual(who, ['p1', 'p2', 'p3', 'p4']);
  let s = be.state();
  assert.equal(s.round, 2);
  assert.deepEqual(s.order, ['p2', 'p3', 'p4', 'p1'], 'the lowest score leads off the next round');
  assert.equal(s.currentPlayerId, 'p2');
  assert.deepEqual(s.standings.map((x) => [x.playerId, x.rank]), [['p1', 1], ['p4', 2], ['p3', 3], ['p2', 4]]);
  // level players keep the order they had
  turn(18, 25); turn(25, 25); turn(25, 25); turn(25, 25);   // p2 5, p3 5, p4 15, p1 150
  s = be.state();
  assert.deepEqual(s.order, ['p2', 'p3', 'p4', 'p1']);
  assert.ok(s.events.some((e) => e.type === 'round-over' && e.round === 2));
});

test('high score: the most points when the rounds run out wins; level on points, the nearest single ball decides; still level, the game is shared', () => {
  const a = start({ rounds: 1, balls: 2 });
  ball(a.be, a.game, 1); ball(a.be, a.game, 25);          // p1: 50
  ball(a.be, a.game, 5); const last = ball(a.be, a.game, 10);   // p2: 25 + 15 x2 = 55
  assert.deepEqual([last.event, last.reason, last.winnerIds], ['game-over', 'score', ['p2']]);
  const s = a.be.state();
  assert.deepEqual([s.phase, s.reason, s.winnerIds, s.currentPlayerId, s.turn], ['done', 'score', ['p2'], null, null]);
  assert.deepEqual(a.be.result().players.map((p) => [p.playerId, p.score, p.ballsThrown]), [['p1', 50, 2], ['p2', 55, 2]]);
  // level on 25: p2's ball was nearer
  const b = start({ rounds: 1, balls: 1 });
  ball(b.be, b.game, 6); ball(b.be, b.game, 4);
  assert.deepEqual(b.be.state().winnerIds, ['p2']);
  assert.deepEqual(b.be.state().standings.map((x) => x.rank), [1, 2]);
  // level on 25 and both 5 m away: shared
  const c = start({ rounds: 1, balls: 1 });
  ball(c.be, c.game, 5, { deg: 10 }); ball(c.be, c.game, 5, { deg: 200 });
  assert.deepEqual(c.be.state().winnerIds, ['p1', 'p2']);
  assert.match(c.be.state().log.at(-1).text, /shared/);
});

test('countdown: points come off the target, exactly zero is a check out, and the state says which ring checks out', () => {
  const { be, game } = start({ variant: 'countdown' }, { players: FOUR.slice(0, 1) });
  assert.equal(pl(be, 'p1').remaining, 100);
  ball(be, game, 1);                       // 50 left
  assert.deepEqual([pl(be, 'p1').remaining, pl(be, 'p1').total], [50, 50]);
  assert.deepEqual(pl(be, 'p1').finish, ['BULLSEYE'], 'a bullseye is the 50 that is left');
  assert.equal(be.state().turn.mult, 1, 'no multiplier in a countdown');
  const win = ball(be, game, 2);           // another 50: zero
  assert.deepEqual([win.event, win.reason, win.winnerIds, win.remaining, win.dart.checkout], ['game-over', 'finish', ['p1'], 0, true]);
  const s = be.state();
  assert.deepEqual([s.phase, s.reason, s.winnerIds, pl(be, 'p1').out], ['done', 'finish', ['p1'], 2]);
  assert.equal(win.dart.mult, 1);
  assert.deepEqual(be.result().players[0], { playerId: 'p1', name: 'Alex', score: 100, remaining: 0, ballsThrown: 2, finished: true, closestFt: 3.28 });
  assert.ok(s.events.some((e) => e.type === 'checkout' && e.playerId === 'p1' && e.balls === 2));
});

test('countdown: the round a player checks out in is played to its end, and the check out in the fewest balls wins', () => {
  // Alex checks out with his second ball: Blair still has her turn, but only two balls of it
  const a = start({ variant: 'countdown' });
  ball(a.be, a.game, 1);
  const out = ball(a.be, a.game, 2);
  assert.deepEqual([out.event, out.checkout, out.turnOver, out.nextPlayerId], ['ball', true, true, 'p2'], 'not over: Blair can answer');
  assert.deepEqual(a.be.state().chase, { playerId: 'p1', balls: 2 });
  assert.equal(pl(a.be, 'p2').finish.length, 0);
  assert.match(a.be.state().log.at(-1).text, /Blair can still answer/);
  ball(a.be, a.game, 1);                   // Blair: 50 left
  assert.equal(a.be.currentPlayerId, 'p2');
  const miss = ball(a.be, a.game, 14);     // a 10: 40 left after two balls, and two is all Alex took
  assert.deepEqual([miss.event, miss.reason, miss.winnerIds], ['game-over', 'finish', ['p1']]);
  assert.equal(pl(a.be, 'p2').darts.length, 2, 'no third ball: it could not match a check out in two');
  assert.deepEqual(a.be.state().standings.map((x) => [x.playerId, x.rank, x.out]), [['p1', 1, 2], ['p2', 2, null]]);
  assert.equal(a.be.state().chase, null);

  // Blair answers in the same two balls: level on balls, so the nearer best ball decides
  const b = start({ variant: 'countdown' });
  ball(b.be, b.game, 2); ball(b.be, b.game, 1.5);        // Alex: out in 2, best ball 1.5 m
  ball(b.be, b.game, 1); const tie = ball(b.be, b.game, 2.5); // Blair: out in 2, best ball 1 m
  assert.deepEqual([tie.event, tie.winnerIds, tie.dart.checkout], ['game-over', ['p2'], true]);
  assert.deepEqual(b.be.result().players.map((p) => [p.finished, p.ballsThrown]), [[true, 2], [true, 2]]);

  // whoever has already thrown as many balls as the check out took does not get a turn
  const c = start({ variant: 'countdown', balls: 2 }, { players: FOUR.slice(0, 3) });
  ball(c.be, c.game, 25); ball(c.be, c.game, 25);        // Alex: nothing
  ball(c.be, c.game, 1); ball(c.be, c.game, 25);         // Blair: 50 left
  ball(c.be, c.game, 25); ball(c.be, c.game, 25);        // Casey: nothing
  assert.deepEqual(c.be.state().order, ['p1', 'p3', 'p2'], 'round two: whoever is behind leads off');
  ball(c.be, c.game, 25); ball(c.be, c.game, 25);        // Alex
  ball(c.be, c.game, 25); ball(c.be, c.game, 25);        // Casey
  ball(c.be, c.game, 25);                                // Blair: a blank, then ...
  const last = ball(c.be, c.game, 1);                    // ... the bullseye she needed: out in 4, as the last thrower of the round
  assert.deepEqual([last.event, last.reason, last.winnerIds], ['game-over', 'finish', ['p2']]);
  // and when the first thrower of a round checks out with ball one of a turn, nobody behind can match it
  const d = start({ variant: 'countdown', balls: 1 });
  ball(d.be, d.game, 1); ball(d.be, d.game, 25);         // Alex 50 left, Blair nothing
  ball(d.be, d.game, 25);                                // round two, Blair first: nothing
  const quick = ball(d.be, d.game, 1);                   // Alex: out in 2 (Blair has thrown 2: no more turns anyway)
  assert.deepEqual([quick.event, quick.winnerIds], ['game-over', ['p1']]);
});

test('countdown: a ball that would go below zero is a BUST: the turn ends and its points go back', () => {
  const { be, game } = start({ variant: 'countdown' });
  ball(be, game, 1); ball(be, game, 25); ball(be, game, 14);   // p1: 50, blank, 10 -> 40 left
  ball(be, game, 25); ball(be, game, 25); ball(be, game, 25);  // p2: nothing
  assert.equal(be.currentPlayerId, 'p2', 'p2 is behind and leads off round two');
  ball(be, game, 25); ball(be, game, 25); ball(be, game, 25);
  assert.deepEqual([be.currentPlayerId, pl(be, 'p1').remaining], ['p1', 40]);
  assert.deepEqual(pl(be, 'p1').finish, [], '40 is no ring at x1');
  ball(be, game, 14);                      // 10 -> 30 left
  assert.deepEqual(pl(be, 'p1').finish, [], '30 is two balls away');
  const bust = ball(be, game, 1);          // a bullseye, 50: too many
  assert.deepEqual([bust.dart.bust, bust.dart.score, bust.dart.value, bust.dart.mult, bust.turnOver, bust.turnScore], [true, 0, 50, 1, true, 0]);
  const p1 = pl(be, 'p1');
  assert.deepEqual([p1.remaining, p1.total, p1.busts], [40, 60, 1], 'back to what it was when the turn began');
  assert.deepEqual(p1.turns.at(-1), { round: 2, score: 0, bust: true });
  assert.deepEqual(p1.darts.filter((d) => d.round === 2).map((d) => [d.score, d.voided || 0]), [[0, 10], [0, 0]], 'the turn\'s darts stay on the board, worth nothing');
  assert.equal(be.currentPlayerId, 'p2', 'the third ball of the turn is forfeit');
  assert.match(be.state().log.at(-2).text + be.state().log.at(-1).text, /BUST/);
});

test('countdown: it is capped: when the rounds run out the nearest to zero wins', () => {
  const { be, game } = start({ variant: 'countdown', rounds: 1, balls: 1 });
  ball(be, game, 14);
  const end = ball(be, game, 5);
  assert.deepEqual([end.event, end.reason, end.winnerIds], ['game-over', 'cap', ['p2']]);
  assert.deepEqual(be.state().standings.map((x) => [x.playerId, x.remaining, x.out]), [['p2', 75, null], ['p1', 90, null]]);
  assert.equal(be.result().players[1].finished, false);
});

test('undo: the last ball is taken back exactly, also the one that ended a turn, a round or the game; one level', () => {
  const { be, game } = start({ rounds: 1, balls: 2 });
  ball(be, game, 1);
  const before = be.state();
  ball(be, game, 5);
  assert.equal(be.currentPlayerId, 'p2');
  assert.deepEqual(be.state().undoable, { playerId: 'p1', stray: false, n: 2 });
  const u = be.undoLastBall(game);
  assert.deepEqual(u, { event: 'ball-undone', playerId: 'p1', stray: false, from: 'play' });
  const after = be.state();
  for (const k of ['phase', 'round', 'ball', 'currentPlayerId', 'order', 'turn', 'players', 'lastBall', 'standings', 'winnerIds']) assert.deepEqual(after[k], before[k], k);
  assert.ok(after.seq > before.seq, 'seq only ever rises');
  assert.equal(after.undoable, null);
  assert.deepEqual([game.ball.x, game.ball.y, game.lie, game.player.id], [0, 0, 'tee', 'p1'], 'the thrower is on the tee again');
  assert.throws(() => be.undoLastBall(game), (e) => e instanceof BullseyeError && e.status === 409);
  // the ball that ended the game
  ball(be, game, 5); ball(be, game, 25); ball(be, game, 25);
  assert.equal(be.phase, 'done');
  assert.equal(be.undoLastBall(game).from, 'done');
  assert.deepEqual([be.phase, be.currentPlayerId, be.state().ball, be.state().winnerIds], ['play', 'p2', 2, []]);
  assert.equal(ball(be, game, 1).event, 'game-over');
  assert.deepEqual(be.state().winnerIds, ['p1']);
});

test('restart: the same game from the top, every dart gone', () => {
  const { be, game } = start({ variant: 'countdown', balls: 1 }, { players: FOUR.slice(0, 3) });
  ball(be, game, 1); ball(be, game, 5);
  be.restart(game);
  const s = be.state();
  assert.deepEqual([s.phase, s.round, s.ball, s.currentPlayerId, s.lastBall, s.undoable], ['play', 1, 1, 'p1', null, null]);
  assert.deepEqual(s.players.map((p) => [p.remaining, p.total, p.darts.length, p.turns.length]), [[100, 0, 0, 0], [100, 0, 0, 0], [100, 0, 0, 0]]);
  assert.deepEqual(s.rings.length, 5);
  assert.deepEqual([game.ball.y, game.player.id], [0, 'p1']);
  assert.ok(s.events.some((e) => e.type === 'restarted'));
  // from a finished game too
  const done = start({ rounds: 1, balls: 1 }, { players: FOUR.slice(0, 1) });
  ball(done.be, done.game, 1);
  assert.equal(done.be.state().canRestart, true);
  done.be.restart(done.game);
  assert.equal(done.be.phase, 'play');
  // not while the arena is still loading
  assert.throws(() => createBullseye({ players: FOUR.slice(0, 1), arena: ARENA }).restart(), /No game/);
});

test('a stray ball (under 40 mph off the tee) counts but is marked, and undo takes it back', () => {
  const { be, game } = start();
  const ev = ball(be, game, 60, { mph: 12 });
  assert.equal(ev.stray, true);
  assert.deepEqual(be.state().undoable, { playerId: 'p1', stray: true, n: 1 });
  assert.ok(be.state().events.some((e) => e.type === 'stray-shot' && e.playerId === 'p1' && e.speedMph === 12));
  assert.equal(be.undoLastBall(game).stray, true);
  assert.equal(pl(be, 'p1').darts.length, 0);
  assert.equal(ball(be, game, 5).stray, undefined);
});

test('abort hands the bay back with a fresh hole; a swing aimed before a ball is that player\'s aim', () => {
  const { be, game } = start();
  game.setAimOffset(4);
  ball(be, game, 5);
  be.tee(game);
  assert.equal(game.aimOffset, 4, 'the aim set for the last ball is still that player\'s');
  const s = be.abort(game);
  assert.deepEqual([s.phase, s.aborted, s.waiting], ['done', true, null]);
  assert.deepEqual([game.ball.y, game.strokes, game.dropLocked, game.aimOffset], [0, 0, false, 0]);
  assert.equal(be.result(), null);
});

test('real swings: a wedge from the tee is scored where the game says it finished', () => {
  const { be, game } = start({}, { players: FOUR.slice(0, 1) });
  assert.ok(be.beforeShot(game));
  const result = game.handleShot({ Speed: 95, VLA: 24, HLA: 0, TotalSpin: 8000, SpinAxis: 0 });
  assert.ok(result);
  const ev = be.afterShot(game, result);
  const distM = Math.hypot(game.ball.x, game.ball.y - PIN_Y);
  assert.equal(ev.dart.miss, null);
  assert.ok(Math.abs(ev.dart.ft - distM * 3.28084) < 0.02);
  assert.equal(ev.dart.value, scoreBall({ distM }, be.state().rings).value);
  assert.ok(Math.abs(ev.dart.y - (game.ball.y - PIN_Y)) < 0.01 && Math.abs(ev.dart.x - game.ball.x) < 0.01);
  // a ball flown into the lake behind the green
  assert.ok(be.beforeShot(game));
  const wet = be.afterShot(game, game.handleShot({ Speed: 135, VLA: 16, HLA: 0, TotalSpin: 5000, SpinAxis: 0 }));
  assert.deepEqual([wet.dart.miss, wet.dart.score, wet.dart.ft], ['water', 0, null]);
  assert.ok(wet.dart.y > 20, 'marked where it was lost, past the pin');
});

test('the state: every field a client reads, and it is plain data', () => {
  const { be, game } = start({ variant: 'countdown', target: 200 }, { players: FOUR });
  ball(be, game, 5);
  const s = be.state();
  assert.deepEqual(Object.keys(s).sort(), ['aborted', 'arena', 'ball', 'balls', 'canRestart', 'chase', 'currentPlayerId', 'endedAt', 'error', 'events', 'id', 'lastBall', 'log',
    'options', 'order', 'phase', 'players', 'records', 'reason', 'round', 'rounds', 'rings', 'seq', 'standings', 'startedAt', 'teed', 'turn', 'undoable', 'variant',
    'variantLabel', 'waiting', 'winnerIds'].sort());
  assert.deepEqual(s.options, { variant: 'countdown', rounds: 10, balls: 3, target: 200 });
  assert.deepEqual(Object.keys(s.players[0]).sort(), ['balls', 'bestTurn', 'bulls', 'busts', 'closestFt', 'darts', 'finish', 'id', 'initials', 'misses', 'name', 'out', 'remaining', 'slot', 'total', 'turns'].sort());
  assert.deepEqual(Object.keys(s.players[0].darts[0]).sort(), ['ball', 'bust', 'ft', 'holed', 'miss', 'mult', 'n', 'name', 'playerId', 'ring', 'round', 'score', 'value', 'x', 'y', 'zone'].sort());
  assert.deepEqual(s.players.map((p) => p.slot), [1, 2, 3, 4]);
  assert.deepEqual(s.arena, { id: 'a1', name: 'Test Arena', lengthYd: 120, theme: 'tropical', timeOfDay: 'day', blurb: 'A target.', wind: { mph: 7, dirDeg: 90, label: '7 MPH' } });
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  assert.deepEqual(s.events.map((e) => e.type), ['game-start', 'stage-loaded', 'turn', 'ball']);
  for (let i = 1; i < s.events.length; i++) assert.ok(s.events[i].seq > s.events[i - 1].seq);
  assert.deepEqual(be.config(), { players: FOUR.map((p, i) => ({ ...p, initials: s.players[i].initials })), arenaId: 'a1', options: s.options });
  be.setRecords({ nearest: { ft: 3 } });
  assert.deepEqual(be.state().records, { nearest: { ft: 3 } });
});

// ---------- the store ----------

test('the bests: a high score per player, per arena and per shape of game; the fewest balls to check out; kept on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-bullseye-'));
  const store = createBullseyeBests({ dataDir: dir, now: () => 1000 });
  const game = (score, extra = {}) => ({ arenaId: 'a1', arenaName: 'Test Arena', variant: 'high', rounds: 3, balls: 3, target: null, at: 1000, players: [{ playerId: 'p1', name: 'Alex', score, ballsThrown: 9 }], ...extra });
  assert.deepEqual(store.offerGame(game(120)), { p1: { newBest: true, best: { score: 120, at: 1000, name: 'Alex' } } });
  assert.deepEqual(store.offerGame(game(90)).p1, { newBest: false, best: { score: 120, at: 1000, name: 'Alex' } });
  assert.equal(store.offerGame(game(120)).p1.newBest, false, 'the same score is no new best');
  assert.equal(store.offerGame(game(0, { arenaId: 'a2' })).p1.newBest, false, 'nothing scored is no best');
  assert.equal(store.offerGame(game(60, { rounds: 5 })).p1.newBest, true, 'five rounds is a board of its own');
  assert.deepEqual(store.board({ arenaId: 'a1', variant: 'high', rounds: 3, balls: 3 }), { p1: { score: 120, at: 1000, name: 'Alex' } });
  // countdown: only a finished game counts, fewer balls is better
  const cd = (ballsThrown, finished) => ({ arenaId: 'a1', variant: 'countdown', rounds: 6, balls: 3, target: 100, at: 2000, players: [{ playerId: 'p1', name: 'Alex', score: 100, remaining: finished ? 0 : 5, ballsThrown, finished }] });
  assert.equal(store.offerGame(cd(9, false)).p1.newBest, false);
  assert.deepEqual(store.offerGame(cd(9, true)).p1, { newBest: true, best: { balls: 9, at: 2000, name: 'Alex' } });
  assert.equal(store.offerGame(cd(11, true)).p1.newBest, false);
  assert.equal(store.offerGame(cd(6, true)).p1.best.balls, 6);
  assert.deepEqual(store.arena('a1'), { high: { '3x3': { p1: { score: 120, at: 1000, name: 'Alex' } }, '5x3': { p1: { score: 60, at: 1000, name: 'Alex' } } }, countdown: { 100: { p1: { balls: 6, at: 2000, name: 'Alex' } } } });
  // on disk, and read back
  const again = createBullseyeBests({ dataDir: dir });
  assert.deepEqual(again.arena('a1'), store.arena('a1'));
  // snapshot / restore (an undone ball takes its records back), and a removed player
  const snap = store.snapshot();
  store.offerGame(game(300));
  store.restore(snap);
  assert.equal(store.board({ arenaId: 'a1', variant: 'high', rounds: 3, balls: 3 }).p1.score, 120);
  assert.equal(store.forget('p1'), true);
  assert.deepEqual(store.board({ arenaId: 'a1', variant: 'high', rounds: 3, balls: 3 }), {});
  assert.equal(store.forget('p1'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the nearest ball of the night: it stands until six the next morning; the all-time record stays', () => {
  let t = new Date(2026, 10, 23, 21, 0, 0).getTime();   // nine in the evening
  const store = createBullseyeBests({ now: () => t });
  assert.equal(store.nearest(), null);
  let r = store.offerBall({ ft: 14.2, playerId: 'p1', name: 'Alex', arenaId: 'a1', arenaName: 'Test Arena' });
  assert.deepEqual([r.night, r.ever, r.nearest.ft, r.nearest.name], [true, true, 14.2, 'Alex']);
  assert.equal(store.offerBall({ ft: 20, playerId: 'p2', name: 'Blair' }).night, false);
  t = new Date(2026, 10, 24, 1, 30, 0).getTime();        // half past one: still the same night
  assert.equal(nightKey(t), nightKey(new Date(2026, 10, 23, 21, 0, 0).getTime()));
  r = store.offerBall({ ft: 6.5, playerId: 'p2', name: 'Blair' });
  assert.deepEqual([r.night, r.ever, store.nearest().name], [true, true, 'Blair']);
  assert.equal(store.offerBall({ ft: NaN }).night, false);
  t = new Date(2026, 10, 24, 19, 0, 0).getTime();        // the next evening: a new night
  assert.equal(store.nearest(), null);
  r = store.offerBall({ ft: 30, playerId: 'p3', name: 'Casey' });
  assert.deepEqual([r.night, r.ever, r.nearest.ft, r.nearestEver.ft], [true, false, 30, 6.5]);
  assert.equal(store.offerBall({ ft: 0, playerId: null, name: 'Guest' }).nearest.playerId, '_guest');
});
