'use strict';
// Canyon Run: par 4, 357 yd round the canyon floor, 310 yd straight at the flag.
// The tee stands on a butte 30 m above the canyon floor. The green is on a mesa that rises
// out of a gorge 54 m deep, as high as the tee near enough and 262 m away: no plain drive
// gets up there. Three ways to play it (hole.routes):
//   SAFE    the Canyon Floor: a wide fairway up the canyon, no carry, then a ramp of mown
//           ground up the land bridge to the mesa. A mid iron uphill to finish.
//   RISKY   the East Rim: 185 yd of carry across the gorge to a shelf on the far rim (the
//           Porch). A natural rock bridge leads on to the green: a 65 yd flick, level.
//   ROCKET  Over the Top: 285 yd of carry straight at the flag, onto the mesa.
// Local metres, x east, y north; the tee is the origin. Heights are metres above the canyon
// floor at its low end; the gorge floor is at -26.

const L = require('../lib');
const D = require('../detail-a');

const TEE = [0, 0];
const PIN = [98, 266];                          // 310 yd straight, bearing 20 degrees
const LINE = [TEE, [-10, 120], [-2, 200], [40, 250], PIN];
const MESA = [95, 270];
const TEE_H = 30;
const MESA_H = 28;
const PORCH_H = 24.5;
const GORGE_FLOOR = -26;

// ---- outlines
const mesaTop = L.blob(MESA[0], MESA[1], 26, 24, { wobble: 0.05, seed: 5, n: 72 });
// the mesa's rim between two angles (degrees, counter-clockwise from east), clockwise
const mesaRim = (from, to) => {
  const out = [];
  for (let a = from; a >= to; a -= 5) out.push(mesaTop[(((Math.round(a / 5) % 72) + 72) % 72)]);
  return out;
};
// The gorge: rim to rim, from its box end south of the tee to the mesa's foot. It wraps the
// mesa's south side between the land bridge (west) and the rock bridge (south-east).
const gorge = L.ensureCCW([
  [30, -50], [66, -52], [82, 0], [93, 60], [97, 120], [93, 146], [90, 158], [100, 190], [109, 214], [114, 228],
  ...mesaRim(295, 240),
  [75, 243], [64, 236], [51, 220], [43, 204], [39, 188], [34, 150], [30, 100], [27, 50], [25, 10], [26, -20],
]);
// The back gorge: round the mesa's east and north sides, shut in by the two bridges.
const backGorge = L.ensureCCW([
  [131, 237], [150, 240], [154, 290], [148, 322], [100, 326], [66, 322], [60, 306], [64, 290],
  ...mesaRim(150, -40),
]);
// the whole inner canyon: floor, gorge, mesa and the east shelf. The walls rise outside it.
const canyon = L.smoothPolygon([
  [-52, 10], [-50, -30], [-30, -52], [20, -60], [68, -58], [88, 0], [98, 60], [101, 118], [118, 130], [142, 146],
  [155, 180], [157, 235], [158, 290], [152, 326], [100, 331], [60, 333], [0, 334], [-40, 322], [-56, 262],
  [-58, 200], [-54, 120], [-50, 60],
], 2);

// ---- surfaces
const tee = L.rect(-6, -5, 6, 5);
const butte = L.blob(0, -1, 11, 10, { wobble: 0.06, seed: 2 });
const RAMP = [[-2, 200], [30, 240], [64, 259]];
const fairway = L.capsule([[-4, 58], [-10, 120], ...RAMP], [42, 56, 60, 34, 26]);
const rampBed = L.capsule(RAMP, [46, 40, 32]);
const PORCH = [[113, 155], [127, 190], [131, 216]];
const porch = L.capsule(PORCH, [38, 42, 30]);                               // the East Rim shelf
const neck = L.capsule([[124, 229], [110, 252]], 12, { capN: 4 });          // the rock bridge to the mesa
const green = L.blob(MESA[0], MESA[1], 18, 15, { wobble: 0.05, seed: 4 });  // 36 x 30 m
const waste = L.blob(17, 128, 11, 40, { wobble: 0.1, seed: 7 });           // the long waste bunker by the rim
const bunkers = [
  waste,
  L.blob(-26, 240, 6.5, 5, { wobble: 0.1, seed: 21, rotDeg: 30 }),          // through the corner, left
  L.blob(-6, 256, 7, 5, { wobble: 0.1, seed: 22, rotDeg: -20 }),            // through the corner, straight on
  L.blob(-42, 150, 5, 9, { wobble: 0.12, seed: 23 }),                       // the west side of the landing area
  L.blob(75.5, 286, 4.5, 3.8, { wobble: 0.08, seed: 24 }),                  // on the mesa, left of the green
  L.blob(139, 176, 4.5, 9, { wobble: 0.1, seed: 25 }),                      // the back of the Porch
];
const camp = L.blob(8, 290, 46, 28, { wobble: 0.08, seed: 31 });            // the mining camp's bench

// ---- ground
const sdCanyon = D.sdf(canyon, 260), sdGorge = D.sdf(gorge, 12), sdBack = D.sdf(backGorge, 12);
const sdButte = D.sdf(butte, 12), sdRamp = D.sdf(rampBed, 14), sdMesa = D.sdf(mesaTop, 8);
const sdPorch = D.sdf(L.offsetPolygon(porch, 3), 12), sdNeck = D.sdf(neck, 6), sdCamp = D.sdf(camp, 20);
const sdBunkers = bunkers.map((b) => D.sdf(b, 6));
const floorY = D.profile([[-60, 1], [40, 1], [62, 3], [120, 9.5], [166, 15.2], [178, 16], [200, 16], [262, 18], [334, 21]]);
// how far up the ramp a point is, 0 at the corner .. 1 at the mesa: along its chord, so the
// climb is one even grade (16 %) however the fairway bends
const rampAt = (x, y) => L.clamp(((x - 10) * 54 + (y - 212) * 47) / (54 * 54 + 47 * 47), 0, 1);
const mesaPlane = L.plane(MESA_H, MESA, 0.011, 0.008);                      // 1.4 %
const wallNoise = L.fbm({ seed: 201, scaleM: 70, octaves: 3 });
const rockNoise = L.fbm({ seed: 202, scaleM: 16, octaves: 2 });
const floorNoise = L.fbm({ seed: 203, scaleM: 45, octaves: 2 });
// buttes standing on the rim country: [x, y, radius, height]
const BUTTES = [[-136, 318, 34, 24], [196, -46, 30, 22], [204, 352, 36, 26], [-140, -70, 30, 18], [208, 150, 26, 16], [-150, 150, 24, 14], [60, -96, 26, 16]];
// mounds on the canyon floor, off the mown ground: [x, y, radius, height]
const MOUNDS = [[-46, 96, 9, 1.6], [-48, 190, 10, 1.8], [-38, 262, 11, 2.2], [26, 268, 9, 1.6], [30, 180, 7, 1.3], [-38, 44, 8, 1.5]];

function height(x, y) {
  // the canyon floor climbs from the butte to the camp; east of the gorge the rim is a bench
  let h = L.lerp(floorY(y) + 0.3 * floorNoise(x, y), PORCH_H, L.smoothstep(58, 92, x));
  for (const [cx, cy, r, top] of MOUNDS) h += top * L.bump(x, y, cx, cy, r);
  const onCamp = D.inside(sdCamp(x, y), 18);
  if (onCamp) h = L.lerp(h, 19 + 0.6 * floorNoise(x + 90, y), onCamp);
  // the ramp of mown ground from the corner up the land bridge to the mesa
  const onRamp = D.inside(sdRamp(x, y), 12);
  if (onRamp) h = L.lerp(h, L.lerp(16, MESA_H - 0.4, rampAt(x, y)), onRamp);
  const onPorch = D.inside(sdPorch(x, y), 9);
  if (onPorch) h = L.lerp(h, PORCH_H + 0.035 * (y - 150), onPorch);
  const onNeck = D.inside(sdNeck(x, y), 4);
  if (onNeck) h = L.lerp(h, 26.8, onNeck);
  const onMesa = D.inside(sdMesa(x, y), 6);
  if (onMesa) h = L.lerp(h, mesaPlane(x, y), onMesa);
  // the tee's butte: three bands of rock
  const onButte = D.inside(sdButte(x, y), 11);
  if (onButte) h = L.lerp(h, TEE_H, D.terrace(onButte, 0.25, 0.5));
  for (const sd of sdBunkers) {
    const sand = sd(x, y);
    if (sand > 0) h -= 0.5 * L.smoothstep(0, 3, sand);
  }
  // the canyon's walls: terraced red rock, 55 m of it, and the rim country beyond
  const out = -sdCanyon(x, y);
  if (out > 0) {
    const n = wallNoise(x, y);
    const rise = 30 * L.smoothstep(0, 42, out + 5 * n) + 14 * L.smoothstep(42, 150, out);
    h += D.terrace(rise + 2.5 * n, 8, 0.28) + 0.8 * rockNoise(x, y) * L.smoothstep(0, 12, out);
    for (const [cx, cy, r, top] of BUTTES) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < r) h += D.terrace(top * L.smoothstep(r, 0.62 * r, d), 7, 0.25);
    }
  }
  // the gorge: sheer, in four bands, to a level floor
  const drop = Math.max(sdGorge(x, y), sdBack(x, y));
  if (drop > 0) h = L.lerp(h, GORGE_FLOOR, D.terrace(L.smoothstep(0, 10, drop), 0.25, 0.4));
  return h;
}

const surfaces = [
  { kind: 'tee', poly: tee },
  { kind: 'fairway', poly: fairway },
  { kind: 'fairway', poly: porch },
  { kind: 'green', poly: green },
  ...bunkers.map((poly) => ({ kind: 'bunker', poly })),
  { kind: 'water', poly: gorge },
  { kind: 'water', poly: backGorge },
];

// cottonwoods and scrub: massed along the foot of the west wall, round the camp, on the rims
const gentle = (x, y) => D.slopeOf(height, x, y) < 0.35;
const trees = D.cleanTrees([
  ...L.scatterTrees(L.rect(-58, 30, -38, 252), { spacing: 9, seed: 41 }),
  ...L.scatterTrees(camp, { spacing: 11, seed: 42 }),
  ...L.scatterTrees(L.rect(-48, -52, 22, -22), { spacing: 10, seed: 43 }),
  ...L.scatterTrees(L.rect(26, 262, 58, 282), { spacing: 9, seed: 44 }),
  ...L.clusterTrees(148, 200, { count: 7, radius: 9, seed: 45 }),
  ...L.clusterTrees(-120, 230, { count: 8, radius: 22, seed: 46 }),
  ...L.clusterTrees(176, 60, { count: 7, radius: 20, seed: 47 }),
  ...L.clusterTrees(-110, -40, { count: 6, radius: 18, seed: 48 }),
  ...L.clusterTrees(120, 356, { count: 7, radius: 22, seed: 49 }),
], { surfaces, tee: TEE, pin: PIN, clearM: 5, ok: gentle });

// ---- props
const P = D.P;
const face = (kind, x, y, heightM, to) => P(kind, x, y, heightM, L.facing(x, y, to[0], to[1]));
const props = D.clean([
  // needles of rock standing in the gorge, up to the height of the rims
  P('rock-spire', 44, 28, 40, 20), P('rock-spire', 62, 68, 48, 140), P('rock-spire', 80, 112, 52, 260), P('rock-spire', 86, 168, 50, 70),
  P('rock-spire', 56, 214, 42, 310), P('rock-spire', 60, -22, 34, 190), P('rock-spire', 48, 62, 30, 95), P('rock-spire', 132, 268, 40, 230),
  P('rock-spire', 96, 310, 38, 15), P('rock-spire', 140, 304, 46, 170), P('rock-spire', 74, 28, 44, 285), P('rock-spire', 44, 172, 24, 60),
  // arches on the rims: beside the tee, on the west wall, behind the mesa, over the camp
  P('rock-arch', -112, 62, 18, 70), P('rock-arch', 104, -56, 16, 20), P('rock-arch', 178, 300, 20, 95), P('rock-arch', 30, 356, 17, 5),
  // the mining camp on the bench at the canyon's head
  face('cabin', -12, 296, 7, PIN), face('cabin', 6, 304, 7.5, PIN), face('cabin', 24, 300, 7, PIN), face('cabin', -30, 284, 6.5, PIN),
  P('tower', 42, 306, 17, 0), P('windmill', -34, 304, 20, 150), face('gate', 6, 322, 10, [6, 280]), P('statue', 6, 286, 6, 160),
  P('giant-tree', -44, 268, 26, 0),
  ...D.ringOf('torch', 6, 286, 11, 8, { h: 3.2, seed: 3 }),
  face('grandstand', -8, 276, 9, PIN), face('crowd', 34, 284, 3.2, PIN), face('crowd', 46, 292, 3, PIN), face('crowd', 14, 272, 3, [30, 240]),
  // cliff dwellings and a lookout on the west wall, a water tower above the Porch
  face('ruins', -88, 150, 9, [-10, 150]), face('ruins', -96, 208, 8, [-10, 208]), P('tower', -124, 118, 14, 0), P('tower', 168, 196, 13, 0),
  // rope bridges: out to the tee's butte, and from the camp across the back gorge to the mesa
  P('bridge', 0, -33, 34, 0), P('bridge', 68, 292, 26, 112),
  // water coming over the walls into the back gorge
  face('waterfall', 112, 330, 36, [112, 300]), face('waterfall', 160, 266, 32, [130, 268]),
  // the event: a screen on the far rim, banners up the ramp and round the green, torches
  face('jumbotron', 128, 346, 16, TEE),
  P('flag-banner', -9, 4, 4, 0), P('flag-banner', 10, 2, 4, 0),
  ...D.beside(RAMP, 6, 21).map(([x, y]) => P('flag-banner', x, y, 7, 0)),
  ...D.beside(RAMP, 6, -18.5).map(([x, y]) => P('torch', x, y, 3, 0)),
  P('flag-banner', 84, 292, 7, 0), P('flag-banner', 106, 292, 7, 0), P('flag-banner', 118, 276, 7, 0),
  ...D.beside(PORCH, 4, -23).map(([x, y]) => P('flag-banner', x, y, 7, 0)),
  // cactus country
  ...D.scatter('cactus', { x: -47, y: 130, r: 8, ry: 90 }, 14, { h: [3, 7], seed: 11, minGap: 7 }),
  ...D.scatter('cactus', { x: 8, y: 292, r: 44, ry: 26 }, 9, { h: [3, 6.5], seed: 12, minGap: 8 }),
  ...D.scatter('cactus', { x: -12, y: -36, r: 30, ry: 14 }, 7, { h: [3, 6], seed: 13, minGap: 6 }),
  ...D.scatter('cactus', { x: 146, y: 190, r: 6, ry: 40 }, 6, { h: [3, 6], seed: 14, minGap: 7 }),
  ...D.scatter('cactus', { x: -110, y: 140, r: 40, ry: 150 }, 12, { h: [4, 8], seed: 15, minGap: 14 }),
  ...D.scatter('cactus', { x: 180, y: 180, r: 30, ry: 160 }, 10, { h: [4, 8], seed: 16, minGap: 14 }),
  ...D.scatter('cactus', { x: 40, y: 360, r: 120, ry: 20 }, 8, { h: [4, 8], seed: 17, minGap: 14 }),
  P('cactus', 20, 12, 5, 0), P('cactus', -17, -9, 6, 0), P('cactus', 22, 196, 5, 0), P('cactus', 121, 244, 4, 0), P('cactus', 108, 250, 3.5, 0),
  // the country beyond: mesas on every horizon
  P('mesa', -420, 300, 90, 0), P('mesa', -380, -150, 70, 40), P('mesa', 520, 200, 110, 80), P('mesa', 430, 520, 95, 20), P('mesa', 150, 640, 120, 0),
  P('mesa', -200, 620, 100, 60), P('mesa', 620, -80, 80, 10), P('mesa', 300, -320, 70, 30), P('mesa', -60, -380, 85, 50),
  // in the air
  P('balloon', -60, 180, 22, 0), P('balloon', 150, 90, 22, 40), P('balloon', 40, 350, 24, 80), P('airship', 150, 420, 30, 250),
  P('cloud', -180, 260, 40, 0), P('cloud', 220, 330, 46, 0), P('cloud', 60, 520, 50, 0), P('cloud', -120, -60, 38, 0), P('cloud', 260, 60, 44, 0),
  P('bird-flock', 66, 120, 8, 20), P('bird-flock', 118, 292, 8, 200), P('bird-flock', -40, 240, 8, 110), P('bird-flock', 30, 40, 8, 300),
  P('fireworks', 134, 306, 30, 0), P('fireworks', 62, 326, 30, 0),
], { surfaces, tee: TEE, pin: PIN, dry: gentle });

// ---- gadgets (docs/gadgets.md): what a swing can hit
//   ROCKET  Over the Top is barred by the Barricade: a wall hanging 45 m out on the line at
//           the flag that only a ball of 150 mph or more (or a Rocket) smashes. Behind it
//           the Mesa Ring throws the ball that got through on over the gorge: 150 to 165 mph
//           finishes on the mesa (the Mesa Wall at its back stops the hot ones). Anything
//           slower comes back off the Barricade to the foot of the butte.
//   SAFE    the Ramp Runner, a speed strip at the turn, carries a drive that reaches it on
//           up the ramp toward the green.
//   RISKY   coins across the gorge on the line to the Porch, and the Porch is a x2 landing.
const porchDrive = L.flight(height, TEE, [122, 185], { speedMph: 142, vla: 13.5, spin: 3400 });
const gadgets = [
  L.gadget('breakable', 'barricade', 15.55, 42.23, { z: 33, size: [16, 14], heading: 200.22, breakMph: 150, keep: 1, style: 'wall' }),
  L.gadget('ring', 'mesa-ring', 41.53, 112.72, { z: 52.9, radius: 8, heading: 20.22, strength: 1.36 }),
  L.gadget('backboard', 'mesa-wall', 103.5, 286.5, { size: [26, 16], heading: 200.22, strength: 0.15 }),
  L.gadget('strip', 'ramp-runner', -9, 224, { size: [34, 40], heading: 55, strength: 8, maxMps: 11 }),
  L.gadget('zone', 'porch-x2', 124, 188, { radius: 12, mult: 2 }),
  porchDrive.coins('gorge-coins', 45, 175, 6),
];

module.exports = {
  id: 'canyon-run',
  stage: {
    number: 2, role: 'match', order: 2,
    name: 'Canyon Run', theme: 'canyon',
    origin: { lat: 36.2, lon: -140.0 },
    baseM: 900,
    wind: { min: 5, max: 14 },                   // it funnels along the gorge
    timeOfDay: 'golden',
    blurb: 'Up the canyon floor, across to the East Rim, or a Rocket over the gorge to the mesa.',
    difficulty: 2,
  },
  extent: { minX: -170, minY: -110, maxX: 230, maxY: 400 },
  hole: {
    par: 4,
    name: 'Canyon Run',
    line: LINE,
    note: 'From a butte, 25 metres down to the canyon floor. The green is on a mesa in the gorge, level with the tee and 310 yards off: follow the fairway round and up the land bridge, or carry the gorge to the East Rim.',
    greenNote: 'A mesa with the gorge on every side but the ramp. Long is gone.',
    routes: [
      { id: 'safe', name: 'The Canyon Floor', note: 'Wide fairway all the way, no carry. It leaves a mid iron uphill, up the ramp.' },
      { id: 'risky', name: 'The East Rim', note: 'Carry the gorge, 185 yards, to the Porch on the far rim. A flick over the rock bridge from there.' },
      { id: 'rocket', name: 'Over the Top', note: 'A Rocket straight at the flag: 285 yards of carry, up onto the mesa. An eagle putt.' },
    ],
  },
  surfaces,
  trees,
  woods: [],
  props,
  gadgets,
  // up the walls on every side: a ball that reaches them comes back down
  obLine: [[-120, -80], [190, -80], [190, 372], [-120, 372]],
  height,
  sea: false,
  probes: [
    { at: [60, 100], kind: 'water', what: 'the gorge' },
    { at: [76, 216], kind: 'water', what: 'the gorge in front of the mesa' },
    { at: [136, 282], kind: 'water', what: 'the back gorge' },
    { at: [95, 308], kind: 'water', what: 'long of the mesa' },
    { at: [17, 128], kind: 'bunker', what: 'the waste bunker' },
    { at: [-10, 120], kind: 'fairway', what: 'the first landing area' },
    { at: [-2, 200], kind: 'fairway', what: 'the corner' },
    { at: [47, 249], kind: 'fairway', what: 'the ramp up the land bridge' },
    { at: [126, 188], kind: 'fairway', what: 'the Porch on the East Rim' },
    { at: [117, 241], kind: 'rough', what: 'the rock bridge' },
    { at: [95, 291], kind: 'rough', what: 'the back of the mesa' },
    { at: [0, -10], kind: 'rough', what: 'the tee butte' },
    { at: [8, 290], kind: 'rough', what: 'the mining camp' },
    { at: [-150, 100], kind: 'ob', what: 'over the west wall' },
    { at: [215, 100], kind: 'ob', what: 'over the east rim' },
  ],
};
