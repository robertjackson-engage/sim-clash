'use strict';
// Frostbite Ridge: par 4, 388 yd round the ridge, 333 yd straight at the flag. The tee is a
// summit ledge 44 m above a frozen lake; the green sits on a shelf on the lake's far shore,
// under an icefall; above the icefall hangs a glacier cirque, and peaks stand all round.
// Three ways to play it (docs/dev/arcade-v2-contract.md, "Routes"):
//   SAFE    down the ridge, the long way round the lake: 50 m of fairway, nothing to carry,
//           a wedge left over the top of the lake.
//   RISKY   straight at the flag: 266 yd of carry over the ice to the shelf below the green
//           (a 150 mph drive makes it and is chipping for eagle; a 135 mph one is on the ice).
//   ROCKET  over the lake, the green and the icefall into the cirque, 40 m above the green:
//           only a boosted ball gets up there. Its headwall throws a long one back onto the
//           floor, and from the floor it is a flick straight down at the flag.
// The lake and the frozen river in the west gully are `water` polygons: a ball on the ice
// is a penalty, dropped where it crossed.
// Local metres, x east, y north; the tee is the origin. Heights are metres above the ice.

const L = require('../lib');

const TEE = [0, 0];
const TURN = [-30, 225];
const PIN = [50, 300];
const LINE = [TEE, TURN, [-6, 292], PIN];                // down the ridge and round the top of the lake
const TEE_H = 44;
const CIRQUE_H = 40;
const ss = L.smoothstep;

// A polygon's signed distance (positive inside), not worked out at all beyond `reach`
// metres of its bounding box: the height function runs for every node of a big grid.
const near = (poly, reach) => {
  const b = L.bbox(poly);
  return (x, y) => (x < b.minX - reach || x > b.maxX + reach || y < b.minY - reach || y > b.maxY + reach ? -Infinity : L.signedDistance(x, y, poly));
};

// ---- surfaces
const tee = L.rect(-6, -5, 6, 5);
const RIDGE = [[-9, 100], [-18, 140], [-30, 190], [-36, 240], [-34, 298]];
const fairway = L.capsule(RIDGE, [38, 46, 54, 56, 46]);                       // the ridge: the safe way
const link = L.capsule([[-28, 286], [0, 296], [24, 300]], [38, 34, 26]);      // round the top of the lake to the green
// the frozen lake: 105 x 150 m of ice, its far shore square to the line so the carry is the same a little left or right
const lake = L.smoothPolygon([[25, 150], [20, 190], [23, 224], [38, 242], [74, 246], [106, 242], [124, 216], [128, 170], [118, 124], [96, 99], [66, 93], [40, 112]], 3);
const shelf = L.blob(50, 268, 38, 18, { wobble: 0.04, seed: 6 });   // the far shore: where the hero drive lands
const green = L.blob(PIN[0], PIN[1], 18, 16, { wobble: 0.05, seed: 4 });       // 36 x 32 m
const greenApron = L.offsetPolygon(green, 5);
const glacier = L.blob(62, 379, 38, 21, { wobble: 0.04, seed: 21 });           // the cirque floor: blue ice, the rocket's landing pad
const crevasse = L.capsule([[32, 350], [62, 351.5], [92, 350]], 5);            // sand along the cirque's lip: the last brake
const river = L.capsule([[-106, 30], [-112, 110], [-124, 200], [-120, 290], [-106, 346]], [20, 22, 24, 22, 18], { stepM: 6 });   // frozen, in the west gully
const street = L.capsule([[-148, 177], [-176, 181], [-204, 177]], 8);          // the village street, groomed
const bunkers = [
  L.blob(-72, 234, 7, 15, { wobble: 0.1, seed: 11 }),                 // stops a pull running off the ridge
  L.blob(3, 206, 6, 14, { wobble: 0.1, seed: 12, rotDeg: -8 }),       // on the ridge's lake edge, above the cliff
  L.blob(-37, 332, 10, 6, { wobble: 0.1, seed: 13 }),                 // through the fairway
  L.blob(77, 304, 6, 9.5, { wobble: 0.08, seed: 14 }),                // right of the green
  L.blob(36, 322, 8.5, 4.5, { wobble: 0.08, seed: 15, rotDeg: -12 }), // back left
  crevasse,
];
// the playable basin: outside it the ground climbs into the mountains
const basin = L.smoothPolygon([
  [-64, -44], [40, -50], [116, -12], [156, 80], [162, 200], [150, 296], [118, 332], [-20, 336], [-70, 356],
  [-150, 344], [-238, 292], [-254, 170], [-236, 70], [-150, -4],
], 3);
const stationPad = L.blob(-14, -36, 46, 24, { wobble: 0.04, seed: 31 });       // the summit: tee and lift station
const villagePad = L.blob(-190, 178, 52, 78, { wobble: 0.06, seed: 32 });      // the ski village's bench
const castlePad = L.blob(182, 424, 26, 22, { wobble: 0.05, seed: 33 });        // the ice castle's crag
const standPad = L.blob(108, 300, 20, 24, { wobble: 0.05, seed: 34 });         // jumbotron and stands, right of the green

// ---- ground
const sdBasin = near(basin, 150), sdLake = near(lake, 8), sdRiver = near(river, 8);
const sdShelf = near(shelf, 20), sdLink = near(link, 12), sdGreen = near(greenApron, 26), sdGlacier = near(glacier, 10);
const sdStation = near(stationPad, 30), sdVillage = near(villagePad, 40), sdCastle = near(castlePad, 30), sdStand = near(standPad, 18);
const sdBunkers = bunkers.map((b) => near(b, 12));

// the ridge's crest: its x at each y (it runs on north past the fairway's end)
const CREST = [[-2, -500], [-2, 60], [-9, 100], [-18, 140], [-30, 190], [-36, 240], [-32, 292], [-30, 900]];
const ridgeX = (y) => {
  for (let i = 1; i < CREST.length; i++) {
    if (y <= CREST[i][1]) return L.lerp(CREST[i - 1][0], CREST[i][0], (y - CREST[i - 1][1]) / (CREST[i][1] - CREST[i - 1][1]));
  }
  return -30;
};
// its height: the summit, a cliff straight off the front of the tee (so the whole valley is in view
// from behind the ball), then a long ski slope to the landing area
const ridgeH = (y) => 13 + 3 * (1 - ss(200, 310, y)) + 8 * (1 - ss(60, 200, y)) + (TEE_H - 24) * (1 - ss(6, 30, y));

const roll = L.fbm({ seed: 501, scaleM: 60, octaves: 2 });
const moguls = L.fbm({ seed: 506, scaleM: 16, octaves: 2 });
const floorNoise = L.fbm({ seed: 502, scaleM: 46, octaves: 3 });
const rangeNoise = L.fbm({ seed: 504, scaleM: 250, octaves: 2 });
const peakNoise = L.fbm({ seed: 505, scaleM: 85, octaves: 3 });
const cragNoise = L.fbm({ seed: 507, scaleM: 26, octaves: 2 });
const edgeNoise = L.fbm({ seed: 508, scaleM: 70, octaves: 2 });
const PEAKS = [[66, 500, 150, 40], [236, 440, 130, 34], [-240, 410, 150, 38], [250, 150, 130, 30], [-270, 60, 130, 26], [150, 300, 70, 14], [-120, 400, 80, 12]];

// the mountains: a rolling range with named peaks, cut into rock bands and snow benches
function massif(x, y) {
  let m = 62 + 16 * rangeNoise(x, y) + 9 * peakNoise(x, y) + 7 * Math.abs(cragNoise(x * 0.5, y * 0.5)) + 2 * cragNoise(x, y);
  for (const [px, py, r, h] of PEAKS) m += h * L.bump(x, y, px, py, r);
  const t = m / 11, f = t - Math.floor(t);
  return L.lerp(m, 11 * (Math.floor(t) + ss(0.3, 0.7, f)), 0.55);
}

const greenPlane = L.plane(9, PIN, 0.004, 0.010);                              // 1.1 %, falling to the lake
// behind the green: a hollow, the icefall, the cirque's lip, then its floor of blue ice
// climbing gently to the headwall, so a ball the headwall throws back runs down to the lip
const LIP_Y = 346;
const cirque = (y) => (y < 366 ? CIRQUE_H + 2 * ss(366, LIP_Y, y) : CIRQUE_H + 0.08 * (y - 366));
const behind = (y) => (y < LIP_Y ? 10.5 + (CIRQUE_H + 2 - 10.5) * ss(328, LIP_Y - 1, y) : cirque(y));

function height(x, y) {
  // the basin floor: the ridge between the lake's hollow and the west gully
  const off = x - ridgeX(y), crest = ridgeH(y);
  const onRidge = 1 - ss(34, 82, Math.abs(off));
  let side;
  if (off > 0) side = L.lerp(1.7 + 0.7 * floorNoise(x, y) + 5 * ss(132, 176, x), 10.5, ss(250, 276, y));   // the lake's hollow (a bench beyond it), land north of it
  else side = 2.2 + 0.8 * floorNoise(x, y) + 7 * ss(-132, -168, x);                 // the gully, the village bench beyond
  let h = L.lerp(side, crest + 0.45 * roll(x, y) + 0.25 * moguls(x, y) * ss(22, 34, Math.abs(off)), onRidge);
  // the far shore: the hero shelf ramps up from the lake to the green
  const far = Math.max(ss(-16, 0, sdShelf(x, y)), ss(-22, -4, sdGreen(x, y)));
  if (far) h = L.lerp(h, L.lerp(5, greenPlane(x, y), L.clamp((y - 246) / 22, 0, 1)), far);
  // the way round: the link falls gently from the ridge to the green
  const way = ss(-9, 0, sdLink(x, y));
  if (way) h = L.lerp(h, L.lerp(13.3, 9.1, ss(-14, 30, x)), way);
  const onGreen = ss(-7, 0, sdGreen(x, y));
  if (onGreen) h = L.lerp(h, greenPlane(x, y), onGreen);
  const stand = ss(-14, 0, sdStand(x, y));
  if (stand) h = L.lerp(h, 11, stand);
  const village = ss(-34, 0, sdVillage(x, y));
  if (village) h = L.lerp(h, 9.5 + 0.5 * floorNoise(x, y), village);

  // the mountains, all round the basin
  const out = ss(-6, 62, 12 * edgeNoise(x, y) - sdBasin(x, y));
  if (out) h = L.lerp(h, massif(x, y), out);
  // the summit behind the tee, with the lift station on it
  const station = ss(-12, 0, sdStation(x, y));
  if (station) h = L.lerp(h, TEE_H + 5 * L.bump(x, y, -36, -44, 28), station);

  // the icefall and the glacier cirque, straight on beyond the green
  const lane = (1 - ss(50, 84, Math.abs(x - 62 - 8 * edgeNoise(y, x)))) * ss(318, 328, y) * (1 - ss(402, 438, y + 5 * edgeNoise(x, y + 400)));
  if (lane) h = L.lerp(h, behind(y) + (y > 350 ? 0.4 * moguls(x, y) * (1 - ss(-8, -2, sdGlacier(x, y))) : 0), lane);
  const crag = ss(-24, 0, sdCastle(x, y));
  if (crag) h = L.lerp(h, 80, crag);

  // sand lies in hollows with a mound behind it
  for (let i = 0; i < bunkers.length; i++) {
    const sand = sdBunkers[i](x, y);
    if (sand > 0) h -= 0.6 * ss(0, 3, sand);
    else if (sand > -11 && y < 330) h += 0.5 * ss(-11, -5, sand) * ss(-0.5, -5, sand) * (1 - onGreen);
  }
  // ice: banks five metres wide on the lake, three on the river, then dead level
  const ice = Math.max(sdLake(x, y) / 5, sdRiver(x, y) / 3);
  if (ice > 0) h = L.lerp(h, 0, ss(0, 1, ice));
  return h;
}

// ---- pines (obstacles): on the benches and the lower slopes, below the tree line, clear of
// every line of play
const ROCKET_LINE = [TEE, [69, 410]];
const mown = [fairway, link, shelf, green, glacier, street, ...bunkers];
const glades = L.fbm({ seed: 601, scaleM: 55, octaves: 2 });
const trees = L.scatterTrees(L.rect(-282, -112, 292, 528), {
  spacing: 16, seed: 61, clearM: 0,
  avoid: [
    ...mown.map((p) => L.offsetPolygon(p, 12)), L.offsetPolygon(lake, 7), L.offsetPolygon(river, 6),
    L.offsetPolygon(stationPad, 4), L.offsetPolygon(standPad, 2), L.offsetPolygon(castlePad, 2),
  ],
  keep: (x, y) => {
    if (L.distToPolyline(x, y, LINE) < 34 || L.distToPolyline(x, y, ROCKET_LINE) < 30) return false;
    if (Math.abs(x - 62) < 62 && y > 316 && y < 470) return false;              // the icefall and the cirque stay bare
    if (L.signedDistance(x, y, villagePad) > -4 && glades(x + 300, y) < 0.25) return false;   // the village's streets
    const h = height(x, y);
    if (h < 0.8 || h > 66) return false;                                         // not on the ice, not above the tree line
    const steep = Math.hypot(height(x + 2, y) - height(x - 2, y), height(x, y + 2) - height(x, y - 2)) / 4;
    return steep < 0.75 && glades(x, y) > -0.28;
  },
});

// ---- props
const P = (kind, x, y, heightM, rotDeg = 0) => L.prop(kind, x, y, { heightM, rotDeg });
const face = (kind, x, y, heightM, tx, ty) => P(kind, x, y, heightM, L.facing(x, y, tx, ty));
const rnd = L.mulberry32(77);
// points round a polygon's edge, `off` metres outside it
const round = (poly, n, off, start = 0) => {
  const [cx, cy] = L.centroid(poly), r = L.radiusOf(poly, [cx, cy]);
  return Array.from({ length: n }, (_, i) => { const a = start + (i / n) * Math.PI * 2; return [cx + (r(a) + off) * Math.cos(a), cy + (r(a) + off) * Math.sin(a)]; });
};
const onMown = (x, y) => mown.some((p) => L.signedDistance(x, y, p) > -3) || L.signedDistance(x, y, tee) > -3;
const offLine = (x, y, m = 9) => L.distToSegment(x, y, TEE[0], TEE[1], PIN[0], PIN[1]) > m;
const dry = (x, y) => L.signedDistance(x, y, lake) < -2 && L.signedDistance(x, y, river) < -2;

const props = [
  // --- the summit station: the top of the lift, the ski jump, a crowd behind the tee
  face('tower', -38, -40, 17, 0, 0), face('cabin', -14, -40, 8.5, 0, 0), face('cabin', -48, -18, 7, 0, 0), face('cabin', 12, -42, 7, 0, 0),
  face('launch-ramp', 26, -8, 12, 40, 80),
  face('crowd', -22, -12, 2.8, 0, 0), face('crowd', 16, -22, 2.8, 0, 0),
  P('flag-banner', -15, -8, 8, 20), P('flag-banner', -9, -11, 8, 10), P('flag-banner', 9, -11, 8, -10), P('flag-banner', 15, -8, 8, -20),
  P('snowman', 11, 4, 2.2, 340), P('snowman', -11, 6, 1.9, 20), P('torch', -9, 9, 3), P('torch', 9, 9, 3),
  P('pine', -30, 4, 20, 10), P('pine', 34, -30, 22, 130), P('pine', -56, -36, 19, 250), P('pine', -4, -52, 21, 70),

  // --- the ski village on the west bench: cabins along a street, a clock tower, the bridge to the ridge
  ...[[-158, 190, 8], [-170, 196, 7], [-184, 198, 8.5], [-198, 194, 7], [-212, 190, 8], [-160, 164, 7.5], [-174, 166, 8], [-190, 168, 7], [-206, 162, 8.5],
    [-176, 222, 7], [-196, 228, 8], [-214, 216, 7], [-168, 136, 8], [-190, 132, 7.5], [-208, 138, 7]]
    .map(([x, y, h]) => face('cabin', x, y, h, x + (y > 182 ? 2 : -2), 180)),
  P('tower', -186, 193, 19, 90), P('windmill', -224, 240, 15, 110),
  ...[-150, -164, -180, -196, -210].flatMap((x) => [P('torch', x, 185, 3), P('torch', x + 4, 173, 3)]),
  P('flag-banner', -142, 186, 7, 90), P('flag-banner', -142, 168, 7, 90), P('flag-banner', -218, 184, 7, 270),
  P('snowman', -166, 206, 2.4, 100), P('snowman', -202, 204, 2, 200), P('snowman', -182, 150, 2.6, 60), P('snowman', -150, 150, 2.1, 140), P('snowman', -216, 150, 2.3, 90),
  P('bridge', -121, 172, 30, 78),
  face('crowd', -146, 206, 2.6, 0, 200), face('crowd', -86, 200, 2.6, -30, 200),
  // the balloon festival over it
  P('balloon', -190, 120, 22), P('balloon', -228, 200, 24), P('balloon', -160, 250, 20), P('balloon', -206, 290, 23), P('balloon', -130, 96, 21), P('balloon', -250, 120, 20),

  // --- the frozen lake: spires and crystals in the ice (clear of the hero line), fishing huts, a boat frozen in
  ...[[98, 150, 9], [114, 178, 13], [92, 196, 7], [122, 150, 8], [104, 126, 10], [108, 208, 11], [90, 172, 5], [118, 196, 6], [100, 100, 8], [84, 222, 7]]
    .map(([x, y, h], i) => P('ice-spire', x, y, h, i * 70)),
  ...[[110, 160, 3], [96, 138, 2.4], [116, 220, 3.4], [88, 208, 2.2], [106, 188, 2.8]].map(([x, y, h], i) => P('crystal', x, y, h, i * 50)),
  face('hut', 100, 224, 4, 60, 240), face('hut', 112, 128, 4, 60, 150), face('hut', 86, 230, 3.6, 50, 280),
  P('boat', 110, 136, 5, 35),
  // spires under the east wall
  P('ice-spire', 150, 214, 15, 180), P('ice-spire', 158, 150, 14, 250), P('ice-spire', 146, 90, 12, 40), P('ice-spire', 176, 250, 22, 30),

  // --- down the ridge: sentinel pines, snowmen watching the drive, banners at the landing area
  P('pine', -62, 110, 23, 40), P('pine', -70, 146, 25, 200), P('pine', -82, 262, 24, 300), P('pine', -66, 322, 22, 85),
  P('pine', -34, 330, 24, 15), P('pine', -8, 320, 22, 160),
  P('snowman', -58, 186, 2.4, 80), P('snowman', -4, 150, 2.1, 110), P('snowman', -62, 268, 2.2, 150), P('snowman', 6, 262, 2.3, 200),
  P('flag-banner', -66, 214, 7, 90), P('flag-banner', -66, 246, 7, 90), P('flag-banner', -4, 246, 7, 270),
  face('crowd', -68, 196, 2.6, -32, 215),

  // --- the green: stands and a screen on the right, a crowd behind, banners and torches round it
  face('jumbotron', 112, 312, 13, PIN[0], PIN[1]), face('grandstand', 106, 292, 9, PIN[0], PIN[1]),
  face('crowd', 96, 322, 2.8, PIN[0], PIN[1]), face('crowd', 16, 302, 2.8, PIN[0], PIN[1]), face('crowd', 18, 320, 2.8, PIN[0], PIN[1]), face('crowd', 70, 324, 2.8, PIN[0], PIN[1]),
  ...round(greenApron, 6, 4, 0.5).map(([x, y]) => P('flag-banner', x, y, 6.5, L.facing(x, y, PIN[0], PIN[1]))),
  P('torch', 28, 292, 3), P('torch', 72, 290, 3), P('snowman', 84, 316, 2.3, 240), P('snowman', 20, 326, 2, 120),
  P('fireworks', 20, 332, 26), P('fireworks', 92, 330, 26),

  // --- the icefall: frozen waterfalls either side of the line, spires along the lip
  face('waterfall', 22, 337, 30, 22, 300), face('waterfall', 102, 337, 30, 102, 300),
  P('ice-spire', 8, 346, 12, 20), P('ice-spire', 118, 346, 13, 200),

  // --- the cirque: a ring of ice round the pad, banners on its lip, crags on the headwall
  ...round(glacier, 9, 7, 0.2).filter(([x, y]) => offLine(x, y, 14) && !onMown(x, y)).map(([x, y], i) => P(i % 3 ? 'ice-spire' : 'crystal', x, y, i % 3 ? 7 + (i * 3) % 6 : 4, i * 40)),
  P('flag-banner', 20, 354, 8), P('flag-banner', 106, 354, 8), face('snowman', 108, 386, 5, 62, 376), face('crowd', 16, 378, 2.8, 62, 376),
  P('ice-spire', 6, 462, 24, 10), P('ice-spire', 120, 466, 28, 120), P('ice-spire', 62, 500, 22, 240), P('ice-spire', -36, 440, 18, 60),
  face('castle', 182, 424, 36, 60, 300), P('flag-banner', 162, 410, 9, 200), P('flag-banner', 204, 412, 9, 160),

  // --- the peaks: crags on the summits, cloud round them, an airship and birds over the valley
  P('ice-spire', 250, 446, 30, 0), P('ice-spire', -248, 424, 32, 80), P('ice-spire', 272, 156, 24, 160), P('ice-spire', -276, 46, 22, 220),
  P('ice-spire', -150, 420, 18, 300), P('ice-spire', 200, 318, 16, 40), P('ice-spire', -84, 384, 14, 0), P('ice-spire', 150, 348, 13, 90),
  P('cloud', 90, 590, 30), P('cloud', 260, 470, 26), P('cloud', -260, 440, 28), P('cloud', 290, 120, 24), P('cloud', -290, 20, 24), P('cloud', -80, 560, 26),
  P('airship', 190, 240, 26, 300), P('bird-flock', 60, 120, 10), P('bird-flock', -90, 300, 10), P('bird-flock', 140, 380, 10),
  P('balloon', 150, 318, 20), P('balloon', 40, 500, 24), P('balloon', 220, 40, 20),
  // lone pines up the slopes where the forest thins
  ...Array.from({ length: 26 }, () => [-270 + rnd() * 550, -100 + rnd() * 610, 14 + rnd() * 9])
    .filter(([x, y]) => { const h = height(x, y); return h > 30 && h < 74 && L.distToPolyline(x, y, ROCKET_LINE) > 40 && !(Math.abs(x - 62) < 62 && y > 316 && y < 470); })
    .map(([x, y, h], i) => P('pine', x, y, h, i * 47)),
].filter((p) => L.FLOATING_PROP_KINDS.includes(p.kind) || p.kind === 'bridge' || (!onMown(p.x, p.y) && offLine(p.x, p.y, L.SLIM_PROP_KINDS.includes(p.kind) ? 6 : 9)));

module.exports = {
  id: 'frostbite-ridge',
  extent: { minX: -300, minY: -150, maxX: 320, maxY: 620 },
  hole: {
    par: 4,
    name: 'Frostbite Ridge',
    line: LINE,
    note: 'From the summit: down the ridge and round the frozen lake, or straight at the flag, 266 yards of carry over the ice. A Rocket flies it all into the glacier cirque above the green.',
    greenNote: 'On a shelf above the lake, tilted towards the ice. The icefall is behind it; bunkers right and back left.',
    routes: [
      { id: 'safe', name: 'The Ridge', note: 'Down the ski slope, left of the lake: a wide fairway, nothing to carry, a wedge in.' },
      { id: 'risky', name: 'Over the Ice', note: 'Straight at the flag: 266 yards of carry to the shelf under the green. Short is on the ice.' },
      { id: 'rocket', name: 'The Glacier Cirque', note: 'A Rocket clears the lake, the green and the icefall. From the cirque it is a flick straight down.' },
    ],
  },
  surfaces: [
    { kind: 'tee', poly: tee },
    { kind: 'fairway', poly: fairway },
    { kind: 'fairway', poly: link },
    { kind: 'fairway', poly: shelf },
    { kind: 'fairway', poly: glacier },
    { kind: 'fairway', poly: street },
    { kind: 'green', poly: green },
    ...bunkers.map((poly) => ({ kind: 'bunker', poly })),
    { kind: 'water', poly: lake },
    { kind: 'water', poly: river },
  ],
  trees,
  // rock showing through the snow: the cliff under the ridge, the icefall, the headwall
  woods: [
    L.capsule([[8, 150], [14, 200], [10, 244]], 10),
    L.capsule([[4, 336], [60, 337], [120, 336]], 14),
    L.capsule([[-4, 420], [62, 426], [128, 418]], 26),
    L.blob(-34, 46, 30, 22, { wobble: 0.2, seed: 41 }),
  ],
  props,
  // far up in the mountains on every side: a wild one finds a snow slope, not a penalty
  obLine: L.rect(-286, -124, 304, 540),
  height,
  sea: false,
  probes: [
    { at: [30, 180], kind: 'water', what: 'the lake on the line straight at the flag' },
    { at: [120, 172], kind: 'water', what: 'the lake, east end' },
    { at: [-124, 200], kind: 'water', what: 'the frozen river in the west gully' },
    { at: [-18, 140], kind: 'fairway', what: 'the ridge' },
    { at: [-30, 225], kind: 'fairway', what: 'the landing area beside the lake' },
    { at: [-34, 290], kind: 'fairway', what: 'the end of the ridge' },
    { at: [0, 296], kind: 'fairway', what: 'the way round the top of the lake' },
    { at: [48, 264], kind: 'fairway', what: 'the hero shelf' },
    { at: [62, 379], kind: 'fairway', what: 'the cirque floor' },
    { at: [62, 351.5], kind: 'bunker', what: 'the crevasse on the cirque lip' },
    { at: [-72, 234], kind: 'bunker', what: 'the save bunker' },
    { at: [77, 304], kind: 'bunker', what: 'the right greenside bunker' },
    { at: [36, 322], kind: 'bunker', what: 'the back left bunker' },
    { at: [58, 322], kind: 'rough', what: 'the hollow under the icefall' },
    { at: [58, 337], kind: 'rough', what: 'the icefall' },
    { at: [10, 100], kind: 'rough', what: 'short of the lake' },
    { at: [0, -14], kind: 'rough', what: 'behind the tee' },
    { at: [-190, 160], kind: 'rough', what: 'the village' },
    { at: [-296, 200], kind: 'ob', what: 'over the western peaks' },
    { at: [314, 190], kind: 'ob', what: 'over the eastern peaks' },
  ],
  stage: {
    number: 5, role: 'match', order: 5,
    name: 'Frostbite Ridge', theme: 'alpine',
    origin: { lat: 55.0, lon: -145.0 },          // open Gulf of Alaska: a low northern sun
    conditions: 'breezy',
    baseM: 2100,
    wind: { min: 4, max: 10 },                    // an exposed summit: never still, never a gale
    timeOfDay: 'day',
    blurb: 'From the summit: ski the ridge, carry the frozen lake, or rocket into the glacier.',
    difficulty: 2,
  },
};
