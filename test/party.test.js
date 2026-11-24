'use strict';
// PARTY (two to four players on one bay) and handicaps: lib/match.js "v3:modes", docs/modes.md.
// The same engine as the head-to-head, with three formats that work for more than two:
// skins (ties carry over, sudden death only for the last hole), a stroke race (lowest total,
// arcade points break ties) and elimination (highest score on each hole is out; a tie for
// highest goes to an arena, farthest from the pin goes). Turn order, "out of the hole",
// what a swing is for, tricks on a chosen opponent, undo / restart / drop / the stray-ball
// guard / rocket holes for N players, leaving a game, rewards for N profiles, the state
// shape. And handicaps: extra charges, a forward tee on mown ground, a putting level of
// one's own, a suggestion from the profiles.
//
// These tests are the engine's driver, as test/match.test.js is for the head-to-head.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../lib/game');
const {
  createMatch, MatchError, PARTY_FORMATS, PARTY_HOLES, PARTY_MAX, partyFormatFor, partyRewardsFor, applyPartyRewards,
  HELP_LEVELS, normalizeHelp, suggestHelp, forwardTee, FORWARD_TEE_MIN_PIN_YD,
} = require('../lib/match');
const { PLAY_ASSIST } = require('../lib/playability');

// ---------- courses (as test/match.test.js): a straight par 4 of 437 yd with a green 25 m
// round the pin and a lake 40 m past it; an arena: a 150 yd par 3 with the same ----------
const YD = 0.9144;
const stageCourse = (name, par = 4, extra = {}) => () => ({
  name, kind: 'stage', surfaces: [], boundary: null, elevation: null,
  holes: [{ ref: 1, par, tee: [0, 0], pin: [0, 400], lengthYd: 437, line: [[0, 0], [0, 400]] }], ...extra,
});
const ARENA_PIN = 150 * YD;
const arenaCourse = (name, extra = {}) => () => ({
  name, kind: 'arena', surfaces: [], boundary: null, elevation: null,
  holes: [{ ref: 1, par: 3, tee: [0, 0], pin: [0, ARENA_PIN], lengthYd: 150, line: [[0, 0], [0, ARENA_PIN]] }], ...extra,
});
const surfaces = (course) => {
  const pinY = course.kind === 'arena' ? ARENA_PIN : 400;
  return (x, y) => (Math.hypot(x, y - pinY) < 25 ? 'green' : y > pinY + 40 ? 'water' : 'fairway');
};
const newGame = () => new Game({ surfaceLookupFactory: surfaces });
const stageEntry = (n, extra = {}) => ({ id: `s${n}`, order: n, file: `s${n}.json`, name: `Stage ${n}`, par: 4, lengthYd: 437, theme: 'links', ...extra });
const arenaEntry = (n, extra = {}) => ({ id: `a${n}`, order: n, file: `a${n}.json`, name: `Arena ${n}`, par: 3, lengthYd: 150, theme: 'stadium', ...extra });
const tourOf = (stages, arenas) => ({ version: 1, stages: Array.from({ length: stages }, (_, i) => stageEntry(i + 1)), tiebreaks: Array.from({ length: arenas }, (_, i) => arenaEntry(i + 1)) });
const TOUR = tourOf(9, 2);
const COURSES = {};
for (let n = 1; n <= 9; n++) COURSES[`s${n}.json`] = stageCourse(`Stage ${n}`);
for (let n = 1; n <= 3; n++) COURSES[`a${n}.json`] = arenaCourse(`Arena ${n}`);

const PLAYERS = [{ id: 'p1', name: 'Alex' }, { id: 'p2', name: 'Dave' }, { id: 'p3', name: 'Cara' }, { id: 'p4', name: 'Bo' }];
const CATALOGUE = [{ id: 'rocket', rarity: 'epic' }, { id: 'sticky', rarity: 'common' }, { id: 'magnet', rarity: 'rare' }, { id: 'gust', kind: 'trick', rarity: 'rare' }, { id: 'fog', kind: 'trick', rarity: 'common' }];
// the given numbers in turn, then the last one for ever
const rng = (...values) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };
// 0.99 for ever: the shuffle swaps nothing, so the first tee is played in lobby order
const LOBBY_ORDER = () => rng(0.99);

function start(format, n = 3, options = {}, { game = newGame(), tour = TOUR, random = LOBBY_ORDER(), players = PLAYERS.slice(0, n), courses = COURSES } = {}) {
  const match = createMatch({ game, players, tour, random, options: { format, stage: 's1', catalogue: CATALOGUE, ...options } });
  return { match, g: game, courses };
}
function toPlay(match, g, courses = COURSES) {
  for (;;) {
    let w;
    while ((w = match.waiting) && w.for === 'stage') {
      if (w.file) g.setCourse(courses[w.file]());
      assert.equal(match.stageReady(g, w.token), true);
    }
    if (!w || w.for === 'dismiss') return match.state();
    if (w.for === 'ready') assert.equal(match.ready(g), true);
    else if (w.for === 'continue') assert.equal(match.continue(), true);
  }
}
const L = (Speed, VLA, TotalSpin, HLA = 0) => ({ Speed, VLA, HLA, TotalSpin, SpinAxis: 0 });
const DRIVER = L(152, 13, 2650);      // 273 yd from the tee: 165 to go
const DRIVER_SOFT = L(145, 13, 2650); // 256 yd: 181 to go (farther from the hole: plays first)
const I7 = L(111, 19, 7000);          // 148 yd: on the green (arena: 6.1 ft from the pin)
const I7_SOFT = L(110, 19, 7000);     // arena: 11 ft
const I8 = L(105, 21, 7900);          // arena: 40 ft
const LONG = L(140, 14, 3000);        // arena: over the green into the lake
const PUTT = (mph) => L(mph, 0.5, 100);
const IN = PUTT(11);                  // holes the 50 to 65 footers of these tests
const SHORT = PUTT(4);                // leaves it short
function hit(match, g, launch, arcade = null) {
  const shot = match.beforeShot(g);
  assert.ok(shot, 'the match takes the swing');
  const result = g.handleShot(launch);
  assert.ok(result, 'the game played the shot');
  if (arcade) result.arcade = arcade;
  const ev = match.afterShot(g, result);
  return { who: shot.playerId, shot, result, ev, state: match.state() };
}
// play the hole in play: each player by a script { id: [launches] }; a missing entry: drive, 7-iron, hole the putt
function playHole(match, g, script = {}) {
  let last = null;
  const order = [];
  while (match.phase === 'play') {
    const id = match.currentPlayerId;
    const st = match.state();
    const me = st.players.find((p) => p.id === id);
    const mine = script[id];
    const launch = mine && mine.length ? mine.shift() : me.lie === 'green' ? IN : me.strokes === 0 ? DRIVER : I7;
    order.push(id);
    last = hit(match, g, launch);
  }
  return { ...last, order };
}
// a sudden death: each player's ball by id
function playSuddenDeath(match, g, balls) {
  let last = null;
  const round = match.state().tiebreak.round;
  while (match.phase === 'tiebreak' && match.state().tiebreak.round === round) last = hit(match, g, balls[match.currentPlayerId]);
  return last;
}
const player = (state, id) => state.players.find((p) => p.id === id);
const types = (state) => state.events.map((e) => e.type);
const core = (s) => { const { seq, events, log, turnStartedAt, undoable, waiting, ...rest } = s; return rest; };

// ---------- formats ----------

test('party formats: skins and a stroke race over 3 / 6 / 9 holes, elimination over one hole fewer than the players', () => {
  assert.deepEqual(Object.keys(PARTY_FORMATS), ['skins', 'stroke', 'elim']);
  assert.deepEqual([...PARTY_HOLES], [3, 6, 9]);
  assert.equal(PARTY_MAX, 4);
  assert.deepEqual([3, 6, 9].map((h) => { const f = partyFormatFor('skins', h, 4); return [f.id, f.label, f.party, f.maxHoles, f.charges, f.trophies, f.coins, f.chest]; }), [
    ['skins', 'Skins · 3 Holes', true, 3, 3, 20, 250, 2], ['skins', 'Skins · 6 Holes', true, 6, 4, 30, 400, 3], ['skins', 'Skins · 9 Holes', true, 9, 6, 40, 600, 4],
  ]);
  assert.equal(partyFormatFor('STROKE', 5, 3).maxHoles, 3, 'an odd number of holes is three');
  assert.deepEqual([2, 3, 4].map((n) => { const f = partyFormatFor('elim', 9, n); return [f.maxHoles, f.charges]; }), [[1, 2], [2, 3], [3, 3]]);
  assert.equal(partyFormatFor('bo3'), null, 'the head-to-head formats are not party formats');
  assert.equal(partyFormatFor(undefined), null);
});

test('a party takes two to four different players; a head-to-head still takes exactly two', () => {
  assert.throws(() => createMatch({ players: [PLAYERS[0]], tour: TOUR, options: { format: 'skins' } }), /two to four players/);
  assert.throws(() => createMatch({ players: [...PLAYERS, { id: 'p5', name: 'Eve' }], tour: TOUR, options: { format: 'skins' } }), /two to four players/);
  assert.throws(() => createMatch({ players: [PLAYERS[0], PLAYERS[1], PLAYERS[0]], tour: TOUR, options: { format: 'stroke' } }), /Pick different players/);
  assert.throws(() => createMatch({ players: PLAYERS.slice(0, 3), tour: TOUR, options: { format: 'bo3' } }), /A match needs two players/);
  assert.throws(() => createMatch({ players: PLAYERS.slice(0, 3), tour: TOUR }), /A match needs two players/);
  for (const n of [2, 3, 4]) assert.equal(start('elim', n).match.state().players.length, n);
  // stakes are a head-to-head thing: a party is always a friendly
  assert.equal(start('skins', 3, { stakes: 'pro' }).match.state().stakes, null);
});

test('the state of a party: the contract shape plus the party fields; a head-to-head has none of them', () => {
  const { match, g } = start('skins', 4, { holes: 6 });
  let s = match.state();
  assert.deepEqual([s.party, s.holes, s.format, s.formatLabel, s.target, s.maxHoles, s.carry, s.skinsAtStake, s.placings], ['skins', 6, 'skins', 'Skins · 6 Holes', null, 6, 0, 1, null]);
  assert.deepEqual(s.teeOrder, ['p1', 'p2', 'p3', 'p4']);
  assert.equal(s.honourId, 'p1');
  assert.deepEqual(s.players.map((p) => [p.id, p.slot, p.charges, p.out, p.left, p.pickedUp, p.total, p.place]),
    [['p1', 1, 4, false, false, false, 0, null], ['p2', 2, 4, false, false, false, 0, null], ['p3', 3, 4, false, false, false, 0, null], ['p4', 4, 4, false, false, false, 0, null]]);
  assert.equal('help' in s.players[0], false, 'no help: no help field');
  assert.deepEqual(types(s), ['match-start', 'coin-flip']);
  assert.deepEqual(s.events[0].playerIds, ['p1', 'p2', 'p3', 'p4']);
  assert.deepEqual(s.events[1].order, ['p1', 'p2', 'p3', 'p4']);
  assert.match(s.log[0].text, /Alex, Dave, Cara and Bo: Skins · 6 Holes\. Alex wins the draw/);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(s)), 'serializable');
  s = toPlay(match, g);
  assert.deepEqual([s.phase, s.currentPlayerId, s.matchPoint, s.standings], ['play', 'p1', null, 'ALL SQUARE']);
  // the draw: the order of the first tee is shuffled
  const drawn = start('skins', 4, {}, { random: rng(0.1) }).match.state();
  assert.notDeepEqual(drawn.teeOrder, ['p1', 'p2', 'p3', 'p4']);
  assert.deepEqual([...drawn.teeOrder].sort(), ['p1', 'p2', 'p3', 'p4']);
  assert.equal(drawn.honourId, drawn.teeOrder[0]);
  // a head-to-head: none of it
  const vs = createMatch({ game: newGame(), players: PLAYERS.slice(0, 2), tour: TOUR, random: rng(0.1), options: { format: 'bo3', stage: 's1' } }).state();
  for (const k of ['party', 'holes', 'teeOrder', 'carry', 'skinsAtStake', 'placings']) assert.equal(k in vs, false, k);
  for (const k of ['out', 'left', 'pickedUp', 'total', 'place', 'help', 'teeYd']) assert.equal(k in vs.players[0], false, k);
});

// ---------- turn order ----------

test('turn order: the tee in honour order, then the farthest from the hole; on the green the fewest strokes putt first', () => {
  const { match, g } = start('skins', 4);
  toPlay(match, g);
  const order = [];
  const next = (launch) => { order.push(match.currentPlayerId); return hit(match, g, launch); };
  // the tee: lobby order (the draw of this test)
  next(DRIVER); next(DRIVER_SOFT); next(DRIVER); next(DRIVER_SOFT);
  assert.deepEqual(order, ['p1', 'p2', 'p3', 'p4']);
  // off the tee: the two soft drives are farther (181 yd against 165): they go first, level on distance by the tee order
  assert.deepEqual([match.currentPlayerId], ['p2']);
  const t = next(DINK);           // p2 moves it a yard and a half: now p4, who has not moved, is the farthest
  assert.equal(t.state.currentPlayerId, 'p4');
  next(I7);                       // p4 on the green in 2
  assert.equal(match.currentPlayerId, 'p2', 'p2 is the farthest again');
  next(I7);                       // p2 on in 3
  next(I7); next(I7);             // p1, p3 on in 2
  assert.deepEqual(order.slice(4), ['p2', 'p4', 'p2', 'p1', 'p3']);
  // all four on the green: p2 lies 3, the others 2. Fewest strokes first; level on strokes, the farthest first
  const s = match.state();
  assert.ok(s.players.every((p) => p.lie === 'green'));
  const dist = Object.fromEntries(s.players.map((p) => [p.id, p.distToPinYd]));
  const expected = ['p1', 'p3', 'p4'].sort((a, b) => dist[b] - dist[a] || s.teeOrder.indexOf(a) - s.teeOrder.indexOf(b));
  assert.equal(s.currentPlayerId, expected[0], 'a player lying 2 before the player lying 3, whoever is farther');
  assert.notEqual(s.currentPlayerId, 'p2');
});
const DINK = L(8, 10, 1000);          // a yard and a half

test('a stroke race putts in golf order: the farthest first, whatever the strokes', () => {
  const { match, g } = start('stroke', 2);
  toPlay(match, g);
  const script = (m, gm) => {
    hit(m, gm, DRIVER);           // p1: 165 to go
    hit(m, gm, DRIVER_SOFT);      // p2: 181 to go
    hit(m, gm, DINK);             // p2 again: a yard and a half
    hit(m, gm, I7);               // p2 on the green in 3, 65 ft away
    hit(m, gm, I7);               // p1 on the green in 2, 50 ft away
    return m.state();
  };
  const s = script(match, g);
  assert.deepEqual(s.players.map((p) => [p.strokes, p.lie]), [[2, 'green'], [3, 'green']]);
  assert.ok(s.players[1].distToPinYd > s.players[0].distToPinYd, 'p2 is the farther');
  assert.equal(s.currentPlayerId, 'p2', 'a stroke race: the farthest putts first, though they have taken more');
  // the same balls in a skins game: the fewer strokes putt first
  const sk = start('skins', 2);
  toPlay(sk.match, sk.g);
  assert.equal(script(sk.match, sk.g).currentPlayerId, 'p1');
});

// ---------- skins ----------

test('skins: the lowest score alone takes the skin; a tie carries it over; the game ends the moment it is won', () => {
  const { match, g } = start('skins', 3);
  let s = toPlay(match, g);
  assert.equal(s.skinsAtStake, 1);
  // hole 1: all three make 3: nobody wins, the skin carries
  let t = playHole(match, g);
  assert.deepEqual([t.ev.event, t.ev.reason, t.ev.carry, t.ev.next], ['hole-tied', 'carry', 1, 'hole']);
  s = t.state;
  assert.deepEqual([s.phase, s.carry, s.skinsAtStake, s.standings], ['hole-result', 1, 2, 'ALL SQUARE · 2 SKINS ON THE NEXT']);
  assert.deepEqual(s.lastResult, { holeNumber: 1, stageId: 's1', stageName: 'Stage 1', par: 4, winnerId: null, reason: 'carry', scores: { p1: 3, p2: 3, p3: 3 }, finish: { p1: 'holed', p2: 'holed', p3: 'holed' }, tiebreak: null, party: 'skins', skins: 1, carry: 1 });
  assert.match(s.log.at(-2).text, /No winner \(Alex, Dave and Cara make a birdie\): the skin carries over\. 2 SKINS on the next hole!/);
  // hole 2: p2 alone makes 3 (the others miss their putts and are swept up): two skins
  toPlay(match, g);
  t = playHole(match, g, { p1: [DRIVER, I7, SHORT], p3: [DRIVER, I7, SHORT] });
  assert.deepEqual([t.ev.event, t.ev.winnerId, t.ev.skins, t.ev.reason], ['match-over', 'p2', 2, 'holes'], 'the hole that decides the game is the game\'s closing event');
  s = t.state;
  assert.deepEqual([s.lastResult.winnerId, s.lastResult.reason, s.lastResult.skins, s.lastResult.finish], ['p2', 'knockout', 2, { p1: 'picked-up', p2: 'holed', p3: 'picked-up' }]);
  assert.deepEqual(s.players.map((p) => p.holesWon), [0, 2, 0]);
  assert.deepEqual([s.carry, s.skinsAtStake, s.phase, s.honourId], [0, 1, 'done', 'p2'], 'two skins up with one to play: it is over');
  assert.deepEqual([s.winnerId, s.reason, s.placings], ['p2', 'holes', ['p2', 'p1', 'p3']]);
  assert.deepEqual(s.players.map((p) => p.place), [2, 1, 3]);
  assert.deepEqual(types(s).slice(-2), ['hole-won', 'match-over']);
  assert.equal(match.active, false);
});

test('skins, out of the hole: a player who can no longer tie the best score picks up at once', () => {
  const { match, g } = start('skins', 4);
  toPlay(match, g);
  // p1 holes out in 3. p2 and p3 lie 2 on the green (one swing each, to tie); p4 lies 3 after a bad second: out of the hole
  hit(match, g, DRIVER_SOFT);                    // p1
  hit(match, g, DRIVER); hit(match, g, DRIVER);  // p2, p3
  hit(match, g, DRIVER_SOFT);                    // p4 (as far as p1)
  hit(match, g, I7);                             // p1 on the green (farthest, first in tee order)
  hit(match, g, DINK);                           // p4 moves it a yard and a half
  hit(match, g, I7);                             // p4 on in 3
  hit(match, g, I7); hit(match, g, I7);          // p2, p3 on in 2
  // all on the green: the players lying 2 before p4; p1 is among them
  let s = match.state();
  assert.deepEqual(s.players.map((p) => p.strokes), [2, 2, 2, 3]);
  const first = s.currentPlayerId;
  assert.notEqual(first, 'p4');
  // whoever putts first holes it for 3: p4 (lying 3) is swept up at once, the other two must hole to tie
  const t = hit(match, g, IN);
  s = t.state;
  assert.equal(player(s, first).holed, true);
  assert.deepEqual([player(s, 'p4').pickedUp, player(s, 'p4').holed], [true, false]);
  assert.ok(types(s).includes('picked-up'));
  assert.match(s.log.map((l) => l.text).join('|'), /Bo can't catch that: picks up\./);
  const up = player(s, s.currentPlayerId);
  assert.deepEqual([up.mustHole, up.shotFor, up.shotKind], [true, 'tie', 'putt'], 'lying one fewer than the score that is in: hole it or pick up');
  assert.ok(types(s).includes('must-hole'));
  // they miss: swept up too; the last one holes it and ties: the skin carries
  hit(match, g, SHORT);
  s = match.state();
  assert.equal(s.players.filter((p) => p.pickedUp).length, 2);
  const end = hit(match, g, IN);
  assert.deepEqual([end.ev.event, end.ev.reason, end.ev.clutch], ['hole-tied', 'carry', 'tie']);
  assert.match(end.state.log.map((l) => l.text).join('|'), /SAVES THE SKIN! No winner/);
  const fin = end.state.lastResult.finish;
  assert.deepEqual(Object.values(fin).sort(), ['holed', 'holed', 'picked-up', 'picked-up']);
});

test('skins, what a swing is for: to win the skin, to save it, and nothing for a putt that changes nothing', () => {
  const { match, g } = start('skins', 3);
  toPlay(match, g);
  for (let i = 0; i < 3; i++) hit(match, g, DRIVER);
  for (let i = 0; i < 3; i++) hit(match, g, I7);
  // three balls on the green, all lying 2: whoever putts first, a make leaves the others one swing each ('lead')
  let s = match.state();
  assert.equal(player(s, s.currentPlayerId).shotFor, 'lead');
  hit(match, g, SHORT);          // misses: lies 3
  s = match.state();
  const leaderA = s.currentPlayerId;
  assert.equal(player(s, leaderA).strokes, 2, 'a player lying 2 putts before the one lying 3');
  assert.equal(player(s, leaderA).shotFor, 'lead', 'another player lying 2 could still tie it');
  hit(match, g, SHORT);
  // now two lie 3 and one lies 2: that one putts FOR THE SKIN (a make sweeps both)
  s = match.state();
  const last2 = s.players.find((p) => p.strokes === 2);
  assert.equal(s.currentPlayerId, last2.id);
  assert.deepEqual([last2.shotFor, last2.shotKind, last2.mustHole], ['win', 'putt', false]);
  assert.deepEqual(s.events.at(-1), { seq: s.events.at(-1).seq, type: 'turn', t: s.events.at(-1).t, playerId: last2.id, mustHole: false, shotFor: 'win', shotKind: 'putt' });
  const t = hit(match, g, IN);
  assert.deepEqual([t.ev.event, t.ev.winnerId, t.ev.clutch, t.ev.reason], ['hole-won', last2.id, 'win', 'knockout']);
  assert.equal(t.state.events.find((e) => e.type === 'hole-won').clutch, 'win');
});

test('skins: a tie on the LAST hole goes to sudden death for everything that is left, between the players who tied', () => {
  const { match, g } = start('skins', 3);
  toPlay(match, g);
  playHole(match, g);                                   // hole 1: all tie, carry 1
  toPlay(match, g);
  playHole(match, g);                                   // hole 2: all tie, carry 2
  toPlay(match, g);
  // hole 3: p1 and p2 make 3, p3 misses: the last hole is tied between p1 and p2 for 3 skins
  let t = playHole(match, g, { p3: [DRIVER, I7, SHORT] });
  assert.deepEqual([t.ev.event, t.ev.reason, t.ev.next, t.ev.goal], ['hole-tied', 'tied', 'tiebreak', 'best']);
  assert.deepEqual(t.ev.playerIds.sort(), ['p1', 'p2']);
  let s = t.state;
  assert.deepEqual([s.phase, s.nextStage.kind, s.lastResult.reason, s.lastResult.skins], ['hole-result', 'tiebreak', 'tied', 3]);
  s = toPlay(match, g);
  assert.deepEqual([s.phase, s.stage.id, s.tiebreak.goal], ['tiebreak', 'a2', 'best']);
  assert.deepEqual([...s.tiebreak.ids].sort(), ['p1', 'p2'], 'only the players who tied hit');
  assert.deepEqual([...s.tiebreak.pending].sort(), ['p1', 'p2']);
  // both in the water: again. Then 6 ft beats 40 ft.
  t = playSuddenDeath(match, g, { p1: LONG, p2: LONG });
  assert.deepEqual([t.ev.event, t.ev.again, t.state.tiebreak.round], ['tiebreak-shot', true, 2]);
  assert.ok(types(t.state).includes('tiebreak-again'));
  const led = s.tiebreak.ids[0];
  assert.equal(t.state.tiebreak.ids[0], s.tiebreak.ids[1], 'the other player leads off the next round');
  assert.equal(t.state.tiebreak.ids.at(-1), led);
  t = playSuddenDeath(match, g, { p1: I8, p2: I7 });
  assert.deepEqual([t.ev.event, t.ev.winnerId, t.ev.reason], ['match-over', 'p2', 'tiebreak']);
  s = t.state;
  assert.deepEqual(s.players.map((p) => p.holesWon), [0, 3, 0]);
  assert.deepEqual([s.winnerId, s.reason], ['p2', 'tiebreak']);
  const r = s.holeResults.at(-1);
  assert.deepEqual([r.holeNumber, r.winnerId, r.reason, r.skins, r.tiebreak.arenaId, r.tiebreak.goal, r.tiebreak.rounds.length], [3, 'p2', 'tiebreak', 3, 'a2', 'best', 2]);
  assert.equal(s.holeResults.length, 3, 'the sudden death settles the tied hole: no extra result');
});

test('skins: level on skins when the holes run out is a sudden-death playoff between those level', () => {
  const { match, g } = start('skins', 3);
  const miss = (ids) => Object.fromEntries(ids.map((id) => [id, [DRIVER, I7, SHORT, SHORT]]));
  toPlay(match, g); playHole(match, g, miss(['p2', 'p3']));   // p1 a skin
  toPlay(match, g); playHole(match, g, miss(['p1', 'p3']));   // p2 a skin
  toPlay(match, g);
  const t = playHole(match, g, miss(['p1', 'p2']));           // p3 a skin: 1-1-1
  assert.deepEqual([t.ev.event, t.ev.winnerId, t.ev.next, t.ev.goal], ['hole-won', 'p3', 'tiebreak', 'best']);
  assert.deepEqual(t.ev.playerIds.sort(), ['p1', 'p2', 'p3']);
  let s = t.state;
  assert.deepEqual([s.phase, s.nextStage.kind], ['hole-result', 'tiebreak']);
  assert.match(s.log.at(-1).text, /ALL SQUARE on skins after the last hole: SUDDEN DEATH between .* decides the game!/);
  s = toPlay(match, g);
  assert.deepEqual([s.phase, s.holeNumber, s.tiebreak.ids.length], ['tiebreak', 4, 3]);
  const end = playSuddenDeath(match, g, { p1: I8, p2: I7_SOFT, p3: I7 });
  assert.deepEqual([end.ev.event, end.ev.winnerId, end.ev.reason], ['match-over', 'p3', 'tiebreak']);
  s = end.state;
  assert.deepEqual(s.holeResults.at(-1).playoff, true);
  assert.equal(s.holeResults.length, 4);
  assert.deepEqual(s.players.map((p) => p.holesWon), [1, 1, 1], 'a playoff decides the game, it is no skin');
});

// ---------- stroke race ----------

test('a stroke race: every stroke counts, the cap counts one more, the lowest total wins; nobody picks up', () => {
  const { match, g } = start('stroke', 3);
  toPlay(match, g);
  // hole 1: p1 3, p2 3, p3 misses and misses and takes 5: nobody is swept up after p1 is in
  let t = playHole(match, g, { p3: [DRIVER, I7, SHORT, SHORT] });
  assert.deepEqual([t.ev.event, t.ev.reason, t.ev.winnerId], ['hole-won', 'score', null], 'the best of the hole is shared: no winner of it');
  let s = t.state;
  assert.equal(s.players.some((p) => p.pickedUp), false);
  assert.ok(!types(s).includes('picked-up'));
  assert.ok(!types(s).includes('must-hole'));
  assert.deepEqual(s.players.map((p) => p.total).slice(0, 2), [3, 3]);
  const p3hole1 = player(s, 'p3').total;
  assert.ok(p3hole1 >= 5, `p3 took ${p3hole1}`);
  assert.deepEqual(s.lastResult.scores, { p1: 3, p2: 3, p3: p3hole1 });
  assert.equal(s.standings, 'ALL SQUARE');
  assert.deepEqual(s.teeOrder, ['p1', 'p2', 'p3'], 'the next tee: this hole\'s scores, best first');
  // hole 2: p2 never holes out: capped at par + 3, counted as 8
  toPlay(match, g);
  t = playHole(match, g, { p2: [DRIVER, I7, SHORT, SHORT, PUTT(1), PUTT(1), PUTT(1), PUTT(1)] });
  s = t.state;
  assert.equal(s.lastResult.finish.p2 === 'capped' || s.lastResult.scores.p2 >= 7, true);
  assert.equal(s.lastResult.winnerId, null);
  assert.equal(player(s, 'p1').total, 6);
  assert.equal(s.standings, `Alex LEADS BY ${Math.min(player(s, 'p2').total, player(s, 'p3').total) - 6}`);
  // hole 3: all make 3: p1 wins on strokes
  toPlay(match, g);
  t = playHole(match, g);
  assert.deepEqual([t.ev.event, t.ev.winnerId, t.ev.reason], ['match-over', 'p1', 'holes']);
  s = t.state;
  assert.equal(s.placings[0], 'p1');
  assert.deepEqual(s.players.map((p) => p.holeScores.length), [3, 3, 3]);
  assert.equal(s.holesPlayed, 3);
});

test('a stroke race level on strokes: arcade points break the tie; level on both: a sudden death', () => {
  const pts = (points) => ({ grade: 'GOOD', points, callout: null, label: 'Shot' });
  const a = start('stroke', 2);
  toPlay(a.match, a.g);
  for (let h = 0; h < 3; h++) {
    while (a.match.phase === 'play') {
      const st = a.match.state();
      const me = player(st, a.match.currentPlayerId);
      hit(a.match, a.g, me.lie === 'green' ? IN : me.strokes === 0 ? DRIVER : I7, pts(me.id === 'p2' ? 120 : 100));
    }
    if (h < 2) toPlay(a.match, a.g);
  }
  let s = a.match.state();
  assert.deepEqual(s.players.map((p) => p.total), [9, 9]);
  assert.deepEqual([s.phase, s.winnerId, s.reason], ['done', 'p2', 'points'], 'p2 has more arcade points');
  // the last putt of the race was for the win or to tie: said on the player who is up
  const b = start('stroke', 2);
  toPlay(b.match, b.g);
  playHole(b.match, b.g); toPlay(b.match, b.g);
  playHole(b.match, b.g); toPlay(b.match, b.g);
  for (let i = 0; i < 2; i++) hit(b.match, b.g, DRIVER);
  for (let i = 0; i < 2; i++) hit(b.match, b.g, I7);
  const firstUp = b.match.currentPlayerId;
  assert.equal(player(b.match.state(), firstUp).shotFor, null, 'the other player is still out: nothing is decided by this putt');
  hit(b.match, b.g, IN);
  s = b.match.state();
  const lastUp = player(s, s.currentPlayerId);
  assert.deepEqual([lastUp.shotFor, lastUp.mustHole, lastUp.shotKind], ['tie', false, 'putt'], 'hole it to tie the race (a miss is no knockout)');
  const t = hit(b.match, b.g, IN);
  // 9 strokes each and no points: a sudden death decides
  assert.deepEqual([t.ev.event, t.ev.next, t.ev.goal], ['hole-won', 'tiebreak', 'best']);
  s = toPlay(b.match, b.g);
  assert.equal(s.phase, 'tiebreak');
  const end = playSuddenDeath(b.match, b.g, { p1: I7, p2: I8 });
  assert.deepEqual([end.ev.event, end.ev.winnerId, end.state.reason], ['match-over', 'p1', 'tiebreak']);
});

// ---------- elimination ----------

test('elimination: the highest score on each hole is out, until one player is left', () => {
  const { match, g } = start('elim', 4);
  let s = toPlay(match, g);
  assert.deepEqual([s.maxHoles, s.standings], [3, '4 PLAYERS LEFT']);
  // hole 1: p3 takes 5, the others 3: p3 is out, fourth
  let t = playHole(match, g, { p3: [DRIVER, I7, SHORT, SHORT] });
  assert.deepEqual([t.ev.event, t.ev.eliminatedId, t.ev.reason, t.ev.next], ['hole-won', 'p3', 'knockout', 'hole']);
  s = t.state;
  assert.deepEqual([player(s, 'p3').out, player(s, 'p3').place, player(s, 'p3').outOnHole], [true, 4, 1]);
  assert.ok(types(s).includes('eliminated'));
  assert.equal(s.lastResult.eliminatedId, 'p3');
  assert.equal(s.standings, '3 PLAYERS LEFT');
  assert.equal(s.teeOrder.includes('p3'), false);
  // hole 2: three play; p3 never comes up, and cannot arm
  s = toPlay(match, g);
  assert.deepEqual([s.holeNumber, s.stage.id], [2, 's2']);
  assert.throws(() => match.arm('p3', 'rocket'), (e) => e instanceof MatchError && e.status === 409 && /Cara is out of the game/.test(e.message));
  t = playHole(match, g, { p4: [DRIVER, I7, SHORT, SHORT] });
  assert.equal(t.order.includes('p3'), false);
  assert.deepEqual([t.ev.eliminatedId, player(t.state, 'p4').place], ['p4', 3]);
  assert.equal(t.state.standings, 'THE FINAL: Alex v Dave');
  // the final: a head-to-head, the higher score is out
  s = toPlay(match, g);
  assert.ok(types(s).includes('final-two'));
  t = playHole(match, g, { p1: [DRIVER, I7, SHORT] });
  assert.deepEqual([t.ev.event, t.ev.winnerId, t.ev.eliminatedId], ['match-over', 'p2', 'p1']);
  s = t.state;
  assert.deepEqual([s.winnerId, s.loserId, s.placings, s.standings], ['p2', 'p3', ['p2', 'p1', 'p4', 'p3'], 'Dave WINS']);
  assert.deepEqual(s.players.map((p) => p.place), [2, 1, 4, 3]);
});

test('elimination, out of the hole: the last player still out who can no longer escape the highest score picks up', () => {
  const { match, g } = start('elim', 3);
  toPlay(match, g);
  for (let i = 0; i < 3; i++) hit(match, g, DRIVER);
  for (let i = 0; i < 3; i++) hit(match, g, I7);
  // all lie 2 on the green. The first two hole out for 3; the last one lies 2: one swing, to stay alive
  hit(match, g, IN);
  let s = match.state();
  assert.equal(s.players.some((p) => p.mustHole), false, 'with two players still out nobody is on a must-make yet');
  hit(match, g, IN);
  s = match.state();
  const last = player(s, s.currentPlayerId);
  assert.deepEqual([last.mustHole, last.shotFor, last.shotKind], [true, 'tie', 'putt']);
  assert.match(s.log.at(-1).text, /must hole this to stay alive/);
  // missed: 3 strokes, the others are in with 3: sure to be the highest alone: picked up and out, no more swings
  const t = hit(match, g, SHORT);
  assert.deepEqual([t.ev.event, t.ev.eliminatedId, t.ev.reason], ['hole-won', last.id, 'knockout']);
  assert.equal(t.state.lastResult.finish[last.id], 'picked-up');
  assert.match(t.state.log.map((l) => l.text).join('|'), /is OUT: nothing left to save the hole with/);
});

test('elimination: a tie for the highest score goes to an arena, and the farthest from the pin is out', () => {
  const { match, g } = start('elim', 4);
  toPlay(match, g);
  // p1 makes 3; p2, p3 and p4 all take 4: those three go to sudden death
  let t = playHole(match, g, { p2: [DRIVER, I7, SHORT, IN], p3: [DRIVER, I7, SHORT, IN], p4: [DRIVER, I7, SHORT, IN] });
  assert.deepEqual([t.ev.event, t.ev.reason, t.ev.goal], ['hole-tied', 'tied', 'worst']);
  assert.deepEqual(t.ev.playerIds.sort(), ['p2', 'p3', 'p4']);
  let s = toPlay(match, g);
  assert.deepEqual([s.phase, s.tiebreak.goal, [...s.tiebreak.ids].sort()], ['tiebreak', 'worst', ['p2', 'p3', 'p4']]);
  // round 1: p2 close, p3 and p4 both in the water: p2 is safe, the two who missed go again
  t = playSuddenDeath(match, g, { p2: I7, p3: LONG, p4: LONG });
  assert.equal(t.ev.again, true);
  s = t.state;
  assert.deepEqual([s.tiebreak.round, [...s.tiebreak.ids].sort()], [2, ['p3', 'p4']]);
  assert.match(s.log.map((l) => l.text).join('|'), /Still level: sudden death round 2 between (Cara and Bo|Bo and Cara)!/);
  // round 2: p3 40 ft, p4 6 ft: p3 is out
  t = playSuddenDeath(match, g, { p3: I8, p4: I7 });
  assert.deepEqual([t.ev.event, t.ev.eliminatedId, t.ev.reason, t.ev.next], ['hole-won', 'p3', 'tiebreak', 'hole']);
  s = t.state;
  assert.deepEqual([player(s, 'p3').out, s.lastResult.reason, s.lastResult.eliminatedId, s.lastResult.tiebreak.goal, s.holeResults.length], [true, 'tiebreak', 'p3', 'worst', 1]);
  assert.match(s.log.map((l) => l.text).join('|'), /Cara is farthest from the pin: OUT!/);
  // a ball on land beats a ball in the water: one miss among three is out at once
  const b = start('elim', 3);
  toPlay(b.match, b.g);
  playHole(b.match, b.g);   // all make 3
  toPlay(b.match, b.g);
  const end = playSuddenDeath(b.match, b.g, { p1: I7, p2: LONG, p3: I8 });
  assert.deepEqual([end.ev.eliminatedId, end.ev.again], ['p2', undefined]);
});

// ---------- every mechanic for N ----------

test('loadouts and tricks for N: a trick lands on the opponent chosen, or by default on whoever is doing best', () => {
  const { match, g } = start('skins', 4);
  toPlay(match, g);
  // a ball for oneself, as ever
  assert.equal(match.arm('p1', 'rocket'), 'rocket');
  // a trick on a chosen opponent
  assert.equal(match.arm('p2', 'gust', 'p4'), 'gust');
  let s = match.state();
  assert.deepEqual(s.players.map((p) => p.cursedWith), [null, null, null, 'gust']);
  assert.deepEqual(s.events.at(-1), { seq: s.events.at(-1).seq, type: 'trick-cast', t: s.events.at(-1).t, playerId: 'p2', id: 'gust', targetId: 'p4' });
  assert.equal(player(s, 'p2').charges, 2);
  // not on oneself, not on nobody, not on a cursed player
  assert.throws(() => match.arm('p3', 'fog', 'p3'), /Pick an opponent/);
  assert.throws(() => match.arm('p3', 'fog', 'nobody'), /Pick an opponent/);
  assert.throws(() => match.arm('p3', 'fog', 'p4'), (e) => e.status === 409 && /Bo is already cursed/.test(e.message));
  // no target: all level, so the first of the tee order who carries no curse (p1 for p3)
  assert.equal(match.arm('p3', 'fog'), 'fog');
  assert.equal(player(match.state(), 'p1').cursedWith, 'fog');
  // the swing takes the ball and the curse with it
  let t = hit(match, g, DRIVER);
  assert.deepEqual([t.who, t.shot.armed, t.shot.curses], ['p1', 'rocket', ['fog']]);
  hit(match, g, DRIVER); hit(match, g, DRIVER);
  t = hit(match, g, DRIVER);
  assert.deepEqual([t.who, t.shot.curses], ['p4', ['gust']]);
  assert.deepEqual(t.state.players.map((p) => p.cursedWith), [null, null, null, null]);
  // by default the leader is the target: p2 takes the first skin, then p1's trick finds p2
  playHole(match, g, { p1: [I7, SHORT], p3: [I7, SHORT], p4: [I7, SHORT] });
  toPlay(match, g);
  assert.deepEqual(match.state().players.map((p) => p.holesWon), [0, 1, 0, 0]);
  match.arm('p1', 'gust');
  assert.equal(player(match.state(), 'p2').cursedWith, 'gust');
});

test('undo for N: a swing that swept two players up and closed the hole is taken back exactly', () => {
  const { match, g } = start('skins', 3);
  toPlay(match, g);
  for (let i = 0; i < 3; i++) hit(match, g, DRIVER);
  for (let i = 0; i < 3; i++) hit(match, g, I7);
  hit(match, g, SHORT); hit(match, g, SHORT);     // two lie 3, one lies 2
  const before = match.state();
  const ball = { ...g.ball };
  const t = hit(match, g, IN);                    // for the skin: holed, both others swept up, hole won
  assert.equal(t.ev.event, 'hole-won');
  assert.equal(t.state.players.filter((p) => p.pickedUp).length, 2);
  assert.deepEqual(t.state.undoable, { playerId: t.who, stray: false, holeNumber: 1 });
  const ev = match.undoLastShot(g);
  assert.deepEqual(ev, { event: 'shot-undone', playerId: t.who, stray: false, from: 'hole-result' });
  const s = match.state();
  assert.deepEqual(core(s), core(before), 'the party exactly as it was before the swing');
  assert.deepEqual([s.phase, s.currentPlayerId, s.holeResults.length, s.players.map((p) => p.pickedUp)], ['play', t.who, 0, [false, false, false]]);
  assert.deepEqual(g.ball, ball, 'the game has the ball back where it lay');
  assert.equal(g.player.id, t.who);
  // and a swing that eliminated a player and ended the game
  const e = start('elim', 2);
  toPlay(e.match, e.g);
  const end = playHole(e.match, e.g, { p1: [DRIVER, I7, SHORT] });
  assert.equal(end.ev.event, 'match-over');
  e.match.undoLastShot(e.g);
  const back = e.match.state();
  assert.deepEqual([back.phase, back.winnerId, back.placings, back.players.map((p) => p.out), back.players.map((p) => p.place)], ['play', null, null, [false, false], [null, null]]);
});

test('restart the hole for N: everybody back on the tee, the balls and tricks of the hole back in the loadouts', () => {
  const { match, g } = start('stroke', 4);
  toPlay(match, g);
  match.arm('p1', 'rocket');
  match.arm('p2', 'gust', 'p3');
  for (let i = 0; i < 4; i++) hit(match, g, DRIVER);
  hit(match, g, I7);
  let s = match.state();
  assert.equal(s.canRestartHole, true);
  const ev = match.restartHole(g);
  assert.deepEqual(ev, { event: 'hole-restarted', holeNumber: 1, tiebreak: false });
  s = match.state();
  assert.deepEqual(s.players.map((p) => [p.strokes, p.lie, p.charges, p.cursedWith, p.armedPowerup]), [[0, 'tee', 3, null, null], [0, 'tee', 3, null, null], [0, 'tee', 3, null, null], [0, 'tee', 3, null, null]]);
  assert.match(s.log.at(-1).text, /Hole 1 starts again: everybody back on the tee/);
  assert.equal(s.currentPlayerId, 'p1');
});

test('the drop on the line for N: it costs a stroke, and the stroke can sweep its taker out of the hole', () => {
  const { match, g } = start('skins', 3);
  g.playAssist = PLAY_ASSIST;
  toPlay(match, g);
  assert.throws(() => match.drop(g, 'p2'), (e) => e.status === 409 && /Alex's turn/.test(e.message));
  // p1 goes wide off the tee (30 yd right of the line), the others down the middle: p1 is the farthest and has a drop to take
  hit(match, g, L(150, 12, 2500, 7)); hit(match, g, DRIVER); hit(match, g, DRIVER);
  let s = match.state();
  assert.equal(s.currentPlayerId, 'p1');
  assert.equal(g.state().canDrop, true);
  const where = { ...player(s, 'p1').ball };
  const ev = match.drop(g, 'p1');
  assert.deepEqual([ev.event, ev.drop, ev.playerId, ev.free, ev.strokes, ev.nextPlayerId], ['drop', true, 'p1', false, 2, 'p1'], 'no nearer the hole: still the farthest, still up');
  s = match.state();
  assert.deepEqual([player(s, 'p1').strokes, player(s, 'p1').stats.shots, player(s, 'p1').ball], [2, 1, ev.end], 'a stroke, not a swing');
  assert.ok(types(s).includes('drop'));
  assert.deepEqual(s.undoable, { playerId: 'p1', stray: false, holeNumber: 1, drop: true });
  assert.deepEqual(match.undoLastShot(g), { event: 'shot-undone', playerId: 'p1', stray: false, from: 'play', drop: true });
  s = match.state();
  assert.deepEqual([player(s, 'p1').strokes, player(s, 'p1').ball, s.currentPlayerId], [1, where, 'p1']);
  // taken again, the stroke is on the score that the hole is settled by: p1 makes 4 with it, the others 3
  match.drop(g, 'p1');
  const end = playHole(match, g);
  assert.deepEqual([end.ev.event, end.state.lastResult.scores.p1, end.state.lastResult.finish.p1], ['hole-tied', 3, 'picked-up'], 'lying 3 when a 3 went in: swept up, the drop\'s stroke counted');
  // no drops in a sudden death
  const b = start('elim', 2);
  toPlay(b.match, b.g);
  playHole(b.match, b.g);
  toPlay(b.match, b.g);
  assert.throws(() => b.match.drop(b.g), /No drops in a sudden death/);
});

test('the stray-ball guard and the ignored swings are the same for N', () => {
  const { match, g } = start('skins', 4);
  assert.equal(match.beforeShot(g), null, 'loading: ignored');
  let w;
  while ((w = match.waiting) && w.for === 'stage') { g.setCourse(COURSES[w.file]()); match.stageReady(g, w.token); }
  assert.equal(match.phase, 'intro');
  assert.equal(match.beforeShot(g), null, 'the intro: ignored');
  match.ready(g);
  const t = hit(match, g, L(20, 12, 2000));   // 20 mph off the tee: a ball that rolled off the mat
  assert.equal(t.ev.stray, true);
  assert.deepEqual(t.state.undoable, { playerId: 'p1', stray: true, holeNumber: 1 });
  assert.ok(types(t.state).includes('stray-shot'));
  match.undoLastShot(g);
  assert.deepEqual([match.state().currentPlayerId, player(match.state(), 'p1').strokes], ['p1', 0]);
});

test('rocket holes for N: every player\'s first stroke is the stage\'s ball, free; and in a sudden death every ball', () => {
  const tour = { stages: [stageEntry(1, { freeBall: 'rocket' }), stageEntry(2), stageEntry(3)], tiebreaks: [arenaEntry(1, { freeBall: 'sticky' })] };
  const { match, g } = start('elim', 3, {}, { tour });
  toPlay(match, g);
  match.arm('p2', 'magnet');
  const frees = [];
  for (let i = 0; i < 3; i++) { const t = hit(match, g, DRIVER); frees.push([t.who, t.shot.armed, t.shot.free]); }
  assert.deepEqual(frees, [['p1', 'rocket', true], ['p2', 'rocket', true], ['p3', 'rocket', true]]);
  let s = match.state();
  assert.deepEqual(s.players.map((p) => [p.charges, p.usedPowerups, p.armedPowerup]), [[3, [], null], [3, [], 'magnet'], [3, [], null]], 'nothing was charged; p2\'s own ball is still armed');
  const t = hit(match, g, I7);
  assert.equal(t.shot.free, false);
  while (match.phase === 'play') { const me = player(match.state(), match.currentPlayerId); hit(match, g, me.lie === 'green' ? IN : I7); }
  s = toPlay(match, g);
  assert.equal(s.phase, 'tiebreak');
  assert.equal(s.stage.freeBall, 'sticky');
  const sd = hit(match, g, I7);
  assert.deepEqual([sd.shot.armed, sd.shot.free], ['sticky', true]);
});

test('the wind and the putting option ride on a party as on a match', () => {
  const { match, g } = start('stroke', 3, { putting: 'off' });
  assert.equal(match.putting, 'off');
  let w;
  while ((w = match.waiting) && w.for === 'stage') { g.setCourse(COURSES[w.file]()); match.stageReady(g, w.token, { wind: { mph: 12, dirDeg: 90, label: '12 MPH' } }); }
  const s = match.state();
  assert.deepEqual([s.stage.wind.mph, s.options.putting], [12, 'off']);
  assert.equal(match.progress, 0);
});

test('leaving a party: the others play on; the last one left wins; a player who left is last', () => {
  const { match, g } = start('skins', 3);
  toPlay(match, g);
  hit(match, g, DRIVER);          // p1
  assert.equal(match.currentPlayerId, 'p2');
  // p2 leaves on their turn: p3 comes up, the game goes on with two
  let ev = match.concede('p2', g);
  assert.deepEqual([ev.event, ev.playerId], ['player-left', 'p2']);
  let s = match.state();
  assert.deepEqual([s.phase, s.currentPlayerId, player(s, 'p2').out, player(s, 'p2').left, player(s, 'p2').place, s.concededBy, s.undoable, s.canRestartHole], ['play', 'p3', true, true, 3, null, null, false]);
  assert.equal(g.player.id, 'p3', 'the game has the next player\'s ball');
  assert.ok(types(s).includes('player-left'));
  assert.throws(() => match.concede('p2', g), /already out/);
  const t = playHole(match, g, { p1: [I7, SHORT] });
  assert.equal(t.order.includes('p2'), false);
  assert.deepEqual([t.ev.event, t.ev.winnerId], ['hole-won', 'p3']);
  // p3 leaves too: p1 wins the game by concession
  ev = match.concede('p3', g);
  assert.deepEqual([ev.event, ev.winnerId, ev.reason], ['match-over', 'p1', 'concede']);
  s = match.state();
  assert.deepEqual([s.winnerId, s.reason, s.concededBy, s.placings], ['p1', 'concede', 'p3', ['p1', 'p3', 'p2']]);
  assert.throws(() => match.undoLastShot(g), /no shot to take back/i);
  // in an elimination, a player who leaves during the sudden death is the one who goes
  const e = start('elim', 3);
  toPlay(e.match, e.g);
  playHole(e.match, e.g);         // all make 3: sudden death between the three
  toPlay(e.match, e.g);
  assert.equal(e.match.phase, 'tiebreak');
  const out = e.match.concede('p2', e.g);
  assert.deepEqual([out.event, out.eliminatedId, out.reason], ['hole-won', 'p2', 'concede']);
  const es = e.match.state();
  assert.deepEqual([es.phase, es.lastResult.eliminatedId, es.standings], ['hole-result', 'p2', 'THE FINAL: Alex v Cara']);
});

// ---------- rewards ----------

test('rewards for N: the winner takes the trophies, coins and chest; the last place drops; in between only the record moves', () => {
  const r = partyRewardsFor({ format: partyFormatFor('skins', 6, 4), winStreak: 2, lastTrophies: 9, chest: ['rocket', 'sticky', 'magnet'], placings: ['a', 'b', 'c', 'd'] });
  assert.deepEqual(r, { winner: { trophies: 40, coins: 400, chest: ['rocket', 'sticky', 'magnet'], streakBonus: 10, pot: 0 }, loser: { trophies: -9 }, placings: ['a', 'b', 'c', 'd'] });
  const profiles = { a: { trophies: 95, wins: 3, losses: 1, streak: 2, bestStreak: 2, coins: 100 }, b: { trophies: 50, wins: 1, losses: 1, streak: 1, coins: 0 }, c: null, d: { trophies: 9, wins: 0, losses: 4, streak: 0, coins: 5 } };
  const next = applyPartyRewards(profiles, r);
  assert.deepEqual(next.a, { trophies: 135, rank: 'Amateur', wins: 4, losses: 1, streak: 3, bestStreak: 3, coins: 500 });
  assert.deepEqual(next.b, { trophies: 50, rank: 'Rookie', wins: 1, losses: 2, streak: 0, bestStreak: 1, coins: 0 });
  assert.deepEqual([next.c.losses, next.c.trophies, next.c.coins], [1, 0, 1000], 'a new profile: a loss, nothing else');
  assert.deepEqual(next.d, { trophies: 0, rank: 'Rookie', wins: 0, losses: 5, streak: 0, bestStreak: 0, coins: 5 });
  assert.deepEqual(profiles.a.trophies, 95, 'the profiles given are not touched');
  // a finished party carries them, with the awards
  const { match, g } = start('elim', 3, {}, { players: [{ ...PLAYERS[0], profile: { trophies: 200, streak: 1 } }, PLAYERS[1], { ...PLAYERS[2], profile: { trophies: 4 } }] });
  toPlay(match, g);
  playHole(match, g, { p3: [DRIVER, I7, SHORT, SHORT] });
  toPlay(match, g);
  const end = playHole(match, g, { p2: [DRIVER, I7, SHORT] });
  const s = end.state;
  assert.deepEqual([s.winnerId, s.loserId, s.placings], ['p1', 'p3', ['p1', 'p2', 'p3']]);
  assert.deepEqual([s.rewards.winner.trophies, s.rewards.winner.coins, s.rewards.winner.streakBonus, s.rewards.winner.chest.length, s.rewards.loser.trophies, s.rewards.placings], [25, 250, 5, 2, -4, ['p1', 'p2', 'p3']]);
  assert.ok(Array.isArray(s.awards));
  assert.match(s.log.at(-1).text, /ALEX WINS THE GAME! \+25 trophies, \+250 coins\./);
  assert.deepEqual(match.waiting.for, 'dismiss');
  // a rematch starts from the same players, format and holes
  assert.deepEqual(match.config().options.format, 'elim');
  const cfg = start('stroke', 4, { holes: 6 }).match.config();
  assert.deepEqual([cfg.options.format, cfg.options.holes, cfg.players.length], ['stroke', 6, 4]);
});

// ---------- handicaps ----------

test('help levels: three levers (charges, a forward tee, a putting level), bundled as levels 0 to 3', () => {
  assert.deepEqual(HELP_LEVELS.map((l) => [l.level, l.label, l.charges, l.tee, l.putting]), [[0, 'OFF', 0, 0, null], [1, 'HELP 1', 1, 0, 'easy'], [2, 'HELP 2', 1, 0.2, 'easy'], [3, 'HELP 3', 2, 0.35, 'easy']]);
  assert.deepEqual(normalizeHelp(undefined), { ...HELP_LEVELS[0] });
  assert.deepEqual(normalizeHelp(2), { ...HELP_LEVELS[2] });
  assert.deepEqual(normalizeHelp('3'), { ...HELP_LEVELS[3] });
  assert.deepEqual(normalizeHelp(9), { ...HELP_LEVELS[3] }, 'never more than the top level');
  assert.deepEqual(normalizeHelp({ level: 1 }), { ...HELP_LEVELS[1] });
  // the levers themselves
  assert.deepEqual(normalizeHelp({ charges: 7, tee: 0.9, putting: 'assist' }), { level: null, label: 'CUSTOM', charges: 3, tee: 0.5, putting: 'assist', text: 'ASSISTED PUTTING · +3 POWER-UPS · FORWARD TEE (50% CLOSER)' });
  assert.deepEqual(normalizeHelp({ tee: 0.05, putting: 'silly' }), { ...HELP_LEVELS[0] }, 'a tee under 10 % and an unknown putting level are no help');
  assert.equal(normalizeHelp({ charges: 1, tee: 0.2, putting: 'easy' }).level, 2, 'levers that are a level are named as it');
});

test('a forward tee is on mown ground on the hole\'s line, or there is none', () => {
  const hole = { tee: [0, 0], pin: [0, 400], line: [[0, 0], [0, 400]] };
  const fairway = () => 'fairway';
  const ft = forwardTee(hole, 0.2, fairway);
  assert.deepEqual([ft.x, Math.round(ft.y), ft.lie, ft.yd, ft.alongYd], [0, 80, 'fairway', 350, 87]);
  // the asked-for spot is in a lake from 60 to 130 m: the nearest mown ground on the line, before or beyond it
  const lake = (x, y) => (y > 60 && y < 130 ? 'water' : y < 20 ? 'tee' : 'fairway');
  const a = forwardTee(hole, 0.2, lake);
  assert.ok(a && (a.y <= 60 || a.y >= 130), `at ${a && a.y}`);
  assert.equal(lake(a.x, a.y), 'fairway');
  assert.ok(Math.abs(a.y - 80) <= 40 + 2, 'within half the asked-for distance of it');
  // rough is not mown; nothing mown in reach: no forward tee
  assert.equal(forwardTee(hole, 0.2, () => 'rough'), null);
  assert.equal(forwardTee(hole, 0.35, (x, y) => (y < 5 ? 'tee' : 'water')), null);
  // never within 60 yd of the pin: a short par 3 has none
  assert.equal(FORWARD_TEE_MIN_PIN_YD, 60);
  assert.equal(forwardTee({ tee: [0, 0], pin: [0, 50], line: [[0, 0], [0, 50]] }, 0.35, fairway), null);
  const near = forwardTee({ tee: [0, 0], pin: [0, 70], line: [[0, 0], [0, 70]] }, 0.35, fairway);   // 77 yd: only the first 16 are far enough from the pin
  assert.ok(near && near.yd >= 60 && near.alongYd <= 17, JSON.stringify(near));
  // along a dog-leg the distance is measured on the line
  const dog = forwardTee({ tee: [0, 0], pin: [200, 200], line: [[0, 0], [0, 200], [200, 200]] }, 0.5, fairway);
  assert.deepEqual([Math.round(dog.x), Math.round(dog.y)], [0, 200]);
  assert.equal(forwardTee(hole, 0, fairway), null);
  assert.equal(forwardTee(hole, 0.2, null), null);
});

test('a handicapped player: more charges, a forward tee on every hole, a putting level of their own; the others are untouched', () => {
  const players = [PLAYERS[0], { ...PLAYERS[1], help: 3 }, { ...PLAYERS[2], help: 1 }];
  const { match, g } = start('skins', 3, {}, { players });
  let s = match.state();
  assert.deepEqual(s.players.map((p) => p.charges), [3, 5, 4]);
  assert.equal('help' in s.players[0], false);
  assert.deepEqual(s.players[1].help, { ...HELP_LEVELS[3] });
  s = toPlay(match, g);
  // the forward tee: 35 % of the 400 m line, on the fairway
  const p2 = player(s, 'p2');
  assert.deepEqual([p2.ball, p2.lie, p2.teeYd, p2.strokes], [{ x: 0, y: 140 }, 'fairway', 284, 0]);
  assert.deepEqual([player(s, 'p1').ball, player(s, 'p1').lie], [{ x: 0, y: 0 }, 'tee']);
  assert.deepEqual([player(s, 'p3').ball, player(s, 'p3').teeYd], [{ x: 0, y: 0 }, null], 'help 1 has no forward tee');
  assert.equal(p2.distToPinYd, 284.3);
  // the tee is still played in honour order, and the forward tee's first stroke is a first stroke
  const a = hit(match, g, DRIVER);
  assert.deepEqual([a.who, 'putting' in a.shot], ['p1', false]);
  const b = hit(match, g, I7);
  assert.deepEqual([b.who, b.shot.putting], ['p2', 'easy']);
  assert.deepEqual([g.shotLog.at(-1) != null, player(b.state, 'p2').strokes], [true, 1]);
  const c = hit(match, g, DRIVER);
  assert.deepEqual([c.who, c.shot.putting], ['p3', 'easy']);
  // restart the hole: back on the forward tee
  match.restartHole(g);
  assert.deepEqual(player(match.state(), 'p2').ball, { x: 0, y: 140 });
  // the next hole: there again
  playHole(match, g, { p2: [I7, IN] });
  s = toPlay(match, g);
  assert.deepEqual(player(s, 'p2').ball, { x: 0, y: 140 });
  // a sudden death is played from the same spot by everybody
  // a rematch keeps the help
  assert.deepEqual(match.config().players.map((p) => p.help), [undefined, 3, 1]);
  // unlimited power-ups: help adds no charges (there are none)
  assert.deepEqual(start('skins', 2, { powerups: 'unlimited' }, { players: [PLAYERS[0], { ...PLAYERS[1], help: 3 }] }).match.state().players.map((p) => p.charges), [null, null]);
});

test('handicaps in a head-to-head: the same levers, and the state only grows for the player who has help', () => {
  const g = newGame();
  const match = createMatch({ game: g, players: [PLAYERS[0], { ...PLAYERS[1], help: 2 }], tour: TOUR, random: rng(0.1), options: { format: 'bo3', stage: 's1', catalogue: CATALOGUE } });
  let s = toPlay(match, g);
  assert.deepEqual(s.players.map((p) => p.charges), [3, 4]);
  assert.equal('help' in s.players[0], false);
  assert.equal('party' in s, false);
  assert.deepEqual([player(s, 'p2').help.level, player(s, 'p2').teeYd, player(s, 'p2').ball], [2, 350, { x: 0, y: 80 }]);
  const first = hit(match, g, DRIVER);
  assert.deepEqual([first.who, first.shot.putting], ['p1', undefined]);
  const second = hit(match, g, DRIVER);
  assert.deepEqual([second.who, second.shot.putting], ['p2', 'easy']);
});

test('a help level is suggested from the profiles, never set', () => {
  const profiles = {
    ace: { trophies: 700, wins: 30, losses: 10 },        // Expert
    mid: { trophies: 320, wins: 9, losses: 9 },          // Pro
    low: { trophies: 20, wins: 1, losses: 6 },           // Rookie
    fresh: null,                                         // never played
  };
  assert.deepEqual(suggestHelp(profiles), { ace: 0, mid: 1, low: 3, fresh: 3 });
  assert.deepEqual(suggestHelp({ a: { trophies: 20, wins: 9, losses: 9 }, b: null }), { a: 0, b: 1 }, 'the same rank, but one has hardly played against one who has');
  assert.deepEqual(suggestHelp({ a: null, b: null }), { a: 0, b: 0 }, 'two new players: level');
  assert.deepEqual(suggestHelp(null), {});
  // a suggestion changes nothing in a game: only what the lobby sends does
  const s = start('skins', 2).match.state();
  assert.deepEqual(s.players.map((p) => p.charges), [3, 3]);
});

test('a sudden death that never has to be played: one of the two who tied leaves, the other takes what was at stake', () => {
  const { match, g } = start('skins', 3);
  toPlay(match, g); playHole(match, g);          // all tie: carry 1
  toPlay(match, g); playHole(match, g);          // all tie: carry 2
  toPlay(match, g);
  const t = playHole(match, g, { p3: [DRIVER, I7, SHORT] });   // the last hole: p1 and p2 tie for three skins
  assert.deepEqual([t.state.phase, t.ev.next, [...t.ev.playerIds].sort()], ['hole-result', 'tiebreak', ['p1', 'p2']]);
  const ev = match.concede('p2', g);
  assert.deepEqual([ev.event, ev.winnerId, ev.reason], ['match-over', 'p1', 'holes']);
  const s = match.state();
  assert.deepEqual([s.phase, s.winnerId, s.players.map((p) => p.holesWon), s.placings], ['done', 'p1', [3, 0, 0], ['p1', 'p3', 'p2']]);
  assert.deepEqual([s.lastResult.winnerId, s.lastResult.reason, s.lastResult.tiebreak.rounds], ['p1', 'concede', []], 'nothing was hit: no round on the record');
});
