// Shot-replay camera, two ways, both one continuous move from the address camera (no
// cuts). Pure (sim coordinates, no three) so the framing is unit-tested
// (test/flight-camera.test.mjs).
//
// 'follow' (the default in the game): the camera flies with the ball. The ball gets away
// at impact, the camera chases it along its own flight, catches it up and rides with it,
// looking where it is going; as the ball comes down it drops in level behind it, so the
// landing area and the horizon stay in view (the approach); then it eases off behind it
// for the bounce and the roll and comes to rest there (followCamera below).
//
// 'ball' (the arcade game's default): the ball cam, the way an arcade golf game films a
// shot. The camera leaves the tee and flies WITH the ball, a little behind and above it,
// level with the ground and looking forward and down, so the ball sits just under the
// middle of the frame with the hole laid out ahead of it; it comes down with the ball,
// stays behind it through the pitch and every bounce, runs along the ground after it,
// and for a ball that finishes by the flag becomes the pin cam: a low, tight chase with
// the cup in the frame, right through the drop (ballCamera below).
//
// 'tv': broadcast-style coverage, framed so the ball's height reads.
//
// Off the wide address lens a 20 m apex 120 m out is ~6° of a 58° frame, and a camera
// that pitches to keep the ball centred hides even that: the flight reads flat. So:
//  - Launch and climb: the camera holds the address vantage (no cut at impact) and the
//    lens closes in as the ball leaves, telephoto, the way a broadcast camera behind the
//    tee follows a drive; the ball rides up through the upper half of the frame over a
//    horizon that stays in view.
//  - Descent: the camera glides, low and under the flight, to a vantage beside and a
//    little short of the landing area, so the ball drops out of the sky across the frame
//    and the bounce and roll-out happen in view; the lens closes in on the drop.
// Short shots (chips, putts) never move the camera or the lens.
import { flightMarkers, pointAt, smoothPointAt } from './flight-profile.js';

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
// the same with no kick in its acceleration at either end (for a camera that sets off)
const smoother = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * t * (t * (6 * t - 15) + 10); };
const lerp = (a, b, f) => a + (b - a) * f;
const D2R = Math.PI / 180;

export const CAM_CLEARANCE_M = 2.0;   // never closer than this above the ground
export const DROP_ZOOM = 1.8;         // lens magnification at touchdown (wide = 1)
export const MAX_CLIMB_ZOOM = 3.2;    // the tightest the lens closes on the climb
const ZOOM_REF_M = 34;                // the climb's lens: the ball's distance at glide start / this
const CLIMB_FRAME = 0.32;             // through the climb the ball rides this far above the frame's middle (share of half-height)
const LEASH = 0.62;                   // ...and never strays further than this from the middle, whatever the framing
const GLIDE_SAMPLES = 64;             // the glide's tree-clearance profile
const TREE_CLIMB_DEG = 25;            // the steepest the glide climbs to clear a tree line
// the follow camera
export const FOLLOW_BACK_M = 9;       // what it chases: this far behind the ball, along its flight...
export const FOLLOW_UP_M = 2.4;       // ...and this far above it
const FOLLOW_LOOK_AHEAD_M = 6;        // looks this far ahead of the ball, along its flight
const FOLLOW_DT = 1 / 120;            // the camera path is worked out at this step (s)
const FOLLOW_OMEGA = 4.5;             // rad/s: the critically damped chase
const FOLLOW_MATCH = 0.6;             // how much of what it chases' own speed it matches outright
const FOLLOW_TAKE_UP_S = 0.6;         // the chase's pull, taken up from nothing at impact
const FOLLOW_MATCH_IN_S = 0.3;        // the speed match, taken up over this
const FOLLOW_HEADSTART_M = 10;        // at impact it chases a point this much further back than the address camera
const FOLLOW_CATCH_UP_S = 2.5;        // ...closing to FOLLOW_BACK_M over this
export const FOLLOW_TAIL_S = 0.8;     // after the ball stops, the camera comes to rest over this
const FOLLOW_LOOK_IN_S = 0.45;        // the look leaves the address framing over this
const FOLLOW_SETTLE_S = 0.9;          // once the ball is down, what it chases moves behind it over this
export const SETTLE_BACK_M = 11;      // the spot it settles on: behind the ball...
const SETTLE_UP_M = 3.2;              // ...and above the ground under it
// the approach: as the ball comes down steeply the camera stops riding its flight path
// (which has it looking straight down at the turf) and drops in level behind it instead
export const APPROACH_SIN = Object.freeze([0.22, 0.6]);   // sine of the descent angle: starts at the first, complete at the second
export const APPROACH_UP_M = 1.2;     // then it sits this much higher above the ball than FOLLOW_UP_M
export const APPROACH_LOOK_DROP = 0.15;   // ...and looks ahead of it along the ground, this far down per metre

// The arcade landing (public/arcade/feel.js switches it on; off, the follow camera is
// exactly as it was). Riding 9 m behind a ball that stops dead at touchdown, the plain
// follow camera overruns it: for a third of a second it is straight above the ball,
// looking ahead of it, and the first bounce happens below the bottom of the frame. With
// this on, the camera brakes before the ball lands: over the last anticipateS it leaves
// the flight for a vantage backM behind the landing spot and upM above the ground there,
// looks at the ball as it drops in, and after touchdown follows it over the ground at a
// steady height, aimed at the turf under it, so the bounce rises and falls in the frame.
let followLanding = null;
export const FOLLOW_LANDING = Object.freeze({ anticipateS: 1.25, backM: 12.5, upM: 3.6, lookUpM: 0.55 });
export function setFollowLanding(on) {
  followLanding = on ? { ...FOLLOW_LANDING, ...(typeof on === 'object' ? on : {}) } : null;
}

// points: sim trajectory; startCam / startLook: the address camera and its look target
// now (sim frame); groundAt(x,y) -> terrain height; treeTopAt(x,y) -> the height the
// camera must stay above there (-Infinity in the open; flyover.js treeCeiling);
// flightTime: s at first ground contact; isClear(x,y) -> false where the landing vantage
// would sit in a tree or look through one; fovDeg: the base (unzoomed) vertical lens.
// For the ball cam: pin {x,y} (the cup), holed (the ball goes in), cup (arcade/feel.js's
// drop: { t0, tTip, tDrop, tEnd }, when the path carries the ball into the hole).
export function flightCameraPlan(points, {
  startCam, startLook = null, groundAt = () => 0, treeTopAt = null, flightTime = null,
  isPutt = false, isClear = () => true, fovDeg = 58, mode = 'tv',
  pin = null, holed = false, cup = null,
  startVel = null,   // v2:seeover the address camera's own velocity at impact (m/s), when it was struck mid-glide
} = {}) {
  const p0 = points[0];
  const last = points[points.length - 1];
  const { apex, landing } = flightMarkers(points, flightTime);
  const land = landing || last;
  const carry = Math.hypot(land.x - p0.x, land.y - p0.y);
  const ft = Number.isFinite(flightTime) && flightTime > 0 ? flightTime : land.t;
  const start = startCam ? { ...startCam } : { x: p0.x, y: p0.y - 12, z: p0.z + 5 };
  const moves = !isPutt && carry >= 45;
  const apexH = apex ? Math.max(0, apex.z - Math.max(p0.z, land.z)) : 0;
  if (mode === 'ball' && points.length >= 2) {
    return ballCamera(points, {
      p0, apex, land, last, carry, flightTime: ft, start, moves: true, apexH, mode, isPutt,
      startLook: startLook ? { ...startLook } : null, groundAt, treeTopAt,
      halfFov: (fovDeg / 2) * D2R,
      startVel: startVel ? { ...startVel } : null,   // v2:seeover
    }, { pin: Array.isArray(pin) ? { x: pin[0], y: pin[1] } : pin, holed, cup });
  }
  if (moves && mode === 'follow') {
    return followCamera(points, {
      p0, apex, land, last, carry, flightTime: ft, start, moves, apexH, mode,
      startLook: startLook ? { ...startLook } : null, groundAt, treeTopAt,
      landing: followLanding,
    });
  }
  const arc = moves ? clamp(apexH * 0.2, 1, 5) : 0;
  let end = { ...start };
  if (moves) {
    // unit vector tee -> landing and its right-hand normal
    const ux = (land.x - p0.x) / carry, uy = (land.y - p0.y) / carry;
    const rx = uy, ry = -ux;
    // sit on the side the ball curves AWAY from, so the descent isn't hidden behind
    // the camera's own line of sight (offline sign: + = right of the launch line)
    const off = (last.x - p0.x) * rx + (last.y - p0.y) * ry;
    const side = off > 0 ? -1 : 1;
    // beside the landing area and a little short of it, low: the ball comes down from
    // above the camera, against the sky, instead of skimming the grass below it
    const back = clamp(carry * 0.1, 8, 26);
    const lateral = clamp(carry * 0.16, 12, 30);
    const lift = clamp(apexH * 0.3, 3, 8);
    // preferred vantage first, then the other side, then further back and nearer the line;
    // the first one in the open with a glide that clears the trees on the way wins (on a
    // tree-lined hole, the one whose glide has to climb least: a camera lifted over a
    // tree line looks down on the flight again)
    const candidates = [
      [back, lateral * side], [back, -lateral * side],
      [back * 1.8, lateral * side * 0.6], [back * 1.8, -lateral * side * 0.6],
      [back * 2.6, lateral * side * 0.3], [back * 2.6, -lateral * side * 0.3], [back * 3, 0],
    ];
    const at = (c) => {
      const x = land.x - ux * c[0] + rx * c[1], y = land.y - uy * c[0] + ry * c[1];
      return { x, y, z: Math.max(groundAt(x, y), land.z) + lift };
    };
    let best = null;
    for (const c of candidates) {
      const e = at(c);
      if (!isClear(e.x, e.y)) continue;
      const need = glideTreeNeed(treeTopAt, start, e, arc);
      if (!best || need < best.need - 0.5) best = { e, need };
      if (need <= 0.5) break;
    }
    end = best ? best.e : at(candidates[0]);
  }
  const plan = {
    p0, apex, land, last, carry, flightTime: ft, start, end, moves, apexH,
    apexT: apex ? apex.t : ft * 0.5,
    glideStart: ft * 0.3, glideEnd: ft * 0.9,
    arc,
    lift: null,
    groundAt,
    halfFov: (fovDeg / 2) * D2R,
    startLook: startLook ? { ...startLook } : null,
    climbZoomMax: 1, climbZoom: 1,
  };
  if (moves) {
    // The lens closes in through the climb, but not so far that the horizon leaves the
    // frame under a high ball (a wedge's apex sits steep above the camera).
    const eApex = apex ? Math.atan2(apex.z - start.z, Math.hypot(apex.x - start.x, apex.y - start.y)) : 0;
    plan.climbZoomMax = clamp((Math.tan(plan.halfFov) * 1.1) / Math.tan(Math.max(eApex, 0) + 2 * D2R), 1, MAX_CLIMB_ZOOM);
    const g = pointAt(points, plan.glideStart) || land;
    plan.climbZoom = clamp(Math.hypot(g.x - start.x, g.y - start.y) / ZOOM_REF_M, 1, plan.climbZoomMax);
    // Glide over tree crowns it can't avoid: a ramp up to each (no steeper than
    // TREE_CLIMB_DEG), rounded off (dilate, then average: each sample still clears its
    // neighbours, and a little headroom covers the path between samples), so the low
    // path never flies through a canopy nor shoots up at one. The lift fades in from the
    // start: the camera leaves from wherever the address camera is (trees round a tee
    // must not jolt it skyward at impact).
    if (treeTopAt) {
      const need = [];
      for (let i = 0; i <= GLIDE_SAMPLES; i++) {
        const p = glidePos(plan, i / GLIDE_SAMPLES, 0);
        need.push(Math.max(0, treeTopAt(p.x, p.y) - p.z + 0.3));
      }
      if (need.some((v) => v > 0)) {
        const k = (Math.tan(TREE_CLIMB_DEG * D2R) * Math.hypot(end.x - start.x, end.y - start.y)) / GLIDE_SAMPLES;
        const ramp = need.map((_, i) => Math.max(...need.map((v, j) => v - k * Math.abs(i - j))));
        plan.lift = boxFilter(maxFilter(ramp, 4), 3).map((v, i) => v * smooth(0, 0.2, i / GLIDE_SAMPLES));
      }
    }
  }
  return plan;
}

// How far the straight glide start -> end would pass under tree crowns at worst (m; 0 =
// clear), past its first stretch (the camera starts where the address camera already is).
function glideTreeNeed(treeTopAt, start, end, arc) {
  if (!treeTopAt) return 0;
  let worst = 0;
  for (let i = 4; i <= 24; i++) {
    const u = i / 24;
    const z = lerp(start.z, end.z, u) + Math.sin(Math.PI * u) * arc;
    worst = Math.max(worst, treeTopAt(lerp(start.x, end.x, u), lerp(start.y, end.y, u)) - z);
  }
  return worst;
}

// Camera position along the glide at progress u (0 = address vantage, 1 = landing vantage).
function glidePos(plan, u, treeLift = liftAt(plan, u)) {
  const x = lerp(plan.start.x, plan.end.x, u);
  const y = lerp(plan.start.y, plan.end.y, u);
  let z = lerp(plan.start.z, plan.end.z, u) + Math.sin(Math.PI * u) * plan.arc + treeLift;
  z = Math.max(z, plan.groundAt(x, y) + CAM_CLEARANCE_M);
  return { x, y, z };
}
function liftAt(plan, u) {
  if (!plan.lift) return 0;
  const f = clamp(u, 0, 1) * GLIDE_SAMPLES, i = Math.min(GLIDE_SAMPLES - 1, Math.floor(f));
  return lerp(plan.lift[i], plan.lift[i + 1], f - i);
}

// The follow camera's path, worked out once per shot at FOLLOW_DT and running on
// FOLLOW_TAIL_S past the ball's last sample. The camera chases a point on the ball's own
// flight (by arc length, so the point slows as the ball does) FOLLOW_UP_M above it and,
// behind the ball, FOLLOW_HEADSTART_M further back than the address camera stands at
// impact (so the camera never backs up as it sets off), closing to FOLLOW_BACK_M over
// FOLLOW_CATCH_UP_S (before the ball has gone that far, on the ground behind the ball's
// start): the ball gets away, then the camera catches it up and rides with it. The chase is critically damped, matches FOLLOW_MATCH of the point's own speed
// (steadied, and taken up over FOLLOW_MATCH_IN_S) outright, and its pull is taken up from
// nothing at impact: no kick as it sets off, and it never overshoots what it chases, so
// it never passes the ball. Once the
// ball is down, what it chases moves over FOLLOW_SETTLE_S to a spot SETTLE_BACK_M behind
// the ball and SETTLE_UP_M up, and over the tail the camera comes to rest there. It looks
// just ahead of the ball along its flight (at the ball, steadied over the bounces, once
// it's down); it leaves the address framing over FOLLOW_LOOK_IN_S; and it stays above the
// ground and the tree crowns, lifted smoothly where it has to.
function followCamera(points, plan) {
  const { flightTime: ft, start, groundAt, treeTopAt } = plan;
  const end = points[points.length - 1].t;
  const B = (t) => smoothPointAt(points, t, ft);
  const n = Math.max(1, Math.ceil((end + FOLLOW_TAIL_S) / FOLLOW_DT));
  const T = [], S = [], P = [];
  let s = 0, prev = B(0);
  for (let i = 0; i <= n; i++) {
    const t = i * FOLLOW_DT, p = B(Math.min(end, t));
    s += Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
    T.push(t); S.push(s); P.push(p); prev = p;
  }
  // the way the ball goes across the ground, carried back past its start (the chased
  // point's first metres, at the start's height)
  const dx0 = plan.land.x - plan.p0.x, dy0 = plan.land.y - plan.p0.y, d0 = Math.hypot(dx0, dy0) || 1;
  const startBack = Math.max(FOLLOW_BACK_M, Math.hypot(start.x - P[0].x, start.y - P[0].y) + FOLLOW_HEADSTART_M);
  const onFlight = (sBack) => {
    if (sBack <= 0) return { x: P[0].x + dx0 / d0 * sBack, y: P[0].y + dy0 / d0 * sBack, z: P[0].z };
    let lo = 0, hi = S.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (S[mid] <= sBack) lo = mid; else hi = mid; }
    const f = (sBack - S[lo]) / Math.max(1e-9, S[hi] - S[lo]);
    return { x: lerp(P[lo].x, P[hi].x, f), y: lerp(P[lo].y, P[hi].y, f), z: lerp(P[lo].z, P[hi].z, f) };
  };
  const dirAt = (i) => {
    const a = P[Math.max(0, i - 5)], b = P[Math.min(n, i + 5)];
    const v = [b.x - a.x, b.y - a.y, b.z - a.z], L = Math.hypot(...v);
    return L > 1e-6 ? v.map((c) => c / L) : null;
  };
  let dir = [dx0 / d0, dy0 / d0, 0], flat = [dx0 / d0, dy0 / d0];
  // what the camera chases (on the flight behind the ball, then the spot behind it on the
  // ground) and where it looks, sample by sample
  const goal = [], aim = [], downs = [];
  let approach = 0;
  const L = plan.landing || null;   // the arcade landing, or the camera as it always was
  let flatL = null;                  // the way the ball was going over the ground as it came in
  for (let i = 0; i <= n; i++) {
    const t = T[i], b = P[i];
    const d = dirAt(i);
    if (d) dir = d;
    const hl = Math.hypot(dir[0], dir[1]);
    if (hl > 0.05) flat = [dir[0] / hl, dir[1] / hl];
    const back = lerp(startBack, FOLLOW_BACK_M, smoother(0, FOLLOW_CATCH_UP_S, t));
    const a = onFlight(S[i] - back);
    const down = L ? smoother(ft - L.anticipateS, ft - 0.05, t) : smoother(ft, ft + FOLLOW_SETTLE_S, t);
    if (L && !flatL && t >= ft - L.anticipateS) flatL = [...flat];   // held: a ball that spins back does not swing the camera round
    // The approach. Riding the flight path behind a ball that is coming down at 45 degrees
    // puts the camera high over it, looking down its own trail at a frame full of turf.
    // So the steeper the ball falls, the more the camera leaves the path for a spot level
    // behind it (the way it goes over the ground), a little above it, looking ahead along
    // the ground: the ball drops down the frame with the green, the pin and the horizon in
    // view. Held from just before touchdown (the bounce turns the ball's direction over
    // in one step; the settle below takes it from there).
    if (t < ft - 0.06) approach = smoother(APPROACH_SIN[0], APPROACH_SIN[1], -dir[2]);
    const air = {
      x: lerp(a.x, b.x - flat[0] * back, approach),
      y: lerp(a.y, b.y - flat[1] * back, approach),
      z: lerp(a.z, b.z + APPROACH_UP_M, approach) + FOLLOW_UP_M,
    };
    const lead = FOLLOW_LOOK_AHEAD_M * (1 - down);
    if (L) {
      // behind where the ball comes down until it does, then behind the ball itself
      const f = flatL || flat, at = t < ft ? plan.land : b, g = groundAt(at.x, at.y);
      goal.push({
        x: lerp(air.x, at.x - f[0] * L.backM, down),
        y: lerp(air.y, at.y - f[1] * L.backM, down),
        z: lerp(air.z, g + L.upM, down),
      });
      // at the ball while it falls; once it is down, at the turf under it
      const onTurf = smoother(ft, ft + 0.2, t);
      aim.push({
        x: b.x + lerp(dir[0], flat[0], approach) * lead,
        y: b.y + lerp(dir[1], flat[1], approach) * lead,
        z: lerp(b.z + lerp(dir[2], -APPROACH_LOOK_DROP, approach) * lead, groundAt(b.x, b.y) + L.lookUpM, onTurf),
      });
    } else {
      goal.push({
        x: lerp(air.x, b.x - flat[0] * SETTLE_BACK_M, down),
        y: lerp(air.y, b.y - flat[1] * SETTLE_BACK_M, down),
        z: lerp(air.z, b.z + SETTLE_UP_M, down),
      });
      aim.push({
        x: b.x + lerp(dir[0], flat[0], approach) * lead,
        y: b.y + lerp(dir[1], flat[1], approach) * lead,
        z: b.z + lerp(dir[2], -APPROACH_LOOK_DROP, approach) * lead + 0.3 * down,
      });
    }
    downs.push(down);
  }
  // its speed, steadied (the jolt of the ball meeting the ground taken out), matched in
  // part outright through the flight and let go as the ball comes down
  const vr = Math.round(0.05 / FOLLOW_DT), sr = Math.round(0.15 / FOLLOW_DT);
  const goalV = ['x', 'y', 'z'].map((k) => boxFilter(boxFilter(goal.map((_, i) => {
    const i0 = Math.max(0, i - vr), i1 = Math.min(n, i + vr);
    return (goal[i1][k] - goal[i0][k]) / Math.max(FOLLOW_DT, (i1 - i0) * FOLLOW_DT);
  }), sr), sr));
  const pos = [];
  const cam = { ...start }, camV = { x: 0, y: 0, z: 0 };
  ['x', 'y', 'z'].forEach((k, j) => {
    cam[k] = start[k];
    camV[k] = 0;
    for (let i = 0; i <= n; i++) {
      const w = FOLLOW_OMEGA * smoother(0, FOLLOW_TAKE_UP_S, T[i]);
      const match = FOLLOW_MATCH * smoother(0, FOLLOW_MATCH_IN_S, T[i]) * (1 - downs[i]) * goalV[j][i];
      camV[k] += (w * w * (goal[i][k] - cam[k]) + 2 * w * (match - camV[k])) * FOLLOW_DT;
      cam[k] += camV[k] * FOLLOW_DT;
      if (!pos[i]) pos[i] = {};
      pos[i][k] = cam[k];
    }
  });
  // the look, steadied (a centred average: no lag, and the turn from the descent to the
  // roll and the bounces smoothed out), eased out of the address framing
  const r = Math.round(0.12 / FOLLOW_DT);
  const steady = ['x', 'y', 'z'].map((k) => boxFilter(boxFilter(aim.map((q) => q[k]), r), r));
  const sl = plan.startLook || P[0];
  const look = aim.map((_, i) => {
    const w = smoother(0, FOLLOW_LOOK_IN_S, T[i]);
    return { x: lerp(sl.x, steady[0][i], w), y: lerp(sl.y, steady[1][i], w), z: lerp(sl.z, steady[2][i], w) };
  });
  // the tail: onto the spot behind the resting ball, arriving still
  const restAt = goal[n], from = Math.max(ft + 0.3, end + FOLLOW_TAIL_S - 1.1);
  for (let i = 0; i <= n; i++) {
    const a = smoother(from, end + FOLLOW_TAIL_S, T[i]);
    if (a <= 0) continue;
    for (const k of ['x', 'y', 'z']) pos[i][k] = lerp(pos[i][k], restAt[k], a);
  }
  // above the ground and the tree crowns, lifted smoothly (and not at all at impact)
  const need = pos.map((c, i) => {
    let top = groundAt(c.x, c.y) + CAM_CLEARANCE_M;
    if (treeTopAt) top = Math.max(top, treeTopAt(c.x, c.y));
    return Math.max(0, top - c.z) * smoother(0, FOLLOW_TAKE_UP_S, T[i]);
  });
  if (need.some((v) => v > 0)) {
    const rr = Math.round(0.25 / FOLLOW_DT);
    const lift = boxFilter(maxFilter(need, rr), rr);
    pos.forEach((c, i) => { c.z += lift[i]; });
  }
  return { ...plan, end: pos[pos.length - 1], tail: FOLLOW_TAIL_S, path: { dt: FOLLOW_DT, pos, look }, zoom: 1 };
}

// ---------------------------------------------------------------------------------------
// The ball cam, and the pin cam it becomes for a ball that finishes by the flag.
export const BALL_CAM = Object.freeze({
  backM: 5.5,            // in flight it chases a spot this far behind the ball, over the ground...
  headstartM: 6,         // (at impact, this much further back than the address camera stands,
  catchUpS: 1.5,         //  closing over this: the ball gets away, then the camera catches it up)
  lookDownDeg: 9,        // ...looking forward and this far down in level flight,
  climbGain: 0.15,       // a little less while the ball climbs (per degree of climb),
  dropGain: 0.45,        // and more as it falls, so the ground it is falling to comes up the frame
  lookDownRange: Object.freeze([5, 30]),
  ballBelowDeg: 7.5,     // the ball rides this far under the middle of the frame
  aheadM: 14,            // it looks at a point this far ahead of the ball
  omega: 5.5,            // rad/s: the critically damped chase (the ball leads, the camera follows)
  match: 0.93,           // how much of the chased spot's own speed it matches outright
  anticipateS: 1.0,      // before touchdown it leaves the flight for the landing vantage:
  landBackM: 11,         // this far behind where the ball comes down (then behind the ball itself)
  landUpM: 3.4,          // and this far above the ground there: the bounces rise and fall in the frame
  landGapM: 3.5,         // (that vantage is never nearer than this behind a ball still coming down)
  lookUpM: 0.55,         // once the ball is down it looks at the turf under it, this far up
  rollBackM: 4.8,        // as the ball runs out of pace it closes to this far behind it...
  rollUpM: 1.6,          // ...and this far above the ground
  rollClearM: 1.0,       // (and may come this near the ground itself)
  widen: 0.14,           // speed is felt: the lens opens by up to this much...
  widenMps: Object.freeze([35, 80]),   // ...between these ball speeds on screen
  bankGain: 0.6,         // it banks into a curving flight: this much of the turn's own lean,
  bankMaxDeg: 7,         // never more than this
  ballScale: 2.4,        // the ball is drawn this much bigger high in the air (easy to follow)...
  ballScaleM: Object.freeze([3, 14]),  // ...between these heights above the ground
  leash: 0.6,            // whatever the framing, the ball stays within this much of the frame's middle
});
// v2:seeover the plain address camera (scene.js _idleTargets), and the way down to it from a raised one
export const ADDRESS = Object.freeze({
  backM: 14, upM: 4.6, clearM: 1.7,
  comeDownMps: 28,       // a raised address camera comes down onto the chase at about this pace (0.8 to 3.6 s)
  maxGlideMps: 40,       // no more of the address camera's own glide than this is carried into the shot
});
export const PIN_CAM = Object.freeze({
  closeM: 4.6,           // a ball that finishes within this of the cup (15 ft) is a close one
  lipM: Object.freeze({ shot: 1.1, putt: 0.45 }),   // ...as is one that, moving, passes this near it
  directS: 0.7,          // holed within this long of touching down: it flew or pitched straight in
  backM: Object.freeze([3.7, 2.5]),   // the chase: this far behind the ball, closing as it slows...
  upM: Object.freeze([1.1, 0.5]),     // ...and this far above the green: low, so the green's far edge and the horizon are in the picture
  lookUpM: 0.2,          // it looks this far above the ball and the cup, which puts them in the lower half of the frame
  clearM: 0.3,           // it may come this near the ground
  swingDeg: 50,          // it may swing this far round the ball to put the cup ahead of it, never further
  offLineDeg: 12,        // ...and it stands this far off the ball's line to the cup, so the ball does not hide the hole
  zoomIn: 1.3,           // the lens as the chase begins...
  zoom: Object.freeze({ holed: 2.0, lip: 1.8, close: 1.7, putt: 1.5 }),   // ...and at the end
  tailS: 1.0,            // after the ball stops, the camera comes to rest over this
});

/**
 * Is this shot a close one? The whole path is known at impact, so the camera can decide
 * before the ball has moved. pin {x,y}; holed: the ball goes in; cup: feel.js's drop.
 * Returns null for an ordinary shot, else { kind, tNear, dEnd, dMin, direct }:
 *   kind 'holed' | 'lip' (the moving ball passes within PIN_CAM.lipM of the cup once it is
 *   down) | 'close' (it finishes within PIN_CAM.closeM); tNear: when it reaches the cup, or
 *   is nearest it; direct: holed straight from the air or off its first bounce.
 */
export function closeOne(points, { pin = null, flightTime = 0, isPutt = false, holed = false, cup = null } = {}) {
  if (!pin || !points || points.length < 2) return null;
  const last = points[points.length - 1];
  const ft = isPutt ? 0 : (Number.isFinite(flightTime) ? flightTime : 0);
  const dEnd = Math.hypot(last.x - pin.x, last.y - pin.y);
  if (holed || cup) {
    const tNear = cup && Number.isFinite(cup.t0) ? cup.t0 : last.t;
    return { kind: 'holed', tNear, dEnd: 0, dMin: 0, direct: !isPutt && tNear - ft < PIN_CAM.directS };
  }
  let dMin = Infinity, tNear = last.t;
  for (let i = 1; i < points.length; i++) {
    const p = points[i], q = points[i - 1], dt = p.t - q.t;
    if (p.t < ft || !(dt > 0) || Math.hypot(p.x - q.x, p.y - q.y) / dt < 0.25) continue;
    const d = Math.hypot(p.x - pin.x, p.y - pin.y);
    if (d < dMin) { dMin = d; tNear = p.t; }
  }
  if (dMin < (isPutt ? PIN_CAM.lipM.putt : PIN_CAM.lipM.shot)) return { kind: 'lip', tNear, dEnd, dMin, direct: false };
  if (dEnd <= PIN_CAM.closeM) return { kind: 'close', tNear: last.t, dEnd, dMin: Math.min(dMin, dEnd), direct: false };
  return null;
}

const wrapPi = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

// The ball cam's path, worked out once per shot at FOLLOW_DT like the follow camera's.
//
// In the air it chases a spot BALL_CAM.backM behind the ball, level with the ground along
// the way the ball is heading, and high enough above it that, looking forward and a little
// down, the ball sits just under the middle of the frame; the steeper the ball falls, the
// further down it looks (and the higher it sits), so the ground the ball is falling to
// comes up the frame. The heading follows the flight (a slice swings the camera round
// behind the ball, and banks it) and is held from touchdown: a ball that spins back, or
// kicks off a slope, never turns the camera round. Before touchdown it brakes to the
// landing vantage, behind where the ball comes down; it follows the bounces from there at
// a steady height and closes in, lower, as the ball runs out of pace.
//
// A close one (closeOne) and every putt then get the pin cam: the chase eases down and in
// to a couple of metres behind the ball, under a metre off the green, the lens closing,
// swung (never more than PIN_CAM.swingDeg) to put the cup ahead of the ball, looking
// between the two. Once the ball is past the cup (a lip-out, a ball spinning back to the
// hole) it is the cup the camera stays behind, so the cup never leaves the frame. A ball
// that flies or pitches straight in has no roll to chase: the lens closes on the flag
// before the ball arrives, and the camera pushes in on the cup after the drop.
//
// The camera is sprung to what it chases (it starts at the address camera, at rest), so
// its motion is continuous whatever the ball does; it is lifted, smoothly, over the
// ground, the tree crowns and anything between it and the ball; and the look is leashed
// to the ball, so the ball never leaves the frame.
function ballCamera(points, plan, { pin = null, cup = null, holed = false } = {}) {
  const C = BALL_CAM, K = PIN_CAM;
  const { groundAt, treeTopAt, isPutt } = plan;
  let { start } = plan;   // v2:seeover (the chase may start from the plain address spot instead: below)
  const end = points[points.length - 1].t;
  const ft = isPutt ? 0 : Math.min(plan.flightTime, end);
  const co = pin ? closeOne(points, { pin, flightTime: ft, isPutt, holed, cup }) : null;
  const pc = co || (isPutt && pin ? { kind: 'putt', tNear: end, direct: false } : null);
  const direct = !!(pc && pc.direct);
  // a holed ball's hold on the cup is already in its path (feel.js): the camera only settles
  const tail = pc ? (cup ? 0.3 : K.tailS) : FOLLOW_TAIL_S;
  const dt = FOLLOW_DT, n = Math.max(1, Math.ceil((end + tail) / dt));
  const T = new Array(n + 1), P = new Array(n + 1), Gz = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    T[i] = i * dt;
    P[i] = smoothPointAt(points, Math.min(end, T[i]), ft);
    Gz[i] = groundAt(P[i].x, P[i].y);
  }
  // v2:seeover The see-over address camera (see-over.js) may stand 35 m above the ball and 40 m
  // back, the view from above 110 m up. Sprung straight from there, the chase dives at the
  // ball at 250 m/s. So from a camera standing higher or further back than the plain address
  // spot (ADDRESS.backM behind the ball, upM above it), the chase runs as it always does from
  // that plain spot, and the camera rides an offset onto it that eases away (a cubic from
  // where, and how fast, the camera really is at impact, to nothing): it starts exactly at
  // the address camera, comes down with the shot over a second or three, and from then on is
  // the ball cam as from any other lie. From the plain address camera nothing changes.
  let off = null, offT = 0;
  {
    const hx = P[0].x - start.x, hy = P[0].y - start.y, hd0 = Math.hypot(hx, hy);
    const vd = Math.min(hd0, ADDRESS.backM), k = hd0 > 1e-6 ? vd / hd0 : 0;
    const vx = P[0].x - hx * k, vy = P[0].y - hy * k;
    const plain = { x: vx, y: vy, z: Math.max(groundAt(vx, vy) + ADDRESS.clearM, Gz[0] + ADDRESS.upM) };
    const o = { x: start.x - plain.x, y: start.y - plain.y, z: start.z - plain.z };
    if (o.z > 0.5 || hd0 > ADDRESS.backM + 0.5) {
      off = o;
      offT = Math.min(clamp(Math.hypot(o.x, o.y, o.z) / ADDRESS.comeDownMps, 0.8, 3.6), 0.8 * (end + tail));
      start = plain;
    }
  }
  // the ball's velocity, and the same steadied (its heading and the angle it climbs or falls at)
  const vr = Math.max(1, Math.round(0.05 / dt)), sr = Math.round(0.2 / dt);
  const V = P.map((_, i) => {
    const i0 = Math.max(0, i - vr), i1 = Math.min(n, i + vr), h = Math.max(dt, (i1 - i0) * dt);
    return [(P[i1].x - P[i0].x) / h, (P[i1].y - P[i0].y) / h, (P[i1].z - P[i0].z) / h];
  });
  const sv = [0, 1, 2].map((k) => boxFilter(boxFilter(V.map((v) => v[k]), sr), sr));
  // the heading (azimuth, x east / y north): from the address camera's own line, onto the
  // ball's flight over the first second, then held from just before touchdown
  const a0 = Math.atan2(P[0].x - start.x, P[0].y - start.y) || 0;
  const iHold = isPutt ? 0 : Math.max(0, Math.round((ft - 0.08) / dt));
  let az = plan.carry > 1 && !isPutt ? a0 + wrapPi(Math.atan2(plan.land.x - plan.p0.x, plan.land.y - plan.p0.y) - a0) : a0;
  let hd = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    if (i <= iHold && !isPutt && Math.hypot(sv[0][i], sv[1][i]) > 2.5) {
      const d = wrapPi(Math.atan2(sv[0][i], sv[1][i]) - az);
      if (Math.abs(d) < 1.75) az += d;   // a ball knocked back the way it came does not turn the camera round
    }
    hd[i] = a0 + (az - a0) * smoother(0, 1.0, T[i]);
  }
  const hr = Math.round(0.25 / dt);
  hd = boxFilter(boxFilter(hd, hr), hr);

  // the pin cam: how far it has taken over (0..1), and how far it swings round the ball
  const pw = new Array(n + 1).fill(0), lens = new Array(n + 1).fill(0);
  let swing = 0;
  if (pc) {
    let tA, tB;
    if (isPutt) { tA = 0; tB = clamp(0.5 * end, 1.0, 2.2); }
    else if (direct) { tA = ft + 0.05; tB = ft + 1.1; }
    else { tA = ft + 0.45; tB = Math.max(tA + 1.1, Math.min(pc.tNear - 1.5, end - 1.2)); }
    for (let i = 0; i <= n; i++) {
      pw[i] = smoother(tA, tB, T[i]);
      // straight in: the lens is already closing on the flag as the ball comes down
      lens[i] = direct ? Math.max(pw[i], smoother(ft - 1.4, ft - 0.1, T[i])) : pw[i];
    }
    const ref = isPutt ? P[0] : P[Math.min(n, Math.round(tA / dt))];
    const rx = pin.x - ref.x, ry = pin.y - ref.y;
    if (!direct && Math.hypot(rx, ry) > 1.5) {
      // put the cup ahead of the ball; when it is behind the ball instead (a ball coming
      // back to the hole), the camera looks at it over the cup, from the side it is on
      let d = wrapPi(Math.atan2(rx, ry) - hd[n]);
      if (Math.abs(d) > Math.PI / 2) d = wrapPi(d + Math.PI);
      // a little off the line itself, on the side it is already swinging to
      swing = clamp(d + (d < 0 ? -1 : 1) * K.offLineDeg * D2R, -K.swingDeg * D2R, K.swingDeg * D2R);
    } else if (!direct) swing = K.offLineDeg * D2R;
  }
  const pinG = pin ? groundAt(pin.x, pin.y) : 0;
  const endEff = cup && Number.isFinite(cup.tDrop) ? cup.tDrop : end;

  const delta = C.ballBelowDeg * D2R;
  const startBack = Math.max(C.backM, Math.hypot(start.x - P[0].x, start.y - P[0].y) + C.headstartM);
  const land = plan.land;
  const goal = new Array(n + 1), aim = new Array(n + 1), downs = new Array(n + 1);
  const zoom = new Array(n + 1), clear = new Array(n + 1), bank = new Array(n + 1), scale = new Array(n + 1);
  let q = 0;
  for (let i = 0; i <= n; i++) {
    const t = T[i], b = P[i];
    const ang = hd[i] + swing * pw[i], fx = Math.sin(ang), fy = Math.cos(ang);
    const vh = Math.hypot(sv[0][i], sv[1][i]);
    const hag = Math.max(0, b.z - Gz[i]);
    // in the air: behind and above the ball, looking forward and down
    const gamma = vh > 0.5 || Math.abs(sv[2][i]) > 0.5 ? Math.atan2(sv[2][i], vh) : 0;
    const phi = clamp(C.lookDownDeg * D2R - gamma * (gamma < 0 ? C.dropGain : C.climbGain),
      C.lookDownRange[0] * D2R, C.lookDownRange[1] * D2R);
    const back = lerp(startBack, C.backM, smoother(0, C.catchUpS, t));
    const up = Math.min(back, C.backM * 1.5) * Math.tan(phi + delta);
    const air = { x: b.x - fx * back, y: b.y - fy * back, z: b.z + up };
    const zOff = C.backM * Math.tan(phi + delta) - Math.tan(phi) * (C.backM + C.aheadM);
    // on the ground: behind where it comes down, then behind the ball, closing as it slows
    const down = isPutt ? 1 : smoother(ft - C.anticipateS, ft - 0.05, t);
    const at = !isPutt && t < ft ? land : b;
    const calm = (1 - smoother(0.5, 3.0, end - t)) * (isPutt ? 1 : smoother(ft + 0.3, ft + 1.2, t));
    const Bg = lerp(C.landBackM, C.rollBackM, calm), Ug = lerp(C.landUpM, C.rollUpM, calm);
    const ground = { x: at.x - fx * Bg, y: at.y - fy * Bg, z: groundAt(at.x, at.y) + Ug };
    // ...but never ahead of a ball still on its way there (one falling steeply is a long time
    // getting to its landing spot): the vantage keeps this far behind the ball until the ball passes it
    const gap = (b.x - ground.x) * fx + (b.y - ground.y) * fy;
    if (gap < C.landGapM) { ground.x -= fx * (C.landGapM - gap); ground.y -= fy * (C.landGapM - gap); }
    let g = { x: lerp(air.x, ground.x, down), y: lerp(air.y, ground.y, down), z: lerp(air.z, ground.z, down) };
    const lead = 1 - down, onTurf = isPutt ? 1 : smoother(ft, ft + 0.2, t);
    let a = {
      x: b.x + fx * C.aheadM * lead, y: b.y + fy * C.aheadM * lead,
      z: lerp(b.z + zOff * lead, Gz[i] + C.lookUpM, onTurf),
    };
    let z = 1, cl = lerp(CAM_CLEARANCE_M, C.rollClearM, calm * down);
    if (pc) {
      const dC = Math.hypot(b.x - pin.x, b.y - pin.y);
      // which of the two the camera stays behind: the ball, until it is past the cup
      const m = (b.x - pin.x) * fx + (b.y - pin.y) * fy;
      const kA = direct ? 1 : smooth(-0.3, 0.8, m) * (1 - smooth(8, 14, dC));
      const ax = lerp(b.x, pin.x, kA), ay = lerp(b.y, pin.y, kA);
      // how far in it has closed: as the ball runs out of time, or reaches the cup (never back out)
      q = Math.max(q, 1 - smoother(0.4, 2.5, endEff - t), pw[i] > 0 ? 1 - smooth(0.6, 4, dC) : 0);
      const Bp = direct ? lerp(6.5, 3.4, q) : Math.max(lerp(K.backM[0], K.backM[1], q), 2 + 2.2 * hag);
      const Up = (direct ? lerp(2.0, 0.8, q) : lerp(K.upM[0], K.upM[1], q)) + 0.35 * hag;
      const pg = { x: ax - fx * Bp, y: ay - fy * Bp, z: groundAt(ax, ay) + Up };
      // it looks between the ball and the cup (at the cup's mouth, not down the hole after the ball)
      const w = dC > 1e-6 ? Math.min(0.5, 1.5 / dC) : 0.5;
      const pa = { x: lerp(b.x, pin.x, w), y: lerp(b.y, pin.y, w), z: lerp(Math.max(b.z, Gz[i]) + 0.07, pinG + 0.04, w) + K.lookUpM * q };
      const p = pw[i], pl = lens[i];
      g = { x: lerp(g.x, pg.x, p), y: lerp(g.y, pg.y, p), z: lerp(g.z, pg.z, p) };
      a = { x: lerp(a.x, pa.x, pl), y: lerp(a.y, pa.y, pl), z: lerp(a.z, pa.z, pl) };
      z = lerp(1, lerp(direct ? 1.6 : K.zoomIn, K.zoom[pc.kind] || K.zoom.close, q), pl);
      cl = lerp(cl, K.clearM, p);
    }
    goal[i] = g; aim[i] = a; downs[i] = down; clear[i] = cl;
    // speed is felt: the lens opens a little at pace (never at impact)
    const sp = Math.hypot(V[i][0], V[i][1], V[i][2]);
    zoom[i] = z * (1 - C.widen * smooth(C.widenMps[0], C.widenMps[1], sp) * smoother(0, 0.35, t) * (1 - down));
    // it banks into a curving flight
    const i0 = Math.max(0, i - vr), i1 = Math.min(n, i + vr);
    const turn = (hd[i1] - hd[i0]) / Math.max(dt, (i1 - i0) * dt);   // rad/s, + = turning right
    bank[i] = clamp(C.bankGain * vh * turn / 9.81, -C.bankMaxDeg * D2R, C.bankMaxDeg * D2R)
      * smoother(0.3, 1.0, t) * (1 - down);
    scale[i] = 1 + (C.ballScale - 1) * (isPutt ? 0 : smooth(C.ballScaleM[0], C.ballScaleM[1], hag));
  }

  // the chase: sprung to its goal, matching part of the goal's own (steadied) speed in flight
  const gr = Math.round(0.15 / dt);
  const goalV = ['x', 'y', 'z'].map((k) => boxFilter(boxFilter(goal.map((_, i) => {
    const i0 = Math.max(0, i - vr), i1 = Math.min(n, i + vr);
    return (goal[i1][k] - goal[i0][k]) / Math.max(dt, (i1 - i0) * dt);
  }), gr), gr));
  const pos = new Array(n + 1);
  for (let i = 0; i <= n; i++) pos[i] = { x: 0, y: 0, z: 0 };
  ['x', 'y', 'z'].forEach((k, j) => {
    let c = start[k], v = 0;
    for (let i = 0; i <= n; i++) {
      const w = C.omega * smoother(0, FOLLOW_TAKE_UP_S, T[i]);
      const match = C.match * smoother(0, FOLLOW_MATCH_IN_S, T[i]) * (1 - downs[i]) * goalV[j][i];
      v += (w * w * (goal[i][k] - c) + 2 * w * (match - v)) * dt;
      c += v * dt;
      pos[i][k] = c;
    }
  });
  // the tail: onto the spot it was chasing, arriving still
  const restAt = goal[n], from = Math.max(ft + 0.3, end + tail - 1.1);
  for (let i = 0; i <= n; i++) {
    const a = smoother(from, end + tail, T[i]);
    if (a <= 0) continue;
    for (const k of ['x', 'y', 'z']) pos[i][k] = lerp(pos[i][k], restAt[k], a);
  }
  // v2:seeover the way down from a raised address camera (above): what is left of its offset, on top of the chase
  if (off && offT > 0) {
    const sv0 = plan.startVel || { x: 0, y: 0, z: 0 };
    const sp = Math.hypot(sv0.x || 0, sv0.y || 0, sv0.z || 0), vk = sp > ADDRESS.maxGlideMps ? ADDRESS.maxGlideMps / sp : 1;
    for (let i = 0; i <= n && T[i] < offT; i++) {
      const u = T[i] / offT, h0 = 2 * u * u * u - 3 * u * u + 1, h1 = (u * u * u - 2 * u * u + u) * offT * vk;
      pos[i].x += h0 * off.x + h1 * (sv0.x || 0);
      pos[i].y += h0 * off.y + h1 * (sv0.y || 0);
      pos[i].z += h0 * off.z + h1 * (sv0.z || 0);
    }
  }
  // above the ground and the tree crowns, and over whatever ground lies between it and
  // the ball (a ridge, the lip of a cliff): lifted smoothly, and not at all at impact
  const need = pos.map((c, i) => {
    const b = P[i], bz = Math.max(b.z, Gz[i]) + 0.1;
    let top = groundAt(c.x, c.y) + clear[i];
    if (treeTopAt) top = Math.max(top, treeTopAt(c.x, c.y));
    for (const u of [0.2, 0.4, 0.6, 0.78]) {
      const h = groundAt(lerp(c.x, b.x, u), lerp(c.y, b.y, u)) + 0.05;
      top = Math.max(top, (h - u * bz) / (1 - u));
    }
    return Math.max(0, top - c.z) * smoother(0, FOLLOW_TAKE_UP_S, T[i]);
  });
  if (need.some((v) => v > 0)) {
    const rr = Math.round(0.25 / dt);
    const lift = boxFilter(maxFilter(need, rr), rr);
    pos.forEach((c, i) => { c.z += lift[i]; });
  }
  // the lens, the bank and the ball's size, steadied
  const zr = Math.round(0.2 / dt);
  const zoomS = boxFilter(boxFilter(zoom, zr), zr).map((v, i) => lerp(1, v, smoother(0, 0.3, T[i])));
  const bankS = boxFilter(boxFilter(bank, zr), zr).map((v, i) => v * smoother(0, 0.4, T[i]));   // level at impact
  const scaleS = boxFilter(boxFilter(scale, zr), zr);
  // the look: steadied, eased out of the address framing, then leashed to the ball
  const r = Math.round(0.12 / dt);
  const steady = ['x', 'y', 'z'].map((k) => boxFilter(boxFilter(aim.map((v) => v[k]), r), r));
  const sl = plan.startLook || P[0];
  const tanHalf = Math.tan(plan.halfFov);
  const look = aim.map((_, i) => {
    const w = smoother(0, FOLLOW_LOOK_IN_S, T[i]);
    const l = { x: lerp(sl.x, steady[0][i], w), y: lerp(sl.y, steady[1][i], w), z: lerp(sl.z, steady[2][i], w) };
    const b = { x: P[i].x, y: P[i].y, z: Math.max(P[i].z, Gz[i]) + 0.09 };
    const held = leash(pos[i], l, b, Math.atan(C.leash * tanHalf / Math.max(0.5, zoomS[i])));
    return { x: lerp(l.x, held.x, w), y: lerp(l.y, held.y, w), z: lerp(l.z, held.z, w) };
  });
  return {
    ...plan, end: pos[n], tail, pinCam: pc,
    path: { dt, pos, look, zoom: zoomS, roll: bankS, ballScale: scaleS },
    zoom: 1,
  };
}

function followAt(plan, t) {
  const { dt, pos, look, zoom, roll, ballScale } = plan.path;
  const f = clamp(t / dt, 0, pos.length - 1), i = Math.min(pos.length - 2, Math.floor(f)), u = f - i;
  const at = (a) => (a.length < 2 ? { ...a[0] } : { x: lerp(a[i].x, a[i + 1].x, u), y: lerp(a[i].y, a[i + 1].y, u), z: lerp(a[i].z, a[i + 1].z, u) });
  if (!zoom) return { pos: at(pos), look: at(look), zoom: 1 };
  const s = (a) => (a.length < 2 ? a[0] : lerp(a[i], a[i + 1], u));
  // the ball cam: its lens, its bank (radians, + = leaning right) and how big the ball is drawn
  return { pos: at(pos), look: at(look), zoom: s(zoom), roll: s(roll), ballScale: s(ballScale) };
}

// Camera position + look target + lens zoom at sim time t.
export function flightCameraAt(plan, t, points) {
  if (plan.path) return followAt(plan, t);
  const u = plan.moves ? smooth(plan.glideStart, plan.glideEnd, t) : 0;
  const pos = glidePos(plan, u);
  const ball = pointAt(points, t) || plan.last;
  const air = t < plan.flightTime;
  // Descent framing: look slightly AHEAD of the ball toward the landing spot while it's
  // in the air so the drop zone enters frame before the ball does; settle on the ball
  // once down. The lead shrinks on the drop, so a zoomed frame keeps the ball near centre.
  const drop = plan.moves ? smooth(plan.apexT, plan.flightTime, t) : 0;
  const lead = air ? 0.22 * smooth(0, plan.flightTime * 0.5, t) * (1 - 0.5 * drop) : 0;
  const dropLook = {
    x: lerp(ball.x, plan.land.x, lead),
    y: lerp(ball.y, plan.land.y, lead),
    z: lerp(ball.z, plan.land.z, lead) + 0.6,
  };
  if (!plan.moves) return { pos, look: dropLook, zoom: 1 };

  // The lens: through the climb it closes in, telephoto, to suit how far the ball has
  // gone by the time the camera glides; from there it runs straight on to DROP_ZOOM at
  // touchdown (out from a drive's telephoto, in from a wedge's, never breathing back on
  // the way), so the falling ball and its landing spot fill the frame; then about half
  // back out over the roll so the run-out stays in view. Eased at every hand-over.
  const roll = smooth(plan.flightTime + 0.3, plan.flightTime + 2.0, t);
  const zoom = t > plan.flightTime ? 1 + (DROP_ZOOM - 1) * (1 - 0.45 * roll)
    : t >= plan.glideStart ? lerp(plan.climbZoom, DROP_ZOOM, smooth(plan.glideStart, plan.flightTime, t))
      : 1 + (plan.climbZoom - 1) * smooth(Math.min(0.15, plan.glideStart / 2), plan.glideStart, t);

  // Climb framing, from wherever the camera is: aim so the ball rides CLIMB_FRAME above
  // the middle of the frame. It starts from the address framing (no jolt at impact) and
  // hands over to the descent framing as the camera glides away.
  const v = smooth(0, 1, u);
  const dx = dropLook.x - pos.x, dy = dropLook.y - pos.y;
  const horiz = Math.max(1, Math.hypot(dx, dy));
  const ballDist = Math.hypot(ball.x - pos.x, ball.y - pos.y);
  const halfZ = Math.atan(Math.tan(plan.halfFov) / zoom);
  const eBall = Math.atan2(ball.z - pos.z, Math.max(1, ballDist));
  let pitch = eBall - Math.atan(CLIMB_FRAME * Math.tan(halfZ));
  let az = Math.atan2(dx, dy);
  if (plan.startLook) {
    // ease in from the address look over the first half second
    const s = plan.startLook, w = smooth(0, 0.5, t);
    const sh = Math.max(1, Math.hypot(s.x - pos.x, s.y - pos.y));
    const sAz = Math.atan2(s.x - pos.x, s.y - pos.y);
    let dAz = az - sAz;
    dAz -= 2 * Math.PI * Math.round(dAz / (2 * Math.PI));
    az = sAz + dAz * w;
    pitch = lerp(Math.atan2(s.z - pos.z, sh), pitch, w);
  }
  const reach = Math.max(horiz, ballDist);
  const climbLook = {
    x: pos.x + Math.sin(az) * reach,
    y: pos.y + Math.cos(az) * reach,
    z: pos.z + Math.tan(pitch) * reach,
  };
  const look = { x: lerp(climbLook.x, dropLook.x, v), y: lerp(climbLook.y, dropLook.y, v), z: lerp(climbLook.z, dropLook.z, v) };
  // Whatever the framing asks for, the ball stays well inside the frame: a camera gliding
  // under a high ball can look far enough ahead to lose it from a telephoto frame. The
  // leash takes hold once the address framing has handed over (no jolt at impact).
  const leashed = leash(pos, look, ball, Math.atan(LEASH * Math.tan(halfZ)));
  const w = plan.startLook ? smooth(0, 0.5, t) : 1;
  return { pos, look: { x: lerp(look.x, leashed.x, w), y: lerp(look.y, leashed.y, w), z: lerp(look.z, leashed.z, w) }, zoom };
}

// The look target turned toward the ball until the ball is at most maxA off the line of
// sight: untouched up to 60% of that, then a smooth saturation (no kink where it engages).
function leash(pos, look, ball, maxA) {
  const l = [look.x - pos.x, look.y - pos.y, look.z - pos.z];
  const b = [ball.x - pos.x, ball.y - pos.y, ball.z - pos.z];
  const ll = Math.hypot(...l), bl = Math.hypot(...b);
  if (ll < 1e-6 || bl < 1e-6) return look;
  const a = Math.acos(clamp((l[0] * b[0] + l[1] * b[1] + l[2] * b[2]) / (ll * bl), -1, 1));
  const k = 0.6 * maxA;
  if (a <= k || a > Math.PI - 1e-3) return look;
  const a2 = k + (maxA - k) * Math.tanh((a - k) / (maxA - k));
  // slerp from the ball's direction toward the look's, stopping a2 off the ball
  const s = Math.sin(a), w0 = Math.sin(a - a2) / s, w1 = Math.sin(a2) / s;
  const d = [0, 1, 2].map((i) => w0 * b[i] / bl + w1 * l[i] / ll);
  return { x: pos.x + d[0] * ll, y: pos.y + d[1] * ll, z: pos.z + d[2] * ll };
}

// Sliding-window max / mean over an array (window clipped at the ends).
function maxFilter(a, r) {
  return a.map((_, i) => { let m = -Infinity; for (let k = Math.max(0, i - r); k <= Math.min(a.length - 1, i + r); k++) m = Math.max(m, a[k]); return m; });
}
function boxFilter(a, r) {
  return a.map((_, i) => { let s = 0, n = 0; for (let k = Math.max(0, i - r); k <= Math.min(a.length - 1, i + r); k++) { s += a[k]; n++; } return s / n; });
}
