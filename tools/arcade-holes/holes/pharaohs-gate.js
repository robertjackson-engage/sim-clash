'use strict';
// Pharaoh's Gate: par 4, 301 yd round the left fairway, 286 yd straight at the flag. A
// drivable par 4 from a sandstone bluff 22 m above the desert. The fairway splits round the
// Great Sand Sea, which ends in the Gate Pool; the green lies at the feet of four colossi
// under the escarpment, and on top of the escarpment, before the gate of the cliff city, is
// the Upper Court.
// Three ways to play it (docs/dev/arcade-v2-contract.md, "Routes"), and a fourth for the brave:
//   SAFE    the left fairway: 50 m wide, nothing to carry, a wedge in.
//   RISKY   straight at the flag: 246 yd of carry over the sand and the pool to the apron
//           between the obelisks (a 150 mph drive makes it, even into the
//           strongest wind the hole gets, and runs onto the green; an average drive is in
//           the pool, an iron in the sand).
//   ROCKET  over the sand, the pool, the green and the colossi onto the Upper Court, 26 m
//           above the green: only a boosted ball gets up there. The city wall throws a long
//           one back (the very longest comes down on the city roof, 100 m up), and from
//           either it is a flick straight down at the flag.
//   (the right fairway is shorter than the left and tighter, with the oasis beyond it)
// Local metres, x east, y north; the tee is the origin. Heights are metres above the oasis.

const L = require('../lib');

const TEE = [0, 0];
const PIN = [16, 261];                                   // 286 yd straight
const LINE = [TEE, [-34, 150], PIN];                     // the safe way round: 301 yd
const TEE_H = 26, FLOOR = 4, GREEN_H = 5.4, COURT_H = 32, CITY_H = 104;
const OASIS_LEVEL = 1, POOL_LEVEL = 2.2;
const ss = L.smoothstep;

// A polygon's signed distance (positive inside), not worked out at all beyond `reach`
// metres of its bounding box: the height function runs for every node of a big grid.
const near = (poly, reach) => {
  const b = L.bbox(poly);
  return (x, y) => (x < b.minX - reach || x > b.maxX + reach || y < b.minY - reach || y > b.maxY + reach ? -Infinity : L.signedDistance(x, y, poly));
};

// ---- surfaces
const tee = L.rect(-7, -5, 7, 5);
const sandSea = L.blob(13, 160, 23, 45, { wobble: 0.07, seed: 8 });            // 46 x 90 m, on the line
const gatePool = L.blob(16, 213, 15, 12, { wobble: 0.05, seed: 7 });           // water: the far end of the sand, on the line
const leftFairway = L.capsule([[-8, 62], [-40, 120], [-52, 180], [-66, 250]], [36, 50, 52, 48]);
const leftLink = L.capsule([[-54, 214], [-26, 244], [-2, 254]], [40, 34, 26]);  // and turns in to the green
const rightFairway = L.capsule([[16, 62], [54, 112], [70, 170], [76, 220]], [30, 36, 34, 30]);
const apron = L.blob(16, 238, 20, 9, { wobble: 0.04, seed: 5 });               // between the obelisks: where a hero drive lands
const green = L.blob(PIN[0], PIN[1], 19, 16, { wobble: 0.05, seed: 4 });       // 38 x 32 m
const greenApron = L.offsetPolygon(green, 4);
const oasis = L.blob(122, 204, 24, 46, { wobble: 0.08, seed: 6, rotDeg: -8 }); // water: beyond the right fairway
const court = L.blob(16, 327, 40, 19, { wobble: 0.04, seed: 21 });             // the Upper Court: the rocket's landing pad
const roof = L.blob(22, 412, 38, 20, { wobble: 0.04, seed: 22 });              // the city roof: where the very longest rocket comes down
const moat = L.capsule([[-18, 304], [16, 305.5], [50, 304]], 5);               // sand along the court's lip: the last brake
const bunkers = [
  L.blob(-13, 277, 7, 6, { wobble: 0.08, seed: 12, rotDeg: 20 }),              // left of the green
  L.blob(46, 258, 6, 10, { wobble: 0.08, seed: 13, rotDeg: -10 }),             // right of it
  L.blob(-84, 150, 8, 22, { wobble: 0.12, seed: 14 }),                         // a waste along the left fairway
  L.blob(-96, 226, 8, 13, { wobble: 0.12, seed: 15 }),                         // where a long drive leaks left
  L.blob(92, 136, 8, 26, { wobble: 0.12, seed: 16, rotDeg: 8 }),               // a waste between the right fairway and the oasis
  L.blob(48, 230, 6, 7, { wobble: 0.1, seed: 17 }),                            // short right of the apron
  L.blob(24, 96, 8, 6, { wobble: 0.1, seed: 18 }),                             // the desert between the fairways, short of the sea
  moat,
];
// the playable floor: outside it the dunes begin
const basin = L.smoothPolygon([
  [-108, 44], [-40, 34], [44, 34], [104, 48], [152, 112], [164, 200], [152, 276], [-84, 280], [-116, 232], [-126, 140],
], 3);
const campPad = L.blob(-158, 178, 34, 30, { wobble: 0.06, seed: 31 });         // the caravan camp
const standPad = L.blob(78, 268, 22, 14, { wobble: 0.05, seed: 32 });          // the screen and the stands, right of the green

// ---- ground
const sdBasin = near(basin, 110), sdSea = near(sandSea, 8), sdPool = near(gatePool, 8), sdOasis = near(oasis, 12);
const sdGreen = near(greenApron, 20), sdCourt = near(court, 10), sdCamp = near(campPad, 30), sdStand = near(standPad, 14);
const sdBunkers = bunkers.map((b) => near(b, 12));

const ripple = L.fbm({ seed: 801, scaleM: 38, octaves: 3 });
const duneNoise = L.fbm({ seed: 802, scaleM: 150, octaves: 2 });
const edgeNoise = L.fbm({ seed: 803, scaleM: 80, octaves: 2 });
const rockNoise = L.fbm({ seed: 804, scaleM: 30, octaves: 2 });
const STAR_DUNES = [[-196, 70, 90, 15], [206, 40, 100, 17], [-214, 256, 90, 12], [226, 230, 90, 13], [-120, -70, 80, 8], [150, -80, 90, 9]];

// a dune sea: long crests running north-west to south-east, wandering, with star dunes among them
function dunes(x, y) {
  const u = (x * 0.82 + y * 0.57) / 66 + 1.5 * duneNoise(x, y);
  const crest = Math.pow(0.5 + 0.5 * Math.sin(u * Math.PI * 2), 1.7);
  let d = (4.5 + 3.5 * duneNoise(x + 400, y - 300)) * crest + 2.5 * duneNoise(x - 200, y + 500);
  for (const [px, py, r, h] of STAR_DUNES) d += h * L.bump(x, y, px, py, r);
  return d;
}
// rock cut into ledges
const ledges = (h, step, k) => { const t = h / step, f = t - Math.floor(t); return L.lerp(h, step * (Math.floor(t) + ss(0.3, 0.7, f)), k); };

const greenPlane = L.plane(GREEN_H, PIN, -0.008, 0.009);                       // 1.2 %, falling to the front right
// the Upper Court: a lip at the top of the escarpment, then a floor climbing gently to the city wall
const courtFloor = (y) => (y < 320 ? COURT_H + 2 * ss(320, 302, y) : COURT_H + 0.06 * (y - 320));

function height(x, y) {
  // the desert floor, rippled; dunes outside it
  let h = FLOOR + 0.5 * ripple(x, y);
  const out = ss(-4, 66, 12 * edgeNoise(x, y) - sdBasin(x, y));
  if (out) h += out * (2 + dunes(x, y));
  const camp = ss(-24, 0, sdCamp(x, y));
  if (camp) h = L.lerp(h, 6.5, camp);
  const onGreen = ss(-16, 0, sdGreen(x, y));
  if (onGreen) h = L.lerp(h, greenPlane(x, y), onGreen);
  const stand = ss(-10, 0, sdStand(x, y));
  if (stand) h = L.lerp(h, 7, stand);

  // the escarpment behind the green, with the Upper Court on top; the cliff city above that
  const lane = 1 - ss(58, 110, Math.abs(x - 16));                              // straight behind the green the cliffs run true
  const scarpY = y + (1 - lane) * (16 * edgeNoise(x * 1.3, 40) + 0.05 * Math.abs(x - 16));
  const scarp = ss(286, 301, scarpY);
  if (scarp) {
    const top = lane * courtFloor(y) + (1 - lane) * (COURT_H + 1.5 + 0.35 * dunes(x, y) + rockNoise(x, y));
    h = L.lerp(h, top, scarp);
  }
  const wallY = y + (1 - lane) * (22 * edgeNoise(x * 1.1, 300) - 0.04 * Math.abs(x - 16));
  const wall = ss(352, 384, wallY);
  if (wall) h = L.lerp(h, lane * (CITY_H + 0.03 * Math.max(0, y - 392)) + (1 - lane) * ledges(CITY_H - 8 + 5 * rockNoise(x * 0.5, y * 0.5), 9, 0.6), wall);

  // the bluff the tee stands on: its lip is the front of the tee, so the whole hole is in view
  const bluff = ss(30, 6, y + 0.004 * x * x) * (1 - ss(120, 190, Math.abs(x)));
  if (bluff) h = L.lerp(h, ledges(TEE_H + 0.8 * rockNoise(x, y) * ss(10, 30, Math.hypot(x, y)) + 6 * ss(-40, -110, y), 7, 0.4 * ss(12, 40, Math.hypot(x, y))), bluff);

  // sand lies in hollows with a lip
  const sea = sdSea(x, y);
  if (sea > 0) h -= 1.0 * ss(0, 5, sea);
  for (let i = 0; i < bunkers.length; i++) {
    const sand = sdBunkers[i](x, y);
    if (sand > 0) h -= 0.55 * ss(0, 3, sand);
  }
  // water lies level, below the desert: the oasis, and the Gate Pool in the sand
  const wet = ss(0, 6, sdOasis(x, y));
  if (wet) h = L.lerp(h, OASIS_LEVEL, wet);
  const pool = ss(0, 4, sdPool(x, y));
  if (pool) h = L.lerp(h, POOL_LEVEL, pool);
  return h;
}

// ---- trees (drawn as desert palms, and obstacles): groves round the oasis, a few at the camp
const ROCKET_LINE = [TEE, [21, 350]];
const mown = [leftFairway, leftLink, rightFairway, apron, green, court, roof, sandSea, ...bunkers];
const waters = [gatePool, oasis];
const openGround = (x, y, m = 5) => mown.every((p) => L.signedDistance(x, y, p) < -m) && waters.every((p) => L.signedDistance(x, y, p) < -3);
const trees = [
  ...L.clusterTrees(150, 196, { count: 11, radius: 16, seed: 81, keep: openGround }),
  ...L.clusterTrees(134, 262, { count: 9, radius: 14, seed: 82, keep: openGround }),
  ...L.clusterTrees(128, 144, { count: 7, radius: 12, seed: 83, keep: openGround }),
  ...L.clusterTrees(-160, 150, { count: 6, radius: 12, seed: 84, keep: openGround }),
  ...L.clusterTrees(-150, 208, { count: 5, radius: 10, seed: 85, keep: openGround }),
];

// ---- props
const P = (kind, x, y, heightM, rotDeg = 0) => L.prop(kind, x, y, { heightM, rotDeg });
const face = (kind, x, y, heightM, tx, ty) => P(kind, x, y, heightM, L.facing(x, y, tx, ty));
const offLine = (x, y, m = 9) => L.distToSegment(x, y, TEE[0], TEE[1], PIN[0], PIN[1]) > m;
const cacti = L.scatterTrees(L.rect(-236, -96, 256, 300), { spacing: 30, jitter: 0.45, seed: 85, keep: (x, y) => openGround(x, y, 4) && offLine(x, y, 14) && L.distToPolyline(x, y, ROCKET_LINE) > 14 })
  .filter(([x, y]) => Math.hypot(x, y) > 16 && L.signedDistance(x, y, campPad) < -2 && L.signedDistance(x, y, standPad) < -2 && height(x, y) < 24)
  .map(([x, y], i) => P('cactus', x, y, 3.5 + (i % 4) * 0.9, (i * 67) % 360));

const props = [
  // --- the tee on its bluff: banners, torches, a crowd, a ruined colonnade behind
  P('flag-banner', -16, -9, 8, 20), P('flag-banner', -10, -12, 8, 10), P('flag-banner', 10, -12, 8, -10), P('flag-banner', 16, -9, 8, -20),
  P('torch', -11, 7, 3.2), P('torch', 11, 7, 3.2),
  face('crowd', -26, -8, 2.8, 0, 0), face('crowd', 26, -10, 2.8, 0, 0),
  face('ruins', -44, -34, 9, 0, 0), face('ruins', 40, -40, 8, 0, 0), P('obelisk', -30, -24, 12), P('obelisk', 30, -26, 12),
  P('palm', -22, -30, 10, 40), P('palm', 20, -34, 11, 200),

  // --- the Gate: an obelisk either side of the apron, torches up to the green
  P('obelisk', -9, 227, 18), P('obelisk', 58, 238, 18),
  P('torch', -8, 246, 3.2), P('torch', 40, 246, 3.2), P('torch', -8, 278, 3.2), P('torch', 40, 280, 3.2),
  // four colossi seated against the escarpment, watching the green
  ...[-28, -6, 40, 62].map((x) => face('statue', x, 290, 22, x, 200)),
  // the screen, the stands and the crowd
  face('jumbotron', 82, 272, 13, PIN[0], PIN[1]), face('grandstand', 74, 256, 9, PIN[0], PIN[1]),
  face('crowd', 60, 276, 2.8, PIN[0], PIN[1]), face('crowd', -34, 268, 2.8, PIN[0], PIN[1]), face('crowd', -28, 250, 2.8, PIN[0], PIN[1]),
  P('flag-banner', -24, 282, 7, 150), P('flag-banner', 56, 284, 7, 210),
  P('fireworks', -30, 300, 26), P('fireworks', 62, 300, 26),

  // --- the Upper Court: avenues of obelisks, the city gate and its colossi, towers on the wall
  ...[308, 320, 332, 344].flatMap((y) => [P('obelisk', -32, y, 13), P('obelisk', 64, y, 13)]),
  face('gate', 44, 366, 34, 44, 200), face('statue', 76, 356, 26, 76, 200), face('statue', -18, 358, 26, -18, 200),
  P('torch', -26, 314, 3.4), P('torch', 58, 314, 3.4), P('torch', -26, 338, 3.4), P('torch', 58, 338, 3.4),
  face('crowd', -40, 326, 2.8, 16, 327), face('crowd', 72, 328, 2.8, 16, 327),
  P('flag-banner', -24, 302, 8), P('flag-banner', 56, 302, 8),
  face('tower', -60, 404, 26, -60, 200), face('tower', 100, 404, 26, 100, 200), face('tower', -150, 420, 22, -150, 200), face('tower', 190, 424, 22, 190, 200),
  face('castle', 22, 462, 40, 22, 200), face('temple', -100, 456, 26, -100, 200), face('temple', 136, 460, 24, 136, 200),
  P('ruins', -30, 420, 10, 30), P('ruins', 76, 426, 10, 200), P('obelisk', -24, 400, 20), P('obelisk', 68, 402, 20),
  // the pyramids: two on the escarpment either side of the court, one beyond the city, small ones in the dunes
  P('pyramid', -96, 336, 58, 12), P('pyramid', 132, 342, 68, -8), P('pyramid', 40, 520, 90, 20),
  P('pyramid', -200, 330, 34, 30), P('pyramid', 214, 326, 30, -20), P('pyramid', -196, 76, 22, 15), P('pyramid', 206, 44, 26, -10), P('pyramid', 180, 300, 16, 5),

  // --- the sphinx watches the split; ruins and a statue among the fairways
  face('sphinx', 112, 84, 16, 20, 60), P('ruins', -82, 96, 7, 60), face('statue', -92, 250, 12, -40, 200), P('ruins', 30, 60, 5, 120),
  P('obelisk', -70, 60, 11), P('obelisk', 84, 64, 11),

  // --- the oasis: palms at the water, a boat, huts under the trees
  P('palm', 94, 196, 10, 40), P('palm', 96, 232, 9, 200), P('palm', 104, 256, 11, 120), P('palm', 150, 170, 10.5, 300), P('palm', 152, 236, 9.5, 75),
  P('palm', 124, 150, 8.5, 160), P('palm', 140, 258, 10, 20), P('palm', 108, 162, 9, 260),
  P('boat', 124, 196, 5, 70), face('hut', 156, 214, 4.5, 122, 204), face('hut', 148, 150, 4.5, 122, 180), face('hut', 160, 190, 4, 122, 204),
  P('fountain', 150, 276, 4), face('crowd', 96, 176, 2.6, 60, 170),

  // --- the caravan camp in the western dunes: huts round a well, banners, torches
  ...[[-176, 190, 5], [-166, 200, 4.5], [-150, 204, 5], [-138, 194, 4.5], [-174, 166, 5], [-158, 158, 4.5], [-142, 164, 5]].map(([x, y, h]) => face('hut', x, y, h, -158, 180)),
  P('fountain', -158, 180, 3.5), P('flag-banner', -182, 178, 7, 90), P('flag-banner', -132, 180, 7, 270),
  P('torch', -168, 182, 3), P('torch', -148, 178, 3), P('torch', -158, 192, 3), P('torch', -158, 168, 3),
  P('palm', -184, 196, 10, 30), P('palm', -130, 206, 9, 120), P('palm', -180, 156, 11, 250),
  face('crowd', -112, 176, 2.6, -48, 180),

  // --- on the horizon and overhead
  P('mesa', -250, 470, 50, 30), P('mesa', 270, 480, 46, 200), P('mesa', -256, -100, 30, 100), P('mesa', 268, -96, 34, 300),
  P('balloon', -130, 230, 22), P('balloon', 180, 110, 22), P('balloon', -60, 380, 24), P('airship', -170, 300, 26, 60),
  P('bird-flock', 60, 140, 10), P('bird-flock', -100, 60, 10), P('cloud', -220, 500, 28), P('cloud', 240, 520, 28),
  ...cacti,
].filter((p) => L.FLOATING_PROP_KINDS.includes(p.kind) || (openGround(p.x, p.y, 3) && L.signedDistance(p.x, p.y, tee) < -3 && offLine(p.x, p.y, L.SLIM_PROP_KINDS.includes(p.kind) ? 6 : 9)));

// ---- gadgets (docs/gadgets.md): what a swing can hit
//   RISKY   the Gate Ring hangs on the line at the flag where a 132 to 145 mph drive is
//           coming down toward the pool: through it and the ball flies on over the water
//           (a 150 mph drive passes over the top of it and needs no help).
//           The apron beyond the pool is a x3 landing ring.
//   SAFE    the Caravan Road, a speed strip down the left fairway, runs a lay-up on toward
//           the turn; the Oasis Spring, a pad at the end of the right fairway, throws a
//           ball that reaches it over the bunker at the green.
//   ROCKET  coins up the Rocket's climb to the Upper Court.
const gateDrive = L.flight(height, TEE, PIN, { speedMph: 138, vla: 13, spin: 2700 });
const courtRocket = L.flight(height, TEE, [16, 327], { speedMph: 150, vla: 12, spin: 2600, ball: 'rocket' });
const gadgets = [
  gateDrive.ring('gate-ring', 186, { radius: 8, strength: 1.25 }),
  L.gadget('zone', 'gate-x3', 16, 239, { radius: 8, mult: 3 }),
  L.gadget('strip', 'caravan-road', -58, 228, { size: [30, 34], heading: 62, strength: 8, maxMps: 10 }),
  L.gadget('pad', 'oasis-spring', 82, 188, { radius: 6, heading: L.bearing([82, 188], PIN), angle: 50, minMps: 33, maxMps: 33 }),   // onto the front of the green: a putt, not a tap-in
  courtRocket.coins('court-coins', 50, 290, 7),
];

module.exports = {
  id: 'pharaohs-gate',
  stage: {
    number: 8, role: 'match', order: 8,
    name: "Pharaoh's Gate", theme: 'desert',
    origin: { lat: 24.0, lon: -152.0 },
    conditions: 'calm',
    wind: { min: 6, max: 14 },                   // open desert: a steady wind off the dunes
    timeOfDay: 'golden',
    blurb: 'Drivable par 4. Round the Great Sand Sea, over it, or rocket to the Upper Court.',
    difficulty: 2,
  },
  extent: { minX: -270, minY: -140, maxX: 290, maxY: 560 },
  hole: {
    par: 4,
    name: "Pharaoh's Gate",
    line: LINE,
    note: 'From the bluff the fairway splits round the Great Sand Sea. Left is wide and safe; right is shorter and tighter; straight at the flag is 246 yards of carry over the sand and the Gate Pool. A Rocket flies it all to the Upper Court.',
    greenNote: 'At the feet of the colossi, tilted gently to the front right. The Gate Pool is short of it, sand left and right, the escarpment behind.',
    routes: [
      { id: 'safe', name: 'The Left Fairway', note: 'Wide and dry, round the Great Sand Sea: a hybrid or a drive, then a wedge.' },
      { id: 'risky', name: 'Knock on the Gate', note: 'Straight at the flag: 246 yards of carry over the sand and the Gate Pool, and it runs on.' },
      { id: 'rocket', name: 'The Upper Court', note: 'A Rocket clears the lot and lands on top of the escarpment. A flick down from there.' },
    ],
  },
  surfaces: [
    { kind: 'tee', poly: tee },
    { kind: 'fairway', poly: leftFairway },
    { kind: 'fairway', poly: leftLink },
    { kind: 'fairway', poly: rightFairway },
    { kind: 'fairway', poly: apron },
    { kind: 'fairway', poly: court },
    { kind: 'fairway', poly: roof },
    { kind: 'green', poly: green },
    { kind: 'bunker', poly: sandSea },
    ...bunkers.map((poly) => ({ kind: 'bunker', poly })),
    { kind: 'water', poly: gatePool },
    { kind: 'water', poly: oasis },
  ],
  trees,
  // darker ground: the caravan roads, the rock of the escarpment and the city wall
  woods: [
    L.capsule([[-130, 182], [-96, 196], [-70, 250], [-40, 268]], 7),
    L.capsule([[96, 100], [84, 180], [70, 250]], 6),
    L.capsule([[-90, 293], [16, 294], [120, 293]], 12),
    L.capsule([[-90, 372], [16, 374], [120, 372]], 30),
  ],
  props,
  gadgets,
  // far out over the dunes on every side, and up in the cliff city
  obLine: L.rect(-252, -122, 272, 486),
  height,
  sea: false,
  probes: [
    { at: [9, 160], kind: 'bunker', what: 'the Great Sand Sea, on the direct line' },
    { at: [11.5, 190], kind: 'bunker', what: 'the sand 208 yd out on the direct line' },
    { at: [13, 213], kind: 'water', what: 'the Gate Pool, 233 yd out on the direct line' },
    { at: [14.5, 237], kind: 'fairway', what: 'the apron 260 yd out on the direct line' },
    { at: [-40, 120], kind: 'fairway', what: 'the left fairway' },
    { at: [-48, 180], kind: 'fairway', what: 'the left fairway beside the sand' },
    { at: [-62, 236], kind: 'fairway', what: 'the left fairway where a long drive finishes' },
    { at: [58, 120], kind: 'fairway', what: 'the right fairway' },
    { at: [16, 327], kind: 'fairway', what: 'the Upper Court' },
    { at: [22, 412], kind: 'fairway', what: 'the city roof' },
    { at: [16, 305.5], kind: 'bunker', what: 'the sand along the court\'s lip' },
    { at: [122, 204], kind: 'water', what: 'the oasis' },
    { at: [92, 222], kind: 'rough', what: 'through the right fairway is desert, not water' },
    { at: [-13, 277], kind: 'bunker', what: 'the bunker left of the green' },
    { at: [46, 258], kind: 'bunker', what: 'the bunker right of the green' },
    { at: [4, 104], kind: 'rough', what: 'the desert between the fairways' },
    { at: [16, 293], kind: 'rough', what: 'the escarpment behind the green' },
    { at: [-110, 120], kind: 'rough', what: 'a wide miss left is still in play' },
    { at: [150, 100], kind: 'rough', what: 'a wide miss right is still in play' },
    { at: [-262, 150], kind: 'ob', what: 'far over the western dunes' },
    { at: [282, 150], kind: 'ob', what: 'far over the eastern dunes' },
  ],
};
