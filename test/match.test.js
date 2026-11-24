'use strict';
// Match mode v2 (lib/match.js, docs/dev/arcade-v2-contract.md section 4): a 1v1 on one bay.
// Formats and stages, the phases and their gating (a swing outside 'play' / 'tiebreak' is
// dropped), the honour, the knockout rule and the stroke cap, tied holes into sudden death
// on an arena and back, the halve rule, misses and re-rounds, loadout charges, tricks on
// the opponent, concede, rematch, rewards and profiles, the state shape, the event list.
//
// The match is a pure state machine: these tests are its driver (drive / toPlay below do
// what server.js driveMatch does, with a fake tour and courses built in memory).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../lib/game');
const {
  createMatch, MatchError, MATCH_TIERS, MATCH_FORMATS, RANKS, TIMEOUTS, POWERUPS,
  tierFor, formatFor, shootoutSpot, rankFor, normalizeProfile, rewardsFor, applyRewards, normalizeTour, powerupCatalogue,
} = require('../lib/match');

// ---------- courses ----------
// A stage: one straight par 4, 437 yd north, a green 25 m round the pin (putts die in the
// default rough; the gimme and 'green' lies need one) and a lake 40 m past the pin.
// An arena: a 150 yd par 3 with the same green and lake.
const stageCourse = (name, par = 4) => () => ({
  name, kind: 'stage', surfaces: [], boundary: null, elevation: null,
  holes: [{ ref: 1, par, tee: [0, 0], pin: [0, 400], lengthYd: 437, line: [[0, 0], [0, 400]] }],
});
const ARENA_PIN = 150 * 0.9144;
const arenaCourse = (name) => () => ({
  name, kind: 'arena', surfaces: [], boundary: null, elevation: null,
  holes: [{ ref: 1, par: 3, tee: [0, 0], pin: [0, ARENA_PIN], lengthYd: 150, line: [[0, 0], [0, ARENA_PIN]] }],
});
// three holes on one course, for stage 'current' (every hole plays like the stage)
const roundCourse = () => ({
  name: 'Home Course', kind: 'stage', surfaces: [], boundary: null, elevation: null,
  holes: [7, 8, 9].map((ref) => ({ ref, par: 4, tee: [0, 0], pin: [0, 400], lengthYd: 437, line: [[0, 0], [0, 400]] })),
});
const surfaces = (course) => {
  const pinY = course.kind === 'arena' ? ARENA_PIN : 400;
  return (x, y) => (Math.hypot(x, y - pinY) < 25 ? 'green' : y > pinY + 40 ? 'water' : 'fairway');
};
const newGame = (course = null) => {
  const g = new Game({ surfaceLookupFactory: surfaces });
  if (course) g.setCourse(course);
  return g;
};

const stageEntry = (n, extra = {}) => ({
  id: `s${n}`, order: n, number: n, file: `s${n}.json`, name: `Stage ${n}`, par: 4, lengthYd: 437,
  theme: 'links', timeOfDay: 'day', blurb: `Blurb ${n}`, difficulty: 2, ...extra,
});
const arenaEntry = (n) => ({
  id: `a${n}`, order: n, number: 20 + n, file: `a${n}.json`, name: `Arena ${n}`, par: 3, lengthYd: 150,
  theme: 'stadium', timeOfDay: 'night', blurb: `Arena blurb ${n}`,
});
const tourOf = (stages, arenas) => ({
  version: 1,
  stages: Array.from({ length: stages }, (_, i) => stageEntry(i + 1)),
  tiebreaks: Array.from({ length: arenas }, (_, i) => arenaEntry(i + 1)),
});
const TOUR = tourOf(3, 2);
const COURSES = {};
for (let n = 1; n <= 9; n++) COURSES[`s${n}.json`] = stageCourse(`Stage ${n}`);
for (let n = 1; n <= 3; n++) COURSES[`a${n}.json`] = arenaCourse(`Arena ${n}`);
COURSES['p3.json'] = stageCourse('Long Three', 3);

const PLAYERS = [{ id: 'p1', name: 'Alex Sheppard' }, { id: 'p2', name: 'Dave' }];
// a balls-and-tricks catalogue as arcade-core will export it (kind missing: a ball)
const CATALOGUE = [
  { id: 'rocket', rarity: 'epic' }, { id: 'sticky', rarity: 'common' }, { id: 'magnet', rarity: 'rare', kind: 'ball' },
  { id: 'laser', rarity: 'rare' }, { id: 'gust', kind: 'trick', rarity: 'rare' }, { id: 'fog', kind: 'trick', rarity: 'common' },
];
// the given numbers in turn, then the last one for ever (0.1: slot 1 wins the toss)
const rng = (...values) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };

function start(options = {}, { game = newGame(), tour = TOUR, random = rng(0.1), players = PLAYERS, timeouts } = {}) {
  const match = createMatch({ game, players, tour, random, timeouts, options: { format: 'quick', stage: 's1', catalogue: CATALOGUE, ...options } });
  return { match, g: game };
}

// ---------- the driver ----------
// Put the stage the match asks for in the bay (a course load, or none when it is the
// loaded one) and tell it. Returns what the match waits for next.
function drive(match, g) {
  let w;
  while ((w = match.waiting) && w.for === 'stage') {
    if (w.file) g.setCourse(COURSES[w.file]());
    assert.equal(match.stageReady(g, w.token), true, 'the stage the match asked for is ready');
  }
  return w;
}
// ... and answer every screen (ready / continue) until a swing is wanted or it is over.
function toPlay(match, g) {
  for (;;) {
    const w = drive(match, g);
    if (!w || w.for === 'dismiss') return match.state();
    if (w.for === 'ready') assert.equal(match.ready(g), true);
    else if (w.for === 'continue') assert.equal(match.continue(), true);
  }
}

// launch monitor ball data (deterministic in standard conditions: no wind, no gusts)
const L = (Speed, VLA, TotalSpin) => ({ Speed, VLA, HLA: 0, TotalSpin, SpinAxis: 0 });
const DRIVER = L(152, 13, 2650);      // 273 yd from the tee: 165 to go
const DRIVER_SOFT = L(145, 13, 2650); // 256 yd: 181 to go
const I7 = L(111, 19, 7000);          // 148 yd (arena: 6.05 ft from the pin, inside the gimme)
const I7_SOFT = L(110, 19, 7000);     // 146 yd (arena: 3.6 yd from the pin)
const I8 = L(105, 21, 7900);          // 137 yd (arena: 13.5 yd from the pin)
const DINK = L(8, 10, 1000);          // a yard and a half
const PUTT = (mph) => L(mph, 0.5, 100);

// one hot-seat swing: server.js playShot with the match hooks round it
function hit(match, g, launch, arcade = null) {
  const shot = match.beforeShot(g);
  assert.ok(shot, 'the match takes the swing and loads the player who is up');
  const result = g.handleShot(launch);
  assert.ok(result, 'the game played the shot');
  if (arcade) result.arcade = arcade;
  const ev = match.afterShot(g, result);
  return { who: shot.playerId, shot, result, ev, state: match.state() };
}
// a swing the match must drop: nothing changes
function stray(match, g) {
  const before = JSON.stringify(match.state());
  assert.equal(match.beforeShot(g), null, `a swing in '${match.phase}' is ignored`);
  assert.equal(match.afterShot(g, { strokes: 1, sim: {} }), null);
  assert.equal(JSON.stringify(match.state()), before, 'an ignored swing changes nothing');
}
// play the hole with a script per player until it is decided
function playHole(match, g, script) {
  let last = null;
  while (match.phase === 'play') {
    const shots = script[match.currentPlayerId];
    assert.ok(shots && shots.length, `${match.currentPlayerId} has a shot scripted`);
    last = hit(match, g, shots.shift());
  }
  return last;
}
const other = (id) => (id === 'p1' ? 'p2' : 'p1');
// winner: soft drive (farther, so first onto the green), 7-iron, holes the 65-footer for 3;
// the other: drive, 7-iron to 50 ft, then one putt to tie, left short: knocked out
const winScript = (winnerId) => ({ [winnerId]: [DRIVER_SOFT, I7, PUTT(11)], [other(winnerId)]: [DRIVER, I7, PUTT(4)] });
// both make 3
const tieScript = () => ({ p1: [DRIVER, I7, PUTT(11)], p2: [DRIVER_SOFT, I7, PUTT(11)] });
const player = (state, id) => state.players.find((p) => p.id === id);
const types = (state) => state.events.map((e) => e.type);

// ---------- formats, tiers, the tour, the catalogue ----------

test('formats, tiers, ranks, the tour and the catalogue', () => {
  assert.deepEqual(Object.values(MATCH_FORMATS).map((f) => [f.id, f.label, f.target, f.maxHoles, f.charges]), [
    ['quick', 'Quick Match', 1, 1, 2], ['bo3', 'Best of 3', 2, 3, 3], ['bo9', 'Best of 9', 5, 9, 6],
  ]);
  assert.equal(formatFor('BO3').id, 'bo3');
  assert.equal(formatFor(undefined, 9).id, 'bo9', 'the old holes option still names a format');
  assert.equal(formatFor('bo5'), null);
  assert.deepEqual(MATCH_TIERS.map((t) => [t.label, t.entryFee, t.trophies]), [['Rookie', 50, 20], ['Amateur', 200, 25], ['Pro', 1000, 30], ['Master', 5000, 35]]);
  assert.equal(tierFor('PRO').id, 'pro');
  assert.equal(tierFor('tour'), null);
  assert.deepEqual(RANKS.map((r) => [r.rank, r.trophies]), [['Rookie', 0], ['Amateur', 100], ['Pro', 300], ['Expert', 600], ['Master', 1000], ['Legend', 1500]]);
  assert.deepEqual([0, 99, 100, 299, 300, 600, 999, 1000, 1500, 9999].map(rankFor),
    ['Rookie', 'Rookie', 'Amateur', 'Amateur', 'Pro', 'Expert', 'Expert', 'Master', 'Legend', 'Legend']);
  assert.deepEqual(TIMEOUTS, { readyMs: 25000, continueMs: 60000, doneMs: 600000 });

  // the tour: only entries with an id and a file, in tour order; anything else is an empty tour
  const t = normalizeTour({ stages: [stageEntry(2), { id: 'no-file' }, null, stageEntry(1)], tiebreaks: [arenaEntry(1)] });
  assert.deepEqual(t.stages.map((s) => s.id), ['s1', 's2']);
  assert.deepEqual(t.tiebreaks.map((s) => [s.id, s.kind]), [['a1', 'tiebreak']]);
  assert.deepEqual(normalizeTour(null), { stages: [], tiebreaks: [] });
  assert.deepEqual(normalizeTour('nonsense'), { stages: [], tiebreaks: [] });

  // the catalogue: a missing kind is a ball; a missing or empty export is the first seven balls
  assert.deepEqual(powerupCatalogue(CATALOGUE).map((c) => `${c.id}:${c.kind}`), ['rocket:ball', 'sticky:ball', 'magnet:ball', 'laser:ball', 'gust:trick', 'fog:trick']);
  assert.deepEqual(powerupCatalogue(null).map((c) => c.id), [...POWERUPS]);
  assert.deepEqual(powerupCatalogue([]).map((c) => c.kind), POWERUPS.map(() => 'ball'));
  const live = powerupCatalogue();   // lib/arcade.js as it is today
  for (const id of POWERUPS) assert.ok(live.some((c) => c.id === id && c.kind === 'ball'), `${id} is in the live catalogue`);
  // the same-hole shootout spot: 150 yd back along the line, the tee on a shorter hole
  const spot = shootoutSpot(stageCourse('x')().holes[0], 150);
  assert.equal(Math.round((400 - spot.y) / 0.9144), 150);
  assert.deepEqual(shootoutSpot({ tee: [0, 0], pin: [0, 100], line: [[0, 0], [0, 100]] }, 150), { x: 0, y: 0 });
});

test('stages: quick picks one, a series follows the tour or a shuffle, never repeating while it can', () => {
  const plan = (options, tour = tourOf(9, 3), random = rng(0.1)) => {
    const { match, g } = start({ stage: undefined, ...options }, { tour, random });
    const seen = [];
    for (let i = 0; i < MATCH_FORMATS[options.format].maxHoles; i++) {
      toPlay(match, g);
      seen.push(match.state().stage.id);
      if (!match.active) break;
      // alternate winners so the series runs as long as it can
      playHole(match, g, winScript(i % 2 ? 'p1' : 'p2'));
    }
    return seen;
  };
  // quick: the stage asked for, 'random', or (nothing asked) a random one
  assert.deepEqual(plan({ format: 'quick', stage: 's4' }), ['s4']);
  assert.deepEqual(plan({ format: 'quick', stage: 'random' }, tourOf(9, 3), rng(0.5, 0.1)), ['s5']);
  assert.deepEqual(plan({ format: 'quick' }, tourOf(9, 3), rng(0.99, 0.1)), ['s9']);
  // a series: tour order from stage 1
  assert.deepEqual(plan({ format: 'bo3' }), ['s1', 's2', 's3']);
  assert.deepEqual(plan({ format: 'bo9' }), ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9']);
  // ... or from the stage asked for
  assert.deepEqual(plan({ format: 'bo3', stage: 's8' }), ['s8', 's9', 's1']);
  // shuffled: every stage once
  const shuffled = plan({ format: 'bo9', order: 'shuffle' }, tourOf(9, 3), rng(0.3, 0.8, 0.1, 0.6, 0.2, 0.9, 0.4, 0.7, 0.1));
  assert.equal(new Set(shuffled).size, 9, 'no stage twice');
  assert.notDeepEqual(shuffled, ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9']);
  // a tour of three under a best of nine: round again, still never the same stage twice running
  const short = plan({ format: 'bo9' }, tourOf(3, 0));
  assert.deepEqual(short, ['s1', 's2', 's3', 's1', 's2', 's3', 's1', 's2', 's3']);
  const shortShuffle = plan({ format: 'bo9', order: 'shuffle' }, tourOf(3, 0), rng(0.9, 0.2, 0.1, 0.7, 0.3, 0.8, 0.5, 0.1));
  for (let i = 1; i < shortShuffle.length; i++) assert.notEqual(shortShuffle[i], shortShuffle[i - 1]);
  assert.equal(new Set(shortShuffle.slice(0, 3)).size, 3);
  // one stage only: it is all there is
  assert.deepEqual(plan({ format: 'bo3' }, tourOf(1, 0)), ['s1', 's1', 's1']);
});

test('createMatch refuses bad set-ups; with no tour only stage "current" works', () => {
  assert.throws(() => createMatch({ players: [PLAYERS[0]], tour: TOUR }), /two players/);
  assert.throws(() => createMatch({ players: [PLAYERS[0], PLAYERS[0]], tour: TOUR }), /two different players/);
  assert.throws(() => createMatch({ players: [PLAYERS[0], { id: 'x' }], tour: TOUR }), /an id and a name/);
  assert.throws(() => start({ stage: 'nowhere' }), (e) => e instanceof MatchError && e.status === 404 && /No such stage/.test(e.message));
  assert.throws(() => start({ stakes: 'platinum' }), /No such stakes tier/);
  // no manifest: a stage cannot be asked for ...
  assert.throws(() => start({ stage: 's1' }, { tour: null }), (e) => e.status === 409 && /only stage "current"/.test(e.message));
  assert.throws(() => start({ stage: 'random' }, { tour: { stages: [], tiebreaks: [arenaEntry(1)] } }), /only stage "current"/);
  // ... 'current' needs a course in the bay, and no league round on it
  assert.throws(() => start({ stage: 'current' }, { tour: null, game: newGame() }), /Load a course first/);
  const league = newGame(roundCourse());
  league.leagueRound = { leagueId: 'l1', week: 1 };
  assert.throws(() => start({ stage: 'current' }, { game: league }), /league round/);
  // nothing asked and no tour: the loaded course it is
  const { match } = start({ stage: undefined }, { tour: null, game: newGame(roundCourse()) });
  assert.equal(match.mode, 'current');
  // a tour match needs no course in the bay at all
  assert.equal(start({}, { game: newGame() }).match.mode, 'tour');
});

// ---------- state ----------

test('the state has the contract shape from the first moment', () => {
  const { match, g } = start({ format: 'bo3', stage: undefined }, { players: [{ ...PLAYERS[0], profile: { trophies: 320, wins: 9, losses: 4, streak: 2, bestStreak: 5, coins: 700 } }, PLAYERS[1]] });
  let s = match.state();
  assert.deepEqual(Object.keys(s).sort(), [
    'aborted', 'awards', 'canRestartHole', 'concededBy', 'currentPlayerId', 'error', 'events', 'format', 'formatLabel', 'holeIndex', 'holeNumber',
    'holeRef', 'holeResults', 'holesPlayed', 'honourId', 'id', 'lastResult', 'lengthYd', 'log', 'matchPoint', 'maxHoles', 'nextStage',
    'options', 'par', 'phase', 'players', 'reason', 'rewards', 'seq', 'stage', 'stakes', 'standings', 'startedAt', 'target',
    'tiebreak', 'turnStartedAt', 'undoable', 'waiting', 'winnerId', 'loserId',
  ].sort());
  assert.deepEqual(
    { format: s.format, formatLabel: s.formatLabel, target: s.target, maxHoles: s.maxHoles, stakes: s.stakes, phase: s.phase, holeNumber: s.holeNumber },
    { format: 'bo3', formatLabel: 'Best of 3', target: 2, maxHoles: 3, stakes: null, phase: 'loading', holeNumber: 1 },
  );
  assert.deepEqual(s.options, { tieRule: 'shootout', powerups: 'loadout', order: 'tour', hazardLosesHole: false, strokeCap: 3, putting: 'assist' });   // (putting: the match's putting assist)
  const stage1 = { id: 's1', name: 'Stage 1', par: 4, lengthYd: 437, theme: 'links', timeOfDay: 'day', blurb: 'Blurb 1', difficulty: 2, kind: 'match', freeBall: null, routes: null, wind: null };
  assert.deepEqual(s.stage, stage1, 'while the first stage loads it is already named');
  assert.deepEqual(s.nextStage, stage1);
  assert.equal(s.currentPlayerId, null);
  assert.equal(s.honourId, 'p1');
  assert.deepEqual(s.waiting, { for: 'stage', since: s.waiting.since, timeoutMs: null });
  assert.deepEqual([s.holeResults, s.lastResult, s.tiebreak, s.standings, s.matchPoint, s.winnerId, s.loserId, s.reason, s.rewards, s.awards, s.aborted, s.concededBy],
    [[], null, null, 'ALL SQUARE', null, null, null, null, null, null, false, null]);
  assert.deepEqual(Object.keys(s.players[0]).sort(), [
    'armedPowerup', 'ball', 'capped', 'charges', 'cursedWith', 'distToPinYd', 'holeScores', 'holed', 'holesWon', 'id', 'initials', 'lie',
    'mustHole', 'name', 'profile', 'shotFor', 'shotKind', 'slot', 'stats', 'strokes', 'tiebreakFt', 'usedPowerups',
  ]);
  assert.deepEqual(s.players.map((p) => [p.id, p.name, p.initials, p.slot, p.charges, p.holesWon]), [['p1', 'Alex Sheppard', 'AS', 1, 3, 0], ['p2', 'Dave', 'DA', 2, 3, 0]]);
  assert.deepEqual(s.players[0].stats, { shots: 0, longestDriveYd: null, closestFt: null, bestGrade: null, perfects: 0, points: 0, callouts: [], bestShot: null });
  assert.deepEqual(s.players[0].profile, { trophies: 320, rank: 'Pro', wins: 9, losses: 4, streak: 2, bestStreak: 5, coins: 700 });
  assert.deepEqual(s.players[1].profile, { trophies: 0, rank: 'Rookie', wins: 0, losses: 0, streak: 0, bestStreak: 0, coins: 1000 });
  assert.match(s.log[0].text, /Alex Sheppard vs Dave: Best of 3\. Alex Sheppard wins the toss and has the honour\./);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(s)), 'serializable');

  // on the tee of hole one
  s = toPlay(match, g);
  assert.equal(s.phase, 'play');
  // loaded: the stage carries the wind of the hole (here the game's own: a still day)
  const still = { mph: 0, dirDeg: 0, relDeg: null, cross: null, along: null, crossMph: 0, alongMph: 0, strength: 'calm', label: 'NO WIND', min: null, max: null, rolled: false };
  assert.deepEqual(s.stage, { ...stage1, wind: still });
  assert.equal(s.nextStage, null);
  assert.deepEqual([s.par, s.lengthYd, s.holeIndex, s.holeRef], [4, 437, 0, 1]);
  assert.deepEqual(s.players.map((p) => [p.strokes, p.lie, p.holed, p.distToPinYd, p.ball]), [[0, 'tee', false, 437.4, { x: 0, y: 0 }], [0, 'tee', false, 437.4, { x: 0, y: 0 }]]);
  assert.equal(s.waiting, null);
  // a staked match carries its stakes
  const staked = start({ stakes: 'Amateur' }).match.state();
  assert.deepEqual(staked.stakes, { tier: 'amateur', tierLabel: 'Amateur', entryFee: 200, pot: 400 });
  assert.match(staked.log[0].text, /400 coins in the pot/);
});

// ---------- phases and gating ----------

test('phases: loading, intro, play, hole-result, done; swings only count in play', () => {
  const { match, g } = start({ format: 'bo3', stage: undefined }, { timeouts: { readyMs: 111, continueMs: 222, doneMs: 333 } });
  // loading: the match asks its driver for the stage's course
  assert.equal(match.phase, 'loading');
  let w = match.waiting;
  assert.deepEqual({ for: w.for, file: w.file, stageId: w.stageId, kind: w.kind, timeoutMs: w.timeoutMs }, { for: 'stage', file: 's1.json', stageId: 's1', kind: 'match', timeoutMs: null });
  stray(match, g);
  assert.equal(match.ready(g), false, 'nothing to get ready for yet');
  assert.equal(match.continue(), false);
  // an answer to some other request is ignored; no course in the bay is refused
  assert.equal(match.stageReady(g, w.token + 5), false);
  assert.throws(() => match.stageReady(g, w.token), /No course is loaded/);
  assert.equal(match.phase, 'loading');
  match.arm('p1', 'rocket');   // armed before the hole starts

  // the course is in: the intro shows, the first player's ball is on the tee, still no swings
  g.setCourse(COURSES[w.file]());
  assert.equal(match.stageReady(g, w.token), true);
  assert.equal(match.stageReady(g, w.token), false, 'once');
  let s = match.state();
  assert.equal(s.phase, 'intro');
  assert.equal(s.currentPlayerId, 'p1', 'who tees off is known during the intro');
  assert.equal(g.player.id, 'p1');
  assert.deepEqual({ for: s.waiting.for, timeoutMs: s.waiting.timeoutMs }, { for: 'ready', timeoutMs: 111 });
  stray(match, g);
  assert.equal(match.continue(), false);
  assert.equal(player(match.state(), 'p1').armedPowerup, 'rocket', 'a dropped swing does not spend the armed ball');
  assert.equal(player(match.state(), 'p1').charges, 3);

  // ready: tee off
  assert.equal(match.ready(g), true);
  assert.equal(match.ready(g), false, 'a second ready does nothing');
  assert.equal(match.phase, 'play');
  assert.equal(match.waiting, null);
  let t = hit(match, g, DRIVER_SOFT);
  assert.equal(t.shot.armed, 'rocket');
  assert.equal(player(t.state, 'p1').charges, 2, 'the ball went with the swing');
  // p2 takes the hole: the result screen
  t = playHole(match, g, { p1: [I7, PUTT(4)], p2: [DRIVER_SOFT, I7, PUTT(11)] });
  s = t.state;
  assert.equal(t.ev.event, 'hole-won');
  assert.equal(s.phase, 'hole-result');
  assert.equal(s.currentPlayerId, null);
  assert.deepEqual({ for: s.waiting.for, timeoutMs: s.waiting.timeoutMs }, { for: 'continue', timeoutMs: 222 });
  assert.equal(s.lastResult.winnerId, 'p2');
  assert.equal(s.nextStage.id, 's2');
  assert.equal(s.holeNumber, 1, 'still the hole the result is for');
  assert.equal(g.over, false, 'the hole-out is the match\'s, not the round\'s');
  assert.deepEqual(g.scores, [null]);
  stray(match, g);
  assert.equal(match.ready(g), false);

  // continue: the next stage loads
  assert.equal(match.continue(), true);
  s = match.state();
  assert.equal(s.phase, 'loading');
  assert.equal(s.holeNumber, 2);
  assert.equal(s.stage.id, 's1', 'the stage still on screen');
  assert.equal(s.nextStage.id, 's2');
  assert.equal(match.waiting.file, 's2.json');
  stray(match, g);
  toPlay(match, g);
  assert.equal(g.course.name, 'Stage 2');
  assert.equal(match.state().stage.id, 's2');
  // p2 again: 2-0, done
  t = playHole(match, g, winScript('p2'));
  s = t.state;
  assert.equal(t.ev.event, 'match-over');
  assert.equal(s.phase, 'done');
  assert.deepEqual({ for: s.waiting.for, timeoutMs: s.waiting.timeoutMs }, { for: 'dismiss', timeoutMs: 333 });
  assert.equal(match.active, false);
  stray(match, g);
  assert.equal(match.ready(g), false);
  assert.equal(match.continue(), false);
  assert.throws(() => match.arm('p1', 'sticky'), /over/);
  assert.throws(() => match.concede('p1'), /over/);
});

test('a swing on a course that is not the match\'s is not the match\'s', () => {
  const { match, g } = start();
  toPlay(match, g);
  const elsewhere = newGame(roundCourse());
  assert.equal(match.beforeShot(elsewhere), null);
  assert.equal(match.beforeShot(null), null);
  assert.ok(match.beforeShot(g));
});

// ---------- the honour and the order of play ----------

test('honour: a coin flip on hole one, then the previous hole\'s winner; farther from the hole plays', () => {
  // the toss
  assert.equal(start({}, { random: rng(0.49) }).match.state().honourId, 'p1');
  const flipped = start({}, { random: rng(0.5) }).match.state();
  assert.equal(flipped.honourId, 'p2');
  assert.deepEqual(flipped.events.find((e) => e.type === 'coin-flip'), { seq: flipped.events[1].seq, type: 'coin-flip', t: flipped.events[1].t, winnerId: 'p2' });
  assert.match(flipped.log[0].text, /Dave wins the toss/);

  const { match, g } = start({ format: 'bo3', stage: undefined }, { random: rng(0.9) });
  let s = toPlay(match, g);
  assert.equal(s.currentPlayerId, 'p2', 'the toss winner tees off');
  // p2 dinks it off the tee: p1 still tees off next, however far back p2 is
  let t = hit(match, g, DINK);
  assert.equal(t.who, 'p2');
  assert.equal(t.ev.nextPlayerId, 'p1', 'both tee off before anybody plays a second');
  assert.deepEqual(player(t.state, 'p1').ball, { x: 0, y: 0 }, 'p2\'s shot never moved p1\'s ball');
  t = hit(match, g, DRIVER);
  assert.equal(t.who, 'p1');
  assert.equal(player(t.state, 'p1').distToPinYd, 164.7);
  assert.equal(t.state.currentPlayerId, 'p2', 'now the farther ball plays');
  assert.equal(+g.distToPinYd.toFixed(1), 436, 'the game shows the ball of whoever is up');
  assert.equal(g.strokes, 1);
  // p2 hits it past p1's ball (104 to go): p1 is away
  t = hit(match, g, L(160, 13, 2650));
  assert.ok(player(t.state, 'p2').distToPinYd < 164.7);
  assert.equal(t.state.currentPlayerId, 'p1');
  // an aim set between shots belongs to the player who is up and survives beforeShot
  g.setAimOffset(3);
  t = hit(match, g, I7);
  assert.equal(player(t.state, 'p1').lie, 'green');
  assert.equal(g.aimOffset, 0, 'p2 is up now: p2\'s own aim');
  assert.equal(t.state.currentPlayerId, 'p2');

  // p1 wins this hole and so has the honour on the next, whoever won the toss
  const { match: m2, g: g2 } = start({ format: 'bo3', stage: undefined }, { random: rng(0.9) });
  toPlay(m2, g2);
  playHole(m2, g2, winScript('p1'));
  assert.equal(m2.state().honourId, 'p1');
  s = toPlay(m2, g2);
  assert.equal(s.holeNumber, 2);
  assert.equal(s.currentPlayerId, 'p1', 'the winner of the last hole tees off');
  playHole(m2, g2, winScript('p2'));
  s = toPlay(m2, g2);
  assert.equal(s.honourId, 'p2');
  assert.equal(s.currentPlayerId, 'p2');
});

// ---------- the knockout rule and the stroke cap ----------

test('knockout at N-1: one swing, must hole it; missed, the hole is over on the spot', () => {
  const { match, g } = start();
  toPlay(match, g);
  for (const launch of [DRIVER, DRIVER_SOFT, I7, I7]) hit(match, g, launch);   // both on in two, p2 (65 ft) away
  // p2 holes it for 3. p1 is out with 2 (N-1): exactly one swing, to tie
  let t = hit(match, g, PUTT(11));
  assert.equal(t.who, 'p2');
  assert.equal(player(t.state, 'p2').holed, true);
  assert.equal(t.ev.event, 'shot', 'not decided: p1 can still tie');
  assert.equal(t.ev.mustHole, true);
  assert.equal(t.state.currentPlayerId, 'p1');
  assert.equal(player(t.state, 'p1').mustHole, true);
  assert.equal(player(t.state, 'p2').mustHole, false);
  assert.deepEqual(types(t.state).slice(-2), ['turn', 'must-hole']);
  assert.equal(t.state.events.at(-1).playerId, 'p1');
  assert.match(t.state.log.at(-1).text, /Alex Sheppard must hole this/);
  // p1 leaves it short: 3 strokes (N) and still out -> knocked out, no more swings
  t = hit(match, g, PUTT(4));
  assert.equal(player(t.state, 'p1').holed, false);
  assert.equal(t.ev.event, 'match-over', 'a quick match: the hole decides it');
  assert.equal(t.ev.winnerId, 'p2');
  assert.deepEqual(t.state.holeResults, [{ holeNumber: 1, stageId: 's1', stageName: 'Stage 1', par: 4, winnerId: 'p2', reason: 'knockout', scores: { p1: 3, p2: 3 }, tiebreak: null }]);
  assert.deepEqual(t.state.lastResult, t.state.holeResults[0]);
  assert.deepEqual(t.state.players.map((p) => [p.holesWon, p.holeScores, p.mustHole]), [[0, [null], false], [1, [3], false]]);
  assert.ok(t.state.log.some((l) => /KNOCKOUT! Alex Sheppard can't catch that: Dave wins the hole with a birdie!/.test(l.text)));
  assert.deepEqual([t.state.phase, t.state.reason, t.state.winnerId, t.state.loserId], ['done', 'holes', 'p2', 'p1']);
});

test('knockout at N: a player out with as many strokes as the one who holes gets no swing', () => {
  const { match, g } = start({ format: 'bo3', stage: undefined });
  toPlay(match, g);
  hit(match, g, DRIVER);            // p1: 165 to go
  hit(match, g, DRIVER_SOFT);       // p2: 181 to go, away
  hit(match, g, I7);                // p2 on the green in two
  hit(match, g, DINK);              // p1 duffs one (2) ...
  let t = hit(match, g, I7);        // ... and is on in three, inside p2
  assert.equal(t.who, 'p1');
  assert.equal(player(t.state, 'p1').strokes, 3);
  assert.equal(t.state.currentPlayerId, 'p2');
  // p2 holes for 3: p1 has already taken 3 and is not in. Over, no swing for p1.
  t = hit(match, g, PUTT(11));
  assert.equal(t.ev.event, 'hole-won');
  assert.equal(t.ev.reason, 'knockout');
  assert.equal(t.ev.winnerId, 'p2');
  assert.equal(t.ev.next, 'hole');
  assert.deepEqual(t.state.lastResult.scores, { p1: 3, p2: 3 });
  assert.equal(t.state.phase, 'hole-result');
  assert.equal(t.state.standings, 'Dave 1 UP');
  assert.deepEqual(types(t.state).slice(-1), ['hole-won']);
  assert.deepEqual({ ...t.state.events.at(-1), seq: 0, t: 0 }, { seq: 0, t: 0, type: 'hole-won', winnerId: 'p2', reason: 'knockout', holeNumber: 1, clutch: 'win' });   // the putt that did it was for the win
});

test('must-hole made: the hole is tied; both in with different scores: the lower one wins', () => {
  const { match, g } = start();
  toPlay(match, g);
  const t = playHole(match, g, tieScript());
  assert.equal(t.who, 'p1', 'p1 holed the putt it had to');
  assert.equal(t.ev.event, 'hole-tied');
  assert.equal(t.state.lastResult.reason, 'tied');
  assert.deepEqual(t.state.lastResult.scores, { p1: 3, p2: 3 });
  // both in, 3 against 4: 'score'. (p1's first putt stops inside the gimme: conceded, one more.)
  const { match: m2, g: g2 } = start();
  toPlay(m2, g2);
  for (const launch of [DRIVER, DRIVER_SOFT, I7, I7]) hit(m2, g2, launch);
  hit(m2, g2, PUTT(11));                       // p2 in for 3
  const u = hit(m2, g2, PUTT(9));              // p1 must hole it: stops 6 ft short
  assert.equal(u.result.note, 'Gimme inside 8 ft (+1)');
  assert.deepEqual([player(u.state, 'p1').holed, player(u.state, 'p1').strokes], [true, 4], 'a conceded tap-in is a stroke');
  assert.equal(u.state.lastResult.reason, 'score');
  assert.equal(u.state.lastResult.winnerId, 'p2');
  assert.deepEqual(u.state.lastResult.scores, { p1: 4, p2: 3 });
  assert.deepEqual(u.state.players.map((p) => p.holeScores), [[4], [3]]);
  assert.ok(u.state.log.some((l) => l.text === 'Dave wins the hole: a birdie beats par!'));
});

test('stroke cap (par + 3): a capped player waits and loses to one who holes out; both capped is a tie', () => {
  // p1 never gets off the tee: seven strokes on a par 4 and out of strokes
  const { match, g } = start({ format: 'bo3', stage: undefined });
  toPlay(match, g);
  hit(match, g, DINK);              // p1 (the honour)
  hit(match, g, DRIVER_SOFT);       // p2 tees off
  let t;
  for (let i = 2; i <= 7; i++) {
    t = hit(match, g, DINK);
    assert.equal(t.who, 'p1', 'p1 is away every time');
    assert.equal(player(t.state, 'p1').capped, i === 7, `stroke ${i}`);
  }
  assert.equal(t.ev.event, 'shot', 'the hole is not over: p2 still has to hole out');
  assert.equal(t.state.currentPlayerId, 'p2');
  assert.match(t.state.log.at(-1).text, /Alex Sheppard is out of strokes \(7\)/);
  t = hit(match, g, I7);            // p2 on in two
  assert.equal(t.state.currentPlayerId, 'p2', 'a capped player does not come up again');
  t = hit(match, g, PUTT(11));      // in for 3
  assert.equal(t.ev.event, 'hole-won');
  assert.equal(t.ev.reason, 'cap');
  assert.equal(t.ev.winnerId, 'p2');
  assert.deepEqual(t.state.lastResult.scores, { p1: 7, p2: 3 });
  assert.deepEqual(player(t.state, 'p1').holeScores, [null]);
  assert.ok(t.state.log.some((l) => /Alex Sheppard ran out of strokes: Dave wins the hole with a birdie/.test(l.text)));

  // both run out of strokes: tied (sudden death under the default tie rule)
  const { match: m2, g: g2 } = start();
  toPlay(m2, g2);
  let last;
  while (m2.phase === 'play') last = hit(m2, g2, DINK);
  assert.deepEqual(last.state.players.map((p) => [p.strokes, p.capped, p.holed]), [[7, true, false], [7, true, false]]);
  assert.equal(last.ev.event, 'hole-tied');
  assert.equal(last.state.lastResult.reason, 'tied');
  assert.equal(last.state.nextStage.kind, 'tiebreak');
  assert.ok(last.state.log.some((l) => /Hole tied \(both out of strokes\)/.test(l.text)));

  // a penalty stroke counts toward the cap: on a par 3 (cap 6) the fifth swing, into the
  // lake, is strokes five and six
  const three = start({ format: 'bo3', stage: undefined }, { tour: { stages: [stageEntry(1, { id: 'p3', file: 'p3.json', name: 'Long Three', par: 3 })], tiebreaks: [] } });
  toPlay(three.match, three.g);
  assert.equal(three.match.state().par, 3);
  for (const launch of [DINK, DRIVER, DINK, DINK, DRIVER, I7]) hit(three.match, three.g, launch);   // p1: 4 strokes, 160 out; p2 on in two
  t = hit(three.match, three.g, DRIVER);
  assert.deepEqual([t.who, t.result.penalty, player(t.state, 'p1').strokes, player(t.state, 'p1').capped], ['p1', 1, 6, true]);
  assert.equal(t.state.currentPlayerId, 'p2');
  t = hit(three.match, three.g, PUTT(11));
  assert.deepEqual([t.ev.event, t.ev.reason, t.ev.winnerId, t.state.lastResult.scores], ['hole-won', 'cap', 'p2', { p1: 6, p2: 3 }]);
});

test('hazardLosesHole: off, water is +1 and play goes on; on, it loses the hole on the spot', () => {
  let { match, g } = start();
  toPlay(match, g);
  hit(match, g, DRIVER);              // p1: 165 to go
  hit(match, g, DRIVER_SOFT);         // p2: 181 to go
  let t = hit(match, g, DRIVER);      // p2 flies the green into the lake
  assert.equal(t.result.penalty, 1);
  assert.equal(t.ev.event, 'shot');
  assert.equal(player(t.state, 'p2').strokes, 3, 'two swings and a penalty stroke');
  assert.equal(t.state.phase, 'play');
  assert.ok(t.state.log.some((l) => l.text === 'Dave finds the water! +1'));

  ({ match, g } = start({ hazardLosesHole: true }));
  assert.equal(match.state().options.hazardLosesHole, true);
  toPlay(match, g);
  hit(match, g, DRIVER);
  hit(match, g, DRIVER_SOFT);
  t = hit(match, g, DRIVER);
  assert.equal(t.who, 'p2');
  assert.equal(t.ev.event, 'match-over');
  assert.equal(t.state.lastResult.reason, 'hazard');
  assert.equal(t.state.lastResult.winnerId, 'p1');
  assert.ok(t.state.log.some((l) => l.text === 'Hazard! Dave forfeits the hole: Alex Sheppard takes it.'));
});

// ---------- tied holes ----------

test('a tied hole goes to sudden death on an arena, and the series goes on from there', () => {
  const { match, g } = start({ format: 'bo3', stage: undefined }, { random: rng(0.1, 0.9) });   // toss: p1; arena: the second
  toPlay(match, g);
  let t = playHole(match, g, tieScript());
  let s = t.state;
  // hole-result, tied, the arena named
  assert.deepEqual([s.phase, s.lastResult.reason, s.lastResult.winnerId, s.holesPlayed], ['hole-result', 'tied', null, 1]);
  assert.deepEqual(s.nextStage, { id: 'a2', name: 'Arena 2', par: 3, lengthYd: 150, theme: 'stadium', timeOfDay: 'night', blurb: 'Arena blurb 2', difficulty: null, kind: 'tiebreak', freeBall: null, routes: null, wind: null });
  assert.deepEqual(s.players.map((p) => p.holesWon), [0, 0]);
  assert.equal(s.standings, 'ALL SQUARE');
  assert.equal(types(s).at(-1), 'hole-tied');
  assert.ok(s.log.some((l) => /Hole tied \(both make a birdie\): SUDDEN DEATH/.test(l.text)));
  // continue: the arena loads; the hole number stays
  assert.equal(match.continue(), true);
  s = match.state();
  assert.deepEqual([s.phase, s.holeNumber, s.nextStage.id, s.stage.id], ['loading', 1, 'a2', 's1']);
  assert.deepEqual({ file: match.waiting.file, kind: match.waiting.kind }, { file: 'a2.json', kind: 'tiebreak' });
  drive(match, g);
  s = match.state();
  assert.equal(g.course.name, 'Arena 2');
  assert.deepEqual([s.phase, s.stage.id, s.stage.kind, s.nextStage, s.currentPlayerId], ['intro', 'a2', 'tiebreak', null, 'p1']);
  assert.deepEqual(s.tiebreak, { arenaId: 'a2', round: 1, pending: ['p1', 'p2'], results: [], spotYd: 150 });
  assert.deepEqual(s.players.map((p) => [p.strokes, p.lie, p.holed, p.distToPinYd, p.tiebreakFt]), [[0, 'tee', false, 150, null], [0, 'tee', false, 150, null]]);
  stray(match, g);
  match.ready(g);
  s = match.state();
  assert.equal(s.phase, 'tiebreak');
  assert.deepEqual(types(s).slice(-3), ['ready', 'tiebreak-start', 'turn']);
  assert.match(s.log.at(-1).text, /SUDDEN DEATH at Arena 2: closest to the pin from 150 yd/);

  // p1's 7-iron to 6 ft (a gimme for the game, but sudden death keeps the distance)
  t = hit(match, g, I7);
  assert.equal(t.ev.event, 'tiebreak-shot');
  assert.deepEqual([t.ev.ft, t.ev.miss, t.ev.nextPlayerId], [6.05, null, 'p2']);
  assert.deepEqual(t.state.tiebreak.results, [{ round: 1, playerId: 'p1', ft: 6.05, miss: null, holed: false }]);
  assert.deepEqual(t.state.tiebreak.pending, ['p2']);
  assert.equal(player(t.state, 'p1').tiebreakFt, 6.05);
  assert.equal(+g.distToPinYd.toFixed(1), 150, 'p2 plays from the same tee');
  assert.equal(g.strokes, 0);
  assert.equal(g.holed, false);
  // p2's 8-iron to 13.5 yd: p1 takes the hole
  t = hit(match, g, I8);
  s = t.state;
  assert.equal(t.ev.event, 'hole-won');
  assert.deepEqual([t.ev.reason, t.ev.winnerId, t.ev.next], ['tiebreak', 'p1', 'hole']);
  assert.equal(s.phase, 'hole-result');
  // the tied hole's result is rewritten, not added to
  assert.deepEqual(s.holeResults, [{
    holeNumber: 1, stageId: 's1', stageName: 'Stage 1', par: 4, winnerId: 'p1', reason: 'tiebreak', scores: { p1: 3, p2: 3 },
    tiebreak: { arenaId: 'a2', rounds: [{ p1: 6.05, p2: 40.37 }] },
  }]);
  assert.deepEqual(s.lastResult, s.holeResults[0]);
  assert.deepEqual(s.players.map((p) => p.holesWon), [1, 0]);
  assert.equal(s.honourId, 'p1');
  assert.equal(s.nextStage.id, 's2');
  assert.equal(s.tiebreak.results.length, 2, 'the duel board stays up for the result screen');
  assert.deepEqual(types(s).slice(-3), ['turn', 'tiebreak-shot', 'hole-won']);
  assert.ok(s.log.some((l) => l.text === 'Alex Sheppard wins the sudden death: 6.1 ft from the pin!'));
  stray(match, g);

  // on to hole two on its own stage
  s = toPlay(match, g);
  assert.deepEqual([s.phase, s.holeNumber, s.stage.id, s.tiebreak, s.currentPlayerId], ['play', 2, 's2', null, 'p1']);
  assert.equal(g.course.name, 'Stage 2');
  assert.equal(s.matchPoint, 'p1');
  // tied again: the other arena (none twice until all are used), then the first one again
  playHole(match, g, tieScript());
  assert.equal(match.state().nextStage.id, 'a1');
  toPlay(match, g);
  hit(match, g, I8);
  t = hit(match, g, I7);            // p2 nearer this time
  assert.equal(t.ev.winnerId, 'p2');
  assert.equal(t.state.matchPoint, 'both', '1-1 with one to play');
  toPlay(match, g);
  assert.equal(match.state().currentPlayerId, 'p2', 'the sudden-death winner has the honour');
  playHole(match, g, { p1: [DRIVER, I7, PUTT(11)], p2: [DRIVER_SOFT, I7, PUTT(11)] });
  assert.ok(['a1', 'a2'].includes(match.state().nextStage.id), 'all used: any arena but the last one');
  assert.notEqual(match.state().nextStage.id, 'a1');
  toPlay(match, g);
  hit(match, g, I7);                // p2 leads off (the honour)
  t = hit(match, g, I8);
  assert.equal(t.ev.event, 'match-over');
  assert.deepEqual([t.state.phase, t.state.reason, t.state.winnerId], ['done', 'tiebreak', 'p2']);
  assert.deepEqual(t.state.holeResults.map((r) => [r.holeNumber, r.winnerId, r.reason]), [[1, 'p1', 'tiebreak'], [2, 'p2', 'tiebreak'], [3, 'p2', 'tiebreak']]);
});

test('sudden death: a hazard is a miss, both missing or level within 0.1 ft goes again, the other player first', () => {
  const { match, g } = start({}, { random: rng(0.1, 0) });
  toPlay(match, g);
  playHole(match, g, tieScript());
  toPlay(match, g);
  assert.equal(match.phase, 'tiebreak');
  // round 1: both fly the green into the lake -> both miss -> again
  let t = hit(match, g, DRIVER);
  assert.equal(t.who, 'p1');
  assert.equal(t.result.penalty, 1, 'the game called it a water ball');
  assert.deepEqual(t.state.tiebreak.results[0], { round: 1, playerId: 'p1', ft: null, miss: 'water', holed: false });
  assert.equal(player(t.state, 'p1').tiebreakFt, null);
  assert.match(t.state.log.at(-1).text, /Alex Sheppard finds the water: a miss!/);
  t = hit(match, g, DRIVER);
  assert.equal(t.ev.event, 'tiebreak-shot');
  assert.equal(t.ev.again, true);
  assert.deepEqual([t.state.phase, t.state.tiebreak.round, t.state.tiebreak.pending, t.state.currentPlayerId], ['tiebreak', 2, ['p2', 'p1'], 'p2']);
  assert.deepEqual(types(t.state).slice(-3), ['tiebreak-shot', 'tiebreak-again', 'turn']);
  assert.deepEqual(t.state.players.map((p) => [p.tiebreakFt, p.distToPinYd]), [[null, 150], [null, 150]]);
  // round 2: the same 7-iron from the same tee -> dead level -> again, p1 first once more
  hit(match, g, I7);
  t = hit(match, g, I7);
  assert.equal(t.ev.again, true);
  assert.deepEqual([t.state.tiebreak.round, t.state.tiebreak.pending], [3, ['p1', 'p2']]);
  assert.equal(t.state.winnerId, null);
  assert.match(t.state.log.at(-1).text, /Still level: sudden death round 3!/);
  // round 3: p1 finds the lake, p2 is 40 ft away: a miss loses to any ball on land
  t = hit(match, g, DRIVER);
  assert.equal(t.who, 'p1');
  t = hit(match, g, I8);
  assert.equal(t.ev.event, 'match-over');
  assert.deepEqual([t.state.reason, t.state.winnerId], ['tiebreak', 'p2']);
  assert.equal(t.state.tiebreak.results.length, 6);
  assert.deepEqual(t.state.lastResult.tiebreak, { arenaId: 'a1', rounds: [{ p1: null, p2: null }, { p2: 6.05, p1: 6.05 }, { p1: null, p2: 40.37 }] });
  assert.equal(t.state.lastResult.reason, 'tiebreak');
});

test('no arena: sudden death is played on the same hole from 150 yd (a tour without arenas, and stage "current")', () => {
  // a tour with no tiebreak arenas
  const { match, g } = start({}, { tour: tourOf(3, 0) });
  toPlay(match, g);
  let t = playHole(match, g, tieScript());
  assert.deepEqual(t.state.nextStage, { id: 'shootout', name: 'Shootout', par: 3, lengthYd: 150, theme: 'links', timeOfDay: 'day', blurb: 'Closest to the pin, one ball each.', difficulty: null, kind: 'tiebreak', freeBall: null, routes: null, wind: null });
  match.continue();
  assert.equal(match.waiting.file, null, 'nothing to load: the course in the bay is the one');
  drive(match, g);
  let s = match.state();
  assert.equal(g.course.name, 'Stage 1', 'the same course');
  assert.deepEqual([s.phase, s.stage.id, s.stage.kind, s.stage.lengthYd], ['intro', 'shootout', 'tiebreak', 150]);
  assert.deepEqual(s.tiebreak, { arenaId: null, round: 1, pending: ['p1', 'p2'], results: [], spotYd: 150 });
  assert.equal(+g.distToPinYd.toFixed(1), 150, 'the game holds the shootout spot');
  assert.equal(g.lie, 'fairway');
  match.ready(g);
  t = hit(match, g, I7);
  assert.equal(t.ev.ft, 6.05);
  t = hit(match, g, I8);
  assert.equal(t.ev.event, 'match-over');
  assert.deepEqual([t.state.winnerId, t.state.reason], ['p1', 'tiebreak']);
  assert.deepEqual(t.state.lastResult.tiebreak, { arenaId: null, rounds: [{ p1: 6.05, p2: 40.37 }] });

  // stage 'current' never leaves the loaded course, arenas or not
  const home = newGame(roundCourse());
  const cur = createMatch({ game: home, players: PLAYERS, tour: TOUR, random: rng(0.1), options: { format: 'quick', stage: 'current' } });
  toPlay(cur, home);
  playHole(cur, home, tieScript());
  assert.equal(cur.state().nextStage.id, 'shootout');
  toPlay(cur, home);
  assert.equal(home.course.name, 'Home Course');
  assert.equal(cur.phase, 'tiebreak');
});

test('tieRule halve: tied holes are halved; only a level match at the end goes to sudden death', () => {
  const { match, g } = start({ format: 'bo3', stage: undefined, tieRule: 'halve' }, { random: rng(0.1, 0) });
  assert.equal(match.state().options.tieRule, 'halve');
  toPlay(match, g);
  let t = playHole(match, g, tieScript());
  assert.equal(t.ev.event, 'hole-tied');
  assert.deepEqual([t.ev.reason, t.ev.next], ['halved', 'hole']);
  let s = t.state;
  assert.deepEqual([s.phase, s.lastResult.reason, s.lastResult.winnerId, s.nextStage.id, s.nextStage.kind], ['hole-result', 'halved', null, 's2', 'match']);
  assert.deepEqual({ ...s.events.at(-1), seq: 0, t: 0 }, { seq: 0, t: 0, type: 'hole-tied', holeNumber: 1, reason: 'halved', playerId: s.events.at(-1).playerId, clutch: 'tie' });   // the last putt was to tie, and dropped
  assert.equal(s.honourId, 'p1', 'a halved hole leaves the honour where it was');
  assert.ok(s.log.some((l) => / TIED IT UP! Hole halved: both make a birdie\.$/.test(l.text)));
  toPlay(match, g);
  // p1 takes the second: 1-0 with one to play, not over (first to 2, or ahead with none left)
  t = playHole(match, g, winScript('p1'));
  assert.equal(t.state.phase, 'hole-result');
  assert.equal(t.state.matchPoint, 'p1', 'p2 can only level it');
  toPlay(match, g);
  // p2 levels on the last hole: ALL SQUARE -> a sudden-death playoff decides the match
  t = playHole(match, g, winScript('p2'));
  s = t.state;
  assert.equal(t.ev.event, 'hole-won');
  assert.equal(t.ev.next, 'tiebreak');
  assert.deepEqual([s.phase, s.standings, s.nextStage.kind, s.nextStage.id, s.matchPoint], ['hole-result', 'ALL SQUARE', 'tiebreak', 'a1', 'both']);
  assert.ok(s.log.some((l) => /ALL SQUARE after the last hole: SUDDEN DEATH decides the match!/.test(l.text)));
  s = toPlay(match, g);
  assert.deepEqual([s.phase, s.holeNumber, s.stage.id], ['tiebreak', 4, 'a1']);
  assert.equal(s.currentPlayerId, 'p2', 'the last hole\'s winner leads off');
  hit(match, g, I8);
  t = hit(match, g, I7);
  s = t.state;
  assert.equal(t.ev.event, 'match-over');
  assert.deepEqual([s.phase, s.reason, s.winnerId], ['done', 'tiebreak', 'p1']);
  assert.deepEqual(s.holeResults.map((r) => [r.holeNumber, r.winnerId, r.reason]), [[1, null, 'halved'], [2, 'p1', 'knockout'], [3, 'p2', 'knockout'], [4, 'p1', 'tiebreak']]);
  assert.deepEqual(s.lastResult, { holeNumber: 4, stageId: 'a1', stageName: 'Arena 1', par: 3, winnerId: 'p1', reason: 'tiebreak', scores: {}, tiebreak: { arenaId: 'a1', rounds: [{ p2: 40.37, p1: 6.05 }] }, playoff: true });
  assert.deepEqual(s.players.map((p) => p.holesWon), [2, 1]);

  // halve in a quick match: the only hole halved, sudden death straight away
  const q = start({ tieRule: 'halve' });
  toPlay(q.match, q.g);
  t = playHole(q.match, q.g, tieScript());
  assert.deepEqual([t.state.lastResult.reason, t.state.nextStage.kind, t.ev.next], ['halved', 'tiebreak', 'tiebreak']);
});

// ---------- formats ----------

test('bo3 is first to 2 and bo9 first to 5: standings, match point, the match ends the moment it is won', () => {
  const { match, g } = start({ format: 'bo3', stage: undefined });
  let s = toPlay(match, g);
  assert.equal(s.matchPoint, null, 'nobody at 0-0');
  assert.ok(!types(s).includes('match-point'));
  let t = playHole(match, g, winScript('p1'));
  assert.equal(t.state.standings, 'Alex Sheppard 1 UP');
  assert.equal(t.state.matchPoint, 'p1', 'on the result screen: for the hole that is next');
  assert.ok(t.state.log.some((l) => l.text === 'Alex Sheppard 1 UP. Next: Stage 2.'));
  match.continue();
  drive(match, g);
  s = match.state();
  assert.deepEqual(types(s).slice(-2), ['stage-loaded', 'match-point']);
  assert.equal(s.events.at(-1).playerId, 'p1');
  assert.match(s.log.at(-1).text, /MATCH POINT: Alex Sheppard/);
  match.ready(g);
  t = playHole(match, g, winScript('p2'));
  assert.equal(t.state.standings, 'ALL SQUARE');
  assert.equal(t.state.matchPoint, 'both');
  toPlay(match, g);
  assert.match(match.state().log.find((l) => /MATCH POINT/.test(l.text) && /both/.test(l.text)).text, /MATCH POINT for both players!/);
  t = playHole(match, g, winScript('p2'));
  assert.equal(t.ev.event, 'match-over');
  assert.deepEqual([t.state.winnerId, t.state.reason, t.state.holesPlayed, t.state.standings, t.state.matchPoint], ['p2', 'holes', 3, 'Dave 1 UP', null]);

  // a quick match has no match point: its one hole is the match
  const q = start();
  assert.equal(toPlay(q.match, q.g).matchPoint, null);

  // bo9: 5-0 ends it after five holes; 4-0 does not
  const nine = start({ format: 'bo9', stage: undefined }, { tour: tourOf(9, 3) });
  for (let hole = 1; hole <= 5; hole++) {
    s = toPlay(nine.match, nine.g);
    assert.deepEqual([s.phase, s.holeNumber, s.stage.id], ['play', hole, `s${hole}`]);
    assert.equal(s.matchPoint, hole === 5 ? 'p1' : null);
    t = playHole(nine.match, nine.g, winScript('p1'));
    assert.equal(t.state.phase, hole === 5 ? 'done' : 'hole-result');
  }
  assert.deepEqual([t.state.winnerId, t.state.reason, t.state.standings], ['p1', 'holes', 'Alex Sheppard 5 UP']);
  assert.deepEqual(t.state.players.map((p) => p.charges), [6, 6]);
  assert.equal(t.state.rewards.winner.chest.length, 4, 'a tournament chest holds four balls');
});

// ---------- power-ups ----------

test('loadout: charges for the match, any ball, each id once, spent with the swing', () => {
  assert.deepEqual(['quick', 'bo3', 'bo9'].map((format) => start({ format, stage: undefined }, { tour: tourOf(9, 3) }).match.state().players[0].charges), [2, 3, 6]);
  const { match, g } = start();
  toPlay(match, g);
  assert.equal(match.arm('p1', 'rocket'), 'rocket');
  let s = match.state();
  assert.deepEqual([player(s, 'p1').armedPowerup, player(s, 'p1').charges, player(s, 'p1').usedPowerups], ['rocket', 2, []], 'arming spends nothing yet');
  assert.deepEqual({ ...s.events.at(-1), seq: 0, t: 0 }, { seq: 0, t: 0, type: 'powerup-armed', playerId: 'p1', id: 'rocket' });
  // swap it, put it back, arm again: free until the swing
  match.arm('p1', 'sticky');
  assert.equal(match.arm('p1', null), null);
  assert.equal(player(match.state(), 'p1').armedPowerup, null);
  match.arm('p1', 'rocket');
  assert.throws(() => match.arm('p1', 'nuke'), /Unknown power-up/);
  assert.throws(() => match.arm('zz', 'rocket'), (e) => e instanceof MatchError && e.status === 404);
  // the swing takes the ball with it
  let t = hit(match, g, DRIVER);
  assert.deepEqual(t.shot, { playerId: 'p1', armed: 'rocket', curses: [], free: false });
  assert.deepEqual([player(t.state, 'p1').armedPowerup, player(t.state, 'p1').charges, player(t.state, 'p1').usedPowerups], [null, 1, ['rocket']]);
  // p2's shot carries nothing
  t = hit(match, g, DRIVER_SOFT);
  assert.deepEqual(t.shot, { playerId: 'p2', armed: null, curses: [], free: false });
  assert.equal(player(t.state, 'p2').charges, 2);
  // each id once per match
  assert.throws(() => match.arm('p1', 'rocket'), (e) => e.status === 409 && /already used rocket/.test(e.message));
  // p2 is away and plays; then p1 spends the last charge, and has none left
  hit(match, g, I7);
  match.arm('p1', 'sticky');
  t = hit(match, g, I7);
  assert.equal(t.who, 'p1');
  assert.deepEqual([player(t.state, 'p1').charges, player(t.state, 'p1').usedPowerups], [0, ['rocket', 'sticky']]);
  assert.throws(() => match.arm('p1', 'magnet'), (e) => e.status === 409 && /no charges left/.test(e.message));
  assert.equal(match.arm('p2', 'magnet'), 'magnet', 'p2 still has both');
});

test('powerups off and unlimited', () => {
  const off = start({ powerups: 'off' });
  assert.equal(off.match.state().players[0].charges, 0);
  assert.throws(() => off.match.arm('p1', 'rocket'), (e) => e.status === 409 && /off/.test(e.message));
  assert.equal(off.match.arm('p1', null), null, 'putting nothing back is fine');

  const { match, g } = start({ powerups: 'unlimited' });
  assert.equal(match.state().players[0].charges, null, 'no limit');
  toPlay(match, g);
  match.arm('p1', 'rocket');
  hit(match, g, DRIVER);
  hit(match, g, DRIVER_SOFT);
  hit(match, g, I7);
  match.arm('p1', 'rocket');   // again: no once-per-match
  const t = hit(match, g, I7);
  assert.equal(t.shot.armed, 'rocket');
  assert.deepEqual([player(t.state, 'p1').charges, player(t.state, 'p1').usedPowerups, player(t.state, 'p1').armedPowerup], [null, ['rocket'], null]);
  match.arm('p1', 'gust');
  match.arm('p2', 'gust');
  assert.deepEqual(match.state().players.map((p) => p.cursedWith), ['gust', 'gust']);
});

test('tricks land on the opponent\'s next swing as cursedWith, and are spent with it', () => {
  const { match, g } = start({ format: 'bo3', stage: undefined });
  toPlay(match, g);
  // p2 sabotages p1, who is about to tee off
  assert.equal(match.arm('p2', 'gust'), 'gust');
  let s = match.state();
  assert.deepEqual([player(s, 'p1').cursedWith, player(s, 'p2').cursedWith], ['gust', null]);
  assert.deepEqual([player(s, 'p2').armedPowerup, player(s, 'p2').charges, player(s, 'p2').usedPowerups], [null, 2, ['gust']], 'a trick is never armed on your own ball; cast is spent');
  assert.deepEqual({ ...s.events.at(-1), seq: 0, t: 0 }, { seq: 0, t: 0, type: 'trick-cast', playerId: 'p2', id: 'gust', targetId: 'p1' });
  assert.match(s.log.at(-1).text, /SABOTAGE! Dave casts gust on Alex Sheppard/);
  // one curse at a time; each trick once
  assert.throws(() => match.arm('p2', 'fog'), (e) => e.status === 409 && /already cursed/.test(e.message));
  assert.throws(() => match.arm('p2', 'gust'), /already used gust/);
  assert.equal(player(match.state(), 'p2').charges, 2, 'a refused cast costs nothing');
  // p1 arms a ball as well: the swing carries both
  match.arm('p1', 'laser');
  let t = hit(match, g, DRIVER_SOFT);
  assert.deepEqual(t.shot, { playerId: 'p1', armed: 'laser', curses: ['gust'], free: false });
  assert.equal(player(t.state, 'p1').cursedWith, null, 'the curse went with the swing');
  // p2's own swing is clean
  t = hit(match, g, DRIVER);
  assert.deepEqual(t.shot, { playerId: 'p2', armed: null, curses: [], free: false });
  // p1 answers, but is away and plays first: the curse waits for p2's next swing
  match.arm('p1', 'fog');
  assert.equal(player(match.state(), 'p2').cursedWith, 'fog');
  t = hit(match, g, I7);
  assert.deepEqual([t.who, t.shot.curses], ['p1', []]);
  assert.equal(player(t.state, 'p2').cursedWith, 'fog');
  t = hit(match, g, I7);
  assert.deepEqual([t.who, t.shot.curses], ['p2', ['fog']]);
  assert.equal(player(t.state, 'p2').cursedWith, null);
  // p1 holes out; p2 curses p1 all the same: it waits through the result screen and the
  // next stage's intro for p1's next swing
  t = hit(match, g, PUTT(11));
  assert.deepEqual([t.who, player(t.state, 'p1').holed], ['p1', true]);
  match.arm('p2', 'fog');
  t = hit(match, g, PUTT(4));      // p2 had to hole it
  assert.equal(match.phase, 'hole-result');
  assert.equal(t.state.lastResult.winnerId, 'p1');
  assert.equal(player(t.state, 'p1').cursedWith, 'fog');
  assert.deepEqual(player(t.state, 'p2').usedPowerups, ['gust', 'fog']);
  toPlay(match, g);
  assert.equal(match.state().currentPlayerId, 'p1', 'p1 won the hole and tees off');
  t = hit(match, g, DRIVER);
  assert.deepEqual([t.who, t.shot.curses], ['p1', ['fog']]);
  t = hit(match, g, DRIVER_SOFT);
  assert.deepEqual([t.who, t.shot.curses], ['p2', []]);
  // an armed ball plus a trick need two charges
  const q = start();
  toPlay(q.match, q.g);
  q.match.arm('p1', 'rocket');
  q.match.arm('p1', 'gust');     // 2 charges: one spoken for by the ball, one for the trick
  assert.equal(player(q.match.state(), 'p1').charges, 1);
  assert.throws(() => q.match.arm('p1', 'fog'), /no charges left/, 'the last charge is the armed ball\'s');
});

// ---------- stats, awards, rewards, profiles ----------

test('stats come from each shot and its arcade grade; awards only when somebody earned them', () => {
  const { match, g } = start({ format: 'bo3', stage: undefined });
  toPlay(match, g);
  const A = (grade, points, callout = null) => ({ grade, points, label: grade, callout: callout ? { id: callout, text: `${callout.toUpperCase()}!`, tone: 'epic' } : null });
  hit(match, g, DRIVER, A('GREAT', 700, 'striped'));           // p1: 273 yd
  hit(match, g, DRIVER_SOFT, A('GOOD', 480));                 // p2: 256 yd
  hit(match, g, I7, A('PERFECT', 900, 'dart'));               // p2: on, 65 ft
  hit(match, g, I7, A('PERFECT', 880, 'dance-floor'));        // p1: on, 50 ft
  hit(match, g, PUTT(11), A('JACKPOT', 1000, 'drained'));     // p2 holes it
  let t = hit(match, g, PUTT(4), A('MISS', 80));              // p1 misses: knocked out
  let s = t.state;
  assert.deepEqual(player(s, 'p1').stats, {
    shots: 3, longestDriveYd: 272.7, closestFt: 50.1, bestGrade: 'PERFECT', perfects: 1, points: 1660, callouts: ['striped', 'dance-floor'],
    bestShot: { points: 880, grade: 'PERFECT', callout: 'dance-floor', text: 'DANCE-FLOOR!', holeNumber: 1 },
  });
  assert.deepEqual(player(s, 'p2').stats, {
    shots: 3, longestDriveYd: 256.1, closestFt: 65.1, bestGrade: 'JACKPOT', perfects: 2, points: 2380, callouts: ['dart', 'drained'],
    bestShot: { points: 1000, grade: 'JACKPOT', callout: 'drained', text: 'DRAINED!', holeNumber: 1 },
  });
  assert.equal(s.awards, null, 'not before the match is over');
  toPlay(match, g);
  t = playHole(match, g, winScript('p2'));
  s = t.state;
  assert.equal(s.phase, 'done');
  assert.deepEqual(s.awards, [
    { id: 'longest-drive', label: 'LONGEST DRIVE', playerId: 'p1', value: '273 yd' },
    { id: 'closest-to-pin', label: 'CLOSEST TO THE PIN', playerId: 'p1', value: '50 ft' },
    { id: 'shot-of-the-match', label: 'SHOT OF THE MATCH', playerId: 'p2', value: 'DRAINED! · 1000 pts', points: 1000, holeNumber: 1 },
    { id: 'most-perfects', label: 'MOST PERFECTS', playerId: 'p2', value: '2' },
  ]);
  assert.equal(player(s, 'p2').stats.shots, 6);

  // no arcade grades, a conceded match before anybody hit: no awards to give
  const none = start();
  none.match.concede('p1');
  assert.deepEqual(none.match.state().awards, []);
  // a sudden-death ball counts as an approach; a water ball does not
  const tb = start({}, { random: rng(0.1, 0) });
  toPlay(tb.match, tb.g);
  playHole(tb.match, tb.g, tieScript());
  toPlay(tb.match, tb.g);
  hit(tb.match, tb.g, DRIVER);     // p1: water
  t = hit(tb.match, tb.g, I7);     // p2: 6 ft
  assert.equal(player(t.state, 'p2').stats.closestFt, 6);
  assert.equal(player(t.state, 'p1').stats.closestFt, 50.1, 'p1\'s best is still the approach on the hole');
  assert.deepEqual(t.state.awards.find((a) => a.id === 'closest-to-pin'), { id: 'closest-to-pin', label: 'CLOSEST TO THE PIN', playerId: 'p2', value: '6 ft' });
});

test('profiles: ranks, migration from the first ledger, and what a win pays', () => {
  // the first ledger kept { coins, trophies, streak, wins, losses }
  assert.deepEqual(normalizeProfile({ coins: 800, trophies: 45, streak: 2, wins: 3, losses: 1 }),
    { trophies: 45, rank: 'Rookie', wins: 3, losses: 1, streak: 2, bestStreak: 2, coins: 800 });
  assert.deepEqual(normalizeProfile(null), { trophies: 0, rank: 'Rookie', wins: 0, losses: 0, streak: 0, bestStreak: 0, coins: 1000 });
  assert.deepEqual(normalizeProfile({ trophies: 1234.9, wins: -3, losses: 'x', streak: 1, bestStreak: 7, coins: 0 }),
    { trophies: 1234, rank: 'Master', wins: 0, losses: 0, streak: 1, bestStreak: 7, coins: 0 });

  // a friendly win by format; the loser drops half, never below 0; the streak bonus caps at 15
  assert.deepEqual(rewardsFor({ format: 'quick', loserTrophies: 50, chest: ['rocket', 'sticky'] }),
    { winner: { trophies: 10, coins: 100, chest: ['rocket', 'sticky'], streakBonus: 0, pot: 0 }, loser: { trophies: -5 } });
  assert.deepEqual([rewardsFor({ format: 'bo3', loserTrophies: 50 }).winner.trophies, rewardsFor({ format: 'bo3', loserTrophies: 50 }).loser.trophies], [20, -10]);
  assert.deepEqual([rewardsFor({ format: 'bo9', loserTrophies: 50 }).winner.trophies, rewardsFor({ format: 'bo9', loserTrophies: 50 }).loser.trophies], [40, -20]);
  assert.equal(rewardsFor({ format: 'bo9', loserTrophies: 12 }).loser.trophies, -12, 'never below 0');
  assert.equal(rewardsFor({ format: 'quick', loserTrophies: 0 }).loser.trophies, 0);
  assert.deepEqual([0, 1, 2, 3, 9].map((winStreak) => rewardsFor({ format: 'quick', winStreak }).winner.trophies), [10, 15, 20, 25, 25]);
  // with stakes: the tier's trophies both ways and the pot on top of the format's coins
  assert.deepEqual(rewardsFor({ format: 'bo3', stakes: { tier: 'pro', pot: 2000 }, winStreak: 1, loserTrophies: 500 }),
    { winner: { trophies: 35, coins: 2250, chest: [], streakBonus: 5, pot: 2000 }, loser: { trophies: -30 } });

  // applying them
  const next = applyRewards(
    { trophies: 95, wins: 4, losses: 2, streak: 4, bestStreak: 4, coins: 500 },
    { trophies: 3, wins: 1, losses: 1, streak: 6, bestStreak: 6, coins: 40 },
    { winner: { trophies: 25, coins: 100 }, loser: { trophies: -5 } },
  );
  assert.deepEqual(next.winner, { trophies: 120, rank: 'Amateur', wins: 5, losses: 2, streak: 5, bestStreak: 5, coins: 600 });
  assert.deepEqual(next.loser, { trophies: 0, rank: 'Rookie', wins: 1, losses: 2, streak: 0, bestStreak: 6, coins: 40 });
});

test('rewards: trophies by format and streak, the loser\'s drop, a chest of balls, coins', () => {
  const players = [
    { ...PLAYERS[0], profile: { trophies: 3, streak: 0 } },
    { ...PLAYERS[1], profile: { trophies: 200, streak: 2 } },
  ];
  const { match, g } = start({ format: 'bo3', stage: undefined }, { players, random: rng(0.1, 0, 0.7) });
  toPlay(match, g);
  assert.equal(match.state().rewards, null);
  playHole(match, g, winScript('p2'));
  toPlay(match, g);
  const t = playHole(match, g, winScript('p2'));
  const s = t.state;
  assert.deepEqual(s.rewards.winner, { trophies: 30, coins: 250, chest: s.rewards.winner.chest, streakBonus: 10, pot: 0 });
  assert.deepEqual(s.rewards.loser, { trophies: -3 }, 'half of 20 would be 10: p1 only has 3');
  assert.deepEqual(t.ev.rewards, s.rewards);
  const balls = CATALOGUE.filter((c) => c.kind !== 'trick').map((c) => c.id);
  assert.equal(s.rewards.winner.chest.length, 2);
  assert.equal(new Set(s.rewards.winner.chest).size, 2, 'two different balls');
  for (const id of s.rewards.winner.chest) assert.ok(balls.includes(id), `${id} is a ball, never a trick`);
  assert.match(s.log.at(-1).text, /DAVE WINS THE MATCH! \+30 trophies, \+250 coins\./);
  assert.deepEqual(s.events.at(-1).type, 'match-over');
  // a staked match: the tier's numbers and the pot
  const staked = start({ stakes: 'pro' }, { players });
  staked.match.concede('p1');
  assert.deepEqual(staked.match.state().rewards.winner, { trophies: 40, coins: 2100, chest: staked.match.state().rewards.winner.chest, streakBonus: 10, pot: 2000 });
  assert.deepEqual(staked.match.state().rewards.loser, { trophies: -3 });
});

// ---------- concede, abort, rematch ----------

test('concede hands the match to the other player, in any phase', () => {
  const { match, g } = start({ format: 'bo3', stage: undefined });
  toPlay(match, g);
  hit(match, g, DRIVER);
  const ev = match.concede('p1');
  assert.deepEqual([ev.event, ev.reason, ev.winnerId, ev.loserId], ['match-over', 'concede', 'p2', 'p1']);
  const s = match.state();
  assert.deepEqual([s.phase, s.reason, s.winnerId, s.concededBy, s.currentPlayerId, s.nextStage], ['done', 'concede', 'p2', 'p1', null, null]);
  assert.ok(s.rewards.winner.trophies > 0);
  assert.ok(s.log.some((l) => l.text === 'Alex Sheppard concedes.'));
  assert.deepEqual({ ...s.events.at(-1), seq: 0, t: 0 }, { seq: 0, t: 0, type: 'match-over', winnerId: 'p2', loserId: 'p1', reason: 'concede' });
  assert.throws(() => match.concede('p2'), MatchError);
  assert.throws(() => start().match.concede('nobody'), (e) => e.status === 404);
  // while a stage is still loading: the course that then arrives is not the match's any more
  const loading = start();
  const w = loading.match.waiting;
  loading.match.concede('p2');
  loading.g.setCourse(COURSES[w.file]());
  assert.equal(loading.match.stageReady(loading.g, w.token), false);
  assert.equal(loading.match.phase, 'done');
  // on the result screen
  const between = start({ format: 'bo3', stage: undefined });
  toPlay(between.match, between.g);
  playHole(between.match, between.g, winScript('p1'));
  between.match.concede('p1');
  assert.deepEqual([between.match.state().winnerId, between.match.state().reason], ['p2', 'concede']);
});

test('abort and release: a tour match leaves a fresh hole on its last stage; stage "current" puts the round back', () => {
  // tour
  const { match, g } = start({ format: 'bo3', stage: undefined });
  toPlay(match, g);
  hit(match, g, DRIVER);
  hit(match, g, DRIVER_SOFT);
  const s = match.abort(g);
  assert.deepEqual([s.phase, s.aborted, s.winnerId, s.rewards, s.waiting], ['done', true, null, null, null]);
  assert.equal(match.active, false);
  assert.equal(g.course.name, 'Stage 1', 'the bay stays on the stage');
  assert.deepEqual([g.ball, g.strokes, g.lie, g.holed, g.over, g.scores, g.shotLog.length], [{ x: 0, y: 0 }, 0, 'tee', false, false, [null], 0]);
  // a tour match dropped before its first stage arrived never touched the round in the bay
  const mid = newGame(roundCourse());
  mid.handleShot(DRIVER);
  const untouched = start({}, { game: mid }).match;
  untouched.abort(mid);
  assert.equal(mid.strokes, 1);
  assert.equal(+mid.distToPinYd.toFixed(1), 164.7);

  // stage 'current': the round in progress comes back exactly
  const home = newGame(roundCourse());
  home.nextHole();              // on the second hole (ref 8) ...
  home.handleShot(DRIVER);      // ... one stroke played
  home.setAimOffset(-2);
  home.player = { id: 'solo', name: 'Solo' };
  const before = { holeIndex: home.holeIndex, ball: { ...home.ball }, strokes: home.strokes, lie: home.lie, aimOffset: home.aimOffset, player: home.player, scores: [...home.scores] };
  const cur = createMatch({ game: home, players: PLAYERS, tour: TOUR, random: rng(0.1), options: { format: 'bo3', stage: 'current' } });
  assert.deepEqual(cur.state().stage, { id: 'current', name: 'Home Course · Hole 8', par: 4, lengthYd: 437, theme: null, timeOfDay: 'day', blurb: '', difficulty: null, kind: 'current', freeBall: null, routes: null, wind: null });
  assert.equal(cur.waiting.file, null);
  let st = toPlay(cur, home);
  assert.deepEqual([st.phase, st.holeNumber, st.holeIndex, st.holeRef], ['play', 1, 1, 8]);
  assert.deepEqual(home.ball, { x: 0, y: 0 }, 'the match tees the first player up');
  assert.equal(home.player.id, 'p1', 'the HUD shows who is up');
  // holes follow the course, wrapping at the end
  playHole(cur, home, winScript('p1'));
  assert.equal(cur.state().nextStage.name, 'Home Course · Hole 9');
  st = toPlay(cur, home);
  assert.deepEqual([st.holeNumber, st.holeIndex, st.holeRef, st.stage.kind], [2, 2, 9, 'current']);
  playHole(cur, home, winScript('p2'));
  st = toPlay(cur, home);
  assert.deepEqual([st.holeNumber, st.holeIndex, st.holeRef], [3, 0, 7]);
  hit(cur, home, DRIVER);
  cur.abort(home);
  assert.deepEqual({ holeIndex: home.holeIndex, ball: home.ball, strokes: home.strokes, lie: home.lie, aimOffset: home.aimOffset, player: home.player, scores: home.scores }, before);
  assert.equal(home.over, false);
  // another course loaded mid-match: release leaves the new round alone
  const g2 = newGame(roundCourse());
  const m2 = createMatch({ game: g2, players: PLAYERS, tour: null, random: rng(0.1), options: { format: 'quick', stage: 'current' } });
  toPlay(m2, g2);
  hit(m2, g2, DRIVER);
  g2.setCourse(roundCourse());
  assert.equal(m2.release(g2), false);
  assert.deepEqual([g2.ball, g2.strokes], [{ x: 0, y: 0 }, 0]);
});

test('rematch: config() is what the same match starts from again', () => {
  const { match, g } = start({ format: 'bo3', stage: undefined, order: 'shuffle', tieRule: 'halve', powerups: 'unlimited', stakes: 'rookie', hazardLosesHole: true });
  toPlay(match, g);
  match.concede('p2');
  const cfg = match.config();
  assert.deepEqual(cfg, {
    players: [{ id: 'p1', name: 'Alex Sheppard', initials: 'AS', handicap: null }, { id: 'p2', name: 'Dave', initials: 'DA', handicap: null }],
    options: { format: 'bo3', stage: null, order: 'shuffle', tieRule: 'halve', powerups: 'unlimited', hazardLosesHole: true, putting: 'assist', stakes: 'rookie' },
  });
  const again = createMatch({ game: g, players: cfg.players, tour: TOUR, random: rng(0.1), options: { ...cfg.options, catalogue: CATALOGUE } });
  const s = again.state();
  assert.notEqual(s.id, match.id);
  assert.deepEqual([s.format, s.phase, s.holeNumber, s.options.tieRule, s.options.powerups, s.options.order, s.stakes.tier, s.options.hazardLosesHole],
    ['bo3', 'loading', 1, 'halve', 'unlimited', 'shuffle', 'rookie', true]);
  assert.deepEqual(s.players.map((p) => [p.id, p.slot, p.holesWon, p.usedPowerups]), [['p1', 1, 0, []], ['p2', 2, 0, []]]);
  // a quick match on a named stage plays that stage again; 'current' starts on the same hole
  assert.equal(start({ stage: 's2' }).match.config().options.stage, 's2');
  const home = newGame(roundCourse());
  home.nextHole();
  const cur = createMatch({ game: home, players: PLAYERS, tour: null, options: { stage: 'current' } });
  assert.deepEqual(cur.config().options, { format: 'quick', stage: 'current', order: 'tour', tieRule: 'shootout', powerups: 'loadout', hazardLosesHole: false, putting: 'assist', stakes: null, holeIndex: 1 });
});

// ---------- events and the driver's failures ----------

test('events: every one has its own rising seq, the last 12 are kept, in the order things happened', () => {
  const { match, g } = start();
  let s = match.state();
  assert.deepEqual(types(s), ['match-start', 'coin-flip']);
  assert.deepEqual({ ...s.events[0], t: 0 }, { seq: 1, t: 0, type: 'match-start', format: 'quick', playerIds: ['p1', 'p2'] });
  assert.equal(s.seq, 2);
  const seqs = [s.seq];
  const step = () => { const now = match.state(); seqs.push(now.seq); return now; };
  drive(match, g);
  s = step();
  assert.deepEqual(types(s), ['match-start', 'coin-flip', 'stage-loaded']);
  assert.deepEqual({ ...s.events.at(-1), seq: 0, t: 0 }, { seq: 0, t: 0, type: 'stage-loaded', stageId: 's1', kind: 'match', holeNumber: 1 });
  match.ready(g);
  s = step();
  assert.deepEqual(types(s), ['match-start', 'coin-flip', 'stage-loaded', 'ready', 'turn']);
  assert.deepEqual({ ...s.events.at(-1), seq: 0, t: 0 }, { seq: 0, t: 0, type: 'turn', playerId: 'p1', mustHole: false, shotFor: 'lead', shotKind: 'shot' });   // (an ace would put p2 on a must-make)
  for (const launch of [DRIVER, DRIVER_SOFT, I7, I7]) { hit(match, g, launch); step(); }
  hit(match, g, PUTT(11));
  s = step();
  assert.deepEqual(types(s), ['match-start', 'coin-flip', 'stage-loaded', 'ready', 'turn', 'turn', 'turn', 'turn', 'turn', 'turn', 'must-hole']);
  hit(match, g, PUTT(11));     // tied
  s = step();
  match.continue(); step();
  drive(match, g); step();
  match.ready(g);
  s = step();
  assert.equal(s.events.length, 12, 'only the newest twelve');
  assert.deepEqual(types(s), ['turn', 'turn', 'turn', 'turn', 'turn', 'turn', 'must-hole', 'hole-tied', 'stage-loaded', 'ready', 'tiebreak-start', 'turn']);
  hit(match, g, I7); step();
  hit(match, g, I8);
  s = step();
  assert.deepEqual(types(s).slice(-8), ['ready', 'tiebreak-start', 'turn', 'tiebreak-shot', 'turn', 'tiebreak-shot', 'hole-won', 'match-over']);
  assert.deepEqual({ ...s.events.at(-3), seq: 0, t: 0 }, { seq: 0, t: 0, type: 'tiebreak-shot', playerId: 'p2', ft: 40.37, miss: null, round: 1 });
  // seq: the state's rises with every change, every event has its own, none repeats
  for (let i = 1; i < seqs.length; i++) assert.ok(seqs[i] > seqs[i - 1], `seq rose at step ${i}`);
  const eventSeqs = s.events.map((e) => e.seq);
  assert.deepEqual([...eventSeqs].sort((a, b) => a - b), eventSeqs);
  assert.equal(new Set(eventSeqs).size, eventSeqs.length);
  assert.ok(s.seq >= eventSeqs.at(-1));
  // changes without an event move seq too (so a client can tell states apart)
  const q = start();
  const s0 = q.match.state().seq;
  q.match.arm('p1', 'rocket');
  q.match.arm('p1', null);
  assert.ok(q.match.state().seq > s0 + 1);
});

test('a stage that will not load: another stage, or the same-hole shootout for an arena; none left: the match is off', () => {
  // the first stage fails: the next unplayed one takes its place
  const { match, g } = start({ format: 'bo3', stage: undefined });
  let w = match.waiting;
  assert.equal(match.stageFailed(w.token + 1, 'nope'), false, 'not this request');
  assert.equal(match.stageFailed(w.token, 'file missing'), true);
  assert.deepEqual([match.phase, match.waiting.file, match.state().stage.id, match.state().nextStage.id], ['loading', 's2.json', 's2', 's2']);
  assert.ok(match.state().log.some((l) => l.text === 'Stage 1 would not load: Stage 2 instead.'));
  toPlay(match, g);
  // tied: the arena fails -> sudden death on this hole instead
  playHole(match, g, tieScript());
  match.continue();
  w = match.waiting;
  assert.equal(w.kind, 'tiebreak');
  assert.ok(w.file);
  assert.equal(match.stageFailed(w.token, 'broken'), true);
  assert.deepEqual([match.phase, match.waiting.file, match.state().nextStage.id], ['loading', null, 'shootout']);
  toPlay(match, g);
  assert.equal(match.phase, 'tiebreak');
  assert.equal(g.course.name, 'Stage 2');
  assert.equal(match.state().tiebreak.arenaId, null);
  hit(match, g, I7);
  hit(match, g, I8);
  assert.equal(match.state().lastResult.winnerId, 'p1');
  // nothing was to be loaded: nothing can fail
  match.continue();
  assert.equal(match.state().nextStage.id, 's3', 'the failed stage is not played later either');
  // the only stage there is fails: off
  const one = start({ stage: undefined }, { tour: tourOf(1, 0) });
  assert.equal(one.match.stageFailed(one.match.waiting.token, 'gone'), true);
  const s = one.match.state();
  assert.deepEqual([s.phase, s.aborted, s.winnerId, s.rewards, s.error], ['done', true, null, null, 'gone']);
  assert.equal(one.match.aborted, true);
});

// ---------- contract addenda: rocket holes, extreme stages, routes ----------

test('rocket hole: every player\'s first stroke on a freeBall stage is that ball, free; their own ball stays armed', () => {
  const ROUTES = [{ id: 'safe', name: 'Round the lake', note: 'Wide and long.' }, { id: 'rocket', name: 'The shelf', note: 'Only a boosted ball gets up there.' }];
  const tour = { stages: [stageEntry(1, { freeBall: 'rocket', routes: ROUTES }), stageEntry(2), stageEntry(3)], tiebreaks: [{ ...arenaEntry(1), freeBall: 'sticky' }] };
  const { match, g } = start({ format: 'bo3', stage: undefined }, { tour });
  // the stage carries it from the first moment, routes too
  let s = match.state();
  assert.deepEqual([s.stage.freeBall, s.nextStage.freeBall], ['rocket', 'rocket']);
  assert.deepEqual(s.stage.routes, ROUTES);
  s = toPlay(match, g);
  assert.equal(s.stage.freeBall, 'rocket');
  assert.ok(!types(s).includes('powerup-armed'), 'nothing new is emitted: the UI reads it from the stage');
  // p1 has armed a ball of their own: the tee shot is the free rocket all the same
  match.arm('p1', 'laser');
  let t = hit(match, g, DRIVER);
  assert.deepEqual(t.shot, { playerId: 'p1', armed: 'rocket', curses: [], free: true });
  assert.deepEqual([player(t.state, 'p1').charges, player(t.state, 'p1').usedPowerups, player(t.state, 'p1').armedPowerup], [3, [], 'laser'], 'no charge, not used, their own ball kept for later');
  // p2's tee shot too, with a trick on it: the curse is spent, the rocket is free
  match.arm('p1', 'gust');
  t = hit(match, g, DRIVER_SOFT);
  assert.deepEqual(t.shot, { playerId: 'p2', armed: 'rocket', curses: ['gust'], free: true });
  assert.deepEqual([player(t.state, 'p2').charges, player(t.state, 'p2').usedPowerups, player(t.state, 'p2').cursedWith], [3, [], null]);
  // second strokes are ordinary: p2 (away) plays a plain ball, p1 the laser they kept
  t = hit(match, g, I7);
  assert.deepEqual(t.shot, { playerId: 'p2', armed: null, curses: [], free: false });
  t = hit(match, g, I7);
  assert.deepEqual(t.shot, { playerId: 'p1', armed: 'laser', curses: [], free: false });
  assert.deepEqual([player(t.state, 'p1').charges, player(t.state, 'p1').usedPowerups, player(t.state, 'p1').armedPowerup], [1, ['gust', 'laser'], null]);
  // the free rocket does not use up 'rocket' for the match: it can still be armed once
  assert.equal(match.arm('p2', 'rocket'), 'rocket');
  match.arm('p2', null);
  // tied: the arena has a free ball of its own, on every sudden-death ball, re-rounds too
  playHole(match, g, { p1: [PUTT(11)], p2: [PUTT(11)] });
  s = toPlay(match, g);
  assert.deepEqual([s.phase, s.stage.id, s.stage.freeBall, s.stage.routes], ['tiebreak', 'a1', 'sticky', null]);
  t = hit(match, g, I7);
  assert.deepEqual([t.shot.armed, t.shot.free], ['sticky', true]);
  t = hit(match, g, I7);
  assert.deepEqual([t.shot.armed, t.shot.free, t.ev.again], ['sticky', true, true]);
  t = hit(match, g, I8);
  assert.deepEqual([t.shot.armed, t.shot.free], ['sticky', true]);
  t = hit(match, g, I7);
  assert.equal(t.ev.event, 'hole-won');
  assert.deepEqual(t.state.players.map((p) => p.charges), [1, 3], 'sudden death cost nobody a charge');
  // the next stage has none: the tee shot is plain again
  s = toPlay(match, g);
  assert.deepEqual([s.stage.id, s.stage.freeBall, s.stage.routes], ['s2', null, null]);
  t = hit(match, g, DRIVER);
  assert.equal(t.shot.free, false);

  // power-ups off: the stage's free ball still rides on the tee shot
  const off = start({ powerups: 'off', stage: 's1' }, { tour });
  toPlay(off.match, off.g);
  assert.deepEqual(hit(off.match, off.g, DRIVER).shot, { playerId: 'p1', armed: 'rocket', curses: [], free: true });
  // a free ball that is not a ball of the catalogue (a trick, a typo) is no free ball
  for (const freeBall of ['gust', 'no-such-ball']) {
    const odd = start({ stage: 's1' }, { tour: { stages: [stageEntry(1, { freeBall })], tiebreaks: [] } });
    toPlay(odd.match, odd.g);
    assert.equal(hit(odd.match, odd.g, DRIVER).shot.free, false, freeBall);
  }
});

test('the course in the bay has the last word on freeBall and routes (and stage "current" reads them from it)', () => {
  const ROUTES = [{ id: 'risky', name: 'Over the gorge', note: 'Carry 259 or splash.' }];
  // the manifest says nothing; the course file does
  const rocketCourse = () => ({ ...stageCourse('Stage 1')(), arcade: { freeBall: 'rocket' }, holes: [{ ...stageCourse('x')().holes[0], routes: ROUTES }] });
  const { match, g } = start();
  const w = match.waiting;
  assert.equal(match.state().stage.freeBall, null);
  g.setCourse(rocketCourse());
  match.stageReady(g, w.token);
  assert.deepEqual([match.state().stage.freeBall, match.state().stage.routes], ['rocket', ROUTES]);
  match.ready(g);
  assert.deepEqual([hit(match, g, DRIVER).shot.armed, hit(match, g, DRIVER).shot.armed], ['rocket', 'rocket']);
  // stage 'current' on such a course
  const home = newGame(rocketCourse());
  const cur = createMatch({ game: home, players: PLAYERS, tour: null, random: rng(0.1), options: { stage: 'current', catalogue: CATALOGUE } });
  assert.deepEqual([cur.state().stage.freeBall, cur.state().stage.routes], ['rocket', ROUTES]);
  toPlay(cur, home);
  const t = hit(cur, home, DRIVER);
  assert.deepEqual([t.shot.armed, t.shot.free, player(t.state, 'p1').charges], ['rocket', true, 2]);
  // the same-hole shootout is not a tee shot: no free ball there
  playHole(cur, home, { p1: [I7, PUTT(11)], p2: [DRIVER_SOFT, I7, PUTT(11)] });
  const s = toPlay(cur, home);
  assert.deepEqual([s.phase, s.stage.id, s.stage.freeBall], ['tiebreak', 'shootout', null]);
  assert.equal(hit(cur, home, I7).shot.free, false);
});

test('a tour beyond nine stages: tour order plays orders 1 to 9; a shuffle and the quick draw use every stage', () => {
  const big = tourOf(12, 3);
  for (let n = 10; n <= 12; n++) COURSES[`s${n}.json`] = stageCourse(`Stage ${n}`);
  const seen = (options, random = rng(0.1), tour = big) => {
    const { match, g } = start({ stage: undefined, ...options }, { tour, random });
    const out = [];
    for (let i = 0; i < MATCH_FORMATS[options.format].maxHoles && match.active; i++) {
      toPlay(match, g);
      out.push(match.state().stage.id);
      playHole(match, g, winScript(i % 2 ? 'p1' : 'p2'));
    }
    return out;
  };
  assert.deepEqual(seen({ format: 'bo9' }), ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'], 'the extreme stages are not in the tour proper');
  assert.deepEqual(seen({ format: 'bo3', stage: 's8' }), ['s8', 's9', 's1'], 'tour order wraps inside the nine');
  // an extreme stage asked for: it opens the series, then the tour
  assert.deepEqual(seen({ format: 'bo3', stage: 's11' }), ['s11', 's1', 's2']);
  // the quick draw and a shuffle reach all twelve
  assert.deepEqual(seen({ format: 'quick' }, rng(0.99, 0.1)), ['s12']);
  assert.deepEqual(seen({ format: 'quick', stage: 's10' }), ['s10']);
  const dealt = new Set();
  for (let k = 0; k < 12; k++) {
    const order = seen({ format: 'bo9', order: 'shuffle' }, rng(...Array.from({ length: 11 }, (_, i) => ((i * 7 + k * 5) % 12) / 12 + 0.01), 0.1));
    assert.equal(new Set(order).size, 9, 'nine different stages');
    order.forEach((id) => dealt.add(id));
  }
  assert.ok(['s10', 's11', 's12'].some((id) => dealt.has(id)), 'a shuffle can deal an extreme stage');
  // a manifest that only has extras (orders 10 and up) still plays
  assert.deepEqual(seen({ format: 'bo3' }, rng(0.1), { stages: [stageEntry(10), stageEntry(11)], tiebreaks: [] }), ['s10', 's11', 's10']);
});

// ---------- the match menu: undo, restart the hole, stray balls ----------

const { STRAY_MAX_MPH, STRAY_MIN_YD, isStrayShot } = require('../lib/match');
// the match as the players see it, without its history and its clocks
const core = (s) => { const { seq, events, log, turnStartedAt, undoable, waiting, ...rest } = s; return rest; };
const gameAt = (g) => ({ ball: { ...g.ball }, strokes: g.strokes, lie: g.lie, holed: g.holed, holeIndex: g.holeIndex, over: g.over, shots: g.shotLog.length, player: g.player && g.player.id });

test('undo: the last swing is taken back, with the ball and the trick that rode on it', () => {
  const { match, g } = start({ format: 'bo3', stage: undefined });
  toPlay(match, g);
  assert.equal(match.state().undoable, null, 'nothing to take back before a swing');
  assert.throws(() => match.undoLastShot(g), (e) => e instanceof MatchError && e.status === 409 && /no shot to take back/i.test(e.message));
  match.arm('p1', 'rocket');           // p1's ball for the tee shot
  match.arm('p2', 'gust');             // p2's trick, on p1's next swing
  const before = match.state(), gameBefore = gameAt(g);
  assert.deepEqual([player(before, 'p1').charges, player(before, 'p1').armedPowerup, player(before, 'p1').cursedWith, player(before, 'p2').charges], [3, 'rocket', 'gust', 2]);
  let t = hit(match, g, DRIVER);
  assert.deepEqual([t.who, t.shot.armed, t.shot.curses], ['p1', 'rocket', ['gust']]);
  let p1 = player(t.state, 'p1');
  assert.deepEqual([p1.strokes, p1.charges, p1.usedPowerups, p1.armedPowerup, p1.cursedWith, p1.stats.shots], [1, 2, ['rocket'], null, null, 1]);
  assert.deepEqual(t.state.undoable, { playerId: 'p1', stray: false, holeNumber: 1 });
  assert.equal(t.state.currentPlayerId, 'p2');
  assert.equal(g.shotLog.length, gameBefore.shots + 1);

  const ev = match.undoLastShot(g);
  assert.deepEqual(ev, { event: 'shot-undone', playerId: 'p1', stray: false, from: 'play' });
  const s = match.state();
  assert.deepEqual(core(s), core(before), 'the match exactly as it was before the swing');
  p1 = player(s, 'p1');
  assert.deepEqual([p1.strokes, p1.lie, p1.ball, p1.charges, p1.usedPowerups, p1.armedPowerup, p1.cursedWith, p1.stats.shots, p1.stats.longestDriveYd],
    [0, 'tee', { x: 0, y: 0 }, 3, [], 'rocket', 'gust', 0, null], 'the rocket is armed again, the gust is waiting again');
  assert.equal(player(s, 'p2').charges, 2, 'the trick was cast before the swing: it stays cast');
  assert.deepEqual(gameAt(g), gameBefore, 'the game has the ball back on the tee and no trace of the shot');
  assert.ok(s.seq > t.state.seq, 'seq only ever rises');
  assert.deepEqual(s.events.at(-1), { seq: s.events.at(-1).seq, type: 'shot-undone', t: s.events.at(-1).t, playerId: 'p1', stray: false, from: 'play' });
  assert.match(s.log.at(-1).text, /Alex Sheppard's last shot is taken back/);
  assert.equal(s.undoable, null, 'one level: the swing before it is final');
  assert.throws(() => match.undoLastShot(g), /no shot to take back/i);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(s)));
  // the swing is played again and counts as the first one did
  t = hit(match, g, DRIVER);
  assert.deepEqual([t.who, t.shot.armed, t.shot.curses, player(t.state, 'p1').strokes, player(t.state, 'p1').charges], ['p1', 'rocket', ['gust'], 1, 2]);
  // something armed or cast after the swing goes back with it
  match.arm('p2', 'sticky');
  match.arm('p1', 'fog');
  assert.deepEqual([player(match.state(), 'p2').armedPowerup, player(match.state(), 'p2').cursedWith, player(match.state(), 'p1').charges], ['sticky', 'fog', 1]);
  match.undoLastShot(g);
  assert.deepEqual(core(match.state()), core(before));
  // an aim set for the swing comes back with it
  g.setAimOffset(-4);
  hit(match, g, DRIVER);
  match.undoLastShot(g);
  assert.deepEqual([g.aimOffset, player(match.state(), 'p1').strokes], [-4, 0]);
});

test('undo: a swing that decided the hole, or the match, is taken back from the result screen', () => {
  // the hole: p1 is in for 3; p2's putt to tie is left short and knocks p2 out
  const allButLast = (match, g, script) => {
    for (let n = script.p1.length + script.p2.length; n > 1; n--) hit(match, g, script[match.currentPlayerId].shift());
    return script[match.currentPlayerId].shift();
  };
  const { match, g } = start({ format: 'bo3', stage: undefined });
  toPlay(match, g);
  const last = allButLast(match, g, winScript('p1'));
  const before = match.state(), gameBefore = gameAt(g);
  assert.deepEqual([before.phase, before.currentPlayerId, before.holeResults.length, player(before, 'p2').mustHole], ['play', 'p2', 0, true]);
  let t = hit(match, g, last);
  assert.deepEqual([t.ev.event, t.state.phase, t.state.lastResult.winnerId, player(t.state, 'p1').holesWon, t.state.holesPlayed, t.state.nextStage.id, t.state.waiting.for],
    ['hole-won', 'hole-result', 'p1', 1, 1, 's2', 'continue']);
  assert.deepEqual(t.state.undoable, { playerId: 'p2', stray: false, holeNumber: 1 });
  const token = match.waiting.token;
  assert.deepEqual(match.undoLastShot(g), { event: 'shot-undone', playerId: 'p2', stray: false, from: 'hole-result' });
  let s = match.state();
  assert.deepEqual(core(s), core(before), 'back in play, the hole undecided');
  assert.deepEqual([s.phase, s.currentPlayerId, s.holeResults, s.lastResult, s.nextStage, s.holesPlayed, s.standings, s.waiting, player(s, 'p1').holesWon, player(s, 'p1').holeScores, player(s, 'p2').mustHole],
    ['play', 'p2', [], null, null, 0, 'ALL SQUARE', null, 0, [], true]);
  assert.equal(match.waiting, null);
  assert.deepEqual(gameAt(g), gameBefore);
  assert.equal(match.continue(), false, 'there is no result screen to leave any more');
  // played again: decided again; the driver gets a request it has not seen
  t = hit(match, g, last);
  assert.equal(t.state.phase, 'hole-result');
  assert.ok(match.waiting.token > token, 'the wait token only ever rises');
  // once the result screen is left the hole is final
  assert.equal(match.continue(), true);
  assert.equal(match.state().undoable, null);
  assert.throws(() => match.undoLastShot(g), /no shot to take back/i);

  // the match: a quick match lost with the same putt
  const q = start({ format: 'quick' });
  toPlay(q.match, q.g);
  const qLast = allButLast(q.match, q.g, winScript('p2'));
  const qBefore = q.match.state();
  t = hit(q.match, q.g, qLast);
  assert.deepEqual([t.ev.event, t.state.phase, t.state.winnerId, t.state.reason, Boolean(t.state.rewards), t.state.waiting.for], ['match-over', 'done', 'p2', 'holes', true, 'dismiss']);
  assert.equal(q.match.active, false);
  assert.deepEqual(q.match.undoLastShot(q.g), { event: 'shot-undone', playerId: 'p1', stray: false, from: 'done' });
  s = q.match.state();
  assert.deepEqual(core(s), core(qBefore));
  assert.deepEqual([s.phase, s.winnerId, s.loserId, s.reason, s.rewards, s.awards, s.currentPlayerId, q.match.active, q.match.waiting], ['play', null, null, null, null, null, 'p1', true, null]);
  t = hit(q.match, q.g, qLast);        // the same putt again: the same result, decided afresh
  assert.deepEqual([t.state.phase, t.state.winnerId, t.state.waiting.for], ['done', 'p2', 'dismiss']);
  // a concession is final
  const c = start({ format: 'quick' });
  toPlay(c.match, c.g);
  hit(c.match, c.g, DRIVER);
  c.match.concede('p1');
  assert.equal(c.match.state().undoable, null);
  assert.throws(() => c.match.undoLastShot(c.g), /no shot to take back/i);
});

test('undo: a sudden-death ball, the ball that settles it, and the one that sends it round again', () => {
  const { match, g } = start({ format: 'bo3', stage: undefined }, { random: rng(0.1, 0) });
  toPlay(match, g);
  playHole(match, g, tieScript());
  let s = toPlay(match, g);
  assert.deepEqual([s.phase, s.stage.id, s.tiebreak.pending, s.lastResult.reason], ['tiebreak', 'a1', ['p1', 'p2'], 'tied']);
  const tee = match.state(), gameTee = gameAt(g);
  // the first ball
  let t = hit(match, g, I8);
  assert.deepEqual([t.ev.event, t.state.tiebreak.pending, t.state.tiebreak.results.length, player(t.state, 'p1').tiebreakFt != null], ['tiebreak-shot', ['p2'], 1, true]);
  match.undoLastShot(g);
  s = match.state();
  assert.deepEqual(core(s), core(tee));
  assert.deepEqual([s.tiebreak.pending, s.tiebreak.results, player(s, 'p1').tiebreakFt, s.currentPlayerId], [['p1', 'p2'], [], null, 'p1']);
  assert.deepEqual(gameAt(g), gameTee, 'the game is back on the tee of the arena');
  // the ball that settles it: the tied hole had its winner, and is tied again
  hit(match, g, I8);
  const mid = match.state();
  t = hit(match, g, I7);
  assert.deepEqual([t.ev.event, t.state.phase, t.state.lastResult.reason, t.state.lastResult.winnerId, t.state.holeResults[0].winnerId, player(t.state, 'p2').holesWon, t.state.honourId],
    ['hole-won', 'hole-result', 'tiebreak', 'p2', 'p2', 1, 'p2']);
  assert.deepEqual(match.undoLastShot(g), { event: 'shot-undone', playerId: 'p2', stray: false, from: 'hole-result' });
  s = match.state();
  assert.deepEqual(core(s), core(mid));
  assert.deepEqual([s.phase, s.currentPlayerId, s.tiebreak.pending, s.tiebreak.results.length, s.lastResult.reason, s.lastResult.winnerId, s.holeResults[0].reason, s.holeResults[0].tiebreak, player(s, 'p2').holesWon, s.honourId],
    ['tiebreak', 'p2', ['p2'], 1, 'tied', null, 'tied', null, 0, 'p1']);
  // the ball that leaves it level: round two is taken back to round one
  t = hit(match, g, I8);
  assert.deepEqual([t.ev.again, t.state.tiebreak.round, t.state.tiebreak.pending], [true, 2, ['p2', 'p1']]);
  match.undoLastShot(g);
  s = match.state();
  assert.deepEqual([s.tiebreak.round, s.tiebreak.pending, s.tiebreak.results.length], [1, ['p2'], 1]);
  assert.deepEqual(core(s), core(mid));
  // and it still plays out: the tied hole gets its winner in the list of results, not a copy of it
  t = hit(match, g, I7);
  assert.deepEqual([t.state.phase, t.state.lastResult.winnerId, t.state.holeResults[0].winnerId, t.state.holeResults.length], ['hole-result', 'p2', 'p2', 1]);
});

test('restart the hole: both back on the tee, the balls and tricks of the hole refunded, the same wind and honour', () => {
  const { match, g } = start({ format: 'bo3', stage: undefined }, { random: rng(0.1, 0) });
  drive(match, g);
  assert.throws(() => match.restartHole(g), (e) => e instanceof MatchError && e.status === 409, 'not on an intro');
  match.arm('p2', 'sticky');            // armed on the intro, before the hole tees off: not the hole's spend
  toPlay(match, g);
  const tee = match.state(), gameTee = gameAt(g);
  assert.equal(tee.canRestartHole, true);
  match.arm('p1', 'rocket');
  hit(match, g, DRIVER);                // p1: the rocket is spent
  match.arm('p1', 'gust');              // p1 casts a trick on p2
  hit(match, g, DRIVER_SOFT);           // p2: the sticky ball and the gust are spent
  let s = match.state();
  assert.deepEqual(s.players.map((p) => [p.strokes, p.charges, p.usedPowerups, p.stats.shots]), [[1, 1, ['rocket', 'gust'], 1], [1, 2, ['sticky'], 1]]);
  hit(match, g, I7);
  const ev = match.restartHole(g);
  assert.deepEqual(ev, { event: 'hole-restarted', holeNumber: 1, tiebreak: false });
  s = match.state();
  assert.deepEqual(core(s), core(tee), 'the hole as it teed off');
  assert.deepEqual(s.players.map((p) => [p.strokes, p.lie, p.ball, p.charges, p.usedPowerups, p.armedPowerup, p.cursedWith, p.stats.shots]),
    [[0, 'tee', { x: 0, y: 0 }, 3, [], null, null, 0], [0, 'tee', { x: 0, y: 0 }, 3, [], 'sticky', null, 0]]);
  assert.deepEqual([s.phase, s.currentPlayerId, s.honourId, s.holeNumber, s.stage.id, s.stage.wind, s.undoable], ['play', 'p1', 'p1', 1, 's1', tee.stage.wind, null]);
  assert.deepEqual(gameAt(g), gameTee);
  assert.deepEqual([s.events.at(-1).type, s.events.at(-1).holeNumber, s.events.at(-1).tiebreak], ['hole-restarted', 1, false]);
  assert.match(s.log.at(-1).text, /Hole 1 starts again/);
  assert.throws(() => match.undoLastShot(g), /no shot to take back/i, 'a restart is not a swing');
  // it plays as a fresh hole, and can be restarted again
  hit(match, g, DRIVER);
  match.restartHole(g);
  assert.deepEqual(core(match.state()), core(tee));

  // a decided hole is not restarted (the swing that decided it can be taken back instead)
  playHole(match, g, tieScript());
  assert.equal(match.state().canRestartHole, false);
  assert.throws(() => match.restartHole(g), /No hole is being played/);
  // sudden death: the round that is being played starts again
  s = toPlay(match, g);
  assert.deepEqual([s.phase, s.canRestartHole], ['tiebreak', true]);
  hit(match, g, I8);
  hit(match, g, I8);                    // level: round two, the other player first
  const round2 = match.state();
  assert.deepEqual([round2.tiebreak.round, round2.tiebreak.pending, round2.tiebreak.results.length], [2, ['p2', 'p1'], 2]);
  hit(match, g, I7);
  assert.deepEqual(match.restartHole(g), { event: 'hole-restarted', holeNumber: 1, tiebreak: true });
  s = match.state();
  assert.deepEqual(core(s), core(round2));
  assert.deepEqual([s.tiebreak.round, s.tiebreak.pending, s.tiebreak.results.length, s.currentPlayerId, s.events.at(-1).round], [2, ['p2', 'p1'], 2, 'p2', 2]);
  // a new stage: nothing of the last one can be restarted or taken back
  hit(match, g, I7); hit(match, g, I8);
  assert.equal(match.phase, 'hole-result');
  match.continue();
  assert.deepEqual([match.state().undoable, match.state().canRestartHole], [null, false]);
});

test('a stray ball: under 40 mph from a full-shot lie more than 40 yd out is flagged; putts and chips never', () => {
  assert.deepEqual([STRAY_MAX_MPH, STRAY_MIN_YD], [40, 40]);
  const tee = { lie: 'tee', distYd: 150 };
  assert.equal(isStrayShot({ ...tee, speedMph: 30 }), true, 'the 30 mph mishit off the tee');
  assert.equal(isStrayShot({ ...tee, speedMph: 39.9 }), true);
  assert.equal(isStrayShot({ ...tee, speedMph: 40 }), false, '40 mph is a shot');
  assert.equal(isStrayShot({ ...tee, speedMph: 152 }), false);
  for (const lie of ['fairway', 'rough', 'sand', 'bunker']) assert.equal(isStrayShot({ lie, distYd: 90, speedMph: 25 }), true, lie);
  assert.equal(isStrayShot({ lie: 'fairway', distYd: 40, speedMph: 25 }), false, 'a chip from 40 yd');
  assert.equal(isStrayShot({ lie: 'fairway', distYd: 40.1, speedMph: 25 }), true);
  assert.equal(isStrayShot({ lie: 'rough', distYd: 12, speedMph: 9 }), false, 'a chip');
  assert.equal(isStrayShot({ lie: 'green', distYd: 60, speedMph: 20 }), false, 'never off a green');
  assert.equal(isStrayShot({ lie: 'fairway', distYd: 60, speedMph: 20, isPutt: true }), false, 'never a putt');
  for (const junk of [undefined, {}, { lie: 'tee', distYd: 150 }, { lie: 'tee', speedMph: 30 }, { lie: 'tee', distYd: NaN, speedMph: 30 }]) assert.equal(isStrayShot(junk), false);

  // in a match: the stray swing still counts, is marked, and can be taken back
  const { match, g } = start({ format: 'bo3', stage: undefined });
  toPlay(match, g);
  const before = match.state();
  let t = hit(match, g, L(30, 12, 2000));       // 30 mph off the tee of a 437 yd hole
  assert.equal(t.ev.stray, true);
  assert.deepEqual([t.ev.event, player(t.state, 'p1').strokes, t.state.currentPlayerId], ['shot', 1, 'p2'], 'no response means it counts');
  assert.deepEqual(t.state.undoable, { playerId: 'p1', stray: true, holeNumber: 1 });
  assert.deepEqual((({ type, playerId, speedMph }) => ({ type, playerId, speedMph }))(t.state.events.at(-1)), { type: 'stray-shot', playerId: 'p1', speedMph: 30 });
  assert.deepEqual(match.undoLastShot(g), { event: 'shot-undone', playerId: 'p1', stray: true, from: 'play' });
  assert.deepEqual(core(match.state()), core(before));
  // real shots are not marked: a drive, an approach, a chip from inside 40 yd, a putt
  t = hit(match, g, DRIVER_SOFT);               // p1: 181 yd to go
  assert.equal(t.ev.stray, undefined);
  assert.notEqual(t.state.events.at(-1).type, 'stray-shot');
  hit(match, g, DRIVER);                        // p2: 165 to go, so p1 is away
  t = hit(match, g, L(102, 22, 8200));          // p1: short of the green, a chip left
  const left = player(t.state, 'p1').distToPinYd;
  assert.ok(left > 27.5 && left < 40 && player(t.state, 'p1').lie !== 'green', `p1 has a chip left (${left} yd, ${player(t.state, 'p1').lie})`);
  hit(match, g, I7);                            // p2 on the green
  assert.equal(match.currentPlayerId, 'p1');
  t = hit(match, g, L(30, 30, 4000));           // p1 chips at 30 mph from inside 40 yd
  assert.equal(t.ev.stray, undefined, 'a chip is never a stray ball');
  // a putt on the green, however slow
  const putter = match.currentPlayerId;
  if (player(match.state(), putter).lie === 'green') assert.equal(hit(match, g, PUTT(3)).ev.stray, undefined, 'a putt is never a stray ball');
  // a sudden-death ball from the tee of the arena is a full shot: a stray one is marked there too
  const tb = start({}, { random: rng(0.1, 0) });
  toPlay(tb.match, tb.g);
  playHole(tb.match, tb.g, tieScript());
  toPlay(tb.match, tb.g);
  t = hit(tb.match, tb.g, L(25, 15, 2000));
  assert.deepEqual([t.ev.event, t.ev.stray, t.state.undoable.stray], ['tiebreak-shot', true, true]);
});

// ---------- putting to win, putting to tie: the order on the green and what a swing is for ----------

const { CHIP_MAX_YD, shotStake } = require('../lib/match');
const stakeOf = (state, id) => { const p = player(state, id); return [p.shotFor, p.shotKind]; };

test('what a swing is for: holing it wins, ties, puts the other on a must-make, or none of those', () => {
  const on = (strokes, lie = 'green', distYd = 5) => ({ strokes, lie, distYd });
  const inWith = (strokes) => ({ strokes, holed: true, capped: false });
  const outWith = (strokes) => ({ strokes, holed: false, capped: false });
  // A is in with 3
  assert.equal(shotStake(on(1), inWith(3)).shotFor, 'win', 'B lying 1: holing it makes 2, beats 3');
  assert.equal(shotStake(on(2), inWith(3)).shotFor, 'tie', 'B lying 2: holing it makes 3, ties (the must-make)');
  assert.equal(shotStake(on(3), inWith(3)).shotFor, null, 'B lying 3: nothing to play for (in a match B is already knocked out)');
  assert.equal(shotStake(on(0, 'tee', 150), inWith(3)).shotFor, 'win');
  // both still out
  assert.equal(shotStake(on(2), outWith(2)).shotFor, 'lead', 'lying 2 and 2: a make leaves the other one swing that must drop');
  assert.equal(shotStake(on(2), outWith(3)).shotFor, 'win', 'lying 2 against 3: a make is a knockout on the spot');
  assert.equal(shotStake(on(2), outWith(5)).shotFor, 'win');
  assert.equal(shotStake(on(3), outWith(2)).shotFor, null, 'lying 3 against 2: holing it decides nothing yet');
  assert.equal(shotStake(on(4), outWith(2)).shotFor, null);
  // the stroke cap: the opponent is out of strokes, holing out wins the hole
  assert.equal(shotStake(on(1), { strokes: 7, holed: false, capped: true }).shotFor, 'win');
  assert.equal(shotStake(on(6), { strokes: 7, holed: false, capped: true }).shotFor, 'win', 'the last stroke before the cap');
  // the kind of swing: a putt on the green, a chip from off it inside 40 yd, else a shot
  assert.equal(CHIP_MAX_YD, 40);
  assert.deepEqual([['green', 20], ['green', 0.5], ['fairway', 40], ['fairway', 40.1], ['rough', 4], ['sand', 12], ['tee', 150], ['fairway', 150]].map(([lie, distYd]) => shotStake(on(2, lie, distYd), outWith(3)).shotKind),
    ['putt', 'putt', 'chip', 'shot', 'chip', 'chip', 'shot', 'shot']);
  assert.deepEqual(shotStake(on(2, 'rough', 9), inWith(3)), { shotFor: 'tie', shotKind: 'chip' }, 'chip in to tie');
  assert.deepEqual(shotStake(on(1, 'fairway', 30), inWith(3)), { shotFor: 'win', shotKind: 'chip' }, 'chip in to win');
  assert.deepEqual(shotStake(on(2, 'fairway', 120), inWith(3)), { shotFor: 'tie', shotKind: 'shot' }, 'hole it to tie');
  assert.deepEqual(shotStake(null, null), { shotFor: null, shotKind: 'shot' });
});

test('on the green the player with fewer strokes putts first, and that putt is for the win', () => {
  const { match, g } = start({ format: 'bo3', stage: undefined });
  let s = toPlay(match, g);
  assert.deepEqual(stakeOf(s, 'p1'), ['lead', 'shot'], 'on the tee (an ace would leave the other one swing)');
  assert.deepEqual(stakeOf(s, 'p2'), [null, null], 'only the player who is up has a stake');
  let t = hit(match, g, DRIVER_SOFT);       // p1: 181 yd to go
  assert.deepEqual([t.ev.shotFor, t.ev.shotKind], ['win', 'shot'], 'the shot event says what the next player is up for');
  hit(match, g, DRIVER);                    // p2: 165 to go
  t = hit(match, g, I7);                    // p1 (away): on the green, 65 ft, lying 2
  assert.equal(t.who, 'p1');
  t = hit(match, g, DINK);                  // p2 (away) fluffs it: lying 2, still 163 yd out
  t = hit(match, g, I7);                    // p2 again: on the green in 3
  assert.equal(t.who, 'p2');
  s = t.state;
  const [p1, p2] = [player(s, 'p1'), player(s, 'p2')];
  assert.deepEqual([p1.lie, p1.strokes, p2.lie, p2.strokes], ['green', 2, 'green', 3]);
  assert.ok(p1.distToPinYd > p2.distToPinYd, `p1 is farther from the hole (${p1.distToPinYd} against ${p2.distToPinYd} yd)`);
  assert.equal(s.currentPlayerId, 'p1', 'fewer strokes: p1 putts first');
  assert.deepEqual(stakeOf(s, 'p1'), ['win', 'putt'], 'PUTT IN TO WIN: p2 has already taken the 3 it would make');
  assert.deepEqual((({ type, playerId, mustHole, shotFor, shotKind }) => ({ type, playerId, mustHole, shotFor, shotKind }))(s.events.at(-1)), { type: 'turn', playerId: 'p1', mustHole: false, shotFor: 'win', shotKind: 'putt' });
  // ... the same with the strokes the other way round: farther or not, the one lying fewer goes
  const b = start({ format: 'bo3', stage: undefined });
  toPlay(b.match, b.g);
  hit(b.match, b.g, DRIVER_SOFT);           // p1: 181 to go
  hit(b.match, b.g, DRIVER);                // p2: 165 to go
  hit(b.match, b.g, I7);                    // p1 on the green: 65 ft, lying 2
  hit(b.match, b.g, I7);                    // p2 on the green: 50 ft, lying 2
  s = b.match.state();
  assert.equal(s.currentPlayerId, 'p1', 'level on strokes: farther from the hole first, as anywhere');
  assert.deepEqual(stakeOf(s, 'p1'), ['lead', 'putt']);
  t = hit(b.match, b.g, PUTT(4));           // p1 leaves it well short: lying 3, still the farther ball
  s = t.state;
  assert.ok(player(s, 'p1').distToPinYd > player(s, 'p2').distToPinYd && player(s, 'p1').lie === 'green');
  assert.equal(s.currentPlayerId, 'p2', 'p2 lies 2 against 3: p2 putts first although p1 is away');
  assert.deepEqual(stakeOf(s, 'p2'), ['win', 'putt']);
  // off the green the old rule stands: farther from the hole first, whatever the strokes
  const c = start({ format: 'bo3', stage: undefined });
  toPlay(c.match, c.g);
  hit(c.match, c.g, DRIVER_SOFT);
  hit(c.match, c.g, DRIVER);
  hit(c.match, c.g, DINK);                  // p1 (away): lying 2, 179 yd out
  s = c.match.state();
  assert.equal(s.currentPlayerId, 'p1', 'lying 2 against 1, but farther and not on the green: still p1');
  assert.deepEqual(stakeOf(s, 'p1'), [null, 'shot']);

  // the putt for the win drops: a knockout, marked on the event and on the shot
  t = hit(match, g, PUTT(11));
  assert.deepEqual([t.ev.event, t.ev.reason, t.ev.winnerId, t.ev.clutch], ['hole-won', 'knockout', 'p1', 'win']);
  assert.deepEqual([t.state.events.at(-1).type, t.state.events.at(-1).clutch], ['hole-won', 'win']);
  assert.deepEqual([stakeOf(t.state, 'p1'), stakeOf(t.state, 'p2')], [[null, null], [null, null]], 'a decided hole: nobody is up for anything');
});

test('a putt to tie: the must-make swing is shotFor "tie", and a make is marked TIED IT UP', () => {
  const { match, g } = start({ format: 'bo3', stage: undefined });
  toPlay(match, g);
  const script = tieScript();               // both make 3; p2 (the soft drive) is away all the way
  for (let n = 0; n < 5; n++) hit(match, g, script[match.currentPlayerId].shift());
  let s = match.state();
  assert.deepEqual([player(s, 'p2').holed, player(s, 'p2').strokes, s.currentPlayerId, player(s, 'p1').strokes, player(s, 'p1').mustHole], [true, 3, 'p1', 2, true]);
  assert.deepEqual(stakeOf(s, 'p1'), ['tie', 'putt'], 'PUTT IN TO TIE');
  const turnEv = s.events.filter((e) => e.type === 'turn').at(-1);
  assert.deepEqual([turnEv.playerId, turnEv.mustHole, turnEv.shotFor, turnEv.shotKind], ['p1', true, 'tie', 'putt']);
  const t = hit(match, g, script.p1.shift());
  assert.deepEqual([t.ev.event, t.ev.reason, t.ev.clutch], ['hole-tied', 'tied', 'tie']);
  const tied = t.state.events.find((e) => e.type === 'hole-tied');
  assert.deepEqual([tied.playerId, tied.clutch], ['p1', 'tie']);
  assert.match(t.state.log.at(-1).text, /^Alex Sheppard TIED IT UP! Hole tied \(both make a birdie\): SUDDEN DEATH/);
  // sudden death: a ball is for nothing but its distance
  s = toPlay(match, g);
  assert.equal(s.phase, 'tiebreak');
  assert.deepEqual([stakeOf(s, 'p1'), stakeOf(s, 'p2')], [[null, null], [null, null]]);
  assert.deepEqual([s.events.filter((e) => e.type === 'turn').at(-1).shotFor, s.events.filter((e) => e.type === 'turn').at(-1).shotKind], [null, null]);

  // the putt to tie that misses: a knockout, and nothing is marked
  const k = start({ format: 'bo3', stage: undefined });
  toPlay(k.match, k.g);
  const win = winScript('p1');
  for (let n = 0; n < 5; n++) hit(k.match, k.g, win[k.match.currentPlayerId].shift());
  assert.deepEqual(stakeOf(k.match.state(), 'p2'), ['tie', 'putt']);
  const miss = hit(k.match, k.g, win.p2.shift());
  assert.deepEqual([miss.ev.event, miss.ev.reason, miss.ev.clutch], ['hole-won', 'knockout', null], 'p1 won it, but not with this swing');
});

test('the stake with one player in or out of strokes, and from off the green', () => {
  // p1 never gets off the tee and runs out of strokes: everything p2 hits is to win
  const { match, g } = start({ format: 'bo3', stage: undefined });
  toPlay(match, g);
  hit(match, g, DINK);
  hit(match, g, DRIVER_SOFT);               // p2: lying 1, 181 to go
  let t;
  for (let i = 2; i <= 7; i++) t = hit(match, g, DINK);
  assert.equal(player(t.state, 'p1').capped, true);
  assert.deepEqual([t.state.currentPlayerId, stakeOf(t.state, 'p2')], ['p2', ['win', 'shot']], 'HOLE IT TO WIN, from 181 yd');
  t = hit(match, g, I7);
  assert.deepEqual([t.state.currentPlayerId, stakeOf(t.state, 'p2')], ['p2', ['win', 'putt']]);
  t = hit(match, g, PUTT(11));              // the 65-footer drops
  assert.deepEqual([t.ev.event, t.ev.reason, t.ev.clutch], ['hole-won', 'cap', 'win']);

  // a chip: off the green inside 40 yd
  const c = start({ format: 'bo3', stage: undefined });
  toPlay(c.match, c.g);
  hit(c.match, c.g, DRIVER_SOFT);           // p1: 181 to go
  hit(c.match, c.g, DRIVER);                // p2: 165 to go
  hit(c.match, c.g, L(102, 22, 8200));      // p1 comes up short of the green
  hit(c.match, c.g, I7);                    // p2 on the green, lying 2
  const s = c.match.state();
  const p1 = player(s, 'p1');
  assert.ok(p1.lie !== 'green' && p1.distToPinYd <= 40 && p1.distToPinYd > 27.4, `p1 has a chip (${p1.distToPinYd} yd, ${p1.lie})`);
  assert.equal(s.currentPlayerId, 'p1', 'not both on the green: the farther ball plays');
  assert.deepEqual(stakeOf(s, 'p1'), ['lead', 'chip']);
  // p2 holes out for 3 from the green before p1 gets there: p1's chip is to tie
  const d = start({ format: 'bo3', stage: undefined });
  toPlay(d.match, d.g);
  hit(d.match, d.g, DRIVER);                // p1: 165 to go
  hit(d.match, d.g, DRIVER_SOFT);           // p2: 181 to go
  hit(d.match, d.g, I7);                    // p2 (away): on the green, 65 ft
  hit(d.match, d.g, L(98, 23, 8400));       // p1: short of the green
  let ds = d.match.state();
  assert.ok(player(ds, 'p1').lie !== 'green' && player(ds, 'p1').distToPinYd <= 40, `p1 is off the green inside 40 yd (${player(ds, 'p1').distToPinYd} yd)`);
  assert.equal(ds.currentPlayerId, 'p1', 'p1 is the farther ball');
  hit(d.match, d.g, L(12, 30, 3000));       // a chip that goes a few yards: lying 3?
  ds = d.match.state();
  if (ds.currentPlayerId === 'p2') {
    // p2 now lies 2 against 3 and, whoever is farther, holing the 65-footer is a knockout
    assert.deepEqual(stakeOf(ds, 'p2')[0], 'win');
  }
});
