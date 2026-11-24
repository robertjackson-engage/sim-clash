'use strict';
// Stream holes-a: Volcano Drop (match 4), Frostbite Ridge (match 5) and Ice Pick
// (tiebreak 3). Each hole file is assembled into its own single-hole course exactly as
// the catalogue does it, validated with the loader's own code, and played through the
// real Game with the swings the designs are built round. Offline: nothing here touches
// the network or the repo's data dir.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Game, CLUB_FULL } = require('../lib/game');
const { simulateShot, YD } = require('../lib/physics');
const courseLib = require('../lib/course');
const { courseCacheStem, normalizeCourseSource } = require('../lib/course-identity');
const { missingSceneryLayers } = require('../lib/course-enrichment');
const L = require('../tools/arcade-holes/lib');
const { teeCameraClearance } = require('./helpers/arcade-holes');

const PIECES = {
  'volcano-drop': require('../tools/arcade-holes/holes/volcano-drop'),
  'frostbite-ridge': require('../tools/arcade-holes/holes/frostbite-ridge'),
  'ice-pick': require('../tools/arcade-holes/holes/ice-pick'),
};
const IDS = Object.keys(PIECES);

// What docs/dev/arcade-v2-contract.md section 1 fixes for each stage, and the props each world is sold with.
const WANT = {
  'volcano-drop': {
    number: 4, role: 'match', order: 4, name: 'Volcano Drop', theme: 'volcano', par: 3, yd: [185, 200], dropM: [30, 38], reliefM: [70, 100],
    green: [28, 24],
    props: ['volcano', 'lava-rock', 'lava-fall', 'torch', 'crystal', 'dragon', 'ruins', 'statue', 'gate', 'idol', 'tower', 'crowd', 'grandstand', 'jumbotron',
      'flag-banner', 'fireworks', 'cloud', 'bird-flock', 'airship'],
  },
  'frostbite-ridge': {
    number: 5, role: 'match', order: 5, name: 'Frostbite Ridge', theme: 'alpine', par: 4, yd: [360, 390], dropM: [30, 40], reliefM: [95, 118],
    green: [28, 24],
    props: ['pine', 'cabin', 'snowman', 'ice-spire', 'balloon', 'crystal', 'tower', 'launch-ramp', 'crowd', 'flag-banner', 'torch', 'windmill', 'bridge',
      'hut', 'boat', 'jumbotron', 'grandstand', 'fireworks', 'waterfall', 'castle', 'cloud', 'airship', 'bird-flock'],
  },
  'ice-pick': {
    number: 23, role: 'tiebreak', order: 3, name: 'Ice Pick', theme: 'alpine', par: 3, yd: [95, 105], dropM: [38, 44],
    green: [34, 34],
    props: ['target-ring', 'pine', 'cabin', 'snowman', 'ice-spire', 'balloon', 'crystal', 'crowd', 'flag-banner', 'torch', 'statue', 'gate', 'tower', 'castle', 'dragon', 'cloud', 'bird-flock'],
  },
};

// One course per hole file, as tools/arcade-holes/courses.js builds a stage.
function assemble(id) {
  const piece = PIECES[id];
  const stage = L.normalizeStage(piece.stage, id);
  return L.assembleCourse({
    id, number: stage.number, name: stage.name, origin: stage.origin, pieces: [{ piece }],
    ...(stage.baseM ? { baseM: stage.baseM } : {}),
    ...(stage.conditions ? { conditions: stage.conditions } : {}),
    stage,
  });
}
const BUILT = Object.fromEntries(IDS.map((id) => [id, assemble(id)]));
const REPORT = Object.fromEntries(IDS.map((id) => [id, L.validateCourse(BUILT[id].course, { expect: BUILT[id].expect })]));

const LIES = ['tee', 'fairway', 'green', 'rough', 'bunker'];
const newGame = (id) => { const g = new Game(); g.setCourse(structuredClone(BUILT[id].course)); return g; };
const swing = (speed, vla, spin, extra = {}) => ({ Speed: speed, VLA: vla, HLA: 0, TotalSpin: spin, SpinAxis: 0, ...extra });
const stock = (k, extra = {}) => swing(CLUB_FULL[k].speedMph, CLUB_FULL[k].vla, CLUB_FULL[k].spin, extra);
// the swings the brief names: a 150 mph drive, a 135 mph (average) drive, a 5-iron, a 7-iron, a 9-iron, a wedge
const DRIVE = swing(150, 12, 2500), AVERAGE_DRIVE = swing(135, 13, 2800), IRON5 = swing(130, 16, 5000);
const IRON7 = swing(115, 19, 6500), IRON9 = swing(100, 23, 8500), WEDGE = swing(90, 28, 9000);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const toPinM = (g) => Math.hypot(g.hole.pin[0] - g.ball.x, g.hole.pin[1] - g.ball.y);

// Aim the game at a point (aim 0 is straight at the pin).
function aimAt(g, p) {
  g.setAimOffset(Math.atan2(p[0] - g.ball.x, p[1] - g.ball.y) * 180 / Math.PI - (g.aimDeg - g.aimOffset));
}

// Play one swing and check the result is sound, whatever happened to the ball.
function hit(g, launch, label) {
  const r = g.handleShot(launch);
  assert.ok(r, `${label}: the shot was played`);
  assert.ok(LIES.includes(r.lie), `${label}: the ball lies on '${r.lie}'`);
  assert.equal(g.surfaceAt(r.end.x, r.end.y), r.holed ? 'green' : r.lie, `${label}: the lie is the surface under the ball`);
  for (const v of [r.end.x, r.end.y, r.sim.carryYd, r.sim.totalYd, r.distToPinYd]) assert.ok(Number.isFinite(v), `${label}: finite numbers`);
  if (r.penalty) assert.match(r.note, /Water|Out of bounds/, `${label}: the penalty is explained`);
  return r;
}

// Finish the hole from wherever the ball lies: the putt (or the part wedge, off the green)
// whose predicted finish is nearest the cup and dry. -> strokes for the hole
function holeOut(g, label, maxStrokes = 9) {
  const h = g.hole;
  while (!g.holed) {
    assert.ok(g.strokes < maxStrokes, `${label}: holed within ${maxStrokes} strokes (${g.strokes} taken, ${g.distToPinYd.toFixed(0)} yd out on ${g.lie})`);
    const from = { ...g.ball };
    const options = [];
    if (g.lie === 'green') {
      for (let mph = 1; mph <= 16; mph += 0.25) options.push(swing(mph, 0.5, 100));
    } else {
      for (const k of ['LW', 'SW', 'PW', 'I9', 'I8']) for (const power of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]) options.push(stock(k, { Speed: CLUB_FULL[k].speedMph * power }));
    }
    let best = null;
    g.setAimOffset(0);
    for (const o of options) {
      const sim = simulateShot({ speedMph: o.Speed, vla: o.VLA, hla: 0, totalSpin: o.TotalSpin, spinAxis: 0 }, from, g.aimDeg, g.surfaceAt,
        { terrain: g.terrain, pin: { x: h.pin[0], y: h.pin[1] }, trees: g.treeObstacles });
      if (sim.endSurface === 'water' || sim.endSurface === 'ob' || sim.events.some((e) => e.type === 'water')) continue;
      const left = sim.holed ? 0 : Math.hypot(h.pin[0] - sim.end.x, h.pin[1] - sim.end.y);
      if (!best || left < best.left) best = { launch: o, left };
    }
    assert.ok(best, `${label}: there is a dry shot from (${from.x.toFixed(0)}, ${from.y.toFixed(0)}) on ${g.lie}`);
    const r = hit(g, best.launch, label);
    assert.equal(r.penalty, 0, `${label}: the finishing shots stay dry`);
  }
  return g.strokes;
}

// The surfaces along a straight line, one per metre.
function along(surfaceAt, a, b) {
  const n = Math.ceil(dist(a, b));
  return Array.from({ length: n + 1 }, (_, i) => surfaceAt(L.lerp(a[0], b[0], i / n), L.lerp(a[1], b[1], i / n)));
}
// How wide a surface is across a point, measured along a unit direction.
function widthAcross(surfaceAt, at, dir, kind, reach = 60) {
  let w = 0;
  for (let d = -reach; d <= reach; d += 0.5) if (surfaceAt(at[0] + dir[0] * d, at[1] + dir[1] * d) === kind) w += 0.5;
  return w;
}

// ---------------------------------------------------------------- the files and the courses

test('holes-a: each hole file is a piece plus the stage block the contract fixes', () => {
  for (const id of IDS) {
    const piece = PIECES[id], want = WANT[id];
    assert.equal(piece.id, id);
    for (const key of ['extent', 'hole', 'surfaces', 'height', 'trees', 'woods', 'props', 'obLine', 'probes', 'stage']) assert.ok(piece[key] !== undefined, `${id}: exports ${key}`);
    assert.equal(piece.sea, false, `${id}: an inland hole, its hazard is a water polygon`);
    const s = L.normalizeStage(piece.stage, id);
    assert.deepEqual([s.number, s.role, s.order, s.name, s.theme], [want.number, want.role, want.order, want.name, want.theme], id);
    assert.equal(piece.hole.name, want.name);
    assert.ok(L.THEMES.includes(s.theme) && L.TIMES_OF_DAY.includes(s.timeOfDay) && L.CONDITIONS.includes(s.conditions), `${id}: theme, time of day, conditions`);
    assert.ok([1, 2, 3].includes(s.difficulty), `${id}: difficulty`);
    assert.ok(typeof s.blurb === 'string' && s.blurb.length >= 20 && s.blurb.length < 90, `${id}: a blurb under 90 characters (${s.blurb.length})`);
    // open ocean, far enough north that the renderer plants no azalea beds on lava or snow
    assert.ok(Math.abs(s.origin.lat) > 37 && Math.abs(s.origin.lat) < 70 && Math.abs(s.origin.lon) <= 180, `${id}: origin`);
    assert.ok(piece.probes.length >= 10, `${id}: probes for its hazards and surfaces`);
    for (const kind of ['water', 'rough']) assert.ok(piece.probes.some((p) => p.kind === kind), `${id}: a ${kind} probe`);
  }
  assert.equal(new Set(IDS.map((id) => `${PIECES[id].stage.origin.lat},${PIECES[id].stage.origin.lon}`)).size, IDS.length, 'each world has its own place');
});

test('holes-a: each hole assembles into a loadable single-hole course and passes validateCourse with its probes', () => {
  for (const id of IDS) {
    const { course, expect } = BUILT[id], want = WANT[id];
    assert.ok(courseLib.isCurrentCourseCache(course), id);
    const source = normalizeCourseSource(course.source);
    assert.equal(source.courseId, `osm:node:${9900000000000 + want.number}`, id);
    assert.equal(courseCacheStem(course.source), `osm-node-${9900000000000 + want.number}`, id);
    assert.equal(course.name, want.name);
    assert.equal(course.holes.length, 1);
    assert.equal(expect.probes.length, PIECES[id].probes.length, `${id}: every probe is checked`);
    assert.deepEqual(REPORT[id].warnings, [], `${id}: no warnings (every prop kind has a model)`);
    assert.equal(REPORT[id].stats.sea, null, `${id}: no sea is found in an inland bowl`);
    assert.equal(expect.sea, false);
    assert.deepEqual(
      { id: course.arcade.id, formatVersion: course.arcade.formatVersion, holes: course.arcade.holes, theme: course.arcade.theme, role: course.arcade.role, order: course.arcade.order },
      { id, formatVersion: 2, holes: [id], theme: want.theme, role: want.role, order: want.order }, id);
    assert.equal(course.arcade.timeOfDay, PIECES[id].stage.timeOfDay);
    assert.equal(course.arcade.blurb, PIECES[id].stage.blurb);
    assert.equal(course.arcade.conditions, PIECES[id].stage.conditions);
    assert.equal(course.elevation.baseM, PIECES[id].stage.baseM);
    assert.deepEqual(JSON.parse(JSON.stringify(course)), course, `${id}: plain JSON`);
    assert.equal(JSON.stringify(assemble(id).course), JSON.stringify(course), `${id}: builds are repeatable`);
    for (const s of course.surfaces) assert.ok(L.SURFACE_KINDS.includes(s.kind), `${id}: surface kind ${s.kind}`);
    assert.deepEqual(missingSceneryLayers(course), [], `${id}: nothing for the scenery enricher to fetch`);
    // the boundary (and so the renderer's ground) lies inside the height grid
    const el = course.elevation, b = L.bbox(course.boundary);
    assert.ok(b.minX >= el.minX && b.minY >= el.minY && b.maxX <= el.minX + (el.nx - 1) * el.cellM && b.maxY <= el.minY + (el.ny - 1) * el.cellM, `${id}: boundary inside the grid`);
  }
});

test('holes-a: the catalogue builds the same three courses (when it is in place)', (t) => {
  let catalogue;
  try { catalogue = require('../tools/arcade-holes/courses'); } catch (e) { t.skip(`tools/arcade-holes/courses.js does not load: ${e.message}`); return; }
  if (typeof catalogue.buildCourse !== 'function' || !IDS.every((id) => (catalogue.COURSES || []).some((c) => c.id === id))) {
    t.skip('the catalogue does not list the holes-a stages yet');
    return;
  }
  for (const id of IDS) assert.equal(JSON.stringify(catalogue.buildCourse(id).course), JSON.stringify(BUILT[id].course), id);
});

test('holes-a: pars, lengths and drops in the contract ranges; big, gentle greens', () => {
  for (const id of IDS) {
    const [hole] = BUILT[id].course.holes, [stats] = REPORT[id].stats.holes, want = WANT[id];
    assert.equal(hole.par, want.par, id);
    assert.equal(hole.ref, 1);
    assert.ok(hole.lengthYd >= want.yd[0] && hole.lengthYd <= want.yd[1], `${id}: ${hole.lengthYd} yd`);
    assert.equal(hole.lengthYd, Math.round(L.polylineLength(hole.line) / YD));
    const drop = stats.teeHeightM - stats.pinHeightM;
    assert.ok(drop >= want.dropM[0] && drop <= want.dropM[1], `${id}: the tee stands ${drop.toFixed(1)} m above the flag`);
    const [across, deep] = stats.greenM;
    assert.ok(Math.max(across, deep) >= want.green[0] && Math.min(across, deep) >= want.green[1], `${id}: green ${stats.greenM.join(' x ')} m`);
    assert.ok(Math.max(across, deep) <= 42, `${id}: green ${stats.greenM.join(' x ')} m`);
    assert.ok(stats.greenSlopePct >= 0.5 && stats.greenSlopePct < 3, `${id}: green slope ${stats.greenSlopePct} %`);
    assert.ok(typeof hole.note === 'string' && hole.note.length > 40 && typeof hole.greenNote === 'string', `${id}: the hole card has its notes`);
  }
});

test('holes-a: each course loads into the game: tee, pin, finite ground, trees clear of play', () => {
  for (const id of IDS) {
    const g = newGame(id), s = g.state(), hole = g.hole;
    assert.equal(s.loaded, true);
    assert.equal(s.courseName, WANT[id].name);
    assert.equal(s.holeName, WANT[id].name);
    assert.equal(s.holeCount, 1);
    assert.equal(s.lie, 'tee');
    assert.ok(Math.abs(s.distToPinYd - dist(hole.tee, hole.pin) / YD) < 0.06);
    assert.equal(g.surfaceAt(hole.tee[0], hole.tee[1]), 'tee');
    // the cup is not perched: green all round it (a tiebreak pin sits in the middle of its target)
    const clear = WANT[id].role === 'tiebreak' ? 16 : 6;
    for (let a = 0; a < 360; a += 15) {
      assert.equal(g.surfaceAt(hole.pin[0] + clear * Math.cos(a * Math.PI / 180), hole.pin[1] + clear * Math.sin(a * Math.PI / 180)), 'green', `${id}: ${clear} m of green round the cup`);
    }
    const el = g.course.elevation;
    let lo = Infinity, hi = -Infinity;
    for (let y = el.minY - 40; y <= el.minY + el.ny * el.cellM + 40; y += 5) {
      for (let x = el.minX - 40; x <= el.minX + el.nx * el.cellM + 40; x += 5) {
        const h = g.terrain.h(x, y), gr = g.terrain.grad(x, y);
        assert.ok(Number.isFinite(h) && Number.isFinite(gr.dx) && Number.isFinite(gr.dy), `${id}: terrain at (${x}, ${y})`);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
        assert.ok(['water', 'ob', ...LIES].includes(g.surfaceAt(x, y)), `${id}: a known surface at (${x}, ${y})`);
      }
    }
    assert.ok(lo >= -0.01, `${id}: nothing lies below the lava / the ice (lowest ${lo.toFixed(2)} m)`);
    const [reliefLo, reliefHi] = WANT[id].reliefM || [25, 80];
    assert.ok(hi - lo > reliefLo && hi - lo < reliefHi, `${id}: dramatic but sane relief (${(hi - lo).toFixed(1)} m)`);
    assert.ok(g.course.trees.length >= 6, `${id}: some trees (they also switch off the renderer's invented horizon band)`);
    assert.equal(g.course.canopy.trees.length, g.course.trees.length);
    for (const [x, y] of g.course.trees) {
      assert.ok(['rough', 'ob'].includes(g.surfaceAt(x, y)), `${id}: tree at (${x}, ${y}) on ${g.surfaceAt(x, y)}`);
      // no tree within 20 m of the straight line from the tee to the flag
      assert.ok(L.distToSegment(x, y, hole.tee[0], hole.tee[1], hole.pin[0], hole.pin[1]) > 20, `${id}: tree at (${x}, ${y}) crowds the direct line`);
    }
    // every water polygon really is level: the renderer draws its sheet at the median height inside
    for (const w of g.course.surfaces.filter((x) => x.kind === 'water')) {
      const b = L.bbox(w.poly), hs = [];
      for (let y = b.minY + 1; y < b.maxY; y += 2) for (let x = b.minX + 1; x < b.maxX; x += 2) if (L.pointInPoly(x, y, w.poly)) hs.push(g.terrain.h(x, y));
      hs.sort((p, q) => p - q);
      assert.equal(hs[Math.floor(hs.length / 2)], 0, `${id}: the lava / ice sheet lies at 0`);
      assert.ok(hs.filter((v) => v === 0).length > 0.5 * hs.length, `${id}: most of the hazard is dead level`);
    }
  }
});

test('holes-a: props sell each world with the contract\'s kinds, plenty of them, clear of play', () => {
  for (const id of IDS) {
    const { course } = BUILT[id], [hole] = course.holes, want = WANT[id];
    const surfaceAt = courseLib.makeSurfaceLookup(course);
    const kinds = new Set(course.props.map((p) => p.kind));
    assert.deepEqual([...kinds].sort(), [...want.props].sort(), `${id}: prop kinds`);
    assert.ok(course.props.length >= 35, `${id}: ${course.props.length} props`);
    assert.equal(new Set(course.props.map((p) => p.id)).size, course.props.length);
    for (const p of course.props) {
      assert.ok(L.PROP_KINDS.includes(p.kind), `${id}: ${p.kind} is a kind the look stream models`);
      assert.match(p.id, new RegExp(`^${id}/`));
      assert.ok(p.heightM > 0 && Number.isFinite(p.rotDeg));
      if (L.FLAT_PROP_KINDS.includes(p.kind) || L.FLOATING_PROP_KINDS.includes(p.kind)) continue;
      assert.ok(['rough', 'ob', 'water'].includes(surfaceAt(p.x, p.y)), `${id}: ${p.id} stands on ${surfaceAt(p.x, p.y)}`);
      const clear = L.SLIM_PROP_KINDS.includes(p.kind) ? 5 : 8;
      assert.ok(L.distToSegment(p.x, p.y, hole.tee[0], hole.tee[1], hole.pin[0], hole.pin[1]) >= clear, `${id}: ${p.id} is clear of the line`);
    }
  }
  // Ice Pick: concentric scoring rings centred on the flag, the biggest the size of the green
  const { course } = BUILT['ice-pick'], [hole] = course.holes;
  const rings = course.props.filter((p) => p.kind === 'target-ring');
  assert.ok(rings.length >= 4);
  for (const r of rings) assert.deepEqual([r.x, r.y], hole.pin, 'a ring is centred on the pin');
  const sizes = rings.map((r) => r.heightM).sort((a, b) => a - b);
  assert.equal(new Set(sizes).size, sizes.length, 'no two rings the same size');
  assert.ok(sizes[0] <= 8 && sizes[sizes.length - 1] <= REPORT['ice-pick'].stats.holes[0].greenM[0] + 0.01, `rings ${sizes.join(', ')} m across fit the green`);
  // nothing hidden on the arena: no bunkers, no fairway, one hazard (the ice, a lobe either side of the green)
  assert.deepEqual(course.surfaces.map((s) => s.kind).sort(), ['green', 'tee', 'water', 'water']);
  // Volcano Drop: rocks stand in the lava and falls pour down the crater walls
  const lavaAt = courseLib.makeSurfaceLookup(BUILT['volcano-drop'].course);
  const inLava = (kind) => BUILT['volcano-drop'].course.props.filter((p) => p.kind === kind && lavaAt(p.x, p.y) === 'water').length;
  assert.ok(inLava('lava-rock') >= 12 && inLava('lava-fall') >= 4);
  // Frostbite Ridge: ice spires stand in the frozen lake, none anywhere near the hero line
  const fr = BUILT['frostbite-ridge'].course, iceAt = courseLib.makeSurfaceLookup(fr);
  const spires = fr.props.filter((p) => p.kind === 'ice-spire' && iceAt(p.x, p.y) === 'water');
  assert.ok(spires.length >= 6);
  for (const p of spires) assert.ok(L.distToSegment(p.x, p.y, 0, 0, fr.holes[0].pin[0], fr.holes[0].pin[1]) > 20, `${p.id} is wide of the carry`);
});

test('holes-a: a reasonable miss is never out of bounds', () => {
  for (const id of IDS) {
    const clubs = id === 'frostbite-ridge' ? ['DR', 'W3', 'I5'] : id === 'volcano-drop' ? ['I4', 'I6', 'I8'] : ['PW', 'SW', 'LW'];
    for (const k of clubs) {
      for (let hla = -30; hla <= 30; hla += 6) {
        for (const axis of [-20, 0, 20]) {
          const g = newGame(id);
          const r = hit(g, stock(k, { HLA: hla, SpinAxis: axis }), `${id} ${k} ${hla} deg`);
          assert.doesNotMatch(r.note, /Out of bounds/, `${id}: ${k} started ${hla} deg off line with ${axis} deg of axis tilt is out of bounds`);
          assert.equal(g.surfaceAt(g.ball.x, g.ball.y) === 'ob', false);
        }
      }
    }
  }
});

// ---------------------------------------------------------------- Volcano Drop

// One swing at Volcano Drop from a fresh tee (or from `from`). at: aim at this point, else
// `off` degrees from the flag; wind: [degrees relative to the line to the pin (windAt), mph];
// rocket: a Rocket ball. -> { g, r, land: its first touch (a bounce, or the lava) }
function volcanoSwing(launch, label, { at = null, off = 0, wind = null, rocket = false, from = null } = {}) {
  const g = newGame('volcano-drop');
  if (from) { g.ball = { x: from[0], y: from[1] }; g.lie = g.surfaceAt(from[0], from[1]); g.strokes = 1; }
  if (at) aimAt(g, at); else g.setAimOffset(off);
  if (wind) windAt(g, wind[0], wind[1]);
  if (rocket) g.shotMods = rocketMods();
  const r = hit(g, launch, label);
  g.shotMods = null;
  return { g, r, land: r.sim.events.find((e) => e.type === 'bounce' || e.type === 'water') || r.end };
}
const VOLCANO = { fangs: [[-19, 88], [19, 88]], terrace: [-84, 102], teeH: 40 };

test('Volcano Drop: a rim tee, the Jaws on the line, an island in the lava with reefs out to the fangs', () => {
  const g = newGame('volcano-drop'), hole = g.hole;
  assert.deepEqual((hole.routes || []).map((r) => r.id), ['safe', 'risky', 'rocket']);
  assert.deepEqual(BUILT['volcano-drop'].course.arcade.wind, { min: 4, max: 12 });
  const line = along(g.surfaceAt, hole.tee, hole.pin);
  assert.equal(line[0], 'tee');
  const firstLava = line.indexOf('water'), lastLava = line.lastIndexOf('water');
  assert.ok(firstLava >= 3 && firstLava <= 8, `the rim ends ${firstLava} m in front of the ball`);
  assert.ok(line.slice(firstLava, lastLava + 1).every((s) => s === 'water'), 'nothing but lava from the rim to the reef');
  assert.ok(lastLava - firstLava >= 110, `${lastLava - firstLava} m of lava to carry`);
  assert.ok(line.slice(lastLava + 1).every((s) => LIES.includes(s)), 'then the reef and the island: dry');
  // the lake is level, 40 m below the tee; the island stands proud of it
  const teeH = g.terrain.h(hole.tee[0], hole.tee[1]), pinH = g.terrain.h(hole.pin[0], hole.pin[1]);
  assert.equal(g.terrain.h(0, 60), 0);
  assert.equal(teeH, VOLCANO.teeH);
  assert.ok(teeH - pinH >= 30 && pinH >= 5, `tee ${teeH}, green ${pinH}`);
  // the Jaws: two fangs 34 m higher than the tee, lava in the 21 m gate between them
  for (const [fx, fy] of VOLCANO.fangs) {
    assert.ok(g.terrain.h(fx, fy) - teeH >= 34, `the fang at (${fx}, ${fy}) stands ${(g.terrain.h(fx, fy) - teeH).toFixed(0)} m above the tee`);
    assert.equal(g.surfaceAt(fx, fy), 'rough', 'a fang is rock, not lava: the renderer would carve a polygon flat');
  }
  assert.equal(g.surfaceAt(0, 88), 'water');
  let gate = 0;
  for (let x = -19; x <= 19; x += 0.5) if (g.terrain.h(x, 88) < teeH - 15) gate += 0.5;
  assert.ok(gate >= 18 && gate <= 25, `the gate is ${gate} m wide below the tee's height`);
  // dry ground across the island through the flag, with a mown wing; the spine behind closes the lake
  const across = along(g.surfaceAt, [hole.pin[0] - 80, hole.pin[1]], [hole.pin[0] + 80, hole.pin[1]]);
  assert.ok(across.filter((s) => s !== 'water').length >= 70, 'the island is 70 m wide at the flag');
  assert.ok(across.includes('fairway'), 'its west wing is mown');
  assert.equal(g.surfaceAt(-8, 232), 'rough');
  assert.ok(g.terrain.h(-8, 232) > 2, 'the spine stands out of the lava');
  // the Ash Terrace: 48 x 40 m of mown ground on its buttress, 14 m below the tee
  assert.ok(widthAcross(g.surfaceAt, VOLCANO.terrace, [1, 0], 'fairway') >= 44 && widthAcross(g.surfaceAt, VOLCANO.terrace, [0, 1], 'fairway') >= 36, 'the terrace is a real target');
  const terraceH = g.terrain.h(VOLCANO.terrace[0], VOLCANO.terrace[1]);
  assert.ok(teeH - terraceH >= 12 && terraceH - pinH >= 16, `the terrace is at ${terraceH} m`);
  // from the terrace the flag is in the open: nothing higher than the terrace on the way
  const fromTerrace = Math.max(...Array.from({ length: 101 }, (_, i) => g.terrain.h(L.lerp(VOLCANO.terrace[0], hole.pin[0], i / 100), L.lerp(VOLCANO.terrace[1], hole.pin[1], i / 100))));
  assert.ok(fromTerrace <= terraceH + 1, 'the Jaws are not in the way from the terrace');
  // all of it in view from the tee: the flag through the gate, the terrace, both fangs
  // (the sight line ends 0.3 m over its target, so anything above 0.25 m is a clear view all the way)
  assert.ok(teeCameraClearance(g, hole.pin[0], hole.pin[1]) > 0.25, 'the flag is seen from the tee');
  assert.ok(teeCameraClearance(g, VOLCANO.terrace[0], VOLCANO.terrace[1]) > 0.25, 'so is the terrace');
  assert.ok(teeCameraClearance(g, 0, 150) > 0.25, 'and the reef in front of the island');
  // most of the lava is dead level (the renderer draws its sheet at the median height inside)
  const lava = g.course.surfaces.find((s) => s.kind === 'water').poly, box = L.bbox(lava);
  let cells = 0, level = 0;
  for (let y = box.minY + 1; y < box.maxY; y += 2) for (let x = box.minX + 1; x < box.maxX; x += 2) if (L.pointInPoly(x, y, lava)) { cells++; if (g.terrain.h(x, y) === 0) level++; }
  assert.ok(level > 0.54 * cells, `${(100 * level / cells).toFixed(0)} % of the lava is level`);
});

test('Volcano Drop: through the Jaws for the flag, round by the Ash Terrace, and what melts', () => {
  const id = 'volcano-drop';
  // RISKY, through the Jaws: a 7-iron straight at the flag carries the lava and holds the green
  const hero = volcanoSwing(IRON7, 'hero 7-iron');
  assert.equal(hero.r.penalty, 0);
  assert.equal(hero.r.lie, 'green', `the 7-iron finishes on ${hero.r.lie}, ${hero.r.distToPinYd} yd away`);
  assert.ok(hero.r.distToPinYd < 12, `${hero.r.distToPinYd} yd from the flag`);
  assert.ok(hero.r.sim.carryYd > 180 && hero.r.sim.carryYd < 196, `the drop adds distance: it carries ${hero.r.sim.carryYd} yd`);
  assert.ok(holeOut(hero.g, 'hero') <= 3, 'par or better from there');
  const six = volcanoSwing(stock('I6'), 'stock 6-iron');
  assert.ok(six.r.lie === 'green' && six.r.distToPinYd < 14, `the 6-iron finishes ${six.r.distToPinYd} yd away on ${six.r.lie}`);
  // the gate: five degrees either way is through and on the island
  for (const off of [-5, -3, 3, 5]) {
    const through = volcanoSwing(IRON7, `7-iron ${off} deg off`, { off });
    assert.equal(through.r.penalty, 0, `${off} deg off line is through the gate (${through.r.lie})`);
    assert.ok(through.land.y > 150 && through.r.distToPinYd < 25, `${off} deg: lands at y ${through.land.y.toFixed(0)}`);
  }
  // ten degrees is a fang: the ball comes down on the reef at its foot, or in the lava
  for (const off of [-10, 10, -13, 13]) {
    const { r, land } = volcanoSwing(IRON7, `7-iron ${off} deg off`, { off });
    const fang = VOLCANO.fangs[off < 0 ? 0 : 1];
    assert.ok(dist([land.x, land.y], fang) < 12, `${off} deg hits the fang (first touch at ${land.x.toFixed(0)}, ${land.y.toFixed(0)})`);
    assert.ok(r.distToPinYd > 80, `and stays ${r.distToPinYd} yd from the flag`);
  }
  // outside the Jaws there is only lava
  for (const off of [-22, 22]) assert.equal(volcanoSwing(IRON7, `7-iron ${off} deg off`, { off }).r.penalty, 1, `${off} deg off line is lava`);

  // SAFE, the Ash Terrace: a wedge to the wide shelf on the west wall, then a wedge across
  for (const [name, launch] of [['90 mph wedge', WEDGE], ['pitching wedge', stock('PW')], ['9-iron', IRON9]]) {
    const safe = volcanoSwing(launch, `${name} to the terrace`, { at: VOLCANO.terrace });
    assert.equal(safe.r.penalty, 0, `${name} to the terrace`);
    assert.equal(safe.r.lie, 'fairway', `${name} to the terrace lies on ${safe.r.lie}`);
    assert.ok(safe.r.distToPinYd > 105 && safe.r.distToPinYd < 135, `${name} leaves ${safe.r.distToPinYd} yd`);
    assert.ok(holeOut(safe.g, 'by the terrace') <= 4, 'a wedge across and two putts at worst');
  }
  for (const k of ['PW', 'SW']) {
    const across = volcanoSwing(stock(k), `${k} from the terrace`, { from: VOLCANO.terrace });
    assert.ok(across.r.lie === 'green' && across.r.distToPinYd < 15, `the ${k} from the terrace finishes ${across.r.distToPinYd} yd away on ${across.r.lie}`);
  }

  // short of the island is the reef between the fangs: dry, a chip left; a top is lava, dropped on the rim
  const short = volcanoSwing(WEDGE, 'a wedge at the flag');
  assert.ok(short.r.penalty === 0 && short.r.lie === 'rough' && short.r.distToPinYd > 20 && short.r.distToPinYd < 50, `a wedge at the flag: ${short.r.lie}, ${short.r.distToPinYd} yd`);
  const top = volcanoSwing(swing(70, 4, 2500), 'topped');
  assert.equal(top.r.penalty, 1, 'topped: lava');
  assert.match(top.r.note, /Water/);
  assert.equal(top.r.strokes, 2);
  assert.ok(top.r.end.y < 8 && Math.abs(top.r.end.x) < 8 && top.r.distToPinYd > 180, `dropped on the rim by the tee, at (${top.r.end.x.toFixed(1)}, ${top.r.end.y.toFixed(1)})`);
  assert.ok(Math.abs(top.g.terrain.h(top.r.end.x, top.r.end.y) - VOLCANO.teeH) < 1.5, 'on the level shelf, not down the wall');
  // too much club is over the island, a driver is in the far wall
  assert.equal(volcanoSwing(IRON5, '5-iron').r.penalty, 1);
  assert.equal(volcanoSwing(DRIVE, 'driver').r.penalty, 1);

  // the wind at the top of its range (12 mph): a club more dead into it, the island takes it from
  // either side, and the terrace is still there for a pitching wedge
  const into = volcanoSwing(stock('I6'), '6-iron into 12 mph', { wind: [0, 12] });
  assert.ok(into.r.penalty === 0 && into.r.distToPinYd < 25, `into the wind: ${into.r.lie}, ${into.r.distToPinYd} yd`);
  for (const rel of [90, 270]) {
    const cross = volcanoSwing(IRON7, `7-iron, wind from ${rel}`, { wind: [rel, 12] });
    assert.ok(cross.r.penalty === 0 && cross.r.distToPinYd < 35, `across the wind: ${cross.r.lie}, ${cross.r.distToPinYd} yd`);
  }
  for (const rel of [0, 90, 270]) {
    const blown = volcanoSwing(stock('PW'), `PW to the terrace, wind from ${rel}`, { at: VOLCANO.terrace, wind: [rel, 12] });
    assert.equal(blown.r.penalty, 0, `a pitching wedge to the terrace with 12 mph from ${rel} (${blown.r.lie})`);
  }
});

test('Volcano Drop: only a Rocket flies over the Jaws', (t) => {
  const beyond = [-19 * 2, 88 * 2];                     // the line over the left fang's crown, on to the island's west wing
  // no plain ball clears a fang: every stock club and the brief's swings, aimed over one, touch down short of it or on it
  const plain = [...Object.keys(CLUB_FULL).filter((k) => k !== 'PT').map((k) => [k, stock(k)]), ['150 mph drive', DRIVE], ['7-iron', IRON7], ['5-iron', IRON5], ['165 mph, 15 deg', swing(165, 15, 2300)]];
  for (const [name, launch] of plain) {
    const { r, land } = volcanoSwing(launch, `${name} over the fang`, { at: beyond });
    assert.ok(land.y < 100, `${name} over the fang: first touch at (${land.x.toFixed(0)}, ${land.y.toFixed(0)})`);
    assert.ok(r.distToPinYd > 80);
  }
  if (!rocketMods()) return t.skip('lib/arcade.js has no Rocket power-up');
  // a Rocket lob wedge does, and comes down on the island
  const over = volcanoSwing(stock('LW'), 'Rocket LW over the fang', { at: beyond, rocket: true });
  assert.equal(over.r.penalty, 0);
  assert.ok(over.land.y > 150 && over.r.distToPinYd < 50, `over the fang: first touch at y ${over.land.y.toFixed(0)}, ${over.r.distToPinYd} yd from the flag (${over.r.lie})`);
  // and at the flag the gate is not in play at all: eight degrees either side is still the island
  for (const k of ['LW', 'SW']) {
    const atFlag = volcanoSwing(stock(k), `Rocket ${k} at the flag`, { rocket: true });
    assert.ok(atFlag.r.lie === 'green' && atFlag.r.distToPinYd < 16, `Rocket ${k}: ${atFlag.r.lie}, ${atFlag.r.distToPinYd} yd`);
  }
  for (const off of [-8, 6]) assert.equal(volcanoSwing(stock('LW'), `Rocket LW ${off} deg off`, { off, rocket: true }).r.penalty, 0, `${off} deg off line, over a fang, is dry`);
  // dead into 12 mph it is a Rocket pitching wedge or 9-iron: there is always a club
  for (const k of ['PW', 'I9']) {
    const into = volcanoSwing(stock(k), `Rocket ${k} into 12 mph`, { rocket: true, wind: [0, 12] });
    assert.ok(into.r.lie === 'green' && into.r.distToPinYd < 15, `Rocket ${k} into the wind: ${into.r.lie}, ${into.r.distToPinYd} yd`);
  }
});

// ---------------------------------------------------------------- Frostbite Ridge

// The Rocket ball's shot modifiers (lib/arcade.js), or null when the arcade layer is not there.
function rocketMods() {
  try { const m = require('../lib/arcade').modifiersFor('rocket'); return m && m.id === 'rocket' ? m : null; } catch (_) { return null; }
}
// The wind a hole can get at its strongest, blowing FROM a bearing given relative to the
// tee-to-pin line (0: dead against, 180: behind, 90: from the right, 270: from the left).
function windAt(g, relDeg, mph) {
  const h = g.hole, bearing = Math.atan2(h.pin[0] - h.tee[0], h.pin[1] - h.tee[1]) * 180 / Math.PI;
  g.setConditions({ windMph: mph, windFromDeg: ((bearing + relDeg) % 360 + 360) % 360, gustMph: 0 });
}

test('Frostbite Ridge: a summit tee, the ridge round the lake, the shelf over it, the cirque above it all', () => {
  const id = 'frostbite-ridge';
  const g = newGame(id), hole = g.hole, piece = PIECES[id];
  assert.equal(hole.line.length, 4, 'a dogleg: tee, the landing area, round the top of the lake, flag');
  const [tee, turn, bend, pin] = hole.line;
  // the three routes are on the hole card
  assert.deepEqual(hole.routes.map((r) => r.id), ['safe', 'risky', 'rocket']);
  for (const r of hole.routes) assert.ok(r.name.length > 3 && r.note.length > 30, `route ${r.id} says how to play it`);
  assert.deepEqual(BUILT[id].course.arcade.wind, piece.stage.wind, 'the hole brings its own wind range');
  assert.ok(piece.stage.wind.min >= 3 && piece.stage.wind.max <= 12, 'an exposed summit, but the carry must stay fair');

  // elevation: the tee 44 m above the ice with a cliff off its front edge, the green on a shelf,
  // the cirque 30 m above the green, the headwall above that, peaks all round
  const h = (x, y) => g.terrain.h(x, y);
  assert.ok(h(tee[0], tee[1]) > 42 && h(tee[0], tee[1]) - h(0, 34) > 16, 'the ground falls away straight off the front of the tee');
  assert.equal(h(60, 180), 0, 'the ice is level');
  assert.ok(h(pin[0], pin[1]) > 8 && h(pin[0], pin[1]) < 10, 'the green sits on a shelf above the lake');
  assert.ok(h(62, 379) - h(pin[0], pin[1]) > 28, `the cirque floor is ${(h(62, 379) - h(pin[0], pin[1])).toFixed(0)} m above the green`);
  assert.ok(h(62, 337) - h(62, 322) > 10 && h(62, 440) - h(62, 400) > 30, 'an icefall below the cirque, a headwall behind it');
  const el = g.course.elevation;
  let top = 0;
  for (const v of el.heights) top = Math.max(top, v);
  assert.ok(top > 95 && top < 115, `the peaks stand ${top.toFixed(0)} m above the ice`);

  // RISKY: the direct line is ridge flank, then ice to 266 yd, then the shelf and the green
  const direct = along(g.surfaceAt, tee, pin);
  const firstIce = direct.indexOf('water'), lastIce = direct.lastIndexOf('water');
  assert.ok(firstIce / YD > 150 && firstIce / YD < 185, `the ice starts ${(firstIce / YD).toFixed(0)} yd out on the direct line`);
  assert.ok(lastIce / YD > 258 && lastIce / YD < 272, `it takes ${(lastIce / YD).toFixed(0)} yd to carry it`);
  assert.ok(direct.slice(firstIce, lastIce + 1).every((s) => s === 'water'));
  assert.ok(direct.slice(lastIce + 12).every((s) => s === 'fairway' || s === 'green'), 'the shelf waits on the far shore and runs up to the green');
  // the far shore is square to the line: the carry is the same a little left of it or well right of it
  for (const dx of [-6, 12, 24]) {
    const side = along(g.surfaceAt, tee, [pin[0] + dx, pin[1]]);
    assert.ok(Math.abs(side.lastIndexOf('water') - lastIce) < 12, `the carry ${dx} m off the line is ${(side.lastIndexOf('water') / YD).toFixed(0)} yd`);
  }
  assert.ok(widthAcross(g.surfaceAt, [50, 264], [1, 0], 'fairway') >= 60, 'the shelf is 60 m wide');

  // SAFE: the routing never touches ice or sand, and is mown from the ski slope to the green
  const route = [...along(g.surfaceAt, tee, turn), ...along(g.surfaceAt, turn, bend), ...along(g.surfaceAt, bend, pin)];
  assert.ok(!route.includes('water') && !route.includes('bunker'));
  const mown = route.slice(105, route.length - 22);
  assert.ok(mown.every((s) => s === 'fairway' || s === 'green'), `the routing is mown all the way (${[...new Set(mown)].join(', ')})`);
  const len = dist(tee, turn), across = [(turn[1] - tee[1]) / len, -(turn[0] - tee[0]) / len];
  for (const d of [150, 180, 205, 225, 250, 275]) {
    const at = [L.lerp(tee[0], turn[0], d / len), L.lerp(tee[1], turn[1], d / len)];
    const w = widthAcross(g.surfaceAt, at, across, 'fairway', 45);
    assert.ok(w >= 40, `the ridge fairway is ${w} m wide ${d} m out`);
  }
  const crest = h(-32, 215);
  assert.ok(crest > 14 && crest - h(-110, 215) > 8 && h(60, 215) === 0, 'a ridge: the gully on one side, the ice on the other');

  // ROCKET: the cirque floor is mown, beyond the green on the line from the tee, and nothing but ice and rock is up there
  assert.equal(g.surfaceAt(62, 379), 'fairway');
  assert.ok(dist([62, 379], pin) / YD > 70 && dist([62, 379], pin) / YD < 100, 'a flick from the flag');
  assert.ok(L.distToSegment(62, 379, tee[0], tee[1], tee[0] + 1.4 * (pin[0] - tee[0]), tee[1] + 1.4 * (pin[1] - tee[1])) < 10, 'straight on over the flag');

  // lots of pines, none in the lines of play; a second frozen hazard in the west gully
  assert.ok(g.course.trees.length >= 250, `${g.course.trees.length} pines`);
  for (const [x, y] of g.course.trees) assert.ok(L.distToPolyline(x, y, hole.line) > 30, `pine at (${x}, ${y}) crowds the fairway`);
  assert.equal(g.surfaceAt(-124, 200), 'water', 'the frozen river');
  // the vignettes: a summit station, a ski village with its balloon festival, the lake, the green as an event, an ice castle
  const count = (kind, where = () => true) => g.course.props.filter((p) => p.kind === kind && where(p)).length;
  assert.ok(g.course.props.length >= 120 && g.course.props.length <= 250, `${g.course.props.length} props`);
  assert.ok(count('cabin', (p) => p.x < -120) >= 10 && count('tower') >= 2 && count('balloon') >= 6, 'the village and its festival');
  assert.ok(count('cabin', (p) => p.y < 0) >= 2 && count('launch-ramp') === 1, 'the summit station and the ski jump');
  assert.ok(count('hut', (p) => g.surfaceAt(p.x, p.y) === 'water') >= 2 && count('boat') === 1, 'fishing huts and a boat on the ice');
  assert.ok(count('crowd') >= 6 && count('jumbotron') === 1 && count('grandstand') === 1, 'the green is an event');
  assert.ok(count('waterfall') === 2 && count('castle') === 1 && count('ice-spire', (p) => p.y > 340) >= 6, 'the icefall, the cirque and the castle');
});

test('Frostbite Ridge: safe down the ridge for a wedge in, or the hero carry for a chip; the ice costs a stroke', () => {
  const id = 'frostbite-ridge';
  const turn = BUILT[id].course.holes[0].line[1];
  // safe: a 150 mph drive down the ridge, a wedge, two putts
  let g = newGame(id);
  aimAt(g, turn);
  let r = hit(g, DRIVE, 'safe drive');
  assert.equal(r.penalty, 0);
  assert.equal(r.lie, 'fairway', `the safe drive finishes on ${r.lie}`);
  assert.ok(r.distToPinYd > 90 && r.distToPinYd < 120, `${r.distToPinYd} yd left`);
  g.setAimOffset(0);
  r = hit(g, swing(84, 29, 9000), 'safe wedge');   // 98 yd left, downhill: a soft wedge
  assert.equal(r.penalty, 0);
  assert.equal(r.lie, 'green', `the wedge finishes on ${r.lie}, ${r.distToPinYd} yd away`);
  assert.ok(holeOut(g, 'safe line') <= 4, 'par by the safe line');
  // an average drive (135 mph) on the same line is on the ridge too, a wedge from the flag
  g = newGame(id);
  aimAt(g, turn);
  r = hit(g, AVERAGE_DRIVE, 'average drive');
  assert.equal(r.lie, 'fairway');
  assert.ok(r.end.y > 220 && r.end.y < 280 && r.distToPinYd > 95 && r.distToPinYd < 130, `on the ridge at (${r.end.x.toFixed(0)}, ${r.end.y.toFixed(0)}), ${r.distToPinYd} yd left`);
  g.setAimOffset(0);
  r = hit(g, WEDGE, 'the wedge in');
  assert.equal(r.penalty, 0);
  assert.equal(r.lie, 'green');
  assert.ok(holeOut(g, 'average golfer') <= 4, 'par for the average drive too');
  // even a weak drive (120 mph) is on the ridge with a dry way home
  g = newGame(id);
  aimAt(g, turn);
  r = hit(g, swing(120, 14, 3000), 'weak drive');
  assert.equal(r.lie, 'fairway');
  assert.ok(holeOut(g, 'weak drive') <= 5);
  // risky: straight at the flag, over the ice, onto the shelf with a chip left
  g = newGame(id);
  r = hit(g, DRIVE, 'hero drive');
  assert.equal(r.penalty, 0, 'the 150 mph drive carries the lake');
  assert.equal(r.lie, 'fairway');
  assert.ok(r.sim.carryYd > 280, `carry ${r.sim.carryYd} yd from the summit`);
  assert.ok(r.distToPinYd < 35, `${r.distToPinYd} yd left: a chip, where the safe line leaves a wedge`);
  assert.ok(holeOut(g, 'hero line') <= 3, 'a birdie from there, at worst');
  // the average drive does not make the carry: ice, a stroke, and the lake still to cross
  g = newGame(id);
  r = hit(g, AVERAGE_DRIVE, 'average drive at the flag');
  assert.equal(r.penalty, 1, 'a 135 mph drive at the flag finds the ice');
  assert.match(r.note, /Water/);
  assert.equal(r.strokes, 2);
  assert.ok(r.end.y < 170 && r.distToPinYd > 150, `dropped on the near shore at (${r.end.x.toFixed(0)}, ${r.end.y.toFixed(0)})`);
  assert.equal(r.lie, 'rough');
  assert.equal(hit(newGame(id), swing(125, 14, 3000), 'a 125 mph drive at the flag').penalty, 1);
  // a pull and a push off the safe line are both in play
  for (const offDeg of [-14, -8, 8, 14]) {
    g = newGame(id);
    aimAt(g, turn);
    g.setAimOffset(g.aimOffset + offDeg);
    r = hit(g, DRIVE, `drive ${offDeg} deg off the safe line`);
    assert.equal(r.penalty, 0, `${offDeg} deg off the safe line: ${r.note}`);
  }
});

test('Frostbite Ridge: only a Rocket reaches the cirque, and the routes hold up in the strongest wind', (t) => {
  const id = 'frostbite-ridge';
  const { stage } = PIECES[id], turn = BUILT[id].course.holes[0].line[1];
  const inCirque = (g, r) => r.penalty === 0 && r.end.y > 346 && r.end.y < 425 && g.terrain.h(r.end.x, r.end.y) > 38;
  // no ordinary swing gets up there: even 165 mph at the flag finishes down by the green
  for (const mph of [150, 158, 165]) {
    const g = newGame(id), r = hit(g, swing(mph, 12, 2500), `${mph} mph at the flag`);
    assert.ok(g.terrain.h(r.end.x, r.end.y) < 15 && r.end.y < 340, `${mph} mph finishes at (${r.end.x.toFixed(0)}, ${r.end.y.toFixed(0)})`);
  }
  // the wind at its strongest: dead against, behind, and across from either side
  const top = stage.wind.max;
  for (const rel of [0, 90, 180, 270]) {
    // risky: a 150 mph drive still carries the ice
    let g = newGame(id);
    windAt(g, rel, top);
    let r = hit(g, DRIVE, `hero drive, ${top} mph from ${rel}`);
    assert.equal(r.penalty, 0, `the carry is on with ${top} mph from ${rel} degrees off the line (carry ${r.sim.carryYd} yd)`);
    assert.ok(r.distToPinYd < 70, `${r.distToPinYd} yd left`);
    // safe: the ridge holds the average drive, and there is a dry way home
    g = newGame(id);
    windAt(g, rel, top);
    aimAt(g, turn);
    r = hit(g, AVERAGE_DRIVE, `safe drive, ${top} mph from ${rel}`);
    assert.equal(r.penalty, 0);
    assert.ok(['fairway', 'rough'].includes(r.lie) && r.distToPinYd < 150, `the safe drive is on ${r.lie}, ${r.distToPinYd} yd out`);
  }
  // into that wind an average drive at the flag is on the ice, as it is in calm
  const calm = newGame(id);
  windAt(calm, 0, top);
  assert.equal(hit(calm, AVERAGE_DRIVE, 'average drive into the wind').penalty, 1);

  const mods = rocketMods();
  if (!mods) { t.diagnostic('lib/arcade.js has no Rocket to test with: skipped the rocket route'); return; }
  const rocket = (launch, label, wind = null) => {
    const g = newGame(id);
    if (wind) windAt(g, wind[0], wind[1]);
    g.shotMods = mods;
    const r = hit(g, launch, label);
    g.shotMods = null;
    return { g, r };
  };
  // a boosted drive, strong, average or weak, clears the lake, the green and the icefall
  for (const [label, launch] of [['150 mph', DRIVE], ['135 mph', AVERAGE_DRIVE], ['120 mph', swing(120, 14, 3000)]]) {
    const { g, r } = rocket(launch, `Rocket ${label}`);
    assert.ok(r.sim.carryYd > 385, `a Rocket ${label} drive carries ${r.sim.carryYd} yd`);
    assert.ok(inCirque(g, r), `and comes to rest in the cirque: (${r.end.x.toFixed(0)}, ${r.end.y.toFixed(0)}) at ${g.terrain.h(r.end.x, r.end.y).toFixed(0)} m on ${r.lie}`);
    assert.ok(r.distToPinYd > 60 && r.distToPinYd < 125, `${r.distToPinYd} yd above the flag`);
    // from there it is a flick straight down: a half wedge is on or beside the green
    g.setAimOffset(0);
    const flick = hit(g, swing(60, 34, 8000), `the flick after a Rocket ${label}`);
    assert.equal(flick.penalty, 0);
    assert.ok(flick.distToPinYd < 25, `the flick finishes ${flick.distToPinYd} yd from the flag on ${flick.lie}`);
    assert.ok(holeOut(g, `Rocket ${label}`) <= 4, 'a birdie look, a par at worst');
  }
  // a little left or right of the line is still caught by the cirque
  for (const aim of [-4, 4]) {
    const g = newGame(id);
    g.setAimOffset(aim);
    g.shotMods = mods;
    const r = hit(g, DRIVE, `Rocket ${aim} deg off`);
    g.shotMods = null;
    assert.ok(inCirque(g, r), `${aim} deg off the line: (${r.end.x.toFixed(0)}, ${r.end.y.toFixed(0)})`);
  }
  // into the strongest wind the 150 mph Rocket still gets up there; a weak one falls short of
  // the icefall and is left a chip from behind the green: never a penalty
  const head = rocket(DRIVE, 'Rocket into the wind', [0, top]);
  assert.ok(inCirque(head.g, head.r), `into ${top} mph: (${head.r.end.x.toFixed(0)}, ${head.r.end.y.toFixed(0)})`);
  const weak = rocket(swing(120, 14, 3000), 'weak Rocket into the wind', [0, top]);
  assert.equal(weak.r.penalty, 0);
  assert.ok(weak.r.distToPinYd < 40 || inCirque(weak.g, weak.r), `the weak one is ${weak.r.distToPinYd} yd from the flag`);
  // a boosted mid iron is another way to use it: straight onto the green
  const iron = rocket(IRON7, 'Rocket 7-iron');
  assert.ok(iron.r.penalty === 0 && iron.r.distToPinYd < 25, `a Rocket 7-iron finishes ${iron.r.distToPinYd} yd from the flag`);
});

// ---------------------------------------------------------------- Ice Pick


test('Ice Pick: a drop shot off a ledge to a bullseye on the tarn: snow short and long, ice either side, nothing hidden', () => {
  const g = newGame('ice-pick'), hole = g.hole, pin = hole.pin;
  const { cirque } = PIECES['ice-pick'];
  // from the tee: the wall, the causeway, the green: a straight shot never crosses ice, short or long
  const line = along(g.surfaceAt, hole.tee, [pin[0], pin[1] + 60]);
  assert.ok(!line.includes('water'), 'snow in front of the green and behind it on the line of the shot');
  assert.ok(along(g.surfaceAt, hole.tee, pin).slice(-20).every((s) => s === 'green'));
  // ice left and right of the island; the causeway and the glacier's tongue are the only ways off it
  const ring = (r) => Array.from({ length: 72 }, (_, i) => g.surfaceAt(pin[0] + r * Math.cos(i * 5 * Math.PI / 180), pin[1] + r * Math.sin(i * 5 * Math.PI / 180)));
  assert.ok(ring(19).every((s) => s === 'green'), 'a green 38 m across at the least');
  assert.ok(ring(25).every((s) => s === 'rough'), 'a collar of snow round it');
  const ice = ring(36).filter((s) => s === 'water').length;
  assert.ok(ice >= 50 && ice <= 58, `ice round ${ice * 5} degrees of the island`);
  for (const a of [0, 180]) assert.equal(ring(36)[a / 5], 'water', `ice at ${a} degrees`);
  for (const a of [90, 270]) assert.equal(ring(36)[a / 5], 'rough', `snow at ${a} degrees`);
  assert.deepEqual([g.terrain.h(-45, 96), g.terrain.h(45, 96)], [0, 0], 'the ice is level');
  assert.equal(g.surfaceAt(0, 160), 'rough', 'the far shore is dry');
  // forty metres down, and the whole target in plain view of the address camera
  const drop = g.terrain.h(0, 0) - g.terrain.h(pin[0], pin[1]);
  assert.ok(drop >= 38 && drop <= 44, `${drop.toFixed(1)} m down`);
  assert.ok(teeCameraClearance(g, pin[0], pin[1]) > 0.25, 'the flag is in view from the tee');
  for (let a = 0; a < 360; a += 30) {
    const [x, y] = [pin[0] + 19 * Math.cos(a * Math.PI / 180), pin[1] + 19 * Math.sin(a * Math.PI / 180)];
    assert.ok(teeCameraClearance(g, x, y) > 0.25, `the edge of the green at ${a} degrees is in view from the tee`);
  }
  // a cirque: the crest stands 35 m and more above the ice all the way round, its horns twice that
  const crest = [];
  for (let deg = 0; deg < 360; deg += 15) crest.push(g.terrain.h(...cirque.at(deg, cirque.wallM + 12)));
  assert.ok(Math.min(...crest) > 35, `the lowest of the crest is ${Math.min(...crest).toFixed(0)} m up`);
  assert.ok(Math.max(...crest) > 65, `its highest horn is ${Math.max(...crest).toFixed(0)} m up`);
  // the two terraces cut into its walls: base camp to the east, the ice field's shelf to the west
  assert.ok(Math.abs(g.terrain.h(104, 92) - cirque.campH) < 0.6 && Math.abs(g.terrain.h(-100, 112) - cirque.shelfH) < 0.6);
  // the place is dressed in vignettes: a camp with its gallery, an ice field, seracs, flags
  const props = BUILT['ice-pick'].course.props, count = (kind) => props.filter((p) => p.kind === kind).length;
  assert.ok(props.length >= 150 && props.length <= 300, `${props.length} props`);
  assert.ok(count('ice-spire') >= 40 && count('crystal') >= 15 && count('cabin') >= 6 && count('flag-banner') >= 12 && count('snowman') >= 10);
  const onCamp = (p) => dist([p.x, p.y], [104, 92]) < 34;
  assert.ok(props.filter((p) => p.kind === 'cabin' && onCamp(p)).length >= 5 && props.filter((p) => p.kind === 'crowd' && onCamp(p)).length >= 2, 'base camp: cabins and a gallery');
  assert.ok(count('crowd') >= 5 && props.filter((p) => p.kind === 'crowd').every((p) => dist([p.x, p.y], pin) < 110), 'the crowd stands round the tarn');
  // nothing tall beside the ball: the camera looks straight down the line at the tarn
  assert.ok(props.every((p) => L.FLAT_PROP_KINDS.includes(p.kind) || L.FLOATING_PROP_KINDS.includes(p.kind) || Math.abs(p.x) >= 10 || p.y > 30 || p.y < -6), 'the view from the tee is clear');
});

test('Ice Pick: stock wedges hold the green, a spray mostly scores, the wind is a read and not a lottery', () => {
  const id = 'ice-pick';
  // the shot: 105 yd that plays 25 shorter. The game's lob wedge is the club, a soft sand wedge too.
  let g, r;
  for (const [name, launch] of [['a lob wedge', stock('LW')], ['a soft lob wedge', stock('LW', { Speed: 61 })], ['a soft sand wedge', stock('SW', { Speed: 70 })]]) {
    g = newGame(id);
    r = hit(g, launch, name);
    assert.equal(r.penalty, 0, name);
    assert.equal(r.lie, 'green', `${name} finishes on ${r.lie}`);
    assert.ok(r.distToPinYd < 12, `${name}: ${r.distToPinYd} yd from the flag`);
  }
  // too much club is long but dry, on the glacier's tongue; fat is on the causeway. Both score a distance.
  for (const [name, launch, lo, hi] of [['a full sand wedge', stock('SW'), 22, 40], ['a full pitching wedge', stock('PW'), 40, 60], ['fat', stock('LW', { Speed: 48 }), 15, 32]]) {
    g = newGame(id);
    r = hit(g, launch, name);
    assert.equal(r.penalty, 0, `${name}: dry`);
    assert.equal(r.lie, 'rough', name);
    assert.ok(r.distToPinYd > lo && r.distToPinYd < hi, `${name}: ${r.distToPinYd} yd`);
  }
  // 10 degrees off line is still on the green; 22 degrees is on the ice, which the match engine scores as a miss
  for (const offDeg of [10, -10]) {
    g = newGame(id);
    g.setAimOffset(offDeg);
    r = hit(g, stock('LW', { Speed: 64 }), `${offDeg} deg off`);
    assert.equal(r.penalty, 0);
    assert.equal(r.lie, 'green', `${offDeg} deg off line lies on ${r.lie}`);
  }
  for (const offDeg of [-22, 24]) {
    g = newGame(id);
    g.setAimOffset(offDeg);
    r = hit(g, stock('LW', { Speed: 64 }), `${offDeg} deg wide`);
    assert.equal(r.penalty, 1, `${offDeg} deg wide: on the ice`);
    assert.match(r.note, /Water/);
  }
  // a spray of plausible swings (speed, start line and curve all off a little): most score a distance
  let shots = 0, dry = 0, onGreen = 0;
  for (const k of ['LW', 'SW']) for (const scale of [0.92, 0.96, 1, 1.04, 1.08]) for (const HLA of [-6, -3, 0, 3, 6]) for (const SpinAxis of [-10, 0, 10]) {
    g = newGame(id);
    r = hit(g, stock(k, { Speed: CLUB_FULL[k].speedMph * scale, HLA, SpinAxis }), 'spray');
    shots++;
    if (!r.penalty) dry++;
    if (!r.penalty && r.lie === 'green') onGreen++;
  }
  assert.ok(dry / shots >= 0.8, `${dry} of ${shots} sprayed wedges score a distance`);
  assert.ok(onGreen / shots >= 0.55, `${onGreen} of ${shots} are on the green`);
  // the wind (stage.wind, 5 to 14 mph): at its strongest, from any quarter, the stock lob wedge still
  // finds the green unadjusted, and a sensible adjustment gets it close
  const { wind } = PIECES[id].stage;
  assert.deepEqual(wind, { min: 5, max: 14 });
  for (const windFromDeg of [0, 45, 90, 180, 225, 270]) {
    g = newGame(id);
    g.setConditions({ windMph: wind.max, windFromDeg });
    r = hit(g, stock('LW'), `${wind.max} mph from ${windFromDeg}`);
    assert.equal(r.penalty, 0);
    assert.equal(r.lie, 'green', `a stock lob wedge in ${wind.max} mph from ${windFromDeg}: ${r.lie}`);
    let best = Infinity;
    for (const [k, scale] of [['LW', 0.9], ['LW', 1], ['LW', 1.1], ['SW', 0.9], ['SW', 1]]) for (let aim = -8; aim <= 8; aim += 2) {
      g = newGame(id);
      g.setConditions({ windMph: wind.max, windFromDeg });
      g.setAimOffset(aim);
      r = g.handleShot(stock(k, { Speed: CLUB_FULL[k].speedMph * scale }));
      if (!r.penalty && r.lie === 'green') best = Math.min(best, r.distToPinYd);
    }
    assert.ok(best < 6, `allowing for ${wind.max} mph from ${windFromDeg}: ${best} yd`);
  }
  // off the green there is always a chip and a putt
  g = newGame(id);
  hit(g, stock('LW', { Speed: 48 }), 'fat');
  assert.ok(holeOut(g, 'from the causeway') <= 4);
});
