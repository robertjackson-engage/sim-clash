'use strict';
// Golf ball flight + ground physics over real terrain.
// Coordinates: x = east (m), y = north (m), z = up (m, same datum as the
// course elevation grid). Launch data follows GSPro Open Connect conventions:
//   speed (mph), VLA deg (up), HLA deg (+ = right of aim), totalSpin rpm,
//   spinAxis deg (- = draw / curves left for RH).

const { treeContacts, shotSeed } = require('./tree-obstacles');

const MPH = 0.44704;           // mph -> m/s
const YD = 0.9144;             // yards -> m
const M = 0.04593;             // ball mass kg
const R = 0.02135;             // ball radius m
const AREA = Math.PI * R * R;
const RHO = 1.225;             // air density kg/m^3
const G = 9.81;
const ROLL_INERTIA = 5 / 7;    // rolling sphere: effective slope acceleration factor
const V_STOP = 0.05;           // m/s — candidate rest speed
const CUP_RADIUS = 0.22;       // m — generous cup capture for sim play
const CUP_MAX_SPEED = 3.0;     // m/s — faster than this lips out

// Air phase: the same flight model as OpenFlight (src/openflight/ballistics.py),
// the launch monitor that feeds us shots, so the carry it shows is where the
// ball lands here. Same constants, coefficients, spin decay and RK4 at 500 Hz;
// test/flight-model.test.js pins the two together.
//
// Cd = CD_POLY[0] + CD_POLY[1]*Sp + CD_POLY[2]*Sp^2
// Cl = CL_POLY[0] + CL_POLY[1]*Sp + CL_POLY[2]*Sp^2, clamped at >= 0
//   Second-order polynomials in the spin parameter Sp = r*omega/v, the form
//   Ferguson, McNally & McPhee (2022, ISEA 14, doi:10.5703/1288284317493)
//   fitted to N=1040 shots (GCQuad launch conditions, FlightScope X3
//   carry/apex/offline, Pro V1, Sp 0.02-0.75). The coefficients are their
//   published values, not re-fitted. Lift peaks near Sp ~ 0.52 and turns over,
//   as in Bearman & Harvey (1976) and Lyu, Kensrud & Smith (2018). Beyond
//   Sp = SP_FIT_MAX both curves are held at their end value rather than
//   extrapolating a parabola into a region the fit never saw.
//   OpenFlight validated this against TrackMan captures (measured launch in,
//   simulated flight out): carry RMSE ~2-3 yd, apex RMSE ~1 yd.
const CD_POLY = [0.1304, 0.9287, -0.8259];
const CL_POLY = [0.0504, 1.2031, -1.1490];
const SP_FIT_MAX = 0.75;
// Exponential spin decay: omega(t) = omega0 * exp(-rate * t).
// ~4%/s per Kiratidis & Leinweber (2018).
const SPIN_DECAY_RATE = 0.04;  // 1/s

function poly(c, sp) {
  return c[0] + c[1] * sp + c[2] * sp * sp;
}
function dragCoeff(S) {
  return poly(CD_POLY, Math.min(S, SP_FIT_MAX));
}
function liftCoeff(S) {
  if (S <= 0) return 0;
  return Math.max(0, poly(CL_POLY, Math.min(S, SP_FIT_MAX)));
}

// Air acceleration (drag + Magnus + gravity) at ball velocity (vx, vy, vz),
// relative to the wind, with spin rate omega (rad/s) about the launch-fixed
// unit axis. kqD / kqL = 0.5 * air density * AREA (the shot's air) for drag and
// lift: the same number unless an arcade ball scales one of them (dragScale,
// liftScale); g is gravity (G, unless an arcade ball floats: gravityScale). Writes into
// `out` to keep the RK4 loop allocation-free.
function airAccel(vx, vy, vz, wind, omega, axis, kqD, kqL, g, out) {
  const rvx = vx - wind.x, rvy = vy - wind.y, rvz = vz - wind.z;
  const v = Math.hypot(rvx, rvy, rvz) || 1e-6;
  const S = omega * R / v;
  const qd = kqD * v * v, q = kqL * v * v;
  const cd = dragCoeff(S), cl = liftCoeff(S);

  out.x = -qd * cd * (rvx / v) / M;
  out.y = -qd * cd * (rvy / v) / M;
  out.z = -qd * cd * (rvz / v) / M - g;

  const mx = axis.y * rvz - axis.z * rvy;
  const my = axis.z * rvx - axis.x * rvz;
  const mz = axis.x * rvy - axis.y * rvx;
  const mlen = Math.hypot(mx, my, mz);
  if (mlen > 1e-9) {
    out.x += q * cl * (mx / mlen) / M;
    out.y += q * cl * (my / mlen) / M;
    out.z += q * cl * (mz / mlen) / M;
  }
  return out;
}

const SURFACES = {
  green:   { e: 0.30, keep: 0.35, roll: 0.6,  spinBite: 1.0 },
  tee:     { e: 0.40, keep: 0.55, roll: 2.0,  spinBite: 0.5 },
  fairway: { e: 0.40, keep: 0.55, roll: 2.0,  spinBite: 0.6 },
  rough:   { e: 0.28, keep: 0.30, roll: 4.5,  spinBite: 0.2 },
  bunker:  { e: 0.10, keep: 0.12, roll: 9.0,  spinBite: 0.0 },
  water:   { e: 0,    keep: 0,    roll: 99,   spinBite: 0 },
  ob:      { e: 0.28, keep: 0.30, roll: 4.5,  spinBite: 0.2 },
};

const FLAT = { flat: true, h: () => 0, grad: () => ({ dx: 0, dy: 0 }) };

// Ground conditions (lib/conditions.js): firmness 0 (soft) .. 0.5 (normal) .. 1 (firm,
// links) and the green's Stimpmeter reading. 0.5 and 10.5 are the SURFACES table
// exactly, so a shot in standard conditions is the same shot to the last bit.
//   firmness: k = 2 * firmness - 1 in [-1, 1], scaling every surface but water by
//   (1 + c * k) with c from FIRM when firmer than normal, from SOFT when softer:
//     e        restitution: firm ground kicks the ball up, soft ground plugs it;
//     keep     tangential speed kept at a bounce: firm ground lets the ball release;
//     bite     spin bite (soft ground grabs a spinning ball, firm ground lets it skid);
//     roll     rolling resistance off the green (the green's is the Stimpmeter's);
//     zip      a high-spin ball zipping back on a green: -8 % of its speed when normal,
//              -20 % on a soft green, a dead check (+2 %) on a firm one.
//   Soft costs more than firm gains, as on a real course. A standard driver
//   (CLUB_FULL.DR) on a flat fairway rolls 21.5 yd at 0.5, 28.4 yd (+32 %) at 1 and
//   12.8 yd (-41 %) at 0; a 7-iron +39 % / -46 %; a pitching wedge +45 % / -49 %.
//   Stimpmeter: a ball rolled off the stimp ramp at ~1.83 m/s goes S feet on a flat
//   green, so the green's rolling deceleration is v^2 / 2S: proportional to 1/S. 0.6
//   m/s^2 is a 10.5 green; a 13 rolls putts 24 % farther, a 9 14 % shorter.
const FIRMNESS_STD = 0.5;
const STIMP_STD = 10.5;
const ZIP_STD = -0.08;
const FIRM = Object.freeze({ e: 0.15, keep: 0.08, bite: 0.15, roll: 0.22, zip: 0.10 });
const SOFT = Object.freeze({ e: 0.30, keep: 0.10, bite: 0.20, roll: 0.30, zip: 0.12 });
const GROUND_STD = Object.freeze({ s: SURFACES, zip: ZIP_STD });
const groundCache = new Map();

function groundModel(firmness, greenStimp) {
  const f = Number.isFinite(firmness) ? Math.min(1, Math.max(0, firmness)) : FIRMNESS_STD;
  const st = Number.isFinite(greenStimp) && greenStimp > 0 ? greenStimp : STIMP_STD;
  if (f === FIRMNESS_STD && st === STIMP_STD) return GROUND_STD;
  const key = `${f}|${st}`;
  let ground = groundCache.get(key);
  if (ground) return ground;
  const k = 2 * f - 1;
  const c = k > 0 ? FIRM : SOFT;
  const s = {};
  for (const [name, sp] of Object.entries(SURFACES)) {
    s[name] = name === 'water' ? sp : Object.freeze({
      e: sp.e * (1 + c.e * k),
      keep: sp.keep * (1 + c.keep * k),
      roll: name === 'green' ? sp.roll * (STIMP_STD / st) : sp.roll * (1 - c.roll * k),
      spinBite: sp.spinBite * (1 - c.bite * k),
    });
  }
  ground = Object.freeze({ s: Object.freeze(s), zip: ZIP_STD + c.zip * k });
  if (groundCache.size >= 64) groundCache.clear();
  groundCache.set(key, ground);
  return ground;
}

// A shot's gust: a fraction in [0, 1) hashed from the shot's own seed (lowbias32 over
// shotSeed), so the same swing always meets the same gust and tests stay deterministic.
const GUST_SALT = 0x9e3779b9;
function gustFraction(seed) {
  let h = (seed ^ GUST_SALT) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Simulate one shot.
 * @param {object} launch {speedMph, vla, hla, totalSpin, spinAxis}
 * @param {object} start  {x, y} starting position (z from terrain)
 * @param {number} aimDeg compass heading of aim line, deg clockwise from north
 * @param {function} surfaceAt (x, y) => 'green'|'fairway'|...
 * @param {object} opts {terrain, pin: {x,y}, putt,
 *   wind: {speedMps, fromDeg (compass, where it blows FROM), gustMps}: gustMps > 0 adds
 *     a gust in [-gustMps, +gustMps] to the wind speed, seeded by the shot,
 *   airDensity: kg/m^3 (default 1.225) — scales drag and lift,
 *   firmness: 0 soft .. 0.5 normal .. 1 firm, greenStimp: green speed (feet, 10.5),
 *   carryOnly: stop at the first landing (end = where it lands),
 *   trees: the course's tree obstacles (lib/tree-obstacles.js), or null for none,
 *   arcade scales (lib/arcade.js power-up balls; each defaults to 1, and at 1 the shot
 *   is the same shot to the last bit): dragScale, liftScale (the air's drag / lift),
 *   windScale (the wind the ball feels; the wind reported is still the day's),
 *   bounceScale (restitution at a bounce), keepScale (tangential speed kept at a
 *   bounce), rollScale (rolling resistance; > 1 stops sooner), cupRadiusScale,
 *   cupMaxSpeedScale (how big and how forgiving the cup is), gravityScale (gravity in
 *   the air; < 1 floats),
 *   arcade extras (each absent, 0 or false by default, and then nothing changes):
 *   crossWindMps (a wind across the aim line on top of the day's: + blows from the left
 *     and pushes the ball right; it is scaled by windScale like any wind),
 *   ignoreTrees (true: the ball flies through trees),
 *   waterSkips (how many times a ball landing on water skips off it like a stone, while
 *     it comes in at waterSkipMaxDeg (default 55) or flatter and still has pace; each
 *     skip is a 'skip' event, and only the landing that sinks is a 'water' event),
 *   ripBackYd (the first landing bites and the ball rolls straight back toward where it
 *     came from, this many yards at most; not out of a bunker),
 *   homing (> 0: a sideways force in flight that pulls the ball back to the aim line,
 *     a critically damped spring of this strength, limited to HOMING_MAX_ACCEL),
 *   v2:playability arcade assists (lib/playability.js PLAY_ASSIST; absent, 0 or false:
 *   nothing changes):
 *   launchClearM (> 0: launch clearance. For this many metres of travel from the strike,
 *     ground that rises into a ball that is still climbing passes under it: the ball is
 *     carried over the lip, the bump or the brow in front of it instead of dying in it,
 *     up to launchClearRiseM (default 6) metres of rise in all; more than that is a wall
 *     and stops it as ever. A topped ball (launched under CLEAR_TOP_VLA degrees) is only
 *     helped over a lip: CLEAR_TOP_M metres, CLEAR_TOP_RISE_M of rise. A ball struck out
 *     of sand always comes out: the bank above the bunker is forgiven up to
 *     CLEAR_SAND_RISE_M, and inside the clearance distance the bunker it was hit from
 *     plays as rough, so even a topped one runs out of it),
 *   softTrees (true: leaves only brush the ball, a little speed and a little scatter,
 *     and only slim trunks stop it), treeFreeM (> 0: no tree touches the ball within this
 *     many metres of the strike): lib/tree-obstacles.js treeContacts}
 */
const scaleOpt = (v) => (Number.isFinite(v) && v >= 0 ? v : 1);

// A Skipper's skip off water: it keeps most of its pace and comes up at 62 % of the
// speed it came down with (never less than a hop), as long as it is moving forward.
const SKIP_MAX_DEG = 55;
const SKIP_MIN_SPEED = 6;      // m/s over the water; slower than this it sinks
const SKIP_KEEP = 0.9;         // horizontal speed kept
const SKIP_REBOUND = 0.62;     // vertical speed turned round
const SKIP_MIN_UP = 3.6;       // m/s
// A Yo-Yo's bite: it comes back at this share of the pace it landed with, but never
// with more than takes it ripBackYd on the ground it landed on.
const RIP_KEEP = 0.55;
// Homing: lateral acceleration = -(KP * error + KD * error rate) * strength, in m/s^2
// with the error in metres right of the aim line. KD = 2 sqrt(KP): no overshoot.
const HOMING_KP = 0.5;
const HOMING_KD = 2 * Math.sqrt(HOMING_KP);
const HOMING_MAX_ACCEL = 9;    // m/s^2: a hard bend, not a teleport
const HOMING_DELAY_S = 0.6;    // the ball leaves on its own line: the pull starts here ...
const HOMING_RAMP_S = 1.2;     // ... and is at full strength this much later
// v2:playability launch clearance (opts.launchClearM): the gap kept between the ball and
// the ground it is carried over, and what a topped ball gets instead of the full help.
const CLEAR_GAP_M = 0.02;
const CLEAR_RISE_M = 6;        // default for launchClearRiseM
const CLEAR_TOP_VLA = 4;       // launched lower than this (deg): a topped ball ...
const CLEAR_TOP_M = 10;        // ... is helped over a lip in its first metres only,
const CLEAR_TOP_RISE_M = 1.5;  // and over no more rise than a lip has
const CLEAR_SAND_RISE_M = 10;  // out of sand a ball always comes out: a raised green's whole bank is its lip

function simulateShot(launch, start, aimDeg, surfaceAt, opts = {}) {
  const terrain = opts.terrain || FLAT;
  const rho = Number.isFinite(opts.airDensity) && opts.airDensity > 0 ? opts.airDensity : RHO;
  const kq = 0.5 * rho * AREA;
  const kqD = kq * scaleOpt(opts.dragScale), kqL = kq * scaleOpt(opts.liftScale);
  const windScale = scaleOpt(opts.windScale);
  const bounceScale = scaleOpt(opts.bounceScale), keepScale = scaleOpt(opts.keepScale);
  const rollScale = scaleOpt(opts.rollScale);
  const cupRadius = CUP_RADIUS * scaleOpt(opts.cupRadiusScale);
  const cupMaxSpeed = CUP_MAX_SPEED * scaleOpt(opts.cupMaxSpeedScale);
  const grav = G * scaleOpt(opts.gravityScale);
  const crossWind = Number.isFinite(opts.crossWindMps) ? opts.crossWindMps : 0;
  let skipsLeft = Number.isFinite(opts.waterSkips) && opts.waterSkips > 0 ? Math.floor(opts.waterSkips) : 0;
  const skipMaxDeg = Number.isFinite(opts.waterSkipMaxDeg) && opts.waterSkipMaxDeg > 0 ? opts.waterSkipMaxDeg : SKIP_MAX_DEG;
  const ripBackM = Number.isFinite(opts.ripBackYd) && opts.ripBackYd > 0 ? opts.ripBackYd * YD : 0;
  const homing = Number.isFinite(opts.homing) && opts.homing > 0 ? opts.homing : 0;
  const turf = groundModel(opts.firmness, opts.greenStimp);
  const surfaces = turf.s;
  const v0 = launch.speedMph * MPH;
  const headRad = (aimDeg + launch.hla) * Math.PI / 180;
  const dir = { x: Math.sin(headRad), y: Math.cos(headRad) };
  const aimRad = aimDeg * Math.PI / 180;
  const aimDir = { x: Math.sin(aimRad), y: Math.cos(aimRad) };

  const startSurface = surfaceAt(start.x, start.y);
  const isPutt = opts.putt || (startSurface === 'green' && launch.vla < 2 && launch.speedMph < 40);

  const events = [];
  const points = [];
  const startZ = terrain.h(start.x, start.y);
  let t = 0;
  let pos = { x: start.x, y: start.y, z: startZ };
  let vel, omega, omegaAxis;

  if (isPutt) {
    vel = { x: dir.x * v0, y: dir.y * v0, z: 0 };
    omega = 0;
    omegaAxis = { x: 0, y: 0, z: 0 };
  } else {
    const vlaRad = launch.vla * Math.PI / 180;
    vel = {
      x: dir.x * v0 * Math.cos(vlaRad),
      y: dir.y * v0 * Math.cos(vlaRad),
      z: v0 * Math.sin(vlaRad),
    };
    omega = (launch.totalSpin || 0) * 2 * Math.PI / 60;
    // Pure backspin axis points RIGHT of travel; tilt by -spinAxis around the
    // travel direction so negative spinAxis (draw) curves the ball left.
    const right = { x: dir.y, y: -dir.x, z: 0 };
    const a = -(launch.spinAxis || 0) * Math.PI / 180;
    omegaAxis = {
      x: right.x * Math.cos(a),
      y: right.y * Math.cos(a),
      z: Math.sin(a),
    };
  }

  const wind = { x: 0, y: 0, z: 0 };
  let windMps = 0, gustMps = 0;
  if (opts.wind) {
    windMps = opts.wind.speedMps > 0 ? opts.wind.speedMps : 0;
    if (opts.wind.gustMps > 0) {
      gustMps = (2 * gustFraction(shotSeed(launch, start, aimDeg)) - 1) * opts.wind.gustMps;
      windMps = Math.max(0, windMps + gustMps);
    }
  }
  if (windMps > 0) {
    const wr = (opts.wind.fromDeg + 180) * Math.PI / 180;
    wind.x = Math.sin(wr) * windMps * windScale;
    wind.y = Math.cos(wr) * windMps * windScale;
  }
  if (crossWind !== 0) {   // an arcade gust across the aim line (+: toward the right of it)
    wind.x += aimDir.y * crossWind * windScale;
    wind.y -= aimDir.x * crossWind * windScale;
  }

  // Trees: trunks and crowns along the way. Branch hits are random, seeded by the
  // shot, so the same shot always plays out the same way.
  // v2:playability soft trees (the arcade's): a fourth argument only when one is asked for
  const softTrees = opts.softTrees === true || (Number.isFinite(opts.treeFreeM) && opts.treeFreeM > 0)
    ? { soft: opts.softTrees === true, freeM: Number.isFinite(opts.treeFreeM) && opts.treeFreeM > 0 ? opts.treeFreeM : 0, start }
    : null;
  const trees = opts.trees && opts.ignoreTrees !== true
    ? (softTrees ? treeContacts(opts.trees, terrain, shotSeed(launch, start, aimDeg), softTrees) : treeContacts(opts.trees, terrain, shotSeed(launch, start, aimDeg)))
    : null;
  // v2:playability launch clearance: how far from the strike it reaches (0: off, and then
  // none of this runs), how much rise is left to forgive, and the sand the ball was hit from
  const clearAsk = !isPutt && Number.isFinite(opts.launchClearM) && opts.launchClearM > 0 ? opts.launchClearM : 0;
  const topped = launch.vla < CLEAR_TOP_VLA;
  const clearM = topped ? Math.min(clearAsk, CLEAR_TOP_M) : clearAsk;
  const sandEscape = clearAsk > 0 && startSurface === 'bunker';
  const clearRise = Number.isFinite(opts.launchClearRiseM) && opts.launchClearRiseM > 0 ? opts.launchClearRiseM : CLEAR_RISE_M;
  let clearLeft = clearM > 0 ? (topped ? Math.min(CLEAR_TOP_RISE_M, clearRise) : sandEscape ? Math.max(CLEAR_SAND_RISE_M, clearRise) : clearRise) : 0;
  const nearStrike = (m) => { const ex = pos.x - start.x, ey = pos.y - start.y; return ex * ex + ey * ey < m * m; };

  const dt = 0.002;
  const k1 = { x: 0, y: 0, z: 0 }, k2 = { x: 0, y: 0, z: 0 };
  const k3 = { x: 0, y: 0, z: 0 }, k4 = { x: 0, y: 0, z: 0 };
  let carryPos = null;
  let carryZ = startZ;
  let apex = 0;
  let flightTime = 0;
  let bounces = 0;
  let phase = isPutt ? 'roll' : 'air';
  let sampleAcc = 0;
  let lowSpeedT = 0;
  let holed = false;

  points.push({ t, x: pos.x, y: pos.y, z: pos.z });

  sim:
  while (t < 60) {
    t += dt;

    if (phase === 'air') {
      // Classic RK4 on (pos, vel). Acceleration depends only on velocity
      // (uniform wind, launch-fixed spin axis), and omega is held over the step
      // then decayed, exactly as OpenFlight does.
      const vx = vel.x, vy = vel.y, vz = vel.z, h = dt / 2;
      const px = pos.x, py = pos.y, pz = pos.z;   // step start, for tree sweeps
      airAccel(vx, vy, vz, wind, omega, omegaAxis, kqD, kqL, grav, k1);
      airAccel(vx + h * k1.x, vy + h * k1.y, vz + h * k1.z, wind, omega, omegaAxis, kqD, kqL, grav, k2);
      airAccel(vx + h * k2.x, vy + h * k2.y, vz + h * k2.z, wind, omega, omegaAxis, kqD, kqL, grav, k3);
      airAccel(vx + dt * k3.x, vy + dt * k3.y, vz + dt * k3.z, wind, omega, omegaAxis, kqD, kqL, grav, k4);
      // position: dt/6 * (v + 2(v + h*k1) + 2(v + h*k2) + (v + dt*k3))
      pos.x += dt * (vx + dt * (k1.x + k2.x + k3.x) / 6);
      pos.y += dt * (vy + dt * (k1.y + k2.y + k3.y) / 6);
      pos.z += dt * (vz + dt * (k1.z + k2.z + k3.z) / 6);
      vel.x += dt * (k1.x + 2 * k2.x + 2 * k3.x + k4.x) / 6;
      vel.y += dt * (k1.y + 2 * k2.y + 2 * k3.y + k4.y) / 6;
      vel.z += dt * (k1.z + 2 * k2.z + 2 * k3.z + k4.z) / 6;
      omega *= Math.exp(-SPIN_DECAY_RATE * dt);
      if (homing > 0 && t > HOMING_DELAY_S) {
        const gain = homing * Math.min(1, (t - HOMING_DELAY_S) / HOMING_RAMP_S);
        // a Homing ball: a real sideways force, toward the aim line it was hit along
        const err = (pos.x - start.x) * aimDir.y - (pos.y - start.y) * aimDir.x;   // m right of the line
        const rate = vel.x * aimDir.y - vel.y * aimDir.x;
        const a = Math.max(-HOMING_MAX_ACCEL, Math.min(HOMING_MAX_ACCEL, -(HOMING_KP * err + HOMING_KD * rate) * gain));
        vel.x += aimDir.y * a * dt;
        vel.y -= aimDir.x * a * dt;
      }
      if (trees) {
        const hit = trees.air(px, py, pz, pos, vel);
        if (hit) {
          omega *= hit.spin;
          // v2:playability soft trees: a brush through the leaves is a 'leaves' event, not a tree hit
          events.push({ type: hit.part === 'leaves' ? 'leaves' : 'tree', t, x: pos.x, y: pos.y, z: pos.z, part: hit.part });
          points.push({ t, x: pos.x, y: pos.y, z: pos.z });   // keep the deflection crisp
          sampleAcc = 0;
        }
      }
      if (pos.z - startZ > apex) apex = pos.z - startZ;

      const ground = terrain.h(pos.x, pos.y);
      if (clearLeft > 0 && vel.z > 0 && pos.z <= ground && nearStrike(clearM)) {
        // v2:playability the ground rose into a ball that is still climbing: it passes under
        // the ball (the ball is carried over it, its velocity untouched) while there is
        // rise left to forgive; past that it is a wall, and the contact below is as ever
        const lift = ground + CLEAR_GAP_M - pos.z;
        if (lift <= clearLeft) {
          clearLeft -= lift;
          pos.z += lift;
          if (pos.z - startZ > apex) apex = pos.z - startZ;
        } else clearLeft = 0;
      }
      if (pos.z <= ground) {
        pos.z = ground;
        const g = terrain.grad(pos.x, pos.y);
        const nl = Math.hypot(g.dx, g.dy, 1);
        const n = { x: -g.dx / nl, y: -g.dy / nl, z: 1 / nl };
        const vDotN = vel.x * n.x + vel.y * n.y + vel.z * n.z;
        if (vDotN >= 0) { pos.z = ground + 0.001; continue; } // skimming away

        const surf = surfaceAt(pos.x, pos.y);
        if (!carryPos) { carryPos = { x: pos.x, y: pos.y }; carryZ = pos.z; flightTime = t; }
        if (surf === 'water') {
          const over = Math.hypot(vel.x, vel.y);
          if (skipsLeft > 0 && over >= SKIP_MIN_SPEED && Math.atan2(-vel.z, over) * 180 / Math.PI <= skipMaxDeg) {
            // a Skipper comes in flat enough: off the water like a stone, and on
            skipsLeft--;
            events.push({ type: 'skip', x: pos.x, y: pos.y });
            vel.x *= SKIP_KEEP; vel.y *= SKIP_KEEP;
            vel.z = Math.max(-vel.z * SKIP_REBOUND, SKIP_MIN_UP);
            pos.z = ground + 0.001;
            points.push({ t, x: pos.x, y: pos.y, z: pos.z });   // keep the skip crisp
            sampleAcc = 0;
            continue;
          }
          events.push({ type: 'water', x: pos.x, y: pos.y });
          break;
        }
        // v2:playability a ball struck out of sand skips out of it: that sand plays as rough
        const sp = (sandEscape && surf === 'bunker' && nearStrike(clearAsk) ? surfaces.rough : surfaces[surf]) || surfaces.rough;
        bounces++;
        events.push({ type: 'bounce', x: pos.x, y: pos.y, surface: surf });
        if (opts.carryOnly) break;

        // split velocity into normal + tangential parts
        const vn = { x: n.x * vDotN, y: n.y * vDotN, z: n.z * vDotN };
        const vt = { x: vel.x - vn.x, y: vel.y - vn.y, z: vel.z - vn.z };
        const bite = sp.spinBite * Math.min(1, omega / 900);
        let keep = sp.keep * (1 - 0.8 * bite);
        if (surf === 'green' && bite > 0.55 && bounces <= 2) keep = turf.zip; // zip back
        keep *= keepScale;
        const reboundV = -vDotN * sp.e * bounceScale;
        omega *= 0.55;

        const along = ripBackM > 0 && bounces === 1 && surf !== 'bunker' ? Math.hypot(vt.x, vt.y) : 0;
        if (along > 1e-6) {
          // a Yo-Yo: the first landing bites and the ball comes straight back along the ground
          const back = Math.min(along * RIP_KEEP, Math.sqrt(2 * sp.roll * rollScale * ripBackM));
          vel = { x: -vt.x / along * back, y: -vt.y / along * back, z: 0 };
          phase = 'roll';
        } else if (reboundV < 0.7 || bounces >= 6) {
          vel = { x: vt.x * keep, y: vt.y * keep, z: 0 };
          phase = 'roll';
        } else {
          vel = {
            x: vt.x * keep + n.x * reboundV,
            y: vt.y * keep + n.y * reboundV,
            z: vt.z * keep + n.z * reboundV,
          };
        }
      }
    } else { // roll — 2D velocity glued to the terrain surface
      const v = Math.hypot(vel.x, vel.y);
      const surf = surfaceAt(pos.x, pos.y);
      if (surf === 'water') { events.push({ type: 'water', x: pos.x, y: pos.y }); break; }
      const sp = (sandEscape && surf === 'bunker' && nearStrike(clearAsk) ? surfaces.rough : surfaces[surf]) || surfaces.rough;   // v2:playability
      const rollK = sp.roll * rollScale;
      const g = terrain.grad(pos.x, pos.y);
      const gmag = Math.hypot(g.dx, g.dy);
      const gx = gmag > 1 ? g.dx / gmag : g.dx;   // clamp slope to 45 deg
      const gy = gmag > 1 ? g.dy / gmag : g.dy;

      if (v < V_STOP) {
        lowSpeedT += dt;
        // static friction holds, or the ball has dithered long enough
        if (ROLL_INERTIA * G * Math.min(gmag, 1) <= rollK || lowSpeedT > 0.5) break;
      } else {
        lowSpeedT = 0;
      }

      let ax = -ROLL_INERTIA * G * gx;
      let ay = -ROLL_INERTIA * G * gy;
      if (v > 1e-6) {
        ax -= rollK * vel.x / v;
        ay -= rollK * vel.y / v;
      }
      vel.x += ax * dt; vel.y += ay * dt;
      // friction can't reverse direction within a step
      if ((vel.x * (vel.x - ax * dt) + vel.y * (vel.y - ay * dt)) < 0 && gmag < 0.02) {
        vel.x = 0; vel.y = 0;
      }
      const rx = pos.x, ry = pos.y;
      pos.x += vel.x * dt; pos.y += vel.y * dt;
      const hit = trees && trees.roll(rx, ry, pos, vel);   // off a trunk, into a fir's skirt
      pos.z = terrain.h(pos.x, pos.y);
      if (hit) {
        events.push({ type: 'tree', t, x: pos.x, y: pos.y, z: pos.z, part: hit.part });
        points.push({ t, x: pos.x, y: pos.y, z: pos.z });
        sampleAcc = 0;
      }

      // cup capture
      if (opts.pin) {
        const dp = Math.hypot(opts.pin.x - pos.x, opts.pin.y - pos.y);
        if (dp < cupRadius && Math.hypot(vel.x, vel.y) < cupMaxSpeed) {
          holed = true;
          events.push({ type: 'holed', x: pos.x, y: pos.y });
          pos.x = opts.pin.x; pos.y = opts.pin.y;
          break;
        }
      }
    }

    sampleAcc += dt;
    if (sampleAcc >= 0.02) {
      sampleAcc = 0;
      points.push({ t, x: pos.x, y: pos.y, z: pos.z });
    }
  }
  points.push({ t, x: pos.x, y: pos.y, z: pos.z });

  if (!carryPos) { carryPos = { x: pos.x, y: pos.y }; carryZ = pos.z; flightTime = t; }

  const dx = pos.x - start.x, dy = pos.y - start.y;
  const cdx = carryPos.x - start.x, cdy = carryPos.y - start.y;
  const offline = dx * -aimDir.y + dy * aimDir.x;   // + = left, flipped below

  return {
    points,
    carryYd: Math.hypot(cdx, cdy) / YD,
    totalYd: Math.hypot(dx, dy) / YD,
    offlineYd: -offline / YD,                       // + = right of aim line
    apexFt: apex * 3.28084,
    flightTime,
    end: { x: pos.x, y: pos.y },
    endZ: pos.z,
    endSurface: surfaceAt(pos.x, pos.y),
    events,
    isPutt,
    holed,
    startZ,
    land: { x: carryPos.x, y: carryPos.y, z: carryZ }, // first ground contact (putts: the end)
    windMps,                                        // the wind this ball flew in, gust included
    gustMps,                                        // its gust: + stronger, - weaker than steady
  };
}

module.exports = { simulateShot, groundModel, SURFACES, MPH, YD, RHO, STIMP_STD, FIRMNESS_STD };
