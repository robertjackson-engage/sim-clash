'use strict';
// Summit Express: a ROCKET par 5 that climbs a mountain, 700 yd in plan and 70 m up.
// The tee shot rockets from base camp up the headwall into a hanging valley (260 m to its
// lip, 44 m up: the stage's free Rocket ball makes it from about 105 mph in still air and
// from 120 mph into the stiffest headwind this windy stage rolls; a plain ball never). From
// the valley the hole climbs a snow bank to the Bench, and then there is a choice: carry the
// crevasse straight at the summit flag, or zigzag left up the West Col, round its head.
//
//   base camp (8), the meadow (about 6), a frozen lake left of it
//   the headwall         snow at 42 %: 6 -> 38, the Shoulder (38, a level ledge), 38 -> 52.
//                        A Rocket that comes up short stops on it and is pitched on up
//   the hanging valley (52)   180 m of snow between two aretes that feed a wide ball back
//   the Bench (64)       up a bank from the valley: the last ledge before the crevasse
//   the crevasse (40, ice)    48 m wide, from the middle of the mountain out to its east face
//   the West Col         the bank left of the crevasse's head, from the Bench up to ...
//   the summit (78)      ... the top: the green beyond the crevasse, the Col's landing left of it
// Routes: ROCKET up the headwall (a huge one reaches the Bench); RISKY over the crevasse at
// the flag; SAFE left up the West Col and across the summit.
// Why banks and not steps: the game lets a player aim 45 degrees either side of the flag and
// no further, so a ball under a wall with the flag beyond it could never be played out. Every
// climb is a bank a ball can stop on; the crevasse is ice to its lips; beyond the aretes and
// behind the summit is out of bounds, dropped on the crest where the ball went over.
// Local metres, x east, y north; the tee is the origin and the hole plays north.

const L = require('../lib');

const TEE = [0, 0];
const PIN = [20, 640];
const LINE = [TEE, [8, 380], [10, 516], PIN];            // 700 yd
const TEE_H = 8, SHOULDER = 38, VALLEY = 52, BENCH = 64, SUMMIT = 78, ICE = 40, LAKE = 3;
const HEAD_X = -15;                                      // the crevasse's head: west of this the West Col climbs

// ---- outlines
const teePad = L.blob(0, -4, 24, 18, { wobble: 0.05, seed: 3, n: 40 });
const crevasse = L.roundCorners([[HEAD_X, 549], [150, 549], [150, 597], [HEAD_X, 597]], 6);
const lake = L.blob(-112, 60, 36, 44, { wobble: 0.08, seed: 5, n: 56, rotDeg: 12 });

// ---- surfaces
const tee = L.rect(-6, -5, 6, 5);
const meadow = L.roundCorners(L.rect(-28, 34, 30, 114), 14);                  // the floor fairway
const shoulderFairway = L.roundCorners(L.rect(-70, 204, 76, 222), 8);         // the ledge on the headwall: 146 x 18 m
const valleyFairway = L.roundCorners(L.rect(-46, 270, 48, 432), 14);          // 94 x 162 m
const benchFairway = L.roundCorners(L.rect(-56, 476, 52, 540), 12);           // 108 x 64 m
const westCol = L.blob(-52, 606, 26, 15, { wobble: 0.04, seed: 12 });         // where the Col arrives on the summit
const landing = L.roundCorners(L.rect(-8, 603, 50, 624), 6);                  // beyond the crevasse, short of the green
const summitFairway = L.capsule([[-50, 612], [-10, 634], [20, 632]], [36, 40, 44]);
const green = L.blob(20, 640, 19, 17, { wobble: 0.04, seed: 13 });            // 38 x 34 m
const greenApron = L.offsetPolygon(green, 5);
const bunkers = [
  L.blob(47, 646, 6, 9, { wobble: 0.08, seed: 21 }),
  L.blob(16, 667, 11, 5, { wobble: 0.08, seed: 22 }),
];
const fairways = [meadow, shoulderFairway, valleyFairway, benchFairway, westCol, landing, summitFairway, greenApron];
const mown = [tee, green, ...fairways, ...bunkers];

// ---- ground
const drifts = L.fbm({ seed: 1201, scaleM: 62, octaves: 3 });
const swell = L.fbm({ seed: 1202, scaleM: 140, octaves: 2 });
const crags = L.ridged({ seed: 1203, scaleM: 96, octaves: 3 });
const rockNoise = L.fbm({ seed: 1204, scaleM: 25, octaves: 2 });
const warpB = L.fbm({ seed: 1212, scaleM: 44, octaves: 2 });
const platform = L.tiers([{ poly: teePad, level: TEE_H, cliffM: 7 }]);
const offMown = L.awayFrom(mown, 5, 16);
const iceSd = L.nearField(crevasse, 4), lakeSd = L.nearField(lake, 4);
const greenPlane = L.plane(SUMMIT, PIN, -0.006, 0.01);                        // 1.2 %, falling to the front right

// the mountain along its spine (y -> height): banks of about 42 % between level ground
const SPINE = [[124, 6], [200, SHOULDER], [226, SHOULDER], [260, VALLEY], [440, VALLEY], [468, BENCH], [548, BENCH], [582, SUMMIT], [690, SUMMIT], [722, 52], [800, 22], [900, 20]];
function spineHeight(y) {
  if (y <= SPINE[0][0]) return SPINE[0][1];
  for (let i = 1; i < SPINE.length; i++) if (y <= SPINE[i][0]) return L.lerp(SPINE[i - 1][1], SPINE[i][1], (y - SPINE[i - 1][0]) / (SPINE[i][0] - SPINE[i - 1][0]));
  return SPINE[SPINE.length - 1][1];
}
// is this height on one of the level stretches?
const LEVELS = [SHOULDER, VALLEY, BENCH, SUMMIT];
// aretes and peaks standing on it: [line, half width, [height at each point]]
const RIDGES = [
  { line: [[-100, 262], [-106, 340], [-114, 430], [-132, 520], [-176, 566]], half: 50, rise: [22, 40, 54, 78, 104] },   // the west arete, up to the West Peak
  { line: [[98, 262], [102, 340], [106, 430], [106, 520]], half: 46, rise: [16, 24, 28, 22] },                          // the east arete
  { line: [[64, 708], [84, 726]], half: 36, rise: [40, 30] },                                                           // the Horn, behind the green
  { line: [[-176, 566], [-196, 660], [-170, 740]], half: 60, rise: [104, 70, 40] },                                     // the West Peak's north ridge
];
function ridgeRise(x, y) {
  let best = 0;
  for (const r of RIDGES) {
    for (let i = 1; i < r.line.length; i++) {
      const a = r.line[i - 1], b = r.line[i];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = L.clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy), 0, 1);
      const d = Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
      if (d >= r.half) continue;
      const q = 1 - (d / r.half) ** 2;
      best = Math.max(best, L.lerp(r.rise[i - 1], r.rise[i], t) * q * q);
    }
  }
  return best;
}

function height(x, y) {
  // the valley floor at the mountain's foot: snow meadow, rising to the edges of the world
  let h = 4.5 + 0.018 * Math.abs(x) + 0.008 * (y + 110) + 1.8 * drifts(x, y) + 1.2 * swell(x, y);
  // the mountain: its spine (dead straight across the line of play, ragged out on its flanks),
  // falling away to both sides
  const ragged = L.smoothstep(64, 120, Math.abs(x));
  const body = spineHeight(y + 7 * warpB(x, y) * ragged);
  let level = false;
  if (body > h) {
    const half = 132 + 30 * L.smoothstep(180, 300, y) - 40 * L.smoothstep(560, 740, y);
    const side = 1 - L.smoothstep(half * 0.72, half * 1.5, Math.abs(x + 12) + 16 * swell(y, x));
    h = L.lerp(h, body, side);
    level = side === 1 && LEVELS.includes(body);
  }
  const rise = ridgeRise(x, y);
  h += rise * (0.82 + 0.3 * crags(x, y));
  // the ranges on the horizon: north, and the far corners
  const far = Math.max(L.smoothstep(782, 842, y + 18 * swell(x, y)), L.smoothstep(214, 262, x + 14 * swell(y + 50, x)) * L.smoothstep(380, 560, y),
    L.smoothstep(-208, -246, x + 14 * swell(y, x - 80)) * L.smoothstep(300, 480, y), L.smoothstep(-86, -108, y));
  if (far) h = L.lerp(h, (y < 0 ? 40 : 120) + (y < 0 ? 22 : 70) * crags(x * 0.8, y * 0.8), far);
  h = platform.apply(x, y, h);
  // rock: bands on every face, drifts on the open snow; nothing near mown ground
  const off = offMown(x, y);
  if (off) {
    const cliff = Math.max(platform.cliff(x, y), L.smoothstep(6, 26, rise), 4 * far * (1 - far));
    if (cliff) h = L.lerp(h, L.strata(h + 1.8 * rockNoise(x, y), 8, 0.7), 0.8 * cliff * off);
    h += off * (1 - cliff) * (level ? 0.5 : 0.8) * rockNoise(x + 40, y - 90);
    // outcrops on the banks, out on the flanks (never on the line of play)
    if (!level && body > 7) h += off * 3.2 * crags(x * 1.6, y * 1.6) * L.smoothstep(52, 96, Math.abs(x)) * L.smoothstep(118, 140, y) * (1 - L.smoothstep(690, 720, y));
  }
  // the green; grit in hollows
  const onGreen = L.plateauWeight(x, y, greenApron, 6);
  if (onGreen) h = L.lerp(h, greenPlane(x, y), onGreen);
  for (const b of bunkers) {
    const sand = L.signedDistance(x, y, b);
    if (sand > 0) h -= 0.5 * L.smoothstep(0, 3, sand);
  }
  // the crevasse: a slot down to blue ice, level, its walls INSIDE its outline (so a ball
  // that goes over a lip is in it, and is dropped back on top); the lake at the mountain's foot
  const slot = iceSd(x, y);
  if (slot > 0 && h > ICE) h = L.lerp(h, ICE, L.clamp((slot - 2.5) / 3, 0, 1));   // (level for 2.5 m inside the outline: a drop on the lip stands on flat snow)
  const wet = lakeSd(x, y);
  if (wet > 0) h = L.lerp(h, LAKE, L.clamp((wet - 2.5) / 3, 0, 1));
  return h;
}

// ---- trees: pines on the meadow, clear of the lines of play
const lowGround = (x, y) => platform.on(x, y) < 0 && platform.cliff(x, y) === 0 && lakeSd(x, y) < -14 && y > -84 && y < 112 && Math.abs(x) < 232;
const trees = [
  ...L.scatterTrees(L.rect(-232, -80, -44, 112), { spacing: 20, jitter: 0.45, seed: 91, avoid: mown, clearM: 9, keep: lowGround }),
  ...L.scatterTrees(L.rect(60, -80, 236, 112), { spacing: 21, jitter: 0.45, seed: 92, avoid: mown, clearM: 9, keep: lowGround }),
].map(([x, y], i) => [x, y, 11 + (i % 5) * 1.6, 2.6 + (i % 3) * 0.5]);
const woods = [
  L.roundCorners([[-236, -84], [-156, -84], [-166, 0], [-190, 100], [-236, 110]], 14),
  L.roundCorners([[150, -84], [240, -84], [240, 100], [186, 60]], 14),
];

// ---- props
const props = [];
const lineClear = (x, y, m) => L.distToSegment(x, y, TEE[0], TEE[1], PIN[0], PIN[1]) >= m;
const offPlay = (x, y, m = 3) => mown.every((poly) => L.signedDistance(x, y, poly) < -m);
const P = (kind, x, y, heightM, rotDeg = 0) => {
  const floats = L.FLOATING_PROP_KINDS.includes(kind), spans = L.SPAN_PROP_KINDS.includes(kind);
  if (!floats && !spans && !(offPlay(x, y) && lineClear(x, y, L.SLIM_PROP_KINDS.includes(kind) ? 6 : 9))) return false;
  props.push(L.prop(kind, x, y, { heightM, rotDeg }));
  return true;
};
const toward = (x, y, tx, ty) => L.facing(x, y, tx, ty);

// base camp: the launch platform, cabins, balloons, banners, a statue of the first ascent
P('launch-ramp', -18, 13, 7.5); P('launch-ramp', 18, 13, 7.5);
P('crowd', 0, -16, 3, toward(0, -16, 0, 0));
P('statue', -18, -14, 10, toward(-18, -14, 0, 300));
for (const [x, y, hM] of [[-38, -22, 7], [-30, -46, 6.5], [30, -44, 7], [46, -18, 6.5], [58, -50, 7.5], [-60, -52, 7]]) P('cabin', x, y, hM, toward(x, y, 0, 0));
for (const s of [-1, 1]) {
  P('flag-banner', s * 9, -9, 8, s * 15); P('flag-banner', s * 19, 1, 9, s * 30); P('flag-banner', s * 26, -20, 8, s * 50); P('flag-banner', s * 34, 26, 8, s * 20);
  P('torch', s * 8.5, 7.5, 3.2); P('torch', s * 8.5, -7.5, 3.2);
}
P('balloon', -70, 30, 22); P('balloon', 80, -30, 24); P('balloon', 60, 90, 20);
for (const [x, y] of [[-26, 14], [24, -26], [-48, -34], [52, 6], [-40, 70], [46, 96]]) P('snowman', x, y, 2.6 + ((x + y) % 3) * 0.3, (x * 11) % 360);
P('boat', -112, 58, 5, 30);                                                   // frozen into the lake
// the Summit Express itself: a line of lift towers up the mountain's east side, a station at each end
for (const [x, y, hM] of [[118, 20, 16], [118, 84, 17], [118, 150, 18], [118, 214, 18], [116, 262, 19], [118, 330, 20], [120, 400, 20], [120, 470, 20], [118, 540, 18], [112, 610, 16]]) P('tower', x, y, hM);
P('cabin', 108, -24, 8, toward(108, -24, 118, 60)); P('cabin', 100, 660, 7, toward(100, 660, 20, 640));
// the headwall: igloos and banners on the Shoulder, a frozen fall either side
P('hut', 108, 208, 4, 240); P('hut', 110, 222, 4.2, 270); P('hut', -84, 208, 4, 150); P('hut', -88, 222, 4.4, 120);
P('waterfall', -124, 176, 30, toward(-124, 176, -124, 60)); P('waterfall', 138, 176, 30, toward(138, 176, 138, 60));
for (let y = 132; y <= 252; y += 20) { P('torch', -62, y, 3.2); P('torch', 66, y, 3.2); }
for (const [x, y] of [[-76, 200], [-40, 199], [40, 199], [100, 200], [-76, 228], [100, 228], [-70, 150], [74, 150]]) P('flag-banner', x, y, 7.5, (x * 5 + y) % 360);
// the hanging valley: torches down both sides, banners on the lip, ice in the walls
for (let y = 276; y <= 430; y += 22) { P('torch', -52, y, 3.4); P('torch', 54, y, 3.4); }
for (let y = 446; y <= 540; y += 20) { P('torch', -62, y, 3.4); P('torch', 58, y, 3.4); }
for (const [x, y] of [[-40, 263], [-20, 263], [30, 263], [48, 263], [-52, 440], [56, 440], [-40, 546], [44, 546]]) P('flag-banner', x, y, 8, (x * 7 + y) % 360);
for (const [x, y, hM] of [[-70, 300, 9], [-76, 372, 12], [-80, 440, 14], [74, 310, 8], [78, 384, 10], [80, 452, 11], [-84, 500, 13], [84, 500, 9]]) P('ice-spire', x, y, hM, (x + y * 3) % 360);
for (const [x, y, hM] of [[-64, 336, 4], [-66, 408, 5], [68, 346, 4], [70, 420, 4.5], [-72, 470, 5], [-90, 546, 6], [76, 540, 5]]) P('crystal', x, y, hM, (x * 9 + y) % 360);
P('crowd', -70, 508, 3, toward(-70, 508, 0, 508)); P('snowman', 60, 470, 3, 200); P('snowman', -62, 470, 2.8, 100);
// the crevasse: spires of ice along both lips, a rope bridge near its open end
for (const [x, y, hM] of [[-2, 544, 8], [38, 544, 9], [70, 545, 11], [108, 546, 12], [-4, 601, 8], [58, 601, 10], [96, 601, 12], [140, 544, 13], [142, 602, 14], [-22, 573, 12]]) P('ice-spire', x, y, hM, (x * 3 + y) % 360);
P('bridge', 118, 573, 52, 0);
// the West Col: banners up the bank, a gate at its top
for (const [x, y] of [[-68, 552], [-22, 552], [-68, 580], [-24, 584]]) P('flag-banner', x, y, 8, (x + y) % 360);
P('gate', -84, 606, 12, toward(-84, 606, 20, 640));
// the summit: the hut, banners, a crowd, the cross on the Horn
P('cabin', 74, 664, 7, toward(74, 664, 20, 640));
P('statue', 66, 706, 13, toward(66, 706, 20, 600));
for (let k = 0; k < 14; k++) { const a = (k / 14) * 2 * Math.PI + 0.2; P('flag-banner', 20 + 30 * Math.cos(a), 640 + 28 * Math.sin(a), 8, (k * 51) % 360); }
for (let k = 0; k < 10; k++) { const a = (k / 10) * 2 * Math.PI; P('torch', 20 + 25 * Math.cos(a), 640 + 23 * Math.sin(a), 3.2); }
for (const [x, y] of [[-84, 588], [-90, 640], [-70, 676], [-20, 684], [90, 612], [96, 680]]) P('flag-banner', x, y, 8, (x + y) % 360);
P('crowd', -10, 676, 3.2, toward(-10, 676, 20, 640)); P('crowd', 70, 624, 3, toward(70, 624, 20, 640));
P('snowman', -40, 676, 3, 160); P('snowman', 84, 644, 2.8, 250);
// pines round the camp and on the meadow (props: scenery, not obstacles)
const pineSpots = L.scatterTrees(L.rect(-236, -84, 240, 116), { spacing: 38, jitter: 0.48, seed: 94, keep: (x, y) => lowGround(x, y) && offPlay(x, y, 8) && lineClear(x, y, 22) && woods.every((w) => L.signedDistance(x, y, w) < -4) })
  .filter(([x, y]) => trees.every((t) => Math.hypot(t[0] - x, t[1] - y) > 6));
pineSpots.forEach(([x, y], i) => P('pine', x, y, 10 + (i % 5) * 2, (i * 67) % 360));
// the headwall: a slalom of banners up the snow, pines and ice out on its flanks, snowmen
for (let y = 136, k = 0; y <= 252; y += 19, k++) P('flag-banner', (k % 2 ? 26 : -26), y, 7, k % 2 ? -20 : 20);
const wallSpots = L.scatterTrees(L.rect(-124, 128, 132, 256), { spacing: 23, jitter: 0.48, seed: 95, keep: (x, y) => offPlay(x, y, 8) && lineClear(x, y, 44) && Math.abs(x) < 126 });
wallSpots.forEach(([x, y], i) => { if (i % 5 === 4) P('ice-spire', x, y, 7 + (i % 4) * 2, (i * 37) % 360); else if (i % 5 !== 1) P('pine', x, y, 8 + (i % 5) * 1.6, (i * 67) % 360); });
for (const [x, y] of [[-34, 172], [38, 190], [-40, 240], [36, 246]]) P('snowman', x, y, 2.8, (x * 9) % 360);
for (const [x, y] of [[-30, 446], [34, 448], [-30, 462], [34, 464]]) P('flag-banner', x, y, 7, (x + y) % 360);
// in the air
P('fireworks', 20, 690, 44); P('fireworks', -30, 700, 38); P('fireworks', 70, 676, 40);
P('balloon', -110, 600, 24); P('balloon', 120, 690, 22); P('airship', 180, 420, 26, 190);
P('bird-flock', -80, 300, 9, 40); P('bird-flock', 110, 440, 8, 300); P('bird-flock', -30, 730, 10, 120);
P('cloud', -190, 600, 24); P('cloud', 150, 560, 18); P('cloud', -40, 800, 26); P('cloud', 190, 300, 16); P('cloud', -200, 330, 18); P('cloud', 60, 780, 22);
// needles of ice on the far ranges
for (const [x, y, hM] of [[-420, 640, 150], [-360, 900, 190], [-60, 1040, 230], [300, 960, 200], [470, 620, 160], [-480, 260, 120], [460, 200, 130], [140, 1180, 260]]) P('ice-spire', x, y, hM, (x + y) % 360);

// ---- gadgets (docs/gadgets.md): what a swing can hit
//   ROCKET  coins up the full Rocket's flight, and nothing hangs in its way: the hero carry
//           is the hole. The Headwall Step, a pad on the snow under the valley's lip, throws
//           a Rocket that came up short (struck at about 96 to 102 mph) up into the hanging
//           valley. The valley floor
//           is Blue Ice from its middle on: a Rocket that lands there slides on toward the
//           Bench. Two snowmen stand in the valley (a ball goes through one for coins).
//   RISKY   the Ice Ramp, a pad at the Bench's far edge, throws a ball that reaches it over
//           the crevasse onto the summit, short of the green.
const expressRocket = L.flight(height, TEE, PIN, { speedMph: 125, vla: 13, spin: 2600, ball: 'rocket' });
const gadgets = [
  L.gadget('pad', 'headwall-step', 7, 240, { radius: 8, heading: L.bearing(TEE, PIN), angle: 58, minMps: 25, maxMps: 25 }),
  L.gadget('ice', 'blue-ice', 2, 388, { size: [70, 76], heading: 0, friction: 0.6 }),
  L.gadget('breakable', 'snowman-west', -30, 330, { radius: 2.4, height: 5, breakMph: 100, keep: 1, style: 'snowman' }),
  L.gadget('breakable', 'snowman-east', 34, 356, { radius: 2.4, height: 5, breakMph: 100, keep: 1, style: 'snowman' }),
  L.gadget('pad', 'ice-ramp', 14, 534, { radius: 6, heading: L.bearing([14, 534], [20, 616]), angle: 50, minMps: 38, maxMps: 38 }),
  expressRocket.coins('express-coins', 80, 330, 7),
];

module.exports = {
  id: 'summit-express',
  stage: {
    number: 12, role: 'match', order: 12,
    name: 'Summit Express', theme: 'alpine',
    origin: { lat: 52.5, lon: -164.0 },          // open North Pacific
    conditions: 'windy',
    wind: { min: 10, max: 22 },                  // an exposed mountain; the headwall's lip is set close so a Rocket still makes it
    baseM: 2100,
    timeOfDay: 'day',
    blurb: 'Rocket par 5 up a mountain: the headwall, a hanging valley, a crevasse, the summit.',
    difficulty: 3,
    freeBall: 'rocket',
  },
  extent: { minX: -250, minY: -110, maxX: 270, maxY: 850 },
  hole: {
    par: 5,
    name: 'Summit Express',
    line: LINE,
    note: 'A rocket par 5, 70 metres up. The free Rocket ball climbs the headwall into the hanging valley (285 yards of carry, 44 metres up); a huge one, or one with the wind behind it, reaches the Bench. Then choose: over the crevasse at the flag, or left up the West Col.',
    greenNote: 'On the summit, tilted gently to the front right. The crevasse is 25 metres short of the green; grit bunkers right and long.',
    routes: [
      { id: 'safe', name: 'The Snow Zigzag', note: 'From the Bench, left up the West Col round the head of the crevasse, then across the summit. No carry.' },
      { id: 'risky', name: 'Leap the Crevasse', note: 'From the Bench or the valley, straight over the ice at the flag. Short is gone.' },
      { id: 'rocket', name: 'The Express', note: 'The free Rocket up the headwall into the hanging valley; a huge one reaches the Bench.' },
    ],
  },
  surfaces: [
    { kind: 'tee', poly: tee },
    ...fairways.map((poly) => ({ kind: 'fairway', poly })),
    { kind: 'green', poly: green },
    ...bunkers.map((poly) => ({ kind: 'bunker', poly })),
    { kind: 'water', poly: crevasse },
    { kind: 'water', poly: lake },
  ],
  trees,
  woods,
  props,
  gadgets,
  // wide round base camp; up the mountain the line runs just beyond the two aretes' crests and
  // behind the summit: a ball that goes over one is dropped on the crest, looking down at the hole
  obLine: [[-240, -98], [258, -98], [258, 120], [176, 196], [112, 262], [110, 340], [114, 430], [116, 520], [126, 600], [118, 700], [60, 728],
    [-70, 722], [-166, 690], [-176, 620], [-150, 566], [-138, 520], [-120, 430], [-112, 340], [-106, 262], [-170, 196], [-240, 120]],
  height,
  sea: false,
  probes: [
    { at: [0, 80], kind: 'fairway', what: 'the meadow' },
    { at: [0, 213], kind: 'fairway', what: 'the Shoulder, on the direct line' },
    { at: [8, 300], kind: 'fairway', what: 'the hanging valley, where a 110 mph Rocket lands' },
    { at: [10, 420], kind: 'fairway', what: 'the far end of the hanging valley' },
    { at: [0, 516], kind: 'fairway', what: 'the Bench' },
    { at: [-52, 606], kind: 'fairway', what: 'the top of the West Col' },
    { at: [-12, 632], kind: 'fairway', what: 'the summit, left of the green' },
    { at: [18, 612], kind: 'fairway', what: 'the landing beyond the crevasse' },
    { at: [47, 646], kind: 'bunker', what: 'the bunker right of the green' },
    { at: [16, 667], kind: 'bunker', what: 'the bunker behind the green' },
    { at: [12, 574], kind: 'water', what: 'the crevasse, on the line to the flag' },
    { at: [120, 574], kind: 'water', what: 'the crevasse, toward the east face' },
    { at: [12, 595], kind: 'water', what: "the crevasse's far wall" },
    { at: [-112, 60], kind: 'water', what: 'the frozen lake' },
    { at: [-45, 566], kind: 'rough', what: 'the West Col' },
    { at: [4, 160], kind: 'rough', what: 'the headwall below the Shoulder' },
    { at: [6, 244], kind: 'rough', what: 'the headwall below the hanging valley' },
    { at: [8, 454], kind: 'rough', what: 'the bank up to the Bench' },
    { at: [-86, 380], kind: 'rough', what: 'the west arete' },
    { at: [84, 380], kind: 'rough', what: 'the east arete' },
    { at: [12, 546], kind: 'rough', what: 'the lip of the crevasse' },
    { at: [60, 60], kind: 'rough', what: 'the meadow right of the fairway' },
    { at: [-160, 400], kind: 'ob', what: 'over the west arete' },
    { at: [150, 400], kind: 'ob', what: 'over the east arete' },
    { at: [0, 760], kind: 'ob', what: 'behind the summit' },
  ],
};
