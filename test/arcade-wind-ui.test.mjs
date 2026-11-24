// The hole's wind as the match UI shows it (public/arcade/match.js windView): the WIND chip
// of the stage and sudden-death intros and the header's badge are drawn from this.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { windView, introStage } from '../public/arcade/match.js';

const require = createRequire(import.meta.url);
const { describeWind, rollWind, pendingWind } = require('../lib/arcade-wind.js');
const NORTH = { tee: [0, 0], pin: [0, 400] };

test('a rolled wind: the speed, an arrow that points up the screen toward the pin, the read, a colour by strength', () => {
  const v = (mph, dirDeg) => windView(describeWind(mph, dirDeg, NORTH));
  assert.deepEqual(v(12, 225), { known: true, tone: 'moderate', num: '12', arrowDeg: 45, lines: ['LEFT TO RIGHT', 'HELPING'], text: '12 MPH · LEFT TO RIGHT · HELPING' });
  // the arrow: 0 straight up (the wind is behind), 90 pointing right, 180 down the screen (in the face), -90 pointing left
  assert.deepEqual([v(9, 180).arrowDeg, v(9, 270).arrowDeg, v(9, 0).arrowDeg, v(9, 90).arrowDeg], [0, 90, 180, -90]);
  assert.deepEqual([v(9, 180).lines, v(9, 270).lines, v(9, 0).lines, v(9, 90).lines], [['HELPING'], ['LEFT TO RIGHT'], ['HURTING'], ['RIGHT TO LEFT']]);
  assert.deepEqual(v(20, 45).lines, ['RIGHT TO LEFT', 'HURTING']);
  // calm green, moderate amber, strong red
  assert.deepEqual([0, 3, 5, 6, 12, 13, 22].map((mph) => v(mph, 200).tone), ['calm', 'calm', 'calm', 'moderate', 'moderate', 'strong', 'strong']);
  // no wind: no arrow, and it says so
  assert.deepEqual(v(0, 77), { known: true, tone: 'calm', num: '0', arrowDeg: null, lines: ['NO WIND'], text: 'NO WIND' });
  // a wind with nothing to read it against: the speed alone
  assert.deepEqual(windView(describeWind(8, 90, null)), { known: true, tone: 'moderate', num: '8', arrowDeg: null, lines: [], text: '8 MPH' });
  // whatever the server sends: the strength is worked out when it is missing
  assert.equal(windView({ mph: 17.4, relDeg: 10 }).tone, 'strong');
  assert.equal(windView({ mph: 17.4, relDeg: 10 }).num, '17');
  const rolled = windView(rollWind({ arcade: { conditions: 'windy' }, hole: NORTH, random: () => 0.5 }));
  assert.equal(rolled.known, true);
});

test('a stage whose wind is not rolled yet shows its range; nothing known shows nothing', () => {
  assert.deepEqual(windView(pendingWind({ wind: { min: 6, max: 16 } })), { known: false, tone: 'pending', num: '6–16', arrowDeg: null, lines: ['ROLLING THE WIND'], text: '6 TO 16 MPH' });
  assert.equal(windView(pendingWind({ wind: { min: 8, max: 8 } })).num, '8');
  assert.equal(windView({ min: 4, max: 10 }).num, '4–10', 'a raw manifest entry\'s range');
  for (const nothing of [null, undefined, 'windy', {}, { mph: null }, { mph: 'x', min: 'a' }]) assert.equal(windView(nothing), null);
  // while the course loads the intro is about nextStage (the range); once it is in, stage (the roll)
  const loading = { phase: 'loading', nextStage: { id: 's2', wind: pendingWind({ conditions: 'windy' }) }, stage: { id: 's1', wind: describeWind(3, 0, NORTH) } };
  assert.equal(windView(introStage(loading).wind).num, '12–22');
  const intro = { phase: 'intro', nextStage: null, stage: { id: 's2', wind: describeWind(18, 270, NORTH) } };
  assert.deepEqual([windView(introStage(intro).wind).num, windView(introStage(intro).wind).tone], ['18', 'strong']);
});
