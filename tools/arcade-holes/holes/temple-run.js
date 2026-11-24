'use strict';
// Temple Run: par 5, 528 yd (527 straight at the flag). The tee is a ledge 34 m up the
// wall of a jungle gorge. Two rivers cross the floor below, each falling out of the gorge
// wall; beyond them the temple climbs the mountain in terraces, and the green is on the
// first of them, 7.5 m above the forecourt.
// Three ways to play it (docs/dev/arcade-v2-contract.md, "Routes"):
//   SAFE    never over water: the drive, then the stepping-stone fords (dry gaps in each
//           river, 36 m wide: the left of the first, the right of the second), the
//           forecourt, and the processional ramp up to the green. Or the usual three
//           shots: drive, lay up on the island between the rivers, wedge on.
//   RISKY   in two: after a good drive, a long iron or a wood over both rivers and up onto
//           the terrace. Short is the second river, or the sand under the stairs.
//   ROCKET  in one: a boosted drive carries both rivers, the forecourt and the stairs and
//           comes down on the green (a 150 mph swing; a 135 mph one reaches the forecourt,
//           a 120 mph one the island).
// The rivers are `water` polygons, dead level, 4 m below the gorge floor.
// Local metres, x east, y north; the tee is the origin. Heights are metres above the rivers.

const L = require('../lib');

const LINE = [[0, 0], [-3, 150], [0, 270], [8, 366], [12, 482]];
const TEE = LINE[0], PIN = LINE[LINE.length - 1];
const TEE_H = 38, FLOOR = 4, COURT_H = 5, GREEN_H = 12.5, TEMPLE_H = 25, UPPER_H = 39;
const ss = L.smoothstep;

// A polygon's signed distance (positive inside), not worked out at all beyond `reach`
// metres of its bounding box: the height function runs for every node of a big grid.
const near = (poly, reach) => {
  const b = L.bbox(poly);
  return (x, y) => (x < b.minX - reach || x > b.maxX + reach || y < b.minY - reach || y > b.maxY + reach ? -Infinity : L.signedDistance(x, y, poly));
};

// ---- the rivers: each in two reaches with a dry ford between them
const riverA = [
  L.capsule([[196, 300], [120, 316], [40, 328], [-26, 330]], [26, 24, 22, 22], { stepM: 5 }),     // from the east wall, across the hole
  L.capsule([[-84, 328], [-140, 318], [-200, 302]], [22, 24, 26], { stepM: 5 }),                  // and on to the west wall
];
const riverB = [
  L.capsule([[-200, 412], [-120, 406], [-40, 402], [30, 400]], [24, 22, 18, 18], { stepM: 5 }),   // from the west wall, across the hole
  L.capsule([[88, 402], [140, 408], [200, 418]], [20, 22, 26], { stepM: 5 }),                     // and on to the east wall
];
const rivers = [...riverA, ...riverB];

// ---- surfaces
const tee = L.rect(-6, -5, 6, 5);
const fairwayA = L.capsule([[-2, 150], [-4, 200], [-2, 240], [4, 284]], [50, 58, 62, 56]);        // the drive
const ford1 = L.capsule([[-30, 286], [-55, 328], [-40, 356]], 30);                                 // the dry way over the first river
const island = L.capsule([[-30, 366], [10, 366], [44, 368]], [40, 44, 40]);                        // the lay-up, between the rivers
const ford2 = L.capsule([[44, 374], [58, 401], [58, 424]], 30);                                    // the dry way over the second
const forecourt = L.capsule([[-34, 431], [12, 431], [64, 432]], [28, 30, 28]);                     // under the temple stairs
const ramp = L.capsule([[78, 440], [84, 470], [64, 494]], 15);                                     // the processional ramp up to the terrace
const moat = L.capsule([[-28, 451], [12, 451.5], [52, 451]], 4.6);                                   // sand at the foot of the stairs: what short of the terrace costs
const green = L.blob(PIN[0], PIN[1] + 1, 17, 19, { wobble: 0.05, seed: 5 });                      // 34 x 38 m
const greenApron = L.offsetPolygon(green, 4);
const bunkers = [
  L.blob(42, 226, 9, 15, { wobble: 0.1, seed: 31, rotDeg: -8 }),      // right of the drive
  L.blob(-42, 262, 8, 12, { wobble: 0.1, seed: 32, rotDeg: 10 }),     // left, for the long drive
  L.blob(-84, 300, 7, 12, { wobble: 0.12, seed: 36, rotDeg: 30 }),    // the river beach by the first ford
  L.blob(74, 372, 7, 9, { wobble: 0.1, seed: 33 }),                   // right of the island, by the second ford
  L.blob(-66, 364, 6, 9, { wobble: 0.1, seed: 37 }),                  // left of the island
  L.blob(-16, 476, 5, 8, { wobble: 0.08, seed: 34, rotDeg: 15 }),     // left of the green
  L.blob(36, 502, 7, 3.5, { wobble: 0.08, seed: 35, rotDeg: -10 }),   // back right, under the temple wall
  moat,
];
const villagePad = L.blob(-150, 256, 36, 34, { wobble: 0.06, seed: 41 });      // the river village, on the west bank

// ---- ground
const sdRivers = rivers.map((r) => near(r, 8));
const sdRamp = near(L.offsetPolygon(ramp, 3), 8), sdGreen = near(greenApron, 10), sdVillage = near(villagePad, 24);
const sdBunkers = bunkers.map((b) => near(b, 6));

const roll = L.fbm({ seed: 711, scaleM: 60, octaves: 3 });
const bumps = L.fbm({ seed: 714, scaleM: 22, octaves: 2 });
const wallNoise = L.fbm({ seed: 712, scaleM: 110, octaves: 3 });
const rockNoise = L.fbm({ seed: 715, scaleM: 34, octaves: 2 });
const edgeNoise = L.fbm({ seed: 713, scaleM: 120, octaves: 2 });       // the gorge walls wander
// rock cut into ledges
const ledges = (h, step, k) => { const t = h / step, f = t - Math.floor(t); return L.lerp(h, step * (Math.floor(t) + ss(0.3, 0.7, f)), k); };
const greenPlane = L.plane(GREEN_H, [PIN[0], PIN[1] + 1], 0.003, 0.010);     // 1.0 %, rising to the temple
// the temple mountain, straight up the middle of the gorge: the forecourt, the stairs, the
// green's terrace, the temple's, the upper court, the peak
const terraces = (y) => COURT_H
  + (GREEN_H - COURT_H) * ss(458, 464, y)
  + (TEMPLE_H - GREEN_H) * ss(508, 515, y)
  + (UPPER_H - TEMPLE_H) * ss(558, 565, y)
  + 54 * ss(598, 642, y);

function height(x, y) {
  // the gorge floor, humped and hollowed; it lifts a little toward the temple
  let h = FLOOR + 0.6 * roll(x, y) + 0.3 * bumps(x, y);
  const village = ss(-18, 0, sdVillage(x, y));
  if (village) h = L.lerp(h, 6, village);
  // the gorge walls, in ledges, wandering in and out
  const wob = 22 * edgeNoise(x, y);
  const wall = ss(120, 184, Math.abs(x) + wob);
  if (wall) h = L.lerp(h, ledges(64 + 16 * wallNoise(x, y) + 4 * rockNoise(x, y), 10, 0.55), wall);
  // the temple mountain closes the gorge
  const lane = 1 - ss(64, 116, Math.abs(x - 12) - 0.12 * Math.max(0, y - 512));
  const steps = lane * ss(412, 424, y);
  if (steps) h = L.lerp(h, terraces(y) + (y > 600 ? 5 * rockNoise(x, y) * ss(600, 620, y) : 0), steps);
  const beyond = ss(572, 632, y) * (1 - lane);
  if (beyond) h = L.lerp(h, ledges(70 + 14 * wallNoise(x, y), 10, 0.55), beyond);
  const onGreen = ss(-5, 0, sdGreen(x, y));
  if (onGreen) h = L.lerp(h, greenPlane(x, y), onGreen);
  // the ramp is cut into the terrace: it climbs evenly from the forecourt to the green
  const onRamp = ss(-4, 0, sdRamp(x, y));
  if (onRamp) h = L.lerp(h, L.lerp(COURT_H, GREEN_H + 0.1, L.clamp((y - 450) / 42, 0, 1)), onRamp);

  // the tee's ledge on the south wall: its lip is the front of the tee, so the gorge is in view
  const bluff = ss(40, 6, y + 0.003 * x * x) * (1 - ss(120, 190, Math.abs(x)));
  if (bluff) h = L.lerp(h, ledges(TEE_H + 12 * ss(-30, -100, y) + 3 * rockNoise(x, y) * ss(10, 30, Math.hypot(x, y)), 8, 0.4 * ss(12, 40, Math.hypot(x, y))), bluff);

  for (let i = 0; i < bunkers.length; i++) {
    const sand = sdBunkers[i](x, y);
    if (sand > 0) h -= 0.5 * ss(0, 3, sand);
  }
  // the rivers: banks four metres wide inside the outline, then dead level
  let wet = -Infinity;
  for (const sd of sdRivers) wet = Math.max(wet, sd(x, y));
  if (wet > 0) h = L.lerp(h, 0, ss(0, 4, wet));
  return h;
}

// ---- jungle. `trees` are obstacles: thick on the gorge walls and the floor's edges, 44 m
// and more from every line of play
const mown = [fairwayA, ford1, island, ford2, forecourt, ramp, green, ...bunkers];
const onPlay = (x, y, m = 4) => mown.some((p) => L.signedDistance(x, y, p) > -m) || L.signedDistance(x, y, tee) > -m;
const inRiver = (x, y, m = 3) => rivers.some((r) => L.signedDistance(x, y, r) > -m);
const SAFE_WAY = [[-30, 286], [-55, 328], [-40, 356], [44, 374], [58, 401], [58, 424], [78, 440], [84, 470], [64, 494]];
const glades = L.fbm({ seed: 716, scaleM: 50, octaves: 2 });
const trees = L.scatterTrees(L.rect(-228, -96, 240, 612), {
  spacing: 15, seed: 71, clearM: 0,
  keep: (x, y) => {
    if (onPlay(x, y, 10) || inRiver(x, y, 5)) return false;
    if (L.distToPolyline(x, y, LINE) < 46 || L.distToPolyline(x, y, [TEE, PIN]) < 46 || L.distToPolyline(x, y, SAFE_WAY) < 30) return false;
    if (Math.abs(x - 12) < 70 && y > 408) return false;                          // the temple's terraces stay clear
    if (L.signedDistance(x, y, villagePad) > -3) return false;
    const steep = Math.hypot(height(x + 2, y) - height(x - 2, y), height(x, y + 2) - height(x, y - 2)) / 4;
    return steep < 0.9 && glades(x, y) > -0.45;
  },
});

// ---- props
const P = (kind, x, y, heightM, rotDeg = 0) => L.prop(kind, x, y, { heightM, rotDeg });
const face = (kind, x, y, heightM, tx, ty) => P(kind, x, y, heightM, L.facing(x, y, tx, ty));
const offLine = (x, y, m = 9) => L.distToSegment(x, y, TEE[0], TEE[1], PIN[0], PIN[1]) > m;
const rnd = L.mulberry32(77);
// palms line the fairways and the fords (props: a ball flies through them)
const palms = [];
for (const p of [...L.spline(LINE, 24), ...L.spline(SAFE_WAY, 22)]) {
  if (p.y < 130 || p.y > 452) continue;
  for (const side of [-1, 1]) {
    const x = p.x + side * (36 + rnd() * 10), y = p.y + (rnd() - 0.5) * 12;
    if (!onPlay(x, y, 4) && !inRiver(x, y, 3) && offLine(x, y, 14)) palms.push(P('palm', x, y, 9 + rnd() * 5, Math.round(rnd() * 360)));
  }
}

const props = [
  // --- the tee's ledge: ruins, idols, torches, a rope bridge over the chasm beside it
  P('torch', -9, 7, 3.2), P('torch', 9, 7, 3.2), P('flag-banner', -14, -9, 7, 20), P('flag-banner', 14, -9, 7, -20),
  face('ruins', -34, -30, 9, 0, 0), face('ruins', 36, -34, 8, 0, 0), face('idol', -22, -14, 8, 0, 30), face('idol', 22, -16, 8, 0, 30),
  face('crowd', -30, -6, 2.8, 0, 0), face('crowd', 28, -8, 2.8, 0, 0),
  P('bridge', -86, 4, 44, 90), P('torch', -62, 6, 3.2), P('torch', -62, 0, 3.2),
  P('giant-tree', 64, -40, 36, 40),

  // --- down the drive: the giant trees, ruins in the rough, a rock arch, idols watching
  P('giant-tree', -84, 196, 42, 10), P('giant-tree', 96, 262, 38, 200),
  face('ruins', -70, 150, 8, -4, 200), face('ruins', 70, 176, 9, -4, 200), P('ruins', 60, 284, 6, 30),
  face('idol', -58, 222, 10, -2, 240), face('idol', 66, 232, 11, -2, 240),
  P('rock-arch', 104, 120, 20, 20), P('rock-arch', -110, 110, 17, 160), P('rock-spire', 110, 170, 18, 60), P('rock-spire', -112, 250, 16, 200),
  face('statue', -44, 132, 8, 0, 60), face('statue', 44, 132, 8, 0, 60),

  // --- the river village on the west bank: huts on stilts, tikis, boats on the water
  ...[[-164, 268, 5], [-150, 276, 5.5], [-136, 270, 5], [-168, 248, 5.5], [-152, 240, 5], [-134, 246, 5.5], [-146, 258, 4.5]].map(([x, y, h]) => face('hut', x, y, h, -150, 258)),
  P('tiki', -124, 262, 5, 90), P('tiki', -126, 250, 4.5, 90), P('tiki', -140, 284, 5, 150), P('tiki', -160, 232, 4.5, 30),
  P('torch', -142, 262, 3), P('torch', -156, 256, 3), P('torch', -148, 248, 3),
  P('boat', -112, 322, 5, 100), P('boat', -150, 315, 4.5, 80), P('boat', 100, 320, 5, 280), P('boat', 140, 409, 4.5, 260),
  face('crowd', -112, 280, 2.6, -40, 300),

  // --- the first river: its fall from the east wall, a rope bridge, idols on the stepping stones
  face('waterfall', 204, 296, 34, 120, 316), P('rock-arch', 168, 306, 22, 100), P('bridge', 96, 320, 32, 8),
  face('idol', -78, 312, 9, -55, 300), face('idol', -32, 316, 9, -55, 300), P('torch', -72, 304, 3.2), P('torch', -38, 306, 3.2),
  face('waterfall', -208, 298, 30, -140, 318),
  // --- the island: ruins, a tiki, a crowd on the bank
  P('ruins', 80, 350, 7, 70), face('tiki', -58, 380, 5, 0, 366), face('crowd', 84, 388, 2.6, 10, 366), P('statue', -76, 344, 9, 120),
  // --- the second river: its fall from the west wall, a rope bridge, the gate to the forecourt
  face('waterfall', -208, 414, 34, -120, 406), P('rock-arch', -168, 410, 22, 80), P('bridge', -70, 403, 30, 4),
  face('idol', 44, 398, 9, 58, 380), face('idol', 76, 400, 9, 58, 380), P('torch', 44, 412, 3.2), P('torch', 74, 414, 3.2),
  face('waterfall', 206, 420, 30, 140, 408),

  // --- the forecourt and the stairs: torches up both sides, statues at the foot, the ramp's gate
  ...[[-12, 461], [36, 461], [-36, 452], [60, 452]].map(([x, y]) => P('torch', x, y, 3.6)),
  face('statue', -44, 458, 12, -44, 300), face('statue', 62, 458, 12, 62, 300),
  face('gate', 98, 432, 12, 78, 440),
  ...[[68, 452], [92, 458], [74, 478], [96, 476], [56, 486], [74, 502]].map(([x, y]) => P('torch', x, y, 3.2)),
  face('crowd', -56, 434, 2.6, 12, 434),

  // --- the green's terrace: a screen, stands, the crowd, banners
  face('jumbotron', -36, 498, 12, PIN[0], PIN[1]), face('grandstand', -38, 480, 8, PIN[0], PIN[1]),
  face('crowd', 42, 486, 2.8, PIN[0], PIN[1]), face('crowd', -10, 505, 2.8, PIN[0], PIN[1]), face('crowd', 16, 506, 2.8, PIN[0], PIN[1]),
  P('flag-banner', -24, 466, 7, 0), P('flag-banner', 46, 468, 7, 0), P('fireworks', -40, 512, 26), P('fireworks', 64, 512, 26),

  // --- the temple, two terraces up, with idols either side; the upper court; the dragon on the peak
  P('temple', 12, 538, 36, 180), face('idol', -34, 524, 13, -34, 400), face('idol', 58, 524, 13, 58, 400),
  ...[[-10, 519], [34, 519], [-22, 532], [46, 532]].map(([x, y]) => P('torch', x, y, 4)),
  face('waterfall', -78, 532, 30, -78, 400), face('waterfall', 102, 532, 30, 102, 400),
  face('ruins', -40, 578, 10, -40, 400), face('ruins', 64, 578, 10, 64, 400), face('tower', -62, 572, 22, -62, 400), face('tower', 88, 572, 22, 88, 400),
  face('dragon', 12, 590, 46, 12, 300),
  ...[[-44, 536, 13], [68, 536, 12], [-52, 560, 11], [78, 560, 14], [-52, 512, 10], [100, 512, 11.5]].map(([x, y, h], i) => P('palm', x, y, h, 60 * i + 15)),

  // --- the gorge walls and the sky: spires and giant trees on the rims, birds, mist, a balloon
  P('giant-tree', -196, 150, 40, 80), P('giant-tree', 204, 190, 44, 300), P('giant-tree', -200, 490, 40, 20), P('giant-tree', 206, 530, 42, 140),
  P('rock-spire', -186, 60, 26, 0), P('rock-spire', 192, 80, 28, 120), P('rock-spire', -150, 610, 30, 240), P('rock-spire', 170, 612, 28, 60),
  P('idol', -176, 360, 16, 90), P('idol', 182, 360, 16, 270),
  face('waterfall', -176, 176, 36, -60, 190), face('waterfall', 180, 214, 36, 60, 220), face('waterfall', -170, 520, 30, -60, 500), face('waterfall', 186, 540, 30, 60, 520),
  P('bird-flock', -88, 181, 10), P('bird-flock', 101, 329, 10), P('bird-flock', -80, 440, 10), P('bird-flock', 120, 520, 10),
  P('cloud', -180, 570, 26), P('cloud', 190, 590, 26), P('cloud', 20, 650, 30), P('balloon', -120, 380, 22), P('balloon', 150, 220, 22), P('airship', 160, 480, 26, 250),
  ...palms,
].filter((p) => L.FLOATING_PROP_KINDS.includes(p.kind) || p.kind === 'bridge' || (!onPlay(p.x, p.y, 3) && offLine(p.x, p.y, L.SLIM_PROP_KINDS.includes(p.kind) ? 6 : 9)));

// ---- gadgets (docs/gadgets.md): what a swing can hit
//   SAFE    the drive's landing is a x2 ring, and the Mud Bank across the end of the fairway
//           stops a ball that is running for the first river (stuck, but dry).
//   RISKY   the Stone Drum, a pad on the island's far bank (beyond where a lay-up stops),
//           throws a ball that reaches it over the second river onto the forecourt instead
//           of letting it run into the water; and at the foot of the
//           temple stairs is the Serpent's Mouth, a pipe that takes a ball rolling into it
//           and fires it from the top of the stairs onto the green.
//   ROCKET  coins all the way to the temple, along the Rocket drive's flight.
const templeRocket = L.flight(height, TEE, PIN, { speedMph: 142, vla: 12, spin: 2600, ball: 'rocket' });
const gadgets = [
  L.gadget('zone', 'drive-x2', 2, 262, { radius: 13, mult: 2 }),
  L.gadget('mud', 'mud-bank', 0, 299, { size: [54, 8], heading: 0 }),
  L.gadget('pad', 'stone-drum', 12, 386, { radius: 5, heading: L.bearing([12, 386], [12, 432]), angle: 50, minMps: 24, maxMps: 24 }),
  L.gadget('warp', 'serpents-mouth', 12, 443, { radius: 3, pair: 'serpents-tail', style: 'pipe' }),
  L.gadget('warp-exit', 'serpents-tail', 12, 461, { heading: 352, angle: 45, speedMph: 21, style: 'pipe' }),   // onto the front of the green: a putt, not a tap-in
  templeRocket.coins('temple-coins', 90, 450, 8),
];

module.exports = {
  id: 'temple-run',
  extent: { minX: -270, minY: -130, maxX: 270, maxY: 660 },
  hole: {
    par: 5,
    name: 'Temple Run',
    line: LINE,
    note: 'From the ledge, two rivers cross the gorge. Drive short of the first (348 yards out), lay up on the island, pitch up to the terrace; or go for it in two over both. The stepping stones cross each river dry. A Rocket gets home in one.',
    greenNote: 'Big, on the temple\'s first terrace, 7.5 m above the forecourt, climbing gently to the temple. Short rolls back down the stairs into the sand; the temple wall is behind.',
    routes: [
      { id: 'safe', name: 'The Stepping Stones', note: 'Drive, cross each river at its ford or lay up on the island, then up to the terrace: never a forced carry.' },
      { id: 'risky', name: 'In Two', note: 'After a good drive, a wood over both rivers and up onto the terrace. Short is wet, or under the stairs.' },
      { id: 'rocket', name: 'In One', note: 'A Rocket drive flies both rivers, the forecourt and the stairs and comes down on the green.' },
    ],
  },
  surfaces: [
    { kind: 'tee', poly: tee },
    { kind: 'fairway', poly: fairwayA },
    { kind: 'fairway', poly: ford1 },
    { kind: 'fairway', poly: island },
    { kind: 'fairway', poly: ford2 },
    { kind: 'fairway', poly: forecourt },
    { kind: 'fairway', poly: ramp },
    { kind: 'green', poly: green },
    ...bunkers.map((poly) => ({ kind: 'bunker', poly })),
    ...rivers.map((poly) => ({ kind: 'water', poly })),
  ],
  trees,
  // darker ground: the village's paths, the stone of the stairs and the temple wall
  woods: [
    L.capsule([[-120, 258], [-90, 280], [-66, 296]], 6),
    L.capsule([[-44, 461], [12, 461.5], [68, 461]], 8),
    L.capsule([[-48, 511.5], [12, 512], [72, 511.5]], 9),
    L.capsule([[-56, 561.5], [12, 562], [80, 561.5]], 9),
  ],
  props,
  gadgets,
  // up the gorge walls either side, behind the tee's ledge and above the temple
  obLine: L.rect(-232, -104, 244, 622),
  height,
  sea: false,
  probes: [
    { at: [8, 329], kind: 'water', what: 'the first river, on the line to the flag' },
    { at: [120, 316], kind: 'water', what: 'the first river, toward the east wall' },
    { at: [-140, 318], kind: 'water', what: 'the first river, beyond its ford' },
    { at: [10, 400.5], kind: 'water', what: 'the second river, on the line to the flag' },
    { at: [140, 408], kind: 'water', what: 'the second river, beyond its ford' },
    { at: [-55, 328], kind: 'fairway', what: 'the first ford: dry, between the reaches of the river' },
    { at: [58, 401], kind: 'fairway', what: 'the second ford' },
    { at: [-2, 220], kind: 'fairway', what: 'the drive' },
    { at: [6, 262], kind: 'fairway', what: 'the drive, on the line to the flag' },
    { at: [8, 366], kind: 'fairway', what: 'the island' },
    { at: [12, 431], kind: 'fairway', what: 'the forecourt' },
    { at: [83, 466], kind: 'fairway', what: 'the ramp' },
    { at: [12, 451.5], kind: 'bunker', what: 'the sand at the foot of the stairs' },
    { at: [42, 226], kind: 'bunker', what: 'the bunker right of the drive' },
    { at: [74, 372], kind: 'bunker', what: 'the bunker by the second ford' },
    { at: [-16, 476], kind: 'bunker', what: 'the bunker left of the green' },
    { at: [12, 461], kind: 'rough', what: 'the stairs under the green' },
    { at: [12, 511], kind: 'rough', what: 'the temple wall behind it' },
    { at: [70, 200], kind: 'rough', what: 'a wide drive right' },
    { at: [-70, 200], kind: 'rough', what: 'a wide drive left' },
    { at: [-256, 150], kind: 'ob', what: 'over the west rim' },
    { at: [262, 300], kind: 'ob', what: 'over the east rim' },
  ],
  stage: {
    number: 7, role: 'match', order: 7,
    name: 'Temple Run', theme: 'jungle',
    origin: { lat: 9.0, lon: 88.5 },           // the middle of the Bay of Bengal
    conditions: 'calm',
    wind: { min: 3, max: 10 },                 // a gorge: sheltered, but the air moves
    timeOfDay: 'golden',
    blurb: 'Two rivers, a temple on a mountain. Three good swings get home; a Rocket in one.',
    difficulty: 3,
  },
};
