// v3:modes Instant replay: the cameras, with no DOM in them (docs/modes.md "Instant replay
// and highlights"). public/arcade/replay.js plays a replay; test/replay-camera.test.mjs films
// every camera here frame by frame in Node.
//
// A replay shows a shot again from a camera that is NOT the one that filmed it live (the ball
// cam, which leaves the tee behind the ball). Three alternates, each one continuous move with
// no cut inside it, each worked out once from the known path:
//
//   'greenside'  a low tripod just beyond the cup (or beyond where the ball finishes), a
//                little off the line, watching the ball arrive: it tracks the ball out of the
//                sky and ends with ball and cup in one frame. For a ball that goes in, lips
//                out or finishes close, and for every putt.
//   'topdown'    high above the ball looking almost straight down, the way of the shot up the
//                screen, riding along as the tracer is drawn across the hole. For a big drive.
//   'reverse'    the chase from the opposite side: the camera flies AHEAD of the ball, looking
//                back at it as it comes, then waits beyond where it finishes and watches it
//                run in. For everything else.
//
// They are built on the flight camera's own tools (public/render/flight-camera.js): the same
// sampling of the ball, the same clearance over the ground, the tree crowns and the ground
// between camera and ball (liftCameraPath), the same leash that keeps the ball in the frame,
// and the same plan shape, so scene.js plays a replay plan exactly as it plays the ball cam's.
// On top of that a replay camera keeps out of the props (PropsLayer.obstacles()): over the
// low ones, round the tall ones, and a tripod never stands inside one or looks through one.
//
// The camera never flips: 'reverse' stays ahead of the ball along the way it came in (the
// heading is held from touchdown, as the ball cam holds it), 'topdown' keeps one heading for
// the whole shot, 'greenside' stands still.
//
// Time: a replay plays the path as live play re-times it (feel.js warpShot), with one
// difference: there is no hit-stop at impact. Slow motion only by the pin (replaySim).
import { closeOne, liftCameraPath, leashLook, boxSmooth, maxSpread, easeInOut, CAM_CLEARANCE_M } from '../render/flight-camera.js';
import { flightMarkers, smoothPointAt } from '../render/flight-profile.js';
import { warpShot } from './feel.js';

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const lerp = (a, b, f) => a + (b - a) * f;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const D2R = Math.PI / 180;
const wrapPi = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

export const REPLAY_CAMERAS = Object.freeze(['greenside', 'topdown', 'reverse']);
export const REPLAY_CAMERA_LABELS = Object.freeze({ greenside: 'GREEN-SIDE CAM', topdown: 'SKY CAM', reverse: 'REVERSE ANGLE' });
export const REPLAY = Object.freeze({
  dt: 1 / 60,              // the camera path is worked out at this step (s)
  tailS: 0.9,              // after the ball stops the camera holds for this long (0.3 when the drop's own hold is in the path)
  bigDriveM: 165,          // a carry of this much (180 yd) or more is a big drive: the top-down trace
  nearPinM: 35,            // the green-side tripod stands by the cup when the ball finishes within this of it
  // reverse: the lead camera
  leadM: Object.freeze([17, 9.5]),   // it flies this far ahead of the ball: at impact, then once the ball has caught it up
  leadSideM: 3.2,          // ...this far off its line (the side the ball curves away from)
  leadUpM: 1.9,            // ...and this far above it
  waitBeyondM: Object.freeze({ far: 6.5, pin: 4.2 }),   // on the ground it waits this far beyond where the ball finishes (beyond the cup for a close one)
  waitSideM: Object.freeze({ far: 2.6, pin: 1.6 }),
  waitUpM: Object.freeze({ far: 1.5, pin: 0.9 }),
  // greenside: the tripod
  tripodM: Object.freeze({ shot: [7.5, 10, 13, 5.5], putt: [4.5, 6, 8] }),   // how far beyond the anchor, in order of preference
  tripodDeg: Object.freeze([22, -22, 45, -45, 0, 70, -70]),                  // how far off the line
  tripodUpM: Object.freeze([0.7, 1.4, 2.6]),                                  // how high: low first
  // topdown
  skyM: Object.freeze([55, 95]),   // how high above the ground under the ball
  skyTiltDeg: 14,                  // off the vertical, so the way of the shot is up the screen
  propM: 1.5,                      // a camera keeps this far from a prop
});

/**
 * The path a replay plays: the server's path re-timed as live play re-times it, without the
 * hit-stop at impact (no speed, no ball given). Slow motion ONLY by the pin.
 *   raw  the server's sim { points, flightTime, isPutt, events }    pin  { x, y } | [x, y] | null
 */
export function replaySim(raw, { pin = null } = {}) {
  return warpShot(raw, { pin: Array.isArray(pin) ? { x: pin[0], y: pin[1] } : pin });
}

/**
 * A sim (as it is played: re-timed) from playback time t0 on, its clock starting over at 0:
 * the path, the flight time, the events, the drop into the cup and the slow-motion windows
 * all move with it. Where the ball goes is untouched.
 */
export function trimSim(sim, t0) {
  const pts = sim && Array.isArray(sim.points) ? sim.points : [];
  if (pts.length < 3 || !(t0 > 0.05) || t0 >= pts[pts.length - 1].t - 0.2) return sim;
  const i = pts.findIndex((p) => p.t >= t0);
  const a = pts[Math.max(0, i - 1)], b = pts[i];
  const f = b.t > a.t ? (t0 - a.t) / (b.t - a.t) : 0;
  const first = { t: 0, x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), z: lerp(a.z, b.z, f) };
  const points = [first, ...pts.slice(i).filter((p) => p.t > t0 + 1e-6).map((p) => ({ ...p, t: p.t - t0 }))];
  const shift = (e) => { const o = { ...e }; for (const k of ['t', 't0', 'tTip', 'tDrop', 'tEnd']) if (Number.isFinite(o[k])) o[k] -= t0; return o; };
  const sub = (v) => (Number.isFinite(v) ? v - t0 : v);
  return {
    ...sim, points, flightTime: Math.max(0, sim.flightTime - t0),
    events: (Array.isArray(sim.events) ? sim.events : []).filter((e) => e && (!Number.isFinite(e.t) || e.t >= t0)).map(shift),
    cup: sim.cup ? shift(sim.cup) : sim.cup, cupDropT: sub(sim.cupDropT), playS: sub(sim.playS),
    slowmo: (Array.isArray(sim.slowmo) ? sim.slowmo : []).filter((w) => w.t1 > t0)
      .map((w) => ({ ...w, t0: Math.max(0, w.t0 - t0), t1: w.t1 - t0, ...(w.deep ? { deep: { ...w.deep, t0: Math.max(0, w.deep.t0 - t0) } } : {}) })),
    toPlayTime: null, trimmedS: t0,
  };
}

/**
 * The green-side tripod films the ARRIVAL: the last `leadS` of the flight and everything after
 * it (a seven-second flight seen from beside the green is five seconds of an empty green).
 * Only for a shot the tripod is the natural camera of (a close one: its carry callout is off).
 */
export function arrivalSim(sim, { pin = null, leadS = 2.6 } = {}) {
  if (!sim || sim.isPutt || !Array.isArray(sim.points) || sim.points.length < 3) return sim;
  const ft = sim.flightTime;
  if (!(ft > leadS + 0.5)) return sim;
  const p = Array.isArray(pin) ? { x: pin[0], y: pin[1] } : pin;
  const holed = (sim.events || []).some((e) => e && e.type === 'holed');
  if (!p || !closeOne(sim.points, { pin: p, flightTime: ft, isPutt: false, holed, cup: sim.cup || null })) return sim;
  return trimSim(sim, ft - leadS);
}

/** Which camera films this shot again (see the top of the file). */
export function chooseReplayCamera(points, { pin = null, flightTime = null, isPutt = false, holed = false, cup = null } = {}) {
  if (!points || points.length < 2) return 'reverse';
  if (isPutt) return 'greenside';
  const end = points[points.length - 1].t;
  const ft = Number.isFinite(flightTime) && flightTime > 0 ? Math.min(flightTime, end) : end;
  if (pin && closeOne(points, { pin, flightTime: ft, isPutt, holed, cup })) return 'greenside';
  const { landing } = flightMarkers(points, ft);
  const land = landing || points[points.length - 1];
  if (Math.hypot(land.x - points[0].x, land.y - points[0].y) >= REPLAY.bigDriveM) return 'topdown';
  return 'reverse';
}

// ---------------------------------------------------------------- shared pieces
// The ball, sample by sample, over the whole playback and the hold after it.
function sampleBall(points, { flightTime, isPutt, tail, groundAt }) {
  const end = points[points.length - 1].t;
  const ft = isPutt ? 0 : Math.min(Number.isFinite(flightTime) && flightTime > 0 ? flightTime : end, end);
  const dt = REPLAY.dt, n = Math.max(2, Math.ceil((end + tail) / dt));
  const T = new Array(n + 1), P = new Array(n + 1), G = new Array(n + 1), B = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    T[i] = i * dt;
    P[i] = smoothPointAt(points, Math.min(end, T[i]), ft);
    G[i] = groundAt(P[i].x, P[i].y);
    B[i] = { x: P[i].x, y: P[i].y, z: Math.max(P[i].z, G[i]) + 0.09 };   // the ball as it is drawn: on the turf, never under it
  }
  const { apex, landing } = flightMarkers(points, ft);
  const land = landing || points[points.length - 1];
  return { T, P, G, B, n, dt, end, ft, apex, land, p0: points[0], last: points[points.length - 1] };
}

// What a camera must stay above at (x, y): the tree crowns, and any prop it is within reach of.
function topOver(treeTopAt, obstacles, margin = REPLAY.propM) {
  const obs = (Array.isArray(obstacles) ? obstacles : []).filter((o) => o && Number.isFinite(o.x) && Number.isFinite(o.y) && o.r > 0 && Number.isFinite(o.top));
  const fn = (x, y, onlyBelow = Infinity) => {
    let top = treeTopAt ? treeTopAt(x, y) : -Infinity;
    for (const o of obs) {
      if (o.top > onlyBelow) continue;
      if (Math.hypot(x - o.x, y - o.y) < o.r + margin) top = Math.max(top, o.top + 0.5);
    }
    return top;
  };
  fn.obs = obs;
  return fn;
}

// A moving camera and the props: one it could only clear by leaping (its top more than
// `leapM` above the path) is passed on the side instead. Positions are pushed out of such a
// cylinder, in place; the path stays continuous (the push is).
const LEAP_M = 14;
function sidestep(pos, obs, { leapM = LEAP_M, margin = REPLAY.propM + 0.05 } = {}) {
  let moved = false;
  for (const c of pos) {
    for (const o of obs) {
      if (o.top - c.z <= leapM || c.z < (Number.isFinite(o.base) ? o.base : -Infinity) - margin) continue;
      const dx = c.x - o.x, dy = c.y - o.y, d = Math.hypot(dx, dy), need = o.r + margin;
      if (d >= need) continue;
      const k = d > 1e-6 ? need / d : 0;
      if (k) { c.x = o.x + dx * k; c.y = o.y + dy * k; } else c.x = o.x + need;
      moved = true;
    }
  }
  return moved;
}

const smoothXYZ = (arr, r) => {
  const out = arr.map((p) => ({ ...p }));
  for (const k of ['x', 'y', 'z']) {
    const s = boxSmooth(boxSmooth(arr.map((p) => p[k]), r), r);
    out.forEach((p, i) => { p[k] = s[i]; });
  }
  return out;
};

// The look, steadied and leashed to the ball so it never leaves the frame.
function finishLook(pos, aim, balls, zoom, { dt, halfFov, leash = 0.55 }) {
  const r = Math.max(1, Math.round(0.12 / dt));
  const steady = smoothXYZ(aim, r);
  const tanHalf = Math.tan(halfFov);
  return steady.map((l, i) => leashLook(pos[i], l, balls[i], Math.atan((Array.isArray(leash) ? leash[i] : leash) * tanHalf / Math.max(0.5, zoom[i]))));
}

// Is the straight line a -> b clear of the ground (by `clear` m) and of every prop?
function sightClear(a, b, groundAt, obs, { clear = 0.05, margin = 0.4 } = {}) {
  for (let k = 1; k <= 10; k++) {
    const u = k / 11;
    const x = lerp(a.x, b.x, u), y = lerp(a.y, b.y, u), z = lerp(a.z, b.z, u);
    if (groundAt(x, y) + clear > z) return false;
    for (const o of obs) {
      if (z > o.top + 0.2 || z < (Number.isFinite(o.base) ? o.base : -Infinity)) continue;
      if (Math.hypot(x - o.x, y - o.y) < o.r + margin) return false;
    }
  }
  return true;
}

function planOf(kind, s, path, extra = {}) {
  return {
    replay: kind, label: REPLAY_CAMERA_LABELS[kind],
    p0: s.p0, apex: s.apex, land: s.land, last: s.last, flightTime: s.ft,
    start: { ...path.pos[0] }, end: { ...path.pos[path.pos.length - 1] }, moves: true,
    tail: extra.tail, pinCam: extra.pinCam || null,
    path: { dt: s.dt, ...path }, zoom: 1,
  };
}

// ---------------------------------------------------------------- 'reverse': the lead camera
function reversePlan(points, env) {
  const { pin, isPutt, holed, cup, groundAt, halfFov } = env;
  const tail = cup ? 0.3 : REPLAY.tailS;
  const s = sampleBall(points, { ...env, tail });
  const { T, P, G, B, n, dt, ft, end } = s;
  const pc = pin ? closeOne(points, { pin, flightTime: ft, isPutt, holed, cup }) : null;
  const carry = Math.hypot(s.land.x - s.p0.x, s.land.y - s.p0.y);
  const whole = Math.hypot(s.last.x - s.p0.x, s.last.y - s.p0.y);
  if (Math.max(carry, whole) < 1.5) return null;   // a ball that went nowhere has no way it came

  // the way the ball is going over the ground, steadied; held from just before touchdown, and
  // never turned right round (a ball knocked back by a tree does not flip the camera)
  const vr = Math.max(1, Math.round(0.05 / dt)), sr = Math.max(1, Math.round(0.2 / dt));
  const vel = (k) => boxSmooth(boxSmooth(P.map((_, i) => {
    const i0 = Math.max(0, i - vr), i1 = Math.min(n, i + vr);
    return (P[i1][k] - P[i0][k]) / Math.max(dt, (i1 - i0) * dt);
  }), sr), sr);
  const vx = vel('x'), vy = vel('y');
  const far = carry > 1.5 ? s.land : s.last;
  let az = Math.atan2(far.x - s.p0.x, far.y - s.p0.y);
  const iHold = isPutt ? n : Math.max(0, Math.round((ft - 0.08) / dt));
  let hd = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    if (i <= iHold && !isPutt && Math.hypot(vx[i], vy[i]) > 2.5) {
      const d = wrapPi(Math.atan2(vx[i], vy[i]) - az);
      if (Math.abs(d) < 1.75) az += d;
    }
    hd[i] = az;
  }
  const hr = Math.max(1, Math.round(0.25 / dt));
  hd = boxSmooth(boxSmooth(hd, hr), hr);

  // the side it flies on: the one the ball curves away from, so the flight bends across the frame
  const lx = Math.sin(hd[0]), ly = Math.cos(hd[0]);
  const off = (s.last.x - s.p0.x) * ly - (s.last.y - s.p0.y) * lx;   // + : the ball finishes right of its launch line
  const side = off > 0 ? -1 : 1;

  // where it waits on the ground: beyond the finish (beyond the cup, for a close one), a little off the line
  const fe = { x: Math.sin(hd[n]), y: Math.cos(hd[n]) }, re = { x: fe.y, y: -fe.x };
  const anchor = pc && pin ? pin : s.last;
  const W = pc ? 'pin' : 'far';
  const wait = {
    x: anchor.x + fe.x * REPLAY.waitBeyondM[W] + re.x * side * REPLAY.waitSideM[W],
    y: anchor.y + fe.y * REPLAY.waitBeyondM[W] + re.y * side * REPLAY.waitSideM[W],
  };
  wait.z = groundAt(wait.x, wait.y) + REPLAY.waitUpM[W];

  const goal = new Array(n + 1), aim = new Array(n + 1), zoom = new Array(n + 1), scale = new Array(n + 1), clear = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const t = T[i], b = P[i];
    const f = { x: Math.sin(hd[i]), y: Math.cos(hd[i]) }, r = { x: f.y, y: -f.x };
    const lead = lerp(REPLAY.leadM[0], REPLAY.leadM[1], easeInOut(0, 1.3, t));
    const air = {
      x: b.x + f.x * lead + r.x * side * REPLAY.leadSideM,
      y: b.y + f.y * lead + r.y * side * REPLAY.leadSideM,
      z: Math.max(b.z, G[i]) + REPLAY.leadUpM,
    };
    const down = isPutt ? 1 : easeInOut(ft - 1.3, ft - 0.05, t);
    goal[i] = { x: lerp(air.x, wait.x, down), y: lerp(air.y, wait.y, down), z: lerp(air.z, wait.z, down) };
    // it looks at the ball; for a close one, once the ball is down, a little toward the cup as well
    const w = pc && pin ? 0.3 * down * (1 - smooth(4, 20, Math.hypot(b.x - pin.x, b.y - pin.y))) : 0;
    aim[i] = w ? { x: lerp(B[i].x, pin.x, w), y: lerp(B[i].y, pin.y, w), z: lerp(B[i].z, groundAt(pin.x, pin.y) + 0.05, w) } : { ...B[i] };
    const d = Math.hypot(goal[i].x - b.x, goal[i].y - b.y, goal[i].z - b.z);
    zoom[i] = clamp(d / 13, pc ? lerp(1, 1.2, down) : 1, 2.6);
    scale[i] = 1 + 1.4 * (isPutt ? 0 : smooth(3, 14, Math.max(0, b.z - G[i]))) + 0.6 * smooth(25, 70, d);
    clear[i] = lerp(CAM_CLEARANCE_M, Math.min(1.0, REPLAY.waitUpM[W]), down);
  }
  const r3 = Math.max(1, Math.round(0.3 / dt));
  const pos = smoothXYZ(goal, r3);
  const top = topOver(env.treeTopAt, env.obstacles);
  if (sidestep(pos, top.obs)) {
    const again = smoothXYZ(pos, Math.max(1, Math.round(0.15 / dt)));
    pos.forEach((c, i) => { c.x = again[i].x; c.y = again[i].y; });
    sidestep(pos, top.obs);
  }
  // over the ground, the crowns, the props it can clear, and any ground between it and the ball
  // (a prop that towers over the path was passed on the side: only the ones it can clear lift it)
  liftCameraPath(pos, B, { dt, groundAt, topAt: (x, y, z) => top(x, y, z + LEAP_M), clearM: clear, sight: true });
  const zr = Math.max(1, Math.round(0.25 / dt));
  const zoomS = boxSmooth(boxSmooth(zoom, zr), zr), scaleS = boxSmooth(boxSmooth(scale, zr), zr);
  const look = finishLook(pos, aim, B, zoomS, { dt, halfFov });
  return planOf('reverse', s, { pos, look, zoom: zoomS, roll: new Array(n + 1).fill(0), ballScale: scaleS }, { tail, pinCam: pc, end });
}

// ---------------------------------------------------------------- 'greenside': the tripod
function greensidePlan(points, env) {
  const { pin, isPutt, holed, cup, groundAt, halfFov } = env;
  const tail = cup ? 0.3 : REPLAY.tailS;
  const s = sampleBall(points, { ...env, tail });
  const { T, P, G, B, n, dt, ft } = s;
  const pc = pin ? closeOne(points, { pin, flightTime: ft, isPutt, holed, cup }) : null;
  const nearPin = !!pin && Math.hypot(s.last.x - pin.x, s.last.y - pin.y) <= REPLAY.nearPinM;
  const anchor = (pc || nearPin || isPutt) && pin ? { x: pin.x, y: pin.y } : { x: s.last.x, y: s.last.y };
  anchor.z = groundAt(anchor.x, anchor.y);
  let ax = anchor.x - s.p0.x, ay = anchor.y - s.p0.y;
  const al = Math.hypot(ax, ay);
  if (al < 0.8) return null;   // hit from on top of the cup: nothing arrives
  ax /= al; ay /= al;
  // a ball that runs on past the cup runs toward the tripod: it stands that much further back, so the ball never reaches it
  const over = Math.max(0, ...P.map((b) => (b.x - anchor.x) * ax + (b.y - anchor.y) * ay));
  const top = topOver(env.treeTopAt, env.obstacles, 1.2);
  const anchorEye = { x: anchor.x, y: anchor.y, z: anchor.z + 0.25 };
  // the moments it has to see: the ball coming down, landing, and all the way to rest
  const watch = [];
  for (const u of [0.55, 0.75, 0.9, 1]) { const i = Math.min(n, Math.round((isPutt ? u * s.end : lerp(ft * 0.7, s.end, u)) / dt)); watch.push(B[i]); }
  watch.push(B[Math.min(n, Math.round(ft / dt))]);

  // A prop that stands tall in the picture (within 26 degrees of the line camera -> anchor, nearer than 70 m,
  // and not far beyond the anchor's own distance): a rock filling a third of the frame is not what was asked for.
  const cluttered = (c) => {
    const vx = anchor.x - c.x, vy = anchor.y - c.y, vl = Math.hypot(vx, vy) || 1;
    for (const o of top.obs) {
      if (o.top < c.z + 2.5) continue;
      const ox = o.x - c.x, oy = o.y - c.y, ol = Math.hypot(ox, oy);
      if (ol > 70 || ol < 1e-6) continue;
      const along = (ox * vx + oy * vy) / vl;
      if (along <= 0) continue;
      const off = Math.abs(Math.atan2(Math.abs(ox * vy - oy * vx) / vl, along)) - Math.atan2(o.r, ol);
      if (off < 26 * D2R && (o.top - c.z) / ol > 0.25) return true;
    }
    return false;
  };
  let spot = null;
  search:
  for (const tidy of [true, false]) {   // first a spot with a clean picture; failing that, any spot that sees
    for (const up of REPLAY.tripodUpM) {
      for (const d of (isPutt ? REPLAY.tripodM.putt : REPLAY.tripodM.shot)) {
        for (const deg of REPLAY.tripodDeg) {
          const a = deg * D2R, cx = ax * Math.cos(a) + ay * Math.sin(a), cy = ay * Math.cos(a) - ax * Math.sin(a);
          const c = { x: anchor.x + cx * (d + over), y: anchor.y + cy * (d + over) };
          const g = groundAt(c.x, c.y);
          c.z = g + up;
          if (Math.abs(g - anchor.z) > 3.5) continue;                 // not down a cliff, nor up a wall
          if (top(c.x, c.y) > c.z - 0.3) continue;                    // not under a crown, nor inside (or on) a prop
          if (!sightClear(c, anchorEye, groundAt, top.obs)) continue; // the cup, or the finish, is in plain sight
          if (!watch.every((b) => sightClear(c, b, groundAt, top.obs))) continue;
          if (tidy && cluttered(c)) continue;
          spot = c;
          break search;
        }
      }
    }
  }
  if (!spot) return null;

  // a slow push toward the anchor (half a metre over the shot): a tripod with a little life
  const push = { x: (anchor.x - spot.x), y: (anchor.y - spot.y) }, pl = Math.hypot(push.x, push.y) || 1;
  const pos = new Array(n + 1), aim = new Array(n + 1), zoom = new Array(n + 1), scale = new Array(n + 1);
  const atPin = anchor.x === (pin && pin.x) && anchor.y === (pin && pin.y);
  const leashes = new Array(n + 1);
  // While the ball is in the air the tripod does NOT chase it up into the sky (a lens full of cloud):
  // it frames the green, wide, the cup in the lower half and the sky the ball is coming out of above it,
  // and the ball drops into that picture. From a second before touchdown it takes the ball up.
  const wait = { x: lerp(anchor.x, s.land.x, 0.3), y: lerp(anchor.y, s.land.y, 0.3) };
  wait.z = anchor.z + 0.2 * Math.hypot(wait.x - spot.x, wait.y - spot.y);   // pitched up about 11 degrees
  for (let i = 0; i <= n; i++) {
    const u = easeInOut(0, T[n], T[i]) * 0.5;
    pos[i] = { x: spot.x + push.x / pl * u, y: spot.y + push.y / pl * u, z: spot.z };
    const b = B[i];
    const dA = Math.hypot(b.x - anchor.x, b.y - anchor.y);
    const air = isPutt ? 0 : 1 - easeInOut(ft - 1.25, ft - 0.2, T[i]);
    // at the ball; as it closes on the cup, between the two, so both are in the frame
    const w = atPin ? 0.42 * (1 - smooth(4, 28, dA)) : 0;
    const track = { x: lerp(b.x, anchor.x, w), y: lerp(b.y, anchor.y, w), z: lerp(b.z, anchor.z + 0.05, w) + 0.1 };
    aim[i] = { x: lerp(track.x, wait.x, air), y: lerp(track.y, wait.y, air), z: lerp(track.z, wait.z, air) };
    const d = Math.hypot(pos[i].x - b.x, pos[i].y - b.y, pos[i].z - b.z);
    zoom[i] = lerp(clamp(d / 16, pc ? 1.25 : 1.1, 3.4), 1, air);
    scale[i] = clamp(d * 0.045, 1, 6);   // a ball still far off in the sky is drawn big enough to find, as at address
    leashes[i] = lerp(0.5, 8, air);      // (in the air: no leash, the picture is the green's)
  }
  const zr = Math.max(1, Math.round(0.3 / dt));
  const zoomS = boxSmooth(boxSmooth(zoom, zr), zr), scaleS = boxSmooth(boxSmooth(scale, zr), zr);
  const look = finishLook(pos, aim, B, zoomS, { dt, halfFov, leash: leashes });
  return planOf('greenside', s, { pos, look, zoom: zoomS, roll: new Array(n + 1).fill(0), ballScale: scaleS }, { tail, pinCam: pc || (isPutt && pin ? { kind: 'putt', tNear: s.end, direct: false } : null) });
}

// ---------------------------------------------------------------- 'topdown': the trace from above
function topdownPlan(points, env) {
  const { groundAt, halfFov, isPutt } = env;
  const tail = REPLAY.tailS;
  const s = sampleBall(points, { ...env, tail });
  const { T, P, G, B, n, dt, ft } = s;
  let fx = s.land.x - s.p0.x, fy = s.land.y - s.p0.y;
  const carry = Math.hypot(fx, fy);
  if (isPutt || carry < 20) return null;   // nothing to trace
  fx /= carry; fy /= carry;
  const apexH = s.apex ? Math.max(0, s.apex.z - Math.max(s.p0.z, s.land.z)) : 0;
  // above the ground under the ball, and always well above the ball itself (a Rocket climbs 130 m)
  const H = Math.max(clamp(apexH + 38, REPLAY.skyM[0], REPLAY.skyM[1]), apexH + 30);
  const back = H * Math.tan(REPLAY.skyTiltDeg * D2R), lead = 0.16 * H;
  // its height rides the ground under the ball (and the ball), steadied over two seconds: a cliff is a glide, not a drop
  const gr = Math.max(1, Math.round(1.0 / dt));
  // (the upper envelope of both: never near the ground the ball is over, never under a ball that flew off a cliff)
  const high = boxSmooth(boxSmooth(maxSpread(P.map((b, i) => Math.max(G[i] + H, b.z + 30)), gr), gr), gr);
  const goal = new Array(n + 1), aim = new Array(n + 1), zoom = new Array(n + 1), scale = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const b = P[i];
    const L = { x: b.x + fx * lead, y: b.y + fy * lead };
    goal[i] = { x: L.x - fx * back, y: L.y - fy * back, z: high[i] };
    aim[i] = { x: L.x, y: L.y, z: high[i] - H };
    zoom[i] = lerp(1, 1.7, easeInOut(ft + 0.2, ft + 1.8, T[i]));   // closer for the run-out and the finish
    scale[i] = 4;
  }
  // steadied just enough to take the jolt of the landing out: a wider window would let a 110 m/s ball run away from it
  const r3 = Math.max(1, Math.round(0.18 / dt));
  const pos = smoothXYZ(goal, r3);
  const aimS = smoothXYZ(aim, r3);
  const top = topOver(env.treeTopAt, env.obstacles);
  liftCameraPath(pos, null, { dt, groundAt, topAt: (x, y) => top(x, y) + 8, clearM: 20, sight: false, smoothS: 0.6 });
  const zr = Math.max(1, Math.round(0.25 / dt));
  const zoomS = boxSmooth(boxSmooth(zoom, zr), zr);
  const look = finishLook(pos, aimS, B, zoomS, { dt, halfFov, leash: 0.7 });
  // the heading is one heading: whatever the leash did, the look never comes back past the vertical
  for (let i = 0; i <= n; i++) {
    const ahead = (look[i].x - pos[i].x) * fx + (look[i].y - pos[i].y) * fy;
    if (ahead < 1) { look[i].x += fx * (1 - ahead); look[i].y += fy * (1 - ahead); }
  }
  return planOf('topdown', s, { pos, look, zoom: zoomS, roll: new Array(n + 1).fill(0), ballScale: scale }, { tail, pinCam: null });
}

const PLANNERS = { reverse: reversePlan, greenside: greensidePlan, topdown: topdownPlan };

/**
 * The camera plan of a replay (the shape flightCameraPlan gives: scene.js plays it as it is).
 *   points       the path being replayed (as it will be played: re-timed)
 *   kind         'greenside' | 'topdown' | 'reverse' | null (null: chooseReplayCamera)
 *   pin          { x, y } the cup          flightTime, isPutt, holed, cup: as for flightCameraPlan
 *   groundAt     (x, y) -> the ground (or the water's surface over it)
 *   treeTopAt    (x, y) -> what a camera must stay above there for the trees (null: none)
 *   obstacles    [{ x, y, r, base, top }] every prop as an upright cylinder (PropsLayer.obstacles())
 * When the camera asked for cannot film the shot (no clear spot for the tripod, nothing to
 * trace) the next one is tried: -> the plan, with plan.replay the camera it is, or null when
 * none can (the caller then leaves the shot's usual camera).
 */
export function replayCameraPlan(points, {
  kind = null, pin = null, flightTime = null, isPutt = false, holed = false, cup = null,
  groundAt = () => 0, treeTopAt = null, obstacles = [], fovDeg = 58,
} = {}) {
  if (!points || points.length < 2) return null;
  const p = Array.isArray(pin) ? { x: pin[0], y: pin[1] } : pin;
  const env = { pin: p, flightTime, isPutt: !!isPutt, holed: !!holed, cup, groundAt, treeTopAt, obstacles, halfFov: (fovDeg / 2) * D2R };
  const first = REPLAY_CAMERAS.includes(kind) ? kind : chooseReplayCamera(points, env);
  const order = [first, ...['greenside', 'reverse', 'topdown'].filter((k) => k !== first)];
  for (const k of order) {
    if (k === 'greenside' && k !== first && !isPutt && !(p && Math.hypot(points[points.length - 1].x - p.x, points[points.length - 1].y - p.y) <= REPLAY.nearPinM)) continue;   // a tripod by a ball in the middle of nowhere is nobody's second choice
    let plan = null;
    try { plan = PLANNERS[k](points, env); } catch (_) { plan = null; }
    if (plan && plan.path.pos.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z))) return plan;
  }
  return null;
}

// ---------------------------------------------------------------- what the page needs to decide
/**
 * Should the page play this shot again, and how? The server marks a notable shot
 * (result.highlight, lib/highlights.js): { id, why: [...], auto }. `auto`: play it by itself
 * once (a match); otherwise it is only offered (solo play: the REPLAY chip, key R).
 */
export function replayOffer(shot) {
  const h = shot && shot.highlight;
  if (!h || !shot.sim || !Array.isArray(shot.sim.points) || shot.sim.points.length < 2) return null;
  return { id: h.id || null, why: Array.isArray(h.why) ? h.why : [], auto: h.auto === true, title: h.title || 'REPLAY' };
}

/** How long the finished shot keeps the screen before its replay cuts in (ms): its callout has to land first. */
export function replayBeatMs(shot) {
  const epic = !!(shot && shot.arcade && shot.arcade.callout && shot.arcade.callout.tone === 'epic');
  return epic ? 2600 : 1700;
}
