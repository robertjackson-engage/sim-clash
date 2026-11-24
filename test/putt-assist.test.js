'use strict';
// Arcade putting (lib/putt-assist.js): the solved putt goes in, on the flat and across
// a slope; a poor stroke is pulled toward it; 'off' leaves the stroke alone.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { simulateShot } = require('../lib/physics');
const { solvePutt, assistPutt } = require('../lib/putt-assist');

const green = () => 'green';
const FLAT = { flat: true, h: () => 0, grad: () => ({ dx: 0, dy: 0 }) };
// a green tilted down to the east (+x): a putt north breaks right
const tilt = (s) => ({ h: (x) => -s * x, grad: () => ({ dx: -s, dy: 0 }) });
const from = { x: 0, y: 0 };

function play(launch, aimDeg, terrain, pin, extra = {}) {
  return simulateShot(launch, from, aimDeg, green, { terrain, pin, ...extra });
}
const putt = (speedMph, hla = 0) => ({ speedMph, vla: 0.5, hla, totalSpin: 0, spinAxis: 0 });

test('the solved putt holes out on a flat green, from 2 m to 20 m', () => {
  for (const d of [2, 5, 10, 20]) {
    const pin = { x: 0, y: d };
    const s = solvePutt({ from, pin, surfaceAt: green, terrain: FLAT });
    assert.ok(s.converged, `${d} m converged`);
    assert.ok(Math.abs(s.breakDeg) < 0.3, `${d} m is straight`);
    const sim = play(putt(s.speedMph), s.bearingDeg, FLAT, pin, { putt: true });
    assert.equal(sim.holed, true, `${d} m holed`);
  }
});

test('the solved putt reads the break: aimed up the slope, and it goes in', () => {
  const pin = { x: 0, y: 8 }, terrain = tilt(0.025);
  const s = solvePutt({ from, pin, surfaceAt: green, terrain });
  assert.ok(s.converged);
  assert.ok(s.breakDeg < -2, `aims left of a putt that breaks right (${s.breakDeg.toFixed(1)} deg)`);
  assert.equal(play(putt(s.speedMph), s.bearingDeg, terrain, pin, { putt: true }).holed, true);
  // straight at the cup, at the same pace, misses low
  assert.equal(play(putt(s.speedMph), s.straightDeg, terrain, pin, { putt: true }).holed, false);
});

test('easy: a pushed, overhit putt that misses on its own goes in with the assist', () => {
  const pin = { x: 0, y: 6 }, ctx = { from, pin, surfaceAt: green, terrain: FLAT, aimDeg: 0 };
  const ideal = solvePutt(ctx);
  const stroke = putt(ideal.speedMph * 1.35, 4);
  assert.equal(play(stroke, 0, FLAT, pin).holed, false, 'misses unassisted');
  const a = assistPutt(stroke, ctx, 'easy');
  assert.equal(a.quality.grade, 'good');
  const sim = play(a.launch, ctx.aimDeg, FLAT, pin, a.physics);
  assert.equal(sim.holed, true, 'holed with the assist');
});

test('easy: a terrible stroke still misses, but leaves a tap-in', () => {
  const pin = { x: 0, y: 9 }, ctx = { from, pin, surfaceAt: green, terrain: FLAT, aimDeg: 0 };
  const ideal = solvePutt(ctx);
  const stroke = putt(ideal.speedMph * 0.45, -9);
  const a = assistPutt(stroke, ctx, 'easy');
  assert.equal(a.quality.grade, 'poor');
  const sim = play(a.launch, ctx.aimDeg, FLAT, pin, a.physics);
  const leftM = Math.hypot(sim.end.x - pin.x, sim.end.y - pin.y);
  assert.ok(sim.holed || leftM < 2.5, `left ${leftM.toFixed(2)} m`);
  // unassisted, the same stroke is nowhere
  const raw = play(stroke, 0, FLAT, pin);
  assert.ok(Math.hypot(raw.end.x - pin.x, raw.end.y - pin.y) > 4);
});

test('a pure stroke is called pure, and the assist keeps the aim offset out of it', () => {
  const pin = { x: 3, y: 7 }, aimDeg = 40;   // the game's aim line is well off the cup
  const ctx = { from, pin, surfaceAt: green, terrain: tilt(0.015), aimDeg };
  const ideal = solvePutt(ctx);
  const a = assistPutt(putt(ideal.speedMph, 0.5), ctx, 'easy');
  assert.equal(a.quality.grade, 'pure');
  assert.equal(play(a.launch, aimDeg, ctx.terrain, pin, a.physics).holed, true);
});

test("'off', a missing pin and a ball on the cup are left alone", () => {
  const ctx = { from, pin: { x: 0, y: 5 }, surfaceAt: green, terrain: FLAT, aimDeg: 0 };
  assert.equal(assistPutt(putt(6), ctx, 'off'), null);
  assert.equal(assistPutt(putt(6), { ...ctx, pin: null }, 'easy'), null);
  assert.equal(solvePutt({ ...ctx, pin: { x: 0, y: 0.01 } }), null);
  assert.equal(solvePutt({ ...ctx, pin: { x: 0, y: 200 } }), null);
});

// ---- in a round: the arcade layer's shotMods switch the assist on (lib/game.js) ----
const { Game } = require('../lib/game');
const { modifiersFor } = require('../lib/arcade');

function greenCourse() {
  return {
    name: 'Putt Course', boundary: null, elevation: null,
    surfaces: [{ kind: 'green', poly: [[-20, 380], [20, 380], [20, 420], [-20, 420]] }],
    holes: [{ ref: 1, par: 4, tee: [0, 0], pin: [0, 400], lengthYd: 437, line: [[0, 0], [0, 400]] }],
  };
}
function onTheGreen(assist) {
  const game = new Game();
  game.setCourse(greenCourse());
  game.runtimeReady = true;
  game.ball = { x: 3, y: 393 };   // 7.6 m from the cup, on the green
  game.lie = 'green';
  game.shotMods = assist ? modifiersFor(null, assist) : null;
  return game;
}
// a stroke pushed 4 degrees and hit a third too hard
const STROKE = { Speed: 9.5, VLA: 0.5, HLA: 4, TotalSpin: 0, SpinAxis: 0 };

test('in a round: the same poor putt misses on its own and drops with easy putting', () => {
  const plain = onTheGreen(null).handleShot({ ...STROKE }, null);
  assert.equal(plain.sim.events.some((e) => e.type === 'holed'), false);
  assert.equal(plain.puttAssist, undefined);

  const game = onTheGreen({ putting: 'easy', dispersion: 0.6, tapInFt: 8 });
  const armed = game.shotMods;
  const r = game.handleShot({ ...STROKE }, null);
  assert.equal(r.sim.events.some((e) => e.type === 'holed'), true, 'holed');
  assert.equal(r.holed, true);
  assert.equal(r.puttAssist.level, 'easy');
  assert.ok(['pure', 'good', 'poor'].includes(r.puttAssist.grade));
  assert.equal(game.shotMods, armed, 'the armed mods are put back as they were');
});

test("in a round: a popped-up 'putt' from the green is still a putt, and 'off' is off", () => {
  const game = onTheGreen({ putting: 'easy', dispersion: 0.6, tapInFt: 8 });
  const r = game.handleShot({ Speed: 8, VLA: 9, HLA: 1, TotalSpin: 900, SpinAxis: 0 }, null);
  assert.equal(r.sim.isPutt, true);
  assert.ok(r.puttAssist);
  const off = onTheGreen({ putting: 'off', dispersion: 0.6, tapInFt: 8 }).handleShot({ ...STROKE }, null);
  assert.equal(off.puttAssist, undefined);
});

// ---- v2:playability the levels help a decent putt and do not rescue a bad one ----
// (QA: with 'easy' every putt from 18 to 40 ft dropped, one started 14 degrees off line and
// one struck at 32 mph among them: a putt to win could not be missed.)
const { PUTT_ASSIST_LEVELS } = require('../lib/putt-assist');
const R = require('../tools/arcade-dev/putt-rates.cjs');

test('the windows: easy 4.5 degrees and -20 / +60 % of pace, assist 2.5 degrees and -15 / +40 %', () => {
  const pick = ({ lineDeg, paceLo, paceHi }) => ({ lineDeg, paceLo, paceHi });
  assert.deepEqual(pick(PUTT_ASSIST_LEVELS.easy), { lineDeg: 4.5, paceLo: 0.8, paceHi: 1.6 });
  assert.deepEqual(pick(PUTT_ASSIST_LEVELS.assist), { lineDeg: 2.5, paceLo: 0.85, paceHi: 1.4 });
  assert.equal(PUTT_ASSIST_LEVELS.off, null);
  const inside = { easy: { lines: [-4.3, -2, 0, 3, 4.3], paces: [0.82, 1, 1.3, 1.57] }, assist: { lines: [-2.4, 0, 1.5, 2.4], paces: [0.87, 1, 1.2, 1.38] } };
  for (const terrain of [R.FLAT, R.tilt(0.02)]) {
    for (const level of ['easy', 'assist']) {
      for (const distFt of R.DISTANCES_FT) for (const lineErrDeg of inside[level].lines) for (const paceRatio of inside[level].paces) {
        const r = R.onePutt({ distFt, lineErrDeg, paceRatio, level, terrain });
        assert.equal(r.holed, true, `${level}, ${distFt} ft${terrain === R.FLAT ? '' : ' across a slope'}: ${lineErrDeg} deg off line at ${paceRatio} x the pace drops`);
      }
    }
  }
});

test('outside the window it is a miss that finishes close: steered past the edge, never rescued', () => {
  for (const terrain of [R.FLAT, R.tilt(0.02)]) {
    for (const distFt of [15, 30, 45]) {
      // the line: just outside, and well outside
      for (const [level, lines] of [['easy', [5.5, -7, 10]], ['assist', [3.5, -5, 8]]]) for (const lineErrDeg of lines) {
        if (R.onePutt({ distFt, lineErrDeg, paceRatio: 1, level: 'off', terrain }).holed) continue;   // it drops on its own (a slope can do that): it is left alone
        const r = R.onePutt({ distFt, lineErrDeg, paceRatio: 1, level, terrain });
        assert.equal(r.holed, false, `${level}, ${distFt} ft: ${lineErrDeg} deg off line stays out`);
        assert.ok(r.leftFt >= 0.7 && r.leftFt <= 5, `${level}, ${distFt} ft, ${lineErrDeg} deg: ${r.leftFt.toFixed(1)} ft left`);
      }
      // the pace: short, and long
      for (const [level, paces, maxLeft] of [['easy', [0.7, 1.8], 0.14], ['assist', [0.75, 1.6], 0.3]]) for (const paceRatio of paces) {
        const r = R.onePutt({ distFt, lineErrDeg: 0, paceRatio, level, terrain });
        assert.equal(r.holed, false, `${level}, ${distFt} ft: dead on line at ${paceRatio} x the pace stays out`);
        assert.ok(r.leftFt <= Math.max(3, maxLeft * distFt), `${level}, ${distFt} ft at ${paceRatio} x: ${r.leftFt.toFixed(1)} ft left`);
      }
    }
  }
  // QA's two: started 14 degrees off line, and struck at 32 mph, from 18 to 40 ft, on 'easy'
  for (const distFt of [18, 25, 32, 40]) {
    assert.equal(R.onePutt({ distFt, lineErrDeg: 14, paceRatio: 1, level: 'easy' }).holed, false, `${distFt} ft, 14 degrees off line`);
    const pin = { x: 0, y: distFt * 0.3048 }, ctx = { from, pin, surfaceAt: green, terrain: FLAT, aimDeg: 0 };
    const a = assistPutt(putt(32), ctx, 'easy');
    assert.ok(a.quality.paceRatio > 3 && a.quality.made === false, `${distFt} ft at 32 mph is ${a.quality.paceRatio} x the pace`);
    assert.equal(play(a.launch, 0, FLAT, pin, a.physics).holed, false, `${distFt} ft, struck at 32 mph`);
  }
});

test('a putt struck at three times the right pace never drops, at any level', () => {
  for (const terrain of [R.FLAT, R.tilt(0.02)]) for (const level of R.LEVELS) for (const distFt of R.DISTANCES_FT) for (const lineErrDeg of [0, 1, -3]) {
    const r = R.onePutt({ distFt, lineErrDeg, paceRatio: 3, level, terrain });
    assert.equal(r.holed, false, `${level}, ${distFt} ft, ${lineErrDeg} deg: 3 x the pace`);
  }
});

test('the assist never takes a putt away: what drops on its own drops at every level', () => {
  let own = 0;
  for (const distFt of [4, 6, 10, 15]) for (const lineErrDeg of [-6, -5, -3, 0, 3, 5, 6]) for (const paceRatio of [0.9, 1, 1.2, 1.7, 2]) {
    if (!R.onePutt({ distFt, lineErrDeg, paceRatio, level: 'off' }).holed) continue;
    own++;
    for (const level of ['assist', 'easy']) assert.equal(R.onePutt({ distFt, lineErrDeg, paceRatio, level }).holed, true, `${level}, ${distFt} ft, ${lineErrDeg} deg, ${paceRatio} x`);
  }
  assert.ok(own > 40, `${own} putts that drop unassisted`);
});

test('make rates: a steady putter holes nearly all of them on easy, an average one misses a good share, nobody is carried', () => {
  const n = 160;
  const at = (player, level, distFt) => R.rate({ player, level, distFt, n });
  for (const distFt of R.DISTANCES_FT) {
    const steady = { off: at('steady', 'off', distFt), assist: at('steady', 'assist', distFt), easy: at('steady', 'easy', distFt) };
    const avg = { off: at('average', 'off', distFt), assist: at('average', 'assist', distFt), easy: at('average', 'easy', distFt) };
    const wild = { assist: at('wild', 'assist', distFt), easy: at('wild', 'easy', distFt) };
    assert.ok(steady.easy.made >= 93, `steady, easy, ${distFt} ft: ${steady.easy.made} %`);
    assert.ok(steady.assist.made >= 75 && steady.assist.made <= 99, `steady, assist, ${distFt} ft: ${steady.assist.made} %`);
    assert.ok(avg.easy.made >= 58 && avg.easy.made <= 90, `average, easy, ${distFt} ft: ${avg.easy.made} %`);
    assert.ok(avg.assist.made >= 28 && avg.assist.made <= 80, `average, assist, ${distFt} ft: ${avg.assist.made} %`);
    assert.ok(wild.easy.made <= 60 && wild.assist.made <= 55, `wild, ${distFt} ft: easy ${wild.easy.made} %, assist ${wild.assist.made} %`);
    // more help, more putts: off <= assist <= easy
    assert.ok(avg.off.made <= avg.assist.made + 2 && avg.assist.made <= avg.easy.made, `average, ${distFt} ft: off ${avg.off.made}, assist ${avg.assist.made}, easy ${avg.easy.made}`);
    assert.ok(steady.off.made <= steady.assist.made + 2 && steady.assist.made <= steady.easy.made);
    // and a miss is a tap-in, not a third putt
    assert.ok(avg.easy.three <= 3 && steady.assist.three <= 1, `${distFt} ft: three-putts ${avg.easy.three} % (average, easy), ${steady.assist.three} % (steady, assist)`);
  }
  // from 30 ft a putt to win CAN be missed, on either level
  assert.ok(at('average', 'easy', 30).made < 90 && at('average', 'assist', 30).made < 60);
});

// ---- the match's own putting level (lib/match.js options.putting, lib/arcade.js shotMods) ----
const { createMatch } = require('../lib/match');
const { ArcadeState } = require('../lib/arcade');

test('a match plays its own putting level: assist unless the lobby says otherwise', () => {
  const players = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }];
  const mk = (putting) => { const g = new Game(); g.setCourse(greenCourse()); return createMatch({ game: g, players, options: { format: 'quick', stage: 'current', ...(putting === undefined ? {} : { putting }) } }); };
  assert.deepEqual([mk().putting, mk().state().options.putting, mk().config().options.putting], ['assist', 'assist', 'assist']);
  for (const level of ['easy', 'assist', 'off']) assert.deepEqual([mk(level).putting, mk(level).state().options.putting, mk(level).config().options.putting], [level, level, level]);
  assert.equal(mk('magic').putting, 'assist');
  assert.equal(mk(null).putting, 'assist');
  // the server arms a match swing with it; the bay's own setting (solo play) is left alone
  const bay = new ArcadeState();
  assert.equal(bay.assist.putting, 'easy');
  assert.equal(bay.shotMods(null, { putting: 'assist' }).assist.putting, 'assist');
  assert.equal(bay.shotMods(null, { putting: 'off' }).assist.putting, 'off');
  assert.equal(bay.shotMods(null, { curses: ['fog'] }).assist.putting, 'easy');
  assert.equal(bay.shotMods(null, { putting: 'magic' }).assist.putting, 'easy');
  assert.equal(bay.assist.putting, 'easy');
  // the same 25 ft putt, started 4 degrees off line: in on the bay's easy, a miss in a match
  const four = { Speed: 7.2, VLA: 0.5, HLA: 4, TotalSpin: 0, SpinAxis: 0 };
  const hit = (mods) => { const game = onTheGreen(null); game.shotMods = mods; return game.handleShot({ ...four }, null); };
  const solo = hit(bay.shotMods(null));
  const inMatch = hit(bay.shotMods(null, { putting: 'assist' }));
  assert.deepEqual([solo.puttAssist.level, solo.puttAssist.made, solo.sim.events.some((e) => e.type === 'holed')], ['easy', true, true]);
  assert.deepEqual([inMatch.puttAssist.level, inMatch.puttAssist.made, inMatch.sim.events.some((e) => e.type === 'holed')], ['assist', false, false]);
  assert.ok(inMatch.distToPinYd * 3 < 4, `the miss is ${(inMatch.distToPinYd * 3).toFixed(1)} ft away`);
  assert.equal(hit(bay.shotMods(null, { putting: 'off' })).puttAssist, undefined);
});
