'use strict';
// The arcade layer (lib/arcade.js): power-up balls and the physics scales they ride on
// (lib/physics.js), how the Game plays a modified shot, shot grading, and the coins /
// xp / streak / inventory economy with its arcade.json.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { simulateShot, YD } = require('../lib/physics');
const { Game, CLUB_FULL } = require('../lib/game');
const A = require('../lib/arcade');

const fairway = () => 'fairway';
const green = () => 'green';
const preset = (k, extra = {}) => ({ speedMph: CLUB_FULL[k].speedMph, vla: CLUB_FULL[k].vla, hla: 0, totalSpin: CLUB_FULL[k].spin, spinAxis: 0, ...extra });
const DRIVE = { speedMph: 150, vla: 12, hla: 0, totalSpin: 2600, spinAxis: 0 };
const PUTT = { speedMph: 6, vla: 0, hla: 0, totalSpin: 0, spinAxis: 0 };
const fly = (launch, opts = {}, surf = fairway) => simulateShot(launch, { x: 0, y: 0 }, 0, surf, opts);
// a shot with a power-up, the way the Game plays one
const flyWith = (id, launch, opts = {}, surf = fairway) => {
  const m = A.modifiersFor(id);
  return fly(m.launch(launch), { ...opts, ...m.physics }, surf);
};
const ball = (speed, vla, extra = {}) => ({ Speed: speed, VLA: vla, HLA: 0, TotalSpin: 2600, SpinAxis: 0, ...extra });

// A 437 yd par 4 running north: a 60 m fairway, the green round the pin, a pond to the
// right of the fairway. Everything else is rough.
function course() {
  return {
    name: 'Arcade Links', boundary: null, elevation: null,
    surfaces: [
      { kind: 'fairway', poly: [[-30, -5], [30, -5], [30, 420], [-30, 420]] },
      { kind: 'green', poly: [[-15, 380], [15, 380], [15, 415], [-15, 415]] },
      { kind: 'water', poly: [[40, 100], [140, 100], [140, 300], [40, 300]] },
    ],
    holes: [{ ref: 1, par: 4, tee: [0, 0], pin: [0, 400], lengthYd: 437, line: [[0, 0], [0, 400]] }],
  };
}
// a round on it with the ball dropped at (x, y), `strokes` already played, no gimmes
function roundAt(x, y, lie, { strokes = 1, gimmeFt = 0 } = {}) {
  const g = new Game();
  g.setCourse(course());
  g.settings = { ...g.settings, gimmeFt };
  g.ball = { x, y };
  g.lie = lie;
  g.strokes = strokes;
  return g;
}
// play a ball and grade it as the server does
function played(g, b, club, extra = {}) {
  const before = g.state();
  const result = g.handleShot(b, club);
  return { before, result, grade: A.gradeShot({ result, before, practice: before.practice || null, ...extra }) };
}
const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-arcade-'));
const quiet = { warn() {} };

// ---------- physics scales ----------

test('arcade scales default to 1 and at 1 the shot is the same shot to the last bit', () => {
  const ones = { dragScale: 1, liftScale: 1, windScale: 1, bounceScale: 1, keepScale: 1, rollScale: 1, cupRadiusScale: 1, cupMaxSpeedScale: 1 };
  const junk = { dragScale: NaN, liftScale: undefined, windScale: null, bounceScale: 'big', keepScale: -1, rollScale: Infinity };
  const wind = { speedMps: 6, fromDeg: 300, gustMps: 2 };
  const shots = [
    [DRIVE, fairway], [preset('DR'), fairway], [preset('I7', { hla: -2, spinAxis: -7 }), fairway],
    [preset('PW'), green], [preset('SW', { hla: 3, spinAxis: 9 }), green], [PUTT, green],
  ];
  for (const [launch, surf] of shots) {
    for (const opts of [{}, { pin: { x: 0, y: 5 } }, { wind, firmness: 0.8, greenStimp: 12 }]) {
      const plain = fly(launch, opts, surf);
      assert.deepEqual(fly(launch, { ...opts, ...ones }, surf), plain);
      assert.deepEqual(fly(launch, { ...opts, ...junk }, surf), plain, 'a scale that is no number is no scale');
    }
  }
});

test('default physics is the physics from before the arcade scales existed', () => {
  // [carryYd, totalYd, offlineYd, apexFt, flightTime, end.x, end.y, points] from
  // lib/physics.js as it stood before the scales were added (compared there bit for bit;
  // pinned here to 1e-9 so another Node's last digit is not a failure)
  const before = {
    DR: [251.641203344421, 273.1440077998168, 0, 94.06838975519975, 6.4879999999995075, 0, 249.7628807321525, 475],
    I7: [149.40457720254656, 160.65952472883413, -15.7653154473852, 87.76493941380556, 5.745999999999589, -14.415804445089027, 146.19805616162148, 414],
    PW: [115.87939633159087, 114.36024533938107, 0, 73.5127470420787, 4.965999999999675, 0, 104.57100833833005, 318],
    PUTT: [6.551479790026003, 6.551479790026003, 0.057171720954543134, 0, 4.3899999999997386, 0.05227782164083424, 5.990445013523816, 221],
  };
  const now = {
    DR: fly(preset('DR')),
    I7: fly(preset('I7', { hla: -2, spinAxis: -7 })),
    PW: fly(preset('PW'), {}, green),
    PUTT: fly({ ...PUTT, hla: 0.5 }, { pin: { x: 0, y: 30 } }, green),
  };
  for (const [name, want] of Object.entries(before)) {
    const r = now[name];
    const got = [r.carryYd, r.totalYd, r.offlineYd, r.apexFt, r.flightTime, r.end.x, r.end.y];
    got.forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1e-9, `${name}[${i}]: ${v} vs ${want[i]}`));
    assert.equal(r.points.length, want[7], `${name}: path samples`);
  }
});

// ---------- power-ups ----------

test('the catalogue: fifteen balls and three tricks in order, each with a face; modifiers for none are no-ops', () => {
  assert.ok(Array.isArray(A.POWERUPS));
  assert.deepEqual(A.POWERUPS.map((p) => p.id), [
    'rocket', 'sticky', 'magnet', 'windcutter', 'laser', 'moonball', 'bouncy',                 // the first seven, as they were
    'fireball', 'ghost', 'skipper', 'yoyo', 'homing', 'titan', 'feather', 'gold',              // the new balls
    'gust', 'tiny-cup', 'fog',                                                                // the tricks
  ]);
  assert.deepEqual(A.POWERUPS.filter((p) => p.kind === 'trick').map((p) => p.id), ['gust', 'tiny-cup', 'fog']);
  for (const p of A.POWERUPS) {
    assert.ok(p.name && p.tagline && p.emoji, p.id);
    assert.ok(['common', 'rare', 'epic'].includes(p.rarity), p.id);
    assert.ok(p.kind === 'ball' || p.kind === 'trick', p.id);
    assert.ok(Number.isInteger(p.color) && p.color >= 0 && p.color <= 0xffffff, `${p.id}: a hex colour for the trail`);
    const m = A.modifiersFor(p.id);
    assert.equal(m.id, p.kind === 'ball' ? p.id : null, `${p.id}: a trick is never your own ball`);
    assert.equal(typeof m.launch, 'function');
    assert.equal(typeof m.post, 'function');
    assert.equal(typeof m.physics, 'object');
  }
  assert.equal(new Set(A.POWERUPS.map((p) => p.color)).size, A.POWERUPS.length, 'every trail its own colour');
  assert.deepEqual(A.catalogue().map((p) => Object.keys(p)), A.POWERUPS.map(() => ['id', 'name', 'emoji', 'rarity', 'tagline', 'kind', 'color']));
  for (const none of [null, undefined, '', 'banana', 'gust', 'fog']) {
    const m = A.modifiersFor(none);
    assert.equal(m.id, null);
    assert.equal(m.launch(DRIVE), DRIVE);
    assert.deepEqual(m.physics, {});
    assert.equal(m.post({}), undefined);
    assert.equal(m.gimmeFt, null);
    assert.deepEqual(fly(m.launch(DRIVE), m.physics), fly(DRIVE));
  }
});

test('rocket: a normal 150 mph drive flies about 500 yards', () => {
  const plain = fly(DRIVE);
  const rocket = flyWith('rocket', DRIVE);
  assert.ok(rocket.totalYd >= 450 && rocket.totalYd <= 550, `rocket drive ${rocket.totalYd.toFixed(1)} yd`);
  assert.ok(rocket.carryYd > plain.carryYd * 1.8, `carry ${rocket.carryYd.toFixed(1)} vs ${plain.carryYd.toFixed(1)}`);
  assert.ok(Math.abs(rocket.offlineYd) < 1e-9, 'still dead straight');
  // a harder swing still goes farther, a 7-iron is still a 7-iron (just a huge one)
  assert.ok(flyWith('rocket', { ...DRIVE, speedMph: 165 }).totalYd > rocket.totalYd);
  const iron = flyWith('rocket', preset('I7'));
  assert.ok(iron.totalYd > fly(preset('I7')).totalYd * 1.4 && iron.totalYd < rocket.totalYd);
});

test('sticky: lands and stops within 3 yd of its carry', () => {
  for (const k of ['DR', 'I7', 'PW']) {
    const plain = fly(preset(k));
    const sticky = flyWith('sticky', preset(k));
    assert.equal(sticky.carryYd, plain.carryYd, `${k}: the flight is untouched`);
    assert.ok(Math.abs(sticky.totalYd - sticky.carryYd) < 3, `${k}: carry ${sticky.carryYd.toFixed(1)}, total ${sticky.totalYd.toFixed(1)}`);
  }
  assert.ok(fly(preset('DR')).totalYd - fly(preset('DR')).carryYd > 15, 'a plain drive runs');
});

test('magnet: a putt missing by 2 m drops, and so does a chip that stops 2 m away', () => {
  const pin = { x: 0, y: 10 };
  const wide = { ...PUTT, speedMph: 8, hla: Math.atan2(2, 10) * 180 / Math.PI };   // passes 2 m right of the cup
  assert.equal(fly(wide, { pin }, green).holed, false);
  const sucked = flyWith('magnet', wide, { pin }, green);
  assert.equal(sucked.holed, true);
  assert.deepEqual(sucked.end, pin);
  assert.equal(flyWith('magnet', { ...wide, hla: 30 }, { pin }, green).holed, false, '5 m wide is still a miss');
  const chip = { speedMph: 60, vla: 30, hla: 0, totalSpin: 7000, spinAxis: 0 };
  const beside = { x: 2, y: fly(chip, {}, green).end.y };
  assert.equal(fly(chip, { pin: beside }, green).holed, false);
  assert.equal(flyWith('magnet', chip, { pin: beside }, green).holed, true);
});

test('windcutter, laser, moonball and bouncy do what they say', () => {
  const wind = { speedMps: 8, fromDeg: 270, gustMps: 0 };   // from the left of a north shot
  const blown = fly(DRIVE, { wind });
  const cut = flyWith('windcutter', DRIVE, { wind });
  assert.ok(blown.offlineYd > 20, `the wind moves a plain ball ${blown.offlineYd.toFixed(1)} yd`);
  assert.equal(cut.offlineYd, fly(DRIVE).offlineYd);
  assert.equal(cut.carryYd, fly(DRIVE).carryYd);
  assert.equal(cut.windMps, blown.windMps, "the wind reported is still the day's");

  const slice = { ...DRIVE, hla: 6, spinAxis: 15 };
  const laser = flyWith('laser', slice);
  assert.ok(Math.abs(fly(slice).offlineYd) > 30);
  assert.ok(Math.abs(laser.offlineYd) < Math.abs(fly(slice).offlineYd) * 0.2, `laser ${laser.offlineYd.toFixed(1)} yd offline`);

  const moon = flyWith('moonball', DRIVE);
  assert.ok(moon.apexFt > fly(DRIVE).apexFt * 2.5, `apex ${moon.apexFt.toFixed(0)} ft`);

  const bouncy = flyWith('bouncy', DRIVE);
  assert.equal(bouncy.carryYd, fly(DRIVE).carryYd);
  assert.ok(bouncy.totalYd > fly(DRIVE).totalYd + 20, `bouncy ${bouncy.totalYd.toFixed(1)} vs ${fly(DRIVE).totalYd.toFixed(1)}`);
  assert.ok(bouncy.events.filter((e) => e.type === 'bounce').length > fly(DRIVE).events.filter((e) => e.type === 'bounce').length);
});

// ---------- the game plays a modified shot ----------

test('Game.shotMods: null changes nothing; a power-up changes the launch after validation and the physics', () => {
  const plain = new Game();
  plain.setCourse(course());
  const noop = new Game();
  noop.setCourse(course());
  assert.equal(plain.shotMods, null);
  noop.shotMods = A.modifiersFor(null);
  assert.deepEqual(noop.handleShot(ball(150, 12), 'DR'), plain.handleShot(ball(150, 12), 'DR'));

  // 180 mph x 1.5 = 270: over launchFromBall's 250 cap, legitimately
  const g = new Game();
  g.setCourse(course());
  g.shotMods = A.modifiersFor('rocket');
  const r = g.handleShot(ball(180, 12), 'DR');
  assert.equal(r.launch.speedMph, 270);
  assert.ok(r.sim.carryYd > 400, `rocket carry ${r.sim.carryYd}`);
  assert.equal(g.handleShot(ball(260, 12)), null, 'the monitor still cannot send 260 mph');

  // practice plays them too
  g.shotMods = A.modifiersFor('rocket');
  g.startPractice('range');
  const range = g.handleShot(ball(150, 12), 'DR');
  assert.ok(range.practice && range.sim.carryYd > 450, `range rocket ${range.sim.carryYd}`);
  g.shotMods = null;
  assert.ok(g.handleShot(ball(150, 12), 'DR').sim.carryYd < 260);

  // post() sees the finished sim
  const seen = [];
  const h = new Game();
  h.setCourse(course());
  h.shotMods = { launch: (l) => l, physics: {}, post: (sim) => seen.push(sim.carryYd) };
  const shot = h.handleShot(ball(150, 12));
  assert.equal(seen.length, 1);
  assert.equal(+seen[0].toFixed(1), shot.sim.carryYd);
});

test('assists: dispersion straightens every shot but a putt; tap-ins replace the gimme', () => {
  assert.deepEqual(A.ASSIST_DEFAULTS, { putting: 'easy', dispersion: 0.6, tapInFt: 8 });
  const mods = A.modifiersFor(null, { dispersion: 0.5, tapInFt: 8 });
  assert.equal(mods.id, null);
  assert.equal(mods.gimmeFt, 8);
  assert.deepEqual(mods.assist, { putting: 'easy', dispersion: 0.5, tapInFt: 8 });

  const g = new Game();
  g.setCourse(course());
  g.shotMods = mods;
  const drive = g.handleShot(ball(150, 12, { HLA: 10, SpinAxis: -20 }), 'DR');
  assert.equal(drive.launch.hla, 5);
  assert.equal(drive.launch.spinAxis, -10);
  // a power-up and the assist stack: laser's 15 % of the assisted 50 %
  g.shotMods = A.modifiersFor('laser', { dispersion: 0.5 });
  const laser = g.handleShot(ball(150, 12, { HLA: 10, SpinAxis: -20 }), 'DR');
  assert.ok(Math.abs(laser.launch.hla - 0.75) < 1e-12 && Math.abs(laser.launch.spinAxis + 1.5) < 1e-12);

  // a putt keeps its line; with the round's gimme off the arcade tap-in still concedes it
  const putt = { Speed: 4, VLA: 0, HLA: 1, TotalSpin: 0, SpinAxis: 0 };
  const on = roundAt(0, 397, 'green', { strokes: 2, gimmeFt: 0 });
  // (the putting assist off: it has its own tests, test/putt-assist.test.js, and would pull this one in)
  on.shotMods = A.modifiersFor(null, { dispersion: 0.5, tapInFt: 8, putting: 'off' });
  const tapped = on.handleShot(putt, 'PT');
  assert.equal(tapped.launch.hla, 1);
  assert.ok(tapped.distToPinYd * 3 < 8 && tapped.distToPinYd > 0, `${tapped.distToPinYd * 3} ft left`);
  assert.equal(tapped.holed, true);
  assert.equal(tapped.strokes, 4, 'the putt and the tap-in');
  assert.match(tapped.note, /Tap-in inside 8 ft \(\+1\)/);
  // arcade off: the round's own gimme setting, exactly as before
  const off = roundAt(0, 397, 'green', { strokes: 2, gimmeFt: 0 });
  assert.equal(off.handleShot(putt, 'PT').holed, false);
  const gimme = roundAt(0, 397, 'green', { strokes: 2, gimmeFt: 8 });
  assert.match(gimme.handleShot(putt, 'PT').note, /Gimme inside 8 ft/);
  // tapInFt 0: no tap-ins, whatever the round's gimme says
  const none = roundAt(0, 397, 'green', { strokes: 2, gimmeFt: 8 });
  none.shotMods = A.modifiersFor(null, { tapInFt: 0, putting: 'off' });
  assert.equal(none.handleShot(putt, 'PT').holed, false);

  // validation
  assert.deepEqual(A.normalizeAssist({ putting: 'OFF', dispersion: 7, tapInFt: -2 }), { putting: 'off', dispersion: 1, tapInFt: 0 });
  assert.deepEqual(A.normalizeAssist({ dispersion: '0.25' }, { putting: 'assist', dispersion: 1, tapInFt: 3 }), { putting: 'assist', dispersion: 0.25, tapInFt: 3 });
  assert.deepEqual(A.normalizeAssist(null), A.ASSIST_DEFAULTS);
  assert.throws(() => A.normalizeAssist({ putting: 'magic' }), (e) => e instanceof A.ArcadeError && e.code === 'BAD_ASSIST');
  assert.throws(() => A.normalizeAssist({ dispersion: 'lots' }), (e) => e.code === 'BAD_ASSIST');
});

// ---------- grading ----------

test('grading: a straight long drive is PERFECT or GREAT, a slice into the rough is not', () => {
  const g = new Game();
  g.setCourse(course());
  const { grade, result } = played(g, ball(150, 12), 'DR');
  assert.equal(result.lie, 'fairway');
  assert.ok(['PERFECT', 'GREAT'].includes(grade.grade), grade.grade);
  assert.ok(grade.reasons.includes('Dead straight'), grade.reasons.join(' | '));
  assert.ok(grade.points >= 650 && grade.points <= 1000 && grade.points === grade.basePoints);
  assert.equal(grade.coins, Math.round(grade.points / 10) + (grade.grade === 'PERFECT' ? 25 : 10));
  assert.ok(grade.tags.includes('straight') && grade.tags.includes('fairway'));

  // outdriving the club's typical carry is "piped"
  const big = new Game();
  big.setCourse(course());
  const piped = played(big, ball(172, 12, { TotalSpin: 2300 }), 'DR').grade;
  assert.equal(piped.grade, 'PERFECT');
  assert.ok(piped.reasons.some((r) => /^Piped it: \+\d+ yd over your driver$/.test(r)), piped.reasons.join(' | '));

  const wild = new Game();
  wild.setCourse(course());
  const slice = played(wild, ball(140, 12, { HLA: -6, TotalSpin: 3200, SpinAxis: -12 }), 'DR');
  assert.equal(slice.result.lie, 'rough');
  assert.ok(['MISS', 'OK'].includes(slice.grade.grade), slice.grade.grade);
  assert.ok(slice.grade.reasons.includes('In the rough') && slice.grade.reasons.includes('Way left'), slice.grade.reasons.join(' | '));
});

test('grading: water and out of bounds are a DISASTER worth nothing', () => {
  const g = new Game();
  g.setCourse(course());
  const wet = played(g, ball(150, 12, { HLA: 25 }), 'DR');
  assert.equal(wet.result.penalty, 1);
  assert.equal(wet.grade.grade, 'DISASTER');
  assert.deepEqual(wet.grade.reasons, ['Splash']);
  assert.deepEqual([wet.grade.points, wet.grade.coins], [0, 0]);
  assert.ok(wet.grade.tags.includes('water'));

  const ob = A.gradeShot({
    result: { ...wet.result, sim: { ...wet.result.sim, events: [] }, lie: 'rough', note: 'Out of bounds — drop where it left (+1)' },
    before: wet.before,
  });
  assert.equal(ob.grade, 'DISASTER');
  assert.deepEqual(ob.reasons, ['Out of bounds']);
});

test('grading: an approach is judged on where it finishes: inside 10 ft PERFECT, inside 25 ft GREAT', () => {
  const iron = (speed) => played(roundAt(0, 250, 'fairway'), ball(speed, 19, { TotalSpin: 7000 }), 'I7');
  const close = iron(120.5);
  assert.ok(close.result.distToPinYd * 3 <= 10 && !close.result.holed, `${close.result.distToPinYd * 3} ft`);
  assert.equal(close.grade.grade, 'PERFECT');
  assert.equal(close.grade.reasons[0], 'Inside 10 ft');
  assert.ok(close.grade.tags.includes('approach') && close.grade.tags.includes('inside-10ft'));

  const near = iron(117);
  assert.ok(near.result.distToPinYd * 3 > 10 && near.result.distToPinYd * 3 <= 25);
  assert.equal(near.grade.grade, 'GREAT');
  assert.equal(near.grade.reasons[0], 'Inside 25 ft');
  assert.ok(close.grade.points > near.grade.points);

  // pure but short of the green: struck well is not enough
  const short = iron(100);
  assert.equal(short.result.lie, 'fairway');
  assert.ok(['MISS', 'OK'].includes(short.grade.grade), short.grade.grade);
  // going backwards is a MISS however it was struck
  const back = roundAt(0, 395, 'green');
  back.aimOffset = 0;
  const away = played(back, ball(111, 19, { TotalSpin: 7000 }), 'I7');
  assert.ok(away.result.distToPinYd > away.before.distToPinYd);
  assert.ok(['MISS', 'DISASTER'].includes(away.grade.grade), away.grade.grade);
});

test('grading: hole-outs are a JACKPOT, long putts too; short putts PERFECT, a tap-in left GOOD', () => {
  // an iron that the magnet pulls in from the fairway
  const g = roundAt(0, 250, 'fairway');
  g.shotMods = A.modifiersFor('magnet');
  const holeOut = played(g, ball(120.5, 19, { TotalSpin: 7000 }), 'I7', { powerup: 'magnet' });
  assert.equal(holeOut.result.holed, true);
  assert.equal(holeOut.grade.grade, 'JACKPOT');
  assert.equal(holeOut.grade.label, 'JACKPOT!');
  assert.match(holeOut.grade.reasons[0], /^Holed out from 16\d yd!$/);
  assert.equal(holeOut.grade.basePoints, 1000);
  assert.equal(holeOut.grade.points, 500, 'half points: the magnet did some of it');
  assert.ok(holeOut.grade.tags.includes('hole-out') && holeOut.grade.tags.includes('powerup:magnet'));

  // the same from the tee is an ace
  const tee = roundAt(0, 250, 'fairway', { strokes: 0 });
  tee.shotMods = A.modifiersFor('magnet');
  assert.deepEqual(played(tee, ball(120.5, 19, { TotalSpin: 7000 }), 'I7').grade.reasons, ['HOLE IN ONE!']);

  const putt = (metres, mph) => played(roundAt(0, 400 - metres, 'green'), { Speed: mph, VLA: 0, HLA: 0, TotalSpin: 0, SpinAxis: 0 }, 'PT');
  const long = putt(6, 6.5);
  assert.equal(long.result.holed, true);
  assert.equal(long.grade.grade, 'JACKPOT');
  assert.match(long.grade.reasons[0], /^Drained it from 20 ft$/);
  const short = putt(3, 5);
  assert.equal(short.result.holed, true);
  assert.equal(short.grade.grade, 'PERFECT');
  const lag = putt(3, 4);
  assert.ok(!lag.result.holed && lag.result.distToPinYd * 3 <= 2);
  assert.equal(lag.grade.grade, 'GOOD');
  const weak = putt(6, 4);
  assert.ok(weak.result.distToPinYd * 3 > 5);
  assert.equal(weak.grade.grade, 'MISS');
});

test('grading: practice games are graded by their own scores', () => {
  const g = new Game();
  g.setCourse(course());
  const practiceShot = (mode, shot, extra = {}) => A.gradeShot({
    result: {
      practice: { mode, shot }, launch: { speedMph: 90 }, clubKey: 'PW', lie: shot.lie || 'fairway', penalty: 0,
      holed: Boolean(shot.holed), distToPinYd: shot.toTargetYd,
      sim: { carryYd: 110, totalYd: 112, offlineYd: 1, isPutt: false, events: shot.holed ? [{ type: 'holed' }] : [] }, ...extra,
    },
    before: null,
    practice: { mode },
  });
  assert.deepEqual([10, 5, 3, 1, 0].map((points) => practiceShot('targets', { points, toTargetYd: 2, targetYd: 120 }).grade),
    ['PERFECT', 'GREAT', 'GOOD', 'OK', 'MISS']);
  assert.deepEqual([5, 3, 2, 1, 0].map((points) => practiceShot('chipping', { points, leftFt: 2, toTargetYd: 0.7, counted: true }).grade),
    ['PERFECT', 'GREAT', 'GOOD', 'OK', 'MISS']);
  assert.equal(practiceShot('chipping', { points: 10, leftFt: 0, toTargetYd: 0, holed: true, counted: true }).grade, 'JACKPOT');
  assert.deepEqual([2, 6, 12, 25, 60].map((yd) => practiceShot('closest', { toTargetYd: yd, counted: true }).grade),
    ['PERFECT', 'GREAT', 'GOOD', 'OK', 'MISS']);
  assert.equal(practiceShot('closest', { toTargetYd: 3, counted: false, lie: 'water' }).grade, 'DISASTER');
  assert.equal(practiceShot('ladder', { toTargetYd: 2, climbed: true }).grade, 'PERFECT');
  assert.equal(practiceShot('ladder', { toTargetYd: 6, climbed: true }).grade, 'GREAT');
  assert.equal(practiceShot('ladder', { toTargetYd: 30, climbed: false }).grade, 'MISS');
  assert.equal(practiceShot('longdrive', { toTargetYd: 40, counted: false, distanceYd: 240 }).grade, 'MISS');

  // and through the game: a range ball, then a holed putt in the putting game
  g.startPractice('range');
  const range = played(g, ball(150, 12), 'DR');
  assert.ok(['PERFECT', 'GREAT'].includes(range.grade.grade), range.grade.grade);
  g.startPractice('putting', { random: () => 0 });
  const first = g.state();
  assert.ok(first.distToPinYd * 3 <= 3.1, 'the first putt is the 3-footer');
  const holed = played(g, { Speed: 3, VLA: 0, HLA: 0, TotalSpin: 0, SpinAxis: 0 }, 'PT');
  assert.equal(holed.result.holed, true);
  assert.equal(holed.grade.grade, 'PERFECT');
});

test('points: 0..1000 for the shot, x1.25 per streak step up to x3, halved with a power-up', () => {
  const g = new Game();
  g.setCourse(course());
  const before = g.state();
  const result = g.handleShot(ball(150, 12), 'DR');
  const at = (streak, powerup = null) => A.gradeShot({ result, before, streak, powerup });
  const base = at(0);
  assert.deepEqual(base.multiplier, { streak: 1, powerup: 1, total: 1 });
  assert.equal(at(1).points, Math.round(base.basePoints * 1.25));
  assert.equal(at(4).points, base.basePoints * 2);
  assert.equal(at(8).points, base.basePoints * 3);
  assert.equal(at(30).points, base.basePoints * 3, 'capped at x3');
  assert.deepEqual(at(8, 'rocket').multiplier, { streak: 3, powerup: 0.5, total: 1.5 });
  assert.equal(at(0, 'rocket').points, Math.round(base.basePoints / 2));
  assert.ok(at(3).tags.includes('on-fire') && !base.tags.includes('on-fire'));
  for (const grade of A.GRADES) assert.ok(A.BASE_POINTS[grade] >= 0 && A.BASE_POINTS[grade] <= 1000);
  assert.throws(() => A.gradeShot({}), /needs a shot result/);
});

// ---------- the economy ----------

const G = (grade, points = A.BASE_POINTS[grade], coins = Math.round(points / 10)) => ({ grade, points, coins });

test('a new player starts with a rocket and a magnet; arming needs one in the bag', () => {
  const s = new A.ArcadeState();
  const snap = s.snapshot();
  assert.deepEqual(snap.inventory, { rocket: 1, magnet: 1 });
  assert.deepEqual(
    [snap.enabled, snap.coins, snap.xp, snap.level, snap.streak, snap.bestStreak, snap.shots, snap.armed],
    [true, 0, 0, 1, 0, 0, 0, null],
  );
  assert.deepEqual(snap.assist, A.ASSIST_DEFAULTS);
  assert.deepEqual(snap.history, []);
  assert.deepEqual([snap.levelXp, snap.levelSpan, snap.nextLevelXp], [0, 1000, 1000]);
  assert.deepEqual(snap.powerups, A.catalogue());

  assert.equal(s.consumeArmed(), null, 'nothing armed');
  assert.throws(() => s.arm('sticky'), (e) => e instanceof A.ArcadeError && e.code === 'NOT_OWNED');
  assert.throws(() => s.arm('banana'), (e) => e.code === 'UNKNOWN_POWERUP');
  assert.equal(s.arm('rocket'), 'rocket');
  assert.equal(s.snapshot().armed, 'rocket');
  assert.equal(s.arm(null), null);
  assert.equal(s.consumeArmed(), null);
  assert.deepEqual(s.inventory, { rocket: 1, magnet: 1 }, 'disarmed: still on the shelf');

  s.arm('rocket');
  assert.equal(s.consumeArmed(), 'rocket');
  assert.deepEqual(s.inventory, { magnet: 1 });
  assert.equal(s.armed, null);
  assert.equal(s.consumeArmed(), null, 'one ball, one shot');
  assert.throws(() => s.arm('rocket'), (e) => e.code === 'NOT_OWNED');
  // a shot that never happened gives the ball back, armed
  s.refund('rocket');
  assert.deepEqual([s.inventory.rocket, s.armed], [1, 'rocket']);
});

test('streaks: PERFECT / GREAT / JACKPOT extend, GOOD and OK hold, MISS and DISASTER reset; every third grants a ball', () => {
  const s = new A.ArcadeState({ random: () => 0 });   // random 0: the first ball in the pool
  s.inventory = {};
  assert.deepEqual(s.applyShot(G('GREAT', 100, 10)), { awarded: { coins: 10, xp: 100, points: 100 }, levelUp: false, level: 1, granted: [], streak: 1, challenges: [] });
  assert.equal(s.applyShot(G('GOOD', 50)).streak, 1, 'GOOD holds');
  assert.equal(s.applyShot(G('OK', 20)).streak, 1, 'OK holds');
  assert.equal(s.applyShot(G('PERFECT', 100)).streak, 2);
  const third = s.applyShot(G('GREAT', 100));
  assert.equal(third.streak, 3);
  assert.deepEqual(third.granted, ['rocket']);
  assert.deepEqual(s.inventory, { rocket: 1 });
  assert.deepEqual(s.applyShot(G('GOOD', 50)).granted, [], 'holding at 3 does not grant again');
  assert.equal(s.applyShot(G('MISS', 10)).streak, 0);
  assert.equal(s.bestStreak, 3);
  for (let i = 0; i < 5; i++) s.applyShot(G('GREAT', 10));
  assert.equal(s.applyShot(G('GREAT', 10)).granted.length, 1, 'the sixth in a row');
  assert.equal(s.applyShot(G('DISASTER', 0, 0)).streak, 0);
  assert.deepEqual([s.bestStreak, s.shots, s.streak], [6, 14, 0]);
  assert.throws(() => s.applyShot({ grade: 'MEH' }), /needs a grade/);
});

test('levels: xp is points, each level-up grants two balls, a JACKPOT a rare one', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(A.xpForLevel), [0, 1000, 3000, 6000, 10000]);
  assert.deepEqual([0, 999, 1000, 2999, 3000, 10000].map(A.levelFor), [1, 1, 2, 2, 3, 5]);
  const s = new A.ArcadeState({ random: seq(0.99, 0) });
  s.inventory = {};
  assert.equal(s.applyShot(G('GOOD', 900)).levelUp, false);
  const up = s.applyShot(G('GOOD', 200, 20));
  assert.deepEqual([up.levelUp, up.level, up.granted.length], [true, 2, 2]);
  assert.deepEqual(up.granted, ['gold', 'rocket'], 'the last ball in the catalogue, then the first: never a trick');
  const snap = s.snapshot();
  assert.deepEqual([snap.xp, snap.level, snap.levelXp, snap.levelSpan, snap.nextLevelXp], [1100, 2, 100, 2000, 3000]);
  // two levels at once: four balls
  assert.equal(s.applyShot(G('GOOD', 5000)).granted.length, 4);
  assert.equal(s.level, 4);

  // a jackpot's ball is never a common one, whatever the dice say
  const common = new Set(A.POWERUPS.filter((p) => p.rarity === 'common').map((p) => p.id));
  for (const roll of [0, 0.3, 0.6, 0.999]) {
    const j = new A.ArcadeState({ random: () => roll });
    const r = j.applyShot(G('JACKPOT', 10));
    assert.equal(r.granted.length, 1);
    assert.ok(!common.has(r.granted[0]), `${roll}: ${r.granted[0]}`);
  }
  // rarity weights the ordinary grants: commons most of the time
  const many = new A.ArcadeState({ random: seq(...Array.from({ length: 100 }, (_, i) => (i + 0.5) / 100)) });
  many.inventory = {};
  for (let i = 0; i < 100; i++) many.grantRandom();
  const count = (rarity) => A.POWERUPS.filter((p) => p.rarity === rarity).reduce((n, p) => n + many.owned(p.id), 0);
  assert.ok(count('common') > count('rare') && count('rare') > count('epic') && count('epic') > 0,
    `${count('common')} / ${count('rare')} / ${count('epic')}`);
});

test('arcade.json: every change is saved and read back; a missing or broken file starts fresh', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'arcade.json');
  const s = new A.ArcadeState({ dataDir: dir, random: () => 0, log: quiet });
  assert.equal(fs.existsSync(file), false, 'nothing written until something changes');
  s.arm('magnet');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).state.armed, 'magnet');
  assert.equal(s.consumeArmed(), 'magnet');
  for (let i = 0; i < 25; i++) s.applyShot(G('GREAT', 100, 10), { powerupUsed: i === 0 ? 'magnet' : null, shotId: i + 1 });
  s.setAssist({ putting: 'assist', dispersion: 0.8, tapInFt: 4 });
  s.setEnabled(false);
  assert.equal(s.history.length, 20, 'the last 20 shots');
  assert.deepEqual(s.history[0], { shotId: 25, grade: 'GREAT', points: 100, powerup: null, at: s.history[0].at });
  assert.equal(s.history[19].shotId, 6);

  const back = new A.ArcadeState({ dataDir: dir, log: quiet });
  assert.deepEqual(back.snapshot(), s.snapshot());
  assert.deepEqual([back.enabled, back.coins, back.xp, back.level, back.streak, back.shots], [false, 250, 2500, 2, 25, 25]);
  assert.deepEqual(back.assist, { putting: 'assist', dispersion: 0.8, tapInFt: 4 });
  assert.deepEqual(fs.readdirSync(dir), ['arcade.json'], 'no temp files left behind');

  // reset wipes the progress and keeps the settings
  back.reset();
  const fresh = new A.ArcadeState({ dataDir: dir, log: quiet }).snapshot();
  assert.deepEqual([fresh.coins, fresh.xp, fresh.level, fresh.streak, fresh.shots, fresh.history.length], [0, 0, 1, 0, 0, 0]);
  assert.deepEqual(fresh.inventory, { rocket: 1, magnet: 1 });
  assert.deepEqual([fresh.enabled, fresh.assist.putting], [false, 'assist']);

  // hand-edited nonsense is cleaned up, not trusted
  fs.writeFileSync(file, JSON.stringify({ state: { coins: -5, xp: 3200, level: 99, streak: 2, inventory: { rocket: 2, banana: 9, sticky: 0 }, armed: 'sticky', assist: { putting: 'magic' } } }));
  const cleaned = new A.ArcadeState({ dataDir: dir, log: quiet });
  assert.deepEqual([cleaned.coins, cleaned.xp, cleaned.level, cleaned.armed], [0, 3200, 3, null]);
  assert.deepEqual(cleaned.inventory, { rocket: 2 });
  assert.deepEqual(cleaned.assist, A.ASSIST_DEFAULTS);

  // a file that is not JSON is moved aside and the player starts again
  const warnings = [];
  fs.writeFileSync(file, '{not json');
  const broken = new A.ArcadeState({ dataDir: dir, log: { warn: (m) => warnings.push(m) } });
  assert.deepEqual(broken.inventory, { rocket: 1, magnet: 1 });
  assert.equal(warnings.length, 1);
  assert.ok(fs.existsSync(`${file}.corrupt`));
  assert.equal(new A.ArcadeState({ dataDir: path.join(dir, 'nowhere'), log: { warn: (m) => warnings.push(m) } }).coins, 0);
  assert.equal(warnings.length, 1, 'a missing file is not a problem');
});

test('ArcadeState.shotMods: the armed ball with the assists on top', () => {
  const s = new A.ArcadeState();
  const plain = s.shotMods(null);
  assert.deepEqual([plain.id, plain.gimmeFt, plain.assist.dispersion], [null, 8, 0.6]);
  assert.deepEqual(plain.launch({ ...DRIVE, hla: 10, spinAxis: 5 }, { putt: false }), { ...DRIVE, hla: 6, spinAxis: 3 });
  assert.deepEqual(plain.launch({ ...PUTT, hla: 2 }, { putt: true }), { ...PUTT, hla: 2 });
  s.setAssist({ dispersion: 1, tapInFt: 0 });
  const real = s.shotMods('rocket');
  assert.deepEqual([real.id, real.gimmeFt], ['rocket', 0]);
  assert.deepEqual(real.launch({ ...DRIVE, hla: 10 }, { putt: false }), { ...DRIVE, speedMph: 225, hla: 10 });
  assert.deepEqual(real.physics, { dragScale: 0.7, liftScale: 1.2 });
});

test('unlimited: every ball can be armed and none runs out, but a shot spends the armed slot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-unl-'));
  const a = new A.ArcadeState({ dataDir: dir });
  assert.equal(a.snapshot().unlimited, false);
  assert.throws(() => a.arm('laser'), /no Laser/i, 'not owned on the real shelf');
  assert.equal(a.setUnlimited(true), true);
  assert.equal(a.arm('laser'), 'laser');
  a.arm('rocket');
  const before = { ...a.inventory };
  assert.equal(a.consumeArmed(), 'rocket');
  assert.equal(a.armed, null, 'the shot spent the armed slot');
  assert.equal(a.snapshot().armed, null);
  assert.equal(a.consumeArmed(), null, 'the next shot (a chip, a putt) is a plain ball');
  assert.deepEqual(a.inventory, before, 'the shelf is untouched');
  assert.equal(a.arm('rocket'), 'rocket', 'and it can be armed again at once: it never runs out');
  assert.equal(a.consumeArmed(), 'rocket');
  a.refund('rocket');
  assert.equal(a.armed, 'rocket', 'a shot that never happened puts it back in the armed slot');
  assert.deepEqual(a.inventory, before, 'a refund adds nothing either');
  assert.equal(a.consumeArmed(), 'rocket');
  // it survives a restart and a reset; switching it off drops a ball that is not owned
  assert.equal(new A.ArcadeState({ dataDir: dir }).unlimited, true);
  a.reset();
  assert.equal(a.unlimited, true);
  a.arm('laser');
  a.setUnlimited(false);
  assert.equal(a.armed, null);
  assert.equal(a.snapshot().unlimited, false);
});

// ====================================================================================
// v2 (docs/dev/arcade-v2-contract.md): callouts, the bigger catalogue, tricks, the economy
// hooks for the match engine, challenges
// ====================================================================================

// the same par 4 with a greenside bunker; `extra` adds trees and the like
function links(extra = {}) {
  const c = course();
  c.surfaces.push({ kind: 'bunker', poly: [[-28, 360], [-17, 360], [-17, 400], [-28, 400]] });
  return { ...c, ...extra };
}
function at(x, y, lie, { strokes = 1, mods = null, c = links() } = {}) {
  const g = new Game();
  g.setCourse(c);
  g.settings = { ...g.settings, gimmeFt: 0 };
  g.ball = { x, y };
  g.lie = lie;
  g.strokes = strokes;
  g.shotMods = mods;
  return g;
}
const tee = (o = {}) => at(0, 0, 'tee', { strokes: 0, ...o });
const fromFairway = (o = {}) => at(0, 250, 'fairway', o);            // 164 yd out
const onGreen = (metres, o = {}) => at(0, 400 - metres, 'green', { strokes: 2, ...o });
const roll = (mph, hla = 0) => ({ Speed: mph, VLA: 0, HLA: hla, TotalSpin: 0, SpinAxis: 0 });
// play it, grade it, and say what the announcer says
const said = (g, b, club, extra = {}) => {
  const p = played(g, b, club, extra);
  return { ...p, id: p.grade.callout ? p.grade.callout.id : null };
};
// Real swings, as a launch monitor reports them.
const SWING = {
  pure: ball(150, 12),                                                  // 244 carry, dead straight
  bomb: ball(175, 12, { TotalSpin: 2300 }),                             // 302 carry
  fade10: ball(150, 12, { HLA: 0.5, SpinAxis: 4 }),                     // 10 yd right
  fade18: ball(150, 12, { HLA: 1, SpinAxis: 7 }),                       // 18 yd right
  slice35: ball(150, 12, { HLA: 2, TotalSpin: 3000, SpinAxis: 13 }),    // 35 yd right, in the rough short of the pond
  hook40: ball(150, 12, { HLA: -3, TotalSpin: 3000, SpinAxis: -15 }),   // 41 yd left
  push37: ball(150, 12, { HLA: -8.5 }),                                 // 37 yd left with no curve at all
  shank: ball(95, 14, { HLA: -28 }),
  topped: ball(95, 1.5, { TotalSpin: 3500 }),                           // never 2 ft off the ground
  sky: ball(105, 38, { TotalSpin: 6500 }),                              // 150 ft up, 125 yd out
  fat: ball(100, 16, { TotalSpin: 4000 }),                              // a driver that carries 136
  wet: ball(150, 12, { HLA: 25 }),                                      // into the pond
  iron: (speed, extra = {}) => ball(speed, 19, { TotalSpin: 7000, ...extra }),   // a 7-iron
  chip: (speed, extra = {}) => ball(speed, 30, { TotalSpin: 3000, ...extra }),
};
const CHIP_SPOT = [0, 381.7];   // 20 yd from the pin, 2 yd short of the green
const treeLine = () => { const t = []; for (let x = -24; x <= 24; x += 4) t.push([x, 40], [x + 2, 46]); return t; };

// ---------- the new physics options ----------

test('the new physics options change nothing when they are absent, zero, false or junk', () => {
  const off = { gravityScale: 1, crossWindMps: 0, ignoreTrees: false, waterSkips: 0, ripBackYd: 0, homing: 0 };
  const junk = { gravityScale: 'light', crossWindMps: NaN, ignoreTrees: 'yes', waterSkips: -3, waterSkipMaxDeg: 'flat', ripBackYd: null, homing: -1 };
  const pond = (x, y) => (y > 150 && y < 230 ? 'water' : y > 300 ? 'green' : 'fairway');
  const wind = { speedMps: 6, fromDeg: 300, gustMps: 2 };
  for (const [launch, surf] of [[DRIVE, fairway], [DRIVE, pond], [preset('I7', { hla: -2, spinAxis: -7 }), pond], [preset('PW'), green], [PUTT, green]]) {
    for (const opts of [{}, { pin: { x: 0, y: 5 } }, { wind, firmness: 0.8, greenStimp: 12 }]) {
      const plain = fly(launch, opts, surf);
      assert.deepEqual(fly(launch, { ...opts, ...off }, surf), plain);
      assert.deepEqual(fly(launch, { ...opts, ...junk }, surf), plain);
    }
  }
});

// ---------- the new balls, each claim in numbers ----------

test('fireball: 20 % more ball speed, low drag and a huge run-out', () => {
  const m = A.modifiersFor('fireball');
  assert.equal(m.launch(DRIVE).speedMph, 180);
  assert.ok(m.physics.dragScale < 1);
  const plain = fly(DRIVE);
  const fire = flyWith('fireball', DRIVE);
  assert.ok(fire.carryYd > plain.carryYd * 1.25 && fire.carryYd < 350, `carry ${fire.carryYd.toFixed(1)}`);
  assert.ok(fire.totalYd >= 400 && fire.totalYd <= 460, `total ${fire.totalYd.toFixed(1)}`);
  const run = (r) => r.totalYd - r.carryYd;
  assert.ok(run(fire) >= 90 && run(fire) > run(plain) * 4, `runs ${run(fire).toFixed(1)} yd against ${run(plain).toFixed(1)}`);
  assert.ok(fire.apexFt < flyWith('rocket', DRIVE).apexFt / 2, 'hot and low, not a Rocket');
  assert.ok(flyWith('fireball', preset('I7')).totalYd > fly(preset('I7')).totalYd + 50);
});

test('ghost: flies through the trees a plain ball hits', () => {
  const wood = () => links({ trees: treeLine() });
  const plain = said(tee({ c: wood() }), ball(150, 9), 'DR');
  assert.ok(plain.result.sim.events.some((e) => e.type === 'tree'), 'the plain ball hits a tree');
  assert.ok(plain.result.sim.carryYd < 100);
  const ghost = said(tee({ c: wood(), mods: A.modifiersFor('ghost') }), ball(150, 9), 'DR', { powerup: 'ghost' });
  const open = said(tee(), ball(150, 9), 'DR');
  assert.ok(!ghost.result.sim.events.some((e) => e.type === 'tree'));
  assert.equal(ghost.result.sim.carryYd, open.result.sim.carryYd, 'as if the trees were not there');
  assert.equal(ghost.result.sim.totalYd, open.result.sim.totalYd);
  assert.notEqual(ghost.id, 'timber');
  assert.deepEqual(flyWith('ghost', DRIVE), fly(DRIVE), 'no trees: a plain ball');
});

test('skipper: skips off water like a stone, up to five times, and reaches the far bank', () => {
  const water = (fromYd, toYd) => (x, y) => (y > fromYd * YD && y < toYd * YD ? 'water' : 'fairway');
  const count = (r, type) => r.events.filter((e) => e.type === type).length;
  const creek = water(230, 290);   // 60 yd of water where a 244 yd drive comes down
  const sunk = fly(DRIVE, {}, creek);
  assert.equal(count(sunk, 'water'), 1);
  assert.equal(sunk.endSurface, 'water');
  const skip = flyWith('skipper', DRIVE, {}, creek);
  assert.equal(count(skip, 'water'), 0);
  assert.ok(count(skip, 'skip') >= 1 && count(skip, 'skip') <= 5, `${count(skip, 'skip')} skips`);
  assert.equal(skip.endSurface, 'fairway');
  assert.ok(skip.end.y > 290 * YD, 'on the far bank');
  assert.equal(skip.carryYd, sunk.carryYd, 'the carry is still where it first came down');
  // a lake too wide to cross: five skips, 90 yd of them, then it sinks
  const lake = flyWith('skipper', DRIVE, {}, water(230, 900));
  assert.deepEqual([count(lake, 'skip'), count(lake, 'water')], [5, 1]);
  assert.ok(lake.totalYd - lake.carryYd > 80 && lake.totalYd - lake.carryYd < 110, `skipped ${(lake.totalYd - lake.carryYd).toFixed(1)} yd`);
  for (let i = 1; i < 5; i++) {
    const hops = lake.events.filter((e) => e.type === 'skip');
    assert.ok(hops[i].y > hops[i - 1].y, 'each skip farther on');
  }
  // irons skip too; a ball dropping steeply does not (a stone has to come in flat)
  assert.ok(count(flyWith('skipper', preset('I7'), {}, water(140, 900)), 'skip') === 5);
  const steep = { speedMph: 120, vla: 40, hla: 0, totalSpin: 6000, spinAxis: 0 };
  const plunge = flyWith('skipper', steep, {}, water(100, 900));
  assert.deepEqual([count(plunge, 'skip'), count(plunge, 'water')], [0, 1]);
  assert.deepEqual(flyWith('skipper', DRIVE), fly(DRIVE), 'on dry land: a plain ball');

  // in a round: no splash, no penalty
  const river = () => { const c = links(); c.surfaces.push({ kind: 'water', poly: [[-30, 215], [30, 215], [30, 260], [-30, 260]] }); return c; };
  const drowned = said(tee({ c: river() }), SWING.pure, 'DR');
  assert.deepEqual([drowned.result.penalty, drowned.id], [1, 'splash']);
  const across = said(tee({ c: river(), mods: A.modifiersFor('skipper') }), SWING.pure, 'DR', { powerup: 'skipper' });
  assert.equal(across.result.penalty, 0);
  assert.equal(across.result.lie, 'fairway');
  assert.notEqual(across.grade.grade, 'DISASTER');
});

test('yoyo: lands, bites and rips back twenty yards', () => {
  for (const [k, surf] of [['DR', fairway], ['I7', fairway], ['PW', fairway], ['PW', green], ['I7', green]]) {
    const plain = fly(preset(k), {}, surf);
    const yo = flyWith('yoyo', preset(k), {}, surf);
    assert.equal(yo.carryYd, plain.carryYd, `${k}: the flight is untouched`);
    const back = yo.carryYd - yo.totalYd;
    assert.ok(back > 19 && back < 21, `${k}: ripped back ${back.toFixed(1)} yd`);
    assert.ok(Math.abs(yo.offlineYd) < 1e-6, 'straight back down its own line');
  }
  // a shorter shot comes back less, and sand holds it
  const chip = { speedMph: 45, vla: 28, hla: 0, totalSpin: 5000, spinAxis: 0 };
  const short = flyWith('yoyo', chip);
  assert.ok(short.totalYd < short.carryYd && short.carryYd - short.totalYd < 19);
  assert.deepEqual(flyWith('yoyo', preset('PW'), {}, () => 'bunker'), fly(preset('PW'), {}, () => 'bunker'));
});

test('homing: a real sideways force bends the ball back to the aim line; it rescues a 15 yd miss and more', () => {
  const lateral = (r) => Math.max(...r.points.map((p) => Math.abs(p.x))) / YD;
  for (const [name, launch, missMin, leftMax] of [
    ['a 15 yd fade', { ...DRIVE, hla: 1, spinAxis: 6 }, 15, 2],
    ['a 40 yd slice', { ...DRIVE, hla: 3, spinAxis: 14 }, 38, 5],
    ['a 50 yd hook', { ...DRIVE, hla: -4, spinAxis: -18 }, 48, 5],
    ['a pushed 7-iron', preset('I7', { hla: 4, spinAxis: 8 }), 20, 3],
  ]) {
    const plain = fly(launch);
    const home = flyWith('homing', launch);
    assert.ok(Math.abs(plain.offlineYd) > missMin, `${name}: plain ${plain.offlineYd.toFixed(1)}`);
    assert.ok(Math.abs(home.offlineYd) < leftMax, `${name}: homing finishes ${home.offlineYd.toFixed(1)} yd off`);
    assert.ok(Math.abs(home.carryYd - plain.carryYd) < 3, `${name}: it does not add distance`);
    // not a teleport: it leaves on its own line, drifts off, and curves back smoothly
    assert.ok(lateral(home) > 2.5 && lateral(home) < Math.abs(plain.offlineYd) / 2, `${name}: ${lateral(home).toFixed(1)} yd off at its widest`);
    for (let i = 1; i < home.points.length; i++) {
      assert.ok(Math.abs(home.points[i].x - home.points[i - 1].x) < 0.3, `${name}: no sideways jump`);
    }
  }
  assert.deepEqual(flyWith('homing', DRIVE), fly(DRIVE), 'on the line already: nothing to do');
});

test('titan: a quarter more ball speed and no curve at all', () => {
  const slice = { ...DRIVE, hla: 3, spinAxis: 14 };
  const l = A.modifiersFor('titan').launch(slice);
  assert.deepEqual(l, { ...slice, speedMph: 187.5, spinAxis: 0 });
  const titan = flyWith('titan', slice);
  assert.deepEqual(titan, fly({ ...DRIVE, speedMph: 187.5, hla: 3 }));
  assert.ok(titan.carryYd > fly(DRIVE).carryYd * 1.25, `carry ${titan.carryYd.toFixed(1)}`);
  // it finishes where its start line points: the 3 degrees it was pushed, not a yard of curve
  assert.ok(Math.abs(titan.offlineYd - titan.totalYd * Math.sin(3 * Math.PI / 180)) < 0.5, `offline ${titan.offlineYd.toFixed(1)}`);
  assert.ok(fly(slice).offlineYd > 38, 'the same swing with a plain ball slices 40 yd');
  assert.ok(Math.abs(flyWith('titan', { ...DRIVE, spinAxis: -20 }).offlineYd) < 1e-6);
});

test('feather: floats (big hang time, more carry), lands soft and stops', () => {
  for (const k of ['DR', 'I7', 'PW']) {
    const plain = fly(preset(k));
    const feather = flyWith('feather', preset(k));
    assert.ok(feather.flightTime > plain.flightTime * 1.6, `${k}: hang ${feather.flightTime.toFixed(1)} s against ${plain.flightTime.toFixed(1)}`);
    assert.ok(feather.carryYd > plain.carryYd * 1.15 && feather.carryYd < plain.carryYd * 1.35, `${k}: carry ${feather.carryYd.toFixed(1)}`);
    assert.ok(Math.abs(feather.totalYd - feather.carryYd) < 1, `${k}: stops where it lands`);
  }
});

test('gold: a plain ball that pays double points and double coins', () => {
  assert.deepEqual(flyWith('gold', DRIVE), fly(DRIVE));
  assert.deepEqual(A.modifiersFor('gold').physics, {});
  const g = tee();
  const before = g.state();
  const result = g.handleShot(SWING.pure, 'DR');
  const paid = (powerup, streak = 0) => A.gradeShot({ result, before, powerup, streak });
  const plain = paid(null), gold = paid('gold'), rocket = paid('rocket');
  assert.equal(plain.grade, 'PERFECT');
  assert.deepEqual(gold.multiplier, { streak: 1, powerup: 2, total: 2 });
  assert.equal(gold.points, plain.points * 2);
  assert.equal(gold.coins, plain.coins * 2, 'the PERFECT bonus is doubled too');
  assert.equal(rocket.points, Math.round(plain.points / 2), 'every other ball still pays half');
  assert.equal(paid('gold', 4).points, plain.basePoints * 4);
  assert.ok(gold.tags.includes('powerup:gold'));
});

// ---------- tricks ----------

test('gust: a 25 mph crosswind for that shot only, from a random side', () => {
  const fromLeft = A.modifiersFor(null, null, { curses: ['gust'], random: () => 0.9 });
  const fromRight = A.modifiersFor(null, null, { curses: ['gust'], random: () => 0.1 });
  assert.deepEqual(fromLeft.gust, { mph: 25, from: 'left' });
  assert.deepEqual(fromRight.gust, { mph: 25, from: 'right' });
  assert.deepEqual(fromLeft.curses, ['gust']);
  assert.ok(Math.abs(fromLeft.physics.crossWindMps - 25 * 0.44704) < 1e-12);
  assert.equal(fromRight.physics.crossWindMps, -fromLeft.physics.crossWindMps);
  const right = fly(DRIVE, fromLeft.physics), left = fly(DRIVE, fromRight.physics);
  assert.ok(right.offlineYd > 30 && right.offlineYd < 50, `blown ${right.offlineYd.toFixed(1)} yd right`);
  assert.ok(Math.abs(left.offlineYd + right.offlineYd) < 1e-6, 'the same wind from the other side');
  // across the aim line, whichever way the hole runs
  const east = simulateShot(DRIVE, { x: 0, y: 0 }, 90, fairway, fromLeft.physics);
  assert.ok(Math.abs(east.offlineYd - right.offlineYd) < 1e-6);
  // it is this shot's wind, not the day's; and a Windcutter does not feel it
  assert.equal(right.windMps, 0);
  const cut = A.modifiersFor('windcutter', null, { curses: ['gust'], random: () => 0.9 });
  assert.deepEqual([cut.id, cut.curses], ['windcutter', ['gust']]);
  assert.ok(Math.abs(fly(DRIVE, cut.physics).offlineYd) < 1e-9);
  // the dice are the state's
  const s = new A.ArcadeState({ random: () => 0.1 });
  assert.deepEqual(s.shotMods(null, { curses: ['gust'] }).gust, { mph: 25, from: 'right' });
});

test('tiny-cup: the cup shrinks to a quarter and takes less pace, and the putting assist does not undo it', () => {
  const m = A.modifiersFor(null, null, { curses: ['tiny-cup'] });
  assert.deepEqual(m.physics, { cupRadiusScale: 0.25, cupMaxSpeedScale: 0.45 });
  assert.deepEqual(A.TINY_CUP, { cupRadiusScale: 0.25, cupMaxSpeedScale: 0.45 });
  // a putt that passes 15 cm from the pin drops in a normal cup and not in a tiny one
  const pin = { x: 0, y: 5 };
  const near = { ...PUTT, hla: Math.atan2(0.15, 5) * 180 / Math.PI };
  assert.equal(fly(near, { pin }, green).holed, true);
  assert.equal(fly(near, { pin, ...m.physics }, green).holed, false);
  // one that is dead centre but firm (it would run 12 ft by): the same
  assert.equal(fly({ ...PUTT, speedMph: 7 }, { pin }, green).holed, true);
  assert.equal(fly({ ...PUTT, speedMph: 7 }, { pin, ...m.physics }, green).holed, false);
  assert.equal(fly({ ...PUTT, speedMph: 5.8 }, { pin, ...m.physics }, green).holed, true, 'dead centre at dying pace still drops');

  // through the game with the default 'easy' putting: the assist's big cup, shrunk
  const easy = (curses) => A.modifiersFor(null, { tapInFt: 0 }, { curses });
  // (v2:playability the putting assist holes a DECENT putt: start line inside 4.5 degrees on
  // 'easy'. A Tiny Cup halves that window, and a putt outside it is steered past the edge.)
  const stroke = roll(6.5, 4);   // a 20 ft putt started 4 degrees off line
  const helped = said(onGreen(6, { mods: easy(null) }), stroke, 'PT');
  assert.equal(helped.result.holed, true, 'easy putting holes it');
  assert.deepEqual(helped.result.arcadeShot.cup, { radiusScale: 2.2, maxSpeedScale: 1.7 });
  assert.equal(said(onGreen(6, { mods: easy(null) }), roll(6.5, 8), 'PT').result.holed, false, 'started 8 degrees off line it stays out, tiny cup or not');
  const cursed = said(onGreen(6, { mods: easy(['tiny-cup']) }), stroke, 'PT');
  assert.equal(cursed.result.holed, false, 'the same stroke at a tiny cup stays out');
  assert.equal(cursed.result.arcadeShot.cup.radiusScale, 0, 'a putt outside the window is played at no cup');
  assert.ok(Math.abs(cursed.result.arcadeShot.cup.maxSpeedScale - 1 * 0.45) < 1e-12);
  assert.equal(cursed.id, 'robbed');
  assert.deepEqual(cursed.grade.curses, ['tiny-cup']);
  // a good stroke still goes in
  assert.equal(said(onGreen(6, { mods: easy(['tiny-cup']) }), roll(6.5, 2), 'PT').result.holed, true);
  // a Magnet against a Tiny Cup: 12 x 0.25
  const both = A.modifiersFor('magnet', null, { curses: ['tiny-cup'] });
  assert.deepEqual(both.physics, { cupRadiusScale: 3, cupMaxSpeedScale: 3 * 0.45 });
  assert.deepEqual(both.cupCurse.own, { cupRadiusScale: 12, cupMaxSpeedScale: 3 });
});

test('fog changes no physics; curses stack with a ball and with each other', () => {
  const fog = A.modifiersFor(null, null, { curses: ['fog'] });
  assert.deepEqual([fog.id, fog.curses, fog.physics, fog.gust, fog.cupCurse], [null, ['fog'], {}, null, null]);
  assert.deepEqual(fly(fog.launch(DRIVE), fog.physics), fly(DRIVE));

  const all = A.modifiersFor('rocket', { dispersion: 0.5 }, { curses: ['fog', 'tiny-cup', 'gust', 'banana', 'rocket', 'gust'], random: () => 0.9 });
  assert.equal(all.id, 'rocket');
  assert.deepEqual(all.curses, ['gust', 'tiny-cup', 'fog'], 'each trick once, in catalogue order; a ball is no curse');
  assert.deepEqual(all.physics, { dragScale: 0.7, liftScale: 1.2, crossWindMps: 25 * 0.44704, cupRadiusScale: 0.25, cupMaxSpeedScale: 0.45 });
  assert.deepEqual(all.launch({ ...DRIVE, hla: 4 }, { putt: false }), { ...DRIVE, speedMph: 225, hla: 2 }, 'the ball and the assist still apply');
  assert.deepEqual(A.modifiersFor('rocket').physics, { dragScale: 0.7, liftScale: 1.2 }, 'the catalogue entry is untouched');
  assert.equal(A.modifiersFor(null, null, { curses: [] }), A.modifiersFor(null), 'no curses: the frozen no-ops');
  assert.deepEqual(A.modifiersFor(null, null, { curses: 'gust', random: () => 0.9 }).curses, ['gust'], 'one id is a list of one');

  // the game plays it and says so on the result; the grade passes it on to the HUD
  const cursed = said(tee({ mods: all }), SWING.pure, 'DR', { powerup: 'rocket' });
  assert.equal(cursed.result.launch.speedMph, 225);
  assert.ok(cursed.result.sim.offlineYd > 60, `a rocket in a gust: ${cursed.result.sim.offlineYd} yd right`);
  assert.deepEqual(cursed.result.arcadeShot, {
    ball: 'rocket', curses: ['gust', 'tiny-cup', 'fog'], gust: { mph: 25, from: 'left' },
    realLaunch: { speedMph: 150, vla: 12, hla: 0, totalSpin: 2600, spinAxis: 0 },
    cup: { radiusScale: 0.25, maxSpeedScale: 0.45 },
  });
  assert.deepEqual(cursed.grade.curses, ['gust', 'tiny-cup', 'fog']);
  assert.deepEqual(cursed.grade.gust, { mph: 25, from: 'left' });
  // a plain shot with no arcade layer says nothing of the kind
  const plain = said(tee(), SWING.pure, 'DR');
  assert.equal(plain.result.arcadeShot, undefined);
  assert.deepEqual([plain.grade.curses, plain.grade.gust], [[], null]);
});

// ---------- callouts ----------

test('CALLOUTS: the thirty ids and texts of the contract, each with a tone', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(A.CALLOUTS).map(([id, c]) => [id, c.text])), {
    'hole-in-one': 'HOLE IN ONE!!!', 'holed-out': 'HOLED OUT!', 'chip-in': 'CHIP IN!', drained: 'DRAINED IT!',
    'in-the-hole': 'IN THE HOLE!', 'pin-seeker': 'PIN SEEKER!', dart: 'DART!', 'dance-floor': 'ON THE DANCE FLOOR!',
    bomb: 'ABSOLUTE BOMB!', striped: 'STRIPED IT!', perfect: 'PERFECT SHOT!', 'great-shot': 'GREAT SHOT!',
    'nice-shot': 'NICE SHOT!', 'blast-off': 'BLAST OFF!', robbed: 'ROBBED!', 'so-close': 'SO CLOSE!',
    terrible: 'TERRIBLE!', 'slice-house': 'SLICE HOUSE!', 'hook-city': 'HOOK CITY!', shank: 'SHANK-A-POTAMUS!',
    'worm-burner': 'WORM BURNER!', 'sky-ball': 'SKY BALL!', chunk: 'CHUNK CITY!', splash: 'IN THE DRINK!',
    lava: 'MELTED!', ob: 'SEE YA!', beach: 'BEACH DAY!', timber: 'TIMBER!', 'on-fire': "YOU'RE ON FIRE!",
    unstoppable: 'UNSTOPPABLE!',
  });
  for (const [id, c] of Object.entries(A.CALLOUTS)) assert.ok(['epic', 'good', 'neutral', 'bad', 'funny'].includes(c.tone), id);
  assert.deepEqual(new A.ArcadeState().snapshot().callouts, A.CALLOUTS);
  assert.equal(A.CALLOUT_RULES.offlineYd, 30);
});

test('callouts: a 35 yd slice off the tee is SLICE HOUSE, the same miss with an iron is TERRIBLE, a 10 yd miss is neither', () => {
  const offTheTee = said(tee(), SWING.slice35, 'DR');
  assert.ok(offTheTee.result.sim.offlineYd > 33 && offTheTee.result.sim.offlineYd < 38, `${offTheTee.result.sim.offlineYd} yd right`);
  assert.deepEqual(offTheTee.grade.callout, { id: 'slice-house', text: 'SLICE HOUSE!', tone: 'funny', voice: 'slice-house' });
  assert.equal(offTheTee.grade.grade, 'MISS', 'and it is a MISS, wherever it ended up');
  assert.ok(offTheTee.grade.tags.includes('mishit'));

  const iron = said(fromFairway(), SWING.iron(118, { HLA: 6, SpinAxis: 14 }), 'I7');
  assert.ok(iron.result.sim.offlineYd > 33 && iron.result.sim.offlineYd < 42, `${iron.result.sim.offlineYd} yd right`);
  assert.deepEqual(iron.grade.callout, { id: 'terrible', text: 'TERRIBLE!', tone: 'bad', voice: 'terrible' });

  // 10 yd off line is golf, not comedy: off the tee, and with an iron
  const fade = said(tee(), SWING.fade10, 'DR');
  assert.ok(fade.result.sim.offlineYd > 9 && fade.result.sim.offlineYd < 12);
  assert.equal(fade.id, 'great-shot');
  const leak = said(fromFairway(), SWING.iron(118, { HLA: 2, SpinAxis: 6 }), 'I7');
  assert.ok(leak.result.sim.offlineYd > 9 && leak.result.sim.offlineYd < 16);
  assert.equal(leak.id, 'dance-floor');
  // nor is 25 yd, nor 29: the line is 30
  assert.equal(said(tee(), ball(150, 12, { HLA: 1.5, SpinAxis: 9.5 }), 'DR').id, 'nice-shot');
  for (const b of [SWING.fade10, SWING.fade18, ball(150, 12, { HLA: 1.5, SpinAxis: 9.5 }), ball(150, 12, { HLA: -1.5, SpinAxis: -9.5 })]) {
    const r = said(tee(), b, 'DR');
    assert.ok(Math.abs(r.result.sim.offlineYd) < 30);
    assert.ok(!['slice-house', 'hook-city', 'terrible'].includes(r.id) && !r.grade.tags.includes('mishit'), `${r.result.sim.offlineYd} yd: ${r.id}`);
  }

  // the other way it is HOOK CITY; with no curve on it (a 37 yd push) just TERRIBLE
  assert.equal(said(tee(), SWING.hook40, 'DR').id, 'hook-city');
  assert.equal(said(tee(), SWING.push37, 'DR').id, 'terrible');
  // a left-hander's ball that curves right is a hook
  assert.equal(said(tee(), SWING.slice35, 'DR', { handed: 'LH' }).id, 'hook-city');
  assert.equal(said(tee(), SWING.hook40, 'DR', { handed: 'LH' }).id, 'slice-house');
  // on the range a full swing is a tee shot too; a par 3's tee shot is not
  const range = new Game();
  range.setCourse(links());
  range.startPractice('range');
  assert.equal(said(range, ball(150, 12, { HLA: 3, TotalSpin: 3000, SpinAxis: 14 }), 'DR').id, 'slice-house');
  const par3 = links();
  par3.holes[0].par = 3;
  assert.equal(said(tee({ c: par3 }), SWING.slice35, 'DR').id, 'terrible');
  // a Gust trick's work is not the swing's: a pure drive blown 40 yd is not called TERRIBLE
  const gusted = said(tee({ mods: A.modifiersFor(null, null, { curses: ['gust'], random: () => 0.9 }) }), SWING.pure, 'DR');
  assert.ok(gusted.result.sim.offlineYd > 35);
  assert.ok(gusted.id !== 'terrible' && !gusted.grade.tags.includes('mishit'), String(gusted.id));
});

test('grading judges the swing, not the day\'s wind: a pure drive in a 20 mph crosswind is not "way right"', () => {
  const windy = (o = {}) => { const g = tee({ mods: A.modifiersFor(null), ...o }); g.setConditions({ windMph: 20, windFromDeg: 270, gustMph: 0 }); return g; };
  // the wind carries a dead-straight swing well over 30 yd off its aim line ...
  const pure = said(windy(), SWING.pure, 'DR');
  assert.ok(pure.result.sim.offlineYd > 30, `${pure.result.sim.offlineYd} yd downwind`);
  assert.ok(Math.abs(pure.result.sim.windDriftYd - pure.result.sim.offlineYd) < 1.5, 'and the sim says it was all the wind');
  // ... and the grade is the swing's: straight, no TERRIBLE, no mishit, a streak kept
  assert.ok(Math.abs(pure.grade.facts.offlineYd) < 1.5);
  assert.ok(!['terrible', 'slice-house', 'hook-city'].includes(pure.id) && !pure.grade.tags.includes('mishit') && !pure.grade.tags.includes('wayward'), String(pure.id));
  assert.ok(['PERFECT', 'GREAT', 'GOOD', 'OK'].includes(pure.grade.grade), pure.grade.grade);
  // a real slice is still a slice, even when the wind off the right blows it back to the
  // middle: the wind is no excuse for the swing (and no cover for it either)
  const fromRight = tee({ mods: A.modifiersFor(null) });
  fromRight.setConditions({ windMph: 20, windFromDeg: 90, gustMph: 0 });
  const slice = said(fromRight, SWING.slice35, 'DR');
  assert.ok(Math.abs(slice.result.sim.offlineYd) < 15, `the slice finished ${slice.result.sim.offlineYd} yd off the line`);
  assert.equal(slice.id, 'slice-house');
  // still air, or the arcade layer off (no mods): nothing is measured, nothing changes
  assert.equal(said(tee({ mods: A.modifiersFor(null) }), SWING.pure, 'DR').result.sim.windDriftYd, undefined);
  const plain = tee(); plain.setConditions({ windMph: 20, windFromDeg: 270, gustMph: 0 });
  assert.equal(plain.handleShot(SWING.pure, 'DR').sim.windDriftYd, undefined);
});

test('callouts: every id is reachable by a realistic shot', () => {
  const magnet = () => A.modifiersFor('magnet');
  const wood = links({ trees: treeLine() });
  const lagoon = said(tee(), SWING.wet, 'DR');
  const cases = {
    'hole-in-one': () => said(at(0, 250, 'tee', { strokes: 0, mods: magnet() }), SWING.iron(120.5), 'I7', { powerup: 'magnet' }),
    'holed-out': () => said(fromFairway(), SWING.iron(121.4), 'I7'),                 // 164 yd, in on the roll
    'chip-in': () => said(at(...CHIP_SPOT, 'fairway'), SWING.chip(31), 'SW'),
    drained: () => said(onGreen(6), roll(6.5), 'PT'),                                 // 20 ft
    'in-the-hole': () => said(onGreen(3), roll(5), 'PT'),
    'pin-seeker': () => said(fromFairway(), SWING.iron(121.2), 'I7'),                 // 1.5 ft
    dart: () => said(fromFairway(), SWING.iron(120.5), 'I7'),                         // 4.5 ft
    'dance-floor': () => said(fromFairway(), SWING.iron(117), 'I7'),                  // 20 ft, from 164 yd
    bomb: () => said(tee(), SWING.bomb, 'DR'),
    striped: () => said(tee(), SWING.pure, 'DR'),
    perfect: () => said(at(0, 125, 'fairway'), ball(142, 13.5, { TotalSpin: 3400 }), 'W3'),   // a pure 3-wood, 300 out
    'great-shot': () => said(tee(), SWING.fade10, 'DR'),
    'nice-shot': () => said(tee(), SWING.fade18, 'DR'),
    'blast-off': () => said(tee({ mods: A.modifiersFor('rocket') }), SWING.pure, 'DR', { powerup: 'rocket' }),
    robbed: () => said(onGreen(3), roll(6, 4.8), 'PT'),                               // burns the edge at pace
    'so-close': () => said(onGreen(3), roll(4.05), 'PT'),                             // dies 11 in short
    terrible: () => said(fromFairway(), SWING.iron(118, { HLA: 6, SpinAxis: 14 }), 'I7'),
    'slice-house': () => said(tee(), SWING.slice35, 'DR'),
    'hook-city': () => said(tee(), SWING.hook40, 'DR'),
    shank: () => said(tee(), SWING.shank, 'DR'),
    'worm-burner': () => said(tee(), SWING.topped, 'DR'),
    'sky-ball': () => said(tee(), SWING.sky, 'DR'),
    chunk: () => said(tee(), SWING.fat, 'DR'),
    splash: () => lagoon,
    lava: () => said(tee(), SWING.wet, 'DR', { theme: 'volcano' }),
    ob: () => {
      const result = { ...lagoon.result, sim: { ...lagoon.result.sim, events: [] }, lie: 'rough', note: 'Out of bounds — drop where it left (+1)' };
      const grade = A.gradeShot({ result, before: lagoon.before });
      return { result, grade, id: grade.callout && grade.callout.id };
    },
    beach: () => said(fromFairway(), SWING.iron(118.5, { HLA: -8.5 }), 'I7'),
    timber: () => said(tee({ c: wood }), ball(150, 9), 'DR'),
    'on-fire': () => said(tee(), SWING.fade10, 'DR', { streak: 2 }),
    unstoppable: () => said(tee(), SWING.pure, 'DR', { streak: 4 }),
  };
  assert.deepEqual(Object.keys(cases).sort(), Object.keys(A.CALLOUTS).sort(), 'a case for every callout');
  for (const [id, shot] of Object.entries(cases)) {
    const r = shot();
    assert.equal(r.id, id, `${id}: got ${r.id} (${r.grade.grade}: ${r.grade.reasons.join('; ')})`);
    assert.deepEqual(r.grade.callout, { id, text: A.CALLOUTS[id].text, tone: A.CALLOUTS[id].tone, voice: id });
  }
  // the shots behind the mishits are what they are called
  assert.ok(cases['worm-burner']().result.sim.apexFt < 3);
  assert.ok(cases['sky-ball']().result.sim.apexFt > 120 && cases['sky-ball']().result.sim.carryYd < 140);
  assert.ok(cases.chunk().result.sim.carryYd < 140);
  assert.equal(cases.beach().result.lie, 'bunker');
  assert.ok(cases.timber().result.sim.events.some((e) => e.type === 'tree'));
  assert.ok(cases['pin-seeker']().result.distToPinYd * 3 <= 3);
  assert.ok(cases.bomb().result.sim.carryYd >= 290);
  // an OK shot or a plain miss gets no callout at all
  const short = said(fromFairway(), SWING.iron(100), 'I7');
  assert.deepEqual([short.grade.grade, short.grade.callout], ['OK', null]);
});

test('callouts: the priority order', () => {
  const withTree = (r) => ({ ...r, sim: { ...r.sim, events: [...r.sim.events, { type: 'tree', x: 0, y: 40, z: 5, part: 'crown' }] } });
  const regrade = (p, change, extra = {}) => { const g = A.gradeShot({ result: change(p.result), before: p.before, ...extra }); return g.callout && g.callout.id; };

  // 1 holed beats everything, the streak included
  assert.equal(said(fromFairway(), SWING.iron(121.4), 'I7', { streak: 2 }).id, 'holed-out');
  assert.equal(said(onGreen(3), roll(5), 'PT', { streak: 4 }).id, 'in-the-hole');
  // 2 a hazard beats the swing that put it there (25 degrees off line is a shank on dry land)
  assert.equal(said(tee(), SWING.wet, 'DR').id, 'splash');
  assert.equal(said(tee(), ball(95, 14, { HLA: 28 }), 'DR').id, 'shank');
  assert.equal(said(tee(), SWING.wet, 'DR', { theme: 'volcano', streak: 4 }).id, 'lava');
  assert.equal(said(tee(), SWING.wet, 'DR', { theme: 'tropical' }).id, 'splash');
  // 3 the streak callout fires on the shot that reaches 3 and 5, over a dart or a bomb, and only then
  const dart = () => said(fromFairway(), SWING.iron(120.5), 'I7');
  assert.deepEqual([0, 1, 2, 3, 4, 5, 7].map((streak) => said(fromFairway(), SWING.iron(120.5), 'I7', { streak }).id),
    ['dart', 'dart', 'on-fire', 'dart', 'unstoppable', 'dart', 'dart']);
  assert.deepEqual([2, 3, 4].map((streak) => said(tee(), SWING.bomb, 'DR', { streak }).id), ['on-fire', 'bomb', 'unstoppable']);
  assert.equal(said(tee(), SWING.fade18, 'DR', { streak: 2 }).id, 'nice-shot', 'a GOOD shot holds the streak: nothing is reached');
  assert.equal(said(tee(), SWING.slice35, 'DR', { streak: 2 }).id, 'slice-house', 'a mishit never extends one');
  // 4 at the pin beats a tree on the way and a mishit
  assert.equal(regrade(dart(), withTree), 'dart');
  assert.equal(regrade(said(fromFairway(), SWING.iron(117), 'I7'), withTree), 'dance-floor');
  // 5 timber beats the mishit behind it (still a MISS), a mishit beats the bunker it found, the grade and the rocket
  const slice = said(tee(), SWING.slice35, 'DR');
  assert.equal(regrade(slice, withTree), 'timber');
  assert.equal(A.gradeShot({ result: withTree(slice.result), before: slice.before }).grade, 'MISS');
  assert.equal(regrade(said(tee(), SWING.shank, 'DR'), (r) => ({ ...r, lie: 'bunker' })), 'shank');
  assert.equal(said(tee(), ball(95, 14, { HLA: -28, SpinAxis: -15 }), 'DR').id, 'shank', 'a shank beats the hook it also was');
  assert.equal(said(tee(), SWING.topped, 'DR').id, 'worm-burner', 'a topped driver is a worm burner before it is a chunk');
  assert.equal(said(tee({ mods: A.modifiersFor('rocket') }), SWING.hook40, 'DR', { powerup: 'rocket' }).id, 'hook-city');
  // 6 bomb beats striped beats the grade; a rocket-type ball is BLAST OFF, never a bomb
  const bomb = said(tee(), SWING.bomb, 'DR'), pure = said(tee(), SWING.pure, 'DR');
  assert.deepEqual([bomb.id, bomb.grade.grade, bomb.grade.tags.includes('straight')], ['bomb', 'PERFECT', true]);
  assert.deepEqual([pure.id, pure.grade.grade], ['striped', 'PERFECT']);
  for (const id of ['rocket', 'fireball', 'titan']) {
    assert.equal(said(tee({ mods: A.modifiersFor(id) }), ball(140, 12, { HLA: 1 }), 'DR', { powerup: id }).id, 'blast-off', id);
  }
  assert.equal(said(tee({ mods: A.modifiersFor('laser') }), SWING.fade18, 'DR', { powerup: 'laser' }).id, 'perfect', 'a Laser made it straight: not STRIPED');
  // a bomb that drives a 317 yd green is a bomb before it is "on the dance floor"
  const drivable = links();
  drivable.holes[0] = { ...drivable.holes[0], pin: [0, 290], lengthYd: 317, line: [[0, 0], [0, 290]] };
  drivable.surfaces.push({ kind: 'green', poly: [[-15, 265], [15, 265], [15, 310], [-15, 310]] });
  const drove = said(tee({ c: drivable }), SWING.bomb, 'DR');
  assert.deepEqual([drove.result.lie, drove.id], ['green', 'bomb']);
  // sand 13 ft from the pin is a missed green (OK, BEACH DAY), not a GREAT shot that builds a streak
  const trap = links();
  trap.surfaces.push({ kind: 'bunker', poly: [[2, 394], [9, 394], [9, 406], [2, 406]] });
  const sand = said(fromFairway({ c: trap }), SWING.iron(120, { HLA: 1.5 }), 'I7', { streak: 2 });
  assert.ok(sand.result.lie === 'bunker' && sand.result.distToPinYd * 3 < 25);
  assert.deepEqual([sand.grade.grade, sand.id], ['OK', 'beach']);
  // and a well-struck lay-up that runs into a fairway bunker is GOOD at best
  const cross = links();
  cross.surfaces.push({ kind: 'bunker', poly: [[-12, 340], [12, 340], [12, 362], [-12, 362]] });
  const layUp = said(fromFairway({ c: cross }), ball(85, 25.5, { TotalSpin: 9300 }), undefined, { streak: 2 });
  assert.equal(layUp.result.lie, 'bunker');
  assert.deepEqual([layUp.grade.grade, layUp.id], ['GOOD', 'beach']);
  assert.equal(said(fromFairway(), ball(85, 25.5, { TotalSpin: 9300 }), undefined, { streak: 2 }).id, 'on-fire', 'the same swing with no sand there is a GREAT one');
  // 7 and a mishit caps the grade: no streak, a MISS's points
  const topped = said(tee(), SWING.topped, 'DR', { streak: 2 });
  assert.equal(topped.result.lie, 'fairway');
  assert.deepEqual([topped.grade.grade, topped.grade.basePoints <= 180], ['MISS', true]);
});

test('callouts: putts and chips get their own, never the tee-shot ones', () => {
  const PUTT_IDS = [null, 'drained', 'in-the-hole', 'robbed', 'so-close', 'nice-shot'];
  for (const [metres, mph, hla] of [[3, 4, 0], [3, 12, 0], [3, 20, 30], [6, 4, 0], [6, 9, -25], [10, 7.2, 0], [10, 30, 40], [2, 3, 10], [12, 8.3, 0], [12, 8.4, 0]]) {
    const r = said(onGreen(metres), roll(mph, hla), 'PT');
    assert.equal(r.result.sim.isPutt, true);
    assert.ok(PUTT_IDS.includes(r.id), `putt ${metres} m at ${mph} mph, ${hla} deg: ${r.id}`);
    assert.ok(!r.grade.tags.includes('mishit'));
  }
  // a lag from 39 ft left 2 ft away is a NICE SHOT, a missed 10-footer is not
  assert.deepEqual([said(onGreen(12), roll(8.3), 'PT').id, said(onGreen(3), roll(4), 'PT').id], ['nice-shot', null]);
  // a putt rammed 34 ft past did not get robbed
  const rammed = said(onGreen(3), roll(9), 'PT');
  assert.ok(rammed.result.distToPinYd * 3 > 30);
  assert.equal(rammed.id, null);
  // the tap-in that is conceded afterwards does not hide a near miss
  const tapIn = said(onGreen(3, { mods: A.modifiersFor(null, { putting: 'off', dispersion: 1, tapInFt: 8 }) }), roll(4.05), 'PT');
  assert.equal(tapIn.result.holed, true);
  assert.equal(tapIn.id, 'so-close');

  // chips: from 20 yd
  const chip = (speed, extra = {}, more = {}) => said(at(...CHIP_SPOT, 'fairway'), SWING.chip(speed, extra), 'SW', more);
  assert.equal(chip(30.56).id, 'so-close');
  assert.ok(chip(30.56).result.distToPinYd * 3 <= 1);
  assert.equal(chip(31.5).id, 'robbed', 'ran over the edge and 3 ft by');
  assert.equal(chip(33).id, 'perfect', 'a chip to 9 ft is a good chip, not a DART');
  assert.equal(chip(35).id, 'great-shot');
  assert.equal(chip(15).id, 'chunk', 'flubbed 6 yd');
  assert.equal(chip(40, { HLA: 30 }).id, 'shank');
  for (const speed of [15, 25, 30.56, 31, 31.5, 33, 35, 45, 60]) {
    for (const extra of [{}, { HLA: 15, SpinAxis: 20 }, { HLA: -15, SpinAxis: -20 }]) {
      const r = chip(speed, extra, { streak: 0 });
      assert.ok(!['bomb', 'striped', 'slice-house', 'hook-city', 'sky-ball', 'terrible', 'worm-burner', 'blast-off', 'dart', 'pin-seeker', 'dance-floor'].includes(r.id), `chip ${speed}: ${r.id}`);
    }
  }
});

test('callouts are about the real swing: the assists do not hide a shank, partial swings are not chunks', () => {
  // dispersion 0.6 plays a 25 degree shank as 15 degrees: still a shank
  const g = tee({ mods: A.modifiersFor(null, { putting: 'off' }) });
  const shank = said(g, ball(100, 12, { HLA: -25, TotalSpin: 3000 }), 'DR');
  assert.equal(shank.result.launch.hla, -15);
  assert.equal(shank.result.arcadeShot.realLaunch.hla, -25);
  assert.equal(shank.id, 'shank');
  // a half wedge to a flag in range, a lay-up and a range session are no mishits
  assert.notEqual(said(at(0, 345, 'fairway'), ball(55, 30, { TotalSpin: 6000 }), 'SW').id, 'chunk');
  const range = new Game();
  range.setCourse(links());
  range.startPractice('range');
  const half = said(range, ball(60, 28, { TotalSpin: 7000 }), 'PW');
  assert.ok(half.result.sim.carryYd < 70);
  assert.ok(half.id !== 'chunk' && !half.grade.tags.includes('mishit'), String(half.id));
  // a low stinger is not a worm burner, a weak drive is not a sky ball
  assert.notEqual(said(tee(), ball(140, 7, { TotalSpin: 2800 }), 'DR').id, 'worm-burner');
  assert.notEqual(said(tee(), ball(130, 16, { TotalSpin: 3500 }), 'DR').id, 'sky-ball');
  // with no club named a sky ball is still one on a long hole; a thinned wedge from 60 yd is a worm burner
  assert.equal(said(tee(), SWING.sky).id, 'sky-ball');
  assert.equal(said(at(0, 345, 'fairway'), ball(72, 4, { TotalSpin: 3000 }), 'SW').id, 'worm-burner');
  // the shot in numbers, for the challenges
  const drive = said(tee(), SWING.pure, 'DR');
  assert.deepEqual(drive.grade.facts, {
    tee: true, putt: false, chip: false, holed: false, hazard: false, fairway: true, lie: 'fairway', straight: true,
    carryYd: 244.4, totalYd: 265.3, offlineYd: 0, fromYd: 437.4, leftFt: drive.result.distToPinYd * 3, fromFt: 437.4 * 3, boosted: false,
  });
});

// ---------- the economy hooks ----------

test('grants: weighted by rarity across the fifteen balls, and never a trick', () => {
  const n = 550;   // one draw for every unit of weight
  const s = new A.ArcadeState({ random: seq(...Array.from({ length: n }, (_, i) => (i + 0.5) / n)) });
  s.inventory = {};
  const got = Array.from({ length: n }, () => s.grantRandom());
  const balls = A.POWERUPS.filter((p) => p.kind === 'ball');
  assert.equal(balls.length, 15);
  for (const p of balls) assert.equal(s.owned(p.id), { common: 60, rare: 30, epic: 10 }[p.rarity], p.id);
  assert.ok(got.every((id) => A.POWERUPS.find((p) => p.id === id).kind === 'ball'));
  for (const trick of ['gust', 'tiny-cup', 'fog']) assert.equal(s.owned(trick), 0);
  const rare = new A.ArcadeState({ random: seq(...Array.from({ length: 190 }, (_, i) => (i + 0.5) / 190)) });
  rare.inventory = {};
  for (let i = 0; i < 190; i++) rare.grantRandom({ rare: true });
  assert.deepEqual(Object.keys(rare.inventory).sort(), balls.filter((p) => p.rarity !== 'common').map((p) => p.id).sort());
});

test('a trick is never on the solo shelf: not granted, not kept, and arming one is a clear error', () => {
  const dir = tmpDir();
  const s = new A.ArcadeState({ dataDir: dir, log: quiet });
  for (const id of ['gust', 'tiny-cup', 'fog']) {
    assert.throws(() => s.arm(id), (e) => e instanceof A.ArcadeError && e.code === 'TRICK_NEEDS_OPPONENT' && /match/.test(e.message));
  }
  s.setUnlimited(true);
  assert.throws(() => s.arm('fog'), (e) => e.code === 'TRICK_NEEDS_OPPONENT', 'not in unlimited mode either');
  assert.equal(s.arm('fireball'), 'fireball', 'every ball is on the unlimited shelf, the new ones too');
  assert.equal(s.consumeArmed(), 'fireball');
  s.setUnlimited(false);
  assert.equal(s.grant('gust'), false);
  assert.deepEqual(s.inventory, { rocket: 1, magnet: 1 });
  // a hand-edited file with tricks in it
  fs.writeFileSync(path.join(dir, 'arcade.json'), JSON.stringify({ version: 2, state: { inventory: { gust: 3, yoyo: 2 }, armed: 'gust' } }));
  const loaded = new A.ArcadeState({ dataDir: dir, log: quiet });
  assert.deepEqual([loaded.inventory, loaded.armed], [{ yoyo: 2 }, null]);
  // the catalogue the HUD gets has all eighteen, tricks marked
  const snap = loaded.snapshot();
  assert.equal(snap.powerups.length, 18);
  assert.deepEqual(snap.powerups.filter((p) => p.kind === 'trick').map((p) => p.id), ['gust', 'tiny-cup', 'fog']);
  assert.deepEqual(snap.powerups[7], { id: 'fireball', name: 'Fireball', emoji: '🔥', rarity: 'epic', tagline: A.POWERUPS[7].tagline, kind: 'ball', color: 0xff3d00 });
});

test('grantBalls and addCoins: add to the bay, save, and answer with the snapshot', () => {
  const dir = tmpDir();
  const s = new A.ArcadeState({ dataDir: dir, log: quiet });
  const snap = s.grantBalls(['fireball', 'ghost', 'fireball', 'gust', 'banana', null]);
  assert.deepEqual(snap.inventory, { rocket: 1, magnet: 1, fireball: 2, ghost: 1 }, 'tricks and unknown ids are skipped');
  assert.deepEqual(snap, s.snapshot());
  assert.deepEqual(s.grantBalls('gold').inventory.gold, 1, 'one id works too');
  assert.deepEqual(s.grantBalls([]).inventory, s.inventory);
  assert.deepEqual(s.grantBalls(undefined).inventory, s.inventory);
  assert.equal(s.arm('fireball'), 'fireball', 'a granted ball can be armed');

  assert.equal(s.addCoins(250).coins, 250);
  assert.equal(s.addCoins(40.9).coins, 290, 'whole coins');
  assert.equal(s.addCoins(-90).coins, 200, 'a negative amount spends');
  assert.equal(s.addCoins(-5000).coins, 0, 'never below zero');
  assert.equal(s.addCoins(75).coins, 75);
  for (const junk of [NaN, Infinity, 'lots', null, undefined]) assert.equal(s.addCoins(junk).coins, 75);
  assert.equal(s.addCoins('25').coins, 100);
  assert.deepEqual(Object.keys(s.addCoins(0)).includes('powerups'), true, 'the snapshot');

  const back = new A.ArcadeState({ dataDir: dir, log: quiet });
  assert.deepEqual([back.coins, back.inventory, back.armed], [100, { rocket: 1, magnet: 1, fireball: 2, ghost: 1, gold: 1 }, 'fireball']);
  assert.deepEqual(back.snapshot(), s.snapshot());
  // in memory only: nothing to save, still works
  assert.equal(new A.ArcadeState().addCoins(5).coins, 5);
});

test('an arcade.json from before v2 loads as it was, with three fresh challenges', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'arcade.json');
  const old = {
    version: 1,
    state: {
      enabled: true, unlimited: true, assist: { putting: 'assist', dispersion: 0.8, tapInFt: 4 },
      coins: 420, xp: 3200, level: 3, streak: 2, bestStreak: 5, shots: 40, inventory: { rocket: 2, sticky: 1 }, armed: 'rocket',
      history: [{ shotId: 7, grade: 'GREAT', points: 700, powerup: 'sticky', at: 1794723201762 }],
    },
  };
  fs.writeFileSync(file, JSON.stringify(old, null, 2));
  const s = new A.ArcadeState({ dataDir: dir, log: quiet });
  assert.deepEqual(
    [s.enabled, s.unlimited, s.coins, s.xp, s.level, s.streak, s.bestStreak, s.shots, s.armed],
    [true, true, 420, 3200, 3, 2, 5, 40, 'rocket'],
  );
  assert.deepEqual(s.assist, old.state.assist);
  assert.deepEqual(s.inventory, old.state.inventory);
  assert.deepEqual(s.history, old.state.history);
  const snap = s.snapshot();
  assert.deepEqual(snap.challenges.map((c) => [c.id, c.progress, c.done]), [['fairways-3', 0, false], ['inside-10', 0, false], ['great-5', 0, false]]);
  assert.equal(snap.powerups.length, 18);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 1, 'loading does not rewrite the file');
  s.addCoins(1);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.state.challenges, [{ id: 'fairways-3', progress: 0 }, { id: 'inside-10', progress: 0 }, { id: 'great-5', progress: 0 }]);
  assert.deepEqual([saved.state.coins, saved.state.inventory, saved.state.armed], [421, { rocket: 2, sticky: 1 }, 'rocket']);
});

// ---------- challenges ----------

test('challenges: a pool of shot-level goals, every reward a real ball', () => {
  assert.ok(A.CHALLENGES.length >= 20, `${A.CHALLENGES.length} in the pool`);
  assert.equal(new Set(A.CHALLENGES.map((c) => c.id)).size, A.CHALLENGES.length);
  const drive = said(tee(), SWING.pure, 'DR').grade;
  for (const c of A.CHALLENGES) {
    assert.ok(c.text && c.goal >= 1 && c.coins > 0, c.id);
    for (const id of c.balls) assert.equal(A.POWERUPS.find((p) => p.id === id).kind, 'ball', `${c.id}: ${id}`);
    const x = { f: drive.facts, grade: drive.grade, points: drive.points, callout: drive.callout.id, powerup: null, streak: 1 };
    const p = c.next(0, x);
    assert.ok(Number.isFinite(p) && p >= 0, `${c.id}: ${p}`);
  }
  for (const text of ['Hit 3 fairways in a row', 'Stick one inside 10 feet', 'Carry a drive 250 yards']) {
    assert.ok(A.CHALLENGES.some((c) => c.text === text), text);
  }
});

test('challenges: three live; real shots move them on; a finished one pays coins and balls and is replaced', () => {
  const dir = tmpDir();
  const s = new A.ArcadeState({ dataDir: dir, log: quiet, random: () => 0 });
  s.inventory = {};
  const live = () => s.snapshot().challenges.map((c) => [c.id, c.progress]);
  assert.deepEqual(s.snapshot().challenges[0], {
    id: 'fairways-3', text: 'Hit 3 fairways in a row', progress: 0, goal: 3, done: false, reward: { coins: 150, balls: ['bouncy'] },
  });
  assert.deepEqual(live(), [['fairways-3', 0], ['inside-10', 0], ['great-5', 0]]);
  // a grade that did not come from a shot moves nothing
  assert.deepEqual(s.applyShot(G('GREAT', 100, 10)).challenges, []);
  assert.deepEqual(live(), [['fairways-3', 0], ['inside-10', 0], ['great-5', 0]]);

  let shotId = 0;
  const bank = (g, b, club) => {
    const p = played(g, b, club, { streak: s.streak });
    return s.applyShot(p.grade, { shotId: ++shotId });
  };
  assert.deepEqual(bank(tee(), SWING.pure, 'DR').challenges, []);
  assert.deepEqual(live(), [['fairways-3', 1], ['inside-10', 0], ['great-5', 1]]);
  bank(fromFairway(), SWING.iron(100), 'I7');   // not a tee shot: the fairway run stands
  assert.deepEqual(live(), [['fairways-3', 1], ['inside-10', 0], ['great-5', 1]]);
  bank(tee(), SWING.slice35, 'DR');             // a tee shot in the rough: back to none
  assert.deepEqual(live(), [['fairways-3', 0], ['inside-10', 0], ['great-5', 1]]);
  bank(tee(), SWING.pure, 'DR');
  bank(tee(), SWING.pure, 'DR');
  assert.deepEqual(live(), [['fairways-3', 2], ['inside-10', 0], ['great-5', 3]]);
  const coins = s.coins, bouncy = s.owned('bouncy');
  const third = bank(tee(), SWING.pure, 'DR');
  assert.deepEqual(third.challenges, [{
    id: 'fairways-3', text: 'Hit 3 fairways in a row', progress: 3, goal: 3, done: true, reward: { coins: 150, balls: ['bouncy'] },
  }]);
  assert.equal(s.coins, coins + third.awarded.coins + 150);
  assert.equal(s.owned('bouncy'), bouncy + 1);
  assert.deepEqual(live(), [['inside-10', 0], ['great-5', 4], ['carry-200', 0]], 'the next one in the pool takes its place');
  assert.equal(s.snapshot().challengesDone, 1);

  // an approach to 4 ft finishes two at once: inside 10 ft, and the fifth GREAT-or-better
  const dart = bank(fromFairway(), SWING.iron(120.5), 'I7');
  assert.deepEqual(dart.challenges.map((c) => c.id), ['inside-10', 'great-5']);
  assert.deepEqual(live(), [['carry-200', 0], ['putt-10', 0], ['straight-3', 0]]);
  assert.ok(s.owned('sticky') >= 1 && s.owned('windcutter') >= 1);
  // saved with the rest, and read back
  bank(tee(), SWING.pure, 'DR');   // carries 244: done, and one dead-straight shot
  assert.deepEqual(live(), [['putt-10', 0], ['straight-3', 1], ['greens-3', 0]]);
  const back = new A.ArcadeState({ dataDir: dir, log: quiet });
  assert.deepEqual(back.snapshot().challenges, s.snapshot().challenges);
  assert.deepEqual([back.challengesDone, back.coins, back.inventory], [4, s.coins, s.inventory]);
  // a rocket's carry is not yours; a holed 20-footer is
  assert.deepEqual(bank(onGreen(6), roll(6.5), 'PT').challenges.map((c) => c.id), ['putt-10']);
  // a hand-edited file: unknown ids dropped, progress kept below the goal, three live again
  fs.writeFileSync(path.join(dir, 'arcade.json'), JSON.stringify({ version: 2, state: { challenges: [{ id: 'banana', progress: 2 }, { id: 'great-5', progress: 99 }, { id: 'great-5', progress: 1 }], challengeCursor: 4 } }));
  const cleaned = new A.ArcadeState({ dataDir: dir, log: quiet });
  assert.deepEqual(cleaned.snapshot().challenges.map((c) => [c.id, c.progress]), [['great-5', 4], ['putt-10', 0], ['straight-3', 0]]);
  // reset starts them again
  s.reset();
  assert.deepEqual(live(), [['fairways-3', 0], ['inside-10', 0], ['great-5', 0]]);
  assert.equal(s.snapshot().challengesDone, 0);
});
