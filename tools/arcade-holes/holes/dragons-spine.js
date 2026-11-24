'use strict';
// Dragon's Spine: a ROCKET par 4, 604 yd in plan. The tee shot must rocket across the lava
// and 45 m UP onto the Spine, a fairway along the crest of the volcano's south rim (296 m to
// its lip: the stage's free Rocket ball makes it from about 118 mph, a plain ball never). The
// green lies in the caldera beyond and 39 m below: a wedge down from the Spine, and a Rocket
// that runs off the Spine's end rolls down the crater wall toward the flag.
//
//   the lava (0)        in front of the tee, all down the volcano's west side and behind it
//   the Jaw (38)        a ledge across the foot of the Spine, 190 m out: sheer to the lava in
//                       front, a scree slope (42 %) behind it up to the Spine's lip. A Rocket
//                       that comes up short lands on the scree and is pitched on up it
//   the Spine (69)      the rim fairway, 88 m wide and 165 m long; sheer to the lava on its west
//   the caldera (30)    the bowl: the green, a lava pool, the crater wall all round it
//   the Ash Road (7)    right of the lava: the dry way. A scree slope climbs from it to ...
//   the Ash Terrace (38)   ... the wide ground east of the volcano, level with the Jaw. From
//                       there the crater's rim is low (56): pitch up its flank and over
// Routes: ROCKET over the lava onto the Spine; SAFE the Ash Road, the Ash Terrace and over
// the low rim; RISKY from the Ash Terrace, one long shot over the rim at the flag.
// Why slopes and not steps: the game lets a player aim 45 degrees either side of the flag and
// no further, so a ball under a wall with the flag beyond it could never be played out. Every
// climb is scree a ball can stop on; every cliff drops into lava, which reaches up it to its lip.
// Local metres, x east, y north; the tee is the origin and the hole plays due north.
// Heights are metres above the lava (the lava is exactly 0).

const L = require('../lib');

const TEE = [0, 0];
const PIN = [0, 552];                                    // 604 yd
const C = [0, 560];                                      // the caldera's centre
const TEE_H = 24, ROAD = 7, COIL = 38, SPINE = 69, BOWL = 30, POOL = 28, LOW_RIM = 56;
const R_FLOOR = 66, R_CREST = 96;                        // the crater: its floor, its crest
const SCREE = 0.42;
const JAW_Y = 190, FOOT_Y = 222, LIP_Y = 296;            // the Jaw's lip, the foot of the scree, the Spine's lip
const WEST = -44;                                        // the Spine's west wall (x)

// the high ground at the Jaw's level: the Jaw itself, the Ash Terrace east of the Spine and
// everything north of it. South-east of it a scree slope, SKIRT_M long, falls to the ash plain
// (the Ash Road is within 35 degrees of the flag from the tee: further right could not be aimed at)
const SKIRT_M = (COIL - ROAD) / SCREE;
const highGround = [[-300, JAW_Y], [64, JAW_Y], [96, 236], [330, 272], [330, 840], [-300, 840]];
const highSd = (x, y) => (y >= 272 ? 1 : L.signedDistance(x, y, highGround));
const upSkirt = (x, y) => SKIRT_M + Math.min(0, highSd(x, y));          // metres up the slope from its foot (SKIRT_M: on top)

// ---- outlines
const teePad = L.blob(0, -4, 24, 18, { wobble: 0.05, seed: 3, n: 40 });
const spine = L.rect(WEST, LIP_Y, 44, 472);
const tongue = L.rect(WEST, FOOT_Y, 44, LIP_Y + 1);      // the scree from the Jaw up to the Spine
const pool = L.blob(-34, 594, 17, 11, { wobble: 0.06, seed: 6, n: 40, rotDeg: -20 });
// the lava: the field in front, up the Spine's west wall, round the crater's west and north
// rim (it follows the crest), and a lake behind the volcano
const crestArc = [];
for (let deg = -117; deg >= -320; deg -= 7) crestArc.push([C[0] + (R_CREST + 3) * Math.cos(deg * Math.PI / 180), C[1] + (R_CREST + 3) * Math.sin(deg * Math.PI / 180)]);
const lava = [[-256, 24], [12, 26], [20, 60], [30, 100], [44, 150], [59, JAW_Y - 1], [WEST - 1.5, JAW_Y - 1], [WEST - 1.5, 468],
  ...crestArc, [128, 690], [40, 716], [-120, 704], [-256, 664]];

// ---- surfaces
const tee = L.rect(-6, -5, 6, 5);
const ashRoad = L.capsule([[38, 40], [54, 76], [60, 92]], [28, 38, 36]);
const jaw = L.roundCorners(L.rect(-36, 196, 52, 216), 7);                     // 88 x 20 m, where a long plain drive finishes
const ashTerrace = L.blob(130, 340, 46, 70, { wobble: 0.03, seed: 12 });      // 92 x 140 m
const spineFairway = L.roundCorners(L.rect(-35, 305, 35, 461), 12);           // 70 x 156 m
const bowlFairway = L.blob(4, 542, 44, 36, { wobble: 0.03, seed: 16 });
const green = L.blob(0, 552, 19, 17, { wobble: 0.04, seed: 17 });             // 38 x 34 m
const greenApron = L.offsetPolygon(green, 5);
const bunkers = [
  L.blob(28, 532, 8, 6, { wobble: 0.08, seed: 21, rotDeg: 30 }),              // front right, under the wall
  L.blob(24, 578, 9, 5, { wobble: 0.08, seed: 22, rotDeg: -25 }),             // back right
];
const fairways = [ashRoad, jaw, ashTerrace, spineFairway, bowlFairway];
const mown = [tee, green, ...fairways, ...bunkers];

// ---- ground
const ash = L.fbm({ seed: 1101, scaleM: 58, octaves: 3 });
const swell = L.fbm({ seed: 1102, scaleM: 130, octaves: 2 });
const crags = L.ridged({ seed: 1103, scaleM: 84, octaves: 3 });
const rockNoise = L.fbm({ seed: 1104, scaleM: 24, octaves: 2 });
const rimNoise = L.fbm({ seed: 1105, scaleM: 46, octaves: 2 });
const ridge = L.tiers([
  { poly: tongue, level: (x, y) => COIL + (SPINE - COIL) * L.clamp((y - FOOT_Y) / (LIP_Y - FOOT_Y), 0, 1), cliffM: 9 },
  { poly: spine, level: SPINE, cliffM: 9 },
]);
const platform = L.tiers([{ poly: teePad, level: TEE_H, cliffM: 9 }]);
const offMown = L.awayFrom(mown, 5, 16);
const lavaSd = L.nearField(lava, 4);
const greenPlane = L.plane(BOWL + 0.4, PIN, 0.005, -0.011);                   // 1.2 %, falling to the back left (the pool)

// an angular window: 1 within inDeg of the bearing atDeg, 0 beyond outDeg
const sector = (deg, atDeg, inDeg, outDeg) => 1 - L.smoothstep(inDeg, outDeg, Math.abs(((deg - atDeg + 540) % 360) - 180));
// the crater's rim, by bearing from its centre (0 east, 90 north): high and jagged where the
// lava laps it, level with the Spine to the south, low from the south-east round to the east
function rimHeight(deg, x, y) {
  let h = 88 + 9 * rimNoise(x, y) + 8 * sector(deg, 150, 20, 70);             // highest in the north-west, where the dragon sits
  h = L.lerp(h, LOW_RIM, sector(deg, -22, 33, 41));
  h = L.lerp(h, SPINE, sector(deg, -90, 27, 35));
  return h;
}
const PEAK = [44, 800];                                  // the summit cone behind the volcano

function height(x, y) {
  const off = offMown(x, y);
  // the ash plain by the Road, the slope up from it, the Terrace and the high ground beyond
  const up = L.clamp(upSkirt(x, y) / SKIRT_M, 0, 1);                     // 0 on the plain, 1 on the high ground
  let h = L.lerp(ROAD + off * (1.5 + 1.4 * ash(x, y) + 1.2 * swell(x, y)), COIL, up);
  let cliff = 0;
  // hills at the edges of the world; the summit cone, far behind
  const edge = Math.max(L.smoothstep(262, 300, x + 12 * swell(y, x)), L.smoothstep(-58, -92, y + 10 * swell(x + 90, y)), L.smoothstep(-244, -268, x));
  if (edge) { h = L.lerp(h, Math.max(h, 46 + 26 * crags(x, y)), edge); cliff = 4 * edge * (1 - edge); }
  const dp = Math.hypot(x - PEAK[0], (y - PEAK[1]) * 1.15);
  const cone = 205 - 1.35 * dp + 20 * crags(x * 1.3, y * 1.3) * L.smoothstep(0, 60, dp);
  if (cone > h) { h = L.lerp(h, cone, L.smoothstep(0, 14, cone - h)); cliff = Math.max(cliff, 0.7); }
  // the crater: a scree flank up to the rim's crest, a wall down to the level bowl
  const r = Math.hypot(x - C[0], y - C[1]);
  const rim = r < R_CREST + 140 ? rimHeight(Math.atan2(y - C[1], x - C[0]) * 180 / Math.PI, x, y) : 0;
  if (r <= R_CREST) {
    const t = L.smoothstep(R_FLOOR, R_CREST, r);
    h = L.lerp(BOWL, rim, t);
    cliff = 4 * t * (1 - t);
  } else if (rim) {
    const flank = rim - SCREE * (r - R_CREST);
    if (flank > h) { h = flank; cliff = 0; }
  }
  h = ridge.apply(x, y, h);
  h = platform.apply(x, y, h);
  // rock: strata on every wall, clinker on the open ground; nothing near mown ground
  if (off) {
    cliff = Math.max(cliff, ridge.cliff(x, y), platform.cliff(x, y));
    if (cliff) h = L.lerp(h, L.strata(h + 1.4 * rockNoise(x, y), 6, 0.75), 0.85 * cliff * off);
    h += off * (1 - cliff) * 0.55 * rockNoise(x - 60, y + 30);
  }
  // the green; sand in hollows; the pool in the bowl, level, below the turf
  const onGreen = L.plateauWeight(x, y, greenApron, 6);
  if (onGreen) h = L.lerp(h, greenPlane(x, y), onGreen);
  for (const b of bunkers) {
    const sand = L.signedDistance(x, y, b);
    if (sand > 0) h -= 0.5 * L.smoothstep(0, 3, sand);
  }
  const inPool = L.plateauWeight(x, y, pool, 7);
  if (inPool) h = L.lerp(h, POOL, inPool);
  // the lava: exactly level, and every cliff over it falls to it INSIDE its outline (so a ball
  // that goes over an edge is in the lava, and is dropped back on top)
  const wet = lavaSd(x, y);
  if (wet > 0) h = L.lerp(h, 0, L.clamp((wet - 2.5) / 3, 0, 1));    // (level for 2.5 m inside the outline: a drop on the lip stands on flat rock)
  return h;
}

// ---- trees: a burnt wood on the ash plain, well right of the Ash Road
const onPlain = (x, y) => upSkirt(x, y) < -8 && y < 190 && platform.cliff(x, y) === 0 && platform.on(x, y) < 0 && lavaSd(x, y) < -12 && x < 256 && y > -52;
const trees = [
  ...L.scatterTrees(L.rect(140, -40, 252, 150), { spacing: 22, jitter: 0.45, seed: 71, avoid: mown, clearM: 10, keep: onPlain }),
  ...L.scatterTrees(L.rect(-70, -50, -24, -14), { spacing: 17, jitter: 0.4, seed: 72, avoid: mown, clearM: 8, keep: onPlain }),
].map(([x, y], i) => [x, y, 7 + (i % 4) * 1.4, 2.4 + (i % 3) * 0.5]);
const woods = [L.roundCorners([[176, -44], [252, -40], [256, 110], [204, 130], [160, 60]], 18)];

// ---- props
const props = [];
const lineClear = (x, y, m) => L.distToSegment(x, y, TEE[0], TEE[1], PIN[0], PIN[1]) >= m;
const offPlay = (x, y, m = 3) => mown.every((poly) => L.signedDistance(x, y, poly) < -m);
const P = (kind, x, y, heightM, rotDeg = 0) => {
  const floats = L.FLOATING_PROP_KINDS.includes(kind);
  if (!floats && !(offPlay(x, y) && lineClear(x, y, L.SLIM_PROP_KINDS.includes(kind) ? 6 : 9))) return false;
  props.push(L.prop(kind, x, y, { heightM, rotDeg }));
  return true;
};
const toward = (x, y, tx, ty) => L.facing(x, y, tx, ty);
const inLava = (x, y) => L.signedDistance(x, y, lava) > 7;
const polar = (deg, r) => [C[0] + r * Math.cos(deg * Math.PI / 180), C[1] + r * Math.sin(deg * Math.PI / 180)];

// the launch platform
P('launch-ramp', -18, 13, 7.5); P('launch-ramp', 18, 13, 7.5);
P('crowd', 0, -16, 3, toward(0, -16, 0, 0));
P('statue', -17, -13, 9, toward(-17, -13, 0, 300)); P('ruins', 18, -14, 6, 40);
for (const s of [-1, 1]) {
  P('flag-banner', s * 9, -9, 8, s * 15); P('flag-banner', s * 19, 1, 9, s * 30);
  P('torch', s * 8.5, 7.5, 3.4); P('torch', s * 8.5, -7.5, 3.4); P('torch', s * 20, 9, 3.6);
}
// the dragon, coiled on the highest part of the rim, watching the green
P('dragon', ...polar(152, R_CREST - 2), 40, toward(...polar(152, R_CREST - 2), 0, 520));
P('fireworks', -40, 640, 44); P('fireworks', 50, 650, 40);
// lava pouring off the Jaw, the Spine's west wall and the crater
for (const [x, y, hM, tx, ty] of [[-30, JAW_Y - 4, 36, -30, 100], [34, JAW_Y - 4, 36, 34, 100],
  [WEST - 5, 250, 44, -260, 250], [WEST - 5, 340, 64, -260, 340], [WEST - 5, 420, 64, -260, 420],
  [...polar(190, R_CREST + 6), 84, -260, 540], [...polar(120, R_CREST + 6), 84, -120, 760], [...polar(75, R_CREST + 6), 84, 40, 760],
  [-58, 574, 46, 0, 560]]) P('lava-fall', x, y, hM, toward(x, y, tx, ty));
// torches: down both edges of the Spine and the scree below it, round the green, on the Jaw
for (let y = FOOT_Y + 6; y <= 462; y += 18) { P('torch', -40, y, 3.6); P('torch', 40, y, 3.6); }
for (let k = 0; k < 12; k++) { const a = (k / 12) * 2 * Math.PI + 0.2; P('torch', 26 * Math.cos(a), 552 + 24 * Math.sin(a), 3.2); }
for (const [x, y] of [[-40, 193], [40, 193], [58, 194], [-40, 219], [58, 219], [80, 286], [182, 286], [80, 400], [182, 400], [34, 104], [84, 96]]) P('torch', x, y, 3.2);
// banners: the Spine's lip, the Ash Road, the low rim
for (const [x, y] of [[-22, 300], [22, 300], [-40, 300], [40, 300], [-40, 468], [40, 468], [52, 30], [78, 70], [86, 122], [120, 180], [150, 240],
  [-50, 552], [50, 560], [0, 610], [200, 340], [190, 430]]) P('flag-banner', x, y, 8, (x * 5 + y) % 360);
for (const deg of [-58, -40, -22, -4, 14]) P('flag-banner', ...polar(deg, R_CREST), 9, deg);
// the Dragon's Gate: a gate on the low rim where the Ash Terrace's path crosses it, idols
// either side of it, a temple on the Terrace
P('gate', ...polar(-32, R_CREST), 17, toward(...polar(-32, R_CREST), ...polar(-32, 200)));
P('idol', ...polar(-44, R_CREST + 16), 9, toward(...polar(-44, R_CREST + 16), ...polar(-44, 220)));
P('idol', ...polar(-20, R_CREST + 16), 9, toward(...polar(-20, R_CREST + 16), ...polar(-20, 220)));
P('temple', 212, 372, 22, toward(212, 372, 100, 372));
P('tower', ...polar(-66, R_CREST), 20); P('tower', ...polar(24, R_CREST), 20); P('tower', 218, 236, 16); P('tower', 206, 470, 16);
P('ruins', 190, 300, 8, 70); P('ruins', 74, 250, 6, 20); P('ruins', 170, 600, 8, 130); P('ruins', 150, 196, 7, 110);
P('crowd', 0, 606, 3.2, toward(0, 606, 0, 552)); P('crowd', 52, 590, 3, toward(52, 590, 0, 552)); P('crowd', 190, 330, 3, toward(190, 330, 130, 340));
// rocks standing in the lava, crystals growing out of the cooled rock
const lavaSpots = L.scatterTrees(L.rect(-250, 30, 120, 700), { spacing: 46, jitter: 0.48, seed: 81, keep: (x, y) => inLava(x, y) && lineClear(x, y, 12) });
lavaSpots.forEach(([x, y], i) => P('lava-rock', x, y, 4 + (i % 6) * 1.5, (i * 53) % 360));
for (const [x, y, hM] of [[-30, 220, 4], [58, 222, 5], [52, 250, 6], [50, 300, 5], [50, 360, 4.5], [50, 420, 5], [86, 300, 5], [186, 424, 6],
  [78, 180, 5], [120, 196, 4.5], [206, 262, 6], [160, 500, 5], [-44, 520, 4], [46, 522, 4], [-10, 604, 5], [36, 608, 4], [136, 60, 6], [120, 16, 5], [-34, -18, 5], [34, -20, 5.5],
  [120, 470, 5], [150, 520, 6], [230, 520, 7]]) P('crystal', x, y, hM, (x * 9 + y) % 360);
// basalt columns along the Ash Road and up the slope from it
for (const [x, y, hM] of [[58, 24, 12], [84, 52, 14], [30, 108, 10], [92, 100, 14], [64, 140, 11], [140, 150, 15], [110, 214, 12], [200, 216, 14]]) P('obelisk', x, y, hM, (x + y) % 360);
P('ruins', 152, 70, 7, 110);
const ashSpots = L.scatterTrees(L.rect(40, -50, 256, 140), { spacing: 34, jitter: 0.48, seed: 82, keep: (x, y) => onPlain(x, y) && offPlay(x, y, 7) && L.signedDistance(x, y, woods[0]) < -4 });
ashSpots.forEach(([x, y], i) => P('lava-rock', x, y, 2.5 + (i % 4) * 0.9, (i * 71) % 360));
const highSpots = L.scatterTrees(L.rect(70, 230, 256, 700), { spacing: 40, jitter: 0.48, seed: 83, keep: (x, y) => highSd(x, y) > 6 && offPlay(x, y, 8) && Math.hypot(x - C[0], y - C[1]) > R_CREST + 50 && !inLava(x, y) && L.signedDistance(x, y, lava) < -8 && x > 60 });
highSpots.forEach(([x, y], i) => P(i % 3 ? 'lava-rock' : 'crystal', x, y, 3 + (i % 5) * 1.1, (i * 61) % 360));
// in the air: smoke over the summit, an airship keeping its distance
P('cloud', 40, 790, 30); P('cloud', 80, 800, 24); P('cloud', 0, 810, 22); P('cloud', -160, 520, 16); P('cloud', 210, 610, 18);
P('airship', 210, 150, 26, 200); P('balloon', 262, 420, 22); P('balloon', -200, 60, 20);
P('bird-flock', -90, 380, 9, 30); P('bird-flock', 110, 280, 8, 250); P('bird-flock', 40, 660, 10, 130);
// the range beyond: more cones on every horizon
for (const [x, y, hM, rot] of [[-520, 900, 230, 0], [520, 980, 260, 40], [-760, 420, 200, 200], [640, 300, 180, 120], [-420, -260, 150, 80], [380, -300, 160, 300], [80, 1280, 320, 10]]) P('volcano', x, y, hM, rot);

// ---- gadgets (docs/gadgets.md): what a swing can hit
//   ROCKET  coins up the full Rocket's flight, and nothing hangs in its way: the hero carry
//           is the hole. The Dragon's Step, a pad on the scree under the Spine's lip, throws
//           a Rocket that came up short (struck at about 100 to 108 mph) up onto the Spine.
//           Beyond the Spine's far end the Dragon's Tail, a pad, throws a ball that runs off
//           it (165 mph and more) down into the caldera.
//   the lava spits: three vents across the foot of the Jaw erupt on a four second cycle
//           from the moment of impact. A plain drive that is falling into the lava over one
//           while it is firing is thrown up onto the Jaw or the scree above it.
//   SAFE    the Ash Terrace is a x2 landing.
const spineRocket = L.flight(height, TEE, PIN, { speedMph: 125, vla: 13, spin: 2600, ball: 'rocket' });
const gadgets = [
  L.gadget('pad', 'dragons-step', 0, 272, { radius: 8, heading: 0, angle: 58, minMps: 27, maxMps: 27 }),
  L.gadget('geyser', 'jaw-vent', 0, 170, { radius: 7, height: 50, strength: 26, cycle: 4, offset: 3.6, burst: 2 }),
  L.gadget('geyser', 'jaw-vent-west', -22, 166, { radius: 7, height: 50, strength: 26, cycle: 4, offset: 1.6, burst: 2 }),
  L.gadget('geyser', 'jaw-vent-east', 22, 166, { radius: 7, height: 50, strength: 26, cycle: 4, offset: 2.6, burst: 2 }),
  L.gadget('pad', 'dragons-tail', 0, 466, { radius: 5, angle: 45, minMps: 21, maxMps: 23 }),
  L.gadget('zone', 'terrace-x2', 130, 340, { radius: 14, mult: 2 }),
  spineRocket.coins('spine-coins', 80, 330, 7),
];

module.exports = {
  id: 'dragons-spine',
  stage: {
    number: 11, role: 'match', order: 11,
    name: "Dragon's Spine", theme: 'volcano',
    origin: { lat: 46.5, lon: -158.0 },          // open North Pacific
    conditions: 'breezy',
    wind: { min: 6, max: 15 },                   // the Spine's lip is set so a 125 mph Rocket makes it into 15 mph
    baseM: 1100,
    timeOfDay: 'dusk',
    blurb: 'Rocket par 4: over the lava and 45 m up to the crater rim, then down into the caldera.',
    difficulty: 3,
    freeBall: 'rocket',
  },
  extent: { minX: -270, minY: -100, maxX: 310, maxY: 824 },
  hole: {
    par: 4,
    name: "Dragon's Spine",
    line: [TEE, PIN],
    note: 'A rocket par 4. The free Rocket ball carries the lava and climbs 45 metres onto the Spine, the fairway along the crater rim (about 118 mph does it; less lands on the scree under it). The green is in the caldera beyond, 39 metres below. The Ash Road, right of the lava, is the dry way round.',
    greenNote: 'In the bowl of the crater, tilted gently toward the lava pool at the back left. Everything that comes over the rim rolls down toward it.',
    routes: [
      { id: 'safe', name: 'The Ash Road', note: 'Right of the lava, up the slope to the Ash Terrace, a pitch up the low rim and one down. Dry all the way.' },
      { id: 'risky', name: 'Over the Crater Wall', note: 'From the Ash Terrace, one long shot over the rim at the flag. Short stays on the flank and costs a shot.' },
      { id: 'rocket', name: "The Dragon's Spine", note: 'The free Rocket over the lava: 325 yards of carry, 45 m up to the rim, a wedge down to the flag.' },
    ],
  },
  surfaces: [
    { kind: 'tee', poly: tee },
    ...fairways.map((poly) => ({ kind: 'fairway', poly })),
    { kind: 'green', poly: green },
    ...bunkers.map((poly) => ({ kind: 'bunker', poly })),
    { kind: 'water', poly: lava },
    { kind: 'water', poly: pool },
  ],
  trees,
  woods,
  props,
  gadgets,
  obLine: L.rect(-262, -90, 300, 812),
  height,
  sea: false,
  probes: [
    { at: [0, 120], kind: 'water', what: 'the lava field, on the direct line' },
    { at: [0, 40], kind: 'water', what: 'the lava below the tee' },
    { at: [0, 184], kind: 'water', what: 'the lava under the Jaw' },
    { at: [-60, 380], kind: 'water', what: "the lava under the Spine's west wall" },
    { at: [-200, 400], kind: 'water', what: 'the lava west of the volcano' },
    { at: [-20, 680], kind: 'water', what: 'the lava lake behind the crater' },
    { at: [-34, 594], kind: 'water', what: 'the lava pool in the caldera' },
    { at: [0, 206], kind: 'fairway', what: 'the Jaw' },
    { at: [0, 330], kind: 'fairway', what: 'the Spine, where a 125 mph Rocket lands' },
    { at: [0, 440], kind: 'fairway', what: 'the far end of the Spine' },
    { at: [54, 76], kind: 'fairway', what: 'the Ash Road' },
    { at: [130, 340], kind: 'fairway', what: 'the Ash Terrace' },
    { at: [0, 520], kind: 'fairway', what: 'the bowl, short of the green' },
    { at: [28, 532], kind: 'bunker', what: 'the front bunker' },
    { at: [24, 578], kind: 'bunker', what: 'the back bunker' },
    { at: [0, 260], kind: 'rough', what: 'the scree under the Spine' },
    { at: [0, 484], kind: 'rough', what: 'the crater wall below the Spine' },
    { at: [60, 380], kind: 'rough', what: "the foot of the Spine's east wall" },
    { at: [80, 480], kind: 'rough', what: "the crater's south-east flank" },
    { at: [110, 190], kind: 'rough', what: 'the slope from the Ash Road to the Ash Terrace' },
    { at: [200, 60], kind: 'rough', what: 'the ash plain' },
    { at: [0, 16], kind: 'rough', what: 'the lip of the launch platform' },
    { at: [-268, 300], kind: 'ob', what: 'beyond the lava, west' },
    { at: [308, 300], kind: 'ob', what: 'over the eastern hills' },
  ],
};
