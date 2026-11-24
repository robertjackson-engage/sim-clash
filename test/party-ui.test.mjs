// PARTY in the HUD (public/arcade/party.js): the pure helpers the screens are built from.
// What a swing is for in a party's words, the figure and the status on a player's card, the
// standings, what a hole's result screen says for each format, the menu's items, who a
// trick goes to, the four player colours and marks. (The screens themselves are looked at
// in a headless browser: docs/modes.md "Looking at it".)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PartyUI, isParty, PARTY_CARDS, partyCard, HELP_FALLBACK, alivePlayers, partyFigure, partyStatus, partyStakeView, partyNeed,
  partyRanking, partyLine, partyResultView, partyMenuItems, defaultTarget,
} from '../public/arcade/party.js';
import { MatchUI, kit, stakeView } from '../public/arcade/match.js';
import { PLAYER_COLORS, PLAYER_MARKS, PLAYER_COLOR_NAMES, slotColor, slotMark, mainItems, MAIN_ITEMS, startScreen } from '../public/arcade/shell-core.js';

const P = (id, name, slot, extra = {}) => ({ id, name, slot, strokes: 0, lie: 'tee', holed: false, capped: false, pickedUp: false, out: false, left: false, distToPinYd: 150, holesWon: 0, total: 0, mustHole: false, shotFor: null, shotKind: null, cursedWith: null, charges: 3, stats: { points: 0 }, ...extra });
const game = (party, players, extra = {}) => ({ id: 'm1', party, phase: 'play', players, holeNumber: 1, maxHoles: 3, holesPlayed: 0, holeResults: [], stage: { par: 4, lengthYd: 400, name: 'Stage' }, teeOrder: players.map((p) => p.id), skinsAtStake: 1, carry: 0, standings: 'ALL SQUARE', options: { powerups: 'loadout' }, currentPlayerId: players[0].id, ...extra });

test('four player colours and marks: two kept, two added, never colour alone', () => {
  assert.deepEqual(PLAYER_COLORS.slice(0, 2), ['#ff5a36', '#2e9bff'], 'the two the game has always had');
  assert.equal(new Set(PLAYER_COLORS).size, 4);
  assert.equal(new Set(PLAYER_MARKS).size, 4);
  assert.equal(PLAYER_COLOR_NAMES.length, 4);
  assert.deepEqual([1, 2, 3, 4].map(slotColor), [...PLAYER_COLORS]);
  assert.deepEqual([1, 2, 3, 4].map(slotMark), [...PLAYER_MARKS]);
  assert.equal(slotColor(9), PLAYER_COLORS[0]);
  // the two new ones are far from the old two, from each other and from the gold of a win (plain RGB distance here;
  // the choice was made on simulated colour-blind distances, shell-core.js)
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const d = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
  for (const c of PLAYER_COLORS.slice(2)) for (const o of [...PLAYER_COLORS.filter((x) => x !== c), '#ffd21f']) assert.ok(d(c, o) > 100, `${c} against ${o}`);
});

test('the party UI is the match UI: a subclass, built from the same pieces', () => {
  assert.equal(Object.getPrototypeOf(PartyUI), MatchUI);
  for (const k of ['esc', 'big', 'profileChip', 'windChip', 'windBadge', 'themeStyle', 'stageFacts', 'voiceName']) assert.equal(typeof kit[k], 'function', k);
  assert.equal(isParty({ party: 'skins' }), true);
  assert.equal(isParty({ format: 'bo3' }), false);
  assert.equal(isParty(null), false);
  assert.deepEqual(PARTY_CARDS.map((c) => c.id), ['skins', 'stroke', 'elim']);
  assert.equal(partyCard('nope').id, 'skins');
  assert.deepEqual(HELP_FALLBACK.map((l) => l.level), [0, 1, 2, 3]);
  // the menu: PARTY and the other modes only when they are in the build; ?party=1 opens the lobby screen
  assert.ok(MAIN_ITEMS.find((x) => x.id === 'party' && x.to === 'versus' && x.game));
  assert.equal(mainItems().some((x) => x.id === 'party'), false);
  assert.equal(mainItems({ modes: ['party'] })[1].id, 'party');
  assert.equal(startScreen(new URLSearchParams('party=1')), 'versus');
});

test('the card: the figure and the status of each player, by format', () => {
  const a = P('a', 'Alex', 1, { holesWon: 2, total: 9 }), b = P('b', 'Sam', 2, { holesWon: 1, total: 11, holed: true, strokes: 3 });
  const c = P('c', 'Jo', 3, { pickedUp: true, total: 14 }), d = P('d', 'Riley', 4, { out: true, outOnHole: 1, place: 4 });
  const skins = game('skins', [a, b, c, d]);
  assert.deepEqual([a, b].map((p) => partyFigure(skins, p)), [{ big: '2', label: 'SKINS' }, { big: '1', label: 'SKIN' }]);
  const race = game('stroke', [a, b, c, d], { holeResults: [{ par: 4 }, { par: 4 }] });
  assert.deepEqual([a, b, c].map((p) => partyFigure(race, p).big), ['+1', '+3', '+6']);
  assert.equal(partyFigure(race, a).label, '9 STROKES');
  assert.equal(partyFigure(game('stroke', [a, b]), a).big, 'E', 'before a hole is in the book');
  const elim = game('elim', [a, b, c, d]);
  assert.deepEqual([a, d].map((p) => partyFigure(elim, p)), [{ big: 'IN', label: 'STILL ALIVE' }, { big: 'OUT', label: 'ON HOLE 1' }]);
  assert.deepEqual([a, b, c, d].map((p) => partyStatus(skins, p)), [null, { text: 'IN FOR 3', tone: 'in' }, { text: 'PICKED UP', tone: 'out' }, { text: 'OUT', tone: 'out' }]);
  assert.equal(partyStatus(skins, P('e', 'E', 1, { capped: true })).text, 'STROKE LIMIT');
  assert.equal(partyStatus(skins, P('e', 'E', 1, { out: true, left: true })).text, 'LEFT');
  assert.equal(partyStatus({ ...skins, phase: 'tiebreak' }, b), null, 'a sudden death has its own cells');
  assert.deepEqual(alivePlayers(elim).map((p) => p.id), ['a', 'b', 'c']);
});

test('what a swing is for, in a party\'s words', () => {
  const up = (extra) => P('a', 'Alex', 1, { lie: 'green', strokes: 2, distToPinYd: 4, ...extra });
  const inn = P('b', 'Sam', 2, { holed: true, strokes: 3 });
  const out = P('c', 'Jordan', 3, { strokes: 3, lie: 'green' });
  // skins
  let m = game('skins', [up({ shotFor: 'tie', shotKind: 'putt', mustHole: true }), inn, out]);
  assert.deepEqual(partyStakeView(m, m.players[0]), { for: 'tie', kind: 'putt', text: 'PUTT IN TO STAY ALIVE', voice: 'p-to-stay-alive' });
  m = game('skins', [up({ shotFor: 'win', shotKind: 'putt' }), out, P('d', 'Riley', 4, { strokes: 3, lie: 'green' })]);
  assert.equal(partyStakeView(m, m.players[0]).text, 'PUTT IN TO WIN THE HOLE');
  m = game('skins', [up({ shotFor: 'win', shotKind: 'chip', lie: 'fairway' }), out], { skinsAtStake: 3 });
  assert.deepEqual([partyStakeView(m, m.players[0]).text, partyStakeView(m, m.players[0]).voice], ['CHIP IN FOR 3 SKINS', 'p-for-the-skins']);
  // a full shot that would merely sweep players who are still out is not shouted; against a score that is in, it is
  m = game('skins', [up({ shotFor: 'win', shotKind: 'shot', lie: 'fairway', distToPinYd: 150 }), out]);
  assert.equal(partyStakeView(m, m.players[0]), null);
  m = game('skins', [up({ shotFor: 'tie', shotKind: 'shot', lie: 'fairway', distToPinYd: 150 }), inn]);
  assert.equal(partyStakeView(m, m.players[0]).text, 'HOLE IT TO STAY ALIVE');
  // elimination
  m = game('elim', [up({ shotFor: 'tie', shotKind: 'putt', mustHole: true }), inn, P('d', 'Riley', 4, { holed: true, strokes: 3 })]);
  assert.equal(partyStakeView(m, m.players[0]).text, 'PUTT IN TO STAY ALIVE');
  m = game('elim', [up({ shotFor: 'win', shotKind: 'putt' }), inn, out]);
  assert.equal(partyStakeView(m, m.players[0]).text, 'PUTT IN TO KNOCK OUT JORDAN');
  m = game('elim', [up({ shotFor: 'win', shotKind: 'putt' }), inn, P('d', 'Riley', 4, { out: true })]);
  assert.equal(partyStakeView(m, m.players[0]).text, 'PUTT IN TO WIN THE GAME', 'the final two');
  // a stroke race
  m = game('stroke', [up({ shotFor: 'win', shotKind: 'putt' }), inn]);
  assert.equal(partyStakeView(m, m.players[0]).text, 'PUTT IN TO WIN THE RACE');
  m = game('stroke', [up({ shotFor: 'tie', shotKind: 'putt' }), inn]);
  assert.deepEqual([partyStakeView(m, m.players[0]).text, partyStakeView(m, m.players[0]).voice], ['PUTT IN TO TIE THE RACE', 'm-to-tie']);
  // nothing for 'lead', nothing outside play, and a head-to-head keeps its own words
  assert.equal(partyStakeView(game('skins', [up({ shotFor: 'lead', shotKind: 'putt' }), out]), up({ shotFor: 'lead', shotKind: 'putt' })), null);
  assert.equal(partyStakeView({ ...m, phase: 'tiebreak' }, m.players[0]), null);
  const vs = { phase: 'play', players: [up({ shotFor: 'tie', shotKind: 'putt' }), inn] };
  assert.equal(stakeView(vs, vs.players[0]).text, 'PUTT IN TO TIE');
});

test('the second line of the turn banner: the stake first, then a must-make, a score to make, the tee, the shot', () => {
  const a = P('a', 'Alex', 1), b = P('b', 'Sam', 2);
  let m = game('skins', [a, b]);
  assert.deepEqual(partyNeed(m, a), { text: 'TEE SHOT · 400 YD · PAR 4', tone: 'info' });
  assert.equal(partyNeed(m, P('a', 'Alex', 1, { teeYd: 260 })).text, 'FORWARD TEE · 260 YD · PAR 4');
  assert.equal(partyNeed({ ...m, stage: { ...m.stage, freeBall: 'rocket' } }, a).text, 'ROCKET LOADED · 400 YD');
  assert.deepEqual(partyNeed(m, P('a', 'Alex', 1, { strokes: 1, lie: 'fairway', distToPinYd: 150 })), { text: 'SHOT 2 · 150 YD TO THE PIN', tone: 'info' });
  assert.equal(partyNeed(m, P('a', 'Alex', 1, { strokes: 1, lie: 'fairway', distToPinYd: 150, cursedWith: 'fog' })).text, 'SHOT 2 · ??? TO THE PIN');
  assert.deepEqual(partyNeed(m, P('a', 'Alex', 1, { strokes: 2, lie: 'green', distToPinYd: 3 })), { text: 'FOR BIRDIE', tone: 'score' });
  assert.deepEqual(partyNeed(m, P('a', 'Alex', 1, { strokes: 2, lie: 'fairway', distToPinYd: 150, mustHole: true })), { text: 'MUST MAKE THIS', tone: 'must' });
  const stake = partyNeed(m, P('a', 'Alex', 1, { strokes: 2, lie: 'green', shotFor: 'win', shotKind: 'putt' }));
  assert.deepEqual([stake.text, stake.tone, stake.stake.for], ['PUTT IN TO WIN THE HOLE', 'stake-win', 'win']);
  // sudden death: nearest wins, or (elimination) farthest is out
  const tb = (goal, results) => ({ ...m, phase: 'tiebreak', tiebreak: { round: 1, goal, results } });
  assert.equal(partyNeed(tb('best', []), a).text, 'CLOSEST TO THE PIN');
  assert.equal(partyNeed(tb('best', [{ round: 1, playerId: 'b', ft: 12.5 }]), a).text, 'BEAT 12.5 FT');
  assert.equal(partyNeed(tb('best', [{ round: 1, playerId: 'b', ft: 0, holed: true }]), a).text, 'HOLE IT TO STAY ALIVE');
  assert.equal(partyNeed(tb('best', [{ round: 1, playerId: 'b', ft: null, miss: 'water' }]), a).text, 'THEY MISSED: JUST FIND LAND');
  assert.equal(partyNeed(tb('worst', []), a).text, 'FARTHEST FROM THE PIN IS OUT');
  assert.equal(partyNeed(tb('worst', [{ round: 1, playerId: 'b', ft: 12.5 }, { round: 1, playerId: 'c', ft: 30 }]), a).text, 'INSIDE 30.0 FT AND YOU ARE SAFE');
  assert.equal(partyNeed(tb('worst', [{ round: 1, playerId: 'b', ft: null, miss: 'ob' }]), a).text, 'SOMEBODY MISSED: JUST FIND LAND');
});

test('the standings: the leader first, by the format\'s own measure; the placings once it is over', () => {
  const a = P('a', 'Alex', 1, { holesWon: 1, total: 12 }), b = P('b', 'Sam', 2, { holesWon: 3, total: 10 }), c = P('c', 'Jo', 3, { holesWon: 1, total: 10, stats: { points: 400 } });
  assert.deepEqual(partyRanking(game('skins', [a, b, c])).map((p) => p.id), ['b', 'a', 'c']);
  assert.deepEqual(partyRanking(game('stroke', [a, b, c])).map((p) => p.id), ['c', 'b', 'a'], 'level on strokes: more points first');
  const e = [P('a', 'A', 1), P('b', 'B', 2, { out: true, place: 3 }), P('c', 'C', 3, { out: true, place: 2 })];
  assert.deepEqual(partyRanking(game('elim', e)).map((p) => p.id), ['a', 'c', 'b']);
  assert.deepEqual(partyRanking(game('skins', [a, b, c], { placings: ['c', 'a', 'b'] })).map((p) => p.id), ['c', 'a', 'b']);
  assert.equal(partyLine(game('skins', [a, b, c], { holeNumber: 2 })), 'SKINS · HOLE 2 OF 3');
  assert.equal(partyLine(game('elim', e)), 'ELIMINATION · 1 LEFT');
  assert.equal(partyLine(game('elim', [P('a', 'A', 1), P('b', 'B', 2), P('c', 'C', 3, { out: true })])), 'THE FINAL');
});

test('the result of a hole, for each format', () => {
  const ps = [P('a', 'Alex', 1), P('b', 'Sam', 2), P('c', 'Jordan', 3), P('d', 'Riley', 4)];
  const base = { holeNumber: 2, stageName: 'Canyon Run', par: 4, tiebreak: null };
  // skins: taken, carried, tied on the last hole, taken in sudden death
  let v = partyResultView(game('skins', ps), { ...base, winnerId: 'b', reason: 'knockout', skins: 2, scores: { a: 4, b: 3, c: 4, d: 3 }, finish: { a: 'picked-up', b: 'holed', c: 'holed', d: 'picked-up' } });
  assert.deepEqual([v.kind, v.title, v.sub, v.how], ['win', 'SAM', 'TAKES 2 SKINS', 'IN FOR BIRDIE. NOBODY CAN CATCH IT.']);
  assert.deepEqual(v.rows.map((x) => [x.p.id, x.big, x.label, x.out, x.won]), [['a', 'X', 'PICKED UP', true, false], ['b', '3', 'BIRDIE', false, true], ['c', '4', 'PAR', false, false], ['d', 'X', 'PICKED UP', true, false]]);
  v = partyResultView(game('skins', ps), { ...base, winnerId: null, reason: 'carry', skins: 1, carry: 1, scores: { a: 3, b: 3, c: 5, d: 4 }, finish: { a: 'holed', b: 'holed', c: 'holed', d: 'holed' } });
  assert.deepEqual([v.kind, v.title, v.sub, v.how], ['carry', 'NO WINNER', '2 SKINS ON THE NEXT HOLE', '2 PLAYERS MAKE BIRDIE']);
  v = partyResultView(game('skins', ps), { ...base, winnerId: null, reason: 'tied', skins: 3, scores: { a: 3, b: 3, c: 5, d: 4 }, finish: { a: 'holed', b: 'holed', c: 'holed', d: 'holed' } });
  assert.deepEqual([v.kind, v.title, v.sub], ['tied', 'ALL SQUARE!', 'SUDDEN DEATH FOR 3 SKINS']);
  v = partyResultView(game('skins', ps), { ...base, winnerId: 'a', reason: 'tiebreak', skins: 3, scores: { a: 3, b: 3, c: 5, d: 4 }, finish: { a: 'holed', b: 'holed', c: 'holed', d: 'holed' }, tiebreak: { arenaId: 'x', goal: 'best', rounds: [{ a: 6.1, b: null }] } });
  assert.deepEqual([v.kind, v.sub, v.how], ['win', 'TAKES 3 SKINS', 'CLOSEST TO THE PIN: 6.1 FT']);
  assert.deepEqual(v.rows.map((x) => x.sd), ['6.1 FT', 'MISS', undefined, undefined]);
  // elimination: out by score, out in sudden death, a tie still to settle
  const el = game('elim', ps.map((p) => (p.id === 'c' ? { ...p, out: true } : p)));
  v = partyResultView(el, { ...base, winnerId: 'a', eliminatedId: 'c', reason: 'score', scores: { a: 3, b: 4, c: 6, d: 4 }, finish: { a: 'holed', b: 'holed', c: 'holed', d: 'holed' } });
  assert.deepEqual([v.kind, v.title, v.sub, v.how, v.gone.id], ['out', 'JORDAN', 'IS OUT!', 'THE HIGHEST SCORE ON THE HOLE', 'c']);
  assert.deepEqual(v.rows.map((x) => [x.gone, x.won]), [[false, false], [false, false], [true, false], [false, false]], 'nobody "wins" a hole of an elimination: somebody goes');
  v = partyResultView(el, { ...base, winnerId: 'a', eliminatedId: 'c', reason: 'tiebreak', scores: { a: 3, b: 4, c: 4, d: 4 }, finish: {}, tiebreak: { goal: 'worst', rounds: [{ b: 9, c: 31.5, d: 12 }] } });
  assert.deepEqual([v.how, v.rows.find((x) => x.p.id === 'c').sd], ['FARTHEST FROM THE PIN', '31.5 FT']);
  v = partyResultView(game('elim', ps), { ...base, winnerId: 'a', reason: 'tied', scores: { a: 3, b: 4, c: 4, d: 4 }, finish: { a: 'holed', b: 'holed', c: 'holed', d: 'holed' } });
  assert.deepEqual([v.kind, v.title, v.sub], ['tied', 'TOO CLOSE TO CALL', 'SUDDEN DEATH: FARTHEST IS OUT']);
  // a stroke race: the best of the hole, or shared; a capped hole
  v = partyResultView(game('stroke', ps), { ...base, winnerId: 'a', reason: 'score', scores: { a: 3, b: 4, c: 8, d: 5 }, finish: { a: 'holed', b: 'holed', c: 'capped', d: 'holed' } });
  assert.deepEqual([v.kind, v.title, v.sub, v.how], ['win', 'ALEX', 'BEST OF THE HOLE', 'BIRDIE']);
  assert.deepEqual(v.rows[2], { p: v.rows[2].p, big: 'X', label: 'STROKE LIMIT', out: true, won: false, gone: false });
  v = partyResultView(game('stroke', ps), { ...base, winnerId: null, reason: 'score', scores: { a: 3, b: 3, c: 4, d: 5 }, finish: { a: 'holed', b: 'holed', c: 'holed', d: 'holed' } });
  assert.deepEqual([v.kind, v.title, v.sub], ['done', 'HOLE 2', 'IN THE BOOK']);
  // a playoff after the last hole
  v = partyResultView(game('skins', ps), { holeNumber: 4, stageName: 'Arena', par: 3, winnerId: 'd', reason: 'tiebreak', scores: {}, finish: {}, playoff: true, tiebreak: { goal: 'best', rounds: [{ a: 20, d: 3 }] } });
  assert.deepEqual([v.kind, v.title, v.sub, v.rows.map((x) => x.p.id)], ['win', 'RILEY', 'WINS THE PLAYOFF', ['a', 'd']]);
  assert.equal(partyResultView(game('skins', ps), null), null);
});

test('the menu of a party: the match\'s items in a party\'s words, and LEAVE THE GAME for whoever is up', () => {
  const ps = [P('a', 'Alex', 1), P('b', 'Sam', 2), P('c', 'Jordan', 3)];
  const m = game('skins', ps, { canRestartHole: true, undoable: { playerId: 'b', stray: false, holeNumber: 1 } });
  const items = partyMenuItems(m, null, { shell: true });
  assert.deepEqual(items.map((x) => x.id), ['resume', 'undo', 'restart-hole', 'restart-match', 'leave', 'quit']);
  const by = Object.fromEntries(items.map((x) => [x.id, x]));
  assert.deepEqual([by['restart-hole'].sub, by['restart-match'].label, by.leave.label, by.leave.sub, by.quit.label], ['EVERYBODY BACK ON THE TEE', 'RESTART GAME', 'LEAVE THE GAME', 'ALEX DROPS OUT · THE OTHERS PLAY ON', 'EXIT TO MAIN MENU']);
  assert.equal(by.leave.ask.title, 'ALEX LEAVES?');
  assert.equal(by.undo.sub, 'TAKE BACK SAM\'S SWING');
  // two left: leaving hands the game to the other; nobody up, or over: no such item
  const two = partyMenuItems(game('elim', [ps[0], ps[1], { ...ps[2], out: true }]), null);
  assert.match(two.find((x) => x.id === 'leave').ask.sub, /THE OTHER PLAYER WINS/);
  assert.equal(partyMenuItems({ ...m, phase: 'done', currentPlayerId: null }, null).some((x) => x.id === 'leave'), false);
  assert.equal(partyMenuItems({ ...m, phase: 'hole-result', currentPlayerId: null }, null).some((x) => x.id === 'leave'), false);
  // the drop on the line rides along from the game state, third, as in a match
  const withDrop = partyMenuItems(m, { canDrop: true, drop: { free: true, distToPinYd: 120 } });
  assert.deepEqual(withDrop.map((x) => x.id), ['resume', 'undo', 'drop', 'restart-hole', 'restart-match', 'leave', 'quit']);
});

test('who a trick goes to: the choice when it can be, else the first opponent in the order who carries no curse', () => {
  const ps = [P('a', 'Alex', 1), P('b', 'Sam', 2), P('c', 'Jordan', 3), P('d', 'Riley', 4)];
  const m = game('skins', ps, { teeOrder: ['c', 'a', 'd', 'b'] });
  assert.equal(defaultTarget(m, 'a'), 'c');
  assert.equal(defaultTarget(m, 'c'), 'a');
  assert.equal(defaultTarget(m, 'a', 'b'), 'b', 'the player\'s own choice');
  assert.equal(defaultTarget(m, 'a', 'a'), 'c', 'never oneself');
  const cursed = game('skins', ps.map((p) => (p.id === 'c' ? { ...p, cursedWith: 'fog' } : p)), { teeOrder: ['c', 'a', 'd', 'b'] });
  assert.equal(defaultTarget(cursed, 'a'), 'd');
  const out = game('elim', ps.map((p) => (p.id === 'c' || p.id === 'd' ? { ...p, out: true } : p)));
  assert.equal(defaultTarget(out, 'a', 'c'), 'b', 'a player who is out is nobody\'s target');
  assert.equal(defaultTarget(game('elim', [ps[0], { ...ps[1], out: true }]), 'a'), null);
});
