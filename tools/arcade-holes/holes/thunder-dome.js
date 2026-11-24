'use strict';
// Thunder Dome: par 3, 140 yd, a tiebreak arena. One ball each, closest to the pin wins,
// so nothing is hidden and nothing is wet. A real stadium: the tee is a stage at the mouth
// of the players' tunnel, ten metres above the pitch; the pitch is a mown oval with one
// big level green at its far end and scoring rings painted round the flag; and the stands
// are TERRAIN, five terraces stepping up twenty metres all the way round, a block of crowd
// on every step, roofed grandstands and floodlights on the rim, screens behind the green.
// Miss the green and the ball is on the pitch (or in one of two bunkers); miss the pitch
// and it is on a terrace among the fans. Out of bounds only out in the city beyond the streets.
// Local metres, x east, y north; the tee is the origin and the hole plays due north.
// Heights are metres above the lowest point of the pitch (the pitch is about 1 m).

const L = require('../lib');

const RAD = Math.PI / 180;
const TEE = [0, 0];
const PIN = [0, 128];                                     // 140 yd
const MID = [0, 90];                                      // the middle of the bowl
const BOWL = [56, 84];                                    // the arena floor's radii: the stands start here

// ---- the stands, as steps of ground. d: metres outside the floor's edge.
const WALL_M = 2.6;                                       // the pitch wall
const TIER = { n: 5, depthM: 8, riseM: 3.6, riserM: 2.2 };   // five terraces, each 8 m deep and 3.6 m up
const CONCOURSE_D = TIER.n * TIER.depthM;                 // 40 m out: the rim the grandstands stand on
const RIM_M = 18;                                         // the rim is 18 m wide, then the ground falls away outside
const STAGE_H = 12;                                     // the tee stage and the tunnel floor
const tierD = (k) => k * TIER.depthM + TIER.riserM + (TIER.depthM - TIER.riserM) / 2;   // the middle of terrace k
const tierH = (k) => 1 + WALL_M + k * TIER.riseM;
const RIM_H = tierH(TIER.n);

// ---- surfaces
const floor = L.ellipse(MID[0], MID[1], BOWL[0], BOWL[1], { n: 96 });
const tee = L.rect(-8, -5, 8, 5);
const stage = L.blob(0, -1, 21, 12, { wobble: 0.03, seed: 2 });              // the tee stage
const tunnel = L.rect(-8, -84, 8, 2);                                        // the players' tunnel, cut through the south stand
const pitch = L.ellipse(0, 98, 44, 68, { n: 64 });        // the mown arena floor
const green = L.blob(0, 128, 20, 19, { wobble: 0.03, seed: 4 });             // 40 x 38 m
const greenApron = L.offsetPolygon(green, 4);
const bunkers = [
  L.blob(-28, 106, 6, 9.5, { wobble: 0.08, seed: 12, rotDeg: -25 }),         // front left
  L.blob(28, 148, 6, 9.5, { wobble: 0.08, seed: 13, rotDeg: -25 }),          // back right
];

// ---- ground
const turf = L.fbm({ seed: 2201, scaleM: 50, octaves: 2 });
const outside = L.fbm({ seed: 2202, scaleM: 70, octaves: 3 });
const greenPlane = L.plane(1.35, PIN, 0.004, 0.006);      // 0.7 %: level, a hand higher than the pitch

function height(x, y) {
  const d = -L.signedDistance(x, y, floor);               // metres outside the floor
  let h = 1 + 0.12 * turf(x, y);
  if (d > 0) {
    // the pitch wall, then the terraces: flat steps, so the crowd stands level
    h = 1 + WALL_M * L.smoothstep(0, TIER.riserM, d);
    for (let k = 1; k <= TIER.n; k++) h += TIER.riseM * L.smoothstep(k * TIER.depthM, k * TIER.depthM + TIER.riserM, d);
    // behind the rim the ground falls to the streets outside
    const out = L.smoothstep(CONCOURSE_D + RIM_M, CONCOURSE_D + RIM_M + 26, d);
    if (out) h = L.lerp(h, 9 + 1.6 * outside(x, y), out);
  }
  const onGreen = L.plateauWeight(x, y, greenApron, 10);
  if (onGreen) h = L.lerp(h, greenPlane(x, y), onGreen);
  // the tee: a stage jutting out of the south stand, and the tunnel that leads to it
  const cut = Math.max(L.plateauWeight(x, y, stage, 6), L.plateauWeight(x, y, tunnel, 3));
  if (cut) h = L.lerp(h, STAGE_H, cut);
  for (const b of bunkers) {
    const sand = L.signedDistance(x, y, b);
    if (sand > 0) h -= 0.35 * L.smoothstep(0, 4, sand);
  }
  return h;
}

// ---- where things stand
// the point d metres outside the floor's edge at angle deg (0 east, 90 north), and the
// bearing that faces the middle from there
const ring = (d, deg) => {
  const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD);
  const n = Math.hypot(c / BOWL[0], s / BOWL[1]);
  return [MID[0] + BOWL[0] * c + d * (c / BOWL[0]) / n, MID[1] + BOWL[1] * s + d * (s / BOWL[1]) / n];
};
// points every stepM along the ring d metres out (never a part-step left over)
const along = (d, stepM, offset = 0) => {
  const fine = [];
  for (let deg = 0; deg < 360; deg += 0.25) fine.push([deg, ...ring(d, deg)]);
  let total = 0;
  const cum = fine.map((p, i) => { if (i) total += Math.hypot(p[1] - fine[i - 1][1], p[2] - fine[i - 1][2]); return total; });
  total += Math.hypot(fine[0][1] - fine[fine.length - 1][1], fine[0][2] - fine[fine.length - 1][2]);
  const count = Math.floor(total / stepM), step = total / count;
  const out = [];
  for (let i = 0, k = 0; i < count; i++) {
    const at = ((i + offset) * step) % total;
    while (k < cum.length - 1 && cum[k + 1] <= at) k++;
    if (cum[k] > at) k = 0;
    out.push({ deg: fine[k][0], x: fine[k][1], y: fine[k][2] });
  }
  return out;
};
const P = (kind, x, y, heightM, rotDeg = 0) => L.prop(kind, x, y, { heightM, rotDeg });
const inward = (x, y) => L.facing(x, y, ...ring(-20, Math.atan2((y - MID[1]) / BOWL[1], (x - MID[0]) / BOWL[0]) / RAD));
const nearTunnel = (x, y, clearM) => y < 30 && Math.abs(x) < clearM;         // the stage and the tunnel stay open
const props = [
  // the scoring rings round the flag (heightM is the DIAMETER): 3, 7, 12 and 18 m out
  ...[6, 14, 24, 36].map((d) => P('target-ring', PIN[0], PIN[1], d)),
];

// the crowd: a block on every terrace, all the way round, shoulder to shoulder
for (let k = 0; k < TIER.n; k++) {
  for (const { x, y } of along(tierD(k), 23.5, k % 2 ? 0.5 : 0)) {
    if (nearTunnel(x, y, k < 3 ? 36 : 21)) continue;      // the stage juts through the three lower terraces
    props.push(P('crowd', x, y, 5.5, inward(x, y)));
  }
}
// roofed grandstands on the rim, but for the three screens behind the green and the tunnel
const SCREENS = [62, 90, 118];
for (const { deg, x, y } of along(CONCOURSE_D + 8, 27)) {
  if (nearTunnel(x, y, 22) || SCREENS.some((s) => Math.abs(deg - s) < 9)) continue;
  props.push(P('grandstand', x, y, 15, inward(x, y)));
}
for (const deg of SCREENS) {
  const [x, y] = ring(CONCOURSE_D + 7, deg);
  props.push(P('jumbotron', x, y, deg === 90 ? 24 : 19, L.facing(x, y, 0, 40)));
}
// two more screens on the long sides, for the crowd behind the tee
for (const deg of [4, 176]) { const [x, y] = ring(CONCOURSE_D + 15, deg); props.push(P('jumbotron', x, y, 15, L.facing(x, y, 0, 20))); }
// the floodlight ring, behind the grandstands
for (let i = 0; i < 14; i++) {
  const [x, y] = ring(CONCOURSE_D + 16.5, i * (360 / 14) + 12.86);
  if (!nearTunnel(x, y, 12)) props.push(P('floodlight', x, y, 46, inward(x, y)));
}
// flags all round the rim's front edge, and round the foot of the pitch wall
for (const { x, y } of along(CONCOURSE_D + 1.2, 20, 0.5)) if (!nearTunnel(x, y, 14)) props.push(P('flag-banner', x, y, 9, inward(x, y)));
for (const { x, y } of along(-3, 24)) if (!nearTunnel(x, y, 26)) props.push(P('flag-banner', x, y, 6, inward(x, y)));
// pitch side: neon boards at the four corners, flame jets beside the green
for (const deg of [38, 142, 218, 322]) { const [x, y] = ring(-5, deg); props.push(P('neon-sign', x, y, 7, inward(x, y))); }
for (const deg of [36, 74, 106, 144]) { const [x, y] = ring(-4.5, deg); props.push(P('torch', x, y, 5)); }
props.push(
  // the tee stage: the tunnel mouth behind the players, trophies either side, fire at the corners
  P('gate', 0, -24, 13, L.facing(0, -24, 0, 0)),
  P('statue', -15.5, -3, 9, L.facing(-15.5, -3, 0, 60)), P('statue', 15.5, -3, 9, L.facing(15.5, -3, 0, 60)),
  P('torch', -11, 8, 4), P('torch', 11, 8, 4), P('torch', -19, 2, 4), P('torch', 19, 2, 4),
  ...[-38, -52, -66].flatMap((y) => [P('flag-banner', -6.5, y, 7, 90), P('flag-banner', 6.5, y, 7, 270)]),
  P('torch', -6, -30, 3.5), P('torch', 6, -30, 3.5),
  // overhead: fireworks over the north stand, an airship and a blimp circling
  P('fireworks', -72, 238, 40), P('fireworks', -30, 252, 55), P('fireworks', 18, 256, 48), P('fireworks', 64, 242, 42),
  P('fireworks', -118, 150, 36), P('fireworks', 120, 164, 38),
  P('airship', -64, 176, 30, 70), P('blimp', 58, 60, 28, 120), P('balloon', -110, 40, 20), P('balloon', 104, 214, 22),
);
// the city outside: towers over the north and the long sides, seen above the stands
[[-150, 300, 120], [-70, 330, 170], [20, 345, 210], [110, 320, 140], [180, 270, 100], [-200, 220, 90], [205, 170, 115],
  [-215, 110, 130], [215, 60, 85], [-190, -10, 105], [185, -40, 95], [-110, -130, 120], [100, -140, 140]]
  .forEach(([x, y, h], i) => props.push(P('skyscraper', x, y, h, (i * 37) % 90)));

// a few trees on the streets outside the stadium (never between the tee and the flag)
const trees = [
  ...L.clusterTrees(-104, -42, { count: 4, radius: 9, seed: 221 }),
  ...L.clusterTrees(104, -42, { count: 4, radius: 9, seed: 222 }),
  ...L.clusterTrees(-106, 224, { count: 4, radius: 9, seed: 223 }),
  ...L.clusterTrees(106, 224, { count: 4, radius: 9, seed: 224 }),
];

module.exports = {
  id: 'thunder-dome',
  stage: {
    number: 22, role: 'tiebreak', order: 2,
    name: 'Thunder Dome', theme: 'stadium',
    origin: { lat: 33.0, lon: -146.0 },
    conditions: 'calm',
    wind: { min: 0, max: 6 },                    // the bowl keeps most of it out
    timeOfDay: 'night',
    blurb: 'Sudden death under the lights. Out of the tunnel, 140 yards, a full house.',
    difficulty: 1,
  },
  extent: { minX: -176, minY: -126, maxX: 176, maxY: 306 },
  hole: {
    par: 3,
    name: 'Thunder Dome',
    line: [TEE, PIN],
    note: 'Out of the tunnel onto a stage ten metres above the pitch: 140 yards to the middle of a big level green, playing a club less. No water, nowhere to hide. The rings are 3, 7, 12 and 18 metres from the flag.',
    greenNote: 'Forty metres across and all but level. A bunker front left, another back right.',
  },
  surfaces: [
    { kind: 'tee', poly: tee },
    { kind: 'fairway', poly: pitch },
    { kind: 'green', poly: green },
    ...bunkers.map((poly) => ({ kind: 'bunker', poly })),
  ],
  trees,
  woods: [],
  props,
  // out on the streets, well behind the grandstands: even a driver over the top stand is found
  obLine: L.ellipse(MID[0], MID[1], BOWL[0] + CONCOURSE_D + RIM_M + 32, BOWL[1] + CONCOURSE_D + RIM_M + 32, { n: 64 }),
  height,
  sea: false,
  probes: [
    { at: [0, 60], kind: 'fairway', what: 'the pitch short of the green' },
    { at: [0, 154], kind: 'fairway', what: 'the pitch behind the green' },
    { at: [-30, 128], kind: 'fairway', what: 'the pitch left of the green' },
    { at: [30, 128], kind: 'fairway', what: 'the pitch right of the green' },
    { at: [-28, 106], kind: 'bunker', what: 'the front left bunker' },
    { at: [28, 148], kind: 'bunker', what: 'the back right bunker' },
    { at: [-17, 128], kind: 'green', what: 'the left of the green, 17 m from the flag' },
    { at: [0, 145], kind: 'green', what: 'the back of the green' },
    { at: [-62, 90], kind: 'rough', what: 'the first terrace of the west stand' },
    { at: [62, 90], kind: 'rough', what: 'the first terrace of the east stand' },
    { at: [0, 200], kind: 'rough', what: 'the north stand behind the green: long is still in play' },
    { at: [0, 20], kind: 'rough', what: 'the foot of the tee stage' },
    { at: [-126, 90], kind: 'rough', what: 'the street outside the west stand: still in play' },
    { at: [-172, 90], kind: 'ob', what: 'the city beyond it' },
    { at: [0, 300], kind: 'ob', what: 'far over the north stand' },
  ],
  // for the tests and the look: how the stands are built
  arena: { mid: MID, bowl: BOWL, wallM: WALL_M, tier: TIER, concourseD: CONCOURSE_D, rimM: RIM_M, stageH: STAGE_H, tierD, tierH, rimH: RIM_H },
};
