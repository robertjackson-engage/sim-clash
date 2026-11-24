'use strict';
// Bullseye Bay: tiebreak arena, par 3, 115 yd, 26 m down. One ball each, nearest the flag
// wins, so nothing is hidden: the tee is a ledge on the rim of a drowned volcanic caldera,
// thirty metres above a turquoise bay, and the green is a round island bullseye 40 m across
// in the middle of it, target rings painted round the flag. A ring of beach round the green
// plays as sand, so a near miss still counts; everything beyond the beach is the bay.
// The caldera is real ground all the way round: cliffs, a jagged crest with two horns
// either side of the mouth (open to the sea in the north, sea stacks across it), a beach
// village in the west cove, a spectators' terrace cut into the east wall, waterfalls, a
// lighthouse on the north-east horn, and a fleet of boats moored round the island.
// Local metres, x east, y north; the tee is the origin and the hole plays due north.
// Heights are metres above the sea (the sea is exactly 0, see docs/arcade-holes.md).

const L = require('../lib');

const RAD = Math.PI / 180;
const TEE = [0, 0];
const PIN = [0, 105.2];                        // 115 yd, the centre of the island
const TEE_H = 30;                              // the tee ledge, above the sea
const GREEN_R = 20;                            // the green: 40 m across
const TOP_R = 24.5;                            // the level top of the island
const BEACH_R = 35;                            // the beach falls gently from the top to here
const SHORE_R = 39.5;                          // and into the sea by here
const C = [0, 112];                            // the middle of the caldera
const MOUTH = 90;                              // the bearing of the gap in the wall (north), degrees
const BENCH_H = 12;                            // the spectators' terrace in the east wall

const round = (deg, r) => [PIN[0] + r * Math.cos(deg * RAD), PIN[1] + r * Math.sin(deg * RAD)];
// a circle's points on the axes come out as 1e-15, not 0: snap them, so nothing rounds to -0
const snap = (poly) => poly.map(([x, y]) => [Math.abs(x) < 1e-9 ? 0 : x, Math.abs(y) < 1e-9 ? 0 : y]);
// 1 at 0, falling smoothly to exactly 0 at |t| = 1
const bell = (t) => { const a = Math.abs(t); return a >= 1 ? 0 : (1 - a * a) * (1 - a * a); };
// the difference between two bearings, -180..180
const turn = (a, b) => ((a - b + 540) % 360) - 180;

// ---- the caldera, in polar coordinates round C (deg: 0 east, 90 north)
const footN = L.fbm({ seed: 801, scaleM: 46, octaves: 3 });
const cliffN = L.fbm({ seed: 802, scaleM: 52, octaves: 2 });
const crestN = L.fbm({ seed: 803, scaleM: 36, octaves: 3 });
const rockN = L.fbm({ seed: 804, scaleM: 17, octaves: 3 });
const rollN = L.fbm({ seed: 805, scaleM: 70, octaves: 3 });
const onCircle = (n, deg, r = 100) => n(r * Math.cos(deg * RAD), r * Math.sin(deg * RAD));
// the foot of the inner cliff: a wobbling circle, pulled in under the tee (a promontory)
const footR = (deg) => L.lerp(113 + 8 * onCircle(footN, deg), 100, bell(turn(deg, -90) / 17));
// the beach shelf in the west cove: how far the dry land runs out from the cliff's foot
const shelfW = (deg) => 36 * L.smoothstep(42, 25, Math.abs(turn(deg, 183)));
// the east wall is cut by a terrace (0..1: how much of one there is at this bearing)
const benchAt = (deg) => L.smoothstep(40, 30, Math.abs(turn(deg, -4)));
// the wall stops at the mouth of the bay
const wallAt = (deg) => L.smoothstep(27, 41, Math.abs(turn(deg, MOUTH)));
const cliffH = (deg) => L.lerp(31 + 8 * onCircle(cliffN, deg), TEE_H, bell(turn(deg, -90) / 24));
// the crest above the cliff: a ragged ridge with horns either side of the mouth, a summit over the village
const crestH = (deg) => 12 + 9 * onCircle(crestN, deg, 140) + 26 * bell(turn(deg, 47) / 15) + 23 * bell(turn(deg, 134) / 14) +
  17 * bell(turn(deg, 200) / 20) + 12 * bell(turn(deg, -40) / 16);

// sea stacks: sharp cones (too steep to stand a ball on: all penalty area). [x, y, radius, height]
const stacks = [
  [-44, 236, 9, 19], [-12, 250, 6, 11], [26, 240, 10, 24], [52, 256, 6, 13], [-70, 262, 7, 15], [8, 284, 8, 17],
  [-92, 150, 5, 8], [96, 196, 6, 11], [-30, 318, 9, 21], [70, 322, 7, 14],
];

// the tee's ledge: level where the players stand and either side of them, the lip of the cliff a metre in
// front of the ball, and the ground climbing behind it: the camera stands up there, 14 m back, and looks
// down over the ball at the whole island
const ledgeW = (x, y) => (1 - L.smoothstep(21, 29, Math.abs(x))) * (1 - L.smoothstep(1, 3.5, y)) * (1 - L.smoothstep(-21, -31, y));
const ledgeH = (x, y) => TEE_H + 0.5 * L.clamp(-4 - y, 0, 14) * (1 - L.smoothstep(7, 12, Math.abs(x)));
const greenPlane = L.plane(3.5, PIN, 0, -0.008);                            // 0.8 %, tilted to face the tee

function height(x, y) {
  const dx = x - C[0], dy = y - C[1];
  const r = Math.hypot(dx, dy), deg = Math.atan2(dy, dx) / RAD;
  let h = 0;
  const wall = wallAt(deg);
  if (wall) {
    const s = r - footR(deg);                  // metres outside the foot of the cliff
    const shelf = shelfW(deg);
    if (s > 0) {
      // the cliff (in two lifts where the terrace is cut into it), then the crest, then the outer flank
      const top = cliffH(deg), bench = benchAt(deg);
      const oneLift = top * L.smoothstep(0, 13, s);
      const twoLifts = BENCH_H * L.smoothstep(0, 7, s) + (top - BENCH_H) * L.smoothstep(24, 35, s);
      h = L.lerp(oneLift, twoLifts, bench);
      const back = L.smoothstep(10 + 22 * bench, 30 + 22 * bench, s);
      h += back * (crestH(deg) * bell((s - 52 - 10 * bench) / 46) + 3.2 * rollN(x, y) + 1.5 * rockN(x, y));
      // rock bands: the crest steps rather than rolls
      const band = 7;
      h = L.lerp(h, Math.round(h / band) * band, 0.3 * back);
      h *= wall * (1 - L.smoothstep(78, 132, s));
    }
    if (shelf > 1 && s > -shelf) {
      // the cove: a beach rising out of the water to a village terrace under the cliff
      const out = s + shelf;                   // metres up the beach from the waterline
      const beach = 2.3 * L.smoothstep(0, 9, out) + 2.4 * L.smoothstep(9, 15, out) + 0.25 * rollN(x * 2, y * 2) * L.smoothstep(12, 18, out);
      h = Math.max(h, beach * L.smoothstep(1, 12, shelf));
    }
  }
  // the tee: a ledge on the rim
  const ledge = ledgeW(x, y);
  if (ledge) h = L.lerp(h, ledgeH(x, y), ledge);
  // the island: a level top, a beach falling gently away from it, then the sea
  const ri = Math.hypot(x - PIN[0], y - PIN[1]);
  if (ri < SHORE_R) {
    const topH = greenPlane(x, y);
    const sand = L.lerp(topH, 1.5, L.clamp((ri - TOP_R) / (BEACH_R - TOP_R), 0, 1));
    h = Math.max(h, sand * (1 - L.smoothstep(BEACH_R, SHORE_R, ri)));
  }
  for (const [cx, cy, rad, top] of stacks) {
    const d = Math.hypot(x - cx, y - cy);
    if (d < rad) h = Math.max(h, top * Math.pow(1 - d / rad, 1.15));
  }
  return h;
}
// the ground's slope, for keeping trees and people off the cliffs
const steep = (x, y) => Math.hypot(height(x + 2, y) - height(x - 2, y), height(x, y + 2) - height(x, y - 2)) / 4;
// a point on the caldera: deg round C, s metres outside the cliff's foot
const at = (deg, s) => { const r = footR(deg) + s; return [C[0] + r * Math.cos(deg * RAD), C[1] + r * Math.sin(deg * RAD)]; };
const standable = (x, y) => height(x, y) > 6 && steep(x, y) < 0.4;

// ---- surfaces
const tee = L.rect(-6, -6, 6, 1.5);                 // the ball is a metre and a half from the lip
const green = snap(L.ellipse(PIN[0], PIN[1], GREEN_R, GREEN_R, { n: 56 }));
const beach = L.ring(PIN[0], PIN[1], GREEN_R + 3.5, BEACH_R, { pieces: 4, n: 64 }).map(snap);   // four wedges of sand

// palms over the crest and the outer flanks (the look stream draws the trees as palms)
const groves = L.fbm({ seed: 811, scaleM: 55, octaves: 2 });
const trees = L.scatterTrees(L.ellipse(C[0], C[1], 236, 236, { n: 48 }), {
  spacing: 17, seed: 81, clearM: 0,
  keep: (x, y) => Math.hypot(x - C[0], y - C[1]) > 118 && groves(x, y) > -0.12 && standable(x, y) && !(Math.abs(x) < 34 && y < 14 && y > -44),
});

// ---- props
const P = (kind, x, y, heightM, rotDeg = 0) => L.prop(kind, x, y, { heightM, rotDeg });
const toPin = (x, y) => L.facing(x, y, PIN[0], PIN[1]);
const props = [
  // the bullseye: rings on the green round the flag (heightM is a ring's diameter)
  ...[38, 30, 22, 14, 6].map((d) => P('target-ring', PIN[0], PIN[1], d)),
  // palms on the fringe between the green and the beach
  ...[[42, 8.5, 70], [68, 10, 160], [112, 9.5, 250], [138, 8, 340], [20, 9, 20], [160, 8.5, 110]].map(([a, h, rot]) => P('palm', ...round(a, GREEN_R + 1.8), h, rot)),
];

// the tee ledge: tiki torches and flags at the edge, the starter's huts and the gallery behind
props.push(
  // (nothing tall within 14 m of the ball's line: the address camera looks straight down it at the island)
  P('tiki', -16, 0, 4.5, 20), P('tiki', 16, 0, 4.5, 340), P('tiki', -13, -14, 4, 60), P('tiki', 13, -14, 4, 300),
  P('flag-banner', -21, -1, 7, 0), P('flag-banner', 21, -1, 7, 0),
  P('hut', -17, -17, 6.5, L.facing(-17, -17, 0, 0)), P('hut', 17, -18, 6, L.facing(17, -18, 0, 0)),
  P('crowd', -15, -7, 2.6, L.facing(-15, -7, -15, 40)), P('crowd', 15, -7, 2.6, L.facing(15, -7, 15, 40)),
  P('idol', -30, -22, 10, L.facing(-30, -22, 0, 60)),
  P('palm', -23, -4, 10, 20), P('palm', 23, -5, 9, 200), P('palm', -25, -13, 11, 95), P('palm', 25, -14, 10, 310),
  P('palm', -12, -26, 9, 150), P('palm', 11, -29, 10, 260), P('palm', -36, -30, 12, 40), P('palm', 34, -32, 11, 170),
  P('torch', -10, -19, 3, 0), P('torch', 10, -19, 3, 0),
);

// the beach village in the west cove
const cove = (deg, up) => at(deg, up - shelfW(deg));   // `up` metres up the beach from the waterline
props.push(
  // huts along the back of the terrace, under the cliff
  ...[[160, 27, 6], [168, 30, 7], [176, 31, 6.5], [184, 32, 7.5], [192, 31, 6.5], [200, 29, 7], [208, 26, 6]]
    .map(([deg, up, h]) => { const [x, y] = cove(deg, up); return P('hut', x, y, h, toPin(x, y)); }),
  // a line of tiki torches at the top of the beach, a bonfire ring of them by the big hut
  ...[158, 166, 174, 182, 190, 198, 206, 212].map((deg) => { const [x, y] = cove(deg, 17); return P('tiki', x, y, 4.2, toPin(x, y)); }),
  // the gallery on the sand terrace, facing the green
  ...[170, 180, 190, 200].map((deg) => { const [x, y] = cove(deg, 21); return P('crowd', x, y, 3.4, toPin(x, y)); }),
  ...[163, 175, 185, 195, 205].map((deg) => { const [x, y] = cove(deg, 15.5); return P('flag-banner', x, y, 7.5, toPin(x, y)); }),
  // palms leaning over the huts
  ...[[156, 24, 11], [164, 33, 12], [172, 26, 10], [180, 34, 13], [188, 26, 11], [196, 34, 12], [204, 24, 10], [212, 22, 11], [178, 19, 9], [194, 19, 9.5]]
    .map(([deg, up, h], i) => { const [x, y] = cove(deg, up); return P('palm', x, y, h, i * 67); }),
  // a pier out into the bay (heightM is its length) with boats moored at it, more pulled up on the sand
  (() => { const [x, y] = cove(183, -9); return P('bridge', x, y, 26, 90); })(),
  ...[[178, -14, 5.5, 200], [188, -15, 6.5, 20], [183, -26, 7, 110]].map(([deg, up, h, rot]) => { const [x, y] = cove(deg, up); return P('boat', x, y, h, rot); }),
  ...[[166, 5, 4, 70], [171, 6, 4.5, 95], [199, 5, 4, 290]].map(([deg, up, h, rot]) => { const [x, y] = cove(deg, up); return P('boat', x, y, h, rot); }),
);

// the spectators' terrace cut into the east wall
props.push(
  ...[-26, -15, -4, 7, 18].map((deg) => { const [x, y] = at(deg, 17); return P('crowd', x, y, 3.6, toPin(x, y)); }),
  ...[-31, -20, -9, 2, 13, 24].map((deg) => { const [x, y] = at(deg, 9.5); return P('flag-banner', x, y, 8, toPin(x, y)); }),
  ...[[-28, 21, 9], [-10, 22, 10], [8, 22, 9.5], [22, 21, 10.5]].map(([deg, s, h], i) => { const [x, y] = at(deg, s); return P('palm', x, y, h, i * 83); }),
  (() => { const [x, y] = at(-21, 20); return P('hut', x, y, 6, toPin(x, y)); })(),
  ...[-12, 4, 20].map((deg) => { const [x, y] = at(deg, 11); return P('tiki', x, y, 4, toPin(x, y)); }),
);

// waterfalls down the cliffs (heightM: the height of the fall), their feet in the bay
for (const deg of [146, 38, 222, -52]) {
  const [x, y] = at(deg, 4);
  props.push(P('waterfall', x, y, Math.round(cliffH(deg) * wallAt(deg)) - 2, L.facing(x, y, C[0], C[1])));
}
// the spectator fleet: boats moored round the island, bows to the green, clear of the shot
for (const [deg, r, h] of [[-58, 62, 6], [-38, 70, 8], [-14, 60, 5.5], [10, 68, 7.5], [34, 61, 6], [58, 72, 9], [122, 70, 7], [146, 60, 6],
  [170, 58, 5], [200, 62, 7.5], [224, 70, 6], [240, 67, 8.5], [84, 78, 11], [100, 64, 6]]) {
  const [x, y] = round(deg, r);
  props.push(P('boat', x, y, h, toPin(x, y)));
}
props.push(
  // a wreck on the reef under the east wall, an arch and spires at the mouth of the bay
  P('shipwreck', 78, 190, 14, 40),
  P('rock-arch', -22, 268, 24, 80),
  P('rock-spire', 44, 272, 30, 10), P('rock-spire', -62, 236, 22, 120), P('rock-spire', 84, 250, 18, 200), P('rock-spire', -100, 300, 26, 300),
  P('rock-spire', 20, 330, 34, 60), P('rock-spire', 128, 316, 24, 140), P('rock-spire', -150, 330, 20, 250),
  // the lighthouse on the north-east horn, a great stone idol on the north-west one
  (() => { const [x, y] = at(47, 50); return P('lighthouse', x, y, 34, toPin(x, y)); })(),
  (() => { const [x, y] = at(134, 50); return P('statue', x, y, 22, toPin(x, y)); })(),
  // old stones on the crest above the village, a giant banyan beside them, ships standing off the mouth
  (() => { const [x, y] = at(168, 44); return P('ruins', x, y, 12, toPin(x, y)); })(),
  (() => { const [x, y] = at(216, 40); return P('ruins', x, y, 9, toPin(x, y)); })(),
  (() => { const [x, y] = at(190, 52); return P('giant-tree', x, y, 30, 0); })(),
  (() => { const [x, y] = at(-42, 44); return P('idol', x, y, 13, toPin(x, y)); })(),
  P('boat', -60, 300, 15, 100), P('boat', 44, 306, 13, 250), P('boat', 110, 280, 11, 200),
  // the volcano the caldera's big sister, far out to sea
  P('volcano', -420, 760, 150, 0),
  // overhead
  P('balloon', -84, 170, 22, 0), P('balloon', 110, 236, 20, 120), P('balloon', 64, 30, 21, 40), P('balloon', -150, 60, 19, 200),
  P('blimp', -40, 300, 26, 250),
  P('bird-flock', -58, 192, 14, 30), P('bird-flock', 98, 112, 12, 300), P('bird-flock', -110, 240, 16, 100), P('bird-flock', 30, 280, 15, 200), P('bird-flock', 130, 20, 12, 60),
  P('cloud', -180, 360, 40, 0), P('cloud', 160, 380, 46, 0), P('cloud', 0, 430, 52, 0), P('cloud', -260, 120, 38, 0), P('cloud', 250, 160, 42, 0), P('cloud', 90, -160, 36, 0),
);
// palms along the lip of the cliff, all the way round (where the lip is fit to stand on)
for (let deg = -176; deg <= 180; deg += 8) {
  if (wallAt(deg) < 1 || Math.abs(turn(deg, -90)) < 16) continue;
  const [x, y] = at(deg + 2 * onCircle(rockN, deg), 17 + 22 * benchAt(deg) + 3 * onCircle(rockN, deg + 50));
  if (standable(x, y)) props.push(P('palm', x, y, 9 + 3 * Math.abs(onCircle(crestN, deg * 3)), Math.round(deg * 7 + 360) % 360));
}

// ---- gadgets (docs/gadgets.md): sudden death stays pure. Nothing here touches the ball:
// only a coin trail along the flight that finishes by the flag (collect all 6 for the bonus).
const flagFlight = L.flight(height, TEE, PIN, { speedMph: 78, vla: 29, spin: 10000 });
const gadgets = [
  flagFlight.coins('bay-coins', 20, Math.floor(flagFlight.carryM) - 8, 6, { reach: 4 }),
];

module.exports = {
  id: 'bullseye-bay',
  extent: { minX: -270, minY: -150, maxX: 270, maxY: 380 },
  hole: {
    par: 3,
    name: 'Bullseye Bay',
    line: [TEE, PIN],
    note: 'Closest to the pin. 115 yards from the rim of the caldera, 26 metres down to a round green 40 metres across: it plays two clubs less. The beach round it is sand; past the beach is wet.',
    greenNote: 'Round, nearly level, tilted a touch towards the tee. The rings are 3, 7, 11, 15 and 19 metres from the flag.',
  },
  surfaces: [
    { kind: 'tee', poly: tee },
    { kind: 'green', poly: green },
    ...beach.map((poly) => ({ kind: 'bunker', poly })),
  ],
  trees,
  woods: [],
  props,
  gadgets,
  obLine: L.rect(-262, -142, 262, 372),
  height,
  sea: true,
  probes: [
    { at: [0, 45], kind: 'water', what: 'the carry' },
    { at: [62, 105], kind: 'water', what: 'the bay right of the island' },
    { at: [-58, 105], kind: 'water', what: 'the bay left of the island' },
    { at: [0, 170], kind: 'water', what: 'long' },
    { at: [0, 240], kind: 'water', what: 'the mouth of the bay' },
    { at: [0, 360], kind: 'water', what: 'the open sea' },
    { at: [0, 14], kind: 'water', what: 'the cliff under the tee' },
    { at: [0, 78], kind: 'bunker', what: 'the beach in front of the green' },
    { at: [29, 105.2], kind: 'bunker', what: 'the beach right of the green' },
    { at: [0, 134], kind: 'bunker', what: 'the beach behind the green' },
    { at: [0, 88], kind: 'green', what: 'the front of the green' },
    { at: [0, 127], kind: 'rough', what: 'the fringe behind the green' },
    { at: [0, -9], kind: 'rough', what: 'the tee ledge' },
    { at: cove(183, 24).map(Math.round), kind: 'rough', what: 'the village terrace in the west cove' },
    { at: at(-4, 17).map(Math.round), kind: 'rough', what: 'the spectators\' terrace in the east wall' },
  ],
  stage: {
    number: 21, role: 'tiebreak', order: 1,
    name: 'Bullseye Bay', theme: 'tropical',
    origin: { lat: 13.5, lon: -146.0 },        // open Pacific, south-east of Hawaii
    conditions: 'calm',
    wind: { min: 4, max: 12 },                 // off the water: a read, not a lottery
    timeOfDay: 'day',
    blurb: 'Sudden death from the caldera rim: one ball each at a bullseye in the bay.',
    difficulty: 1,
  },
  // for the tests: the shape of the caldera
  caldera: { centre: C, teeH: TEE_H, benchH: BENCH_H, mouthDeg: MOUTH, footR, cliffH, at, cove, stacks },
};
