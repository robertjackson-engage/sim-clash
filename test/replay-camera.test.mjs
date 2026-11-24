// v3:modes The cameras an instant replay films a shot with (public/arcade/replay-core.js):
// which one is chosen, that it is not the live camera, and, filmed frame by frame over real
// shots (test/helpers/camera-shots.mjs: the real physics, re-timed as the game plays them):
// the ball stays in the frame, the camera is never under the ground, behind ground or inside
// a prop, it moves continuously, it never flips, and time slows only by the pin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeShots, flights, ndc, address, DRIVER } from './helpers/camera-shots.mjs';
import { flightCameraPlan, flightCameraAt, liftCameraPath } from '../public/render/flight-camera.js';
import { smoothPointAt } from '../public/render/flight-profile.js';
import { warpShot } from '../public/arcade/feel.js';
import { replayCameraPlan, chooseReplayCamera, replaySim, trimSim, arrivalSim, replayOffer, replayBeatMs, REPLAY, REPLAY_CAMERAS } from '../public/arcade/replay-core.js';

const CLOSE = closeShots();
const FLIGHTS = flights();
const byName = (list, name) => list.find((s) => s.name === name);

function envOf(shot, extra = {}) {
  const { sim, pin, terrain } = shot;
  return {
    pin, flightTime: sim.flightTime, isPutt: !!sim.isPutt,
    holed: (sim.events || []).some((e) => e.type === 'holed'), cup: sim.cup || null,
    groundAt: (x, y) => terrain.h(x, y), treeTopAt: null, obstacles: [], fovDeg: 58, ...extra,
  };
}

// Film a replay plan at 60 fps and measure it.
function film(shot, plan, env, { sightFrom = 0, frameFrom = 0 } = {}) {
  const pts = shot.sim.points, endT = pts[pts.length - 1].t;
  const airEnd = env.isPutt ? 0 : Math.min(env.flightTime, endT);
  const end = endT + (plan.tail || 0);
  const m = { frames: [], maxStep: 0, maxTurn: 0, maxNdc: 0, minClear: Infinity, minSight: Infinity, maxBallStep: 0, minDepth: Infinity };
  let prev = null;
  for (let t = 0; t <= end + 1e-9; t += 1 / 60) {
    const b = smoothPointAt(pts, Math.min(t, endT), airEnd);
    const g = env.groundAt(b.x, b.y);
    const ball = { x: b.x, y: b.y, z: Math.max(b.z, g) + 0.09 };
    const cam = flightCameraAt(plan, t, pts);
    const v = [cam.look.x - cam.pos.x, cam.look.y - cam.pos.y, cam.look.z - cam.pos.z], l = Math.hypot(...v);
    const dir = v.map((x) => x / l);
    const n = ndc(cam, ball);
    const f = { t, cam, ball, dir, n, clear: cam.pos.z - env.groundAt(cam.pos.x, cam.pos.y) };
    if (prev) {
      m.maxStep = Math.max(m.maxStep, Math.hypot(cam.pos.x - prev.cam.pos.x, cam.pos.y - prev.cam.pos.y, cam.pos.z - prev.cam.pos.z));
      m.maxTurn = Math.max(m.maxTurn, Math.acos(Math.min(1, dir[0] * prev.dir[0] + dir[1] * prev.dir[1] + dir[2] * prev.dir[2])) * 180 / Math.PI);
      m.maxBallStep = Math.max(m.maxBallStep, Math.hypot(ball.x - prev.ball.x, ball.y - prev.ball.y, ball.z - prev.ball.z));
    }
    if (t >= sightFrom) for (const u of [0.15, 0.3, 0.45, 0.6, 0.75]) {
      const x = cam.pos.x + (ball.x - cam.pos.x) * u, y = cam.pos.y + (ball.y - cam.pos.y) * u;
      m.minSight = Math.min(m.minSight, cam.pos.z + (ball.z - cam.pos.z) * u - env.groundAt(x, y));
    }
    if (t >= frameFrom) {
      m.maxNdc = Math.max(m.maxNdc, n.depth > 0 ? Math.max(Math.abs(n.x), Math.abs(n.y)) : 9);
      m.minDepth = Math.min(m.minDepth, n.depth);
    }
    m.minClear = Math.min(m.minClear, f.clear);
    m.frames.push(f);
    prev = f;
  }
  return m;
}

test('which camera films a shot again: the tripod by the cup, the trace from above, the reverse angle', () => {
  for (const s of CLOSE) assert.equal(chooseReplayCamera(s.sim.points, envOf(s)), 'greenside', s.name);
  assert.equal(chooseReplayCamera(byName(FLIGHTS, 'drive').sim.points, envOf(byName(FLIGHTS, 'drive'))), 'topdown');
  assert.equal(chooseReplayCamera(byName(FLIGHTS, 'rocket drive of 500 yd').sim.points, envOf(byName(FLIGHTS, 'rocket drive of 500 yd'))), 'topdown');
  assert.equal(chooseReplayCamera(byName(FLIGHTS, 'high wedge').sim.points, envOf(byName(FLIGHTS, 'high wedge'))), 'reverse');
  assert.deepEqual([...REPLAY_CAMERAS].sort(), ['greenside', 'reverse', 'topdown']);
  assert.equal(REPLAY.bigDriveM, 165);
});

test('a replay is never the live camera: it cuts somewhere else and stays somewhere else', () => {
  for (const s of [...CLOSE, ...FLIGHTS]) {
    const env = envOf(s);
    const plan = replayCameraPlan(s.sim.points, env);
    assert.ok(plan, s.name);
    const pts = s.sim.points;
    const target = s.pin && Math.hypot(s.pin.x - pts[0].x, s.pin.y - pts[0].y) < 400 ? s.pin : { x: pts[0].x, y: pts[0].y + 1 };
    const start = address(pts[0], target, env.groundAt);
    const live = flightCameraPlan(pts, { ...start, ...env, mode: 'ball', isClear: () => true });
    const end = pts[pts.length - 1].t;
    let sum = 0, k = 0;
    for (let t = 0; t <= end; t += 0.1) {
      const a = flightCameraAt(plan, t, pts).pos, b = flightCameraAt(live, t, pts).pos;
      sum += Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); k++;
    }
    const first = flightCameraAt(plan, 0, pts).pos;
    assert.ok(Math.hypot(first.x - start.startCam.x, first.y - start.startCam.y, first.z - start.startCam.z) > 4, `${s.name}: it starts where the address camera stood`);
    assert.ok(sum / k > 4, `${s.name}: on average ${(sum / k).toFixed(1)} m from the ball cam`);
  }
});

test('every camera, filmed frame by frame: the ball in the frame, above the ground, in plain sight, one continuous move', () => {
  for (const s of [...CLOSE, ...FLIGHTS]) {
    for (const kind of REPLAY_CAMERAS) {
      const env = envOf(s);
      const plan = replayCameraPlan(s.sim.points, { ...env, kind });
      assert.ok(plan, `${s.name} / ${kind}`);
      // (the tripod watches the ball ARRIVE: from a butte it cannot see the tee below its rim, and need not)
      // (... and while the ball is in the air it frames the green: the ball drops into its picture just before it lands)
      const tripod = plan.replay === 'greenside' && !env.isPutt;
      const m = film(s, plan, env, { sightFrom: tripod ? env.flightTime * 0.75 : 0, frameFrom: tripod ? env.flightTime - 0.2 : 0 });
      const tag = `${s.name} / asked ${kind}, got ${plan.replay}`;
      assert.ok(m.maxNdc <= 0.97, `${tag}: the ball leaves the frame (${m.maxNdc.toFixed(2)})`);
      assert.ok(m.minDepth > 0.5, `${tag}: the ball is behind the camera`);
      assert.ok(m.minClear >= 0.45, `${tag}: ${m.minClear.toFixed(2)} m above the ground`);
      assert.ok(m.minSight >= -0.02, `${tag}: ground between the camera and the ball (${m.minSight.toFixed(2)})`);
      assert.ok(m.maxStep <= m.maxBallStep * 1.5 + 0.35, `${tag}: a jump of ${m.maxStep.toFixed(2)} m in a frame (the ball: ${m.maxBallStep.toFixed(2)})`);
      assert.ok(m.maxTurn <= 14, `${tag}: the view swings ${m.maxTurn.toFixed(1)} degrees in a frame`);
      for (const k of ['zoom', 'roll', 'ballScale']) assert.equal(plan.path[k].length, plan.path.pos.length, `${tag}: ${k}`);
      assert.ok(plan.path.zoom.every((z) => z >= 0.99 && z <= 3.5), `${tag}: lens`);
    }
  }
});

test('the reverse angle stays ahead of the ball and never flips; the trace keeps one heading; the tripod stands still', () => {
  for (const s of FLIGHTS) {
    const env = envOf(s);
    const pts = s.sim.points, p0 = pts[0], endT = pts[pts.length - 1].t;
    // reverse: ahead of the ball along the way it is going, all the way down
    const rev = replayCameraPlan(pts, { ...env, kind: 'reverse' });
    assert.equal(rev.replay, 'reverse', s.name);
    const ft = Math.min(env.flightTime, endT);
    let heading = null;
    for (let t = 0.3; t < ft - 1.35; t += 0.05) {   // (from 1.3 s before touchdown it is on its way to where it waits: checked below)
      const b = smoothPointAt(pts, t, ft), b2 = smoothPointAt(pts, t + 0.1, ft);
      const L = Math.hypot(b2.x - b.x, b2.y - b.y);
      // (held as the camera holds it: a ball knocked back the way it came does not turn it round)
      if (L > 0.3) { const h = [(b2.x - b.x) / L, (b2.y - b.y) / L]; if (!heading || h[0] * heading[0] + h[1] * heading[1] > -0.2) heading = h; }
      if (!heading) continue;
      const c = flightCameraAt(rev, t, pts).pos;
      assert.ok((c.x - b.x) * heading[0] + (c.y - b.y) * heading[1] > 1, `${s.name}: the reverse angle fell behind the ball at ${t.toFixed(2)} s`);
    }
    if (heading && s.name !== 'into the butte wall') {   // (that one comes back down the wall: the camera is held where the ball was going)
      const last = pts[pts.length - 1], c = flightCameraAt(rev, endT, pts).pos;
      assert.ok((c.x - last.x) * heading[0] + (c.y - last.y) * heading[1] > 1, `${s.name}: it waits beyond the finish`);
    }
    // topdown: the look never comes back past the vertical, the camera is high
    const sky = replayCameraPlan(pts, { ...env, kind: 'topdown' });
    assert.equal(sky.replay, 'topdown', s.name);
    const land = sky.land, fl = Math.hypot(land.x - p0.x, land.y - p0.y), f = [(land.x - p0.x) / fl, (land.y - p0.y) / fl];
    for (let t = 0; t <= endT; t += 0.1) {
      const c = flightCameraAt(sky, t, pts);
      assert.ok((c.look.x - c.pos.x) * f[0] + (c.look.y - c.pos.y) * f[1] > 0, `${s.name}: the trace turned round at ${t.toFixed(1)} s`);
      assert.ok(c.pos.z - env.groundAt(c.pos.x, c.pos.y) >= 20, `${s.name}: the trace is low`);
      assert.ok(c.pos.z - c.look.z > 1.2 * Math.hypot(c.look.x - c.pos.x, c.look.y - c.pos.y) - 1e-6 || t > env.flightTime, `${s.name}: the trace looks down`);
    }
  }
  for (const s of CLOSE) {
    const env = envOf(s);
    const plan = replayCameraPlan(s.sim.points, env);
    assert.equal(plan.replay, 'greenside', s.name);
    const a = plan.path.pos[0], b = plan.path.pos[plan.path.pos.length - 1];
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= 0.6, `${s.name}: the tripod walked`);
    // beyond the cup, as the ball comes at it: the cup is between the camera and where the ball was hit from
    const p0 = s.sim.points[0];
    const toPin = [s.pin.x - p0.x, s.pin.y - p0.y];
    assert.ok((a.x - s.pin.x) * toPin[0] + (a.y - s.pin.y) * toPin[1] > 0, `${s.name}: the tripod is on the tee's side of the cup`);
    assert.ok(a.z - env.groundAt(a.x, a.y) <= 2.7, `${s.name}: the tripod is low`);
    assert.ok(plan.pinCam, `${s.name}: the flagstick comes out for it`);
    // at the end both the ball and the cup are in the frame
    const endT = s.sim.points[s.sim.points.length - 1].t;
    const cam = flightCameraAt(plan, endT, s.sim.points);
    const cupN = ndc(cam, { x: s.pin.x, y: s.pin.y, z: 0.05 });
    assert.ok(cupN.depth > 0 && Math.abs(cupN.x) < 1 && Math.abs(cupN.y) < 1, `${s.name}: the cup is out of the frame at the end`);
  }
});

test('a replay camera keeps out of the props, and out of the trees', () => {
  const drive = byName(FLIGHTS, 'drive');
  const pts = drive.sim.points;
  // a tower on the line 100 m out, and a low hut 60 m out, where the reverse angle flies
  const tower = { x: 2, y: 100, r: 6, base: 0, top: 80 };
  const hut = { x: -3, y: 60, r: 4, base: 0, top: 5 };
  const env = envOf(drive, { obstacles: [tower, hut] });
  const plan = replayCameraPlan(pts, { ...env, kind: 'reverse' });
  const endT = pts[pts.length - 1].t + plan.tail;
  for (let t = 0; t <= endT; t += 1 / 60) {
    const c = flightCameraAt(plan, t, pts).pos;
    for (const o of [tower, hut]) {
      const inside = Math.hypot(c.x - o.x, c.y - o.y) < o.r && c.z < o.top;
      assert.ok(!inside, `the reverse angle is inside the ${o === tower ? 'tower' : 'hut'} at ${t.toFixed(2)} s`);
    }
    assert.ok(c.z < 60, 'it went round the tower, not over it');
  }
  // trees over the whole landing area: the camera rides above the crowns
  const crowns = (x, y) => (y > 120 && y < 260 ? 12 : -Infinity);
  const wooded = replayCameraPlan(pts, { ...envOf(drive, { treeTopAt: crowns }), kind: 'reverse' });
  for (let t = 0; t <= endT; t += 1 / 60) {
    const c = flightCameraAt(wooded, t, pts).pos;
    if (c.y > 121 && c.y < 259) assert.ok(c.z >= 12 - 1e-6, `under the crowns at ${t.toFixed(2)} s (${c.z.toFixed(1)} m)`);
  }
  // the tripod: a statue standing on its favourite spot sends it to another one, and it never looks through one
  const s = byName(CLOSE, '7-iron that releases 30 ft and drops');
  const free = replayCameraPlan(s.sim.points, envOf(s));
  const spot = free.path.pos[0];
  const statue = { x: spot.x, y: spot.y, r: 1.5, base: 0, top: 6 };
  const moved = replayCameraPlan(s.sim.points, envOf(s, { obstacles: [statue] }));
  assert.equal(moved.replay, 'greenside');
  const at = moved.path.pos[0];
  assert.ok(Math.hypot(at.x - statue.x, at.y - statue.y) > statue.r + 1, 'the tripod stands in the statue');
  // nowhere to stand (a wall all round the green): the next camera films it
  const pit = (x, y) => (Math.hypot(x - s.pin.x, y - s.pin.y) > 3 ? 30 : 0);
  const fallback = replayCameraPlan(s.sim.points, { ...envOf(s), groundAt: pit });
  assert.ok(fallback && fallback.replay !== 'greenside', 'the tripod stood in a wall');
});

test('liftCameraPath: over the ground, over what must be cleared, over ground in the way of the ball', () => {
  const pos = Array.from({ length: 120 }, (_, i) => ({ x: 0, y: i, z: 1 }));
  const ridge = (x, y) => (y > 70 && y < 80 ? 6 : 0);
  const balls = pos.map((c) => ({ x: 0, y: c.y + 30, z: ridge(0, c.y + 30) + 0.1 }));
  liftCameraPath(pos, balls, { dt: 1 / 60, groundAt: ridge, topAt: (x, y) => (y > 20 && y < 25 ? 9 : -Infinity), clearM: 2 });
  assert.ok(pos.every((c) => c.z >= ridge(c.x, c.y) + 2 - 1e-9));
  assert.ok(pos.filter((c) => c.y > 20 && c.y < 25).every((c) => c.z >= 9));
  for (let i = 0; i < pos.length; i++) {   // the sight line clears the ridge
    for (const u of [0.2, 0.4, 0.6, 0.78]) {
      const y = pos[i].y + (balls[i].y - pos[i].y) * u;
      assert.ok(pos[i].z + (balls[i].z + 0.1 - pos[i].z) * u >= ridge(0, y) - 0.01, `sample ${i}`);
    }
  }
  for (let i = 1; i < pos.length; i++) assert.ok(Math.abs(pos[i].z - pos[i - 1].z) < 3, 'the lift is a ramp, not a step');
});

test('time slows only by the pin: a replay has no hit-stop, and nothing at all away from the cup', () => {
  const drive = byName(FLIGHTS, 'drive');
  const live = warpShot(drive.raw, { pin: drive.pin, speedMph: DRIVER.speedMph });
  assert.ok(live.slowmo.some((w) => w.reason === 'strike'), 'live play has its hit-stop');
  assert.deepEqual(replaySim(drive.raw, { pin: drive.pin }).slowmo, []);
  for (const s of FLIGHTS) assert.deepEqual(replaySim(s.raw, { pin: s.pin }).slowmo, [], s.name);
  for (const s of CLOSE) {
    const sim = replaySim(s.raw, { pin: [s.pin.x, s.pin.y] });
    assert.ok(sim.slowmo.every((w) => w.reason === 'holing' || w.reason === 'lip'), s.name);
    // and exactly what live play has by the pin
    const was = warpShot(s.raw, { pin: s.pin }).slowmo;
    assert.deepEqual(sim.slowmo, was, s.name);
    if (s.want === 'holed') assert.ok(sim.slowmo.some((w) => w.reason === 'holing') && sim.cup, s.name);
    // the ball goes where the server said: only the clock is the replay's
    const a = s.raw.points[s.raw.points.length - 1], b = sim.points[sim.points.length - 1];
    if (s.want !== 'holed') assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-6, s.name);
  }
});

test('what the page is told: a marked shot is offered or played by itself; an unmarked one is neither', () => {
  const pts = [{ t: 0, x: 0, y: 0, z: 0 }, { t: 1, x: 0, y: 10, z: 0 }];
  assert.equal(replayOffer({ sim: { points: pts } }), null);
  assert.equal(replayOffer({ highlight: { id: 'h1', why: ['holed'], auto: true } }), null);
  assert.deepEqual(replayOffer({ sim: { points: pts }, highlight: { id: 'h1', why: ['holed'], auto: true, title: 'HOLED IT' } }), { id: 'h1', why: ['holed'], auto: true, title: 'HOLED IT' });
  assert.equal(replayOffer({ sim: { points: pts }, highlight: { id: 'h2', why: ['epic'] } }).auto, false);
  assert.ok(replayBeatMs({ arcade: { callout: { tone: 'epic' } } }) > replayBeatMs({}));
  assert.equal(replayCameraPlan([], {}), null);
});

test('the tripod films the arrival: the green in the picture while the ball is in the air, and only the last seconds of the flight', () => {
  const s = byName(CLOSE, '7-iron that releases 30 ft and drops');
  const env = envOf(s);
  const plan = replayCameraPlan(s.sim.points, env);
  assert.equal(plan.replay, 'greenside');
  // at impact it is not chasing the ball: the cup is in the lower half of its frame, the lens is wide
  const c0 = flightCameraAt(plan, 0, s.sim.points);
  const cup0 = ndc(c0, { x: s.pin.x, y: s.pin.y, z: 0.05 });
  assert.ok(cup0.depth > 0 && Math.abs(cup0.x) < 0.9 && cup0.y < 0 && cup0.y > -0.95, `the cup at impact: ${JSON.stringify(cup0)}`);
  assert.ok(c0.zoom < 1.1, 'a wide lens while it waits');
  assert.ok(c0.look.z > c0.pos.z, 'pitched up: the sky the ball comes out of is in the picture');

  // the replay's own clock: the last 2.6 s of the flight, then everything
  const sim = arrivalSim(s.sim, { pin: s.pin });
  const ft = s.sim.flightTime;
  assert.ok(Math.abs(sim.flightTime - 2.6) < 1e-9 && Math.abs(sim.trimmedS - (ft - 2.6)) < 1e-9);
  assert.equal(sim.points[0].t, 0);
  for (let i = 1; i < sim.points.length; i++) assert.ok(sim.points[i].t > sim.points[i - 1].t);
  const a = s.sim.points[s.sim.points.length - 1], b = sim.points[sim.points.length - 1];
  assert.deepEqual([b.x, b.y, b.z], [a.x, a.y, a.z], 'the ball finishes where it finished');
  assert.ok(Math.abs((a.t - b.t) - sim.trimmedS) < 1e-9);
  // the drop into the cup and the slow motion moved with the clock (and there is still none away from the pin)
  assert.ok(Math.abs((s.sim.cup.tDrop - sim.cup.tDrop) - sim.trimmedS) < 1e-9);
  assert.ok(Math.abs((s.sim.cupDropT - sim.cupDropT) - sim.trimmedS) < 1e-9);
  const ev = (x) => x.events.find((e) => e.type === 'cup-drop');
  assert.ok(Math.abs((ev(s.sim).t0 - ev(sim).t0) - sim.trimmedS) < 1e-9);
  const byPin = s.sim.slowmo.filter((w) => w.reason !== 'strike');   // (the helper plays it as live play does: with its hit-stop, long gone by then)
  assert.equal(sim.slowmo.length, byPin.length);
  assert.ok(sim.slowmo.every((w, i) => w.reason === byPin[i].reason && Math.abs((byPin[i].t1 - w.t1) - sim.trimmedS) < 1e-9 && w.t0 >= 0));
  // the trimmed path films cleanly from the same tripod
  const tEnv = { ...env, flightTime: sim.flightTime, cup: sim.cup };
  const tPlan = replayCameraPlan(sim.points, tEnv);
  assert.equal(tPlan.replay, 'greenside');
  const m = film({ ...s, sim }, tPlan, tEnv, { sightFrom: sim.flightTime * 0.75, frameFrom: sim.flightTime - 0.2 });
  assert.ok(m.maxNdc <= 0.97 && m.minClear >= 0.45 && m.maxTurn <= 14, JSON.stringify([m.maxNdc, m.minClear, m.maxTurn]));

  // not for a putt, a short flight, or a shot that finishes nowhere near the cup (its carry is still called)
  const putt = byName(CLOSE, '40 ft putt that drops');
  assert.equal(arrivalSim(putt.sim, { pin: putt.pin }), putt.sim);
  const chip = byName(CLOSE, 'chip-in');
  assert.equal(arrivalSim(chip.sim, { pin: chip.pin }), chip.sim);
  const drive = byName(FLIGHTS, 'drive');
  assert.equal(arrivalSim(drive.sim, { pin: drive.pin }), drive.sim);
  assert.equal(trimSim(drive.sim, 0), drive.sim);
  assert.equal(trimSim(drive.sim, 1e6), drive.sim);
});
