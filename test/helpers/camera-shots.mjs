// Realistic shots for the camera tests (test/ball-camera.test.mjs): flown by the real
// physics (lib/physics.js), re-timed by the arcade feel (public/arcade/feel.js) exactly as
// the game plays them, and a pass over the whole playback that measures what the camera did.
import { createRequire } from 'node:module';
import { warpShot } from '../../public/arcade/feel.js';
import { flightCameraPlan, flightCameraAt } from '../../public/render/flight-camera.js';
import { smoothPointAt } from '../../public/render/flight-profile.js';

const require = createRequire(import.meta.url);
const { simulateShot } = require('../../lib/physics.js');
const { solvePutt } = require('../../lib/putt-assist.js');

export const FLAT = { h: () => 0, grad: () => ({ dx: 0, dy: 0 }) };
const green = () => 'green';
const fairway = () => 'fairway';
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// the address camera: behind the ball on the line to the target, as scene.js _idleTargets has it
export function address(from, toward, groundAt = () => 0) {
  const dx = toward.x - from.x, dy = toward.y - from.y, L = Math.hypot(dx, dy) || 1;
  const cx = from.x - dx / L * 14, cy = from.y - dy / L * 14;
  const cz = Math.max(groundAt(cx, cy) + 1.7, groundAt(from.x, from.y) + 4.6);
  return {
    startCam: { x: cx, y: cy, z: cz },
    startLook: { x: cx + dx / L * 80, y: cy + dy / L * 80, z: cz - 80 * Math.tan(0.12) },
  };
}

// a shot as the game plays it: { sim (re-timed), raw, pin, terrain, name }
function play(name, launch, { from = { x: 0, y: 0 }, aimDeg = 0, surf = fairway, pin = null, terrain = FLAT, opts = {}, warp = {} } = {}) {
  const raw = simulateShot(launch, from, aimDeg, surf, { terrain, ...(pin ? { pin } : {}), ...opts });
  const sim = warpShot(raw, { pin, speedMph: launch.speedMph, ...warp });
  return { name, raw, sim, pin, terrain, launch, from, aimDeg };
}
// where the ball is on its roll once it has slowed to `mps`, at least `afterM` past its landing
function onRoll(raw, mps, afterM = 0) {
  const p = raw.points;
  for (let i = 2; i < p.length; i++) {
    if (p[i].t <= raw.flightTime + 0.2 || dist(p[i], raw.land) < afterM) continue;
    const v = dist(p[i], p[i - 1]) / Math.max(1e-6, p[i].t - p[i - 1].t);
    if (v < mps) return { x: p[i].x, y: p[i].y };
  }
  return { ...raw.end };
}

export const WEDGE = { speedMph: 88, vla: 28, hla: 0, totalSpin: 10500, spinAxis: 0 };
export const SEVEN = { speedMph: 114, vla: 19.5, hla: 0, totalSpin: 6800, spinAxis: 0 };
export const DRIVER = { speedMph: 160, vla: 12, hla: 0, totalSpin: 2500, spinAxis: 0 };

// ---- the finishes by the flag ----
export function closeShots() {
  const out = [];
  {   // a wedge that spins back to a foot
    const free = simulateShot(WEDGE, { x: 0, y: 0 }, 0, green, {});
    const pin = { x: free.end.x + 0.2, y: free.end.y - 0.25 };
    out.push({ ...play('wedge that spins back to a foot', WEDGE, { surf: green, pin }), want: 'close' });
  }
  {   // a 7-iron that pitches short, releases 30 ft and drops
    const runner = { speedMph: 114, vla: 17, hla: 0, totalSpin: 3000, spinAxis: 0 };
    const free = simulateShot(runner, { x: 0, y: 0 }, 0, fairway, {});
    const pin = onRoll(free, 2.2, 9);
    out.push({ ...play('7-iron that releases 30 ft and drops', runner, { surf: fairway, pin }), want: 'holed' });
  }
  {   // a 7-iron that pitches past the flag and spins back into the hole
    const free = simulateShot(SEVEN, { x: 0, y: 0 }, 0, green, {});
    const pin = onRoll(free, 2.4, 6);
    out.push({ ...play('7-iron that spins back into the hole', SEVEN, { surf: green, pin }), want: 'holed', back: true });
  }
  {   // a chip-in
    const chip = { speedMph: 26, vla: 30, hla: 0, totalSpin: 3000, spinAxis: 0 };
    const free = simulateShot(chip, { x: 0, y: 0 }, 0, green, {});
    const pin = onRoll(free, 1.6, 2);
    out.push({ ...play('chip-in', chip, { surf: green, pin }), want: 'holed' });
  }
  for (const [name, ft] of [['40 ft putt that drops', 40], ['6 ft putt', 6]]) {
    const pin = { x: 0.4, y: ft * 0.3048 };
    const s = solvePutt({ from: { x: 0, y: 0 }, pin, surfaceAt: green, terrain: undefined });
    out.push({
      ...play(name, { speedMph: s.speedMph, vla: 0, hla: 0, totalSpin: 0, spinAxis: 0 },
        { aimDeg: s.bearingDeg, surf: green, pin, opts: { putt: true } }), want: 'holed',
    });
  }
  {   // a lip-out: a putt with pace sliding past the edge
    const pin = { x: 0.33, y: 5 };
    out.push({
      ...play('lip-out', { speedMph: 7.5, vla: 0, hla: 0, totalSpin: 0, spinAxis: 0 }, { surf: green, pin, opts: { putt: true } }),
      want: 'lip',
    });
  }
  {   // a slam dunk: a ball that sticks where it pitches, on the pin
    const sticky = { bounceScale: 0, keepScale: 0.15 };
    const free = simulateShot(WEDGE, { x: 0, y: 0 }, 0, green, sticky);
    const pin = { x: free.land.x + 0.05, y: free.land.y + 0.1 };
    out.push({ ...play('slam dunk', WEDGE, { surf: green, pin, opts: sticky }), want: 'holed', direct: true });
  }
  {   // a ball that stops 10 ft away
    const free = simulateShot(SEVEN, { x: 0, y: 0 }, 0, green, {});
    const pin = { x: free.end.x + 2.2, y: free.end.y + 2.1 };
    out.push({ ...play('stops 10 ft away', SEVEN, { surf: green, pin }), want: 'close' });
  }
  return out;
}

// ---- whole flights ----
// a tee on a plateau `dropM` above everything past `edgeY` (a cliff, eased over 6 m)
const cliff = (dropM, edgeY = 25) => {
  const h = (x, y) => { const u = Math.min(1, Math.max(0, (y - edgeY) / 6)); return dropM * (1 - u * u * (3 - 2 * u)); };
  return { h, grad: (x, y) => ({ dx: 0, dy: (h(x, y + 0.05) - h(x, y - 0.05)) / 0.1 }) };
};
// a butte: ground `riseM` higher beyond `wallY` (a wall, eased over 8 m)
const butte = (riseM, wallY) => {
  const h = (x, y) => { const u = Math.min(1, Math.max(0, (y - wallY) / 8)); return riseM * u * u * (3 - 2 * u); };
  return { h, grad: (x, y) => ({ dx: 0, dy: (h(x, y + 0.05) - h(x, y - 0.05)) / 0.1 }) };
};
export function flights() {
  const far = { x: 0, y: 2000 };   // a pin nowhere near
  const up = { speedMph: 175, vla: 40, hla: 0, totalSpin: 5200, spinAxis: 0 };
  const short = { speedMph: 150, vla: 36, hla: 0, totalSpin: 6000, spinAxis: 0 };   // into the wall, and back down it
  return [
    play('drive', DRIVER, { pin: far }),
    play('rocket drive of 500 yd', { ...DRIVER, speedMph: 245, vla: 13 }, { pin: far, opts: { dragScale: 0.62 }, warp: { powerup: 'rocket' } }),
    play('high wedge', { speedMph: 78, vla: 36, hla: 0, totalSpin: 9500, spinAxis: 0 }, { pin: far }),
    play('big slice', { ...DRIVER, speedMph: 150, hla: -4, spinAxis: 28, totalSpin: 3600 }, { pin: far }),
    play('off a 60 m cliff', SEVEN, { pin: far, terrain: cliff(60) }),
    play('up to a butte 80 m above', up, { pin: far, terrain: butte(80, 110) }),
    play('into the butte wall', short, { pin: far, terrain: butte(80, 150) }),
  ];
}

// Where a point sits in the frame (NDC, +-1 at the edges) for a camera pose and lens.
export function ndc(cam, p, { fovDeg = 58, aspect = 16 / 9 } = {}) {
  const sub = (a, b) => [a.x - b.x, a.y - b.y, a.z - b.z];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const f = norm(sub(cam.look, cam.pos));
  const r = norm(cross(f, [0, 0, 1]));
  const u = cross(r, f);
  const b = sub(p, cam.pos);
  const tanHalf = Math.tan((fovDeg / 2) * Math.PI / 180) / (cam.zoom || 1);
  const depth = dot(b, f);
  return { x: dot(b, r) / depth / (tanHalf * aspect), y: dot(b, u) / depth / tanHalf, depth };
}

/**
 * Film a shot with the given camera mode and measure the whole playback at 60 fps.
 * Returns { plan, end, frames:[{ t, cam, ball, ballNdc, ... }], and the worst of each thing }.
 */
// v2:seeover start: { startCam, startLook, startVel? } films from another address pose (the see-over camera's, the view from above)
export function film(shot, { mode = 'ball', treeTopAt = null, fps = 60, start = null } = {}) {
  const { sim, pin, terrain } = shot;
  const pts = sim.points, isPutt = !!sim.isPutt;
  const groundAt = (x, y) => terrain.h(x, y);
  const holed = (sim.events || []).some((e) => e.type === 'holed');
  const ft = sim.flightTime;
  const target = pin && dist(pin, pts[0]) < 400 ? pin : { x: pts[0].x + Math.sin(shot.aimDeg * Math.PI / 180), y: pts[0].y + Math.cos(shot.aimDeg * Math.PI / 180) };
  const plan = flightCameraPlan(pts, {
    ...(start || address(pts[0], target, groundAt)), flightTime: ft, isPutt, fovDeg: 58, mode,
    groundAt, treeTopAt, isClear: () => true, pin, holed, cup: sim.cup || null,
  });
  const end = pts[pts.length - 1].t + (plan.tail || 0);
  const airEnd = isPutt ? 0 : ft;
  const m = {
    plan, end, frames: [], maxStep: 0, maxTurn: 0, maxNdc: 0, minDist: Infinity, minClear: Infinity,
    minAhead: Infinity, maxRoll: 0, minZoom: Infinity, maxZoom: 0, maxKick: 0, maxBallStep: 0, minSight: Infinity,
  };
  // the way the ball was heading as it came in (held from touchdown): the side the camera must stay on
  let prev = null, heading = null;
  const h = 1 / fps;
  for (let t = 0; t <= end + 1e-9; t += h) {
    const tb = Math.min(t, pts[pts.length - 1].t);
    const b = smoothPointAt(pts, tb, airEnd);
    const g = groundAt(b.x, b.y);
    const ball = { x: b.x, y: b.y, z: Math.max(b.z, g) + 0.09 };   // as drawn: on the turf, never under it
    const cam = flightCameraAt(plan, t, pts);
    const dir = (() => { const v = [cam.look.x - cam.pos.x, cam.look.y - cam.pos.y, cam.look.z - cam.pos.z]; const l = Math.hypot(...v); return v.map((x) => x / l); })();
    if (t <= airEnd - 0.1 || heading === null) {
      const b2 = smoothPointAt(pts, Math.min(tb + 0.1, pts[pts.length - 1].t), airEnd);
      const vx = b2.x - b.x, vy = b2.y - b.y, L = Math.hypot(vx, vy);
      if (L > 0.3) heading = [vx / L, vy / L];
      else if (heading === null) heading = [Math.sin(shot.aimDeg * Math.PI / 180), Math.cos(shot.aimDeg * Math.PI / 180)];
    }
    const n = ndc(cam, ball);
    const d = Math.hypot(ball.x - cam.pos.x, ball.y - cam.pos.y, ball.z - cam.pos.z);
    const clear = cam.pos.z - groundAt(cam.pos.x, cam.pos.y);
    const ahead = (ball.x - cam.pos.x) * dir[0] + (ball.y - cam.pos.y) * dir[1] + (ball.z - cam.pos.z) * dir[2];
    const f = { t, cam, ball, ballNdc: n, dist: d, clear, ahead, dir };
    if (prev) {
      f.step = Math.hypot(cam.pos.x - prev.cam.pos.x, cam.pos.y - prev.cam.pos.y, cam.pos.z - prev.cam.pos.z);
      f.turn = Math.acos(Math.min(1, dir[0] * prev.dir[0] + dir[1] * prev.dir[1] + dir[2] * prev.dir[2])) * 180 / Math.PI;
      m.maxStep = Math.max(m.maxStep, f.step);
      m.maxTurn = Math.max(m.maxTurn, f.turn);
      // how much its velocity changes in one frame (m per frame, per frame): a jump would show here
      if (prev.step !== undefined) {
        const v0 = [prev.cam.pos.x - prev.from.x, prev.cam.pos.y - prev.from.y, prev.cam.pos.z - prev.from.z];
        const v1 = [cam.pos.x - prev.cam.pos.x, cam.pos.y - prev.cam.pos.y, cam.pos.z - prev.cam.pos.z];
        m.maxKick = Math.max(m.maxKick, Math.hypot(v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]));
      }
      f.from = prev.cam.pos;
      m.maxBallStep = Math.max(m.maxBallStep, Math.hypot(ball.x - prev.ball.x, ball.y - prev.ball.y, ball.z - prev.ball.z));
    }
    // the ground between the camera and the ball: how far under the line of sight it stays
    if (t > 0.6) {
      for (const u of [0.15, 0.3, 0.45, 0.6, 0.75]) {
        const x = cam.pos.x + (ball.x - cam.pos.x) * u, y = cam.pos.y + (ball.y - cam.pos.y) * u;
        m.minSight = Math.min(m.minSight, cam.pos.z + (ball.z - cam.pos.z) * u - groundAt(x, y));
      }
    }
    // on the tee side of the ball, along the way it came in
    f.behind = (ball.x - cam.pos.x) * heading[0] + (ball.y - cam.pos.y) * heading[1];
    if (t > 0.5) {
      m.maxNdc = Math.max(m.maxNdc, n.depth > 0 ? Math.max(Math.abs(n.x), Math.abs(n.y)) : 9);
      m.minAhead = Math.min(m.minAhead, f.behind);
    }
    m.minDist = Math.min(m.minDist, d);
    m.minClear = Math.min(m.minClear, clear);
    m.maxRoll = Math.max(m.maxRoll, Math.abs(cam.roll || 0));
    m.minZoom = Math.min(m.minZoom, cam.zoom ?? 1);
    m.maxZoom = Math.max(m.maxZoom, cam.zoom ?? 1);
    m.frames.push(f);
    prev = f;
  }
  m.at = (t) => m.frames[Math.min(m.frames.length - 1, Math.max(0, Math.round(t * fps)))];
  return m;
}
