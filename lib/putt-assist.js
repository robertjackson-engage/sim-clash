'use strict';
// Arcade putting (lib/arcade.js `assist.putting`). A launch monitor reads a putt
// poorly and a simulator mat reads it worse, so on the green the game does what
// arcade golf games do: it works out the putt that goes in, and the player's stroke only
// decides how close to that putt they came.
//
//   solvePutt  — the putt that finishes just past the cup: a bearing (the break read
//                for the player) and a pace, found by shooting the real roll physics.
//   assistPutt — the player's stroke judged against it. A DECENT stroke (its start line
//                and its pace both inside the level's window) is played as the putt that
//                goes in. A stroke outside the window is a miss, whatever it is: it is
//                pulled toward the cup, so it finishes close, but it is steered past the
//                edge and played at the real cup. The assist helps a decent putt; it does
//                not rescue a bad one (it used to: every putt from 18 to 40 ft dropped,
//                one started 14 degrees off line and one struck at 32 mph among them, so
//                a putt to win could not be missed).
//
// Levels: 'off' changes nothing (the real stroke at the real cup).
//   'assist'  start line within 2.5 degrees, pace from -15 % to +40 % of the right one
//   'easy'    start line within 4.5 degrees, pace from -20 % to +60 % (the arcade default
//             in solo play; a match plays 'assist' unless its lobby says otherwise)
// A putt struck at three times the right pace never drops, at any level.

const { simulateShot, MPH } = require('./physics');

//   lineDeg, paceLo, paceHi   the window: |start-line error| and pace / right pace
//   dir, pace                 inside it, what is left of the errors: dir x the line error,
//                             the pace ratio to the power `pace` (the solved putt, nearly)
//   cupRadiusScale, cupMaxSpeedScale   inside it, the cup that putt is played at
//   missDir, missPace         outside it, what is left of the errors BEYOND the window: the
//                             same way. Smaller: a miss finishes closer.
const LEVELS = Object.freeze({
  off: null,
  assist: Object.freeze({ lineDeg: 2.5, paceLo: 0.85, paceHi: 1.4, dir: 0.04, pace: 0.04, cupRadiusScale: 2, cupMaxSpeedScale: 1.5, missDir: 0.55, missPace: 0.6 }),
  easy: Object.freeze({ lineDeg: 4.5, paceLo: 0.8, paceHi: 1.6, dir: 0.04, pace: 0.04, cupRadiusScale: 2.2, cupMaxSpeedScale: 1.7, missDir: 0.3, missPace: 0.3 }),
});
const MISS_M = 0.28;          // a miss that reaches the cup passes at least this far beside it (the cup is
                              // 0.22 m: it burns the edge, which is a ROBBED! in lib/arcade.js) ...
const MISS_SHORT_M = 0.45;    // ... unless it stops at least this far short of it
const MISS_CUP = 0;           // ... and is played at no cup at all: a putt outside the window is a miss
const PAST_M = 0.35;          // the solved putt dies this far past the cup, so it arrives rolling
const MAX_PUTT_M = 45;        // farther than this from the cup it is not a putt to assist
const PACE_RATIO = Object.freeze([0.3, 3.5]);   // a stroke outside this is read as this
const TOL_M = 0.04;
const GREEN_ROLL = 0.6;       // m/s^2, the standard green's rolling resistance (a first guess only)

const bearingOf = (dx, dy) => Math.atan2(dx, dy) * 180 / Math.PI;
const wrap = (d) => ((d + 540) % 360) - 180;

/**
 * The putt that stops PAST_M beyond the cup.
 * ctx: { from:{x,y}, pin:{x,y}, surfaceAt, terrain, physics } (physics: the conditions'
 * options, as for any shot). Returns { bearingDeg, speedMph, distM, straightDeg, breakDeg,
 * missM, converged } or null when the ball is on the cup or too far away.
 */
function solvePutt({ from, pin, surfaceAt, terrain, physics = {} }) {
  const dx = pin.x - from.x, dy = pin.y - from.y;
  const distM = Math.hypot(dx, dy);
  if (!(distM > 0.05) || distM > MAX_PUTT_M) return null;
  const ux = dx / distM, uy = dy / distM;
  const target = { x: pin.x + ux * PAST_M, y: pin.y + uy * PAST_M };
  const want = distM + PAST_M;
  const straightDeg = bearingOf(dx, dy);
  const roll = (bearingDeg, speedMph) => simulateShot(
    { speedMph, vla: 0, hla: 0, totalSpin: 0, spinAxis: 0 }, from, bearingDeg, surfaceAt,
    { ...physics, terrain, putt: true, wind: null, trees: null },   // no pin: let it run out
  ).end;

  let bearing = straightDeg;
  let speed = Math.sqrt(2 * GREEN_ROLL * want) / MPH;
  let best = null;
  for (let i = 0; i < 14; i++) {
    const end = roll(bearing, speed);
    const ex = end.x - from.x, ey = end.y - from.y;
    const along = ex * ux + ey * uy;            // how far it went toward the target
    const right = ex * uy - ey * ux;            // + = finished right of the line
    const missM = Math.hypot(end.x - target.x, end.y - target.y);
    if (!best || missM < best.missM) best = { bearingDeg: bearing, speedMph: speed, missM };
    if (missM < TOL_M) break;
    // roll-out goes with speed squared; a damped step keeps it stable on a slope
    const ratio = Math.min(2, Math.max(0.5, want / Math.max(along, 0.05)));
    speed *= 1 + 0.85 * (Math.sqrt(ratio) - 1);
    bearing -= 0.85 * Math.atan2(right, Math.max(along, 0.3)) * 180 / Math.PI;
  }
  return {
    bearingDeg: best.bearingDeg, speedMph: best.speedMph, distM, straightDeg,
    breakDeg: wrap(best.bearingDeg - straightDeg),   // + = aim right of the cup
    missM: best.missM, converged: best.missM < 0.25,
  };
}

/**
 * The player's putt, assisted. ctx as solvePutt plus aimDeg (the bearing the game is
 * aiming along; launch.hla is measured from it). Returns
 *   { launch, physics, ideal, quality }   — play `launch` with `physics` spread into
 *                                           the shot's options; or
 *   null                                  — nothing to assist (level off, not a putt).
 * quality: { lineErrDeg, paceRatio, grade: 'pure'|'good'|'poor', made } is the player's own
 * stroke, before any help, for the HUD to praise or tease; made: it was inside the
 * level's window (the putt played is the one that goes in).
 * opts.tight (0..1, default 1): the window's line and its upper pace are this share of the
 * level's (a Tiny Cup trick asks for less: lib/game.js passes the root of its cup scale).
 */
function assistPutt(launch, ctx, level = 'easy', { tight = 1 } = {}) {
  const base = LEVELS[level];
  if (!base || !launch || !ctx || !ctx.pin || !ctx.from) return null;
  const t = Number.isFinite(tight) && tight > 0 && tight < 1 ? tight : 1;
  const k = t === 1 ? base : { ...base, lineDeg: base.lineDeg * t, paceHi: 1 + (base.paceHi - 1) * t };
  const ideal = solvePutt(ctx);
  if (!ideal || !ideal.converged) return null;
  const lineErrDeg = Number.isFinite(launch.hla) ? launch.hla : 0;
  const raw = launch.speedMph / ideal.speedMph;
  const paceRatio = Math.min(PACE_RATIO[1], Math.max(PACE_RATIO[0], raw));
  const absLine = Math.abs(lineErrDeg), side = lineErrDeg < 0 ? -1 : 1;
  const made = absLine <= k.lineDeg && raw >= k.paceLo && raw <= k.paceHi;
  let speedMph, bearing, physics;
  // The assist never takes a putt away: a stroke outside the window that drops on its own
  // (as struck, at the real cup: a short one a few degrees off still catches the edge) is
  // played as struck.
  if (!made && Number.isFinite(ctx.aimDeg)) {
    const own = simulateShot({ ...launch, vla: 0, spinAxis: 0 }, ctx.from, ctx.aimDeg, ctx.surfaceAt,
      { ...(ctx.physics || {}), terrain: ctx.terrain, pin: ctx.pin, putt: true, wind: null, trees: null });
    if (own.holed) {
      return {
        launch: { ...launch, vla: 0, spinAxis: 0 }, physics: { putt: true, cupRadiusScale: 1, cupMaxSpeedScale: 1 }, ideal,
        quality: { lineErrDeg: +lineErrDeg.toFixed(1), paceRatio: +raw.toFixed(2), grade: absLine <= 4 && raw >= 0.6 && raw <= 1.7 ? 'good' : 'poor', made: true },
      };
    }
  }
  if (made) {
    // a decent stroke: the putt that goes in, give or take a trace of its own errors
    speedMph = ideal.speedMph * Math.pow(paceRatio, k.pace);
    bearing = ideal.bearingDeg + k.dir * lineErrDeg;
    physics = { putt: true, cupRadiusScale: k.cupRadiusScale, cupMaxSpeedScale: k.cupMaxSpeedScale };
  } else {
    // a miss: what the stroke had beyond the window is kept (shrunk: it finishes close),
    // and a ball that still gets to the cup is steered past its edge. The real cup.
    const rr = paceRatio < k.paceLo ? Math.pow(paceRatio / k.paceLo, k.missPace)
      : paceRatio > k.paceHi ? Math.pow(paceRatio / k.paceHi, k.missPace) : 1;
    let off = k.missDir * Math.max(0, absLine - k.lineDeg);
    const stopM = (ideal.distM + PAST_M) * rr * rr;          // roll-out goes with speed squared
    if (stopM > ideal.distM - MISS_SHORT_M) off = Math.max(off, Math.atan2(MISS_M, ideal.distM) * 180 / Math.PI);
    speedMph = ideal.speedMph * rr;
    // which side it misses on: the side the stroke erred to, unless the ball would then roll
    // over the cup all the same (on a slope a putt hit too hard breaks less): then the other
    const over = (sgn) => simulateShot(
      { speedMph, vla: 0, hla: 0, totalSpin: 0, spinAxis: 0 }, ctx.from, ideal.bearingDeg + sgn * off, ctx.surfaceAt,
      { ...(ctx.physics || {}), terrain: ctx.terrain, pin: ctx.pin, putt: true, wind: null, trees: null, cupRadiusScale: 1.15, cupMaxSpeedScale: 4 },
    ).holed;
    const sgn = off > 0 && over(side) && !over(-side) ? -side : side;
    bearing = ideal.bearingDeg + sgn * off;
    physics = { putt: true, cupRadiusScale: MISS_CUP, cupMaxSpeedScale: 1 };
  }
  const grade = absLine <= 1.5 && raw >= 0.8 && raw <= 1.3 ? 'pure'
    : absLine <= 4 && raw >= 0.6 && raw <= 1.7 ? 'good' : 'poor';
  return {
    launch: { ...launch, speedMph, vla: 0, hla: wrap(bearing - ctx.aimDeg), spinAxis: 0 },
    physics,
    ideal,
    quality: { lineErrDeg: +lineErrDeg.toFixed(1), paceRatio: +raw.toFixed(2), grade, made },
  };
}

module.exports = { solvePutt, assistPutt, PUTT_ASSIST_LEVELS: LEVELS, MAX_PUTT_M };
