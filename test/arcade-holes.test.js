'use strict';
// Hand-designed arcade holes (tools/arcade-holes): the authoring helpers, the catalogue
// (every hole file with a `stage` is its own single-hole course: the Clash Tour and the
// tiebreak arenas), the tour manifest, the three original holes and the three-hole course,
// and holes-c's three stages (Pharaoh's Gate, Midnight Mile, Thunder Dome). Built in
// memory and played through the real Game, the real surface lookup and terrain sampler,
// and the server's activation path (offline: nothing here touches the network or the
// repo's data dir). The other stages have their own files (arcade-holes-a / -b); here
// they are only checked generically, whichever of them exist.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { Game, CLUB_FULL } = require('../lib/game');
const { simulateShot, YD } = require('../lib/physics');
const courseLib = require('../lib/course');
const { courseCacheStem, normalizeCourseSource } = require('../lib/course-identity');
const { courseFingerprintFor } = require('../lib/course-fingerprint');
const { missingSceneryLayers } = require('../lib/course-enrichment');
const { prepareCourseCandidate } = require('../lib/resolved-course-package');
const L = require('../tools/arcade-holes/lib');
const { teeCameraClearance } = require('./helpers/arcade-holes');
const CAT = require('../tools/arcade-holes/courses');
const { COURSES, STAGES, buildCourse } = CAT;

// Every course that builds and validates ({ id, spec, course, expect, report }); a hole
// that does not is in FAILED_BUILDS and fails the catalogue test by name, not this file.
const { built: BUILT_LIST, failed: FAILED_BUILDS } = CAT.buildCatalogue();
const BUILT = Object.fromEntries(BUILT_LIST.map((b) => [b.id, b]));
const SINGLES = ['lagoon-island', 'canyon-run', 'lighthouse-point'];
const MINE = ['pharaohs-gate', 'midnight-mile', 'thunder-dome'];
const BUILD = path.join(__dirname, '..', 'tools', 'arcade-holes', 'build.mjs');
const LIES = ['tee', 'fairway', 'green', 'rough', 'bunker'];   // where a ball may come to rest

const newGame = (id) => { const g = new Game(); g.setCourse(structuredClone(BUILT[id].course)); return g; };
const stock = (k, extra = {}) => ({ Speed: CLUB_FULL[k].speedMph, VLA: CLUB_FULL[k].vla, HLA: 0, TotalSpin: CLUB_FULL[k].spin, SpinAxis: 0, ...extra });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// What a shot result must always be, whatever happened to the ball.
function assertSoundShot(g, r, label) {
  assert.ok(r, `${label}: the shot was played`);
  assert.ok(LIES.includes(r.lie), `${label}: the ball lies on '${r.lie}'`);
  assert.equal(g.surfaceAt(r.end.x, r.end.y), r.holed ? 'green' : r.lie, `${label}: the lie is the surface under the ball`);
  for (const v of [r.end.x, r.end.y, r.sim.carryYd, r.sim.totalYd, r.distToPinYd, g.terrain.h(r.end.x, r.end.y)]) {
    assert.ok(Number.isFinite(v), `${label}: finite numbers`);
  }
  assert.ok(r.penalty === 0 || r.penalty === 1, `${label}: penalty`);
  if (r.penalty) assert.match(r.note, /Water|Out of bounds/, `${label}: the penalty is explained`);
}

// A caddie: from where the ball lies, the swing (club, power, aim) whose predicted finish
// is nearest the pin without a penalty. Uses the same physics call the game makes.
function caddie(g) {
  const h = g.hole, from = { ...g.ball };
  const predict = (launch, aimOffset) => simulateShot(
    { speedMph: launch.Speed, vla: launch.VLA, hla: 0, totalSpin: launch.TotalSpin, spinAxis: 0 },
    from, g.aimDeg - g.aimOffset + aimOffset, g.surfaceAt,
    { terrain: g.terrain, pin: { x: h.pin[0], y: h.pin[1] }, trees: g.treeObstacles },
  );
  const options = [];
  if (g.lie === 'green') {
    for (let mph = 1; mph <= 16; mph += 0.25) options.push({ launch: { Speed: mph, VLA: 0.5, HLA: 0, TotalSpin: 100, SpinAxis: 0 }, aimOffset: 0 });
  } else {
    for (const k of Object.keys(CLUB_FULL)) {
      if (k === 'PT') continue;
      for (const power of k === 'SW' || k === 'LW' || k === 'PW' ? [0.45, 0.6, 0.75, 0.9, 1] : [1]) {
        for (let aimOffset = -40; aimOffset <= 40; aimOffset += 5) {
          options.push({ launch: { ...stock(k), Speed: CLUB_FULL[k].speedMph * power }, aimOffset });
        }
      }
    }
  }
  let best = null;
  for (const o of options) {
    const sim = predict(o.launch, o.aimOffset);
    if (sim.endSurface === 'water' || sim.endSurface === 'ob' || sim.events.some((e) => e.type === 'water')) continue;
    const left = sim.holed ? 0 : Math.hypot(h.pin[0] - sim.end.x, h.pin[1] - sim.end.y);
    if (!best || left < best.left) best = { ...o, left };
  }
  return best;
}

// Play the hole the game is on with the caddie. -> strokes taken
function playHole(g, label, maxStrokes = 12) {
  const index = g.holeIndex;
  while (!g.holed) {
    assert.ok(g.strokes < maxStrokes, `${label}: holed within ${maxStrokes} strokes (at ${g.strokes}, ${g.distToPinYd.toFixed(0)} yd out on ${g.lie})`);
    const pick = caddie(g);
    assert.ok(pick, `${label}: there is a dry shot from (${g.ball.x.toFixed(0)}, ${g.ball.y.toFixed(0)}) on ${g.lie}`);
    g.setAimOffset(pick.aimOffset);
    const r = g.handleShot(pick.launch);
    assertSoundShot(g, r, label);
    assert.equal(r.penalty, 0, `${label}: the caddie's shot stays dry`);
  }
  assert.equal(g.scores[index], g.strokes);
  return g.strokes;
}

// The point m metres along a hole's routing line, and the aim offset that points the
// game at it from the tee (aim 0 is straight at the pin).
function routePoint(hole, m) {
  for (let i = 1; i < hole.line.length; i++) {
    const seg = dist(hole.line[i - 1], hole.line[i]);
    if (m <= seg) return [L.lerp(hole.line[i - 1][0], hole.line[i][0], m / seg), L.lerp(hole.line[i - 1][1], hole.line[i][1], m / seg)];
    m -= seg;
  }
  return hole.pin;
}
function aimAlongRoute(g, m) {
  const p = routePoint(g.hole, m);
  g.setAimOffset(Math.atan2(p[0] - g.ball.x, p[1] - g.ball.y) * 180 / Math.PI - (g.aimDeg - g.aimOffset));
}

// The surfaces along the straight line from a hole's tee to its pin, one per metre.
function directLine(g, hole) {
  const n = Math.ceil(dist(hole.tee, hole.pin));
  return Array.from({ length: n + 1 }, (_, i) => g.surfaceAt(L.lerp(hole.tee[0], hole.pin[0], i / n), L.lerp(hole.tee[1], hole.pin[1], i / n)));
}

// ---------------------------------------------------------------- authoring helpers

test('shapes: ellipse, blob, capsule, ring, offset and hull are sound polygons', () => {
  const e = L.ellipse(10, 20, 30, 15, { n: 120 });
  assert.ok(Math.abs(L.polygonArea(e) - Math.PI * 30 * 15) < 5, 'an ellipse has the area of an ellipse');
  assert.ok(L.signedArea(e) > 0, 'counter-clockwise');

  const b = L.blob(0, 0, 20, 12, { wobble: 0.1, seed: 4 });
  assert.deepEqual(b, L.blob(0, 0, 20, 12, { wobble: 0.1, seed: 4 }), 'a seed gives the same blob every time');
  assert.notDeepEqual(b, L.blob(0, 0, 20, 12, { wobble: 0.1, seed: 5 }));
  for (const [x, y] of b) assert.ok(Math.hypot(x / 20, y / 12) > 0.88 && Math.hypot(x / 20, y / 12) < 1.12, 'the wobble stays within its fraction');

  // a fairway 40 m wide that narrows to 20: its width is right all the way along
  const f = L.capsule([[0, 0], [0, 100], [0, 200]], [40, 40, 20]);
  assert.ok(L.signedArea(f) > 0);
  assert.ok(L.pointInPoly(-19, 50, f) && L.pointInPoly(19, 50, f) && !L.pointInPoly(-21, 50, f) && !L.pointInPoly(21, 50, f), '40 m wide half way up the first leg');
  assert.ok(L.pointInPoly(14, 150, f) && !L.pointInPoly(16, 150, f), '30 m wide half way up the second');
  assert.ok(L.pointInPoly(0, -19, f) && !L.pointInPoly(0, -21, f) && L.pointInPoly(0, 209, f) && !L.pointInPoly(0, 211, f), 'rounded ends reach half a width past the line');
  // round a bend the centre line stays inside, and the outline does not fold
  const bend = [[0, 0], [10, 100], [-20, 200], [-90, 250]];
  const curved = L.capsule(bend, 44);
  for (const p of L.spline(bend, 5)) assert.ok(L.signedDistance(p.x, p.y, curved) > 18, 'the middle of a 44 m fairway is 22 m from its edge');
  assert.ok(Math.abs(L.polygonArea(curved) - (L.polylineLength(L.spline(bend, 5).map((p) => [p.x, p.y])) * 44 + Math.PI * 22 * 22)) < 400);

  // a moat round an island: four wedges, no hole needed, the island stays dry
  const moat = L.ring(0, 0, 30, 80, { pieces: 4 });
  assert.equal(moat.length, 4);
  const inMoat = (x, y) => moat.filter((p) => L.pointInPoly(x, y, p)).length;
  assert.equal(inMoat(0, 0), 0);
  assert.equal(inMoat(20, 20), 0, 'inside the inner radius');
  for (const [x, y] of [[50, 3], [-40, 41], [2, -70], [-33, -33]]) assert.equal(inMoat(x, y), 1, `(${x}, ${y}) is in exactly one wedge`);
  assert.equal(inMoat(70, 70), 0, 'outside the outer radius');
  assert.ok(Math.abs(moat.reduce((s, p) => s + L.polygonArea(p), 0) - Math.PI * (80 * 80 - 30 * 30)) < 60);
  // ... with radii read off real outlines
  const island = L.blob(5, 5, 20, 14, { seed: 2 }), lagoon = L.ellipse(0, 10, 90, 70);
  const wedges = L.ring(5, 5, L.radiusOf(island, [5, 5]), L.radiusOf(lagoon, [5, 5]), { pieces: 6, n: 96 });
  assert.equal(wedges.filter((p) => L.pointInPoly(5, 5, p)).length, 0);
  assert.equal(wedges.filter((p) => L.pointInPoly(60, 10, p)).length, 1);

  const grown = L.offsetPolygon(L.rect(0, 0, 100, 50), 10), shrunk = L.offsetPolygon(L.rect(0, 0, 100, 50), -10);
  assert.deepEqual(L.bbox(grown), { minX: -10, minY: -10, maxX: 110, maxY: 60 });
  assert.deepEqual(L.bbox(shrunk), { minX: 10, minY: 10, maxX: 90, maxY: 40 });
  assert.equal(L.convexHull([[0, 0], [10, 0], [5, 2], [10, 10], [0, 10], [4, 4]]).length, 4);
  assert.ok(Math.abs(L.signedDistance(50, 25, L.rect(0, 0, 100, 50)) - 25) < 1e-9);
  assert.ok(Math.abs(L.signedDistance(-7, 25, L.rect(0, 0, 100, 50)) + 7) < 1e-9);
});

test('heightfield: hills, valleys, plateaus and smoothing make the elevation object the game samples', () => {
  const hf = new L.Heightfield({ minX: -100, minY: -100, maxX: 100, maxY: 100, cellM: 2 });
  hf.fill(5).hill({ x: 40, y: 40, rx: 30, h: 8 }).valley({ x: -40, y: -40, rx: 25, ry: 15, h: 6 })
    .ridge({ line: [[-90, 60], [-20, 80]], widthM: 30, h: 4 })
    .plateau({ poly: L.ellipse(0, 0, 18, 18), level: L.plane(7, [0, 0], 0.01, 0), featherM: 8 });
  const el = hf.toElevation({ baseM: 120 });
  assert.equal(el.nx, 101); assert.equal(el.ny, 101);
  assert.equal(el.heights.length, 101 * 101);
  assert.equal(el.baseM, 120);
  assert.ok(el.heights.every((h) => Number.isFinite(h) && Math.round(h * 100) / 100 === h), 'finite, rounded to a centimetre');
  const t = hf.sampler();
  assert.ok(Math.abs(t.h(40, 40) - 13) < 0.01, 'the hill top');
  assert.ok(Math.abs(t.h(-40, -40) + 1) < 0.01, 'the valley floor');
  assert.ok(Math.abs(t.h(90, -90) - 5) < 1e-9, 'untouched ground');
  assert.ok(t.h(-55, 70) > 8, 'the ridge');
  assert.ok(Math.abs(t.h(10, 0) - 7.1) < 0.01, 'the plateau is its tilted plane');
  assert.ok(Math.abs(Math.hypot(t.grad(5, 5).dx, t.grad(5, 5).dy) - 0.01) < 1e-3, 'at a 1 % slope');
  // smoothing leaves kept nodes exactly alone
  const before = t.h(10, 0);
  hf.smooth(6, { keep: (x, y) => Math.hypot(x, y) < 18 });
  assert.equal(hf.sampler().h(10, 0), before);
  assert.ok(hf.sampler().h(40, 40) < 13, 'the hill top is rounded off');

  // noise is repeatable and bounded; bumps are exactly flat outside their radius
  const n = L.fbm({ seed: 7, scaleM: 50 });
  assert.equal(n(12.5, -80), L.fbm({ seed: 7, scaleM: 50 })(12.5, -80));
  for (let i = 0; i < 200; i++) assert.ok(Math.abs(n(i * 13.7, i * -7.1)) <= 1);
  assert.equal(L.bump(30, 0, 0, 0, 30), 0);
  assert.equal(L.bump(0, 0, 0, 0, 30), 1);
  // rounding never makes a negative zero (JSON would read it back as 0: a course unlike its file)
  assert.ok(Object.is(L.round2(-0.001), 0) && Object.is(L.round2(-1e-14), 0) && L.round2(-0.006) === -0.01 && L.round2(1.234) === 1.23);
  assert.ok(Object.is(L.prop('palm', -1e-14, 54 * Math.cos(Math.PI / 2), { heightM: 9, rotDeg: -0 }).x, 0));

  const fairway = L.capsule([[0, 0], [0, 100]], 30);
  const trees = L.scatterTrees(L.rect(-60, -20, 60, 120), { spacing: 10, seed: 3, avoid: [fairway], clearM: 5 });
  assert.ok(trees.length > 40);
  assert.ok(trees.every(([x, y]) => L.signedDistance(x, y, fairway) <= -5), 'trees keep clear of what they are told to');
  assert.deepEqual(trees, L.scatterTrees(L.rect(-60, -20, 60, 120), { spacing: 10, seed: 3, avoid: [fairway], clearM: 5 }));
  assert.equal(L.clusterTrees(0, 0, { count: 6, radius: 12, seed: 1 }).length, 6);
});

test('validateCourse names what is wrong with a course the loader would mishandle', () => {
  const broken = (change) => { const c = structuredClone(BUILT['canyon-run'].course); change(c); return c; };
  const problems = (c) => { try { L.validateCourse(c); return []; } catch (e) { assert.ok(e instanceof L.ArcadeCourseError); return e.problems; } };
  assert.deepEqual(problems(BUILT['canyon-run'].course), []);
  assert.match(problems(broken((c) => { c.version = 3; })).join(), /current cache file/);
  assert.match(problems(broken((c) => { c.source = { kind: 'arcade', id: 'canyon-run' }; })).join(), /source is not a loadable identity/);
  assert.match(problems(broken((c) => { c.holes[0].pin = [0, 60]; c.holes[0].line[c.holes[0].line.length - 1] = [0, 60]; c.holes[0].lengthYd = Math.round(L.polylineLength(c.holes[0].line) / YD); })).join(), /the pin is on 'fairway', not a green/);
  assert.match(problems(broken((c) => { c.holes[0].lengthYd = 999; })).join(), /lengthYd/);
  assert.match(problems(broken((c) => { c.elevation.heights.pop(); })).join(), /elevation is not a complete grid/);
  assert.match(problems(broken((c) => { c.boundary = L.rect(-5, -5, 5, 5); })).join(), /boundary would be ignored/);
  assert.match(problems(broken((c) => { c.props.push({ ...c.props[0] }); })).join(), /used twice/);
  assert.match(problems(broken((c) => { c.props[0].x = c.holes[0].pin[0]; c.props[0].y = c.holes[0].pin[1]; })).join(), /stands on a green/);
  // props: never on a fairway or in sand, never in the line of play; water is allowed
  const at = (kind, x, y, heightM = 10) => (c) => { c.props.push({ id: 'canyon-run/extra', kind, x, y, rotDeg: 0, heightM }); };
  assert.match(problems(broken(at('cactus', -26, 80))).join(), /stands on fairway, not on open ground/);
  assert.match(problems(broken(at('cactus', 22, 128))).join(), /stands on bunker, not on open ground/);
  assert.match(problems(broken(at('pyramid', 30, 99))).join(), /stands in hole 1's line from the tee to the pin/);
  assert.deepEqual(problems(broken(at('shipwreck', 100, 100))), [], 'a prop may stand in water');
  // ... except the kinds whose heightM is not a height: a target-ring lies flat round the
  // pin (heightM: its diameter), a bridge is a deck (heightM: its span), balloons and blimps float
  assert.deepEqual(problems(broken((c) => { c.props.push({ id: 'canyon-run/ring', kind: 'target-ring', x: c.holes[0].pin[0], y: c.holes[0].pin[1], rotDeg: 0, heightM: 12 }); })), []);
  assert.deepEqual(problems(broken(at('bridge', -26, 80, 40))), [], 'a bridge may cross a fairway');
  assert.deepEqual(problems(broken(at('bridge', 30, 99, 40))), [], 'and the line of play');
  assert.match(problems(broken((c) => { c.props.push({ id: 'canyon-run/bridge', kind: 'bridge', x: c.holes[0].pin[0], y: c.holes[0].pin[1], rotDeg: 0, heightM: 40 }); })).join(), /stands on a green/);
  assert.deepEqual(problems(broken(at('blimp', -26, 80, 25))), [], 'a blimp floats over anything');
  assert.deepEqual(problems(broken(at('balloon', 30, 99, 20))), []);
  for (const kind of ['fireworks', 'cloud', 'airship', 'bird-flock']) assert.deepEqual(problems(broken(at(kind, -26, 80, 20))), [], `${kind} floats over anything`);
  // a crowd is four times as wide as it is tall: all of it must stand on dry open ground, off the line
  const crowdAt = (x, y, heightM, rotDeg = 0) => (c) => { c.props.push({ id: 'canyon-run/crowd', kind: 'crowd', x, y, rotDeg, heightM }); };
  assert.deepEqual(problems(broken(crowdAt(0, -30, 3))), [], 'a crowd behind the tee');
  assert.match(problems(broken(crowdAt(-36, 80, 4))).join(), /a crowd 16 m wide\) reaches onto fairway/);
  assert.match(problems(broken(crowdAt(-40, 80, 4, 90))).join(), /^$|stands in/, 'turned end-on to the fairway it is clear of it');
  assert.match(problems(broken(crowdAt(44, 99, 6))).join(), /stands in hole 1's line from the tee to the pin/);
  // a kind the look stream has no model for is a warning, not an error
  assert.match(L.validateCourse(broken(at('spaceship', 0, -30))).warnings.join(), /has kind 'spaceship', which has no model yet/);
  // an explicit `ob` surface is accepted by the loader but does nothing: warned about
  const withOb = broken((c) => { c.surfaces.push({ kind: 'ob', poly: L.rect(-140, 0, -120, 100) }); });
  assert.match(L.validateCourse(withOb).warnings.join(), /out of bounds comes from course.boundary only/);
});

// ---------------------------------------------------------------- the courses

test('the catalogue: every hole file loads, and every course builds and validates', () => {
  assert.deepEqual(CAT.FAILED.map((f) => `${f.id}: ${f.error.message}`), [], 'hole files that did not load');
  assert.deepEqual(FAILED_BUILDS.map((f) => `${f.id}: ${f.error.message}`), [], 'courses that did not build');
  // stages in tour order (the three originals lead it), then Arcade Classics, built from them as before
  assert.deepEqual(COURSES.map((c) => c.id), [...STAGES.map((s) => s.id), 'arcade-classics']);
  assert.deepEqual(STAGES.slice(0, 3).map((s) => s.id), SINGLES);
  for (const id of MINE) assert.ok(BUILT[id], `${id} is in the catalogue`);
  const ids = new Set();
  for (const { id, course, expect, report } of BUILT_LIST) {
    assert.equal(course.version, courseLib.CACHE_VERSION, id);
    assert.ok(courseLib.isCurrentCourseCache(course), id);
    const source = normalizeCourseSource(course.source);
    assert.match(source.courseId, /^osm:node:99000000\d{5}$/, `${id}: a synthetic id far above real OpenStreetMap ids`);
    assert.ok(!ids.has(source.courseId), `${id}: its own identity`);
    ids.add(source.courseId);
    assert.deepEqual(report.warnings, [], id);
    // the sea, where the design has one (and only there), is found by the renderer's own finder
    assert.equal(Boolean(report.stats.sea), expect.sea, `${id}: sea`);
    // plain JSON, the same on every build
    assert.deepEqual(JSON.parse(JSON.stringify(course)), course, `${id}: survives JSON unchanged`);
    for (const s of course.surfaces) assert.ok(L.SURFACE_KINDS.includes(s.kind), `${id}: surface kind ${s.kind}`);
    // nothing for the background scenery enricher to go and fetch
    assert.deepEqual(missingSceneryLayers(course), [], `${id}: no scenery downloads`);
    assert.deepEqual(course.arcade.holes, id === 'arcade-classics' ? SINGLES : [id], `${id}: the hole files it is made of`);
  }
  assert.equal(Boolean(BUILT['lagoon-island'].report.stats.sea), true);
  assert.equal(Boolean(BUILT['canyon-run'].report.stats.sea), false);
  assert.equal(JSON.stringify(buildCourse('lagoon-island').course), JSON.stringify(BUILT['lagoon-island'].course), 'builds are repeatable');
  assert.throws(() => buildCourse('no-such-hole'), /No arcade course 'no-such-hole'/);
});

test('stages: one hole, one world, with the contract\'s metadata in course.arcade', () => {
  assert.ok(STAGES.length >= 6 && STAGES.length <= L.MAX_MATCH_ORDER + L.MAX_TIEBREAK_ORDER, `${STAGES.length} stages`);
  const numbers = new Set(), orders = { match: new Set(), tiebreak: new Set() };
  for (const { id, number, stage } of STAGES) {
    assert.deepEqual(stage, L.normalizeStage(CAT.PIECES[id].stage, id), `${id}: the hole file's stage`);
    assert.equal(number, stage.number);
    assert.ok(!numbers.has(number), `${id}: number ${number} is its own`);
    numbers.add(number);
    assert.ok(L.STAGE_ROLES.includes(stage.role), `${id}: role`);
    assert.ok(!orders[stage.role].has(stage.order), `${id}: ${stage.role} order ${stage.order} is its own`);
    orders[stage.role].add(stage.order);
    assert.ok(Number.isInteger(stage.order) && stage.order >= 1 && stage.order <= (stage.role === 'match' ? L.MAX_MATCH_ORDER : L.MAX_TIEBREAK_ORDER), `${id}: order ${stage.order}`);
    // the contract's numbering: match stages 1..9 (extra stages 10 and up), tiebreak arenas 21..23
    assert.equal(number, stage.role === 'match' ? stage.order : 20 + stage.order, `${id}: number ${number}`);
    assert.ok(L.THEMES.includes(stage.theme), `${id}: theme ${stage.theme}`);
    assert.ok(L.TIMES_OF_DAY.includes(stage.timeOfDay), `${id}: timeOfDay`);
    assert.ok(stage.blurb.length > 10 && stage.blurb.length < 90, `${id}: a blurb of under 90 characters (${stage.blurb.length})`);
    assert.ok([1, 2, 3].includes(stage.difficulty), `${id}: difficulty`);
    assert.ok(stage.conditions === null || L.CONDITIONS.includes(stage.conditions), `${id}: conditions`);
    assert.ok(stage.freeBall === null || L.FREE_BALLS.includes(stage.freeBall), `${id}: freeBall`);
    assert.ok(stage.wind === null || (stage.wind.min >= 0 && stage.wind.min <= stage.wind.max && stage.wind.max <= L.WIND_MAX_MPH), `${id}: wind`);
    if (!BUILT[id]) continue;                       // named by the catalogue test
    const { course, report } = BUILT[id];
    const [hole] = course.holes, [stats] = report.stats.holes;
    assert.equal(course.holes.length, 1, `${id}: one hole`);
    assert.equal(course.name, stage.name);
    assert.equal(hole.name, stage.name, `${id}: the hole carries the stage's name`);
    assert.equal(hole.ref, 1);
    assert.equal(normalizeCourseSource(course.source).courseId, `osm:node:${L.ARCADE_OSM_ID_BASE + number}`);
    assert.equal(CAT.courseFile(number), `osm-node-${L.ARCADE_OSM_ID_BASE + number}.json`);
    assert.deepEqual(course.origin, stage.origin, `${id}: origin`);
    assert.equal(course.elevation.baseM, stage.baseM, `${id}: altitude`);
    const want = {
      id, formatVersion: 2, generator: 'tools/arcade-holes', holes: [id],
      theme: stage.theme, role: stage.role, order: stage.order,
      timeOfDay: stage.timeOfDay, blurb: stage.blurb, difficulty: stage.difficulty,
      ...(stage.conditions ? { conditions: stage.conditions } : {}),
      ...(stage.freeBall ? { freeBall: stage.freeBall } : {}),
      ...(stage.wind ? { wind: stage.wind } : {}),
    };
    assert.deepEqual(course.arcade, want, `${id}: course.arcade`);
    assert.deepEqual(Object.keys(course.arcade), Object.keys(want), `${id}: course.arcade field order`);
    // built for real swings: a big green that is all but flat (tiebreak greens bigger still)
    assert.ok([3, 4, 5].includes(hole.par));
    const [small, big] = [...stats.greenM].sort((p, q) => p - q);
    if (stage.role === 'tiebreak') {
      assert.equal(hole.par, 3, `${id}: a tiebreak arena is a par 3`);
      assert.ok(small >= 34, `${id}: a tiebreak green is 34 m and more across (${stats.greenM.join(' x ')})`);
    } else assert.ok(big >= 28 && small >= 24, `${id}: green ${stats.greenM.join(' x ')} m`);
    assert.ok(stats.greenSlopePct < 3, `${id}: green slope ${stats.greenSlopePct} %`);
    // the ways to play it (contract, "Routes"): carried from the hole file as written; a match
    // stage that documents them has a safe, a risky and a rocket one
    const routes = CAT.PIECES[id].hole.routes;
    assert.deepEqual(hole.routes, routes ? L.normalizeRoutes(routes, id) : undefined, `${id}: hole.routes`);
    if (routes && stage.role === 'match') for (const want of L.ROUTE_IDS) assert.ok(hole.routes.some((r) => r.id === want), `${id}: a ${want} route`);
    // every match stage documents its three routes (the contract: a safe, a risky and a rocket one)
    if (stage.role === 'match') assert.ok(hole.routes && hole.routes.length >= 3, `${id}: a match stage documents its three routes`);
  }
  // tour order: match stages by order, then the arenas by theirs
  const rank = (s) => (s.stage.role === 'match' ? 0 : 100) + s.stage.order;
  assert.deepEqual(STAGES.map((s) => s.id), [...STAGES].sort((p, q) => rank(p) - rank(q)).map((s) => s.id));
  // the three originals keep their identities, places and weather
  assert.deepEqual(SINGLES.map((id) => { const s = STAGES.find((x) => x.id === id); return [s.number, s.stage.theme, s.origin, s.stage.baseM, s.stage.conditions]; }), [
    [1, 'tropical', { lat: 18.5, lon: -140 }, 0, null],
    [2, 'canyon', { lat: 36.2, lon: -140 }, 900, null],
    [3, 'links', { lat: 41.5, lon: -150 }, 0, 'windy'],
  ]);
  assert.equal(BUILT['canyon-run'].course.elevation.baseM, 900);
  assert.equal(BUILT['lighthouse-point'].course.arcade.conditions, 'windy');
  // Arcade Classics is not a stage: format 1, as it always was
  const classics = BUILT['arcade-classics'].course;
  assert.deepEqual(classics.arcade, { id: 'arcade-classics', formatVersion: 1, generator: 'tools/arcade-holes', holes: SINGLES });
  assert.equal(normalizeCourseSource(classics.source).courseId, 'osm:node:9900000000100');
  assert.deepEqual(classics.origin, { lat: 30, lon: -140 });
  assert.equal(classics.elevation.cellM, 3);
  // holes-c's three
  assert.deepEqual(MINE.map((id) => { const s = STAGES.find((x) => x.id === id); return [s.number, s.stage.role, s.stage.order, s.stage.theme, s.stage.timeOfDay]; }), [
    [8, 'match', 8, 'desert', 'golden'],
    [9, 'match', 9, 'neon', 'night'],
    [22, 'tiebreak', 2, 'stadium', 'night'],
  ]);
});

test('normalizeStage says what is wrong with a hole file\'s stage', () => {
  const good = { number: 4, role: 'match', order: 4, name: 'Volcano Drop', theme: 'volcano', origin: { lat: 10, lon: -150 }, blurb: 'One swing from the crater rim.', difficulty: 2 };
  assert.deepEqual(L.normalizeStage(good, 'x'), { ...good, conditions: null, baseM: 0, timeOfDay: 'day', freeBall: null, wind: null });
  assert.deepEqual(L.normalizeStage({ ...good, conditions: 'breezy', baseM: 1200, timeOfDay: 'dusk' }, 'x'), { ...good, conditions: 'breezy', baseM: 1200, timeOfDay: 'dusk', freeBall: null, wind: null });
  // extra stages come after the nine of the tour; a rocket hole names its free ball
  assert.deepEqual(L.normalizeStage({ ...good, number: 12, order: 12, freeBall: 'rocket' }, 'x'), { ...good, number: 12, order: 12, conditions: null, baseM: 0, timeOfDay: 'day', freeBall: 'rocket', wind: null });
  // a hole's own wind range, in mph (contract, "Wind per hole"); the object is copied, extra fields dropped
  const windy = { min: 10, max: 22, gusty: true };
  assert.deepEqual(L.normalizeStage({ ...good, wind: windy }, 'x').wind, { min: 10, max: 22 });
  assert.notEqual(L.normalizeStage({ ...good, wind: windy }, 'x').wind, windy);
  assert.deepEqual(L.normalizeStage({ ...good, wind: { min: 0, max: 0 } }, 'x').wind, { min: 0, max: 0 }, 'dead calm is a range too');
  assert.deepEqual(L.normalizeStage({ ...good, wind: { min: 35, max: 35 } }, 'x').wind, { min: 35, max: 35 });
  assert.equal(L.normalizeStage({ ...good, order: L.MAX_MATCH_ORDER }, 'x').order, 20);
  const wrong = (change, re) => assert.throws(() => L.normalizeStage({ ...good, ...change }, 'my-hole'), (e) => /^my-hole: stage: /.test(e.message) && re.test(e.message), JSON.stringify(change));
  wrong({ number: 0 }, /number must be an integer/);
  wrong({ number: 4.5 }, /number must be an integer/);
  wrong({ role: 'bonus' }, /role must be one of match, tiebreak/);
  wrong({ order: 0 }, /order must be 1\.\.20 for a match stage/);
  wrong({ order: 21 }, /order must be 1\.\.20 for a match stage/);
  wrong({ role: 'tiebreak', order: 4 }, /1\.\.3 for a tiebreak/);
  wrong({ freeBall: 'jetpack' }, /freeBall must be a ball id \(one of rocket, /);
  wrong({ freeBall: 'gust' }, /freeBall must be a ball id/);      // a trick is not a ball
  wrong({ freeBall: 7 }, /freeBall must be a ball id/);
  for (const wind of [{ min: 12, max: 8 }, { min: -1, max: 8 }, { min: 5, max: 36 }, { min: 5 }, { min: '5', max: 9 }, [5, 9], 12, 'windy']) wrong({ wind }, /wind must be { min, max } in mph with 0 <= min <= max <= 35/);
  wrong({ name: ' ' }, /name is missing/);
  wrong({ theme: 'moon' }, /theme must be one of tropical, canyon, links, volcano, alpine, sakura, jungle, desert, neon, stadium/);
  wrong({ origin: { lat: 95, lon: 0 } }, /origin needs a finite/);
  wrong({ conditions: 'stormy' }, /conditions must be one of calm, breezy, windy/);
  wrong({ timeOfDay: 'noon' }, /timeOfDay must be one of day, golden, dusk, night/);
  wrong({ blurb: 'x'.repeat(90) }, /blurb must be a line of under 90 characters/);
  wrong({ difficulty: 4 }, /difficulty must be 1, 2 or 3/);
  wrong({ theme: 'moon', difficulty: 0 }, /theme must be.*; difficulty must be/);
  assert.throws(() => L.normalizeStage(null, 'my-hole'), /my-hole: stage: stage must be an object/);
  assert.equal(L.THEMES.length, 10);
  // the ball ids are the arcade layer's (when it is in this tree)
  let powerups = null;
  try { powerups = require('../lib/arcade').POWERUPS; } catch (_) { /* no arcade layer */ }
  if (Array.isArray(powerups)) assert.deepEqual([...L.FREE_BALLS].sort(), powerups.filter((p) => (p.kind || 'ball') === 'ball').map((p) => p.id).sort(), 'FREE_BALLS is every ball in lib/arcade.js POWERUPS');
});

test('normalizeRoutes says what is wrong with a hole\'s routes', () => {
  const routes = [
    { id: 'safe', name: ' Round the left ', note: 'Wide, no carry. ' },
    { id: 'risky', name: 'Over the sand', note: 'Saves a shot when it comes off.' },
    { id: 'rocket', name: 'The far shelf', note: 'Only a boosted ball reaches it.' },
  ];
  assert.equal(L.normalizeRoutes(undefined, 'x'), null);
  assert.equal(L.normalizeRoutes(null, 'x'), null);
  assert.deepEqual(L.normalizeRoutes(routes, 'x', { needAll: true }), [
    { id: 'safe', name: 'Round the left', note: 'Wide, no carry.' }, routes[1], routes[2],
  ]);
  assert.deepEqual(L.normalizeRoutes(routes.slice(0, 1), 'x').map((r) => r.id), ['safe'], 'a hole may document fewer');
  const wrong = (value, re, options) => assert.throws(() => L.normalizeRoutes(value, 'my-hole', options), (e) => /^my-hole: routes: /.test(e.message) && re.test(e.message), JSON.stringify(value));
  wrong([], /non-empty array/);
  wrong('left', /non-empty array/);
  wrong([{ id: 'hero', name: 'x', note: 'y' }], /route 1: id must be one of safe, risky, rocket/);
  wrong([{ id: 'safe', note: 'y' }, { id: 'risky', name: 'x', note: ' ' }], /route 1: name is missing; route 2: note is missing/);
  wrong([null], /route 1 must be/);
  wrong(routes.slice(0, 2), /there is no 'rocket' route/, { needAll: true });
  assert.deepEqual([...L.ROUTE_IDS], ['safe', 'risky', 'rocket']);

  // carried from the hole file to course.holes[0].routes, and checked when a course is validated
  const piece = { ...CAT.PIECES['canyon-run'], hole: { ...CAT.PIECES['canyon-run'].hole, routes } };
  const stage = L.normalizeStage(piece.stage, piece.id);
  const build = (p, st = stage) => L.assembleCourse({ id: p.id, number: st.number, name: st.name, origin: st.origin, baseM: st.baseM, pieces: [{ piece: p }], stage: st });
  const { course, expect } = build(piece);
  assert.deepEqual(course.holes[0].routes, L.normalizeRoutes(routes));
  assert.deepEqual(Object.keys(course.holes[0]).slice(-2), ['greenNote', 'routes']);
  L.validateCourse(course, { expect });
  assert.throws(() => build({ ...piece, hole: { ...piece.hole, routes: [{ id: 'hero', name: 'x', note: 'y' }] } }), /canyon-run: routes: route 1: id must be one of/);
  const twoRoutes = structuredClone(course);
  twoRoutes.holes[0].routes.pop();
  assert.throws(() => L.validateCourse(twoRoutes, { expect }), /there is no 'rocket' route/, 'a match stage documents all three');
  // a rocket hole: stage.freeBall reaches course.arcade and the tour manifest
  // (whatever wind range the hole file has of its own is left out here: it is tested next)
  const rocketHole = build(piece, L.normalizeStage({ ...piece.stage, number: 11, order: 11, freeBall: 'rocket', wind: undefined }, piece.id));
  assert.equal(rocketHole.course.arcade.freeBall, 'rocket');
  assert.equal(Object.keys(rocketHole.course.arcade).pop(), 'freeBall');
  // ... and so does a hole's own wind range, after it
  const gale = build(piece, L.normalizeStage({ ...piece.stage, number: 12, order: 12, freeBall: 'rocket', wind: { min: 10, max: 22 } }, piece.id));
  assert.deepEqual(gale.course.arcade.wind, { min: 10, max: 22 });
  assert.deepEqual(Object.keys(gale.course.arcade).slice(-2), ['freeBall', 'wind']);
  L.validateCourse(gale.course, { expect: gale.expect });
  const galeEntry = CAT.tourManifest([{ id: piece.id, course: gale.course }]).stages[0];
  assert.deepEqual(galeEntry.wind, { min: 10, max: 22 });
  assert.deepEqual(Object.keys(galeEntry).slice(-2), ['freeBall', 'wind']);
  const calm = build(piece, L.normalizeStage({ ...piece.stage, wind: undefined }, piece.id));
  assert.equal('wind' in calm.course.arcade, false, 'no wind on a stage that asks for none');
  assert.equal('wind' in CAT.tourManifest([{ id: piece.id, course: calm.course }]).stages[0], false);
  const badWind = structuredClone(gale.course);
  badWind.arcade.wind = { min: 30, max: 10 };
  assert.throws(() => L.validateCourse(badWind, { expect: gale.expect }), /arcade.wind must be { min, max }/);
  L.validateCourse(rocketHole.course, { expect: rocketHole.expect });
  const [entry] = CAT.tourManifest([{ id: piece.id, course: rocketHole.course }]).stages;
  assert.deepEqual([entry.order, entry.number, entry.file, entry.freeBall], [11, 11, 'osm-node-9900000000011.json', 'rocket']);
  assert.equal(Object.keys(entry).pop(), 'freeBall');
  assert.equal('freeBall' in CAT.tourManifest([BUILT['canyon-run']]).stages[0], false, 'no freeBall on an ordinary stage');
  const badBall = structuredClone(rocketHole.course);
  badBall.arcade.freeBall = 'jetpack';
  assert.throws(() => L.validateCourse(badBall, { expect: rocketHole.expect }), /arcade.freeBall 'jetpack' is not a ball id/);
});

const STAGE_KEYS = ['id', 'order', 'number', 'file', 'name', 'par', 'lengthYd', 'theme', 'timeOfDay', 'blurb', 'difficulty'];
function assertManifest(manifest, built, label) {
  assert.deepEqual(Object.keys(manifest), ['version', 'stages', 'tiebreaks'], label);
  assert.equal(manifest.version, 1);
  for (const [list, role, keys] of [[manifest.stages, 'match', STAGE_KEYS], [manifest.tiebreaks, 'tiebreak', STAGE_KEYS.slice(0, -1)]]) {
    const want = built.filter((b) => b.course.arcade.role === role);
    assert.deepEqual(list.map((e) => e.id).sort(), want.map((b) => b.id).sort(), `${label}: every ${role} stage that built, and only those`);
    assert.deepEqual(list.map((e) => e.order), [...list.map((e) => e.order)].sort((p, q) => p - q), `${label}: ${role} stages sorted by order`);
    for (const e of list) {
      const { course } = want.find((b) => b.id === e.id);
      assert.deepEqual(Object.keys(e), [...keys, ...(course.arcade.freeBall ? ['freeBall'] : []), ...(course.arcade.wind ? ['wind'] : [])], `${label}: ${e.id} fields`);
      assert.deepEqual(e, {
        id: e.id, order: course.arcade.order, number: course.source.osmId - L.ARCADE_OSM_ID_BASE,
        file: `${courseCacheStem(course.source)}.json`, name: course.name, par: course.holes[0].par, lengthYd: course.holes[0].lengthYd,
        theme: course.arcade.theme, timeOfDay: course.arcade.timeOfDay, blurb: course.arcade.blurb,
        ...(role === 'match' ? { difficulty: course.arcade.difficulty } : {}),
        ...(course.arcade.freeBall ? { freeBall: course.arcade.freeBall } : {}),
        ...(course.arcade.wind ? { wind: course.arcade.wind } : {}),
      }, `${label}: ${e.id}`);
      assert.match(e.file, /^osm-node-99000000000\d\d\.json$/);
    }
  }
}

test('the tour manifest lists the stages and the arenas that built, in order', () => {
  const manifest = CAT.tourManifest(BUILT_LIST);
  assertManifest(manifest, BUILT_LIST.filter((b) => b.id !== 'arcade-classics'), 'all');
  assert.equal(manifest.stages.length + manifest.tiebreaks.length, BUILT_LIST.length - 1, 'Arcade Classics is not on the tour');
  assert.deepEqual(manifest.stages.slice(0, 3).map((s) => [s.id, s.order, s.number, s.file, s.name, s.par, s.lengthYd, s.theme]), [
    ['lagoon-island', 1, 1, 'osm-node-9900000000001.json', 'Lagoon Island', 3, 151, 'tropical'],
    ['canyon-run', 2, 2, 'osm-node-9900000000002.json', 'Canyon Run', 4, 357, 'canyon'],
    ['lighthouse-point', 3, 3, 'osm-node-9900000000003.json', 'Lighthouse Point', 4, 354, 'links'],
  ]);
  const dome = manifest.tiebreaks.find((s) => s.id === 'thunder-dome');
  assert.deepEqual([dome.order, dome.number, dome.file, dome.name, dome.par, dome.theme, dome.timeOfDay], [2, 22, 'osm-node-9900000000022.json', 'Thunder Dome', 3, 'stadium', 'night']);
  assert.equal('difficulty' in dome, false, 'the contract gives a tiebreak arena no difficulty');
  // the nine of the tour, then the extra stages (order 10 and up: shuffle and the picker use them)
  const tour = manifest.stages.filter((s) => s.order <= L.TOUR_STAGES), extras = manifest.stages.filter((s) => s.order > L.TOUR_STAGES);
  assert.equal(tour[tour.length - 1].id, 'midnight-mile', 'the finale comes last on the tour');
  assert.deepEqual(manifest.stages, [...tour, ...extras], 'extra stages follow the tour');
  for (const s of [...manifest.stages, ...manifest.tiebreaks]) {
    assert.equal(s.freeBall, BUILT[s.id].course.arcade.freeBall, `${s.id}: freeBall as in course.arcade`);
    assert.deepEqual(s.wind, BUILT[s.id].course.arcade.wind, `${s.id}: wind as in course.arcade`);
  }
  // fewer stages: a manifest of what there is, never a hole in it
  const few = CAT.tourManifest([BUILT['thunder-dome'], BUILT['midnight-mile'], BUILT['lagoon-island'], BUILT['arcade-classics']]);
  assert.deepEqual([few.stages.map((s) => s.id), few.tiebreaks.map((s) => s.id)], [['lagoon-island', 'midnight-mile'], ['thunder-dome']]);
  assert.deepEqual(CAT.tourManifest([]), { version: 1, stages: [], tiebreaks: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(manifest)), manifest, 'plain JSON');
});

test('build.mjs writes every course and arcade-tour.json; --only writes one; --check writes nothing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-arcade-build-'));
  const env = { ...process.env };
  delete env.ARCADE_HOLES_DIR; delete env.BIRDIE_DATA_DIR;
  const run = (...args) => spawnSync(process.execPath, [BUILD, ...args], { env, encoding: 'utf8' });
  const allSound = !CAT.FAILED.length && !FAILED_BUILDS.length;
  try {
    const dataDir = path.join(tmp, 'data');
    const all = run('--out', dataDir);
    assert.equal(all.status, allSound ? 0 : 1, all.stderr);
    const files = fs.readdirSync(path.join(dataDir, 'courses')).sort();
    assert.deepEqual(files, BUILT_LIST.map((b) => `${courseCacheStem(b.course.source)}.json`).sort(), 'one file per course that built, nothing else');
    for (const b of BUILT_LIST) {
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'courses', `${courseCacheStem(b.course.source)}.json`), 'utf8')), b.course, `${b.id}: the file is the course`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, 'arcade-tour.json'), 'utf8'));
    assert.deepEqual(manifest, CAT.tourManifest(BUILT_LIST));
    assertManifest(manifest, BUILT_LIST.filter((b) => b.id !== 'arcade-classics'), 'written');
    for (const s of [...manifest.stages, ...manifest.tiebreaks]) assert.ok(files.includes(s.file), `${s.id}: its file is there`);
    assert.deepEqual(fs.readdirSync(dataDir).sort(), ['arcade-tour.json', 'courses'], 'no temporary file left behind');
    assert.match(all.stdout, /Clash Tour: \d+ stage\(s\)/);

    // --only: that course alone is written, and the manifest lists only what is on disk
    const oneDir = path.join(tmp, 'one');
    const one = run('--out', oneDir, '--only', 'thunder-dome');
    assert.equal(one.status, 0, one.stderr);
    assert.deepEqual(fs.readdirSync(path.join(oneDir, 'courses')), ['osm-node-9900000000022.json']);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(oneDir, 'arcade-tour.json'), 'utf8')), CAT.tourManifest([BUILT['thunder-dome']]));
    const none = run('--out', oneDir, '--only', 'no-such-hole');
    assert.equal(none.status, 1);
    assert.match(none.stderr, /No arcade course 'no-such-hole'/);

    // --check: validated, reported, nothing written
    const checkDir = path.join(tmp, 'check');
    const check = run('--out', checkDir, '--check');
    assert.equal(check.status, allSound ? 0 : 1, check.stderr);
    assert.equal(fs.existsSync(checkDir), false, '--check does not even make the directory');
    assert.match(check.stdout, /nothing written/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a hole file that throws or fails validation fails loudly, alone: the others still build', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-arcade-broken-'));
  try {
    const holes = path.join(tmp, 'holes');
    fs.mkdirSync(holes);
    const real = (id) => JSON.stringify(path.join(CAT.HOLES_DIR, `${id}.js`));
    fs.writeFileSync(path.join(holes, 'thunder-dome.js'), `module.exports = require(${real('thunder-dome')});\n`);
    fs.writeFileSync(path.join(holes, 'broken-syntax.js'), 'module.exports = {;\n');
    fs.writeFileSync(path.join(holes, 'throws.js'), 'throw new Error("the designer left a mess");\n');
    fs.writeFileSync(path.join(holes, 'wrong-id.js'), `module.exports = require(${real('lagoon-island')});\n`);
    fs.writeFileSync(path.join(holes, 'bad-stage.js'), `const r = require(${real('lagoon-island')});\nmodule.exports = { ...r, id: 'bad-stage', stage: { ...r.stage, number: 6, order: 6, theme: 'moon' } };\n`);
    fs.writeFileSync(path.join(holes, 'zz-same-number.js'), `const r = require(${real('thunder-dome')});\nmodule.exports = { ...r, id: 'zz-same-number', stage: { ...r.stage, order: 3 } };\n`);
    fs.writeFileSync(path.join(holes, 'zz-same-order.js'), `const r = require(${real('thunder-dome')});\nmodule.exports = { ...r, id: 'zz-same-order', stage: { ...r.stage, number: 23 } };\n`);
    // loads, but its pin is not on a green: fails validation when built
    fs.writeFileSync(path.join(holes, 'bad-ground.js'), `const r = require(${real('thunder-dome')});\nmodule.exports = { ...r, id: 'bad-ground', stage: { ...r.stage, number: 21, order: 1 }, hole: { ...r.hole, line: [[0, 0], [0, 60]] } };\n`);
    // a hole with no stage is no course of its own, and no failure
    fs.writeFileSync(path.join(holes, 'no-stage.js'), `const { stage, ...r } = require(${real('lagoon-island')});\nmodule.exports = { ...r, id: 'no-stage' };\n`);

    const cat = CAT.loadCatalogue(holes);
    assert.deepEqual(cat.COURSES.map((c) => c.id), ['bad-ground', 'thunder-dome'], 'no Arcade Classics without its holes; the sound stage and the one that only fails when built');
    const why = Object.fromEntries(cat.FAILED.map((f) => [f.id, f.error.message]));
    assert.deepEqual(Object.keys(why).sort(), ['bad-stage', 'broken-syntax', 'throws', 'wrong-id', 'zz-same-number', 'zz-same-order']);
    assert.match(why.throws, /the designer left a mess/);
    assert.match(why['wrong-id'], /exports id 'lagoon-island': a hole's id is its file name/);
    assert.match(why['bad-stage'], /bad-stage: stage: theme must be one of/);
    assert.match(why['zz-same-number'], /stage number 22 is already taken by thunder-dome/);
    assert.match(why['zz-same-order'], /tiebreak order 2 is already taken by thunder-dome/);
    assert.throws(() => cat.buildCourse('throws'), /the designer left a mess/);
    const { built, failed } = cat.buildCatalogue();
    assert.deepEqual(built.map((b) => b.id), ['thunder-dome']);
    assert.deepEqual(built[0].course, BUILT['thunder-dome'].course, 'the sound hole builds exactly as it does in the real catalogue');
    assert.equal(failed.length, 7);
    assert.match(failed.find((f) => f.id === 'bad-ground').error.message, /the pin is on 'fairway', not a green/);
    assert.deepEqual(cat.buildCatalogue({ only: 'thunder-dome' }).failed, []);

    // build.mjs on the same directory: exit code 1, each failure named, the sound course and the manifest written
    const dataDir = path.join(tmp, 'data');
    const r = spawnSync(process.execPath, [BUILD, '--out', dataDir], { env: { ...process.env, ARCADE_HOLES_DIR: holes }, encoding: 'utf8' });
    assert.equal(r.status, 1);
    for (const id of ['bad-stage', 'broken-syntax', 'throws', 'wrong-id', 'zz-same-number', 'zz-same-order']) assert.match(r.stderr, new RegExp(`FAILED  ${id} \\(holes/${id}\\.js\\): `), id);
    assert.match(r.stderr, /FAILED  Thunder Dome: Thunder Dome: 1 problem\(s\)\n  - hole 1 \(Thunder Dome\): the pin is on 'fairway', not a green/, 'the hole that fails validation, by name');
    assert.match(r.stderr, /Some courses FAILED/);
    assert.match(r.stdout, /Thunder Dome  \[osm:node:9900000000022\]/);
    assert.deepEqual(fs.readdirSync(path.join(dataDir, 'courses')), ['osm-node-9900000000022.json']);
    const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, 'arcade-tour.json'), 'utf8'));
    assert.deepEqual(manifest, CAT.tourManifest([BUILT['thunder-dome']]));
    assert.deepEqual([manifest.stages, manifest.tiebreaks.map((s) => s.id)], [[], ['thunder-dome']]);
    // one bad hole asked for by name: only it is reported
    const only = spawnSync(process.execPath, [BUILD, '--out', dataDir, '--only', 'throws', '--check'], { env: { ...process.env, ARCADE_HOLES_DIR: holes }, encoding: 'utf8' });
    assert.equal(only.status, 1);
    assert.match(only.stderr, /FAILED  throws/);
    assert.doesNotMatch(only.stderr, /broken-syntax/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the designs: short holes, large gentle greens, generous fairways', () => {
  const want = {
    // (the detail pass kept the pars; the par 4s grew a little with their new safe routes,
    // and Lagoon Island's green is 50 m wide: its left lobe hides behind Skull Rock)
    'lagoon-island': { par: 3, yd: [145, 155], name: 'Lagoon Island', greenMax: 52 },
    'canyon-run': { par: 4, yd: [340, 365], name: 'Canyon Run' },
    'lighthouse-point': { par: 4, yd: [335, 360], name: 'Lighthouse Point' },
  };
  for (const id of SINGLES) {
    const { course, expect } = BUILT[id];
    const [hole] = course.holes;
    assert.equal(course.holes.length, 1);
    assert.equal(course.name, want[id].name);
    assert.equal(hole.name, want[id].name);
    assert.equal(hole.ref, 1);
    assert.equal(hole.par, want[id].par);
    assert.ok(hole.lengthYd >= want[id].yd[0] && hole.lengthYd <= want[id].yd[1], `${id}: ${hole.lengthYd} yd`);
    assert.equal(hole.lengthYd, Math.round(L.polylineLength(hole.line) / YD));
    const [stats] = L.validateCourse(course, { expect }).stats.holes;
    for (const across of stats.greenM) assert.ok(across >= 28.5 && across <= (want[id].greenMax || 40.5), `${id}: green ${stats.greenM.join(' x ')} m`);
    assert.ok(stats.greenSlopePct > 0.5 && stats.greenSlopePct < 3, `${id}: green slope ${stats.greenSlopePct} %`);
    if (hole.par > 3) {
      // the landing area: fairway at least 40 m wide across the line at its first corner
      const surfaceAt = courseLib.makeSurfaceLookup(course);
      const [a, c, b] = [hole.line[0], hole.line[1], hole.line[2]];
      const len = dist(a, b), nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
      let width = 0;
      for (let d = -40; d <= 40; d += 0.5) if (surfaceAt(c[0] + nx * d, c[1] + ny * d) === 'fairway') width += 0.5;
      assert.ok(width >= 40, `${id}: fairway ${width} m wide at the landing area`);
    }
  }
  const classics = BUILT['arcade-classics'].course;
  assert.equal(classics.name, 'Arcade Classics');
  assert.deepEqual(classics.holes.map((h) => [h.ref, h.name, h.par]), [[1, 'Lagoon Island', 3], [2, 'Canyon Run', 4], [3, 'Lighthouse Point', 4]]);
  assert.deepEqual(classics.holes.map((h) => h.lengthYd), SINGLES.map((id) => BUILT[id].course.holes[0].lengthYd), 'the same holes, moved');
});

test('each course loads into the game: state, tee on a tee, pin on a green, finite ground everywhere', () => {
  for (const id of Object.keys(BUILT)) {
    const g = newGame(id);
    const s = g.state();
    assert.equal(s.loaded, true);
    assert.equal(s.courseName, BUILT[id].course.name);
    assert.equal(s.holeCount, BUILT[id].course.holes.length);
    assert.equal(s.hole, 1);
    assert.equal(s.holeName, g.hole.name, 'the hole shows its own name');
    assert.deepEqual(s.holeNames, BUILT[id].course.holes.map((h) => h.name));
    assert.equal(s.lie, 'tee');
    assert.equal(s.strokes, 0);
    assert.ok(typeof s.holeNote === 'string' && s.holeNote.length > 20);
    assert.ok(Math.abs(s.distToPinYd - dist(g.hole.tee, g.hole.pin) / YD) < 0.06);
    for (const hole of g.course.holes) {
      assert.equal(g.surfaceAt(hole.pin[0], hole.pin[1]), 'green', `${id} hole ${hole.ref}: pin`);
      assert.equal(g.surfaceAt(hole.tee[0], hole.tee[1]), 'tee', `${id} hole ${hole.ref}: tee`);
      // the cup is not perched: at least 6 m of green all round it
      for (let a = 0; a < 360; a += 30) {
        assert.equal(g.surfaceAt(hole.pin[0] + 6 * Math.cos(a * Math.PI / 180), hole.pin[1] + 6 * Math.sin(a * Math.PI / 180)), 'green');
      }
    }
    // the ground the physics samples: finite over the whole grid and past its edge
    const el = g.course.elevation;
    let lo = Infinity, hi = -Infinity;
    for (let y = el.minY - 50; y <= el.minY + el.ny * el.cellM + 50; y += 5) {
      for (let x = el.minX - 50; x <= el.minX + el.nx * el.cellM + 50; x += 5) {
        const h = g.terrain.h(x, y), gr = g.terrain.grad(x, y);
        assert.ok(Number.isFinite(h) && Number.isFinite(gr.dx) && Number.isFinite(gr.dy), `${id}: terrain at (${x}, ${y})`);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
        assert.ok(['water', 'ob', ...LIES].includes(g.surfaceAt(x, y)), `${id}: a known surface at (${x}, ${y})`);
      }
    }
    // (the extreme stages climb a mountain: up to 150 m from tee to green, more to the peaks behind)
    assert.ok(hi - lo >= 5 && hi - lo < 420, `${id}: dramatic but sane relief (${(hi - lo).toFixed(1)} m)`);
    // trees stand on dry rough, clear of the mown ground (and there is at least one: a
    // course with no canopy trees gets an invented band of them round its edge)
    assert.ok(g.course.trees.length >= 1, `${id}: some trees for framing`);
    assert.equal(g.course.canopy.trees.length, g.course.trees.length);
    for (const [x, y] of g.course.trees) assert.equal(g.surfaceAt(x, y) === 'rough' || g.surfaceAt(x, y) === 'ob', true, `${id}: tree at (${x}, ${y}) on ${g.surfaceAt(x, y)}`);
    assert.ok(g.treeObstacles, `${id}: trees are obstacles`);
  }
});

test('out of bounds begins 15 m beyond course.boundary, as the helpers assume', () => {
  const g = newGame('canyon-run');
  const east = Math.max(...g.course.boundary.map((p) => p[0]));
  assert.equal(g.surfaceAt(east + L.BOUNDARY_BUFFER_M - 1, 100), 'rough');
  assert.equal(g.surfaceAt(east + L.BOUNDARY_BUFFER_M + 1, 100), 'ob');
});

// ---- the detail pass (stream detail-a): Lagoon Island, Canyon Run and Lighthouse Point were
// rebuilt with real relief, a world round them, and three routes each (hole.routes): safe,
// risky and one only a Rocket ball reaches. The swings the brief names, and one shot at a time:
const DETAIL_SWING = {
  D150: { Speed: 150, VLA: 12, HLA: 0, TotalSpin: 2500, SpinAxis: 0 },       // a good drive
  D135: { Speed: 135, VLA: 13, HLA: 0, TotalSpin: 2800, SpinAxis: 0 },       // an average one
  D120: { Speed: 120, VLA: 14, HLA: 0, TotalSpin: 3000, SpinAxis: 0 },       // a short one
  D160: { Speed: 160, VLA: 12, HLA: 0, TotalSpin: 2400, SpinAxis: 0 },       // a very long one
};
// One swing on a fresh hole. at: aim at this point (else `off` degrees from the flag);
// wind: [mph, 'head' | 'tail' | 'left' | 'right'] relative to the aim; rocket: a Rocket ball;
// from: play it from here instead of the tee. -> { g, r, land: the first bounce (or splash) }
function oneSwing(id, launch, { at = null, off = 0, wind = null, rocket = false, from = null, power = 1, label = '', gadgets = true } = {}) {
  const g = newGame(id);
  if (gadgets === false) g.gadgets = null;   // v3:gadgets the ground alone, the stage's gadgets (lib/gadgets.js) taken off it
  if (from) { g.ball = { x: from[0], y: from[1] }; g.lie = g.surfaceAt(from[0], from[1]); g.strokes = 1; }
  g.setAimOffset(at ? Math.atan2(at[0] - g.ball.x, at[1] - g.ball.y) * 180 / Math.PI - (g.aimDeg - g.aimOffset) : off);
  if (wind) {
    const from0 = { head: 0, tail: 180, left: -90, right: 90 }[wind[1]];
    g.setConditions({ windMph: wind[0], windFromDeg: (((g.aimDeg + from0) % 360) + 360) % 360, gustMph: 0 });
  }
  if (rocket) g.shotMods = require('../lib/arcade').modifiersFor('rocket');
  const r = g.handleShot({ ...launch, Speed: launch.Speed * power });
  g.shotMods = null;                              // one Rocket ball, not a bag of them
  assertSoundShot(g, r, `${id} ${label}`);
  return { g, r, land: r.sim.events.find((e) => e.type === 'bounce' || e.type === 'water') || r.end };
}
const hasRocket = () => { try { return typeof require('../lib/arcade').modifiersFor === 'function' && Boolean(require('../lib/arcade').POWERUPS.find((p) => p.id === 'rocket')); } catch (_) { return false; } };
// every surface along a polyline, one per two metres
function alongPath(g, pts) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const n = Math.ceil(dist(pts[i - 1], pts[i]) / 2);
    for (let k = 0; k <= n; k++) out.push(g.surfaceAt(L.lerp(pts[i - 1][0], pts[i][0], k / n), L.lerp(pts[i - 1][1], pts[i][1], k / n)));
  }
  return out;
}
const reliefOf = (id) => { const hs = BUILT[id].course.elevation.heights; return Math.max(...hs) - Math.min(...hs); };
const routeIds = (id) => (BUILT[id].course.holes[0].routes || []).map((r) => r.id);
const D_SLOPE = (g, x, y) => { const s = g.terrain.grad(x, y); return Math.hypot(s.dx, s.dy); };

test('Lagoon Island: a headland tee, an island green, Skull Rock in the lagoon\'s mouth', () => {
  const id = 'lagoon-island';
  const g0 = newGame(id), hole = g0.hole;
  assert.deepEqual(routeIds(id), ['safe', 'risky', 'rocket']);
  const line = directLine(g0, hole);
  const wet = line.filter((s) => s === 'water').length;
  assert.ok(wet >= 85, `${wet} m of the ${line.length} m to the flag are water`);
  // elevation: the tee 22 m above the lagoon and 13 m above the green; Skull Rock 31 m above the tee
  const sea = g0.terrain.h(-100, 100), teeH = g0.terrain.h(0, 0), pinH = g0.terrain.h(hole.pin[0], hole.pin[1]);
  assert.equal(sea, g0.terrain.h(-6, 70), 'the lagoon is the sea, level');
  assert.ok(teeH - sea >= 20 && teeH - pinH >= 11 && pinH - sea >= 8, `tee ${teeH}, green ${pinH}`);
  assert.ok(g0.terrain.h(-29, 84) - teeH >= 31, `Skull Rock stands ${(g0.terrain.h(-29, 84) - teeH).toFixed(0)} m above the tee`);
  assert.ok(reliefOf(id) >= 55 && reliefOf(id) < 110, `relief ${reliefOf(id).toFixed(0)} m`);
  // the rock is a penalty area, crown included (a steep slant, no table to drop a ball on): all
  // of it but a cell or two on the crest
  const onRock = [];
  for (let a = 0; a < 360; a += 15) for (const q of [0, 3, 6, 9, 11]) onRock.push(g0.surfaceAt(-29 + q * Math.cos(a * Math.PI / 180), 84 + q * Math.sin(a * Math.PI / 180)));
  assert.ok(onRock.filter((s) => s === 'water').length >= 0.95 * onRock.length, `Skull Rock plays as ${JSON.stringify(onRock.reduce((m, s) => ({ ...m, [s]: (m[s] || 0) + 1 }), {}))}`);
  assert.ok(D_SLOPE(g0, -29, 84) > 0.7, 'its crown is steep');
  // open water left of the line and behind the island; the green 50 m wide, a third of it behind the rock
  // (a sea stack's crest can hold a cell of rough, 20 m up and far from any line: nothing else is dry)
  const open = [];
  for (let y = 30; y <= 110; y += 4) for (let x = -200; x <= -50; x += 6) open.push(g0.surfaceAt(x, y));
  assert.ok(open.filter((s) => s === 'water').length >= 0.99 * open.length && open.every((s) => s === 'water' || s === 'rough'), 'open water left of the line');
  for (let x = -160; x <= 60; x += 10) assert.equal(g0.surfaceAt(x, 300), 'water', `sea at (${x}, 300)`);
  assert.ok(widthAcross(g0, 'green', 138, -60, 30) >= 46, 'the green is wide');
  const rockRight = Math.atan2(-29 + 13, 84) * 180 / Math.PI, flag = Math.atan2(hole.pin[0], hole.pin[1]) * 180 / Math.PI;
  assert.ok(flag - rockRight > 3 && flag - rockRight < 6, `the flag is ${(flag - rockRight).toFixed(1)} deg right of the rock's edge`);

  // RISKY, the Lagoon: every stock club at the flag is sound; an 8-iron holds the green by the flag
  const lies = {};
  for (const k of Object.keys(CLUB_FULL)) {
    if (k === 'PT') continue;
    const { r } = oneSwing(id, stock(k), { label: k });
    lies[k] = r.penalty ? 'water' : r.lie;
    if (r.penalty) { assert.equal(r.strokes, 2, 'stroke and penalty'); assert.match(r.note, /^Water/); }
  }
  assert.ok(['I7', 'I8', 'I9'].filter((k) => lies[k] === 'green').length >= 2, `mid irons hold the green: ${JSON.stringify(lies)}`);
  assert.equal(lies.DR, 'water', 'a driver flies the island');
  assert.equal(lies.LW, 'water', 'a lob wedge is short');
  const flagged = oneSwing(id, stock('I8'), { label: '8-iron at the flag' });
  assert.ok(flagged.r.lie === 'green' && flagged.r.distToPinYd < 8, `the 8-iron finishes ${flagged.r.distToPinYd} yd away`);
  // ... pulled six degrees and more it hits Skull Rock; pushed, there is 20 m of green and then the bar
  for (const off of [-6, -9, -14]) assert.equal(oneSwing(id, stock('I8'), { off, label: `8-iron ${off} deg` }).r.penalty, 1, `${off} deg left hits the rock`);
  for (const off of [-3, 3, 6, 10]) assert.equal(oneSwing(id, stock('I8'), { off, label: `8-iron ${off} deg` }).r.penalty, 0, `${off} deg off line is dry`);

  // SAFE, Turtle Bar: dry ground from the tee to the green, a mown pad 40 m wide to land on
  const walk = alongPath(g0, [[0, 0], [8, 13], [16, 26], [30, 47], [50, 68], [44, 88], [36, 112], [24, 127], [8, 137], hole.pin]);
  assert.ok(walk.every((s) => LIES.includes(s)), `no water between the tee and the green by the bar: ${[...new Set(walk)]}`);
  assert.ok(widthAcross(g0, 'fairway', 80, 0, 100) >= 40, 'the pad is 40 m wide');
  for (const k of ['LW', 'SW']) {
    const safe = oneSwing(id, stock(k), { at: [46, 82], label: `${k} to the bar` });
    assert.equal(safe.r.penalty, 0);
    assert.equal(safe.r.lie, 'fairway', `${k} to the bar lies on ${safe.r.lie}`);
    assert.ok(safe.r.distToPinYd > 50 && safe.r.distToPinYd < 105, `${safe.r.distToPinYd} yd`);   // v3:gadgets (the Bar Runner, a speed strip, runs a ball that rolls onto it on along the bar: 55 to 90 yd left, was 75 to 105)
    assert.ok(playHole(safe.g, `${id} by the bar`) <= 4, 'a pitch and two putts at worst');
  }
  assert.equal(oneSwing(id, { Speed: 60, VLA: 3, HLA: 0, TotalSpin: 2000, SpinAxis: 0 }, { at: [46, 82], label: 'topped at the bar' }).r.penalty, 0, 'a topped ball stays on the bank');
  // too much club at the bar stops against its dune, dry
  assert.equal(oneSwing(id, stock('PW'), { at: [46, 82], label: 'PW to the bar' }).r.penalty, 0);

  // the wind at the top of its range (9 mph): a club more into it, and the green takes a crosswind
  assert.equal(BUILT[id].course.arcade.wind.max, 9);
  assert.equal(oneSwing(id, stock('I7'), { wind: [9, 'head'], label: '7-iron into 9 mph' }).r.lie, 'green');
  for (const side of ['left', 'right']) assert.equal(oneSwing(id, stock('I8'), { wind: [9, side], label: `8-iron, wind from the ${side}` }).r.lie, 'green');
  assert.equal(oneSwing(id, stock('SW'), { at: [46, 82], wind: [9, 'head'], label: 'SW to the bar into 9 mph' }).r.lie, 'fairway');

  // short: in the lagoon, dropped back by the tee, then played out; from a fresh tee the caddie makes par
  const g = newGame(id);
  const short = g.handleShot(stock('SW'), 'SW');
  assert.equal(short.penalty, 1);
  assert.ok(short.end.y < 30, 'the drop is back by the tee, where it crossed the shore');
  const strokes = playHole(g, id);
  assert.ok(strokes >= 4 && strokes <= 7, `out in ${strokes} after the water ball`);
  assert.equal(g.state().over, true, 'a one-hole course: the round is over');
  assert.ok(playHole(newGame(id), id) <= 3);
});

test('Lagoon Island: only a Rocket ball clears Skull Rock to the hidden left of the green', (t) => {
  const id = 'lagoon-island';
  const lobe = [-34, 138];
  assert.equal(newGame(id).surfaceAt(lobe[0], lobe[1]), 'green');
  // no plain ball gets there: every stock club, flat out or eased off, aimed at the lobe hits the rock or is wet
  for (const k of Object.keys(CLUB_FULL)) {
    if (k === 'PT') continue;
    for (const power of [0.85, 1, 1.1]) {
      const { r, land } = oneSwing(id, stock(k), { at: lobe, power, label: `${k} x${power} at the hidden lobe` });
      assert.equal(r.penalty, 1, `${k} x${power} at the lobe: landed (${land.x.toFixed(0)}, ${land.y.toFixed(0)}), lies ${r.lie}`);
    }
  }
  assert.equal(oneSwing(id, { Speed: 165, VLA: 15, HLA: 0, TotalSpin: 2300, SpinAxis: 0 }, { at: lobe, label: 'a 165 mph drive at the lobe' }).r.penalty, 1);
  if (!hasRocket()) return t.skip('lib/arcade.js has no Rocket power-up');
  // a Rocket lob wedge does: over the rock, onto the green behind it
  for (const power of [0.95, 1]) {
    const { r, land } = oneSwing(id, stock('LW'), { at: lobe, rocket: true, power, label: `Rocket LW x${power} over Skull Rock` });
    assert.equal(r.penalty, 0);
    assert.equal(r.lie, 'green', `the Rocket lob lies on ${r.lie}`);
    assert.ok(land.x < -24 && r.distToPinYd < 30, `it lands at x ${land.x.toFixed(0)}, ${r.distToPinYd} yd from the flag`);
  }
  // and with the rock out of play the flag itself is a free shot
  const atFlag = oneSwing(id, stock('LW'), { rocket: true, label: 'Rocket LW at the flag' });
  assert.ok(atFlag.r.lie === 'green' && atFlag.r.distToPinYd < 10, `${atFlag.r.distToPinYd} yd`);
  // into the wind at the top of its range it still gets there
  assert.equal(oneSwing(id, stock('LW'), { at: lobe, rocket: true, wind: [9, 'head'], label: 'Rocket LW into 9 mph' }).r.lie, 'green');
});

test('Canyon Run: from a butte to a mesa in the gorge: the floor, the East Rim, or over the top', () => {
  const id = 'canyon-run';
  const g0 = newGame(id), hole = g0.hole;
  assert.deepEqual(routeIds(id), ['safe', 'risky', 'rocket']);
  const line = directLine(g0, hole);
  const firstWet = line.indexOf('water'), lastWet = line.lastIndexOf('water');
  assert.ok(firstWet > 60 && firstWet < 100, `the gorge begins ${firstWet} m out`);
  assert.ok(lastWet / YD > 280 && lastWet / YD < 295, `and is carried at ${(lastWet / YD).toFixed(0)} yd: beyond any plain drive`);
  assert.ok(line.slice(firstWet, lastWet + 1).every((s) => s === 'water'), 'no ledge to land on half way');
  assert.equal(line[line.length - 1], 'green');
  // elevation: the tee 20 m above the fairway, the gorge 54 m below the mesa, walls 50 m above the floor
  const teeH = g0.terrain.h(0, 0), pinH = g0.terrain.h(hole.pin[0], hole.pin[1]);
  assert.ok(teeH - g0.terrain.h(-10, 120) >= 18, 'the tee stands on a butte above the canyon floor');
  assert.ok(Math.abs(teeH - pinH) <= 4, `the mesa is as high as the tee (${teeH} and ${pinH})`);
  assert.ok(pinH - g0.terrain.h(60, 100) >= 50, 'the gorge is deep');
  assert.ok(pinH - g0.terrain.h(-2, 200) >= 10, 'the green stands above the corner of the fairway');
  assert.ok(g0.terrain.h(-150, 120) - g0.terrain.h(-10, 120) >= 40, 'the west wall');
  assert.ok(reliefOf(id) >= 95 && reliefOf(id) < 130, `relief ${reliefOf(id).toFixed(0)} m`);
  // the routing line stays on dry land all the way, and the fairway is 45 m wide where drives land
  for (let i = 1; i < hole.line.length; i++) {
    for (let t = 0; t <= 1; t += 0.02) {
      const x = L.lerp(hole.line[i - 1][0], hole.line[i][0], t), y = L.lerp(hole.line[i - 1][1], hole.line[i][1], t);
      assert.ok(LIES.includes(g0.surfaceAt(x, y)), `the route is playable at (${x.toFixed(0)}, ${y.toFixed(0)})`);
    }
  }
  assert.ok(widthAcross(g0, 'fairway', 200, -60, 60) >= 50 && widthAcross(g0, 'fairway', 120, -60, 60) >= 40);

  // straight at the flag no plain drive gets there on its own: the mesa's wall, a penalty, dropped on the near rim
  // v3:gadgets (the ground's own claim: played here with the stage's gadgets taken off it. With them on, the line
  // at the flag is barred by the Barricade, a wall only 150 mph breaks, and the Mesa Ring behind it carries the
  // ball that broke it to the mesa: test/gadgets.test.js "Canyon Run, the 150 club")
  for (const [name, launch] of [['stock driver', stock('DR')], ['150 mph', DETAIL_SWING.D150], ['160 mph', DETAIL_SWING.D160], ['160 mph downwind', DETAIL_SWING.D160, [14, 'tail']]]) {
    const { r } = oneSwing(id, launch, { wind: name.includes('downwind') ? [14, 'tail'] : null, label: `${name} at the flag`, gadgets: false });
    assert.equal(r.penalty, 1, `${name} at the flag`);
    assert.match(r.note, /^Water/);
    assert.ok(r.end.y < 200 && r.distToPinYd > 80, 'the drop is on the tee side of the gorge');
  }

  // SAFE, the Canyon Floor: any club up the fairway is dry, and the corner leaves a mid iron up the ramp
  for (const [name, launch] of [['150 mph drive', DETAIL_SWING.D150], ['135 mph drive', DETAIL_SWING.D135], ['3-wood', stock('W3')], ['hybrid', stock('H3')], ['5-iron', stock('I5')]]) {
    const { r } = oneSwing(id, launch, { at: [-6, 200], label: `${name} up the fairway` });
    assert.equal(r.penalty, 0, `${name} up the fairway`);
    assert.ok(r.distToPinYd > 75 && r.distToPinYd < 150, `${name} leaves ${r.distToPinYd} yd`);   // v3:gadgets (a drive that rolls onto the Ramp Runner, a speed strip at the turn, is carried up the ramp: 85 yd left, was 100 to 150)
  }
  const safe = oneSwing(id, stock('H3'), { at: [-6, 200], label: 'hybrid to the corner', gadgets: false });   // v3:gadgets (the ground's own corner: with the Ramp Runner on, the hybrid is carried up the ramp and leaves a wedge, not a 7-iron)
  assert.equal(safe.r.lie, 'fairway');
  safe.g.setAimOffset(0);
  const approach = safe.g.handleShot(stock('I7'), 'I7');
  assertSoundShot(safe.g, approach, `${id} 7-iron up the ramp`);
  assert.equal(approach.lie, 'green', `the 7-iron from the corner lies on ${approach.lie}`);
  assert.ok(playHole(safe.g, id) <= 4, 'par by the fairway');
  // short of the green from the corner is the ramp: mown, dry
  assert.equal(oneSwing(id, stock('PW'), { from: [-2, 205], label: 'short approach' }).r.penalty, 0);

  // RISKY, the East Rim: 185 yd of carry to the Porch, then a flick over the rock bridge
  const porch = [124, 186];
  for (const [name, launch] of [['150 mph', DETAIL_SWING.D150], ['stock driver', stock('DR')], ['135 mph', DETAIL_SWING.D135], ['3-wood', stock('W3')]]) {
    const { r } = oneSwing(id, launch, { at: porch, label: `${name} to the Porch` });
    assert.equal(r.penalty, 0, `${name} to the Porch`);
    assert.equal(r.lie, 'fairway', `${name} to the Porch lies on ${r.lie}`);
    assert.ok(r.distToPinYd < 105, `${name} leaves ${r.distToPinYd} yd`);
  }
  assert.equal(oneSwing(id, DETAIL_SWING.D120, { at: porch, label: '120 mph at the Porch' }).r.penalty, 0, 'a short drive just makes the front of it');
  for (const k of ['I5', 'I7']) assert.equal(oneSwing(id, stock(k), { at: porch, label: `${k} at the Porch` }).r.penalty, 1, `a ${k} does not carry the gorge`);
  const risky = oneSwing(id, DETAIL_SWING.D150, { at: porch, label: 'the East Rim' });
  assert.ok(alongPath(risky.g, [[risky.g.ball.x, risky.g.ball.y], [124, 229], [110, 252], hole.pin]).every((s) => LIES.includes(s)), 'dry ground from the Porch to the green, over the rock bridge');
  assert.ok(playHole(risky.g, id) <= 4, 'a pitch and two putts at worst');
  const flick = oneSwing(id, stock('LW'), { from: [128, 205], label: 'lob wedge from the Porch' });
  assert.ok(flick.r.lie === 'green' && flick.r.distToPinYd < 10, `the flick finishes ${flick.r.distToPinYd} yd away`);
  // the wind at the top of its range (14 mph) against it, and across it: the carry still comes off
  assert.equal(BUILT[id].course.arcade.wind.max, 14);
  for (const wind of [[14, 'head'], [14, 'left'], [14, 'right']]) {
    const blown = oneSwing(id, DETAIL_SWING.D150, { at: porch, wind, label: `to the Porch, wind ${wind[1]}` });
    assert.equal(blown.r.penalty, 0, `150 mph to the Porch with 14 mph from ${wind[1]} (${blown.r.lie})`);
  }
  assert.equal(oneSwing(id, DETAIL_SWING.D150, { at: [-6, 200], wind: [14, 'head'], label: 'up the fairway into 14 mph' }).r.lie, 'fairway');

  // the waste bunker is in play between the fairway and the gorge
  const sandy = [];
  for (const k of ['I5', 'I6', 'I7', 'I8', 'I9']) {
    for (let aimOffset = -18; aimOffset <= -6; aimOffset += 2) {
      const { r } = oneSwing(id, stock(k), { off: aimOffset, label: `${k} aimed ${aimOffset}` });
      if (r.lie === 'bunker') sandy.push(`${k} ${aimOffset}`);
    }
  }
  assert.ok(sandy.length >= 3, `shots that find the waste bunker: ${sandy.join(', ')}`);
  // a wild drive either way stays in the canyon: the walls are in bounds
  for (const [HLA, SpinAxis] of [[-20, 0], [20, 0], [-8, -25], [8, 25]]) {
    const { r } = oneSwing(id, stock('DR', { HLA, SpinAxis }), { at: [-6, 200], label: `drive ${HLA} / ${SpinAxis}` });
    assert.doesNotMatch(r.note || '', /Out of bounds/);
  }
});

test('Canyon Run: a Rocket straight at the flag carries the gorge and stays on the mesa', (t) => {
  if (!hasRocket()) return t.skip('lib/arcade.js has no Rocket power-up');
  const id = 'canyon-run';
  const eagle = oneSwing(id, stock('I5'), { rocket: true, label: 'Rocket 5-iron at the flag' });
  assert.equal(eagle.r.penalty, 0);
  assert.equal(eagle.r.lie, 'green', `the Rocket 5-iron lies on ${eagle.r.lie}`);
  assert.ok(eagle.r.sim.carryYd > 285 && eagle.r.distToPinYd < 15, `it carries ${eagle.r.sim.carryYd.toFixed(0)} yd and finishes ${eagle.r.distToPinYd} yd away`);
  assert.ok(playHole(eagle.g, id) <= 3, 'a birdie at worst');
  // a club less is in the wall, a boosted driver is gone over the back
  assert.equal(oneSwing(id, stock('I7'), { rocket: true, label: 'Rocket 7-iron' }).r.penalty, 1);
  assert.equal(oneSwing(id, stock('DR'), { rocket: true, label: 'Rocket driver' }).r.penalty, 1);
  // into 14 mph it takes two clubs more, with it one less: there is always a club
  assert.equal(oneSwing(id, stock('H3'), { rocket: true, wind: [14, 'head'], label: 'Rocket hybrid into 14 mph' }).r.lie, 'green');
  assert.equal(oneSwing(id, stock('I7'), { rocket: true, wind: [14, 'tail'], label: 'Rocket 7-iron downwind' }).r.lie, 'green');
});

test('Lighthouse Point: clifftop links round a cove: the fairway, Smugglers\' Cut, or over it all', () => {
  const id = 'lighthouse-point';
  const g0 = newGame(id), hole = g0.hole;
  assert.deepEqual(routeIds(id), ['safe', 'risky', 'rocket']);
  const line = directLine(g0, hole);
  const wet = line.filter((s) => s === 'water').length;
  assert.ok(wet / YD > 170, `${(wet / YD).toFixed(0)} yd of the direct line are over the sea`);
  const lastWet = line.lastIndexOf('water');
  assert.ok(lastWet / YD > 268 && lastWet / YD < 290, `the cove and its cliff are carried at ${(lastWet / YD).toFixed(0)} yd: beyond any plain drive`);
  // elevation: fairway 25 m above the sea, the green 33 m above it on the headland, the crag and the moor above that
  const sea = g0.terrain.h(-150, 60), teeH = g0.terrain.h(0, 0), pinH = g0.terrain.h(hole.pin[0], hole.pin[1]);
  assert.equal(sea, g0.terrain.h(-200, 320), 'the sea is level');
  assert.ok(g0.terrain.h(14, 120) - sea >= 22 && teeH - g0.terrain.h(14, 120) >= 6, 'a knoll above a clifftop fairway');
  assert.ok(pinH - sea >= 31 && Math.abs(pinH - teeH) <= 3, `the green is as high as the tee (${pinH} and ${teeH})`);
  assert.ok(g0.terrain.h(-128, 289) - pinH >= 9, 'the lighthouse crag stands over the green');
  assert.ok(reliefOf(id) >= 60 && reliefOf(id) < 110, `relief ${reliefOf(id).toFixed(0)} m`);
  for (let y = -60; y <= 400; y += 20) assert.equal(g0.surfaceAt(-320, y), 'water', `sea at the west edge, y ${y}`);
  // the cove, its reefs and stacks included: nowhere to stand
  // (a sea stack's crest can hold a cell of rough, 20 m up and far from any line: nothing else is dry)
  const cove = [];
  for (let y = 44; y <= 180; y += 4) for (let x = -300; x <= -62; x += 6) cove.push(g0.surfaceAt(x, y));
  assert.ok(cove.filter((s) => s === 'water').length >= 0.99 * cove.length && cove.every((s) => s === 'water' || s === 'rough'), 'the cove is water');
  // the routing line is dry all the way and the fairway 45 m wide at the lay-up
  for (let i = 1; i < hole.line.length; i++) {
    assert.ok(alongPath(g0, [hole.line[i - 1], hole.line[i]]).every((s) => LIES.includes(s)), `leg ${i} of the route is dry`);
  }
  assert.ok(widthAcross(g0, 'fairway', 120, -40, 70) >= 45 && widthAcross(g0, 'fairway', 200, -40, 70) >= 45);

  // straight at the flag no plain drive gets there: the sea, or the cliff under the green
  for (const [name, launch] of [['stock driver', stock('DR')], ['150 mph', DETAIL_SWING.D150], ['160 mph', DETAIL_SWING.D160]]) {
    const { g, r } = oneSwing(id, launch, { label: `${name} at the flag` });
    assert.equal(r.penalty, 1, `${name} at the flag`);
    assert.match(r.note, /^Water/);
    assert.ok(g.terrain.h(r.end.x, r.end.y) > 15 && r.distToPinYd > 150, 'the drop is on the clifftop by the tee');
  }
  // hooked off the tee on the bold line: in the sea, a stroke, dropped back on the clifftop
  const hook = oneSwing(id, stock('DR', { HLA: -12, SpinAxis: -12 }), { at: [-44, 236], label: 'hooked drive' });
  assert.equal(hook.r.penalty, 1);
  assert.ok(hook.g.terrain.h(hook.r.end.x, hook.r.end.y) > 15, 'the drop is on top, not on the rocks');

  // SAFE, the Links: no carry, any club; the corner leaves a mid iron along the headland
  for (const [name, launch] of [['150 mph drive', DETAIL_SWING.D150], ['135 mph drive', DETAIL_SWING.D135], ['3-wood', stock('W3')], ['hybrid', stock('H3')], ['5-iron', stock('I5')]]) {
    const { r } = oneSwing(id, launch, { at: [12, 200], label: `${name} up the fairway` });
    assert.equal(r.penalty, 0, `${name} up the fairway`);
    assert.ok(r.distToPinYd > 70 && r.distToPinYd < 150, `${name} leaves ${r.distToPinYd} yd`);   // v3:gadgets (a drive that reaches the corner is swept west by the Headland Runner, a speed strip: 80 yd left, was 110 to 150)
  }
  const safe = oneSwing(id, DETAIL_SWING.D135, { at: [12, 200], label: 'average drive up the fairway' });
  assert.equal(safe.r.lie, 'fairway');
  assert.ok(alongPath(safe.g, [[safe.g.ball.x, safe.g.ball.y], [-40, 240], hole.pin]).every((s) => LIES.includes(s)), 'dry ground from there to the green');
  assert.ok(playHole(safe.g, id) <= 4, 'par by the fairway');
  const mid = oneSwing(id, stock('I8'), { from: [8, 225], label: '8-iron along the headland' });
  assert.ok(mid.r.lie === 'green' && mid.r.distToPinYd < 10, `the 8-iron finishes ${mid.r.distToPinYd} yd away on ${mid.r.lie}`);

  // RISKY, Smugglers' Cut: a good drive carries the corner of the cove and leaves a wedge
  const cut = [-44, 236];
  for (const [name, launch] of [['150 mph', DETAIL_SWING.D150], ['stock driver', stock('DR')], ['3-wood', stock('W3')]]) {
    const { r } = oneSwing(id, launch, { at: cut, label: `${name} over the cut` });
    assert.equal(r.penalty, 0, `${name} over the cut`);
    assert.equal(r.lie, 'fairway', `${name} over the cut lies on ${r.lie}`);
    assert.ok(r.distToPinYd < 90, `${name} leaves ${r.distToPinYd} yd`);
  }
  assert.equal(oneSwing(id, stock('H3'), { at: cut, label: 'hybrid at the cut' }).r.penalty, 1, 'a hybrid is in the cove');
  const risky = oneSwing(id, DETAIL_SWING.D150, { at: cut, label: 'the cut' });
  assert.ok(playHole(risky.g, id) <= 4);
  const wedge = oneSwing(id, stock('LW'), { from: cut, label: 'lob wedge from the cut' });
  assert.ok(wedge.r.lie === 'green' && wedge.r.distToPinYd < 10, `the wedge finishes ${wedge.r.distToPinYd} yd away`);
  // the wind at the top of its range (22 mph): the cut still carries dead into it and across it,
  // and the fairway is still the fairway
  assert.equal(BUILT[id].course.arcade.wind.max, 22);
  for (const wind of [[22, 'head'], [22, 'left'], [22, 'right']]) {
    const blown = oneSwing(id, DETAIL_SWING.D150, { at: cut, wind, label: `the cut, wind ${wind[1]}` });
    assert.equal(blown.r.penalty, 0, `150 mph over the cut with 22 mph from ${wind[1]} (${blown.r.lie})`);
  }
  assert.equal(oneSwing(id, DETAIL_SWING.D135, { at: cut, wind: [22, 'head'], label: 'average drive into 22 mph' }).r.penalty, 1, 'an average drive into the wind does not: lay up');
  assert.equal(oneSwing(id, DETAIL_SWING.D150, { at: [12, 200], wind: [22, 'head'], label: 'up the fairway into 22 mph' }).r.lie, 'fairway');
  // a slice or a push finds the inland rough or the dunes, never out of bounds
  for (const [HLA, SpinAxis] of [[12, 12], [20, 0], [8, 25]]) {
    const { r } = oneSwing(id, stock('DR', { HLA, SpinAxis }), { at: [12, 200], label: `drive ${HLA} / ${SpinAxis}` });
    assert.equal(r.penalty, 0, `a drive ${HLA} deg right`);
  }
});

test('Lighthouse Point: a Rocket straight at the flag carries the cove and its cliff', (t) => {
  if (!hasRocket()) return t.skip('lib/arcade.js has no Rocket power-up');
  const id = 'lighthouse-point';
  const eagle = oneSwing(id, stock('I6'), { rocket: true, label: 'Rocket 6-iron at the flag' });
  assert.equal(eagle.r.penalty, 0);
  assert.equal(eagle.r.lie, 'green', `the Rocket 6-iron lies on ${eagle.r.lie}`);
  assert.ok(eagle.r.sim.carryYd > 270 && eagle.r.distToPinYd < 12, `it carries ${eagle.r.sim.carryYd.toFixed(0)} yd and finishes ${eagle.r.distToPinYd} yd away`);
  assert.ok(playHole(eagle.g, id) <= 3, 'a birdie at worst');
  assert.equal(oneSwing(id, stock('I5'), { rocket: true, label: 'Rocket 5-iron' }).r.lie, 'green', 'a club more is on the back of the green');
  // a club less is in the cliff, a boosted driver is in the sea beyond the headland
  assert.equal(oneSwing(id, stock('I7'), { rocket: true, label: 'Rocket 7-iron' }).r.penalty, 1);
  assert.equal(oneSwing(id, stock('DR'), { rocket: true, label: 'Rocket driver' }).r.penalty, 1);
  // into 22 mph it is a Rocket 3-wood: there is still a club that gets home
  const blown = oneSwing(id, stock('W3'), { rocket: true, wind: [22, 'head'], label: 'Rocket 3-wood into 22 mph' });
  assert.ok(blown.r.penalty === 0 && blown.r.distToPinYd < 30, `into the wind: ${blown.r.lie}, ${blown.r.distToPinYd} yd`);
});

test('Arcade Classics: three holes played in order, the round ends after the third', () => {
  const g = newGame('arcade-classics');
  const total = [];
  for (let i = 0; i < 3; i++) {
    assert.equal(g.state().hole, i + 1);
    assert.equal(g.state().lie, 'tee');
    total.push(playHole(g, `arcade-classics hole ${i + 1}`));
    if (i < 2) { assert.equal(g.state().over, false); g.nextHole(); }
  }
  const s = g.state();
  assert.equal(s.over, true);
  assert.deepEqual(s.scores, total);
  assert.deepEqual(s.pars, [3, 4, 4]);
  assert.ok(total.every((n, i) => n <= s.pars[i] + 2), `the caddie's card: ${total}`);
  // each hole keeps its own hazard in the shared ground
  const [lagoon, canyon, lighthouse] = g.course.holes;
  assert.equal(g.surfaceAt(lagoon.tee[0], lagoon.tee[1] + 70), 'water');
  assert.equal(g.surfaceAt(canyon.tee[0] + 60, canyon.tee[1] + 100), 'water');
  assert.equal(g.surfaceAt(lighthouse.tee[0] - 150, lighthouse.tee[1] + 100), 'water');
  assert.equal(g.surfaceAt((canyon.tee[0] + lighthouse.tee[0]) / 2, 150), 'rough', 'the ground between holes is in play');
});

test('props: set pieces for the props layer, of kinds the look stream models, clear of play', () => {
  const kinds = (id) => BUILT[id].course.props.reduce((m, p) => ({ ...m, [p.kind]: (m[p.kind] || 0) + 1 }), {});
  // the three originals after the detail pass: 120 to 250 props each, massed into vignettes
  // (a harbour at Lagoon Island, a mining camp at Canyon Run, a fishing village under the lighthouse)
  const vignettes = {
    'lagoon-island': { palm: 40, hut: 10, boat: 12, tiki: 6, bridge: 2, torch: 6, 'rock-spire': 4, waterfall: 2, crowd: 2, jumbotron: 1, volcano: 2, idol: 1, 'bird-flock': 5 },
    'canyon-run': { 'rock-spire': 10, cactus: 40, cabin: 4, windmill: 1, tower: 2, bridge: 2, waterfall: 2, mesa: 8, 'rock-arch': 4, torch: 10, 'flag-banner': 10, crowd: 2, jumbotron: 1, ruins: 2 },
    'lighthouse-point': { lighthouse: 1, hut: 8, boat: 14, shipwreck: 2, 'bird-flock': 10, castle: 1, 'rock-spire': 10, windmill: 2, cabin: 5, crowd: 4, grandstand: 2, jumbotron: 1, 'flag-banner': 10 },
  };
  for (const id of SINGLES) {
    const have = kinds(id), total = BUILT[id].course.props.length;
    assert.ok(total >= 120 && total <= 250, `${id}: ${total} props`);
    for (const [kind, least] of Object.entries(vignettes[id])) assert.ok((have[kind] || 0) >= least, `${id}: ${have[kind] || 0} x ${kind} (at least ${least})`);
  }
  assert.equal(BUILT['arcade-classics'].course.props.length, SINGLES.reduce((n, id) => n + BUILT[id].course.props.length, 0));
  // the contract's kinds, every one of them and nothing else
  assert.deepEqual([...L.PROP_KINDS].sort(), [
    'lighthouse', 'palm', 'volcano', 'rock-arch', 'cactus', 'mesa', 'pine', 'snowman', 'cabin', 'ice-spire', 'lava-rock', 'lava-fall',
    'sakura-tree', 'torii', 'pagoda', 'stone-lantern', 'bridge', 'temple', 'idol', 'pyramid', 'obelisk', 'sphinx', 'skyscraper',
    'neon-sign', 'billboard', 'grandstand', 'floodlight', 'target-ring', 'balloon', 'blimp', 'windmill', 'shipwreck', 'crystal', 'torch', 'flag-banner',
    // the second wave (contract section 5)
    'waterfall', 'castle', 'dragon', 'giant-tree', 'ruins', 'jumbotron', 'fireworks', 'cloud', 'airship', 'statue', 'fountain', 'tiki', 'hut', 'boat',
    'gate', 'tower', 'rock-spire', 'launch-ramp', 'crowd', 'bird-flock',
    // v3:stadium the stadium kit
    'stand-section', 'stand-corner', 'led-board', 'ad-board', 'barrier', 'camera-tower', 'tunnel', 'podium',
  ].sort());
  assert.deepEqual([...L.STAND_PROP_KINDS], ['stand-section', 'stand-corner']);
  for (const k of [...L.STAND_PROP_KINDS, 'led-board', 'ad-board', 'barrier']) assert.ok(L.PROP_KINDS.includes(k), k);
  // a stand is judged by the ground 6 m in under its tiers, anything else where it stands
  assert.deepEqual(L.propFoot({ kind: 'palm', x: 3, y: 4, rotDeg: 90 }), [3, 4]);
  assert.deepEqual(L.propFoot({ kind: 'stand-section', x: 0, y: 0, rotDeg: 0 }).map((v) => Math.round(v * 1e6) / 1e6 + 0), [0, 6]);
  assert.equal(new Set(L.PROP_KINDS).size, L.PROP_KINDS.length, 'no kind twice');
  for (const special of [...L.FLAT_PROP_KINDS, ...L.SPAN_PROP_KINDS, ...L.FLOATING_PROP_KINDS, ...L.SLIM_PROP_KINDS, ...L.WIDE_PROP_KINDS]) assert.ok(L.PROP_KINDS.includes(special), special);
  assert.deepEqual([L.FLAT_PROP_KINDS, L.SPAN_PROP_KINDS, L.FLOATING_PROP_KINDS, L.WIDE_PROP_KINDS].map((k) => [...k]),
    [['target-ring'], ['bridge'], ['balloon', 'blimp', 'fireworks', 'cloud', 'airship', 'bird-flock'], ['crowd']]);
  // a crowd is four times as wide as it is tall, across its facing (east-west at rotDeg 0)
  assert.deepEqual(L.widePropSpan({ x: 10, y: 20, rotDeg: 0, heightM: 3 }), [[4, 20], [16, 20]]);
  assert.deepEqual(L.widePropSpan({ x: 0, y: 0, rotDeg: 90, heightM: 5 }).map((p) => p.map((v) => Math.round(v * 1e6) / 1e6 + 0)), [[0, 10], [0, -10]]);
  const classicHeights = { palm: [7, 12.5], lighthouse: [26, 30], 'rock-arch': [15, 21], volcano: [100, 160] };
  for (const id of Object.keys(BUILT)) {
    const g = newGame(id);
    const seen = new Set();
    for (const p of g.course.props) {
      // (v3:stadium a stand may carry its wedge and base height, and how its crowd is dressed)
      assert.deepEqual(Object.keys(p).filter((k) => !['wedge', 'z', 'text', 'team', 'fill'].includes(k)), ['id', 'kind', 'x', 'y', 'rotDeg', 'heightM'], `${id}: prop fields`);
      if (L.STAND_PROP_KINDS.includes(p.kind)) assert.ok(p.wedge && p.wedge.w > 4 && Number.isFinite(p.z), `${id}: ${p.id} has its wedge and its base height`);
      assert.ok(L.PROP_KINDS.includes(p.kind), `${id}: ${p.kind} has a model`);
      assert.ok(p.id.startsWith(`${g.course.arcade.holes.find((h) => p.id.startsWith(`${h}/`))}/`), `${id}: ${p.id} is named for its hole`);
      assert.ok(!seen.has(p.id), `${id}: ${p.id} once`);
      seen.add(p.id);
      assert.ok([p.x, p.y, p.rotDeg, p.heightM].every(Number.isFinite) && p.heightM > 0);
      // a ring lies flat (on a green, round the pin) and balloons float: anywhere will do
      if (L.FLAT_PROP_KINDS.includes(p.kind) || L.FLOATING_PROP_KINDS.includes(p.kind)) continue;
      const on = g.surfaceAt(...L.propFoot(p));   // v3:stadium (a stand: the ground under its tiers)
      assert.ok(on !== 'green' && on !== 'tee', `${id}: ${p.id} stands on a ${on}`);
      if (L.SPAN_PROP_KINDS.includes(p.kind)) continue;          // a bridge is a deck over whatever it crosses
      if (L.WIDE_PROP_KINDS.includes(p.kind)) {
        // a crowd: dry open ground under its whole width, and all of it off the line
        const [a, b] = L.widePropSpan(p);
        for (let t = 0; t <= 1; t += 0.05) {
          const x = L.lerp(a[0], b[0], t), y = L.lerp(a[1], b[1], t), under = g.surfaceAt(x, y);
          assert.ok(under === 'rough' || under === 'ob', `${id}: ${p.id} reaches onto ${under}`);
          for (const h of g.course.holes) assert.ok(L.distToSegment(x, y, h.tee[0], h.tee[1], h.pin[0], h.pin[1]) >= 8, `${id}: ${p.id} is off hole ${h.ref}'s line`);
        }
        continue;
      }
      assert.ok(on === 'rough' || on === 'ob' || on === 'water', `${id}: ${p.id} stands on ${on}`);
      for (const h of g.course.holes) {
        assert.ok(L.distToSegment(p.x, p.y, h.tee[0], h.tee[1], h.pin[0], h.pin[1]) >= 5, `${id}: ${p.id} is off hole ${h.ref}'s line`);
      }
      if (SINGLES.includes(id) || id === 'arcade-classics') {
        const want = classicHeights[p.kind];          // the four GLB kinds keep their true sizes
        if (want) assert.ok(p.heightM >= want[0] && p.heightM <= want[1], `${id}: ${p.id} is ${p.heightM} m tall`);
      }
    }
  }
  const lagoon = BUILT['lagoon-island'].course, volcano = lagoon.props.find((p) => p.kind === 'volcano');
  assert.ok(dist([volcano.x, volcano.y], lagoon.holes[0].pin) >= 500, 'the volcano is a backdrop, 500 m and more behind the green');
  assert.ok(volcano.y > lagoon.holes[0].pin[1]);
  const lh = BUILT['lighthouse-point'].course, tower = lh.props.find((p) => p.kind === 'lighthouse');
  const away = dist([tower.x, tower.y], lh.holes[0].pin), lhGame = newGame('lighthouse-point');
  assert.ok(away >= 40 && away <= 55, `the lighthouse stands ${away.toFixed(0)} m from the flag`);
  assert.ok(lhGame.terrain.h(tower.x, tower.y) - lhGame.terrain.h(lh.holes[0].pin[0], lh.holes[0].pin[1]) >= 9, 'on its crag, high above the green');
  // facing(): the rotDeg that turns a model's front (south at 0, clockwise from above) to a target
  assert.deepEqual([L.facing(0, 0, 0, -10), L.facing(0, 0, -10, 0), L.facing(0, 0, 0, 10), L.facing(0, 0, 10, 0)], [0, 90, 180, 270]);
});

test('the server\'s activation path takes a hand-made course from the cache, offline', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-arcade-'));
  try {
    for (const { id, course, expect } of Object.values(BUILT)) {
      const written = L.writeCourse(course, dataDir, { expect });
      assert.equal(written.file, `${courseCacheStem(course.source)}.json`);
      assert.match(written.file, /^osm-node-99000000\d{5}\.json$/);
      assert.deepEqual(fs.readdirSync(path.join(dataDir, 'courses')).filter((f) => f.includes('.tmp')), [], 'no temporary file left behind');
      // what `POST /api/load-course {cached}` and `{osmType, osmId}` read back
      const cached = courseLib.readSourceKeyedCache({ cacheDir: path.join(dataDir, 'courses'), source: course.source });
      assert.deepEqual(cached, course, `${id}: read back from the source-keyed cache`);
      // server.js: prepareCandidate -> game.prepareCourse (curated packs off, as BIRDIE_DISABLE_CURATED=1)
      const game = new Game();
      const candidate = await prepareCourseCandidate({
        baseCourse: cached,
        requestedIdentity: cached.source,
        packsEnabled: false,
        dataDir,
        artDir: null,
        prepareGame: (gameplayCourse, options) => game.prepareCourse(gameplayCourse, options),
      });
      assert.equal(candidate.courseId, course.source.courseId);
      assert.match(candidate.contentRevision, /^[a-f0-9]{64}$/);
      assert.deepEqual(candidate.hdDescriptors, []);
      game.commitPreparedCourse(candidate.preparedGameState);
      assert.equal(game.state().courseName, course.name);
      assert.deepEqual(game.course.props, course.props, `${id}: props reach the played course untouched`);
      assert.deepEqual(game.course.arcade, course.arcade);
      assert.deepEqual(game.course.holes.map((h) => [h.par, h.name, h.lengthYd]), course.holes.map((h) => [h.par, h.name, h.lengthYd]), `${id}: no scorecard research rewrites it`);
      // an HD bundle could be fingerprinted against it like any other course
      assert.match(courseFingerprintFor(cached, { version: 2 }), /^[a-f0-9]{64}$/);
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a Rocket ball makes the hero lines (when the arcade layer is present)', (t) => {
  let rocket = null;
  try { rocket = require('../lib/arcade').POWERUPS.find((p) => p.id === 'rocket'); } catch (_) { /* no arcade layer in this tree */ }
  if (!rocket || typeof rocket.launchMods !== 'function' || !rocket.physicsOpts) return t.skip('lib/arcade.js has no Rocket power-up');
  for (const id of ['canyon-run', 'lighthouse-point']) {
    const g = newGame(id);
    const h = g.hole;
    // some club, boosted and aimed at the flag, comes down dry within 40 yd of it
    const finishes = Object.keys(CLUB_FULL).filter((k) => k !== 'PT').map((k) => {
      const launch = rocket.launchMods({ speedMph: CLUB_FULL[k].speedMph, vla: CLUB_FULL[k].vla, hla: 0, totalSpin: CLUB_FULL[k].spin, spinAxis: 0 });
      const sim = simulateShot(launch, { x: h.tee[0], y: h.tee[1] }, g.aimDeg, g.surfaceAt, { terrain: g.terrain, pin: { x: h.pin[0], y: h.pin[1] }, trees: g.treeObstacles, ...rocket.physicsOpts });
      const wet = sim.endSurface === 'water' || sim.endSurface === 'ob' || sim.events.some((e) => e.type === 'water');
      return { k, wet, leftYd: Math.hypot(h.pin[0] - sim.end.x, h.pin[1] - sim.end.y) / YD, carryYd: sim.carryYd };
    });
    assert.ok(finishes.some((f) => !f.wet && f.leftYd < 40), `${id}: drivable with a Rocket: ${JSON.stringify(finishes.map((f) => [f.k, f.wet ? 'wet' : Math.round(f.leftYd)]))}`);
    assert.ok(finishes.find((f) => f.k === 'DR').wet, `${id}: but a boosted driver flies the green into trouble`);
  }
});

// ---------------------------------------------------------------- holes-c's stages

const aimAt = (g, x, y) => g.setAimOffset(Math.atan2(x - g.ball.x, y - g.ball.y) * 180 / Math.PI - (g.aimDeg - g.aimOffset));
const propsOf = (id, kind) => BUILT[id].course.props.filter((p) => p.kind === kind);
// metres of `kind` across the hole (east to west) at height y, between x0 and x1
function widthAcross(g, kind, y, x0, x1) {
  let w = 0;
  for (let x = x0; x <= x1; x += 0.5) if (g.surfaceAt(x, y) === kind) w += 0.5;
  return w;
}
// A reasonable miss off the tee is never out of bounds: a stock drive started up to 20
// degrees off line, straight or curving the same way.
function assertNoObOffTheTee(id) {
  const swings = [];
  for (let aimOffset = -20; aimOffset <= 20; aimOffset += 5) swings.push({ aimOffset });
  for (const [HLA, SpinAxis] of [[-12, -12], [12, 12], [-8, -25], [8, 25], [-15, 0], [15, 0]]) swings.push({ aimOffset: 0, HLA, SpinAxis });
  const out = {};
  for (const { aimOffset, ...extra } of swings) {
    const g = newGame(id);
    g.setAimOffset(aimOffset);
    const r = g.handleShot(stock('DR', extra), 'DR');
    const label = `${id} driver aimed ${aimOffset} ${JSON.stringify(extra)}`;
    assertSoundShot(g, r, label);
    assert.doesNotMatch(r.note || '', /Out of bounds/, label);
    out[label] = r;
  }
  return Object.values(out);
}

test('holes-c stages carry probes that pin down their hazards and surfaces', () => {
  for (const id of MINE) {
    const { expect } = BUILT[id];
    const kinds = new Set(expect.probes.map((p) => p.kind));
    assert.ok(expect.probes.length >= 12, `${id}: ${expect.probes.length} probes`);
    for (const k of ['fairway', 'bunker', 'rough', 'ob']) assert.ok(kinds.has(k), `${id}: a ${k} probe`);
    assert.equal(kinds.has('water'), id !== 'thunder-dome', `${id}: water probes`);
    const g = newGame(id);
    for (const p of expect.probes) assert.equal(g.surfaceAt(p.at[0], p.at[1]), p.kind, p.what);
  }
});

test('Pharaoh\'s Gate: a drivable par 4 from a bluff: round the Great Sand Sea, over it, or a Rocket to the Upper Court', (t) => {
  const id = 'pharaohs-gate';
  const g0 = newGame(id), hole = g0.hole, piece = CAT.PIECES[id];
  assert.equal(hole.par, 4);
  assert.ok(hole.lengthYd >= 285 && hole.lengthYd <= 305, `${hole.lengthYd} yd round the fairway`);
  const directYd = dist(hole.tee, hole.pin) / YD;
  assert.ok(directYd > 280 && directYd < 292, `${directYd.toFixed(0)} yd straight: a drive from the bluff`);
  const [stats] = BUILT[id].report.stats.holes;
  assert.ok(stats.greenM[0] >= 36 && stats.greenM[1] >= 30, `green ${stats.greenM.join(' x ')} m`);
  assert.ok(stats.greenSlopePct > 0.5 && stats.greenSlopePct < 2, `green slope ${stats.greenSlopePct} %`);
  // the three routes are on the hole card; the desert has its own wind
  assert.deepEqual(hole.routes.map((r) => r.id), ['safe', 'risky', 'rocket']);
  assert.deepEqual(BUILT[id].course.arcade.wind, piece.stage.wind);
  assert.ok(piece.stage.wind.min >= 4 && piece.stage.wind.max <= 16, 'open desert: a steady wind, never a gale');

  // elevation: a bluff 22 m above the desert with its lip at the front of the tee, the green under
  // the escarpment, the Upper Court 26 m above the green, the cliff city 70 m above that
  const h = (x, y) => g0.terrain.h(x, y);
  assert.ok(stats.teeHeightM - h(0, 60) > 18 && stats.teeHeightM - h(0, 36) > 14, 'the tee is on a bluff, and the ground falls away straight off its front');
  assert.ok(h(16, 327) - stats.pinHeightM > 24, `the Upper Court is ${(h(16, 327) - stats.pinHeightM).toFixed(0)} m above the green`);
  assert.ok(h(16, 300) - h(16, 284) > 20, 'the escarpment stands straight behind the green');
  assert.ok(h(16, 412) - h(16, 327) > 60, 'and the cliff city above the court');
  let top = 0;
  for (const v of g0.course.elevation.heights) top = Math.max(top, v);
  assert.ok(top > 95 && top < 118, `the city stands ${top.toFixed(0)} m above the oasis`);

  // RISKY: the direct line is desert, then sand from about 126 yd, the Gate Pool, the apron, the green
  const line = directLine(g0, hole);
  const sand0 = line.indexOf('bunker'), wet0 = line.indexOf('water'), wet1 = line.lastIndexOf('water');
  assert.ok(sand0 / YD > 118 && sand0 / YD < 135, `the Great Sand Sea begins ${(sand0 / YD).toFixed(0)} yd out`);
  assert.ok(line.slice(sand0, wet0).every((s) => s === 'bunker'), 'sand all the way to the pool');
  assert.ok(wet0 / YD > 214 && wet0 / YD < 228, `the Gate Pool begins ${(wet0 / YD).toFixed(0)} yd out`);
  assert.ok(line.slice(wet0, wet1 + 1).every((s) => s === 'water'));
  assert.ok(wet1 / YD > 240 && wet1 / YD < 250, `and is carried at ${(wet1 / YD).toFixed(0)} yd`);
  assert.ok(line.slice(wet1 + 8).every((s) => s === 'fairway' || s === 'green'), 'beyond its bank: the apron, then the green');
  assert.equal(line[line.length - 1], 'green');
  assert.ok(h(16, 213) < h(16, 238) - 1, 'the pool lies below the apron');

  // SAFE: a wide left fairway, a tighter right one, sand between them
  assert.ok(widthAcross(g0, 'fairway', 120, -90, 0) >= 44, `left fairway ${widthAcross(g0, 'fairway', 120, -90, 0)} m wide`);
  assert.ok(widthAcross(g0, 'fairway', 175, -100, -18) >= 44, 'and still wide beside the sand');
  const right = widthAcross(g0, 'fairway', 120, 0, 100);
  assert.ok(right >= 30 && right < widthAcross(g0, 'fairway', 120, -90, 0), `right fairway ${right} m wide: the tighter side`);
  assert.ok(widthAcross(g0, 'bunker', 160, -40, 40) >= 40, 'the Great Sand Sea is 40 m and more across');
  for (let m = 70; m < L.polylineLength(hole.line) - 20; m += 4) {
    const p = routePoint(hole, m);
    assert.ok(['fairway', 'rough'].includes(g0.surfaceAt(p[0], p[1])), `the route is ${g0.surfaceAt(p[0], p[1])} ${m} m along`);
  }
  // ROCKET: the Upper Court is mown, straight on over the flag, and so is the city roof far above it
  assert.equal(g0.surfaceAt(16, 327), 'fairway');
  assert.equal(g0.surfaceAt(22, 412), 'fairway');
  assert.ok(dist([16, 327], hole.pin) / YD > 60 && dist([16, 327], hole.pin) / YD < 85, 'the court is a flick from the flag');

  // every stock club at the flag: a sound result. Only a driver gets there; a 3-wood just clears the pool.
  const lies = {};
  for (const k of Object.keys(CLUB_FULL)) {
    if (k === 'PT') continue;
    const g = newGame(id);
    const r = g.handleShot(stock(k), k);
    assertSoundShot(g, r, `${id} ${k} at the flag`);
    lies[k] = r.penalty ? 'water' : r.lie;
    if (k === 'DR') {
      assert.equal(r.penalty, 0, 'the hero line: a stock drive carries the sand and the pool');
      assert.ok(r.holed || r.lie === 'green' || r.distToPinYd < 15, `and finishes ${r.distToPinYd} yd from the flag on ${r.lie}`);
    }
    if (r.penalty) {
      assert.match(r.note, /^Water/);
      assert.equal(g.lie, 'bunker', 'the drop is back in the sand');
      assert.ok(r.distToPinYd > 50, `with ${r.distToPinYd} yd still to go`);
    }
  }
  assert.equal(lies.H3, 'water', `a hybrid at the flag is in the Gate Pool: ${JSON.stringify(lies)}`);
  assert.ok(['I4', 'I5', 'I6', 'I7', 'I8', 'I9'].every((k) => lies[k] === 'bunker'), `irons at the flag find the sand: ${JSON.stringify(lies)}`);
  // an average drive (135 mph) is in the pool; 150 mph makes it
  const average = newGame(id), averageShot = average.handleShot({ Speed: 135, VLA: 13, HLA: 0, TotalSpin: 2800, SpinAxis: 0 }, 'DR');
  assert.equal(averageShot.penalty, 1, 'a 135 mph drive at the flag is wet');
  const strong = newGame(id), strongShot = strong.handleShot({ Speed: 150, VLA: 12, HLA: 0, TotalSpin: 2500, SpinAxis: 0 }, 'DR');
  assert.ok(strongShot.penalty === 0 && (strongShot.holed || strongShot.lie === 'green'), `a 150 mph drive at the flag is on the green (${strongShot.lie})`);
  assert.ok(strongShot.sim.carryYd > 262, `carry ${strongShot.sim.carryYd} yd from the bluff`);

  // safe: a hybrid up the left fairway, then home in par or better
  const safe = newGame(id);
  aimAt(safe, -41.6, 136);
  const lay = safe.handleShot(stock('H3'), 'H3');
  assertSoundShot(safe, lay, `${id} hybrid up the left`);
  assert.equal(lay.lie, 'fairway');
  assert.equal(lay.penalty, 0);
  assert.ok(lay.distToPinYd > 35 && lay.distToPinYd < 130, `leaving ${lay.distToPinYd} yd`);   // v3:gadgets (the Caravan Road, a speed strip, runs it on toward the turn: 42 yd left, was 70 to 130)
  const strokes = playHole(safe, id);
  assert.ok(strokes >= 2 && strokes <= 4, `home in ${strokes} by the left fairway`);
  // a long drive up the left still finds fairway (it runs on past the turn)
  const long = newGame(id);
  aimAt(long, -46, 150);
  assert.equal(long.handleShot(stock('DR'), 'DR').lie, 'fairway');
  // the right fairway: shorter, and the caddie still makes par from it
  const tight = newGame(id);
  aimAt(tight, 58, 150);
  const hybrid = tight.handleShot(stock('H3'), 'H3');
  assert.equal(hybrid.lie, 'fairway');
  assert.ok(hybrid.distToPinYd < 100, `the right side leaves a wedge (${hybrid.distToPinYd} yd)`);   // v3:gadgets (was: less than the left lay-up leaves; the Caravan Road, a speed strip, now runs that one on to 42 yd)
  assert.ok(playHole(tight, id) <= 4);
  // from the tee the caddie makes par at worst, and the hole ends the round
  const fresh = newGame(id);
  assert.ok(playHole(fresh, id) <= 4);
  assert.equal(fresh.state().over, true);

  // a reasonable miss is never out of bounds; a 25 degree slice is in the oasis
  const misses = assertNoObOffTheTee(id);
  assert.ok(misses.filter((r) => r.penalty).length <= 2, 'and nearly all of them are dry');
  const wild = newGame(id);
  wild.setAimOffset(25);
  assert.match(wild.handleShot(stock('DR'), 'DR').note, /^Water/, 'the oasis catches the wild one');

  // the wind at its strongest, from every side: the 150 mph drive still carries the pool, and the left fairway still holds a hybrid
  const windy = (relDeg) => {
    const g = newGame(id), bearing = Math.atan2(hole.pin[0] - hole.tee[0], hole.pin[1] - hole.tee[1]) * 180 / Math.PI;
    g.setConditions({ windMph: piece.stage.wind.max, windFromDeg: ((bearing + relDeg) % 360 + 360) % 360, gustMph: 0 });
    return g;
  };
  for (const rel of [0, 90, 180, 270]) {
    const g = windy(rel);
    const r = g.handleShot({ Speed: 150, VLA: 12, HLA: 0, TotalSpin: 2500, SpinAxis: 0 }, 'DR');
    assertSoundShot(g, r, `hero drive, wind from ${rel}`);
    assert.equal(r.penalty, 0, `the carry is on in ${piece.stage.wind.max} mph from ${rel} degrees off the line (carry ${r.sim.carryYd} yd)`);
    assert.ok(r.distToPinYd < 40, `${r.distToPinYd} yd left on ${r.lie}`);
    const s = windy(rel);
    aimAt(s, -41.6, 136);
    const l = s.handleShot(stock('H3'), 'H3');
    assert.equal(l.penalty, 0);
    assert.ok(['fairway', 'rough'].includes(l.lie) && l.distToPinYd < 150, `the safe hybrid in the wind is on ${l.lie}, ${l.distToPinYd} yd out`);
  }
  assert.equal(windy(0).handleShot({ Speed: 135, VLA: 13, HLA: 0, TotalSpin: 2800, SpinAxis: 0 }, 'DR').lie !== 'green', true, 'into the wind an average drive does not reach');

  // the theme, in vignettes: the gate of obelisks and four colossi at the green, pyramids at several
  // scales, the Upper Court's avenue and the city gate, the oasis, the caravan camp, a sphinx, cacti
  const pin = hole.pin, pyramids = propsOf(id, 'pyramid');
  assert.ok(pyramids.length >= 6, `${pyramids.length} pyramids`);
  const flanking = pyramids.filter((p) => p.heightM >= 50 && dist([p.x, p.y], pin) < 160);
  assert.equal(flanking.length, 2);
  assert.ok(flanking.some((p) => p.x < pin[0] - 60) && flanking.some((p) => p.x > pin[0] + 60) && flanking.every((p) => p.y > pin[1] + 40), 'a great pyramid either side of the court, above the green');
  assert.ok(pyramids.some((p) => dist([p.x, p.y], pin) > 240 && p.heightM >= 80), 'one beyond the city');
  assert.ok(pyramids.filter((p) => p.heightM < 40).length >= 3, 'and small ones out in the dunes');
  const obelisks = propsOf(id, 'obelisk');
  assert.ok(obelisks.filter((p) => p.y > 222 && p.y < 245).length === 2, 'the gate: an obelisk either side of the apron');
  assert.ok(obelisks.filter((p) => p.y > 300 && p.y < 350).length >= 6, 'an avenue of obelisks down the Upper Court');
  assert.ok(propsOf(id, 'statue').filter((p) => p.y > 284 && p.y < 296).length === 4, 'four colossi against the escarpment behind the green');
  assert.equal(propsOf(id, 'gate').length, 1);
  assert.equal(propsOf(id, 'sphinx').length, 1);
  assert.ok(propsOf(id, 'hut').length >= 8 && propsOf(id, 'tower').length >= 4 && propsOf(id, 'fountain').length >= 2, 'the camp, the oasis and the city wall');
  assert.ok(propsOf(id, 'cactus').length >= 30 && propsOf(id, 'palm').length >= 8 && propsOf(id, 'torch').length >= 8);
  assert.ok(propsOf(id, 'crowd').length >= 6 && propsOf(id, 'jumbotron').length === 1 && propsOf(id, 'grandstand').length === 1, 'the green is an event');
  const n = BUILT[id].course.props.length;
  assert.ok(n >= 120 && n <= 250, `${n} props`);

  // ROCKET: only a boosted ball gets up to the court (and the best of them onto the city roof); from
  // either it is a flick straight down at the flag
  let mods = null;
  try { mods = require('../lib/arcade').modifiersFor('rocket'); } catch (_) { /* no arcade layer in this tree */ }
  if (!mods || mods.id !== 'rocket') { t.diagnostic('lib/arcade.js has no Rocket to test with: skipped the rocket route'); return; }
  const rocket = (launch, wind = null) => {
    const g = wind === null ? newGame(id) : windy(wind);
    g.shotMods = mods;
    const r = g.handleShot(launch, 'DR');
    g.shotMods = null;
    assertSoundShot(g, r, `Rocket ${launch.Speed} mph`);
    return { g, r };
  };
  const drive = (Speed, VLA, TotalSpin) => ({ Speed, VLA, HLA: 0, TotalSpin, SpinAxis: 0 });
  const onCourt = (g, r) => r.penalty === 0 && r.end.y > 300 && r.end.y < 360 && g.terrain.h(r.end.x, r.end.y) > 30 && g.terrain.h(r.end.x, r.end.y) < 40;
  for (const launch of [drive(135, 13, 2800), drive(120, 14, 3000)]) {
    const { g, r } = rocket(launch);
    assert.ok(r.sim.carryYd > 370, `a Rocket ${launch.Speed} mph drive carries ${r.sim.carryYd} yd`);
    assert.ok(onCourt(g, r), `and comes to rest on the Upper Court: (${r.end.x.toFixed(0)}, ${r.end.y.toFixed(0)}) at ${g.terrain.h(r.end.x, r.end.y).toFixed(0)} m on ${r.lie}`);
    assert.ok(r.distToPinYd > 70 && r.distToPinYd < 115, `${r.distToPinYd} yd above the flag`);
    g.setAimOffset(0);
    const flick = g.handleShot(drive(60, 34, 8000), 'SW');
    assertSoundShot(g, flick, 'the flick down');
    assert.equal(flick.penalty, 0);
    assert.ok(flick.holed || flick.distToPinYd < 20, `the flick finishes ${flick.distToPinYd} yd from the flag on ${flick.lie}`);
  }
  // the biggest Rocket comes down on the city roof, 100 m up: still in play, still a wedge straight down
  const roof = rocket(drive(150, 12, 2500));
  assert.equal(roof.r.penalty, 0);
  assert.ok(roof.r.end.y > 384 && roof.g.terrain.h(roof.r.end.x, roof.r.end.y) > 100, `a Rocket 150 mph drive is on the roof: (${roof.r.end.x.toFixed(0)}, ${roof.r.end.y.toFixed(0)})`);
  roof.g.setAimOffset(0);
  const down = roof.g.handleShot(drive(60, 34, 8000), 'SW');
  assert.ok(down.penalty === 0 && (down.holed || down.distToPinYd < 25), `and a half wedge off the roof finishes ${down.distToPinYd} yd from the flag`);
  // into the strongest wind the 150 mph Rocket is held up onto the court instead
  const held = rocket(drive(150, 12, 2500), 0);
  assert.ok(onCourt(held.g, held.r), `into the wind: (${held.r.end.x.toFixed(0)}, ${held.r.end.y.toFixed(0)}) on ${held.r.lie}`);
  // no ordinary swing gets up there: 165 mph at the flag is down by the green
  const big = newGame(id), bigShot = big.handleShot(drive(165, 12, 2500), 'DR');
  assert.ok(big.terrain.h(bigShot.end.x, bigShot.end.y) < 12 && bigShot.end.y < 290, `165 mph finishes at (${bigShot.end.x.toFixed(0)}, ${bigShot.end.y.toFixed(0)})`);
});

test('Midnight Mile: the finale, three routes round a harbour to a stadium green behind a moat', () => {
  const id = 'midnight-mile';
  const piece = require('../tools/arcade-holes/holes/midnight-mile');
  const { city } = piece;
  const g0 = newGame(id), hole = g0.hole, pin = hole.pin, h = (x, y) => g0.terrain.h(x, y);
  assert.equal(hole.par, 5);
  assert.ok(hole.lengthYd >= 530 && hole.lengthYd <= 560, `${hole.lengthYd} yd`);
  assert.equal(STAGES.find((s) => s.stage.role === 'match' && s.stage.order === 9).id, id, 'the ninth and last stage of the tour');
  const [stats] = BUILT[id].report.stats.holes;
  assert.ok(stats.greenM[0] >= 38 && stats.greenM[1] >= 30, `green ${stats.greenM.join(' x ')} m`);
  assert.ok(stats.greenSlopePct > 0.5 && stats.greenSlopePct < 2, `green slope ${stats.greenSlopePct} %`);

  // the three routes are written on the hole, safe first
  assert.deepEqual(hole.routes.map((r) => r.id), ['safe', 'risky', 'rocket']);
  assert.deepEqual(hole.routes.map((r) => r.name), ['The Boulevard', 'The Docks', 'The Helipad']);
  for (const r of hole.routes) assert.ok(r.note.length > 40 && r.note.length < 200, `${r.id}: a note for the stage intro`);

  // a city on levels: the tee on a roof, the Skyway a terrace above the street, the Docks down on the quay,
  // the water below that, the helipad on a roof of its own, the green sunk in its stadium
  assert.ok(stats.teeHeightM - h(6, 60) > 24, `the tee is ${(stats.teeHeightM - h(6, 60)).toFixed(0)} m above the street`);
  assert.ok(h(34, 240) - h(20, 100) > 3, 'the Skyway is a terrace above the street');
  assert.ok(h(34, 240) - h(-60, 240) > 7, 'the Docks lie well below it');
  assert.ok(h(-60, 240) - h(-120, 180) > 3, 'and the water below the Docks');
  assert.ok(h(-172, 329) - h(-60, 240) > 24, 'the helipad is a roof');
  assert.ok(h(-172, 355) - h(-172, 305) > 5, 'tilted to face the tee');
  assert.ok(h(-10, 383) - stats.pinHeightM > 5, 'the last shot of the safe way is down into the stadium');
  const el = g0.course.elevation;
  assert.ok(Math.max(...el.heights) - Math.min(...el.heights) >= 35, 'real relief');
  // the water: canal, basin, the arm under the Skyway, the moat: one level sheet
  for (let y = -60; y <= 110; y += 10) assert.equal(g0.surfaceAt(-41, y), 'water', `canal at y ${y}`);
  for (const [x, y, what] of [[-120, 180, 'the basin'], [-14, 250, 'the arm under the Skyway'], [-150, 270, 'the west arm'], [-110, 375, 'the moat']]) {
    assert.equal(g0.surfaceAt(x, y), 'water', what);
    assert.equal(h(x, y), h(-41, 0), `${what} is level with the canal`);
  }
  // from the tee the three targets and the flag are all in view of the address camera
  for (const [x, y, what] of [[34, 222, 'the Boulevard'], [-60, 240, 'the Docks'], [-172, 329, 'the Helipad'], [pin[0], pin[1], 'the flag']]) {
    assert.ok(teeCameraClearance(g0, x, y) > 0.25, `${what} is in view from the tee`);
  }

  // ---- SAFE, the Boulevard: mown and dry along the whole routing line, never a carry
  for (let m = 60; m < L.polylineLength(hole.line); m += 2) {
    const p = routePoint(hole, m);
    assert.ok(['fairway', 'green'].includes(g0.surfaceAt(p[0], p[1])), `the routing line ${m} m out is on ${g0.surfaceAt(p[0], p[1])}`);
  }
  for (const y of [150, 200, 230, 260, 300]) assert.ok(widthAcross(g0, 'fairway', y, -10, 90) >= 50, `the Boulevard is ${widthAcross(g0, 'fairway', y, -10, 90)} m wide at y ${y}`);
  // every stock club up the Boulevard is dry, and the long ones find the fairway
  for (const k of Object.keys(CLUB_FULL)) {
    if (k === 'PT') continue;
    const g = newGame(id);
    aimAlongRoute(g, 222);
    const r = g.handleShot(stock(k), k);
    assertSoundShot(g, r, `${id} ${k} up the Boulevard`);
    assert.equal(r.penalty, 0, `${k} up the Boulevard`);
    if (['DR', 'W3', 'H3', 'I4', 'I5', 'I6', 'I7'].includes(k)) assert.equal(r.lie, 'fairway', `${k} up the Boulevard`);
  }
  // three shots: a drive, a short iron along the Skyway, a wedge down into the stadium
  const safe = newGame(id);
  aimAlongRoute(safe, 222);
  assert.equal(safe.handleShot(stock('DR'), 'DR').lie, 'fairway');
  aimAt(safe, hole.line[2][0], hole.line[2][1]);
  const second = safe.handleShot(stock('I9'), 'I9');
  assertSoundShot(safe, second, `${id} along the Skyway`);
  assert.equal(second.lie, 'fairway');
  assert.ok(second.distToPinYd > 80 && second.distToPinYd < 150, `leaving ${second.distToPinYd} yd`);
  const strokes = playHole(safe, id);
  assert.ok(strokes >= 3 && strokes <= 5, `home in ${strokes} the safe way`);
  // a reasonable miss off the tee is never out of bounds
  assertNoObOffTheTee(id);

  // ---- RISKY, the Docks: straight at the flag is all carry over the basin to the low quay
  const line = directLine(g0, hole);
  const wet0 = line.indexOf('water'), dock0 = line.indexOf('fairway', wet0);
  assert.ok(wet0 < 110, `water from ${wet0} m`);
  assert.ok(line.slice(wet0, dock0).every((s) => s === 'water' || s === 'rough') && line.slice(wet0, dock0).filter((s) => s === 'water').length > 90, 'the basin');
  assert.ok(dock0 / YD > 205 && dock0 / YD < 225, `the Docks begin ${(dock0 / YD).toFixed(0)} yd out`);
  assert.ok(line.slice(dock0, dock0 + 140).every((s) => s === 'fairway'), '150 yd of lower fairway');
  const moat = line.lastIndexOf('water');
  assert.ok(moat > dock0 + 150 && line.length - moat > 28 && line.length - moat < 45, 'then the moat, 30 to 45 m short of the flag');
  assert.ok(widthAcross(g0, 'fairway', 250, -120, -30) >= 45, `the Docks are ${widthAcross(g0, 'fairway', 250, -120, -30)} m wide`);
  assert.ok(widthAcross(g0, 'water', 250, -30, 5) >= 15 && widthAcross(g0, 'water', 250, -200, -100) >= 60, 'water either side of them');
  // a stock drive and a mid iron, both at the flag, are on the green in two
  const risky = newGame(id);
  const drive = risky.handleShot(stock('DR'), 'DR');
  assertSoundShot(risky, drive, `${id} drive at the Docks`);
  assert.equal(drive.lie, 'fairway');
  assert.ok(risky.ball.x < -30 && h(risky.ball.x, risky.ball.y) < 3, 'on the Docks');
  assert.ok(drive.distToPinYd > 140 && drive.distToPinYd < 200, `leaving ${drive.distToPinYd} yd: a mid iron`);
  const iron = risky.handleShot(stock('I6'), 'I6');
  assertSoundShot(risky, iron, `${id} iron over the moat`);
  assert.equal(iron.penalty, 0);
  assert.equal(iron.lie, 'green', `on in two: ${iron.distToPinYd} yd away on ${iron.lie}`);
  assert.ok(playHole(risky, id) <= 4, 'an eagle or a birdie');
  // an average drive (137 mph) makes the carry too, and a hybrid reaches
  const average = newGame(id);
  assert.equal(average.handleShot(stock('DR', { Speed: 137 }), 'DR').lie, 'fairway');
  const hybrid = average.handleShot(stock('H3'), 'H3');
  assert.equal(hybrid.penalty, 0);
  assert.ok(hybrid.lie === 'green' || hybrid.distToPinYd < 20, `a hybrid from the Docks: ${hybrid.distToPinYd} yd on ${hybrid.lie}`);
  // ... and it costs a stroke when it does not come off: short, pushed, or the iron hit fat
  for (const [what, extra] of [['a weak drive', { Speed: 114 }], ['a push', { HLA: 6 }]]) {
    const g = newGame(id);
    const r = g.handleShot(stock('DR', extra), 'DR');
    assertSoundShot(g, r, `${id} ${what}`);
    assert.equal(r.penalty, 1, `${what} at the Docks is wet`);
    assert.match(r.note, /^Water/);
  }
  const fat = newGame(id);
  fat.handleShot(stock('DR'), 'DR');
  assert.equal(fat.handleShot(stock('I6', { Speed: 100 }), 'I6').penalty, 1, 'a fat iron from the Docks finds the moat');

  // ---- ROCKET, the Helipad: a fairway on a roof in the harbour (the Rocket test below flies it)
  assert.ok(widthAcross(g0, 'fairway', 329, -215, -130) >= 55 && [304, 320, 340, 354].every((y) => g0.surfaceAt(-172, y) === 'fairway'), 'a fairway 56 m square on the roof');
  assert.ok([[-172, 286], [-130, 329], [-172, 372]].every(([x, y]) => g0.surfaceAt(x, y) === 'water'), 'water round its foot');
  assert.ok(h(-172, 296) - h(-172, 302) > 1, 'a parapet at its edge');
  const padYd = dist(hole.tee, [-172, 329]) / YD;
  assert.ok(padYd > 395 && padYd < 420, `the middle of the helipad is ${padYd.toFixed(0)} yd from the tee`);
  // from the roof a stock sand wedge at the flag is on the green
  const wedge = simulateShot({ speedMph: CLUB_FULL.SW.speedMph, vla: CLUB_FULL.SW.vla, hla: 0, totalSpin: CLUB_FULL.SW.spin, spinAxis: 0 }, { x: -172, y: 329 },
    Math.atan2(pin[0] + 172, pin[1] - 329) * 180 / Math.PI, g0.surfaceAt, { terrain: g0.terrain, pin: { x: pin[0], y: pin[1] }, trees: g0.treeObstacles });
  assert.equal(wedge.endSurface, 'green', 'a wedge straight down at the flag');
  assert.ok(dist([wedge.end.x, wedge.end.y], pin) / YD < 15);

  // ---- the wind (stage.wind, 6 to 14 mph): dead against at its strongest, the safe way is still three
  // shots and the Docks still two, with more club
  assert.deepEqual(piece.stage.wind, { min: 6, max: 14 });
  const against = Math.round((Math.atan2(pin[0], pin[1]) * 180 / Math.PI + 360) % 360);
  const windy = () => { const g = newGame(id); g.setConditions({ windMph: piece.stage.wind.max, windFromDeg: against }); return g; };
  const thirds = ['PW', 'I9', 'I8', 'I7'].map((k) => {
    const w1 = windy();
    aimAlongRoute(w1, 222);
    assert.equal(w1.handleShot(stock('DR'), 'DR').lie, 'fairway');
    aimAt(w1, hole.line[2][0], hole.line[2][1]);
    assert.equal(w1.handleShot(stock('I5'), 'I5').lie, 'fairway');
    w1.setAimOffset(0);
    const r = w1.handleShot(stock(k), k);
    return { k, on: r.penalty === 0 && r.lie === 'green', yd: r.distToPinYd, lie: r.lie };
  });
  assert.ok(thirds.some((t) => t.on), `into the wind, the safe way is on in three with the right short iron: ${JSON.stringify(thirds)}`);
  const w2 = windy();
  assert.equal(w2.handleShot(stock('DR'), 'DR').lie, 'fairway', 'a stock drive still makes the Docks into the wind');
  const w2second = w2.handleShot(stock('W3'), 'W3');
  assert.ok(w2second.penalty === 0 && w2second.lie === 'green', `and a 3-wood is on in two (${w2second.distToPinYd} yd on ${w2second.lie})`);

  // ---- the city: a skyline canyon at several scales, neon and screens facing the players, a harbour, a stadium
  const count = (kind, where = () => true) => propsOf(id, kind).filter(where).length;
  assert.ok(BUILT[id].course.props.length >= 150 && BUILT[id].course.props.length <= 300, `${BUILT[id].course.props.length} props`);
  const towers = propsOf(id, 'skyscraper');
  assert.ok(towers.length >= 55 && towers.some((p) => p.heightM >= 250), 'a skyline');
  assert.ok(towers.filter((p) => p.heightM < 80).length >= 15 && towers.filter((p) => p.heightM >= 80 && p.heightM < 150).length >= 15 && towers.filter((p) => p.heightM >= 150).length >= 10, 'at several scales');
  assert.ok(towers.filter((p) => p.x > 50).length >= 15 && towers.filter((p) => p.x < -220).length >= 12 && towers.filter((p) => p.y > 540).length >= 5 && towers.filter((p) => p.y < -20).length >= 5, 'on every side');
  assert.ok(towers.every((p) => ['rough', 'ob'].includes(g0.surfaceAt(p.x, p.y))), 'none of them in play or in the water');
  assert.ok(count('neon-sign') >= 10 && count('billboard') >= 6 && count('jumbotron') >= 4 && count('floodlight') >= 12);
  const bridges = propsOf(id, 'bridge');
  assert.equal(bridges.length, 3);
  for (const b of bridges) {
    assert.equal(g0.surfaceAt(b.x, b.y), 'water', 'a bridge stands over the canal');
    assert.equal(b.rotDeg, 90, 'spanning east to west');
    assert.ok(b.heightM >= widthAcross(g0, 'water', b.y, -80, 0), 'its length (heightM) spans the water');
  }
  assert.ok(count('boat') >= 10 && count('boat', (p) => g0.surfaceAt(p.x, p.y) !== 'water') === 0 && count('fountain', (p) => g0.surfaceAt(p.x, p.y) === 'water') >= 4, 'boats and fountains in the harbour');
  // the stadium (v3:stadium): an arc of the stadium kit's sections on the foot of the terrace wall, round the back of the green,
  // standing on the terraces (which are still ground, level, a step above one another)
  for (let k = 0; k < city.stand.n; k++) {
    const heights = [40, 76, 112, 148, 184].map((deg) => h(city.green[0] + city.standR(k) * Math.cos(deg * Math.PI / 180), city.green[1] + city.standR(k) * Math.sin(deg * Math.PI / 180)));
    assert.ok(Math.max(...heights) - Math.min(...heights) < 0.4, `terrace ${k + 1} is level`);
    if (k) assert.ok(Math.min(...heights) - stats.pinHeightM > 2.2 + 3 * k, `terrace ${k + 1} is a step above the last`);
  }
  const sections = BUILT[id].course.props.filter((p) => L.STAND_PROP_KINDS.includes(p.kind));
  assert.equal(sections.length, 7, 'seven sections');
  assert.ok(sections.every((p) => Math.abs(dist([p.x, p.y], city.green) - city.stand.fromR) < 2.5), 'on the foot of the terrace wall');
  assert.ok(sections.filter((p) => p.y > pin[1]).length >= 5, 'most of them behind the green');
  assert.deepEqual(sections.map((p) => p.kind), ['stand-corner', 'stand-section', 'stand-section', 'stand-section', 'stand-section', 'stand-section', 'stand-corner'], 'a pylon at each end of the arc');
  assert.ok(count('fireworks') >= 6 && count('airship') === 1 && count('blimp') === 1 && count('statue') >= 2 && count('flag-banner') >= 20);
});

test('Thunder Dome: a stadium, the stands on terraces all the way round, nothing wet and nothing hidden', () => {
  const id = 'thunder-dome';
  const piece = require('../tools/arcade-holes/holes/thunder-dome');
  const { arena } = piece;
  const g0 = newGame(id), hole = g0.hole, pin = hole.pin, h = (x, y) => g0.terrain.h(x, y);
  assert.equal(hole.par, 3);
  assert.ok(hole.lengthYd >= 135 && hole.lengthYd <= 145, `${hole.lengthYd} yd`);
  assert.equal(hole.line.length, 2, 'straight');
  const [stats] = BUILT[id].report.stats.holes;
  assert.ok(stats.greenM[0] >= 36 && stats.greenM[1] >= 36, `green ${stats.greenM.join(' x ')} m: 34 m and more across`);
  assert.ok(stats.greenSlopePct < 1.5, `all but level: ${stats.greenSlopePct} %`);
  // 17 m of green all round the cup
  for (let a = 0; a < 360; a += 15) assert.equal(g0.surfaceAt(pin[0] + 17 * Math.cos(a * Math.PI / 180), pin[1] + 17 * Math.sin(a * Math.PI / 180)), 'green');

  // nothing wet: no water polygon, no sea, not a wet metre on the grid
  assert.equal(g0.course.surfaces.some((s) => s.kind === 'water'), false);
  assert.equal(BUILT[id].report.stats.sea, null);
  const el = g0.course.elevation;
  const seen = new Set();
  for (let y = el.minY; y <= el.minY + (el.ny - 1) * el.cellM; y += 3) for (let x = el.minX; x <= el.minX + (el.nx - 1) * el.cellM; x += 3) seen.add(g0.surfaceAt(x, y));
  assert.deepEqual([...seen].sort(), ['bunker', 'fairway', 'green', 'ob', 'rough', 'tee']);
  // nothing hidden: beyond the foot of the stage the whole line is mown, and the tee is a stage ten
  // metres above the pitch with the green in plain view of the address camera
  const line = directLine(g0, hole);
  assert.ok(line.slice(32).every((s) => s === 'fairway' || s === 'green'));
  const drop = stats.teeHeightM - stats.pinHeightM;
  assert.ok(drop > 9 && drop < 12, `the tee stands ${drop.toFixed(1)} m above the green`);
  assert.ok(teeCameraClearance(g0, pin[0], pin[1]) > 0.25, 'the flag is in view from the tee');
  for (let a = 0; a < 360; a += 30) assert.ok(teeCameraClearance(g0, pin[0] + 19 * Math.cos(a * Math.PI / 180), pin[1] + 19 * Math.sin(a * Math.PI / 180)) > 0.25, `the green at ${a} degrees is in view`);

  // the stands are ground: five level terraces stepping up from the pitch wall to the rim, all the way
  // round (but for the tee stage and the tunnel in the south), every one of them in play
  const ring = (d, deg) => {
    const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180), n = Math.hypot(c / arena.bowl[0], s / arena.bowl[1]);
    return [arena.mid[0] + arena.bowl[0] * c + d * (c / arena.bowl[0]) / n, arena.mid[1] + arena.bowl[1] * s + d * (s / arena.bowl[1]) / n];
  };
  assert.equal(arena.tier.n, 5);
  for (let a = -60; a <= 240; a += 15) {
    for (let k = 0; k < arena.tier.n; k++) {
      const d = arena.tierD(k);
      assert.ok(Math.abs(h(...ring(d, a)) - arena.tierH(k)) < 0.15, `terrace ${k + 1} at ${a} degrees stands ${h(...ring(d, a)).toFixed(1)} m`);
      assert.ok(Math.abs(h(...ring(d + 1.5, a)) - h(...ring(d - 1.5, a))) < 0.15, `terrace ${k + 1} at ${a} degrees is level`);
      assert.equal(g0.surfaceAt(...ring(d, a)), 'rough', 'and it is in play');
    }
    assert.ok(Math.abs(h(...ring(arena.concourseD + 8, a)) - arena.rimH) < 0.15, `the rim at ${a} degrees`);
    assert.equal(g0.surfaceAt(...ring(arena.concourseD + 8, a)), 'rough', 'the rim is in play');
  }
  assert.ok(arena.rimH - stats.pinHeightM > 18, `the rim stands ${(arena.rimH - stats.pinHeightM).toFixed(0)} m above the green`);
  assert.ok(Math.abs(arena.tierH(1) - arena.tierH(0) - 3.6) < 0.01 && arena.tier.depthM >= 7, 'each step 3.6 m up and wide enough to stand a crowd on');
  // the tunnel: cut through the south stand at the level of the stage, walls above it either side
  assert.ok(Math.abs(h(0, -40) - arena.stageH) < 0.1 && Math.abs(stats.teeHeightM - arena.stageH) < 0.01);
  assert.ok(h(-14, -40) - arena.stageH > 6 && h(14, -40) - arena.stageH > 6, 'the tunnel has walls');

  // a full house (v3:stadium): the bowl is eighteen sections of the stadium kit on the foot of the pitch wall, from one side of
  // the tunnel round to the other, each with its wedge (test/stadium-kit.test.mjs measures that they close)
  const floor = L.ellipse(arena.mid[0], arena.mid[1], arena.bowl[0], arena.bowl[1], { n: 96 });
  const outside = (p) => -L.signedDistance(p.x, p.y, floor);
  const bearing = (p) => Math.atan2(p.y - arena.mid[1], p.x - arena.mid[0]) * 180 / Math.PI;
  const widestGap = (list) => { const b = list.map(bearing).sort((p, q) => p - q); return Math.max(...b.map((v, i) => (i ? v - b[i - 1] : v + 360 - b[b.length - 1]))); };
  const sections = BUILT[id].course.props.filter((p) => L.STAND_PROP_KINDS.includes(p.kind));
  assert.equal(sections.length, arena.sections);
  assert.ok(sections.every((p) => Math.abs(outside(p)) < 2 && p.z === arena.baseZ), 'every section on the foot of the pitch wall, on one level');
  assert.equal(sections.filter((p) => p.kind === 'stand-corner').length, 4, 'four corners with a pylon');
  assert.ok(widestGap(sections) < 75, `the widest gap in the bowl is ${widestGap(sections).toFixed(0)} degrees (the stage and the tunnel)`);
  assert.ok(sections.every((p) => Math.abs(p.x) >= arena.gapX - 8 || p.y > 30), 'none of them over the stage or the tunnel');
  assert.equal(sections.map((p) => p.text || ' ').reverse().join('').trim().replace(/ +/g, ' '), 'SIM CLASH DOME', 'the crowd spells it, west to east');
  // behind the stage: a small roofed stand on the rim either side of the tunnel, galleries on the bank below them
  const stands = propsOf(id, 'grandstand'), screens = propsOf(id, 'jumbotron'), crowd = propsOf(id, 'crowd');
  assert.ok(stands.length === 2 && stands.every((p) => Math.abs(h(p.x, p.y) - arena.rimH) < 0.3 && p.y < -20), 'two stands on the rim behind the stage');
  assert.ok(crowd.length === 4 && crowd.every((p) => [3, 4].some((k) => Math.abs(outside(p) - arena.tierD(k)) < 1.2 && Math.abs(h(p.x, p.y) - arena.tierH(k)) < 0.2)), 'galleries level on the two upper terraces of the bank');
  assert.ok(widestGap([...sections, ...stands]) < 45, 'stands all the way round but for the tunnel');
  assert.ok(screens.length >= 3 && screens.filter((p) => p.y > pin[1] + 60 && Math.abs(p.x) < 70).length >= 3, 'three screens behind the green');
  const lights = propsOf(id, 'floodlight');
  assert.ok(lights.length >= 12 && lights.every((p) => p.heightM >= 40 && outside(p) > arena.concourseD + 12), 'a ring of floodlights behind the bowl');
  assert.ok(propsOf(id, 'flag-banner').length >= 40 && propsOf(id, 'fireworks').length >= 4 && propsOf(id, 'airship').length === 1 && propsOf(id, 'blimp').length === 1);
  assert.ok(propsOf(id, 'camera-tower').length === 4 && propsOf(id, 'tunnel').length === 1 && propsOf(id, 'podium').length === 1 && propsOf(id, 'led-board').length === 2, 'broadcast towers, the players\' tunnel, the walk-on arch, LED walls at the foot of the stage');
  const [gate] = propsOf(id, 'gate');
  assert.ok(gate && Math.abs(gate.x) < 3 && gate.y < -15 && propsOf(id, 'statue').length === 2, 'the tunnel mouth behind the tee, a trophy either side of the stage');
  assert.ok(BUILT[id].course.props.length >= 150 && BUILT[id].course.props.length <= 300, `${BUILT[id].course.props.length} props`);
  // nothing tall beside the ball: the camera looks straight down the line at the green
  for (const p of BUILT[id].course.props) {
    if (L.FLAT_PROP_KINDS.includes(p.kind) || L.FLOATING_PROP_KINDS.includes(p.kind)) continue;
    assert.ok(Math.abs(p.x) >= 10 || p.y > 150 || p.y < -15, `${p.id} does not stand in the view from the tee`);
  }

  // every stock club off the tee: never a penalty, whatever the club. The 7, 8 and 9 irons and the
  // pitching wedge all hold the green (it plays a club less from the stage).
  const lies = {};
  for (const k of Object.keys(CLUB_FULL)) {
    if (k === 'PT') continue;
    const g = newGame(id);
    const r = g.handleShot(stock(k), k);
    assertSoundShot(g, r, `${id} ${k}`);
    assert.equal(r.penalty, 0, `${k}: nothing to lose a ball in`);
    lies[k] = r.lie;
    if (k === 'I9') assert.ok(r.distToPinYd < 8, `a stock 9 iron finishes ${r.distToPinYd} yd from the flag`);
  }
  assert.ok(['I7', 'I8', 'I9', 'PW'].every((k) => lies[k] === 'green'), `short irons hold the green: ${JSON.stringify(lies)}`);
  assert.ok(['SW', 'LW'].every((k) => lies[k] === 'fairway'), 'short is on the pitch');
  // shanks and big curves stay in the bowl
  for (const extra of [{ HLA: 30 }, { HLA: -30 }, { HLA: 6, SpinAxis: 25 }, { HLA: -6, SpinAxis: -25 }, { VLA: 6, TotalSpin: 3000 }]) {
    const g = newGame(id);
    const r = g.handleShot(stock('I8', extra), 'I8');
    assertSoundShot(g, r, `${id} ${JSON.stringify(extra)}`);
    assert.equal(r.penalty, 0);
    assert.ok(r.distToPinYd < 90, `${JSON.stringify(extra)}: ${r.distToPinYd} yd from the flag`);
  }
  assertNoObOffTheTee(id).forEach((r) => assert.equal(r.penalty, 0));
  const fresh = newGame(id);
  assert.ok(playHole(fresh, id) <= 3);
  // a spray of plausible short irons (speed, start line and curve all off a little): every one scores a
  // distance, most are on the green
  let shots = 0, onGreen = 0;
  for (const k of ['PW', 'I9', 'I8']) for (const scale of [0.92, 0.96, 1, 1.04, 1.08]) for (const HLA of [-6, -3, 0, 3, 6]) for (const SpinAxis of [-10, 0, 10]) {
    const g = newGame(id);
    const r = g.handleShot(stock(k, { Speed: CLUB_FULL[k].speedMph * scale, HLA, SpinAxis }), k);
    assert.equal(r.penalty, 0);
    shots++;
    if (r.lie === 'green') onGreen++;
  }
  assert.ok(onGreen / shots >= 0.65, `${onGreen} of ${shots} sprayed short irons are on the green`);
  // the wind (stage.wind, 0 to 6 mph in the bowl): at its strongest, from any quarter, a stock 9 iron holds the green
  assert.deepEqual(piece.stage.wind, { min: 0, max: 6 });
  for (const windFromDeg of [0, 45, 90, 180, 225, 270]) {
    const g = newGame(id);
    g.setConditions({ windMph: piece.stage.wind.max, windFromDeg });
    const r = g.handleShot(stock('I9'), 'I9');
    assert.ok(r.lie === 'green' && r.distToPinYd < 15, `a stock 9 iron in ${piece.stage.wind.max} mph from ${windFromDeg}: ${r.distToPinYd} yd on ${r.lie}`);
  }

  // the scoring rings: concentric on the flag, heightM their diameter, all on the green
  const rings = propsOf(id, 'target-ring');
  assert.ok(rings.length >= 3);
  assert.ok(rings.every((p) => p.x === pin[0] && p.y === pin[1]), 'centred on the pin');
  assert.deepEqual(rings.map((p) => p.heightM), [...rings.map((p) => p.heightM)].sort((p, q) => p - q));
  assert.equal(new Set(rings.map((p) => p.heightM)).size, rings.length);
  assert.ok(rings[0].heightM <= 8 && rings[rings.length - 1].heightM <= Math.min(...stats.greenM), 'from a 3 m bullseye out to the edge of the green');
});

test('a Rocket ball on holes-c\'s stages (when the arcade layer is present)', (t) => {
  let rocket = null;
  try { rocket = require('../lib/arcade').POWERUPS.find((p) => p.id === 'rocket'); } catch (_) { /* no arcade layer in this tree */ }
  if (!rocket || typeof rocket.launchMods !== 'function' || !rocket.physicsOpts) return t.skip('lib/arcade.js has no Rocket power-up');
  const fly = (id, k, speedScale = 1) => {
    const g = newGame(id), h = g.hole;
    const launch = rocket.launchMods({ speedMph: CLUB_FULL[k].speedMph * speedScale, vla: CLUB_FULL[k].vla, hla: 0, totalSpin: CLUB_FULL[k].spin, spinAxis: 0 });
    const sim = simulateShot(launch, { x: h.tee[0], y: h.tee[1] }, g.aimDeg, g.surfaceAt, { terrain: g.terrain, pin: { x: h.pin[0], y: h.pin[1] }, trees: g.treeObstacles, ...rocket.physicsOpts });
    const wet = sim.endSurface === 'water' || sim.endSurface === 'ob' || sim.events.some((e) => e.type === 'water');
    return { wet, surface: sim.endSurface, leftYd: Math.hypot(h.pin[0] - sim.end.x, h.pin[1] - sim.end.y) / YD, carryYd: sim.carryYd };
  };
  // Midnight Mile, the Rocket route: the Helipad, 11.5 degrees left of the flag. A boosted drive from a
  // swing of 106 to 122 mph (or a boosted hybrid) carries 365 to 415 yd and stops on the roof, 26 m and
  // more above the harbour; less is in the water short of the tower, more flies it into the pond behind.
  const mile = newGame('midnight-mile'), mh = mile.hole;
  const flyMile = (aimOffset, k, speedScale = 1) => {
    const launch = rocket.launchMods({ speedMph: CLUB_FULL[k].speedMph * speedScale, vla: CLUB_FULL[k].vla, hla: 0, totalSpin: CLUB_FULL[k].spin, spinAxis: 0 });
    const sim = simulateShot(launch, { x: mh.tee[0], y: mh.tee[1] }, mile.aimDeg + aimOffset, mile.surfaceAt, { terrain: mile.terrain, pin: { x: mh.pin[0], y: mh.pin[1] }, trees: mile.treeObstacles, ...rocket.physicsOpts });
    const wet = sim.endSurface === 'water' || sim.endSurface === 'ob' || sim.events.some((e) => e.type === 'water');
    return { wet, surface: sim.endSurface, x: sim.end.x, y: sim.end.y, z: mile.terrain.h(sim.end.x, sim.end.y), leftYd: Math.hypot(mh.pin[0] - sim.end.x, mh.pin[1] - sim.end.y) / YD, carryYd: sim.carryYd };
  };
  const onPad = (f) => !f.wet && f.x > -208 && f.x < -136 && f.y > 292 && f.y < 366 && f.z > 25;
  for (const [k, scale] of [['DR', 0.7], ['DR', 0.75], ['DR', 0.8], ['H3', 1]]) {
    const f = flyMile(-11.5, k, scale);
    assert.ok(onPad(f), `a Rocket ${k} at ${Math.round(scale * 100)} % at the Helipad stops on the roof: (${f.x.toFixed(0)}, ${f.y.toFixed(0)}) ${f.surface}, ${f.z.toFixed(0)} m up`);
    assert.ok(f.carryYd > 355 && f.carryYd < 425, `a ${f.carryYd.toFixed(0)} yd carry`);
    assert.ok(f.leftYd > 95 && f.leftYd < 145, `leaving a wedge: ${f.leftYd.toFixed(0)} yd`);
  }
  assert.equal(flyMile(-11.5, 'DR', 0.7).surface, 'fairway');
  assert.equal(flyMile(-11.5, 'DR', 0.62).wet, true, 'short of the tower is the harbour');
  assert.equal(flyMile(-11.5, 'DR', 0.9).wet, true, 'too much flies the roof into the pond behind it');
  assert.equal(onPad(flyMile(-11.5, 'DR', 1)), false);
  // without the Rocket nobody gets there: a stock drive on that line is in the basin
  const plain = newGame('midnight-mile');
  plain.setAimOffset(-11.5);
  assert.equal(plain.handleShot(stock('DR'), 'DR').penalty, 1, 'a stock drive at the Helipad is wet');
  // ... and the Rocket straight at the flag: a swing of about 130 mph carries the moat and is putting
  // for an albatross; a bigger one is over the back in the stands, dry; a smaller one is in the moat
  const bold = flyMile(0, 'DR', 0.85);
  assert.ok(!bold.wet && bold.surface === 'green', `a 129 mph Rocket at the flag: ${bold.surface}, ${bold.leftYd.toFixed(0)} yd`);
  assert.ok(bold.carryYd > 450 && bold.carryYd < 480, `a ${bold.carryYd.toFixed(0)} yd carry`);
  const full = flyMile(0, 'DR');
  assert.ok(full.carryYd > 500 && full.carryYd < 545, `a full Rocket drive carries ${full.carryYd.toFixed(0)} yd from the roof`);
  assert.ok(!full.wet && full.leftYd < 60, `and is over the back, dry: ${full.surface}, ${full.leftYd.toFixed(0)} yd`);
  assert.equal(flyMile(0, 'DR', 0.8).wet, true, 'a 122 mph Rocket at the flag is in the moat: that swing wants the Helipad');
  assert.equal(flyMile(0, 'DR', 0.7).wet, false, 'and a weak one is short of the moat, dry');
  // Pharaoh's Gate: a boosted driver flies the green and the escarpment and comes down dry, far above the flag
  // (on the city roof); a boosted mid iron is on the green
  const over = fly('pharaohs-gate', 'DR');
  assert.ok(!over.wet && over.leftYd > 120 && over.carryYd > 400, `a Rocket drive is ${over.leftYd.toFixed(0)} yd past the flag on ${over.surface}`);
  const irons = ['I6', 'I7', 'I8'].map((k) => fly('pharaohs-gate', k));
  assert.ok(irons.some((f) => !f.wet && f.leftYd < 15), `a boosted iron is on the green: ${JSON.stringify(irons.map((f) => [f.wet ? 'wet' : f.surface, Math.round(f.leftYd)]))}`);
});

test('docs/arcade-holes.md: the stage table is the one the catalogue builds (tools/arcade-holes/table.mjs --check)', () => {
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'arcade-holes', 'table.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
});
