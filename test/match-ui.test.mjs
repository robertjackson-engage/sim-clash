// Match v2 UI (public/arcade/match.js): the pure helpers the screens are built from.
// What a swing is for, which intro a state calls for, what the result screen says, the
// duel board, the FLAWLESS / COMEBACK tags, and events played once by seq.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreName, toGoText, ftText, shout, rankText, slotOf, bySlot, playerColor, SLOT_COLORS, THEMES, themeOf, silhouette,
  FORMATS, formatOf, introStage, introHoleNumber, introKey, shotNeed, duelView, holeResultView, seriesTags, unseenEvents, ballInfo,
  ballWord, stageRoutes,
} from '../public/arcade/match.js';

const A = 'p_a', B = 'p_b';
const player = (id, name, slot, over = {}) => ({
  id, name, slot, strokes: 0, lie: 'tee', holed: false, distToPinYd: 150, holesWon: 0, holeScores: [], mustHole: false, tiebreakFt: null, ...over,
});
const match = (over = {}) => ({
  id: 'm1', seq: 1, format: 'bo3', target: 2, maxHoles: 3, phase: 'play', currentPlayerId: A, holeNumber: 1,
  stage: { id: 'lagoon-island', name: 'Lagoon Island', par: 3, lengthYd: 150, theme: 'tropical', kind: 'match' }, nextStage: null,
  players: [player(A, 'Alex', 1), player(B, 'Dave', 2)],
  holeResults: [], lastResult: null, tiebreak: null, matchPoint: null, winnerId: null, events: [], ...over,
});

test('scores, distances and names read the way they are shouted', () => {
  assert.equal(scoreName(1, 3), 'ACE');
  assert.equal(scoreName(2, 5), 'ALBATROSS');
  assert.equal(scoreName(3, 5), 'EAGLE');
  assert.equal(scoreName(2, 3), 'BIRDIE');
  assert.equal(scoreName(4, 4), 'PAR');
  assert.equal(scoreName(5, 4), 'BOGEY');
  assert.equal(scoreName(6, 4), 'DOUBLE BOGEY');
  assert.equal(scoreName(8, 4), '4 OVER');
  assert.equal(scoreName(null, 4), '');
  assert.equal(toGoText(164.4), '164 YD');
  assert.equal(toGoText(8), '24 FT');           // inside 30 yd it is feet
  assert.equal(toGoText(null), '–');
  assert.equal(ftText(0.5), '6 IN');
  assert.equal(ftText(6.84), '6.8 FT');
  assert.equal(ftText(14.2), '14.2 FT');        // a duel is decided by tenths
  assert.equal(ftText(132.4), '132 FT');
  assert.equal(shout('Alex'), 'ALEX');
  assert.equal(shout('Player 1'), 'PLAYER 1');
  assert.equal(shout('Alexandra Montgomery'), 'ALEXANDRA');   // long: the first name
  assert.equal(rankText('Gold'), 'GOLD');
  assert.equal(rankText(3), 'RANK 3');
  assert.equal(rankText({ label: 'Legend' }), 'LEGEND');
  assert.equal(rankText(null), '');
});

test('player one is always the orange-red, player two the blue, whatever the order', () => {
  const m = match({ players: [player(B, 'Dave', 2), player(A, 'Alex', 1)] });
  assert.equal(slotOf(m, A), 1);
  assert.equal(slotOf(m, B), 2);
  assert.deepEqual(bySlot(m).map((p) => p.id), [A, B]);
  assert.equal(playerColor(1), SLOT_COLORS[1]);
  assert.equal(playerColor(2), SLOT_COLORS[2]);
  assert.notEqual(SLOT_COLORS[1], SLOT_COLORS[2]);
  assert.deepEqual(SLOT_COLORS, { 1: '#ff5a36', 2: '#2e9bff' });   // exactly the ball dock's two colours (arcade HUD)
  const noSlots = match({ players: [player(A, 'Alex', undefined), player(B, 'Dave', undefined)] });
  assert.equal(slotOf(noSlots, B), 2);   // no slot in the state: the order of the players
});

test('every contract theme has stage colours and a silhouette; unknown themes fall back', () => {
  for (const t of ['tropical', 'canyon', 'links', 'volcano', 'alpine', 'sakura', 'jungle', 'desert', 'neon', 'stadium']) {
    assert.ok(THEMES[t] && THEMES[t].a && THEMES[t].b && THEMES[t].glow, t);
    assert.match(silhouette(t), /<svg class="mt-sil"[^>]*>.*<path/);
  }
  assert.equal(themeOf({ theme: 'nope' }), THEMES.current);
  assert.equal(themeOf(null), THEMES.current);
  assert.match(silhouette('nope'), /<svg/);
  assert.deepEqual(FORMATS.map((f) => [f.id, f.target, f.holes]), [['quick', 1, 1], ['bo3', 2, 3], ['bo9', 5, 9]]);
  assert.equal(formatOf('bo9').label, 'TOURNAMENT');
  assert.equal(formatOf('??').id, 'quick');
});

test('the intro is about the stage being loaded, and is keyed once per stage visit', () => {
  const canyon = { id: 'canyon-run', name: 'Canyon Run', par: 4, kind: 'match' };
  const arena = { id: 'bullseye-bay', name: 'Bullseye Bay', par: 3, kind: 'tiebreak' };
  // hole 1 loading: the engine has the stage in nextStage and no stage yet
  const first = match({ phase: 'loading', stage: null, nextStage: canyon });
  assert.equal(introStage(first).id, 'canyon-run');
  assert.equal(introHoleNumber(first), 1);
  // the same visit once loaded: the same key (no second intro)
  const loaded = match({ phase: 'intro', stage: canyon, nextStage: null });
  assert.equal(introKey(first), introKey(loaded));
  // hole 2 loading: holeNumber may still be 1, the results say one hole is played
  const res1 = { holeNumber: 1, winnerId: A, reason: 'score', scores: { [A]: 3, [B]: 4 } };
  const second = match({ phase: 'loading', holeNumber: 1, nextStage: canyon, holeResults: [res1] });
  assert.equal(introHoleNumber(second), 2);
  assert.notEqual(introKey(second), introKey(first));
  // a tied hole: the arena's intro is its own, and the hole number stays
  const tied = { holeNumber: 1, winnerId: null, reason: 'tied', scores: { [A]: 3, [B]: 3 } };
  const sd = match({ phase: 'loading', holeNumber: 1, nextStage: arena, holeResults: [tied] });
  assert.equal(introStage(sd).kind, 'tiebreak');
  assert.equal(introHoleNumber(sd), 1);
  assert.notEqual(introKey(sd), introKey(match({ phase: 'loading', nextStage: canyon, holeResults: [tied] })));
  assert.equal(introStage(null), null);
});

test('the turn banner says what the swing is for', () => {
  const need = (m, id = A) => shotNeed(m, m.players.find((p) => p.id === id));
  assert.deepEqual(need(match()), { text: 'TEE SHOT · 150 YD · PAR 3', tone: 'info' });
  assert.equal(need(match({ players: [player(A, 'Alex', 1, { strokes: 1, lie: 'fairway', distToPinYd: 84 }), player(B, 'Dave', 2)] })).text, 'SHOT 2 · 84 YD TO THE PIN');
  // on the green: the score the putt is for
  assert.deepEqual(need(match({ players: [player(A, 'Alex', 1, { strokes: 1, lie: 'green', distToPinYd: 3 }), player(B, 'Dave', 2)] })), { text: 'FOR BIRDIE', tone: 'score' });
  assert.equal(need(match({ players: [player(A, 'Alex', 1, { strokes: 2, lie: 'fringe', distToPinYd: 12 }), player(B, 'Dave', 2)] })).text, 'FOR PAR');
  // the opponent is in: a putt to win, or the one swing to stay alive
  const oppIn = (mine) => match({ players: [player(A, 'Alex', 1, mine), player(B, 'Dave', 2, { strokes: 4, holed: true, distToPinYd: 0 })] });
  assert.deepEqual(need(oppIn({ strokes: 2, lie: 'green', distToPinYd: 2 })), { text: 'TO WIN THE HOLE', tone: 'win' });
  assert.deepEqual(need(oppIn({ strokes: 3, lie: 'green', distToPinYd: 2, mustHole: true })), { text: 'MUST MAKE THIS', tone: 'must' });
  assert.deepEqual(need(oppIn({ strokes: 3, lie: 'fairway', distToPinYd: 60 })), { text: 'TO TIE', tone: 'must' });
});

test('a rocket hole: the tee shot is a free ball, already loaded; its routes are three chips', () => {
  const rocket = { id: 'temple-run', name: 'Temple Run', par: 5, lengthYd: 512, theme: 'jungle', kind: 'match', freeBall: 'rocket' };
  const m = match({ stage: rocket });
  assert.deepEqual(shotNeed(m, m.players[0]), { text: 'ROCKET LOADED · 512 YD', tone: 'rocket' });
  // only the tee shot is free: the second stroke is an ordinary one
  const second = match({ stage: rocket, players: [player(A, 'Alex', 1, { strokes: 1, lie: 'fairway', distToPinYd: 120 }), player(B, 'Dave', 2)] });
  assert.equal(shotNeed(second, second.players[0]).tone, 'info');
  assert.equal(ballWord('tiny-cup'), 'TINY CUP');
  assert.equal(ballWord(null), '');
  // routes: SAFE, RISKY, ROCKET in that order whatever the file's, one of each, nameless ones dropped
  const routes = stageRoutes({ routes: [{ id: 'rocket', name: 'Onto the wall' }, { id: 'safe', name: 'Round the moat', note: 'wide' }, { id: 'risky', name: '' }, { id: 'safe', name: 'A second safe one' }, { id: 'weird', name: 'x' }] });
  assert.deepEqual(routes, [{ id: 'safe', label: 'SAFE', name: 'Round the moat' }, { id: 'rocket', label: 'ROCKET', name: 'Onto the wall' }]);
  assert.deepEqual(stageRoutes({ routes: null }), []);
  assert.deepEqual(stageRoutes(null), []);
});

test('fogged: the banner gives no yardage away', () => {
  const fog = (over, stage) => { const m = match({ ...(stage ? { stage } : {}), players: [player(A, 'Alex', 1, { cursedWith: 'fog', ...over }), player(B, 'Dave', 2)] }); return shotNeed(m, m.players[0]).text; };
  assert.equal(fog({}), 'TEE SHOT · ??? · PAR 3');
  assert.equal(fog({ strokes: 1, lie: 'fairway', distToPinYd: 176 }), 'SHOT 2 · ??? TO THE PIN');
  assert.equal(fog({}, { id: 'x', name: 'X', par: 5, lengthYd: 512, kind: 'match', freeBall: 'rocket' }), 'ROCKET LOADED · ???');
  assert.equal(fog({ strokes: 1, lie: 'green', distToPinYd: 3 }), 'FOR BIRDIE');   // what the putt is for is not a yardage
  // the other player's fog is not this player's
  const m = match({ players: [player(A, 'Alex', 1), player(B, 'Dave', 2, { cursedWith: 'fog' })] });
  assert.equal(shotNeed(m, m.players[0]).text, 'TEE SHOT · 150 YD · PAR 3');
});

test('in sudden death the banner names the number to beat', () => {
  const tb = (results) => match({ phase: 'tiebreak', tiebreak: { arenaId: 'x', round: 2, pending: [A], results } });
  const need = (m) => shotNeed(m, m.players[0]);
  assert.deepEqual(need(tb([])), { text: 'CLOSEST TO THE PIN', tone: 'info' });
  assert.deepEqual(need(tb([{ round: 2, playerId: B, ft: 14.2, miss: null, holed: false }])), { text: 'BEAT 14.2 FT', tone: 'win' });
  assert.equal(need(tb([{ round: 2, playerId: B, ft: null, miss: 'water', holed: false }])).text, 'DAVE MISSED: JUST FIND LAND');
  assert.equal(need(tb([{ round: 2, playerId: B, ft: 0, miss: null, holed: true }])).tone, 'must');
  // a ball of an earlier round is not the one to beat
  assert.equal(need(tb([{ round: 1, playerId: B, ft: 3, miss: null, holed: false }])).text, 'CLOSEST TO THE PIN');
});

test('the duel board shows this round: feet, a miss, a holed ball, or still to hit', () => {
  const live = match({
    phase: 'tiebreak',
    tiebreak: { arenaId: 'bullseye-bay', round: 2, pending: [A], results: [
      { round: 1, playerId: A, ft: null, miss: 'water', holed: false }, { round: 1, playerId: B, ft: null, miss: 'ob', holed: false },
      { round: 2, playerId: B, ft: 14.2, miss: null, holed: false },
    ] },
  });
  const v = duelView(live);
  assert.equal(v.round, 2);
  assert.deepEqual(v.cells[A], { state: 'wait' });
  assert.deepEqual(v.cells[B], { state: 'ft', ft: 14.2 });
  assert.equal(v.arenaId, 'bullseye-bay');
  const r1 = duelView({ ...live, tiebreak: { ...live.tiebreak, round: 1 } });
  assert.deepEqual(r1.cells[A], { state: 'miss', miss: 'water' });
  assert.deepEqual(r1.cells[B], { state: 'miss', miss: 'ob' });
  // decided, and the live tiebreak is gone: the hole's own record is read instead
  const done = match({ phase: 'hole-result', lastResult: { holeNumber: 1, winnerId: A, reason: 'tiebreak', scores: {}, tiebreak: { arenaId: 'x', rounds: [{ [A]: null, [B]: null }, { [A]: 0, [B]: 9.5 }] } } });
  const d = duelView(done);
  assert.equal(d.round, 2);
  assert.deepEqual(d.cells[A], { state: 'in', ft: 0 });
  assert.deepEqual(d.cells[B], { state: 'ft', ft: 9.5 });
});

test('the hole result: knockout, a win on the card, a tie, a tiebreak, a halve', () => {
  const base = (r, pl) => match({ phase: 'hole-result', players: pl || [player(A, 'Alex', 1, { holeScores: [3] }), player(B, 'Dave', 2, { holeScores: [4] })], holeResults: [r], lastResult: r });
  const score = holeResultView(base({ holeNumber: 1, stageName: 'Lagoon Island', par: 4, winnerId: A, reason: 'score', scores: { [A]: 3, [B]: 4 } }));
  assert.equal(score.kind, 'win');
  assert.equal(score.title, 'ALEX');
  assert.equal(score.sub, 'WINS THE HOLE');
  assert.equal(score.how, 'BIRDIE BEATS PAR');
  assert.deepEqual(score.rows.map((x) => [x.p.id, x.big, x.label, x.out]), [[A, '3', 'BIRDIE', false], [B, '4', 'PAR', false]]);

  const koPlayers = [player(A, 'Alex', 1, { holeScores: [3] }), player(B, 'Dave', 2, { holeScores: [null] })];
  const ko = holeResultView(base({ holeNumber: 1, par: 4, winnerId: A, reason: 'knockout', scores: { [A]: 3, [B]: 4 } }, koPlayers));
  assert.equal(ko.kind, 'knockout');
  assert.equal(ko.title, 'KNOCKOUT!');
  assert.equal(ko.sub, 'ALEX WINS THE HOLE');
  assert.match(ko.how, /^IN FOR BIRDIE\. DAVE CAN'T CATCH IT\.$/);
  assert.deepEqual(ko.rows[1].label, 'OUT');
  assert.equal(ko.rows[1].out, true);
  const cap = holeResultView(base({ holeNumber: 1, par: 4, winnerId: A, reason: 'cap', scores: { [A]: 5, [B]: 7 } }, koPlayers));
  assert.equal(cap.kind, 'knockout');
  assert.equal(cap.how, 'DAVE HIT THE STROKE LIMIT');
  assert.equal(cap.rows[1].label, 'STROKE LIMIT');

  const tiedPlayers = [player(A, 'Alex', 1, { holeScores: [3] }), player(B, 'Dave', 2, { holeScores: [3] })];
  const tied = holeResultView(base({ holeNumber: 1, par: 3, winnerId: null, reason: 'tied', scores: { [A]: 3, [B]: 3 } }, tiedPlayers));
  assert.equal(tied.kind, 'tied');
  assert.equal(tied.title, 'ALL SQUARE!');
  assert.equal(tied.how, 'BOTH MAKE PAR');
  assert.equal(tied.winner, null);
  const halved = holeResultView(base({ holeNumber: 1, par: 3, winnerId: null, reason: 'halved', scores: { [A]: 3, [B]: 3 } }, tiedPlayers));
  assert.equal(halved.kind, 'halved');
  assert.equal(halved.title, 'HOLE HALVED');

  const tb = holeResultView(base({ holeNumber: 1, par: 3, winnerId: B, reason: 'tiebreak', scores: { [A]: 3, [B]: 3 }, tiebreak: { arenaId: 'x', rounds: [{ [A]: 22.6, [B]: 14.2 }] } }, tiedPlayers));
  assert.equal(tb.kind, 'win');
  assert.equal(tb.title, 'DAVE');
  assert.equal(tb.how, 'CLOSEST TO THE PIN: 14.2 FT BEATS 22.6 FT');
  assert.deepEqual(tb.rows.map((x) => x.big), ['22.6 FT', '14.2 FT']);
  const tbMiss = holeResultView(base({ holeNumber: 1, par: 3, winnerId: B, reason: 'tiebreak', scores: {}, tiebreak: { arenaId: 'x', rounds: [{ [A]: null, [B]: 30 }] } }, tiedPlayers));
  assert.equal(tbMiss.how, '30.0 FT TO THE PIN. ALEX MISSED.');
  assert.equal(tbMiss.rows[0].big, 'MISS');

  const hazard = holeResultView(base({ holeNumber: 1, par: 4, winnerId: B, reason: 'hazard', scores: { [A]: 2, [B]: 1 } }, [player(A, 'Alex', 1, { holeScores: [null] }), player(B, 'Dave', 2, { holeScores: [null] })]));
  assert.equal(hazard.how, 'ALEX FOUND THE HAZARD');
  assert.equal(holeResultView(match()), null);   // nothing to show
});

test('FLAWLESS and COMEBACK come from the scoreline, never from a concession', () => {
  const done = (results, a, b, over = {}) => match({
    phase: 'done', winnerId: A, reason: 'holes', holeResults: results.map((w, i) => ({ holeNumber: i + 1, winnerId: w, reason: 'score', scores: {} })),
    players: [player(A, 'Alex', 1, { holesWon: a }), player(B, 'Dave', 2, { holesWon: b })], ...over,
  });
  assert.deepEqual(seriesTags(done([A, A], 2, 0)).map((t) => t.id), ['flawless']);
  assert.deepEqual(seriesTags(done([B, A, A], 2, 1)).map((t) => t.id), ['comeback']);
  assert.deepEqual(seriesTags(done([A, B, A], 2, 1)), []);                       // never behind
  assert.deepEqual(seriesTags(done([A], 1, 0, { target: 1, format: 'quick' })), []);   // one hole is not a series
  assert.deepEqual(seriesTags(done([A, A], 2, 0, { reason: 'concede' })), []);
  // a tournament comeback needs a real hole: two down at some point
  const bo9 = (results) => done(results, 5, results.filter((w) => w === B).length, { target: 5, format: 'bo9' });
  assert.deepEqual(seriesTags(bo9([B, A, A, A, A, A])), []);
  assert.deepEqual(seriesTags(bo9([B, B, A, A, A, A, A])).map((t) => t.id), ['comeback']);
  assert.equal(seriesTags(done([A, A], 2, 0))[0].voice, 'm-flawless');
  assert.deepEqual(seriesTags(match()), []);
});

test('events are played once, in order, by seq', () => {
  const m = match({ events: [{ seq: 7, type: 'turn' }, { seq: 5, type: 'coin-flip' }, { seq: 6, type: 'stage-loaded' }, { type: 'no-seq' }] });
  assert.deepEqual(unseenEvents(m, -1).map((e) => e.seq), [5, 6, 7]);
  assert.deepEqual(unseenEvents(m, 6).map((e) => e.type), ['turn']);
  assert.deepEqual(unseenEvents(m, 7), []);
  assert.deepEqual(unseenEvents(null, 0), []);
  assert.deepEqual(unseenEvents({ events: null }, 0), []);
});

test('the chest names balls from the catalogue and still shows one it has never heard of', () => {
  const cat = [{ id: 'fireball', name: 'Fireball', emoji: '🔥', rarity: 'epic', kind: 'ball', color: '#ff3d14' }, { id: 'gust', name: 'Gust', rarity: 'rare', kind: 'trick' }];
  assert.deepEqual(ballInfo('fireball', cat), { id: 'fireball', name: 'Fireball', emoji: '🔥', rarity: 'epic', kind: 'ball', color: '#ff3d14' });
  assert.equal(ballInfo('gust', cat).kind, 'trick');
  assert.equal(ballInfo('rocket', [{ id: 'rocket', name: 'Rocket', color: 16734751 }]).color, '#ff5a1f');   // lib/arcade.js gives the trail colour as a number
  assert.equal(ballInfo('x', [{ id: 'x', color: 0x00ff00 }]).color, '#00ff00');
  assert.match(ballInfo('gust', cat).color, /^#/);          // no colour in the catalogue: the rarity's
  const unknown = ballInfo('tiny-cup', null);
  assert.equal(unknown.name, 'Tiny Cup');
  assert.equal(unknown.rarity, 'common');
  assert.match(unknown.color, /^#/);
});

test('the module loads without a DOM (its helpers are importable by node tooling)', async () => {
  const mod = await import('../public/arcade/match.js');
  assert.equal(typeof mod.MatchUI, 'function');
  assert.equal(mod.default, mod.MatchUI);
});
