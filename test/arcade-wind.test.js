'use strict';
// Wind per hole (lib/arcade-wind.js, docs/dev/arcade-v2-contract.md section 5): the roll (range,
// whole mph, determinism, the lean late in a series), the wind read against the hole's
// tee-to-pin line, the bay's keeper (rolled onto the game's conditions, the day's held
// aside and put back), what a rolled wind does to a real 7-iron (and to a Windcutter and a
// Gust), and the match engine carrying it on stage.wind.
// The server's side of it (routes, a real match) is test/arcade-wind-server.test.mjs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../lib/game');
const { DEFAULTS, normalizeConditions } = require('../lib/conditions');
const { modifiersFor } = require('../lib/arcade');
const { createMatch, normalizeTour } = require('../lib/match');
const {
  WIND_RANGES, createStageWind, describeWind, gameWind, isArcadeStage, pendingWind, playBearing, rollWind, seededRandom, windConditions, windRange,
} = require('../lib/arcade-wind');

const NORTH = { tee: [0, 0], pin: [0, 400] };
// the given numbers in turn, then the last one for ever
const rng = (...values) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };
const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;

// ---------- the range ----------

test('the range: the stage\'s own wind, else what its conditions stand for, else calm', () => {
  assert.deepEqual(WIND_RANGES, { calm: [0, 5], breezy: [6, 12], windy: [12, 22] });
  assert.deepEqual(windRange({ wind: { min: 6, max: 16 }, conditions: 'calm' }), { min: 6, max: 16 }, 'wind wins over conditions');
  assert.deepEqual(windRange({ conditions: 'calm' }), { min: 0, max: 5 });
  assert.deepEqual(windRange({ conditions: 'breezy' }), { min: 6, max: 12 });
  assert.deepEqual(windRange({ conditions: 'Windy' }), { min: 12, max: 22 });
  for (const nothing of [null, undefined, {}, { conditions: 'gale' }, { wind: null }, { wind: 'strong' }, { wind: { min: 'x' } }, 7]) {
    assert.deepEqual(windRange(nothing), { min: 0, max: 5 }, `calm for ${JSON.stringify(nothing)}`);
  }
  // whatever a hole file says: whole mph, 0 to 40, the right way round
  assert.deepEqual(windRange({ wind: { min: 16, max: 6 } }), { min: 6, max: 16 });
  assert.deepEqual(windRange({ wind: { min: -4, max: 90 } }), { min: 0, max: 40 });
  assert.deepEqual(windRange({ wind: { min: 4.2, max: 9.8 } }), { min: 5, max: 9 });
  assert.deepEqual(windRange({ wind: { min: 7.2, max: 7.6 } }), { min: 7, max: 7 }, 'a range inside one mph');
  assert.deepEqual(windRange({ wind: { min: '8', max: '14' } }), { min: 8, max: 14 });
  assert.deepEqual(windRange({ wind: { max: 9 } }), { min: 0, max: 9 });
  assert.deepEqual(windRange({ wind: { min: 9 } }), { min: 9, max: 9 });
});

test('an arcade stage is a course whose arcade block names a theme', () => {
  assert.equal(isArcadeStage({ arcade: { theme: 'volcano', formatVersion: 2 } }), true);
  assert.equal(isArcadeStage({ arcade: { id: 'arcade-classics', formatVersion: 1 } }), false, 'the three-hole collection is not one');
  assert.equal(isArcadeStage({ arcade: null }), false);
  assert.equal(isArcadeStage({ name: 'St Andrews' }), false);
  assert.equal(isArcadeStage(null), false);
});

// ---------- the roll ----------

test('a roll: a whole speed inside the range, any direction, both ends of the range in reach', () => {
  const random = seededRandom(20261122);
  const speeds = new Set(), sectors = new Set();
  for (let i = 0; i < 4000; i++) {
    const w = rollWind({ arcade: { wind: { min: 6, max: 16 } }, hole: NORTH, random });
    assert.ok(Number.isInteger(w.mph) && w.mph >= 6 && w.mph <= 16, `speed ${w.mph}`);
    assert.ok(Number.isInteger(w.dirDeg) && w.dirDeg >= 0 && w.dirDeg <= 359, `direction ${w.dirDeg}`);
    assert.deepEqual([w.min, w.max, w.rolled], [6, 16, true]);
    speeds.add(w.mph);
    sectors.add(Math.floor(w.dirDeg / 30));
  }
  assert.deepEqual([...speeds].sort((a, b) => a - b), [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 'every speed of the range comes up');
  assert.equal(sectors.size, 12, 'all round the compass');
  // the extremes of the generator stay inside
  assert.equal(rollWind({ range: { min: 12, max: 22 }, random: rng(0, 0) }).mph, 12);
  assert.equal(rollWind({ range: { min: 12, max: 22 }, random: rng(0.999999, 0.999999) }).mph, 22);
  assert.equal(rollWind({ range: { min: 12, max: 22 }, random: rng(1, 1) }).mph, 22, 'a generator that answers 1');
  assert.equal(rollWind({ range: { min: 12, max: 22 }, random: rng(1, 1) }).dirDeg, 0);
  assert.equal(rollWind({ range: { min: 0, max: 0 }, random: rng(0.7, 0.3) }).label, 'NO WIND');
  // the range comes from the stage's conditions when it has no wind of its own
  for (let i = 0; i < 200; i++) {
    const w = rollWind({ arcade: { theme: 'links', conditions: 'windy' }, random });
    assert.ok(w.mph >= 12 && w.mph <= 22);
    const c = rollWind({ arcade: { theme: 'tropical' }, random });
    assert.ok(c.mph >= 0 && c.mph <= 5);
  }
});

test('a roll is the generator\'s: the same seed rolls the same winds, another seed others', () => {
  const run = (seed) => { const random = seededRandom(seed); return Array.from({ length: 9 }, (_, i) => rollWind({ arcade: { conditions: 'windy' }, hole: NORTH, progress: i / 8, random })); };
  assert.deepEqual(run(7), run(7));
  assert.notDeepEqual(run(7).map((w) => [w.mph, w.dirDeg]), run(8).map((w) => [w.mph, w.dirDeg]));
  // two draws a roll: the speed, then the direction
  let draws = 0;
  rollWind({ arcade: { conditions: 'breezy' }, random: () => { draws++; return 0.5; } });
  assert.equal(draws, 2);
  assert.deepEqual(
    (({ mph, dirDeg }) => ({ mph, dirDeg }))(rollWind({ range: { min: 6, max: 12 }, random: rng(0.5, 0.25) })),
    { mph: 9, dirDeg: 90 },
  );
});

test('late in a series the speed leans toward the top of the range', () => {
  const speeds = (progress, seed = 99) => { const random = seededRandom(seed); return Array.from({ length: 6000 }, () => rollWind({ range: { min: 0, max: 20 }, progress, random }).mph); };
  const early = mean(speeds(0)), mid = mean(speeds(0.5)), late = mean(speeds(1));
  assert.ok(Math.abs(early - 10) < 0.4, `hole one is even across the range (mean ${early.toFixed(2)})`);
  assert.ok(mid > early + 2 && late > mid + 1, `means rise: ${early.toFixed(2)}, ${mid.toFixed(2)}, ${late.toFixed(2)}`);
  assert.ok(Math.abs(late - 15) < 0.6, `the last hole: as the best of three draws (mean ${late.toFixed(2)})`);
  assert.ok(Math.min(...speeds(1)) === 0 && Math.max(...speeds(1)) === 20, 'still the whole range');
  // the same draw never gets lighter as the match goes on
  for (const u of [0.05, 0.3, 0.5, 0.8, 0.97]) {
    const at = (progress) => rollWind({ range: { min: 6, max: 16 }, progress, random: rng(u, 0) }).mph;
    assert.ok(at(0) <= at(0.5) && at(0.5) <= at(1), `draw ${u}: ${at(0)}, ${at(0.5)}, ${at(1)}`);
  }
  assert.equal(rollWind({ range: { min: 6, max: 16 }, progress: 0, random: rng(0.5, 0) }).mph, 11);
  assert.equal(rollWind({ range: { min: 6, max: 16 }, progress: 1, random: rng(0.5, 0) }).mph, 15);
  // junk for progress is hole one
  for (const junk of [undefined, null, NaN, -3, 'late']) assert.equal(rollWind({ range: { min: 6, max: 16 }, progress: junk, random: rng(0.5, 0) }).mph, 11);
  assert.equal(rollWind({ range: { min: 6, max: 16 }, progress: 7, random: rng(0.5, 0) }).mph, 15, 'past the end is the end');
});

// ---------- the wind read against the hole ----------

test('a wind is described against the tee-to-pin line: all four quadrants and the four straight ones', () => {
  const d = (dirDeg, hole = NORTH, mph = 12) => { const w = describeWind(mph, dirDeg, hole); return [w.cross, w.along, w.relDeg, w.label]; };
  // a hole played due north; dirDeg is where the wind comes FROM
  assert.deepEqual(d(180), [null, 'tail', 0, '12 MPH · HELPING']);
  assert.deepEqual(d(0), [null, 'head', 180, '12 MPH · HURTING']);
  assert.deepEqual(d(270), ['R', null, 90, '12 MPH · LEFT TO RIGHT']);
  assert.deepEqual(d(90), ['L', null, -90, '12 MPH · RIGHT TO LEFT']);
  assert.deepEqual(d(225), ['R', 'tail', 45, '12 MPH · LEFT TO RIGHT · HELPING']);
  assert.deepEqual(d(135), ['L', 'tail', -45, '12 MPH · RIGHT TO LEFT · HELPING']);
  assert.deepEqual(d(315), ['R', 'head', 135, '12 MPH · LEFT TO RIGHT · HURTING']);
  assert.deepEqual(d(45), ['L', 'head', -135, '12 MPH · RIGHT TO LEFT · HURTING']);
  // a component under 38 % of the wind is not called
  assert.deepEqual(d(190).slice(0, 2), [null, 'tail']);
  assert.deepEqual(d(205).slice(0, 2), ['R', 'tail']);
  assert.deepEqual(d(260).slice(0, 2), ['R', null]);
  // the same wind on a hole played another way reads another way
  const east = { tee: [10, 20], pin: [310, 20] }, southWest = { tee: { x: 0, y: 0 }, pin: { x: -200, y: -200 } };
  assert.deepEqual(d(270, east), [null, 'tail', 0, '12 MPH · HELPING']);
  assert.deepEqual(d(180, east), ['L', null, -90, '12 MPH · RIGHT TO LEFT']);
  assert.deepEqual(d(45, southWest), [null, 'tail', 0, '12 MPH · HELPING']);
  assert.deepEqual(d(315, southWest), ['L', null, -90, '12 MPH · RIGHT TO LEFT']);
  assert.deepEqual(d(270, 90), [null, 'tail', 0, '12 MPH · HELPING'], 'or against a bearing');
  assert.equal(playBearing(NORTH), 0);
  assert.equal(playBearing(east), 90);
  assert.equal(playBearing({ tee: [0, 0], pin: [0, 0] }), null);
  // the components: + pushes the ball right, + helps
  const w = describeWind(15, 225, NORTH);
  assert.deepEqual([w.crossMph, w.alongMph], [10.6, 10.6]);
  assert.deepEqual([describeWind(15, 45, NORTH).crossMph, describeWind(15, 45, NORTH).alongMph], [-10.6, -10.6]);
  // strength: calm 0 to 5, moderate 6 to 12, strong 13 and up
  assert.deepEqual([0, 5, 6, 12, 13, 22].map((mph) => describeWind(mph, 0, NORTH).strength), ['calm', 'calm', 'moderate', 'moderate', 'strong', 'strong']);
  // nothing to read: no wind, or no line to read it against
  assert.deepEqual(describeWind(0, 123, NORTH), { mph: 0, dirDeg: 123, relDeg: null, cross: null, along: null, crossMph: 0, alongMph: 0, strength: 'calm', label: 'NO WIND', min: null, max: null, rolled: false });
  assert.deepEqual(d(270, null), [null, null, null, '12 MPH']);
  assert.equal(describeWind(11.6, 359.7, NORTH).mph, 12, 'whole mph');
  assert.equal(describeWind(11.6, 359.7, NORTH).dirDeg, 0, 'the bearing wraps');
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(rollWind({ arcade: null, hole: NORTH }))));
});

test('a stage that is still to be loaded has its range only', () => {
  assert.deepEqual(pendingWind({ id: 'midnight-mile', wind: { min: 6, max: 16 } }), {
    mph: null, dirDeg: null, relDeg: null, cross: null, along: null, crossMph: null, alongMph: null, strength: null, label: '6 TO 16 MPH', min: 6, max: 16, rolled: false,
  });
  assert.equal(pendingWind({ conditions: 'windy' }).label, '12 TO 22 MPH');
  assert.equal(pendingWind({ wind: { min: 8, max: 8 } }).label, '8 MPH');
  assert.equal(pendingWind({ id: 'lagoon-island' }), null, 'a manifest entry that says nothing: not known yet');
  assert.equal(pendingWind(null), null);
  // the tour manifest carries it into the match's stages
  const tour = normalizeTour({ stages: [{ id: 'a', file: 'a.json', wind: { min: 4, max: 10 } }, { id: 'b', file: 'b.json' }], tiebreaks: [{ id: 't', file: 't.json', conditions: 'breezy' }] });
  assert.deepEqual(tour.stages.map((s) => s.wind && [s.wind.min, s.wind.max, s.wind.mph]), [[4, 10, null], null]);
  assert.deepEqual([tour.tiebreaks[0].wind.min, tour.tiebreaks[0].wind.max], [6, 12]);
});

// ---------- the bay's keeper, on a real Game ----------

const stage = (arcade, pin = [0, 400]) => ({
  name: 'Stage', surfaces: [], boundary: null, elevation: null, arcade,
  holes: [{ ref: 1, par: 4, tee: [0, 0], pin, lengthYd: 437, line: [[0, 0], pin] }],
});
const realCourse = () => ({
  name: 'Home Course', surfaces: [], boundary: null, elevation: null,
  holes: [{ ref: 1, par: 4, tee: [0, 0], pin: [0, 400], lengthYd: 437 }, { ref: 2, par: 4, tee: [0, 0], pin: [300, 0], lengthYd: 328 }],
});
const newGame = (course) => { const g = new Game({ surfaceLookupFactory: () => () => 'fairway' }); if (course) g.setCourse(course); return g; };
const I7 = { Speed: 111, VLA: 19, HLA: 0, TotalSpin: 7000, SpinAxis: 0 };   // 150 yd of carry on a still day

test('the keeper rolls onto the game\'s conditions, holds the day\'s aside and puts them back', () => {
  const g = newGame(realCourse());
  g.setConditions({ preset: 'links' });
  const links = g.conditions;
  const keeper = createStageWind({ game: g, random: seededRandom(5) });
  // a real course: nothing is rolled, nothing changes
  assert.equal(keeper.roll(), null);
  assert.deepEqual([g.conditions, keeper.held, keeper.current, keeper.day], [links, false, null, null]);

  // an arcade stage comes up: its wind, steady, in standard air
  g.setCourse(stage({ theme: 'links', conditions: 'windy' }));
  const w1 = keeper.roll();
  assert.ok(w1.mph >= 12 && w1.mph <= 22 && w1.rolled);
  assert.deepEqual(g.conditions, { ...DEFAULTS, windMph: w1.mph, windFromDeg: w1.dirDeg });
  assert.deepEqual(g.conditions, windConditions(w1));
  assert.deepEqual([g.state().conditions.windMph, g.state().conditions.windFromDeg], [w1.mph, w1.dirDeg], 'what the HUD\'s wind dial reads');
  assert.deepEqual(gameWind(g), { ...w1, min: null, max: null, rolled: false }, 'the game\'s wind read back is the rolled one');
  assert.deepEqual([keeper.held, keeper.day, keeper.current], [true, links, w1]);

  // the next hole, a restart, another stage: rolled again; the day's conditions stay aside
  const w2 = keeper.roll({ progress: 1 });
  assert.notDeepEqual([w2.mph, w2.dirDeg], [w1.mph, w1.dirDeg]);
  assert.deepEqual(g.conditions, windConditions(w2));
  g.setCourse(stage({ theme: 'neon', conditions: 'calm', wind: { min: 6, max: 16 } }));
  const w3 = keeper.roll();
  assert.ok(w3.mph >= 6 && w3.mph <= 16);
  assert.deepEqual([w3.min, w3.max], [6, 16]);
  assert.equal(keeper.day, links);

  // back on a real course (or restore()): the day's conditions exactly as they were
  g.setCourse(realCourse());
  assert.equal(keeper.roll(), null);
  assert.deepEqual([g.conditions, keeper.held, keeper.current], [links, false, null]);
  g.setCourse(stage({ theme: 'links' }));
  keeper.roll();
  keeper.restore();
  assert.deepEqual([g.conditions, keeper.held], [links, false]);
  keeper.restore();
  assert.deepEqual(g.conditions, links, 'restoring twice is harmless');
});

test('a change made by hand during a rolled wind is the day\'s too, and never saves the roll', () => {
  const g = newGame(stage({ theme: 'links', conditions: 'windy' }));
  g.setConditions({ preset: 'hot' });
  const keeper = createStageWind({ game: g, random: seededRandom(11) });
  assert.deepEqual(keeper.changed({ greenStimp: 12 }), g.conditions, 'no roll in force: the game\'s conditions are the day\'s');
  const w = keeper.roll();
  // the player speeds the greens up from the conditions panel (POST /api/conditions)
  g.setConditions({ greenStimp: 12 });
  const toSave = keeper.changed({ greenStimp: 12 });
  assert.deepEqual(toSave, normalizeConditions({ tempF: 95, firmness: 0.7, greenStimp: 12 }), 'what is kept: the day\'s, with the change, without the rolled wind');
  assert.deepEqual([g.conditions.windMph, g.conditions.greenStimp], [w.mph, 12], 'this hole plays the rolled wind on the faster greens');
  assert.equal(keeper.current.rolled, true);
  // ... or takes the wind into their own hands: the wind in force is what the game plays
  g.setConditions({ windMph: 3, windFromDeg: 90 });
  keeper.changed({ windMph: 3, windFromDeg: 90 });
  assert.deepEqual([keeper.current.mph, keeper.current.dirDeg, keeper.current.rolled], [3, 90, false]);
  keeper.restore();
  assert.deepEqual(g.conditions, normalizeConditions({ tempF: 95, firmness: 0.7, greenStimp: 12, windMph: 3, windFromDeg: 90 }));
});

// ---------- what it does to a ball ----------

// A 7-iron (111 mph, 19 degrees, 7,000 rpm, dead straight) on a hole played due north, in
// a wind rolled at exactly 15 mph from `fromDeg`.
function sevenIron(fromDeg, mods = null) {
  const g = newGame(stage({ theme: 'links', wind: { min: 15, max: 15 } }));
  const wind = createStageWind({ game: g, random: rng(0.5, fromDeg / 360) }).roll();
  g.shotMods = mods;
  const r = g.handleShot(I7);
  return { wind, carryYd: r.sim.carryYd, offlineYd: r.sim.offlineYd, x: r.end.x, shotWind: r.wind };
}

test('a rolled 15 mph crosswind moves a 7-iron more than 20 yards, the way the label says', () => {
  const still = newGame(stage({ theme: 'links' })).handleShot(I7);
  assert.deepEqual([still.sim.carryYd, still.sim.offlineYd], [149.6, 0], 'a still day: 150 yd, on the line');

  const l2r = sevenIron(270);
  assert.deepEqual([l2r.wind.label, l2r.wind.cross, l2r.wind.crossMph], ['15 MPH · LEFT TO RIGHT', 'R', 15]);
  assert.deepEqual(l2r.shotWind, { speedMph: 15, fromDeg: 270, gustMph: 0 }, 'the shot met the rolled wind, steady');
  assert.ok(l2r.offlineYd > 20 && l2r.offlineYd < 26, `22 yd right (${l2r.offlineYd})`);
  assert.ok(l2r.x > 18, `it finished ${l2r.x.toFixed(1)} m right of the line`);

  const r2l = sevenIron(90);
  assert.deepEqual([r2l.wind.label, r2l.wind.cross], ['15 MPH · RIGHT TO LEFT', 'L']);
  assert.equal(r2l.offlineYd, -l2r.offlineYd, 'the mirror image');

  // into it and with it: 25 yd shorter, 15 yd longer, still on the line
  const into = sevenIron(0), down = sevenIron(180);
  assert.deepEqual([into.wind.label, down.wind.label], ['15 MPH · HURTING', '15 MPH · HELPING']);
  assert.ok(into.carryYd < 128 && into.carryYd > 120, `into the wind: ${into.carryYd} yd`);
  assert.ok(down.carryYd > 160 && down.carryYd < 168, `downwind: ${down.carryYd} yd`);
  assert.ok(Math.abs(into.offlineYd) < 0.5 && Math.abs(down.offlineYd) < 0.5);

  // the quadrants: both things at once
  const quarter = sevenIron(225), against = sevenIron(45);
  assert.equal(quarter.wind.label, '15 MPH · LEFT TO RIGHT · HELPING');
  assert.ok(quarter.offlineYd > 10 && quarter.carryYd > 155, `${quarter.offlineYd} yd right, ${quarter.carryYd} yd`);
  assert.equal(against.wind.label, '15 MPH · RIGHT TO LEFT · HURTING');
  assert.ok(against.offlineYd < -14 && against.carryYd < 140, `${against.offlineYd} yd, ${against.carryYd} yd`);
});

test('the Windcutter ignores the rolled wind; a Gust comes on top of it for one shot', () => {
  const plain = sevenIron(270);
  const cutter = sevenIron(270, modifiersFor('windcutter'));
  assert.deepEqual([cutter.carryYd, cutter.offlineYd], [149.6, 0], 'as on a still day');
  assert.equal(cutter.shotWind.speedMph, 15, 'the wind is still the hole\'s: the ball does not feel it');
  // the trick's 25 mph crosswind from the left, with the hole's: 40 mph of it
  const withIt = sevenIron(270, modifiersFor(null, null, { curses: ['gust'], random: () => 0.9 }));
  assert.ok(withIt.offlineYd > plain.offlineYd + 35, `${withIt.offlineYd} yd right against ${plain.offlineYd}`);
  // ... from the right, against the hole's 15: it wins, the ball goes left
  const againstIt = sevenIron(270, modifiersFor(null, null, { curses: ['gust'], random: () => 0.1 }));
  assert.ok(againstIt.offlineYd < -10, `${againstIt.offlineYd} yd`);
  // the next ball is back in the hole's wind alone
  const g = newGame(stage({ theme: 'links', wind: { min: 15, max: 15 } }));
  createStageWind({ game: g, random: rng(0.5, 0.75) }).roll();
  g.shotMods = modifiersFor(null, null, { curses: ['gust'], random: () => 0.9 });
  g.handleShot(I7);
  g.shotMods = null;
  g.reset();
  assert.equal(g.handleShot(I7).sim.offlineYd, plain.offlineYd);
});

// ---------- the match carries it ----------

const PLAYERS = [{ id: 'p1', name: 'Alex' }, { id: 'p2', name: 'Dave' }];
const entry = (n, extra = {}) => ({ id: `s${n}`, order: n, file: `s${n}.json`, name: `Stage ${n}`, par: 4, lengthYd: 437, theme: 'links', ...extra });
const TOUR = { stages: [entry(1, { wind: { min: 6, max: 16 } }), entry(2), entry(3)], tiebreaks: [{ id: 'a1', order: 1, file: 'a1.json', name: 'Arena', par: 3, lengthYd: 150, theme: 'stadium', wind: { min: 0, max: 6 } }] };
const COURSE = {
  's1.json': () => stage({ theme: 'links', conditions: 'calm', wind: { min: 6, max: 16 } }),
  's2.json': () => stage({ theme: 'links', conditions: 'windy' }, [300, 0]),   // played due east
  's3.json': () => stage({ theme: 'links', conditions: 'breezy' }),
  'a1.json': () => stage({ theme: 'stadium', wind: { min: 0, max: 6 } }, [0, 137]),
};

test('a match: every hole has its own wind on stage.wind, the same as the game plays, leaning late', () => {
  const g = newGame();
  g.setConditions({ preset: 'links' });
  const day = g.conditions;
  const keeper = createStageWind({ game: g, random: seededRandom(3) });
  const match = createMatch({ game: g, players: PLAYERS, tour: TOUR, random: rng(0.1), options: { format: 'bo3', tieRule: 'halve', powerups: 'off' } });
  // what server.js does: the stage's course in the bay, the roll, then stageReady with it
  const load = () => {
    const w = match.waiting;
    assert.equal(w.for, 'stage');
    g.setCourse(COURSE[w.file]());
    const wind = keeper.roll({ progress: match.progress });
    assert.equal(match.stageReady(g, w.token, { wind }), true);
    return wind;
  };
  // loading hole one: the stage's range is known from the manifest, the roll is not in yet
  let s = match.state();
  assert.deepEqual([s.phase, s.stage.wind.mph, s.stage.wind.min, s.stage.wind.max, s.stage.wind.label], ['loading', null, 6, 16, '6 TO 16 MPH']);
  assert.deepEqual(s.nextStage.wind, s.stage.wind);
  assert.equal(match.progress, 0);

  const seen = [];
  for (let hole = 1; hole <= 3; hole++) {
    const wind = load();
    s = match.state();
    assert.equal(s.phase, 'intro');
    assert.deepEqual(s.stage.wind, wind, 'the intro shows the wind that was rolled');
    assert.equal(s.nextStage, null);
    assert.deepEqual([g.state().conditions.windMph, g.state().conditions.windFromDeg], [wind.mph, wind.dirDeg], 'and the game plays it');
    assert.deepEqual(Object.keys(s.stage.wind).sort(), ['along', 'alongMph', 'cross', 'crossMph', 'dirDeg', 'label', 'max', 'min', 'mph', 'relDeg', 'rolled', 'strength']);
    seen.push(wind);
    match.ready(g);
    // both players hit the same 7-iron off the tee: the same wind, the same ball
    const xs = [];
    for (let i = 0; i < 2; i++) {
      assert.ok(match.beforeShot(g));
      const r = g.handleShot(I7);
      assert.deepEqual(r.wind, { speedMph: wind.mph, fromDeg: wind.dirDeg, gustMph: 0 });
      xs.push([r.end.x, r.end.y]);
      match.afterShot(g, r);
    }
    assert.deepEqual(xs[0], xs[1], 'the same wind for both players');
    assert.deepEqual(match.state().stage.wind, wind, 'for the whole hole');
    // halve it the quick way: both run out of strokes (par 4: seven each)
    while (match.phase === 'play') { assert.ok(match.beforeShot(g)); match.afterShot(g, g.handleShot({ Speed: 8, VLA: 10, HLA: 0, TotalSpin: 1000, SpinAxis: 0 })); }
    if (hole < 3) {
      s = match.state();
      assert.deepEqual([s.phase, s.lastResult.reason, s.nextStage.id], ['hole-result', 'halved', `s${hole + 1}`]);
      assert.equal(s.nextStage.wind, null, 'this manifest entry says nothing about its wind: known when it is rolled');
      assert.equal(match.continue(), true);
      assert.equal(match.progress, hole / 2);
    }
  }
  assert.deepEqual(seen.map((w) => [w.min, w.max]), [[6, 16], [12, 22], [6, 12]]);
  assert.equal(new Set(seen.map((w) => `${w.mph}/${w.dirDeg}`)).size, 3, 'three holes, three winds');
  // hole two is played due east: its wind is read against that line
  assert.deepEqual([seen[1].cross, seen[1].along, seen[1].relDeg], (({ cross, along, relDeg }) => [cross, along, relDeg])(describeWind(seen[1].mph, seen[1].dirDeg, 90)));

  // all square after three: sudden death on the arena, which has a wind of its own
  s = match.state();
  assert.deepEqual([s.phase, s.nextStage.kind, s.nextStage.wind.min, s.nextStage.wind.max, s.nextStage.wind.mph], ['hole-result', 'tiebreak', 0, 6, null]);
  match.continue();
  assert.equal(match.progress, 1);
  const arenaWind = load();
  s = match.state();
  assert.deepEqual([s.stage.kind, s.stage.wind], ['tiebreak', arenaWind]);
  assert.ok(arenaWind.mph <= 6);

  // the match is dropped: the day's conditions are back the moment the bay leaves the stages
  match.abort(g);
  g.setCourse(realCourse());
  keeper.roll();
  assert.deepEqual(g.conditions, day);
});

test('a match on the course that is loaded: the day\'s wind as it is, read against each hole', () => {
  const g = newGame(realCourse());
  g.setConditions({ windMph: 14, windFromDeg: 270 });
  const day = g.conditions;
  const match = createMatch({ game: g, players: PLAYERS, tour: null, random: rng(0.1), options: { format: 'bo3', stage: 'current', tieRule: 'halve', powerups: 'off' } });
  assert.equal(match.state().stage.wind, null);
  assert.equal(match.stageReady(g, match.waiting.token), true);   // no wind handed in: nothing was rolled
  let s = match.state();
  assert.deepEqual([s.stage.wind.label, s.stage.wind.rolled, s.stage.wind.min], ['14 MPH · LEFT TO RIGHT', false, null], 'hole 1 goes north');
  assert.equal(g.conditions, day, 'untouched');
  match.ready(g);
  while (match.phase === 'play') { match.beforeShot(g); match.afterShot(g, g.handleShot({ Speed: 8, VLA: 10, HLA: 0, TotalSpin: 1000, SpinAxis: 0 })); }
  match.continue();
  match.stageReady(g, match.waiting.token);
  s = match.state();
  assert.equal(s.stage.wind.label, '14 MPH · HELPING', 'hole 2 goes east: the same wind is behind');
  match.abort(g);
  assert.equal(g.conditions, day);
});
