// v2:seeover The SEE-OVER address camera (arcade): where to stand, behind the ball, so the
// player can see what they are hitting at. Pure (no three, no DOM), unit-tested
// (test/see-over.test.mjs). scene.js glides the camera to the pose worked out here.
//
// What must be seen: the ball, at the bottom of the frame, and the aim target (where the
// club in hand is predicted to land and stop, along the aim; the pin too when it is within
// reach). The address camera as it always was (SEE_OVER.backM behind the ball, upM above
// it) is kept whenever its sight lines are clear: on open ground nothing changes. When the
// ground (or a wood, or a building, further than the things that are simply faded out of
// the way: tree-fade.js, props.js) stands in a sight line the camera takes the LOWEST pose
// that clears it:
//   1. crane UP where it stands, pitching down, while ball and target still fit the frame;
//   2. then pull BACK along the line as well, up to maxUpM above the ball and maxBackM
//      behind it;
//   3. past that the target cannot be seen from behind the ball (a butte 80 m above): the
//      pose frames the ball and the top of what is in the way, and says so (visible:
//      false); the scene then flies up to the view from above (aboveView) or pins a marker
//      for the target to the edge of the frame.
// Every step is continuous in the aim on continuous ground (the height is the least that
// clears, not a pick from a list), so sweeping the aim never makes the camera jump.
//
// Sim coordinates throughout: x east, y north, z up (metres). Angles named to* and pitch
// are depressions: radians below the horizontal.

const D2R = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export const SEE_OVER = Object.freeze({
  backM: 14, upM: 4.6, clearM: 1.7,   // the address camera as it is (scene.js _idleTargets)
  maxUpM: 35, maxBackM: 40,           // the furthest the standing camera cranes up and pulls back
  backStepM: 2,                       // the pull-back is searched at this step, then refined
  fadeAheadM: 60,                     // trees and props this far past the ball are faded, not looked over
  crownLiftM: 5, crownBackM: 6,       // past that, a tree or a building is looked over only if this much more height and room does it
  fadeOpacity: 0.16,                  // how much of a prop standing in the way is left: a ghost
  ballNdc: 0.82,                      // the ball never sits lower in the frame than this (share of the half-height below the middle)
  targetNdc: 0.6,                     // ...nor the target higher than this above it
  obstacleNdc: 0.62,                  // (a target that cannot be seen: the top of what hides it, instead)
  fovDeg: 58,
  marginM: 0.5,                       // a sight line clears the ground by this...
  marginPerM: 0.01,                   // ...and by this much more per metre short of the target (so the ground in front of it shows too),
  marginMaxM: 1.5,                    // up to this,
  marginFromM: Object.freeze([8, 40]),   // taken up between these distances from the camera
  slackM: 0.3,                        // a lift smaller than this is not worth a move
  ballMarginM: 0.15,
  stepM: 2,                           // a sight line is tested every this far (120 samples at most)
  // the view from above: a high three-quarter view of the way from the ball to the pin
  above: Object.freeze({ perM: 0.5, plusM: 12, minM: 40, maxM: 110, backK: 0.42, backMaxK: 1.3, ballNdc: 0.85, farNdc: 0.72, maxNeedM: 190, clearM: 12 }),
});

/**
 * The least height a camera over (cx, cy) must have to see T {x, y, z}: the highest of what
 * each point of the ground under the sight line asks for. crownAt(x, y): the tops of trees
 * and buildings (-Infinity in the open), counted from crownFromM along the line (nearer
 * ones are faded out of the way instead). Returns { z, at }: at = the point that asks most.
 */
export function needHeight(cx, cy, T, groundAt, {
  crownAt = null, crownFromM = 0, margin = SEE_OVER.marginM, marginPerM = SEE_OVER.marginPerM,
  marginMax = SEE_OVER.marginMaxM, stepM = SEE_OVER.stepM,
} = {}) {
  const dx = T.x - cx, dy = T.y - cy, D = Math.hypot(dx, dy);
  if (!(D > 0.5)) return { z: -Infinity, at: null };
  const [m0, m1] = SEE_OVER.marginFromM;
  let z = -Infinity, at = null;
  // every 0.75 m over the first 40 m (the lip of a bunker is a metre or two across), then
  // opening out to stepM (3 m at most on a very long line)
  const far = Math.max(stepM, Math.min(3, D / 110));
  for (let s = 0.75, step = 0.75; s < D; s += step) {
    if (s > 40) step = Math.min(far, step * 1.08);
    const u = s / D;
    if (u > 0.985) break;
    const x = cx + dx * u, y = cy + dy * u;
    let top = groundAt(x, y);
    if (crownAt && u * D >= crownFromM) { const c = crownAt(x, y); if (c > top) top = c; }
    const m = margin + Math.min(marginMax, marginPerM * (1 - u) * D) * smooth(m0, m1, u * D);
    const need = (top + m - u * T.z) / (1 - u);
    if (need > z) { z = need; at = { x, y, z: top, u }; }
  }
  return { z, at };
}

/** Is `to` seen from `from` over the ground (both { x, y, z })? */
export function sightClear(from, to, groundAt, marginM = 0.3, stepM = 3) {
  const dx = to.x - from.x, dy = to.y - from.y, D = Math.hypot(dx, dy);
  const n = clamp(Math.ceil(D / stepM), 6, 96);
  for (let i = 1; i < n; i++) {
    const u = i / n;
    if (groundAt(from.x + dx * u, from.y + dy * u) + marginM > lerp(from.z, to.z, u)) return false;
  }
  return true;
}

/**
 * What stands on the course, for the camera: blockers [{ x, y, r, top, base, solid }] (top
 * and base: heights; solid: a building, not a tree). Returns
 *   soft(x, y): the height a sight line must clear there (the top inside r, falling to the
 *     foot over skirtM beyond it, so a line sweeping past a tree is lifted and let down
 *     smoothly); -Infinity in the open;
 *   core(x, y, z): the top of the crown or building the point is INSIDE, else -Infinity
 *     (a tree: within its trunk, or in the middle of its crown; never merely under it).
 */
export function crownField(blockers, { cellM = 16, skirtM = 5 } = {}) {
  const grid = new Map();
  const K = (i, j) => (i + 32768) * 65536 + (j + 32768);
  let maxR = 0, count = 0;
  for (const b of blockers || []) {
    if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y) || !(b.r > 0) || !Number.isFinite(b.top)) continue;
    const base = Number.isFinite(b.base) ? b.base : b.top;
    const o = { x: b.x, y: b.y, r: b.r, top: b.top, base: Math.min(base, b.top), solid: !!b.solid };
    maxR = Math.max(maxR, o.r + skirtM);
    const k = K(Math.floor(o.x / cellM), Math.floor(o.y / cellM));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(o);
    count++;
  }
  const reach = Math.ceil(maxR / cellM);
  const near = (x, y, fn) => {
    const ci = Math.floor(x / cellM), cj = Math.floor(y / cellM);
    for (let i = ci - reach; i <= ci + reach; i++) {
      for (let j = cj - reach; j <= cj + reach; j++) {
        const cell = grid.get(K(i, j));
        if (cell) for (const b of cell) fn(b, Math.hypot(b.x - x, b.y - y));
      }
    }
  };
  return {
    count,
    soft(x, y) {
      let top = -Infinity;
      if (count) near(x, y, (b, d) => {
        if (d >= b.r + skirtM) return;
        const h = d <= b.r ? b.top : lerp(b.top, b.base, (d - b.r) / skirtM);
        if (h > top) top = h;
      });
      return top;
    },
    core(x, y, z) {
      let top = -Infinity;
      if (count) near(x, y, (b, d) => {
        if (z >= b.top + (b.solid ? 0.5 : 0)) return;
        const inside = b.solid ? d < b.r + 0.5
          : d < 0.8 || (d < 0.6 * b.r && z > b.base + 0.3 * (b.top - b.base) - 1);
        if (inside && b.top > top) top = b.top;
      });
      return top;
    },
  };
}

// The pitch of the view (radians below the horizontal). The address framing as it is (the
// pin about 40% down the frame, the ball about three quarters), kept unless that would put
// the ball below ballNdc or the highest thing that must be seen above topNdc; the ball wins.
function framePitch({ toBall, toPin, toTop, tanHalf, ballNdc = SEE_OVER.ballNdc, topNdc = SEE_OVER.targetNdc }) {
  const lo = toBall - Math.atan(ballNdc * tanHalf);
  const hi = toTop + Math.atan(topNdc * tanHalf);
  let pitch = toPin + 0.285 * (toBall - toPin);
  if (pitch > hi) pitch = hi;
  if (pitch < lo) pitch = lo;
  return pitch;
}

const poseOut = (ball, ux, uy, e, pitch, zoom, extra) => ({
  d: e.d, z: e.z, lift: e.z - e.zDef, pitch, zoom,
  cam: { x: e.cx, y: e.cy, z: e.z },
  look: { x: e.cx + ux * 80, y: e.cy + uy * 80, z: e.z - Math.tan(pitch) * 80 },
  ...extra,
});

/**
 * Where the address camera stands.
 *   ball {x, y}; azDeg: the bearing it stands behind the ball along (the aim);
 *   targets [{ x, y, z?, air?, must? }]: what must be seen. A point on the ground has no z
 *     (its marker, half a metre up, is what is looked for); air: a point of the predicted
 *     flight (z given); must: false for one that is given up when it cannot be had (the pin);
 *   pin {x, y}: for the framing; groundAt(x, y); crowns: a crownField (or null);
 *   base { dist, height }: the plain address camera; zoom0: its lens (scene _addressZoom);
 *   ballNdc: the lowest the ball may sit in the frame (share of the half-height below the
 *     middle): the HUD's dock covers the bottom of the screen (ballNdcAbove).
 * Returns { visible, d, z, lift, pitch, zoom, cam, look, raised, sees, obstacle, woodedM }: d
 * metres behind the ball, z its height, lift how far above the plain camera; visible: false
 * when no pose within the caps sees the must-see targets over the ground (obstacle: the top
 * of what hides them); woodedM: how many metres of the line to the target still run under
 * trees (a wood too tall to see over from behind the ball).
 */
export function seeOverPose({
  ball, azDeg = 0, targets = [], pin = null, groundAt = () => 0, crowns = null,
  base = null, fovDeg = SEE_OVER.fovDeg, zoom0 = 1,
  maxUpM = SEE_OVER.maxUpM, maxBackM = SEE_OVER.maxBackM, ballNdc = SEE_OVER.ballNdc,
} = {}) {
  const S = SEE_OVER;
  const d0 = base && base.dist > 0 ? base.dist : S.backM;
  const up0 = base && base.height > 0 ? base.height : S.upM;
  const az = azDeg * D2R, ux = Math.sin(az), uy = Math.cos(az);
  const bz = groundAt(ball.x, ball.y);
  const ballT = { x: ball.x, y: ball.y, z: bz + 0.1 };
  const tanBase = Math.tan((fovDeg / 2) * D2R);
  const pts = targets.filter((t) => t && Number.isFinite(t.x) && Number.isFinite(t.y) && Math.hypot(t.x - ball.x, t.y - ball.y) > 1)
    .map((t) => ({ x: t.x, y: t.y, z: Number.isFinite(t.z) ? t.z : groundAt(t.x, t.y) + 0.5, air: !!t.air, must: t.must !== false }));
  const pinP = pin ? { x: pin.x, y: pin.y, z: groundAt(pin.x, pin.y) } : null;

  const evalAt = (d, tg, useCrowns = true) => {
    const cx = ball.x - ux * d, cy = ball.y - uy * d;
    const zDef = Math.max(groundAt(cx, cy) + S.clearM, bz + up0);
    let z = Math.max(zDef, needHeight(cx, cy, ballT, groundAt, { margin: S.ballMarginM, marginPerM: 0 }).z);
    let block = null;
    for (const t of tg) {
      const n = needHeight(cx, cy, t, groundAt, {
        crownAt: useCrowns && crowns && crowns.count ? crowns.soft : null, crownFromM: d + S.fadeAheadM,
        ...(t.air ? { marginPerM: 0 } : {}),
      });
      if (n.z > z) { z = n.z; block = n.at; }
    }
    z = zDef + Math.max(0, z - zDef - S.slackM);
    const zoom = lerp(zoom0, 1, smooth(0.5, 6, z - zDef));
    const tanHalf = tanBase / zoom;
    const toBall = Math.atan2(z - bz, d);
    let toTop = Infinity;
    for (const t of tg) if (!t.air) toTop = Math.min(toTop, Math.atan2(z - t.z, Math.hypot(t.x - cx, t.y - cy)));
    const toPin = pinP ? Math.atan2(z - pinP.z, d + Math.max(1, Math.hypot(pinP.x - ball.x, pinP.y - ball.y)))
      : Number.isFinite(toTop) ? toTop : 0;
    if (!Number.isFinite(toTop)) toTop = toPin;
    const fits = toBall - toTop <= Math.atan(ballNdc * tanHalf) + Math.atan(S.targetNdc * tanHalf) + 1e-9;
    return { d, cx, cy, z, zDef, block, zoom, tanHalf, toBall, toTop, toPin, ok: fits && z - bz <= maxUpM + 1e-6 };
  };
  const inTree = (e) => (crowns && crowns.count ? crowns.core(e.cx, e.cy, e.z) : -Infinity);

  // With the pin, then without it (it is given up before the aim target is). Over the GROUND
  // first: that is what must be cleared. Then, if a little more height (crownLiftM, and a
  // little more room) also looks over the trees and buildings past the faded stretch, that
  // pose instead: a hedge, a ruin, a low wood. A tall tree far down the line would ask for
  // three times that: it is left standing (the x-ray line and the beacon show through it),
  // and a wood too tall to look over is reported (woodedM) for the scene to fly up.
  const must = pts.filter((t) => t.must), all = pts;
  const hasCrowns = !!(crowns && crowns.count);
  const solve = (tg, useCrowns) => {
    let e = evalAt(d0, tg, useCrowns);
    if (!e.ok) {
      let lo = e; e = null;
      for (let d = d0 + S.backStepM; d <= maxBackM + 1e-6; d += S.backStepM) {
        const c = evalAt(Math.min(d, maxBackM), tg, useCrowns);
        if (c.ok) { e = c; break; }
        lo = c;
      }
      // the nearest that will do, to a few centimetres: the pose does not step with the aim
      for (let i = 0; e && i < 9; i++) {
        const mid = evalAt((lo.d + e.d) / 2, tg, useCrowns);
        if (mid.ok) e = mid; else lo = mid;
      }
    }
    return e;
  };
  let chosen = null, sees = null, overCrowns = false;
  for (const tg of all.length > must.length ? [all, must] : [must]) {
    const e = solve(tg, false);
    if (!e) continue;
    chosen = e; sees = tg;
    const c = hasCrowns ? solve(tg, true) : null;
    if (c && c.z - e.z <= S.crownLiftM && c.d - e.d <= S.crownBackM) { chosen = c; overCrowns = true; }
    break;
  }

  if (chosen) {
    // never inside a tree or a building: a step along the line out of it, else over its top
    if (inTree(chosen) > -Infinity) {
      let alt = null;
      for (let k = 1; k <= 6 && !alt; k++) {
        for (const d of [chosen.d + 1.5 * k, chosen.d - 1.5 * k]) {
          if (d < Math.max(6, d0 - 6) || d > Math.max(maxBackM, d0) + 4) continue;
          const c = evalAt(d, sees, overCrowns);
          if (c.ok && inTree(c) === -Infinity) { alt = c; break; }
        }
      }
      if (alt) chosen = alt;
      else {
        for (let i = 0; i < 4; i++) { const top = inTree(chosen); if (top === -Infinity) break; chosen = { ...chosen, z: top + 0.6 }; }
        chosen.toBall = Math.atan2(chosen.z - bz, chosen.d);
      }
    }
    const e = chosen;
    const pitch = framePitch({ toBall: e.toBall, toPin: e.toPin, toTop: e.toTop, tanHalf: e.tanHalf, ballNdc });
    // how much of the line to the target still runs under trees and buildings (past the ones
    // that are faded): a tree or two is looked past; a wood hides the target as a hill does
    let woodedM = 0;
    const primary = must.find((t) => !t.air) || must[0] || all[0];
    if (hasCrowns && !overCrowns && primary) {
      const dx = primary.x - e.cx, dy = primary.y - e.cy, D = Math.hypot(dx, dy), n = clamp(Math.ceil(D / S.stepM), 8, 160);
      for (let k = 1; k < n; k++) {
        const u = k / n;
        if (u * D < e.d + S.fadeAheadM) continue;
        if (crowns.soft(e.cx + dx * u, e.cy + dy * u) > lerp(e.z, primary.z, u)) woodedM += D / n;
      }
    }
    return poseOut(ball, ux, uy, e, pitch, e.zoom, {
      visible: true, raised: e.z - e.zDef > 0.05 || e.d - d0 > 0.05, woodedM,
      sees: { pin: sees.length === all.length }, obstacle: null,
    });
  }

  // Nothing within the caps sees the target. Stand back and as high as still keeps both the
  // ball and the top of what is in the way in the frame, and look at those.
  const dF = Math.min(Math.max(d0, 26), Math.max(maxBackM, d0));
  const cx = ball.x - ux * dF, cy = ball.y - uy * dF;
  const zDef = Math.max(groundAt(cx, cy) + S.clearM, bz + up0);
  const zLow = Math.max(zDef, needHeight(cx, cy, ballT, groundAt, { margin: S.ballMarginM, marginPerM: 0 }).z);
  const tanHalf = tanBase;
  const span = Math.atan(ballNdc * tanHalf) + Math.atan(S.obstacleNdc * tanHalf);
  const primary = must[0] || all[0] || null;
  let best = null;
  for (let i = 0; i <= 12; i++) {
    const z = lerp(Math.max(zLow, bz + maxUpM), zLow, i / 12);
    const block = primary ? needHeight(cx, cy, primary, groundAt).at : null;
    // the top of what hides it: the point of the ground that stands highest in the view
    let toObs = Infinity, obs = null;
    if (primary) {
      const dx = primary.x - cx, dy = primary.y - cy, D = Math.hypot(dx, dy), n = clamp(Math.ceil(D / S.stepM), 8, 120);
      for (let k = 1; k <= n; k++) {
        const u = k / n, x = cx + dx * u, y = cy + dy * u, g = groundAt(x, y);
        const a = Math.atan2(z - g, u * D);
        if (a < toObs) { toObs = a; obs = { x, y, z: g }; }
      }
    }
    const toBall = Math.atan2(z - bz, dF);
    const c = { d: dF, cx, cy, z, zDef, toBall, toObs: Number.isFinite(toObs) ? toObs : 0, obs: obs || block };
    best = c;
    if (toBall - c.toObs <= span) break;
  }
  const toPin = pinP ? Math.atan2(best.z - pinP.z, dF + Math.max(1, Math.hypot(pinP.x - ball.x, pinP.y - ball.y))) : best.toObs;
  const pitch = framePitch({ toBall: best.toBall, toPin, toTop: best.toObs, tanHalf, topNdc: S.obstacleNdc, ballNdc });
  return poseOut(ball, ux, uy, best, pitch, 1, {
    visible: false, raised: true, woodedM: 0, sees: { pin: false }, obstacle: best.obs,
  });
}

/**
 * The view from above: high behind the ball, looking down the way to the pin, the ball at
 * the bottom of the frame and the far end of the route near the top. The player's "let me
 * look" (one key), and where the camera goes by itself when no standing pose sees the
 * target. far [{x, y}]: the points the route runs to (the pin, the aim target).
 * Returns the same shape as seeOverPose, plus azDeg (the bearing it looks along).
 */
export function aboveView({
  ball, azDeg = 0, far = [], groundAt = () => 0, crowns = null, fovDeg = SEE_OVER.fovDeg, ballNdc = SEE_OVER.above.ballNdc,
} = {}) {
  const A = SEE_OVER.above;
  const bNdc = Math.min(A.ballNdc, ballNdc);
  const bz = groundAt(ball.x, ball.y);
  const pts = far.filter((t) => t && Number.isFinite(t.x) && Number.isFinite(t.y) && Math.hypot(t.x - ball.x, t.y - ball.y) > 3)
    .map((t) => ({ x: t.x, y: t.y, z: groundAt(t.x, t.y) + 0.5 }));
  // it looks along the middle of the route (the aim itself when there is nowhere to go)
  let az = azDeg * D2R;
  if (pts.length) {
    const mx = pts.reduce((s, t) => s + t.x, 0) / pts.length - ball.x, my = pts.reduce((s, t) => s + t.y, 0) / pts.length - ball.y;
    if (Math.hypot(mx, my) > 3) az = Math.atan2(mx, my);
  }
  const ux = Math.sin(az), uy = Math.cos(az);
  const L = Math.min(420, pts.reduce((m, t) => Math.max(m, Math.hypot(t.x - ball.x, t.y - ball.y)), 60));
  const H = clamp(A.perM * L + A.plusM, A.minM, A.maxM);
  const tanHalf = Math.tan((fovDeg / 2) * D2R);
  const span = Math.atan(bNdc * tanHalf) + Math.atan(A.farNdc * tanHalf);
  // further back while the ball and the far end do not both fit (a green high above the ball)
  let d, cx, cy, z, visible, obstacle, toBall, toFar;
  for (d = A.backK * H; ; d += 3) {
    cx = ball.x - ux * d; cy = ball.y - uy * d;
    z = Math.max(bz + H, groundAt(cx, cy) + A.clearM,
      needHeight(cx, cy, { x: ball.x, y: ball.y, z: bz + 0.1 }, groundAt, { margin: SEE_OVER.ballMarginM, marginPerM: 0 }).z);
    visible = true; obstacle = null;
    for (const t of pts) {
      const n = needHeight(cx, cy, t, groundAt);
      if (n.z > bz + A.maxNeedM) { visible = false; obstacle = n.at; continue; }
      if (n.z > z) z = n.z;
    }
    if (crowns && crowns.count) for (let i = 0; i < 4; i++) { const top = crowns.core(cx, cy, z); if (top === -Infinity) break; z = top + 2; }
    toBall = Math.atan2(z - bz, d);
    toFar = toBall;
    for (const t of pts) toFar = Math.min(toFar, Math.atan2(z - t.z, Math.hypot(t.x - cx, t.y - cy)));
    if (toBall - toFar <= span || d >= A.backMaxK * H) break;
  }
  const lo = toBall - Math.atan(bNdc * tanHalf), hi = toFar + Math.atan(A.farNdc * tanHalf);
  const pitch = lo > hi ? lo : (lo + hi) / 2;
  return poseOut(ball, ux, uy, { d, cx, cy, z, zDef: bz + SEE_OVER.upM }, pitch, 1, {
    visible, raised: true, above: true, azDeg: az / D2R, sees: { pin: visible }, obstacle,
  });
}

/**
 * The lowest the ball may sit in the frame so that it shows above what covers the bottom of
 * the screen (the arcade's ball dock): safeBottom = the share of the frame's height covered
 * (0..1), marginFrac = the gap kept above it. Returns the ballNdc for seeOverPose / aboveView.
 */
export function ballNdcAbove(safeBottom = 0, marginFrac = 0.035) {
  return clamp(1 - 2 * (clamp(safeBottom, 0, 0.6) + marginFrac), 0.15, SEE_OVER.ballNdc);
}

/**
 * Where a marker for something off the frame (or hidden) is pinned. ndc {x, y, depth}: the
 * point through the lens (depth <= 0: behind the camera); w, h: the frame in pixels; pad:
 * how far in from its edges { x, top, bottom }. Returns { x, y, edge }: edge = '' when the
 * point is inside the padded frame, else the side it is pinned to ('top' | 'bottom' |
 * 'left' | 'right').
 */
export function pinToFrame(ndc, w, h, pad = {}) {
  const px = pad.x ?? 90, pt = pad.top ?? 84, pb = pad.bottom ?? 120;
  let nx = ndc.x, ny = ndc.y;
  if (!(ndc.depth > 0)) { nx = -nx; ny = -Math.abs(ny) - 2; }   // behind the lens: off the bottom, on its own side
  const sx = (nx * 0.5 + 0.5) * w, sy = (-ny * 0.5 + 0.5) * h;
  const x = clamp(sx, px, Math.max(px, w - px)), y = clamp(sy, pt, Math.max(pt, h - pb));
  let edge = '';
  if (sy < pt) edge = 'top';
  else if (sy > h - pb) edge = 'bottom';
  if (sx < px) edge = edge || 'left';
  else if (sx > w - px) edge = edge || 'right';
  return { x, y, edge };
}

/** "PIN 142 YD · +50 M ↑": what the marker says. distM: along the ground; riseM: its height above the ball. */
export function markerText(name, distM, riseM) {
  const yd = Math.round(distM / 0.9144), r = Math.round(riseM);
  const rise = r === 0 ? 'LEVEL' : `${r > 0 ? '+' : '−'}${Math.abs(r)} M ${r > 0 ? '↑' : '↓'}`;
  return `${name} ${yd} YD · ${rise}`;
}

/**
 * Does something of radius r and height top (a tree, a building) at `along` metres down
 * the line from the camera and `lateral` metres off it stand in the way: between the camera
 * and the ball, or over the first fadeAheadM of the line past the ball? line: { d (camera
 * to ball, m), camZ, ballZ, endZ (the ground fadeAheadM past the ball) }.
 */
export function inTheWay(along, lateral, r, top, line, aheadM = SEE_OVER.fadeAheadM) {
  if (along < -r || along > line.d + aheadM + r) return false;
  if (Math.abs(lateral) > r + 1.2 + 0.03 * Math.max(0, along)) return false;
  const a = clamp(along, 0, line.d + aheadM);
  const sight = a <= line.d ? lerp(line.camZ, line.ballZ, a / Math.max(1e-6, line.d))
    : lerp(line.camZ, line.endZ, a / (line.d + aheadM));
  return top > sight - 0.5;
}
