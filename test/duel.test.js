'use strict';
// v3:modes TRICK SHOT DUEL (lib/duel.js, docs/modes.md): call your shot, match it or take a
// letter. What a shot is read as (carry, how it bent, how close, how tall, the gadgets it
// met, whatever shape they come in), the call it makes and the calls it does not (NO CALL),
// the judge and its tolerances, then the game: the toss, the roles and how they swap, the
// letters and the word, the cap, a shared duel, the swing gate, the tee request, undo,
// restart, the stray-ball mark, play again, the state shape.
//
// The duel is a pure state machine: these tests are its driver. Most balls are built by
// hand (the engine reads a shot from the game's result); a few are real swings.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../lib/game');
const {
  createDuel, DuelError, WORDS, TOL, DUFF_YD, TIMEOUTS, cleanWord, gadgetList, curveOf, shotFeatures, makeCall, judge,
} = require('../lib/duel');

const YD = 0.9144;
// ---------- a stage: 150 yd due north, a green 20 m round the pin, a lake from 40 m past it ----------
const PIN_Y = 150 * YD;
const course = () => ({
  name: 'Duel Stage', surfaces: [], boundary: null, elevation: null,
  holes: [{ ref: 1, par: 3, tee: [0, 0], pin: [0, PIN_Y], lengthYd: 150, line: [[0, 0], [0, PIN_Y]] }],
  arcade: { theme: 'links' },
});
const surfaces = () => (x, y) => (Math.hypot(x, y - PIN_Y) < 20 ? 'green' : y > PIN_Y + 40 ? 'water' : 'fairway');
const newGame = () => { const g = new Game({ surfaceLookupFactory: surfaces }); g.setCourse(course()); return g; };
const STAGE = { id: 's1', name: 'Duel Stage', file: 's1.json', par: 3, lengthYd: 150, theme: 'links' };
const TWO = [{ id: 'p1', name: 'Alex' }, { id: 'p2', name: 'Blair' }];

// A shot result built by hand: `carry` yd, bent `curve` yd (+ right), `apex` ft, finishing
// `ft` feet short of the pin (on the line) unless lost.
function result({ carry = 150, curve = 0, apex = 80, ft = 90, miss = null, gadgets, mph = 100, putt = false, lie = null, holed = false } = {}) {
  const carryM = carry * YD, x = curve * YD;
  const land = { x, y: Math.sqrt(Math.max(0, carryM * carryM - x * x)) };
  const points = [{ t: 0, x: 0, y: 0, z: 0 }];
  for (let i = 1; i <= 20; i++) { const k = i / 20; points.push({ t: k * 5, x: land.x * k * k, y: land.y * k, z: Math.sin(Math.PI * k) * apex / 3.28 }); }   // it starts north and bends as it goes
  const end = holed ? { x: 0, y: PIN_Y } : { x: 0, y: PIN_Y - ft / 3 * YD };
  const r = {
    launch: { speedMph: mph }, sim: { points, carryYd: carry, totalYd: carry + 4, offlineYd: curve, apexFt: apex, flightTime: 5, isPutt: putt, events: [] },
    from: { x: 0, y: 0 }, end, lie: lie || (ft <= 65 ? 'green' : 'fairway'), distToPinYd: holed ? 0 : ft / 3, penalty: 0, holed, note: '',
  };
  if (miss) { r.penalty = 1; r.note = miss === 'water' ? 'Water — lateral drop (+1)' : 'Out of bounds — drop where it left (+1)'; r.lie = 'fairway'; }
  if (gadgets !== undefined) r.gadgets = gadgets;
  return r;
}
function start(options = {}, { game = newGame(), random = () => 0.1, timeouts } = {}) {
  const du = createDuel({ players: TWO, stage: STAGE, options, now: () => 1000, random, timeouts });
  assert.equal(du.waiting.for, 'stage');
  assert.equal(du.stageReady(game, du.waiting.token, { wind: { mph: 5, dirDeg: 0, label: '5 MPH' } }), true);
  return { du, game };
}
// one ball by whoever is up
function hit(du, game, spec = {}) {
  const pre = du.beforeShot(game);
  if (!pre) return null;
  assert.deepEqual([game.ball.x, game.ball.y, game.lie, game.strokes], [0, 0, 'tee', 0], 'every ball is hit from the tee');
  const r = result(spec);
  game.ball = { ...r.end }; game.strokes = 1; game.lie = r.lie;
  if (r.holed) { game.holed = true; game.over = true; game.scores[0] = 1; }
  r.end = game.ball;
  return du.afterShot(game, r);
}
const pl = (du, id) => du.state().players.find((p) => p.id === id);

// ---------- reading a shot ----------

test('the gadgets a shot met, whatever shape they come in, and never a throw', () => {
  assert.deepEqual(gadgetList({}), []);
  assert.deepEqual(gadgetList(null), []);
  assert.deepEqual(gadgetList({ gadgets: null }), []);
  assert.deepEqual(gadgetList({ gadgets: 'ring-1' }), []);
  assert.deepEqual(gadgetList({ gadgets: 7 }), []);
  assert.deepEqual(gadgetList({ gadgets: ['ring-1', 'ring-1', 'pad-2'] }), [{ id: 'ring-1', kind: 'ring' }, { id: 'pad-2', kind: 'pad' }], 'ids: the kind is read off the id');
  assert.deepEqual(gadgetList({ gadgets: [{ id: 'pharaohs-gate/ring-1', kind: 'ring', t: 2.1, x: 3, effect: 'x2' }, { id: 'z', kind: 'zone' }, { id: 'w2', kind: 'warp-exit' }, { id: 'c', type: 'CANNON' }] }),
    [{ id: 'pharaohs-gate/ring-1', kind: 'ring' }, { id: 'c', kind: 'cannon' }], 'objects: id and kind; zones and a warp\'s exit are nothing to aim at');
  assert.deepEqual(gadgetList({ gadgets: [null, undefined, {}, { kind: 'ring' }, [], 3, { id: 5 }] }), [{ id: '3', kind: 'gadget' }, { id: '5', kind: 'gadget' }]);
  assert.deepEqual(gadgetList({ gadgets: { hits: [{ id: 'a', kind: 'pad' }] } }), [{ id: 'a', kind: 'pad' }]);
  const nasty = { get gadgets() { throw new Error('boom'); } };
  assert.deepEqual(gadgetList(nasty), []);
});

test('how a ball bent: its landing point against the line it started on, read from the path', () => {
  const pts = (curve, carry = 150) => result({ carry, curve }).sim.points;
  assert.equal(curveOf(pts(0), { x: 0, y: 0 }, 150), 0);
  // (the hand-built path leaves a touch right of north, so the bend off its own start line is 85 % of the 12)
  assert.equal(curveOf(pts(12), { x: 0, y: 0 }, 150), 10.2, 'a bend to the right');
  assert.equal(curveOf(pts(-20), { x: 0, y: 0 }, 150), -17, 'a bend to the left');
  // a straight ball started 10 degrees right has not bent
  const push = Array.from({ length: 21 }, (_, i) => ({ t: i, x: Math.sin(10 * Math.PI / 180) * i * 7, y: Math.cos(10 * Math.PI / 180) * i * 7, z: 5 }));
  assert.equal(curveOf(push, { x: 0, y: 0 }, 140 / YD), 0);
  // nothing to read
  assert.equal(curveOf([], { x: 0, y: 0 }, 150), null);
  assert.equal(curveOf(pts(5), null, 150), null);
  assert.equal(curveOf(pts(5, 10), { x: 0, y: 0 }, 10), null, 'too short to have a start line');
});

test('what a shot was: carry, bend, apex, where it finished, whether it stayed in play', () => {
  const f = shotFeatures(result({ carry: 152.4, curve: -14, apex: 96.6, ft: 18 }), { from: { x: 0, y: 0 }, pin: [0, PIN_Y] });
  assert.deepEqual({ clean: f.clean, miss: f.miss, carryYd: f.carryYd, apexFt: f.apexFt, finishFt: f.finishFt, lie: f.lie, holed: f.holed, speedMph: f.speedMph, gadgets: f.gadgets },
    { clean: true, miss: null, carryYd: 152.4, apexFt: 97, finishFt: 18, lie: 'green', holed: false, speedMph: 100, gadgets: [] });
  assert.equal(f.curveYd, -11.9);
  const wet = shotFeatures(result({ miss: 'water' }), { pin: [0, PIN_Y] });
  assert.deepEqual([wet.clean, wet.miss, wet.finishFt, wet.lie], [false, 'water', null, 'water']);
  assert.equal(shotFeatures(result({ miss: 'ob' })).miss, 'ob');
  const ace = shotFeatures(result({ holed: true }), { pin: [0, PIN_Y] });
  assert.deepEqual([ace.holed, ace.finishFt], [true, 0]);
  // without the pin the game's own distance stands in; rubbish reads as nothing, and does not throw
  assert.equal(shotFeatures({ distToPinYd: 10, sim: {} }).finishFt, 30);
  assert.deepEqual(shotFeatures(null), { clean: true, miss: null, isPutt: false, carryYd: null, curveYd: null, apexFt: null, finishFt: null, lie: null, holed: false, speedMph: null, gadgets: [] });
  assert.equal(shotFeatures({ sim: 5, gadgets: 'x', launch: null }).carryYd, null);
});

// ---------- the call ----------

const feat = (extra = {}) => ({ clean: true, miss: null, isPutt: false, carryYd: 150, curveYd: 1, apexFt: 80, finishFt: 95, lie: 'fairway', holed: false, speedMph: 100, gadgets: [], ...extra });

test('the call: the carry, then the one or two things most the shot\'s own, each with its tolerance', () => {
  // a plain one: the carry is the whole call
  let c = makeCall(feat());
  assert.equal(c.ok, true);
  assert.equal(c.text, 'MATCH IT: 150 YD CARRY');
  assert.deepEqual(c.parts, [{ id: 'carry', label: '150 YD CARRY', short: '150 YD CARRY', target: 'CARRY 135 TO 165 YD', value: 150, lo: 135, hi: 165 }]);
  assert.deepEqual([makeCall(feat({ carryYd: 60 })).parts[0].lo, makeCall(feat({ carryYd: 60 })).parts[0].hi], [52, 68], 'at least 8 yd either way');
  // a big bend to the left that finished stiff
  c = makeCall(feat({ curveYd: -15, finishFt: 12, lie: 'green' }));
  assert.equal(c.text, 'MATCH IT: 150 YD CARRY · INSIDE 32 FT · BENDS LEFT');
  assert.deepEqual(c.parts.map((p) => [p.id, p.label, p.target]), [
    ['carry', '150 YD CARRY', 'CARRY 135 TO 165 YD'],
    ['finish', '12 FT FROM THE PIN', 'FINISH INSIDE 32 FT'],
    ['curve', 'BENT LEFT 15 YD', 'BEND IT LEFT 6 YD OR MORE'],
  ]);
  assert.equal(makeCall(feat({ finishFt: 40 })).parts[1].within, 80, 'twice the distance');
  assert.equal(makeCall(feat({ finishFt: 0, holed: true })).parts[1].label, 'HOLED IT');
  assert.equal(makeCall(feat({ finishFt: 0, holed: true })).parts[1].within, 20);
  assert.equal(makeCall(feat({ curveYd: 5 })).parts.length, 1, 'five yards is not a bend worth calling');
  assert.deepEqual([makeCall(feat({ curveYd: 30 })).parts[1].side, makeCall(feat({ curveYd: 30 })).parts[1].atLeast], ['right', 12]);
  // on the green but not close: that is the call
  assert.deepEqual(makeCall(feat({ finishFt: 62, lie: 'green' })).parts.map((p) => p.id), ['carry', 'green']);
  // tall, and a stinger
  assert.deepEqual(makeCall(feat({ apexFt: 120 })).parts[1], { id: 'apex', label: '120 FT HIGH', short: '102 FT HIGH OR MORE', target: 'FLY IT 102 FT HIGH OR MORE', value: 120, kind: 'tall', atLeast: 102 });
  assert.deepEqual(makeCall(feat({ apexFt: 22 })).parts[1], { id: 'apex', label: 'A STINGER: 22 FT HIGH', short: 'UNDER 33 FT HIGH', target: 'KEEP IT UNDER 33 FT HIGH', value: 22, kind: 'low', atMost: 33 });
  assert.equal(makeCall(feat({ apexFt: 22, carryYd: 70 })).parts.length, 1, 'a low ball that went nowhere is no stinger');
  // a gadget comes first, and a ring before a pad
  c = makeCall(feat({ gadgets: [{ id: 'pad-1', kind: 'pad' }, { id: 'ring-2', kind: 'ring' }], curveYd: 20, finishFt: 10, apexFt: 130 }));
  assert.deepEqual(c.parts.map((p) => p.id), ['carry', 'gadget', 'curve'], 'three parts at most: the two most its own');
  assert.deepEqual([c.parts[1].gadgetId, c.parts[1].label], ['ring-2', 'THROUGH THE RING']);
  assert.equal(makeCall(feat({ gadgets: [{ id: 'x', kind: 'see-saw' }] })).parts[1].label, 'HIT THE SEE SAW');
  assert.equal(makeCall(feat({ curveYd: 20, finishFt: 10 }), { max: 2 }).parts.length, 2);
});

test('NO CALL: a lost ball, a duff, a putt', () => {
  assert.deepEqual(makeCall(feat({ clean: false, miss: 'water' })), { ok: false, reason: 'hazard' });
  assert.deepEqual(makeCall(feat({ carryYd: DUFF_YD - 0.1 })), { ok: false, reason: 'duff' });
  assert.equal(makeCall(feat({ carryYd: DUFF_YD })).ok, true);
  assert.deepEqual(makeCall(feat({ isPutt: true })), { ok: false, reason: 'duff' });
  assert.deepEqual(makeCall(feat({ carryYd: null })), { ok: false, reason: 'duff' });
  assert.deepEqual(makeCall(null), { ok: false, reason: 'hazard' });
  assert.equal(DUFF_YD, 40);
});

test('the judge: every part within its tolerance, and the ball in play', () => {
  const call = makeCall(feat({ curveYd: -15, finishFt: 12, lie: 'green' }));
  const tryIt = (extra) => judge(call, feat({ curveYd: -10, finishFt: 30, lie: 'green', ...extra }));
  let v = tryIt({});
  assert.equal(v.ok, true);
  assert.deepEqual(v.checks, [
    { id: 'carry', ok: true, want: 'CARRY 135 TO 165 YD', got: '150 YD' },
    { id: 'finish', ok: true, want: 'FINISH INSIDE 32 FT', got: '30 FT' },
    { id: 'curve', ok: true, want: 'BEND IT LEFT 6 YD OR MORE', got: 'LEFT 10 YD' },
  ]);
  // the edges
  assert.equal(tryIt({ carryYd: 135 }).ok, true);
  assert.equal(tryIt({ carryYd: 165.4 }).ok, true);
  assert.equal(tryIt({ carryYd: 134 }).ok, false);
  assert.equal(tryIt({ carryYd: 166 }).ok, false);
  assert.equal(tryIt({ finishFt: 32 }).ok, true);
  assert.equal(tryIt({ finishFt: 33 }).ok, false);
  assert.equal(tryIt({ curveYd: -6 }).ok, true);
  assert.equal(tryIt({ curveYd: -4 }).ok, false);
  v = tryIt({ curveYd: 12 });   // the wrong way
  assert.deepEqual([v.ok, v.checks[2]], [false, { id: 'curve', ok: false, want: 'BEND IT LEFT 6 YD OR MORE', got: 'RIGHT 12 YD' }]);
  assert.equal(tryIt({ curveYd: null }).checks[2].got, 'STRAIGHT');
  // a lost ball matches nothing
  v = tryIt({ clean: false, miss: 'water' });
  assert.deepEqual([v.ok, v.checks.map((c) => c.ok), v.checks[0].got], [false, [false, false, false], 'IN THE WATER']);
  // tall, low, the green, a gadget
  assert.equal(judge(makeCall(feat({ apexFt: 120 })), feat({ apexFt: 102 })).ok, true);
  assert.equal(judge(makeCall(feat({ apexFt: 120 })), feat({ apexFt: 101 })).ok, false);
  assert.equal(judge(makeCall(feat({ apexFt: 22 })), feat({ apexFt: 33 })).ok, true);
  assert.equal(judge(makeCall(feat({ apexFt: 22 })), feat({ apexFt: 34 })).ok, false);
  assert.equal(judge(makeCall(feat({ finishFt: 62, lie: 'green' })), feat({ finishFt: 64, lie: 'green' })).ok, true);
  assert.deepEqual(judge(makeCall(feat({ finishFt: 62, lie: 'green' })), feat({ lie: 'bunker' })).checks[1], { id: 'green', ok: false, want: 'FINISH ON THE GREEN', got: 'IN THE BUNKER' });
  const ring = makeCall(feat({ gadgets: [{ id: 'ring-2', kind: 'ring' }] }));
  assert.equal(judge(ring, feat({ gadgets: [{ id: 'ring-2', kind: 'ring' }] })).ok, true);
  assert.deepEqual(judge(ring, feat({ gadgets: [{ id: 'ring-9', kind: 'ring' }] })).checks[1], { id: 'gadget', ok: false, want: 'THROUGH THE RING: THE SAME ONE', got: 'MISSED IT' });
  // no call, nothing to match
  assert.equal(judge(null, feat()).ok, false);
  assert.equal(judge({ parts: [] }, feat()).ok, false);
});

test('the word: letters only, two to eight of them, else CLASH', () => {
  assert.deepEqual(WORDS, ['CLASH', 'PIG', 'HORSE']);
  assert.deepEqual([cleanWord('pig'), cleanWord(' H-o-r-s-e '), cleanWord(''), cleanWord('x'), cleanWord('ABCDEFGHI'), cleanWord(null), cleanWord('GOLF')], ['PIG', 'HORSE', 'CLASH', 'CLASH', 'CLASH', 'CLASH', 'GOLF']);
});

// ---------- a duel ----------

test('who can play: two different players on a stage', () => {
  const mk = (players, stage = STAGE) => () => createDuel({ players, stage });
  assert.throws(mk([TWO[0]]), /two players/);
  assert.throws(mk([...TWO, { id: 'p3', name: 'Casey' }]), DuelError);
  assert.throws(mk([TWO[0], TWO[0]]), /different/);
  assert.throws(mk([TWO[0], { id: 'x' }]), /id and a name/);
  assert.throws(mk(TWO, null), (e) => e instanceof DuelError && e.status === 404);
});

test('loading, then play: the toss says who calls first; swings are dropped until the stage is in the bay', () => {
  const game = newGame();
  const du = createDuel({ players: TWO, stage: STAGE, random: () => 0.9, now: () => 5 });
  assert.equal(du.phase, 'loading');
  assert.deepEqual({ for: du.waiting.for, file: du.waiting.file }, { for: 'stage', file: 's1.json' });
  assert.equal(du.beforeShot(game), null);
  assert.equal(du.afterShot(game, {}), null);
  assert.equal(du.stageReady(game, 99), false);
  assert.equal(du.stageReady(game, du.waiting.token), true);
  const s = du.state();
  assert.deepEqual([s.phase, s.round, s.maxRounds, s.role, s.challengerId, s.currentPlayerId, s.teed, s.word], ['play', 1, 20, 'challenge', 'p2', 'p2', true, 'CLASH']);
  assert.equal(game.player.id, 'p2');
  assert.equal(game.dropLocked, true);
  assert.equal(s.stage.wind.mph, 0);
  assert.equal(start({ first: 1 }).du.state().challengerId, 'p2', 'or the lobby says who');
  assert.equal(start().du.state().challengerId, 'p1');
  // a stage that will not load
  const bad = createDuel({ players: TWO, stage: STAGE });
  assert.equal(bad.stageFailed(bad.waiting.token, 'no such file'), true);
  assert.deepEqual([bad.state().phase, bad.state().aborted, bad.state().error], ['done', true, 'no such file']);
});

test('a round: the challenger calls, the other matches it, and the roles swap', () => {
  const { du, game } = start();
  const call = hit(du, game, { carry: 150, curve: -15, ft: 12 });
  assert.deepEqual([call.event, call.playerId, call.nextPlayerId, call.role, call.call.text], ['call', 'p1', 'p2', 'match', 'MATCH IT: 150 YD CARRY · INSIDE 32 FT · BENDS LEFT']);
  let s = du.state();
  assert.deepEqual([s.role, s.currentPlayerId, s.challengerId, s.round, s.teed, s.waiting.for, s.waiting.timeoutMs], ['match', 'p2', 'p1', 1, false, 'tee', TIMEOUTS.teeMs]);
  assert.deepEqual([s.call.playerId, s.call.parts.length, s.call.shot.finishFt, s.last.kind], ['p1', 3, 12, 'call']);
  // the ball still lies where it finished; tee() puts the matcher on the tee
  assert.ok(Math.abs(game.ball.y - (PIN_Y - 4 * YD)) < 0.01);
  assert.deepEqual([game.holed, game.over, game.strokes], [false, false, 0]);
  assert.equal(du.tee(game), true);
  assert.deepEqual([game.ball.y, game.lie, game.player.id], [0, 'tee', 'p2']);
  assert.equal(du.tee(game), false);
  const ans = hit(du, game, { carry: 158, curve: -9, ft: 28 });
  assert.deepEqual([ans.event, ans.playerId, ans.checks.every((c) => c.ok), ans.nextPlayerId, ans.role, ans.round], ['matched', 'p2', true, 'p2', 'challenge', 2]);
  s = du.state();
  assert.deepEqual([s.role, s.currentPlayerId, s.challengerId, s.round, s.call, s.last.kind], ['challenge', 'p2', 'p2', 2, null, 'matched']);
  assert.deepEqual(s.players.map((p) => [p.letters, p.calls, p.matched, p.shots]), [['', 1, 0, 1], ['', 0, 1, 1]]);
  assert.deepEqual(s.history, [{ round: 1, challengerId: 'p1', call: 'MATCH IT: 150 YD CARRY · INSIDE 32 FT · BENDS LEFT', matcherId: 'p2', result: 'matched' }]);
});

test('not matched: a letter; and the roles swap all the same', () => {
  const { du, game } = start({ word: 'PIG' });
  hit(du, game, { carry: 150, ft: 12 });
  const ans = hit(du, game, { carry: 120, ft: 100 });
  assert.deepEqual([ans.event, ans.playerId, ans.letter, ans.letters, ans.nextPlayerId, ans.role], ['letter', 'p2', 'P', 'P', 'p2', 'challenge']);
  assert.deepEqual(ans.checks.map((c) => [c.id, c.ok]), [['carry', false], ['finish', false]]);
  const s = du.state();
  assert.deepEqual([pl(du, 'p2').letters, pl(du, 'p2').lettersCount, pl(du, 'p2').lettersLeft, pl(du, 'p2').missed], ['P', 1, 2, 1]);
  assert.deepEqual([s.last.kind, s.last.letter, s.last.letters, s.history[0].result, s.history[0].letter], ['letter', 'P', 'P', 'letter', 'P']);
  assert.match(s.log.at(-1).text, /Blair misses it .*: P\. P/);
  // a matcher who loses the ball takes the letter too
  hit(du, game, { carry: 140 });                // Blair calls
  const wet = hit(du, game, { miss: 'water' }); // Alex
  assert.deepEqual([wet.event, wet.letter, wet.checks[0].got], ['letter', 'P', 'IN THE WATER']);
});

test('NO CALL: a lost ball or a duff by the challenger sets no challenge: no letter, the roles swap', () => {
  const { du, game } = start();
  const nc = hit(du, game, { miss: 'water' });
  assert.deepEqual([nc.event, nc.reason, nc.playerId, nc.nextPlayerId, nc.role, nc.round], ['no-call', 'hazard', 'p1', 'p2', 'challenge', 2]);
  let s = du.state();
  assert.deepEqual([s.role, s.currentPlayerId, s.challengerId, s.call, s.last.kind, s.last.reason], ['challenge', 'p2', 'p2', null, 'no-call', 'hazard']);
  assert.deepEqual(s.players.map((p) => [p.lettersCount, p.noCalls]), [[0, 1], [0, 0]]);
  const duff = hit(du, game, { carry: 25 });
  assert.deepEqual([duff.event, duff.reason, duff.nextPlayerId], ['no-call', 'duff', 'p1']);
  assert.deepEqual(du.state().history.map((h) => h.result), ['no-call', 'no-call']);
  assert.ok(du.state().events.some((e) => e.type === 'no-call' && e.reason === 'duff'));
});

test('first to spell the word has lost; a swing after that is dropped', () => {
  const { du, game } = start({ word: 'PIG' });
  // Alex calls stiff ones, Blair answers wide; Blair's own calls are matched
  let last;
  for (let i = 0; i < 3; i++) {
    hit(du, game, { carry: 150, ft: 10 });                 // Alex calls
    last = hit(du, game, { carry: 150, ft: 120 });         // Blair misses: P, I, G
    if (i < 2) { hit(du, game, { carry: 140 }); hit(du, game, { carry: 141 }); }   // Blair calls, Alex matches
  }
  assert.deepEqual([last.event, last.winnerId, last.loserId, last.reason, last.letter, last.letters], ['duel-over', 'p1', 'p2', 'word', 'G', 'PIG']);
  const s = du.state();
  assert.deepEqual([s.phase, s.winnerId, s.loserId, s.reason, s.currentPlayerId, s.role, s.call, s.round], ['done', 'p1', 'p2', 'word', null, null, null, 5]);
  assert.equal(pl(du, 'p2').letters, 'PIG');
  assert.equal(du.beforeShot(game), null);
  assert.deepEqual([du.waiting.for, du.waiting.timeoutMs], ['dismiss', TIMEOUTS.doneMs]);
  assert.match(s.log.at(-1).text, /ALEX WINS THE DUEL: Blair spelled PIG/);
  // play again: the loser calls first
  assert.deepEqual(du.config(), { players: s.players.map((p) => ({ id: p.id, name: p.name, initials: p.initials })), stageId: 's1', options: { word: 'PIG', maxRounds: 12, first: 1 } });
});

test('the cap: four rounds a letter; when they run out fewer letters wins, level is shared', () => {
  assert.equal(start({ word: 'PIG' }).du.state().maxRounds, 12);
  assert.equal(start({ word: 'HORSE' }).du.state().maxRounds, 20);
  // two rounds: Alex calls and Blair misses; Blair calls and Alex matches
  const a = start({ maxRounds: 2 });
  hit(a.du, a.game, { ft: 10 }); hit(a.du, a.game, { ft: 150 });
  hit(a.du, a.game, {}); const end = hit(a.du, a.game, {});
  assert.deepEqual([end.event, end.reason, end.winnerId, end.loserId], ['duel-over', 'cap', 'p1', 'p2']);
  assert.match(a.du.state().log.at(-1).text, /has more letters \(C\)/);
  // level: shared (a no-call ends a round like any other)
  const b = start({ maxRounds: 2 });
  hit(b.du, b.game, { miss: 'ob' });
  const shared = hit(b.du, b.game, { carry: 20 });
  assert.deepEqual([shared.event, shared.reason, shared.winnerId, shared.loserId], ['duel-over', 'cap', null, null]);
  assert.match(b.du.state().log.at(-1).text, /shared/);
  assert.equal(b.du.config().options.first, 1, 'play again after a shared duel: the other player calls first');
});

test('undo: the last shot is taken back exactly, a call, an answer, the one that ended it; one level', () => {
  const { du, game } = start({ word: 'PIG', maxRounds: 1 });
  const before = du.state();
  hit(du, game, { ft: 10 });
  assert.deepEqual(du.state().undoable, { playerId: 'p1', stray: false, role: 'challenge' });
  assert.deepEqual(du.undoLastShot(game), { event: 'shot-undone', playerId: 'p1', stray: false, role: 'challenge', from: 'play' });
  let s = du.state();
  for (const k of ['phase', 'round', 'role', 'currentPlayerId', 'challengerId', 'call', 'players', 'last', 'history', 'winnerId']) assert.deepEqual(s[k], before[k], k);
  assert.ok(s.seq > before.seq);
  assert.deepEqual([game.ball.y, game.lie, game.player.id, s.undoable], [0, 'tee', 'p1', null]);
  assert.throws(() => du.undoLastShot(game), (e) => e instanceof DuelError && e.status === 409);
  // the answer that ended the duel (the cap, one round)
  hit(du, game, { ft: 10 });
  const called = du.state();
  hit(du, game, { ft: 200 });
  assert.equal(du.phase, 'done');
  assert.equal(du.undoLastShot(game).from, 'done');
  s = du.state();
  assert.deepEqual([s.phase, s.role, s.currentPlayerId, s.call.text, pl(du, 'p2').letters, s.winnerId], ['play', 'match', 'p2', called.call.text, '', null]);
  assert.equal(hit(du, game, { ft: 20 }).event, 'duel-over', 'and this time it is matched: shared');
  assert.equal(du.state().winnerId, null);
});

test('restart: no letters, round one, the other player calls first', () => {
  const { du, game } = start({ word: 'PIG' });
  hit(du, game, { ft: 10 }); hit(du, game, { ft: 200 });
  du.restart(game);
  const s = du.state();
  assert.deepEqual([s.phase, s.round, s.role, s.challengerId, s.currentPlayerId, s.call, s.last, s.history, s.undoable], ['play', 1, 'challenge', 'p2', 'p2', null, null, [], null]);
  assert.deepEqual(s.players.map((p) => [p.letters, p.shots]), [['', 0], ['', 0]]);
  assert.deepEqual([game.ball.y, game.player.id], [0, 'p2']);
  assert.throws(() => createDuel({ players: TWO, stage: STAGE }).restart(), /No duel/);
});

test('a stray ball (under 40 mph off the tee) counts but is marked, and undo takes it back', () => {
  const { du, game } = start();
  const ev = hit(du, game, { carry: 12, mph: 15 });
  assert.deepEqual([ev.event, ev.reason, ev.stray], ['no-call', 'duff', true]);
  assert.deepEqual(du.state().undoable, { playerId: 'p1', stray: true, role: 'challenge' });
  assert.ok(du.state().events.some((e) => e.type === 'stray-shot' && e.speedMph === 15));
  assert.equal(du.undoLastShot(game).stray, true);
  assert.deepEqual([du.state().currentPlayerId, du.state().round, pl(du, 'p1').noCalls], ['p1', 1, 0]);
  // as an answer it would have been a letter
  hit(du, game, { ft: 10 });
  const ans = hit(du, game, { carry: 12, mph: 15 });
  assert.deepEqual([ans.event, ans.stray, ans.letter], ['letter', true, 'C']);
  du.undoLastShot(game);
  assert.deepEqual([pl(du, 'p2').letters, du.state().role], ['', 'match']);
});

test('a swing that comes before "next" is played all the same; the aim is each player\'s own; abort hands the bay back', () => {
  const { du, game } = start();
  game.setAimOffset(3);
  hit(du, game, { ft: 10 });
  assert.equal(du.state().teed, false);
  const ans = hit(du, game, { ft: 15 });   // straight from the last ball: beforeShot tees it up
  assert.equal(ans.event, 'matched');
  du.tee(game);
  assert.deepEqual([game.player.id, game.aimOffset], ['p2', 0]);
  hit(du, game, {});
  du.tee(game);
  assert.deepEqual([game.player.id, game.aimOffset], ['p1', 3], 'Alex\'s aim is still his');
  const s = du.abort(game);
  assert.deepEqual([s.phase, s.aborted, s.waiting, game.dropLocked, game.ball.y], ['done', true, null, false, 0]);
});

test('real swings: a wedge is read as the game played it, and a ball in the lake is no call', () => {
  const { du, game } = start();
  assert.ok(du.beforeShot(game));
  const r = game.handleShot({ Speed: 100, VLA: 22, HLA: 0, TotalSpin: 7600, SpinAxis: -18 });   // a draw
  const ev = du.afterShot(game, r);
  assert.equal(ev.event, 'call');
  assert.ok(Math.abs(ev.shot.carryYd - r.sim.carryYd) < 0.06);
  assert.ok(ev.shot.curveYd < -2, `a spin axis of -18 bends it left (${ev.shot.curveYd} yd)`);
  assert.ok(Math.abs(ev.shot.finishFt - Math.hypot(game.ball.x, game.ball.y - PIN_Y) / YD * 3) < 0.1);
  assert.equal(ev.shot.apexFt, Math.round(r.sim.apexFt));
  assert.ok(du.beforeShot(game));
  const same = du.afterShot(game, game.handleShot({ Speed: 100, VLA: 22, HLA: 0, TotalSpin: 7600, SpinAxis: -18 }));
  assert.equal(same.event, 'matched', 'the same swing matches its own call');
  assert.ok(du.beforeShot(game));
  const wet = du.afterShot(game, game.handleShot({ Speed: 150, VLA: 14, HLA: 0, TotalSpin: 3000, SpinAxis: 0 }));
  assert.deepEqual([wet.event, wet.reason], ['no-call', 'hazard']);
});

test('the state: every field a client reads, and it is plain data', () => {
  const { du, game } = start({ word: 'horse' });
  hit(du, game, { ft: 10, curve: 12, gadgets: [{ id: 'ring-1', kind: 'ring', t: 1 }] });
  const s = du.state();
  assert.deepEqual(Object.keys(s).sort(), ['aborted', 'call', 'canRestart', 'challengerId', 'currentPlayerId', 'endedAt', 'error', 'events', 'history', 'id', 'last', 'log', 'loserId',
    'maxRounds', 'options', 'phase', 'players', 'reason', 'role', 'round', 'seq', 'stage', 'startedAt', 'teed', 'undoable', 'waiting', 'winnerId', 'word'].sort());
  assert.deepEqual(s.options, { word: 'HORSE', maxRounds: 20 });
  assert.deepEqual(Object.keys(s.players[0]).sort(), ['calls', 'id', 'initials', 'letters', 'lettersCount', 'lettersLeft', 'matched', 'missed', 'name', 'noCalls', 'shots', 'slot'].sort());
  assert.deepEqual(s.stage, { id: 's1', name: 'Duel Stage', par: 3, lengthYd: 150, theme: 'links', timeOfDay: 'day', kind: 'stage', wind: { mph: 5, dirDeg: 0, label: '5 MPH' } });
  assert.deepEqual(s.call.parts.map((p) => p.id), ['carry', 'gadget', 'finish']);
  assert.deepEqual(s.call.shot.gadgets, [{ id: 'ring-1', kind: 'ring' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  assert.deepEqual(s.events.map((e) => e.type), ['duel-start', 'stage-loaded', 'turn', 'call', 'turn']);
  for (let i = 1; i < s.events.length; i++) assert.ok(s.events[i].seq > s.events[i - 1].seq);
  assert.equal(TOL.carryPct, 0.1);
});
