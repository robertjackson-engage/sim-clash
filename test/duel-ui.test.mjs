// v3:modes TRICK SHOT DUEL, the page's pure parts (public/arcade/duel.js): the word as tiles,
// a shot in a line, what the newest verdict says, what the header calls the swing that is
// awaited, a finished round as a line of the result table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tilesHtml, shotWords, verdictWords, roleWords, historyLine } from '../public/arcade/duel.js';

const PLAYERS = [{ id: 'a', name: 'Alex', slot: 1 }, { id: 'b', name: 'Blair', slot: 2 }];

test('the word as tiles: the letters a player has are lit, the one just taken is marked', () => {
  const html = tilesHtml('CLASH', 2, { fresh: 1 });
  assert.deepEqual([...html.matchAll(/<i class="([^"]*)">(.)<\/i>/g)].map((m) => [m[2], m[1].trim()]), [['C', 'on'], ['L', 'on fresh'], ['A', ''], ['S', ''], ['H', '']]);
  assert.match(html, /aria-label="CL"/);
  assert.match(tilesHtml('PIG', 0), /aria-label="no letters"/);
  assert.equal((tilesHtml('PIG', 3).match(/class="on"/g) || []).length, 3);
});

test('a shot in a line', () => {
  assert.equal(shotWords({ clean: true, carryYd: 152.4, curveYd: -11.9, apexFt: 97, finishFt: 18.2, holed: false }), '152 YD · LEFT 12 YD · 97 FT HIGH · 18 FT FROM THE PIN');
  assert.equal(shotWords({ clean: true, carryYd: 140, curveYd: 0.4, apexFt: null, finishFt: 0, holed: true }), '140 YD · HOLED');
  assert.equal(shotWords({ clean: false, miss: 'water' }), 'IN THE WATER');
  assert.equal(shotWords({ clean: false, miss: 'ob' }), 'OUT OF BOUNDS');
  assert.equal(shotWords(null), '');
});

test('what the newest verdict says', () => {
  const s = (last) => ({ players: PLAYERS, last });
  assert.deepEqual(verdictWords(s({ kind: 'call', playerId: 'a' })), { kind: 'call', title: 'MATCH IT', sub: 'ALEX CALLS IT', tone: 'call' });
  assert.deepEqual(verdictWords(s({ kind: 'matched', playerId: 'b' })), { kind: 'matched', title: 'MATCHED!', sub: 'BLAIR ANSWERS IT', tone: 'good' });
  assert.deepEqual(verdictWords(s({ kind: 'letter', playerId: 'b', letter: 'L' })), { kind: 'letter', title: 'LETTER: L', sub: 'BLAIR MISSES IT', tone: 'bad' });
  assert.deepEqual(verdictWords(s({ kind: 'no-call', playerId: 'a', reason: 'hazard', shot: { miss: 'water' } })), { kind: 'no-call', title: 'NO CALL', sub: 'IN THE WATER · NOTHING TO MATCH', tone: 'none' });
  assert.equal(verdictWords(s({ kind: 'no-call', playerId: 'a', reason: 'hazard', shot: { miss: 'ob' } })).sub, 'OUT OF BOUNDS · NOTHING TO MATCH');
  assert.equal(verdictWords(s({ kind: 'no-call', playerId: 'a', reason: 'duff' })).sub, 'A DUFF · NOTHING TO MATCH');
  assert.equal(verdictWords(s(null)), null);
  assert.equal(verdictWords(null), null);
});

test('the header, and a round of the result table', () => {
  assert.equal(roleWords({ phase: 'play', role: 'challenge' }), 'CALL YOUR SHOT');
  assert.equal(roleWords({ phase: 'play', role: 'match' }), 'MATCH IT');
  assert.equal(roleWords({ phase: 'done' }), 'DUEL OVER');
  assert.equal(roleWords({ phase: 'loading' }), '');
  const s = { players: PLAYERS };
  assert.deepEqual(historyLine(s, { round: 1, challengerId: 'a', call: 'MATCH IT: 150 YD CARRY · BENDS LEFT', matcherId: 'b', result: 'letter', letter: 'C' }),
    { round: 1, by: 'ALEX', call: '150 YD CARRY · BENDS LEFT', out: 'BLAIR: C', result: 'letter' });
  assert.equal(historyLine(s, { round: 2, challengerId: 'b', call: 'MATCH IT: 90 YD CARRY', matcherId: 'a', result: 'matched' }).out, 'ALEX MATCHED');
  assert.deepEqual(historyLine(s, { round: 3, challengerId: 'a', call: null, result: 'no-call', reason: 'hazard' }), { round: 3, by: 'ALEX', call: 'NO CALL', out: 'LOST BALL', result: 'no-call' });
  assert.equal(historyLine(s, { round: 4, challengerId: 'b', call: null, result: 'no-call', reason: 'duff' }).out, 'A DUFF');
});
