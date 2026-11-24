'use strict';
// v3:modes The highlights reel (lib/highlights.js): which shots are notable, how they are
// ranked, the last game's list, the night's best and its six-hour rule, what is kept on
// disk, and the shot of the match.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createHighlights, notable, recordOf, summaryOf, thinPath, unpackPath,
  NIGHT_GAP_MS, LAST_MAX, NIGHT_MAX, PATH_MAX, LONG_PUTT_FT, DECIDER_PUTT_FT,
} = require('../lib/highlights');

// a path of n samples: a flight to `ft`, then a roll
function path(n = 60, { ft = 3, end = 5, len = 140 } = {}) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (end * i) / (n - 1), u = Math.min(1, t / ft);
    pts.push({ t, x: 0.01 * i, y: len * (t / end), z: t < ft ? 25 * 4 * u * (1 - u) : 0 });
  }
  return pts;
}
function shot({ holed = false, drops = holed, isPutt = false, strokes = 2, points = 0, tone = null, text = null, match = null, n = 60, distToPinYd = 4 } = {}) {
  const pts = path(n);
  return {
    shotId: Math.floor(Math.random() * 1e9), holed, strokes, lie: holed ? 'green' : 'fairway', distToPinYd: holed ? 0 : distToPinYd,
    launch: { speedMph: 110, vla: 18, hla: 0, totalSpin: 6000, spinAxis: 0 }, clubKey: '7i',
    sim: { points: pts, flightTime: isPutt ? 0 : 3, isPutt, carryYd: 150, totalYd: 153, apexFt: 80, events: drops ? [{ type: 'bounce', t: 3 }, { type: 'holed', t: 5 }] : [{ type: 'bounce', t: 3 }] },
    ...(points || tone ? { arcade: { grade: 'GREAT', points, callout: tone ? { id: 'c', text: text || 'Dialled in!', tone } : null } } : {}),
    ...(match ? { match } : {}),
  };
}
const before = (distToPinYd = 150, extra = {}) => ({ courseName: 'Lagoon Island', hole: 1, holeRef: 1, par: 3, pin: [0, 140], tee: [0, 0], ball: { x: 0, y: 0 }, aimDeg: 0, lie: 'tee', distToPinYd, ...extra });

test('notable: a ball that drops from off the green, a long putt, an epic callout; nothing else by itself', () => {
  assert.deepEqual(notable(shot({ holed: true, strokes: 1 }), { before: before(150) }).why, ['ace']);
  assert.equal(notable(shot({ holed: true, strokes: 1 }), { before: before(150) }).title, 'HOLE IN ONE');
  const out = notable(shot({ holed: true, strokes: 2 }), { before: before(95) });
  assert.deepEqual(out.why, ['hole-out']);
  assert.equal(out.title, 'HOLED FROM 95 YD');
  assert.equal(notable(shot({ holed: true, strokes: 3 }), { before: before(12) }).title, 'CHIP-IN');
  // putts: long ones only
  const long = notable(shot({ holed: true, isPutt: true }), { before: before(LONG_PUTT_FT / 3) });
  assert.deepEqual(long.why, ['long-putt']);
  assert.equal(long.title, `${LONG_PUTT_FT} FT PUTT`);
  assert.equal(notable(shot({ holed: true, isPutt: true }), { before: before((LONG_PUTT_FT - 1) / 3) }), null);
  // a conceded tap-in: holed in the book, but the ball never dropped
  assert.equal(notable(shot({ holed: true, drops: false }), { before: before(60) }), null);
  // an ordinary good shot is not a highlight; an epic one is, whatever it did
  assert.equal(notable(shot({ points: 400, tone: 'good' }), { before: before(150) }), null);
  const epic = notable(shot({ points: 400, tone: 'epic', text: 'Pin seeker!' }), { before: before(150) });
  assert.deepEqual(epic.why, ['epic']);
  assert.equal(epic.title, 'PIN SEEKER!');
  // ... but not a streak's own shout: it says nothing about this ball
  const streak = shot({ points: 300, tone: 'epic', text: "YOU'RE ON FIRE!" });
  streak.arcade.callout.id = 'on-fire';
  assert.equal(notable(streak, { before: before(150) }), null);
  // ranked: an ace over a hole-out over a long putt over a plain epic
  const sc = (s, d) => notable(s, { before: before(d) }).score;
  assert.ok(sc(shot({ holed: true, strokes: 1 }), 150) > sc(shot({ holed: true, strokes: 2 }), 150));
  assert.ok(sc(shot({ holed: true, strokes: 2 }), 60) > sc(shot({ holed: true, isPutt: true }), 20));
  assert.ok(sc(shot({ holed: true, isPutt: true }), 20) > sc(shot({ tone: 'epic' }), 150));
  // and nothing without a path
  assert.equal(notable({ holed: true, sim: { points: [] } }, { before: before() }), null);
  assert.equal(notable(null), null);
});

test('notable: the shot that decides a hole or a match, in the shooter\'s favour', () => {
  const m = (event, extra = {}) => ({ playerId: 'a', event, winnerId: 'a', reason: 'score', ...extra });
  // the match winner, even a short putt
  assert.deepEqual(notable(shot({ holed: true, isPutt: true, match: m('match-over') }), { before: before(1) }).why, ['match-winner']);
  // a hole won: a putt from 8 ft or more, or any shot that is not a putt
  assert.deepEqual(notable(shot({ holed: true, isPutt: true, match: m('hole-won') }), { before: before(DECIDER_PUTT_FT / 3) }).why, ['hole-winner']);
  assert.equal(notable(shot({ holed: true, isPutt: true, match: m('hole-won') }), { before: before(1) }), null, 'a three-footer to win a hole is not replayed');
  assert.deepEqual(notable(shot({ holed: true, strokes: 2, match: m('hole-won') }), { before: before(20) }).why, ['hole-out', 'hole-winner']);
  // clutch: FOR THE WIN / TO TIE that dropped, whatever its length
  assert.deepEqual(notable(shot({ holed: true, isPutt: true, match: m('hole-won', { clutch: 'win' }) }), { before: before(1) }).why, ['clutch']);
  assert.deepEqual(notable(shot({ holed: true, isPutt: true, match: m('hole-tied', { winnerId: null, clutch: 'tie' }) }), { before: before(1) }).why, ['clutch']);
  // sudden death: the ball that won it
  assert.deepEqual(notable(shot({ match: m('hole-won', { reason: 'tiebreak' }) }), { before: before(140) }).why, ['sudden-death']);
  // the shooter lost by it (a knockout by their miss, a hazard): no
  assert.equal(notable(shot({ match: m('hole-won', { winnerId: 'b', reason: 'knockout' }) }), { before: before(30) }), null);
  assert.equal(notable(shot({ match: m('match-over', { winnerId: 'b' }) }), { before: before(30) }), null);
  // a concession and a drop are not shots; a plain turn decides nothing
  assert.equal(notable(shot({ match: m('match-over', { reason: 'concede' }) }), { before: before(30) }), null);
  assert.equal(notable(shot({ match: m('hole-won', { drop: true }) }), { before: before(30) }), null);
  assert.equal(notable(shot({ match: m('shot') }), { before: before(30) }), null);
  // it does not need two players: the winner is whoever the event names
  assert.deepEqual(notable(shot({ holed: true, isPutt: true, match: { playerId: 'p3', event: 'hole-won', winnerId: 'p3', reason: 'score' } }), { before: before(4) }).why, ['hole-winner']);
});

test('thinPath: small enough to keep, both ends and every event kept', () => {
  const pts = path(5000, { ft: 6, end: 12 });
  const thin = thinPath(pts, { flightTime: 6, events: [{ type: 'bounce', t: 6 }, { type: 'tree', t: 2.5 }] });
  assert.ok(thin.length <= PATH_MAX + 24 && thin.length > PATH_MAX / 2, String(thin.length));
  assert.deepEqual(thin[0], [0, 0, 0, 0]);
  assert.equal(thin[thin.length - 1][0], 12);
  for (const t of [6, 2.5]) assert.ok(thin.some((p) => Math.abs(p[0] - t) < 0.006), `the sample at ${t} s`);
  for (let i = 1; i < thin.length; i++) assert.ok(thin[i][0] > thin[i - 1][0], 'in order');
  // a short path is kept whole, rounded to the centimetre and the millisecond
  const small = thinPath([{ t: 0, x: 0.123456, y: 1, z: 0 }, { t: 0.123456, x: 2, y: 3, z: 4.5678 }]);
  assert.deepEqual(small, [[0, 0.12, 1, 0], [0.123, 2, 3, 4.57]]);
  assert.deepEqual(unpackPath(small)[1], { t: 0.123, x: 2, y: 3, z: 4.57 });
  assert.deepEqual(thinPath(null), []);
});

test('recordOf: everything a later replay needs, and a summary without the path', () => {
  const s = shot({ holed: true, strokes: 2, points: 900, tone: 'epic', text: 'Holed it!', n: 3000 });
  const about = { before: before(95), match: { id: 'm_1', holeNumber: 2, formatLabel: 'Best of 3' } };
  const note = notable(s, about);
  const rec = recordOf(s, about, { note, stage: { id: 'lagoon-island', name: 'Lagoon Island', file: 'osm-node-1.json' }, game: { id: 'm_1', kind: 'match', label: 'Best of 3' }, player: { id: 'a', name: 'Alex', slot: 1 }, at: 1000 });
  assert.equal(rec.title, 'HOLED FROM 95 YD');
  assert.deepEqual(rec.stage, { id: 'lagoon-island', name: 'Lagoon Island', file: 'osm-node-1.json', courseName: 'Lagoon Island' });
  assert.deepEqual(rec.hole, { pin: [0, 140], tee: [0, 0], ref: 1, par: 3 });
  assert.deepEqual(rec.from, { x: 0, y: 0 });
  assert.equal(rec.matchId, 'm_1');
  assert.equal(rec.holeNumber, 2);
  assert.deepEqual(rec.player, { id: 'a', name: 'Alex', slot: 1 });
  assert.equal(rec.points, 900);
  assert.equal(rec.endFt, 0);
  assert.ok(rec.sim.points.length <= PATH_MAX + 24);
  assert.equal(rec.sim.flightTime, 3);
  assert.ok(rec.sim.events.some((e) => e.type === 'holed'));
  assert.ok(JSON.stringify(rec).length < 40000, 'small enough to keep eight of on disk');
  const sum = summaryOf({ ...rec, id: 'h1' });
  assert.equal(sum.sim, undefined);
  assert.equal(JSON.stringify(sum).includes('"points":['), false);
  assert.deepEqual(sum.player, { id: 'a', name: 'Alex', slot: 1 });
  assert.equal(sum.replayable, true);
});

function reelWith(opts = {}) {
  let t = opts.start ?? 1_000_000;
  const disk = { saved: opts.disk ?? null, writes: 0 };
  const reel = createHighlights({ now: () => t, read: () => disk.saved, write: (o) => { disk.saved = JSON.parse(JSON.stringify(o)); disk.writes++; }, ...opts.limits });
  let n = 0;
  const add = (score, { game = { id: 'm1', kind: 'match', label: 'Best of 3' }, matchId = game.kind === 'match' ? game.id : null } = {}) => {
    const s = shot({ holed: true, strokes: 2 });
    s.shotId = ++n;
    const about = { before: before(100), match: matchId ? { id: matchId, holeNumber: 1 } : null };
    return reel.add({ ...recordOf(s, about, { note: { why: ['hole-out'], score, title: `S${score}` }, stage: { id: 'st', name: 'Stage', file: 'f.json' }, game, player: { id: 'a', name: 'Alex', slot: 1 }, at: t }) });
  };
  return { reel, disk, add, tick: (ms) => { t += ms; }, at: () => t };
}

test('the last game: its notable shots in order, the newest kept, a new game starts the list over', () => {
  const { reel, add, tick } = reelWith();
  const a = add(100); tick(1000);
  const b = add(300); tick(1000);
  assert.notEqual(a.id, b.id);
  let st = reel.state();
  assert.deepEqual(st.last.game, { id: 'm1', kind: 'match', label: 'Best of 3' });
  assert.deepEqual(st.last.shots.map((h) => h.id), [b.id, a.id], 'newest first');
  for (let i = 0; i < LAST_MAX + 3; i++) { add(10 + i); tick(10); }
  st = reel.state();
  assert.equal(st.last.shots.length, LAST_MAX);
  assert.equal(st.last.shots.some((h) => h.id === a.id), false, 'the oldest fell off');
  // another game: the list starts over with its first notable shot
  const c = add(50, { game: { id: 'run9', kind: 'solo', label: 'SOLO TOUR' } });
  st = reel.state();
  assert.deepEqual(st.last.game, { id: 'run9', kind: 'solo', label: 'SOLO TOUR' });
  assert.deepEqual(st.last.shots.map((h) => h.id), [c.id]);
  // the whole record is there by id (path and all); the state carries no path
  assert.ok(reel.get(c.id).sim.points.length >= 2);
  assert.equal(reel.get('nope'), null);
  assert.equal(JSON.stringify(st).includes('"sim"'), false);
  assert.ok(st.seq > 0);
});

test('the night: the best few by score, kept on disk, read back, and started over after a six-hour break', () => {
  const r = reelWith();
  const ids = [];
  for (const sc of [500, 100, 900, 300, 700, 200, 800, 400, 600, 50]) { ids.push([sc, r.add(sc).id]); r.tick(60_000); }
  let st = r.reel.state();
  assert.equal(st.night.shots.length, NIGHT_MAX);
  assert.deepEqual(st.night.shots.map((h) => h.score), [900, 800, 700, 600, 500, 400, 300, 200], 'best first; the two weakest are gone');
  assert.equal(st.night.current, true);
  assert.equal(st.night.startedAt, 1_000_000);
  // on disk: the night only, with its paths
  assert.equal(r.disk.saved.version, 1);
  assert.equal(r.disk.saved.night.shots.length, NIGHT_MAX);
  assert.ok(r.disk.saved.night.shots[0].sim.points.length >= 2);
  assert.equal(r.disk.saved.last, undefined);
  const writes = r.disk.writes;
  r.add(10);   // too weak for the night: nothing is written
  assert.equal(r.disk.writes, writes);

  // the game is restarted the next morning: last night's best is still there to watch, marked as not tonight's
  const next = reelWith({ disk: r.disk.saved, start: r.at() + NIGHT_GAP_MS + 1 });
  st = next.reel.state();
  assert.equal(st.night.shots.length, NIGHT_MAX);
  assert.equal(st.night.current, false);
  assert.deepEqual(st.last.shots, [], 'the last game was in memory only');
  assert.ok(next.reel.get(st.night.shots[0].id).sim.points.length >= 2, 'a stored one can still be replayed');
  // ... until the first shot of the new night: any shot, notable or not
  assert.equal(next.reel.touch(), true);
  st = next.reel.state();
  assert.deepEqual(st.night.shots, []);
  assert.equal(st.night.current, true);
  assert.deepEqual(next.disk.saved.night.shots, []);
  // inside a night a break shorter than six hours changes nothing
  const a = next.add(100);
  next.tick(NIGHT_GAP_MS - 1000);
  assert.equal(next.reel.touch(), false);
  next.tick(NIGHT_GAP_MS - 1000);
  const b = next.add(200);
  assert.deepEqual(next.reel.state().night.shots.map((h) => h.id), [b.id, a.id]);

  // a broken or foreign file is an empty reel, not a crash
  for (const bad of [{ version: 99, night: { shots: [{}] } }, 'junk', { version: 1, night: { shots: [{ id: 'x' }] } }]) {
    assert.deepEqual(reelWith({ disk: bad }).reel.state().night.shots, []);
  }
  assert.doesNotThrow(() => createHighlights({ read: () => { throw new Error('disk'); }, write: () => { throw new Error('disk'); } }).add({ ...recordOf(shot({ holed: true }), { before: before(50) }, { note: { why: ['hole-out'], score: 1, title: 'x' } }) }));
});

test('the shot of the match: each player\'s best-paid shot is kept, the award names one, an undo takes it back', () => {
  const { reel } = reelWith();
  const rec = (points, playerId, { noteScore = null } = {}) => {
    const s = shot({ points, tone: 'good' });
    const about = { before: before(150), match: { id: 'mX', holeNumber: points > 300 ? 2 : 1 } };
    return recordOf(s, about, { note: noteScore ? { why: ['epic'], score: noteScore, title: 'EPIC' } : null, stage: { id: 'st', name: 'Stage', file: 'f.json' }, game: { id: 'mX', kind: 'match' }, player: { id: playerId, name: playerId.toUpperCase(), slot: 1 } });
  };
  assert.equal(reel.offerBest('mX', 'a', rec(0, 'a')), null, 'a shot worth nothing is nobody\'s best');
  const a1 = reel.offerBest('mX', 'a', rec(200, 'a'));
  assert.ok(a1 && a1.id);
  assert.equal(reel.offerBest('mX', 'a', rec(200, 'a')), null, 'level with the best: the first one stands (the engine\'s rule)');
  const a2 = reel.offerBest('mX', 'a', rec(450, 'a'));
  const b1 = reel.offerBest('mX', 'b', rec(300, 'b'));
  assert.ok(a2 && b1);
  assert.equal(reel.get(a1.id), null, 'beaten: forgotten');
  assert.ok(reel.get(a2.id), 'a best shot can be played before the award is given');
  // not notable by themselves: the lists are empty
  assert.deepEqual(reel.state().last.shots, []);
  assert.equal(reel.state().shotOfMatch, null);
  // the award: the wrong points (another shot) is refused; the right one is named, and listed
  assert.equal(reel.awardShotOfMatch('mX', { playerId: 'a', points: 999, holeNumber: 2 }), null);
  assert.equal(reel.awardShotOfMatch('other', { playerId: 'a', points: 450 }), null);
  const won = reel.awardShotOfMatch('mX', { playerId: 'a', points: 450, holeNumber: 2 });
  assert.deepEqual(won, { matchId: 'mX', id: a2.id });
  let st = reel.state();
  assert.deepEqual(st.shotOfMatch, { matchId: 'mX', id: a2.id });
  assert.equal(st.last.shots.length, 1);
  assert.equal(st.last.shots[0].shotOfMatch, true);
  assert.deepEqual(st.last.shots[0].why, ['shot-of-the-match']);
  assert.deepEqual(reel.awardShotOfMatch('mX', { playerId: 'a', points: 450 }), won, 'given once');
  // the deciding swing is taken back: no award, and the shot that was only listed for it is off the list
  assert.equal(reel.unaward('mX'), true);
  st = reel.state();
  assert.equal(st.shotOfMatch, null);
  assert.deepEqual(st.last.shots, []);
  assert.equal(reel.unaward('mX'), false);

  // when the best-paid shot WAS notable, it is the same entry (one id), only marked
  const r2 = reelWith().reel;
  const kept = r2.add(rec(700, 'a', { noteScore: 1500 }));
  r2.offerBest('mY', 'a', kept);
  assert.deepEqual(r2.awardShotOfMatch('mY', { playerId: 'a', points: 700 }), { matchId: 'mY', id: kept.id });
  st = r2.state();
  assert.equal(st.last.shots.length, 1);
  assert.equal(st.last.shots[0].shotOfMatch, true);
  assert.deepEqual(st.last.shots[0].why, ['epic']);
  // a new match forgets the last one's candidates
  r2.offerBest('mZ', 'b', rec(100, 'b'));
  assert.equal(r2.awardShotOfMatch('mY', { playerId: 'a', points: 700 }).id, kept.id, 'already given: still there');
});

test('remove and clear', () => {
  const { reel, add, disk } = reelWith();
  const a = add(100), b = add(200);
  assert.equal(reel.remove(a.id), true);
  assert.equal(reel.remove(a.id), false);
  assert.deepEqual(reel.state().last.shots.map((h) => h.id), [b.id]);
  assert.deepEqual(disk.saved.night.shots.map((h) => h.id), [b.id]);
  reel.clear('last');
  assert.deepEqual(reel.state().last.shots, []);
  assert.equal(reel.state().night.shots.length, 1);
  reel.clear('night');
  assert.deepEqual(reel.state().night.shots, []);
  assert.deepEqual(disk.saved.night.shots, []);
});
