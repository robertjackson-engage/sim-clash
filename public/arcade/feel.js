// Arcade game feel: how a real swing becomes a video-game shot on screen.
//
// The server sends the whole shot at impact: every point of the path with its time,
// and where it ends. The scene then plays that path back in real time. This module
// re-times it first, so the playback has drama without touching the physics:
//
//   hit-stop    the ball leaves the face slowly for an instant, then snaps to speed
//   by the pin  time slows ONLY while a ball that is down comes close to the cup:
//               rolling past its edge ('lip'), or closing on the cup it is about to
//               drop into ('holing': from when it comes within a few metres, deeper
//               over the last metre, through the drop and a short hold on the cup)
//   the drop    a holed ball is not left sitting on the pin: it runs on to the cup,
//               tips over the edge and falls out of sight (cupDrop), and the time it
//               goes in is published (sim.cupDropT) so the sound and the crowd land on it
//
// The landing itself is never slowed. The pitch, the bounce and the check play at full
// speed, and the camera stays behind the ball through them (the arcade landing in
// render/flight-camera.js, switched on by arcadeShot below).
//
// The dull parts (the middle of a long flight, a long run-out) play fast, so no shot
// takes more than MAX_PLAY_S on screen. Nothing here changes where the ball goes: only
// the `t` of each point, the flight time and the timed events are rewritten.
//
// Pure functions, no DOM: test/arcade-feel.test.mjs runs them under node.
import { setFollowLanding } from '../render/flight-camera.js';

export const MAX_PLAY_S = 13.5;      // scene.js fast-forwards anything over 14 s: stay under it
export const MAX_SKIP_RATE = 3;      // the dull parts never play faster than this
const RAMP_S = 0.18;                 // into and out of a slow-motion window, in shot time
// how close a moving ball must come to the cup, once it is down, for time to slow
export const BY_THE_PIN_M = Object.freeze({ shot: 1.1, putt: 0.45 });
// the landing is kept clear of slow motion: nothing starts before this long after first
// contact, so the pitch and the first bounce are always at full speed
export const LANDING_CLEAR_S = 0.9;
// ...and a putt gets away at full speed too: nothing in its first moments
export const PUTT_CLEAR_S = 0.35;

const RATE = Object.freeze({ strike: 0.35, lip: 0.33, puttLip: 0.5 });
// A ball that goes in. Time slows as it closes on the cup: from when it comes (and stays)
// within closeM of it, though never for more than the last closeS of its roll, and deeper
// from deepM out (the last deepS at most); the deep rate carries the drop and the hold.
export const HOLING = Object.freeze({
  shot: Object.freeze({ closeM: 3, closeS: 1.8, rate: 0.5, deepM: 1, deepS: 0.8, deepRate: 0.3 }),
  putt: Object.freeze({ closeM: 2.2, closeS: 1.5, rate: 0.55, deepM: 0.9, deepS: 0.8, deepRate: 0.38 }),
});
// The drop itself (cupDrop): how the ball goes into the hole, and how long the picture
// then holds on the cup before the shot is over (and the celebration starts).
export const CUP = Object.freeze({
  holdS: 0.8,        // on the cup after the ball has gone, in playback time
  rimM: 0.1,         // the ball tips in once its middle is this close to the cup's (the hole as drawn)
  depthM: 0.2,       // how far it falls: just out of sight below the lip (the ball is drawn 17 cm across)
  gatherMps: Object.freeze([0.7, 2.5]),   // the pace it runs the last of the way to the cup at
  gatherMaxS: 1.0,   // ...and the longest that takes (a Magnet ball is caught metres out)
  rattleMps: 1.6,    // a ball arriving faster than this hits the back of the cup and hops before it drops
  directRate: 0.3,   // a ball that flies or pitches straight in: the rate of the drop itself
});

const dist = (p, pin) => Math.hypot(p.x - pin.x, p.y - pin.y);

/**
 * The slow-motion windows of a shot, in shot time.
 * sim: the server's { points:[{t,x,y,z}], flightTime, isPutt, events }.
 * ctx: { pin:{x,y}|[x,y]|null, holed, speedMph, powerup }.
 * Returns [{ t0, t1, rate, reason }] sorted by t0 (they may overlap; the slowest wins).
 */
export function slowmoWindows(sim, ctx = {}) {
  const pts = sim?.points || [];
  if (pts.length < 3) return [];
  const end = pts[pts.length - 1].t;
  const ft = Number.isFinite(sim.flightTime) ? sim.flightTime : end;
  const isPutt = !!sim.isPutt;
  const pin = Array.isArray(ctx.pin) ? { x: ctx.pin[0], y: ctx.pin[1] } : ctx.pin || null;
  const holed = ctx.holed ?? (sim.events || []).some((e) => e.type === 'holed');
  const out = [];
  const add = (t0, t1, rate, reason) => {
    t0 = Math.max(0, t0); t1 = Math.min(end, t1);
    if (t1 - t0 > 0.05) out.push({ t0, t1, rate, reason });
  };
  // a full shot's slow motion never reaches back into its landing
  const afterLanding = isPutt ? Math.min(PUTT_CLEAR_S, end / 3) : ft + LANDING_CLEAR_S;

  if (!isPutt) {
    // the hit-stop: a quarter of a second on screen, the same for a Rocket as for any hard
    // strike. (A Rocket used to launch in a second and a half of 20% slow motion under a
    // SLOW-MO tag: the house rule is slow motion only by the pin.)
    if (ctx.powerup === 'rocket' || (ctx.speedMph ?? 0) >= 95) add(0, 0.08, RATE.strike, 'strike');
  }
  if (pin) {
    if (holed) {
      // closing on the cup: from when the ball comes within closeM of it for good, deeper
      // from deepM. Never before the landing is clear: a ball that flies or pitches
      // straight in has no roll to slow (warpShot slows the drop itself, nothing before it)
      const H = isPutt ? HOLING.putt : HOLING.shot;
      const inside = (m) => {   // the time from which the ball stays within m of the cup
        let t = end;
        for (let i = pts.length - 2; i >= 0 && dist(pts[i], pin) < m; i--) t = pts[i].t;
        return t;
      };
      const t0 = Math.max(inside(H.closeM), end - H.closeS, afterLanding);
      const d0 = Math.max(inside(H.deepM), end - H.deepS, t0);
      if (end - t0 > 0.05) out.push({ t0, t1: end, rate: H.rate, reason: 'holing', deep: { t0: d0, rate: H.deepRate } });
    } else {
      // the closest the moving ball comes to the cup once it is down and past its landing
      let best = null;
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i];
        if (p.t < afterLanding) continue;
        const q = pts[i - 1], dt = p.t - q.t;
        const v = dt > 0 ? Math.hypot(p.x - q.x, p.y - q.y) / dt : 0;
        if (v < 0.25) continue;
        const d = dist(p, pin);
        if (!best || d < best.d) best = { d, t: p.t };
      }
      if (best && best.d < (isPutt ? BY_THE_PIN_M.putt : BY_THE_PIN_M.shot)) {
        add(Math.max(best.t - 0.7, afterLanding), best.t + 0.45, isPutt ? RATE.puttLip : RATE.lip, 'lip');
      }
    }
  }
  return out.sort((a, b) => a.t0 - b.t0);
}

// playback rate at shot time t: 1 outside every window, the slowest window inside,
// eased over RAMP_S at each edge so the change of pace is felt, not seen as a cut
function rateAt(t, windows) {
  let r = 1;
  const one = (t0, t1, rate) => {
    if (t <= t0 - RAMP_S || t >= t1 + RAMP_S) return;
    const k = t < t0 ? (t - (t0 - RAMP_S)) / RAMP_S : t > t1 ? ((t1 + RAMP_S) - t) / RAMP_S : 1;
    const e = k * k * (3 - 2 * k);
    r = Math.min(r, 1 + (rate - 1) * e);
  };
  for (const w of windows) {
    one(w.t0, w.t1, w.rate);
    if (w.deep) one(w.deep.t0, w.t1, w.deep.rate);   // a window that deepens toward its end
  }
  return r;
}

const G = 9.81;
/**
 * How a holed ball goes into the cup. The server's path ends with the ball put on the pin
 * the instant the cup takes it (up to a cup's radius away, metres for a Magnet ball), so
 * played as it comes the ball jumps to the flag and sits on the green. This is the last
 * of its roll instead: from where it was taken (`from`, moving at `vel` m/s) it runs on,
 * curling in to the cup, tips over the edge and falls out of sight; a ball arriving fast
 * hits the back of the cup and hops first.
 * Returns { points:[{ t, x, y, z }], tTip, tDrop } with t in shot seconds from the moment
 * the cup takes it, z relative to the green at the cup (0 on it, negative in the hole):
 * tTip is when it starts to fall, tDrop when it is down and out of sight (the last point).
 */
export function cupDrop(from, vel, pin, { step = 1 / 400 } = {}) {
  const dx = pin.x - from.x, dy = pin.y - from.y, D = Math.hypot(dx, dy);
  const s = Math.hypot(vel.x, vel.y);
  // the way it is going (toward the cup when it is hardly moving)
  const d = s > 0.05 ? { x: vel.x / s, y: vel.y / s } : D > 1e-6 ? { x: dx / D, y: dy / D } : { x: 0, y: 1 };
  const pace = Math.min(Math.max(s, CUP.gatherMps[0]), CUP.gatherMps[1]);
  const T1 = D > 0.01 ? Math.min(CUP.gatherMaxS, Math.max(0.06, D / pace)) : 0;
  const rattle = s >= CUP.rattleMps;
  const hopS = rattle ? 0.16 : 0, hopM = rattle ? Math.min(0.09, 0.03 * s) : 0;
  // the run in: a curve that leaves along the ball's own line and ends on the cup
  const toward = D > 1e-6 ? (d.x * dx + d.y * dy) / D : 1;
  const c = toward > -0.2 ? { x: from.x + d.x * D * 0.45, y: from.y + d.y * D * 0.45 } : { x: from.x + dx / 2, y: from.y + dy / 2 };
  const run = (u) => {
    const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), e = u * u;
    return { x: a * from.x + b * c.x + e * pin.x, y: a * from.y + b * c.y + e * pin.y };
  };
  const points = [];
  let tTip = null, t = 0;
  for (;;) {
    const p = T1 > 0 ? run(Math.min(1, t / T1)) : { x: pin.x, y: pin.y };
    if (tTip === null && (t >= T1 || Math.hypot(p.x - pin.x, p.y - pin.y) < CUP.rimM)) tTip = t;
    let z = 0;
    if (tTip !== null) {
      const tf = t - tTip;
      if (tf < hopS) {
        // off the back of the cup: up and on a touch, then back over the hole
        const h = Math.sin(Math.PI * tf / hopS);
        z = hopM * h;
        p.x += d.x * 0.07 * h; p.y += d.y * 0.07 * h;
      } else z = -0.5 * G * (tf - hopS) * (tf - hopS);
    }
    if (z <= -CUP.depthM) { points.push({ t, x: pin.x, y: pin.y, z: -CUP.depthM }); break; }
    points.push({ t, x: p.x, y: p.y, z });
    t += step;
  }
  return { points, tTip: tTip ?? 0, tDrop: t };
}

/**
 * Re-time a shot. Returns a NEW sim (the input is not touched) whose points, flightTime
 * and timed events are in playback time, plus:
 *   slowmo: [{ t0, t1, rate, reason }] in playback time (for the HUD and the audio)
 *   playS:  how long the shot plays for
 *   toPlayTime(t): shot time -> playback time
 * With no windows and a shot under MAX_PLAY_S, the times come back unchanged.
 *
 * A holed ball (with the pin known) also gets its drop: the last sample, the ball put on
 * the pin, is replaced by cupDrop's run in and fall, then CUP.holdS on the cup; the
 * 'holing' window runs on through both. For that shot the sim also carries
 *   cupDropT: playback seconds from impact at which the ball is down in the cup
 *   cup: { x, y, z, t0, tTip, tDrop, tEnd }   the cup, and the drop's times: taken by the
 *        cup, starting to fall, down and out of sight (= cupDropT), end of the hold
 * and its events gain { type: 'cup-drop', t: cupDropT, ...cup }; the server's 'holed'
 * event is given t = cupDropT, so everything keyed to it lands on the drop.
 */
export function warpShot(sim, ctx = {}) {
  const src = sim?.points || [];
  if (src.length < 2) return { ...sim, slowmo: [], playS: src.length ? src[src.length - 1].t : 0, toPlayTime: (t) => t };
  const windows = ctx.windows || slowmoWindows(sim, ctx);
  const pin = Array.isArray(ctx.pin) ? { x: ctx.pin[0], y: ctx.pin[1] } : ctx.pin || null;
  const holedEv = (sim.events || []).find((e) => e.type === 'holed') || null;
  // a holed ball: its last sample (the ball put on the pin) gives way to the drop
  let pts = src, drop = null;
  if ((ctx.holed ?? !!holedEv) && pin && src.length >= 4 && ctx.drop !== false) {
    const m = src.length, last = src[m - 1];
    const from = holedEv && Number.isFinite(holedEv.x) && Number.isFinite(holedEv.y)
      ? { x: holedEv.x, y: holedEv.y } : { x: src[m - 2].x, y: src[m - 2].y };
    const a = src[Math.max(0, m - 5)], b = src[m - 2], dtv = b.t - a.t;   // its pace as the cup took it
    const vel = dtv > 1e-6 ? { x: (b.x - a.x) / dtv, y: (b.y - a.y) / dtv } : { x: 0, y: 0 };
    drop = cupDrop(from, vel, pin);
    pts = src.slice(0, m - 1).concat([{ ...last, x: from.x, y: from.y }]);
  }
  const hw = drop ? windows.find((w) => w.reason === 'holing') || null : null;
  const dropRate = hw ? hw.deep?.rate ?? hw.rate : CUP.directRate;
  const tailS = drop ? drop.tDrop / dropRate + CUP.holdS : 0;
  const maxS = MAX_PLAY_S - tailS;
  const n = pts.length;
  const ft = Number.isFinite(sim.flightTime) ? sim.flightTime : pts[n - 1].t;
  // per segment: its shot-time length, its rate (1 = full speed, < 1 = slow motion), and
  // whether it may be fast-forwarded. The last second of the flight and the two seconds
  // after touchdown never are: the landing always plays at exactly full speed.
  const seg = new Array(n - 1);
  let slowS = 0, keepS = 0, dullS = 0;
  for (let i = 0; i < n - 1; i++) {
    const dt = pts[i + 1].t - pts[i].t, mid = (pts[i].t + pts[i + 1].t) / 2;
    const rate = rateAt(mid, windows);
    const keep = !sim.isPutt && mid > ft - 1 && mid < ft + 2;
    seg[i] = { dt, rate, keep };
    if (rate < 0.999) slowS += dt / rate; else if (keep) keepS += dt; else dullS += dt;
  }
  // fast-forward the dull parts so the whole shot fits; then, if it still does not,
  // squeeze everything
  let skip = 1;
  const fixedS = slowS + keepS;
  if (fixedS + dullS > maxS) skip = Math.min(MAX_SKIP_RATE, dullS / Math.max(0.5, maxS - fixedS));
  const total = fixedS + dullS / skip;
  const squeeze = total > maxS ? total / maxS : 1;

  const tOld = pts.map((p) => p.t);
  const tNew = new Array(n);
  tNew[0] = 0;
  for (let i = 0; i < n - 1; i++) {
    const s = seg[i];
    tNew[i + 1] = tNew[i] + (s.rate < 0.999 ? s.dt / s.rate : s.keep ? s.dt : s.dt / skip) / squeeze;
  }
  const toPlayTime = (t) => {
    if (!(t > tOld[0])) return tNew[0];
    if (t >= tOld[n - 1]) return tNew[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tOld[m] <= t) lo = m; else hi = m; }
    const span = tOld[hi] - tOld[lo];
    return span > 0 ? tNew[lo] + (tNew[hi] - tNew[lo]) * (t - tOld[lo]) / span : tNew[lo];
  };
  const unchanged = skip === 1 && squeeze === 1 && !windows.length && !drop;
  const points = unchanged ? pts : pts.map((p, i) => ({ ...p, t: tNew[i] }));
  let playS = tNew[n - 1], cup = null;
  if (drop) {
    // the drop, in playback time, from the moment the cup takes the ball
    const t0 = playS, z0 = pts[n - 1].z;
    for (const q of drop.points) {
      if (q.t <= 0) continue;
      points.push({ t: t0 + q.t / dropRate, x: q.x, y: q.y, z: z0 + q.z });
    }
    const tDrop = t0 + drop.tDrop / dropRate;
    playS = tDrop + CUP.holdS;
    points.push({ ...points[points.length - 1], t: playS });   // the hold: the cup, the ball gone
    cup = { x: pin.x, y: pin.y, z: z0, t0, tTip: t0 + drop.tTip / dropRate, tDrop, tEnd: playS };
  }
  const slowmo = windows.map((w) => ({
    t0: toPlayTime(w.t0), t1: drop && w === hw ? playS : toPlayTime(w.t1), rate: w.rate, reason: w.reason,
    ...(w.deep ? { deep: { t0: toPlayTime(w.deep.t0), rate: w.deep.rate } } : {}),
  }));
  // a ball that flew or pitched straight in: only the drop itself is slowed
  if (drop && !hw) slowmo.push({ t0: cup.t0, t1: playS, rate: dropRate, reason: 'holing' });
  const events = (sim.events || []).map((e) => (
    cup && e.type === 'holed' ? { ...e, t: cup.tDrop }
      : Number.isFinite(e.t) ? { ...e, t: toPlayTime(e.t) } : e));
  if (cup) events.push({ type: 'cup-drop', t: cup.tDrop, ...cup });
  return {
    ...sim,
    points,
    flightTime: Number.isFinite(sim.flightTime) ? toPlayTime(sim.flightTime) : sim.flightTime,
    events,
    slowmo,
    playS,
    skipRate: skip * squeeze,
    toPlayTime,
    ...(cup ? { cup, cupDropT: cup.tDrop } : {}),
  };
}

// Grades that earn the rocket trail: a flame on the ball, hotter for a better shot
// (the scene draws it; app.js passes it to scene.playShot).
const TRAILS = Object.freeze({
  JACKPOT: Object.freeze({ kind: 'rocket', color: 0xffd21f, heat: 1 }),
  PERFECT: Object.freeze({ kind: 'rocket', color: 0xff8a1f, heat: 0.85 }),
  GREAT: Object.freeze({ kind: 'rocket', color: 0xff5a2a, heat: 0.6 }),
});
const POWERUP_TRAILS = Object.freeze({
  rocket: Object.freeze({ kind: 'rocket', color: 0x4fd8ff, heat: 1 }),
  laser: Object.freeze({ kind: 'rocket', color: 0xff3b6b, heat: 0.7 }),
  magnet: Object.freeze({ kind: 'rocket', color: 0xc77dff, heat: 0.6 }),
  moonball: Object.freeze({ kind: 'rocket', color: 0xe8ecff, heat: 0.6 }),
});
/** The trail a shot flies with: { kind, color, heat } or null for a plain ball. Putts never have one. */
export function shotTrail(shot) {
  if (!shot || shot.sim?.isPutt) return null;
  const a = shot.arcade || null;
  return (a && POWERUP_TRAILS[a.powerup]) || (a && TRAILS[a.grade]) || null;
}

/** A shot, ready to play: the server's `shot` with its sim re-timed. state: the game state (for the pin). */
export function arcadeShot(shot, state, { powerup = null, enabled = true } = {}) {
  setFollowLanding(!!enabled);   // the camera that stays behind the ball through its landing
  if (!enabled || !shot?.sim) return shot;
  const sim = warpShot(shot.sim, {
    pin: state?.pin || null,   // holed: read from the path's own 'holed' event (a conceded tap-in never drops)
    speedMph: shot.launch?.speedMph, powerup,
  });
  return { ...shot, sim, simRaw: shot.sim, trail: shotTrail(shot) };
}
