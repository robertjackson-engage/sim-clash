// v3:modes BULLSEYE, the page's pure parts (public/arcade/bullseye.js): what a ball says when
// it lands, the words of a game, and the board: the target drawn from the real ring radii with
// every ball where it finished, in its thrower's colour and mark.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ballWords, ftWords, gameWords, scoreOf, boardSvg, allDarts } from '../public/arcade/bullseye.js';
import { PLAYER_COLORS, PLAYER_MARKS } from '../public/arcade/shell-core.js';

const RINGS = [{ r: 3, value: 50 }, { r: 7, value: 25 }, { r: 11, value: 15 }, { r: 15, value: 10 }, { r: 19, value: 5 }];
const dart = (extra) => ({ n: 1, ball: 1, round: 1, x: 0, y: 0, ft: 10, ring: 1, value: 25, name: 'INNER RING', mult: 1, score: 25, miss: null, holed: false, bust: false, ...extra });

test('what a ball says: the score and the ring, a bullseye, a blank, a miss, a bust, a check out', () => {
  assert.deepEqual(ballWords(dart()), { title: '+25', sub: 'INNER RING · 10.0 FT', tone: 'score' });
  assert.deepEqual(ballWords(dart({ mult: 3, score: 75 })), { title: '+75', sub: 'INNER RING ×3 · 10.0 FT', tone: 'score' });
  assert.deepEqual(ballWords(dart({ ring: 0, value: 50, score: 100, mult: 2, name: 'BULLSEYE', ft: 4.2 })), { title: 'BULLSEYE! ×2', sub: '+100 · 4.2 FT', tone: 'bull' });
  assert.deepEqual(ballWords(dart({ ring: 0, value: 50, score: 50, name: 'BULLSEYE', ft: 0, holed: true })), { title: 'BULLSEYE!', sub: '+50 · HOLED IT!', tone: 'bull' });
  assert.deepEqual(ballWords(dart({ ring: null, value: 0, score: 0, ft: 71.3 })), { title: 'NO SCORE', sub: 'OFF THE TARGET · 71.3 FT', tone: 'blank' });
  assert.deepEqual(ballWords(dart({ ring: null, value: 0, score: 0, ft: null, miss: 'water' })), { title: 'MISS', sub: 'IN THE WATER', tone: 'miss' });
  assert.equal(ballWords(dart({ ring: null, value: 0, score: 0, ft: null, miss: 'ob' })).sub, 'OUT OF BOUNDS');
  assert.deepEqual(ballWords(dart({ ring: 0, value: 50, score: 0, bust: true })), { title: 'BUST!', sub: '50 IS TOO MANY · THE TURN IS OVER', tone: 'bust' });
  assert.deepEqual(ballWords(dart({ ring: 0, value: 50, score: 50, name: 'BULLSEYE', checkout: true })), { title: 'CHECK OUT!', sub: 'BULLSEYE · EXACTLY ZERO', tone: 'bull' });
  assert.equal(ballWords(null), null);
});

test('distances and the words of a game', () => {
  assert.deepEqual([ftWords(0), ftWords(0.5), ftWords(4.24), ftWords(98.44), ftWords(120.2), ftWords(null)], ['HOLED', '6 IN', '4.2 FT', '98.4 FT', '120 FT', '']);
  assert.equal(gameWords({ variant: 'high', rounds: 3, balls: 3 }), 'HIGH SCORE · 3 ROUNDS OF 3');
  assert.equal(gameWords({ variant: 'high', rounds: 1, balls: 3 }), 'HIGH SCORE · 1 ROUND OF 3');
  assert.equal(gameWords({ variant: 'countdown', target: 200, rounds: 10, balls: 3 }), 'COUNTDOWN FROM 200');
  assert.equal(scoreOf({ variant: 'high' }, { total: 85, remaining: null }), 85);
  assert.equal(scoreOf({ variant: 'countdown' }, { total: 60, remaining: 40 }), 40);
});

test('the board: the real rings, every dart where its ball finished, colour and mark by slot', () => {
  const svg = boardSvg(RINGS, [
    { n: 1, slot: 1, x: 5, y: 2, ball: 1 },                    // 5 m right, 2 m long
    { n: 2, slot: 3, x: -30, y: 0, ball: 2 },                  // off the target: on the rim, hollow
    { n: 3, slot: 4, x: 0, y: 60, miss: 'water', ball: 3 },    // lost long: a cross on the rim
  ], { last: 1 });
  // the view box is the outer ring plus a margin, and there is one circle per ring at its radius
  assert.match(svg, /viewBox="-22\.8 -22\.8 45\.6 45\.6"/);
  for (const r of RINGS) assert.ok(svg.includes(`<circle r="${r.r}" `), `ring ${r.r}`);
  for (const r of RINGS) assert.ok(svg.includes(`>${r.value}</text>`), `value ${r.value}`);
  // dart 1: right is +x, long is up the board (-y), in slot 1's colour with its mark, ringed as the last ball
  assert.ok(svg.includes('<g class="be-dart be-dart-last" transform="translate(5.00 -2.00)">'));
  assert.ok(svg.includes(`fill="${PLAYER_COLORS[0]}"`) && svg.includes(`>${PLAYER_MARKS[0]}</text>`));
  assert.equal((svg.match(/be-dart-ring/g) || []).length, 1);
  // dart 2: pulled in to the rim (outside the last ring, inside the view), hollow in slot 3's colour
  const rim = (19 + 3.8 * 0.42).toFixed(2);
  assert.ok(svg.includes(`transform="translate(-${rim} 0.00)"`), 'on the rim, to the left');
  assert.ok(svg.includes(`stroke="${PLAYER_COLORS[2]}"`) && svg.includes(`>${PLAYER_MARKS[2]}</text>`));
  // dart 3: a cross at the top of the rim in slot 4's colour, no disc
  assert.ok(svg.includes(`transform="translate(0.00 -${rim})"`));
  assert.ok(svg.includes(`stroke="${PLAYER_COLORS[3]}"`));
  assert.equal((svg.match(/class="be-dart-m"/g) || []).length, 2, 'a lost ball has no disc');
  // options: no labels; ball numbers instead of marks; voided darts are marked
  assert.ok(!boardSvg(RINGS, [], { labels: false }).includes('be-board-v'));
  assert.ok(boardSvg(RINGS, [{ n: 1, slot: 2, x: 0, y: 0, ball: 3 }], { numbers: true }).includes('>3</text>'));
  assert.ok(boardSvg(RINGS, [{ n: 1, slot: 2, x: 0, y: 0, voided: 10 }]).includes('be-dart-void'));
  // a four-ring target draws four
  assert.equal((boardSvg(RINGS.slice(0, 4), []).match(/<circle r="(3|7|11|15)" /g) || []).length, 4);
});

test('every dart of a game, in the order thrown, with its thrower\'s slot', () => {
  const s = { players: [{ slot: 1, darts: [{ n: 1 }, { n: 4 }] }, { slot: 2, darts: [{ n: 2 }, { n: 3 }] }] };
  assert.deepEqual(allDarts(s).map((d) => [d.n, d.slot]), [[1, 1], [2, 2], [3, 2], [4, 1]]);
  assert.deepEqual(allDarts(null), []);
});
