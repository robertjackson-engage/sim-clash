// The match menu's items and the stake line of the turn banner (public/arcade/match.js
// menuItems, stakeView, shotNeed): the pure pieces behind the pause panel and "PUTT IN TO WIN".
import test from 'node:test';
import assert from 'node:assert/strict';
import { menuItems, stakeView, shotNeed } from '../public/arcade/match.js';

const players = (a = {}, b = {}) => [
  { id: 'p1', name: 'Alex Sheppard', slot: 1, strokes: 0, lie: 'tee', holed: false, holesWon: 0, distToPinYd: 150, mustHole: false, shotFor: null, shotKind: null, ...a },
  { id: 'p2', name: 'Dave', slot: 2, strokes: 0, lie: 'tee', holed: false, holesWon: 0, distToPinYd: 150, mustHole: false, shotFor: null, shotKind: null, ...b },
];
const match = (over = {}, a, b) => ({ id: 'm1', phase: 'play', holeNumber: 2, currentPlayerId: 'p1', stage: { par: 4, lengthYd: 357 }, undoable: null, canRestartHole: true, players: players(a, b), ...over });

test('the match menu: five big buttons, the ones that cannot be done greyed, the destructive ones ask once', () => {
  let items = menuItems(match());
  assert.deepEqual(items.map((x) => [x.id, x.label, x.on, Boolean(x.ask)]), [
    ['resume', 'RESUME', true, false],
    ['undo', 'UNDO LAST SHOT', false, false],
    ['restart-hole', 'RESTART HOLE', true, true],
    ['restart-match', 'RESTART MATCH', true, true],
    ['quit', 'QUIT MATCH', true, true],
  ]);
  assert.equal(items[1].sub, 'NO SWING TO TAKE BACK');
  assert.equal(items[4].ask.title, 'QUIT MATCH?');
  // a swing to take back: whose it was, and whether it looked like a stray ball
  items = menuItems(match({ undoable: { playerId: 'p2', stray: false, holeNumber: 2 } }));
  assert.deepEqual([items[1].on, items[1].sub], [true, 'TAKE BACK DAVE\'S SWING']);
  items = menuItems(match({ undoable: { playerId: 'p1', stray: true, holeNumber: 2 } }));
  assert.equal(items[1].sub, 'TAKE BACK ALEX\'S SWING · A STRAY BALL?');
  // on a result screen: the swing that decided it can go back, the hole cannot be restarted
  items = menuItems(match({ phase: 'hole-result', canRestartHole: false, undoable: { playerId: 'p1', stray: false, holeNumber: 2 } }));
  assert.deepEqual(items.map((x) => x.on), [true, true, false, true, true]);
  // sudden death: it is the round that restarts
  items = menuItems(match({ phase: 'tiebreak' }));
  assert.deepEqual([items[2].label, items[2].ask.title], ['RESTART ROUND', 'RESTART THE ROUND?']);
  assert.deepEqual(menuItems(null), []);
});

test('the stake of a swing: PUTT IN TO WIN, CHIP IN TO TIE ... from shotFor and shotKind', () => {
  const up = (a, b, over) => { const m = match(over, a, b); return stakeView(m, m.players[0]); };
  assert.deepEqual(up({ shotFor: 'win', shotKind: 'putt', strokes: 2, lie: 'green' }, { strokes: 3, lie: 'green' }), { for: 'win', kind: 'putt', text: 'PUTT IN TO WIN', voice: 'm-for-the-win' });
  assert.deepEqual(up({ shotFor: 'tie', shotKind: 'putt', strokes: 2, mustHole: true }, { strokes: 3, holed: true }), { for: 'tie', kind: 'putt', text: 'PUTT IN TO TIE', voice: 'm-to-tie' });
  assert.equal(up({ shotFor: 'win', shotKind: 'chip', strokes: 2 }, { strokes: 3 }).text, 'CHIP IN TO WIN');
  assert.equal(up({ shotFor: 'tie', shotKind: 'chip', strokes: 2 }, { strokes: 3, holed: true }).text, 'CHIP IN TO TIE');
  // a full shot: the must-make, and a hole-out that would beat a score already in
  assert.equal(up({ shotFor: 'tie', shotKind: 'shot', strokes: 2 }, { strokes: 3, holed: true }).text, 'HOLE IT TO TIE');
  assert.equal(up({ shotFor: 'win', shotKind: 'shot', strokes: 1 }, { strokes: 3, holed: true }).text, 'HOLE IT TO WIN');
  // ... but not the arithmetic of an ace or a fairway hole-out that would knock out a player who is still out
  assert.equal(up({ shotFor: 'win', shotKind: 'shot', strokes: 0 }, { strokes: 1 }), null, 'the second tee shot of every hole is not FOR THE WIN');
  assert.equal(up({ shotFor: 'win', shotKind: 'shot', strokes: 2 }, { strokes: 3 }), null);
  // nothing at stake, another phase, or a server that does not say
  assert.equal(up({ shotFor: 'lead', shotKind: 'putt' }, {}), null);
  assert.equal(up({ shotFor: null, shotKind: 'putt' }, {}), null);
  assert.equal(up({}, {}), null);
  assert.equal(up({ shotFor: 'win', shotKind: 'putt' }, {}, { phase: 'tiebreak' }), null);

  // the turn banner's second line: the stake first, else what it always said
  const m = match({}, { shotFor: 'win', shotKind: 'putt', strokes: 2, lie: 'green', distToPinYd: 6 }, { strokes: 3, lie: 'green' });
  const need = shotNeed(m, m.players[0]);
  assert.deepEqual([need.text, need.tone, need.stake.voice], ['PUTT IN TO WIN', 'stake-win', 'm-for-the-win']);
  const tie = match({}, { shotFor: 'tie', shotKind: 'putt', strokes: 2, lie: 'green', mustHole: true, distToPinYd: 6 }, { strokes: 3, holed: true });
  assert.deepEqual([shotNeed(tie, tie.players[0]).text, shotNeed(tie, tie.players[0]).tone], ['PUTT IN TO TIE', 'stake-tie']);
  const plain = match({}, { strokes: 2, lie: 'green', distToPinYd: 6 }, { strokes: 2, lie: 'green' });
  assert.deepEqual([shotNeed(plain, plain.players[0]).text, shotNeed(plain, plain.players[0]).stake], ['FOR BIRDIE', undefined]);
  const old = match({}, { strokes: 2, lie: 'green', mustHole: true, distToPinYd: 6 }, { strokes: 3, holed: true });
  assert.equal(shotNeed(old, old.players[0]).text, 'MUST MAKE THIS', 'a state without shotFor reads as it did');
});
