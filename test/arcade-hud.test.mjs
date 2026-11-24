// The arcade HUD's pure parts (public/arcade/arcade.js): when a callout may be shouted,
// which crowd answers it, what the ball dock shows in solo play and in a match, and what
// the shot's sound script asks for. The DOM half is exercised on /arcade/demo.html.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  buildCrowdScript, calloutOf, crowdCueFor, calloutMoment, splitCallout, heatOf, ballName,
  dockModel, challengeDiff, recordOf, wallMsFor,
} from '../public/arcade/arcade.js';

const require = createRequire(import.meta.url);

// a ball path: t seconds, x across, y downrange (metres)
const path = (dur, n = 40, yEnd = 100) => Array.from({ length: n + 1 }, (_, i) => ({ t: +(dur * i / n).toFixed(3), x: 0, y: yEnd * i / n, z: 0 }));
const shotOf = ({ dur = 8, flightTime = 5, events = [], holed = false, lie = 'fairway', isPutt = false, yEnd = 100, carryYd = 150 } = {}) => ({
  shotId: 1, holed, lie, sim: { points: path(dur, 40, yEnd), flightTime, events, isPutt, carryYd },
});
const co = (id, tone = 'good', text = 'X!') => ({ id, text, tone, voice: id });

const CAT = [
  ...['rocket', 'sticky', 'magnet', 'windcutter', 'laser', 'moonball', 'bouncy', 'fireball', 'ghost', 'skipper', 'yoyo', 'homing', 'titan', 'feather', 'gold']
    .map((id) => ({ id, kind: 'ball', name: id, emoji: '*', rarity: 'common', color: '#fff', tagline: '' })),
  ...['gust', 'tiny-cup', 'fog'].map((id) => ({ id, kind: 'trick', name: id, emoji: '!', rarity: 'rare', color: '#f00', tagline: '' })),
];
const matchOf = (over = {}, p1 = {}, p2 = {}) => ({
  id: 'm', seq: 1, phase: 'play', currentPlayerId: 'a', options: { powerups: 'loadout' },
  players: [
    { id: 'a', name: 'Alex', slot: 1, charges: 3, usedPowerups: [], armedPowerup: null, cursedWith: null, ...p1 },
    { id: 'b', name: 'Sarah', slot: 2, charges: 3, usedPowerups: [], armedPowerup: null, cursedWith: null, ...p2 },
  ],
  ...over,
});
const ids = (items) => items.map((it) => it.pu.id);

// ---------------------------------------------------------------- callouts
test('calloutOf: a checked callout, or null; an unknown tone reads as neutral', () => {
  assert.equal(calloutOf(null), null);
  assert.equal(calloutOf({ callout: null }), null);
  assert.equal(calloutOf({ callout: { id: 'x', text: '   ' } }), null);
  assert.deepEqual(calloutOf({ callout: { id: 'slice-house', text: 'SLICE HOUSE!', tone: 'funny', voice: 'slice-house' } }),
    { id: 'slice-house', text: 'SLICE HOUSE!', tone: 'funny', voice: 'slice-house' });
  assert.equal(calloutOf({ callout: { id: 'new-one', text: 'WOW', tone: 'sparkly' } }).tone, 'neutral');
  assert.equal(calloutOf({ callout: { id: 'bomb', text: 'ABSOLUTE BOMB!', tone: 'epic' } }).voice, 'bomb');   // voice id = callout id
});

test('every callout the server can send is understood (lib/arcade.js CALLOUTS)', () => {
  const { CALLOUTS } = require('../lib/arcade.js');
  if (!CALLOUTS) return;   // an arcade-core without callouts yet
  for (const [id, c] of Object.entries(CALLOUTS)) {
    const got = calloutOf({ callout: { id, text: c.text, tone: c.tone, voice: id } });
    assert.equal(got.id, id);
    assert.equal(got.tone, c.tone, `${id}: tone ${c.tone} is one the banner styles`);
    assert.ok(splitCallout(c.text).every((line) => line.length <= 16), `${id}: "${c.text}" fits the banner`);
  }
});

test('crowdCueFor: the contract mapping, near misses first, one cue only', () => {
  assert.equal(crowdCueFor(co('hole-in-one', 'epic')), 'crowd-roar');
  assert.equal(crowdCueFor(co('dart', 'good'), () => 0.1), 'crowd-cheer');
  assert.equal(crowdCueFor(co('dart', 'good'), () => 0.9), 'applause');
  assert.equal(crowdCueFor(co('terrible', 'bad')), 'crowd-aww');
  assert.equal(crowdCueFor(co('slice-house', 'funny')), 'crowd-laugh');
  assert.equal(crowdCueFor(co('robbed', 'neutral')), 'crowd-ohh');
  assert.equal(crowdCueFor(co('so-close', 'neutral')), 'crowd-ohh');
  assert.equal(crowdCueFor(co('whatever', 'neutral')), null);
  assert.equal(crowdCueFor(null), null);
});

test('calloutMoment: never before the ball gets there', () => {
  // a slice is called when the ball has stopped
  const plain = shotOf({ dur: 9, flightTime: 6 });
  const meta = buildCrowdScript(plain, [0, 150]).meta;
  assert.deepEqual(calloutMoment(co('slice-house', 'funny'), plain, meta), { t: 9, kind: 'stop' });
  assert.deepEqual(calloutMoment(null, plain, meta), { t: 9, kind: 'stop' });

  // a holed ball: as it drops (the holed event has no t of its own: the nearest path point)
  const holed = shotOf({ dur: 8, flightTime: 5, holed: true, events: [{ type: 'holed', x: 0, y: 100 }] });
  const hm = buildCrowdScript(holed, [0, 100]).meta;
  assert.equal(hm.holedT, 8);
  assert.deepEqual(calloutMoment(co('holed-out', 'epic'), holed, hm), { t: 8, kind: 'holed' });

  // water: as it splashes, before the path ends
  const wet = shotOf({ dur: 6.5, flightTime: 6, lie: 'water', events: [{ type: 'water', x: 0, y: 100 * 6 / 6.5 }] });
  const wm = buildCrowdScript(wet, [0, 150]).meta;
  const w = calloutMoment(co('splash', 'bad'), wet, wm);
  assert.equal(w.kind, 'water');
  assert.ok(Math.abs(w.t - 6) < 0.2 && w.t < 6.5);
  assert.equal(calloutMoment(co('lava', 'funny'), wet, wm).kind, 'water');

  // a tree: at the trunk when the ball is nearly done, at the stop when it has a long way to roll
  const tree = (t, dur) => shotOf({ dur, flightTime: t, events: [{ type: 'tree', t, x: 0, y: 30 }] });
  assert.deepEqual(calloutMoment(co('timber', 'funny'), tree(3, 5), buildCrowdScript(tree(3, 5), null).meta), { t: 3, kind: 'tree' });
  assert.deepEqual(calloutMoment(co('timber', 'funny'), tree(2, 9), buildCrowdScript(tree(2, 9), null).meta), { t: 9, kind: 'stop' });

  // a rocket-type ball is announced as it leaves
  assert.deepEqual(calloutMoment(co('blast-off'), plain, meta), { t: 0.35, kind: 'launch' });
});

test('calloutMoment: a lip-out is called as the ball burns the edge', () => {
  // a putt that passes 0.3 yd from the cup at t=3 and stops a yard past it at t=4.6
  const pts = Array.from({ length: 47 }, (_, i) => { const t = i / 10; return { t, x: 0.27, y: Math.min(11, 10 * t / 3), z: 0 }; });
  const shot = { shotId: 2, holed: false, lie: 'green', sim: { points: pts, flightTime: 0, events: [], isPutt: true } };
  const meta = buildCrowdScript(shot, [0, 10]).meta;
  assert.ok(meta.minDistYd < 1);
  const m = calloutMoment(co('robbed', 'neutral'), shot, meta);
  assert.equal(m.kind, 'lip');
  assert.ok(m.t > meta.tMin && m.t < meta.dur);
});

test('splitCallout: long callouts take two balanced lines', () => {
  assert.deepEqual(splitCallout('NICE SHOT!'), ['NICE SHOT!']);
  assert.deepEqual(splitCallout('SHANK-A-POTAMUS!'), ['SHANK-A-POTAMUS!']);   // no space to break at
  assert.deepEqual(splitCallout('ON THE DANCE FLOOR!'), ['ON THE', 'DANCE FLOOR!']);
  assert.deepEqual(splitCallout("YOU'RE ON FIRE!"), ["YOU'RE", 'ON FIRE!']);
});

// ---------------------------------------------------------------- the sound script
test('the sound script: each landing sounds like what it hit, three at most, nothing repeats', () => {
  const s = shotOf({
    dur: 12, flightTime: 5,
    events: [
      { type: 'bounce', t: 5, x: 0, y: 60, surface: 'green' }, { type: 'bounce', t: 5.6, x: 0, y: 66, surface: 'green' },
      { type: 'bounce', t: 6.1, x: 0, y: 70, surface: 'fairway' }, { type: 'bounce', t: 6.6, x: 0, y: 72, surface: 'fairway' },
    ],
  });
  s.sim.slowmo = [{ t0: 7, t1: 11.5, rate: 0.3, reason: 'close' }];
  const { items } = buildCrowdScript(s, [0, 100]);
  const cues = items.filter((it) => it.kind === 'cue').map((it) => it.cue);
  assert.deepEqual(cues.filter((c) => /thump|bounce|thud|skid/.test(c)), ['green-thump', 'green-thump', 'fairway-bounce']);
  assert.ok(cues.filter((c) => c === 'oooh').length <= 1, 'the oooh is not renewed on a clock inside a slow-motion window');
  const sand = buildCrowdScript(shotOf({ events: [{ type: 'bounce', t: 5, x: 0, y: 60, surface: 'bunker' }] }), null).items;
  assert.ok(sand.some((it) => it.cue === 'sand-thud'));
});

test('the sound script: a holed ball drops into the cup, a tree knocks, water splashes', () => {
  const holed = buildCrowdScript(shotOf({ holed: true, events: [{ type: 'holed', x: 0, y: 100 }] }), [0, 100]);
  const at = (items, cue) => items.find((it) => it.cue === cue);
  assert.equal(at(holed.items, 'cup-drop').t, holed.meta.holedT);
  assert.ok(at(holed.items, 'roar'));
  const tree = buildCrowdScript(shotOf({ events: [{ type: 'tree', t: 2, x: 0, y: 30 }] }), null);
  assert.equal(at(tree.items, 'tree-knock').t, 2);
  const wet = buildCrowdScript(shotOf({ lie: 'water', events: [{ type: 'water', t: 5, x: 0, y: 60 }] }), null);
  assert.equal(at(wet.items, 'splash').t, 5);
  assert.equal(wet.items.at(-1).kind, 'stop');
});

test('wallMsFor mirrors the scene: a path over 14 s is played in 14', () => {
  assert.equal(wallMsFor(shotOf({ dur: 7 }))(7), 7000);
  assert.equal(Math.round(wallMsFor(shotOf({ dur: 28 }))(28)), 14000);
});

// ---------------------------------------------------------------- the combo meter
test('heatOf: warm at 2, ON FIRE at 3, UNSTOPPABLE at 5', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map((n) => heatOf(n).state), ['cold', 'cold', 'warm', 'fire', 'fire', 'inferno', 'inferno']);
  assert.equal(heatOf(3).label, 'ON FIRE');
  assert.equal(heatOf(5).label, 'UNSTOPPABLE');
  assert.equal(heatOf(9).level, 5);
  assert.equal(heatOf(-2).streak, 0);
  assert.equal(heatOf(undefined).state, 'cold');
});

// ---------------------------------------------------------------- the dock
test('ballName: what the announcer shouts', () => {
  assert.equal(ballName({ id: 'rocket', name: 'Rocket' }), 'ROCKET BALL');
  assert.equal(ballName({ id: 'windcutter', name: 'Windcutter' }), 'WIND CUTTER');
  assert.equal(ballName({ id: 'gold', name: 'Gold' }), 'GOLDEN BALL');
  assert.equal(ballName({ id: 'gust', name: 'Gust', kind: 'trick' }), 'GUST');
  assert.equal(ballName({ id: 'sparkle', name: 'Sparkle', kind: 'ball' }), 'SPARKLE BALL');
  assert.equal(ballName({ id: 'meteor', name: 'Meteor Ball', kind: 'ball' }), 'METEOR BALL');
});

test('dock, solo: the bay inventory on keys 1 to 9, tricks never armed on your own ball', () => {
  const m = dockModel({ inventory: { rocket: 2, laser: 1, gold: 3 }, armed: 'laser' }, CAT, null);
  assert.equal(m.mode, 'solo');
  assert.equal(m.inMatch, false);
  assert.deepEqual(ids(m.bar), ['rocket', 'laser', 'gold']);
  assert.deepEqual(m.bar.map((it) => it.state), ['ready', 'armed', 'ready']);
  assert.deepEqual(m.bar.map((it) => it.count), [2, 1, 3]);
  assert.deepEqual(m.keys.get('gold'), { label: '3', digit: 3, shift: false });
  assert.equal(m.balls.find((it) => it.pu.id === 'sticky').state, 'empty');
  assert.ok(m.tricks.every((it) => it.state === 'locked'));
  assert.ok(!m.keys.has('gust'));
});

test('dock, solo unlimited: every ball, infinity, the rest on shift + 1 to 9', () => {
  const m = dockModel({ inventory: {}, armed: 'gold', unlimited: true }, CAT, null);
  assert.equal(m.bar.length, 9);
  assert.ok(m.balls.every((it) => it.count === Infinity));
  assert.ok(ids(m.bar).includes('gold'), 'the armed ball is always on the bar');
  assert.equal(m.keys.get('rocket').label, '1');
  const rest = m.rest.filter((it) => it.pu.kind !== 'trick');
  assert.equal(rest.length, 6);
  assert.deepEqual(m.keys.get(rest[0].pu.id), { label: '⇧1', digit: 1, shift: true });
});

test('dock, match: the loadout of whoever is up, minus what they have used, tricks aimed at the opponent', () => {
  const m = dockModel({ inventory: { rocket: 9 } }, CAT, matchOf({}, { charges: 2, usedPowerups: ['rocket', 'gust'], armedPowerup: 'laser' }, { cursedWith: 'gust' }));
  assert.equal(m.mode, 'match');
  assert.equal(m.playerId, 'a'); assert.equal(m.playerName, 'Alex'); assert.equal(m.slot, 1);
  assert.equal(m.oppName, 'Sarah'); assert.equal(m.oppCursedWith, 'gust');
  assert.equal(m.charges, 2);
  assert.equal(m.armedId, 'laser');
  assert.equal(m.balls.find((it) => it.pu.id === 'rocket').state, 'used');
  assert.ok(m.balls.every((it) => it.count === null), 'the bay inventory is not the match loadout');
  const barBalls = m.bar.filter((it) => it.pu.kind !== 'trick'), barTricks = m.bar.filter((it) => it.pu.kind === 'trick');
  assert.equal(barBalls.length, 6);
  assert.ok(!ids(barBalls).includes('rocket'), 'a used ball leaves the bar');
  assert.ok(ids(barBalls).includes('laser'));
  assert.deepEqual(ids(barTricks), ['gust', 'tiny-cup', 'fog']);
  assert.deepEqual(barTricks.map((it) => it.state), ['used', 'locked', 'locked'], 'Sarah already carries the gust: one curse at a time');
  assert.equal(m.keys.get('tiny-cup').label, '8');
});

test('dock, match: the second player, a curse waiting, no charges, unlimited, off', () => {
  const p2 = dockModel({}, CAT, matchOf({ currentPlayerId: 'b' }, {}, { cursedWith: 'fog', charges: 0 }));
  assert.equal(p2.slot, 2); assert.equal(p2.playerName, 'Sarah'); assert.equal(p2.oppName, 'Alex');
  assert.equal(p2.cursedWith, 'fog');
  assert.ok([...p2.balls, ...p2.tricks].every((it) => it.state === 'locked'), 'no charges: nothing to arm');
  assert.equal(p2.bar.filter((it) => it.pu.kind !== 'trick').length, 0);

  const last = dockModel({}, CAT, matchOf({}, { charges: 0, armedPowerup: 'rocket', usedPowerups: ['rocket'] }));
  assert.equal(last.balls.find((it) => it.pu.id === 'rocket').state, 'armed');
  assert.equal(last.balls.find((it) => it.pu.id === 'sticky').state, 'ready', 'an armed ball can still be swapped: the server decides');

  const unl = dockModel({}, CAT, matchOf({ options: { powerups: 'unlimited' } }, { charges: 0, usedPowerups: ['rocket'] }));
  assert.equal(unl.charges, Infinity);
  assert.equal(unl.balls.find((it) => it.pu.id === 'rocket').state, 'ready');

  assert.equal(dockModel({}, CAT, matchOf({ options: { powerups: 'off' } })).mode, 'hidden');
});

test('dock, match (docs/match.md): charges null is unlimited; one curse on a player at a time', () => {
  const unl = dockModel({}, CAT, matchOf({ options: { powerups: 'unlimited' } }, { charges: null, usedPowerups: [] }));
  assert.equal(unl.unlimited, true);
  assert.equal(unl.charges, Infinity);
  assert.ok(unl.balls.every((it) => it.state === 'ready'));

  const cursed = dockModel({}, CAT, matchOf({}, { charges: 2, usedPowerups: ['gust'] }, { cursedWith: 'gust' }));
  assert.deepEqual(cursed.tricks.map((it) => it.state), ['used', 'locked', 'locked'], 'the opponent already carries a curse');
  assert.equal(cursed.balls.find((it) => it.pu.id === 'rocket').state, 'ready');
  assert.ok(!cursed.keys.has('fog') || cursed.keys.get('fog').digit === 9, 'a locked trick keeps its slot on the bar');
});

test('dock, match: a rocket hole gives the tee shot a free ball and keeps their own for later', () => {
  const tee = dockModel({}, CAT, matchOf({ stage: { id: 'sky-high', freeBall: 'rocket' } }, { strokes: 0, charges: 2, armedPowerup: 'laser' }));
  assert.equal(tee.freeId, 'rocket');
  assert.equal(tee.armedId, 'rocket');
  assert.equal(tee.heldId, 'laser');
  assert.equal(tee.balls.find((it) => it.pu.id === 'rocket').state, 'armed');
  assert.ok(tee.balls.filter((it) => it.pu.id !== 'rocket').every((it) => it.state === 'locked'), 'no charge is spent on a ball that would only be held');
  assert.deepEqual(tee.tricks.map((it) => it.state), ['ready', 'ready', 'ready'], 'a trick can still be cast');
  assert.deepEqual(ids(tee.bar.filter((it) => it.pu.kind !== 'trick')), ['rocket']);

  const second = dockModel({}, CAT, matchOf({ stage: { id: 'sky-high', freeBall: 'rocket' } }, { strokes: 1, charges: 2, armedPowerup: 'laser' }));
  assert.equal(second.freeId, null);
  assert.equal(second.armedId, 'laser');
  assert.equal(second.balls.find((it) => it.pu.id === 'rocket').state, 'ready');
  assert.equal(dockModel({}, CAT, matchOf({ stage: { id: 'x', freeBall: 'gust' } }, { strokes: 0 })).freeId, null, 'a trick is never a free ball');
});

test('dock, solo: a rocket hole leads with the free ball before the tee shot, the bay keeps its own', () => {
  const tee = dockModel({ inventory: { laser: 2, rocket: 1 }, armed: 'laser' }, CAT, null, { freeBall: 'rocket' });
  assert.equal(tee.mode, 'solo');
  assert.deepEqual([tee.freeId, tee.armedId, tee.heldId], ['rocket', 'rocket', 'laser']);
  assert.equal(tee.balls.find((it) => it.pu.id === 'rocket').state, 'armed');
  assert.ok(tee.balls.filter((it) => it.pu.id !== 'rocket').every((it) => it.state === 'locked'), 'nothing else can ride on the free shot');
  assert.deepEqual(ids(tee.bar), ['rocket']);
  // the free ball does not have to be owned; nothing armed: nothing held
  const bare = dockModel({ inventory: {} }, CAT, null, { freeBall: 'rocket' });
  assert.deepEqual([bare.freeId, bare.armedId, bare.heldId], ['rocket', 'rocket', null]);
  // after the tee shot (app.js passes null), with the arcade off, or for a trick: the plain shelf
  const second = dockModel({ inventory: { laser: 2 }, armed: 'laser' }, CAT, null, { freeBall: null });
  assert.deepEqual([second.freeId, second.armedId], [null, 'laser']);
  assert.equal(dockModel({ inventory: {}, enabled: false }, CAT, null, { freeBall: 'rocket' }).freeId, null);
  assert.equal(dockModel({ inventory: {} }, CAT, null, { freeBall: 'gust' }).freeId, null, 'a trick is never a free ball');
  // a match ignores the solo hint: its own stage decides
  assert.equal(dockModel({}, CAT, matchOf({}, { strokes: 0 }), { freeBall: 'rocket' }).freeId, null);
});

test('dock, match: nobody arms between holes; an aborted match is solo play again', () => {
  for (const phase of ['loading', 'intro', 'hole-result', 'done']) {
    const m = dockModel({ inventory: { rocket: 1 } }, CAT, matchOf({ phase, currentPlayerId: phase === 'intro' ? 'a' : null }));
    assert.equal(m.mode, 'hidden', phase);
    assert.equal(m.inMatch, true, phase);
  }
  assert.equal(dockModel({}, CAT, matchOf({ phase: 'tiebreak' })).mode, 'match');
  assert.equal(dockModel({ inventory: { rocket: 1 } }, CAT, matchOf({ aborted: true })).mode, 'solo');
  assert.equal(dockModel({ inventory: { rocket: 1 } }, CAT, null).inMatch, false);
});

// ---------------------------------------------------------------- challenges, records
test('challengeDiff: what has just been completed, what is new', () => {
  const a = [{ id: 'x', progress: 1, goal: 3, done: false }, { id: 'y', progress: 0, goal: 1, done: false }];
  const b = [{ id: 'x', progress: 3, goal: 3, done: true }, { id: 'z', progress: 0, goal: 2, done: false }];
  assert.deepEqual(challengeDiff(a, b), { completed: ['x'], fresh: ['z'] });
  assert.deepEqual(challengeDiff(undefined, b), { completed: [], fresh: [] }, 'the first snapshot pops nothing');
  assert.deepEqual(challengeDiff(b, b), { completed: [], fresh: [] });
});

test('recordOf: only what the server sent', () => {
  assert.equal(recordOf({ grade: 'PERFECT' }), null);
  assert.deepEqual(recordOf({ record: { id: 'closest-today', label: 'Closest today', value: '2.4 ft' } }), { label: 'CLOSEST TODAY', value: '2.4 ft' });
  assert.deepEqual(recordOf({ records: [{ kind: 'longest_drive' }] }), { label: 'LONGEST DRIVE', value: '' });
  assert.deepEqual(recordOf({ record: 'Longest drive' }), { label: 'LONGEST DRIVE', value: '' });
});
