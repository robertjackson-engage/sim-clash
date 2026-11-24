// v2:connect The connection wizard's flow (public/arcade/connect.js) as a state machine, under
// Node: no DOM. The catalogue is the real one, as GET /api/launch-monitors serves it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  reduce, initialState, buttonsOf, brandList, devicesOf, deviceOf, addressFor, lightOf, shotText, shotIn, fullName, fill, TIER_ORDER,
} from '../public/arcade/connect.js';

const require = createRequire(import.meta.url);
const lm = require('../lib/launch-monitors.js');
const cat = { ...lm.forClient({ port: 921, addresses: [{ address: '192.168.1.40', name: 'Wi-Fi', private: true }] }), chosen: null };

const start = () => reduce(initialState(), { type: 'loaded' }, cat);
const run = (state, ...actions) => actions.reduce((s, a) => reduce(s, a, cat), state);
const cues = (state) => state.effects.filter((e) => e.type === 'cue').map((e) => e.name);
const effect = (state, type) => state.effects.find((e) => e.type === type);
const brandIndex = (id) => brandList(cat).findIndex((b) => b.id === id);
const pick = (state, brandId) => reduce(state, { type: 'select', index: brandIndex(brandId) }, cat);
const shot = (seq, extra = {}) => ({ seq, at: seq, source: 'open-connect', speedMph: 142.3, vla: 13.4, hla: 1.2, totalSpin: 2850, spinAxis: -3.1, check: { ok: true, issues: [] }, ...extra });

test('the brand grid: best tier first, and the two wide tiles after it', () => {
  const brands = brandList(cat);
  assert.equal(brands[0].id, 'foresight', 'the tested one leads');
  assert.equal(brands[0].tier, 'tested');
  const order = brands.map((b) => TIER_ORDER.indexOf(b.tier));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.equal(brands.length, cat.brands.length);
  const s = start();
  assert.equal(s.screen, 'brands');
  assert.equal(s.cursor, 0);
});

test('moving the cursor: one tick per move, none at an edge, down from the grid lands on a wide tile', () => {
  let s = start();
  s = reduce(s, { type: 'move', dir: 'left' }, cat);
  assert.equal(s.cursor, 0);
  assert.deepEqual(cues(s), [], 'nothing moved: no sound');
  s = reduce(s, { type: 'move', dir: 'right' }, cat);
  assert.equal(s.cursor, 1);
  assert.deepEqual(cues(s), ['ui-tick']);
  s = reduce(s, { type: 'move', dir: 'down' }, cat);
  assert.equal(s.cursor, 8);
  for (let i = 0; i < 6; i++) s = reduce(s, { type: 'move', dir: 'down' }, cat);
  assert.equal(s.cursor, cat.brands.length, 'I DON\'T HAVE ONE, under the left half');
  s = reduce(s, { type: 'move', dir: 'right' }, cat);
  assert.equal(s.cursor, cat.brands.length + 1, 'MINE ISN\'T LISTED');
  s = reduce(s, { type: 'move', dir: 'right' }, cat);
  assert.equal(s.cursor, cat.brands.length + 1);
  s = reduce(s, { type: 'move', dir: 'up' }, cat);
  assert.ok(s.cursor < cat.brands.length, 'back up into the grid');
});

test('a brand with several models asks which one; a brand with one goes straight to GET CONNECTED', () => {
  let s = pick(start(), 'foresight');
  assert.equal(s.screen, 'models');
  assert.deepEqual(cues(s), ['ui-confirm']);
  const list = devicesOf(cat, 'foresight');
  assert.equal(list[0].id, 'foresight-gcquad', 'the tested model first');
  s = reduce(s, { type: 'select', index: 0 }, cat);
  assert.equal(s.screen, 'steps');
  assert.equal(s.deviceId, 'foresight-gcquad');
  assert.deepEqual(effect(s, 'save-device'), { type: 'save-device', id: 'foresight-gcquad' }, 'the choice is remembered at once');

  s = pick(start(), 'rapsodo');
  assert.equal(s.screen, 'steps');
  assert.equal(s.deviceId, 'rapsodo-mlm2pro');
});

test('GET CONNECTED: one step at a time, back steps back, the last step leads to HIT A BALL', () => {
  let s = pick(start(), 'pitrac');
  const dev = deviceOf(cat, 'pitrac');
  assert.deepEqual(buttonsOf(s, cat), ['back', 'next']);
  assert.equal(s.cursor, 1, 'the cursor is on NEXT');
  for (let i = 1; i < dev.steps.length; i++) {
    s = reduce(s, { type: 'select' }, cat);
    assert.equal(s.step, i);
    assert.deepEqual(cues(s), ['ui-tick']);
  }
  assert.deepEqual(buttonsOf(s, cat), ['back', 'to-hit']);
  const back = reduce(s, { type: 'back' }, cat);
  assert.equal(back.step, dev.steps.length - 2);
  assert.deepEqual(cues(back), ['ui-back']);
  s = reduce(s, { type: 'select', seq: 7 }, cat);
  assert.equal(s.screen, 'hit');
  assert.equal(s.sinceSeq, 7, 'only a ball hit from now on counts');
  assert.deepEqual(effect(s, 'probe'), { type: 'probe', on: true }, 'swings are held for the test ball');
});

test('the connector connecting while the steps are up offers HIT A BALL at once', () => {
  let s = pick(start(), 'garmin');
  s = reduce(s, { type: 'select', index: 0 }, cat);
  assert.equal(s.deviceId, 'garmin-r10');
  assert.deepEqual(buttonsOf(s, cat), ['back', 'next']);
  s = reduce(s, { type: 'status', status: { connected: true, state: 'connected' } }, cat);
  assert.equal(s.linked, true);
  assert.deepEqual(buttonsOf(s, cat), ['back', 'to-hit']);
  assert.deepEqual(cues(s), [], 'the status changing is not an action of the player: no sound');
  s = reduce(s, { type: 'status', status: { connected: false, state: 'waiting' } }, cat);
  assert.equal(s.linked, false);
});

test('HIT A BALL: an old shot is ignored, a new one is the confirmation, and it can be hit again', () => {
  let s = run(pick(start(), 'openflight'), { type: 'status', status: { connected: true } }, { type: 'select', seq: 3 });
  assert.equal(s.screen, 'hit');
  assert.deepEqual(buttonsOf(s, cat), ['back', 'skip-ball']);
  s = reduce(s, { type: 'status', status: { connected: true, lastShot: shot(3) } }, cat);
  assert.equal(s.shot, null, 'the shot from before the screen opened');
  s = reduce(s, { type: 'status', status: { connected: true, lastShot: shot(3), probe: { on: true, shot: shot(4) } } }, cat);
  assert.equal(s.shot.seq, 4);
  assert.deepEqual(cues(s), ['ui-confirm'], 'one sound for the ball that arrived');
  assert.deepEqual(buttonsOf(s, cat), ['again', 'looks-right']);
  assert.equal(s.cursor, 1, 'the cursor is on LOOKS RIGHT');
  const same = reduce(s, { type: 'status', status: { connected: true, probe: { on: true, shot: shot(4) } } }, cat);
  assert.deepEqual(cues(same), [], 'the same shot again is not a new one');

  const again = reduce(s, { type: 'press', id: 'again' }, cat);
  assert.equal(again.shot, null);
  assert.equal(again.sinceSeq, 4);
  const next = reduce(again, { type: 'status', status: { connected: true, probe: { on: true, shot: shot(5, { speedMph: 98 }) } } }, cat);
  assert.equal(next.shot.speedMph, 98);

  s = reduce(s, { type: 'select' }, cat);
  assert.equal(s.screen, 'done');
  assert.deepEqual(effect(s, 'probe'), { type: 'probe', on: false }, 'swings are the game\'s again');
  s = reduce(s, { type: 'select' }, cat);
  assert.deepEqual(effect(s, 'done'), { type: 'done' });
  assert.deepEqual(cues(s), ['ui-confirm']);
});

test('I DON\'T HAVE ONE goes straight to the last screen; back returns to the grid', () => {
  let s = reduce(start(), { type: 'select', index: cat.brands.length }, cat);
  assert.equal(s.screen, 'done');
  assert.equal(s.deviceId, 'none');
  assert.deepEqual(effect(s, 'save-device'), { type: 'save-device', id: 'none' });
  assert.equal(effect(s, 'probe'), undefined, 'no test ball without a launch monitor');
  s = reduce(s, { type: 'back' }, cat);
  assert.equal(s.screen, 'brands');
  assert.equal(s.cursor, cat.brands.length);
});

test('MINE ISN\'T LISTED shows the generic steps with both addresses', () => {
  const s = reduce(start(), { type: 'select', index: cat.brands.length + 1 }, cat);
  assert.equal(s.screen, 'steps');
  assert.equal(s.deviceId, 'other');
  const dev = deviceOf(cat, 'other');
  assert.ok(dev.steps.length >= 3);
  assert.equal(addressFor(cat, dev).address, '127.0.0.1');
  assert.equal(addressFor(cat, dev).lan, '192.168.1.40');
  const back = reduce(s, { type: 'back' }, cat);
  assert.equal(back.screen, 'brands');
  assert.equal(back.cursor, cat.brands.length + 1);
});

test('a launch monitor that is not supported says so and offers test swings', () => {
  let s = pick(start(), 'golfzon');
  assert.equal(s.screen, 'unsupported');
  assert.deepEqual(buttonsOf(s, cat), ['back', 'try']);
  assert.ok(deviceOf(cat, s.deviceId).why);
  s = reduce(s, { type: 'press', id: 'try' }, cat);
  assert.equal(s.screen, 'done');
  assert.equal(effect(s, 'probe'), undefined);
  assert.equal(reduce(s, { type: 'back' }, cat).screen, 'unsupported');
});

test('back out of every screen ends at the brand grid, on the brand that was open', () => {
  let s = pick(start(), 'foresight');
  s = reduce(s, { type: 'select', index: 2 }, cat);   // the third Foresight entry
  assert.equal(s.screen, 'steps');
  s = reduce(s, { type: 'back' }, cat);
  assert.equal(s.screen, 'models');
  assert.equal(s.cursor, 2);
  s = reduce(s, { type: 'press', id: 'back' }, cat);
  assert.equal(s.screen, 'brands');
  assert.equal(s.cursor, brandIndex('foresight'));
  const stay = reduce(s, { type: 'back' }, cat);
  assert.equal(stay.screen, 'brands');
  assert.deepEqual(cues(stay), [], 'nowhere to go back to: no sound');
});

test('never more than one sound for one action', () => {
  const actions = [{ type: 'move', dir: 'right' }, { type: 'select' }, { type: 'select' }, { type: 'back' }, { type: 'select' }, { type: 'select' }, { type: 'select' }, { type: 'select' }, { type: 'select', seq: 1 },
    { type: 'status', status: { connected: true, probe: { on: true, shot: shot(9) } } }, { type: 'select' }, { type: 'select' }];
  let s = start();
  for (const a of actions) {
    s = reduce(s, a, cat);
    assert.ok(cues(s).length <= 1, JSON.stringify(a));
    for (const name of cues(s)) assert.ok(['ui-tick', 'ui-confirm', 'ui-back'].includes(name));
  }
});

test('the address a connector is given: this PC for a local one, the network address for a remote one', () => {
  assert.equal(addressFor(cat, deviceOf(cat, 'garmin-r10')).address, '127.0.0.1');
  assert.equal(addressFor(cat, deviceOf(cat, 'pitrac')).address, '192.168.1.40');
  const offline = { ...cat, addresses: [], lanAddress: null };
  assert.equal(addressFor(offline, deviceOf(cat, 'pitrac')).missing, true);
  assert.equal(fill('{address}:{port}', { address: '127.0.0.1', port: 921 }), '127.0.0.1:921');
  assert.equal(fullName('PiTrac', 'PiTrac'), 'PiTrac');
  assert.equal(fullName('Foresight', 'GCQuad'), 'Foresight GCQuad');
});

test('the status light and the shot card say what the server said', () => {
  assert.equal(lightOf(null).tone, 'wait');
  const blocked = lightOf({ state: 'blocked', connected: false, cause: { id: 'port-in-use', title: 'CLOSE GSPRO', help: 'GSPro is open.' } });
  assert.deepEqual(blocked, { tone: 'warn', title: 'CLOSE GSPRO', help: 'GSPro is open.' });
  assert.equal(lightOf({ state: 'waiting', connected: false, cause: { id: 'no-connector', title: 'WAITING FOR YOUR CONNECTOR', help: 'Start it.' } }).tone, 'wait');
  assert.equal(lightOf({ state: 'connected', connected: true, source: 'open-connect' }).title, 'CONNECTOR CONNECTED');
  assert.equal(lightOf({ state: 'connected', connected: true, source: 'foresight' }).title, 'FORESIGHT CONNECTOR FOUND');
  assert.equal(lightOf({ state: 'ready', connected: true, ready: true }).title, 'READY');
  const quiet = lightOf({ state: 'connected', connected: true, cause: { id: 'no-shots', title: 'CONNECTED, BUT NO SHOT YET', help: 'Check the monitor.' } }, { screen: 'hit' });
  assert.equal(quiet.title, 'CONNECTED, BUT NO SHOT YET');

  const t = shotText(shot(1, { hla: -2.5, check: { ok: false, issues: [{ id: 'maybe-mps', text: 'Too slow.' }] } }));
  assert.equal(t.headline, 'WE SEE YOU: 142 MPH');
  assert.deepEqual(t.stats.map((x) => x.value), ['142.3', '13.4', '2.5', '2850']);
  assert.equal(t.stats[2].unit, 'DEG L');
  assert.equal(t.issues.length, 1);
  assert.equal(shotText(null), null);
  assert.equal(shotIn({ lastShot: shot(2), probe: { shot: shot(5) } }).seq, 5);
  assert.equal(shotIn({ lastShot: shot(2), probe: { shot: null } }).seq, 2);
});
