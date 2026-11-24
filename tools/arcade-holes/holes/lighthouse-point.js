'use strict';
// Lighthouse Point: par 4, 354 yd round the cove, 296 yd straight at the flag. A links on
// clifftops 25 to 33 m above the sea, in a wind. The tee is on a knoll; the fairway runs
// north along the cliff, then turns west along a headland to a green on its edge, under
// the lighthouse on its crag. Three ways to play it (hole.routes):
//   SAFE    the Links: up the wide fairway inland of the cove, no carry, then a mid iron
//           west along the headland.
//   RISKY   Smugglers' Cut: over the corner of the cove (220 yd of carry from the knoll) to
//           the near end of the headland. A wedge from there.
//   ROCKET  the Lighthouse Line: straight over the whole cove at the flag, 280 yd of carry
//           to a green at the tee's own height. No plain drive gets up the cliff.
// Local metres, x east, y north; the tee is the origin. Heights are metres above the sea
// (the sea is exactly 0, see docs/arcade-holes.md).

const L = require('../lib');
const D = require('../detail-a');

const TEE = [0, 0];
const PIN = [-101, 251];                       // 296 yd straight, bearing -22 degrees
const LINE = [TEE, [12, 120], [4, 208], [-40, 236], PIN];
const TEE_H = 33;
const CLIFF_M = 9;                             // the cliffs: from the sea to the top in 9 m

// ---- the coast, south to north (land on its east side), and the sea west of it
const coast = L.smoothPolygon([
  [-46, -260], [-44, -60], [-58, -30], [-60, 10], [-44, 34], [-34, 62], [-26, 100], [-24, 140], [-25, 168], [-30, 180],
  [-42, 189], [-62, 201], [-84, 215], [-100, 226], [-122, 226], [-146, 232], [-168, 250], [-172, 274], [-160, 294],
  [-132, 303], [-100, 303], [-70, 310], [-50, 328], [-44, 360], [-44, 600],
  [-600, 600], [-600, -260],
], 2);
// rocks awash: [x, y, radius, height]. Under 1.4 m, so the sea finder takes each for shore
// (a penalty area) and none is a place to drop or play a ball.
const reefs = [[-72, 96, 4.5, 1.3], [-98, 140, 5, 1.35], [-128, 196, 6, 1.3], [-140, 204, 4.5, 1.25], [-70, 20, 4.5, 1.3], [-118, 208, 4, 1.2], [-188, 300, 5, 1.3]];
// sea stacks: sheer, far from any line of play, their crowns slanted (so the sea finder takes
// every part of them for cliff: nowhere on one is a place for a ball): [x, y, radius, height]
const stacks = [[-150, 118, 11, 27], [-214, 262, 12, 34], [-240, 302, 9, 24], [-206, 222, 8, 18], [-176, 60, 8, 15], [-96, -70, 9, 20], [-268, 150, 10, 22]];
const castleRock = L.blob(-250, 386, 44, 32, { wobble: 0.1, seed: 17, n: 40 });   // an island to the north-west

// ---- surfaces
const tee = L.rect(-6, -5, 6, 5);
const knoll = L.blob(0, -2, 10, 9, { wobble: 0.05, seed: 2 });
const fairwayA = L.capsule([[8, 64], [14, 120], [12, 204], [-2, 230]], [42, 50, 54, 50]);
const fairwayB = L.capsule([[-2, 230], [-40, 236], [-82, 252]], [50, 44, 32]);
const green = L.blob(-103, 257, 18, 15.5, { wobble: 0.05, seed: 6, rotDeg: 10 });   // 36 x 31 m
const greenApron = L.offsetPolygon(green, 4);
const crag = L.blob(-128, 289, 13, 10, { wobble: 0.08, seed: 8, rotDeg: -20 });
const harbour = L.blob(-49, 2, 9, 30, { wobble: 0.08, seed: 9 });           // the fishing village's shelf under the knoll
const bunkers = [
  L.blob(45, 150, 8, 12, { wobble: 0.12, seed: 12, rotDeg: 15 }),     // right of the lay-up
  L.blob(42, 212, 9, 7, { wobble: 0.12, seed: 13, rotDeg: -30 }),     // through the fairway, right
  L.blob(14, 262, 10, 6, { wobble: 0.1, seed: 14 }),                  // straight through the corner
  L.blob(-10, 168, 4.5, 8, { wobble: 0.1, seed: 15 }),                // the cliff side of the lay-up
  L.blob(-56, 270, 7, 5, { wobble: 0.1, seed: 16, rotDeg: 20 }),      // north of the headland fairway
  L.blob(-79, 279, 5.5, 4.5, { wobble: 0.08, seed: 17 }),             // right of the green
  L.blob(-104, 279, 6, 4, { wobble: 0.08, seed: 18 }),                // behind the green, under the crag
  L.blob(70, 100, 16, 30, { wobble: 0.14, seed: 19, rotDeg: 10 }),    // the big dune waste, inland
];

// ---- ground
const sdSea = D.sdf(coast, 40), sdCastle = D.sdf(castleRock, 12);
const sdKnoll = D.sdf(knoll, 30), sdCrag = D.sdf(crag, 12), sdApron = D.sdf(greenApron, 18), sdHarbour = D.sdf(harbour, 12);
const sdMown = [fairwayA, fairwayB].map((p) => D.sdf(p, 16));
const sdBunkers = bunkers.map((b) => D.sdf(b, 6));
const roll = L.fbm({ seed: 301, scaleM: 75, octaves: 2 });
const duneNoise = L.fbm({ seed: 302, scaleM: 34, octaves: 2 });
const rockNoise = L.fbm({ seed: 303, scaleM: 12, octaves: 2 });
const greenPlane = L.plane(33, [-103, 257], 0.012, 0.008);         // 1.4 %

function height(x, y) {
  const d = -sdSea(x, y);                       // metres inland; negative out at sea
  if (d <= 0) {
    let h = 0;
    const rock = sdCastle(x, y);
    if (rock > 0) return (38 + 4 * rockNoise(x, y)) * L.smoothstep(0, 8, rock);
    for (const [cx, cy, r, top] of reefs) h = Math.max(h, top * L.bump(x, y, cx, cy, r));
    for (const [cx, cy, r, top] of stacks) {
      const q = Math.hypot(x - cx, y - cy);
      if (q < r) h = Math.max(h, (top + 0.9 * (x - cx)) * L.smoothstep(r, r - 2.2, q));
    }
    return h;
  }
  // clifftop links: rising gently north, and west along the headland to the green
  const head = L.clamp((-22 - x) / 44, 0, 1) * L.smoothstep(172, 212, y);
  let h = 24 + 2 * L.smoothstep(0, 200, y) + 7 * head + 0.7 * roll(x, y);
  // dunes inland and at the far end, never on the mown ground
  const mown = Math.max(...sdMown.map((sd) => D.inside(sd(x, y), 14)), D.inside(sdApron(x, y), 10));
  const wild = (1 - mown) * Math.max(L.smoothstep(34, 70, x), L.smoothstep(268, 310, y) * L.smoothstep(-60, -20, x));
  if (wild) h += wild * (2.2 + 3.2 * (1 - Math.abs(duneNoise(x, y))) + 1.5 * duneNoise(x + 40, y - 70));
  // North Head: the moor climbs to 70 m beyond the hole, the abbey's ruins on top
  const moor = L.smoothstep(318, 410, y);
  if (moor) h += moor * (36 + 5 * roll(x - 60, y + 30));
  // the tee's knoll (a grass bank, not a cliff), the lighthouse's crag, the village's shelf
  const onKnoll = D.inside(sdKnoll(x, y), 26);
  if (onKnoll) h = L.lerp(h, TEE_H, onKnoll);
  const onCrag = D.inside(sdCrag(x, y), 10);
  if (onCrag) h = L.lerp(h, 47 + 1.5 * rockNoise(x, y), onCrag);
  const onGreen = D.inside(sdApron(x, y), 15);
  if (onGreen) h = L.lerp(h, greenPlane(x, y), onGreen);
  for (const sd of sdBunkers) {
    const sand = sd(x, y);
    if (sand > 0) h -= 0.5 * L.smoothstep(0, 3, sand);
  }
  const onShelf = D.inside(sdHarbour(x, y), 9);
  if (onShelf) h = L.lerp(h, 3.7, onShelf);
  return h * L.smoothstep(0, CLIFF_M, d);
}

const surfaces = [
  { kind: 'tee', poly: tee },
  { kind: 'fairway', poly: fairwayA },
  { kind: 'fairway', poly: fairwayB },
  { kind: 'green', poly: green },
  ...bunkers.map((poly) => ({ kind: 'bunker', poly })),
];

// well back from every cliff, on ground that is not a dune face
const inland = (x, y) => -sdSea(x, y) > 38 && D.slopeOf(height, x, y) < 0.3;
// wind-bent trees: a shelter belt down the inland side, clumps by the tee and beyond the corner
const trees = D.cleanTrees([
  ...L.scatterTrees([[84, -80], [112, -80], [112, 330], [70, 330], [88, 200], [96, 120]], { spacing: 15, seed: 51 }),
  ...L.clusterTrees(40, -52, { count: 7, radius: 14, seed: 52 }),
  ...L.clusterTrees(-14, -60, { count: 5, radius: 10, seed: 53 }),
  ...L.clusterTrees(30, 312, { count: 8, radius: 18, seed: 54 }),
  ...L.clusterTrees(62, 250, { count: 5, radius: 10, seed: 55 }),
  ...L.clusterTrees(8, 380, { count: 7, radius: 20, seed: 56 }),
], { surfaces, tee: TEE, pin: PIN, clearM: 7, ok: inland });

// ---- props
const P = D.P;
const face = (kind, x, y, heightM, to) => P(kind, x, y, heightM, L.facing(x, y, to[0], to[1]));
const props = D.clean([
  // the lighthouse on its crag above the green, and a watchtower on the headland's tip
  P('lighthouse', -128, 290, 28, 200), P('tower', -158, 262, 12, 0),
  // the fishing village on the shelf under the knoll: huts, a jetty, boats drawn up and moored
  face('hut', -47, -18, 5, [-90, -18]), face('hut', -50, -6, 5.5, [-90, -6]), face('hut', -46, 6, 5, [-90, 6]), face('hut', -51, 16, 4.5, [-90, 16]),
  face('hut', -45, 24, 5, [-90, 24]), face('hut', -53, -26, 4.5, [-90, -26]), face('cabin', -41, -4, 6, [-90, -4]),
  face('hut', -44, -14, 4.5, [-90, -14]), face('hut', -52, 26, 4.5, [-90, 26]), face('hut', -42, 14, 5, [-90, 14]), P('bridge', -66, -24, 20, 100),
  P('boat', -62, -30, 3.5, 40), P('boat', -70, 28, 3.5, 200), P('boat', -100, -20, 5, 300), P('boat', -108, 50, 4.5, 250),
  P('bridge', -70, 2, 28, 90), P('boat', -66, -16, 4, 80), P('boat', -74, 16, 4.5, 110), P('boat', -86, -4, 5, 60), P('boat', -92, 24, 4, 140),
  P('boat', -80, -34, 4.5, 20), P('boat', -60, 38, 3.5, 170), P('flag-banner', -44, 12, 6, 0), P('torch', -56, 2, 3, 0), P('torch', -56, -12, 3, 0),
  // wrecked on the reef under the headland, and another far out
  P('shipwreck', -128, 199, 14, 60), P('shipwreck', -300, 40, 12, 200),
  // sails out at sea
  P('boat', -210, 110, 14, 300), P('boat', -260, 30, 16, 250), P('boat', -330, 230, 18, 280), P('boat', -180, -90, 12, 320), P('boat', -300, 330, 14, 200), P('boat', -400, 120, 20, 260),
  // needles round the stacks, and the castle on its rock to the north-west
  P('rock-spire', -226, 250, 22, 30), P('rock-spire', -200, 280, 16, 120), P('rock-spire', -160, 104, 14, 200), P('rock-spire', -232, 312, 14, 60),
  P('rock-spire', -284, 160, 16, 300), P('rock-spire', -106, -86, 12, 90), P('rock-spire', -190, 316, 12, 150),
  face('castle', -250, 386, 30, TEE), P('ruins', -232, 368, 8, 40), P('rock-spire', -306, 420, 24, 0), P('rock-spire', -196, 404, 18, 80),
  P('rock-spire', -120, 120, 10, 0), P('rock-spire', -250, 80, 20, 140), P('rock-spire', -130, -40, 14, 210), P('rock-spire', -176, 190, 12, 30),
  // the links inland: a windmill, cottages, an abbey's ruins on the far shore
  P('windmill', 96, 44, 22, 250), face('cabin', 58, -44, 7, TEE), face('cabin', 72, -30, 6.5, TEE), face('cabin', 94, 176, 6.5, [14, 176]),
  face('ruins', -4, 384, 12, TEE), face('ruins', 30, 400, 9, TEE), P('tower', 60, 396, 16, 0), P('windmill', 84, 360, 20, 220), P('statue', 26, -22, 5, 200),
  face('cabin', 76, 286, 6.5, [14, 250]), face('cabin', 92, 300, 6, [14, 250]), face('cabin', 100, 236, 6.5, [14, 236]), P('giant-tree', 86, 20, 22, 0),
  face('gate', 30, 30, 8, TEE),
  // lamps along the cliff path, from the knoll to the corner
  ...D.beside([[-22, 40], [-14, 100], [-12, 150], [-16, 176]], 9, 0).map(([x, y]) => P('torch', x, y, 3, 0)),
  // the event: stands and crowds along the headland, a screen beyond the green
  face('grandstand', -30, 276, 9, PIN), face('grandstand', -66, 288, 9, PIN), face('crowd', -44, 266, 3.2, [-70, 246]), face('crowd', -92, 286, 3, PIN),
  face('crowd', 34, 236, 3, [4, 220]), face('crowd', 44, 126, 3, [14, 126]), face('jumbotron', -76, 296, 14, TEE),
  P('flag-banner', -11, 8, 6, 0), P('flag-banner', 12, 6, 6, 0),
  ...D.beside([[-6, 250], [-40, 257], [-76, 268]], 5, 0).map(([x, y]) => P('flag-banner', x, y, 6.5, 0)),
  ...D.beside([[38, 60], [42, 120], [42, 190]], 5, 0).map(([x, y]) => P('flag-banner', x, y, 6.5, 0)),
  P('flag-banner', -122, 262, 5, 0), P('flag-banner', -118, 248, 5, 0), P('flag-banner', -86, 274, 5, 0),
  ...D.beside([[-12, 262], [-44, 264], [-70, 274]], 4, 0).map(([x, y]) => P('flag-banner', x, y, 6.5, 0)),
  face('crowd', -20, 268, 3, [-40, 240]), face('crowd', 46, 180, 3, [14, 180]), face('crowd', 36, 262, 3, [0, 230]),
  // in the air: gulls round every cliff, clouds running in off the sea
  P('bird-flock', -134, 100, 8, 20), P('bird-flock', -172, 194, 8, 200), P('bird-flock', -163, 313, 8, 110), P('bird-flock', -90, -8, 8, 300),
  P('bird-flock', -214, 262, 8, 40), P('bird-flock', -150, 118, 8, 160), P('bird-flock', -250, 386, 8, 70), P('bird-flock', 20, 300, 8, 250),
  P('cloud', -260, 180, 46, 0), P('cloud', -120, 440, 50, 0), P('cloud', 120, 260, 40, 0), P('cloud', -380, 320, 54, 0), P('cloud', -200, -120, 42, 0), P('cloud', 60, 520, 48, 0),
  P('balloon', 70, 140, 22, 0), P('balloon', -20, 420, 24, 60), P('balloon', 100, 300, 22, 30), P('blimp', -180, 330, 18, 100),
  P('bird-flock', -306, 420, 8, 0), P('bird-flock', 9, 210, 8, 90), P('bird-flock', -146, 326, 8, 180), P('bird-flock', 68, 63, 8, 270),
  P('cloud', -460, 80, 60, 0), P('cloud', 200, 100, 44, 0), P('cloud', -300, 520, 56, 0), P('cloud', 100, -140, 40, 0),
  P('fireworks', -140, 300, 30, 0), P('fireworks', -60, 320, 30, 0),
], { surfaces, tee: TEE, pin: PIN, dry: inland });

// ---- gadgets (docs/gadgets.md): what a swing can hit
//   RISKY   the Updraft, a wind tunnel standing in the cove on the line of Smugglers' Cut,
//           holds a ball up as it crosses: a drive of 130 mph that would have been in the
//           sea makes the headland. The landing there is a x2 ring, with the smugglers'
//           crates beside it (a ball launched at 100 mph or more smashes one for coins).
//   SAFE    the Cliff Rail along the fairway's seaward edge kicks a ball that is running
//           for the cliff back onto the grass; the Headland Runner, a speed strip at the
//           corner, sweeps a drive that reaches it west along the headland.
//   ROCKET  coins over the cove along the Lighthouse Line.
const cutLine = L.bearing(TEE, [-40, 236]);
const lighthouseLine = L.flight(height, TEE, PIN, { speedMph: 117, vla: 17.5, spin: 6000, ball: 'rocket' });
const gadgets = [
  L.gadget('fan', 'updraft', -27.5, 162, { size: [26, 80, 44], heading: cutLine, strength: 2, lift: 8 }),
  L.gadget('zone', 'cut-x2', -38, 233, { radius: 12, mult: 2 }),
  L.gadget('breakable', 'crates-a', -52, 224, { radius: 2.6, height: 4, breakMph: 100, style: 'crate' }),
  L.gadget('breakable', 'crates-b', -24, 252, { radius: 2.6, height: 4, breakMph: 100, style: 'crate' }),
  { id: 'cliff-rail', kind: 'rail', points: [[-8, 118], [-9, 140], [-10, 162], [-9, 184]], strength: 6 },
  L.gadget('strip', 'headland-runner', 14, 224, { size: [26, 36], heading: 283, strength: 8, maxMps: 11 }),
  lighthouseLine.coins('cove-coins', 50, 240, 7),
];

module.exports = {
  id: 'lighthouse-point',
  stage: {
    number: 3, role: 'match', order: 3,
    name: 'Lighthouse Point', theme: 'links',
    origin: { lat: 41.5, lon: -150.0 },
    conditions: 'windy',
    wind: { min: 10, max: 22 },
    timeOfDay: 'day',
    blurb: 'Clifftop links in the wind: round the cove, cut its corner, or a Rocket over it all.',
    difficulty: 2,
  },
  extent: { minX: -330, minY: -110, maxX: 130, maxY: 440 },
  hole: {
    par: 4,
    name: 'Lighthouse Point',
    line: LINE,
    note: 'Sea and cliffs all down the left. The fairway runs north past the cove, then west along the headland; the flag is 296 yards away straight over the water, on top of a 31 metre cliff. Exposed: play the wind.',
    greenNote: 'On the headland\'s edge: the cove in front, the lighthouse crag behind. Miss right.',
    routes: [
      { id: 'safe', name: 'The Links', note: 'Up the wide fairway inland of the cove, no carry. A mid iron west along the headland to finish.' },
      { id: 'risky', name: 'Smugglers\' Cut', note: 'Left over the corner of the cove: 220 yards of carry from the knoll. A wedge from the headland.' },
      { id: 'rocket', name: 'The Lighthouse Line', note: 'A Rocket straight at the flag: 280 yards of sea and a 31 metre cliff to clear.' },
    ],
  },
  surfaces,
  trees,
  woods: [],
  props,
  gadgets,
  // the sea is the hazard on the west side; the line only matters on land
  obLine: [[-325, -92], [112, -92], [112, 425], [-325, 425]],
  height,
  sea: true,
  probes: [
    { at: [-150, 60], kind: 'water', what: 'the sea' },
    { at: [-60, 130], kind: 'water', what: 'the cove, on the direct line' },
    { at: [-34, 170], kind: 'water', what: 'the corner of the cove' },
    { at: [-200, 250], kind: 'water', what: 'past the headland' },
    { at: [-97, 229], kind: 'water', what: 'the cliff under the green' },
    { at: [14, 120], kind: 'fairway', what: 'the landing area' },
    { at: [8, 215], kind: 'fairway', what: 'the corner' },
    { at: [-44, 236], kind: 'fairway', what: 'the near end of the headland' },
    { at: [45, 150], kind: 'bunker', what: 'the fairway bunker' },
    { at: [70, 100], kind: 'bunker', what: 'the dune waste' },
    { at: [60, 40], kind: 'rough', what: 'the inland rough' },
    { at: [-80, 284], kind: 'rough', what: 'the headland behind the green' },
    { at: [0, -12], kind: 'rough', what: 'the tee knoll' },
    { at: [125, 100], kind: 'ob', what: 'inland of the hole' },
  ],
};
